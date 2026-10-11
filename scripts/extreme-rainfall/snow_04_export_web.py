"""Package the winters for the web dashboard.

The map of each winter's peak day is resampled from the 800 m latitude and
longitude grid to the same square grid the rainfall maps use, then stored
compactly:

  total-YYYY.bin.gz    snow water equivalent on the peak day, one byte per cell
  daily-YYYY.bin.gz    one grid per day of the winter, for the largest winters only
  counties.bin.gz      county number of every cell, for the hover readout
  annual-peaks.csv     the table behind the bar chart
  poster.png           a still image of the largest winter's peak day

The daily grids change little from one day to the next, so each one is stored
as the difference from the day before (the first day is stored as it is, and
sums wrap around at 256). That makes the files several times smaller.

Cells without a value, which are the largest lakes, are given the value of
the nearest cell that has one so the map has no holes. They are not part of
any average.

  python snow_04_export_web.py --config config/minnesota.toml
"""

from __future__ import annotations

import datetime
import json
import shutil

import numpy as np
from scipy import ndimage

from rainlib import HERE, base_parser, load_config
from snowlib import SWE_MISSING, load_snow_config, load_winter
from weblib import MM_PER_INCH, WebGrid, encode, make_poster, palette_block, write_gz

# Bytes hold the square root of the depth in inches times this constant, up to 16.4 inches.
SWE_CODE = 63.0
# Days per second of playback in the dashboard.
DAYS_PER_SECOND = 12


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    snow = load_snow_config(cfg)
    settings = snow.raw
    web = cfg.raw["web"]
    data_dir = (HERE / settings["data_dir"]).resolve()
    json_path = (HERE / settings["json_path"]).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)

    with open(snow.work_dir / "peaks.json", encoding="utf-8") as handle:
        summary = json.load(handle)
    events = summary["events"]

    grid = WebGrid(cfg)
    write_gz(data_dir / "counties.bin.gz", grid.county_grid)
    # Keep two cells beyond the boundary so the smoothed map has clean edges, and blank the rest.
    keep = ndimage.binary_dilation(grid.inside == 1, iterations=2)

    check_path = snow.work_dir / "snodas_check.json"
    check = json.loads(check_path.read_text(encoding="utf-8")) if check_path.exists() else None
    check_rows = {row["year"]: row for row in check["winters"]} if check else {}

    for stale in list(data_dir.glob("total-*.bin.gz")) + list(data_dir.glob("daily-*.bin.gz")):
        stale.unlink()

    resample = None
    nearest = None
    total_bytes = 0
    daily_bytes = 0
    largest_cell_in = 0.0
    web_events = []
    poster_event, poster_field = None, None
    for event in events:
        winter = event["year"]
        data = load_winter(cfg, snow, winter)
        swe, dates = data["swe_mm"], data["dates"]
        if resample is None:
            resample = grid.resampler(data["lat"], data["lon"])
            missing = swe[len(swe) // 2] == SWE_MISSING
            nearest = ndimage.distance_transform_edt(missing, return_distances=False, return_indices=True)

        def to_web(stack: np.ndarray) -> np.ndarray:
            """Fill the lakes, resample to the web grid, and return inches."""
            filled = stack[:, nearest[0], nearest[1]].astype(np.float32)
            out = resample(np.clip(filled, 0, None)) / MM_PER_INCH
            out[:, ~keep] = 0
            return out

        first = int(np.flatnonzero(dates == np.datetime64(event["series_start"]))[0])
        count = len(event["series_mean_in"])
        peak_position = first + event["peak_index"]
        peak_in = to_web(swe[peak_position : peak_position + 1])[0]
        largest_cell_in = max(largest_cell_in, float(peak_in[grid.inside == 1].max()))
        total_bytes += write_gz(data_dir / f"total-{winter}.bin.gz", encode(peak_in, SWE_CODE))
        if event["rank"] == 1:
            poster_event, poster_field = event, peak_in

        if event["animated"]:
            codes = np.empty((count, grid.height, grid.width), dtype=np.uint8)
            for start in range(0, count, 32):
                block = swe[first + start : first + min(count, start + 32)]
                codes[start : start + len(block)] = encode(to_web(block), SWE_CODE)
            # Differences from the day before, wrapping at 256.
            deltas = codes.copy()
            deltas[1:] = codes[1:] - codes[:-1]
            daily_bytes += write_gz(data_dir / f"daily-{winter}.bin.gz", deltas)

        keep_keys = (
            "year", "label", "rank", "animated", "peak_date", "mean_in", "peak_point_in", "peak_county",
            "peak_near", "area_at_least_in", "cover_percent", "snow_days", "first_snow_date", "last_snow_date",
            "days_at_least_1in", "largest_week_drop_in", "largest_week_drop_end", "series_start", "peak_index",
            "series_mean_in", "series_cover_percent",
        )
        item = {key: event[key] for key in keep_keys}
        item["peak_x"], item["peak_y"] = grid.point(event["peak_lon"], event["peak_lat"])
        if winter in check_rows:
            item["snodas_mean_in"] = check_rows[winter]["snodas_mean_in"]
        web_events.append(item)
        print(f"{winter}: exported" + (f" with {count} daily frames" if event["animated"] else ""), flush=True)

    palette, ramp = palette_block(
        settings.get("palette", web.get("palette", "Nasir")), bool(settings.get("palette_reversed", False))
    )
    top_in = float(settings.get("scale_max_in", 10))
    ticks = settings.get("scale_ticks", [0.25, 1, 2, 3, 4, 6, 8, 10])
    linear = bool(settings.get("scale_linear", False))
    payload = {
        "kind": "snow",
        "region": cfg.name,
        "region_area_sq_mi": summary["region_area_sq_mi"],
        "left_out_sq_mi": summary["left_out_sq_mi"],
        "first_year": summary["first_year"],
        "last_year": summary["last_year"],
        "timezone": cfg.timezone,
        "median_in": summary["median_in"],
        "mean_in": summary["mean_in"],
        "cover_threshold_in": summary["cover_threshold_in"],
        "season": summary.get("season"),
        "steps_per_second": DAYS_PER_SECOND,
        "check": {key: value for key, value in check.items() if key != "winters"} if check else None,
        "grid": grid.layout({"total_code": SWE_CODE, "hourly_code": SWE_CODE}),
        "scale": {
            "total_max_in": top_in,
            "hourly_max_in": top_in,
            "total_ticks": ticks,
            "hourly_ticks": ticks,
            "linear": linear,
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

    shutil.copyfile(snow.work_dir / "annual_peaks.csv", data_dir / "annual-peaks.csv")

    if poster_event is not None:
        day = datetime.date.fromisoformat(poster_event["peak_date"])
        make_poster(
            data_dir / "poster.png",
            grid,
            poster_field,
            ramp,
            top_in,
            ticks,
            title=f"{cfg.name} snow water equivalent, {day:%B} {day.day}, {day.year}",
            subtitle=(
                f"Largest statewide average since {summary['first_year']}, "
                f"{poster_event['mean_in']:.2f} inches"
            ),
            legend="Snow water equivalent, inches",
            credit=f"Data: University of Arizona SWE. Colors: {palette['name']} palette from Rang. hydromohsen.com",
            linear=linear,
        )

    if largest_cell_in > (255 / SWE_CODE) ** 2:
        print("Warning: a value is larger than the byte encoding can hold and was capped.")
    print(f"\nGrid: {grid.width} x {grid.height} cells of {grid.cell_m / 1000:g} km")
    print(f"Deepest cell on a peak day {largest_cell_in:.2f} in")
    print(f"Peak maps: {total_bytes / 1e6:.2f} MB in {len(web_events)} files")
    print(f"Daily frames: {daily_bytes / 1e6:.2f} MB")
    print(f"JSON: {json_path.stat().st_size / 1e3:.0f} KB at {json_path}")
    print(f"Binary files in {data_dir}")


if __name__ == "__main__":
    main()
