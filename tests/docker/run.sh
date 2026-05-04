#!/usr/bin/env bash
# Bring up infra, run the test suites, capture exit codes, tear down.
# Usage: tests/docker/run.sh [unit|integration|e2e|all]

set -euo pipefail

cd "$(dirname "$0")/../.."

SUITE="${1:-all}"

# Ensure required env vars exist (compose silently coerces unset to "").
: "${NEXTAUTH_SECRET:=test-not-for-prod}"
: "${CRON_SECRET:=test-cron-secret}"
: "${ENCRYPTION_KEY:=test-not-for-prod}"
: "${UNSUBSCRIBE_TOKEN_SECRET:=test}"
: "${SRH_TOKEN:=localtoken}"
: "${CLICKHOUSE_PASSWORD:=dub}"
: "${RESEND_API_KEY:=re_test}"
: "${STORAGE_ACCESS_KEY_ID:=test}"
: "${STORAGE_SECRET_ACCESS_KEY:=test}"
: "${STORAGE_ENDPOINT:=http://localhost:9000}"
: "${STORAGE_BASE_URL:=http://localhost:9000}"
: "${STORAGE_PUBLIC_BUCKET:=dub}"
: "${STORAGE_PRIVATE_BUCKET:=dub-private}"
# Use a short domain that doesn't collide with APP_HOSTNAMES (which hardcodes
# "localhost"/"localhost:8888"). Without this, link clicks under the default
# `localhost` short domain are intercepted by AppMiddleware → /login.
: "${NEXT_PUBLIC_APP_DOMAIN:=localhost}"
: "${NEXT_PUBLIC_APP_SHORT_DOMAIN:=s.localhost}"
export NEXTAUTH_SECRET CRON_SECRET ENCRYPTION_KEY UNSUBSCRIBE_TOKEN_SECRET \
       SRH_TOKEN CLICKHOUSE_PASSWORD RESEND_API_KEY \
       STORAGE_ACCESS_KEY_ID STORAGE_SECRET_ACCESS_KEY STORAGE_ENDPOINT \
       STORAGE_BASE_URL STORAGE_PUBLIC_BUCKET STORAGE_PRIVATE_BUCKET \
       NEXT_PUBLIC_APP_DOMAIN NEXT_PUBLIC_APP_SHORT_DOMAIN

COMPOSE_FILES=(-f docker-compose.yml -f tests/docker/docker-compose.test.yml)
PROFILE=(--profile test)

# Stage host-trusted extra CA certs into the build context so the test image
# can talk through TLS-intercepting egress proxies (corp/CI sandboxes).
mkdir -p tests/docker/extra-ca
if [ -d /usr/local/share/ca-certificates ]; then
  find /usr/local/share/ca-certificates -maxdepth 1 -name '*.crt' \
    -exec cp -f {} tests/docker/extra-ca/ \; 2>/dev/null || true
fi

cleanup() {
  echo "::: tearing down compose stack" >&2
  docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "::: bringing up infra services"
# Skip ps-proxy if its image can't be pulled (CI env restriction)
if ! docker compose "${COMPOSE_FILES[@]}" pull ps-proxy 2>&1 | tail -1 | grep -q "error"; then
  docker compose "${COMPOSE_FILES[@]}" up -d ps-proxy redis srh clickhouse mysql
else
  echo "::: ps-proxy unavailable, continuing without it" >&2
  export SKIP_PS_PROXY=1
  docker compose "${COMPOSE_FILES[@]}" up -d redis srh clickhouse
fi

# Wait for ClickHouse to be healthy before launching tests
echo "::: waiting for clickhouse healthy"
for i in $(seq 1 30); do
  state=$(docker compose "${COMPOSE_FILES[@]}" ps clickhouse --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)
  if echo "$state" | grep -q '"healthy"'; then break; fi
  sleep 2
done

echo "::: building test image"
docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" build tests

# Optional: bring up the web tier so e2e/web-smoke.test.ts runs against a live
# Next.js process. Triggered with WITH_WEB=1. Slow (full app build), so off by
# default in CI.
if [ "${WITH_WEB:-0}" = "1" ]; then
  echo "::: building web image"
  docker compose "${COMPOSE_FILES[@]}" build web
  echo "::: starting web (depends on migrate, redis, srh, clickhouse)"
  docker compose "${COMPOSE_FILES[@]}" up -d web
  echo "::: waiting for web to answer on /api"
  for i in $(seq 1 60); do
    if docker compose "${COMPOSE_FILES[@]}" exec -T web sh -c \
       'wget -qO- --tries=1 --timeout=2 http://localhost:8888/api >/dev/null 2>&1'; then
      break
    fi
    sleep 2
  done
  export WEB_URL=http://web:8888
fi

case "$SUITE" in
  unit)
    docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" run --rm tests pnpm test:unit
    ;;
  integration)
    docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" run --rm tests pnpm test:integration
    ;;
  e2e)
    docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" run --rm tests pnpm test:e2e
    ;;
  all)
    docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" run --rm tests pnpm test:unit
    docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" run --rm tests pnpm test:integration
    docker compose "${COMPOSE_FILES[@]}" "${PROFILE[@]}" run --rm tests pnpm test:e2e
    ;;
  *)
    echo "unknown suite: $SUITE" >&2
    exit 1
    ;;
esac
