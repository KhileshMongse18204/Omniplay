import { useState } from 'react';
import { api, useApi } from '../api';
import { ago, Button, Card, Empty, ErrorNote, linkTone, PageHeader, Status, Tabs, useAction } from '../ui';

// User-reports queue. Reports are grouped per link, so one decision clears every report about it.
// Perf: one grouped SQL query per tab, and each decision is a single request however many reports it closes.

type Group = {
  linkId: number; title: string; url: string; linkStatus: keyof typeof linkTone;
  total: number; dead: number; wrongLink: number; malicious: number; lastAt: string; notes: string[] | null;
};
type View = 'open' | 'resolved' | 'dismissed';

export default function Reports() {
  const [view, setView] = useState<View>('open');
  const { data, error, loading, reload } = useApi<Group[]>(`/reports?status=${view}`);
  const { busy, run } = useAction();
  const act = (linkId: number, action: string, msg: string) =>
    run(() => api('/reports/resolve', { json: { linkId, action } }), msg).then((ok) => ok && reload());

  return (
    <div>
      <PageHeader title="Reports" description="Anonymous visitor reports, grouped by link. Malicious reports sort to the top." />
      <Tabs value={view} onChange={setView} tabs={[{ id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }, { id: 'dismissed', label: 'Dismissed' }]} />
      <ErrorNote>{error}</ErrorNote>
      {data && data.length === 0 ? <Card><Empty>{view === 'open' ? 'Inbox zero: no open reports.' : 'Nothing here.'}</Empty></Card> : (
        <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
          {data?.map((g) => (
            <Card key={g.linkId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">{g.title} <Status tone={linkTone[g.linkStatus]}>link {g.linkStatus}</Status></p>
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-muted hover:text-accent">{g.url}</a>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {g.malicious > 0 && <Status tone="critical">{g.malicious} malicious</Status>}
                    {g.dead > 0 && <Status tone="serious">{g.dead} dead</Status>}
                    {g.wrongLink > 0 && <Status tone="warning">{g.wrongLink} wrong link</Status>}
                    <span className="text-xs text-muted">last report {ago(g.lastAt)}</span>
                  </div>
                  {g.notes?.length ? (
                    <ul className="mt-2 space-y-1">{g.notes.map((n, i) => <li key={i} className="border-l-2 border-line pl-2 text-[13px] text-secondary">“{n}”</li>)}</ul>
                  ) : null}
                </div>
                {view === 'open' && (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => act(g.linkId, 'dismiss', 'Dismissed')}>Dismiss</Button>
                    <Button disabled={busy} onClick={() => act(g.linkId, 'resolve', 'Marked resolved')}>Resolved (fixed)</Button>
                    <Button disabled={busy} onClick={() => act(g.linkId, 'mark_broken', 'Link marked broken')}>Mark broken</Button>
                    <Button variant="danger" disabled={busy} onClick={() => act(g.linkId, 'hide', 'Link hidden')}>Hide link</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
