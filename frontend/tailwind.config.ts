import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: {
          900: "#1a1a2e",
          800: "#16213e",
          700: "#0f3460",
        },
        accent: "#e94560",
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          2: "rgb(var(--ink-2) / <alpha-value>)",
          3: "rgb(var(--ink-3) / <alpha-value>)",
        },
        line: "rgb(var(--line) / <alpha-value>)",
        ...Object.fromEntries(
          (["libre", "aviso", "bloq"] as const).map((s) => [s, {
            DEFAULT: `rgb(var(--${s}) / <alpha-value>)`,
            fill: `rgb(var(--${s}-fill) / <alpha-value>)`,
            on: `rgb(var(--on-${s}) / <alpha-value>)`,
            tint: `rgb(var(--${s}-tint) / <alpha-value>)`,
          }]),
        ),
      },
    },
  },
  plugins: [],
};

export default config;
