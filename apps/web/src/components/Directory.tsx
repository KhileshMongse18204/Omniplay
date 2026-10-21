import { Suspense, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { load, type Category, type Page } from '../api';
import { topLevel, useBoot, useCategories, vars } from '../boot';
import { markExplored } from '../easter';
import { CardSkeletons, LinkCard } from './LinkCard';

// Main section, laid out like the structure reference: category menu on the left (a chip rail on phones),
// card grid on the right. Pages load as you scroll; each page is its own Suspense boundary, so earlier
// cards never re-render or flash while the next page arrives.

const pagePath = (slug: string | undefined, tag: string | null, page: number) => {
  const q = new URLSearchParams({ page: String(page) });
  if (slug) q.set('category', slug);
  if (tag) q.set('tag', tag);
  return `/v1/links?${q}`;
};

export function Directory({ slug }: { slug?: string }) {
  const boot = useBoot();
  const byId = useCategories();
  const active = slug ? boot.categories.find((c) => c.slug === slug) : undefined;
  const [tag, setTag] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => setTag(null), [slug]);
  // A deep link (/c/anime) lands on the grid, not on the hero.
  useEffect(() => { if (slug) ref.current?.scrollIntoView({ block: 'start' }); }, []); // mount only, not on every category switch
  useEffect(() => {
    if (!active) return;
    const top = active.parentId ? byId.get(active.parentId) ?? active : active;
    markExplored(top.id, topLevel(boot).length);
  }, [active, boot, byId]);

  return (
    <section ref={ref} id="directory" className="mx-auto mt-14 grid max-w-7xl scroll-mt-16 gap-6 px-4 lg:grid-cols-[250px_1fr]">
      <CategoryMenu active={active} />
      <div className="min-w-0">
        <GridHeader category={active} />
        <Suspense fallback={<Grid><CardSkeletons /></Grid>}>
          <LinkGrid key={`${slug}|${tag}`} slug={slug} tag={tag} onTag={setTag} />
        </Suspense>
      </div>
    </section>
  );
}

function CategoryMenu({ active }: { active?: Category }) {
  const boot = useBoot();
  const tops = topLevel(boot);
  const total = boot.stats.links;
  const row = (c: Category, child = false) => {
    const on = active?.id === c.id;
    return (
      <li key={c.id}>
        <Link href={`/c/${c.slug}`} aria-current={on ? 'page' : undefined}
          className={`flex items-center gap-2.5 border-2 px-2.5 py-2 font-bold transition-colors ${child ? 'ml-5 text-[13px]' : 'text-sm'} ${
            on ? 'border-line bg-accent text-accent-ink shadow-[3px_3px_0_var(--line)]' : 'border-transparent hover:border-line'}`}>
          <span aria-hidden="true">{c.icon}</span>
          <span className="flex-1 truncate">{c.name}</span>
          <span className={`label px-1.5 text-[10px] ${on ? '' : 'text-muted'}`}>{c.count}</span>
        </Link>
      </li>
    );
  };
  return (
    <>
      <nav aria-label="Categories" className="no-scrollbar sticky top-[60px] z-30 -mx-4 flex gap-2 overflow-x-auto border-b-2 border-line/20 bg-bg/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <Chip href="/" on={!active}>All · {total}</Chip>
        {boot.categories.map((c) => <Chip key={c.id} href={`/c/${c.slug}`} on={active?.id === c.id}>{c.icon} {c.name}</Chip>)}
      </nav>
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <p className="label mb-3 text-muted">Categories · {tops.length}</p>
          <ul className="space-y-1">
            <li>
              <Link href="/" className={`flex items-center gap-2.5 border-2 px-2.5 py-2 text-sm font-bold ${!active ? 'border-line bg-accent text-accent-ink shadow-[3px_3px_0_var(--line)]' : 'border-transparent hover:border-line'}`}>
                <span aria-hidden="true">✦</span><span className="flex-1">All sites</span><span className="label text-[10px]">{total}</span>
              </Link>
            </li>
            {tops.map((t) => [row(t), ...boot.categories.filter((c) => c.parentId === t.id).map((c) => row(c, true))])}
          </ul>
        </div>
      </aside>
    </>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={on ? 'page' : undefined}
      className={`shrink-0 whitespace-nowrap border-2 border-line px-3 py-1.5 text-[13px] font-bold ${on ? 'bg-accent text-accent-ink' : 'bg-surface'}`}>
      {children}
    </Link>
  );
}

function GridHeader({ category }: { category?: Category }) {
  const { stats } = useBoot();
  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-2">
      <h2 className="display border-[2.5px] border-line px-3 py-1.5 text-xl text-black shadow-[4px_4px_0_var(--line)]"
        style={{ backgroundColor: category?.color ?? 'var(--accent)' }}>
        {category ? `${category.icon} ${category.name}` : '✦ All sites'}
      </h2>
      <span className="label text-muted">{category?.count ?? stats.links} sites</span>
      {category?.description && <p className="basis-full text-sm text-muted">{category.description}</p>}
    </div>
  );
}

const Grid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">{children}</div>
);

function LinkGrid({ slug, tag, onTag }: { slug?: string; tag: string | null; onTag: (t: string | null) => void }) {
  const [pages, setPages] = useState(1);
  const first = use(load<Page>(pagePath(slug, tag, 1)));
  const untagged = use(load<Page>(pagePath(slug, null, 1))); // same request as `first` when no tag is set
  // Quick filters: the most common tags on this category's first page.
  const counts = new Map<string, number>();
  for (const c of untagged.items) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);

  return (
    <>
      {tags.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => onTag(tag === t ? null : t)} aria-pressed={tag === t}
              className={`label shrink-0 border-2 border-line px-2.5 py-1.5 ${tag === t ? 'bg-ink text-bg' : 'bg-surface'}`}>
              #{t}
            </button>
          ))}
        </div>
      )}
      {first.items.length === 0 ? (
        <div className="brut bg-surface p-8 text-center" style={vars({ '--c': 'var(--muted)' })}>
          <p className="display text-2xl">Nothing here yet</p>
          <p className="mt-2 text-sm text-muted">We're still checking sites for this corner. Try another category or hit Surprise me.</p>
        </div>
      ) : (
        <Grid>
          {Array.from({ length: pages }, (_, i) => (
            <Suspense key={i} fallback={<CardSkeletons n={4} />}>
              <PageCards path={pagePath(slug, tag, i + 1)} />
            </Suspense>
          ))}
        </Grid>
      )}
      <Suspense fallback={null}>
        <More path={pagePath(slug, tag, pages)} onMore={() => setPages((p) => p + 1)} />
      </Suspense>
    </>
  );
}

function PageCards({ path }: { path: string }) {
  const { items } = use(load<Page>(path));
  return items.map((c, i) => <LinkCard key={c.id} card={c} index={i} />);
}

/** Infinite scroll: the next page starts loading ~600px before the user reaches the end. */
function More({ path, onMore }: { path: string; onMore: () => void }) {
  const { hasMore, items } = use(load<Page>(path));
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!hasMore || !ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && onMore(), { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [hasMore, onMore]);
  if (hasMore) return <button ref={ref} type="button" onClick={onMore} className="btn mx-auto mt-10 flex">Load more</button>;
  return items.length ? <p className="label mt-10 text-center text-muted">✦ That's everything in here ✦</p> : null;
}
