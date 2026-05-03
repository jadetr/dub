// Translations of selected `packages/tinybird/pipes/*.pipe` definitions to
// ClickHouse SQL. Pipe names match the `pipe:` field passed to
// `tb.buildPipe({...})` so the Tinybird-compat shim can dispatch by name.
//
// Not every pipe is translated yet — unknown pipes return `[]` from the shim
// (analytics dashboards show 0 instead of crashing). To add a new pipe, add an
// entry below; the function receives the params object passed to buildPipe.

import { chQuery } from "./client";

type PipeFn = (params: Record<string, any>) => Promise<any[]>;

const sanitizeStringList = (xs: unknown[] | undefined): string =>
  (xs || [])
    .map((x) => String(x).replace(/'/g, ""))
    .map((x) => `'${x}'`)
    .join(",") || "''";

export const pipes: Record<string, PipeFn> = {
  // Top links by country – used by aggregate-clicks cron.
  v3_group_by_link_country: async ({ linkIds, start, end }) => {
    const sql = `
      SELECT link_id, country, count() AS clicks
      FROM dub.dub_click_events
      WHERE bot = 0
        AND link_id IN (${sanitizeStringList(linkIds)})
        AND timestamp BETWEEN parseDateTime64BestEffort('${start}') AND parseDateTime64BestEffort('${end}')
      GROUP BY link_id, country
      ORDER BY clicks DESC
    `;
    return chQuery(sql);
  },

  // Generic count for a single link/workspace.
  v3_count: async ({ linkId, workspaceId, start, end }) => {
    const filters: string[] = ["bot = 0"];
    if (linkId) filters.push(`link_id = '${String(linkId).replace(/'/g, "")}'`);
    if (workspaceId)
      filters.push(`workspace_id = '${String(workspaceId).replace(/'/g, "")}'`);
    if (start)
      filters.push(`timestamp >= parseDateTime64BestEffort('${start}')`);
    if (end) filters.push(`timestamp <= parseDateTime64BestEffort('${end}')`);
    return chQuery(
      `SELECT count() AS clicks FROM dub.dub_click_events WHERE ${filters.join(" AND ")}`,
    );
  },

  // Hourly/daily timeseries.
  v3_timeseries: async ({ linkId, workspaceId, start, end, granularity }) => {
    const bucket =
      granularity === "minute"
        ? "toStartOfMinute(timestamp)"
        : granularity === "hour"
          ? "toStartOfHour(timestamp)"
          : granularity === "month"
            ? "toStartOfMonth(timestamp)"
            : "toStartOfDay(timestamp)";
    const filters: string[] = ["bot = 0"];
    if (linkId) filters.push(`link_id = '${String(linkId).replace(/'/g, "")}'`);
    if (workspaceId)
      filters.push(`workspace_id = '${String(workspaceId).replace(/'/g, "")}'`);
    if (start)
      filters.push(`timestamp >= parseDateTime64BestEffort('${start}')`);
    if (end) filters.push(`timestamp <= parseDateTime64BestEffort('${end}')`);
    return chQuery(
      `SELECT ${bucket} AS start, count() AS clicks
       FROM dub.dub_click_events
       WHERE ${filters.join(" AND ")}
       GROUP BY start ORDER BY start`,
    );
  },

  // Generic group-by – used by analytics drill-downs (country, city, device, ...)
  v3_group_by: async ({ groupBy, linkId, workspaceId, start, end, limit }) => {
    if (!groupBy || typeof groupBy !== "string") return [];
    const allowed = new Set([
      "country",
      "city",
      "region",
      "continent",
      "device",
      "browser",
      "os",
      "referer",
      "url",
      "trigger",
    ]);
    if (!allowed.has(groupBy)) return [];
    const filters: string[] = ["bot = 0"];
    if (linkId) filters.push(`link_id = '${String(linkId).replace(/'/g, "")}'`);
    if (workspaceId)
      filters.push(`workspace_id = '${String(workspaceId).replace(/'/g, "")}'`);
    if (start)
      filters.push(`timestamp >= parseDateTime64BestEffort('${start}')`);
    if (end) filters.push(`timestamp <= parseDateTime64BestEffort('${end}')`);
    const lim = Number.isFinite(Number(limit)) ? Number(limit) : 1000;
    return chQuery(
      `SELECT ${groupBy}, count() AS clicks
       FROM dub.dub_click_events
       WHERE ${filters.join(" AND ")}
       GROUP BY ${groupBy} ORDER BY clicks DESC LIMIT ${lim}`,
    );
  },
};

export function hasPipe(name: string): boolean {
  return name in pipes;
}

export async function runPipe(name: string, params: any): Promise<any[]> {
  const fn = pipes[name];
  if (!fn) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[clickhouse] no pipe registered for "${name}" – returning empty result`,
      );
    }
    return [];
  }
  return fn(params || {});
}
