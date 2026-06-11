"use client";

import Image from "next/image";
import { useEffect, useState, useCallback } from "react";
import { getPublicStatus, type ClientStatus } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const REFRESH_SECS = 60;

const STATUS_CONFIG = {
  LIBRE: {
    bg: "bg-green-500", glow: "shadow-[0_0_40px_rgba(34,197,94,0.4)]",
    border: "border-green-400 dark:border-green-500",
    cardBg: "bg-green-50 dark:bg-navy-800",
    text: "text-green-600 dark:text-green-400",
    label: "LIBRE", sublabel: "Podés deployar",
  },
  RESTRINGIDO: {
    bg: "bg-yellow-400", glow: "shadow-[0_0_40px_rgba(250,204,21,0.4)]",
    border: "border-yellow-400 dark:border-yellow-400",
    cardBg: "bg-yellow-50 dark:bg-navy-800",
    text: "text-yellow-600 dark:text-yellow-400",
    label: "CON AVISO", sublabel: "Deploy posible avisando",
  },
  BLOQUEADO: {
    bg: "bg-red-500", glow: "shadow-[0_0_40px_rgba(239,68,68,0.4)]",
    border: "border-red-400 dark:border-red-500",
    cardBg: "bg-red-50 dark:bg-navy-800",
    text: "text-red-600 dark:text-red-400",
    label: "BLOQUEADO", sublabel: "No deployar hoy",
  },
} as const;

