"""Compare each winter's peak with SNODAS, a second snow product.

SNODAS is NOAA's daily snow analysis, a model that is nudged toward ground,
airborne and satellite observations. It starts in the fall of 2003. For every
winter since then this reads the SNODAS snow water equivalent on the peak day
found by snow_02_find_peaks.py and on the days 1, 2 and 3 weeks before and
after it, and averages each grid over the region the same way.

The national file for one day is about 22 MB, so the step downloads about
3.5 GB in all. Results are kept in snodas_samples.csv and a rerun only fetches
what is missing.

Writes snodas_samples.csv and snodas_check.json in the snow work folder.

  python snow_03_check_snodas.py --config config/minnesota.toml
"""

from __future__ import annotations

import gzip
import io
import json
import tarfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from rainlib import MM_PER_INCH, base_parser, load_config, region_bounds, region_mask
from snowlib import load_snow_config

SNODAS_URL = "https://noaadata.apps.nsidc.org/NOAA/G02158/masked/{day:%Y}/{day:%m}_{day:%b}/SNODAS_{day:%Y%m%d}.tar"
SNODAS_FIRST_WINTER = 2004
# Product 1034 is snow water equivalent, stored as whole millimeters.
SWE_PRODUCT = "1034"
OFFSETS_DAYS = (-21, -14, -7, 0, 7, 14, 21)
COLUMNS, ROWS = 6935, 3351
CELL_DEG = 1 / 120


