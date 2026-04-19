// Shared HTTP helpers for the direct-from-browser Scryfall / EDHREC
// clients. Both services are public CORS-enabled JSON endpoints and share
// the same retry/throttle needs, so the logic lives in one place.

// Cap Retry-After at 30 s so a misbehaving upstream can't stall the UI
// indefinitely — e.g. a server returning "Retry-After: 3600" (an hour)
// during a rate-limit incident. Users can retry manually after 30 s if
// the issue persists.
const MAX_RETRY_WAIT_SEC = 30;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps $fetch so that a 429 response with a Retry-After header waits the
// requested delay (bounded) and retries ONCE. All other errors bubble to
// the caller unchanged.
export async function fetchWithRetry<T>(url: string, opts?: Record<string, unknown>): Promise<T> {
  try {
    return await $fetch<T>(url, opts);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const retryAfter = (err as { response?: { headers?: Headers } })?.response?.headers?.get?.(
      "retry-after",
    );
    if (status === 429 && retryAfter) {
      const wait = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_WAIT_SEC) {
        await sleep(wait * 1000);
        return await $fetch<T>(url, opts);
      }
    }
    throw err;
  }
}
