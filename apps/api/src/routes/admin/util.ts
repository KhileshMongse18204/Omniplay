import { Type } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { logActivity } from '@omniplay/core/activity';
import { clearCache } from '@omniplay/core/cache';
import { categories } from '@omniplay/core/schema';

/** "Music › Download" instead of an ambiguous "Download". Pair with .leftJoin(parentCategory, …parentId). */
export const parentCategory = alias(categories, 'parent');
export const categoryLabel = sql<string>`coalesce(${parentCategory.name} || ' › ', '') || ${categories.name}`;

export const Id = Type.Object({ id: Type.Integer({ minimum: 1 }) });
export const LinkStatus = Type.Union([Type.Literal('active'), Type.Literal('draft'), Type.Literal('hidden'), Type.Literal('broken')]);

/** Error carrying an HTTP status; the global error handler turns it into a JSON response. */
export const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

/**
 * After any write that changes public data: drop the Redis response cache (public reads rebuild on the
 * next request; Cloudflare's copy expires within its short s-maxage) and record the activity entry.
 */
export async function contentChanged(actorId: number | null, action: string, summary: string): Promise<void> {
  await clearCache().catch(() => 0);
  void logActivity(actorId, action, summary);
}
