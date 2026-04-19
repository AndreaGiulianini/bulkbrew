// Direct browser client for EDHREC. Mirrors the removed server endpoints
// `/api/edhrec/commander/[slug]` and `/api/edhrec/ranks`. `json.edhrec.com`
// sends `Access-Control-Allow-Origin: *` on GETs (verified), so we can call
// it from the browser without a proxy as long as we don't send custom
// headers that'd trigger a preflight.

import { runWithConcurrency } from "~/utils/concurrency";
import { fetchWithRetry } from "~/utils/http";
import { readCache, writeCache } from "~/utils/storage";
import type { EdhrecPage } from "~~/shared/types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RANKS_CONCURRENCY = 4;

export async function getCommanderPage(slug: string): Promise<EdhrecPage | null> {
  const cached = await readCache<EdhrecPage>("edhrec", slug, ONE_DAY_MS);
  if (cached) return cached;
  try {
    const data = await fetchWithRetry<EdhrecPage>(
      `https://json.edhrec.com/pages/commanders/${slug}.json`,
      { retry: 1, retryDelay: 500 },
    );
    await writeCache("edhrec", slug, data);
    return data;
  } catch {
    return null;
  }
}

export async function resolveCommanderRanks(
  slugs: string[],
): Promise<Record<string, number | null>> {
  const unique = Array.from(new Set(slugs.filter((s) => typeof s === "string" && s)));
  if (!unique.length) return {};
  const ranks = await runWithConcurrency(unique, RANKS_CONCURRENCY, async (slug) => {
    const page = await getCommanderPage(slug);
    return page?.container?.json_dict?.card?.rank ?? null;
  });
  const out: Record<string, number | null> = {};
  for (let i = 0; i < unique.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: parallel arrays
    out[unique[i]!] = ranks[i] ?? null;
  }
  return out;
}
