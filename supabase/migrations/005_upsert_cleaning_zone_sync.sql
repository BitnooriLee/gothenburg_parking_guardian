-- Server-side sync: WKT → geometry, point → geography (EPSG:4326)
CREATE OR REPLACE FUNCTION public.upsert_cleaning_zone_from_sync(
  p_id TEXT,
  p_street_name TEXT,
  p_active_period_text TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_wkt TEXT,
  p_schedule JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g geometry;
BEGIN
  IF p_wkt IS NOT NULL AND length(trim(p_wkt)) > 0 THEN
    BEGIN
      g := ST_SetSRID(ST_GeomFromText(trim(p_wkt)), 4326);
    EXCEPTION WHEN OTHERS THEN
      g := NULL;
    END;
  ELSE
    g := NULL;
  END IF;

  INSERT INTO cleaning_zones (
    id,
    street_name,
    active_period_text,
    latitude,
    longitude,
    location,
    geom,
    schedule,
    updated_at
  )
  VALUES (
    p_id,
    p_street_name,
    p_active_period_text,
    p_lat,
    p_lng,
    CASE
      WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      ELSE NULL
    END,
    g,
    COALESCE(p_schedule, '{}'::jsonb),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    street_name = EXCLUDED.street_name,
    active_period_text = EXCLUDED.active_period_text,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    location = EXCLUDED.location,
    geom = EXCLUDED.geom,
    schedule = EXCLUDED.schedule,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_cleaning_zone_from_sync(TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_cleaning_zone_from_sync(TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB) TO service_role;
