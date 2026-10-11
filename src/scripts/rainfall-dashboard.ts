// Interactive dashboard with a canvas map, a bar chart to pick the year, and a
// player for the largest events. It draws two kinds of data:
//   rain: each year's wettest window, played hour by hour
//         (scripts/extreme-rainfall/08_export_web.py)
//   snow: each winter's peak snow water equivalent, played day by day
//         (scripts/extreme-rainfall/snow_04_export_web.py)

type Kind = 'rain' | 'snow';
type Mode = 'running' | 'hourly';

interface AreaShare { sq_mi: number; percent: number }

interface RainEvent {
  year: number;
  rank: number;
  animated: boolean;
  mean_in: number;
  peak_point_in: number;
  peak_county: string | null;
  peak_near: { city: string; miles: number; direction: string };
  area_at_least_in: Record<string, AreaShare>;
  peak_x: number;
  peak_y: number;
  // Rain: the window and the statewide average of each hour.
  start_local: string;
  end_local: string;
  hourly_mean_in: number[];
  cold_share?: number;
  cold_threshold_f?: number;
  // Snow: the winter, its peak day, and the statewide average of each day.
  label: string;
  peak_date: string;
  series_start: string;
  peak_index: number;
  series_mean_in: number[];
  series_cover_percent: number[];
  cover_percent: number;
  snow_days: number;
  first_snow_date: string;
  last_snow_date: string;
}

interface RainData {
  kind?: Kind;
  region: string;
  duration_hours: number;
  steps_per_second?: number;
  first_year: number;
  last_year: number;
  timezone: string;
  median_in: number;
  grid: { width: number; height: number; total_code: number; hourly_code: number };
  scale: { total_max_in: number; hourly_max_in: number; total_ticks: number[]; hourly_ticks: number[]; linear?: boolean };
  palette: { lut: number[] };
  county_names: string[];
  events: RainEvent[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TABLE_SIZE = 1024;
const HOURS_PER_SECOND = 5;
const DAY_MS = 86_400_000;
const COLORS = {
  bar: '#74824b',
  top: '#ebc05c',
  line: '#74ecf9',
  hourly: '#518ffd',
  dot: '#f04a23',
  grid: 'rgba(255,255,255,0.09)',
  axis: '#939c78',
  text: '#f1f3e6',
};

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request for ${url} returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Some servers unpack .gz files on the way out, so check before unpacking.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack the map files.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function niceInches(value: number, digits = 1): string {
  return value.toFixed(digits);
}

// Daily snow grids are stored as the change from the day before. Adding them
// up in place (bytes wrap at 256) gives back one grid per day.
function addUpFrames(bytes: Uint8Array, cells: number): Uint8Array {
  for (let i = cells; i < bytes.length; i += 1) bytes[i] += bytes[i - cells];
  return bytes;
}

function utcDay(iso: string, offsetDays = 0): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + offsetDays * DAY_MS);
}

class RainfallDashboard {
  private root: HTMLElement;
  private data: RainData;
  private kind: Kind;
  private base: string;
  private byYear = new Map<number, RainEvent>();
  private selected!: RainEvent;

  // Map
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bufferCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  private outline: Path2D;
  private counties: Uint8Array | null = null;
  private totalTable: Uint32Array;
  private hourlyTable: Uint32Array;
  private totals = new Map<number, Uint8Array>();
  private frames = new Map<number, Uint8Array>();
  private pending = new Map<string, Promise<Uint8Array>>();
  private field: Float32Array;
  private fieldIsRate = false;
  private legendIsRate: boolean | null = null;
  private cumulative: Float32Array;
  private cumulativeHours = -1;
  private cumulativeYear = -1;
  private hourlyDecode: Float32Array;
  private totalDecode: Float32Array;

  // Player
  private position: number;
  private mode: Mode = 'running';
  private playing = false;
  private lastTick = 0;
  private raf = 0;
  private started = false;

  // Charts
  private annualBox: HTMLElement;
  private eventBox: HTMLElement;
  private eventGeometry: { x: (h: number) => number; y: (v: number) => number; curve: number[]; bottom: number } | null = null;
  private dot: SVGGElement | null = null;
  private hourBars: SVGRectElement[] = [];
  private activeBar = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    const source = root.querySelector<HTMLScriptElement>('[data-rain-data]');
    this.data = JSON.parse(source?.textContent ?? '{}') as RainData;
    this.base = (root.dataset.assetBase ?? '').replace(/\/$/, '');
    this.kind = this.data.kind === 'snow' ? 'snow' : 'rain';
    for (const event of this.data.events) this.byYear.set(event.year, event);
    this.position = 0;

    const { width, height, total_code, hourly_code } = this.data.grid;
    this.canvas = this.need<HTMLCanvasElement>('[data-map-canvas]');
    this.ctx = this.canvas.getContext('2d')!;
    this.buffer = document.createElement('canvas');
    this.buffer.width = width;
    this.buffer.height = height;
    this.bufferCtx = this.buffer.getContext('2d')!;
    this.image = this.bufferCtx.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.field = new Float32Array(width * height);
    this.cumulative = new Float32Array(width * height);
    this.outline = new Path2D(this.need<SVGPathElement>('[data-outline]').getAttribute('d') ?? '');

    this.totalTable = this.colorTable();
    this.hourlyTable = this.totalTable;
    this.totalDecode = new Float32Array(256);
    this.hourlyDecode = new Float32Array(256);
    for (let code = 0; code < 256; code += 1) {
      this.totalDecode[code] = (code / total_code) ** 2;
      this.hourlyDecode[code] = (code / hourly_code) ** 2;
    }

