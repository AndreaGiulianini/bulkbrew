<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";

const collection = useCollectionStore();
const search = ref("");

onMounted(async () => {
  await collection.load();
});

// Cap the grid to 500 tiles — even with IntersectionObserver lazy-loading,
// rendering 1000+ DOM nodes before the user has searched is overkill.
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return collection.cards.slice(0, 500);
  return collection.cards.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 500);
});

// Scryfall's human page lives at /card/<set>/<collector-number>. Every
// ManaBox import carries those fields per copy, so we build the URL from
// the first copy rather than reaching for a live Scryfall lookup.
function scryfallUrl(card: (typeof collection.cards)[number]): string {
  const primary = card.copies[0];
  if (primary?.setCode && primary?.collectorNumber) {
    return `https://scryfall.com/card/${primary.setCode.toLowerCase()}/${primary.collectorNumber}`;
  }
  // Fallback: query by name so even plain-text imports (no set data) link out.
  return `https://scryfall.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`;
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Collection</h1>
    <div v-if="collection.loading" class="text-neutral-400">Loading...</div>
    <div v-else-if="collection.error" class="text-rose-400">{{ collection.error }}</div>
    <template v-else>
      <div class="text-sm text-neutral-400">
        {{ collection.count }} unique · {{ collection.totalCopies }} total
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search cards..."
        aria-label="Search your collection"
        class="w-full max-w-md px-3 py-2 rounded bg-neutral-900 border border-neutral-700 focus:outline-none focus:border-emerald-500"
      />
      <div class="text-xs text-neutral-500">
        Showing {{ filtered.length }}{{
          !search && collection.cards.length > 500 ? " (first 500, search to filter)" : ""
        }}
      </div>
      <div
        v-if="filtered.length"
        class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3"
      >
        <a
          v-for="c in filtered"
          :key="c.scryfallId"
          :href="scryfallUrl(c)"
          target="_blank"
          rel="noopener noreferrer"
          :title="`${c.name} — view on Scryfall`"
          class="relative block rounded-lg overflow-hidden ring-1 ring-neutral-800 hover:ring-emerald-500 focus:ring-emerald-500 focus:outline-none transition-shadow"
        >
          <CardImage
            :name="c.name"
            :scryfall-id="c.scryfallId"
            size="small"
            hover-preview
          />
          <span
            v-if="c.quantity > 1"
            class="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-emerald-300 text-[10px] font-semibold tabular-nums shadow ring-1 ring-black/40"
          >×{{ c.quantity }}</span>
          <span
            v-if="c.copies[0]?.setCode"
            class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-neutral-300 text-[10px] uppercase tracking-wider shadow ring-1 ring-black/40"
          >{{ c.copies[0].setCode }}</span>
        </a>
      </div>
      <div v-else class="text-neutral-500 text-sm py-8 text-center">
        No cards match "{{ search }}".
      </div>
    </template>
  </div>
</template>
