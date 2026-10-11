"""Shared helpers for the extreme rainfall workflow."""

from __future__ import annotations

import argparse
import math
import tomllib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

HERE = Path(__file__).resolve().parent

AORC_BUCKET = "noaa-nws-aorc-v1-1-1km"
AORC_PRECIP = "APCP_surface"
MM_PER_INCH = 25.4


@dataclass(frozen=True)
class Config:
    name: str
    slug: str
    boundary: Path
    buffer_deg: float
    timezone: str
    projected_crs: str
    start_year: int
    end_year: int
    season_start_year: int
    cache_dir: Path
    work_dir: Path
    raw: dict

    @property
    def years(self) -> list[int]:
        """Years that are ranked and mapped."""
        return list(range(self.start_year, self.end_year + 1))

    @property
    def cache_years(self) -> list[int]:
        """Years kept in the cache and in the hourly series, which can start earlier."""
        return list(range(min(self.start_year, self.season_start_year), self.end_year + 1))

    def year_store(self, year: int) -> Path:
        return self.cache_dir / f"aorc_apcp_{self.slug}_{year}.zarr"


def load_config(path: str | Path) -> Config:
    path = Path(path)
    if not path.is_absolute() and not path.exists():
        path = HERE / path
    with open(path, "rb") as handle:
        raw = tomllib.load(handle)

    def resolve(value: str) -> Path:
        p = Path(value)
        return p if p.is_absolute() else (HERE / p).resolve()

    region, period, paths = raw["region"], raw["period"], raw["paths"]
    return Config(
        name=region["name"],
        slug=region["slug"],
        boundary=resolve(region["boundary"]),
        buffer_deg=float(region.get("buffer_deg", 0.5)),
        timezone=region.get("timezone", "UTC"),
        projected_crs=region["projected_crs"],
        start_year=int(period["start_year"]),
        end_year=int(period["end_year"]),
        season_start_year=int(period.get("season_start_year", period["start_year"])),
        cache_dir=resolve(paths["cache_dir"]),
        work_dir=resolve(paths["work_dir"]),
        raw=raw,
    )


def base_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--config",
        default="config/minnesota.toml",
        help="Region settings file (default: config/minnesota.toml)",
    )
    return parser


def region_bounds(cfg: Config) -> tuple[float, float, float, float]:
    """Return (west, south, east, north) of the region plus the buffer, in degrees."""
    import geopandas as gpd

    gdf = gpd.read_file(cfg.boundary).to_crs("EPSG:4326")
    west, south, east, north = gdf.total_bounds
    b = cfg.buffer_deg
    return west - b, south - b, east + b, north + b


def region_polygon(cfg: Config):
    """Return the region as one shapely geometry in EPSG:4326."""
    import geopandas as gpd

    return gpd.read_file(cfg.boundary).to_crs("EPSG:4326").union_all()


def region_mask(cfg: Config, latitude, longitude):
    """Return (mask, cell_area_km2) on a latitude and longitude grid.

    mask is True where the cell center lies inside the region. cell_area_km2 is
    the ground area of every cell, which depends on latitude.
    """
    import numpy as np
    from shapely import contains_xy

    lon2d, lat2d = np.meshgrid(longitude, latitude)
    mask = contains_xy(region_polygon(cfg), lon2d, lat2d)
    earth_radius_km = 6371.0088
    dlat = np.deg2rad(abs(float(latitude[1] - latitude[0])))
    dlon = np.deg2rad(abs(float(longitude[1] - longitude[0])))
    cell_area_km2 = earth_radius_km**2 * dlat * dlon * np.cos(np.deg2rad(lat2d))
    return mask, cell_area_km2


CENSUS_COUNTIES = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip"


def load_counties(cfg: Config):
    """Return the counties of the region's state in EPSG:4326, or None without a FIPS code."""
    import io
    import urllib.request
    import zipfile

    import geopandas as gpd

    fips = cfg.raw.get("analysis", {}).get("state_fips")
    if not fips:
        return None
    folder = HERE / "boundaries" / "_census" / "cb_2023_us_county_500k"
    if not folder.exists():
        with urllib.request.urlopen(CENSUS_COUNTIES, timeout=600) as resp:
            zipfile.ZipFile(io.BytesIO(resp.read())).extractall(folder)
    counties = gpd.read_file(folder / "cb_2023_us_county_500k.shp")
    return counties[counties["STATEFP"] == str(fips)].to_crs("EPSG:4326").reset_index(drop=True)


