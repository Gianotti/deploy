"use client";

import { useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import AuthGuard from "@/components/AuthGuard";
import ClientSelector from "@/components/ClientSelector";
import DeployCalendar from "@/components/DeployCalendar";
import StatusBadge from "@/components/StatusBadge";
import { getDeployWindows } from "@/lib/api";
import type { Client, DeployWindowDay, PromoType } from "@/types";

const PROMO_LABEL: Record<PromoType, string> = {
  PROMO_ESPECIAL: "Promo Especial 🔴",
  PROMO_NORMAL:   "Promo Normal 🟡",
};

export default function CalendarPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [windows, setWindows] = useState<Record<string, DeployWindowDay>>({});
  const [selected, setSelected] = useState<DeployWindowDay | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchMonth(c: Client, month: Date) {
    setLoading(true);
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to   = format(endOfMonth(month),   "yyyy-MM-dd");
    try {
      const data = await getDeployWindows(c.id, from, to);
      const map: Record<string, DeployWindowDay> = {};
      data.windows.forEach((w) => { map[w.date] = w; });
      setWindows(map);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function handleClientChange(c: Client) {
    setClient(c); setWindows({}); setSelected(null); fetchMonth(c, new Date());
  }

  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Calendario de deploys</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Verde = libre · Amarillo = con aviso · Rojo = bloqueado</p>
        </div>

        <ClientSelector value={client} onChange={handleClientChange} />

        {client ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <DeployCalendar
                windows={windows}
                onDayClick={setSelected}
                onMonthChange={(m) => client && fetchMonth(client, m)}
                loading={loading}
              />
            </div>

            <div className="lg:col-span-1">
              {selected ? (
                <div className="card p-6 space-y-5 sticky top-24">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{selected.date}</p>
                    <StatusBadge status={selected.deploy_status} />
                  </div>
                  <div className="bg-gray-50 dark:bg-navy-900 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-1">Ventana habilitada</p>
                    <p className="text-yellow-500 font-mono font-bold text-lg">
                      {selected.window_start ? `${selected.window_start} → ${selected.window_end}` : selected.deploy_status === "LIBRE" ? "Todo el día" : "Ninguna"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-3">
                      Promos activas ({selected.active_promotions.length})
                    </p>
                    {selected.active_promotions.length === 0 && (
                      <p className="text-gray-400 text-sm">Sin promociones</p>
                    )}
                    <div className="space-y-2">
                      {selected.active_promotions.map((p) => (
                        <div key={p.id} className="bg-gray-50 dark:bg-navy-900 rounded-xl p-3">
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-accent">{PROMO_LABEL[p.promo_type] ?? p.promo_type}</span>
                            <span className="text-xs text-gray-400">★ {p.criticality}/5</span>
                          </div>
                          <p className="text-gray-900 dark:text-white text-sm mt-1">{p.description ?? "—"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card p-6 text-center text-gray-400">
                  <div className="text-4xl mb-3">👆</div>
                  <p className="text-sm">Hacé clic en un día del calendario</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">📅</div>
            <p>Seleccioná un cliente para ver el calendario</p>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
