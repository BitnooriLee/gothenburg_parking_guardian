"use client";

/**
 * Mapbox GL: one GeoJSON Source → one line Layer (strokes polygons and line geometries).
 * - Source id `cleaning-zones`, type `geojson`, `data` = FeatureCollection from API.
 * - Layer id `cleaning-safety-line`, type `line`; paint uses data-driven expressions on `properties.safety`.
 *
 * Performance at scale:
 * - BBox filtering: `/api/cleaning-zones?west&south&east&north` + Supabase `ST_Intersects` (see migration) loads only viewport geometries.
 * - Viewport refetch: debounced `onMoveEnd` only (no fetch during pan `move`), plus rounded-bbox dedupe, AbortController, and request-generation guards against overlapping responses.
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
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  useMap,
} from "react-map-gl/mapbox";
import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";
import type { Feature, FeatureCollection } from "geojson";
import ParkHereBar from "@/components/ParkHereBar";
import ParkingSettings from "@/components/ParkingSettings";
import { useResidentZone } from "@/contexts/ResidentZoneContext";
import { omitDemoTaxaZones } from "@/lib/taxa-demo-filter";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LocateFixed } from "lucide-react";

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

/** Return WGS84 Polygon/MultiPolygon/LineString/MultiLineString with numeric coordinates, or null if unusable. */
function normalizeZoneGeometry(g: Feature["geometry"] | null | undefined): Feature["geometry"] | null {
  if (!g) return null;
  if (g.type === "LineString") {
    const ptsIn = g.coordinates;
    if (!Array.isArray(ptsIn)) return null;
    const coordinates: [number, number][] = [];
    for (const c of ptsIn) {
      const p = normalizeLngLatPair(c);
      if (!p) return null;
      coordinates.push(p);
    }
    if (coordinates.length < 2) return null;
    return { type: "LineString", coordinates };
  }
  if (g.type === "MultiLineString") {
    const linesIn = g.coordinates;
    if (!Array.isArray(linesIn) || linesIn.length === 0) return null;
    const coordinates: [number, number][][] = [];
    for (const line of linesIn) {
      if (!Array.isArray(line)) return null;
      const segment: [number, number][] = [];
      for (const c of line) {
        const p = normalizeLngLatPair(c);
        if (!p) return null;
        segment.push(p);
      }
      if (segment.length < 2) return null;
      coordinates.push(segment);
    }
    return { type: "MultiLineString", coordinates };
  }
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
const ZONE_LINE_LAYER_ID = "cleaning-safety-line";

const TAXA_SOURCE_ID = "parking-taxa";
/** Line layer (WFS taxa segments are LineString, not polygons). */
const TAXA_LINE_LAYER_ID = "parking-taxa-line";

const TAXA_LINE_BASE_WIDTH = 5;
const TAXA_LINE_RESIDENT_EXTRA_WIDTH = 2;
const TAXA_LINE_RESIDENT_COLOR = "#3b82f6";

/** Default taxa line colors by `taxa_name` (before resident highlight). */
const TAXA_LINE_BASE_COLOR_EXPR: ExpressionSpecification = [
  "match",
  ["get", "taxa_name"],
  "Taxa 1",
  "#ef4444",
  "Taxa A",
  "#ef4444",
  "Taxa 2",
  "#f97316",
  "Taxa B",
  "#f97316",
  "Taxa 3",
  "#facc15",
  "Taxa C",
  "#facc15",
  "Taxa 4",
  "#eab308",
  "Taxa 5",
  "#ca8a04",
  "Taxa 6",
  "#a16207",
  "Taxa 7",
  "#22c55e",
  "Taxa 8",
  "#14b8a6",
  "Taxa 9",
  "#0d9488",
  "Taxa 12",
  "#fb923c",
  "Taxa 22",
  "#84cc16",
  "Taxa 24",
  "#65a30d",
  "Taxa 62",
  "#78716c",
  "#94a3b8",
];

/** Rounded key so tiny float jitter does not re-trigger cleaning-zones fetches. */
function viewportBoundsKey(bounds: { west: number; south: number; east: number; north: number }): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(bounds.west)},${r(bounds.south)},${r(bounds.east)},${r(bounds.north)}`;
}

const MOVE_END_DEBOUNCE_MS = 320;

const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Dev-only: after the style is idle, confirm react-map-gl Source/Layer ids exist on the Mapbox map.
 */
function CleaningZonesRegistrationDiagnostics({
  featureCount,
  mapReady,
  sourceShouldBeMounted,
}: {
  featureCount: number;
  mapReady: boolean;
  sourceShouldBeMounted: boolean;
}) {
  const { current: mapRef } = useMap();

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !mapRef) return;
    const map = mapRef.getMap();

    const logRegistration = () => {
      try {
        const src = map.getSource(SOURCE_ID) as { type?: string } | undefined;
        const zoneLine = map.getLayer(ZONE_LINE_LAYER_ID);
        console.info("[CleaningSafetyMap] Mapbox Source/Layer registration (idle)", {
          mapReady,
          sourceShouldBeMounted,
          sourceId: SOURCE_ID,
          sourcePresent: Boolean(src),
          sourceType: src?.type ?? null,
          zoneLineLayerId: ZONE_LINE_LAYER_ID,
          zoneLineLayerPresent: Boolean(zoneLine),
          geojsonFeatureCount: featureCount,
          hint:
            !mapReady
              ? "Source is not rendered until mapReady (avoid registering GeoJSON before style load)."
              : !sourceShouldBeMounted
                ? "Unexpected: mapReady but sourceShouldBeMounted false."
                : !src
                  ? "React <Source> may not have committed yet, or id mismatch — wait for next idle after zones fetch."
                  : "OK",
        });
      } catch (e) {
        console.warn("[CleaningSafetyMap] Source/Layer registration check failed", e);
      }
    };

    map.once("idle", logRegistration);
    return () => {
      map.off("idle", logRegistration);
    };
  }, [mapRef, featureCount, mapReady, sourceShouldBeMounted]);

  return null;
}

function GeolocateMapButton({
  getMap,
  onLocated,
}: {
  getMap: () => MapboxMap | null | undefined;
  onLocated: (lng: number, lat: number) => void;
}) {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(() => {
    if (!navigator.geolocation) return;
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        onLocated(lng, lat);
        const m = getMap();
        if (m && Number.isFinite(lng) && Number.isFinite(lat)) {
          m.flyTo({
            center: [lng, lat],
            zoom: Math.max(m.getZoom(), 14),
            essential: true,
          });
        }
        setPending(false);
      },
      () => setPending(false),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }, [getMap, onLocated]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="gpg-map-float pointer-events-auto fixed bottom-24 right-4 z-[9999] flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 shadow-lg transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60"
      aria-label="Find my location — Hitta min position"
      title="Hitta min position"
    >
      <LocateFixed className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

type MapPopupState =
  | {
      kind: "cleaning";
      longitude: number;
      latitude: number;
      title: string;
      nextLabel: string;
    }
  | {
      kind: "taxa";
      longitude: number;
      latitude: number;
      taxa_name: string;
      hourly_rate_label: string;
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
  const { residentZone } = useResidentZone();
  // Inlined at build time for client bundle; Mapbox GL requires a non-zero container (see flex layout below).
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [rawFc, setRawFc] = useState<FeatureCollection | null>(null);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zonesLoadedOnce, setZonesLoadedOnce] = useState(false);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [offsetHours, setOffsetHours] = useState(0);
  const [popup, setPopup] = useState<MapPopupState | null>(null);
  const [rawTaxaFc, setRawTaxaFc] = useState<FeatureCollection | null>(null);
  const [taxaLoading, setTaxaLoading] = useState(true);
  const [taxaLoadedOnce, setTaxaLoadedOnce] = useState(false);
  const [taxaError, setTaxaError] = useState<string | null>(null);
  /** Last geolocation used for the clickable user marker (Mapbox GeolocateControl drives updates). */
  const [userLngLat, setUserLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [userLocationPopupOpen, setUserLocationPopupOpen] = useState(false);
  /** Mapbox GL / mapLib dynamic import or map construction failures (shown in UI). */
  const [mapInitError, setMapInitError] = useState<string | null>(null);
  /** True after Map `onLoad` — base map must never be covered by a full-screen zones fetch overlay. */
  const [mapReady, setMapReady] = useState(false);

  const mapHandleRef = useRef<MapboxMap | null>(null);
  const getMapHandle = useCallback(() => mapHandleRef.current, []);

  const lastSuccessBoundsKeyRef = useRef<string | null>(null);
  const moveEndDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zonesFetchAbortRef = useRef<AbortController | null>(null);
  /** Monotonic id so aborted / overlapping cleaning-zones fetches do not corrupt loading state. */
  const zonesRequestGenRef = useRef(0);
  const taxaRequestGenRef = useRef(0);
  const lastSuccessTaxaBoundsKeyRef = useRef<string | null>(null);
  const taxaFetchAbortRef = useRef<AbortController | null>(null);

  /** Simulated “current” instant for safety / next-cleaning logic (Stockholm-relative in lib). */
  const targetTime = useMemo(() => new Date(Date.now() + offsetHours * 3600000), [offsetHours]);
  const deferredTargetTime = useDeferredValue(targetTime);

  const geojson = useMemo(() => {
    if (!rawFc) return null;
    return enrichCollection(rawFc, deferredTargetTime);
  }, [rawFc, deferredTargetTime]);

  /** Enriched empty collection so Mapbox Source/Layers exist after map load even before the first zones response. */
  const emptyEnriched = useMemo(
    () => enrichCollection(EMPTY_FEATURE_COLLECTION, deferredTargetTime),
    [deferredTargetTime],
  );

  const zonesForSource = mapReady ? (geojson ?? emptyEnriched) : null;
  const geojsonFeatureCount = zonesForSource?.features?.length ?? 0;

  const taxaGeojson = useMemo(() => {
    if (!rawTaxaFc) return null;
    return sanitizeFeatureCollection(rawTaxaFc);
  }, [rawTaxaFc]);

  const taxaForSource = mapReady ? (taxaGeojson ?? EMPTY_FEATURE_COLLECTION) : null;

  const taxaLinePaint = useMemo(() => {
    const base = {
      "line-opacity": 0.55,
    };
    if (!residentZone) {
      return {
        ...base,
        "line-color": TAXA_LINE_BASE_COLOR_EXPR,
        "line-width": TAXA_LINE_BASE_WIDTH,
      };
    }
    const isResidentTaxa: ExpressionSpecification = [
      "!=",
      ["index-of", residentZone, ["to-string", ["get", "taxa_name"]]],
      -1,
    ];
    return {
      ...base,
      "line-color": [
        "case",
        isResidentTaxa,
        TAXA_LINE_RESIDENT_COLOR,
        TAXA_LINE_BASE_COLOR_EXPR,
      ] as ExpressionSpecification,
      "line-width": [
        "case",
        isResidentTaxa,
        TAXA_LINE_BASE_WIDTH + TAXA_LINE_RESIDENT_EXTRA_WIDTH,
        TAXA_LINE_BASE_WIDTH,
      ] as ExpressionSpecification,
    };
  }, [residentZone]);

  const loadZones = useCallback(
    async (
      bounds: { west: number; south: number; east: number; north: number },
      signal?: AbortSignal,
    ) => {
      const gen = ++zonesRequestGenRef.current;
      const key = viewportBoundsKey(bounds);
      setZonesLoading(true);
      setZonesError(null);
      const q = new URLSearchParams({
        west: String(bounds.west),
        south: String(bounds.south),
        east: String(bounds.east),
        north: String(bounds.north),
      });
      if (process.env.NODE_ENV === "development") {
        const { west, south, east, north } = bounds;
        console.info(
          "[CleaningSafetyMap] GET /api/cleaning-zones bbox (west/south/east/north = minLng/minLat/maxLng/maxLat)",
          {
            west,
            south,
            east,
            north,
            types: { west: typeof west, south: typeof south, east: typeof east, north: typeof north },
            allFinite: [west, south, east, north].every((n) => Number.isFinite(n)),
            search: q.toString(),
          },
        );
      }
      try {
        const res = await fetch(`/api/cleaning-zones?${q}`, { signal, cache: "no-store" });
        if (signal?.aborted || gen !== zonesRequestGenRef.current) return;
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
        if (signal?.aborted || gen !== zonesRequestGenRef.current) return;
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
        if (process.env.NODE_ENV === "development") {
          console.info("[CleaningSafetyMap] cleaning-zones response", {
            featureCount: parsed.features.length,
            rawFeatureCount: Array.isArray((json as FeatureCollection).features)
              ? (json as FeatureCollection).features.length
              : null,
          });
        }
        setRawFc(parsed);
        lastSuccessBoundsKeyRef.current = key;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (gen !== zonesRequestGenRef.current) return;
        setZonesError("Could not load cleaning zones");
      } finally {
        if (gen === zonesRequestGenRef.current) {
          setZonesLoading(false);
          setZonesLoadedOnce(true);
        }
      }
    },
    [],
  );

  const loadTaxaZones = useCallback(
    async (
      bounds: { west: number; south: number; east: number; north: number },
      signal?: AbortSignal,
    ) => {
      const gen = ++taxaRequestGenRef.current;
      const key = viewportBoundsKey(bounds);
      setTaxaLoading(true);
      setTaxaError(null);
      const q = new URLSearchParams({
        west: String(bounds.west),
        south: String(bounds.south),
        east: String(bounds.east),
        north: String(bounds.north),
      });
      try {
        const res = await fetch(`/api/parking-taxa?${q}`, { signal, cache: "no-store" });
        if (signal?.aborted || gen !== taxaRequestGenRef.current) return;
        if (!res.ok) {
          setTaxaError(`Taxa request failed (${res.status})`);
          return;
        }
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          setTaxaError("Could not read taxa response");
          return;
        }
        if (signal?.aborted || gen !== taxaRequestGenRef.current) return;
        if (json == null || typeof json !== "object") {
          setTaxaError("Invalid taxa response");
          return;
        }
        const errBody = json as { error?: unknown };
        if (typeof errBody.error === "string") {
          setTaxaError(errBody.error);
          return;
        }
        const parsed = sanitizeFeatureCollection(json);
        if (!parsed) {
          setTaxaError("Invalid taxa response");
          return;
        }
        setRawTaxaFc(omitDemoTaxaZones(parsed));
        lastSuccessTaxaBoundsKeyRef.current = key;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (gen !== taxaRequestGenRef.current) return;
        setTaxaError("Could not load parking taxa zones");
      } finally {
        if (gen === taxaRequestGenRef.current) {
          setTaxaLoading(false);
          setTaxaLoadedOnce(true);
        }
      }
    },
    [],
  );

  const scheduleViewportZonesFetch = useCallback(
    (map: MapboxMap) => {
      const b = map.getBounds();
      if (!b) return;
      const bounds = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      };
      const key = viewportBoundsKey(bounds);

      if (moveEndDebounceRef.current) clearTimeout(moveEndDebounceRef.current);

      moveEndDebounceRef.current = setTimeout(() => {
        moveEndDebounceRef.current = null;

        const cleaningUnchanged = key === lastSuccessBoundsKeyRef.current;
        const taxaUnchanged = key === lastSuccessTaxaBoundsKeyRef.current;
        if (cleaningUnchanged && taxaUnchanged) {
          if (process.env.NODE_ENV === "development") {
            console.debug("[CleaningSafetyMap] skip viewport refetch: cleaning + taxa bounds unchanged", key);
          }
          return;
        }

        if (!cleaningUnchanged) {
          zonesFetchAbortRef.current?.abort();
          zonesFetchAbortRef.current = new AbortController();
          void loadZones(bounds, zonesFetchAbortRef.current.signal);
        }

        if (!taxaUnchanged) {
          taxaFetchAbortRef.current?.abort();
          taxaFetchAbortRef.current = new AbortController();
          void loadTaxaZones(bounds, taxaFetchAbortRef.current.signal);
        }
      }, MOVE_END_DEBOUNCE_MS);
    },
    [loadZones, loadTaxaZones],
  );

  useEffect(() => {
    return () => {
      if (moveEndDebounceRef.current) clearTimeout(moveEndDebounceRef.current);
      zonesFetchAbortRef.current?.abort();
      taxaFetchAbortRef.current?.abort();
    };
  }, []);

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

  const onUserLocated = useCallback((lng: number, lat: number) => {
    setUserLngLat({ lng, lat });
  }, []);

  return (
    <div
      data-gpg-cleaning-safety-map="1"
      className="relative h-[100vh] w-screen max-w-[100vw] overflow-x-hidden"
    >
      {/* Map subtree only — floating UI stays siblings so WebGL/canvas stack does not sit above controls. */}
      <div className="absolute inset-0 z-0 min-h-0 min-w-0" data-gpg-map-slot="1">
        <Map
          id="map"
          mapboxAccessToken={token}
          mapStyle={MAP_STYLE}
          initialViewState={INITIAL_VIEW}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
          }}
        attributionControl={false}
        interactive
        interactiveLayerIds={[TAXA_LINE_LAYER_ID, ZONE_LINE_LAYER_ID]}
        onLoad={(e) => {
          if (process.env.NODE_ENV === "development") {
            console.info("[CleaningSafetyMap] map load: initial cleaning-zones fetch for viewport");
          }
          setMapInitError(null);
          setMapReady(true);
          const map = e.target;
          mapHandleRef.current = map;
          const b = map.getBounds();
          if (!b) return;
          zonesFetchAbortRef.current?.abort();
          zonesFetchAbortRef.current = new AbortController();
          const initialBounds = {
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          };
          void loadZones(initialBounds, zonesFetchAbortRef.current.signal);
          taxaFetchAbortRef.current?.abort();
          taxaFetchAbortRef.current = new AbortController();
          void loadTaxaZones(initialBounds, taxaFetchAbortRef.current.signal);
        }}
        onError={(evt) => {
          const err =
            evt && typeof evt === "object" && "error" in evt && (evt as { error?: unknown }).error != null
              ? (evt as { error: unknown }).error
              : evt;
          setMapInitError(err instanceof Error ? err.message : String(err));
        }}
        onClick={(e) => {
          setUserLocationPopupOpen(false);
          const features = e.features ?? [];
          const taxaHit = features.find((feat) => feat.layer?.id === TAXA_LINE_LAYER_ID);
          const taxaProps = taxaHit?.properties as Record<string, unknown> | undefined;
          if (taxaProps && taxaHit) {
            const rateRaw = taxaProps.hourly_rate;
            const rateNum =
              typeof rateRaw === "number"
                ? rateRaw
                : typeof rateRaw === "string"
                  ? Number(rateRaw)
                  : NaN;
            const hourlyLabel = Number.isFinite(rateNum)
              ? `${rateNum} kr/h`
              : String(rateRaw ?? "—");
            setPopup({
              kind: "taxa",
              longitude: e.lngLat.lng,
              latitude: e.lngLat.lat,
              taxa_name: String(taxaProps.taxa_name ?? "Taxa"),
              hourly_rate_label: hourlyLabel,
            });
            return;
          }

          const f = features[0];
          const props = f?.properties;
          if (!props) {
            setPopup(null);
            return;
          }
          const lngLat = e.lngLat;
          setPopup({
            kind: "cleaning",
            longitude: lngLat.lng,
            latitude: lngLat.lat,
            title: String(props.street_name ?? props.id ?? "Zone"),
            nextLabel: String(props.nextLabel ?? ""),
          });
        }}
        onMoveEnd={(e) => {
          scheduleViewportZonesFetch(e.target);
        }}
      >
        <CleaningZonesRegistrationDiagnostics
          featureCount={geojsonFeatureCount}
          mapReady={mapReady}
          sourceShouldBeMounted={Boolean(mapReady && zonesForSource)}
        />

        <NavigationControl position="top-right" />

        {userLngLat && (
          <Marker
            longitude={userLngLat.lng}
            latitude={userLngLat.lat}
            anchor="center"
            onClick={(ev) => {
              ev.originalEvent.stopPropagation();
              setPopup(null);
              setUserLocationPopupOpen(true);
            }}
          >
            <button
              type="button"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-sky-500 shadow-md transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1"
              aria-label="Your location — Din position"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white" aria-hidden />
            </button>
          </Marker>
        )}

        {userLocationPopupOpen && userLngLat && (
          <Popup
            longitude={userLngLat.lng}
            latitude={userLngLat.lat}
            anchor="top"
            onClose={() => setUserLocationPopupOpen(false)}
            closeOnClick={false}
          >
            <div className="max-w-xs text-sm">
              <div className="font-medium text-neutral-900">Din position</div>
              <div className="mt-1 text-neutral-600">Your location</div>
            </div>
          </Popup>
        )}

        {taxaForSource && (
          <Source
            id={TAXA_SOURCE_ID}
            type="geojson"
            data={taxaForSource}
            buffer={64}
            tolerance={3.75}
          >
            <Layer
              id={TAXA_LINE_LAYER_ID}
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={taxaLinePaint}
            />
          </Source>
        )}

        {zonesForSource && (
          <Source id={SOURCE_ID} type="geojson" data={zonesForSource}>
            <Layer
              id={ZONE_LINE_LAYER_ID}
              type="line"
              paint={{
                "line-color": [
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
                "line-width": 3,
                "line-opacity": [
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
              }}
            />
          </Source>
        )}

        {popup && popup.kind === "cleaning" && (
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

        {popup && popup.kind === "taxa" && (
          <Popup
            longitude={popup.longitude}
            latitude={popup.latitude}
            anchor="bottom"
            onClose={() => setPopup(null)}
            closeOnClick={false}
          >
            <div className="max-w-xs text-sm">
              <div className="font-medium text-neutral-900">{popup.taxa_name}</div>
              <div className="mt-1 text-neutral-600">
                Avgift / Rate: {popup.hourly_rate_label}
              </div>
            </div>
          </Popup>
        )}

        </Map>
      </div>

      <div
        className="gpg-map-float pointer-events-auto fixed bottom-8 left-1/2 z-[9999] w-[90%] max-w-md -translate-x-1/2"
        data-gpg-float="time-slider"
      >
        <div
          className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-lg"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <label className="gpg-time-slider-label flex min-w-0 items-center gap-2 text-xs text-neutral-700">
            <span className="shrink-0 whitespace-nowrap">Time (+h)</span>
            <input
              type="range"
              min={-48}
              max={120}
              step={0.25}
              value={offsetHours}
              onChange={(e) => setOffsetHours(Number(e.target.value))}
              className="h-2 min-w-0 flex-1 accent-emerald-600"
            />
            <span className="w-14 shrink-0 tabular-nums">
              {offsetHours >= 0 ? "+" : ""}
              {offsetHours.toFixed(1)}h
            </span>
          </label>
        </div>
      </div>

      <GeolocateMapButton getMap={getMapHandle} onLocated={onUserLocated} />

      <div
        className="gpg-map-float pointer-events-auto fixed bottom-[10.5rem] left-1/2 z-[9998] w-max max-w-[min(90vw,42rem)] -translate-x-1/2"
        data-gpg-float="park-here"
      >
        <ParkHereBar compact />
      </div>

      {zonesLoading && !zonesLoadedOnce && !mapReady && (
        <div
          className="fixed inset-0 z-[10050] flex flex-col gap-3 bg-[#F9FAFB]/80 p-4 backdrop-blur-sm"
          aria-busy
          aria-label="Loading map"
        >
          <div className="h-3 w-48 max-w-full animate-pulse rounded bg-neutral-200" />
          <div className="h-3 max-w-md animate-pulse rounded bg-neutral-200" />
          <div className="mt-4 h-40 max-w-md animate-pulse rounded-lg bg-neutral-200/80" />
        </div>
      )}
      {zonesLoading && !zonesLoadedOnce && mapReady && (
        <div
          className="fixed left-1/2 top-16 z-[10040] w-max max-w-[min(calc(100vw-2rem),20rem)] -translate-x-1/2 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600 shadow-lg"
          aria-busy
          aria-label="Loading cleaning zones"
        >
          Loading zones…
        </div>
      )}
      {((zonesLoading && zonesLoadedOnce) || (taxaLoading && taxaLoadedOnce)) && (
        <div
          className="pointer-events-none fixed left-0 right-0 top-0 z-[10000] h-0.5 animate-pulse bg-emerald-600/40"
          aria-busy
          aria-label="Updating map data"
        />
      )}
      {(zonesError || taxaError) && (
        <div className="fixed left-4 top-14 z-[10040] w-max max-w-[min(calc(100vw-8rem),24rem)] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg">
          {[zonesError, taxaError].filter(Boolean).join(" · ")}
        </div>
      )}
      {mapInitError && (
        <div
          className="fixed left-4 top-[7.25rem] z-[10040] w-max max-w-[min(calc(100vw-8rem),24rem)] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-lg"
          data-gpg-map-blocker="mapbox-init-error"
          role="alert"
        >
          Map failed to initialize: {mapInitError}
        </div>
      )}

      <ParkingSettings />
    </div>
  );
}
