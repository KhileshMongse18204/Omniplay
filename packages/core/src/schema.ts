// Drizzle schema. Perf rule: every column used in WHERE / JOIN / ORDER BY has an index
// (the index list under each table says which query uses it).
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text,
  timestamp, uniqueIndex, varchar, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const linkStatus = pgEnum('link_status', ['active', 'draft', 'hidden', 'broken']);
export const staffRole = pgEnum('staff_role', ['owner', 'editor', 'moderator']);
export const staffStatus = pgEnum('staff_status', ['invited', 'pending', 'active', 'disabled']);
export const reportReason = pgEnum('report_reason', ['dead', 'wrong_link', 'malicious']);
export const reportStatus = pgEnum('report_status', ['open', 'resolved', 'dismissed']);

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  email: varchar({ length: 254 }).notNull(), // stored lowercased
  name: varchar({ length: 80 }).notNull().default(''),
  passwordHash: text(),
  role: staffRole().notNull().default('moderator'),
  status: staffStatus().notNull().default('invited'),
  // Bumped on logout/disable/role change: refresh tokens carrying an older version stop working.
  tokenVersion: integer().notNull().default(0),
  inviteTokenHash: varchar({ length: 64 }),
  inviteExpiresAt: timestamp({ withTimezone: true }),
  lastLoginAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('users_email_uq').on(t.email), // login lookup
  uniqueIndex('users_invite_uq').on(t.inviteTokenHash), // accept-invite lookup
  index('users_status_idx').on(t.status), // staff list filter
  index('users_role_idx').on(t.role), // "is there an owner yet?" at bootstrap
]);

export const categories = pgTable('categories', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  parentId: integer().references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
  slug: varchar({ length: 80 }).notNull(),
  name: varchar({ length: 80 }).notNull(),
  description: varchar({ length: 280 }).notNull().default(''),
  icon: varchar({ length: 16 }).notNull().default(''), // emoji: zero image requests for the menu
  color: varchar({ length: 16 }).notNull().default('#b6ff3b'),
  sortOrder: integer().notNull().default(0),
  isVisible: boolean().notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('categories_slug_uq').on(t.slug), // /v1/links?category=slug
  index('categories_parent_sort_idx').on(t.parentId, t.sortOrder), // menu tree + parent join
  index('categories_visible_sort_idx').on(t.isVisible, t.sortOrder), // public menu
]);

export const links = pgTable('links', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  categoryId: integer().notNull().references(() => categories.id, { onDelete: 'restrict' }),
  title: varchar({ length: 120 }).notNull(),
  url: text().notNull(),
  description: varchar({ length: 280 }).notNull().default(''),
  tags: text().array().notNull().default(sql`'{}'::text[]`),
  status: linkStatus().notNull().default('draft'),
  isFeatured: boolean().notNull().default(false),
  // R2 key prefix; the worker writes <prefix>-<width>.<avif|webp>. Null = CSS placeholder (no request).
  imageKey: varchar({ length: 120 }),
  // Lowercased title + description + tags, kept in sync by the app; trigram-indexed for infix search.
  searchText: text().notNull().default(''),
  // 30-day clicks, denormalised by the trending job so listings sort without joining click tables.
  popularity: integer().notNull().default(0),
  checkFailures: smallint().notNull().default(0),
  checkCode: smallint(), // last HTTP status, 0 = network error/timeout
  checkedAt: timestamp({ withTimezone: true }),
  autoBroken: boolean().notNull().default(false), // set by the checker, so it may auto-restore
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Public grid: WHERE category_id/status ORDER BY featured, popularity, id
  index('links_public_idx').on(t.categoryId, t.status, t.isFeatured, t.popularity, t.id),
  // Swipe feed + stories: WHERE status ORDER BY featured, popularity, id
  index('links_feed_idx').on(t.status, t.isFeatured, t.popularity, t.id),
  index('links_check_idx').on(t.status, t.checkedAt), // link-checker batch selection
  index('links_health_idx').on(t.status, t.checkFailures), // dashboard broken/failing alerts
  index('links_tags_gin').using('gin', t.tags), // tag filter (tags @> ARRAY[...])
  index('links_search_trgm').using('gin', t.searchText.op('gin_trgm_ops')), // LIKE '%q%'
  index('links_url_idx').on(t.url), // import de-duplication
  index('links_created_idx').on(t.createdAt), // admin "newest" sort
  index('links_popularity_idx').on(t.popularity), // admin "popular" sort
  index('links_title_idx').on(t.title), // admin "title" sort
]);

export const reports = pgTable('reports', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  linkId: integer().notNull().references(() => links.id, { onDelete: 'cascade' }),
  reason: reportReason().notNull(),
  note: varchar({ length: 500 }).notNull().default(''),
  ipHash: varchar({ length: 64 }).notNull(), // daily-rotating HMAC, never the raw IP
  status: reportStatus().notNull().default('open'),
  resolvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('reports_queue_idx').on(t.status, t.createdAt), // moderation queue
  index('reports_link_idx').on(t.linkId, t.status), // join to links + per-link resolve
  index('reports_resolved_by_idx').on(t.resolvedBy),
]);

// Analytics tables hold daily aggregates flushed from Redis counters once a minute,
// so a burst of clicks becomes one upsert per link, not one INSERT per click.
export const linkClicksDaily = pgTable('link_clicks_daily', {
  day: date().notNull(),
  linkId: integer().notNull().references(() => links.id, { onDelete: 'cascade' }),
  clicks: integer().notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.day, t.linkId] }), // date-range scans
  index('clicks_link_day_idx').on(t.linkId, t.day), // per-link series + popularity join
]);

export const searchQueriesDaily = pgTable('search_queries_daily', {
  day: date().notNull(),
  query: varchar({ length: 100 }).notNull(),
  count: integer().notNull().default(0),
  results: integer().notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.day, t.query] }),
  index('search_day_results_idx').on(t.day, t.results), // content gaps (results = 0)
]);

export const trafficDaily = pgTable('traffic_daily', {
  day: date().primaryKey(),
  pageviews: integer().notNull().default(0),
  visitors: integer().notNull().default(0),
  clicks: integer().notNull().default(0),
  searches: integer().notNull().default(0),
});

export const settings = pgTable('settings', {
  key: varchar({ length: 40 }).primaryKey(),
  value: jsonb().notNull(), // secrets inside are AES-GCM encrypted (see settings.ts)
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer().references(() => users.id, { onDelete: 'set null' }),
}, (t) => [index('settings_updated_by_idx').on(t.updatedBy)]);

export const activityLog = pgTable('activity_log', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: integer().references(() => users.id, { onDelete: 'set null' }), // null = system/worker
  action: varchar({ length: 40 }).notNull(),
  summary: varchar({ length: 300 }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('activity_created_idx').on(t.createdAt), // dashboard feed
  index('activity_actor_idx').on(t.actorId),
]);
