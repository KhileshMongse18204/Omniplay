import { useSyncExternalStore } from 'react';
import type { Card } from './api';

// Global UI state (open overlays, toasts) in a ~15-line store: components subscribe to the one field they
// read, so opening the story viewer doesn't re-render the card grid. No state library needed.

export type Toast = { id: number; icon: string; text: string };
type UI = { story: number | null; themeOpen: boolean; surprise: boolean; reportFor: Card | null; toasts: Toast[]; confetti: number };

let state: UI = { story: null, themeOpen: false, surprise: false, reportFor: null, toasts: [], confetti: 0 };
const subs = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UI>) {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  },
};

export function useUI<T>(pick: (s: UI) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => pick(state));
}

let toastId = 0;
export function toast(icon: string, text: string) {
  const t = { id: ++toastId, icon, text };
  ui.set({ toasts: [...state.toasts, t] });
  setTimeout(() => ui.set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 3800);
}
export const celebrate = () => ui.set({ confetti: state.confetti + 1 });

/** localStorage that never throws (private mode, blocked storage). Only used for per-visitor niceties. */
export const local = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};
