/**
 * Decisión pura de las alertas de capacity (CONTRATO §5.3). No toca la base:
 *  - `calcularAlertasDeseadas` convierte el resultado de `computeMonthlyCapacity` en la lista de
 *    alertas que DEBERÍAN estar abiertas;
 *  - `planAlertSync` compara esa lista con las alertas abiertas y dice qué crear, actualizar y resolver.
 * La clave de una alerta es `(type, consultantId, metadata.month)`.
 */

export type TipoAlertaCapacity = "CONSULTANT_OVERLOADED" | "CONSULTANT_UNDERUTILIZED";
export type SeveridadAlerta = "INFO" | "WARNING" | "CRITICAL";

export const TIPOS_ALERTA_CAPACITY: readonly TipoAlertaCapacity[] = [
  "CONSULTANT_OVERLOADED",
  "CONSULTANT_UNDERUTILIZED",
];

export interface MetadataAlertaCapacity {
  month: string;
  pct: number | null;
  billablePct: number | null;
  assignedHours: number;
  capacityHours: number;
}

export interface AlertaDeseada {
  type: TipoAlertaCapacity;
  consultantId: string;
  month: string;
  severity: SeveridadAlerta;
  message: string;
  metadata: MetadataAlertaCapacity;
}

/** Subconjunto de `ConsultantResult` que necesita la decisión. */
export interface ConsultorParaAlertas {
  consultantId: string;
  months: {
    month: string;
    capacityHours: number;
    assignedHours: number;
    pct: number | null;
    billablePct: number | null;
    status: "OVER" | "OK" | "UNDER" | null;
    billableStatus: "OVER" | "OK" | "UNDER" | null;
  }[];
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11" -> "nov-2026". */
export function etiquetaMes(month: string): string {
  const [anio, mes] = month.split("-");
  return `${MESES[Number(mes) - 1] ?? mes}-${anio}`;
}

const redondear1 = (n: number) => Math.round(n * 10) / 10;
const entero = (n: number) => Math.round(n);

/** Cuánto por encima del umbral de sobreasignación se pasa de WARNING a CRITICAL (puntos porcentuales). */
export const MARGEN_CRITICO_PCT = 20;

export function calcularAlertasDeseadas(params: {
  consultants: ConsultorParaAlertas[];
  overPct: number;
  /** Nombre por id de consultor (para el mensaje). */
  nombres: ReadonlyMap<string, string> | Record<string, string>;
}): AlertaDeseada[] {
  const { consultants, overPct } = params;
  const nombreDe = (id: string) =>
    (params.nombres instanceof Map ? params.nombres.get(id) : (params.nombres as Record<string, string>)[id]) ?? "Consultor";
  const salida: AlertaDeseada[] = [];

  for (const c of consultants) {
    for (const m of c.months) {
      // Sin capacidad en el mes no hay porcentaje, y sin porcentaje no hay alerta.
      if (m.pct === null) continue;
      const metadata: MetadataAlertaCapacity = {
        month: m.month,
        pct: redondear1(m.pct),
        billablePct: m.billablePct === null ? null : redondear1(m.billablePct),
        assignedHours: redondear1(m.assignedHours),
        capacityHours: redondear1(m.capacityHours),
      };
      if (m.status === "OVER") {
        salida.push({
          type: "CONSULTANT_OVERLOADED",
          consultantId: c.consultantId,
          month: m.month,
          severity: m.pct > overPct + MARGEN_CRITICO_PCT ? "CRITICAL" : "WARNING",
          message: `${nombreDe(c.consultantId)}: ${entero(m.pct)} % asignado en ${etiquetaMes(m.month)} (sobreasignado)`,
          metadata,
        });
      }
      if (m.billableStatus === "UNDER" && m.billablePct !== null) {
        salida.push({
          type: "CONSULTANT_UNDERUTILIZED",
          consultantId: c.consultantId,
          month: m.month,
          severity: "WARNING",
          message: `${nombreDe(c.consultantId)}: ${entero(m.billablePct)} % facturable en ${etiquetaMes(m.month)} (subutilizado)`,
          metadata,
        });
      }
    }
  }
  return salida;
}

/** Alerta sin resolver tal como está en la base. */
export interface AlertaAbierta {
  id: string;
  type: string;
  consultantId: string | null;
  severity: string;
  message: string;
  metadata: unknown;
}

export interface PlanSincronizacion {
  crear: AlertaDeseada[];
  actualizar: { id: string; deseada: AlertaDeseada }[];
  /** ids de alertas a resolver. */
  resolver: string[];
}

const clave = (type: string, consultantId: string | null, month: string | null) =>
  month && consultantId ? `${type}|${consultantId}|${month}` : null;

function mesDe(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "month" in metadata) {
    const m = (metadata as { month?: unknown }).month;
    return typeof m === "string" && m !== "" ? m : null;
  }
  return null;
}

/** Misma información que se persiste, en orden estable, para decidir si hay cambios. */
function huella(severity: string, message: string, metadata: unknown): string {
  const md = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  return JSON.stringify([
    severity,
    message,
    md.month ?? null,
    md.pct ?? null,
    md.billablePct ?? null,
    md.assignedHours ?? null,
    md.capacityHours ?? null,
  ]);
}

export function planAlertSync(deseadas: AlertaDeseada[], abiertas: AlertaAbierta[]): PlanSincronizacion {
  const plan: PlanSincronizacion = { crear: [], actualizar: [], resolver: [] };
  const porClave = new Map<string, AlertaDeseada>();
  for (const d of deseadas) porClave.set(clave(d.type, d.consultantId, d.month)!, d);

  const cubiertas = new Set<string>();
  for (const a of abiertas) {
    const k = clave(a.type, a.consultantId, mesDe(a.metadata));
    const deseada = k ? porClave.get(k) : undefined;
    // Sin mes (alerta vieja), condición desaparecida, mes fuera de horizonte o duplicada: se resuelve.
    if (!k || !deseada || cubiertas.has(k)) {
      plan.resolver.push(a.id);
      continue;
    }
    cubiertas.add(k);
    if (huella(a.severity, a.message, a.metadata) !== huella(deseada.severity, deseada.message, deseada.metadata)) {
      plan.actualizar.push({ id: a.id, deseada });
    }
  }

  for (const d of deseadas) {
    if (!cubiertas.has(clave(d.type, d.consultantId, d.month)!)) plan.crear.push(d);
  }
  return plan;
}
