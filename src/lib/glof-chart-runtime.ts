import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsType } from 'echarts/core';
import {
  buildGlofChartOptions,
  recommendedChartHeight,
  type GlofChartTheme,
  type GlofPlotPayload,
} from './glof-chart-options';

echarts.use([
  AriaComponent,
  BarChart,
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  MarkLineComponent,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
]);

export interface GlofChartController {
  readonly seriesNames: string[];
  readonly height: number;
  resize(): void;
  resetZoom(): void;
  setSeriesVisible(name: string, visible: boolean): void;
  updateTheme(): void;
  dispose(): void;
}

export interface MountGlofChartOptions {
  accessibleLabel: string;
  onSeriesVisibilityChange?: (selection: Record<string, boolean>) => void;
}

const cssValue = (styles: CSSStyleDeclaration, property: string, fallback: string): string =>
  styles.getPropertyValue(property).trim() || fallback;

export function readGlofChartTheme(): GlofChartTheme {
  const styles = getComputedStyle(document.documentElement);
  const light = document.documentElement.dataset.theme === 'light';
  return {
    background: cssValue(styles, '--bg-elev', light ? '#ffffff' : '#2e3d49'),
    surface: cssValue(styles, '--bg-elev-2', light ? '#e9f2fc' : '#38495a'),
    text: cssValue(styles, '--text', light ? '#283643' : '#eef4fb'),
    muted: cssValue(styles, '--text-dim', light ? '#4e6576' : '#b6c7d9'),
    faint: cssValue(styles, '--text-faint', light ? '#6a89a7' : '#8099ad'),
    border: cssValue(styles, '--border', light ? '#cbdcec' : '#45596c'),
    grid: cssValue(styles, '--border-soft', light ? '#e1ebf5' : '#344452'),
    approved: light ? '#2878c8' : '#88bdf2',
    provisional: light ? '#c44f20' : '#ff8755',
    palette: light
      ? ['#2878c8', '#16877a', '#7957c5', '#a86617', '#a63f78', '#4e6576']
      : ['#88bdf2', '#59d2c1', '#b99af4', '#efb45d', '#ef86b8', '#b6c7d9'],
    tooltipBackground: light ? 'rgba(255,255,255,.97)' : 'rgba(35,47,58,.97)',
  };
}

const collectSeriesNames = (payload: GlofPlotPayload): string[] =>
  [...new Set(payload.panels.flatMap((panel) => panel.series.map(({ name }) => name)))];

const captureZoom = (chart: EChartsType): Array<Record<string, unknown>> => {
  const option = chart.getOption() as { dataZoom?: Array<Record<string, unknown>> };
  return (option.dataZoom ?? []).map((zoom) => ({
    id: zoom.id,
    start: zoom.start,
    end: zoom.end,
    startValue: zoom.startValue,
    endValue: zoom.endValue,
  }));
};

export function mountGlofChart(
  container: HTMLDivElement,
  payload: GlofPlotPayload,
  options: MountGlofChartOptions,
): GlofChartController {
  const height = recommendedChartHeight(payload.panels.length);
  const seriesNames = collectSeriesNames(payload);
  const selected = Object.fromEntries(seriesNames.map((name) => [name, true]));
  container.style.height = `${height}px`;
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', options.accessibleLabel || payload.description);

  const chart = echarts.init(container, undefined, {
    renderer: 'canvas',
    useDirtyRect: true,
  });

  const applyOptions = (preserveZoom: boolean): void => {
    const zoom = preserveZoom ? captureZoom(chart) : [];
    chart.setOption(
      buildGlofChartOptions(payload, readGlofChartTheme(), height) as never,
      { notMerge: true, lazyUpdate: false },
    );
    Object.entries(selected).forEach(([name, visible]) => {
      chart.dispatchAction({ type: visible ? 'legendSelect' : 'legendUnSelect', name });
    });
    zoom.forEach((state) => {
      chart.dispatchAction({ type: 'dataZoom', ...state });
    });
  };

  applyOptions(false);

  chart.on('legendselectchanged', (event: unknown) => {
    const selection = (event as { selected?: Record<string, boolean> }).selected;
    if (!selection) return;
    Object.entries(selection).forEach(([name, visible]) => {
      if (name in selected) selected[name] = visible;
    });
    options.onSeriesVisibilityChange?.({ ...selected });
  });

  let resizeFrame = 0;
  const resize = (): void => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (!chart.isDisposed()) chart.resize();
    });
  };
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(container);
  if (!resizeObserver) window.addEventListener('resize', resize, { passive: true });

  let disposed = false;
  return {
    seriesNames,
    height,
    resize,
    resetZoom() {
      if (disposed) return;
      chart.dispatchAction({ type: 'dataZoom', dataZoomId: 'glof-inside', start: 0, end: 100 });
      chart.dispatchAction({ type: 'dataZoom', dataZoomId: 'glof-slider', start: 0, end: 100 });
    },
    setSeriesVisible(name, visible) {
      if (disposed || !(name in selected)) return;
      selected[name] = visible;
      chart.dispatchAction({ type: visible ? 'legendSelect' : 'legendUnSelect', name });
      options.onSeriesVisibilityChange?.({ ...selected });
    },
    updateTheme() {
      if (disposed) return;
      applyOptions(true);
      resize();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      chart.dispose();
    },
  };
}
