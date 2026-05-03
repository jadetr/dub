import { DubApiError } from "../api/errors";

export const verifyVercelSignature = async (req: Request) => {
  // skip verification in local development (no Vercel and not self-hosted)
  if (process.env.VERCEL !== "1" && process.env.SELF_HOSTED !== "1") {
    return;
  }

  const authHeader = req.headers.get("authorization");

  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    throw new DubApiError({
      code: "unauthorized",
      message: "Invalid Vercel cron request signature",
    });
  }
};
