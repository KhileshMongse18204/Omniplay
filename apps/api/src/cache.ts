import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_PREFIX } from '@omniplay/core/cache';
import { redis } from '@omniplay/core/redis';

// Redis response cache: the layer that keeps common reads off Postgres.
// A GET route opts in with `config: { cache: <ttl seconds> }`.
//
// - Lookup happens in preHandler, i.e. AFTER schema validation, so the key is built from the validated
//   query. Unknown params were stripped by the schema, so random ?x= values can't mint endless keys.
// - Hit: the stored string goes out as is. No handler, no DB query, no JSON serialization.
// - Miss: concurrent requests for the same key in this process wait for the first one (single-flight),
//   so a hot key expiring under load costs one DB query, not a stampede.
// - The same TTL is sent as s-maxage, so Cloudflare's edge answers most traffic before it reaches the VPS.
// Registered BEFORE @fastify/compress, so Redis stores plain text and compression runs once on the way out.

declare module 'fastify' {
  interface FastifyContextConfig {
    cache?: number;
  }
}

type Entry = { type: string; body: string };
const inflight = new Map<string, Promise<Entry | null>>();
const leaders = new WeakMap<FastifyRequest, { key: string; done: (e: Entry | null) => void }>();

function keyOf(req: FastifyRequest): string {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const qs = Object.keys(q).sort().map((k) => `${k}=${String(q[k])}`).join('&');
  return `${CACHE_PREFIX}${req.routeOptions.url}${JSON.stringify(req.params ?? {})}?${qs}`;
}

// Stored as "<content-type>\n<body>", so text routes (ads.txt, sitemap.xml) are cached as well as JSON.
const pack = (e: Entry) => `${e.type}\n${e.body}`;
const unpack = (s: string): Entry => {
  const i = s.indexOf('\n');
  return { type: s.slice(0, i), body: s.slice(i + 1) };
};

const send = (reply: FastifyReply, e: Entry, how: 'HIT' | 'SHARED') =>
  reply.header('x-cache', how).type(e.type).send(e.body);

function release(req: FastifyRequest, e: Entry | null): void {
  const lead = leaders.get(req);
  if (!lead) return;
  leaders.delete(req);
  inflight.delete(lead.key);
  lead.done(e);
}

export function registerCache(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    const ttl = req.routeOptions.config.cache;
    if (!ttl || req.method !== 'GET') return;
    const key = keyOf(req);
    const hit = await redis.get(key).catch(() => null); // if Redis is down, serve from the DB rather than fail
    if (hit !== null) return send(reply, unpack(hit), 'HIT');
    const pending = inflight.get(key);
    if (pending) {
      const e = await pending;
      if (e) return send(reply, e, 'SHARED');
      return; // the first request failed: this one computes its own response
    }
    let done!: (e: Entry | null) => void;
    inflight.set(key, new Promise((resolve) => { done = resolve; }));
    leaders.set(req, { key, done });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const ttl = req.routeOptions.config.cache;
    if (!ttl || req.method !== 'GET') return payload;
    if (reply.statusCode !== 200) {
      reply.header('cache-control', 'no-store'); // never let the edge cache an error or a maintenance 503
      release(req, null);
      return payload;
    }
    // Browsers revalidate after ≤30s; Cloudflare keeps it `ttl` seconds and refreshes it in the background.
    reply.header('cache-control', `public, max-age=${Math.min(ttl, 30)}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 5}`);
    if (leaders.has(req)) {
      const key = leaders.get(req)!.key;
      const e = typeof payload === 'string'
        ? { type: String(reply.getHeader('content-type') ?? 'application/json; charset=utf-8'), body: payload }
        : null;
      if (e) redis.set(key, pack(e), 'EX', ttl).catch((err) => req.log.warn({ err }, 'cache write failed'));
      release(req, e);
    }
    return payload;
  });

  // Release waiters if the first request dies before onSend (thrown error, client disconnect).
  app.addHook('onResponse', async (req) => release(req, null));
  app.addHook('onRequestAbort', async (req) => release(req, null));
}
