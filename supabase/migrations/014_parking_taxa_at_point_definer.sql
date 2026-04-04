-- Anon callers may hit RLS on parking_taxa_zones (empty result, no error). Run lookup as definer with fixed search_path.
-- Also widen radius to 120 m so fee lines align with WFS segments vs cleaning-zone proximity.
CREATE OR REPLACE FUNCTION public.parking_taxa_at_point(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
RETURNS TABLE (
  id TEXT,
  taxa_name TEXT,
  hourly_rate NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
      120
    )
  ORDER BY ST_Distance(
      ST_SetSRID(ST_Force2D(t.geom), 4326)::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Nearest taxa within 120 m (geography); SECURITY DEFINER so RLS does not hide rows from anon RPC.';

REVOKE ALL ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parking_taxa_at_point(DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated, service_role;
