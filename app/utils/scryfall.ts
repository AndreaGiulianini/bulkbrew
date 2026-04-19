// Direct browser client for Scryfall. Mirrors the removed
// `server/api/scryfall/*` endpoints but runs against the user's browser
// cache (IndexedDB) instead of a disk cache. Scryfall's public API is
// CORS-enabled (verified) so no proxy is needed.

import { fetchWithRetry, sleep } from "~/utils/http";
import { readCache, writeCacheMany } from "~/utils/storage";
import type { ScryfallCard } from "~~/shared/types";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 75; // Scryfall's limit for /cards/collection identifiers
// Scryfall's guidelines ask for 50–100 ms between requests, but every POST
// here triggers a CORS preflight (application/json body), so 1 batch = 2
// network requests. 250 ms keeps us under 4 req/sec including preflights,
// which is well below Scryfall's observed ~10 req/sec throttle and leaves
// headroom for users on shared IPs (VPN / office NAT).
const BATCH_COOLDOWN_MS = 250;
// Stop issuing new Scryfall batches after this many back-to-back network
// failures. Scryfall's 429 responses don't include CORS headers, which
// means the browser refuses us the response entirely and our retry logic
// can't read Retry-After. Rather than hammer the API while throttled, bail
// out of the remaining batches and let the caller surface the gap.
const FAILURE_CIRCUIT_BREAK = 2;

// Scryfall's /cards/collection endpoint accepts any of these identifier
// shapes per entry; we use `id` for collection enrichment, `name` for
// plain-text deck list imports, and `{set, collector_number}` for
// Moxfield exports which carry neither a Scryfall ID nor just a name.
export interface ScryfallIdentifier {
  id?: string;
  name?: string;
  set?: string;
  collector_number?: string;
}

export async function getCardById(id: string): Promise<ScryfallCard | null> {
  const cached = await readCache<ScryfallCard>("scryfall-card", `id:${id}`, ONE_WEEK_MS);
  if (cached) return cached;
  try {
    const data = await fetchWithRetry<ScryfallCard>(`https://api.scryfall.com/cards/${id}`, {
      retry: 1,
      retryDelay: 300,
    });
    const writes: Array<{ namespace: string; key: string; value: ScryfallCard }> = [
      { namespace: "scryfall-card", key: `id:${id}`, value: data },
    ];
    if (data.name) {
      writes.push({
        namespace: "scryfall-name",
        key: `name:${data.name.toLowerCase()}`,
        value: data,
      });
    }
    await writeCacheMany(writes);
    return data;
  } catch {
    return null;
  }
}

export async function getCardByName(
  name: string,
  opts: { fuzzy?: boolean } = {},
): Promise<ScryfallCard | null> {
  const key = `name:${name.toLowerCase()}`;
  const cached = await readCache<ScryfallCard>("scryfall-name", key, ONE_WEEK_MS);
  if (cached) return cached;
  const encoded = encodeURIComponent(name);
  const urls = opts.fuzzy
    ? [`https://api.scryfall.com/cards/named?fuzzy=${encoded}`]
    : [
        `https://api.scryfall.com/cards/named?exact=${encoded}`,
        `https://api.scryfall.com/cards/named?fuzzy=${encoded}`,
      ];
  for (const url of urls) {
    try {
      const data = await fetchWithRetry<ScryfallCard>(url, { retry: 1, retryDelay: 300 });
      const writes: Array<{ namespace: string; key: string; value: ScryfallCard }> = [
        { namespace: "scryfall-name", key, value: data },
      ];
      if (data.id) {
        writes.push({ namespace: "scryfall-card", key: `id:${data.id}`, value: data });
      }
      await writeCacheMany(writes);
      return data;
    } catch {
      // try the next URL (exact → fuzzy fallback)
    }
  }
  return null;
}

// Batched lookup mirroring the old `/api/scryfall/collection` POST.
// Cache-first; only un-cached identifiers hit Scryfall. Writes each result
// under both `id:` and `name:` keys so future lookups hit regardless of which
// identifier type they use.
export async function resolveIdentifiers(
  identifiers: ScryfallIdentifier[],
): Promise<{ data: ScryfallCard[]; notFound: ScryfallIdentifier[] }> {
  const results: ScryfallCard[] = [];
  const notFound: ScryfallIdentifier[] = [];
  const toFetch: ScryfallIdentifier[] = [];

  for (const ident of identifiers) {
    const cached = ident.id
      ? await readCache<ScryfallCard>("scryfall-card", `id:${ident.id}`, ONE_WEEK_MS)
      : ident.name
        ? await readCache<ScryfallCard>(
            "scryfall-name",
            `name:${ident.name.toLowerCase()}`,
            ONE_WEEK_MS,
          )
        : null;
    if (cached) {
      results.push(cached);
      continue;
    }
    // Accept any identifier shape Scryfall supports: {id}, {name}, or
    // {set, collector_number}. The last one is used by the Moxfield
    // importer and has no cache key, so it always falls through to fetch.
    if (ident.id || ident.name || (ident.set && ident.collector_number)) {
      toFetch.push(ident);
    }
  }

  let consecutiveFailures = 0;
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    if (consecutiveFailures >= FAILURE_CIRCUIT_BREAK) {
      // We're almost certainly being rate-limited; bail on the remaining
      // batches and let the caller report the gap via `notFound`.
      notFound.push(...batch);
      continue;
    }
    if (i > 0) await sleep(BATCH_COOLDOWN_MS);
    try {
      const resp = await fetchWithRetry<{
        data: ScryfallCard[];
        not_found?: ScryfallIdentifier[];
      }>("https://api.scryfall.com/cards/collection", {
        method: "POST",
        body: { identifiers: batch },
        headers: { "Content-Type": "application/json" },
        retry: 1,
        retryDelay: 300,
      });
      consecutiveFailures = 0;
      const writes: Array<{ namespace: string; key: string; value: ScryfallCard }> = [];
      for (const card of resp.data) {
        if (card.id) writes.push({ namespace: "scryfall-card", key: `id:${card.id}`, value: card });
        if (card.name) {
          writes.push({
            namespace: "scryfall-name",
            key: `name:${card.name.toLowerCase()}`,
            value: card,
          });
        }
        results.push(card);
      }
      await writeCacheMany(writes);
      if (resp.not_found?.length) notFound.push(...resp.not_found);
    } catch {
      consecutiveFailures += 1;
      notFound.push(...batch);
      // A cool-down period longer than the normal batch gap gives the
      // rate-limit window time to slide if we're only briefly throttled.
      await sleep(1000);
    }
  }

  return { data: results, notFound };
}
