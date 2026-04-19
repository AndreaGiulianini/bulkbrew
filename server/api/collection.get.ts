import { promises as fs } from "node:fs";
import Papa from "papaparse";
import type { CollectionCard, CollectionEntry } from "~~/shared/types";

export default defineEventHandler(async () => {
  const { collectionPath } = useRuntimeConfig();
  let raw: string;
  try {
    raw = await fs.readFile(collectionPath, "utf8");
  } catch {
    return { count: 0, totalCopies: 0, cards: [], path: null };
  }
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  });

  const byScryfall = new Map<string, CollectionCard>();
  for (const row of parsed.data) {
    const scryfallId = row["Scryfall ID"];
    if (!scryfallId) continue;
    const entry: CollectionEntry = {
      name: row.Name ?? "",
      setCode: row["Set code"] ?? "",
      setName: row["Set name"] ?? "",
      collectorNumber: row["Collector number"] ?? "",
      foil: row.Foil ?? "",
      rarity: row.Rarity ?? "",
      quantity: parseInt(row.Quantity ?? "0", 10) || 0,
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

  return {
    count: cards.length,
    totalCopies: cards.reduce((s, c) => s + c.quantity, 0),
    cards,
    path: collectionPath,
  };
});
