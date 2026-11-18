/**
 * sasfit-plots.js -- the two Chart.js instances of the SAS fitting page: the
 * main chart (#sfMainChart) and the residual chart (#sfResidualChart)
 * (design spec 5.6; plan M3 Task 11). Original code.
 *
 *   SasFitPlots.render(view) -> the main chart | null
 *       view is the one of SasFitPlotData (mainConfig / residualConfig). The
 *       charts are created on the first call and whenever view.mode changes
 *       (the axis types differ); otherwise the new datasets, annotations and
 *       axis titles are written into the existing instances, so a zoom is
 *       kept. null when Chart.js is not there (CDN not loaded or blocked) or
 *       the canvases are missing; nothing is thrown.
 *   SasFitPlots.resetZoom()        both charts
 *   SasFitPlots.getChart(canvasId) -> the instance | null
 *   SasFitPlots.destroy()
 *   SasFitPlots.ERROR_BARS         the Chart.js plugin { id: 'sfErrorBars', afterDatasetsDraw }
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
    const ERROR_BARS_ID = 'sfErrorBars';
    const ERROR_BAR_WIDTH = 1;
    const NO_ANIMATION = 'none';
    const NO_CHARTS = Object.freeze({ main: null, residual: null, mode: null });

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
        ctx.lineWidth = ERROR_BAR_WIDTH;
        ctx.stroke();
        ctx.restore();
    }

    const ERROR_BARS = Object.freeze({
        id: ERROR_BARS_ID,
        afterDatasetsDraw(chart) {
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
                        pan: { ...zoom.pan, onPanComplete: syncResidualX },
                        zoom: { ...zoom.zoom, onZoomComplete: syncResidualX },
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
        ['x', 'y'].forEach((axis) => { target.options.scales[axis].title.text = scales[axis].title.text; });
        if (isNumber(scales.x.min) && isNumber(scales.x.max)) {
            target.options.scales.x.min = scales.x.min;
            target.options.scales.x.max = scales.x.max;
        }
        host().ChartTheme.applyTo(chart);
        return chart;
    }

    function destroy() {
        [charts.main, charts.residual].filter((chart) => chart !== null).forEach((chart) => chart.destroy());
        charts = NO_CHARTS;
    }

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
        if (!keep) destroy();
        const main = keep ? updateChart(charts.main, mainConfigOf(view)) : createChart(mainCanvas, mainConfigOf(view));
        charts = Object.freeze({ ...charts, main, mode: view.mode });
        const residualConfig = residualConfigOf(view, main);
        const residual = keep ? updateChart(charts.residual, residualConfig) : createChart(residualCanvas, residualConfig);
        charts = Object.freeze({ ...charts, residual });
        return main;
    }

    function resetZoom() {
        if (charts.main === null) return;
        if (typeof charts.main.resetZoom === 'function') charts.main.resetZoom(NO_ANIMATION);
        syncResidualX();
    }

    function getChart(canvasId) {
        if (canvasId === MAIN_ID) return charts.main;
        return canvasId === RESIDUAL_ID ? charts.residual : null;
    }

    globalThis.SasFitPlots = Object.freeze({ ERROR_BARS, render, resetZoom, getChart, destroy });
})();
