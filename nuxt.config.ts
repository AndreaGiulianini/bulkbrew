export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt", "@vite-pwa/nuxt"],
  css: ["~/assets/css/tailwind.css"],
  typescript: { strict: true },
  // Service worker via @vite-pwa/nuxt (Workbox under the hood). Disabled in
  // dev so HMR keeps working; takes effect in `npm run preview` and
  // production builds. Strategy mix is chosen for an immutable card-image
  // CDN + a slowly-evolving recommendations API:
  //
  //   - cards.scryfall.io: CacheFirst, 365 days. URLs are content-addressed
  //     by card ID so they never change. Once cached, zero network.
  //   - api.scryfall.com/cards: CacheFirst, 30 days. Card oracle text
  //     occasionally errata's; the IDB layer above already TTLs at 7 days.
  //   - json.edhrec.com: NetworkFirst, 1 day. Recommendations evolve daily
  //     as decks get added; freshness wins when online, cache is the
  //     fallback when offline or rate-limited.
  pwa: {
    registerType: "prompt",
    // We ship our own manifest at public/manifest.webmanifest (already
    // linked in app.head.link). Tell the module not to inject another one.
    manifest: false,
    workbox: {
      // Precache the build output. Excluding maps to keep the precache
      // lean — they're devtools-only and re-fetchable.
      globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
      globIgnores: ["**/node_modules/**", "**/sw.js", "**/workbox-*.js"],
      // SPA fallback so navigations to any route serve the cached shell.
      navigateFallback: "/",
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [
        {
          urlPattern: ({ url }) => url.hostname === "cards.scryfall.io",
          handler: "CacheFirst",
          options: {
            cacheName: "scryfall-images",
            expiration: { maxEntries: 5000, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: ({ url }) =>
            url.hostname === "api.scryfall.com" && url.pathname.startsWith("/cards"),
          handler: "CacheFirst",
          options: {
            cacheName: "scryfall-cards-json",
            expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: ({ url }) =>
            url.hostname === "json.edhrec.com" && url.pathname.startsWith("/pages"),
          handler: "NetworkFirst",
          options: {
            cacheName: "edhrec-pages",
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: ({ url }) =>
            url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
          handler: "StaleWhileRevalidate",
          options: {
            cacheName: "google-fonts",
            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
      // Bump precache cache name on each build so old chunks get evicted
      // when the user accepts the update prompt. Workbox already does this
      // via the build manifest hash; this is belt-and-braces.
      cleanupOutdatedCaches: true,
    },
    client: {
      // Used by the composable to surface the update prompt; not the
      // default install banner (which we don't want).
      installPrompt: false,
    },
    devOptions: {
      enabled: false,
    },
  },
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
