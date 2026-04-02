import type { Feature, Polygon, MultiPolygon, Position } from "geojson";

function ringContainsPoint(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function coordsContain(lng: number, lat: number, coordinates: Position[][]): boolean {
  const outer = coordinates[0];
  if (!outer || !ringContainsPoint(outer, lng, lat)) return false;
  for (let i = 1; i < coordinates.length; i++) {
    if (ringContainsPoint(coordinates[i], lng, lat)) return false;
  }
  return true;
}

/** Point-in-polygon for GeoJSON Polygon / MultiPolygon (WGS84 lng/lat). */
export function featureContainsLngLat(
  feature: Feature,
  lng: number,
  lat: number,
): boolean {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") {
    return coordsContain(lng, lat, (g as Polygon).coordinates);
  }
  if (g.type === "MultiPolygon") {
    for (const poly of (g as MultiPolygon).coordinates) {
      if (coordsContain(lng, lat, poly)) return true;
    }
  }
  return false;
}
