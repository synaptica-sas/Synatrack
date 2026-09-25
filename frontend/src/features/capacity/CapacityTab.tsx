import { Fragment, useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
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
  type AllocationMode,
  type Assignment,
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
  listSupportedCountries,
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { downloadCsv } from "../../utils/csv";
import { displayCountryWithFlag } from "../../utils/statusLabels";
import { CountryFlag } from "../../components/CountryFlag";

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

type SubTab = "overview" | "byProject" | "assignments" | "blocks";

// ─── Props ────────────────────────────────────────────────────────────────────

export function CapacityTab({
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
  const [subTab, setSubTab] = useState<SubTab>("overview");

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
      <section className="grid">
      <nav className="subtabs" aria-label="Secciones de capacidad">
        {([
          ["overview", "Vista general"],
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

      {subTab === "overview" && (
        <OverviewPanel projects={projects} consultants={consultants} onError={onError} />
      )}
      {subTab === "byProject" && (
        <ByProjectPanel onError={onError} />
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
                      <td>{row.nextAvailableDate ? new Date(row.nextAvailableDate).toLocaleDateString("es-CO") : <span className="state-chip state-chip--success">Ahora</span>}</td>
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
                        <td colSpan={10} className="capacity-detail-cell">
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
                        <td>{new Date(r.endDate).toLocaleDateString("es-CO")}</td>
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
  const isForecast = (status: string) => status === "FORECAST";
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
        {assignments.map((a) => {
          const forecast = isForecast(a.status);
          return (
            <tr key={a.assignmentId} className={forecast ? "row-warning" : undefined}>
              <td>
                <span className={`state-chip state-chip--${forecast ? "warning" : "neutral"}`}>
                  {forecast ? "Proyección" : "Asignación"}
                </span>
              </td>
              <td>{a.projectName}</td>
              <td className="cell-date">
                {new Date(a.startDate).toLocaleDateString("es-CO")} – {new Date(a.endDate).toLocaleDateString("es-CO")}
              </td>
              <td>
                {forecast
                  ? `${a.hoursPerPeriod ?? 0}h (trimestre)`
                  : a.allocationMode === "PERCENTAGE"
                    ? `${a.allocationPct ?? 0}%`
                    : `${a.hoursPerPeriod ?? 0}h/sem`}
              </td>
              <td>
                <span
                  className={`state-chip state-chip--${forecast ? "warning" : ASSIGNMENT_STATUS_CLASS[a.status as AssignmentStatus] ?? "neutral"}`}
                >
                  {forecast ? "Forecast" : ASSIGNMENT_STATUS_LABELS[a.status as AssignmentStatus] ?? a.status}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── By Project Panel ─────────────────────────────────────────────────────────

function ByProjectPanel({ onError }: { onError: (msg: string) => void }) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(lastDayOfMonth());
  const [rows, setRows] = useState<ProjectCapacitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);

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
                          {r.consultants.length > 0 && (
                            <button type="button" className="ghost capacity-btn-row" onClick={() => setExpandedProject(expandedProject === r.projectId ? null : r.projectId)}>
                              {expandedProject === r.projectId ? "▲" : `▼ ver detalle`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedProject === r.projectId && (
                        <tr>
                          <td colSpan={7} className="capacity-detail-cell">
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

const emptyAssignmentForm = {
  projectId: "",
  consultantId: "",
  startDate: "",
  endDate: "",
  allocationMode: "PERCENTAGE" as AllocationMode,
  allocationPct: "100",
  hoursPerPeriod: "",
  periodUnit: "week" as "week" | "month",
  role: "",
  note: "",
};

function AssignmentsPanel({
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
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyAssignmentForm);
  const [filterProject, setFilterProject] = useState("");
  const [filterConsultant, setFilterConsultant] = useState("");
  const [filterStatus, setFilterStatus] = useState<AssignmentStatus | "">("");
  const [cancelTarget, setCancelTarget] = useState<Assignment | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Assignment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assignment | null>(null);

  const [multipleMode, setMultipleMode] = useState(false);
  const [selectedConsultantIds, setSelectedConsultantIds] = useState<string[]>([]);
  const [consultantSearch, setConsultantSearch] = useState("");
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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (multipleMode) {
        if (selectedConsultantIds.length === 0) {
          throw new Error("Selecciona al menos un consultor.");
        }
        await Promise.all(
          selectedConsultantIds.map((cId) =>
            createAssignment({
              projectId: form.projectId,
              consultantId: cId,
              startDate: form.startDate,
              endDate: form.endDate,
              allocationMode: form.allocationMode,
              allocationPct: form.allocationMode === "PERCENTAGE" ? Number(form.allocationPct) : undefined,
              hoursPerPeriod: form.allocationMode === "HOURS" ? Number(form.hoursPerPeriod) : undefined,
              periodUnit: form.allocationMode === "HOURS" ? form.periodUnit : undefined,
              role: form.role || undefined,
              note: form.note || undefined,
            })
          )
        );
        setSelectedConsultantIds([]);
      } else {
        if (!form.consultantId) {
          throw new Error("Selecciona un consultor.");
        }
        await createAssignment({
          projectId: form.projectId,
          consultantId: form.consultantId,
          startDate: form.startDate,
          endDate: form.endDate,
          allocationMode: form.allocationMode,
          allocationPct: form.allocationMode === "PERCENTAGE" ? Number(form.allocationPct) : undefined,
          hoursPerPeriod: form.allocationMode === "HOURS" ? Number(form.hoursPerPeriod) : undefined,
          periodUnit: form.allocationMode === "HOURS" ? form.periodUnit : undefined,
          role: form.role || undefined,
          note: form.note || undefined,
        });
      }
      setForm(emptyAssignmentForm);
      setIsModalOpen(false);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo crear la asignación");
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
                  <th>Estado</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.consultant?.fullName ?? a.consultantId}</td>
                    <td>{a.project?.name ?? a.projectId}</td>
                    <td>{new Date(a.startDate).toLocaleDateString("es-CO")}</td>
                    <td>{new Date(a.endDate).toLocaleDateString("es-CO")}</td>
                    <td>
                      {a.allocationMode === "PERCENTAGE"
                        ? `${a.allocationPct ?? 0}%`
                        : `${a.hoursPerPeriod ?? 0}h/${a.periodUnit ?? "semana"}`}
                    </td>
                    <td><span className={`state-chip state-chip--${ASSIGNMENT_STATUS_CLASS[a.status]}`}>{ASSIGNMENT_STATUS_LABELS[a.status]}</span></td>
                    {canWrite && (
                      <td>
                        <div className="inline-actions">
                          {(a.status === "PLANNED" || a.status === "ACTIVE" || a.status === "PARTIAL") && (
                            <>
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
                  <tr><td colSpan={canWrite ? 7 : 6} className="cell-empty cell-empty--roomy">No hay asignaciones con los filtros seleccionados.</td></tr>
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

      {/* Modal para Crear Nueva Asignación */}
      {canWrite && isModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => { setIsModalOpen(false); setForm(emptyAssignmentForm); }}>
          <div className="modal-card capacity-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header capacity-modal-header">
              <h2 className="capacity-modal-title">
                Nueva asignación
              </h2>
              <button
                type="button"
                className="ghost capacity-modal-close"
                aria-label="Cerrar"
                onClick={() => { setIsModalOpen(false); setForm(emptyAssignmentForm); }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleCreate(e)} className="form-grid two-col capacity-form">

              <div className="capacity-field capacity-field--full">
                <label className="field-label" htmlFor="asignacion-proyecto">Proyecto *</label>
                <select id="asignacion-proyecto" value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))} required>
                  <option value="" disabled hidden>Selecciona proyecto...</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="capacity-field capacity-field--full">
                <label className="check capacity-check">
                  <input
                    type="checkbox"
                    checked={multipleMode}
                    onChange={(e) => {
                      setMultipleMode(e.target.checked);
                      setSelectedConsultantIds([]);
                    }}
                  />
                  Asignar múltiples consultores
                </label>
              </div>

              <div className="capacity-field capacity-field--full">
                <label className="field-label" htmlFor="asignacion-consultor">
                  {multipleMode ? "Consultores *" : "Consultor *"}
                </label>
                {!multipleMode ? (
                  <select id="asignacion-consultor" value={form.consultantId} onChange={(e) => setForm((p) => ({ ...p, consultantId: e.target.value }))} required={!multipleMode}>
                    <option value="" disabled hidden>Selecciona consultor...</option>
                    {consultants.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.fullName} — {c.role}</option>)}
                  </select>
                ) : (
                  <div className="capacity-picker">
                    <input
                      id="asignacion-consultor"
                      type="text"
                      className="capacity-picker__search"
                      placeholder="Buscar consultor por nombre/rol..."
                      value={consultantSearch}
                      onChange={(e) => setConsultantSearch(e.target.value)}
                    />
                    <div className="capacity-picker__actions">
                      <button
                        type="button"
                        className="ghost capacity-btn-row"
                        onClick={() => {
                          const filtered = consultants.filter((c) => c.active && (c.fullName.toLowerCase().includes(consultantSearch.toLowerCase()) || c.role.toLowerCase().includes(consultantSearch.toLowerCase())));
                          setSelectedConsultantIds(filtered.map((c) => c.id));
                        }}
                      >
                        Seleccionar todos
                      </button>
                      <button
                        type="button"
                        className="ghost capacity-btn-row"
                        onClick={() => setSelectedConsultantIds([])}
                      >
                        Desmarcar todos
                      </button>
                    </div>
                    <div className="capacity-picker__list">
                      {consultants
                        .filter((c) => c.active)
                        .filter((c) => c.fullName.toLowerCase().includes(consultantSearch.toLowerCase()) || c.role.toLowerCase().includes(consultantSearch.toLowerCase()))
                        .map((c) => {
                          const isChecked = selectedConsultantIds.includes(c.id);
                          return (
                            <label key={c.id} className="check capacity-check">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedConsultantIds((prev) =>
                                    isChecked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                  );
                                }}
                              />
                              <span>{c.fullName} <span className="capacity-picker__role">({c.role})</span></span>
                            </label>
                          );
                        })}
                    </div>
                    <span className="capacity-picker__count">
                      {selectedConsultantIds.length} seleccionados
                    </span>
                  </div>
                )}
              </div>

              <div className="capacity-field">
                <label className="field-label" htmlFor="asignacion-inicio">Fecha de inicio *</label>
                <input id="asignacion-inicio" type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} required />
              </div>

              <div className="capacity-field">
                <label className="field-label" htmlFor="asignacion-fin">Fecha de fin *</label>
                <input id="asignacion-fin" type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} required />
              </div>

              <div className="capacity-field">
                <label className="field-label" htmlFor="asignacion-modo">Modo de asignación *</label>
                <select id="asignacion-modo" value={form.allocationMode} onChange={(e) => setForm((p) => ({ ...p, allocationMode: e.target.value as AllocationMode }))}>
                  <option value="PERCENTAGE">Por porcentaje</option>
                  <option value="HOURS">Por horas</option>
                </select>
              </div>

              {form.allocationMode === "PERCENTAGE" ? (
                <div className="capacity-field">
                  <label className="field-label" htmlFor="asignacion-pct">Porcentaje de capacidad *</label>
                  <input id="asignacion-pct" type="number" min="1" max="200" step="1" placeholder="% de capacidad (ej: 100)" value={form.allocationPct} onChange={(e) => setForm((p) => ({ ...p, allocationPct: e.target.value }))} required />
                </div>
              ) : (
                <div className="capacity-field-pair">
                  <div className="capacity-field capacity-field--grow">
                    <label className="field-label" htmlFor="asignacion-horas">Horas *</label>
                    <input id="asignacion-horas" type="number" min="1" step="0.5" placeholder="Horas" value={form.hoursPerPeriod} onChange={(e) => setForm((p) => ({ ...p, hoursPerPeriod: e.target.value }))} required />
                  </div>
                  <div className="capacity-field capacity-field--grow">
                    <label className="field-label" htmlFor="asignacion-periodo">Período *</label>
                    <select id="asignacion-periodo" value={form.periodUnit} onChange={(e) => setForm((p) => ({ ...p, periodUnit: e.target.value as "week" | "month" }))}>
                      <option value="week">Por semana</option>
                      <option value="month">Por mes</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="capacity-field capacity-field--full">
                <label className="field-label" htmlFor="asignacion-rol">Rol en el proyecto (opcional)</label>
                <input id="asignacion-rol" placeholder="Rol en el proyecto" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} />
              </div>

              <div className="capacity-field capacity-field--full">
                <label className="field-label" htmlFor="asignacion-nota">Nota (opcional)</label>
                <textarea id="asignacion-nota" placeholder="Nota" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
              </div>

              <div className="modal-actions capacity-modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => { setIsModalOpen(false); setForm(emptyAssignmentForm); }}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button type="submit" disabled={submitting}>
                  {submitting ? "Creando…" : "Crear asignación"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
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
          <option value="">Selecciona un consultor para ver sus bloqueos</option>
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
                      <td><span className="state-chip state-chip--neutral">{BLOCK_TYPE_LABELS[b.blockType]}</span></td>
                      <td>{new Date(b.startDate).toLocaleDateString("es-CO")}</td>
                      <td>{new Date(b.endDate).toLocaleDateString("es-CO")}</td>
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
        message={`¿Eliminar el bloqueo de ${deleteTarget ? BLOCK_TYPE_LABELS[deleteTarget.blockType] : ""} para "${deleteTarget?.consultantName}"?`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

export default CapacityTab;
