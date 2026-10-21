import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns schema.ts changes into SQL files under ./drizzle (no DB connection needed).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL ?? '' },
});
