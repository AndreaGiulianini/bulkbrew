// Direct browser client for EDHREC. Mirrors the removed server endpoints
// `/api/edhrec/commander/[slug]` and `/api/edhrec/ranks`. `json.edhrec.com`
// sends `Access-Control-Allow-Origin: *` on GETs (verified), so we can call
// it from the browser without a proxy as long as we don't send custom
// headers that'd trigger a preflight.

import { runWithConcurrency } from "~/utils/concurrency";
import { readCache, writeCache } from "~/utils/storage";
import type { EdhrecPage } from "~~/shared/types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RANKS_CONCURRENCY = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// One retry on 429 with Retry-After honored (bounded at 30 s so a
// misbehaving server can't stall the UI indefinitely).
async function fetchWithRetry<T>(url: string, opts?: Record<string, unknown>): Promise<T> {
  try {
    return await $fetch<T>(url, opts);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const retryAfter = (err as { response?: { headers?: Headers } })?.response?.headers?.get?.(
      "retry-after",
    );
    if (status === 429 && retryAfter) {
      const wait = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(wait) && wait >= 0 && wait <= 30) {
        await sleep(wait * 1000);
        return await $fetch<T>(url, opts);
      }
    }
    throw err;
  }
}

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
