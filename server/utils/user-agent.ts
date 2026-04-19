// Identify our app to external APIs. Scryfall's guidelines explicitly require
// a User-Agent that names the app and a contact; EDHREC doesn't require one
// but it's polite and helps them distinguish traffic.
// The concrete string is read at runtime from env so deployments can override
// the contact URL/email without a code change.
export function apiUserAgent(): string {
  const ua = process.env.BULKBREW_USER_AGENT;
  if (ua) return ua;
  return "BulkBrew/1.0 (https://github.com/andreagiulianini/bulkbrew)";
}

export function externalFetchHeaders(): Record<string, string> {
  return {
    "User-Agent": apiUserAgent(),
    Accept: "application/json",
  };
}
