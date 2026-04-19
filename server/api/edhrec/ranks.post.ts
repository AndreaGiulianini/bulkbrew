// Batch resolver for EDHREC commander ranks.
//
// EDHREC exposes no "all commanders with ranks" endpoint (index pages cap at
// 100), so we fan out one request per unique slug, bounded by a small concurrency
// limit and backed by the existing per-commander disk cache. The client posts
// every slug in the user's legendary list; on first visit we warm the cache,
// subsequent visits resolve instantly from disk.
//
// Returns { ranks: { [slug]: number | null } }. null for slugs EDHREC returned
// an error for or for which no rank was found in the payload.

const ONE_DAY = 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

interface CommanderPage {
  container?: {
    json_dict?: {
      card?: { rank?: number };
    };
  };
}

async function resolveSlug(slug: string): Promise<number | null> {
  const cached = await readCache<CommanderPage>("edhrec", slug, ONE_DAY);
  if (cached) return cached.container?.json_dict?.card?.rank ?? null;

  try {
    const data = await $fetch<CommanderPage>(
      `https://json.edhrec.com/pages/commanders/${slug}.json`,
      { headers: externalFetchHeaders(), retry: 1, retryDelay: 500 },
    );
    await writeCache("edhrec", slug, data);
    return data.container?.json_dict?.card?.rank ?? null;
  } catch {
    return null;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      // biome-ignore lint/style/noNonNullAssertion: i is bounded above
      results[i] = await worker(items[i]!);
    }
  });
  await Promise.all(runners);
  return results;
}

export default defineEventHandler(
  async (event): Promise<{ ranks: Record<string, number | null> }> => {
    const body = await readBody<{ slugs?: string[] }>(event);
    const slugs = Array.from(
      new Set((body?.slugs ?? []).filter((s) => typeof s === "string" && s)),
    );
    if (!slugs.length) return { ranks: {} };

    const ranks = await runWithConcurrency(slugs, CONCURRENCY, resolveSlug);
    const out: Record<string, number | null> = {};
    for (let i = 0; i < slugs.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: parallel arrays
      out[slugs[i]!] = ranks[i] ?? null;
    }
    return { ranks: out };
  },
);
