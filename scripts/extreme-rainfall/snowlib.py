"""Shared helpers for the snow water equivalent workflow (snow_*.py)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from rainlib import HERE, Config

SWE_FILE = "UA_SWE_Depth_800m_v1_{day:%Y%m%d}_stable.nc"
SWE_MISSING = -999


@dataclass(frozen=True)
class SnowConfig:
    source_dir: Path
    cache_dir: Path
    work_dir: Path
    first_winter: int
    last_winter: int
    season_first_winter: int
    season_start: str
    season_end: str
    raw: dict

    @property
    def winters(self) -> list[int]:
        """Winters that are ranked and mapped."""
        return list(range(self.first_winter, self.last_winter + 1))

    @property
    def cache_winters(self) -> list[int]:
        """Winters kept in the cache, which can start earlier."""
        return list(range(min(self.first_winter, self.season_first_winter), self.last_winter + 1))

    def days(self, winter: int) -> pd.DatetimeIndex:
        """Days of one winter. The winter is named for the year in which it ends."""
        return pd.date_range(f"{winter - 1}-{self.season_start}", f"{winter}-{self.season_end}", freq="D")

    def store(self, cfg: Config, winter: int) -> Path:
        return self.cache_dir / f"ua_swe_{cfg.slug}_{winter}.npz"


def load_snow_config(cfg: Config) -> SnowConfig:
    raw = cfg.raw.get("snow")
    if raw is None:
        raise SystemExit("The settings file has no [snow] section.")

    def resolve(value: str) -> Path:
        p = Path(value)
        return p if p.is_absolute() else (HERE / p).resolve()

    return SnowConfig(
        source_dir=resolve(raw["source_dir"]),
        cache_dir=resolve(raw["cache_dir"]),
        work_dir=resolve(raw["work_dir"]),
        first_winter=int(raw["first_winter"]),
        last_winter=int(raw["last_winter"]),
        season_first_winter=int(raw.get("season_first_winter", raw["first_winter"])),
        season_start=raw.get("season_start", "10-01"),
        season_end=raw.get("season_end", "06-30"),
        raw=raw,
    )


def load_winter(cfg: Config, snow: SnowConfig, winter: int) -> dict:
    """Return one cached winter: swe_mm (day, lat, lon) as int16, lat, lon, dates."""
    with np.load(snow.store(cfg, winter)) as data:
        return {
            "swe_mm": data["swe_mm"],
            "lat": data["lat"],
            "lon": data["lon"],
            "dates": pd.DatetimeIndex(data["dates"].astype("datetime64[D]")),
        }
