"use client";

import ResidentZoneModal from "@/components/ResidentZoneModal";
import { useResidentZone } from "@/contexts/ResidentZoneContext";
import { Calendar, Settings } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

const SLIDER_MIN = -48;
const SLIDER_MAX = 120;
const SLIDER_STEP = 0.25;

const MAP_CHROME_TOP_OFFSET =
  "max(6.25rem, calc(5.25rem + env(safe-area-inset-top, 0px)))";

/** Shared chrome for top-right settings toggles (width + radius + shadow). */
const MAP_SETTINGS_BUTTON_BASE =
  "gpg-map-float pointer-events-auto flex h-auto min-h-[2.75rem] w-32 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium shadow-md backdrop-blur-md transition focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:border-neutral-600/90 dark:bg-neutral-900/88 dark:text-neutral-100 dark:backdrop-blur-md";

type MapControlsProps = {
  offsetHours: number;
  setOffsetHours: (hours: number) => void;
  parkHereBar: ReactNode;
};

function formatOffsetLabel(h: number): string {
  const sign = h >= 0 ? "+" : "";
  return `${sign}${h.toFixed(1)}h`;
}

/** Top-right: Min zon + Städschema (fixed width, vertical stack, right-4). */
function MapChromeTopRight({
  onOpenZoneModal,
  showCleaningZones,
  onToggleCleaning,
  residentZone,
}: {
  onOpenZoneModal: () => void;
  showCleaningZones: boolean;
  onToggleCleaning: () => void;
  residentZone: string;
}) {
  const zoneSet = Boolean(residentZone?.trim());

  return (
    <div
      className="pointer-events-none fixed right-4 z-[10060] flex flex-col items-stretch gap-2"
      style={{ top: MAP_CHROME_TOP_OFFSET }}
      data-gpg-map-controls-cluster="1"
    >
      <button
        type="button"
        data-gpg-map-control="zone"
        onClick={onOpenZoneModal}
        className={`${MAP_SETTINGS_BUTTON_BASE} border-neutral-200/90 bg-white/85 text-neutral-800 hover:bg-white dark:hover:bg-neutral-800/95`}
        aria-label={
          zoneSet
            ? `Boendezon ${residentZone} — Resident zone ${residentZone}`
            : "Zoninställning — Zone settings (Boende)"
        }
        title={zoneSet ? `Zon ${residentZone} / Zone ${residentZone}` : "Zoninställning / Zone settings"}
      >
        <Settings
          className="h-4 w-4 shrink-0 text-neutral-600 dark:text-neutral-400"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1 overflow-hidden leading-tight">
          {zoneSet ? (
            <>
              <span className="block truncate text-xs font-medium tabular-nums">
                Zon: {residentZone}
              </span>
              <span className="mt-0.5 block truncate text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                Zone: {residentZone}
              </span>
            </>
          ) : (
            <>
              <span className="block truncate text-xs font-medium">Zoninställning</span>
              <span className="mt-0.5 block truncate text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                Zone setup
              </span>
            </>
          )}
        </span>
      </button>

      <button
        type="button"
        data-gpg-map-control="cleaning"
        onClick={onToggleCleaning}
        aria-pressed={showCleaningZones}
        aria-label={
          showCleaningZones
            ? "Dölj städschema — Hide cleaning schedule"
            : "Visa städschema — Show cleaning schedule"
        }
        title={
          showCleaningZones
            ? "Städschema på · tryck för att dölja / On — tap to hide"
            : "Städschema av · tryck för att visa / Off — tap to show"
        }
        className={`${MAP_SETTINGS_BUTTON_BASE} ${
          showCleaningZones
            ? "border-emerald-300/90 bg-white/85 text-emerald-900 ring-1 ring-emerald-500/25 hover:bg-emerald-50/90 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-400/20 dark:hover:bg-emerald-950/70"
            : "border-neutral-200/90 bg-white/85 text-neutral-800 hover:bg-white dark:hover:bg-neutral-800/95"
        }`}
      >
        <Calendar
          className={`h-4 w-4 shrink-0 ${
            showCleaningZones ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-400"
          }`}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 leading-tight">
          Städschema
          <span className="mt-0.5 block text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
            Cleaning schedule
          </span>
        </span>
      </button>
    </div>
  );
}

