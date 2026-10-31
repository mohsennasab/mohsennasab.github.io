"""Collect the rainfall, gauge, river and map data for the Rochester 1978 post.

Reads the downloaded files in WORK/raw and the results of 01_plate.py, and
writes one JSON file for the page. The sources and how to fetch them are listed
in README.md.

  python 02_data.py
"""

from __future__ import annotations

import ast
import csv
import gzip
import json
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
import xarray as xr
from shapely.geometry import box, shape

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent
WORK = Path("G:/Python Package/Rochester1978")
RAW = WORK / "raw"
COUNTIES = HERE.parent / "extreme-rainfall/boundaries/_census/cb_2023_us_county_500k/cb_2023_us_county_500k.shp"
OUT = SITE / "src/data/rochester-1978.json"
PUBLIC = SITE / "public/blog/rochester-1978"

MM = 25.4
EXTENT = {"west": -93.55, "east": -91.0, "south": 43.45, "north": 44.6}
AIRPORT = (-92.49207, 43.904)

STORM_DAYS = ("1978-07-05", "1978-07-06")
BEFORE_DAYS = ("1978-06-29", "1978-07-02")

# Hourly stations from NOAA's Hourly Precipitation Data, listed from the first
# hard rain to the last, and the hours shown (Central Daylight Time).
HOURLY_STATIONS = {
    "USC00470124": "Alma Dam 4, WI",
    "USC00478589": "Trempealeau Dam 6, WI",
    "USC00214418": "La Crescent Dam 7",
    "USC00217184": "Rushford",
    "USC00212166": "Dodge Center",
    "USC00217941": "Spring Valley",
}
FIRST_HOUR = pd.Timestamp("1978-07-05 15:00")  # CDT
HOURS = 16

# Gauges marked on the river map, from the USGS site file.
STATIONS = {
    "05373000": "South Fork Zumbro River near Rochester",
    "05372995": "South Fork Zumbro River at Rochester",
    "05372930": "Bear Creek at Rochester",
}

# 100-year peak flows and drainage areas from the 1975 flood plain supplement, Table I.1.
ESTIMATES_1975 = {
    "south_fork": {"cfs_100yr": 27500, "sq_mi": 304.1},
    "bear_creek": {"cfs_100yr": 13100, "sq_mi": 82.3},
}

TIMELINE_DAYS = pd.date_range("1978-06-28", "1978-07-09").strftime("%Y-%m-%d").tolist()

TOWNS = [
    ("Rochester", -92.47, 44.022), ("Winona", -91.64, 44.05), ("Austin", -92.975, 43.667),
    ("Red Wing", -92.534, 44.562), ("Owatonna", -93.226, 44.084), ("La Crosse", -91.24, 43.80),
]


def path_of(geometry, digits=3) -> str:
    """Lines and polygons as an SVG-style path in longitude and latitude."""
    parts = []
    for geom in getattr(geometry, "geoms", [geometry]):
        if geom.is_empty:
            continue
        rings = [geom.exterior, *geom.interiors] if geom.geom_type == "Polygon" else [geom]
        for ring in rings:
            coords = np.asarray(ring.coords)[:, :2]
            parts.append("M" + "L".join(f"{x:.{digits}f},{y:.{digits}f}" for x, y in coords))
    return "".join(parts)


def rain_grids() -> dict:
    keep = dict(lat=slice(EXTENT["south"], EXTENT["north"]), lon=slice(EXTENT["west"], EXTENT["east"]))
    june = xr.open_dataset(RAW / "ncdd-197806.nc")["prcp"].sel(**keep)
    july = xr.open_dataset(RAW / "ncdd-197807.nc")["prcp"].sel(**keep)
    grid = xr.concat([june, july], dim="time").load() / MM
    storm = grid.sel(time=slice(*STORM_DAYS)).sum("time")
    before = grid.sel(time=slice(*BEFORE_DAYS)).sum("time")

    def packed(field):
        return [None if not np.isfinite(v) else round(float(v), 2) for v in field.values.ravel()]

    lat, lon = storm.lat.values, storm.lon.values
    basin = shape(json.loads((RAW / "basin.json").read_text())["features"][0]["geometry"])
    inside = shapely.contains_xy(basin, *np.meshgrid(lon, lat))
    near = storm.sel(lat=AIRPORT[1], lon=AIRPORT[0], method="nearest")
    return {
        "nclimgrid": {
            "lon0": round(float(lon[0]), 4),
            "lat0": round(float(lat[0]), 4),
            "dlon": round(float(lon[1] - lon[0]), 5),
            "dlat": round(float(lat[1] - lat[0]), 5),
            "nx": len(lon),
            "ny": len(lat),
            "storm": packed(storm),
            "before": packed(before),
        },
        "stats": {
            "airport_cell": round(float(near), 2),
            "storm_max": round(float(storm.max()), 2),
            "before_max": round(float(before.max()), 2),
            "south_fork_storm": round(float(storm.values[inside].mean()), 2),
            "south_fork_before": round(float(before.values[inside].mean()), 2),
        },
    }


