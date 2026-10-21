// Data layer for a static-hosted SPA. Every read goes through load(): one promise per URL, shared by every
// component, and React's use() + Suspense render it, so nothing is fetched twice. Responses are already
// cached by Cloudflare + Redis upstream. Analytics are fire-and-forget beacons that never block a click.

export const API = import.meta.env.VITE_API_URL;

export type Card = {
  id: number; title: string; url: string; description: string; tags: string[];
  image: string | null; categoryId: number; featured: boolean; isNew: boolean;
};
export type Category = {
  id: number; parentId: number | null; slug: string; name: string; description: string; icon: string; color: string; count: number;
};
export type Bootstrap = {
  site: {
    title: string; description: string; ogImage: string; headScripts: string; bodyScripts: string;
    mediaUrl: string; pageSize: number; maintenance: { enabled: boolean; message: string };
  };
  categories: Category[];
  trending: number[];
  stats: { links: number; categories: number };
};
export type Page = { items: Card[]; hasMore: boolean };
export type Ring = { categoryId: number; items: Card[] };

const cache = new Map<string, Promise<unknown>>();

export function load<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    // Same URL + default CORS mode as the <link rel="preload"> in index.html, so bootstrap reuses that download.
    p = fetch(API + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))) as Promise<T>;
    cache.set(path, p);
    p.catch(() => cache.delete(path)); // a failed request can be retried
  }
  return p;
}

const beacon = (path: string) => {
  try { navigator.sendBeacon(API + path); } catch { /* analytics must never break the UI */ }
};
export const trackClick = (id: number) => beacon(`/v1/links/${id}/click`);
export const trackView = () => beacon('/v1/pv');
export const logSearch = (q: string, results: number) => beacon(`/v1/search/log?q=${encodeURIComponent(q)}&n=${results}`);

export type Reason = 'dead' | 'wrong_link' | 'malicious';
export async function sendReport(linkId: number, reason: Reason, note: string): Promise<void> {
  const res = await fetch(`${API}/v1/reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkId, reason, note }),
  });
  if (res.status === 429) throw new Error('Too many reports from your network. Try again in a bit.');
  if (!res.ok) throw new Error('Could not send the report.');
}

export const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};
