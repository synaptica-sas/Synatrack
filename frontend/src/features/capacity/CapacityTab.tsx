import { Fragment, useEffect, useState, useMemo } from "react";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import {
  cancelAssignment,
  completeAssignment,
  createAssignment,
  createConsultantBlock,
  deleteAssignment,
  deleteConsultantBlock,
  getCapacityByProject,
  getCapacityOverview,
  getCapacityReleasing,
  listAssignments,
  listConsultantBlocks,
  listRisks,
  updateAssignment,
  type Assignment,
  type AssignmentWarning,
  type AssignmentStatus,
  type AvailabilityStatus,
  type BlockType,
  type CapacityConsultantRow,
  type CapacityOverview,
  type Consultant,
  type ConsultantBlock,
  type Project,
  type ProjectCapacitySummary,
  type ReleasingEntry,
  type Risk,
  listSupportedCountries,
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { downloadCsv } from "../../utils/csv";
import { displayCountryWithFlag } from "../../utils/statusLabels";
import { CountryFlag } from "../../components/CountryFlag";
import { formatDate } from "../../utils/formatDate";
import { useToast } from "../../hooks/useToast";
import { MonthlyCapacityPanel } from "./monthly/MonthlyCapacityPanel";
import { ReportsPanel } from "./reports/ReportsPanel";
import { AssignmentFormModal } from "./AssignmentFormModal";
import {
  CERTAINTY_LABELS,
  emptyAssignmentForm,
  mensajeAdvertencias,
  validarAsignacion,
  type AssignmentFormState,
} from "./assignmentForm";

/**
 * Planificación de Capacidad, migrada al sistema de diseño
 * (`documentacion/DISENO.md`): sin colores literales y sin estilos en línea
 * salvo el ancho calculado del relleno del medidor de utilización.
 *
 * El color nunca viaja solo: cada estado se nombra con su etiqueta dentro del
 * chip (`.state-chip`) y el medidor lleva siempre su porcentaje visible.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  FREE: "Libre",
  PARTIAL: "Parcial",
  FULL: "Completo",
  OVERLOADED: "Sobrecargado",
};
/** Modificador de `.state-chip` por estado de disponibilidad. */
const STATUS_CLASS: Record<AvailabilityStatus, string> = {
  FREE: "success",
  PARTIAL: "warning",
  FULL: "neutral",
  OVERLOADED: "danger",
};

const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  PLANNED: "Planeada",
  ACTIVE: "Activa",
  PARTIAL: "Parcial",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};
/** Modificador de `.state-chip` por estado de asignación. */
const ASSIGNMENT_STATUS_CLASS: Record<AssignmentStatus, string> = {
  PLANNED: "warning",
  ACTIVE: "success",
  PARTIAL: "warning",
  COMPLETED: "neutral",
  CANCELLED: "danger",
};

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  VACATION: "Vacaciones",
  SICK_LEAVE: "Incapacidad",
  NATIONAL_HOLIDAY: "Festivo nacional",
  INTERNAL_BENCH: "Bench interno",
  TRAINING: "Capacitación",
  OTHER: "Otro",
};

const BLOCK_TYPES: BlockType[] = ["VACATION", "SICK_LEAVE", "NATIONAL_HOLIDAY", "INTERNAL_BENCH", "TRAINING", "OTHER"];

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

/**
 * Medidor de utilización. El ancho del relleno es el único estilo en línea que
 * queda en la pantalla, porque es un valor calculado; el color sale de
 * `--state-*-solid` y el porcentaje siempre se ve escrito al lado.
 */
