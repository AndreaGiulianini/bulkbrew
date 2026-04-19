<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  name: string;
  scryfallId?: string;
  size?: "small" | "normal" | "large";
  hoverPreview?: boolean;
}>();

const resolvedSize = computed(() => props.size ?? "normal");

function buildSrc(size: "small" | "normal" | "large") {
  if (props.scryfallId) {
    const prefix = props.scryfallId.slice(0, 2);
    return `https://cards.scryfall.io/${size}/front/${prefix[0]}/${prefix[1]}/${props.scryfallId}.jpg`;
  }
  return `https://api.scryfall.com/cards/named?format=image&exact=${encodeURIComponent(props.name)}&version=${size}`;
}

const src = computed(() => buildSrc(resolvedSize.value));
const previewSrc = computed(() => buildSrc("normal"));

const hovered = ref(false);
const anchor = ref<HTMLImageElement | null>(null);
const previewStyle = ref<{ top: string; left: string } | null>(null);

function onEnter() {
  if (!props.hoverPreview) return;
  // Skip on touch-only devices to avoid sticky previews after taps.
  if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches) return;
  const el = anchor.value;
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

function onLeave() {
  hovered.value = false;
}
</script>

<template>
  <img
    ref="anchor"
    :src="src"
    :alt="name"
    loading="lazy"
    class="rounded-lg shadow"
    @error="($event.target as HTMLImageElement).style.opacity = '0.3'"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  />
  <Teleport v-if="hoverPreview" to="body">
    <img
      v-if="hovered && previewStyle"
      :src="previewSrc"
      :alt="name"
      class="fixed z-[100] w-80 rounded-lg shadow-2xl pointer-events-none ring-1 ring-black/50"
      :style="previewStyle"
    />
  </Teleport>
</template>
