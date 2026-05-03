# syntax=docker/dockerfile:1.7

# ----- Stage 1: deps ---------------------------------------------------------
FROM node:20-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages packages
COPY apps/worker/package.json apps/worker/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----- Stage 2: builder (web) ------------------------------------------------
FROM node:20-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .

# Generate prisma client + build standalone Next app
RUN pnpm --filter=@dub/prisma generate
RUN pnpm --filter=web build

# ----- Stage 3: runner (web) -------------------------------------------------
FROM node:20-bookworm-slim AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8888
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Install ca-certs and tini
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy Next.js standalone output
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

# Prisma engines + generated client (already inside node_modules of standalone)
COPY --from=builder /repo/packages/prisma ./packages/prisma

# Optional: bake GeoLite2 if available (mounted at /geo at runtime otherwise)
RUN mkdir -p /geo

EXPOSE 8888
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]

# ----- Stage 4: worker -------------------------------------------------------
FROM node:20-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /repo/apps/worker ./apps/worker
COPY --from=builder /repo/apps/web ./apps/web
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
