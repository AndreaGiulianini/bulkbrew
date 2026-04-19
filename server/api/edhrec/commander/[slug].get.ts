const ONE_DAY = 24 * 60 * 60 * 1000;

export default defineEventHandler(async (event): Promise<unknown> => {
  const slug = getRouterParam(event, "slug");
  if (!slug) throw createError({ statusCode: 400, message: "Missing slug" });

  const cached: unknown = await readCache<unknown>("edhrec", slug, ONE_DAY);
  if (cached) return cached;

  const url = `https://json.edhrec.com/pages/commanders/${slug}.json`;
  try {
    const data: unknown = await $fetch<unknown>(url, {
      headers: externalFetchHeaders(),
      retry: 1,
      retryDelay: 500,
    });
    await writeCache("edhrec", slug, data);
    return data;
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    throw createError({
      statusCode: e.statusCode ?? 502,
      message: `EDHREC fetch failed for ${slug}: ${e.message ?? "unknown"}`,
    });
  }
});
