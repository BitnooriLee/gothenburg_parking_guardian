"use client";

/**
 * Mapbox GL: one GeoJSON Source → one fill Layer (Mapbox-native pattern).
 * - Source id `cleaning-zones`, type `geojson`, `data` = FeatureCollection from API.
 * - Layer id `cleaning-safety-fill`, type `fill`; paint uses data-driven expressions on `properties.safety`.
 *
 * Performance at scale:
 * - BBox filtering: `/api/cleaning-zones?west&south&east&north` + Supabase `ST_Intersects` (see migration) loads only viewport polygons.
 * - Heavier loads: prefer vector tiles (Tippecanoe/MBTiles, Mapbox Tilesets, or PostGIS ST_AsMVT) and switch Source to `type: "vector"` + vector Layers.
 *
 * Time simulation: `targetTime` is the simulated instant (now + slider offset). Deferred for slider responsiveness.
 * Cleaning polygons use `getCleaningSafetyLevel` → `properties.safety` → fill paint. For Swedish **parking** text rules,
 * use `parseSwedishRestriction` + `isCurrentlyFree` (parser) on parking features when that layer is added — not wired here.
 */

import {
  formatNextCleaningLabel,
  getCleaningSafetyLevel,
  type CleaningSchedule,
} from "@/lib/cleaning-safety";
import Map, { GeolocateControl, Layer, NavigationControl, Popup, Source } from "react-map-gl/mapbox";
import type { Feature, FeatureCollection } from "geojson";
import ParkHereBar from "@/components/ParkHereBar";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

