import { useEffect, useState } from 'react';
import { useSearch } from 'wouter';
import { api, can, download, useApi, useAuth } from '../api';
import { ago, Button, Card, Empty, ErrorNote, Field, Input, linkTone, Modal, notify, PageHeader, Select, Status, Table, Td, Textarea, Toggle, useAction } from '../ui';

// Link directory manager: search and filter, bulk actions, create/edit with thumbnail upload,
// on-demand health checks, and CSV/JSON import/export. Moderators get a read-only view.

export type Cat = { id: number; parentId: number | null; slug: string; name: string; icon: string; color: string; description: string; sortOrder: number; isVisible: boolean; links: number; active: number };
type LinkStatus = 'active' | 'draft' | 'hidden' | 'broken';
type Row = {
  id: number; title: string; url: string; description: string; tags: string[]; status: LinkStatus; isFeatured: boolean;
  imageKey: string | null; categoryId: number; categoryName: string; popularity: number;
  checkCode: number | null; checkFailures: number; checkedAt: string | null; createdAt: string; openReports: number;
};
type ListRes = { items: Row[]; total: number; pageSize: number; mediaUrl: string; uploads: boolean };
const STATUSES: LinkStatus[] = ['active', 'draft', 'hidden', 'broken'];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Category <option>s with subcategories indented under their parent. */
export function CategoryOptions({ cats }: { cats: Cat[] }) {
  const tops = cats.filter((c) => !c.parentId);
  return tops.flatMap((t) => [
    <option key={t.id} value={t.id}>{t.icon} {t.name}</option>,
    ...cats.filter((c) => c.parentId === t.id).map((c) => <option key={c.id} value={c.id}>{'   '}{c.icon} {c.name}</option>),
  ]);
}

