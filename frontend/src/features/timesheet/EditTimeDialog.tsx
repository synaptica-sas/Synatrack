import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TimeEntry } from "../../services/api";
import { TIME_ENTRY_STATUS_LABELS, label } from "../../utils/statusLabels";
import { formatDuration, numberish, parseHoursInput, roundHours } from "./timesheetUtils";
import { endTimeFrom, hoursBetween, isValidTime, rangeFor, timeOfDay } from "./timesheetGrid";

/** Un registro tal como se edita en la ventana. `id` vacío = registro nuevo. */
type Draft = {
  id: string;
  duration: string;
  start: string;
  end: string;
  description: string;
  editable: boolean;
  status: TimeEntry["status"] | null;
  deleted: boolean;
};

/** Lo que la ventana pide guardar; la pantalla lo ejecuta contra la API. */
export type EditTimeChanges = {
  create: Array<{ hours: number; description: string | null; startedAt: string | null; endedAt: string | null }>;
  update: Array<{
    id: string;
    hours: number;
    description: string | null;
    startedAt: string | null;
    endedAt: string | null;
  }>;
  remove: string[];
};

function toDraft(entry: TimeEntry): Draft {
  return {
    id: entry.id,
    duration: formatDuration(numberish(entry.hours)),
    start: timeOfDay(entry.startedAt),
    end: timeOfDay(entry.endedAt),
    description: entry.description ?? "",
    editable: entry.status === "PENDING",
    status: entry.status,
    deleted: false,
  };
}

const emptyDraft = (): Draft => ({
  id: "",
  duration: "",
  start: "",
  end: "",
  description: "",
  editable: true,
  status: null,
  deleted: false,
});

