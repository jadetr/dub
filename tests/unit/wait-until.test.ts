import { describe, it, expect, vi, afterEach } from "vitest";
import { waitUntil } from "../../apps/web/lib/wait-until";

describe("lib/wait-until", () => {
  const sym = Symbol.for("@vercel/request-context");
  afterEach(() => {
    delete (globalThis as any)[sym];
    vi.restoreAllMocks();
  });

  it("runs the promise to completion in plain Node", async () => {
    let done = false;
    const p = new Promise<void>((res) =>
      setTimeout(() => {
        done = true;
        res();
      }, 5),
    );
    waitUntil(p);
    await p;
    expect(done).toBe(true);
  });

  it("logs but does not throw on rejection", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    waitUntil(Promise.reject(new Error("boom")));
    await new Promise((r) => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0][0])).toContain("waitUntil");
  });

  it("delegates to vercel request context when present", () => {
    const fakeWaitUntil = vi.fn();
    (globalThis as any)[sym] = { get: () => ({ waitUntil: fakeWaitUntil }) };
    const p = Promise.resolve(1);
    waitUntil(p);
    expect(fakeWaitUntil).toHaveBeenCalledWith(p);
  });

  it("accepts non-promise values", async () => {
    expect(() => waitUntil(42 as any)).not.toThrow();
  });
});
