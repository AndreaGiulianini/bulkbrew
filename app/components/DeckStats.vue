<script setup lang="ts">
import { computed } from "vue";
import type { DeckStats } from "~~/shared/types";

const props = defineProps<{
  stats: DeckStats;
}>();

const curveMax = computed(() => Math.max(1, ...props.stats.curve));
const totalPips = computed(() => {
  const p = props.stats.pips;
  return p.W + p.U + p.B + p.R + p.G + p.C;
});

// EDH casual norms — matches the DEFAULT_RULES.roleTargets in the deck store.
// Kept local to the component so the UI can turn a count amber/emerald without
// needing access to the store's current rules.
const ROLE_TARGETS = { ramp: 8, draw: 8, removal: 5, wipe: 2 } as const;
const ROLE_LABELS: Array<{ key: keyof typeof ROLE_TARGETS; label: string }> = [
  { key: "ramp", label: "Ramp" },
  { key: "draw", label: "Draw" },
  { key: "removal", label: "Removal" },
  { key: "wipe", label: "Wipes" },
];
</script>

<template>
  <div class="space-y-3 text-xs">
    <!-- Type counts -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div class="px-2 py-1 rounded bg-neutral-800">
        <div class="text-neutral-500 text-[10px] uppercase">Creatures</div>
        <div class="font-semibold">{{ stats.creatures }}</div>
      </div>
      <div class="px-2 py-1 rounded bg-neutral-800">
        <div class="text-neutral-500 text-[10px] uppercase">Lands</div>
        <div class="font-semibold" :class="stats.lands < 35 ? 'text-amber-400' : 'text-emerald-400'">
          {{ stats.lands }}
        </div>
      </div>
      <div class="px-2 py-1 rounded bg-neutral-800">
        <div class="text-neutral-500 text-[10px] uppercase">Spells</div>
        <div class="font-semibold">{{ stats.instants + stats.sorceries }}</div>
      </div>
      <div class="px-2 py-1 rounded bg-neutral-800">
        <div class="text-neutral-500 text-[10px] uppercase">Avg CMC</div>
        <div class="font-semibold tabular-nums">{{ stats.avgCmc.toFixed(1) }}</div>
      </div>
    </div>

    <!-- Secondary -->
    <div class="flex gap-2 flex-wrap text-[11px] text-neutral-400">
      <span v-if="stats.artifacts">{{ stats.artifacts }} artifacts</span>
      <span v-if="stats.enchantments">{{ stats.enchantments }} enchantments</span>
      <span v-if="stats.planeswalkers">{{ stats.planeswalkers }} planeswalkers</span>
      <span v-if="stats.battles">{{ stats.battles }} battles</span>
      <span v-if="stats.other">{{ stats.other }} other</span>
    </div>

    <!-- Functional roles -->
    <div>
      <div class="text-neutral-500 text-[10px] uppercase mb-1">Functional roles</div>
      <div class="flex gap-2 flex-wrap text-[11px]">
        <span
          v-for="r in ROLE_LABELS"
          :key="r.key"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800"
          :title="`Target: ${ROLE_TARGETS[r.key]}`"
        >
          <span class="text-neutral-500">{{ r.label }}</span>
          <span
            class="font-semibold tabular-nums"
            :class="stats.roles[r.key] >= ROLE_TARGETS[r.key] ? 'text-emerald-400' : 'text-amber-400'"
          >
            {{ stats.roles[r.key] }}<span class="text-neutral-600">/{{ ROLE_TARGETS[r.key] }}</span>
          </span>
        </span>
      </div>
    </div>

    <!-- Mana curve -->
    <div>
      <div class="text-neutral-500 text-[10px] uppercase mb-1">Mana curve (non-land)</div>
      <div class="flex items-end gap-1 h-16">
        <div
          v-for="(count, i) in stats.curve"
          :key="i"
          class="flex-1 flex flex-col items-center justify-end gap-0.5"
        >
          <span class="text-[10px] text-neutral-500 tabular-nums">{{ count || "" }}</span>
          <div
            class="w-full bg-emerald-700/70 rounded-t"
            :style="{ height: `${(count / curveMax) * 100}%`, minHeight: count ? '2px' : '0' }"
          />
          <span class="text-[10px] text-neutral-400 tabular-nums">
            {{ i === 7 ? "7+" : i }}
          </span>
        </div>
      </div>
    </div>

    <!-- Color pips -->
    <div v-if="totalPips > 0">
      <div class="text-neutral-500 text-[10px] uppercase mb-1">Color identity sources</div>
      <div class="flex h-2 rounded overflow-hidden bg-neutral-800">
        <div
          v-for="color in ['W', 'U', 'B', 'R', 'G', 'C'] as const"
          :key="color"
          :class="`mana-${color}`"
          :style="{ width: `${(stats.pips[color] / totalPips) * 100}%` }"
        />
      </div>
      <div class="flex gap-2 mt-1 text-[10px] text-neutral-400">
        <span v-for="color in ['W', 'U', 'B', 'R', 'G', 'C'] as const" :key="color" v-show="stats.pips[color] > 0">
          {{ color }} {{ stats.pips[color] }}
        </span>
      </div>
    </div>
  </div>
</template>
