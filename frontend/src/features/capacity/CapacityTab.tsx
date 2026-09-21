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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  FREE: "Libre",
  PARTIAL: "Parcial",
  FULL: "Completo",
  OVERLOADED: "Sobrecargado",
};
const STATUS_CLASS: Record<AvailabilityStatus, string> = {
  FREE: "ok",
  PARTIAL: "warn",
  FULL: "neutral",
  OVERLOADED: "error",
};

const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  PLANNED: "Planeada",
  ACTIVE: "Activa",
  PARTIAL: "Parcial",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};
const ASSIGNMENT_STATUS_CLASS: Record<AssignmentStatus, string> = {
  PLANNED: "warn",
  ACTIVE: "ok",
  PARTIAL: "warn",
  COMPLETED: "neutral",
  CANCELLED: "error",
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

function utilizationBar(pct: number) {
  const clamped = Math.min(pct, 150);
  const color = pct > 100 ? "#dc2626" : pct >= 80 ? "#f59e0b" : "#16a34a";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <div style={{ flex: 1, height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ width: `${(clamped / 150) * 100}%`, height: "100%", background: color, borderRadius: "4px" }} />
      </div>
      <span style={{ fontSize: "0.8rem", color, fontWeight: 600, minWidth: "3.5rem", textAlign: "right" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="◉"
        title="Planificación de Capacidad"
        description="Visualiza y gestiona la asignación de consultores, disponibilidad y ocupación a lo largo de los proyectos."
      />
      <section className="grid">
      <nav className="sub-tabs" style={{ display: "flex", gap: "0.5rem", padding: "0 0 0.75rem 0" }}>
        {([
          ["overview", "Vista general"],
          ["byProject", "Por proyecto"],
          ["assignments", "Asignaciones"],
          ["blocks", "Bloqueos"],
        ] as [SubTab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={subTab === id ? "tab active" : "tab"}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>Filtros</h3>
          <button type="button" className="ghost"
            onClick={() => {
              setFrom(firstDayOfMonth());
              setTo(lastDayOfMonth());
              setStatusFilter("");
              setCountryFilter("");
              setSeniorityFilter("");
              setSkillFilter("");
            }}
            style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem", borderRadius: "8px", height: "34px", display: "flex", alignItems: "center", gap: "0.3rem" }}
          >
            🧹 Limpiar
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Estado</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AvailabilityStatus | "")}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            >
              <option value="">Todos los estados</option>
              <option value="FREE">Libre</option>
              <option value="PARTIAL">Parcial</option>
              <option value="FULL">Completo</option>
              <option value="OVERLOADED">Sobrecargado</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>País</label>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            >
              <option value="">Todos los países</option>
              {countries.map((c) => <option key={c} value={c}>{displayCountryWithFlag(c)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Seniority</label>
            <select
              value={seniorityFilter}
              onChange={(e) => setSeniorityFilter(e.target.value)}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            >
              <option value="">Todos los seniority</option>
              {seniorities.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Skill / Especialidad</label>
            <input
              placeholder="Ej: React, SQL..."
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            />
          </div>
        </div>
      </article>

      {loading && <p className="loading">Cargando capacidad...</p>}

      {/* KPI Summary */}
      {!loading && overview && (
        <section className="grid dashboard-grid">
          <article className="card kpi"><h3>Consultores activos</h3><p>{overview.summary.totalConsultants}</p></article>
          <article className="card kpi"><h3>Libres</h3><p style={{ color: "#16a34a" }}>{overview.summary.freeCount}</p></article>
          <article className="card kpi"><h3>Parcialmente ocupados</h3><p style={{ color: "#d97706" }}>{overview.summary.partialCount}</p></article>
          <article className="card kpi"><h3>100% ocupados</h3><p>{overview.summary.fullCount}</p></article>
          <article className="card kpi"><h3>Sobrecargados</h3><p style={{ color: "#dc2626" }}>{overview.summary.overloadedCount}</p></article>
          <article className="card kpi">
            <h3>Utilización global</h3>
            <p style={{ color: overview.summary.utilizationPct > 100 ? "#dc2626" : "inherit" }}>{overview.summary.utilizationPct.toFixed(1)}%</p>
          </article>
        </section>
      )}

      {/* Consultant table */}
      {!loading && overview && (
        <article className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>Disponibilidad por consultor</h3>
            <button type="button" className="ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }} onClick={handleExport} disabled={overview.consultants.length === 0}>
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
                      <td><span className={`pill ${STATUS_CLASS[row.availabilityStatus]}`}>{STATUS_LABELS[row.availabilityStatus]}</span></td>
                      <td>{row.capacityHours.toFixed(1)}h</td>
                      <td>{row.committedHours.toFixed(1)}h</td>
                      <td style={{ color: row.availableHours > 0 ? "#16a34a" : undefined }}>{row.availableHours.toFixed(1)}h</td>
                      <td style={{ minWidth: "10rem" }}>{utilizationBar(row.utilizationPct)}</td>
                      <td>{row.nextAvailableDate ? new Date(row.nextAvailableDate).toLocaleDateString("es-CO") : <span className="pill ok">Ahora</span>}</td>
                      <td>
                        {row.activeAssignments.length > 0 && (
                          <button type="button" className="ghost" style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem" }} onClick={() => setExpandedConsultant(expandedConsultant === row.consultantId ? null : row.consultantId)}>
                            {expandedConsultant === row.consultantId ? "▲" : `▼ ${row.activeAssignments.length}`}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedConsultant === row.consultantId && (
                      <tr>
                        <td colSpan={10} style={{ background: "#f9fafb", padding: "0.75rem 1rem" }}>
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
                        <td style={{ color: "#16a34a", fontWeight: 600 }}>{c.capacityHours.toFixed(1)}h</td>
                        <td>
                          <div className="tag-list">
                            {c.skills.slice(0, 4).map((s) => <span key={s} className="pill neutral" style={{ fontSize: "0.7rem" }}>{s}</span>)}
                            {c.skills.length > 4 && <span className="pill neutral" style={{ fontSize: "0.7rem" }}>+{c.skills.length - 4}</span>}
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
              <h3>Próximos a liberar</h3>
              <select value={within} onChange={(e) => setWithin(Number(e.target.value))} style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem" }}>
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
                        <td><span className={`pill ${r.daysUntilRelease <= 7 ? "error" : "warn"}`}>{r.daysUntilRelease}d</span></td>
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
    <table style={{ width: "100%", fontSize: "0.8rem" }}>
      <thead>
        <tr>
          {["Fuente", "Proyecto", "Período", "Horas comprometidas", "Estado"].map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "0.25rem 0.5rem", fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {assignments.map((a) => {
          const forecast = isForecast(a.status);
          return (
            <tr key={a.assignmentId} style={forecast ? { background: "#fffbf0" } : undefined}>
              <td style={{ padding: "0.25rem 0.5rem" }}>
                <span className={`pill ${forecast ? "warn" : "neutral"}`} style={{ fontSize: "0.68rem" }}>
                  {forecast ? "Proyección" : "Asignación"}
                </span>
              </td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{a.projectName}</td>
              <td style={{ padding: "0.25rem 0.5rem", whiteSpace: "nowrap" }}>
                {new Date(a.startDate).toLocaleDateString("es-CO")} – {new Date(a.endDate).toLocaleDateString("es-CO")}
              </td>
              <td style={{ padding: "0.25rem 0.5rem" }}>
                {forecast
                  ? `${a.hoursPerPeriod ?? 0}h (trimestre)`
                  : a.allocationMode === "PERCENTAGE"
                    ? `${a.allocationPct ?? 0}%`
                    : `${a.hoursPerPeriod ?? 0}h/sem`}
              </td>
              <td style={{ padding: "0.25rem 0.5rem" }}>
                <span
                  className={`pill ${forecast ? "warn" : ASSIGNMENT_STATUS_CLASS[a.status as AssignmentStatus] ?? "neutral"}`}
                  style={{ fontSize: "0.68rem" }}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }} />
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
                        <td><span className={`pill ${r.projectStatus === "ACTIVE" ? "ok" : r.projectStatus === "PAUSED" ? "warn" : "neutral"}`}>{r.projectStatus}</span></td>
                        <td>{r.assignedConsultants}</td>
                        <td style={{ fontWeight: 600 }}>{r.totalCommittedHours.toFixed(1)}h</td>
                        <td>{totalHours > 0 ? `${((r.totalCommittedHours / totalHours) * 100).toFixed(1)}%` : "—"}</td>
                        {/* `null` = el rol no puede ver tarifas (DEP-38); 0 = no hay costo. Ambos se pintan "—". */}
                        <td>{r.totalEstimatedCost !== null && r.totalEstimatedCost > 0 ? money(r.totalEstimatedCost, r.consultants[0]?.currency ?? "USD") : "—"}</td>
                        <td>
                          {r.consultants.length > 0 && (
                            <button type="button" className="ghost" style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem" }} onClick={() => setExpandedProject(expandedProject === r.projectId ? null : r.projectId)}>
                              {expandedProject === r.projectId ? "▲" : `▼ ver detalle`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedProject === r.projectId && (
                        <tr>
                          <td colSpan={7} style={{ background: "#f9fafb", padding: "0.75rem 1rem" }}>
                            <table style={{ width: "100%", fontSize: "0.8rem" }}>
                              <thead>
                                <tr>
                                  {["Consultor", "Horas comprometidas", "Costo estimado"].map((h) => (
                                    <th key={h} style={{ textAlign: "left", padding: "0.25rem 0.5rem", fontWeight: 600 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {r.consultants.map((c) => (
                                  <tr key={c.consultantId}>
                                    <td style={{ padding: "0.25rem 0.5rem" }}>{c.fullName}</td>
                                    <td style={{ padding: "0.25rem 0.5rem" }}>{c.committedHours.toFixed(1)}h</td>
                                    <td style={{ padding: "0.25rem 0.5rem" }}>{c.estimatedCost !== null && c.estimatedCost > 0 ? money(c.estimatedCost, c.currency) : "—"}</td>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <article className="card" style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>Listado de asignaciones</h3>
          {canWrite && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              style={{ fontSize: "0.85rem", padding: "0.5rem 1.2rem", borderRadius: "8px" }}
            >
              + Nueva asignación
            </button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Proyecto</label>
            <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}>
              <option value="">Todos los proyectos</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Consultor</label>
            <select value={filterConsultant} onChange={(e) => setFilterConsultant(e.target.value)} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}>
              <option value="">Todos los consultores</option>
              {consultants.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem", textAlign: "center" }}>Estado de Asignación</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as AssignmentStatus | "")} style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}>
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
                    <td><span className={`pill ${ASSIGNMENT_STATUS_CLASS[a.status]}`}>{ASSIGNMENT_STATUS_LABELS[a.status]}</span></td>
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
                  <tr><td colSpan={canWrite ? 7 : 6} style={{ textAlign: "center", color: "#9ca3af", padding: "1rem" }}>No hay asignaciones con los filtros seleccionados.</td></tr>
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
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "680px", maxHeight: "90vh", overflowY: "auto" }}>
            <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color, #e2e8f0)", paddingBottom: "0.75rem", marginBottom: "1.25rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.2rem", color: "var(--text-strong, #1e293b)" }}>
                Nueva asignación
              </h2>
              <button
                type="button"
                className="ghost"
                onClick={() => { setIsModalOpen(false); setForm(emptyAssignmentForm); }}
                style={{ fontSize: "1.1rem", padding: "0.2rem 0.5rem", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={(e) => void handleCreate(e)} className="form-grid two-col" style={{ gap: "1.2rem", alignItems: "start" }}>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Proyecto *</label>
                <select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))} required style={{ width: "100%" }}>
                  <option value="" disabled hidden>Selecciona proyecto...</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", gridColumn: "1 / -1" }}>
                <label className="check" style={{ userSelect: "none", fontSize: "0.82rem", fontWeight: 600 }}>
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

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>
                  {multipleMode ? "Consultores *" : "Consultor *"}
                </label>
                {!multipleMode ? (
                  <select value={form.consultantId} onChange={(e) => setForm((p) => ({ ...p, consultantId: e.target.value }))} required={!multipleMode} style={{ width: "100%" }}>
                    <option value="" disabled hidden>Selecciona consultor...</option>
                    {consultants.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.fullName} — {c.role}</option>)}
                  </select>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "0.75rem", background: "var(--card-bg)" }}>
                    <input
                      type="text"
                      placeholder="Buscar consultor por nombre/rol..."
                      value={consultantSearch}
                      onChange={(e) => setConsultantSearch(e.target.value)}
                      style={{ padding: "0.4rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                        onClick={() => {
                          const filtered = consultants.filter((c) => c.active && (c.fullName.toLowerCase().includes(consultantSearch.toLowerCase()) || c.role.toLowerCase().includes(consultantSearch.toLowerCase())));
                          setSelectedConsultantIds(filtered.map((c) => c.id));
                        }}
                      >
                        Seleccionar todos
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                        onClick={() => setSelectedConsultantIds([])}
                      >
                        Desmarcar todos
                      </button>
                    </div>
                    <div style={{ maxHeight: "150px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.25rem" }}>
                      {consultants
                        .filter((c) => c.active)
                        .filter((c) => c.fullName.toLowerCase().includes(consultantSearch.toLowerCase()) || c.role.toLowerCase().includes(consultantSearch.toLowerCase()))
                        .map((c) => {
                          const isChecked = selectedConsultantIds.includes(c.id);
                          return (
                            <label key={c.id} className="check" style={{ fontSize: "0.82rem", userSelect: "none" }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedConsultantIds((prev) =>
                                    isChecked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                  );
                                }}
                              />
                              <span>{c.fullName} <span style={{ color: "var(--color-accent)", fontSize: "0.75rem" }}>({c.role})</span></span>
                            </label>
                          );
                        })}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600 }}>
                      {selectedConsultantIds.length} seleccionados
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Fecha de inicio *</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} required style={{ width: "100%" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Fecha de fin *</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} required style={{ width: "100%" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Modo de asignación *</label>
                <select value={form.allocationMode} onChange={(e) => setForm((p) => ({ ...p, allocationMode: e.target.value as AllocationMode }))} style={{ width: "100%" }}>
                  <option value="PERCENTAGE">Por porcentaje</option>
                  <option value="HOURS">Por horas</option>
                </select>
              </div>

              {form.allocationMode === "PERCENTAGE" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Porcentaje de capacidad *</label>
                  <input type="number" min="1" max="200" step="1" placeholder="% de capacidad (ej: 100)" value={form.allocationPct} onChange={(e) => setForm((p) => ({ ...p, allocationPct: e.target.value }))} required style={{ width: "100%" }} />
                </div>
              ) : (
                <div style={{ display: "flex", gap: "0.75rem", gridColumn: "span 1" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: 1 }}>
                    <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Horas *</label>
                    <input type="number" min="1" step="0.5" placeholder="Horas" value={form.hoursPerPeriod} onChange={(e) => setForm((p) => ({ ...p, hoursPerPeriod: e.target.value }))} required style={{ width: "100%" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: 1 }}>
                    <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Período *</label>
                    <select value={form.periodUnit} onChange={(e) => setForm((p) => ({ ...p, periodUnit: e.target.value as "week" | "month" }))} style={{ width: "100%" }}>
                      <option value="week">Por semana</option>
                      <option value="month">Por mes</option>
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Rol en el proyecto (opcional)</label>
                <input placeholder="Rol en el proyecto" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} style={{ width: "100%" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong, #1e293b)" }}>Nota (opcional)</label>
                <textarea placeholder="Nota" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} style={{ width: "100%", minHeight: "80px" }} />
              </div>

              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem", gridColumn: "1 / -1", borderTop: "1px solid #e2e8f0", paddingTop: "1rem" }}>
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
          <p className="fx-note" style={{ marginBottom: "0.75rem" }}>Registra períodos de no disponibilidad: vacaciones, incapacidades, festivos o bench interno.</p>
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

      <article className="card" style={canWrite ? {} : { gridColumn: "1 / -1" }}>
        <h3>Bloqueos por consultor</h3>
        <select
          value={filterConsultant}
          onChange={(e) => setFilterConsultant(e.target.value)}
          style={{ marginBottom: "0.75rem", width: "100%", maxWidth: "22rem" }}
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
                      <td><span className="pill neutral">{BLOCK_TYPE_LABELS[b.blockType]}</span></td>
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
