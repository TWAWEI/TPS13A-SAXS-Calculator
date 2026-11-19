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
 *   rangeLines(mode, range)             dashed lines on the two ends of the fit range, role 'reference'
 *   logTickLabel(value)                 ticks.callback of the logarithmic axes (called with the scale as `this`)
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
 * of a reused series colour). Data points are hollow (tpsHollow). The curve
 * of the ACTIVE file has the role 'modelCurve' (its own colour, a legend entry
 * "模型"): in the series colour it could not be told from its own points (UI
 * review 2026-11-19, design spec 15). The other curves have the tpsSeries of
 * their data. The main chart starts on the data's x range (Guinier: on a low-q
 * window); zoom: Ctrl + wheel, pinch, a dragged box; pan: Shift + drag. The
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
    const POINT_RADIUS = Object.freeze({ active: 2, other: 1.5 });
    const LINE_WIDTH = Object.freeze({ active: 2, other: 1.5 });
    const ACTIVE_CURVE_ROLE = 'modelCurve';      // its own colour: a line in the series colour is lost among its points
    const LEGEND_MAX_SERIES = 6;                 // above it the legend is hidden: the file list carries the colour samples
    const LEGEND_BOX = 7;
    const RANGE_LINE_DASH = Object.freeze([4, 4]);
    const REFERENCE_ROLE = 'reference';
    const AXIS_PAD = 1.08;                       // logarithmic x axis: a little room outside the first and last q
    const GUINIER_DROP = 0.1;                    // default Guinier window: up to where I falls to a tenth of its low-q level
    const GUINIER_HEAD = 5;                      // points that give the low-q level
    const GUINIER_PAD = 0.3;                     // room above and below, in ln I
    // a smaller order is drawn on top: curves above points, the active file above the others
    const ORDER = Object.freeze({ activeCurve: 0, curve: 1, activeData: 2, data: 3 });
    const RESIDUAL_RADIUS = 2;
    const OUT_OF_RANGE = 'outOfRange';
    const AXIS_ROLE = 'grid';
    const X_TITLES = Object.freeze({ loglog: 'q (Å⁻¹)', guinier: 'q² (Å⁻²)', kratky: 'q (Å⁻¹)' });
    const Y_TITLES = Object.freeze({ loglog: 'I(q)', guinier: 'ln I(q)', kratky: 'q²·I(q)' });
    const Y_TITLES_ABSOLUTE = Object.freeze({ loglog: 'I(q) (cm⁻¹)', guinier: 'ln [I(q) / cm⁻¹]', kratky: 'q²·I(q) (Å⁻²·cm⁻¹)' });
    const STAGGER_NOTE = '（各組已錯開）';
    const RESIDUAL_TITLE = '(I − I模型)/w';      // the residual of design spec 4.8, w = the weight of the point
    const MODEL_LABEL = '模型';
    const CURVE_SUFFIX = '（模型）';
    const ZOOM_MODE = 'xy';
    const ZOOM_WHEEL_KEY = 'ctrl';
    const PAN_KEY = 'shift';
    const LAYOUT_PADDING = Object.freeze({ top: 6, right: 12 });      // room for a point on the edge; the same in both charts
    const LOG_TICK_MANTISSAS = Object.freeze([1, 2, 5]);
    const LOG_TICK_SPARSE = Object.freeze([1]);
    const LOG_TICK_SPARSE_DECADES = 3;        // a longer axis labels only the powers of ten
    const LOG_TICK_PLAIN = Object.freeze([-3, 5]);      // exponents written without an exponent: 0.001 ... 10000
    const LOG_TICK_DIGITS = 3;
    const LOG_TICK_EPS = 1e-9;
    const LOG_TICK_ROUND = 1e6;

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

    /** Dashed lines on the two ends of the fit range: the shading alone is too faint to rely on (1.25:1). */
    function rangeLines(mode, range) {
        assertMode(mode);
        if (!isObject(range)) return {};
        const line = (q) => ({ type: 'line', tpsRole: REFERENCE_ROLE, xMin: xOf(mode, q), xMax: xOf(mode, q),
            borderWidth: 1, borderDash: [...RANGE_LINE_DASH], drawTime: 'beforeDatasetsDraw' });
        const lines = {};
        if (Number.isFinite(range.qMin)) lines.sfRangeLowLine = line(range.qMin);
        if (Number.isFinite(range.qMax)) lines.sfRangeHighLine = line(range.qMax);
        return lines;
    }

    // ------------------------------------------------------------- shared options

    /** scales.y.afterFit of both charts: one width, so that the two plot areas line up. Chart.js calls it with its scale. */
    function fixYAxisWidth(scale) {
        scale.width = Y_AXIS_WIDTH;
    }

    /** The legend lists the files and the model curve of the active one; the other curves are in the colour of their file. */
    function legendFilter(item, data) {
        const dataset = data.datasets[item.datasetIndex];
        return dataset.sfKind !== 'curve' || dataset.sfLegend === true;
    }

    const plainNumber = (value) => String(Number(value.toPrecision(LOG_TICK_DIGITS)));

    /**
     * ticks.callback of a logarithmic axis; Chart.js calls it with its scale as `this`. Chart.js would print every
     * tick with the decimals of the smallest one ("1,000.0000"). Here: the powers of ten on a long axis, 1-2-5
     * per decade on a shorter one, every tick on an axis of less than one decade; no trailing zeros.
     */
    function logTickLabel(value) {
        if (!(value > 0) || !Number.isFinite(value)) return '';
        const decades = isObject(this) && this.min > 0 && Number.isFinite(this.max) ? Math.log10(this.max / this.min) : 0;
        if (decades > 0 && decades < 1) return plainNumber(value);
        const exponent = Math.floor(Math.log10(value) + LOG_TICK_EPS);
        const mantissa = Math.round(value / Math.pow(10, exponent) * LOG_TICK_ROUND) / LOG_TICK_ROUND;
        const wanted = decades > LOG_TICK_SPARSE_DECADES ? LOG_TICK_SPARSE : LOG_TICK_MANTISSAS;
        if (wanted.indexOf(mantissa) < 0) return '';
        return exponent >= LOG_TICK_PLAIN[0] && exponent < LOG_TICK_PLAIN[1] ? plainNumber(value) : mantissa + 'e' + exponent;
    }

    /**
     * afterBuildTicks of a logarithmic axis: keep only the ticks logTickLabel names, so that the unnamed ones do
     * not draw grid lines (nine per decade) or crowd the labels. Chart.js hands over its scale and reads
     * scale.ticks back; a filter that would leave fewer than two ticks changes nothing.
     */
    function keepLabelledTicks(scale) {
        const kept = scale.ticks.filter((tick) => logTickLabel.call(scale, tick.value) !== '');
        if (kept.length >= 2) scale.ticks = kept;
    }

    function axis(type, title, extra) {
        const theme = host().ChartTheme;
        const font = { family: theme.MONO, size: 10 };
        return {
            type, tpsRole: AXIS_ROLE,
            title: { display: true, text: title, font: { family: theme.FONT, size: 11 } },
            ticks: type === 'logarithmic' ? { font, autoSkip: false, callback: logTickLabel } : { font },
            ...(type === 'logarithmic' ? { afterBuildTicks: keepLabelledTicks } : {}),
            ...extra,
        };
    }

    /**
     * Zoom of the main chart: the wheel only with Ctrl (a plain wheel scrolls the page: the plot is sticky and
     * large), pinch, a dragged box; pan with Shift + drag. The residual chart has none of it.
     */
    function zoomOptions(zoomOn) {
        return {
            pan: { enabled: zoomOn, mode: ZOOM_MODE, modifierKey: PAN_KEY },
            zoom: {
                wheel: { enabled: zoomOn, modifierKey: ZOOM_WHEEL_KEY }, pinch: { enabled: zoomOn },
                drag: { enabled: zoomOn, borderWidth: 1 }, mode: ZOOM_MODE,
            },
        };
    }

    function baseOptions(zoomOn) {
        const theme = host().ChartTheme;
        return {
            responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
            // Chart.js pads a chart by the radius of its largest point; the two charts would then differ by a few pixels
            layout: { autoPadding: false, padding: { ...LAYOUT_PADDING } },
            plugins: {
                legend: { align: 'start', labels: { font: { family: theme.FONT, size: 11 }, usePointStyle: true,
                    boxWidth: LEGEND_BOX, boxHeight: LEGEND_BOX, padding: 8, filter: legendFilter } },
                tooltip: { cornerRadius: 8, padding: 10, titleFont: { family: theme.FONT, size: 12 }, bodyFont: { family: theme.MONO, size: 11 } },
                zoom: zoomOptions(zoomOn),
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
            label: s.label, data: t.points, tpsSeries: s.index, tpsHollow: true, showLine: false,
            pointStyle: POINT_STYLES[Math.floor(s.index / colours) % POINT_STYLES.length],
            pointRadius: active ? POINT_RADIUS.active : POINT_RADIUS.other,
            pointHoverRadius: (active ? POINT_RADIUS.active : POINT_RADIUS.other) + 1,
            borderWidth: 1, order: active ? ORDER.activeData : ORDER.data, sfKind: 'data', sfId: s.id,
        };
        return { dataset: active ? { ...dataset, sfErrorBars: true } : dataset, hidden: t.hidden };
    }

    function curveDataset(mode, source, factor, spec) {
        const c = curve(mode, source.q, source.I, factor, displayStride(source.q.length));
        // the active file's curve has its own colour and a legend entry; the others keep the colour of their file
        const colour = spec.active ? { tpsRole: ACTIVE_CURVE_ROLE, sfLegend: true, pointStyle: 'line' } : { tpsSeries: spec.index };
        const dataset = {
            label: spec.active ? MODEL_LABEL : spec.label, data: c.points, ...colour, showLine: true, spanGaps: false,
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

    // ------------------------------------------------------------- default axis limits

    const dataPoints = (datasets) => datasets.filter((d) => d.sfKind === 'data').flatMap((d) => d.data);

    function extent(values) {
        let min = Infinity;
        let max = -Infinity;
        values.forEach((v) => { if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } });
        return max >= min ? { min, max } : null;
    }

    /** The largest q of the default Guinier window: where the first shown file falls to GUINIER_DROP of its low-q level. */
    function guinierEnd(view) {
        const series = seriesOf(view);
        const lead = series.find((s) => s.active === true) || series[0];
        if (lead === undefined) return null;
        const { q, I } = lead.data;
        const usable = [];
        for (let i = 0; i < q.length; i++) if (usableQ(q[i]) && I[i] > 0) usable.push(i);
        if (usable.length === 0) return null;
        const level = Math.max(...usable.slice(0, GUINIER_HEAD).map((i) => I[i]));
        const at = usable.find((i) => I[i] < level * GUINIER_DROP);
        const end = at === undefined ? q[usable[usable.length - 1]] : q[at];
        const fitEnd = isObject(view.range) && Number.isFinite(view.range.qMax) && view.range.qMax > 0 ? view.range.qMax : Infinity;
        return Math.min(end, fitEnd);
    }

    /** Guinier: x from 0 to the window, y around the points inside it (Chart.js would scale y to every point). */
    function guinierLimits(view, datasets) {
        const end = guinierEnd(view);
        if (end === null) return {};
        const xMax = end * end;
        const y = extent(dataPoints(datasets).filter((p) => p.x <= xMax).map((p) => p.y));
        if (y === null) return {};
        return { x: { min: 0, max: xMax }, y: { min: y.min - GUINIER_PAD, max: y.max + GUINIER_PAD } };
    }

    /**
     * { x?: { min, max }, y?: { min, max } }: the limits the main chart starts with. The x axis is clamped to the
     * data (a preview drawn on a wider grid would otherwise stretch it); Guinier starts on its low-q window.
     * Nothing without data.
     */
    function defaultLimits(view, datasets) {
        if (view.mode === 'guinier') return guinierLimits(view, datasets);
        const x = extent(dataPoints(datasets).map((p) => p.x));
        if (x === null || !(x.max > x.min)) return {};
        return isLog(view.mode) ? { x: { min: x.min / AXIS_PAD, max: x.max * AXIS_PAD } } : { x: { min: 0, max: x.max } };
    }

    function mainConfig(view) {
        const { datasets } = buildMain(view);
        const options = baseOptions(true);
        const type = scaleType(view.mode);
        const limits = defaultLimits(view, datasets);
        const annotations = { ...rangeBoxes(view.mode, view.range), ...rangeLines(view.mode, view.range) };
        return {
            type: 'scatter',
            data: { datasets },
            options: {
                ...options,
                scales: {
                    x: axis(type, X_TITLES[view.mode], { grid: { display: false }, ...limits.x }),
                    y: axis(type, yTitle(view), { afterFit: fixYAxisWidth, ...limits.y }),
                },
                plugins: {
                    ...options.plugins,
                    legend: { ...options.plugins.legend, display: seriesOf(view).length <= LEGEND_MAX_SERIES },
                    annotation: { annotations },
                },
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
        MODES, DISPLAY_MAX_POINTS, Y_AXIS_WIDTH, POINT_STYLES, LEGEND_MAX_SERIES,
        logTickLabel, displayStride, staggerFactor, transform, curve, rangeBoxes, rangeLines, mainConfig, residualConfig, viewStats,
    });
})();
