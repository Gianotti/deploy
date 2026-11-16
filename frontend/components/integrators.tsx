"use client";

// Integrators: third parties (e.g. Sincroshop) that call our sites' APIs, known by IP or User-Agent.
// - <IntegratorsAdmin/>: /admin tab with the traffic monitor and the CRUD (ABM).
// - <IntegratorsCard clientId/>: card inside a client's Cloudflare detail (/executive).
// Traffic comes from Cloudflare filtered by the integrators' IPs or User-Agents (GET /integrators/traffic).
// - <PublicIntegrators clientId/>: same per-client monitor on /landing/[slug] (GET /public/integrators).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/executive/charts";
import { num, pctFmt } from "@/components/executive/parts";
import { fmtBytes } from "@/components/executive/cloudflare";
import { useAuth } from "@/lib/auth";
import {
  createIntegrator, deleteIntegrator, extractError, getClients, getIntegratorCallers, getIntegrators, getIntegratorTraffic, getPublicIntegratorTraffic, updateIntegrator,
  type Integrator, type IntegratorCallers, type IntegratorInput, type IntegratorTraffic, type IntegratorTrafficRow,
} from "@/lib/api";

const muted = "text-gray-500 dark:text-gray-400";
const thCls = `py-2 pr-4 font-medium ${muted}`;
const tdNum = "py-2 pr-4 tabular-nums text-right text-gray-700 dark:text-gray-300";
const WINDOWS = [
  { value: 15, label: "15 min" }, { value: 60, label: "1 h" }, { value: 360, label: "6 h" }, { value: 1440, label: "24 h" },
];
const REFRESH_MS = 120_000;

const clock = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
const perMin = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v < 10 ? 2 : 0 });
const windowLabel = (m: number) => WINDOWS.find((w) => w.value === m)?.label ?? `${m} min`;

function ago(iso: string | null): string {
  if (!iso) return "sin tráfico en la ventana";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins <= 1) return "activo ahora";
  if (mins < 60) return `visto hace ${mins} min`;
  return `visto a las ${clock(iso)}`;
}

// ── Data hook ────────────────────────────────────────────────────────────────

export function useIntegratorTraffic(minutes: number, clientId?: number, source: "auth" | "public" = "auth") {
  const [data, setData] = useState<IntegratorTraffic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    (source === "public" && clientId != null ? getPublicIntegratorTraffic(minutes, clientId) : getIntegratorTraffic(minutes, clientId))
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false));
  }, [minutes, clientId, source]);
  useEffect(() => {
    load();
    const id = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);
  return { data, error, loading, reload: load };
}

// ── Small parts ──────────────────────────────────────────────────────────────

function Spark({ points }: { points: { t: string; requests: number }[] }) {
  if (points.length < 2) return null;
  const W = 120, H = 28;
  const max = Math.max(1, ...points.map((p) => p.requests));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.requests).toFixed(1)}`).join("");
  return (
    <svg width={W} height={H} aria-hidden className="block shrink-0">
      <path d={`${d}L${W},${H}L0,${H}Z`} className="fill-series/10" />
      <path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" className="stroke-series" />
    </svg>
  );
}

function sumSeries(row: IntegratorTrafficRow) {
  const m = new Map<string, number>();
  for (const c of row.clients) for (const p of c.series) m.set(p.t, (m.get(p.t) ?? 0) + p.requests);
  return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([t, requests]) => ({ t, requests }));
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "down" }) {
  return (
    <div>
      <dt className={`text-xs ${muted}`}>{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone === "down" ? "text-down" : "text-gray-900 dark:text-white"}`}>{value}</dd>
    </div>
  );
}

const METHOD_CLS = "inline-block min-w-[44px] text-center rounded px-1 py-px text-[10px] font-semibold tracking-wide bg-gray-100 dark:bg-navy-700 text-gray-600 dark:text-gray-300";

