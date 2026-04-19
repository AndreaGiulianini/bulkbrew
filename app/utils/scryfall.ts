// Direct browser client for Scryfall. Mirrors the removed
// `server/api/scryfall/*` endpoints but runs against the user's browser
// cache (IndexedDB) instead of a disk cache. Scryfall's public API is
// CORS-enabled (verified) so no proxy is needed.

import { readCache, writeCacheMany } from "~/utils/storage";
import type { ScryfallCard } from "~~/shared/types";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 75; // Scryfall's limit for /cards/collection identifiers
// Scryfall's guidelines ask for 50–100 ms between requests. 100 ms keeps us
// well clear of their throttle and, at BATCH_SIZE=75, lets a 1000-card
// collection resolve in under 2 seconds of inter-batch waits.
const BATCH_COOLDOWN_MS = 100;

export interface ScryfallIdentifier {
  id?: string;
  name?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Wraps $fetch so that a 429 with a Retry-After header waits the requested
// delay and retries once. Everything else bubbles to the caller.
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
    if (cached) results.push(cached);
    else if (ident.id || ident.name) toFetch.push(ident);
  }

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(BATCH_COOLDOWN_MS);
    const batch = toFetch.slice(i, i + BATCH_SIZE);
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
      notFound.push(...batch);
    }
  }

  return { data: results, notFound };
}
