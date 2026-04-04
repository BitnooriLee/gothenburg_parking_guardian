-- WFS Taxa layers are street segments (LineString), not polygons; allow any 2D geometry in 4326.
ALTER TABLE public.parking_taxa_zones
  ALTER COLUMN geom TYPE geometry(Geometry, 4326)
  USING ST_SetSRID(ST_Force2D(geom), 4326);

COMMENT ON TABLE public.parking_taxa_zones IS
  'Gothenburg parking tariff areas (Taxa); geometry is EPSG:4326 (LineString from WFS and/or polygon overlays).';
