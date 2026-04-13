"use client";

import { useResidentZone } from "@/contexts/ResidentZoneContext";
import { cleaningScheduleFromDbJsonb, getNextCleaningStartMs } from "@/lib/cleaning-safety";
import {
  clearParkingSession,
  loadParkingSession,
  PARKING_SESSION_STORAGE_KEY,
  saveParkingSession,
  type ParkingSession,
} from "@/lib/parking-session";
import { useWallClock } from "@/lib/use-wall-clock";
import { subscribeWebPush } from "@/lib/push-client";
import { MapPin } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatSek(amount: number): string {
  return `${amount.toFixed(2)} kr`;
}

/** Compact duration for the mini dashboard (e.g. 0m, 2h 15m). */
function formatMiniDuration(checkedInIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(checkedInIso).getTime());
  const totalM = Math.floor(ms / 60000);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Elapsed since check-in for display when hourly rate is unknown. */
function formatElapsedParking(checkedInIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(checkedInIso).getTime());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function elapsedHours(checkedInIso: string, now: Date): number {
  const t0 = new Date(checkedInIso).getTime();
  return Math.max(0, (now.getTime() - t0) / 3600000);
}

function taxaMatchesResidentZone(taxaName: string | undefined, residentZone: string): boolean {
  if (!taxaName || !residentZone) return false;
  const t = taxaName.trim();
  const z = residentZone.trim();
  const m = t.match(/^Boende\s+(.+)$/i);
  if (!m) return false;
  const key = m[1].trim();
  return key.toLowerCase().startsWith(z.toLowerCase());
}

/** localStorage / JSON may store hourly_rate as string; coalesce for live fee math. */
function coerceHourlyRate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Prefer live schedule parsing; fall back to snapshot `nextCleaningIso`. */
function msUntilNextCleaning(session: ParkingSession, now: Date): number {
  let nextMs: number | null = null;
  const raw = session.cleaningScheduleJson;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const schedule = cleaningScheduleFromDbJsonb(parsed);
      nextMs = getNextCleaningStartMs(now, schedule);
    } catch {
      /* ignore */
    }
  }
  if (nextMs == null) {
    nextMs = new Date(session.nextCleaningIso).getTime();
  }
  return nextMs - now.getTime();
}

type ParkHereBarProps = {
  /** Map overlay: bottom sheet layout; tight card when idle. */
  compact?: boolean;
  /**
   * When the user has placed the map pin (e.g. via locate), check-in uses this point instead of GPS.
   * Drag the pin on the map to adjust before tapping Park Here.
   */
  mapCheckInLngLat?: { lng: number; lat: number } | null;
  /** Map time slider instant — passed to cleaning preview API (Stockholm-relative rules). */
  mapSimulatedAt: Date;
};

type ParkingSpotCleaningPreview = {
  streetName: string;
  nextLabel: string;
};

const sheetShellClass =
  "w-full rounded-xl border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-md dark:border-neutral-600 dark:bg-neutral-900/95";

