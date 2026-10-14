# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for the Mnemonics API service.
#
# Designed for pnpm monorepo + Node 20, ready to deploy on
# Koyeb / Fly.io / Render / Railway. The Koyeb Blueprint at the
# repo root (koyeb.yaml) tells Koyeb to use this file as the
# build target.
#
# Build stages:
#   1. base      — Node + pnpm + global tools
#   2. deps      — pnpm install (all workspaces) with cache mount
#   3. build     — typecheck + tsc for shared, database, ai, api
#   4. prod-deps — `pnpm deploy --prod` strips devDependencies
#   5. runner    — slim runtime image with only the api package

ARG NODE_VERSION=20

# ──────────────────────────────────────────────────────────────────
# Stage 1: base
# ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base

# pnpm via corepack; pinned to the same major as package.json
# (currently 10.x; bump corepack prepare line whenever
#  packageManager in root package.json is bumped).
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
 && corepack prepare pnpm@10 --activate \
 && pnpm --version

WORKDIR /repo

# ──────────────────────────────────────────────────────────────────
# Stage 2: install all workspace deps
# ──────────────────────────────────────────────────────────────────
FROM base AS deps

# Copy only the manifests first so this layer is cached unless a
# package.json changes. Workspaces are apps/* and packages/*.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/api/package.json          ./apps/api/
COPY apps/extension/package.json    ./apps/extension/
COPY apps/web/package.json          ./apps/web/
COPY packages/ai/package.json       ./packages/ai/
COPY packages/bench/package.json    ./packages/bench/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json   ./packages/shared/

# AllowBuilds in pnpm-workspace.yaml means sharp, tesseract.js, etc.
# try to build during install. This needs network for binaries.
# The cache mount keeps /root/.local/share/pnpm-store between runs.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm-store \
    pnpm install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────
# Stage 3: build all required packages in dependency order
# ──────────────────────────────────────────────────────────────────
FROM deps AS build

# Now bring in the source. We could `COPY . .` but the repo has a
# few hundred MB of vendor/ + docs + benchmark artefacts that the
# API never needs; the .dockerignore trims the build context
# before it gets here.
COPY . .

# shared → database → ai → api (api's typecheck depends on all three
# being built first because of workspace:* resolution).
RUN pnpm --filter @mnemonics/shared    build
RUN pnpm --filter @mnemonics/database build
RUN pnpm --filter @mnemonics/ai        build
RUN pnpm --filter @mnemonics/api       build

# ──────────────────────────────────────────────────────────────────
# Stage 4: produce a deployment-ready slice of the api workspace
# ──────────────────────────────────────────────────────────────────
FROM build AS prod-deps

# `pnpm deploy --legacy --prod` is the official way to assemble a
# production-only copy of a single workspace package, with its
# transitive prod-deps copied in (incl. workspace:* siblings).
# In pnpm v10+, --legacy is required when inject-workspace-packages is not enabled.
# Output lands in /out with a pruned, relocatable node_modules.
RUN pnpm --filter @mnemonics/api deploy --legacy --prod /out

# ──────────────────────────────────────────────────────────────────
# Stage 5: final runtime
# ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner

# Security: run as the unprivileged `node` user that the official
# image ships (uid 1000). Required by Koyeb's free instance.
WORKDIR /app
USER node

ENV NODE_ENV=production
# PORT is platform-assigned on Koyeb/Render; this is the fallback
# used by apps/api/src/server.ts when PORT is unset.
ENV PORT=4000

COPY --from=prod-deps --chown=node:node /out /app

EXPOSE 4000

# The api package's start script is `node dist/server.js`. Run
# directly so we get the same process supervisor behaviour as
# local dev (tsx watch in dev, node here in prod).
CMD ["node", "dist/server.js"]
