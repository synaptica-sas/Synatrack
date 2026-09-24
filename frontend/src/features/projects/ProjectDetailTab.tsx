import React, { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../../components/PageHeader";
import { CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_TYPE_LABELS, RISK_STATUS_LABELS, ASSIGNMENT_STATUS_LABELS, ISSUE_SEVERITY_LABELS, ISSUE_STATUS_LABELS, label } from "../../utils/statusLabels";
import { PRESENTACION_SALUD, textoCriteriosSalud } from "../../utils/projectHealth";
import { CountryFlag } from "../../components/CountryFlag";
import {
  getProjectDetail,
  getProjectTimeline,
  completeMilestone,
  createMilestone,
  deleteMilestone,
  createRisk,
  updateRiskStatus,
  deleteRisk,
  createIssue,
  resolveIssue,
  deleteIssue,
  createChangeRequest,
  approveChangeRequest,
  rejectChangeRequest,
  deleteChangeRequest,
  setProjectBaseline,
  setProjectPhase,
  type ProjectDetail,
  type ProjectDetailProject,
  type ProjectDetailFinancials,
  type ProjectTimeline,
  type Milestone,
  type Risk,
  type Issue,
  type ChangeRequest,
  type MilestoneStatus,
  type RiskStatus,
  type IssueStatus,
  type IssueSeverity,
  type ChangeRequestType,
  type ProjectPhase,
  type HealthStatus,
  getAuditLogs,
  type AuditLog,
} from "../../services/api";
import { useToast } from "../../hooks/useToast";

/**
 * Detalle de proyecto, migrado al sistema de tokens (ver `documentacion/DISENO.md`).
 *
 * Lo que había antes: 95 estilos en línea y 65 colores literales, la mayor
 * concentración de color a mano que quedaba en la aplicación. Tres paletas
 * conviviendo (la de marca, la de Tailwind y la de los gráficos), el semáforo
 * imprimiendo el enum crudo del backend ("GREEN") y `var(--accent, …)` con
 * respaldo azul repetido en cinco sitios: ese token **no existe**, así que el
 * subrayado de la pestaña activa y la línea de tiempo siempre caían al azul por
 * defecto de Tailwind.
 *
 * Lo que hay ahora: las clases de patrón de `App.css`. Los únicos `style` que
 * quedan son valores calculados (posiciones del SVG y el ancho de una barra),
 * que es el único uso admitido.
 */

type SubTab = "resumen" | "hitos" | "recursos" | "riesgos" | "issues" | "cambios" | "historial";

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(2)}`;
}

/**
 * Semáforo de salud. Usa el vocabulario unificado de `PRESENTACION_SALUD`
 * (Saludable / Advertencia / Crítico): antes esta pantalla pintaba el enum
 * crudo del backend —"GREEN", "YELLOW", "RED"— que además de ser inglés es un
 * nombre de color, justo lo que la regla de accesibilidad pide evitar.
 * La etiqueta es la pista que no depende del color; la insignia no lleva icono
 * por la misma razón que en Portafolio.
 */
function RagBadge({ status, marginThreshold }: { status: HealthStatus | null | undefined; marginThreshold?: number | null }) {
  if (!status) return <span className="tone-muted">—</span>;
  const p = PRESENTACION_SALUD[status] ?? PRESENTACION_SALUD.GREEN;
  return (
    <span className={`status-badge status-badge--${p.modificador}`} title={textoCriteriosSalud(marginThreshold)}>
      {p.etiqueta}
    </span>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">{value}</div>
      {sub && <div className="kpi-card__sub">{sub}</div>}
    </div>
  );
}

/** Medidor de porcentaje con el número siempre visible; el color solo refuerza. */
function BudgetBar({ pct: p, etiqueta }: { pct: number; etiqueta: string }) {
  const capped = Math.min(p, 100);
  const mod = p > 100 ? "danger" : p > 90 ? "warning" : "success";
  return (
    <div className="meter">
      <div className="meter__track">
        <div className={`meter__fill meter__fill--${mod}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="meter__value">{p.toFixed(1)}%</span>
      <span className="sr-only">{`${etiqueta}: ${p.toFixed(1)}%`}</span>
    </div>
  );
}

/**
 * Curva S de EVM. El color ya no viaja en atributos `fill`/`stroke` (que no
 * pueden resolver un token ni tener contraparte oscura) sino en las clases
 * `.chart-*`. La leyenda sale del SVG a HTML para poder usar `.chart-legend`,
 * que es la misma de las demás pantallas.
 */
