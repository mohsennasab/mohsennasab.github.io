/* Structured course metadata drawn directly from python-fundamentals-hh repository files */
window.COURSE_DATA = {
  repoUrl: "https://github.com/mohsennasab/python-fundamentals-hh",
  colabBase: "https://colab.research.google.com/github/mohsennasab/python-fundamentals-hh/blob/main/notebooks",
  githubBase: "https://github.com/mohsennasab/python-fundamentals-hh/tree/main/notebooks",

  paths: [
    {
      id: "all",
      label: "All Modules (10)",
      description: "Full sequence from Python setup through spatial analysis and snow hydrology."
    },
    {
      id: "new",
      label: "New to Python",
      description: "Modules 1 to 6 build core Python habits using streamflow, GIS, gauges, and Atlas 14 design storms.",
      moduleNums: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "spatial",
      label: "Spatial & GIS",
      description: "Modules 3, 4, 7, 8, and 9 focus on vector watersheds, DEMs, SSURGO/gNATSGO soils, NLCD, and NAIP imagery.",
      moduleNums: [3, 4, 7, 8, 9]
    },
    {
      id: "modeling",
      label: "Live Data & Modeling",
      description: "Modules 5, 6, 7, 8, and 10 automate gauge feeds, Atlas 14 hyetographs, soils, land cover, and snow water volume.",
      moduleNums: [5, 6, 7, 8, 10]
    }
  ],

  modules: [
    {
      num: 1,
      slug: "01_setup_and_fundamentals",
      title: "Setup and Fundamentals",
      level: "Beginner",
      tags: ["beginner", "new"],
      summary: "Google Colab setup, engineering mental models, loops, functions, and reading spreadsheet files.",
      overview: "This module introduces Python to hydrologic and hydraulic professionals by connecting variables, loops, and functions to familiar spreadsheet workflows and stage or capacity checks in Google Colab.",
      studyArea: "Google Colab starter environment and tabular H&H calculations",
      libraries: ["python", "pandas", "matplotlib", "colab"],
      outcomes: [
        "Set up Google Colab as a reproducible Python workspace with zero local installation.",
        "Connect Python variables, lists, and functions to named spreadsheet cells and calculation templates.",
        "Make engineering decisions with if statements for flood stage and capacity checks.",
        "Automate repetitive tasks with for loops, custom functions, and Excel file I/O."
      ],
      aiPrompt: "Explain this Python function using a watershed runoff spreadsheet analogy, then add a safety check that warns if precipitation depth is negative.",
      lessons: [
        {
          id: "01-01",
          code: "1.1",
          title: "Introduction and Setup (Mental Models & First H&H Calculations)",
          notebook: "01_01_introduction_fundamentals.ipynb"
        },
        {
          id: "01-02",
          code: "1.2",
          title: "Python Fundamentals (Control Flow, Loops, Functions, and Excel Files)",
          notebook: "01_02_python_fundamentals.ipynb"
        }
      ]
    },
    {
      num: 2,
      slug: "02_timeseries",
      title: "Time Series Analysis",
      level: "Beginner",
      tags: ["beginner", "new"],
      summary: "USGS daily discharge parsing, datetime indexing, unit conversion (cfs to cms), and hydrographs.",
      overview: "Learn core time series workflows with real USGS daily discharge records for the Mississippi River at St. Paul, MN. Skills carry straight over to stage, precipitation, groundwater, and water quality series.",
      studyArea: "Mississippi River at St. Paul, MN (USGS daily discharge)",
      libraries: ["pandas", "numpy", "matplotlib"],
      outcomes: [
        "Load CSV discharge records and convert date strings into proper datetime indexes.",
        "Filter streamflow records by water year, month, or seasonal window and handle data gaps.",
        "Convert flow units between cubic feet per second (cfs) and cubic meters per second (cms).",
        "Resample daily discharge to monthly and annual summaries and plot hydrographs, flow duration curves, and rolling averages."
      ],
      aiPrompt: "Show how to resample this daily USGS discharge DataFrame to water-year peak annual flows and compute the 10-day rolling mean.",
      lessons: [
        {
          id: "02-01",
          code: "2.1",
          title: "Time Series Basics (USGS Daily Discharge at St. Paul, MN)",
          notebook: "02_01_TimeSeries_Basics.ipynb"
        }
      ]
    },
    {
      num: 3,
      slug: "03_vector-data",
      title: "Vector Data Analysis",
      level: "Beginner",
      tags: ["beginner", "new", "spatial"],
      summary: "GeoDataFrames, coordinate reference systems, spatial joins, buffers, and watershed risk maps.",
      overview: "Build spatial analysis skills to see where watershed features sit and how they intersect. Work with watershed polygons, stream networks, and building footprints in projected coordinate systems.",
      studyArea: "South Greeley HUC-12 watershed (101900090108) near Cheyenne, WY",
      libraries: ["geopandas", "shapely", "folium", "pandas", "matplotlib"],
      outcomes: [
        "Load GeoJSON and Shapefile vector layers into GeoDataFrames and inspect attribute tables.",
        "Check and reproject Coordinate Reference Systems (CRS) before measuring distances or polygon areas.",
        "Clip, buffer, intersect, and spatially join stream and infrastructure layers.",
        "Create static matplotlib maps and interactive Folium web maps for flood screening."
      ],
      aiPrompt: "In a GeoDataFrame, what is the difference between the geometry column and regular attribute columns, and how do I reproject to an equal-area CRS before calculating polygon square miles?",
      lessons: [
        {
          id: "03-01",
          code: "3.1",
          title: "Introduction to Vector Data (Watersheds, Streams, and Infrastructure)",
          notebook: "03_01_introduction_to_vector_data.ipynb"
        }
      ]
    },
    {
      num: 4,
      slug: "04_raster-data",
      title: "Raster Data Analysis",
      level: "Beginner",
      tags: ["beginner", "new", "spatial"],
      summary: "DEM terrain statistics, slope maps, NLCD land cover clipping, and SCS Curve Numbers.",
      overview: "Work with Digital Elevation Models (DEMs) and National Land Cover Database (NLCD) grids to understand how elevation, slope, and land cover govern surface runoff across a watershed.",
      studyArea: "South Greeley HUC-12 watershed (101900090108)",
      libraries: ["rasterio", "rioxarray", "xarray", "geopandas", "numpy", "matplotlib"],
      outcomes: [
        "Open GeoTIFF elevation and land cover rasters and read resolution, CRS, affine transforms, and NoData values.",
        "Align raster and vector coordinate systems and clip grids cleanly to a watershed boundary.",
        "Derive terrain elevation bands and slope rasters directly from a DEM.",
        "Reclassify NLCD land cover codes into watershed SCS Curve Number values and multi-panel figures."
      ],
      aiPrompt: "In this with rasterio.open(...) block, what does src.read(1) return, what data type is it, and how do I mask NoData pixels before computing elevation statistics?",
      lessons: [
        {
          id: "04-01",
          code: "4.1",
          title: "Raster Data Analysis for H&H Modeling (DEM, Slope, and NLCD)",
          notebook: "Module4_RasterData.ipynb"
        }
      ]
    },
    {
      num: 5,
      slug: "05_stream-data",
      title: "USGS Stream Data Retrieval",
      level: "Beginner",
      tags: ["beginner", "new", "modeling"],
      summary: "Programmatic NWIS retrieval inside a HUC-8 watershed, gauge catalogs, and gap handling.",
      overview: "Replace manual web downloads with automated scripts using the official USGS dataretrieval library. Discover every gauge inside a buffered HUC-8 watershed and inspect both instantaneous and daily flow records.",
      studyArea: "Mississippi River - Twin Cities HUC-8 (07010206) and USGS-05331000 at St. Paul, MN",
      libraries: ["dataretrieval", "geopandas", "contextily", "folium", "pandas", "requests"],
      outcomes: [
        "Understand USGS NWIS architecture, parameter codes, and instantaneous versus daily values.",
        "Select a HUC-8 polygon and buffer it to discover active nearby USGS stream gauges.",
        "Rank gauges by centroid distance and query the USGS series catalog before downloading.",
        "Fill short gaps in instantaneous records transparently and export tidy gauge catalogs in CSV and JSON."
      ],
      aiPrompt: "How would I rank these discovered USGS gauges by drainage area and filter to gauges between 1,000 and 10,000 square miles?",
      lessons: [
        {
          id: "05-01",
          code: "5.1",
          title: "USGS Data Retrieval (Gauge Discovery, Calibration Series, and Basemaps)",
          notebook: "Module5_USGSDataRetrieval.ipynb"
        }
      ]
    },
    {
      num: 6,
      slug: "06_precip-data",
      title: "Precipitation Frequency Analysis",
      level: "Beginner",
      tags: ["beginner", "new", "modeling"],
      summary: "NOAA Atlas 14 API queries, MSE 6 & SCS Type II temporal distributions, and HEC-HMS hyetographs.",
      overview: "Automate NOAA Atlas 14 depth queries, apply regional temporal distributions such as MSE 6 and SCS Type II, batch-generate multiple AEP design storms (10-year through 500-year), and export files ready for HEC-HMS and HEC-RAS.",
      studyArea: "NOAA Atlas 14 point precipitation frequency coordinates",
      libraries: ["pandas", "numpy", "matplotlib", "requests"],
      outcomes: [
        "Retrieve NOAA Atlas 14 precipitation frequency tables through Python HTTP calls and handle API timeouts cleanly.",
        "Work comfortably with AEP, return periods, storm duration, and depth-duration tables.",
        "Apply custom MSE 6 and SCS Type II temporal distributions at any simulation time step.",
        "Batch-process multiple return periods into comparative hyetograph plots and HEC-HMS input tables."
      ],
      aiPrompt: "Show how to loop over the 10-, 25-, 50-, 100-, and 500-year Atlas 14 depths and export each incremental hyetograph column formatted for HEC-HMS.",
      lessons: [
        {
          id: "06-01",
          code: "6.1",
          title: "Precipitation Frequency Analysis with NOAA Atlas 14 (Design Storms for HEC-HMS)",
          notebook: "Module6_PrecipitationData.ipynb"
        }
      ]
    },
    {
      num: 7,
      slug: "07_soil-data",
      title: "Soil Data for H&H Modeling",
      level: "Intermediate",
      tags: ["intermediate", "spatial", "modeling"],
      summary: "NRCS SSURGO Soil Data Access SQL API vs. Planetary Computer gridded gNATSGO.",
      overview: "Compare two official NRCS soil workflows over the same HUC-12 watershed by querying SSURGO polygons and horizon tables via Soil Data Access SQL requests, then clipping cloud-hosted gNATSGO GeoTIFFs via Planetary Computer STAC.",
      studyArea: "South Greeley HUC-12 watershed (101900090108, Wyoming)",
      libraries: ["geopandas", "rasterio", "pystac", "planetary_computer", "pandas", "requests"],
      outcomes: [
        "Trace how map units (mukey), components (cokey), and horizons (chkey) structure NRCS soil databases.",
        "Submit SQL POST queries to the Soil Data Access API to compute depth-weighted and component-weighted Ksat.",
        "Clip cloud-hosted gNATSGO GeoTIFFs via Planetary Computer and join mukey grids to attribute tables.",
        "Summarize Hydrologic Soil Groups (keeping dual classes like C/D explicit) and 0 to 100 cm available water storage."
      ],
      aiPrompt: "Explain why averaging a mukey raster grid directly is meaningless, while area-weighted averaging of an available-water-storage raster is valid when checked for NoData coverage.",
      lessons: [
        {
          id: "07-01",
          code: "7.1",
          title: "NRCS SSURGO (Soil Data Access API, Ksat, and Hydrologic Soil Groups)",
          notebook: "07_01_soil_data_ssurgo.ipynb"
        },
        {
          id: "07-02",
          code: "7.2",
          title: "Gridded gNATSGO (Planetary Computer STAC, Cloud GeoTIFFs, and AWS Summaries)",
          notebook: "07_02_soil_data_gnatsgo.ipynb"
        }
      ]
    },
    {
      num: 8,
      slug: "08_landuse-data",
      title: "Land Cover & Impervious Surface",
      level: "Intermediate",
      tags: ["intermediate", "spatial", "modeling"],
      summary: "Annual NLCD Collection 1.2 land cover, fractional imperviousness, and 2001 to 2025 change.",
      overview: "Retrieve free Annual NLCD rasters directly from anonymous USGS Web Coverage Services without an API key. Separate categorical land cover classes from continuous fractional imperviousness (0 to 100%) and track watershed urbanization from 2001 to 2025.",
      studyArea: "South Greeley HUC-12 watershed (101900090108), comparing 2001 vs. 2025",
      libraries: ["rasterio", "geopandas", "numpy", "pandas", "requests", "matplotlib"],
      outcomes: [
        "Separate categorical Annual NLCD Land Cover and Impervious Descriptor rasters from continuous Fractional Impervious Surface.",
        "Request watershed GeoTIFFs from anonymous USGS WCS endpoints and confirm valid raster payloads.",
        "Audit CRS, resolution, affine transforms, valid pixel area, and NoData values before computing watershed statistics.",
        "Quantify watershed-average percent imperviousness, equivalent impervious area, and 2001 to 2025 urbanization shifts."
      ],
      aiPrompt: "Explain how to weight Annual NLCD Impervious Descriptor classes by fractional impervious area so small scattered roads count proportionally toward total basin imperviousness.",
      lessons: [
        {
          id: "08-01",
          code: "8.1",
          title: "Annual NLCD Land Cover & Fractional Impervious Surface (2001 vs. 2025)",
          notebook: "08_01_land_cover_impervious.ipynb"
        }
      ]
    },
    {
      num: 9,
      slug: "09_naip-imagery",
      title: "NAIP Aerial Imagery & Classification",
      level: "Intermediate / Advanced",
      tags: ["intermediate", "advanced", "spatial"],
      summary: "High-resolution 0.6 m NAIP via STAC, 2012 vs. 2022 change checks, and Random Forest land cover.",
      overview: "Find, inspect, compare, and classify 0.6 to 1.0 m aircraft imagery from USDA NAIP through Microsoft Planetary Computer. Progress from bounded COG window reads and multi-date alignment to Random Forest land cover screening and full-watershed STAC mosaics.",
      studyArea: "South Greeley HUC-12 teaching AOI (community college, ponds, urbanizing lots, rangeland)",
      libraries: ["pystac", "planetary_computer", "rasterio", "geopandas", "sklearn", "numpy"],
      outcomes: [
        "Distinguish STAC intersection from full AOI coverage and run bounded Cloud Optimized GeoTIFF window reads.",
        "Compare 2012 (1.0 m) and 2022 (0.6 m) acquisitions on one verified common grid using true-color and CIR composites.",
        "Train a CPU Random Forest classifier over four visual classes and inspect validation points to avoid data leakage.",
        "Build a watershed-wide mosaic using raw HTTP pagination, temporary SAS tokens, and HTTP 429 retry logic (optional lesson)."
      ],
      aiPrompt: "Compare these two NAIP crops (June 2012 at 1.0 m vs. June 2022 at 0.6 m). Why should both be resampled to one aligned grid before interpreting visual NDVI differences?",
      lessons: [
        {
          id: "09-01",
          code: "9.1",
          title: "Find, Download, and Inspect NAIP Aerial Imagery (STAC Coverage & COG Windows)",
          notebook: "09_01_find_download_naip.ipynb"
        },
        {
          id: "09-02",
          code: "9.2",
          title: "Visualize and Compare NAIP Acquisitions (2012 vs. 2022 True Color, CIR & NDVI)",
          notebook: "09_02_visualize_compare_naip.ipynb"
        },
        {
          id: "09-03",
          code: "9.3",
          title: "Simple NAIP Land Cover Classification (Random Forest, Validation & Leakage Debugging)",
          notebook: "09_03_classify_naip_landcover.ipynb"
        },
        {
          id: "09-04",
          code: "9.4",
          title: "Optional Advanced: NAIP Mosaic for a Whole Watershed via Raw STAC Services",
          notebook: "09_04_advanced_watershed_mosaic.ipynb"
        }
      ]
    },
    {
      num: 10,
      slug: "10_snow-data",
      title: "Snow Data (UA 800 m & SNODAS 1 km)",
      level: "Intermediate",
      tags: ["intermediate", "modeling"],
      summary: "NetCDF & big-endian SNODAS downloads, EPSG:5070 volume, snowmelt runoff, and cross-comparison.",
      overview: "Automate live snow data retrieval from the University of Arizona (800 m Daily SWE/Depth NetCDFs) and NOAA/NSIDC SNODAS (1 km raw big-endian tar archives), resolve float32 coordinate drift and the Oct 1, 2013 grid shift, quantify WY2023 snow water volume across 12 HUC-8 subbasins, and cross-check SNODAS minus UA.",
      studyArea: "Minnesota River Basin HUC 4 (0702, 44,050.3 km²) and 12 HUC-8 subbasins, WY2023 (196 days)",
      libraries: ["xarray", "netCDF4", "rasterio", "geopandas", "pyproj", "numpy", "pandas"],
      outcomes: [
        "Download UA 800 m NetCDFs with release-tier priority (stable > provisional > early) and float64 full-span spacing.",
        "Stream and decode SNODAS big-endian int16 (>i2) binary grids and .txt headers directly in pure Python without osgeo.gdal.",
        "Reproject onto equal-area EPSG:5070 (800 m and 1,000 m), mask lake NoData cleanly, and convert SWE to volume (km³ and kAF).",
        "Handle SNODAS product 1044 (-9999 snow-free land -> 0.0 mm/d), cumulative melt runoff, and spatial SNODAS minus UA comparisons."
      ],
      aiPrompt: "In a CONUS UA 800 m NetCDF file where lon is stored as float32, why does computing spacing across the full span in float64 match GDAL while lon[1] - lon[0] drifts 1 column east at Minnesota?",
      lessons: [
        {
          id: "10-01",
          code: "10.1",
          title: "Downloading and Preparing Snow Data (USGS WBD, UA NetCDFs & SNODAS Tarballs)",
          notebook: "10_01_downloading_snow_data.ipynb"
        },
        {
          id: "10-02",
          code: "10.2",
          title: "University of Arizona 800 m Snow Analysis, Equal-Area Reprojection & Mapping",
          notebook: "10_02_ua_snow_analysis_mapping.ipynb"
        },
        {
          id: "10-03",
          code: "10.3",
          title: "SNODAS 1 km Grid Reconciliation, Melt Runoff (1044) & UA Cross-Comparison",
          notebook: "10_03_snodas_snow_analysis_mapping.ipynb"
        }
      ]
    }
  ],

  codeTabs: [
    {
      id: "hydrograph",
      tabLabel: "Streamflow Hydrograph",
      moduleRef: "Module 2 · Time Series",
      heading: "From manual CSV columns to one-line monthly peaks and unit conversion",
      excelHabit: "In a spreadsheet, engineers highlight thousands of rows to separate years, run MAXIFS formulas by hand, and copy unit factors down helper columns.",
      pythonPattern: "With pandas datetime indexing, resampling a multi-decade USGS discharge table into water-year statistics, metric units (cms), and 10-day rolling flows takes four readable lines.",
      notebookUrl: "https://colab.research.google.com/github/mohsennasab/python-fundamentals-hh/blob/main/notebooks/02_timeseries/02_01_TimeSeries_Basics.ipynb",
      code: `# Module 2: Monthly peaks and rolling flow in cfs and cms
import pandas as pd

df = pd.read_csv(
    "usgs_st_paul_daily.csv",
    parse_dates=["datetime"],
    index_col="datetime",
)
# Convert cubic feet per second (cfs) to cubic meters per second
df["flow_cms"] = df["flow_cfs"] * 0.0283168

# Resample daily flow into monthly peaks and 7-day rolling averages
monthly_peak_cfs = df["flow_cfs"].resample("ME").max()
rolling_7day_cfs = df["flow_cfs"].rolling(window=7, min_periods=5).mean()`
    },
    {
      id: "usgs",
      tabLabel: "USGS Gauge Retrieval",
      moduleRef: "Module 5 · Stream Data",
      heading: "Discover and pull every active stream gauge inside a watershed polygon",
      excelHabit: "Checking NWIS maps by hand means clicking station pins one by one, noting site numbers in a list, and exporting separate tab-delimited text files.",
      pythonPattern: "Combine geopandas spatial filtering with USGS dataretrieval to inspect the station series catalog first and fetch clean discharge and stage DataFrames.",
      notebookUrl: "https://colab.research.google.com/github/mohsennasab/python-fundamentals-hh/blob/main/notebooks/05_stream-data/Module5_USGSDataRetrieval.ipynb",
      code: `# Module 5: Filter HUC-8 gauges and retrieve USGS daily streamflow (05331000)
import geopandas as gpd
import dataretrieval.nwis as nwis

huc8 = gpd.read_file("huc8_twin_cities.shp").to_crs("EPSG:5070")
bbox_wgs84 = tuple(huc8.buffer(5000).to_crs("EPSG:4326").total_bounds)

# Pull daily discharge (parameter 00060) for Mississippi River at St. Paul, MN
q_df, meta = nwis.get_record(
    sites="05331000", service="dv", parameterCd="00060",
    start="2023-01-01", end="2023-12-31"
)`
    },
    {
      id: "atlas14",
      tabLabel: "Atlas 14 Design Storm",
      moduleRef: "Module 6 · Precipitation",
      heading: "Turn NOAA Atlas 14 frequency depths into HEC-HMS design hyetographs",
      excelHabit: "Copying 24-hour depths for the 10-, 50-, 100-, and 500-year storms into separate curve tabs leads to formula mix-ups when storm time steps change.",
      pythonPattern: "Compute incremental rainfall hyetographs across all return periods in a single Python loop and export formatted columns directly for HEC-HMS.",
      notebookUrl: "https://colab.research.google.com/github/mohsennasab/python-fundamentals-hh/blob/main/notebooks/06_precip-data/Module6_PrecipitationData.ipynb",
      code: `# Module 6: Apply a temporal cumulative curve across multiple AEP design depths
import numpy as np
import pandas as pd

atlas14_24h_in = {"10yr": 4.21, "50yr": 5.89, "100yr": 6.72, "500yr": 8.95}
cum_fraction = np.array([0.00, 0.08, 0.22, 0.58, 0.86, 0.95, 1.00])
inc_fraction = np.diff(cum_fraction)  # Incremental fraction per time step

# Generate incremental rainfall (inches) for every storm return period at once
hyetographs = pd.DataFrame({
    event: total_in * inc_fraction
    for event, total_in in atlas14_24h_in.items()
})`
    },
    {
      id: "snow",
      tabLabel: "Snow Water Volume",
      moduleRef: "Module 10 · Snow Data",
      heading: "Convert gridded SWE rasters on equal-area projections into basin storage (kAF)",
      excelHabit: "Averaging degree-based (lat/lon) pixels directly skews watershed water volume by about 5% across northern basins because pixel width shrinks toward the poles.",
      pythonPattern: "Mask NoData (-999) before bilinear reprojection onto equal-area EPSG:5070 (800 m = 0.64 km²/cell), include 0 mm bare ground, and convert depth directly into thousand acre-feet.",
      notebookUrl: "https://colab.research.google.com/github/mohsennasab/python-fundamentals-hh/blob/main/notebooks/10_snow-data/10_02_ua_snow_analysis_mapping.ipynb",
      code: `# Module 10: Convert EPSG:5070 SWE (mm) to basin storage (km3, kAF)
import numpy as np
import rasterio

with rasterio.open("ua_wy2023_peak_swe_5070_800m.tif") as src:
    swe_mm = src.read(1)
    # Keep 0 mm bare-ground cells in the mean, exclude -9999 borders
    valid = swe_mm[swe_mm != src.nodata]

mean_swe_mm = float(np.mean(valid))
# Pixel area on snapped EPSG:5070 grid (800 m x 800 m = 640,000 m2)
cell_area_m2 = abs(src.transform.a * src.transform.e)
volume_km3 = (mean_swe_mm / 1000.0) * (valid.size * cell_area_m2) / 1e9
volume_kaf = volume_km3 * 810.7132`
    }
  ],

  tools: [
    { name: "HyRiver", url: "https://github.com/hyriver/HyRiver", category: "Data Access", desc: "Unified Python access to USGS, NHD, 3DEP, NLDAS, Daymet, and NID datasets." },
    { name: "dataretrieval-python", url: "https://github.com/DOI-USGS/dataretrieval-python", category: "Data Access", desc: "Official USGS NWIS data retrieval library featured in Module 5." },
    { name: "noaa_coops", url: "https://github.com/GClunies/noaa_coops", category: "Data Access", desc: "NOAA CO-OPS tides, currents, and coastal water level data retrieval." },
    { name: "pysheds", url: "https://github.com/mdbartos/pysheds", category: "Terrain & GIS", desc: "Watershed delineation, flow accumulation, and stream networks from DEMs." },
    { name: "pyflwdir", url: "https://github.com/Deltares/pyflwdir", category: "Terrain & GIS", desc: "Flow direction, upstream area, and river network analysis from elevation grids." },
    { name: "xarray", url: "https://github.com/pydata/xarray", category: "Terrain & GIS", desc: "Labeled multidimensional arrays for NetCDF, GRIB, and gridded climate or snow data." },
    { name: "SPOTPY", url: "https://github.com/thouska/spotpy", category: "Modeling & Calibration", desc: "Calibration, sensitivity analysis, and uncertainty estimation for hydrologic models." },
    { name: "hydroeval", url: "https://github.com/ThibHlln/hydroeval", category: "Modeling & Calibration", desc: "NSE, KGE, PBIAS, and model goodness-of-fit metrics in one library." },
    { name: "Pastas", url: "https://github.com/pastas/pastas", category: "Modeling & Calibration", desc: "Time series analysis of groundwater levels using recharge stress models." },
    { name: "RAS Commander", url: "https://github.com/gpt-cmdr/ras-commander", category: "Modeling & Calibration", desc: "Python automation and run orchestration for HEC-RAS hydraulic models." },
    { name: "xclim", url: "https://github.com/Ouranosinc/xclim", category: "Climate & Plotting", desc: "Climate indicators and indices for precipitation, temperature, and droughts." },
    { name: "hvplot", url: "https://github.com/holoviz/hvplot", category: "Climate & Plotting", desc: "Interactive hydrograph and spatial maps built over pandas and xarray." }
  ],

  quotes: [
    {
      text: "As a complete beginner to Python/Google Colab, the course was approachable and could be completed successfully.",
      focus: "Approachable setup"
    },
    {
      text: "This is an excellent course for beginners, particularly by highlighting where and how AI can assist.",
      focus: "AI-assisted workflow"
    },
    {
      text: "The progression through each part, lesson, and module is very clear. The use of structured analogies and AI assistant subheadings is effective.",
      focus: "Clear progression"
    },
    {
      text: "This is a strong, discipline-focused introduction to scripting and automation. It also demonstrates practical examples for each data type commonly used.",
      focus: "Practical H&H data"
    },
    {
      text: "Step-by-step examples followed by small exercises are very helpful. The streamflow retrieval exercise is especially useful.",
      focus: "Hands-on practice"
    }
  ]
};
