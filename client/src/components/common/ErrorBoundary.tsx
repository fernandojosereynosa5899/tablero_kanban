import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Error capturado en render:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleResetStorage = (): void => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Ignorar si el almacenamiento está restringido
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4 py-12 text-slate-100">
          <div className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-800/90 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400/10 border border-amber-400/20">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  Se detectó un detalle en la interfaz
                </h2>
                <p className="text-xs text-slate-400">
                  El sistema capturó el error para proteger tus datos
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs sm:text-sm leading-relaxed text-slate-300">
              No te preocupes: tus actividades y sesiones siguen guardadas de forma segura en PostgreSQL.
              Puedes recargar la página para continuar.
            </p>

            {this.state.error?.message ? (
              <div className="mt-3.5 max-h-28 overflow-y-auto rounded-xl bg-slate-950/70 p-3 font-mono text-[11px] text-rose-300 border border-slate-800">
                {this.state.error.message}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md transition hover:bg-blue-500 active:scale-[0.98]"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Recargar tablero</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetStorage}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white active:scale-[0.98]"
                title="Borra la sesión local y vuelve a iniciar"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Reiniciar sesión</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
