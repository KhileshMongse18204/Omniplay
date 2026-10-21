// Link field helpers shared by the API (admin CRUD) and the worker (bulk import),
// so both write identical search_text and tags.

/** Variant widths the worker encodes (AVIF + WebP each). apps/web's <Img> builds its srcset from the same list. */
export const IMAGE_WIDTHS = [160, 320, 640, 960] as const;

export const isHttpUrl = (u: string) => {
  try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
};

export const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** Lowercase, trimmed, de-duplicated, at most 12 tags of 30 chars. Small arrays keep the GIN index lean. */
export const normalizeTags = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30)).filter(Boolean))].slice(0, 12);

/** Lowercased haystack (title, description, tags, host) behind the trigram index, so search is a single LIKE. */
export const searchText = (l: { title: string; description?: string; tags?: string[]; url?: string }) =>
  [l.title, l.description ?? '', ...(l.tags ?? []), hostOf(l.url ?? '')].join(' ').toLowerCase().slice(0, 2000);
