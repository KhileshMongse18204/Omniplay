import { useEffect, useState, type ReactNode } from 'react';
import { API, api, useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Field, fmt, Input, notify, PageHeader, Select, Status, Table, Tabs, Td, Textarea, Toggle, useAction } from '../ui';

// System settings, one tab per group. Each tab edits a local draft and PATCHes only its own group.
// Secret fields come back masked: leave the dots to keep the saved value, or clear the field to remove it.

type Obj = Record<string, any>; // settings JSON; the API validates every field
type GroupId = 'apis' | 'performance' | 'seo' | 'automation' | 'security';

function setIn(obj: Obj, path: string[], value: unknown): Obj {
  const [k, ...rest] = path;
  return { ...obj, [k]: rest.length ? setIn(obj[k] ?? {}, rest, value) : value };
}

function useGroup(all: Obj | null, group: GroupId, onSaved: (v: Obj) => void) {
  const [draft, setDraft] = useState<Obj | null>(null);
  useEffect(() => { if (all) setDraft(all[group]); }, [all, group]);
  const { busy, run } = useAction();
  const set = (path: string, value: unknown) => setDraft((d) => setIn(d ?? {}, path.split('.'), value));
  const save = () => run(async () => onSaved(await api<Obj>(`/settings/${group}`, { method: 'PATCH', json: draft })), 'Settings saved');
  return { draft, set, save, busy };
}

function TestButton({ provider, label = 'Test connection' }: { provider: string; label?: string }) {
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try { setRes(await api(`/settings/test/${provider}`, { method: 'POST' })); } catch (e) { setRes({ ok: false, message: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button disabled={busy} onClick={test}>{busy ? 'Testing…' : label}</Button>
      {res && <Status tone={res.ok ? 'good' : 'critical'}>{res.message}</Status>}
    </span>
  );
}

const Secret = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <Input type="password" autoComplete="off" value={value ?? ''} placeholder="Not set" onChange={(e) => onChange(e.target.value)} />
);
const secretHint = 'Saved keys show as dots. Leave them to keep the key, or clear the field to remove it.';
const num = (v: string) => (v === '' ? 0 : Number(v));

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card title={title} className="mb-4">
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
      {footer && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">{footer}</div>}
    </Card>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<GroupId>('apis');
  const { data, error, reload } = useApi<Obj>('/settings');
  const [all, setAll] = useState<Obj | null>(null);
  useEffect(() => setAll(data), [data]);
  const onSaved = (group: GroupId) => (v: Obj) => setAll((a) => ({ ...a, [group]: v }));

  return (
    <div>
      <PageHeader title="Settings" description="Owner only. Changes apply across the API and worker within ~10 seconds." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'apis', label: 'External APIs' }, { id: 'performance', label: 'Caching & performance' }, { id: 'seo', label: 'SEO & analytics' },
        { id: 'automation', label: 'Cron jobs & automation' }, { id: 'security', label: 'Security & access' },
      ]} />
      <ErrorNote>{error}</ErrorNote>
      {all && (
        <>
          {tab === 'apis' && <ApisTab all={all} onSaved={onSaved('apis')} />}
          {tab === 'performance' && <PerformanceTab all={all} onSaved={onSaved('performance')} />}
          {tab === 'seo' && <SeoTab all={all} onSaved={onSaved('seo')} />}
          {tab === 'automation' && <AutomationTab all={all} onSaved={onSaved('automation')} />}
          {tab === 'security' && <SecurityTab all={all} onSaved={onSaved('security')} reload={reload} />}
        </>
      )}
    </div>
  );
}

type TabProps = { all: Obj; onSaved: (v: Obj) => void };

function ApisTab({ all, onSaved }: TabProps) {
  const { draft: d, set, save, busy } = useGroup(all, 'apis', onSaved);
  if (!d) return null;
  return (
    <>
      <Section title="Metadata providers" footer={<><Button variant="primary" disabled={busy} onClick={save}>Save</Button><span className="text-xs text-muted">Save first, then test.</span></>}>
        <Field label="TMDB API key or v4 read token" hint={secretHint}><Secret value={d.tmdbKey} onChange={(v) => set('tmdbKey', v)} /></Field>
        <div className="self-end pb-5"><TestButton provider="tmdb" /></div>
        <Field label="RAWG API key"><Secret value={d.rawgKey} onChange={(v) => set('rawgKey', v)} /></Field>
        <div className="self-end"><TestButton provider="rawg" /></div>
      </Section>
      <Section title="Link shortener" footer={<><Button variant="primary" disabled={busy} onClick={save}>Save</Button><TestButton provider="shortener" /></>}>
        <Field label="Provider">
          <Select value={d.shortener.provider} onChange={(e) => set('shortener.provider', e.target.value)}>
            <option value="bitly">Bitly</option>
            <option value="custom">Custom endpoint</option>
          </Select>
        </Field>
        <Field label="API key" hint={secretHint}><Secret value={d.shortener.apiKey} onChange={(v) => set('shortener.apiKey', v)} /></Field>
        {d.shortener.provider === 'custom' && (
          <Field label="Endpoint (tested with GET + Bearer key)" className="md:col-span-2"><Input value={d.shortener.endpoint} onChange={(e) => set('shortener.endpoint', e.target.value)} placeholder="https://short.example.com/api/me" /></Field>
        )}
      </Section>
    </>
  );
}

