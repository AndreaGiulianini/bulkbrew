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
