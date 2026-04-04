-- Parking fee (Taxa) zone polygons for map overlay and pricing hints.
CREATE TABLE IF NOT EXISTS public.parking_taxa_zones (
  id TEXT PRIMARY KEY,
  taxa_name TEXT NOT NULL,
  hourly_rate NUMERIC NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  color_hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parking_taxa_zones_geom_gix
  ON public.parking_taxa_zones USING GIST (geom);

COMMENT ON TABLE public.parking_taxa_zones IS
  'Gothenburg parking tariff areas (Taxa); geometry is EPSG:4326 MultiPolygon.';

-- Viewport fetch: ST_MakeEnvelope(west, south, east, north, 4326) = minLng, minLat, maxLng, maxLat (WGS84).
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
  'Return parking taxa rows intersecting the map bbox; geom as GeoJSON json for client maps.';

GRANT EXECUTE ON FUNCTION public.get_taxa_in_bounds(double precision, double precision, double precision, double precision)
  TO anon, authenticated, service_role;
