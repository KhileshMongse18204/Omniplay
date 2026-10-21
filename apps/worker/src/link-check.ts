import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { logActivity } from '@omniplay/core/activity';
import { clearCache } from '@omniplay/core/cache';
import { db } from '@omniplay/core/db';
import { links } from '@omniplay/core/schema';
import { getSettings } from '@omniplay/core/settings';
import { isAlive, nextState } from './health.ts';

// Broken-link monitor. Checks a small batch per run with bounded concurrency, reads only the response
// headers (bodies are cancelled), and writes every result back in ONE bulk UPDATE.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OmniPlayLinkCheck/1.0';

async function probe(url: string, timeoutMs: number): Promise<number> {
  const req = (method: string) => fetch(url, {
    method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
  });
  try {
    let res = await req('HEAD');
    if (!isAlive(res.status)) { await res.body?.cancel(); res = await req('GET'); } // many servers mishandle HEAD
    await res.body?.cancel(); // headers are enough; never download the page
    return res.status === 503 && res.headers.get('cf-mitigated') === 'challenge' ? 403 : res.status;
  } catch {
    return 0; // DNS failure, refused, TLS error or timeout
  }
}

/** Run fn over items with at most `limit` in flight: enough to finish fast, never a socket flood. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const fields = { id: links.id, title: links.title, url: links.url, status: links.status, checkFailures: links.checkFailures, autoBroken: links.autoBroken };

export async function checkLinks(linkId?: number): Promise<{ checked: number; broken: number; restored: number }> {
  const cfg = (await getSettings('automation')).linkCheck;
  const due = linkId
    ? await db.select(fields).from(links).where(eq(links.id, linkId))
    : await db.select(fields).from(links)
      .where(and(
        inArray(links.status, ['active', 'broken']),
        or(isNull(links.checkedAt), lt(links.checkedAt, new Date(Date.now() - cfg.recheckHours * 3_600_000))),
      ))
      .orderBy(sql`${links.checkedAt} ASC NULLS FIRST`) // never-checked first, then the stalest (links_check_idx)
      .limit(cfg.batchSize);
  if (!due.length) return { checked: 0, broken: 0, restored: 0 };

  const probed = await mapLimit(due, cfg.concurrency, async (l) => ({ l, code: await probe(l.url, cfg.timeoutMs) }));
  const results = probed.map(({ l, code }) => ({ l, code, next: nextState(l, code, cfg.failureThreshold) }));

  const rows = results.map(({ l, code, next }) => ({ id: l.id, code, failures: next.failures, prev: l.status, status: next.status, auto: next.autoBroken }));
  // Status only changes if nobody edited the link while it was being checked (prev must still match).
  await db.execute(sql`
    UPDATE links SET check_code = v.code, check_failures = v.failures, checked_at = now(),
      status = CASE WHEN links.status::text = v.prev THEN v.status::link_status ELSE links.status END,
      auto_broken = CASE WHEN links.status::text = v.prev THEN v.auto ELSE links.auto_broken END
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(id int, code int, failures int, prev text, status text, auto boolean)
    WHERE links.id = v.id`);

  const broken = results.filter((r) => r.l.status !== 'broken' && r.next.status === 'broken');
  const restored = results.filter((r) => r.l.status === 'broken' && r.next.status === 'active');
  for (const r of broken) void logActivity(null, 'link.broken', `Link checker flagged “${r.l.title}” as broken (HTTP ${r.code || 'no response'})`);
  for (const r of restored) void logActivity(null, 'link.restored', `“${r.l.title}” is reachable again and was restored`);
  if (broken.length || restored.length) await clearCache();
  return { checked: results.length, broken: broken.length, restored: restored.length };
}
