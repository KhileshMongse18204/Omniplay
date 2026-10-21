import { Type, type FastifyPluginAsyncTypebox, type TSchema } from '@fastify/type-provider-typebox';
import { logActivity } from '@omniplay/core/activity';
import { CACHE_PREFIX, clearCache } from '@omniplay/core/cache';
import { createMailer } from '@omniplay/core/mail';
import { enqueue, syncSchedules } from '@omniplay/core/queue';
import { redis } from '@omniplay/core/redis';
import { GROUPS, getSettings, maskSecrets, saveSettings, type Group, type Settings } from '@omniplay/core/settings';
import { listObjects, storageReady } from '@omniplay/core/storage';
import { httpError } from './util.ts';

// System settings (owner only): external API keys + connection tests, caching (Cloudflare purge, Redis keys,
// page sizes), SEO (meta, scripts, sitemap, ads.txt), automation (link checker, backups) and security
// (maintenance, rate limits, registration rules, SMTP).

const Str = (max: number) => Type.String({ maxLength: max });
const Int = (minimum: number, maximum: number) => Type.Integer({ minimum, maximum });
const Part = (props: Record<string, TSchema>) => Type.Partial(Type.Object(props, { additionalProperties: false }));
const Lit = <T extends string>(...v: T[]) => Type.Union(v.map((x) => Type.Literal(x)));

// Validation at the trust boundary: each group's PATCH body is a deep-partial with ranges,
// so a typo can't set the page size to 1e9 or the rate limit to 0.
const schemas: Record<Group, TSchema> = {
  apis: Part({ tmdbKey: Str(500), rawgKey: Str(500), shortener: Part({ provider: Lit('bitly', 'custom'), endpoint: Str(300), apiKey: Str(500) }) }),
  performance: Part({ cloudflare: Part({ zoneId: Str(64), apiToken: Str(200) }), publicPageSize: Int(6, 96), adminPageSize: Int(10, 200) }),
  seo: Part({
    siteUrl: Str(200), title: Str(120), description: Str(300), ogImage: Str(500),
    headScripts: Str(20_000), bodyScripts: Str(20_000), adsTxt: Str(50_000),
  }),
  automation: Part({
    linkCheck: Part({
      enabled: Type.Boolean(), everyMinutes: Int(5, 1440), batchSize: Int(5, 500), concurrency: Int(1, 32),
      timeoutMs: Int(2000, 30_000), recheckHours: Int(1, 168), failureThreshold: Int(1, 20),
    }),
    backups: Part({ enabled: Type.Boolean(), cron: Type.String({ maxLength: 60, pattern: '^[0-9*/,\\- ]+$' }), keep: Int(1, 90) }),
  }),
  security: Part({
    maintenance: Part({ enabled: Type.Boolean(), message: Str(300) }),
    rateLimits: Part({ publicPerMinute: Int(30, 10_000), searchPerMinute: Int(5, 1000), reportsPerHour: Int(1, 100), loginPer15Min: Int(3, 100) }),
    registration: Part({
      openSignup: Type.Boolean(), allowedDomains: Type.Array(Str(100), { maxItems: 50 }),
      defaultRole: Lit('moderator', 'editor'), requireApproval: Type.Boolean(),
    }),
    smtp: Part({ host: Str(200), port: Int(1, 65_535), secure: Type.Boolean(), user: Str(200), pass: Str(500), from: Str(200) }),
  }),
};

const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`answered HTTP ${res.status}`);
  return res;
};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const need = (v: string, what: string) => { if (!v) throw new Error(`no ${what} saved yet`); return v; };

