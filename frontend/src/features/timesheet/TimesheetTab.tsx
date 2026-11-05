import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ApiError,
  createTimeEntry,
  deleteTimeEntry,
  getDaySummary,
  getMyConsultant,
  getTimesheetWeekStatus,
  listAllTimeEntries,
  listTimeEntryTypes,
  saveDayEntries,
  submitTimesheetWeek,
  updateTimeEntry,
  type Consultant,
  type DayEntryInput,
  type DaySummary,
  type Project,
  type TimeEntry,
  type TimeEntryType,
  type TimesheetWeekStatus,
  type WeekProjectReview,
} from "../../services/api";
import {
  addDays,
  dayOfMonth,
  formatHoursShort,
  formatHoursTotal,
  formatWeekRange,
  isWeekend,
  numberish,
  parseHoursInput,
  roundHours,
  startOfWeek,
  todayIso,
  weekDays,
  weekdayLabel,
} from "./timesheetUtils";
import {
  buildProjectRows,
  cellActivities,
  cellHours,
  projectsToCopy,
  type ProjectRow,
} from "./timesheetGrid";
import { EditTimeDialog } from "./EditTimeDialog";
import { cellDefaultTypeId, formatDayUsage, isCellTypable } from "./timesheetDay";
import {
  REVIEW_STATUS_LABELS,
  WEEK_STATE_LABELS,
  deriveWeekState,
  formatMissingDay,
  isProjectEditable,
  returnedMessage,
  returnedReviews,
  submitErrorMessages,
  summarizeSubmission,
} from "./weekStatus";

/**
 * Consumo de la jornada en la cabecera de un día: "7,5/8,4 h", en rojo si se
 * pasa del tope, y una marca si ese día hay horas extra aprobadas.
 */
function DayUsage({ summary }: { summary: DaySummary | undefined }) {
  if (!summary) return null;
  const extra = summary.projects.reduce((sum, p) => sum + p.extraApproved, 0);
  const over = summary.overBy > 0;
  const title = [
    summary.holidayName ?? (summary.isWeekend ? "Fin de semana" : null),
    over ? `Te pasas de la jornada por ${formatDayUsage(summary.overBy, summary.hoursPerDay).split("/")[0]} h` : null,
    extra > 0 ? `Horas extra aprobadas: ${extra} h` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={`ts-day-usage${over ? " over" : ""}`} title={title || undefined}>
      {summary.usedAgainstCap > 0 || over ? formatDayUsage(summary.usedAgainstCap, summary.hoursPerDay) : " "}
      {extra > 0 && (
        <span className="ts-day-extra" aria-label="Con horas extra aprobadas">
          ⧗
        </span>
      )}
    </span>
  );
}

/** Estado de un proyecto en la semana enviada (R15), junto a su nombre. */
function ReviewPill({ review }: { review: WeekProjectReview | undefined }) {
  if (!review) return null;
  const tone = review.status === "APPROVED" ? "ok" : review.status === "RETURNED" ? "error" : "warn";
  return <span className={`pill ts-project-pill ${tone}`}>{REVIEW_STATUS_LABELS[review.status]}</span>;
}

/** Letrero con las actividades de una celda, anclado a la celda bajo el ratón. */
type Tooltip = { key: string; lines: string[]; left: number; top: number };

