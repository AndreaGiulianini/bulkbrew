<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";
import { useDeckStore } from "~/stores/deck";
import { resolveCommanderRanks } from "~/utils/edhrec";
import { commanderFaceName, edhrecSlug } from "~/utils/slug";
import type { CollectionCard, ScryfallCard } from "~~/shared/types";

type CommanderCandidate = CollectionCard & { scryfall: ScryfallCard };

const collection = useCollectionStore();
const deck = useDeckStore();
const search = ref("");
const pickingId = ref<string | null>(null);
const pickError = ref<string | null>(null);
const pickingName = ref("");
const pickingScryfallId = ref<string | undefined>(undefined);
const pickStage = ref<"recs" | "prepare" | "build" | "save" | "done">("recs");

// Commander candidates come from a cached universal Scryfall catalog
// intersected with the user's collection by name — NOT from a full
// collection enrichment. That keeps the page fast: only the cards we
// actually render (and their images) touch Scryfall, and the catalog
// fetch itself is a 7-day cached singleton.
const candidates = ref<CommanderCandidate[]>([]);
const loadingCatalog = ref(false);

// Live EDHREC commander ranks, keyed by Scryfall ID.
const liveRankById = ref<Record<string, number | null>>({});
const ranksReady = ref(false);

onMounted(async () => {
  await collection.load();
  loadingCatalog.value = true;
  try {
    candidates.value = await collection.resolveCommanders();
  } finally {
    loadingCatalog.value = false;
  }
  await loadLiveRanks();
});

async function loadLiveRanks() {
  const slugByScryfallId = new Map<string, string>();
  const uniqueSlugs = new Set<string>();
  for (const c of candidates.value) {
    const slug = edhrecSlug(commanderFaceName(c.scryfall));
    if (!slug || !c.scryfallId) continue;
    slugByScryfallId.set(c.scryfallId, slug);
    uniqueSlugs.add(slug);
  }
  if (!uniqueSlugs.size) {
    ranksReady.value = true;
    return;
  }
  try {
    const ranksBySlug = await resolveCommanderRanks(Array.from(uniqueSlugs));
    const byId: Record<string, number | null> = {};
    for (const [id, slug] of slugByScryfallId) byId[id] = ranksBySlug[slug] ?? null;
    liveRankById.value = byId;
  } catch {
    // Silent — commanders without a live rank render without a rank badge.
  } finally {
    ranksReady.value = true;
  }
}

