import type { Feature } from "geojson";

/**
 * PostgREST may return `ST_AsGeoJSON(...)::json` as a parsed object or a JSON string.
 */
export function parseRpcGeomGeojson(raw: unknown): Feature["geometry"] | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const t = (obj as { type?: string }).type;
  if (t === "Polygon" || t === "MultiPolygon") {
    return obj as Feature["geometry"];
  }
  return null;
}
