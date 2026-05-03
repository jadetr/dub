// Self-hosted IP geolocation via MaxMind GeoLite2-City (mmdb).
// The mmdb is mounted at /geo/GeoLite2-City.mmdb in the container; if missing,
// every lookup returns the localhost defaults so the rest of the pipeline
// keeps working.

import type { ReaderModel } from "@maxmind/geoip2-node";
import { LOCALHOST_GEO_DATA } from "@dub/utils";

// @maxmind/geoip2-node v5: Reader.open() resolves to a non-generic ReaderModel.
// The older Reader<CityResponse>/CityResponse types were removed.
let reader: ReaderModel | null = null;
let triedOpen = false;

async function getReader(): Promise<ReaderModel | null> {
  if (reader || triedOpen) return reader;
  triedOpen = true;
  const path = process.env.MAXMIND_DB_PATH;
  if (!path) return null;
  try {
    const { Reader } = await import("@maxmind/geoip2-node");
    reader = await Reader.open(path);
  } catch (err) {
    console.warn(`[geo] MaxMind DB not available at ${path}:`, err);
    reader = null;
  }
  return reader;
}

export type GeoLookup = {
  country?: string;
  region?: string;
  continent?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
};

export async function lookupIp(ip: string | null | undefined): Promise<GeoLookup> {
  if (!ip || ip === "127.0.0.1" || ip === "::1") return LOCALHOST_GEO_DATA;
  const r = await getReader();
  if (!r) return LOCALHOST_GEO_DATA;
  try {
    const res = r.city(ip);
    return {
      country: res.country?.isoCode,
      region: res.subdivisions?.[0]?.isoCode,
      continent: res.continent?.code,
      city: res.city?.names?.en,
      latitude: res.location?.latitude?.toString(),
      longitude: res.location?.longitude?.toString(),
    };
  } catch {
    return LOCALHOST_GEO_DATA;
  }
}

export function extractIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
