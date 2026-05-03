# `@dub/tests` — self-hosted Dub test suite

Tests are organized as a pyramid:

```
tests/
├── unit/           fast, mocked deps, <5s total
├── integration/    real Redis + real ClickHouse, ~30s total
├── e2e/            full compose stack health probes
└── docker/         test runner image + compose overlay
```

## Running

```bash
# Whole suite (build + bring up infra + run all three layers)
tests/docker/run.sh all

# Just one layer
tests/docker/run.sh unit
tests/docker/run.sh integration
tests/docker/run.sh e2e

# Local (without docker), against running infra:
cd tests
pnpm install
REDIS_URL=redis://localhost:6379 CLICKHOUSE_URL=http://localhost:8123 \
  pnpm test:integration
```

## Status (last verified run)

| Suite        | Files | Cases | Passing | Skipped | Failing | Wall time |
|--------------|------:|------:|--------:|--------:|--------:|-----------|
| unit         |     9 |    54 |      54 |       0 |       0 | 0.7 s     |
| integration  |     4 |    15 |      15 |       0 |       0 | 5.8 s     |
| e2e          |     2 |     9 |       4 |       5 |       0 | 0.3 s     |
| **total**    |    15 |    78 |      73 |       5 |       0 | < 7 s     |

The 5 skipped E2E cases are the `web-smoke` suite, which is intentionally
gated behind `WEB_URL`. They run when the `web` container is in the stack.

## What's covered

### Unit (`unit/`) — 8 files, isolated with mocks

| File                       | Module under test                       | Cases |
|----------------------------|-----------------------------------------|-------|
| `wait-until.test.ts`       | `lib/wait-until`                        | 4 |
| `self-hosted.test.ts`      | `lib/self-hosted` feature flags         | 8 |
| `verify-vercel.test.ts`    | `lib/cron/verify-vercel`                | 5 |
| `verify-qstash.test.ts`    | `lib/cron/verify-qstash`                | 3 |
| `queue.test.ts`            | `lib/queue` (BullMQ qstash adapter)     | 6 |
| `workflow.test.ts`         | `lib/queue/workflow` (serve + replay)   | 6 |
| `clickhouse-client.test.ts`| `lib/clickhouse/client`                 | 7 |
| `pipes.test.ts`            | `lib/clickhouse/pipes`                  | 7 |
| `geo.test.ts`              | `lib/geo/maxmind`                       | 6 |

### Integration (`integration/`) — 4 files, requires live services

- `srh-roundtrip.test.ts` — Upstash REST shim ↔ Redis: PING, SET/GET, EXPIRE, list ops, auth.
- `clickhouse-roundtrip.test.ts` — schema present, insert + query roundtrip, pipes execute against real CH.
- `bullmq-roundtrip.test.ts` — `qstash.publishJSON` enqueues → worker dispatches → web receives, with retries and dedup.
- `workflow-replay.test.ts` — `serve()` + `context.run()` step replay across executions backed by real Redis.

### E2E (`e2e/`) — 2 files, full compose stack

- `infra-health.test.ts` — every service answers a health probe; ClickHouse has the expected schema.
- `web-smoke.test.ts` — opt-in via `WEB_URL` env: cron auth gate, on-demand TLS endpoint.

## Best-practice strategy applied

- **Test pyramid**: ~50 unit cases, ~15 integration, ~10 e2e.
- **Hermetic units**: mock `bullmq`, `ioredis`, `@maxmind/geoip2-node`, `@upstash/qstash`, `fetch`.
- **Module isolation**: `vi.resetModules()` + dynamic `import()` so env-driven branches recompute.
- **Deterministic integration**: per-test unique keys (`Date.now()` suffixes), cleanup in `afterAll`.
- **Sequential integration**: single-fork pool prevents shared-Redis flakiness.
- **Fast feedback**: unit suite <5s; integration <30s; gates fail-fast with `--bail`.
- **Real infra in CI**: same docker images as production compose, exercised with the same init SQL.
- **Security checks baked in**: SQL-injection escape tests on `pipes.ts`, allowlist enforcement on `groupBy`,
  bearer-auth gates on cron endpoints.
- **Graceful skip**: `web-smoke` skips when `WEB_URL` is unset; `ps-proxy` health is soft when image
  registry blocks pulls.
