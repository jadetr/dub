import { PlainClient } from "@team-plain/typescript-sdk";

// Constructing PlainClient eagerly fails at module-load when PLAIN_API_KEY
// is unset (eg self-hosted builds, where Plain support tickets aren't wired
// up). Defer construction so importing this module doesn't crash; throw
// only when a method is actually called without the key.
function makePlain(): PlainClient {
  if (!process.env.PLAIN_API_KEY) {
    return new Proxy({} as PlainClient, {
      get() {
        throw new Error(
          "PLAIN_API_KEY is not set; @team-plain SDK is unavailable.",
        );
      },
    });
  }
  return new PlainClient({ apiKey: process.env.PLAIN_API_KEY });
}

export const plain = makePlain();

export type PlainUser = {
  id: string;
  name: string | null;
  email: string | null;
};
