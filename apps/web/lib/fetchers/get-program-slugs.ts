import { prisma } from "@dub/prisma";
import { cache } from "react";

// Used by generateStaticParams during `next build`. Without DATABASE_URL set
// (eg self-hosted docker builds), prisma throws and the build aborts even
// though the page can be served dynamically at runtime. Swallow the error
// and return [] so the build can complete; pages are rendered on-demand.
export const getProgramSlugs = cache(async () => {
  try {
    return await prisma.program.findMany({
      select: {
        slug: true,
      },
      orderBy: {
        applications: {
          _count: "desc",
        },
      },
      take: 250,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production" || process.env.SELF_HOSTED) {
      // eslint-disable-next-line no-console
      console.warn(
        "[getProgramSlugs] DB unavailable, returning [] (pages will render dynamically):",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
    throw err;
  }
});
