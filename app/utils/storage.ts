// Browser storage layer that replaces the Nitro server's filesystem-backed
// `server/utils/cache.ts` + session/collection JSON writes. Uses IndexedDB
// for both the persistent app data (collection, sessions) and the
// external-API cache (EDHREC, Scryfall).
//
// One object store (`kv`), namespace-prefixed keys (`scryfall-card:id:…`,
// `collection:v1`, `sessions:<id>`, …). Avoids the multi-store pitfall
// where adding a store after initial DB creation silently no-ops and
// subsequent transactions throw NotFoundError.
//
// Versioned on purpose so we can evolve the schema: v2 cleans up legacy
// per-namespace stores left over from the first (broken) layout.

const DB_NAME = "bulkbrew";
const DB_VERSION = 2;
const STORE = "kv";
const LEGACY_STORES = [
  "scryfall-card",
  "scryfall-name",
  "edhrec",
  "collection",
  "sessions",
] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      for (const name of LEGACY_STORES) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return promisify(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await promisify(db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key));
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  await promisify(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
}

async function idbKeys(): Promise<string[]> {
  const db = await openDb();
  const keys = await promisify(db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys());
  return keys.map(String);
}

// Bulk write: one `readwrite` transaction for every entry. The network layer
// writes two keys per Scryfall card (id + name); issuing a separate
// transaction for each is wasteful. Caller passes `[key, value][]`.
async function idbSetMany(entries: Array<[string, unknown]>): Promise<void> {
  if (!entries.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [k, v] of entries) store.put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function nsKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

// IndexedDB's structured-clone rejects Vue/Pinia reactive Proxies. Prefer
// the structured-clone algorithm (preserves Dates, Maps, Sets); fall back
// to JSON for inputs it chokes on (reactive proxies, class instances).
function toPlain<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

interface CacheRecord<T> {
  value: T;
  writtenAt: number;
}

export async function readCache<T>(
  namespace: string,
  key: string,
  maxAgeMs: number,
): Promise<T | null> {
  try {
    const rec = await idbGet<CacheRecord<T>>(nsKey(namespace, key));
    if (!rec) return null;
    if (Date.now() - rec.writtenAt > maxAgeMs) return null;
    return rec.value;
  } catch {
    return null;
  }
}

export async function writeCache<T>(namespace: string, key: string, value: T): Promise<void> {
  const rec: CacheRecord<T> = { value: toPlain(value), writtenAt: Date.now() };
  await idbSet(nsKey(namespace, key), rec);
  void maybeSweep();
}

// Multiple cache entries in one IDB transaction. Each entry is wrapped as a
// CacheRecord (so future reads respect TTL) and written under its
// namespaced key.
export async function writeCacheMany<T>(
  entries: Array<{ namespace: string; key: string; value: T }>,
): Promise<void> {
  if (!entries.length) return;
  const now = Date.now();
  const serialized: Array<[string, CacheRecord<T>]> = entries.map(({ namespace, key, value }) => [
    nsKey(namespace, key),
    { value: toPlain(value), writtenAt: now },
  ]);
  await idbSetMany(serialized);
  void maybeSweep();
}

// Opportunistic sweep mirrors the server util: expire anything older than
// 30 days, rate-limited to once an hour via a localStorage marker so we don't
// walk IndexedDB on every write. Bounded to SWEEP_BUDGET keys per run so
// the sweep never stalls the UI on a huge cache (EDHREC pages can easily
// push a user's `kv` store past 10 000 entries after a month of use).
const HARD_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SWEEP_MARKER = "bulkbrew.cache.lastSweep";
const SWEEP_PREFIXES = ["edhrec:", "scryfall-card:", "scryfall-name:", "scryfall-commanders:"];
const SWEEP_BUDGET = 500;

async function maybeSweep(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const now = Date.now();
  const last = Number(localStorage.getItem(SWEEP_MARKER) ?? 0);
  if (now - last < SWEEP_INTERVAL_MS) return;
  localStorage.setItem(SWEEP_MARKER, String(now));
  try {
    const keys = await idbKeys();
    const cutoff = Date.now() - HARD_EXPIRY_MS;
    const candidates = keys
      .filter((k) => SWEEP_PREFIXES.some((p) => k.startsWith(p)))
      .slice(0, SWEEP_BUDGET);
    await Promise.all(
      candidates.map(async (key) => {
        try {
          const rec = await idbGet<CacheRecord<unknown>>(key);
          if (!rec) return;
          if (rec.writtenAt < cutoff) await idbDel(key);
        } catch {
          // entry may have vanished from a concurrent sweep
        }
      }),
    );
  } catch {
    // Cache maintenance must never break a write.
  }
}

// Single-key helpers for the collection / sessions data (no TTL).
export async function loadDoc<T>(namespace: string, key: string): Promise<T | null> {
  try {
    return (await idbGet<T>(nsKey(namespace, key))) ?? null;
  } catch {
    return null;
  }
}

export async function saveDoc<T>(namespace: string, key: string, value: T): Promise<void> {
  await idbSet(nsKey(namespace, key), toPlain(value));
}

export async function deleteDoc(namespace: string, key: string): Promise<void> {
  await idbDel(nsKey(namespace, key));
}