function PerformanceTab({ all, onSaved }: TabProps) {
  const { draft: d, set, save, busy } = useGroup(all, 'performance', onSaved);
  const { busy: acting, run } = useAction();
  const [urls, setUrls] = useState('');
  const [pattern, setPattern] = useState('cache:*');
  const [keys, setKeys] = useState<{ keys: { key: string; ttl: number }[]; truncated: boolean } | null>(null);
  if (!d) return null;
  const list = () => run(async () => setKeys(await api(`/system/cache-keys?pattern=${encodeURIComponent(pattern)}`)));
  return (
    <>
      <Section title="Cloudflare" footer={<><Button variant="primary" disabled={busy} onClick={save}>Save</Button><TestButton provider="cloudflare" /></>}>
        <Field label="Zone ID"><Input value={d.cloudflare.zoneId} onChange={(e) => set('cloudflare.zoneId', e.target.value)} /></Field>
        <Field label="API token (Zone → Cache Purge permission)" hint={secretHint}><Secret value={d.cloudflare.apiToken} onChange={(v) => set('cloudflare.apiToken', v)} /></Field>
      </Section>
      <Card title="Purge the CDN cache" className="mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <Button variant="danger" disabled={acting} onClick={() => confirm('Purge EVERYTHING from Cloudflare? The VPS will see a traffic spike while the cache refills.') && run(() => api('/system/cdn-purge', { json: {} }), 'Cloudflare cache purged')}>Purge everything</Button>
          <div className="min-w-[260px] flex-1">
            <Textarea rows={3} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={'One full URL per line (max 30)\nhttps://api.example.com/v1/bootstrap'} aria-label="URLs to purge" />
            <Button className="mt-2" disabled={acting || !urls.trim()} onClick={() => run(() => api('/system/cdn-purge', { json: { urls: urls.split('\n').map((u) => u.trim()).filter(Boolean) } }), 'URLs purged')}>Purge these URLs</Button>
          </div>
        </div>
      </Card>
      <Section title="Pagination limits" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <Field label="Public grid page size (6–96)"><Input type="number" min={6} max={96} value={d.publicPageSize} onChange={(e) => set('publicPageSize', num(e.target.value))} /></Field>
        <Field label="Admin table page size (10–200)"><Input type="number" min={10} max={200} value={d.adminPageSize} onChange={(e) => set('adminPageSize', num(e.target.value))} /></Field>
      </Section>
      <Card title="Redis response cache" className="mb-4">
        <p className="mb-3 text-[13px] text-secondary">Cached API responses live under <code className="font-mono text-xs">cache:</code>. Edits already clear them automatically; use this for a targeted reset.</p>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-sm font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Key pattern" />
          <Button disabled={acting} onClick={list}>List keys</Button>
          <Button variant="danger" disabled={acting} onClick={() => run(async () => { const r = await api<{ removed: number }>('/system/cache-keys', { method: 'DELETE', json: { pattern } }); notify(`Cleared ${r.removed} key(s)`); setKeys(null); })}>Clear matching</Button>
        </div>
        {keys && (keys.keys.length === 0 ? <Empty>No keys match.</Empty> : (
          <div className="mt-3 max-h-72 overflow-auto">
            <Table head={['Key', 'TTL']}>
              {keys.keys.map((k) => <tr key={k.key}><Td className="break-all font-mono text-xs">{k.key}</Td><Td className="tabular-nums text-secondary">{k.ttl}s</Td></tr>)}
            </Table>
            {keys.truncated && <p className="mt-2 text-xs text-muted">Showing the first 500 keys.</p>}
          </div>
        ))}
      </Card>
    </>
  );
}

