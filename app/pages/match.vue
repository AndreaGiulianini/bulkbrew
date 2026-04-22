<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";
import { useDeckStore } from "~/stores/deck";
import { runWithConcurrency } from "~/utils/concurrency";
import { getColorBucketedTopCommanders, getCommanderPage } from "~/utils/edhrec";
import { collectionFingerprint, scoreCommander } from "~/utils/match";
import { readCache, writeCache } from "~/utils/storage";
import type { CommanderMatchResult, TopCommander } from "~~/shared/types";

const collection = useCollectionStore();
const deck = useDeckStore();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const POOL_SIZE = 500;
const SCORE_CONCURRENCY = 4;
const FAILURE_CIRCUIT_BREAK = 2;

const results = ref<CommanderMatchResult[]>([]);
const total = ref(0);
const completed = ref(0);
const analyzing = ref(false);
const error = ref<string | null>(null);
const stoppedEarly = ref(false);
const fromCache = ref(false);
const displayLimit = ref(30);

const pickingSlug = ref<string | null>(null);
const pickingName = ref("");
const pickingScryfallId = ref<string | undefined>(undefined);
const pickStage = ref<"recs" | "prepare" | "build" | "save" | "done">("recs");
const pickError = ref<string | null>(null);

onMounted(async () => {
  await collection.load();
});

const visible = computed(() => results.value.slice(0, displayLimit.value));
const progressPct = computed(() => (total.value ? (completed.value / total.value) * 100 : 0));

const fingerprint = computed(() => collectionFingerprint(collection.cards.map((c) => c.name)));

