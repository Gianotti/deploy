"use client";

import Image from "next/image";
import { useEffect, useState, useCallback } from "react";
import { getPublicStatus, getPublicTeams, type ClientStatus, type PublicTeam } from "@/lib/api";
import PublicMonthCalendar from "@/components/PublicMonthCalendar";
import { useTheme } from "@/lib/theme";
import ClientAvatar from "@/components/ClientAvatar";

const REFRESH_SECS = 60;

const STATUS_CONFIG = {
  LIBRE: {
    bg: "bg-green-500", glow: "shadow-[0_0_32px_rgba(34,197,94,0.5)]",
    border: "border-green-300 dark:border-green-600",
    cardBg: "bg-white dark:bg-navy-800",
    text: "text-green-600 dark:text-green-400",
    labelBg: "bg-green-50 dark:bg-navy-900",
    label: "LIBRE", sublabel: "Podés deployar",
  },
  RESTRINGIDO: {
    bg: "bg-yellow-400", glow: "shadow-[0_0_32px_rgba(250,204,21,0.5)]",
    border: "border-yellow-300 dark:border-yellow-500",
    cardBg: "bg-white dark:bg-navy-800",
    text: "text-yellow-600 dark:text-yellow-400",
    labelBg: "bg-yellow-50 dark:bg-navy-900",
    label: "CON AVISO", sublabel: "Deploy posible avisando",
  },
  BLOQUEADO: {
    bg: "bg-red-500", glow: "shadow-[0_0_32px_rgba(239,68,68,0.5)]",
    border: "border-red-300 dark:border-red-600",
    cardBg: "bg-white dark:bg-navy-800",
    text: "text-red-600 dark:text-red-400",
    labelBg: "bg-red-50 dark:bg-navy-900",
    label: "BLOQUEADO", sublabel: "No deployar hoy",
  },
} as const;

