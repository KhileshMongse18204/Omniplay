import { Redis } from 'ioredis';
import { env } from './env.ts';

// One connection per process handles all cache/counter traffic. Auto-pipelining batches every command
// issued in the same tick into a single round trip, which matters at ~300 req/s.
export const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, enableAutoPipelining: true });

// BullMQ gets its own connections. Workers use blocking commands, so they need unlimited retries;
// producers (the API) fail fast so an HTTP request never hangs while Redis is down.
export const queueConnection = (blocking: boolean) =>
  new Redis(env.redisUrl, { maxRetriesPerRequest: blocking ? null : 2 });

const DAY_TTL = 3 * 86_400; // counters only have to survive until the next 60s flush; 3 days is slack

/** UTC day key, e.g. 2026-10-20. Stats are bucketed per UTC day. */
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** All Redis key names in one place, so the admin "clear keys" tool and jobs agree on them. */
export const K = {
  clicks: (day: string) => `stats:clicks:${day}`, // hash linkId -> clicks
  clickSeen: (linkId: number, visitor: string) => `stats:cs:${linkId}:${visitor}`, // 1h de-dupe
  search: (day: string) => `stats:search:${day}`, // hash query -> count
  searchResults: (day: string) => `stats:sres:${day}`, // hash query -> last result count
  traffic: (day: string) => `stats:traffic:${day}`, // hash pv/clicks/searches
  visitors: (day: string) => `stats:uv:${day}`, // HyperLogLog: ~12 KB per day for unique visitors
  reportSeen: (linkId: number, visitor: string) => `rep:${linkId}:${visitor}`, // 24h de-dupe
  trending: 'meta:trending',
  sitemap: 'meta:sitemap:xml',
  lastRun: (job: string) => `meta:last:${job}`,
};
export { DAY_TTL };
