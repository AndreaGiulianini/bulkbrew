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

    // Accepts either a ManaBox-style CSV (with "Scryfall ID" header) or a plain
    // deck-list-style text (e.g. Moxfield collection export, or handwritten
    // "1 Card Name" lines). Non-CSV input is resolved via Scryfall so we can
    // attach the Scryfall IDs the rest of the app expects.
    async importFromText(
      text: string,
      _filename = "imported-collection.csv",
    ): Promise<{ imported: number; notFound: string[] }> {
      const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
      const isStructuredCsv = /name/i.test(firstLine) && /scryfall\s*id/i.test(firstLine);

      const { cards, notFound } = isStructuredCsv
        ? parseManaBoxCsv(text)
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
    const entry: CollectionEntry = {
      name: row.Name ?? "",
      setCode: row["Set code"] ?? "",
      setName: row["Set name"] ?? "",
      collectorNumber: row["Collector number"] ?? "",
      foil: row.Foil ?? "",
      rarity: row.Rarity ?? "",
      quantity: Number.parseInt(row.Quantity ?? "0", 10) || 0,
      scryfallId,
      condition: row.Condition ?? "",
      language: row.Language ?? "",
      binderName: row["Binder Name"] ?? "",
    };
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

// Plain deck-list-style text (Moxfield, MTGO, Arena, handwritten) → resolve
// each name against Scryfall so we get a stable Scryfall ID to store. Duplicate
// names are merged by summing quantities.
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
        {
          name: sc.name,
          scryfallId: sc.id,
          setCode: sc.set ?? "",
          setName: sc.set_name ?? "",
          collectorNumber: sc.collector_number ?? "",
          foil: "",
          rarity: sc.rarity ?? "",
          quantity,
          condition: "",
          language: "",
          binderName: "",
        },
      ],
    });
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return { cards, notFound };
}
