// Interactive pieces of the Rochester 1978 post: the plate comparison, the
// timeline, the rainfall map, the river charts, and the two Leaflet maps. The
// data comes from scripts/rochester-1978. Leaflet loads only when a map comes
// near the screen.

import 'leaflet/dist/leaflet.css';

interface Grid { lon0: number; lat0: number; dlon: number; dlat: number; nx: number; ny: number; storm: (number | null)[]; before: (number | null)[] }
interface Gauge { name: string; id: string; lon: number; lat: number; storm: number | null; before: number | null }
interface Station { id: string; name: string; lon: number; lat: number }
interface Photo { id: string; caption: string; lon?: number; lat?: number }
interface Peak { date: string; cfs: number | null; stage: number | null }
interface PageData {
  map: { extent: { west: number; east: number; south: number; north: number }; counties: string; basin: string; rivers: string; zumbro: string; zumbro_rivers: string; towns: { name: string; lon: number; lat: number }[] };
  grid: Grid;
  gauges: Gauge[];
  contours: { inches: number; line: [number, number][] }[];
  timeline: { days: string[]; rain: number[]; flow: number[] };
  stations: Station[];
  estimates_1975: { south_fork: { cfs_100yr: number }; bear_creek: { cfs_100yr: number } };
  stage: { points: [number, number][] };
  peaks: { south_fork: Peak[]; bear_creek: Peak[] };
  mosaic: { bounds: [number, number, number, number]; tiles: Record<string, Record<string, number[]>> };
  photos: Photo[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ASSETS = '/blog/rochester-1978';
const NASIR = ['#261410', '#3b1261', '#4027e1', '#518ffd', '#74ecf9', '#50a877', '#6dd96f', '#ebc05c', '#f04a23'];

// Each round of rain has its own color range, so it fills the palette.
type RainEvent = 'before' | 'storm';
const RAIN: Record<RainEvent, { ramp: string[]; top: number; legend: string; period: string }> = {
  before: { ramp: NASIR, top: 7, legend: 'Cumulative rainfall in inches, June 29 to July 2, 1978 (four-day total)', period: 'Cumulative, June 29 to July 2' },
  storm: { ramp: NASIR, top: 4, legend: 'Cumulative rainfall in inches, July 5 and 6, 1978 (two-day total)', period: 'Cumulative, July 5 and 6' },
};

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function rainColor(inches: number, event: RainEvent): [number, number, number] {
  const { ramp, top } = RAIN[event];
  const position = Math.max(0, Math.min(1, inches / top)) * (ramp.length - 1);
  const low = Math.min(ramp.length - 2, Math.floor(position));
  const a = rgbOf(ramp[low]);
  const b = rgbOf(ramp[low + 1]);
  return a.map((v, i) => Math.round(v + (b[i] - v) * (position - low))) as [number, number, number];
}

// ------------------------------------------------------- plate comparison

const VIEWS: Record<string, { cx: number; cy: number; zoom: number }> = {
  whole: { cx: 0.5, cy: 0.5, zoom: 1 },
  paper: { cx: 0.25, cy: 0.11, zoom: 2.05 },
  stage: { cx: 0.82, cy: 0.1, zoom: 3 },
  downtown: { cx: 0.67, cy: 0.5, zoom: 3 },
  mall: { cx: 0.42, cy: 0.63, zoom: 2.6 },
};

function initSwipe(root: HTMLElement): void {
  const frame = root.querySelector<HTMLElement>('[data-swipe-frame]')!;
  const clip = root.querySelector<HTMLElement>('[data-swipe-clip]')!;
  const handle = root.querySelector<HTMLElement>('[data-swipe-handle]')!;
  const range = root.querySelector<HTMLInputElement>('[data-swipe-range]')!;
  const layers = root.querySelectorAll<HTMLElement>('[data-swipe-layer]');

  const setSplit = (percent: number) => {
    const value = Math.max(0, Math.min(100, percent));
    clip.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    handle.style.left = `${value}%`;
    range.value = String(value);
  };
  const setView = (name: string) => {
    const view = VIEWS[name] ?? VIEWS.whole;
    const half = 0.5 / view.zoom;
    const x = Math.max(half, Math.min(1 - half, view.cx));
    const y = Math.max(half, Math.min(1 - half, view.cy));
    const transform = `scale(${view.zoom}) translate(${(0.5 - x) * 100}%, ${(0.5 - y) * 100}%)`;
    layers.forEach((layer) => { layer.style.transform = transform; });
    root.querySelectorAll<HTMLButtonElement>('[data-swipe-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.swipeView === name));
    });
  };

  const fromPointer = (event: PointerEvent) => {
    const box = frame.getBoundingClientRect();
    setSplit(((event.clientX - box.left) / box.width) * 100);
  };
  frame.addEventListener('pointerdown', (event) => {
    frame.setPointerCapture(event.pointerId);
    fromPointer(event);
  });
  frame.addEventListener('pointermove', (event) => { if (event.buttons) fromPointer(event); });
  range.addEventListener('input', () => setSplit(Number(range.value)));
  root.querySelectorAll<HTMLButtonElement>('[data-swipe-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.swipeView!));
  });
  setSplit(50);
  setView('whole');
}

