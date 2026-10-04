import React, { Component, ErrorInfo, ReactNode } from 'react';

// v1.73 — First-load-after-deploy resilience.
//
// A tab that was open before a Vercel deploy holds the old index.html, whose
// hashed lazy-chunk names no longer exist on the new deployment. The next
// dynamic `import()` rejects with a chunk-load error. We detect that specific
// failure and auto-reload ONCE (guarded against loops) so the tab picks up the
// fresh HTML + matching chunks, instead of showing "Something went wrong".

const RELOAD_GUARD_KEY = 'fgbmfi_chunk_reload_at';
const RELOAD_GUARD_WINDOW_MS = 10_000;

const isChunkLoadError = (error: any): boolean => {
  if (!error) return false;
  const msg = `${error?.name || ''} ${error?.message || ''} ${String(error)}`.toLowerCase();
  return (
    msg.includes('chunkloaderror') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('failed to fetch dynamically imported module')
  );
};

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
  reloading: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public props: ErrorBoundaryProps;

  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    reloading: false,
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    const chunkError = isChunkLoadError(error);
    let recentlyReloaded = false;
    if (chunkError) {
      try {
        const last = parseInt(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0', 10);
        recentlyReloaded = Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_WINDOW_MS;
      } catch { /* ignore */ }
    }
    return {
      hasError: true,
      error,
      reloading: chunkError && !recentlyReloaded,
    };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    if (this.state.reloading) {
      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      } catch { /* ignore */ }
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.reloading) {
        return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6 shadow-xl"></div>
            <h2 className="text-lg font-black text-blue-900 uppercase tracking-widest">A new version is available</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-3">Reloading…</p>
          </div>
        );
      }
      return (
        <div className="p-8 text-center bg-red-50 text-red-800 min-h-screen flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-4">Something went wrong.</h2>
          <p className="mb-4">The application encountered a critical error.</p>
          <pre className="bg-white p-4 rounded border text-xs text-left overflow-auto max-w-lg mb-4">
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-600 text-white rounded-lg font-bold"
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children || null;
  }
}
