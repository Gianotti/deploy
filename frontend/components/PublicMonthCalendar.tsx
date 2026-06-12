"use client";

import { useState, useEffect, useCallback } from "react";
import { getPublicCalendar, type PublicCalDay, type PublicCalDayClient } from "@/lib/api";

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_ES   = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

type Status = "LIBRE" | "RESTRINGIDO" | "BLOQUEADO";

const STATUS_CFG: Record<Status, { cell: string; text: string; badge: string; label: string }> = {
  LIBRE:       { cell: "bg-white dark:bg-navy-800",                       text: "text-gray-700 dark:text-gray-300", badge: "bg-green-500",  label: "Libre" },
  RESTRINGIDO: { cell: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700", text: "text-yellow-700 dark:text-yellow-300", badge: "bg-yellow-400", label: "Con aviso" },
  BLOQUEADO:   { cell: "bg-red-50    dark:bg-red-900/20    border-red-200    dark:border-red-700",    text: "text-red-700    dark:text-red-300",    badge: "bg-red-500",    label: "Bloqueado" },
};

const CLIENT_STATUS_CFG: Record<string, { dot: string; text: string }> = {
  LIBRE:       { dot: "bg-green-500",  text: "text-green-600 dark:text-green-400" },
  RESTRINGIDO: { dot: "bg-yellow-400", text: "text-yellow-600 dark:text-yellow-400" },
  BLOQUEADO:   { dot: "bg-red-500",    text: "text-red-600 dark:text-red-400" },
};

export default function PublicMonthCalendar() {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  const [days,  setDays]  = useState<PublicCalDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PublicCalDay | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setSelected(null);
    try {
      const data = await getPublicCalendar(y, m);
      setDays(data.days);
    } catch { setDays([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(year, month); }, [year, month, load]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  // offset: how many blank cells before the 1st (Mon=0)
  const firstDOW = days.length > 0
    ? (new Date(year, month - 1, 1).getDay() + 6) % 7
    : 0;

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  const blockedDays  = days.filter(d => d.merged_status === "BLOQUEADO").length;
  const restrictDays = days.filter(d => d.merged_status === "RESTRINGIDO").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Calendario de restricciones — todos los clientes
          </h3>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-xs">
          {(["BLOQUEADO","RESTRINGIDO","LIBRE"] as Status[]).map(s => (
            <span key={s} className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <span className={`w-2.5 h-2.5 rounded-sm ${STATUS_CFG[s].badge}`} />
              {STATUS_CFG[s].label}
            </span>
          ))}
        </div>
      </div>

      {/* Month nav + summary */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} aria-label="Mes anterior"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-navy-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-700 transition cursor-pointer">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="text-base font-bold text-gray-900 dark:text-white min-w-[160px] text-center tabular-nums">
            {MONTHS_ES[month - 1]} {year}
          </span>
          <button onClick={nextMonth} aria-label="Mes siguiente"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-navy-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-700 transition cursor-pointer">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        {!loading && days.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {blockedDays > 0  && <span className="text-red-600    dark:text-red-400    font-semibold">{blockedDays}  bloqueado{blockedDays  > 1 ? "s" : ""}</span>}
            {restrictDays > 0 && <span className="text-yellow-600 dark:text-yellow-400 font-semibold">{restrictDays} con aviso{restrictDays > 1 ? "" : ""}</span>}
            {blockedDays === 0 && restrictDays === 0 && <span className="text-green-600 dark:text-green-400 font-semibold">Mes libre</span>}
          </div>
        )}
      </div>

      {/* Grid + detail panel */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Calendar grid */}
        <div className="flex-1 min-w-0">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_ES.map(d => (
              <div key={d} className={`text-center text-xs font-semibold py-1.5 ${d === "Sáb" || d === "Dom" ? "text-gray-300 dark:text-gray-600" : "text-gray-400 dark:text-gray-500"}`}>{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-navy-700 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {/* Blank cells for offset */}
              {Array.from({ length: firstDOW }).map((_, i) => <div key={`b${i}`} />)}
              {days.map(day => {
                const s = day.merged_status as Status;
                const cfg = STATUS_CFG[s] ?? STATUS_CFG.LIBRE;
                const isToday = day.date === todayStr;
                const isPast  = day.date < todayStr;
                const isSelected = selected?.date === day.date;
                const hasPromos = day.total_promo_count > 0;
                const dayNum = parseInt(day.date.slice(8));

                return (
                  <button
                    key={day.date}
                    onClick={() => setSelected(isSelected ? null : day)}
                    aria-label={`${day.date}: ${cfg.label}`}
                    className={`relative rounded-lg border p-1.5 text-left transition cursor-pointer min-h-[52px] flex flex-col
                      ${cfg.cell}
                      ${isSelected  ? "ring-2 ring-accent ring-offset-1 dark:ring-offset-navy-900" : ""}
                      ${isToday     ? "ring-2 ring-accent/60 ring-offset-1 dark:ring-offset-navy-900" : ""}
                      ${isPast && !hasPromos ? "opacity-50" : ""}
                      hover:brightness-95 dark:hover:brightness-110 active:scale-95
                    `}
                  >
                    <span className={`text-xs font-bold leading-none ${isToday ? "text-accent" : cfg.text} ${isPast ? "opacity-70" : ""}`}>
                      {dayNum}
                    </span>
                    {hasPromos && (
                      <span className={`mt-auto self-end text-[10px] font-bold px-1 rounded ${cfg.badge} text-white leading-tight`}>
                        {day.active_client_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-600 mt-3 text-center">
            El número en la celda indica cuántos clientes tienen restricciones ese día · Hacé clic en un día para ver el detalle
          </p>
        </div>

        {/* Detail panel */}
        <div className="lg:w-72 shrink-0">
          {selected ? (
            <DayDetail day={selected} todayStr={todayStr} onClose={() => setSelected(null)} />
          ) : (
            <div className="h-full min-h-[180px] flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 dark:border-navy-700 text-gray-400 dark:text-gray-600 gap-2 p-6">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <p className="text-sm text-center">Seleccioná un día para ver el detalle por cliente</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DayDetail({ day, todayStr, onClose }: { day: PublicCalDay; todayStr: string; onClose: () => void }) {
  const s = day.merged_status as Status;
  const cfg = STATUS_CFG[s] ?? STATUS_CFG.LIBRE;
  const isToday = day.date === todayStr;

  const [d, m, y] = [
    parseInt(day.date.slice(8)),
    parseInt(day.date.slice(5, 7)) - 1,
    parseInt(day.date.slice(0, 4)),
  ];
  const dateLabel = new Date(y, m, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  const affectedClients  = day.clients.filter(c => c.active_promo_count > 0);
  const unaffectedClients = day.clients.filter(c => c.active_promo_count === 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-700 bg-white dark:bg-navy-800 overflow-hidden shadow-sm dark:shadow-none">
      {/* Header */}
      <div className={`px-4 py-3 flex items-start justify-between gap-2 ${
        s === "BLOQUEADO"   ? "bg-red-50    dark:bg-red-900/20"    :
        s === "RESTRINGIDO" ? "bg-yellow-50 dark:bg-yellow-900/20" :
        "bg-gray-50 dark:bg-navy-900"
      }`}>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{dateLabel}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.badge}`} />
            <span className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</span>
            {isToday && <span className="text-xs font-bold text-accent">— hoy</span>}
          </div>
        </div>
        <button onClick={onClose} aria-label="Cerrar"
          className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition cursor-pointer mt-0.5 shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Client list */}
      <div className="divide-y divide-gray-100 dark:divide-navy-700 max-h-[380px] overflow-y-auto">
        {day.clients.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">Sin datos de clientes</p>
        )}
        {affectedClients.map(c => <ClientRow key={c.client_id} client={c} />)}
        {unaffectedClients.length > 0 && affectedClients.length > 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-600 px-4 py-2 font-medium uppercase tracking-wide">Sin restricciones</p>
        )}
        {unaffectedClients.map(c => <ClientRow key={c.client_id} client={c} />)}
      </div>

      {day.total_promo_count > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 dark:border-navy-700 bg-gray-50 dark:bg-navy-900">
          <p className="text-xs text-gray-400">{day.total_promo_count} promo{day.total_promo_count > 1 ? "s" : ""} activa{day.total_promo_count > 1 ? "s" : ""} en total</p>
        </div>
      )}
    </div>
  );
}

function ClientRow({ client }: { client: PublicCalDayClient }) {
  const cfg = CLIENT_STATUS_CFG[client.deploy_status] ?? CLIENT_STATUS_CFG.LIBRE;
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate font-medium">{client.client_name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {client.window_start && (
          <span className="text-xs font-mono text-yellow-500">{client.window_start}–{client.window_end}</span>
        )}
        {client.active_promo_count > 0 && (
          <span className={`text-xs font-semibold ${cfg.text}`}>
            {client.active_promo_count}p
          </span>
        )}
      </div>
    </div>
  );
}
