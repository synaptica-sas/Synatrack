import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../../components/PageHeader";
import { updateProfile, type AuthUser } from "../../services/api";

type ProfileTabProps = {
  authUser: AuthUser | null;
  onRefreshAuth: () => Promise<void>;
  onError: (msg: string) => void;
};

// Predefined tech skills list for autocomplete suggestions
const SUGGESTED_SKILLS = [
  "React", "TypeScript", "JavaScript", "Node.js", "Express", "Fastify", 
  "Prisma", "PostgreSQL", "SQL Server", "MongoDB", "Python", "Django", 
  "C#", ".NET", "Java", "Docker", "AWS", "Git", "Scrum", "QA", 
  "CSS", "TailwindCSS", "Next.js", "Vite", "Angular", "Vue.js"
];

export function ProfileTab({ authUser, onRefreshAuth, onError }: ProfileTabProps) {
  const [displayName, setDisplayName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [bio, setBio] = useState("");
  const [phrase, setPhrase] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  
  // Tag input state
  const [skillInput, setSkillInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Modal state
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [tempPhotoUrl, setTempPhotoUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (authUser) {
      setDisplayName(authUser.displayName || "");
      setPhotoUrl(authUser.photoUrl || "");
      setBio(authUser.bio || "");
      setPhrase(authUser.phrase || "");
      setSkills(authUser.skills || []);
    }
  }, [authUser]);

  // Handle click outside suggestions dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!authUser) {
    return <p className="loading">Inicia sesión para ver tu perfil.</p>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        photoUrl: photoUrl.trim() || null,
        bio: bio.trim() || null,
        phrase: phrase.trim() || null,
        skills,
      });
      await onRefreshAuth();
      setSuccessMsg("¡Perfil actualizado con éxito!");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al actualizar el perfil");
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Skill tags helpers
  const handleAddSkill = (skill: string) => {
    const cleaned = skill.trim();
    if (!cleaned) return;
    if (cleaned.length > 50) {
      onError("La habilidad no puede superar los 50 caracteres");
      return;
    }
    if (!skills.includes(cleaned)) {
      setSkills((prev) => [...prev, cleaned]);
    }
    setSkillInput("");
    setShowSuggestions(false);
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills((prev) => prev.filter((s) => s !== skillToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSkill(skillInput);
    }
  };

  const filteredSuggestions = SUGGESTED_SKILLS.filter(
    (s) => 
      s.toLowerCase().includes(skillInput.toLowerCase()) && 
      !skills.includes(s)
  );

  // Photo helpers
  const openPhotoModal = () => {
    setTempPhotoUrl(photoUrl);
    setIsPhotoModalOpen(true);
  };

  const savePhotoModal = () => {
    setPhotoUrl(tempPhotoUrl);
    setIsPhotoModalOpen(false);
  };

  const handleDeviceUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      onError("La imagen no debe superar los 2MB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setTempPhotoUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="profile-container" style={{ maxWidth: "800px", margin: "0 auto", padding: "1.5rem" }}>
      <PageHeader
        icon="👤"
        title="Mi Perfil de Usuario"
        description="Administra tus datos personales, biografía, mantra personal e información profesional."
      />
      
      {/* 1. MANTRA / FRASE PERSONAL (ZONA SUPERIOR) */}
      <div 
        className="glass-card" 
        style={{ 
          padding: "2rem", 
          borderRadius: "20px", 
          marginBottom: "1.5rem", 
          textAlign: "center",
          border: "1px solid var(--border-color)",
          background: "linear-gradient(135deg, rgba(255,255,255,0.7) 0%, var(--color-primary-05) 100%)",
          boxShadow: "0 8px 32px 0 var(--color-primary-05)"
        }}
      >
        <div style={{ color: "var(--color-accent)", fontSize: "1.5rem", marginBottom: "0.5rem" }}>“</div>
        <h1 
          style={{ 
            fontFamily: "var(--display)", 
            fontSize: "1.6rem", 
            fontWeight: 700, 
            fontStyle: "italic",
            color: "var(--text)", 
            margin: "0 auto",
            lineHeight: 1.4,
            letterSpacing: "-0.01em",
            maxWidth: "600px"
          }}
        >
          {phrase || "Define tu frase motivacional o visión personal en el formulario"}
        </h1>
        <div style={{ color: "var(--color-accent)", fontSize: "1.5rem", marginTop: "0.5rem" }}>”</div>
      </div>

      <div className="card glass-card" style={{ padding: "2.5rem", borderRadius: "20px" }}>
        
        {/* HEADER DE PRESENTACIÓN (Avatar + Info) */}
        <div style={{ display: "flex", alignItems: "center", gap: "2rem", marginBottom: "2.5rem", flexWrap: "wrap" }}>
          
          {/* Avatar Interactivo Moderno con Hover-Overlay */}
          <div 
            style={{ position: "relative", cursor: "pointer" }}
            onClick={openPhotoModal}
            className="avatar-container-hover"
          >
            <div style={{ 
              width: "130px", 
              height: "130px", 
              borderRadius: "50%", 
              overflow: "hidden", 
              display: "grid", 
              placeItems: "center", 
              background: "var(--gradient-accent)", 
              border: "4px solid #fff", 
              boxShadow: "0 8px 24px var(--color-accent-30)", 
              color: "#fff", 
              fontWeight: 800, 
              fontSize: "2.8rem",
              position: "relative"
            }}>
              {photoUrl.trim() ? (
                <img 
                  src={photoUrl} 
                  alt={displayName} 
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}
              <span className="initials">{getInitials(displayName || authUser.email)}</span>
              
              {/* Modern Hover Camera Overlay */}
              <div className="avatar-hover-overlay" style={{
                position: "absolute",
                inset: 0,
                background: "var(--color-primary-80)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                transition: "opacity 0.25s ease",
                color: "#ffffff",
                fontSize: "0.75rem",
                fontWeight: 700,
                gap: "0.25rem"
              }}>
                <span style={{ fontSize: "1.5rem" }}>📷</span>
                <span>Editar foto</span>
              </div>
            </div>
          </div>

          <div>
            <h2 style={{ fontFamily: "var(--display)", fontSize: "1.8rem", color: "var(--text-strong)", margin: 0, fontWeight: 700 }}>
              {displayName || "Tu Nombre"}
            </h2>
            <p style={{ color: "var(--text-soft)", fontSize: "0.9rem", margin: "0.2rem 0" }}>
              {authUser.email}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
              {authUser.roles.map((role) => (
                <span key={role} className="pill neutral" style={{ fontSize: "0.75rem" }}>
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>

        {successMsg && (
          <div style={{ padding: "0.75rem 1rem", background: "var(--color-green-10)", border: "1px solid var(--color-sec-green)", color: "var(--color-sec-green)", borderRadius: "10px", marginBottom: "1.5rem", fontWeight: 600, fontSize: "0.9rem" }}>
            ✓ {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form-grid" style={{ gap: "1.5rem" }}>
          
          {/* 2. DATOS DE PERFIL Y BIOGRAFÍA (ZONA MEDIA) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }} className="responsive-grid">
            <div>
              <label className="form-label" style={{ fontWeight: 700, color: "var(--text-strong)" }}>Nombre para Mostrar</label>
              <input
                type="text"
                required
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ej. Andres Toro"
                className="styled-input"
                style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", fontSize: "0.95rem" }}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontWeight: 700, color: "var(--text-strong)" }}>Mantra / Frase Personal</label>
              <input
                type="text"
                maxLength={250}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Tu visión en una frase corta..."
                className="styled-input"
                style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", fontSize: "0.95rem" }}
              />
            </div>
          </div>

          <div>
            <label className="form-label" style={{ fontWeight: 700, color: "var(--text-strong)" }}>Biografía / Perfil Profesional</label>
            <textarea
              rows={4}
              maxLength={1000}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Cuéntanos un poco sobre ti, tu trayectoria y tus áreas de interés..."
              className="styled-input"
              style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", fontSize: "0.95rem", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            />
          </div>

          {/* 3. SECCIÓN DE HABILIDADES TÉCNICAS (ZONA INFERIOR) */}
          <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem", marginTop: "1rem" }}>
            <label className="form-label" style={{ fontWeight: 700, color: "var(--text-strong)", display: "block", marginBottom: "0.5rem" }}>
              Habilidades Duras / Técnicas
            </label>
            <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", margin: "-0.25rem 0 0.75rem 0" }}>
              Selecciona habilidades sugeridas de la lista o escribe una nueva y presiona Enter.
            </p>

            {/* List of current skills */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {skills.map((skill) => (
                <span 
                  key={skill} 
                  style={{ 
                    display: "inline-flex", 
                    alignItems: "center", 
                    gap: "0.35rem", 
                    background: "var(--color-accent-10)", 
                    color: "var(--text)", 
                    padding: "0.35rem 0.75rem", 
                    borderRadius: "20px", 
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    border: "1px solid var(--color-accent-20)"
                  }}
                >
                  {skill}
                  <button 
                    type="button" 
                    onClick={() => handleRemoveSkill(skill)}
                    style={{ 
                      all: "unset", 
                      cursor: "pointer", 
                      fontSize: "0.75rem", 
                      color: "var(--color-sec-red)", 
                      fontWeight: "bold",
                      padding: "0 2px"
                    }}
                    title={`Remover ${skill}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {skills.length === 0 && (
                <span style={{ fontSize: "0.85rem", color: "var(--text-soft)", fontStyle: "italic" }}>
                  Aún no has agregado ninguna habilidad.
                </span>
              )}
            </div>

            {/* Selector Input Autocomplete */}
            <div style={{ position: "relative" }} ref={dropdownRef}>
              <input
                type="text"
                value={skillInput}
                onChange={(e) => {
                  setSkillInput(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe una habilidad (ej. React) y presiona Enter..."
                className="styled-input"
                style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", fontSize: "0.95rem" }}
              />
              
              {showSuggestions && skillInput.trim() !== "" && filteredSuggestions.length > 0 && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "#fff",
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  boxShadow: "0 8px 16px rgba(0,0,0,0.1)",
                  zIndex: 20,
                  maxHeight: "200px",
                  overflowY: "auto",
                  marginTop: "0.25rem"
                }}>
                  {filteredSuggestions.map((suggestion) => (
                    <div 
                      key={suggestion}
                      onClick={() => handleAddSkill(suggestion)}
                      style={{
                        padding: "0.6rem 1rem",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        color: "var(--text-strong)",
                        transition: "background 0.15s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--color-accent-10)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      {suggestion}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "0.75rem 2rem",
                borderRadius: "10px",
                border: "none",
                background: "var(--gradient-accent)",
                color: "#fff",
                fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
                transition: "transform 0.2s, box-shadow 0.2s",
                boxShadow: "0 4px 12px var(--color-accent-30)",
              }}
            >
              {saving ? "Guardando..." : "Guardar Cambios"}
            </button>
          </div>
        </form>
      </div>

      {/* MODAL ELEGANTE PARA EDICIÓN DE FOTO */}
      {isPhotoModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsPhotoModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3 style={{ margin: "0 0 1.25rem 0", fontSize: "1.2rem", fontWeight: 700 }}>
              Actualizar Foto de Perfil
            </h3>

            {/* Preview inside modal */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
              <div style={{
                width: "110px",
                height: "110px",
                borderRadius: "50%",
                overflow: "hidden",
                background: "var(--gradient-accent)",
                border: "3px solid var(--color-accent-20)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontWeight: 800,
                fontSize: "2.3rem"
              }}>
                {tempPhotoUrl.trim() ? (
                  <img src={tempPhotoUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  getInitials(displayName || authUser.email)
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
              {/* Option 1: File Upload */}
              <div>
                <button
                  type="button"
                  onClick={handleDeviceUploadClick}
                  className="ghost"
                  style={{
                    width: "100%",
                    borderStyle: "dashed",
                    fontWeight: 700,
                    fontSize: "0.9rem"
                  }}
                >
                  📁 Cargar desde dispositivo
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange}
                  accept="image/*"
                  style={{ display: "none" }}
                />
              </div>

              {/* Option 2: Image URL */}
              <div>
                <label className="form-label" style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-soft)" }}>
                  O pega un enlace de imagen (URL)
                </label>
                <input
                  type="url"
                  value={tempPhotoUrl.startsWith("data:") ? "" : tempPhotoUrl}
                  onChange={(e) => setTempPhotoUrl(e.target.value)}
                  placeholder="https://ejemplo.com/foto.jpg"
                />
              </div>
            </div>

            <div className="modal-actions" style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setIsPhotoModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={savePhotoModal}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Styling specific hover states */}
      <style>{`
        .avatar-container-hover:hover .avatar-hover-overlay {
          opacity: 1 !important;
        }
        .avatar-container-hover:hover .initials {
          opacity: 0.1 !important;
        }
      `}</style>
    </div>
  );
}
