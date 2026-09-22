import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import {
  createConsultant,
  deleteConsultant,
  updateConsultant,
  listSupportedCountries,
  type Consultant,
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SectionLayout } from "../../components/SectionLayout";
import { downloadCsv } from "../../utils/csv";
import { ValidationErrorBox } from "../../components/ValidationErrorBox";
import { isValidationError } from "../../utils/validation";
import { CurrencyInput } from "../../components/CurrencyInput";
import { displayCountryWithFlag } from "../../utils/statusLabels";
import { CountryFlag } from "../../components/CountryFlag";

const currencyOptions = ["COP", "USD", "EUR", "MXN", "PEN", "CLP", "ARS"];
const roleOptions = ["Analista", "Desarrollador", "QA", "Arquitecto", "PM", "Data Engineer"];
const seniorityOptions = ["Junior", "Mid", "Senior", "Lead"];

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

/**
 * `true` cuando el backend no mandó la tarifa porque el rol no puede verla
 * (DEP-38). Es distinto de "no tiene tarifa cargada" (`null`), y por eso se
 * comprueba `undefined` y no la falsedad del valor: pintar "0,00" donde en
 * realidad hay una tarifa oculta sería engañoso.
 */
function tarifaOculta(value: string | null | undefined) {
  return value === undefined;
}

function numberish(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type EditForm = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  company: string;
  hourlyRate: string;
  rateCurrency: string;
  country: string;
  seniority: string;
  identification: string;
  active: boolean;
  allowWeekendWork: boolean;
  isInternal: boolean;
};

const emptyForm = {
  fullName: "",
  email: "",
  role: "",
  company: "",
  hourlyRate: "",
  rateCurrency: "USD",
  country: "",
  seniority: "",
  identification: "",
  active: true,
  allowWeekendWork: false,
  isInternal: true,
};

