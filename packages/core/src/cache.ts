import { redis } from './redis.ts';

// Every response cached by the API's cache middleware lives under this prefix.
export const CACHE_PREFIX = 'cache:';

/**
 * Delete cached responses matching a glob. SCAN + UNLINK never blocks Redis: SCAN walks the keyspace in
 * small steps and UNLINK frees memory in a background thread. Restricted to cache:* so the admin tool
 * can't wipe queues or counters.
 */
export async function clearCache(pattern = `${CACHE_PREFIX}*`): Promise<number> {
  if (!pattern.startsWith(CACHE_PREFIX)) throw new Error(`Only ${CACHE_PREFIX}* keys can be cleared`);
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length) removed += await redis.unlink(...keys);
  } while (cursor !== '0');
  return removed;
}
