import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// Admin API client. The short-lived access token lives only in memory (never localStorage, so an XSS can't
// lift a long-lived credential). On a 401 it calls /auth/refresh once (concurrent callers share that one
// call) using the httpOnly refresh cookie, then retries the request.

export const API = import.meta.env.VITE_API_URL;

export type Role = 'owner' | 'editor' | 'moderator';
export type User = { id: number; email: string; name: string; role: Role };
type Auth = { status: 'loading' | 'in' | 'out'; user: User | null };

let auth: Auth = { status: 'loading', user: null };
let token: string | null = null;
const subs = new Set<() => void>();
const setAuth = (next: Auth) => { auth = next; subs.forEach((f) => f()); };
export const useAuth = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => auth);

const rank: Record<Role, number> = { moderator: 1, editor: 2, owner: 3 };
export const can = (user: User | null, min: Role) => !!user && rank[user.role] >= rank[min];

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readError(res: Response) {
  const data = await res.json().catch(() => null) as { error?: string } | null;
  return new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
}

const startSession = (d: { accessToken: string; user: User }) => { token = d.accessToken; setAuth({ status: 'in', user: d.user }); };

let refreshing: Promise<boolean> | null = null;
export function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${API}/admin/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => { if (!r.ok) return false; startSession(await r.json()); return true; })
    .catch(() => false)
    .then((ok) => { if (!ok) { token = null; setAuth({ status: 'out', user: null }); } return ok; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/admin/auth/login`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await readError(res);
  startSession(await res.json());
}

export async function logout() {
  await fetch(`${API}/admin/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  token = null;
  setAuth({ status: 'out', user: null });
}

/** Unauthenticated auth endpoints (invite acceptance, sign-up, sign-up config). */
export async function publicCall<T>(path: string, json?: unknown): Promise<T> {
  const res = await fetch(`${API}/admin/auth${path}`, json === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json),
  });
  if (!res.ok) throw await readError(res);
  return (res.status === 204 ? null : await res.json()) as T;
}

type Init = { method?: string; json?: unknown; body?: BodyInit; type?: string };

async function authed(path: string, init: Init = {}): Promise<Response> {
  const go = () => fetch(`${API}/admin${path}`, {
    method: init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET'),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Content-Type only when there IS a body (Fastify rejects a JSON content-type with an empty body).
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : init.type ? { 'content-type': init.type } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  let res = await go();
  if (res.status === 401 && (await refresh())) res = await go();
  if (!res.ok) throw await readError(res);
  return res;
}

export async function api<T>(path: string, init?: Init): Promise<T> {
  const res = await authed(path, init);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Authenticated file download (exports): fetch → blob → temporary <a download>. */
export async function download(path: string, filename: string) {
  const blob = await (await authed(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * GET with loading/error state. While it refetches it keeps the previous data (pages dim instead of
 * flashing a skeleton), and `reload()` refetches after a mutation.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path).then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (e: Error) => { if (live) setState((s) => ({ ...s, error: e.message, loading: false })); },
    );
    return () => { live = false; };
  }, [path, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
