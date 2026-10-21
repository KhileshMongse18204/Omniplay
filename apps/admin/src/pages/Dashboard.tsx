import { useEffect } from 'react';
import { Link } from 'wouter';
import { api, can, useApi, useAuth } from '../api';
import { LineChart, Sparkline } from '../charts';
import { ago, Button, Card, Empty, ErrorNote, fmt, PageHeader, Status, useAction } from '../ui';

// Dashboard: KPI tiles (today vs yesterday + 14-day trend), content counts, a traffic chart, system health
// with broken-link alerts, and the activity feed. One API call; it refreshes itself every minute.

type Day = { day: string; pageviews: number; visitors: number; clicks: number; searches: number };
type Run = { at: string; [k: string]: unknown } | null;
type Dash = {
  metrics: { links: number; active: number; broken: number; drafts: number; categories: number; openReports: number };
  health: {
    dbMs: number | null; redisMs: number | null; redisMemory: { used: string; max: string };
    jobs: { wait?: number; active?: number; delayed?: number; failed?: number };
    lastLinkCheck: Run; lastBackup: Run; lastSitemap: Run; lastFlush: Run;
    alerts: { id: number; title: string; url: string; status: string; code: number | null; failures: number; checkedAt: string | null }[];
  };
  traffic: Day[];
  activity: { id: number; action: string; summary: string; at: string; actor: string | null }[];
};

/**
 * Today is still running, so a % change against a full yesterday would always look like a crash.
 * The tile shows today live, yesterday's total for context, and a sparkline of complete days only.
 */
function Kpi({ label, today, history }: { label: string; today: number; history: number[] }) {
  const yesterday = history[history.length - 1];
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-secondary">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <p className="text-[26px] font-semibold leading-none">{fmt(today)}</p>
          <p className="mt-1.5 text-xs text-muted">{yesterday === undefined ? 'No data for yesterday' : `Yesterday ${fmt(yesterday)}`}</p>
        </div>
        <Sparkline values={history} />
      </div>
    </div>
  );
}

function Count({ label, value, tone, href }: { label: string; value: string | number; tone?: 'good' | 'warning' | 'critical'; href?: string }) {
  const body = (
    <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-baseline">
      <span className="text-xs text-secondary">{label}</span>
      <span className="flex items-center gap-2">
        {tone && <Status tone={tone}>{tone === 'good' ? 'OK' : 'Needs a look'}</Status>}
        <b className="text-lg font-semibold">{value}</b>
      </span>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const latency = (ms: number | null) => ms === null ? <Status tone="critical">Down</Status> : <Status tone={ms < 50 ? 'good' : ms < 250 ? 'warning' : 'serious'}>{ms} ms</Status>;
const freshness = (run: Run, okMinutes: number, never = 'Never ran') => {
  if (!run) return <Status tone="warning">{never}</Status>;
  const mins = (Date.now() - new Date(run.at).getTime()) / 60_000;
  return <Status tone={mins <= okMinutes ? 'good' : 'warning'}>{ago(run.at)}</Status>;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Dash>('/dashboard');
  const { run } = useAction();
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-muted">Loading…</p>;
  const { metrics: m, health: h } = data;
  const today = data.traffic[data.traffic.length - 1];
  const t = data.traffic.slice(0, -1); // complete days only
  const failed = h.jobs.failed ?? 0;

  return (
    <div className={loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <PageHeader title="Dashboard" description="Today's numbers are live (UTC day). Everything else refreshes every minute."
        actions={<Button onClick={reload}>Refresh</Button>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Pageviews today" today={today.pageviews} history={t.map((d) => d.pageviews)} />
        <Kpi label="Unique visitors today" today={today.visitors} history={t.map((d) => d.visitors)} />
        <Kpi label="Outbound clicks today" today={today.clicks} history={t.map((d) => d.clicks)} />
        <Kpi label="Searches today" today={today.searches} history={t.map((d) => d.searches)} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Count label="Active links" value={`${m.active} / ${m.links}`} />
        <Count label="Broken links" value={m.broken} tone={m.broken ? 'critical' : 'good'} href="/links?status=broken" />
        <Count label="Open reports" value={m.openReports} tone={m.openReports ? 'warning' : 'good'} href="/reports" />
        <Count label="Drafts" value={m.drafts} href="/links?status=draft" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Card title="Traffic · last 14 complete days">
          <LineChart labels={t.map((d) => d.day)} series={[
            { name: 'Pageviews', values: t.map((d) => d.pageviews) },
            { name: 'Visitors', values: t.map((d) => d.visitors) },
          ]} />
        </Card>
        <Card title="System health">
          <dl className="divide-y divide-line text-[13px]">
            {[
              ['Database', latency(h.dbMs)],
              ['Redis', <span className="flex items-center gap-2">{latency(h.redisMs)}<span className="text-xs text-muted">{h.redisMemory.used} of {h.redisMemory.max}</span></span>],
              ['Job queue', <span className="flex items-center gap-2 text-xs text-secondary">{h.jobs.wait ?? 0} waiting · {h.jobs.active ?? 0} running{failed ? <Status tone="critical">{failed} failed</Status> : null}</span>],
              ['Stats flush (worker alive?)', freshness(h.lastFlush, 5, 'Worker not running')],
              ['Link checker', freshness(h.lastLinkCheck, 24 * 60)],
              ['Database backup', freshness(h.lastBackup, 26 * 60, 'No backup yet')],
              ['Sitemap', freshness(h.lastSitemap, 26 * 60)],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between gap-3 py-2"><dt className="text-secondary">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Broken-link alerts" actions={<Link href="/links?status=broken" className="text-xs text-accent">All broken links →</Link>}>
          {h.alerts.length === 0 ? <Empty>No failing links. The checker is happy.</Empty> : (
            <ul className="divide-y divide-line">
              {h.alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  {a.status === 'broken' ? <Status tone="critical">Broken</Status> : <Status tone="warning">Failing ×{a.failures}</Status>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.title}</p>
                    <p className="truncate text-xs text-muted">{a.url} · {a.code ? `HTTP ${a.code}` : 'no response'} · checked {ago(a.checkedAt)}</p>
                  </div>
                  {can(user, 'editor') && <Button onClick={() => run(() => api(`/links/${a.id}/check`, { method: 'POST' }), 'Re-check queued')}>Re-check</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent activity">
          {data.activity.length === 0 ? <Empty>Nothing yet.</Empty> : (
            <ul className="divide-y divide-line">
              {data.activity.map((a) => (
                <li key={a.id} className="flex gap-3 py-2 text-[13px]">
                  <span className="w-20 shrink-0 text-xs text-muted">{ago(a.at)}</span>
                  <span className="min-w-0"><b className="font-medium">{a.actor ?? 'System'}</b> <span className="text-secondary">· {a.summary}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
