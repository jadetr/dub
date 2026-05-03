// Stub for `@maxmind/geoip2-node`. Tests override via the cityMock spy
// exported below.

export const cityMock = (globalThis as any).__maxmindCityMock ?? (() => {
  throw new Error("cityMock not configured");
});

export const Reader = {
  async open<_T>(_path: string): Promise<{ city: typeof cityMock }> {
    return {
      city: (ip: string) => (globalThis as any).__maxmindCityMock(ip),
    } as any;
  },
};

export type CityResponse = unknown;
