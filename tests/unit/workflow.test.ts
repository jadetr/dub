import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// In-memory Redis stub for ioredis. Use a class so `new IORedis()` works.
const store = new Map<string, string>();
const getMock = vi.fn(async (k: string) => store.get(k) ?? null);
const setMock = vi.fn(async (k: string, v: string) => {
  store.set(k, v);
  return "OK";
});

class FakeIORedis {
  constructor(_url?: string, _opts?: unknown) {}
  get = getMock;
  set = setMock;
  quit = vi.fn();
  on() {}
}

vi.mock("ioredis", () => ({ default: FakeIORedis }));

describe("lib/queue/workflow self-hosted shim", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    store.clear();
    getMock.mockClear();
    setMock.mockClear();
    vi.resetModules();
    process.env.SELF_HOSTED = "1";
    process.env.REDIS_URL = "redis://localhost:6379";
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  const post = (body: unknown, runId = "run_1") =>
    new Request("http://web/api/workflows/test", {
      method: "POST",
      headers: { "x-workflow-run-id": runId },
      body: JSON.stringify(body),
    });

  it("executes all steps once on the happy path", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    const calls: string[] = [];
    const handler = serve<{ x: number }>(async (ctx) => {
      await ctx.run("step-a", async () => {
        calls.push("a");
      });
      await ctx.run("step-b", async () => {
        calls.push("b");
      });
    });
    const res = await handler.POST(post({ x: 1 }));
    expect(res.status).toBe(200);
    expect(calls).toEqual(["a", "b"]);
  });

  it("skips already-completed steps on retry (replay semantics)", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    const calls: string[] = [];
    const handler = serve(async (ctx) => {
      await ctx.run("step-a", async () => {
        calls.push("a");
        return "result-a";
      });
      await ctx.run("step-b", async () => {
        calls.push("b");
      });
    });
    await handler.POST(post({}, "same-run"));
    expect(calls).toEqual(["a", "b"]);
    await handler.POST(post({}, "same-run"));
    expect(calls).toEqual(["a", "b"]);
  });

  it("returns the cached result of a previously-run step", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    let captured: unknown;
    const handler = serve(async (ctx) => {
      const r = await ctx.run("step-a", async () => ({ ok: true, n: 42 }));
      captured = r;
    });
    await handler.POST(post({}, "rid-x"));
    captured = null;
    await handler.POST(post({}, "rid-x"));
    expect(captured).toEqual({ ok: true, n: 42 });
  });

  it("returns 500 with error message on step failure", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    const handler = serve(async (ctx) => {
      await ctx.run("bad", async () => {
        throw new Error("oops");
      });
    });
    const res = await handler.POST(post({}, "rid-fail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("oops");
  });

  it("synthesizes a workflow run id when header is absent", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    let runId = "";
    const handler = serve(async (ctx) => {
      runId = ctx.workflowRunId;
    });
    const res = await handler.POST(
      new Request("http://web/api/workflows/x", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    expect(runId).toMatch(/^wf_/);
  });

  it("ctx.sleep does not block beyond the requested time", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    const t0 = Date.now();
    const handler = serve(async (ctx) => {
      await ctx.sleep("nap", 0.05);
    });
    await handler.POST(post({}, "sleep-rid"));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
