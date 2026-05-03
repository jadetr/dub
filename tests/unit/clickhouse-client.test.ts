import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("lib/clickhouse/client", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.CLICKHOUSE_URL = "http://ch:8123";
    process.env.CLICKHOUSE_DATABASE = "dub";
    process.env.CLICKHOUSE_USER = "dub";
    process.env.CLICKHOUSE_PASSWORD = "dub";
    fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("chQuery returns the data array on 200", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ a: 1 }, { a: 2 }], rows: 2 }),
    });
    const { chQuery } = await import("../../apps/web/lib/clickhouse/client.ts");
    const rows = await chQuery<{ a: number }>("SELECT a FROM t");
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("chQuery sends auth headers and database", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const { chQuery } = await import("../../apps/web/lib/clickhouse/client.ts");
    await chQuery("SELECT 1");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("http://ch:8123");
    expect(String(url)).toContain("default_format=JSON");
    expect((init as any).headers["x-clickhouse-user"]).toBe("dub");
    expect((init as any).headers["x-clickhouse-database"]).toBe("dub");
  });

  it("chQuery throws on non-2xx", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    const { chQuery } = await import("../../apps/web/lib/clickhouse/client.ts");
    await expect(chQuery("BAD SQL")).rejects.toThrow(/500/);
  });

  it("chInsert formats body as JSONEachRow", async () => {
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" });
    const { chInsert } = await import("../../apps/web/lib/clickhouse/client.ts");
    await chInsert("dub_click_events", [
      { click_id: "c1", country: "US" },
      { click_id: "c2", country: "FR" },
    ]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("INSERT");
    expect(String(url)).toContain("JSONEachRow");
    const body = (init as any).body as string;
    expect(body.split("\n")).toHaveLength(2);
    expect(JSON.parse(body.split("\n")[0])).toEqual({
      click_id: "c1",
      country: "US",
    });
  });

  it("chInsert is a noop on empty array", async () => {
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" });
    const { chInsert } = await import("../../apps/web/lib/clickhouse/client.ts");
    await chInsert("dub_click_events", []);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chInsert wraps a single object in an array", async () => {
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" });
    const { chInsert } = await import("../../apps/web/lib/clickhouse/client.ts");
    await chInsert("dub_click_events", { click_id: "solo" });
    const body = (fetchSpy.mock.calls[0][1] as any).body as string;
    expect(body).toBe(JSON.stringify({ click_id: "solo" }));
  });

  it("chInsert throws on insert failure", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "type mismatch",
    });
    const { chInsert } = await import("../../apps/web/lib/clickhouse/client.ts");
    await expect(
      chInsert("dub_click_events", [{ click_id: "c1" }]),
    ).rejects.toThrow(/400/);
  });
});
