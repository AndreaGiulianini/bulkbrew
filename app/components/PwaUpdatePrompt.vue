<script setup lang="ts">
// Update toast for the service worker. `usePWA()` is auto-imported by
// @vite-pwa/nuxt and exposes reactive `needRefresh` + `updateServiceWorker`.
// Returns undefined when the SW isn't enabled (e.g. dev mode), in which
// case the prompt simply never renders.
const pwa = usePWA();

async function reload() {
  await pwa?.updateServiceWorker(true);
}

async function dismiss() {
  await pwa?.cancelPrompt();
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-150"
      enter-from-class="opacity-0 translate-y-2"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="pwa?.needRefresh"
        role="status"
        aria-live="polite"
        class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 px-4 py-2.5 rounded-lg bg-neutral-900 ring-1 ring-emerald-700/60 shadow-2xl text-sm"
      >
        <span class="text-emerald-400" aria-hidden="true">⟳</span>
        <span class="text-neutral-200">New version available.</span>
        <button
          class="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
          @click="reload"
        >
          Reload
        </button>
        <button
          class="px-2 py-1 text-neutral-400 hover:text-white text-xs transition-colors"
          aria-label="Dismiss update prompt"
          @click="dismiss"
        >
          Later
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