/** Bottom-center: time slider (optional) + Park Here bar; gap + bottom inset so nothing clips the safe area. */
function MapChromeBottomCenter({
  showCleaningZones,
  offsetHours,
  setOffsetHours,
  parkHereBar,
}: {
  showCleaningZones: boolean;
  offsetHours: number;
  setOffsetHours: (hours: number) => void;
  parkHereBar: ReactNode;
}) {
  const sliderPct = useMemo(() => {
    const span = SLIDER_MAX - SLIDER_MIN;
    if (span <= 0) return 0;
    return ((offsetHours - SLIDER_MIN) / span) * 100;
  }, [offsetHours]);

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-[10000] flex flex-col items-stretch gap-4"
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
      }}
      data-gpg-map-bottom-stack="1"
    >
      {showCleaningZones ? (
        <div className="pointer-events-auto flex w-full justify-center px-3 gpg-time-slider-panel-enter">
          <div
            className="gpg-map-float h-auto w-full max-w-md rounded-xl border border-neutral-200 bg-white/95 px-3 pb-4 pt-3 shadow-lg backdrop-blur-md dark:border-neutral-600 dark:bg-neutral-900/95"
            data-gpg-float="time-slider"
          >
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[10px] font-medium leading-tight text-neutral-800 dark:text-neutral-100">
                Nu
                <span className="block font-normal text-neutral-500 dark:text-neutral-400">Now</span>
              </span>
              <div className="relative min-h-0 min-w-0 flex-1 pb-1 pt-5">
                <div
                  className="gpg-time-slider-thumb-label pointer-events-none absolute top-0 z-10 min-w-[3.25rem] -translate-x-1/2 rounded-md border border-emerald-200 bg-emerald-600 px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-white shadow-md dark:border-emerald-400/40"
                  style={{ left: `${sliderPct}%` }}
                >
                  {formatOffsetLabel(offsetHours)}
                </div>
                  <input
                    type="range"
                    min={SLIDER_MIN}
                    max={SLIDER_MAX}
                    step={SLIDER_STEP}
                    value={offsetHours}
                    onChange={(e) => setOffsetHours(Number(e.target.value))}
                    className="gpg-time-slider-input min-h-[1.25rem] w-full"
                    aria-valuemin={SLIDER_MIN}
                    aria-valuemax={SLIDER_MAX}
                    aria-valuenow={offsetHours}
                    aria-label="Simulated time offset hours"
                  />
              </div>
              <span className="w-[3.75rem] shrink-0 text-right text-[10px] font-medium leading-tight text-neutral-800 dark:text-neutral-100">
                Se framåt
                <span className="block font-normal text-neutral-500 dark:text-neutral-400">Ahead</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}
      <div className="gpg-map-float pointer-events-auto w-full min-w-0 px-3" data-gpg-float="park-here">
        {parkHereBar}
      </div>
    </div>
  );
}

export default function MapControls({
  offsetHours,
  setOffsetHours,
  parkHereBar,
}: MapControlsProps) {
  const { showCleaningZones, setShowCleaningZones, residentZone } = useResidentZone();
  const [zoneModalOpen, setZoneModalOpen] = useState(false);

  const toggleCleaning = useCallback(() => {
    if (showCleaningZones) {
      setOffsetHours(0);
    }
    setShowCleaningZones(!showCleaningZones);
  }, [showCleaningZones, setShowCleaningZones, setOffsetHours]);

  return (
    <>
      <ResidentZoneModal open={zoneModalOpen} onOpenChange={setZoneModalOpen} />

      {/* Slight map dim while cleaning schedule is on — safety line colors read clearer (below other chrome via z-[1]). */}
      {showCleaningZones ? (
        <div
          className="pointer-events-none absolute inset-0 z-[1] bg-black/25 transition-colors duration-200"
          aria-hidden
        />
      ) : null}

      <MapChromeTopRight
        onOpenZoneModal={() => setZoneModalOpen(true)}
        showCleaningZones={showCleaningZones}
        onToggleCleaning={toggleCleaning}
        residentZone={residentZone}
      />

      <MapChromeBottomCenter
        showCleaningZones={showCleaningZones}
        offsetHours={offsetHours}
        setOffsetHours={setOffsetHours}
        parkHereBar={parkHereBar}
      />
    </>
  );
}
