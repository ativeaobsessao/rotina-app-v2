import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const BaseComponent = Component as unknown as {
  new (props: Props): {
    props: Props;
    state: State;
    setState: (partial: Partial<State>) => void;
    render(): ReactNode;
  };
};

export class ErrorBoundary extends BaseComponent {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] bg-gray-50 dark:bg-[#09090b] text-gray-900 dark:text-zinc-100 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-white dark:bg-[#121216] border border-gray-200 dark:border-white/[0.08] rounded-3xl p-6 shadow-sm text-center space-y-5">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-bold tracking-tight">Algo inesperado aconteceu</h2>
              <p className="text-sm text-gray-500 dark:text-zinc-400">
                Seus dados salvos no dispositivo continuam protegidos. Você pode tentar continuar ou recarregar o aplicativo.
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Tentar novamente</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#25252e] text-gray-700 dark:text-zinc-200 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recarregar aplicativo</span>
              </button>
            </div>

            <details className="text-left border-t border-gray-100 dark:border-white/[0.08] pt-3">
              <summary className="text-xs font-medium text-gray-400 dark:text-zinc-500 cursor-pointer select-none">
                Detalhes técnicos
              </summary>
              <pre className="mt-2 p-2.5 rounded-xl bg-gray-50 dark:bg-[#1c1c22] text-[11px] text-gray-600 dark:text-zinc-400 overflow-x-auto whitespace-pre-wrap break-words max-h-40">
                {this.state.error ? this.state.error.toString() : 'Erro desconhecido'}
                {this.state.errorInfo?.componentStack ? `\n${this.state.errorInfo.componentStack}` : ''}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