function utilizationBar(pct: number) {
  const clamped = Math.min(pct, 150);
  const mod = pct > 100 ? "danger" : pct >= 80 ? "warning" : "success";
  return (
    <div className="meter">
      <div className="meter__track">
        <div className={`meter__fill meter__fill--${mod}`} style={{ width: `${(clamped / 150) * 100}%` }} />
      </div>
      <span className={`meter__value capacity-util capacity-util--${mod}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

type SubTab = "monthly" | "reports" | "overview" | "byProject" | "assignments" | "blocks";

// ─── Props ────────────────────────────────────────────────────────────────────

export function CapacityTab({
  projects,
  consultants,
  canWrite,
  onError,
  preselectedConsultantId,
  onClearPreselectedConsultant,
  onOpenProject,
  canPublish = false,
}: {
  projects: Project[];
  consultants: Consultant[];
  canWrite: boolean;
  /** `capacity:publish` (ADMIN): publicar y anular reportes oficiales. */
  canPublish?: boolean;
  onError: (msg: string) => void;
  preselectedConsultantId?: string | null;
  onClearPreselectedConsultant?: () => void;
  /** Para ir al detalle del proyecto desde los riesgos por consultor (R-015). */
  onOpenProject?: (projectId: string) => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("monthly");
  const [reportId, setReportId] = useState<string | null>(null);

  const [prevPreselected, setPrevPreselected] = useState(preselectedConsultantId);
  if (preselectedConsultantId !== prevPreselected) {
    setPrevPreselected(preselectedConsultantId);
    if (preselectedConsultantId) {
      setSubTab("assignments");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        icon="◉"
        title="Planificación de Capacidad"
        description="Visualiza y gestiona la asignación de consultores, disponibilidad y ocupación a lo largo de los proyectos."
      />
      <section className="grid cap-shell">
      <nav className="subtabs" aria-label="Secciones de capacidad">
        {([
          ["monthly", "Mensual"],
          ["reports", "Reportes oficiales"],
          ["overview", "Disponibilidad"],
          ["byProject", "Por proyecto"],
          ["assignments", "Asignaciones"],
          ["blocks", "Bloqueos"],
        ] as [SubTab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={subTab === id ? "subtab is-active" : "subtab"}
            aria-current={subTab === id ? "page" : undefined}
            onClick={() => setSubTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {subTab === "monthly" && (
        <MonthlyCapacityPanel
          canPublish={canPublish}
          onOpenReport={(id) => {
            setReportId(id);
            setSubTab("reports");
          }}
        />
      )}
      {subTab === "reports" && (
        <ReportsPanel canPublish={canPublish} selectedId={reportId} onSelect={setReportId} />
      )}
      {subTab === "overview" && (
        <OverviewPanel projects={projects} consultants={consultants} onError={onError} />
      )}
      {subTab === "byProject" && (
        <ByProjectPanel onError={onError} onOpenProject={onOpenProject} />
      )}
      {subTab === "assignments" && (
        <AssignmentsPanel
          projects={projects}
          consultants={consultants}
          canWrite={canWrite}
          onError={onError}
          preselectedConsultantId={preselectedConsultantId}
          onClearPreselectedConsultant={onClearPreselectedConsultant}
        />
      )}
      {subTab === "blocks" && (
        <BlocksPanel consultants={consultants} canWrite={canWrite} onError={onError} />
      )}
    </section>
    </div>
  );
}

// ─── Overview Panel ───────────────────────────────────────────────────────────

function OverviewPanel({
  projects,
  consultants,
  onError,
}: {
  projects: Project[];
  consultants: Consultant[];
  onError: (msg: string) => void;
}) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(lastDayOfMonth());
  const [statusFilter, setStatusFilter] = useState<AvailabilityStatus | "">("");
  const [countryFilter, setCountryFilter] = useState("");
  const [seniorityFilter, setSeniorityFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [within, setWithin] = useState(30);
  const [overview, setOverview] = useState<CapacityOverview | null>(null);
  const [releasing, setReleasing] = useState<ReleasingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedConsultant, setExpandedConsultant] = useState<string | null>(null);

  // Fetch supported countries from backend
  const [supportedCountries, setSupportedCountries] = useState<string[]>([]);
  useEffect(() => {
    void listSupportedCountries().then(setSupportedCountries).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [ov, rel] = await Promise.all([
        getCapacityOverview({ from, to, status: statusFilter || undefined, country: countryFilter || undefined, seniority: seniorityFilter || undefined, skill: skillFilter || undefined }),
        getCapacityReleasing(within),
      ]);
      setOverview(ov);
      setReleasing(rel);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error cargando capacidad");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [from, to, statusFilter, countryFilter, seniorityFilter, skillFilter, within]); // eslint-disable-line react-hooks/exhaustive-deps

  const countries = useMemo(() => {
    const list = new Set<string>();
    // Países soportados desde el backend:
    supportedCountries.filter(c => c !== "Default").forEach(c => list.add(c));
    // Más cualquier otro país presente en los consultores o proyectos:
    consultants.forEach((c) => { if (c.country) list.add(c.country); });
    projects.forEach((p) => { if (p.country) list.add(p.country); });
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [consultants, projects, supportedCountries]);

  const seniorities = useMemo(() => {
    const list = new Set<string>();
    // Opción predefinida de seniorities:
    ["Junior", "Mid", "Senior", "Lead"].forEach(s => list.add(s));
    // Más cualquier otro seniority presente en los consultores:
    consultants.forEach((c) => { if (c.seniority) list.add(c.seniority); });
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [consultants]);

  const bench = overview?.consultants.filter((c) => c.availabilityStatus === "FREE") ?? [];

  function handleExport() {
    if (!overview) return;
    downloadCsv(
      overview.consultants.map((c) => ({
        consultor: c.fullName,
        rol: c.role,
        pais: c.country ?? "",
        estado: STATUS_LABELS[c.availabilityStatus],
        capacidad: c.capacityHours.toFixed(1),
        comprometidas: c.committedHours.toFixed(1),
        disponibles: c.availableHours.toFixed(1),
        utilizacion: `${c.utilizationPct.toFixed(1)}%`,
        costoTotal: c.estimatedCost !== null ? money(c.estimatedCost, c.costCurrency) : "—",
      })),
      [
        { key: "consultor", label: "Consultor" },
        { key: "rol", label: "Rol" },
        { key: "pais", label: "País" },
        { key: "estado", label: "Estado" },
        { key: "capacidad", label: "Horas capacidad" },
        { key: "comprometidas", label: "Horas comprometidas" },
        { key: "disponibles", label: "Horas disponibles" },
        { key: "utilizacion", label: "Utilización" },
        { key: "costoTotal", label: "Costo total estimado" },
      ],
      "capacidad",
    );
  }

  return (
    <>
      {/* Filters */}
      <article className="card">
        <div className="card-head">
          <h3>Filtros</h3>
          <button type="button" className="ghost capacity-btn-sm"
            onClick={() => {
              setFrom(firstDayOfMonth());
              setTo(lastDayOfMonth());
              setStatusFilter("");
              setCountryFilter("");
              setSeniorityFilter("");
              setSkillFilter("");
            }}
          >
            🧹 Limpiar
          </button>
        </div>

        <div className="field-grid field-grid--compact">
          <div>
            <label className="field-label" htmlFor="capacidad-desde">Desde</label>
            <input id="capacidad-desde" className="select-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="capacidad-hasta">Hasta</label>
            <input id="capacidad-hasta" className="select-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="capacidad-estado">Estado</label>
            <select
              id="capacidad-estado"
              className="select-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AvailabilityStatus | "")}
            >
              <option value="">Todos los estados</option>
              <option value="FREE">Libre</option>
              <option value="PARTIAL">Parcial</option>
              <option value="FULL">Completo</option>
              <option value="OVERLOADED">Sobrecargado</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="capacidad-pais">País</label>
            <select
              id="capacidad-pais"
              className="select-control"
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
            >
              <option value="">Todos los países</option>
              {countries.map((c) => <option key={c} value={c}>{displayCountryWithFlag(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="capacidad-seniority">Seniority</label>
            <select
              id="capacidad-seniority"
              className="select-control"
              value={seniorityFilter}
              onChange={(e) => setSeniorityFilter(e.target.value)}
            >
              <option value="">Todos los seniority</option>
              {seniorities.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="capacidad-skill">Skill / Especialidad</label>
            <input
              id="capacidad-skill"
              className="select-control"
              placeholder="Ej: React, SQL..."
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
            />
          </div>
        </div>
      </article>

      {loading && <p className="loading">Cargando capacidad...</p>}

      {/* KPI Summary */}
      {!loading && overview && (
        <section className="grid dashboard-grid">
          <article className="card kpi"><h3>Consultores activos</h3><p>{overview.summary.totalConsultants}</p></article>
          <article className="card kpi"><h3>Libres</h3><p className="tone-success">{overview.summary.freeCount}</p></article>
          <article className="card kpi"><h3>Parcialmente ocupados</h3><p className="tone-warning">{overview.summary.partialCount}</p></article>
          <article className="card kpi"><h3>100% ocupados</h3><p>{overview.summary.fullCount}</p></article>
          <article className="card kpi"><h3>Sobrecargados</h3><p className="tone-danger">{overview.summary.overloadedCount}</p></article>
          <article className="card kpi">
            <h3>Utilización global</h3>
            <p className={overview.summary.utilizationPct > 100 ? "tone-danger" : undefined}>{overview.summary.utilizationPct.toFixed(1)}%</p>
          </article>
        </section>
      )}

      {/* Consultant table */}
      {!loading && overview && (
        <article className="card">
          <div className="card-head">
            <h3>Disponibilidad por consultor</h3>
            <button type="button" className="ghost capacity-btn-sm" onClick={handleExport} disabled={overview.consultants.length === 0}>
              Exportar CSV
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultor</th>
                  <th>Rol</th>
                  <th>País</th>
                  <th>Estado</th>
                  <th>Cap. h</th>
                  <th>Comp. h</th>
                  <th>Disp. h</th>
                  <th>Utilización</th>
                  <th>Próx. libre</th>
                  <th>Costo total est.</th>
                  <th>Asignaciones</th>
                </tr>
              </thead>
              <tbody>
                {overview.consultants.map((row) => (
                  <Fragment key={row.consultantId}>
                    <tr>
                      <td>{row.fullName}</td>
                      <td>{row.role}</td>
                      <td>{row.country ? <CountryFlag country={row.country} /> : "—"}</td>
                      <td><span className={`state-chip state-chip--${STATUS_CLASS[row.availabilityStatus]}`}>{STATUS_LABELS[row.availabilityStatus]}</span></td>
                      <td>{row.capacityHours.toFixed(1)}h</td>
                      <td>{row.committedHours.toFixed(1)}h</td>
                      <td className={row.availableHours > 0 ? "tone-success" : undefined}>{row.availableHours.toFixed(1)}h</td>
                      <td className="capacity-col-util">{utilizationBar(row.utilizationPct)}</td>
                      <td>{row.nextAvailableDate ? formatDate(row.nextAvailableDate) : <span className="state-chip state-chip--success">Ahora</span>}</td>
                      {/* `null` = el rol no puede ver tarifas (DEP-38); 0 = sin costo. Ambos se pintan "—". */}
                      <td>{row.estimatedCost !== null && row.estimatedCost > 0 ? money(row.estimatedCost, row.costCurrency) : "—"}</td>
                      <td>
                        {row.activeAssignments.length > 0 && (
                          <button type="button" className="ghost capacity-btn-row" onClick={() => setExpandedConsultant(expandedConsultant === row.consultantId ? null : row.consultantId)}>
                            {expandedConsultant === row.consultantId ? "▲" : `▼ ${row.activeAssignments.length}`}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedConsultant === row.consultantId && (
                      <tr>
                        <td colSpan={11} className="capacity-detail-cell">
                          <AssignmentDetail assignments={row.activeAssignments} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {/* Bench + Releasing */}
      {!loading && (
        <section className="grid two-col">
          <article className="card">
            <h3>Bench — sin asignación activa ({bench.length})</h3>
            {bench.length === 0 ? (
              <p className="fx-note">No hay consultores completamente libres en el período seleccionado.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Consultor</th><th>Rol</th><th>País</th><th>Horas disponibles</th><th>Skills</th></tr>
                  </thead>
                  <tbody>
                    {bench.map((c) => (
                      <tr key={c.consultantId}>
                        <td>{c.fullName}</td>
                        <td>{c.role}</td>
                        <td>{c.country ? <CountryFlag country={c.country} /> : "—"}</td>
                        <td className="cell-strong tone-success">{c.capacityHours.toFixed(1)}h</td>
                        <td>
                          <div className="tag-list">
                            {c.skills.slice(0, 4).map((s) => <span key={s} className="state-chip state-chip--neutral">{s}</span>)}
                            {c.skills.length > 4 && <span className="state-chip state-chip--neutral">+{c.skills.length - 4}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="card">
            <div className="card-head">
              <h3>Próximos a liberar</h3>
              <select
                className="capacity-inline-select"
                aria-label="Ventana de días para próximos a liberar"
                value={within}
                onChange={(e) => setWithin(Number(e.target.value))}
              >
                <option value={7}>7 días</option>
                <option value={14}>14 días</option>
                <option value={30}>30 días</option>
                <option value={60}>60 días</option>
              </select>
            </div>
            {releasing.length === 0 ? (
              <p className="fx-note">No hay asignaciones que terminen en los próximos {within} días.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Consultor</th><th>Proyecto</th><th>Fecha fin</th><th>Días restantes</th><th>% Asig.</th></tr>
                  </thead>
                  <tbody>
                    {releasing.map((r) => (
                      <tr key={r.assignmentId}>
                        <td>{r.consultant.fullName}</td>
                        <td>{r.project.name}</td>
                        <td>{formatDate(r.endDate)}</td>
                        <td><span className={`state-chip state-chip--${r.daysUntilRelease <= 7 ? "danger" : "warning"}`}>{r.daysUntilRelease}d</span></td>
                        <td>{r.allocationPct !== null ? `${r.allocationPct}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      )}
    </>
  );
}

