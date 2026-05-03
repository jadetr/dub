// QStash-compatible queue adapter for self-hosted Dub.
//
// On Vercel/Dub.co (`SELF_HOSTED` unset) this re-exports the real `@upstash/qstash`
// `Client`. When `SELF_HOSTED=1`, every `publishJSON`/`publish`/`batchJSON` call
// goes into a BullMQ queue keyed by URL path. The worker process (apps/worker)
// dequeues jobs and POSTs them back to the web tier with a CRON_SECRET-signed
// header so route handlers (`verifyQstashSignature`/`verifyVercelSignature`)
// accept them.

import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { Client as QStashClient } from "@upstash/qstash";

const SELF_HOSTED = process.env.SELF_HOSTED === "1";

export const QUEUE_NAME = "dub-jobs";

let connection: IORedis | null = null;
function getRedis(): IORedis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required when SELF_HOSTED=1");
  connection = new IORedis(url, { maxRetriesPerRequest: null });
  return connection;
}

let bullQueue: Queue | null = null;
function getBullQueue(): Queue {
  if (bullQueue) return bullQueue;
  bullQueue = new Queue(QUEUE_NAME, { connection: getRedis() });
  return bullQueue;
}

export type DubJob = {
  url: string;
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  /** ms delay before processing */
  delay?: number;
  /** dedup key */
  deduplicationId?: string;
  /** callback url after the job runs (rare; QStash compat) */
  callback?: string;
};

function jobOptionsFromQStash(input: any): JobsOptions {
  const opts: JobsOptions = {
    attempts: typeof input.retries === "number" ? input.retries : 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
  if (input.delay) opts.delay = Number(input.delay) * 1000;
  if (input.notBefore) opts.delay = Math.max(0, Number(input.notBefore) * 1000 - Date.now());
  if (input.deduplicationId) opts.jobId = String(input.deduplicationId);
  return opts;
}

class SelfHostedQStash {
  async publishJSON(input: {
    url: string;
    body?: unknown;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    retries?: number;
    delay?: number;
    notBefore?: number;
    deduplicationId?: string;
    callback?: string;
  }) {
    const job: DubJob = {
      url: input.url,
      body: input.body,
      method: input.method ?? "POST",
      headers: input.headers,
      callback: input.callback,
    };
    const opts = jobOptionsFromQStash(input);
    const enqueued = await getBullQueue().add("publish", job, opts);
    return { messageId: enqueued.id ?? "" };
  }

  async publish(input: {
    url: string;
    body?: string | Uint8Array;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    retries?: number;
    delay?: number;
    deduplicationId?: string;
  }) {
    return this.publishJSON({
      ...input,
      body: typeof input.body === "string" ? input.body : undefined,
    });
  }

  async batchJSON(jobs: any[]) {
    const results = await Promise.all(
      jobs.map((j) => this.publishJSON(j)),
    );
    return results;
  }

  // `client.queue({ queueName })` mirrors @upstash/qstash. The returned
  // object exposes `enqueueJSON()` matching publishJSON's shape; in self-
  // hosted mode the queueName is ignored and jobs land in the shared bull
  // queue keyed by URL. `upsert()` is a no-op (BullMQ has no concept).
  queue({ queueName: _queueName }: { queueName: string }) {
    const self = this;
    return {
      async enqueueJSON(input: Parameters<SelfHostedQStash["publishJSON"]>[0]) {
        return self.publishJSON(input);
      },
      async upsert() {
        return { ok: true } as const;
      },
    };
  }

  schedules = {
    create: async (input: { destination: string; cron: string; body?: unknown }) => {
      // BullMQ repeatable jobs ~ QStash schedules.
      const job = await getBullQueue().add(
        "publish",
        {
          url: input.destination,
          method: "POST",
          body: input.body,
        } satisfies DubJob,
        {
          repeat: { pattern: input.cron },
          jobId: `schedule:${input.destination}`,
        },
      );
      return { scheduleId: job.id ?? "" };
    },
    delete: async (id: string) => {
      const repeatables = await getBullQueue().getRepeatableJobs();
      const target = repeatables.find((r) => r.id === id || r.key === id);
      if (target) await getBullQueue().removeRepeatableByKey(target.key);
      return { ok: true };
    },
  };
}

let realClient: QStashClient | null = null;
function getReal(): QStashClient {
  if (realClient) return realClient;
  realClient = new QStashClient({ token: process.env.QSTASH_TOKEN || "" });
  return realClient;
}

export const qstash: any = SELF_HOSTED ? new SelfHostedQStash() : getReal();

// Default batch size for cron jobs that process records in batches
export const CRON_BATCH_SIZE = 100;
