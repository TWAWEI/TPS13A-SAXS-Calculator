/**
 * sasfit-plot-data.js -- the Chart.js configs of the SAS fitting page as pure
 * data (design spec 4.8, 5.2, 5.6; plan M3 Task 9). Original code.
 *
 *   displayStride(n)                    1 up to DISPLAY_MAX_POINTS, else ceil(n / DISPLAY_MAX_POINTS)
 *   staggerFactor(stagger, k)           10^(k * decades) for dataset k of the display order; 1 when off
 *   transform(mode, { q, I, sigma }, factor = 1, stride = 1) -> { points: [{ x, y, yMin, yMax }], hidden }
 *       loglog   x = q,   y = I*f;             bars (I -+ sigma)*f; I <= 0 is hidden
 *       guinier  x = q^2, y = ln I + ln f;     bars -+ sigma/I (symmetric); I <= 0 is hidden; every q is drawn
 *       kratky   x = q,   y = q^2*I*f;         bars -+ q^2*sigma*f; negative I is drawn
 *     A point with a non-finite q or I, or q <= 0, is hidden in every mode. yMin / yMax are null without a
 *     usable sigma (not finite or <= 0); in loglog yMin is null when I - sigma <= 0 and the bar runs to the
 *     bottom of the plot (the error bar plugin of SasFitPlots reads both). With a stride the points 0, k, 2k,
 *     ... and the last one are taken; hidden counts only among those.
 *   curve(mode, q, I, factor = 1, stride = 1) -> { points: [{ x, y }], nonFinite }
 *       A model value that cannot be drawn (not finite; <= 0 in loglog and guinier) is y: NaN, a gap in the
 *       line. Points whose q cannot be on the axis are left out. nonFinite counts the non-finite values of
 *       the whole I (hayter_msa: expected input, design spec 16).
 *   rangeBoxes(mode, range)             annotation boxes outside the fit range, role 'outOfRange'; {} without one
 *   mainConfig(view), residualConfig(view)   Chart.js configs
 *   viewStats(view) -> { hidden, displayStride, nonFinite, points } for the status line (SasFitHints.plotStatus)
 *       view = { mode, series: [{ id, index, label, active, data: Dataset, fitCurve: { q, I } | null }],
 *                preview: { q, I } | null, range: { qMin, qMax } | null, stagger: { on, decades },
 *                residuals: { q, r } | null }
 *     series comes from SasFitState.shownFiles (index = position in the file list = colour). The curve of the
 *     active file is view.preview, else its fitCurve; the other files draw their fitCurve. Without files a
 *     preview is one line of series 0. residuals belong to the active file (q of its data, r of its FitResult).
 *
 * Colours: none here. Datasets, scales and annotations only carry tpsRole or
 * tpsSeries; js/chart-theme.js turns them into colours (and dashes the lines
 * of a reused series colour). A curve has the tpsSeries of its data. The
 * scales carry the neutral role 'grid', which is the colour an untagged axis
 * line gets anyway. Datasets also carry sfKind ('data' | 'curve' |
 * 'residual'), sfId and, on the active data, sfErrorBars: true.
 *
 * Display only: staggering and decimation never reach the fit. Nothing given
 * is modified; every call returns new objects. Pure: no DOM, no Chart, no
 * timers; ChartTheme is read through host() at call time (fonts and the
 * number of series colours).
 */

