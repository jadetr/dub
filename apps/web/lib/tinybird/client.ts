// Tinybird/zod-bird-compatible client.
//
// On Vercel/Dub.co the real `@chronark/zod-bird` Tinybird client is used.
// When SELF_HOSTED=1 we return an API-compatible shim that:
//   * `buildIngestEndpoint({ datasource, event })` -> insert into the matching
//     ClickHouse table via the JSONEachRow HTTP interface.
//   * `buildPipe({ pipe, parameters, data })` -> dispatch to a SQL function in
//     `lib/clickhouse/pipes.ts`. Unknown pipes return `{ data: [] }` so call
//     sites continue to work without crashing.

import { Tinybird } from "@chronark/zod-bird";
import { chInsert } from "@/lib/clickhouse/client";
import { runPipe } from "@/lib/clickhouse/pipes";

const SELF_HOSTED = process.env.SELF_HOSTED === "1";

interface IngestParams<S> {
  datasource: string;
  event: { parse?: (v: any) => S; safeParse?: (v: any) => any };
  wait?: boolean;
}

interface PipeParams<P, R> {
  pipe: string;
  parameters?: { parse?: (v: any) => P };
  data: { parse?: (v: any) => R };
}

class SelfHostedTb {
  buildIngestEndpoint<S = any>({ datasource, event }: IngestParams<S>) {
    return async (payload: S | S[]): Promise<{ successful_rows: number }> => {
      const rows = Array.isArray(payload) ? payload : [payload];
      const validated = rows.map((r) => (event.parse ? event.parse(r) : r));
      try {
        await chInsert(datasource, validated as object[]);
        return { successful_rows: validated.length };
      } catch (err) {
        console.error(`[tb→ch] insert ${datasource} failed:`, err);
        return { successful_rows: 0 };
      }
    };
  }

  buildPipe<P = any, R = any>({ pipe, parameters, data }: PipeParams<P, R>) {
    return async (params?: P): Promise<{ data: R[]; meta?: any[]; rows?: number }> => {
      const parsed = parameters?.parse ? parameters.parse(params) : params;
      try {
        const rows = await runPipe(pipe, parsed);
        const validated = data.parse
          ? rows.map((r) => data.parse!(r))
          : (rows as R[]);
        return { data: validated as R[], rows: validated.length };
      } catch (err) {
        console.error(`[tb→ch] pipe ${pipe} failed:`, err);
        return { data: [], rows: 0 };
      }
    };
  }
}

export const tb: any = SELF_HOSTED
  ? new SelfHostedTb()
  : new Tinybird({
      token: process.env.TINYBIRD_API_KEY as string,
      baseUrl: process.env.TINYBIRD_API_URL as string,
    });
