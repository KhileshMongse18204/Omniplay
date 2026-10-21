import { sql } from 'drizzle-orm';
import { db } from '@omniplay/core/db';
import { K, dayKey, redis } from '@omniplay/core/redis';
import { trafficDaily } from '@omniplay/core/schema';

// Redis counters → Postgres daily aggregates, once a minute. Redis keeps each day's running total, so
// every upsert writes an absolute value: a retried or overlapping flush can never double count.
// Rows go in as one JSON parameter (jsonb_to_recordset): one statement per table, whatever the row count.

export async function flushStats(): Promise<{ links: number; queries: number }> {
  const days = [dayKey(), dayKey(new Date(Date.now() - 86_400_000))]; // yesterday too, for the minute after midnight
  let linksFlushed = 0;
  let queries = 0;
  for (const day of days) {
    const [clicks, searches, results, traffic, visitors] = await Promise.all([
      redis.hgetall(K.clicks(day)), redis.hgetall(K.search(day)), redis.hgetall(K.searchResults(day)),
      redis.hgetall(K.traffic(day)), redis.pfcount(K.visitors(day)),
    ]);

    const clickRows = Object.entries(clicks).map(([id, n]) => ({ id: Number(id), n: Number(n) })).filter((r) => Number.isInteger(r.id));
    if (clickRows.length) {
      await db.execute(sql`
        INSERT INTO link_clicks_daily (day, link_id, clicks)
        SELECT ${day}::date, v.id, v.n FROM jsonb_to_recordset(${JSON.stringify(clickRows)}::jsonb) AS v(id int, n int)
        WHERE EXISTS (SELECT 1 FROM links l WHERE l.id = v.id) -- drop clicks on deleted/unknown ids
        ON CONFLICT (day, link_id) DO UPDATE SET clicks = EXCLUDED.clicks`);
      linksFlushed += clickRows.length;
    }

    const searchRows = Object.entries(searches).map(([q, n]) => ({ q: q.slice(0, 100), n: Number(n), r: Number(results[q] ?? 0) }));
    if (searchRows.length) {
      await db.execute(sql`
        INSERT INTO search_queries_daily (day, query, count, results)
        SELECT ${day}::date, v.q, v.n, v.r FROM jsonb_to_recordset(${JSON.stringify(searchRows)}::jsonb) AS v(q text, n int, r int)
        ON CONFLICT (day, query) DO UPDATE SET count = EXCLUDED.count, results = EXCLUDED.results`);
      queries += searchRows.length;
    }

    if (Object.keys(traffic).length || visitors) {
      const row = { pageviews: Number(traffic.pv ?? 0), visitors, clicks: Number(traffic.clicks ?? 0), searches: Number(traffic.searches ?? 0) };
      await db.insert(trafficDaily).values({ day, ...row }).onConflictDoUpdate({ target: trafficDaily.day, set: row });
    }
  }
  return { links: linksFlushed, queries };
}

/** Growth score: recent vs previous window, damped by +10 so 1→3 clicks doesn't beat 200→400. */
export const growth = (recent: number, previous: number) => Math.round(((recent - previous) / (previous + 10)) * 100) / 100;

export async function updateTrending(): Promise<{ trending: number }> {
  // 30-day popularity drives the default sort. Only rows whose value changed are rewritten (less WAL, less bloat).
  await db.execute(sql`
    WITH p AS (
      SELECT l.id, coalesce(sum(d.clicks), 0)::int AS pop
      FROM links l LEFT JOIN link_clicks_daily d ON d.link_id = l.id AND d.day > current_date - 30
      GROUP BY l.id)
    UPDATE links SET popularity = p.pop FROM p WHERE links.id = p.id AND links.popularity <> p.pop`);

  // Fastest-growing: last 3 days vs the 3 before, active links with at least 5 recent clicks.
  const rows = await db.execute<{ id: number; recent: number; previous: number }>(sql`
    SELECT d.link_id AS id,
           (sum(d.clicks) FILTER (WHERE d.day > current_date - 3))::int AS recent,
           coalesce(sum(d.clicks) FILTER (WHERE d.day <= current_date - 3), 0)::int AS previous
    FROM link_clicks_daily d JOIN links l ON l.id = d.link_id AND l.status = 'active'
    WHERE d.day > current_date - 6
    GROUP BY d.link_id
    HAVING sum(d.clicks) FILTER (WHERE d.day > current_date - 3) >= 5`);
  const top = [...rows]
    .map((r) => ({ ...r, growth: growth(r.recent, r.previous) }))
    .filter((r) => r.growth > 0)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 10);
  await redis.set(K.trending, JSON.stringify(top));
  return { trending: top.length };
}
