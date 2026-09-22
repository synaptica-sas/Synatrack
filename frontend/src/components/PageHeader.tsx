import React from "react";

interface PageHeaderProps {
  icon: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}

/**
 * Encabezado común a las 16 pantallas.
 *
 * Sin estilos en línea y sin colores literales: todo vive en las clases
 * `.page-header*` de `App.css`, construidas solo con tokens. Antes traía un
 * marrón incrustado como respaldo de `--text-strong` que no es de la paleta de
 * Synaptica y que en modo oscuro dejaba el título marrón sobre fondo navy.
 *
 * El icono es decorativo —el título ya nombra la pantalla—, así que se oculta
 * a los lectores de pantalla en vez de leerse como un glifo suelto.
 */
export function PageHeader({ icon, title, description, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header__text">
        <h2 className="page-header__title">
          <span className="page-header__icon" aria-hidden="true">{icon}</span>
          <span>{title}</span>
        </h2>
        <p className="page-header__description">{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
