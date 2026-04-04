import {
  getNextCleaningStartMs,
  type CleaningSchedule,
  scheduleFromZoneProperties,
} from "@/lib/cleaning-safety";
import type { ParkingSession } from "@/lib/parking-session";
import { buildCleaningAlertBody, formatDeadlineStockholm } from "@/lib/notification-payload";
import { findCleaningZoneFeatureAtPoint } from "@/lib/find-cleaning-zone-feature-at-point";
import { parseSwedishRestriction } from "@/lib/parser";
import { normalizeSupabaseRpcRows } from "@/lib/supabase-rpc-rows";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { configureWebPush } from "@/lib/web-push-env";

export const dynamic = "force-dynamic";

type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type Body = {
  lat?: unknown;
  lng?: unknown;
  /** Some clients send latitude/longitude; normalize to lat/lng. */
  latitude?: unknown;
  longitude?: unknown;
  subscription?: PushSubscriptionJSON;
};

function parseCoord(primary: unknown, alias: unknown): number | null {
  const candidates = [primary, alias];
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Log detailed lat/lng when DEBUG_CLEANING_CHECKIN=1 or in development. */
function shouldLogCleaningCheckInCoords(): boolean {
  return process.env.DEBUG_CLEANING_CHECKIN === "1" || process.env.NODE_ENV === "development";
}

type TaxaRpcRow = {
  taxa_name?: string;
  taxaName?: string;
  hourly_rate?: unknown;
  hourlyRate?: unknown;
};

function parseHourlyRate(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function findTaxaAtPoint(
  lat: number,
  lng: number,
): Promise<{ taxaName: string; hourlyRate: number } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (shouldLogCleaningCheckInCoords()) {
      console.warn("[check-in/parking_taxa_at_point] skipped: missing Supabase URL or anon key");
    }
    return null;
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("parking_taxa_at_point", { lat, lng });
  if (error) {
    console.warn("[check-in/parking_taxa_at_point] RPC error", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }

  const rows = normalizeSupabaseRpcRows<TaxaRpcRow>(data);
  const row = rows[0];
  const nameRaw = row?.taxa_name ?? row?.taxaName;
  const taxaName = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!taxaName) {
    if (shouldLogCleaningCheckInCoords()) {
      console.info("[check-in/parking_taxa_at_point] no row / empty taxa_name", {
        lat,
        lng,
        rowCount: rows.length,
        rawType: data === null ? "null" : Array.isArray(data) ? "array" : typeof data,
      });
    }
    return null;
  }

  const rate = parseHourlyRate(row.hourly_rate ?? row.hourlyRate);
  const hourlyRate = rate ?? 0;

  if (shouldLogCleaningCheckInCoords()) {
    console.info("[check-in/parking_taxa_at_point] hit", {
      lat,
      lng,
      taxaName,
      hourlyRate,
      rowCount: rows.length,
    });
  }

  return { taxaName, hourlyRate };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const lat = parseCoord(body.lat, body.latitude);
  const lng = parseCoord(body.lng, body.longitude);
  const { subscription } = body;

  if (lat == null || lng == null) {
    if (shouldLogCleaningCheckInCoords()) {
      console.warn("[check-in] missing or non-finite coordinates", {
        keysPresent: Object.keys(body),
        latRaw: body.lat,
        lngRaw: body.lng,
        latitudeRaw: body.latitude,
        longitudeRaw: body.longitude,
        hint: "Send JSON { lat, lng } in decimal degrees (EPSG:4326). Aliases latitude/longitude are accepted.",
      });
    }
    return NextResponse.json(
      {
        error: "lat and lng are required (finite numbers). Optional aliases: latitude, longitude.",
      },
      { status: 400 },
    );
  }

  const feature = await findCleaningZoneFeatureAtPoint(lat, lng);
  if (!feature?.properties) {
    if (shouldLogCleaningCheckInCoords()) {
      console.warn("[check-in] 422 no polygon at coordinates (coords were valid; DB/RPC returned no zone)", {
        lat,
        lng,
      });
    }
    // 422 (not 404): avoids confusion with a missing API route in DevTools.
    return NextResponse.json({ error: "No cleaning zone at this location" }, { status: 422 });
  }

  const street = String(feature.properties.street_name || feature.properties.id || "Unknown street");
  const activeText = String(feature.properties.active_period_text || "");
  const schedule = scheduleFromZoneProperties(feature.properties as Record<string, unknown>);

  const parsedRule = parseSwedishRestriction(activeText);
  const now = new Date();
  let nextMs = getNextCleaningStartMs(now, schedule);
  if (nextMs == null && schedule.nextCleaningStart) {
    nextMs = new Date(schedule.nextCleaningStart).getTime();
  }
  if (nextMs == null) {
    if (shouldLogCleaningCheckInCoords()) {
      console.warn("[check-in] 422 next cleaning time unresolved (check schedule JSONB keys)", {
        zoneId: feature.properties.id,
        scheduleSnapshot: schedule,
      });
    }
    return NextResponse.json(
      { error: "Could not determine next cleaning time from zone data" },
      { status: 422 },
    );
  }

  const nextCleaningIso = new Date(nextMs).toISOString();
  const alert12 = new Date(nextMs - 12 * 3600000).toISOString();
  const alert1 = new Date(nextMs - 1 * 3600000).toISOString();
  const deadlineSv = formatDeadlineStockholm(nextCleaningIso);

  const taxaHit = await findTaxaAtPoint(lat, lng);

  const session: ParkingSession = {
    zoneId: String(feature.properties.id),
    streetName: street,
    checkedInAt: now.toISOString(),
    nextCleaningIso,
    alert12hIso: alert12,
    alert1hIso: alert1,
    parsedRuleJson: JSON.stringify(parsedRule),
    cleaningScheduleJson: JSON.stringify(schedule),
    taxaName: taxaHit?.taxaName,
    hourlyRate: taxaHit != null ? taxaHit.hourlyRate : null,
  };

  const payloadBase = {
    title: "Street Cleaning Alert / Gatorna städas",
    body: buildCleaningAlertBody(street, deadlineSv),
    data: { url: "/", zoneId: session.zoneId },
    tag: `cleaning-${session.zoneId}`,
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const nowT = now.getTime();
  if (subscription && supabaseUrl && serviceKey && configureWebPush()) {
    const admin = createClient(supabaseUrl, serviceKey);
    const subJson = subscription;
    const rows = [
      { fire_at: alert12 },
      { fire_at: alert1 },
    ];
    for (const { fire_at } of rows) {
      if (new Date(fire_at).getTime() <= nowT) continue;
      await admin.from("scheduled_push_alerts").insert({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        fire_at,
        payload: payloadBase,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    session,
    pushScheduled: Boolean(subscription && supabaseUrl && serviceKey && configureWebPush()),
    message:
      !subscription
        ? "No push subscription; enable notifications and try again for server-side alerts."
        : !configureWebPush()
          ? "VAPID keys missing; set VAPID_PRIVATE_KEY and a public key (VAPID_PUBLIC_KEY or NEXT_PUBLIC_VAPID_PUBLIC_KEY)."
          : !supabaseUrl || !serviceKey
            ? "Supabase service role missing; alerts stored client-side only."
            : "Two push alerts queued (12h and 1h before cleaning).",
  });
}
