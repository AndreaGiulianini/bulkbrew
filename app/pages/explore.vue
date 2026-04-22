<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";
import { useDeckStore } from "~/stores/deck";
import { getCommanderPage, getTopCommanders } from "~/utils/edhrec";
import { edhrecSlug } from "~/utils/slug";
import type { TopCommander } from "~~/shared/types";

const collection = useCollectionStore();
const deck = useDeckStore();

const search = ref("");
const candidates = ref<TopCommander[]>([]);
const loadingCatalog = ref(false);

const pickingSlug = ref<string | null>(null);
const pickingName = ref("");
const pickingScryfallId = ref<string | undefined>(undefined);
const pickStage = ref<"recs" | "prepare" | "build" | "save" | "done">("recs");
const pickError = ref<string | null>(null);

onMounted(async () => {
  await collection.load();
  loadingCatalog.value = true;
  try {
    candidates.value = await getTopCommanders();
  } finally {
    loadingCatalog.value = false;
  }
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return candidates.value;
  return candidates.value.filter((c) => c.name.toLowerCase().includes(q));
});

const trimmedQuery = computed(() => search.value.trim());

// Free-text fallback target: whatever the user typed, slugified to EDHREC's
// URL convention. Only meaningful when the typed query doesn't already
// match a top-list slug exactly — but we expose the CTA whenever a query
// exists so the user always has a way to try a less-popular commander.
const fallbackSlug = computed(() => edhrecSlug(trimmedQuery.value));
const showFallback = computed(() => trimmedQuery.value.length > 0);

function ownedBadge(name: string): "owned" | "missing" {
  return collection.isOwned(name) ? "owned" : "missing";
}

async function pickFromList(c: TopCommander) {
  await startBuild({
    name: c.name,
    slug: c.slug,
    scryfallId: c.scryfallId,
  });
}

async function pickFromQuery() {
  const name = trimmedQuery.value;
  if (!name) return;
  await startBuild({ name, slug: fallbackSlug.value });
}

