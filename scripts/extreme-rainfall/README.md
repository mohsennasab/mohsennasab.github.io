# Extreme rainfall and snowpack by state

This folder holds the workflow behind the blog post
[The Wettest Days and the Whitest Winters](https://hydromohsen.com/blog/minnesota-rain-and-snow-extremes/).
It has two parts.

- Rainfall, from hourly AORC grids. It finds the wettest window of each year
  for a region, measured as the average rainfall over the whole region, and
  checks the result against two independent sources.
- Snow, from the University of Arizona daily snow water equivalent grids. It
  finds the day of each winter when the region's snowpack held the most
  water, and checks the result against SNODAS.

Both parts package their results for the interactive maps on the site.

The scripts are written for Minnesota, and every Minnesota-specific choice
lives in one settings file. Copy that file, point it at another boundary, and
the same commands produce the analysis for another state.

These are results from one rainfall data set and one snow data set. Other
data sets give somewhat different amounts and can put the years in a
different order. The checks below show by how much.

## Rainfall: what it does

1. Gets the region boundary as a polygon.
2. Copies hourly AORC precipitation for the region from NOAA's public cloud
   bucket to a local cache. No account or key is needed.
3. Repairs known defects in the cache, using the Stage IV analysis.
4. Computes the area-weighted average rainfall over the region for every hour
   of the record.
5. Screens the daily totals against PRISM to catch bad days.
6. Slides a window (72 hours by default) along the hourly series, picks the
   window with the largest total in each calendar year, and measures each
   event.
7. Checks a list of documented storms, and every annual event, against other
   records.
8. Resamples the maps to a 2 km grid and writes small binary files plus one
   JSON file for the web page.

## Rainfall: data sources

| Source | Used for | Where |
| --- | --- | --- |
| NOAA AORC v1.1, hourly, about 800 m | The rainfall itself | `s3://noaa-nws-aorc-v1-1-1km`, [registry page](https://registry.opendata.aws/noaa-nws-aorc/), [methods](https://www.weather.gov/media/owp/operations/aorc_v1_1_methods.pdf) |
| NCEP Stage IV, hourly, about 4 km | Repairing blank hours and bad days | [Iowa Environmental Mesonet archive](https://mesonet.agron.iastate.edu/archive/) |
| PRISM daily precipitation | Screening the daily totals | [ACIS](https://www.rcc-acis.org/) GridData service |
| Daily rain gauge records | Checking each event point by point | ACIS MultiStnData service |
| U.S. Census cartographic boundaries | Shoreline, counties | [census.gov](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html) |

Each AORC value is the depth of precipitation, in millimeters, that fell in
the hour ending at the timestamp. Timestamps are in UTC. Rain and melted snow
are counted together.

## Requirements

Python 3.11 or newer with these packages:

```
pip install xarray zarr s3fs dask numpy pandas scipy geopandas shapely rasterio affine "rang[plots]" matplotlib
```

The snow scripts also need `netCDF4`.

The rainfall cache for Minnesota takes about 9 GB for 47 years, and the
download runs at roughly 40 seconds per year on a fast connection. Put the
cache on a drive that is not synced to the cloud.

## Rainfall: run it

All commands are run from this folder. Each one reads `config/minnesota.toml`
unless you pass `--config` with another file.

```
python 00_get_boundary.py --arcgis-layer https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_state_of_minnesota/FeatureServer/4 --clip-to-shoreline Minnesota --out boundaries/minnesota.geojson
python 01_cache_aorc.py
python 02_repair_cache.py
python 03_regional_series.py
python 04_screen_daily_totals.py
python 05_find_events.py
python 06_reference_events.py
python 07_gauge_check.py
python 08_export_web.py
```

| Script | Reads | Writes |
| --- | --- | --- |
| `00_get_boundary.py` | An ArcGIS feature layer or the Census state file | `boundaries/<state>.geojson` |
| `01_cache_aorc.py` | NOAA's S3 bucket | One Zarr store per year in `cache_dir` |
| `02_repair_cache.py` | The cache, Stage IV | Patched cache, `blank_hours.csv`, `filled_hours.csv`, `replaced_hours.csv` |
| `03_regional_series.py` | The cache | `regional_hourly.csv`, `missing_hours.csv` |
| `04_screen_daily_totals.py` | The hourly series, PRISM | `daily_aorc_vs_prism.csv`, `annual_3day_aorc_vs_prism.csv`, `days_to_review.csv`, `screening_summary.json` |
| `05_find_events.py` | The hourly series, the cache | `annual_maxima.csv`, `events.json`, `top_windows.csv`, `grids/event_YYYY.npz` |
| `06_reference_events.py` | `[[reference_events]]` in the settings | `reference_events.csv`, `reference_events.json` |
| `07_gauge_check.py` | The events, gauge records | `gauge_check.csv`, `gauge_check.json` |
| `08_export_web.py` | Everything above | Binary maps and a poster in `public/blog/<name>/`, JSON in `src/data/` |

Steps 0 and 1 run once. The rest take a few minutes each and can be rerun
after changing a setting. Steps 4, 6 and 7 are checks. The export works
without them and includes their results when they exist.

## The repair and screening loop

AORC is assembled from other products, and two kinds of defect showed up in
the Minnesota record.

Blank cells. A small number of hours carry the missing-value code over a
block of cells or over the whole grid. NOAA said in April 2026 that these were
masked by mistake. All of June 18, 2024 (UTC) is blank nationwide. Step 2
fills blank cells from Stage IV for 2002 and later. Earlier blanks stay
blank, and step 3 averages over the cells that have a value.

Bad daily totals. Step 4 compares the regional total of every day with PRISM
and lists the days that differ by more than half an inch in
`days_to_review.csv`. For Minnesota that list had two entries.

| Day ending 12:00 UTC | AORC | PRISM | Stage IV |
| --- | --- | --- | --- |
| May 30, 2022 | 1.39 in | 0.54 in | 0.49 in |
| October 2, 2009 | 0.27 in | 0.89 in | 0.97 in |

Both are listed under `[[replace_days]]` in the settings file, and step 2
replaces their hours with Stage IV. The first of them had put a false storm
near the top of the list.

For a new region the loop is: run steps 1 to 4, look at `days_to_review.csv`,
check each listed day against Stage IV, add the confirmed ones to
`[[replace_days]]`, then rerun steps 2 to 4 until the list is empty.

To undo every repair for a year, delete that year's store from the cache and
rerun step 1.

## Results of the checks for Minnesota

- PRISM, 2000 to 2025: daily correlation 0.98 over 9,497 days. The two name
  the same storm as the year's largest three-day total in 24 of 26 years. For
  that storm AORC is within 10 percent of PRISM in 21 years, with a range of
  0.79 to 1.17.
- Rain gauges: 10,120 gauge-to-cell comparisons across the 26 events. AORC's
  average at the gauges is within 10 percent of the gauge average in 24
  events, with a range of 0.86 to 1.21.
- The ranking still depends on the data set. PRISM agrees that September 2010
  and July 2016 are first and second. After that it puts June 2013 third,
  June 2024 fourth and October 2005 fifth, where AORC has June 2024, June
  2014 and June 2003. PRISM's days run from morning to morning, which
  explains part of the difference.

## Settings

`config/minnesota.toml` is commented line by line. The ones most likely to
change:

| Setting | Meaning |
| --- | --- |
| `region.boundary` | The polygon to average over |
| `region.timezone` | Time zone for dates shown to readers and for assigning a window to a year |
| `region.projected_crs` | Projected coordinate system for the web map (a UTM zone works well) |
| `region.state_postal` | Postal code used for the PRISM and gauge checks |
| `period.start_year`, `period.end_year` | Years that are ranked and mapped |
| `period.season_start_year` | First year of the longer record used only for the count of events by month. The cache and the hourly series start here |
| `analysis.duration_hours` | Length of the window, 72 by default |
| `analysis.top_n` | How many of the largest events get hourly frames for playback |
| `analysis.cold_threshold_f` | Temperature used to report how much of an event fell as snow |
| `analysis.state_fips` | State code used to fetch county outlines from the Census |
| `cities` | Places used to describe where the heaviest rain fell, and map labels |
| `replace_days` | Days whose hours are replaced with Stage IV |
| `reference_events` | Documented storms to check against the ranking |
| `web.cell_km` | Cell size of the web maps |
| `web.palette` | Name of a [Rang](https://github.com/mohsennasab/Rang) palette |
| `snow.*` | Everything for the snow part: source folder, winters, how many winters get an animation, web output |

## Running another state

1. Copy `config/minnesota.toml` to `config/<state>.toml`.
2. Make the boundary. For any state:
   `python 00_get_boundary.py --census-state Wisconsin --out boundaries/wisconsin.geojson`
3. In the new settings file change the name, slug, boundary path, time zone,
   projected CRS, postal code, FIPS code, the list of cities, and the folders
   under `[paths]` and `[web]`. Empty the `replace_days` and
   `reference_events` lists.
4. Run steps 1 to 8 with `--config config/<state>.toml`, following the repair
   and screening loop above.
5. For snow, change the folders under `[snow]` and run the four `snow_*.py`
   scripts with the same `--config`.
6. On the site, import the new JSON files in a page and pass each one to
   `src/components/blog/RainfallDashboard.astro` together with the folder
   that holds its binary files. The component reads `kind` in the JSON file
   and draws the rain or the snow version.

Delete the cache folder if you change the boundary or the buffer, because the
cached grids are cut to the bounds of the boundary.

## Method notes

- A cell belongs to the region when its center is inside the boundary.
- Cells are weighted by ground area. On a latitude and longitude grid the
  cells get narrower toward the north, so a plain average of cells would
  give northern Minnesota about 10 percent too much weight.
- The Minnesota boundary is the state boundary published by the Minnesota
  DNR, trimmed to the Census shoreline so that open Lake Superior is left
  out. The average covers land and inland lakes, 84,154 square miles on the
  AORC grid.
- A window is assigned to the year in which it ends, on the local calendar.
- The window is identified from the regional average alone. A storm that
  drops a foot of rain on two counties can rank below a gentle three-day
  rain that covers the whole state. That is the intended behavior of this
  measure, and it is the main thing to keep in mind when reading the results.
- The share of an event that fell as snow is estimated from AORC's own air
  temperature, as the share of the water that fell at or below 34°F.

## Snow

The snow part reads the daily national files of the
[University of Arizona SWE data set](https://climate.arizona.edu/data/UA_SWE/)
(800 m grid, snow water equivalent and snow depth in millimeters, one NetCDF
file per day from October 1981). Download them first, for example with the
toolkit the files were fetched with, and point `snow.source_dir` at the
folder.

```
python snow_01_cache_swe.py
python snow_02_find_peaks.py
python snow_03_check_snodas.py
python snow_04_export_web.py
```

| Script | Reads | Writes |
| --- | --- | --- |
| `snow_01_cache_swe.py` | The national daily files | One compressed file per winter in `snow.cache_dir`, cut to the region |
| `snow_02_find_peaks.py` | The cache | `daily_mean.csv`, `annual_peaks.csv`, `peaks.json` in `snow.work_dir` |
| `snow_03_check_snodas.py` | The peaks, SNODAS from NSIDC | `snodas_samples.csv`, `snodas_check.json` |
| `snow_04_export_web.py` | Everything above | Binary maps and a poster in `public/blog/<name>/`, JSON in `src/data/` |

How it works:

- A winter is named for the year in which it ends, and covers the days from
  `snow.season_start` to `snow.season_end`.
- Winters from `snow.first_winter` on are ranked and mapped. Winters from
  `snow.season_first_winter` on are also cached and get a peak date in
  `season.csv`, which the post uses to count peaks by month over a longer
  record (the data starts in October 1981, so 1982 is the first winter).
- The regional average of each day is weighted by cell area, the same way as
  the rainfall. The peak of a winter is the day with the largest average.
- The grid has no values over the largest lakes (1,228 square miles in
  Minnesota, such as Lake of the Woods, the Red Lakes and Mille Lacs). Those
  cells are left out of every average. On the web map they take the value of
  the nearest cell that has one.
- "Snow on the ground" for the region means a regional average of at least
  `snow.animation_floor_in` inches of water. The animation of a winter runs
  from the first such day to the last, with a few days of margin.
- Step 3 is optional. It downloads about 3.5 GB (one 22 MB national file for
  each of 7 days per winter) and keeps its results, so a rerun is quick.

Results for Minnesota, winters 2000 to 2025: the median peak is 2.53 inches
of water. The five largest are 2018-19 (5.00 inches on March 19), 2022-23
(4.29 on April 7), 2010-11 (3.84 on March 12), 2000-01 (3.72 on March 16)
and 2012-13 (3.70 on March 20).

Check against SNODAS, winters 2004 to 2025: on the peak day the Arizona
average is within 20 percent of SNODAS in 15 of 22 winters, with a median
ratio of 0.95 and a range of 0.72 to 1.59. The two pick the same five
largest winters of those 22 and order them differently. They disagree most
on how fast the snow melts.

Limits of the snow data:

- Minnesota has no SNOTEL stations, so the product works out the water in
  the snow from observed snow depth and from PRISM temperature and
  precipitation. Every number is an estimate built on depth.
- The peak is one day for the whole region. The north usually peaks later
  than the south.

## Known limits of the rainfall data

- From 1979 to 2001 the daily totals in AORC come from a rain gauge analysis
  on a 12 km grid, and the split into hours relies on early radar summaries.
  From 2002 on, daily and hourly values come from Stage IV at about 4 km. The
  800 m grid is finer than the information in it.
- A grid cell is an area average. It reads lower than a single rain gauge at
  the core of a storm. For the August 2007 flood in southeast Minnesota, the
  largest 24-hour cell value is 12.7 inches, against 15.10 inches measured at
  the gauge near Hokah.
- Stage IV hourly totals are themselves imperfect. On the two days of the
  September 2010 flood they are about 20 percent below PRISM. That is why
  the repair step replaces only the days listed by hand.

## Colors

Maps use palettes from [Rang](https://github.com/mohsennasab/Rang), a set of
palettes drawn from Persian art. The rain maps use Nasir, from the stained
glass of the Nasir al-Mulk Mosque in Shiraz (`web.palette`). The snow maps
use Iwan, from the tiled entrance of the Shah Mosque in Isfahan
(`snow.palette`). Iwan runs from gold to deep blue, so bare ground is gold
and the deepest snow is navy. Set `snow.palette_reversed = true` to turn it
around. The snow colors follow the depth itself (`snow.scale_linear`), and
the rain colors follow its square root.

## Files written for the web page

Both export steps use `weblib.py`, so the rain and snow maps share one grid,
one byte encoding and one set of outlines.

| File | Content |
| --- | --- |
| `src/data/<name>.json` | Grid layout, color ramp, outlines, city labels, facts of every event, results of the checks |
| `public/blog/<name>/total-YYYY.bin.gz` | Rain: event total per cell. Snow: water in the snow on the peak day. One byte each, square root of inches times 63 |
| `public/blog/<name>/hourly-YYYY.bin.gz` | Rain: one grid per hour, square root of inches per hour times 120 |
| `public/blog/<name>/daily-YYYY.bin.gz` | Snow: one grid per day, stored as the change from the day before, wrapping at 256 |
| `public/blog/<name>/counties.bin.gz` | County number of each cell, 0 outside the region |
| `public/blog/<name>/annual-maxima.csv`, `annual-peaks.csv` | The tables of annual events |
| `public/blog/<name>/poster.png` | Still map of the largest event |
