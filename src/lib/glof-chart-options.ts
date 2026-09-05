export const ALASKA_TIME_ZONE = 'America/Juneau';

export type GlofPlotX = string | number;
export type GlofPlotPoint = [GlofPlotX, number | null];
export type GlofTickFormat =
  | 'year'
  | 'monthYear'
  | 'monthDay'
  | 'date'
  | 'dateTime'
  | 'time';

export interface GlofPlotSeries {
  name: string;
  status?: string;
  colorKey?: string;
  lineStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted'
    | {
        type?: 'solid' | 'dashed' | 'dotted';
        width?: number;
        opacity?: number;
      };
  data: GlofPlotPoint[];
}

export interface GlofPlotThreshold {
  value: number;
  label: string;
}

export interface GlofPlotMarker {
  x: GlofPlotX;
  label: string;
}

export interface GlofPlotAnnotation {
  x: GlofPlotX;
  y: number;
  label: string;
}

export interface GlofPlotPanel {
  title: string;
  yLabel: string;
  yUnit: string;
  xType: 'time' | 'value';
  xLabel?: string;
  xMin?: GlofPlotX;
  xMax?: GlofPlotX;
  yMin?: number;
  yMax?: number;
  tickFormat?: GlofTickFormat;
  series: GlofPlotSeries[];
  thresholds?: GlofPlotThreshold[];
  markers?: GlofPlotMarker[];
  annotations?: GlofPlotAnnotation[];
}

export interface GlofPlotPayload {
  figureId: string | number;
  title: string;
  description: string;
  retrieved: string;
  source: string;
  /** Input timestamps carry explicit offsets; labels are always shown in Alaska time. */
  timeZone?: string;
  panels: GlofPlotPanel[];
}

export interface GlofChartTheme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  grid: string;
  approved: string;
  provisional: string;
  palette: string[];
  tooltipBackground: string;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
};

const optionalNumber = (value: unknown, path: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
};

