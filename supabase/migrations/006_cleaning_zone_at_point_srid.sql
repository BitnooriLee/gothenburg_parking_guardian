-- Align SRID for point-in-polygon: stored geom may be SRID 0 if inserted without ST_SetSRID.
-- User point is always EPSG:4326 (lng, lat). Both operands must use the same SRID for ST_Covers/ST_Contains.
CREATE OR REPLACE FUNCTION public.cleaning_zone_at_point(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
RETURNS TABLE (
  id TEXT,
  street_name TEXT,
  active_period_text TEXT,
  schedule JSONB,
  geom_geojson JSON
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    c.street_name,
    c.active_period_text,
    c.schedule,
    ST_AsGeoJSON(c.geom)::json AS geom_geojson
  FROM cleaning_zones c
  WHERE c.geom IS NOT NULL
    AND ST_Covers(
      ST_SetSRID(ST_Force2D(c.geom), 4326),
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.cleaning_zone_at_point(DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Find cleaning zone containing (lat,lng) in WGS84. Normalizes c.geom to SRID 4326 before ST_Covers with ST_MakePoint(lng,lat).';

-- Same SRID normalization for viewport fetch (map vs check-in must agree).
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
SET search_path = public
AS $$
  SELECT
    c.id,
    c.street_name,
    c.active_period_text,
    c.schedule,
    ST_AsGeoJSON(c.geom)::json AS geom_geojson
  FROM cleaning_zones c
  WHERE c.geom IS NOT NULL
    AND ST_Intersects(
      ST_SetSRID(ST_Force2D(c.geom), 4326),
      ST_MakeEnvelope(west, south, east, north, 4326)
    );
$$;
