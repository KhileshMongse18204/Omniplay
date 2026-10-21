import { eq } from 'drizzle-orm';
import { db } from './db.ts';
import { decrypt, encrypt } from './crypto.ts';
import { settings as table } from './schema.ts';

// Admin-editable settings, one JSONB row per group. Reads are cached in-process for 10s, so the hot path
// (rate limits, maintenance flag, page size) never touches Postgres; changes reach every process within 10s.

export const MASK = '••••••••'; // what the admin UI sees for a stored secret

export const DEFAULTS = {
  apis: {
    tmdbKey: '',
    rawgKey: '',
    shortener: { provider: 'bitly' as 'bitly' | 'custom', endpoint: '', apiKey: '' },
  },
  performance: {
    cloudflare: { zoneId: '', apiToken: '' },
    publicPageSize: 24,
    adminPageSize: 50,
  },
  seo: {
    siteUrl: 'http://localhost:5173',
    title: 'OmniPlay: every playground on the internet',
    description: 'A hand-checked library of sites to watch, listen, play and read, sorted by what you feel like doing.',
    ogImage: '',
    headScripts: '',
    bodyScripts: '',
    adsTxt: '',
  },
  automation: {
    linkCheck: {
      enabled: true, everyMinutes: 30, batchSize: 50, concurrency: 8, timeoutMs: 8000, recheckHours: 12, failureThreshold: 3,
    },
    backups: { enabled: false, cron: '0 3 * * *', keep: 7 },
  },
  security: {
    maintenance: { enabled: false, message: 'OmniPlay is getting a tune-up. Back in a few minutes!' },
    rateLimits: { publicPerMinute: 300, searchPerMinute: 60, reportsPerHour: 5, loginPer15Min: 10 },
    registration: {
      openSignup: false, allowedDomains: [] as string[], defaultRole: 'moderator' as 'moderator' | 'editor', requireApproval: true,
    },
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '' },
  },
};

export type Settings = typeof DEFAULTS;
export type Group = keyof Settings;
export const GROUPS = Object.keys(DEFAULTS) as Group[];

const SECRETS: Record<Group, string[]> = {
  apis: ['tmdbKey', 'rawgKey', 'shortener.apiKey'],
  performance: ['cloudflare.apiToken'],
  seo: [],
  automation: [],
  security: ['smtp.pass'],
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge `patch` onto `base`, keeping only keys that exist in `base` (unknown keys are dropped). */
function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isObj(base) || !isObj(patch)) return patch;
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(patch)) if (k in base) out[k] = merge(base[k], v);
  return out;
}
const getPath = (o: Obj, path: string) => path.split('.').reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o);
function setPath(o: Obj, path: string, value: unknown) {
  const keys = path.split('.');
  const last = keys.pop()!;
  let cur = o;
  for (const k of keys) cur = cur[k] as Obj;
  cur[last] = value;
}

const cache = new Map<Group, { at: number; value: unknown }>();

async function load(group: Group): Promise<Obj> {
  const [row] = await db.select({ value: table.value }).from(table).where(eq(table.key, group));
  const value = merge(structuredClone(DEFAULTS[group]), row?.value) as Obj;
  for (const p of SECRETS[group]) {
    const v = getPath(value, p);
    if (typeof v === 'string' && v) {
      try { setPath(value, p, decrypt(v)); } catch { setPath(value, p, ''); } // SECRETS_KEY rotated: treat as unset
    }
  }
  return value;
}

export async function getSettings<G extends Group>(group: G): Promise<Settings[G]> {
  const hit = cache.get(group);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as Settings[G];
  const value = await load(group);
  cache.set(group, { at: Date.now(), value });
  return value as Settings[G];
}

/** Merge a (validated) patch into a group. Secrets equal to MASK are kept; '' clears them. */
export async function saveSettings<G extends Group>(group: G, patch: unknown, actorId: number | null): Promise<Settings[G]> {
  const current = await load(group);
  const next = merge(structuredClone(current), patch) as Obj;
  const stored = structuredClone(next);
  for (const p of SECRETS[group]) {
    if (getPath(next, p) === MASK) setPath(next, p, getPath(current, p));
    const plain = getPath(next, p);
    setPath(stored, p, typeof plain === 'string' && plain ? encrypt(plain) : '');
  }
  const now = new Date();
  await db.insert(table).values({ key: group, value: stored, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({ target: table.key, set: { value: stored, updatedBy: actorId, updatedAt: now } });
  cache.delete(group);
  return next as Settings[G];
}

/** Copy with secrets replaced by MASK, safe to send to the admin UI. */
export function maskSecrets<G extends Group>(group: G, value: Settings[G]): Settings[G] {
  const out = structuredClone(value) as Obj;
  for (const p of SECRETS[group]) if (getPath(out, p)) setPath(out, p, MASK);
  return out as Settings[G];
}
