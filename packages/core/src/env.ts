// Env is read once at boot into a frozen object, so hot paths read plain properties
// instead of calling process.env on every request.
const e = process.env;

export const env = Object.freeze({
  isProd: e.NODE_ENV === 'production',
  port: Number(e.PORT ?? 3000),
  databaseUrl: e.DATABASE_URL ?? '',
  // Migrations and pg_dump bypass PgBouncer: they need a real session, not a pooled transaction.
  directDatabaseUrl: e.DIRECT_DATABASE_URL ?? e.DATABASE_URL ?? '',
  dbPoolMax: Number(e.DB_POOL_MAX ?? 10),
  redisUrl: e.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: e.JWT_SECRET ?? '',
  secretsKey: e.SECRETS_KEY ?? '',
  ipHashSalt: e.IP_HASH_SALT ?? '',
  webOrigin: e.WEB_ORIGIN ?? 'http://localhost:5173',
  adminOrigin: e.ADMIN_ORIGIN ?? 'http://localhost:5174',
  r2: {
    accountId: e.R2_ACCOUNT_ID ?? '',
    accessKeyId: e.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: e.R2_SECRET_ACCESS_KEY ?? '',
    bucket: e.R2_BUCKET ?? '',
    publicUrl: (e.R2_PUBLIC_URL ?? '').replace(/\/$/, ''),
  },
});

/** Fail fast at boot (not on the first request) when an entrypoint's required vars are missing. */
export function assertEnv(keys: string[]): void {
  const missing = keys.filter((k) => !e[k]);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')} (see .env.example)`);
}
