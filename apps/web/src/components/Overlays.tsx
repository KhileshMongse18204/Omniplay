import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useUI } from '../store';

// Overlays are separate lazy chunks: their code downloads only when someone opens one,
// so the first-load bundle stays the directory itself.
const StoryViewer = lazy(() => import('../overlays/StoryViewer'));
const ThemeSheet = lazy(() => import('../overlays/ThemeSheet'));
const ReportDialog = lazy(() => import('../overlays/ReportDialog'));
const Surprise = lazy(() => import('../overlays/Surprise'));

export function Overlays() {
  const story = useUI((s) => s.story);
  const themeOpen = useUI((s) => s.themeOpen);
  const surprise = useUI((s) => s.surprise);
  const reportFor = useUI((s) => s.reportFor);

  // While a full-screen overlay is open, the page underneath must not scroll.
  const locked = story !== null || surprise;
  useEffect(() => {
    document.documentElement.style.overflow = locked ? 'hidden' : '';
  }, [locked]);

  return (
    <>
      <AnimatePresence>
        {story !== null && <Suspense key="story" fallback={null}><StoryViewer start={story} /></Suspense>}
        {themeOpen && <Suspense key="theme" fallback={null}><ThemeSheet /></Suspense>}
        {surprise && <Suspense key="surprise" fallback={null}><Surprise /></Suspense>}
      </AnimatePresence>
      {reportFor && <Suspense fallback={null}><ReportDialog card={reportFor} /></Suspense>}
      <Toaster />
      <Confetti />
    </>
  );
}

function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <m.div key={t.id} layout initial={{ opacity: 0, y: -24, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="brut flex max-w-md items-center gap-3 bg-surface px-4 py-3 text-sm font-bold">
            <span className="text-xl" aria-hidden="true">{t.icon}</span>{t.text}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const COLORS = ['#b6ff3b', '#ff4fd8', '#2de2e6', '#ff8a1f', '#9b6bff', '#ffe14d'];

/** A one-shot confetti burst: each piece gets its own launch angle and falls under its own "gravity". */
function Confetti() {
  const burst = useUI((s) => s.confetti);
  const [pieces, setPieces] = useState<{ id: string; x: number; y: number; r: number; c: string }[]>([]);
  useEffect(() => {
    if (!burst) return;
    setPieces(Array.from({ length: 28 }, (_, i) => ({
      id: `${burst}-${i}`,
      x: (Math.random() - 0.5) * window.innerWidth * 0.9,
      y: -(window.innerHeight * (0.25 + Math.random() * 0.35)),
      r: (Math.random() - 0.5) * 720,
      c: COLORS[i % COLORS.length],
    })));
    const t = setTimeout(() => setPieces([]), 1800);
    return () => clearTimeout(t);
  }, [burst]);
  return (
    <div aria-hidden="true" className="pointer-events-none fixed bottom-0 left-1/2 z-[65]">
      {pieces.map((p) => (
        <m.span key={p.id} className="absolute block size-3 border-2 border-black" style={{ background: p.c }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: p.x, y: [0, p.y, p.y * 0.2 + 200], rotate: p.r, opacity: [1, 1, 0] }}
          transition={{ duration: 1.6, ease: [0.15, 0.8, 0.35, 1], times: [0, 0.45, 1] }} />
      ))}
    </div>
  );
}
