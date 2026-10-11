"""Shared helpers for packaging maps for the web dashboards.

Both export steps (08_export_web.py for rainfall, snow_04_export_web.py for
snow) put their maps on the same square grid in the region's projected CRS,
store one byte per cell, and describe outlines and labels in grid coordinates.
"""

from __future__ import annotations

import gzip
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from affine import Affine
from rasterio import features
from rasterio.warp import Resampling, reproject
from shapely.geometry import Point

from rainlib import Config, load_counties, region_polygon

MM_PER_INCH = 25.4
# Dark olive background shared by the dashboard and the still images.
BACKGROUND = "#1a1f12"
TEXT_DIM = "#c1c8a9"
TEXT_FAINT = "#939c78"


def encode(inches: np.ndarray, constant: float) -> np.ndarray:
    """Pack depths into bytes as the square root of inches times a constant.

    That keeps fine steps for small depths and still reaches the largest ones.
    """
    return np.clip(np.rint(np.sqrt(np.clip(inches, 0, None)) * constant), 0, 255).astype(np.uint8)


def write_gz(path: Path, array: np.ndarray) -> int:
    payload = gzip.compress(array.tobytes(), compresslevel=9, mtime=0)
    path.write_bytes(payload)
    return len(payload)


def ring_path(coords: np.ndarray) -> str:
    points = np.round(coords, 2)
    head = f"M{points[0, 0]:g},{points[0, 1]:g}"
    body = "".join(f"L{x:g},{y:g}" for x, y in points[1:])
    return head + body


def geometry_path(geometry, close: bool) -> str:
    parts = []
    for geom in getattr(geometry, "geoms", [geometry]):
        if geom.geom_type == "Polygon":
            for ring in [geom.exterior, *geom.interiors]:
                parts.append(ring_path(np.asarray(ring.coords)) + "Z")
        elif geom.geom_type in ("LineString", "LinearRing"):
            parts.append(ring_path(np.asarray(geom.coords)) + ("Z" if close else ""))
    return "".join(parts)


class WebGrid:
    """The target grid of the web maps, with the outlines that go on top of it."""

    def __init__(self, cfg: Config) -> None:
        web = cfg.raw["web"]
        self.cfg = cfg
        self.cell_m = float(web.get("cell_km", 2.0)) * 1000
        margin_m = float(web.get("margin_km", 14)) * 1000
        cell_m = self.cell_m

        # Square cells in the projected CRS, north at the top.
        self.region = gpd.GeoSeries([region_polygon(cfg)], crs="EPSG:4326").to_crs(cfg.projected_crs)
        minx, miny, maxx, maxy = self.region.total_bounds
        self.minx = float(np.floor((minx - margin_m) / cell_m) * cell_m)
        self.maxy = float(np.ceil((maxy + margin_m) / cell_m) * cell_m)
        self.width = int(np.ceil((maxx + margin_m - self.minx) / cell_m))
        self.height = int(np.ceil((self.maxy - (miny - margin_m)) / cell_m))
        self.transform = Affine(cell_m, 0, self.minx, 0, -cell_m, self.maxy)

        self.inside = features.rasterize(
            [(self.region.iloc[0], 1)], out_shape=(self.height, self.width), transform=self.transform, fill=0, dtype="uint8"
        )

        # Counties: a number per cell for the hover readout, and the shared borders as lines.
        counties = load_counties(cfg)
        self.county_names: list[str] = []
        county_grid = np.zeros((self.height, self.width), dtype=np.uint8)
        self.mesh = None
        self.county_mesh_path = ""
        if counties is not None:
            counties = counties.sort_values("NAME").reset_index(drop=True).to_crs(cfg.projected_crs)
            self.county_names = counties["NAME"].tolist()
            county_grid = features.rasterize(
                [(geom, index + 1) for index, geom in enumerate(counties.geometry)],
                out_shape=(self.height, self.width),
                transform=self.transform,
                fill=0,
                dtype="uint8",
            )
            mesh = shapely.line_merge(shapely.unary_union([geom.boundary for geom in counties.geometry]))
            outer = self.region.iloc[0].boundary.buffer(600)
            self.mesh = self.to_grid(mesh.difference(outer).simplify(350))
            self.county_mesh_path = geometry_path(self.mesh, close=False)
        self.county_grid = np.where(self.inside == 1, np.where(county_grid == 0, 255, county_grid), 0).astype(np.uint8)

        outline = self.region.iloc[0].simplify(250)
        outline = shapely.MultiPolygon([part for part in getattr(outline, "geoms", [outline]) if part.area > 3e6])
        self.outline = self.to_grid(outline)
        self.outline_path = geometry_path(self.outline, close=True)

        self.cities = []
        for city in cfg.raw.get("cities", []):
            if not city.get("label"):
                continue
            gx, gy = self.point(city["lon"], city["lat"])
            self.cities.append({"name": city["name"], "x": gx, "y": gy, "anchor": city.get("anchor", "start")})

    def to_grid(self, geometry):
        """Move a projected geometry into grid coordinates, in cells from the top left."""
        return shapely.transform(
            geometry,
            lambda xy: np.column_stack([(xy[:, 0] - self.minx) / self.cell_m, (self.maxy - xy[:, 1]) / self.cell_m]),
        )

    def point(self, lon: float, lat: float) -> tuple[float, float]:
        """Grid coordinates of a longitude and latitude."""
        projected = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(self.cfg.projected_crs)
        gx, gy = self.to_grid(projected.iloc[0]).coords[0]
        return round(gx, 2), round(gy, 2)

    def resampler(self, lat: np.ndarray, lon: np.ndarray, nodata: float | None = None):
        """Return a function that area-averages (bands, rows, cols) stacks onto the grid.

        lat and lon are the cell centers of the source, both ascending.
        """
        dlat = float(lat[1] - lat[0])
        dlon = float(lon[1] - lon[0])
        src_transform = Affine(dlon, 0, lon[0] - dlon / 2, 0, -dlat, lat[-1] + dlat / 2)

        def resample(stack: np.ndarray) -> np.ndarray:
            out = np.zeros((stack.shape[0], self.height, self.width), dtype=np.float32)
            reproject(
                source=np.ascontiguousarray(stack[:, ::-1, :]),
                destination=out,
                src_transform=src_transform,
                src_crs="EPSG:4326",
                dst_transform=self.transform,
                dst_crs=self.cfg.projected_crs,
                resampling=Resampling.average,
                src_nodata=nodata,
                dst_nodata=0.0 if nodata is not None else None,
            )
            return out

        return resample

    def layout(self, codes: dict) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "cell_km": self.cell_m / 1000,
            "crs": self.cfg.projected_crs,
            "origin_x": self.minx,
            "origin_y": self.maxy,
            **codes,
        }


