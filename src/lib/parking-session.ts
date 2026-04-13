export type ParkingSession = {
  zoneId: string;
  streetName: string;
  checkedInAt: string;
  nextCleaningIso: string;
  /** Scheduled push fire times (ISO) — T-12h and T-1h */
  alert12hIso: string;
  alert1hIso: string;
  /** Parsed rule snapshot from parser (optional) */
  parsedRuleJson?: string;
  /** Nearest taxa at check-in (from `parking_taxa_at_point_for_fee`) */
  taxaName?: string;
  /** Hourly rate in SEK; omit if no taxa match */
  hourlyRate?: number | null;
  /** True only if GPS/pin is inside the user’s Boende polygon (server: `point_inside_resident_boende`). */
  residentBenefitEligible?: boolean;
  /**
   * No cleaning polygon at check-in; fee/taxa still apply. No cleaning push alerts are scheduled.
   */
  taxaOnlyParking?: boolean;
  /** Snapshot of cleaning schedule JSON for the matched zone */
  cleaningScheduleJson?: string;
};

export const PARKING_SESSION_STORAGE_KEY = "gpg:parking-session";

const KEY = PARKING_SESSION_STORAGE_KEY;

function isValidParkingSession(value: unknown): value is ParkingSession {
  if (value == null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.zoneId === "string" &&
    o.zoneId.length > 0 &&
    typeof o.streetName === "string" &&
    typeof o.checkedInAt === "string" &&
    o.checkedInAt.length > 0 &&
    typeof o.nextCleaningIso === "string" &&
    o.nextCleaningIso.length > 0 &&
    typeof o.alert12hIso === "string" &&
    typeof o.alert1hIso === "string"
  );
}

export function loadParkingSession(): ParkingSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidParkingSession(parsed)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveParkingSession(session: ParkingSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearParkingSession(): void {
  localStorage.removeItem(KEY);
}

export function msUntil(iso: string, now: Date = new Date()): number {
  return new Date(iso).getTime() - now.getTime();
}
