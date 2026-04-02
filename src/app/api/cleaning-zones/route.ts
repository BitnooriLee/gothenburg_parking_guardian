/** Viewport-only fetch: bbox params reduce payload before GeoJSON reaches the client (vs loading all city polygons). */
import { getMockCleaningZones } from "@/lib/mock-cleaning-zones";
import { createClient } from "@supabase/supabase-js";
import type { Feature, FeatureCollection } from "geojson";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toFeatureCollection(rows: { id: string; street_name: string | null; active_period_text: string | null; schedule: unknown; geom_geojson: unknown }[]): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    if (!row.geom_geojson || typeof row.geom_geojson !== "object") continue;
    features.push({
      type: "Feature",
      id: row.id,
      geometry: row.geom_geojson as Feature["geometry"],
      properties: {
        id: row.id,
        street_name: row.street_name ?? "",
        active_period_text: row.active_period_text ?? "",
        schedule: row.schedule ?? {},
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const west = Number(url.searchParams.get("west"));
  const south = Number(url.searchParams.get("south"));
  const east = Number(url.searchParams.get("east"));
  const north = Number(url.searchParams.get("north"));
  if (![west, south, east, north].every((n) => Number.isFinite(n))) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.rpc("cleaning_zones_in_bounds", {
      west,
      south,
      east,
      north,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(toFeatureCollection(data ?? []));
  }

  return NextResponse.json(getMockCleaningZones());
}
