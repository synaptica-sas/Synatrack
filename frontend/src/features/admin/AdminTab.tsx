import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../../components/PageHeader";
import { updateAdminUser, listSupportedCountries, type AdminUser, type AppRole } from "../../services/api";
import { displayCountryWithFlag } from "../../utils/statusLabels";
import { CountryFlag } from "../../components/CountryFlag";

const roleLabels: Record<AppRole, string> = {
  ADMIN: "Admin",
  PM: "PM",
  CONSULTANT: "Consultor",
  FINANCE: "Financiero",
  VIEWER: "Lector",
};

/**
 * Panel de usuarios — de solo consulta para roles y acceso, ya que el sistema
 * depende únicamente de Microsoft Entra ID como fuente de verdad: los roles
 * se sincronizan (y se sobrescriben) automáticamente en cada inicio de sesión,
 * así que editarlos aquí no tendría efecto duradero. Lo único que sigue
 * siendo una acción local real es activar/desactivar el acceso, y editar
 * datos que Entra ID no vuelve a tocar después del primer login (nombre, país).
 */
export function AdminTab({
  adminUsers,
  loading,
  onReload,
  onError,
}: {
  adminUsers: AdminUser[];
  loading: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ displayName: "", country: "Default" });
  const [submitting, setSubmitting] = useState(false);

  const [supportedCountries, setSupportedCountries] = useState<string[]>([]);
  useEffect(() => {
    void listSupportedCountries().then(setSupportedCountries).catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    try {
      await updateAdminUser(editingUser.id, {
        displayName: form.displayName,
        country: form.country === "Default" ? null : form.country,
      });
      setEditingUser(null);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar el usuario");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    try {
      await updateAdminUser(user.id, { active: !user.active });
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cambiar el estado del usuario");
    }
  }

  function startEdit(user: AdminUser) {
    setEditingUser(user);
    setForm({ displayName: user.displayName, country: user.country || "Default" });
  }

  return (
    <div className="page-stack">
      <PageHeader
        icon="👤"
        title="Usuarios"
        description="Los usuarios se crean automáticamente al iniciar sesión con Microsoft. Los roles se administran y sincronizan desde Entra ID — aquí puedes consultarlos y activar/desactivar el acceso local."
      />

      <section className="section-stack">
        <article className="card">
          <h3>Usuarios registrados</h3>
          <p className="fx-note">
            Para cambiar el rol de alguien, hazlo en <strong>Entra ID → Aplicaciones empresariales → Synatrack → Usuarios y grupos</strong>.
            El cambio se refleja aquí en su próximo inicio de sesión.
          </p>
          {loading ? (
            <p className="loading">Cargando...</p>
          ) : (
            <div className="table-wrap table-wrap--spaced">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Roles (Entra ID)</th>
                    <th>País</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((user) => (
                    <tr key={user.id}>
                      <td>{user.displayName}</td>
                      <td>{user.email}</td>
                      <td>
                        <div className="tag-list">
                          {user.roles.map((r) => (
                            <span key={r} className={`role-badge role-badge--sm role-${r.toLowerCase()}`}>
                              {roleLabels[r] || r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td><CountryFlag country={user.country} /></td>
                      <td>
                        <span className={`state-chip ${user.active ? "state-chip--success" : "state-chip--neutral"}`}>
                          {user.active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button type="button" className="ghost btn-sm" onClick={() => startEdit(user)}>
                            Editar
                          </button>
                          <button type="button" className="btn-sm" onClick={() => void handleToggleActive(user)}>
                            {user.active ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      {/* Modal de edición: solo nombre, país y estado — nunca roles */}
      {editingUser && createPortal(
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-card admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header modal-header--rule">
              <h2 className="modal-title">Editar usuario</h2>
              <button type="button" className="ghost modal-close" onClick={() => setEditingUser(null)}>
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleSubmit(e)} className="form-grid form-grid--tight">
              <div className="field-stack">
                <label className="field-label" htmlFor="admin-correo">Correo electrónico</label>
                <input id="admin-correo" type="email" value={editingUser.email} disabled className="input-readonly" />
              </div>
              <div className="field-stack">
                <label className="field-label" htmlFor="admin-nombre">Nombre completo</label>
                <input
                  id="admin-nombre"
                  placeholder="Nombre"
                  value={form.displayName}
                  onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
                  required
                />
              </div>
              <div className="field-stack">
                <label className="field-label" htmlFor="admin-pais">País</label>
                <select id="admin-pais" value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}>
                  {supportedCountries.map((c) => (
                    <option key={c} value={c}>{displayCountryWithFlag(c)}</option>
                  ))}
                  {supportedCountries.length === 0 && <option value="Default">{displayCountryWithFlag("Default")}</option>}
                </select>
              </div>

              <div className="field-stack">
                <span className="field-label">Roles</span>
                <div className="tag-list">
                  {editingUser.roles.map((r) => (
                    <span key={r} className={`role-badge role-${r.toLowerCase()}`}>
                      {roleLabels[r] || r}
                    </span>
                  ))}
                </div>
                <p className="field-help">Se gestionan desde Microsoft Entra ID — no editables aquí.</p>
              </div>

              <div className="modal-actions modal-actions--rule">
                <button type="button" className="ghost" onClick={() => setEditingUser(null)} disabled={submitting}>
                  Cancelar
                </button>
                <button type="submit" disabled={submitting}>
                  {submitting ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
