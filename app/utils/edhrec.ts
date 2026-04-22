// Direct browser client for EDHREC. Mirrors the removed server endpoints
// `/api/edhrec/commander/[slug]` and `/api/edhrec/ranks`. `json.edhrec.com`
// sends `Access-Control-Allow-Origin: *` on GETs (verified), so we can call
// it from the browser without a proxy as long as we don't send custom
// headers that'd trigger a preflight.

import { runWithConcurrency } from "~/utils/concurrency";
import { fetchWithRetry } from "~/utils/http";
import { readCache, writeCache } from "~/utils/storage";
import type { EdhrecPage, TopCommander } from "~~/shared/types";

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

// EDHREC's top-list endpoints. Each returns ~100 commanders by inclusion
// over the given window, in `container.json_dict.cardlists[0].cardviews`.
// Per-entry shape only carries name/sanitized/id/inclusion/rank — no
// color_identity, no image_uris (CardImage builds the CDN URL from
// scryfallId so the missing image_uris is fine).
type TopListEntry = {
  id?: string;
  name?: string;
  sanitized?: string;
  inclusion?: number;
  num_decks?: number;
  rank?: number;
};

type TopListPage = {
  container?: {
    json_dict?: {
      cardlists?: Array<{ cardviews?: TopListEntry[] }>;
    };
  };
};

async function fetchTopWindow(window: "year" | "month"): Promise<TopCommander[]> {
  const cached = await readCache<TopCommander[]>("edhrec-top", window, ONE_DAY_MS);
  if (cached) return cached;
  try {
    const data = await fetchWithRetry<TopListPage>(
      `https://json.edhrec.com/pages/commanders/${window}.json`,
      { retry: 1, retryDelay: 500 },
    );
    const out: TopCommander[] = [];
    for (const list of data.container?.json_dict?.cardlists ?? []) {
      for (const cv of list.cardviews ?? []) {
        if (!cv.name || !cv.sanitized || !cv.id) continue;
        out.push({
          name: cv.name,
          slug: cv.sanitized,
          scryfallId: cv.id,
          colorIdentity: [],
          inclusion: cv.inclusion ?? cv.num_decks ?? 0,
          rank: cv.rank ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
    await writeCache("edhrec-top", window, out);
    return out;
  } catch {
    return [];
  }
}

// Pre-fetched list of popular commanders, sourced from EDHREC's
// past-year + past-month top lists and deduped by canonical slug. Used
// by /explore as the search/typeahead pool. Cached per window for 1 day.
//
// Limited to ~150-300 commanders by EDHREC's API shape — for less popular
// commanders the page falls back to a free-text "try this name anyway"
// path that resolves the slug directly against EDHREC.
export async function getTopCommanders(): Promise<TopCommander[]> {
  const [year, month] = await Promise.all([fetchTopWindow("year"), fetchTopWindow("month")]);
  const bySlug = new Map<string, TopCommander>();
  for (const c of [...year, ...month]) {
    const existing = bySlug.get(c.slug);
    if (!existing || c.rank < existing.rank) bySlug.set(c.slug, c);
  }
  return Array.from(bySlug.values()).sort((a, b) => a.rank - b.rank);
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
