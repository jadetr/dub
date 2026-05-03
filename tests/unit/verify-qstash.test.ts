import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../apps/web/lib/api/errors", () => ({
  DubApiError: class extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    async verify() {
      return false;
    }
  },
  Client: class {},
}));

vi.mock("@dub/utils", () => ({ log: vi.fn() }));

const reload = async () => {
  vi.resetModules();
  return await import("../../apps/web/lib/cron/verify-qstash.ts");
};

describe("lib/cron/verify-qstash", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  const make = (auth?: string) =>
    new Request("http://test/cron", {
      headers: auth ? { authorization: auth } : {},
    });

  it("noop in local dev (no VERCEL)", async () => {
    delete process.env.VERCEL;
    delete process.env.SELF_HOSTED;
    const { verifyQstashSignature } = await reload();
    await expect(
      verifyQstashSignature({ req: make(), rawBody: "{}" }),
    ).resolves.toBeUndefined();
  });

  it("self-hosted: rejects missing bearer", async () => {
    process.env.VERCEL = "1";
    process.env.SELF_HOSTED = "1";
    process.env.CRON_SECRET = "shh";
    const { verifyQstashSignature } = await reload();
    await expect(
      verifyQstashSignature({ req: make(), rawBody: "{}" }),
    ).rejects.toThrow();
  });

  it("self-hosted: accepts correct bearer", async () => {
    process.env.VERCEL = "1";
    process.env.SELF_HOSTED = "1";
    process.env.CRON_SECRET = "shh";
    const { verifyQstashSignature } = await reload();
    await expect(
      verifyQstashSignature({ req: make("Bearer shh"), rawBody: "{}" }),
    ).resolves.toBeUndefined();
  });
});
