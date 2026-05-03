import { describe, it, expect, beforeEach, vi } from "vitest";

const reload = async () => {
  vi.resetModules();
  return await import("../../apps/web/lib/geo/maxmind.ts");
};

describe("lib/geo/maxmind", () => {
  beforeEach(() => {
    delete (globalThis as any).__maxmindCityMock;
    delete process.env.MAXMIND_DB_PATH;
  });

  it("extractIp prefers x-forwarded-for", async () => {
    const m = await reload();
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(m.extractIp(req)).toBe("1.2.3.4");
  });

  it("extractIp falls back to x-real-ip", async () => {
    const m = await reload();
    const req = new Request("http://x", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(m.extractIp(req)).toBe("9.9.9.9");
  });

  it("extractIp returns null when no header is set", async () => {
    const m = await reload();
    const req = new Request("http://x");
    expect(m.extractIp(req)).toBeNull();
  });

  it("lookupIp returns localhost defaults for loopback addresses", async () => {
    const m = await reload();
    const r = await m.lookupIp("127.0.0.1");
    expect(r.country).toBe("US");
  });

  it("lookupIp returns localhost defaults when MAXMIND_DB_PATH is unset", async () => {
    const m = await reload();
    const r = await m.lookupIp("8.8.8.8");
    expect(r.country).toBe("US");
  });

  it("lookupIp returns mmdb data when path is set and reader succeeds", async () => {
    process.env.MAXMIND_DB_PATH = "/geo/test.mmdb";
    (globalThis as any).__maxmindCityMock = () => ({
      country: { isoCode: "FR" },
      subdivisions: [{ isoCode: "75" }],
      continent: { code: "EU" },
      city: { names: { en: "Paris" } },
      location: { latitude: 48.85, longitude: 2.35 },
    });
    const m = await reload();
    const r = await m.lookupIp("8.8.8.8");
    expect(r.country).toBe("FR");
    expect(r.city).toBe("Paris");
    expect(r.region).toBe("75");
    expect(r.continent).toBe("EU");
  });

  it("lookupIp falls back to localhost on reader error", async () => {
    process.env.MAXMIND_DB_PATH = "/geo/test.mmdb";
    (globalThis as any).__maxmindCityMock = () => {
      throw new Error("not found");
    };
    const m = await reload();
    const r = await m.lookupIp("8.8.8.8");
    expect(r.country).toBe("US");
  });
});