// ------------------------------------------------------------ rainfall map

function initRainMap(root: HTMLElement, data: PageData): void {
  const { extent } = data.map;
  const width = 1000;
  const shrink = Math.cos((44 * Math.PI) / 180);
  const perDegree = width / ((extent.east - extent.west) * shrink);
  const height = Math.round((extent.north - extent.south) * perDegree);
  const px = (lon: number) => (lon - extent.west) * shrink * perDegree;
  const py = (lat: number) => (extent.north - lat) * perDegree;

  const stage = root.querySelector<HTMLElement>('[data-rain-stage]')!;
  stage.style.aspectRatio = `${width} / ${height}`;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-rain-canvas]')!;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const overlay = root.querySelector<SVGSVGElement>('[data-rain-overlay]')!;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const tip = root.querySelector<HTMLElement>('[data-rain-tip]')!;

  const toPath = (source: string) => source.replace(/(-?\d+\.\d+),(-?\d+\.\d+)/g, (_, lon, lat) =>
    `${px(Number(lon)).toFixed(1)},${py(Number(lat)).toFixed(1)}`);

  overlay.append(svg('path', { d: toPath(data.map.counties), class: 'rf-m-county' }));
  overlay.append(svg('path', { d: toPath(data.map.rivers), class: 'rf-m-river' }));
  overlay.append(svg('path', { d: toPath(data.map.zumbro_rivers), class: 'rf-m-zumbro-river' }));
  overlay.append(svg('path', { d: `${toPath(data.map.zumbro)}Z`, class: 'rf-m-zumbro' }));
  overlay.append(svg('path', { d: `${toPath(data.map.basin)}Z`, class: 'rf-m-basin' }));

  const contourLayer = svg('g', { class: 'rf-m-contours' });
  for (const contour of data.contours) {
    const points = contour.line.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`);
    contourLayer.append(svg('path', { d: `M${points.join('L')}`, class: 'rf-m-contour' }));
    const [lon, lat] = contour.line[Math.floor(contour.line.length * (contour.inches === 3 ? 0.8 : 0.3))];
    const label = svg('text', { x: px(lon), y: py(lat) + 4, class: 'rf-m-contour-label', 'text-anchor': 'middle' }, String(contour.inches));
    contourLayer.append(label);
  }
  overlay.append(contourLayer);

  for (const town of data.map.towns) {
    if (town.lon < extent.west || town.lon > extent.east) continue;
    const nearEdge = px(town.lon) > width * 0.85;
    overlay.append(svg('text', { x: px(town.lon) + (nearEdge ? -7 : 7), y: py(town.lat) + 4, 'text-anchor': nearEdge ? 'end' : 'start', class: 'rf-m-town' }, town.name));
    overlay.append(svg('circle', { cx: px(town.lon), cy: py(town.lat), r: 2.6, class: 'rf-m-town-dot' }));
  }

  const gaugeLayer = svg('g');
  overlay.append(gaugeLayer);

  let event: RainEvent = 'before';
  let showContours = true;

  const valueAt = (lon: number, lat: number): number | null => {
    const grid = data.grid;
    const col = Math.round((lon - grid.lon0) / grid.dlon);
    const row = Math.round((lat - grid.lat0) / grid.dlat);
    if (col < 0 || row < 0 || col >= grid.nx || row >= grid.ny) return null;
    return grid[event][row * grid.nx + col];
  };

  const legend = root.querySelector<HTMLCanvasElement>('[data-rain-legend]')!;
  const legendCtx = legend.getContext('2d')!;
  const legendTitle = root.querySelector<HTMLElement>('[data-rain-legend-title]')!;
  const legendTicks = root.querySelector<HTMLElement>('[data-rain-ticks]')!;
  const drawLegend = () => {
    const { top, legend: title } = RAIN[event];
    legendTitle.textContent = title;
    for (let x = 0; x < legend.width; x += 1) {
      const [r, g, b] = rainColor((x / (legend.width - 1)) * top, event);
      legendCtx.fillStyle = `rgb(${r},${g},${b})`;
      legendCtx.fillRect(x, 0, 1, legend.height);
    }
    legendTicks.replaceChildren(...Array.from({ length: top + 1 }, (_, tick) => {
      const label = document.createElement('span');
      label.style.left = `${(tick / top) * 100}%`;
      label.textContent = tick === top ? `${tick}+` : String(tick);
      return label;
    }));
  };

  const draw = () => {
    const grid = data.grid;
    const values = grid[event];
    const buffer = document.createElement('canvas');
    buffer.width = grid.nx;
    buffer.height = grid.ny;
    const bufferCtx = buffer.getContext('2d')!;
    const image = bufferCtx.createImageData(grid.nx, grid.ny);
    for (let row = 0; row < grid.ny; row += 1) {
      for (let col = 0; col < grid.nx; col += 1) {
        const value = values[row * grid.nx + col];
        const at = ((grid.ny - 1 - row) * grid.nx + col) * 4;
        if (value === null || value === undefined) continue;
        const [r, g, b] = rainColor(value, event);
        image.data.set([r, g, b, value < 0.05 ? 90 : 255], at);
      }
    }
    bufferCtx.putImageData(image, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const west = grid.lon0 - grid.dlon / 2;
    const north = grid.lat0 + (grid.ny - 0.5) * grid.dlat;
    ctx.drawImage(buffer, px(west), py(north), grid.nx * grid.dlon * shrink * perDegree, grid.ny * grid.dlat * perDegree);
    drawLegend();

    contourLayer.style.display = showContours && event === 'storm' ? '' : 'none';
    gaugeLayer.replaceChildren();
    for (const gauge of data.gauges) {
      const value = gauge[event];
      if (value === null) continue;
      const [r, g, b] = rainColor(value, event);
      const big = gauge.name.startsWith('Rochester');
      const dot = svg('circle', {
        cx: px(gauge.lon), cy: py(gauge.lat), r: big ? 8 : 6,
        fill: `rgb(${r},${g},${b})`, class: 'rf-m-gauge', tabindex: 0,
      });
      const show = () => {
        tip.innerHTML = `<strong>${gauge.name}, ${value.toFixed(2)} in</strong><span>Station ${gauge.id}</span><span>${RAIN[event].period}</span>`;
        tip.hidden = false;
        tip.style.left = `${(px(gauge.lon) / width) * 100}%`;
        tip.style.top = `${(py(gauge.lat) / height) * 100}%`;
        tip.dataset.side = px(gauge.lon) > width * 0.68 ? 'left' : 'right';
      };
      dot.addEventListener('pointerenter', (pointer) => { pointer.stopPropagation(); show(); });
      dot.addEventListener('focus', show);
      dot.addEventListener('blur', () => { tip.hidden = true; });
      gaugeLayer.append(dot);
    }
    root.querySelectorAll<HTMLButtonElement>('[data-rain-event]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rainEvent === event)));
    const toggle = root.querySelector<HTMLButtonElement>('[data-rain-contours]')!;
    toggle.setAttribute('aria-pressed', String(showContours));
    toggle.disabled = event !== 'storm';
  };

  stage.addEventListener('pointermove', (pointer) => {
    if ((pointer.target as Element).classList?.contains('rf-m-gauge')) return;
    const box = stage.getBoundingClientRect();
    const x = ((pointer.clientX - box.left) / box.width) * width;
    const y = ((pointer.clientY - box.top) / box.height) * height;
    const lon = extent.west + x / perDegree / shrink;
    const lat = extent.north - y / perDegree;
    const value = valueAt(lon, lat);
    if (value === null) { tip.hidden = true; return; }
    tip.innerHTML = `<strong>${value.toFixed(2)} in</strong><span>nClimGrid cell</span><span>${RAIN[event].period}</span>`;
    tip.hidden = false;
    tip.style.left = `${(x / width) * 100}%`;
    tip.style.top = `${(y / height) * 100}%`;
    tip.dataset.side = x > width * 0.68 ? 'left' : 'right';
  });
  stage.addEventListener('pointerleave', () => { tip.hidden = true; });

  root.querySelectorAll<HTMLButtonElement>('[data-rain-event]').forEach((button) => {
    button.addEventListener('click', () => { event = button.dataset.rainEvent as typeof event; draw(); });
  });
  root.querySelector<HTMLButtonElement>('[data-rain-contours]')!.addEventListener('click', () => { showContours = !showContours; draw(); });

  draw();
}

// ------------------------------------------------------------------ charts

interface Frame { width: number; height: number; left: number; right: number; top: number; bottom: number }

function chartFrame(box: HTMLElement, margin: { left: number; right: number; top: number; bottom: number }, minHeight: number): Frame {
  const width = Math.max(300, box.clientWidth);
  const height = Math.max(minHeight, box.clientHeight);
  return { width, height, ...margin };
}

function drawTimeline(box: HTMLElement, data: PageData): void {
  const f = chartFrame(box, { left: 8, right: 8, top: 26, bottom: 26 }, 390);
  const { days, rain, flow } = data.timeline;
  const narrow = f.width < 620;
  const band = (f.width - f.left - f.right) / days.length;
  const x = (i: number) => f.left + band * i;
  const rainTop = f.top + 44;
  const rainBase = rainTop + 96;
  const flowTop = rainBase + 62;
  const flowBase = f.height - f.bottom;
  const rainY = (inches: number) => rainBase - ((rainBase - rainTop) * inches) / 6.5;
  const flowY = (cfs: number) => flowBase - ((flowBase - flowTop) * cfs) / 20500;
  const chart = svg('svg', { width: f.width, height: f.height, viewBox: `0 0 ${f.width} ${f.height}`, role: 'img' });
  chart.setAttribute('aria-label', 'Daily rain at the Rochester airport and daily mean flow of the South Fork Zumbro River from June 28 to July 9, 1978. About 2 inches fell from June 29 to July 2 and flow rose to 823 cubic feet per second. Then 6.74 inches fell on July 5 and 6, and flow reached 20,500 cubic feet per second on July 6.');

  const phases: [number, number, string, string][] = [[1, 5, 'Wet spell', 'wet'], [7, 10, 'Storm and flood', 'storm']];
  for (const [first, last, label, kind] of phases) {
    chart.append(svg('rect', { x: x(first), y: 0, width: x(last) - x(first), height: flowBase + 4, rx: 6, class: `rf-tl-band rf-tl-band--${kind}` }));
    chart.append(svg('text', { x: (x(first) + x(last)) / 2, y: 18, 'text-anchor': 'middle', class: `rf-tl-phase rf-tl-phase--${kind}` }, label));
  }

  chart.append(svg('text', { x: f.left, y: f.top + 16, class: 'rf-axis rf-axis--strong' }, 'Rain at the airport, inches per day'));
  chart.append(svg('text', { x: f.left, y: rainBase + 42, class: 'rf-axis rf-axis--strong' }, narrow ? 'River flow, daily mean, cfs' : 'South Fork Zumbro River flow, daily mean, cubic feet per second'));
  chart.append(svg('line', { x1: f.left, x2: f.width - f.right, y1: rainBase, y2: rainBase, class: 'rf-grid' }));
  chart.append(svg('line', { x1: f.left, x2: f.width - f.right, y1: flowBase, y2: flowBase, class: 'rf-grid' }));

  days.forEach((day, i) => {
    const center = x(i) + band / 2;
    const barWidth = Math.min(band * 0.62, 44);
    if (rain[i] > 0) {
      chart.append(svg('rect', { x: center - barWidth / 2, y: rainY(rain[i]), width: barWidth, height: Math.max(1, rainBase - rainY(rain[i])), rx: 2, class: i === 7 ? 'rf-tl-bar--hot' : 'rf-tl-bar' }));
      chart.append(svg('text', { x: center, y: rainY(rain[i]) - 5, 'text-anchor': 'middle', class: 'rf-axis rf-tl-value' }, rain[i].toFixed(2)));
    }
    const cfs = flow[i];
    chart.append(svg('rect', { x: center - barWidth / 2, y: flowY(cfs), width: barWidth, height: Math.max(1, flowBase - flowY(cfs)), rx: 2, class: i === 8 ? 'rf-tl-bar--hot' : 'rf-tl-bar' }));
    const label = narrow && cfs >= 1000 ? `${(cfs / 1000).toFixed(1)}k` : cfs.toLocaleString('en-US');
    chart.append(svg('text', { x: center, y: flowY(cfs) - 5, 'text-anchor': 'middle', class: 'rf-axis rf-tl-value' }, label));
    const [, month, date] = day.split('-').map(Number);
    const dayLabel = narrow ? `${month}/${date}` : `${month === 6 ? 'Jun' : 'Jul'} ${date}`;
    chart.append(svg('text', { x: center, y: f.height - 8, 'text-anchor': 'middle', class: 'rf-axis' }, dayLabel));
  });
  box.replaceChildren(chart);
}

function drawStage(box: HTMLElement, tip: HTMLElement, data: PageData): void {
  const f = chartFrame(box, { left: 44, right: 16, top: 16, bottom: 36 }, 300);
  const plotW = f.width - f.left - f.right;
  const plotH = f.height - f.top - f.bottom;
  const hours = 72;
  const top = 25;
  const x = (hour: number) => f.left + (plotW * hour) / hours;
  const y = (stage: number) => f.top + plotH * (1 - stage / top);
  const chart = svg('svg', { width: f.width, height: f.height, viewBox: `0 0 ${f.width} ${f.height}`, role: 'img' });
  chart.setAttribute('aria-label', 'River stage at the USGS gauge near Rochester, July 5 to 7, 1978, rising from about 4 feet to a peak of 23.36 feet');

  for (let tick = 0; tick <= top; tick += 5) {
    chart.append(svg('line', { x1: f.left, x2: f.width - f.right, y1: y(tick), y2: y(tick), class: 'rf-grid' }));
    chart.append(svg('text', { x: f.left - 7, y: y(tick) + 4, 'text-anchor': 'end', class: 'rf-axis' }, tick === 0 ? '0' : `${tick} ft`));
  }
  [24, 48].forEach((hour) => chart.append(svg('line', { x1: x(hour), x2: x(hour), y1: f.top, y2: f.top + plotH, class: 'rf-grid' })));
  ['July 5', 'July 6', 'July 7'].forEach((label, i) => {
    chart.append(svg('text', { x: x(12 + 24 * i), y: f.height - 12, 'text-anchor': 'middle', class: 'rf-axis' }, label));
  });

  const marks: [number, string][] = [[12, 'Flood stage, 12 ft'], [19.12, 'March 1965 record, 19.12 ft']];
  for (const [level, label] of marks) {
    chart.append(svg('line', { x1: f.left, x2: f.width - f.right, y1: y(level), y2: y(level), class: 'rf-mark' }));
    chart.append(svg('text', { x: f.left + 8, y: y(level) - 6, class: 'rf-axis rf-axis--strong' }, label));
  }

  const points = data.stage.points;
  const d = points.map(([hour, stage]) => `${x(hour).toFixed(1)},${y(stage).toFixed(1)}`);
  chart.append(svg('path', { d: `M${d.join('L')}L${x(points[points.length - 1][0])},${y(0)}L${x(points[0][0])},${y(0)}Z`, class: 'rf-area' }));
  chart.append(svg('path', { d: `M${d.join('L')}`, class: 'rf-line' }));

  const peak = points.reduce((a, b) => (b[1] > a[1] ? b : a));
  chart.append(svg('circle', { cx: x(peak[0]), cy: y(peak[1]), r: 4.5, class: 'rf-peak-dot' }));
  chart.append(svg('text', { x: x(peak[0]) + 10, y: y(peak[1]) + 3, class: 'rf-axis rf-axis--peak' }, 'Crest, 23.36 ft'));

  const dot = svg('circle', { r: 4.5, class: 'rf-hover-dot', visibility: 'hidden' });
  chart.append(dot);
  chart.addEventListener('pointermove', (pointer) => {
    const bounds = chart.getBoundingClientRect();
    const hour = ((pointer.clientX - bounds.left - f.left) / plotW) * hours;
    let best = points[0];
    for (const point of points) if (Math.abs(point[0] - hour) < Math.abs(best[0] - hour)) best = point;
    dot.setAttribute('cx', String(x(best[0])));
    dot.setAttribute('cy', String(y(best[1])));
    dot.setAttribute('visibility', 'visible');
    const whole = Math.round(best[0]);
    const clock = ((whole % 24) + 24) % 24;
    tip.innerHTML = `<strong>${best[1].toFixed(1)} ft</strong><span>July ${5 + Math.floor(whole / 24)}, about ${clock.toString().padStart(2, '0')}00 hr</span>`;
    tip.hidden = false;
    tip.style.left = `${x(best[0])}px`;
    tip.style.top = `${y(best[1])}px`;
    tip.dataset.side = best[0] > 50 ? 'left' : 'right';
  });
  chart.addEventListener('pointerleave', () => { tip.hidden = true; dot.setAttribute('visibility', 'hidden'); });
  box.replaceChildren(chart);
}

function drawPeaks(box: HTMLElement, tip: HTMLElement, data: PageData): void {
  const f = chartFrame(box, { left: 54, right: 12, top: 18, bottom: 32 }, 300);
  const plotW = f.width - f.left - f.right;
  const plotH = f.height - f.top - f.bottom;
  const peaks = data.peaks.south_fork.filter((p) => p.cfs !== null);
  const first = 1951;
  const last = 2025;
  const span = last - first + 1;
  const band = plotW / span;
  const top = 32000;
  const x = (year: number) => f.left + band * (year - first);
  const y = (cfs: number) => f.top + plotH * (1 - cfs / top);
  const chart = svg('svg', { width: f.width, height: f.height, viewBox: `0 0 ${f.width} ${f.height}`, role: 'img' });
  chart.setAttribute('aria-label', 'Annual peak discharge of the South Fork Zumbro River at Rochester, 1951 to 2025. The 1978 peak of 30,500 cubic feet per second stands far above all others.');

  chart.append(svg('rect', { x: x(1995.7), y: f.top, width: x(last + 1) - x(1995.7), height: plotH, class: 'rf-span' }));
  chart.append(svg('text', { x: x(1996.3), y: f.top + 14, class: 'rf-axis rf-axis--strong' }, 'After the Corps finished, August 1995'));

  for (let tick = 0; tick <= 30000; tick += 10000) {
    chart.append(svg('line', { x1: f.left, x2: f.width - f.right, y1: y(tick), y2: y(tick), class: 'rf-grid' }));
    chart.append(svg('text', { x: f.left - 7, y: y(tick) + 4, 'text-anchor': 'end', class: 'rf-axis' }, tick === 0 ? '0' : `${tick / 1000}k cfs`));
  }
  for (let year = 1960; year <= 2020; year += 10) {
    chart.append(svg('text', { x: x(year) + band / 2, y: f.height - 12, 'text-anchor': 'middle', class: 'rf-axis' }, String(year)));
  }

  for (const peak of peaks) {
    const year = Number(peak.date.slice(0, 4));
    const cfs = peak.cfs!;
    const hot = year === 1978;
    const named = year === 1965 || year === 1962;
    chart.append(svg('rect', {
      x: x(year) + band * 0.14, y: y(cfs), width: Math.max(1.5, band * 0.72), height: Math.max(1, y(0) - y(cfs)),
      rx: 1, class: `rf-bar${hot ? ' rf-bar--hot' : named ? ' rf-bar--named' : ''}`,
    }));
    const hit = svg('rect', { x: x(year), y: f.top, width: band, height: plotH, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => {
      const when = new Date(`${peak.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
      tip.innerHTML = `<strong>${cfs.toLocaleString('en-US')} cfs</strong><span>${peak.date.endsWith('-00') ? year : when}${peak.stage ? `, ${peak.stage.toFixed(2)} ft` : ''}</span>`;
      tip.hidden = false;
      tip.style.left = `${x(year) + band / 2}px`;
      tip.style.top = `${y(cfs)}px`;
      tip.dataset.side = year > 2000 ? 'left' : 'right';
    });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    chart.append(hit);
  }
  chart.append(svg('text', { x: x(1978) + band + 5, y: y(30500) + 11, class: 'rf-axis rf-axis--peak' }, '1978: 30,500 cfs'));
  box.replaceChildren(chart);
}

