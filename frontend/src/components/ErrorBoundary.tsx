import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Captura los errores de render del árbol que envuelve y muestra una pantalla
 * de error legible en vez de dejar la página en blanco.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-card">
            <h2>Se produjo un error inesperado</h2>
            <p>
              No pudimos mostrar esta pantalla. El error ya quedó registrado en la consola del
              navegador.
            </p>
            <p>
              Puedes intentar de nuevo o recargar la página. Si el problema continúa, avisa al
              equipo de soporte con el detalle que aparece abajo.
            </p>
            {this.state.error?.message && (
              <p className="error-boundary-detail">{this.state.error.message}</p>
            )}
            <div className="error-boundary-actions">
              <button type="button" className="primary" onClick={this.handleReload}>
                Recargar la página
              </button>
              <button type="button" onClick={this.handleRetry}>
                Reintentar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
