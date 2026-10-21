# OmniPlay

A link directory of entertainment websites (watch, listen, play, read) with a Neo-Brutalist public site and a
plain admin panel. Built for one cheap VPS (2 vCPU / 2 GB) behind Cloudflare, targeting ~300 req/s.

```
omniplay/
├─ apps/
│  ├─ api/        Fastify API: public directory + admin. Stateless, Redis-cached, JWT for staff only
│  ├─ worker/     BullMQ worker: link checks, image encoding, stats flush, trending, sitemap, backups, email, imports
│  ├─ web/        Public site: Vite + React SPA → Cloudflare Pages (+ one tiny Pages Function for ads.txt/sitemap/robots)
│  └─ admin/      Admin panel: Vite + React SPA → Cloudflare Pages on its own subdomain
├─ packages/
│  └─ core/       Shared: Drizzle schema + migrations, DB pool, Redis, queue, settings, R2 storage, crypto, CSV
├─ docker/Dockerfile      One image for api / worker / migrate (Node runs the TypeScript directly, no build step)
├─ docker-compose.yml     postgres · pgbouncer · redis · migrate · api · worker · cloudflared (prod profile)
└─ .env.example
```

## Local development

Requires Node 22.18+ and Docker.

```bash
cp .env.example .env          # dev defaults work as-is (R2 uploads stay off until you add keys)
npm install
docker compose up -d --build  # Postgres, PgBouncer, Redis, migrations, API (http://localhost:3000), worker
npm run db:seed               # demo categories + a few free, legal sites
npm run dev:web               # http://localhost:5173
npm run dev:admin             # http://localhost:5174 (sign in with ADMIN_EMAIL / ADMIN_PASSWORD from .env)
```

To work on the backend with instant reloads, run only the infrastructure in Docker
(`docker compose up -d postgres pgbouncer redis`), then `npm run dev:api` and `npm run dev:worker`.

Checks: `npm run typecheck` · `npm test` · `npm run build`.

## Deploying: one VPS + Cloudflare

**VPS** (any $5–10 box with Docker):

1. Clone the repo and run `cp .env.example .env`. Then replace **every** secret: `POSTGRES_PASSWORD` (also inside both
   database URLs), `JWT_SECRET`, `SECRETS_KEY`, `IP_HASH_SALT` and `ADMIN_PASSWORD`. Set `WEB_ORIGIN` / `ADMIN_ORIGIN`
   to your real domains, fill in `R2_*`, and add `CLOUDFLARE_TUNNEL_TOKEN`.
2. `docker compose --profile prod up -d --build`
3. Firewall: allow SSH only. The tunnel is outbound, so no HTTP port is ever exposed.

**Cloudflare:**

1. **Tunnel**: Zero Trust → Networks → Tunnels → create one, copy its token into `.env`, and add the public hostname
   `api.example.com → http://api:3000`.
2. **Cache Rule** for the API: `hostname eq "api.example.com"` and method GET and path starting with `/v1/`, `/ads.txt`,
   `/sitemap.xml` or `/robots.txt`. Set it to "Eligible for cache" with Edge TTL "Use cache-control header". The API sends
   `s-maxage`, so most reads never reach the VPS.
3. **WAF**: keep the managed rules on, and add a rate-limiting rule on the API host as the outer limit. The API also
   enforces its own per-IP limits in Redis, editable in the admin.
4. **Pages: public site**. Root directory `apps/web`, build command `npm run build`, output `dist`.
   Build variable `VITE_API_URL=https://api.example.com`; runtime variable `API_URL=https://api.example.com`
   (used by `functions/_middleware.ts`); `NODE_VERSION=22`. Custom domain: `example.com`.
5. **Pages: admin**. Root directory `apps/admin`, same build settings, custom domain `admin.example.com`.
   The admin and API must share the registrable domain, because the refresh cookie is `SameSite=Strict`.
   Recommended: put Cloudflare Access (free, email one-time code) in front of `admin.example.com`.
6. **R2**: create a bucket, connect a public custom domain (e.g. `media.example.com` → `R2_PUBLIC_URL`), and create an
   API token with Object Read & Write.
7. In **Admin → Settings**, set the site URL (SEO), the Cloudflare zone ID + API token (for purges), and SMTP (for invites).

## Admin roles

| Role | Can |
|---|---|
| moderator | dashboard, read-only links, user-reports queue |
| editor | + links (CRUD, bulk, import/export, images), categories, analytics |
| owner | + settings (APIs, caching, SEO, cron, security) and staff accounts |

Staff join by invite (the link also works as a password reset) or, if the owner enables it, by self sign-up
under the registration rules.

## Where each performance rule lives

| Rule | Implementation |
|---|---|
| Static-CDN frontend, code splitting | `apps/web`: Vite SPA; routes and overlays are `lazy()` chunks; Motion's features load after first paint |
| Minify HTML/CSS/JS | `vite.config.ts` (Oxc + Lightning CSS + the small HTML minifier plugin) |
| Lazy loading, preload critical assets | `index.html` preloads the font and `/v1/bootstrap`; images are `loading="lazy"`; tracking tags wait for browser idle (`src/scripts.ts`) |
| AVIF/WebP + `srcset` | `apps/web/src/components/Img.tsx` + `apps/worker/src/image.ts` (sharp, 4 widths × 2 formats) |
| Redis caching middleware | `apps/api/src/cache.ts`: runs after validation, single-flight on misses, edge `s-maxage` |
| Stateless JWT (admin only) | `apps/api/src/auth.ts`, `routes/admin/auth.ts`: 15-min access token in memory + httpOnly refresh cookie |
| Background jobs | `packages/core/src/queue.ts` + `apps/worker`: handlers only enqueue |
| Exact fields only | TypeBox response schemas (fast-json-stringify drops anything not listed) and column-level selects |
| Compression | `@fastify/compress` (Brotli q4 / gzip, ≥1 KB) in `apps/api/src/server.ts` |
| PgBouncer + pool | `docker-compose.yml` (transaction mode, pool 20) + `packages/core/src/db.ts` (`prepare: false`) |
| Indexes, no N+1 | `packages/core/src/schema.ts` (every index names the query it serves); listings are single statements |
| Stats at 300 req/s | clicks, pageviews and searches are Redis counters, flushed to daily tables once a minute |

Measured locally: a cached endpoint served ~2,250 req/s (p50 17 ms) from one Node process through Docker Desktop,
with Brotli on, before any Cloudflare caching.

## Known shortcuts (search the code for `shortcut:`)

- Meta tags are set client-side: Google renders them, but social link previews use `index.html`'s defaults.
- One Redis instance (`noeviction`) serves cache, counters and queues; cache keys stay bounded by their short TTLs.
- R2 image variants aren't deleted when a link is deleted.
- Backups are read into memory before upload: fine for this database's size; stream them past ~100 MB.
- One API process uses one CPU core (the other is left for Postgres/Redis/worker); add replicas if CPU becomes the limit.
