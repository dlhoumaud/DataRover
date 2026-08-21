# syntax=docker/dockerfile:1
#
# Single, shared production Dockerfile for every Node service in this monorepo (Specs.md §21
# asks for exactly one `Dockerfile` — not one per service). Which app gets built is selected via
# the `APP_NAME` build arg; which *kind* of runtime it needs is selected via `--target`:
#
#   docker build --build-arg APP_NAME=api            --target runner            .
#   docker build --build-arg APP_NAME=worker          --target runner            .
#   docker build --build-arg APP_NAME=browser-worker  --target runner-browser-worker .
#   docker build --build-arg APP_NAME=web             --target runner-web        .
#
# (docker-compose.yml wires up exactly these four combinations — this file is never invoked by
# hand in normal use.)
#
# Uses Turborepo's own recommended pattern for monorepos (`turbo prune --docker`) rather than
# hand-listing which packages/apps/* directories a given service depends on: `turbo prune` reads
# that from the workspace graph itself, so it can never drift out of sync as dependencies change.
# It splits the pruned output into `out/json` (only every relevant package.json, for a Docker
# layer that only invalidates when *dependencies* change) and `out/full` (actual source, its own
# layer, invalidated by source changes instead).

ARG NODE_VERSION=20-alpine

# ---------------------------------------------------------------------------
# base: tooling shared by every stage that touches the monorepo
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# pruner: reduce the monorepo to just what APP_NAME actually depends on
# ---------------------------------------------------------------------------
FROM base AS pruner
ARG APP_NAME
COPY . .
RUN pnpm dlx turbo@2.10.10 prune "@datarover/${APP_NAME}" --docker

# ---------------------------------------------------------------------------
# installer: install dependencies (cached unless out/json changed), then build
# ---------------------------------------------------------------------------
FROM base AS installer
ARG APP_NAME
# Only meaningful when APP_NAME=web: Vite inlines `import.meta.env.VITE_API_URL` into the
# built JS at *build* time (there is no "runtime config" for a static SPA) — it must be the
# address a BROWSER on the host can reach (the published port), never the internal Docker
# network name a server-side container would use to reach another one.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
# Prisma's query engine binary needs OpenSSL to run; the generator itself doesn't, but installing
# it once here (rather than separately in every runner stage below) keeps this simple, and the
# image size difference is negligible.
RUN apk add --no-cache openssl
COPY --from=pruner /app/out/json/ .
# `--ignore-scripts`: `packages/database`'s own `postinstall` runs `prisma generate`, which needs
# the actual `prisma/schema.prisma` file — not present yet at this layer (`out/json` is
# deliberately only `package.json` files, for a Docker cache layer keyed on dependencies, not
# source). Every install script (this one and the legitimately dependency-only ones — esbuild,
# @swc/core, @prisma/engines all fetch/build their own native binaries on install) is deferred to
# the `pnpm rebuild` below, once the real source (schema included) has been copied in.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /app/out/full/ .
# Root-level files every package's own tsconfig.json/build depends on, but which live outside any
# single package — `turbo prune`'s `out/full` only copies files that belong to an *included*
# workspace package, so these need to be copied in explicitly.
COPY turbo.json tsconfig.base.json ./
RUN pnpm rebuild
RUN pnpm exec turbo run build --filter="@datarover/${APP_NAME}..."

# ---------------------------------------------------------------------------
# runner-migrate: one-shot `prisma migrate deploy` job (build with APP_NAME=database) —
# docker-compose.yml's "migrate" service, which api/worker both wait on before starting so a
# fresh `docker compose up --build` needs no manual migration step.
# ---------------------------------------------------------------------------
FROM installer AS runner-migrate
WORKDIR /app/packages/database
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner: generic Node runtime for a plain service (api, worker) — the default target
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
ARG APP_NAME
ENV APP_NAME=${APP_NAME}
ENV NODE_ENV=production
RUN apk add --no-cache openssl
RUN addgroup -S datarover && adduser -S datarover -G datarover
WORKDIR /app
COPY --from=installer /app .
USER datarover
CMD ["sh", "-c", "node apps/${APP_NAME}/dist/main.js"]

# ---------------------------------------------------------------------------
# runner-browser-worker: the "runner" runtime plus a real Chromium, for apps/browser-worker only
# (Specs.md §20's "browser-worker" service — Playwright driving a real, disposable browser)
# ---------------------------------------------------------------------------
FROM runner AS runner-browser-worker
USER root
RUN apk add --no-cache chromium
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium-browser
USER datarover

# ---------------------------------------------------------------------------
# runner-web: apps/web is a static SPA — served by nginx, not `node dist/main.js`
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner-web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
