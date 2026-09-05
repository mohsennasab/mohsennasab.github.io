import {
  normalizeFigureId,
  parseGlofPlotPayload,
  type GlofPlotPayload,
} from '../lib/glof-chart-options';
import type { GlofChartController } from '../lib/glof-chart-runtime';

const ELEMENT_NAME = 'interactive-glof-figure';

let runtimePromise: Promise<typeof import('../lib/glof-chart-runtime')> | null = null;
const loadRuntime = (): Promise<typeof import('../lib/glof-chart-runtime')> => {
  runtimePromise ??= import('../lib/glof-chart-runtime');
  return runtimePromise.catch((error) => {
    runtimePromise = null;
    throw error;
  });
};

const requiredElement = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Interactive figure is missing ${selector}.`);
  return element;
};

class InteractiveGlofFigure extends HTMLElement {
  private lifecycle: AbortController | null = null;
  private loadRequest: AbortController | null = null;
  private chart: GlofChartController | null = null;
  private payload: GlofPlotPayload | null = null;
  private loading: Promise<void> | null = null;
  private themeObserver: MutationObserver | null = null;

  connectedCallback(): void {
    if (this.lifecycle) return;
    this.lifecycle = new AbortController();
    const { signal } = this.lifecycle;
    const toggle = requiredElement<HTMLButtonElement>(this, '[data-plot-toggle]');
    const reset = requiredElement<HTMLButtonElement>(this, '[data-plot-reset]');

    toggle.addEventListener('click', () => this.toggleView(), { signal });
    reset.addEventListener('click', () => {
      this.chart?.resetZoom();
      this.setStatus('Zoom reset to the full display range.');
    }, { signal });

    this.themeObserver = new MutationObserver((mutations) => {
      if (mutations.some(({ attributeName }) => attributeName === 'data-theme')) {
        this.chart?.updateTheme();
      }
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  disconnectedCallback(): void {
    this.lifecycle?.abort();
    this.lifecycle = null;
    this.loadRequest?.abort();
    this.loadRequest = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.chart?.dispose();
    this.chart = null;
    this.payload = null;
    this.loading = null;
  }

  private get figureId(): string {
    return normalizeFigureId(this.dataset.figureId ?? '');
  }

  private async toggleView(): Promise<void> {
    if (this.dataset.view === 'interactive') {
      this.showStatic();
      return;
    }
    if (this.chart) {
      this.showInteractive();
      return;
    }
    await this.loadInteractive();
  }

  private async loadInteractive(): Promise<void> {
    if (this.loading) return this.loading;
    const dataUrl = this.dataset.dataUrl;
    if (!dataUrl) {
      this.setStatus('Interactive data URL is missing.', 'error');
      return;
    }

    const toggle = requiredElement<HTMLButtonElement>(this, '[data-plot-toggle]');
    const shell = requiredElement<HTMLElement>(this, '[data-plot-shell]');
    toggle.disabled = true;
    toggle.textContent = `Loading interactive Figure ${this.figureId}…`;
    shell.setAttribute('aria-busy', 'true');
    this.dataset.state = 'loading';
    this.setStatus(`Loading interactive Figure ${this.figureId}…`);
    this.loadRequest = new AbortController();

    this.loading = (async () => {
      try {
        const [runtime, response] = await Promise.all([
          loadRuntime(),
          fetch(dataUrl, {
            signal: this.loadRequest?.signal,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          }),
        ]);
        if (!response.ok) {
          throw new Error(`Plot data request returned ${response.status}.`);
        }

        const payload = parseGlofPlotPayload(await response.json());
        if (normalizeFigureId(payload.figureId) !== this.figureId) {
          throw new Error(
            `Plot data identifies Figure ${payload.figureId}, not Figure ${this.figureId}.`,
          );
        }
        if (!this.isConnected) return;

        this.payload = payload;
        const chartContainer = requiredElement<HTMLDivElement>(this, '[data-plot-chart]');
        const title = requiredElement<HTMLElement>(this, '[data-plot-title]');
        title.textContent = payload.title;
        this.chart = runtime.mountGlofChart(chartContainer, payload, {
          accessibleLabel: this.dataset.alt ?? payload.description,
          onSeriesVisibilityChange: (selection) => this.syncSeriesControls(selection),
        });
        this.buildSeriesControls(this.chart.seriesNames);
        this.dataset.state = 'ready';
        this.showInteractive();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const detail = error instanceof Error ? error.message : 'Unknown plot error.';
        this.dataset.state = 'error';
        this.chart?.dispose();
        this.chart = null;
        this.payload = null;
        this.showStatic(false);
        this.setStatus(
          `The interactive figure could not load (${detail}) The static figure is still available.`,
          'error',
        );
      } finally {
        this.loading = null;
        this.loadRequest = null;
        shell.removeAttribute('aria-busy');
        toggle.disabled = false;
        if (!this.chart) toggle.textContent = `Try interactive Figure ${this.figureId} again`;
      }
    })();

    return this.loading;
  }

  private showInteractive(): void {
    if (!this.chart || !this.payload) return;
    const staticPanel = requiredElement<HTMLElement>(this, '[data-plot-static]');
    const shell = requiredElement<HTMLElement>(this, '[data-plot-shell]');
    const toggle = requiredElement<HTMLButtonElement>(this, '[data-plot-toggle]');
    const reset = requiredElement<HTMLButtonElement>(this, '[data-plot-reset]');
    const seriesControls = requiredElement<HTMLFieldSetElement>(this, '[data-plot-series-controls]');

    staticPanel.hidden = true;
    shell.hidden = false;
    reset.hidden = false;
    seriesControls.hidden = this.chart.seriesNames.length < 2;
    toggle.textContent = `Show static Figure ${this.figureId}`;
    toggle.setAttribute('aria-expanded', 'true');
    this.dataset.view = 'interactive';
    this.setStatus(
      `Interactive Figure ${this.figureId} shown in Alaska local time. Hover or tap for values; drag the navigator below the plot to change the time window.`,
    );
    requestAnimationFrame(() => this.chart?.resize());
  }

  private showStatic(clearStatus = true): void {
    const staticPanel = requiredElement<HTMLElement>(this, '[data-plot-static]');
    const shell = requiredElement<HTMLElement>(this, '[data-plot-shell]');
    const toggle = requiredElement<HTMLButtonElement>(this, '[data-plot-toggle]');
    const reset = requiredElement<HTMLButtonElement>(this, '[data-plot-reset]');
    const seriesControls = requiredElement<HTMLFieldSetElement>(this, '[data-plot-series-controls]');

    staticPanel.hidden = false;
    shell.hidden = true;
    reset.hidden = true;
    seriesControls.hidden = true;
    toggle.textContent = this.chart
      ? `Explore Figure ${this.figureId} interactively`
      : `Try interactive Figure ${this.figureId} again`;
    toggle.setAttribute('aria-expanded', 'false');
    this.dataset.view = 'static';
    if (clearStatus) this.setStatus(`Static Figure ${this.figureId} shown.`);
  }

  private buildSeriesControls(names: string[]): void {
    const list = requiredElement<HTMLElement>(this, '[data-plot-series-list]');
    list.replaceChildren();
    names.forEach((name, index) => {
      const label = document.createElement('label');
      label.className = 'interactive-figure__series-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.dataset.seriesName = name;
      input.id = `glof-figure-${this.figureId}-series-${index}`;
      input.addEventListener('change', () => {
        this.chart?.setSeriesVisible(name, input.checked);
        this.setStatus(`${name} ${input.checked ? 'shown' : 'hidden'} in Figure ${this.figureId}.`);
      }, { signal: this.lifecycle?.signal });
      const text = document.createElement('span');
      text.textContent = name;
      label.append(input, text);
      list.append(label);
    });
  }

  private syncSeriesControls(selection: Record<string, boolean>): void {
    this.querySelectorAll<HTMLInputElement>('[data-series-name]').forEach((input) => {
      const name = input.dataset.seriesName;
      if (name && name in selection) input.checked = selection[name];
    });
  }

  private setStatus(message: string, tone: 'normal' | 'error' = 'normal'): void {
    const status = requiredElement<HTMLElement>(this, '[data-plot-status]');
    status.textContent = message;
    status.hidden = !message;
    status.dataset.tone = tone;
  }
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, InteractiveGlofFigure);
}
