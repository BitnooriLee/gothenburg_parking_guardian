-- Many Gothenburg cleaning WKT geometries are narrow or offset from GPS; ST_Covers(point-in-polygon)
-- often misses real parking positions. Prefer exact cover, then nearest zone within a small ground distance.
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
    s.id,
    s.street_name,
    s.active_period_text,
    s.schedule,
    s.geom_geojson
  FROM (
    SELECT
      c.id,
      c.street_name,
      c.active_period_text,
      c.schedule,
      ST_AsGeoJSON(c.geom)::json AS geom_geojson,
      ST_SetSRID(ST_Force2D(c.geom), 4326) AS g2d,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326) AS pt
    FROM cleaning_zones c
    WHERE c.geom IS NOT NULL
  ) s
  WHERE
    ST_Covers(s.g2d, s.pt)
    OR ST_DWithin(
      s.g2d::geography,
      s.pt::geography,
      55
    )
  ORDER BY
    CASE WHEN ST_Covers(s.g2d, s.pt) THEN 0 ELSE 1 END,
    ST_Distance(s.g2d::geography, s.pt::geography) ASC NULLS LAST
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.cleaning_zone_at_point(DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Cleaning zone for (lat,lng): exact ST_Covers if possible, else nearest geometry within 55 m (geography).';
