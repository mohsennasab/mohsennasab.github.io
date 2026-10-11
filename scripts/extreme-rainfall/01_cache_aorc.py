"""Copy hourly AORC precipitation for the region from NOAA's public S3 bucket to a local cache.

One Zarr store is written per year. The values stay in the packed integer form
NOAA publishes (tenths of a millimeter per hour), so the copy is lossless and
small. A year that is already complete is skipped, so the script can be stopped
and restarted.

  python 01_cache_aorc.py --config config/minnesota.toml
  python 01_cache_aorc.py --config config/minnesota.toml --years 2007 2007
"""

from __future__ import annotations

import shutil
import time

import dask
import s3fs
import xarray as xr
from numcodecs import Blosc

from rainlib import AORC_BUCKET, AORC_PRECIP, base_parser, load_config, region_bounds

TIME_CHUNK = 144  # matches the chunking of the source, six days of hours


def cache_year(year: int, cfg, bounds, s3) -> str:
    target = cfg.year_store(year)
    done_flag = target / ".complete"
    if done_flag.exists():
        return "already cached"

    partial = target.with_suffix(".partial")
    if partial.exists():
        shutil.rmtree(partial)
    if target.exists():
        shutil.rmtree(target)

    west, south, east, north = bounds
    source = xr.open_zarr(
        s3fs.S3Map(f"{AORC_BUCKET}/{year}.zarr", s3=s3, check=False),
        consolidated=True,
        mask_and_scale=False,
    )
    precip = source[AORC_PRECIP].sel(
        latitude=slice(south, north), longitude=slice(west, east)
    )
    precip = precip.chunk({"time": TIME_CHUNK, "latitude": -1, "longitude": -1})

    # Keep the packed integers. The scale factor stays in the attributes so
    # xarray decodes to millimeters when the cache is opened normally.
    encoding = {
        "compressor": Blosc(cname="zstd", clevel=3, shuffle=Blosc.BITSHUFFLE),
        "chunks": (TIME_CHUNK, precip.sizes["latitude"], precip.sizes["longitude"]),
    }
    fill = precip.attrs.pop("_FillValue", None)
    if fill is not None:
        encoding["_FillValue"] = fill
    precip.encoding = {}

    out = precip.to_dataset(name=AORC_PRECIP)
    out.attrs = {
        "source": f"s3://{AORC_BUCKET}/{year}.zarr",
        "region": cfg.name,
        "bounds_wsen": [float(v) for v in bounds],
    }
    out.to_zarr(partial, mode="w", encoding={AORC_PRECIP: encoding}, consolidated=True)
    partial.rename(target)
    done_flag.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    size_mb = sum(f.stat().st_size for f in target.rglob("*") if f.is_file()) / 1e6
    return f"{precip.sizes['time']} hours, {size_mb:,.0f} MB"


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("--years", nargs=2, type=int, metavar=("FIRST", "LAST"))
    parser.add_argument("--workers", type=int, default=16, help="Download threads")
    args = parser.parse_args()

    cfg = load_config(args.config)
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    years = cfg.cache_years if not args.years else list(range(args.years[0], args.years[1] + 1))
    bounds = region_bounds(cfg)
    print(f"{cfg.name}: caching {years[0]} to {years[-1]} into {cfg.cache_dir}")
    print("Bounds (west, south, east, north):", ", ".join(f"{v:.3f}" for v in bounds))

    s3 = s3fs.S3FileSystem(anon=True)
    dask.config.set(scheduler="threads", num_workers=args.workers)

    for year in years:
        started = time.time()
        for attempt in range(1, 4):
            try:
                note = cache_year(year, cfg, bounds, s3)
                break
            except Exception as error:  # network hiccups are worth a retry
                note = f"failed: {error}"
                print(f"  {year} attempt {attempt} failed: {error}", flush=True)
                time.sleep(15 * attempt)
        print(f"{year}: {note} ({time.time() - started:,.0f} s)", flush=True)


if __name__ == "__main__":
    main()
