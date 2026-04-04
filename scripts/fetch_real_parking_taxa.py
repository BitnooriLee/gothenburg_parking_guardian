#!/usr/bin/env python3
"""
Fetch municipal paid-parking (Taxa) geometries for Göteborg as GeoJSON.

Official context
----------------
- data.goteborg.se lists ParkingService; detailed parking *spots* are REST:
  https://data.goteborg.se/ParkingService/v2.3/help
- Polygon/line geometries for **Taxa** (fee zones on municipal streets) are
  exposed as WFS layers on Stadsmiljö's open GeoServer (Trafikkontoret):
  Base: https://open.geodata.tkgbg.se/ows
  Capabilities: ?service=wfs&version=2.0.0&request=GetCapabilities

Coordinate systems
------------------
- WFS DefaultCRS in capabilities is **EPSG:3007** (SWEREF99 12 00), not 3006.
- EPSG:3006 is SWEREF99 TM (national). This script requests **EPSG:4326** from
  the server (GeoServer reprojects). If the response is still projected or you
  force native CRS, set SOURCE_EPSG (3007 or 3006) and install pyproj for local
  reprojection.

Usage
-----
  pip install pyproj   # only needed if you use --native-crs or reprojection fallback
  python scripts/fetch_real_parking_taxa.py
  python scripts/fetch_real_parking_taxa.py -o ./real_parking_taxa.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

WFS_BASE = "https://open.geodata.tkgbg.se/ows"

# Layer names are case-sensitive (GeoServer workspace:parkering).
TAXA_TYPE_NAMES: tuple[str, ...] = (
    "parkering:taxa_1",
    "parkering:Taxa_12",
    "parkering:taxa_2",
    "parkering:taxa_22",
    "parkering:taxa_24",
    "parkering:taxa_3",
    "parkering:taxa_4",
    "parkering:taxa_5",
    "parkering:taxa_6",
    "parkering:Taxa_62",
    "parkering:taxa_7",
    "parkering:taxa_8",
    "parkering:Taxa_9",
    "parkering:taxa_a",
)


def _wfs_get_feature_url(
    type_name: str,
    *,
    output_format: str,
    srs_name: str | None,
) -> str:
    q: dict[str, str] = {
        "service": "wfs",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": type_name,
        "outputFormat": output_format,
    }
    if srs_name:
        q["srsName"] = srs_name
    return f"{WFS_BASE}?{urllib.parse.urlencode(q)}"


def http_get_json(url: str, timeout: float = 120) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def _crs_is_wgs84(fc: dict[str, Any]) -> bool:
    crs = fc.get("crs") or {}
    if crs.get("type") != "name":
        return False
    name = (crs.get("properties") or {}).get("name") or ""
    return "4326" in name


def _coords_look_projected(coords: Any) -> bool:
    """Heuristic: SWEREF plane coords are ~1e5–1e6; WGS84 lon for Göteborg ~11–12."""
    if not coords or not isinstance(coords, list):
        return False
    first = coords[0]
    if isinstance(first, (int, float)):
        x, y = float(first), float(coords[1])
        return abs(x) > 180 or abs(y) > 90
    if isinstance(first, list):
        return _coords_look_projected(first)
    return False


def _transform_position(
    transformer: Any, x: float, y: float
) -> tuple[float, float]:
    lon, lat = transformer.transform(x, y)
    return lon, lat


def _transform_coords(
    transformer: Any, coords: Any, depth: int
) -> Any:
    if depth == 0:
        return list(_transform_position(transformer, float(coords[0]), float(coords[1])))
    return [_transform_coords(transformer, c, depth - 1) for c in coords]


def reproject_geometry(
    geom: dict[str, Any],
    source_epsg: int,
) -> dict[str, Any]:
    try:
        from pyproj import Transformer
    except ImportError as e:
        raise RuntimeError(
            "pyproj is required for reprojection. Install with: pip install pyproj"
        ) from e

    transformer = Transformer.from_crs(
        f"EPSG:{source_epsg}", "EPSG:4326", always_xy=True
    )
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Point":
        depth = 0
    elif gtype in ("LineString", "MultiPoint"):
        depth = 1
    elif gtype in ("Polygon", "MultiLineString"):
        depth = 2
    elif gtype in ("MultiPolygon"):
        depth = 3
    else:
        raise ValueError(f"Unsupported geometry type for reprojection: {gtype}")

    new_geom = dict(geom)
    new_geom["coordinates"] = _transform_coords(transformer, coords, depth)
    return new_geom


def taxa_code_from_type_name(type_name: str) -> str:
    m = re.search(r":(?:[Tt]axa_)(.+)$", type_name)
    return m.group(1) if m else type_name


def fetch_layer(
    type_name: str,
    *,
    use_wgs84_request: bool,
    source_epsg: int,
    force_reproject: bool,
) -> list[dict[str, Any]]:
    srs = "EPSG:4326" if use_wgs84_request else None
    url = _wfs_get_feature_url(
        type_name, output_format="application/json", srs_name=srs
    )
    fc = http_get_json(url)
    feats = fc.get("features") or []
    need_reproject = force_reproject or (
        not _crs_is_wgs84(fc) and feats and _coords_look_projected(feats[0].get("geometry"))
    )
    out: list[dict[str, Any]] = []
    for f in feats:
        g = f.get("geometry")
        if g and need_reproject:
            g = reproject_geometry(g, source_epsg)
        props = dict(f.get("properties") or {})
        props["wfs_type_name"] = type_name
        props["taxa_code"] = taxa_code_from_type_name(type_name)
        out.append(
            {
                "type": "Feature",
                "geometry": g,
                "properties": props,
            }
        )
    return out


def build_feature_collection(features: Iterable[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "name": "gothenburg_parking_taxa",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::4326"},
        },
        "features": list(features),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Göteborg Taxa WFS → GeoJSON")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "real_parking_taxa.json",
        help="Output GeoJSON path (default: repo root real_parking_taxa.json)",
    )
    parser.add_argument(
        "--native-crs",
        action="store_true",
        help="Request default server CRS (EPSG:3007) and reproject with pyproj",
    )
    parser.add_argument(
        "--source-epsg",
        type=int,
        default=int(os.environ.get("SOURCE_EPSG", "3007")),
        help="Source EPSG for local reprojection (default 3007 per WFS capabilities; use 3006 if your data is national TM)",
    )
    args = parser.parse_args()

    use_wgs84 = not args.native_crs
    force_reproject = args.native_crs

    all_features: list[dict[str, Any]] = []
    for tn in TAXA_TYPE_NAMES:
        try:
            layer_feats = fetch_layer(
                tn,
                use_wgs84_request=use_wgs84,
                source_epsg=args.source_epsg,
                force_reproject=force_reproject,
            )
        except urllib.error.HTTPError as e:
            print(f"HTTP error for {tn}: {e}", file=sys.stderr)
            raise
        all_features.extend(layer_feats)
        print(f"{tn}: {len(layer_feats)} features", file=sys.stderr)

    fc = build_feature_collection(all_features)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(all_features)} features to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
