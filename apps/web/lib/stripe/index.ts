import Stripe from "stripe";
import { StripeMode } from "../types";

const STRIPE_APP_INFO = { name: "Dub.co", version: "0.1.0" } as const;
const STRIPE_API_VERSION = "2025-05-28.basil" as const;

// Constructing Stripe eagerly with an undefined secret key throws at module
// load. On self-hosted builds Stripe is optional, so defer construction and
// only error when a Stripe call is actually made without a key.
function makeStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    return new Proxy({} as Stripe, {
      get() {
        throw new Error(
          "STRIPE_SECRET_KEY is not set; Stripe integration is unavailable.",
        );
      },
    });
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: STRIPE_APP_INFO,
  });
}

export const stripe = makeStripe();

const secretMap: Record<StripeMode, string | undefined> = {
  live: process.env.STRIPE_APP_SECRET_KEY,
  test: process.env.STRIPE_APP_SECRET_KEY_TEST,
  sandbox: process.env.STRIPE_APP_SECRET_KEY_SANDBOX,
};

// Stripe Integration App client
export const stripeAppClient = ({ mode }: { mode?: StripeMode }) => {
  const appSecretKey = secretMap[mode ?? "live"];

  return new Stripe(appSecretKey!, {
    apiVersion: "2025-05-28.basil",
    appInfo: {
      name: "Dub.co",
      version: "0.1.0",
    },
  });
};
