"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { clientSlug } from "@/components/landing/parts";
import {
  Delta, ExecLogo, KpiTile, MtdTable, PromoRanking, PromoResults, QualityBadge, Section, Sparkline, Upcoming,
  calendarSummary, change, convLabel, money, num, pctFmt, shortDate, type MtdRow,
} from "@/components/executive/parts";
import { Burndown, Segmented, TrendChart } from "@/components/executive/charts";
import { extractError, getExecutiveOverview, type ExecClient, type ExecEcoDay, type ExecOverview } from "@/lib/api";
import { downloadText, executiveCsv } from "@/lib/execExport";

type SortKey = "name" | "sessions" | "sessions_d" | "conv" | "conv_d" | "rate" | "aov" | "revenue_d" | "blocked";

// Thresholds so a tiny client going 2 → 4 sales doesn't headline as "+100%"
const MIN_SESSIONS = 500;
const MIN_CONVERSIONS = 10;

function sortValue(c: ExecClient, k: SortKey): number | string {
  const kp = c.kpis;
  if (k === "name") return c.client_name.toLowerCase();
  if (k === "blocked") return c.calendar ? c.calendar.blocked_past + c.calendar.blocked_ahead : -Infinity;
  if (!kp) return -Infinity;
  switch (k) {
    case "sessions": return kp.sessions.cur;
    case "sessions_d": return change(kp.sessions) ?? -Infinity;
    case "conv": return kp.conversions.cur;
    case "conv_d": return change(kp.conversions) ?? -Infinity;
    case "rate": return kp.conversion_rate.cur ?? -Infinity;
    case "aov": return kp.avg_order_value?.cur ?? -Infinity;
    case "revenue_d": return change(kp.revenue) ?? -Infinity;
  }
}

function highlights(data: ExecOverview): { tone: "up" | "down" | "info"; text: string; href?: string }[] {
  const out: { tone: "up" | "down" | "info"; text: string; href?: string }[] = [];
  const byId = new Map(data.clients.map((c) => [c.client_id, c]));

  // Drops of 20%+ week over week (computed server-side; same list as the weekly digest)
  const alertsByClient = new Map<number, string[]>();
  for (const a of data.alerts) {
    alertsByClient.set(a.client_id, [...(alertsByClient.get(a.client_id) ?? []), `${a.label.toLowerCase()} ${Math.round(a.change * 100)}%`]);
  }
  alertsByClient.forEach((parts, id) => {
    const c = byId.get(id);
    if (c) out.push({ tone: "down", href: `/executive/${clientSlug(c)}`, text: `Alerta — ${c.client_name}: ${parts.join(", ")} vs. la semana anterior.` });
  });

  const solid = data.clients.filter((c) =>
    c.kpis && c.kpis.sessions.prev >= MIN_SESSIONS && c.kpis.conversions.prev >= MIN_CONVERSIONS);
  const byConv = solid
    .map((c) => ({ c, d: change(c.kpis!.conversions)! }))
    .filter((x) => x.d != null)
    .sort((a, b) => b.d - a.d);

  const pct = (d: number) => `${d > 0 ? "+" : ""}${Math.round(d * 100)}%`;
  const best = byConv[0];
  if (best && best.d > 0.05) {
    out.push({ tone: "up", href: `/executive/${clientSlug(best.c)}`,
      text: `${best.c.client_name} es el que más crece: ${convLabel(best.c).toLowerCase()} ${pct(best.d)} vs. la semana anterior.` });
  }
  const worst = byConv[byConv.length - 1];
  if (worst && worst !== best && worst.d < -0.05 && !alertsByClient.has(worst.c.client_id)) {
    out.push({ tone: "down", href: `/executive/${clientSlug(worst.c)}`,
      text: `${worst.c.client_name} cae: ${convLabel(worst.c).toLowerCase()} ${pct(worst.d)} vs. la semana anterior.` });
  }

  const promos = data.clients.flatMap((c) => c.promo_results.map((p) => ({ c, p })))
    .filter(({ p }) => p.conversions.lift != null && p.conversions.baseline > 0)
    .sort((a, b) => b.p.conversions.lift! - a.p.conversions.lift!);
  if (promos[0] && promos[0].p.conversions.lift! > 0) {
    const { c, p } = promos[0];
    out.push({ tone: "up", href: `/executive/${clientSlug(c)}`,
      text: `Mejor promo de los últimos 30 días: ${p.description || "promo"} (${c.client_name}), ${convLabel(c).toLowerCase()} ${pct(p.conversions.lift!)} por día.` });
  }
  const flop = promos[promos.length - 1];
  if (flop && flop !== promos[0] && flop.p.conversions.lift! < 0) {
    out.push({ tone: "down", href: `/executive/${clientSlug(flop.c)}`,
      text: `${flop.p.description || "Una promo"} (${flop.c.client_name}) no movió la aguja: ${convLabel(flop.c).toLowerCase()} ${pct(flop.p.conversions.lift!)} por día vs. su línea base.` });
  }

  if (data.suspicious_campaigns.length) {
    const s = data.suspicious_campaigns[0];
    out.push({ tone: "down", text: `${data.suspicious_campaigns.length} campaña${data.suspicious_campaigns.length > 1 ? "s" : ""} con tráfico de baja calidad; la mayor, "${s.campaign}" de ${s.client_name} (${num(s.sessions)} sesiones casi sin interacción).` });
  }

  const nextWeek = data.upcoming.filter((u) => u.start_date > new Date().toISOString().slice(0, 10));
  if (nextWeek.length) {
    out.push({ tone: "info", text: `${nextWeek.length} promo${nextWeek.length > 1 ? "s" : ""} por arrancar en los próximos 14 días; la primera, ${nextWeek[0].client_name} el ${shortDate(nextWeek[0].start_date)}.` });
  }
  return out;
}

