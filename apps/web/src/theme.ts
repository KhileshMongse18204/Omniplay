import { useSyncExternalStore } from 'react';
import { local } from './store';

// Personalised themes: a base theme (CSS-variable set) plus an accent colour. Applying one is a single
// attribute + variable write on <html>, with no re-render. index.html re-applies the saved choice before first paint.

export const THEMES = [
  { id: 'midnight', name: 'Midnight', hint: 'Dark + neon', swatch: ['#0b0b0f', '#f4f1ea'] },
  { id: 'cream', name: 'Cream', hint: 'Paper brutalism', swatch: ['#f1ede4', '#111111'] },
  { id: 'arcade', name: 'Arcade', hint: 'Secret: ↑↑↓↓←→←→BA', swatch: ['#0a0016', '#ff2bd6'] },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const ACCENTS = ['#b6ff3b', '#ff4fd8', '#2de2e6', '#ff8a1f', '#9b6bff', '#ffe14d'];

type Prefs = { theme: ThemeId; accent: string; arcade: boolean };
const KEY = 'omni:theme';
let prefs: Prefs = { theme: 'midnight', accent: ACCENTS[0], arcade: false, ...local.get<Partial<Prefs>>(KEY, {}) };
const subs = new Set<() => void>();

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.style.setProperty('--accent', prefs.accent);
  local.set(KEY, prefs);
  subs.forEach((f) => f());
}

export const usePrefs = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => prefs);
