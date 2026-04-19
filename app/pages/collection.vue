<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";

const collection = useCollectionStore();
const search = ref("");

onMounted(async () => {
  await collection.load();
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return collection.cards.slice(0, 500);
  return collection.cards.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 500);
});
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
        Showing {{ filtered.length }}{{ !search && collection.cards.length > 500 ? " (first 500, search to filter)" : "" }}
      </div>
      <ul class="divide-y divide-neutral-800 border border-neutral-800 rounded">
        <li
          v-for="c in filtered"
          :key="c.scryfallId"
          class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-900"
        >
          <span class="flex-1">{{ c.name }}</span>
          <span v-if="c.quantity > 1" class="text-xs text-emerald-400">×{{ c.quantity }}</span>
          <span class="text-xs text-neutral-500">{{ c.copies[0]?.setCode }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
