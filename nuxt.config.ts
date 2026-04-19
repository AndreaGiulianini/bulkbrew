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
      htmlAttrs: { lang: "en" },
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "theme-color", content: "#70A288" },
        {
          name: "description",
          content:
            "Turn your bulk MTG collection into playable EDH decks. Picks commanders by EDHREC popularity and auto-fills around them.",
        },
        // Open Graph — minimal card for link previews in Slack / iMessage / etc.
        { property: "og:type", content: "website" },
        { property: "og:title", content: "BulkBrew" },
        {
          property: "og:description",
          content: "MTG Commander decks built from your collection.",
        },
        { property: "og:image", content: "/og-image.svg" },
        // Twitter fallback so previews render when the OG image isn't picked up.
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "BulkBrew" },
        {
          name: "twitter:description",
          content: "MTG Commander decks built from your collection.",
        },
        { name: "twitter:image", content: "/og-image.svg" },
      ],
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "manifest", href: "/manifest.webmanifest" },
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