function ClientCard({ client }: { client: ClientStatus }) {
  const cfg = STATUS_CONFIG[client.deploy_status];
  const countryEntries = Object.entries(client.ga4_by_country ?? {}).sort(([, a], [, b]) => b - a);
  const logoUrl = `/api/clients/${client.client_id}/logo`;

  return (
    <div className={`${cfg.cardBg} border-2 ${cfg.border} rounded-2xl p-6 flex flex-col items-center gap-4`}>

      {/* Logo + status row */}
      <div className="flex items-center justify-between w-full gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {client.has_logo ? (
            <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-white dark:bg-navy-900 border border-gray-200 dark:border-navy-700">
              <Image src={logoUrl} alt={client.client_name} width={64} height={64} className="object-contain w-full h-full" unoptimized />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-white dark:bg-navy-900 border border-gray-200 dark:border-navy-700 flex-shrink-0">
              <span className="text-3xl">🏢</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-gray-900 dark:text-white font-black text-xl leading-tight truncate">{client.client_name}</p>
            <p className="text-gray-400 text-sm mt-0.5">{client.country_name} · {client.country_iso}</p>
            {client.active_promo_count > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                {client.active_promo_count} promo{client.active_promo_count > 1 ? "s" : ""} activa{client.active_promo_count > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>

        <div className={`w-20 h-20 rounded-full ${cfg.bg} ${cfg.glow} flex items-center justify-center flex-shrink-0`}>
          <span className="text-3xl">
            {client.deploy_status === "LIBRE" && "✅"}
            {client.deploy_status === "RESTRINGIDO" && "⚠️"}
            {client.deploy_status === "BLOQUEADO" && "🚫"}
          </span>
        </div>
      </div>

      {/* Status label */}
      <div className={`w-full text-center rounded-xl py-2 bg-white dark:bg-navy-900`}>
        <p className={`text-xl font-black tracking-wide ${cfg.text}`}>{cfg.label}</p>
        <p className="text-gray-500 text-xs mt-0.5">{cfg.sublabel}</p>
      </div>

      {client.window_start && (
        <div className="bg-white dark:bg-navy-900 rounded-xl px-4 py-2 w-full text-center">
          <p className="text-xs text-gray-400 mb-0.5">Ventana permitida</p>
          <p className="text-yellow-500 font-mono font-bold">{client.window_start} → {client.window_end}</p>
        </div>
      )}

      {/* Usuarios activos + desglose por país */}
      <div className="bg-white dark:bg-navy-900 rounded-xl px-4 py-3 w-full">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-400">Usuarios activos ahora</p>
          {client.ga4_active_users != null && (
            <p className="text-blue-500 dark:text-blue-400 font-bold text-lg">👥 {client.ga4_active_users}</p>
          )}
          {client.ga4_active_users == null && <p className="text-gray-400 font-mono text-sm">—</p>}
        </div>
        {countryEntries.length > 0 && (
          <div className="space-y-1 border-t border-gray-100 dark:border-navy-700 pt-2 mt-1">
            {countryEntries.map(([country, count]) => (
              <div key={country} className="flex items-center justify-between text-xs">
                <span className="text-gray-500 dark:text-gray-400">{country}</span>
                <span className="font-semibold text-blue-500 dark:text-blue-400">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top 3 URLs */}
      {(client.ga4_top_pages ?? []).length > 0 && (
        <div className="bg-white dark:bg-navy-900 rounded-xl px-4 py-3 w-full">
          <p className="text-xs text-gray-400 mb-2">URLs más visitadas</p>
          <div className="space-y-1.5">
            {client.ga4_top_pages.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">{p.path}</span>
                <span className="text-xs font-semibold text-gray-400 shrink-0">{p.users}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  const { theme, toggle } = useTheme();
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback(async () => {
    setError(false);
    try {
      const data = await getPublicStatus();
      setClients(data.clients); setGeneratedAt(data.generated_at); setCountdown(REFRESH_SECS);
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
      <header className="bg-white dark:bg-navy-800 border-b border-gray-200 dark:border-navy-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚀</span>
          <div>
            <h1 className="text-gray-900 dark:text-white font-bold text-xl leading-none">Deploy Status</h1>
            <p className="text-gray-400 text-xs mt-0.5">Estado actual por cliente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            {generatedAt && <p className="text-gray-400 text-xs">Actualizado: {generatedAt}</p>}
            <button onClick={fetchStatus} className="text-xs text-gray-400 hover:text-gray-900 dark:hover:text-white transition mt-1">
              Actualizar en {countdown}s · <span className="underline">ahora</span>
            </button>
          </div>
          <button onClick={toggle}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-lg transition text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-700">
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {loading && <div className="flex items-center justify-center h-64"><div className="text-4xl animate-pulse">🚀</div></div>}

        {error && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <p className="text-red-500 text-lg">No se pudo conectar con el backend</p>
            <button onClick={fetchStatus} className="btn-primary">Reintentar</button>
          </div>
        )}

        {!loading && !error && clients.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64">
            <p className="text-gray-400">No hay clientes cargados aún</p>
          </div>
        )}

        {!loading && !error && clients.length > 0 && (
          <div className="space-y-8">
            <div className="flex gap-4 flex-wrap">
              <Chip count={bloqueado.length}   label="Bloqueados" color="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800" />
              <Chip count={restringido.length} label="Con aviso"  color="text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800" />
              <Chip count={libre.length}       label="Libres"     color="text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
              {clients.map((c) => <ClientCard key={c.client_id} client={c} />)}
            </div>
          </div>
        )}

        {!loading && !error && <HowItWorks />}
      </main>
    </div>
  );
}

const STEPS = [
  {
    icon: "📅",
    title: "Se registra una promoción",
    desc: "El equipo comercial carga al calendario las fechas de campañas, descuentos o eventos que van a generar tráfico alto.",
  },
  {
    icon: "⚙️",
    title: "El sistema evalúa el día",
    desc: "Automáticamente se analiza si hoy hay alguna promoción activa y qué tan crítica es para los usuarios.",
  },
  {
    icon: "🚦",
    title: "Se determina el semáforo",
    desc: "En base a las reglas del negocio, el día queda marcado como libre, con aviso o bloqueado para cada cliente.",
  },
  {
    icon: "📣",
    title: "El equipo actúa en consecuencia",
    desc: "Desarrollo revisa este panel antes de cada deploy para saber si puede avanzar, avisar o esperar.",
  },
];

const OUTCOMES = [
  {
    icon: "✅",
    status: "LIBRE",
    label: "Podés deployar",
    bg: "bg-green-50 dark:bg-green-900/20",
    border: "border-green-300 dark:border-green-700",
    badge: "bg-green-500",
    badgeText: "text-green-700 dark:text-green-300",
    title: "Sin restricciones",
    bullets: [
      "No hay promociones activas hoy",
      "Podés hacer el deploy en cualquier momento",
      "No hace falta avisar a nadie",
    ],
  },
  {
    icon: "⚠️",
    status: "CON AVISO",
    label: "Deploy posible, pero avisá",
    bg: "bg-yellow-50 dark:bg-yellow-900/20",
    border: "border-yellow-300 dark:border-yellow-700",
    badge: "bg-yellow-400",
    badgeText: "text-yellow-700 dark:text-yellow-300",
    title: "Hay una promo activa",
    bullets: [
      "Existe una campaña en curso de baja criticidad",
      "Avisá al equipo comercial antes de deployar",
      "Respetá la ventana horaria indicada si la hay",
      "Cualquier incidente en prod afecta la campaña",
    ],
  },
  {
    icon: "🚫",
    status: "BLOQUEADO",
    label: "No deployar",
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-300 dark:border-red-700",
    badge: "bg-red-500",
    badgeText: "text-red-700 dark:text-red-300",
    title: "Promo crítica en curso",
    bullets: [
      "Hay una campaña de alto impacto activa",
      "Un deploy podría interrumpir comunicaciones o pagos",
      "Esperá a que finalice la promoción",
      "Ante urgencia crítica, coordinar con comercial y legales",
    ],
  },
];

function HowItWorks() {
  return (
    <section className="mt-16 pb-12 space-y-12">

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium whitespace-nowrap">¿Cómo funciona el semáforo?</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0">
        {STEPS.map((step, i) => (
          <div key={i} className="relative flex lg:flex-col items-start lg:items-center gap-4 lg:gap-3 lg:text-center px-6 py-5">
            {/* Connector line between steps */}
            {i < STEPS.length - 1 && (
              <div className="hidden lg:block absolute top-8 left-[calc(50%+2rem)] right-0 h-px border-t-2 border-dashed border-gray-200 dark:border-navy-700 z-0" />
            )}
            <div className="relative z-10 w-16 h-16 rounded-2xl bg-white dark:bg-navy-800 border-2 border-gray-200 dark:border-navy-700 flex items-center justify-center text-3xl flex-shrink-0 shadow-sm">
              {step.icon}
              <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-xs font-black flex items-center justify-center">
                {i + 1}
              </span>
            </div>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-sm">{step.title}</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 leading-relaxed">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium whitespace-nowrap">¿Qué significa cada estado?</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-navy-700" />
      </div>

      {/* Outcome cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {OUTCOMES.map((o) => (
          <div key={o.status} className={`${o.bg} border-2 ${o.border} rounded-2xl p-6 space-y-4`}>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl ${o.badge} flex items-center justify-center text-2xl flex-shrink-0`}>
                {o.icon}
              </div>
              <div>
                <p className={`font-black text-sm uppercase tracking-wide ${o.badgeText}`}>{o.status}</p>
                <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">{o.title}</p>
              </div>
            </div>
            <ul className="space-y-2">
              {o.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="mt-0.5 text-xs">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-gray-400 dark:text-gray-600">
        Este semáforo se actualiza automáticamente cada minuto · El estado refleja el día de hoy en el timezone de cada cliente
      </p>
    </section>
  );
}

function Chip({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-2 border rounded-full px-4 py-1.5 ${color}`}>
      <span className="text-xl font-black">{count}</span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
