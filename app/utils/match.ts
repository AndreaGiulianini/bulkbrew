// "Best fit commander" scoring. Pure functions over EDHREC pages and a
// collection's name set — no network here. The /match page handles
// orchestration (fetch top-500, fetch each page, stream results into
// the UI); this module just turns one (commander page, name set) pair
// into a buildability score.

import type { CommanderMatchResult, EdhrecPage, TopCommander } from "~~/shared/types";

const BASIC_LAND_NAMES = new Set([
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
  "wastes",
  // Snow basics — common in budget collections, same "always available" issue
  "snow-covered plains",
  "snow-covered island",
  "snow-covered swamp",
  "snow-covered mountain",
  "snow-covered forest",
]);

// Target deck size minus the commander itself. The denominator for the
// buildability % is the inclusion sum of the top-N EDHREC recs.
const TARGET_DECK_SLOTS = 99;

// Flatten an EDHREC commander page's cardlists to a single deduped list
// of (name, inclusion) pairs sorted by inclusion descending. Same card
// can appear in multiple categories (e.g. gamechangers + topcards) — we
// keep the highest-inclusion occurrence.
function flattenRecs(page: EdhrecPage): Array<{ name: string; inclusion: number }> {
  const byName = new Map<string, number>();
  for (const list of page.container?.json_dict?.cardlists ?? []) {
    for (const cv of list.cardviews) {
      if (!cv.name) continue;
      const incl = cv.num_decks && cv.potential_decks ? cv.num_decks / cv.potential_decks : 0;
      const key = cv.name.toLowerCase();
      const existing = byName.get(key);
      if (existing === undefined || incl > existing) byName.set(key, incl);
    }
  }
  return Array.from(byName, ([name, inclusion]) => ({ name, inclusion })).sort(
    (a, b) => b.inclusion - a.inclusion,
  );
}

// Score a single commander against the user's collection. EDHREC pre-
// filters its rec pool by color identity, so we don't need to re-check
// — every card in the page is already legal for this commander. We do
// exclude basic lands explicitly: every collection has them, so they'd
// add a flat ~5–10 points to every commander and obscure real signal.
//
// `nameSet` is a Set of lowercased card names from the user's collection
// (matches the existing collection store getter shape).
//
// Returns null when the EDHREC page has no usable cardlists (rare — happens
// for very obscure commanders with thin data).
export function scoreCommander(
  commander: TopCommander,
  page: EdhrecPage,
  nameSet: Set<string>,
  isOwned: boolean,
): CommanderMatchResult | null {
  const recs = flattenRecs(page);
  if (!recs.length) return null;

  const top = recs.slice(0, TARGET_DECK_SLOTS).filter((r) => !BASIC_LAND_NAMES.has(r.name));
  if (!top.length) return null;

  const denominator = top.reduce((sum, r) => sum + r.inclusion, 0);
  if (denominator <= 0) return null;

  let numerator = 0;
  let ownedCount = 0;
  for (const r of top) {
    if (nameSet.has(r.name)) {
      numerator += r.inclusion;
      ownedCount += 1;
    }
  }

  const buildability = Math.min(100, (numerator / denominator) * 100);
  return {
    commander,
    buildability,
    ownedCount,
    topCount: top.length,
    owned: isOwned,
  };
}

// Collection fingerprint — used as a cache key for the ranked match
// result. We want two distinct collections to produce different keys
// while two snapshots of the same collection (modulo ordering) produce
// the same key. Sorted lowercase names + length, hashed via a simple
// non-cryptographic 32-bit FNV-1a (good enough for a cache key).
export function collectionFingerprint(names: string[]): string {
  const sorted = [...names].map((n) => n.toLowerCase()).sort();
  let hash = 0x811c9dc5;
  for (const name of sorted) {
    for (let i = 0; i < name.length; i++) {
      hash ^= name.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    hash ^= 0x7c; // "|" separator
    hash = (hash * 0x01000193) >>> 0;
  }
  return `${sorted.length}-${hash.toString(16)}`;
}
