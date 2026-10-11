"""Package the events for the web dashboard.

Every annual event is resampled from the AORC latitude and longitude grid to a
square grid in the region's projected CRS, then stored compactly:

  total-YYYY.bin.gz    event total, one byte per cell
  hourly-YYYY.bin.gz   one grid per hour, for the largest events only
  counties.bin.gz      county number of every cell, for the hover readout
  annual-maxima.csv    the table behind the bar chart
  poster.png           a still image of the largest event

A single JSON file carries everything else the page needs: the grid layout,
how to turn bytes back into inches, the color ramp, outlines drawn in grid
coordinates, city labels, and the facts of every event.

  python 08_export_web.py --config config/minnesota.toml
"""

from __future__ import annotations

import datetime
import json
import shutil

import numpy as np
import xarray as xr

from rainlib import HERE, base_parser, load_config
from weblib import MM_PER_INCH, WebGrid, encode, make_poster, palette_block, write_gz

# Bytes hold the square root of the depth in inches times a constant.
TOTAL_CODE = 63.0   # up to 16.4 inches per event
HOURLY_CODE = 120.0  # up to 4.5 inches per hour


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    web = cfg.raw["web"]
    data_dir = (HERE / web["data_dir"]).resolve()
    json_path = (HERE / web["json_path"]).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)

    with open(cfg.work_dir / "events.json", encoding="utf-8") as handle:
        summary = json.load(handle)
    events = summary["events"]

    grid = WebGrid(cfg)
    source = xr.open_zarr(cfg.year_store(cfg.years[0]))
    resample = grid.resampler(source.latitude.values, source.longitude.values)
    inside = grid.inside
    write_gz(data_dir / "counties.bin.gz", grid.county_grid)

    # Results of the optional checks, when those steps have been run.
    def optional_json(name: str, default):
        path = cfg.work_dir / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

    gauge_rows = {row["year"]: row for row in optional_json("gauge_check.json", [])}
    screening = optional_json("screening_summary.json", None)
    reference_events = optional_json("reference_events.json", [])

    # Clear maps from an earlier run so a storm that is no longer listed leaves nothing behind.
    for stale in list(data_dir.glob("total-*.bin.gz")) + list(data_dir.glob("hourly-*.bin.gz")):
        stale.unlink()

    total_bytes = 0
    hourly_bytes = 0
    web_events = []
    poster_event, poster_total = None, None
    max_total_in = 0.0
    max_hourly_in = 0.0
    for event in sorted(events, key=lambda e: e["year"]):
        year = event["year"]
        packed = np.load(cfg.work_dir / "grids" / f"event_{year}.npz")["hourly"]
        hourly_mm = packed.astype(np.float32) * 0.1
        total_in = resample(hourly_mm.sum(axis=0, keepdims=True))[0] / MM_PER_INCH
        if event.get("rank") == 1:
            poster_event, poster_total = event, total_in
        max_total_in = max(max_total_in, float(total_in[inside == 1].max()))
        total_bytes += write_gz(data_dir / f"total-{year}.bin.gz", encode(total_in, TOTAL_CODE))

        if event.get("animated"):
            frames_in = resample(hourly_mm) / MM_PER_INCH
            max_hourly_in = max(max_hourly_in, float(frames_in[:, inside == 1].max()))
            hourly_bytes += write_gz(data_dir / f"hourly-{year}.bin.gz", encode(frames_in, HOURLY_CODE))

        keep = {
            key: event[key]
            for key in (
                "year", "rank", "animated", "start_local", "end_local", "mean_in",
                "peak_point_in", "peak_county", "peak_near", "area_at_least_in",
                "wettest_24h_mean_in", "wettest_24h_end_local", "wettest_hour_mean_in",
                "wettest_hour_end_local", "six_inch_24h_area_sq_mi", "max_24h_point_in",
                "meets_mega_rain_test", "hourly_mean_in",
            )
        }
        for optional in ("cold_share", "cold_threshold_f"):
            if optional in event:
                keep[optional] = event[optional]
        check = gauge_rows.get(year)
        if check:
            keep["gauges"] = check["gauges"]
            keep["aorc_over_gauges"] = check["aorc_over_gauges"]
        keep["peak_x"], keep["peak_y"] = grid.point(event["peak_lon"], event["peak_lat"])
        web_events.append(keep)
        print(f"{year}: exported" + (" with hourly frames" if event.get("animated") else ""), flush=True)

    if max_total_in > (255 / TOTAL_CODE) ** 2 or max_hourly_in > (255 / HOURLY_CODE) ** 2:
        print("Warning: a value is larger than the byte encoding can hold and was capped.")

    palette, ramp = palette_block(web.get("palette", "Nasir"))
    total_ticks = web.get("total_scale_ticks", [0.25, 1, 2, 3, 4, 6, 8, 10])
    payload = {
        "kind": "rain",
        "region": cfg.name,
        "region_area_sq_mi": summary["region_area_sq_mi"],
        "duration_hours": summary["duration_hours"],
        "first_year": summary["first_year"],
        "last_year": summary["last_year"],
        "timezone": cfg.timezone,
        "median_in": summary["median_in"],
        "mean_in": summary["mean_in"],
        "season": summary.get("season"),
        "reference_events": reference_events,
        "screening": screening,
        "grid": grid.layout({"total_code": TOTAL_CODE, "hourly_code": HOURLY_CODE}),
        "scale": {
            "total_max_in": float(web.get("total_scale_max_in", 10)),
            "hourly_max_in": float(web.get("hourly_scale_max_in", 2)),
            "total_ticks": total_ticks,
            "hourly_ticks": web.get("hourly_scale_ticks", [0.05, 0.25, 0.5, 1, 1.5, 2]),
        },
        "palette": palette,
        "outline_path": grid.outline_path,
        "county_mesh_path": grid.county_mesh_path,
        "county_names": grid.county_names,
        "cities": grid.cities,
        "events": web_events,
    }
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))

    shutil.copyfile(cfg.work_dir / "annual_maxima.csv", data_dir / "annual-maxima.csv")

    if poster_event is not None:
        start = datetime.datetime.fromisoformat(poster_event["start_local"])
        end = datetime.datetime.fromisoformat(poster_event["end_local"])
        tail = f"{end.day}" if start.month == end.month else f"{end:%B} {end.day}"
        make_poster(
            data_dir / "poster.png",
            grid,
            poster_total,
            ramp,
            float(web.get("total_scale_max_in", 10)),
            total_ticks,
            title=f"{cfg.name}, {start:%B} {start.day} to {tail}, {end.year}",
            subtitle=(
                f"Largest {poster_event['duration_hours']}-hour statewide average since {cfg.start_year}, "
                f"{poster_event['mean_in']:.2f} inches"
            ),
            legend="Inches of rain",
            credit=f"Data: NOAA AORC v1.1. Colors: {palette['name']} palette from Rang. hydromohsen.com",
        )

    print(f"\nGrid: {grid.width} x {grid.height} cells of {grid.cell_m / 1000:g} km")
    print(f"Largest cell total {max_total_in:.2f} in, largest cell hour {max_hourly_in:.2f} in")
    print(f"Event totals: {total_bytes / 1e6:.2f} MB in {len(web_events)} files")
    print(f"Hourly frames: {hourly_bytes / 1e6:.2f} MB")
    print(f"JSON: {json_path.stat().st_size / 1e3:.0f} KB at {json_path}")
    print(f"Binary files in {data_dir}")


if __name__ == "__main__":
    main()
