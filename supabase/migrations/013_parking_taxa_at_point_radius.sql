-- Widen search radius: cleaning_zone_at_point may match within ~55 m while taxa lines often sit
-- slightly farther from GPS; 80 m keeps fee lookup aligned with real parking positions.
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
      80
    )
  ORDER BY ST_Distance(
      ST_SetSRID(ST_Force2D(t.geom), 4326)::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Nearest parking taxa row within 80m of (lat,lng) WGS84; aligns with cleaning proximity matching.';

GRANT EXECUTE ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated, service_role;
