import type {
  CapacityReportFilters,
  CapacityReportSummary,
  CapacityStatus,
  MonthlyCapacity,
  MonthlyCapacityCell,
  MonthlyCapacityPeriod,
} from "../../../services/api";
import {
  chartMax,
  formatHours,
  formatPct,
  monthHeader,
  sortConsultants,
  warningMessages,
} from "../monthly/monthlyUtils";

/**
 * Armado PURO de lo que se exporta (CONTRATO §5.5): sin DOM, sin xlsx ni jsPDF.
 * Los renderizadores (`exportRenderers.ts`) solo pintan lo que sale de aquí, de modo que
 * filas, colores y nombres se prueban sin abrir un archivo.
 *
 * Decisión de formato numérico:
 *  - Excel: números REALES (no texto). Los porcentajes van como número de % con 1 decimal
 *    (57.1 significa 57,1 %) y la cabecera lleva "(%)"; las horas, como número con 1 decimal.
 *    Se eligió así y no 0.571 + formato % porque SheetJS CE no aplica formatos de forma fiable
 *    y el Excel del cliente se lee en puntos porcentuales. Sin capacidad (pct null) = celda vacía.
 *  - PDF: texto ya formateado en es-CO (coma decimal) con los helpers de la pantalla.
 */

export type ExcelCell = string | number | null;

export type ExportReportInfo = Pick<
  CapacityReportSummary,
  "id" | "title" | "note" | "publishedBy" | "publishedAt" | "revokedAt" | "revokedBy" | "revokeReason"
>;

export type CapacityExportMeta = {
  /** Instante de generación, ISO. Se recibe de fuera para que las funciones sigan siendo puras. */
  generatedAt: string;
  /** Filtros de país, ciudad y empresa que produjeron los datos. */
  filters?: CapacityReportFilters;
  /** Presente solo si se exporta un reporte oficial abierto. */
  report?: ExportReportInfo;
};

export type ExcelSheet = { name: string; rows: ExcelCell[][]; widths: number[] };

// ─── Utilidades de texto ──────────────────────────────────────────────────────

const DATE_TIME = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

