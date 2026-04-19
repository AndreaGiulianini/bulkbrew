<script setup lang="ts">
import { computed, ref } from "vue";
import type { DeckCardSource } from "~~/shared/types";

const props = defineProps<{
  name: string;
  scryfallId?: string;
  fromCollection: boolean;
  quantity?: number;
  removable?: boolean;
  source?: DeckCardSource;
}>();

const emit = defineEmits<{ remove: [] }>();
const hovered = ref(false);

// Small corner badge telling the user why this card is in their deck.
// EDHREC picks are the on-theme ones the auto-filler pulled from the
// commander's recommended lists; "filler" is anything that reached the
// deck only because it was an owned castable card ranked by global
// edhrec_rank. Commanders and manual adds aren't worth flagging.
const sourceBadge = computed(() => {
  if (props.source === "edhrec") {
    return {
      label: "★",
      title: "Matched an EDHREC recommendation for this commander",
      classes: "bg-emerald-600/90 text-white",
    } as const;
  }
  if (props.source === "filler") {
    return {
      label: "·",
      title: "Added as generic filler (not in the commander's EDHREC recommendations)",
      classes: "bg-amber-600/80 text-white",
    } as const;
  }
  return null;
});
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
    <div
      v-if="sourceBadge"
      :title="sourceBadge.title"
      :aria-label="sourceBadge.title"
      class="absolute bottom-1 left-1 w-5 h-5 rounded-full text-[11px] leading-none font-bold inline-flex items-center justify-center shadow ring-1 ring-black/40"
      :class="sourceBadge.classes"
    >
      {{ sourceBadge.label }}
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
