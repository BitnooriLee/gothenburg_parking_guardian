"use client";

import { useResidentZone } from "@/contexts/ResidentZoneContext";
import { cleaningScheduleFromDbJsonb, getNextCleaningStartMs } from "@/lib/cleaning-safety";
import {
  clearParkingSession,
  loadParkingSession,
  saveParkingSession,
  type ParkingSession,
} from "@/lib/parking-session";
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
  return taxaName.trim() === `Boende ${residentZone.trim()}`;
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
  /** Map overlay: no full-width dock; tight card when idle. */
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

export default function ParkHereBar({
  compact = false,
  mapCheckInLngLat = null,
  mapSimulatedAt,
}: ParkHereBarProps) {
  const { residentZone } = useResidentZone();
  const [session, setSession] = useState<ParkingSession | null>(null);
  const [tick, setTick] = useState(0);
  const [checkInResponseDone, setCheckInResponseDone] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [infoText, setInfoText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Cleaning schedule at the chosen point (Park Here), even when map overlay is hidden. */
  const [parkingSpotCleaning, setParkingSpotCleaning] = useState<ParkingSpotCleaningPreview | null>(null);
  /** True when API says no polygon at point (422) — show extra help above the button. */
  const [checkInNoZoneGuide, setCheckInNoZoneGuide] = useState(false);

  useEffect(() => {
    setSession(loadParkingSession());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tick]);

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
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if ("Notification" in window && Notification.permission === "granted") {
        const sub = await subscribeWebPush();
        if (sub) subJson = sub.toJSON() as ReturnType<PushSubscription["toJSON"]>;
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
  }, []);

  const idleCardClass = compact
    ? "relative z-20 w-full min-w-0 rounded-xl border border-neutral-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
    : "absolute bottom-0 left-0 right-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur";

  const dashboardPositionClass = compact
    ? "fixed inset-x-0 bottom-[6rem] z-[10028] flex max-h-[min(52vh,calc(100dvh-9rem))] justify-center overflow-y-auto overscroll-contain px-3 pb-1 sm:px-4 [&>*]:w-[min(calc(100vw-1.5rem),42rem)] [&>*]:min-w-0"
    : "fixed inset-x-0 bottom-0 z-[10026] px-3 sm:px-4";

  const parkButtonBlock = (
    <div
      className={
        compact
          ? "flex w-full min-w-0 flex-col gap-2"
          : "mx-auto flex w-full max-w-lg flex-col gap-2"
      }
    >
      {compact && mapCheckInLngLat != null && (
        <p className="text-center text-[10px] leading-snug text-neutral-500">
          Kartnål aktiv — dra den blå nålen för att justera. · Map pin active — drag the blue pin to adjust.
        </p>
      )}
      {compact && mapCheckInLngLat == null && (
        <p className="text-center text-[10px] leading-snug text-neutral-500">
          Tips: tryck <span className="font-medium text-neutral-600">Hitta position</span> (höger), dra nålen till
          parkeringen, sedan Park Here. · Use <span className="font-medium text-neutral-600">Find location</span>{" "}
          (right), drag pin to your spot, then Park Here.
        </p>
      )}
      {!session && parkingSpotCleaning && (
        <div
          className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-left text-xs text-neutral-800 shadow-sm"
          role="status"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/90">
            Städning här · Cleaning here
          </div>
          <div className="mt-0.5 font-medium text-neutral-900">{parkingSpotCleaning.streetName}</div>
          <div className="mt-1 text-[11px] text-neutral-700">
            Nästa städning / Next: <span className="tabular-nums">{parkingSpotCleaning.nextLabel}</span>
          </div>
        </div>
      )}
      {checkInResponseDone && !loading && errorText != null && errorText !== "" && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-left shadow-sm"
          role="alert"
        >
          <div className="text-xs font-semibold text-red-900">Kunde inte checka in · Check-in failed</div>
          <p className="mt-1 text-sm leading-snug text-red-800">{errorText}</p>
          {checkInNoZoneGuide && (
            <p className="mt-2 border-t border-red-200/80 pt-2 text-[11px] leading-snug text-red-900/90">
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
        <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3 py-2 text-center text-xs text-emerald-900">
          {infoText}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void onParkHere()}
          className="flex flex-1 min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
        >
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          Park Here / Parkera här
        </button>
      </div>
      {loading && (
        <p className="text-center text-[11px] text-neutral-500" aria-live="polite">
          Kontrollerar plats och städning… · Checking location…
        </p>
      )}
    </div>
  );

  if (session) {
    const sessionDashboardBody = (
      <>
        <div>
          <div className="text-xs font-medium text-emerald-700">Parked · Parkerad</div>
          <div className="mt-0.5 text-sm font-semibold text-neutral-900">{session.streetName}</div>
          <div className="mt-1 text-xs text-neutral-600">
            Taxa: <span className="text-neutral-800">{session.taxaName ?? "—"}</span>
            {coercedHourlyRate != null && (
              <span className="tabular-nums"> · {coercedHourlyRate} kr/h</span>
            )}
          </div>
        </div>

        <div className="grid gap-2 border-t border-neutral-100 pt-2 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Parkeringsavgift · Parking fee (live)
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-neutral-600">Duration · Tid</span>
            <span className="tabular-nums text-base font-semibold text-neutral-900">
              {formatElapsedParking(session.checkedInAt, now)}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-neutral-600">Est. fee · Beräknad avgift</span>
            <span className="tabular-nums text-base font-semibold text-neutral-900">
              {residentBenefit && (
                <span className="mr-2 text-xs font-normal text-emerald-700">
                  Resident benefit · Boendeförmån
                </span>
              )}
              {estimatedFeeSek == null ? "—" : formatSek(estimatedFeeSek)}
            </span>
          </div>
          {coercedHourlyRate != null && !residentBenefit && estimatedFeeSek != null && (
            <p className="text-[11px] leading-snug text-neutral-600">
              <span className="tabular-nums">
                {parkedHours.toFixed(2)} h × {coercedHourlyRate} kr/h
              </span>{" "}
              ≈ <span className="font-medium text-neutral-800">{formatSek(estimatedFeeSek)}</span>
              <span className="ml-1 text-neutral-500">
                · uppdateras varje sekund / updates every second
              </span>
            </p>
          )}
          {estimatedFeeSek == null && !residentBenefit && (
            <p className="text-[11px] leading-snug text-neutral-600">
              Ingen timtaxa från databasen för denna punkt. Flytta nålen närmare en taxalinje, säkerställ Supabase-migration för taxa-RPC, eller importera taxa. · No hourly rate from DB; move pin near a tariff line, apply taxa RPC migration on Supabase, or import taxa data.
            </p>
          )}
          {residentBenefit && (
            <p className="text-[11px] leading-snug text-emerald-800">
              Din boendezon matchar detta taxaområde — visad avgift är 0 kr (uppskattning). / Your home zone matches
              this tariff area — shown fee is 0 kr (estimate).
            </p>
          )}
        </div>

        <div className="grid gap-1 border-t border-neutral-100 pt-2">
          <div className="text-xs text-neutral-600">Next cleaning · Nästa städning</div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`tabular-nums text-lg font-semibold ${
                cleaningCountdownMs != null && cleaningCountdownMs < 3600000 ? "text-amber-700" : "text-neutral-900"
              }`}
            >
              {cleaningCountdownMs != null ? formatRemaining(cleaningCountdownMs) : "—"}
            </span>
            {cleaningCountdownMs != null && cleaningCountdownMs <= 0 && (
              <span className="text-xs font-medium text-amber-800">Due or active · Dags eller pågår</span>
            )}
          </div>
        </div>
      </>
    );

    if (compact) {
      const sessionCardClass =
        "w-full min-w-0 shrink-0 rounded-xl border border-neutral-200 bg-white/95 py-3 pl-4 pr-3 shadow-lg backdrop-blur sm:py-4";
      return (
        <div className={dashboardPositionClass} style={{ pointerEvents: "none" }}>
          <div
            className={sessionCardClass}
            data-gpg-park-check-in="1"
            style={{
              pointerEvents: "auto",
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div className="flex flex-col gap-3">
              {sessionDashboardBody}
              <button
                type="button"
                onClick={onEndParking}
                className="mt-1 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50"
              >
                End parking · Avsluta parkering
              </button>
              <div className="border-t border-neutral-200 pt-3">
                <p className="mb-2 text-center text-[10px] text-neutral-500">
                  Uppdatera position · Update check-in
                </p>
                {parkButtonBlock}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={idleCardClass} style={{ pointerEvents: "none" }}>
        <div
          className="mx-auto max-w-lg"
          style={{ pointerEvents: "auto", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex flex-col gap-3">
            {sessionDashboardBody}
            {parkButtonBlock}
            <button
              type="button"
              onClick={onEndParking}
              className="w-full cursor-pointer rounded-lg border border-neutral-300 bg-white py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50"
            >
              End parking · Avsluta parkering
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${idleCardClass} pointer-events-auto max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain`}
      data-gpg-park-check-in="1"
    >
      {parkButtonBlock}
    </div>
  );
}
