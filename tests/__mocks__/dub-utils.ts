// Lightweight stand-in for `@dub/utils` so vite can resolve it without
// pulling the whole package's index. Tests that need different values
// override via `vi.mock()`.

export const LOCALHOST_GEO_DATA = {
  country: "US",
  region: "CA",
  city: "San Francisco",
  latitude: "37.7695",
  longitude: "-122.385",
  continent: "NA",
};

export const LOCALHOST_IP = "63.141.57.109";

export const APP_DOMAIN_WITH_NGROK = "http://localhost:8888";

export const log = async (..._args: unknown[]) => {};

export const fetchWithRetry = async (..._args: unknown[]) => ({
  json: async () => ({}),
});

export const capitalize = (s: string) =>
  s ? s[0].toUpperCase() + s.slice(1) : s;

export const getDomainWithoutWWW = (s: string) => s?.replace(/^www\./, "");