function coerceNumber(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** GeoJSON may carry numeric coords as strings from ETL / JSONB; Mapbox expects numbers. */
function normalizeLngLatPair(c: unknown): [number, number] | null {
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = coerceNumber(c[0]);
  const lat = coerceNumber(c[1]);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

function normalizeRing(ring: unknown): [number, number][] | null {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const out: [number, number][] = [];
  for (const c of ring) {
    const p = normalizeLngLatPair(c);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** Return WGS84 Polygon/MultiPolygon with numeric coordinates, or null if unusable. */
function normalizeZoneGeometry(g: Feature["geometry"] | null | undefined): Feature["geometry"] | null {
  if (!g) return null;
  if (g.type === "Polygon") {
    const ringsIn = g.coordinates;
    if (!Array.isArray(ringsIn)) return null;
    const coordinates: [number, number][][] = [];
    for (const ring of ringsIn) {
      const r = normalizeRing(ring);
      if (!r) return null;
      coordinates.push(r);
    }
    if (coordinates.length === 0 || coordinates[0].length < 4) return null;
    return { type: "Polygon", coordinates };
  }
  if (g.type === "MultiPolygon") {
    const polysIn = g.coordinates;
    if (!Array.isArray(polysIn) || polysIn.length === 0) return null;
    const coordinates: [number, number][][][] = [];
    for (const poly of polysIn) {
      if (!Array.isArray(poly) || poly.length === 0) return null;
      const rings: [number, number][][] = [];
      for (const ring of poly) {
        const r = normalizeRing(ring);
        if (!r) return null;
        rings.push(r);
      }
      if (rings.length === 0 || rings[0].length < 4) return null;
      coordinates.push(rings);
    }
    return { type: "MultiPolygon", coordinates };
  }
  return null;
}

function sanitizeFeatureCollection(input: unknown): FeatureCollection | null {
  if (!input || typeof input !== "object") return null;
  const fc = input as FeatureCollection;
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return null;
  const features: Feature[] = [];
  for (const f of fc.features) {
    if (f?.type !== "Feature") continue;
    const geometry = normalizeZoneGeometry(f.geometry);
    if (!geometry) continue;
    features.push({ ...f, geometry });
  }
  return { type: "FeatureCollection", features };
}

const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const INITIAL_VIEW = {
  longitude: 11.9746,
  latitude: 57.7089,
  zoom: 13,
};

const SOURCE_ID = "cleaning-zones";
const FILL_LAYER_ID = "cleaning-safety-fill";
const LINE_LAYER_ID = "cleaning-safety-outline";

type PopupState = {
  longitude: number;
  latitude: number;
  title: string;
  nextLabel: string;
};

function enrichCollection(fc: FeatureCollection, targetTime: Date): FeatureCollection {
  const features = Array.isArray(fc?.features) ? fc.features : [];
  return {
    ...fc,
    features: features.map((f) => {
      const schedule = (f?.properties?.schedule ?? {}) as CleaningSchedule;
      const { level } = getCleaningSafetyLevel(targetTime, schedule);
      return {
        ...f,
        properties: {
          ...(f.properties ?? {}),
          safety: level,
          nextLabel: formatNextCleaningLabel(targetTime, schedule),
        },
      };
    }),
  };
}

export default function CleaningSafetyMap() {
  // Inlined at build time for client bundle; Mapbox GL requires a non-zero container (see flex layout below).
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [rawFc, setRawFc] = useState<FeatureCollection | null>(null);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zonesLoadedOnce, setZonesLoadedOnce] = useState(false);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [offsetHours, setOffsetHours] = useState(0);
  const [popup, setPopup] = useState<PopupState | null>(null);
  /** Mapbox GL / mapLib dynamic import or map construction failures (shown in UI). */
  const [mapInitError, setMapInitError] = useState<string | null>(null);
  /** True after Map `onLoad` — base map must never be covered by a full-screen zones fetch overlay. */
  const [mapReady, setMapReady] = useState(false);

  /** Simulated “current” instant for safety / next-cleaning logic (Stockholm-relative in lib). */
  const targetTime = useMemo(() => new Date(Date.now() + offsetHours * 3600000), [offsetHours]);
  const deferredTargetTime = useDeferredValue(targetTime);

  const geojson = useMemo(() => {
    if (!rawFc) return null;
    return enrichCollection(rawFc, deferredTargetTime);
  }, [rawFc, deferredTargetTime]);

  const loadZones = useCallback(async (bounds: { west: number; south: number; east: number; north: number }) => {
    setZonesLoading(true);
    setZonesError(null);
    const q = new URLSearchParams({
      west: String(bounds.west),
      south: String(bounds.south),
      east: String(bounds.east),
      north: String(bounds.north),
    });
    try {
      const res = await fetch(`/api/cleaning-zones?${q}`);
      if (!res.ok) {
        setZonesError(`Zones request failed (${res.status})`);
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        setZonesError("Could not read zones response");
        return;
      }
      if (json == null || typeof json !== "object") {
        setZonesError("Invalid zones response");
        return;
      }
      const errBody = json as { error?: unknown };
      if (typeof errBody.error === "string") {
        setZonesError(errBody.error);
        return;
      }
      const parsed = sanitizeFeatureCollection(json);
      if (!parsed) {
        setZonesError("Invalid zones response");
        return;
      }
      setRawFc(parsed);
    } catch {
      setZonesError("Could not load cleaning zones");
    } finally {
      setZonesLoading(false);
      setZonesLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    const w = 11.85;
    const e = 12.1;
    const s = 57.65;
    const n = 57.78;
    void loadZones({ west: w, south: s, east: e, north: n });
  }, [loadZones]);

  /** Dev-only: confirms props before Map mounts; if onLoad never fires, compare with Mapbox account / env. */
  useEffect(() => {
    if (!token || process.env.NODE_ENV !== "development") return;
    const t = token.trim();
    console.info("[CleaningSafetyMap] Mapbox props (dev)", {
      mapStyle: MAP_STYLE,
      mapboxAccessTokenToMap: true,
      tokenLength: t.length,
      tokenStartsWithPkDot: t.startsWith("pk."),
    });
  }, [token]);

  if (!token) {
    return (
      <div
        className="flex h-[100vh] min-h-[100vh] w-[100vw] max-w-[100vw] items-center justify-center overflow-x-hidden bg-[#F9FAFB] p-6 text-center text-sm text-neutral-600"
        data-gpg-map-blocker="missing-mapbox-token"
        role="status"
      >
        <div>
          <p className="font-medium text-neutral-800">Map blocked: missing token</p>
          <p className="mt-2">
            Set <code className="rounded bg-neutral-200 px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code className="rounded bg-neutral-200 px-1">.env.local</code> and restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-gpg-cleaning-safety-map="1" style={{ isolation: "isolate" }}>
      {(() => {
        console.log(
          "[CleaningSafetyMap] mapboxAccessToken above Map:",
          token === undefined ? "undefined" : `defined, length ${String(token).length}`,
        );
        return null;
      })()}
      <Map
        id="map"
        mapboxAccessToken={token}
        mapStyle={MAP_STYLE}
        initialViewState={INITIAL_VIEW}
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 0,
        }}
        interactive
        interactiveLayerIds={[FILL_LAYER_ID]}
        onLoad={() => {
          console.log("Map Loaded!");
          setMapInitError(null);
          setMapReady(true);
        }}
        onRender={() => {
          console.log("MAP_RENDERING");
        }}
        onError={(evt) => {
          const err =
            evt && typeof evt === "object" && "error" in evt && (evt as { error?: unknown }).error != null
              ? (evt as { error: unknown }).error
              : evt;
          setMapInitError(err instanceof Error ? err.message : String(err));
        }}
        onClick={(e) => {
          const f = e.features?.[0];
          const props = f?.properties;
          if (!props) {
            setPopup(null);
            return;
          }
          const lngLat = e.lngLat;
          setPopup({
            longitude: lngLat.lng,
            latitude: lngLat.lat,
            title: String(props.street_name ?? props.id ?? "Zone"),
            nextLabel: String(props.nextLabel ?? ""),
          });
        }}
        onMoveEnd={(e) => {
          const b = e.target.getBounds();
          if (!b) return;
          void loadZones({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          });
        }}
      >
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-left" trackUserLocation />

        {geojson && (
          <Source id={SOURCE_ID} type="geojson" data={geojson}>
            <Layer
              id={FILL_LAYER_ID}
              type="fill"
              paint={{
                "fill-color": [
                  "match",
                  ["get", "safety"],
                  "danger",
                  "#EF4444",
                  "warning",
                  "#F59E0B",
                  "safe",
                  "#10B981",
                  "#94A3B8",
                ],
                "fill-opacity": [
                  "match",
                  ["get", "safety"],
                  "danger",
                  0.8,
                  "warning",
                  0.6,
                  "safe",
                  0.4,
                  0.35,
                ],
                "fill-outline-color": "#64748b",
              }}
            />
            <Layer
              id={LINE_LAYER_ID}
              type="line"
              paint={{
                "line-color": "#334155",
                "line-width": 1.5,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        )}

        {popup && (
          <Popup
            longitude={popup.longitude}
            latitude={popup.latitude}
            anchor="bottom"
            onClose={() => setPopup(null)}
            closeOnClick={false}
          >
            <div className="max-w-xs text-sm">
              <div className="font-medium text-neutral-900">{popup.title}</div>
              <div className="mt-1 text-neutral-600">
                Nästa städning / Next: {popup.nextLabel}
              </div>
            </div>
          </Popup>
        )}
      </Map>

      <div
        className="fixed inset-0 z-10 flex min-h-0 flex-col"
        style={{ pointerEvents: "none" }}
      >
        <div className="flex w-full shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 py-2 backdrop-blur">
          <label
            className="flex min-w-[220px] flex-1 items-center gap-2 text-xs text-neutral-700"
            style={{ pointerEvents: "auto" }}
          >
            <span className="whitespace-nowrap">Time (+h)</span>
            <input
              type="range"
              min={-48}
              max={120}
              step={0.25}
              value={offsetHours}
              onChange={(e) => setOffsetHours(Number(e.target.value))}
              className="h-2 flex-1 accent-emerald-600"
            />
            <span className="w-14 tabular-nums">
              {offsetHours >= 0 ? "+" : ""}
              {offsetHours.toFixed(1)}h
            </span>
          </label>
        </div>

        <div className="relative min-h-0 flex-1" style={{ pointerEvents: "none" }}>
          {zonesLoading && !zonesLoadedOnce && !mapReady && (
            <div
              className="pointer-events-none absolute inset-0 z-[5] flex flex-col gap-3 bg-[#F9FAFB]/80 p-4 backdrop-blur-sm"
              aria-busy
              aria-label="Loading map"
            >
              <div className="h-3 w-48 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-full max-w-md animate-pulse rounded bg-neutral-200" />
              <div className="mt-4 h-40 w-full animate-pulse rounded-lg bg-neutral-200/80" />
            </div>
          )}
          {zonesLoading && !zonesLoadedOnce && mapReady && (
            <div
              className="pointer-events-none absolute bottom-4 left-4 z-[8] rounded-md border border-neutral-200 bg-white/95 px-2 py-1 text-[10px] text-neutral-600 shadow-sm backdrop-blur"
              aria-busy
              aria-label="Loading cleaning zones"
            >
              Loading zones…
            </div>
          )}
          {zonesLoading && zonesLoadedOnce && (
            <div
              className="pointer-events-none absolute left-0 right-0 top-0 z-[5] h-0.5 animate-pulse bg-emerald-600/40"
              aria-busy
              aria-label="Updating zones"
            />
          )}
          {zonesError && (
            <div className="absolute left-4 right-4 top-3 z-[6] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
              {zonesError}
            </div>
          )}
          {mapInitError && (
            <div
              className="absolute left-4 right-4 top-14 z-[7] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-sm"
              data-gpg-map-blocker="mapbox-init-error"
              role="alert"
            >
              Map failed to initialize: {mapInitError}
            </div>
          )}
          <div
            className="max-w-[min(100vw-1.5rem,42rem)] px-3"
            style={{
              position: "absolute",
              top: 20,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10,
              pointerEvents: "none",
            }}
          >
            <ParkHereBar />
          </div>
        </div>
      </div>
    </div>
  );
}
