// Self-hosted Dub job worker.
//
// Pulls jobs off the BullMQ queue and POSTs them back to the web tier with a
// CRON_SECRET-signed Authorization header. Route handlers
// (`verifyQstashSignature` / `verifyVercelSignature`) accept this exact header
// when SELF_HOSTED=1.
//
// Job payload shape mirrors `lib/queue/index.ts:DubJob`:
//   { url, body?, method?, headers?, callback? }

import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

const QUEUE_NAME = "dub-jobs";
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const CRON_SECRET = process.env.CRON_SECRET || "";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 10);

if (!CRON_SECRET) {
  console.error("[worker] CRON_SECRET is required");
  process.exit(1);
}

interface DubJobData {
  url: string;
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  callback?: string;
}

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

async function processJob(job: Job<DubJobData>) {
  const { url, body, method = "POST", headers = {}, callback } = job.data;
  const started = Date.now();

  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CRON_SECRET}`,
      "x-bullmq-job-id": String(job.id ?? ""),
      "x-bullmq-attempt": String(job.attemptsMade + 1),
      ...headers,
    },
    body: method !== "GET" && body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const took = Date.now() - started;

  if (!res.ok) {
    console.warn(
      `[worker] ${method} ${url} -> ${res.status} (${took}ms) attempt=${job.attemptsMade + 1}`,
    );
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  console.log(`[worker] ${method} ${url} -> ${res.status} (${took}ms)`);

  if (callback) {
    fetch(callback, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: res.status, body: text.slice(0, 4000) }),
    }).catch((e) => console.warn("[worker] callback failed", e));
  }

  return { status: res.status, took };
}

const worker = new Worker<DubJobData>(QUEUE_NAME, processJob, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on("ready", () => console.log(`[worker] ready, concurrency=${CONCURRENCY}`));
worker.on("failed", (job, err) =>
  console.error(`[worker] job ${job?.id} failed: ${err.message}`),
);
worker.on("error", (err) => console.error("[worker] error:", err));

const shutdown = async (signal: string) => {
  console.log(`[worker] received ${signal}, draining...`);
  await worker.close();
  await connection.quit();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
