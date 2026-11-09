import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SectionLayout } from "../../components/SectionLayout";
import { useCompanies } from "../../hooks/useCompanies";
import {
  createCompany,
  deleteCompany,
  getCompany,
  updateCompany,
  type Company,
  type CompanyDetail,
} from "../../services/api";
import { formatDate } from "../../utils/formatDate";
import { PROJECT_STATUS_LABELS, label } from "../../utils/statusLabels";

/**
 * Gestión de empresas: el catálogo de clientes de los proyectos.
 *
 * El campo «Empresa» de Proyectos es un selector sobre este catálogo. Una
 * empresa con proyectos no se puede eliminar (el backend responde 409): se
 * desactiva, y deja de ofrecerse en el selector sin tocar lo ya registrado.
 * Ocultar los botones sin `companies:write` no protege nada: autoriza el backend.
 */

type Filtro = "active" | "inactive" | "all";

type Borrador = {
  name: string;
  nit: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  active: boolean;
};

const BORRADOR_VACIO: Borrador = {
  name: "",
  nit: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  active: true,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cadena vacía -> `null`, para que el backend limpie el campo. */
function aNulo(valor: string): string | null {
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

/** Valida el borrador; devuelve el mensaje de error o `""` si está bien. */
function validarEmpresa(b: Borrador): string {
  if (!b.name.trim()) return "El nombre de la empresa es obligatorio.";
  if (b.contactEmail.trim() && !EMAIL_RE.test(b.contactEmail.trim())) {
    return "El correo de contacto no tiene un formato válido.";
  }
  return "";
}

function contactoDe(c: Company): string {
  const partes = [c.contactName, c.contactEmail, c.contactPhone].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : "—";
}

function EstadoChip({ activa }: { activa: boolean }) {
  return (
    <span className={activa ? "state-chip state-chip--success" : "state-chip state-chip--neutral"}>
      {activa ? "Activa" : "Inactiva"}
    </span>
  );
}

function DetalleEmpresa({
  companyId,
  onBack,
  onOpenProject,
}: {
  companyId: string;
  onBack: () => void;
  onOpenProject?: (id: string) => void;
}) {
  const [detalle, setDetalle] = useState<CompanyDetail | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDetalle(await getCompany(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la empresa");
    } finally {
      setCargando(false);
    }
  }, [companyId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="section-stack">
      <PageHeader
        icon="▣"
        title={detalle?.name ?? "Empresa"}
        description="Datos de la empresa y proyectos asociados."
      />
      <div>
        <button type="button" className="ghost" onClick={onBack}>← Volver a empresas</button>
      </div>

      {cargando && <p className="loading">Cargando la empresa…</p>}

      {!cargando && error && (
        <div className="notice notice--danger" role="alert">
          <div className="notice__title">No se pudo cargar la empresa</div>
          <p className="notice__text">{error}</p>
          <button type="button" className="ghost btn-sm" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}

      {!cargando && !error && detalle && (
        <>
          <article className="card">
            <dl className="company-detail">
              <div><dt>NIT</dt><dd>{detalle.nit || "Sin NIT"}</dd></div>
              <div><dt>Contacto</dt><dd>{detalle.contactName || "—"}</dd></div>
              <div><dt>Correo</dt><dd>{detalle.contactEmail || "—"}</dd></div>
              <div><dt>Teléfono</dt><dd>{detalle.contactPhone || "—"}</dd></div>
              <div><dt>Estado</dt><dd><EstadoChip activa={detalle.active} /></dd></div>
            </dl>
          </article>

          <article className="card">
            <div className="card-head">
              <h3 className="card-title-tight">Proyectos ({detalle.projects.length})</h3>
            </div>
            {detalle.projects.length === 0 ? (
              <p className="empty-note">Esta empresa todavía no tiene proyectos.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Proyecto</th>
                      <th>Estado</th>
                      <th>País</th>
                      <th>Project Manager</th>
                      <th>Fechas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.projects.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {onOpenProject ? (
                            <button type="button" className="company-link" onClick={() => onOpenProject(p.id)}>
                              {p.name}
                            </button>
                          ) : (
                            <span className="cell-strong">{p.name}</span>
                          )}
                          {p.isInternal && <span className="field-help"> (interno)</span>}
                        </td>
                        <td>{label(PROJECT_STATUS_LABELS, p.status)}</td>
                        <td>{p.country}</td>
                        <td>{p.projectManagerEmail ?? "Sin PM"}</td>
                        <td>{formatDate(p.startDate)} → {formatDate(p.endDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      )}
    </div>
  );
}

export function CompaniesTab({
  canWrite,
  onError,
  onSuccess,
  onOpenProject,
  onCompaniesChanged,
}: {
  canWrite: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** Abre el detalle de un proyecto (mismo mecanismo que Dashboard y Portafolio). */
  onOpenProject?: (id: string) => void;
  /** Aviso a quien cachea proyectos: renombrar una empresa cambia el nombre que muestran. */
  onCompaniesChanged?: () => Promise<void> | void;
}) {
  const [filtro, setFiltro] = useState<Filtro>("active");
  const [busqueda, setBusqueda] = useState("");
  const { companies, loading, error, reload } = useCompanies(true, {
    active: filtro === "all" ? undefined : filtro === "active",
  });

  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [editando, setEditando] = useState<Company | null>(null);
  const [creando, setCreando] = useState(false);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  const [errorForm, setErrorForm] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<Company | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.nit, c.contactName, c.contactEmail, c.contactPhone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [companies, busqueda]);

  function abrirAlta() {
    setBorrador(BORRADOR_VACIO);
    setErrorForm("");
    setEditando(null);
    setCreando(true);
  }

  function abrirEdicion(c: Company) {
    setBorrador({
      name: c.name,
      nit: c.nit ?? "",
      contactName: c.contactName ?? "",
      contactEmail: c.contactEmail ?? "",
      contactPhone: c.contactPhone ?? "",
      active: c.active,
    });
    setErrorForm("");
    setCreando(false);
    setEditando(c);
  }

  function cerrarFormulario() {
    setCreando(false);
    setEditando(null);
    setErrorForm("");
  }

  async function refrescar() {
    await Promise.all([reload(), Promise.resolve(onCompaniesChanged?.())]);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const problema = validarEmpresa(borrador);
    if (problema) {
      setErrorForm(problema);
      return;
    }
    setErrorForm("");
    setGuardando(true);
    const payload = {
      name: borrador.name.trim(),
      nit: aNulo(borrador.nit),
      contactName: aNulo(borrador.contactName),
      contactEmail: aNulo(borrador.contactEmail),
      contactPhone: aNulo(borrador.contactPhone),
      active: borrador.active,
    };
    try {
      if (editando) {
        await updateCompany(editando.id, payload);
        onSuccess(`Empresa "${payload.name}" actualizada.`);
      } else {
        await createCompany(payload);
        onSuccess(`Empresa "${payload.name}" creada.`);
      }
      cerrarFormulario();
      await refrescar();
    } catch (err) {
      // 409 de nombre o NIT duplicado: se muestra dentro del formulario.
      setErrorForm(err instanceof Error ? err.message : "No se pudo guardar la empresa");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActiva(c: Company) {
    setOcupado(c.id);
    try {
      await updateCompany(c.id, { active: !c.active });
      onSuccess(
        c.active
          ? `"${c.name}" ya no aparecerá en el selector de proyectos.`
          : `"${c.name}" vuelve a estar activa.`,
      );
      await refrescar();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cambiar el estado de la empresa");
    } finally {
      setOcupado(null);
    }
  }

  async function borrar(c: Company) {
    setOcupado(c.id);
    try {
      await deleteCompany(c.id);
      onSuccess(`Empresa "${c.name}" eliminada.`);
      await refrescar();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar la empresa");
    } finally {
      setOcupado(null);
    }
  }

  if (detalleId) {
    return (
      <DetalleEmpresa
        companyId={detalleId}
        onBack={() => setDetalleId(null)}
        onOpenProject={onOpenProject}
      />
    );
  }

  const tieneProyectos = (aBorrar?.projectCount ?? 0) > 0;
  const formularioAbierto = creando || editando !== null;

  return (
    <div className="section-stack">
      <PageHeader
        icon="▣"
        title="Gestión de empresas"
        description="Las empresas (clientes) a las que pertenecen los proyectos. Un proyecto se asocia a una empresa de este catálogo."
      />

      <SectionLayout
        title="Empresas"
        extraActions={
          canWrite ? (
            <button type="button" style={{ fontSize: "0.82rem", padding: "0.35rem 0.8rem" }} onClick={abrirAlta}>
              + Nueva empresa
            </button>
          ) : undefined
        }
        table={
          <>
            <div className="proy-filters">
              <input
                type="search"
                aria-label="Buscar empresa"
                placeholder="Buscar por nombre, NIT o contacto"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <select aria-label="Filtrar por estado" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
                <option value="active">Activas</option>
                <option value="inactive">Inactivas</option>
                <option value="all">Todas</option>
              </select>
            </div>

            {loading && companies.length === 0 && <p className="loading">Cargando empresas…</p>}

            {error && (
              <div className="notice notice--danger" role="alert">
                <div className="notice__title">No se pudieron cargar las empresas</div>
                <p className="notice__text">{error}</p>
                <button type="button" className="ghost btn-sm" onClick={() => void reload()}>Reintentar</button>
              </div>
            )}

            {!loading && !error && visibles.length === 0 && (
              <p className="empty-note">
                {companies.length === 0
                  ? "Todavía no hay empresas en esta vista."
                  : "Ninguna empresa coincide con la búsqueda."}
              </p>
            )}

            {visibles.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>NIT</th>
                      <th>Contacto</th>
                      <th className="cell-right">N.º proyectos</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button type="button" className="company-link" onClick={() => setDetalleId(c.id)}>
                            {c.name}
                          </button>
                        </td>
                        <td>{c.nit || "Sin NIT"}</td>
                        <td>{contactoDe(c)}</td>
                        <td className="cell-right">{c.projectCount}</td>
                        <td><EstadoChip activa={c.active} /></td>
                        <td>
                          <div className="inline-actions">
                            <button type="button" className="ghost btn-sm" onClick={() => setDetalleId(c.id)}>
                              Ver detalle
                            </button>
                            {canWrite && (
                              <>
                                <button type="button" className="ghost btn-sm" disabled={ocupado === c.id} onClick={() => abrirEdicion(c)}>
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="ghost btn-sm"
                                  disabled={ocupado === c.id}
                                  onClick={() => void alternarActiva(c)}
                                >
                                  {c.active ? "Desactivar" : "Activar"}
                                </button>
                                <button type="button" className="ghost btn-sm" disabled={ocupado === c.id} onClick={() => setABorrar(c)}>
                                  Eliminar
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        }
      />

      {formularioAbierto && createPortal(
        <div className="modal-overlay" onClick={cerrarFormulario}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editando ? "Editar empresa" : "Nueva empresa"}</h3>
              <button type="button" className="ghost" onClick={cerrarFormulario}>Cerrar</button>
            </div>
            <form className="form-grid" onSubmit={(e) => void guardar(e)} noValidate>
              {errorForm && (
                <div role="alert" className="notice notice--danger span-2">
                  <p className="notice__text">{errorForm}</p>
                </div>
              )}
              <input
                aria-label="Nombre"
                placeholder="Nombre"
                value={borrador.name}
                onChange={(e) => setBorrador((p) => ({ ...p, name: e.target.value }))}
                required
              />
              <input
                aria-label="NIT"
                placeholder="NIT (opcional)"
                value={borrador.nit}
                onChange={(e) => setBorrador((p) => ({ ...p, nit: e.target.value }))}
              />
              <input
                aria-label="Nombre de contacto"
                placeholder="Nombre de contacto (opcional)"
                value={borrador.contactName}
                onChange={(e) => setBorrador((p) => ({ ...p, contactName: e.target.value }))}
              />
              <input
                aria-label="Correo de contacto"
                type="email"
                placeholder="Correo de contacto (opcional)"
                value={borrador.contactEmail}
                onChange={(e) => setBorrador((p) => ({ ...p, contactEmail: e.target.value }))}
              />
              <input
                aria-label="Teléfono de contacto"
                placeholder="Teléfono de contacto (opcional)"
                value={borrador.contactPhone}
                onChange={(e) => setBorrador((p) => ({ ...p, contactPhone: e.target.value }))}
              />
              <label className="proy-check-label">
                <input
                  type="checkbox"
                  className="proy-check-input"
                  checked={borrador.active}
                  onChange={(e) => setBorrador((p) => ({ ...p, active: e.target.checked }))}
                />
                Empresa activa
              </label>
              <div className="modal-actions">
                <button type="submit" disabled={guardando}>
                  {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear empresa"}
                </button>
                <button type="button" className="ghost" onClick={cerrarFormulario}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={!!aBorrar}
        title={tieneProyectos ? "No se puede eliminar la empresa" : "Eliminar empresa"}
        message={
          tieneProyectos
            ? `"${aBorrar?.name}" tiene ${aBorrar?.projectCount} proyecto(s). Para eliminarla primero debes reasignar sus proyectos a otra empresa. ${
                aBorrar?.active
                  ? "Mientras tanto puedes desactivarla: dejará de ofrecerse al crear proyectos, sin borrar nada."
                  : "Ya está inactiva, así que no se ofrece al crear proyectos."
              }`
            : `¿Eliminar la empresa "${aBorrar?.name}"? Esta acción no se puede deshacer.`
        }
        confirmLabel={tieneProyectos ? "Desactivar empresa" : "Eliminar"}
        danger={!tieneProyectos}
        confirmDisabled={tieneProyectos && !aBorrar?.active}
        onConfirm={() => {
          const c = aBorrar;
          setABorrar(null);
          if (!c) return;
          if (c.projectCount > 0) void alternarActiva(c);
          else void borrar(c);
        }}
        onCancel={() => setABorrar(null)}
      />
    </div>
  );
}
