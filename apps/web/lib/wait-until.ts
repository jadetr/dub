// Drop-in replacement for `@vercel/functions` waitUntil that works on plain
// Node. On Vercel, `globalThis[Symbol.for('@vercel/request-context')]` exposes
// a real waitUntil. Outside Vercel we fire-and-forget, logging rejections.

type Awaitable<T> = T | Promise<T>;

export function waitUntil(promise: Awaitable<unknown>): void {
  const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.();
  const vercelWaitUntil = ctx?.waitUntil;
  if (typeof vercelWaitUntil === "function") {
    vercelWaitUntil(promise);
    return;
  }
  Promise.resolve(promise).catch((err) => {
    console.error("[waitUntil] background task failed:", err);
  });
}
