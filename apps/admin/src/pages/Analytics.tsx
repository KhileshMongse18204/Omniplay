import { useState } from 'react';
import { useApi } from '../api';
import { BarList, LineChart } from '../charts';
import { Card, Empty, ErrorNote, fmt, PageHeader, Select, Table, Td } from '../ui';
import { CategoryOptions, type Cat } from './Links';

// Analytics: outbound clicks (by day, by category, top links), search logs (top queries + content gaps)
// and the 10 fastest-growing links. One filter row (date range first) scopes everything below it.

type Clicks = {
  top: { id: number; title: string; url: string; category: string; clicks: number }[];
  byCategory: { categoryId: number; name: string; color: string; clicks: number }[];
  series: { day: string; clicks: number }[];
};
type Searches = { top: { query: string; count: number; results: number }[]; gaps: { query: string; count: number }[] };
type Trend = { id: number; title: string; url: string; category: string; recent: number; previous: number; growth: number };

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** Fill missing days with 0 so the line reads as time, not as a list of active days. */
function daily(series: { day: string; clicks: number }[], from: string, to: string) {
  const byDay = new Map(series.map((s) => [s.day, s.clicks]));
  const out: { day: string; clicks: number }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push({ day: k, clicks: byDay.get(k) ?? 0 });
  }
  return out;
}

export default function Analytics() {
  const [range, setRange] = useState(30);
  const [categoryId, setCategoryId] = useState('');
  // Complete UTC days only: today is still running (its live numbers are on the dashboard).
  const from = day(range);
  const to = day(1);
  const qs = `from=${from}&to=${to}${categoryId ? `&categoryId=${categoryId}` : ''}`;
  const clicks = useApi<Clicks>(`/analytics/clicks?${qs}`);
  const searches = useApi<Searches>(`/analytics/searches?from=${from}&to=${to}`);
  const trending = useApi<Trend[]>('/analytics/trending');
  const cats = useApi<Cat[]>('/categories');
  const series = clicks.data ? daily(clicks.data.series, from, to) : [];
  const total = series.reduce((s, d) => s + d.clicks, 0);

  return (
    <div>
      <PageHeader title="Analytics" description="Complete days (UTC), ending yesterday. Today's live numbers are on the dashboard." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto!" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Date range">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
        <Select className="w-auto!" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats.data && <CategoryOptions cats={cats.data} />}
        </Select>
      </div>
      <ErrorNote>{clicks.error || searches.error || trending.error}</ErrorNote>

      <div className={`grid gap-4 xl:grid-cols-[1.6fr_1fr] ${clicks.loading ? 'opacity-60' : ''}`}>
        <Card title={`Outbound clicks · ${fmt(total)} in ${range} days`}>
          {clicks.data && <LineChart labels={series.map((d) => d.day)} series={[{ name: 'Clicks', values: series.map((d) => d.clicks) }]} />}
        </Card>
        <Card title="Clicks by category">
          {clicks.data?.byCategory.length ? <BarList rows={clicks.data.byCategory.map((c) => ({ key: c.categoryId, label: c.name, value: c.clicks }))} />
            : <Empty>No clicks in this range yet.</Empty>}
        </Card>
      </div>

      <Card title="Most-clicked links" className="mt-4" pad={false}>
        {clicks.data?.top.length ? (
          <Table head={['#', 'Link', 'Category', 'Clicks', 'Share']}>
            {clicks.data.top.map((l, i) => (
              <tr key={l.id}>
                <Td className="text-muted tabular-nums">{i + 1}</Td>
                <Td><p className="font-medium">{l.title}</p><p className="max-w-[340px] truncate text-xs text-muted">{l.url}</p></Td>
                <Td className="text-secondary">{l.category}</Td>
                <Td className="tabular-nums font-semibold">{fmt(l.clicks)}</Td>
                <Td className="tabular-nums text-secondary">{total ? ((l.clicks / total) * 100).toFixed(1) : '0'}%</Td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No clicks in this range yet.</Empty>}
      </Card>

      <div className={`mt-4 grid gap-4 xl:grid-cols-2 ${searches.loading ? 'opacity-60' : ''}`}>
        <Card title="Top searches" pad={false}>
          {searches.data?.top.length ? (
            <Table head={['Query', 'Searches', 'Results']}>
              {searches.data.top.map((s) => (
                <tr key={s.query}><Td className="font-medium">{s.query}</Td><Td className="tabular-nums">{fmt(s.count)}</Td><Td className="tabular-nums text-secondary">{s.results}</Td></tr>
              ))}
            </Table>
          ) : <Empty>No searches logged in this range.</Empty>}
        </Card>
        <Card title="Content gaps · searches with zero results" pad={false}>
          {searches.data?.gaps.length ? (
            <Table head={['Query', 'Searches']}>
              {searches.data.gaps.map((s) => <tr key={s.query}><Td className="font-medium">{s.query}</Td><Td className="tabular-nums">{fmt(s.count)}</Td></tr>)}
            </Table>
          ) : <Empty>No gaps: every search found something.</Empty>}
        </Card>
      </div>

      <Card title="Trending · top 10 fastest-growing links (last 3 days vs the 3 before)" className="mt-4" pad={false}>
        {trending.data?.length ? (
          <Table head={['#', 'Link', 'Category', 'Last 3 days', 'Previous 3 days', 'Growth']}>
            {trending.data.map((t, i) => (
              <tr key={t.id}>
                <Td className="text-muted tabular-nums">{i + 1}</Td>
                <Td className="font-medium">{t.title}</Td>
                <Td className="text-secondary">{t.category}</Td>
                <Td className="tabular-nums">{fmt(t.recent)}</Td>
                <Td className="tabular-nums text-secondary">{fmt(t.previous)}</Td>
                <Td className="tabular-nums text-good-text">▲ {(t.growth * 100).toFixed(0)}%</Td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Not enough click history yet. Trending needs at least 5 clicks per link in 3 days.</Empty>}
      </Card>
    </div>
  );
}
