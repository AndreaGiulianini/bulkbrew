<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  name: string;
  scryfallId?: string;
  inclusion?: number;
  numDecks?: number;
  potentialDecks?: number;
  owned?: boolean;
  ownedQuantity?: number;
  buyAdvice?: "staple" | "high-synergy" | "substitutable";
  inDeck?: boolean;
}>();

const emit = defineEmits<{
  add: [];
  remove: [];
}>();

const hovered = ref(false);
const root = ref<HTMLElement | null>(null);
const previewStyle = ref<{ top: string; left: string } | null>(null);

const pct = computed(() => {
  if (!props.numDecks || !props.potentialDecks) return null;
  return Math.round((props.numDecks / props.potentialDecks) * 100);
});

const adviceLabel = computed(() => {
  if (!props.buyAdvice) return null;
  if (props.buyAdvice === "staple")
    return { text: "Buy (staple)", cls: "bg-rose-900/50 text-rose-300" };
  if (props.buyAdvice === "high-synergy")
    return { text: "Buy (synergy)", cls: "bg-amber-900/50 text-amber-300" };
  return { text: "Skippable", cls: "bg-neutral-800 text-neutral-400" };
});

function onEnter() {
  if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches) return;
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const previewWidth = 320;
  const previewHeight = 448;
  const margin = 12;

  let left = rect.right + margin;
  if (left + previewWidth > window.innerWidth) {
    left = rect.left - previewWidth - margin;
  }
  if (left < margin) left = margin;

  let top = rect.top;
  if (top + previewHeight > window.innerHeight) {
    top = Math.max(margin, window.innerHeight - previewHeight - margin);
  }

  previewStyle.value = { top: `${top}px`, left: `${left}px` };
  hovered.value = true;
}
</script>

<template>
  <div
    ref="root"
    class="relative group rounded-md border px-2 py-1.5 text-sm flex items-center gap-2 cursor-pointer transition-colors"
    :class="[
      owned ? 'border-emerald-700 bg-emerald-950/30 hover:bg-emerald-900/40' : 'border-neutral-700 bg-neutral-900 hover:bg-neutral-800',
      inDeck && 'ring-1 ring-amber-500',
    ]"
    @mouseenter="onEnter"
    @mouseleave="hovered = false"
    @click="inDeck ? emit('remove') : emit('add')"
  >
    <span class="flex-1 truncate">
      {{ name }}
      <span v-if="owned && ownedQuantity && ownedQuantity > 1" class="text-emerald-400 text-xs">×{{ ownedQuantity }}</span>
    </span>
    <span v-if="pct !== null" class="text-xs text-neutral-400 tabular-nums shrink-0">{{ pct }}%</span>
    <span v-if="adviceLabel" class="text-[10px] px-1.5 py-0.5 rounded shrink-0" :class="adviceLabel.cls">{{ adviceLabel.text }}</span>
    <span v-if="inDeck" class="text-amber-400 text-xs shrink-0">✓ in deck</span>

    <Teleport to="body">
      <div
        v-if="hovered && previewStyle"
        class="fixed z-[100] w-80 pointer-events-none"
        :style="previewStyle"
      >
        <CardImage :name="name" :scryfall-id="scryfallId" size="normal" />
      </div>
    </Teleport>
  </div>
</template>
