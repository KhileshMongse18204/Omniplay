import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { hostOf, trackClick, type Card } from '../api';
import { useBoot, useCategories, vars } from '../boot';
import { ui } from '../store';
import { Icon } from './Icon';
import { Img } from './Img';

// One website card. Hover/tap use real spring physics; the outbound link is a plain <a>, so the browser
// opens it instantly and the click is counted by a beacon that never delays navigation.

export const spring = { type: 'spring', stiffness: 420, damping: 24 } as const;

export function LinkCard({ card, index = 0 }: { card: Card; index?: number }) {
  const cat = useCategories().get(card.categoryId);
  const trending = useBoot().trending.includes(card.id);
  const color = cat?.color ?? 'var(--accent)';
  const count = () => trackClick(card.id);

  return (
    <m.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(index, 8) * 0.035 }}
      whileHover={{ y: -4, rotate: -0.5 }}
      whileTap={{ scale: 0.97, rotate: 0 }}
      className="brut brut-hover group relative flex flex-col bg-surface"
      style={vars({ '--c': color })}
    >
      <a href={card.url} target="_blank" rel="noopener noreferrer nofollow" onClick={count}
        onAuxClick={(e) => e.button === 1 && count()} className="flex flex-1 flex-col">
        <div className="relative aspect-[16/10] overflow-hidden border-b-[2.5px] border-line">
          <Img image={card.image} title={card.title} color={color} sizes="(min-width: 1280px) 290px, (min-width: 640px) 31vw, 47vw" />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {trending && <Badge className="bg-[#ff5a1f] text-black"><Icon name="fire" size={11} filled /> Hot</Badge>}
            {card.featured && <Badge className="bg-accent text-accent-ink">Featured</Badge>}
            {card.isNew && <Badge className="bg-surface text-ink">New</Badge>}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3 className="text-[15px] font-extrabold leading-tight">{card.title}</h3>
          <p className="truncate font-mono text-[11px] font-bold text-muted">{hostOf(card.url)}</p>
          <p className="line-clamp-2 text-[13px] leading-snug text-muted">{card.description}</p>
          {card.tags.length > 0 && (
            <div className="mt-auto flex flex-wrap gap-1 pt-2">
              {card.tags.slice(0, 3).map((t) => <span key={t} className="label border border-current/30 px-1.5 py-0.5 text-[9.5px] text-muted">#{t}</span>)}
            </div>
          )}
        </div>
      </a>
      <button
        type="button" onClick={() => ui.set({ reportFor: card })} aria-label={`Report a problem with ${card.title}`}
        className="absolute right-2 top-2 grid size-8 place-items-center border-2 border-line bg-surface opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <Icon name="flag" size={14} />
      </button>
    </m.article>
  );
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`label inline-flex items-center gap-1 border-2 border-black px-1.5 py-0.5 text-[9.5px] ${className}`}>{children}</span>;
}

export function CardSkeletons({ n = 8 }: { n?: number }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="brut animate-pulse bg-surface" style={vars({ '--c': 'var(--surface-2)' })}>
      <div className="aspect-[16/10] bg-surface-2" />
      <div className="space-y-2 p-3"><div className="h-4 w-2/3 bg-surface-2" /><div className="h-3 w-full bg-surface-2" /></div>
    </div>
  ));
}
