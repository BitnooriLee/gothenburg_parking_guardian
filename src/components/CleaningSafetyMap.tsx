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
import type { FeatureCollection } from "geojson";
import ParkHereBar from "@/components/ParkHereBar";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

const MAP_STYLE = "mapbox://styles/mapbox/light-v11";
const INITIAL_VIEW = {
  longitude: 11.9746,
  latitude: 57.7089,
  zoom: 13,
};

const SOURCE_ID = "cleaning-zones";
const FILL_LAYER_ID = "cleaning-safety-fill";

type PopupState = {
  longitude: number;
  latitude: number;
  title: string;
  nextLabel: string;
};

function enrichCollection(fc: FeatureCollection, targetTime: Date): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const schedule = (f.properties?.schedule ?? {}) as CleaningSchedule;
      const { level } = getCleaningSafetyLevel(targetTime, schedule);
      return {
        ...f,
        properties: {
          ...f.properties,
          safety: level,
          nextLabel: formatNextCleaningLabel(targetTime, schedule),
        },
      };
    }),
  };
}

export default function CleaningSafetyMap() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [rawFc, setRawFc] = useState<FeatureCollection | null>(null);
  const [offsetHours, setOffsetHours] = useState(0);
  const [popup, setPopup] = useState<PopupState | null>(null);

  /** Simulated “current” instant for safety / next-cleaning logic (Stockholm-relative in lib). */
  const targetTime = useMemo(() => new Date(Date.now() + offsetHours * 3600000), [offsetHours]);
  const deferredTargetTime = useDeferredValue(targetTime);

  const geojson = useMemo(() => {
    if (!rawFc) return null;
    return enrichCollection(rawFc, deferredTargetTime);
  }, [rawFc, deferredTargetTime]);

  const loadZones = useCallback(async (bounds: { west: number; south: number; east: number; north: number }) => {
    const q = new URLSearchParams({
      west: String(bounds.west),
      south: String(bounds.south),
      east: String(bounds.east),
      north: String(bounds.north),
    });
    const res = await fetch(`/api/cleaning-zones?${q}`);
    if (!res.ok) return;
    const data = (await res.json()) as FeatureCollection;
    setRawFc(data);
  }, []);

  useEffect(() => {
    const w = 11.85;
    const e = 12.1;
    const s = 57.65;
    const n = 57.78;
    void loadZones({ west: w, south: s, east: e, north: n });
  }, [loadZones]);

  if (!token) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F9FAFB] p-6 text-center text-sm text-neutral-600">
        Set <code className="rounded bg-neutral-200 px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
        <code className="rounded bg-neutral-200 px-1">.env.local</code>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full bg-[#F9FAFB]">
      <div className="absolute left-0 right-0 top-0 z-10 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 py-2 backdrop-blur">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 text-xs text-neutral-700">
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
          <span className="w-14 tabular-nums">{offsetHours >= 0 ? "+" : ""}
            {offsetHours.toFixed(1)}h
          </span>
        </label>
      </div>

      <div className="h-full pt-12">
        <Map
          mapboxAccessToken={token}
          mapStyle={MAP_STYLE}
          initialViewState={INITIAL_VIEW}
          style={{ width: "100%", height: "100%" }}
          interactiveLayerIds={[FILL_LAYER_ID]}
          onClick={(e) => {
            const f = e.features?.[0];
            if (!f?.properties) {
              setPopup(null);
              return;
            }
            const lngLat = e.lngLat;
            setPopup({
              longitude: lngLat.lng,
              latitude: lngLat.lat,
              title: String(f.properties.street_name || f.properties.id || "Zone"),
              nextLabel: String(f.properties.nextLabel ?? ""),
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
      </div>
      <ParkHereBar />
    </div>
  );
}
