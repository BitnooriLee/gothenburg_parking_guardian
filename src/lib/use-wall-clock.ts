"use client";

import { useEffect, useState } from "react";

/**
 * Monotonic wall clock for live parking timers. Mobile browsers throttle
 * `setInterval` in background tabs; on visibility restore and bfcache resume
 * we jump to the real time immediately.
 */
export function useWallClock(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const sync = () => setNow(new Date());
    const id = window.setInterval(sync, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [intervalMs]);

  return now;
}
