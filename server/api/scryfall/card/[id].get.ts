const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

export default defineEventHandler(async (event): Promise<unknown> => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, message: "Missing id" });

  const cached: unknown = await readCache<unknown>("scryfall-card", id, ONE_WEEK);
  if (cached) return cached;

  const url = `https://api.scryfall.com/cards/${id}`;
  const data: unknown = await $fetch<unknown>(url, {
    headers: externalFetchHeaders(),
    retry: 1,
    retryDelay: 300,
  });
  await writeCache("scryfall-card", id, data);
  return data;
});
