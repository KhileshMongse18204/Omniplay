import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { hostOf, load, trackClick, type Card, type Page } from '../api';
import { useCategories, vars } from '../boot';
import { Icon, type IconName } from '../components/Icon';
import { Img } from '../components/Img';
import { local, toast, ui } from '../store';

// TikTok-style vertical feed: one site per screen. Swiping uses native CSS scroll-snap (momentum scrolling on
// the compositor thread at 60fps, no JS per frame); Motion only animates each slide's content as it arrives.
// The next page is fetched while you're still three slides away from the end.

export default function Feed() {
  const [pages, setPages] = useState(1);
  const more = useCallback((n: number) => setPages((p) => Math.max(p, n)), []);
  return (
    <div className="no-scrollbar h-[calc(100dvh-62px)] snap-y snap-mandatory overflow-y-auto overscroll-contain md:mx-auto md:max-w-[480px] md:border-x-[2.5px] md:border-line">
      {Array.from({ length: pages }, (_, i) => (
        <Suspense key={i} fallback={<div className="h-full snap-start animate-pulse bg-surface" />}>
          <FeedPage page={i + 1} onNearEnd={() => more(i + 2)} />
        </Suspense>
      ))}
    </div>
  );
}

function FeedPage({ page, onNearEnd }: { page: number; onNearEnd: () => void }) {
  const { items, hasMore } = use(load<Page>(`/v1/links?page=${page}`));
  return (
    <>
      {items.map((card, i) => (
        <Slide key={card.id} card={card} first={page === 1 && i === 0}
          onVisible={hasMore && i === Math.max(0, items.length - 3) ? onNearEnd : undefined} />
      ))}
      {!hasMore && (
        <section className="grid h-full snap-start place-items-center p-8 text-center">
          <div>
            <p className="display text-4xl">You reached the end 🎉</p>
            <p className="mt-3 text-muted">That's every site in the library. Respect.</p>
          </div>
        </section>
      )}
    </>
  );
}

const LIKES = 'omni:likes';

function Slide({ card, first, onVisible }: { card: Card; first: boolean; onVisible?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const cat = useCategories().get(card.categoryId);
  const color = cat?.color ?? 'var(--accent)';
  const [liked, setLiked] = useState(() => local.get<number[]>(LIKES, []).includes(card.id));
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (!onVisible || !ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && onVisible(), { threshold: 0.5 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [onVisible]);

  const setLike = (on: boolean) => {
    const ids = new Set(local.get<number[]>(LIKES, []));
    if (on) ids.add(card.id); else ids.delete(card.id);
    local.set(LIKES, [...ids]);
    setLiked(on);
    if (on) setBurst((b) => b + 1);
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: card.title, url: card.url });
      else { await navigator.clipboard.writeText(card.url); toast('📋', 'Link copied'); }
    } catch { /* share sheet dismissed */ }
  };

  return (
    <section ref={ref} onDoubleClick={() => setLike(true)} className="relative h-full touch-manipulation snap-start snap-always overflow-hidden"
      style={vars({ '--c': color })} aria-label={card.title}>
      {/* Backdrop is a darker mix of the category colour, so the card in front still pops. */}
      <div className="halftone absolute inset-0" style={{ backgroundColor: `color-mix(in oklab, ${color} 62%, var(--bg))` }} />
      <div className="relative flex h-full flex-col justify-end gap-4 p-5 pb-28 pr-20 md:pb-8">
        <m.div initial={{ opacity: 0, y: 50, rotate: -4 }} whileInView={{ opacity: 1, y: 0, rotate: -1.5 }}
          viewport={{ amount: 0.6 }} transition={{ type: 'spring', stiffness: 190, damping: 17 }}
          className="brut relative aspect-[16/10] overflow-hidden bg-surface" style={vars({ '--c': '#000' })}>
          <Img image={card.image} title={card.title} color={color} sizes="(min-width: 768px) 400px, 80vw" eager={first} />
        </m.div>
        <m.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ amount: 0.6 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.06 }}
          className="brut bg-surface p-4" style={vars({ '--c': '#000' })}>
          <p className="label text-muted">{cat?.icon} {cat?.name} · {hostOf(card.url)}</p>
          <h2 className="display mt-2 text-[28px]">{card.title}</h2>
          <p className="mt-2 text-sm text-muted">{card.description}</p>
          <a href={card.url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => trackClick(card.id)}
            className="btn btn-accent mt-4 w-full justify-center">Open site <Icon name="external" size={16} /></a>
        </m.div>
      </div>

      <div className="absolute bottom-40 right-3 flex flex-col gap-3 md:bottom-24">
        <Action icon="heart" label={liked ? 'Unlike' : 'Like'} active={liked} onClick={() => setLike(!liked)} />
        <Action icon="share" label="Share" onClick={share} />
        <Action icon="flag" label="Report" onClick={() => ui.set({ reportFor: card })} />
      </div>

      <AnimatePresence>{burst > 0 && <HeartBurst key={burst} />}</AnimatePresence>
      {first && (
        <m.p className="label pointer-events-none absolute inset-x-0 top-4 text-center text-black"
          animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
          ↑ swipe for the next site · double-tap to like
        </m.p>
      )}
    </section>
  );
}

function Action({ icon, label, active = false, onClick }: { icon: IconName; label: string; active?: boolean; onClick: () => void }) {
  return (
    <m.button type="button" aria-label={label} aria-pressed={icon === 'heart' ? active : undefined} onClick={onClick}
      whileTap={{ scale: 0.8 }} whileHover={{ scale: 1.08 }}
      className={`grid size-12 place-items-center border-[2.5px] border-black shadow-[3px_3px_0_#000] ${active ? 'bg-[#ff4f6d] text-white' : 'bg-white text-black'}`}>
      <Icon name={icon} size={20} filled={icon === 'heart' && active} />
    </m.button>
  );
}

/** Double-tap reward: hearts fly out along random angles with spring physics, then fade. */
function HeartBurst() {
  const hearts = useRef(Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.6;
    return { x: Math.cos(angle) * (80 + Math.random() * 60), y: Math.sin(angle) * (80 + Math.random() * 60) - 40 };
  })).current;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2">
      {hearts.map((h, i) => (
        <m.span key={i} className="absolute text-[#ff4f6d]" initial={{ x: 0, y: 0, scale: 0.2, opacity: 1 }}
          animate={{ x: h.x, y: h.y, scale: 1.4, opacity: 0 }} exit={{ opacity: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 14, opacity: { duration: 0.9 } }}>
          <Icon name="heart" size={30} filled />
        </m.span>
      ))}
    </div>
  );
}
