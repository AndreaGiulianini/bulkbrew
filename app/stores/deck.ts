import { defineStore } from "pinia";
import { type CardRole, detectRoles } from "~/utils/card-roles";
import { getCommanderPage } from "~/utils/edhrec";
import { commanderFaceName, edhrecSlug } from "~/utils/slug";
import type {
  CategorizedRecs,
  DeckCard,
  DeckCardSource,
  DeckRoles,
  DeckSession,
  DeckStats,
  EdhrecCard,
  EdhrecPage,
  EnrichedRec,
  ScryfallCard,
} from "~~/shared/types";
import { useCollectionStore } from "./collection";
import { useSessionsStore } from "./sessions";

export interface RoleTargets {
  ramp: number;
  draw: number;
  removal: number;
  wipe: number;
}

export interface BuildRules {
  landTarget: number;
  synergyWeight: number;
  fillMissing: boolean;
  maxCmc: number;
  roleTargets: RoleTargets;
}

const DEFAULT_RULES: BuildRules = {
  landTarget: 36,
  synergyWeight: 0.5,
  fillMissing: true,
  maxCmc: 10,
  // EDH casual baseline: 8 ramp / 8 draw / 5 removal / 2 wipes.
  roleTargets: { ramp: 8, draw: 8, removal: 5, wipe: 2 },
};

const DEFICIT_ROLES = ["ramp", "draw", "removal", "wipe"] as const;
type DeficitRole = (typeof DEFICIT_ROLES)[number];
function isDeficitRole(r: CardRole): r is DeficitRole {
  return (DEFICIT_ROLES as readonly CardRole[]).includes(r);
}

function emptyDeckRoles(): DeckRoles {
  return { ramp: 0, draw: 0, removal: 0, wipe: 0, protection: 0, recursion: 0, tutor: 0 };
}

interface State {
  session: DeckSession | null;
  edhrec: EdhrecPage | null;
  loadingRecs: boolean;
  autoFilling: boolean;
  error: string | null;
  showMissing: boolean;
  rules: BuildRules;
}

const BASIC_BY_COLOR: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
  C: "Wastes",
};

const TYPE_ORDER = [
  "Commander",
  "Creatures",
  "Planeswalkers",
  "Instants",
  "Sorceries",
  "Artifacts",
  "Enchantments",
  "Battles",
  "Lands",
  "Other",
];

function inclusionPct(card: { num_decks?: number; potential_decks?: number }) {
  if (!card.num_decks || !card.potential_decks) return 0;
  return card.num_decks / card.potential_decks;
}

// Sort weight for cards Scryfall has no `edhrec_rank` for. Bigger than any
// real EDHREC rank (~30k at time of writing) so these land at the end of
// any "sort by popularity" pass, never at the top.
const RANK_UNRANKED = 1_000_000;

function classifyType(typeLine: string | undefined): string {
  if (!typeLine) return "Other";
  if (/Land/.test(typeLine)) return "Lands";
  if (/Creature/.test(typeLine)) return "Creatures";
  if (/Planeswalker/.test(typeLine)) return "Planeswalkers";
  if (/Instant/.test(typeLine)) return "Instants";
  if (/Sorcery/.test(typeLine)) return "Sorceries";
  if (/Battle/.test(typeLine)) return "Battles";
  if (/Artifact/.test(typeLine)) return "Artifacts";
  if (/Enchantment/.test(typeLine)) return "Enchantments";
  return "Other";
}

