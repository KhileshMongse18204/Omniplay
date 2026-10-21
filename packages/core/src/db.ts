import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from './env.ts';
import * as schema from './schema.ts';

// Connections go through PgBouncer in transaction mode, which shares ~20 real Postgres connections
// across every process. prepare:false because named prepared statements don't survive transaction
// pooling. max caps this process's client connections; idle ones close after 20s to free RAM.
export const pg = postgres(env.databaseUrl, {
  max: env.dbPoolMax,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(pg, { schema, casing: 'snake_case' });
export type Db = typeof db;
