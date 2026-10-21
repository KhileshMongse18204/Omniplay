import { use, type CSSProperties } from 'react';
import { load, type Bootstrap, type Category, type Ring } from './api';

// Bootstrap is fetched once (and preloaded by index.html). These hooks read it via use(); derived lookups
// are memoised per response object, so a render never rebuilds them.

export const useBoot = () => use(load<Bootstrap>('/v1/bootstrap'));

const byIdCache = new WeakMap<Bootstrap, Map<number, Category>>();
export function useCategories(): Map<number, Category> {
  const boot = useBoot();
  let map = byIdCache.get(boot);
  if (!map) byIdCache.set(boot, (map = new Map(boot.categories.map((c) => [c.id, c]))));
  return map;
}

export const topLevel = (boot: Bootstrap) => boot.categories.filter((c) => !c.parentId);

/** Story rings in the same order as the category menu (the API returns them grouped, not sorted). */
const ringCache = new WeakMap<Ring[], Ring[]>();
export function useRings(): Ring[] {
  const boot = useBoot();
  const raw = use(load<Ring[]>('/v1/stories'));
  let sorted = ringCache.get(raw);
  if (!sorted) {
    const order = new Map(boot.categories.map((c, i) => [c.id, i]));
    sorted = raw.filter((r) => order.has(r.categoryId)).sort((a, b) => order.get(a.categoryId)! - order.get(b.categoryId)!);
    ringCache.set(raw, sorted);
  }
  return sorted;
}

/** CSS custom properties in a style prop (React's types only know standard properties). */
export const vars = (v: Record<string, string>) => v as CSSProperties;
