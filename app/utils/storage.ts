// Browser storage layer that replaces the Nitro server's filesystem-backed
// `server/utils/cache.ts` + session/collection JSON writes. Uses IndexedDB
// via `idb-keyval` for both the persistent app data (collection, sessions)
// and the external-API cache (EDHREC, Scryfall).
//
// Why IndexedDB over localStorage:
// - Quota: localStorage is capped at ~5 MB per origin; IndexedDB gets a
//   percentage of disk (typically hundreds of MB). A hydrated EDHREC cache
//   can easily exceed 5 MB.
// - Async API: IndexedDB doesn't block the main thread on large writes.
// - Structured cloning: objects stored natively, no JSON.stringify round trip.

import {
  createStore,
  del as idbDel,
  get as idbGet,
  keys as idbKeys,
  set as idbSet,
  type UseStore,
} from "idb-keyval";

// Each namespace gets its own object store inside a shared `bulkbrew`
// database. Keeps unrelated data partitioned (iterating one cache namespace
// doesn't walk sessions, and clearing EDHREC doesn't nuke the collection).
const DB_NAME = "bulkbrew";

const stores: Record<string, UseStore> = {};
function storeFor(namespace: string): UseStore {
  let s = stores[namespace];
  if (!s) {
    s = createStore(DB_NAME, namespace);
    stores[namespace] = s;
  }
  return s;
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
    const rec = await idbGet<CacheRecord<T>>(key, storeFor(namespace));
    if (!rec) return null;
    if (Date.now() - rec.writtenAt > maxAgeMs) return null;
    return rec.value;
  } catch {
    return null;
  }
}

export async function writeCache<T>(namespace: string, key: string, value: T): Promise<void> {
  const rec: CacheRecord<T> = { value, writtenAt: Date.now() };
  await idbSet(key, rec, storeFor(namespace));
  void maybeSweep();
}

// Opportunistic sweep mirrors the server util: expire anything older than
// 30 days, rate-limited to once an hour via a localStorage marker so we don't
// walk IndexedDB on every write.
const HARD_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SWEEP_MARKER = "bulkbrew.cache.lastSweep";
const SWEEP_NAMESPACES: readonly string[] = ["edhrec", "scryfall-card", "scryfall-name"];

async function maybeSweep(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const now = Date.now();
  const last = Number(localStorage.getItem(SWEEP_MARKER) ?? 0);
  if (now - last < SWEEP_INTERVAL_MS) return;
  localStorage.setItem(SWEEP_MARKER, String(now));
  try {
    await Promise.all(SWEEP_NAMESPACES.map((ns) => sweepNamespace(ns)));
  } catch {
    // Cache maintenance must never break a write.
  }
}

async function sweepNamespace(namespace: string): Promise<void> {
  const store = storeFor(namespace);
  const all = (await idbKeys(store)) as IDBValidKey[];
  const cutoff = Date.now() - HARD_EXPIRY_MS;
  await Promise.all(
    all.map(async (key) => {
      try {
        const rec = await idbGet<CacheRecord<unknown>>(key, store);
        if (!rec) return;
        if (rec.writtenAt < cutoff) await idbDel(key, store);
      } catch {
        // entry may have vanished from a concurrent sweep
      }
    }),
  );
}

// Single-key helpers for the collection / sessions stores (no TTL).
export async function loadDoc<T>(namespace: string, key: string): Promise<T | null> {
  try {
    return (await idbGet<T>(key, storeFor(namespace))) ?? null;
  } catch {
    return null;
  }
}

export async function saveDoc<T>(namespace: string, key: string, value: T): Promise<void> {
  await idbSet(key, value, storeFor(namespace));
}

export async function deleteDoc(namespace: string, key: string): Promise<void> {
  await idbDel(key, storeFor(namespace));
}
