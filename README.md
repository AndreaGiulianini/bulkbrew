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
  plain-text list like `1 Sol Ring`. Imports are instant (no Scryfall calls
  during parse); enrichment happens lazily on the page that needs it.
  Anything Scryfall couldn't match is surfaced to you, not silently dropped.
- **Commander picker** (`/commander`) — every legendary creature in your
  collection, ordered by **live** EDHREC commander rank (batched + cached
  in IndexedDB).
- **Try any commander** (`/explore`) — search EDHREC's top ~150 popular
  commanders or fall back to free-text for the long tail. Pick a commander
  you don't own and BulkBrew still auto-fills the deck from your collection
  with a clear "Not in collection" badge on the commander tile, so you can
  see how close you are to building it before you buy.
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
- **Sessions** — auto-saved to IndexedDB, reloadable from the homepage.
- **Offline support (PWA)** — service worker precaches the app shell and
  permanently caches every card image you've seen (`cards.scryfall.io` URLs
  are content-addressed and never change). Open a saved deck on a plane and
  the commander tile, deck list and card art all render. New builds surface
  a non-blocking "Reload" toast — no surprise refreshes mid-session.

## Stack

- **[Nuxt 4](https://nuxt.com)** + **Vue 3** with `<script setup>` and
  TypeScript strict mode throughout
- **[Pinia](https://pinia.vuejs.org)** for state
- **[Tailwind CSS](https://tailwindcss.com)** with a custom muted-teal /
  tangerine / shadow-grey palette
- **[Cinzel](https://fonts.google.com/specimen/Cinzel)** (Google Fonts) for
  the wordmark
- **[@vite-pwa/nuxt](https://vite-pwa-org.netlify.app/frameworks/nuxt)**
  (Workbox) for the service worker, offline shell, and runtime caching
- **[Biome](https://biomejs.dev)** for lint + format

**External data**: Scryfall (card data) and EDHREC (commander recommendations
and themes), called directly from the browser. Two layers of caching:

- **App layer** — IndexedDB via `app/utils/storage.ts`: Scryfall cards 7 days,
  EDHREC pages 1 day, EDHREC top-commanders list 1 day, Scryfall commander
  catalog 7 days. Opportunistic sweep evicts entries older than 30 days.
- **Network layer** — service worker (Workbox): `cards.scryfall.io` images
  CacheFirst 365 days, `api.scryfall.com/cards` CacheFirst 30 days,
  `json.edhrec.com/pages` NetworkFirst with 3s timeout + 1-day cache fallback.

**Hosting**: pure static site. Deployed to Vercel's hobby tier (free) — no
serverless functions, no server runtime. Your collection, sessions and both
cache layers all live in your browser.

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

Implemented in `app/stores/deck.ts` (`_autoFillImpl`):

1. **Owned EDHREC lands** — add owned non-basic lands EDHREC recommends for
   this commander, up to the land target.
2. **Reserve land slots** — reserve the remaining lands so the non-land
   budget can't crowd them out (filled later by basics or by missing
   non-basics if "Fill gaps" is on).
3. **EDHREC non-land categories** — fill each category (`creatures`,
   `instants`, `sorceries`, `manaartifacts`, `utilityartifacts`,
   `enchantments`, `planeswalkers`, `gamechangers`, `highsynergycards`,
   `topcards`) up to its per-commander target, sorted by
   `inclusion + synergyWeight × synergy`.
4. **Role-deficit pass** — for ramp / draw / removal / wipes in order,
   pull EDHREC-recommended owned cards that satisfy the role until the
   target (8 / 8 / 5 / 2) is met, respecting existing type caps.
5. **Spill** — any remaining owned EDHREC-recommended cards past per-category
   targets, still respecting per-type caps.
6. **Generic fallback** — any owned non-land card sorted by global
   `edhrec_rank`, respecting type caps. A second pass without caps runs
   if the budget still isn't full.
7. **Owned basics** — pad with owned basic lands up to the land target.
8. If **"Fill gaps"** is on: top off with missing EDHREC non-basic lands,
   then with basics regardless of ownership (both marked as *missing*).

Note: the auto-fill never invents non-land cards you don't own. If your
collection lacks playable spells in the commander's color identity, the
deck stops short of 100 — the recommendations panel surfaces the gap.

Functional-role detection is heuristic — regex over Scryfall oracle text in
`app/utils/card-roles.ts`. Sol Ring, Cultivate etc → ramp. Swords to
Plowshares, Doom Blade → removal. Blasphemous Act, Farewell → wipe.

## Known limitations

- **Commander theme detection isn't implemented yet** (EDHREC's `panels.taglinks`
  is the planned signal, see roadmap).
- **Partner / Background commander pairs aren't supported** in the explore
  page — single legendary creatures only for now.
- **Auto-fill doesn't pad non-land slots** with unowned cards. If your
  collection is small, the deck won't reach 100 — see the recommendations
  panel for what to buy.
- **No retries with true backoff** on external APIs — `$fetch`'s `retry: 1`
  plus a short delay is "try twice, fail fast". A circuit breaker stops
  Scryfall batches after 2 consecutive failures (CORS-less 429s prevent
  reading `Retry-After`).
- **Single user** — no auth, sessions live in browser IndexedDB. Fine for
  personal use; not production.
- **Role detection is heuristic** and will miss edge cases (e.g. Chaos Warp
  isn't counted as removal because it shuffles rather than destroys).

## Roadmap

- [ ] Commander-theme awareness via `/commanders/<cmdr>/<theme>.json`
- [ ] Theme-scoped deckbuilding (choose Korvold+Treasure vs Korvold+Aristocrats)
- [ ] Partner / Background pair support in `/explore`
- [ ] Pad non-land slots with unowned EDHREC recs (marked as missing-to-buy)
      so decks always reach 100
- [ ] Retries with exponential backoff against Scryfall/EDHREC
- [ ] Functional-roles sliders in the Build Rules panel
- [ ] Per-commander curve targets as a hard bound, not just a tiebreaker
- [ ] "Refresh data" button to bust both IndexedDB and service-worker caches
      for a single commander before TTL expiry

## License

No license yet. Treat as "all rights reserved" until I commit one.

## Credits

- MTG card data from [Scryfall](https://scryfall.com).
- Commander recommendations from [EDHREC](https://edhrec.com).
- Icons / emoji from system font.

Built with 🍺 for keeping Commander brewing cheap.
