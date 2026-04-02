-- RPC: fetch cleaning zone rows whose geometry intersects the map viewport (WGS84).
CREATE OR REPLACE FUNCTION public.cleaning_zones_in_bounds(
  west double precision,
  south double precision,
  east double precision,
  north double precision
)
RETURNS TABLE (
  id text,
  street_name text,
  active_period_text text,
  schedule jsonb,
  geom_geojson json
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.street_name,
    c.active_period_text,
    c.schedule,
    ST_AsGeoJSON(c.geom)::json AS geom_geojson
  FROM cleaning_zones c
  WHERE c.geom IS NOT NULL
    AND ST_Intersects(c.geom, ST_MakeEnvelope(west, south, east, north, 4326));
$$;
