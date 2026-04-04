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

/** Persisted map overlay: cleaning zone lines on the map (default off). */
export const SHOW_CLEANING_ZONES_STORAGE_KEY = "gpg_show_cleaning_zones";

/**
 * Boendeparkering zone letters from WFS `parkering:boendeparkering-omrade` (`boende` property).
 * Must stay in sync with imported `taxa_name` prefix `Boende {letter}`.
 */
export const RESIDENT_ZONE_CODES = ["C", "G", "H", "K", "L", "M", "S", "V", "Ä", "Ö"] as const;

export type ResidentZoneCode = (typeof RESIDENT_ZONE_CODES)[number];

type ResidentZoneContextValue = {
  /** Empty string = not set (no highlight). */
  residentZone: string;
  setResidentZone: (zone: string) => void;
  /** Cleaning zone map overlay; default false — preview still loads on Park Here / map pick. */
  showCleaningZones: boolean;
  setShowCleaningZones: (show: boolean) => void;
};

const ResidentZoneContext = createContext<ResidentZoneContextValue | null>(null);

export function ResidentZoneProvider({ children }: { children: ReactNode }) {
  const [residentZone, setResidentZoneState] = useState("");
  const [showCleaningZones, setShowCleaningZonesState] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_RESIDENT_ZONE_STORAGE_KEY);
      if (raw == null || raw === "") return;
      const allowed = new Set<string>(RESIDENT_ZONE_CODES);
      if (allowed.has(raw)) {
        setResidentZoneState(raw);
        return;
      }
      localStorage.removeItem(USER_RESIDENT_ZONE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHOW_CLEANING_ZONES_STORAGE_KEY);
      if (raw === "1") setShowCleaningZonesState(true);
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

  const setShowCleaningZones = useCallback((show: boolean) => {
    setShowCleaningZonesState(show);
    try {
      localStorage.setItem(SHOW_CLEANING_ZONES_STORAGE_KEY, show ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      residentZone,
      setResidentZone,
      showCleaningZones,
      setShowCleaningZones,
    }),
    [residentZone, setResidentZone, showCleaningZones, setShowCleaningZones],
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