    this.annualBox = this.need('[data-annual-chart]');
    this.eventBox = this.need('[data-event-chart]');

    this.bindControls();
    this.drawLegend();

    const wanted = this.readHash();
    const first = this.byYear.get(wanted.year ?? -1) ?? this.data.events.find((e) => e.rank === 1)!;
    if (wanted.mode) this.mode = wanted.mode;
    this.select(first.year, false);
    if (wanted.step !== undefined && first.animated) {
      this.position = Math.max(0, Math.min(this.steps(first), wanted.step));
    }

    const resize = new ResizeObserver(() => this.layout());
    resize.observe(this.need('[data-map]'));
    resize.observe(this.annualBox);
    resize.observe(this.eventBox);

    // Map files are fetched once the dashboard is close to the viewport.
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          watcher.disconnect();
          this.start();
        }
      },
      { rootMargin: '600px' },
    );
    watcher.observe(root);
  }

  private need<T extends Element = HTMLElement>(selector: string): T {
    const node = this.root.querySelector<T>(selector);
    if (!node) throw new Error(`Dashboard is missing ${selector}`);
    return node;
  }

  // A link such as #storm=2010&hour=40&view=hourly or #winter=2019&day=60
  // opens that event part of the way through.
  private readHash(): { year?: number; step?: number; mode?: Mode } {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const year = Number(params.get(this.kind === 'snow' ? 'winter' : 'storm'));
    const step = params.get(this.kind === 'snow' ? 'day' : 'hour');
    const view = params.get('view');
    return {
      year: Number.isFinite(year) && year > 0 ? year : undefined,
      step: step === null ? undefined : Number(step),
      mode: this.kind === 'rain' && (view === 'hourly' || view === 'running') ? view : undefined,
    };
  }

  // Number of steps in an event: hours of a storm, or days of a winter.
  private steps(event: RainEvent): number {
    return this.kind === 'snow' ? event.series_mean_in.length - 1 : this.data.duration_hours;
  }

  // Where the player sits when nothing is playing: the end of a storm, or the peak day of a winter.
  private rest(event: RainEvent): number {
    return this.kind === 'snow' ? event.peak_index : this.data.duration_hours;
  }

  private atRest(): boolean {
    return Math.abs(this.position - this.rest(this.selected)) < 0.01;
  }

  private framesName(event: RainEvent): string {
    return `${this.kind === 'snow' ? 'daily' : 'hourly'}-${event.year}.bin.gz`;
  }

  private colorTable(): Uint32Array {
    const lut = this.data.palette.lut;
    const table = new Uint32Array(TABLE_SIZE);
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      const at = Math.min(255, Math.round((i / (TABLE_SIZE - 1)) * 255)) * 3;
      const r = lut[at];
      const g = lut[at + 1];
      const b = lut[at + 2];
      table[i] = littleEndian
        ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
        : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    }
    return table;
  }

  // ---------------------------------------------------------------- data

  private load(name: string): Promise<Uint8Array> {
    let request = this.pending.get(name);
    if (!request) {
      request = fetchBytes(`${this.base}/${name}`);
      this.pending.set(name, request);
      request.catch(() => this.pending.delete(name));
    }
    return request;
  }

  private async start(): Promise<void> {
    this.started = true;
    this.load('counties.bin.gz').then((bytes) => { this.counties = bytes; }).catch(() => undefined);
    await this.ensureEventData(this.selected);
    this.render();
    // Warm the cache for the other large events so their Play button responds at once.
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
      ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    idle(() => {
      for (const event of this.data.events) {
        if (event.animated && event.rank <= (this.kind === 'snow' ? 1 : 2)) this.load(this.framesName(event)).catch(() => undefined);
      }
    });
  }

  private async ensureEventData(event: RainEvent): Promise<void> {
    this.setStatus('');
    try {
      const jobs: Promise<unknown>[] = [];
      if (!this.totals.has(event.year)) {
        jobs.push(this.load(`total-${event.year}.bin.gz`).then((bytes) => this.totals.set(event.year, bytes)));
      }
      if (event.animated && !this.frames.has(event.year)) {
        const cells = this.field.length;
        jobs.push(this.load(this.framesName(event)).then((bytes) => {
          if (this.frames.has(event.year)) return;
          this.frames.set(event.year, this.kind === 'snow' ? addUpFrames(bytes, cells) : bytes);
        }));
      }
      if (jobs.length) {
        this.root.dataset.loading = 'true';
        await Promise.all(jobs);
      }
    } catch (error) {
      this.setStatus(`The map for ${event.year} could not be loaded. ${error instanceof Error ? error.message : ''}`);
    } finally {
      delete this.root.dataset.loading;
    }
  }

  private setStatus(message: string): void {
    const status = this.need('[data-status]');
    status.textContent = message;
    status.hidden = !message;
  }

  // ------------------------------------------------------------- controls

  private bindControls(): void {
    const play = this.need<HTMLButtonElement>('[data-play]');
    play.addEventListener('click', () => this.togglePlay());

    const scrub = this.need<HTMLInputElement>('[data-scrub]');
    scrub.addEventListener('input', () => {
      this.pause();
      this.position = Number(scrub.value);
      this.render();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.mode = button.dataset.mode as Mode;
        // Hourly rain at the last hour says little, so start the storm over.
        if (this.mode === 'hourly' && this.position >= this.steps(this.selected) && !this.playing) {
          this.position = 0;
          this.play();
        }
        this.syncControls();
        this.render();
      });
    });

    this.root.querySelector<HTMLButtonElement>('[data-rest]')?.addEventListener('click', () => {
      this.pause();
      this.position = this.rest(this.selected);
      this.render();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((button) => {
      button.addEventListener('click', () => this.select(Number(button.dataset.pick)));
    });

    const full = this.root.querySelector<HTMLButtonElement>('[data-fullscreen]');
    if (full) {
      if (!document.fullscreenEnabled) full.hidden = true;
      full.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else this.root.requestFullscreen().catch(() => undefined);
      });
      document.addEventListener('fullscreenchange', () => {
        const on = document.fullscreenElement === this.root;
        full.setAttribute('aria-pressed', String(on));
        full.querySelector('[data-fullscreen-label]')!.textContent = on ? 'Exit full screen' : 'Full screen';
      });
    }

    const map = this.need('[data-map]');
    map.addEventListener('pointermove', (event) => this.hover(event as PointerEvent));
    map.addEventListener('pointerleave', () => { this.need('[data-tip]').hidden = true; });

    this.annualBox.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      event.preventDefault();
      const next = this.selected.year + (key === 'ArrowRight' ? 1 : -1);
      if (this.byYear.has(next)) this.select(next);
    });
  }

  private syncControls(): void {
    const event = this.selected;
    const hours = this.steps(event);
    const play = this.need<HTMLButtonElement>('[data-play]');
    const label = play.querySelector<HTMLElement>('[data-play-label]')!;
    const fresh = this.position >= hours || this.atRest();
    play.dataset.state = this.playing ? 'playing' : 'paused';
    label.textContent = this.playing ? 'Pause' : !fresh ? 'Resume' : this.kind === 'snow' ? 'Play the winter' : 'Play the storm';
    const rest = this.root.querySelector<HTMLButtonElement>('[data-rest]');
    if (rest) rest.disabled = this.atRest() && !this.playing;
    this.need('[data-player]').hidden = !event.animated;
    this.need('[data-no-player]').hidden = event.animated;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.pick) === event.year));
    });
    const scrub = this.need<HTMLInputElement>('[data-scrub]');
    scrub.max = String(hours);
    scrub.value = String(this.position);
    scrub.style.setProperty('--fill', `${(this.position / hours) * 100}%`);
  }

  // ------------------------------------------------------------ selection

  async select(year: number, scrollPick = true): Promise<void> {
    const event = this.byYear.get(year);
    if (!event) return;
    this.pause();
    this.selected = event;
    this.position = this.rest(event);
    this.cumulativeHours = -1;
    this.describe();
    this.drawLegend();
    this.drawAnnual();
    this.drawEvent();
    this.syncControls();
    if (scrollPick) {
      this.root.querySelector<HTMLElement>(`[data-pick="${year}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (this.started) {
      await this.ensureEventData(event);
      if (this.selected === event) this.render();
    }
  }

  private formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-US', { timeZone: this.data.timezone, ...options });
  }

  private instant(event: RainEvent, hour: number): Date {
    return new Date(new Date(event.start_local).getTime() + hour * 3600_000);
  }

  // Snow dates carry no clock time, so they are formatted in UTC to keep the calendar day.
  private dayText(date: Date, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
  }

  // One line that says when the event was, for tooltips and labels.
  private when(event: RainEvent): string {
    return this.kind === 'snow' ? `Peak on ${this.dayText(utcDay(event.peak_date))}` : this.dateRange(event);
  }

  private dateRange(event: RainEvent): string {
    const start = this.instant(event, 0);
    // A window that ends at midnight belongs to the day before.
    const end = new Date(this.instant(event, this.data.duration_hours).getTime() - 1000);
    const month = this.formatter({ month: 'long' });
    const day = this.formatter({ day: 'numeric' });
    const sameMonth = month.format(start) === month.format(end);
    const tail = sameMonth ? day.format(end) : `${month.format(end)} ${day.format(end)}`;
    return `${month.format(start)} ${day.format(start)} to ${tail}, ${event.year}`;
  }

  private describe(): void {
    const event = this.selected;
    const count = this.data.events.length;
    const two = event.area_at_least_in['2'];
    const near = event.peak_near;
    const where = near.miles < 4 ? `at ${near.city}` : `${Math.round(near.miles)} mi ${near.direction} of ${near.city}`;
    let tiles: Record<string, [string, string]>;
    if (this.kind === 'snow') {
      this.need('[data-event-title]').textContent = `Winter of ${event.label}`;
      this.need('[data-event-rank]').textContent = `Ranked ${event.rank} of ${count} winters`;
      this.need('[data-event-window]').textContent = this.when(event);
      const short = { month: 'short', day: 'numeric' } as const;
      const span = `${this.dayText(utcDay(event.first_snow_date), short)} to ${this.dayText(utcDay(event.last_snow_date), short)}`;
      tiles = {
        mean: [`${niceInches(event.mean_in, 2)} in`, 'Statewide average snow water equivalent on the peak day'],
        peak: [`${niceInches(event.peak_point_in)} in`, `Deepest spot, ${where}`],
        area: [`${two ? Math.round(two.percent) : 0}%`, 'Of the state held 2 inches or more'],
        season: [`${event.snow_days} days`, `With snow on the ground statewide, ${span}`],
      };
    } else {
      const stamp = this.formatter({ weekday: 'short', hour: 'numeric', timeZoneName: 'short' });
      this.need('[data-event-title]').textContent = this.dateRange(event);
      this.need('[data-event-rank]').textContent = `Ranked ${event.rank} of ${count} years`;
      this.need('[data-event-window]').textContent =
        `${stamp.format(this.instant(event, 0))} to ${stamp.format(this.instant(event, this.data.duration_hours))}`;
      tiles = {
        mean: [`${niceInches(event.mean_in, 2)} in`, 'Statewide average'],
        peak: [`${niceInches(event.peak_point_in)} in`, `Heaviest spot, ${where}`],
        area: [`${two ? Math.round(two.percent) : 0}%`, 'Of the state got 2 inches or more'],
      };
    }
    for (const [key, [value, caption]] of Object.entries(tiles)) {
      const tile = this.need(`[data-tile="${key}"]`);
      tile.querySelector('[data-value]')!.textContent = value;
      tile.querySelector('[data-caption]')!.textContent = caption;
    }

    const cold = this.need('[data-cold-note]');
    const share = this.kind === 'rain' ? event.cold_share ?? 0 : 0;
    cold.hidden = share < 0.1;
    if (share >= 0.1) {
      cold.textContent =
        `About ${Math.round(share * 100)}% of this fell while the air was at or below ${event.cold_threshold_f ?? 34}°F, ` +
        'so part of it came as snow or ice. Amounts are shown as melted water.';
    }

    this.placePeak(event.peak_x, event.peak_y, event.peak_point_in);
  }

  // Put the marker for the largest value on the map, in grid coordinates.
  private placePeak(x: number, y: number, inchesAt: number): void {
    const peak = this.need('[data-peak]');
    const { width, height } = this.data.grid;
    peak.style.left = `${(x / width) * 100}%`;
    peak.style.top = `${(y / height) * 100}%`;
    peak.dataset.side = x > width * 0.62 ? 'left' : 'right';
    peak.querySelector('[data-peak-label]')!.textContent = `${niceInches(inchesAt)} in`;
  }

  // The cell inside the state with the largest value on the map as drawn.
  private deepest(): { x: number; y: number; value: number } | null {
    const inside = this.counties;
    if (!inside) return null;
    let best = -1;
    let at = -1;
    for (let i = 0; i < this.field.length; i += 1) {
      if (inside[i] !== 0 && this.field[i] > best) {
        best = this.field[i];
        at = i;
      }
    }
    if (at < 0) return null;
    const { width } = this.data.grid;
    return { x: (at % width) + 0.5, y: Math.floor(at / width) + 0.5, value: best };
  }

  // ------------------------------------------------------------------ map

  private layout(): void {
    const box = this.need('[data-map]').getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(box.width * ratio));
    const h = Math.max(1, Math.round(box.height * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.render();
    this.drawAnnual();
    this.drawEvent();
  }

  private fillField(): boolean {
    const event = this.selected;
    const hours = this.steps(event);
    const cells = this.field.length;
    const frames = this.frames.get(event.year);

    if (this.kind === 'snow' && event.animated && frames) {
      // Each grid is the snowpack of one day. Blend the two days around the position.
      const day = Math.min(hours, Math.max(0, Math.floor(this.position)));
      const next = Math.min(hours, day + 1);
      const blend = Math.min(1, Math.max(0, this.position - day));
      const decode = this.hourlyDecode;
      const from = frames.subarray(day * cells, (day + 1) * cells);
      const to = frames.subarray(next * cells, (next + 1) * cells);
      for (let i = 0; i < cells; i += 1) {
        const a = decode[from[i]];
        this.field[i] = a + (decode[to[i]] - a) * blend;
      }
      this.fieldIsRate = false;
      return true;
    }

    // At the end of the window the map always shows the event total.
    const moving = this.kind === 'rain' && event.animated && frames && this.position < hours;

    if (!moving) {
      const total = this.totals.get(event.year);
      if (!total) return false;
      for (let i = 0; i < cells; i += 1) this.field[i] = this.totalDecode[total[i]];
      this.fieldIsRate = false;
      return true;
    }

    const whole = Math.min(hours - 1, Math.floor(this.position));
    const part = Math.min(1, this.position - whole);
    const decode = this.hourlyDecode;
    const current = frames.subarray(whole * cells, (whole + 1) * cells);

    if (this.mode === 'hourly') {
      const before = whole > 0 ? frames.subarray((whole - 1) * cells, whole * cells) : null;
      for (let i = 0; i < cells; i += 1) {
        const from = before ? decode[before[i]] : 0;
        this.field[i] = from + (decode[current[i]] - from) * part;
      }
      this.fieldIsRate = true;
      return true;
    }

    if (this.cumulativeYear !== event.year || this.cumulativeHours > whole || this.cumulativeHours < 0) {
      this.cumulative.fill(0);
      this.cumulativeHours = 0;
      this.cumulativeYear = event.year;
    }
    while (this.cumulativeHours < whole) {
      const frame = frames.subarray(this.cumulativeHours * cells, (this.cumulativeHours + 1) * cells);
      for (let i = 0; i < cells; i += 1) this.cumulative[i] += decode[frame[i]];
      this.cumulativeHours += 1;
    }
    for (let i = 0; i < cells; i += 1) this.field[i] = this.cumulative[i] + decode[current[i]] * part;
    this.fieldIsRate = false;
    return true;
  }

  private render(): void {
    const { width, height } = this.data.grid;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ready = this.fillField();
    ctx.save();
    ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
    ctx.clip(this.outline);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const zero = this.totalTable[0];
    ctx.fillStyle = `rgb(${zero & 255}, ${(zero >> 8) & 255}, ${(zero >> 16) & 255})`;
    ctx.fillRect(0, 0, w, h);
    if (ready) {
      const table = this.fieldIsRate ? this.hourlyTable : this.totalTable;
      const top = this.fieldIsRate ? this.data.scale.hourly_max_in : this.data.scale.total_max_in;
      const last = TABLE_SIZE - 1;
      const cells = this.field.length;
      // Colors follow the square root of the depth, or the depth itself when the scale is linear.
      const linear = this.data.scale.linear === true;
      for (let i = 0; i < cells; i += 1) {
        const value = this.field[i];
        const index = value <= 0 ? 0 : (linear ? value / top : Math.sqrt(value / top)) * last;
        this.pixels[i] = table[index >= last ? last : index | 0];
      }
      this.bufferCtx.putImageData(this.image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.buffer, 0, 0, w, h);
    }
    ctx.restore();

    if (this.legendIsRate !== this.fieldIsRate) this.drawLegend();
    this.syncClock();
    this.syncPlayhead();
    this.syncControls();
  }

  private syncClock(): void {
    const event = this.selected;
    const hours = this.steps(event);
    const clock = this.need('[data-clock]');
    const peak = this.need('[data-peak]');
    if (this.kind === 'snow') {
      const still = !event.animated || !this.frames.has(event.year);
      const position = still ? event.peak_index : this.position;
      const day = Math.min(hours, Math.max(0, Math.round(position)));
      const offset = day - event.peak_index;
      const atPeak = Math.abs(position - event.peak_index) < 0.5;
      // The deepest spot stays on the map through the winter. On the peak day
      // it is the one measured on the full grid, and on other days it is read
      // from the map as drawn.
      if (still || (this.atRest() && !this.playing)) {
        this.placePeak(event.peak_x, event.peak_y, event.peak_point_in);
        peak.hidden = false;
      } else {
        const spot = this.deepest();
        peak.hidden = !spot || spot.value < 0.1;
        if (spot && spot.value >= 0.1) this.placePeak(spot.x, spot.y, spot.value);
      }
      const cover = Math.round(atPeak ? event.cover_percent : event.series_cover_percent[day] ?? 0);
      const days = Math.abs(offset) === 1 ? 'day' : 'days';
      const stage = atPeak ? 'Peak of the winter' : `${Math.abs(offset)} ${days} ${offset < 0 ? 'before' : 'after'} the peak`;
      clock.querySelector('[data-clock-main]')!.textContent =
        this.dayText(utcDay(event.series_start, day), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      clock.querySelector('[data-clock-sub]')!.textContent = `${stage} · ${cover}% of the state snow covered`;
      return;
    }
    const moving = event.animated && this.frames.has(event.year) && this.position < hours;
    peak.hidden = moving;
    if (!moving) {
      clock.querySelector('[data-clock-main]')!.textContent = `${hours}-hour total`;
      clock.querySelector('[data-clock-sub]')!.textContent = this.dateRange(event);
      return;
    }
    const stamp = this.formatter({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short' });
    const hour = Math.min(hours, Math.max(1, Math.ceil(this.position)));
    clock.querySelector('[data-clock-main]')!.textContent = stamp.format(this.instant(event, this.position));
    clock.querySelector('[data-clock-sub]')!.textContent =
      `${this.mode === 'hourly' ? 'Past hour' : 'Total so far'} · hour ${hour} of ${hours}`;
  }

  private hover(pointer: PointerEvent): void {
    const tip = this.need('[data-tip]');
    const map = this.need('[data-map]');
    const box = map.getBoundingClientRect();
    const { width, height } = this.data.grid;
    const gx = Math.floor(((pointer.clientX - box.left) / box.width) * width);
    const gy = Math.floor(((pointer.clientY - box.top) / box.height) * height);
    const cell = gy * width + gx;
    const county = this.counties && gx >= 0 && gy >= 0 && gx < width && gy < height ? this.counties[cell] : 0;
    if (!county) {
      tip.hidden = true;
      return;
    }
    const value = this.field[cell];
    const name = county <= this.data.county_names.length ? `${this.data.county_names[county - 1]} County` : '';
    tip.querySelector('[data-tip-value]')!.textContent =
      `${niceInches(value, value < 1 ? 2 : 1)} ${this.fieldIsRate ? 'in per hour' : 'in'}`;
    tip.querySelector('[data-tip-place]')!.textContent = name;
    tip.hidden = false;
    const x = pointer.clientX - box.left;
    const y = pointer.clientY - box.top;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.dataset.side = x > box.width * 0.6 ? 'left' : 'right';
  }

  private drawLegend(): void {
    const rate = this.fieldIsRate;
    this.legendIsRate = rate;
    const canvas = this.need<HTMLCanvasElement>('[data-legend]');
    const ctx = canvas.getContext('2d')!;
    const table = this.totalTable;
    for (let x = 0; x < canvas.width; x += 1) {
      const color = table[Math.round((x / (canvas.width - 1)) * (TABLE_SIZE - 1))];
      ctx.fillStyle = `rgb(${color & 255}, ${(color >> 8) & 255}, ${(color >> 16) & 255})`;
      ctx.fillRect(x, 0, 1, canvas.height);
    }
    const top = rate ? this.data.scale.hourly_max_in : this.data.scale.total_max_in;
    const ticks = rate ? this.data.scale.hourly_ticks : this.data.scale.total_ticks;
    const holder = this.need('[data-legend-ticks]');
    holder.replaceChildren();
    for (const tick of ticks) {
      const mark = document.createElement('span');
      mark.style.left = `${(this.data.scale.linear ? tick / top : Math.sqrt(tick / top)) * 100}%`;
      mark.textContent = tick >= top ? `${tick}+` : String(tick);
      holder.append(mark);
    }
    const what = (this.selected?.cold_share ?? 0) >= 0.1 ? 'rain and melted snow' : 'rain';
    this.need('[data-legend-title]').textContent = this.kind === 'snow'
      ? 'Snow water equivalent, inches'
      : rate ? `Inches of ${what} in one hour` : `Inches of ${what}`;
    this.root.dataset.legend = rate ? 'rate' : 'total';
  }

  // --------------------------------------------------------------- player

  private togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private async play(): Promise<void> {
    const event = this.selected;
    if (!event.animated) return;
    if (!this.frames.has(event.year)) {
      this.started = true;
      await this.ensureEventData(event);
      if (!this.frames.has(event.year) || this.selected !== event) return;
    }
    if (this.position >= this.steps(event) || this.atRest()) this.position = 0;
    this.playing = true;
    this.lastTick = 0;
    this.syncControls();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  private pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if (this.selected) this.syncControls();
  }

  private tick(now: number): void {
    if (!this.playing) return;
    const elapsed = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const end = this.steps(this.selected);
    this.position += elapsed * (this.data.steps_per_second ?? HOURS_PER_SECOND);
    if (this.position >= end) {
      this.position = end;
      this.playing = false;
    }
    this.render();
    if (this.playing) this.raf = requestAnimationFrame((next) => this.tick(next));
  }

  // --------------------------------------------------------------- charts

  private drawAnnual(): void {
    const box = this.annualBox;
    const width = Math.max(280, box.clientWidth);
    const height = Math.max(150, box.clientHeight);
    const margin = { left: 38, right: 10, top: 18, bottom: 26 };
    const events = [...this.data.events].sort((a, b) => a.year - b.year);
    const top = Math.ceil(Math.max(...events.map((e) => e.mean_in)) * 2) / 2;
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const band = plotW / events.length;
    const barW = Math.max(2, band * 0.72);
    const y = (value: number) => margin.top + plotH * (1 - value / top);

    const tip = this.need('[data-annual-tip]');
    tip.hidden = true;
    const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
    const snow = this.kind === 'snow';
    chart.setAttribute(
      'aria-label',
      snow
        ? `Bar chart of the largest statewide average snow water equivalent in each winter from ${this.data.first_year} to ${this.data.last_year}`
        : `Bar chart of the largest ${this.data.duration_hours}-hour statewide average rainfall in each year from ${this.data.first_year} to ${this.data.last_year}`,
    );

    for (let tick = 0; tick <= top + 1e-9; tick += top > 3 ? 1 : 0.5) {
      chart.append(svg('line', { x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick), stroke: COLORS.grid }));
      chart.append(svg('text', { x: margin.left - 6, y: y(tick) + 4, 'text-anchor': 'end', class: 'rd-axis' }, tick === 0 ? '0' : `${tick} in`));
    }

    const median = this.data.median_in;
    chart.append(svg('line', {
      x1: margin.left, x2: width - margin.right, y1: y(median), y2: y(median),
      stroke: COLORS.axis, 'stroke-dasharray': '4 4', 'stroke-width': 1,
    }));

    events.forEach((event, index) => {
      const x = margin.left + band * index + (band - barW) / 2;
      const isSelected = event.year === this.selected.year;
      const bar = svg('rect', {
        x, y: y(event.mean_in), width: barW, height: Math.max(1, y(0) - y(event.mean_in)),
        rx: Math.min(2, barW / 3),
        fill: event.animated ? COLORS.top : COLORS.bar,
        class: `rd-bar${isSelected ? ' is-selected' : ''}`,
      });
      chart.append(bar);
      // A full-height strip makes short bars easy to hit.
      const hit = svg('rect', { x: margin.left + band * index, y: margin.top, width: band, height: plotH, fill: 'transparent', class: 'rd-hit' });
      const name = snow ? `Winter of ${event.label}` : String(event.year);
      hit.setAttribute('aria-label', `${name}: ${niceInches(event.mean_in, 2)} inches, ${this.when(event)}`);
      hit.addEventListener('click', () => this.select(event.year));
      hit.addEventListener('pointerenter', () => {
        bar.classList.add('is-hover');
        tip.querySelector('[data-annual-tip-value]')!.textContent = `${name}: ${niceInches(event.mean_in, 2)} in`;
        tip.querySelector('[data-annual-tip-date]')!.textContent = `${this.when(event)} · rank ${event.rank}`;
        tip.style.left = `${x + barW / 2}px`;
        tip.style.top = `${y(event.mean_in)}px`;
        tip.dataset.side = index < 4 ? 'right' : index > events.length - 5 ? 'left' : 'center';
        tip.hidden = false;
      });
      hit.addEventListener('pointerleave', () => {
        bar.classList.remove('is-hover');
        tip.hidden = true;
      });
      chart.append(hit);

      if (event.animated && band > 9) {
        chart.append(svg('text', { x: x + barW / 2, y: y(event.mean_in) - 4, 'text-anchor': 'middle', class: 'rd-rank' }, String(event.rank)));
      }
      if (isSelected) {
        chart.append(svg('path', {
          d: `M${x + barW / 2 - 4},${height}l4,-5l4,5z`, fill: COLORS.text,
        }));
      }
      const step = band < 13 ? 10 : 5;
      if (event.year % step === 0) {
        chart.append(svg('text', { x: x + barW / 2, y: height - 11, 'text-anchor': 'middle', class: 'rd-axis' }, String(event.year)));
      }
    });

    // Drawn last so the label stays readable on top of the bars.
    // It sits over the first run of bars that stay below the line, or over the lowest run.
    const under = Math.min(events.length, Math.ceil(130 / band));
    let spot = 0;
    let lowest = Infinity;
    for (let first = 0; first + under <= events.length; first += 1) {
      const tallest = Math.max(...events.slice(first, first + under).map((e) => e.mean_in));
      if (tallest < lowest) {
        lowest = tallest;
        spot = first;
      }
      if (tallest < median) break;
    }
    chart.append(svg('text', { x: margin.left + band * spot + 5, y: y(median) - 5, class: 'rd-axis rd-halo' },
      `Median ${snow ? 'winter' : 'year'}, ${niceInches(median, 2)} in`));

    box.replaceChildren(chart);
  }

  private drawEvent(): void {
    const event = this.selected;
    const box = this.eventBox;
    const snow = this.kind === 'snow';
    const hours = this.steps(event);
    const width = Math.max(260, box.clientWidth);
    const height = Math.max(210, box.clientHeight);
    const margin = { left: 40, right: 16, top: 16, bottom: 26 };
    // Rain has a second, smaller panel under the line for the hourly amounts.
    const gap = snow ? 0 : 16;
    const plotW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom - gap;
    const upperH = snow ? innerH : innerH * 0.66;
    const lowerH = innerH - upperH;
    const lowerTop = margin.top + upperH + gap;

    let curve: number[];
    if (snow) {
      curve = event.series_mean_in;
    } else {
      curve = [0];
      for (const value of event.hourly_mean_in) curve.push(curve[curve.length - 1] + value);
    }
    const topTotal = Math.max(0.5, Math.ceil(Math.max(...curve) * 2 + 0.2) / 2);
    const x = (hour: number) => margin.left + (plotW * hour) / hours;
    const y = (value: number) => margin.top + upperH * (1 - value / topTotal);

    const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
    chart.setAttribute('aria-label', snow
      ? `Statewide average snow water equivalent day by day for the winter of ${event.label}`
      : `Statewide average rainfall hour by hour for ${this.dateRange(event)}`);

    for (let tick = 0; tick <= topTotal + 1e-9; tick += topTotal > 2 ? 1 : 0.5) {
      chart.append(svg('line', { x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick), stroke: COLORS.grid }));
      chart.append(svg('text', { x: margin.left - 6, y: y(tick) + 4, 'text-anchor': 'end', class: 'rd-axis' }, tick === 0 ? '0' : `${tick} in`));
    }

    if (snow) {
      // A mark at the first of each month, with the month under the stretch that follows.
      const first = utcDay(event.series_start);
      const edges = [0];
      for (let day = 1; day < hours; day += 1) {
        if (new Date(first.getTime() + day * DAY_MS).getUTCDate() === 1) edges.push(day);
      }
      edges.push(hours);
      for (let i = 0; i < edges.length - 1; i += 1) {
        const from = edges[i];
        const to = edges[i + 1];
        if (i > 0) {
          chart.append(svg('line', { x1: x(from), x2: x(from), y1: margin.top, y2: margin.top + upperH, stroke: COLORS.grid, 'stroke-dasharray': '2 3' }));
        }
        if (x(to) - x(from) < 26) continue;
        chart.append(svg('text', { x: (x(from) + x(to)) / 2, y: height - 8, 'text-anchor': 'middle', class: 'rd-axis' },
          this.dayText(utcDay(event.series_start, Math.floor((from + to) / 2)), { month: 'short' })));
      }
      this.hourBars = [];
    } else {
      const topHour = Math.max(0.05, Math.ceil(Math.max(...event.hourly_mean_in) * 20) / 20);
      const yHour = (value: number) => lowerTop + lowerH * (1 - value / topHour);
      chart.append(svg('line', { x1: margin.left, x2: width - margin.right, y1: yHour(0), y2: yHour(0), stroke: COLORS.grid }));
      chart.append(svg('text', { x: margin.left - 6, y: yHour(topHour) + 8, 'text-anchor': 'end', class: 'rd-axis' }, `${topHour.toFixed(2)}`));
      chart.append(svg('text', { x: margin.left + 4, y: lowerTop + 10, class: 'rd-panel-label' }, 'Each hour (inches)'));

      // Day marks at local midnight, with the weekday under each day.
      const hourOf = this.formatter({ hour: 'numeric', hourCycle: 'h23' });
      const dayLabel = this.formatter({ weekday: 'short', month: 'short', day: 'numeric' });
      const midnights: number[] = [];
      for (let hour = 0; hour <= hours; hour += 1) {
        if (Number(hourOf.format(this.instant(event, hour))) === 0) midnights.push(hour);
      }
      for (const hour of midnights) {
        chart.append(svg('line', { x1: x(hour), x2: x(hour), y1: margin.top, y2: lowerTop + lowerH, stroke: COLORS.grid, 'stroke-dasharray': '2 3' }));
      }
      const edges = [0, ...midnights.filter((hour) => hour > 0 && hour < hours), hours];
      for (let i = 0; i < edges.length - 1; i += 1) {
        const from = edges[i];
        const to = edges[i + 1];
        if (x(to) - x(from) < 58) continue;
        chart.append(svg('text', { x: (x(from) + x(to)) / 2, y: height - 8, 'text-anchor': 'middle', class: 'rd-axis' },
          dayLabel.format(this.instant(event, (from + to) / 2))));
      }

      const barW = Math.max(1, plotW / hours - 1);
      this.hourBars = event.hourly_mean_in.map((value, hour) => {
        const bar = svg('rect', {
          x: x(hour) + 0.5, y: yHour(value), width: barW, height: Math.max(0, yHour(0) - yHour(value)),
          fill: COLORS.hourly, class: 'rd-hour',
        });
        chart.append(bar);
        return bar;
      });
    }
    this.activeBar = -1;

    const points = curve.map((value, hour) => `${x(hour).toFixed(1)},${y(value).toFixed(1)}`);
    chart.append(svg('path', {
      d: `M${points.join('L')}L${x(hours)},${y(0)}L${x(0)},${y(0)}Z`, fill: COLORS.line, opacity: 0.1,
    }));
    chart.append(svg('path', { d: `M${points.join('L')}`, fill: 'none', stroke: COLORS.line, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    // Drawn after the line so the label stays readable where the two meet.
    chart.append(svg('text', { x: margin.left + 4, y: margin.top + 10, class: 'rd-panel-label rd-halo-strong' },
      snow ? 'Statewide average snow water equivalent' : 'Statewide average, running total'));

    const dot = svg('g', { class: 'rd-dot' });
    dot.append(svg('line', { x1: 0, x2: 0, y1: 0, y2: 0, stroke: COLORS.dot, 'stroke-width': 1, opacity: 0.6, 'data-stem': '' }));
    dot.append(svg('circle', { r: 9, fill: COLORS.dot, opacity: 0.25 }));
    dot.append(svg('circle', { r: 5, fill: COLORS.dot, stroke: '#fff', 'stroke-width': 1.5 }));
    dot.append(svg('text', { y: -13, 'text-anchor': 'middle', class: 'rd-dot-label' }, ''));
    chart.append(dot);
    this.dot = dot;
    this.eventGeometry = { x, y, curve, bottom: lowerTop + lowerH };

    if (event.animated) {
      const seek = (pointer: PointerEvent) => {
        const bounds = chart.getBoundingClientRect();
        const ratio = (pointer.clientX - bounds.left - margin.left) / plotW;
        this.pause();
        this.position = Math.max(0, Math.min(hours, ratio * hours));
        this.render();
      };
      chart.classList.add('is-seekable');
      chart.addEventListener('pointerdown', (pointer) => {
        chart.setPointerCapture(pointer.pointerId);
        seek(pointer);
      });
      chart.addEventListener('pointermove', (pointer) => { if (pointer.buttons) seek(pointer); });
    }

    box.replaceChildren(chart);
    this.syncPlayhead();
  }

  private syncPlayhead(): void {
    const geometry = this.eventGeometry;
    if (!geometry || !this.dot) return;
    const hours = this.steps(this.selected);
    const position = Math.max(0, Math.min(hours, this.position));
    const whole = Math.min(hours - 1, Math.floor(position));
    const value = geometry.curve[whole] + (geometry.curve[whole + 1] - geometry.curve[whole]) * (position - whole);
    const px = geometry.x(position);
    const py = geometry.y(value);
    this.dot.setAttribute('transform', `translate(${px.toFixed(1)},${py.toFixed(1)})`);
    const stem = this.dot.querySelector('[data-stem]')!;
    stem.setAttribute('y2', String(geometry.bottom - py));
    const label = this.dot.querySelector('text')!;
    label.textContent = `${niceInches(value, 2)} in`;
    label.setAttribute('text-anchor', position > hours * 0.86 ? 'end' : position < hours * 0.1 ? 'start' : 'middle');

    const active = position >= hours ? -1 : whole;
    if (active !== this.activeBar) {
      this.hourBars[this.activeBar]?.classList.remove('is-now');
      this.hourBars[active]?.classList.add('is-now');
      this.activeBar = active;
    }
  }
}

const dashboards = new WeakMap<HTMLElement, RainfallDashboard>();

function boot(): void {
  document.querySelectorAll<HTMLElement>('[data-rain-dashboard]:not([data-ready])').forEach((root) => {
    root.dataset.ready = 'true';
    try {
      dashboards.set(root, new RainfallDashboard(root));
    } catch (error) {
      console.error(error);
      root.dataset.failed = 'true';
    }
  });
}

// Links in the text marked with data-storm="YEAR" open that year in the rain
// dashboard, and links marked with data-winter="YEAR" open that winter in the snow one.
document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest<HTMLElement>('[data-storm], [data-winter]');
  if (!link) return;
  const kind: Kind = link.dataset.winter ? 'snow' : 'rain';
  const root = document.querySelector<HTMLElement>(`[data-rain-dashboard][data-kind="${kind}"][data-ready]`);
  const dashboard = root ? dashboards.get(root) : undefined;
  if (!root || !dashboard) return;
  event.preventDefault();
  dashboard.select(Number(link.dataset.winter ?? link.dataset.storm));
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.addEventListener('astro:page-load', boot);
boot();
