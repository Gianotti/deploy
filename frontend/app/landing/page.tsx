"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { getPublicStatus, getPublicTeams, type ClientStatus, type PublicTeam } from "@/lib/api";
import PublicMonthCalendar from "@/components/PublicMonthCalendar";
import {
  BotIcon, ClientCard, LandingHeader, FOCUS, ORDER, REFRESH_SECS, STATUS, Status, StatusGlyph, StatusPill, clientSlug, n, verdict,
} from "@/components/landing/parts";

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
        <h1 id="verdict" className="text-[28px] sm:text-[36px] font-bold leading-[1.15] tracking-tight text-ink max-w-3xl">
          {headline}
        </h1>
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
                <Link href={`/landing/${clientSlug(c)}`} className={`font-medium text-ink underline underline-offset-2 rounded ${FOCUS}`}>{c.client_name}</Link>
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

  // Coming back from a client page (/landing#cliente-N): the card exists only after the first load
  useEffect(() => {
    if (hasData && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [hasData]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <LandingHeader updatedAt={updatedAt} countdown={countdown} onRefresh={fetchStatus} />

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
                  <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
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
