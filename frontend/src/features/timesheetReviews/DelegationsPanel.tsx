import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  createDelegation,
  deleteDelegation,
  listDelegationCandidates,
  listDelegations,
  type ApprovalDelegation,
  type DelegationCandidate,
  type Project,
} from "../../services/api";
import { todayIso } from "../timesheet/timesheetUtils";
import {
  DELEGATION_STATE_LABELS,
  dateOnly,
  delegableProjects,
  delegationState,
  validateDelegationForm,
  type DelegationState,
} from "./delegationUtils";

const STATE_TONE: Record<DelegationState, "ok" | "warn" | "error"> = {
  ACTIVE: "ok",
  FUTURE: "warn",
  EXPIRED: "error",
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function DelegationsPanel({
  projects,
  userEmail,
  isAdmin,
  onNotice,
}: {
  projects: readonly Project[];
  userEmail: string | undefined;
  isAdmin: boolean;
  onNotice: (message: string, type?: "success" | "error" | "warning" | "info") => void;
}) {
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [candidates, setCandidates] = useState<DelegationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const today = todayIso();
  const [projectId, setProjectId] = useState("");
  const [toUserEmail, setToUserEmail] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<ApprovalDelegation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const myEmail = userEmail?.trim().toLowerCase() ?? "";
  const myProjects = useMemo(
    () => delegableProjects(projects, userEmail, isAdmin),
    [projects, userEmail, isAdmin],
  );
  // Quien delega no puede ser su propio delegado.
  const options = useMemo(() => candidates.filter((c) => c.email !== myEmail), [candidates, myEmail]);
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, cands] = await Promise.all([listDelegations(), listDelegationCandidates()]);
      setDelegations(list);
      setCandidates(cands);
    } catch (err) {
      setLoadError(errorText(err, "No se pudieron cargar las delegaciones"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateDelegationForm({ projectId, toUserEmail, startDate, endDate });
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createDelegation({ projectId, toUserEmail, startDate, endDate });
      onNotice("Delegación creada.", "success");
      setToUserEmail("");
      await load();
    } catch (err) {
      setFormError(errorText(err, "No se pudo crear la delegación"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDelegation(toDelete.id);
      setToDelete(null);
      onNotice("Delegación eliminada.", "success");
      await load();
    } catch (err) {
      setDeleteError(errorText(err, "No se pudo eliminar la delegación"));
    } finally {
      setDeleting(false);
    }
  }

  const nameOf = (email: string) => candidates.find((c) => c.email === email.toLowerCase())?.nombre;

  return (
    <article className="card" aria-label="Mis delegaciones">
      <p className="empty-note">
        Delega la revisión de horas de un proyecto que diriges mientras estás ausente. Solo puedes elegir a
        quien ya es PM o Administrador; el delegado podrá aprobar y devolver semanas de ese proyecto durante el rango indicado.
      </p>

      <form className="rv-deleg-form" onSubmit={(e) => void submit(e)} aria-label="Nueva delegación">
        <label className="rv-field">
          Proyecto
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={saving}>
            <option value="">Selecciona un proyecto</option>
            {myProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="rv-field">
          Delegado
          <select value={toUserEmail} onChange={(e) => setToUserEmail(e.target.value)} disabled={saving}>
            <option value="">Selecciona a quién delegas</option>
            {options.map((c) => (
              <option key={c.email} value={c.email}>
                {c.nombre === c.email ? c.email : `${c.nombre} (${c.email})`}
                {c.motivo === "PROYECTO" && c.proyectos.length > 0 ? ` · dirige ${c.proyectos.join(", ")}` : " · rol PM/Administrador"}
              </option>
            ))}
          </select>
        </label>
        <label className="rv-field">
          Desde
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={saving} />
        </label>
        <label className="rv-field">
          Hasta
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} disabled={saving} />
        </label>
        <button type="submit" disabled={saving || loading}>
          {saving ? "Creando…" : "Crear delegación"}
        </button>
      </form>

      {myProjects.length === 0 && (
        <p className="empty-note">No hay proyectos con PM asignado sobre los que puedas delegar.</p>
      )}
      {!loading && !loadError && options.length === 0 && (
        <p className="empty-note">No hay candidatos disponibles: el delegado debe ser PM de algún proyecto o tener rol PM/Administrador.</p>
      )}

      {formError && (
        <div role="alert" className="notice notice--danger rv-banner">
          <p className="notice__title">No se pudo crear la delegación</p>
          <p className="notice__text">{formError}</p>
        </div>
      )}

      {loading ? (
        <p className="loading" role="status">Cargando delegaciones…</p>
      ) : loadError ? (
        <div role="alert" className="notice notice--danger">
          <p className="notice__title">No se pudieron cargar las delegaciones</p>
          <p className="notice__text">{loadError}</p>
          <button type="button" className="ghost" onClick={() => void load()}>Reintentar</button>
        </div>
      ) : delegations.length === 0 ? (
        <p className="empty-note empty-note--center">Aún no hay delegaciones.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proyecto</th>
                {isAdmin && <th>Delegante</th>}
                <th>Delegado</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {delegations.map((d) => {
                const state = delegationState(d, today);
                const canDelete = isAdmin || d.fromUserEmail.toLowerCase() === myEmail;
                const projectName = d.project?.name ?? projectNames.get(d.projectId) ?? "Proyecto";
                return (
                  <tr key={d.id}>
                    <td>{projectName}</td>
                    {isAdmin && <td>{d.fromUserEmail}</td>}
                    <td title={d.toUserEmail}>{nameOf(d.toUserEmail) ?? d.toUserEmail}</td>
                    <td>{dateOnly(d.startDate)}</td>
                    <td>{dateOnly(d.endDate)}</td>
                    <td><span className={`pill ${STATE_TONE[state]}`}>{DELEGATION_STATE_LABELS[state]}</span></td>
                    <td>
                      {canDelete ? (
                        <button
                          type="button"
                          className="btn-sm btn-danger-soft"
                          aria-label={`Eliminar delegación de ${projectName} a ${d.toUserEmail}`}
                          onClick={() => {
                            setDeleteError(null);
                            setToDelete(d);
                          }}
                        >
                          Eliminar
                        </button>
                      ) : (
                        <span className="rv-readonly">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminar delegación"
        danger
        confirmLabel={deleting ? "Eliminando…" : "Eliminar"}
        confirmDisabled={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
        message={
          toDelete && (
            <div>
              <p>
                Se elimina la delegación de <strong>{toDelete.project?.name ?? projectNames.get(toDelete.projectId) ?? "Proyecto"}</strong> a{" "}
                {toDelete.toUserEmail} ({dateOnly(toDelete.startDate)} a {dateOnly(toDelete.endDate)}). Esa persona dejará de poder revisar las horas de ese proyecto.
              </p>
              {deleteError && (
                <div role="alert" className="notice notice--danger">
                  <p className="notice__text">{deleteError}</p>
                </div>
              )}
            </div>
          )
        }
      />
    </article>
  );
}
