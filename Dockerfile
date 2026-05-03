# ----- Stage 1: deps ---------------------------------------------------------
FROM node:20-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY tests/docker/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN if ls /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then update-ca-certificates; fi
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages packages
COPY apps/worker/package.json apps/worker/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter=web... --filter=@dub/worker...

# ----- Stage 2: builder (web) ------------------------------------------------
FROM node:20-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY tests/docker/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN if ls /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then update-ca-certificates; fi
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .

# Generate prisma client + build workspace deps + build standalone Next app.
# `web` imports compiled output (dist/**) from @dub/ui, @dub/utils, @dub/email,
# etc. so their tsup builds must run first. turbo.json's `^build` dependency
# makes `turbo build --filter=web...` build deps in the right order.
# Bump Node heap to 6GB — the Next 15 build OOMs on the default ~1.7GB cap.
ENV NODE_OPTIONS="--max-old-space-size=6144"

# Mark this as a self-hosted build:
#  - next.config.js switches `output` to "standalone" (needed by the runner
#    stage which copies .next/standalone)
#  - graceful generateStaticParams fallbacks return [] when DB is unreachable
ENV SELF_HOSTED=1

# Build-time stubs for optional SaaS SDKs that crash at module-load when their
# env vars are unset (Next collects page data by importing every route). At
# runtime these are overridden by real values (or stay unset and the lazy
# Proxy guards in lib/* throw only when actually called).
ENV UPSTASH_VECTOR_REST_URL=http://localhost \
    UPSTASH_VECTOR_REST_TOKEN=build-stub \
    AXIOM_TOKEN=build-stub \
    AXIOM_DATASET=build-stub

RUN pnpm --filter=@dub/prisma generate
RUN pnpm exec turbo run build --filter=web...

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

# Prisma CLI for the migrate compose service (`prisma db push`). The standalone
# trace doesn't include the CLI since no app code imports it. The pnpm bin
# symlink at /app/packages/prisma/node_modules/prisma resolves up to
# /app/node_modules/.pnpm/prisma@*; mirror that path here (NOT /repo/...,
# which only existed in the builder stage).
COPY --from=builder /repo/node_modules/.pnpm/prisma@6.19.1_typescript@5.2.2 /app/node_modules/.pnpm/prisma@6.19.1_typescript@5.2.2
COPY --from=builder /repo/node_modules/.pnpm/@prisma+engines@6.19.1 /app/node_modules/.pnpm/@prisma+engines@6.19.1

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
COPY tests/docker/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN if ls /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then update-ca-certificates; fi
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /repo/apps/worker ./apps/worker
COPY --from=builder /repo/apps/web ./apps/web
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
