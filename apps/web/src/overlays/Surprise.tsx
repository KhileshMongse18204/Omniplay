import { useEffect, useMemo, useState } from 'react';
import { m } from 'motion/react';
import { hostOf, trackClick } from '../api';
import { useCategories, useRings, vars } from '../boot';
import { Icon } from '../components/Icon';
import { celebrate, ui } from '../store';

// "Surprise me" slot machine: the reel spins through real sites and decelerates (each tick waits longer
// than the last), then lands with a springy bounce. It picks from the story pool that's already loaded,
// so spinning makes no extra requests.

export default function Surprise() {
  const rings = useRings();
  const byId = useCategories();
  const pool = useMemo(() => rings.flatMap((r) => r.items), [rings]);
  const [spin, setSpin] = useState(0);
  const [index, setIndex] = useState(0);
  const [landed, setLanded] = useState(false);
  const close = () => ui.set({ surprise: false });

  useEffect(() => {
    if (!pool.length) return;
    setLanded(false);
    const target = Math.floor(Math.random() * pool.length);
    const ticks = 16 + Math.floor(Math.random() * 6);
    let step = 0;
    let timer = 0;
    const tick = () => {
      step += 1;
      if (step >= ticks) { setIndex(target); setLanded(true); return; }
      setIndex((i) => (i + 1) % pool.length);
      timer = window.setTimeout(tick, 35 + step * step * 1.1);
    };
    tick();
    return () => clearTimeout(timer);
  }, [spin, pool.length]);

  useEffect(() => { if (landed) celebrate(); }, [landed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = pool[index];
  if (!pick) return null;
  const cat = byId.get(pick.categoryId);

  return (
    <m.div role="dialog" aria-modal="true" aria-label="Surprise pick" className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
      <m.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.8, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        className="brut w-full max-w-sm bg-surface p-5" style={vars({ '--c': cat?.color ?? 'var(--accent)' })}>
        <p className="label text-muted">🎰 Surprise me</p>
        <div className="mt-3 overflow-hidden border-[2.5px] border-line bg-bg px-4 py-6 text-center" aria-live="polite">
          <m.p key={index} initial={{ y: -26, opacity: 0.2 }} animate={landed ? { y: 0, opacity: 1, scale: [1.18, 1] } : { y: 0, opacity: 1 }}
            transition={landed ? { type: 'spring', stiffness: 420, damping: 12 } : { duration: 0.05 }}
            className={`display text-2xl ${landed ? 'line-clamp-2' : 'truncate'}`}>
            {pick.title}
          </m.p>
          <p className="label mt-2 text-muted">{cat?.icon} {cat?.name}</p>
        </div>
        {landed && (
          <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-3">
            <p className="text-sm text-muted">{pick.description}</p>
            <a href={pick.url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => trackClick(pick.id)}
              className="btn btn-accent w-full justify-center">Open {hostOf(pick.url)} <Icon name="external" size={16} /></a>
          </m.div>
        )}
        <div className="mt-3 flex gap-3">
          <button type="button" onClick={close} className="btn flex-1 justify-center">Close</button>
          <m.button type="button" whileTap={{ rotate: 180 }} disabled={!landed} onClick={() => setSpin((s) => s + 1)} className="btn flex-1 justify-center">
            <Icon name="dice" size={16} /> Spin again
          </m.button>
        </div>
      </m.div>
    </m.div>
  );
}
