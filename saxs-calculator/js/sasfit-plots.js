/**
 * sasfit-plots.js -- the Chart.js instances of the SAS fitting page: the
 * main chart (#sfMainChart), the residual chart (#sfResidualChart) and the
 * trend chart of a sequence (#sfSeqTrend)
 * (design spec 5.6, 7; plan M3 Task 11, M4 Task 9). Original code.
 *
 *   SasFitPlots.render(view) -> the main chart | null
 *       view is the one of SasFitPlotData (mainConfig / residualConfig). The
 *       charts are created on the first call and whenever view.mode changes
 *       (the axis types differ); otherwise the new datasets, annotations and
 *       axis titles are written into the existing instances, so a zoom is
 *       kept. null when Chart.js is not there (CDN not loaded or blocked) or
 *       the canvases are missing; nothing is thrown.
 *   SasFitPlots.resetZoom()        both charts, back to the default limits of the view drawn last
 *   SasFitPlots.isZoomed()         the main chart is zoomed or panned
 *   SasFitPlots.setZoomListener(fn)  fn(zoomed) after every zoom, pan and reset
 *   SasFitPlots.renderTrend(config | null) -> the trend chart | null
 *       config is SasFitSeqView.trendConfig's. Created on the first call (with
 *       the error bar plugin); later calls write the new dataset and the axis
 *       titles into the instance. null destroys it. null is also returned
 *       when Chart.js or the canvas is missing; nothing is thrown.
 *   SasFitPlots.getChart(canvasId) -> the instance | null
 *   SasFitPlots.destroy()          all three charts
 *   SasFitPlots.ERROR_BARS         the Chart.js plugin { id: 'sfErrorBars', beforeDatasetsDraw }
 *
 * Colours: none here. A chart is created with ChartTheme.colorize, and every
 * later change ends with ChartTheme.applyTo(chart): it colours the new
 * datasets and annotations and then updates (a bare chart.update() would
 * leave them in Chart.js's default colours). The error bars take the
 * borderColor ChartTheme has written into their dataset, so they follow a
 * theme change by themselves.
 *
 * Shared x axis: zoom and pan exist only on the main chart. Its x range is
 * copied into the residual chart on every render, after a zoom or a pan and
 * on resetZoom, so the residual chart never has a range of its own (its
 * points cover only the fit range and would otherwise not line up). Both
 * configs fix the width of the y axis (SasFitPlotData.Y_AXIS_WIDTH).
 *
 * Chart.js keeps the objects it is given, and its update API works on the
 * instance: writing into chart.config happens only here and in
 * ChartTheme.applyTo. The view and the configs of SasFitPlotData are never
 * modified. Nothing here touches document or Chart while the file loads.
 */

