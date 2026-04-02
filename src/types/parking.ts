import type { Geometry } from "geojson";
import { z } from "zod";

// --- Parsed Swedish parking rules (machine-readable time ranges) ---
/** JS weekday: 0 = Sunday / helgdag, 1–5 = Mon–Fri (vardagar), 6 = Saturday (lördag). */
export const timeRangeSchema = z.object({
  start: z.string(),
  end: z.string(),
  days: z.array(z.number().int().min(0).max(6)),
});

export type TimeRange = z.infer<typeof timeRangeSchema>;

export const parsedRuleSchema = z.object({
  isPaid: z.boolean(),
  ranges: z.array(timeRangeSchema),
  /** True when rule applies 24h (e.g. hela dagen, 00–24). */
  fullDaily: z.boolean().optional(),
});

export type ParsedRule = z.infer<typeof parsedRuleSchema>;

export const currentRestrictionsSchema = z.object({
  raw: z.string(),
  parsed: parsedRuleSchema.optional(),
});

export type CurrentRestrictions = z.infer<typeof currentRestrictionsSchema>;

const geometrySchema: z.ZodType<Geometry> = z.custom<Geometry>(
  (v) => v !== null && typeof v === "object" && "type" in (v as object),
  { message: "Invalid GeoJSON Geometry" },
);

/**
 * Shared fields (Gothenburg Parking API v2.3 JSON uses PascalCase).
 * Optional keys reflect schema minOccurs=0 or radius-only responses.
 */
export const baseParkingSchema = z.object({
  Id: z.string().nullable(),
  Name: z.string().nullable(),
  Owner: z.string().nullable(),
  Distance: z.number().int().nullable().optional(),
  Lat: z.number().nullable().optional(),
  Long: z.number().nullable().optional(),
  WKT: z.string().nullable(),
  /** Derived from WKT for Mapbox; not returned by the API. */
  geometry: geometrySchema.optional(),
});

export type BaseParking = z.infer<typeof baseParkingSchema>;

export interface BaseParkingInterface extends BaseParking {}

export const publicTollParkingSchema = baseParkingSchema.extend({
  ParkingSpaces: z.number().int().nullable(),
  FreeSpaces: z.number().int().nullable(),
  FreeSpacesDate: z.string().nullable(),
  PhoneParkingCode: z.string().nullable(),
  ParkingCost: z.string().nullable(),
  ParkingCharge: z.string().nullable(),
  CurrentParkingCost: z.number().int().nullable(),
  MaxParkingTime: z.string().nullable(),
  MaxParkingTimeLimitation: z.string().nullable(),
  ExtraInfo: z.string().nullable(),
  currentRestrictions: currentRestrictionsSchema.optional(),
});

export type PublicTollParking = z.infer<typeof publicTollParkingSchema>;

/** `implements` helper: same shape as {@link PublicTollParking} (BaseParking + toll fields). */
export interface PublicTollParkingInterface extends PublicTollParking {}

export const privateTollParkingSchema = baseParkingSchema.extend({
  FreeSpaces: z.number().int().nullable(),
  FreeSpacesDate: z.string().nullable(),
  ParkingSpaces: z.number().int().nullable(),
  PhoneParkingCode: z.string().nullable(),
  ParkingCost: z.string().nullable(),
  CurrentParkingCost: z.number().int().nullable(),
  MaxParkingTime: z.string().nullable(),
  ExtraInfo: z.string().nullable(),
  currentRestrictions: currentRestrictionsSchema.optional(),
});

export type PrivateTollParking = z.infer<typeof privateTollParkingSchema>;

export interface PrivateTollParkingInterface extends PrivateTollParking {}

export const publicTimeParkingSchema = baseParkingSchema.extend({
  ParkingSpaces: z.number().int().nullable(),
  MaxParkingTime: z.string().nullable(),
  MaxParkingTimeLimitation: z.string().nullable(),
  ExtraInfo: z.string().nullable(),
  currentRestrictions: currentRestrictionsSchema.optional(),
});

export type PublicTimeParking = z.infer<typeof publicTimeParkingSchema>;

export interface PublicTimeParkingInterface extends PublicTimeParking {}

/** List validators for API array responses. */
export const parkingListSchemas = {
  publicTollParkings: z.array(publicTollParkingSchema),
  privateTollParkings: z.array(privateTollParkingSchema),
  publicTimeParkings: z.array(publicTimeParkingSchema),
} as const;