function BurndownChart({ timeline }: { timeline: ProjectTimeline }) {
  const { actualCost, plannedValue, bac } = timeline;

  // Merge months from both series
  const allMonths = Array.from(
    new Set([...actualCost.map((x) => x.month), ...plannedValue.map((x) => x.pv >= 0 ? x.month : x.month)])
  ).sort();

  if (allMonths.length === 0) {
    return <p className="chart-empty">Sin datos de costos aún.</p>;
  }

  const pvMap = new Map(plannedValue.map((x) => [x.month, x.pv]));
  const acMap = new Map(actualCost.map((x) => [x.month, x.ac]));

  const maxVal = Math.max(bac, ...actualCost.map((x) => x.ac), 1);

  // SVG dimensions
  const W = 560;
  const H = 200;
  const PAD_LEFT = 64;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 40;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;

  function xPos(i: number) {
    return PAD_LEFT + (i / Math.max(allMonths.length - 1, 1)) * chartW;
  }
  function yPos(val: number) {
    return PAD_TOP + chartH - (val / maxVal) * chartH;
  }

  const pvPoints = allMonths.map((m, i) => {
    const val = pvMap.get(m);
    return val != null ? `${xPos(i)},${yPos(val)}` : null;
  }).filter(Boolean).join(" ");

  const acPoints = allMonths.map((m, i) => {
    const val = acMap.get(m);
    return val != null ? `${xPos(i)},${yPos(val)}` : null;
  }).filter(Boolean).join(" ");

  // Y-axis labels (4 ticks)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * maxVal));

  const cur = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  return (
    <>
      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          style={{ maxWidth: W }}
          role="img"
          aria-label="Curva S: valor planeado frente a costo real por mes"
        >
          {/* Y grid lines + labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_LEFT} y1={yPos(t)} x2={W - PAD_RIGHT} y2={yPos(t)}
                className="chart-grid" strokeWidth={1}
              />
              <text x={PAD_LEFT - 6} y={yPos(t) + 4} textAnchor="end" fontSize={10} className="chart-axis">
                {cur.format(t)}
              </text>
            </g>
          ))}

          {/* BAC line */}
          <line
            x1={PAD_LEFT} y1={yPos(bac)} x2={W - PAD_RIGHT} y2={yPos(bac)}
            className="chart-grid" strokeWidth={1} strokeDasharray="4 2"
          />
          <text x={W - PAD_RIGHT - 2} y={yPos(bac) - 4} textAnchor="end" fontSize={9} className="chart-axis">BAC</text>

          {/* Valor planeado (serie categórica 2: azul de marca) */}
          {pvPoints && (
            <polyline points={pvPoints} fill="none" className="chart-stroke--2" strokeWidth={2} strokeLinejoin="round" />
          )}

          {/* Costo real (serie categórica 1: ámbar de marca) */}
          {acPoints && (
            <polyline points={acPoints} fill="none" className="chart-stroke--1" strokeWidth={2.5} strokeLinejoin="round" />
          )}

          {/* Dots for AC */}
          {allMonths.map((m, i) => {
            const val = acMap.get(m);
            return val != null ? (
              <circle key={m} cx={xPos(i)} cy={yPos(val)} r={3} className="chart-fill--1" />
            ) : null;
          })}

          {/* X-axis labels (every other month to avoid crowding) */}
          {allMonths.map((m, i) => {
            if (allMonths.length > 8 && i % 2 !== 0) return null;
            return (
              <text key={m} x={xPos(i)} y={H - PAD_BOTTOM + 14} textAnchor="middle" fontSize={9} className="chart-axis">
                {m.slice(2)}
              </text>
            );
          })}

          {/* Axes */}
          <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + chartH} className="chart-grid" strokeWidth={1} />
          <line x1={PAD_LEFT} y1={PAD_TOP + chartH} x2={W - PAD_RIGHT} y2={PAD_TOP + chartH} className="chart-grid" strokeWidth={1} />
        </svg>
      </div>

      {/* Leyenda: cada color lleva su etiqueta al lado, nunca viaja solo. */}
      <div className="chart-legend">
        <span className="chart-legend__item">
          <span className="chart-swatch chart-swatch--2" aria-hidden="true" />
          <span className="chart-legend__name">Valor planeado (PV)</span>
        </span>
        <span className="chart-legend__item">
          <span className="chart-swatch chart-swatch--1" aria-hidden="true" />
          <span className="chart-legend__name">Costo real (AC)</span>
        </span>
      </div>
    </>
  );
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

