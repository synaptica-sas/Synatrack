import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import { PROJECT_STATUS_LABELS, label } from "../../utils/statusLabels";
import {
  createProject,
  deleteProject,
  updateProject,
  type Project,
  type ProjectStatus,
  type ProjectType,
  type HealthStatus,
  type StatsProjectRowEnriched,
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SectionLayout } from "../../components/SectionLayout";
import { downloadCsv } from "../../utils/csv";
import { backendHealthToResult, textoCriteriosSalud } from "../../utils/projectHealth";
import { ValidationErrorBox } from "../../components/ValidationErrorBox";
import { isValidationError } from "../../utils/validation";
import { CurrencyInput } from "../../components/CurrencyInput";

function RagBadge({ status, marginThreshold }: { status: HealthStatus | undefined; marginThreshold?: number | null }) {
  if (!status) return <span style={{ color: "var(--color-sec-gray)", fontSize: "0.75rem" }}>—</span>;
  const result = backendHealthToResult(status);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.45rem",
        borderRadius: "9999px",
        background: result.color,
        color: "#fff",
        fontWeight: 700,
        fontSize: "0.7rem",
        letterSpacing: "0.04em",
      }}
      title={textoCriteriosSalud(marginThreshold)}
    >
      {result.label}
    </span>
  );
}

function BudgetBar({ pct }: { pct: number }) {
  const capped = Math.min(pct, 100);
  const color = pct > 100 ? "var(--color-sec-red)" : pct > 90 ? "var(--color-accent)" : "var(--color-sec-green)";
  return (
    <div style={{ width: "6rem", height: "0.5rem", background: "var(--color-primary-10)", borderRadius: "9999px", overflow: "hidden" }}>
      <div style={{ width: `${capped}%`, height: "100%", background: color, transition: "width 0.3s" }} />
    </div>
  );
}

