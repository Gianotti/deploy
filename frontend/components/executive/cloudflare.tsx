"use client";

// "Analytics de Cloudflare" for /executive and /executive/<slug>: live consumption
// and what the cache returns, the same for every client. For clients without GA4
// (e.g. embedded inside another app) this is the only traffic source.
// Chart rules as in charts.tsx: one axis, stacked area with a 2px top line,
// cache = series color, origin = muted ink, legend + table twin, keyboard scrub.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PAD, Tooltip, ticks, useScrub, useWidth } from "@/components/executive/charts";
import { num, pctFmt, Section } from "@/components/executive/parts";
import {
  extractError, getExecutiveCloudflare,
  type CfAnalytics, type CfClientRow, type ExecCloudflare,
} from "@/lib/api";

// ── Data hook: fetch now and every minute while the tab is visible ────────────

export const CF_REFRESH_MS = 60_000;

export function useCloudflareLive() {
  const [data, setData] = useState<ExecCloudflare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    getExecutiveCloudflare().then((d) => { setData(d); setError(null); }).catch((e) => setError(extractError(e)));
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(() => { if (!document.hidden) load(); }, CF_REFRESH_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);
  return { data, error };
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtBytes(v: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("es-AR", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

const perMin = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v < 10 ? 1 : 0 });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** What each Cloudflare cacheStatus means, in words a business reader understands. */
export const CACHE_LABEL: Record<string, string> = {
  hit: "Desde caché",
  stale: "Caché vencida (servida igual)",
  revalidated: "Caché revalidada",
  updating: "Caché actualizándose",
  miss: "No estaba en caché",
  expired: "Caché vencida (fue al origen)",
  dynamic: "Dinámico, no cacheable",
  bypass: "Saltea la caché",
  none: "Sin caché",
  unknown: "Sin caché",
};
const cacheLabel = (s: string) => CACHE_LABEL[s] ?? s;

const STATIC_RE = /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|map|json)(\?|$)/i;

const muted = "text-gray-500 dark:text-gray-400";
const thCls = `py-2 pr-4 font-medium ${muted}`;
const tdNum = "py-2 pr-4 tabular-nums text-right text-gray-700 dark:text-gray-300";

function Bar({ value, cached = true }: { value: number; cached?: boolean }) {
  return (
    <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-navy-700 overflow-hidden" aria-hidden>
      <div className={`h-full rounded-full ${cached ? "bg-series" : "bg-ink-3/60"}`} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className={`text-xs ${muted}`}>{label}</dt>
      <dd className="text-xl font-semibold text-gray-900 dark:text-white mt-0.5">{value}</dd>
      {sub && <dd className={`text-xs ${muted} mt-0.5`}>{sub}</dd>}
    </div>
  );
}

function LiveBadge({ at, stale }: { at: string | null; stale?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${muted} whitespace-nowrap`}>
      <span className={`h-2 w-2 rounded-full ${stale ? "bg-ink-3" : "bg-up motion-safe:animate-pulse"}`} aria-hidden />
      {stale ? "Datos anteriores" : "En vivo"}{at ? ` · ${clock(at)}` : ""}
    </span>
  );
}

// ── Sparkline: requests per minute, last hour (numbers are in the row) ───────

function Spark({ series }: { series: CfAnalytics["series"] }) {
  if (series.length < 2) return <span className={muted}>—</span>;
  const W = 96, H = 24;
  const max = Math.max(1, ...series.map((p) => p.requests));
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.requests).toFixed(1)}`).join("");
  return (
    <svg width={W} height={H} aria-hidden className="block">
      <path d={`${d}L${W},${H}L0,${H}Z`} className="fill-series/10" />
      <path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" className="stroke-series" />
    </svg>
  );
}

// ── Live chart: last hour per minute, cache vs. origin stacked ───────────────

