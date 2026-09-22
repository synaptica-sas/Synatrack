import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBadge } from '../features/dashboard/AlertBadge';

/**
 * Estas pruebas comprobaban el color exacto leyendo `span.style`
 * (`rgb(254, 226, 226)`…). Eso ataba la prueba a la paleta: cambiar un tono la
 * rompía aunque el componente siguiera comunicando lo mismo, y bloqueaba migrar
 * el componente a los tokens del sistema de diseño.
 *
 * Ahora afirman el **contrato real**: qué texto se muestra y con qué estado se
 * pinta. El color concreto de cada estado es responsabilidad de los tokens
 * `--state-*` de `index.css`, y se verifica ahí, no aquí.
 */
describe('AlertBadge', () => {
  it('muestra "En rango" cuando el nivel es ok', () => {
    render(<AlertBadge level="ok" />);
    expect(screen.getByText(/En rango/i)).toBeInTheDocument();
  });

  it('muestra "Superado" cuando el nivel es exceeded', () => {
    render(<AlertBadge level="exceeded" />);
    expect(screen.getByText(/Superado/i)).toBeInTheDocument();
  });

  it('muestra "Cerca del límite" cuando el nivel es warning', () => {
    render(<AlertBadge level="warning" />);
    expect(screen.getByText(/Cerca del límite/i)).toBeInTheDocument();
  });

  it('pinta el estado de peligro cuando se supera el presupuesto', () => {
    const { container } = render(<AlertBadge level="exceeded" />);
    const span = container.firstChild as HTMLElement;
    expect(span).toHaveClass('status-badge', 'status-badge--danger');
  });

  it('pinta el estado correcto cuando está en rango', () => {
    const { container } = render(<AlertBadge level="ok" />);
    const span = container.firstChild as HTMLElement;
    expect(span).toHaveClass('status-badge', 'status-badge--success');
  });

  it('pinta el estado de advertencia cuando se acerca al límite', () => {
    const { container } = render(<AlertBadge level="warning" />);
    const span = container.firstChild as HTMLElement;
    expect(span).toHaveClass('status-badge', 'status-badge--warning');
  });

  it('no usa colores literales: el color viene de la clase, no del atributo style', () => {
    const { container } = render(<AlertBadge level="exceeded" />);
    const span = container.firstChild as HTMLElement;
    expect(span.getAttribute('style')).toBeNull();
  });
});
