"use client";

import { useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import ClientSelector from "@/components/ClientSelector";
import StatusBadge from "@/components/StatusBadge";
import { getTodayStatus } from "@/lib/api";
import type { Client, TodayStatusResponse, PromoType } from "@/types";

const PROMO_LABEL: Record<PromoType, string> = {
  PROMO_ESPECIAL: "Promo Especial 🔴",
  PROMO_NORMAL:   "Comunicación 🟡",
};

export default function DashboardPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<TodayStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function fetchStatus(c: Client) {
    setLoading(true); setError("");
    try { setStatus(await getTodayStatus(c.id)); }
    catch { setError("Error al consultar el estado."); }
    finally { setLoading(false); }
  }

  function handleClientChange(c: Client) {
    setClient(c); setStatus(null); fetchStatus(c);
  }

  return (
    <AuthGuard>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Estado de deploy</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">¿Puedo deployar hoy?</p>
        </div>

        <ClientSelector value={client} onChange={handleClientChange} />

        {loading && <div className="text-center py-16 text-4xl animate-pulse">🚀</div>}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4 text-red-500 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {status && !loading && (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <p className="text-gray-400 text-sm">HOY — {status.date}</p>
              <StatusBadge status={status.deploy_status} large />
              <p className="text-gray-600 dark:text-gray-300 text-base">{status.message}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card p-5 flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-400 uppercase">¿Deploy ahora?</span>
                <span className={`text-3xl font-bold ${status.can_deploy_now ? "text-green-500" : "text-red-500"}`}>
                  {status.can_deploy_now ? "SÍ ✅" : "NO 🚫"}
                </span>
              </div>
              <div className="card p-5 flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-400 uppercase">Ventana habilitada</span>
                <span className="text-2xl font-bold text-yellow-500">
                  {status.window_start ? `${status.window_start} → ${status.window_end}` : status.deploy_status === "LIBRE" ? "Todo el día" : "Ninguna"}
                </span>
              </div>
              <div className="card p-5 flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-400 uppercase">Promos activas</span>
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{status.active_promotions.length}</span>
              </div>
            </div>

            {status.active_promotions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">Promociones activas hoy</h2>
                <div className="space-y-3">
                  {status.active_promotions.map((p) => (
                    <div key={p.id} className="card p-4 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-accent">{PROMO_LABEL[p.promo_type] ?? p.promo_type}</span>
                          <span className="text-xs text-gray-400">Criticidad {p.criticality}/5</span>
                        </div>
                        <p className="text-gray-900 dark:text-white text-sm mt-0.5">{p.description ?? "Sin descripción"}</p>
                        <p className="text-gray-400 text-xs mt-1">{p.start_date} → {p.end_date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!client && !loading && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">📋</div>
            <p>Seleccioná un cliente para ver el estado de deploy</p>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
