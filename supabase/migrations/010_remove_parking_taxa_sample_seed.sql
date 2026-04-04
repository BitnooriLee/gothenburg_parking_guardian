-- Drop dev/demo Taxa polygons that were seeded near central Göteborg (ids from 008_seed_parking_taxa_sample.sql).
DELETE FROM public.parking_taxa_zones
WHERE id IN (
  'seed-taxa-demo-1',
  'seed-taxa-demo-2',
  'seed-taxa-demo-3',
  'seed-taxa-demo-4'
);