(function () {
    'use strict';

    const MAIN_ID = 'sfMainChart';
    const RESIDUAL_ID = 'sfResidualChart';
    const TREND_ID = 'sfSeqTrend';
    const ERROR_BARS_ID = 'sfErrorBars';
    const ERROR_BAR_WIDTH = 1;
    const NO_ANIMATION = 'none';
    const NO_CHARTS = Object.freeze({ main: null, residual: null, mode: null, listener: null, view: null, trend: null });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

    /** The two instances and the mode they were created for; replaced as a whole. */
    let charts = NO_CHARTS;

    // ------------------------------------------------------------- error bars

    /** [yTop, yBottom] in pixels of one bar inside the plot area, or null when there is nothing to draw. */
    function barEnds(point, yScale, area) {
        if (!isObject(point) || !isNumber(point.yMax)) return null;
        const top = yScale.getPixelForValue(point.yMax);
        const bottom = isNumber(point.yMin) ? yScale.getPixelForValue(point.yMin) : area.bottom;   // no lower end: down to the axis
        if (!isNumber(top) || !isNumber(bottom) || bottom < area.top || top > area.bottom) return null;
        return [Math.max(top, area.top), Math.min(bottom, area.bottom)];
    }

    /** The opacity of the bars, from the theme's palette (1 when the theme does not say). */
    function barAlpha() {
        const theme = host().ChartTheme;
        const alpha = isObject(theme) && typeof theme.palette === 'function' ? theme.palette().errorBarAlpha : NaN;
        return isNumber(alpha) && alpha > 0 && alpha <= 1 ? alpha : 1;
    }

    function drawBars(chart, dataset, elements) {
        const { ctx, chartArea: area } = chart;
        ctx.save();
        ctx.beginPath();
        dataset.data.forEach((point, k) => {
            const x = isObject(elements[k]) ? elements[k].x : NaN;
            if (!isNumber(x) || x < area.left || x > area.right) return;
            const ends = barEnds(point, chart.scales.y, area);
            if (ends === null) return;
            ctx.moveTo(x, ends[0]);
            ctx.lineTo(x, ends[1]);
        });
        ctx.strokeStyle = dataset.borderColor;        // already resolved by ChartTheme: follows the theme
        ctx.globalAlpha = barAlpha();                 // fainter than the points drawn over them
        ctx.lineWidth = ERROR_BAR_WIDTH;
        ctx.stroke();
        ctx.restore();
    }

    /** Drawn BEFORE the datasets, so that the points and the model curve lie on top of the bars. */
    const ERROR_BARS = Object.freeze({
        id: ERROR_BARS_ID,
        beforeDatasetsDraw(chart) {
            if (!isObject(chart.chartArea) || !isObject(chart.scales) || !isObject(chart.scales.y)) return;
            chart.data.datasets.forEach((dataset, i) => {
                if (dataset.sfErrorBars !== true || !chart.isDatasetVisible(i)) return;
                drawBars(chart, dataset, chart.getDatasetMeta(i).data);
            });
        },
    });

    // ------------------------------------------------------------- configs

    /** The main config with the error bar plugin and the zoom / pan callbacks. */
    function mainConfigOf(view) {
        const config = globalThis.SasFitPlotData.mainConfig(view);
        const { zoom } = config.options.plugins;
        return {
            ...config,
            plugins: [ERROR_BARS],
            options: {
                ...config.options,
                plugins: {
                    ...config.options.plugins,
                    zoom: {
                        ...zoom,
                        pan: { ...zoom.pan, onPanComplete: onViewChanged },
                        zoom: { ...zoom.zoom, onZoomComplete: onViewChanged },
                    },
                },
            },
        };
    }

    /** { min, max } of the main chart's x axis as it is drawn now, or null. */
    function xRangeOf(chart) {
        const x = chart !== null && isObject(chart.scales) ? chart.scales.x : null;
        return isObject(x) && isNumber(x.min) && isNumber(x.max) ? { min: x.min, max: x.max } : null;
    }

    /** The residual config on the x range of the main chart. */
    function residualConfigOf(view, main) {
        const config = globalThis.SasFitPlotData.residualConfig(view);
        const range = xRangeOf(main);
        if (range === null) return config;
        const { scales } = config.options;
        return { ...config, options: { ...config.options, scales: { ...scales, x: { ...scales.x, ...range } } } };
    }

    // ------------------------------------------------------------- instances

    function createChart(canvas, config) {
        const global = host();
        return new global.Chart(canvas, global.ChartTheme.colorize(config));
    }

    /** Write what a new view changes into an existing instance, then colour and update it. */
    function updateChart(chart, config) {
        const target = chart.config;
        const { scales, plugins } = config.options;
        target.data.datasets = config.data.datasets;
        target.options.plugins.annotation.annotations = plugins.annotation.annotations;
        if (isObject(plugins.legend) && isObject(target.options.plugins.legend) && typeof plugins.legend.display === 'boolean') {
            target.options.plugins.legend.display = plugins.legend.display;
        }
        const keepView = zoomedChart(chart);              // the user's zoom outlives new data; "reset" returns to the new limits
        ['x', 'y'].forEach((axis) => {
            target.options.scales[axis].title.text = scales[axis].title.text;
            if (!keepView) writeLimits(target.options.scales[axis], scales[axis]);
        });
        host().ChartTheme.applyTo(chart);
        return chart;
    }

    /** min / max of `from` into the scale options `to`; a limit the config does not give is taken away. */
    function writeLimits(to, from) {
        ['min', 'max'].forEach((key) => {
            if (isNumber(from[key])) to[key] = from[key]; else delete to[key];
        });
    }

    const zoomedChart = (chart) => chart !== null && typeof chart.isZoomedOrPanned === 'function' && chart.isZoomedOrPanned() === true;

    /** The main and the residual chart (their axis types depend on the mode); the trend chart is not theirs to take down. */
    function destroyCurves() {
        [charts.main, charts.residual].filter((chart) => chart !== null).forEach((chart) => chart.destroy());
        charts = Object.freeze({ ...NO_CHARTS, listener: charts.listener, view: charts.view, trend: charts.trend });
    }

    function destroyTrend() {
        if (charts.trend !== null) charts.trend.destroy();
        charts = Object.freeze({ ...charts, trend: null });
    }

    function destroy() {
        destroyCurves();
        destroyTrend();
    }

    /** After a zoom or a pan of the main chart: the residual chart follows, and the page is told. */
    function onViewChanged() {
        syncResidualX();
        if (typeof charts.listener === 'function') charts.listener(isZoomed());
    }

    /** fn(zoomed: boolean) is called after every zoom, pan and reset of the main chart; null removes it. */
    function setZoomListener(fn) {
        charts = Object.freeze({ ...charts, listener: typeof fn === 'function' ? fn : null });
    }

    const isZoomed = () => zoomedChart(charts.main);

    /** Copy the main chart's x range into the residual chart (after a zoom, a pan or a reset). */
    function syncResidualX() {
        const range = xRangeOf(charts.main);
        if (range === null || charts.residual === null) return;
        const x = charts.residual.config.options.scales.x;
        x.min = range.min;
        x.max = range.max;
        host().ChartTheme.applyTo(charts.residual);
    }

    function canvasOf(id) {
        return typeof document === 'undefined' ? null : document.getElementById(id);
    }

    function render(view) {
        const mainCanvas = canvasOf(MAIN_ID);
        const residualCanvas = canvasOf(RESIDUAL_ID);
        if (typeof host().Chart !== 'function' || !mainCanvas || !residualCanvas) return null;
        const keep = charts.main !== null && charts.mode === view.mode;
        if (!keep) destroyCurves();
        const main = keep ? updateChart(charts.main, mainConfigOf(view)) : createChart(mainCanvas, mainConfigOf(view));
        charts = Object.freeze({ ...charts, main, mode: view.mode });
        const residualConfig = residualConfigOf(view, main);
        const residual = keep ? updateChart(charts.residual, residualConfig) : createChart(residualCanvas, residualConfig);
        charts = Object.freeze({ ...charts, residual, view });
        return main;
    }

    /** Back to the default limits of the view drawn last (the data may have changed since the zoom began). */
    function resetZoom() {
        if (charts.main === null) return;
        if (typeof charts.main.resetZoom === 'function') charts.main.resetZoom(NO_ANIMATION);
        if (isObject(charts.view)) render(charts.view);
        onViewChanged();
    }

    // ------------------------------------------------------------- trend chart of a sequence

    /** The new dataset and axis titles into the existing trend chart, then colour and update it. */
    function updateTrend(chart, config) {
        const target = chart.config;
        target.data.datasets = config.data.datasets;
        ['x', 'y'].forEach((axis) => { target.options.scales[axis].title.text = config.options.scales[axis].title.text; });
        target.options.plugins.tooltip.callbacks = config.options.plugins.tooltip.callbacks;       // they name the axes
        host().ChartTheme.applyTo(chart);
        return chart;
    }

    function renderTrend(config) {
        if (config === null || config === undefined) {
            destroyTrend();
            return null;
        }
        const canvas = canvasOf(TREND_ID);
        if (typeof host().Chart !== 'function' || !canvas) return null;
        const trend = charts.trend === null ? createChart(canvas, { ...config, plugins: [ERROR_BARS] }) : updateTrend(charts.trend, config);
        charts = Object.freeze({ ...charts, trend });
        return trend;
    }

    const CHART_KEYS = Object.freeze({ [MAIN_ID]: 'main', [RESIDUAL_ID]: 'residual', [TREND_ID]: 'trend' });

    function getChart(canvasId) {
        return Object.prototype.hasOwnProperty.call(CHART_KEYS, canvasId) ? charts[CHART_KEYS[canvasId]] : null;
    }

    globalThis.SasFitPlots = Object.freeze({ ERROR_BARS, render, renderTrend, resetZoom, isZoomed, setZoomListener, getChart, destroy });
})();