export function TimesheetTab({
  projects,
  consultants,
  canWrite,
  isAdmin,
  onReload,
  onError,
}: {
  projects: Project[];
  consultants: Consultant[];
  canWrite: boolean;
  isAdmin: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()));

  const [myConsultant, setMyConsultant] = useState<Consultant | null>(null);
  // Hasta que no se resuelve la ficha propia no se sabe si el aviso de "no
  // tienes consultor" aplica, y mostrarlo antes provoca un parpadeo.
  const [consultantResolved, setConsultantResolved] = useState(false);
  const [consultantId, setConsultantId] = useState("");
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);
  // Catálogo de tipos de hora y situación de cada día frente a la jornada (R14).
  const [timeTypes, setTimeTypes] = useState<TimeEntryType[]>([]);
  const [daySummaries, setDaySummaries] = useState<Record<string, DaySummary>>({});
  // Estado de la semana ante el flujo de envío y aprobación (R15).
  const [weekStatus, setWeekStatus] = useState<TimesheetWeekStatus | null>(null);
  const [weekStatusError, setWeekStatusError] = useState<string | null>(null);
  const statusRequest = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);

  // Proyectos que el usuario acaba de añadir y aún no tienen horas.
  const [draftProjects, setDraftProjects] = useState<string[]>([]);
  // Mensaje de lo que acaba de pasar (por ejemplo, la copia); no es un error.
  const [notice, setNotice] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  // Texto que se está editando en cada celda, mientras no se haya guardado.
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});
  // Celda abierta en la ventana "Editar tiempo".
  const [editing, setEditing] = useState<{ projectId: string; day: string } | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  // Fila a punto de vaciarse: el ✕ borra horas, así que pide confirmación.
  const [removeTarget, setRemoveTarget] = useState<ProjectRow | null>(null);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const today = todayIso();

  // Solo ADMIN y PM ven el selector de consultor; el backend ignora el campo
  // para el resto de roles, así que no tiene sentido mostrarlo.
  const canPickConsultant = consultants.length > 0;

  // ── Carga de datos ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = await getMyConsultant();
        if (cancelled) return;
        setMyConsultant(mine);
        setConsultantId((current) => current || mine?.id || "");
      } catch {
        // Sin ficha de consultor la grilla queda en modo solo lectura y se
        // explica en pantalla; no hace falta un banner de error.
      } finally {
        if (!cancelled) setConsultantResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listTimeEntryTypes();
        if (!cancelled) setTimeTypes(list);
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "No se pudo cargar el catálogo de tipos de hora");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Una sola vez: `onError` cambia en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadWeek = useCallback(async () => {
    if (!consultantId) {
      setWeekEntries([]);
      setDaySummaries({});
      setWeekStatus(null);
      return;
    }
    setWeekLoading(true);
    try {
      // Estado de la semana (R15): bloqueo, devoluciones y si se puede enviar.
      // Tampoco tumba la grilla; sin él no se puede enviar y se dice por qué.
      const statusId = ++statusRequest.current;
      void getTimesheetWeekStatus({ weekStart, consultantId })
        .then((s) => {
          if (statusId !== statusRequest.current) return;
          setWeekStatus(s);
          setWeekStatusError(null);
        })
        .catch((err: unknown) => {
          if (statusId !== statusRequest.current) return;
          setWeekStatus(null);
          setWeekStatusError(
            err instanceof Error ? err.message : "No se pudo consultar el estado de la semana",
          );
        });
      // El resumen del día (jornada, tope, saldo de extra) no debe tumbar la
      // grilla: si falla se avisa y las horas se ven igual.
      void getDaySummary({ consultantId, from: weekStart, to: addDays(weekStart, 6) })
        .then((list) => setDaySummaries(Object.fromEntries(list.map((d) => [d.date, d]))))
        .catch((err: unknown) => {
          setDaySummaries({});
          onError(err instanceof Error ? err.message : "No se pudo cargar la jornada de la semana");
        });
      // La rejilla necesita todos los registros de la semana para sumar cada
      // celda y el total por día: se piden todas las páginas del rango.
      const data = await listAllTimeEntries({
        consultantId,
        from: weekStart,
        to: addDays(weekStart, 6),
      });
      setWeekEntries(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron cargar las horas de la semana");
    } finally {
      setWeekLoading(false);
    }
  }, [consultantId, weekStart, onError]);

  useEffect(() => {
    void reloadWeek();
  }, [reloadWeek]);

  // Al cambiar de semana o de consultor, las filas en borrador ya no aplican.
  const weekKeyRef = useRef(`${weekStart}|${consultantId}`);
  useEffect(() => {
    const key = `${weekStart}|${consultantId}`;
    if (weekKeyRef.current !== key) {
      weekKeyRef.current = key;
      setDraftProjects([]);
      setCellDrafts({});
      setTooltip(null);
    }
  }, [weekStart, consultantId]);

  // ── Construcción de la grilla ──────────────────────────────────────────────

  const projectName = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? "Proyecto",
    [projects],
  );

  /** ¿Es el proyecto interno de Ausencias? (solo admite tipos de ausencia) */
  const isAbsence = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.isAbsenceProject === true,
    [projects],
  );

  /** Una fila por proyecto, en orden alfabético. */
  const rows = useMemo<ProjectRow[]>(() => {
    const byProject = buildProjectRows(weekEntries);
    // Los proyectos recién añadidos solo se suman mientras no tengan horas.
    for (const id of draftProjects) {
      if (!byProject.has(id)) byProject.set(id, { projectId: id, cells: {} });
    }
    return Array.from(byProject.values()).sort((a, b) =>
      projectName(a.projectId).localeCompare(projectName(b.projectId)),
    );
  }, [weekEntries, draftProjects, projectName]);

  /** Proyectos que aún se pueden añadir: los que no tienen ya una fila. */
  const availableProjects = useMemo(
    () => projects.filter((p) => !rows.some((r) => r.projectId === p.id)),
    [projects, rows],
  );

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const day of days) totals[day] = 0;
    for (const entry of weekEntries) {
      const day = entry.workDate.slice(0, 10);
      if (day in totals) totals[day] += numberish(entry.hours);
    }
    return totals;
  }, [weekEntries, days]);

  const weekTotal = useMemo(
    () => Object.values(dayTotals).reduce((sum, value) => sum + value, 0),
    [dayTotals],
  );

  function rowTotal(row: ProjectRow) {
    return days.reduce((sum, day) => sum + cellHours(row.cells[day]), 0);
  }

  // ── Edición de celdas ──────────────────────────────────────────────────────

  const cellKey = (projectId: string, day: string) => `${projectId}|${day}`;

  function clearCellDraft(key: string) {
    setCellDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function refreshAll() {
    await reloadWeek();
    // El listado global alimenta la sub-pestaña de aprobaciones y el resto de
    // la aplicación (dashboard, capacidad), así que también se refresca.
    await onReload();
  }

  /**
   * Guarda lo escrito en una celda. Solo se llega aquí con la celda vacía o con
   * un único registro pendiente: con varios, la celda se edita en la ventana.
   */
  async function saveCell(row: ProjectRow, day: string, rawValue: string) {
    const key = cellKey(row.projectId, day);
    const existing = (row.cells[day] ?? [])[0];
    const parsed = parseHoursInput(rawValue);

    if (parsed === null) {
      onError(`"${rawValue}" no es una duración válida. Usa 1:30, 1,5 o 90m.`);
      clearCellDraft(key);
      return;
    }

    const hours = roundHours(parsed);
    if (hours === roundHours(numberish(existing?.hours))) {
      clearCellDraft(key);
      return;
    }

    setSavingCells((prev) => ({ ...prev, [key]: true }));
    try {
      if (hours === 0 && existing) {
        await deleteTimeEntry(existing.id);
      } else if (existing) {
        // Si el registro tenía franja, el fin se mueve con la duración nueva.
        const endedAt = existing.startedAt
          ? new Date(new Date(existing.startedAt).getTime() + Math.round(hours * 3600) * 1000).toISOString()
          : undefined;
        await updateTimeEntry(existing.id, { hours, ...(endedAt ? { endedAt } : {}) });
      } else if (hours > 0) {
        await createTimeEntry({
          projectId: row.projectId,
          consultantId,
          workDate: day,
          hours,
          source: "TIMESHEET",
          // En Ausencias el tipo por defecto es Permiso; en el resto, el servidor usa Regular.
          typeId: cellDefaultTypeId(timeTypes, isAbsence(row.projectId)),
        });
      }
      clearCellDraft(key);
      await refreshAll();
    } catch (err) {
      // El servidor manda el motivo (p. ej. superar la jornada); se muestra tal cual
      // y la celda vuelve a lo que hay guardado.
      clearCellDraft(key);
      onError(err instanceof Error ? err.message : "No se pudo guardar la hora");
    } finally {
      setSavingCells((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  /**
   * Guarda el día de un proyecto con UNA llamada: el servidor reemplaza los
   * registros pendientes en una transacción, así que o queda todo o nada. Si
   * falla, se relanza para que la ventana marque la fila culpable.
   */
  async function handleSaveEdit(entries: DayEntryInput[]) {
    if (!editing) return;
    try {
      await saveDayEntries({
        projectId: editing.projectId,
        consultantId,
        workDate: editing.day,
        entries,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar el tiempo");
      throw err;
    }
    const closed = editing;
    setEditing(null);
    clearCellDraft(cellKey(closed.projectId, closed.day));
    await refreshAll();
  }

  function handleAddProject(projectId: string) {
    if (!projectId) return;
    setDraftProjects((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
  }

  /** Trae los proyectos de la semana anterior como filas vacías para rellenar. */
  async function handleCopyPreviousWeek() {
    if (!consultantId) return;
    setCopying(true);
    setNotice(null);
    try {
      const anterior = await listAllTimeEntries({
        consultantId,
        from: addDays(weekStart, -7),
        to: addDays(weekStart, -1),
      });
      const copiados = projectsToCopy(anterior, new Set(rows.map((r) => r.projectId)));
      if (copiados.length === 0) {
        setNotice(
          anterior.length === 0
            ? "La semana anterior no tiene horas registradas."
            : "Todos los proyectos de la semana anterior ya están en esta.",
        );
        return;
      }
      setDraftProjects((prev) => [...prev, ...copiados.filter((id) => !prev.includes(id))]);
      const n = copiados.length;
      setNotice(`${n} ${n === 1 ? "proyecto copiado" : "proyectos copiados"} de la semana anterior, listos para rellenar.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo copiar la semana anterior");
    } finally {
      setCopying(false);
    }
  }

  async function handleRemoveRow(row: ProjectRow) {
    const allEntries = days.flatMap((day) => row.cells[day] ?? []);
    const removable = allEntries.filter((entry) => entry.status === "PENDING");
    const blocked = allEntries.filter((entry) => entry.status !== "PENDING");

    if (blocked.length > 0) {
      onError("Esta fila tiene horas ya revisadas; solo se borraron las pendientes.");
    }

    try {
      for (const entry of removable) {
        await deleteTimeEntry(entry.id);
      }
      setDraftProjects((prev) => prev.filter((id) => id !== row.projectId));
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar la fila");
    }
  }

  /** Muestra el letrero de actividades sobre la celda. */
  function showTooltip(key: string, entries: TimeEntry[], target: HTMLElement) {
    if (entries.length === 0) return;
    const rect = target.getBoundingClientRect();
    const lines = cellActivities(entries);
    setTooltip({
      key,
      lines: lines.length > 0 ? lines : ["Sin actividades registradas. Usa ⋮ para añadirlas."],
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  }


  /** Envía la semana completa (o, siendo ADMIN, la del consultor elegido). */
  async function handleSubmitWeek() {
    setConfirmSubmit(false);
    setSubmitting(true);
    setSubmitErrors([]);
    setNotice(null);
    try {
      const result = await submitTimesheetWeek({
        weekStart,
        ...(onBehalf ? { consultantId } : {}),
      });
      setNotice(
        onBehalf
          ? `Semana de ${consultantLabel} enviada en su nombre (${formatHoursTotal(result.submittedHours)}).`
          : `Semana enviada (${formatHoursTotal(result.submittedHours)}). Un PM la revisará.`,
      );
      await refreshAll();
    } catch (err) {
      if (err instanceof ApiError) {
        const detalles = submitErrorMessages(err.details);
        setSubmitErrors(detalles.length > 0 ? detalles : [err.message]);
      } else {
        onError(err instanceof Error ? err.message : "No se pudo enviar la semana");
      }
      // El estado pudo cambiar bajo los pies del usuario (otro envío, un PM): se refresca.
      await reloadWeek();
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const noConsultant = consultantResolved && !consultantId && !myConsultant && !canPickConsultant;
  const gridEditable = canWrite && !!consultantId;
  // Estado de la semana (R15). Si lo que hay guardado es de otra semana u otro
  // consultor (cambio en curso), se ignora: mejor "sin dato" que un estado ajeno.
  const status =
    weekStatus && weekStatus.weekStart === weekStart && weekStatus.consultantId === consultantId
      ? weekStatus
      : null;
  // Los registros solo deciden el estado cuando no hay revisiones ni nada por enviar
  // (semanas previas a R15); si el servidor dice que hay proyectos por enviar, es "Pendiente".
  const weekState = deriveWeekState(
    status?.reviews,
    status && !weekLoading && status.submission.projectsToSubmit.length === 0 ? weekEntries : undefined,
  );
  const submission = summarizeSubmission(status);
  const returned = returnedReviews(status?.reviews);
  const weekLocked = !!status?.locked;
  const viewingOther = !!consultantId && consultantId !== myConsultant?.id;
  // Un ADMIN puede enviar la semana de otro; los demás roles solo la propia.
  const onBehalf = isAdmin && viewingOther;
  const canSubmitWeek = canWrite && !!consultantId && (!viewingOther || isAdmin);
  const consultantLabel = consultants.find((c) => c.id === consultantId)?.fullName ?? "el consultor";
  const nothingToSubmit = !!status && status.submission.projectsToSubmit.length === 0 && !submission.canSubmit;
  const submitDisabled = !status || !submission.canSubmit || submitting || weekLoading;
  const reviewOf = (projectId: string) => status?.reviews.find((r) => r.projectId === projectId);
  /** Celdas, ⋮ y quitar fila: solo en proyectos no enviados (o devueltos). */
  const projectEditable = (projectId: string) => gridEditable && isProjectEditable(status, projectId);
  const dayClass = (index: number, day: string) =>
    `ts-col-day${isWeekend(index) ? " weekend" : ""}${day === today ? " today" : ""}`;
  const editingRow = editing ? rows.find((r) => r.projectId === editing.projectId) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="▥"
        title="Timesheet"
        description="Carga tus horas de la semana: una fila por proyecto, una columna por día. Con ⋮ anotas qué actividades hiciste."
      />

        <article className="card ts-card">
          {returned.length > 0 && (
            <div className="notice notice--danger ts-returned" role="alert">
              <p className="notice__title">Semana devuelta para corrección</p>
              <ul className="notice__list">
                {returned.map((r) => (
                  <li key={r.projectId}>{returnedMessage(r)}</li>
                ))}
              </ul>
              <p className="notice__text">
                Corrige las horas de {returned.length === 1 ? "ese proyecto" : "esos proyectos"} y vuelve a enviar la semana.
              </p>
            </div>
          )}

          <div className="ts-toolbar">
            <div className="ts-weeknav">
              <button
                type="button"
                className="ghost"
                onClick={() => setWeekStart((w) => addDays(w, -7))}
                aria-label="Semana anterior"
              >
                ←
              </button>
              <div className="ts-weeklabel">
                <strong>{formatWeekRange(weekStart)}</strong>
                {weekStart === startOfWeek(today) && <span className="ts-chip">Esta semana</span>}
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setWeekStart((w) => addDays(w, 7))}
                aria-label="Semana siguiente"
              >
                →
              </button>
              <button type="button" className="ghost" onClick={() => setWeekStart(startOfWeek(today))}>
                Hoy
              </button>
            </div>

            <div className="ts-toolbar-right">
              {canPickConsultant && (
                <select
                  value={consultantId}
                  onChange={(e) => setConsultantId(e.target.value)}
                  aria-label="Consultor"
                >
                  <option value="">Selecciona un consultor</option>
                  {consultants.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              )}
              {gridEditable && !weekLocked && (
                <button
                  type="button"
                  className="ghost ts-expand-all"
                  onClick={() => void handleCopyPreviousWeek()}
                  disabled={copying}
                  title="Trae los proyectos de la semana pasada como filas vacías"
                >
                  {copying ? "Copiando…" : "Copiar semana anterior"}
                </button>
              )}
              <div className="ts-weektotal">
                <span>Total semana</span>
                <strong>{formatHoursTotal(weekTotal)}</strong>
              </div>
            </div>
          </div>

          {consultantId && (
            <div className="ts-statusbar" data-state={weekState} aria-label="Estado de la semana">
              <div className="ts-statusbar-main">
                <span className={`ts-statepill ts-statepill--${weekState.toLowerCase()}`}>
                  {status ? WEEK_STATE_LABELS[weekState] : "Estado sin cargar"}
                </span>
                {status && status.reviews.length > 0 && (
                  <ul className="ts-statusbar-projects">
                    {status.reviews.map((r) => (
                      <li key={r.projectId}>
                        {r.projectName}: <strong>{REVIEW_STATUS_LABELS[r.status]}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                {weekStatusError && (
                  <span className="ts-statusbar-error" role="alert">
                    {weekStatusError}{" "}
                    <button type="button" className="ghost" onClick={() => void reloadWeek()}>
                      Reintentar
                    </button>
                  </span>
                )}
              </div>

              {canSubmitWeek && (
                <div className="ts-statusbar-submit">
                  <button
                    type="button"
                    onClick={() => setConfirmSubmit(true)}
                    disabled={submitDisabled}
                    aria-describedby="ts-submit-help"
                  >
                    {submitting ? "Enviando…" : onBehalf ? `Enviar en nombre de ${consultantLabel}` : "Enviar semana"}
                  </button>
                </div>
              )}

              {status && !submission.canSubmit && canSubmitWeek && (
                <div id="ts-submit-help" className="ts-submit-help">
                  {nothingToSubmit && submission.missingDays.length === 0 && submission.otherMessages.length === 0 ? (
                    <p>
                      {weekState === "EMPTY"
                        ? "Esta semana no tiene registros: no hay nada que enviar."
                        : weekState === "APPROVED"
                          ? "Esta semana ya está aprobada: no hay nada que enviar."
                          : "No hay nada pendiente de enviar en esta semana."}
                    </p>
                  ) : (
                    <>
                      {submission.inProgress && <p>Semana en curso: aún faltan días por completar.</p>}
                      {submission.missingDays.length > 0 && (
                        <>
                          <p>Para enviar, completa la jornada de estos días:</p>
                          <ul>
                            {submission.missingDays.map((d) => (
                              <li key={d.date}>{formatMissingDay(d)}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {submission.otherMessages.length > 0 && (
                        <ul>
                          {submission.otherMessages.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}

              {submitErrors.length > 0 && (
                <div className="notice notice--danger ts-submit-errors" role="alert">
                  <p className="notice__title">No se pudo enviar la semana</p>
                  <ul className="notice__list">
                    {submitErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {noConsultant && (
            <p className="ts-empty-note">
              Tu usuario no está vinculado a ninguna ficha de consultor, así que todavía no puedes
              cargar horas. Pide a un administrador que cree tu consultor con este mismo correo.
            </p>
          )}

          {weekLoading && rows.length === 0 ? (
            <p className="loading">Cargando semana…</p>
          ) : (
            <div className="table-wrap" onScroll={() => setTooltip(null)}>
              <table className="ts-grid">
                <thead>
                  <tr>
                    <th className="ts-col-project">Proyectos</th>
                    {days.map((day, index) => (
                      <th key={day} className={dayClass(index, day)}>
                        <span className="ts-day-name">{weekdayLabel(index)}</span>
                        <span className="ts-day-num">{dayOfMonth(day)}</span>
                        <DayUsage summary={daySummaries[day]} />
                      </th>
                    ))}
                    <th className="ts-col-total">Total</th>
                    {gridEditable && <th className="ts-col-actions" aria-label="Acciones" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && !gridEditable && (
                    <tr>
                      <td colSpan={days.length + 2} className="ts-empty">
                        No hay horas cargadas esta semana.
                      </td>
                    </tr>
                  )}

                  {rows.map((row) => (
                    <tr key={row.projectId} className="ts-project-row">
                      <td className="ts-col-project">
                        <span className="ts-project-dot" aria-hidden="true" />
                        <span className="ts-project-name" title={projectName(row.projectId)}>
                          {projectName(row.projectId)}
                        </span>
                        <ReviewPill review={reviewOf(row.projectId)} />
                      </td>

                      {days.map((day, index) => {
                        const entries = row.cells[day] ?? [];
                        const key = cellKey(row.projectId, day);
                        const hours = cellHours(entries);
                        const single = entries.length === 1 ? entries[0] : undefined;
                        // Con varios registros no hay forma de repartir un número
                        // nuevo entre ellos: se editan uno a uno en la ventana.
                        const varios = entries.length > 1;
                        const absenceProject = isAbsence(row.projectId);
                        const typable = projectEditable(row.projectId) && isCellTypable(entries, absenceProject);
                        const draft = cellDrafts[key];
                        const value = draft !== undefined ? draft : formatHoursShort(hours);
                        const withDots = entries.length > 0;

                        return (
                          <td key={day} className={dayClass(index, day)}>
                            <div
                              className={`ts-cellwrap${withDots ? " has-dots" : ""}`}
                              onMouseEnter={(e) => showTooltip(key, entries, e.currentTarget)}
                              onMouseLeave={() => setTooltip((t) => (t?.key === key ? null : t))}
                            >
                              {typable ? (
                                <input
                                  className={`ts-cell${savingCells[key] ? " saving" : ""}`}
                                  inputMode="decimal"
                                  placeholder=""
                                  value={value}
                                  disabled={savingCells[key]}
                                  onChange={(e) =>
                                    setCellDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                                  }
                                  onBlur={(e) => void saveCell(row, day, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                    if (e.key === "Escape") {
                                      clearCellDraft(key);
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  aria-label={`Horas de ${projectName(row.projectId)} el ${day}`}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className={`ts-cell ts-cell-locked${single ? ` status-${single.status.toLowerCase()}` : ""}`}
                                  onClick={() => entries.length > 0 && setEditing({ projectId: row.projectId, day })}
                                  disabled={entries.length === 0}
                                  aria-label={
                                    varios
                                      ? `${entries.length} registros, ${formatHoursTotal(hours)}. Abrir para editar`
                                      : `Horas del ${day}`
                                  }
                                >
                                  {formatHoursShort(hours)}
                                </button>
                              )}
                              {withDots && (
                                <button
                                  type="button"
                                  className="ts-cell-dots"
                                  onClick={() => {
                                    setTooltip(null);
                                    setEditing({ projectId: row.projectId, day });
                                  }}
                                  aria-label="Editar tiempo y actividades"
                                  title="Editar tiempo y actividades"
                                >
                                  ⋮
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      <td className="ts-col-total">{formatHoursTotal(rowTotal(row))}</td>
                      {gridEditable && (
                        <td className="ts-col-actions">
                          {projectEditable(row.projectId) && (
                            <button
                              type="button"
                              className="ghost ts-rowdel"
                              onClick={() =>
                                rowTotal(row) > 0
                                  ? setRemoveTarget(row)
                                  : setDraftProjects((prev) => prev.filter((id) => id !== row.projectId))
                              }
                              aria-label="Quitar fila"
                              title="Quitar el proyecto y sus horas pendientes de esta semana"
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}

                  {/* Fila para añadir un proyecto, como la última de Clockify. */}
                  {gridEditable && !weekLocked && (
                    <tr className="ts-project-row ts-addrow-row">
                      <td className="ts-col-project">
                        <label className="ts-addproject">
                          <span className="ts-addproject-icon" aria-hidden="true">⊕</span>
                          <select
                            value=""
                            onChange={(e) => handleAddProject(e.target.value)}
                            aria-label="Seleccionar proyecto"
                            disabled={availableProjects.length === 0}
                          >
                            <option value="">
                              {availableProjects.length === 0 ? "No hay más proyectos" : "Seleccionar proyecto"}
                            </option>
                            {availableProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                      {days.map((day, index) => (
                        <td key={day} className={dayClass(index, day)}>
                          <div className="ts-cellwrap">
                            <input className="ts-cell" disabled aria-hidden="true" tabIndex={-1} />
                          </div>
                        </td>
                      ))}
                      <td className="ts-col-total ts-muted">{formatHoursTotal(0)}</td>
                      <td className="ts-col-actions" />
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total:</td>
                    {days.map((day, index) => (
                      <td key={day} className={dayClass(index, day)}>
                        {formatHoursTotal(dayTotals[day] ?? 0)}
                      </td>
                    ))}
                    <td className="ts-col-total">{formatHoursTotal(weekTotal)}</td>
                    {gridEditable && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Al body: dentro de la tarjeta, un ancestro con `transform` hace
              que `position: fixed` se mida desde él y el letrero sale desplazado. */}
          {tooltip &&
            createPortal(
              <div
                className="ts-tooltip"
                role="tooltip"
                style={{ left: tooltip.left, top: tooltip.top }}
              >
                {tooltip.lines.length === 1 ? (
                  <span>{tooltip.lines[0]}</span>
                ) : (
                  <ul>
                    {tooltip.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>,
              document.body,
            )}

          {notice && (
            <p className="ts-notice" role="status">
              <span>{notice}</span>
              <button type="button" className="ghost" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
                ✕
              </button>
            </p>
          )}

          {editing && (
            <EditTimeDialog
              key={`${editing.projectId}|${editing.day}`}
              day={editing.day}
              projectName={projectName(editing.projectId)}
              projectId={editing.projectId}
              isAbsenceProject={isAbsence(editing.projectId)}
              entries={editingRow?.cells[editing.day] ?? []}
              types={timeTypes}
              summary={daySummaries[editing.day]}
              readOnly={!projectEditable(editing.projectId)}
              readOnlyReason={weekLocked ? "Esta semana ya fue enviada: no se puede modificar hasta que un PM la devuelva." : undefined}
              esPropio={!!myConsultant && consultantId === myConsultant.id}
              onSave={handleSaveEdit}
              onClose={() => setEditing(null)}
            />
          )}

          <ConfirmDialog
            open={confirmSubmit}
            title={onBehalf ? `Enviar la semana de ${consultantLabel}` : "Enviar semana"}
            confirmLabel="Enviar"
            onCancel={() => setConfirmSubmit(false)}
            onConfirm={() => void handleSubmitWeek()}
            message={
              <p>
                {onBehalf
                  ? `Se enviará la semana de ${consultantLabel} en su nombre. `
                  : ""}
                Al enviar no podrás modificar la semana hasta que un PM la devuelva.
              </p>
            }
          />

          <ConfirmDialog
            open={!!removeTarget}
            title="Quitar proyecto de la semana"
            danger
            confirmLabel="Quitar"
            onCancel={() => setRemoveTarget(null)}
            onConfirm={() => {
              const row = removeTarget;
              setRemoveTarget(null);
              if (row) void handleRemoveRow(row);
            }}
            message={
              removeTarget && (
                <p>
                  Se borrarán las horas pendientes de <strong>{projectName(removeTarget.projectId)}</strong>{" "}
                  de esta semana ({formatHoursTotal(rowTotal(removeTarget))}). Las ya aprobadas o
                  rechazadas no se tocan.
                </p>
              )
            }
          />

          <p className="ts-hint">
            Escribe las horas como <code>1:30</code>, <code>1,5</code> o <code>90m</code>: se guardan
            solas al salir de la celda. Con <strong>⋮</strong> anotas las actividades y la hora de
            inicio y fin; al pasar el ratón por una celda las ves.
          </p>
        </article>
    </div>
  );
}
