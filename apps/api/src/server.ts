// OmniPlay API entry point: one stateless Fastify process. No sessions or files are kept in memory,
// so you can add replicas behind the tunnel at any time.
// shortcut: one process = one CPU core (the 2nd core goes to Postgres/Redis/worker); add compose replicas if CPU-bound.
import zlib from 'node:zlib';
import Fastify, { LogController, type FastifyError } from 'fastify';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { pg } from '@omniplay/core/db';
import { assertEnv, env } from '@omniplay/core/env';
import { closeQueue } from '@omniplay/core/queue';
import { redis } from '@omniplay/core/redis';
import { getSettings } from '@omniplay/core/settings';
import { registerCache } from './cache.ts';
import { clientIp } from './http.ts';
import { adminRoutes } from './routes/admin/index.ts';
import { publicRoutes } from './routes/public.ts';

assertEnv(['DATABASE_URL', 'JWT_SECRET', 'SECRETS_KEY', 'IP_HASH_SALT']);

const app = Fastify({
  logger: { level: env.isProd ? 'info' : 'debug' },
  // Per-request logs cost a noticeable slice of throughput; Cloudflare already logs every request.
  logController: new LogController({ disableRequestLogging: true }),
  trustProxy: true,
  // Longer than the tunnel's idle timeout, so connections are reused rather than re-handshaken.
  keepAliveTimeout: 75_000,
  // Small default body limit; only the upload/import routes raise it.
  bodyLimit: 64 * 1024,
}).withTypeProvider<TypeBoxTypeProvider>();

// Hide internals on 5xx; 4xx (validation) messages stay useful to clients.
app.setErrorHandler((err: FastifyError, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 ? 'Internal error' : err.message });
});

// Rate limits live in Redis, so they hold across processes and restarts (the app stays stateless).
// skipOnError: if Redis blips, keep serving rather than fail every request.
await app.register(rateLimit, {
  global: true,
  redis,
  nameSpace: 'rl:',
  skipOnError: true,
  keyGenerator: clientIp,
  timeWindow: 60_000,
  max: async () => (await getSettings('security')).rateLimits.publicPerMinute,
});

// Public data is the same for every visitor: ACAO "*" keeps edge-cached responses valid for any origin.
// Only /admin gets credentialed CORS, locked to the admin app's origin.
await app.register(cors, {
  delegator: (req, cb) => cb(null, req.url?.startsWith('/admin')
    ? { origin: env.adminOrigin, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 600 }
    : { origin: '*', methods: ['GET', 'POST'], maxAge: 86_400 }),
});

registerCache(app); // must come before compress (see cache.ts)

// Brotli at quality 4 is ~10x faster than the max setting and still smaller than gzip; responses under 1 KB
// aren't worth the CPU. Compression runs in zlib's thread pool, off the event loop.
await app.register(compress, {
  global: true,
  threshold: 1024,
  encodings: ['br', 'gzip'],
  brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
});

await app.register(cookie);
await app.register(jwt, { secret: env.jwtSecret });

app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));
await app.register(publicRoutes);
await app.register(adminRoutes, { prefix: '/admin' });

// Graceful shutdown: let in-flight requests finish, then close pools, so deploys drop no requests.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await app.close();
    await Promise.allSettled([pg.end({ timeout: 5 }), redis.quit(), closeQueue()]);
    process.exit(0);
  });
}

await app.listen({ port: env.port, host: '0.0.0.0' });
