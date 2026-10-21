import { useEffect, useSyncExternalStore } from 'react';
import { celebrate, local, toast } from './store';
import { setPrefs } from './theme';

// Gamified bits, all local to the visitor's browser (no accounts, nothing sent anywhere):
//  - Konami code (↑↑↓↓←→←→BA) unlocks the secret Arcade theme
//  - the Explorer badge: open every top-level category once
//  - tapping the logo five times (see Logo in Chrome.tsx)

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

export function useKonami() {
  useEffect(() => {
    let i = 0;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      i = key === KONAMI[i] ? i + 1 : key === KONAMI[0] ? 1 : 0;
      if (i < KONAMI.length) return;
      i = 0;
      setPrefs({ arcade: true, theme: 'arcade' });
      celebrate();
      toast('🕹️', 'Arcade mode unlocked! It now lives in your theme picker.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const KEY = 'omni:explored';
let explored = new Set(local.get<number[]>(KEY, []));
const subs = new Set<() => void>();

export function markExplored(topId: number, total: number) {
  if (explored.has(topId)) return;
  explored = new Set(explored).add(topId);
  local.set(KEY, [...explored]);
  subs.forEach((f) => f());
  if (explored.size >= total) {
    celebrate();
    toast('🧭', 'Explorer badge unlocked: you visited every corner of OmniPlay!');
  } else toast('✦', `New zone discovered (${explored.size}/${total})`);
}

export const useExploredCount = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => explored.size);