export default function Links() {
  const { user } = useAuth();
  const editor = can(user, 'editor');
  const initial = new URLSearchParams(useSearch());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initial.get('status') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim(), 300);
  useEffect(() => setPage(1), [term, status, categoryId, sort]);

  const qs = new URLSearchParams({ page: String(page), sort });
  if (term) qs.set('q', term);
  if (status) qs.set('status', status);
  if (categoryId) qs.set('categoryId', categoryId);
  const list = useApi<ListRes>(`/links?${qs}`);
  const cats = useApi<Cat[]>('/categories');

  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSelected(new Set()), [list.data]);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const { busy, run } = useAction();

  const items = list.data?.items ?? [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = (body: Record<string, unknown>, done: string) =>
    run(() => api('/links/bulk', { json: { ids: [...selected], ...body } }), done).then((ok) => ok && list.reload());

  return (
    <div>
      <PageHeader title="Links" description={list.data ? `${list.data.total} link${list.data.total === 1 ? '' : 's'} match` : undefined}
        actions={editor && (
          <>
            <Button onClick={() => setImporting(true)}>Import</Button>
            <Button onClick={() => run(() => download('/links/export?format=csv', 'omniplay-links.csv'))}>Export CSV</Button>
            <Button onClick={() => run(() => download('/links/export?format=json', 'omniplay-links.json'))}>Export JSON</Button>
            <Button variant="primary" onClick={() => setEditing('new')}>New link</Button>
          </>
        )} />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_160px_220px_150px]">
        <Input type="search" placeholder="Search title, description, tags, domain…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search links" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats.data && <CategoryOptions cats={cats.data} />}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="popular">Most clicked (30d)</option>
          <option value="title">Title A–Z</option>
        </Select>
      </div>

      {editor && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
          <b>{selected.size} selected</b>
          <Select className="w-auto!" value="" disabled={busy} onChange={(e) => e.target.value && bulk({ action: 'status', status: e.target.value }, 'Status updated')} aria-label="Set status">
            <option value="">Set status…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select className="w-auto!" value="" disabled={busy} onChange={(e) => e.target.value && bulk({ action: 'move', categoryId: Number(e.target.value) }, 'Moved')} aria-label="Move to category">
            <option value="">Move to…</option>
            {cats.data && <CategoryOptions cats={cats.data} />}
          </Select>
          <Button disabled={busy} onClick={() => bulk({ action: 'feature' }, 'Featured')}>Feature</Button>
          <Button disabled={busy} onClick={() => bulk({ action: 'unfeature' }, 'Unfeatured')}>Unfeature</Button>
          <Button variant="danger" disabled={busy} onClick={() => confirm(`Delete ${selected.size} links? This can't be undone.`) && bulk({ action: 'delete' }, 'Deleted')}>Delete</Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Card pad={false}>
        <ErrorNote>{list.error}</ErrorNote>
        {list.data && items.length === 0 ? <Empty>No links match these filters.</Empty> : (
          <Table dim={list.loading} head={[
            editor ? <input type="checkbox" aria-label="Select all on this page" checked={items.length > 0 && items.every((i) => selected.has(i.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} /> : '',
            'Link', 'Category', 'Status', 'Health', 'Reports', 'Clicks 30d', '',
          ]}>
            {items.map((l) => (
              <tr key={l.id} className="hover:bg-page/60">
                <Td>{editor && <input type="checkbox" aria-label={`Select ${l.title}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}</Td>
                <Td>
                  <div className="flex items-center gap-2.5">
                    {l.imageKey && list.data?.mediaUrl
                      ? <img src={`${list.data.mediaUrl}/${l.imageKey}-160.webp`} alt="" loading="lazy" className="h-8 w-12 shrink-0 rounded object-cover" />
                      : <span className="grid h-8 w-12 shrink-0 place-items-center rounded bg-page text-xs text-muted">—</span>}
                    <div className="min-w-0">
                      <p className="max-w-[320px] truncate font-medium">{l.title}{l.isFeatured && <span className="ml-1.5 text-xs text-accent">★ featured</span>}</p>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="block max-w-[320px] truncate text-xs text-muted hover:text-accent">{l.url}</a>
                    </div>
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-secondary">{l.categoryName}</Td>
                <Td><Status tone={linkTone[l.status]}>{l.status}</Status></Td>
                <Td className="whitespace-nowrap text-xs text-secondary">
                  {l.checkedAt ? <>{l.checkCode ? `HTTP ${l.checkCode}` : 'no response'}{l.checkFailures > 0 && <span className="text-critical-text"> · {l.checkFailures} fail</span>}<br /><span className="text-muted">{ago(l.checkedAt)}</span></> : <span className="text-muted">not checked</span>}
                </Td>
                <Td>{l.openReports > 0 ? <Status tone="warning">{l.openReports} open</Status> : <span className="text-muted">—</span>}</Td>
                <Td className="tabular-nums">{l.popularity}</Td>
                <Td className="whitespace-nowrap text-right">
                  {editor && (
                    <>
                      <Button variant="ghost" onClick={() => setEditing(l)}>Edit</Button>
                      <Button variant="ghost" onClick={() => run(() => api(`/links/${l.id}/check`, { method: 'POST' }), 'Health check queued').then(() => setTimeout(list.reload, 4000))}>Check</Button>
                      <Button variant="ghost" className="text-critical-text" onClick={() => confirm(`Delete “${l.title}”?`) && run(() => api(`/links/${l.id}`, { method: 'DELETE' }), 'Deleted').then((ok) => ok && list.reload())}>Delete</Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-secondary">
        <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
        <span>Page {page} of {pages}</span>
        <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
      </div>

      {editing && cats.data && (
        <LinkEditor link={editing === 'new' ? null : editing} cats={cats.data} uploads={!!list.data?.uploads} mediaUrl={list.data?.mediaUrl ?? ''}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={list.reload} />}
    </div>
  );
}

function LinkEditor({ link, cats, uploads, mediaUrl, onClose, onSaved }: { link: Row | null; cats: Cat[]; uploads: boolean; mediaUrl: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: link?.title ?? '', url: link?.url ?? 'https://', categoryId: link?.categoryId ?? cats.find((c) => c.parentId)?.id ?? cats[0]?.id ?? 0,
    description: link?.description ?? '', tags: link?.tags.join(', ') ?? '', status: link?.status ?? ('draft' as LinkStatus), isFeatured: link?.isFeatured ?? false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { run } = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError('');
    const body = { ...form, categoryId: Number(form.categoryId), tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      const id = link ? link.id : (await api<{ id: number }>('/links', { json: body })).id;
      if (link) await api(`/links/${id}`, { method: 'PATCH', json: body });
      // Raw bytes, not multipart: the API stores the original in R2 and the worker encodes the variants.
      if (file) await api(`/links/${id}/image`, { method: 'PUT', body: file, type: file.type });
      notify(file ? 'Saved. Image is processing (refresh in a few seconds)' : 'Saved');
      onSaved();
    } catch (e) {
      setError((e as Error).message); // shown inline, next to the form
    } finally {
      setSaving(false);
    }
  };
  const busy = saving;

  return (
    <Modal title={link ? `Edit “${link.title}”` : 'New link'} onClose={onClose} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><Input value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} autoFocus /></Field>
        <Field label="URL" hint="Must start with http:// or https://"><Input type="url" value={form.url} onChange={(e) => set('url', e.target.value)} /></Field>
        <Field label="Category">
          <Select value={form.categoryId} onChange={(e) => set('categoryId', Number(e.target.value))}><CategoryOptions cats={cats} /></Select>
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. free, hd, no-ads (max 12)"><Input value={form.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        <Field label={`Short description (${form.description.length}/280)`} className="sm:col-span-2">
          <Textarea rows={2} maxLength={280} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-secondary">Status</span>
          <div role="radiogroup" aria-label="Status" className="inline-flex overflow-hidden rounded-md border border-line">
            {STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={form.status === s} onClick={() => set('status', s)}
                className={`border-r border-line px-3 py-1.5 text-[13px] capitalize last:border-r-0 ${form.status === s ? 'bg-ink text-white' : 'bg-surface hover:bg-page'}`}>{s}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Only <b>active</b> links appear on the site. The checker flips active ↔ broken automatically.</p>
        </div>
        <Toggle checked={form.isFeatured} onChange={(v) => set('isFeatured', v)} label="Featured (top of grids, the feed and stories)" />
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-secondary">Thumbnail or favicon</span>
          {!uploads ? <p className="text-xs text-muted">Uploads need Cloudflare R2 (set the R2_* variables). Cards show a colour placeholder meanwhile.</p> : (
            <div className="flex items-center gap-3">
              {link?.imageKey && mediaUrl && !file && <img src={`${mediaUrl}/${link.imageKey}-320.webp`} alt="Current thumbnail" className="h-14 w-24 rounded object-cover" />}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
              {link?.imageKey && !file && <Button variant="ghost" onClick={() => run(() => api(`/links/${link.id}/image`, { method: 'DELETE' }), 'Image removed').then((ok) => ok && onSaved())}>Remove image</Button>}
            </div>
          )}
          <p className="mt-1 text-xs text-muted">Max 5 MB. Converted to AVIF + WebP in 4 sizes automatically.</p>
        </div>
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}

type JobRes = { state: string; result: { created: number; updated: number; skipped: number; failed: number; errors: { row: number; error: string }[] } | null; error: string | null };

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'upsert' | 'skip'>('upsert');
  const [job, setJob] = useState<JobRes | null>(null);
  const { busy, run } = useAction();

  const start = () => run(async () => {
    if (!file) throw new Error('Pick a CSV or JSON file first');
    if (file.size > 2_400_000) throw new Error('Files up to ~2.4 MB per import; split bigger ones');
    const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    const { jobId } = await api<{ jobId: string }>('/links/import', { json: { format, mode, content: await file.text() } });
    // The worker does the heavy lifting; poll its job until it settles.
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const j = await api<JobRes>(`/jobs/${jobId}`);
      setJob(j);
      if (j.state === 'completed' || j.state === 'failed') break;
    }
    onDone();
  });

  return (
    <Modal title="Import links" onClose={onClose} wide footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={busy || !file} onClick={start}>{busy ? 'Importing…' : 'Start import'}</Button></>}>
      <p className="text-[13px] text-secondary">
        CSV columns (header row required): <code className="font-mono text-xs">title, url, category, description, tags, status, featured</code>.
        <br />category = the category slug · tags separated by <code>;</code> · status defaults to active · featured = yes/no. The exporter writes this exact format.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="File (.csv or .json)"><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" /></Field>
        <Field label="When a URL already exists">
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'upsert' | 'skip')}>
            <option value="upsert">Update the existing link</option>
            <option value="skip">Skip the row</option>
          </Select>
        </Field>
      </div>
      {job && (
        <div className="mt-4 rounded-md border border-line p-3 text-[13px]">
          {job.state === 'failed' ? <ErrorNote>{job.error}</ErrorNote> : !job.result ? <p className="text-muted">Working… ({job.state})</p> : (
            <>
              <p><Status tone="good">Done</Status> <b>{job.result.created}</b> created · <b>{job.result.updated}</b> updated · <b>{job.result.skipped}</b> skipped · <b>{job.result.failed}</b> rejected</p>
              {job.result.errors.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-auto text-xs text-critical-text">
                  {job.result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
