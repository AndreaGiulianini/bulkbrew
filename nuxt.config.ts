import { resolve } from "node:path";

const projectRoot = process.cwd();

export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt"],
  css: ["~/assets/css/tailwind.css"],
  typescript: { strict: true },
  runtimeConfig: {
    // All paths default to locations inside the project root, so dev on any
    // machine or a containerised deploy works out of the box. Override via env
    // var when the runtime data needs to live on a volume outside the app dir.
    collectionPath:
      process.env.COLLECTION_PATH || resolve(projectRoot, "ManaBox_Collection.csv"),
    cacheDir: process.env.CACHE_DIR || resolve(projectRoot, ".cache"),
    sessionsDir: process.env.SESSIONS_DIR || resolve(projectRoot, ".sessions"),
  },
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
