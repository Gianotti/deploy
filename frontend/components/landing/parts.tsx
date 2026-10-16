"use client";

// Pieces shared by /landing and /landing/<slug>

import Image from "next/image";
import Link from "next/link";
import type { ClientStatus } from "@/lib/api";
import ClientAvatar from "@/components/ClientAvatar";
import AppearanceControl from "@/components/AppearanceControl";

export const REFRESH_SECS = 60;
export const DAY_MIN = 24 * 60;

export type Status = ClientStatus["deploy_status"];

// Literal class names so Tailwind can see them. Color tokens live in globals.css.
export const STATUS: Record<Status, {
  label: string; group: string; id: string;
  text: string; fill: string; tint: string;
}> = {
  BLOQUEADO:   { label: "Bloqueado", group: "Bloqueados", id: "bloqueados", text: "text-bloq",  fill: "bg-bloq-fill text-bloq-on",   tint: "bg-bloq-tint" },
  RESTRINGIDO: { label: "Con aviso", group: "Con aviso",  id: "con-aviso",  text: "text-aviso", fill: "bg-aviso-fill text-aviso-on", tint: "bg-aviso-tint" },
  LIBRE:       { label: "Libre",     group: "Libres",     id: "libres",     text: "text-libre", fill: "bg-libre-fill text-libre-on", tint: "bg-libre-tint" },
};
export const ORDER: Status[] = ["BLOQUEADO", "RESTRINGIDO", "LIBRE"];

export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

// ── Time helpers ──────────────────────────────────────────────────────────────

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const fmtMin = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const hhmm = (s: string) => s.slice(0, 5);

export function localMinutes(timeZone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return get("hour") * 60 + get("minute");
  } catch {
    return null;
  }
}

export const n = (v: number) => v.toLocaleString("es-AR");

// ── Status glyph: shape doubles the color so status never relies on hue alone ─

