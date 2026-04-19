<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useCollectionStore } from "~/stores/collection";
import { useDeckStore } from "~/stores/deck";
import { useSessionsStore } from "~/stores/sessions";

const sessions = useSessionsStore();
const collection = useCollectionStore();
const deck = useDeckStore();

const collectionText = ref("");
const collectionFileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importError = ref<string | null>(null);
const importedAt = ref<string | null>(null);
const importNotFound = ref<string[]>([]);
const dragOver = ref(false);

onMounted(async () => {
  await Promise.all([sessions.refresh(), collection.load()]);
});

async function open(sessionId: string) {
  const s = sessions.sessions.find((x) => x.id === sessionId);
  if (!s) return;
  deck.loadSession(s);
  await navigateTo("/build");
}

async function remove(id: string) {
  await sessions.remove(id);
}

async function onFilePicked(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  target.value = "";
  if (!file) return;
  try {
    collectionText.value = await file.text();
    importError.value = null;
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  }
}

async function onFileDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files?.[0] ?? null;
  if (!file) return;
  try {
    collectionText.value = await file.text();
    importError.value = null;
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  }
}

function pickFile() {
  collectionFileInput.value?.click();
}

async function importCollection() {
  if (!collectionText.value.trim()) {
    importError.value = "Upload a file or paste your card list first.";
    return;
  }
  importError.value = null;
  importNotFound.value = [];
  importing.value = true;
  try {
    const { notFound } = await collection.importFromText(collectionText.value);
    importedAt.value = new Date().toLocaleTimeString();
    importNotFound.value = notFound;
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Hero -->
    <section class="rounded-xl bg-gradient-to-br from-emerald-950/40 via-neutral-900 to-amber-950/30 border border-neutral-800 p-5 sm:p-7 relative">
      <a
        href="https://github.com/AndreaGiulianini/bulkbrew"
        target="_blank"
        rel="noopener noreferrer"
        class="absolute top-4 right-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/50 border border-neutral-800 text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
        aria-label="BulkBrew on GitHub"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          class="w-4 h-4 fill-current"
        >
          <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.08-.12-.3-.52-1.48.11-3.08 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.6.23 2.78.12 3.08.74.8 1.19 1.82 1.19 3.08 0 4.42-2.7 5.39-5.26 5.68.41.35.78 1.04.78 2.1 0 1.52-.01 2.75-.01 3.12 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
        </svg>
        <span>GitHub</span>
      </a>
      <h1 class="text-2xl sm:text-3xl font-bold pr-24">
        Turn your bulk into Commander decks
      </h1>
      <p class="text-neutral-300 text-sm sm:text-base mt-1 max-w-2xl">
        BulkBrew reads your card collection and builds playable EDH decks around any
        commander you own, using EDHREC's per-commander averages so the mana base,
        curve, and card types come out right. Cards you don't have are flagged as
        missing so you know exactly what to buy.
      </p>
      <ol class="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
        <li class="rounded-lg bg-black/30 border border-neutral-800 p-3">
          <div class="text-emerald-400 text-xs uppercase tracking-wider">1. Import</div>
          <div class="text-neutral-200 font-medium mt-0.5">Your collection</div>
          <div class="text-neutral-500 text-xs mt-1">Upload a CSV or paste your card list.</div>
        </li>
        <li class="rounded-lg bg-black/30 border border-neutral-800 p-3">
          <div class="text-amber-400 text-xs uppercase tracking-wider">2. Choose</div>
          <div class="text-neutral-200 font-medium mt-0.5">A commander</div>
          <div class="text-neutral-500 text-xs mt-1">Pick a legendary from your collection, ordered by EDHREC popularity.</div>
        </li>
        <li class="rounded-lg bg-black/30 border border-neutral-800 p-3">
          <div class="text-sky-400 text-xs uppercase tracking-wider">3. Build</div>
          <div class="text-neutral-200 font-medium mt-0.5">Auto-fill &amp; refine</div>
          <div class="text-neutral-500 text-xs mt-1">Tune land count, synergy, CMC, and see exactly what's missing.</div>
        </li>
      </ol>
    </section>

    <!-- Step 1: Import your collection -->
    <section
      class="rounded-xl border bg-neutral-900 p-4 sm:p-5 transition-colors"
      :class="[
        dragOver ? 'border-emerald-500 ring-2 ring-emerald-500' : 'border-neutral-800',
        collection.count ? '' : 'ring-1 ring-amber-500/40',
      ]"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onFileDrop"
    >
      <header class="flex items-start gap-3 mb-3">
        <span
          class="flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold shrink-0"
          :class="collection.count ? 'bg-emerald-600/80 text-white' : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50'"
        >
          {{ collection.count ? "✓" : "1" }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 class="font-semibold text-neutral-100 text-lg">Import your collection</h2>
            <span v-if="collection.loading" class="text-xs text-neutral-500">Loading…</span>
            <span v-else-if="collection.count" class="text-xs text-emerald-400">
              {{ collection.count }} unique · {{ collection.totalCopies }} copies owned
            </span>
            <span v-else class="text-xs text-amber-400">Empty — do this first</span>
          </div>
          <p class="text-xs text-neutral-400 mt-1">
            Accepts a ManaBox CSV, a Moxfield collection export, or any plain-text list like
            <code class="text-neutral-200">1 Sol Ring</code>. Drag a file onto this card, pick one below, or paste directly.
          </p>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-2 mb-2">
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 inline-flex items-center gap-1.5"
          @click="pickFile"
        >
          📄 Choose file
        </button>
        <span class="text-xs text-neutral-500">.csv, .txt, .dec, or plain text</span>
      </div>
      <input
        ref="collectionFileInput"
        type="file"
        accept=".csv,.txt,.dec,text/csv,text/plain"
        class="hidden"
        aria-label="Choose collection file"
        @change="onFilePicked"
      />
      <textarea
        v-model="collectionText"
        rows="5"
        spellcheck="false"
        placeholder="1 Sol Ring
4 Forest
1 Atraxa, Praetors' Voice
…"
        aria-label="Collection list"
        class="w-full px-3 py-2 rounded bg-neutral-950 border border-neutral-700 focus:outline-none focus:border-emerald-500 font-mono text-xs resize-y"
      />
      <div class="flex items-center gap-3 flex-wrap mt-2">
        <button
          type="button"
          :disabled="importing"
          class="inline-flex items-center px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium"
          @click="importCollection"
        >
          {{ importing ? "Importing…" : "Import collection" }}
        </button>
        <span v-if="importError" class="text-rose-400 text-sm">{{ importError }}</span>
        <span v-else-if="importedAt" class="text-emerald-400 text-sm">✓ Imported at {{ importedAt }}</span>
      </div>
      <div
        v-if="importNotFound.length"
        class="mt-3 rounded border border-amber-500/40 bg-amber-950/30 p-3 text-xs"
      >
        <div class="text-amber-300 font-semibold mb-1">
          ⚠ {{ importNotFound.length }} card{{ importNotFound.length === 1 ? "" : "s" }} couldn't be matched on Scryfall and were skipped:
        </div>
        <div class="text-neutral-300 break-words">
          {{ importNotFound.slice(0, 15).join(", ") }}{{ importNotFound.length > 15 ? `, … (+${importNotFound.length - 15} more)` : "" }}
        </div>
        <div class="text-neutral-500 mt-1">
          Double-check spelling (incl. split cards like "Fire // Ice") and re-import if needed.
        </div>
      </div>
    </section>

    <!-- Step 2: Build a deck -->
    <section
      class="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5"
      :class="collection.count ? '' : 'opacity-60'"
    >
      <header class="flex items-start gap-3 mb-3">
        <span
          class="flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold shrink-0"
          :class="collection.count ? 'bg-amber-500/90 text-neutral-900' : 'bg-neutral-800 text-neutral-500'"
        >
          2
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold text-neutral-100 text-lg">Build a deck</h2>
          <p class="text-xs text-neutral-400 mt-1">
            <span v-if="collection.count">
              Pick a legendary creature from your collection. BulkBrew auto-fills the
              rest using EDHREC's per-commander averages.
            </span>
            <span v-else>
              You'll be able to start a deck once your collection is imported above.
            </span>
          </p>
        </div>
      </header>
      <NuxtLink
        v-if="collection.count"
        to="/commander"
        class="inline-flex items-center px-4 py-2 rounded font-medium text-white bg-emerald-600 hover:bg-emerald-500"
      >
        + New deck from commander →
      </NuxtLink>
      <span
        v-else
        aria-disabled="true"
        class="inline-flex items-center px-4 py-2 rounded font-medium text-neutral-400 bg-neutral-800 cursor-not-allowed select-none"
        title="Import your collection first"
      >
        + New deck from commander →
      </span>
    </section>

    <!-- Saved sessions -->
    <section>
      <h2 class="text-lg font-semibold mb-2">Saved sessions</h2>
      <div v-if="sessions.error" class="text-rose-400 text-sm mb-2">
        Failed to load sessions: {{ sessions.error }}
      </div>
      <div v-if="!sessions.sessions.length && !sessions.error" class="text-neutral-500 text-sm">
        No saved sessions yet.
      </div>
      <ul v-else class="divide-y divide-neutral-800 border border-neutral-800 rounded">
        <li
          v-for="s in sessions.sessions"
          :key="s.id"
          class="flex items-stretch justify-between hover:bg-neutral-900"
        >
          <button
            type="button"
            class="flex-1 text-left px-4 py-3 min-w-0"
            @click="open(s.id)"
          >
            <div class="font-medium truncate">{{ s.name }}</div>
            <div class="text-xs text-neutral-500 truncate">
              {{ s.commanderName }} · {{ s.cards.length }}/100 cards · updated {{ new Date(s.updatedAt).toLocaleString() }}
            </div>
          </button>
          <button
            type="button"
            class="px-4 text-rose-400 text-sm hover:text-rose-300 hover:bg-rose-950/40 border-l border-neutral-800"
            @click="remove(s.id)"
          >
            Delete
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
