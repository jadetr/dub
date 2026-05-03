# Self-hosting Dub on Docker Compose

This document describes how to run Dub end-to-end on a single host using
`docker compose`. Two SaaS dependencies remain external by design:

- **Email** — [Resend](https://resend.com) (magic-link auth + transactional)
- **File storage** — any S3-compatible bucket (AWS S3, Cloudflare R2,
  Backblaze B2, Wasabi, MinIO, …)

Everything else (database, cache, queue, scheduler, analytics, reverse proxy)
runs as a container.

## Quick start

```bash
cp .env.docker.example .env
# Generate secrets
node -e 'console.log("NEXTAUTH_SECRET="+require("crypto").randomBytes(32).toString("base64"))' >> .env
node -e 'console.log("CRON_SECRET="+require("crypto").randomBytes(32).toString("base64"))' >> .env
node -e 'console.log("ENCRYPTION_KEY="+require("crypto").randomBytes(32).toString("base64"))' >> .env

# Edit .env, fill in: RESEND_API_KEY + STORAGE_* (and optionally OAuth keys)

# Optionally drop a GeoLite2-City.mmdb into ./geo/ for IP geolocation
mkdir -p geo
# (download GeoLite2-City.mmdb from MaxMind into ./geo)

# Bring everything up
make up        # docker compose up -d
make migrate   # runs prisma migrate deploy

# Tail logs
make logs
```

The app is now reachable at <https://localhost> (Caddy with an internal
self-signed cert) and proxied to the Next.js container on port 8888.

For a public deployment, set `NEXT_PUBLIC_APP_DOMAIN=your-domain.com` and
`NEXTAUTH_URL=https://your-domain.com` and Caddy will automatically provision
an ACME certificate.

## Architecture

```
                 ┌────────────────┐
HTTPS  ──▶  caddy │  reverse proxy │
                 │  on-demand TLS │
                 └────────┬───────┘
                          │
                 ┌────────▼───────┐         ┌──────────────┐
                 │   web (Next)   │◀────────│  scheduler   │
                 │   apps/web     │  cron   │ supercronic  │
                 └────┬──────┬────┘         └──────────────┘
                      │      │
        ┌─────────────┘      └────────────────┐
        │                                     │
   ┌────▼────┐  ┌────────────┐  ┌──────┐  ┌──▼─────┐
   │  mysql  │  │ clickhouse │  │ redis│  │ worker │
   │  + ps-  │  │  analytics │  │+ srh │  │ BullMQ │
   │  proxy  │  └────────────┘  └──────┘  └────────┘
   └─────────┘
```

Custom short-link domains pointed at this Caddy instance get certs issued
on-demand: Caddy hits `GET /api/domains/verify-on-demand?domain=<host>` and
issues a cert iff the row exists in the `Domain` table.

## Service inventory

| Service       | Image                               | Replaces                |
| ------------- | ----------------------------------- | ----------------------- |
| `mysql`       | `mysql:8.0`                         | PlanetScale             |
| `ps-proxy`    | `ghcr.io/mattrobenolt/ps-http-sim`  | PlanetScale HTTP API    |
| `redis`       | `redis:7-alpine`                    | Upstash Redis           |
| `srh`         | `hiett/serverless-redis-http`       | Upstash Redis REST API  |
| `clickhouse`  | `clickhouse/clickhouse-server:24.8` | Tinybird                |
| `mailpit`     | `axllent/mailpit`                   | dev-only SMTP fallback  |
| `web`         | this repo (Next.js standalone)      | Vercel                  |
| `worker`      | this repo (`apps/worker`)           | QStash + Workflow       |
| `scheduler`   | `aptible/supercronic`               | Vercel Cron             |
| `caddy`       | `caddy:2-alpine`                    | Vercel edge + TLS       |

## Required environment variables

The minimum set needed for first boot:

```bash
# secrets
NEXTAUTH_SECRET=...   # 32-byte base64
CRON_SECRET=...       # 32-byte base64
ENCRYPTION_KEY=...    # 32-byte base64

# domain
NEXT_PUBLIC_APP_DOMAIN=your-domain.com
NEXTAUTH_URL=https://your-domain.com

# email (Resend)
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...

# storage (any S3-compatible)
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_ENDPOINT=https://...
STORAGE_BASE_URL=https://...
STORAGE_PUBLIC_BUCKET=dub-public
STORAGE_PRIVATE_BUCKET=dub-private
```

All other env vars are optional — see `.env.docker.example`. Optional
integrations (Stripe, Google/GitHub OAuth, Plain, Slack, Anthropic, etc.) are
gated by `lib/self-hosted.ts`: an integration is enabled iff its env var is
present, otherwise its UI/code paths no-op.

## What changed vs. the Vercel build

The repository builds two way: the Vercel deployment continues to work
unmodified, and `SELF_HOSTED=1` switches to local replacements via runtime env
checks. Specifically:

- **`apps/web/lib/wait-until.ts`** — Node-native polyfill of
  `@vercel/functions:waitUntil`.
- **`apps/web/lib/self-hosted.ts`** — single `features` object derived from
  env presence; gates optional integrations.
- **`apps/web/lib/queue/index.ts`** — exposes the `qstash` client surface.
  When `SELF_HOSTED=1` it routes through BullMQ instead of Upstash QStash.
- **`apps/web/lib/queue/workflow.ts`** — drop-in for
  `@upstash/workflow/nextjs:serve()`. Implements `context.run()` step-replay
  via Redis.
