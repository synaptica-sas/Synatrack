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
    <div className="profile-page">
      <PageHeader
        icon="👤"
        title="Mi Perfil de Usuario"
        description="Administra tus datos personales, biografía, mantra personal e información profesional."
      />

      {/* 1. MANTRA / FRASE PERSONAL (ZONA SUPERIOR) */}
      <div className="profile-mantra">
        <div className="profile-mantra__quote" aria-hidden="true">“</div>
        <h1 className="profile-mantra__text">
          {phrase || "Define tu frase motivacional o visión personal en el formulario"}
        </h1>
        <div className="profile-mantra__quote" aria-hidden="true">”</div>
      </div>

      <div className="card profile-card">

        {/* HEADER DE PRESENTACIÓN (Avatar + Info) */}
        <div className="profile-head">

          {/* Avatar interactivo: el overlay de cámara aparece al pasar el ratón o al enfocar */}
          <button
            type="button"
            className="profile-avatar"
            onClick={openPhotoModal}
            title="Editar foto de perfil"
          >
            {photoUrl.trim() ? (
              <img
                src={photoUrl}
                alt={displayName}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : null}
            <span className="profile-avatar__initials">{getInitials(displayName || authUser.email)}</span>

            <span className="profile-avatar__overlay">
              <span className="profile-avatar__overlay-icon" aria-hidden="true">📷</span>
              <span>Editar foto</span>
            </span>
          </button>

          <div className="profile-identity">
            <h2 className="profile-identity__name">
              {displayName || "Tu Nombre"}
            </h2>
            <p className="profile-identity__email">
              {authUser.email}
            </p>
            <div className="profile-identity__roles">
              {authUser.roles.map((role) => (
                <span key={role} className="state-chip state-chip--info">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>

        {successMsg && (
          <div className="inline-success" role="status">
            ✓ {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="profile-form">

          {/* 2. DATOS DE PERFIL Y BIOGRAFÍA (ZONA MEDIA) */}
          <div className="profile-form__row">
            <div className="field-stack">
              <label className="field-label" htmlFor="perfil-nombre">Nombre para Mostrar</label>
              <input
                id="perfil-nombre"
                type="text"
                required
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ej. Andres Toro"
              />
            </div>

            <div className="field-stack">
              <label className="field-label" htmlFor="perfil-mantra">Mantra / Frase Personal</label>
              <input
                id="perfil-mantra"
                type="text"
                maxLength={250}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Tu visión en una frase corta..."
              />
            </div>
          </div>

          <div className="field-stack">
            <label className="field-label" htmlFor="perfil-bio">Biografía / Perfil Profesional</label>
            <textarea
              id="perfil-bio"
              rows={4}
              maxLength={1000}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Cuéntanos un poco sobre ti, tu trayectoria y tus áreas de interés..."
            />
          </div>

          {/* 3. SECCIÓN DE HABILIDADES TÉCNICAS (ZONA INFERIOR) */}
          <div className="profile-section">
            <label className="field-label" htmlFor="perfil-habilidad">
              Habilidades Duras / Técnicas
            </label>
            <p className="field-help">
              Selecciona habilidades sugeridas de la lista o escribe una nueva y presiona Enter.
            </p>

            {/* List of current skills */}
            <div className="skill-chips">
              {skills.map((skill) => (
                <span key={skill} className="skill-chip">
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="skill-chip__remove"
                    title={`Remover ${skill}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {skills.length === 0 && (
                <span className="skill-empty">
                  Aún no has agregado ninguna habilidad.
                </span>
              )}
            </div>

            {/* Selector Input Autocomplete */}
            <div className="skill-picker" ref={dropdownRef}>
              <input
                id="perfil-habilidad"
                type="text"
                value={skillInput}
                onChange={(e) => {
                  setSkillInput(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe una habilidad (ej. React) y presiona Enter..."
              />

              {showSuggestions && skillInput.trim() !== "" && filteredSuggestions.length > 0 && (
                <ul className="skill-suggestions">
                  {filteredSuggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        className="skill-suggestions__item"
                        onClick={() => handleAddSkill(suggestion)}
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="profile-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar Cambios"}
            </button>
          </div>
        </form>
      </div>

      {/* MODAL ELEGANTE PARA EDICIÓN DE FOTO */}
      {isPhotoModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsPhotoModalOpen(false)}>
          <div className="modal-card modal-card--sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="profile-modal__title">
              Actualizar Foto de Perfil
            </h3>

            {/* Preview inside modal */}
            <div className="profile-preview">
              {tempPhotoUrl.trim() ? (
                <img src={tempPhotoUrl} alt="Vista previa de la foto de perfil" />
              ) : (
                getInitials(displayName || authUser.email)
              )}
            </div>

            <div className="profile-modal__options">
              {/* Option 1: File Upload */}
              <div>
                <button
                  type="button"
                  onClick={handleDeviceUploadClick}
                  className="ghost profile-modal__upload"
                >
                  📁 Cargar desde dispositivo
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="profile-modal__file"
                />
              </div>

              {/* Option 2: Image URL */}
              <div className="field-stack">
                <label className="field-label" htmlFor="perfil-foto-url">
                  O pega un enlace de imagen (URL)
                </label>
                <input
                  id="perfil-foto-url"
                  type="url"
                  value={tempPhotoUrl.startsWith("data:") ? "" : tempPhotoUrl}
                  onChange={(e) => setTempPhotoUrl(e.target.value)}
                  placeholder="https://ejemplo.com/foto.jpg"
                />
              </div>
            </div>

            <div className="modal-actions">
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
    </div>
  );
}
