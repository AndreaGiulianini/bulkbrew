import type { Config } from "tailwindcss";

// Palette (Shadow Grey / Muted Teal / Tangerine Dream / Brown Red / Muted Teal):
//   emerald → #70A288 (primary, deeper teal)
//   sky     → #8FA998 (cooler, lighter teal accent)
//   amber   → #F79F79 (tangerine warm highlight)
//   rose    → #A22C29 (brown-red danger)
// Each scale is built by shifting HSL lightness around the base so existing
// class names (bg-emerald-500, text-amber-400, etc.) all line up with the new
// palette without touching any component.

export default (<Partial<Config>>{
  content: [
    "./components/**/*.{vue,js,ts}",
    "./pages/**/*.vue",
    "./composables/**/*.{js,ts}",
    "./app.vue",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cinzel"', "serif"],
      },
      colors: {
        mtg: {
          w: "#fffbd5",
          u: "#aae0fa",
          b: "#cbc2bf",
          r: "#f9aa8f",
          g: "#9bd3ae",
          c: "#ccc2c0",
        },
        emerald: {
          50: "#f1f5f2",
          100: "#dee7e1",
          200: "#bccfc3",
          300: "#9ab6a5",
          400: "#81a591",
          500: "#70a288",
          600: "#5c866f",
          700: "#486a58",
          800: "#344e40",
          900: "#2a3e33",
          950: "#1b2922",
        },
        sky: {
          50: "#f3f6f4",
          100: "#e2eae5",
          200: "#c5d4cb",
          300: "#a7beb1",
          400: "#8fa998",
          500: "#7a9485",
          600: "#65796e",
          700: "#506058",
          800: "#3b4741",
          900: "#2f3933",
          950: "#1e2521",
        },
        amber: {
          50: "#fef6f2",
          100: "#fde6dc",
          200: "#fbcdb9",
          300: "#f9b496",
          400: "#f79f79",
          500: "#f38457",
          600: "#e66534",
          700: "#bf4d24",
          800: "#8f3a1c",
          900: "#6b2b15",
          950: "#441b0d",
        },
        rose: {
          50: "#fbedec",
          100: "#f7d6d5",
          200: "#eeadab",
          300: "#e58580",
          400: "#d85a55",
          500: "#c7342f",
          600: "#a22c29",
          700: "#842320",
          800: "#5f1816",
          900: "#42100e",
          950: "#230807",
        },
      },
    },
  },
});