export const useDeckStore = defineStore("deck", {
  state: (): State => ({
    session: null,
    edhrec: null,
    loadingRecs: false,
    autoFilling: false,
    error: null,
    showMissing: true,
    rules: { ...DEFAULT_RULES },
  }),

  getters: {
    deckSize(s): number {
      return (s.session?.cards ?? []).reduce((n, c) => n + (c.quantity ?? 1), 0);
    },
    // How the current deck breaks down by source. Lets the UI show
    // "X EDHREC picks / Y filler" alongside the raw deck size.
    sourceBreakdown(s): { edhrec: number; filler: number; manual: number; commander: number } {
      const out = { edhrec: 0, filler: 0, manual: 0, commander: 0 };
      for (const c of s.session?.cards ?? []) {
        const qty = c.quantity ?? 1;
        const src = c.source ?? "manual";
        if (src in out) out[src as keyof typeof out] += qty;
      }
      return out;
    },
    deckNames(s): Set<string> {
      return new Set((s.session?.cards ?? []).map((c) => c.name.toLowerCase()));
    },
    stats(s): DeckStats {
      const collection = useCollectionStore();
      const stats: DeckStats = {
        total: 0,
        lands: 0,
        creatures: 0,
        instants: 0,
        sorceries: 0,
        artifacts: 0,
        enchantments: 0,
        planeswalkers: 0,
        battles: 0,
        other: 0,
        curve: [0, 0, 0, 0, 0, 0, 0, 0],
        pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        avgCmc: 0,
        roles: emptyDeckRoles(),
      };
      let cmcSum = 0;
      let cmcCount = 0;

      const landCategoryTags = new Set(["lands", "utilitylands"]);
      for (const c of s.session?.cards ?? []) {
        const qty = c.quantity ?? 1;
        stats.total += qty;
        const sc = collection.getScryfall(c.name) ?? null;
        let typeLine = sc?.type_line ?? "";
        if (!typeLine) {
          if (Object.values(BASIC_BY_COLOR).includes(c.name)) typeLine = "Basic Land";
          else if (landCategoryTags.has(c.category)) typeLine = "Land";
        }
        const group = classifyType(typeLine);
        const cmc = sc?.cmc;
        const identitySource = sc?.color_identity ?? [];

        switch (group) {
          case "Lands":
            stats.lands += qty;
            break;
          case "Creatures":
            stats.creatures += qty;
            break;
          case "Instants":
            stats.instants += qty;
            break;
          case "Sorceries":
            stats.sorceries += qty;
            break;
          case "Artifacts":
            stats.artifacts += qty;
            break;
          case "Enchantments":
            stats.enchantments += qty;
            break;
          case "Planeswalkers":
            stats.planeswalkers += qty;
            break;
          case "Battles":
            stats.battles += qty;
            break;
          default:
            stats.other += qty;
        }

        if (group !== "Lands" && cmc !== undefined) {
          const bucket = Math.min(7, Math.max(0, Math.floor(cmc)));
          stats.curve[bucket] = (stats.curve[bucket] ?? 0) + qty;
          cmcSum += cmc * qty;
          cmcCount += qty;
        }

        if (identitySource.length === 0) stats.pips.C += qty;
        else {
          for (const color of identitySource) {
            if (color in stats.pips) stats.pips[color as keyof typeof stats.pips] += qty;
          }
        }

        // Role detection runs on every non-commander non-land card with oracle
        // text. Lands are excluded — "destroy target" on a utility land is
        // still removal technically, but EDH convention counts roles against
        // the spellbook, not the mana base.
        if (c.category !== "commander" && group !== "Lands" && sc?.oracle_text) {
          const roles = detectRoles(sc.oracle_text, sc.type_line);
          for (const r of roles) stats.roles[r] += qty;
        }
      }
      stats.avgCmc = cmcCount > 0 ? cmcSum / cmcCount : 0;
      return stats;
    },
    deckByType(s): Array<{ group: string; cards: DeckCard[]; count: number }> {
      const collection = useCollectionStore();
      const landCategoryTags = new Set(["lands", "utilitylands"]);
      const groups = new Map<string, DeckCard[]>();
      for (const c of s.session?.cards ?? []) {
        let group: string;
        if (c.category === "commander") group = "Commander";
        else {
          const sc = collection.getScryfall(c.name);
          if (sc) group = classifyType(sc.type_line);
          else if (Object.values(BASIC_BY_COLOR).includes(c.name)) group = "Lands";
          else if (landCategoryTags.has(c.category)) group = "Lands";
          else group = "Other";
        }
        const list = groups.get(group) ?? [];
        list.push(c);
        groups.set(group, list);
      }
      const out: Array<{ group: string; cards: DeckCard[]; count: number }> = [];
      for (const name of TYPE_ORDER) {
        const list = groups.get(name);
        if (!list) continue;
        list.sort((a, b) => {
          const scA = collection.getScryfall(a.name);
          const scB = collection.getScryfall(b.name);
          const cmcA = scA?.cmc ?? 0;
          const cmcB = scB?.cmc ?? 0;
          if (cmcA !== cmcB) return cmcA - cmcB;
          return a.name.localeCompare(b.name);
        });
        out.push({
          group: name,
          cards: list,
          count: list.reduce((n, c) => n + (c.quantity ?? 1), 0),
        });
      }
      return out;
    },
    categories(state): CategorizedRecs[] {
      if (!state.edhrec) return [];
      const collection = useCollectionStore();
      const colorId = new Set(state.session?.colorIdentity ?? []);
      const lists = state.edhrec.container?.json_dict?.cardlists ?? [];

      return lists.map((list) => {
        const owned: EnrichedRec[] = [];
        const missing: EnrichedRec[] = [];
        for (const cv of list.cardviews) {
          const sc = collection.getScryfall(cv.name);
          if (sc && !(sc.color_identity ?? []).every((c) => colorId.has(c))) continue;
          const ownedCard = collection.getOwned(cv.name);
          const enriched: EnrichedRec = {
            ...cv,
            owned: !!ownedCard,
            ownedQuantity: ownedCard?.quantity,
            ownedScryfallId: ownedCard?.scryfallId,
          };
          if (ownedCard) owned.push(enriched);
          else missing.push(enriched);
        }
        const topOwnedIncl = Math.max(0, ...owned.map((c) => inclusionPct(c)));
        for (const m of missing) {
          const incl = inclusionPct(m);
          if (incl > 0.6) m.buyAdvice = "staple";
          else if (incl > 0.4 && topOwnedIncl < 0.15) m.buyAdvice = "high-synergy";
          else m.buyAdvice = "substitutable";
        }
        owned.sort((a, b) => inclusionPct(b) - inclusionPct(a));
        missing.sort((a, b) => inclusionPct(b) - inclusionPct(a));
        return { category: list.tag, header: list.header, owned, missing };
      });
    },
  },

  actions: {
    startSession(commander: { name: string; scryfallId?: string; scryfall?: ScryfallCard }) {
      const id = `${edhrecSlug(commander.name)}-${Date.now()}`;
      const now = new Date().toISOString();
      this.session = {
        id,
        name: commander.name,
        commanderName: commander.name,
        commanderScryfallId: commander.scryfallId,
        colorIdentity: commander.scryfall?.color_identity ?? [],
        cards: [
          {
            name: commander.name,
            scryfallId: commander.scryfallId,
            category: "commander",
            fromCollection: true,
            source: "commander",
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      this.edhrec = null;
    },

    loadSession(session: DeckSession) {
      this.session = { ...session };
      this.edhrec = null;
    },

    // Sessions saved before `resolveNames` patched collection cards in
    // place stored deck cards with `scryfallId=""`. Those tiles fall back
    // to `/cards/named?format=image`, which shares the `/cards/collection`
    // rate-limit bucket — 100 tiles can crawl.
    //
    // Running here on /build mount: resolve only the names that are
    // missing an ID (via the collection store, which dedupes against
    // scryfallByName automatically), patch the in-memory session, and
    // persist the fix so the next open is instant. Silent and one-time
    // per saved deck.
    async patchMissingScryfallIds(): Promise<void> {
      if (!this.session) return;
      const missing = this.session.cards.filter((c) => !c.scryfallId).map((c) => c.name);
      if (!missing.length) return;
      const collection = useCollectionStore();
      try {
        await collection.resolveNames(missing);
      } catch {
        return; // rate-limited / offline — tiles keep their fallback
      }
      let mutated = false;
      for (const card of this.session.cards) {
        if (card.scryfallId) continue;
        const sc = collection.scryfallByName.get(card.name.toLowerCase());
        if (sc?.id) {
          card.scryfallId = sc.id;
          mutated = true;
        }
      }
      if (mutated) await this.save();
    },

    async fetchRecs() {
      if (!this.session) return;
      if (this.loadingRecs) return;
      this.loadingRecs = true;
      this.error = null;
      try {
        const collection = useCollectionStore();
        const sc = collection.getScryfall(this.session.commanderName);
        const s = edhrecSlug(sc ? commanderFaceName(sc) : this.session.commanderName);
        const data = await getCommanderPage(s);
        if (!data) {
          throw new Error(`EDHREC has no page for "${this.session.commanderName}".`);
        }
        this.edhrec = data;
        this.rules = {
          ...DEFAULT_RULES,
          landTarget: Math.max(30, Math.min(42, data.land ?? DEFAULT_RULES.landTarget)),
        };
        // Deliberately NOT pre-warming Scryfall data for every EDHREC
        // recommendation here. That would fire 6–8 batched POSTs against
        // Scryfall on every /build mount with a cold cache and blow through
        // their rate limit (CORS-less 429s that we can't even read). The
        // only place this data is used is the unowned-recs color filter in
        // the `categories` getter — without it, the missing-recs panel
        // shows a few out-of-color cards, which is strictly cosmetic. All
        // autofill loops operate on OWNED cards, which are enriched once
        // at collection load time.
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loadingRecs = false;
      }
    },

    // Returns true if the card was added, false if it was already in the deck
    // (singleton-by-name, which matches EDH rules for non-basics and keeps the
    // autofill dedup cheap). Callers pass `source` so the UI can tell EDHREC
    // picks apart from `filler` picks. UI-triggered adds (recs panel, manual
    // search) default to "manual".
    addCard(card: {
      name: string;
      category: string;
      scryfallId?: string;
      fromCollection: boolean;
      inclusion?: number;
      source?: DeckCardSource;
    }): boolean {
      if (!this.session) return false;
      if (this.deckNames.has(card.name.toLowerCase())) return false;
      this.session.cards.push({ ...card, quantity: 1, source: card.source ?? "manual" });
      this.session.updatedAt = new Date().toISOString();
      return true;
    },

    removeCard(name: string) {
      if (!this.session) return;
      if (name.toLowerCase() === this.session.commanderName.toLowerCase()) return;
      this.session.cards = this.session.cards.filter(
        (c) => c.name.toLowerCase() !== name.toLowerCase(),
      );
      this.session.updatedAt = new Date().toISOString();
    },

    removeAllNonCommander() {
      if (!this.session) return;
      const cmdr = this.session.commanderName.toLowerCase();
      this.session.cards = this.session.cards.filter((c) => c.name.toLowerCase() === cmdr);
      this.session.updatedAt = new Date().toISOString();
    },

    autoFillFromCollection() {
      if (!this.session || !this.edhrec) return;
      if (this.autoFilling) return;
      this.autoFilling = true;
      try {
        this._autoFillImpl();
      } finally {
        this.autoFilling = false;
      }
    },

    _autoFillImpl() {
      if (!this.session || !this.edhrec) return;
      const collection = useCollectionStore();
      const colorId = new Set(this.session.colorIdentity);
      const DECK_TOTAL = 100;

      const edhrec = this.edhrec;
      const lists = edhrec.container?.json_dict?.cardlists ?? [];
      const landCategories = new Set(["lands", "utilitylands"]);

      // Local mirrors of session.cards state so hot paths don't hit the
      // expensive `stats` / `deckNames` / `deckSize` getters (each walks
      // every deck card). We maintain them alongside each `addCard` call.
      const localDeckNames = new Set<string>(this.session.cards.map((c) => c.name.toLowerCase()));
      let localSize = this.session.cards.reduce((n, c) => n + (c.quantity ?? 1), 0);
      let landsAdded = 0;
      for (const c of this.session.cards) {
        const sc = collection.getScryfall(c.name);
        if (sc?.type_line && /Land/.test(sc.type_line)) landsAdded += c.quantity ?? 1;
      }

      const rules = this.rules;
      // User-overridable land target. Falls through to EDHREC-derived default set
      // in fetchRecs.
      const LAND_TARGET = Math.max(20, Math.min(45, rules.landTarget));

      // Per-category targets derived from EDHREC's per-commander composition.
      // For commanders where EDHREC data is missing, fall back to a generic EDH shape.
      const artifactTotal = edhrec.artifact ?? 15;
      const targets: Record<string, number> = {
        creatures: edhrec.creature ?? 28,
        instants: edhrec.instant ?? 10,
        sorceries: edhrec.sorcery ?? 8,
        enchantments: edhrec.enchantment ?? 5,
        planeswalkers: edhrec.planeswalker ?? 2,
        battles: edhrec.battle ?? 0,
        manaartifacts: Math.round(artifactTotal * 0.6),
        utilityartifacts: Math.round(artifactTotal * 0.4),
        // Overlay categories (cards also counted in the type-bucket above). Small
        // targets bias the filler toward commander-specific signature picks.
        gamechangers: 2,
        highsynergycards: 3,
        topcards: 3,
      };

      // Role / curve bookkeeping — used both by the Step 3.5 deficit pass and
      // as tiebreakers in the Step 3b / Step 4 score function. Counts start
      // from whatever Step 3 put in the deck (the commander is skipped).
      const roleCounts: Record<CardRole, number> = {
        ramp: 0,
        draw: 0,
        removal: 0,
        wipe: 0,
        protection: 0,
        recursion: 0,
        tutor: 0,
      };
      // Memoize role detection per card name. The deficit pass (Step 3.5)
      // and the score tiebreaker both hit the same cards repeatedly —
      // running the oracle-text regex fresh every time is wasted work on
      // a 200-card recommendation pool.
      const rolesByName = new Map<string, Set<CardRole>>();
      const rolesOf = (name: string): Set<CardRole> => {
        const key = name.toLowerCase();
        const cached = rolesByName.get(key);
        if (cached) return cached;
        const sc = collection.getScryfall(name);
        const roles = sc?.oracle_text
          ? detectRoles(sc.oracle_text, sc.type_line)
          : new Set<CardRole>();
        rolesByName.set(key, roles);
        return roles;
      };
      const bumpRoles = (name: string) => {
        for (const r of rolesOf(name)) roleCounts[r] += 1;
      };
      // Curve target: EDHREC's per-commander mana_curve panel is a simple
      // {cmc: avgCount} histogram. When it's missing, we fall back to a flat
      // target so the bonus becomes a no-op.
      const curveTarget: Record<number, number> = {};
      if (edhrec.panels?.mana_curve) {
        for (const [k, v] of Object.entries(edhrec.panels.mana_curve)) {
          const bucket = Math.min(7, Number(k));
          curveTarget[bucket] = (curveTarget[bucket] ?? 0) + Number(v);
        }
      }
      const curveCounts: Record<number, number> = {};

      // Sort score: inclusion dominates (staples matter), synergy adds a bonus
      // for on-archetype cards, plus two tiebreakers — a small role bonus that
      // prefers cards covering still-missing roles, and a curve bonus that
      // prefers cards whose CMC bucket is below the commander's target curve.
      const synWeight = Math.max(0, Math.min(1, rules.synergyWeight));
      const score = (c: {
        name?: string;
        num_decks?: number;
        potential_decks?: number;
        synergy?: number;
      }) => {
        const incl = inclusionPct(c);
        const syn = Math.max(0, Math.min(1, c.synergy ?? 0));
        let base = incl + synWeight * syn;
        if (c.name) {
          for (const r of rolesOf(c.name)) {
            if (isDeficitRole(r) && roleCounts[r] < rules.roleTargets[r]) {
              base += 0.1;
            }
          }
          const sc = collection.getScryfall(c.name);
          if (sc?.cmc !== undefined) {
            const bucket = Math.min(7, Math.max(0, Math.floor(sc.cmc)));
            const deficit = (curveTarget[bucket] ?? 0) - (curveCounts[bucket] ?? 0);
            if (deficit > 0) base += 0.05;
          }
        }
        return base;
      };
      const bumpCurve = (name: string) => {
        const sc = collection.getScryfall(name);
        if (sc?.cmc === undefined) return;
        const bucket = Math.min(7, Math.max(0, Math.floor(sc.cmc)));
        curveCounts[bucket] = (curveCounts[bucket] ?? 0) + 1;
      };

      // Per-type caps derived from EDHREC's top-level composition. These bound
      // how many of each Scryfall type we'll include so the generic / overlay
      // EDHREC categories (gamechangers, topcards, highsynergycards — most of
      // which happen to be artifacts) can't flood a non-artifact deck with 25+
      // mana rocks and utility artifacts.
      const typeCaps: Record<string, number> = {
        Creatures: edhrec.creature ?? 28,
        Instants: edhrec.instant ?? 10,
        Sorceries: edhrec.sorcery ?? 8,
        Artifacts: edhrec.artifact ?? 15,
        Enchantments: edhrec.enchantment ?? 5,
        Planeswalkers: edhrec.planeswalker ?? 2,
        Battles: edhrec.battle ?? 0,
      };
      const typeCounts: Record<string, number> = {};
      const typeOf = (name: string): string => {
        const sc = collection.getScryfall(name);
        return sc?.type_line ? classifyType(sc.type_line) : "Other";
      };
      // Seed counts from whatever is already in the deck (usually just the
      // commander after startSession, but could include an imported deck).
      for (const c of this.session.cards) {
        if (c.category === "commander") continue;
        const t = typeOf(c.name);
        typeCounts[t] = (typeCounts[t] ?? 0) + (c.quantity ?? 1);
        for (const r of rolesOf(c.name)) roleCounts[r] += c.quantity ?? 1;
        const sc = collection.getScryfall(c.name);
        if (sc?.cmc !== undefined && !/Land/.test(sc.type_line ?? "")) {
          const bucket = Math.min(7, Math.max(0, Math.floor(sc.cmc)));
          curveCounts[bucket] = (curveCounts[bucket] ?? 0) + (c.quantity ?? 1);
        }
      }
      const wouldExceedTypeCap = (name: string): boolean => {
        const t = typeOf(name);
        const cap = typeCaps[t];
        if (cap === undefined) return false;
        return (typeCounts[t] ?? 0) >= cap;
      };
      const bumpTypeCount = (name: string): void => {
        const t = typeOf(name);
        typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      };

      // Step 1: Add EDHREC non-basic lands (owned, all of them up to LAND_TARGET)
      for (const list of lists) {
        if (!landCategories.has(list.tag)) continue;
        const candidates = list.cardviews
          .filter((c) => {
            if (localDeckNames.has(c.name.toLowerCase())) return false;
            return collection.isOwned(c.name);
          })
          .sort((a, b) => score(b) - score(a));
        for (const c of candidates) {
          if (landsAdded >= LAND_TARGET) break;
          const ownedCard = collection.getOwned(c.name);
          const added = this.addCard({
            name: c.name,
            category: list.tag,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(c),
            source: "edhrec",
          });
          if (!added) continue;
          localDeckNames.add(c.name.toLowerCase());
          localSize += 1;
          landsAdded += 1;
        }
      }

      // Step 2: Reserve the full LAND_TARGET regardless of what's owned. Any gap will
      // be filled later by unowned EDHREC lands and basics (marked as missing). Without
      // this reservation, a small basic-land collection causes the non-land budget to
      // balloon and crowd out the lands we still need to add.
      const landsToReserve = Math.max(0, LAND_TARGET - landsAdded);
      const nonLandBudget = DECK_TOTAL - localSize - landsToReserve;

      // A card is castable in this deck if every color in its identity is in the
      // commander's identity AND it doesn't require colorless {C} pips (which most
      // decks can't produce). Colorless decks skip the {C} check.
      const isColorlessCommander = colorId.size === 0;
      const maxCmc = Math.max(0, Math.min(20, rules.maxCmc));
      const passesCmc = (sc: ScryfallCard | undefined): boolean => {
        if (!sc || sc.cmc === undefined) return true;
        if (/Land/.test(sc.type_line)) return true;
        return sc.cmc <= maxCmc;
      };
      const isCastable = (sc: ScryfallCard | undefined): boolean => {
        if (!sc) return true;
        if (!(sc.color_identity ?? []).every((x) => colorId.has(x))) return false;
        if (!isColorlessCommander && sc.mana_cost && /\{C\}/.test(sc.mana_cost)) return false;
        if (!passesCmc(sc)) return false;
        return true;
      };
      const isEdhrecCastable = (c: { name: string }): boolean => {
        const sc = collection.getScryfall(c.name);
        if (!sc) return true;
        if (!(sc.color_identity ?? []).every((x) => colorId.has(x))) return false;
        if (!isColorlessCommander && sc.mana_cost && /\{C\}/.test(sc.mana_cost)) return false;
        if (!passesCmc(sc)) return false;
        return true;
      };

      // Step 3: Fill non-land slots from EDHREC category targets
      let nonLandAdded = 0;
      for (const list of lists) {
        if (landCategories.has(list.tag)) continue;
        const target = targets[list.tag] ?? 0;
        if (target === 0) continue;
        const candidates = list.cardviews
          .filter((c) => {
            if (localDeckNames.has(c.name.toLowerCase())) return false;
            if (!isEdhrecCastable(c)) return false;
            return collection.isOwned(c.name);
          })
          .sort((a, b) => score(b) - score(a));

        let addedThisCat = 0;
        for (const c of candidates) {
          if (addedThisCat >= target) break;
          if (nonLandAdded >= nonLandBudget) break;
          const ownedCard = collection.getOwned(c.name);
          const added = this.addCard({
            name: c.name,
            category: list.tag,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(c),
            source: "edhrec",
          });
          if (!added) continue;
          localDeckNames.add(c.name.toLowerCase());
          localSize += 1;
          bumpTypeCount(c.name);
          bumpRoles(c.name);
          bumpCurve(c.name);
          addedThisCat++;
          nonLandAdded++;
        }
        if (nonLandAdded >= nonLandBudget) break;
      }

      // Step 3.5: Role-deficit fill. After the per-type EDHREC targets have
      // established the deck's character, make sure the functional baseline is
      // there — ramp, draw, removal, wipes — before the generic spill runs.
      // Without this a Juri deck would finish as "right shape, unplayable
      // because it only has 3 ramp spells and no board wipe".
      for (const role of DEFICIT_ROLES) {
        if (nonLandAdded >= nonLandBudget) break;
        const target = rules.roleTargets[role];
        let deficit = target - roleCounts[role];
        if (deficit <= 0) continue;

        const candidates: EdhrecCard[] = [];
        const seen = new Set<string>();
        for (const list of lists) {
          if (landCategories.has(list.tag)) continue;
          for (const c of list.cardviews) {
            const key = c.name.toLowerCase();
            if (seen.has(key)) continue;
            if (localDeckNames.has(key)) continue;
            if (!isEdhrecCastable(c)) continue;
            if (!collection.isOwned(c.name)) continue;
            if (wouldExceedTypeCap(c.name)) continue;
            if (!rolesOf(c.name).has(role)) continue;
            seen.add(key);
            candidates.push(c);
          }
        }
        candidates.sort((a, b) => score(b) - score(a));

        for (const c of candidates) {
          if (deficit <= 0 || nonLandAdded >= nonLandBudget) break;
          const ownedCard = collection.getOwned(c.name);
          const added = this.addCard({
            name: c.name,
            category: `role:${role}`,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(c),
            source: "edhrec",
          });
          if (!added) continue;
          localDeckNames.add(c.name.toLowerCase());
          localSize += 1;
          bumpTypeCount(c.name);
          bumpRoles(c.name);
          bumpCurve(c.name);
          deficit--;
          nonLandAdded++;
        }
      }

      // Step 3b: Spill any remaining owned EDHREC-recommended cards past per-category
      // targets. Cards suggested for this commander are always preferred over cards
      // that just have a good global edhrec_rank. Respects per-type caps so overlay
      // tags (gamechangers / topcards / highsynergy — often dominated by artifacts)
      // don't push a single type past its EDHREC-averaged count.
      if (nonLandAdded < nonLandBudget) {
        const spill: Array<{ cv: EdhrecCard; tag: string }> = [];
        for (const list of lists) {
          if (landCategories.has(list.tag)) continue;
          for (const c of list.cardviews) {
            if (localDeckNames.has(c.name.toLowerCase())) continue;
            if (!isEdhrecCastable(c)) continue;
            if (!collection.isOwned(c.name)) continue;
            spill.push({ cv: c, tag: list.tag });
          }
        }
        spill.sort((a, b) => score(b.cv) - score(a.cv));
        const seen = new Set<string>();
        for (const { cv, tag } of spill) {
          const key = cv.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          if (nonLandAdded >= nonLandBudget) break;
          if (localDeckNames.has(key)) continue;
          if (wouldExceedTypeCap(cv.name)) continue;
          const ownedCard = collection.getOwned(cv.name);
          const added = this.addCard({
            name: cv.name,
            category: tag,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(cv),
            source: "edhrec",
          });
          if (!added) continue;
          localDeckNames.add(key);
          localSize += 1;
          bumpTypeCount(cv.name);
          bumpRoles(cv.name);
          bumpCurve(cv.name);
          nonLandAdded++;
        }
      }

      // Step 4: If non-land budget not exhausted, fill with any owned non-land card
      // by edhrec_rank. Non-basic lands outside EDHREC are NEVER added. Type caps
      // apply here too — without them, Step 4 sorts by global edhrec_rank which
      // puts Sol Ring / Arcane Signet / other mana rocks at the top and would
      // flood the deck with artifacts regardless of the commander's archetype.
      const remainingNonLand = (): Array<{
        card: (typeof collection.cards)[number];
        sc: ScryfallCard;
      }> => {
        const out = [];
        for (const c of collection.cards) {
          if (localDeckNames.has(c.name.toLowerCase())) continue;
          const sc = collection.getScryfall(c.name);
          if (!sc) continue;
          if (/Land/.test(sc.type_line)) continue;
          if (!isCastable(sc)) continue;
          out.push({ card: c, sc });
        }
        out.sort(
          (a, b) => (a.sc.edhrec_rank ?? RANK_UNRANKED) - (b.sc.edhrec_rank ?? RANK_UNRANKED),
        );
        return out;
      };
      if (nonLandAdded < nonLandBudget) {
        for (const { card, sc } of remainingNonLand()) {
          if (nonLandAdded >= nonLandBudget) break;
          if (wouldExceedTypeCap(card.name)) continue;
          const added = this.addCard({
            name: card.name,
            category: classifyType(sc.type_line).toLowerCase(),
            scryfallId: card.scryfallId,
            fromCollection: true,
            source: "filler",
          });
          if (!added) continue;
          localDeckNames.add(card.name.toLowerCase());
          localSize += 1;
          bumpTypeCount(card.name);
          bumpRoles(card.name);
          bumpCurve(card.name);
          nonLandAdded++;
        }
      }

      // Step 4.5: If the per-type caps summed to less than the non-land budget
      // (common when EDHREC's averages for this commander are tight), fall
      // through without the cap so the deck still hits 99 non-commander slots.
      if (nonLandAdded < nonLandBudget) {
        for (const { card, sc } of remainingNonLand()) {
          if (nonLandAdded >= nonLandBudget) break;
          const added = this.addCard({
            name: card.name,
            category: classifyType(sc.type_line).toLowerCase(),
            scryfallId: card.scryfallId,
            fromCollection: true,
            source: "filler",
          });
          if (!added) continue;
          localDeckNames.add(card.name.toLowerCase());
          localSize += 1;
          bumpTypeCount(card.name);
          bumpRoles(card.name);
          bumpCurve(card.name);
          nonLandAdded++;
        }
      }

      // Step 5: Pad with owned basic lands up to LAND_TARGET (or until owned runs out)
      this.padOwnedBasicLands(LAND_TARGET);

      if (rules.fillMissing) {
        // Step 6: If still short on lands, fall back to unowned EDHREC non-basic
        // lands (marked as missing). `padOwnedBasicLands` above may have stacked
        // basics into a single entry with quantity > 1, so we resync from truth
        // once here (cheap, <100 cards) and then track incrementally.
        let currentLands = this.session.cards.reduce((n, c) => {
          const sc = collection.getScryfall(c.name);
          const isLand =
            (sc?.type_line && /Land/.test(sc.type_line)) ||
            c.category === "lands" ||
            c.category === "utilitylands";
          return isLand ? n + (c.quantity ?? 1) : n;
        }, 0);

        for (const list of lists) {
          if (!landCategories.has(list.tag)) continue;
          if (currentLands >= LAND_TARGET) break;
          const candidates = list.cardviews
            .filter((c) => {
              if (localDeckNames.has(c.name.toLowerCase())) return false;
              if (!isEdhrecCastable(c)) return false;
              return !collection.isOwned(c.name);
            })
            .sort((a, b) => score(b) - score(a));
          for (const c of candidates) {
            if (currentLands >= LAND_TARGET) break;
            // Carry Scryfall's ID through from the EDHREC cardview (it's
            // the same card, just unowned) so the "missing to buy" tile
            // renders via the CDN URL rather than the `/cards/named`
            // fallback.
            const scId = c.id ?? collection.getScryfall(c.name)?.id;
            const added = this.addCard({
              name: c.name,
              category: list.tag,
              scryfallId: scId,
              fromCollection: false,
              inclusion: inclusionPct(c),
              source: "edhrec",
            });
            if (!added) continue;
            localDeckNames.add(c.name.toLowerCase());
            currentLands += 1;
          }
        }

        // Step 7: If still short, top off with basic lands regardless of ownership
        // (marked as missing for any beyond what the collection holds).
        this.padBasicLands(LAND_TARGET);
      }
    },

    setRules(patch: Partial<BuildRules>) {
      this.rules = { ...this.rules, ...patch };
    },

    rebuildDeck() {
      if (!this.session || !this.edhrec) return;
      this.removeAllNonCommander();
      this.autoFillFromCollection();
    },

    resetRulesFromEdhrec() {
      this.rules = {
        ...DEFAULT_RULES,
        landTarget: Math.max(30, Math.min(42, this.edhrec?.land ?? DEFAULT_RULES.landTarget)),
      };
    },

    padBasicLands(landTarget: number) {
      if (!this.session) return;
      const collection = useCollectionStore();
      let needed = landTarget - this.stats.lands;
      if (needed <= 0) return;

      const colors = this.session.colorIdentity.length ? [...this.session.colorIdentity] : ["C"];
      const perColor = Math.ceil(needed / colors.length);

      for (const color of colors) {
        if (needed <= 0) break;
        const name = BASIC_BY_COLOR[color];
        if (!name) continue;
        const wanted = Math.min(perColor, needed);
        if (wanted <= 0) continue;

        const owned = collection.getOwned(name);
        const ownedQty = owned?.quantity ?? 0;
        const existing = this.session.cards.find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        );
        const existingQty = existing?.quantity ?? 0;
        const newTotal = existingQty + wanted;
        const fullyOwned = ownedQty >= newTotal;

        if (existing) {
          existing.quantity = newTotal;
          existing.fromCollection = fullyOwned;
        } else {
          this.session.cards.push({
            name,
            scryfallId: owned?.scryfallId,
            category: "lands",
            fromCollection: fullyOwned,
            quantity: wanted,
            source: "filler",
          });
        }
        needed -= wanted;
      }
      this.session.updatedAt = new Date().toISOString();
    },

    padOwnedBasicLands(landTarget: number) {
      if (!this.session) return;
      const collection = useCollectionStore();
      const currentLands = this.stats.lands;
      let needed = landTarget - currentLands;
      if (needed <= 0) return;

      const colors = this.session.colorIdentity.length ? [...this.session.colorIdentity] : ["C"];

      // Target basics per color, proportional to color identity size
      const perColor = Math.ceil(needed / colors.length);
      for (const color of colors) {
        if (needed <= 0) break;
        const name = BASIC_BY_COLOR[color];
        if (!name) continue;
        const owned = collection.getOwned(name);
        if (!owned || owned.quantity <= 0) continue;
        const wanted = Math.min(perColor, needed, owned.quantity);
        if (wanted <= 0) continue;

        const existing = this.session.cards.find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        );
        if (existing) {
          existing.quantity = (existing.quantity ?? 1) + wanted;
        } else {
          this.session.cards.push({
            name,
            scryfallId: owned.scryfallId,
            category: "lands",
            fromCollection: true,
            quantity: wanted,
            source: "filler",
          });
        }
        needed -= wanted;
      }
      this.session.updatedAt = new Date().toISOString();
    },

    renameSession(name: string) {
      if (!this.session) return;
      this.session.name = name;
      this.session.updatedAt = new Date().toISOString();
    },

    async save() {
      if (!this.session) return;
      const sessions = useSessionsStore();
      await sessions.upsert({ ...this.session });
    },

    exportText(): string {
      if (!this.session) return "";
      const lines: string[] = [];
      lines.push(`// ${this.session.name}`);
      lines.push(`// Commander: ${this.session.commanderName}`);
      lines.push(`// Total: ${this.deckSize}/100`);
      lines.push("");
      lines.push(`1 ${this.session.commanderName}`);
      lines.push("");
      const byGroup = this.deckByType;
      for (const grp of byGroup) {
        if (grp.group === "Commander") continue;
        lines.push(`// ${grp.group} (${grp.count})`);
        for (const c of grp.cards) {
          lines.push(`${c.quantity ?? 1} ${c.name}`);
        }
        lines.push("");
      }
      return lines.join("\n");
    },
  },
});
