import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getCapacityMonthlyConsultant,
  type MonthlyCapacityAssignment,
  type MonthlyCapacityConsultantDetail,
  type MonthlyCapacityParams,
} from "../../../services/api";
import { formatHours, formatPct, monthHeader, statusTone } from "./monthlyUtils";

/** Etiqueta del tipo de asignación: confirmada, probable o interna (un proyecto interno puede ser también probable). */
function kindChips(a: MonthlyCapacityAssignment) {
  return (
    <>
      <span className={`state-chip ${a.certainty === "CONFIRMED" ? "state-chip--success" : "state-chip--warning"}`}>
        {a.certainty === "CONFIRMED" ? "Confirmado" : "Probable"}
      </span>
      {a.isInternal && <span className="state-chip state-chip--info cap-chip-gap">Interno</span>}
    </>
  );
}

/**
 * Panel lateral con el detalle de un consultor: proyectos × meses.
 * Las probables que el filtro no incluye se muestran atenuadas ("no incluida").
 *
 * Con `frozenDetail` (reporte oficial) es de solo lectura: muestra los datos congelados y NO
 * llama a la API.
 */
export function ConsultantCapacityDrawer({
  consultantId,
  params = {},
  frozenDetail,
  onClose,
}: {
  consultantId: string;
  params?: Omit<MonthlyCapacityParams, "consultantId">;
  frozenDetail?: MonthlyCapacityConsultantDetail;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MonthlyCapacityConsultantDetail | null>(frozenDetail ?? null);
  const [loading, setLoading] = useState(!frozenDetail);
  const [error, setError] = useState<string | null>(null);
  /** Identifica la petición vigente; una respuesta de otra consulta se descarta. */
  const latest = useRef("");
  const key = JSON.stringify(params);

  const load = useCallback(async () => {
    if (frozenDetail) return;
    setLoading(true);
    try {
      const d = await getCapacityMonthlyConsultant(consultantId, JSON.parse(key) as MonthlyCapacityParams);
      if (latest.current !== consultantId + key) return;
      setDetail(d);
      setError(null);
    } catch (err) {
      if (latest.current !== consultantId + key) return;
      setDetail(null);
      setError(err instanceof Error ? err.message : "No se pudo cargar el detalle del consultor");
    } finally {
      if (latest.current === consultantId + key) setLoading(false);
    }
  }, [consultantId, key, frozenDetail]);

  useEffect(() => {
    latest.current = consultantId + key;
    void load();
    return () => {
      latest.current = "";
    };
  }, [load, consultantId, key]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Bloquea el scroll de la página mientras el panel está abierto y devuelve el foco al cerrar.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previo?.focus?.();
    };
  }, []);

  const c = detail?.consultant;

  // En un portal sobre <body>: un ancestro con transform/animación haría que `fixed` se
  // anclara a la página y no al viewport.
  return createPortal(
    <div className="cap-drawer-overlay" onClick={onClose} data-testid="cap-drawer-overlay">
      <div
        className="cap-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de capacidad del consultor"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cap-drawer__head">
          <div>
            <h3 className="cap-drawer__title">{c?.fullName ?? "Detalle del consultor"}</h3>
            {c && (
              <p className="field-help">
                {c.country ?? "Sin país"}
                {c.city ? ` · ${c.city}` : ""}
                {c.role ? ` · ${c.role}` : ""}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Cerrar detalle">
            ✕
          </button>
        </div>

        {loading && <div className="kpi-loading" role="status">Cargando detalle…</div>}

        {!loading && error && (
          <div className="notice notice--danger" role="alert">
            <p className="notice__title">No se pudo cargar el detalle</p>
            <p className="notice__text">{error}</p>
            <button type="button" className="btn-sm" onClick={() => void load()}>
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && detail && (
          <>
            <p className="field-help">
              Jornada:{" "}
              {detail.months.some((m) => m.workdays > 0)
                ? `${formatHours(
                    detail.months.reduce((s, m) => s + m.capacityHours, 0) /
                      Math.max(1, detail.months.reduce((s, m) => s + m.workdays, 0)),
                  )} h por día hábil`
                : "sin días hábiles en el periodo"}
              . Utilización del periodo: <strong>{formatPct(detail.period.pct)}</strong>
            </p>
            <div className="table-wrap">
              <table className="cap-detail">
                <thead>
                  <tr>
                    <th className="cap-sticky">Proyecto</th>
                    <th>Tipo</th>
                    <th className="cell-right">h/sem</th>
                    {detail.months.map((m) => (
                      <th key={m.month} className="cell-center">{monthHeader(m.month)}</th>
                    ))}
                    <th className="cell-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.assignments.length === 0 && (
                    <tr>
                      <td colSpan={detail.months.length + 4} className="cell-empty">
                        Sin asignaciones en el periodo.
                      </td>
                    </tr>
                  )}
                  {detail.assignments.map((a) => {
                    const byMonth = new Map(a.months.map((x) => [x.month, x.hours]));
                    return (
                      <tr key={a.assignmentId} className={a.included ? undefined : "cap-row--excluded"}>
                        <td className="cap-sticky">
                          <span className="cell-strong">{a.projectName}</span>
                          {a.client && <span className="cell-meta"> {a.client}</span>}
                          {!a.included && <span className="cell-meta"> · no incluida</span>}
                        </td>
                        <td>{kindChips(a)}</td>
                        <td className="cell-right">{formatHours(a.hoursPerWeek)}</td>
                        {detail.months.map((m) => (
                          <td key={m.month} className="cell-num">
                            {formatHours(byMonth.get(m.month) ?? 0)}
                          </td>
                        ))}
                        <td className="cell-right cell-strong">{formatHours(a.totalHours)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="cap-sticky">Días hábiles</th>
                    <td />
                    <td />
                    {detail.months.map((m) => (
                      <td key={m.month} className="cell-num">{m.workdays}</td>
                    ))}
                    <td className="cell-right">{detail.period.workdays}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="cap-sticky">Capacidad (h)</th>
                    <td />
                    <td />
                    {detail.months.map((m) => (
                      <td key={m.month} className="cell-num">{formatHours(m.capacityHours)}</td>
                    ))}
                    <td className="cell-right">{formatHours(detail.period.capacityHours)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="cap-sticky">Asignadas (h)</th>
                    <td />
                    <td />
                    {detail.months.map((m) => (
                      <td key={m.month} className={`cap-cell cap-cell--${statusTone(m.status)}`}>
                        {formatHours(m.assignedHours)} ({formatPct(m.pct)})
                      </td>
                    ))}
                    <td className={`cap-cell cap-cell--${statusTone(detail.period.status)}`}>
                      {formatHours(detail.period.assignedHours)} ({formatPct(detail.period.pct)})
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