export function StatusGlyph({ status, className = "w-3.5 h-3.5" }: { status: Status; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (status === "LIBRE") return <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>;
  if (status === "RESTRINGIDO") return <svg {...common}><line x1="12" y1="6" x2="12" y2="13" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;
  return <svg {...common}><line x1="6" y1="12" x2="18" y2="12" /></svg>;
}

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold shrink-0 ${s.fill}`}>
      <StatusGlyph status={status} />
      {s.label}
    </span>
  );
}

// ── Verdict sentence per client ───────────────────────────────────────────────

export function verdict(c: ClientStatus): string {
  if (c.traffic_blocked && c.user_threshold != null && c.ga4_active_users != null) {
    return `Tráfico sobre el umbral: ${n(c.ga4_active_users)} usuarios (límite ${n(c.user_threshold)})`;
  }
  if (c.deploy_status === "BLOQUEADO") return "Promo crítica en curso. No deployar hoy.";
  if (c.deploy_status === "RESTRINGIDO") {
    if (c.window_start && c.window_end) {
      const w = `${hhmm(c.window_start)} a ${hhmm(c.window_end)}`;
      return c.can_deploy_now
        ? `Dentro de la ventana hasta las ${hhmm(c.window_end)}. Avisá a comercial.`
        : `Fuera de ventana. Permitido de ${w}.`;
    }
    return "Deploy posible avisando a comercial.";
  }
  return "Podés deployar ahora.";
}

// ── Signature: the day ruler ──────────────────────────────────────────────────
// A 24 h track in the client's local time. Colored = when a deploy is allowed;
// hatched red = blocked all day; the vertical mark is "now" in that timezone.

export function DayRuler({ client, now }: { client: ClientStatus; now: Date }) {
  const status = client.deploy_status;
  const nowMin = localMinutes(client.timezone, now);
  const hasWindow = status === "RESTRINGIDO" && client.window_start && client.window_end;

  let segments: [number, number][] = [];
  if (status === "LIBRE") segments = [[0, DAY_MIN]];
  else if (hasWindow) {
    const a = toMin(client.window_start!), b = toMin(client.window_end!);
    segments = a <= b ? [[a, b]] : [[0, b], [a, DAY_MIN]];
  } else if (status === "RESTRINGIDO") segments = [[0, DAY_MIN]];

  const pct = (m: number) => `${(m / DAY_MIN) * 100}%`;
  const fill = status === "LIBRE" ? "bg-libre-fill" : "bg-aviso-fill";

  const windowText =
    status === "BLOQUEADO" ? "Sin ventana hoy"
    : status === "LIBRE" ? "Todo el día"
    : hasWindow ? `Ventana ${hhmm(client.window_start!)}–${hhmm(client.window_end!)}`
    : "Todo el día, con aviso";

  const label = `${windowText}. Hora local ${nowMin != null ? fmtMin(nowMin) : "desconocida"}.`;

  return (
    <div role="img" aria-label={label}>
      <div className="flex items-baseline justify-between text-[13px] mb-2 tabular-nums">
        <span className="text-ink-2">{windowText}</span>
        {nowMin != null && <span className="text-ink-3">Ahora {fmtMin(nowMin)}</span>}
      </div>
      <div className="relative">
        <div
          className="relative h-2.5 rounded-full overflow-hidden bg-line"
          style={status === "BLOQUEADO" ? {
            backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--bloq-fill)) 0 4px, rgb(var(--bloq-fill) / 0.35) 4px 8px)",
          } : undefined}
        >
          {segments.map(([a, b]) => (
            <div key={a} className={`absolute inset-y-0 ${fill}`} style={{ left: pct(a), width: pct(b - a) }} />
          ))}
        </div>
        {nowMin != null && (
          <div
            className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-card"
            style={{ left: pct(nowMin) }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-ink-3 tabular-nums" aria-hidden>
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}

// ── Client card ───────────────────────────────────────────────────────────────

export const pct = (v: number, digits = 0) => `${(v * 100).toLocaleString("es-AR", { maximumFractionDigits: digits })}%`;
export const ERROR_RATE_ALERT = 0.02;   // 5xx share that deserves a note on the card
export const CF_MIN_REQUESTS = 500;     // same floor the backend uses before judging ratios
export const BLOCKED_SEARCH_MIN = 50;   // a handful of blocked crawler hits is noise, not an SEO problem

// URL segment for /landing/<slug>; the numeric id also resolves
export function clientSlug(c: { client_id: number; client_name: string }): string {
  const s = c.client_name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || String(c.client_id);
}

export function ClientLogo({ client, size = 40 }: { client: ClientStatus; size?: number }) {
  return client.has_logo ? (
    <div className="rounded-lg overflow-hidden shrink-0 bg-canvas border border-line" style={{ width: size, height: size }}>
      <Image src={`/api/clients/${client.client_id}/logo`} alt="" width={size} height={size} className="object-contain w-full h-full" unoptimized />
    </div>
  ) : (
    <ClientAvatar name={client.client_name} />
  );
}

export const promoText = (c: ClientStatus) =>
  c.active_promo_count > 0 ? ` · ${c.active_promo_count} promo${c.active_promo_count > 1 ? "s" : ""} activa${c.active_promo_count > 1 ? "s" : ""}` : "";

// Compact and identical for every client: the whole card links to its detail page
export function ClientCard({ client, now }: { client: ClientStatus; now: Date }) {
  const users = client.ga4_active_users;
  const cf = client.cloudflare;
  const rpm = cf ? lastPoint(cf.series) ?? Math.round(cf.requests / cf.window_minutes) : null;

  return (
    <article id={`cliente-${client.client_id}`} className="group relative rounded-2xl border border-line bg-card p-5 flex flex-col gap-4 scroll-mt-6 transition-colors hover:border-ink-3 motion-reduce:transition-none">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ClientLogo client={client} />
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
              <Link
                href={`/landing/${clientSlug(client)}`}
                className="rounded after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink"
              >
                {client.client_name}
              </Link>
            </h3>
            <p className="text-[13px] text-ink-3 mt-0.5">{client.country_name}{promoText(client)}</p>
          </div>
        </div>
        <StatusPill status={client.deploy_status} />
      </header>

      <p className="text-[15px] leading-snug text-ink">{verdict(client)}</p>

      <DayRuler client={client} now={now} />

      <dl className="grid grid-cols-2 gap-x-4 border-t border-line pt-3">
        <div>
          <dt className="text-[13px] text-ink-3">Usuarios ahora</dt>
          <dd className="tabular-nums">
            <span className={`text-[17px] font-semibold ${client.traffic_blocked ? "text-bloq" : "text-ink"}`}>{users != null ? n(users) : "—"}</span>
            {client.user_threshold != null && <span className="text-[13px] text-ink-3"> / {n(client.user_threshold)}</span>}
          </dd>
        </div>
        {rpm != null && (
          <div>
            <dt className="text-[13px] text-ink-3">Requests por minuto</dt>
            <dd className="flex items-center gap-2">
              <span className="text-[17px] font-semibold text-ink tabular-nums">{n(rpm)}</span>
              {cf!.series && cf!.series.length > 1 && <Sparkline points={cf!.series} className="h-6 flex-1 min-w-0" />}
            </dd>
          </div>
        )}
      </dl>

      <Signals client={client} />

      <p className="mt-auto flex items-center gap-1 text-[13px] font-medium text-ink-2 group-hover:text-ink" aria-hidden>
        Ver detalle
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
      </p>
    </article>
  );
}

export const lastPoint = (s?: { requests: number }[]) => (s && s.length ? s[s.length - 1].requests : null);
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s` : `${ms} ms`);

