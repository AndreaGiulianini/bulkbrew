import { defineStore } from "pinia";
import { edhrecSlug } from "~/utils/slug";
import type {
  CategorizedRecs,
  DeckCard,
  DeckSession,
  DeckStats,
  EdhrecCard,
  EdhrecPage,
  EnrichedRec,
  ScryfallCard,
} from "~~/shared/types";
import { useCollectionStore } from "./collection";

export interface BuildRules {
  landTarget: number;
  synergyWeight: number;
  fillMissing: boolean;
  maxCmc: number;
}

const DEFAULT_RULES: BuildRules = {
  landTarget: 36,
  synergyWeight: 0.5,
  fillMissing: true,
  maxCmc: 10,
};

interface State {
  session: DeckSession | null;
  edhrec: EdhrecPage | null;
  loadingRecs: boolean;
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
    error: null,
    showMissing: true,
    rules: { ...DEFAULT_RULES },
  }),

  getters: {
    deckSize(s): number {
      return (s.session?.cards ?? []).reduce((n, c) => n + (c.quantity ?? 1), 0);
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
          if (sc?.color_identity && !sc.color_identity.every((c) => colorId.has(c))) continue;
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

    async fetchRecs() {
      if (!this.session) return;
      this.loadingRecs = true;
      this.error = null;
      try {
        const s = edhrecSlug(this.session.commanderName);
        const data = await $fetch<EdhrecPage>(`/api/edhrec/commander/${s}`);
        this.edhrec = data;
        this.rules = {
          ...DEFAULT_RULES,
          landTarget: Math.max(30, Math.min(42, data.land ?? DEFAULT_RULES.landTarget)),
        };
        const names = new Set<string>();
        for (const list of data.container?.json_dict?.cardlists ?? []) {
          for (const cv of list.cardviews) names.add(cv.name);
        }
        const collection = useCollectionStore();
        await collection.enrichNames(Array.from(names));
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loadingRecs = false;
      }
    },

    // Returns true if the card was added, false if it was already in the deck
    // (singleton-by-name, which matches EDH rules for non-basics and keeps the
    // autofill dedup cheap).
    addCard(card: {
      name: string;
      category: string;
      scryfallId?: string;
      fromCollection: boolean;
      inclusion?: number;
    }): boolean {
      if (!this.session) return false;
      if (this.deckNames.has(card.name.toLowerCase())) return false;
      this.session.cards.push({ ...card, quantity: 1 });
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
      const collection = useCollectionStore();
      const colorId = new Set(this.session.colorIdentity);
      const DECK_TOTAL = 100;

      const edhrec = this.edhrec;
      const lists = edhrec.container?.json_dict?.cardlists ?? [];
      const landCategories = new Set(["lands", "utilitylands"]);

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

      // Sort score: inclusion dominates (staples matter), synergy adds a bonus for
      // on-archetype cards. The synergy weight is user-tunable via build rules.
      const synWeight = Math.max(0, Math.min(1, rules.synergyWeight));
      const score = (c: { num_decks?: number; potential_decks?: number; synergy?: number }) => {
        const incl = inclusionPct(c);
        const syn = Math.max(0, Math.min(1, c.synergy ?? 0));
        return incl + synWeight * syn;
      };

      // Step 1: Add EDHREC non-basic lands (owned, all of them up to LAND_TARGET)
      for (const list of lists) {
        if (!landCategories.has(list.tag)) continue;
        const candidates = list.cardviews
          .filter((c) => {
            if (this.deckNames.has(c.name.toLowerCase())) return false;
            return collection.isOwned(c.name);
          })
          .sort((a, b) => score(b) - score(a));
        for (const c of candidates) {
          if (this.stats.lands >= LAND_TARGET) break;
          const ownedCard = collection.getOwned(c.name);
          this.addCard({
            name: c.name,
            category: list.tag,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(c),
          });
        }
      }

      // Step 2: Reserve the full LAND_TARGET regardless of what's owned. Any gap will
      // be filled later by unowned EDHREC lands and basics (marked as missing). Without
      // this reservation, a small basic-land collection causes the non-land budget to
      // balloon and crowd out the lands we still need to add.
      const landsToReserve = Math.max(0, LAND_TARGET - this.stats.lands);
      const nonLandBudget = DECK_TOTAL - this.deckSize - landsToReserve;

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
            if (this.deckNames.has(c.name.toLowerCase())) return false;
            if (!isEdhrecCastable(c)) return false;
            return collection.isOwned(c.name);
          })
          .sort((a, b) => score(b) - score(a));

        let addedThisCat = 0;
        for (const c of candidates) {
          if (addedThisCat >= target) break;
          if (nonLandAdded >= nonLandBudget) break;
          const ownedCard = collection.getOwned(c.name);
          this.addCard({
            name: c.name,
            category: list.tag,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(c),
          });
          addedThisCat++;
          nonLandAdded++;
        }
        if (nonLandAdded >= nonLandBudget) break;
      }

      // Step 3b: Spill any remaining owned EDHREC-recommended cards past per-category
      // targets. Cards suggested for this commander are always preferred over cards
      // that just have a good global edhrec_rank.
      if (nonLandAdded < nonLandBudget) {
        const spill: Array<{ cv: EdhrecCard; tag: string }> = [];
        for (const list of lists) {
          if (landCategories.has(list.tag)) continue;
          for (const c of list.cardviews) {
            if (this.deckNames.has(c.name.toLowerCase())) continue;
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
          if (this.deckNames.has(key)) continue;
          const ownedCard = collection.getOwned(cv.name);
          this.addCard({
            name: cv.name,
            category: tag,
            scryfallId: ownedCard?.scryfallId,
            fromCollection: true,
            inclusion: inclusionPct(cv),
          });
          nonLandAdded++;
        }
      }

      // Step 4: If non-land budget not exhausted, fill with any owned non-land card
      // by edhrec_rank. Non-basic lands outside EDHREC are NEVER added.
      if (nonLandAdded < nonLandBudget) {
        const remaining: Array<{ card: (typeof collection.cards)[number]; sc: ScryfallCard }> = [];
        for (const c of collection.cards) {
          if (this.deckNames.has(c.name.toLowerCase())) continue;
          const sc = collection.getScryfall(c.name);
          if (!sc) continue;
          if (/Land/.test(sc.type_line)) continue;
          if (!isCastable(sc)) continue;
          remaining.push({ card: c, sc });
        }
        remaining.sort((a, b) => (a.sc.edhrec_rank ?? 99999) - (b.sc.edhrec_rank ?? 99999));
        for (const { card, sc } of remaining) {
          if (nonLandAdded >= nonLandBudget) break;
          this.addCard({
            name: card.name,
            category: classifyType(sc.type_line).toLowerCase(),
            scryfallId: card.scryfallId,
            fromCollection: true,
          });
          nonLandAdded++;
        }
      }

      // Step 5: Pad with owned basic lands up to LAND_TARGET (or until owned runs out)
      this.padOwnedBasicLands(LAND_TARGET);

      if (rules.fillMissing) {
        // Step 6: If still short on lands, fall back to unowned EDHREC non-basic lands
        // (marked as missing) so the deck remains playable.
        for (const list of lists) {
          if (!landCategories.has(list.tag)) continue;
          if (this.stats.lands >= LAND_TARGET) break;
          const candidates = list.cardviews
            .filter((c) => {
              if (this.deckNames.has(c.name.toLowerCase())) return false;
              if (!isEdhrecCastable(c)) return false;
              return !collection.isOwned(c.name);
            })
            .sort((a, b) => score(b) - score(a));
          for (const c of candidates) {
            if (this.stats.lands >= LAND_TARGET) break;
            this.addCard({
              name: c.name,
              category: list.tag,
              fromCollection: false,
              inclusion: inclusionPct(c),
            });
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
      await $fetch("/api/sessions", {
        method: "POST",
        body: this.session,
      });
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