export function ConsultantsTab({
  consultants,
  loading,
  canWrite,
  canDelete = false,
  onReload,
  onError,
  onAssignConsultant,
}: {
  consultants: Consultant[];
  loading: boolean;
  canWrite: boolean;
  canDelete?: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  onAssignConsultant?: (id: string) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Consultant | null>(null);
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [fxLoading, setFxLoading] = useState(false);

  // Fetch supported countries from backend
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  useEffect(() => {
    void listSupportedCountries()
      .then((countries) => setCountryOptions(countries.filter(c => c !== "Default")))
      .catch(() => {});
  }, []);

  const [filterActive, setFilterActive] = useState<string>("ALL");
  const [filterCountry, setFilterCountry] = useState<string>("ALL");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterCompany, setFilterCompany] = useState<string>("ALL");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [filterSeniority, setFilterSeniority] = useState<string>("ALL");

  const companies = useMemo(() => {
    const list = new Set<string>();
    consultants.forEach((c) => {
      if (c.company) {
        list.add(c.company.trim());
      }
    });
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [consultants]);

  const filteredConsultants = useMemo(() => {
    return consultants.filter((c) => {
      if (filterActive !== "ALL") {
        const isActive = filterActive === "ACTIVE";
        if (c.active !== isActive) return false;
      }
      if (filterCountry !== "ALL") {
        if (c.country !== filterCountry) return false;
      }
      if (filterType !== "ALL") {
        const isInternal = filterType === "INTERNAL";
        if ((c.isInternal ?? true) !== isInternal) return false;
      }
      if (filterCompany !== "ALL") {
        if (c.company !== filterCompany) return false;
      }
      if (filterRole !== "ALL") {
        if (c.role !== filterRole) return false;
      }
      if (filterSeniority !== "ALL") {
        if (c.seniority !== filterSeniority) return false;
      }
      return true;
    });
  }, [consultants, filterActive, filterCountry, filterType, filterCompany, filterRole, filterSeniority]);

  useEffect(() => {
    setFxLoading(true);
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((res) => res.json())
      .then((data: { rates: Record<string, number> }) => {
        setFxRates(data.rates);
      })
      .catch(() => { /* fxRates queda vacío, la columna mostrará "—" */ })
      .finally(() => setFxLoading(false));
  }, []);

  function toUSD(amount: number, currency: string): string {
    if (currency === "USD") return money(amount, "USD");
    const rate = fxRates[currency];
    if (!rate) return "—";
    return money(amount / rate, "USD");
  }

  function handleExport() {
    downloadCsv(
      filteredConsultants.map((c) => ({
        nombre: c.fullName,
        correo: c.email ?? "",
        rol: c.role,
        empresa: c.company ?? "",
        tarifa: tarifaOculta(c.hourlyRate) ? "" : numberish(c.hourlyRate).toFixed(2),
        moneda: c.rateCurrency ?? "USD",
        pais: c.country ?? "",
        estado: c.active ? "Activo" : "Inactivo",
      })),
      [
        { key: "nombre", label: "Nombre" },
        { key: "correo", label: "Correo" },
        { key: "rol", label: "Rol" },
        { key: "empresa", label: "Empresa" },
        { key: "tarifa", label: "Tarifa/h" },
        { key: "moneda", label: "Moneda" },
        { key: "pais", label: "País" },
        { key: "estado", label: "Estado" },
      ],
      "consultores",
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      await createConsultant({
        fullName: form.fullName,
        email: form.email || undefined,
        role: form.role,
        company: form.company || undefined,
        hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
        rateCurrency: form.rateCurrency,
        country: form.country || undefined,
        seniority: form.seniority || undefined,
        identification: form.identification.trim() || null,
        active: form.active,
        allowWeekendWork: form.allowWeekendWork,
        isInternal: form.isInternal,
      });
      setForm(emptyForm);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo crear consultor";
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
      await updateConsultant(editForm.id, {
        fullName: editForm.fullName,
        email: editForm.email || undefined,
        role: editForm.role,
        company: editForm.company || undefined,
        hourlyRate: editForm.hourlyRate ? Number(editForm.hourlyRate) : undefined,
        rateCurrency: editForm.rateCurrency,
        country: editForm.country || undefined,
        seniority: editForm.seniority || undefined,
        identification: editForm.identification.trim() || null,
        active: editForm.active,
        allowWeekendWork: editForm.allowWeekendWork,
        isInternal: editForm.isInternal,
      });
      setEditForm(null);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo actualizar consultor";
      if (isValidationError(msg)) {
        setEditError(msg);
      } else {
        onError(msg);
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleToggleActive(consultant: Consultant) {
    try {
      await updateConsultant(consultant.id, {
        fullName: consultant.fullName,
        email: consultant.email || undefined,
        role: consultant.role,
        company: consultant.company || undefined,
        hourlyRate: numberish(consultant.hourlyRate),
        rateCurrency: consultant.rateCurrency || "USD",
        country: consultant.country || undefined,
        seniority: consultant.seniority || undefined,
        identification: consultant.identification ?? "",
        active: !consultant.active,
        allowWeekendWork: consultant.allowWeekendWork || false,
        isInternal: consultant.isInternal ?? true,
      });
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cambiar estado del consultor");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteConsultant(id);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar consultor");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="◐"
        title="Gestión de Consultores"
        description="Administra los perfiles de los consultores, tarifas por hora y asignaciones operativas."
      />
      <SectionLayout
        title="Consultores"
        newLabel="+ Nuevo consultor"
        canWrite={canWrite}
        onExport={handleExport}
        exportDisabled={filteredConsultants.length === 0}
        form={
          <form onSubmit={(e) => void handleCreate(e)} className="consultant-form-grid">
            <ValidationErrorBox message={formError} />
            
            <div className="consultant-form-row row-1">
              <input placeholder="Nombre completo" value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} required />
              <input type="email" placeholder="Correo" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              <input placeholder="Empresa" value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} />
            </div>

            <div className="consultant-form-row row-2">
              <select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} required>
                <option value="" disabled hidden>Selecciona un rol...</option>
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))} required>
                <option value="" disabled hidden>País...</option>
                {countryOptions.map((c) => <option key={c} value={c}>{displayCountryWithFlag(c)}</option>)}
              </select>
              <select value={form.seniority} onChange={(e) => setForm((p) => ({ ...p, seniority: e.target.value }))} required>
                <option value="" disabled hidden>Seniority...</option>
                {seniorityOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {/* Documento: se muestra en la tabla de nómina de horas extra y se
                  exporta en su CSV. Hasta ahora no había forma de rellenarlo. */}
              <input
                type="text"
                value={form.identification}
                onChange={(e) => setForm((p) => ({ ...p, identification: e.target.value }))}
                placeholder="Documento de identidad (opcional)"
                maxLength={40}
              />
            </div>

            <div className="consultant-form-row row-3">
              <select value={form.rateCurrency} onChange={(e) => setForm((p) => ({ ...p, rateCurrency: e.target.value }))}>
                {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <CurrencyInput
                currency={form.rateCurrency}
                placeholder={`Tarifa/h (${form.rateCurrency})`}
                value={form.hourlyRate}
                onChange={(v) => setForm((p) => ({ ...p, hourlyRate: v }))}
              />
              <select value={form.isInternal ? "true" : "false"} onChange={(e) => setForm((p) => ({ ...p, isInternal: e.target.value === "true" }))} style={{ height: "42px", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", width: "100%" }}>
                <option value="true">Interno</option>
                <option value="false">Externo</option>
              </select>
              <label className="check" style={{ userSelect: "none" }}>
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
                Activo
              </label>
              <label className="check" style={{ userSelect: "none" }}>
                <input type="checkbox" checked={form.allowWeekendWork} onChange={(e) => setForm((p) => ({ ...p, allowWeekendWork: e.target.checked }))} />
                Finde/Festivos
              </label>
              <button type="submit" disabled={submitting} style={{ height: "42px" }}>{submitting ? "Creando…" : "Crear consultor"}</button>
            </div>
          </form>
        }
        table={
          loading ? (
            <p className="loading">Cargando...</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* FILTERS CONTAINER */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "0.75rem",
                padding: "1rem",
                background: "var(--card-bg)",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                marginBottom: "0.5rem"
              }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Estado</label>
                  <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}>
                    <option value="ALL">Todos los estados</option>
                    <option value="ACTIVE">Activo</option>
                    <option value="INACTIVE">Inactivo</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>País</label>
                  <select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}>
                  <option value="ALL">Todos los países</option>
                  {countryOptions.map((c) => <option key={`filter-country-${c}`} value={c}>{displayCountryWithFlag(c)}</option>)}
                </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Tipo</label>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}>
                    <option value="ALL">Todos los tipos</option>
                    <option value="INTERNAL">Interno</option>
                    <option value="EXTERNAL">Externo</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Empresa</label>
                  <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}>
                    <option value="ALL">Todas las empresas</option>
                    {companies.map((c) => <option key={`filter-company-${c}`} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Rol</label>
                  <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}>
                    <option value="ALL">Todos los roles</option>
                    {roleOptions.map((r) => <option key={`filter-role-${r}`} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Seniority</label>
                  <select value={filterSeniority} onChange={(e) => setFilterSeniority(e.target.value)} style={{ width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}>
                    <option value="ALL">Todos los seniority</option>
                    {seniorityOptions.map((s) => <option key={`filter-seniority-${s}`} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Rol</th>
                      <th>Seniority</th>
                      <th>País</th>
                      <th>Empresa</th>
                      <th>Tipo</th>
                      <th>Tarifa</th>
                      <th>Tarifa en USD</th>
                      <th>Estado</th>
                      {(canWrite || !!onAssignConsultant) && <th>Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConsultants.map((c) => (
                      <tr key={c.id}>
                        <td>{c.fullName}</td>
                        <td>{c.role}</td>
                        <td><span className="pill neutral" style={{ fontSize: "0.75rem", fontWeight: 600 }}>{c.seniority || "—"}</span></td>
                        <td>{c.country ? <CountryFlag country={c.country} /> : "—"}</td>
                        <td>{c.company || "—"}</td>
                        <td>
                          <span className={`pill ${c.isInternal !== false ? "ok" : "warn"}`} style={{ fontSize: "0.7rem" }}>
                            {c.isInternal !== false ? "Interno" : "Externo"}
                          </span>
                        </td>
                        <td>{tarifaOculta(c.hourlyRate) ? "—" : money(numberish(c.hourlyRate), c.rateCurrency || "USD")}</td>
                        <td>{tarifaOculta(c.hourlyRate) ? "—" : fxLoading ? "…" : toUSD(numberish(c.hourlyRate), c.rateCurrency || "USD")}</td>
                        <td>
                          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                            <span className={`pill ${c.active ? "ok" : "neutral"}`}>{c.active ? "Activo" : "Inactivo"}</span>
                            {c.allowWeekendWork && (
                              <span className="pill warning" style={{ fontSize: "0.7rem", background: "var(--state-warning-bg)", color: "var(--state-warning-text)", fontWeight: 700 }} title="Autorizado para registrar en fines de semana y festivos">
                                📅 Finde
                              </span>
                            )}
                          </div>
                        </td>
                        {(canWrite || !!onAssignConsultant) && (
                          <td>
                            <div className="inline-actions">
                              {onAssignConsultant && (
                                <button
                                  type="button"
                                  className="ghost"
                                  style={{
                                    background: "var(--state-success-bg)",
                                    color: "var(--state-success-text)",
                                    borderColor: "var(--state-success-border)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.25rem"
                                  }}
                                  onClick={() => onAssignConsultant(c.id)}
                                >
                                  ◉ Asignar
                                </button>
                              )}
                              {canWrite && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditForm({
                                        id: c.id,
                                        fullName: c.fullName,
                                        email: c.email || "",
                                        role: c.role,
                                        company: c.company || "",
                                        // Si la tarifa no vino, el campo queda vacío: nunca se
                                        // reenvía un 0 que sobrescriba la tarifa real.
                                        hourlyRate: tarifaOculta(c.hourlyRate) ? "" : String(numberish(c.hourlyRate)),
                                        rateCurrency: c.rateCurrency || "USD",
                                        country: c.country || "",
                                        seniority: c.seniority || "",
                                        identification: c.identification ?? "",
                                        active: c.active,
                                        allowWeekendWork: c.allowWeekendWork || false,
                                        isInternal: c.isInternal !== false,
                                      })
                                    }
                                  >
                                    Editar
                                  </button>
                                  <button type="button" onClick={() => void handleToggleActive(c)}>
                                    {c.active ? "Desactivar" : "Activar"}
                                  </button>
                                  {canDelete && (
                                    <button type="button" className="ghost" onClick={() => setDeleteTarget(c)}>
                                      Eliminar
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {filteredConsultants.length === 0 && (
                      <tr>
                        <td colSpan={(canWrite || !!onAssignConsultant) ? 10 : 9} style={{ textAlign: "center", color: "var(--text-soft)", padding: "2rem" }}>
                          No se encontraron consultores con los filtros aplicados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }
      />

      {editForm && createPortal(
        <div className="modal-overlay" onClick={() => { setEditForm(null); setEditError(""); }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Editar consultor</h3>
              <button type="button" className="ghost" onClick={() => { setEditForm(null); setEditError(""); }}>Cerrar</button>
            </div>
            <form className="consultant-form-grid" onSubmit={(e) => void handleUpdate(e)}>
              <ValidationErrorBox message={editError} />

              <div className="consultant-form-row row-1">
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Nombre completo *</label>
                  <input value={editForm.fullName} onChange={(e) => setEditForm((p) => p && { ...p, fullName: e.target.value })} placeholder="Nombre completo" required />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Correo</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm((p) => p && { ...p, email: e.target.value })} placeholder="Correo" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Empresa</label>
                  <input value={editForm.company} onChange={(e) => setEditForm((p) => p && { ...p, company: e.target.value })} placeholder="Empresa" />
                </div>
              </div>

              <div className="consultant-form-row row-2">
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Rol *</label>
                  <select value={editForm.role} onChange={(e) => setEditForm((p) => p && { ...p, role: e.target.value })} required>
                    <option value="" disabled hidden>Selecciona un rol...</option>
                    {roleOptions.map((r) => <option key={`edit-${r}`} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>País *</label>
                   <select value={editForm.country} onChange={(e) => setEditForm((p) => p && { ...p, country: e.target.value })} required>
                    <option value="" disabled hidden>Selecciona un país...</option>
                    {countryOptions.map((c) => <option key={`edit-country-${c}`} value={c}>{displayCountryWithFlag(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Seniority *</label>
                  <select value={editForm.seniority} onChange={(e) => setEditForm((p) => p && { ...p, seniority: e.target.value })} required>
                    <option value="" disabled hidden>Selecciona seniority...</option>
                    {seniorityOptions.map((s) => <option key={`edit-seniority-${s}`} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="consultant-form-row row-3" style={{ gridTemplateColumns: "0.8fr 1.2fr 1fr auto auto" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Moneda</label>
                  <select value={editForm.rateCurrency} onChange={(e) => setEditForm((p) => p && { ...p, rateCurrency: e.target.value })}>
                    {currencyOptions.map((c) => <option key={`edit-cur-${c}`} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Tarifa/h</label>
                  <CurrencyInput
                    currency={editForm.rateCurrency}
                    value={editForm.hourlyRate}
                    onChange={(v) => setEditForm((p) => p && { ...p, hourlyRate: v })}
                    placeholder={`Tarifa/hora (${editForm.rateCurrency})`}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Tipo</label>
                  <select value={editForm.isInternal ? "true" : "false"} onChange={(e) => setEditForm((p) => p && { ...p, isInternal: e.target.value === "true" })} style={{ width: "100%", height: "42px", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}>
                    <option value="true">Interno</option>
                    <option value="false">Externo</option>
                  </select>
                </div>
                <label className="check" style={{ userSelect: "none", marginTop: "1.25rem" }}>
                  <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm((p) => p && { ...p, active: e.target.checked })} />
                  Activo
                </label>
                <label className="check" style={{ userSelect: "none", marginTop: "1.25rem" }}>
                  <input type="checkbox" checked={editForm.allowWeekendWork} onChange={(e) => setEditForm((p) => p && { ...p, allowWeekendWork: e.target.checked })} />
                  Finde/Festivos
                </label>
              </div>

              <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
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
        title="Eliminar consultor"
        message={`¿Eliminar a "${deleteTarget?.fullName}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