const currencyOptions = ["COP", "USD", "EUR", "MXN", "PEN", "CLP"];

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function numberish(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateInput(value: string) {
  return value.slice(0, 10);
}

type EditForm = {
  id: string;
  name: string;
  company: string;
  country: string;
  currency: string;
  budget: string;
  startDate: string;
  endDate: string;
  description: string;
  projectType: ProjectType;
  status: ProjectStatus;
  sellPrice: string;
  sellCurrency: string;
  allowExtraHours: boolean;
  projectManagerEmail: string;
  marginThreshold: string;
  budgetAlertPct: string;
};

const emptyForm = {
  name: "",
  company: "",
  country: "",
  currency: "",
  budget: "",
  startDate: "",
  endDate: "",
  description: "",
  projectType: "TIME_AND_MATERIAL" as ProjectType,
  status: "ACTIVE" as ProjectStatus,
  sellPrice: "",
  sellCurrency: "USD",
  allowExtraHours: true,
  // Correo del PM (DEP-37). Vacío = sin PM asignado; el backend lo guarda como null.
  projectManagerEmail: "",
  /**
   * Umbrales de R10. Los dos se envían como cadena y el backend los coacciona a
   * número, pero la cadena vacía NO significa lo mismo en los dos:
   *  - `marginThreshold` es nulable: vacío = sin umbral propio, se aplica el
   *    valor por defecto del backend (15 %).
   *  - `budgetAlertPct` no admite nulo: vacío = no tocar, conserva el valor
   *    que ya tenga la fila (90 % por defecto).
   */
  marginThreshold: "",
  budgetAlertPct: "",
};

/** Texto de ayuda de los umbrales, compartido por el alta y la edición. */
const AYUDA_UMBRAL_MARGEN =
  "Margen bruto mínimo en % (0–100) para que el proyecto siga en verde. " +
  "Déjalo vacío para no fijar un umbral propio: se aplicará el valor por defecto del sistema (15 %).";

const AYUDA_UMBRAL_PRESUPUESTO =
  "% de consumo de presupuesto a partir del cual el proyecto pasa a aviso (0–100). " +
  "Déjalo vacío para no modificarlo: este campo no admite vacío, así que se conserva el valor actual (90 % por defecto).";

export function ProjectsTab({
  projects,
  loading,
  canWrite,
  onReload,
  onError,
  statsProjects,
  onOpenProject,
}: {
  projects: Project[];
  loading: boolean;
  canWrite: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  statsProjects?: StatsProjectRowEnriched[];
  onOpenProject?: (id: string) => void;
}) {
  const [companyFilter, setCompanyFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthStatus | "">("");
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const statsMap = new Map<string, StatsProjectRowEnriched>(
    (statsProjects ?? []).map((s) => [s.projectId, s]),
  );

  const companyOptions = useMemo(() => {
    const unique = new Set(projects.map((p) => p.company).filter(Boolean));
    return Array.from(unique).sort((a, b) => a.localeCompare(b)).map((c) => ({ value: c, label: c }));
  }, [projects]);

  const projectOptions = useMemo(() => {
    return projects.map((p) => ({ value: p.id, label: p.name }));
  }, [projects]);

  const filtered = projects.filter((p) => {
    const matchesProject = !projectFilter ||
      p.id === projectFilter ||
      p.name.toLowerCase().includes(projectFilter.toLowerCase());
    const matchesCompany = !companyFilter ||
      p.company.toLowerCase().includes(companyFilter.toLowerCase());
    const matchesHealth =
      !healthFilter || statsMap.get(p.id)?.healthStatus === healthFilter;
    return matchesProject && matchesCompany && matchesHealth;
  });

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      await createProject({
        ...form,
        budget: Number(form.budget),
        sellPrice: form.sellPrice ? Number(form.sellPrice) : undefined,
      });
      setForm(emptyForm);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo crear proyecto";
      if (isValidationError(msg)) {
        setFormError(msg);
      } else {
        onError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editForm) return;
    setEditError("");
    setEditSubmitting(true);
    try {
      await updateProject(editForm.id, {
        name: editForm.name,
        company: editForm.company,
        country: editForm.country,
        currency: editForm.currency,
        budget: Number(editForm.budget),
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        description: editForm.description,
        projectType: editForm.projectType,
        status: editForm.status,
        sellPrice: editForm.sellPrice ? Number(editForm.sellPrice) : undefined,
        sellCurrency: editForm.sellCurrency,
        allowExtraHours: editForm.allowExtraHours,
        projectManagerEmail: editForm.projectManagerEmail,
        // Se envían tal cual (cadena incluida): la cadena vacía es significativa
        // y el backend le da a cada campo el tratamiento que le corresponde.
        marginThreshold: editForm.marginThreshold,
        budgetAlertPct: editForm.budgetAlertPct,
      });
      setEditForm(null);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo actualizar proyecto";
      if (isValidationError(msg)) {
        setEditError(msg);
      } else {
        onError(msg);
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  function handleExport() {
    downloadCsv(
      filtered.map((p) => ({
        nombre: p.name,
        empresa: p.company,
        pais: p.country,
        tipo: p.projectType,
        estado: p.status,
        moneda: p.currency,
        presupuesto: numberish(p.budget).toFixed(2),
        precioVenta: p.sellPrice ? numberish(p.sellPrice).toFixed(2) : "",
        monedaVenta: p.sellCurrency,
        projectManager: p.projectManagerEmail ?? "",
        inicio: p.startDate.slice(0, 10),
        fin: p.endDate.slice(0, 10),
      })),
      [
        { key: "nombre", label: "Nombre" },
        { key: "empresa", label: "Empresa" },
        { key: "pais", label: "País" },
        { key: "tipo", label: "Tipo" },
        { key: "estado", label: "Estado" },
        { key: "moneda", label: "Moneda" },
        { key: "presupuesto", label: "Presupuesto" },
        { key: "precioVenta", label: "Precio Venta" },
        { key: "monedaVenta", label: "Moneda Venta" },
        { key: "projectManager", label: "Project Manager" },
        { key: "inicio", label: "Fecha Inicio" },
        { key: "fin", label: "Fecha Fin" },
      ],
      "proyectos",
    );
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteProject(id);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar proyecto");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="◻"
        title="Gestión de Proyectos"
        description="Crea, edita y administra proyectos, presupuestos, fechas límites y configuraciones de horas extras."
      />
      <SectionLayout
        title="Proyectos"
        newLabel="+ Nuevo proyecto"
        canWrite={canWrite}
        onExport={handleExport}
        exportDisabled={filtered.length === 0}
        form={
          <form onSubmit={(e) => void handleCreate(e)} className="form-inline">
            <ValidationErrorBox message={formError} />
            <input placeholder="Nombre" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
            <input placeholder="Empresa" value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} required />
            <input placeholder="País" value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))} required />
            <select value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} required>
              <option value="" disabled hidden>Selecciona moneda...</option>
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <CurrencyInput
              currency={form.currency || "USD"}
              placeholder="Presupuesto (costo)"
              value={form.budget}
              onChange={(v) => setForm((p) => ({ ...p, budget: v }))}
              required
            />
            <select value={form.projectType} onChange={(e) => setForm((p) => ({ ...p, projectType: e.target.value as ProjectType }))}>
              <option value="TIME_AND_MATERIAL">Tiempo y Material</option>
              <option value="FIXED_PRICE">Precio Fijo</option>
              <option value="STAFFING">Staffing</option>
            </select>
            <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ProjectStatus }))}>
              <option value="ACTIVE">Activo</option>
              <option value="PAUSED">Pausado</option>
              <option value="CLOSED">Cerrado</option>
            </select>
            <CurrencyInput
              currency={form.sellCurrency || "USD"}
              placeholder="Precio de venta (opcional)"
              value={form.sellPrice}
              onChange={(v) => setForm((p) => ({ ...p, sellPrice: v }))}
            />
            <select value={form.sellCurrency} onChange={(e) => setForm((p) => ({ ...p, sellCurrency: e.target.value }))}>
              {currencyOptions.map((c) => <option key={`sell-${c}`} value={c}>{`Venta: ${c}`}</option>)}
            </select>
            <input
              type="email"
              placeholder="Correo del Project Manager (opcional)"
              title="Correo corporativo de quien aprueba las horas extra del proyecto"
              value={form.projectManagerEmail}
              onChange={(e) => setForm((p) => ({ ...p, projectManagerEmail: e.target.value }))}
            />
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              placeholder="Umbral de margen % (opcional)"
              title={AYUDA_UMBRAL_MARGEN}
              value={form.marginThreshold}
              onChange={(e) => setForm((p) => ({ ...p, marginThreshold: e.target.value }))}
            />
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              placeholder="Aviso de presupuesto % (opcional)"
              title={AYUDA_UMBRAL_PRESUPUESTO}
              value={form.budgetAlertPct}
              onChange={(e) => setForm((p) => ({ ...p, budgetAlertPct: e.target.value }))}
            />
            <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: "0.72rem", lineHeight: 1.4, color: "var(--text-soft)" }}>
              <strong>Umbral de margen</strong>: vacío significa «sin umbral propio» y se aplica el valor por defecto del
              sistema (15 %). <strong>Aviso de presupuesto</strong>: vacío significa «no modificar»; este campo no admite
              vacío y conserva su valor actual (90 % por defecto).
            </p>
            <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} required />
            <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} required />
            <textarea placeholder="Descripción" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem", color: "var(--text-soft)", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={form.allowExtraHours}
                onChange={(e) => setForm((p) => ({ ...p, allowExtraHours: e.target.checked }))}
                style={{ width: "auto", height: "auto", margin: 0 }}
              />
              HE Habilitadas
            </label>
            <button type="submit" disabled={submitting}>{submitting ? "Creando…" : "Crear proyecto"}</button>
          </form>
        }
        table={
          <>
            {/* Filters */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-sec-blue)", marginBottom: "0.25rem" }}>Proyecto</label>
                <SearchableSelect
                  options={projectOptions}
                  value={projectFilter}
                  onChange={setProjectFilter}
                  placeholder="Buscar o escribir proyecto..."
                  emptyLabel="Todos los proyectos"
                  allowFreeText={true}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-sec-blue)", marginBottom: "0.25rem" }}>Empresa</label>
                <SearchableSelect
                  options={companyOptions}
                  value={companyFilter}
                  onChange={setCompanyFilter}
                  placeholder="Buscar o escribir empresa..."
                  emptyLabel="Todas las empresas"
                  allowFreeText={true}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-sec-blue)", marginBottom: "0.25rem" }}>Salud</label>
                <select
                  value={healthFilter}
                  onChange={(e) => setHealthFilter(e.target.value as HealthStatus | "")}
                  style={{ width: "100%", height: "42px", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
                >
                  <option value="">Todas</option>
                  <option value="GREEN">Saludable</option>
                  <option value="YELLOW">Advertencia</option>
                  <option value="RED">Crítico</option>
                </select>
              </div>
            </div>

            {loading ? (
              <p className="loading">Cargando...</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Salud</th>
                      <th>Nombre</th>
                      <th>Empresa</th>
                      <th>PM</th>
                      <th>Tipo</th>
                      <th>Estado</th>
                      <th>Presupuesto</th>
                      <th>Uso</th>
                      <th>Avance</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((project) => {
                      const stats = statsMap.get(project.id);
                      return (
                        <tr key={project.id}>
                          <td><RagBadge status={stats?.healthStatus} marginThreshold={stats?.marginThreshold} /></td>
                          <td>{project.name}</td>
                          <td>{project.company}</td>
                          <td style={{ fontSize: "0.75rem" }} title={project.projectManagerEmail ?? "Sin PM asignado"}>
                            {project.projectManagerEmail ?? "—"}
                          </td>
                          <td style={{ fontSize: "0.75rem" }}>
                            {project.projectType === "TIME_AND_MATERIAL" ? "T&M" :
                             project.projectType === "FIXED_PRICE" ? "FP" : "Staff"}
                          </td>
                          <td><span className={`pill ${project.status === "ACTIVE" ? "ok" : project.status === "PAUSED" ? "warn" : "neutral"}`}>{label(PROJECT_STATUS_LABELS, project.status)}</span></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {stats
                              ? money(stats.budget, stats.displayCurrency)
                              : money(numberish(project.budget), project.currency)}
                          </td>
                          <td>
                            {stats ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                                <BudgetBar pct={stats.usedBudgetPercent} />
                                <span style={{ fontSize: "0.68rem", color: "#6b7280" }}>{stats.usedBudgetPercent.toFixed(1)}%</span>
                              </div>
                            ) : "—"}
                          </td>
                          <td>
                            {stats ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                                <BudgetBar pct={stats.completionPct} />
                                <span style={{ fontSize: "0.68rem", color: "#6b7280" }}>{stats.completionPct.toFixed(0)}%</span>
                              </div>
                            ) : "—"}
                          </td>
                          <td>
                            <div className="inline-actions">
                              {onOpenProject && (
                                <button type="button" onClick={() => onOpenProject(project.id)}>
                                  Ver
                                </button>
                              )}
                              {canWrite && (
                                <>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() =>
                                      setEditForm({
                                        id: project.id,
                                        name: project.name,
                                        company: project.company,
                                        country: project.country,
                                        currency: project.currency,
                                        budget: String(numberish(project.budget)),
                                        startDate: toDateInput(project.startDate),
                                        endDate: toDateInput(project.endDate),
                                        description: project.description || "",
                                        projectType: project.projectType ?? "TIME_AND_MATERIAL",
                                        status: project.status ?? "ACTIVE",
                                        sellPrice: project.sellPrice ? String(numberish(project.sellPrice)) : "",
                                        sellCurrency: project.sellCurrency ?? "USD",
                                        projectManagerEmail: project.projectManagerEmail ?? "",
                                        marginThreshold:
                                          project.marginThreshold != null ? String(Number(project.marginThreshold)) : "",
                                        budgetAlertPct:
                                          project.budgetAlertPct != null ? String(Number(project.budgetAlertPct)) : "",
                                        allowExtraHours: project.allowExtraHours !== false,
                                      })
                                    }
                                  >
                                    Editar
                                  </button>
                                  <button type="button" className="ghost" onClick={() => setDeleteTarget(project)}>
                                    Eliminar
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        }
      />

      {editForm && createPortal(
        <div className="modal-overlay" onClick={() => { setEditForm(null); setEditError(""); }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Editar proyecto</h3>
              <button type="button" className="ghost" onClick={() => { setEditForm(null); setEditError(""); }}>Cerrar</button>
            </div>
            <form className="form-grid" onSubmit={(e) => void handleUpdate(e)}>
              <ValidationErrorBox message={editError} />
              <input value={editForm.name} onChange={(e) => setEditForm((p) => p && { ...p, name: e.target.value })} placeholder="Nombre" required />
              <input value={editForm.company} onChange={(e) => setEditForm((p) => p && { ...p, company: e.target.value })} placeholder="Empresa" required />
              <input value={editForm.country} onChange={(e) => setEditForm((p) => p && { ...p, country: e.target.value })} placeholder="País" required />
              <select value={editForm.currency} onChange={(e) => setEditForm((p) => p && { ...p, currency: e.target.value })} required>
                <option value="" disabled hidden>Selecciona moneda...</option>
                {currencyOptions.map((c) => <option key={`edit-${c}`} value={c}>{c}</option>)}
              </select>
              <CurrencyInput
                currency={editForm.currency || "USD"}
                value={editForm.budget}
                onChange={(v) => setEditForm((p) => p && { ...p, budget: v })}
                placeholder="Presupuesto (costo)"
                required
              />
              <select value={editForm.projectType} onChange={(e) => setEditForm((p) => p && { ...p, projectType: e.target.value as ProjectType })}>
                <option value="TIME_AND_MATERIAL">Tiempo y Material</option>
                <option value="FIXED_PRICE">Precio Fijo</option>
                <option value="STAFFING">Staffing</option>
              </select>
              <select value={editForm.status} onChange={(e) => setEditForm((p) => p && { ...p, status: e.target.value as ProjectStatus })}>
                <option value="ACTIVE">Activo</option>
                <option value="PAUSED">Pausado</option>
                <option value="CLOSED">Cerrado</option>
              </select>
              <CurrencyInput
                currency={editForm.sellCurrency || "USD"}
                value={editForm.sellPrice}
                onChange={(v) => setEditForm((p) => p && { ...p, sellPrice: v })}
                placeholder="Precio de venta (opcional)"
              />
              <select value={editForm.sellCurrency} onChange={(e) => setEditForm((p) => p && { ...p, sellCurrency: e.target.value })}>
                {currencyOptions.map((c) => <option key={`edit-sell-${c}`} value={c}>{`Moneda venta: ${c}`}</option>)}
              </select>
              <input
                type="email"
                placeholder="Correo del Project Manager (opcional)"
                title="Correo corporativo de quien aprueba las horas extra del proyecto. Vaciar el campo lo desasigna."
                value={editForm.projectManagerEmail}
                onChange={(e) => setEditForm((p) => p && { ...p, projectManagerEmail: e.target.value })}
              />
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="Umbral de margen % (opcional)"
                title={AYUDA_UMBRAL_MARGEN}
                value={editForm.marginThreshold}
                onChange={(e) => setEditForm((p) => p && { ...p, marginThreshold: e.target.value })}
              />
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="Aviso de presupuesto % (opcional)"
                title={AYUDA_UMBRAL_PRESUPUESTO}
                value={editForm.budgetAlertPct}
                onChange={(e) => setEditForm((p) => p && { ...p, budgetAlertPct: e.target.value })}
              />
              <p style={{ gridColumn: "span 2", margin: 0, fontSize: "0.72rem", lineHeight: 1.4, color: "var(--text-soft)" }}>
                <strong>Umbral de margen</strong>: vaciarlo lo desasigna y el proyecto vuelve al valor por defecto del
                sistema (15 %). <strong>Aviso de presupuesto</strong>: vaciarlo <em>no</em> lo borra; el campo no admite
                vacío y conserva el valor actual (90 % por defecto).
              </p>
              <input type="date" value={editForm.startDate} onChange={(e) => setEditForm((p) => p && { ...p, startDate: e.target.value })} required />
              <input type="date" value={editForm.endDate} onChange={(e) => setEditForm((p) => p && { ...p, endDate: e.target.value })} required />
              <textarea value={editForm.description} onChange={(e) => setEditForm((p) => p && { ...p, description: e.target.value })} placeholder="Descripción" />
              <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
                <input
                  type="checkbox"
                  id="editAllowExtraHours"
                  checked={editForm.allowExtraHours}
                  onChange={(e) => setEditForm((p) => p && { ...p, allowExtraHours: e.target.checked })}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                <label htmlFor="editAllowExtraHours" style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-soft)", cursor: "pointer" }}>
                  Habilitar Horas Extras para este proyecto
                </label>
              </div>
              <div className="modal-actions">
                <button type="submit" disabled={editSubmitting}>{editSubmitting ? "Guardando…" : "Guardar cambios"}</button>
                <button type="button" className="ghost" onClick={() => { setEditForm(null); setEditError(""); }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar proyecto"
        message={`¿Eliminar el proyecto "${deleteTarget?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
