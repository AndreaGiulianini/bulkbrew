<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";
import { useDeckStore } from "~/stores/deck";
import { edhrecSlug } from "~/utils/slug";

const collection = useCollectionStore();
const deck = useDeckStore();
const search = ref("");
const pickingId = ref<string | null>(null);
const pickError = ref<string | null>(null);
const pickingName = ref("");
const pickingScryfallId = ref<string | undefined>(undefined);
const pickStage = ref<"recs" | "build" | "save" | "done">("recs");

// Live EDHREC commander ranks, keyed by slug. Populated asynchronously after
// mount so the initial render isn't blocked. Scryfall's edhrec_rank is used as
// a placeholder until the live value arrives.
const liveRanks = ref<Record<string, number | null>>({});
const ranksLoading = ref(false);

onMounted(async () => {
  await collection.load();
  void loadLiveRanks();
});

async function loadLiveRanks() {
  const slugs = Array.from(
    new Set(collection.legendaryCreatures.map((c) => edhrecSlug(c.name))),
  ).filter(Boolean);
  if (!slugs.length) return;
  ranksLoading.value = true;
  try {
    const resp = await $fetch<{ ranks: Record<string, number | null> }>("/api/edhrec/ranks", {
      method: "POST",
      body: { slugs },
    });
    liveRanks.value = resp.ranks;
  } catch {
    // Silent — we fall back to Scryfall's rank per-card.
  } finally {
    ranksLoading.value = false;
  }
}

function rankFor(name: string, scryfallRank: number | undefined): number | null {
  const live = liveRanks.value[edhrecSlug(name)];
  if (typeof live === "number") return live;
  return scryfallRank ?? null;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = [...collection.legendaryCreatures].sort((a, b) => {
    const ra = rankFor(a.name, a.scryfall?.edhrec_rank) ?? Number.POSITIVE_INFINITY;
    const rb = rankFor(b.name, b.scryfall?.edhrec_rank) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  if (!q) return all;
  return all.filter((c) => c.name.toLowerCase().includes(q));
});

async function pick(c: (typeof collection.legendaryCreatures)[number]) {
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
      scryfall: c.scryfall,
    });
    await deck.fetchRecs();
    pickStage.value = "build";
    if (deck.edhrec) {
      deck.autoFillFromCollection();
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

    <div v-if="collection.loading" class="text-neutral-400">Loading collection...</div>
    <div v-else-if="collection.error" class="text-rose-400">{{ collection.error }}</div>
    <template v-else>
      <input
        v-model="search"
        type="search"
        placeholder="Search..."
        aria-label="Search commanders"
        class="w-full max-w-md px-3 py-2 rounded bg-neutral-900 border border-neutral-700 focus:outline-none focus:border-emerald-500"
      />
      <div class="text-sm text-neutral-400 flex items-center gap-2 flex-wrap">
        <span>{{ filtered.length }} candidates · ordered by EDHREC commander rank</span>
        <span v-if="ranksLoading" class="text-xs text-neutral-500 animate-pulse">refreshing ranks…</span>
      </div>
      <div v-if="pickError" class="text-rose-400 text-sm">{{ pickError }}</div>

      <div v-if="!filtered.length" class="text-neutral-500">
        No legendary creatures match.
      </div>
      <div
        v-else
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
            v-if="rankFor(c.name, c.scryfall?.edhrec_rank) !== null"
            class="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-amber-300 text-[10px] font-semibold tabular-nums shadow ring-1 ring-black/40"
            title="EDHREC commander rank"
          >
            #{{ rankFor(c.name, c.scryfall?.edhrec_rank)?.toLocaleString() }}
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
    </template>

    <DeckBuildingOverlay
      :show="pickingId !== null"
      :commander-name="pickingName"
      :commander-scryfall-id="pickingScryfallId"
      :stage="pickStage"
    />
  </div>
</template>
