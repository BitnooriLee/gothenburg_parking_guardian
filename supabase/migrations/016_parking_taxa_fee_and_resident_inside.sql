-- Fee lookup: do not pick a Boende row unless the point lies inside that polygon (avoids 120 m edge matches outside the area).
-- Resident benefit: true only when the point is inside a Boende polygon for the selected letter.
CREATE OR REPLACE FUNCTION public.parking_taxa_at_point_for_fee(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
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
  SELECT t.id, t.taxa_name, t.hourly_rate
  FROM public.parking_taxa_zones t
  WHERE t.geom IS NOT NULL
    AND ST_DWithin(
      ST_SetSRID(ST_Force2D(t.geom), 4326)::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      120
    )
    AND (
      t.taxa_name NOT ILIKE 'Boende %'
      OR ST_Covers(
        ST_SetSRID(ST_Force2D(t.geom), 4326),
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)
      )
    )
  ORDER BY ST_Distance(
    ST_SetSRID(ST_Force2D(t.geom), 4326)::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.parking_taxa_at_point_for_fee(DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Nearest taxa within 120 m for paid-parking estimate; Boende rows only if ST_Covers(point).';

CREATE OR REPLACE FUNCTION public.point_inside_resident_boende(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  zone_letter TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.parking_taxa_zones t
    WHERE t.geom IS NOT NULL
      AND trim(zone_letter) <> ''
      AND t.taxa_name ILIKE 'Boende ' || trim(zone_letter) || '%'
      AND ST_Covers(
        ST_SetSRID(ST_Force2D(t.geom), 4326),
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)
      )
  );
$$;

COMMENT ON FUNCTION public.point_inside_resident_boende(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) IS
  'True if (lng,lat) lies inside a resident Boende polygon for the given zone letter.';

REVOKE ALL ON FUNCTION public.parking_taxa_at_point_for_fee(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parking_taxa_at_point_for_fee(DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.point_inside_resident_boende(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.point_inside_resident_boende(DOUBLE PRECISION, DOUBLE PRECISION, TEXT)
  TO anon, authenticated, service_role;
