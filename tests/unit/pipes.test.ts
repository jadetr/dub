import { describe, it, expect, beforeEach, vi } from "vitest";

const chQueryMock = vi.fn(async () => [] as any[]);

vi.mock("../../apps/web/lib/clickhouse/client.ts", () => ({
  chQuery: chQueryMock,
  chInsert: vi.fn(),
  clickhouseEnabled: true,
}));

describe("lib/clickhouse/pipes", () => {
  beforeEach(() => {
    chQueryMock.mockClear();
    chQueryMock.mockResolvedValue([]);
  });

  it("hasPipe is true for registered pipes", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    expect(m.hasPipe("v3_count")).toBe(true);
    expect(m.hasPipe("v3_timeseries")).toBe(true);
    expect(m.hasPipe("v3_group_by")).toBe(true);
    expect(m.hasPipe("v3_group_by_link_country")).toBe(true);
  });

  it("hasPipe is false for unknown pipes", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    expect(m.hasPipe("does_not_exist")).toBe(false);
  });

  it("runPipe returns [] for unknown pipe (graceful degradation)", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    const r = await m.runPipe("does_not_exist", { foo: "bar" });
    expect(r).toEqual([]);
    expect(chQueryMock).not.toHaveBeenCalled();
  });

  it("v3_count strips single quotes from linkId to prevent injection", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    await m.runPipe("v3_count", {
      linkId: "abc'; DROP--",
      start: "2024-01-01 00:00:00",
      end: "2024-01-31 23:59:59",
    });
    const sql = chQueryMock.mock.calls[0][0] as string;
    // The injected single-quote-then-statement-terminator must not survive
    // unescaped. Our adapter strips single quotes entirely from string params.
    expect(sql).not.toMatch(/'abc'; DROP--/);
    expect(sql).toContain("link_id = 'abc; DROP--'");
  });

  it("v3_timeseries selects the right bucket function", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    await m.runPipe("v3_timeseries", { granularity: "hour" });
    expect(chQueryMock.mock.calls[0][0]).toContain("toStartOfHour");
    chQueryMock.mockClear();
    await m.runPipe("v3_timeseries", { granularity: "day" });
    expect(chQueryMock.mock.calls[0][0]).toContain("toStartOfDay");
    chQueryMock.mockClear();
    await m.runPipe("v3_timeseries", { granularity: "month" });
    expect(chQueryMock.mock.calls[0][0]).toContain("toStartOfMonth");
  });

  it("v3_group_by rejects unknown groupBy column (allowlist)", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    const r = await m.runPipe("v3_group_by", { groupBy: "; DROP TABLE x;--" });
    expect(r).toEqual([]);
    expect(chQueryMock).not.toHaveBeenCalled();
  });

  it("v3_group_by accepts allowlisted columns", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    chQueryMock.mockResolvedValueOnce([{ country: "US", clicks: 5 }]);
    const r = await m.runPipe("v3_group_by", { groupBy: "country", limit: 10 });
    expect(r).toEqual([{ country: "US", clicks: 5 }]);
    expect(chQueryMock.mock.calls[0][0]).toContain("LIMIT 10");
  });

  it("v3_group_by_link_country builds an IN list", async () => {
    const m = await import("../../apps/web/lib/clickhouse/pipes.ts");
    await m.runPipe("v3_group_by_link_country", {
      linkIds: ["l1", "l2"],
      start: "2024-01-01 00:00:00",
      end: "2024-01-02 00:00:00",
    });
    const sql = chQueryMock.mock.calls[0][0] as string;
    expect(sql).toContain("'l1'");
    expect(sql).toContain("'l2'");
    expect(sql).toContain("GROUP BY link_id, country");
  });
});