def gauges(grids: dict) -> list[dict]:
    """Daily gauge totals from ACIS. Trace counts as zero and a station needs every day."""
    data = json.loads((RAW / "acis_daily.json").read_text())
    days = pd.date_range("1978-06-25", "1978-07-10").strftime("%Y-%m-%d").tolist()

    def total(values, first, last):
        amounts = []
        for day, value in zip(days, values):
            if first <= day <= last:
                if value == "M":
                    return None
                amounts.append(0.0 if value == "T" else float(value))
        return round(sum(amounts), 2)

    rows = []
    for station in data["data"]:
        values = [cell[0] for cell in station["data"]]
        meta = station["meta"]
        if "ll" not in meta:
            continue
        lon, lat = meta["ll"]
        if not (EXTENT["west"] <= lon <= EXTENT["east"] and EXTENT["south"] <= lat <= EXTENT["north"]):
            continue
        storm, before = total(values, *STORM_DAYS), total(values, *BEFORE_DAYS)
        if storm is None and before is None:
            continue
        name = meta["name"].title().replace("Rochester International Airport", "Rochester airport")
        name = re.sub(r"\b(\d+)([A-Za-z]+)\b", lambda m: m[1] + " " + m[2].upper(), name)
        number = next(sid.split()[0] for sid in meta["sids"] if sid.endswith(" 6"))
        rows.append({"name": name, "id": number, "lon": round(lon, 3), "lat": round(lat, 3), "storm": storm, "before": before})
    return sorted(rows, key=lambda row: row["name"])


def timeline() -> dict:
    """Daily rain at the airport from ACIS and daily mean flow at the 1978 gauge from USGS."""
    data = json.loads((RAW / "acis_daily.json").read_text())
    days = pd.date_range("1978-06-25", "1978-07-10").strftime("%Y-%m-%d").tolist()
    airport = next(s for s in data["data"] if s["meta"]["name"].startswith("ROCHESTER INTERNATIONAL"))
    rain = {day: 0.0 if cell[0] == "T" else float(cell[0]) for day, cell in zip(days, airport["data"])}
    flow = {}
    for line in open(RAW / "dv_05373000.rdb", encoding="utf-8"):
        if line.startswith("USGS"):
            cells = line.split("\t")
            flow[cells[2]] = float(cells[3])
    return {"days": TIMELINE_DAYS, "rain": [rain[d] for d in TIMELINE_DAYS], "flow": [flow[d] for d in TIMELINE_DAYS]}


def stations() -> list[dict]:
    """Coordinates of the river gauges from the USGS site file."""
    rows = []
    for line in open(RAW / "sites2.rdb", encoding="utf-8"):
        if line.startswith("USGS"):
            cells = line.split("\t")
            rows.append({"id": cells[1], "name": STATIONS[cells[1]], "lat": round(float(cells[6]), 5), "lon": round(float(cells[7]), 5)})
    return rows


def airport_log() -> dict:
    """Pull the hourly reports for the Rochester airport out of the ISD file.

    Remarks are kept as the observers typed them. Times are UTC. CDT is UTC-5.
    """
    rows = []
    for line in gzip.open(RAW / "isd.gz", "rt", errors="replace"):
        stamp = line[15:27]
        if not "197807052300" <= stamp <= "197807061100":
            continue
        add = line[105:].rstrip()
        remark = add[add.find("REM") + 3:] if "REM" in add else ""
        one_hour = re.search(r"AA101(\d{4})", add)
        six_hour = re.search(r"AA\d06(\d{4})", add)
        rows.append({
            "utc": stamp,
            "report": line[41:46].strip(),
            "temp_c": None if line[87:92] == "+9999" else int(line[87:92]) / 10,
            "aa1_in": None if not one_hour else round(int(one_hour[1]) / 10 / MM, 2),
            "aa6_in": None if not six_hour else round(int(six_hour[1]) / 10 / MM, 2),
            "remark": remark[:140],
        })
    return {"reports": rows}


