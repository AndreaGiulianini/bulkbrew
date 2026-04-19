import Papa from "papaparse";
import { defineStore } from "pinia";
import { parseDeckList } from "~/utils/deck-import";
import { resolveIdentifiers, type ScryfallIdentifier } from "~/utils/scryfall";
import { loadDoc, saveDoc } from "~/utils/storage";
import type { CollectionCard, CollectionEntry, ScryfallCard } from "~~/shared/types";

const COLLECTION_KEY = "collection:v1";

interface State {
  cards: CollectionCard[];
  scryfallByName: Map<string, ScryfallCard>;
  loading: boolean;
  error: string | null;
}

export const useCollectionStore = defineStore("collection", {
  state: (): State => ({
    cards: [],
    scryfallByName: new Map(),
    loading: false,
    error: null,
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
        if (this.cards.length) await this.enrichWithScryfall();
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

      const { cards, notFound } = isManaBox
        ? parseManaBoxCsv(text)
        : isMoxfield
          ? await parseMoxfieldCsv(text)
          : await resolveDeckText(text);

      if (!cards.length) {
        throw new Error(
          `No cards could be matched against Scryfall (${notFound.length} name${notFound.length === 1 ? "" : "s"} unresolved).`,
        );
      }

      await saveDoc("collection", COLLECTION_KEY, cards);
      this.cards = cards;
      this.scryfallByName = new Map();
      await this.enrichWithScryfall();
      return { imported: cards.length, notFound };
    },

    async enrichWithScryfall() {
      const identifiers: ScryfallIdentifier[] = this.cards
        .filter((c) => c.scryfallId)
        .map((c) => ({ id: c.scryfallId }));
      if (!identifiers.length) return;
      const { data } = await resolveIdentifiers(identifiers);
      for (const card of data) {
        this.scryfallByName.set(card.name.toLowerCase(), card);
      }
    },

    async enrichNames(names: string[]) {
      const needed = names.filter((n) => !this.scryfallByName.has(n.toLowerCase()));
      if (!needed.length) return;
      const { data } = await resolveIdentifiers(needed.map((name) => ({ name })));
      for (const card of data) {
        this.scryfallByName.set(card.name.toLowerCase(), card);
      }
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
function parseManaBoxCsv(csv: string): { cards: CollectionCard[]; notFound: string[] } {
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

// Moxfield collection CSV → CollectionCard[]. Moxfield exports don't
// include a Scryfall ID, so we use the `{set, collector_number}`
// identifier type on /cards/collection for an exact printing match.
// That preserves the user's own foil / condition / language metadata
// instead of collapsing every copy onto Scryfall's default printing.
async function parseMoxfieldCsv(
  csv: string,
): Promise<{ cards: CollectionCard[]; notFound: string[] }> {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  // Keep the parsed row alongside its identifier so we can marry Scryfall's
  // response back to the user's original metadata (condition, foil, …).
  interface Pending {
    row: Record<string, string>;
    identifier: ScryfallIdentifier;
    printingKey: string; // `${set}/${collector}` or `name:${lower}`
  }
  const pending: Pending[] = [];
  for (const row of parsed.data) {
    const name = (row.Name ?? "").trim();
    if (!name) continue;
    const edition = (row.Edition ?? "").trim().toLowerCase();
    const collector = (row["Collector Number"] ?? "").trim();
    if (edition && collector) {
      pending.push({
        row,
        identifier: { set: edition, collector_number: collector },
        printingKey: `${edition}/${collector}`,
      });
    } else {
      pending.push({
        row,
        identifier: { name },
        printingKey: `name:${name.toLowerCase()}`,
      });
    }
  }

  if (!pending.length) {
    throw new Error("Moxfield CSV is empty or has no recognizable rows.");
  }

  const { data } = await resolveIdentifiers(pending.map((p) => p.identifier));

  // Index resolved Scryfall cards by both keys we might look up with.
  const byPrinting = new Map<string, ScryfallCard>();
  for (const card of data) {
    if (card.set && card.collector_number) {
      byPrinting.set(`${card.set}/${card.collector_number}`, card);
    }
    if (card.name) {
      byPrinting.set(`name:${card.name.toLowerCase()}`, card);
    }
  }

  const byScryfall = new Map<string, CollectionCard>();
  const notFound: string[] = [];
  for (const p of pending) {
    const sc = byPrinting.get(p.printingKey);
    if (!sc) {
      notFound.push(p.row.Name ?? "(unnamed)");
      continue;
    }
    const quantity = Number.parseInt(p.row.Count ?? "0", 10) || 0;
    if (quantity <= 0) continue;
    const entry = makeEntry({
      name: sc.name,
      scryfallId: sc.id,
      quantity,
      setCode: sc.set ?? "",
      setName: sc.set_name ?? "",
      collectorNumber: sc.collector_number ?? "",
      rarity: sc.rarity ?? "",
      foil: p.row.Foil ?? "",
      condition: p.row.Condition ?? "",
      language: p.row.Language ?? "",
    });
    const existing = byScryfall.get(sc.id);
    if (existing) {
      existing.quantity += quantity;
      existing.copies.push(entry);
    } else {
      byScryfall.set(sc.id, {
        name: sc.name,
        scryfallId: sc.id,
        quantity,
        copies: [entry],
      });
    }
  }

  const cards = Array.from(byScryfall.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { cards, notFound };
}

// Plain deck-list-style text (Moxfield, MTGO, Arena, handwritten) → resolve
// each name against Scryfall so we get a stable Scryfall ID to store.
//
// Known limitation: duplicate names are merged by summing quantities; per-
// copy metadata the ManaBox CSV preserves (foil, condition, language,
// binder) is not recoverable from a plain deck list, so the merged entry
// gets a single synthetic copy with empty strings for those fields.
async function resolveDeckText(
  text: string,
): Promise<{ cards: CollectionCard[]; notFound: string[] }> {
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

  const identifiers: ScryfallIdentifier[] = Array.from(byName.values()).map((e) => ({
    name: e.name,
  }));
  const { data } = await resolveIdentifiers(identifiers);
  const scByName = new Map<string, ScryfallCard>();
  for (const card of data) scByName.set(card.name.toLowerCase(), card);

  const cards: CollectionCard[] = [];
  const notFound: string[] = [];
  for (const { name, quantity } of byName.values()) {
    const sc = scByName.get(name.toLowerCase());
    if (!sc) {
      notFound.push(name);
      continue;
    }
    cards.push({
      name: sc.name,
      scryfallId: sc.id,
      quantity,
      copies: [
        makeEntry({
          name: sc.name,
          scryfallId: sc.id,
          quantity,
          setCode: sc.set ?? "",
          setName: sc.set_name ?? "",
          collectorNumber: sc.collector_number ?? "",
          rarity: sc.rarity ?? "",
        }),
      ],
    });
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return { cards, notFound };
}
