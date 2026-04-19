import Papa from "papaparse";
import { defineStore } from "pinia";
import { parseDeckList } from "~/utils/deck-import";
import type { CollectionCard, ScryfallCard } from "~~/shared/types";

interface State {
  cards: CollectionCard[];
  scryfallByName: Map<string, ScryfallCard>;
  loading: boolean;
  error: string | null;
  path: string | null;
}

export const useCollectionStore = defineStore("collection", {
  state: (): State => ({
    cards: [],
    scryfallByName: new Map(),
    loading: false,
    error: null,
    path: null,
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
        const resp = await $fetch<{
          cards: CollectionCard[];
          path: string;
        }>("/api/collection");
        this.cards = resp.cards;
        this.path = resp.path;
        this.scryfallByName = new Map();
        await this.enrichWithScryfall();
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
    // "1 Card Name" lines). Non-CSV input is resolved via Scryfall so we end up
    // with the Scryfall IDs the server expects.
    async importFromText(
      text: string,
      filename = "imported-collection.csv",
    ): Promise<{ imported: number; notFound: string[] }> {
      const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
      const isStructuredCsv = /name/i.test(firstLine) && /scryfall\s*id/i.test(firstLine);

      const { csv, imported, notFound } = isStructuredCsv
        ? { csv: text, imported: 0, notFound: [] as string[] }
        : await this.textToCsv(text);
      await $fetch("/api/collection", {
        method: "POST",
        body: { csv, filename },
      });
      this.cards = [];
      this.scryfallByName = new Map();
      await this.reload();
      return { imported: imported || this.cards.length, notFound };
    },

    async textToCsv(text: string): Promise<{ csv: string; imported: number; notFound: string[] }> {
      const parsed = parseDeckList(text);
      const entries = [...parsed.commanders, ...parsed.mainboard, ...parsed.sideboard];
      if (!entries.length) {
        throw new Error("No cards found in the provided text.");
      }

      // Merge duplicate names by summing quantities.
      const byName = new Map<string, { name: string; quantity: number }>();
      for (const e of entries) {
        const key = e.name.toLowerCase();
        const existing = byName.get(key);
        if (existing) existing.quantity += e.quantity;
        else byName.set(key, { name: e.name, quantity: e.quantity });
      }

      const identifiers = Array.from(byName.values()).map((e) => ({ name: e.name }));
      const resp = await $fetch<{ data: ScryfallCard[] }>("/api/scryfall/collection", {
        method: "POST",
        body: { identifiers },
      });

      const scByName = new Map<string, ScryfallCard>();
      for (const card of resp.data) {
        scByName.set(card.name.toLowerCase(), card);
      }

      const rows: Array<Record<string, string | number>> = [];
      const notFound: string[] = [];
      for (const { name, quantity } of byName.values()) {
        const sc = scByName.get(name.toLowerCase());
        if (!sc) {
          notFound.push(name);
          continue;
        }
        rows.push({
          Name: sc.name,
          "Scryfall ID": sc.id,
          Quantity: quantity,
          "Set code": sc.set ?? "",
          "Collector number": sc.collector_number ?? "",
          Rarity: sc.rarity ?? "",
        });
      }

      if (!rows.length) {
        throw new Error(
          `No cards could be matched against Scryfall (${notFound.length} name${notFound.length === 1 ? "" : "s"} unresolved).`,
        );
      }
      return { csv: Papa.unparse(rows), imported: rows.length, notFound };
    },

    async enrichWithScryfall() {
      const identifiers = this.cards.map((c) => ({ id: c.scryfallId }));
      const resp = await $fetch<{ data: ScryfallCard[] }>("/api/scryfall/collection", {
        method: "POST",
        body: { identifiers },
      });
      for (const card of resp.data) {
        this.scryfallByName.set(card.name.toLowerCase(), card);
      }
    },

    async enrichNames(names: string[]) {
      const needed = names.filter((n) => !this.scryfallByName.has(n.toLowerCase()));
      if (!needed.length) return;
      const identifiers = needed.map((name) => ({ name }));
      const resp = await $fetch<{ data: ScryfallCard[] }>("/api/scryfall/collection", {
        method: "POST",
        body: { identifiers },
      });
      for (const card of resp.data) {
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