function StatusIcon({ status }: { status: keyof typeof STATUS_CONFIG }) {
  if (status === "LIBRE") return (
    <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
  if (status === "RESTRINGIDO") return (
    <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function ClientCard({ client }: { client: ClientStatus }) {
  const cfg = STATUS_CONFIG[client.deploy_status];
  const logoUrl = `/api/clients/${client.client_id}/logo`;

  return (
    <div className={`${cfg.cardBg} border-2 ${cfg.border} rounded-2xl p-5 flex flex-col gap-4 shadow-sm dark:shadow-none`}>

      {/* Logo + status circle */}
      <div className="flex items-center justify-between w-full gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {client.has_logo ? (
            <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gray-50 dark:bg-navy-900 border border-gray-200 dark:border-navy-700">
              <Image src={logoUrl} alt={client.client_name} width={56} height={56} className="object-contain w-full h-full" unoptimized />
            </div>
          ) : (
            <ClientAvatar name={client.client_name} size="lg" />
          )}
          <div className="min-w-0">
            <p className="text-gray-900 dark:text-white font-black text-lg leading-tight truncate">{client.client_name}</p>
            <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{client.country_name} · {client.country_iso}</p>
            {client.active_promo_count > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                {client.active_promo_count} promo{client.active_promo_count > 1 ? "s" : ""} activa{client.active_promo_count > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <div className={`w-16 h-16 rounded-full ${cfg.bg} ${cfg.glow} flex items-center justify-center flex-shrink-0`}>
          <StatusIcon status={client.deploy_status} />
        </div>
      </div>

      {/* Status label */}
      <div className={`w-full text-center rounded-xl py-2 ${cfg.labelBg}`}>
        <p className={`text-lg font-black tracking-wide ${cfg.text}`}>{cfg.label}</p>
        <p className="text-gray-500 text-xs mt-0.5">{cfg.sublabel}</p>
      </div>

      {client.window_start && (
        <div className="bg-gray-50 dark:bg-navy-900 rounded-xl px-4 py-2 w-full text-center border border-gray-100 dark:border-navy-700">
          <p className="text-xs text-gray-400 mb-0.5">Ventana permitida</p>
          <p className="text-yellow-500 font-mono font-bold">{client.window_start} → {client.window_end}</p>
        </div>
      )}

      {/* Usuarios activos + fuentes de tráfico */}
      <div className="bg-gray-50 dark:bg-navy-900 rounded-xl px-4 py-3 w-full space-y-2 border border-gray-100 dark:border-navy-700">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Usuarios activos ahora</p>
          {client.ga4_active_users != null
            ? <p className="text-blue-600 dark:text-blue-400 font-bold text-lg tabular-nums">
                <svg className="inline w-4 h-4 mr-1 mb-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                {client.ga4_active_users}
              </p>
            : <p className="text-gray-400 font-mono text-sm">—</p>}
        </div>
        {(() => {
          const src = client.ga4_traffic_sources ?? {};
          const hasSrc = Object.values(src).some(v => v > 0);
          if (!hasSrc) return null;
          return (
            <div className="flex items-center gap-1.5 flex-wrap border-t border-gray-200 dark:border-navy-700 pt-2">
              {src.paid > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800/40">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 10.5h-1.5v-1.5h1.5v1.5zm0-3h-1.5V4.5h1.5V8.5z"/></svg>
                  pago {src.paid}
                </span>
              )}
              {src.organic > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><path d="M13 13l-2-2"/></svg>
                  org. {src.organic}
                </span>
              )}
              {src.direct > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-navy-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-navy-600">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v12M2 8h12" strokeLinecap="round"/></svg>
                  dir. {src.direct}
                </span>
              )}
              {src.other > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-navy-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-navy-600">
                  otros {src.other}
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {/* Top 3 URLs */}
      {(client.ga4_top_pages ?? []).length > 0 && (
        <div className="bg-gray-50 dark:bg-navy-900 rounded-xl px-4 py-3 w-full border border-gray-100 dark:border-navy-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500">Páginas más visitadas</p>
            <span className="text-xs text-gray-400 italic">usuarios ahora</span>
          </div>
          <div className="space-y-1.5">
            {client.ga4_top_pages.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <svg className="w-3 h-3 text-gray-400 shrink-0" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M4.5 8h5M4.5 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">{p.path}</span>
                </div>
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 tabular-nums shrink-0">{p.users}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-navy-700 leading-relaxed">
            <svg className="inline w-3 h-3 mr-1 mb-0.5" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.5 8h5M4.5 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Path de la página · el número es la cantidad de usuarios activos en esa URL en este momento
          </p>
        </div>
      )}
    </div>
  );
}

// ── Weekly Deploy Calendar ────────────────────────────────────────────────────

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function WeeklyCalendar({ teams }: { teams: PublicTeam[] }) {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offsetToMonday);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const hasAnyTeam = teams.some(t => t.deploy_days.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Intenciones de deploy — semana actual</h3>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const isToday = day.toDateString() === today.toDateString();
          const isPast = day < today && !isToday;
          const deployingTeams = teams.filter(t => t.deploy_days.includes(i));
          const isWeekend = i >= 5;

          return (
            <div
              key={i}
              className={`relative rounded-xl p-2 flex flex-col gap-1.5 min-h-[90px] border transition-colors
                ${isToday
                  ? "bg-accent/10 dark:bg-accent/15 border-accent/40 dark:border-accent/50 ring-2 ring-accent/30"
                  : isPast
                    ? "bg-gray-50 dark:bg-navy-900/50 border-gray-100 dark:border-navy-700/50 opacity-60"
                    : isWeekend
                      ? "bg-gray-50 dark:bg-navy-900 border-gray-100 dark:border-navy-700"
                      : "bg-white dark:bg-navy-800 border-gray-200 dark:border-navy-700 shadow-sm dark:shadow-none"
                }`}
            >
              {/* Day label */}
              <div className={`text-center ${isToday ? "text-accent" : isWeekend ? "text-gray-400 dark:text-gray-600" : "text-gray-500 dark:text-gray-400"}`}>
                <p className="text-xs font-semibold uppercase">{DAY_NAMES[i]}</p>
                <p className={`text-lg font-black leading-none mt-0.5 ${isToday ? "text-accent" : "text-gray-900 dark:text-white"}`}>
                  {day.getDate()}
                </p>
                {isToday && (
                  <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-wider text-accent leading-none">hoy</span>
                )}
              </div>

              {/* Team badges */}
              <div className="flex flex-col gap-1 mt-auto">
                {deployingTeams.length === 0 ? (
                  !isWeekend && (
                    <span className="text-[10px] text-gray-300 dark:text-gray-600 text-center leading-tight">—</span>
                  )
                ) : (
                  deployingTeams.map(t => (
                    <span key={t.id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50 truncate text-center leading-tight">
                      {t.name}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!hasAnyTeam && (
        <p className="text-center text-xs text-gray-400 dark:text-gray-600 italic">
          Ningún equipo tiene días de deploy configurados aún — configuralo en Admin → Equipos
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { theme, toggle } = useTheme();
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [teams, setTeams]     = useState<PublicTeam[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ecosystemTotal, setEcosystemTotal] = useState(0);
  const [ecosystemPeak, setEcosystemPeak] = useState(0);
  const [ecosystemMobilePct, setEcosystemMobilePct] = useState(0);
  const [ecosystemDesktopPct, setEcosystemDesktopPct] = useState(0);
  const [ecosystemCR, setEcosystemCR] = useState(0);

  const fetchStatus = useCallback(async () => {
    setError(false);
    try {
      const [data, teamData] = await Promise.all([getPublicStatus(), getPublicTeams()]);
      setClients(data.clients);
      setGeneratedAt(data.generated_at);
      setEcosystemTotal(data.ecosystem_total ?? 0);
      setEcosystemPeak(data.ecosystem_peak_today ?? 0);
      setEcosystemMobilePct(data.ecosystem_mobile_pct ?? 0);
      setEcosystemDesktopPct(data.ecosystem_desktop_pct ?? 0);
      setEcosystemCR(data.ecosystem_conversion_rate ?? 0);
      setTeams(teamData);
      setCountdown(REFRESH_SECS);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, REFRESH_SECS * 1000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    const id = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const bloqueado   = clients.filter((c) => c.deploy_status === "BLOQUEADO");
  const restringido = clients.filter((c) => c.deploy_status === "RESTRINGIDO");
  const libre       = clients.filter((c) => c.deploy_status === "LIBRE");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900 flex flex-col">
      <header className="bg-white dark:bg-navy-800 border-b border-gray-200 dark:border-navy-700 px-6 py-4 flex items-center justify-between shadow-sm dark:shadow-none">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L21 12H17V20H7V12H3Z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-gray-900 dark:text-white font-bold text-xl leading-none">Deploy Status</h1>
            <p className="text-gray-400 text-xs mt-0.5">Estado actual por cliente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            {generatedAt && <p className="text-gray-400 text-xs">Actualizado: {generatedAt}</p>}
            <button onClick={fetchStatus} className="text-xs text-gray-400 hover:text-gray-900 dark:hover:text-white transition mt-1 cursor-pointer">
              Actualizar en {countdown}s · <span className="underline">ahora</span>
            </button>
          </div>
          <button onClick={toggle} aria-label="Cambiar tema"
            className="w-9 h-9 flex items-center justify-center rounded-lg transition text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-700 cursor-pointer">
            {theme === "dark"
              ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              : <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            }
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 w-full max-w-screen-2xl mx-auto">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 text-accent animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L21 12H17V20H7V12H3Z"/>
              </svg>
              <p className="text-gray-400 text-sm">Cargando estado…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <p className="text-red-500 text-lg">No se pudo conectar con el backend</p>
            <button onClick={fetchStatus} className="btn-primary cursor-pointer">Reintentar</button>
          </div>
        )}

        {!loading && !error && clients.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64">
            <p className="text-gray-400">No hay clientes cargados aún</p>
          </div>
        )}

        {!loading && !error && clients.length > 0 && (
          <div className="space-y-8">
            <EcosystemBox total={ecosystemTotal} peak={ecosystemPeak} clientCount={clients.length} mobilePct={ecosystemMobilePct} desktopPct={ecosystemDesktopPct} conversionRate={ecosystemCR} />

            <div className="flex gap-3 flex-wrap">
              <Chip count={bloqueado.length}   label="Bloqueados" color="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800" />
              <Chip count={restringido.length} label="Con aviso"  color="text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800" />
              <Chip count={libre.length}       label="Libres"     color="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
              {clients.map((c) => <ClientCard key={c.client_id} client={c} />)}
            </div>

            {/* Weekly deploy calendar */}
            <div className="bg-white dark:bg-navy-800 rounded-2xl border border-gray-200 dark:border-navy-700 p-6 shadow-sm dark:shadow-none">
              <WeeklyCalendar teams={teams} />
            </div>

            {/* Monthly restrictions calendar — for cloud/infra scaling planning */}
            <div className="bg-white dark:bg-navy-800 rounded-2xl border border-gray-200 dark:border-navy-700 p-6 shadow-sm dark:shadow-none">
              <PublicMonthCalendar />
            </div>
          </div>
        )}

        {!loading && !error && <HowItWorks />}
      </main>
    </div>
  );
}

function EcosystemBox({ total, peak, clientCount, mobilePct, desktopPct, conversionRate }: {
  total: number; peak: number; clientCount: number;
  mobilePct: number; desktopPct: number; conversionRate: number;
}) {
  const hasDevices = mobilePct > 0 || desktopPct > 0;
  const hasCR = conversionRate > 0;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 p-px shadow-xl">
      <div className="rounded-2xl bg-gray-950/95 dark:bg-navy-900/95 px-6 py-5 sm:px-8 sm:py-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400" />
              </span>
              <span className="text-xs font-semibold text-cyan-400 uppercase tracking-widest">En vivo</span>
            </div>
            <h2 className="text-white font-black text-xl sm:text-2xl leading-tight">Ecosistema Avenida+</h2>
            <p className="text-gray-400 text-sm mt-0.5">{clientCount} clientes monitoreados</p>
          </div>
          <div className="flex items-stretch gap-4 sm:gap-8">
            <div className="text-center">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Usuarios online ahora</p>
              <p className="text-white font-black text-4xl sm:text-5xl leading-none tabular-nums">{total.toLocaleString("es-AR")}</p>
              <p className="text-cyan-400 text-xs mt-1.5 flex items-center justify-center gap-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                activos
              </p>
            </div>
            <div className="w-px bg-white/10 self-stretch" />
            <div className="text-center">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Pico máximo hoy</p>
              <p className="text-white font-black text-4xl sm:text-5xl leading-none tabular-nums">{peak.toLocaleString("es-AR")}</p>
              <p className="text-indigo-300 text-xs mt-1.5 flex items-center justify-center gap-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                usuarios
              </p>
            </div>
          </div>
        </div>
        {(hasDevices || hasCR) && (
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-white/10">
            {hasDevices && (
              <>
                <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2">
                  <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
                  <span className="text-white font-bold text-sm">{mobilePct}%</span>
                  <span className="text-gray-400 text-xs">mobile</span>
                </div>
                <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2">
                  <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></svg>
                  <span className="text-white font-bold text-sm">{desktopPct}%</span>
                  <span className="text-gray-400 text-xs">desktop</span>
                </div>
              </>
            )}
            {hasCR && (
              <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2">
                <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                <span className="text-white font-bold text-sm">{conversionRate}%</span>
                <span className="text-gray-400 text-xs">conv. rate</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { title: "Se registra una promoción", desc: "El equipo comercial carga al calendario las fechas de campañas, descuentos o eventos que van a generar tráfico alto.", icon: <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14" strokeWidth="2.5"/><line x1="12" y1="14" x2="12.01" y2="14" strokeWidth="2.5"/><line x1="8" y1="18" x2="8.01" y2="18" strokeWidth="2.5"/></svg> },
  { title: "El sistema evalúa el día", desc: "Automáticamente se analiza si hoy hay alguna promoción activa y qué tan crítica es para los usuarios.", icon: <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5"/></svg> },
  { title: "Se determina el semáforo", desc: "En base a las reglas del negocio, el día queda marcado como libre, con aviso o bloqueado para cada cliente.", icon: <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none"/></svg> },
  { title: "El equipo actúa en consecuencia", desc: "Desarrollo revisa este panel antes de cada deploy para saber si puede avanzar, avisar o esperar.", icon: <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
];

const OUTCOMES = [
  {
    status: "LIBRE", label: "Podés deployar",
    bg: "bg-green-50 dark:bg-green-900/10", border: "border-green-200 dark:border-green-800",
    badge: "bg-green-500", badgeText: "text-green-700 dark:text-green-300",
    title: "Sin restricciones",
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    bullets: ["No hay promociones activas hoy", "Podés hacer el deploy en cualquier momento", "No hace falta avisar a nadie"],
  },
  {
    status: "CON AVISO", label: "Deploy posible, pero avisá",
    bg: "bg-yellow-50 dark:bg-yellow-900/10", border: "border-yellow-200 dark:border-yellow-700",
    badge: "bg-yellow-400", badgeText: "text-yellow-700 dark:text-yellow-300",
    title: "Hay una promo activa",
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    bullets: ["Existe una campaña en curso de baja criticidad", "Avisá al equipo comercial antes de deployar", "Respetá la ventana horaria indicada si la hay", "Cualquier incidente en prod afecta la campaña"],
  },
  {
    status: "BLOQUEADO", label: "No deployar",
    bg: "bg-red-50 dark:bg-red-900/10", border: "border-red-200 dark:border-red-800",
    badge: "bg-red-500", badgeText: "text-red-700 dark:text-red-300",
    title: "Promo crítica en curso",
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
    bullets: ["Hay una campaña de alto impacto activa", "Un deploy podría interrumpir comunicaciones o pagos", "Esperá a que finalice la promoción", "Ante urgencia crítica, coordinar con comercial y legales"],
  },
];

function HowItWorks() {
  return (
    <section className="mt-16 pb-12 space-y-12">
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium whitespace-nowrap">¿Cómo funciona el semáforo?</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0">
        {STEPS.map((step, i) => (
          <div key={i} className="relative flex lg:flex-col items-start lg:items-center gap-4 lg:gap-3 lg:text-center px-6 py-5">
            {i < STEPS.length - 1 && (
              <div className="hidden lg:block absolute top-8 left-[calc(50%+2rem)] right-0 h-px border-t-2 border-dashed border-gray-200 dark:border-navy-700 z-0" />
            )}
            <div className="relative z-10 w-16 h-16 rounded-2xl bg-white dark:bg-navy-800 border-2 border-gray-200 dark:border-navy-700 flex items-center justify-center flex-shrink-0 shadow-sm text-gray-500 dark:text-gray-400">
              {step.icon}
              <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-xs font-black flex items-center justify-center">{i + 1}</span>
            </div>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-sm">{step.title}</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 leading-relaxed">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium whitespace-nowrap">¿Qué significa cada estado?</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {OUTCOMES.map((o) => (
          <div key={o.status} className={`${o.bg} border-2 ${o.border} rounded-2xl p-6 space-y-4`}>
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl ${o.badge} flex items-center justify-center flex-shrink-0`}>{o.icon}</div>
              <div>
                <p className={`font-black text-sm uppercase tracking-wide ${o.badgeText}`}>{o.status}</p>
                <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{o.title}</p>
              </div>
            </div>
            <ul className="space-y-2">
              {o.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="mt-0.5 text-xs shrink-0">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-gray-400 dark:text-gray-600">
        Este semáforo se actualiza automáticamente cada minuto · El estado refleja el día de hoy en el timezone de cada cliente
      </p>
    </section>
  );
}

function Chip({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-2 border rounded-full px-4 py-1.5 ${color}`}>
      <span className="text-xl font-black tabular-nums">{count}</span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
