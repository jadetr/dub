// Thin ClickHouse HTTP client used by the Tinybird-compat shim.
// We hit the JSON / JSONEachRow HTTP interface directly to avoid pulling in
// `@clickhouse/client` into Next's runtime bundle.

const URL_BASE = (process.env.CLICKHOUSE_URL || "http://clickhouse:8123").replace(/\/$/, "");
const DB = process.env.CLICKHOUSE_DATABASE || "dub";
const USER = process.env.CLICKHOUSE_USER || "default";
const PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";

const authHeaders = (): Record<string, string> => ({
  "x-clickhouse-user": USER,
  "x-clickhouse-key": PASSWORD,
  "x-clickhouse-database": DB,
});

export async function chQuery<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const search = new URLSearchParams({
    default_format: "JSON",
    query: sql,
  });
  for (const [k, v] of Object.entries(params || {})) {
    search.set(`param_${k}`, Array.isArray(v) ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`${URL_BASE}/?${search.toString()}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T[] };
  return json.data ?? [];
}

export async function chInsert(table: string, rows: object | object[]): Promise<void> {
  const data = Array.isArray(rows) ? rows : [rows];
  if (data.length === 0) return;
  const body = data.map((r) => JSON.stringify(r)).join("\n");
  const search = new URLSearchParams({
    query: `INSERT INTO ${DB}.${table} FORMAT JSONEachRow`,
    input_format_skip_unknown_fields: "1",
    date_time_input_format: "best_effort",
  });
  const res = await fetch(`${URL_BASE}/?${search.toString()}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/x-ndjson" },
    body,
  });
  if (!res.ok) {
    throw new Error(`ClickHouse insert failed (${res.status}): ${await res.text()}`);
  }
}

export const clickhouseEnabled = process.env.SELF_HOSTED === "1";