const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => {
  const s = monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function mtdRows(m: NonNullable<ExecOverview["mtd"]>): MtdRow[] {
  const rows: MtdRow[] = m.revenue.map((r) => ({
    label: `Ingresos ${r.currency}`, cur: r.cur, prev: r.prev, projection: r.projection, prevFull: r.prev_full,
    fmt: (v: number) => money(v, r.currency),
  }));
  if (m.purchases.cur || m.purchases.prev) {
    rows.push({ label: "Compras", cur: m.purchases.cur, prev: m.purchases.prev, projection: m.purchases.projection, prevFull: m.purchases.prev_full, fmt: num });
  }
  rows.push({ label: "Sesiones", cur: m.sessions.cur, prev: m.sessions.prev, projection: m.sessions.projection, prevFull: m.sessions.prev_full, fmt: num });
  return rows;
}

// ── Metric picker shared by the burndown and the trend ───────────────────────

type Metric = { key: string; label: string; fmt: (v: number) => string; get: (d: ExecEcoDay) => number;
  mtd: { cur: number; prev_full: number; projection: number } };

function metricOptions(data: ExecOverview): Metric[] {
  const m = data.mtd;
  if (!m) return [];
  const out: Metric[] = m.revenue.map((r) => ({
    key: `revenue:${r.currency}`, label: m.revenue.length > 1 ? `Ingresos ${r.currency}` : "Ingresos",
    fmt: (v: number) => money(v, r.currency), get: (d: ExecEcoDay) => d.revenue[r.currency] ?? 0, mtd: r,
  }));
  if (m.purchases.cur || m.purchases.prev_full) out.push({ key: "purchases", label: "Compras", fmt: num, get: (d) => d.purchases, mtd: m.purchases });
  out.push({ key: "sessions", label: "Sesiones", fmt: num, get: (d) => d.sessions, mtd: m.sessions });
  return out;
}

const TARGETS = [
  { value: 0, label: "Mes anterior" },
  { value: 10, label: "+10%" },
  { value: 20, label: "+20%" },
];

/** date -> "Promo · Cliente" for every promo we know about (measured history + active + upcoming). */
function promoDays(data: ExecOverview): Map<string, string[]> {
  const seen = new Set<number>();
  const map = new Map<string, string[]>();
  const add = (p: { id: number; start_date: string; end_date: string; description: string | null; promo_type: string }, client: string) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const label = `${p.description || (p.promo_type === "PROMO_ESPECIAL" ? "Promo especial" : "Comunicación")} · ${client}`;
    for (let d = new Date(`${p.start_date}T00:00:00Z`); d <= new Date(`${p.end_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), label]);
    }
  };
  for (const c of data.clients) {
    for (const p of c.promo_history) add(p, c.client_name);
    for (const p of c.active_promos) add(p, c.client_name);
  }
  for (const p of data.upcoming) add(p, p.client_name);
  return map;
}

function CalendarCost({ clients }: { clients: ExecClient[] }) {
  const withCal = clients.filter((c) => c.calendar);
  const rows = withCal
    .filter((c) => c.calendar!.blocked_past + c.calendar!.blocked_ahead + c.calendar!.restricted_past + c.calendar!.restricted_ahead > 0)
    .sort((a, b) =>
      (b.calendar!.blocked_past + b.calendar!.blocked_ahead) - (a.calendar!.blocked_past + a.calendar!.blocked_ahead) ||
      (b.calendar!.restricted_past + b.calendar!.restricted_ahead) - (a.calendar!.restricted_past + a.calendar!.restricted_ahead));
  if (rows.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">Ningún cliente tiene días con deploy bloqueado o restringido este mes.</p>;
  const total = withCal.reduce((a, c) => a + c.calendar!.days_in_month, 0);
  const blocked = withCal.reduce((a, c) => a + c.calendar!.blocked_past + c.calendar!.blocked_ahead, 0);
  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
        <b className="font-medium text-gray-900 dark:text-white">{pctFmt(total ? blocked / total : null, 0)}</b> de los días-cliente del mes tienen el deploy bloqueado.
      </p>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-navy-700">
              <th className="py-2 pr-4 font-medium">Cliente</th>
              <th className="py-2 pr-4 font-medium text-right">Bloqueados</th>
              <th className="py-2 pr-4 font-medium text-right">Restringidos</th>
              <th className="py-2 font-medium text-right">Por venir</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const k = c.calendar!;
              return (
                <tr key={c.client_id} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
                  <td className="py-2 pr-4 text-gray-900 dark:text-white">{c.client_name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{k.blocked_past + k.blocked_ahead}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{k.restricted_past + k.restricted_ahead}</td>
                  <td className="py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{k.blocked_ahead + k.restricted_ahead}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ExecutivePage() {
  const [data, setData] = useState<ExecOverview | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "sessions", desc: true });
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const [boost, setBoost] = useState(0);

  useEffect(() => {
    getExecutiveOverview().then(setData).catch((e) => setError(extractError(e)));
  }, []);

  // Print/PDF always comes out light: the browser drops dark backgrounds and leaves light text on white
  useEffect(() => {
    const html = document.documentElement;
    let wasDark = false;
    const before = () => { wasDark = html.classList.contains("dark"); html.classList.remove("dark"); };
    const after = () => { if (wasDark) html.classList.add("dark"); };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const metrics = useMemo(() => (data ? metricOptions(data) : []), [data]);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const promosByDay = useMemo(() => (data ? promoDays(data) : new Map<string, string[]>()), [data]);
  const monthValues = useMemo(
    () => (data?.mtd && metric ? data.daily.filter((d) => d.date.startsWith(data.mtd!.month)).map(metric.get) : []),
    [data, metric]);
  const target = metric ? metric.mtd.prev_full * (1 + boost / 100) : 0;
  const targetLabel = boost ? `el mes anterior +${boost}%` : "el total del mes anterior";
  const notes = useMemo(() => (data ? highlights(data) : []), [data]);

  const exportCsv = () => {
    if (!data) return;
    const done = monthValues.reduce((a, b) => a + b, 0);
    const csv = executiveCsv(data, notes.map((h) => h.text), metric && target > 0 ? {
      metric: metric.label, target_label: boost ? `Mes anterior +${boost}%` : "Mes anterior", target, done,
      projected: data.mtd ? (done / Math.max(monthValues.length, 1)) * data.mtd.days_in_month : done,
    } : null);
    downloadText(`rendimiento-comercial-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.clients].sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  }, [data, sort]);

  const promoRows = useMemo(() =>
    (data?.clients ?? [])
      .flatMap((c) => c.promo_results.map((p) => ({ ...p, client_name: c.client_name })))
      .sort((a, b) => b.start_date.localeCompare(a.start_date)),
  [data]);

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`py-2.5 px-3 font-medium ${right ? "text-right" : "text-left"}`}
        aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
        className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white"
      >
        {label}
        <span aria-hidden className={sort.key === key ? "" : "opacity-0"}>{sort.desc ? "↓" : "↑"}</span>
      </button>
    </th>
  );

  const eco = data?.ecosystem;
  const dataThrough = data?.clients.find((c) => c.data_through)?.data_through;
  const missing = data?.clients.filter((c) => !c.ga4_configured) ?? [];
  const failing = data?.clients.filter((c) => c.error) ?? [];
  const noEcom = data?.clients.filter((c) => c.kpis && c.kpis.conversion_key === "conversions") ?? [];
  const stale = data?.clients.filter((c) => c.stale) ?? [];
  const cfBots = (data?.clients ?? [])
    .filter((c) => c.cloudflare?.bot_share != null && c.cloudflare.requests > 0)
    .sort((a, b) => b.cloudflare!.bot_share! - a.cloudflare!.bot_share!)
    .slice(0, 6);

  return (
    <AuthGuard>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Rendimiento comercial</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {dataThrough ? `Datos hasta el ${shortDate(dataThrough)}` : "Datos hasta ayer"} · fuente: Google Analytics 4
              <span className="hidden print:inline"> · generado el {new Date().toLocaleString("es-AR")}</span>
            </p>
          </div>
          {data?.ga4_configured && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <button type="button" onClick={exportCsv} className="btn-secondary inline-flex items-center gap-2 min-h-[36px]">
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 15v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Descargar CSV
              </button>
              <button type="button" onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-2 min-h-[36px]">
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M6 7V3h8v4M6 14H4V8h12v6h-2M6 11h8v6H6z" strokeLinejoin="round" />
                </svg>
                Imprimir o guardar PDF
              </button>
            </div>
          )}
        </header>

        {error && <div className="card p-5 text-sm text-down">No se pudo cargar: {error}</div>}
        {!data && !error && (
          <div className="space-y-4" aria-busy>
            <div className="card h-80 animate-pulse" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => <div key={i} className="card h-36 animate-pulse" />)}
            </div>
          </div>
        )}
        {data && !data.ga4_configured && (
          <div className="card p-5 text-sm text-gray-600 dark:text-gray-300">
            GA4 no está configurado. Cargá las credenciales en Admin → GA4 para ver esta vista.
          </div>
        )}

        {data && eco && data.ga4_configured && (
          <>
            {/* One control row, above everything it scopes */}
            {metric && data.mtd && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 print:hidden">
                <Segmented label="Métrica" value={metric.key} options={metrics.map((m) => ({ value: m.key, label: m.label }))} onChange={setMetricKey} />
                <Segmented label="Objetivo" value={boost} options={TARGETS} onChange={setBoost} />
              </div>
            )}

            {/* Hero: are we going to make the month? */}
            {metric && data.mtd && (
              <section className="card p-5 sm:p-6 break-inside-avoid">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Camino al objetivo · {monthName(data.mtd.month)}
                </p>
                <Burndown
                  month={data.mtd.month}
                  values={monthValues}
                  daysInMonth={data.mtd.days_in_month}
                  target={target}
                  format={metric.fmt}
                  metricLabel={metric.label}
                  targetLabel={targetLabel}
                />
                <div className="mt-6 pt-5 border-t border-gray-100 dark:border-navy-700">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Todas las métricas del mes</h3>
                  <MtdTable elapsed={data.mtd.days_elapsed} total={data.mtd.days_in_month} rows={mtdRows(data.mtd)} />
                </div>
              </section>
            )}

            {/* KPI row: last 7 complete days */}
            <div className="break-inside-avoid">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Últimos 7 días <span className="font-normal text-gray-500 dark:text-gray-400">vs. los 7 anteriores</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-4">
              <KpiTile
                label="Ingresos"
                value={eco.revenue[0] ? money(eco.revenue[0].cur, eco.revenue[0].currency) : "—"}
                delta={change(eco.revenue[0])}
                hint={eco.revenue[0] ? `${eco.revenue[0].clients} cliente${eco.revenue[0].clients > 1 ? "s" : ""} en ${eco.revenue[0].currency}` : "Ningún cliente informa ingresos en GA4"}
                extra={
                  <>
                    {eco.revenue.length > 1 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                        {eco.revenue.slice(1).map((r) => (
                          <li key={r.currency} className="flex justify-between gap-2 tabular-nums">
                            <span>{money(r.cur, r.currency)}</span><Delta value={change(r)} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {eco.revenue[0] && (
                      <dl className="mt-3 pt-3 border-t border-gray-100 dark:border-navy-700 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <dt className="text-gray-500 dark:text-gray-400">Ticket promedio</dt>
                          <dd className="tabular-nums text-gray-900 dark:text-white font-medium">
                            {eco.revenue[0].avg_order_value.cur != null ? money(eco.revenue[0].avg_order_value.cur, eco.revenue[0].currency, true) : "—"}{" "}
                            <Delta value={change(eco.revenue[0].avg_order_value)} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500 dark:text-gray-400">Ingreso por sesión</dt>
                          <dd className="tabular-nums text-gray-900 dark:text-white font-medium">
                            {eco.revenue[0].revenue_per_session.cur != null ? money(eco.revenue[0].revenue_per_session.cur, eco.revenue[0].currency, true) : "—"}{" "}
                            <Delta value={change(eco.revenue[0].revenue_per_session)} />
                          </dd>
                        </div>
                      </dl>
                    )}
                  </>
                }
              />
              <KpiTile
                label="Compras"
                value={eco.ecommerce_clients ? num(eco.purchases.cur) : "—"}
                delta={change(eco.purchases)}
                hint={`${eco.ecommerce_clients} de ${eco.clients_with_data} clientes miden compras`}
              />
              <KpiTile
                label="Tasa de compra"
                value={pctFmt(eco.purchase_rate.cur, 2)}
                delta={change(eco.purchase_rate)}
                hint="Compras / sesiones, solo clientes con ecommerce"
              />
              <KpiTile
                label="Sesiones"
                value={num(eco.sessions.cur)}
                delta={change(eco.sessions)}
                hint={`${eco.clients_with_data} clientes con datos`}
              />
            </div>
            </div>

            {metric && data.daily.length > 1 && (
              <Section title={`${metric.label} por día`}
                       subtitle="Este mes y el anterior. Las franjas grises son los días con al menos una promoción en el calendario.">
                <TrendChart points={data.daily.map((d) => ({ date: d.date, value: metric.get(d) }))} format={metric.fmt}
                            promos={promosByDay} currentFrom={`${data.mtd?.month ?? ""}-01`} metricLabel={metric.label} />
              </Section>
            )}

            {/* Highlights */}
            {notes.length > 0 && (
              <Section title="Lo más importante de la semana">
                <ul className="space-y-2.5">
                  {notes.map((h, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${h.tone === "up" ? "bg-up" : h.tone === "down" ? "bg-down" : "bg-series"}`} />
                      {h.href
                        ? <Link href={h.href} className="text-gray-800 dark:text-gray-200 hover:underline">{h.text}</Link>
                        : <span className="text-gray-800 dark:text-gray-200">{h.text}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Clients table */}
            <Section title="Clientes" subtitle="Hacé clic en un cliente para ver el detalle. Tendencia: últimos 28 días, en azul la semana actual.">
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm min-w-[1040px]">
                  <thead>
                    <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-navy-700">
                      <th className="py-2.5 pl-5 pr-3 font-medium text-left">
                        <button onClick={() => setSort((s) => ({ key: "name", desc: s.key === "name" ? !s.desc : false }))}
                                className="hover:text-gray-900 dark:hover:text-white">Cliente</button>
                      </th>
                      {th("sessions", "Sesiones")}
                      {th("sessions_d", "Δ")}
                      {th("conv", "Compras / conv.")}
                      {th("conv_d", "Δ")}
                      {th("rate", "Tasa")}
                      {th("aov", "Ticket")}
                      <th className="py-2.5 px-3 font-medium text-right">Ingresos</th>
                      {th("revenue_d", "Δ")}
                      <th className="py-2.5 px-3 font-medium text-left">Tendencia</th>
                      {th("blocked", "Días bloq.")}
                      <th className="py-2.5 pl-3 pr-5 font-medium text-left">Promo hoy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const k = c.kpis;
                      return (
                        <tr key={c.client_id} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0 hover:bg-gray-50 dark:hover:bg-navy-700/30">
                          <td className="py-2.5 pl-5 pr-3">
                            <Link href={`/executive/${clientSlug(c)}`} className="flex items-center gap-2.5 min-w-0">
                              <ExecLogo client={c} size={28} />
                              <span className="min-w-0">
                                <span className="block font-medium text-gray-900 dark:text-white truncate hover:underline">{c.client_name}</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400">{c.country_name}</span>
                              </span>
                            </Link>
                          </td>
                          {!k ? (
                            <td colSpan={9} className="py-2.5 px-3 text-xs text-gray-500 dark:text-gray-400">
                              {c.error ?? (c.ga4_configured ? "Sin datos" : "Sin propiedad GA4 configurada")}
                            </td>
                          ) : (
                            <>
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 dark:text-white">{num(k.sessions.cur)}</td>
                              <td className="py-2.5 px-3 text-right"><Delta value={change(k.sessions)} /></td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 dark:text-white">
                                {num(k.conversions.cur)}
                                <span className="block text-[11px] text-gray-500 dark:text-gray-400">{convLabel(c).toLowerCase()}</span>
                              </td>
                              <td className="py-2.5 px-3 text-right"><Delta value={change(k.conversions)} /></td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{pctFmt(k.conversion_rate.cur, 2)}</td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                {k.avg_order_value?.cur != null ? money(k.avg_order_value.cur, c.currency) : <span className="text-ink-3">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 dark:text-white whitespace-nowrap">
                                {k.revenue ? money(k.revenue.cur, c.currency) : <span className="text-ink-3">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right">{k.revenue ? <Delta value={change(k.revenue)} /> : <span className="text-ink-3">—</span>}</td>
                              <td className="py-2.5 px-3"><Sparkline series={c.series} metric={k.conversion_key} /></td>
                            </>
                          )}
                          <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300" title={c.calendar ? calendarSummary(c.calendar) : undefined}>
                            {c.calendar
                              ? <>{c.calendar.blocked_past + c.calendar.blocked_ahead}<span className="text-ink-3"> / {c.calendar.days_in_month}</span></>
                              : <span className="text-ink-3">—</span>}
                          </td>
                          <td className="py-2.5 pl-3 pr-5 text-xs">
                            {c.active_promos.length
                              ? <span className="inline-block max-w-[160px] truncate rounded-full bg-series/10 text-series px-2 py-0.5 font-medium" title={c.active_promos.map((p) => p.description).join(", ")}>
                                  {c.active_promos[0].description || "Promo activa"}{c.active_promos.length > 1 ? ` +${c.active_promos.length - 1}` : ""}
                                </span>
                              : <span className="text-ink-3">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3">
                <Section title="Resultado de las promociones" subtitle="Promos activas en los últimos 30 días">
                  <PromoResults rows={promoRows} showClient />
                </Section>
              </div>
              <div className="lg:col-span-2">
                <Section title="Próximos 14 días" subtitle="Promociones cargadas en el calendario">
                  <Upcoming items={data.upcoming} />
                </Section>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section title="Ranking de promociones por tipo" subtitle={`Todas las promos medibles de los últimos ${data.history_days} días`}>
                <PromoRanking rows={data.promo_ranking} days={data.history_days} />
              </Section>
              <Section title="Las que más rindieron" subtitle={`Mayor suba de conversiones por día, últimos ${data.history_days} días`}>
                <PromoResults rows={data.best_promos} showClient emptyText="Todavía no hay promociones medibles." />
                {data.worst_promos.length > 0 && (
                  <>
                    <h3 className="mt-6 mb-2 text-sm font-semibold text-gray-900 dark:text-white">Las que no movieron la aguja</h3>
                    <PromoResults rows={data.worst_promos} showClient />
                  </>
                )}
              </Section>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section title="Calidad del tráfico por campaña" subtitle="Últimos 7 días. Sesiones casi sin interacción ni conversiones suelen ser bots o tráfico pago de baja calidad.">
                {data.suspicious_campaigns.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No se detectaron campañas con tráfico de baja calidad.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-navy-700/60 text-sm">
                    {data.suspicious_campaigns.map((s, i) => (
                      <li key={i} className="py-2.5">
                        <div className="flex justify-between gap-3">
                          <span className="min-w-0 text-gray-900 dark:text-white">
                            <span className="font-medium">{s.client_name}</span> · {s.campaign}<QualityBadge q={s.quality} />
                            <span className="block text-xs text-gray-500 dark:text-gray-400">{s.source_medium} · {s.quality?.reasons.join(" · ")}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-gray-700 dark:text-gray-300">{num(s.sessions)} ses.</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {cfBots.length > 0 && (
                  <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    Cloudflare ahora (últimos 15 min), % de requests de bots: {cfBots.map((c) => `${c.client_name} ${pctFmt(c.cloudflare!.bot_share, 0)}`).join(" · ")}
                  </p>
                )}
              </Section>
              <Section title="Costo operativo del calendario" subtitle="Días de este mes con deploy bloqueado o restringido por promociones (incluye clientes que comparten repositorio)">
                <CalendarCost clients={data.clients} />
              </Section>
            </div>

            {(missing.length > 0 || failing.length > 0 || noEcom.length > 0 || stale.length > 0) && (
              <Section title="Calidad de los datos">
                <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                  {noEcom.length > 0 && <li><b className="font-medium text-gray-900 dark:text-white">Sin ecommerce en GA4:</b> {noEcom.map((c) => c.client_name).join(", ")}. Se muestran conversiones (key events) en lugar de compras, y no entran en la tasa de compra.</li>}
                  {missing.length > 0 && <li><b className="font-medium text-gray-900 dark:text-white">Sin propiedad GA4:</b> {missing.map((c) => c.client_name).join(", ")}.</li>}
                  {failing.length > 0 && <li><b className="font-medium text-gray-900 dark:text-white">Con error al consultar:</b> {failing.map((c) => `${c.client_name} (${c.error})`).join("; ")}.</li>}
                  {stale.length > 0 && <li><b className="font-medium text-gray-900 dark:text-white">Mostrando el último dato disponible:</b> {stale.map((c) => c.client_name).join(", ")}.</li>}
                  <li className="text-xs text-gray-500 dark:text-gray-400">GA4 puede tardar hasta 24 h en consolidar un día; el día de ayer puede ajustarse levemente.</li>
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
