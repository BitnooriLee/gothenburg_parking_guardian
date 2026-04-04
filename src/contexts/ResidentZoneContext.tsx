"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const USER_RESIDENT_ZONE_STORAGE_KEY = "user_resident_zone";

/** Main Gothenburg parking taxa zone letters (Boendeparkering selection). */
export const RESIDENT_ZONE_CODES = [
  "A",
  "B",
  "C",
  "D",
  "L",
  "M",
  "N",
  "P",
  "S",
  "V",
] as const;

export type ResidentZoneCode = (typeof RESIDENT_ZONE_CODES)[number];

type ResidentZoneContextValue = {
  /** Empty string = not set (no highlight). */
  residentZone: string;
  setResidentZone: (zone: string) => void;
};

const ResidentZoneContext = createContext<ResidentZoneContextValue | null>(null);

export function ResidentZoneProvider({ children }: { children: ReactNode }) {
  const [residentZone, setResidentZoneState] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_RESIDENT_ZONE_STORAGE_KEY);
      if (raw != null) setResidentZoneState(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const setResidentZone = useCallback((zone: string) => {
    setResidentZoneState(zone);
    try {
      if (zone) localStorage.setItem(USER_RESIDENT_ZONE_STORAGE_KEY, zone);
      else localStorage.removeItem(USER_RESIDENT_ZONE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ residentZone, setResidentZone }),
    [residentZone, setResidentZone],
  );

  return (
    <ResidentZoneContext.Provider value={value}>{children}</ResidentZoneContext.Provider>
  );
}

export function useResidentZone(): ResidentZoneContextValue {
  const ctx = useContext(ResidentZoneContext);
  if (!ctx) {
    throw new Error("useResidentZone must be used within ResidentZoneProvider");
  }
  return ctx;
}
