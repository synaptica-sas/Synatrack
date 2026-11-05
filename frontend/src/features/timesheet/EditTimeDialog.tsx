import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  type DayEntryInput,
  type DaySummary,
  type TimeEntry,
  type TimeEntryType,
} from "../../services/api";
import { TIME_ENTRY_STATUS_LABELS, label } from "../../utils/statusLabels";
import { formatDuration } from "./timesheetUtils";
import {
  approvedRangesOf,
  buildDayPayload,
  formatApprovedRanges,
  linkRow,
  normalizeField,
  normalizeRowTimes,
  outsideApprovedWarning,
  prefillExtraRow,
  type TimeField,
  type TimeFieldError,
  categoryOf,
  computeLiveFooter,
  defaultTypeId,
  focusAfterDelete,
  focusAfterEnter,
  isBlank,
  mapServerErrors,
  offeredTypes,
  rowFromEntry,
  withTrailingBlank,
  type DayColumn,
  type DayRow,
} from "./timesheetDay";

/** "28/09/2026" a partir de "2026-09-28". */
function formatDay(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Ventana "Editar tiempo" de una celda del timesheet: una tabla editable con un
 * renglón por registro (Tipo · Inicio · Fin · Duración · Descripción).
 *
 * - Siempre hay un renglón vacío al final; escribir en él crea el registro.
 * - Enter baja a la misma columna del renglón siguiente, Ctrl+Supr elimina el
 *   renglón, Ctrl+Enter guarda y Esc cierra.
 * - Los registros ya revisados se muestran pero no se tocan; los pendientes (los
 *   excedentes de horas extra incluidos) se reenvían al guardar, porque el
 *   servidor reemplaza todos los pendientes del día y proyecto.
 * - Guardar es una sola llamada: o queda todo o no queda nada.
 */
export function EditTimeDialog({
  day,
  projectId,
  projectName,
  isAbsenceProject,
  entries,
  types,
  summary,
  readOnly,
  esPropio = true,
  onSave,
  onClose,
}: {
  day: string;
  projectId: string;
  projectName: string;
  isAbsenceProject: boolean;
  entries: TimeEntry[];
  types: TimeEntryType[];
  /** Resumen del servidor para este día; `undefined` si no se pudo cargar. */
  summary: DaySummary | undefined;
  readOnly: boolean;
  /** `false` si se edita la semana de otro consultor: las horas extra quedan de solo lectura. */
  esPropio?: boolean;
  /** Ejecuta el guardado contra la API; debe lanzar el error si falla. */
  onSave: (entries: DayEntryInput[]) => Promise<void>;
  onClose: () => void;
}) {
  const extraApproved = summary?.projects.find((p) => p.projectId === projectId)?.extraApproved ?? 0;
  const regularAllowed = summary ? summary.regularAllowed : true;

  const offerCtx = { isAbsenceProject, regularAllowed, extraApproved, allowExtra: esPropio };
  const baseTypeId = defaultTypeId(offeredTypes(types, offerCtx), isAbsenceProject);

  const [rows, setRows] = useState<DayRow[]>(() => {
    const base = entries.map((e) => rowFromEntry(e, { lockExtra: !esPropio }));
    return readOnly ? base : withTrailingBlank(base, baseTypeId);
  });
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  // Errores de hora/duración por renglón (clave estable de fila, no el índice).
  const [timeErrors, setTimeErrors] = useState<Record<string, TimeFieldError>>({});
  const approvedRanges = useMemo(() => approvedRangesOf(summary, projectId), [summary, projectId]);
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const initialPending = useRef(entries.some((e) => e.status === "PENDING"));

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currentTypeIds = useMemo(() => rows.map((r) => r.typeId).filter(Boolean), [rows]);
  const offered = useMemo(
    () => offeredTypes(types, { isAbsenceProject, regularAllowed, extraApproved, allowExtra: esPropio }, currentTypeIds),
    [types, isAbsenceProject, regularAllowed, extraApproved, esPropio, currentTypeIds],
  );

  const footer = useMemo(
    () => (summary ? computeLiveFooter({ summary, projectId, entries, rows, types }) : null),
    [summary, projectId, entries, rows, types],
  );

  const puedeEditar = !readOnly;

  function focusCell(row: number, col: DayColumn) {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
    el?.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
  }

  function patch(index: number, changes: Partial<DayRow>) {
    setRows((prev) =>
      withTrailingBlank(
        prev.map((r, i) => (i === index ? { ...r, ...changes } : r)),
        baseTypeId,
      ),
    );
    setRowErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (!row || !row.editable || isBlank(row)) return;
    const next = withTrailingBlank(
      rows.filter((_, i) => i !== index),
      baseTypeId,
    );
    setRows(next);
    setRowErrors({});
    const target = focusAfterDelete(index, next.length);
    setTimeout(() => focusCell(target, "type"), 0);
  }

  function setTimeError(key: string, error: TimeFieldError | undefined) {
    setTimeErrors((prev) => {
      if (!error && !(key in prev)) return prev;
      const next = { ...prev };
      if (error) next[key] = error;
      else delete next[key];
      return next;
    });
  }

  // Tocar un campo no borra el error de otro (p.ej. un inicio inválido).
  function setFieldError(key: string, field: TimeField, error: TimeFieldError | undefined) {
    const previous = timeErrors[key];
    const stillBad = previous && !previous.fields.includes(field) ? previous : undefined;
    setTimeError(key, error ?? stillBad);
  }

  // Igual que en Clockify, pero en vivo: mover el inicio conserva la duración y
  // desplaza el fin; mover el fin cambia la duración; cambiar la duración mueve
  // el fin. Lo escrito se deja como está hasta salir del campo (blur/Tab/Enter).
  function editTime(index: number, field: TimeField, value: string) {
    const row = rows[index];
    const linked = linkRow({ ...row, [field]: value }, field);
    patch(index, { [field]: value, ...linked.changes });
    setFieldError(row.key, field, linked.error);
  }

  function commitTime(index: number, field: TimeField) {
    const row = rows[index];
    if (!row || !row.editable) return;
    const result = normalizeField(row, field);
    if (Object.keys(result.changes).length > 0) patch(index, result.changes);
    setFieldError(row.key, field, result.error);
  }

  // Al pasar un renglón a Extra se le ofrece la primera franja aprobada libre.
  // Un renglón que nace como Extra (único tipo ofrecido, o el de por defecto)
  // se precarga cuando el usuario empieza a escribir en él; no antes, para que
  // el renglón vacío del final no se convierta en registro por sí solo.
  function changeDescription(index: number, value: string) {
    const row = rows[index];
    const changes: Partial<DayRow> = { description: value };
    if (isBlank(row) && row.editable && categoryOf(types, row.typeId) === "EXTRA") {
      const prefill = prefillExtraRow(
        row,
        rows.filter((_, i) => i !== index),
        approvedRanges,
        types,
      );
      if (prefill) Object.assign(changes, prefill);
    }
    patch(index, changes);
  }

  function changeType(index: number, typeId: string) {
    const changes: Partial<DayRow> = { typeId };
    if (categoryOf(types, typeId) === "EXTRA") {
      const prefill = prefillExtraRow(
        rows[index],
        rows.filter((_, i) => i !== index),
        approvedRanges,
        types,
      );
      if (prefill) {
        Object.assign(changes, prefill);
        setTimeError(rows[index].key, undefined);
      }
    }
    patch(index, changes);
  }

  async function handleSave() {
    if (saving || !puedeEditar) return;

    // Quien guarda con Ctrl+Enter no salió del campo: se normalizan las horas aquí.
    const found: Record<string, TimeFieldError> = {};
    const bads: Array<{ index: number; field: TimeField }> = [];
    const normalized = rows.map((r, i) => {
      if (!r.editable || isBlank(r)) return r;
      const result = normalizeRowTimes(r);
      if (result.error) {
        found[r.key] = result.error;
        bads.push({ index: i, field: result.error.fields[0] });
      }
      return result.row;
    });
    setRows(normalized);
    if (bads.length > 0) {
      setTimeErrors(found);
      setGeneralErrors([]);
      setRowErrors({});
      focusCell(bads[0].index, bads[0].field);
      return;
    }
    setTimeErrors({});

    const built = buildDayPayload(day, normalized, types);
    if (!built.ok) {
      setGeneralErrors([]);
      setRowErrors({ [built.rowIndex]: built.message });
      focusCell(built.rowIndex, "duration");
      return;
    }
    if (built.entries.length === 0 && !initialPending.current) {
      onClose();
      return;
    }

    setSaving(true);
    setRowErrors({});
    setGeneralErrors([]);
    try {
      await onSave(built.entries);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length > 0) {
        const mapped = mapServerErrors(err.errors, built.rowIndexes);
        setRowErrors(mapped.byRow);
        setGeneralErrors(mapped.general);
      } else {
        setGeneralErrors([err instanceof Error ? err.message : "No se pudo guardar el tiempo"]);
      }
    } finally {
      setSaving(false);
    }
  }

  function onTableKeyDown(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    const rowAttr = target.dataset.row;
    const col = target.dataset.col as DayColumn | undefined;
    if (rowAttr === undefined || !col) return;
    const row = Number(rowAttr);

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (e.key === "Delete" && e.ctrlKey) {
      e.preventDefault();
      removeRow(row);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const next = focusAfterEnter({ row, col });
      // Se espera al re-render: salir del campo puede completar el fin o la
      // duración, y escribir en el renglón vacío crea otro debajo.
      setTimeout(() => focusCell(next.row, next.col), 0);
    }
  }

  const nonWorking = summary && !summary.regularAllowed;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card ts-edit ts-edit--table"
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

        {nonWorking && (
          <p className="ts-edit-notice" role="note">
            {summary.holidayName ?? (summary.isWeekend ? "Fin de semana" : "Día no laborable")}: no admite horas
            regulares ni ausencias; solo horas extra con solicitud aprobada.
          </p>
        )}

        {generalErrors.length > 0 && (
          <div className="ts-edit-error" role="alert">
            {generalErrors.map((m) => (
              <div key={m}>{m}</div>
            ))}
          </div>
        )}

        {types.length === 0 && (
          <p className="ts-edit-error" role="alert">
            No se pudo cargar el catálogo de tipos de hora. Cierra la ventana e inténtalo de nuevo.
          </p>
        )}

        {!esPropio && !readOnly && (
          <p className="ts-notice" role="status">
            Las horas extra solo las registra el propio consultor: aquí no se pueden crear ni editar.
          </p>
        )}

        <div className="ts-day-tablewrap" ref={tableRef} onKeyDown={onTableKeyDown}>
          <table className="ts-day-table">
            <thead>
              <tr>
                <th className="ts-day-col-type">Tipo</th>
                <th className="ts-day-col-time" title="Obligatorio en horas extra">
                  Inicio
                </th>
                <th className="ts-day-col-time" title="Obligatorio en horas extra">
                  Fin
                </th>
                <th className="ts-day-col-dur">Duración</th>
                <th>Descripción</th>
                <th className="ts-day-col-del" aria-label="Eliminar" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const bloqueado = readOnly || !row.editable;
                const esExtra = categoryOf(types, row.typeId) === "EXTRA";
                const outsideWarning = outsideApprovedWarning(row, approvedRanges, types);
                const timeError = timeErrors[row.key];
                const error = rowErrors[i] ?? timeError?.message;
                const invalid = (f: TimeField) => !!timeError && timeError.fields.includes(f);
                const esVacio = row.editable && isBlank(row);
                return (
                  <tr
                    key={row.key}
                    className={[
                      bloqueado ? "ts-day-row--locked" : "",
                      esVacio ? "ts-day-row--blank" : "",
                      error ? "ts-day-row--error" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="ts-day-col-type">
                      {bloqueado ? (
                        <span className="ts-day-typename">{row.typeName || "—"}</span>
                      ) : (
                        <select
                          data-row={i}
                          data-col="type"
                          value={row.typeId}
                          onChange={(e) => changeType(i, e.target.value)}
                          aria-label="Tipo de hora"
                        >
                          {row.typeId === "" && <option value="">Elige un tipo</option>}
                          {offered.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {row.status && row.status !== "PENDING" && (
                        <span className={`pill ${row.status === "APPROVED" ? "ok" : "error"}`}>
                          {label(TIME_ENTRY_STATUS_LABELS, row.status)}
                        </span>
                      )}
                      {row.isExcess && row.status === "PENDING" && (
                        <span className="pill warn">Excedente — pendiente PM</span>
                      )}
                      {row.isExcess && row.status === "APPROVED" && (
                        <span className="pill ok">Excedente aprobado</span>
                      )}
                    </td>
                    <td className="ts-day-col-time">
                      <input
                        data-row={i}
                        data-col="start"
                        className={esExtra ? "ts-day-required" : ""}
                        value={row.start}
                        placeholder="HH:MM"
                        inputMode="text"
                        autoComplete="off"
                        disabled={bloqueado}
                        onChange={(e) => editTime(i, "start", e.target.value)}
                        onBlur={() => commitTime(i, "start")}
                        aria-label="Hora de inicio"
                        aria-required={esExtra}
                        aria-invalid={invalid("start")}
                      />
                    </td>
                    <td className="ts-day-col-time">
                      <input
                        data-row={i}
                        data-col="end"
                        className={esExtra ? "ts-day-required" : ""}
                        value={row.end}
                        placeholder="HH:MM"
                        inputMode="text"
                        autoComplete="off"
                        disabled={bloqueado}
                        onChange={(e) => editTime(i, "end", e.target.value)}
                        onBlur={() => commitTime(i, "end")}
                        aria-label="Hora de fin"
                        aria-required={esExtra}
                        aria-invalid={invalid("end")}
                      />
                    </td>
                    <td className="ts-day-col-dur">
                      <input
                        data-row={i}
                        data-col="duration"
                        value={row.duration}
                        placeholder="00:00:00"
                        disabled={bloqueado}
                        inputMode="text"
                        autoComplete="off"
                        onChange={(e) => editTime(i, "duration", e.target.value)}
                        onBlur={() => commitTime(i, "duration")}
                        aria-label="Duración"
                        aria-invalid={invalid("duration")}
                      />
                    </td>
                    <td>
                      <textarea
                        data-row={i}
                        data-col="description"
                        rows={1}
                        value={row.description}
                        placeholder={esVacio ? "¿Qué hiciste? (Mayús+Enter para otra línea)" : ""}
                        disabled={bloqueado}
                        maxLength={500}
                        onChange={(e) => changeDescription(i, e.target.value)}
                        aria-label="Descripción"
                      />
                      {error && (
                        <div className="ts-day-rowerror" role="alert">
                          {error}
                        </div>
                      )}
                      {!bloqueado && outsideWarning && (
                        <div className="ts-day-warn" role="status">
                          {outsideWarning}
                        </div>
                      )}
                      {esExtra && !bloqueado && approvedRanges.length > 0 && (
                        <div className="ts-day-hint">Aprobado: {formatApprovedRanges(approvedRanges)}</div>
                      )}
                    </td>
                    <td className="ts-day-col-del">
                      {!bloqueado && !esVacio && (
                        <button
                          type="button"
                          className="ghost ts-day-del"
                          onClick={() => removeRow(i)}
                          aria-label="Eliminar este registro"
                          title="Eliminar este registro (Ctrl+Supr)"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {footer && (
          <div className="ts-day-footer">
            <div className={footer.overBy > 0 ? "ts-day-over" : ""}>
              Regular + ausencias (todos los proyectos): <strong>{formatDuration(footer.used)}</strong> /{" "}
              {formatDuration(footer.cap)}
              {footer.overBy > 0 ? (
                <> · se pasa por {formatDuration(footer.overBy)}</>
              ) : (
                <> · restante {formatDuration(footer.remaining)}</>
              )}
            </div>
            {footer.showExtra && (
              <div className={footer.extraOver > 0 ? "ts-day-over" : ""}>
                Extra: <strong>{formatDuration(footer.extraUsed)}</strong> / {formatDuration(footer.extraApproved)}{" "}
                aprobado
                {footer.extraOver > 0 && (
                  <> · {formatDuration(footer.extraOver)} quedará como excedente pendiente del PM</>
                )}
              </div>
            )}
          </div>
        )}

        {puedeEditar && (
          <p className="ts-day-keys">
            Horas: 18, 1830 o 6pm · Duración: 2, 2,5 o 45m · Enter baja de fila · Ctrl+Enter guarda · Ctrl+Supr
            elimina la fila · Esc cierra
          </p>
        )}

        <div className="ts-edit-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {puedeEditar ? "Cancelar" : "Cerrar"}
          </button>
          {puedeEditar && (
            <button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
