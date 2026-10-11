"""Find the day of peak snow water equivalent in each winter and describe it.

For every winter this computes the area-weighted average snow water
equivalent over the region for each day, picks the day on which that average
is largest, and measures the snowpack on that day: where it was deepest, how
much of the region held at least 1, 2, 4 inches of water and so on, and how
the regional average rose and fell through the winter.

A winter is named for the year in which it ends. Cells without a value (the
largest lakes) are left out of the average.

Outputs, all in the snow work folder:
  daily_mean.csv      regional average for every day of every winter
  season.csv          date and size of each winter's peak over the longer
                      record set by season_first_winter, for the count by month
  annual_peaks.csv    one row per winter
  peaks.json          the same winters with daily series and details

  python snow_02_find_peaks.py --config config/minnesota.toml
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from rainlib import MM_PER_INCH, SQ_KM_PER_SQ_MI, base_parser, load_config, load_counties, nearest_city, region_mask
from snowlib import SWE_MISSING, load_snow_config, load_winter


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    snow = load_snow_config(cfg)
    settings = snow.raw
    top_n = int(settings.get("top_n", 5))
    thresholds = settings.get("thresholds_in", [1, 2, 4, 6])
    cover_in = float(settings.get("cover_threshold_in", 0.1))
    floor_in = float(settings.get("animation_floor_in", 0.05))
    margin = int(settings.get("animation_margin_days", 5))
    snow.work_dir.mkdir(parents=True, exist_ok=True)
    counties = load_counties(cfg)
    cities = cfg.raw.get("cities", [])

    mask = None
    daily_parts = []
    season = []
    events = []
    for winter in snow.cache_winters:
        if not snow.store(cfg, winter).exists():
            print(f"{winter}: not in the cache, skipped", flush=True)
            continue
        data = load_winter(cfg, snow, winter)
        swe, lat, lon, dates = data["swe_mm"], data["lat"], data["lon"], data["dates"]
        if mask is None:
            mask, area_km2 = region_mask(cfg, lat, lon)
            # Cells that never carry a value are left out for good.
            valid = mask & (swe[len(swe) // 2] != SWE_MISSING)
            valid_area = area_km2[valid]
            region_area = float(valid_area.sum())
            weights = (valid_area / region_area).astype(np.float32)
            left_out_sq_mi = float(area_km2[mask & ~valid].sum()) / SQ_KM_PER_SQ_MI

        inside = swe[:, valid]
        have = (inside != SWE_MISSING).all(axis=1)
        mean_mm = np.where(have, np.where(inside == SWE_MISSING, 0, inside).astype(np.float32) @ weights, np.nan)
        series = pd.Series(mean_mm / MM_PER_INCH, index=dates, name="mean_in")
        daily_parts.append(series.to_frame().assign(winter=winter))

        peak_day = series.idxmax()
        position = int(series.index.get_loc(peak_day))
        season.append(
            {
                "year": int(winter),
                "peak_date": peak_day.strftime("%Y-%m-%d"),
                "month": int(peak_day.month),
                "mean_in": round(float(series.max()), 3),
            }
        )
        if winter < snow.first_winter:
            # Earlier winters are only counted by month.
            print(f"{winter}: peak {series.max():.2f} in on {peak_day:%Y-%m-%d}", flush=True)
            continue
        peak_map = np.where(valid, swe[position], -1).astype(np.float32)
        peak_row, peak_col = np.unravel_index(int(np.argmax(peak_map)), peak_map.shape)
        peak_lat, peak_lon = float(lat[peak_row]), float(lon[peak_col])
        county = None
        if counties is not None:
            from shapely.geometry import Point

            hit = counties[counties.contains(Point(peak_lon, peak_lat))]
            county = hit.iloc[0]["NAME"] if len(hit) else None

        def share(depth_in: float) -> dict:
            km2 = float(area_km2[valid & (peak_map >= depth_in * MM_PER_INCH)].sum())
            return {"sq_mi": round(km2 / SQ_KM_PER_SQ_MI), "percent": round(100 * km2 / region_area, 1)}

        # The stretch of days around the peak with snow on the ground region-wide.
        # It ends in each direction where the average stays under the floor for
        # more than a few days, so a late snowfall after a short bare spell is kept.
        filled = series.fillna(0).values
        snowy = filled >= floor_in

        def reach(step: int) -> int:
            edge, day, bare = position, position + step, 0
            while 0 <= day < len(filled) and bare <= margin:
                if snowy[day]:
                    edge, bare = day, 0
                else:
                    bare += 1
                day += step
            return edge

        first, last = reach(-1), reach(1)
        start = max(0, first - margin)
        end = min(len(filled) - 1, last + margin)

        after = series.iloc[position : end + 1]
        week_drop = (after.shift(7) - after).dropna()
        cover = 100 * (inside >= cover_in * MM_PER_INCH).astype(np.float32) @ weights

        peak_mean_mm = float(mean_mm[position])
        event = {
            "year": int(winter),
            "label": f"{winter - 1}-{str(winter)[2:]}",
            "peak_date": peak_day.strftime("%Y-%m-%d"),
            "mean_in": round(peak_mean_mm / MM_PER_INCH, 3),
            "mean_mm": round(peak_mean_mm, 1),
            "peak_point_in": round(float(peak_map.max()) / MM_PER_INCH, 2),
            "peak_lat": round(peak_lat, 4),
            "peak_lon": round(peak_lon, 4),
            "peak_county": county,
            "peak_near": nearest_city(peak_lat, peak_lon, cities),
            "area_at_least_in": {f"{depth:g}": share(depth) for depth in thresholds},
            "cover_percent": round(float(cover[position]), 1),
            "snow_days": int(snowy[first : last + 1].sum()),
            "first_snow_date": dates[first].strftime("%Y-%m-%d"),
            "last_snow_date": dates[last].strftime("%Y-%m-%d"),
            "days_at_least_1in": int((filled >= 1.0).sum()),
            "largest_week_drop_in": round(float(week_drop.max()), 3) if len(week_drop) else 0.0,
            "largest_week_drop_end": week_drop.idxmax().strftime("%Y-%m-%d") if len(week_drop) else None,
            "series_start": dates[start].strftime("%Y-%m-%d"),
            "peak_index": int(position - start),
            "series_mean_in": [round(float(v), 3) for v in filled[start : end + 1]],
            "series_cover_percent": [round(float(v), 1) for v in cover[start : end + 1]],
            "missing_days": int((~have).sum()),
        }
        events.append(event)
        near = event["peak_near"]
        print(
            f"{winter}: peak {event['mean_in']:.2f} in on {event['peak_date']}, deepest cell {event['peak_point_in']:.1f} in "
            f"{near['miles']:.0f} mi {near['direction']} of {near['city']}, snow from {event['first_snow_date']} "
            f"to {event['last_snow_date']}, largest week of loss {event['largest_week_drop_in']:.2f} in",
            flush=True,
        )

    ranked = sorted(events, key=lambda e: e["mean_in"], reverse=True)
    for position, event in enumerate(ranked, start=1):
        event["rank"] = position
        event["animated"] = position <= top_n

    pd.concat(daily_parts).round(4).to_csv(snow.work_dir / "daily_mean.csv", index_label="date")
    pd.DataFrame(season).to_csv(snow.work_dir / "season.csv", index=False)
    table = pd.DataFrame(
        [
            {
                "winter": e["label"],
                "rank": e["rank"],
                "peak_date": e["peak_date"],
                "mean_in": e["mean_in"],
                "deepest_cell_in": e["peak_point_in"],
                "deepest_cell_county": e["peak_county"],
                "deepest_cell_near": f"{e['peak_near']['miles']:.0f} mi {e['peak_near']['direction']} of {e['peak_near']['city']}",
                **{f"pct_area_ge_{k}in": v["percent"] for k, v in e["area_at_least_in"].items()},
                "pct_snow_covered": e["cover_percent"],
                "first_snow_date": e["first_snow_date"],
                "last_snow_date": e["last_snow_date"],
                "largest_week_drop_in": e["largest_week_drop_in"],
                "largest_week_drop_end": e["largest_week_drop_end"],
            }
            for e in events
        ]
    )
    table.to_csv(snow.work_dir / "annual_peaks.csv", index=False)

    values = [e["mean_in"] for e in events]
    summary = {
        "region": cfg.name,
        "region_area_sq_mi": round(region_area / SQ_KM_PER_SQ_MI),
        "left_out_sq_mi": round(left_out_sq_mi),
        "first_year": events[0]["year"],
        "last_year": events[-1]["year"],
        "median_in": round(float(np.median(values)), 3),
        "mean_in": round(float(np.mean(values)), 3),
        "cover_threshold_in": cover_in,
        "season": {"first_year": season[0]["year"], "last_year": season[-1]["year"], "events": season},
        "events": events,
    }
    with open(snow.work_dir / "peaks.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)

    print(f"\nRegion: {summary['region_area_sq_mi']:,} sq mi with values, {summary['left_out_sq_mi']:,} sq mi of lakes left out")
    print(f"Median winter peak {summary['median_in']:.2f} in")
    print(f"Largest {top_n} winters:")
    for e in ranked[:top_n]:
        print(f"  {e['rank']}. {e['label']}: {e['mean_in']:.2f} in on {e['peak_date']}")
    print(f"Saved results in {snow.work_dir}")


if __name__ == "__main__":
    main()