const parseX = (value: unknown, path: string): GlofPlotX => {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${path} must be a number or a non-empty timestamp string.`);
};

const parseSeries = (value: unknown, path: string): GlofPlotSeries => {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  if (!Array.isArray(value.data) || value.data.length === 0) {
    throw new Error(`${path}.data must be a non-empty array.`);
  }

  const data = value.data.map((point, index): GlofPlotPoint => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error(`${path}.data[${index}] must be an [x, y] pair.`);
    }
    const x = parseX(point[0], `${path}.data[${index}][0]`);
    const y = point[1];
    if (y !== null && (typeof y !== 'number' || !Number.isFinite(y))) {
      throw new Error(`${path}.data[${index}][1] must be a finite number or null.`);
    }
    return [x, y];
  });

  const rawLineStyle = value.lineStyle;
  let lineStyle: GlofPlotSeries['lineStyle'];
  if (typeof rawLineStyle === 'string') {
    if (!['solid', 'dashed', 'dotted'].includes(rawLineStyle)) {
      throw new Error(`${path}.lineStyle is not supported.`);
    }
    lineStyle = rawLineStyle as 'solid' | 'dashed' | 'dotted';
  } else if (isRecord(rawLineStyle)) {
    const type = rawLineStyle.type;
    if (type !== undefined && !['solid', 'dashed', 'dotted'].includes(String(type))) {
      throw new Error(`${path}.lineStyle.type is not supported.`);
    }
    lineStyle = {
      type: type as 'solid' | 'dashed' | 'dotted' | undefined,
      width: optionalNumber(rawLineStyle.width, `${path}.lineStyle.width`),
      opacity: optionalNumber(rawLineStyle.opacity, `${path}.lineStyle.opacity`),
    };
  }

  return {
    name: requiredString(value.name, `${path}.name`),
    status: typeof value.status === 'string' ? value.status : undefined,
    colorKey: typeof value.colorKey === 'string' ? value.colorKey : undefined,
    lineStyle,
    data,
  };
};

const parsePanel = (value: unknown, index: number): GlofPlotPanel => {
  const path = `panels[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  if (value.xType !== 'time' && value.xType !== 'value') {
    throw new Error(`${path}.xType must be "time" or "value".`);
  }
  if (!Array.isArray(value.series) || value.series.length === 0) {
    throw new Error(`${path}.series must be a non-empty array.`);
  }

  const thresholds = Array.isArray(value.thresholds)
    ? value.thresholds.map((item, itemIndex): GlofPlotThreshold => {
        if (!isRecord(item)) throw new Error(`${path}.thresholds[${itemIndex}] must be an object.`);
        const thresholdValue = optionalNumber(item.value, `${path}.thresholds[${itemIndex}].value`);
        if (thresholdValue === undefined) {
          throw new Error(`${path}.thresholds[${itemIndex}].value is required.`);
        }
        return {
          value: thresholdValue,
          label: requiredString(item.label, `${path}.thresholds[${itemIndex}].label`),
        };
      })
    : undefined;

  const markers = Array.isArray(value.markers)
    ? value.markers.map((item, itemIndex): GlofPlotMarker => {
        if (!isRecord(item)) throw new Error(`${path}.markers[${itemIndex}] must be an object.`);
        return {
          x: parseX(item.x, `${path}.markers[${itemIndex}].x`),
          label: requiredString(item.label, `${path}.markers[${itemIndex}].label`),
        };
      })
    : undefined;

  const annotations = Array.isArray(value.annotations)
    ? value.annotations.map((item, itemIndex): GlofPlotAnnotation => {
        if (!isRecord(item)) throw new Error(`${path}.annotations[${itemIndex}] must be an object.`);
        const y = optionalNumber(item.y, `${path}.annotations[${itemIndex}].y`);
        if (y === undefined) throw new Error(`${path}.annotations[${itemIndex}].y is required.`);
        return {
          x: parseX(item.x, `${path}.annotations[${itemIndex}].x`),
          y,
          label: requiredString(item.label, `${path}.annotations[${itemIndex}].label`),
        };
      })
    : undefined;

  const tickFormat = value.tickFormat;
  if (
    tickFormat !== undefined &&
    !['year', 'monthYear', 'monthDay', 'date', 'dateTime', 'time'].includes(String(tickFormat))
  ) {
    throw new Error(`${path}.tickFormat is not supported.`);
  }

  return {
    title: requiredString(value.title, `${path}.title`),
    yLabel: requiredString(value.yLabel, `${path}.yLabel`),
    yUnit: typeof value.yUnit === 'string' ? value.yUnit : '',
    xType: value.xType,
    xLabel: typeof value.xLabel === 'string' ? value.xLabel : undefined,
    xMin: value.xMin === undefined ? undefined : parseX(value.xMin, `${path}.xMin`),
    xMax: value.xMax === undefined ? undefined : parseX(value.xMax, `${path}.xMax`),
    yMin: optionalNumber(value.yMin, `${path}.yMin`),
    yMax: optionalNumber(value.yMax, `${path}.yMax`),
    tickFormat: tickFormat as GlofTickFormat | undefined,
    series: value.series.map((series, seriesIndex) =>
      parseSeries(series, `${path}.series[${seriesIndex}]`),
    ),
    thresholds,
    markers,
    annotations,
  };
};

/** Validate untrusted fetched JSON before handing it to the chart library. */
export function parseGlofPlotPayload(value: unknown): GlofPlotPayload {
  if (!isRecord(value)) throw new Error('The plot data must be a JSON object.');
  if (typeof value.figureId !== 'string' && typeof value.figureId !== 'number') {
    throw new Error('figureId must be a string or number.');
  }
  if (!Array.isArray(value.panels) || value.panels.length === 0) {
    throw new Error('panels must be a non-empty array.');
  }

  return {
    figureId: value.figureId,
    title: requiredString(value.title, 'title'),
    description: requiredString(value.description, 'description'),
    retrieved: requiredString(value.retrieved, 'retrieved'),
    source: requiredString(value.source, 'source'),
    timeZone: typeof value.timeZone === 'string' ? value.timeZone : undefined,
    panels: value.panels.map(parsePanel),
  };
}

export function normalizeFigureId(value: string | number): string {
  return String(value).trim().toLowerCase().replace(/^figure[-_\s]*/, '');
}

export function recommendedChartHeight(panelCount: number): number {
  if (panelCount <= 1) return 490;
  if (panelCount === 2) return 690;
  return 230 * panelCount + 160;
}

const timestampToMilliseconds = (value: GlofPlotX): number => {
  if (typeof value === 'string') return Date.parse(value);
  // Accept either JavaScript milliseconds or Unix seconds in generated snapshots.
  return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
};

const inferTickFormat = (panel: GlofPlotPanel): GlofTickFormat => {
  if (panel.tickFormat) return panel.tickFormat;
  if (panel.xType === 'value') return 'date';

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let valueCount = 0;
  panel.series.forEach((series) => {
    series.data.forEach(([x]) => {
      const value = timestampToMilliseconds(x);
      if (!Number.isFinite(value)) return;
      valueCount += 1;
      if (value < min) min = value;
      if (value > max) max = value;
    });
  });
  if (!valueCount) {
    min = 0;
    max = 0;
  }
  const days = (max - min) / 86_400_000;
  if (days > 3 * 365) return 'year';
  if (days > 120) return 'monthYear';
  if (days > 3) return 'monthDay';
  if (days > 1) return 'dateTime';
  return 'time';
};

const axisDateFormatter = (format: GlofTickFormat): Intl.DateTimeFormat => {
  const common: Intl.DateTimeFormatOptions = { timeZone: ALASKA_TIME_ZONE };
  const options: Record<GlofTickFormat, Intl.DateTimeFormatOptions> = {
    year: { ...common, year: 'numeric' },
    monthYear: { ...common, month: 'short', year: 'numeric' },
    monthDay: { ...common, month: 'short', day: '2-digit' },
    date: { ...common, month: 'short', day: 'numeric', year: 'numeric' },
    dateTime: {
      ...common,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
    time: { ...common, hour: 'numeric', minute: '2-digit' },
  };
  return new Intl.DateTimeFormat('en-US', options[format]);
};

const tooltipDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ALASKA_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const formatAxisX = (value: unknown, panel: GlofPlotPanel): string => {
  if (panel.xType === 'value') return String(value);
  const milliseconds = timestampToMilliseconds(value as GlofPlotX);
  if (!Number.isFinite(milliseconds)) return String(value);
  return axisDateFormatter(inferTickFormat(panel)).format(milliseconds);
};

const formatTooltipX = (value: unknown, panel: GlofPlotPanel): string => {
  if (panel.xType === 'value') return panel.xLabel ? `${value} ${panel.xLabel}` : String(value);
  const milliseconds = timestampToMilliseconds(value as GlofPlotX);
  if (!Number.isFinite(milliseconds)) return String(value);
  return tooltipDateFormatter.format(milliseconds);
};

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatY = (value: unknown, unit: string): string => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'No reading';
  const normalizedUnit = unit.trim().toLowerCase();
  const maximumFractionDigits = normalizedUnit === 'cfs' ? 0 : Math.abs(number) >= 100 ? 2 : 2;
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(number);
  return unit ? `${formatted} ${unit}` : formatted;
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const colorForSeries = (series: GlofPlotSeries, theme: GlofChartTheme): string => {
  const key = (series.colorKey || series.status || series.name).trim().toLowerCase();
  if (key.includes('provisional') || key === '2026') return theme.provisional;
  if (key.includes('approved')) return theme.approved;
  const yearColors: Record<string, number> = { '2023': 0, '2024': 1, '2025': 2 };
  if (key in yearColors) return theme.palette[yearColors[key] % theme.palette.length];
  if (key.includes('basin')) return theme.palette[1 % theme.palette.length];
  if (key.includes('stage') || key.includes('gage')) return theme.palette[0];
  if (key.includes('discharge')) return theme.palette[2 % theme.palette.length];
  return theme.palette[hashString(key) % theme.palette.length];
};

const normalizeLineStyle = (series: GlofPlotSeries): UnknownRecord => {
  if (typeof series.lineStyle === 'string') {
    return { type: series.lineStyle, width: 2 };
  }
  return {
    type: series.lineStyle?.type ?? 'solid',
    width: series.lineStyle?.width ?? 2,
    opacity: series.lineStyle?.opacity ?? 1,
  };
};

const panelsShareZoom = (figureId: string, panelCount: number): boolean =>
  panelCount > 1 && ['2', '4', '6'].includes(figureId);

const composeAxisName = (panel: GlofPlotPanel): string => {
  if (!panel.yUnit) return panel.yLabel;
  if (panel.yLabel.toLowerCase().includes(panel.yUnit.toLowerCase())) return panel.yLabel;
  return `${panel.yLabel} (${panel.yUnit})`;
};

interface SeriesMeta {
  panel: GlofPlotPanel;
  series: GlofPlotSeries;
}

/**
 * Build one ECharts option for one to three vertically stacked panels.
 * The returned object intentionally stays library-agnostic so data/schema tests do
 * not need to import the comparatively large chart runtime.
 */
export function buildGlofChartOptions(
  payload: GlofPlotPayload,
  theme: GlofChartTheme,
  chartHeight: number,
): UnknownRecord {
  const figureId = normalizeFigureId(payload.figureId);
  const panelCount = payload.panels.length;
  const uniqueSeriesNames = [...new Set(payload.panels.flatMap((panel) => panel.series.map(({ name }) => name)))];
  const showLegend = uniqueSeriesNames.length > 1;
  const legendRoom = showLegend ? 58 : 22;
  const sliderRoom = 64;
  const panelGap = 56;
  const availableHeight = chartHeight - legendRoom - sliderRoom - panelGap * (panelCount - 1);
  const panelHeight = Math.max(128, Math.floor(availableHeight / panelCount));
  const sharedZoom = panelsShareZoom(figureId, panelCount);
  const zoomAxes = sharedZoom ? payload.panels.map((_, index) => index) : [panelCount - 1];

  const titles: UnknownRecord[] = [];
  const grids: UnknownRecord[] = [];
  const xAxes: UnknownRecord[] = [];
  const yAxes: UnknownRecord[] = [];
  const renderedSeries: UnknownRecord[] = [];
  const seriesMeta: SeriesMeta[] = [];

  payload.panels.forEach((panel, panelIndex) => {
    const gridTop = legendRoom + panelIndex * (panelHeight + panelGap);
    titles.push({
      text: panel.title,
      left: 66,
      top: Math.max(0, gridTop - 35),
      textStyle: {
        color: theme.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 15,
        fontWeight: 650,
        overflow: 'truncate',
      },
    });
    grids.push({
      left: 70,
      right: 24,
      top: gridTop,
      height: panelHeight,
      containLabel: false,
    });

    xAxes.push({
      type: panel.xType,
      gridIndex: panelIndex,
      min: panel.xMin,
      max: panel.xMax,
      boundaryGap: false,
      name: panel.xLabel ?? '',
      nameLocation: 'middle',
      nameGap: 34,
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { lineStyle: { color: theme.border } },
      axisLabel: {
        color: theme.muted,
        hideOverlap: true,
        formatter: (value: unknown) => formatAxisX(value, panel),
      },
      splitLine: { show: true, lineStyle: { color: theme.grid, width: 1 } },
      axisPointer: {
        show: true,
        snap: false,
        label: {
          show: true,
          color: theme.text,
          backgroundColor: theme.surface,
          formatter: ({ value }: { value: unknown }) => formatTooltipX(value, panel),
        },
      },
    });

    yAxes.push({
      type: 'value',
      gridIndex: panelIndex,
      min: panel.yMin,
      max: panel.yMax,
      name: composeAxisName(panel),
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { color: theme.muted, fontSize: 12 },
      axisLine: { show: true, lineStyle: { color: theme.border } },
      axisTick: { show: true, lineStyle: { color: theme.border } },
      axisLabel: {
        color: theme.muted,
        formatter: (value: number) =>
          new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value),
      },
      splitLine: { show: true, lineStyle: { color: theme.grid, width: 1 } },
    });

    const markLineData: UnknownRecord[] = [
      ...(panel.thresholds ?? []).map(({ value, label }) => ({
        name: label,
        yAxis: value,
        label: { formatter: label, position: 'insideStartTop' },
        lineStyle: { type: 'dashed', color: theme.faint, width: 1 },
      })),
      ...(panel.markers ?? []).map(({ x, label }) => ({
        name: label,
        xAxis: x,
        label: { formatter: label, position: 'insideEndTop' },
        lineStyle: { type: 'dotted', color: theme.faint, width: 1.5 },
      })),
    ];

    panel.series.forEach((sourceSeries, sourceIndex) => {
      const color = colorForSeries(sourceSeries, theme);
      const common: UnknownRecord = {
        name: sourceSeries.name,
        xAxisIndex: panelIndex,
        yAxisIndex: panelIndex,
        data: sourceSeries.data,
        itemStyle: { color },
        emphasis: { focus: 'series' },
        animation: false,
        connectNulls: false,
      };
      const markLine = sourceIndex === 0 && markLineData.length
        ? {
            silent: true,
            symbol: ['none', 'none'],
            label: { color: theme.muted, fontSize: 11 },
            data: markLineData,
          }
        : undefined;

      if (figureId === '2') {
        renderedSeries.push({
          ...common,
          type: 'bar',
          barWidth: 2,
          barGap: '-100%',
          tooltip: { show: true },
          markLine,
        });
        seriesMeta.push({ panel, series: sourceSeries });
        renderedSeries.push({
          ...common,
          type: 'scatter',
          symbol: 'circle',
          symbolSize: 7,
          tooltip: { show: false },
          z: 4,
        });
        seriesMeta.push({ panel, series: sourceSeries });
      } else {
        renderedSeries.push({
          ...common,
          type: 'line',
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 5,
          sampling: 'lttb',
          lineStyle: { color, ...normalizeLineStyle(sourceSeries) },
          markLine,
        });
        seriesMeta.push({ panel, series: sourceSeries });
      }
    });

    if (panel.annotations?.length) {
      renderedSeries.push({
        name: `__annotations-${panelIndex}`,
        type: 'scatter',
        xAxisIndex: panelIndex,
        yAxisIndex: panelIndex,
        symbolSize: 4,
        silent: true,
        tooltip: { show: false },
        itemStyle: { color: theme.text, opacity: 0 },
        data: panel.annotations.map(({ x, y, label }) => ({
          value: [x, y],
          label: {
            show: true,
            formatter: label,
            position: 'top',
            distance: 7,
            color: theme.text,
            fontSize: 11,
            lineHeight: 14,
            backgroundColor: theme.background,
            borderRadius: 3,
            padding: [2, 4],
          },
        })),
        z: 8,
      });
      seriesMeta.push({
        panel,
        series: { name: `__annotations-${panelIndex}`, data: [] },
      });
    }
  });

  const tooltipFormatter = (rawParams: unknown): string => {
    const params = (Array.isArray(rawParams) ? rawParams : [rawParams]).filter(isRecord);
    const visible = params.filter((param) => !String(param.seriesName ?? '').startsWith('__annotations-'));
    if (!visible.length) return '';
    const first = visible[0];
    const firstMeta = seriesMeta[Number(first.seriesIndex)] ?? seriesMeta[0];
    const firstValue = Array.isArray(first.value) ? first.value : [];
    const x = firstValue[0] ?? first.axisValue;
    let html = `<strong>${escapeHtml(formatTooltipX(x, firstMeta.panel))}</strong>`;
    const seen = new Set<string>();

    visible.forEach((param) => {
      const meta = seriesMeta[Number(param.seriesIndex)];
      if (!meta || seen.has(meta.series.name)) return;
      seen.add(meta.series.name);
      const value = Array.isArray(param.value) ? param.value[1] : param.value;
      const color = typeof param.color === 'string' ? param.color : theme.approved;
      const status = meta.series.status ? ` <span style="opacity:.72">(${escapeHtml(meta.series.status)})</span>` : '';
      html += `<br><span style="display:inline-block;width:.65rem;height:.65rem;border-radius:50%;background:${escapeHtml(color)};margin-right:.4rem"></span>${escapeHtml(meta.series.name)}${status}: <strong>${escapeHtml(formatY(value, meta.panel.yUnit))}</strong>`;
    });
    return html;
  };

  const options: UnknownRecord = {
    backgroundColor: theme.background,
    animation: false,
    textStyle: { color: theme.text, fontFamily: 'Inter, system-ui, sans-serif' },
    aria: {
      enabled: true,
      label: { description: payload.description },
    },
    title: titles,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    legend: {
      show: showLegend,
      type: 'scroll',
      top: 5,
      left: 62,
      right: 20,
      data: uniqueSeriesNames,
      textStyle: { color: theme.muted },
      pageTextStyle: { color: theme.muted },
      pageIconColor: theme.approved,
      pageIconInactiveColor: theme.faint,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      renderMode: 'html',
      appendToBody: false,
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.border,
      textStyle: { color: theme.text, fontSize: 12 },
      axisPointer: { type: 'cross', snap: false },
      formatter: tooltipFormatter,
    },
    axisPointer: sharedZoom ? { link: [{ xAxisIndex: zoomAxes }] } : undefined,
    dataZoom: [
      {
        id: 'glof-inside',
        type: 'inside',
        xAxisIndex: zoomAxes,
        filterMode: 'none',
        throttle: 80,
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
      },
      {
        id: 'glof-slider',
        type: 'slider',
        xAxisIndex: zoomAxes,
        filterMode: 'none',
        bottom: 13,
        height: 24,
        showDetail: false,
        brushSelect: false,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        fillerColor: `${theme.approved}33`,
        dataBackground: {
          lineStyle: { color: theme.faint },
          areaStyle: { color: `${theme.faint}22` },
        },
        selectedDataBackground: {
          lineStyle: { color: theme.approved },
          areaStyle: { color: `${theme.approved}33` },
        },
        handleStyle: { color: theme.surface, borderColor: theme.approved },
        moveHandleStyle: { color: theme.approved },
        textStyle: { color: theme.muted },
      },
    ],
    series: renderedSeries,
  };

  return options;
}
