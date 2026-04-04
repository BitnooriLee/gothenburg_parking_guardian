import type { Feature, FeatureCollection } from "geojson";

/** Legacy dev seed rows (see supabase/migrations/010_remove_parking_taxa_sample_seed.sql). */
const DEMO_TAXA_ID_PREFIX = "seed-taxa-demo-";

export function isDemoTaxaZoneId(id: unknown): boolean {
  if (id == null) return false;
  const s = String(id).trim();
  return s.startsWith(DEMO_TAXA_ID_PREFIX);
}

export function taxaFeatureIsDemo(f: Feature): boolean {
  if (f.id != null && f.id !== "") return isDemoTaxaZoneId(f.id);
  const props = (f.properties ?? {}) as Record<string, unknown>;
  return isDemoTaxaZoneId(props.id);
}

export function omitDemoTaxaZones(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: fc.features.filter((f) => f?.type === "Feature" && !taxaFeatureIsDemo(f)),
  };
}
