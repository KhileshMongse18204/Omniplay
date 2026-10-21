import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmt } from './ui';

// Hand-rolled SVG charts (no chart library in the bundle), following the data-viz rules: 2px lines,
// hairline grid, one y-axis, crosshair + one tooltip listing every series, keyboard access, a table view,
// a legend for 2+ series, and text in ink tokens (never in the series colour).

export const SERIES = ['#2a78d6', '#eb6834']; // validated categorical slots 1–2 (light surface)
const INK = { grid: '#e1e0d9', base: '#c3c2b7', muted: '#898781', surface: '#ffffff' };

type Series = { name: string; values: number[] };

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function LineChart({ labels, series, height = 220, unit = '' }: { labels: string[]; series: Series[]; height?: number; unit?: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const n = labels.length;
  const multi = series.length > 1;
  const pad = { l: 40, r: multi ? 78 : 14, t: 10, b: 24 };
  const step = niceStep(Math.max(1, ...series.flatMap((s) => s.values)) / 4);
  const max = step * 4;
  const plotW = Math.max(1, width - pad.l - pad.r);
  const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  // X labels: evenly spaced, counted back from the newest day so the last label never collides with a regular tick.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 70))));
  const showTick = (i: number) => (n - 1 - i) % every === 0;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - pad.l) / plotW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
  };

  // Direct end-labels only when they don't collide; otherwise the legend carries identity.
  const ends = series.map((s) => y(s.values[n - 1] ?? 0));
  const endLabels = multi && series.length <= 4 && ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a - b) >= 14));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        {multi ? (
          <ul className="flex flex-wrap gap-4 text-xs text-secondary">
            {series.map((s, i) => (
              <li key={s.name} className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded" style={{ background: SERIES[i] }} />{s.name}</li>
            ))}
          </ul>
        ) : <span />}
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-accent hover:underline">{table ? 'View chart' : 'View as table'}</button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5 text-left font-medium">Day</th>{series.map((s) => <th key={s.name} className="py-1.5 text-right font-medium">{s.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {labels.map((d, i) => <tr key={d}><td className="py-1">{shortDate(d)}</td>{series.map((s) => <td key={s.name} className="py-1 text-right">{fmt(s.values[i] ?? 0)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          {width > 0 && (
            <svg width={width} height={height} role="img" tabIndex={0} aria-label={`${series.map((s) => s.name).join(' and ')} by day. Use the arrow keys to read values.`}
              onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)} className="touch-none outline-none">
              {[0, 1, 2, 3, 4].map((k) => (
                <g key={k}>
                  <line x1={pad.l} x2={width - pad.r} y1={y(k * step)} y2={y(k * step)} stroke={k ? INK.grid : INK.base} strokeWidth={1} />
                  <text x={pad.l - 6} y={y(k * step)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted} className="tabular-nums">{fmt(k * step)}</text>
                </g>
              ))}
              {labels.map((d, i) => showTick(i) && (
                <text key={d} x={x(i)} y={height - 6} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize={11} fill={INK.muted}>{shortDate(d)}</text>
              ))}
              {!multi && series[0] && (
                <path d={`${line(series[0].values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={SERIES[0]} fillOpacity={0.1} />
              )}
              {series.map((s, i) => (
                <g key={s.name}>
                  <path d={line(s.values)} fill="none" stroke={SERIES[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={SERIES[i]} stroke={INK.surface} strokeWidth={2} />
                  {endLabels && <text x={x(n - 1) + 8} y={ends[i]} dy="0.32em" fontSize={11} fill="#52514e">{s.name}</text>}
                </g>
              ))}
              {hover !== null && (
                <g pointerEvents="none">
                  <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke={INK.base} strokeWidth={1} />
                  {series.map((s, i) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={SERIES[i]} stroke={INK.surface} strokeWidth={2} />)}
                </g>
              )}
            </svg>
          )}
          {hover !== null && (
            <div role="status" className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
              style={x(hover) > width * 0.6 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}>
              <p className="mb-1 text-muted">{shortDate(labels[hover])}</p>
              {series.map((s, i) => (
                <p key={s.name} className="flex items-center gap-2 whitespace-nowrap">
                  <span className="h-0.5 w-3 rounded" style={{ background: SERIES[i] }} />
                  <b className="tabular-nums text-ink">{fmt(s.values[hover] ?? 0)}{unit}</b><span className="text-secondary">{s.name}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Stat-tile trend: the series in a de-emphasis grey, the current (last) point in the accent. */
export function Sparkline({ values, width = 112, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const px = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const py = (v: number) => height - 4 - (v / max) * (height - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={INK.base} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r={3.5} fill={SERIES[0]} stroke={INK.surface} strokeWidth={2} />
    </svg>
  );
}

/**
 * Horizontal bars for one series (one colour for every bar), each ≤ 24px thick with a 4px rounded data end,
 * square at the baseline. The value sits at the tip; hovering or focusing a bar shows its share.
 */
export function BarList({ rows, unit = '' }: { rows: { key: string | number; label: string; value: number }[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <ul className="space-y-1">
      {rows.map((r, i) => (
        <li key={r.key} tabIndex={0} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
          className="grid grid-cols-[minmax(90px,150px)_1fr] items-center gap-3 rounded px-1 py-1 outline-none hover:bg-page focus-visible:bg-page">
          <span className="truncate text-[12.5px] text-secondary" title={r.label}>{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 rounded-r-[4px] transition-[filter]" style={{ width: `${Math.max(1, (r.value / max) * 85)}%`, background: SERIES[0], filter: hover === i ? 'brightness(1.12)' : undefined }} />
            <span className="whitespace-nowrap text-xs font-semibold tabular-nums">{fmt(r.value)}{unit}</span>
            {hover === i && <span className="whitespace-nowrap text-xs text-muted">{((r.value / total) * 100).toFixed(1)}% of total</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
