import * as XLSX from "xlsx";
import { format, eachDayOfInterval, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { DeployWindowDay } from "@/types";

const STATUS_ES: Record<string, string> = {
  LIBRE: "Libre",
  RESTRINGIDO: "Restringido",
  BLOQUEADO: "Bloqueado",
};

function dayLabel(dateStr: string) {
  return format(parseISO(dateStr), "EEEE", { locale: es });
}

function promoSummary(day: DeployWindowDay) {
  return day.active_promotions
    .map((p) => `${p.promo_type}${p.description ? ` – ${p.description}` : ""}`)
    .join(" | ");
}

export function exportSingleToExcel(
  month: Date,
  clientName: string,
  windows: Record<string, DeployWindowDay>
) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const monthLabel = format(month, "MMMM yyyy", { locale: es });

  const rows = days.map((d) => {
    const key = format(d, "yyyy-MM-dd");
    const w = windows[key];
    return {
      Fecha: key,
      Día: dayLabel(key),
      Estado: w ? STATUS_ES[w.deploy_status] ?? w.deploy_status : "—",
      "Ventana inicio": w?.window_start ?? "—",
      "Ventana fin": w?.window_end ?? "—",
      "Cant. promos": w?.active_promotions.length ?? 0,
      Promociones: w ? promoSummary(w) : "",
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 50 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Calendario");

  XLSX.writeFile(wb, `calendario_${clientName}_${format(month, "yyyy-MM")}.xlsx`);
}

export function exportAllToExcel(
  month: Date,
  clientWindows: { client: { id: number; name: string }; windows: Record<string, DeployWindowDay> }[]
) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  // Sheet 1: flat rows — one row per (date × client)
  const flatRows = days.flatMap((d) => {
    const key = format(d, "yyyy-MM-dd");
    return clientWindows.map(({ client: c, windows: cw }) => {
      const w = cw[key];
      return {
        Fecha: key,
        Día: dayLabel(key),
        Cliente: c.name,
        Estado: w ? STATUS_ES[w.deploy_status] ?? w.deploy_status : "—",
        "Ventana inicio": w?.window_start ?? "—",
        "Ventana fin": w?.window_end ?? "—",
        "Cant. promos": w?.active_promotions.length ?? 0,
        Promociones: w ? promoSummary(w) : "",
      };
    });
  });

  const wsFlat = XLSX.utils.json_to_sheet(flatRows);
  wsFlat["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 50 },
  ];

  // Sheet 2: matrix — rows = clients, columns = days
  const dateKeys = days.map((d) => format(d, "yyyy-MM-dd"));
  const matrixRows = clientWindows.map(({ client: c, windows: cw }) => {
    const row: Record<string, string> = { Cliente: c.name };
    dateKeys.forEach((k) => {
      const w = cw[k];
      row[format(parseISO(k), "dd/MM")] = w ? STATUS_ES[w.deploy_status] ?? w.deploy_status : "—";
    });
    return row;
  });

  const wsMatrix = XLSX.utils.json_to_sheet(matrixRows);
  wsMatrix["!cols"] = [{ wch: 20 }, ...dateKeys.map(() => ({ wch: 12 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsFlat, "Detalle");
  XLSX.utils.book_append_sheet(wb, wsMatrix, "Matriz");

  XLSX.writeFile(wb, `calendario_todos_${format(month, "yyyy-MM")}.xlsx`);
}
