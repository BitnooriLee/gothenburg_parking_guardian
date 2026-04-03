"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = { hasError: boolean };

/**
 * Catches render/runtime errors in the map subtree so a single bad layer or data edge case does not white-screen the app.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[MapErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#F9FAFB] px-6 text-center">
            <p className="text-sm font-medium text-neutral-800">Kartan kunde inte laddas / Map failed to load</p>
            <p className="max-w-md text-xs text-neutral-600">Reload the page or try again later.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Reload
            </button>
          </div>
        )
      );
    }
    return <div className="h-screen w-screen min-h-0">{this.props.children}</div>;
  }
}
