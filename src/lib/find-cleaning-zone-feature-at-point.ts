import { getMockCleaningZones } from "@/lib/mock-cleaning-zones";
import { featureContainsLngLat } from "@/lib/point-in-polygon";
import { parseRpcGeomGeojson } from "@/lib/rpc-geometry";
import { createClient } from "@supabase/supabase-js";
import type { Feature } from "geojson";

function shouldLogCleaningCheckInCoords(): boolean {
  return process.env.DEBUG_CLEANING_CHECKIN === "1" || process.env.NODE_ENV === "development";
}

/**
 * Resolve the cleaning zone GeoJSON feature at (lat, lng), same logic as parking check-in.
 */
export async function findCleaningZoneFeatureAtPoint(lat: number, lng: number): Promise<Feature | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const supabase = createClient(url, key);
    const rpcName = "cleaning_zone_at_point";
    const sqlHint =
      "ST_Covers(ST_SetSRID(ST_Force2D(c.geom),4326), ST_SetSRID(ST_MakePoint(lng,lat),4326)) LIMIT 1";

    if (shouldLogCleaningCheckInCoords()) {
      console.info(`[findCleaningZoneFeatureAtPoint/${rpcName}] RPC args`, {
        lat,
        lng,
        order: "ST_MakePoint(lng, lat) EPSG:4326",
      });
    }

    const { data, error } = await supabase.rpc(rpcName, { lat, lng });

    if (error) {
      console.warn(`[findCleaningZoneFeatureAtPoint/${rpcName}] Supabase RPC error`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return null;
    }

    const rowCount = Array.isArray(data) ? data.length : 0;
    if (rowCount === 0) {
      if (shouldLogCleaningCheckInCoords()) {
        console.warn(`[findCleaningZoneFeatureAtPoint/${rpcName}] 0 rows (no zone within RPC rules)`, {
          lat,
          lng,
          rpc: `${rpcName}({ lat, lng })`,
          matchExpression: sqlHint,
          tip: "Apply supabase/migrations/012_cleaning_zone_at_point_proximity.sql (ST_Covers + 55 m ST_DWithin fallback).",
        });
      }
      return null;
    }

    if (shouldLogCleaningCheckInCoords()) {
      console.info(`[findCleaningZoneFeatureAtPoint/${rpcName}] match`, {
        rowCount,
        zoneId: (data as { id?: string }[])[0]?.id,
      });
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
