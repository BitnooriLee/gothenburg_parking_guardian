"use client";

import {
  RESIDENT_ZONE_CODES,
  useResidentZone,
} from "@/contexts/ResidentZoneContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

const GITHUB_URL = "https://github.com/BitnooriLee";

type ResidentZoneModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Resident (Boende) zone picker. Rendered via portal above map chrome.
 */
export default function ResidentZoneModal({ open, onOpenChange }: ResidentZoneModalProps) {
  const { residentZone, setResidentZone, pulseResidentZoneHighlight } = useResidentZone();
  const { preference, setPreference, resolved } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  if (!mounted || typeof document === "undefined") return null;
  if (!open) return null;

  return createPortal(
    <div
      data-gpg-settings-modal="1"
      role="presentation"
      aria-hidden
      className="gpg-modal-backdrop-enter fixed inset-0 z-[100000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="gpg-modal-sheet-enter relative z-[100001] max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
              <div className="relative z-[100001] flex items-start justify-between gap-3">
                <div className="relative z-[100001] min-w-0">
                  <h2
                    id={titleId}
                    className="relative z-[100001] text-sm font-semibold text-neutral-900 dark:text-neutral-50"
                  >
                    Boendeparkering
                  </h2>
                  <p
                    id={descId}
                    className="relative z-[100001] mt-0.5 text-xs text-neutral-700 dark:text-neutral-300"
                  >
                    Resident parking zone — Välj din taxazon för kartan.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="relative z-[100001] rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>

              <label
                htmlFor="gpg-resident-zone"
                className="relative z-[100001] mt-4 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
              >
                Din zon / Your zone
              </label>
              <select
                id="gpg-resident-zone"
                value={residentZone}
                onChange={(e) => setResidentZone(e.target.value)}
                className="relative z-[100001] mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option className="text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" value="">
                  —
                </option>
                {RESIDENT_ZONE_CODES.map((code) => (
                  <option
                    key={code}
                    className="text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    value={code}
                  >
                    {code}
                  </option>
                ))}
              </select>

              <div className="relative z-[100001] mt-4">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Utseende · Appearance
                </p>
                <div
                  className="mt-2 flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-600"
                  role="group"
                  aria-label="Theme — Ljust / Mörkt / Auto"
                >
                  {(
                    [
                      { id: "light" as const, labelSv: "Ljust", labelEn: "Light", Icon: Sun },
                      { id: "dark" as const, labelSv: "Mörkt", labelEn: "Dark", Icon: Moon },
                      { id: "system" as const, labelSv: "Auto", labelEn: "System", Icon: null },
                    ] as const
                  ).map(({ id, labelSv, labelEn, Icon }) => {
                    const active = preference === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPreference(id)}
                        className={`flex min-h-[2.25rem] flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                          active
                            ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500"
                            : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        }`}
                        aria-pressed={active}
                        title={`${labelSv} / ${labelEn}`}
                      >
                        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden /> : null}
                        <span>{labelSv}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {resolved === "dark"
                    ? "Mörkt läge — bra för nattparkering. · Dark — easier at night."
                    : "Ljust läge. · Light mode."}
                </p>
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                className="relative z-[100001] mt-4 w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900"
              >
                Spara / Confirm
              </button>
              <p className="relative z-[100001] mt-3 text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                Ditt val sparas på enheten. / Saved on this device only.
              </p>

              <div className="relative z-[100001] mt-4 border-t border-neutral-100 pt-3 text-center dark:border-neutral-700">
                <p className="text-[10px] leading-snug text-neutral-500 dark:text-neutral-500">
                  Created with ❤️ in Gothenburg
                </p>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-[10px] font-medium text-emerald-700 underline-offset-2 transition hover:underline dark:text-emerald-400"
                >
                  BitnooriLee · GitHub
                </a>
              </div>
      </div>
    </div>,
    document.body,
  );
}
