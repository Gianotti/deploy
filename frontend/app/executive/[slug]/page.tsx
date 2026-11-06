"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { clientSlug } from "@/components/landing/parts";
import {
  DailyBars, ExecLogo, Funnel, KpiTile, MtdTable, PROMO_TYPE, PromoRanking, PromoResults, QualityBadge, Section,
  SegmentTable, TopItems, calendarSummary, change, convLabel, money, num, pctFmt, range, shortDate, type MtdRow,
} from "@/components/executive/parts";
import { extractError, getExecutiveOverview, type ExecClient, type ExecEngagedRow, type ExecOverview } from "@/lib/api";

function clientMtdRows(c: ExecClient): MtdRow[] {
  const m = c.mtd!, k = c.kpis!;
  const row = (label: string, key: "sessions" | "purchases" | "conversions" | "revenue", fmt: (v: number) => string): MtdRow =>
    ({ label, cur: m.cur[key], prev: m.prev[key], projection: m.projection[key], prevFull: m.prev_full[key], fmt });
  const rows: MtdRow[] = [];
  if (k.has_revenue) rows.push(row("Ingresos", "revenue", (v) => money(v, c.currency)));
  rows.push(row(convLabel(c), k.conversion_key, num));
  rows.push(row("Sesiones", "sessions", num));
  return rows;
}

