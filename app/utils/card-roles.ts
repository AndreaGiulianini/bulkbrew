// Maps a card's Scryfall oracle_text (+ type_line) to the functional EDH roles
// it fulfills. Pure + synchronous — no network, no state. Multiple roles are
// possible per card (e.g. Kodama's Reach = ramp; Beast Within = removal).
//
// Intentional limitations: heuristic only. We'd rather mis-identify a
// borderline card than hardcode a name list. If this becomes load-bearing for
// a lot of users, graduating to EDHREC's hypothetical role tags or a curated
// list is the next step — but today neither is available to us.

export type CardRole = "ramp" | "draw" | "removal" | "wipe" | "protection" | "recursion" | "tutor";

export const CARD_ROLES: readonly CardRole[] = [
  "ramp",
  "draw",
  "removal",
  "wipe",
  "protection",
  "recursion",
  "tutor",
];

const ADDS_MANA = /add (?:\{[wubrgc/0-9x]+\}|one mana|two mana|three mana)/i;
const TUTOR_LAND =
  /search your library for (?:up to \w+ )?(?:a |an |\w+ )?(?:basic )?(?:land|plains|island|swamp|mountain|forest)/i;
const PUT_LAND_ONTO_BATTLEFIELD = /put (?:a|up to \w+|two|three|\d+) lands? onto the battlefield/i;
const DRAW_CARDS = /draw (?:a|an|one|two|three|four|five|six|seven|\d+|x) cards?\b/i;
const DRAW_NEGATED = /(?:can't|cannot|doesn't|does not|instead of) draw/i;
// `destroy target (<adjective> )?<noun>` — the optional adjective catches
// cards like Doom Blade ("nonblack creature"), Ravenous Chupacabra ("nontoken
// creature"), or Vindicate ("permanent"). We stop matching at -s so plurals
// (which describe area-of-effect, not single-target) are caught by the wipe
// regex instead.
const DESTROY_EXILE_TARGET =
  /(?:destroy|exile) target (?:[a-z-]+ )?(?:creature|permanent|artifact|enchantment|planeswalker|battle|land)(?![a-z])/i;
const BOUNCE_TARGET =
  /return target (?:creature|nonland permanent|permanent|artifact|enchantment|planeswalker) (?:card )?to its owner's hand/i;
const COUNTERSPELL = /counter target (?:spell|creature spell|noncreature spell|ability)/i;
const WIPE_DESTROY_OR_EXILE =
  /(?:destroy|exile) all (?:creatures|nonland permanents|permanents|nontoken creatures|creatures and planeswalkers)/i;
const WIPE_DAMAGE =
  /(?:deals?|deal) (?:\d+|x) damage to each (?:creature|other creature|creature and each planeswalker|creature your opponents control)/i;
const WIPE_SACRIFICE = /each player sacrifices/i;
const PROTECTION_STATIC = /(?:\bindestructible\b|\bhexproof\b|\bshroud\b|protection from)/i;
const RECURSION_GRAVEYARD_TO_HAND =
  /return (?:target |up to \w+ target )?(?:creature|permanent|card|artifact|enchantment|instant|sorcery|planeswalker).* from your graveyard to (?:your hand|the battlefield)/i;
const TUTOR_NONLAND =
  /search your library for (?:a|an|up to \w+ |\w+) (?:card|creature card|artifact card|enchantment card|instant card|sorcery card|planeswalker card)/i;

function isCreatureType(typeLine: string | undefined): boolean {
  return !!typeLine && /Creature/.test(typeLine);
}

export function detectRoles(
  oracleText: string | undefined,
  typeLine: string | undefined,
): Set<CardRole> {
  const roles = new Set<CardRole>();
  const text = oracleText ?? "";
  if (!text) return roles;

  // Ramp — land tutors, put-land-onto-battlefield, or mana-adding non-creatures
  // (creatures that add mana are dorks which we also count as ramp).
  if (
    TUTOR_LAND.test(text) ||
    PUT_LAND_ONTO_BATTLEFIELD.test(text) ||
    (ADDS_MANA.test(text) &&
      (isCreatureType(typeLine) || /Artifact|Enchantment|Instant|Sorcery/.test(typeLine ?? "")))
  ) {
    roles.add("ramp");
  }

  // Draw — non-negated draw effect.
  if (DRAW_CARDS.test(text) && !DRAW_NEGATED.test(text)) {
    roles.add("draw");
  }

  // Removal — target destroy/exile/counter/bounce.
  if (DESTROY_EXILE_TARGET.test(text) || BOUNCE_TARGET.test(text) || COUNTERSPELL.test(text)) {
    roles.add("removal");
  }

  // Wipe — mass destroy/exile/damage/sacrifice.
  if (WIPE_DESTROY_OR_EXILE.test(text) || WIPE_DAMAGE.test(text) || WIPE_SACRIFICE.test(text)) {
    roles.add("wipe");
  }

  // Protection — granted keywords or instant-speed safety.
  if (PROTECTION_STATIC.test(text)) {
    roles.add("protection");
  }

  // Recursion — pull from graveyard.
  if (RECURSION_GRAVEYARD_TO_HAND.test(text)) {
    roles.add("recursion");
  }

  // Tutor — non-land library search. Land tutors are counted only as ramp.
  if (TUTOR_NONLAND.test(text) && !TUTOR_LAND.test(text)) {
    roles.add("tutor");
  }

  return roles;
}
