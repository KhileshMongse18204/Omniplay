import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { m } from 'motion/react';
import { Link, useLocation } from 'wouter';
import { topLevel, useBoot } from '../boot';
import { useExploredCount } from '../easter';
import { celebrate, toast, ui } from '../store';
import { Icon, type IconName } from './Icon';

// App chrome: top nav (desktop), app-style bottom tabs (mobile), footer, plus the full-screen states
// (splash, maintenance, offline, 404).

export function Logo({ interactive = true }: { interactive?: boolean }) {
  const [jelly, setJelly] = useState(0);
  const taps = useRef<number[]>([]);
  const onClick = () => {
    if (!interactive) return;
    // Easter egg: five quick taps make the logo wobble like jelly and throw confetti.
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1500), now];
    if (taps.current.length < 5) return;
    taps.current = [];
    setJelly((j) => j + 1);
    celebrate();
    toast('🍮', 'You found the jelly logo. Nice reflexes!');
  };
  return (
    <Link href="/" onClick={onClick} aria-label="OmniPlay home" className="flex items-center gap-2">
      {/* Re-keying replays the wobble through LazyMotion, so the full animate() engine stays out of the first-load bundle. */}
      <m.span key={jelly} animate={jelly ? { scaleX: [1, 1.35, 0.8, 1.12, 0.95, 1], scaleY: [1, 0.7, 1.2, 0.92, 1.04, 1] } : undefined}
        transition={{ duration: 0.9 }}
        className="grid size-8 place-items-center border-[2.5px] border-line bg-accent text-accent-ink shadow-[3px_3px_0_var(--line)]">
        <Icon name="play" size={14} filled />
      </m.span>
      <span className="display text-xl tracking-tight">Omni<span className="text-accent">play</span></span>
    </Link>
  );
}

export function SurpriseButton({ className = '' }: { className?: string }) {
  return (
    <m.button type="button" whileTap={{ rotate: 25, scale: 0.92 }} onClick={() => ui.set({ surprise: true })} className={className}>
      <Icon name="dice" size={18} /> Surprise me
    </m.button>
  );
}

export function TopNav() {
  const [location, navigate] = useLocation();
  const boot = useBoot();
  const explored = useExploredCount();
  const tops = topLevel(boot).length;

  // "/" or Ctrl/⌘+K jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]');
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const links: [string, string][] = [['/', 'Home'], ['/feed', 'Feed'], ['/search', 'Search']];
  return (
    <header className="glass sticky top-0 z-40 border-b-[2.5px] border-line">
      <div className="mx-auto flex h-[60px] max-w-7xl items-center gap-3 px-4">
        <Logo />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {links.map(([href, label]) => {
            const active = href === '/' ? location === '/' || location.startsWith('/c/') : location.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={`relative px-3 py-1.5 text-sm font-extrabold ${active ? '' : 'text-muted hover:text-ink'}`}>
                {label}
                {active && <m.span layoutId="nav-underline" className="absolute inset-x-2 -bottom-[13px] h-[3px] bg-accent" />}
              </Link>
            );
          })}
          <kbd className="label ml-1 border border-current/30 px-1.5 py-0.5 text-[10px] text-muted">/</kbd>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span title="Open every category to earn the Explorer badge" className="label hidden items-center gap-1.5 border-2 border-line px-2 py-1.5 sm:flex">
            <Icon name="compass" size={14} /> {explored}/{tops}
          </span>
          <SurpriseButton className="btn btn-accent hidden py-2 text-sm md:inline-flex" />
          <button type="button" onClick={() => ui.set({ themeOpen: true })} aria-label="Personalise colours" className="btn p-2">
            <Icon name="palette" size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/feed', label: 'Feed', icon: 'play' },
  { href: '/search', label: 'Search', icon: 'search' },
];

/** Mobile app-style navigation: glass bottom tabs with a spring-animated pill and a raised dice button. */
export function BottomTabs() {
  const [location] = useLocation();
  const tab = (t: (typeof TABS)[number]) => {
    const active = t.href === '/' ? location === '/' || location.startsWith('/c/') : location.startsWith(t.href);
    return (
      <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
        className={`relative flex flex-1 flex-col items-center gap-0.5 py-1.5 ${active ? 'text-accent-ink' : 'text-muted'}`}>
        {active && <m.span layoutId="tab-pill" transition={{ type: 'spring', stiffness: 500, damping: 34 }} className="absolute inset-0 -z-10 bg-accent" />}
        <Icon name={t.icon} size={20} filled={t.icon === 'play' && active} />
        <span className="label text-[9.5px]">{t.label}</span>
      </Link>
    );
  };
  return (
    <nav aria-label="App" className="glass fixed inset-x-3 bottom-3 z-40 flex items-center border-[2.5px] border-line p-1.5 shadow-[4px_4px_0_var(--line)] md:hidden"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      {tab(TABS[0])}
      {tab(TABS[1])}
      <m.button type="button" aria-label="Surprise me" whileTap={{ rotate: 90, scale: 0.9 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        onClick={() => ui.set({ surprise: true })}
        className="mx-1 -mt-7 grid size-14 shrink-0 place-items-center border-[2.5px] border-line bg-accent text-accent-ink shadow-[4px_4px_0_var(--line)]">
        <Icon name="dice" size={26} />
      </m.button>
      {tab(TABS[2])}
      <button type="button" onClick={() => ui.set({ themeOpen: true })} className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-muted">
        <Icon name="palette" size={20} />
        <span className="label text-[9.5px]">Theme</span>
      </button>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto mt-24 max-w-7xl border-t-[2.5px] border-line px-4 pb-32 pt-10 md:pb-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Logo interactive={false} />
          <p className="mt-3 max-w-md text-sm text-muted">
            OmniPlay is a directory: we link to other websites and host no media ourselves. Spot a dead, wrong or shady
            link? Hit the <Icon name="flag" size={12} className="inline" /> on its card and a moderator will check it.
          </p>
        </div>
        <p className="label text-muted">© {new Date().getFullYear()} OmniPlay · no accounts, ever</p>
      </div>
    </footer>
  );
}

function FullScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="brut max-w-lg bg-surface p-8">
        <h1 className="display text-5xl">{title}</h1>
        <div className="mt-4 text-muted">{children}</div>
      </div>
    </div>
  );
}

export const Maintenance = ({ message }: { message: string }) => <FullScreen title="BRB 🔧">{message}</FullScreen>;

export const NotFound = () => (
  <FullScreen title="404">
    This playground doesn't exist (yet). <Link href="/" className="font-bold text-ink underline">Back to the directory →</Link>
  </FullScreen>
);

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <span className="grid size-14 animate-pulse place-items-center border-[2.5px] border-line bg-accent text-accent-ink shadow-[5px_5px_0_var(--line)]">
        <Icon name="play" size={22} filled />
      </span>
    </div>
  );
}

export const PageLoader = () => <div className="grid h-[60dvh] place-items-center"><span className="label animate-pulse text-muted">Loading…</span></div>;

/** If the API can't be reached, show a retry screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <Offline />;
  }
}

function Offline() {
  const [busy, setBusy] = useState(false);
  return (
    <FullScreen title="Offline?">
      We couldn't reach OmniPlay. Check your connection and try again.
      <button type="button" className="btn btn-accent mt-5" disabled={busy} onClick={() => { setBusy(true); location.reload(); }}>Retry</button>
    </FullScreen>
  );
}
