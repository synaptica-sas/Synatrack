import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { TIME_ENTRY_STATUS_LABELS, label } from "../../utils/statusLabels";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  deleteTimeEntry,
  discardTimer,
  getMyConsultant,
  getRunningTimer,
  listActivities,
  listTimeEntries,
  startTimer,
  stopTimer,
  updateRunningTimer,
  type Activity,
  type Consultant,
  type Project,
  type RunningTimer,
  type TimeEntry,
} from "../../services/api";
import {
  addDays,
  formatClock,
  formatHoursTotal,
  formatWeekRange,
  numberish,
  startOfWeek,
  todayIso,
  weekDays,
  weekdayLabel,
} from "../timesheet/timesheetUtils";

/** Etiqueta del encabezado de cada grupo de días: "Hoy", "Ayer" o "Lun 15 sep". */
function dayHeading(isoDay: string, today: string): string {
  if (isoDay === today) return "Hoy";
  if (isoDay === addDays(today, -1)) return "Ayer";
  const [y, m, d] = isoDay.split("-").map(Number);
  const index = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${weekdayLabel(index)} ${d} ${months[m - 1]}`;
}

/** Hora local "9:05" a partir de un instante ISO. */
function clockTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function TrackerTab({
  projects,
  canWrite,
  onReload,
  onError,
}: {
  projects: Project[];
  canWrite: boolean;
  /** Refresca el listado global de horas que alimenta dashboard y aprobaciones. */
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [myConsultant, setMyConsultant] = useState<Consultant | null>(null);
  const [consultantResolved, setConsultantResolved] = useState(false);
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Campos del formulario. Mientras el cronómetro corre reflejan el timer del
  // servidor; cuando está parado son el borrador de la próxima entrada.
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [activityId, setActivityId] = useState("");

  const [elapsed, setElapsed] = useState(0);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()));
  const today = todayIso();

  const running = !!timer;

  // ── Carga inicial ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = await getMyConsultant();
        if (!cancelled) setMyConsultant(mine);
      } catch {
        // Se resuelve igual: la pantalla explica que falta la ficha.
      } finally {
        if (!cancelled) setConsultantResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadTimer = useCallback(async () => {
    try {
      const current = await getRunningTimer();
      setTimer(current);
      if (current) {
        setDescription(current.description ?? "");
        setProjectId(current.projectId);
        setActivityId(current.activityId ?? "");
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo consultar el cronómetro");
    }
  }, [onError]);

  useEffect(() => {
    void reloadTimer();
  }, [reloadTimer]);

  const reloadEntries = useCallback(async () => {
    if (!myConsultant) {
      setEntries([]);
      return;
    }
    setEntriesLoading(true);
    try {
      const data = await listTimeEntries({
        consultantId: myConsultant.id,
        from: weekStart,
        to: addDays(weekStart, 6),
      });
      setEntries(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron cargar tus registros");
    } finally {
      setEntriesLoading(false);
    }
  }, [myConsultant, weekStart, onError]);

  useEffect(() => {
    void reloadEntries();
  }, [reloadEntries]);

  useEffect(() => {
    if (!myConsultant) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await listActivities({ consultantId: myConsultant.id });
        if (!cancelled) setActivities(data);
      } catch {
        if (!cancelled) setActivities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myConsultant]);

  // ── Reloj ──────────────────────────────────────────────────────────────────

  // El tiempo se recalcula siempre desde `startedAt`, nunca acumulando ticks:
  // así sigue siendo correcto aunque el navegador congele la pestaña o el
  // equipo se suspenda.
  useEffect(() => {
    if (!timer) {
      setElapsed(0);
      return;
    }
    const started = new Date(timer.startedAt).getTime();
    const tick = () => setElapsed((Date.now() - started) / 1000);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  // Mantiene el título de la pestaña como reloj, útil al trabajar en otra app.
  useEffect(() => {
    if (!timer) return;
    const original = document.title;
    document.title = `${formatClock(elapsed)} · Synatrack`;
    return () => {
      document.title = original;
    };
  }, [timer, elapsed]);

  // ── Acciones ───────────────────────────────────────────────────────────────

  async function handleStart() {
    if (!projectId) {
      onError("Elige el proyecto en el que vas a trabajar antes de arrancar el cronómetro");
      return;
    }
    setBusy(true);
    try {
      const created = await startTimer({
        projectId,
        activityId: activityId || null,
        description: description.trim() || null,
      });
      setTimer(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo iniciar el cronómetro");
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await stopTimer();
      setTimer(null);
      setDescription("");
      setActivityId("");
      await reloadEntries();
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo detener el cronómetro");
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    setConfirmDiscard(false);
    setBusy(true);
    try {
      await discardTimer();
      setTimer(null);
      setDescription("");
      setActivityId("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo descartar el cronómetro");
    } finally {
      setBusy(false);
    }
  }

  /** Arranca un cronómetro nuevo copiando proyecto, tarea y descripción de una entrada. */
  async function handleResume(entry: TimeEntry) {
    if (running) {
      onError("Ya tienes un cronómetro en marcha. Detenlo antes de reanudar otra tarea.");
      return;
    }
    setBusy(true);
    try {
      const created = await startTimer({
        projectId: entry.projectId,
        activityId: entry.activityId,
        description: entry.description,
      });
      setTimer(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo reanudar la tarea");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEntry(entry: TimeEntry) {
    try {
      await deleteTimeEntry(entry.id);
      await reloadEntries();
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar el registro");
    }
  }

  // Los cambios sobre un cronómetro en marcha se envían al servidor; la
  // descripción se retrasa un poco para no disparar una petición por tecla.
  const descriptionTimeout = useRef<number | undefined>(undefined);

  function handleDescriptionChange(value: string) {
    setDescription(value);
    if (!running) return;
    window.clearTimeout(descriptionTimeout.current);
    descriptionTimeout.current = window.setTimeout(() => {
      void updateRunningTimer({ description: value.trim() || null }).catch(() => {
        // Un fallo aquí solo pierde el texto en curso, no el tiempo medido.
      });
    }, 700);
  }

  useEffect(() => () => window.clearTimeout(descriptionTimeout.current), []);

  async function handleProjectChange(value: string) {
    setProjectId(value);
    if (!running || !value) return;
    try {
      const updated = await updateRunningTimer({ projectId: value });
      setTimer(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cambiar el proyecto");
      await reloadTimer();
    }
  }

  async function handleActivityChange(value: string) {
    setActivityId(value);
    if (!running) return;
    try {
      const updated = await updateRunningTimer({ activityId: value || null });
      setTimer(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cambiar la tarea");
      await reloadTimer();
    }
  }

  // ── Agrupado por día ───────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const byDay = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      const day = entry.workDate.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(entry);
      byDay.set(day, list);
    }
    return weekDays(weekStart)
      .filter((day) => byDay.has(day))
      .reverse()
      .map((day) => ({
        day,
        entries: (byDay.get(day) ?? []).sort((a, b) =>
          (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt),
        ),
        total: (byDay.get(day) ?? []).reduce((sum, e) => sum + numberish(e.hours), 0),
      }));
  }, [entries, weekStart]);

  const weekTotal = useMemo(
    () => entries.reduce((sum, e) => sum + numberish(e.hours), 0),
    [entries],
  );

  const activeProject = projects.find((p) => p.id === projectId);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (consultantResolved && !myConsultant) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <PageHeader
          icon="⏱"
          title="Tracker"
          description="Cronómetro en vivo para medir el tiempo que dedicas a cada proyecto y tarea."
        />
        <article className="card">
          <p className="ts-empty-note">
            Tu usuario no está vinculado a ninguna ficha de consultor, así que el cronómetro no puede
            registrar horas a tu nombre. Pide a un administrador que cree tu consultor con este mismo
            correo.
          </p>
        </article>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="⏱"
        title="Tracker"
        description="Cronómetro en vivo para medir el tiempo que dedicas a cada proyecto y tarea."
      />

      <article className={`card tk-bar${running ? " running" : ""}`}>
        <input
          className="tk-desc"
          type="text"
          placeholder="¿En qué estás trabajando?"
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          disabled={!canWrite}
          aria-label="Descripción de la tarea"
        />

        <select
          className="tk-project"
          value={projectId}
          onChange={(e) => void handleProjectChange(e.target.value)}
          disabled={!canWrite}
          aria-label="Proyecto"
        >
          <option value="">Proyecto…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          className="tk-activity"
          value={activityId}
          onChange={(e) => void handleActivityChange(e.target.value)}
          disabled={!canWrite}
          aria-label="Tarea"
        >
          <option value="">Sin tarea</option>
          {activities
            .filter((a) => !projectId || !a.projectId || a.projectId === projectId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
        </select>

        <span className="tk-clock" aria-live="off">
          {formatClock(elapsed)}
        </span>

        {running ? (
          <>
            <button type="button" className="tk-stop" onClick={() => void handleStop()} disabled={busy}>
              ■ Detener
            </button>
            <button
              type="button"
              className="ghost tk-discard"
              onClick={() => setConfirmDiscard(true)}
              disabled={busy}
              title="Descartar sin guardar"
              aria-label="Descartar el cronómetro sin guardar"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            type="button"
            className="tk-start"
            onClick={() => void handleStart()}
            disabled={busy || !canWrite}
          >
            ▶ Iniciar
          </button>
        )}
      </article>

      {timer && (
        <p className="tk-running-note">
          Corriendo desde las {clockTime(timer.startedAt)} en{" "}
          <strong>{activeProject?.name ?? timer.project.name}</strong>. El cronómetro vive en el
          servidor: puedes cerrar el navegador y seguirá contando.
        </p>
      )}

      <article className="card tk-list">
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
          <div className="ts-weektotal">
            <span>Total semana</span>
            <strong>{formatHoursTotal(weekTotal)}</strong>
          </div>
        </div>

        {entriesLoading ? (
          <p className="loading">Cargando registros…</p>
        ) : grouped.length === 0 ? (
          <p className="ts-empty-note">
            Todavía no hay tiempo registrado esta semana. Elige un proyecto y pulsa Iniciar.
          </p>
        ) : (
          grouped.map((group) => (
            <section key={group.day} className="tk-day">
              <header className="tk-day-head">
                <strong>{dayHeading(group.day, today)}</strong>
                <span>{formatHoursTotal(group.total)}</span>
              </header>
              <ul className="tk-entries">
                {group.entries.map((entry) => (
                  <li key={entry.id} className="tk-entry">
                    <div className="tk-entry-main">
                      <span className="tk-entry-desc">
                        {entry.description || entry.activity?.title || "Sin descripción"}
                      </span>
                      <span className="tk-entry-meta">
                        {entry.project.name}
                        {entry.activity && <> · {entry.activity.title}</>}
                        {entry.startedAt && entry.endedAt && (
                          <> · {clockTime(entry.startedAt)}–{clockTime(entry.endedAt)}</>
                        )}
                      </span>
                    </div>
                    <span
                      className={`pill ${entry.status === "APPROVED" ? "ok" : entry.status === "REJECTED" ? "error" : "warn"}`}
                    >
                      {label(TIME_ENTRY_STATUS_LABELS, entry.status)}
                    </span>
                    <span className="tk-entry-hours">{formatHoursTotal(numberish(entry.hours))}</span>
                    {canWrite && (
                      <button
                        type="button"
                        className="ghost tk-resume"
                        onClick={() => void handleResume(entry)}
                        disabled={busy || running}
                        title="Reanudar esta tarea"
                        aria-label="Reanudar esta tarea"
                      >
                        ▶
                      </button>
                    )}
                    {canWrite && entry.status === "PENDING" && (
                      <button
                        type="button"
                        className="ghost tk-entry-del"
                        onClick={() => void handleDeleteEntry(entry)}
                        title="Eliminar registro"
                        aria-label="Eliminar registro"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </article>

      <ConfirmDialog
        open={confirmDiscard}
        title="Descartar el cronómetro"
        message={`Se perderán los ${formatClock(elapsed)} medidos y no se registrará ninguna hora. ¿Continuar?`}
        confirmLabel="Descartar"
        danger
        onConfirm={() => void handleDiscard()}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
