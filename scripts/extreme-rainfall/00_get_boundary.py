"""Download a region boundary and save it as GeoJSON in EPSG:4326.

Two sources are supported.

  ArcGIS feature layer (used for Minnesota, from the Minnesota DNR):
    python 00_get_boundary.py --arcgis-layer \
      https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_state_of_minnesota/FeatureServer/4 \
      --out boundaries/minnesota.geojson

  U.S. Census cartographic boundary file (works for any state):
    python 00_get_boundary.py --census-state Wisconsin --out boundaries/wisconsin.geojson

Legal state boundaries on the Great Lakes and the coasts run far out over open
water. Add --clip-to-shoreline STATE to trim the polygon to the Census
cartographic shoreline, so the regional average covers land and inland lakes only.
"""

from __future__ import annotations

import argparse
import io
import json
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import geopandas as gpd

CENSUS_STATES = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip"
HERE = Path(__file__).resolve().parent


def from_arcgis(layer_url: str) -> gpd.GeoDataFrame:
    query = urllib.parse.urlencode(
        {"where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson"}
    )
    with urllib.request.urlopen(f"{layer_url.rstrip('/')}/query?{query}", timeout=120) as resp:
        data = json.load(resp)
    return gpd.GeoDataFrame.from_features(data["features"], crs="EPSG:4326")


def from_census(state_name: str, cache: Path) -> gpd.GeoDataFrame:
    cache.mkdir(parents=True, exist_ok=True)
    shp_dir = cache / "cb_2023_us_state_500k"
    if not shp_dir.exists():
        with urllib.request.urlopen(CENSUS_STATES, timeout=300) as resp:
            zipfile.ZipFile(io.BytesIO(resp.read())).extractall(shp_dir)
    states = gpd.read_file(shp_dir / "cb_2023_us_state_500k.shp")
    match = states[states["NAME"].str.lower() == state_name.lower()]
    if match.empty:
        raise SystemExit(f"No state named {state_name!r} in the Census file.")
    return match.to_crs("EPSG:4326")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--arcgis-layer", help="URL of an ArcGIS feature layer, ending in the layer number")
    group.add_argument("--census-state", help="State name as written in the Census file, for example Wisconsin")
    parser.add_argument("--out", required=True, help="Output GeoJSON path")
    parser.add_argument(
        "--clip-to-shoreline",
        metavar="STATE",
        help="Trim open water using the Census cartographic polygon of this state",
    )
    args = parser.parse_args()

    if args.arcgis_layer:
        gdf = from_arcgis(args.arcgis_layer)
    else:
        gdf = from_census(args.census_state, HERE / "boundaries" / "_census")

    # One dissolved polygon keeps every later step simple.
    geometry = gdf.union_all()
    if args.clip_to_shoreline:
        shoreline = from_census(args.clip_to_shoreline, HERE / "boundaries" / "_census")
        geometry = geometry.intersection(shoreline.union_all())
    merged = gpd.GeoDataFrame(geometry=[geometry], crs="EPSG:4326")
    out = Path(args.out)
    if not out.is_absolute():
        out = HERE / out
    out.parent.mkdir(parents=True, exist_ok=True)
    merged.to_file(out, driver="GeoJSON")

    west, south, east, north = merged.total_bounds
    area_sq_mi = merged.to_crs("EPSG:5070").area.iloc[0] / 2_589_988.11
    print(f"Saved {out}")
    print(f"Bounds: west {west:.4f}, south {south:.4f}, east {east:.4f}, north {north:.4f}")
    print(f"Area: {area_sq_mi:,.0f} square miles")


if __name__ == "__main__":
    main()
