import { getNextCleaningStartMs, type CleaningSchedule } from "@/lib/cleaning-safety";
import { buildCleaningAlertBody, formatDeadlineStockholm } from "@/lib/notification-payload";
import { getMockCleaningZones } from "@/lib/mock-cleaning-zones";
import { featureContainsLngLat } from "@/lib/point-in-polygon";
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
  lat: number;
  lng: number;
  subscription?: PushSubscriptionJSON;
};

async function findZoneFeature(lat: number, lng: number): Promise<Feature | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.rpc("cleaning_zone_at_point", { lat, lng });
    if (error || !data?.length) return null;
    const row = data[0] as {
      id: string;
      street_name: string | null;
      active_period_text: string | null;
      schedule: unknown;
      geom_geojson: unknown;
    };
    return {
      type: "Feature",
      id: row.id,
      geometry: row.geom_geojson as Feature["geometry"],
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
  const { lat, lng, subscription } = body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  const feature = await findZoneFeature(lat, lng);
  if (!feature?.properties) {
    return NextResponse.json({ error: "No cleaning zone at this location" }, { status: 404 });
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
