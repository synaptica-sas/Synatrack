import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
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
  listActivities,
  listAllTimeEntries,
  listTaskDescriptions,
  listTimeEntries,
  mergeTask,
  rejectTimeEntry,
  updateTimeEntry,
  type TaskDescription,
  type Activity,
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
  buildRows,
  projectsWithHoursOn,
  rankByHours,
  rowKeyOf,
  rowsToCopy,
  sortByRank,
  type TimesheetRow,
} from "./timesheetGrid";

const emptyDraft = { projectId: "", activityId: "", description: "" };


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
  // Cada proyecto es una fila plegable que despliega sus tareas: el cronómetro
  // crea una fila por cada descripción distinta, y sin agrupar la grilla crece
  // sin orden semana tras semana.
  //
  // Al llegar a una semana se despliegan solo los proyectos con horas HOY: lo
  // que estás tocando queda a la vista y el resto plegado. Dentro de la misma
  // semana se respetan los cambios que hagas a mano.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Orden de las tareas, fijado al cargar la semana (ver `rankByHours`).
  const [taskRank, setTaskRank] = useState<Map<string, number>>(() => new Map());

  const toggleProject = useCallback((projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const expandProjects = useCallback((ids: Iterable<string>) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()));

  const [myConsultant, setMyConsultant] = useState<Consultant | null>(null);
  // Hasta que no se resuelve la ficha propia no se sabe si el aviso de "no
  // tienes consultor" aplica, y mostrarlo antes provoca un parpadeo.
  const [consultantResolved, setConsultantResolved] = useState(false);
  const [consultantId, setConsultantId] = useState("");
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([]);
  // Semana y consultor de los datos cargados. Distingue "llegué a una semana
  // nueva" de "recargué la misma tras guardar una celda".
  const [loadedKey, setLoadedKey] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
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

  // Filas que el usuario acaba de crear y aún no tienen ninguna hora cargada.
  const [draftRows, setDraftRows] = useState<TimesheetRow[]>([]);
  const [newRow, setNewRow] = useState(emptyDraft);
  // Tareas ya usadas en el proyecto elegido, para autocompletar la descripción.
  const [suggestions, setSuggestions] = useState<TaskDescription[]>([]);
  // Fusión de tareas: la fila que se va a absorber y la que la absorbe.
  const [mergeSource, setMergeSource] = useState<TimesheetRow | null>(null);
  const [mergeTargetKey, setMergeTargetKey] = useState("");
  const [merging, setMerging] = useState(false);
  // Mensaje de lo que acaba de pasar (copia o fusión); no es un error.
  const [notice, setNotice] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
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
      // La rejilla necesita todos los registros de la semana para sumar cada
      // celda y el total por día: se piden todas las páginas del rango.
      const data = await listAllTimeEntries({
        consultantId,
        from: weekStart,
        to: addDays(weekStart, 6),
      });
      setWeekEntries(data);
      setLoadedKey(`${weekStart}|${consultantId}`);
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

  // Sugerencias para la descripción: las del proyecto elegido, o de todos si
  // aún no se eligió ninguno. Fallar aquí solo quita el autocompletado.
  useEffect(() => {
    if (!consultantId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await listTaskDescriptions({
          consultantId,
          ...(newRow.projectId ? { projectId: newRow.projectId } : {}),
        });
        if (!cancelled) setSuggestions(data);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [consultantId, newRow.projectId, loadedKey]);

  // Al llegar a una semana (no al recargarla tras guardar): orden de tareas por
  // horas y proyectos abiertos. En la semana actual se abren los que tienen
  // horas hoy; en otras semanas se llega todo plegado.
  const appliedKeyRef = useRef("");
  useEffect(() => {
    if (!loadedKey || appliedKeyRef.current === loadedKey) return;
    appliedKeyRef.current = loadedKey;

    const filas = [...buildRows(weekEntries).values()];
    setTaskRank(rankByHours(filas));
    setExpanded(
      weekStart === startOfWeek(today) ? projectsWithHoursOn(filas, today) : new Set<string>(),
    );
  }, [loadedKey, weekEntries, weekStart, today]);

  // ── Construcción de la grilla ──────────────────────────────────────────────

  const rows = useMemo<TimesheetRow[]>(() => {
    const byKey = buildRows(weekEntries);

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

  /** Filas agrupadas por proyecto, conservando el orden alfabético de `rows`. */
  const groups = useMemo(() => {
    const porProyecto = new Map<string, TimesheetRow[]>();
    for (const row of rows) {
      const lista = porProyecto.get(row.projectId) ?? [];
      lista.push(row);
      porProyecto.set(row.projectId, lista);
    }
    return Array.from(porProyecto, ([projectId, tareas]) => ({
      projectId,
      tareas: sortByRank(tareas, taskRank),
    }));
  }, [rows, taskRank]);

  const allExpanded = groups.length > 0 && groups.every((g) => expanded.has(g.projectId));

  function setAllExpanded(open: boolean) {
    setExpanded(open ? new Set(groups.map((g) => g.projectId)) : new Set<string>());
  }

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

  function groupDayHours(tareas: TimesheetRow[], day: string) {
    return tareas.reduce((sum, row) => sum + cellHours(row, day), 0);
  }

  function groupTotal(tareas: TimesheetRow[]) {
    return tareas.reduce((sum, row) => sum + rowTotal(row), 0);
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
    // Si el proyecto estaba plegado, la fila recién creada quedaría oculta.
    expandProjects([newRow.projectId]);
    setNewRow(emptyDraft);
  }

  /** Trae las tareas de la semana anterior como filas vacías para rellenar. */
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
      const copiadas = rowsToCopy(anterior, new Set(rows.map((r) => r.key)));
      if (copiadas.length === 0) {
        setNotice(
          anterior.length === 0
            ? "La semana anterior no tiene horas registradas."
            : "Todas las tareas de la semana anterior ya están en esta.",
        );
        return;
      }
      setDraftRows((prev) => [...prev, ...copiadas]);
      expandProjects(copiadas.map((r) => r.projectId));
      const n = copiadas.length;
      setNotice(`${n} ${n === 1 ? "tarea copiada" : "tareas copiadas"} de la semana anterior, listas para rellenar.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo copiar la semana anterior");
    } finally {
      setCopying(false);
    }
  }

  /** Nombre visible de una tarea, para el diálogo de fusión. */
  function taskLabel(row: TimesheetRow) {
    const activity = activities.find((a) => a.id === row.activityId);
    const partes = [activity?.title, row.description].filter(Boolean);
    return partes.length > 0 ? partes.join(" · ") : "Sin descripción";
  }

  function openMerge(row: TimesheetRow) {
    setMergeSource(row);
    setMergeTargetKey("");
  }

  async function handleMerge() {
    const source = mergeSource;
    const destino = rows.find((r) => r.key === mergeTargetKey);
    if (!source || !destino) return;

    setMerging(true);
    setNotice(null);
    try {
      const tieneHoras = Object.values(source.cells).some((l) => (l ?? []).length > 0);
      if (tieneHoras) {
        const res = await mergeTask({
          projectId: source.projectId,
          consultantId,
          from: { description: source.description, activityId: source.activityId },
          to: { description: destino.description, activityId: destino.activityId },
        });
        const motivos = [
          res.skippedClosedMonth > 0 ? `${res.skippedClosedMonth} de meses cerrados` : "",
          res.skippedReviewed > 0 ? `${res.skippedReviewed} ya revisados` : "",
        ].filter(Boolean);
        const verbo = res.merged === 1 ? "registro pasó" : "registros pasaron";
        const extra = motivos.length > 0 ? ` No se movieron ${motivos.join(" y ")}.` : "";
        setNotice(`${res.merged} ${verbo} a «${taskLabel(destino)}».${extra}`);
      }
      // Una fila en borrador no tiene registros: fusionarla es solo quitarla.
      setDraftRows((prev) => prev.filter((d) => d.key !== source.key));
      setMergeSource(null);
      await reloadWeek();
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron fusionar las tareas");
    } finally {
      setMerging(false);
    }
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
              {gridEditable && (
                <button
                  type="button"
                  className="ghost ts-expand-all"
                  onClick={() => void handleCopyPreviousWeek()}
                  disabled={copying}
                  title="Trae las tareas de la semana pasada como filas vacías"
                >
                  {copying ? "Copiando…" : "Copiar semana anterior"}
                </button>
              )}
              {groups.length > 0 && (
                <button
                  type="button"
                  className="ghost ts-expand-all"
                  onClick={() => setAllExpanded(!allExpanded)}
                >
                  {allExpanded ? "Plegar todo" : "Desplegar todo"}
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

                  {groups.map(({ projectId, tareas }) => {
                    const project = projects.find((p) => p.id === projectId);
                    const abierto = expanded.has(projectId);
                    return (
                      <Fragment key={projectId}>
                        {/* Cabecera del proyecto: resume sus tareas y las despliega. */}
                        <tr className={`ts-group${abierto ? " open" : ""}`}>
                          <td className="ts-col-project" colSpan={2}>
                            <button
                              type="button"
                              className="ts-group-toggle"
                              onClick={() => toggleProject(projectId)}
                              aria-expanded={abierto}
                              title={abierto ? "Plegar tareas" : "Desplegar tareas"}
                            >
                              <span className="ts-group-caret" aria-hidden="true">{abierto ? "▾" : "▸"}</span>
                              <span className="ts-group-name">{project?.name ?? "Proyecto"}</span>
                              <span className="ts-group-count">
                                {tareas.length} {tareas.length === 1 ? "tarea" : "tareas"}
                              </span>
                            </button>
                          </td>
                          {days.map((day, index) => {
                            const horas = groupDayHours(tareas, day);
                            return (
                              <td
                                key={day}
                                className={`ts-col-day${isWeekend(index) ? " weekend" : ""}${day === today ? " today" : ""}`}
                              >
                                <span className="ts-group-hours">{formatHoursShort(horas) || "—"}</span>
                              </td>
                            );
                          })}
                          <td className="ts-col-total">{formatHoursTotal(groupTotal(tareas))}</td>
                          {gridEditable && <td className="ts-col-actions" />}
                        </tr>

                        {abierto && tareas.map((row) => {
                    const activity = activities.find((a) => a.id === row.activityId);
                    return (
                      <tr key={row.key} className="ts-task-row">
                        {/* El proyecto ya está en la cabecera: aquí solo sangría. */}
                        <td className="ts-col-project ts-indent" aria-hidden="true" />
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
                                  placeholder="00:00:00"
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
                            {tareas.length > 1 && (
                              <button
                                type="button"
                                className="ghost ts-rowmerge"
                                onClick={() => openMerge(row)}
                                aria-label="Fusionar con otra tarea"
                                title="Es la misma tarea que otra: pasar sus horas a esa"
                              >
                                ⇄
                              </button>
                            )}
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
                      </Fragment>
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
                list="ts-task-suggestions"
                autoComplete="off"
              />
              {/* Tareas ya usadas: elegir una en vez de reescribirla hace que
                  las horas caigan en la misma fila y no en una nueva. */}
              <datalist id="ts-task-suggestions">
                {suggestions.map((t) => (
                  <option key={t.description} value={t.description} />
                ))}
              </datalist>
              <button type="submit">+ Agregar fila</button>
            </form>
          )}

          {notice && (
            <p className="ts-notice" role="status">
              <span>{notice}</span>
              <button type="button" className="ghost" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
                ✕
              </button>
            </p>
          )}

          <ConfirmDialog
            open={!!mergeSource}
            title="Fusionar tareas"
            confirmLabel={merging ? "Fusionando…" : "Fusionar"}
            confirmDisabled={!mergeTargetKey || merging}
            onCancel={() => setMergeSource(null)}
            onConfirm={() => void handleMerge()}
            message={
              mergeSource && (
                <div className="ts-merge">
                  <p>
                    Todas las horas de <strong>«{taskLabel(mergeSource)}»</strong> pasarán a la tarea
                    que elijas, también las de semanas anteriores. Las horas no cambian, solo el nombre
                    de la tarea.
                  </p>
                  <select
                    value={mergeTargetKey}
                    onChange={(e) => setMergeTargetKey(e.target.value)}
                    aria-label="Tarea destino"
                  >
                    <option value="">Elige la tarea que se queda…</option>
                    {rows
                      .filter((r) => r.projectId === mergeSource.projectId && r.key !== mergeSource.key)
                      .map((r) => (
                        <option key={r.key} value={r.key}>
                          {taskLabel(r)}
                        </option>
                      ))}
                  </select>
                </div>
              )
            }
          />

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
