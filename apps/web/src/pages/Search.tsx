import { Suspense, use, useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { load, logSearch, type Card } from '../api';
import { topLevel, useBoot } from '../boot';
import { Icon } from '../components/Icon';
import { CardSkeletons, LinkCard } from '../components/LinkCard';

// Instant search: requests are debounced (one per pause, not one per keystroke), results come from the
// cached /v1/search endpoint, and the query is logged for the admin's "content gaps" report only after the
// user stops typing, so half-typed prefixes don't pollute analytics.

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Search() {
  const boot = useBoot();
  const [, navigate] = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(useSearch()).get('q') ?? '');
  const term = useDebounced(q.trim().toLowerCase().replace(/\s+/g, ' '), 220);

  // Keep ?q= in the address bar (shareable) without piling up history entries.
  useEffect(() => {
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : '/search', { replace: true });
  }, [term, navigate]);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8">
      <label htmlFor="q" className="label text-muted">Search {boot.stats.links} sites</label>
      <div className="brut mt-2 flex items-center gap-3 bg-surface px-4">
        <Icon name="search" size={26} />
        <input id="q" type="search" autoFocus autoComplete="off" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="anime, free games, lo-fi…" className="display h-16 w-full min-w-0 bg-transparent text-2xl outline-none placeholder:text-muted/60 md:h-20 md:text-4xl" />
      </div>
      <div className="mt-8">
        {term.length >= 2 ? (
          <Suspense fallback={<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4"><CardSkeletons /></div>}>
            <Results q={term} />
          </Suspense>
        ) : (
          <div>
            <p className="label mb-3 text-muted">Try a category</p>
            <div className="flex flex-wrap gap-2">
              {topLevel(boot).map((c) => (
                <button key={c.id} type="button" onClick={() => setQ(c.name.split(' ')[0].toLowerCase())}
                  className="border-2 border-line bg-surface px-3 py-2 text-sm font-bold">{c.icon} {c.name}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Results({ q }: { q: string }) {
  const { items } = use(load<{ items: Card[] }>(`/v1/search?q=${encodeURIComponent(q)}`));
  useEffect(() => {
    const t = setTimeout(() => logSearch(q, items.length), 1200); // only once the query has settled
    return () => clearTimeout(t);
  }, [q, items.length]);

  if (!items.length) {
    return (
      <div className="brut bg-surface p-8">
        <p className="display text-3xl">No sites for “{q}” yet</p>
        <p className="mt-2 text-muted">We've noted the search. When enough people look for something, it goes on our list to add.</p>
      </div>
    );
  }
  return (
    <>
      <p className="label mb-4 text-muted">{items.length} result{items.length === 1 ? '' : 's'}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {items.map((c, i) => <LinkCard key={c.id} card={c} index={i} />)}
      </div>
    </>
  );
}
