<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  name: string;
  scryfallId?: string;
  fromCollection: boolean;
  quantity?: number;
  removable?: boolean;
}>();

const emit = defineEmits<{ remove: [] }>();
const hovered = ref(false);
</script>

<template>
  <div
    class="relative group rounded overflow-hidden border-2 transition-colors"
    :class="fromCollection ? 'border-emerald-700/60' : 'border-rose-700/60'"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <CardImage :name="name" :scryfall-id="scryfallId" size="small" hover-preview />
    <div
      v-if="quantity && quantity > 1"
      class="absolute top-1 left-1 bg-black/80 text-amber-300 text-xs font-bold px-1.5 py-0.5 rounded"
    >
      ×{{ quantity }}
    </div>
    <button
      v-if="removable && hovered"
      class="absolute top-1 right-1 bg-rose-600 hover:bg-rose-500 text-white w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center shadow"
      @click="emit('remove')"
    >
      ×
    </button>
  </div>
</template>