function ResumenTab({ project, financials, evm, canWrite, onReload, projectId }: {
  project: ProjectDetailProject;
  financials: ProjectDetailFinancials;
  evm: ProjectDetail["evm"];
  canWrite: boolean;
  onReload: () => void;
  projectId: string;
}) {
  const [settingBaseline, setSettingBaseline] = useState(false);
  const [phaseChanging, setPhaseChanging] = useState(false);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const hasBaseline = !!project.baselineSetAt;

  useEffect(() => {
    void getProjectTimeline(projectId).then(setTimeline).catch(() => null);
  }, [projectId]);

  async function handleSetBaseline() {
    if (hasBaseline) return;
    setSettingBaseline(true);
    try {
      await setProjectBaseline(projectId, {});
      onReload();
    } finally {
      setSettingBaseline(false);
    }
  }

  async function handlePhaseChange(phase: ProjectPhase) {
    setPhaseChanging(true);
    try {
      await setProjectPhase(projectId, phase);
      onReload();
    } finally {
      setPhaseChanging(false);
    }
  }

  return (
    <div className="section-stack">
      {/* KPI Row */}
      <div className="kpi-grid">
        <KpiCard label="Salud" value={<RagBadge status={project.healthStatus} />} />
        <KpiCard label="Avance" value={`${Number(project.completionPct ?? 0).toFixed(1)}%`} />
        <KpiCard label="CPI" value={evm?.cpi != null ? pct(evm.cpi) : "—"} sub="≥1 bajo presupuesto" />
        <KpiCard label="SPI" value={evm?.spi != null ? pct(evm.spi) : "—"} sub="≥1 adelantado" />
        <KpiCard label="Presupuesto" value={fmt(financials.budget, financials.displayCurrency)} sub={financials.displayCurrency} />
        <KpiCard label="Ejecutado" value={fmt(financials.spent, financials.displayCurrency)} sub={`${financials.usedBudgetPercent.toFixed(1)}% del presupuesto`} />
        <KpiCard label="Margen" value={financials.grossMarginActualPct != null ? `${financials.grossMarginActualPct.toFixed(1)}%` : "—"} sub={fmt(financials.grossMarginActual, financials.displayCurrency)} />
        {evm && <KpiCard label="EAC" value={evm.eac != null ? fmt(evm.eac, financials.displayCurrency) : "—"} sub="Estimación a terminación" />}
        {evm && <KpiCard label="VAC" value={evm.vac != null ? fmt(evm.vac, financials.displayCurrency) : "—"} sub={evm.vac != null ? (evm.vac >= 0 ? "Bajo presupuesto" : "Sobre presupuesto") : undefined} />}
        {evm && <KpiCard label="TCPI" value={evm.tcpi != null ? pct(evm.tcpi) : "—"} sub="Eficiencia requerida" />}
      </div>

      {/* Budget bar */}
      <div className="panel">
        <div className="section-title">Uso de presupuesto</div>
        <BudgetBar pct={financials.usedBudgetPercent} etiqueta="Uso de presupuesto" />
      </div>

      {/* Phase & baseline */}
      <div className="split-row">
        <div>
          <label className="field-label" htmlFor="proyecto-fase">Fase del proyecto</label>
          <select
            id="proyecto-fase"
            className="select-control"
            value={project.phase ?? ""}
            onChange={(e) => void handlePhaseChange(e.target.value as ProjectPhase)}
            disabled={!canWrite || phaseChanging}
          >
            <option value="">Sin fase</option>
            <option value="INITIATION">Iniciación</option>
            <option value="PLANNING">Planificación</option>
            <option value="EXECUTION">Ejecución</option>
            <option value="MONITORING">Monitoreo</option>
            <option value="CLOSING">Cierre</option>
          </select>
        </div>
        <div>
          <span className="field-label">Línea base</span>
          {hasBaseline ? (
            <p className="field-help">
              <span className="state-chip state-chip--success">Establecida</span>
              {" "}{new Date(project.baselineSetAt!).toLocaleDateString("es-CO")}
              {project.baselineSetBy ? ` · por ${project.baselineSetBy}` : ""}
            </p>
          ) : (
            <button type="button" disabled={!canWrite || settingBaseline} onClick={() => void handleSetBaseline()}>
              {settingBaseline ? "Estableciendo…" : "Establecer línea base"}
            </button>
          )}
        </div>
      </div>

      {/* Baseline comparison */}
      {hasBaseline && (
        <div className="panel">
          <div className="section-title">Comparación vs línea base</div>
          <div className="def-list">
            <span>
              <span className="def-list__term">Presupuesto base:</span>
              <span className="def-list__value">{fmt(Number(project.baselineBudget ?? 0), project.currency)}</span>
            </span>
            <span>
              <span className="def-list__term">Inicio base:</span>
              <span className="def-list__value">{project.baselineStartDate ? new Date(project.baselineStartDate).toLocaleDateString("es-CO") : "—"}</span>
            </span>
            <span>
              <span className="def-list__term">Fin base:</span>
              <span className="def-list__value">{project.baselineEndDate ? new Date(project.baselineEndDate).toLocaleDateString("es-CO") : "—"}</span>
            </span>
          </div>
        </div>
      )}

      {/* EVM Burndown chart */}
      <div className="panel">
        <div className="section-title">Curva S — Valor planeado vs Costo real (EVM)</div>
        {timeline ? (
          <BurndownChart timeline={timeline} />
        ) : (
          <p className="chart-empty">Cargando datos de cronograma…</p>
        )}
      </div>
    </div>
  );
}

