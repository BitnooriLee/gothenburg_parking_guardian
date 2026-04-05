"use client";

import {
  RESIDENT_ZONE_CODES,
  useResidentZone,
} from "@/contexts/ResidentZoneContext";
import { X } from "lucide-react";
import { useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";

type ResidentZoneModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Resident (Boende) zone picker. Rendered via portal above map chrome.
 */
export default function ResidentZoneModal({ open, onOpenChange }: ResidentZoneModalProps) {
  const { residentZone, setResidentZone, pulseResidentZoneHighlight } = useResidentZone();

  const handleConfirm = useCallback(() => {
    pulseResidentZoneHighlight();
    onOpenChange(false);
  }, [onOpenChange, pulseResidentZoneHighlight]);
  const titleId = useId();
  const descId = useId();

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onKeyDown]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
      <div
        data-gpg-settings-modal="1"
        className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onOpenChange(false);
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
              onClick={() => onOpenChange(false)}
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
          <button
            type="button"
            onClick={handleConfirm}
            className="relative z-[100001] mt-4 w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            Spara / Confirm
          </button>
          <p className="relative z-[100001] mt-3 text-[11px] leading-snug text-neutral-900">
            Ditt val sparas på enheten. / Saved on this device only.
          </p>
        </div>
      </div>,
      document.body,
    );
}
