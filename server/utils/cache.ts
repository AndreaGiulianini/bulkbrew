import { promises as fs } from "node:fs";
import path from "node:path";
import { useRuntimeConfig } from "#imports";

// Oldest age beyond which any cached file is a prune candidate, regardless of
// namespace. Individual callers may reject younger files via their own
// per-call maxAgeMs when reading.
const HARD_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// How often to sweep the cache directory. Sweeping happens opportunistically
// from writeCache(), not on a timer, so servers that never write also never
// sweep (acceptable — nothing is being added either).
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let lastSweepAt = 0;

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function safeKey(key: string): string {
  // Reject anything that could escape the cache namespace via "." segments.
  // EDHREC slugs and Scryfall UUIDs only need [a-zA-Z0-9._-]; anything else
  // gets collapsed to "_". A leading dot is stripped so "..<etc>" can't form.
  const sanitised = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return sanitised.replace(/^\.+/, "_");
}

export async function readCache<T>(
  namespace: string,
  key: string,
  maxAgeMs: number,
): Promise<T | null> {
  const { cacheDir } = useRuntimeConfig();
  const dir = path.join(cacheDir, namespace);
  const file = path.join(dir, `${safeKey(key)}.json`);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(namespace: string, key: string, value: T): Promise<void> {
  const { cacheDir } = useRuntimeConfig();
  const dir = path.join(cacheDir, namespace);
  await ensureDir(dir);
  const file = path.join(dir, `${safeKey(key)}.json`);
  await fs.writeFile(file, JSON.stringify(value), "utf8");
  // Opportunistic sweep — we write frequently, so once an hour we walk the
  // cache dir and drop files older than HARD_EXPIRY_MS. Fire-and-forget.
  void maybeSweep(cacheDir);
}

async function maybeSweep(cacheDir: string): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  try {
    await sweepOlderThan(cacheDir, HARD_EXPIRY_MS);
  } catch {
    // Never let cache maintenance break a write.
  }
}

async function sweepOlderThan(root: string, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  let namespaces: string[];
  try {
    namespaces = await fs.readdir(root);
  } catch {
    return;
  }
  await Promise.all(
    namespaces.map(async (ns) => {
      const dir = path.join(root, ns);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }
      await Promise.all(
        entries.map(async (name) => {
          const file = path.join(dir, name);
          try {
            const stat = await fs.stat(file);
            if (stat.isFile() && stat.mtimeMs < cutoff) await fs.unlink(file);
          } catch {
            // ignore; file may have been removed by a concurrent sweep
          }
        }),
      );
    }),
  );
}