export function hasGa4(c: ClientStatus): boolean {
  return (c.ga4_active_users ?? 0) > 0 || (c.ga4_top_pages ?? []).length > 0;
}

// ── Sparkline: requests per minute. Decorative next to a number, so the SVG itself is hidden from AT ─

export function Sparkline({ points, className = "" }: { points: { requests: number }[]; className?: string }) {
  const W = 100, H = 24;
  const max = Math.max(...points.map((p) => p.requests), 1);
  const step = W / Math.max(points.length - 1, 1);
  const xy = points.map((p, i) => `${(i * step).toFixed(2)},${(H - (p.requests / max) * (H - 2) - 1).toFixed(2)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`text-ink-2 ${className}`} aria-hidden>
      <polygon points={`0,${H} ${xy.join(" ")} ${W},${H}`} className="fill-current opacity-10" />
      <polyline points={xy.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function RequestsChart({ series }: { series: { t: string; requests: number }[] }) {
  const values = series.map((p) => p.requests);
  const max = Math.max(...values), min = Math.min(...values);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return (
    <figure>
      <Sparkline points={series} className="h-20 w-full" />
      <div className="mt-1 flex justify-between text-xs text-ink-3 tabular-nums">
        <span>{time(series[0].t)}</span><span>{time(series[series.length - 1].t)}</span>
      </div>
      <figcaption className="mt-1 text-xs text-ink-3">
        Última hora: entre <span className="tabular-nums text-ink-2">{n(min)}</span> y <span className="tabular-nums text-ink-2">{n(max)}</span> requests por minuto,
        ahora <span className="tabular-nums text-ink-2">{n(values[values.length - 1])}</span>.
      </figcaption>
    </figure>
  );
}

// ── Notes: one line each on the card, explained on the detail page ─

export function BotIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="8" width="16" height="12" rx="3" /><line x1="12" y1="4" x2="12" y2="8" /><circle cx="12" cy="3" r="1" />
      <line x1="9" y1="13" x2="9" y2="14" /><line x1="15" y1="13" x2="15" y2="14" /><line x1="2" y1="13" x2="2" y2="16" /><line x1="22" y1="13" x2="22" y2="16" />
    </svg>
  );
}

export function AlertIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function ShieldIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function Note({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div role="note" className="rounded-xl border border-dashed border-aviso bg-aviso-tint px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-aviso">{icon}{title}</p>
      {children && <div className="mt-1 pl-6 text-[13px] text-ink-2">{children}</div>}
    </div>
  );
}

export function noteData(client: ClientStatus) {
  const cf = client.cloudflare;
  const bot = client.bot_suspicion && client.bot_suspicion.level !== "none" ? client.bot_suspicion : null;
  return {
    errors: cf?.health && cf.requests >= CF_MIN_REQUESTS && cf.health.error_rate >= ERROR_RATE_ALERT ? cf.health : null,
    bot,
    blockedSearch: (cf?.firewall?.blocked_search ?? []).filter((b) => b.requests >= BLOCKED_SEARCH_MIN),
  };
}

export const botTitle = (level: string) => (level === "likely" ? "Probable tráfico de bots" : "Posible tráfico de bots");

// One line per signal on the card; the detail page explains each one
export function Signals({ client }: { client: ClientStatus }) {
  const { errors, bot, blockedSearch } = noteData(client);
  const items = [
    errors && { key: "5xx", icon: <AlertIcon />, text: `${pct(errors.error_rate, 1)} de errores 5xx` },
    bot && { key: "bot", icon: <BotIcon />, text: botTitle(bot.level) },
    blockedSearch.length > 0 && { key: "fw", icon: <ShieldIcon />, text: `El firewall frena a ${blockedSearch.map((b) => b.label).join(" y ")}` },
  ].filter(Boolean) as { key: string; icon: React.ReactNode; text: string }[];
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-[13px] font-medium text-aviso">
          <span className="mt-px shrink-0">{s.icon}</span>{s.text}
        </li>
      ))}
    </ul>
  );
}

export function ClientNotes({ client }: { client: ClientStatus }) {
  const { errors, bot, blockedSearch } = noteData(client);
  const cf = client.cloudflare;
  if (!errors && !bot && !blockedSearch.length) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-2 items-start">
      {errors && (
        <Note icon={<AlertIcon />} title={`${pct(errors.error_rate, 1)} de errores 5xx`}>
          {n(errors.status["5xx"])} requests fallaron en los últimos {cf!.window_minutes} min. Si deployás ahora, revisá primero si ya hay un problema.
        </Note>
      )}
      {bot && (
        <Note icon={<BotIcon />} title={botTitle(bot.level)}>
          <ul className="space-y-0.5 list-disc pl-4 -ml-4 marker:text-ink-3">
            {bot.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          {client.traffic_blocked && <p className="mt-1">El bloqueo por umbral puede deberse a bots. Revisalo antes de esperar.</p>}
        </Note>
      )}
      {blockedSearch.length > 0 && (
        <Note icon={<ShieldIcon />} title="El firewall frena buscadores">
          {blockedSearch.map((b) => `${b.label} (${n(b.requests)})`).join(", ")}. Puede afectar el posicionamiento en buscadores.
        </Note>
      )}
    </div>
  );
}

// ── Detail panels ──────────────────────────────────────────────────────────────

export const CF_KIND_LABEL: Record<string, string> = {
  ai_crawler: "Crawler IA", search: "Buscador", script: "Script", datacenter: "Datacenter", bot: "Bot",
};

export const FW_ACTION_LABEL: Record<string, string> = {
  block: "Bloqueadas", managed_challenge: "Desafío", challenge: "Desafío", js_challenge: "Desafío JS",
  jschallenge: "Desafío JS", link_maze_injected: "Laberinto IA", log: "Solo registro", skip: "Omitidas", allow: "Permitidas",
};

export const NOISE_EVENTS = new Set(["page_view", "session_start", "scroll", "user_engagement", "first_visit", "first_open", "click", "gtm.dom", "gtm.load", "gtm.historyChange"]);

export const EVENT_LABEL: Record<string, string> = {
  purchase: "Compra", add_to_cart: "Agregar al carrito", begin_checkout: "Inicio checkout",
  checkout_start: "Inicio checkout", add_payment_info: "Pago", add_shipping_info: "Envío",
  login: "Login", sign_up: "Registro",
};

export const SOURCE_LABEL: Record<string, string> = { paid: "Pago", organic: "Orgánico", direct: "Directo", other: "Otros" };

export function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-1 text-xs text-ink-2">
      {label}
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </span>
  );
}

export function DetailSection({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
        {aside && <span className="text-xs text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-3 mb-1.5">{title}</p>
      {children}
    </div>
  );
}

// Country.iso_code is alpha-3; GA4 countryId is alpha-2
export const ISO2: Record<string, string> = {
  ARG: "AR", MEX: "MX", COL: "CO", CHL: "CL", PER: "PE", URY: "UY", PRY: "PY",
  BOL: "BO", ECU: "EC", BRA: "BR", VEN: "VE", USA: "US", ESP: "ES", PAN: "PA",
};

export function StatusBreakdown({ status, total }: { status: { "2xx": number; "3xx": number; "4xx": number; "5xx": number }; total: number }) {
  // Shades of one neutral plus labels: color is reserved for deploy status
  const rows = [
    { k: "2xx", label: "OK" }, { k: "3xx", label: "Redirección" },
    { k: "4xx", label: "Error del cliente / bloqueo" }, { k: "5xx", label: "Error del servidor" },
  ] as const;
  return (
    <ul className="space-y-1">
      {rows.map(({ k, label }) => {
        const v = status[k];
        const share = total ? v / total : 0;
        return (
          <li key={k} className="grid grid-cols-[3rem_1fr_auto] items-center gap-2 text-xs">
            <span className="font-mono text-ink-2">{k}</span>
            <span className="relative h-1.5 rounded-full bg-canvas" title={label}>
              <span className={`absolute inset-y-0 left-0 rounded-full ${k === "5xx" ? "bg-bloq" : "bg-ink-3"}`} style={{ width: `${Math.max(share * 100, v ? 1 : 0)}%` }} />
            </span>
            <span className="tabular-nums text-ink-2">{n(v)} <span className="text-ink-3">· {pct(share, 1)}</span></span>
          </li>
        );
      })}
    </ul>
  );
}

export function PathList({ paths }: { paths: { path: string; requests: number }[] }) {
  return (
    <ul className="space-y-0.5">
      {paths.map((p) => (
        <li key={p.path} className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="font-mono text-ink-2 truncate" title={p.path}>{p.path}</span>
          <span className="shrink-0 tabular-nums text-ink-3">{n(p.requests)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BotList({ bots }: { bots: NonNullable<ClientStatus["cloudflare"]>["top_bots"] }) {
  return (
    <ul className="divide-y divide-line">
      {bots.map((b) => (
        <li key={b.label} className="py-2.5 first:pt-0 last:pb-0 space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              <span className="text-[13px] font-medium text-ink">{b.label}</span>
              <span className="text-ink-3"> · {CF_KIND_LABEL[b.kind] ?? b.kind} · {b.ips} {b.ips === 1 ? "IP" : "IPs"}</span>
            </span>
            <span className="shrink-0 font-semibold text-ink tabular-nums">{n(b.requests)} req</span>
          </div>
          {(b.ip_list ?? []).length > 0 && (
            <ul className="space-y-0.5 border-l border-line pl-2">
              {b.ip_list!.map((ip) => (
                <li key={ip.ip} className="flex items-baseline justify-between gap-3 text-[11px] text-ink-3">
                  <span className="min-w-0 truncate" title={ip.asn ?? undefined}>
                    <span className="font-mono text-ink-2 select-all">{ip.ip}</span>
                    {ip.country && ` · ${ip.country}`}{ip.asn && ` · ${ip.asn}`}
                  </span>
                  <span className="shrink-0 tabular-nums">{n(ip.requests)}</span>
                </li>
              ))}
            </ul>
          )}
          {(b.paths ?? []).length > 0 && (
            <div className="pl-2">
              <p className="text-[11px] text-ink-3 mb-0.5">Páginas que pide</p>
              <PathList paths={b.paths!} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CloudflareDetail({ cf }: { cf: NonNullable<ClientStatus["cloudflare"]> }) {
  const h = cf.health;
  const fw = cf.firewall;
  return (
    <>
      <DetailSection title="Salud del sitio" aside={`Cloudflare · ${cf.host} · últimos ${cf.window_minutes} min`}>
        <div className="flex flex-wrap gap-1.5">
          <Chip label="Requests" value={n(cf.requests)} />
          {h && <Chip label="Errores 5xx" value={pct(h.error_rate, 1)} />}
          {h?.origin_ms != null && <Chip label="Respuesta del origen" value={fmtMs(h.origin_ms)} />}
          {h && <Chip label="Servido desde caché" value={pct(h.cached_share)} />}
        </div>
        {h && <StatusBreakdown status={h.status} total={cf.requests} />}
        {cf.series && cf.series.length > 1 && (
          <DetailGroup title="Requests por minuto">
            <RequestsChart series={cf.series} />
          </DetailGroup>
        )}
      </DetailSection>

      <DetailSection title="Bots" aside={`${pct(cf.bot_share)} de las requests`}>
        {cf.top_bots.length ? <BotList bots={cf.top_bots} /> : <p className="text-[13px] text-ink-3">No se detectaron bots en los grupos con más tráfico.</p>}
      </DetailSection>

      <DetailSection title="Firewall" aside={fw ? `${n(fw.events)} eventos` : undefined}>
        {!fw ? (
          <p className="text-[13px] text-ink-3">El plan de Cloudflare de este dominio no incluye los eventos del firewall.</p>
        ) : fw.events === 0 ? (
          <p className="text-[13px] text-ink-3">El firewall no actuó en los últimos {cf.window_minutes} min.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(fw.by_action).map(([a, v]) => <Chip key={a} label={FW_ACTION_LABEL[a] ?? a} value={n(v)} />)}
            </div>
            {fw.blocked_search.length > 0 && (
              <p className="text-[13px] text-aviso">
                Está frenando a {fw.blocked_search.map((b) => b.label).join(" y ")}. Si no es a propósito, conviene excluir los bots verificados de esa regla.
              </p>
            )}
            {fw.top_ips.length > 0 && (
              <DetailGroup title="Bots frenados">
                <ul className="space-y-1">
                  {fw.top_ips.map((e) => (
                    <li key={`${e.ip}-${e.action}`} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-ink-2 select-all">{e.ip}</span>
                          <span className="text-ink-3"> · {e.label}{e.country && ` · ${e.country}`}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-ink">{n(e.requests)}</span>
                      </div>
                      <p className="text-[11px] text-ink-3 truncate">{FW_ACTION_LABEL[e.action] ?? e.action}{e.rule && ` · ${e.rule}`}</p>
                    </li>
                  ))}
                </ul>
              </DetailGroup>
            )}
          </>
        )}
      </DetailSection>
    </>
  );
}

export function Ga4Detail({ client }: { client: ClientStatus }) {
  const src = Object.entries(client.ga4_traffic_sources ?? {}).filter(([, v]) => v > 0);
  const events = (client.ga4_top_events ?? []).filter((e) => !NOISE_EVENTS.has(e.event));
  const pages = client.ga4_top_pages ?? [];
  // Top 6, plus every foreign row: the bot alert counts them, so they must be visible here
  const home = ISO2[client.country_iso?.toUpperCase()] ?? client.country_iso?.toUpperCase();
  const isForeign = (l: { country_id: string }) => !!home && l.country_id !== home && l.country_id !== "(NOT SET)";
  const locations = (client.ga4_top_locations ?? []).filter((l, i) => i < 6 || isForeign(l));

  const dev = client.ga4_device_breakdown ?? {};
  const devTotal = (dev.mobile ?? 0) + (dev.tablet ?? 0) + (dev.desktop ?? 0);
  const mobilePct = devTotal > 0 ? Math.round(((dev.mobile ?? 0) + (dev.tablet ?? 0)) / devTotal * 100) : null;
  const cr = client.ga4_active_users ? Math.round((client.ga4_conversions / client.ga4_active_users) * 1000) / 10 : null;
  const nvr = client.ga4_new_vs_returning ?? {};
  const hasNvr = (nvr.new ?? 0) + (nvr.returning ?? 0) > 0;
  const hasAudience = mobilePct !== null || cr !== null || hasNvr;

  if (!src.length && !events.length && !pages.length && !locations.length && !hasAudience) return null;

  return (
    <DetailSection title="Usuarios" aside="Google Analytics · tiempo real">
      <div className="space-y-3">
        {src.length > 0 && (
          <DetailGroup title="Fuentes">
            <div className="flex flex-wrap gap-1.5">{src.map(([k, v]) => <Chip key={k} label={SOURCE_LABEL[k] ?? k} value={v} />)}</div>
          </DetailGroup>
        )}
        {events.length > 0 && (
          <DetailGroup title="Actividad">
            <div className="flex flex-wrap gap-1.5">
              {events.map((e) => <Chip key={e.event} label={EVENT_LABEL[e.event] ?? e.event.replace(/_/g, " ")} value={e.count} />)}
            </div>
          </DetailGroup>
        )}
        {hasAudience && (
          <DetailGroup title="Audiencia">
            <div className="flex flex-wrap gap-1.5">
              {mobilePct !== null && <Chip label="Mobile" value={`${mobilePct}%`} />}
              {mobilePct !== null && <Chip label="Desktop" value={`${100 - mobilePct}%`} />}
              {cr !== null && <Chip label="Conversión" value={`${cr}%`} />}
              {hasNvr && <Chip label="Nuevos" value={nvr.new ?? 0} />}
              {hasNvr && <Chip label="Recurrentes" value={nvr.returning ?? 0} />}
            </div>
          </DetailGroup>
        )}
        {locations.length > 0 && (
          <DetailGroup title="Ubicaciones">
            <div className="flex flex-wrap gap-1.5">
              {locations.map((l) => (
                <Chip key={`${l.country_id}-${l.city}`} label={`${l.city === "(not set)" ? "Sin ciudad" : l.city} · ${l.country_id === "(NOT SET)" ? "Sin país" : l.country_id}`} value={l.users} />
              ))}
            </div>
          </DetailGroup>
        )}
        {pages.length > 0 && (
          <DetailGroup title="Páginas con más usuarios ahora">
            <ul className="space-y-1">
              {pages.map((p) => (
                <li key={p.path} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-mono text-ink-2 truncate">{p.path}</span>
                  <span className="font-semibold text-ink tabular-nums shrink-0">{p.users}</span>
                </li>
              ))}
            </ul>
          </DetailGroup>
        )}
      </div>
    </DetailSection>
  );
}

// ── Client detail page (/landing/<slug>) ──────────────────────────────────────

export function DetailStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[20px] font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

export function ClientDetail({ client, now }: { client: ClientStatus; now: Date }) {
  const users = client.ga4_active_users;
  const cf = client.cloudflare;
  const h = cf?.health;
  const rpm = cf ? lastPoint(cf.series) ?? Math.round(cf.requests / cf.window_minutes) : null;
  const ga4 = <Ga4Detail client={client} />;

  return (
    <div className="space-y-8">
      <section aria-labelledby="cliente-titulo" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <ClientLogo client={client} size={48} />
            <div className="min-w-0">
              <h1 id="cliente-titulo" className="text-[28px] sm:text-[34px] font-bold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">{client.client_name}</h1>
              <p className="text-[15px] text-ink-3">{client.country_name}{promoText(client)}</p>
            </div>
          </div>
          <StatusPill status={client.deploy_status} />
        </div>

        <div className="rounded-2xl border border-line bg-card p-5 space-y-4">
          <p className="text-[20px] font-semibold leading-snug text-ink">{verdict(client)}</p>
          <DayRuler client={client} now={now} />
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 border-t border-line pt-4">
            <DetailStat label="Usuarios ahora">
              <span className={client.traffic_blocked ? "text-bloq" : undefined}>{users != null ? n(users) : "—"}</span>
              {client.user_threshold != null && <span className="text-[15px] font-normal text-ink-3"> / {n(client.user_threshold)}</span>}
            </DetailStat>
            {rpm != null && <DetailStat label="Requests por minuto">{n(rpm)}</DetailStat>}
            {cf && <DetailStat label="Bots">{pct(cf.bot_share)}</DetailStat>}
            {h && <DetailStat label="Errores 5xx"><span className={h.error_rate >= ERROR_RATE_ALERT && cf!.requests >= CF_MIN_REQUESTS ? "text-aviso" : undefined}>{pct(h.error_rate, 1)}</span></DetailStat>}
            {h?.origin_ms != null && <DetailStat label="Respuesta del origen">{fmtMs(h.origin_ms)}</DetailStat>}
            {h && <DetailStat label="Desde caché">{pct(h.cached_share)}</DetailStat>}
          </dl>
        </div>
      </section>

      <ClientNotes client={client} />

      {!cf && !hasGa4(client) ? (
        <p className="rounded-2xl border border-line bg-card p-5 text-[15px] text-ink-2">
          Este cliente no tiene Google Analytics ni Cloudflare configurados, así que no hay tráfico en vivo para mostrar.
        </p>
      ) : (
        // Panels have very different heights: columns pack them without gaps
        <div className="columns-1 lg:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {cf && <CloudflareDetail cf={cf} />}
          {ga4}
        </div>
      )}
    </div>
  );
}

// ── Top bar shared by /landing and the client pages ───────────────────────────

export function LandingHeader({ updatedAt, countdown, onRefresh }: { updatedAt: string; countdown: number; onRefresh: () => void }) {
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/landing" className={`flex items-center gap-2.5 rounded-md ${FOCUS}`}>
          <svg className="w-6 h-6 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 2L21 12H17V20H7V12H3Z" />
          </svg>
          <span className="text-[17px] font-semibold text-ink">Deploy Status</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {updatedAt && (
            <p className="hidden sm:block text-[13px] text-ink-3 tabular-nums">
              Actualizado {updatedAt}<span aria-hidden> · próxima en {countdown} s</span>
            </p>
          )}
          <AppearanceControl />
          <button
            onClick={onRefresh}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-canvas hover:text-ink ${FOCUS}`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
            <span className="sr-only sm:not-sr-only">Actualizar</span>
          </button>
        </div>
      </div>
    </header>
  );
}
