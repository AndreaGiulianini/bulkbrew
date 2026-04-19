import type { ScryfallCard } from "~~/shared/types";

// EDHREC-style slug: lowercase, no diacritics, no punctuation other than
// word-joining hyphens. Must match json.edhrec.com's URL shape, e.g.
//   "Braids, Arisen Nightmare" -> "braids-arisen-nightmare"
//   "Night's Whisper"          -> "nights-whisper"
export function edhrecSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/,/g, "")
    .replace(/'/g, "")
    .replace(/"/g, "")
    .replace(/\//g, " ")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// EDHREC hosts each commander under the slug of its legendary-creature face
// only — the combined "Front // Back" name produces a 404. Pick the face
// whose type_line actually names it a legendary creature; fall back to the
// front face, then to the card-level name.
export function commanderFaceName(card: ScryfallCard | undefined): string {
  if (!card) return "";
  const faces = card.card_faces;
  if (!faces?.length) return card.name;
  const legendary = faces.find((f) => /Legendary/i.test(f.type_line ?? ""));
  return legendary?.name ?? faces[0]?.name ?? card.name;
}
