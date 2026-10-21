import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, count, desc, eq, gt, gte, or } from 'drizzle-orm';
import { db, pg } from '@omniplay/core/db';
import { queue } from '@omniplay/core/queue';
import { K, dayKey, redis } from '@omniplay/core/redis';
import { activityLog, categories, links, reports, trafficDaily, users } from '@omniplay/core/schema';

// Dashboard = quick metrics + system health (broken-link alerts) + 14-day traffic + activity feed.
// One request, every query in parallel, and each reads only the columns it shows.

const timed = async (fn: () => Promise<unknown>) => {
  const t = performance.now();
  try { await fn(); return Math.round((performance.now() - t) * 10) / 10; } catch { return null; }
};
const json = (s: string | null) => (s ? JSON.parse(s) : null);
const infoField = (info: string, key: string) => info.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1]?.trim() ?? '';

export const dashboardRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/me', async (req) => {
    const [u] = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users).where(eq(users.id, req.user.sub));
    return u;
  });

  app.get('/dashboard', async () => {
    const today = dayKey();
    const since = dayKey(new Date(Date.now() - 14 * 86_400_000)); // 14 complete days + today
    const [byStatus, [cats], [openReports], alerts, activity, history, live, visitors, jobs, lastRuns, memory, dbMs, redisMs] = await Promise.all([
      db.select({ status: links.status, n: count() }).from(links).groupBy(links.status),
      db.select({ n: count() }).from(categories),
      db.select({ n: count() }).from(reports).where(eq(reports.status, 'open')),
      // Broken links, plus active ones that have started failing checks (they'll flip after the threshold).
      db.select({ id: links.id, title: links.title, url: links.url, status: links.status, code: links.checkCode, failures: links.checkFailures, checkedAt: links.checkedAt })
        .from(links)
        .where(or(eq(links.status, 'broken'), and(eq(links.status, 'active'), gt(links.checkFailures, 0))))
        .orderBy(desc(links.checkFailures)).limit(10),
      db.select({ id: activityLog.id, action: activityLog.action, summary: activityLog.summary, at: activityLog.createdAt, actor: users.name })
        .from(activityLog).leftJoin(users, eq(users.id, activityLog.actorId))
        .orderBy(desc(activityLog.createdAt)).limit(20),
      db.select().from(trafficDaily).where(gte(trafficDaily.day, since)).orderBy(asc(trafficDaily.day)),
      redis.hgetall(K.traffic(today)),
      redis.pfcount(K.visitors(today)),
      queue().getJobCounts('wait', 'active', 'delayed', 'failed'),
      redis.mget(K.lastRun('link-check'), K.lastRun('backup'), K.lastRun('sitemap'), K.lastRun('flush-stats')),
      redis.info('memory'),
      timed(() => pg`select 1`),
      timed(() => redis.ping()),
    ]);

    // Today's numbers come live from Redis (the DB copy lags by up to one flush).
    const todayRow = { day: today, pageviews: Number(live.pv ?? 0), visitors, clicks: Number(live.clicks ?? 0), searches: Number(live.searches ?? 0) };
    const traffic = [...history.filter((r) => r.day !== today), todayRow];
    const statusCount = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));

    return {
      metrics: {
        links: byStatus.reduce((n, r) => n + r.n, 0),
        active: statusCount.active ?? 0,
        broken: statusCount.broken ?? 0,
        drafts: statusCount.draft ?? 0,
        categories: cats.n,
        openReports: openReports.n,
        today: todayRow,
      },
      health: {
        dbMs, redisMs,
        redisMemory: { used: infoField(memory, 'used_memory_human'), max: infoField(memory, 'maxmemory_human') },
        jobs,
        lastLinkCheck: json(lastRuns[0]), lastBackup: json(lastRuns[1]), lastSitemap: json(lastRuns[2]), lastFlush: json(lastRuns[3]),
        alerts,
      },
      traffic,
      activity,
    };
  });
};
