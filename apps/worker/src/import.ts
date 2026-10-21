import { inArray, sql } from 'drizzle-orm';
import { logActivity } from '@omniplay/core/activity';
import { clearCache } from '@omniplay/core/cache';
import { parseCsv } from '@omniplay/core/csv';
import { db } from '@omniplay/core/db';
import { isHttpUrl, normalizeTags, searchText } from '@omniplay/core/links';
import { categories, links } from '@omniplay/core/schema';

// Bulk importer. Same columns as the exporter: title, url, category (slug), description, tags (";"-separated),
// status, featured. Category slugs and existing URLs are resolved with one query each, inserts go in
// chunks of 500 rows, and updates are one jsonb_to_recordset UPDATE per chunk. No per-row queries.

const STATUSES = ['active', 'draft', 'hidden', 'broken'] as const;
type Status = (typeof STATUSES)[number];
type Row = { title: string; url: string; categoryId: number; description: string; tags: string[]; status: Status; isFeatured: boolean; searchText: string };

const truthy = (v: unknown) => ['1', 'true', 'yes', 'y'].includes(String(v ?? '').trim().toLowerCase());
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

function records(format: 'csv' | 'json', content: string): Record<string, unknown>[] {
  if (format === 'json') {
    const data = JSON.parse(content) as unknown;
    if (!Array.isArray(data)) throw new Error('JSON import must be an array of objects');
    return data as Record<string, unknown>[];
  }
  const [header = [], ...rows] = parseCsv(content);
  const cols = header.map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ''])));
}

export async function importLinks(format: 'csv' | 'json', content: string, mode: 'upsert' | 'skip', actorId: number) {
  const input = records(format, content);
  if (input.length > 20_000) throw new Error('Import at most 20,000 rows at a time');

  const cats = new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]));
  const errors: { row: number; error: string }[] = [];
  const valid: Row[] = [];
  input.forEach((r, i) => {
    const row = i + 2; // spreadsheet row number (header is row 1)
    const title = String(r.title ?? '').trim().slice(0, 120);
    const url = String(r.url ?? '').trim();
    const categoryId = cats.get(String(r.category ?? '').trim().toLowerCase());
    const status = (String(r.status ?? '').trim().toLowerCase() || 'active') as Status;
    const fail = (error: string) => { if (errors.length < 100) errors.push({ row, error }); };
    if (!title) return fail('title is empty');
    if (!isHttpUrl(url)) return fail('url must start with http:// or https://');
    if (!categoryId) return fail(`unknown category "${String(r.category ?? '')}"`);
    if (!STATUSES.includes(status)) return fail(`status must be one of ${STATUSES.join(', ')}`);
    const tags = normalizeTags(Array.isArray(r.tags) ? r.tags.map(String) : String(r.tags ?? '').split(/[;,]/));
    const description = String(r.description ?? '').trim().slice(0, 280);
    valid.push({ title, url, categoryId, description, tags, status, isFeatured: truthy(r.featured), searchText: searchText({ title, description, tags, url }) });
  });

  const existing = new Map<string, number>();
  for (const part of chunks([...new Set(valid.map((v) => v.url))], 1000)) {
    for (const l of await db.select({ id: links.id, url: links.url }).from(links).where(inArray(links.url, part))) existing.set(l.url, l.id);
  }
  const seen = new Set<string>(); // first occurrence wins for duplicate URLs inside the file
  const fresh = valid.filter((v) => !existing.has(v.url) && !seen.has(v.url) && seen.add(v.url));
  const updates = mode === 'upsert' ? valid.filter((v) => existing.has(v.url)).map((v) => ({ ...v, id: existing.get(v.url)! })) : [];

  for (const part of chunks(fresh, 500)) await db.insert(links).values(part);
  for (const part of chunks(updates, 500)) {
    await db.execute(sql`
      UPDATE links SET title = v.title, category_id = v."categoryId", description = v.description,
        tags = ARRAY(SELECT jsonb_array_elements_text(v.tags)), status = v.status::link_status,
        is_featured = v."isFeatured", search_text = v."searchText", updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
        AS v(id int, title text, "categoryId" int, description text, tags jsonb, status text, "isFeatured" boolean, "searchText" text)
      WHERE links.id = v.id`);
  }

  const result = {
    created: fresh.length,
    updated: updates.length,
    skipped: valid.length - fresh.length - updates.length,
    failed: input.length - valid.length,
    errors,
  };
  await clearCache();
  void logActivity(actorId, 'link.import', `Imported links: ${result.created} new, ${result.updated} updated, ${result.failed} rejected`);
  return result;
}
