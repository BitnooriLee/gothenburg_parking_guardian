import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Canonical row after normalizing alternate API property names. */
const cleaningZoneSchema = z.object({
  Id: z.string().optional(),
  StreetName: z.string().nullable().optional(),
  ActivePeriodText: z.string().nullable().optional(),
  CurrentPeriodStart: z.union([z.string(), z.null()]).optional(),
  CurrentPeriodEnd: z.union([z.string(), z.null()]).optional(),
  WeekDay: z.number().nullable().optional(),
  StartMonth: z.number().nullable().optional(),
  StartDay: z.number().nullable().optional(),
  StartHour: z.number().nullable().optional(),
  EndMonth: z.number().nullable().optional(),
  EndDay: z.number().nullable().optional(),
  EndHour: z.number().nullable().optional(),
  OnlyEvenWeeks: z.boolean().nullable().optional(),
  OnlyOddWeeks: z.boolean().nullable().optional(),
  Distance: z.number().nullable().optional(),
  Lat: z.number().nullable().optional(),
  Long: z.number().nullable().optional(),
  WKT: z.string().nullable().optional(),
});

type CleaningZoneDto = z.infer<typeof cleaningZoneSchema>;

function readString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function readFiniteNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function readBool(o: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

/**
 * Map arbitrary CleaningZones JSON keys to our canonical DTO (PascalCase official API + common aliases).
 * Coordinates: latitude always from Lat/lat/latitude; longitude always from Long/Lng/longitude (never swapped).
 */
function normalizeCleaningZoneRaw(raw: unknown): CleaningZoneDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const merged = {
    Id: readString(o, ["Id", "id"]),
    StreetName: readString(o, ["StreetName", "street_name", "Street", "street", "StreetNamn"]) ?? null,
    ActivePeriodText: readString(o, ["ActivePeriodText", "active_period_text", "ActivePeriod", "period"]) ?? null,
    CurrentPeriodStart: (readString(o, ["CurrentPeriodStart", "current_period_start", "periodStart"]) as string | undefined) ?? null,
    CurrentPeriodEnd: (readString(o, ["CurrentPeriodEnd", "current_period_end", "periodEnd"]) as string | undefined) ?? null,
    WeekDay: readFiniteNumber(o, ["WeekDay", "weekDay", "weekday", "day_of_week", "DayOfWeek"]) ?? null,
    StartMonth: readFiniteNumber(o, ["StartMonth", "start_month"]) ?? null,
    StartDay: readFiniteNumber(o, ["StartDay", "start_day"]) ?? null,
    StartHour: readFiniteNumber(o, ["StartHour", "start_hour"]) ?? null,
    EndMonth: readFiniteNumber(o, ["EndMonth", "end_month"]) ?? null,
    EndDay: readFiniteNumber(o, ["EndDay", "end_day"]) ?? null,
    EndHour: readFiniteNumber(o, ["EndHour", "end_hour"]) ?? null,
    OnlyEvenWeeks: readBool(o, ["OnlyEvenWeeks", "only_even_weeks"]) ?? null,
    OnlyOddWeeks: readBool(o, ["OnlyOddWeeks", "only_odd_weeks"]) ?? null,
    Distance: readFiniteNumber(o, ["Distance", "distance"]) ?? null,
    Lat: readFiniteNumber(o, ["Lat", "lat", "latitude"]) ?? null,
    Long: readFiniteNumber(o, ["Long", "Lng", "lng", "longitude"]) ?? null,
    WKT: readString(o, ["WKT", "wkt", "geometry", "GeomWkt"]) ?? null,
  };

  const r = cleaningZoneSchema.safeParse(merged);
  return r.success ? r.data : null;
}

const WEEKDAY_MON_THROUGH_SAT = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * English weekday name for `schedule.day_of_week`.
 * Supports .NET DayOfWeek (0 = Sunday .. 6 = Saturday) and ISO-8601 (1 = Monday .. 7 = Sunday).
 * Values 1–6 are identical in both schemes (Monday–Saturday).
 */
function weekdayNumberToEnglishName(n: number | null | undefined): string | null {
  if (n == null || !Number.isInteger(n)) return null;
  if (n === 0 || n === 7) return "Sunday";
  if (n >= 1 && n <= 6) return WEEKDAY_MON_THROUGH_SAT[n - 1] ?? null;
  return null;
}