// "Test API connection" buttons: one cheap authenticated call per provider.
const tests: Record<string, () => Promise<string>> = {
  async tmdb() {
    const key = need((await getSettings('apis')).tmdbKey, 'TMDB key');
    const v4 = key.startsWith('eyJ'); // v4 read-access tokens are JWTs; v3 keys go in the query string
    await get(`https://api.themoviedb.org/3/configuration${v4 ? '' : `?api_key=${encodeURIComponent(key)}`}`, v4 ? bearer(key) : {});
    return 'TMDB accepted the key';
  },
  async rawg() {
    const key = need((await getSettings('apis')).rawgKey, 'RAWG key');
    await get(`https://api.rawg.io/api/genres?page_size=1&key=${encodeURIComponent(key)}`);
    return 'RAWG accepted the key';
  },
  async shortener() {
    const s = (await getSettings('apis')).shortener;
    need(s.apiKey, 'shortener API key');
    await get(s.provider === 'bitly' ? 'https://api-ssl.bitly.com/v4/user' : need(s.endpoint, 'shortener endpoint'), bearer(s.apiKey));
    return `${s.provider === 'bitly' ? 'Bitly' : 'Shortener endpoint'} accepted the key`;
  },
  async cloudflare() {
    const cf = (await getSettings('performance')).cloudflare;
    const res = await get(`https://api.cloudflare.com/client/v4/zones/${need(cf.zoneId, 'zone ID')}`, bearer(need(cf.apiToken, 'API token')));
    const body = await res.json() as { result?: { name?: string } };
    return `Connected to zone ${body.result?.name ?? cf.zoneId}`;
  },
  async smtp() {
    const smtp = (await getSettings('security')).smtp;
    need(smtp.host, 'SMTP host');
    await createMailer(smtp).verify();
    return `SMTP server ${smtp.host} accepted the login`;
  },
};

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const owner = { config: { role: 'owner' as const } };

  app.get('/settings', owner, async () =>
    Object.fromEntries(await Promise.all(GROUPS.map(async (g) => [g, maskSecrets(g, await getSettings(g))]))));

  for (const group of GROUPS) {
    app.patch(`/settings/${group}`, { ...owner, schema: { body: schemas[group] } }, async (req) => {
      if (group === 'automation') {
        // Apply the schedule before saving: an invalid cron fails here with a 400, not later inside the worker.
        const next = structuredClone(await getSettings('automation'));
        const b = req.body as Partial<Settings['automation']>;
        Object.assign(next.linkCheck, b.linkCheck);
        Object.assign(next.backups, b.backups);
        await syncSchedules(next).catch((err: Error) => { throw httpError(400, `Invalid schedule: ${err.message}`); });
      }
      const saved = await saveSettings(group, req.body, req.user.sub);
      // Bootstrap/listing responses embed these values: rebuild the public cache.
      if (group === 'seo' || group === 'security' || group === 'performance') await clearCache().catch(() => 0);
      void logActivity(req.user.sub, 'settings.update', `Updated ${group} settings`);
      return maskSecrets(group, saved);
    });
  }

  app.post('/settings/test/:provider', {
    ...owner,
    schema: { params: Type.Object({ provider: Lit('tmdb', 'rawg', 'shortener', 'cloudflare', 'smtp') }) },
  }, async (req) => {
    try {
      return { ok: true, message: await tests[req.params.provider]() };
    } catch (err) {
      return { ok: false, message: `Failed: ${(err as Error).message}` };
    }
  });

  // --- Caching & performance ---

  app.post('/system/cdn-purge', {
    ...owner,
    schema: { body: Type.Object({ urls: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 30 })) }, { additionalProperties: false }) },
  }, async (req) => {
    const cf = (await getSettings('performance')).cloudflare;
    if (!cf.zoneId || !cf.apiToken) throw httpError(400, 'Add the Cloudflare zone ID and API token first');
    const urls = req.body.urls?.filter(Boolean);
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cf.zoneId}/purge_cache`, {
      method: 'POST',
      headers: { ...bearer(cf.apiToken), 'content-type': 'application/json' },
      body: JSON.stringify(urls?.length ? { files: urls } : { purge_everything: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { success: boolean; errors?: { message: string }[] };
    if (!body.success) throw httpError(502, `Cloudflare refused: ${body.errors?.map((e) => e.message).join('; ') ?? res.status}`);
    void logActivity(req.user.sub, 'cache.cdn-purge', urls?.length ? `Purged ${urls.length} URL(s) from Cloudflare` : 'Purged the whole Cloudflare cache');
    return { ok: true };
  });

  // Granular Redis cache browser: SCAN (non-blocking) up to 500 keys, with TTLs fetched in one pipeline.
  app.get('/system/cache-keys', {
    ...owner,
    schema: { querystring: Type.Object({ pattern: Type.String({ maxLength: 200, default: `${CACHE_PREFIX}*` }) }) },
  }, async (req) => {
    const pattern = req.query.pattern.startsWith(CACHE_PREFIX) ? req.query.pattern : `${CACHE_PREFIX}*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0' && keys.length < 500);
    const ttls = await Promise.all(keys.slice(0, 500).map((k) => redis.ttl(k))); // auto-pipelined into one round trip
    return { keys: keys.slice(0, 500).map((key, i) => ({ key, ttl: ttls[i] })), truncated: keys.length > 500 };
  });

  app.delete('/system/cache-keys', {
    ...owner,
    schema: { body: Type.Object({ pattern: Type.String({ maxLength: 200 }) }, { additionalProperties: false }) },
  }, async (req) => {
    const removed = await clearCache(req.body.pattern).catch((err: Error) => { throw httpError(400, err.message); });
    void logActivity(req.user.sub, 'cache.clear', `Cleared ${removed} Redis cache key(s) matching ${req.body.pattern}`);
    return { removed };
  });

  // --- SEO & automation one-off triggers (the work happens in the worker) ---

  app.post('/system/sitemap', owner, async (req, reply) => {
    const job = await enqueue('sitemap', {});
    void logActivity(req.user.sub, 'seo.sitemap', 'Requested sitemap regeneration');
    return reply.code(202).send({ jobId: job.id });
  });

  app.post('/system/backup', owner, async (req, reply) => {
    if (!storageReady) throw httpError(503, 'Backups are stored in Cloudflare R2: set the R2_* variables first');
    const job = await enqueue('backup', {}, { attempts: 1 });
    void logActivity(req.user.sub, 'backup.request', 'Started a database backup');
    return reply.code(202).send({ jobId: job.id });
  });

  app.get('/system/backups', owner, async () =>
    storageReady ? (await listObjects('backups/')).sort((a, b) => b.key.localeCompare(a.key)) : []);
};
