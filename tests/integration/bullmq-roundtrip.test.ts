import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import IORedis from "ioredis";
import { Worker, Queue } from "bullmq";
import { createServer, Server } from "node:http";

// Validates that lib/queue (BullMQ-backed qstash adapter) actually enqueues a
// job that a worker can consume and dispatch via HTTP — same shape as
// `apps/worker/src/index.ts` would do in production.

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

let httpServer: Server;
let port = 0;
let received: { body: string; headers: any; url: string }[] = [];
let handleRequest: (
  req: any,
  res: any,
) => void = (req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c));
  req.on("end", () => {
    received.push({ url: req.url, body, headers: req.headers });
    res.statusCode = 200;
    res.end("ok");
  });
};

const conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
let worker: Worker | null = null;
let queue: Queue | null = null;

beforeAll(async () => {
  process.env.SELF_HOSTED = "1";
  process.env.REDIS_URL = REDIS_URL;

  httpServer = createServer((req, res) => handleRequest(req, res));
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  port = (httpServer.address() as any).port;

  queue = new Queue("dub-jobs", { connection: conn });
  await queue.drain(true);
  await queue.obliterate({ force: true }).catch(() => undefined);

  worker = new Worker(
    "dub-jobs",
    async (job) => {
      const { url, body, method = "POST", headers = {} } = job.data as any;
      const r = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-cron-secret",
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: r.status };
    },
    { connection: conn, concurrency: 4 },
  );
  // BullMQ v5 Worker is "ready" once constructed; no need to wait for the
  // 'ready' event (which can race with closeable state in test env).
}, 30_000);

afterAll(async () => {
  await worker?.close();
  await queue?.close();
  await new Promise<void>((r) => httpServer?.close(() => r()));
  await conn.quit();
});

beforeEach(() => {
  received = [];
});

describe("BullMQ enqueue → worker → HTTP dispatch", () => {
  it("publishJSON enqueues, worker dispatches, web receives", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    await qstash.publishJSON({
      url: `http://127.0.0.1:${port}/api/cron/test`,
      body: { ping: 1 },
    });
    expect(await waitFor(() => received.length > 0, 8_000)).toBe(true);
    const last = received[received.length - 1];
    expect(JSON.parse(last.body)).toEqual({ ping: 1 });
    expect(last.headers.authorization).toBe("Bearer test-cron-secret");
    expect(last.url).toBe("/api/cron/test");
  });

  it("retries on failure with backoff (worker re-attempts)", async () => {
    let attemptsSeen = 0;
    handleRequest = (req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        attemptsSeen++;
        received.push({ url: req.url, body, headers: req.headers });
        if (attemptsSeen === 1) {
          res.statusCode = 500;
          res.end("fail-first");
        } else {
          res.statusCode = 200;
          res.end("ok");
        }
      });
    };

    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    // Override default 5s exponential backoff via custom options is not
    // exposed through qstash.publishJSON — first retry happens after the
    // BullMQ default backoff. Allow up to 30s.
    await qstash.publishJSON({
      url: `http://127.0.0.1:${port}/api/cron/retry`,
      body: { n: 0 },
      retries: 2,
    });
    expect(await waitFor(() => attemptsSeen >= 2, 30_000)).toBe(true);

    // Reset the request handler for subsequent tests
    handleRequest = (req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        received.push({ url: req.url, body, headers: req.headers });
        res.statusCode = 200;
        res.end("ok");
      });
    };
  }, 60_000);

  it("deduplicationId yields the same job id when re-published", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    const dedupId = `dedup_${Date.now()}`;
    const r1 = await qstash.publishJSON({
      url: `http://127.0.0.1:${port}/api/cron/dedup`,
      body: { i: 1 },
      deduplicationId: dedupId,
    });
    const r2 = await qstash.publishJSON({
      url: `http://127.0.0.1:${port}/api/cron/dedup`,
      body: { i: 2 },
      deduplicationId: dedupId,
    });
    expect(r1.messageId).toBeTruthy();
    expect(r2.messageId).toBe(r1.messageId);
  });
});

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