SQ_KM_PER_SQ_MI = 2.589988
COMPASS = [
    "north", "north-northeast", "northeast", "east-northeast",
    "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest",
    "west", "west-northwest", "northwest", "north-northwest",
]


def load_window(cfg, end_utc: pd.Timestamp, hours: int) -> xr.DataArray:
    """Return the packed hourly grids for the window that ends at end_utc."""
    start = end_utc - pd.Timedelta(hours=hours - 1)
    years = sorted({start.year, end_utc.year})
    parts = [
        xr.open_zarr(cfg.year_store(year), mask_and_scale=False)[AORC_PRECIP]
        for year in years
        if cfg.year_store(year).exists()
    ]
    data = xr.concat(parts, dim="time") if len(parts) > 1 else parts[0]
    window = data.sel(time=slice(start, end_utc)).load()
    if window.sizes["time"] != hours:
        raise ValueError(f"Expected {hours} hours ending {end_utc}, found {window.sizes['time']}")
    return window


def nearest_city(lat: float, lon: float, cities: list[dict]) -> dict:
    best = None
    for city in cities:
        dlat = math.radians(lat - city["lat"])
        dlon = math.radians(lon - city["lon"])
        mean_lat = math.radians((lat + city["lat"]) / 2)
        north_km = dlat * 6371.0088
        east_km = dlon * 6371.0088 * math.cos(mean_lat)
        miles = math.hypot(north_km, east_km) / 1.609344
        if best is None or miles < best["miles"]:
            bearing = (math.degrees(math.atan2(east_km, north_km)) + 360) % 360
            best = {
                "city": city["name"],
                "miles": round(miles, 1),
                "direction": COMPASS[int((bearing + 11.25) // 22.5) % 16],
            }
    return best


def describe_event(cfg, year, end_utc, hours, mask, area_km2, counties, tz) -> tuple[dict, np.ndarray]:
    """Measure one event from its hourly grids. Returns the facts and the packed grids."""
    window = load_window(cfg, end_utc, hours)
    packed = window.values
    # Blank cells are counted as zero here and reported with the event.
    blank_cell_hours = int((packed < 0)[:, mask].sum())
    packed = np.where(packed < 0, 0, packed).astype(np.int16)
    scale = float(window.attrs.get("scale_factor", 0.1))
    lat = window.latitude.values
    lon = window.longitude.values

    region_area = float(area_km2[mask].sum())
    weights = np.where(mask, area_km2, 0.0) / region_area
    hourly_mean_mm = (packed.reshape(hours, -1).astype(np.float32) @ weights.ravel().astype(np.float32)) * scale
    total_mm = packed.sum(axis=0, dtype=np.int32) * scale
    inside_total = np.where(mask, total_mm, np.nan)

    peak_row, peak_col = np.unravel_index(int(np.nanargmax(inside_total)), inside_total.shape)
    peak_lat, peak_lon = float(lat[peak_row]), float(lon[peak_col])
    county = None
    if counties is not None:
        from shapely.geometry import Point

        hit = counties[counties.contains(Point(peak_lon, peak_lat))]
        county = hit.iloc[0]["NAME"] if len(hit) else None

    thresholds = cfg.raw["analysis"].get("thresholds_in", [1, 2, 3, 4, 6])
    area_at_least = {}
    for inches in thresholds:
        km2 = float(area_km2[mask & (total_mm >= inches * MM_PER_INCH)].sum())
        area_at_least[str(inches)] = {
            "sq_mi": round(km2 / SQ_KM_PER_SQ_MI),
            "percent": round(100 * km2 / region_area, 1),
        }

    # The Minnesota DNR mega-rain test, from the same grid: 6 inches over at
    # least 1,000 square miles within 24 hours, with 8 inches somewhere.
    cumulative = np.cumsum(packed, axis=0, dtype=np.int32)
    best_area, best_point = 0.0, 0.0
    for last in range(23, hours):
        day = cumulative[last] - (cumulative[last - 24] if last >= 24 else 0)
        day_mm = np.where(mask, day * scale, 0.0)
        best_area = max(best_area, float(area_km2[day_mm >= 6 * MM_PER_INCH].sum()))
        best_point = max(best_point, float(day_mm.max()))
    six_inch_sq_mi = best_area / SQ_KM_PER_SQ_MI

    series = pd.Series(hourly_mean_mm, index=pd.DatetimeIndex(window.time.values))
    day_sums = series.rolling(24).sum()
    start_utc = end_utc - pd.Timedelta(hours=hours)
    mean_mm = float(hourly_mean_mm.sum())
    volume_m3 = mean_mm / 1000 * region_area * 1e6

    def local(stamp: pd.Timestamp) -> str:
        return stamp.tz_localize("UTC").tz_convert(tz).isoformat()

    event = {
        "year": int(year),
        "start_utc": start_utc.isoformat() + "Z",
        "end_utc": end_utc.isoformat() + "Z",
        "start_local": local(start_utc),
        "end_local": local(end_utc),
        "duration_hours": hours,
        "mean_in": round(mean_mm / MM_PER_INCH, 3),
        "mean_mm": round(mean_mm, 2),
        "volume_acre_feet": round(volume_m3 / 1233.48184),
        "volume_billion_gallons": round(volume_m3 * 264.172052 / 1e9, 1),
        "volume_cubic_km": round(volume_m3 / 1e9, 2),
        "peak_point_in": round(float(np.nanmax(inside_total)) / MM_PER_INCH, 2),
        "peak_lat": round(peak_lat, 4),
        "peak_lon": round(peak_lon, 4),
        "peak_county": county,
        "peak_near": nearest_city(peak_lat, peak_lon, cfg.raw.get("cities", [])),
        "area_at_least_in": area_at_least,
        "wettest_24h_mean_in": round(float(day_sums.max()) / MM_PER_INCH, 3),
        "wettest_24h_end_local": local(day_sums.idxmax()),
        "wettest_hour_mean_in": round(float(series.max()) / MM_PER_INCH, 3),
        "wettest_hour_end_local": local(series.idxmax()),
        "six_inch_24h_area_sq_mi": round(six_inch_sq_mi),
        "max_24h_point_in": round(best_point / MM_PER_INCH, 2),
        "meets_mega_rain_test": bool(six_inch_sq_mi >= 1000 and best_point >= 8 * MM_PER_INCH),
        "blank_cell_hours": blank_cell_hours,
        "hourly_mean_in": [round(float(v) / MM_PER_INCH, 4) for v in hourly_mean_mm],
    }
    return event, packed


def cold_share(cfg: Config, end_utc, hours: int, packed, mask, area_km2, threshold_f: float) -> float:
    """Share of an event's water that fell while the air was at or below a temperature.

    AORC counts rain and melted snow together. This uses AORC's own 2 m air
    temperature, read from NOAA's bucket, as a simple sign of how much of the
    event was probably snow. Returns a fraction between 0 and 1.
    """
    import s3fs

    start = end_utc - pd.Timedelta(hours=hours - 1)
    grid = xr.open_zarr(cfg.year_store(end_utc.year))
    lat, lon = grid.latitude.values, grid.longitude.values
    pad = 1e-4
    s3 = s3fs.S3FileSystem(anon=True)
    parts = []
    for year in sorted({start.year, end_utc.year}):
        source = xr.open_zarr(s3fs.S3Map(f"{AORC_BUCKET}/{year}.zarr", s3=s3, check=False), consolidated=True)
        parts.append(
            source["TMP_2maboveground"].sel(
                latitude=slice(lat[0] - pad, lat[-1] + pad), longitude=slice(lon[0] - pad, lon[-1] + pad)
            )
        )
    temperature = xr.concat(parts, dim="time") if len(parts) > 1 else parts[0]
    kelvin = temperature.sel(time=slice(start, end_utc)).load().values
    if kelvin.shape != packed.shape:
        raise ValueError(f"Temperature grid {kelvin.shape} does not match the rainfall grid {packed.shape}")
    threshold_k = (threshold_f - 32) * 5 / 9 + 273.15
    water = packed.astype(np.float32) * np.where(mask, area_km2, 0.0).astype(np.float32)
    total = float(water.sum())
    return float(water[kelvin <= threshold_k].sum() / total) if total > 0 else 0.0
