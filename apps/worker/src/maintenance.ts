import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import { logActivity } from '@omniplay/core/activity';
import { clearCache } from '@omniplay/core/cache';
import { db } from '@omniplay/core/db';
import { env } from '@omniplay/core/env';
import { createMailer } from '@omniplay/core/mail';
import { K, dayKey, redis } from '@omniplay/core/redis';
import { getSettings } from '@omniplay/core/settings';
import { deleteObject, listObjects, putObject } from '@omniplay/core/storage';

// Sitemap, database backups and email: slow or bursty work that must never run inside an HTTP request.

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Builds sitemap.xml once and stores it in Redis; the API serves the stored string (and Cloudflare caches it). */
export async function buildSitemap(): Promise<{ urls: number }> {
  const base = (await getSettings('seo')).siteUrl.replace(/\/$/, '');
  const cats = await db.execute<{ slug: string }>(sql`
    SELECT c.slug FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
    WHERE c.is_visible AND (p.id IS NULL OR p.is_visible) ORDER BY c.sort_order, c.id`);
  const today = dayKey();
  const urls = [`${base}/`, `${base}/feed`, ...[...cats].map((c) => `${base}/c/${c.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  await redis.set(K.sitemap, xml);
  await clearCache(`cache:/sitemap.xml*`);
  return { urls: urls.length };
}

const run = promisify(execFile);

/**
 * pg_dump (custom format, already compressed) → R2 → keep the newest N. pg_dump connects to Postgres
 * directly, not through PgBouncer, because it needs one consistent snapshot in a real session.
 */
export async function backupDatabase(): Promise<{ key: string; bytes: number }> {
  const { keep } = (await getSettings('automation')).backups;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(tmpdir(), `omniplay-${stamp}.dump`);
  try {
    await run('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', '--file', file, env.directDatabaseUrl], { maxBuffer: 1 << 20 });
    // shortcut: the dump is read into memory before upload; fine for a link directory (MBs), stream it if the DB passes ~100 MB.
    const body = await readFile(file);
    const key = `backups/omniplay-${stamp}.dump`;
    await putObject(key, body, 'application/octet-stream', 'no-store');
    const all = (await listObjects('backups/')).sort((a, b) => b.key.localeCompare(a.key));
    await Promise.all(all.slice(keep).map((o) => deleteObject(o.key)));
    void logActivity(null, 'backup.done', `Database backup saved (${(body.length / 1024).toFixed(0)} KB, keeping ${keep})`);
    return { key, bytes: body.length };
  } catch (err) {
    void logActivity(null, 'backup.failed', `Database backup failed: ${(err as Error).message.slice(0, 200)}`);
    throw err;
  } finally {
    await rm(file, { force: true });
  }
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ sent: true }> {
  const smtp = (await getSettings('security')).smtp;
  if (!smtp.host) throw new Error('SMTP is not configured');
  await createMailer(smtp).sendMail({ from: smtp.from || smtp.user, to, subject, text });
  return { sent: true };
}
