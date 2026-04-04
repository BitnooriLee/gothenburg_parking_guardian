/** Viewport-only fetch for parking taxa (fee) zones — same bbox contract as cleaning-zones. */
import { parseRpcGeomGeojson } from "@/lib/rpc-geometry";
import { isDemoTaxaZoneId, omitDemoTaxaZones } from "@/lib/taxa-demo-filter";
import { createClient } from "@supabase/supabase-js";
import type { Feature, FeatureCollection } from "geojson";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function shouldLogTaxaBbox(): boolean {
  return process.env.DEBUG_PARKING_TAXA === "1" || process.env.NODE_ENV === "development";
}

function toFeatureCollection(rows: Record<string, unknown>[]): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    if (isDemoTaxaZoneId(row.id)) continue;
    let geo = row.geom_geojson;

    if (typeof geo === "string") {
      try {
        geo = JSON.parse(geo) as unknown;
      } catch {
        continue;
      }
    }

    const geometry = parseRpcGeomGeojson(geo);
    if (!geometry) continue;

    const { geom_geojson: _g, ...rest } = row;
    features.push({
      type: "Feature",
      id: row.id as string | number | undefined,
      geometry,
      properties: {
        id: rest.id,
        taxa_name: rest.taxa_name,
        hourly_rate: rest.hourly_rate,
        color_hint: rest.color_hint,
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
  const allFinite = [west, south, east, north].every((n) => Number.isFinite(n));

  if (!allFinite) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    if (shouldLogTaxaBbox()) {
      console.info("[api/parking-taxa] Supabase env missing; returning empty FeatureCollection");
    }
    return NextResponse.json(
      { type: "FeatureCollection", features: [] } satisfies FeatureCollection,
      { headers: NO_STORE_HEADERS },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  /** Matches `get_taxa_in_bounds`: ST_MakeEnvelope(west, south, east, north, 4326) — WGS84 minLng/minLat/maxLng/maxLat. */
  const rpcParams = {
    west: Number(west),
    south: Number(south),
    east: Number(east),
    north: Number(north),
  };

  if (shouldLogTaxaBbox()) {
    console.info("[api/parking-taxa] get_taxa_in_bounds RPC params", rpcParams);
  }

  const { data, error } = await supabase.rpc("get_taxa_in_bounds", rpcParams);
  if (error) {
    console.error("[api/parking-taxa] get_taxa_in_bounds RPC error", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (shouldLogTaxaBbox()) {
    console.info("[api/parking-taxa] get_taxa_in_bounds row count", { rowCount: rows.length });
  }

  const fc = omitDemoTaxaZones(toFeatureCollection(rows));
  return NextResponse.json(fc, { headers: NO_STORE_HEADERS });
}
