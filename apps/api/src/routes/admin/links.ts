import { randomUUID } from 'node:crypto';
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { toCsv } from '@omniplay/core/csv';
import { db } from '@omniplay/core/db';
import { isHttpUrl, normalizeTags, searchText } from '@omniplay/core/links';
import { enqueue, queue } from '@omniplay/core/queue';
import { dayKey } from '@omniplay/core/redis';
import { categories, links } from '@omniplay/core/schema';
import { getSettings } from '@omniplay/core/settings';
import { mediaUrl, putObject, storageReady } from '@omniplay/core/storage';
import { escapeLike, pgCode } from '../../http.ts';
import { categoryLabel, contentChanged, httpError, Id, LinkStatus, parentCategory } from './util.ts';

// Link directory manager: list/filter, CRUD, bulk actions, image upload, health re-check, import/export.
// Slow work (image encoding, imports, link checks) goes to the worker queue; these handlers only enqueue.

const Body = Type.Object({
  categoryId: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  url: Type.String({ minLength: 8, maxLength: 2000 }),
  description: Type.Optional(Type.String({ maxLength: 280 })),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 30 }), { maxItems: 20 })),
  status: Type.Optional(LinkStatus),
  isFeatured: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const sorts = {
  newest: [desc(links.createdAt)],
  title: [asc(links.title)],
  popular: [desc(links.popularity)],
};
export const EXPORT_COLUMNS = ['title', 'url', 'category', 'description', 'tags', 'status', 'featured'];

const badCategory = (err: unknown) => {
  if (pgCode(err) === '23503') throw httpError(400, 'Category not found');
  throw err;
};
const inCategoryTree = (categoryId: number) =>
  or(eq(links.categoryId, categoryId), sql`${links.categoryId} IN (SELECT id FROM categories WHERE parent_id = ${categoryId})`);

