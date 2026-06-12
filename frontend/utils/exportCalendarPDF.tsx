import React from "react";
import {
  Document, Page, View, Text, StyleSheet, pdf,
} from "@react-pdf/renderer";
import {
  format, eachDayOfInterval, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, isSameMonth, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import type { DeployWindowDay } from "@/types";

// ── Paleta ────────────────────────────────────────────────────────────────────

const DOT   = { LIBRE: "#22c55e", RESTRINGIDO: "#f59e0b", BLOQUEADO: "#ef4444" } as const;
const BG    = { LIBRE: "#f0fdf4", RESTRINGIDO: "#fffbeb", BLOQUEADO: "#fef2f2" } as const;
const LABEL = { LIBRE: "Libre",   RESTRINGIDO: "Restringido", BLOQUEADO: "Bloqueado" } as const;
const PROMO_TYPE_LABEL: Record<string, string> = {
  PROMO_ESPECIAL: "Especial",
  PROMO_NORMAL:   "Normal",
};

type Status = keyof typeof DOT;

function bg(s?: string)  { return s && s in BG  ? BG[s  as Status] : "#f9fafb"; }
function dot(s?: string) { return s && s in DOT ? DOT[s as Status] : "transparent"; }

// ── Estilos ────────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: { paddingHorizontal: 34, paddingVertical: 30, fontFamily: "Helvetica", backgroundColor: "#ffffff" },

  // Cabecera
  header: {
    backgroundColor: "#0f172a", borderRadius: 8, paddingVertical: 18, paddingHorizontal: 22,
    marginBottom: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  headerAppName: { fontSize: 10, color: "#64748b", marginBottom: 4, fontFamily: "Helvetica" },
  headerTitle: { fontSize: 20, color: "#f1f5f9", fontFamily: "Helvetica-Bold" },
  headerSub:   { fontSize: 10, color: "#94a3b8", marginTop: 3 },
  headerRight: { alignItems: "flex-end" },
  headerMonth: { fontSize: 14, color: "#e2e8f0", fontFamily: "Helvetica-Bold" },
  headerDate:  { fontSize: 8,  color: "#475569", marginTop: 4 },

  // Barra de estadísticas
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  statDot:  { width: 9, height: 9, borderRadius: 5 },
  statLabel:{ fontSize: 8,  color: "#6b7280" },
  statValue:{ fontSize: 18, fontFamily: "Helvetica-Bold" },

  // Calendario
  calLabel: { fontSize: 8, color: "#94a3b8", fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" },
  calGrid:  { border: "1px solid #e5e7eb", borderRadius: 7, overflow: "hidden", marginBottom: 16 },
  calHeaderRow: { flexDirection: "row", backgroundColor: "#f8fafc", borderBottom: "1px solid #e5e7eb" },
  calHeaderCell:{ flex: 1, paddingVertical: 6, alignItems: "center" },
  calDayName:   { fontSize: 7.5, color: "#9ca3af", fontFamily: "Helvetica-Bold" },
  calWeekRow:   { flexDirection: "row" },
  calCell: { flex: 1, minHeight: 54, paddingTop: 5, paddingHorizontal: 5, paddingBottom: 4, borderRight: "0.5px solid #e5e7eb", borderBottom: "0.5px solid #e5e7eb" },
  calCellLast:  { borderRight: "none" },
  calNum:       { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1f2937" },
  calNumOther:  { fontSize: 13, color: "#d1d5db" },
  calWindow:    { fontSize: 6.5, color: "#b45309", marginTop: 2 },
  calPromoCount:{ fontSize: 6.5, color: "#9ca3af", marginTop: 1 },
  calDot:       { width: 6, height: 6, borderRadius: 3, marginTop: "auto" as any },

  // Leyenda
  legend: { flexDirection: "row", gap: 14, marginBottom: 18, alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot:  { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 7.5, color: "#6b7280" },

  // Sección detalle
  detailLabel: { fontSize: 8, color: "#94a3b8", fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase", borderBottom: "1px solid #f1f5f9", paddingBottom: 5 },
  detailCols:  { flexDirection: "row", gap: 10 },
  detailCol:   { flex: 1 },
  dayBlock:    { marginBottom: 9, borderRadius: 5, paddingVertical: 7, paddingHorizontal: 9, backgroundColor: "#f8fafc" },
  dayBlockHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  dayBlockDate: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: "#111827" },
  dayBlockDow:  { fontSize: 8, color: "#9ca3af", marginLeft: 4 },
  badge:        { borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1.5 },
  badgeText:    { fontSize: 7, color: "#ffffff", fontFamily: "Helvetica-Bold" },
  windowPill:   { marginTop: 4, alignSelf: "flex-start", backgroundColor: "#fef3c7", borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1.5 },
  windowPillText:{ fontSize: 7, color: "#92400e" },
  promoRow:     { flexDirection: "row", alignItems: "flex-start", marginTop: 4, gap: 5 },
  promoPill:    { borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1.5, backgroundColor: "#ede9fe", flexShrink: 0 },
  promoPillText:{ fontSize: 7, color: "#5b21b6", fontFamily: "Helvetica-Bold" },
  promoDesc:    { fontSize: 7.5, color: "#4b5563", flex: 1, lineHeight: 1.4 },
  promoCrit:    { fontSize: 7, color: "#9ca3af", flexShrink: 0 },

  // Pie
  footer: { position: "absolute", bottom: 18, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", borderTop: "0.5px solid #e5e7eb", paddingTop: 5 },
  footerText: { fontSize: 7, color: "#cbd5e1" },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeeks(month: Date): (Date | null)[][] {
  const allDays = eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) });
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < allDays.length; i += 7)
    weeks.push(allDays.slice(i, i + 7).map(d => (isSameMonth(d, month) ? d : null)));
  return weeks;
}

function countStatuses(month: Date, windows: Record<string, DeployWindowDay>) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const counts = { LIBRE: 0, RESTRINGIDO: 0, BLOQUEADO: 0 };
  days.forEach(d => {
    const w = windows[format(d, "yyyy-MM-dd")];
    if (w && w.deploy_status in counts) counts[w.deploy_status as Status]++;
  });
  return counts;
}

// ── Componentes PDF ────────────────────────────────────────────────────────────

function Header({ title, subtitle, month }: { title: string; subtitle?: string; month: Date }) {
  return (
    <View style={S.header}>
      <View>
        <Text style={S.headerAppName}>Deploy Window Manager</Text>
        <Text style={S.headerTitle}>{title}</Text>
        {subtitle && <Text style={S.headerSub}>{subtitle}</Text>}
      </View>
      <View style={S.headerRight}>
        <Text style={S.headerMonth}>{format(month, "MMMM yyyy", { locale: es }).replace(/^\w/, c => c.toUpperCase())}</Text>
        <Text style={S.headerDate}>Generado el {format(new Date(), "dd/MM/yyyy")}</Text>
      </View>
    </View>
  );
}

function StatsRow({ counts }: { counts: Record<string, number> }) {
  return (
    <View style={S.statsRow}>
      {(["LIBRE", "RESTRINGIDO", "BLOQUEADO"] as Status[]).map(s => (
        <View key={s} style={[S.statCard, { backgroundColor: BG[s] }]}>
          <View style={[S.statDot, { backgroundColor: DOT[s] }]} />
          <View>
            <Text style={S.statLabel}>{LABEL[s]}</Text>
            <Text style={[S.statValue, { color: DOT[s] }]}>{counts[s]}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function CalendarGrid({ month, windows }: { month: Date; windows: Record<string, DeployWindowDay> }) {
  const weeks = getWeeks(month);
  const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  return (
    <>
      <Text style={S.calLabel}>Calendario del mes</Text>
      <View style={S.calGrid}>
        <View style={S.calHeaderRow}>
          {DAYS_ES.map(d => (
            <View key={d} style={S.calHeaderCell}><Text style={S.calDayName}>{d}</Text></View>
          ))}
        </View>
        {weeks.map((week, wi) => (
          <View key={wi} style={S.calWeekRow}>
            {week.map((day, di) => {
              const key = day ? format(day, "yyyy-MM-dd") : "";
              const w = day ? windows[key] : null;
              const isLast = di === 6;
              return (
                <View key={di} style={[
                  S.calCell,
                  isLast ? S.calCellLast : {},
                  { backgroundColor: day ? bg(w?.deploy_status) : "#fafafa" },
                ]}>
                  {day && (
                    <>
                      <Text style={S.calNum}>{format(day, "d")}</Text>
                      {w?.window_start && <Text style={S.calWindow}>{w.window_start}→{w.window_end}</Text>}
                      {w && w.active_promotions.length > 0 && (
                        <Text style={S.calPromoCount}>{w.active_promotions.length} promo{w.active_promotions.length > 1 ? "s" : ""}</Text>
                      )}
                      {w && <View style={[S.calDot, { backgroundColor: dot(w.deploy_status) }]} />}
                    </>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </>
  );
}

function Legend() {
  return (
    <View style={S.legend}>
      {(["LIBRE", "RESTRINGIDO", "BLOQUEADO"] as Status[]).map(s => (
        <View key={s} style={S.legendItem}>
          <View style={[S.legendDot, { backgroundColor: DOT[s] }]} />
          <Text style={S.legendText}>{LABEL[s]}</Text>
        </View>
      ))}
    </View>
  );
}

function DayBlock({ dateKey, w }: { dateKey: string; w: DeployWindowDay }) {
  if (w.active_promotions.length === 0) return null;
  const d = parseISO(dateKey);
  return (
    <View style={[S.dayBlock, { borderLeft: `3px solid ${dot(w.deploy_status)}` }]}>
      <View style={S.dayBlockHeader}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={S.dayBlockDate}>{format(d, "dd/MM")}</Text>
          <Text style={S.dayBlockDow}>{format(d, "EEEE", { locale: es })}</Text>
        </View>
        <View style={[S.badge, { backgroundColor: dot(w.deploy_status) }]}>
          <Text style={S.badgeText}>{LABEL[w.deploy_status as Status] ?? w.deploy_status}</Text>
        </View>
      </View>
      {w.window_start && (
        <View style={S.windowPill}><Text style={S.windowPillText}>Ventana: {w.window_start} → {w.window_end}</Text></View>
      )}
      {w.active_promotions.map((p, i) => (
        <View key={i} style={S.promoRow}>
          <View style={S.promoPill}><Text style={S.promoPillText}>{PROMO_TYPE_LABEL[p.promo_type] ?? p.promo_type}</Text></View>
          <Text style={S.promoDesc}>{p.description || "(sin descripción)"}</Text>
          <Text style={S.promoCrit}>★{p.criticality}</Text>
        </View>
      ))}
    </View>
  );
}

function PromoDetail({ month, windows }: { month: Date; windows: Record<string, DeployWindowDay> }) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const withPromos = days
    .map(d => ({ key: format(d, "yyyy-MM-dd"), w: windows[format(d, "yyyy-MM-dd")] }))
    .filter(({ w }) => w && w.active_promotions.length > 0);

  if (withPromos.length === 0) return (
    <>
      <Text style={S.detailLabel}>Detalle de promociones activas</Text>
      <Text style={{ fontSize: 9, color: "#9ca3af" }}>Sin promociones activas este mes.</Text>
    </>
  );

  const mid = Math.ceil(withPromos.length / 2);
  const left  = withPromos.slice(0, mid);
  const right = withPromos.slice(mid);

  return (
    <>
      <Text style={S.detailLabel}>Detalle de promociones activas</Text>
      <View style={S.detailCols}>
        <View style={S.detailCol}>
          {left.map(({ key, w }) => <DayBlock key={key} dateKey={key} w={w} />)}
        </View>
        <View style={S.detailCol}>
          {right.map(({ key, w }) => <DayBlock key={key} dateKey={key} w={w} />)}
        </View>
      </View>
    </>
  );
}

function Footer({ title }: { title: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>Deploy Window Manager · {title}</Text>
      <Text style={S.footerText}>{format(new Date(), "dd/MM/yyyy HH:mm")}</Text>
    </View>
  );
}

// ── Documentos ─────────────────────────────────────────────────────────────────

function SingleDoc({ month, clientName, windows }: {
  month: Date;
  clientName: string;
  windows: Record<string, DeployWindowDay>;
}) {
  const counts = countStatuses(month, windows);
  const monthLabel = format(month, "MMMM yyyy", { locale: es }).replace(/^\w/, c => c.toUpperCase());
  return (
    <Document title={`Calendario ${clientName} ${monthLabel}`} author="Deploy Window Manager">
      <Page size="A4" style={S.page}>
        <Header title={clientName} month={month} />
        <StatsRow counts={counts} />
        <CalendarGrid month={month} windows={windows} />
        <Legend />
        <PromoDetail month={month} windows={windows} />
        <Footer title={`${clientName} · ${monthLabel}`} />
      </Page>
    </Document>
  );
}

function AllClientsDoc({ month, clientWindows, mergedWins }: {
  month: Date;
  clientWindows: { client: { name: string }; windows: Record<string, DeployWindowDay> }[];
  mergedWins: Record<string, DeployWindowDay>;
}) {
  const counts = countStatuses(month, mergedWins);
  const monthLabel = format(month, "MMMM yyyy", { locale: es }).replace(/^\w/, c => c.toUpperCase());

  // Per-client promo blocks
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  return (
    <Document title={`Calendario Todos los Clientes ${monthLabel}`} author="Deploy Window Manager">
      <Page size="A4" style={S.page}>
        <Header title="Todos los clientes" subtitle={`${clientWindows.length} clientes · estado más restrictivo`} month={month} />
        <StatsRow counts={counts} />
        <CalendarGrid month={month} windows={mergedWins} />
        <Legend />

        {/* Per-client promo detail */}
        {clientWindows.map(({ client, windows }) => {
          const withPromos = days
            .map(d => ({ key: format(d, "yyyy-MM-dd"), w: windows[format(d, "yyyy-MM-dd")] }))
            .filter(({ w }) => w && w.active_promotions.length > 0);
          if (withPromos.length === 0) return null;

          return (
            <View key={client.name} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#3b82f6" }} />
                <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: "#1e3a5f" }}>{client.name}</Text>
              </View>
              <View style={S.detailCols}>
                <View style={S.detailCol}>
                  {withPromos.slice(0, Math.ceil(withPromos.length / 2)).map(({ key, w }) => <DayBlock key={key} dateKey={key} w={w} />)}
                </View>
                <View style={S.detailCol}>
                  {withPromos.slice(Math.ceil(withPromos.length / 2)).map(({ key, w }) => <DayBlock key={key} dateKey={key} w={w} />)}
                </View>
              </View>
            </View>
          );
        })}

        <Footer title={`Todos los clientes · ${monthLabel}`} />
      </Page>
    </Document>
  );
}

// ── API pública ────────────────────────────────────────────────────────────────

export async function exportSingleToPDF(month: Date, clientName: string, windows: Record<string, DeployWindowDay>) {
  const blob = await pdf(<SingleDoc month={month} clientName={clientName} windows={windows} />).toBlob();
  download(blob, `calendario_${clientName}_${format(month, "yyyy-MM")}.pdf`);
}

export async function exportAllToPDF(
  month: Date,
  clientWindows: { client: { name: string }; windows: Record<string, DeployWindowDay> }[],
  mergedWins: Record<string, DeployWindowDay>,
) {
  const blob = await pdf(<AllClientsDoc month={month} clientWindows={clientWindows} mergedWins={mergedWins} />).toBlob();
  download(blob, `calendario_todos_${format(month, "yyyy-MM")}.pdf`);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
