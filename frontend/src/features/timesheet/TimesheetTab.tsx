import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import { SectionLayout } from "../../components/SectionLayout";
import { TIME_ENTRY_STATUS_LABELS, label } from "../../utils/statusLabels";
import { formatDate } from "../../utils/formatDate";
import { downloadCsv } from "../../utils/csv";
import {
  approveTimeEntry,
  createTimeEntry,
  deleteTimeEntry,
  getMyConsultant,
  listActivities,
  listTimeEntries,
  rejectTimeEntry,
  updateTimeEntry,
  type Activity,
  type Consultant,
  type Project,
  type TimeEntry,
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

/**
 * Una fila de la grilla agrupa todas las horas de la semana que comparten
 * proyecto, actividad y descripción. La clave se construye con esos tres
 * campos para que escribir la misma tarea dos días seguidos caiga en la misma
 * fila, igual que en Clockify.
 */
type TimesheetRow = {
  key: string;
  projectId: string;
  activityId: string | null;
  description: string;
  /**
   * Entradas de horas por día ISO. Normalmente hay una sola, pero el tracker
   * puede generar varias el mismo día sobre la misma tarea (una por cada vez
   * que se arranca y se detiene el cronómetro). En ese caso la celda muestra
   * la suma y se bloquea, porque no habría forma de repartir un valor nuevo
   * entre los registros originales sin inventarse el criterio.
   */
  cells: Record<string, TimeEntry[] | undefined>;
};

function rowKeyOf(projectId: string, activityId: string | null, description: string) {
  return `${projectId}::${activityId ?? ""}::${description.trim().toLowerCase()}`;
}

const emptyDraft = { projectId: "", activityId: "", description: "" };

export function TimesheetTab({
  timeEntries,
  projects,
  consultants,
  loading,
  canWrite,
  canReview,
  reviewerName,
  onReload,
  onError,
}: {
  timeEntries: TimeEntry[];
  projects: Project[];
  consultants: Consultant[];
  loading: boolean;
  canWrite: boolean;
  canReview: boolean;
  reviewerName: string;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [view, setView] = useState<"week" | "approvals">("week");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()));

  const [myConsultant, setMyConsultant] = useState<Consultant | null>(null);
  // Hasta que no se resuelve la ficha propia no se sabe si el aviso de "no
  // tienes consultor" aplica, y mostrarlo antes provoca un parpadeo.
  const [consultantResolved, setConsultantResolved] = useState(false);
  const [consultantId, setConsultantId] = useState("");
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);

  // Filas que el usuario acaba de crear y aún no tienen ninguna hora cargada.
  const [draftRows, setDraftRows] = useState<TimesheetRow[]>([]);
  const [newRow, setNewRow] = useState(emptyDraft);
  // Texto que se está editando en cada celda, mientras no se haya guardado.
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});

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

  const reloadWeek = useCallback(async () => {
    if (!consultantId) {
      setWeekEntries([]);
      return;
    }
    setWeekLoading(true);
    try {
      const data = await listTimeEntries({
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

  useEffect(() => {
    if (!consultantId) {
      setActivities([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await listActivities({ consultantId });
        if (!cancelled) setActivities(data);
      } catch {
        // Las actividades son opcionales: si fallan, el selector queda vacío
        // y se puede seguir usando solo la descripción libre.
        if (!cancelled) setActivities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [consultantId]);

  // Al cambiar de semana o de consultor, las filas en borrador ya no aplican.
  const weekKeyRef = useRef(`${weekStart}|${consultantId}`);
  useEffect(() => {
    const key = `${weekStart}|${consultantId}`;
    if (weekKeyRef.current !== key) {
      weekKeyRef.current = key;
      setDraftRows([]);
      setCellDrafts({});
    }
  }, [weekStart, consultantId]);

  // ── Construcción de la grilla ──────────────────────────────────────────────

  const rows = useMemo<TimesheetRow[]>(() => {
    const byKey = new Map<string, TimesheetRow>();

    for (const entry of weekEntries) {
      const description = entry.description ?? "";
      const key = rowKeyOf(entry.projectId, entry.activityId, description);
      let row = byKey.get(key);
      if (!row) {
        row = {
          key,
          projectId: entry.projectId,
          activityId: entry.activityId,
          description,
          cells: {},
        };
        byKey.set(key, row);
      }
      const day = entry.workDate.slice(0, 10);
      row.cells[day] = [...(row.cells[day] ?? []), entry];
    }

    // Las filas en borrador solo sobreviven mientras no existan ya con horas.
    for (const draft of draftRows) {
      if (!byKey.has(draft.key)) byKey.set(draft.key, draft);
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const projectA = projects.find((p) => p.id === a.projectId)?.name ?? "";
      const projectB = projects.find((p) => p.id === b.projectId)?.name ?? "";
      return projectA.localeCompare(projectB) || a.description.localeCompare(b.description);
    });
  }, [weekEntries, draftRows, projects]);

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

  /** Suma de las horas de una celda; 0 si está vacía. */
  function cellHours(row: TimesheetRow, day: string) {
    return (row.cells[day] ?? []).reduce((sum, entry) => sum + numberish(entry.hours), 0);
  }

  function rowTotal(row: TimesheetRow) {
    return days.reduce((sum, day) => sum + cellHours(row, day), 0);
  }

  // ── Edición de celdas ──────────────────────────────────────────────────────

  const cellKey = (rowKey: string, day: string) => `${rowKey}|${day}`;

  async function saveCell(row: TimesheetRow, day: string, rawValue: string) {
    const key = cellKey(row.key, day);
    const entriesInCell = row.cells[day] ?? [];
    const existing = entriesInCell.length === 1 ? entriesInCell[0] : undefined;
    const parsed = parseHoursInput(rawValue);

    if (parsed === null) {
      onError(`"${rawValue}" no es una duración válida. Usa 1:30, 1,5 o 90m.`);
      setCellDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const hours = roundHours(parsed);
    const previous = roundHours(numberish(existing?.hours));
    if (hours === previous) {
      setCellDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    setSavingCells((prev) => ({ ...prev, [key]: true }));
    try {
      if (hours === 0 && existing) {
        await deleteTimeEntry(existing.id);
      } else if (existing) {
        await updateTimeEntry(existing.id, { hours });
      } else if (hours > 0) {
        await createTimeEntry({
          projectId: row.projectId,
          consultantId,
          workDate: day,
          hours,
          description: row.description || null,
          activityId: row.activityId,
          source: "TIMESHEET",
        });
      }

      setCellDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await reloadWeek();
      // El listado global alimenta la sub-pestaña de aprobaciones y el resto
      // de la aplicación (dashboard, capacidad), así que también se refresca.
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar la hora");
    } finally {
      setSavingCells((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function handleAddRow(event: FormEvent) {
    event.preventDefault();
    if (!newRow.projectId) {
      onError("Elige un proyecto para la nueva fila");
      return;
    }

    const activityId = newRow.activityId || null;
    const description = newRow.description.trim();
    const key = rowKeyOf(newRow.projectId, activityId, description);

    if (rows.some((row) => row.key === key)) {
      onError("Ya existe una fila con ese proyecto y esa tarea");
      return;
    }

    setDraftRows((prev) => [
      ...prev,
      { key, projectId: newRow.projectId, activityId, description, cells: {} },
    ]);
    setNewRow(emptyDraft);
  }

  async function handleRemoveRow(row: TimesheetRow) {
    const allEntries = days.flatMap((day) => row.cells[day] ?? []);
    const removable = allEntries.filter((entry) => entry.status === "PENDING");
    const blocked = allEntries.filter((entry) => entry.status !== "PENDING");

    if (blocked.length > 0) {
      onError("Esta fila tiene horas ya revisadas; solo se pueden borrar las pendientes.");
    }

    try {
      for (const entry of removable) {
        await deleteTimeEntry(entry.id);
      }
      setDraftRows((prev) => prev.filter((draft) => draft.key !== row.key));
      await reloadWeek();
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar la fila");
    }
  }

  // ── Aprobaciones ───────────────────────────────────────────────────────────

  async function handleReview(id: string, action: "approve" | "reject") {
    try {
      if (action === "approve") {
        await approveTimeEntry(id, reviewerName);
      } else {
        await rejectTimeEntry(id, reviewerName, "No cumple criterio");
      }
      await onReload();
      await reloadWeek();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo actualizar estado");
    }
  }

  function handleExport() {
    downloadCsv(
      timeEntries.map((e) => ({
        proyecto: e.project.name,
        consultor: e.consultant.fullName,
        fecha: e.workDate.slice(0, 10),
        horas: numberish(e.hours).toFixed(2),
        tarea: e.activity?.title ?? "",
        descripcion: e.description ?? "",
        estado: e.status,
        origen: e.source,
        nota: e.note ?? "",
        aprobadoPor: e.approvedBy ?? "",
      })),
      [
        { key: "proyecto", label: "Proyecto" },
        { key: "consultor", label: "Consultor" },
        { key: "fecha", label: "Fecha" },
        { key: "horas", label: "Horas" },
        { key: "tarea", label: "Tarea" },
        { key: "descripcion", label: "Descripción" },
        { key: "estado", label: "Estado" },
        { key: "origen", label: "Origen" },
        { key: "nota", label: "Nota" },
        { key: "aprobadoPor", label: "Aprobado Por" },
      ],
      "horas",
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const noConsultant = consultantResolved && !consultantId && !myConsultant && !canPickConsultant;
  const gridEditable = canWrite && !!consultantId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="▥"
        title="Timesheet"
        description="Carga tus horas de la semana en una grilla: una fila por proyecto y tarea, una columna por día."
      />

      <div className="ts-viewswitch" role="tablist" aria-label="Vistas del timesheet">
        <button
          type="button"
          role="tab"
          aria-selected={view === "week"}
          className={view === "week" ? "active" : ""}
          onClick={() => setView("week")}
        >
          Semana
        </button>
        {canReview && (
          <button
            type="button"
            role="tab"
            aria-selected={view === "approvals"}
            className={view === "approvals" ? "active" : ""}
            onClick={() => setView("approvals")}
          >
            Aprobaciones
          </button>
        )}
      </div>

      {view === "week" && (
        <article className="card ts-card">
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
              <div className="ts-weektotal">
                <span>Total semana</span>
                <strong>{formatHoursTotal(weekTotal)}</strong>
              </div>
            </div>
          </div>

          {noConsultant && (
            <p className="ts-empty-note">
              Tu usuario no está vinculado a ninguna ficha de consultor, así que todavía no puedes
              cargar horas. Pide a un administrador que cree tu consultor con este mismo correo.
            </p>
          )}

          {weekLoading ? (
            <p className="loading">Cargando semana…</p>
          ) : (
            <div className="table-wrap">
              <table className="ts-grid">
                <thead>
                  <tr>
                    <th className="ts-col-project">Proyecto</th>
                    <th className="ts-col-task">Tarea / Descripción</th>
                    {days.map((day, index) => (
                      <th
                        key={day}
                        className={`ts-col-day${isWeekend(index) ? " weekend" : ""}${day === today ? " today" : ""}`}
                      >
                        <span className="ts-day-name">{weekdayLabel(index)}</span>
                        <span className="ts-day-num">{dayOfMonth(day)}</span>
                      </th>
                    ))}
                    <th className="ts-col-total">Total</th>
                    {gridEditable && <th className="ts-col-actions" aria-label="Acciones" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={days.length + (gridEditable ? 4 : 3)} className="ts-empty">
                        No hay horas cargadas esta semana. Agrega una fila abajo para empezar.
                      </td>
                    </tr>
                  )}

                  {rows.map((row) => {
                    const project = projects.find((p) => p.id === row.projectId);
                    const activity = activities.find((a) => a.id === row.activityId);
                    return (
                      <tr key={row.key}>
                        <td className="ts-col-project" title={project?.name}>
                          {project?.name ?? "—"}
                        </td>
                        <td className="ts-col-task">
                          {activity && <span className="ts-task-pill">{activity.title}</span>}
                          <span className="ts-task-desc" title={row.description}>
                            {row.description || (activity ? "" : "Sin descripción")}
                          </span>
                        </td>

                        {days.map((day, index) => {
                          const entriesInCell = row.cells[day] ?? [];
                          const key = cellKey(row.key, day);
                          const hours = cellHours(row, day);
                          const single = entriesInCell.length === 1 ? entriesInCell[0] : undefined;
                          // Bloqueada si ya fue revisada, o si agrupa varios
                          // registros del tracker que no se pueden reescribir
                          // con un solo número.
                          const locked =
                            entriesInCell.length > 1 ||
                            (!!single && single.status !== "PENDING");
                          const draft = cellDrafts[key];
                          const value = draft !== undefined ? draft : formatHoursShort(hours);

                          const lockedTitle =
                            entriesInCell.length > 1
                              ? `${entriesInCell.length} registros ese día suman ${formatHoursTotal(hours)}. Edítalos uno a uno desde el Tracker.`
                              : single
                                ? `${label(TIME_ENTRY_STATUS_LABELS, single.status)} — ya no se puede editar`
                                : undefined;

                          return (
                            <td
                              key={day}
                              className={`ts-col-day${isWeekend(index) ? " weekend" : ""}${day === today ? " today" : ""}`}
                            >
                              {gridEditable && !locked ? (
                                <input
                                  className={`ts-cell${savingCells[key] ? " saving" : ""}`}
                                  inputMode="decimal"
                                  placeholder="0:00"
                                  value={value}
                                  disabled={savingCells[key]}
                                  onChange={(e) =>
                                    setCellDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                                  }
                                  onBlur={(e) => void saveCell(row, day, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                    if (e.key === "Escape") {
                                      setCellDrafts((prev) => {
                                        const next = { ...prev };
                                        delete next[key];
                                        return next;
                                      });
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  aria-label={`Horas del ${day}`}
                                />
                              ) : (
                                <span
                                  className={`ts-cell-locked${single ? ` status-${single.status.toLowerCase()}` : ""}`}
                                  title={lockedTitle}
                                >
                                  {formatHoursShort(hours) || "—"}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        <td className="ts-col-total">{formatHoursTotal(rowTotal(row))}</td>
                        {gridEditable && (
                          <td className="ts-col-actions">
                            <button
                              type="button"
                              className="ghost ts-rowdel"
                              onClick={() => void handleRemoveRow(row)}
                              aria-label="Eliminar fila"
                              title="Eliminar las horas pendientes de esta fila"
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total por día</td>
                    {days.map((day, index) => (
                      <td
                        key={day}
                        className={`ts-col-day${isWeekend(index) ? " weekend" : ""}${day === today ? " today" : ""}`}
                      >
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

          {gridEditable && (
            <form className="ts-addrow" onSubmit={handleAddRow}>
              <select
                value={newRow.projectId}
                onChange={(e) => setNewRow((p) => ({ ...p, projectId: e.target.value }))}
                aria-label="Proyecto de la nueva fila"
              >
                <option value="">Proyecto…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={newRow.activityId}
                onChange={(e) => setNewRow((p) => ({ ...p, activityId: e.target.value }))}
                aria-label="Actividad de la nueva fila"
              >
                <option value="">Sin tarea asignada</option>
                {activities
                  .filter((a) => !newRow.projectId || !a.projectId || a.projectId === newRow.projectId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
              </select>
              <input
                type="text"
                placeholder="¿En qué trabajaste?"
                value={newRow.description}
                onChange={(e) => setNewRow((p) => ({ ...p, description: e.target.value }))}
                aria-label="Descripción de la nueva fila"
              />
              <button type="submit">+ Agregar fila</button>
            </form>
          )}

          <p className="ts-hint">
            Escribe las horas como <code>1:30</code>, <code>1,5</code> o <code>90m</code>. Se guardan
            solas al salir de la celda y quedan pendientes de aprobación.
          </p>
        </article>
      )}

      {view === "approvals" && (
        <SectionLayout
          title="Flujo de aprobación"
          canWrite={false}
          onExport={handleExport}
          exportDisabled={timeEntries.length === 0}
          table={
            loading ? (
              <p className="loading">Cargando...</p>
            ) : (
              <div className="table-wrap">
                <table className="approval-table">
                  <thead>
                    <tr>
                      <th>Proyecto</th>
                      <th>Consultor</th>
                      <th>Fecha</th>
                      <th>Tarea</th>
                      <th>Horas</th>
                      <th>Estado</th>
                      {canReview && <th>Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {timeEntries.map((entry) => {
                      const rowClass =
                        entry.status === "APPROVED"
                          ? "row-approved"
                          : entry.status === "REJECTED"
                            ? "row-rejected"
                            : "row-pending";
                      const task = entry.activity?.title ?? entry.description ?? "—";
                      return (
                        <tr key={entry.id} className={rowClass}>
                          <td title={entry.project.name}>{entry.project.name}</td>
                          <td title={entry.consultant.fullName}>{entry.consultant.fullName}</td>
                          <td>{formatDate(entry.workDate)}</td>
                          <td title={task}>{task}</td>
                          <td>{numberish(entry.hours).toFixed(2)}</td>
                          <td>
                            <span
                              className={`pill ${entry.status === "APPROVED" ? "ok" : entry.status === "REJECTED" ? "error" : "warn"}`}
                            >
                              {label(TIME_ENTRY_STATUS_LABELS, entry.status)}
                            </span>
                          </td>
                          {canReview && (
                            <td>
                              {entry.status === "PENDING" && (
                                <div className="inline-actions">
                                  <button
                                    type="button"
                                    onClick={() => void handleReview(entry.id, "approve")}
                                  >
                                    Aprobar
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => void handleReview(entry.id, "reject")}
                                  >
                                    Rechazar
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        />
      )}
    </div>
  );
}
