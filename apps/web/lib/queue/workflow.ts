// Drop-in compat shim for `@upstash/workflow/nextjs` `serve()`.
//
// The real Upstash workflow runtime calls each `context.run(name, fn)` step in
// a separate HTTP-triggered execution and persists the return value remotely
// so retries skip already-completed steps. We replicate the *interface* so
// existing route files compile unchanged, and provide a Redis-backed step
// cache so retried executions skip already-completed steps in self-hosted.

import IORedis from "ioredis";

const SELF_HOSTED = process.env.SELF_HOSTED === "1";

let redis: IORedis | null = null;
function getRedis(): IORedis {
  if (redis) return redis;
  redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  return redis;
}

interface WorkflowContext<T> {
  workflowRunId: string;
  workflowUrl: string;
  requestPayload: T;
  run<R>(name: string, fn: () => Promise<R>): Promise<R>;
  sleep(name: string, seconds: number): Promise<void>;
  sleepUntil(name: string, until: Date | number): Promise<void>;
  call<R = unknown>(
    name: string,
    opts: { url: string; method?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<R>;
}

type Handler<T> = (ctx: WorkflowContext<T>) => Promise<unknown>;

function makeContext<T>(
  payload: T,
  workflowRunId: string,
  url: string,
): WorkflowContext<T> {
  const r = getRedis();
  const stepKey = (name: string) => `wf:${workflowRunId}:step:${name}`;

  return {
    workflowRunId,
    workflowUrl: url,
    requestPayload: payload,
    async run<R>(name: string, fn: () => Promise<R>): Promise<R> {
      const cached = await r.get(stepKey(name));
      if (cached !== null) return JSON.parse(cached) as R;
      const result = await fn();
      try {
        await r.set(
          stepKey(name),
          JSON.stringify(result ?? null),
          "EX",
          7 * 24 * 3600,
        );
      } catch {
        // result not JSON-serializable: ignore caching, treat as best-effort
      }
      return result;
    },
    async sleep(_name, seconds) {
      await new Promise((res) => setTimeout(res, seconds * 1000));
    },
    async sleepUntil(_name, until) {
      const t = until instanceof Date ? until.getTime() : Number(until) * 1000;
      const ms = Math.max(0, t - Date.now());
      await new Promise((res) => setTimeout(res, ms));
    },
    async call(_name, opts) {
      const res = await fetch(opts.url, {
        method: opts.method || "POST",
        headers: { "content-type": "application/json", ...(opts.headers || {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text as unknown as never;
      }
    },
  };
}

interface ServeOptions<T> {
  initialPayloadParser?: (requestPayload: string) => T;
}

/**
 * `serve()` matches the @upstash/workflow/nextjs export. The route handler is
 * triggered via plain HTTP POST with a JSON body; we run all steps inline and
 * return 200.
 */
export function serve<T = unknown>(
  handler: Handler<T>,
  options?: ServeOptions<T>,
) {
  if (!SELF_HOSTED) {
    // Defer to the real package on Vercel/Dub.co.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const real = require("@upstash/workflow/nextjs");
    return real.serve(handler, options);
  }

  const POST = async (req: Request) => {
    let payload: T;
    try {
      const raw = await req.text();
      if (options?.initialPayloadParser) {
        payload = options.initialPayloadParser(raw);
      } else {
        payload = (raw ? JSON.parse(raw) : {}) as T;
      }
    } catch {
      payload = {} as T;
    }
    const runId =
      req.headers.get("x-workflow-run-id") ??
      `wf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const ctx = makeContext<T>(payload, runId, req.url);
    try {
      await handler(ctx);
      return new Response(JSON.stringify({ ok: true, runId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      console.error(`[workflow ${runId}]`, err);
      return new Response(
        JSON.stringify({ ok: false, error: (err as Error).message }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  };

  return { POST };
}

/**
 * Trigger a workflow by URL. Self-hosted: enqueue via BullMQ; the worker will
 * POST it back to the web tier.
 */
export async function triggerWorkflowsSelfHosted(input: {
  workflowId: string;
  body?: unknown;
}) {
  const { qstash } = await import("./index");
  const url = `${process.env.NEXTAUTH_URL}/api/workflows/${input.workflowId}`;
  return qstash.publishJSON({ url, body: input.body, retries: 3 });
}
