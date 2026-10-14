"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { getPublicStatus, getPublicTeams, type ClientStatus, type PublicTeam } from "@/lib/api";
import PublicMonthCalendar from "@/components/PublicMonthCalendar";
import ClientAvatar from "@/components/ClientAvatar";

const REFRESH_SECS = 60;
const DAY_MIN = 24 * 60;

type Status = ClientStatus["deploy_status"];

// Literal class names so Tailwind can see them. Color tokens live in globals.css.
const STATUS: Record<Status, {
  label: string; group: string; id: string;
  text: string; fill: string; tint: string;
}> = {
  BLOQUEADO:   { label: "Bloqueado", group: "Bloqueados", id: "bloqueados", text: "text-bloq",  fill: "bg-bloq-fill text-bloq-on",   tint: "bg-bloq-tint" },
  RESTRINGIDO: { label: "Con aviso", group: "Con aviso",  id: "con-aviso",  text: "text-aviso", fill: "bg-aviso-fill text-aviso-on", tint: "bg-aviso-tint" },
  LIBRE:       { label: "Libre",     group: "Libres",     id: "libres",     text: "text-libre", fill: "bg-libre-fill text-libre-on", tint: "bg-libre-tint" },
};
const ORDER: Status[] = ["BLOQUEADO", "RESTRINGIDO", "LIBRE"];

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

// ── Time helpers ──────────────────────────────────────────────────────────────

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fmtMin = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const hhmm = (s: string) => s.slice(0, 5);

function localMinutes(timeZone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return get("hour") * 60 + get("minute");
  } catch {
    return null;
  }
}

const n = (v: number) => v.toLocaleString("es-AR");

// ── Status glyph: shape doubles the color so status never relies on hue alone ─

function StatusGlyph({ status, className = "w-3.5 h-3.5" }: { status: Status; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (status === "LIBRE") return <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>;
  if (status === "RESTRINGIDO") return <svg {...common}><line x1="12" y1="6" x2="12" y2="13" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;
  return <svg {...common}><line x1="6" y1="12" x2="18" y2="12" /></svg>;
}

function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold shrink-0 ${s.fill}`}>
      <StatusGlyph status={status} />
      {s.label}
    </span>
  );
}

// ── Verdict sentence per client ───────────────────────────────────────────────

function verdict(c: ClientStatus): string {
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

function DayRuler({ client, now }: { client: ClientStatus; now: Date }) {
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

function ClientCard({ client, now }: { client: ClientStatus; now: Date }) {
  const users = client.ga4_active_users;

  return (
    <article id={`cliente-${client.client_id}`} className="rounded-2xl border border-line bg-card p-5 flex flex-col gap-4 scroll-mt-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {client.has_logo ? (
            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-canvas border border-line">
              <Image src={`/api/clients/${client.client_id}/logo`} alt="" width={40} height={40} className="object-contain w-full h-full" unoptimized />
            </div>
          ) : (
            <ClientAvatar name={client.client_name} />
          )}
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold leading-tight text-ink [overflow-wrap:anywhere]">{client.client_name}</h3>
            <p className="text-[13px] text-ink-3 mt-0.5">
              {client.country_name}
              {client.active_promo_count > 0 && ` · ${client.active_promo_count} promo${client.active_promo_count > 1 ? "s" : ""} activa${client.active_promo_count > 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <StatusPill status={client.deploy_status} />
      </header>

      <p className="text-[15px] leading-snug text-ink">{verdict(client)}</p>

      <DayRuler client={client} now={now} />

      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[13px] text-ink-3">Usuarios ahora</span>
        <span className="tabular-nums">
          <span className={`text-[17px] font-semibold ${client.traffic_blocked ? "text-bloq" : "text-ink"}`}>
            {users != null ? n(users) : "—"}
          </span>
          {client.user_threshold != null && (
            <span className="text-[13px] text-ink-3"> / {n(client.user_threshold)}</span>
          )}
        </span>
      </div>

      <BotAlert client={client} />

      <TrafficDetails client={client} />
    </article>
  );
}

