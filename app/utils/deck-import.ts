// Parses deck lists exported from Moxfield, MTGO, Magic Arena (MTGA),
// Archidekt, TappedOut, and any tool that uses the common "{qty} {name} (SET) #"
// plain-text shape with optional `Commander:` / `Deck:` / `Sideboard:` section
// headers.

export interface ParsedCardEntry {
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
}

export interface ParsedDeckList {
  commanders: ParsedCardEntry[];
  mainboard: ParsedCardEntry[];
  sideboard: ParsedCardEntry[];
  deckName?: string;
}

type Section = "commander" | "deck" | "sideboard" | "companion";

const SECTION_MAP: Record<string, Section> = {
  commander: "commander",
  commanders: "commander",
  deck: "deck",
  mainboard: "deck",
  maindeck: "deck",
  main: "deck",
  companion: "companion",
  sideboard: "sideboard",
  side: "sideboard",
  sb: "sideboard",
};

// A card line: "{qty} {name}" with optional "(SET)" and collector number.
// Handles forms like:
//   1 Sol Ring
//   1 Sol Ring (CMR) 514
//   3 Forest (UNF) 235 *F*
//   1x Sol Ring
// The collector group is nested inside the set group so that card names with
// multiple words (e.g. "Night's Whisper", "Braids, Arisen Nightmare") aren't
// mis-parsed as "name + trailing word". Collector numbers must start with a
// digit so they can't swallow a card-name word.
const CARD_LINE_RE = /^(\d+)x?\s+(.+?)(?:\s+\(([^)]+)\)(?:\s+(\d+\S*))?)?\s*$/;

// Detects a section header: "COMMANDER", "Deck:", "SIDEBOARD", etc.
function sectionFromHeader(line: string): Section | null {
  const m = line.match(/^([A-Za-z]+)\s*:?\s*$/);
  if (!m) return null;
  const key = m[1]?.toLowerCase();
  if (!key) return null;
  return SECTION_MAP[key] ?? null;
}

export function parseDeckList(input: string): ParsedDeckList {
  const commanders: ParsedCardEntry[] = [];
  const mainboard: ParsedCardEntry[] = [];
  const sideboard: ParsedCardEntry[] = [];
  let deckName: string | undefined;
  let section: Section = "deck";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("//")) {
      // Moxfield/MTGO comments sometimes carry the deck name ("// Deck name").
      const nameMatch = line.match(/^\/\/\s*(.+)$/);
      if (!deckName && nameMatch && !/^(commander|total|by|deck)[: ]/i.test(nameMatch[1] ?? "")) {
        deckName = nameMatch[1]?.trim();
      }
      continue;
    }
    if (line.startsWith("#")) continue;

    const header = sectionFromHeader(line);
    if (header) {
      section = header;
      continue;
    }

    // Inline "SB:" prefix forces sideboard regardless of current section.
    const isInlineSideboard = /^SB:\s*/i.test(line);
    // Strip trailing foil/promo markers like *F* or *CMDR* before parsing.
    const body = line.replace(/^SB:\s*/i, "").replace(/\s*\*[A-Za-z*]+\*\s*$/, "");

    const match = body.match(CARD_LINE_RE);
    if (!match) continue;
    const [, qtyStr, name, set, collectorNumber] = match;
    const quantity = Number.parseInt(qtyStr ?? "0", 10);
    if (!quantity || !name) continue;

    const entry: ParsedCardEntry = {
      quantity,
      name: name.trim(),
      set: set?.trim(),
      collectorNumber: collectorNumber?.trim(),
    };

    if (isInlineSideboard || section === "sideboard" || section === "companion") {
      sideboard.push(entry);
    } else if (section === "commander") {
      commanders.push(entry);
    } else {
      mainboard.push(entry);
    }
  }

  return { commanders, mainboard, sideboard, deckName };
}
