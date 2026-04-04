export function parseRpcGeomGeojson(raw: unknown): any | null {
  if (raw == null) return null;
  
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!obj || typeof obj !== "object") return null;

  // 대소문자 무관하게 체크 (Polygon, polygon 모두 허용)
  const type = (obj.type || "").toLowerCase();
  
  const validTypes = ["polygon", "multipolygon", "linestring", "multilinestring", "point"];
  
  if (validTypes.includes(type)) {
    return obj;
  }

  // 만약 GeometryCollection이라면 첫 번째 요소를 반환하는 시도
  if (type === "geometrycollection" && obj.geometries?.[0]) {
    return obj.geometries[0];
  }

  return null;
}