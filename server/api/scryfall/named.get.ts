const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

// getQuery() returns Record<string, any>; repeated ?name=a&name=b gives an
// array, so we pick the first entry and coerce defensively.
function firstString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0].trim() || null;
  return null;
}

export default defineEventHandler(async (event): Promise<unknown> => {
  const name = firstString(getQuery(event).name);
  if (!name) throw createError({ statusCode: 400, message: "Missing name" });

  const key = name.toLowerCase();
  const cached: unknown = await readCache<unknown>("scryfall-named", key, ONE_WEEK);
  if (cached) return cached;

  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
  const headers = externalFetchHeaders();
  try {
    const data: unknown = await $fetch<unknown>(url, { headers, retry: 1, retryDelay: 300 });
    await writeCache("scryfall-named", key, data);
    return data;
  } catch {
    const fuzzy = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
    const data: unknown = await $fetch<unknown>(fuzzy, { headers, retry: 1, retryDelay: 300 });
    await writeCache("scryfall-named", key, data);
    return data;
  }
});
