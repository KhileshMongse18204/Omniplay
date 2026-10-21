import { Suspense } from 'react';
import { m } from 'motion/react';
import { Link } from 'wouter';
import { topLevel, useBoot, useCategories, useRings, vars } from '../boot';
import { local, ui } from '../store';
import { SurpriseButton } from './Chrome';
import { Icon } from './Icon';

// Intro: expressive headline + live stats (left), colour-blocked category tiles (right, after the style
// reference), then the Story rings rail. Bootstrap data only, so it renders without waiting for links.

export function Hero() {
  const boot = useBoot();
  const tops = topLevel(boot);
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 md:pt-14">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end [&>*]:min-w-0">
        <div>
          <p className="label inline-flex items-center gap-2 border-2 border-line bg-surface px-2.5 py-1">
            <span className="size-2 animate-pulse bg-accent" /> Website discovery · hand-checked
          </p>
          <h1 className="display mt-5 text-[clamp(1.8rem,9.2vw,5.9rem)]">
            Every<br />playground<br />on the <span className="bg-accent px-2 text-accent-ink [box-decoration-break:clone]">internet.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base text-muted md:text-lg">
            Movies, music, games, anime and manga: {boot.stats.links} sites that actually load, sorted by what you're in the
            mood for. Nothing to sign up for.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <SurpriseButton className="btn btn-accent" />
            <Link href="/feed" className="btn"><Icon name="play" size={16} filled /> Swipe the feed</Link>
          </div>
          <dl className="mt-8 flex gap-8">
            {[[boot.stats.links, 'sites'], [boot.stats.categories, 'categories'], ['24/7', 'link checks']].map(([n, label]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="label text-muted">{label}</dt>
                <dd className="display text-4xl">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {tops.map((c, i) => (
            <m.div key={c.id}
              initial={{ opacity: 0, y: 28, rotate: i % 2 ? 3 : -3 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 17, delay: 0.06 * i }}
              whileHover={{ y: -5, rotate: i % 2 ? 1.2 : -1.2 }}
              whileTap={{ scale: 0.95 }}>
              <Link href={`/c/${c.slug}`} className="halftone brut flex min-h-32 flex-col justify-between gap-3 p-3 text-black"
                style={vars({ backgroundColor: c.color, '--c': 'var(--line)' })}>
                <span className="display text-[15px] leading-none sm:text-[17px]">{c.name}</span>
                <span className="flex items-end justify-between">
                  <span className="text-3xl" aria-hidden="true">{c.icon}</span>
                  <span className="text-right leading-none"><b className="display text-3xl">{c.count}</b><br /><span className="label">sites</span></span>
                </span>
              </Link>
            </m.div>
          ))}
        </div>
      </div>
      <Suspense fallback={<div className="mt-10 h-28" />}>
        <StoriesRail />
      </Suspense>
    </section>
  );
}

/** Instagram-style rings, one per top-level category; viewed rings turn grey (remembered locally). */
function StoriesRail() {
  const rings = useRings();
  const byId = useCategories();
  const seen = local.get<number[]>('omni:seen', []);
  if (!rings.length) return null;
  return (
    <div className="mt-12">
      <p className="label mb-3 text-muted">Stories · tap to binge the best of each</p>
      <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-3 pt-1">
        {rings.map((r, i) => {
          const c = byId.get(r.categoryId)!;
          return (
            <button key={r.categoryId} type="button" onClick={() => ui.set({ story: i })} className="flex w-20 shrink-0 flex-col items-center gap-2">
              <m.span whileHover={{ scale: 1.08, rotate: 8 }} whileTap={{ scale: 0.9 }}
                className="grid size-[76px] place-items-center rounded-full p-[3px]"
                style={{ background: seen.includes(c.id) ? 'var(--muted)' : `conic-gradient(${c.color}, var(--accent), ${c.color})` }}>
                <span className="grid size-full place-items-center rounded-full border-[3px] border-bg bg-surface text-3xl" aria-hidden="true">{c.icon}</span>
              </m.span>
              <span className="label w-full truncate text-center text-[10px]">{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
