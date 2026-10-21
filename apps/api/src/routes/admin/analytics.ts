import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '@omniplay/core/db';
import { K, redis } from '@omniplay/core/redis';
import { categories, linkClicksDaily, links, searchQueriesDaily } from '@omniplay/core/schema';
import { categoryLabel, parentCategory } from './util.ts';

// Analytics read the small daily aggregate tables (one row per link per day), never raw events,
// so even a year's range is a quick indexed scan.

const Range = Type.Object({
  from: Type.String({ format: 'date' }),
  to: Type.String({ format: 'date' }),
  categoryId: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const analyticsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Most-clicked links by date range and category (a parent category includes its subcategories).
  app.get('/analytics/clicks', { config: { role: 'editor' }, schema: { querystring: Range } }, async (req) => {
    const { from, to, categoryId } = req.query;
    const clicks = sql<number>`sum(${linkClicksDaily.clicks})::int`;
    const where = and(
      gte(linkClicksDaily.day, from), lte(linkClicksDaily.day, to),
      categoryId ? or(eq(links.categoryId, categoryId), sql`${links.categoryId} IN (SELECT id FROM categories WHERE parent_id = ${categoryId})`) : undefined,
    );
    const [top, byCategory, series] = await Promise.all([
      db.select({ id: links.id, title: links.title, url: links.url, category: categoryLabel, clicks })
        .from(linkClicksDaily).innerJoin(links, eq(links.id, linkClicksDaily.linkId)).innerJoin(categories, eq(categories.id, links.categoryId))
        .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
        .where(where).groupBy(links.id, categories.name, parentCategory.name).orderBy(desc(clicks)).limit(100),
      db.select({ categoryId: categories.id, name: categoryLabel, color: categories.color, clicks })
        .from(linkClicksDaily).innerJoin(links, eq(links.id, linkClicksDaily.linkId)).innerJoin(categories, eq(categories.id, links.categoryId))
        .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
        .where(where).groupBy(categories.id, parentCategory.name).orderBy(desc(clicks)),
      db.select({ day: linkClicksDaily.day, clicks })
        .from(linkClicksDaily).innerJoin(links, eq(links.id, linkClicksDaily.linkId))
        .where(where).groupBy(linkClicksDaily.day).orderBy(asc(linkClicksDaily.day)),
    ]);
    return { top, byCategory, series };
  });

  // What people search for, and the content gaps (searches that found nothing).
  app.get('/analytics/searches', { config: { role: 'editor' }, schema: { querystring: Range } }, async (req) => {
    const { from, to } = req.query;
    const total = sql<number>`sum(${searchQueriesDaily.count})::int`;
    const inRange = and(gte(searchQueriesDaily.day, from), lte(searchQueriesDaily.day, to));
    const [top, gaps] = await Promise.all([
      db.select({ query: searchQueriesDaily.query, count: total, results: sql<number>`min(${searchQueriesDaily.results})::int` })
        .from(searchQueriesDaily).where(inRange).groupBy(searchQueriesDaily.query).orderBy(desc(total)).limit(100),
      db.select({ query: searchQueriesDaily.query, count: total })
        .from(searchQueriesDaily).where(and(inRange, eq(searchQueriesDaily.results, 0)))
        .groupBy(searchQueriesDaily.query).orderBy(desc(total)).limit(100),
    ]);
    return { top, gaps };
  });

  // Top 10 fastest-growing links, computed every 15 min by the worker; titles joined in one query.
  app.get('/analytics/trending', async () => {
    const raw = await redis.get(K.trending);
    const list = (raw ? JSON.parse(raw) : []) as { id: number; recent: number; previous: number; growth: number }[];
    if (!list.length) return [];
    const rows = await db.select({ id: links.id, title: links.title, url: links.url, category: categoryLabel })
      .from(links).innerJoin(categories, eq(categories.id, links.categoryId))
      .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
      .where(inArray(links.id, list.map((t) => t.id)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return list.filter((t) => byId.has(t.id)).map((t) => ({ ...byId.get(t.id)!, ...t }));
  });
};
