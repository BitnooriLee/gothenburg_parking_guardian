/** Viewport-only fetch: bbox params reduce payload before GeoJSON reaches the client (vs loading all city polygons). */
import { getMockCleaningZones } from "@/lib/mock-cleaning-zones";
import { parseRpcGeomGeojson } from "@/lib/rpc-geometry";
import { createClient } from "@supabase/supabase-js";
import type { Feature, FeatureCollection } from "geojson";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function shouldLogCleaningZonesBbox(): boolean {
  return process.env.DEBUG_CLEANING_ZONES === "1" || process.env.NODE_ENV === "development";
}

/**
 * PostGIS ST_MakeEnvelope(west, south, east, north, 4326) = minLng, minLat, maxLng, maxLat (WGS84).
 * Gothenburg: longitude ~11.x, latitude ~57.x. If bbox numbers look like lat/lng were passed as west/south, log a warning.
 */
function warnIfBboxLooksLikeLatLngSwapped(west: number, south: number, east: number, north: number): void {
  if (!shouldLogCleaningZonesBbox()) return;
  const westLikeLat = west > 50 && west < 70;
  const southLikeLng = south > 5 && south < 25;
  const eastLikeLat = east > 50 && east < 70;
  const northLikeLng = north > 5 && north < 25;
  if (westLikeLat && southLikeLng && eastLikeLat && northLikeLng) {
    console.warn(
      "[api/cleaning-zones] bbox values look swapped (lat/lng vs lng/lat). Expected west/east ≈ 11.x (lng), south/north ≈ 57.x (lat) for Göteborg.",
      { west, south, east, north },
    );
  }
}

function useWorldBboxOverride(): boolean {
  return (
    process.env.DEBUG_CLEANING_ZONES_FORCE_WORLD_BBOX === "1" ||
    process.env.FORCE_WORLD_CLEANING_ZONES_BBOX === "1"
  );
}

function toFeatureCollection(rows: any[]): FeatureCollection {

  
  const features: Feature[] = [];
  for (const row of rows) {
    let geo = row.geom_geojson;
    
    // 강제로 파싱
    if (typeof geo === 'string') {
      try {
        geo = JSON.parse(geo);
      } catch (e) { continue; }
    }

    const geometry = parseRpcGeomGeojson(geo);
    if (!geometry) continue;

    features.push({
      type: "Feature",
      id: row.id,
      geometry,
      properties: { ...row }
    });
  }
  return { type: "FeatureCollection", features };
}
export async function GET(req: Request) {
  const url = new URL(req.url);
  const westRaw = url.searchParams.get("west");
  const southRaw = url.searchParams.get("south");
  const eastRaw = url.searchParams.get("east");
  const northRaw = url.searchParams.get("north");
  const west = Number(westRaw);
  const south = Number(southRaw);
  const east = Number(eastRaw);
  const north = Number(northRaw);
  const allFinite = [west, south, east, north].every((n) => Number.isFinite(n));

  if (shouldLogCleaningZonesBbox()) {
    console.info("[api/cleaning-zones] query params (west/south/east/north = minLng/minLat/maxLng/maxLat)", {
      raw: { west: westRaw, south: southRaw, east: eastRaw, north: northRaw },
      parsed: { west, south, east, north },
      types: {
        west: typeof west,
        south: typeof south,
        east: typeof east,
        north: typeof north,
      },
      allFinite,
    });
  }

  if (!allFinite) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  warnIfBboxLooksLikeLatLngSwapped(west, south, east, north);

  let rpcWest = west;
  let rpcSouth = south;
  let rpcEast = east;
  let rpcNorth = north;
  if (useWorldBboxOverride()) {
    rpcWest = -180;
    rpcSouth = -90;
    rpcEast = 180;
    rpcNorth = 90;
    if (shouldLogCleaningZonesBbox()) {
      console.warn(
        "[api/cleaning-zones] DEBUG_CLEANING_ZONES_FORCE_WORLD_BBOX=1 — using world bbox for cleaning_zones_in_bounds RPC (ignores query bbox)",
        { requested: { west, south, east, north }, rpc: { west: rpcWest, south: rpcSouth, east: rpcEast, north: rpcNorth } },
      );
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (shouldLogCleaningZonesBbox()) {
      const { count: cleaningZonesCount, error: countError } = await supabase
        .from("cleaning_zones")
        .select("*", { count: "exact", head: true });
      console.info("[api/cleaning-zones] cleaning_zones table count (head select)", {
        count: cleaningZonesCount,
        countError: countError?.message ?? null,
      });
    }

    // PostgREST sends JSON numbers only if values are JS numbers (not numeric strings).
    const rpcParams = {
      west: Number(rpcWest),
      south: Number(rpcSouth),
      east: Number(rpcEast),
      north: Number(rpcNorth),
    };
    if (shouldLogCleaningZonesBbox()) {
      console.info("[api/cleaning-zones] cleaning_zones_in_bounds RPC params (must be number)", {
        rpcParams,
        jsonSnippet: JSON.stringify(rpcParams),
        paramTypes: {
          west: typeof rpcParams.west,
          south: typeof rpcParams.south,
          east: typeof rpcParams.east,
          north: typeof rpcParams.north,
        },
      });
    }

    const { data, error } = await supabase.rpc("cleaning_zones_in_bounds", rpcParams);
    if (error) {
      console.error("[api/cleaning-zones] cleaning_zones_in_bounds RPC error", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    const rows = Array.isArray(data) ? data : [];
    if (shouldLogCleaningZonesBbox()) {
      console.info("[api/cleaning-zones] Supabase cleaning_zones_in_bounds row count", { rowCount: rows.length });
    }

    const fc = toFeatureCollection(rows);
    if (shouldLogCleaningZonesBbox() && rows.length > 0 && fc.features.length === 0) {
      console.warn(
        "[api/cleaning-zones] RPC returned rows but no features after geom_geojson parse (check geometry types / ST_AsGeoJSON)",
        { rowCount: rows.length, firstGeomGeojsonType: typeof rows[0]?.geom_geojson },
      );
    }

    if (shouldLogCleaningZonesBbox() && rows.length === 0) {
      const { data: sampleRows, error: sampleError } = await supabase
        .from("cleaning_zones")
        .select("id, geom")
        .limit(5);
      if (sampleError) {
        console.warn("[api/cleaning-zones] fallback select cleaning_zones (limit 5) failed", {
          message: sampleError.message,
          details: sampleError.details,
          hint: sampleError.hint,
          code: sampleError.code,
        });
      } else {
        const samples = Array.isArray(sampleRows) ? sampleRows : [];
        console.info("[api/cleaning-zones] RPC empty; sample rows from cleaning_zones (geom shape for bbox comparison)", {
          sampleCount: samples.length,
          samples: samples.map((r: { id?: string; geom?: unknown }) => {
            const g = r?.geom;
            let geomPreview: string;
            if (g == null) {
              geomPreview = "null";
            } else if (typeof g === "string") {
              geomPreview = g.length > 200 ? `${g.slice(0, 200)}…` : g;
            } else {
              const s = JSON.stringify(g);
              geomPreview = s.length > 400 ? `${s.slice(0, 400)}…` : s;
            }
            return {
              id: r?.id,
              geomTypeof: typeof g,
              geomPreview,
            };
          }),
        });
      }
    }

    return NextResponse.json(fc, { headers: NO_STORE_HEADERS });
  }

  if (shouldLogCleaningZonesBbox()) {
    console.info("[api/cleaning-zones] Supabase env missing; returning mock GeoJSON");
  }
  return NextResponse.json(getMockCleaningZones(), { headers: NO_STORE_HEADERS });
}
