import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  getEffectiveWorkdays,
  type AllocationMode,
  type AssignmentCertainty,
  type Consultant,
  type JornadasEfectivas,
  type Project,
} from "../../services/api";
import {
  etiquetaProyecto,
  textoEquivalente,
  validarAsignacion,
  type AssignmentFormState,
} from "./assignmentForm";

/**
 * Formulario de alta/edición de asignaciones (modal). Captura por defecto en
 * horas por semana y muestra a cuánto de una jornada equivale. Las fechas son
 * `YYYY-MM-DD` tal cual las entrega `<input type="date">`.
 */
export function AssignmentFormModal({
  editing,
  form,
  setForm,
  projects,
  consultants,
  multipleMode,
  onMultipleModeChange,
  selectedConsultantIds,
  setSelectedConsultantIds,
  submitting,
  onSubmit,
  onClose,
}: {
  editing: boolean;
  form: AssignmentFormState;
  setForm: Dispatch<SetStateAction<AssignmentFormState>>;
  projects: Project[];
  consultants: Consultant[];
  multipleMode: boolean;
  onMultipleModeChange: (value: boolean) => void;
  selectedConsultantIds: string[];
  setSelectedConsultantIds: Dispatch<SetStateAction<string[]>>;
  submitting: boolean;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const [consultantSearch, setConsultantSearch] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(submitting);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    submittingRef.current = submitting;
    onCloseRef.current = onClose;
  });

  // Escape cierra (salvo con un envío en curso) y Tab queda dentro del modal.
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cardRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!submittingRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusables = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>("button, select, input, textarea, [href]"),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!cardRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previo?.focus?.();
    };
  }, []);
  // Jornada vigente en la fecha de inicio: sin ella se asume la de 8 h x 5 días.
  const [jornadas, setJornadas] = useState<JornadasEfectivas | null>(null);
  const fechaJornada = /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) ? form.startDate : "";
  useEffect(() => {
    let cancelado = false;
    getEffectiveWorkdays(fechaJornada || undefined)
      .then((j) => {
        if (!cancelado) setJornadas(j);
      })
      .catch(() => {
        // Sin la jornada se muestra el equivalente con la referencia de 8 h.
        if (!cancelado) setJornadas(null);
      });
    return () => {
      cancelado = true;
    };
  }, [fechaJornada]);
  const jornada = useMemo(() => {
    if (!jornadas) return undefined;
    const propia = multipleMode ? undefined : jornadas.consultants.find((c) => c.consultantId === form.consultantId);
    return propia
      ? { hoursPerDay: propia.hoursPerDay, workDaysPerWeek: propia.workDaysPerWeek, deConsultor: true }
      : { hoursPerDay: jornadas.general.hoursPerDay, workDaysPerWeek: jornadas.general.workDaysPerWeek, deConsultor: false };
  }, [jornadas, multipleMode, form.consultantId]);
  const equivalente =
    form.allocationMode === "HOURS" ? textoEquivalente(form.hoursPerPeriod, form.periodUnit, jornada) : null;
  // El error de fechas se avisa junto al campo, antes de enviar.
  const errorFechas =
    form.startDate && form.endDate ? validarAsignacion({ ...form, allocationMode: "PERCENTAGE" }) : null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div ref={cardRef} className="modal-card capacity-modal" role="dialog" aria-modal="true" aria-label={editing ? "Editar asignación" : "Nueva asignación"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header capacity-modal-header">
          <h2 className="capacity-modal-title">{editing ? "Editar asignación" : "Nueva asignación"}</h2>
          <button type="button" className="ghost capacity-modal-close" aria-label="Cerrar" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="form-grid two-col capacity-form">
          <div className="capacity-field capacity-field--full">
            <label className="field-label" htmlFor="asignacion-proyecto">Proyecto *</label>
            <select
              id="asignacion-proyecto"
              value={form.projectId}
              onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}
              required
            >
              <option value="" disabled hidden>Selecciona proyecto...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{etiquetaProyecto(p)}</option>
              ))}
            </select>
          </div>

          {!editing && (
            <div className="capacity-field capacity-field--full">
              <label className="check capacity-check">
                <input
                  type="checkbox"
                  checked={multipleMode}
                  onChange={(e) => {
                    onMultipleModeChange(e.target.checked);
                    setSelectedConsultantIds([]);
                  }}
                />
                Asignar múltiples consultores
              </label>
            </div>
          )}

          <div className="capacity-field capacity-field--full">
            <label className="field-label" htmlFor="asignacion-consultor">
              {multipleMode ? "Consultores *" : "Consultor *"}
            </label>
            {!multipleMode ? (
              <select
                id="asignacion-consultor"
                value={form.consultantId}
                onChange={(e) => setForm((p) => ({ ...p, consultantId: e.target.value }))}
                required
              >
                <option value="" disabled hidden>Selecciona consultor...</option>
                {consultants
                  .filter((c) => c.active || c.id === form.consultantId)
                  .map((c) => <option key={c.id} value={c.id}>{c.fullName} — {c.role}</option>)}
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
                      const q = consultantSearch.toLowerCase();
                      setSelectedConsultantIds(
                        consultants
                          .filter((c) => c.active && (c.fullName.toLowerCase().includes(q) || c.role.toLowerCase().includes(q)))
                          .map((c) => c.id),
                      );
                    }}
                  >
                    Seleccionar todos
                  </button>
                  <button type="button" className="ghost capacity-btn-row" onClick={() => setSelectedConsultantIds([])}>
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
                            onChange={() =>
                              setSelectedConsultantIds((prev) =>
                                isChecked ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                              )
                            }
                          />
                          <span>{c.fullName} <span className="capacity-picker__role">({c.role})</span></span>
                        </label>
                      );
                    })}
                </div>
                <span className="capacity-picker__count">{selectedConsultantIds.length} seleccionados</span>
              </div>
            )}
          </div>

          <div className="capacity-field">
            <label className="field-label" htmlFor="asignacion-inicio">Fecha de inicio *</label>
            <input
              id="asignacion-inicio"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
              required
            />
          </div>

          <div className="capacity-field">
            <label className="field-label" htmlFor="asignacion-fin">Fecha de fin *</label>
            <input
              id="asignacion-fin"
              type="date"
              min={form.startDate || undefined}
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
              required
            />
            {errorFechas && <p className="field-error" role="alert">{errorFechas}</p>}
          </div>

          <div className="capacity-field">
            <label className="field-label" htmlFor="asignacion-certeza">Estado de certeza *</label>
            <select
              id="asignacion-certeza"
              value={form.certainty}
              onChange={(e) => setForm((p) => ({ ...p, certainty: e.target.value as AssignmentCertainty }))}
            >
              <option value="CONFIRMED">Confirmado</option>
              <option value="PROBABLE">Probable</option>
            </select>
            {form.certainty === "PROBABLE" && (
              <p className="field-help">Una asignación probable solo suma al capacity si se incluyen las probables.</p>
            )}
          </div>

          <div className="capacity-field">
            <label className="field-label" htmlFor="asignacion-modo">Modo de asignación *</label>
            <select
              id="asignacion-modo"
              value={form.allocationMode}
              onChange={(e) => setForm((p) => ({ ...p, allocationMode: e.target.value as AllocationMode }))}
            >
              <option value="HOURS">Por horas</option>
              <option value="PERCENTAGE">Por porcentaje</option>
            </select>
          </div>

          {form.allocationMode === "PERCENTAGE" ? (
            <div className="capacity-field">
              <label className="field-label" htmlFor="asignacion-pct">Porcentaje de capacidad *</label>
              <input
                id="asignacion-pct"
                type="number"
                min="1"
                max="200"
                step="1"
                placeholder="% de capacidad (ej: 100)"
                value={form.allocationPct}
                onChange={(e) => setForm((p) => ({ ...p, allocationPct: e.target.value }))}
                required
              />
            </div>
          ) : (
            <div className="capacity-field capacity-field--full">
              <div className="capacity-field-pair">
              <div className="capacity-field capacity-field--grow">
                <label className="field-label" htmlFor="asignacion-horas">Horas *</label>
                <input
                  id="asignacion-horas"
                  type="number"
                  min="0.5"
                  step="0.5"
                  placeholder="Horas"
                  value={form.hoursPerPeriod}
                  onChange={(e) => setForm((p) => ({ ...p, hoursPerPeriod: e.target.value }))}
                  required
                />
              </div>
              <div className="capacity-field capacity-field--grow">
                <label className="field-label" htmlFor="asignacion-periodo">Período *</label>
                <select
                  id="asignacion-periodo"
                  value={form.periodUnit}
                  onChange={(e) => setForm((p) => ({ ...p, periodUnit: e.target.value as "week" | "month" }))}
                >
                  <option value="week">Por semana</option>
                  <option value="month">Por mes</option>
                </select>
              </div>
              </div>
              {equivalente && <p className="field-help" data-testid="equivalente-jornada">{equivalente}</p>}
            </div>
          )}

          <div className="capacity-field capacity-field--full">
            <label className="field-label" htmlFor="asignacion-rol">Rol en el proyecto (opcional)</label>
            <input
              id="asignacion-rol"
              placeholder="Rol en el proyecto"
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
            />
          </div>

          <div className="capacity-field capacity-field--full">
            <label className="field-label" htmlFor="asignacion-nota">Nota (opcional)</label>
            <textarea
              id="asignacion-nota"
              placeholder="Nota"
              value={form.note}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            />
          </div>

          <div className="modal-actions capacity-modal-actions">
            <button type="button" className="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? (editing ? "Guardando…" : "Creando…") : editing ? "Guardar cambios" : "Crear asignación"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
