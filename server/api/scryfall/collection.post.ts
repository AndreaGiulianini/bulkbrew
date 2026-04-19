const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

interface Identifier {
  id?: string;
  name?: string;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ identifiers: Identifier[] }>(event);
  if (!body?.identifiers?.length) return { data: [], not_found: [] };

  const results: unknown[] = [];
  const notFound: Identifier[] = [];
  const toFetch: Identifier[] = [];

  for (const ident of body.identifiers) {
    const key = ident.id
      ? `id:${ident.id}`
      : ident.name
        ? `name:${ident.name.toLowerCase()}`
        : null;
    if (!key) continue;
    const cached = await readCache<unknown>("scryfall-card", key, ONE_WEEK);
    if (cached) results.push(cached);
    else toFetch.push(ident);
  }

  for (let i = 0; i < toFetch.length; i += 75) {
    const batch = toFetch.slice(i, i + 75);
    try {
      const resp = await $fetch<{
        data: Array<{ id: string; name: string }>;
        not_found: Identifier[];
      }>("https://api.scryfall.com/cards/collection", {
        method: "POST",
        body: { identifiers: batch },
        headers: { ...externalFetchHeaders(), "Content-Type": "application/json" },
        retry: 1,
        retryDelay: 300,
      });
      for (const card of resp.data) {
        await writeCache("scryfall-card", `id:${card.id}`, card);
        await writeCache("scryfall-card", `name:${card.name.toLowerCase()}`, card);
        results.push(card);
      }
      if (resp.not_found?.length) notFound.push(...resp.not_found);
    } catch (_err) {
      notFound.push(...batch);
    }
  }

  return { data: results, not_found: notFound };
});
