// One-shot: apply SQL migrations, then make sure an owner account exists.
// Runs as the compose "migrate" service on every deploy, against Postgres directly (not PgBouncer),
// because DDL and the migrator's lock need a real session.
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { hashPassword } from './crypto.ts';
import { assertEnv, env } from './env.ts';
import { users } from './schema.ts';

assertEnv(['DATABASE_URL']);
const client = postgres(env.directDatabaseUrl, { max: 1, onnotice: () => {} });
const db = drizzle(client, { casing: 'snake_case' });

await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
console.log('migrations applied');

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1);
if (!owner && email && password) {
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  await db.insert(users).values({ email, name: 'Owner', role: 'owner', status: 'active', passwordHash: await hashPassword(password) });
  console.log(`owner account created for ${email}`);
} else if (!owner) {
  console.warn('no owner account yet: set ADMIN_EMAIL and ADMIN_PASSWORD, then re-run migrate');
}
await client.end();
