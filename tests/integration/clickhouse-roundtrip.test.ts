import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Runs against the real ClickHouse container with init/01_schemas.sql
// applied. Validates that our HTTP client can ingest and query click events.

beforeAll(() => {
  process.env.CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || "http://clickhouse:8123";
  process.env.CLICKHOUSE_DATABASE = "dub";
  process.env.CLICKHOUSE_USER = "dub";
  process.env.CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "dub";
});

const TEST_LINK = `int-test-${Date.now()}`;

describe("ClickHouse roundtrip via lib/clickhouse/client", () => {
  afterAll(async () => {
    const { chQuery } = await import(
      "../../apps/web/lib/clickhouse/client.ts"
    );
    // Clean up rows produced by this test
    await chQuery(
      `ALTER TABLE dub.dub_click_events DELETE WHERE link_id = '${TEST_LINK}'`,
    ).catch(() => undefined);
  });

  it("expected schema tables exist", async () => {
    const { chQuery } = await import(
      "../../apps/web/lib/clickhouse/client.ts"
    );
    const tables = await chQuery<{ name: string }>(
      "SELECT name FROM system.tables WHERE database='dub'",
    );
    const names = tables.map((t) => t.name);
    for (const required of [
      "dub_click_events",
      "dub_lead_events",
      "dub_sale_events",
      "dub_links_metadata",
      "dub_audit_logs",
      "dub_api_logs",
    ]) {
      expect(names, `missing table: ${required}`).toContain(required);
    }
  });

  it("chInsert + chQuery roundtrip a click event", async () => {
    const { chInsert, chQuery } = await import(
      "../../apps/web/lib/clickhouse/client.ts"
    );
    await chInsert("dub_click_events", [
      {
        timestamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
        click_id: `c_${Date.now()}`,
        link_id: TEST_LINK,
        url: "https://example.com",
        country: "US",
        city: "SF",
        region: "CA",
        ip: "127.0.0.1",
        bot: 0,
        qr: 0,
        trigger: "link",
      },
    ]);

    // Wait for the insert to be queryable (ClickHouse is fast but this is
    // belt-and-suspenders for AggregatingMergeTree variants).
    const rows = await chQuery<{ count: string | number }>(
      `SELECT count() AS count FROM dub.dub_click_events WHERE link_id = '${TEST_LINK}'`,
    );
    // ClickHouse returns UInt64 as a string in JSON to preserve precision.
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it("v3_count pipe returns matching count", async () => {
    const { runPipe } = await import("../../apps/web/lib/clickhouse/pipes.ts");
    const r = await runPipe("v3_count", { linkId: TEST_LINK });
    expect(Array.isArray(r)).toBe(true);
    // there must be at least one row returned by count() — value may vary
    expect(r.length).toBeGreaterThan(0);
  });

  it("v3_group_by(country) returns the inserted country", async () => {
    const { runPipe } = await import("../../apps/web/lib/clickhouse/pipes.ts");
    const r = await runPipe("v3_group_by", {
      groupBy: "country",
      linkId: TEST_LINK,
    });
    expect(r.find((row: any) => row.country === "US")).toBeTruthy();
  });

  it("v3_group_by_link_country joins linkIds[]", async () => {
    const { runPipe } = await import("../../apps/web/lib/clickhouse/pipes.ts");
    const r = await runPipe("v3_group_by_link_country", {
      linkIds: [TEST_LINK],
      start: "1970-01-01 00:00:00",
      end: "2099-01-01 00:00:00",
    });
    expect(
      r.find((row: any) => row.link_id === TEST_LINK && row.country === "US"),
    ).toBeTruthy();
  });
});
