"use client";

import { useState } from "react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isToday, addMonths, subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import type { DeployWindowDay, DeployStatus } from "@/types";

const DOT: Record<DeployStatus, string> = {
  LIBRE:       "bg-green-500",
  RESTRINGIDO: "bg-yellow-400",
  BLOQUEADO:   "bg-red-500",
};

const CELL_HOVER: Record<DeployStatus, string> = {
  LIBRE:       "hover:bg-green-50 dark:hover:bg-green-900/30",
  RESTRINGIDO: "hover:bg-yellow-50 dark:hover:bg-yellow-900/30",
  BLOQUEADO:   "hover:bg-red-50 dark:hover:bg-red-900/30",
};

interface Props {
  windows: Record<string, DeployWindowDay>;
  onDayClick: (day: DeployWindowDay) => void;
  onMonthChange: (month: Date) => void;
  loading?: boolean;
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function DeployCalendar({ windows, onDayClick, onMonthChange, loading }: Props) {
  const [current, setCurrent] = useState(new Date());

  function changeMonth(delta: number) {
    const next = delta > 0 ? addMonths(current, 1) : subMonths(current, 1);
    setCurrent(next);
    onMonthChange(next);
  }

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(current)),
    end: endOfWeek(endOfMonth(current)),
  });

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-navy-700">
        <button
          onClick={() => changeMonth(-1)}
          className="p-2 rounded-lg transition text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700"
        >←</button>
        <h2 className="font-semibold text-gray-900 dark:text-white capitalize">
          {format(current, "MMMM yyyy", { locale: es })}
          {loading && <span className="ml-3 text-xs text-gray-400 animate-pulse">cargando...</span>}
        </h2>
        <button
          onClick={() => changeMonth(1)}
          className="p-2 rounded-lg transition text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700"
        >→</button>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-navy-700">
        {DAYS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-gray-400 uppercase">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const w = windows[key];
          const inMonth = isSameMonth(day, current);
          const today = isToday(day);

          return (
            <button
              key={key}
              onClick={() => w && onDayClick(w)}
              disabled={!w}
              className={`
                relative min-h-[64px] p-2 border-b border-r border-gray-100 dark:border-navy-700 text-left transition
                ${!inMonth ? "opacity-30" : ""}
                ${w ? `cursor-pointer ${CELL_HOVER[w.deploy_status]}` : "cursor-default"}
              `}
            >
              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium
                ${today ? "bg-accent text-white" : "text-gray-700 dark:text-gray-300"}`}>
                {format(day, "d")}
              </span>
              {w && <span className={`absolute bottom-2 right-2 w-2.5 h-2.5 rounded-full ${DOT[w.deploy_status]}`} />}
              {w?.window_start && (
                <span className="absolute bottom-2 left-2 text-[9px] text-yellow-500 font-mono">
                  {w.window_start}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-6 px-6 py-3 border-t border-gray-200 dark:border-navy-700">
        {(Object.entries(DOT) as [DeployStatus, string][]).map(([s, cls]) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${cls}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
