import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, arrayContains, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@omniplay/core/db';
import { enqueue } from '@omniplay/core/queue';
import { DAY_TTL, K, dayKey, redis } from '@omniplay/core/redis';
import { categories, links, reports } from '@omniplay/core/schema';
import { getSettings } from '@omniplay/core/settings';
import { mediaUrl } from '@omniplay/core/storage';
import { escapeLike, pgCode, visitor } from '../http.ts';

// Public read API for the SPA. Every read is Redis-cached (config.cache) and edge-cacheable; every
// write is a fire-and-forget Redis counter that the worker flushes to Postgres once a minute.
// Response schemas list exactly the fields the cards render: fast-json-stringify drops anything else.

const Card = Type.Object({
  id: Type.Integer(),
  title: Type.String(),
  url: Type.String(),
  description: Type.String(),
  tags: Type.Array(Type.String()),
  image: Type.Union([Type.String(), Type.Null()]),
  categoryId: Type.Integer(),
  featured: Type.Boolean(),
  isNew: Type.Boolean(),
});
const Page = Type.Object({ items: Type.Array(Card), hasMore: Type.Boolean() });

const card = {
  id: links.id, title: links.title, url: links.url, description: links.description, tags: links.tags,
  image: links.imageKey, categoryId: links.categoryId, featured: links.isFeatured,
  isNew: sql<boolean>`${links.createdAt} > now() - interval '14 days'`,
};
// Matches links_public_idx / links_feed_idx (scanned backward), so Postgres reads rows already sorted.
const ranked = [desc(links.isFeatured), desc(links.popularity), desc(links.id)];

// A category is listed when it and its parent (if any) are visible. Selecting a parent includes its
// subcategories. Done as one subquery, so a listing is a single round trip with no N+1.
const visibleCategoryIds = (slug?: string) => sql`(
  SELECT c.id FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
  WHERE c.is_visible AND (p.id IS NULL OR p.is_visible)
  ${slug ? sql`AND (c.slug = ${slug} OR p.slug = ${slug})` : sql``})`;
const listed = (slug?: string) => and(eq(links.status, 'active'), sql`${links.categoryId} IN ${visibleCategoryIds(slug)}`);

const Slug = Type.String({ maxLength: 80, pattern: '^[a-z0-9-]+$' });
const Reason = Type.Union([Type.Literal('dead'), Type.Literal('wrong_link'), Type.Literal('malicious')]);
const fail = (what: string) => (err: unknown) => console.warn(`${what} failed`, err);