function drawBear(box: HTMLElement, data: PageData): void {
  const f = chartFrame(box, { left: 4, right: 62, top: 4, bottom: 4 }, 280);
  const south = data.peaks.south_fork.find((p) => p.date === '1978-07-06')!.cfs!;
  const bear = data.peaks.bear_creek.find((p) => p.date === '1978-07-06')!.cfs!;
  const rows = [
    { name: 'South Fork Zumbro River, 304 sq mi', peak: south, estimate: data.estimates_1975.south_fork.cfs_100yr, unit: south / 304 },
    { name: 'Bear Creek, 80 sq mi', peak: bear, estimate: data.estimates_1975.bear_creek.cfs_100yr, unit: bear / 80 },
  ];
  const plotW = f.width - f.left - f.right;
  const flowW = (cfs: number) => (plotW * cfs) / 30500;
  const unitW = (cfs: number) => (plotW * cfs) / 320;
  const chart = svg('svg', { width: f.width, height: f.height, viewBox: `0 0 ${f.width} ${f.height}`, role: 'img' });
  chart.setAttribute('aria-label', 'Bear Creek peaked at 24,900 cubic feet per second, nearly twice the 13,100 estimated in 1975 as its 100-year flow. The South Fork peaked at 30,500 against an estimate of 27,500. Per square mile, Bear Creek carried about 311 and the South Fork about 100.');
  const bar = (y: number, width: number, label: string, hot: boolean) => {
    chart.append(svg('rect', { x: f.left, y, width, height: 15, rx: 2, class: hot ? 'rf-tl-bar--hot' : 'rf-tl-bar' }));
    chart.append(svg('text', { x: f.left + width + 6, y: y + 12, class: 'rf-axis rf-tl-value' }, label));
  };

  let y = f.top + 12;
  chart.append(svg('text', { x: f.left, y, class: 'rf-axis rf-axis--strong' }, 'Peak flow, cubic feet per second'));
  y += 10;
  for (const row of rows) {
    chart.append(svg('text', { x: f.left, y: y + 12, class: 'rf-axis' }, row.name));
    bar(y + 18, flowW(row.peak), row.peak.toLocaleString('en-US'), true);
    bar(y + 36, flowW(row.estimate), row.estimate.toLocaleString('en-US'), false);
    y += 62;
  }
  const keyY = y + 6;
  chart.append(svg('rect', { x: f.left, y: keyY - 9, width: 10, height: 10, rx: 2, class: 'rf-tl-bar--hot' }));
  chart.append(svg('text', { x: f.left + 15, y: keyY, class: 'rf-axis' }, 'July 6, 1978'));
  chart.append(svg('rect', { x: f.left + 96, y: keyY - 9, width: 10, height: 10, rx: 2, class: 'rf-tl-bar' }));
  chart.append(svg('text', { x: f.left + 111, y: keyY, class: 'rf-axis' }, '100-year estimate, 1975'));

  y = keyY + 28;
  chart.append(svg('text', { x: f.left, y, class: 'rf-axis rf-axis--strong' }, 'July 6 peak per square mile of watershed'));
  y += 8;
  for (const row of rows) {
    chart.append(svg('text', { x: f.left, y: y + 12, class: 'rf-axis' }, row.name.split(',')[0]));
    bar(y + 18, unitW(row.unit), `${Math.round(row.unit)} cfs`, true);
    y += 42;
  }
  box.replaceChildren(chart);
}

