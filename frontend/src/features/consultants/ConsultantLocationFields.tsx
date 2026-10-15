import { useEffect, useId, useState } from "react";
import { listHolidayCities } from "../../services/api";

/**
 * Ciudad y fechas de ingreso/salida de un consultor. La ciudad decide qué feriados
 * locales le aplican; las fechas acotan en qué meses cuenta su capacidad.
 * Las fechas viajan como `YYYY-MM-DD`, sin pasar por `Date`.
 */
export function ConsultantLocationFields({
  country,
  city,
  hireDate,
  exitDate,
  onChange,
}: {
  country: string;
  city: string;
  hireDate: string;
  exitDate: string;
  onChange: (patch: { city?: string; hireDate?: string; exitDate?: string }) => void;
}) {
  const listId = useId();
  const [sugerencias, setSugerencias] = useState<string[]>([]);

  // Las sugerencias son opcionales: si fallan, el campo sigue siendo texto libre.
  useEffect(() => {
    let vivo = true;
    listHolidayCities(country || undefined)
      .then((c) => {
        if (vivo) setSugerencias(c);
      })
      .catch(() => {
        if (vivo) setSugerencias([]);
      });
    return () => {
      vivo = false;
    };
  }, [country]);

  const salidaAntes = hireDate !== "" && exitDate !== "" && exitDate < hireDate;

  return (
    <div className="consultant-form-row row-3">
      <div>
        <label className="field-label" htmlFor={`${listId}-ciudad`}>Ciudad (opcional)</label>
        <input
          id={`${listId}-ciudad`}
          type="text"
          list={listId}
          maxLength={80}
          placeholder="Ciudad (define feriados locales)"
          value={city}
          onChange={(e) => onChange({ city: e.target.value })}
        />
        <datalist id={listId}>
          {sugerencias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="field-label" htmlFor={`${listId}-ingreso`}>Fecha de ingreso</label>
        <input
          id={`${listId}-ingreso`}
          type="date"
          value={hireDate}
          onChange={(e) => onChange({ hireDate: e.target.value })}
        />
      </div>
      <div>
        <label className="field-label" htmlFor={`${listId}-salida`}>Fecha de salida</label>
        <input
          id={`${listId}-salida`}
          type="date"
          value={exitDate}
          min={hireDate || undefined}
          onChange={(e) => onChange({ exitDate: e.target.value })}
        />
        {salidaAntes && <p className="field-error" role="alert">La salida no puede ser anterior al ingreso.</p>}
      </div>
    </div>
  );
}
