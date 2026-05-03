// Caddy on-demand TLS hook. Caddy issues a cert for a hostname only if this
// endpoint returns 200. We answer 200 iff the host has been registered as a
// custom domain in the database.

import { prisma } from "@dub/prisma";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return new Response("missing domain", { status: 400 });

  const allowed =
    domain === process.env.NEXT_PUBLIC_APP_DOMAIN ||
    domain === process.env.NEXT_PUBLIC_APP_SHORT_DOMAIN ||
    (await prisma.domain.findUnique({ where: { slug: domain }, select: { id: true } }));

  if (!allowed) return new Response("not allowed", { status: 404 });
  return new Response("ok", { status: 200 });
}
