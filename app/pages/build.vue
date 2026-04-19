<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";
import { useDeckStore } from "~/stores/deck";
import type { EnrichedRec } from "~~/shared/types";

const deck = useDeckStore();
const collection = useCollectionStore();
const showExport = ref(false);
const exportText = ref("");
const saving = ref(false);
const savedAt = ref<string | null>(null);
const autoFilling = ref(false);
const copiedAt = ref<string | null>(null);
const view = ref<"deck" | "recs">("deck");
const collapsedCategories = ref<Set<string>>(new Set());

function toggleCategory(tag: string) {
  const next = new Set(collapsedCategories.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  collapsedCategories.value = next;
}

function expandAllCategories() {
  collapsedCategories.value = new Set();
}

function collapseAllCategories() {
  collapsedCategories.value = new Set(deck.categories.map((c) => c.category));
}

function inDeckCount(recs: { name: string }[]): number {
  let n = 0;
  for (const r of recs) if (deck.deckNames.has(r.name.toLowerCase())) n++;
  return n;
}

onMounted(async () => {
  if (!deck.session) {
    await navigateTo("/commander");
    return;
  }
  await collection.load();
  if (!deck.edhrec) await deck.fetchRecs();
});

const sizeColor = computed(() => {
  const s = deck.deckSize;
  if (s === 100) return "text-emerald-400";
  if (s >= 95) return "text-amber-400";
  return "text-neutral-300";
});

const COLOR_TINTS: Record<string, string> = {
  W: "#fffbd5",
  U: "#aae0fa",
  B: "#8a7d7a",
  R: "#f9aa8f",
  G: "#9bd3ae",
  C: "#c0bab6",
};
const commanderGlow = computed(() => {
  const ids = deck.session?.colorIdentity ?? [];
  const tints = ids.length ? ids.map((c) => COLOR_TINTS[c] ?? COLOR_TINTS.C) : [COLOR_TINTS.C];
  if (tints.length === 1) return `radial-gradient(circle, ${tints[0]}66, transparent 70%)`;
  const stops = tints.map((t, i) => `${t}55 ${(i / tints.length) * 100}%`).join(", ");
  return `conic-gradient(${stops}, ${tints[0]}55)`;
});

const PROGRESS_R = 34;
const progressCircumference = 2 * Math.PI * PROGRESS_R;
const progressOffset = computed(() => {
  const pct = Math.min(1, deck.deckSize / 100);
  return progressCircumference * (1 - pct);
});
const progressStroke = computed(() => {
  const s = deck.deckSize;
  if (s === 100) return "#70a288"; // emerald-500
  if (s >= 95) return "#f79f79"; // amber-400
  return "#525252";
});

const actionError = ref<string | null>(null);
function handleError(action: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  actionError.value = `${action} failed: ${msg}`;
}

async function save() {
  saving.value = true;
  actionError.value = null;
  try {
    await deck.save();
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err) {
    handleError("Save", err);
  } finally {
    saving.value = false;
  }
}

function doExport() {
  exportText.value = deck.exportText();
  showExport.value = true;
}

async function copyExport() {
  await navigator.clipboard.writeText(exportText.value);
}

async function copyDeck() {
  await navigator.clipboard.writeText(deck.exportText());
  copiedAt.value = new Date().toLocaleTimeString();
}

function addRec(category: string, rec: EnrichedRec) {
  deck.addCard({
    name: rec.name,
    category,
    scryfallId: rec.ownedScryfallId,
    fromCollection: rec.owned,
    inclusion:
      rec.num_decks && rec.potential_decks ? rec.num_decks / rec.potential_decks : undefined,
  });
}

function removeCard(name: string) {
  deck.removeCard(name);
}

function inDeck(name: string): boolean {
  return deck.deckNames.has(name.toLowerCase());
}

const autoFillStage = ref<"build" | "save" | "done">("build");
async function autoFill() {
  autoFillStage.value = "build";
  autoFilling.value = true;
  actionError.value = null;
  try {
    deck.autoFillFromCollection();
    autoFillStage.value = "save";
    await deck.save();
    autoFillStage.value = "done";
  } catch (err) {
    handleError("Auto-fill", err);
  } finally {
    autoFilling.value = false;
  }
}

async function setDeckSource(fillMissing: boolean) {
  if (deck.rules.fillMissing === fillMissing) return;
  deck.setRules({ fillMissing });
  autoFillStage.value = "build";
  autoFilling.value = true;
  actionError.value = null;
  try {
    deck.rebuildDeck();
    autoFillStage.value = "save";
    await deck.save();
    autoFillStage.value = "done";
  } catch (err) {
    handleError("Rebuild", err);
  } finally {
    autoFilling.value = false;
  }
}

function clearDeck() {
  if (!confirm("Remove all non-commander cards?")) return;
  deck.removeAllNonCommander();
}
</script>

<template>
  <div v-if="!deck.session" class="text-neutral-400">No active session.</div>
  <div v-else class="space-y-4">
    <!-- Commander + stats + actions bar -->
    <div class="relative bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-950 border border-neutral-800 rounded-xl p-3 md:p-5 flex flex-col md:flex-row gap-4 md:gap-5 overflow-hidden">
      <!-- Color-identity glow backdrop -->
      <div
        class="pointer-events-none absolute -top-20 -left-20 w-64 h-64 rounded-full opacity-20 blur-3xl"
        :style="{ background: commanderGlow }"
      />

      <!-- Top row on mobile: card + title side by side -->
      <div class="flex gap-4 md:gap-5 md:contents">
        <!-- Commander card -->
        <div class="relative w-24 md:w-32 shrink-0">
          <div
            class="absolute inset-[-3px] rounded-lg opacity-70"
            :style="{ background: commanderGlow, filter: 'blur(8px)' }"
          />
          <div class="relative rounded-lg overflow-hidden ring-1 ring-white/10">
            <CardImage
              :name="deck.session.commanderName"
              :scryfall-id="deck.session.commanderScryfallId"
              size="normal"
              hover-preview
              eager
            />
          </div>
        </div>

        <!-- Name + actions -->
        <div class="flex-1 md:flex-none md:shrink-0 min-w-0 md:max-w-xs flex flex-col gap-3">
          <div class="min-w-0 space-y-1.5">
            <input
              :value="deck.session.name"
              aria-label="Deck name"
              class="bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-emerald-500 outline-none text-lg md:text-xl font-bold w-full"
              @input="deck.renameSession(($event.target as HTMLInputElement).value)"
            />
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-neutral-400 truncate">{{ deck.session.commanderName }}</span>
              <div class="flex gap-1">
                <span
                  v-for="color in deck.session.colorIdentity"
                  :key="color"
                  :class="`mana-${color}`"
                  class="w-5 h-5 rounded-full inline-flex items-center justify-center text-xs font-bold shadow-sm"
                >{{ color }}</span>
                <span
                  v-if="!deck.session.colorIdentity.length"
                  class="mana-C w-5 h-5 rounded-full inline-flex items-center justify-center text-xs font-bold shadow-sm"
                >C</span>
              </div>
            </div>
            <div v-if="savedAt" class="text-[10px] text-emerald-500/70">
              ✓ Saved {{ savedAt }}
            </div>
          </div>

          <div v-if="actionError" class="text-rose-400 text-xs bg-rose-950/40 rounded border border-rose-900/60 px-2.5 py-1.5 flex items-start gap-2">
            <span aria-hidden="true">⚠</span>
            <span class="flex-1 min-w-0 break-words">{{ actionError }}</span>
            <button class="text-rose-300 hover:text-white shrink-0" aria-label="Dismiss error" @click="actionError = null">×</button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              :disabled="autoFilling || !deck.edhrec"
              class="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold shadow-md shadow-emerald-900/40 inline-flex items-center gap-1.5 transition-colors"
              @click="autoFill"
            >
              <span>⚡</span>
              <span>{{ autoFilling ? "Filling…" : "Auto-fill" }}</span>
            </button>
            <button
              class="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 inline-flex items-center justify-center transition-colors"
              title="Clear deck (remove all non-commander cards)"
              aria-label="Clear deck"
              @click="clearDeck"
            >
              <span aria-hidden="true">🗑</span>
            </button>
            <button
              :disabled="saving"
              class="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 inline-flex items-center justify-center transition-colors"
              title="Save session"
              :aria-label="saving ? 'Saving session' : 'Save session'"
              @click="save"
            >
              <span v-if="saving" class="text-xs" aria-hidden="true">…</span>
              <span v-else aria-hidden="true">💾</span>
            </button>
            <button
              class="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 inline-flex items-center justify-center transition-colors relative"
              :title="copiedAt ? `Copied at ${copiedAt}` : 'Copy decklist to clipboard'"
              aria-label="Copy decklist to clipboard"
              @click="copyDeck"
            >
              <span aria-hidden="true">📋</span>
              <span
                v-if="copiedAt"
                class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-neutral-900"
                aria-hidden="true"
              />
            </button>
            <button
              class="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 inline-flex items-center justify-center transition-colors"
              title="Export decklist"
              aria-label="Export decklist"
              @click="doExport"
            >
              <span aria-hidden="true">⇪</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Stats panel with integrated progress ring (takes remaining width) -->
      <div class="flex-1 min-w-0 md:border-l border-t md:border-t-0 border-neutral-800 pt-4 md:pt-0 md:pl-5 flex flex-col sm:flex-row gap-4 sm:gap-5 items-start">
        <!-- Progress ring -->
        <div
          class="relative w-24 h-24 shrink-0 flex items-center justify-center mx-auto sm:mx-0"
          role="img"
          :aria-label="`Deck progress: ${deck.deckSize} of 100 cards`"
        >
          <svg viewBox="0 0 80 80" class="w-24 h-24 -rotate-90" aria-hidden="true">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgb(38 38 38)" stroke-width="6" />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              :stroke="progressStroke"
              stroke-width="6"
              stroke-linecap="round"
              :stroke-dasharray="progressCircumference"
              :stroke-dashoffset="progressOffset"
              class="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <div class="text-2xl font-bold tabular-nums leading-none" :class="sizeColor">
              {{ deck.deckSize }}
            </div>
            <div class="text-[10px] text-neutral-500 mt-0.5">of 100</div>
          </div>
        </div>

        <!-- Stats -->
        <div class="flex-1 min-w-0 w-full">
          <DeckStats :stats="deck.stats" />
        </div>
      </div>
    </div>

    <!-- Build rules (always visible) -->
    <section class="rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-950 border border-neutral-800 overflow-hidden">
      <header class="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/80 bg-black/30">
        <div class="flex items-center gap-2">
          <span class="text-emerald-400 text-base">⚙</span>
          <h3 class="text-sm font-semibold text-neutral-200 tracking-wide">Build rules</h3>
          <span class="text-[10px] text-neutral-500 hidden md:inline">Applied on next auto-fill</span>
        </div>
        <button
          class="text-[11px] px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
          @click="deck.resetRulesFromEdhrec()"
        >
          ↺ Reset to EDHREC defaults
        </button>
      </header>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-neutral-800/70">
        <!-- Land target -->
        <div class="p-4 bg-neutral-900 space-y-2">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-[10px] uppercase tracking-[0.15em] text-emerald-400/80">Lands</div>
              <div class="text-[10px] text-neutral-500">Target count</div>
            </div>
            <div class="text-3xl font-bold tabular-nums text-emerald-300 leading-none">
              {{ deck.rules.landTarget }}
            </div>
          </div>
          <input
            type="range"
            min="30"
            max="42"
            step="1"
            class="w-full accent-emerald-500"
            aria-label="Land target count"
            :value="deck.rules.landTarget"
            @input="deck.setRules({ landTarget: Number(($event.target as HTMLInputElement).value) })"
          />
          <div class="flex justify-between text-[10px] text-neutral-600 tabular-nums">
            <span>30</span><span>36</span><span>42</span>
          </div>
        </div>

        <!-- Synergy weight -->
        <div class="p-4 bg-neutral-900 space-y-2">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-[10px] uppercase tracking-[0.15em] text-amber-400/80">Synergy</div>
              <div class="text-[10px] text-neutral-500">Archetype bias</div>
            </div>
            <div class="text-3xl font-bold tabular-nums text-amber-300 leading-none">
              {{ Math.round(deck.rules.synergyWeight * 100) }}<span class="text-lg text-amber-500/70">%</span>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            class="w-full accent-amber-500"
            aria-label="Synergy weight percentage"
            :value="Math.round(deck.rules.synergyWeight * 100)"
            @input="deck.setRules({ synergyWeight: Number(($event.target as HTMLInputElement).value) / 100 })"
          />
          <div class="flex justify-between text-[10px] text-neutral-600">
            <span>Staples</span><span>On-theme</span>
          </div>
        </div>

        <!-- Max CMC -->
        <div class="p-4 bg-neutral-900 space-y-2">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-[10px] uppercase tracking-[0.15em] text-sky-400/80">Max CMC</div>
              <div class="text-[10px] text-neutral-500">Skip pricier spells</div>
            </div>
            <div class="text-3xl font-bold tabular-nums text-sky-300 leading-none">
              {{ deck.rules.maxCmc >= 10 ? "∞" : deck.rules.maxCmc }}
            </div>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            class="w-full accent-sky-500"
            aria-label="Maximum mana cost"
            :value="deck.rules.maxCmc"
            @input="deck.setRules({ maxCmc: Number(($event.target as HTMLInputElement).value) })"
          />
          <div class="flex justify-between text-[10px] text-neutral-600 tabular-nums">
            <span>1</span><span>5</span><span>∞</span>
          </div>
        </div>

        <!-- Deck source -->
        <div class="p-4 bg-neutral-900 flex flex-col gap-2">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-[10px] uppercase tracking-[0.15em] text-rose-400/80">Deck source</div>
              <div class="text-[10px] text-neutral-500">Where to pull cards from</div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-1 rounded-lg bg-neutral-950 p-1 border border-neutral-800">
            <button
              type="button"
              :disabled="autoFilling"
              class="px-2 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-60"
              :class="
                deck.rules.fillMissing
                  ? 'bg-emerald-600/90 text-white shadow-[0_0_0_1px_rgba(112,162,136,0.6)]'
                  : 'text-neutral-400 hover:text-neutral-200'
              "
              @click="setDeckSource(true)"
            >
              Fill gaps
            </button>
            <button
              type="button"
              :disabled="autoFilling"
              class="px-2 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-60"
              :class="
                !deck.rules.fillMissing
                  ? 'bg-rose-600/90 text-white shadow-[0_0_0_1px_rgba(162,44,41,0.6)]'
                  : 'text-neutral-400 hover:text-neutral-200'
              "
              @click="setDeckSource(false)"
            >
              Owned only
            </button>
          </div>
          <div class="text-[10px] text-neutral-500 leading-snug">
            <span v-if="deck.rules.fillMissing">
              Adds missing lands/basics so the deck reaches 100.
            </span>
            <span v-else>
              Uses only cards you own — the deck may stay under 100.
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- View toggle -->
    <div class="flex gap-1 border-b border-neutral-800">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
        :class="
          view === 'deck'
            ? 'border-emerald-500 text-white'
            : 'border-transparent text-neutral-400 hover:text-white'
        "
        @click="view = 'deck'"
      >
        My Deck ({{ deck.deckSize }})
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
        :class="
          view === 'recs'
            ? 'border-emerald-500 text-white'
            : 'border-transparent text-neutral-400 hover:text-white'
        "
        @click="view = 'recs'"
      >
        Recommendations
      </button>
    </div>

    <!-- Deck grid view -->
    <section v-if="view === 'deck'" class="space-y-6">
      <div v-if="deck.deckSize === 1" class="text-neutral-500 text-sm py-8 text-center">
        Empty deck. Click
        <button
          class="text-emerald-400 hover:text-emerald-300 underline"
          @click="autoFill"
        >
          Auto-fill from collection
        </button>
        or browse
        <button
          class="text-emerald-400 hover:text-emerald-300 underline"
          @click="view = 'recs'"
        >
          Recommendations
        </button>.
      </div>
      <div
        v-for="grp in deck.deckByType"
        :key="grp.group"
        class="space-y-2"
      >
        <h3 class="text-sm font-semibold text-neutral-300">
          {{ grp.group }}
          <span class="text-neutral-500 font-normal">({{ grp.count }})</span>
        </h3>
        <div
          class="grid gap-2"
          style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))"
        >
          <DeckCardTile
            v-for="c in grp.cards"
            :key="c.name"
            :name="c.name"
            :scryfall-id="c.scryfallId"
            :from-collection="c.fromCollection"
            :quantity="c.quantity"
            :removable="grp.group !== 'Commander'"
            @remove="removeCard(c.name)"
          />
        </div>
      </div>
    </section>

    <!-- Recommendations view -->
    <section v-else class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3 bg-neutral-900 border border-neutral-800 rounded p-3">
        <div class="text-xs text-neutral-400 space-y-1">
          <div>Click a card to add or remove it from your deck.</div>
          <div class="flex gap-3">
            <span class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-sm bg-emerald-700 inline-block" />
              Owned
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-sm bg-neutral-700 inline-block" />
              Missing
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-sm ring-1 ring-amber-500 bg-neutral-900 inline-block" />
              Already in deck
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-neutral-400 flex items-center gap-1.5">
            <input v-model="deck.showMissing" type="checkbox" />
            Show missing
          </label>
          <button
            class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            @click="expandAllCategories"
          >
            Expand all
          </button>
          <button
            class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            @click="collapseAllCategories"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div v-if="deck.loadingRecs" class="text-neutral-400">Loading EDHREC recs...</div>
      <div v-else-if="deck.error" class="text-rose-400">{{ deck.error }}</div>

      <div
        v-for="cat in deck.categories"
        :key="cat.category"
        class="border border-neutral-800 rounded overflow-hidden"
      >
        <button
          class="w-full flex items-center gap-3 px-3 py-2 bg-neutral-900 hover:bg-neutral-800 text-left"
          @click="toggleCategory(cat.category)"
        >
          <span class="text-neutral-500 text-xs w-4 shrink-0">
            {{ collapsedCategories.has(cat.category) ? '▸' : '▾' }}
          </span>
          <span class="font-semibold flex-1 min-w-0 truncate">{{ cat.header }}</span>
          <span
            class="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 tabular-nums"
            :title="'In your deck'"
          >
            {{ inDeckCount([...cat.owned, ...cat.missing]) }} in deck
          </span>
          <span
            class="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 tabular-nums"
            :title="'Owned in your collection'"
          >
            {{ cat.owned.length }} owned
          </span>
          <span
            class="text-xs px-1.5 py-0.5 rounded bg-rose-900/30 text-rose-300 tabular-nums"
            :title="'Not in your collection'"
          >
            {{ cat.missing.length }} missing
          </span>
        </button>

        <div
          v-if="!collapsedCategories.has(cat.category)"
          class="p-3 space-y-3 bg-neutral-950"
        >
          <div v-if="cat.owned.length">
            <h3 class="text-xs uppercase text-emerald-400 tracking-wider mb-1.5">Owned</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
              <CardChip
                v-for="c in cat.owned"
                :key="c.name"
                :name="c.name"
                :scryfall-id="c.ownedScryfallId"
                :num-decks="c.num_decks"
                :potential-decks="c.potential_decks"
                :owned="true"
                :owned-quantity="c.ownedQuantity"
                :in-deck="inDeck(c.name)"
                @add="addRec(cat.category, c)"
                @remove="removeCard(c.name)"
              />
            </div>
          </div>

          <div v-if="deck.showMissing && cat.missing.length">
            <h3 class="text-xs uppercase text-rose-300 tracking-wider mb-1.5">
              Missing (top 20)
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
              <CardChip
                v-for="c in cat.missing.slice(0, 20)"
                :key="c.name"
                :name="c.name"
                :num-decks="c.num_decks"
                :potential-decks="c.potential_decks"
                :owned="false"
                :buy-advice="c.buyAdvice"
                :in-deck="inDeck(c.name)"
                @add="addRec(cat.category, c)"
                @remove="removeCard(c.name)"
              />
            </div>
          </div>

          <div
            v-if="!cat.owned.length && (!deck.showMissing || !cat.missing.length)"
            class="text-xs text-neutral-500 py-2"
          >
            No cards to show for this category.
          </div>
        </div>
      </div>
    </section>

    <!-- Export modal -->
    <div
      v-if="showExport"
      class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      @click.self="showExport = false"
    >
      <div class="bg-neutral-900 border border-neutral-700 rounded-lg max-w-2xl w-full p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold">Export decklist</h3>
          <button class="text-neutral-400 hover:text-white" @click="showExport = false">×</button>
        </div>
        <textarea
          v-model="exportText"
          class="w-full h-96 p-3 bg-neutral-950 border border-neutral-700 rounded font-mono text-sm"
          readonly
        />
        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm"
            @click="copyExport"
          >
            Copy to clipboard
          </button>
        </div>
      </div>
    </div>

    <DeckBuildingOverlay
      v-if="deck.session"
      :show="autoFilling"
      :commander-name="deck.session.commanderName"
      :commander-scryfall-id="deck.session.commanderScryfallId"
      :stage="autoFillStage"
    />
  </div>
</template>
