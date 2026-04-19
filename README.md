# BulkBrew

**Turn your bulk cards into Commander decks.**

BulkBrew reads your MTG card collection and builds playable EDH decks around
any commander you own. It uses [EDHREC](https://edhrec.com)'s per-commander
averages to get the mana base, curve and type mix right, a functional-role
pass to guarantee ramp / draw / removal / wipes, and
[Scryfall](https://scryfall.com) to resolve every card. Cards you don't own
are flagged as missing so you know exactly what to buy.

---

## Features

- **Collection import** — ManaBox CSV, Moxfield collection export, or any
  plain-text list like `1 Sol Ring`. Names are resolved against Scryfall;
  anything it couldn't match is surfaced to you, not silently dropped.
- **Commander picker** — every legendary creature in your collection, ordered
  by **live** EDHREC commander rank (batched + cached server-side).
- **Auto-fill deckbuilder** — picks cards according to:
  - EDHREC's per-commander type composition (creatures, instants, artifacts…)
  - A **per-type cap** so overlay categories (game changers, top cards, high
    synergy) can't flood the deck with mana rocks.
  - **Inclusion × synergy** blended score — user-tunable synergy weight.
  - **Role-deficit pass** — guarantees at least 8 ramp, 8 draw, 5 removal and
    2 wipes whenever your collection can cover them.
  - **Curve awareness** — a small bonus nudges picks toward EDHREC's target
    mana curve for that commander.
  - Respects castability (color identity, no `{C}` pips in a non-colorless
    deck) and an adjustable **max CMC**.
- **Build rules panel** — live sliders/toggles for land target, synergy
  weight, max CMC, and fill-gaps vs. owned-only. Changes to the deck-source
  toggle rebuild the deck immediately.
- **Deck view** — grouped by type, with per-card borders marking *owned*
  (emerald) vs *missing* (rose). Hover any card for a larger preview.
- **Recommendations tab** — collapsible EDHREC categories, per-card
  *owned/missing* and *in-deck* badges, purchase advice (staple / high-synergy
  / substitutable) for cards you don't own.
- **Stats** — deck-size progress ring, type counts, functional-roles strip,
  mana curve histogram, color-identity source bar.
- **Export** — one-click `📋 Copy decklist` (Moxfield / MTGO / Arena
  compatible text format).
- **Sessions** — auto-saved to disk, reloadable from the homepage.

## Stack

- **[Nuxt 3](https://nuxt.com)** + **Vue 3** (Options API + `<script setup>`)
- **[Pinia](https://pinia.vuejs.org)** for state
- **[Tailwind CSS](https://tailwindcss.com)** with a custom muted-teal /
  tangerine / shadow-grey palette
- **[Cinzel](https://fonts.google.com/specimen/Cinzel)** (Google Fonts) for
  the wordmark
- **[Biome](https://biomejs.dev)** for lint + format

**External data**: Scryfall (card data) and EDHREC (commander recommendations
and themes), called directly from the browser and cached in IndexedDB for
1 week / 1 day respectively.

**Hosting**: pure static site. Deployed to Vercel's hobby tier (free) — no
serverless functions, no server runtime. Your collection, sessions and the
external-API cache all live in your browser (IndexedDB).

## Quick start

Requirements: Node ≥ 20, `npm`.

```bash
npm install
npm run dev
```

Opens on `http://localhost:3000`. On first load the collection is empty —
import yours from the homepage.

Build for production (Vercel-compatible static output):

```bash
npm run build
# Emits .vercel/output/static/ — pure static files, no functions.
```

Preview the built bundle locally with any static server, e.g.:

```bash
npx serve .vercel/output/static
```

## Deployment

The repo deploys to Vercel with zero config:

1. Connect this GitHub repo in the Vercel dashboard.
2. Vercel auto-detects Nuxt, runs `npm run build`, and serves
   `.vercel/output/static/` from the CDN.
3. No environment variables are required.

Because there are no serverless functions or server runtime, the project
fits inside Vercel's **hobby (free) tier** indefinitely, even under heavy
traffic — only CDN bandwidth counts, and the bundle is small.

## Configuration

There is no runtime config — everything runs in the browser. The only
persisted state lives in IndexedDB on your device.

## How the auto-fill works

1. Add owned EDHREC-recommended lands up to the land target.
2. Reserve the remaining land slots regardless of what's owned (missing basics
   are filled later if "Fill gaps" is on).
3. Fill each EDHREC non-land category (`creatures`, `instants`, `sorceries`,
   `manaartifacts`, `utilityartifacts`, `enchantments`, `planeswalkers`,
   `gamechangers`, `highsynergycards`, `topcards`) up to its per-commander
   target, sorted by `inclusion + synergyWeight × synergy`.
3. **(3.5)** Role-deficit pass: for ramp / draw / removal / wipes in order,
   pull EDHREC-recommended owned cards that satisfy the role until the
   target (8/8/5/2) is met, respecting existing type caps.
4. **(3b)** Spill any remaining owned EDHREC cards past per-category targets,
   still respecting per-type caps.
5. **(4)** Generic fallback: any owned non-land card sorted by global
   `edhrec_rank`, respecting type caps.
6. **(5)** Pad with owned basic lands up to the land target.
7. **(6–7)** If "Fill gaps" is on: top off with missing EDHREC non-basic
   lands and missing basics (marked as *missing*, not owned).

Functional-role detection is heuristic — regex over Scryfall oracle text in
`app/utils/card-roles.ts`. Sol Ring, Cultivate etc → ramp. Swords to
Plowshares, Doom Blade → removal. Blasphemous Act, Farewell → wipe.

## Known limitations

- **Commander theme detection isn't implemented yet** (EDHREC's `panels.taglinks`
  is the planned signal, see roadmap).
- **No retries with true backoff** on external APIs — `ofetch`'s `retry: 1`
  plus a short delay is "try twice, fail fast".
- **Single user** — no auth, sessions live on local disk. Fine for personal
  use; not production.
- **Role detection is heuristic** and will miss edge cases (e.g. Chaos Warp
  isn't counted as removal because it shuffles rather than destroys).

## Roadmap

- [ ] Commander-theme awareness via `/commanders/<cmdr>/<theme>.json`
- [ ] Retries with exponential backoff against Scryfall/EDHREC
- [ ] Theme-scoped deckbuilding (choose Korvold+Treasure vs Korvold+Aristocrats)
- [ ] Functional-roles sliders in the Build Rules panel
- [ ] Per-commander curve targets as a hard bound, not just a tiebreaker

## License

No license yet. Treat as "all rights reserved" until I commit one.

## Credits

- MTG card data from [Scryfall](https://scryfall.com).
- Commander recommendations from [EDHREC](https://edhrec.com).
- Icons / emoji from system font.

Built with 🍺 for keeping Commander brewing cheap.
