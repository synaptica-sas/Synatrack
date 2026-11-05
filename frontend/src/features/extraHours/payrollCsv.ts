import type { PayrollConsolidationRow } from "../../services/api";

export const PAYROLL_CSV_HEADERS = [
  "Consultor",
  "Identificación DNI/Cédula",
  "País",
  "Moneda",
  "Horas Totales",
  "Diurnas",
  "Nocturnas",
  "Festivas Diurnas",
  "Festivas Nocturnas",
  "Monto Local",
  "Monto USD",
  "Horas reales",
  "Valor real (local)",
  "Horas solicitudes anteriores",
  "Valor solicitudes anteriores (local)",
  "Incluye anteriores",
];

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const money = (v: number | undefined) => Number(v ?? 0).toFixed(2);

/** Arma el contenido del CSV de cierre de nómina (separador coma, comillas en textos). */
export function buildPayrollCsv(rows: PayrollConsolidationRow[]): string {
  const lines = rows.map((r) =>
    [
      quote(r.consultantName),
      quote(r.identification),
      quote(r.country),
      quote(r.currency),
      r.totalHours,
      r.diurnal,
      r.nocturnal,
      r.diurnalHoliday,
      r.nocturnalHoliday,
      money(r.totalAmountLocal),
      money(r.totalAmountUSD),
      Number(r.realHours ?? 0),
      money(r.realAmountLocal),
      Number(r.legacyHours ?? 0),
      money(r.legacyAmountLocal),
      r.legacy ? "Sí" : "No",
    ].join(","),
  );
  return [PAYROLL_CSV_HEADERS.join(","), ...lines].join("\n");
}