def hourly_stations() -> list[dict]:
    """Hourly amounts from the recording gauges. HPD hours are local standard time, and HR20 is 8 to 9 p.m."""
    inventory = pd.read_csv(RAW / "hpd_inv.csv", dtype=str).set_index("StnID")
    out = []
    for station, name in HOURLY_STATIONS.items():
        with open(RAW / f"hpd/{station}.csv", newline="") as handle:
            reader = csv.reader(handle)
            header = next(reader)
            index = {h: i for i, h in enumerate(header)}
            values = {}
            flags = {}
            for row in reader:
                day = row[index["DATE"]]
                if day not in ("1978-07-05", "1978-07-06"):
                    continue
                for hour in range(24):
                    value = int(row[index[f"HR{hour:02d}Val"]])
                    moment = pd.Timestamp(f"{day} {hour:02d}:00") + pd.Timedelta(hours=1)  # CST to CDT
                    values[moment] = None if value == -9999 else value / 100
                    flags[moment] = (row[index[f"HR{hour:02d}MF"]] + row[index[f"HR{hour:02d}QF"]]).strip()
        series = [values.get(FIRST_HOUR + pd.Timedelta(hours=i)) for i in range(HOURS)]
        marks = {str(k): v for k, v in flags.items() if v}
        out.append({
            "name": name,
            "lon": float(inventory.loc[station, "Lon"]),
            "lat": float(inventory.loc[station, "Lat"]),
            "hours": series,

        })
        print(name, series)
    return out


def peaks() -> dict:
    def read(name):
        rows = []
        for line in open(RAW / name, encoding="utf-8"):
            if line.startswith("USGS"):
                cells = line.rstrip("\n").split("\t")
                rows.append({"date": cells[2], "cfs": int(cells[4]) if cells[4] else None,
                             "code": cells[5], "stage": float(cells[6]) if cells[6] else None})
        return rows

    return {"south_fork": read("p05372995.rdb"), "bear_creek": read("p05372930.rdb")}


def atlas14() -> dict:
    text = (RAW / "atlas14.js").read_text()
    rows = ast.literal_eval(re.search(r"quantiles\s*=\s*(\[\[.*?\]\]);", text, re.S)[1])
    durations = ["5m", "10m", "15m", "30m", "60m", "2h", "3h", "6h", "12h", "24h", "2d", "3d", "4d", "7d"]
    table = {d: [float(v) for v in r] for d, r in zip(durations, rows)}
    return {"ari": [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000], "3h": table["3h"], "24h": table["24h"], "2d": table["2d"]}


def base_map() -> dict:
    frame = box(EXTENT["west"], EXTENT["south"], EXTENT["east"], EXTENT["north"])
    counties = gpd.read_file(COUNTIES).to_crs(4326)
    counties = counties[counties.intersects(frame)]
    lines = shapely.unary_union([g.boundary for g in counties.geometry]).intersection(frame).simplify(0.004)

    basin = shape(json.loads((RAW / "basin.json").read_text())["features"][0]["geometry"]).simplify(0.002)
    flow = json.loads((RAW / "flowlines.json").read_text())
    rivers = shapely.line_merge(shapely.unary_union([shape(f["geometry"]) for f in flow["features"]])).simplify(0.002)

    zumbro = shape(json.loads((RAW / "zumbro_huc8.json").read_text())["features"][0]["geometry"]).simplify(0.002)
    named = json.loads((RAW / "zumbro_named.json").read_text())["features"]
    zumbro_rivers = shapely.line_merge(shapely.unary_union([
        shape(f["geometry"]) for f in named if not f["properties"]["gnis_name"].startswith("Old Channel")
    ])).simplify(0.002)
    return {
        "extent": EXTENT,
        "counties": path_of(lines),
        "basin": path_of(basin),
        "basin_sq_mi": 304,
        "rivers": path_of(rivers),
        "zumbro": path_of(zumbro),
        "zumbro_rivers": path_of(zumbro_rivers),
        "towns": [{"name": n, "lon": x, "lat": y} for n, x, y in TOWNS],
    }


def tile_index() -> dict:
    """Which mosaic tiles exist, as {zoom: {x: [y, ...]}}, so the map asks only for those."""
    index: dict = {}
    for path in (PUBLIC / "mosaic").glob("*/*/*.webp"):
        z, x, y = path.parts[-3], path.parts[-2], int(path.stem)
        index.setdefault(z, {}).setdefault(x, []).append(y)
    return {z: {x: sorted(ys) for x, ys in rows.items()} for z, rows in index.items()}


def main() -> None:
    grids = rain_grids()
    print(grids["stats"])
    gauge_rows = gauges(grids)
    print(len(gauge_rows), "gauges")
    plate = json.loads((WORK / "plate_digitized.json").read_text())
    payload = {
        "map": base_map(),
        "grid": grids["nclimgrid"],
        "grid_stats": grids["stats"],
        "gauges": gauge_rows,
        "timeline": timeline(),
        "stations": stations(),
        "estimates_1975": ESTIMATES_1975,
        "contours": plate["contours"],
        "hourly": {
            "first_hour": FIRST_HOUR.isoformat(),
            "stations": hourly_stations(),
        },
        "airport": airport_log(),
        "stage": plate["stage"],
        "peaks": peaks(),
        "atlas14": atlas14(),
        "mosaic": {**plate["mosaic"], "tiles": tile_index()},
        "photos": plate["photos"],
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT}: {OUT.stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
