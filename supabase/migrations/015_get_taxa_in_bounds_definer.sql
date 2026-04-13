-- Align with parking_taxa_at_point (014): anon map/API calls must read taxa rows even when RLS
-- restricts direct SELECT on parking_taxa_zones (otherwise get_taxa_in_bounds returns 0 rows, no error).
CREATE OR REPLACE FUNCTION public.get_taxa_in_bounds(
  west double precision,
  south double precision,
  east double precision,
  north double precision
)
RETURNS TABLE (
  id text,
  taxa_name text,
  hourly_rate numeric,
  color_hint text,
  geom_geojson json
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.taxa_name,
    t.hourly_rate,
    t.color_hint,
    ST_AsGeoJSON(t.geom)::json AS geom_geojson
  FROM public.parking_taxa_zones t
  WHERE t.geom IS NOT NULL
    AND ST_Intersects(
      ST_SetSRID(ST_Force2D(t.geom), 4326),
      ST_MakeEnvelope(west, south, east, north, 4326)
    );
$$;

COMMENT ON FUNCTION public.get_taxa_in_bounds(double precision, double precision, double precision, double precision) IS
  'Return parking taxa rows intersecting the map bbox; SECURITY DEFINER so RLS does not hide rows from anon RPC.';

REVOKE ALL ON FUNCTION public.get_taxa_in_bounds(double precision, double precision, double precision, double precision)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_taxa_in_bounds(double precision, double precision, double precision, double precision)
  TO anon, authenticated, service_role;
