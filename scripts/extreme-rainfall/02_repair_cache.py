"""Repair known defects in the local AORC cache using the Stage IV analysis.

Two kinds of defect are handled.

Blank cells. AORC v1.1 has a small number of hours in which a block of cells,
or the whole grid, carries the missing-value code. NOAA said in April 2026 that
these were masked by mistake and that corrected files would follow. One of
them is all of June 18, 2024 (UTC), a day of heavy rain in Minnesota.

Bad daily totals. On a few days the AORC total over the region is far from
both PRISM and Stage IV, which agree with each other. Step 4 finds such days.
The ones listed under [[replace_days]] in the settings file are replaced here.

Stage IV is the hourly radar and rain gauge analysis that AORC is built from
since 2002. The script downloads the Stage IV grid for each affected hour from
the Iowa Environmental Mesonet archive and resamples it to the AORC grid. For
blank hours it writes only into the blank cells. For listed days it replaces
every cell that Stage IV covers. Blank hours before 2002 stay blank and are
handled by the next step.

Writes blank_hours.csv, filled_hours.csv and replaced_hours.csv in the cache
folder. Delete a year's store and rerun step 1 to get NOAA's original back.

  python 02_repair_cache.py --config config/minnesota.toml
"""

from __future__ import annotations

import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import rasterio
import xarray as xr
import zarr
from affine import Affine
from rasterio.warp import Resampling, reproject

from rainlib import AORC_PRECIP, base_parser, load_config, region_mask

BLOCK_HOURS = 144
STAGE4_FIRST_YEAR = 2002
STAGE4_URL = "https://mesonet.agron.iastate.edu/archive/data/{t:%Y/%m/%d}/stage4/ST4.{t:%Y%m%d%H}.01h.grib"


def scan_year(cfg, year: int, inside: np.ndarray, workers: int) -> pd.DataFrame:
    """List the hours of one year that have blank cells inside the region."""
    store = cfg.year_store(year)
    times = xr.open_zarr(store).time.values
    packed = zarr.open(str(store), mode="r")[AORC_PRECIP]

    def scan(start: int):
        block = packed[start : start + BLOCK_HOURS]
        blank = block.reshape(block.shape[0], -1)[:, inside] < 0
        return start, blank.sum(axis=1)

    rows = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start, counts in pool.map(scan, range(0, packed.shape[0], BLOCK_HOURS)):
            for offset in np.flatnonzero(counts):
                rows.append((times[start + offset], int(counts[offset]), start + int(offset)))
    return pd.DataFrame(rows, columns=["time_utc", "blank_cells_in_region", "hour_index"])


