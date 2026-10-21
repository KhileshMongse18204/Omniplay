import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual,
} from 'node:crypto';
import { env } from './env.ts';

// All hashing here is built into Node, so there are no native addons to compile on the VPS.
// scrypt runs on libuv's thread pool, so password checks never block the event loop.

const key = () => createHash('sha256').update(env.secretsKey).digest(); // 32-byte AES key from any passphrase

/** AES-256-GCM for secrets stored in the settings table (API keys, SMTP password, CF token). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, body] = blob.split(':');
  if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('Not an encrypted value');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

/** Visitor fingerprint for de-dupe and rate limits: HMAC of IP + UTC day, so it can't be linked across days. */
export const visitorHash = (ip: string, day: string) =>
  createHmac('sha256', env.ipHashSalt).update(`${ip}|${day}`).digest('hex').slice(0, 32);

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

const N = 16_384, R = 8, P = 1, LEN = 32; // ~16 MB per hash
const derive = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((ok, fail) =>
    scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, k) => (err ? fail(err) : ok(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await derive(pw, salt)).toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const [algo, salt, hash] = (stored ?? '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(pw, Buffer.from(salt, 'base64url'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
