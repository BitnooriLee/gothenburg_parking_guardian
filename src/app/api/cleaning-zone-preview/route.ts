import { findCleaningZoneFeatureAtPoint } from "@/lib/find-cleaning-zone-feature-at-point";
import { formatNextCleaningLabel, scheduleFromZoneProperties } from "@/lib/cleaning-safety";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseAt(searchParams: URLSearchParams): Date {
  const raw = searchParams.get("at");
  if (raw == null || raw.trim() === "") return new Date();
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

/**
 * GET ?lat=&lng=&at= (optional ISO time, aligns with map time slider)
 * Returns cleaning schedule summary for a point without creating a session.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng must be finite numbers" }, { status: 400 });
  }

  const at = parseAt(url.searchParams);
  const feature = await findCleaningZoneFeatureAtPoint(lat, lng);
  if (!feature?.properties) {
    return NextResponse.json({ found: false as const });
  }

  const props = feature.properties as Record<string, unknown>;
  const streetName = String(props.street_name || props.id || "Zone");
  const schedule = scheduleFromZoneProperties(props);
  const nextLabel = formatNextCleaningLabel(at, schedule);
  const activePeriodText = String(props.active_period_text ?? "");

  return NextResponse.json({
    found: true as const,
    streetName,
    nextLabel,
    activePeriodText,
  });
}
