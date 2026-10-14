"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    // An explicit choice (from the navbar toggle) wins; otherwise follow the OS appearance.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (t: Theme) => {
      setTheme(t);
      document.documentElement.classList.toggle("dark", t === "dark");
    };
    const stored = localStorage.getItem("theme") as Theme | null;
    apply(stored ?? (mq.matches ? "dark" : "light"));
    if (stored) return;
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("theme")) apply(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
