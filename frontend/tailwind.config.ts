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
      },
    },
  },
  plugins: [],
};

export default config;
