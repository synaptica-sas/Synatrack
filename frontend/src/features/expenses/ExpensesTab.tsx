import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import {
  createExpense,
  deleteExpense,
  updateExpense,
  type Expense,
  type FxConfig,
  type Forecast,
  type Project,
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { downloadCsv } from "../../utils/csv";
import type { DateRange } from "../../components/dateRangeUtils";
import { numberish } from "./gastosUtils";
import { useGastosGrouped, type GroupBy } from "./useGastosGrouped";
import { GastosKPIStrip } from "./GastosKPIStrip";
import { GastosFilters } from "./GastosFilters";
import { GastosSummaryTable } from "./GastosSummaryTable";
import { ValidationErrorBox } from "../../components/ValidationErrorBox";
import { isValidationError } from "../../utils/validation";
import { CurrencyInput } from "../../components/CurrencyInput";

const currencyOptions = ["COP", "USD", "EUR", "MXN", "PEN", "CLP"];
const categoryOptions = ["Viajes", "Alojamiento", "Alimentacion", "Transporte", "Software", "Servicios", "Otros"];

function toDateInput(value: string) {
  return value.slice(0, 10);
}

type EditForm = {
  id: string;
  projectId: string;
  expenseDate: string;
  category: string;
  amount: string;
  currency: string;
  description: string;
};

const emptyForm = {
  projectId: "",
  expenseDate: "",
  category: categoryOptions[0],
  amount: "",
  currency: "COP",
  description: "",
};

export function ExpensesTab({
  expenses,
  projects,
  forecasts = [],
  loading,
  canWrite,
  onReload,
  onError,
  fxConfigs = [],
  baseCurrency: initialBaseCurrency = "USD",
}: {
  expenses: Expense[];
  projects: Project[];
  forecasts?: Forecast[];
  loading: boolean;
  canWrite: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  fxConfigs?: FxConfig[];
  baseCurrency?: string;
}) {
  // ── Form / modal state ────────────────────────────────────────────────────
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [groupBy, setGroupBy]                   = useState<GroupBy>("project");
  const [dateRange, setDateRange]               = useState<DateRange>({ from: "", to: "" });
  const [search, setSearch]                     = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [baseCurrency, setBaseCurrency]         = useState(initialBaseCurrency);

  // ── Derived: available categories from data ───────────────────────────────
  const availableCategories = useMemo(
    () => [...new Set(expenses.map((e) => e.category))].sort(),
    [expenses],
  );

  // ── Filtered expenses ─────────────────────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (dateRange.from && e.expenseDate < dateRange.from) return false;
      if (dateRange.to   && e.expenseDate > dateRange.to)   return false;
      if (selectedCurrency && e.currency !== selectedCurrency) return false;
      if (selectedCategories.length > 0 && !selectedCategories.includes(e.category)) return false;
      if (q && !(
        e.project.name.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        String(numberish(e.amount)).includes(q)
      )) return false;
      return true;
    });
  }, [expenses, dateRange, search, selectedCategories, selectedCurrency]);

  // ── Grouped data ──────────────────────────────────────────────────────────
  const { groups, totals } = useGastosGrouped(
    filteredExpenses,
    groupBy,
    baseCurrency,
    fxConfigs,
    projects,
  );

  // ── Projected costs from forecasts (por proyecto) ────────────────────────
  const forecastByProject = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    for (const f of forecasts) {
      const key = f.projectId;
      const existing = map.get(key);
      map.set(key, {
        name: f.project.name,
        total: (existing?.total ?? 0) + (f.projectedCost ?? 0),
      });
    }
    return [...map.entries()].map(([, v]) => v).sort((a, b) => b.total - a.total);
  }, [forecasts]);

  const totalProjectedCost = forecastByProject.reduce((s, r) => s + r.total, 0);
  const [showForecastDetail, setShowForecastDetail] = useState(false);

  function fmtBase(n: number) {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: baseCurrency, maximumFractionDigits: 0 }).format(n);
  }

  // ── CSV export (all filtered expenses, not just summaries) ────────────────
  function handleExport() {
    downloadCsv(
      filteredExpenses.map((e) => ({
        proyecto: e.project.name,
        categoria: e.category,
        monto: numberish(e.amount).toFixed(2),
        moneda: e.currency,
        fecha: e.expenseDate.slice(0, 10),
        descripcion: e.description ?? "",
      })),
      [
        { key: "proyecto",    label: "Proyecto" },
        { key: "categoria",   label: "Categoría" },
        { key: "monto",       label: "Monto" },
        { key: "moneda",      label: "Moneda" },
        { key: "fecha",       label: "Fecha" },
        { key: "descripcion", label: "Descripción" },
      ],
      "gastos",
    );
  }

  // ── CRUD handlers ─────────────────────────────────────────────────────────
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError("");
    setSubmitting(true);
    try {
      await createExpense({
        projectId: form.projectId,
        expenseDate: form.expenseDate,
        category: form.category,
        amount: Number(form.amount),
        currency: form.currency,
        description: form.description || undefined,
      });
      setForm(emptyForm);
      setShowNewForm(false);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo registrar gasto";
      if (isValidationError(msg)) {
        setCreateError(msg);
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
      await updateExpense(editForm.id, {
        projectId: editForm.projectId,
        expenseDate: editForm.expenseDate,
        category: editForm.category,
        amount: Number(editForm.amount),
        currency: editForm.currency,
        description: editForm.description || undefined,
      });
      setEditForm(null);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo actualizar gasto";
      if (isValidationError(msg)) {
        setEditError(msg);
      } else {
        onError(msg);
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteExpense(id);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar gasto");
    }
  }

  function openEditForm(expense: Expense) {
    setEditForm({
      id: expense.id,
      projectId: expense.projectId,
      expenseDate: toDateInput(expense.expenseDate),
      category: expense.category,
      amount: String(numberish(expense.amount)),
      currency: expense.currency,
      description: expense.description || "",
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="⊟"
        title="Gestión de Gastos"
        description="Registra, reembolsa y controla los gastos operacionales asociados a los proyectos."
      />

      {loading ? (
        <p className="loading">Cargando gastos…</p>
      ) : (
        <article className="card" style={{ padding: "1rem 1.25rem" }}>
          {/* KPI strip */}
          <GastosKPIStrip
            filteredExpenses={filteredExpenses}
            allExpenses={expenses}
            dateRange={dateRange}
            baseCurrency={baseCurrency}
            fxConfigs={fxConfigs}
            projects={projects}
          />

          {/* Filters */}
          <GastosFilters
            search={search}
            onSearchChange={setSearch}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            selectedCategories={selectedCategories}
            onCategoriesChange={setSelectedCategories}
            selectedCurrency={selectedCurrency}
            onCurrencyChange={setSelectedCurrency}
            baseCurrency={baseCurrency}
            onBaseCurrencyChange={setBaseCurrency}
            availableCategories={availableCategories}
            onExport={handleExport}
            onNew={() => setShowNewForm(true)}
            canWrite={canWrite}
          />

          {/* Summary table */}
          <GastosSummaryTable
            groups={groups}
            totals={totals}
            groupBy={groupBy}
            baseCurrency={baseCurrency}
            fxConfigs={fxConfigs}
            canWrite={canWrite}
            onEdit={openEditForm}
            onDelete={setDeleteTarget}
          />
        </article>
      )}

      {/* ── Costos proyectados (forecasts) ── */}
      {forecasts.length > 0 && (
        <article className="card" style={{ padding: "1rem 1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
              Costos proyectados (forecasts)
              <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--text-soft)", fontWeight: 400 }}>
                — costo futuro estimado basado en proyecciones activas
              </span>
            </h3>
            <button
              type="button"
              className="ghost"
              style={{ fontSize: "0.78rem" }}
              onClick={() => setShowForecastDetail((p) => !p)}
            >
              {showForecastDetail ? "Ocultar detalle" : "Ver por proyecto"}
            </button>
          </div>

          <div style={{ display: "flex", gap: "1.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "#2563eb" }}>
              {fmtBase(totalProjectedCost)}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>
              Total en {forecasts.length} proyecciones · {forecastByProject.length} proyectos
            </span>
          </div>

          {showForecastDetail && (
            <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th style={{ textAlign: "right" }}>Costo proyectado</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastByProject.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtBase(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--text-soft)" }}>
            Nota: costos proyectados en moneda original del forecast. Para comparación exacta en {baseCurrency} configure las tasas de cambio en FX Config.
          </p>
        </article>
      )}

      {/* New expense modal */}
      {showNewForm && canWrite && createPortal(
        <div className="modal-overlay" onClick={() => { setShowNewForm(false); setCreateError(""); }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Registrar gasto</h3>
              <button type="button" className="ghost" onClick={() => { setShowNewForm(false); setCreateError(""); }}>Cerrar</button>
            </div>
            <form onSubmit={(e) => void handleCreate(e)} className="form-grid">
              <ValidationErrorBox message={createError} />
              <select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))} required>
                <option value="" disabled hidden>Selecciona proyecto...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" value={form.expenseDate} onChange={(e) => setForm((p) => ({ ...p, expenseDate: e.target.value }))} required />
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} required>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <CurrencyInput
                currency={form.currency}
                placeholder="Valor"
                value={form.amount}
                onChange={(v) => setForm((p) => ({ ...p, amount: v }))}
                required
              />
              <select value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} required>
                {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <textarea placeholder="Descripción" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              <div className="modal-actions">
                <button type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar gasto"}</button>
                <button type="button" className="ghost" onClick={() => { setShowNewForm(false); setCreateError(""); }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Edit modal */}
      {editForm && createPortal(
        <div className="modal-overlay" onClick={() => { setEditForm(null); setEditError(""); }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Editar gasto</h3>
              <button type="button" className="ghost" onClick={() => { setEditForm(null); setEditError(""); }}>Cerrar</button>
            </div>
            <form className="form-grid" onSubmit={(e) => void handleUpdate(e)}>
              <ValidationErrorBox message={editError} />
              <select value={editForm.projectId} onChange={(e) => setEditForm((p) => p && { ...p, projectId: e.target.value })} required>
                <option value="" disabled hidden>Selecciona proyecto...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" value={editForm.expenseDate} onChange={(e) => setEditForm((p) => p && { ...p, expenseDate: e.target.value })} required />
              <select value={editForm.category} onChange={(e) => setEditForm((p) => p && { ...p, category: e.target.value })} required>
                {categoryOptions.map((c) => <option key={`edit-cat-${c}`} value={c}>{c}</option>)}
              </select>
              <CurrencyInput
                currency={editForm.currency}
                value={editForm.amount}
                onChange={(v) => setEditForm((p) => p && { ...p, amount: v })}
                required
              />
              <select value={editForm.currency} onChange={(e) => setEditForm((p) => p && { ...p, currency: e.target.value })} required>
                {currencyOptions.map((c) => <option key={`edit-cur-${c}`} value={c}>{c}</option>)}
              </select>
              <textarea value={editForm.description} onChange={(e) => setEditForm((p) => p && { ...p, description: e.target.value })} placeholder="Descripción" />
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
        title="Eliminar gasto"
        message={`¿Eliminar gasto de ${deleteTarget?.category}?`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
