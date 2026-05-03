import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `verifyVercelSignature` imports DubApiError; stub it so we don't need the
// whole api/errors module graph.
vi.mock("../../apps/web/lib/api/errors", () => ({
  DubApiError: class extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
}));

describe("lib/cron/verify-vercel", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  const make = (auth?: string) =>
    new Request("http://test/cron", {
      headers: auth ? { authorization: auth } : {},
    });

  it("noop in local dev (no VERCEL, no SELF_HOSTED)", async () => {
    delete process.env.VERCEL;
    delete process.env.SELF_HOSTED;
    process.env.CRON_SECRET = "secret";
    const { verifyVercelSignature } = await import(
      "../../apps/web/lib/cron/verify-vercel.ts"
    );
    await expect(verifyVercelSignature(make())).resolves.toBeUndefined();
  });

  it("rejects without bearer when SELF_HOSTED=1", async () => {
    process.env.SELF_HOSTED = "1";
    process.env.CRON_SECRET = "secret";
    const { verifyVercelSignature } = await import(
      "../../apps/web/lib/cron/verify-vercel.ts"
    );
    await expect(verifyVercelSignature(make())).rejects.toThrow();
  });

  it("accepts correct bearer when SELF_HOSTED=1", async () => {
    process.env.SELF_HOSTED = "1";
    process.env.CRON_SECRET = "secret";
    const { verifyVercelSignature } = await import(
      "../../apps/web/lib/cron/verify-vercel.ts"
    );
    await expect(
      verifyVercelSignature(make("Bearer secret")),
    ).resolves.toBeUndefined();
  });

  it("rejects wrong bearer", async () => {
    process.env.SELF_HOSTED = "1";
    process.env.CRON_SECRET = "secret";
    const { verifyVercelSignature } = await import(
      "../../apps/web/lib/cron/verify-vercel.ts"
    );
    await expect(verifyVercelSignature(make("Bearer wrong"))).rejects.toThrow();
  });

  it("rejects when CRON_SECRET unset on Vercel", async () => {
    process.env.VERCEL = "1";
    delete process.env.CRON_SECRET;
    delete process.env.SELF_HOSTED;
    const { verifyVercelSignature } = await import(
      "../../apps/web/lib/cron/verify-vercel.ts"
    );
    await expect(
      verifyVercelSignature(make("Bearer something")),
    ).rejects.toThrow();
  });
});
