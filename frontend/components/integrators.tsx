"use client";

// Integrators: third parties (e.g. Sincroshop) that call our sites' APIs from known IPs.
// - <IntegratorsAdmin/>: /admin tab with the traffic monitor and the CRUD (ABM).
// - <IntegratorsCard clientId/>: card inside a client's Cloudflare detail (/executive).
// Traffic comes from Cloudflare filtered by the integrators' IPs (GET /integrators/traffic).
// Never shown on the public landing.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/executive/charts";
import { num, pctFmt } from "@/components/executive/parts";
import { fmtBytes } from "@/components/executive/cloudflare";
import { useAuth } from "@/lib/auth";
import {
  createIntegrator, deleteIntegrator, extractError, getIntegrators, getIntegratorTraffic, updateIntegrator,
  type Integrator, type IntegratorInput, type IntegratorTraffic, type IntegratorTrafficRow,
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

export function useIntegratorTraffic(minutes: number, clientId?: number) {
  const [data, setData] = useState<IntegratorTraffic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    getIntegratorTraffic(minutes, clientId)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false));
  }, [minutes, clientId]);
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
function IntegratorPanel({ row, minutes, single }: { row: IntegratorTrafficRow; minutes: number; single?: boolean }) {
  const [open, setOpen] = useState<number | null>(single ? row.clients[0]?.client_id ?? null : null);
  const series = useMemo(() => sumSeries(row), [row]);
  const idle = row.requests === 0;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-700 p-4 space-y-4">
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
        {row.ips.length === 0 && <span className={`text-xs ${muted}`}>Sin IPs cargadas</span>}
      </div>

      {row.clients.length > 0 && (
        single ? <PathsTable c={row.clients[0]} /> : (
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
                          <p className={`text-xs ${muted} pl-[18px]`}>{c.site_host}</p>
                        </td>
                        <td className={tdNum}>{num(c.requests)}</td>
                        <td className={`${tdNum} ${c.errors_5xx ? "text-down font-medium" : ""}`}>{errs ? `${num(errs)} (${pctFmt(errs / c.requests, 0)})` : "—"}</td>
                        <td className={tdNum}>{fmtBytes(c.bytes)}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-700 dark:text-gray-200 break-all">
                          {c.paths[0] ? `${c.paths[0].method} ${c.paths[0].path}` : "—"}
                        </td>
                      </tr>
                      {isOpen && (
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

function TrafficBody({ live, minutes, single, emptyHint }: {
  live: ReturnType<typeof useIntegratorTraffic>; minutes: number; single?: boolean; emptyHint: React.ReactNode;
}) {
  const { data, error } = live;
  if (error && !data) return <p className="text-sm text-down">No se pudo cargar el tráfico de integradores: {error}</p>;
  if (!data) return <div className="h-32 rounded-xl bg-gray-100 dark:bg-navy-700/40 motion-safe:animate-pulse" aria-busy />;
  if (!data.configured) return <p className={`text-sm ${muted}`}>Cloudflare no está configurado. Cargá el token en Admin → Cloudflare.</p>;
  if (data.integrators.length === 0) return <>{emptyHint}</>;
  const rows = single ? data.integrators.filter((r) => r.requests > 0) : data.integrators;
  return (
    <div className="space-y-4">
      {data.errors.length > 0 && (
        <p className="text-xs text-down">Sin datos de {data.errors.map((e) => e.client_name).join(", ")}: {data.errors[0].error}</p>
      )}
      {single && rows.length === 0 && (
        <p className={`text-sm ${muted}`}>Ningún integrador consumió este sitio en {windowLabel(minutes) === "1 h" ? "la última hora" : `los últimos ${windowLabel(minutes)}`}.</p>
      )}
      {rows.map((r) => <IntegratorPanel key={r.id} row={r} minutes={minutes} single={single} />)}
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
          Integradores <span className={`font-normal ${muted}`}>· tráfico de terceros identificados por IP</span>
        </h3>
        <Segmented label="Ventana" value={minutes} onChange={setMinutes} options={WINDOWS} />
      </div>
      <TrafficBody live={live} minutes={minutes} single
                   emptyHint={<p className={`text-sm ${muted}`}>No hay integradores cargados. Se dan de alta en Admin → Integradores.</p>} />
    </div>
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
            Requests de las IPs de cada integrador en todos los sitios con Cloudflare
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
      <TrafficBody live={live} minutes={minutes}
                   emptyHint={<p className={`text-sm ${muted}`}>No hay integradores activos. Cargá uno abajo con sus IPs.</p>} />
    </div>
  );
}

type Draft = { name: string; notes: string; active: boolean; ips: string };
const EMPTY: Draft = { name: "", notes: "", active: true, ips: "" };

/** "100.25.27.248 Servidor prod" per line -> [{ip, label}]. Lines starting with # are ignored. */
export function parseIps(text: string): IntegratorInput["ips"] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [ip, ...rest] = l.split(/[\s,;]+/);
    const label = rest.join(" ").trim();
    return { ip, label: label || null };
  });
}

const toDraft = (i: Integrator): Draft => ({
  name: i.name, notes: i.notes ?? "", active: i.active,
  ips: i.ips.map((x) => (x.label ? `${x.ip} ${x.label}` : x.ip)).join("\n"),
});

function IntegratorForm({ initial, onSave, onCancel, saving, error }: {
  initial: Draft; onSave: (d: Draft) => void; onCancel?: () => void; saving: boolean; error: string;
}) {
  const [d, setD] = useState(initial);
  const n = parseIps(d.ips).length;
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
      <label className="block">
        <span className="field-label">IPs <span className={`font-normal ${muted}`}>· una por línea, con una etiqueta opcional ({n} {n === 1 ? "IP" : "IPs"})</span></span>
        <textarea className="field w-full font-mono text-sm" rows={4} placeholder={"100.25.27.248 Servidor prod\n100.25.27.249"}
                  value={d.ips} onChange={(e) => setD({ ...d, ips: e.target.value })} />
      </label>
      <label className="block">
        <span className="field-label">Notas <span className={`font-normal ${muted}`}>· qué consume, contacto, etc.</span></span>
        <textarea className="field w-full text-sm" rows={3} placeholder={"Consume BNA: api/v1/authenticate, api/v1/products/, api/v1/orders/"}
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

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await getIntegrators()); } catch (e) { setError(extractError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(id: number | null, d: Draft) {
    setSaving(true); setError("");
    const body: IntegratorInput = { name: d.name.trim(), notes: d.notes.trim() || null, active: d.active, ips: parseIps(d.ips) };
    try {
      if (id == null) await createIntegrator(body); else await updateIntegrator(id, body);
      setEditing(null); await load();
    } catch (e) { setError(extractError(e)); } finally { setSaving(false); }
  }

  async function remove(i: Integrator) {
    if (!confirm(`¿Eliminar el integrador "${i.name}" y sus ${i.ips.length} IPs?`)) return;
    try { await deleteIntegrator(i.id); await load(); } catch (e) { alert(extractError(e)); }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">Integradores</h2>
          <p className={`text-sm ${muted}`}>Terceros que consumen nuestras APIs. Su tráfico se detecta en Cloudflare por IP.</p>
        </div>
        {isAdmin && editing !== "new" && (
          <button type="button" onClick={() => { setEditing("new"); setError(""); }} className="btn-primary">+ Nuevo integrador</button>
        )}
      </div>

      {editing === "new" && (
        <div className="rounded-xl border border-gray-200 dark:border-navy-700 p-4">
          <IntegratorForm initial={EMPTY} onSave={(d) => save(null, d)} onCancel={() => setEditing(null)} saving={saving} error={error} />
        </div>
      )}

      {loading && <p className="text-gray-400 text-sm">Cargando…</p>}
      {!loading && items.length === 0 && editing !== "new" && <p className={`text-sm ${muted}`}>Todavía no hay integradores.</p>}

      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id} className="rounded-xl border border-gray-200 dark:border-navy-700 p-4">
            {editing === i.id ? (
              <IntegratorForm initial={toDraft(i)} onSave={(d) => save(i.id, d)} onCancel={() => setEditing(null)} saving={saving} error={error} />
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
                    {i.ips.length === 0 && <span className={`text-xs ${muted}`}>Sin IPs: no se puede detectar su tráfico</span>}
                  </div>
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
