import { log } from "@dub/utils";
import { Receiver } from "@upstash/qstash";
import { DubApiError } from "../api/errors";

// we're using Upstash's Receiver to verify the request signature
const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
});

export const verifyQstashSignature = async ({
  req,
  rawBody,
}: {
  req: Request;
  rawBody: string; // Make sure to pass the raw body not the parsed JSON
}) => {
  // skip verification in local development
  if (process.env.VERCEL !== "1") {
    return;
  }

  // Self-hosted: the BullMQ worker signs requests with CRON_SECRET as a
  // bearer instead of QStash signatures.
  if (process.env.SELF_HOSTED === "1") {
    const auth = req.headers.get("authorization");
    const ok = auth === `Bearer ${process.env.CRON_SECRET}`;
    if (!ok) {
      throw new DubApiError({
        code: "unauthorized",
        message: "Missing or invalid CRON_SECRET bearer.",
      });
    }
    return;
  }

  const signature = req.headers.get("Upstash-Signature");

  if (!signature) {
    throw new DubApiError({
      code: "bad_request",
      message: "Upstash-Signature header not found.",
    });
  }

  const isValid = await receiver.verify({
    signature,
    body: rawBody,
  });

  if (!isValid) {
    const url = req.url;
    const messageId = req.headers.get("Upstash-Message-Id");

    log({
      message: `Invalid QStash request signature: *${url}* - *${messageId}*`,
      type: "errors",
      mention: true,
    });

    throw new DubApiError({
      code: "unauthorized",
      message: "Invalid QStash request signature.",
    });
  }
};