function initCharts(data: PageData): void {
  const pairs: [string, typeof drawStage][] = [['[data-rf-stage]', drawStage], ['[data-rf-peaks]', drawPeaks]];
  for (const [selector, draw] of pairs) {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) continue;
    const box = root.querySelector<HTMLElement>('[data-chart]')!;
    const tip = root.querySelector<HTMLElement>('[data-tip]')!;
    new ResizeObserver(() => draw(box, tip, data)).observe(box);
  }
  const plain: [string, typeof drawTimeline][] = [['[data-rf-timeline]', drawTimeline], ['[data-rf-bear]', drawBear]];
  for (const [selector, draw] of plain) {
    const box = document.querySelector<HTMLElement>(`${selector} [data-chart]`);
    if (box) new ResizeObserver(() => draw(box, data)).observe(box);
  }
}

// --------------------------------------------------------------- gauge map

const GAUGE_LABEL_SIDE: Record<string, 'left' | 'right'> = { '05373000': 'right', '05372995': 'left', '05372930': 'right' };

async function initGaugeMap(element: HTMLElement, data: PageData): Promise<void> {
  const { default: L } = await import('leaflet');
  const map = L.map(element, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 16 });
  L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, attribution: 'USGS The National Map',
  }).addTo(map);
  for (const station of data.stations) {
    const main = station.id === '05373000';
    const marker = L.circleMarker([station.lat, station.lon], { radius: main ? 8 : 6, color: '#fff', weight: 2, fillColor: main ? '#f04a23' : '#1b5e8c', fillOpacity: 1 }).addTo(map);
    marker.bindTooltip(station.id, { permanent: true, direction: GAUGE_LABEL_SIDE[station.id], offset: [GAUGE_LABEL_SIDE[station.id] === 'right' ? 8 : -8, 0], className: 'rf-gauge-tip' });
    marker.bindPopup(`<strong>USGS ${station.id}</strong><br>${station.name}<br><a href="https://waterdata.usgs.gov/monitoring-location/USGS-${station.id}/" target="_blank" rel="noopener">Station page</a>`);
  }
  map.fitBounds(data.stations.map((station) => [station.lat, station.lon] as [number, number]), { padding: [46, 46] });
  new ResizeObserver(() => map.invalidateSize()).observe(element);
}

