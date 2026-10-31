"""Turn USGS Plate 1 (OFR 79-1583) into web assets.

Reads the plate at its native resolution and writes:
  - the plate and the author's colorized copy at web size
  - the 14 photographs on the plate, one file each
  - the 1978 photomosaic as map tiles, aligned to current USGS imagery
  - the storm contours of Figure 1 as lines in longitude and latitude
  - the river stage curve of Figure 3 as a table, and the printed graph as an image

Settings are at the top. Everything digitized here is a reading of a printed
figure, so the results carry the error of the figure and of this script.

  python 01_plate.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import fitz  # PyMuPDF
import numpy as np
from PIL import Image
from pyproj import Transformer
from skimage.morphology import skeletonize

Image.MAX_IMAGE_PIXELS = None

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent
WORK = Path("G:/Python Package/Rochester1978")
USER = Path("C:/Users/TahmasebiNasabM/Downloads/NewVersion")
PUBLIC = SITE / "public/blog/rochester-1978"
OUT_JSON = WORK / "plate_digitized.json"

NATIVE_W = 9022  # width of the image embedded in plate-1.pdf
VIEW = NATIVE_W / 1100  # boxes below were read on a 1100 px wide copy

# Plate tick marks read from the native image: (x, y, lon, lat). None means the
# tick gives only the other coordinate.
TICKS = [
    (5984, 467, -92.45833, None),
    (4531, 4296, None, 44.04167),
    (6554, 4264, None, 44.04167),
    (348, 8987, None, 44.0),
    (6103, 8905, -92.45833, 44.0),
    (2790, 9998, -92.5, None),
]

# Photographs on the plate: rough box in the 1100 px copy, caption printed on
# the plate, and the tip of its leader line on the mosaic in native pixels
# (None for the three photographs the plate does not tie to a spot).
PHOTOS = {
    "sewage-plant": ((340, 202, 503, 328), "Sewage treatment plant", (5118, 1809)),
    "county-road-22": ((789, 283, 952, 408), "County Road 22", (5291, 2094)),
    "cascade-creek": ((339, 363, 503, 488), "Confluence of South Fork Zumbro River and Cascade Creek", (5488, 4585)),
    "center-street": ((338, 525, 503, 650), "Center Street bridge and railroad bridge", (5952, 6136)),
    "bear-creek": ((338, 685, 503, 810), "Confluence of South Fork Zumbro River and Bear Creek", (6236, 6658)),
    "powerplant": ((888, 446, 1052, 570), "Powerplant", (6027, 5615)),
    "civic-center": ((913, 605, 1077, 730), "Civic Center", (6109, 6385)),
    "milk-plant": ((913, 767, 1077, 893), "Milk processing plant", (5958, 7136)),
    "soldiers-field": ((887, 928, 1051, 1052), "Soldiers Field", (5588, 7433)),
    "broadway-14-52": ((788, 1089, 952, 1214), "Intersection of Broadway Ave. and Highways 14 and 52", (5600, 8233)),
    "apache-mall": ((264, 845, 419, 965), "Apache Mall", (4400, 8307)),
    "second-avenue-ne": ((100, 491, 264, 616), "Second Avenue NE bridge", None),
    "soldiers-field-entrance": ((100, 652, 264, 778), "Entrance to Soldiers Field", None),
    "south-ave-fourth-st": ((63, 845, 227, 965), "South Avenue SE and Fourth Street SE", None),
}

# Figure 1 contour lines. Keys are the component numbers found by
# segmenting the thick lines, in the order they join along one contour.
# Hand-read links bridge the gaps left by the printed labels and by two thin
# stretches, in the pixels of the 1400 px enlargement used to check them.
FIG1_BOX = (int(90 * VIEW), int(285 * VIEW), int(285 * VIEW), int(445 * VIEW))
FIG1_LINES = [
    (3, ["c2", [(415, 412), (438, 397), (468, 378), (510, 367), (560, 360), (640, 360), (720, 361), (800, 365)]]),
    (3, ["c7", [(464, 626), (490, 622), (505, 607)], "c6"]),
    (3, ["c8", [(645, 848), (720, 842)], "c9", "c10"]),
    (4, ["c0"]),
    (5, ["c1", [(476, 438), (458, 450), (440, 455)], "c5", [(372, 587), (410, 574), (450, 565), (478, 558), (500, 546)]]),
    (6, ["c3"]),
    (7, ["c4"]),
]
# Figure 1 georeference, in the 1400 px enlargement: x at two meridians, y at two parallels.
FIG1_X = {-93.0: 103.0, -92.0: 687.5}
FIG1_Y = {44.0: 492.0, 43.5: 900.0}

# Figure 3 frame in native pixels, read from the printed tick marks. The time
# axis runs from midnight at the start of July 5 to midnight at the end of July 7.
FIG3 = {"stage0_y": 1667.0, "stage25_y": 523.0, "right_x": 7310.5, "days": 3}
FIG3_CROP = (6290, 450, 7560, 1930)


def plate_gray() -> np.ndarray:
    native = WORK / "plate/native.jpeg"
    if not native.exists():
        doc = fitz.open(WORK / "raw/plate.pdf")
        image = doc.extract_image(doc[0].get_images()[0][0])
        native.parent.mkdir(exist_ok=True)
        native.write_bytes(image["image"])
    return cv2.imread(str(native), cv2.IMREAD_GRAYSCALE)


def fit_affine() -> tuple[np.ndarray, np.ndarray]:
    lon_rows, lon_vals, lat_rows, lat_vals = [], [], [], []
    for x, y, lon, lat in TICKS:
        if lon is not None:
            lon_rows.append([1, x, y])
            lon_vals.append(lon)
        if lat is not None:
            lat_rows.append([1, x, y])
            lat_vals.append(lat)
    a = np.linalg.lstsq(np.array(lon_rows, float), np.array(lon_vals), rcond=None)[0]
    b = np.linalg.lstsq(np.array(lat_rows, float), np.array(lat_vals), rcond=None)[0]
    return a, b


class Georef:
    """Plate pixels to longitude and latitude, with the shift found against modern imagery."""

    def __init__(self) -> None:
        self.a, self.b = fit_affine()
        self.matrix = np.array([[self.a[1], self.a[2]], [self.b[1], self.b[2]]])
        self.inverse = np.linalg.inv(self.matrix)
        self.fwd = Transformer.from_crs(4326, 3857, always_xy=True)
        self.rev = Transformer.from_crs(3857, 4326, always_xy=True)
        self.grid = json.loads((WORK / "modern/meta.json").read_text())
        # Offsets of the 2 m warp against modern imagery, in 2 m cells, as a
        # plane in the warp's coordinates. Fitted by block matching, see fit_shift().
        shift = json.loads((WORK / "plate/shift.json").read_text()) if (WORK / "plate/shift.json").exists() else None
        self.shift = shift

    def offset(self, gx, gy):
        if not self.shift:
            return 0.0 * gx, 0.0 * gy
        u = (gx - 3200) / 3000
        v = (gy - 4000) / 3000
        cx, cy = self.shift["cx"], self.shift["cy"]
        return cx[0] + cx[1] * u + cx[2] * v, cy[0] + cy[1] * u + cy[2] * v

    def to_plate(self, lon, lat):
        """Longitude and latitude (arrays) to plate pixels, applying the shift."""
        x, y = self.fwd.transform(lon, lat)
        g = self.grid
        gx = (x - g["x0"]) / g["res"]
        gy = (g["y1"] - y) / g["res"]
        dx, dy = self.offset(gx, gy)
        lon0, lat0 = self.rev.transform(g["x0"] + (gx - dx) * g["res"], g["y1"] - (gy - dy) * g["res"])
        d = np.stack([np.ravel(lon0) - self.a[0], np.ravel(lat0) - self.b[0]])
        p = self.inverse @ d
        return p[0].reshape(np.shape(lon)), p[1].reshape(np.shape(lon))

    def to_lonlat(self, px, py):
        """Plate pixels to longitude and latitude, applying the shift."""
        lon = self.a[0] + self.a[1] * px + self.a[2] * py
        lat = self.b[0] + self.b[1] * px + self.b[2] * py
        x, y = self.fwd.transform(lon, lat)
        g = self.grid
        gx = (x - g["x0"]) / g["res"]
        gy = (g["y1"] - y) / g["res"]
        dx, dy = self.offset(gx, gy)
        return self.rev.transform(g["x0"] + (gx + dx) * g["res"], g["y1"] - (gy + dy) * g["res"])


def fit_shift(plate: np.ndarray) -> dict:
    """Match edges of the warped mosaic to modern imagery and fit a plane to the offsets."""
    (WORK / "plate/shift.json").unlink(missing_ok=True)
    geo = Georef()
    g = geo.grid
    xs = g["x0"] + (np.arange(g["W"]) + 0.5) * g["res"]
    ys = g["y1"] - (np.arange(g["H"]) + 0.5) * g["res"]
    X, Y = np.meshgrid(xs, ys)
    lon, lat = geo.rev.transform(X, Y)
    px, py = geo.to_plate(lon, lat)
    warp = cv2.remap(cv2.GaussianBlur(plate, (0, 0), 0.9), px.astype(np.float32), py.astype(np.float32),
                     cv2.INTER_LINEAR, borderValue=255).astype(np.float32)
    modern = cv2.imread(str(WORK / "modern/usgs_imagery_2m.jpg"), cv2.IMREAD_GRAYSCALE).astype(np.float32)

    def edges(a):
        a = cv2.GaussianBlur(a, (0, 0), 2.0)
        return cv2.magnitude(cv2.Sobel(a, cv2.CV_32F, 1, 0), cv2.Sobel(a, cv2.CV_32F, 0, 1))

    valid = cv2.erode((warp < 235).astype(np.uint8), np.ones((41, 41), np.uint8)) > 0
    ew, em = edges(warp), edges(modern)
    size, search = 150, 60
    found = []
    for y in range(size, warp.shape[0] - size - search, 110):
        for x in range(size, warp.shape[1] - size - search, 110):
            template = ew[y:y + size, x:x + size]
            if not valid[y:y + size, x:x + size].all() or template.std() < 6:
                continue
            score = cv2.matchTemplate(em[y - search:y + size + search, x - search:x + size + search], template,
                                      cv2.TM_CCOEFF_NORMED)
            _, best, _, loc = cv2.minMaxLoc(score)
            second = score.copy()
            cv2.circle(second, loc, 15, -1, -1)
            _, runner_up, _, _ = cv2.minMaxLoc(second)
            found.append((x + size / 2, y + size / 2, loc[0] - search, loc[1] - search, best, best / max(runner_up, 1e-3)))
    p = np.array(found)
    good = p[(p[:, 4] > 0.32) & (p[:, 5] > 1.25)]

    def design(rows):
        return np.stack([np.ones(len(rows)), (rows[:, 0] - 3200) / 3000, (rows[:, 1] - 4000) / 3000], 1)

    keep = good
    for _ in range(6):
        cx = np.linalg.lstsq(design(keep), keep[:, 2], rcond=None)[0]
        cy = np.linalg.lstsq(design(keep), keep[:, 3], rcond=None)[0]
        r = np.hypot(design(good) @ cx - good[:, 2], design(good) @ cy - good[:, 3])
        keep = good[r < max(6, 2.5 * np.median(r))]
    r = np.hypot(design(keep) @ cx - keep[:, 2], design(keep) @ cy - keep[:, 3])
    result = {
        "cx": cx.tolist(),
        "cy": cy.tolist(),
        "blocks_tested": int(len(p)),
        "blocks_accepted": int(len(good)),
        "blocks_used": int(len(keep)),
        "median_offset_m": [float(np.median(keep[:, 2]) * g["res"]), float(np.median(keep[:, 3]) * g["res"])],
        "rms_m": float(np.sqrt((r**2).mean()) * g["res"]),
    }
    (WORK / "plate/shift.json").write_text(json.dumps(result, indent=1))
    return result


def mosaic_mask(plate: np.ndarray) -> np.ndarray:
    """The photomosaic as one region, without the inset photographs and leader lines."""
    small = cv2.resize(plate, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    dark = (small < 200).astype(np.uint8)
    # Opening drops the thin leader lines that tie the insets to the mosaic.
    opened = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=4)
    # The mosaic is the component that holds the center of the city.
    seed = labels[int(6000 / 4), int(5400 / 4)]
    mask = (labels == seed).astype(np.uint8) * 255
    # Fill the bright patches inside it (quarries, parking lots) and smooth nicks in the edge.
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, 255, -1)
    filled = cv2.morphologyEx(filled, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    filled = cv2.erode(filled, np.ones((3, 3), np.uint8))
    return cv2.resize(filled, (plate.shape[1], plate.shape[0]), interpolation=cv2.INTER_LINEAR)


def write_tiles(plate: np.ndarray, mask: np.ndarray, geo: Georef, zooms=(12, 13, 14, 15, 16, 17)) -> dict:
    root = PUBLIC / "mosaic"
    origin = 20037508.342789244
    # Bounds of the mosaic.
    ys, xs = np.nonzero(mask[::8, ::8])
    px = xs.astype(np.float64) * 8
    py = ys.astype(np.float64) * 8
    lon, lat = geo.to_lonlat(px, py)
    bounds = [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]
    x0, y0 = geo.fwd.transform(bounds[0], bounds[1])
    x1, y1 = geo.fwd.transform(bounds[2], bounds[3])
    total = 0
    count = 0
    for z in zooms:
        span = 2 * origin / 2**z
        scale = span / 256 / 0.72  # about one ground meter per plate pixel
        source = cv2.GaussianBlur(plate, (0, 0), max(0.5, scale * 0.45))
        for tx in range(int((x0 + origin) // span), int((x1 + origin) // span) + 1):
            for ty in range(int((origin - y1) // span), int((origin - y0) // span) + 1):
                gx = -origin + tx * span + (np.arange(256) + 0.5) * span / 256
                gy = origin - ty * span - (np.arange(256) + 0.5) * span / 256
                X, Y = np.meshgrid(gx, gy)
                tile_lon, tile_lat = geo.rev.transform(X, Y)
                mx, my = geo.to_plate(tile_lon, tile_lat)
                mx32, my32 = mx.astype(np.float32), my.astype(np.float32)
                alpha = cv2.remap(mask, mx32, my32, cv2.INTER_LINEAR, borderValue=0)
                if alpha.max() < 16:
                    continue
                value = cv2.remap(source, mx32, my32, cv2.INTER_LINEAR, borderValue=255)
                folder = root / str(z) / str(tx)
                folder.mkdir(parents=True, exist_ok=True)
                target = folder / f"{ty}.webp"
                Image.merge("LA", (Image.fromarray(value), Image.fromarray(alpha))).convert("RGBA").save(target, quality=68, method=5)
                total += target.stat().st_size
                count += 1
    print(f"Mosaic tiles: {count}, {total / 1e6:.1f} MB")
    return {"bounds": bounds, "zooms": list(zooms)}


def tight_box(plate: np.ndarray, box) -> tuple[int, int, int, int]:
    """Snap a rough photograph box to the dark rectangle inside it, leaving out the caption."""
    x0, y0, x1, y1 = (int(v * VIEW) for v in box)
    pad = 60
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad
    part = plate[y0:y1, x0:x1] < 170
    xs = np.nonzero(part.mean(axis=0) > 0.28)[0]
    ys = np.nonzero(part.mean(axis=1) > 0.28)[0]
    left, right = x0 + xs[0], x0 + xs[-1] + 1
    top, bottom = y0 + ys[0], y0 + ys[-1] + 1
    # A bright sky can hide the top edge. All the photographs are about 1,045 px tall.
    if bottom - top < 950:
        top = bottom - 1045
    return left, top, right, min(bottom, top + 1048)


def write_photos(plate: np.ndarray, geo: Georef) -> list[dict]:
    folder = PUBLIC / "photos"
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    for key, (box, caption, tip) in PHOTOS.items():
        x0, y0, x1, y1 = tight_box(plate, box)
        crop = Image.fromarray(plate[y0:y1, x0:x1]).convert("L")
        crop.thumbnail((1100, 1100), Image.LANCZOS)
        crop.save(folder / f"{key}.jpg", quality=84, optimize=True, progressive=True)
        row = {"id": key, "caption": caption, "width": crop.width, "height": crop.height}
        if tip:
            lon, lat = geo.to_lonlat(np.array([float(tip[0])]), np.array([float(tip[1])]))
            row["lon"], row["lat"] = round(float(lon[0]), 5), round(float(lat[0]), 5)
        rows.append(row)
        print(key, (x1 - x0, y1 - y0))
    return rows


def write_plates() -> None:
    sources = {"plate-original.jpg": USER / "plate-1-step1-original-bw (1).png", "plate-color.jpg": USER / "plate-1-step2-colorized.png"}
    for name, source in sources.items():
        image = Image.open(source).convert("RGB")
        image = image.resize((2600, round(2600 * image.height / image.width)), Image.LANCZOS)
        image.save(PUBLIC / name, quality=80, optimize=True, progressive=True)
        print(name, (PUBLIC / name).stat().st_size // 1024, "KB")


def write_figure3() -> None:
    """The printed stage graph, so a reader can compare it with the tracing."""
    x0, y0, x1, y1 = FIG3_CROP
    gray = plate_gray()[y0:y1, x0:x1]
    image = Image.fromarray(gray).resize((900, round(900 * (y1 - y0) / (x1 - x0))), Image.LANCZOS)
    image.save(PUBLIC / "figure-3.jpg", quality=82, optimize=True, progressive=True)


def order_path(skeleton: np.ndarray) -> np.ndarray:
    """Walk a one-pixel line from end to end. A closed line is cut at one point."""
    ys, xs = np.nonzero(skeleton)
    points = {(int(x), int(y)) for x, y in zip(xs, ys)}

    def neighbors(p):
        return [(p[0] + i, p[1] + j) for i in (-1, 0, 1) for j in (-1, 0, 1) if (i or j) and (p[0] + i, p[1] + j) in points]

    ends = [p for p in points if len(neighbors(p)) == 1]
    start = ends[0] if ends else next(iter(points))

    def farthest(origin):
        seen = {origin: None}
        queue = [origin]
        last = origin
        for p in queue:
            last = p
            for q in neighbors(p):
                if q not in seen:
                    seen[q] = p
                    queue.append(q)
        return last, seen

    a, _ = farthest(start)
    b, parents = farthest(a)
    path = [b]
    while parents[path[-1]] is not None:
        path.append(parents[path[-1]])
    return np.array(path, dtype=np.float64)


def ring_path(skeleton: np.ndarray) -> np.ndarray:
    """Walk once around a closed one-pixel line."""
    rings, _ = cv2.findContours(skeleton.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return max(rings, key=len).reshape(-1, 2).astype(np.float64)


def resample(line: np.ndarray, step: float = 1.0) -> np.ndarray:
    """Even spacing along a line, so smoothing treats hand-read links like traced ones."""
    distance = np.r_[0, np.cumsum(np.hypot(*np.diff(line, axis=0).T))]
    keep = np.r_[True, np.diff(distance) > 0]
    along = np.arange(0, distance[-1], step)
    return np.stack([np.interp(along, distance[keep], line[keep, i]) for i in (0, 1)], 1)


def digitize_contours(plate: np.ndarray) -> list[dict]:
    x0, y0, x1, y1 = FIG1_BOX
    crop = plate[y0:y1, x0:x1]
    zoom = 1400 / crop.shape[1]
    mask = (crop < 110).astype(np.uint8)
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    keep = [i for i in range(1, n) if stats[i, 4] > 600 and max(stats[i, 2], stats[i, 3]) > 120]
    # The 6-inch line is a closed ring, so it cannot be walked from end to end.
    paths = {
        f"c{index}": (ring_path if index == 3 else order_path)(skeletonize(labels == label)) * zoom
        for index, label in enumerate(keep)
    }

    lon_per_x = (-92.0 + 93.0) / (FIG1_X[-92.0] - FIG1_X[-93.0])
    lat_per_y = (43.5 - 44.0) / (FIG1_Y[43.5] - FIG1_Y[44.0])

    def to_lonlat(xy):
        return np.stack([-93.0 + (xy[:, 0] - FIG1_X[-93.0]) * lon_per_x, 44.0 + (xy[:, 1] - FIG1_Y[44.0]) * lat_per_y], 1)

    out = []
    for value, parts in FIG1_LINES:
        chain = []
        for part in parts:
            piece = paths[part] if isinstance(part, str) else np.array(part, float)
            if chain:
                last = chain[-1][-1]
                if np.hypot(*(piece[-1] - last)) < np.hypot(*(piece[0] - last)):
                    piece = piece[::-1]
            elif isinstance(parts[-1], (str, list)) and len(parts) > 1:
                # Start from the end of the first piece that lies away from the next piece.
                nxt = paths[parts[1]] if isinstance(parts[1], str) else np.array(parts[1], float)
                if min(np.hypot(*(piece[0] - nxt[0])), np.hypot(*(piece[0] - nxt[-1]))) < min(
                    np.hypot(*(piece[-1] - nxt[0])), np.hypot(*(piece[-1] - nxt[-1]))
                ):
                    piece = piece[::-1]
            chain.append(piece)
        line = np.vstack(chain)
        closed = value == 6 or value == 7 or (value == 5)
        if closed:
            line = np.vstack([line, line[:1]])
        line = resample(line)
        kernel = 15
        pad = np.pad(line, ((kernel, kernel), (0, 0)), mode="wrap" if closed else "edge")
        smooth = np.stack([np.convolve(pad[:, i], np.ones(kernel) / kernel, "same") for i in (0, 1)], 1)[kernel:-kernel]
        approx = cv2.approxPolyDP(smooth.astype(np.float32).reshape(-1, 1, 2), 1.2, False).reshape(-1, 2)
        lonlat = to_lonlat(approx.astype(np.float64))
        out.append({"inches": value, "line": [[round(float(a), 4), round(float(b), 4)] for a, b in lonlat]})
        print(f"{value} in: {len(lonlat)} points")
    return out


def digitize_stage(plate: np.ndarray) -> dict:
    """Read the curve of Figure 3 column by column."""
    y0, y25 = FIG3["stage0_y"], FIG3["stage25_y"]
    right = FIG3["right_x"]
    top, bottom = int(y25) + 8, int(y0) - 8
    # The left edge of the frame: the first long dark column left of the curve.
    part = plate[top:bottom, 6400:6600] < 190
    left = 6400 + int(np.nonzero(part.mean(axis=0) > 0.5)[0][0])
    crop = plate[top:bottom, left + 12:int(right) - 8]
    dark = (crop < 105).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    curve = labels == (1 + int(np.argmax(stats[1:, cv2.CC_STAT_WIDTH])))
    per_day = (right - left) / FIG3["days"]
    points = []
    for column in range(0, curve.shape[1], 6):
        rows = np.nonzero(curve[:, column])[0]
        if len(rows) == 0:
            continue
        hour = (left + 12 + column - left) / per_day * 24
        # On the steep rise a column crosses the line, so take its middle.
        stage = (y0 - (top + rows.mean())) / (y0 - y25) * 25
        points.append((round(hour, 2), round(float(stage), 2)))
    rows = np.array(points)
    peak = rows[int(np.argmax(rows[:, 1]))]
    print(f"Figure 3: left {left}, {len(points)} points, peak {peak[1]:.2f} ft at hour {peak[0]:.2f} from midnight July 5")
    return {"points": points, "peak_hour_from_jul5": float(peak[0]), "peak_ft": float(peak[1])}


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    plate = plate_gray()
    print("shift", fit_shift(plate))
    geo = Georef()
    mask = mosaic_mask(plate)
    cv2.imwrite(str(WORK / "plate/mosaic_mask_check.png"), cv2.resize(mask, None, fx=0.1, fy=0.1))
    result = {"mosaic": write_tiles(plate, mask, geo), "photos": write_photos(plate, geo), "contours": digitize_contours(plate), "stage": digitize_stage(plate)}
    result["shift"] = json.loads((WORK / "plate/shift.json").read_text())
    write_plates()
    write_figure3()
    OUT_JSON.write_text(json.dumps(result))
    print("Saved", OUT_JSON)


if __name__ == "__main__":
    main()
