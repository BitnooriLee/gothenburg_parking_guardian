-- Web Push: store due times for cron dispatch (server sends push; SW shows notification)
CREATE TABLE IF NOT EXISTS scheduled_push_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_push_fire_pending ON scheduled_push_alerts (fire_at)
  WHERE NOT sent;

-- Point lookup for check-in (single zone containing lng/lat)
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
AS $$
  SELECT
    c.id,
    c.street_name,
    c.active_period_text,
    c.schedule,
    ST_AsGeoJSON(c.geom)::json AS geom_geojson
  FROM cleaning_zones c
  WHERE c.geom IS NOT NULL
    AND ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
  LIMIT 1;
$$;