function AssignmentDetail({ assignments }: { assignments: CapacityConsultantRow["activeAssignments"] }) {
  return (
    <table className="capacity-subtable">
      <thead>
        <tr>
          {["Fuente", "Proyecto", "Período", "Horas comprometidas", "Estado"].map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {assignments.map((a) => (
          <tr key={a.assignmentId}>
            <td>
              <span className="state-chip state-chip--neutral">Asignación</span>
            </td>
            <td>{a.projectName}</td>
            <td className="cell-date">
              {formatDate(a.startDate)} – {formatDate(a.endDate)}
            </td>
            <td>
              {a.allocationMode === "PERCENTAGE"
                ? `${a.allocationPct ?? 0}%`
                : `${a.hoursPerPeriod ?? 0}h/sem`}
            </td>
            <td>
              <span
                className={`state-chip state-chip--${ASSIGNMENT_STATUS_CLASS[a.status as AssignmentStatus] ?? "neutral"}`}
              >
                {ASSIGNMENT_STATUS_LABELS[a.status as AssignmentStatus] ?? a.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── By Project Panel ─────────────────────────────────────────────────────────

function ByProjectPanel({ onError, onOpenProject }: { onError: (msg: string) => void; onOpenProject?: (projectId: string) => void }) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(lastDayOfMonth());
  const [rows, setRows] = useState<ProjectCapacitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [risksLoading, setRisksLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getCapacityByProject({ from, to });
      setRows(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error cargando capacidad por proyecto");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleExpand(projectId: string) {
    if (expandedProject === projectId) {
      setExpandedProject(null);
      return;
    }
    setExpandedProject(projectId);
    setRisksLoading(true);
    try {
      setRisks(await listRisks(projectId));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error cargando riesgos del proyecto");
      setRisks([]);
    } finally {
      setRisksLoading(false);
    }
  }

  // R-015: riesgos del proyecto expandido, agrupados por consultor responsable.
  // Solo lectura: editar/crear riesgos sigue viviendo en Detalle del proyecto.
  const riskGroups = useMemo(() => {
    const open = risks.filter((r) => r.status === "OPEN" || r.status === "MITIGATED");
    const map = new Map<string, { label: string; risks: Risk[] }>();
    for (const r of open) {
      const key = r.consultantId ?? "__sin_consultor__";
      const label = r.consultant?.fullName ?? "Sin consultor asignado";
      if (!map.has(key)) map.set(key, { label, risks: [] });
      map.get(key)!.risks.push(r);
    }
    return Array.from(map.values());
  }, [risks]);

  const totalHours = rows.reduce((s, r) => s + r.totalCommittedHours, 0);

  return (
    <>
      <article className="card">
        <h3>Filtros de período</h3>
        <div className="field-grid field-grid--compact">
          <div>
            <label className="field-label" htmlFor="capacidad-proyecto-desde">Desde</label>
            <input id="capacidad-proyecto-desde" className="select-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="capacidad-proyecto-hasta">Hasta</label>
            <input id="capacidad-proyecto-hasta" className="select-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </article>

      {loading && <p className="loading">Cargando...</p>}

      {!loading && (
        <article className="card">
          <h3>Capacidad consumida por proyecto</h3>
          {rows.length === 0 ? (
            <p className="fx-note">No hay proyectos activos con asignaciones en el período.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Estado</th>
                    <th>Consultores asignados</th>
                    <th>Horas comprometidas</th>
                    <th>% del total</th>
                    <th>Costo estimado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.projectId}>
                      <tr>
                        <td>{r.projectName}</td>
                        <td><span className={`state-chip state-chip--${r.projectStatus === "ACTIVE" ? "success" : r.projectStatus === "PAUSED" ? "warning" : "neutral"}`}>{r.projectStatus}</span></td>
                        <td>{r.assignedConsultants}</td>
                        <td className="cell-strong">{r.totalCommittedHours.toFixed(1)}h</td>
                        <td>{totalHours > 0 ? `${((r.totalCommittedHours / totalHours) * 100).toFixed(1)}%` : "—"}</td>
                        {/* `null` = el rol no puede ver tarifas (DEP-38); 0 = no hay costo. Ambos se pintan "—". */}
                        <td>{r.totalEstimatedCost !== null && r.totalEstimatedCost > 0 ? money(r.totalEstimatedCost, r.consultants[0]?.currency ?? "USD") : "—"}</td>
                        <td>
                          <button type="button" className="ghost capacity-btn-row" onClick={() => void toggleExpand(r.projectId)}>
                            {expandedProject === r.projectId ? "▲" : `▼ ver detalle`}
                          </button>
                        </td>
                      </tr>
                      {expandedProject === r.projectId && (
                        <tr>
                          <td colSpan={7} className="capacity-detail-cell">
                            {r.consultants.length > 0 && (
                              <table className="capacity-subtable">
                                <thead>
                                  <tr>
                                    {["Consultor", "Horas comprometidas", "Costo estimado"].map((h) => (
                                      <th key={h}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.consultants.map((c) => (
                                    <tr key={c.consultantId}>
                                      <td>{c.fullName}</td>
                                      <td>{c.committedHours.toFixed(1)}h</td>
                                      <td>{c.estimatedCost !== null && c.estimatedCost > 0 ? money(c.estimatedCost, c.currency) : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <div className="capacity-risks">
                              <h4>Riesgos abiertos por consultor</h4>
                              {risksLoading ? (
                                <p className="loading">Cargando riesgos...</p>
                              ) : riskGroups.length === 0 ? (
                                <p className="fx-note">Sin riesgos abiertos para este proyecto.</p>
                              ) : (
                                <ul className="capacity-risks__list">
                                  {riskGroups.map((g) => (
                                    <li key={g.label}>
                                      <strong>{g.label}</strong>
                                      <ul>
                                        {g.risks.map((risk) => (
                                          <li key={risk.id}>
                                            <span className={`score-dot score-dot--${risk.riskScore >= 6 ? "danger" : risk.riskScore >= 3 ? "warning" : "success"}`}>
                                              {risk.riskScore}
                                            </span>{" "}
                                            {risk.title}
                                          </li>
                                        ))}
                                      </ul>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {onOpenProject && (
                                <button type="button" className="ghost capacity-btn-row" onClick={() => onOpenProject(r.projectId)}>
                                  Ver / editar en Detalle del proyecto
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}
    </>
  );
}

// ─── Assignments Panel ────────────────────────────────────────────────────────

/** Exportado solo para poder probarlo sin montar la pestaña entera. */
export function AssignmentsPanel({
  projects,
  consultants,
  canWrite,
  onError,
  preselectedConsultantId,
  onClearPreselectedConsultant,
}: {
  projects: Project[];
  consultants: Consultant[];
  canWrite: boolean;
  onError: (msg: string) => void;
  preselectedConsultantId?: string | null;
  onClearPreselectedConsultant?: () => void;
}) {
  const { showToast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<AssignmentFormState>(emptyAssignmentForm);
  const [filterProject, setFilterProject] = useState("");
  const [filterConsultant, setFilterConsultant] = useState("");
  const [filterStatus, setFilterStatus] = useState<AssignmentStatus | "">("");
  const [cancelTarget, setCancelTarget] = useState<Assignment | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Assignment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assignment | null>(null);
  // R-014: misma modal de creación, en modo edición cuando no es null.
  const [editTarget, setEditTarget] = useState<Assignment | null>(null);

  const [multipleMode, setMultipleMode] = useState(false);
  const [selectedConsultantIds, setSelectedConsultantIds] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (preselectedConsultantId) {
      setFilterConsultant(preselectedConsultantId);
      setMultipleMode(false);
      setForm((p) => ({
        ...p,
        consultantId: preselectedConsultantId,
      }));
      if (onClearPreselectedConsultant) {
        onClearPreselectedConsultant();
      }
    }
  }, [preselectedConsultantId, onClearPreselectedConsultant]);

  async function reload() {
    setLoading(true);
    try {
      const data = await listAssignments({
        projectId: filterProject || undefined,
        consultantId: filterConsultant || undefined,
        status: filterStatus || undefined,
      });
      setAssignments(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error cargando asignaciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [filterProject, filterConsultant, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  function closeModal() {
    setIsModalOpen(false);
    setForm(emptyAssignmentForm);
    setMultipleMode(false);
    setSelectedConsultantIds([]);
    setEditTarget(null);
  }

  /** R-014: abre la misma modal precargada con los datos de la asignación. */
  function openEditModal(a: Assignment) {
    setEditTarget(a);
    setMultipleMode(false);
    setForm({
      projectId: a.projectId,
      consultantId: a.consultantId,
      startDate: a.startDate.slice(0, 10),
      endDate: a.endDate.slice(0, 10),
      allocationMode: a.allocationMode,
      allocationPct: a.allocationPct != null ? String(a.allocationPct) : "100",
      hoursPerPeriod: a.hoursPerPeriod != null ? String(a.hoursPerPeriod) : "",
      periodUnit: (a.periodUnit as "week" | "month") || "week",
      certainty: a.certainty ?? "CONFIRMED",
      role: a.role ?? "",
      note: a.note ?? "",
    });
    setIsModalOpen(true);
  }

  /** Payload común de crear/editar: horas por semana por defecto; fechas `YYYY-MM-DD`. */
  function buildPayload(consultantId: string) {
    return {
      projectId: form.projectId,
      consultantId,
      startDate: form.startDate,
      endDate: form.endDate,
      allocationMode: form.allocationMode,
      allocationPct: form.allocationMode === "PERCENTAGE" ? Number(form.allocationPct) : undefined,
      hoursPerPeriod: form.allocationMode === "HOURS" ? Number(form.hoursPerPeriod.replace(",", ".")) : undefined,
      periodUnit: form.allocationMode === "HOURS" ? form.periodUnit : undefined,
      certainty: form.certainty,
      role: form.role || undefined,
      note: form.note || undefined,
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problema = validarAsignacion(form);
    if (problema) {
      onError(problema);
      return;
    }
    setSubmitting(true);
    try {
      let warnings: AssignmentWarning[] = [];
      if (editTarget) {
        const r = await updateAssignment(editTarget.id, buildPayload(form.consultantId));
        warnings = r.warnings ?? [];
        showToast("Asignación actualizada.", "success");
      } else if (multipleMode) {
        if (selectedConsultantIds.length === 0) {
          throw new Error("Selecciona al menos un consultor.");
        }
        const results = await Promise.all(selectedConsultantIds.map((cId) => createAssignment(buildPayload(cId))));
        warnings = results.flatMap((r) => r.warnings ?? []);
        setSelectedConsultantIds([]);
        showToast(`${results.length} asignaciones creadas.`, "success");
      } else {
        if (!form.consultantId) {
          throw new Error("Selecciona un consultor.");
        }
        const r = await createAssignment(buildPayload(form.consultantId));
        warnings = r.warnings ?? [];
        showToast("Asignación creada.", "success");
      }
      // La sobreasignación avisa pero no bloquea: la asignación ya quedó guardada.
      const aviso = mensajeAdvertencias(warnings);
      if (aviso) showToast(aviso, "warning");
      closeModal();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : `No se pudo ${editTarget ? "editar" : "crear"} la asignación`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    setCancelTarget(null);
    try {
      await cancelAssignment(id);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cancelar la asignación");
    }
  }

  async function handleComplete() {
    if (!completeTarget) return;
    const id = completeTarget.id;
    setCompleteTarget(null);
    try {
      await completeAssignment(id);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo completar la asignación");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteAssignment(id);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar la asignación");
    }
  }

  return (
    <div className="section-stack">
      <article className="card">
        <div className="card-head">
          <h3>Listado de asignaciones</h3>
          {canWrite && (
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => setIsModalOpen(true)}
            >
              + Nueva asignación
            </button>
          )}
        </div>
        <div className="field-grid field-grid--compact capacity-filters">
          <div>
            <label className="field-label" htmlFor="asignaciones-proyecto">Proyecto</label>
            <select id="asignaciones-proyecto" className="select-control" value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
              <option value="">Todos los proyectos</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="asignaciones-consultor">Consultor</label>
            <select id="asignaciones-consultor" className="select-control" value={filterConsultant} onChange={(e) => setFilterConsultant(e.target.value)}>
              <option value="">Todos los consultores</option>
              {consultants.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="asignaciones-estado">Estado de Asignación</label>
            <select id="asignaciones-estado" className="select-control" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as AssignmentStatus | "")}>
              <option value="">Todos los estados</option>
              {(Object.keys(ASSIGNMENT_STATUS_LABELS) as AssignmentStatus[]).map((s) => (
                <option key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>
        {loading ? <p className="loading">Cargando...</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultor</th>
                  <th>Proyecto</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Asignación</th>
                  <th>Certeza</th>
                  <th>Estado</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.consultant?.fullName ?? a.consultantId}</td>
                    <td>{a.project?.name ?? a.projectId}</td>
                    <td>{formatDate(a.startDate)}</td>
                    <td>{formatDate(a.endDate)}</td>
                    <td>
                      {a.allocationMode === "PERCENTAGE"
                        ? `${a.allocationPct ?? 0}%`
                        : `${a.hoursPerPeriod ?? 0}h/${a.periodUnit ?? "semana"}`}
                    </td>
                    <td>
                      <span className={`state-chip state-chip--${a.certainty === "PROBABLE" ? "warning" : "success"}`}>
                        {CERTAINTY_LABELS[a.certainty ?? "CONFIRMED"]}
                      </span>
                    </td>
                    <td><span className={`state-chip state-chip--${ASSIGNMENT_STATUS_CLASS[a.status]}`}>{ASSIGNMENT_STATUS_LABELS[a.status]}</span></td>
                    {canWrite && (
                      <td>
                        <div className="inline-actions">
                          {(a.status === "PLANNED" || a.status === "ACTIVE" || a.status === "PARTIAL") && (
                            <>
                              <button type="button" className="ghost" onClick={() => openEditModal(a)}>Editar</button>
                              <button type="button" onClick={() => setCompleteTarget(a)}>Completar</button>
                              <button type="button" className="ghost" onClick={() => setCancelTarget(a)}>Cancelar</button>
                            </>
                          )}
                          {(a.status === "PLANNED" || a.status === "CANCELLED") && (
                            <button type="button" className="ghost" onClick={() => setDeleteTarget(a)}>Eliminar</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr><td colSpan={canWrite ? 8 : 7} className="cell-empty cell-empty--roomy">No hay asignaciones con los filtros seleccionados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancelar asignación"
        message={`¿Cancelar la asignación de "${cancelTarget?.consultant?.fullName}" en "${cancelTarget?.project?.name}"?`}
        confirmLabel="Cancelar asignación"
        danger
        onConfirm={() => void handleCancel()}
        onCancel={() => setCancelTarget(null)}
      />
      <ConfirmDialog
        open={!!completeTarget}
        title="Completar asignación"
        message={`¿Marcar como completada la asignación de "${completeTarget?.consultant?.fullName}" en "${completeTarget?.project?.name}"?`}
        confirmLabel="Completar"
        onConfirm={() => void handleComplete()}
        onCancel={() => setCompleteTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar asignación"
        message={`¿Eliminar la asignación de "${deleteTarget?.consultant?.fullName}" en "${deleteTarget?.project?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Modal para Crear/Editar Asignación */}
      {canWrite && isModalOpen && (
        <AssignmentFormModal
          editing={!!editTarget}
          form={form}
          setForm={setForm}
          projects={projects}
          consultants={consultants}
          multipleMode={multipleMode}
          onMultipleModeChange={setMultipleMode}
          selectedConsultantIds={selectedConsultantIds}
          setSelectedConsultantIds={setSelectedConsultantIds}
          submitting={submitting}
          onSubmit={(e) => void handleSubmit(e)}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ─── Blocks Panel ─────────────────────────────────────────────────────────────

const emptyBlockForm = {
  consultantId: "",
  startDate: "",
  endDate: "",
  blockType: "VACATION" as BlockType,
  note: "",
};

function BlocksPanel({
  consultants,
  canWrite,
  onError,
}: {
  consultants: Consultant[];
  canWrite: boolean;
  onError: (msg: string) => void;
}) {
  const [blocks, setBlocks] = useState<(ConsultantBlock & { consultantName: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyBlockForm);
  const [filterConsultant, setFilterConsultant] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<(ConsultantBlock & { consultantName: string }) | null>(null);

  async function reload(consultantId: string) {
    if (!consultantId) { setBlocks([]); return; }
    setLoading(true);
    try {
      const data = await listConsultantBlocks(consultantId);
      const name = consultants.find((c) => c.id === consultantId)?.fullName ?? consultantId;
      setBlocks(data.map((b) => ({ ...b, consultantName: name })));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error cargando bloqueos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(filterConsultant); }, [filterConsultant]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createConsultantBlock(form.consultantId, {
        startDate: form.startDate,
        endDate: form.endDate,
        blockType: form.blockType,
        note: form.note || undefined,
      });
      setForm(emptyBlockForm);
      if (filterConsultant === form.consultantId) await reload(filterConsultant);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo crear el bloqueo");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const blockId = deleteTarget.id;
    const consultantId = deleteTarget.consultantId;
    setDeleteTarget(null);
    try {
      await deleteConsultantBlock(consultantId, blockId);
      await reload(filterConsultant);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar el bloqueo");
    }
  }

  return (
    <section className="grid two-col">
      {canWrite && (
        <article className="card">
          <h3>Registrar bloqueo</h3>
          <p className="fx-note capacity-form-note">Registra períodos de no disponibilidad: vacaciones, incapacidades, festivos o bench interno.</p>
          <form onSubmit={(e) => void handleCreate(e)} className="form-grid">
            <select value={form.consultantId} onChange={(e) => setForm((p) => ({ ...p, consultantId: e.target.value }))} required>
              <option value="">Consultor</option>
              {consultants.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
            <select value={form.blockType} onChange={(e) => setForm((p) => ({ ...p, blockType: e.target.value as BlockType }))}>
              {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_TYPE_LABELS[t]}</option>)}
            </select>
            <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} required />
            <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} required />
            <textarea placeholder="Nota (opcional)" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
            <button type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar bloqueo"}</button>
          </form>
        </article>
      )}

      <article className={canWrite ? "card" : "card capacity-span-full"}>
        <h3>Bloqueos por consultor</h3>
        <select
          className="capacity-block-filter"
          aria-label="Consultor del que ver los bloqueos"
          value={filterConsultant}
          onChange={(e) => setFilterConsultant(e.target.value)}
        >
          <option value="">Elige un consultor</option>
          {consultants.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
        </select>
        {loading ? <p className="loading">Cargando...</p> : !filterConsultant ? (
          <p className="fx-note">Selecciona un consultor para ver sus períodos de no disponibilidad.</p>
        ) : blocks.length === 0 ? (
          <p className="fx-note">Este consultor no tiene bloqueos registrados.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Días</th>
                  <th>Nota</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => {
                  const days = Math.round((new Date(b.endDate).getTime() - new Date(b.startDate).getTime()) / 86_400_000) + 1;
                  return (
                    <tr key={b.id}>
                      <td><span className="state-chip state-chip--neutral">{b.blockType ? BLOCK_TYPE_LABELS[b.blockType] : "No disponible"}</span></td>
                      <td>{formatDate(b.startDate)}</td>
                      <td>{formatDate(b.endDate)}</td>
                      <td>{days}d</td>
                      <td>{b.note || "—"}</td>
                      {canWrite && (
                        <td>
                          <button type="button" className="ghost" onClick={() => setDeleteTarget(b)}>Eliminar</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar bloqueo"
        message={`¿Eliminar el bloqueo de ${deleteTarget?.blockType ? BLOCK_TYPE_LABELS[deleteTarget.blockType] : ""} para "${deleteTarget?.consultantName}"?`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

export default CapacityTab;
