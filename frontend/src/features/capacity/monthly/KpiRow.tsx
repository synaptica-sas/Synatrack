import type { MonthlyCapacityKpis, MonthlyCapacitySettings } from "../../../services/api";
import { formatHours, formatPct } from "./monthlyUtils";

type Kpi = { label: string; value: string; sub?: string; hint: string };

/** Indicadores del equipo en el periodo. Cada título explica en un tooltip cómo se calcula. */
export function KpiRow({ kpis, settings }: { kpis: MonthlyCapacityKpis; settings: MonthlyCapacitySettings }) {
  const items: Kpi[] = [
    {
      label: "Utilización del equipo",
      value: formatPct(kpis.utilizationPct),
      sub: `${formatHours(kpis.assignedHours)} h de ${formatHours(kpis.capacityHours)} h`,
      hint: "Promedio ponderado del periodo: horas asignadas totales entre capacidad total del equipo (no es el promedio simple de los porcentajes de cada consultor).",
    },
    {
      label: "% facturable",
      value: formatPct(kpis.billablePct),
      hint: "Horas asignadas a proyectos no internos entre la capacidad total. Excluye las horas de proyectos internos.",
    },
    {
      label: "Sobreasignados",
      value: String(kpis.overCount),
      sub: `más de ${settings.overThresholdPct}%`,
      hint: `Consultores cuya utilización del periodo supera el ${settings.overThresholdPct}% de su capacidad.`,
    },
    {
      label: "Subutilizados",
      value: String(kpis.underCount),
      sub: `menos de ${settings.underThresholdPct}% facturable`,
      hint: `Consultores cuyo % facturable (sin proyectos internos) es menor al ${settings.underThresholdPct}%.`,
    },
    {
      label: "Horas disponibles",
      value: formatHours(kpis.availableHours),
      sub: `${kpis.consultantCount} consultores`,
      hint: "Capacidad menos horas asignadas en el periodo. Puede ser negativa si el equipo está sobreasignado.",
    },
  ];

  return (
    <div className="kpi-grid cap-kpis">
      {items.map((k) => (
        <div key={k.label} className="kpi-card" title={k.hint}>
          <div className="kpi-card__label">
            {k.label}
            {/* El espacio duro pega el ícono a la última palabra: nunca queda solo en otra línea. */}
            <span aria-hidden="true" className="cap-info">{" "}ⓘ</span>
          </div>
          <div className="kpi-card__value">{k.value}</div>
          {k.sub && <div className="kpi-card__sub">{k.sub}</div>}
          <span className="sr-only">{k.hint}</span>
        </div>
      ))}
    </div>
  );
}
