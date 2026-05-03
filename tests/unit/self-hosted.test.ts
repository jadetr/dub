import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Use a static literal in dynamic import so vite/vitest can resolve it.
const reload = async () => {
  vi.resetModules();
  return await import("../../apps/web/lib/self-hosted.ts");
};

describe("lib/self-hosted feature flags", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("disables stripe when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const m = await reload();
    expect(m.features.stripe).toBe(false);
  });

  it("enables stripe when STRIPE_SECRET_KEY is set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    const m = await reload();
    expect(m.features.stripe).toBe(true);
  });

  it("requires both clientId and clientSecret for OAuth providers", async () => {
    process.env.GOOGLE_CLIENT_ID = "x";
    delete process.env.GOOGLE_CLIENT_SECRET;
    const m = await reload();
    expect(m.features.googleAuth).toBe(false);
  });

  it("derives SELF_HOSTED from process.env", async () => {
    process.env.SELF_HOSTED = "1";
    const m = await reload();
    expect(m.SELF_HOSTED).toBe(true);
  });

  it("disables vercelDomains when SELF_HOSTED=1 even with VERCEL_API_KEY", async () => {
    process.env.SELF_HOSTED = "1";
    process.env.VERCEL_API_KEY = "x";
    const m = await reload();
    expect(m.features.vercelDomains).toBe(false);
  });

  it("requireFeature throws for disabled feature", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const m = await reload();
    expect(() => m.requireFeature("stripe" as any)).toThrow(/disabled/);
  });

  it("requireFeature is silent for enabled feature", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_x";
    const m = await reload();
    expect(() => m.requireFeature("stripe" as any)).not.toThrow();
  });

  it("treats empty strings as unset", async () => {
    process.env.STRIPE_SECRET_KEY = "";
    const m = await reload();
    expect(m.features.stripe).toBe(false);
  });
});
