#!/usr/bin/env node

/**
 * Build the static data snapshots used by the six Mendenhall River GLOF charts.
 *
 * The browser never calls USGS. This script retrieves and validates the public
 * records once, then writes compact JSON files under public/blog/glof/data/.
 * Run with `node scripts/glof/build-data.mjs`; pass `--refresh` to ignore the
 * temporary raw-response cache and retrieve every request again.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public', 'blog', 'glof', 'data');
const CACHE_DIR = path.join(tmpdir(), 'hydromohsen-glof-usgs-2026-09-05');

const SNAPSHOT_DATE = '2026-09-05';
const ALASKA_TIME_ZONE = 'America/Juneau';
const RIVER_SITE = '15052500';
const BASIN_SITE = '1505248590';
const DISCHARGE = '00060';
const STAGE = '00065';
const BASIN_ELEVATION = '00062';
const REFRESH = process.argv.includes('--refresh');

const IV_ENDPOINT = 'https://waterservices.usgs.gov/nwis/iv/';
const OGC_CONTINUOUS_ENDPOINT = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items';
const PEAK_ENDPOINT = 'https://nwis.waterdata.usgs.gov/ak/nwis/peak';
const SOURCE_NAME = 'U.S. Geological Survey National Water Information System';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const alaskaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ALASKA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

function assert(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`);
}

function sameNumber(actual, expected, message) {
  assert(Number(actual) === Number(expected), `${message}; expected ${expected}, received ${actual}`);
}

function alaskaIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  assert(!Number.isNaN(date.valueOf()), `invalid timestamp ${value}`);

  const parts = Object.fromEntries(
    alaskaFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName.replace('GMT', '') || '+00:00';
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}${offset}`;
}

function localDate(point) {
  return point.local.slice(0, 10);
}

function localClock(point) {
  return point.local.slice(11, 16);
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cachePathFor(url) {
  const key = createHash('sha256').update(url).digest('hex');
  return path.join(CACHE_DIR, `${key}.txt`);
}

async function fetchText(url, label) {
  const cachePath = cachePathFor(url);
  if (!REFRESH) {
    try {
      const cached = await readFile(cachePath, 'utf8');
      console.log(`[cache] ${label}`);
      return cached;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  const attempts = 6;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      console.log(`[fetch ${attempt}/${attempts}] ${label}`);
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
          'user-agent': 'hydromohsen-glof-snapshot/2026-09-05',
        },
        signal: controller.signal,
      });
      const body = await response.text();

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        error.retryable = retryableStatuses.has(response.status);
        throw error;
      }

      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, body, 'utf8');
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || error.retryable !== false;
      if (!retryable || attempt === attempts) break;
      const delay = Math.min(1_000 * 2 ** (attempt - 1), 16_000) + attempt * 137;
      console.warn(`[retry in ${delay} ms] ${label}: ${error.message}`);
      await sleep(delay);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Unable to retrieve ${label} after ${attempts} attempts: ${lastError?.message}`);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

function instantaneousUrl(site, parameterCodes, startDate, endDate) {
  const params = new URLSearchParams({
    format: 'json',
    sites: site,
    parameterCd: parameterCodes.join(','),
    startDT: startDate,
    endDT: endDate,
    siteStatus: 'all',
  });
  return `${IV_ENDPOINT}?${params}`;
}

function approvalFromQualifiers(qualifiers) {
  return qualifiers.includes('P') ? 'Provisional' : 'Approved';
}

function parseInstantaneousPayload(text, expectedSite) {
  const payload = JSON.parse(text);
  const byCode = new Map();

  for (const timeSeries of payload?.value?.timeSeries ?? []) {
    const site = timeSeries?.sourceInfo?.siteCode?.[0]?.value;
    if (site !== expectedSite) continue;
    const code = timeSeries?.variable?.variableCode?.[0]?.value;
    if (!code) continue;
    const noData = Number(timeSeries?.variable?.noDataValue ?? -999999);
    const destination = byCode.get(code) ?? [];

    for (const block of timeSeries.values ?? []) {
      for (const observation of block.value ?? []) {
        const value = Number(observation.value);
        if (!Number.isFinite(value) || value === noData) continue;
        const qualifiers = [...(observation.qualifiers ?? [])];
        const instant = new Date(observation.dateTime);
        destination.push({
          ms: instant.valueOf(),
          utc: instant.toISOString(),
          local: alaskaIso(instant),
          value,
          status: approvalFromQualifiers(qualifiers),
          qualifiers,
        });
      }
    }

    byCode.set(code, destination);
  }

  return byCode;
}

function deduplicateAndSort(points) {
  const byInstant = new Map();
  for (const point of points) {
    const existing = byInstant.get(point.ms);
    if (!existing || (existing.status === 'Approved' && point.status === 'Provisional')) {
      byInstant.set(point.ms, point);
    }
  }
  return [...byInstant.values()].sort((a, b) => a.ms - b.ms);
}

async function retrieveRiverRecord() {
  const years = Array.from({ length: 2026 - 1986 + 1 }, (_, index) => 1986 + index);
  const annual = await mapWithConcurrency(years, 3, async (year) => {
    const codes = year >= 2013 ? [DISCHARGE, STAGE] : [DISCHARGE];
    const end = year === 2026 ? SNAPSHOT_DATE : `${year}-12-31`;
    const url = instantaneousUrl(RIVER_SITE, codes, `${year}-01-01`, end);
    const text = await fetchText(url, `river ${year} (${codes.join(', ')})`);
    return parseInstantaneousPayload(text, RIVER_SITE);
  });

  const discharge = [];
  const stage = [];
  for (const record of annual) {
    discharge.push(...(record.get(DISCHARGE) ?? []));
    stage.push(...(record.get(STAGE) ?? []));
  }
  return {
    discharge: deduplicateAndSort(discharge),
    stage: deduplicateAndSort(stage),
  };
}

async function retrieveBasinRecord() {
  const params = new URLSearchParams({
    monitoring_location_id: `USGS-${BASIN_SITE}`,
    parameter_code: BASIN_ELEVATION,
    datetime: '2024-05-01T00:00:00Z/2026-09-06T07:59:59Z',
    limit: '10000',
  });
  let url = `${OGC_CONTINUOUS_ENDPOINT}?${params}`;
  const points = [];
  let page = 1;

  while (url) {
    const text = await fetchText(url, `Suicide Basin OGC page ${page}`);
    const payload = JSON.parse(text);
    for (const feature of payload.features ?? []) {
      const properties = feature.properties ?? {};
      if (
        properties.monitoring_location_id !== `USGS-${BASIN_SITE}` ||
        properties.parameter_code !== BASIN_ELEVATION
      ) {
        continue;
      }
      const value = Number(properties.value);
      if (!Number.isFinite(value)) continue;
      const instant = new Date(properties.time);
      const rawQualifiers = properties.qualifier;
      const qualifiers = Array.isArray(rawQualifiers)
        ? rawQualifiers
        : rawQualifiers
          ? [rawQualifiers]
          : [];
      points.push({
        ms: instant.valueOf(),
        utc: instant.toISOString(),
        local: alaskaIso(instant),
        value,
        status:
          properties.approval_status === 'Provisional' ? 'Provisional' : 'Approved',
        qualifiers,
      });
    }
    url = payload.links?.find((link) => link.rel === 'next')?.href ?? '';
    page += 1;
  }

  return deduplicateAndSort(points);
}

function parseRdb(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'));
  assert(lines.length >= 3, 'USGS peak-flow response is missing tabular rows');
  const headers = lines[0].split('\t');
  return lines.slice(2).map((line) => {
    const values = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

async function retrievePeakRecord() {
  const params = new URLSearchParams({
    site_no: RIVER_SITE,
    agency_cd: 'USGS',
    format: 'rdb',
  });
  const text = await fetchText(`${PEAK_ENDPOINT}?${params}`, 'river annual peak-flow file');
  return parseRdb(text)
    .map((row) => {
      const date = row.peak_dt;
      const calendarYear = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      return {
        waterYear: month >= 10 ? calendarYear + 1 : calendarYear,
        date,
        discharge: Number(row.peak_va),
        gageHeight: Number(row.gage_ht),
        peakCodes: row.peak_cd ? row.peak_cd.split(',') : [],
        gageHeightCodes: row.gage_ht_cd ? row.gage_ht_cd.split(',') : [],
        status: 'Approved',
      };
    })
    .filter(
      (row) =>
        row.waterYear >= 1966 &&
        row.waterYear <= 2025 &&
        Number.isFinite(row.discharge) &&
        Number.isFinite(row.gageHeight),
    )
    .sort((a, b) => a.waterYear - b.waterYear);
}

function filterDateRange(points, startDate, endDate) {
  return points.filter((point) => {
    const date = localDate(point);
    return date >= startDate && date <= endDate;
  });
}

function firstMaximum(points) {
  assert(points.length > 0, 'cannot find a maximum in an empty series');
  let maximum = points[0];
  for (const point of points.slice(1)) {
    if (point.value > maximum.value) maximum = point;
  }
  return maximum;
}

function firstMinimum(points) {
  assert(points.length > 0, 'cannot find a minimum in an empty series');
  let minimum = points[0];
  for (const point of points.slice(1)) {
    if (point.value < minimum.value) minimum = point;
  }
  return minimum;
}

function exactPoint(points, date, clock) {
  return points.find((point) => localDate(point) === date && localClock(point) === clock);
}

function validateKnown2026Values({ basin, stage, discharge }) {
  const eventBasin = filterDateRange(basin, '2026-08-08', '2026-08-17');
  const eventStage = filterDateRange(stage, '2026-08-08', '2026-08-17');
  const eventDischarge = filterDateRange(discharge, '2026-08-08', '2026-08-17');

  const basinMaximum = firstMaximum(eventBasin);
  sameNumber(basinMaximum.value, 1345.62, '2026 basin maximum');
  assert(
    basinMaximum.local.startsWith('2026-08-11T03:15:00.000-08:00'),
    `first 2026 basin maximum time; received ${basinMaximum.local}`,
  );

  const stageMaximum = firstMaximum(eventStage);
  sameNumber(stageMaximum.value, 14.71, '2026 river stage maximum');
  assert(
    stageMaximum.local.startsWith('2026-08-13T14:05:00.000-08:00'),
    `first 2026 stage maximum time; received ${stageMaximum.local}`,
  );

  const dischargeMaximum = firstMaximum(eventDischarge);
  sameNumber(dischargeMaximum.value, 35300, '2026 river discharge maximum');
  assert(
    dischargeMaximum.local.startsWith('2026-08-13T14:00:00.000-08:00'),
    `first 2026 discharge maximum time; received ${dischargeMaximum.local}`,
  );
  for (const clock of ['14:00', '14:05', '14:10', '14:15']) {
    const point = exactPoint(eventDischarge, '2026-08-13', clock);
    assert(point, `2026 discharge observation at ${clock} AKDT is missing`);
    sameNumber(point.value, 35300, `2026 discharge plateau at ${clock} AKDT`);
  }

  const basinAt1400 = exactPoint(eventBasin, '2026-08-13', '14:00');
  const basinAt1415 = exactPoint(eventBasin, '2026-08-13', '14:15');
  assert(basinAt1400, '2026 basin observation at 14:00 AKDT is missing');
  assert(basinAt1415, '2026 basin observation at 14:15 AKDT is missing');
  sameNumber(basinAt1400.value, 956.11, '2026 basin level at 14:00 AKDT');
  sameNumber(basinAt1415.value, 949.21, '2026 basin level at 14:15 AKDT');

  const firstAtOrBelow900 = eventBasin.find((point) => point.value <= 900);
  assert(firstAtOrBelow900, '2026 basin never reaches 900 feet in the event window');
  assert(
    firstAtOrBelow900.local.startsWith('2026-08-13T16:15:00.000-08:00'),
    `first basin value at or below 900 feet; received ${firstAtOrBelow900.local}`,
  );

  const basinMinimum = firstMinimum(eventBasin);
  sameNumber(basinMinimum.value, 889.76, '2026 basin absolute minimum');
  assert(
    basinMinimum.local.startsWith('2026-08-15T08:00:00.000-08:00'),
    `2026 basin absolute-minimum time; received ${basinMinimum.local}`,
  );

  assert(eventBasin.every((point) => point.status === 'Provisional'), '2026 basin includes non-provisional values');
  assert(eventStage.every((point) => point.status === 'Provisional'), '2026 stage includes non-provisional values');
  assert(eventDischarge.every((point) => point.status === 'Provisional'), '2026 discharge includes non-provisional values');

  return {
    eventBasin,
    eventStage,
    eventDischarge,
    basinMaximum,
    stageMaximum,
    dischargeMaximum,
    firstAtOrBelow900,
    basinMinimum,
  };
}

function peakPreservingDownsample(points, bucketMilliseconds) {
  if (points.length < 3) return [...points];
  const output = [];
  let bucketKey = null;
  let bucket = [];

  function flush() {
    if (!bucket.length) return;
    let minimum = bucket[0];
    let maximum = bucket[0];
    for (const point of bucket.slice(1)) {
      if (point.value < minimum.value) minimum = point;
      if (point.value > maximum.value) maximum = point;
    }
    const selected = new Map(
      [bucket[0], minimum, maximum, bucket[bucket.length - 1]].map((point) => [point.ms, point]),
    );
    output.push(...[...selected.values()].sort((a, b) => a.ms - b.ms));
  }

  for (const point of points) {
    const key = Math.floor(point.ms / bucketMilliseconds);
    if (bucketKey !== null && key !== bucketKey) {
      flush();
      bucket = [];
    }
    bucketKey = key;
    bucket.push(point);
  }
  flush();
  return output;
}

function chartData(points, gapMilliseconds) {
  const output = [];
  let previous;
  for (const point of points) {
    if (previous && point.ms - previous.ms > gapMilliseconds) {
      const midpoint = new Date(previous.ms + (point.ms - previous.ms) / 2);
      output.push([alaskaIso(midpoint), null]);
    }
    output.push([point.local, point.value]);
    previous = point;
  }
  return output;
}

function statusSeries(points, options) {
  const statuses = [
    { status: 'Approved', name: 'Approved by USGS', colorKey: 'approved' },
    { status: 'Provisional', name: 'Provisional, subject to revision', colorKey: 'provisional' },
  ];
  return statuses
    .map(({ status, name, colorKey }) => {
      const matching = points.filter((point) => point.status === status);
      const sampled = options.bucketMilliseconds
        ? peakPreservingDownsample(matching, options.bucketMilliseconds)
        : matching;
      return {
        name,
        status,
        colorKey,
        lineStyle: 'solid',
        data: chartData(sampled, options.gapMilliseconds),
      };
    })
    .filter((series) => series.data.length > 0);
}

function annualSummerMaxima(points, firstYear, lastYear) {
  const maxima = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const summer = filterDateRange(points, `${year}-06-01`, `${year}-10-31`);
    if (summer.length) maxima.push({ year, point: firstMaximum(summer) });
  }
  return maxima;
}

function baseFigure(figureId, title, description, stationIds, querySummary) {
  return {
    figureId,
    title,
    description,
    retrieved: SNAPSHOT_DATE,
    source: SOURCE_NAME,
    timeZone: ALASKA_TIME_ZONE,
    provenance: {
      snapshotThrough: SNAPSHOT_DATE,
      stationIds,
      instantaneousValuesEndpoint: IV_ENDPOINT,
      basinContinuousValuesEndpoint: OGC_CONTINUOUS_ENDPOINT,
      annualPeakEndpoint: PEAK_ENDPOINT,
      querySummary,
      timeEncoding:
        'Continuous timestamps are ISO 8601 Alaska wall times with explicit UTC offsets, converted with America/Juneau. USGS UTC instants were retained during validation.',
      approvalStatus:
        'USGS P qualifiers are represented as Provisional; other published instantaneous values are represented as Approved.',
    },
  };
}

function buildFigure1(discharge) {
  const zoom = discharge.filter((point) => localDate(point) >= '2011-01-01');
  const annotations = annualSummerMaxima(discharge, 2011, 2026).map(({ year, point }) => ({
    x: point.local,
    y: point.value,
    label: `${year}: ${formatNumber(point.value, 0)} cfs`,
  }));
  return {
    ...baseFigure(
      'figure-1',
      'Mendenhall River instantaneous discharge, 1986–2026',
      'The available instantaneous discharge record, with the Suicide Basin outburst-flood era shown in more detail.',
      [`USGS-${RIVER_SITE}`],
      'Annual instantaneous-value requests for parameter 00060, 1986-01-01 through 2026-09-05.',
    ),
    processing: {
      method: 'Time buckets retain the first, minimum, maximum, and last observation; gaps are explicit nulls.',
      rawPointCount: discharge.length,
      fullRecordBucketHours: 48,
      detailBucketHours: 24,
    },
    panels: [
      {
        title: 'Full available instantaneous record',
        yLabel: 'Discharge',
        yUnit: 'cfs',
        xType: 'time',
        xMin: discharge[0].local,
        xMax: discharge[discharge.length - 1].local,
        yMin: 0,
        tickFormat: 'year',
        series: statusSeries(discharge, { bucketMilliseconds: 2 * DAY, gapMilliseconds: 3 * DAY }),
      },
      {
        title: 'Suicide Basin outburst-flood era, 2011–2026',
        yLabel: 'Discharge',
        yUnit: 'cfs',
        xType: 'time',
        xMin: zoom[0].local,
        xMax: zoom[zoom.length - 1].local,
        yMin: 0,
        tickFormat: 'year',
        annotations,
        series: statusSeries(zoom, { bucketMilliseconds: DAY, gapMilliseconds: 2 * DAY }),
      },
    ],
  };
}

function buildFigure2(peakRows, discharge, stage) {
  const provisionalDischarge = firstMaximum(filterDateRange(discharge, '2026-01-01', SNAPSHOT_DATE));
  const provisionalStage = firstMaximum(filterDateRange(stage, '2026-01-01', SNAPSHOT_DATE));
  const approvedDischarge = peakRows.map((row) => [row.waterYear, row.discharge]);
  const approvedStage = peakRows.map((row) => [row.waterYear, row.gageHeight]);
  const highlightedYears = new Set([1995, 2023, 2024, 2025]);

  return {
    ...baseFigure(
      'figure-2',
      'Annual peak discharge and maximum gage height',
      'Published annual peaks for water years 1966–2025, with the provisional 2026 instantaneous maxima added separately.',
      [`USGS-${RIVER_SITE}`],
      'USGS annual peak-flow RDB file for 1966–2025 plus parameter 00060 and 00065 instantaneous maxima through 2026-09-05.',
    ),
    peakRecord: peakRows.map((row) => ({
      waterYear: row.waterYear,
      date: row.date,
      approvalStatus: row.status,
      peakCodes: row.peakCodes,
      gageHeightCodes: row.gageHeightCodes,
    })),
    panels: [
      {
        title: 'Annual peak discharge',
        yLabel: 'Peak discharge',
        yUnit: 'cfs',
        xType: 'value',
        xLabel: 'Water year',
        xMin: 1965,
        xMax: 2027,
        yMin: 0,
        tickFormat: 'year',
        annotations: [
          ...peakRows
            .filter((row) => highlightedYears.has(row.waterYear))
            .map((row) => ({ x: row.waterYear, y: row.discharge, label: `${row.waterYear}: ${formatNumber(row.discharge, 0)} cfs` })),
          { x: 2026, y: provisionalDischarge.value, label: `2026: ${formatNumber(provisionalDischarge.value, 0)} cfs (provisional)` },
        ],
        series: [
          { name: 'Approved by USGS', status: 'Approved', colorKey: 'approved', lineStyle: 'solid', data: approvedDischarge },
          { name: '2026 provisional maximum', status: 'Provisional', colorKey: 'provisional', lineStyle: 'solid', data: [[2026, provisionalDischarge.value]] },
        ],
      },
      {
        title: 'Annual maximum gage height',
        yLabel: 'Gage height',
        yUnit: 'ft',
        xType: 'value',
        xLabel: 'Water year',
        xMin: 1965,
        xMax: 2027,
        yMin: 0,
        tickFormat: 'year',
        thresholds: [
          { value: 8, label: 'Action 8 ft' },
          { value: 9, label: 'Minor 9 ft' },
          { value: 10, label: 'Moderate 10 ft' },
          { value: 14, label: 'Major 14 ft' },
        ],
        annotations: [
          ...peakRows
            .filter((row) => highlightedYears.has(row.waterYear))
            .map((row) => ({ x: row.waterYear, y: row.gageHeight, label: `${row.waterYear}: ${row.gageHeight.toFixed(2)} ft` })),
          { x: 2026, y: provisionalStage.value, label: `2026: ${provisionalStage.value.toFixed(2)} ft (provisional)` },
        ],
        series: [
          { name: 'Approved by USGS', status: 'Approved', colorKey: 'approved', lineStyle: 'solid', data: approvedStage },
          { name: '2026 provisional maximum', status: 'Provisional', colorKey: 'provisional', lineStyle: 'solid', data: [[2026, provisionalStage.value]] },
        ],
      },
    ],
  };
}

function dailyMaxima(points) {
  const byDate = new Map();
  for (const point of points) {
    const date = localDate(point);
    const current = byDate.get(date);
    if (!current || point.value > current.value) byDate.set(date, point);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, point]) => ({
      ...point,
      local: `${date}T12:00:00.000${point.local.slice(-6)}`,
    }));
}

function buildFigure3(stage) {
  const daily = dailyMaxima(stage);
  const annotations = [];
  for (let year = 2013; year <= 2026; year += 1) {
    const annual = daily.filter((point) => localDate(point).startsWith(String(year)));
    if (!annual.length) continue;
    const maximum = firstMaximum(annual);
    if (maximum.value >= 9) {
      annotations.push({ x: maximum.local, y: maximum.value, label: `${year}: ${maximum.value.toFixed(2)} ft` });
    }
  }

  return {
    ...baseFigure(
      'figure-3',
      'Daily maximum Mendenhall River gage height, 2013–2026',
      'Daily maxima derived from the instantaneous stage record, with National Weather Service flood categories.',
      [`USGS-${RIVER_SITE}`],
      'Annual instantaneous-value requests for parameter 00065, 2013-01-01 through 2026-09-05; grouped by Alaska local date.',
    ),
    processing: {
      method: 'Maximum instantaneous observation for each America/Juneau calendar day.',
      rawPointCount: stage.length,
      dailyPointCount: daily.length,
    },
    panels: [
      {
        title: 'Daily maximum gage height',
        yLabel: 'Daily maximum gage height',
        yUnit: 'ft',
        xType: 'time',
        xMin: daily[0].local,
        xMax: daily[daily.length - 1].local,
        yMin: 0,
        tickFormat: 'year',
        thresholds: [
          { value: 8, label: 'Action 8 ft' },
          { value: 9, label: 'Minor 9 ft' },
          { value: 10, label: 'Moderate 10 ft' },
          { value: 14, label: 'Major 14 ft' },
        ],
        annotations,
        series: statusSeries(daily, { gapMilliseconds: 3 * DAY }),
      },
    ],
  };
}

function normalizeTo2000(point) {
  return `2000${point.local.slice(4)}`;
}

function normalizedSeries(points, year, parameterName) {
  const status = points.some((point) => point.status === 'Provisional') ? 'Provisional' : 'Approved';
  const data = [];
  let previous;
  for (const point of points) {
    if (previous && point.ms - previous.ms > 2 * HOUR) {
      const midpoint = new Date(previous.ms + (point.ms - previous.ms) / 2);
      const synthetic = { local: alaskaIso(midpoint) };
      data.push([normalizeTo2000(synthetic), null]);
    }
    data.push([normalizeTo2000(point), point.value]);
    previous = point;
  }
  return {
    name: String(year),
    status,
    colorKey: String(year),
    lineStyle: 'solid',
    parameter: parameterName,
    data,
  };
}

function buildFigure4(stage, discharge) {
  const years = [2023, 2024, 2025, 2026];
  const stageByYear = new Map();
  const dischargeByYear = new Map();
  for (const year of years) {
    stageByYear.set(year, filterDateRange(stage, `${year}-08-01`, `${year}-08-20`));
    dischargeByYear.set(year, filterDateRange(discharge, `${year}-08-01`, `${year}-08-20`));
  }

  return {
    ...baseFigure(
      'figure-4',
      'August outburst floods, 2023–2026',
      'The four recent August hydrographs overlaid on a common month-and-day axis for direct comparison.',
      [`USGS-${RIVER_SITE}`],
      'Parameters 00065 and 00060, August 1–20 in 2023, 2024, 2025, and 2026.',
    ),
    normalization:
      'Month, day, clock time, and Alaska UTC offset are preserved; the display year is normalized to leap year 2000.',
    panels: [
      {
        title: 'Mendenhall River gage height',
        yLabel: 'Gage height',
        yUnit: 'ft',
        xType: 'time',
        xMin: '2000-08-01T00:00:00.000-08:00',
        xMax: '2000-08-20T23:59:59.999-08:00',
        yMin: 3,
        yMax: 18.5,
        tickFormat: 'monthDay',
        thresholds: [
          { value: 8, label: 'Action 8 ft' },
          { value: 9, label: 'Minor 9 ft' },
          { value: 10, label: 'Moderate 10 ft' },
          { value: 14, label: 'Major 14 ft' },
        ],
        annotations: years.map((year) => {
          const point = firstMaximum(stageByYear.get(year));
          return { x: normalizeTo2000(point), y: point.value, label: `${year}: ${point.value.toFixed(2)} ft` };
        }),
        series: years.map((year) => normalizedSeries(stageByYear.get(year), year, STAGE)),
      },
      {
        title: 'Mendenhall River discharge',
        yLabel: 'Discharge',
        yUnit: 'cfs',
        xType: 'time',
        xMin: '2000-08-01T00:00:00.000-08:00',
        xMax: '2000-08-20T23:59:59.999-08:00',
        yMin: 0,
        tickFormat: 'monthDay',
        annotations: years.map((year) => {
          const point = firstMaximum(dischargeByYear.get(year));
          return { x: normalizeTo2000(point), y: point.value, label: `${year}: ${formatNumber(point.value, 0)} cfs` };
        }),
        series: years.map((year) => normalizedSeries(dischargeByYear.get(year), year, DISCHARGE)),
      },
    ],
  };
}

function buildFigure5(basin) {
  const detail = basin.filter((point) => localDate(point) >= '2026-03-01');
  const annotations = [];
  for (const year of [2024, 2025, 2026]) {
    const annual = basin.filter((point) => localDate(point).startsWith(String(year)));
    if (!annual.length) continue;
    const maximum = firstMaximum(annual);
    annotations.push({ x: maximum.local, y: maximum.value, label: `${year} maximum: ${maximum.value.toFixed(2)} ft` });
  }
  const detailMinimum = firstMinimum(detail);

  return {
    ...baseFigure(
      'figure-5',
      'Suicide Basin water-surface elevation, 2024–2026',
      'The full continuous basin record and a closer view of filling and release during 2026.',
      [`USGS-${BASIN_SITE}`],
      'Parameter 00062, 2024-05-01 through 2026-09-05.',
    ),
    processing: {
      method: 'Time buckets retain the first, minimum, maximum, and last observation; gaps are explicit nulls.',
      rawPointCount: basin.length,
      fullRecordBucketHours: 6,
      detailBucketHours: 1,
    },
    panels: [
      {
        title: 'Full available record',
        yLabel: 'Water-surface elevation above datum',
        yUnit: 'ft',
        xType: 'time',
        xMin: basin[0].local,
        xMax: basin[basin.length - 1].local,
        yMin: 850,
        tickFormat: 'monthYear',
        annotations,
        series: statusSeries(basin, { bucketMilliseconds: 6 * HOUR, gapMilliseconds: 2 * DAY }),
      },
      {
        title: 'The 2026 season',
        yLabel: 'Water-surface elevation above datum',
        yUnit: 'ft',
        xType: 'time',
        xMin: detail[0].local,
        xMax: detail[detail.length - 1].local,
        yMin: 850,
        tickFormat: 'monthYear',
        annotations: [
          { x: firstMaximum(detail).local, y: firstMaximum(detail).value, label: `Maximum ${firstMaximum(detail).value.toFixed(2)} ft` },
          { x: detailMinimum.local, y: detailMinimum.value, label: `Minimum ${detailMinimum.value.toFixed(2)} ft` },
        ],
        series: statusSeries(detail, { bucketMilliseconds: HOUR, gapMilliseconds: DAY }),
      },
    ],
  };
}

function buildFigure6(validated) {
  const {
    eventBasin,
    eventStage,
    eventDischarge,
    basinMaximum,
    stageMaximum,
    dischargeMaximum,
    basinMinimum,
  } = validated;
  const crestMarker = { x: stageMaximum.local, label: 'First maximum gage height' };

  return {
    ...baseFigure(
      'figure-6',
      'The August 2026 outburst flood on one time axis',
      'Suicide Basin water-surface elevation and the Mendenhall River response on a shared Alaska local-time axis.',
      [`USGS-${BASIN_SITE}`, `USGS-${RIVER_SITE}`],
      'Parameters 00062, 00065, and 00060, August 8–17, 2026.',
    ),
    notes: [
      'The maximum gage height first occurred at 14:05 AKDT and remained 14.71 ft at 14:10.',
      'Peak discharge began at 14:00 AKDT and remained 35,300 cfs through 14:15.',
      'At the river crest, the basin was still falling; its absolute minimum occurred on August 15.',
    ],
    panels: [
      {
        title: 'Suicide Basin water-surface elevation',
        yLabel: 'Basin water-surface elevation',
        yUnit: 'ft',
        xType: 'time',
        xMin: '2026-08-08T00:00:00.000-08:00',
        xMax: '2026-08-17T23:59:59.999-08:00',
        yMin: 870,
        tickFormat: 'date',
        markers: [crestMarker],
        annotations: [
          { x: basinMaximum.local, y: basinMaximum.value, label: `Maximum ${basinMaximum.value.toFixed(2)} ft` },
          { x: basinMinimum.local, y: basinMinimum.value, label: `Minimum ${basinMinimum.value.toFixed(2)} ft` },
        ],
        series: [
          {
            name: 'Basin elevation (provisional)',
            status: 'Provisional',
            colorKey: 'basin',
            lineStyle: 'solid',
            data: chartData(eventBasin, 6 * HOUR),
          },
        ],
      },
      {
        title: 'Mendenhall River gage height',
        yLabel: 'River gage height',
        yUnit: 'ft',
        xType: 'time',
        xMin: '2026-08-08T00:00:00.000-08:00',
        xMax: '2026-08-17T23:59:59.999-08:00',
        yMin: 4,
        yMax: 18,
        tickFormat: 'date',
        thresholds: [
          { value: 8, label: 'Action 8 ft' },
          { value: 9, label: 'Minor 9 ft' },
          { value: 10, label: 'Moderate 10 ft' },
          { value: 14, label: 'Major 14 ft' },
        ],
        markers: [crestMarker],
        annotations: [
          { x: stageMaximum.local, y: stageMaximum.value, label: `First maximum ${stageMaximum.value.toFixed(2)} ft` },
        ],
        series: [
          {
            name: 'River gage height (provisional)',
            status: 'Provisional',
            colorKey: 'stage',
            lineStyle: 'solid',
            data: chartData(eventStage, 2 * HOUR),
          },
        ],
      },
      {
        title: 'Mendenhall River discharge',
        yLabel: 'River discharge',
        yUnit: 'cfs',
        xType: 'time',
        xMin: '2026-08-08T00:00:00.000-08:00',
        xMax: '2026-08-17T23:59:59.999-08:00',
        yMin: 0,
        yMax: 40000,
        tickFormat: 'date',
        markers: [crestMarker],
        annotations: [
          { x: dischargeMaximum.local, y: dischargeMaximum.value, label: `First maximum ${formatNumber(dischargeMaximum.value, 0)} cfs` },
        ],
        series: [
          {
            name: 'River discharge (provisional)',
            status: 'Provisional',
            colorKey: 'discharge',
            lineStyle: 'solid',
            data: chartData(eventDischarge, 2 * HOUR),
          },
        ],
      },
    ],
  };
}

function validateFigures(figures) {
  assert(figures.length === 6, 'six figure payloads must be produced');
  for (const [index, figure] of figures.entries()) {
    assert(figure.figureId === `figure-${index + 1}`, `unexpected figure id ${figure.figureId}`);
    assert(figure.retrieved === SNAPSHOT_DATE, `${figure.figureId} retrieval date`);
    assert(Array.isArray(figure.panels) && figure.panels.length, `${figure.figureId} has no panels`);
    for (const panel of figure.panels) {
      assert(Array.isArray(panel.series) && panel.series.length, `${figure.figureId}/${panel.title} has no series`);
      for (const series of panel.series) {
        assert(Array.isArray(series.data) && series.data.length, `${figure.figureId}/${panel.title}/${series.name} is empty`);
        for (const datum of series.data) {
          assert(Array.isArray(datum) && datum.length === 2, `${figure.figureId} contains a malformed datum`);
          assert(datum[1] === null || Number.isFinite(datum[1]), `${figure.figureId} contains a nonnumeric y value`);
          if (panel.xType === 'time') {
            assert(
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(datum[0]),
              `${figure.figureId} timestamp lacks an explicit offset: ${datum[0]}`,
            );
          }
        }
      }
    }
  }
}

async function writeFigures(figures) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const summaries = [];
  for (const figure of figures) {
    const number = figure.figureId.split('-')[1];
    const destination = path.join(OUTPUT_DIR, `figure-${number}.json`);
    const temporary = `${destination}.tmp`;
    // These files are runtime assets. Compact JSON materially reduces static
    // transfer size; the generator is the human-readable source of truth.
    const serialized = `${JSON.stringify(figure)}\n`;
    await writeFile(temporary, serialized, 'utf8');
    await rename(temporary, destination);
    const info = await stat(destination);
    const pointCount = figure.panels.reduce(
      (panelTotal, panel) =>
        panelTotal + panel.series.reduce((seriesTotal, series) => seriesTotal + series.data.length, 0),
      0,
    );
    summaries.push({ file: path.relative(PROJECT_ROOT, destination), bytes: info.size, points: pointCount });
  }
  return summaries;
}

async function main() {
  console.log(`Building USGS GLOF snapshot dated ${SNAPSHOT_DATE}`);
  console.log(`Raw response cache: ${CACHE_DIR}${REFRESH ? ' (refresh requested)' : ''}`);

  const [{ discharge, stage }, basin, peakRows] = await Promise.all([
    retrieveRiverRecord(),
    retrieveBasinRecord(),
    retrievePeakRecord(),
  ]);

  assert(discharge.length > 100_000, `river discharge record is unexpectedly short (${discharge.length})`);
  assert(stage.length > 100_000, `river stage record is unexpectedly short (${stage.length})`);
  assert(basin.length > 10_000, `basin record is unexpectedly short (${basin.length})`);
  assert(peakRows.length >= 50, `annual peak record is unexpectedly short (${peakRows.length})`);

  const validated = validateKnown2026Values({ basin, stage, discharge });
  console.log('[ok] 2026 basin maximum: 1,345.62 ft, first at Aug 11 03:15 AKDT');
  console.log('[ok] 2026 stage maximum: 14.71 ft, first at Aug 13 14:05 AKDT');
  console.log('[ok] 2026 discharge maximum: 35,300 cfs, 14:00–14:15 AKDT plateau');
  console.log('[ok] Basin at crest: 956.11 ft at 14:00; 949.21 ft at 14:15');
  console.log('[ok] Basin first <= 900 ft: Aug 13 16:15 AKDT');
  console.log('[ok] Basin absolute minimum: 889.76 ft, Aug 15 08:00 AKDT');

  const figures = [
    buildFigure1(discharge),
    buildFigure2(peakRows, discharge, stage),
    buildFigure3(stage),
    buildFigure4(stage, discharge),
    buildFigure5(basin),
    buildFigure6(validated),
  ];
  validateFigures(figures);
  const summaries = await writeFigures(figures);

  console.log('\nGenerated static chart data:');
  for (const summary of summaries) {
    console.log(`- ${summary.file}: ${summary.points.toLocaleString('en-US')} points, ${summary.bytes.toLocaleString('en-US')} bytes`);
  }
  console.log(`Raw records: discharge ${discharge.length.toLocaleString('en-US')}; stage ${stage.length.toLocaleString('en-US')}; basin ${basin.length.toLocaleString('en-US')}; annual peaks ${peakRows.length}.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
