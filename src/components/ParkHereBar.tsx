"use client";

import { saveParkingSession, loadParkingSession, clearParkingSession, msUntil, type ParkingSession } from "@/lib/parking-session";
import { subscribeWebPush } from "@/lib/push-client";
import { MapPin } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

type ParkHereBarProps = {
  /** Map overlay: no full-width dock; tight card so fixed parents do not span the viewport. */
  compact?: boolean;
};

export default function ParkHereBar({ compact = false }: ParkHereBarProps) {
  const [session, setSession] = useState<ParkingSession | null>(null);
  const [tick, setTick] = useState(0);
  /** True only after the current check-in request finishes (success or error). Hides feedback until HTTP response is handled. */
  const [checkInResponseDone, setCheckInResponseDone] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [infoText, setInfoText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSession(loadParkingSession());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingNext = useMemo(() => {
    if (!session) return null;
    return msUntil(session.nextCleaningIso);
  }, [session, tick]);

  const onParkHere = useCallback(async () => {
    setCheckInResponseDone(false);
    setLoading(true);
    setErrorText(null);
    setInfoText(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setErrorText("GPS returned invalid coordinates; try again outdoors.");
        return;
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[ParkHereBar] check-in using coordinates", {
          lat,
          lng,
          accuracyMeters: pos.coords.accuracy,
        });
      }
      let subJson: ReturnType<PushSubscription["toJSON"]> | undefined;
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if ("Notification" in window && Notification.permission === "granted") {
        const sub = await subscribeWebPush();
        if (sub) subJson = sub.toJSON() as ReturnType<PushSubscription["toJSON"]>;
      }

      const res = await fetch("/api/parking/check-in", {
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
      });
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
        setErrorText(err);
        return;
      }
      if (data?.session) {
        saveParkingSession(data.session);
        setSession(data.session);
      }
      const msg = data?.message?.trim();
      setInfoText(msg || "Saved.");
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Location or push failed");
    } finally {
      setLoading(false);
      setCheckInResponseDone(true);
    }
  }, []);

  const onClear = useCallback(() => {
    clearParkingSession();
    setSession(null);
    setCheckInResponseDone(false);
    setErrorText(null);
    setInfoText(null);
  }, []);

  const rootClass = compact
    ? "relative z-20 w-max max-w-[min(100vw-1.5rem,42rem)] rounded-xl border border-neutral-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
    : "absolute bottom-0 left-0 right-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur";

  return (
    <div className={rootClass} style={{ pointerEvents: "none" }}>
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        {session && (
          <div className="text-center text-xs text-neutral-600">
            <span className="font-medium text-emerald-700">Parked</span>
            {" · "}
            {session.streetName}
            {" · "}
            Next cleaning in:{" "}
            <span className="tabular-nums font-medium text-neutral-900">{remainingNext != null ? formatRemaining(remainingNext) : "—"}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void onParkHere()}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            style={{ pointerEvents: "auto" }}
          >
            <MapPin className="h-4 w-4" aria-hidden />
            Park Here / Parkera här
          </button>
          {session && (
            <button
              type="button"
              onClick={onClear}
              className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50"
              style={{ pointerEvents: "auto" }}
            >
              Clear
            </button>
          )}
        </div>
        {checkInResponseDone && !loading && errorText != null && errorText !== "" && (
          <p className="text-center text-xs text-red-600">{errorText}</p>
        )}
        {checkInResponseDone && !loading && !errorText && infoText != null && infoText !== "" && (
          <p className="text-center text-xs text-neutral-500">{infoText}</p>
        )}
      </div>
    </div>
  );
}