// ── Suspected bot traffic: heuristics from GA4 realtime (see backend bot_detection.py) ─

function BotIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="8" width="16" height="12" rx="3" /><line x1="12" y1="4" x2="12" y2="8" /><circle cx="12" cy="3" r="1" />
      <line x1="9" y1="13" x2="9" y2="14" /><line x1="15" y1="13" x2="15" y2="14" /><line x1="2" y1="13" x2="2" y2="16" /><line x1="22" y1="13" x2="22" y2="16" />
    </svg>
  );
}

function BotAlert({ client }: { client: ClientStatus }) {
  const bot = client.bot_suspicion;
  if (!bot || bot.level === "none") return null;
  const likely = bot.level === "likely";

  return (
    <div role="note" className="rounded-xl border border-dashed border-aviso bg-aviso-tint px-3.5 py-3">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-aviso">
        <BotIcon />
        {likely ? "Probable tráfico de bots" : "Posible tráfico de bots"}
      </p>
      <ul className="mt-1.5 space-y-0.5 pl-6 text-[13px] text-ink-2 list-disc">
        {bot.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      {client.traffic_blocked && (
        <p className="mt-2 pl-6 text-[13px] text-ink-2">
          El bloqueo por umbral puede deberse a bots. Revisalo antes de esperar.
        </p>
      )}
    </div>
  );
}

// ── Live traffic: progressive disclosure, neutral chips (color is reserved for status) ─

const NOISE_EVENTS = new Set(["page_view", "session_start", "scroll", "user_engagement", "first_visit", "first_open", "click", "gtm.dom", "gtm.load", "gtm.historyChange"]);

const EVENT_LABEL: Record<string, string> = {
  purchase: "Compra", add_to_cart: "Agregar al carrito", begin_checkout: "Inicio checkout",
  checkout_start: "Inicio checkout", add_payment_info: "Pago", add_shipping_info: "Envío",
  login: "Login", sign_up: "Registro",
};

const SOURCE_LABEL: Record<string, string> = { paid: "Pago", organic: "Orgánico", direct: "Directo", other: "Otros" };

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-1 text-xs text-ink-2">
      {label}
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </span>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-3 mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function TrafficDetails({ client }: { client: ClientStatus }) {
  const src = Object.entries(client.ga4_traffic_sources ?? {}).filter(([, v]) => v > 0);
  const events = (client.ga4_top_events ?? []).filter((e) => !NOISE_EVENTS.has(e.event));
  const pages = client.ga4_top_pages ?? [];
  const locations = (client.ga4_top_locations ?? []).slice(0, 6);

  const dev = client.ga4_device_breakdown ?? {};
  const devTotal = (dev.mobile ?? 0) + (dev.tablet ?? 0) + (dev.desktop ?? 0);
  const mobilePct = devTotal > 0 ? Math.round(((dev.mobile ?? 0) + (dev.tablet ?? 0)) / devTotal * 100) : null;
  const cr = client.ga4_active_users ? Math.round((client.ga4_conversions / client.ga4_active_users) * 1000) / 10 : null;
  const nvr = client.ga4_new_vs_returning ?? {};
  const hasNvr = (nvr.new ?? 0) + (nvr.returning ?? 0) > 0;
  const hasAudience = mobilePct !== null || cr !== null || hasNvr;

  if (!src.length && !events.length && !pages.length && !locations.length && !hasAudience) return null;

  return (
    <details className="group -mx-1">
      <summary className={`flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 text-[13px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 6 15 12 9 18" /></svg>
        Tráfico en vivo
      </summary>
      <div className="mt-3 space-y-3 px-1">
        {src.length > 0 && (
          <DetailGroup title="Fuentes">
            <div className="flex flex-wrap gap-1.5">
              {src.map(([k, v]) => <Chip key={k} label={SOURCE_LABEL[k] ?? k} value={v} />)}
            </div>
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
                <Chip key={`${l.country_id}-${l.city}`} label={`${l.city === "(not set)" ? "Sin ciudad" : l.city} · ${l.country_id}`} value={l.users} />
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
    </details>
  );
}

// ── Verdict header: answers the page's one question ───────────────────────────

function Verdict({ clients, eco }: {
  clients: ClientStatus[];
  eco: { total: number; peak: number; mobilePct: number; cr: number };
}) {
  const total = clients.length;
  const canNow = clients.filter((c) => c.can_deploy_now).length;
  const counts = ORDER.map((s) => [s, clients.filter((c) => c.deploy_status === s).length] as const);

  const headline =
    canNow === total ? "Se puede deployar ahora en todos los clientes."
    : canNow === 0 ? "Ahora no se puede deployar en ningún cliente."
    : <>Se puede deployar ahora en <span className="tabular-nums">{canNow}</span> de <span className="tabular-nums">{total}</span> clientes.</>;

  const hasEco = eco.total > 0 || eco.peak > 0;
  const suspicious = clients.filter((c) => c.bot_suspicion && c.bot_suspicion.level !== "none");

  return (
    <section aria-labelledby="verdict" className="space-y-5">
      <div>
        <h2 id="verdict" className="text-[28px] sm:text-[36px] font-bold leading-[1.15] tracking-tight text-ink max-w-3xl">
          {headline}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {counts.filter(([, c]) => c > 0).map(([s, c]) => (
            <li key={s}>
              <a href={`#${STATUS[s].id}`} className={`inline-flex items-center gap-2 rounded-md text-[15px] font-medium text-ink-2 hover:text-ink ${FOCUS}`}>
                <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full ${STATUS[s].fill}`}>
                  <StatusGlyph status={s} className="w-3 h-3" />
                </span>
                <span className="tabular-nums">{c}</span> {c === 1 ? STATUS[s].label.toLowerCase() : STATUS[s].group.toLowerCase()}
              </a>
            </li>
          ))}
        </ul>
        {suspicious.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-ink-2">
            <span className="inline-flex items-center gap-1.5 font-medium text-aviso"><BotIcon />Tráfico sospechoso de bots en</span>
            {suspicious.map((c, i) => (
              <span key={c.client_id}>
                <a href={`#cliente-${c.client_id}`} className={`font-medium text-ink underline underline-offset-2 rounded ${FOCUS}`}>{c.client_name}</a>
                {i < suspicious.length - 1 && ","}
              </span>
            ))}
          </p>
        )}
      </div>

      {hasEco && (
        <div className="rounded-2xl border border-line bg-card px-5 py-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-ink-3 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ink-3" />
            </span>
            Ecosistema Avenida+ · {total} clientes
          </p>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
            <Stat label="Usuarios en vivo" value={n(eco.total)} />
            <Stat label="Pico de hoy" value={n(eco.peak)} />
            {eco.mobilePct > 0 && <Stat label="Mobile" value={`${eco.mobilePct}%`} />}
            {eco.cr > 0 && <Stat label="Conversión" value={`${eco.cr}%`} />}
          </dl>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="text-[22px] font-semibold text-ink tabular-nums leading-tight">{value}</dd>
    </div>
  );
}

