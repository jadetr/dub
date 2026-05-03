import { describe, it, expect } from "vitest";

// Optional E2E for the `web` container. Only runs if WEB_URL is reachable.
// In CI these are gated behind `--env WEB_URL=http://web:8888`.

const WEB_URL = process.env.WEB_URL;
const CRON_SECRET = process.env.CRON_SECRET || "";

const skip = !WEB_URL;
const d = skip ? describe.skip : describe;

d("e2e: web tier smoke (requires WEB_URL)", () => {
  it("/api responds", async () => {
    const r = await fetch(`${WEB_URL}/api`);
    // Anything in 200/4xx range means the Next.js process answered.
    expect(r.status).toBeLessThan(500);
  });

  it("cron route rejects requests without bearer", async () => {
    const r = await fetch(`${WEB_URL}/api/cron/sitemaps/queue`);
    expect([401, 403]).toContain(r.status);
  });

  it("cron route accepts the right CRON_SECRET bearer", async () => {
    if (!CRON_SECRET) return;
    const r = await fetch(`${WEB_URL}/api/cron/sitemaps/queue`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    // The handler may itself return 4xx for business reasons (no data) — what
    // we care about is that it's not 401/403.
    expect([200, 400, 404, 422, 500]).toContain(r.status);
  });

  it("on-demand TLS verify endpoint rejects unknown domains", async () => {
    const r = await fetch(
      `${WEB_URL}/api/domains/verify-on-demand?domain=does-not-exist.example`,
    );
    expect(r.status).toBe(404);
  });

  it("on-demand TLS verify endpoint accepts the configured app domain", async () => {
    const apex = process.env.NEXT_PUBLIC_APP_DOMAIN || "localhost";
    const r = await fetch(
      `${WEB_URL}/api/domains/verify-on-demand?domain=${encodeURIComponent(apex)}`,
    );
    expect(r.status).toBe(200);
  });
});
