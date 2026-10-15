import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportCapacityExcel, exportCapacityPdf } from "../features/capacity/export/exportRenderers";
import { sampleData, sampleReport } from "./capacityFixtures";

// Humo de los renderizadores: se ejecutan de verdad (xlsx y jsPDF reales) pero sin escribir archivos.
const writeFile = vi.fn();
vi.mock("xlsx", async () => {
  const actual = await vi.importActual<typeof import("xlsx")>("xlsx");
  return { ...actual, writeFile: (...a: unknown[]) => writeFile(...a) };
});

// jsPDF real, pero sin descargar: se captura el nombre con que se intenta guardar.
const pdfSave = vi.fn();
vi.mock("jspdf", async () => {
  const actual = await vi.importActual<typeof import("jspdf")>("jspdf");
  class TestPdf extends actual.default {
    save = ((name?: string) => {
      pdfSave(name);
      return this;
    }) as unknown as InstanceType<typeof actual.default>["save"];
  }
  return { ...actual, default: TestPdf, jsPDF: TestPdf };
});

const META = { generatedAt: "2026-10-15T15:00:00.000Z", filters: { country: "Ecuador" } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportCapacityExcel", () => {
  it("escribe un libro con las cinco hojas y devuelve el nombre del archivo", async () => {
    const name = await exportCapacityExcel(sampleData(), META);
    expect(name).toBe("capacity_2026-01_2026-02.xlsx");
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [wb, file] = writeFile.mock.calls[0] as [{ SheetNames: string[] }, string];
    expect(file).toBe("capacity_2026-01_2026-02.xlsx");
    expect(wb.SheetNames).toEqual(["Capacity", "Estado", "Horas", "Detalle", "Parámetros"]);
  });

  it("un reporte oficial se llama reporte-oficial_<id>.xlsx", async () => {
    const report = sampleReport();
    expect(await exportCapacityExcel(report.payload, { ...META, report })).toBe("reporte-oficial_rep1.xlsx");
  });
});

describe("exportCapacityPdf", () => {
  it("genera el PDF completo (vigente) sin errores", async () => {
    const name = await exportCapacityPdf(sampleData(), META);
    expect(name).toBe("capacity_2026-01_2026-02.pdf");
    expect(pdfSave).toHaveBeenCalledWith("capacity_2026-01_2026-02.pdf");
  });

  it("genera el PDF de un reporte anulado", async () => {
    const report = sampleReport({ revokedAt: "2026-10-16T15:00:00.000Z", revokedBy: "x@y.com", revokeReason: "Error de datos" });
    expect(await exportCapacityPdf(report.payload, { ...META, report })).toBe("reporte-oficial_rep1.pdf");
  });
});
