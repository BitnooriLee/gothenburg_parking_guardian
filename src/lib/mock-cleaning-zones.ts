import type { FeatureCollection, Polygon } from "geojson";

const C = { lng: 11.9746, lat: 57.7089 };

function rect(dLng: number, dLat: number, size: number): Polygon {
  const { lng, lat } = C;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng + dLng - size, lat + dLat - size],
        [lng + dLng + size, lat + dLat - size],
        [lng + dLng + size, lat + dLat + size],
        [lng + dLng - size, lat + dLat + size],
        [lng + dLng - size, lat + dLat - size],
      ],
    ],
  };
}

/** Demo data when Supabase env is not configured. */
export function getMockCleaningZones(): FeatureCollection {
  const now = Date.now();
  const iso = (h: number) => new Date(now + h * 3600000).toISOString();

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "mock-safe",
        geometry: rect(-0.012, 0.006, 0.004),
        properties: {
          id: "mock-safe",
          street_name: "Demo: safe (>48h)",
          active_period_text: "Vardagar",
          schedule: { nextCleaningStart: iso(72), ActivePeriodText: "Vardagar" },
        },
      },
      {
        type: "Feature",
        id: "mock-warn",
        geometry: rect(0.008, 0.004, 0.0035),
        properties: {
          id: "mock-warn",
          street_name: "Demo: warning (6–48h)",
          active_period_text: "Vardagar",
          schedule: { nextCleaningStart: iso(18), ActivePeriodText: "Vardagar" },
        },
      },
      {
        type: "Feature",
        id: "mock-danger",
        geometry: rect(0.002, -0.005, 0.003),
        properties: {
          id: "mock-danger",
          street_name: "Demo: danger (≤6h)",
          active_period_text: "Vardagar",
          schedule: { nextCleaningStart: iso(4), ActivePeriodText: "Vardagar" },
        },
      },
    ],
  };
}
