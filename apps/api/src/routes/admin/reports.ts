import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@omniplay/core/db';
import { links, reports } from '@omniplay/core/schema';
import { contentChanged } from './util.ts';

// User-reports queue, grouped per link so 40 "dead" reports on one site are a single row to act on.

export const reportRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/reports', {
    schema: {
      querystring: Type.Object({
        status: Type.Union([Type.Literal('open'), Type.Literal('resolved'), Type.Literal('dismissed')], { default: 'open' }),
      }, { additionalProperties: false }),
    },
  }, async (req) =>
    // One grouped query with per-reason counts and the 3 latest notes (reports_queue_idx + reports_link_idx).
    db.execute(sql`
      SELECT r.link_id AS "linkId", l.title, l.url, l.status AS "linkStatus",
             count(*)::int AS total,
             (count(*) FILTER (WHERE r.reason = 'dead'))::int AS dead,
             (count(*) FILTER (WHERE r.reason = 'wrong_link'))::int AS "wrongLink",
             (count(*) FILTER (WHERE r.reason = 'malicious'))::int AS malicious,
             max(r.created_at) AS "lastAt",
             (array_remove(array_agg(r.note ORDER BY r.created_at DESC), ''))[1:3] AS notes
      FROM reports r JOIN links l ON l.id = r.link_id
      WHERE r.status = ${req.query.status}
      GROUP BY r.link_id, l.id
      ORDER BY malicious DESC, total DESC, "lastAt" DESC
      LIMIT 200`));

  // Resolve every open report for a link at once, optionally acting on the link itself.
  app.post('/reports/resolve', {
    schema: {
      body: Type.Object({
        linkId: Type.Integer({ minimum: 1 }),
        action: Type.Union([Type.Literal('dismiss'), Type.Literal('resolve'), Type.Literal('hide'), Type.Literal('mark_broken')]),
      }, { additionalProperties: false }),
    },
  }, async (req) => {
    const { linkId, action } = req.body;
    const done = await db.update(reports)
      .set({ status: action === 'dismiss' ? 'dismissed' : 'resolved', resolvedBy: req.user.sub, resolvedAt: new Date() })
      .where(and(eq(reports.linkId, linkId), eq(reports.status, 'open')))
      .returning({ id: reports.id });
    let summary = `${action === 'dismiss' ? 'Dismissed' : 'Resolved'} ${done.length} report(s) on link #${linkId}`;
    if (action === 'hide' || action === 'mark_broken') {
      const [l] = await db.update(links)
        .set({ status: action === 'hide' ? 'hidden' : 'broken', autoBroken: false, updatedAt: new Date() })
        .where(eq(links.id, linkId)).returning({ title: links.title });
      summary = `${action === 'hide' ? 'Hid' : 'Marked broken'} “${l?.title}” after ${done.length} report(s)`;
    }
    await contentChanged(req.user.sub, `report.${action}`, summary);
    return { resolved: done.length };
  });
};
