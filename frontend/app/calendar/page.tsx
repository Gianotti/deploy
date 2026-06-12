"use client";

import { useState, useCallback } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import AuthGuard from "@/components/AuthGuard";
import ClientSelector from "@/components/ClientSelector";
import DeployCalendar from "@/components/DeployCalendar";
import StatusBadge from "@/components/StatusBadge";
import { getDeployWindows, getClients } from "@/lib/api";
import { exportSingleToPDF, exportAllToPDF } from "@/utils/exportCalendarPDF";
import type { Client, DeployWindowDay, DeployStatus, PromoType } from "@/types";

const PROMO_LABEL: Record<PromoType, string> = {
  PROMO_ESPECIAL: "Promo Especial 🔴",
  PROMO_NORMAL:   "Promo Normal 🟡",
};

const STATUS_WEIGHT: Record<DeployStatus, number> = {
  BLOQUEADO: 3, RESTRINGIDO: 2, LIBRE: 1,
};

type Mode = "single" | "all";

type ClientWindows = { client: Client; windows: Record<string, DeployWindowDay> };

function mergeWindows(items: ClientWindows[]): Record<string, DeployWindowDay> {
  const merged: Record<string, DeployWindowDay> = {};
  for (const { windows } of items) {
    for (const [date, day] of Object.entries(windows)) {
      const cur = merged[date];
      if (!cur || STATUS_WEIGHT[day.deploy_status] > STATUS_WEIGHT[cur.deploy_status]) {
        merged[date] = { ...day, active_promotions: [] };
      }
    }
  }
  return merged;
}

export default function CalendarPage() {
  const [mode, setMode] = useState<Mode>("single");

  // Single-client state
  const [client, setClient] = useState<Client | null>(null);
  const [windows, setWindows] = useState<Record<string, DeployWindowDay>>({});
  const [selected, setSelected] = useState<DeployWindowDay | null>(null);

  // All-clients state
  const [clientWindows, setClientWindows] = useState<ClientWindows[]>([]);
  const [mergedWins, setMergedWins] = useState<Record<string, DeployWindowDay>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // ── Single mode ──────────────────────────────────────────────────────────────

  async function fetchSingle(c: Client, month: Date) {
    setCurrentMonth(month);
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
    setClient(c); setWindows({}); setSelected(null); fetchSingle(c, new Date());
  }

  // ── All-clients mode ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (month: Date) => {
    setCurrentMonth(month);
    setLoading(true);
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to   = format(endOfMonth(month),   "yyyy-MM-dd");
    try {
      const clients = await getClients();
      const results: ClientWindows[] = await Promise.all(
        clients.map(async (c) => {
          const data = await getDeployWindows(c.id, from, to);
          const wins: Record<string, DeployWindowDay> = {};
          data.windows.forEach((w) => { wins[w.date] = w; });
          return { client: c, windows: wins };
        })
      );
      setClientWindows(results);
      setMergedWins(mergeWindows(results));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  function handleModeChange(next: Mode) {
    setMode(next);
    setSelected(null);
    setSelectedDate(null);
    if (next === "all") fetchAll(new Date());
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Calendario de deploys</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Verde = libre · Amarillo = con aviso · Rojo = bloqueado</p>
        </div>

        {/* Mode toggle + export */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-navy-800 border border-gray-200 dark:border-navy-700 rounded-xl">
            {(["single", "all"] as Mode[]).map((m) => (
              <button key={m} onClick={() => handleModeChange(m)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  mode === m ? "bg-accent text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}>
                {m === "single" ? "📅 Por cliente" : "🌐 Todos los clientes"}
              </button>
            ))}
          </div>

          {mode === "single" && client && Object.keys(windows).length > 0 && (
            <button
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try { await exportSingleToPDF(currentMonth, client.name, windows); }
                finally { setExporting(false); }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-navy-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-700 transition disabled:opacity-50">
              {exporting ? "Generando..." : "📄 Exportar PDF"}
            </button>
          )}

          {mode === "all" && clientWindows.length > 0 && (
            <button
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try { await exportAllToPDF(currentMonth, clientWindows, mergedWins); }
                finally { setExporting(false); }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-navy-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-700 transition disabled:opacity-50">
              {exporting ? "Generando..." : "📄 Exportar PDF"}
            </button>
          )}
        </div>

        {/* ── Single mode ── */}
        {mode === "single" && (
          <>
            <ClientSelector value={client} onChange={handleClientChange} />

            {client ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <DeployCalendar key="single"
                    windows={windows} onDayClick={setSelected}
                    onMonthChange={(m) => fetchSingle(client, m)}
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
          </>
        )}

        {/* ── All-clients mode ── */}
        {mode === "all" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <DeployCalendar key="all"
                windows={mergedWins}
                onDayClick={(day) => setSelectedDate(day.date)}
                onMonthChange={fetchAll}
                loading={loading}
              />
              {!loading && clientWindows.length > 0 && (
                <p className="text-xs text-gray-400 mt-2 text-center">
                  Vista combinada de {clientWindows.length} clientes · el color refleja el estado más restrictivo del día
                </p>
              )}
            </div>

            <div className="lg:col-span-1">
              {selectedDate ? (
                <div className="card p-5 space-y-3 sticky top-24">
                  <p className="text-xs font-semibold text-gray-400 uppercase">{selectedDate}</p>

                  {/* Global merged status for that day */}
                  {mergedWins[selectedDate] && (
                    <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-navy-700">
                      <span className="text-xs text-gray-500">Estado combinado:</span>
                      <StatusBadge status={mergedWins[selectedDate].deploy_status} />
                    </div>
                  )}

                  {/* Per-client breakdown */}
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {clientWindows.map(({ client: c, windows: cw }) => {
                      const day = cw[selectedDate];
                      if (!day) return null;
                      return (
                        <div key={c.id} className="bg-gray-50 dark:bg-navy-900 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">{c.name}</span>
                            <StatusBadge status={day.deploy_status} />
                          </div>
                          {day.window_start && (
                            <p className="text-xs text-yellow-500 font-mono">{day.window_start} → {day.window_end}</p>
                          )}
                          {day.active_promotions.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-gray-200 dark:border-navy-700">
                              {day.active_promotions.map((p) => (
                                <div key={p.id} className="flex items-start gap-1.5">
                                  <span className="text-xs text-accent font-bold shrink-0">{PROMO_LABEL[p.promo_type]}</span>
                                  {p.description && <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.description}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {clientWindows.every(({ windows: cw }) => !cw[selectedDate]) && (
                      <p className="text-gray-400 text-sm text-center py-4">Sin datos para este día</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card p-6 text-center text-gray-400">
                  <div className="text-4xl mb-3">👆</div>
                  <p className="text-sm">Hacé clic en un día para ver el detalle por cliente</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
