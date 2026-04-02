-- PostGIS (Supabase: enable via Dashboard or migration)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Normalized parking rows synced from Gothenburg API + DTO payload
CREATE TABLE IF NOT EXISTS parking_spots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('public_toll', 'private_toll', 'public_time')),
  name TEXT,
  owner TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  -- Query-friendly point; use lng/lat order per EPSG:4326
  location GEOGRAPHY (POINT, 4326),
  -- Full geometry from WKT / GeoJSON (SRID 4326 on insert via ST_SetSRID)
  geom geometry,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parking_spots_location_gix ON parking_spots USING GIST (location);
CREATE INDEX IF NOT EXISTS parking_spots_geom_gix ON parking_spots USING GIST (geom);
CREATE INDEX IF NOT EXISTS parking_spots_kind_idx ON parking_spots (kind);

-- Cleaning zones (polygons / multipolygons from API WKT)
CREATE TABLE IF NOT EXISTS cleaning_zones (
  id TEXT PRIMARY KEY,
  street_name TEXT,
  active_period_text TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location GEOGRAPHY (POINT, 4326),
  geom geometry,
  -- Raw schedule + API fields for alerts (weekday, month windows, etc.)
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cleaning_zones_location_gix ON cleaning_zones USING GIST (location);
CREATE INDEX IF NOT EXISTS cleaning_zones_geom_gix ON cleaning_zones USING GIST (geom);
