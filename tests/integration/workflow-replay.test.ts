import { describe, it, expect, beforeAll } from "vitest";

// Drives lib/queue/workflow against a real Redis — verifies that step-replay
// truly persists across "executions" (i.e., separate ctx instances backed by
// the same workflow run id).

beforeAll(() => {
  process.env.SELF_HOSTED = "1";
  process.env.REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
});

describe("workflow shim: real-Redis step replay", () => {
  it("a retried run skips the step that already succeeded", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    const calls: string[] = [];
    const handler = serve(async (ctx) => {
      await ctx.run("compute", async () => {
        calls.push("compute");
        return { value: 42 };
      });
      await ctx.run("send-email", async () => {
        calls.push("send-email");
      });
    });

    const runId = `wf_real_${Date.now()}`;
    const post = (n: number) =>
      handler.POST(
        new Request("http://web/api/workflows/test", {
          method: "POST",
          headers: { "x-workflow-run-id": runId },
          body: JSON.stringify({ n }),
        }),
      );

    const r1 = await post(1);
    expect(r1.status).toBe(200);
    expect(calls).toEqual(["compute", "send-email"]);

    // Same workflow run id -> Redis cache hits -> no new calls.
    const r2 = await post(2);
    expect(r2.status).toBe(200);
    expect(calls).toEqual(["compute", "send-email"]);
  });

  it("fresh runId reruns all steps", async () => {
    const { serve } = await import("../../apps/web/lib/queue/workflow.ts");
    let n = 0;
    const handler = serve(async (ctx) => {
      await ctx.run("increment", async () => {
        n += 1;
      });
    });
    await handler.POST(
      new Request("http://web/x", {
        method: "POST",
        headers: { "x-workflow-run-id": `wf_a_${Date.now()}` },
        body: "{}",
      }),
    );
    await handler.POST(
      new Request("http://web/x", {
        method: "POST",
        headers: { "x-workflow-run-id": `wf_b_${Date.now()}` },
        body: "{}",
      }),
    );
    expect(n).toBe(2);
  });
});
