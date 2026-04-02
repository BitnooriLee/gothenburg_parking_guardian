import { getStockholmWeekdayAndMinutes } from "./parser";

export type CleaningSafetyLevel = "safe" | "warning" | "danger";

export type CleaningSchedule = {
  /** Pre-computed next cleaning start (ISO 8601), e.g. from sync job */
  nextCleaningStart?: string;
  /** API-style period bounds (ISO or Microsoft JSON date string) */
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  /** Raw API fields if embedded in JSONB */
  ActivePeriodText?: string;
};

function parseMs(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const s = value.trim();
  if (s.startsWith("/Date(")) {
    const inner = s.slice(6, s.indexOf(")"));
    const num = Number(inner.split("+")[0]?.split("-")[0]);
    if (!Number.isFinite(num)) return null;
    return num;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** True when `at` falls inside [start, end] in absolute time. */
function isActiveCleaning(at: Date, schedule: CleaningSchedule): boolean {
  const a = parseMs(schedule.currentPeriodStart);
  const b = parseMs(schedule.currentPeriodEnd);
  if (a == null || b == null) return false;
  const t = at.getTime();
  return t >= a && t <= b;
}

/**
 * Next cleaning start: prefers `nextCleaningStart`, else end of current period (next would need calendar — fallback null).
 */
export function getNextCleaningStartMs(at: Date, schedule: CleaningSchedule): number | null {
  const next = schedule.nextCleaningStart ? parseMs(schedule.nextCleaningStart) : null;
  if (next != null && next > at.getTime()) return next;
  const end = parseMs(schedule.currentPeriodEnd);
  if (end != null && at.getTime() < end) {
    return end;
  }
  return next;
}

/**
 * Maps hours until next window start (or active cleaning) to UI tier.
 * Green: &gt; 48h · Yellow: (6h, 48h] · Red: active or ≤ 6h.
 */
export function getCleaningSafetyLevel(
  at: Date,
  schedule: CleaningSchedule,
): { level: CleaningSafetyLevel; msUntilNext: number | null } {
  if (isActiveCleaning(at, schedule)) {
    return { level: "danger", msUntilNext: 0 };
  }

  const nextMs = getNextCleaningStartMs(at, schedule);
  if (nextMs == null) {
    return { level: "safe", msUntilNext: null };
  }

  const ms = nextMs - at.getTime();
  const hours = ms / 3600000;

  if (hours <= 0) {
    return { level: "danger", msUntilNext: ms };
  }
  if (hours <= 6) {
    return { level: "danger", msUntilNext: ms };
  }
  if (hours <= 48) {
    return { level: "warning", msUntilNext: ms };
  }
  return { level: "safe", msUntilNext: ms };
}

/** Uses Stockholm wall time for display (ties to parser.ts timezone). */
export function formatNextCleaningLabel(at: Date, schedule: CleaningSchedule): string {
  const nextMs = getNextCleaningStartMs(at, schedule);
  if (nextMs == null) {
    return schedule.ActivePeriodText?.trim() || "No scheduled window in data";
  }
  const d = new Date(nextMs);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Expose Stockholm parts for UI clocks (same helper as parking logic). */
export function getStockholmSnapshot(at: Date) {
  return getStockholmWeekdayAndMinutes(at);
}
