"""Screen the regional daily totals against PRISM, an independent rainfall grid.

AORC is assembled from several other products, and a mistake in one of its
inputs can put a wrong total on a single day. This step compares the regional
average for every day with the same number from PRISM, which is built mainly
from rain gauges. It also compares the largest three-day total of every year
between the two.

PRISM statewide averages come from the ACIS web service of the NOAA Regional
Climate Centers, so this step works for a region that is a whole state. A
PRISM day runs from 12:00 UTC to 12:00 UTC, and the AORC hours are grouped
the same way.

Writes daily_aorc_vs_prism.csv, annual_3day_aorc_vs_prism.csv and
days_to_review.csv in the work folder. Look at days_to_review.csv. If a day
is far off and Stage IV agrees with PRISM, add it under [[replace_days]] in
the settings file and rerun steps 2 and 3.

  python 04_screen_daily_totals.py --config config/minnesota.toml
"""

from __future__ import annotations

import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from rainlib import MM_PER_INCH, base_parser, load_config

ACIS_GRID = "https://data.rcc-acis.org/GridData"
PRISM_GRID_ID = "21"
PRISM_FIRST_YEAR = 1981


def prism_year(state: str, year: int) -> list[tuple[str, float]]:
    body = json.dumps(
        {
            "state": state,
            "grid": PRISM_GRID_ID,
            "sdate": f"{year}-01-01",
            "edate": f"{year}-12-31",
            "elems": [{"name": "pcpn", "interval": "dly", "duration": "dly", "area_reduce": "state_mean"}],
        }
    ).encode()
    request = urllib.request.Request(ACIS_GRID, data=body, headers={"Content-Type": "application/json"})
    last_error = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                return [(day, values[state]) for day, values in json.load(response)["data"]]
        except Exception as error:  # the service is sometimes slow to answer
            last_error = error
    raise RuntimeError(f"PRISM request for {year} failed: {last_error}")


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("--review-above", type=float, default=0.5, help="Flag days that differ by more than this many inches")
    args = parser.parse_args()
    cfg = load_config(args.config)
    state = cfg.raw["region"].get("state_postal")
    if not state:
        print("No state_postal in the settings file, so there is nothing to compare against.")
        return

    years = [year for year in cfg.years if year >= PRISM_FIRST_YEAR]
    cache = cfg.work_dir / "prism_state_daily_in.csv"
    if cache.exists():
        prism = pd.read_csv(cache, index_col=0, parse_dates=True)["prism_in"]
    else:
        with ThreadPoolExecutor(max_workers=6) as pool:
            parts = list(pool.map(lambda year: prism_year(state, year), years))
        prism = pd.Series(
            {pd.Timestamp(day): (value if value is not None and value > -900 else np.nan) for part in parts for day, value in part},
            name="prism_in",
        ).sort_index()
        prism.to_csv(cache)

    hourly = pd.read_csv(cfg.work_dir / "regional_hourly.csv", index_col=0, parse_dates=True)["mean_mm"] / MM_PER_INCH
    # The day labeled D holds the hours ending 13:00 UTC on D-1 through 12:00 UTC on D.
    day_label = (hourly.index - pd.Timedelta(hours=13)).floor("D") + pd.Timedelta(days=1)
    aorc = hourly.groupby(day_label).sum().rename("aorc_in")

    daily = pd.concat([prism, aorc], axis=1).dropna()
    daily = daily[(daily.index.year >= years[0]) & (daily.index.year <= years[-1])]
    daily["difference_in"] = daily["aorc_in"] - daily["prism_in"]
    daily.round(4).to_csv(cfg.work_dir / "daily_aorc_vs_prism.csv")

    review = daily[daily["difference_in"].abs() > args.review_above].round(3)
    review.to_csv(cfg.work_dir / "days_to_review.csv")

    three_day = daily[["prism_in", "aorc_in"]].rolling(3).sum()
    rows = []
    for year, group in three_day.groupby(three_day.index.year):
        prism_end, aorc_end = group["prism_in"].idxmax(), group["aorc_in"].idxmax()
        rows.append(
            {
                "year": year,
                "prism_largest_3day_in": round(group["prism_in"].max(), 3),
                "prism_window_end": prism_end.date(),
                "aorc_largest_3day_in": round(group["aorc_in"].max(), 3),
                "aorc_window_end": aorc_end.date(),
                "prism_for_aorc_window_in": round(group["prism_in"].loc[aorc_end], 3),
                "same_storm": abs(prism_end - aorc_end) <= pd.Timedelta(days=2),
            }
        )
    annual = pd.DataFrame(rows)
    annual["aorc_over_prism"] = (annual["aorc_largest_3day_in"] / annual["prism_for_aorc_window_in"]).round(3)
    annual.to_csv(cfg.work_dir / "annual_3day_aorc_vs_prism.csv", index=False)

    ratio = annual["aorc_over_prism"]
    summary = {
        "first_year": int(years[0]),
        "last_year": int(years[-1]),
        "days_compared": int(len(daily)),
        "daily_correlation": round(float(daily["prism_in"].corr(daily["aorc_in"])), 3),
        "prism_mean_in_per_year": round(float(daily["prism_in"].sum() / len(years)), 2),
        "aorc_mean_in_per_year": round(float(daily["aorc_in"].sum() / len(years)), 2),
        "years_same_storm": int(annual["same_storm"].sum()),
        "years_compared": int(len(annual)),
        "median_ratio_largest_window": round(float(ratio.median()), 3),
        "years_within_10_percent": int(((ratio > 0.9) & (ratio < 1.1)).sum()),
        "lowest_ratio": {"year": int(annual.loc[ratio.idxmin(), "year"]), "ratio": float(ratio.min())},
        "highest_ratio": {"year": int(annual.loc[ratio.idxmax(), "year"]), "ratio": float(ratio.max())},
        "days_flagged": int(len(review)),
    }
    with open(cfg.work_dir / "screening_summary.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)

    print(f"Days compared: {summary['days_compared']:,}. Daily correlation: {summary['daily_correlation']}")
    print(
        f"Average per year: PRISM {summary['prism_mean_in_per_year']} in, AORC {summary['aorc_mean_in_per_year']} in"
    )
    print(
        f"Same storm is the largest three-day total in {summary['years_same_storm']} of {summary['years_compared']} years. "
        f"AORC over PRISM for that window: median {summary['median_ratio_largest_window']}, "
        f"within 10 percent in {summary['years_within_10_percent']} years, "
        f"range {summary['lowest_ratio']['ratio']} ({summary['lowest_ratio']['year']}) to "
        f"{summary['highest_ratio']['ratio']} ({summary['highest_ratio']['year']})"
    )
    print(f"\nDays that differ by more than {args.review_above} in ({len(review)}):")
    print(review.to_string() if len(review) else "  none")


if __name__ == "__main__":
    main()
