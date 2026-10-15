import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeader } from "../../components/PageHeader";
import { useHolidays } from "../../hooks/useHolidays";
import {
  confirmHolidayYear,
  createHoliday,
  deleteHoliday,
  generateHolidays,
  listSupportedCountries,
  unconfirmHolidayYear,
  updateHoliday,
  type Holiday,
  type HolidayCoverage,
  type HolidaySource,
} from "../../services/api";
import { formatDate, formatDateTime } from "../../utils/formatDate";

/**
 * Feriados del calendario de capacity (Administración, solo ADMIN).
 *
 * Una fecha viaja siempre como `YYYY-MM-DD`: el `<input type="date">` ya entrega
 * ese texto y nunca se convierte a `Date` local (en Ecuador, UTC-5, eso movería
 * el feriado un día). Para mostrarla se usa `formatDate`, que formatea en UTC.
 *
 * El caso que motiva la pantalla: un decreto del gobierno que mueve o agrega un
 * feriado "de un día para otro". Por eso el alta rápida va arriba y destacada.
 */

const ETIQUETA_ORIGEN: Record<HolidaySource, { texto: string; chip: string }> = {
  GENERATED: { texto: "Generado", chip: "state-chip--neutral" },
  MANUAL: { texto: "Manual", chip: "state-chip--info" },
  DECREE: { texto: "Decreto", chip: "state-chip--warning" },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Borrador = { date: string; name: string; city: string; source: HolidaySource };

const BORRADOR_VACIO: Borrador = { date: "", name: "", city: "", source: "DECREE" };

export function HolidaysTab({
  canWrite,
  onError,
  onSuccess,
}: {
  canWrite: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const anioActual = new Date().getFullYear();
  const [paises, setPaises] = useState<string[]>([]);
  const [country, setCountry] = useState("Ecuador");
  const [year, setYear] = useState(anioActual);
  const [ciudadFiltro, setCiudadFiltro] = useState("");

  const { holidays, coverage, cities, loading, error, reload } = useHolidays(true, country, year);

  const [form, setForm] = useState<Borrador>(BORRADOR_VACIO);
  const [editando, setEditando] = useState<Holiday | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [precargando, setPrecargando] = useState(false);
  const [aEliminar, setAEliminar] = useState<Holiday | null>(null);
  const [aConfirmar, setAConfirmar] = useState<HolidayCoverage | null>(null);
  const [aQuitarConfirmacion, setAQuitarConfirmacion] = useState<HolidayCoverage | null>(null);

  // Países soportados (sin la fila "Default", que no es un calendario).
  useEffect(() => {
    let vivo = true;
    listSupportedCountries()
      .then((lista) => {
        if (vivo) setPaises(lista.filter((p) => p !== "Default"));
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : "No se pudieron cargar los países");
      });
    return () => {
      vivo = false;
    };
  }, [onError]);

  const anios = useMemo(() => [anioActual - 1, anioActual, anioActual + 1, anioActual + 2], [anioActual]);

  // Con una ciudad elegida se ven los nacionales más los de esa ciudad.
  const filas = useMemo(
    () =>
      ciudadFiltro
        ? holidays.filter((h) => h.city === "" || h.city.toLowerCase() === ciudadFiltro.toLowerCase())
        : holidays,
    [holidays, ciudadFiltro],
  );

  function cambiarPais(nuevo: string) {
    setCountry(nuevo);
    setCiudadFiltro("");
    cancelarEdicion();
  }

  function cancelarEdicion() {
    setEditando(null);
    setForm(BORRADOR_VACIO);
  }

  function editar(h: Holiday) {
    setEditando(h);
    setForm({ date: h.date, name: h.name, city: h.city, source: h.source });
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!ISO_DATE.test(form.date)) {
      onError("Indica la fecha del feriado.");
      return;
    }
    if (!form.name.trim()) {
      onError("Indica el nombre del feriado o decreto.");
      return;
    }
    setGuardando(true);
    try {
      const payload = {
        country,
        city: form.city.trim(),
        date: form.date,
        name: form.name.trim(),
        source: form.source,
      };
      if (editando) {
        await updateHoliday(editando.id, payload);
        onSuccess("Feriado actualizado.");
      } else {
        await createHoliday(payload);
        onSuccess("Feriado agregado. El capacity lo considera desde ya.");
      }
      cancelarEdicion();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar el feriado");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!aEliminar) return;
    const objetivo = aEliminar;
    setAEliminar(null);
    try {
      await deleteHoliday(objetivo.id);
      onSuccess("Feriado eliminado.");
      if (editando?.id === objetivo.id) cancelarEdicion();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar el feriado");
    }
  }

  async function precargar() {
    setPrecargando(true);
    try {
      const r = await generateHolidays({ country, year });
      onSuccess(
        `Precarga de ${country} ${year}: se crearon ${r.created.length} feriados y se omitieron ${r.skipped} que ya existían.`,
      );
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo precargar el año");
    } finally {
      setPrecargando(false);
    }
  }

  async function confirmarAnio() {
    if (!aConfirmar) return;
    const objetivo = aConfirmar;
    setAConfirmar(null);
    try {
      await confirmHolidayYear(objetivo.country, objetivo.year);
      onSuccess(`Calendario ${objetivo.country} ${objetivo.year} confirmado.`);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo confirmar el año");
    }
  }

  async function quitarConfirmacion() {
    if (!aQuitarConfirmacion) return;
    const objetivo = aQuitarConfirmacion;
    setAQuitarConfirmacion(null);
    try {
      await unconfirmHolidayYear(objetivo.country, objetivo.year);
      onSuccess(`Se quitó la confirmación de ${objetivo.country} ${objetivo.year}.`);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo quitar la confirmación");
    }
  }

  return (
    <div className="section-stack">
      <PageHeader
        icon="✺"
        title="Feriados"
        description="Calendario de feriados por país y ciudad que usa el capacity mensual para descontar días hábiles."
      />

      {!canWrite && (
        <div className="notice notice--warning" role="note">
          <div className="notice__title">Solo lectura</div>
          <p className="notice__text">No tiene permiso para modificar los feriados.</p>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <article className="card">
        <div className="field-grid field-grid--compact">
          <div>
            <label className="field-label" htmlFor="feriados-pais">País</label>
            <select
              id="feriados-pais"
              className="select-control"
              value={country}
              onChange={(e) => cambiarPais(e.target.value)}
            >
              {(paises.length > 0 ? paises : [country]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="feriados-anio">Año</label>
            <select
              id="feriados-anio"
              className="select-control"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {anios.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="feriados-ciudad">Ciudad</label>
            <select
              id="feriados-ciudad"
              className="select-control"
              value={ciudadFiltro}
              onChange={(e) => setCiudadFiltro(e.target.value)}
            >
              <option value="">Todas las ciudades</option>
              {cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </article>

      {/* ── Alta rápida (decretos) ───────────────────────────────────────── */}
      {canWrite && (
        <article className="card holiday-quick-add" aria-labelledby="feriados-alta-titulo">
          <div className="card-head">
            <h3 id="feriados-alta-titulo">{editando ? "Editar feriado" : "Agregar feriado o decreto"}</h3>
          </div>
          <p className="field-help">
            Para un decreto de último momento: cárguelo aquí y el capacity lo descuenta de inmediato.
            Se aplica a {country}; deje la ciudad vacía si es nacional.
          </p>
          <form onSubmit={(e) => void guardar(e)} className="field-grid field-grid--compact">
            <div>
              <label className="field-label" htmlFor="feriado-fecha">Fecha *</label>
              <input
                id="feriado-fecha"
                type="date"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="feriado-nombre">Nombre *</label>
              <input
                id="feriado-nombre"
                type="text"
                maxLength={200}
                placeholder="Ej.: Decreto de feriado nacional"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="feriado-ciudad">Ciudad (opcional)</label>
              <input
                id="feriado-ciudad"
                type="text"
                list="feriado-ciudades"
                maxLength={80}
                placeholder="Vacío = nacional"
                value={form.city}
                onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
              />
              <datalist id="feriado-ciudades">
                {cities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="field-label" htmlFor="feriado-origen">Origen</label>
              <select
                id="feriado-origen"
                className="select-control"
                value={form.source}
                onChange={(e) => setForm((p) => ({ ...p, source: e.target.value as HolidaySource }))}
              >
                <option value="DECREE">Decreto</option>
                <option value="MANUAL">Manual</option>
                {editando?.source === "GENERATED" && <option value="GENERATED">Generado</option>}
              </select>
            </div>
            <div className="inline-actions">
              <button type="submit" disabled={guardando}>
                {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Agregar feriado"}
              </button>
              {editando && (
                <button type="button" className="ghost" onClick={cancelarEdicion} disabled={guardando}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </article>
      )}

      {/* ── Cobertura ────────────────────────────────────────────────────── */}
      <article className="card">
        <div className="card-head">
          <h3>Cobertura del calendario</h3>
        </div>
        <p className="field-help">
          Un año sin confirmar enciende la alerta "feriados no confirmados" en el capacity mensual.
          Confirmar un año la apaga: úsalo cuando hayas revisado que el calendario está completo.
        </p>
        {coverage.length === 0 ? (
          <p className="empty-note">No hay países con consultores activos para evaluar.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>País</th>
                  <th>Año</th>
                  <th className="cell-right">Feriados</th>
                  <th>Estado</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={`${c.country}-${c.year}`}>
                    <td className="cell-strong">{c.country}</td>
                    <td>{c.year}</td>
                    <td className="cell-right">{c.holidayCount}</td>
                    <td>
                      {c.confirmed ? (
                        <span
                          className="state-chip state-chip--success"
                          title={c.confirmedAt ? `Confirmado por ${c.confirmedBy ?? "—"} el ${formatDateTime(c.confirmedAt)}` : undefined}
                        >
                          Confirmado
                        </span>
                      ) : (
                        <span className="state-chip state-chip--warning">Sin confirmar</span>
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        {c.confirmed ? (
                          <button type="button" className="ghost btn-sm" onClick={() => setAQuitarConfirmacion(c)}>
                            Quitar confirmación
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={c.holidayCount === 0}
                            title={c.holidayCount === 0 ? "Carga o precarga feriados antes de confirmar" : undefined}
                            onClick={() => setAConfirmar(c)}
                          >
                            Confirmar año
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* ── Listado ──────────────────────────────────────────────────────── */}
      <article className="card">
        <div className="card-head">
          <h3>Feriados de {country} {year}</h3>
          {canWrite && (
            <button type="button" className="ghost" onClick={() => void precargar()} disabled={precargando}>
              {precargando ? "Precargando…" : "Precargar año"}
            </button>
          )}
        </div>

        {loading && holidays.length === 0 ? (
          <p className="loading">Cargando feriados…</p>
        ) : error ? (
          <div className="notice notice--danger" role="alert">
            <div className="notice__title">No se pudieron cargar los feriados</div>
            <p className="notice__text">{error}</p>
            <button type="button" className="ghost btn-sm" onClick={() => void reload()}>
              Reintentar
            </button>
          </div>
        ) : filas.length === 0 ? (
          <p className="empty-note">
            No hay feriados cargados para {country} en {year}.
            {canWrite ? " Usa \"Precargar año\" para traer el calendario oficial." : ""}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Nombre</th>
                  <th>Ámbito</th>
                  <th>Origen</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filas.map((h) => {
                  const origen = ETIQUETA_ORIGEN[h.source];
                  return (
                    <tr key={h.id}>
                      <td className="cell-strong">{formatDate(h.date)}</td>
                      <td>{h.name}</td>
                      <td>{h.city === "" ? "Nacional" : h.city}</td>
                      <td><span className={`state-chip ${origen.chip}`}>{origen.texto}</span></td>
                      {canWrite && (
                        <td>
                          <div className="inline-actions">
                            <button type="button" className="ghost btn-sm" onClick={() => editar(h)}>
                              Editar
                            </button>
                            <button type="button" className="ghost btn-sm" onClick={() => setAEliminar(h)}>
                              Eliminar
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <ConfirmDialog
        open={!!aEliminar}
        title="Eliminar feriado"
        message={`¿Eliminar "${aEliminar?.name}" (${formatDate(aEliminar?.date)})? El capacity recuperará ese día como hábil.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void eliminar()}
        onCancel={() => setAEliminar(null)}
      />
      <ConfirmDialog
        open={!!aConfirmar}
        title="Confirmar año"
        message={`¿Confirmar que el calendario de ${aConfirmar?.country} ${aConfirmar?.year} está completo? Esto apaga la alerta "feriados no confirmados" del capacity mensual para ese año.`}
        confirmLabel="Confirmar año"
        onConfirm={() => void confirmarAnio()}
        onCancel={() => setAConfirmar(null)}
      />
      <ConfirmDialog
        open={!!aQuitarConfirmacion}
        title="Quitar confirmación"
        message={`¿Quitar la confirmación de ${aQuitarConfirmacion?.country} ${aQuitarConfirmacion?.year}? La alerta "feriados no confirmados" volverá a aparecer en el capacity mensual.`}
        confirmLabel="Quitar confirmación"
        onConfirm={() => void quitarConfirmacion()}
        onCancel={() => setAQuitarConfirmacion(null)}
      />
    </div>
  );
}
