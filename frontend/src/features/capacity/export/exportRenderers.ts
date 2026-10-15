import type { CellDef, RowInput } from "jspdf-autotable";
import type { MonthlyCapacity } from "../../../services/api";
import {
  STATUS_COLORS,
  buildCapacityWorkbookData,
  buildPdfModel,
  exportFileName,
  type CapacityExportMeta,
  type PdfCell,
  type Rgb,
} from "./exportModel";

/**
 * Renderizadores de la exportación (CONTRATO §5.5). No arman datos: solo pintan lo que
 * entregan `buildCapacityWorkbookData` y `buildPdfModel`. `xlsx` y `jspdf` se cargan con
 * import dinámico para no engordar el bundle inicial.
 */

export async function exportCapacityExcel(data: MonthlyCapacity, meta: CapacityExportMeta): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of buildCapacityWorkbookData(data, meta)) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws["!cols"] = s.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const fileName = exportFileName(data, meta, "xlsx");
  XLSX.writeFile(wb, fileName);
  return fileName;
}

const NAVY: Rgb = [39, 39, 80];
const RED: Rgb = [168, 25, 76];
const GREY: Rgb = [107, 114, 128];
const GRID: Rgb = [214, 216, 224];
const MARGIN = 10;

export async function exportCapacityPdf(data: MonthlyCapacity, meta: CapacityExportMeta): Promise<string> {
  const { default: JsPdf } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const model = buildPdfModel(data, meta);

  const doc = new JsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bottom = pageH - 14;
  const finalY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? MARGIN;

  // ── Encabezado ──────────────────────────────────────────────────────────────
  let y = 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...NAVY);
  doc.text(model.header.title, MARGIN, y);
  if (model.header.revoked) {
    doc.setFontSize(22);
    doc.setTextColor(...RED);
    doc.text("ANULADO", pageW - MARGIN, y, { align: "right" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  for (const line of model.header.lines) {
    y += 5;
    doc.text(line, MARGIN, y);
  }
  if (model.header.note) {
    for (const l of doc.splitTextToSize(`Nota: ${model.header.note}`, pageW - 2 * MARGIN) as string[]) {
      y += 5;
      doc.text(l, MARGIN, y);
    }
  }
  if (model.header.revokedLine) {
    doc.setTextColor(...RED);
    doc.setFont("helvetica", "bold");
    for (const l of doc.splitTextToSize(model.header.revokedLine, pageW - 2 * MARGIN) as string[]) {
      y += 5;
      doc.text(l, MARGIN, y);
    }
    doc.setFont("helvetica", "normal");
  }

  // ── KPIs en una línea ───────────────────────────────────────────────────────
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(model.kpis.map((k) => `${k.label}: ${k.value}`).join("   |   "), MARGIN, y);
  doc.setFont("helvetica", "normal");

  // ── Mapa de calor + fila Equipo ─────────────────────────────────────────────
  const monthCols = model.heatmap.head.length - 3;
  const fontSize = monthCols > 18 ? 5.5 : monthCols > 12 ? 6.5 : 8;
  const body = model.heatmap.rows;
  const foot = model.heatmap.foot;
  autoTable(doc, {
    startY: y + 3,
    margin: { left: MARGIN, right: MARGIN, bottom: 14 },
    head: [model.heatmap.head],
    body: body.map((r) => r.map((c) => c.text)),
    foot: foot.map((r) => r.map((c) => c.text)),
    showFoot: "lastPage",
    styles: { fontSize, cellPadding: 1.2, lineColor: GRID, lineWidth: 0.1, overflow: "linebreak" },
    headStyles: { fillColor: NAVY, textColor: 255, halign: "center" },
    footStyles: { fillColor: [255, 255, 255], textColor: [40, 40, 40], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 30 } },
    // El color de cada celda sale del `status` del modelo: la misma paleta clara de la app.
    didParseCell: (hook) => {
      const rows: PdfCell[][] | null = hook.section === "body" ? body : hook.section === "foot" ? foot : null;
      const cell = rows?.[hook.row.index]?.[hook.column.index];
      if (!cell) return;
      if (cell.fill) hook.cell.styles.fillColor = cell.fill;
      if (cell.color) hook.cell.styles.textColor = cell.color;
      if (cell.bold) hook.cell.styles.fontStyle = "bold";
      if (hook.column.index >= 2) hook.cell.styles.halign = "center";
    },
  });

  // ── Gráfico de utilización mensual (primitivas de jsPDF) ────────────────────
  const chartH = 62;
  y = finalY() + 8;
  if (y + chartH + 30 > bottom) {
    doc.addPage();
    y = 16;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("Utilización del equipo por mes", MARGIN, y);
  doc.setFont("helvetica", "normal");

  const plotX = MARGIN + 12;
  const plotW = pageW - MARGIN - plotX;
  const plotTop = y + 6;
  const plotH = 40;
  const { max, bars, underPct, overPct } = model.chart;
  const yOf = (pct: number) => plotTop + plotH - (Math.min(pct, max) / max) * plotH;

  doc.setFontSize(7);
  doc.setLineWidth(0.1);
  for (let t = 0; t <= max; t += max > 120 ? 40 : 20) {
    doc.setDrawColor(...GRID);
    doc.line(plotX, yOf(t), plotX + plotW, yOf(t));
    doc.setTextColor(...GREY);
    doc.text(`${t}%`, plotX - 2, yOf(t) + 1, { align: "right" });
  }
  // Líneas de umbral, punteadas, detrás de las columnas: si se dibujan
  // después, tachan la etiqueta de una columna que queda justo en el umbral.
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([1.6, 1.2], 0);
  doc.setDrawColor(...STATUS_COLORS.UNDER.text);
  doc.line(plotX, yOf(underPct), plotX + plotW, yOf(underPct));
  doc.setDrawColor(...STATUS_COLORS.OVER.solid);
  doc.line(plotX, yOf(overPct), plotX + plotW, yOf(overPct));
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.1);
  const slot = plotW / Math.max(1, bars.length);
  const barW = Math.min(slot * 0.62, 16);
  bars.forEach((b, i) => {
    const x = plotX + i * slot + (slot - barW) / 2;
    if (b.value !== null) {
      doc.setFillColor(...b.color);
      const top = yOf(b.value);
      doc.rect(x, top, barW, plotTop + plotH - top, "F");
      // Fondo blanco bajo la etiqueta para que la línea de umbral no la cruce.
      const ancho = doc.getTextWidth(b.text) + 1.6;
      doc.setFillColor(255, 255, 255);
      doc.rect(x + barW / 2 - ancho / 2, top - 4.2, ancho, 3.6, "F");
      doc.setTextColor(40, 40, 40);
      doc.text(b.text, x + barW / 2, top - 1.2, { align: "center" });
    } else {
      doc.setTextColor(...GREY);
      doc.text("—", x + barW / 2, plotTop + plotH - 1.5, { align: "center" });
    }
    doc.setTextColor(...GREY);
    doc.text(b.label, x + barW / 2, plotTop + plotH + 4, { align: "center" });
  });

  // ── Leyenda y umbrales ──────────────────────────────────────────────────────
  y = plotTop + plotH + 10;
  let lx = MARGIN;
  doc.setFontSize(8);
  for (const item of model.legend) {
    doc.setFillColor(...item.color);
    doc.setDrawColor(...GRID);
    doc.rect(lx, y - 3, 4, 4, "FD");
    doc.setTextColor(60, 60, 60);
    doc.text(item.text, lx + 6, y);
    lx += 8 + doc.getTextWidth(item.text) + 6;
  }
  y += 5;
  doc.setTextColor(...GREY);
  doc.text(model.thresholdsText, MARGIN, y);

  // ── Avisos ──────────────────────────────────────────────────────────────────
  if (model.warnings.length > 0) {
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Avisos", MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    for (const w of model.warnings) {
      for (const l of doc.splitTextToSize(`- ${w}`, pageW - 2 * MARGIN) as string[]) {
        y += 4.5;
        if (y > bottom) {
          doc.addPage();
          y = 16;
        }
        doc.text(l, MARGIN, y);
      }
    }
  }

  // ── Detalle por consultor, en las páginas siguientes ───────────────────────
  if (model.detail.groups.length > 0) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text("Detalle por consultor", MARGIN, 14);
    const cols = model.detail.head.length;
    const detailBody: RowInput[] = [];
    for (const g of model.detail.groups) {
      const groupCell: CellDef = {
        content: g.title,
        colSpan: cols,
        styles: { fillColor: [238, 239, 245], textColor: NAVY, fontStyle: "bold" },
      };
      detailBody.push([groupCell]);
      for (const r of g.rows) detailBody.push(r);
    }
    autoTable(doc, {
      startY: 18,
      margin: { left: MARGIN, right: MARGIN, bottom: 14 },
      head: [model.detail.head],
      body: detailBody,
      styles: { fontSize: cols > 20 ? 5.5 : cols > 14 ? 6.5 : 8, cellPadding: 1.1, lineColor: GRID, lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: 255 },
      didParseCell: (hook) => {
        if (hook.section === "body" && hook.column.index >= 3) hook.cell.styles.halign = "right";
      },
    });
  }

  // ── Pie: marca de anulado y "Página X de Y" ─────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    doc.text("Synatrack · Capacity mensual", MARGIN, pageH - 6);
    if (model.header.revoked) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...RED);
      doc.text("ANULADO", pageW / 2, pageH - 6, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GREY);
    }
    doc.text(`Página ${i} de ${total}`, pageW - MARGIN, pageH - 6, { align: "right" });
  }

  const fileName = exportFileName(data, meta, "pdf");
  doc.save(fileName);
  return fileName;
}
