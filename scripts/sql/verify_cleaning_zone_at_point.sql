-- Paste into Supabase Dashboard → SQL Editor (connected project).
-- Matches app RPC: cleaning_zone_at_point(lat, lng) with WGS84 decimal degrees.
-- If point tests return 0 rows in city center, apply migration 012_cleaning_zone_at_point_proximity.sql (55 m fallback).

-- Row inventory
SELECT count(*) AS cleaning_zones_total FROM public.cleaning_zones;
SELECT count(*) AS cleaning_zones_with_geom FROM public.cleaning_zones WHERE geom IS NOT NULL;

-- Point test (edit numbers to match your GPS / Park Here log)
SELECT *
FROM public.cleaning_zone_at_point(57.694122064052976::double precision, 11.954957137227227::double precision);

-- Optional: list a few polygons around central Göteborg (adjust bbox)
-- west/south/east/north = minLng, minLat, maxLng, maxLat
SELECT id, street_name
FROM public.cleaning_zones_in_bounds(11.90, 57.68, 12.02, 57.74)
LIMIT 20;
