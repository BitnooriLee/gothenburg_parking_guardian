import { getNextCleaningStartMs, type CleaningSchedule } from "@/lib/cleaning-safety";
import { buildCleaningAlertBody, formatDeadlineStockholm } from "@/lib/notification-payload";
import { getMockCleaningZones } from "@/lib/mock-cleaning-zones";
import { featureContainsLngLat } from "@/lib/point-in-polygon";
import { parseRpcGeomGeojson } from "@/lib/rpc-geometry";
import { parseSwedishRestriction } from "@/lib/parser";
import { createClient } from "@supabase/supabase-js";
import type { Feature } from "geojson";
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

async function findZoneFeature(lat: number, lng: number): Promise<Feature | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const supabase = createClient(url, key);
    const rpcName = "cleaning_zone_at_point";
    const sqlHint =
      "ST_Covers(ST_SetSRID(ST_Force2D(c.geom),4326), ST_SetSRID(ST_MakePoint(lng,lat),4326)) LIMIT 1";

    if (shouldLogCleaningCheckInCoords()) {
      console.info(`[check-in/${rpcName}] RPC args`, { lat, lng, order: "ST_MakePoint(lng, lat) EPSG:4326" });
    }

    const { data, error } = await supabase.rpc(rpcName, { lat, lng });

    if (error) {
      console.warn(`[check-in/${rpcName}] Supabase RPC error`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return null;
    }

    const rowCount = Array.isArray(data) ? data.length : 0;
    if (rowCount === 0) {
      console.warn(`[check-in/${rpcName}] 0 rows (no polygon contains this point)`, {
        lat,
        lng,
        rpc: `${rpcName}({ lat, lng })`,
        matchExpression: sqlHint,
        tip: "Run migration 006_cleaning_zone_at_point_srid.sql; sync cleaning_zones; verify point is inside a zone polygon.",
      });
      return null;
    }

    if (shouldLogCleaningCheckInCoords()) {
      console.info(`[check-in/${rpcName}] match`, { rowCount, zoneId: (data as { id?: string }[])[0]?.id });
    }

    const row = (data as { id: string }[])[0] as {
      id: string;
      street_name: string | null;
      active_period_text: string | null;
      schedule: unknown;
      geom_geojson: unknown;
    };
    const geometry = parseRpcGeomGeojson(row.geom_geojson);
    if (!geometry) return null;
    return {
      type: "Feature",
      id: row.id,
      geometry,
      properties: {
        id: row.id,
        street_name: row.street_name ?? "",
        active_period_text: row.active_period_text ?? "",
        schedule: row.schedule ?? {},
      },
    };
  }

  const fc = getMockCleaningZones();
  for (const f of fc.features) {
    if (featureContainsLngLat(f, lng, lat)) return f;
  }
  return null;
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

  const feature = await findZoneFeature(lat, lng);
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
  const schedule = (feature.properties.schedule ?? {}) as CleaningSchedule;

  const parsedRule = parseSwedishRestriction(activeText);
  const now = new Date();
  let nextMs = getNextCleaningStartMs(now, schedule);
  if (nextMs == null && schedule.nextCleaningStart) {
    nextMs = new Date(schedule.nextCleaningStart).getTime();
  }
  if (nextMs == null) {
    return NextResponse.json(
      { error: "Could not determine next cleaning time from zone data" },
      { status: 422 },
    );
  }

  const nextCleaningIso = new Date(nextMs).toISOString();
  const alert12 = new Date(nextMs - 12 * 3600000).toISOString();
  const alert1 = new Date(nextMs - 1 * 3600000).toISOString();
  const deadlineSv = formatDeadlineStockholm(nextCleaningIso);

  const session = {
    zoneId: String(feature.properties.id),
    streetName: street,
    checkedInAt: now.toISOString(),
    nextCleaningIso,
    alert12hIso: alert12,
    alert1hIso: alert1,
    parsedRuleJson: JSON.stringify(parsedRule),
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
          ? "VAPID keys missing; set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY."
          : !supabaseUrl || !serviceKey
            ? "Supabase service role missing; alerts stored client-side only."
            : "Two push alerts queued (12h and 1h before cleaning).",
  });
}
