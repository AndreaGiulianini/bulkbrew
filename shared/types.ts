export interface CollectionEntry {
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  foil: string;
  rarity: string;
  quantity: number;
  scryfallId: string;
  condition: string;
  language: string;
  binderName: string;
}

export interface CollectionCard {
  name: string;
  scryfallId: string;
  quantity: number;
  copies: CollectionEntry[];
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  image_uris?: { small?: string; normal?: string; large?: string; art_crop?: string };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: { small?: string; normal?: string; large?: string };
  }>;
  legalities: Record<string, string>;
  rarity: string;
  set: string;
  set_name: string;
  collector_number: string;
  prices?: Record<string, string | null>;
  edhrec_rank?: number;
}

export interface EdhrecCard {
  name: string;
  sanitized: string;
  url: string;
  num_decks: number;
  potential_decks: number;
  inclusion: number;
  synergy?: number;
  trend_zscore?: number;
  id?: string;
}

export interface EdhrecCategory {
  tag: string;
  header: string;
  cardviews: EdhrecCard[];
}

export interface EdhrecPage {
  container: {
    json_dict?: {
      card?: {
        // Scryfall UUID. Used by /explore to seed the deck session
        // without a separate Scryfall round-trip.
        id?: string;
        name: string;
        image_uris?: string[][];
        color_identity?: string[];
        rank?: number;
      };
      cardlists?: EdhrecCategory[];
    };
  };
  creature?: number;
  instant?: number;
  sorcery?: number;
  artifact?: number;
  enchantment?: number;
  battle?: number;
  planeswalker?: number;
  land?: number;
  basic?: number;
  nonbasic?: number;
  deck_size?: number;
  num_decks_avg?: number;
  // EDHREC's panels live alongside container. Currently we only read
  // panels.mana_curve, a { cmc: avgCount } histogram used as a target during
  // auto-fill. Other panels (piechart, rank_over_time, etc.) are untyped.
  panels?: {
    mana_curve?: Record<string, number>;
    [key: string]: unknown;
  };
}

// Where this card came into the deck. `category` tells you the tag the
// auto-filler used, but doesn't distinguish "this card appeared in the
// commander's EDHREC recommendations" from "we picked it off your shelf
// purely by global edhrec_rank". `source` answers that cleanly so the UI
// can show which cards are on-theme vs just filler.
export type DeckCardSource = "commander" | "edhrec" | "filler" | "manual";

export interface DeckCard {
  name: string;
  scryfallId?: string;
  category: string;
  fromCollection: boolean;
  inclusion?: number;
  quantity?: number;
  source?: DeckCardSource;
}

export interface DeckRoles {
  ramp: number;
  draw: number;
  removal: number;
  wipe: number;
  protection: number;
  recursion: number;
  tutor: number;
}

export interface DeckStats {
  total: number;
  lands: number;
  creatures: number;
  instants: number;
  sorceries: number;
  artifacts: number;
  enchantments: number;
  planeswalkers: number;
  battles: number;
  other: number;
  curve: number[];
  pips: { W: number; U: number; B: number; R: number; G: number; C: number };
  avgCmc: number;
  roles: DeckRoles;
}

export interface DeckSession {
  id: string;
  name: string;
  commanderName: string;
  commanderScryfallId?: string;
  // Canonical EDHREC slug (e.g. "atraxa-praetors-voice"). When the session
  // was started from a commander whose name doesn't slugify cleanly to
  // EDHREC's URL — most commonly MDFCs picked from the explore page —
  // this overrides the slug derived from `commanderName`.
  commanderSlug?: string;
  colorIdentity: string[];
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

// A commander entry from EDHREC's top-list endpoints
// (json.edhrec.com/pages/commanders/{year,month}.json), used by the
// /explore page's search-and-pick UX. EDHREC's `id` is a Scryfall UUID,
// so we can render the card image from the CDN without any Scryfall call.
export interface TopCommander {
  name: string;
  slug: string;
  scryfallId: string;
  imageUrl?: string;
  colorIdentity: string[];
  inclusion: number;
  rank: number;
}

// One row in the /match page's ranked output. `buildability` is the
// inclusion-weighted % of the commander's typical 99-card deck the user
// already owns; `ownedCount` / `topCount` is the human-readable variant
// (count of top-99 EDHREC recs the user owns).
export interface CommanderMatchResult {
  commander: TopCommander;
  buildability: number; // 0–100
  ownedCount: number;
  topCount: number; // typically 99, less for sparse commanders
  owned: boolean;
}

export interface CategorizedRecs {
  category: string;
  header: string;
  owned: EnrichedRec[];
  missing: EnrichedRec[];
}

export interface EnrichedRec extends EdhrecCard {
  owned: boolean;
  ownedQuantity?: number;
  ownedScryfallId?: string;
  buyAdvice?: "staple" | "high-synergy" | "substitutable";
}