export const publicRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Maintenance mode: every /v1 route except bootstrap answers 503 (bootstrap tells the SPA to show the notice).
  // The settings read is in-process cached, so this costs nothing per request.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/') || req.url.startsWith('/v1/bootstrap')) return;
    const { maintenance } = await getSettings('security');
    if (maintenance.enabled) return reply.code(503).header('retry-after', '120').send({ error: maintenance.message });
  });

  // Everything the first paint needs, in one request (index.html preloads it in parallel with the JS).
  app.get('/v1/bootstrap', {
    config: { cache: 60 },
    schema: {
      response: {
        200: Type.Object({
          site: Type.Object({
            title: Type.String(), description: Type.String(), ogImage: Type.String(),
            headScripts: Type.String(), bodyScripts: Type.String(), mediaUrl: Type.String(), pageSize: Type.Integer(),
            maintenance: Type.Object({ enabled: Type.Boolean(), message: Type.String() }),
          }),
          categories: Type.Array(Type.Object({
            id: Type.Integer(), parentId: Type.Union([Type.Integer(), Type.Null()]), slug: Type.String(), name: Type.String(),
            description: Type.String(), icon: Type.String(), color: Type.String(), count: Type.Integer(),
          })),
          trending: Type.Array(Type.Integer()),
          stats: Type.Object({ links: Type.Integer(), categories: Type.Integer() }),
        }),
      },
    },
  }, async () => {
    const [seo, security, perf, trending, cats] = await Promise.all([
      getSettings('seo'), getSettings('security'), getSettings('performance'), redis.get(K.trending),
      db.select({
        id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name,
        description: categories.description, icon: categories.icon, color: categories.color,
        count: sql<number>`count(${links.id})::int`,
      }).from(categories)
        .leftJoin(links, and(eq(links.categoryId, categories.id), eq(links.status, 'active')))
        .where(sql`${categories.id} IN ${visibleCategoryIds()}`)
        .groupBy(categories.id)
        .orderBy(asc(categories.sortOrder), asc(categories.id)),
    ]);
    const total = cats.reduce((n, c) => n + c.count, 0);
    const byId = new Map(cats.map((c) => [c.id, c]));
    for (const c of cats) if (c.parentId) { const p = byId.get(c.parentId); if (p) p.count += c.count; } // parents include subcategories
    return {
      site: {
        title: seo.title, description: seo.description, ogImage: seo.ogImage, headScripts: seo.headScripts,
        bodyScripts: seo.bodyScripts, mediaUrl, pageSize: perf.publicPageSize, maintenance: security.maintenance,
      },
      categories: cats,
      trending: trending ? (JSON.parse(trending) as { id: number }[]).map((t) => t.id) : [],
      stats: { links: total, categories: cats.length },
    };
  });

  // Category grid AND the swipe feed (no category = everything, featured first then most popular).
  app.get('/v1/links', {
    config: { cache: 60 },
    schema: {
      querystring: Type.Object({
        category: Type.Optional(Slug),
        tag: Type.Optional(Type.String({ maxLength: 30 })),
        page: Type.Integer({ minimum: 1, maximum: 500, default: 1 }),
      }, { additionalProperties: false }),
      response: { 200: Page },
    },
  }, async (req) => {
    const { category, tag, page } = req.query;
    const size = (await getSettings('performance')).publicPageSize;
    const rows = await db.select(card).from(links)
      .where(and(listed(category), tag ? arrayContains(links.tags, [tag]) : undefined))
      .orderBy(...ranked)
      .limit(size + 1) // one extra row says whether there's a next page, with no COUNT(*)
      .offset((page - 1) * size);
    return { items: rows.slice(0, size), hasMore: rows.length > size };
  });

  // Story rings: the top 6 sites of each top-level category, all rings in one windowed query.
  app.get('/v1/stories', {
    config: { cache: 120 },
    schema: { response: { 200: Type.Array(Type.Object({ categoryId: Type.Integer(), items: Type.Array(Card) })) } },
  }, async () => {
    const rows = await db.execute<{ ring: number } & Record<string, unknown>>(sql`
      SELECT * FROM (
        SELECT l.id, l.title, l.url, l.description, l.tags, l.image_key AS image, l.category_id AS "categoryId",
               l.is_featured AS featured, l.created_at > now() - interval '14 days' AS "isNew",
               coalesce(c.parent_id, c.id) AS ring,
               row_number() OVER (PARTITION BY coalesce(c.parent_id, c.id)
                                  ORDER BY l.is_featured DESC, l.popularity DESC, l.id DESC) AS rn
        FROM links l JOIN categories c ON c.id = l.category_id
        WHERE l.status = 'active' AND l.category_id IN ${visibleCategoryIds()}
      ) s WHERE rn <= 6 ORDER BY ring, rn`);
    const rings = new Map<number, Record<string, unknown>[]>();
    for (const r of rows) rings.set(r.ring, [...(rings.get(r.ring) ?? []), r]);
    return [...rings].map(([categoryId, items]) => ({ categoryId, items: items as never }));
  });

  // Infix search over the trigram index. Results are cacheable; the query is logged separately by
  // /v1/search/log once the user stops typing, so keystroke prefixes don't pollute analytics.
  app.get('/v1/search', {
    config: {
      cache: 60,
      rateLimit: { max: async () => (await getSettings('security')).rateLimits.searchPerMinute, timeWindow: 60_000 },
    },
    schema: {
      querystring: Type.Object({ q: Type.String({ minLength: 2, maxLength: 60 }) }, { additionalProperties: false }),
      response: { 200: Type.Object({ items: Type.Array(Card) }) },
    },
  }, async (req) => {
    const term = escapeLike(req.query.q.trim().toLowerCase());
    const items = await db.select(card).from(links)
      .where(and(listed(), sql`${links.searchText} LIKE ${`%${term}%`}`))
      .orderBy(sql`${links.title} ILIKE ${`${term}%`} DESC`, ...ranked)
      .limit(30);
    return { items };
  });

  // --- Beacons. 204 straight away; the Redis writes finish after the response. ---

  app.post('/v1/search/log', {
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    schema: {
      querystring: Type.Object({
        q: Type.String({ minLength: 2, maxLength: 60 }), n: Type.Integer({ minimum: 0, maximum: 1000 }),
      }, { additionalProperties: false }),
    },
  }, async (req, reply) => {
    const q = req.query.q.trim().toLowerCase().replace(/\s+/g, ' ');
    const day = dayKey();
    redis.multi()
      .hincrby(K.search(day), q, 1).expire(K.search(day), DAY_TTL)
      .hset(K.searchResults(day), q, req.query.n).expire(K.searchResults(day), DAY_TTL)
      .hincrby(K.traffic(day), 'searches', 1).expire(K.traffic(day), DAY_TTL)
      .exec().catch(fail('search log'));
    return reply.code(204).send();
  });

  app.post('/v1/links/:id/click', {
    schema: { params: Type.Object({ id: Type.Integer({ minimum: 1 }) }) },
  }, async (req, reply) => {
    const id = req.params.id;
    const day = dayKey();
    // Counts each visitor once per link per hour, so repeat clicks can't game Trending.
    // Unknown ids are dropped by the flush job's join on links.
    redis.set(K.clickSeen(id, visitor(req)), '1', 'EX', 3600, 'NX')
      .then((fresh) => fresh && redis.multi()
        .hincrby(K.clicks(day), String(id), 1).expire(K.clicks(day), DAY_TTL)
        .hincrby(K.traffic(day), 'clicks', 1).expire(K.traffic(day), DAY_TTL)
        .exec())
      .catch(fail('click'));
    return reply.code(204).send();
  });

  app.post('/v1/pv', async (req, reply) => {
    const day = dayKey();
    redis.multi()
      .hincrby(K.traffic(day), 'pv', 1).expire(K.traffic(day), DAY_TTL)
      .pfadd(K.visitors(day), visitor(req)).expire(K.visitors(day), DAY_TTL)
      .exec().catch(fail('pageview'));
    return reply.code(204).send();
  });

  // Anonymous reports, rate-limited per IP. One per link per visitor per day; duplicates still get 202
  // so spammers learn nothing.
  app.post('/v1/reports', {
    config: {
      rateLimit: { max: async () => (await getSettings('security')).rateLimits.reportsPerHour, timeWindow: 3_600_000 },
    },
    schema: {
      body: Type.Object({
        linkId: Type.Integer({ minimum: 1 }), reason: Reason, note: Type.Optional(Type.String({ maxLength: 500 })),
      }, { additionalProperties: false }),
    },
  }, async (req, reply) => {
    const { linkId, reason, note = '' } = req.body;
    const v = visitor(req);
    if (await redis.set(K.reportSeen(linkId, v), '1', 'EX', 86_400, 'NX')) {
      try {
        await db.insert(reports).values({ linkId, reason, note: note.trim(), ipHash: v });
      } catch (err) {
        if (pgCode(err) === '23503') return reply.code(404).send({ error: 'Unknown link' });
        throw err;
      }
    }
    return reply.code(202).send();
  });

  // Served on the site's own domain via a Cloudflare Pages Function proxy (apps/web/functions).
  app.get('/ads.txt', { config: { cache: 3600 } }, async (_req, reply) =>
    reply.type('text/plain; charset=utf-8').send((await getSettings('seo')).adsTxt));

  // The Sitemap line must be an absolute URL, so it's built from the admin's SEO site URL.
  app.get('/robots.txt', { config: { cache: 3600 } }, async (_req, reply) => {
    const site = (await getSettings('seo')).siteUrl.replace(/\/$/, '');
    return reply.type('text/plain; charset=utf-8').send(`User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', { config: { cache: 3600 } }, async (_req, reply) => {
    const xml = await redis.get(K.sitemap);
    if (xml) return reply.type('application/xml; charset=utf-8').send(xml);
    await enqueue('sitemap', {}, { jobId: 'sitemap-on-demand' }); // built by the worker, not on the request path
    return reply.code(503).header('retry-after', '60').send({ error: 'Sitemap is being generated' });
  });
};
