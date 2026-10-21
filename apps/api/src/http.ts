import type { FastifyRequest } from 'fastify';
import { visitorHash } from '@omniplay/core/crypto';
import { dayKey } from '@omniplay/core/redis';

/**
 * Real client IP. Cloudflare sends it as CF-Connecting-IP, and the origin is only reachable through the
 * tunnel (ports bind to 127.0.0.1), so the header can be trusted. Locally it falls back to the socket IP.
 */
export const clientIp = (req: FastifyRequest) => (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip;

/** Privacy-safe visitor id for de-dupe: an HMAC of IP + day, never the raw IP. */
export const visitor = (req: FastifyRequest) => visitorHash(clientIp(req), dayKey());

/** Escape LIKE wildcards in user input so a search for "100%" isn't treated as a pattern. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Postgres SQLSTATE from a driver error (Drizzle wraps the driver error in `cause`). */
export const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
};