def snodas_grid(day: pd.Timestamp) -> tuple[np.ndarray, float, float]:
    """Return the national grid in millimeters (missing as -9999), its west edge and its north edge."""
    request = urllib.request.Request(SNODAS_URL.format(day=day), headers={"User-Agent": "Mozilla/5.0"})
    last_error = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                archive = tarfile.open(fileobj=io.BytesIO(response.read()))
            break
        except Exception as error:  # the archive has occasional gaps and timeouts
            last_error = error
    else:
        raise RuntimeError(f"SNODAS for {day:%Y-%m-%d} could not be read: {last_error}")
    west, north = -124.73333333333333, 52.875
    values = None
    for member in archive.getmembers():
        if f"us_ssmv1{SWE_PRODUCT}" not in member.name:
            continue
        raw = gzip.decompress(archive.extractfile(member).read())
        if member.name.endswith(".dat.gz"):
            values = np.frombuffer(raw, dtype=">i2").reshape(ROWS, COLUMNS)
        else:
            for line in raw.decode("ascii", "replace").splitlines():
                if line.startswith("Minimum x-axis coordinate:"):
                    west = float(line.split(":")[1])
                elif line.startswith("Maximum y-axis coordinate:"):
                    north = float(line.split(":")[1])
    if values is None:
        raise RuntimeError(f"SNODAS for {day:%Y-%m-%d} has no snow water equivalent grid")
    return values, west, north


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    snow = load_snow_config(cfg)
    with open(snow.work_dir / "peaks.json", encoding="utf-8") as handle:
        events = [e for e in json.load(handle)["events"] if e["year"] >= SNODAS_FIRST_WINTER]

    cache = snow.work_dir / "snodas_samples.csv"
    known = pd.read_csv(cache, parse_dates=["date"]) if cache.exists() else pd.DataFrame(columns=["winter", "date", "snodas_mean_in"])
    have = {(int(row.winter), row.date.strftime("%Y-%m-%d")) for row in known.itertuples()}
    wanted = [
        (event["year"], pd.Timestamp(event["peak_date"]) + pd.Timedelta(days=offset))
        for event in events
        for offset in OFFSETS_DAYS
    ]
    todo = [(winter, day) for winter, day in wanted if (winter, day.strftime("%Y-%m-%d")) not in have]

    west, south, east, north = region_bounds(cfg)
    window = {}

    def sample(job):
        winter, day = job
        try:
            values, grid_west, grid_north = snodas_grid(day)
        except RuntimeError as error:
            print(error, flush=True)
            return None
        col0 = int((west - grid_west) / CELL_DEG)
        col1 = int((east - grid_west) / CELL_DEG) + 1
        row0 = int((grid_north - north) / CELL_DEG)
        row1 = int((grid_north - south) / CELL_DEG) + 1
        key = (round(grid_west, 6), round(grid_north, 6))
        if key not in window:
            # Cell centers, with latitude ascending as region_mask expects.
            lon = grid_west + (np.arange(col0, col1) + 0.5) * CELL_DEG
            lat = (grid_north - (np.arange(row0, row1) + 0.5) * CELL_DEG)[::-1]
            mask, area_km2 = region_mask(cfg, lat, lon)
            window[key] = (mask[::-1], area_km2[::-1])
        mask, area_km2 = window[key]
        part = values[row0:row1, col0:col1]
        valid = mask & (part >= 0)
        mean_mm = float((part[valid] * area_km2[valid]).sum() / area_km2[valid].sum())
        print(f"{day:%Y-%m-%d}: SNODAS {mean_mm / MM_PER_INCH:.2f} in", flush=True)
        return {"winter": winter, "date": day, "snodas_mean_in": round(mean_mm / MM_PER_INCH, 3)}

    if todo:
        # The first call builds the mask, so run it alone before the threads start.
        rows = [sample(todo[0])]
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows += list(pool.map(sample, todo[1:]))
        known = pd.concat([known, pd.DataFrame([row for row in rows if row])], ignore_index=True)
        known["date"] = pd.to_datetime(known["date"])
        known.sort_values(["winter", "date"]).to_csv(cache, index=False)

    daily = pd.read_csv(snow.work_dir / "daily_mean.csv", parse_dates=["date"]).set_index("date")["mean_in"]
    winters = []
    for event in events:
        samples = known[known["winter"] == event["year"]].set_index("date")["snodas_mean_in"].sort_index()
        peak_day = pd.Timestamp(event["peak_date"])
        if peak_day not in samples.index:
            continue
        best_day = samples.idxmax()
        winters.append(
            {
                "year": event["year"],
                "peak_date": event["peak_date"],
                "ua_mean_in": event["mean_in"],
                "snodas_mean_in": float(samples.loc[peak_day]),
                "ua_over_snodas": round(event["mean_in"] / float(samples.loc[peak_day]), 3),
                "snodas_largest_sample_in": float(samples.max()),
                "snodas_largest_sample_date": best_day.strftime("%Y-%m-%d"),
                "ua_on_that_date_in": round(float(daily.get(best_day, np.nan)), 3),
            }
        )

    table = pd.DataFrame(winters)
    ratio = table["ua_over_snodas"]
    top = int(snow.raw.get("top_n", 5))
    ua_top = set(table.nlargest(top, "ua_mean_in")["year"])
    snodas_top = set(table.nlargest(top, "snodas_largest_sample_in")["year"])
    summary = {
        "source": "SNODAS",
        "first_year": int(table["year"].min()),
        "last_year": int(table["year"].max()),
        "winters_compared": int(len(table)),
        "samples": int(len(known)),
        "median_ratio": round(float(ratio.median()), 3),
        "within_20_percent": int(((ratio > 0.8) & (ratio < 1.2)).sum()),
        "lowest_ratio": {"year": int(table.loc[ratio.idxmin(), "year"]), "ratio": float(ratio.min())},
        "highest_ratio": {"year": int(table.loc[ratio.idxmax(), "year"]), "ratio": float(ratio.max())},
        "rank_correlation": round(float(table["ua_mean_in"].corr(table["snodas_largest_sample_in"], method="spearman")), 3),
        "peak_within_a_week": int(
            ((pd.to_datetime(table["snodas_largest_sample_date"]) - pd.to_datetime(table["peak_date"])).abs() <= pd.Timedelta(days=7)).sum()
        ),
        "top_ua": sorted(int(year) for year in ua_top),
        "top_snodas": sorted(int(year) for year in snodas_top),
        "top_shared": len(ua_top & snodas_top),
        "winters": winters,
    }
    with open(snow.work_dir / "snodas_check.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)

    print(table.to_string(index=False))
    print(
        f"\nUA over SNODAS on the peak day, {summary['winters_compared']} winters: median {summary['median_ratio']}, "
        f"within 20 percent in {summary['within_20_percent']}, range {summary['lowest_ratio']['ratio']} "
        f"({summary['lowest_ratio']['year']}) to {summary['highest_ratio']['ratio']} ({summary['highest_ratio']['year']})"
    )
    print(f"Rank correlation of the winter peaks: {summary['rank_correlation']}")
    print(f"Largest {top} winters shared by both: {summary['top_shared']} (UA {summary['top_ua']}, SNODAS {summary['top_snodas']})")


if __name__ == "__main__":
    main()
