import { m } from 'motion/react';
import { Icon } from '../components/Icon';
import { ui } from '../store';
import { ACCENTS, THEMES, setPrefs, usePrefs } from '../theme';

// Personalisation sheet: pick a base theme and an accent. Changes apply instantly (CSS variables) and
// persist locally. Drag the sheet down to dismiss it.

export default function ThemeSheet() {
  const prefs = usePrefs();
  const close = () => ui.set({ themeOpen: false });
  return (
    <>
      <m.div className="fixed inset-0 z-50 bg-black/50" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <m.div role="dialog" aria-modal="true" aria-label="Personalise OmniPlay"
        drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => { if (info.offset.y > 100 || info.velocity.y > 700) close(); }}
        initial={{ y: '110%' }} animate={{ y: 0 }} exit={{ y: '110%' }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="brut fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg bg-surface p-5 pb-10 md:bottom-8">
        <div className="mx-auto mb-4 h-1.5 w-12 bg-muted/50" />
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl">Make it yours</h2>
          <button type="button" onClick={close} aria-label="Close" className="btn p-2"><Icon name="close" size={16} /></button>
        </div>

        <p className="label mt-5 text-muted">Theme</p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const locked = t.id === 'arcade' && !prefs.arcade;
            const on = prefs.theme === t.id;
            return (
              <m.button key={t.id} type="button" disabled={locked} aria-pressed={on} whileTap={locked ? undefined : { scale: 0.94 }}
                onClick={() => setPrefs({ theme: t.id })}
                className={`border-[2.5px] border-line p-2 text-left ${on ? 'shadow-[4px_4px_0_var(--accent)]' : ''} ${locked ? 'opacity-60' : ''}`}>
                <span className="flex h-12 items-end gap-1 border-2 border-line p-1.5" style={{ background: t.swatch[0] }}>
                  <span className="h-full w-1/3" style={{ background: t.swatch[1] }} />
                  <span className="h-2/3 w-1/3" style={{ background: 'var(--accent)' }} />
                </span>
                <span className="mt-2 block text-sm font-extrabold">{locked ? '🔒 ' : ''}{t.name}</span>
                <span className="label block text-[9px] normal-case text-muted">{t.hint}</span>
              </m.button>
            );
          })}
        </div>

        <p className="label mt-6 text-muted">Accent</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {ACCENTS.map((a) => (
            <m.button key={a} type="button" aria-label={`Accent colour ${a}`} aria-pressed={prefs.accent === a}
              whileTap={{ scale: 0.8 }} whileHover={{ y: -3 }} onClick={() => setPrefs({ accent: a })}
              className="size-11 border-[2.5px] border-line"
              style={{ background: a, boxShadow: prefs.accent === a ? '4px 4px 0 var(--line)' : 'none' }} />
          ))}
        </div>
      </m.div>
    </>
  );
}