async function startBuild(input: { name: string; slug: string; scryfallId?: string }) {
  if (pickingSlug.value) return;
  pickingSlug.value = input.slug;
  pickingName.value = input.name;
  pickingScryfallId.value = input.scryfallId;
  pickStage.value = "recs";
  pickError.value = null;

  try {
    const page = await getCommanderPage(input.slug);
    if (!page) {
      pickError.value = `EDHREC has no page for "${input.name}". Try the exact card name (or pick from the list above).`;
      pickingSlug.value = null;
      return;
    }
    const card = page.container?.json_dict?.card;
    const canonicalName = card?.name ?? input.name;
    const scryfallId = card?.id ?? input.scryfallId;
    const colorIdentity = card?.color_identity ?? [];
    pickingName.value = canonicalName;
    pickingScryfallId.value = scryfallId;

    deck.startSession({
      name: canonicalName,
      scryfallId,
      colorIdentity,
      ownedInCollection: collection.isOwned(canonicalName),
      slug: input.slug,
    });
    // Mirror commander.vue: fetchRecs uses session.commanderSlug, hits
    // the just-cached EDHREC page (instant), and seeds the rules.
    await deck.fetchRecs();

    if (deck.edhrec) {
      pickStage.value = "prepare";
      // Just-in-time Scryfall enrichment, bounded by this commander's
      // EDHREC pool — same approach as /commander, keeps autofill
      // on-theme and avoids hammering Scryfall on a 40 K-card library.
      const recNames = new Set<string>();
      for (const list of deck.edhrec.container?.json_dict?.cardlists ?? []) {
        for (const cv of list.cardviews) recNames.add(cv.name);
      }
      await collection.resolveNames(Array.from(recNames));
      pickStage.value = "build";
      deck.autoFillFromCollection();
    }

    pickStage.value = "save";
    await deck.save();
    pickStage.value = "done";
    await navigateTo("/build");
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
    pickingSlug.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">Try any commander</h1>
      <p class="text-neutral-400 text-sm">
        Search EDHREC's popular commanders — owned or not — and we'll auto-fill the deck
        from your collection so you can see how close you are to building it.
      </p>
      <p class="text-neutral-500 text-xs mt-1">
        Partner / Background pairs aren't supported yet.
      </p>
    </div>

    <input
      v-model="search"
      type="search"
      placeholder="Search commanders..."
      aria-label="Search commanders"
      class="w-full max-w-md px-3 py-2 rounded bg-neutral-900 border border-neutral-700 focus:outline-none focus:border-emerald-500"
    />

    <div class="flex items-center gap-3 text-sm text-neutral-400 flex-wrap">
      <span v-if="candidates.length">
        {{ filtered.length }} of {{ candidates.length }} popular commanders
      </span>
      <span
        v-if="loadingCatalog"
        class="inline-flex items-center gap-2 text-xs text-neutral-500"
      >
        <span class="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
        Loading top commanders from EDHREC…
      </span>
    </div>

    <div v-if="pickError" class="text-rose-400 text-sm">{{ pickError }}</div>

    <div
      v-if="filtered.length"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
    >
      <button
        v-for="c in filtered"
        :key="c.slug"
        :disabled="pickingSlug !== null"
        class="relative text-left rounded-lg overflow-hidden border border-neutral-800 hover:border-emerald-500 transition-colors bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
        @click="pickFromList(c)"
      >
        <CardImage :name="c.name" :scryfall-id="c.scryfallId" size="normal" hover-preview />
        <span
          v-if="c.rank"
          class="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-amber-300 text-[10px] font-semibold tabular-nums shadow ring-1 ring-black/40"
          title="EDHREC commander rank (popularity)"
        >
          #{{ c.rank.toLocaleString() }}
        </span>
        <span
          class="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ring-1 shadow"
          :class="
            ownedBadge(c.name) === 'owned'
              ? 'bg-emerald-950/85 text-emerald-200 ring-emerald-700/60'
              : 'bg-rose-950/85 text-rose-200 ring-rose-700/60'
          "
          :title="ownedBadge(c.name) === 'owned' ? 'You own this commander' : 'Not in your collection'"
        >
          {{ ownedBadge(c.name) === 'owned' ? '✓ Owned' : 'Not owned' }}
        </span>
        <div class="p-2">
          <div class="font-medium text-sm truncate">{{ c.name }}</div>
          <div class="text-xs text-neutral-500 tabular-nums">
            {{ c.inclusion.toLocaleString() }} decks
          </div>
        </div>
      </button>
    </div>

    <div
      v-else-if="!loadingCatalog && candidates.length"
      class="text-neutral-500 text-sm py-4"
    >
      No popular commander matches "{{ search }}".
    </div>

    <!-- Free-text fallback: always visible whenever there's a query, since
         EDHREC's top list only covers ~150-300 commanders and the long tail
         (Slimefoot, Yuriko-not-in-list, etc.) needs this escape hatch. -->
    <div
      v-if="showFallback"
      class="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 flex flex-wrap items-center gap-3"
    >
      <div class="text-sm text-neutral-300 flex-1 min-w-0">
        Don't see your commander?
        <span class="text-neutral-500">Try the exact card name —</span>
        <code class="text-emerald-400 text-xs px-1 py-0.5 rounded bg-black/40 ml-1">
          {{ fallbackSlug || trimmedQuery }}
        </code>
      </div>
      <button
        :disabled="pickingSlug !== null || !fallbackSlug"
        class="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold inline-flex items-center gap-1.5 transition-colors"
        @click="pickFromQuery"
      >
        Try "{{ trimmedQuery }}"
      </button>
    </div>

    <DeckBuildingOverlay
      :show="pickingSlug !== null"
      :commander-name="pickingName"
      :commander-scryfall-id="pickingScryfallId"
      :stage="pickStage"
      :prepare-loaded="collection.resolveProgress?.loaded"
      :prepare-total="collection.resolveProgress?.total"
    />
  </div>
</template>
