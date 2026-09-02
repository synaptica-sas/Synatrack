import React, { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../../components/PageHeader";
import { CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_TYPE_LABELS, RISK_STATUS_LABELS, ASSIGNMENT_STATUS_LABELS, ISSUE_SEVERITY_LABELS, ISSUE_STATUS_LABELS, label } from "../../utils/statusLabels";
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

type SubTab = "resumen" | "hitos" | "recursos" | "riesgos" | "issues" | "cambios" | "historial";

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(2)}`;
}

function RagDot({ status }: { status: HealthStatus | null | undefined }) {
  if (!status) return <span style={{ color: "var(--color-sec-gray)" }}>—</span>;
  const colors: Record<HealthStatus, string> = { GREEN: "var(--color-sec-green)", YELLOW: "var(--color-accent)", RED: "var(--color-sec-red)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.35rem",
      fontWeight: 700, color: colors[status], fontSize: "0.85rem",
    }}>
      <span style={{
        width: "0.75rem", height: "0.75rem", borderRadius: "50%",
        background: colors[status], display: "inline-block",
      }} />
      {status}
    </span>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid var(--border-color)", borderRadius: "0.5rem",
      padding: "0.75rem 1rem", minWidth: "9rem",
    }}>
      <div style={{ fontSize: "0.7rem", color: "var(--color-sec-gray)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: "var(--color-sec-gray)", marginTop: "0.1rem" }}>{sub}</div>}
    </div>
  );
}

function BudgetBar({ pct: p }: { pct: number }) {
  const capped = Math.min(p, 100);
  const color = p > 100 ? "var(--color-sec-red)" : p > 90 ? "var(--color-accent)" : "var(--color-sec-green)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <div style={{ flex: 1, height: "0.6rem", background: "var(--color-primary-10)", borderRadius: "9999px", overflow: "hidden" }}>
        <div style={{ width: `${capped}%`, height: "100%", background: color }} />
      </div>
      <span style={{ fontSize: "0.75rem", color: "var(--text)", minWidth: "3rem", textAlign: "right" }}>{p.toFixed(1)}%</span>
    </div>
  );
}

function BurndownChart({ timeline }: { timeline: ProjectTimeline }) {
  const { actualCost, plannedValue, bac } = timeline;

  // Merge months from both series
  const allMonths = Array.from(
    new Set([...actualCost.map((x) => x.month), ...plannedValue.map((x) => x.pv >= 0 ? x.month : x.month)])
  ).sort();

  if (allMonths.length === 0) {
    return <p style={{ color: "var(--color-sec-gray)", fontSize: "0.8rem", margin: 0 }}>Sin datos de costos aún.</p>;
  }

  const pvMap = new Map(plannedValue.map((x) => [x.month, x.pv]));
  const acMap = new Map(actualCost.map((x) => [x.month, x.ac]));

  const maxVal = Math.max(bac, ...actualCost.map((x) => x.ac), 1);

  // SVG dimensions
  const W = 560;
  const H = 220;
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
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}>
        {/* Y grid lines + labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_LEFT} y1={yPos(t)} x2={W - PAD_RIGHT} y2={yPos(t)}
              stroke="#e5e7eb" strokeWidth={1}
            />
            <text x={PAD_LEFT - 6} y={yPos(t) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
              {cur.format(t)}
            </text>
          </g>
        ))}

        {/* BAC line */}
        <line
          x1={PAD_LEFT} y1={yPos(bac)} x2={W - PAD_RIGHT} y2={yPos(bac)}
          stroke="#d1d5db" strokeWidth={1} strokeDasharray="4 2"
        />
        <text x={W - PAD_RIGHT - 2} y={yPos(bac) - 4} textAnchor="end" fontSize={9} fill="#9ca3af">BAC</text>

        {/* Planned Value line (blue) */}
        {pvPoints && (
          <polyline points={pvPoints} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />
        )}

        {/* Actual Cost line (orange) */}
        {acPoints && (
          <polyline points={acPoints} fill="none" stroke="#f97316" strokeWidth={2.5} strokeLinejoin="round" />
        )}

        {/* Dots for AC */}
        {allMonths.map((m, i) => {
          const val = acMap.get(m);
          return val != null ? (
            <circle key={m} cx={xPos(i)} cy={yPos(val)} r={3} fill="#f97316" />
          ) : null;
        })}

        {/* X-axis labels (every other month to avoid crowding) */}
        {allMonths.map((m, i) => {
          if (allMonths.length > 8 && i % 2 !== 0) return null;
          return (
            <text key={m} x={xPos(i)} y={H - PAD_BOTTOM + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">
              {m.slice(2)}
            </text>
          );
        })}

        {/* Axes */}
        <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + chartH} stroke="#d1d5db" strokeWidth={1} />
        <line x1={PAD_LEFT} y1={PAD_TOP + chartH} x2={W - PAD_RIGHT} y2={PAD_TOP + chartH} stroke="#d1d5db" strokeWidth={1} />

        {/* Legend */}
        <g transform={`translate(${PAD_LEFT + 8}, ${H - 12})`}>
          <rect x={0} y={-7} width={12} height={3} fill="#3b82f6" />
          <text x={16} y={0} fontSize={9} fill="#6b7280">Valor planeado (PV)</text>
          <rect x={120} y={-7} width={12} height={3} fill="#f97316" />
          <text x={136} y={0} fontSize={9} fill="#6b7280">Costo real (AC)</text>
        </g>
      </svg>
    </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* KPI Row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <KpiCard label="Salud" value={<RagDot status={project.healthStatus} />} />
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
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.4rem" }}>Uso de presupuesto</div>
        <BudgetBar pct={financials.usedBudgetPercent} />
      </div>

      {/* Phase & baseline */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 16rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.35rem" }}>Fase del proyecto</div>
          <select
            value={project.phase ?? ""}
            onChange={(e) => void handlePhaseChange(e.target.value as ProjectPhase)}
            disabled={!canWrite || phaseChanging}
            style={{ width: "100%" }}
          >
            <option value="">Sin fase</option>
            <option value="INITIATION">Iniciación</option>
            <option value="PLANNING">Planificación</option>
            <option value="EXECUTION">Ejecución</option>
            <option value="MONITORING">Monitoreo</option>
            <option value="CLOSING">Cierre</option>
          </select>
        </div>
        <div style={{ flex: "1 1 16rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.35rem" }}>Línea base</div>
          {hasBaseline ? (
            <div style={{ fontSize: "0.8rem", color: "var(--text)" }}>
              <span style={{ color: "var(--color-sec-green)", fontWeight: 600 }}>Establecida</span>
              {" — "}{new Date(project.baselineSetAt!).toLocaleDateString("es-CO")}
              {project.baselineSetBy ? ` por ${project.baselineSetBy}` : ""}
            </div>
          ) : (
            <button type="button" disabled={!canWrite || settingBaseline} onClick={() => void handleSetBaseline()}>
              {settingBaseline ? "Estableciendo…" : "Establecer línea base"}
            </button>
          )}
        </div>
      </div>

      {/* Baseline comparison */}
      {hasBaseline && (
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.4rem" }}>Comparación vs línea base</div>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
            <div><span style={{ color: "var(--color-sec-gray)" }}>Presupuesto base:</span> {fmt(Number(project.baselineBudget ?? 0), project.currency)}</div>
            <div><span style={{ color: "var(--color-sec-gray)" }}>Inicio base:</span> {project.baselineStartDate ? new Date(project.baselineStartDate).toLocaleDateString("es-CO") : "—"}</div>
            <div><span style={{ color: "var(--color-sec-gray)" }}>Fin base:</span> {project.baselineEndDate ? new Date(project.baselineEndDate).toLocaleDateString("es-CO") : "—"}</div>
          </div>
        </div>
      )}

      {/* EVM Burndown chart */}
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.5rem" }}>Curva S — Valor planeado vs Costo real (EVM)</div>
        {timeline ? (
          <BurndownChart timeline={timeline} />
        ) : (
          <p style={{ color: "var(--color-sec-gray)", fontSize: "0.8rem", margin: 0 }}>Cargando datos de cronograma…</p>
        )}
      </div>
    </div>
  );
}

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

  const statusLabel: Record<MilestoneStatus, string> = {
    PLANNED: "Planeado", IN_PROGRESS: "En curso", COMPLETED: "Completado",
    DELAYED: "Retrasado", CANCELLED: "Cancelado",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <input placeholder="Nombre del hito" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required style={{ flex: "2 1 12rem" }} />
          <input type="date" value={form.plannedDate} onChange={(e) => setForm((p) => ({ ...p, plannedDate: e.target.value }))} required style={{ flex: "1 1 9rem" }} />
          <input type="number" placeholder="Peso (0-100)" value={form.weight} onChange={(e) => setForm((p) => ({ ...p, weight: e.target.value }))} min={0} max={100} style={{ flex: "0 0 7rem" }} />
          <button type="submit" disabled={submitting}>{submitting ? "Creando…" : "Agregar hito"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Fecha planeada</th><th>Fecha real</th><th>Peso</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {milestones.length === 0 && (
              <tr><td colSpan={canWrite ? 6 : 5} style={{ textAlign: "center", color: "#9ca3af" }}>Sin hitos registrados</td></tr>
            )}
            {milestones.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{new Date(m.plannedDate).toLocaleDateString("es-CO")}</td>
                <td>{m.actualDate ? new Date(m.actualDate).toLocaleDateString("es-CO") : "—"}</td>
                <td>{m.weight}</td>
                <td>
                  <span style={{
                    padding: "0.1rem 0.5rem", borderRadius: "9999px", fontSize: "0.7rem", fontWeight: 600,
                    background: m.status === "COMPLETED" ? "#dcfce7" : m.status === "DELAYED" ? "#fef2f2" : m.status === "IN_PROGRESS" ? "#dbeafe" : "#f3f4f6",
                    color: m.status === "COMPLETED" ? "#16a34a" : m.status === "DELAYED" ? "#dc2626" : m.status === "IN_PROGRESS" ? "#2563eb" : "#374151",
                  }}>
                    {statusLabel[m.status]}
                  </span>
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
            ))}
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

  const scoreColor = (score: number) => score >= 6 ? "#ef4444" : score >= 3 ? "#f59e0b" : "#22c55e";

  const statusOpts: { value: RiskStatus; label: string }[] = [
    { value: "OPEN", label: "Abierto" }, { value: "MITIGATED", label: "Mitigado" },
    { value: "ACCEPTED", label: "Aceptado" }, { value: "CLOSED", label: "Cerrado" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <input placeholder="Título del riesgo" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "2 1 14rem" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <label style={{ fontSize: "0.7rem", color: "#6b7280" }}>Probabilidad (1-3)</label>
            <select value={form.probability} onChange={(e) => setForm((p) => ({ ...p, probability: e.target.value }))}>
              <option value="1">1 – Baja</option><option value="2">2 – Media</option><option value="3">3 – Alta</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <label style={{ fontSize: "0.7rem", color: "#6b7280" }}>Impacto (1-3)</label>
            <select value={form.impact} onChange={(e) => setForm((p) => ({ ...p, impact: e.target.value }))}>
              <option value="1">1 – Bajo</option><option value="2">2 – Medio</option><option value="3">3 – Alto</option>
            </select>
          </div>
          <input placeholder="Categoría" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} style={{ flex: "1 1 8rem" }} />
          <input placeholder="Responsable" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} style={{ flex: "1 1 8rem" }} />
          <button type="submit" disabled={submitting}>{submitting ? "Creando…" : "Agregar riesgo"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Score</th><th>Título</th><th>P × I</th><th>Categoría</th><th>Responsable</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {risks.length === 0 && (
              <tr><td colSpan={canWrite ? 7 : 6} style={{ textAlign: "center", color: "#9ca3af" }}>Sin riesgos registrados</td></tr>
            )}
            {risks.map((r) => (
              <tr key={r.id}>
                <td>
                  <span style={{
                    display: "inline-block", width: "1.6rem", height: "1.6rem", borderRadius: "50%",
                    background: scoreColor(r.riskScore), color: "#fff",
                    fontWeight: 700, fontSize: "0.75rem", lineHeight: "1.6rem", textAlign: "center",
                  }}>
                    {r.riskScore}
                  </span>
                </td>
                <td>{r.title}</td>
                <td style={{ fontSize: "0.75rem" }}>{r.probability} × {r.impact}</td>
                <td>{r.category ?? "—"}</td>
                <td>{r.owner ?? "—"}</td>
                <td>
                  {canWrite ? (
                    <select
                      value={r.status}
                      onChange={async (e) => { await updateRiskStatus(projectId, r.id, e.target.value as RiskStatus); showToast("Estado actualizado", "success"); onReload(); }}
                      style={{ fontSize: "0.75rem" }}
                    >
                      {statusOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
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

function RecursosTab({ assignments }: { assignments: ProjectDetail["assignments"] }) {
  if (assignments.length === 0) {
    return <p style={{ color: "#9ca3af", textAlign: "center", padding: "1rem" }}>Sin asignaciones activas</p>;
  }

  const allocationLabel = (a: ProjectDetail["assignments"][number]) => {
    if (a.allocationMode === "PERCENTAGE" && a.allocationPct != null) return `${a.allocationPct}%`;
    if (a.allocationMode === "HOURS" && a.hoursPerPeriod != null) return `${a.hoursPerPeriod}h/${a.periodUnit ?? "periodo"}`;
    return "—";
  };

  const statusColor: Record<string, string> = {
    ACTIVE: "#22c55e", PLANNED: "#3b82f6", PARTIAL: "#f59e0b",
    COMPLETED: "#9ca3af", CANCELLED: "#ef4444",
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
              <td style={{ fontWeight: 600 }}>{a.consultant?.fullName ?? "—"}</td>
              <td>{a.consultant?.role ?? a.role ?? "—"}</td>
              <td>{a.consultant?.country ? <CountryFlag country={a.consultant.country} /> : "—"}</td>
              <td>
                <span style={{
                  fontWeight: 600, fontSize: "0.75rem",
                  color: statusColor[a.status] ?? "#374151",
                }}>
                  {label(ASSIGNMENT_STATUS_LABELS, a.status)}
                </span>
              </td>
              <td>{allocationLabel(a)}</td>
              <td>{new Date(a.startDate).toLocaleDateString("es-CO")}</td>
              <td>{new Date(a.endDate).toLocaleDateString("es-CO")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

  const severityColor: Record<IssueSeverity, string> = {
    LOW: "#6b7280", MEDIUM: "#f59e0b", HIGH: "#ef4444", CRITICAL: "#7c3aed",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <input placeholder="Título del issue" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "2 1 14rem" }} />
          <select value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as IssueSeverity }))}>
            <option value="LOW">Baja</option><option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option>
          </select>
          <input placeholder="Responsable" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} style={{ flex: "1 1 8rem" }} />
          <button type="submit" disabled={submitting}>{submitting ? "Creando…" : "Agregar issue"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Severidad</th><th>Título</th><th>Responsable</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {issues.length === 0 && (
              <tr><td colSpan={canWrite ? 5 : 4} style={{ textAlign: "center", color: "#9ca3af" }}>Sin issues registrados</td></tr>
            )}
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <span style={{ fontWeight: 700, fontSize: "0.75rem", color: severityColor[issue.severity] }}>
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
                          <div style={{ display: "flex", gap: "0.3rem" }}>
                            <input placeholder="Resolución" value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ fontSize: "0.75rem" }} />
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

  const statusColor: Record<string, string> = {
    PENDING: "#f59e0b", APPROVED: "#22c55e", REJECTED: "#ef4444",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {canWrite && (
        <form onSubmit={(e) => void handleCreate(e)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <input placeholder="Título del cambio" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "2 1 14rem" }} />
          <input placeholder="Descripción" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required style={{ flex: "2 1 14rem" }} />
          <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as ChangeRequestType }))}>
            <option value="SCOPE">Alcance</option><option value="BUDGET">Presupuesto</option>
            <option value="SCHEDULE">Cronograma</option><option value="OTHER">Otro</option>
          </select>
          <input type="number" placeholder="Impacto presupuesto" value={form.impactBudget} onChange={(e) => setForm((p) => ({ ...p, impactBudget: e.target.value }))} style={{ flex: "0 0 9rem" }} />
          <input type="number" placeholder="Impacto días" value={form.impactDays} onChange={(e) => setForm((p) => ({ ...p, impactDays: e.target.value }))} style={{ flex: "0 0 7rem" }} />
          <button type="submit" disabled={submitting}>{submitting ? "Creando…" : "Solicitar cambio"}</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Tipo</th><th>Título</th><th>Impacto $</th><th>Impacto días</th><th>Estado</th><th>Solicitado por</th>{canWrite && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {changeRequests.length === 0 && (
              <tr><td colSpan={canWrite ? 7 : 6} style={{ textAlign: "center", color: "#9ca3af" }}>Sin solicitudes de cambio</td></tr>
            )}
            {changeRequests.map((cr) => (
              <tr key={cr.id}>
                <td style={{ fontSize: "0.75rem" }}>{label(CHANGE_REQUEST_TYPE_LABELS, cr.type)}</td>
                <td>{cr.title}</td>
                <td>{cr.impactBudget ? Number(cr.impactBudget).toLocaleString() : "—"}</td>
                <td>{cr.impactDays ?? "—"}</td>
                <td>
                  <span style={{ fontWeight: 700, fontSize: "0.75rem", color: statusColor[cr.status] ?? "#374151" }}>
                    {label(CHANGE_REQUEST_STATUS_LABELS, cr.status)}
                  </span>
                </td>
                <td style={{ fontSize: "0.75rem" }}>{cr.requestedBy}</td>
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
  if (logs.length === 0) return <p style={{ fontStyle: "italic", color: "var(--text-soft)", textAlign: "center", padding: "2rem" }}>No hay registros de auditoría para este proyecto.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1rem 0" }}>
      <div style={{ position: "relative", paddingLeft: "2.5rem", display: "flex", flexDirection: "column", gap: "2.5rem" }}>
        {/* Vertical Line */}
        <div style={{
          position: "absolute",
          left: "11px",
          top: "8px",
          bottom: "8px",
          width: "2px",
          background: "linear-gradient(to bottom, var(--accent, #3b82f6), #cbd5e1)"
        }} />

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
            <div key={log.id} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {/* Dot indicator */}
              <div style={{
                position: "absolute",
                left: "-33px",
                top: "4px",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: "#fff",
                border: "3px solid var(--accent, #3b82f6)",
                boxShadow: "0 0 0 4px rgba(59, 130, 246, 0.15)",
                zIndex: 2
              }} />

              {/* Time header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-soft)" }}>
                  📅 {date}
                </span>
                <span style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  color: "#1e293b",
                  background: "#e2e8f0",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "20px"
                }}>
                  👤 {log.changedBy}
                </span>
              </div>

              {/* Card wrapper */}
              <div className="card" style={{
                padding: "1rem",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                margin: 0
              }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.88rem", fontWeight: 700, color: "var(--text-strong)", textTransform: "capitalize" }}>
                  Acción: {log.action.toLowerCase().replace(/_/g, " ")}
                </h4>
                {detailsText ? (
                  <pre style={{
                    margin: 0,
                    fontSize: "0.78rem",
                    color: "#475569",
                    whiteSpace: "pre-wrap",
                    fontFamily: "var(--font-mono, monospace)",
                    background: "#f1f5f9",
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1"
                  }}>{detailsText}</pre>
                ) : (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>
                    Modificación de entidad {log.entity} sin detalles específicos de diferencias.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
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

  if (loading) return <div className="loading" style={{ padding: "2rem" }}>Cargando detalle…</div>;
  if (!detail) return <div style={{ padding: "2rem", color: "#ef4444" }}>No se pudo cargar el proyecto.</div>;

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
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="📁"
        title={detail.project.name}
        description={`${detail.project.company} · Tipo: ${detail.project.projectType} · Fase: ${detail.project.phase ?? "Sin definir"}`}
        actions={
          <>
            <button type="button" className="ghost" onClick={onBack} style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px" }}>
              ← Volver
            </button>
            <RagDot status={detail.project.healthStatus} />
          </>
        }
      />

      {/* Sub-tabs nav */}
      <nav style={{ display: "flex", gap: "0.25rem", borderBottom: "2px solid #e5e7eb", paddingBottom: "0" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "0.4rem 0.85rem",
              border: "none",
              borderBottom: activeTab === t.key ? "2px solid var(--accent, #3b82f6)" : "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              fontWeight: activeTab === t.key ? 700 : 400,
              color: activeTab === t.key ? "var(--accent, #3b82f6)" : "#374151",
              fontSize: "0.82rem",
              marginBottom: "-2px",
            }}
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
