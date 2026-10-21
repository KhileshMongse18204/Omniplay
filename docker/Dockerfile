# One image for the API, the worker and the migrate step (compose picks the command).
# Perf: Node runs the TypeScript sources directly (built-in type stripping), so the image has no
# build stage, no transpiler and no source maps, just production deps plus source.
FROM node:22-alpine

# pg_dump for the scheduled backup job; its version must match the Postgres 17 server.
RUN apk add --no-cache postgresql17-client

WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

# Manifests first, so source edits don't bust the cached npm layer. Every workspace manifest is
# copied because npm ci validates them against the lockfile; only backend deps are installed.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN npm ci --omit=dev --no-audit --no-fund -w @omniplay/core -w @omniplay/api -w @omniplay/worker \
 && npm cache clean --force

COPY packages/core packages/core
COPY apps/api apps/api
COPY apps/worker apps/worker

USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.ts"]
