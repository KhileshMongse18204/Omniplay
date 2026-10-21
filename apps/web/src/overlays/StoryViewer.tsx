import { useEffect, useState } from 'react';
import { m } from 'motion/react';
import { hostOf, trackClick } from '../api';
import { useCategories, useRings, vars } from '../boot';
import { Icon } from '../components/Icon';
import { Img } from '../components/Img';
import { local, ui } from '../store';

// Full-screen "Stories": bite-sized cards per category. Tap right/left to move, hold to pause, swipe down to
// close. The swipe is a real drag with elastic resistance. The progress bar is a CSS animation, so there's no
// JS timer to keep in sync (holding just pauses the animation).

const SECONDS = 5;

export default function StoryViewer({ start }: { start: number }) {
  const rings = useRings();
  const byId = useCategories();
  const [ri, setRi] = useState(Math.min(start, rings.length - 1));
  const [ii, setIi] = useState(0);
  const [paused, setPaused] = useState(false);
  const ring = rings[ri];
  const item = ring.items[ii];
  const cat = byId.get(ring.categoryId)!;

  const close = () => ui.set({ story: null });
  const next = () => {
    if (ii < ring.items.length - 1) setIi(ii + 1);
    else if (ri < rings.length - 1) { setRi(ri + 1); setIi(0); } else close();
  };
  const prev = () => {
    if (ii > 0) setIi(ii - 1);
    else if (ri > 0) { setRi(ri - 1); setIi(0); }
  };

  useEffect(() => {
    const seen = new Set(local.get<number[]>('omni:seen', []));
    local.set('omni:seen', [...seen.add(ring.categoryId)]);
  }, [ring.categoryId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <m.div role="dialog" aria-modal="true" aria-label={`${cat.name} stories`}
      className="fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.div
        drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.05, bottom: 0.7 }}
        onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 800) close(); }}
        initial={{ y: 80, scale: 0.92 }} animate={{ y: 0, scale: 1 }} exit={{ y: 120, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="relative h-dvh w-full max-w-[440px] overflow-hidden bg-surface md:h-[88dvh] md:border-[2.5px] md:border-line"
        style={vars({ '--c': cat.color })}
      >
        <div className="halftone absolute inset-0 opacity-90" style={{ backgroundColor: cat.color }} />

        <div className="absolute inset-x-3 top-3 z-20 flex gap-1">
          {ring.items.map((_, k) => (
            <span key={k} className="h-1 flex-1 overflow-hidden bg-black/25">
              <span key={`${ri}-${ii}-${k}`} className="block h-full origin-left bg-black"
                onAnimationEnd={k === ii ? next : undefined}
                style={k < ii ? { transform: 'scaleX(1)' }
                  : k === ii ? { animation: `story-fill ${SECONDS}s linear forwards`, animationPlayState: paused ? 'paused' : 'running' }
                    : { transform: 'scaleX(0)' }} />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-6 z-20 flex items-center gap-2 text-black">
          <span className="text-2xl" aria-hidden="true">{cat.icon}</span>
          <span className="display text-sm">{cat.name}</span>
          <button type="button" onClick={close} aria-label="Close stories" className="ml-auto grid size-9 place-items-center border-2 border-black bg-white/80">
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Tap zones: left third = back, rest = forward; holding anywhere pauses. */}
        <div className="absolute inset-0 z-10 flex" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
          <button type="button" aria-label="Previous" className="w-1/3 cursor-w-resize" onClick={prev} />
          <button type="button" aria-label="Next" className="flex-1 cursor-e-resize" onClick={next} />
        </div>

        <m.div key={`${ri}-${ii}`} initial={{ opacity: 0, y: 30, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: -1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="pointer-events-none absolute inset-x-5 top-24 z-10">
          <div className="brut relative aspect-[16/10] overflow-hidden bg-surface" style={vars({ '--c': '#000' })}>
            <Img image={item.image} title={item.title} color={cat.color} sizes="420px" eager />
          </div>
        </m.div>

        <div className="absolute inset-x-4 bottom-6 z-20 space-y-3">
          <div className="brut bg-surface p-4" style={vars({ '--c': '#000' })}>
            <p className="label text-muted">{hostOf(item.url)}</p>
            <h2 className="display mt-1 text-3xl">{item.title}</h2>
            <p className="mt-2 text-sm text-muted">{item.description}</p>
          </div>
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => trackClick(item.id)}
            className="btn btn-accent w-full justify-center">
            Open site <Icon name="external" size={16} />
          </a>
        </div>
      </m.div>
    </m.div>
  );
}
