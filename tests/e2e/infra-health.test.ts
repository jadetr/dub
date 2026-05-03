import { describe, it, expect } from "vitest";

const SRH_URL = process.env.SRH_URL || "http://srh:80";
const SRH_TOKEN = process.env.SRH_TOKEN || "localtoken";
const CH_URL = process.env.CLICKHOUSE_URL || "http://clickhouse:8123";
const PS_URL =
  process.env.PLANETSCALE_DATABASE_URL ||
  "http://root:unused@ps-proxy:3900/planetscale";

describe("e2e: every infra service answers a health probe", () => {
  it("clickhouse /ping is OK", async () => {
    const r = await fetch(`${CH_URL}/ping`);
    expect(r.ok).toBe(true);
    expect((await r.text()).trim()).toBe("Ok.");
  });

  it("clickhouse has the dub database with expected tables", async () => {
    const search = new URLSearchParams({
      default_format: "JSON",
      query:
        "SELECT name FROM system.tables WHERE database='dub' ORDER BY name",
    });
    const r = await fetch(`${CH_URL}/?${search}`, {
      headers: {
        "x-clickhouse-user": "dub",
        "x-clickhouse-key": process.env.CLICKHOUSE_PASSWORD || "dub",
      },
    });
    const j = (await r.json()) as { data: { name: string }[] };
    const names = j.data.map((t) => t.name);
    expect(names).toContain("dub_click_events");
    expect(names).toContain("dub_lead_events");
    expect(names).toContain("dub_sale_events");
    expect(names).toContain("dub_links_metadata");
  });

  it("srh accepts a PING command", async () => {
    const r = await fetch(SRH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SRH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(["PING"]),
    });
    expect(r.ok).toBe(true);
    expect(await r.json()).toEqual({ result: "PONG" });
  });

  it("planetscale-proxy is reachable on port 3900 (best effort)", async () => {
    // ps-http-sim doesn't expose /ping; just verify we can establish a TCP
    // connection. fetch() will return a non-OK but non-network-error status.
    const u = new URL(PS_URL);
    try {
      const r = await fetch(`http://${u.host}/`, { method: "GET" });
      // Any HTTP response (incl. 404) means the socket accepted the connection.
      expect([200, 400, 404, 405, 500]).toContain(r.status);
    } catch (err: any) {
      // Skip the assertion if ps-proxy was not started (some CI envs block
      // ghcr.io). Mark the test as soft-skipped via console.
      if (process.env.SKIP_PS_PROXY === "1") return;
      throw err;
    }
  });
});
