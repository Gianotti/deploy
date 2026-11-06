// CSV export for /executive. `;` separator + BOM + decimal comma so Excel in
// Spanish opens it with the right columns and numbers (same as the GA4 users CSV).

import type { ExecClient, ExecOverview, ExecPair, ExecPairN } from "@/lib/api";

type Cell = string | number | null | undefined;

const n = (v: number | null | undefined, digits = 2) =>
  v == null || !isFinite(v) ? "" : v.toLocaleString("es-AR", { useGrouping: false, maximumFractionDigits: digits });
const pct = (v: number | null | undefined) => (v == null || !isFinite(v) ? "" : `${n(v * 100, 1)}%`);
const delta = (p: ExecPair | ExecPairN | null | undefined) =>
  p && p.cur != null && p.prev != null && p.prev > 0 ? pct(p.cur / p.prev - 1) : "";

function cell(v: Cell): string {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface BurndownSummary {
  metric: string;
  target_label: string;
  target: number;
  done: number;
  projected: number;
}

export function executiveCsv(data: ExecOverview, highlights: string[], burndown: BurndownSummary | null): string {
  const rows: Cell[][] = [];
  const blank = () => rows.push([]);
  const eco = data.ecosystem;
  const through = data.clients.find((c) => c.data_through)?.data_through ?? "";

  rows.push(["Rendimiento comercial"]);
  rows.push(["Generado", new Date().toLocaleString("es-AR")]);
  rows.push(["Datos hasta", through]);
  blank();

  rows.push(["Últimos 7 días", "Actual", "7 días anteriores", "Variación"]);
  for (const r of eco.revenue) rows.push([`Ingresos ${r.currency}`, n(r.cur), n(r.prev), delta(r)]);
  for (const r of eco.revenue) {
    rows.push([`Ticket promedio ${r.currency}`, n(r.avg_order_value.cur), n(r.avg_order_value.prev), delta(r.avg_order_value)]);
  }
  rows.push(["Compras", n(eco.purchases.cur, 0), n(eco.purchases.prev, 0), delta(eco.purchases)]);
  rows.push(["Tasa de compra", pct(eco.purchase_rate.cur), pct(eco.purchase_rate.prev), delta(eco.purchase_rate)]);
  rows.push(["Sesiones", n(eco.sessions.cur, 0), n(eco.sessions.prev, 0), delta(eco.sessions)]);
  blank();

  if (data.mtd) {
    const m = data.mtd;
    rows.push([`Mes en curso (${m.month}, día ${m.days_elapsed} de ${m.days_in_month})`, "Mes a la fecha", "Mismo período mes anterior", "Variación", "Proyección cierre", "Mes anterior completo"]);
    const line = (label: string, p: { cur: number; prev: number; projection: number; prev_full: number }, d = 2) =>
      rows.push([label, n(p.cur, d), n(p.prev, d), delta(p), n(p.projection, d), n(p.prev_full, d)]);
    for (const r of m.revenue) line(`Ingresos ${r.currency}`, r);
    line("Compras", m.purchases, 0);
    line("Sesiones", m.sessions, 0);
    if (burndown) {
      blank();
      rows.push(["Objetivo del mes", "Métrica", "Objetivo", "Acumulado", "Avance", "Proyección", "Proyección vs. objetivo"]);
      rows.push([burndown.target_label, burndown.metric, n(burndown.target), n(burndown.done), pct(burndown.done / burndown.target),
                 n(burndown.projected), pct(burndown.projected / burndown.target - 1)]);
    }
    blank();
  }

  if (highlights.length) {
    rows.push(["Lo más importante de la semana"]);
    for (const h of highlights) rows.push([h]);
    blank();
  }

  rows.push(["Clientes", "País", "Sesiones 7d", "Δ sesiones", "Compras / conv. 7d", "Tipo", "Δ conv.", "Tasa", "Ticket",
             "Ingresos 7d", "Moneda", "Δ ingresos", "Días bloqueados del mes", "Promo hoy"]);
  for (const c of data.clients as ExecClient[]) {
    const k = c.kpis;
    const blocked = c.calendar ? c.calendar.blocked_past + c.calendar.blocked_ahead : "";
    const promo = c.active_promos.map((p) => p.description).filter(Boolean).join(", ");
    if (!k) {
      rows.push([c.client_name, c.country_name, "", "", "", "", "", "", "", "", "", "", blocked, promo]);
      continue;
    }
    rows.push([
      c.client_name, c.country_name, n(k.sessions.cur, 0), delta(k.sessions), n(k.conversions.cur, 0),
      k.conversion_key === "purchases" ? "compras" : "conversiones", delta(k.conversions), pct(k.conversion_rate.cur),
      n(k.avg_order_value?.cur), k.revenue ? n(k.revenue.cur) : "", c.currency ?? "", delta(k.revenue), blocked, promo,
    ]);
  }
  blank();

  const currencies = Array.from(new Set(data.daily.flatMap((d) => Object.keys(d.revenue))));
  rows.push(["Día", "Sesiones", "Compras", ...currencies.map((c) => `Ingresos ${c}`)]);
  for (const d of data.daily) rows.push([d.date, n(d.sessions, 0), n(d.purchases, 0), ...currencies.map((c) => n(d.revenue[c] ?? 0))]);

  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