export const linkRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Raw image uploads (PUT body = file bytes): no multipart parser needed. The worker re-encodes everything
  // to AVIF/WebP, so even an SVG upload is served as a harmless raster.
  app.addContentTypeParser(/^image\/(png|jpeg|webp|avif|gif|svg\+xml)$/, { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (_req, body, done) => done(null, body));

  app.get('/links', {
    schema: {
      querystring: Type.Object({
        q: Type.Optional(Type.String({ maxLength: 60 })),
        status: Type.Optional(LinkStatus),
        categoryId: Type.Optional(Type.Integer({ minimum: 1 })),
        sort: Type.Optional(Type.Union([Type.Literal('newest'), Type.Literal('title'), Type.Literal('popular')])),
        page: Type.Integer({ minimum: 1, default: 1 }),
      }, { additionalProperties: false }),
    },
  }, async (req) => {
    const { q, status, categoryId, sort = 'newest', page } = req.query;
    const size = (await getSettings('performance')).adminPageSize;
    const rows = await db.select({
      id: links.id, title: links.title, url: links.url, description: links.description, tags: links.tags,
      status: links.status, isFeatured: links.isFeatured, imageKey: links.imageKey, categoryId: links.categoryId,
      categoryName: categoryLabel, popularity: links.popularity, checkCode: links.checkCode,
      checkFailures: links.checkFailures, checkedAt: links.checkedAt, createdAt: links.createdAt,
      // Correlated count runs inside this one statement (reports_link_idx), so it isn't N+1.
      openReports: sql<number>`(SELECT count(*) FROM reports r WHERE r.link_id = ${links.id} AND r.status = 'open')::int`,
      total: sql<number>`(count(*) over())::int`, // total for pagination in the same query
    }).from(links)
      .innerJoin(categories, eq(categories.id, links.categoryId))
      .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
      .where(and(
        status ? eq(links.status, status) : undefined,
        categoryId ? inCategoryTree(categoryId) : undefined,
        q ? sql`${links.searchText} LIKE ${`%${escapeLike(q.trim().toLowerCase())}%`}` : undefined,
      ))
      .orderBy(...sorts[sort], desc(links.id))
      .limit(size).offset((page - 1) * size);
    return { items: rows.map(({ total: _, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: size, mediaUrl, uploads: storageReady };
  });

  app.post('/links', { config: { role: 'editor' }, schema: { body: Body } }, async (req, reply) => {
    const b = req.body;
    if (!isHttpUrl(b.url)) throw httpError(400, 'The URL must start with http:// or https://');
    const tags = normalizeTags(b.tags ?? []);
    const [l] = await db.insert(links)
      .values({ ...b, tags, description: b.description ?? '', searchText: searchText({ ...b, tags }) })
      .returning({ id: links.id })
      .catch(badCategory);
    await contentChanged(req.user.sub, 'link.create', `Added “${b.title}”`);
    return reply.code(201).send(l);
  });

  app.patch('/links/:id', { config: { role: 'editor' }, schema: { params: Id, body: Type.Partial(Body) } }, async (req) => {
    const b = req.body;
    const [cur] = await db.select({ title: links.title, description: links.description, tags: links.tags, url: links.url })
      .from(links).where(eq(links.id, req.params.id));
    if (!cur) throw httpError(404, 'Link not found');
    if (b.url !== undefined && !isHttpUrl(b.url)) throw httpError(400, 'The URL must start with http:// or https://');
    const tags = b.tags ? normalizeTags(b.tags) : cur.tags;
    await db.update(links).set({
      ...b,
      tags,
      searchText: searchText({ ...cur, ...b, tags }),
      updatedAt: new Date(),
      ...(b.status ? { autoBroken: false } : {}), // a human decision overrides the checker
      ...(b.url && b.url !== cur.url ? { checkFailures: 0, checkCode: null, checkedAt: null } : {}), // new URL = fresh health record
    }).where(eq(links.id, req.params.id)).catch(badCategory);
    await contentChanged(req.user.sub, 'link.update', `Edited “${b.title ?? cur.title}”`);
    return { ok: true };
  });

  // shortcut: the link's R2 image variants are left in place (keys are content-addressed and may be shared);
  // add a sweep job if storage ever matters.
  app.delete('/links/:id', { config: { role: 'editor' }, schema: { params: Id } }, async (req) => {
    const [l] = await db.delete(links).where(eq(links.id, req.params.id)).returning({ title: links.title });
    if (!l) throw httpError(404, 'Link not found');
    await contentChanged(req.user.sub, 'link.delete', `Deleted “${l.title}”`);
    return { ok: true };
  });

  // One UPDATE/DELETE … WHERE id IN (…) per bulk action, however many rows are selected.
  app.post('/links/bulk', {
    config: { role: 'editor' },
    schema: {
      body: Type.Object({
        ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 500 }),
        action: Type.Union([Type.Literal('status'), Type.Literal('move'), Type.Literal('feature'), Type.Literal('unfeature'), Type.Literal('delete')]),
        status: Type.Optional(LinkStatus),
        categoryId: Type.Optional(Type.Integer({ minimum: 1 })),
      }, { additionalProperties: false }),
    },
  }, async (req) => {
    const { ids, action, status, categoryId } = req.body;
    const where = inArray(links.id, ids);
    const updatedAt = new Date();
    if (action === 'delete') await db.delete(links).where(where);
    else if (action === 'status') {
      if (!status) throw httpError(400, 'Pick a status');
      await db.update(links).set({ status, autoBroken: false, updatedAt }).where(where);
    } else if (action === 'move') {
      if (!categoryId) throw httpError(400, 'Pick a category');
      await db.update(links).set({ categoryId, updatedAt }).where(where).catch(badCategory);
    } else await db.update(links).set({ isFeatured: action === 'feature', updatedAt }).where(where);
    await contentChanged(req.user.sub, `link.bulk.${action}`, `Bulk ${action}${status ? ` → ${status}` : ''} on ${ids.length} links`);
    return { ok: true, count: ids.length };
  });

  // Thumbnail/favicon upload: store the raw file in R2, then let the worker encode the AVIF/WebP srcset variants.
  app.put('/links/:id/image', { config: { role: 'editor' }, bodyLimit: 5 * 1024 * 1024, schema: { params: Id } }, async (req, reply) => {
    if (!storageReady) throw httpError(503, 'Uploads need Cloudflare R2: set the R2_* variables in .env');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || !body.length) throw httpError(415, 'Send the image bytes with an image/* content type');
    const [l] = await db.select({ id: links.id }).from(links).where(eq(links.id, req.params.id));
    if (!l) throw httpError(404, 'Link not found');
    const rawKey = `raw/${randomUUID()}`;
    await putObject(rawKey, body, String(req.headers['content-type']), 'no-store');
    const job = await enqueue('image-process', { linkId: l.id, rawKey });
    return reply.code(202).send({ jobId: job.id });
  });

  app.delete('/links/:id/image', { config: { role: 'editor' }, schema: { params: Id } }, async (req) => {
    await db.update(links).set({ imageKey: null, updatedAt: new Date() }).where(eq(links.id, req.params.id));
    await contentChanged(req.user.sub, 'link.image', `Removed an image from link #${req.params.id}`);
    return { ok: true };
  });

  app.post('/links/:id/check', { config: { role: 'editor' }, schema: { params: Id } }, async (req, reply) => {
    const job = await enqueue('link-check', { linkId: req.params.id }, { attempts: 1 });
    return reply.code(202).send({ jobId: job.id });
  });

  app.get('/links/export', {
    config: { role: 'editor' },
    schema: { querystring: Type.Object({ format: Type.Union([Type.Literal('csv'), Type.Literal('json')], { default: 'csv' }) }) },
  }, async (req, reply) => {
    const rows = await db.select({
      title: links.title, url: links.url, category: categories.slug, description: links.description,
      tags: links.tags, status: links.status, featured: links.isFeatured,
    }).from(links).innerJoin(categories, eq(categories.id, links.categoryId))
      .orderBy(asc(categories.slug), asc(links.title));
    const { format } = req.query;
    reply.header('content-disposition', `attachment; filename="omniplay-links-${dayKey()}.${format}"`);
    if (format === 'json') return reply.type('application/json; charset=utf-8').send(JSON.stringify(rows, null, 2));
    return reply.type('text/csv; charset=utf-8')
      .send(toCsv([EXPORT_COLUMNS, ...rows.map((r) => [r.title, r.url, r.category, r.description, r.tags.join(';'), r.status, r.featured])]));
  });

  // Import runs in the worker (parse, validate, batched upserts); the admin UI polls /jobs/:id for the result.
  app.post('/links/import', {
    config: { role: 'editor' },
    bodyLimit: 3 * 1024 * 1024,
    schema: {
      body: Type.Object({
        format: Type.Union([Type.Literal('csv'), Type.Literal('json')]),
        mode: Type.Union([Type.Literal('upsert'), Type.Literal('skip')]),
        content: Type.String({ minLength: 1, maxLength: 2_500_000 }),
      }, { additionalProperties: false }),
    },
  }, async (req, reply) => {
    const job = await enqueue('import-links', { ...req.body, actorId: req.user.sub }, { attempts: 1 });
    return reply.code(202).send({ jobId: job.id });
  });

  app.get('/jobs/:id', { schema: { params: Type.Object({ id: Type.String({ maxLength: 64 }) }) } }, async (req) => {
    const job = await queue().getJob(req.params.id);
    if (!job) throw httpError(404, 'Job not found');
    return { id: job.id, name: job.name, state: await job.getState(), result: job.returnvalue ?? null, error: job.failedReason ?? null };
  });
};