function SeoTab({ all, onSaved }: TabProps) {
  const { draft: d, set, save, busy } = useGroup(all, 'seo', onSaved);
  const { busy: acting, run } = useAction();
  if (!d) return null;
  return (
    <>
      <Section title="Global meta tags" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <Field label="Site URL (sitemap + robots.txt)"><Input value={d.siteUrl} onChange={(e) => set('siteUrl', e.target.value)} placeholder="https://omniplay.example" /></Field>
        <Field label="Social preview image URL"><Input value={d.ogImage} onChange={(e) => set('ogImage', e.target.value)} /></Field>
        <Field label="Title" className="md:col-span-2"><Input value={d.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Description" className="md:col-span-2"><Textarea rows={2} maxLength={300} value={d.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </Section>
      <Section title="Tracking scripts" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <Field label="Injected into <head>" hint="Loaded after the page is interactive (browser idle), so tags never slow the first paint.">
          <Textarea rows={6} className="font-mono text-xs" value={d.headScripts} onChange={(e) => set('headScripts', e.target.value)} placeholder="<script async src=…></script>" />
        </Field>
        <Field label="Injected at the end of <body>"><Textarea rows={6} className="font-mono text-xs" value={d.bodyScripts} onChange={(e) => set('bodyScripts', e.target.value)} /></Field>
      </Section>
      <Section title="ads.txt" footer={<><Button variant="primary" disabled={busy} onClick={save}>Save</Button><a className="text-xs text-accent" href={`${API}/ads.txt`} target="_blank" rel="noreferrer">View served ads.txt ↗</a></>}>
        <Field label="ads.txt content" className="md:col-span-2"><Textarea rows={6} className="font-mono text-xs" value={d.adsTxt} onChange={(e) => set('adsTxt', e.target.value)} placeholder="google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0" /></Field>
      </Section>
      <Card title="Sitemap">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={acting} onClick={() => run(() => api('/system/sitemap', { method: 'POST' }), 'Sitemap regeneration queued')}>Generate sitemap now</Button>
          <a className="text-xs text-accent" href={`${API}/sitemap.xml`} target="_blank" rel="noreferrer">View sitemap.xml ↗</a>
          <a className="text-xs text-accent" href={`${API}/robots.txt`} target="_blank" rel="noreferrer">View robots.txt ↗</a>
          <span className="text-xs text-muted">Also rebuilt daily at 04:00 UTC.</span>
        </div>
      </Card>
    </>
  );
}

type Backup = { key: string; size: number; lastModified: string };

function AutomationTab({ all, onSaved }: TabProps) {
  const { draft: d, set, save, busy } = useGroup(all, 'automation', onSaved);
  const { busy: acting, run } = useAction();
  const backups = useApi<Backup[]>('/system/backups');
  if (!d) return null;
  const lc = d.linkCheck;
  const n = (path: string, label: string, min: number, max: number, hint?: string) => (
    <Field label={label} hint={hint}><Input type="number" min={min} max={max} value={Number(path.split('.').reduce<Obj>((o, k) => o[k], d))} onChange={(e) => set(path, num(e.target.value))} /></Field>
  );
  return (
    <>
      <Section title="Broken-link checker" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <div className="md:col-span-2"><Toggle checked={lc.enabled} onChange={(v) => set('linkCheck.enabled', v)} label="Check links automatically" /></div>
        {n('linkCheck.everyMinutes', 'Run every (minutes)', 5, 1440)}
        {n('linkCheck.batchSize', 'Batch size (links per run)', 5, 500)}
        {n('linkCheck.concurrency', 'Parallel requests', 1, 32, 'Keep it low on a small VPS.')}
        {n('linkCheck.timeoutMs', 'Timeout per link (ms)', 2000, 30_000)}
        {n('linkCheck.recheckHours', 'Re-check each link every (hours)', 1, 168)}
        {n('linkCheck.failureThreshold', 'Failures before flagging broken', 1, 20, 'Consecutive failed checks. Broken links come back automatically when they recover.')}
      </Section>
      <Section title="Database backups" footer={<><Button variant="primary" disabled={busy} onClick={save}>Save</Button><Button disabled={acting} onClick={() => run(() => api('/system/backup', { method: 'POST' }), 'Backup started').then(() => setTimeout(backups.reload, 5000))}>Back up now</Button></>}>
        <div className="md:col-span-2"><Toggle checked={d.backups.enabled} onChange={(v) => set('backups.enabled', v)} label="Scheduled backups to Cloudflare R2" /></div>
        <Field label="Schedule (cron, UTC)" hint="e.g. 0 3 * * * = every day at 03:00"><Input className="font-mono" value={d.backups.cron} onChange={(e) => set('backups.cron', e.target.value)} /></Field>
        {n('backups.keep', 'Keep the newest', 1, 90)}
      </Section>
      <Card title="Stored backups" pad={false}>
        {backups.data?.length ? (
          <Table head={['File', 'Size', 'Created']}>
            {backups.data.map((b) => <tr key={b.key}><Td className="font-mono text-xs">{b.key}</Td><Td className="tabular-nums">{fmt(Math.round(b.size / 1024))} KB</Td><Td className="text-secondary">{new Date(b.lastModified).toLocaleString()}</Td></tr>)}
          </Table>
        ) : <Empty>No backups yet (they need Cloudflare R2 configured).</Empty>}
      </Card>
    </>
  );
}

function SecurityTab({ all, onSaved }: TabProps & { reload: () => void }) {
  const { draft: d, set, save, busy } = useGroup(all, 'security', onSaved);
  if (!d) return null;
  const r = d.registration;
  return (
    <>
      <Section title="Maintenance mode" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <div className="md:col-span-2">
          <Toggle checked={d.maintenance.enabled} onChange={(v) => set('maintenance.enabled', v)} label="Show the maintenance notice instead of the site" />
          {d.maintenance.enabled && <p className="mt-1 text-xs text-muted">Visitors may see the old page for up to a minute (edge cache). Purge the CDN for an instant switch.</p>}
        </div>
        <Field label="Message" className="md:col-span-2"><Input value={d.maintenance.message} maxLength={300} onChange={(e) => set('maintenance.message', e.target.value)} /></Field>
      </Section>
      <Section title="Rate limits (per visitor IP)" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <Field label="Public API requests per minute"><Input type="number" min={30} max={10_000} value={d.rateLimits.publicPerMinute} onChange={(e) => set('rateLimits.publicPerMinute', num(e.target.value))} /></Field>
        <Field label="Searches per minute"><Input type="number" min={5} max={1000} value={d.rateLimits.searchPerMinute} onChange={(e) => set('rateLimits.searchPerMinute', num(e.target.value))} /></Field>
        <Field label="Link reports per hour"><Input type="number" min={1} max={100} value={d.rateLimits.reportsPerHour} onChange={(e) => set('rateLimits.reportsPerHour', num(e.target.value))} /></Field>
        <Field label="Admin sign-in attempts per 15 min"><Input type="number" min={3} max={100} value={d.rateLimits.loginPer15Min} onChange={(e) => set('rateLimits.loginPer15Min', num(e.target.value))} /></Field>
      </Section>
      <Section title="Registration rules (staff accounts)" footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
        <div className="md:col-span-2 space-y-1">
          <Toggle checked={r.openSignup} onChange={(v) => set('registration.openSignup', v)} label="Allow staff to sign up at /register (otherwise invite-only)" />
          <Toggle checked={r.requireApproval} onChange={(v) => set('registration.requireApproval', v)} label="New sign-ups need owner approval" />
        </div>
        <Field label="Allowed email domains" hint="Comma separated, e.g. mystudio.com. Empty = any domain.">
          <Input value={r.allowedDomains.join(', ')} onChange={(e) => set('registration.allowedDomains', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
        </Field>
        <Field label="Role for new sign-ups">
          <Select value={r.defaultRole} onChange={(e) => set('registration.defaultRole', e.target.value)}>
            <option value="moderator">Moderator (reports queue)</option>
            <option value="editor">Editor (content + analytics)</option>
          </Select>
        </Field>
      </Section>
      <Section title="SMTP (invites and notifications)" footer={<><Button variant="primary" disabled={busy} onClick={save}>Save</Button><TestButton provider="smtp" /></>}>
        <Field label="Host"><Input value={d.smtp.host} onChange={(e) => set('smtp.host', e.target.value)} placeholder="smtp.example.com" /></Field>
        <Field label="Port"><Input type="number" min={1} max={65535} value={d.smtp.port} onChange={(e) => set('smtp.port', num(e.target.value))} /></Field>
        <Field label="Username"><Input value={d.smtp.user} autoComplete="off" onChange={(e) => set('smtp.user', e.target.value)} /></Field>
        <Field label="Password" hint={secretHint}><Secret value={d.smtp.pass} onChange={(v) => set('smtp.pass', v)} /></Field>
        <Field label="From address"><Input value={d.smtp.from} onChange={(e) => set('smtp.from', e.target.value)} placeholder="OmniPlay <no-reply@example.com>" /></Field>
        <div className="self-end pb-2"><Toggle checked={d.smtp.secure} onChange={(v) => set('smtp.secure', v)} label="TLS from the start (port 465)" /></div>
      </Section>
    </>
  );
}