(function () {
    'use strict';

    const MODES = Object.freeze(['loglog', 'guinier', 'kratky']);
    const DISPLAY_MAX_POINTS = 5000;
    const Y_AXIS_WIDTH = 72;
    const POINT_STYLES = Object.freeze(['circle', 'rect', 'triangle', 'rectRot']);
    const POINT_RADIUS = Object.freeze({ active: 3, other: 2 });
    const LINE_WIDTH = Object.freeze({ active: 2.5, other: 1.5 });
    // a smaller order is drawn on top: curves above points, the active file above the others
    const ORDER = Object.freeze({ activeCurve: 0, curve: 1, activeData: 2, data: 3 });
    const RESIDUAL_RADIUS = 2;
    const OUT_OF_RANGE = 'outOfRange';
    const AXIS_ROLE = 'grid';
    const X_TITLES = Object.freeze({ loglog: 'q (Å⁻¹)', guinier: 'q² (Å⁻²)', kratky: 'q (Å⁻¹)' });
    const Y_TITLES = Object.freeze({ loglog: 'I(q)', guinier: 'ln I(q)', kratky: 'q²·I(q)' });
    const Y_TITLES_ABSOLUTE = Object.freeze({ loglog: 'I(q) (cm⁻¹)', guinier: 'ln [I(q) / cm⁻¹]', kratky: 'q²·I(q) (Å⁻²·cm⁻¹)' });
    const STAGGER_NOTE = '（各組已錯開）';
    const RESIDUAL_TITLE = '殘差';
    const MODEL_LABEL = '模型';
    const CURVE_SUFFIX = '（模型）';

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isLog = (mode) => mode === 'loglog';
    const usableQ = (q) => Number.isFinite(q) && q > 0;
    const xOf = (mode, q) => (mode === 'guinier' ? q * q : q);

    function assertMode(mode) {
        if (MODES.indexOf(mode) < 0) throw new Error('Unknown plot mode: ' + String(mode));
    }

    function assertSameLength(a, b, what) {
        if (!isObject(a) || !isObject(b) || a.length !== b.length) throw new Error(what + ' must have the same length');
    }

    function displayStride(n) {
        return n > DISPLAY_MAX_POINTS ? Math.ceil(n / DISPLAY_MAX_POINTS) : 1;
    }

    /** The indices 0, stride, 2*stride, ... below n, and n - 1. */
    function strideIndices(n, stride) {
        if (!Number.isInteger(stride) || stride < 1) throw new Error('stride must be a positive integer, got ' + String(stride));
        const out = [];
        for (let i = 0; i < n; i += stride) out.push(i);
        if (n > 0 && out[out.length - 1] !== n - 1) out.push(n - 1);
        return out;
    }

    function factorOf(factor) {
        const f = factor === undefined ? 1 : factor;
        if (!Number.isFinite(f) || !(f > 0)) throw new Error('factor must be a positive finite number, got ' + String(factor));
        return f;
    }

    function staggerFactor(stagger, k) {
        if (!isObject(stagger) || stagger.on !== true || !Number.isFinite(stagger.decades)) return 1;
        return Math.pow(10, k * stagger.decades);
    }

    // ------------------------------------------------------------- data points

    /** One data point in a mode, or null when it cannot be shown. sigma is NaN when there is none. */
    const POINT = Object.freeze({
        loglog(q, I, sigma, f) {
            if (!(I > 0)) return null;
            const low = I - sigma;
            return { x: q, y: I * f, yMin: sigma > 0 ? (low > 0 ? low * f : null) : null, yMax: sigma > 0 ? (I + sigma) * f : null };
        },
        guinier(q, I, sigma, f) {
            if (!(I > 0)) return null;
            const y = Math.log(I) + Math.log(f);
            const half = sigma / I;
            return { x: q * q, y, yMin: sigma > 0 ? y - half : null, yMax: sigma > 0 ? y + half : null };
        },
        kratky(q, I, sigma, f) {
            const y = q * q * I * f;
            const half = q * q * sigma * f;
            return { x: q, y, yMin: sigma > 0 ? y - half : null, yMax: sigma > 0 ? y + half : null };
        },
    });

    function transform(mode, data, factor, stride) {
        assertMode(mode);
        const f = factorOf(factor);
        const { q, I } = data;
        assertSameLength(q, I, 'q and I');
        const sigma = isObject(data.sigma) ? data.sigma : null;
        const points = [];
        let hidden = 0;
        strideIndices(q.length, stride === undefined ? 1 : stride).forEach((i) => {
            const s = sigma !== null && Number.isFinite(sigma[i]) ? sigma[i] : NaN;
            const point = usableQ(q[i]) && Number.isFinite(I[i]) ? POINT[mode](q[i], I[i], s, f) : null;
            if (point === null) hidden += 1; else points.push(point);
        });
        return { points, hidden };
    }

    // ------------------------------------------------------------- model curves

    /** The y of a model value in a mode; NaN where it cannot be drawn. */
    function curveY(mode, q, I, f) {
        if (!Number.isFinite(I)) return NaN;
        if (mode === 'kratky') return q * q * I * f;
        if (!(I > 0)) return NaN;
        return mode === 'guinier' ? Math.log(I) + Math.log(f) : I * f;
    }

    function curve(mode, q, I, factor, stride) {
        assertMode(mode);
        const f = factorOf(factor);
        assertSameLength(q, I, 'q and I of a curve');
        let nonFinite = 0;
        for (let i = 0; i < I.length; i++) if (!Number.isFinite(I[i])) nonFinite += 1;
        const points = strideIndices(q.length, stride === undefined ? 1 : stride)
            .filter((i) => usableQ(q[i]))
            .map((i) => ({ x: xOf(mode, q[i]), y: curveY(mode, q[i], I[i], f) }));
        return { points, nonFinite };
    }

    // ------------------------------------------------------------- fit range

    function rangeBoxes(mode, range) {
        assertMode(mode);
        if (!isObject(range)) return {};
        const box = (edge) => ({ type: 'box', tpsRole: OUT_OF_RANGE, ...edge, borderWidth: 0, drawTime: 'beforeDatasetsDraw' });
        const boxes = {};
        if (Number.isFinite(range.qMin)) boxes.sfRangeLow = box({ xMax: xOf(mode, range.qMin) });
        if (Number.isFinite(range.qMax)) boxes.sfRangeHigh = box({ xMin: xOf(mode, range.qMax) });
        return boxes;
    }

    // ------------------------------------------------------------- shared options

    /** scales.y.afterFit of both charts: one width, so that the two plot areas line up. Chart.js calls it with its scale. */
    function fixYAxisWidth(scale) {
        scale.width = Y_AXIS_WIDTH;
    }

    /** The legend lists the files; a curve is in the colour of its file. */
    function legendFilter(item, data) {
        return data.datasets[item.datasetIndex].sfKind !== 'curve';
    }

    function axis(type, title, extra) {
        const theme = host().ChartTheme;
        return {
            type, tpsRole: AXIS_ROLE,
            title: { display: true, text: title, font: { family: theme.FONT, size: 11 } },
            ticks: { font: { family: theme.MONO, size: 10 } },
            ...extra,
        };
    }

    function baseOptions(zoomOn) {
        const theme = host().ChartTheme;
        return {
            responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
            plugins: {
                legend: { labels: { font: { family: theme.FONT, size: 12 }, usePointStyle: true, filter: legendFilter } },
                tooltip: { cornerRadius: 8, padding: 10, titleFont: { family: theme.FONT, size: 12 }, bodyFont: { family: theme.MONO, size: 11 } },
                zoom: { pan: { enabled: zoomOn, mode: 'xy' }, zoom: { wheel: { enabled: zoomOn }, pinch: { enabled: zoomOn }, mode: 'xy' } },
            },
        };
    }

    const scaleType = (mode) => (isLog(mode) ? 'logarithmic' : 'linear');

    // ------------------------------------------------------------- main chart

    const seriesOf = (view) => (Array.isArray(view.series) ? view.series : []);
    const curveOf = (view, s) => (s.active === true && isObject(view.preview) ? view.preview : s.fitCurve);

    function dataDataset(mode, s, factor) {
        const colours = host().ChartTheme.PALETTES.light.series.length;
        const t = transform(mode, s.data, factor, displayStride(s.data.q.length));
        const active = s.active === true;
        const dataset = {
            label: s.label, data: t.points, tpsSeries: s.index, showLine: false,
            pointStyle: POINT_STYLES[Math.floor(s.index / colours) % POINT_STYLES.length],
            pointRadius: active ? POINT_RADIUS.active : POINT_RADIUS.other,
            pointHoverRadius: (active ? POINT_RADIUS.active : POINT_RADIUS.other) + 1,
            borderWidth: 1, order: active ? ORDER.activeData : ORDER.data, sfKind: 'data', sfId: s.id,
        };
        return { dataset: active ? { ...dataset, sfErrorBars: true } : dataset, hidden: t.hidden };
    }

    function curveDataset(mode, source, factor, spec) {
        const c = curve(mode, source.q, source.I, factor, displayStride(source.q.length));
        const dataset = {
            label: spec.label, data: c.points, tpsSeries: spec.index, showLine: true, spanGaps: false,
            pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,
            borderWidth: spec.active ? LINE_WIDTH.active : LINE_WIDTH.other,
            order: spec.active ? ORDER.activeCurve : ORDER.curve, sfKind: 'curve', sfId: spec.id,
        };
        return { dataset, nonFinite: c.nonFinite };
    }

    /** The datasets of the main chart and what the status line needs to know about them. */
    function buildMain(view) {
        assertMode(view.mode);
        const series = seriesOf(view);
        const datasets = [];
        const stats = { hidden: 0, displayStride: 1, nonFinite: 0, points: 0 };
        series.forEach((s, k) => {
            const factor = staggerFactor(view.stagger, k);
            const data = dataDataset(view.mode, s, factor);
            datasets.push(data.dataset);
            stats.hidden += data.hidden;
            stats.points += data.dataset.data.length;
            stats.displayStride = Math.max(stats.displayStride, displayStride(s.data.q.length));
            const source = curveOf(view, s);
            if (!isObject(source)) return;
            const line = curveDataset(view.mode, source, factor, { label: s.label + CURVE_SUFFIX, index: s.index, active: s.active === true, id: s.id });
            datasets.push(line.dataset);
            if (s.active === true) stats.nonFinite = line.nonFinite;
        });
        if (series.length === 0 && isObject(view.preview)) {
            const line = curveDataset(view.mode, view.preview, 1, { label: MODEL_LABEL, index: 0, active: true, id: null });
            datasets.push(line.dataset);
            stats.nonFinite = line.nonFinite;
        }
        return { datasets, stats };
    }

    function yTitle(view) {
        const series = seriesOf(view);
        const absolute = series.length > 0 && series.every((s) => s.data.kind === 'official');
        const staggered = series.length > 1 && series.some((s, k) => staggerFactor(view.stagger, k) !== 1);
        return (absolute ? Y_TITLES_ABSOLUTE : Y_TITLES)[view.mode] + (staggered ? STAGGER_NOTE : '');
    }

    function mainConfig(view) {
        const { datasets } = buildMain(view);
        const options = baseOptions(true);
        const type = scaleType(view.mode);
        return {
            type: 'scatter',
            data: { datasets },
            options: {
                ...options,
                scales: {
                    x: axis(type, X_TITLES[view.mode], { grid: { display: false } }),
                    y: axis(type, yTitle(view), { afterFit: fixYAxisWidth }),
                },
                plugins: { ...options.plugins, annotation: { annotations: rangeBoxes(view.mode, view.range) } },
            },
        };
    }

    function viewStats(view) {
        return buildMain(view).stats;
    }

    // ------------------------------------------------------------- residual chart

    function residualPoints(mode, residuals) {
        if (!isObject(residuals)) return [];
        const { q, r } = residuals;
        assertSameLength(q, r, 'q and r of the residuals');
        return strideIndices(q.length, displayStride(q.length))
            .filter((i) => usableQ(q[i]) && Number.isFinite(r[i]))
            .map((i) => ({ x: xOf(mode, q[i]), y: r[i] }));
    }

    function residualConfig(view) {
        assertMode(view.mode);
        const options = baseOptions(false);
        const active = seriesOf(view).find((s) => s.active === true);
        return {
            type: 'scatter',
            data: { datasets: [{
                label: RESIDUAL_TITLE, data: residualPoints(view.mode, view.residuals), tpsRole: 'residual', showLine: false,
                pointRadius: RESIDUAL_RADIUS, pointHoverRadius: RESIDUAL_RADIUS + 1, borderWidth: 1,
                sfKind: 'residual', sfId: active === undefined ? null : active.id,
            }] },
            options: {
                ...options,
                scales: {
                    x: axis(scaleType(view.mode), X_TITLES[view.mode], { grid: { display: false } }),
                    y: axis('linear', RESIDUAL_TITLE, { afterFit: fixYAxisWidth }),
                },
                plugins: {
                    ...options.plugins,
                    legend: { display: false },
                    annotation: { annotations: { sfZero: { type: 'line', tpsRole: 'reference', yMin: 0, yMax: 0, borderWidth: 1, drawTime: 'beforeDatasetsDraw' } } },
                },
            },
        };
    }

    globalThis.SasFitPlotData = Object.freeze({
        MODES, DISPLAY_MAX_POINTS, Y_AXIS_WIDTH, POINT_STYLES,
        displayStride, staggerFactor, transform, curve, rangeBoxes, mainConfig, residualConfig, viewStats,
    });
})();
