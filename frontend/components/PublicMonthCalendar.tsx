"use client";

import { useState, useEffect, useCallback } from "react";
import { getPublicCalendar, type PublicCalDay, type PublicCalDayClient, type PublicPromoInfo } from "@/lib/api";

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_ES   = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

type Status = "LIBRE" | "RESTRINGIDO" | "BLOQUEADO";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-card";

// Color tokens live in globals.css; class names are literal so Tailwind can see them.
const STATUS_CFG: Record<Status, { cell: string; text: string; fill: string; label: string }> = {
  LIBRE:       { cell: "bg-card border-line",            text: "text-ink",   fill: "bg-libre-fill text-libre-on", label: "Libre" },
  RESTRINGIDO: { cell: "bg-aviso-tint border-transparent", text: "text-aviso", fill: "bg-aviso-fill text-aviso-on", label: "Con aviso" },
  BLOQUEADO:   { cell: "bg-bloq-tint border-transparent",  text: "text-bloq",  fill: "bg-bloq-fill text-bloq-on",   label: "Bloqueado" },
};

const ORDER: Status[] = ["BLOQUEADO", "RESTRINGIDO", "LIBRE"];

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

  const navBtn = `w-9 h-9 flex items-center justify-center rounded-lg border border-line text-ink-2 hover:bg-canvas hover:text-ink transition cursor-pointer ${FOCUS}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-[17px] font-semibold text-ink">Calendario de restricciones</h2>
        <ul className="flex items-center gap-4 text-[13px] text-ink-2" aria-label="Referencias">
          {ORDER.map(s => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${STATUS_CFG[s].fill}`} aria-hidden />
              {STATUS_CFG[s].label}
            </li>
          ))}
        </ul>
      </div>

      {/* Month nav + summary */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} aria-label="Mes anterior" className={navBtn}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="text-[15px] font-semibold text-ink min-w-[150px] text-center tabular-nums" aria-live="polite">
            {MONTHS_ES[month - 1]} {year}
          </span>
          <button onClick={nextMonth} aria-label="Mes siguiente" className={navBtn}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        {!loading && days.length > 0 && (
          <p className="text-[13px] text-ink-2 tabular-nums">
            {blockedDays === 0 && restrictDays === 0 ? "Sin restricciones este mes" : [
              blockedDays > 0 && `${blockedDays} día${blockedDays > 1 ? "s" : ""} bloqueado${blockedDays > 1 ? "s" : ""}`,
              restrictDays > 0 && `${restrictDays} con aviso`,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Grid + detail panel */}
      <div className="flex gap-5 flex-col lg:flex-row">
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-7 mb-1" aria-hidden>
            {DAYS_ES.map(d => (
              <div key={d} className="text-center text-xs font-medium py-1.5 text-ink-3">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-line motion-safe:animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDOW }).map((_, i) => <div key={`b${i}`} />)}
              {days.map(day => {
                const s = day.merged_status as Status;
                const cfg = STATUS_CFG[s] ?? STATUS_CFG.LIBRE;
                const isToday = day.date === todayStr;
                const isPast  = day.date < todayStr;
                const isSelected = selected?.date === day.date;
                const hasPromos = day.total_promo_count > 0;
                const dayNum = parseInt(day.date.slice(8));
                const label = `${dayNum} de ${MONTHS_ES[month - 1]}${isToday ? ", hoy" : ""}: ${cfg.label}${hasPromos ? `, ${day.active_client_count} cliente${day.active_client_count > 1 ? "s" : ""} con restricciones` : ""}`;

                return (
                  <button
                    key={day.date}
                    onClick={() => setSelected(isSelected ? null : day)}
                    aria-label={label}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    className={`relative rounded-lg border p-1.5 text-left cursor-pointer min-h-[52px] flex flex-col transition-colors ${FOCUS}
                      ${cfg.cell}
                      ${isSelected ? "!border-ink ring-2 ring-ink" : isToday ? "!border-ink" : ""}
                      hover:brightness-95 dark:hover:brightness-125
                    `}
                  >
                    <span className={`text-xs leading-none tabular-nums ${isToday ? "font-bold text-ink" : isPast ? "font-medium text-ink-3" : `font-semibold ${cfg.text}`}`}>
                      {dayNum}
                    </span>
                    {hasPromos && (
                      <span className={`mt-auto self-end text-xs font-semibold px-1.5 rounded tabular-nums leading-tight ${cfg.fill}`}>
                        {day.active_client_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[13px] text-ink-3 mt-3">
            El número indica cuántos clientes tienen restricciones ese día. Elegí un día para ver el detalle.
          </p>
        </div>

        <div className="lg:w-80 shrink-0">
          {selected ? (
            <DayDetail day={selected} todayStr={todayStr} onClose={() => setSelected(null)} />
          ) : (
            <div className="h-full min-h-[160px] flex items-center justify-center rounded-xl border border-dashed border-line p-6">
              <p className="text-[13px] text-ink-3 text-center">Elegí un día para ver qué clientes tienen restricciones</p>
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

  const affectedClients   = day.clients.filter(c => c.active_promo_count > 0);
  const unaffectedClients = day.clients.filter(c => c.active_promo_count === 0);

  return (
    <div className="rounded-xl border border-line bg-card overflow-hidden">
      <div className={`px-4 py-3 flex items-start justify-between gap-2 ${s === "LIBRE" ? "bg-canvas" : cfg.cell}`}>
        <div>
          <p className="text-[13px] text-ink-2 first-letter:uppercase">{dateLabel}{isToday && " · hoy"}</p>
          <p className={`text-[15px] font-semibold mt-0.5 ${cfg.text}`}>{cfg.label}</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar detalle"
          className={`w-8 h-8 -mr-1.5 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink transition cursor-pointer shrink-0 ${FOCUS}`}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="divide-y divide-line max-h-[380px] overflow-y-auto">
        {day.clients.length === 0 && (
          <p className="text-[13px] text-ink-3 text-center py-6">Sin datos de clientes</p>
        )}
        {affectedClients.map(c => <ClientRow key={c.client_id} client={c} />)}
        {unaffectedClients.length > 0 && affectedClients.length > 0 && (
          <p className="text-xs font-medium text-ink-3 px-4 pt-3 pb-1">Sin restricciones</p>
        )}
        {unaffectedClients.map(c => <ClientRow key={c.client_id} client={c} />)}
      </div>

      {day.total_promo_count > 0 && (
        <div className="px-4 py-2 border-t border-line bg-canvas">
          <p className="text-xs text-ink-3">{day.total_promo_count} promo{day.total_promo_count > 1 ? "s" : ""} activa{day.total_promo_count > 1 ? "s" : ""} en total</p>
        </div>
      )}
    </div>
  );
}

const PROMO_TYPE_LABEL: Record<string, string> = {
  PROMO_ESPECIAL: "Especial",
  PROMO_NORMAL:   "Comunicación",
};

function CriticalityDots({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5 mt-1" role="img" aria-label={`Criticidad ${value} de 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < value ? "bg-ink-2" : "bg-line"}`} />
      ))}
    </span>
  );
}

function PromoLine({ promo }: { promo: PublicPromoInfo }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="shrink-0 mt-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-canvas text-ink-2">
        {PROMO_TYPE_LABEL[promo.promo_type] ?? promo.promo_type}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-ink-2 leading-snug">
          {promo.description || <span className="italic text-ink-3">Sin descripción</span>}
        </p>
        <CriticalityDots value={promo.criticality} />
      </div>
    </div>
  );
}

function ClientRow({ client }: { client: PublicCalDayClient }) {
  const s = (client.deploy_status as Status) in STATUS_CFG ? client.deploy_status as Status : "LIBRE";
  const hasPromos = client.active_promos.length > 0;

  return (
    <div className={`px-4 ${hasPromos ? "py-3" : "py-2.5"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_CFG[s].fill}`} aria-hidden />
          <span className="text-[13px] font-semibold text-ink truncate">{client.client_name}</span>
          <span className="sr-only">: {STATUS_CFG[s].label}</span>
        </div>
        {client.window_start && (
          <span className="text-xs font-medium text-aviso shrink-0 tabular-nums">{client.window_start.slice(0, 5)}–{client.window_end?.slice(0, 5)}</span>
        )}
      </div>

      {hasPromos && (
        <div className="mt-2 ml-1 pl-3 border-l-2 border-line space-y-0.5">
          {client.active_promos.map((p, i) => (
            <PromoLine key={i} promo={p} />
          ))}
        </div>
      )}
    </div>
  );
}
