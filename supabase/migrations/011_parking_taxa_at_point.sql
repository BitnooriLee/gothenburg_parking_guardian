-- Point / nearest taxa: WFS rows are often LineString; use geography distance (meters), not ST_Covers.
CREATE OR REPLACE FUNCTION public.parking_taxa_at_point(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
RETURNS TABLE (
  id TEXT,
  taxa_name TEXT,
  hourly_rate NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    t.id,
    t.taxa_name,
    t.hourly_rate
  FROM public.parking_taxa_zones t
  WHERE t.geom IS NOT NULL
    AND ST_DWithin(
      ST_SetSRID(ST_Force2D(t.geom), 4326)::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      40
    )
  ORDER BY ST_Distance(
      ST_SetSRID(ST_Force2D(t.geom), 4326)::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Nearest parking taxa row within 40m of (lat,lng) WGS84; supports LineString segments and polygons.';

GRANT EXECUTE ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated, service_role;
