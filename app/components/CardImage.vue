<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  name: string;
  scryfallId?: string;
  size?: "small" | "normal" | "large";
  hoverPreview?: boolean;
  // Force-render without waiting for IntersectionObserver. Use for hero
  // images (commander portrait in /build) that should never visibly pop in.
  eager?: boolean;
}>();

const resolvedSize = computed(() => props.size ?? "normal");

function buildSrc(size: "small" | "normal" | "large") {
  if (props.scryfallId) {
    const prefix = props.scryfallId.slice(0, 2);
    return `https://cards.scryfall.io/${size}/front/${prefix[0]}/${prefix[1]}/${props.scryfallId}.jpg`;
  }
  return `https://api.scryfall.com/cards/named?format=image&exact=${encodeURIComponent(props.name)}&version=${size}`;
}

// Transparent 488x680 SVG — an MTG card's aspect ratio. Sets layout
// dimensions while the real image is pending so the grid doesn't reflow
// when images resolve.
const PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20488%20680%22%2F%3E";

const realSrc = computed(() => buildSrc(resolvedSize.value));
const previewSrc = computed(() => buildSrc("normal"));

// Don't download the image until it (or its ~300 px runway) enters the
// viewport. Browsers without IntersectionObserver fall back to eager load.
const visible = ref(
  props.eager === true ||
    typeof window === "undefined" ||
    typeof IntersectionObserver === "undefined",
);
const currentSrc = computed(() => (visible.value ? realSrc.value : PLACEHOLDER));

const hovered = ref(false);
const anchor = ref<HTMLImageElement | null>(null);
const previewStyle = ref<{ top: string; left: string } | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (visible.value || !anchor.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.value = true;
          observer?.disconnect();
          observer = null;
          return;
        }
      }
    },
    { rootMargin: "300px" },
  );
  observer.observe(anchor.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

function onEnter() {
  if (!props.hoverPreview || !visible.value) return;
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
    :src="currentSrc"
    :alt="name"
    loading="lazy"
    decoding="async"
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
