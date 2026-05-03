import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const addMock = vi.fn(async () => ({ id: "job-id-1" }));
const getRepeatableJobsMock = vi.fn(async () => [] as any[]);
const removeRepeatableByKeyMock = vi.fn(async () => true);

class FakeQueue {
  add = addMock;
  getRepeatableJobs = getRepeatableJobsMock;
  removeRepeatableByKey = removeRepeatableByKeyMock;
}

class FakeIORedis {
  // BullMQ inspects connection at construction; an empty stub is fine.
  constructor(_url?: string, _opts?: unknown) {}
  on() {}
  quit() {}
}

vi.mock("bullmq", () => ({ Queue: FakeQueue }));
vi.mock("ioredis", () => ({ default: FakeIORedis }));

// Static import of @upstash/qstash sits at the top of the adapter even when
// SELF_HOSTED=1 — stub it so the import doesn't try to instantiate a real
// client.
vi.mock("@upstash/qstash", () => ({ Client: class {} }));

describe("lib/queue (BullMQ-backed qstash adapter)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    addMock.mockClear();
    getRepeatableJobsMock.mockClear();
    removeRepeatableByKeyMock.mockClear();
    vi.resetModules();
    process.env.SELF_HOSTED = "1";
    process.env.REDIS_URL = "redis://localhost:6379";
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("publishJSON enqueues with default attempts and exponential backoff", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    const r = await qstash.publishJSON({
      url: "http://web/api/cron/test",
      body: { hello: "world" },
    });
    expect(r.messageId).toBe("job-id-1");
    expect(addMock).toHaveBeenCalledOnce();
    const [name, data, opts] = addMock.mock.calls[0];
    expect(name).toBe("publish");
    expect(data).toMatchObject({
      url: "http://web/api/cron/test",
      body: { hello: "world" },
      method: "POST",
    });
    expect(opts).toMatchObject({ attempts: 3 });
    expect(opts.backoff).toEqual({ type: "exponential", delay: 5_000 });
  });

  it("forwards retries and delay correctly", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    await qstash.publishJSON({
      url: "http://web/api/cron/x",
      retries: 7,
      delay: 30,
    });
    const [, , opts] = addMock.mock.calls[0];
    expect(opts.attempts).toBe(7);
    expect(opts.delay).toBe(30_000);
  });

  it("uses deduplicationId as BullMQ jobId", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    await qstash.publishJSON({
      url: "http://web/x",
      deduplicationId: "stable-key",
    });
    const [, , opts] = addMock.mock.calls[0];
    expect(opts.jobId).toBe("stable-key");
  });

  it("batchJSON enqueues every job in the batch", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    const result = await qstash.batchJSON([
      { url: "http://web/a" },
      { url: "http://web/b" },
      { url: "http://web/c" },
    ]);
    expect(result).toHaveLength(3);
    expect(addMock).toHaveBeenCalledTimes(3);
  });

  it("schedules.create registers a repeatable BullMQ job", async () => {
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    await qstash.schedules.create({
      destination: "http://web/api/cron/foo",
      cron: "*/5 * * * *",
    });
    const [, , opts] = addMock.mock.calls[0];
    expect(opts.repeat).toEqual({ pattern: "*/5 * * * *" });
  });

  it("schedules.delete removes a matching repeatable job", async () => {
    getRepeatableJobsMock.mockResolvedValueOnce([
      { id: "schedule:abc", key: "key-1" } as any,
    ]);
    const { qstash } = await import("../../apps/web/lib/queue/index.ts");
    await qstash.schedules.delete("schedule:abc");
    expect(removeRepeatableByKeyMock).toHaveBeenCalledWith("key-1");
  });
});
