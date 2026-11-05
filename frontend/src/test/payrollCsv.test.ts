import { describe, it, expect } from "vitest";
import { buildPayrollCsv, PAYROLL_CSV_HEADERS } from "../features/extraHours/payrollCsv";
import type { PayrollConsolidationRow } from "../services/api";

const fila: PayrollConsolidationRow = {
  consultantName: 'Ana "Pérez"',
  identification: "123",
  country: "Colombia",
  currency: "COP",
  totalHours: 5,
  diurnal: 3,
  nocturnal: 2,
  diurnalHoliday: 0,
  nocturnalHoliday: 0,
  totalAmountLocal: 100000,
  totalAmountUSD: 25,
  realHours: 3,
  realAmountLocal: 60000,
  legacyHours: 2,
  legacyAmountLocal: 40000,
  legacy: true,
};

describe("buildPayrollCsv", () => {
  it("incluye las columnas nuevas con encabezados en español", () => {
    expect(PAYROLL_CSV_HEADERS.slice(-5)).toEqual([
      "Horas reales",
      "Valor real (local)",
      "Horas solicitudes anteriores",
      "Valor solicitudes anteriores (local)",
      "Incluye anteriores",
    ]);
  });

  it("arma las filas y escapa comillas", () => {
    const [, linea] = buildPayrollCsv([fila]).split("\n");
    expect(linea).toBe('"Ana ""Pérez""","123","Colombia","COP",5,3,2,0,0,100000.00,25.00,3,60000.00,2,40000.00,Sí');
  });

  it("rellena con ceros cuando el backend no manda los campos nuevos", () => {
    const { realHours, realAmountLocal, legacyHours, legacyAmountLocal, legacy, ...base } = fila;
    void realHours; void realAmountLocal; void legacyHours; void legacyAmountLocal; void legacy;
    const [, linea] = buildPayrollCsv([base]).split("\n");
    expect(linea.endsWith(",0,0.00,0,0.00,No")).toBe(true);
  });
});
