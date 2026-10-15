import { describe, it, expect } from "vitest";
import {
  STATUS_COLORS,
  buildCapacityWorkbookData,
  buildPdfModel,
  exportFileName,
  type CapacityExportMeta,
} from "../features/capacity/export/exportModel";
import { sampleData, sampleReport } from "./capacityFixtures";

const META: CapacityExportMeta = { generatedAt: "2026-10-15T15:00:00.000Z", filters: { country: "Ecuador" } };

function sheetOf(name: string, meta: CapacityExportMeta = META) {
  const s = buildCapacityWorkbookData(sampleData(), meta).find((x) => x.name === name);
  if (!s) throw new Error(`Falta la hoja ${name}`);
  return s;
}

describe("buildCapacityWorkbookData", () => {
  it("arma las cinco hojas en orden", () => {
    expect(buildCapacityWorkbookData(sampleData(), META).map((s) => s.name)).toEqual([
      "Capacity", "Estado", "Horas", "Detalle", "Parámetros",
    ]);
  });

  it("Capacity: porcentajes como números, null vacío, y filas Equipo y conteos", () => {
    const rows = sheetOf("Capacity").rows;
    expect(rows[0]).toEqual(["Consultor", "País", "Ciudad", "ene 26 (%)", "feb 26 (%)", "Periodo (%)"]);
    // Orden alfabético: Ana antes que Beto.
    expect(rows[1]).toEqual(["Ana Pérez", "Ecuador", "Quito", 120, 75, 97.5]);
    expect(rows[2]).toEqual(["Beto Ruiz", "Colombia", "", null, 50, 50]);
    expect(rows[3]).toEqual(["Equipo", "", "", 120, 62.5, 81.7]);
    expect(rows[4]).toEqual(["# Sobreasignados", "", "", 1, 0, 1]);
    expect(rows[5]).toEqual(["# Subutilizados", "", "", 0, 1, 1]);
    expect(typeof rows[1][3]).toBe("number");
  });

  it("Estado: el estado va en texto SOBRE / OK / SUB", () => {
    const rows = sheetOf("Estado").rows;
    expect(rows[1]).toEqual(["Ana Pérez", "Ecuador", "Quito", "SOBRE", "OK", "OK"]);
    expect(rows[2]).toEqual(["Beto Ruiz", "Colombia", "", "—", "SUB", "SUB"]);
    expect(rows[3].slice(3)).toEqual(["SOBRE", "SUB", "OK"]);
  });

  it("Horas: capacidad, asignadas y disponibles por consultor y para el equipo", () => {
    const rows = sheetOf("Horas").rows;
    expect(rows[0]).toEqual(["Consultor", "País", "Ciudad", "Métrica", "ene 26", "feb 26", "Periodo"]);
    expect(rows[1]).toEqual(["Ana Pérez", "Ecuador", "Quito", "Capacidad (h)", 160, 160, 320]);
    expect(rows[2].slice(3)).toEqual(["Asignadas (h)", 192, 120, 312]);
    expect(rows[3].slice(3)).toEqual(["Disponibles (h)", -32, 40, 8]);
    expect(rows[rows.length - 1].slice(0, 4)).toEqual(["Equipo", "", "", "Disponibles (h)"]);
    // 2 consultores x 3 métricas + 3 del equipo + encabezado
    expect(rows).toHaveLength(1 + 6 + 3);
  });

  it("Detalle: una fila por asignación con certeza, interno, horas por mes, total e incluida", () => {
    const rows = sheetOf("Detalle").rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      "Consultor", "Proyecto", "Cliente", "Certeza", "Interno", "h/sem", "ene 26", "feb 26", "Total (h)", "Incluida",
    ]);
    expect(rows[1]).toEqual(["Ana Pérez", "Proyecto Alfa", "Cliente SA", "Confirmada", "No", 40, 192, 120, 312, "Sí"]);
    expect(rows[2]).toEqual(["Ana Pérez", "Proyecto Beta", "", "Probable", "Sí", 10, 0, 40.5, 40.5, "No"]);
  });

  it("Detalle sin asignaciones deja un aviso en vez de una hoja muda", () => {
    const data = sampleData();
    data.consultants = data.consultants.map((c) => ({ ...c, assignments: undefined }));
    const rows = buildCapacityWorkbookData(data, META).find((s) => s.name === "Detalle")!.rows;
    expect(rows[1]).toEqual(["Sin asignaciones en el periodo."]);
  });

  it("Parámetros: periodo, probables, internos, filtros, umbrales y avisos", () => {
    const map = new Map(sheetOf("Parámetros").rows.map((r) => [r[0], r[1]]));
    expect(map.get("Periodo")).toBe("2026-01 a 2026-02");
    expect(map.get("Asignaciones probables")).toBe("Solo confirmadas");
    expect(map.get("Proyectos internos")).toBe("Incluidos");
    expect(map.get("Filtros")).toBe("país Ecuador");
    expect(map.get("Umbral de subutilización (%)")).toBe(70);
    expect(map.get("Umbral de sobreasignación (%)")).toBe(100);
    expect(String(map.get("Aviso 1"))).toContain("Feriados de Ecuador 2026 sin confirmar");
    expect(map.has("Estado")).toBe(false);
  });

  it("Parámetros de un reporte oficial anulado incluye título, autor, ANULADO y el motivo", () => {
    const report = sampleReport({
      revokedAt: "2026-10-16T15:00:00.000Z",
      revokedBy: "otro@synaptica.com",
      revokeReason: "Datos de feriados incorrectos",
    });
    const map = new Map(sheetOf("Parámetros", { ...META, report }).rows.map((r) => [r[0], r[1]]));
    expect(map.get("Reporte oficial")).toBe(report.title);
    expect(map.get("Publicado por")).toBe("admin@synaptica.com");
    expect(map.get("Estado")).toBe("ANULADO");
    expect(map.get("Anulado por")).toBe("otro@synaptica.com");
    expect(map.get("Motivo de la anulación")).toBe("Datos de feriados incorrectos");
  });

  it("un reporte vigente figura como Vigente", () => {
    const map = new Map(sheetOf("Parámetros", { ...META, report: sampleReport() }).rows.map((r) => [r[0], r[1]]));
    expect(map.get("Estado")).toBe("Vigente");
    expect(map.has("Anulado por")).toBe(false);
  });

  it("calcula anchos de columna acotados", () => {
    const s = sheetOf("Capacity");
    expect(s.widths).toHaveLength(s.rows[0].length);
    expect(Math.min(...s.widths)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...s.widths)).toBeLessThanOrEqual(44);
  });
});

