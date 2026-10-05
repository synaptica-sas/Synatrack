import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useHealthThresholds } from "../../hooks/useHealthThresholds";
import {
  resetHealthThresholds,
  updateHealthThresholds,
  type UmbralesSalud,
} from "../../services/api";

/**
 * Umbrales generales del semáforo de salud (decisión de negocio D-7).
 *
 * Existe porque estos cortes vivían en dos sitios con números distintos: la
 * pantalla de Portafolio pintaba la celda de CPI con 0,85 / 1,00 mientras el
 * backend decidía el semáforo de la misma fila con 0,75 / 0,90. Un proyecto con
 * CPI 0,80 salía con la celda en rojo y su propio semáforo en ámbar.
 *
 * Ahora el veredicto lo calcula siempre el servidor con estos valores, y la
 * interfaz solo lo pinta. Esta pantalla es el único sitio donde se cambian, para
 * que no puedan volver a separarse.
 *
 * Vive en Administración y solo la toca ADMIN (`health:thresholds`), igual que
 * Jornada Laboral y Categorías: no es un dato operativo, es un parámetro que
 * recolorea el portafolio entero de golpe.
 */

type Borrador = Record<keyof UmbralesSalud, string>;

/** 0.75 → "0,75". El producto usa coma decimal. */
function aTexto(valor: number): string {
  return String(valor).replace(".", ",");
}

function aBorrador(valores: UmbralesSalud): Borrador {
  return {
    cpiWarning: aTexto(valores.cpiWarning),
    cpiCritical: aTexto(valores.cpiCritical),
    spiWarning: aTexto(valores.spiWarning),
    spiCritical: aTexto(valores.spiCritical),
    budgetWarningPct: aTexto(valores.budgetWarningPct),
    budgetCriticalPct: aTexto(valores.budgetCriticalPct),
  };
}

function aNumero(texto: string): number {
  return Number(texto.replace(",", "."));
}

/**
 * Valida antes de llamar al servidor. El backend vuelve a validar —es quien
 * manda—, pero decirlo aquí evita un viaje y un mensaje genérico.
 */
function validar(b: Borrador): string | null {
  const campos: Array<[keyof UmbralesSalud, string]> = [
    ["cpiWarning", "CPI de advertencia"],
    ["cpiCritical", "CPI crítico"],
    ["spiWarning", "SPI de advertencia"],
    ["spiCritical", "SPI crítico"],
    ["budgetWarningPct", "Presupuesto de advertencia"],
    ["budgetCriticalPct", "Presupuesto crítico"],
  ];

  for (const [clave, etiqueta] of campos) {
    const valor = aNumero(b[clave]);
    if (!Number.isFinite(valor) || valor <= 0) {
      return `${etiqueta}: hace falta un número mayor que cero.`;
    }
  }

  // Los índices son razones: 1,00 significa "exactamente lo planificado".
  for (const clave of ["cpiWarning", "cpiCritical", "spiWarning", "spiCritical"] as const) {
    if (aNumero(b[clave]) > 5) {
      return "Los índices CPI y SPI son razones, no porcentajes: 1,00 es «según lo planificado».";
    }
  }

  // Un crítico por encima del de advertencia dejaría la banda de aviso vacía.
  if (aNumero(b.cpiCritical) > aNumero(b.cpiWarning)) {
    return "El CPI crítico no puede ser mayor que el de advertencia.";
  }
  if (aNumero(b.spiCritical) > aNumero(b.spiWarning)) {
    return "El SPI crítico no puede ser mayor que el de advertencia.";
  }
  // En presupuesto la relación se invierte: más gasto es peor, así que el
  // crítico va por encima.
  if (aNumero(b.budgetCriticalPct) < aNumero(b.budgetWarningPct)) {
    return "El porcentaje de presupuesto crítico no puede ser menor que el de advertencia.";
  }
  return null;
}

type Props = {
  onError: (mensaje: string) => void;
  onSuccess: (mensaje: string) => void;
};

