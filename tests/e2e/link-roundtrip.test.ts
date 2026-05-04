import { describe, it, expect } from "vitest";
import * as http from "node:http";

// Tiny http GET helper — undici (Node's `fetch`) treats `Host` as a forbidden
// header and silently strips it, so the middleware can't be coaxed into
// looking the link up under SHORT_DOMAIN via fetch alone. Fall back to
// node:http where Host is settable.
function nodeGet(
  url: string,
  hostHeader: string,
): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          Host: hostHeader,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 dub-e2e-test",
        },
      },
      (res) => {
        // Drain the body so the socket is released.
        res.resume();
        resolve({
          status: res.statusCode ?? 0,
          location: (res.headers.location as string | undefined) ?? null,
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// E2E: anonymous link create → unauthenticated click → admin-side stat read.
// Runs against the live `web` container plus clickhouse. Skipped unless
// WEB_URL is set (mirroring web-smoke.test.ts).
//
// Flow:
//   1. POST /api/links with the `dub-anonymous-link-creation` header to get
//      a fresh link with a known key + id.
//   2. GET /{key} on the web container with redirect:"manual" — verify the
//      302 → destination URL handshake an unauthenticated browser would see.
//   3. Poll clickhouse `dub.dub_click_events` for a row with that link_id —
//      this is what the admin analytics dashboard reads from. Verifying
//      a count change end-to-end (0 → ≥1) covers the "admin views a change
//      in link statistics" path without needing a workspace/API token.

const WEB_URL = process.env.WEB_URL;
// Falls back to s.localhost (run.sh's default) — anything OTHER than a
// hostname in APP_HOSTNAMES (which hardcodes "localhost"/"localhost:8888")
// so the middleware sends the click to LinkMiddleware, not AppMiddleware.
const SHORT_DOMAIN =
  process.env.NEXT_PUBLIC_APP_SHORT_DOMAIN || "s.localhost";

const skip = !WEB_URL;
const d = skip ? describe.skip : describe;

async function clickCount(linkId: string): Promise<number> {
  const { chQuery } = await import("../../apps/web/lib/clickhouse/client.ts");
  // Escape the single quote with a doubled-quote — link IDs are alphanumeric
  // (createId prefix + cuid), so this is just defence in depth.
  const safeId = linkId.replace(/'/g, "''");
  const rows = await chQuery<{ c: string | number }>(
    `SELECT count() AS c FROM dub.dub_click_events WHERE link_id = '${safeId}'`,
  );
  return Number(rows[0]?.c ?? 0);
}

d("e2e: link roundtrip (create → click → stat)", () => {
  it("create + click + stat-change end-to-end", async () => {
    // ── 1. admin creates a link (anonymous-creation flow, no auth needed) ──
    const destination = `https://example.com/dub-e2e-${Date.now()}`;
    const createRes = await fetch(`${WEB_URL}/api/links`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "dub-anonymous-link-creation": "1",
      },
      body: JSON.stringify({
        url: destination,
        domain: SHORT_DOMAIN,
      }),
    });
    expect(
      createRes.status,
      `expected 200 from POST /api/links, got ${createRes.status}: ${await createRes
        .clone()
        .text()
        .catch(() => "")}`,
    ).toBe(200);

    const link = (await createRes.json()) as {
      id: string;
      key: string;
      domain: string;
      url: string;
    };
    expect(link.id).toMatch(/^link_/);
    expect(link.key).toBeTruthy();
    expect(link.url).toBe(destination);

    // baseline: a brand-new link should have zero clicks recorded
    expect(await clickCount(link.id)).toBe(0);

    // ── 2. unauthenticated browser hits the short URL ─────────────────────
    // The middleware uses the Host header to look the link up by (domain,key).
    // From inside the test container we hit `http://web:8888/...` (compose
    // hostname), so we have to send Host: <SHORT_DOMAIN> so the lookup
    // matches the domain the link was created on.
    const clickRes = await nodeGet(`${WEB_URL}/${link.key}`, SHORT_DOMAIN);
    expect(
      [301, 302, 307, 308],
      `expected redirect status, got ${clickRes.status}`,
    ).toContain(clickRes.status);
    expect(clickRes.location).toBe(destination);

    // ── 3. admin-side stat check: verify the click was recorded ───────────
    // recordClick runs inside waitUntil(), so the row may land slightly
    // after the redirect response. Poll for up to ~5s.
    let count = 0;
    for (let i = 0; i < 25; i++) {
      count = await clickCount(link.id);
      if (count >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      count,
      "click event was not ingested into clickhouse within 5s",
    ).toBeGreaterThanOrEqual(1);
  });
});