// ── Weekly deploy intentions ──────────────────────────────────────────────────

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function WeeklyCalendar({ teams }: { teams: PublicTeam[] }) {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const hasAnyTeam = teams.some((t) => t.deploy_days.length > 0);

  return (
    <section aria-labelledby="week" className="rounded-2xl border border-line bg-card p-5 sm:p-6 space-y-4">
      <h2 id="week" className="text-[17px] font-semibold text-ink">Equipos que deployan esta semana</h2>

      <ol className="grid grid-cols-1 sm:grid-cols-7 gap-2">
        {days.map((day, i) => {
          const isToday = day.toDateString() === today.toDateString();
          const deploying = teams.filter((t) => t.deploy_days.includes(i));

          return (
            <li
              key={i}
              aria-current={isToday ? "date" : undefined}
              className={`flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-2 rounded-xl border p-3 sm:min-h-[96px]
                ${isToday ? "border-ink ring-1 ring-ink" : "border-line"}`}
            >
              <div className="w-16 sm:w-auto shrink-0 sm:text-center">
                <p className={`text-xs font-medium ${isToday ? "text-ink" : "text-ink-3"}`}>
                  {DAY_NAMES[i]}{isToday && " · Hoy"}
                </p>
                <p className="text-[17px] font-semibold text-ink tabular-nums leading-tight">{day.getDate()}</p>
              </div>
              <div className="flex flex-wrap sm:flex-col gap-1 sm:mt-auto min-w-0">
                {deploying.length === 0 ? (
                  <span className="text-xs text-ink-3 sm:text-center">
                    <span aria-hidden>—</span><span className="sr-only">Sin deploys</span>
                  </span>
                ) : deploying.map((t) => (
                  <span key={t.id} className="rounded-md bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink-2 truncate sm:text-center">
                    {t.name}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      {!hasAnyTeam && (
        <p className="text-[13px] text-ink-3">
          Ningún equipo tiene días de deploy configurados. Se configuran en Admin → Equipos.
        </p>
      )}
    </section>
  );
}

// ── How it works (disclosed on demand) ────────────────────────────────────────

const STEPS = [
  { title: "Comercial carga la promo", desc: "Las fechas de campañas, descuentos o eventos que van a generar tráfico alto." },
  { title: "El sistema evalúa el día", desc: "Analiza qué promociones están activas hoy y qué tan críticas son." },
  { title: "Se define el estado", desc: "Según las reglas, cada cliente queda libre, con aviso o bloqueado." },
  { title: "Desarrollo decide", desc: "Antes de cada deploy, el equipo revisa esta página para avanzar, avisar o esperar." },
];

const OUTCOMES: { status: Status; title: string; bullets: string[] }[] = [
  { status: "LIBRE", title: "Sin promociones activas", bullets: ["Podés deployar en cualquier momento.", "No hace falta avisar a nadie."] },
  { status: "RESTRINGIDO", title: "Hay una promo de baja criticidad", bullets: ["Avisá a comercial antes de deployar.", "Respetá la ventana horaria si la hay.", "Un incidente en producción afecta la campaña."] },
  { status: "BLOQUEADO", title: "Promo crítica o tráfico sobre el umbral", bullets: ["Un deploy puede interrumpir comunicaciones o pagos.", "Esperá a que termine la promoción.", "Ante una urgencia, coordiná con comercial y legales."] },
];

function HowItWorks() {
  return (
    <details className="group rounded-2xl border border-line bg-card">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-5 sm:p-6 text-[17px] font-semibold text-ink [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        ¿Cómo funciona el semáforo?
        <svg className="w-4 h-4 text-ink-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
      </summary>
      <div className="px-5 sm:px-6 pb-6 space-y-8">
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-[13px] font-semibold text-ink-2 tabular-nums">{i + 1}</span>
              <div>
                <p className="text-[15px] font-semibold text-ink">{step.title}</p>
                <p className="text-[13px] text-ink-2 mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {OUTCOMES.map((o) => (
            <div key={o.status} className={`rounded-xl p-5 space-y-3 ${STATUS[o.status].tint}`}>
              <div className="flex items-center gap-2">
                <StatusPill status={o.status} />
              </div>
              <p className="text-[15px] font-semibold text-ink">{o.title}</p>
              <ul className="space-y-1.5 list-disc pl-4 text-[14px] text-ink-2">
                {o.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-[13px] text-ink-3">
          La página se actualiza cada minuto. El estado refleja el día de hoy en la zona horaria de cada cliente.
        </p>
      </div>
    </details>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div role="status" className="space-y-8">
      <span className="sr-only">Cargando estado…</span>
      <div className="h-10 w-2/3 max-w-xl rounded-lg bg-line motion-safe:animate-pulse" />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-card p-5 space-y-4">
            <div className="flex gap-3"><div className="h-10 w-10 rounded-lg bg-line motion-safe:animate-pulse" /><div className="h-5 flex-1 rounded bg-line motion-safe:animate-pulse" /></div>
            <div className="h-4 w-4/5 rounded bg-line motion-safe:animate-pulse" />
            <div className="h-2.5 rounded-full bg-line motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [eco, setEco] = useState({ total: 0, peak: 0, mobilePct: 0, cr: 0 });

  const fetchStatus = useCallback(async () => {
    try {
      const [data, teamData] = await Promise.all([getPublicStatus(), getPublicTeams()]);
      setClients(data.clients);
      setGeneratedAt(data.generated_at);
      setEco({
        total: data.ecosystem_total ?? 0,
        peak: data.ecosystem_peak_today ?? 0,
        mobilePct: data.ecosystem_mobile_pct ?? 0,
        cr: data.ecosystem_conversion_rate ?? 0,
      });
      setTeams(teamData);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setCountdown(REFRESH_SECS);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, REFRESH_SECS * 1000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // "2026-10-14 14:32 UTC" → "14:32 UTC"
  const updatedAt = generatedAt.split(" ").slice(1).join(" ");
  const hasData = clients.length > 0;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-card">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <svg className="w-6 h-6 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 2L21 12H17V20H7V12H3Z" />
            </svg>
            <h1 className="text-[17px] font-semibold text-ink">Deploy Status</h1>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <p className="hidden sm:block text-[13px] text-ink-3 tabular-nums">
                Actualizado {updatedAt}<span aria-hidden> · próxima en {countdown} s</span>
              </p>
            )}
            <button
              onClick={fetchStatus}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-canvas hover:text-ink ${FOCUS}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
              Actualizar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-8 sm:py-10 space-y-10">
        {loading && <Skeleton />}

        {!loading && error && !hasData && (
          <div className="rounded-2xl border border-line bg-card p-8 text-center space-y-4">
            <div>
              <p className="text-[17px] font-semibold text-ink">No se pudo cargar el estado de deploy</p>
              <p className="text-[15px] text-ink-2 mt-1">Revisá la conexión y volvé a intentar.</p>
            </div>
            <button onClick={fetchStatus} className={`inline-flex h-10 items-center rounded-lg bg-ink px-5 text-[15px] font-semibold text-card hover:opacity-90 ${FOCUS}`}>
              Reintentar
            </button>
          </div>
        )}

        {!loading && error && hasData && (
          <p role="status" className="rounded-xl border border-line bg-card px-4 py-3 text-[13px] text-ink-2">
            No se pudo actualizar. Se muestran los datos de las {updatedAt || "última carga"}.
          </p>
        )}

        {!loading && !error && !hasData && (
          <div className="rounded-2xl border border-line bg-card p-8 text-center space-y-2">
            <p className="text-[17px] font-semibold text-ink">Todavía no hay clientes cargados</p>
            <p className="text-[15px] text-ink-2">
              Los clientes se crean en <Link href="/admin" className={`underline underline-offset-2 hover:text-ink rounded ${FOCUS}`}>Admin → Clientes</Link>.
            </p>
          </div>
        )}

        {!loading && hasData && (
          <>
            <Verdict clients={clients} eco={eco} />

            {ORDER.map((s) => {
              const group = clients.filter((c) => c.deploy_status === s);
              if (group.length === 0) return null;
              return (
                <section key={s} id={STATUS[s].id} aria-labelledby={`${STATUS[s].id}-h`} className="space-y-4 scroll-mt-6">
                  <h2 id={`${STATUS[s].id}-h`} className="flex items-center gap-2 text-[17px] font-semibold text-ink">
                    <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full ${STATUS[s].fill}`}>
                      <StatusGlyph status={s} className="w-3 h-3" />
                    </span>
                    {STATUS[s].group}
                    <span className="font-normal text-ink-3 tabular-nums">{group.length}</span>
                  </h2>
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
                    {group.map((c) => <ClientCard key={c.client_id} client={c} now={now} />)}
                  </div>
                </section>
              );
            })}

            <WeeklyCalendar teams={teams} />

            <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
              <PublicMonthCalendar />
            </section>
          </>
        )}

        {!loading && <HowItWorks />}
      </main>
    </div>
  );
}
