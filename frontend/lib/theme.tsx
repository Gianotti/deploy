"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";
export type ThemeMode = "system" | Theme;

const ThemeContext = createContext<{
  theme: Theme;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}>({
  theme: "dark",
  mode: "system",
  setMode: () => {},
  toggle: () => {},
});

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setModeState(readMode());
  }, []);

  // "system" follows the OS appearance live; an explicit choice wins until reset to "system".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t: Theme = mode === "system" ? (mq.matches ? "dark" : "light") : mode;
      setTheme(t);
      document.documentElement.classList.toggle("dark", t === "dark");
    };
    apply();
    if (mode !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  function setMode(m: ThemeMode) {
    try {
      if (m === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", m);
    } catch {}
    setModeState(m);
  }

  function toggle() {
    setMode(theme === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

