// Direct browser client for Scryfall. Mirrors the removed
// `server/api/scryfall/*` endpoints but runs against the user's browser
// cache (IndexedDB) instead of a disk cache. Scryfall's public API is
// CORS-enabled (verified) so no proxy is needed.

import { readCache, writeCache } from "~/utils/storage";
import type { ScryfallCard } from "~~/shared/types";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 75; // Scryfall's limit for /cards/collection identifiers

export interface ScryfallIdentifier {
  id?: string;
  name?: string;
}

export async function getCardById(id: string): Promise<ScryfallCard | null> {
  const cached = await readCache<ScryfallCard>("scryfall-card", `id:${id}`, ONE_WEEK_MS);
  if (cached) return cached;
  try {
    const data = await $fetch<ScryfallCard>(`https://api.scryfall.com/cards/${id}`, {
      retry: 1,
      retryDelay: 300,
    });
    await writeCache("scryfall-card", `id:${id}`, data);
    if (data.name) {
      await writeCache("scryfall-name", `name:${data.name.toLowerCase()}`, data);
    }
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
      const data = await $fetch<ScryfallCard>(url, { retry: 1, retryDelay: 300 });
      await writeCache("scryfall-name", key, data);
      if (data.id) await writeCache("scryfall-card", `id:${data.id}`, data);
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
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    try {
      const resp = await $fetch<{
        data: ScryfallCard[];
        not_found?: ScryfallIdentifier[];
      }>("https://api.scryfall.com/cards/collection", {
        method: "POST",
        body: { identifiers: batch },
        headers: { "Content-Type": "application/json" },
        retry: 1,
        retryDelay: 300,
      });
      for (const card of resp.data) {
        if (card.id) await writeCache("scryfall-card", `id:${card.id}`, card);
        if (card.name) {
          await writeCache("scryfall-name", `name:${card.name.toLowerCase()}`, card);
        }
        results.push(card);
      }
      if (resp.not_found?.length) notFound.push(...resp.not_found);
    } catch {
      notFound.push(...batch);
    }
  }

  return { data: results, notFound };
}