def palette_block(name: str, reverse: bool = False) -> tuple[dict, object]:
    """Return the palette description for the JSON file and the matplotlib colormap."""
    import rang

    ramp = rang.cmap(name)
    stops = list(rang.rang(name))
    if reverse:
        ramp = ramp.reversed()
        stops = stops[::-1]
    lut = (np.asarray([ramp(i / 255)[:3] for i in range(256)]) * 255).round().astype(int)
    return {"name": name, "reversed": reverse, "stops": stops, "lut": lut.ravel().tolist()}, ramp


def make_poster(path, grid: WebGrid, field_in, ramp, top_in, ticks, title, subtitle, legend, credit, linear=False) -> None:
    """Save a still map, for readers without JavaScript and for sharing.

    Colors follow the square root of the depth unless linear is set.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.patheffects as effects
    import matplotlib.pyplot as plt
    from matplotlib.colors import PowerNorm

    plt.rcParams["font.family"] = ["Arial", "DejaVu Sans"]
    fig = plt.figure(figsize=(7, 8.6), dpi=200, facecolor=BACKGROUND)
    ax = fig.add_axes([0.03, 0.12, 0.94, 0.76])
    ax.set_facecolor(BACKGROUND)
    field = np.where(grid.inside == 1, field_in, np.nan)
    image = ax.imshow(field, cmap=ramp, norm=PowerNorm(1.0 if linear else 0.5, vmin=0, vmax=top_in), interpolation="bilinear")
    if grid.mesh is not None:
        for line in getattr(grid.mesh, "geoms", [grid.mesh]):
            xs, ys = line.xy
            ax.plot(xs, ys, color="white", linewidth=0.3, alpha=0.22)
    for part in getattr(grid.outline, "geoms", [grid.outline]):
        xs, ys = part.exterior.xy
        ax.plot(xs, ys, color="white", linewidth=0.9, alpha=0.85)
    for city in grid.cities:
        ax.plot(city["x"], city["y"], "o", color="white", markersize=2.6, markeredgecolor="black", markeredgewidth=0.4)
        right = city["anchor"] != "end"
        ax.annotate(
            city["name"], (city["x"], city["y"]), xytext=(4 if right else -4, 0), textcoords="offset points",
            ha="left" if right else "right", va="center", color="white", fontsize=7,
            path_effects=[effects.withStroke(linewidth=1.6, foreground="black")],
        )
    ax.set_xlim(0, grid.width)
    ax.set_ylim(grid.height, 0)
    ax.set_axis_off()

    fig.text(0.05, 0.945, title, color="white", fontsize=15, fontweight="bold")
    fig.text(0.05, 0.908, subtitle, color=TEXT_DIM, fontsize=10)
    bar = fig.add_axes([0.05, 0.07, 0.9, 0.018])
    colorbar = fig.colorbar(image, cax=bar, orientation="horizontal", ticks=ticks)
    colorbar.ax.set_xticklabels([f"{t:g}+" if t >= top_in else f"{t:g}" for t in ticks], color=TEXT_DIM, fontsize=8)
    colorbar.outline.set_visible(False)
    colorbar.ax.tick_params(length=0)
    fig.text(0.05, 0.1, legend, color=TEXT_DIM, fontsize=8)
    fig.text(0.05, 0.022, credit, color=TEXT_FAINT, fontsize=7)
    fig.savefig(path, facecolor=BACKGROUND)
    plt.close(fig)
