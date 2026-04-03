"use client";

/**
 * Loads CleaningSafetyMap only in the browser (same effect as next/dynamic(..., { ssr: false })).
 * Renders a real DOM node immediately so DevTools always shows #gpg-map-shell / #gpg-map-loading
 * while the lazy chunk downloads; surfaces chunk import failures on screen.
 */
import { useEffect, useState, type ComponentType } from "react";

export function MapSection() {
  const [MapComp, setMapComp] = useState<ComponentType | null>(null);
  const [chunkError, setChunkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@/components/CleaningSafetyMap")
      .then((m) => {
        if (!cancelled) setMapComp(() => m.default);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setChunkError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (chunkError) {
    return (
      <div
        id="gpg-map-chunk-error"
        className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#F9FAFB] px-6 text-center"
        data-gpg-map-status="chunk-error"
      >
        <p className="text-sm font-medium text-red-700">Map bundle failed to load</p>
        <p className="max-w-lg text-xs text-neutral-600">{chunkError}</p>
        <p className="text-xs text-neutral-500">Check the Network tab for failed JS chunks and reload.</p>
      </div>
    );
  }

  if (!MapComp) {
    return (
      <div
        id="gpg-map-loading"
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#F9FAFB] px-6"
        data-gpg-map-status="loading-chunk"
      >
        <div className="h-4 w-40 animate-pulse rounded bg-neutral-200" />
        <div className="h-64 w-full max-w-lg animate-pulse rounded-xl bg-neutral-200/90" />
        <p className="text-xs text-neutral-500">Loading map…</p>
      </div>
    );
  }

  return (
    <div
      id="gpg-map-shell"
      className="flex h-screen w-screen min-h-0 flex-col"
      data-gpg-map-status="ready"
    >
      <MapComp />
    </div>
  );
}