// --------------------------------------------------------------- flood map

async function initFloodMap(root: HTMLElement, data: PageData): Promise<void> {
  const { default: L } = await import('leaflet');
  const [west, south, east, north] = data.mosaic.bounds;
  const map = L.map(root.querySelector<HTMLElement>('[data-flood-map]')!, {
    scrollWheelZoom: false,
    zoomSnap: 0.25,
    minZoom: 12,
    maxZoom: 18,
    maxBounds: [[south - 0.06, west - 0.09], [north + 0.06, east + 0.09]],
    attributionControl: true,
  });
  L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 18, attribution: 'Current imagery: USGS The National Map',
  }).addTo(map);
  // The mosaic is L-shaped, so many tiles inside its bounds do not exist. Ask only for those that do.
  const tiles = data.mosaic.tiles;
  const MosaicLayer = L.TileLayer.extend({
    createTile(coords: { z: number; x: number; y: number }, done: (error?: Error, tile?: HTMLElement) => void) {
      if (tiles[coords.z]?.[coords.x]?.includes(coords.y)) return L.TileLayer.prototype.createTile.call(this, coords, done);
      const empty = document.createElement('div');
      window.setTimeout(() => done(undefined, empty), 0);
      return empty;
    },
  });
  const mosaic = new MosaicLayer(`${ASSETS}/mosaic/{z}/{x}/{y}.webp`, {
    minNativeZoom: 12, maxNativeZoom: 17, maxZoom: 18, bounds: [[south, west], [north, east]],
    attribution: '1978 photomosaic: USGS OFR 79-1583',
  }).addTo(map);
  map.fitBounds([[south, west], [north, east]], { padding: [10, 10] });

  const opacity = root.querySelector<HTMLInputElement>('[data-flood-opacity]')!;
  opacity.addEventListener('input', () => mosaic.setOpacity(Number(opacity.value) / 100));

  const image = root.querySelector<HTMLImageElement>('[data-flood-photo]')!;
  const caption = root.querySelector<HTMLElement>('[data-flood-caption]')!;
  const buttons = new Map<string, HTMLButtonElement>();
  const markers = new Map<string, ReturnType<typeof L.circleMarker>>();

  const show = (photo: Photo, fly: boolean) => {
    image.src = `${ASSETS}/photos/${photo.id}.jpg`;
    image.alt = `Black and white photograph from the USGS plate: ${photo.caption}, July 1978`;
    caption.textContent = photo.lon === undefined ? `${photo.caption}. The plate does not tie this photograph to a spot on the mosaic.` : photo.caption;
    buttons.forEach((button, id) => button.setAttribute('aria-pressed', String(id === photo.id)));
    markers.forEach((marker, id) => marker.setStyle({ fillColor: id === photo.id ? '#f04a23' : '#ebc05c', radius: id === photo.id ? 9 : 7 }));
    if (fly && photo.lon !== undefined && photo.lat !== undefined) map.flyTo([photo.lat, photo.lon], 16, { duration: 0.8 });
  };

  const strip = root.querySelector<HTMLElement>('[data-flood-strip]')!;
  for (const photo of data.photos) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rf-thumb';
    button.title = photo.caption;
    button.innerHTML = `<img src="${ASSETS}/photos/${photo.id}.jpg" alt="" loading="lazy" width="120" height="93"><span>${photo.caption}</span>`;
    button.addEventListener('click', () => show(photo, true));
    strip.append(button);
    buttons.set(photo.id, button);
    if (photo.lon !== undefined && photo.lat !== undefined) {
      const marker = L.circleMarker([photo.lat, photo.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#ebc05c', fillOpacity: 1 }).addTo(map);
      marker.bindTooltip(photo.caption);
      marker.on('click', () => show(photo, false));
      markers.set(photo.id, marker);
    }
  }
  show(data.photos.find((photo) => photo.id === 'apache-mall') ?? data.photos[0], false);

  root.querySelectorAll<HTMLButtonElement>('[data-flood-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const [lat, lon, zoom] = button.dataset.floodView!.split(',').map(Number);
      map.flyTo([lat, lon], zoom, { duration: 0.8 });
    });
  });
  new ResizeObserver(() => map.invalidateSize()).observe(root.querySelector<HTMLElement>('[data-flood-map]')!);
}

// -------------------------------------------------------------------- boot

function whenNear(element: HTMLElement, start: () => Promise<void>): void {
  const watcher = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      watcher.disconnect();
      start().catch((error) => {
        console.error(error);
        element.dataset.failed = 'true';
      });
    }
  }, { rootMargin: '500px' });
  watcher.observe(element);
}

function boot(): void {
  const source = document.querySelector<HTMLScriptElement>('[data-rf-data]:not([data-ready])');
  if (!source) return;
  source.dataset.ready = 'true';
  const data = JSON.parse(source.textContent ?? '{}') as PageData;

  const swipe = document.querySelector<HTMLElement>('[data-rf-swipe]');
  if (swipe) initSwipe(swipe);
  const rain = document.querySelector<HTMLElement>('[data-rf-rain]');
  if (rain) initRainMap(rain, data);
  initCharts(data);

  const flood = document.querySelector<HTMLElement>('[data-rf-flood]');
  if (flood) whenNear(flood, () => initFloodMap(flood, data));
  const gauges = document.querySelector<HTMLElement>('[data-gauge-map]');
  if (gauges) whenNear(gauges, () => initGaugeMap(gauges, data));
}

document.addEventListener('astro:page-load', boot);
boot();
