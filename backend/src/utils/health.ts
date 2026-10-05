import type { HealthStatus } from "@prisma/client";

export type HealthInput = {
  alertLevel: "ok" | "warning" | "exceeded";
  grossMarginActualPct: number | null;
  /**
   * Umbrales de margen YA resueltos por `resolveMarginThresholds` (D-2). Se
   * aceptan nulos solo para no romper llamadores que no midan margen; en ese
   * caso el margen no participa del semáforo.
   */
  marginWarningPct: number | null;
  marginCriticalPct: number | null;
  openHighRisks: number;
  delayedMilestones: number;
  spi: number | null;
  cpi: number | null;
  utilizationPct: number;
};

/**
 * Calcula el estado de salud RAG del proyecto a partir de sus métricas.
 * Reglas en orden de severidad descendente.
 *
 * MARGEN (D-2): son dos umbrales configurables por proyecto, no uno.
 *  · por debajo del crítico (15 % por defecto) → RED
 *  · por debajo del de advertencia (30 % por defecto) → YELLOW
 * ANTES el RED se calculaba como `umbral * 0,5`, un 7,5 % que no eligió nadie.
 * Los cortes de CPI y SPI no se tocan: son la decisión D-7, aparte.
 */
export function computeHealthStatus(input: HealthInput): HealthStatus {
  const {
    alertLevel,
    grossMarginActualPct,
    marginWarningPct,
    marginCriticalPct,
    openHighRisks,
    delayedMilestones,
    spi,
    cpi,
  } = input;

  // ── RED ────────────────────────────────────────────────────────────────────
  if (alertLevel === "exceeded") return "RED";
  if (openHighRisks > 0) return "RED";
  if (cpi !== null && cpi < 0.75) return "RED";
  if (spi !== null && spi < 0.75) return "RED";
  if (
    grossMarginActualPct !== null &&
    marginCriticalPct !== null &&
    grossMarginActualPct < marginCriticalPct
  )
    return "RED";

  // ── YELLOW ─────────────────────────────────────────────────────────────────
  if (alertLevel === "warning") return "YELLOW";
  if (delayedMilestones > 0) return "YELLOW";
  if (cpi !== null && cpi < 0.9) return "YELLOW";
  if (spi !== null && spi < 0.9) return "YELLOW";
  if (
    grossMarginActualPct !== null &&
    marginWarningPct !== null &&
    grossMarginActualPct < marginWarningPct
  )
    return "YELLOW";

  return "GREEN";
}

// ─── Insumos homologados del semáforo (R10) ──────────────────────────────────

export type MilestoneHealthInput = {
  status: string;
  plannedDate: Date;
};

export type RiskHealthInput = {
  riskScore: number;
  status: string;
};

/**
 * Hitos atrasados, con UN solo criterio para dashboard, portafolio y detalle.
 *
 * Antes divergían: `stats.routes.ts` derivaba el atraso en memoria
 * (`status !== "COMPLETED" && plannedDate < hoy`) mientras
 * `project-detail.routes.ts` exigía `status === "DELAYED"`, un estado que hay
 * que marcar a mano. Se conserva el criterio derivado porque no depende de que
 * alguien acuerde de actualizar el hito, y además se respeta el `DELAYED`
 * explícito cuando sí está puesto.
 *
 * `now` entra por parámetro: la función es pura y no lee el reloj.
 */
export function countDelayedMilestones(milestones: MilestoneHealthInput[], now: Date): number {
  return milestones.filter(
    (m) => m.status !== "COMPLETED" && (m.status === "DELAYED" || m.plannedDate < now),
  ).length;
}

/** Riesgos abiertos de alto impacto (score >= 6). Mismo criterio en los 3 sitios. */
export function countOpenHighRisks(risks: RiskHealthInput[]): number {
  return risks.filter((r) => r.status === "OPEN" && r.riskScore >= 6).length;
}
