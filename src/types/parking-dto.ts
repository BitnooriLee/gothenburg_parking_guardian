import type { Geometry } from "geojson";
import type { CurrentRestrictions } from "./parking";

/** Shared camelCase fields mapped from API `BaseParking` (PascalCase). */
export interface BaseParkingDTO {
  id: string | null;
  name: string | null;
  owner: string | null;
  distance?: number | null;
  lat?: number | null;
  /** Longitude (API field `Long`). */
  lng?: number | null;
  wkt: string | null;
  /** Filled from WKT via `wktToGeometry`; null if missing or invalid WKT. */
  geometry: Geometry | null;
}

export interface PublicTollParkingDTO extends BaseParkingDTO {
  kind: "publicToll";
  parkingSpaces: number | null;
  freeSpaces: number | null;
  freeSpacesDate: string | null;
  phoneParkingCode: string | null;
  parkingCost: string | null;
  parkingCharge: string | null;
  currentParkingCost: number | null;
  maxParkingTime: string | null;
  maxParkingTimeLimitation: string | null;
  extraInfo: string | null;
  /** Built from time-limit fields; `raw` is Swedish text for the parser. */
  restrictions?: CurrentRestrictions;
}

export interface PrivateTollParkingDTO extends BaseParkingDTO {
  kind: "privateToll";
  freeSpaces: number | null;
  freeSpacesDate: string | null;
  parkingSpaces: number | null;
  phoneParkingCode: string | null;
  parkingCost: string | null;
  currentParkingCost: number | null;
  maxParkingTime: string | null;
  extraInfo: string | null;
  restrictions?: CurrentRestrictions;
}

export interface PublicTimeParkingDTO extends BaseParkingDTO {
  kind: "publicTime";
  parkingSpaces: number | null;
  maxParkingTime: string | null;
  maxParkingTimeLimitation: string | null;
  extraInfo: string | null;
  restrictions?: CurrentRestrictions;
}

export type ParkingDTO = PublicTollParkingDTO | PrivateTollParkingDTO | PublicTimeParkingDTO;