- **`apps/web/lib/clickhouse/client.ts`** — thin HTTP client.
- **`apps/web/lib/clickhouse/pipes.ts`** — registry of Tinybird pipe-name →
  ClickHouse SQL functions. Unknown pipes return `[]` (analytics surfaces
  show 0 instead of crashing).
- **`apps/web/lib/tinybird/client.ts`** — when `SELF_HOSTED=1` the `tb` export
  routes `buildPipe`/`buildIngestEndpoint` to the ClickHouse client above.
- **`apps/web/lib/geo/maxmind.ts`** — mmdb-based replacement for Vercel
  geolocation headers.
- **11 edge runtime routes** converted to `nodejs` runtime (mechanical edit).
- **`apps/web/next.config.js`** — `output: 'standalone'` when `SELF_HOSTED=1`.

## Schedules / cron

The scheduler service runs `supercronic` against
[`scheduler/crontab`](../scheduler/crontab), which is a 1:1 translation of
`apps/web/vercel.json`. Each entry curls the corresponding `/api/cron/*`
route with `Authorization: Bearer $CRON_SECRET` (matched by
`lib/cron/verify-vercel.ts`).

To add or remove a cron, edit `scheduler/crontab` and `docker compose restart
scheduler`. No app rebuild required.

## Background jobs

When the app calls `qstash.publishJSON({...})`, the BullMQ-backed adapter
enqueues a job into Redis. The `worker` container consumes it and POSTs back
to the web tier with the bearer token. Route handlers keep using
`verifyQstashSignature(req, rawBody)`; that function recognises the bearer
auth when `SELF_HOSTED=1`.

Queue concurrency is configurable via `WORKER_CONCURRENCY` (default 10).

## Analytics (ClickHouse)

Click/lead/sale ingestion writes JSON rows directly into ClickHouse via
`POST /?query=INSERT INTO …`. The schema is created at first boot from
`clickhouse/init/01_schemas.sql`.

**Pipe coverage is partial**: this self-hosted release implements the most
commonly-hit pipes (`v3_count`, `v3_timeseries`, `v3_group_by`,
`v3_group_by_link_country`). Other pipes return empty arrays. To translate
additional pipes:

1. Find the `.pipe` file under `packages/tinybird/pipes/`.
2. Add a function in `apps/web/lib/clickhouse/pipes.ts` keyed by the pipe
   name. The function receives the `params` object passed to `tb.buildPipe()`
   and must return an array matching the pipe's existing zod `data` schema.

Daily backups can be enabled by adding a `clickhouse-backup` sidecar that
writes to your S3 bucket — out of scope for this initial release.

## File storage

`apps/web/lib/storage.ts` already drives a generic S3 client via
`STORAGE_ENDPOINT`. Point it at any provider:

- **AWS S3** — endpoint `https://s3.<region>.amazonaws.com`
- **Cloudflare R2** — endpoint
  `https://<account>.r2.cloudflarestorage.com`
- **Backblaze B2** — endpoint
  `https://s3.<region>.backblazeb2.com`
- **MinIO (self-host)** — endpoint `http://minio:9000` if you add a MinIO
  service to `docker-compose.yml`

The two buckets (`STORAGE_PUBLIC_BUCKET`, `STORAGE_PRIVATE_BUCKET`) must
exist; create them before first boot.

## Things that are dropped on the self-hosted path

These integrations have no OSS equivalent and are not reimplemented:

- Stripe Connect (partner payouts)
- BoxyHQ SAML (you can re-enable by mounting a SAML database; SSO works
  but is unsupported on the OSS path)
- Veriff identity verification
- Plain customer support
- Vercel Domains API (replaced by manual DNS + Caddy on-demand TLS)
- Dynadot domain registration
- Upstash Vector (AI support chat)

If `STRIPE_SECRET_KEY` is set, billing/subscription flows still work; if
unset, those screens are inert.

## Verification checklist

After `make up` + `make migrate`:

- [ ] `https://localhost` returns the marketing/login page.
- [ ] Magic-link login: enter your email, click the link in Resend (or
      Mailpit at <http://localhost:8025> if `SMTP_HOST=mailpit`).
- [ ] Create a workspace and a short link.
- [ ] Click the short link in incognito; it redirects.
- [ ] `docker compose exec clickhouse clickhouse-client --user dub
      --password dub -q "SELECT count() FROM dub.dub_click_events"` returns ≥1.
- [ ] `/analytics` shows the click.
- [ ] `docker compose exec scheduler supercronic -test
      /etc/supercronic/crontab` parses without errors.
- [ ] Boot once with `STRIPE_SECRET_KEY=` empty: app starts, billing UI is
      hidden, no integration crashes.

## Troubleshooting

**MySQL never goes healthy** — first startup may take 30s for the data dir to
initialise. `docker compose logs mysql` will show progress.

**ClickHouse refuses inserts** — check that `clickhouse/init/01_schemas.sql`
ran (only runs on a fresh data volume). To re-run, `docker compose down -v`
and `make up` again.

**Workflow steps re-run on retry** — the BullMQ-backed `serve()` shim caches
each `context.run(name, fn)` result in Redis under
`wf:<runId>:step:<name>` for 7 days. If you see double execution, check that
`x-workflow-run-id` is being passed across retries (the worker forwards it
automatically).

**OAuth login fails** — Google/GitHub require their callback URL to match
`NEXTAUTH_URL`. For localhost, only the magic-link flow works without
external OAuth setup.
