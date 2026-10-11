"""Cut the region out of the national UA snow files and keep one file per winter.

The University of Arizona publishes one NetCDF file per day for the lower 48
states, with snow water equivalent and snow depth in millimeters on an 800 m
grid. This reads the cells around the region from each daily file and saves
each winter as one compressed file, so the later steps do not have to open
thousands of national grids.

  python snow_01_cache_swe.py --config config/minnesota.toml
  python snow_01_cache_swe.py --winters 2019 2019      # one winter only
"""

from __future__ import annotations

import time

import netCDF4
import numpy as np

from rainlib import base_parser, load_config, region_bounds
from snowlib import SWE_FILE, SWE_MISSING, load_snow_config

# Margin kept around the boundary, in degrees.
PAD_DEG = 0.05


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("--winters", nargs=2, type=int, metavar=("FIRST", "LAST"))
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    cfg = load_config(args.config)
    snow = load_snow_config(cfg)
    snow.cache_dir.mkdir(parents=True, exist_ok=True)
    winters = snow.cache_winters if not args.winters else list(range(args.winters[0], args.winters[1] + 1))

    # region_bounds adds the rainfall buffer, which is wider than needed here.
    west, south, east, north = region_bounds(cfg)
    trim = cfg.buffer_deg - PAD_DEG
    west, south, east, north = west + trim, south + trim, east - trim, north - trim

    window = None
    for winter in winters:
        target = snow.store(cfg, winter)
        if target.exists() and not args.overwrite:
            print(f"{winter}: already cached", flush=True)
            continue
        started = time.time()
        days = snow.days(winter)
        stack, missing = None, []
        for position, day in enumerate(days):
            path = snow.source_dir / SWE_FILE.format(day=day)
            if not path.exists():
                missing.append(day.strftime("%Y-%m-%d"))
                continue
            with netCDF4.Dataset(path) as source:
                source.set_auto_maskandscale(False)
                if window is None:
                    lat = source["lat"][:]
                    lon = source["lon"][:]
                    rows = np.flatnonzero((lat >= south) & (lat <= north))
                    cols = np.flatnonzero((lon >= west) & (lon <= east))
                    window = (slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1), lat[rows], lon[cols])
                if stack is None:
                    shape = (len(days), len(window[2]), len(window[3]))
                    stack = np.full(shape, SWE_MISSING, dtype=np.int16)
                stack[position] = source["SWE"][0, window[0], window[1]]
        if stack is None:
            print(f"{winter}: no files found in {snow.source_dir}", flush=True)
            continue
        np.savez_compressed(
            target,
            swe_mm=stack,
            lat=window[2].astype(np.float64),
            lon=window[3].astype(np.float64),
            dates=days.values.astype("datetime64[D]").astype("int64"),
        )
        note = f", {len(missing)} days missing ({missing[0]} to {missing[-1]})" if missing else ""
        print(
            f"{winter}: {len(days)} days, {stack.shape[1]} x {stack.shape[2]} cells, "
            f"{target.stat().st_size / 1e6:.0f} MB, {time.time() - started:.0f} s{note}",
            flush=True,
        )


if __name__ == "__main__":
    main()
