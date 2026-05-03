import { getApexDomain, getDomainWithoutWWW } from "@dub/utils";
import { features } from "@/lib/self-hosted";
import { getVercelDomainResponse } from "./get-domain-response";
import { CustomResponse } from "./utils";

export const addDomainToVercel = async (
  domain: string,
  {
    redirectToApex,
  }: {
    redirectToApex?: boolean;
  } = {},
): Promise<CustomResponse> => {
  domain = domain.toLowerCase();

  // Self-hosted: TLS is managed by Caddy on-demand, DNS is managed by the
  // operator. Treat the domain as immediately verified.
  if (!features.vercelDomains) {
    return { name: domain, verified: true } as unknown as CustomResponse;
  }

  const apexDomain = getApexDomain(`https://${domain}`);
  if (apexDomain !== domain) {
    const wildcardDomain = `*.${apexDomain}`;
    const wildcardResponse = await getVercelDomainResponse(wildcardDomain);
    if (wildcardResponse.verified) {
      return wildcardResponse;
    }
  }
  return await fetch(
    `https://api.vercel.com/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains?teamId=${process.env.TEAM_ID_VERCEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: domain,
        ...(redirectToApex && {
          redirect: getDomainWithoutWWW(domain),
        }),
      }),
    },
  ).then((res) => res.json());
};
