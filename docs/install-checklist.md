# Install & test on a new server

A checklist for spinning up a fresh self-hosted Dub on a clean Linux VM and
verifying it end-to-end. Designed so each step gives a binary "did it work?"
answer before you move on. Pair with [`self-hosting.md`](./self-hosting.md)
for full reference.

## Prerequisites (host)

- [ ] Linux x86_64 host, ≥ 4 vCPU / 8 GB RAM / 60 GB free under
      `/var/lib/docker` (the Next build needs ~25 GB during compile +
      ~3 GB for resident images)
- [ ] Docker Engine ≥ 24, Docker Compose plugin ≥ 2.20
      (`docker version`, `docker compose version`)
- [ ] Outbound HTTPS to: `registry.npmjs.org`, `binaries.prisma.sh`,
      `registry-1.docker.io`, your Resend + S3 endpoints
- [ ] Two DNS records (or one wildcard) for the box's public IP — see
      "Domain layout" below
- [ ] TCP 80 + 443 open on the box (Caddy serves cert + traffic)

## Domain layout (DON'T skip)

Dub treats the **app** and the **short-link** hostnames as two separate
products. They MUST be different — `localhost`/`localhost:8888` are
hardcoded in `APP_HOSTNAMES`, so every short-link click would otherwise
get intercepted by AppMiddleware and bounce to `/login`.

- [ ] App URL: `app.<your-domain>` (the dashboard)
- [ ] Short-link URL: a *different* host — either a separate domain
      (`<short>.io`) or a subdomain like `s.<your-domain>` /
      `link.<your-domain>`

Set:

```
NEXT_PUBLIC_APP_DOMAIN=<your-domain>            # e.g. dub.example.com
NEXT_PUBLIC_APP_SHORT_DOMAIN=<short-host>       # e.g. s.example.com
```

## One-time setup

- [ ] `git clone <repo> && cd dub`
- [ ] `git checkout claude/docker-compose-tests-asuIO`
      *(or whichever branch carries the self-hosted patches)*
- [ ] `cp .env.docker.example .env`
- [ ] Generate secrets and append to `.env`:
      ```bash
      node -e 'console.log("NEXTAUTH_SECRET="+require("crypto").randomBytes(32).toString("base64"))' >> .env
      node -e 'console.log("CRON_SECRET="+require("crypto").randomBytes(32).toString("base64"))' >> .env
      node -e 'console.log("ENCRYPTION_KEY="+require("crypto").randomBytes(32).toString("base64"))' >> .env
      node -e 'console.log("UNSUBSCRIBE_TOKEN_SECRET="+require("crypto").randomBytes(32).toString("base64"))' >> .env
      node -e 'console.log("SRH_TOKEN="+require("crypto").randomBytes(16).toString("hex"))' >> .env
      ```
- [ ] Set required external SaaS in `.env`:
      ```
      RESEND_API_KEY=re_...
      STORAGE_ACCESS_KEY_ID=...
      STORAGE_SECRET_ACCESS_KEY=...
      STORAGE_ENDPOINT=https://...
      STORAGE_BASE_URL=https://...
      STORAGE_PUBLIC_BUCKET=...
      STORAGE_PRIVATE_BUCKET=...
      ```
- [ ] (Behind a corporate / TLS-intercepting proxy) drop the egress CA
      bundle into `tests/docker/extra-ca/` so the build can resolve
      certs (the test runner script does this from
      `/usr/local/share/ca-certificates` automatically).

## Bring up

- [ ] `docker compose build` — first run is ~10 min for the web image.
      Watch for "Image dub-web Built" and "Image dub-migrate Built".
- [ ] `docker compose up -d` — boots mysql / ps-proxy / redis / srh /
      clickhouse / mailpit / migrate / web / worker / scheduler / caddy
- [ ] `docker compose ps` — all services should be `running` and the DB
      / redis / clickhouse should be `(healthy)`.
- [ ] `docker compose logs migrate` — last line should read
      `🚀  Your database is now in sync with your Prisma schema.`
- [ ] Caddy serves on :80 + :443. First hit to `app.<your-domain>`
      triggers Caddy's on-demand TLS handshake (Let's Encrypt) — give
      it a few seconds.

## Smoke verification

- [ ] `curl -sf https://app.<your-domain>/api` → 200 + JSON
- [ ] Visit `https://app.<your-domain>` → magic-link login page
- [ ] Sign in with magic link → email lands in inbox (or mailpit on
      :8025 in dev)
- [ ] Create a workspace, then a link → page should render the new
      short URL `https://<short-host>/<key>`
- [ ] Open the short URL in a fresh browser (or `curl -I`) → 30x
      redirect to your destination
- [ ] Reload the link's analytics page → click count went up

## Run the automated suite

This is the same suite that gates the branch and exercises the whole
stack inside docker.

- [ ] `WITH_WEB=1 bash tests/docker/run.sh all`

      Expected output:

      ```
      Test Files  9 passed (9)        # unit
      Tests      54 passed (54)
      Test Files  4 passed (4)        # integration
      Tests      15 passed (15)
      Test Files  3 passed (3)        # e2e (incl. web-smoke + link-roundtrip)
      Tests      10 passed (10)
      ```

      Total: 79 tests. The run brings up its own ephemeral compose
      stack on a separate `dub_default` network and tears it down on
      exit, so it won't disturb a long-running production stack on the
      same box.

## Optional: dev-mode (hot reload) for ops poking around

- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
      Code edits to `apps/web/{app,lib,…}` and the workspace packages
      pick up via Next HMR with no rebuild. First start is ~2-5 min
      while pnpm installs into the named volume; subsequent restarts
      are ~10 s.

## Common gotchas (worth checking if a step fails)

- **All clicks redirect to `/login`** → `NEXT_PUBLIC_APP_SHORT_DOMAIN`
  equals (or is contained in) `APP_HOSTNAMES`. Pick a different short
  host and rebuild the web image.
- **`migrate` exits 1, "schema-engine.gz.sha256 ... self-signed
  certificate"** → egress proxy is intercepting TLS. Add the proxy CA
  to `tests/docker/extra-ca/` and rebuild migrate (the bundled
  3.0.x prisma engines should be picked up automatically once openssl
  is present in the image).
- **`Cannot find module 'ioredis'` during `next build`** → you've
  re-introduced `^ioredis$` into the webpack `IgnorePlugin` regex in
  `apps/web/next.config.js`. Drop it; the self-hosted queue/workflow
  shims need the real package at runtime.
- **`Failed to compile … expected 200 to be …`** in `web-smoke.test.ts`
  → the `web` container couldn't reach `migrate`'s output, or the
  cron route is using a stale auth import. Check that
  `lib/cron/with-cron.ts` still forwards `DubApiError` to
  `handleAndReturnErrorResponse` (the wrapper used to collapse every
  error into 500).
- **Out of disk during build** → `docker builder prune -af` reclaims
  the per-build cache; budget ~25 GB of free space for a fresh build.