function PathsTable({ c }: { c: IntegratorTrafficRow["clients"][number] }) {
  const max = Math.max(1, ...c.paths.map((p) => p.requests));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left min-w-[620px]">
        <thead>
          <tr className="border-b border-gray-100 dark:border-navy-700">
            <th className={thCls}>Ruta</th>
            <th className={`${thCls} text-right w-36`}>Requests</th>
            <th className={`${thCls} text-right`}>4xx</th>
            <th className={`${thCls} text-right`}>5xx</th>
            <th className={`${thCls} text-right`}>Transferido</th>
            <th className={thCls}>Respuestas</th>
          </tr>
        </thead>
        <tbody>
          {c.paths.map((p) => (
            <tr key={`${p.method} ${p.path}`} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0 align-top">
              <td className="py-2 pr-4 max-w-[380px]">
                <span className={METHOD_CLS}>{p.method || "—"}</span>{" "}
                <span className="font-mono text-xs break-all text-gray-700 dark:text-gray-200">{p.path}</span>
              </td>
              <td className={tdNum}>
                {num(p.requests)}
                <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-navy-700 overflow-hidden" aria-hidden>
                  <div className="h-full rounded-full bg-series" style={{ width: `${(p.requests / max) * 100}%` }} />
                </div>
              </td>
              <td className={tdNum}>{p.errors_4xx ? num(p.errors_4xx) : "—"}</td>
              <td className={`${tdNum} ${p.errors_5xx ? "text-down font-medium" : ""}`}>{p.errors_5xx ? num(p.errors_5xx) : "—"}</td>
              <td className={tdNum}>{fmtBytes(p.bytes)}</td>
              <td className={`py-2 pr-4 text-xs tabular-nums ${muted}`}>
                {Object.entries(p.status).slice(0, 3).map(([s, n]) => `${s}: ${num(n)}`).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One integrator: totals, activity, IPs, and per-site paths. */
/** "¿Quién llama a /api/v1/* en este sitio?": every IP / UA hitting the integrator's consumed
 *  paths anywhere in the client's zone, loaded when opened. Not on the public page (end-user IPs). */
function CallersPanel({ row, client, minutes }: {
  row: IntegratorTrafficRow; client: IntegratorTrafficRow["clients"][number]; minutes: number;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<IntegratorCallers | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await getIntegratorCallers(row.id, client.client_id, minutes)); }
    catch (e) { setError(extractError(e)); } finally { setLoading(false); }
  }, [row.id, client.client_id, minutes]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const otherHosts = data?.hosts.filter((h) => !h.same_site) ?? [];
  return (
    <details className="rounded-lg bg-gray-50 dark:bg-navy-900/40 px-3 py-2 text-sm"
             onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-gray-700 dark:text-gray-200">
        ¿Quién llama a <span className="font-mono">{row.consumes.join(", ")}</span> en {client.client_name}?
        <span className={`ml-1 ${muted}`}>· {windowLabel(minutes)}, cualquier IP o user-agent</span>
      </summary>
      <div className="pt-3 space-y-3">
        {loading && !data && <div className="h-16 rounded bg-gray-100 dark:bg-navy-700/40 motion-safe:animate-pulse" aria-busy />}
        {error && <p className="text-xs text-down">{error}</p>}
        {data && (
          <>
            <p className={`text-xs ${muted}`}>
              {data.total === 0
                ? <>Nadie llamó a esos paths en la zona {data.zone} en {windowLabel(minutes)}. Revisá que el path esté bien escrito (distingue mayúsculas).</>
                : <>{num(data.total)} requests en {data.zones.length > 1 ? "las zonas" : "la zona"} {data.zone}: {num(data.on_site)} en {data.monitored_hosts.join(", ")} (lo que mira el monitor)
                    {" "}y {num(data.known)} de IPs o user-agents ya cargados.{data.stale ? " Datos anteriores." : ""}</>}
            </p>
            {data.errors.length > 0 && <p className="text-xs text-down">{data.errors.join(" · ")}</p>}
            {otherHosts.length > 0 && (
              <p className="text-xs text-down">
                También llegan a otro host: {otherHosts.map((h) => `${h.host} (${num(h.requests)})`).join(", ")}.
                El monitor solo mira {data.monitored_hosts.join(", ")}: si la API está ahí, sumalo en “Hosts de API” del cliente (Admin → Cloudflare).
              </p>
            )}
            {data.callers.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-navy-700">
                      <th className={thCls}>IP</th><th className={thCls}>User-agent</th><th className={thCls}>Host</th>
                      <th className={`${thCls} text-right`}>Requests</th><th className={thCls}>Integrador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.callers.map((c, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0 align-top">
                        <td className="py-1.5 pr-4 font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">{c.ip}</td>
                        <td className="py-1.5 pr-4 font-mono text-gray-700 dark:text-gray-200 break-all">{c.user_agent || <span className={muted}>(vacío)</span>}</td>
                        <td className={`py-1.5 pr-4 font-mono whitespace-nowrap ${c.same_site ? "text-gray-700 dark:text-gray-200" : "text-down"}`}>{c.host}</td>
                        <td className={tdNum}>{num(c.requests)}</td>
                        <td className="py-1.5 pr-4">
                          {c.integrators.length
                            ? <span className="text-gray-900 dark:text-white">{c.integrators.join(", ")}</span>
                            : <span className={muted}>no cargado</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={load} disabled={loading} className="btn-secondary disabled:opacity-50">{loading ? "Buscando…" : "Volver a buscar"}</button>
              <span className={`text-xs ${muted}`}>Para sumar una IP o user-agent al integrador, cargalo en Administrar.</span>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function IntegratorPanel({ row, minutes, single, diagnose }: { row: IntegratorTrafficRow; minutes: number; single?: boolean; diagnose?: boolean }) {
  const [open, setOpen] = useState<number | null>(single ? row.clients[0]?.client_id ?? null : null);
  const series = useMemo(() => sumSeries(row), [row]);
  const idle = row.requests === 0;
  return (
    <div id={`integrador-${row.id}`} className="rounded-xl border border-gray-200 dark:border-navy-700 p-4 space-y-4 scroll-mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">{row.name}</h3>
          <p className={`text-xs ${muted} mt-0.5 flex items-center gap-1.5`}>
            <span className={`h-2 w-2 rounded-full ${idle ? "bg-ink-3/50" : "bg-up"}`} aria-hidden />
            {ago(row.last_seen)}
          </p>
        </div>
        <Spark points={series} />
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label={`Requests (${windowLabel(minutes)})`} value={num(row.requests)} />
        <Stat label="Por minuto" value={perMin(row.requests_per_min)} />
        <Stat label="Transferido" value={fmtBytes(row.bytes)} />
        <Stat label="Errores 4xx" value={num(row.errors_4xx)} />
        <Stat label="Errores 5xx" value={num(row.errors_5xx)} tone={row.errors_5xx ? "down" : undefined} />
      </dl>

      <div className="flex flex-wrap gap-2">
        {row.ips.map((ip) => (
          <span key={ip.ip} title={ip.requests ? `${num(ip.requests)} requests en la ventana` : "Sin requests de esta IP en la ventana"}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-navy-700 px-2.5 py-0.5 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${ip.requests ? "bg-up" : "bg-ink-3/50"}`} aria-hidden />
            <span className="font-mono text-gray-700 dark:text-gray-200">{ip.ip}</span>
            {ip.label && <span className={muted}>{ip.label}</span>}
            <span className="tabular-nums text-gray-900 dark:text-white">{num(ip.requests)}</span>
          </span>
        ))}
        {row.user_agents.map((u) => (
          <span key={u.pattern} title={`User-agent que contiene “${u.pattern}”` + (u.requests ? ` · ${num(u.requests)} requests en la ventana` : " · sin requests en la ventana")
                  + (u.shared_with.length ? ` · compartido con ${u.shared_with.join(", ")}: esas requests cuentan para cada uno` : "")}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 dark:border-navy-600 px-2.5 py-0.5 text-xs max-w-full">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${u.requests ? "bg-up" : "bg-ink-3/50"}`} aria-hidden />
            <span className={muted}>UA</span>
            <span className="font-mono text-gray-700 dark:text-gray-200 truncate">{u.pattern}</span>
            {u.label && <span className={muted}>{u.label}</span>}
            {u.shared_with.length > 0 && <span className={muted}>· también {u.shared_with.join(", ")}</span>}
            <span className="tabular-nums text-gray-900 dark:text-white">{num(u.requests)}</span>
          </span>
        ))}
        {row.ips.length === 0 && row.user_agents.length === 0 && <span className={`text-xs ${muted}`}>Sin IPs ni user-agents cargados</span>}
      </div>

      <p className={`text-xs ${muted}`}>
        {row.consumes?.length
          ? <>Solo cuenta requests a <span className="font-mono">{row.consumes.join(", ")}</span></>
          : "Cuenta cualquier path (no tiene paths cargados en “Paths que consume”)"}
      </p>

      {diagnose && row.consumes?.length > 0 && row.clients.filter((c) => c.site_host).map((c) => (
        <CallersPanel key={c.client_id} row={row} client={c} minutes={minutes} />
      ))}

      {row.shared_requests > 0 && (
        <p className={`text-xs ${muted}`}>
          {num(row.shared_requests)} de sus requests llegaron con un user-agent que comparte con otro integrador y también se cuentan allá.
          Para separarlas, cargá un user-agent más específico o sus IPs.
        </p>
      )}

      {(row.detected_ips.length > 0 || (row.user_agents.length > 0 && row.ua_seen.length > 0)) && (
        <details className="rounded-lg bg-gray-50 dark:bg-navy-900/40 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-gray-700 dark:text-gray-200">
            Detectado por user-agent
            <span className={`ml-1 ${muted}`}>
              · {row.detected_ips.length} {row.detected_ips.length === 1 ? "IP no cargada" : "IPs no cargadas"}, {row.ua_seen.length} user-agents
            </span>
          </summary>
          <div className="grid gap-4 md:grid-cols-2 pt-3">
            <div>
              <p className={`text-xs ${muted} mb-1`}>IPs desde donde llegó (no cargadas): podés sumarlas en Administrar.</p>
              <ul className="space-y-0.5">
                {row.detected_ips.map((x) => (
                  <li key={x.ip} className="flex justify-between gap-3 font-mono text-xs text-gray-700 dark:text-gray-200">
                    <span>{x.ip}</span><span className="tabular-nums">{num(x.requests)}</span>
                  </li>
                ))}
                {row.detected_ips.length === 0 && <li className={`text-xs ${muted}`}>Ninguna.</li>}
              </ul>
            </div>
            <div className="min-w-0">
              <p className={`text-xs ${muted} mb-1`}>User-agents completos vistos</p>
              <ul className="space-y-0.5">
                {row.ua_seen.map((x) => (
                  <li key={x.user_agent} className="flex justify-between gap-3 font-mono text-xs text-gray-700 dark:text-gray-200">
                    <span className="break-all">{x.user_agent}</span><span className="tabular-nums shrink-0">{num(x.requests)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      )}

      {row.clients.length === 0 && !single && (
        <p className={`text-sm ${muted}`}>Sin clientes asociados: asocialo a sus tiendas en Administrar.</p>
      )}
      {row.clients.length > 0 && (
        single ? (
          row.clients[0].error ? <p className="text-sm text-down">{row.clients[0].error}</p>
          : row.clients[0].paths.length ? <PathsTable c={row.clients[0]} />
          : <p className={`text-sm ${muted}`}>Sin requests de sus IPs ni user-agents en {windowLabel(minutes)}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-navy-700">
                  <th className={thCls}>Sitio</th>
                  <th className={`${thCls} text-right`}>Requests</th>
                  <th className={`${thCls} text-right`}>Errores</th>
                  <th className={`${thCls} text-right`}>Transferido</th>
                  <th className={thCls}>Ruta más pedida</th>
                </tr>
              </thead>
              <tbody>
                {row.clients.map((c) => {
                  const isOpen = open === c.client_id;
                  const errs = c.errors_4xx + c.errors_5xx;
                  return (
                    <Fragment key={c.client_id}>
                      <tr className="border-b border-gray-100 dark:border-navy-700/60">
                        <td className="py-2 pr-4">
                          <button type="button" onClick={() => setOpen(isOpen ? null : c.client_id)} aria-expanded={isOpen}
                                  className="inline-flex items-center gap-1.5 text-left font-medium text-gray-900 dark:text-white hover:underline min-h-[28px]">
                            <svg className={`w-3 h-3 shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 12 12" aria-hidden>
                              <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {c.client_name}
                          </button>
                          <p className={`text-xs pl-[18px] ${c.error ? "text-down" : muted}`}>{c.error ?? (c.hosts?.length ? c.hosts.join(" · ") : c.site_host)}</p>
                        </td>
                        <td className={tdNum}>{num(c.requests)}</td>
                        <td className={`${tdNum} ${c.errors_5xx ? "text-down font-medium" : ""}`}>{errs ? `${num(errs)} (${pctFmt(errs / c.requests, 0)})` : "—"}</td>
                        <td className={tdNum}>{fmtBytes(c.bytes)}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-700 dark:text-gray-200 break-all">
                          {c.paths[0] ? `${c.paths[0].method} ${c.paths[0].path}` : "—"}
                        </td>
                      </tr>
                      {isOpen && c.paths.length > 0 && (
                        <tr className="border-b border-gray-100 dark:border-navy-700/60">
                          <td colSpan={5} className="py-3 px-1"><PathsTable c={c} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function TrafficBody({ live, minutes, single, emptyHint, diagnose }: {
  live: ReturnType<typeof useIntegratorTraffic>; minutes: number; single?: boolean; emptyHint: React.ReactNode;
  /** Show "¿Quién llama…?" (logged-in views only). */
  diagnose?: boolean;
}) {
  const { data, error } = live;
  if (error && !data) return <p className="text-sm text-down">No se pudo cargar el tráfico de integradores: {error}</p>;
  if (!data) return <div className="h-32 rounded-xl bg-gray-100 dark:bg-navy-700/40 motion-safe:animate-pulse" aria-busy />;
  if (!data.configured) return <p className={`text-sm ${muted}`}>Cloudflare no está configurado. Cargá el token en Admin → Cloudflare.</p>;
  if (data.integrators.length === 0) return <>{emptyHint}</>;
  const rows = data.integrators;
  return (
    <div className="space-y-4">
      {data.errors.length > 0 && (
        <p className="text-xs text-down">Sin datos de {data.errors.map((e) => e.client_name).join(", ")}: {data.errors[0].error}</p>
      )}
      {single && <ActiveList rows={rows} minutes={minutes} />}
      {single && <h4 className={`text-xs font-medium uppercase tracking-wide ${muted} pt-2`}>Detalle por integrador</h4>}
      {rows.map((r) => <IntegratorPanel key={r.id} row={r} minutes={minutes} single={single} diagnose={diagnose} />)}
    </div>
  );
}

/** One client: every active integrator linked to it, with its numbers in the window. */
function ActiveList({ rows, minutes }: { rows: IntegratorTrafficRow[]; minutes: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left min-w-[560px]">
        <caption className={`text-left text-xs ${muted} pb-2`}>
          {rows.length} {rows.length === 1 ? "integrador activo" : "integradores activos"} en este cliente · {windowLabel(minutes)}
        </caption>
        <thead>
          <tr className="border-b border-gray-100 dark:border-navy-700">
            <th className={thCls}>Integrador</th>
            <th className={thCls}>Identificado por</th>
            <th className={`${thCls} text-right`}>Requests</th>
            <th className={`${thCls} text-right`}>Por minuto</th>
            <th className={`${thCls} text-right`}>Errores</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const errs = r.errors_4xx + r.errors_5xx;
            const note = r.clients[0]?.error;
            return (
              <tr key={r.id} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
                <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                  <a href={`#integrador-${r.id}`} className="hover:underline">{r.name}</a>
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-gray-700 dark:text-gray-200">
                  {r.ips.length + r.user_agents.length
                    ? [...r.ips.map((x) => x.ip), ...r.user_agents.map((x) => `UA “${x.pattern}”`)].join(", ")
                    : <span className={muted}>sin IPs ni user-agents</span>}
                </td>
                <td className={tdNum}>{num(r.requests)}</td>
                <td className={tdNum}>{perMin(r.requests_per_min)}</td>
                <td className={`${tdNum} ${r.errors_5xx ? "text-down font-medium" : ""}`}>{errs ? `${num(errs)} (${pctFmt(r.error_rate, 0)})` : "—"}</td>
                <td className={`py-2 pr-4 text-xs ${note ? "text-down" : muted}`}>
                  <span className="inline-flex items-center gap-1.5">
                    {!note && <span className={`h-2 w-2 rounded-full ${r.requests ? "bg-up" : "bg-ink-3/50"}`} aria-hidden />}
                    {note ?? ago(r.last_seen)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Card inside a client's Cloudflare detail (/executive) ───────────────────

export function IntegratorsCard({ clientId }: { clientId: number }) {
  const [minutes, setMinutes] = useState(60);
  const live = useIntegratorTraffic(minutes, clientId);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Integradores <span className={`font-normal ${muted}`}>· terceros asociados a este cliente, tráfico por IP</span>
        </h3>
        <Segmented label="Ventana" value={minutes} onChange={setMinutes} options={WINDOWS} />
      </div>
      <TrafficBody live={live} minutes={minutes} single diagnose
                   emptyHint={<p className={`text-sm ${muted}`}>Este cliente no tiene integradores activos asociados. Se asocian en Admin → Integradores → Administrar.</p>} />
    </div>
  );
}

// ── Public section for /landing/[slug] ──────────────────────────────────────

/** Same monitor as the card, unauthenticated; renders nothing until there is traffic to show. */
export function PublicIntegrators({ clientId }: { clientId: number }) {
  const [minutes, setMinutes] = useState(60);
  const live = useIntegratorTraffic(minutes, clientId, "public");
  const d = live.data;
  if (!d || !d.configured || d.integrators.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[17px] font-semibold text-ink">Integradores</h2>
          <p className="text-[13px] text-ink-2">Tráfico de terceros identificados por IP · se actualiza cada 2 min</p>
        </div>
        <Segmented label="Ventana" value={minutes} onChange={setMinutes} options={WINDOWS} />
      </div>
      <TrafficBody live={live} minutes={minutes} single emptyHint={null} />
    </section>
  );
}

// ── Admin tab: monitor + ABM ────────────────────────────────────────────────

function Monitor() {
  const [minutes, setMinutes] = useState(60);
  const live = useIntegratorTraffic(minutes);
  const total = live.data?.integrators.reduce((a, r) => a + r.requests, 0) ?? 0;
  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">Monitor de integradores</h2>
          <p className={`text-sm ${muted}`}>
            Requests de cada integrador (por IP o user-agent) en los clientes a los que está asociado
            {live.data?.configured ? ` · ${num(total)} en ${windowLabel(minutes)}` : ""}
            {live.data?.stale ? " · datos anteriores" : ""}
            {live.data ? ` · ${clock(live.data.generated_at)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented label="Ventana" value={minutes} onChange={setMinutes} options={WINDOWS} />
          <button type="button" onClick={live.reload} disabled={live.loading} className="btn-secondary disabled:opacity-50">
            {live.loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>
      <TrafficBody live={live} minutes={minutes} diagnose
                   emptyHint={<p className={`text-sm ${muted}`}>No hay integradores activos. Cargá uno en Administrar con sus IPs o user-agents.</p>} />
    </div>
  );
}

type Draft = { name: string; notes: string; active: boolean; ips: string; uas: string; consumes: string; client_ids: number[] };
const EMPTY: Draft = { name: "", notes: "", active: true, ips: "", uas: "", consumes: "", client_ids: [] };
type ClientOpt = { id: number; name: string; site_host?: string | null };

/** "100.25.27.248 Servidor prod" per line -> [{ip, label}]. Lines starting with # are ignored. */
export function parseIps(text: string): IntegratorInput["ips"] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [ip, ...rest] = l.split(/[\s,;]+/);
    const label = rest.join(" ").trim();
    return { ip, label: label || null };
  });
}

/** "FravegaSync/1 | Stock" per line -> [{pattern, label}]. User-Agents have spaces, so the
 *  label goes after " | ". Lines starting with # are ignored. */
export function parseUas(text: string): IntegratorInput["user_agents"] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.lastIndexOf(" | ");
    const pattern = (i >= 0 ? l.slice(0, i) : l).trim();
    const label = i >= 0 ? l.slice(i + 3).trim() : "";
    return { pattern, label: label || null };
  });
}

const toDraft = (i: Integrator): Draft => ({
  name: i.name, notes: i.notes ?? "", active: i.active,
  ips: i.ips.map((x) => (x.label ? `${x.ip} ${x.label}` : x.ip)).join("\n"),
  uas: i.user_agents.map((x) => (x.label ? `${x.pattern} | ${x.label}` : x.pattern)).join("\n"),
  consumes: (i.consumes ?? []).join("\n"),
  client_ids: i.clients.map((c) => c.id),
});

function ClientPicker({ clients, value, onChange }: { clients: ClientOpt[]; value: number[]; onChange: (v: number[]) => void }) {
  const [q, setQ] = useState("");
  const shown = clients.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset>
      <legend className="field-label">
        Clientes donde opera <span className={`font-normal ${muted}`}>· solo se busca su tráfico en estos ({value.length} {value.length === 1 ? "seleccionado" : "seleccionados"})</span>
      </legend>
      {clients.length > 8 && (
        <input className="field w-full mb-2" type="search" placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-navy-700 p-2">
        {shown.map((c) => (
          <label key={c.id} className="flex items-center gap-2 min-h-[32px] text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" className="h-4 w-4" checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
            <span className="truncate">{c.name}</span>
            {!c.site_host && <span className="text-[11px] text-down whitespace-nowrap" title="Sin dominio: no se puede medir en Cloudflare">sin dominio</span>}
          </label>
        ))}
        {shown.length === 0 && <p className={`text-sm ${muted} p-1`}>Ningún cliente coincide.</p>}
      </div>
    </fieldset>
  );
}

function IntegratorForm({ initial, clients, onSave, onCancel, saving, error }: {
  initial: Draft; clients: ClientOpt[]; onSave: (d: Draft) => void; onCancel?: () => void; saving: boolean; error: string;
}) {
  const [d, setD] = useState(initial);
  const n = parseIps(d.ips).length;
  const nUa = parseUas(d.uas).length;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(d); }} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="field-label">Nombre</span>
          <input className="field w-full" required placeholder="Sincroshop" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 self-end min-h-[40px] text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="h-4 w-4" />
          Activo (se incluye en el monitor)
        </label>
      </div>
      <p className={`text-sm ${muted}`}>
        Se identifica por IP <strong className="font-medium text-gray-700 dark:text-gray-200">o</strong> por user-agent: cargá lo que tengas.
        Una request es suya si viene de una de sus IPs o si su user-agent contiene alguno de los textos.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <label className="block">
          <span className="field-label">IPs <span className={`font-normal ${muted}`}>· una por línea, con etiqueta opcional ({n} {n === 1 ? "IP" : "IPs"})</span></span>
          <textarea className="field w-full font-mono text-sm" rows={4} placeholder={"100.25.27.248 Servidor prod\n100.25.27.249"}
                    value={d.ips} onChange={(e) => setD({ ...d, ips: e.target.value })} />
        </label>
        <label className="block">
          <span className="field-label">User-agents <span className={`font-normal ${muted}`}>· uno por línea, etiqueta después de “ | ” ({nUa})</span></span>
          <textarea className="field w-full font-mono text-sm" rows={4} placeholder={"SincroshopBot/2.1 | Sync de stock\nAcmeConnector"}
                    value={d.uas} onChange={(e) => setD({ ...d, uas: e.target.value })} />
          <span className={`block text-xs ${muted} mt-1`}>
            Busca que el user-agent <em>contenga</em> el texto; distingue mayúsculas. Mínimo 4 caracteres. Puede repetirse en otros integradores: si comparten tienda, esas requests cuentan para cada uno. Evitá textos genéricos como “Mozilla” solo.
          </span>
        </label>
      </div>
      <ClientPicker clients={clients} value={d.client_ids} onChange={(client_ids) => setD({ ...d, client_ids })} />
      <label className="block">
        <span className="field-label">Paths que consume <span className={`font-normal ${muted}`}>· uno por línea; solo se cuentan requests a estos paths</span></span>
        <textarea className="field w-full font-mono text-sm" rows={3} placeholder={"/api/v1/authenticate\n/api/v1/products/\n/api/v1/orders/"}
                  value={d.consumes} onChange={(e) => setD({ ...d, consumes: e.target.value })} />
        <span className={`block text-xs ${muted} mt-1`}>
          Cuenta todo lo que <em>empiece</em> con el path (/api/v1/products/ incluye /api/v1/products/123), así que /* al final es opcional. <code>*</code> en el medio es comodín: /api/*/orders. Así no se mezclan escaneos como /login_up.php que vienen de la misma IP. Vacío = cualquier path.
        </span>
      </label>
      <label className="block">
        <span className="field-label">Notas <span className={`font-normal ${muted}`}>· contacto, etc.</span></span>
        <textarea className="field w-full text-sm" rows={3} placeholder={"Contacto: soporte@integrador.com"}
                  value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </label>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Guardando…" : "Guardar integrador"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>}
      </div>
    </form>
  );
}

function Abm() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<Integrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<ClientOpt[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await getIntegrators()); } catch (e) { setError(extractError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    getClients().then((cs) => setClients([...cs].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => setClients([]));
  }, [isAdmin]);

  async function save(id: number | null, d: Draft) {
    setSaving(true); setError("");
    const body: IntegratorInput = {
      name: d.name.trim(), notes: d.notes.trim() || null, active: d.active, ips: parseIps(d.ips), user_agents: parseUas(d.uas),
      consumes: d.consumes.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")), client_ids: d.client_ids,
    };
    try {
      if (id == null) await createIntegrator(body); else await updateIntegrator(id, body);
      setEditing(null); await load();
    } catch (e) { setError(extractError(e)); } finally { setSaving(false); }
  }

  async function remove(i: Integrator) {
    if (!confirm(`¿Eliminar el integrador "${i.name}" con sus ${i.ips.length} IPs y ${i.user_agents.length} user-agents?`)) return;
    try { await deleteIntegrator(i.id); await load(); } catch (e) { alert(extractError(e)); }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">Integradores</h2>
          <p className={`text-sm ${muted}`}>Terceros que consumen nuestras APIs. Su tráfico se detecta en Cloudflare por IP o por user-agent.</p>
        </div>
        {isAdmin && editing !== "new" && (
          <button type="button" onClick={() => { setEditing("new"); setError(""); }} className="btn-primary">+ Nuevo integrador</button>
        )}
      </div>

      {editing === "new" && (
        <div className="rounded-xl border border-gray-200 dark:border-navy-700 p-4">
          <IntegratorForm initial={EMPTY} clients={clients} onSave={(d) => save(null, d)} onCancel={() => setEditing(null)} saving={saving} error={error} />
        </div>
      )}

      {loading && <p className="text-gray-400 text-sm">Cargando…</p>}
      {!loading && items.length === 0 && editing !== "new" && <p className={`text-sm ${muted}`}>Todavía no hay integradores.</p>}

      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id} className="rounded-xl border border-gray-200 dark:border-navy-700 p-4">
            {editing === i.id ? (
              <IntegratorForm initial={toDraft(i)} clients={clients} onSave={(d) => save(i.id, d)} onCancel={() => setEditing(null)} saving={saving} error={error} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {i.name}
                    {!i.active && <span className="ml-2 text-[11px] rounded-full border border-gray-200 dark:border-navy-700 px-1.5 py-px text-gray-600 dark:text-gray-300 font-normal">inactivo</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {i.ips.map((x) => (
                      <span key={x.ip} className="rounded-full bg-gray-100 dark:bg-navy-700 px-2.5 py-0.5 text-xs">
                        <span className="font-mono text-gray-800 dark:text-gray-200">{x.ip}</span>
                        {x.label && <span className={`ml-1 ${muted}`}>{x.label}</span>}
                      </span>
                    ))}
                    {i.user_agents.map((x) => (
                      <span key={x.pattern} className="rounded-full border border-dashed border-gray-300 dark:border-navy-600 px-2.5 py-0.5 text-xs">
                        <span className={`mr-1 ${muted}`}>UA</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{x.pattern}</span>
                        {x.label && <span className={`ml-1 ${muted}`}>{x.label}</span>}
                      </span>
                    ))}
                    {i.ips.length === 0 && i.user_agents.length === 0 && (
                      <span className="text-xs text-down">Sin IPs ni user-agents: no se puede detectar su tráfico</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-200">
                    <span className={muted}>Clientes: </span>
                    {i.clients.length
                      ? i.clients.map((c) => c.name).join(", ")
                      : <span className="text-down">ninguno, no se busca su tráfico</span>}
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-200">
                    <span className={muted}>Consume: </span>
                    {i.consumes?.length
                      ? <span className="font-mono text-xs">{i.consumes.join("  ·  ")}</span>
                      : <span className={muted}>cualquier path</span>}
                  </p>
                  {i.notes && <p className={`text-sm ${muted} whitespace-pre-line`}>{i.notes}</p>}
                </div>
                {isAdmin && (
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => { setEditing(i.id); setError(""); }} className="btn-secondary">Editar</button>
                    <button type="button" onClick={() => remove(i)} className="btn-secondary hover:!text-red-500">Eliminar</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IntegratorsAdmin() {
  const [view, setView] = useState<"monitor" | "abm">("monitor");
  return (
    <div className="space-y-4">
      <Segmented label="Ver" value={view} onChange={setView}
                 options={[{ value: "monitor", label: "Monitor" }, { value: "abm", label: "Administrar" }]} />
      {view === "monitor" ? <Monitor /> : <Abm />}
    </div>
  );
}
