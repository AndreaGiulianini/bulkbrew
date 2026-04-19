export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt"],
  css: ["~/assets/css/tailwind.css"],
  typescript: { strict: true },
  // SSG build for Vercel's static tier. `vercel-static` emits
  // `.vercel/output/static/` which Vercel auto-detects — zero-config deploy.
  // The app is entirely client-rendered (collection, sessions, and EDHREC /
  // Scryfall cache all live in IndexedDB), so no serverless functions are
  // needed.
  ssr: false,
  nitro: { preset: "vercel-static" },
  app: {
    head: {
      title: "BulkBrew — MTG Commander decks from your collection",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap",
        },
      ],
    },
  },
});