export function HealthThresholdsTab({ onError, onSuccess }: Props) {
  const { config, loading, error, reload } = useHealthThresholds(true);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Resincroniza el formulario cuando llegan los valores del servidor. Sin
  // esto, el borrador se quedaría en su estado inicial y el usuario editaría
  // sobre datos que no son los guardados.
  useEffect(() => {
    if (config) setBorrador(aBorrador(config));
  }, [config]);

  const guardar = useCallback(async () => {
    if (!borrador) return;
    const problema = validar(borrador);
    if (problema) {
      onError(problema);
      return;
    }
    setGuardando(true);
    try {
      await updateHealthThresholds({
        cpiWarning: aNumero(borrador.cpiWarning),
        cpiCritical: aNumero(borrador.cpiCritical),
        spiWarning: aNumero(borrador.spiWarning),
        spiCritical: aNumero(borrador.spiCritical),
        budgetWarningPct: aNumero(borrador.budgetWarningPct),
        budgetCriticalPct: aNumero(borrador.budgetCriticalPct),
      });
      onSuccess("Umbrales guardados. El semáforo de todos los proyectos se recalcula al instante.");
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron guardar los umbrales");
    } finally {
      setGuardando(false);
    }
  }, [borrador, onError, onSuccess, reload]);

  const restaurar = useCallback(async () => {
    setGuardando(true);
    try {
      await resetHealthThresholds();
      onSuccess("Se restauraron los valores acordados.");
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron restaurar los umbrales");
    } finally {
      setGuardando(false);
    }
  }, [onError, onSuccess, reload]);

  function campo(
    clave: keyof UmbralesSalud,
    etiqueta: string,
    ayuda: string,
    paso: string,
  ) {
    return (
      <div className="field-stack">
        <label className="field-label" htmlFor={`umbral-${clave}`}>
          {etiqueta}
        </label>
        <input
          id={`umbral-${clave}`}
          className="est-control"
          type="number"
          step={paso}
          min="0"
          value={borrador?.[clave].replace(",", ".") ?? ""}
          disabled={guardando || !borrador}
          onChange={(e) =>
            setBorrador((prev) => (prev ? { ...prev, [clave]: e.target.value } : prev))
          }
        />
        <span className="field-help">{ayuda}</span>
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--padded">
      <PageHeader
        icon="◉"
        title="Umbrales de salud"
        description="Cuándo un proyecto pasa a Advertencia o a Crítico"
      />

      {error && (
        <div className="notice notice--danger" role="status">
          <strong>No se pudieron cargar los umbrales.</strong> {error}{" "}
          <button type="button" className="btn-sm ghost" onClick={() => void reload()}>
            Reintentar
          </button>
        </div>
      )}

      <div className="notice notice--info" role="note">
        Estos valores gobiernan <strong>todo el portafolio a la vez</strong>. El semáforo de cada
        proyecto y el color de sus celdas de CPI y SPI salen de aquí, así que un cambio recolorea
        las pantallas de Tablero, Portafolio y Detalle de inmediato.
        {config?.origen === "codigo" && (
          <> Ahora mismo no hay nada guardado: se están aplicando los valores acordados.</>
        )}
      </div>

      <section className="card card--roomy section-stack">
        <div className="card-head">
          <h3 className="card-title">Rendimiento (CPI y SPI)</h3>
        </div>
        <p className="field-help">
          Son razones, no porcentajes: <strong>1,00</strong> significa «según lo planificado».
          Por debajo de 1 el proyecto gasta de más (CPI) o va retrasado (SPI).
        </p>
        <div className="form-grid--tight">
          {campo("cpiWarning", "CPI — advertencia por debajo de", "Coste. Por defecto 0,90.", "0.01")}
          {campo("cpiCritical", "CPI — crítico por debajo de", "Por defecto 0,75.", "0.01")}
          {campo("spiWarning", "SPI — advertencia por debajo de", "Cronograma. Por defecto 0,90.", "0.01")}
          {campo("spiCritical", "SPI — crítico por debajo de", "Por defecto 0,75.", "0.01")}
        </div>
      </section>

      <section className="card card--roomy section-stack">
        <div className="card-head">
          <h3 className="card-title">Uso de presupuesto</h3>
        </div>
        <p className="field-help">
          Aquí la relación se invierte: cuanto más alto el porcentaje, peor. El de advertencia solo
          se aplica a los proyectos que no tengan configurado el suyo propio en su ficha.
        </p>
        <div className="form-grid--tight">
          {campo("budgetWarningPct", "Advertencia al superar el %", "Por defecto 90 %.", "1")}
          {campo("budgetCriticalPct", "Crítico al superar el %", "Por defecto 100 %.", "1")}
        </div>
      </section>

      <div className="inline-actions">
        <button type="button" onClick={() => void guardar()} disabled={guardando || loading || !borrador}>
          {guardando ? "Guardando…" : "Guardar umbrales"}
        </button>
        <button type="button" className="btn-sm ghost" onClick={() => void restaurar()} disabled={guardando}>
          Restaurar los valores acordados
        </button>
      </div>

      {config?.updatedAt && (
        <p className="empty-note">
          Última modificación: {new Date(config.updatedAt).toLocaleString("es-CO")}
        </p>
      )}
    </div>
  );
}
