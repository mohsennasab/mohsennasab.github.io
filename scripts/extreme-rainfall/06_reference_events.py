"""Check a list of known storms against the regional ranking.

This step is optional. The settings file can list storms that are already
documented elsewhere, for example the Minnesota DNR list of mega-rains. For
each one this finds the wettest window that covers the storm, measures it the
same way as the annual events, and reports where it stands in its year.

Writes reference_events.csv and reference_events.json in the work folder.

  python 06_reference_events.py --config config/minnesota.toml
"""

from __future__ import annotations

import json
import zoneinfo

import pandas as pd
import xarray as xr

from rainlib import MM_PER_INCH, base_parser, describe_event, load_config, load_counties, region_mask


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    listed = cfg.raw.get("reference_events", [])
    if not listed:
        print("No reference_events in the settings file. Nothing to do.")
        return

    hours = int(cfg.raw["analysis"].get("duration_hours", 72))
    tz = zoneinfo.ZoneInfo(cfg.timezone)
    hourly = pd.read_csv(cfg.work_dir / "regional_hourly.csv", index_col=0, parse_dates=True)["mean_mm"]
    rolling = hourly.rolling(hours).sum()
    with open(cfg.work_dir / "events.json", encoding="utf-8") as handle:
        annual = {event["year"]: event for event in json.load(handle)["events"]}

    grid = xr.open_zarr(cfg.year_store(cfg.years[0]))
    mask, area_km2 = region_mask(cfg, grid.latitude.values, grid.longitude.values)
    counties = load_counties(cfg)

    rows = []
    for item in listed:
        first = pd.Timestamp(item["start"], tz=tz)
        last = pd.Timestamp(item.get("end", item["start"]), tz=tz) + pd.Timedelta(days=1)
        middle = (first + (last - first) / 2).tz_convert("UTC").tz_localize(None)
        # Every window that contains the middle of the storm is a candidate.
        candidates = rolling.loc[middle : middle + pd.Timedelta(hours=hours)]
        if candidates.dropna().empty:
            print(f"{item['start']}: outside the record, skipped")
            continue
        end_utc = candidates.idxmax()
        year = end_utc.tz_localize("UTC").tz_convert(tz).year
        if year not in annual:
            print(f"{item['start']}: outside the years that are ranked, skipped")
            continue
        event, _ = describe_event(cfg, year, end_utc, hours, mask, area_km2, counties, tz)

        year_values = rolling[rolling.index.tz_localize("UTC").tz_convert(tz).year == year]
        yearly = annual.get(year)
        same_storm = False
        if yearly:
            gap = abs(pd.Timestamp(yearly["end_utc"].rstrip("Z")) - end_utc)
            same_storm = gap < pd.Timedelta(hours=hours)
        row = {
            "name": item.get("name", ""),
            "listed_start": item["start"],
            "listed_end": item.get("end", item["start"]),
            "year": year,
            "window_start_local": event["start_local"],
            "window_end_local": event["end_local"],
            "mean_in": event["mean_in"],
            "annual_max_mean_in": yearly["mean_in"] if yearly else None,
            "is_annual_maximum": same_storm,
            "annual_rank": yearly["rank"] if (yearly and same_storm) else None,
            "share_of_annual_max": round(event["mean_in"] / yearly["mean_in"], 2) if yearly else None,
            "percentile_in_year": round(float((year_values < rolling.loc[end_utc]).mean()) * 100, 2),
            "peak_point_in": event["peak_point_in"],
            "peak_county": event["peak_county"],
            "max_24h_point_in": event["max_24h_point_in"],
            "six_inch_24h_area_sq_mi": event["six_inch_24h_area_sq_mi"],
            "meets_mega_rain_test": event["meets_mega_rain_test"],
            "listed_peak_in": item.get("listed_peak_in"),
            "source": item.get("source", ""),
        }
        rows.append(row)
        print(
            f"{row['listed_start']} {row['name']}: statewide {row['mean_in']:.2f} in, "
            f"year's largest {row['annual_max_mean_in']:.2f} in, same storm: {same_storm}, "
            f"6-inch area {row['six_inch_24h_area_sq_mi']:,} sq mi, 24-hour peak {row['max_24h_point_in']:.1f} in",
            flush=True,
        )

    pd.DataFrame(rows).to_csv(cfg.work_dir / "reference_events.csv", index=False)
    with open(cfg.work_dir / "reference_events.json", "w", encoding="utf-8") as handle:
        json.dump(rows, handle, indent=1)
    matched = sum(1 for row in rows if row["is_annual_maximum"])
    print(f"\n{matched} of {len(rows)} listed storms are also the largest window of their year.")


if __name__ == "__main__":
    main()