function StackKey({ cached }: { cached: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cached ? "bg-series" : "bg-ink-3/50"}`} aria-hidden />;
}

export function LiveChart({ series, label }: { series: CfAnalytics["series"]; label: string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 200;
  const n = series.length;
  const { hover, setHover, focusProps } = useScrub(Math.max(0, n - 1), Math.max(0, n - 1));
  if (n < 2) return <p className={`text-sm ${muted}`}>Todavía no hay suficientes minutos para dibujar la última hora.</p>;

  const max = Math.max(1, ...series.map((p) => p.requests));
  const yT = ticks(0, max);
  const top = yT[yT.length - 1];
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (n - 1)) * iw;
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const line = (get: (p: CfAnalytics["series"][number]) => number) =>
    series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join("");
  const totalLine = line((p) => p.requests);
  const cachedLine = line((p) => p.cached);
  const base = `L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const originArea = `${totalLine}${series.slice().reverse().map((p, k) => `L${x(n - 1 - k).toFixed(1)},${y(p.cached).toFixed(1)}`).join("")}Z`;
  const xEvery = Math.max(1, Math.round(n / Math.max(2, Math.floor(iw / 90))));
  const h = hover != null ? series[hover] : null;
  const last = series[n - 1];
  const summary = `${label}: última hora por minuto. Último minuto ${num(last.requests)} requests, ${num(last.cached)} desde caché.`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };

  return (
    <figure>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300 mb-2">
        <span className="inline-flex items-center gap-1.5"><StackKey cached /> Desde caché</span>
        <span className="inline-flex items-center gap-1.5"><StackKey cached={false} /> Al origen</span>
      </div>
      <div ref={ref} className="relative outline-none focus-visible:ring-2 focus-visible:ring-series/50 rounded-md"
           role="group" aria-label={summary} {...focusProps}>
        <svg width={W} height={H} aria-hidden className="block">
          {yT.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} strokeWidth="1" className="stroke-line" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-ink-3 tabular-nums">{num(t)}</text>
            </g>
          ))}
          {series.map((p, i) => i % xEvery === 0 && (
            <text key={p.t} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-ink-3 tabular-nums">{clock(p.t)}</text>
          ))}
          <path d={`${cachedLine}${base}`} className="fill-series/35" />
          <path d={originArea} className="fill-ink-3/25" />
          <path d={cachedLine} fill="none" strokeWidth="1.5" className="stroke-series" strokeLinejoin="round" />
          <path d={totalLine} fill="none" strokeWidth="2" className="stroke-ink-3" strokeLinejoin="round" />
          {h && hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} strokeWidth="1" className="stroke-ink-3" />
              <circle cx={x(hover)} cy={y(h.requests)} r="4" strokeWidth="2" className="fill-ink-3 stroke-card" />
              <circle cx={x(hover)} cy={y(h.cached)} r="4" strokeWidth="2" className="fill-series stroke-card" />
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent"
                onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {h && hover != null && (
          <Tooltip x={x(hover)} width={W}>
            <p className="text-gray-500 dark:text-gray-400 mb-1">{clock(h.t)}</p>
            <p className="tabular-nums"><span className="font-semibold text-gray-900 dark:text-white">{num(h.requests)}</span> <span className={muted}>requests · {fmtBytes(h.bytes)}</span></p>
            <p className="flex items-center gap-1.5 tabular-nums"><StackKey cached /><span className="font-semibold text-gray-900 dark:text-white">{num(h.cached)}</span><span className={muted}>desde caché</span></p>
            <p className="flex items-center gap-1.5 tabular-nums"><StackKey cached={false} /><span className="font-semibold text-gray-900 dark:text-white">{num(h.requests - h.cached)}</span><span className={muted}>al origen</span></p>
          </Tooltip>
        )}
      </div>
      <details className="mt-2 text-sm print:hidden">
        <summary className={`cursor-pointer ${muted}`}>Ver datos por minuto</summary>
        <div className="max-h-64 overflow-auto mt-2">
          <table className="w-full text-left">
            <thead><tr><th className={thCls}>Minuto</th><th className={`${thCls} text-right`}>Requests</th><th className={`${thCls} text-right`}>Desde caché</th><th className={`${thCls} text-right`}>Al origen</th><th className={`${thCls} text-right`}>Transferido</th></tr></thead>
            <tbody>
              {series.slice().reverse().map((p) => (
                <tr key={p.t}><td className="py-1 pr-4 tabular-nums">{clock(p.t)}</td><td className={tdNum}>{num(p.requests)}</td><td className={tdNum}>{num(p.cached)}</td><td className={tdNum}>{num(p.requests - p.cached)}</td><td className={tdNum}>{fmtBytes(p.bytes)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// ── Per-site detail: chart, what the cache returns, top pages ────────────────

function SiteFacts({ d }: { d: CfAnalytics }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <Fact label="Requests por minuto" value={perMin(d.requests_per_min)} sub={`${num(d.requests)} en ${d.window_minutes} min`} />
      <Fact label="Servido desde caché" value={pctFmt(d.cache.hit_ratio, 0)} sub={`${pctFmt(d.cache.bytes_ratio, 0)} de los bytes`} />
      <Fact label="Fue al origen" value={num(d.cache.origin_requests)} sub="requests que llegaron al servidor" />
      <Fact label="Transferido" value={fmtBytes(d.bytes)} sub={d.visits != null ? `${num(d.visits)} visitas` : `en ${d.window_minutes} min`} />
      <Fact label="Errores del servidor" value={pctFmt(d.health.error_rate, 1)}
            sub={d.health.origin_ms != null ? `origen responde en ${num(d.health.origin_ms)} ms` : "respuestas 5xx"} />
    </dl>
  );
}

export function SiteDetail({ d, name }: { d: CfAnalytics; name: string }) {
  const totalReq = Math.max(1, d.requests);
  return (
    <div className="space-y-6">
      <SiteFacts d={d} />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Última hora, por minuto</h3>
          <LiveChart series={d.series} label={name} />
        </div>
        <div className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Qué devuelve la caché</h3>
          {d.cache.by_status.length === 0 ? <p className={`text-sm ${muted}`}>Sin requests en la ventana.</p> : (
            <ul className="space-y-2.5">
              {d.cache.by_status.map((s) => (
                <li key={s.status}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-gray-700 dark:text-gray-200">{cacheLabel(s.status)} <span className={`text-xs ${muted}`}>({s.status})</span></span>
                    <span className="tabular-nums text-gray-900 dark:text-white font-medium">{pctFmt(s.requests / totalReq, 0)}</span>
                  </div>
                  <Bar value={s.requests / totalReq} cached={s.cached} />
                  <p className={`text-xs ${muted} mt-0.5 tabular-nums`}>{num(s.requests)} requests · {fmtBytes(s.bytes)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {d.top_paths.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Páginas y archivos más pedidos</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[520px]">
              <thead><tr className="border-b border-gray-100 dark:border-navy-700"><th className={thCls}>Ruta</th><th className={`${thCls} text-right`}>Requests</th><th className={`${thCls} text-right`}>Desde caché</th><th className={`${thCls} text-right`}>Transferido</th></tr></thead>
              <tbody>
                {d.top_paths.map((p) => {
                  const hint = p.cached_share < 0.2 && STATIC_RE.test(p.path);
                  return (
                    <tr key={p.path} className="border-b border-gray-100 dark:border-navy-700/60 last:border-0">
                      <td className="py-2 pr-4 max-w-[360px]">
                        <span className="font-mono text-xs break-all text-gray-700 dark:text-gray-200">{p.path}</span>
                        {hint && <span className="ml-2 text-[11px] rounded-full border border-gray-200 dark:border-navy-700 px-1.5 py-px text-gray-600 dark:text-gray-300 whitespace-nowrap" title="Es un archivo estático que casi siempre va al origen: probablemente se pueda cachear">podría cachearse</span>}
                      </td>
                      <td className={tdNum}>{num(p.requests)}</td>
                      <td className={tdNum}>{pctFmt(p.cached_share, 0)}<Bar value={p.cached_share} /></td>
                      <td className={tdNum}>{fmtBytes(p.bytes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row messages for clients without data ───────────────────────────────────

function rowMessage(r: CfClientRow): string {
  if (r.status === "no_host") return "Sin dominio configurado (Admin → Clientes)";
  if (r.status === "no_zone") return `${r.site_host} no está en ninguna zona de esta cuenta de Cloudflare`;
  if (r.status === "error") return `Cloudflare no respondió: ${r.error ?? "error desconocido"}`;
  return "Sin datos";
}

function NoGa4() {
  return (
    <span className="ml-2 text-[11px] rounded-full border border-gray-200 dark:border-navy-700 px-1.5 py-px text-gray-600 dark:text-gray-300 whitespace-nowrap"
          title="Este cliente no tiene GA4: Cloudflare es su única fuente de tráfico">sin GA4</span>
  );
}

// ── The section ─────────────────────────────────────────────────────────────

export function CloudflareAnalytics({ live, clientId }: { live: ReturnType<typeof useCloudflareLive>; clientId?: number }) {
  const { data, error } = live;
  const [open, setOpen] = useState<number | null>(null);
  const rows = useMemo(() => {
    const all = data?.clients ?? [];
    const list = clientId != null ? all.filter((r) => r.client_id === clientId) : all;
    return [...list].sort((a, b) => (b.data?.requests ?? -1) - (a.data?.requests ?? -1) || a.client_name.localeCompare(b.client_name));
  }, [data, clientId]);
  const stale = rows.some((r) => r.data?.stale);
  const subtitle = data
    ? `Consumo en vivo${clientId == null ? " de todos los sitios, también los que no tienen GA4" : ""}. Últimos ${data.window_minutes} min; el gráfico muestra la última hora. Se actualiza cada minuto.`
    : "Consumo en vivo y comportamiento de la caché.";

  let body: React.ReactNode;
  if (error && !data) body = <p className="text-sm text-down">No se pudo cargar Cloudflare: {error}</p>;
  else if (!data) body = <div className="h-40 rounded-xl bg-gray-100 dark:bg-navy-700/40 animate-pulse" aria-busy />;
  else if (!data.configured) body = <p className={`text-sm ${muted}`}>Cloudflare no está configurado. Cargá el token en Admin → Cloudflare.</p>;
  else if (clientId != null) {
    const r = rows[0];
    body = !r ? <p className={`text-sm ${muted}`}>Cliente no encontrado.</p>
      : r.data ? <SiteDetail d={r.data} name={r.client_name} />
      : <p className={`text-sm ${muted}`}>{rowMessage(r)}</p>;
  } else {
    const eco = data.ecosystem;
    body = (
      <div className="space-y-6">
        {eco && eco.sites > 0 && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Fact label="Requests por minuto" value={perMin(eco.requests_per_min)} sub={`${eco.sites} ${eco.sites === 1 ? "sitio" : "sitios"} · ${num(eco.requests)} en ${data.window_minutes} min`} />
            <Fact label="Servido desde caché" value={pctFmt(eco.hit_ratio, 0)} sub={`${pctFmt(eco.bytes_ratio, 0)} de los bytes`} />
            <Fact label="Fue al origen" value={num(eco.origin_requests)} sub="requests que llegaron a los servidores" />
            <Fact label="Transferido" value={fmtBytes(eco.bytes)} sub={eco.visits != null ? `${num(eco.visits)} visitas` : `en ${data.window_minutes} min`} />
            <Fact label="Errores del servidor" value={pctFmt(eco.error_rate, 1)} sub="respuestas 5xx" />
          </dl>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left min-w-[860px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-navy-700">
                <th className={thCls}>Cliente</th>
                <th className={thCls}>Última hora</th>
                <th className={`${thCls} text-right`}>Req/min</th>
                <th className={`${thCls} text-right`}>Visitas</th>
                <th className={`${thCls} text-right`}>Transferido</th>
                <th className={`${thCls} text-right`}>Desde caché</th>
                <th className={`${thCls} text-right`}>Al origen</th>
                <th className={`${thCls} text-right`}>5xx</th>
                <th className={`${thCls} text-right`}>Origen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = r.data;
                const isOpen = open === r.client_id;
                return (
                  <Fragment key={r.client_id}>
                    <tr className="border-b border-gray-100 dark:border-navy-700/60 align-middle">
                      <td className="py-2 pr-4">
                        {d ? (
                          <button type="button" onClick={() => setOpen(isOpen ? null : r.client_id)} aria-expanded={isOpen}
                                  className="inline-flex items-center gap-1.5 text-left font-medium text-gray-900 dark:text-white hover:underline min-h-[28px]">
                            <svg className={`w-3 h-3 shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 12 12" aria-hidden>
                              <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {r.client_name}
                          </button>
                        ) : <span className="font-medium text-gray-900 dark:text-white pl-[18px]">{r.client_name}</span>}
                        {!r.has_ga4 && <NoGa4 />}
                        <p className={`text-xs ${muted} pl-[18px]`}>{d ? d.host : r.country_name}</p>
                      </td>
                      {d ? (
                        <>
                          <td className="py-2 pr-4"><Spark series={d.series} /></td>
                          <td className={tdNum}>{perMin(d.requests_per_min)}</td>
                          <td className={tdNum}>{d.visits != null ? num(d.visits) : "—"}</td>
                          <td className={tdNum}>{fmtBytes(d.bytes)}</td>
                          <td className={`${tdNum} w-28`}>{pctFmt(d.cache.hit_ratio, 0)}<Bar value={d.cache.hit_ratio} /></td>
                          <td className={tdNum}>{num(d.cache.origin_requests)}</td>
                          <td className={`${tdNum} ${d.health.error_rate >= 0.01 ? "text-down font-medium" : ""}`}>{pctFmt(d.health.error_rate, 1)}</td>
                          <td className={tdNum}>{d.health.origin_ms != null ? `${num(d.health.origin_ms)} ms` : "—"}</td>
                        </>
                      ) : (
                        <td colSpan={8} className={`py-2 pr-4 text-sm ${muted}`}>{rowMessage(r)}</td>
                      )}
                    </tr>
                    {d && isOpen && (
                      <tr className="border-b border-gray-100 dark:border-navy-700/60">
                        <td colSpan={9} className="py-5 px-1"><SiteDetail d={d} name={r.client_name} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Section title="Analytics de Cloudflare" subtitle={subtitle}
             action={data?.configured ? <LiveBadge at={data.generated_at} stale={stale} /> : undefined}>
      {body}
    </Section>
  );
}
