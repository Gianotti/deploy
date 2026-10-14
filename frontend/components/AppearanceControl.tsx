"use client";

import { useTheme, type ThemeMode } from "@/lib/theme";

// "Automático" first and default: the page follows the OS unless someone overrides it here.
const OPTIONS: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "Automático",
    icon: <><rect x="3" y="4" width="18" height="12" rx="2" /><line x1="8" y1="20" x2="16" y2="20" /><line x1="12" y1="16" x2="12" y2="20" /></>,
  },
  {
    value: "light",
    label: "Claro",
    icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  },
  {
    value: "dark",
    label: "Oscuro",
    icon: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
  },
];

export default function AppearanceControl() {
  const { mode, setMode } = useTheme();

  return (
    <fieldset className="inline-flex h-8 items-center rounded-lg bg-canvas border border-line p-0.5">
      <legend className="sr-only">Apariencia</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} title={o.label} className="relative cursor-pointer">
          <input
            type="radio"
            name="appearance"
            value={o.value}
            checked={mode === o.value}
            onChange={() => setMode(o.value)}
            className="peer sr-only"
          />
          <span
            className="flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-ink-3 transition-colors
                       hover:text-ink peer-checked:bg-card peer-checked:text-ink peer-checked:shadow peer-checked:ring-1 peer-checked:ring-line
                       peer-focus-visible:ring-2 peer-focus-visible:ring-ink motion-reduce:transition-none"
          >
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {o.icon}
            </svg>
            <span className="sr-only lg:not-sr-only">{o.label}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