function Breakdown<R extends ExecEngagedRow>({ client, rows, label, name }: {
  client: ExecClient;
  rows: R[];
  label: string;
  name: (r: R) => React.ReactNode;
}) {
  const conv = client.kpis?.conversion_key === "purchases" ? "purchases" : "conversions";
  const total = rows.reduce((a, r) => a + r.sessions, 0) || 1;
  if (rows.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">Sin datos en los últimos 7 días.</p>;
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-navy-700">
            <th className="py-2 pr-4 font-medium">{label}</th>
            <th className="py-2 pr-4 font-medium text-right">Sesiones</th>
            <th className="py-2 pr-4 font-medium text-right">{convLabel(client)}</th>
            <th className="py-2 pr-4 font-medium text-right">Tasa</th>
            {client.kpis?.has_revenue && <th className="py-2 font-medium text-right">Ingresos</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
              <td className="py-2.5 pr-4">
                <div className="text-gray-900 dark:text-white">{name(r)}<QualityBadge q={r.quality} /></div>
                {/* share-of-sessions bar: one hue, magnitude only */}
                <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-navy-700 overflow-hidden" aria-hidden>
                  <div className="h-full rounded-full bg-series" style={{ width: `${(r.sessions / total) * 100}%` }} />
                </div>
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(r.sessions)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(r[conv])}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{pctFmt(r.sessions ? r[conv] / r.sessions : null, 2)}</td>
              {client.kpis?.has_revenue && <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">{money(r.revenue, client.currency)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExecutiveClientPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<ExecOverview | null>(null);
  const [error, setError] = useState("");
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    getExecutiveOverview().then(setData).catch((e) => setError(extractError(e)));
  }, []);

  const client = data?.clients.find((c) => clientSlug(c) === slug || String(c.client_id) === slug);
  const k = client?.kpis;
  const promosInChart = client
    ? [...client.promo_results, ...client.active_promos].filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i)
    : [];
  const upcoming = data?.upcoming.filter((u) => u.client_id === client?.client_id) ?? [];

  return (
    <AuthGuard>
      <div className="space-y-6">
        <Link href="/executive" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">← Todos los clientes</Link>

        {error && <div className="card p-5 text-sm text-down">No se pudo cargar: {error}</div>}
        {!data && !error && <div className="card h-40 animate-pulse" aria-busy />}
        {data && !client && <div className="card p-5 text-sm text-gray-600 dark:text-gray-300">No encontramos ese cliente.</div>}

        {client && (
          <>
            <div className="flex items-center gap-3">
              <ExecLogo client={client} size={44} />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{client.client_name}</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {client.country_name}
                  {client.data_through ? ` · datos hasta el ${shortDate(client.data_through)}` : ""}
                  {client.stale ? " · mostrando el último dato disponible" : ""}
                </p>
              </div>
            </div>

            {client.active_promos.length > 0 && (
              <div className="card p-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-900 dark:text-white">En curso:</span>
                {client.active_promos.map((p) => (
                  <span key={p.id} className="rounded-full bg-series/10 text-series px-2.5 py-0.5 font-medium">
                    {p.description || PROMO_TYPE[p.promo_type]} · {range(p.start_date, p.end_date)}
                  </span>
                ))}
              </div>
            )}

            {!k ? (
              <div className="card p-5 text-sm text-gray-600 dark:text-gray-300">
                {client.error ?? (client.ga4_configured ? "Sin datos de GA4." : "Este cliente no tiene una propiedad de GA4 configurada (Admin → GA4).")}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {k.revenue
                    ? <KpiTile label="Ingresos" value={money(k.revenue.cur, client.currency)} delta={change(k.revenue)} />
                    : <KpiTile label="Sesiones" value={num(k.sessions.cur)} delta={change(k.sessions)} />}
                  <KpiTile label={convLabel(client)} value={num(k.conversions.cur)} delta={change(k.conversions)}
                           hint={k.conversion_key === "conversions" ? "Key events de GA4 (sin ecommerce)" : undefined} />
                  <KpiTile label={k.conversion_key === "purchases" ? "Tasa de compra" : "Tasa de conversión"}
                           value={pctFmt(k.conversion_rate.cur, 2)} delta={change(k.conversion_rate)} />
                  {k.avg_order_value
                    ? <KpiTile label="Ticket promedio" value={money(k.avg_order_value.cur ?? 0, client.currency, true)} delta={change(k.avg_order_value)} />
                    : k.revenue
                      ? <KpiTile label="Sesiones" value={num(k.sessions.cur)} delta={change(k.sessions)} />
                      : null}
                </div>

                {(k.revenue_per_session || client.calendar) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {k.revenue_per_session && (
                      <KpiTile label="Ingreso por sesión" value={money(k.revenue_per_session.cur ?? 0, client.currency, true)}
                               delta={change(k.revenue_per_session)} hint="Ingresos / sesiones: combina tráfico, conversión y ticket" />
                    )}
                    {k.revenue && k.avg_order_value && (
                      <KpiTile label="Sesiones" value={num(k.sessions.cur)} delta={change(k.sessions)} />
                    )}
                    {client.calendar && (
                      <div className="card p-5 sm:col-span-2">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Deploys este mes</p>
                        <p className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white tabular-nums">
                          {client.calendar.blocked_past + client.calendar.blocked_ahead}
                          <span className="text-base font-normal text-gray-500 dark:text-gray-400"> días bloqueados · {client.calendar.restricted_past + client.calendar.restricted_ahead} restringidos</span>
                        </p>
                        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{calendarSummary(client.calendar)}</p>
                      </div>
                    )}
                  </div>
                )}

                {client.mtd && (
                  <Section title="Mes en curso" subtitle="Vs. los mismos días del mes anterior">
                    <MtdTable elapsed={client.mtd.days_elapsed} total={client.mtd.days_in_month} rows={clientMtdRows(client)} />
                  </Section>
                )}

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900 dark:text-white">Últimos 28 días</h2>
                    <button onClick={() => setShowTable((v) => !v)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                      {showTable ? "Ver gráficos" : "Ver tabla"}
                    </button>
                  </div>
                  {showTable ? (
                    <div className="card p-5 overflow-x-auto">
                      <table className="w-full text-sm tabular-nums">
                        <thead>
                          <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-navy-700">
                            <th className="py-2 pr-4 text-left font-medium">Día</th>
                            <th className="py-2 pr-4 text-right font-medium">Sesiones</th>
                            <th className="py-2 pr-4 text-right font-medium">{convLabel(client)}</th>
                            {k.has_revenue && <th className="py-2 text-right font-medium">Ingresos</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {[...client.series].reverse().map((d) => (
                            <tr key={d.date} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0 text-gray-700 dark:text-gray-300">
                              <td className="py-1.5 pr-4">{shortDate(d.date)}</td>
                              <td className="py-1.5 pr-4 text-right">{num(d.sessions)}</td>
                              <td className="py-1.5 pr-4 text-right">{num(d[k.conversion_key])}</td>
                              {k.has_revenue && <td className="py-1.5 text-right">{money(d.revenue, client.currency, true)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {k.has_revenue && (
                        <DailyBars title="Ingresos por día" series={client.series} metric="revenue"
                                   format={(v) => money(v, client.currency)} promos={promosInChart} />
                      )}
                      <DailyBars title={`${convLabel(client)} por día`} series={client.series} metric={k.conversion_key}
                                 format={num} promos={promosInChart} />
                      <DailyBars title="Sesiones por día" series={client.series} metric="sessions"
                                 format={num} promos={promosInChart} />
                    </div>
                  )}
                  {promosInChart.length > 0 && !showTable && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      <span className="inline-block w-3 h-3 align-[-2px] rounded-sm bg-series/10 border border-series/30 mr-1.5" aria-hidden />
                      Días con promoción
                    </p>
                  )}
                </div>

                <Section title="Resultado de las promociones" subtitle="Promos activas en los últimos 30 días">
                  <PromoResults rows={client.promo_results} />
                </Section>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Section title="Canales" subtitle="Últimos 7 días">
                    <Breakdown client={client} rows={client.channels} label="Canal" name={(r) => r.channel} />
                  </Section>
                  <Section title="Campañas" subtitle="Últimos 7 días, por sesiones">
                    <Breakdown client={client} rows={client.campaigns} label="Campaña" name={(r) => (
                      <>
                        {r.campaign}
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{r.source_medium}</span>
                      </>
                    )} />
                    {client.cloudflare?.bot_share != null && client.cloudflare.requests > 0 && (
                      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        Cloudflare ahora (últimos {client.cloudflare.window_minutes} min): {pctFmt(client.cloudflare.bot_share, 0)} de {num(client.cloudflare.requests)} requests son de bots.
                      </p>
                    )}
                  </Section>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Section title="Dispositivos" subtitle="Últimos 7 días">
                    <SegmentTable client={client} rows={client.devices} label="Dispositivo" />
                  </Section>
                  <Section title="Nuevos vs. recurrentes" subtitle="Últimos 7 días">
                    <SegmentTable client={client} rows={client.new_vs_returning} label="Usuarios" />
                  </Section>
                </div>

                {k.conversion_key === "purchases" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Section title="Embudo de compra" subtitle="Últimos 7 días">
                      <Funnel funnel={client.funnel} />
                    </Section>
                    <Section title="Productos más vendidos" subtitle="Últimos 7 días, por ingresos">
                      <TopItems items={client.items} currency={client.currency} />
                    </Section>
                  </div>
                )}

                <Section title="Historial de promociones" subtitle={`Todas las promos medibles de los últimos ${data?.history_days ?? 138} días`}>
                  <PromoRanking rows={client.promo_ranking} days={data?.history_days ?? 138} />
                  {client.promo_history.length > 0 && (
                    <div className="mt-6">
                      <PromoResults rows={client.promo_history} />
                    </div>
                  )}
                </Section>
              </>
            )}

            {upcoming.length > 0 && (
              <Section title="Próximas promociones">
                <ul className="divide-y divide-gray-100 dark:divide-navy-700/60 text-sm">
                  {upcoming.map((p) => (
                    <li key={p.id} className="py-2.5 flex justify-between gap-4">
                      <span className="text-gray-900 dark:text-white">
                        {p.description || PROMO_TYPE[p.promo_type]}
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{PROMO_TYPE[p.promo_type]} · criticidad {p.criticality}/5</span>
                      </span>
                      <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap tabular-nums">{range(p.start_date, p.end_date)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
