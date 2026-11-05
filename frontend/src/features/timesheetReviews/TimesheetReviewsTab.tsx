import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  approveTimesheetReviews,
  listTimesheetReviews,
  returnTimesheetReview,
  type Project,
  type WeekReviewFilters,
  type WeekReviewRow,
  type WeekReviewStatus,
} from "../../services/api";
import { addDays, formatWeekRange, startOfWeek, todayIso, weekdayLabel } from "../timesheet/timesheetUtils";
import {
  FLAG_LABELS,
  FLAG_ORDER,
  FLAG_SYMBOLS,
  REVIEW_STATUS_PILL,
  approveErrorMessage,
  dayCellTitle,
  formatHm,
  formatHmTotal,
  isSelectable,
  rowKey,
  sortFlags,
  toItems,
} from "./reviewUtils";
import { DelegationsPanel } from "./DelegationsPanel";
import { canDelegate } from "./delegationUtils";
import "./timesheetReviews.css";

const RETURN_NOTE_MAX = 1000;

type StatusFilter = WeekReviewStatus | "ALL";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "SUBMITTED", label: "Enviadas" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "RETURNED", label: "Devueltas" },
  { value: "ALL", label: "Todas" },
];

function clock(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function TimesheetReviewsTab({
  onChanged,
  onNotice,
  projects = [],
  userEmail,
  isAdmin = false,
}: {
  /** Se llama tras aprobar o devolver, para refrescar el contador del menú y los datos de horas. */
  onChanged: () => void | Promise<void>;
  onNotice: (message: string, type?: "success" | "error" | "warning" | "info") => void;
  /** Para la sección "Mis delegaciones": proyectos con su PM. */
  projects?: readonly Project[];
  userEmail?: string;
  isAdmin?: boolean;
}) {
  const [section, setSection] = useState<"review" | "delegations">("review");
  const showDelegations = canDelegate(projects, userEmail, isAdmin);
  // null = todas las semanas (con el estado elegido); por defecto, las que tienen pendientes.
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("SUBMITTED");

  const [rows, setRows] = useState<WeekReviewRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Opciones de los filtros: se acumulan de lo que va llegando para que no se
  // encojan al filtrar (y para funcionar sin el listado general de consultores).
  const [knownProjects, setKnownProjects] = useState<Record<string, string>>({});
  const [knownConsultants, setKnownConsultants] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [returnTarget, setReturnTarget] = useState<WeekReviewRow | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [returnError, setReturnError] = useState<string | null>(null);

  // Descarta la respuesta de una petición vieja si el usuario ya cambió el filtro.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    const filters: WeekReviewFilters = {
      status,
      ...(weekStart ? { weekStart } : {}),
      ...(projectId ? { projectId } : {}),
      ...(consultantId ? { consultantId } : {}),
    };
    try {
      const result = await listTimesheetReviews(filters);
      if (id !== requestId.current) return;
      setRows(result.rows);
      setTotal(result.total);
      setTruncated(result.truncated);
      setSelected(new Set());
      setKnownProjects((prev) => ({
        ...prev,
        ...Object.fromEntries(result.rows.map((r) => [r.projectId, r.projectName])),
      }));
      setKnownConsultants((prev) => ({
        ...prev,
        ...Object.fromEntries(result.rows.map((r) => [r.consultantId, r.consultantName])),
      }));
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setLoadError(err instanceof Error ? err.message : "No se pudieron cargar las semanas por revisar");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [status, weekStart, projectId, consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectableRows = useMemo(() => rows.filter(isSelectable), [rows]);
  const selectedItems = useMemo(() => toItems(rows, selected), [rows, selected]);
  const allSelected = selectableRows.length > 0 && selectedItems.length === selectableRows.length;

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  async function afterChange() {
    await load();
    await onChanged();
  }

  /** Tras un fallo el estado real pudo cambiar (otro revisor): se refresca lista y contador. */
  async function refreshAfterError() {
    try {
      await afterChange();
    } catch {
      // El error original ya está a la vista; si el refresco falla, `load` muestra el suyo.
    }
  }

  async function approve(items: ReturnType<typeof toItems>) {
    if (items.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await approveTimesheetReviews(items);
      onNotice(items.length === 1 ? "Semana aprobada." : `${items.length} semanas aprobadas.`, "success");
      await afterChange();
    } catch (err) {
      // Todo o nada: el servidor no aprobó ninguna; se nombra la fila culpable.
      setActionError(approveErrorMessage(err, items, rows));
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturn() {
    const target = returnTarget;
    if (!target) return;
    const note = returnNote.trim();
    if (note.length < 3) return;
    setBusy(true);
    setActionError(null);
    setReturnError(null);
    try {
      await returnTimesheetReview({
        consultantId: target.consultantId,
        projectId: target.projectId,
        weekStart: target.weekStart,
        note,
      });
      setReturnTarget(null);
      setReturnNote("");
      onNotice(`Semana devuelta a ${target.consultantName}.`, "success");
      await afterChange();
    } catch (err) {
      // El diálogo sigue abierto con la nota intacta; el error se ve dentro.
      setReturnError(err instanceof Error ? err.message : "No se pudo devolver la semana");
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }

  const today = todayIso();
  const currentMonday = startOfWeek(today);
  const weekLabel = weekStart
    ? formatWeekRange(weekStart)
    : status === "SUBMITTED"
      ? "Todas con pendientes"
      : "Todas las semanas";
  const emptyText =
    status === "SUBMITTED" && !weekStart && !projectId && !consultantId
      ? "No hay semanas por revisar"
      : "No hay semanas con los filtros elegidos";

  return (
    <div className="section-stack">
      <PageHeader
        icon="✔"
        title="Aprobación de horas"
        description="Revisa las semanas que enviaron los consultores en tus proyectos: una fila por consultor, proyecto y semana. Aprueba o devuelve con una nota."
      />

      {showDelegations && (
        <div className="rv-subtabs" role="group" aria-label="Secciones">
          <button
            type="button"
            className={section === "review" ? undefined : "ghost"}
            aria-pressed={section === "review"}
            onClick={() => setSection("review")}
          >
            Revisión de semanas
          </button>
          <button
            type="button"
            className={section === "delegations" ? undefined : "ghost"}
            aria-pressed={section === "delegations"}
            onClick={() => setSection("delegations")}
          >
            Mis delegaciones
          </button>
        </div>
      )}

      {showDelegations && section === "delegations" && (
        <DelegationsPanel projects={projects} userEmail={userEmail} isAdmin={isAdmin} onNotice={onNotice} />
      )}

      <article className="card" hidden={section === "delegations" && showDelegations}>
        <div className="rv-filters">
          <div className="rv-weeknav" role="group" aria-label="Semana">
            <button
              type="button"
              className="ghost"
              aria-label="Semana anterior"
              onClick={() => setWeekStart((w) => addDays(w ?? currentMonday, -7))}
            >
              ←
            </button>
            <span className="rv-weeklabel" aria-live="polite">{weekLabel}</span>
            <button
              type="button"
              className="ghost"
              aria-label="Semana siguiente"
              onClick={() => setWeekStart((w) => addDays(w ?? currentMonday, 7))}
            >
              →
            </button>
            <button type="button" className="ghost" onClick={() => setWeekStart(null)} disabled={weekStart === null}>
              {status === "SUBMITTED" ? "Todas con pendientes" : "Todas"}
            </button>
          </div>

          <label className="rv-field">
            Proyecto
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Todos los proyectos</option>
              {Object.entries(knownProjects)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
            </select>
          </label>

          <label className="rv-field">
            Consultor
            <select value={consultantId} onChange={(e) => setConsultantId(e.target.value)}>
              <option value="">Todos los consultores</option>
              {Object.entries(knownConsultants)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
            </select>
          </label>

          <label className="rv-field">
            Estado
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <ul className="rv-legend" aria-label="Leyenda de novedades">
          {FLAG_ORDER.map((flag) => (
            <li key={flag}>
              <span className={`rv-flag rv-flag--${flag}`} aria-hidden="true">{FLAG_SYMBOLS[flag]}</span>
              {FLAG_LABELS[flag]}
            </li>
          ))}
        </ul>

        {actionError && (
          <div role="alert" className="notice notice--danger rv-banner">
            <p className="notice__title">No se pudo completar la acción</p>
            <p className="notice__text">{actionError}</p>
          </div>
        )}

        {truncated && (
          <div role="status" className="notice notice--warning rv-banner">
            <p className="notice__text">
              Hay {total} semanas y solo se muestran las primeras. Filtra por proyecto, consultor o semana para ver el resto.
            </p>
          </div>
        )}

        {selectableRows.length > 0 && (
          <div className="rv-bulk">
            <button
              type="button"
              onClick={() => void approve(selectedItems)}
              disabled={selectedItems.length === 0 || busy}
            >
              {`Aprobar seleccionadas (${selectedItems.length})`}
            </button>
          </div>
        )}

        {loading ? (
          <p className="loading" role="status">Cargando semanas…</p>
        ) : loadError ? (
          <div role="alert" className="notice notice--danger">
            <p className="notice__title">No se pudieron cargar las semanas</p>
            <p className="notice__text">{loadError}</p>
            <button type="button" className="ghost" onClick={() => void load()}>Reintentar</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="empty-note empty-note--center">{emptyText}</p>
        ) : (
          <div className="rv-table-wrap table-wrap">
            <table className="rv-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todas las semanas revisables"
                      checked={allSelected}
                      disabled={selectableRows.length === 0}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(selectableRows.map(rowKey)))
                      }
                    />
                  </th>
                  <th>Consultor</th>
                  <th>Proyecto</th>
                  <th>Semana</th>
                  {Array.from({ length: 7 }, (_, i) => (
                    <th key={i} className="rv-col-day">{weekdayLabel(i)}</th>
                  ))}
                  <th className="rv-col-total">Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = rowKey(row);
                  const open = expanded.has(key);
                  const pill = REVIEW_STATUS_PILL[row.status];
                  const selectable = isSelectable(row);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${row.consultantName}, ${row.projectName}`}
                            checked={selected.has(key)}
                            disabled={!selectable}
                            onChange={() => setSelected((prev) => toggle(prev, key))}
                          />
                        </td>
                        <td>
                          <div className="rv-who">
                            <span className="rv-who-name">
                              <button
                                type="button"
                                className="rv-expand"
                                aria-expanded={open}
                                aria-label={`${open ? "Ocultar" : "Ver"} registros de ${row.consultantName} en ${row.projectName}`}
                                onClick={() => setExpanded((prev) => toggle(prev, key))}
                              >
                                {open ? "▾" : "▸"}
                              </button>
                              {row.consultantName}
                            </span>
                            {row.flags.length > 0 && (
                              <span className="rv-chips">
                                {sortFlags(row.flags).map((flag) => (
                                  <span
                                    key={flag}
                                    className={`rv-flag rv-flag--${flag}`}
                                    title={FLAG_LABELS[flag]}
                                  >
                                    {FLAG_SYMBOLS[flag]} {FLAG_LABELS[flag]}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{row.projectName}</td>
                        <td>{formatWeekRange(row.weekStart)}</td>
                        {row.days.map((day) => {
                          const flags = sortFlags(day.flags);
                          const primary = flags[0];
                          const empty = day.hours <= 0 && flags.length === 0;
                          return (
                            <td key={day.date} className="rv-col-day">
                              <span
                                className={`rv-day${primary ? ` rv-flag--${primary}` : ""}${empty ? " rv-day--empty" : ""}`}
                                title={dayCellTitle(day)}
                                aria-label={dayCellTitle(day)}
                              >
                                <span>{formatHm(day.hours) || "—"}</span>
                                {flags.length > 0 && (
                                  <span className="rv-day-syms" aria-hidden="true">
                                    {flags.map((f) => FLAG_SYMBOLS[f]).join(" ")}
                                  </span>
                                )}
                              </span>
                            </td>
                          );
                        })}
                        <td className="rv-col-total"><strong>{formatHmTotal(row.total)}</strong></td>
                        <td>
                          <span className={`pill ${pill.tone}`}>{pill.label}</span>
                        </td>
                        <td>
                          {selectable ? (
                            <div className="rv-actions">
                              <button
                                type="button"
                                className="btn-sm btn-success"
                                disabled={busy}
                                onClick={() => void approve(toItems([row], new Set([key])))}
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                className="btn-sm btn-danger-soft"
                                disabled={busy}
                                onClick={() => {
                                  setReturnNote("");
                                  setReturnError(null);
                                  setReturnTarget(row);
                                }}
                              >
                                Devolver
                              </button>
                            </div>
                          ) : row.status === "SUBMITTED" ? (
                            <span className="rv-readonly" title="Solo el PM del proyecto o su delegado puede revisarla">
                              Solo lectura
                            </span>
                          ) : (
                            <span className="rv-readonly">
                              {row.review.reviewedBy ? `Por ${row.review.reviewedBy}` : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="rv-detail">
                          <td colSpan={14}>
                            {row.entries.length === 0 ? (
                              <p className="empty-note">Esta semana no tiene registros en el proyecto.</p>
                            ) : (
                              <table>
                                <thead>
                                  <tr>
                                    <th>Fecha</th>
                                    <th>Tipo</th>
                                    <th>Franja</th>
                                    <th>Duración</th>
                                    <th>Descripción</th>
                                    <th>Excedente</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.entries.map((e) => (
                                    <tr key={e.id}>
                                      <td>{e.workDate.slice(0, 10)}</td>
                                      <td>{e.type?.name ?? "Regular"}</td>
                                      <td>{e.startedAt && e.endedAt ? `${clock(e.startedAt)} - ${clock(e.endedAt)}` : "—"}</td>
                                      <td>{formatHmTotal(Number(e.hours))}</td>
                                      <td>{e.description || "Sin descripción"}</td>
                                      <td>{e.isExcess ? "Sí" : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {row.review.note && (
                              <p className="rv-detail-note">Nota de la devolución: «{row.review.note}»</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <ConfirmDialog
        open={!!returnTarget}
        title="Devolver semana"
        danger
        confirmLabel={busy ? "Devolviendo…" : "Devolver"}
        confirmDisabled={returnNote.trim().length < 3 || busy}
        onCancel={() => {
          setReturnTarget(null);
          setReturnError(null);
        }}
        onConfirm={() => void confirmReturn()}
        message={
          returnTarget && (
            <div>
              <p>
                Se devuelve <strong>{returnTarget.projectName}</strong> de {returnTarget.consultantName} (
                {formatWeekRange(returnTarget.weekStart)}). El consultor podrá corregirlo y volver a enviarlo.
              </p>
              <label htmlFor="rv-return-note">Motivo de la devolución (mínimo 3 caracteres)</label>
              <textarea
                id="rv-return-note"
                className="rv-return-note"
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                placeholder="Explica qué debe corregir el consultor"
                maxLength={RETURN_NOTE_MAX}
                autoFocus
              />
              <span className="rv-note-counter" aria-live="polite">
                {returnNote.length} / {RETURN_NOTE_MAX}
              </span>
              {returnError && (
                <div role="alert" className="notice notice--danger rv-banner">
                  <p className="notice__title">No se pudo devolver la semana</p>
                  <p className="notice__text">{returnError}</p>
                </div>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
