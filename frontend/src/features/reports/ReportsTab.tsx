import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { downloadCsv } from "../../utils/csv";
import { listTimeEntries, type Consultant, type TimeEntry } from "../../services/api";
import { addDays, formatWeekRange, startOfWeek, todayIso } from "../timesheet/timesheetUtils";
import { HoursBarChart } from "./HoursBarChart";
import {
  DAILY_LIMIT,
  barsByConsultant,
  barsByDay,
  formatHms,
  onlyWeekdays,
  totals,
  weekendHours,
} from "./reportUtils";

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
      const data = await listTimeEntries({
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

  // La gráfica es siempre por día laborable. El filtro de consultor cambia de
  // quién son esas horas, no lo que representa cada columna.
  //
  // El fin de semana se descarta en un único punto, y a partir de ahí todo
  // (gráfica, tablas, totales y CSV) habla de lunes a viernes. Las horas de
  // sábado o domingo no se pierden: se cuentan aparte y se avisan, porque en
  // este sistema el trabajo en fin de semana existe -- Consultant tiene
  // allowWeekendWork -- y esconderlo sin más falsearía el informe.
  const laborables = useMemo(() => onlyWeekdays(entries, weekStart), [entries, weekStart]);
  const finDeSemana = useMemo(() => weekendHours(entries, weekStart), [entries, weekStart]);

  const bars = useMemo(() => barsByDay(laborables, weekStart), [laborables, weekStart]);
  const porConsultor = useMemo(() => barsByConsultant(laborables), [laborables]);
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
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
            <button type="button" className="ghost" onClick={handleExport} disabled={laborables.length === 0}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div className="report-kpis">
          <div>
            <span>{unaPersona ? nombreConsultor ?? "Consultor" : "Total del equipo"} (lun–vie)</span>
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

        {finDeSemana > 0 && (
          <p className="report-weekend-note">
            Además hay <strong>{formatHms(finDeSemana)}</strong> registradas en sábado o domingo, que
            la gráfica no muestra porque solo cubre los días laborables.
          </p>
        )}

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
            ? `Cada columna es un día laborable de ${nombreConsultor ?? "el consultor"}. Lo que pasa de ${DAILY_LIMIT} h aparece en rojo.`
            : `Cada columna suma el día de todo el equipo, de lunes a viernes. El tramo rojo es lo que alguien excedió de su jornada de ${DAILY_LIMIT} h, no lo que el equipo pasa de ${DAILY_LIMIT} h entre todos.`}
        </p>
      </article>

      {!unaPersona && porConsultor.length > 0 && (
        <article className="card">
          <h3 className="section-header-title" style={{ marginBottom: "0.75rem" }}>
            Horas por consultor (lunes a viernes)
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultor</th>
                  <th style={{ textAlign: "right" }}>Dentro de jornada</th>
                  <th style={{ textAlign: "right" }}>Exceso</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {porConsultor.map((b) => (
                  <tr key={b.key}>
                    <td>{b.label}</td>
                    <td style={{ textAlign: "right" }}>{formatHms(b.regular)}</td>
                    <td style={{ textAlign: "right" }} className={b.excess > 0 ? "report-cell-excess" : undefined}>
                      {b.excess > 0 ? formatHms(b.excess) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHms(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <article className="card">
        <h3 className="section-header-title" style={{ marginBottom: "0.75rem" }}>
          Los mismos datos de la gráfica, en tabla
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th style={{ textAlign: "right" }}>Dentro de jornada</th>
                <th style={{ textAlign: "right" }}>Exceso</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td style={{ textAlign: "right" }}>{formatHms(b.regular)}</td>
                  <td style={{ textAlign: "right" }} className={b.excess > 0 ? "report-cell-excess" : undefined}>
                    {b.excess > 0 ? formatHms(b.excess) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHms(b.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHms(resumen.regular)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHms(resumen.excess)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHms(resumen.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    </div>
  );
}