/** Fecha y hora en Bogotá/Quito; si el texto no es una fecha válida, lo devuelve tal cual. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_TIME.format(d);
}

export const STATUS_SHORT: Record<CapacityStatus, string> = { OVER: "SOBRE", OK: "OK", UNDER: "SUB" };

/** Texto corto del estado para la hoja "Estado"; "—" si no hay dato. */
export function statusShort(status: CapacityStatus | null): string {
  return status ? STATUS_SHORT[status] : "—";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pctNumber(pct: number | null): number | null {
  return pct === null ? null : round1(pct);
}

/** Nombre del archivo: `capacity_<from>_<to>.<ext>` o `reporte-oficial_<id>.<ext>`. */
export function exportFileName(data: MonthlyCapacity, meta: CapacityExportMeta, ext: "xlsx" | "pdf"): string {
  return meta.report ? `reporte-oficial_${meta.report.id}.${ext}` : `capacity_${data.from}_${data.to}.${ext}`;
}

export function filtersText(filters: CapacityReportFilters | undefined): string {
  const parts: string[] = [];
  if (filters?.country) parts.push(`país ${filters.country}`);
  if (filters?.city) parts.push(`ciudad ${filters.city}`);
  if (filters?.company) parts.push(`empresa ${filters.company}`);
  return parts.length > 0 ? parts.join(", ") : "Sin filtros";
}

function periodText(data: MonthlyCapacity): string {
  return `${monthHeader(data.from)} a ${monthHeader(data.to)}`;
}

function scopeText(data: MonthlyCapacity): string {
  return data.includeProbables ? "Incluye probables" : "Solo confirmados";
}

function internalText(data: MonthlyCapacity): string {
  return data.internal === "exclude" ? "Proyectos internos excluidos" : "Proyectos internos incluidos";
}

function certaintyLabel(c: "CONFIRMED" | "PROBABLE"): string {
  return c === "CONFIRMED" ? "Confirmada" : "Probable";
}

function yesNo(v: boolean): string {
  return v ? "Sí" : "No";
}

function placeLabel(country: string | null, city: string | null): string {
  return [country, city].filter(Boolean).join(" · ");
}

/** Ancho de columna (caracteres) según el contenido, acotado para que no se desborde. */
export function columnWidths(rows: ExcelCell[][], min = 8, max = 44): number[] {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths: number[] = [];
  for (let c = 0; c < cols; c += 1) {
    let w = min;
    for (const r of rows) {
      const v = r[c];
      if (v !== null && v !== undefined) w = Math.max(w, String(v).length + 2);
    }
    widths.push(Math.min(w, max));
  }
  return widths;
}

function sheet(name: string, rows: ExcelCell[][]): ExcelSheet {
  return { name, rows, widths: columnWidths(rows) };
}

// ─── Excel ────────────────────────────────────────────────────────────────────

/** Hojas del libro: Capacity, Estado, Horas, Detalle y Parámetros (CONTRATO §5.5). */
export function buildCapacityWorkbookData(data: MonthlyCapacity, meta: CapacityExportMeta): ExcelSheet[] {
  const consultants = sortConsultants(data.consultants, "name", "asc");
  const monthHeads = data.months.map(monthHeader);

  // Capacity: % por mes (números) + periodo, fila Equipo y los dos conteos.
  const capacityRows: ExcelCell[][] = [
    ["Consultor", "País", "Ciudad", ...monthHeads.map((h) => `${h} (%)`), "Periodo (%)"],
    ...consultants.map((c): ExcelCell[] => [
      c.fullName,
      c.country ?? "",
      c.city ?? "",
      ...c.months.map((m) => pctNumber(m.pct)),
      pctNumber(c.period.pct),
    ]),
    ["Equipo", "", "", ...data.team.months.map((m) => pctNumber(m.pct)), pctNumber(data.team.period.pct)],
    ["# Sobreasignados", "", "", ...data.team.months.map((m) => m.overCount), data.team.period.overCount],
    ["# Subutilizados", "", "", ...data.team.months.map((m) => m.underCount), data.team.period.underCount],
  ];

  // Estado: la misma matriz, con el estado en texto (SheetJS CE no escribe colores).
  const stateRows: ExcelCell[][] = [
    ["Consultor", "País", "Ciudad", ...monthHeads, "Periodo"],
    ...consultants.map((c): ExcelCell[] => [
      c.fullName,
      c.country ?? "",
      c.city ?? "",
      ...c.months.map((m) => statusShort(m.status)),
      statusShort(c.period.status),
    ]),
    ["Equipo", "", "", ...data.team.months.map((m) => statusShort(m.status)), statusShort(data.team.period.status)],
    ["# Sobreasignados", "", "", ...data.team.months.map((m) => m.overCount), data.team.period.overCount],
    ["# Subutilizados", "", "", ...data.team.months.map((m) => m.underCount), data.team.period.underCount],
  ];

  // Horas: capacidad, asignadas y disponibles por mes (3 filas por consultor).
  const hourMetrics: [string, (c: MonthlyCapacityCell | MonthlyCapacityPeriod) => number][] = [
    ["Capacidad (h)", (c) => round1(c.capacityHours)],
    ["Asignadas (h)", (c) => round1(c.assignedHours)],
    ["Disponibles (h)", (c) => round1(c.availableHours)],
  ];
  const hourRows: ExcelCell[][] = [["Consultor", "País", "Ciudad", "Métrica", ...monthHeads, "Periodo"]];
  for (const c of consultants) {
    for (const [label, pick] of hourMetrics) {
      hourRows.push([c.fullName, c.country ?? "", c.city ?? "", label, ...c.months.map(pick), pick(c.period)]);
    }
  }
  for (const [label, pick] of hourMetrics) {
    hourRows.push(["Equipo", "", "", label, ...data.team.months.map(pick), pick(data.team.period)]);
  }

  // Detalle: una fila por consultor y asignación.
  const detailRows: ExcelCell[][] = [
    ["Consultor", "Proyecto", "Cliente", "Certeza", "Interno", "h/sem", ...monthHeads, "Total (h)", "Incluida"],
  ];
  for (const c of consultants) {
    for (const a of c.assignments ?? []) {
      const byMonth = new Map(a.months.map((x) => [x.month, x.hours]));
      detailRows.push([
        c.fullName,
        a.projectName,
        a.client ?? "",
        certaintyLabel(a.certainty),
        yesNo(a.isInternal),
        a.hoursPerWeek,
        ...data.months.map((m) => round1(byMonth.get(m) ?? 0)),
        round1(a.totalHours),
        yesNo(a.included),
      ]);
    }
  }
  if (detailRows.length === 1) detailRows.push(["Sin asignaciones en el periodo."]);

  return [
    sheet("Capacity", capacityRows),
    sheet("Estado", stateRows),
    sheet("Horas", hourRows),
    sheet("Detalle", detailRows),
    sheet("Parámetros", buildParameterRows(data, meta)),
  ];
}

function buildParameterRows(data: MonthlyCapacity, meta: CapacityExportMeta): ExcelCell[][] {
  const rows: ExcelCell[][] = [["Parámetro", "Valor"]];
  const r = meta.report;
  if (r) {
    rows.push(["Reporte oficial", r.title]);
    if (r.note) rows.push(["Nota", r.note]);
    rows.push(["Publicado por", r.publishedBy]);
    rows.push(["Publicado el", formatDateTime(r.publishedAt)]);
    rows.push(["Estado", r.revokedAt ? "ANULADO" : "Vigente"]);
    if (r.revokedAt) {
      rows.push(["Anulado por", r.revokedBy ?? "—"]);
      rows.push(["Anulado el", formatDateTime(r.revokedAt)]);
      rows.push(["Motivo de la anulación", r.revokeReason ?? "—"]);
    }
  }
  rows.push(["Periodo", `${data.from} a ${data.to}`]);
  rows.push(["Asignaciones probables", data.includeProbables ? "Incluidas" : "Solo confirmadas"]);
  rows.push(["Proyectos internos", data.internal === "exclude" ? "Excluidos" : "Incluidos"]);
  rows.push(["Filtros", filtersText(meta.filters)]);
  rows.push(["Umbral de subutilización (%)", data.settings.underThresholdPct]);
  rows.push(["Umbral de sobreasignación (%)", data.settings.overThresholdPct]);
  rows.push(["Consultores", data.kpis.consultantCount]);
  rows.push(["Generado", formatDateTime(meta.generatedAt)]);
  const avisos = warningMessages(data.warnings, data);
  if (avisos.length === 0) rows.push(["Avisos", "Ninguno"]);
  else avisos.forEach((a, i) => rows.push([`Aviso ${i + 1}`, a]));
  return rows;
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export type Rgb = [number, number, number];

/** Réplica de los tokens CLAROS `--cap-*` de `App.css`. El PDF no sigue el tema oscuro. */
export const STATUS_COLORS: Record<CapacityStatus | "NONE", { bg: Rgb; text: Rgb; solid: Rgb }> = {
  OVER: { bg: [251, 227, 236], text: [125, 16, 57], solid: [168, 25, 76] },
  OK: { bg: [228, 243, 211], text: [44, 84, 16], solid: [107, 180, 45] },
  UNDER: { bg: [253, 236, 200], text: [110, 66, 0], solid: [241, 163, 35] },
  NONE: { bg: [246, 247, 249], text: [107, 114, 128], solid: [229, 230, 236] },
};

export function statusColors(status: CapacityStatus | null) {
  return STATUS_COLORS[status ?? "NONE"];
}

export type PdfCell = { text: string; fill?: Rgb; color?: Rgb; bold?: boolean };

export type PdfModel = {
  header: {
    title: string;
    lines: string[];
    /** Nota del reporte oficial. */
    note: string | null;
    revoked: boolean;
    revokedLine: string | null;
  };
  kpis: { label: string; value: string }[];
  heatmap: { head: string[]; rows: PdfCell[][]; foot: PdfCell[][] };
  chart: {
    bars: { label: string; value: number | null; text: string; color: Rgb }[];
    max: number;
    underPct: number;
    overPct: number;
  };
  legend: { text: string; color: Rgb }[];
  thresholdsText: string;
  warnings: string[];
  detail: { head: string[]; groups: { title: string; rows: string[][] }[] };
};

function pctCell(cell: Pick<MonthlyCapacityPeriod, "pct" | "status">, bold = false): PdfCell {
  const c = statusColors(cell.status);
  return { text: formatPct(cell.pct), fill: c.bg, color: c.text, bold };
}

/** Modelo intermedio del PDF (CONTRATO §5.5): encabezado, KPIs, mapa de calor, gráfico, leyenda, avisos y detalle. */
export function buildPdfModel(data: MonthlyCapacity, meta: CapacityExportMeta): PdfModel {
  const r = meta.report;
  const consultants = sortConsultants(data.consultants, "name", "asc");
  const { underThresholdPct: under, overThresholdPct: over } = data.settings;

  const lines = [
    `Periodo: ${periodText(data)}  |  ${scopeText(data)}  |  ${internalText(data)}`,
    `Filtros: ${filtersText(meta.filters)}`,
  ];
  if (r) lines.push(`Publicado por ${r.publishedBy} el ${formatDateTime(r.publishedAt)}`);
  lines.push(`Generado: ${formatDateTime(meta.generatedAt)}`);

  const k = data.kpis;
  const kpis = [
    { label: "Utilización", value: formatPct(k.utilizationPct) },
    { label: "% facturable", value: formatPct(k.billablePct) },
    { label: "Sobreasignados (periodo)", value: String(k.overCount) },
    { label: "Subutilizados (periodo)", value: String(k.underCount) },
    { label: "Horas disponibles", value: formatHours(k.availableHours) },
    { label: "Consultores", value: String(k.consultantCount) },
  ];

  const heatRows: PdfCell[][] = consultants.map((c) => [
    { text: c.fullName },
    { text: placeLabel(c.country, c.city) || "sin país" },
    ...c.months.map((m) => pctCell(m)),
    pctCell(c.period, true),
  ]);
  const plain = (text: string): PdfCell => ({ text, bold: true });
  const foot: PdfCell[][] = [
    [
      plain("Equipo"),
      plain(""),
      ...data.team.months.map((m) => pctCell(m, true)),
      pctCell(data.team.period, true),
    ],
    [
      plain("Sobreasignados"),
      plain(""),
      ...data.team.months.map((m) => ({ text: String(m.overCount) })),
      { text: String(data.team.period.overCount), bold: true },
    ],
    [
      plain("Subutilizados"),
      plain(""),
      ...data.team.months.map((m) => ({ text: String(m.underCount) })),
      { text: String(data.team.period.underCount), bold: true },
    ],
  ];

  const detailGroups = consultants
    .filter((c) => (c.assignments?.length ?? 0) > 0)
    .map((c) => ({
      title: `${c.fullName} · ${c.country ?? "sin país"} · utilización del periodo ${formatPct(c.period.pct)}`,
      rows: (c.assignments ?? []).map((a) => {
        const byMonth = new Map(a.months.map((x) => [x.month, x.hours]));
        return [
          a.included ? a.projectName : `${a.projectName} (no incluida)`,
          a.client ?? "—",
          `${certaintyLabel(a.certainty)}${a.isInternal ? ", interno" : ""}`,
          formatHours(a.hoursPerWeek),
          ...data.months.map((m) => formatHours(byMonth.get(m) ?? 0)),
          formatHours(a.totalHours),
        ];
      }),
    }));

  return {
    header: {
      title: r ? r.title : "Informe de Capacity",
      lines,
      note: r?.note ?? null,
      revoked: Boolean(r?.revokedAt),
      revokedLine: r?.revokedAt
        ? `Anulado por ${r.revokedBy ?? "—"} el ${formatDateTime(r.revokedAt)}. Motivo: ${r.revokeReason ?? "—"}`
        : null,
    },
    kpis,
    heatmap: {
      head: ["Consultor", "País", ...data.months.map(monthHeader), "Periodo"],
      rows: heatRows,
      foot,
    },
    chart: {
      bars: data.team.months.map((m) => ({
        label: monthHeader(m.month),
        value: m.pct,
        text: formatPct(m.pct),
        color: statusColors(m.status).solid,
      })),
      max: chartMax(data.team.months.map((m) => m.pct), over),
      underPct: under,
      overPct: over,
    },
    legend: [
      { text: `Sobreasignado (más de ${over}%)`, color: STATUS_COLORS.OVER.bg },
      { text: `En rango (${under}% a ${over}%)`, color: STATUS_COLORS.OK.bg },
      { text: `Subutilizado (menos de ${under}%)`, color: STATUS_COLORS.UNDER.bg },
      { text: "Sin capacidad (—)", color: STATUS_COLORS.NONE.bg },
    ],
    thresholdsText: `Umbrales: subutilizado por debajo de ${under}%, sobreasignado por encima de ${over}%.`,
    warnings: warningMessages(data.warnings, data),
    detail: {
      head: ["Proyecto", "Cliente", "Tipo", "h/sem", ...data.months.map(monthHeader), "Total (h)"],
      groups: detailGroups,
    },
  };
}
