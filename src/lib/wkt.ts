import type { Geometry } from "geojson";
import { parse as parseWkt } from "wellknown";

/**
 * Converts API WKT to GeoJSON Geometry for Mapbox / PostGIS round-trip.
 * Returns null when input is empty or parsing fails.
 */
export function wktToGeometry(wkt: string | null | undefined): Geometry | null {
  if (wkt == null) return null;
  const s = String(wkt).trim();
  if (!s) return null;
  const parsed = parseWkt(s);
  return (parsed as Geometry | null) ?? null;
}
