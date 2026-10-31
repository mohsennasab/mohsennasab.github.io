# Rochester 1978 flood

This folder holds the workflow behind the blog post
[Rochester's Flood of July 1978, Read From One Sheet of Paper](https://hydromohsen.com/blog/rochester-flood-of-1978/).
It turns USGS Plate 1 of Open-File Report 79-1583 into web assets, and gathers
the rainfall, gauge and river records around the flood.

Large files stay outside the repository, in `G:/Python Package/Rochester1978`.
The paths are set at the top of each script.

## Requirements

Python 3.11 or newer with:

```
pip install numpy pandas xarray netCDF4 geopandas shapely pyproj opencv-python-headless scikit-image pymupdf pillow
```

## Downloads

Put these in `raw/` in the work folder. No account is needed.

| File | Source |
| --- | --- |
| `plate.pdf` | https://pubs.usgs.gov/of/1979/1583/plate-1.pdf |
| `r79_1166.pdf` | https://pubs.usgs.gov/of/1979/1166/report.pdf |
| `ncdd-197806.nc`, `ncdd-197807.nc` | https://www.ncei.noaa.gov/data/nclimgrid-daily/access/grids/1978/ncdd-1978MM-grd-scaled.nc |
| `isd.gz` | https://www.ncei.noaa.gov/pub/data/noaa/1978/726440-14925-1978.gz |
| `hpd/USC*.csv`, `hpd_inv.csv` | https://www.ncei.noaa.gov/data/coop-hourly-precipitation/v2/ |
| `acis_daily.json` | ACIS MultiStnData, bounding box -94.0, 43.4, -90.8, 44.8, June 25 to July 10, 1978, element `pcpn` |
| `p05372995.rdb`, `p05372930.rdb` | https://nwis.waterdata.usgs.gov/nwis/peak?site_no=05372995&agency_cd=USGS&format=rdb |
| `dv_05373000.rdb` | https://waterservices.usgs.gov/nwis/dv/?sites=05373000&parameterCd=00060&startDT=1978-06-25&endDT=1978-07-12&format=rdb |
| `sites2.rdb` | https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=05372995,05372930,05373000&siteOutput=expanded |
| `basin.json`, `flowlines.json` | USGS NLDI, `linked-data/nwissite/USGS-05373000/basin` and `navigation/UT/flowlines?distance=120` |
| `zumbro_huc8.json` | Watershed Boundary Dataset, https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/4, `huc8='07040004'` |
| `zumbro_named.json` | National Hydrography Dataset, https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6, `gnis_name LIKE '%Zumbro River%'` inside the watershed |
| `atlas14.js` | https://hdsc.nws.noaa.gov/cgi-bin/new/cgi_readH5.py?lat=43.904&lon=-92.492&type=pf&data=depth&units=english&series=pds |

`modern/usgs_imagery_2m.jpg` and `modern/meta.json` hold current USGS imagery at
2 m over the plate's area, from the `USGSImageryOnly` service of The National Map.
They are used only to align the mosaic.

County outlines come from the Census file already cached under
`scripts/extreme-rainfall/boundaries/_census/`.

## Run it

```
python 01_plate.py
python 02_data.py
```

| Script | Writes |
| --- | --- |
| `01_plate.py` | `public/blog/rochester-1978/` (plates, 14 photographs, printed stage graph, mosaic tiles) and `plate_digitized.json` in the work folder |
| `02_data.py` | `src/data/rochester-1978.json` |

## What was digitized, and how

Mosaic alignment. Six tick marks printed on the plate give a first fit, and the
fit is good to about 50 m. Edge maps of the mosaic and of current imagery are
then matched in 150 by 150 cell blocks. 35 of 2,735 blocks gave a clear match,
and a plane fitted to their offsets leaves an RMS of about 6 m at those blocks.
Most of them are in the south half of the mosaic, and a photomosaic has local
distortion, so expect larger errors elsewhere.

Storm contours. The thick lines of Figure 1 are separated from the base map by
a threshold and a morphological opening, thinned to one pixel, and joined by
hand across the gaps left by the printed labels. The 6-inch line is a closed
ring and is traced as one. They are placed with the latitude and longitude
marks of the figure, which is good to about a mile.

Stage curve. The curve of Figure 3 is read column by column between the printed
frame lines. The digitized crest is 23.38 ft against the printed 23.36 ft.

Colorized plate. `plate-color.jpg` comes from the author's colorized PNG. A pixel
comparison with the black-and-white PNG shows HSL lightness unchanged to within
0.5 of 255 at every pixel.

## Reading the airport log

`02_data.py` keeps the airport's hourly reports in the JSON file with their
remarks. ISD times are UTC, and an hourly report stamped 02:00 was taken at about
01:53. CDT is UTC minus 5. Table cells for the airport in the post are typed into
the page from the `PCPN` remarks and the `AA1` fields of these rows, because two
hourly reports have no `AA1` value.
