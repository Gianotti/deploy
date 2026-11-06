"use client";

// Charts for /executive. Rules (dataviz skill + HIG charts.md):
// one axis, 2px lines, 10% area wash, hairline solid grid, dashes only mean
// "projection", text in ink tokens, crosshair that snaps to the day, keyboard
// focus shows the same as hover, and every chart has a table twin.
// The SVG is drawn at the container's real pixel width so axis text stays 11px
// on a phone instead of shrinking with a viewBox.

import { useEffect, useMemo, useRef, useState } from "react";
import { Delta, shortDate } from "@/components/executive/parts";

// ── Shared helpers ───────────────────────────────────────────────────────────

function useWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Clean ticks (0 / 5 / 10…) covering [min, max]. */
function ticks(min: number, max: number, count = 4) {
  const step = niceStep((max - min) / count || 1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const PAD = { l: 64, r: 16, t: 14, b: 28 };

function LineKey({ dashed, muted }: { dashed?: boolean; muted?: boolean }) {
  return (
    <svg width="18" height="8" aria-hidden className="shrink-0">
      <line x1="1" x2="17" y1="4" y2="4" strokeWidth="2" strokeLinecap="round"
            stroke={muted ? "rgb(var(--ink-3))" : "rgb(var(--series))"} strokeDasharray={dashed ? "4 3" : undefined} />
    </svg>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const right = x > width * 0.62;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded-lg border border-gray-200 dark:border-navy-700 bg-white dark:bg-navy-900 px-3 py-2 text-xs shadow-lg whitespace-nowrap"
      style={{ left: x, transform: right ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
    >
      {children}
    </div>
  );
}

/** Tooltip row: value leads (strong), label follows (muted), keyed by a short line. */
function TipRow({ value, label, dashed, muted }: { value: string; label: string; dashed?: boolean; muted?: boolean }) {
  return (
    <p className="flex items-center gap-2 tabular-nums">
      <LineKey dashed={dashed} muted={muted} />
      <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
    </p>
  );
}

function useScrub(n: number, initial: number) {
  const [hover, setHover] = useState<number | null>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    setHover((h) => {
      const cur = h ?? initial;
      if (e.key === "Home") return 0;
      if (e.key === "End") return n;
      return Math.max(0, Math.min(n, cur + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };
  return {
    hover, setHover,
    focusProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setHover(initial),
      onBlur: () => setHover(null),
    },
  };
}

const thCls = "py-1.5 pr-4 font-medium text-gray-500 dark:text-gray-400";
const tdCls = "py-1.5 pr-4 tabular-nums text-right text-gray-700 dark:text-gray-300";

// ── Burndown: what's left to reach the month's target ────────────────────────

export function Burndown({ month, values, daysInMonth, target, format, metricLabel, targetLabel }: {
  /** "YYYY-MM" */
  month: string;
  /** Daily values of the month so far, day 1 … yesterday */
  values: number[];
  daysInMonth: number;
  target: number;
  format: (v: number) => string;
  metricLabel: string;
  targetLabel: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const N = daysInMonth;
  const elapsed = Math.min(values.length, N);
  const { hover, setHover, focusProps } = useScrub(N, elapsed);

  const m = useMemo(() => {
    const cum = [0];
    for (let i = 0; i < elapsed; i++) cum.push(cum[i] + values[i]);
    const done = cum[elapsed];
    const pace = elapsed ? done / elapsed : 0;
    const remaining = target - done;
    const left = N - elapsed;
    return {
      cum, done, pace, remaining,
      projected: pace * N,
      required: left > 0 ? Math.max(remaining, 0) / left : 0,
      // first day the run-rate crosses the target, if it does this month
      arrival: pace > 0 && remaining > 0 ? Math.ceil(target / pace) : null,
    };
  }, [values, elapsed, target, N]);

  if (!(target > 0)) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No hay datos del mes anterior para fijar un objetivo de {metricLabel.toLowerCase()}.</p>;
  }

  const H = W < 520 ? 200 : 248;
  const plotW = W - PAD.l - PAD.r;
  const ideal = (d: number) => target * (1 - d / N);
  const real = (d: number) => target - m.cum[d];
  const proj = (d: number) => target - m.pace * d;
  const yLo = Math.min(0, real(elapsed), proj(N));
  const yTicks = ticks(yLo, target);
  const y0 = yTicks[0], y1 = yTicks[yTicks.length - 1];
  const x = (d: number) => PAD.l + (d / N) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const pts = (from: number, to: number, f: (d: number) => number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `${x(from + i).toFixed(1)},${y(f(from + i)).toFixed(1)}`).join(" ");
  const dayIso = (d: number) => `${month}-${String(Math.max(d, 1)).padStart(2, "0")}`;
  const dayName = (d: number) => (d === 0 ? "Inicio del mes" : `Cierre del ${shortDate(dayIso(d))}`);
  const xTicks = [1, 8, 15, 22, N].filter((d, i, a) => d <= N && (i === a.length - 1 || N - d >= 4));

  const surpassed = m.remaining <= 0;
  const headline = surpassed
    ? `Objetivo superado: ${format(m.done)} acumulado contra ${format(target)}.`
    : m.arrival != null && m.arrival <= N
      ? `Al ritmo actual se llega al objetivo el ${shortDate(dayIso(m.arrival))}.`
      : `Al ritmo actual faltarían ${format(target - m.projected)} al cierre del mes.`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(N, Math.round(((e.clientX - r.left) / r.width) * N))));
  };

  return (
    <figure>
      <figcaption className="mb-4">
        <p className="text-lg font-semibold text-gray-900 dark:text-white">{headline}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Lo que falta de {metricLabel.toLowerCase()} para llegar a {targetLabel.toLowerCase()} ({format(target)}), día por día.
        </p>
      </figcaption>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-5">
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">Acumulado</dt>
          <dd className="text-xl font-semibold text-gray-900 dark:text-white">{format(m.done)}</dd>
          <dd className="text-xs text-gray-500 dark:text-gray-400">{Math.round((m.done / target) * 100)}% del objetivo · día {elapsed} de {N}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">{surpassed ? "Por encima del objetivo" : "Falta"}</dt>
          <dd className="text-xl font-semibold text-gray-900 dark:text-white">{format(Math.abs(m.remaining))}</dd>
          <dd className="text-xs text-gray-500 dark:text-gray-400">{N - elapsed} días por delante</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">Ritmo necesario</dt>
          <dd className="text-xl font-semibold text-gray-900 dark:text-white">{surpassed || N === elapsed ? "—" : `${format(m.required)}/día`}</dd>
          <dd className="text-xs text-gray-500 dark:text-gray-400">actual {format(m.pace)}/día</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">Proyección al cierre</dt>
          <dd className="text-xl font-semibold text-gray-900 dark:text-white">{format(m.projected)}</dd>
          <dd className="text-xs"><Delta value={m.projected / target - 1} /> <span className="text-gray-500 dark:text-gray-400">vs. objetivo</span></dd>
        </div>
      </dl>

      <ul className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-xs text-gray-600 dark:text-gray-300" aria-hidden>
        <li className="flex items-center gap-1.5"><LineKey />Restante real</li>
        <li className="flex items-center gap-1.5"><LineKey dashed />Proyección al ritmo actual</li>
        <li className="flex items-center gap-1.5"><LineKey muted />Ritmo ideal</li>
      </ul>

      <div ref={ref} className="relative outline-none rounded-lg focus-visible:ring-2 focus-visible:ring-series/60" role="group" {...focusProps}
           aria-label={`Burndown de ${metricLabel}. ${headline} Usá las flechas para recorrer los días.`}>
        <svg width={W} height={H} aria-hidden className="block select-none">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgb(var(--ink-3) / 0.55)" : "rgb(var(--line))"} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-ink-3 tabular-nums">{t === 0 ? "Objetivo" : format(t)}</text>
            </g>
          ))}
          {xTicks.map((d) => (
            <text key={d} x={x(d)} y={H - 8} textAnchor={d === N ? "end" : d === 1 ? "start" : "middle"} fontSize="11" className="fill-ink-3">
              {shortDate(dayIso(d))}
            </text>
          ))}

          <polyline points={pts(0, N, ideal)} fill="none" stroke="rgb(var(--ink-3) / 0.7)" strokeWidth="1.5" strokeLinecap="round" />
          <path d={`M${x(0)},${y(0)} L${pts(0, elapsed, real).split(" ").join(" L")} L${x(elapsed)},${y(0)} Z`} fill="rgb(var(--series) / 0.1)" />
          {elapsed < N && (
            <polyline points={pts(elapsed, N, proj)} fill="none" stroke="rgb(var(--series))" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
          )}
          <polyline points={pts(0, elapsed, real)} fill="none" stroke="rgb(var(--series))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(elapsed)} cy={y(real(elapsed))} r="4.5" fill="rgb(var(--series))" stroke="rgb(var(--card))" strokeWidth="2" />

          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgb(var(--ink-3) / 0.5)" />
              <circle cx={x(hover)} cy={y(ideal(hover))} r="3.5" fill="rgb(var(--ink-3))" stroke="rgb(var(--card))" strokeWidth="2" />
              <circle cx={x(hover)} cy={y(hover <= elapsed ? real(hover) : proj(hover))} r="4" fill="rgb(var(--series))" stroke="rgb(var(--card))" strokeWidth="2" />
            </g>
          )}
          <rect x={PAD.l} y={0} width={plotW} height={H} fill="transparent"
                onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
        </svg>

        {hover != null && (
          <Tooltip x={x(hover)} width={W}>
            <p className="mb-1 text-gray-500 dark:text-gray-400">{dayName(hover)}</p>
            {hover <= elapsed
              ? <TipRow value={real(hover) >= 0 ? format(real(hover)) : `+${format(-real(hover))}`} label={real(hover) >= 0 ? "falta" : "sobre el objetivo"} />
              : <TipRow dashed value={proj(hover) >= 0 ? format(proj(hover)) : `+${format(-proj(hover))}`} label={proj(hover) >= 0 ? "faltaría (proyección)" : "sobre el objetivo (proyección)"} />}
            <TipRow muted value={format(ideal(hover))} label="ideal" />
          </Tooltip>
        )}
      </div>

      <details className="mt-3 text-sm print:hidden">
        <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">Ver datos por día</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left border-b border-gray-200 dark:border-navy-700">
              <th className={thCls}>Día</th><th className={`${thCls} text-right`}>Del día</th><th className={`${thCls} text-right`}>Acumulado</th>
              <th className={`${thCls} text-right`}>Falta</th><th className={`${thCls} text-right`}>Ideal</th>
            </tr></thead>
            <tbody>
              {values.slice(0, elapsed).map((v, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
                  <td className="py-1.5 pr-4 text-gray-900 dark:text-white">{shortDate(dayIso(i + 1))}</td>
                  <td className={tdCls}>{format(v)}</td><td className={tdCls}>{format(m.cum[i + 1])}</td>
                  <td className={tdCls}>{format(real(i + 1))}</td><td className={tdCls}>{format(ideal(i + 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// ── Daily trend with promo bands ─────────────────────────────────────────────

export function TrendChart({ points, format, promos, currentFrom, metricLabel }: {
  points: { date: string; value: number }[];
  format: (v: number) => string;
  /** date → promos running that day ("Hot Sale · Banco X") */
  promos: Map<string, string[]>;
  /** first day of the current month; earlier days draw muted */
  currentFrom: string;
  metricLabel: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = points.length - 1;
  const { hover, setHover, focusProps } = useScrub(n, n);
  if (points.length < 2) return <p className="text-sm text-gray-500 dark:text-gray-400">Todavía no hay datos diarios.</p>;

  const H = W < 520 ? 180 : 220;
  const plotW = W - PAD.l - PAD.r;
  const max = Math.max(...points.map((p) => p.value), 1);
  const yTicks = ticks(0, max);
  const y1 = yTicks[yTicks.length - 1];
  const step = plotW / n;
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (1 - v / y1) * (H - PAD.t - PAD.b);
  const split = Math.max(0, points.findIndex((p) => p.date >= currentFrom));
  const line = (a: number, b: number) => points.slice(a, b + 1).map((p, k) => `${x(a + k).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  // contiguous runs of promo days → one band each
  const bands: [number, number][] = [];
  points.forEach((p, i) => {
    if (!promos.get(p.date)?.length) return;
    const last = bands[bands.length - 1];
    if (last && last[1] === i - 1) last[1] = i; else bands.push([i, i]);
  });
  const promoDays = points.filter((p) => promos.get(p.date)?.length).length;
  const xTickIdx = points.map((_, i) => i).filter((i) => i === split || i === n || (i - split) % 14 === 0)
    .filter((i, k, a) => k === a.length - 1 || a[k + 1] - i >= 5);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n))));
  };
  const h = hover != null ? points[hover] : null;
  const cur = points.slice(split).reduce((a, p) => a + p.value, 0);

  return (
    <figure>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-xs text-gray-600 dark:text-gray-300" aria-hidden>
        <li className="flex items-center gap-1.5"><LineKey />Este mes</li>
        <li className="flex items-center gap-1.5"><LineKey muted />Mes anterior</li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-2.5 rounded-sm bg-ink-3/15" />Días con promoción ({promoDays})
        </li>
      </ul>
      <div ref={ref} className="relative outline-none rounded-lg focus-visible:ring-2 focus-visible:ring-series/60" role="group" {...focusProps}
           aria-label={`${metricLabel} por día, ${points.length} días hasta el ${shortDate(points[n].date)}. Máximo ${format(max)}. Este mes suma ${format(cur)}. Usá las flechas para recorrer los días.`}>
        <svg width={W} height={H} aria-hidden className="block select-none">
          {bands.map(([a, b]) => (
            <rect key={a} x={x(a) - step / 2} width={(b - a + 1) * step} y={PAD.t} height={H - PAD.t - PAD.b} fill="rgb(var(--ink-3) / 0.12)" />
          ))}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgb(var(--ink-3) / 0.55)" : "rgb(var(--line))"} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-ink-3 tabular-nums">{t === 0 ? "0" : format(t)}</text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === n ? "end" : i === 0 ? "start" : "middle"} fontSize="11" className="fill-ink-3">
              {shortDate(points[i].date)}
            </text>
          ))}
          {split > 0 && <line x1={x(split)} x2={x(split)} y1={PAD.t} y2={H - PAD.b} stroke="rgb(var(--line))" />}

          {split > 0 && <polyline points={line(0, split)} fill="none" stroke="rgb(var(--ink-3) / 0.65)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
          <path d={`M${x(split)},${y(0)} L${line(split, n).split(" ").join(" L")} L${x(n)},${y(0)} Z`} fill="rgb(var(--series) / 0.1)" />
          <polyline points={line(split, n)} fill="none" stroke="rgb(var(--series))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n)} cy={y(points[n].value)} r="4" fill="rgb(var(--series))" stroke="rgb(var(--card))" strokeWidth="2" />

          {h && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgb(var(--ink-3) / 0.5)" />
              <circle cx={x(hover)} cy={y(h.value)} r="4" fill={hover >= split ? "rgb(var(--series))" : "rgb(var(--ink-3))"} stroke="rgb(var(--card))" strokeWidth="2" />
            </g>
          )}
          <rect x={PAD.l - step / 2} y={0} width={plotW + step} height={H} fill="transparent"
                onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {h && hover != null && (
          <Tooltip x={x(hover)} width={W}>
            <p className="mb-1 text-gray-500 dark:text-gray-400">{shortDate(h.date)}</p>
            <TipRow value={format(h.value)} label={metricLabel.toLowerCase()} muted={hover < split} />
            {(promos.get(h.date) ?? []).slice(0, 4).map((p) => <p key={p} className="mt-0.5 text-gray-500 dark:text-gray-400">{p}</p>)}
            {(promos.get(h.date)?.length ?? 0) > 4 && <p className="text-gray-500 dark:text-gray-400">y {promos.get(h.date)!.length - 4} más</p>}
          </Tooltip>
        )}
      </div>

      <details className="mt-3 text-sm print:hidden">
        <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">Ver datos por día</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left border-b border-gray-200 dark:border-navy-700">
              <th className={thCls}>Día</th><th className={`${thCls} text-right`}>{metricLabel}</th><th className={thCls}>Promociones</th>
            </tr></thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
                  <td className="py-1.5 pr-4 text-gray-900 dark:text-white whitespace-nowrap">{shortDate(p.date)}</td>
                  <td className={tdCls}>{format(p.value)}</td>
                  <td className="py-1.5 text-gray-500 dark:text-gray-400">{(promos.get(p.date) ?? []).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// ── Segmented control (Métrica / Objetivo) ───────────────────────────────────

export function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <div role="group" aria-label={label} className="inline-flex rounded-lg bg-gray-100 dark:bg-navy-900 p-0.5">
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
                  className={`min-h-[32px] px-3 rounded-md text-sm transition-colors ${o.value === value
                    ? "bg-white dark:bg-navy-700 text-gray-900 dark:text-white font-medium shadow-sm"
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
