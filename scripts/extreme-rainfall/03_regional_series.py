"""Compute the hourly area-weighted average rainfall over the region.

Reads the local AORC cache and writes one CSV with a row per hour:
time_utc (end of the hour) and mean_mm (average depth over the region).

Cells count toward the average when their center falls inside the boundary.
Each cell is weighted by its ground area, which shrinks toward the north on a
latitude and longitude grid.

AORC has a small number of hours in which a block of cells is blank. For
those hours the average is taken over the cells that do have a value, and the
hour is listed in missing_hours.csv with the share of the region that was blank.

  python 03_regional_series.py --config config/minnesota.toml
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import xarray as xr
import zarr

from rainlib import AORC_PRECIP, base_parser, load_config, region_mask

BLOCK_HOURS = 144


def year_series(year: int, cfg, cell_index: np.ndarray, weights: np.ndarray, workers: int):
    store = cfg.year_store(year)
    times = xr.open_zarr(store).time.values
    packed = zarr.open(str(store), mode="r")[AORC_PRECIP]
    scale = float(packed.attrs.get("scale_factor", 1.0))
    fill = packed.fill_value
    n_hours = packed.shape[0]

    def block_mean(start: int):
        block = packed[start : start + BLOCK_HOURS]
        values = block.reshape(block.shape[0], -1)[:, cell_index]
        blank = values < 0
        if fill is not None and fill >= 0:
            blank |= values == fill
        if not blank.any():
            return start, values.astype(np.float32) @ weights, np.zeros(values.shape[0])
        usable = np.where(blank, 0, values).astype(np.float32) @ weights
        blank_share = blank.astype(np.float32) @ weights
        covered = np.clip(1.0 - blank_share, 1e-6, None)
        return start, np.where(blank_share < 1, usable / covered, 0.0), blank_share

    means = np.empty(n_hours, dtype=np.float64)
    blank_share = np.zeros(n_hours, dtype=np.float64)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start, block_values, block_blank in pool.map(block_mean, range(0, n_hours, BLOCK_HOURS)):
            means[start : start + block_values.size] = block_values
            blank_share[start : start + block_values.size] = block_blank
    index = pd.DatetimeIndex(times, name="time_utc")
    return pd.Series(means * scale, index=index), pd.Series(blank_share, index=index)


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    cfg = load_config(args.config)
    cfg.work_dir.mkdir(parents=True, exist_ok=True)

    grid = xr.open_zarr(cfg.year_store(cfg.cache_years[0]))
    mask, area_km2 = region_mask(cfg, grid.latitude.values, grid.longitude.values)
    cell_index = np.flatnonzero(mask.ravel())
    weights = area_km2.ravel()[cell_index]
    weights = (weights / weights.sum()).astype(np.float32)
    region_sq_mi = float(area_km2[mask].sum()) / 2.589988
    print(f"{cfg.name}: {cell_index.size:,} cells inside the boundary, {region_sq_mi:,.0f} square miles")

    parts, blanks = [], []
    for year in cfg.cache_years:
        started = time.time()
        series, blank_share = year_series(year, cfg, cell_index, weights, args.workers)
        parts.append(series)
        blanks.append(blank_share[blank_share > 0])
        n_blank = int((blank_share > 0).sum())
        note = f", {n_blank} hours with blank cells" if n_blank else ""
        print(
            f"{year}: {series.size} hours, total {series.sum() / 25.4:5.1f} in{note} ({time.time() - started:.0f} s)",
            flush=True,
        )

    missing = (pd.concat(blanks) * 100).round(2).rename("percent_of_region_blank")
    missing.to_csv(cfg.work_dir / "missing_hours.csv")
    print(f"Hours with blank cells: {missing.size} (listed in missing_hours.csv)")

    hourly = pd.concat(parts).rename("mean_mm")
    gaps = hourly.index.to_series().diff().dropna().ne(pd.Timedelta(hours=1)).sum()
    print(f"Hours: {hourly.size:,}. Breaks in the hourly sequence: {gaps}")
    out = cfg.work_dir / "regional_hourly.csv"
    hourly.round(4).to_csv(out)
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
