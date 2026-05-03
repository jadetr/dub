# Test runner image. Brings just enough of the workspace to compile and run
# the tests in `tests/{unit,integration,e2e}` against live infra services.
# Heavy app code (Next.js standalone, Prisma engines) is not needed.

FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=test

# node:20-bookworm-slim ships with ca-certificates already.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo

# Workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Per-package manifests so pnpm can resolve workspace links
COPY tests/package.json tests/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages packages

# Restrict install to just what tests need.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@dub/tests... --filter=@dub/utils

# Source files used by the tests
COPY apps/web/lib apps/web/lib
COPY tests tests

WORKDIR /repo/tests

CMD ["pnpm", "test"]
