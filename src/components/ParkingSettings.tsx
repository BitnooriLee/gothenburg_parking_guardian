"use client";

import {
  RESIDENT_ZONE_CODES,
  useResidentZone,
} from "@/contexts/ResidentZoneContext";
import { Settings, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Gear: direct sibling of map root. Modal content is rendered via createPortal(..., document.body)
 * so it mounts at the end of <body>, above the React root and map floats (z-[100000] overlay).
 */
export default function ParkingSettings() {
  const { residentZone, setResidentZone, showCleaningZones, setShowCleaningZones } = useResidentZone();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onKeyDown]);

  const modal =
    open &&
    mounted &&
    createPortal(
      <div
        data-gpg-settings-modal="1"
        className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="relative z-[100001] max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="relative z-[100001] flex items-start justify-between gap-3">
            <div className="relative z-[100001] min-w-0">
              <h2
                id={titleId}
                className="relative z-[100001] text-sm font-semibold text-neutral-900"
              >
                Boendeparkering
              </h2>
              <p
                id={descId}
                className="relative z-[100001] mt-0.5 text-xs text-neutral-900"
              >
                Resident parking zone — Välj din taxazon för kartan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="relative z-[100001] rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <label
            htmlFor="gpg-resident-zone"
            className="relative z-[100001] mt-4 block text-xs font-medium text-neutral-900"
          >
            Din zon / Your zone
          </label>
          <select
            id="gpg-resident-zone"
            value={residentZone}
            onChange={(e) => setResidentZone(e.target.value)}
            className="relative z-[100001] mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option className="text-neutral-900" value="">
              —
            </option>
            {RESIDENT_ZONE_CODES.map((code) => (
              <option key={code} className="text-neutral-900" value={code}>
                {code}
              </option>
            ))}
          </select>
          <p className="relative z-[100001] mt-3 text-[11px] leading-snug text-neutral-900">
            Ditt val sparas på enheten. / Saved on this device only.
          </p>

          <label className="relative z-[100001] mt-5 flex cursor-pointer items-start gap-3 border-t border-neutral-100 pt-4">
            <input
              type="checkbox"
              checked={showCleaningZones}
              onChange={(e) => setShowCleaningZones(e.target.checked)}
              className="relative z-[100001] mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
              aria-label="Visa städzoner (Show Cleaning Zones)"
            />
            <span className="text-xs font-medium leading-snug text-neutral-900">
              Visa städzoner (Show Cleaning Zones)
            </span>
          </label>
          <p className="relative z-[100001] mt-2 text-[10px] leading-snug text-neutral-500">
            Avstängd: kartan är enklare. Städning visas ändå när du parkerar eller trycker på kartan. · Off: simpler map;
            cleaning still shown when you park or tap the map.
          </p>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="gpg-map-float gpg-parking-settings-toggle pointer-events-auto fixed right-4 z-[10060] flex cursor-pointer items-center justify-center rounded-md border border-neutral-200 bg-white p-2.5 text-neutral-800 shadow-lg transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        aria-label="Parking settings — Parkering"
        title="Parking settings"
      >
        <Settings className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </button>
      {modal}
    </>
  );
}
