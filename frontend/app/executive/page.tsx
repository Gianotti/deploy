"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { clientSlug } from "@/components/landing/parts";
import {
  Delta, ExecLogo, KpiTile, PromoResults, Section, Sparkline, Upcoming,
  change, convLabel, money, num, pctFmt, shortDate,
} from "@/components/executive/parts";
import { extractError, getExecutiveOverview, type ExecClient, type ExecOverview } from "@/lib/api";

type SortKey = "name" | "sessions" | "sessions_d" | "conv" | "conv_d" | "rate" | "revenue_d";

// Thresholds so a tiny client going 2 → 4 sales doesn't headline as "+100%"
const MIN_SESSIONS = 500;
const MIN_CONVERSIONS = 10;

function sortValue(c: ExecClient, k: SortKey): number | string {
  const kp = c.kpis;
  if (k === "name") return c.client_name.toLowerCase();
  if (!kp) return -Infinity;
  switch (k) {
    case "sessions": return kp.sessions.cur;
    case "sessions_d": return change(kp.sessions) ?? -Infinity;
    case "conv": return kp.conversions.cur;
    case "conv_d": return change(kp.conversions) ?? -Infinity;
    case "rate": return kp.conversion_rate.cur ?? -Infinity;
    case "revenue_d": return change(kp.revenue) ?? -Infinity;
  }
}

function highlights(data: ExecOverview): { tone: "up" | "down" | "info"; text: string; href?: string }[] {
  const out: { tone: "up" | "down" | "info"; text: string; href?: string }[] = [];
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
  if (worst && worst !== best && worst.d < -0.05) {
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

  const nextWeek = data.upcoming.filter((u) => u.start_date > new Date().toISOString().slice(0, 10));
  if (nextWeek.length) {
    out.push({ tone: "info", text: `${nextWeek.length} promo${nextWeek.length > 1 ? "s" : ""} por arrancar en los próximos 14 días; la primera, ${nextWeek[0].client_name} el ${shortDate(nextWeek[0].start_date)}.` });
  }
  return out;
}

export default function ExecutivePage() {
  const [data, setData] = useState<ExecOverview | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "sessions", desc: true });

  useEffect(() => {
    getExecutiveOverview().then(setData).catch((e) => setError(extractError(e)));
  }, []);

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

  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Rendimiento comercial</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Últimos 7 días completos vs. los 7 anteriores{dataThrough ? ` · datos hasta el ${shortDate(dataThrough)}` : ""} · fuente: Google Analytics 4
          </p>
        </div>

        {error && <div className="card p-5 text-sm text-down">No se pudo cargar: {error}</div>}
        {!data && !error && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-busy>
            {[0, 1, 2, 3].map((i) => <div key={i} className="card h-36 animate-pulse" />)}
          </div>
        )}
        {data && !data.ga4_configured && (
          <div className="card p-5 text-sm text-gray-600 dark:text-gray-300">
            GA4 no está configurado. Cargá las credenciales en Admin → GA4 para ver esta vista.
          </div>
        )}

        {data && eco && data.ga4_configured && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiTile
                label="Ingresos"
                value={eco.revenue[0] ? money(eco.revenue[0].cur, eco.revenue[0].currency) : "—"}
                delta={change(eco.revenue[0])}
                hint={eco.revenue[0] ? `${eco.revenue[0].clients} cliente${eco.revenue[0].clients > 1 ? "s" : ""} en ${eco.revenue[0].currency}` : "Ningún cliente informa ingresos en GA4"}
                extra={eco.revenue.length > 1 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                    {eco.revenue.slice(1).map((r) => (
                      <li key={r.currency} className="flex justify-between gap-2 tabular-nums">
                        <span>{money(r.cur, r.currency)}</span><Delta value={change(r)} />
                      </li>
                    ))}
                  </ul>
                )}
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

            {/* Highlights */}
            {highlights(data).length > 0 && (
              <Section title="Lo más importante de la semana">
                <ul className="space-y-2.5">
                  {highlights(data).map((h, i) => (
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
                <table className="w-full text-sm min-w-[860px]">
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
                      <th className="py-2.5 px-3 font-medium text-right">Ingresos</th>
                      {th("revenue_d", "Δ")}
                      <th className="py-2.5 px-3 font-medium text-left">Tendencia</th>
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
                            <td colSpan={8} className="py-2.5 px-3 text-xs text-gray-500 dark:text-gray-400">
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
                              <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 dark:text-white whitespace-nowrap">
                                {k.revenue ? money(k.revenue.cur, c.currency) : <span className="text-ink-3">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right">{k.revenue ? <Delta value={change(k.revenue)} /> : <span className="text-ink-3">—</span>}</td>
                              <td className="py-2.5 px-3"><Sparkline series={c.series} metric={k.conversion_key} /></td>
                            </>
                          )}
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
