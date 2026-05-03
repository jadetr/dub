import { describe, it, expect } from "vitest";

// Validates that the Upstash-Redis-REST shim (`srh`) speaks the Upstash REST
// command protocol against a real Redis. Run inside the docker compose
// network so `srh` resolves.

const SRH_URL = process.env.SRH_URL || "http://srh:80";
const SRH_TOKEN = process.env.SRH_TOKEN || "localtoken";

async function cmd(...args: (string | number)[]): Promise<unknown> {
  const res = await fetch(SRH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SRH_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  expect(res.ok, `SRH returned ${res.status}`).toBe(true);
  const j = (await res.json()) as { result: unknown };
  return j.result;
}

describe("SRH (Upstash Redis REST shim) end-to-end", () => {
  it("authenticates with the configured token", async () => {
    const ping = await cmd("PING");
    expect(ping).toBe("PONG");
  });

  it("rejects requests without bearer token", async () => {
    const res = await fetch(SRH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["PING"]),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("supports SET/GET roundtrip", async () => {
    const k = `t:${Date.now()}`;
    expect(await cmd("SET", k, "hello")).toBe("OK");
    expect(await cmd("GET", k)).toBe("hello");
  });

  it("supports EXPIRE / TTL / DEL", async () => {
    const k = `t:ttl:${Date.now()}`;
    await cmd("SET", k, "x");
    await cmd("EXPIRE", k, 60);
    const ttl = (await cmd("TTL", k)) as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(await cmd("DEL", k)).toBe(1);
  });

  it("supports list ops (LPUSH / LRANGE)", async () => {
    const k = `t:list:${Date.now()}`;
    await cmd("LPUSH", k, "a", "b", "c");
    const items = (await cmd("LRANGE", k, 0, -1)) as string[];
    // LPUSH a b c -> ["c", "b", "a"]
    expect(items).toEqual(["c", "b", "a"]);
    await cmd("DEL", k);
  });
});