function parseMsJsonDate(value: unknown): string | null {
  if (value == null || typeof value !== "string") return null;
  const m = value.match(/\/Date\((-?\d+)([+-]\d+)?\)\//);
  if (!m) return null;
  const t = Number(m[1]);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function hourToTimeLabel(hour: unknown): string | null {
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:00`;
}

function stableFallbackId(zone: CleaningZoneDto, index: number): string {
  const base = [zone.StreetName ?? "", zone.WKT ?? "", String(index)].join("|");
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    h = (Math.imul(31, h) + base.charCodeAt(i)) | 0;
  }
  return `gz-fallback-${Math.abs(h)}-${index}`;
}

function toScheduleRow(zone: CleaningZoneDto): Record<string, unknown> {
  const rawWeekday = zone.WeekDay ?? null;
  return {
    /** Display / app convention: English name; see `day_of_week_raw` for the API integer */
    day_of_week: weekdayNumberToEnglishName(rawWeekday),
    day_of_week_raw: rawWeekday,
    start_time: hourToTimeLabel(zone.StartHour),
    end_time: hourToTimeLabel(zone.EndHour),
    current_period_start: parseMsJsonDate(zone.CurrentPeriodStart),
    current_period_end: parseMsJsonDate(zone.CurrentPeriodEnd),
    start_month: zone.StartMonth ?? null,
    start_day: zone.StartDay ?? null,
    end_month: zone.EndMonth ?? null,
    end_day: zone.EndDay ?? null,
    only_even_weeks: zone.OnlyEvenWeeks ?? null,
    only_odd_weeks: zone.OnlyOddWeeks ?? null,
    distance: zone.Distance ?? null,
    source: "Gothenburg ParkingService v2.3 CleaningZones",
  };
}

async function fetchCleaningZones(appId: string): Promise<CleaningZoneDto[]> {
  const url = new URL(`https://data.goteborg.se/ParkingService/v2.3/CleaningZones/${encodeURIComponent(appId)}`);
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gothenburg API ${res.status}: ${text.slice(0, 500)}`);
  }

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error("Gothenburg CleaningZones: expected JSON array");
  }

  const parsed: CleaningZoneDto[] = [];
  for (const item of raw) {
    const row = normalizeCleaningZoneRaw(item);
    if (row) parsed.push(row);
  }
  return parsed;
}

async function runSync(): Promise<{ upserted: number; skipped: number; errors: string[] }> {
  const appId = process.env.GOTHENBURG_DATA_API_KEY?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!appId) {
    throw new Error("GOTHENBURG_DATA_API_KEY is not set (used as ParkingService APPID in URL path)");
  }
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }

  const zones = await fetchCleaningZones(appId);
  const supabase = createClient(supabaseUrl, serviceKey);

  let upserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  const chunkSize = 40;
  for (let i = 0; i < zones.length; i += chunkSize) {
    const chunk = zones.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (zone, j) => {
        const id = zone.Id?.trim() || stableFallbackId(zone, i + j);
        if (!id) {
          skipped++;
          return;
        }

        // DB: latitude ← north/south (API Lat); longitude ← east/west (API Long / Lng). RPC uses ST_MakePoint(lng, lat).
        const lat = zone.Lat ?? null;
        const lng = zone.Long ?? null;
        const wkt = zone.WKT?.trim() ?? "";
        const schedule = toScheduleRow(zone);

        const { error } = await supabase.rpc("upsert_cleaning_zone_from_sync", {
          p_id: id,
          p_street_name: zone.StreetName ?? null,
          p_active_period_text: zone.ActivePeriodText ?? null,
          p_lat: lat,
          p_lng: lng,
          p_wkt: wkt.length > 0 ? wkt : null,
          p_schedule: schedule,
        });

        if (error) {
          errors.push(`${id}: ${error.message}`);
          return;
        }
        upserted++;
      }),
    );
  }

  return { upserted, skipped, errors };
}

/**
 * Sync CleaningZones (Gatusopning) from data.goteborg.se into `cleaning_zones`.
 * Auth: Authorization: Bearer <CRON_SECRET> (same pattern as `/api/cron/dispatch-alerts`).
 *
 * Env:
 * - GOTHENBURG_DATA_API_KEY: ParkingService v2.3 APPID (path segment, not a header).
 * - SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 * - CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync();
    return NextResponse.json({
      ok: true,
      ...result,
      errorCount: result.errors.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
