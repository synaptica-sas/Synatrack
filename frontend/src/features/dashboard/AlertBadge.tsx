/**
 * Insignia del nivel de consumo de presupuesto de un proyecto.
 *
 * Usa las clases `.status-badge` de `App.css`, construidas sobre los tokens
 * `--state-*`, en vez de colores literales: así hereda el modo oscuro y el
 * contraste ya verificados, y un cambio de paleta no obliga a tocar este
 * archivo.
 *
 * No lleva icono: la etiqueta ("Superado", "Cerca del límite", "En rango") ya es
 * la pista que no depende del color, que es lo que pide la regla de
 * accesibilidad. Ver la convención en `documentacion/DISENO.md`.
 */
const NIVELES = {
  exceeded: { modificador: "danger", texto: "Superado" },
  warning: { modificador: "warning", texto: "Cerca del límite" },
  ok: { modificador: "success", texto: "En rango" },
} as const;

export function AlertBadge({ level }: { level: "ok" | "warning" | "exceeded" }) {
  const nivel = NIVELES[level];
  return (
    <span className={`status-badge status-badge--${nivel.modificador}`}>
      {nivel.texto}
    </span>
  );
}
