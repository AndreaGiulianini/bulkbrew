// Run an async worker over `items` with at most `limit` in flight. Preserves
// input order in the result array. Lifted from the old EDHREC ranks server
// route so the client batcher can reuse the same shape.
export async function runWithConcurrency<T, R>(
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