function rankFor(scryfallId: string | undefined): number | null {
  if (!scryfallId) return null;
  return liveRankById.value[scryfallId] ?? null;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = [...candidates.value].sort((a, b) => {
    const ra = rankFor(a.scryfallId) ?? Number.POSITIVE_INFINITY;
    const rb = rankFor(b.scryfallId) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  if (!q) return all;
  return all.filter((c) => c.name.toLowerCase().includes(q));
});

async function pick(c: CommanderCandidate) {
  if (pickingId.value) return;
  pickingId.value = c.scryfallId;
  pickingName.value = c.name;
  pickingScryfallId.value = c.scryfallId;
  pickStage.value = "recs";
  pickError.value = null;
  try {
    deck.startSession({
      name: c.name,
      scryfallId: c.scryfallId,
      colorIdentity: c.scryfall?.color_identity ?? [],
      ownedInCollection: true,
      scryfall: c.scryfall,
    });
    await deck.fetchRecs();
    if (deck.edhrec) {
      // Just-in-time Scryfall enrichment, bounded by the commander's
      // EDHREC recommendation pool (~500–1 500 unique names), NOT by the
      // user's collection size. Step 4 / 4.5 of autofill filters owned
      // cards through `collection.getScryfall(name)`, so cards without
      // Scryfall data are skipped — by resolving only the EDHREC recs we
      // effectively say "Step 4/4.5 considers owned cards *that are
      // recommended for this commander*". That keeps the algorithm
      // on-theme and lets a 40 K-card collection resolve in ~4 s instead
      // of hitting Scryfall's rate limit.
      pickStage.value = "prepare";
      const recNames = new Set<string>();
      for (const list of deck.edhrec.container?.json_dict?.cardlists ?? []) {
        for (const cv of list.cardviews) recNames.add(cv.name);
      }
      await collection.resolveNames(Array.from(recNames));
      pickStage.value = "build";
      await deck.autoFillFromCollection();
    } else if (deck.error) {
      pickError.value = `EDHREC has no data for "${c.name}". The deck will be empty.`;
    }
    pickStage.value = "save";
    await deck.save();
    pickStage.value = "done";
    await navigateTo("/build");
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
    pickingId.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">Pick a commander</h1>
      <p class="text-neutral-400 text-sm">
        Only legendary creatures (and "can be your commander" cards) from your collection.
      </p>
    </div>

    <div v-if="collection.error" class="text-rose-400">{{ collection.error }}</div>

    <!-- The page renders immediately. While the commander catalog and the
         EDHREC rank batch are still in flight, the grid is empty and we
         show a slim inline status line — not a full-page loader. -->
    <input
      v-model="search"
      type="search"
      placeholder="Search..."
      aria-label="Search commanders"
      class="w-full max-w-md px-3 py-2 rounded bg-neutral-900 border border-neutral-700 focus:outline-none focus:border-emerald-500"
    />

    <div class="flex items-center gap-3 text-sm text-neutral-400 flex-wrap">
      <span v-if="candidates.length">
        {{ filtered.length }} candidates · ordered by EDHREC commander rank
      </span>
      <span
        v-if="loadingCatalog"
        class="inline-flex items-center gap-2 text-xs text-neutral-500"
      >
        <span class="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
        Loading commander catalog…
      </span>
      <span
        v-else-if="!ranksReady && candidates.length"
        class="inline-flex items-center gap-2 text-xs text-neutral-500"
      >
        <span class="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
        Fetching EDHREC ranks…
      </span>
    </div>

    <div v-if="pickError" class="text-rose-400 text-sm">{{ pickError }}</div>

    <div
      v-if="!loadingCatalog && !filtered.length"
      class="text-neutral-500 text-sm py-8"
    >
      {{
        candidates.length
          ? "No legendary creatures match."
          : "No legendary creatures in your collection yet."
      }}
    </div>

    <div
      v-else-if="filtered.length"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
    >
      <button
        v-for="c in filtered"
        :key="c.scryfallId"
        :disabled="pickingId !== null"
        class="relative text-left rounded-lg overflow-hidden border border-neutral-800 hover:border-emerald-500 transition-colors bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
        @click="pick(c)"
      >
        <CardImage :name="c.name" :scryfall-id="c.scryfallId" size="normal" hover-preview />
        <span
          v-if="rankFor(c.scryfallId) !== null"
          class="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-amber-300 text-[10px] font-semibold tabular-nums shadow ring-1 ring-black/40"
          title="EDHREC commander rank"
        >
          #{{ rankFor(c.scryfallId)?.toLocaleString() }}
        </span>
        <div class="p-2">
          <div class="font-medium text-sm truncate">{{ c.name }}</div>
          <div class="text-xs text-neutral-500 flex items-center gap-2">
            <span>{{ c.scryfall?.type_line }}</span>
          </div>
          <div class="text-xs mt-1 flex gap-1">
            <span
              v-for="color in c.scryfall?.color_identity ?? []"
              :key="color"
              :class="`mana-${color}`"
              class="w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold"
            >{{ color }}</span>
            <span v-if="!c.scryfall?.color_identity?.length" class="mana-C w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold">C</span>
          </div>
        </div>
      </button>
    </div>

    <DeckBuildingOverlay
      :show="pickingId !== null"
      :commander-name="pickingName"
      :commander-scryfall-id="pickingScryfallId"
      :stage="pickStage"
      :prepare-loaded="collection.resolveProgress?.loaded"
      :prepare-total="collection.resolveProgress?.total"
    />
  </div>
</template>
