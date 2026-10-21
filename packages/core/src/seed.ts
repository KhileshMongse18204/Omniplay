// Demo content for local development: categories plus a handful of free, legal sites.
// Idempotent: it does nothing if any category already exists. Run with `npm run db:seed`.
import { db, pg } from './db.ts';
import { normalizeTags, searchText } from './links.ts';
import { categories, links } from './schema.ts';

type Site = [title: string, url: string, description: string, tags: string[], featured?: boolean];

const tree: { slug: string; name: string; icon: string; color: string; description: string; subs: { slug: string; name: string; icon: string; sites: Site[] }[] }[] = [
  {
    slug: 'movies-tv', name: 'Movies & TV', icon: '🎬', color: '#ff4d4d', description: 'Stream or grab films and shows.',
    subs: [
      { slug: 'watch-movies', name: 'Watch online', icon: '🍿', sites: [
        ['Tubi', 'https://tubitv.com', 'Free, ad-supported movies and TV with a deep back catalog.', ['free', 'ads', 'hd'], true],
        ['Pluto TV', 'https://pluto.tv', 'Hundreds of live channels plus on-demand movies, free with ads.', ['live-tv', 'free']],
        ['Plex', 'https://watch.plex.tv', 'Free ad-supported movies and shows on every device.', ['free', 'multi-device']],
        ['Kanopy', 'https://www.kanopy.com', 'Award-winning films, free with a library card.', ['library-card', 'indie', 'no-ads']],
      ] },
      { slug: 'download-movies', name: 'Download', icon: '💾', sites: [
        ['Internet Archive Feature Films', 'https://archive.org/details/feature_films', 'Public-domain classics to stream or download.', ['public-domain', 'download']],
        ['Open Culture Free Movies', 'https://www.openculture.com/freemoviesonline', '4,000+ free classic and indie films, curated.', ['classics', 'curated']],
      ] },
    ],
  },
  {
    slug: 'music', name: 'Music', icon: '🎧', color: '#b36bff', description: 'Play it loud, or keep it forever.',
    subs: [
      { slug: 'stream-music', name: 'Stream', icon: '📻', sites: [
        ['Jamendo', 'https://www.jamendo.com', 'Independent music released under Creative Commons.', ['creative-commons', 'indie'], true],
        ['SoundCloud', 'https://soundcloud.com', 'Millions of tracks from up-and-coming artists.', ['indie', 'remixes']],
        ['Audius', 'https://audius.co', 'Artist-run streaming with no paywall.', ['free', 'electronic']],
      ] },
      { slug: 'download-music', name: 'Download', icon: '⬇️', sites: [
        ['Free Music Archive', 'https://freemusicarchive.org', 'Free, legal downloads of curated independent music.', ['creative-commons', 'download']],
        ['Bandcamp', 'https://bandcamp.com', 'Name-your-price albums, many free to download.', ['name-your-price', 'indie']],
        ['Musopen', 'https://musopen.org', 'Royalty-free classical recordings and sheet music.', ['classical', 'public-domain']],
      ] },
    ],
  },
  {
    slug: 'games', name: 'Games', icon: '🎮', color: '#3ddc84', description: 'Play now in a tab, or download for keeps.',
    subs: [
      { slug: 'browser-games', name: 'Play in browser', icon: '🕹️', sites: [
        ['itch.io Web Games', 'https://itch.io/games/platform-web', 'Thousands of indie games that run right in your browser.', ['indie', 'no-install'], true],
        ['Poki', 'https://poki.com', 'Instant-play browser games, no downloads.', ['casual', 'no-install']],
        ['CrazyGames', 'https://www.crazygames.com', 'Browser games from .io battles to puzzles.', ['multiplayer', 'io']],
        ['Internet Archive MS-DOS Games', 'https://archive.org/details/softwarelibrary_msdos_games', 'Thousands of DOS classics, emulated in the browser.', ['retro', 'emulator']],
      ] },
      { slug: 'free-pc-games', name: 'Free PC games', icon: '🖥️', sites: [
        ['Epic Games Store Free Games', 'https://store.epicgames.com/free-games', 'A new game to claim and keep every week.', ['weekly', 'keep-forever'], true],
        ['GOG Free Games', 'https://www.gog.com/en/games?priceRange=0,0', 'DRM-free games for $0.', ['drm-free']],
        ['Steam Free to Play', 'https://store.steampowered.com/genre/Free%20to%20Play/', 'Every free-to-play game on Steam.', ['f2p', 'multiplayer']],
        ['itch.io Free Games', 'https://itch.io/games/free', 'Free indie downloads for Windows, Mac and Linux.', ['indie', 'download']],
      ] },
    ],
  },
  {
    slug: 'anime', name: 'Anime', icon: '🍥', color: '#ff6bd6', description: 'Simulcasts, classics and everything between.',
    subs: [
      { slug: 'watch-anime', name: 'Watch anime', icon: '📺', sites: [
        ['RetroCrush', 'https://www.retrocrush.tv', 'Classic anime streaming, free with ads.', ['retro', 'free']],
        ['Muse Asia', 'https://www.youtube.com/@MuseAsia', 'Official anime episodes, free on YouTube.', ['official', 'subbed']],
        ['Tubi Anime', 'https://tubitv.com/category/anime', 'A free, ad-supported anime catalog.', ['dubbed', 'free']],
      ] },
      { slug: 'download-anime', name: 'Download anime', icon: '📥', sites: [] },
    ],
  },
  {
    slug: 'manga', name: 'Manga & Comics', icon: '📚', color: '#4da3ff', description: 'Read official chapters and indie comics.',
    subs: [
      { slug: 'read-manga', name: 'Read online', icon: '📖', sites: [
        ['MANGA Plus by Shueisha', 'https://mangaplus.shueisha.co.jp', 'Official Jump chapters, simulpub and free.', ['official', 'simulpub'], true],
        ['Webtoon', 'https://www.webtoons.com', 'Free vertical-scroll comics, updated daily.', ['webtoon', 'daily']],
        ['Tapas', 'https://tapas.io', 'Indie comics and novels, many free.', ['indie']],
        ['VIZ Shonen Jump', 'https://www.viz.com/shonenjump', 'The newest Jump chapters free; archive with membership.', ['official']],
      ] },
    ],
  },
];

const [existing] = await db.select({ id: categories.id }).from(categories).limit(1);
if (existing) {
  console.log('categories already exist, demo seed skipped');
} else {
  for (const [i, parent] of tree.entries()) {
    const [p] = await db.insert(categories).values({
      slug: parent.slug, name: parent.name, icon: parent.icon, color: parent.color, description: parent.description, sortOrder: i,
    }).returning({ id: categories.id });
    for (const [j, sub] of parent.subs.entries()) {
      const [c] = await db.insert(categories).values({
        slug: sub.slug, name: sub.name, icon: sub.icon, color: parent.color, parentId: p.id, sortOrder: j,
      }).returning({ id: categories.id });
      if (!sub.sites.length) continue;
      // One multi-row INSERT per category instead of one per link.
      await db.insert(links).values(sub.sites.map(([title, url, description, rawTags, featured]) => {
        const tags = normalizeTags(rawTags);
        return { categoryId: c.id, title, url, description, tags, status: 'active' as const, isFeatured: !!featured, searchText: searchText({ title, description, tags, url }) };
      }));
    }
  }
  console.log('demo categories and links seeded');
}
await pg.end();
