FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8 --activate

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm --filter @mnemonics/shared build
RUN pnpm --filter @mnemonics/database build
RUN pnpm --filter @mnemonics/api build

# Final stage
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@8 --activate
WORKDIR /app

COPY --from=base /app /app

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["pnpm", "--filter", "@mnemonics/api", "start"]
