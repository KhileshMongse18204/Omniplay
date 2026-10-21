import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

// A small set of admin UI pieces in plain Tailwind, so the panel needs no component-library dependency.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const variants = {
  primary: 'border-ink bg-ink text-white hover:bg-[#2b2b2b]',
  secondary: 'border-line bg-surface text-ink hover:bg-[#f1f1ee]',
  danger: 'border-[#e8b4b4] bg-surface text-critical-text hover:bg-[#fdf1f1]',
  ghost: 'border-transparent bg-transparent text-secondary hover:bg-[#ecece8] hover:text-ink',
};

export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button type="button" {...p}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50', variants[variant], className)} />
  );
}

const control = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-page';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(control, 'pr-7', className)} />;

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-left text-[13px] disabled:opacity-50">
      <span className={cx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-baseline')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium', value === t.id ? 'border-ink text-ink' : 'border-transparent text-secondary hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Native <dialog>: focus trap, Esc and backdrop come built in. */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}
      className={cx('m-auto max-h-[90dvh] w-[min(94vw,520px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl', wide && 'w-[min(94vw,760px)]')}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <Button variant="ghost" aria-label="Close" onClick={onClose} className="px-2">✕</Button>
      </header>
      <div className="px-5 py-4">{children}</div>
      {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
    </dialog>
  );
}

/** Status shown as icon + label (never colour alone). */
type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';
const tones: Record<Tone, { icon: string; cls: string }> = {
  good: { icon: '✓', cls: 'bg-[#e9f6e9] text-good-text' },
  warning: { icon: '!', cls: 'bg-[#fdf4dd] text-[#7a5200]' },
  serious: { icon: '!', cls: 'bg-[#fdebe3] text-[#8f3a17]' },
  critical: { icon: '✕', cls: 'bg-[#fbe9e9] text-critical-text' },
  neutral: { icon: '•', cls: 'bg-[#efefec] text-secondary' },
};
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = tones[tone];
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-medium', t.cls)}>
      <span aria-hidden="true" className="font-bold">{t.icon}</span>{children}
    </span>
  );
}

export const linkTone = { active: 'good', draft: 'neutral', hidden: 'warning', broken: 'critical' } as const;

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-8 text-center text-[13px] text-muted">{children}</p>;
export const ErrorNote = ({ children }: { children: ReactNode }) => children ? <p role="alert" className="rounded-md bg-[#fbe9e9] px-3 py-2 text-[13px] text-critical-text">{children}</p> : null;

/** Table shell: horizontal scroll on small screens, hairline rows, muted header. */
export function Table({ head, children, dim }: { head: ReactNode[]; children: ReactNode; dim?: boolean }) {
  return (
    <div className={cx('overflow-x-auto transition-opacity', dim && 'opacity-60')}>
      <table className="w-full text-left text-[13px]">
        <thead><tr className="border-b border-line text-xs text-muted">{head.map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-3 py-2 align-middle', className)}>{children}</td>;

export const fmt = (n: number) => new Intl.NumberFormat('en', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

// Toasts: tiny store so any page can confirm an action.
let toasts: { id: number; text: string; tone: Tone }[] = [];
const tsubs = new Set<() => void>();
let tid = 0;
export function notify(text: string, tone: Tone = 'good') {
  const t = { id: ++tid, text, tone };
  toasts = [...toasts, t];
  tsubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); tsubs.forEach((f) => f()); }, 3500);
}
export function Toasts() {
  const list = useSyncExternalStore((f) => { tsubs.add(f); return () => tsubs.delete(f); }, () => toasts);
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {list.map((t) => <div key={t.id} className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] shadow-lg"><Status tone={t.tone}>{t.text}</Status></div>)}
    </div>
  );
}

/** Run an async action with a busy flag, surfacing errors as a toast. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) notify(ok); return true; } catch (e) { notify((e as Error).message, 'critical'); return false; } finally { setBusy(false); }
  };
  return { busy, run };
}
