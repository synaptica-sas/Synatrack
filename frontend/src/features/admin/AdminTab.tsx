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
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="👤"
        title="Usuarios"
        description="Los usuarios se crean automáticamente al iniciar sesión con Microsoft. Los roles se administran y sincronizan desde Entra ID — aquí puedes consultarlos y activar/desactivar el acceso local."
      />

      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <article className="card" style={{ width: "100%" }}>
          <h3>Usuarios registrados</h3>
          <p className="fx-note">
            Para cambiar el rol de alguien, hazlo en <strong>Entra ID → Aplicaciones empresariales → Synatrack → Usuarios y grupos</strong>.
            El cambio se refleja aquí en su próximo inicio de sesión.
          </p>
          {loading ? (
            <p className="loading">Cargando...</p>
          ) : (
            <div className="table-wrap">
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
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                          {user.roles.map((r) => (
                            <span key={r} className={`role-badge role-${r.toLowerCase()}`} style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem" }}>
                              {roleLabels[r] || r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td><CountryFlag country={user.country} /></td>
                      <td>
                        <span className={`pill ${user.active ? "ok" : "neutral"}`}>{user.active ? "Activo" : "Inactivo"}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button type="button" className="ghost" onClick={() => startEdit(user)} style={{ padding: "0.25rem 0.5rem" }}>
                            Editar
                          </button>
                          <button type="button" onClick={() => void handleToggleActive(user)} style={{ padding: "0.25rem 0.5rem" }}>
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
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.75rem", marginBottom: "1.25rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.2rem", color: "var(--text-strong)" }}>Editar usuario</h2>
              <button type="button" className="ghost" onClick={() => setEditingUser(null)} style={{ fontSize: "1.1rem", padding: "0.2rem 0.5rem", lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleSubmit(e)} className="form-grid" style={{ gap: "1rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong)" }}>Correo electrónico</label>
                <input type="email" value={editingUser.email} disabled style={{ opacity: 0.7 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong)" }}>Nombre completo</label>
                <input
                  placeholder="Nombre"
                  value={form.displayName}
                  onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
                  required
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong)" }}>País</label>
                <select value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}>
                  {supportedCountries.map((c) => (
                    <option key={c} value={c}>{displayCountryWithFlag(c)}</option>
                  ))}
                  {supportedCountries.length === 0 && <option value="Default">{displayCountryWithFlag("Default")}</option>}
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-strong)" }}>Roles</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {editingUser.roles.map((r) => (
                    <span key={r} className={`role-badge role-${r.toLowerCase()}`} style={{ fontSize: "0.75rem", padding: "0.3rem 0.7rem" }}>
                      {roleLabels[r] || r}
                    </span>
                  ))}
                </div>
                <p className="fx-note" style={{ margin: 0 }}>Se gestionan desde Microsoft Entra ID — no editables aquí.</p>
              </div>

              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
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
