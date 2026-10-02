import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SectionLayout } from "../../components/SectionLayout";
import { TIME_ENTRY_STATUS_LABELS, label } from "../../utils/statusLabels";
import { formatDate } from "../../utils/formatDate";
import { downloadCsv } from "../../utils/csv";
import {
  approveTimeEntry,
  createTimeEntry,
  deleteTimeEntry,
  getMyConsultant,
  listAllTimeEntries,
  listTimeEntries,
  rejectTimeEntry,
  updateTimeEntry,
  type Consultant,
  type PageMeta,
  type Project,
  type TimeEntry,
  type TimeEntryStatus,
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
import { EditTimeDialog, type EditTimeChanges } from "./EditTimeDialog";

/** Letrero con las actividades de una celda, anclado a la celda bajo el ratón. */
type Tooltip = { key: string; lines: string[]; left: number; top: number };

export function TimesheetTab({
  projects,
  consultants,
  canWrite,
  canReview,
  onReload,
  onError,
}: {
  projects: Project[];
  consultants: Consultant[];
  canWrite: boolean;
  canReview: boolean;
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
  const [weekLoading, setWeekLoading] = useState(false);

  // -- Vista de aprobaciones -------------------------------------------------
  // Antes esta tabla pintaba el histórico completo que `App.tsx` cargaba de una
  // vez. Ahora pide una página al servidor y el paginador muestra el total, de
  // modo que nunca se enseñe un subconjunto sin decirlo.
  const [approvalEntries, setApprovalEntries] = useState<TimeEntry[]>([]);
  const [approvalMeta, setApprovalMeta] = useState<PageMeta>({
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  });
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<TimeEntryStatus | "">("");
  const [exporting, setExporting] = useState(false);

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
  const [savingEdit, setSavingEdit] = useState(false);
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

  const reloadWeek = useCallback(async () => {
    if (!consultantId) {
      setWeekEntries([]);
      return;
    }
    setWeekLoading(true);
    try {
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
        });
      }
      clearCellDraft(key);
      await refreshAll();
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

  /** Aplica lo que se guardó en la ventana "Editar tiempo". */
  async function handleSaveEdit(changes: EditTimeChanges) {
    if (!editing) return;
    setSavingEdit(true);
    try {
      for (const id of changes.remove) await deleteTimeEntry(id);
      for (const u of changes.update) {
        await updateTimeEntry(u.id, {
          hours: u.hours,
          description: u.description,
          startedAt: u.startedAt,
          endedAt: u.endedAt,
        });
      }
      for (const c of changes.create) {
        await createTimeEntry({
          projectId: editing.projectId,
          consultantId,
          workDate: editing.day,
          hours: c.hours,
          description: c.description,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          source: "TIMESHEET",
        });
      }
      setEditing(null);
      clearCellDraft(cellKey(editing.projectId, editing.day));
      await refreshAll();
    } catch (err) {
      // La ventana sigue abierta para que no se pierda lo escrito. Lo que ya se
      // guardó antes del fallo se ve al recargar.
      onError(err instanceof Error ? err.message : "No se pudo guardar el tiempo");
      await reloadWeek();
    } finally {
      setSavingEdit(false);
    }
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

  // ── Aprobaciones ───────────────────────────────────────────────────────────

  const loadApprovals = useCallback(
    async (page: number) => {
      setApprovalLoading(true);
      try {
        const result = await listTimeEntries({
          page,
          ...(approvalStatus ? { status: approvalStatus } : {}),
        });
        setApprovalEntries(result.data);
        setApprovalMeta(result.meta);
      } catch (err) {
        setApprovalEntries([]);
        onError(err instanceof Error ? err.message : "No se pudieron cargar las aprobaciones");
      } finally {
        setApprovalLoading(false);
      }
    },
    [approvalStatus, onError],
  );

  // Al entrar en la vista, y cada vez que cambia el filtro, se vuelve SIEMPRE a
  // la página 1: conservar la página actual dejaría al usuario en una que quizá
  // ya no existe con el filtro nuevo, y vería una tabla vacía sin motivo.
  //
  // Ojo con las dependencias: NO puede depender de la identidad de
  // `loadApprovals`. `onError` llega del padre como función declarada, así que
  // cambia en cada render; el efecto se volvía a disparar y devolvía la tabla a
  // la página 1 justo después de que el usuario pulsara "siguiente", dejando el
  // paginador clavado en la primera página. Depende solo de lo que de verdad
  // debe reiniciar la paginación, y llama al cargador por referencia.
  const loadApprovalsRef = useRef(loadApprovals);
  useEffect(() => {
    loadApprovalsRef.current = loadApprovals;
  }, [loadApprovals]);

  useEffect(() => {
    if (view !== "approvals") return;
    void loadApprovalsRef.current(1);
  }, [view, approvalStatus]);

  async function handleReview(id: string, action: "approve" | "reject") {
    try {
      // La identidad del revisor la toma el backend del token: el cliente no
      // la envía ni podría falsificarla.
      if (action === "approve") {
        await approveTimeEntry(id);
      } else {
        await rejectTimeEntry(id, "No cumple criterio");
      }
      await onReload();
      await reloadWeek();
      await loadApprovals(approvalMeta.page);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo actualizar estado");
    }
  }

  /**
   * El CSV exporta **todas** las horas del filtro actual, no solo la página que
   * se está viendo: un informe recortado en silencio a 50 filas sería justo el
   * defecto que la paginación no puede introducir.
   */
  async function handleExport() {
    setExporting(true);
    try {
      const todas = await listAllTimeEntries(
        approvalStatus ? { status: approvalStatus } : undefined,
      );
      exportarCsv(todas);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo exportar el listado");
    } finally {
      setExporting(false);
    }
  }

  function exportarCsv(filas: TimeEntry[]) {
    downloadCsv(
      filas.map((e) => ({
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
              {gridEditable && (
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
                      </td>

                      {days.map((day, index) => {
                        const entries = row.cells[day] ?? [];
                        const key = cellKey(row.projectId, day);
                        const hours = cellHours(entries);
                        const single = entries.length === 1 ? entries[0] : undefined;
                        // Con varios registros no hay forma de repartir un número
                        // nuevo entre ellos: se editan uno a uno en la ventana.
                        const varios = entries.length > 1;
                        const revisada = !!single && single.status !== "PENDING";
                        const typable = gridEditable && !varios && !revisada;
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
                        </td>
                      )}
                    </tr>
                  ))}

                  {/* Fila para añadir un proyecto, como la última de Clockify. */}
                  {gridEditable && (
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
              entries={editingRow?.cells[editing.day] ?? []}
              readOnly={!gridEditable}
              saving={savingEdit}
              onSave={(changes) => void handleSaveEdit(changes)}
              onClose={() => setEditing(null)}
            />
          )}

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
      )}

      {view === "approvals" && (
        <SectionLayout
          title="Flujo de aprobación"
          canWrite={false}
          onExport={() => void handleExport()}
          exportDisabled={approvalMeta.total === 0 || exporting}
          table={
            <>
              <div className="ts-approvals-filter">
                <label className="field-label" htmlFor="ts-approval-status">
                  Estado
                </label>
                <select
                  id="ts-approval-status"
                  value={approvalStatus}
                  onChange={(e) => setApprovalStatus(e.target.value as TimeEntryStatus | "")}
                >
                  <option value="">Todos</option>
                  <option value="PENDING">Pendientes</option>
                  <option value="APPROVED">Aprobadas</option>
                  <option value="REJECTED">Rechazadas</option>
                </select>
              </div>
              {approvalLoading ? (
                <p className="loading">Cargando...</p>
              ) : approvalMeta.total === 0 ? (
                <p className="empty-note">
                  No hay horas registradas
                  {approvalStatus ? " con el estado seleccionado" : ""}.
                </p>
              ) : (
                <>
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
                    {approvalEntries.map((entry) => {
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
              <div className="table-pager">
                <span className="table-pager__status">
                  {approvalMeta.total} registros · página {approvalMeta.page} de{" "}
                  {Math.max(1, approvalMeta.totalPages)}
                </span>
                <div className="table-pager__nav">
                  <button
                    type="button"
                    className="ghost"
                    disabled={approvalMeta.page <= 1}
                    onClick={() => void loadApprovals(approvalMeta.page - 1)}
                    aria-label="Página anterior"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={approvalMeta.page >= approvalMeta.totalPages}
                    onClick={() => void loadApprovals(approvalMeta.page + 1)}
                    aria-label="Página siguiente"
                  >
                    ›
                  </button>
                </div>
              </div>
                </>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
