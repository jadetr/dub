// Single source of truth for which optional integrations are enabled.
// Each key is true iff its required env var(s) are present at runtime.
//
// Use as: `if (!features.stripe) return;` to no-op self-hosted code paths
// without polluting business logic with env checks.

const has = (v: string | undefined) => typeof v === "string" && v.length > 0;

export const SELF_HOSTED = process.env.SELF_HOSTED === "1";

export const features = {
  // Core (always on when configured)
  email: has(process.env.RESEND_API_KEY) || has(process.env.SMTP_HOST),
  storage: has(process.env.STORAGE_ACCESS_KEY_ID),

  // OAuth providers
  googleAuth: has(process.env.GOOGLE_CLIENT_ID) && has(process.env.GOOGLE_CLIENT_SECRET),
  githubAuth: has(process.env.GITHUB_CLIENT_ID) && has(process.env.GITHUB_CLIENT_SECRET),
  saml: has(process.env.SAML_DATABASE_URL) || has(process.env.JACKSON_API_KEY),

  // Payments
  stripe: has(process.env.STRIPE_SECRET_KEY),
  stripeConnect: has(process.env.STRIPE_CONNECT_WEBHOOK_SECRET),
  paypal: has(process.env.PAYPAL_CLIENT_ID) && has(process.env.PAYPAL_CLIENT_SECRET),

  // Integrations / 3rd party
  shopify: has(process.env.SHOPIFY_WEBHOOK_SECRET),
  hubspot: has(process.env.HUBSPOT_CLIENT_ID),
  slack: has(process.env.SLACK_CLIENT_ID),
  bitlyImporter: has(process.env.BITLY_CLIENT_ID),
  unsplash: has(process.env.UNSPLASH_ACCESS_KEY),
  firecrawl: has(process.env.FIRECRAWL_API_KEY),
  scrapeCreators: has(process.env.SCRAPECREATORS_API_KEY),
  twitter: has(process.env.TWITTER_CLIENT_ID),
  tiktok: has(process.env.TIKTOK_CLIENT_ID),
  youtube: has(process.env.YOUTUBE_API_KEY),
  veriff: has(process.env.VERIFF_API_KEY),
  dynadot: has(process.env.DYNADOT_API_KEY),

  // AI / Support
  anthropic: has(process.env.ANTHROPIC_API_KEY),
  plain: has(process.env.PLAIN_API_KEY),
  upstashVector: has(process.env.UPSTASH_VECTOR_REST_URL),

  // Vercel-only
  vercelDomains: !SELF_HOSTED && has(process.env.VERCEL_API_KEY),
  edgeConfig: !SELF_HOSTED && has(process.env.EDGE_CONFIG),

  // Observability
  axiom: has(process.env.AXIOM_TOKEN),
} as const;

export type Feature = keyof typeof features;

export const requireFeature = (f: Feature) => {
  if (!features[f]) {
    throw new Error(
      `Feature "${f}" is disabled in this self-hosted Dub deployment.` +
        ` Set the corresponding env vars (see docs/self-hosting.md) to enable it.`,
    );
  }
};
