<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  show: boolean;
  commanderName: string;
  commanderScryfallId?: string;
  stage: "recs" | "build" | "save" | "done";
}>();

const stages = [
  { key: "recs", label: "Consulting EDHREC" },
  { key: "build", label: "Assembling deck" },
  { key: "save", label: "Saving session" },
] as const;

const activeIndex = computed(() => stages.findIndex((s) => s.key === props.stage));
const progress = computed(() => {
  if (props.stage === "done") return 100;
  return ((activeIndex.value + 1) / stages.length) * 100;
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6"
      >
        <div class="relative">
          <div class="absolute inset-[-18px] rounded-2xl border-4 border-emerald-500/30 border-t-emerald-400 animate-spin-slow" />
          <div class="absolute inset-[-2px] rounded-lg ring-2 ring-emerald-400/60 shadow-[0_0_40px_rgba(112,162,136,0.5)]" />
          <div class="relative w-60 rounded-lg overflow-hidden animate-pulse-soft">
            <CardImage
              :name="commanderName"
              :scryfall-id="commanderScryfallId"
              size="normal"
              eager
            />
          </div>
        </div>

        <div class="mt-8 text-center space-y-2 max-w-md">
          <div class="text-xs uppercase tracking-[0.2em] text-emerald-400">
            Brewing deck
          </div>
          <div class="text-xl font-bold text-white">{{ commanderName }}</div>
          <div class="text-sm text-neutral-400 h-5">
            <span>{{ stages[activeIndex]?.label ?? "Finalising" }}</span>
            <span class="inline-block w-6 text-left">
              <span class="animate-dot-1">.</span>
              <span class="animate-dot-2">.</span>
              <span class="animate-dot-3">.</span>
            </span>
          </div>
        </div>

        <div class="mt-4 w-72 h-1 rounded-full bg-neutral-800 overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-500 ease-out"
            :style="{ width: `${progress}%` }"
          />
        </div>

        <div class="mt-3 flex gap-1">
          <div
            v-for="(s, i) in stages"
            :key="s.key"
            class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
            :class="
              i < activeIndex
                ? 'bg-emerald-900/60 text-emerald-300'
                : i === activeIndex
                  ? 'bg-emerald-600/80 text-white shadow-[0_0_10px_rgba(112,162,136,0.6)]'
                  : 'bg-neutral-800 text-neutral-500'
            "
          >
            {{ s.label }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@keyframes spin-slow {
  to { transform: rotate(360deg); }
}
.animate-spin-slow {
  animation: spin-slow 2.4s linear infinite;
}

@keyframes pulse-soft {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}
.animate-pulse-soft {
  animation: pulse-soft 2s ease-in-out infinite;
}

@keyframes dot-bounce {
  0%, 80%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
}
.animate-dot-1 { animation: dot-bounce 1.4s ease-in-out infinite; }
.animate-dot-2 { animation: dot-bounce 1.4s ease-in-out 0.2s infinite; }
.animate-dot-3 { animation: dot-bounce 1.4s ease-in-out 0.4s infinite; }
</style>
