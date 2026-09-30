import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { downloadCsv } from "../../utils/csv";
import { listAllTimeEntries, type Consultant, type TimeEntry } from "../../services/api";
import { addDays, formatWeekRange, startOfWeek, todayIso } from "../timesheet/timesheetUtils";
import { HoursBarChart } from "./HoursBarChart";
import { DAILY_LIMIT, barsByConsultant, barsByDay, formatHms, totals } from "./reportUtils";

export function ReportsTab({
  consultants,
  onError,
}: {
  consultants: Consultant[];
  onError: (msg: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()));
  const [consultantId, setConsultantId] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyApproved, setOnlyApproved] = useState(false);

  const today = todayIso();
  const weekEnd = addDays(weekStart, 6);
  /** ¿Se está mirando a una sola persona o al equipo entero? */
  const unaPersona = !!consultantId;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // El informe es un agregado de la semana (gráfica, totales y CSV): se
      // piden todas las páginas del rango a propósito, no la primera.
      const data = await listAllTimeEntries({
        from: weekStart,
        to: weekEnd,
        ...(consultantId ? { consultantId } : {}),
        ...(onlyApproved ? { status: "APPROVED" as const } : {}),
      });
      setEntries(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cargar el informe");
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd, consultantId, onlyApproved, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // La gráfica cubre la semana entera, de lunes a domingo. El filtro de
  // consultor cambia de quién son esas horas, no lo que representa cada
  // columna. El sábado y el domingo entran en los totales como cualquier otro
  // día; se distinguen por el tono atenuado de su columna, no por omisión.
  const bars = useMemo(() => barsByDay(entries, weekStart), [entries, weekStart]);
  const porConsultor = useMemo(() => barsByConsultant(entries), [entries]);
  const resumen = useMemo(() => totals(bars), [bars]);

  const nombreConsultor = consultants.find((c) => c.id === consultantId)?.fullName;

  function handleExport() {
    downloadCsv(
      bars.map((b) => ({
        dia: b.key,
        etiqueta: b.label,
        dentroJornada: b.regular.toFixed(2),
        exceso: b.excess.toFixed(2),
        total: b.total.toFixed(2),
      })),
      [
        { key: "dia", label: "Fecha" },
        { key: "etiqueta", label: "Día" },
        { key: "dentroJornada", label: "Dentro de jornada" },
        { key: "exceso", label: `Exceso sobre ${DAILY_LIMIT}h/día` },
        { key: "total", label: "Total" },
      ],
      "informe-horas",
    );
  }

  return (
    <div className="section-stack">
      <PageHeader
        icon="▧"
        title="Informes"
        description="Horas trabajadas por día, destacando lo que excede la jornada de 8 horas diarias."
      />

      <article className="card">
        <div className="ts-toolbar">
          <div className="ts-weeknav">
            <button type="button" className="ghost" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Semana anterior">←</button>
            <div className="ts-weeklabel">
              <strong>{formatWeekRange(weekStart)}</strong>
              {weekStart === startOfWeek(today) && <span className="ts-chip">Esta semana</span>}
            </div>
            <button type="button" className="ghost" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Semana siguiente">→</button>
            <button type="button" className="ghost" onClick={() => setWeekStart(startOfWeek(today))}>Hoy</button>
          </div>

          <div className="ts-toolbar-right">
            <select value={consultantId} onChange={(e) => setConsultantId(e.target.value)} aria-label="Filtrar por consultor">
              <option value="">Todos los consultores</option>
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>{c.fullName}</option>
              ))}
            </select>
            <label className="report-check">
              <input type="checkbox" checked={onlyApproved} onChange={(e) => setOnlyApproved(e.target.checked)} />
              Solo aprobadas
            </label>
            <button type="button" className="ghost" onClick={handleExport} disabled={entries.length === 0}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div className="report-kpis">
          <div>
            <span>{unaPersona ? nombreConsultor ?? "Consultor" : "Total del equipo"}</span>
            <strong>{formatHms(resumen.total)}</strong>
          </div>
          <div>
            <span>Dentro de jornada</span>
            <strong className="ok">{formatHms(resumen.regular)}</strong>
          </div>
          <div>
            <span>Exceso sobre {DAILY_LIMIT} h/día</span>
            <strong className={resumen.excess > 0 ? "bad" : undefined}>{formatHms(resumen.excess)}</strong>
          </div>
        </div>

        {loading ? (
          <p className="loading">Calculando…</p>
        ) : (
          <HoursBarChart
            bars={bars}
            showDailyLimit={unaPersona}
            emptyMessage={
              unaPersona
                ? `${nombreConsultor ?? "Ese consultor"} no registró horas en esta semana.`
                : "Nadie registró horas en esta semana."
            }
          />
        )}

        <p className="ts-hint">
          {unaPersona
            ? `Cada columna es un día de ${nombreConsultor ?? "el consultor"}, de lunes a domingo. Lo que pasa de ${DAILY_LIMIT} h aparece en rojo.`
            : `Cada columna suma el día de todo el equipo, de lunes a domingo. El tramo rojo es lo que alguien excedió de su jornada de ${DAILY_LIMIT} h, no lo que el equipo pasa de ${DAILY_LIMIT} h entre todos.`}
        </p>
      </article>

      {!unaPersona && porConsultor.length > 0 && (
        <article className="card">
          <h3 className="section-header-title section-header-title--tight">
            Horas por consultor (semana completa)
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultor</th>
                  <th className="cell-right">Dentro de jornada</th>
                  <th className="cell-right">Exceso</th>
                  <th className="cell-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {porConsultor.map((b) => (
                  <tr key={b.key}>
                    <td>{b.label}</td>
                    <td className="cell-right">{formatHms(b.regular)}</td>
                    <td className={b.excess > 0 ? "cell-right report-cell-excess" : "cell-right"}>
                      {b.excess > 0 ? formatHms(b.excess) : "—"}
                    </td>
                    <td className="cell-right cell-strong">{formatHms(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <article className="card">
        <h3 className="section-header-title section-header-title--tight">
          Los mismos datos de la gráfica, en tabla
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th className="cell-right">Dentro de jornada</th>
                <th className="cell-right">Exceso</th>
                <th className="cell-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td className="cell-right">{formatHms(b.regular)}</td>
                  <td className={b.excess > 0 ? "cell-right report-cell-excess" : "cell-right"}>
                    {b.excess > 0 ? formatHms(b.excess) : "—"}
                  </td>
                  <td className="cell-right cell-strong">{formatHms(b.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="cell-strong">Total</td>
                <td className="cell-right cell-strong">{formatHms(resumen.regular)}</td>
                <td className="cell-right cell-strong">{formatHms(resumen.excess)}</td>
                <td className="cell-right cell-strong">{formatHms(resumen.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    </div>
  );
}