/** Estado de un hito: etiqueta + tinte de estado. La etiqueta manda. */
const HITO_PRESENTACION: Record<MilestoneStatus, { etiqueta: string; modificador: string }> = {
  PLANNED:     { etiqueta: "Planeado",   modificador: "neutral" },
  IN_PROGRESS: { etiqueta: "En curso",   modificador: "info" },
  COMPLETED:   { etiqueta: "Completado", modificador: "success" },
  DELAYED:     { etiqueta: "Retrasado",  modificador: "danger" },
  CANCELLED:   { etiqueta: "Cancelado",  modificador: "neutral" },
};

function HitosTab({ projectId, milestones, canWrite, onReload }: {
  projectId: string;
  milestones: Milestone[];
  canWrite: boolean;
  onReload: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: "", plannedDate: "", weight: "0", description: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createMilestone(projectId, { ...form, weight: Number(form.weight) });
      setForm({ name: "", plannedDate: "", weight: "0", description: "" });
      showToast("Hito creado", "success");
      onReload();
    } catch {
      showToast("Error al crear hito", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="section-stack">
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} className="inline-form">
          <div className="inline-form__field inline-form__field--wide">
            <label className="field-label" htmlFor="hito-nombre">
              Nombre del hito <span className="field-required" aria-hidden="true">*</span>
            </label>
            <input id="hito-nombre" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="inline-form__field inline-form__field--mid">
            <label className="field-label" htmlFor="hito-fecha">
              Fecha planeada <span className="field-required" aria-hidden="true">*</span>
            </label>
            <input id="hito-fecha" type="date" value={form.plannedDate} onChange={(e) => setForm((p) => ({ ...p, plannedDate: e.target.value }))} required />
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="hito-peso">Peso</label>
            <input id="hito-peso" type="number" value={form.weight} onChange={(e) => setForm((p) => ({ ...p, weight: e.target.value }))} min={0} max={100} aria-describedby="hito-peso-ayuda" />
            <span className="field-help" id="hito-peso-ayuda">De 0 a 100</span>
          </div>
          <button type="submit" className="inline-form__submit" disabled={submitting}>{submitting ? "Creando…" : "Agregar hito"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Fecha planeada</th><th>Fecha real</th><th>Peso</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {milestones.length === 0 && (
              <tr><td colSpan={canWrite ? 6 : 5} className="cell-empty cell-empty--roomy">Sin hitos registrados</td></tr>
            )}
            {milestones.map((m) => {
              const p = HITO_PRESENTACION[m.status] ?? HITO_PRESENTACION.PLANNED;
              return (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="cell-date">{new Date(m.plannedDate).toLocaleDateString("es-CO")}</td>
                  <td className="cell-date">{m.actualDate ? new Date(m.actualDate).toLocaleDateString("es-CO") : "—"}</td>
                  <td className="cell-num">{m.weight}</td>
                  <td>
                    <span className={`state-chip state-chip--${p.modificador}`}>{p.etiqueta}</span>
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inline-actions">
                        {m.status !== "COMPLETED" && (
                          <button type="button" onClick={async () => { await completeMilestone(projectId, m.id); showToast("Hito completado", "success"); onReload(); }}>
                            Completar
                          </button>
                        )}
                        <button type="button" className="ghost" onClick={async () => { await deleteMilestone(projectId, m.id); showToast("Hito eliminado", "info"); onReload(); }}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiesgosTab({ projectId, risks, canWrite, onReload }: {
  projectId: string;
  risks: Risk[];
  canWrite: boolean;
  onReload: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ title: "", probability: "1", impact: "1", category: "", owner: "", mitigationPlan: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createRisk(projectId, {
        title: form.title,
        probability: Number(form.probability),
        impact: Number(form.impact),
        category: form.category || undefined,
        owner: form.owner || undefined,
        mitigationPlan: form.mitigationPlan || undefined,
      });
      setForm({ title: "", probability: "1", impact: "1", category: "", owner: "", mitigationPlan: "" });
      showToast("Riesgo registrado", "success");
      onReload();
    } catch {
      showToast("Error al crear riesgo", "error");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Tono del score P×I con los mismos cortes que tenía la pantalla (≥6 alto,
   * ≥3 medio). El número va siempre dentro del disco: el color clasifica, la
   * cifra informa.
   */
  const scoreMod = (score: number) => (score >= 6 ? "danger" : score >= 3 ? "warning" : "success");
  const scoreEtiqueta = (score: number) => (score >= 6 ? "alto" : score >= 3 ? "medio" : "bajo");

  const statusOpts: { value: RiskStatus; label: string }[] = [
    { value: "OPEN", label: "Abierto" }, { value: "MITIGATED", label: "Mitigado" },
    { value: "ACCEPTED", label: "Aceptado" }, { value: "CLOSED", label: "Cerrado" },
  ];

  return (
    <div className="section-stack">
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} className="inline-form">
          <div className="inline-form__field inline-form__field--wide">
            <label className="field-label" htmlFor="riesgo-titulo">
              Título del riesgo <span className="field-required" aria-hidden="true">*</span>
            </label>
            <input id="riesgo-titulo" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="riesgo-probabilidad">Probabilidad</label>
            <select id="riesgo-probabilidad" className="select-control" value={form.probability} onChange={(e) => setForm((p) => ({ ...p, probability: e.target.value }))}>
              <option value="1">1 – Baja</option><option value="2">2 – Media</option><option value="3">3 – Alta</option>
            </select>
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="riesgo-impacto">Impacto</label>
            <select id="riesgo-impacto" className="select-control" value={form.impact} onChange={(e) => setForm((p) => ({ ...p, impact: e.target.value }))}>
              <option value="1">1 – Bajo</option><option value="2">2 – Medio</option><option value="3">3 – Alto</option>
            </select>
          </div>
          <div className="inline-form__field inline-form__field--mid">
            <label className="field-label" htmlFor="riesgo-categoria">Categoría</label>
            <input id="riesgo-categoria" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
          </div>
          <div className="inline-form__field inline-form__field--mid">
            <label className="field-label" htmlFor="riesgo-responsable">Responsable</label>
            <input id="riesgo-responsable" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} />
          </div>
          <button type="submit" className="inline-form__submit" disabled={submitting}>{submitting ? "Creando…" : "Agregar riesgo"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Score</th><th>Título</th><th>P × I</th><th>Categoría</th><th>Responsable</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {risks.length === 0 && (
              <tr><td colSpan={canWrite ? 7 : 6} className="cell-empty cell-empty--roomy">Sin riesgos registrados</td></tr>
            )}
            {risks.map((r) => (
              <tr key={r.id}>
                <td>
                  <span
                    className={`score-dot score-dot--${scoreMod(r.riskScore)}`}
                    title={`Riesgo ${scoreEtiqueta(r.riskScore)} (score ${r.riskScore})`}
                  >
                    {r.riskScore}
                  </span>
                  <span className="sr-only">{` Riesgo ${scoreEtiqueta(r.riskScore)}`}</span>
                </td>
                <td>{r.title}</td>
                <td className="cell-small">{r.probability} × {r.impact}</td>
                <td>{r.category ?? "—"}</td>
                <td>{r.owner ?? "—"}</td>
                <td>
                  {canWrite ? (
                    <>
                      <label className="sr-only" htmlFor={`riesgo-estado-${r.id}`}>Estado del riesgo {r.title}</label>
                      <select
                        id={`riesgo-estado-${r.id}`}
                        className="select-control cell-small"
                        value={r.status}
                        onChange={async (e) => { await updateRiskStatus(projectId, r.id, e.target.value as RiskStatus); showToast("Estado actualizado", "success"); onReload(); }}
                      >
                        {statusOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </>
                  ) : (
                    <span>{label(RISK_STATUS_LABELS, r.status)}</span>
                  )}
                </td>
                {canWrite && (
                  <td>
                    <button type="button" className="ghost" onClick={async () => { await deleteRisk(projectId, r.id); showToast("Riesgo eliminado", "info"); onReload(); }}>
                      Eliminar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Estado de una asignación: tono de texto, no color incrustado. */
const ASIGNACION_TONO: Record<string, string> = {
  ACTIVE: "tone-success",
  PLANNED: "tone-info",
  PARTIAL: "tone-warning",
  COMPLETED: "tone-muted",
  CANCELLED: "tone-danger",
};

function RecursosTab({ assignments }: { assignments: ProjectDetail["assignments"] }) {
  if (assignments.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon" aria-hidden="true">👥</div>
        <p className="empty-state__title">Sin asignaciones activas</p>
        <p className="empty-state__text">Este proyecto todavía no tiene consultores asignados.</p>
      </div>
    );
  }

  const allocationLabel = (a: ProjectDetail["assignments"][number]) => {
    if (a.allocationMode === "PERCENTAGE" && a.allocationPct != null) return `${a.allocationPct}%`;
    if (a.allocationMode === "HOURS" && a.hoursPerPeriod != null) return `${a.hoursPerPeriod}h/${a.periodUnit ?? "periodo"}`;
    return "—";
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Consultor</th>
            <th>Rol</th>
            <th>País</th>
            <th>Estado</th>
            <th>Asignación</th>
            <th>Inicio</th>
            <th>Fin</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id}>
              <td className="cell-strong">{a.consultant?.fullName ?? "—"}</td>
              <td>{a.consultant?.role ?? a.role ?? "—"}</td>
              <td>{a.consultant?.country ? <CountryFlag country={a.consultant.country} /> : "—"}</td>
              <td className={`cell-small cell-strong ${ASIGNACION_TONO[a.status] ?? "tone-muted"}`}>
                {label(ASSIGNMENT_STATUS_LABELS, a.status)}
              </td>
              <td>{allocationLabel(a)}</td>
              <td className="cell-date">{new Date(a.startDate).toLocaleDateString("es-CO")}</td>
              <td className="cell-date">{new Date(a.endDate).toLocaleDateString("es-CO")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Severidad de una incidencia. Antes la Crítica se pintaba con un violeta
 * categórico usado como estado, lo que rompía la regla de que un estado no
 * inventa su propio semáforo. Ahora la escalada de Alta a Crítica se
 * expresa dentro de la misma familia roja pasando de tinte a relleno sólido.
 */
const SEVERIDAD_PRESENTACION: Record<IssueSeverity, string> = {
  LOW: "state-chip--neutral",
  MEDIUM: "state-chip--warning",
  HIGH: "state-chip--danger",
  CRITICAL: "state-chip--danger state-chip--filled",
};

function IssuesTab({ projectId, issues, canWrite, onReload }: {
  projectId: string;
  issues: Issue[];
  canWrite: boolean;
  onReload: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ title: "", severity: "MEDIUM" as IssueSeverity, owner: "", description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createIssue(projectId, { title: form.title, severity: form.severity, owner: form.owner || undefined, description: form.description || undefined });
      setForm({ title: "", severity: "MEDIUM", owner: "", description: "" });
      showToast("Issue creado", "success");
      onReload();
    } catch {
      showToast("Error al crear issue", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve(id: string) {
    await resolveIssue(projectId, id, { resolution: resolution || undefined, status: "RESOLVED" as IssueStatus });
    setResolving(null);
    setResolution("");
    showToast("Issue resuelto", "success");
    onReload();
  }

  return (
    <div className="section-stack">
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} className="inline-form">
          <div className="inline-form__field inline-form__field--wide">
            <label className="field-label" htmlFor="issue-titulo">
              Título de la incidencia <span className="field-required" aria-hidden="true">*</span>
            </label>
            <input id="issue-titulo" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="issue-severidad">Severidad</label>
            <select id="issue-severidad" className="select-control" value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as IssueSeverity }))}>
              <option value="LOW">Baja</option><option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option>
            </select>
          </div>
          <div className="inline-form__field inline-form__field--mid">
            <label className="field-label" htmlFor="issue-responsable">Responsable</label>
            <input id="issue-responsable" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} />
          </div>
          <button type="submit" className="inline-form__submit" disabled={submitting}>{submitting ? "Creando…" : "Agregar issue"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Severidad</th><th>Título</th><th>Responsable</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {issues.length === 0 && (
              <tr><td colSpan={canWrite ? 5 : 4} className="cell-empty cell-empty--roomy">Sin issues registrados</td></tr>
            )}
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <span className={`state-chip ${SEVERIDAD_PRESENTACION[issue.severity] ?? "state-chip--neutral"}`}>
                    {label(ISSUE_SEVERITY_LABELS, issue.severity)}
                  </span>
                </td>
                <td>{issue.title}</td>
                <td>{issue.owner ?? "—"}</td>
                <td>{label(ISSUE_STATUS_LABELS, issue.status)}</td>
                {canWrite && (
                  <td>
                    <div className="inline-actions">
                      {issue.status !== "RESOLVED" && issue.status !== "CLOSED" && (
                        resolving === issue.id ? (
                          <div className="inline-actions">
                            <label className="sr-only" htmlFor={`issue-resolucion-${issue.id}`}>Resolución de {issue.title}</label>
                            <input id={`issue-resolucion-${issue.id}`} placeholder="Resolución" value={resolution} onChange={(e) => setResolution(e.target.value)} className="cell-small" />
                            <button type="button" onClick={() => void handleResolve(issue.id)}>OK</button>
                            <button type="button" className="ghost" onClick={() => setResolving(null)}>✕</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setResolving(issue.id)}>Resolver</button>
                        )
                      )}
                      <button type="button" className="ghost" onClick={async () => { await deleteIssue(projectId, issue.id); showToast("Issue eliminado", "info"); onReload(); }}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Estado de una solicitud de cambio: tinte de estado + etiqueta. */
const CAMBIO_MODIFICADOR: Record<string, string> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function CambiosTab({ projectId, changeRequests, canWrite, onReload }: {
  projectId: string;
  changeRequests: ChangeRequest[];
  canWrite: boolean;
  onReload: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ title: "", description: "", type: "SCOPE" as ChangeRequestType, impactBudget: "", impactDays: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createChangeRequest(projectId, {
        title: form.title,
        description: form.description,
        type: form.type,
        impactBudget: form.impactBudget ? Number(form.impactBudget) : undefined,
        impactDays: form.impactDays ? Number(form.impactDays) : undefined,
      });
      setForm({ title: "", description: "", type: "SCOPE", impactBudget: "", impactDays: "" });
      showToast("Solicitud de cambio creada", "success");
      onReload();
    } catch {
      showToast("Error al crear solicitud", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="section-stack">
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} className="inline-form">
          <div className="inline-form__field inline-form__field--wide">
            <label className="field-label" htmlFor="cambio-titulo">
              Título del cambio <span className="field-required" aria-hidden="true">*</span>
            </label>
            <input id="cambio-titulo" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
          </div>
          <div className="inline-form__field inline-form__field--wide">
            <label className="field-label" htmlFor="cambio-descripcion">
              Descripción <span className="field-required" aria-hidden="true">*</span>
            </label>
            <input id="cambio-descripcion" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="cambio-tipo">Tipo</label>
            <select id="cambio-tipo" className="select-control" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as ChangeRequestType }))}>
              <option value="SCOPE">Alcance</option><option value="BUDGET">Presupuesto</option>
              <option value="SCHEDULE">Cronograma</option><option value="OTHER">Otro</option>
            </select>
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="cambio-impacto-presupuesto">Impacto $</label>
            <input id="cambio-impacto-presupuesto" type="number" value={form.impactBudget} onChange={(e) => setForm((p) => ({ ...p, impactBudget: e.target.value }))} />
          </div>
          <div className="inline-form__field inline-form__field--narrow">
            <label className="field-label" htmlFor="cambio-impacto-dias">Impacto días</label>
            <input id="cambio-impacto-dias" type="number" value={form.impactDays} onChange={(e) => setForm((p) => ({ ...p, impactDays: e.target.value }))} />
          </div>
          <button type="submit" className="inline-form__submit" disabled={submitting}>{submitting ? "Creando…" : "Solicitar cambio"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Tipo</th><th>Título</th><th>Impacto $</th><th>Impacto días</th><th>Estado</th><th>Solicitado por</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {changeRequests.length === 0 && (
              <tr><td colSpan={canWrite ? 7 : 6} className="cell-empty cell-empty--roomy">Sin solicitudes de cambio</td></tr>
            )}
            {changeRequests.map((cr) => (
              <tr key={cr.id}>
                <td className="cell-small">{label(CHANGE_REQUEST_TYPE_LABELS, cr.type)}</td>
                <td>{cr.title}</td>
                <td className="cell-num">{cr.impactBudget ? Number(cr.impactBudget).toLocaleString() : "—"}</td>
                <td className="cell-num">{cr.impactDays ?? "—"}</td>
                <td>
                  <span className={`state-chip state-chip--${CAMBIO_MODIFICADOR[cr.status] ?? "neutral"}`}>
                    {label(CHANGE_REQUEST_STATUS_LABELS, cr.status)}
                  </span>
                </td>
                <td className="cell-small">{cr.requestedBy}</td>
                {canWrite && (
                  <td>
                    <div className="inline-actions">
                      {cr.status === "PENDING" && (
                        <>
                          <button type="button" onClick={async () => { await approveChangeRequest(projectId, cr.id); showToast("Cambio aprobado", "success"); onReload(); }}>
                            Aprobar
                          </button>
                          <button type="button" className="ghost" onClick={async () => { await rejectChangeRequest(projectId, cr.id); showToast("Cambio rechazado", "warning"); onReload(); }}>
                            Rechazar
                          </button>
                        </>
                      )}
                      {cr.status === "PENDING" && (
                        <button type="button" className="ghost" onClick={async () => { await deleteChangeRequest(projectId, cr.id); showToast("Solicitud eliminada", "info"); onReload(); }}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistorialTab({ projectId, onError }: { projectId: string; onError: (msg: string) => void }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getAuditLogs({ entityId: projectId })
      .then((data) => {
        if (active) setLogs(data);
      })
      .catch((err) => {
        if (active) onError(err instanceof Error ? err.message : "Error al cargar historial");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, onError]);

  if (loading) return <p className="loading">Cargando bitácora de auditoría...</p>;
  if (logs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon" aria-hidden="true">🗒️</div>
        <p className="empty-state__title">Sin registros de auditoría</p>
        <p className="empty-state__text">Este proyecto todavía no tiene cambios registrados en la bitácora.</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {logs.map((log) => {
        const date = new Date(log.createdAt).toLocaleString("es-CO", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });

        // Format diff/detail if present
        let detailsText = "";
        if (log.diff) {
          try {
            const diffObj = typeof log.diff === "string" ? JSON.parse(log.diff) : log.diff;
            detailsText = Object.keys(diffObj)
              .map((key) => `• Modificado "${key}": ${JSON.stringify(diffObj[key])}`)
              .join("\n");
          } catch {
            detailsText = JSON.stringify(log.diff);
          }
        }

        return (
          <div key={log.id} className="timeline__item">
            <span className="timeline__dot" aria-hidden="true" />

            <div className="timeline__head">
              <span className="timeline__time">📅 {date}</span>
              <span className="timeline__actor">👤 {log.changedBy}</span>
            </div>

            <div className="timeline__card">
              <h4 className="timeline__title">
                Acción: {log.action.toLowerCase().replace(/_/g, " ")}
              </h4>
              {detailsText ? (
                <pre className="timeline__detail">{detailsText}</pre>
              ) : (
                <p className="timeline__note">
                  Modificación de entidad {log.entity} sin detalles específicos de diferencias.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ProjectDetailTab({
  projectId,
  canWrite,
  onBack,
  onError,
}: {
  projectId: string;
  canWrite: boolean;
  onBack: () => void;
  onError: (msg: string) => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SubTab>("resumen");

  const load = useCallback(async () => {
    try {
      const data = await getProjectDetail(projectId);
      setDetail(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cargar el proyecto");
    } finally {
      setLoading(false);
    }
  }, [projectId, onError]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="panel">Cargando detalle…</div>;
  if (!detail) {
    return (
      <div className="notice notice--danger" role="alert">
        <div className="notice__title">
          <span aria-hidden="true">■</span> No se pudo cargar el proyecto
        </div>
        <p className="notice__text">Vuelve al listado e inténtalo de nuevo.</p>
      </div>
    );
  }

  const tabs: { key: SubTab; label: string }[] = [
    { key: "resumen", label: "Resumen" },
    { key: "hitos", label: `Hitos (${detail.milestones.length})` },
    { key: "recursos", label: `Recursos (${detail.assignments.length})` },
    { key: "riesgos", label: `Riesgos (${detail.risks.length})` },
    { key: "issues", label: `Incidentes (${detail.issues.length})` },
    { key: "cambios", label: `Cambios (${detail.changeRequests.length})` },
    { key: "historial", label: "Historial" },
  ];

  return (
    <section className="page-stack">
      <PageHeader
        icon="📁"
        title={detail.project.name}
        description={`${detail.project.company} · Tipo: ${detail.project.projectType} · Fase: ${detail.project.phase ?? "Sin definir"}`}
        actions={
          <>
            <button type="button" className="ghost toolbar-btn" onClick={onBack}>
              ← Volver
            </button>
            <RagBadge status={detail.project.healthStatus} />
          </>
        }
      />

      {/* Sub-tabs nav */}
      <nav className="subtabs" aria-label="Secciones del proyecto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`subtab${activeTab === t.key ? " is-active" : ""}`}
            aria-current={activeTab === t.key ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div>
        {activeTab === "resumen" && (
          <ResumenTab
            project={detail.project}
            financials={detail.financials}
            evm={detail.evm}
            canWrite={canWrite}
            onReload={() => void load()}
            projectId={projectId}
          />
        )}
        {activeTab === "hitos" && (
          <HitosTab projectId={projectId} milestones={detail.milestones} canWrite={canWrite} onReload={() => void load()} />
        )}
        {activeTab === "recursos" && (
          <RecursosTab assignments={detail.assignments} />
        )}
        {activeTab === "riesgos" && (
          <RiesgosTab projectId={projectId} risks={detail.risks} canWrite={canWrite} onReload={() => void load()} />
        )}
        {activeTab === "issues" && (
          <IssuesTab projectId={projectId} issues={detail.issues} canWrite={canWrite} onReload={() => void load()} />
        )}
        {activeTab === "cambios" && (
          <CambiosTab projectId={projectId} changeRequests={detail.changeRequests} canWrite={canWrite} onReload={() => void load()} />
        )}
        {activeTab === "historial" && (
          <HistorialTab projectId={projectId} onError={onError} />
        )}
      </div>
    </section>
  );
}