describe("exportFileName", () => {
  it("usa capacity_<from>_<to> para la vista actual y reporte-oficial_<id> para un reporte", () => {
    expect(exportFileName(sampleData(), META, "xlsx")).toBe("capacity_2026-01_2026-02.xlsx");
    expect(exportFileName(sampleData(), { ...META, report: sampleReport() }, "pdf")).toBe("reporte-oficial_rep1.pdf");
  });
});

describe("buildPdfModel", () => {
  it("colorea cada celda del mapa de calor con el color de su status", () => {
    const model = buildPdfModel(sampleData(), META);
    const ana = model.heatmap.rows[0];
    expect(ana[0].text).toBe("Ana Pérez");
    expect(ana[2]).toMatchObject({ text: "120%", fill: STATUS_COLORS.OVER.bg, color: STATUS_COLORS.OVER.text });
    expect(ana[3]).toMatchObject({ text: "75%", fill: STATUS_COLORS.OK.bg, color: STATUS_COLORS.OK.text });
    const beto = model.heatmap.rows[1];
    expect(beto[3]).toMatchObject({ text: "50%", fill: STATUS_COLORS.UNDER.bg });
  });

  it("muestra — con el color neutro cuando el porcentaje es null", () => {
    const beto = buildPdfModel(sampleData(), META).heatmap.rows[1];
    expect(beto[2]).toMatchObject({ text: "—", fill: STATUS_COLORS.NONE.bg });
  });

  it("los colores replican los tokens claros --cap-* de App.css", () => {
    expect(STATUS_COLORS.OVER.bg).toEqual([0xfb, 0xe3, 0xec]);
    expect(STATUS_COLORS.OK.bg).toEqual([0xe4, 0xf3, 0xd3]);
    expect(STATUS_COLORS.UNDER.bg).toEqual([0xfd, 0xec, 0xc8]);
  });

  it("incluye la fila Equipo y los conteos", () => {
    const { foot, head } = buildPdfModel(sampleData(), META).heatmap;
    expect(head).toEqual(["Consultor", "País", "ene 26", "feb 26", "Periodo"]);
    expect(foot[0].map((c) => c.text)).toEqual(["Equipo", "", "120%", "63%", "82%"]);
    expect(foot[0][3].fill).toEqual(STATUS_COLORS.UNDER.bg);
    expect(foot[1].map((c) => c.text)).toEqual(["Sobreasignados", "", "1", "0", "1"]);
    expect(foot[2].map((c) => c.text)).toEqual(["Subutilizados", "", "0", "1", "1"]);
  });

  it("serie del gráfico: una barra por mes con su color y los umbrales", () => {
    const { chart } = buildPdfModel(sampleData(), META);
    expect(chart.bars.map((b) => [b.label, b.value, b.text])).toEqual([
      ["ene 26", 120, "120%"],
      ["feb 26", 62.5, "63%"],
    ]);
    expect(chart.bars[0].color).toEqual(STATUS_COLORS.OVER.solid);
    expect(chart.bars[1].color).toEqual(STATUS_COLORS.UNDER.solid);
    expect(chart.underPct).toBe(70);
    expect(chart.overPct).toBe(100);
    expect(chart.max).toBeGreaterThanOrEqual(120);
  });

  it("una barra sin dato conserva null y se pinta en gris", () => {
    const data = sampleData();
    data.team.months[0] = { ...data.team.months[0], pct: null, status: null };
    const bar = buildPdfModel(data, META).chart.bars[0];
    expect(bar.value).toBeNull();
    expect(bar.text).toBe("—");
    expect(bar.color).toEqual(STATUS_COLORS.NONE.solid);
  });

  it("encabezado de la vista actual: título, periodo y alcance; sin marca de anulado", () => {
    const { header, kpis } = buildPdfModel(sampleData(), META);
    expect(header.title).toBe("Informe de Capacity");
    expect(header.lines[0]).toContain("ene 26 a feb 26");
    expect(header.lines[0]).toContain("Solo confirmados");
    expect(header.lines[1]).toBe("Filtros: país Ecuador");
    expect(header.revoked).toBe(false);
    expect(kpis[0]).toEqual({ label: "Utilización", value: "82%" });
  });

  it("con probables el encabezado lo dice", () => {
    const data = sampleData();
    data.includeProbables = true;
    expect(buildPdfModel(data, META).header.lines[0]).toContain("Incluye probables");
  });

  it("un reporte anulado marca ANULADO y trae la línea con el motivo", () => {
    const report = sampleReport({ revokedAt: "2026-10-16T15:00:00.000Z", revokedBy: "otro@synaptica.com", revokeReason: "Error de datos" });
    const { header } = buildPdfModel(sampleData(), { ...META, report });
    expect(header.title).toBe(report.title);
    expect(header.revoked).toBe(true);
    expect(header.revokedLine).toContain("Motivo: Error de datos");
  });

  it("formatea con coma decimal es-CO las horas del detalle y avisa de la no incluida", () => {
    const { detail } = buildPdfModel(sampleData(), META);
    expect(detail.groups).toHaveLength(1); // Beto no tiene asignaciones
    const [alfa, beta] = detail.groups[0].rows;
    expect(alfa).toEqual(["Proyecto Alfa", "Cliente SA", "Confirmada", "40", "192", "120", "312"]);
    expect(beta[0]).toBe("Proyecto Beta (no incluida)");
    expect(beta[1]).toBe("—");
    expect(beta[2]).toBe("Probable, interno");
    expect(beta[5]).toBe("40,5");
  });

  it("incluye leyenda con umbrales y avisos", () => {
    const model = buildPdfModel(sampleData(), META);
    expect(model.thresholdsText).toContain("70%");
    expect(model.legend.map((l) => l.text)[0]).toBe("Sobreasignado (más de 100%)");
    expect(model.warnings[0]).toContain("Feriados de Ecuador 2026");
  });
});
