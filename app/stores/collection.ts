import Papa from "papaparse";
import { defineStore } from "pinia";
import { parseDeckList } from "~/utils/deck-import";
import {
  fetchCommanderCatalog,
  resolveIdentifiers,
  type ScryfallIdentifier,
} from "~/utils/scryfall";
import { loadDoc, saveDoc } from "~/utils/storage";
import type { CollectionCard, CollectionEntry, ScryfallCard } from "~~/shared/types";

const COLLECTION_KEY = "collection:v1";

// Surfaced to the UI so pages that trigger the deferred Scryfall resolve
// (commander picker, deck builder) can show a "X / Y resolved" bar instead
// of a generic spinner. Set to null when no resolve is in flight.
export interface ResolveProgress {
  loaded: number;
  total: number;
}

interface State {
  cards: CollectionCard[];
  scryfallByName: Map<string, ScryfallCard>;
  loading: boolean;
  error: string | null;
  resolveProgress: ResolveProgress | null;
}

export const useCollectionStore = defineStore("collection", {
  state: (): State => ({
    cards: [],
    scryfallByName: new Map(),
    loading: false,
    error: null,
    resolveProgress: null,
  }),

  getters: {
    count: (s) => s.cards.length,
    totalCopies: (s) => s.cards.reduce((n, c) => n + c.quantity, 0),
    nameSet(s): Set<string> {
      return new Set(s.cards.map((c) => c.name.toLowerCase()));
    },
    ownedByName(s): Map<string, CollectionCard> {
      const m = new Map<string, CollectionCard>();
      for (const c of s.cards) m.set(c.name.toLowerCase(), c);
      return m;
    },
    legendaryCreatures(s): Array<CollectionCard & { scryfall?: ScryfallCard }> {
      const out: Array<CollectionCard & { scryfall?: ScryfallCard }> = [];
      for (const card of s.cards) {
        const sc = s.scryfallByName.get(card.name.toLowerCase());
        if (!sc) continue;
        const type = sc.type_line ?? "";
        const isLegendary = /Legendary/.test(type);
        const isCreature = /Creature/.test(type);
        const canBeCommander =
          (isLegendary && isCreature) ||
          (sc.oracle_text ?? "").toLowerCase().includes("can be your commander");
        if (canBeCommander) out.push({ ...card, scryfall: sc });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  },

  actions: {
    // Load the raw collection from IDB. No Scryfall traffic — pages that
    // need card metadata call `resolveCommanders` / `resolveNames` /
    // `enrichWithScryfall` to fetch only what they actually display.
    async load() {
      if (this.cards.length) return;
      await this.reload();
    },

    async reload() {
      this.loading = true;
      this.error = null;
      try {
        const stored = await loadDoc<CollectionCard[]>("collection", COLLECTION_KEY);
        this.cards = stored ?? [];
        this.scryfallByName = new Map();
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },

    async upload(file: File) {
      const text = await file.text();
      await this.importFromText(text, file.name);
    },

    // Dispatches across three import formats:
    //   1. ManaBox CSV — detected by a "Scryfall ID" column; carries IDs
    //      directly, no Scryfall lookup needed for the import itself.
    //   2. Moxfield collection CSV — detected by Count/Name/Edition/Collector
    //      Number columns; resolved via {set, collector_number} for exact
    //      printing match.
    //   3. Plain deck-list text — "1 Sol Ring" style; resolved via name.
    // All paths end up with a `CollectionCard[]` carrying stable Scryfall
    // IDs so the rest of the app can enrich uniformly.
    // Import is deliberately fast: no Scryfall calls during parse. All three
    // paths (ManaBox / Moxfield / plain text) just structure rows locally and
    // persist. Scryfall resolution happens lazily the next time a page that
    // needs card metadata (commander picker, deck builder) calls `load()`.
    // This decouples "user uploaded a file" from "we're waiting on an API"
    // and lets a 1 000-card import finish in milliseconds instead of seconds.
    async importFromText(
      text: string,
      _filename = "imported-collection.csv",
    ): Promise<{ imported: number; notFound: string[] }> {
      if (!text.trim()) {
        throw new Error("The import is empty. Paste a card list or upload a CSV.");
      }
      const firstLineLower = (text.split(/\r?\n/, 1)[0] ?? "").toLowerCase();
      const isManaBox = /\bname\b/.test(firstLineLower) && /\bscryfall\s*id\b/.test(firstLineLower);
      const isMoxfield =
        !isManaBox &&
        /\bcount\b/.test(firstLineLower) &&
        /\bname\b/.test(firstLineLower) &&
        /\bedition\b/.test(firstLineLower) &&
        /\bcollector number\b/.test(firstLineLower);

      const parsed: ParsedCollection = isManaBox
        ? parseManaBoxCsv(text)
        : isMoxfield
          ? parseMoxfieldCsv(text)
          : resolveDeckText(text);

      if (!parsed.cards.length) {
        throw new Error(
          `No cards could be matched from the input (${parsed.notFound.length} row${parsed.notFound.length === 1 ? "" : "s"} skipped).`,
        );
      }

      await saveDoc("collection", COLLECTION_KEY, parsed.cards);
      this.cards = parsed.cards;
      // Scryfall data is empty until the next `load()` call on a page that
      // needs it (commander / build). Clearing it signals "stale" to the
      // load guard so it will re-enrich.
      this.scryfallByName = new Map();
      return { imported: parsed.cards.length, notFound: parsed.notFound };
    },

    // Resolves every collection card against Scryfall. Called by `load()`
    // whenever `scryfallByName` is empty but `cards` is populated (i.e. just
    // after a deferred import, or on a fresh page load from IDB where the
    // collection was imported under the deferred flow).
    //
    // Handles three identifier shapes in one batch:
    //   - cards with a `scryfallId` (already resolved)   → `{ id }`
    //   - Moxfield cards with set+collector on first copy → `{ set, collector_number }`
    //   - plain-text cards                                → `{ name }`
    // After the batch resolves, patches each card's `scryfallId` / canonical
    // `name` / per-copy metadata in place so subsequent reads don't need to
    // re-resolve, and persists the patched collection back to IDB.
    async enrichWithScryfall() {
      if (!this.cards.length) return;
      this.resolveProgress = { loaded: 0, total: this.cards.length };
      try {
        interface Pending {
          cardIndex: number;
          identifier: ScryfallIdentifier;
          printingKey?: string; // `${set}/${collector}` when usable for reconciliation
        }
        const pending: Pending[] = [];
        for (let i = 0; i < this.cards.length; i++) {
          // biome-ignore lint/style/noNonNullAssertion: bounded i
          const card = this.cards[i]!;
          if (card.scryfallId) {
            pending.push({ cardIndex: i, identifier: { id: card.scryfallId } });
            continue;
          }
          const firstCopy = card.copies[0];
          const setCode = firstCopy?.setCode?.toLowerCase();
          const collector = firstCopy?.collectorNumber;
          if (setCode && collector) {
            pending.push({
              cardIndex: i,
              identifier: { set: setCode, collector_number: collector },
              printingKey: `${setCode}/${collector}`,
            });
          } else {
            pending.push({ cardIndex: i, identifier: { name: card.name } });
          }
        }

        const { data } = await resolveIdentifiers(
          pending.map((p) => p.identifier),
          {
            onProgress: (loaded, total) => {
              this.resolveProgress = { loaded, total };
            },
          },
        );

        // Index the response by every key a pending identifier might look
        // up with, so reconciliation is O(1) per card.
        const byKey = new Map<string, ScryfallCard>();
        for (const card of data) {
          if (card.id) byKey.set(`id:${card.id}`, card);
          if (card.set && card.collector_number) {
            byKey.set(`set:${card.set}/${card.collector_number}`, card);
          }
          if (card.name) byKey.set(`name:${card.name.toLowerCase()}`, card);
        }

        // Patch the collection in place with resolved metadata.
        let mutated = false;
        for (const p of pending) {
          // biome-ignore lint/style/noNonNullAssertion: bounded by pending loop
          const card = this.cards[p.cardIndex]!;
          let sc: ScryfallCard | undefined;
          if (p.identifier.id) sc = byKey.get(`id:${p.identifier.id}`);
          else if (p.printingKey) sc = byKey.get(`set:${p.printingKey}`);
          else if (p.identifier.name) sc = byKey.get(`name:${p.identifier.name.toLowerCase()}`);
          if (!sc) continue;

          this.scryfallByName.set(sc.name.toLowerCase(), sc);
          if (card.scryfallId) continue; // already populated; nothing to patch

          card.scryfallId = sc.id;
          card.name = sc.name; // snap to Scryfall's canonical spelling
          for (const copy of card.copies) {
            copy.scryfallId = sc.id;
            copy.name = sc.name;
            if (!copy.setCode) copy.setCode = sc.set ?? "";
            if (!copy.setName) copy.setName = sc.set_name ?? "";
            if (!copy.collectorNumber) copy.collectorNumber = sc.collector_number ?? "";
            if (!copy.rarity) copy.rarity = sc.rarity ?? "";
          }
          mutated = true;
        }

        if (mutated) {
          await saveDoc("collection", COLLECTION_KEY, this.cards);
        }
      } finally {
        this.resolveProgress = null;
      }
    },

    // Resolve a specific subset of the collection by name against Scryfall.
    // Used by pages that only need a slice of the collection enriched (e.g.
    // /build resolves just the deck cards on mount) and by autofill when it
    // needs metadata for recommendation candidates. Dedupes against what's
    // already in `scryfallByName` so we don't re-fetch anything.
    async resolveNames(names: string[], onProgress?: (loaded: number, total: number) => void) {
      const needed = Array.from(
        new Set(
          names.map((n) => n.trim()).filter((n) => n && !this.scryfallByName.has(n.toLowerCase())),
        ),
      );
      if (!needed.length) return;
      const { data } = await resolveIdentifiers(
        needed.map((name) => ({ name })),
        { onProgress },
      );

      // Index collection cards by lowercase name once so we can patch
      // them in O(1) per resolved Scryfall card instead of walking the
      // whole collection for every response row.
      const collectionByName = new Map<string, CollectionCard>();
      for (const card of this.cards) {
        collectionByName.set(card.name.toLowerCase(), card);
      }

      let mutated = false;
      for (const sc of data) {
        const key = sc.name.toLowerCase();
        this.scryfallByName.set(key, sc);
        // Patch the matching CollectionCard so autofill / images downstream
        // use the direct cards.scryfall.io CDN URL (built from scryfallId)
        // instead of the fallback `/cards/named?format=image` redirect,
        // which is slower and shares the `/cards/collection` rate-limit
        // bucket.
        if (sc.id) {
          const own = collectionByName.get(key);
          if (own && !own.scryfallId) {
            own.scryfallId = sc.id;
            for (const copy of own.copies) {
              if (!copy.scryfallId) copy.scryfallId = sc.id;
            }
            mutated = true;
          }
        }
      }
      if (mutated) {
        await saveDoc("collection", COLLECTION_KEY, this.cards);
      }
    },

    // Alias kept for callers that still say `enrichNames`. Same behavior as
    // `resolveNames`.
    async enrichNames(names: string[]) {
      await this.resolveNames(names);
    },

    // Intersect the user's collection with Scryfall's global commander
    // catalog to produce the commander picker list — without enriching the
    // entire collection. The catalog is shared across all users and cached
    // for 7 days, so the typical page load is a pure local Set intersection.
    //
    // Populates `scryfallByName` only for commander hits and patches any
    // missing `scryfallId` on the matching CollectionCards (so future
    // /build navigations for those decks have IDs for their image URLs).
    async resolveCommanders(): Promise<Array<CollectionCard & { scryfall: ScryfallCard }>> {
      if (!this.cards.length) return [];
      const catalog = await fetchCommanderCatalog();
      if (!catalog.length) return [];

      const byName = new Map<string, ScryfallCard>();
      for (const c of catalog) {
        if (c.name) byName.set(c.name.toLowerCase(), c);
      }

      // Dedupe by lowercased name: a user may own two printings of the
      // same legendary (e.g. a ManaBox CSV with one row per printing).
      // There's still only ONE commander to pick, so keep the first
      // CollectionCard we hit and merge total-copy quantities across the
      // rest so the UI can show "xN across N printings" if it ever wants.
      const byId = new Map<string, CollectionCard & { scryfall: ScryfallCard }>();
      let mutated = false;
      for (const card of this.cards) {
        const key = card.name.toLowerCase();
        const sc = byName.get(key);
        if (!sc) continue;
        this.scryfallByName.set(key, sc);
        if (!card.scryfallId && sc.id) {
          card.scryfallId = sc.id;
          for (const copy of card.copies) {
            if (!copy.scryfallId) copy.scryfallId = sc.id;
          }
          mutated = true;
        }
        const existing = byId.get(sc.id);
        if (existing) {
          // Keep the first printing's identity but roll up quantities so
          // the grid shows total owned count across printings.
          existing.quantity += card.quantity;
          existing.copies = [...existing.copies, ...card.copies];
        } else {
          byId.set(sc.id, { ...card, scryfall: sc });
        }
      }
      if (mutated) {
        await saveDoc("collection", COLLECTION_KEY, this.cards);
      }
      return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    },

    getScryfall(name: string): ScryfallCard | undefined {
      return this.scryfallByName.get(name.toLowerCase());
    },

    isOwned(name: string): boolean {
      return this.nameSet.has(name.toLowerCase());
    },

    getOwned(name: string): CollectionCard | undefined {
      return this.ownedByName.get(name.toLowerCase());
    },
  },
});

// --- Helpers ---------------------------------------------------------------

// Build a CollectionEntry with empty-string defaults for the many
// optional-but-always-present (typed `string`) metadata fields. Used by
// both the ManaBox CSV path (rich data) and the plain-text path
// (synthetic copy with most fields blank).
function makeEntry(
  partial: Partial<CollectionEntry> & Pick<CollectionEntry, "name" | "scryfallId" | "quantity">,
): CollectionEntry {
  return {
    setCode: "",
    setName: "",
    collectorNumber: "",
    foil: "",
    rarity: "",
    condition: "",
    language: "",
    binderName: "",
    ...partial,
  };
}

// ManaBox CSV → CollectionCard[] aggregated by Scryfall ID.
// Note: no Scryfall fetch happens here (IDs are in the CSV), so the
// returned ParsedCollection carries no `scryfallByName` — the caller
// runs enrichWithScryfall() afterwards.
function parseManaBoxCsv(csv: string): ParsedCollection {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const byScryfall = new Map<string, CollectionCard>();
  const notFound: string[] = [];
  for (const row of parsed.data) {
    const scryfallId = row["Scryfall ID"];
    if (!scryfallId) {
      if (row.Name) notFound.push(row.Name);
      continue;
    }
    const entry = makeEntry({
      name: row.Name ?? "",
      scryfallId,
      quantity: Number.parseInt(row.Quantity ?? "0", 10) || 0,
      setCode: row["Set code"] ?? "",
      setName: row["Set name"] ?? "",
      collectorNumber: row["Collector number"] ?? "",
      foil: row.Foil ?? "",
      rarity: row.Rarity ?? "",
      condition: row.Condition ?? "",
      language: row.Language ?? "",
      binderName: row["Binder Name"] ?? "",
    });
    const existing = byScryfall.get(scryfallId);
    if (existing) {
      existing.quantity += entry.quantity;
      existing.copies.push(entry);
    } else {
      byScryfall.set(scryfallId, {
        name: entry.name,
        scryfallId,
        quantity: entry.quantity,
        copies: [entry],
      });
    }
  }
  const cards = Array.from(byScryfall.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { cards, notFound };
}

type ParsedCollection = {
  cards: CollectionCard[];
  notFound: string[];
};

// Moxfield collection CSV → CollectionCard[]. Purely local: we DON'T hit
// Scryfall here. Cards come back with `scryfallId: ""` and the set /
// collector number from the CSV stored on each copy — the subsequent
// `enrichWithScryfall()` pass (triggered the next time a page that needs
// Scryfall data mounts) resolves them via the `{set, collector_number}`
// identifier type and patches the cards in place.
function parseMoxfieldCsv(csv: string): ParsedCollection {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  // Aggregate by set+collector when both are present (unique per printing),
  // fall back to card name otherwise. Keeps "same printing, multiple rows"
  // merging correct without needing the canonical Scryfall ID yet.
  const byKey = new Map<string, CollectionCard>();
  const notFound: string[] = [];
  for (const row of parsed.data) {
    const name = (row.Name ?? "").trim();
    if (!name) continue;
    const edition = (row.Edition ?? "").trim().toLowerCase();
    const collector = (row["Collector Number"] ?? "").trim();
    const key = edition && collector ? `${edition}/${collector}` : `name:${name.toLowerCase()}`;
    const quantity = Number.parseInt(row.Count ?? "0", 10) || 0;
    if (quantity <= 0) {
      notFound.push(name);
      continue;
    }
    const entry = makeEntry({
      name,
      scryfallId: "",
      quantity,
      setCode: edition,
      collectorNumber: collector,
      foil: row.Foil ?? "",
      condition: row.Condition ?? "",
      language: row.Language ?? "",
    });
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.copies.push(entry);
    } else {
      byKey.set(key, {
        name,
        scryfallId: "",
        quantity,
        copies: [entry],
      });
    }
  }

  if (!byKey.size) {
    throw new Error("Moxfield CSV is empty or has no recognizable rows.");
  }

  const cards = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { cards, notFound };
}

// Plain deck-list-style text ("1 Sol Ring" lines) → CollectionCard[].
// Local parse only: no Scryfall call. Cards come back with `scryfallId: ""`
// and no set/collector info (the text didn't carry any). `enrichWithScryfall`
// resolves them later by name.
//
// Known limitation: duplicate names are merged by summing quantities. Plain
// text never carried per-copy metadata (foil, condition, language), so the
// merged entry gets a single synthetic copy with empty strings for those.
function resolveDeckText(text: string): ParsedCollection {
  const parsed = parseDeckList(text);
  const entries = [...parsed.commanders, ...parsed.mainboard, ...parsed.sideboard];
  if (!entries.length) {
    throw new Error("No cards found in the provided text.");
  }

  const byName = new Map<string, { name: string; quantity: number }>();
  for (const e of entries) {
    const key = e.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) existing.quantity += e.quantity;
    else byName.set(key, { name: e.name, quantity: e.quantity });
  }

  const cards: CollectionCard[] = [];
  for (const { name, quantity } of byName.values()) {
    cards.push({
      name,
      scryfallId: "",
      quantity,
      copies: [makeEntry({ name, scryfallId: "", quantity })],
    });
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return { cards, notFound: [] };
}
