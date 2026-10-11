"""Find the wettest window of each year and describe it.

For every calendar year (local time) this picks the rolling window with the
largest regional average rainfall, then goes back to the hourly grids to
measure the event: where the most rain fell, how much of the region got at
least 1, 2, 3 inches and so on, and how the regional average built up hour by
hour.

Outputs, all in the work folder:
  annual_maxima.csv       one row per year
  events.json             the same events with hourly series and details
  top_windows.csv         the largest independent windows overall, any year
  season.csv              date and size of each annual event over the longer
                          record set by season_start_year, for the count by month
  grids/event_YYYY.npz    hourly grids of each annual event (packed integers)

  python 05_find_events.py --config config/minnesota.toml
"""

from __future__ import annotations

import json
import zoneinfo

import numpy as np
import pandas as pd
import xarray as xr

from rainlib import (
    MM_PER_INCH,
    SQ_KM_PER_SQ_MI,
    base_parser,
    cold_share,
    describe_event,
    load_config,
    load_counties,
    load_window,
    region_mask,
)

def independent_windows(rolling: pd.Series, hours: int, count: int) -> pd.Series:
    """Largest windows that do not share any hour with a larger one."""
    remaining = rolling.copy()
    picks = {}
    gap = pd.Timedelta(hours=hours - 1)
    while len(picks) < count and remaining.notna().any():
        end = remaining.idxmax()
        picks[end] = remaining.loc[end]
        remaining.loc[end - gap : end + gap] = np.nan
    return pd.Series(picks)


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    settings = cfg.raw["analysis"]
    hours = int(settings.get("duration_hours", 72))
    top_n = int(settings.get("top_n", 5))
    tz = zoneinfo.ZoneInfo(cfg.timezone)

    hourly = pd.read_csv(cfg.work_dir / "regional_hourly.csv", index_col=0, parse_dates=True)["mean_mm"]
    rolling = hourly.rolling(hours).sum()

    # A window belongs to the year in which it ends, on the local calendar.
    local_year = rolling.index.tz_localize("UTC").tz_convert(tz).year
    usable = rolling.dropna()
    ends = usable.groupby(local_year[rolling.notna().values]).idxmax()
    season_ends = ends[(ends.index >= cfg.cache_years[0]) & (ends.index <= cfg.end_year)]
    ends = ends[(ends.index >= cfg.start_year) & (ends.index <= cfg.end_year)]

    grid = xr.open_zarr(cfg.year_store(cfg.years[0]))
    mask, area_km2 = region_mask(cfg, grid.latitude.values, grid.longitude.values)
    counties = load_counties(cfg)
    (cfg.work_dir / "grids").mkdir(parents=True, exist_ok=True)

    # Optional: how much of each event fell near or below freezing. The answers
    # are kept in a small file so a rerun does not download the temperature again.
    threshold_f = settings.get("cold_threshold_f")
    cold_path = cfg.work_dir / "cold_share.json"
    cold_known = json.loads(cold_path.read_text(encoding="utf-8")) if cold_path.exists() else {}

    def cold_part(end_utc, packed=None):
        key = f"{end_utc.isoformat()}|{hours}|{threshold_f}"
        if key not in cold_known:
            if packed is None:
                window = load_window(cfg, end_utc, hours).values
                packed = np.where(window < 0, 0, window).astype(np.int16)
            cold_known[key] = round(cold_share(cfg, end_utc, hours, packed, mask, area_km2, float(threshold_f)), 4)
            cold_path.write_text(json.dumps(cold_known, indent=1), encoding="utf-8")
        return cold_known[key]

    events = []
    for year, end_utc in ends.items():
        event, packed = describe_event(cfg, year, end_utc, hours, mask, area_km2, counties, tz)
        np.savez_compressed(cfg.work_dir / "grids" / f"event_{year}.npz", hourly=packed)
        if threshold_f is not None:
            event["cold_share"] = cold_part(end_utc, packed)
            event["cold_threshold_f"] = float(threshold_f)
        events.append(event)
        near = event["peak_near"]
        print(
            f"{year}: {event['mean_in']:.2f} in, ending {event['end_local'][:16]}, "
            f"peak {event['peak_point_in']:.1f} in {near['miles']:.0f} mi {near['direction']} of {near['city']}"
            + (f", {event['cold_share']:.0%} at or below {threshold_f:g} F" if threshold_f is not None else ""),
            flush=True,
        )

    ranked = sorted(events, key=lambda e: e["mean_in"], reverse=True)
    for position, event in enumerate(ranked, start=1):
        event["rank"] = position
        event["animated"] = position <= top_n

    table = pd.DataFrame(
        [
            {
                "year": e["year"],
                "rank": e["rank"],
                "start_local": e["start_local"],
                "end_local": e["end_local"],
                "mean_in": e["mean_in"],
                "peak_point_in": e["peak_point_in"],
                "peak_county": e["peak_county"],
                "peak_near": f"{e['peak_near']['miles']:.0f} mi {e['peak_near']['direction']} of {e['peak_near']['city']}",
                **{f"pct_area_ge_{k}in": v["percent"] for k, v in e["area_at_least_in"].items()},
                "wettest_24h_mean_in": e["wettest_24h_mean_in"],
                "six_inch_24h_area_sq_mi": e["six_inch_24h_area_sq_mi"],
                "max_24h_point_in": e["max_24h_point_in"],
                "meets_mega_rain_test": e["meets_mega_rain_test"],
                "volume_billion_gallons": e["volume_billion_gallons"],
            }
            for e in events
        ]
    )
    table.to_csv(cfg.work_dir / "annual_maxima.csv", index=False)

    # Date and size of every annual event over the longer record. The month
    # is taken from the middle of the window.
    season = []
    for year, end_utc in season_ends.items():
        middle = (end_utc - pd.Timedelta(hours=hours / 2)).tz_localize("UTC").tz_convert(tz)
        row = {
            "year": int(year),
            "end_local": end_utc.tz_localize("UTC").tz_convert(tz).isoformat(),
            "month": int(middle.month),
            "mean_in": round(float(rolling.loc[end_utc]) / MM_PER_INCH, 3),
        }
        if threshold_f is not None:
            row["cold_share"] = cold_part(end_utc)
        season.append(row)
    pd.DataFrame(season).to_csv(cfg.work_dir / "season.csv", index=False)

    ranked_years = rolling[(local_year >= cfg.start_year) & (local_year <= cfg.end_year)]
    overall = independent_windows(ranked_years, hours, 25)
    overall_table = pd.DataFrame(
        {
            "end_utc": overall.index,
            "end_local": [t.tz_localize("UTC").tz_convert(tz).isoformat() for t in overall.index],
            "mean_in": (overall.values / MM_PER_INCH).round(3),
        }
    )
    overall_table["is_annual_maximum"] = overall_table["end_utc"].isin(set(ends.values))
    overall_table.to_csv(cfg.work_dir / "top_windows.csv", index=False)

    # A simple check for a drift over the years: the Theil-Sen slope and the
    # Kendall rank test, which do not assume the values follow a bell curve.
    from scipy import stats

    by_year = sorted(events, key=lambda e: e["year"])
    years_list = [e["year"] for e in by_year]
    values = [e["mean_in"] for e in by_year]
    slope, _, slope_low, slope_high = stats.theilslopes(values, years_list, 0.95)
    tau, p_value = stats.kendalltau(years_list, values)
    trend = {
        "slope_in_per_decade": round(float(slope) * 10, 3),
        "slope_low_in_per_decade": round(float(slope_low) * 10, 3),
        "slope_high_in_per_decade": round(float(slope_high) * 10, 3),
        "kendall_tau": round(float(tau), 3),
        "p_value": round(float(p_value), 3),
    }

    region_sq_mi = float(area_km2[mask].sum()) / SQ_KM_PER_SQ_MI
    summary = {
        "region": cfg.name,
        "region_area_sq_mi": round(region_sq_mi),
        "duration_hours": hours,
        "first_year": cfg.start_year,
        "last_year": cfg.end_year,
        "timezone": cfg.timezone,
        "median_in": round(float(np.median([e["mean_in"] for e in events])), 3),
        "mean_in": round(float(np.mean([e["mean_in"] for e in events])), 3),
        "trend": trend,
        "season": {
            "first_year": int(season_ends.index.min()),
            "last_year": int(season_ends.index.max()),
            "events": season,
        },
        "events": events,
    }
    with open(cfg.work_dir / "events.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)

    print(f"\nLargest {top_n} annual events:")
    for e in ranked[:top_n]:
        print(f"  {e['rank']}. {e['start_local'][:10]} to {e['end_local'][:10]}: {e['mean_in']:.2f} in")
    print(
        f"\nTrend: {trend['slope_in_per_decade']:+.3f} in per decade "
        f"(95% range {trend['slope_low_in_per_decade']:+.3f} to {trend['slope_high_in_per_decade']:+.3f}), "
        f"Kendall p = {trend['p_value']:.3f}"
    )
    print("\nLargest independent windows overall:")
    print(overall_table.head(10).to_string(index=False))
    print(f"\nSaved results in {cfg.work_dir}")


if __name__ == "__main__":
    main()
