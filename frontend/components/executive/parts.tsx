"use client";

// Pieces shared by /executive and /executive/<slug>

import Image from "next/image";
import { useState } from "react";
import ClientAvatar from "@/components/ClientAvatar";
import type { ExecClient, ExecDay, ExecPair, ExecPairN, ExecPromo, ExecPromoResult } from "@/lib/api";

// ── Formatting ────────────────────────────────────────────────────────────────

const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export const num = (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : whole.format(v));

export function money(v: number, currency: string | null, full = false): string {
  if (!currency) return num(v);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency", currency, maximumFractionDigits: full ? 0 : 1,
      notation: full || Math.abs(v) < 10_000 ? "standard" : "compact",
    }).format(v);
  } catch {
    return `${num(v)} ${currency}`;
  }
}

export const pctFmt = (v: number | null, digits = 1) =>
  v == null ? "—" : `${(v * 100).toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export const change = (p: ExecPair | ExecPairN | null | undefined): number | null =>
  p && p.cur != null && p.prev != null && p.prev > 0 ? p.cur / p.prev - 1 : null;

const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
export const shortDate = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
export const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);

export const convLabel = (c: ExecClient, plural = true) =>
  c.kpis?.conversion_key === "purchases" ? (plural ? "Compras" : "compra") : (plural ? "Conversiones" : "conversión");

export const PROMO_TYPE: Record<ExecPromo["promo_type"], string> = {
  PROMO_ESPECIAL: "Promo especial",
  PROMO_NORMAL: "Comunicación",
};

// ── Delta: arrow + sign + color, so direction never relies on hue alone ───────

export function Delta({ value, suffix = "", className = "" }: { value: number | null; suffix?: string; className?: string }) {
  if (value == null || !isFinite(value)) return <span className={`text-ink-3 ${className}`}>—</span>;
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const cls = flat ? "text-ink-3" : up ? "text-up" : "text-down";
  const label = `${up ? "+" : ""}${(value * 100).toLocaleString("es-AR", { maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0 })}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums font-medium ${cls} ${className}`}>
      {!flat && (
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
          {up ? <path d="M6 2l4 6H2z" /> : <path d="M6 10L2 4h8z" />}
        </svg>
      )}
      {label}{suffix}
    </span>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

export function KpiTile({ label, value, delta, hint, extra }: {
  label: string; value: string; delta: number | null; hint?: string; extra?: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white tabular-nums">{value}</p>
      <p className="mt-1.5 text-sm"><Delta value={delta} /> <span className="text-gray-500 dark:text-gray-400">vs. 7 días anteriores</span></p>
      {hint && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      {extra}
    </div>
  );
}

// ── Logo ──────────────────────────────────────────────────────────────────────

export function ExecLogo({ client, size = 32 }: { client: Pick<ExecClient, "client_id" | "client_name" | "has_logo">; size?: number }) {
  return client.has_logo ? (
    <div className="rounded-lg overflow-hidden shrink-0 bg-white border border-gray-200 dark:border-navy-700" style={{ width: size, height: size }}>
      <Image src={`/api/clients/${client.client_id}/logo`} alt="" width={size} height={size} className="object-contain w-full h-full" unoptimized />
    </div>
  ) : (
    <ClientAvatar name={client.client_name} />
  );
}

// ── Sparkline: 28 days in muted ink, the current 7-day window in the series hue ─

export function Sparkline({ series, metric, window = 7, width = 112, height = 28 }: {
  series: ExecDay[]; metric: keyof Omit<ExecDay, "date">; window?: number; width?: number; height?: number;
}) {
  if (series.length < 2) return <span className="text-ink-3 text-xs">—</span>;
  const vals = series.map((d) => d[metric]);
  const max = Math.max(...vals, 1);
  const x = (i: number) => (i / (vals.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const split = Math.max(vals.length - window - 1, 0);
  const last = vals.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline points={pts.slice(0, split + 1).join(" ")} fill="none" stroke="rgb(var(--ink-3) / 0.6)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts.slice(split).join(" ")} fill="none" stroke="rgb(var(--series))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(vals[last])} r="2.5" fill="rgb(var(--series))" />
    </svg>
  );
}

// ── Daily bars with promo bands and a per-bar tooltip ─────────────────────────

export function DailyBars({ title, series, metric, format, promos }: {
  title: string;
  series: ExecDay[];
  metric: keyof Omit<ExecDay, "date">;
  format: (v: number) => string;
  promos: ExecPromo[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 160, padL = 44, padB = 22, padT = 8;
  const vals = series.map((d) => d[metric]);
  const max = Math.max(...vals, 1);
  const step = (W - padL) / series.length;
  const barW = Math.min(step - 2, 24);
  const y = (v: number) => H - padB - (v / max) * (H - padB - padT);
  const promoOn = (iso: string) => promos.filter((p) => p.start_date <= iso && iso <= p.end_date);
  const total = vals.reduce((a, b) => a + b, 0);
  const h = hover != null ? series[hover] : null;

  return (
    <figure className="card p-5">
      <figcaption className="flex items-baseline justify-between gap-3 mb-3">
        <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">{format(total)} en {series.length} días</span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
             aria-label={`${title}, ${series.length} días. Máximo ${format(max)}.`}
             onMouseLeave={() => setHover(null)}>
          {/* promo bands behind the bars */}
          {series.map((d, i) => promoOn(d.date).length > 0 && (
            <rect key={`b${d.date}`} x={padL + i * step} y={padT} width={step} height={H - padB - padT} fill="rgb(var(--series) / 0.08)" />
          ))}
          {/* recessive grid: baseline + max */}
          <line x1={padL} x2={W} y1={y(max)} y2={y(max)} stroke="rgb(var(--line))" strokeDasharray="2 3" />
          <line x1={padL} x2={W} y1={H - padB} y2={H - padB} stroke="rgb(var(--ink-3) / 0.5)" />
          <text x={padL - 6} y={y(max) + 4} textAnchor="end" className="fill-ink-3" fontSize="11">{format(max)}</text>
          <text x={padL - 6} y={H - padB + 4} textAnchor="end" className="fill-ink-3" fontSize="11">0</text>
          {series.map((d, i) => {
            const v = d[metric];
            const top = y(v), bh = H - padB - top;
            const cx = padL + i * step + step / 2;
            const r = Math.min(4, bh);
            return (
              <g key={d.date}>
                {bh > 0 && (
                  <path
                    d={`M${cx - barW / 2},${H - padB} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${H - padB} Z`}
                    fill="rgb(var(--series))"
                    opacity={hover == null || hover === i ? 1 : 0.45}
                  />
                )}
                {(i % 7 === 0 || i === series.length - 1) && (
                  <text x={i === series.length - 1 ? cx + barW / 2 : cx} y={H - 6}
                        textAnchor={i === series.length - 1 ? "end" : "middle"} className="fill-ink-3" fontSize="11">{shortDate(d.date)}</text>
                )}
                {/* hit target: the whole column, bigger than the bar */}
                <rect x={padL + i * step} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {h && hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-gray-200 dark:border-navy-700 bg-white dark:bg-navy-900 px-3 py-2 text-xs shadow-lg whitespace-nowrap"
            style={{ left: `${((padL + hover * step + step / 2) / W) * 100}%` }}
          >
            <p className="text-gray-500 dark:text-gray-400">{shortDate(h.date)}</p>
            <p className="font-semibold text-gray-900 dark:text-white tabular-nums">{format(h[metric])}</p>
            {promoOn(h.date).map((p) => (
              <p key={p.id} className="text-gray-500 dark:text-gray-400">{p.description || PROMO_TYPE[p.promo_type]}</p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

// ── Promo results table ───────────────────────────────────────────────────────

export function PromoResults({ rows, showClient }: {
  rows: (ExecPromoResult & { client_name?: string; client?: ExecClient })[];
  showClient?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Sin promociones medibles en los últimos 30 días.</p>;
  }
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-navy-700">
            {showClient && <th className="py-2 pr-4 font-medium">Cliente</th>}
            <th className="py-2 pr-4 font-medium">Promoción</th>
            <th className="py-2 pr-4 font-medium">Fechas</th>
            <th className="py-2 pr-4 font-medium text-right">Sesiones / día</th>
            <th className="py-2 pr-4 font-medium text-right">Conversión / día</th>
            <th className="py-2 font-medium text-right">Ingresos / día</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
              {showClient && <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">{p.client_name}</td>}
              <td className="py-2.5 pr-4">
                <span className="text-gray-900 dark:text-white">{p.description || PROMO_TYPE[p.promo_type]}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {PROMO_TYPE[p.promo_type]}{p.ongoing ? " · en curso" : ""}
                </span>
              </td>
              <td className="py-2.5 pr-4 whitespace-nowrap text-gray-600 dark:text-gray-300">{range(p.start_date, p.end_date)}</td>
              <td className="py-2.5 pr-4 text-right"><Delta value={p.sessions.lift} /></td>
              <td className="py-2.5 pr-4 text-right"><Delta value={p.conversions.lift} /></td>
              <td className="py-2.5 text-right">{p.revenue.baseline > 0 ? <Delta value={p.revenue.lift} /> : <span className="text-ink-3">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Promedio diario durante la promo vs. los {rows[0].baseline_days} días previos sin promociones del mismo cliente.
      </p>
    </div>
  );
}

// ── Upcoming promos ───────────────────────────────────────────────────────────

export function Upcoming({ items }: { items: (ExecPromo & { client_name: string })[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">No hay promociones cargadas para los próximos 14 días.</p>;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-navy-700/60">
      {items.map((p) => (
        <li key={p.id} className="py-2.5 flex items-start justify-between gap-4 text-sm">
          <div className="min-w-0">
            <p className="text-gray-900 dark:text-white truncate">
              <span className="font-medium">{p.client_name}</span>
              <span className="text-gray-500 dark:text-gray-400"> · {p.description || PROMO_TYPE[p.promo_type]}</span>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {PROMO_TYPE[p.promo_type]} · criticidad {p.criticality}/5
            </p>
          </div>
          <span className="shrink-0 text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">{range(p.start_date, p.end_date)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
