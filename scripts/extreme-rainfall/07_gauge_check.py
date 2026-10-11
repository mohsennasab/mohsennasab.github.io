"""Check every annual event against rain gauges, point by point.

For each event this asks the ACIS service for daily precipitation at every
gauge in the state, adds up the days that cover the event, and compares each
gauge with the AORC cell it sits in over the same days. Gauge days are taken
as 7 a.m. to 7 a.m. local time, which is when most volunteer observers read
their gauges.

A plain average of gauges is not a fair statewide number, because gauges
cluster around cities. Comparing each gauge with its own cell avoids that.

Writes gauge_check.csv and gauge_check.json in the work folder.

  python 07_gauge_check.py --config config/minnesota.toml
"""

from __future__ import annotations

import json
import urllib.request
import zoneinfo

import numpy as np
import pandas as pd
from shapely import contains_xy

from rainlib import MM_PER_INCH, base_parser, load_config, load_window, region_polygon

ACIS_STATIONS = "https://data.rcc-acis.org/MultiStnData"


def gauges(state: str, first_day: str, last_day: str) -> list[dict]:
    body = json.dumps(
        {
            "state": state,
            "sdate": first_day,
            "edate": last_day,
            "elems": [{"name": "pcpn", "interval": "dly", "duration": "dly"}],
            "meta": "name,ll",
        }
    ).encode()
    request = urllib.request.Request(ACIS_STATIONS, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.load(response)["data"]


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    args = parser.parse_args()
    cfg = load_config(args.config)
    state = cfg.raw["region"].get("state_postal")
    if not state:
        print("No state_postal in the settings file, so the gauge check is skipped.")
        return
    tz = zoneinfo.ZoneInfo(cfg.timezone)
    region = region_polygon(cfg)
    with open(cfg.work_dir / "events.json", encoding="utf-8") as handle:
        events = json.load(handle)["events"]

    rows = []
    for event in sorted(events, key=lambda e: e["year"]):
        first = pd.Timestamp(event["start_local"]).tz_localize(None).normalize()
        last = pd.Timestamp(event["end_local"]).tz_localize(None).normalize() + pd.Timedelta(days=1)
        days = pd.date_range(first, last)
        # A reading on day D covers 7 a.m. on D-1 to 7 a.m. on D.
        begin = pd.Timestamp(days[0] - pd.Timedelta(days=1) + pd.Timedelta(hours=7), tz=tz)
        finish = pd.Timestamp(days[-1] + pd.Timedelta(hours=7), tz=tz)
        hours = int((finish - begin) / pd.Timedelta(hours=1))
        window = load_window(cfg, finish.tz_convert("UTC").tz_localize(None), hours)
        total_in = np.where(window.values < 0, 0, window.values).sum(axis=0) * 0.1 / MM_PER_INCH
        lat, lon = window.latitude.values, window.longitude.values

        gauge_totals, cell_totals = [], []
        for station in gauges(state, f"{days[0]:%Y-%m-%d}", f"{days[-1]:%Y-%m-%d}"):
            if "ll" not in station["meta"]:
                continue
            x, y = station["meta"]["ll"]
            readings = [value[0] if isinstance(value, list) else value for value in station["data"]]
            try:
                amount = sum(0.0 if value == "T" else float(value) for value in readings)
            except ValueError:
                continue  # a missing or accumulated reading drops the gauge
            if not contains_xy(region, x, y):
                continue
            row = int(round((y - lat[0]) / (lat[1] - lat[0])))
            col = int(round((x - lon[0]) / (lon[1] - lon[0])))
            gauge_totals.append(amount)
            cell_totals.append(float(total_in[row, col]))

        gauge_array, cell_array = np.array(gauge_totals), np.array(cell_totals)
        result = {
            "year": event["year"],
            "days": f"{days[0]:%Y-%m-%d} to {days[-1]:%Y-%m-%d}",
            "gauges": int(gauge_array.size),
            "gauge_mean_in": round(float(gauge_array.mean()), 2),
            "aorc_mean_at_gauges_in": round(float(cell_array.mean()), 2),
            "aorc_over_gauges": round(float(cell_array.mean() / gauge_array.mean()), 2),
            "correlation": round(float(np.corrcoef(gauge_array, cell_array)[0, 1]), 2),
            "largest_gauge_in": round(float(gauge_array.max()), 2),
            "largest_aorc_at_gauges_in": round(float(cell_array.max()), 2),
        }
        rows.append(result)
        print(
            f"{result['year']}: {result['gauges']:4d} gauges, gauge mean {result['gauge_mean_in']:.2f} in, "
            f"AORC at the gauges {result['aorc_mean_at_gauges_in']:.2f} in, ratio {result['aorc_over_gauges']:.2f}, "
            f"correlation {result['correlation']:.2f}",
            flush=True,
        )

    pd.DataFrame(rows).to_csv(cfg.work_dir / "gauge_check.csv", index=False)
    with open(cfg.work_dir / "gauge_check.json", "w", encoding="utf-8") as handle:
        json.dump(rows, handle, indent=1)
    ratios = np.array([row["aorc_over_gauges"] for row in rows])
    print(
        f"\nAORC over gauges across {len(rows)} events: median {np.median(ratios):.2f}, "
        f"lowest {ratios.min():.2f}, highest {ratios.max():.2f}, "
        f"within 10 percent in {int(((ratios > 0.9) & (ratios < 1.1)).sum())}"
    )


if __name__ == "__main__":
    main()
