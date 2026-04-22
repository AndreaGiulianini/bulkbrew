<template>
  <div class="min-h-screen">
    <header class="border-b border-neutral-800 bg-neutral-950">
      <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3">
        <NuxtLink
          to="/"
          class="shrink-0 font-display font-bold text-xl sm:text-2xl tracking-wide leading-none"
        >
          <span class="text-emerald-400">Bulk</span><span class="text-amber-400">Brew</span>
        </NuxtLink>
        <nav class="flex gap-3 sm:gap-4 text-xs sm:text-sm text-neutral-300">
          <NuxtLink to="/" class="hover:text-white">Sessions</NuxtLink>
          <NuxtLink to="/commander" class="hover:text-white">New deck</NuxtLink>
          <NuxtLink to="/explore" class="hover:text-white">Try any commander</NuxtLink>
          <NuxtLink to="/match" class="hover:text-white">Find best fit</NuxtLink>
          <NuxtLink to="/collection" class="hover:text-white">Collection</NuxtLink>
        </nav>
      </div>
    </header>
    <main class="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <NuxtPage />
    </main>
    <PwaUpdatePrompt />
  </div>
</template>