async function analyze() {
  if (analyzing.value || !collection.cards.length) return;
  analyzing.value = true;
  error.value = null;
  stoppedEarly.value = false;
  fromCache.value = false;
  results.value = [];
  completed.value = 0;
  total.value = 0;
  displayLimit.value = 30;

  try {
    // Cached ranked list keyed by collection fingerprint. Once analyzed,
    // re-runs are instant unless the collection changed.
    const cacheKey = fingerprint.value;
    const cached = await readCache<CommanderMatchResult[]>("match", cacheKey, ONE_DAY_MS);
    if (cached?.length) {
      results.value = cached;
      total.value = cached.length;
      completed.value = cached.length;
      fromCache.value = true;
      return;
    }

    const pool = await getColorBucketedTopCommanders(POOL_SIZE);
    if (!pool.length) {
      error.value = "Couldn't load EDHREC's top commander list. Check your connection.";
      return;
    }
    total.value = pool.length;
    const nameSet = collection.nameSet;
    let consecutiveFailures = 0;
    const collected: CommanderMatchResult[] = [];

    await runWithConcurrency(pool, SCORE_CONCURRENCY, async (commander: TopCommander) => {
      if (consecutiveFailures >= FAILURE_CIRCUIT_BREAK) {
        // Circuit-broken: count remaining items as completed for the
        // progress bar but skip the work to avoid hammering EDHREC.
        completed.value += 1;
        return;
      }
      const page = await getCommanderPage(commander.slug);
      if (!page) {
        consecutiveFailures += 1;
        completed.value += 1;
        return;
      }
      consecutiveFailures = 0;
      const result = scoreCommander(commander, page, nameSet, collection.isOwned(commander.name));
      if (result) {
        collected.push(result);
        // Stream into the UI sorted descending. 500 small reactive updates
        // over ~60 s is well within Vue's budget.
        results.value = [...collected].sort((a, b) => b.buildability - a.buildability);
      }
      completed.value += 1;
    });

    if (consecutiveFailures >= FAILURE_CIRCUIT_BREAK) {
      stoppedEarly.value = true;
    }

    if (results.value.length) {
      await writeCache("match", cacheKey, results.value);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    analyzing.value = false;
  }
}

function showMore() {
  displayLimit.value = Math.min(results.value.length, displayLimit.value + 30);
}

function buildabilityColor(pct: number): string {
  if (pct >= 70) return "text-emerald-300";
  if (pct >= 40) return "text-amber-300";
  return "text-neutral-400";
}

function buildabilityBg(pct: number): string {
  if (pct >= 70) return "bg-emerald-950/60 ring-emerald-700/50";
  if (pct >= 40) return "bg-amber-950/50 ring-amber-700/40";
  return "bg-neutral-900 ring-neutral-700/40";
}

async function pickResult(r: CommanderMatchResult) {
  if (pickingSlug.value) return;
  pickingSlug.value = r.commander.slug;
  pickingName.value = r.commander.name;
  pickingScryfallId.value = r.commander.scryfallId;
  pickStage.value = "recs";
  pickError.value = null;

  try {
    const page = await getCommanderPage(r.commander.slug);
    if (!page) {
      pickError.value = `EDHREC has no page for "${r.commander.name}".`;
      pickingSlug.value = null;
      return;
    }
    const card = page.container?.json_dict?.card;
    const canonicalName = card?.name ?? r.commander.name;
    const scryfallId = card?.id ?? r.commander.scryfallId;
    const colorIdentity = card?.color_identity ?? [];

    deck.startSession({
      name: canonicalName,
      scryfallId,
      colorIdentity,
      ownedInCollection: collection.isOwned(canonicalName),
      slug: r.commander.slug,
    });
    await deck.fetchRecs();

    if (deck.edhrec) {
      pickStage.value = "prepare";
      const recNames = new Set<string>();
      for (const list of deck.edhrec.container?.json_dict?.cardlists ?? []) {
        for (const cv of list.cardviews) recNames.add(cv.name);
      }
      await collection.resolveNames(Array.from(recNames));
      pickStage.value = "build";
      deck.autoFillFromCollection();
    }

    pickStage.value = "save";
    await deck.save();
    pickStage.value = "done";
    await navigateTo("/build");
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
    pickingSlug.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">Find your best commander</h1>
      <p class="text-neutral-400 text-sm">
        BulkBrew scores EDHREC's top {{ POOL_SIZE }} commanders against your
        collection and ranks them by how complete each typical 99-card deck
        would be. Owned or not — if a $4 commander unlocks a 90%-built deck
        from your bulk, this will surface it.
      </p>
      <p class="text-neutral-500 text-xs mt-1">
        Inclusion-weighted, color-identity gated, basic lands excluded.
        Partner / Background pairs aren't supported yet.
      </p>
    </div>

    <div v-if="!collection.cards.length" class="text-neutral-500 text-sm py-4">
      Import a collection first.
      <NuxtLink to="/" class="text-emerald-400 hover:text-emerald-300 underline">
        Go to import →
      </NuxtLink>
    </div>

    <div v-else class="flex flex-wrap items-center gap-3">
      <button
        :disabled="analyzing"
        class="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold inline-flex items-center gap-2 transition-colors shadow-md shadow-emerald-900/40"
        @click="analyze"
      >
        <span aria-hidden="true">🔍</span>
        <span v-if="!analyzing">{{ results.length ? "Re-analyze" : "Analyze my collection" }}</span>
        <span v-else>Analyzing…</span>
      </button>

      <span
        v-if="analyzing"
        class="text-xs text-neutral-400 tabular-nums inline-flex items-center gap-2"
      >
        <span class="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
        Scoring {{ completed.toLocaleString() }} of {{ total.toLocaleString() }}
        ({{ Math.round(progressPct) }}%)
      </span>

      <span
        v-else-if="results.length"
        class="text-xs text-neutral-500"
        :title="fromCache ? 'Loaded from cache' : 'Freshly analyzed'"
      >
        {{ results.length }} commanders ranked
        <span v-if="fromCache" class="text-neutral-600">· cached</span>
      </span>
    </div>

    <div v-if="analyzing" class="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
      <div
        class="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-500 ease-out"
        :style="{ width: `${progressPct}%` }"
      />
    </div>

    <div v-if="error" class="text-rose-400 text-sm">{{ error }}</div>
    <div v-if="pickError" class="text-rose-400 text-sm">{{ pickError }}</div>
    <div
      v-if="stoppedEarly"
      class="text-amber-300 text-xs bg-amber-950/40 ring-1 ring-amber-700/40 rounded px-3 py-2"
    >
      Stopped early — EDHREC seems to be rate-limiting or down. Showing the
      partial result. Try again in a minute.
    </div>

    <div
      v-if="visible.length"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
    >
      <button
        v-for="(r, i) in visible"
        :key="r.commander.slug"
        :disabled="pickingSlug !== null"
        class="relative text-left rounded-lg overflow-hidden ring-1 hover:ring-emerald-500 transition-colors bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
        :class="buildabilityBg(r.buildability)"
        @click="pickResult(r)"
      >
        <CardImage
          :name="r.commander.name"
          :scryfall-id="r.commander.scryfallId"
          size="normal"
          hover-preview
        />
        <span
          class="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/85 text-amber-300 text-[10px] font-semibold tabular-nums shadow ring-1 ring-black/40"
          title="Rank in your buildability list"
        >
          #{{ i + 1 }}
        </span>
        <span
          class="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ring-1 shadow"
          :class="
            r.owned
              ? 'bg-emerald-950/85 text-emerald-200 ring-emerald-700/60'
              : 'bg-rose-950/85 text-rose-200 ring-rose-700/60'
          "
        >
          {{ r.owned ? "✓ Owned" : "Not owned" }}
        </span>
        <div class="p-2 space-y-1">
          <div class="font-medium text-sm truncate">{{ r.commander.name }}</div>
          <div class="flex items-baseline justify-between gap-2">
            <span
              class="text-2xl font-bold tabular-nums leading-none"
              :class="buildabilityColor(r.buildability)"
            >
              {{ Math.round(r.buildability) }}<span class="text-sm">%</span>
            </span>
            <span class="text-[10px] text-neutral-500 tabular-nums">
              {{ r.ownedCount }} / {{ r.topCount }}
            </span>
          </div>
        </div>
      </button>
    </div>

    <div v-if="visible.length && results.length > displayLimit" class="text-center pt-2">
      <button
        class="text-sm text-emerald-400 hover:text-emerald-300 underline"
        @click="showMore"
      >
        Show {{ Math.min(30, results.length - displayLimit) }} more
        ({{ results.length - displayLimit }} hidden)
      </button>
    </div>

    <div
      v-if="!analyzing && !results.length && collection.cards.length"
      class="text-neutral-500 text-sm py-4"
    >
      Click "Analyze my collection" to score the top {{ POOL_SIZE }} commanders.
      First run takes about a minute (then cached for a day).
    </div>

    <DeckBuildingOverlay
      :show="pickingSlug !== null"
      :commander-name="pickingName"
      :commander-scryfall-id="pickingScryfallId"
      :stage="pickStage"
      :prepare-loaded="collection.resolveProgress?.loaded"
      :prepare-total="collection.resolveProgress?.total"
    />
  </div>
</template>
