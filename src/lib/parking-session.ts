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
};

const KEY = "gpg:parking-session";

export function loadParkingSession(): ParkingSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ParkingSession;
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
