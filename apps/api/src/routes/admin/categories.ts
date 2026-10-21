import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { asc, count, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@omniplay/core/db';
import { categories, links } from '@omniplay/core/schema';
import { pgCode } from '../../http.ts';
import { contentChanged, httpError, Id } from './util.ts';

// Categories and subcategories (two levels): create, edit, delete, reorder.

const Body = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  slug: Type.Optional(Type.String({ maxLength: 80, pattern: '^[a-z0-9-]*$' })),
  parentId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  description: Type.Optional(Type.String({ maxLength: 280 })),
  icon: Type.Optional(Type.String({ maxLength: 16 })),
  color: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
  isVisible: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** Keeps the tree two levels deep: a parent must itself be top-level, and a category with children can't move under another. */
async function checkParent(parentId: number, selfId?: number) {
  if (parentId === selfId) throw httpError(400, 'A category cannot be its own parent');
  const [p] = await db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, parentId));
  if (!p) throw httpError(400, 'Parent category not found');
  if (p.parentId) throw httpError(400, 'Pick a top-level parent: only two levels are supported');
  if (selfId) {
    const [child] = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, selfId)).limit(1);
    if (child) throw httpError(400, 'This category has subcategories, so it must stay top-level');
  }
}

const slugTaken = (err: unknown, slug: string) => {
  if (pgCode(err) === '23505') throw httpError(409, `The slug "${slug}" is already used`);
  throw err;
};

export const categoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // All categories (hidden too) with total + active link counts, in a single grouped query.
  app.get('/categories', async () =>
    db.select({
      id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name,
      description: categories.description, icon: categories.icon, color: categories.color,
      sortOrder: categories.sortOrder, isVisible: categories.isVisible,
      links: sql<number>`count(${links.id})::int`,
      active: sql<number>`(count(${links.id}) filter (where ${links.status} = 'active'))::int`,
    }).from(categories)
      .leftJoin(links, eq(links.categoryId, categories.id))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder), asc(categories.id)));

  app.post('/categories', { config: { role: 'editor' }, schema: { body: Body } }, async (req, reply) => {
    const b = req.body;
    if (b.parentId) await checkParent(b.parentId);
    const slug = b.slug || slugify(b.name);
    if (!slug) throw httpError(400, 'Name needs at least one letter or digit');
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${categories.sortOrder}) + 1, 0)::int` }).from(categories)
      .where(b.parentId ? eq(categories.parentId, b.parentId) : isNull(categories.parentId));
    const [c] = await db.insert(categories).values({ ...b, slug, sortOrder: next }).returning({ id: categories.id })
      .catch((err) => slugTaken(err, slug));
    await contentChanged(req.user.sub, 'category.create', `Created category “${b.name}”`);
    return reply.code(201).send(c);
  });

  app.patch('/categories/:id', { config: { role: 'editor' }, schema: { params: Id, body: Type.Partial(Body) } }, async (req) => {
    const b = req.body;
    if (b.parentId) await checkParent(b.parentId, req.params.id);
    const [c] = await db.update(categories).set(b).where(eq(categories.id, req.params.id)).returning({ name: categories.name })
      .catch((err) => slugTaken(err, b.slug ?? ''));
    if (!c) throw httpError(404, 'Category not found');
    await contentChanged(req.user.sub, 'category.update', `Edited category “${c.name}”`);
    return { ok: true };
  });

  // Refuses to delete a category that still has links or subcategories (no silent data loss).
  app.delete('/categories/:id', { config: { role: 'editor' }, schema: { params: Id } }, async (req) => {
    const id = req.params.id;
    const [[used], [kids]] = await Promise.all([
      db.select({ n: count() }).from(links).where(eq(links.categoryId, id)),
      db.select({ n: count() }).from(categories).where(eq(categories.parentId, id)),
    ]);
    if (used.n || kids.n) throw httpError(409, `Move its ${used.n} links and ${kids.n} subcategories first`);
    const [c] = await db.delete(categories).where(eq(categories.id, id)).returning({ name: categories.name });
    if (!c) throw httpError(404, 'Category not found');
    await contentChanged(req.user.sub, 'category.delete', `Deleted category “${c.name}”`);
    return { ok: true };
  });

  // Reorder in one UPDATE … FROM (VALUES …) statement instead of one query per row.
  app.put('/categories/order', {
    config: { role: 'editor' },
    schema: { body: Type.Array(Type.Object({ id: Type.Integer({ minimum: 1 }), sortOrder: Type.Integer({ minimum: 0, maximum: 10_000 }) }), { minItems: 1, maxItems: 500 }) },
  }, async (req) => {
    const values = sql.join(req.body.map((i) => sql`(${i.id}::int, ${i.sortOrder}::int)`), sql`, `);
    await db.execute(sql`UPDATE categories c SET sort_order = v.sort FROM (VALUES ${values}) AS v(id, sort) WHERE c.id = v.id`);
    await contentChanged(req.user.sub, 'category.reorder', `Reordered ${req.body.length} categories`);
    return { ok: true };
  });
};
