"use client";

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
  return (
    <div className={`${cfg.cardBg} border-2 ${cfg.border} rounded-2xl p-6 flex flex-col items-center gap-4`}>
      <div className={`w-24 h-24 rounded-full ${cfg.bg} ${cfg.glow} flex items-center justify-center`}>
        <span className="text-4xl">
          {client.deploy_status === "LIBRE" && "✅"}
          {client.deploy_status === "RESTRINGIDO" && "⚠️"}
          {client.deploy_status === "BLOQUEADO" && "🚫"}
        </span>
      </div>
      <div className="text-center">
        <p className={`text-2xl font-black tracking-wide ${cfg.text}`}>{cfg.label}</p>
        <p className="text-gray-500 text-sm mt-0.5">{cfg.sublabel}</p>
      </div>
      <div className="text-center border-t border-gray-200 dark:border-navy-700 pt-4 w-full">
        <p className="text-gray-900 dark:text-white font-bold text-lg leading-tight">{client.client_name}</p>
        <p className="text-gray-400 text-sm mt-1">{client.country_name} · {client.country_iso}</p>
        {client.active_promo_count > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            {client.active_promo_count} promo{client.active_promo_count > 1 ? "s" : ""} activa{client.active_promo_count > 1 ? "s" : ""}
          </p>
        )}
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

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {clients.map((c) => <ClientCard key={c.client_id} client={c} />)}
            </div>
          </div>
        )}
      </main>
    </div>
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