/** "28/09/2026" a partir de "2026-09-28". */
function formatDay(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Ventana "Editar tiempo" de una celda del timesheet: duración, franja horaria
 * y descripción de lo que se hizo (una actividad por línea).
 *
 * Una celda puede reunir varios registros del mismo proyecto ese día (el
 * cronómetro deja uno por cada vez que se arranca y se detiene). Cada uno se
 * edita en su propio bloque; con un solo registro, la ventana es un único
 * bloque. Los registros ya revisados se muestran pero no se pueden tocar.
 */
export function EditTimeDialog({
  day,
  projectName,
  entries,
  readOnly,
  saving,
  onSave,
  onClose,
}: {
  day: string;
  projectName: string;
  entries: TimeEntry[];
  readOnly: boolean;
  saving: boolean;
  onSave: (changes: EditTimeChanges) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    entries.length > 0 ? entries.map(toDraft) : [emptyDraft()],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function patch(index: number, changes: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...changes } : d)));
  }

  // Igual que en Clockify: mover el inicio conserva la duración y desplaza el
  // fin; mover el fin cambia la duración; cambiar la duración mueve el fin.
  function onDurationBlur(index: number) {
    const d = drafts[index];
    const hours = parseHoursInput(d.duration);
    if (hours === null) return;
    patch(index, {
      duration: formatDuration(hours),
      ...(isValidTime(d.start) ? { end: endTimeFrom(d.start, hours) } : {}),
    });
  }

  function onStartBlur(index: number) {
    const d = drafts[index];
    if (!isValidTime(d.start)) return;
    const hours = parseHoursInput(d.duration);
    if (hours !== null && hours > 0) patch(index, { end: endTimeFrom(d.start, hours) });
  }

  function onEndBlur(index: number) {
    const d = drafts[index];
    if (!isValidTime(d.start) || !isValidTime(d.end)) return;
    const hours = hoursBetween(d.start, d.end);
    if (hours !== null) patch(index, { duration: formatDuration(hours) });
  }

  function handleSave() {
    const changes: EditTimeChanges = { create: [], update: [], remove: [] };
    const original = new Map(entries.map((e) => [e.id, e]));

    for (const d of drafts) {
      if (!d.editable) continue;
      if (d.deleted) {
        if (d.id) changes.remove.push(d.id);
        continue;
      }

      const hours = parseHoursInput(d.duration);
      if (hours === null || hours <= 0) {
        setError(`"${d.duration || "vacío"}" no es una duración válida. Usa 1:30:00, 1,5 o 90m.`);
        return;
      }
      if (d.start.trim() && !isValidTime(d.start)) {
        setError(`"${d.start}" no es una hora de inicio válida. Usa HH:MM, por ejemplo 09:00.`);
        return;
      }
      if (!d.start.trim() && d.end.trim()) {
        setError("Pon también la hora de inicio, o deja vacías las dos.");
        return;
      }
      if (d.start.trim() && d.end.trim() && hoursBetween(d.start, d.end) === null) {
        setError("La hora de fin debe ser posterior a la de inicio.");
        return;
      }

      const description = d.description.trim() || null;
      const { startedAt, endedAt } = rangeFor(day, d.start, hours);

      if (!d.id) {
        changes.create.push({ hours: roundHours(hours), description, startedAt, endedAt });
        continue;
      }

      const before = original.get(d.id)!;
      const sinCambios =
        roundHours(hours) === roundHours(numberish(before.hours)) &&
        description === (before.description || null) &&
        d.start === timeOfDay(before.startedAt) &&
        d.end === timeOfDay(before.endedAt);
      if (!sinCambios) {
        changes.update.push({ id: d.id, hours: roundHours(hours), description, startedAt, endedAt });
      }
    }

    setError(null);
    onSave(changes);
  }

  const visibles = drafts.map((d, i) => ({ d, i })).filter(({ d }) => !d.deleted);
  const puedeEditar = !readOnly && drafts.some((d) => d.editable);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card ts-edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ts-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ts-edit-header">
          <h3 id="ts-edit-title">Editar tiempo</h3>
          <button type="button" className="ghost ts-edit-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="ts-edit-meta">
          <span className="ts-edit-date">{formatDay(day)}</span>
          <span className="ts-edit-project">{projectName}</span>
        </div>

        {visibles.map(({ d, i }, n) => {
          const bloqueado = readOnly || !d.editable;
          return (
            <section key={d.id || `nuevo-${i}`} className="ts-edit-entry">
              {visibles.length > 1 && (
                <div className="ts-edit-entry-head">
                  <span>Registro {n + 1}</span>
                  {d.status && d.status !== "PENDING" && (
                    <span className={`pill ${d.status === "APPROVED" ? "ok" : "error"}`}>
                      {label(TIME_ENTRY_STATUS_LABELS, d.status)}
                    </span>
                  )}
                </div>
              )}
              {visibles.length === 1 && d.status && d.status !== "PENDING" && (
                <p className="ts-edit-locked">
                  {label(TIME_ENTRY_STATUS_LABELS, d.status)}: ya no se puede editar.
                </p>
              )}

              <div className="ts-edit-times">
                <input
                  className="ts-edit-duration"
                  value={d.duration}
                  placeholder="00:00:00"
                  disabled={bloqueado}
                  onChange={(e) => patch(i, { duration: e.target.value })}
                  onBlur={() => onDurationBlur(i)}
                  aria-label="Duración"
                />
                <div className="ts-edit-range">
                  <input
                    value={d.start}
                    placeholder="--:--"
                    disabled={bloqueado}
                    onChange={(e) => patch(i, { start: e.target.value })}
                    onBlur={() => onStartBlur(i)}
                    aria-label="Hora de inicio"
                  />
                  <span aria-hidden="true">-</span>
                  <input
                    value={d.end}
                    placeholder="--:--"
                    disabled={bloqueado}
                    onChange={(e) => patch(i, { end: e.target.value })}
                    onBlur={() => onEndBlur(i)}
                    aria-label="Hora de fin"
                  />
                </div>
              </div>

              <label className="ts-edit-field">
                <span>Descripción</span>
                <textarea
                  rows={3}
                  value={d.description}
                  placeholder={"¿Qué actividades hiciste?\nUna por línea"}
                  disabled={bloqueado}
                  maxLength={500}
                  onChange={(e) => patch(i, { description: e.target.value })}
                />
              </label>

              {!bloqueado && (visibles.length > 1 || d.id) && (
                <button
                  type="button"
                  className="ghost ts-edit-remove"
                  onClick={() => patch(i, { deleted: true })}
                >
                  Eliminar este registro
                </button>
              )}
            </section>
          );
        })}

        {puedeEditar && (
          <button
            type="button"
            className="ghost ts-edit-add"
            onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
          >
            + Agregar otro registro este día
          </button>
        )}

        {error && (
          <p className="ts-edit-error" role="alert">
            {error}
          </p>
        )}

        <div className="ts-edit-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {puedeEditar ? "Cancelar" : "Cerrar"}
          </button>
          {puedeEditar && (
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