export default function ParkHereBar({
  compact = false,
  mapCheckInLngLat = null,
  mapSimulatedAt,
}: ParkHereBarProps) {
  const { residentZone } = useResidentZone();
  const [session, setSession] = useState<ParkingSession | null>(null);
  const [checkInResponseDone, setCheckInResponseDone] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [infoText, setInfoText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Cleaning schedule at the chosen point (Park Here), even when map overlay is hidden. */
  const [parkingSpotCleaning, setParkingSpotCleaning] = useState<ParkingSpotCleaningPreview | null>(null);
  /** True when API says no polygon at point (422) — show extra help above the button. */
  const [checkInNoZoneGuide, setCheckInNoZoneGuide] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setSession(loadParkingSession());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key != null && e.key !== PARKING_SESSION_STORAGE_KEY) return;
      setSession(loadParkingSession());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!session) setDetailsOpen(false);
  }, [session]);

  const now = useWallClock();

  const residentBenefit = useMemo(
    () => taxaMatchesResidentZone(session?.taxaName, residentZone),
    [session?.taxaName, residentZone],
  );

  const coercedHourlyRate = useMemo(
    () => (session != null ? coerceHourlyRate(session.hourlyRate) : null),
    [session?.hourlyRate],
  );

  const parkedHours = useMemo(
    () => (session != null ? elapsedHours(session.checkedInAt, now) : 0),
    [session?.checkedInAt, now],
  );

  const estimatedFeeSek = useMemo(() => {
    if (!session) return null;
    if (residentBenefit) return 0;
    const rate = coercedHourlyRate;
    if (rate == null) return null;
    return parkedHours * rate;
  }, [session, residentBenefit, parkedHours, coercedHourlyRate]);

  const cleaningCountdownMs = useMemo(() => {
    if (!session) return null;
    return msUntilNextCleaning(session, now);
  }, [session, now]);

  const onParkHere = useCallback(async () => {
    setCheckInResponseDone(false);
    setLoading(true);
    setErrorText(null);
    setInfoText(null);
    setParkingSpotCleaning(null);
    setCheckInNoZoneGuide(false);
    try {
      const pin = mapCheckInLngLat;
      const useMapPin =
        pin != null && Number.isFinite(pin.lat) && Number.isFinite(pin.lng);
      let lat: number;
      let lng: number;
      if (useMapPin) {
        lat = pin.lat;
        lng = pin.lng;
        if (process.env.NODE_ENV === "development") {
          console.info("[ParkHereBar] check-in using map pin coordinates", { lat, lng });
        }
      } else {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setErrorText("GPS returned invalid coordinates; try again outdoors.");
          return;
        }
        if (process.env.NODE_ENV === "development") {
          console.info("[ParkHereBar] check-in using GPS coordinates", {
            lat,
            lng,
            accuracyMeters: pos.coords.accuracy,
          });
        }
      }
      let subJson: ReturnType<PushSubscription["toJSON"]> | undefined;
      try {
        if ("Notification" in window && Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if ("Notification" in window && Notification.permission === "granted") {
          const sub = await subscribeWebPush();
          if (sub) subJson = sub.toJSON() as ReturnType<PushSubscription["toJSON"]>;
        }
      } catch (pushErr) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[ParkHereBar] push subscription skipped; check-in continues without push", pushErr);
        }
      }

      const atParam = encodeURIComponent(mapSimulatedAt.toISOString());
      const previewUrl = `/api/cleaning-zone-preview?lat=${lat}&lng=${lng}&at=${atParam}`;

      const [res, previewRes] = await Promise.all([
        fetch("/api/parking/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat,
            lng,
            subscription: subJson
              ? {
                  endpoint: subJson.endpoint!,
                  keys: subJson.keys as { p256dh: string; auth: string },
                }
              : undefined,
          }),
        }),
        fetch(previewUrl, { cache: "no-store" }),
      ]);

      const checkInStatus = res.status;

      let previewJson: { found?: boolean; streetName?: string; nextLabel?: string };
      try {
        previewJson = (await previewRes.json()) as typeof previewJson;
      } catch {
        previewJson = { found: false };
      }
      if (
        previewJson.found === true &&
        typeof previewJson.streetName === "string" &&
        typeof previewJson.nextLabel === "string"
      ) {
        setParkingSpotCleaning({
          streetName: previewJson.streetName,
          nextLabel: previewJson.nextLabel,
        });
      }

      let data: {
        ok?: boolean;
        session?: ParkingSession;
        message?: string;
        error?: string;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setErrorText("Invalid response from server");
        return;
      }
      if (!res.ok) {
        const errRaw = data?.error;
        const err =
          typeof errRaw === "string" && errRaw.trim() !== "" ? errRaw.trim() : "Check-in failed";
        const noZone =
          checkInStatus === 422 ||
          /no cleaning zone/i.test(err) ||
          /ingen städ/i.test(err);
        setCheckInNoZoneGuide(noZone);
        setErrorText(err);
        return;
      }
      if (data?.session) {
        saveParkingSession(data.session);
        setSession(data.session);
        if (process.env.NODE_ENV === "development") {
          console.info("[ParkHereBar] check-in session (taxa / fee fields)", {
            taxaName: data.session.taxaName,
            hourlyRate: data.session.hourlyRate,
            streetName: data.session.streetName,
          });
        }
      }
      const msg = data?.message?.trim();
      setInfoText(msg || "Saved.");
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Location or push failed");
    } finally {
      setLoading(false);
      setCheckInResponseDone(true);
    }
  }, [mapCheckInLngLat, mapSimulatedAt]);

  const onEndParking = useCallback(() => {
    clearParkingSession();
    setSession(null);
    setCheckInResponseDone(false);
    setErrorText(null);
    setInfoText(null);
    setParkingSpotCleaning(null);
    setCheckInNoZoneGuide(false);
    setDetailsOpen(false);
  }, []);

  const safeBottom = { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" } as const;

  const expandedSessionDetails = session ? (
    <>
      <div>
        <div className="text-xs text-neutral-600 dark:text-neutral-400">
          Taxa: <span className="text-neutral-800 dark:text-neutral-100">{session.taxaName ?? "—"}</span>
          {coercedHourlyRate != null && (
            <span className="tabular-nums"> · {coercedHourlyRate} kr/h</span>
          )}
        </div>
      </div>

      <div className="grid gap-2 border-t border-neutral-100 pt-2 text-sm dark:border-neutral-700">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Parkeringsavgift · Parking fee (live)
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs text-neutral-600 dark:text-neutral-400">Duration · Tid</span>
          <span className="tabular-nums text-base font-semibold text-neutral-900 dark:text-neutral-50">
            {formatElapsedParking(session.checkedInAt, now)}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs text-neutral-600 dark:text-neutral-400">Est. fee · Beräknad avgift</span>
          <span className="tabular-nums text-base font-semibold text-neutral-900 dark:text-neutral-50">
            {estimatedFeeSek == null ? "—" : formatSek(estimatedFeeSek)}
          </span>
        </div>
        {coercedHourlyRate != null && !residentBenefit && estimatedFeeSek != null && (
          <p className="text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
            <span className="tabular-nums">
              {parkedHours.toFixed(2)} h × {coercedHourlyRate} kr/h
            </span>{" "}
            ≈ <span className="font-medium text-neutral-800 dark:text-neutral-200">{formatSek(estimatedFeeSek)}</span>
            <span className="ml-1 text-neutral-500 dark:text-neutral-500">
              · uppdateras varje sekund / updates every second
            </span>
          </p>
        )}
        {estimatedFeeSek == null && !residentBenefit && (
          <p className="text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
            Ingen timtaxa från databasen för denna punkt. Flytta nålen närmare en taxalinje, säkerställ Supabase-migration för taxa-RPC, eller importera taxa. · No hourly rate from DB; move pin near a tariff line, apply taxa RPC migration on Supabase, or import taxa data.
          </p>
        )}
        {residentBenefit && (
          <p className="text-[11px] leading-snug text-emerald-800 dark:text-emerald-300">
            Din boendezon matchar detta taxaområde — visad avgift är 0 kr (uppskattning). / Your home zone matches
            this tariff area — shown fee is 0 kr (estimate).
          </p>
        )}
      </div>

      <div className="grid gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-700">
        <div className="text-xs text-neutral-600 dark:text-neutral-400">Next cleaning · Nästa städning</div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`tabular-nums text-lg font-semibold ${
              cleaningCountdownMs != null && cleaningCountdownMs < 3600000
                ? "text-amber-700 dark:text-amber-400"
                : "text-neutral-900 dark:text-neutral-50"
            }`}
          >
            {cleaningCountdownMs != null ? formatRemaining(cleaningCountdownMs) : "—"}
          </span>
          {cleaningCountdownMs != null && cleaningCountdownMs <= 0 && (
            <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Due or active · Dags eller pågår
            </span>
          )}
        </div>
      </div>

      <p className="border-t border-neutral-100 pt-2 text-[11px] leading-snug text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
        Notiser · Notifications: om du godkände web push kan servern skicka påminnelser. / If you allowed web push, the
        server can send reminders.
      </p>
    </>
  ) : null;

  const idleCardClass = compact
    ? `${sheetShellClass}`
    : "absolute bottom-0 left-0 right-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur dark:border-neutral-600 dark:bg-neutral-900/95 dark:shadow-[0_-4px_24px_rgba(0,0,0,0.35)]";

  const messagesAndTips = (
    <>
      {compact && mapCheckInLngLat != null && (
        <p className="text-center text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
          Kartnål aktiv — dra den blå nålen för att justera. · Map pin active — drag the blue pin to adjust.
        </p>
      )}
      {compact && mapCheckInLngLat == null && (
        <p className="text-center text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
          Tips: tryck <span className="font-medium text-neutral-600 dark:text-neutral-300">Hitta position</span> (höger), dra nålen till
          parkeringen, sedan Park Here. · Use{" "}
          <span className="font-medium text-neutral-600 dark:text-neutral-300">Find location</span>{" "}
          (right), drag pin to your spot, then Park Here.
        </p>
      )}
      {!session && parkingSpotCleaning && (
        <div
          className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-left text-xs text-neutral-800 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-50"
          role="status"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/90 dark:text-amber-200/90">
            Städning här · Cleaning here
          </div>
          <div className="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">{parkingSpotCleaning.streetName}</div>
          <div className="mt-1 text-[11px] text-neutral-700 dark:text-neutral-300">
            Nästa städning / Next: <span className="tabular-nums">{parkingSpotCleaning.nextLabel}</span>
          </div>
        </div>
      )}
      {checkInResponseDone && !loading && errorText != null && errorText !== "" && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-left shadow-sm dark:border-red-800/60 dark:bg-red-950/50"
          role="alert"
        >
          <div className="text-xs font-semibold text-red-900 dark:text-red-200">Kunde inte checka in · Check-in failed</div>
          <p className="mt-1 text-sm leading-snug text-red-800 dark:text-red-200/90">{errorText}</p>
          {checkInNoZoneGuide && (
            <p className="mt-2 border-t border-red-200/80 pt-2 text-[11px] leading-snug text-red-900/90 dark:border-red-800/50 dark:text-red-200/85">
              Databasen hittar ingen städzon exakt på denna punkt (GPS/nål kan ligga mellan polygoner). Prova att{" "}
              <strong>dra den blå nålen</strong> några meter mot gatan, slå på{" "}
              <strong>Visa städzoner</strong> under kugghjulet för att se linjer, eller flytta närmare en synlig zon. · No
              zone polygon contains this point. Try <strong>dragging the blue pin</strong>, enable{" "}
              <strong>Show Cleaning Zones</strong> in settings, or move onto a visible zone line.
            </p>
          )}
        </div>
      )}
      {checkInResponseDone && !loading && !errorText && infoText != null && infoText !== "" && (
        <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3 py-2 text-center text-xs text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-100">
          {infoText}
        </p>
      )}
    </>
  );

  const primaryActionButton = session ? (
    <button
      type="button"
      disabled={loading}
      onClick={onEndParking}
      className="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
    >
      Stop parking · Avsluta parkering
    </button>
  ) : (
    <button
      type="button"
      disabled={loading}
      onClick={() => void onParkHere()}
      className="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
    >
      <MapPin className="h-4 w-4 shrink-0" aria-hidden />
      Park Here / Parkera här
    </button>
  );

  if (session) {
    const miniFee =
      estimatedFeeSek == null && !residentBenefit ? "—" : formatSek(estimatedFeeSek ?? 0);

    const sessionBody = (
      <div className="mx-auto flex w-full max-w-lg min-w-0 flex-col gap-3 px-3 pt-3 sm:px-4" style={safeBottom}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-50">
              <span className="text-emerald-700 dark:text-emerald-400">Parkerad · Parked</span>
              <span className="text-neutral-400 dark:text-neutral-500"> · </span>
              <span className="break-words">({session.streetName})</span>
            </p>
            <p className="text-xs tabular-nums text-neutral-700 dark:text-neutral-300">
              Tid · Time: {formatMiniDuration(session.checkedInAt, now)}
            </p>
            <p className="text-xs tabular-nums text-neutral-900 dark:text-neutral-100">
              {residentBenefit ? (
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Boendeförmån · Resident benefit —{" "}
                </span>
              ) : null}
              <span className="font-semibold">Avgift · Fee: {miniFee}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? "Stäng · Close" : "Detaljer · Details"}
          </button>
        </div>

        {detailsOpen ? (
          <div className="gpg-park-details-enter max-h-[min(40vh,16rem)] space-y-3 overflow-y-auto overscroll-contain border-t border-neutral-100 pt-3 text-sm dark:border-neutral-700">
            {expandedSessionDetails}
          </div>
        ) : null}

        {primaryActionButton}
      </div>
    );

    if (compact) {
      return (
        <div className={sheetShellClass} data-gpg-park-check-in="1">
          {sessionBody}
        </div>
      );
    }

    return (
      <div className={idleCardClass} style={{ pointerEvents: "none" }}>
        <div className="pointer-events-auto">{sessionBody}</div>
      </div>
    );
  }

  const idleBody = (
    <div className="mx-auto flex w-full max-w-lg min-w-0 flex-col gap-2 px-3 py-3 sm:px-4" style={safeBottom}>
      {messagesAndTips}
      {loading && (
        <p className="text-center text-[11px] text-neutral-500 dark:text-neutral-400" aria-live="polite">
          Kontrollerar plats och städning… · Checking location…
        </p>
      )}
      {primaryActionButton}
    </div>
  );

  if (compact) {
    return (
      <div
        className={`${sheetShellClass} pointer-events-auto max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain`}
        data-gpg-park-check-in="1"
      >
        {idleBody}
      </div>
    );
  }

  return (
    <div
      className={`${idleCardClass} pointer-events-auto max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain`}
      data-gpg-park-check-in="1"
    >
      {idleBody}
    </div>
  );
}
