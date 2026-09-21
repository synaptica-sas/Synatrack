import { useState } from "react";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import { TIME_ENTRY_STATUS_LABELS, label } from "../../utils/statusLabels";
import { formatDate } from "../../utils/formatDate";
import {
  approveTimeEntry,
  createTimeEntry,
  rejectTimeEntry,
  type Consultant,
  type Project,
  type TimeEntry,
} from "../../services/api";
import { SectionLayout } from "../../components/SectionLayout";
import { downloadCsv } from "../../utils/csv";

function numberish(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const emptyForm = {
  projectId: "",
  consultantId: "",
  workDate: "",
  hours: "",
  note: "",
};

export function TimeEntriesTab({
  timeEntries,
  projects,
  consultants,
  loading,
  canWrite,
  canReview,
  onReload,
  onError,
}: {
  timeEntries: TimeEntry[];
  projects: Project[];
  consultants: Consultant[];
  loading: boolean;
  canWrite: boolean;
  canReview: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  function handleExport() {
    downloadCsv(
      timeEntries.map((e) => ({
        proyecto: e.project.name,
        consultor: e.consultant.fullName,
        fecha: e.workDate.slice(0, 10),
        horas: numberish(e.hours).toFixed(2),
        estado: e.status,
        nota: e.note ?? "",
        aprobadoPor: e.approvedBy ?? "",
      })),
      [
        { key: "proyecto", label: "Proyecto" },
        { key: "consultor", label: "Consultor" },
        { key: "fecha", label: "Fecha" },
        { key: "horas", label: "Horas" },
        { key: "estado", label: "Estado" },
        { key: "nota", label: "Nota" },
        { key: "aprobadoPor", label: "Aprobado Por" },
      ],
      "horas",
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createTimeEntry({
        projectId: form.projectId,
        consultantId: form.consultantId,
        workDate: form.workDate,
        hours: Number(form.hours),
        note: form.note || undefined,
      });
      setForm(emptyForm);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo registrar hora");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(id: string, action: "approve" | "reject") {
    try {
      if (action === "approve") {
        await approveTimeEntry(id);
      } else {
        await rejectTimeEntry(id, "No cumple criterio");
      }
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo actualizar estado");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="⊙"
        title="Registro de Horas (Timesheet)"
        description="Gestiona y aprueba los reportes de horas cargados por los consultores para cada proyecto."
      />
      <SectionLayout
        title="Flujo de aprobación"
      newLabel="+ Registrar horas"
      canWrite={canWrite}
      onExport={handleExport}
      exportDisabled={timeEntries.length === 0}
      form={
        <form onSubmit={(e) => void handleCreate(e)} className="form-inline">
          <select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))} required>
            <option value="">Proyecto</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={form.consultantId} onChange={(e) => setForm((p) => ({ ...p, consultantId: e.target.value }))} required>
            <option value="">Consultor</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </select>
          <input type="date" value={form.workDate} onChange={(e) => setForm((p) => ({ ...p, workDate: e.target.value }))} required />
          <input type="number" step="0.25" placeholder="Horas" value={form.hours} onChange={(e) => setForm((p) => ({ ...p, hours: e.target.value }))} required />
          <textarea placeholder="Nota" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
          <button type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar"}</button>
        </form>
      }
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
                  <th>Horas</th>
                  <th>Estado</th>
                  {canReview && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {timeEntries.map((entry) => {
                  const rowClass = entry.status === "APPROVED" ? "row-approved" : entry.status === "REJECTED" ? "row-rejected" : "row-pending";
                  return (
                    <tr key={entry.id} className={rowClass}>
                      <td title={entry.project.name}>{entry.project.name}</td>
                      <td title={entry.consultant.fullName}>{entry.consultant.fullName}</td>
                      <td>{formatDate(entry.workDate)}</td>
                      <td>{numberish(entry.hours).toFixed(2)}</td>
                      <td>
                        <span className={`pill ${entry.status === "APPROVED" ? "ok" : entry.status === "REJECTED" ? "error" : "warn"}`}>
                          {label(TIME_ENTRY_STATUS_LABELS, entry.status)}
                        </span>
                      </td>
                      {canReview && (
                        <td>
                          {entry.status === "PENDING" && (
                            <div className="inline-actions">
                              <button type="button" onClick={() => void handleReview(entry.id, "approve")}>Aprobar</button>
                              <button type="button" className="ghost" onClick={() => void handleReview(entry.id, "reject")}>Rechazar</button>
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
    </div>
  );
}