def stage4_on_grid(cfg, when: pd.Timestamp, lat: np.ndarray, lon: np.ndarray) -> np.ndarray | None:
    """Return the Stage IV depth for the hour ending at `when`, in mm, on the cache grid."""
    folder = cfg.cache_dir / "stage4"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"ST4.{when:%Y%m%d%H}.01h.grib"
    if not path.exists():
        request = urllib.request.Request(STAGE4_URL.format(t=when), headers={"User-Agent": "extreme-rainfall-workflow"})
        try:
            path.write_bytes(urllib.request.urlopen(request, timeout=120).read())
        except Exception as error:
            print(f"  {when}: Stage IV not available ({error})")
            return None

    dlat = float(lat[1] - lat[0])
    dlon = float(lon[1] - lon[0])
    target = Affine(dlon, 0, lon[0] - dlon / 2, 0, -dlat, lat[-1] + dlat / 2)
    out = np.full((lat.size, lon.size), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        if src.crs is None:
            print(f"  {when}: Stage IV file is not usable")
            return None
        reproject(
            source=src.read(1).astype(np.float32),
            destination=out,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata,
            dst_transform=target,
            dst_crs="EPSG:4326",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    return out[::-1]  # back to south-to-north rows, like the cache


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--scan-only", action="store_true", help="List blank hours without filling")
    args = parser.parse_args()
    cfg = load_config(args.config)

    grid = xr.open_zarr(cfg.year_store(cfg.cache_years[0]))
    lat, lon = grid.latitude.values, grid.longitude.values
    mask, area_km2 = region_mask(cfg, lat, lon)
    inside = np.flatnonzero(mask.ravel())
    weights = area_km2[mask] / area_km2[mask].sum()

    found = []
    for year in cfg.cache_years:
        table = scan_year(cfg, year, inside, args.workers)
        if len(table):
            table.insert(0, "year", year)
            found.append(table)
            print(f"{year}: {len(table)} hours with blank cells", flush=True)
    columns = ["year", "time_utc", "blank_cells_in_region", "hour_index"]
    blanks = pd.concat(found, ignore_index=True) if found else pd.DataFrame(columns=columns)
    blanks["percent_of_region"] = (100 * blanks["blank_cells_in_region"] / inside.size).round(2)
    blanks.drop(columns="hour_index").to_csv(cfg.cache_dir / "blank_hours.csv", index=False)
    print(f"{len(blanks)} hours with blank cells, listed in {cfg.cache_dir / 'blank_hours.csv'}")
    if args.scan_only:
        return

    log = []
    fillable = blanks[blanks["year"] >= STAGE4_FIRST_YEAR]
    for year, year_rows in fillable.groupby("year"):
        store = cfg.year_store(int(year))
        packed = zarr.open(str(store), mode="r+")[AORC_PRECIP]
        times = pd.DatetimeIndex(xr.open_zarr(store).time.values)
        scale = float(packed.attrs.get("scale_factor", 0.1))
        for block_start, rows in year_rows.groupby(year_rows["hour_index"] // BLOCK_HOURS * BLOCK_HOURS):
            block = packed[block_start : block_start + BLOCK_HOURS]
            changed = False
            for hour_index in rows["hour_index"]:
                when = times[hour_index]
                stage4 = stage4_on_grid(cfg, when, lat, lon)
                if stage4 is None:
                    continue
                layer = block[hour_index - block_start]
                blank = (layer < 0) & np.isfinite(stage4)
                layer[blank] = np.rint(stage4[blank] / scale).astype(layer.dtype)
                changed = True
                log.append(
                    {
                        "time_utc": when,
                        "cells_filled": int(blank.sum()),
                        "cells_filled_in_region": int((blank & mask).sum()),
                        "filled_region_mean_mm": round(float(np.nanmean(stage4[blank & mask])) if (blank & mask).any() else 0.0, 3),
                        "source": "Stage IV hourly, Iowa Environmental Mesonet archive",
                    }
                )
            if changed:
                packed[block_start : block_start + BLOCK_HOURS] = block

        # How close is Stage IV to AORC on the valid hours around the gaps?
        gap_hours = set(year_rows["hour_index"])
        neighbors = sorted(
            {h + d for h in gap_hours for d in range(-6, 7)} - gap_hours
        )
        neighbors = [h for h in neighbors if 0 <= h < packed.shape[0]]
        pairs = []
        for hour_index in neighbors:
            stage4 = stage4_on_grid(cfg, times[hour_index], lat, lon)
            if stage4 is None:
                continue
            aorc_mm = packed[hour_index][mask].astype(np.float32) * scale
            if (aorc_mm < 0).any():
                continue
            pairs.append((float(aorc_mm @ weights), float(np.nan_to_num(stage4[mask]) @ weights)))
        if pairs:
            aorc_sum = sum(a for a, _ in pairs)
            stage4_sum = sum(s for _, s in pairs)
            ratio = stage4_sum / aorc_sum if aorc_sum > 0 else float("nan")
            print(
                f"{year}: on {len(pairs)} valid hours next to the gaps, regional mean "
                f"AORC {aorc_sum:.2f} mm, Stage IV {stage4_sum:.2f} mm, ratio {ratio:.2f}",
                flush=True,
            )

    replaced = []
    for item in cfg.raw.get("replace_days", []):
        day_end = pd.Timestamp(item["day_ending_utc"])
        wanted = pd.date_range(day_end - pd.Timedelta(hours=23), day_end, freq="h")
        for year in sorted(set(wanted.year)):
            store = cfg.year_store(int(year))
            packed = zarr.open(str(store), mode="r+")[AORC_PRECIP]
            times = pd.DatetimeIndex(xr.open_zarr(store).time.values)
            scale = float(packed.attrs.get("scale_factor", 0.1))
            positions = [int(times.get_loc(t)) for t in wanted if t.year == year]
            for block_start in sorted({p // BLOCK_HOURS * BLOCK_HOURS for p in positions}):
                block = packed[block_start : block_start + BLOCK_HOURS]
                for position in [p for p in positions if block_start <= p < block_start + BLOCK_HOURS]:
                    stage4 = stage4_on_grid(cfg, times[position], lat, lon)
                    if stage4 is None:
                        continue
                    layer = block[position - block_start]
                    before = float(np.where(layer[mask] < 0, 0, layer[mask]).astype(np.float32) @ weights) * scale
                    covered = np.isfinite(stage4)
                    layer[covered] = np.rint(stage4[covered] / scale).astype(layer.dtype)
                    after = float(np.where(layer[mask] < 0, 0, layer[mask]).astype(np.float32) @ weights) * scale
                    replaced.append(
                        {
                            "time_utc": times[position],
                            "region_mean_before_mm": round(before, 3),
                            "region_mean_after_mm": round(after, 3),
                            "note": item.get("note", ""),
                        }
                    )
                packed[block_start : block_start + BLOCK_HOURS] = block
        done = [r for r in replaced if day_end - pd.Timedelta(hours=23) <= r["time_utc"] <= day_end]
        print(
            f"Replaced the day ending {day_end}: regional mean "
            f"{sum(r['region_mean_before_mm'] for r in done):.1f} mm before, "
            f"{sum(r['region_mean_after_mm'] for r in done):.1f} mm after",
            flush=True,
        )
    def keep_record(rows: list[dict], name: str) -> int:
        """Add rows to a log file. An hour that is already listed keeps its first entry."""
        path = cfg.cache_dir / name
        table = pd.DataFrame(rows)
        if path.exists():
            table = pd.concat([pd.read_csv(path, parse_dates=["time_utc"]), table], ignore_index=True)
        table = table.drop_duplicates(subset="time_utc", keep="first").sort_values("time_utc")
        table.to_csv(path, index=False)
        return len(table)

    if replaced:
        keep_record(replaced, "replaced_hours.csv")

    log = [row for row in log if row["cells_filled"] > 0]
    if log:
        total = keep_record(log, "filled_hours.csv")
        print(f"Filled {len(log)} hours from Stage IV. {total} filled hours are listed in {cfg.cache_dir / 'filled_hours.csv'}")
    unfilled = blanks[blanks["year"] < STAGE4_FIRST_YEAR]
    if len(unfilled):
        print(f"{len(unfilled)} blank hours before {STAGE4_FIRST_YEAR} were left as they are.")


if __name__ == "__main__":
    main()
