'use strict';
/**
 * sasfit-plot-data.js: Chart.js configs of the SAS fitting page as pure data
 * (design spec 4.8, 5.2, 5.6; plan M3 Task 9). Expected values are worked out
 * by hand in the tests. No Chart, no DOM: the configs are only inspected and
 * passed through ChartTheme.colorize (which lives on the fake `window`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitPlotData: P, SasFitState: S, ChartTheme } = require('./load.js');

const f64 = (values) => Float64Array.from(values);
const near = (got, want, label) => assert.ok(Math.abs(got - want) <= 1e-12 * Math.max(1, Math.abs(want)), (label || '') + ' ' + got + ' vs ' + want);
const DATA = Object.freeze({ q: f64([0.01, 0.02, 0.05, 0.1]), I: f64([100, 50, -1, 4]), sigma: f64([10, 60, 1, 0]) });

function dataset(n, overrides) {
    const q = f64(Array.from({ length: n }, (_, i) => 0.01 * (i + 1)));
    return { fileName: 'a.dat', kind: 'official', header: null, q, I: q.map((x) => 1 / x), sigma: q.map(() => 0.5),
        dq: null, condition: null, qUnit: 'A', ...overrides };
}
const serie = (index, overrides) => ({ id: 'd' + (index + 1), index, label: 'file' + index + '.dat', active: false,
    data: dataset(4), fitCurve: null, ...overrides });
const view = (overrides) => ({ mode: 'loglog', series: [], preview: null, range: null, stagger: { on: false, decades: 1 },
    residuals: null, ...overrides });
const COLOUR_KEYS = ['borderColor', 'backgroundColor', 'color', 'pointBackgroundColor', 'pointBorderColor', 'fill',
    'titleColor', 'bodyColor'];

/** Every [path, key] of an object tree; data point arrays are not entered. */
function walk(node, path, visit) {
    if (node === null || typeof node !== 'object' || ArrayBuffer.isView(node)) return;
    Object.keys(node).forEach((key) => {
        visit(path, key, node[key]);
        if (!(key === 'data' && Array.isArray(node[key]))) walk(node[key], path.concat(key), visit);
    });
}
function colourKeys(config) {
    const found = [];
    walk(config, [], (path, key) => { if (COLOUR_KEYS.includes(key)) found.push(path.concat(key).join('.')); });
    return found;
}
const kinds = (config) => config.data.datasets.map((d) => d.sfKind + ':' + (d.tpsRole === undefined ? d.tpsSeries : d.tpsRole) + ':' + d.sfId);

// ------------------------------------------------------------------ module shape

test('SasFitPlotData is one frozen export with the constants of the plan and no DOM, Chart or colour in its source', () => {
    assert.equal(globalThis.SasFitPlotData, P);
    assert.ok(Object.isFrozen(P));
    assert.deepEqual(P.MODES, ['loglog', 'guinier', 'kratky', 'porod']);
    assert.deepEqual(P.MODES, S.PLOT_MODES);
    assert.equal(P.DISPLAY_MAX_POINTS, 5000);
    assert.equal(P.Y_AXIS_WIDTH, 72);
    assert.deepEqual(P.POINT_STYLES, ['circle', 'rect', 'triangle', 'rectRot']);
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'sasfit-plot-data.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bdocument\b|\bnew\s+\w*\.?Chart\b|\.Chart\b|setTimeout|setInterval|requestAnimationFrame/.test(code));
    assert.ok(!/[cC]olor\s*:/.test(code), 'no colour property is set by this module');
    assert.ok(!/tpsRole:\s*'model'/.test(code));
});

// ------------------------------------------------------------------ stride

test('displayStride: 1 up to 5000 points, then ceil(n / 5000)', () => {
    assert.equal(P.displayStride(0), 1);
    assert.equal(P.displayStride(5000), 1);
    assert.equal(P.displayStride(5001), 2);
    assert.equal(P.displayStride(10000), 2);
    assert.equal(P.displayStride(12000), 3);
    assert.equal(P.displayStride(100000), 20);
});

test('transform with a stride takes 0, k, 2k, ... and always the last point; hidden counts only the points taken', () => {
    const q = f64(Array.from({ length: 12 }, (_, i) => i + 1));
    const I = f64([1, -1, -1, -1, -1, 6, -1, -1, -1, -1, 11, 12]);
    const five = P.transform('loglog', { q, I, sigma: null }, 1, 5);
    assert.deepEqual(five.points.map((p) => p.x), [1, 6, 11, 12]);
    assert.equal(five.hidden, 0, 'the eight negative points were not taken');
    const eleven = P.transform('loglog', { q: q.subarray(0, 11), I: I.subarray(0, 11), sigma: null }, 1, 5);
    assert.deepEqual(eleven.points.map((p) => p.x), [1, 6, 11]);
    const three = P.transform('loglog', { q, I, sigma: null }, 1, 3);       // 0, 3, 6, 9 and the last
    assert.deepEqual(three.points.map((p) => p.x), [1, 12]);
    assert.equal(three.hidden, 3);
    assert.deepEqual(P.transform('loglog', { q, I, sigma: null }).points.map((p) => p.x), [1, 6, 11, 12], 'factor and stride default to 1');
    assert.deepEqual(P.transform('loglog', { q: f64([]), I: f64([]), sigma: null }, 1, 1), { points: [], hidden: 0 });
});

// ------------------------------------------------------------------ transforms (hand-computed)

test("transform('loglog'): x = q, y = I*f; I <= 0, q <= 0 and non-finite points are hidden; error bars (I -+ sigma)*f", () => {
    const t = P.transform('loglog', DATA, 1, 1);
    assert.deepEqual(t.points, [
        { x: 0.01, y: 100, yMin: 90, yMax: 110 },
        { x: 0.02, y: 50, yMin: null, yMax: 110 },          // I - sigma = -10: the bar runs to the bottom of the plot
        { x: 0.1, y: 4, yMin: null, yMax: null },            // sigma = 0 is no error
    ]);
    assert.equal(t.hidden, 1);
    const ten = P.transform('loglog', DATA, 10, 1);
    assert.deepEqual(ten.points[0], { x: 0.01, y: 1000, yMin: 900, yMax: 1100 });
    assert.deepEqual(ten.points[1], { x: 0.02, y: 500, yMin: null, yMax: 1100 });

    const odd = { q: f64([0, -1, NaN, 0.1, 0.2, 0.3, 0.4]), I: f64([5, 5, 5, 0, NaN, Infinity, 7]), sigma: f64([1, 1, 1, 1, 1, 1, NaN]) };
    const o = P.transform('loglog', odd, 1, 1);
    assert.deepEqual(o.points, [{ x: 0.4, y: 7, yMin: null, yMax: null }]);
    assert.equal(o.hidden, 6);
    const noSigma = P.transform('loglog', { q: DATA.q, I: DATA.I, sigma: null }, 1, 1);
    assert.ok(noSigma.points.every((p) => p.yMin === null && p.yMax === null));
    assert.equal(P.transform('loglog', { q: DATA.q, I: DATA.I }, 1, 1).points.length, 3, 'a dataset without the key');
});

test("transform('guinier'): x = q^2, y = ln I + ln f, symmetric error sigma/I, every q kept, I <= 0 hidden", () => {
    const t = P.transform('guinier', DATA, 1, 1);
    assert.equal(t.points.length, 3);
    assert.equal(t.hidden, 1);
    near(t.points[0].x, 1e-4);
    near(t.points[0].y, 4.605170185988092);                   // ln 100
    near(t.points[0].yMin, 4.605170185988092 - 0.1);          // sigma / I = 10 / 100
    near(t.points[0].yMax, 4.605170185988092 + 0.1);
    near(t.points[1].x, 4e-4);
    near(t.points[1].y, 3.912023005428146);                   // ln 50
    near(t.points[1].yMin, 3.912023005428146 - 1.2);          // 60 / 50: symmetric even when I - sigma < 0
    near(t.points[1].yMax, 3.912023005428146 + 1.2);
    near(t.points[2].x, 0.01);
    near(t.points[2].y, 1.3862943611198906);                  // ln 4
    assert.equal(t.points[2].yMin, null);
    assert.equal(t.points[2].yMax, null);
    // staggering is an addition in log space: dataset k = 2, n = 1 decade -> + 2 ln 10
    const shifted = P.transform('guinier', DATA, 100, 1);
    near(shifted.points[0].y, 4.605170185988092 + 2 * 2.302585092994046);
    near(shifted.points[0].yMax - shifted.points[0].yMin, 0.2, 'the error does not scale');
    const wide = P.transform('guinier', { q: f64([0.5, 1, 2]), I: f64([3, 2, 1]), sigma: null }, 1, 1);
    assert.deepEqual(wide.points.map((p) => p.x), [0.25, 1, 4], 'no q cut-off: the whole dataset is drawn');
});

test("transform('kratky'): x = q, y = q^2*I*f, error q^2*sigma*f; negative intensities are drawn", () => {
    const t = P.transform('kratky', DATA, 1, 1);
    assert.equal(t.points.length, 4);
    assert.equal(t.hidden, 0);
    near(t.points[0].y, 0.01);                                // 1e-4 * 100
    near(t.points[0].yMin, 0.009);
    near(t.points[0].yMax, 0.011);
    near(t.points[2].x, 0.05);
    near(t.points[2].y, -0.0025);                             // 0.0025 * -1
    near(t.points[2].yMin, -0.005);
    near(t.points[2].yMax, 0);
    near(t.points[3].y, 0.04);
    assert.equal(t.points[3].yMin, null);
    const ten = P.transform('kratky', DATA, 10, 1);
    near(ten.points[0].y, 0.1);
    near(ten.points[0].yMin, 0.09);
    const odd = P.transform('kratky', { q: f64([0, NaN, 0.1, 0.2]), I: f64([1, 1, NaN, -3]), sigma: null }, 1, 1);
    assert.equal(odd.points.length, 1);
    near(odd.points[0].y, -0.12);
    assert.equal(odd.hidden, 3, 'only q <= 0 and non-finite values');
    const porodOdd = P.transform('porod', { q: f64([0, NaN, 0.1, 0.2, -0.1, 0.3]), I: f64([1, 1, NaN, -3, 2, Infinity]), sigma: null }, 1, 1);
    assert.equal(porodOdd.points.length, 1);
    near(porodOdd.points[0].y, -0.0048);                      // 0.2^4 * -3
    assert.equal(porodOdd.hidden, 5, 'porod hides exactly what kratky hides: q <= 0 and non-finite values');
});

test('transform: an unknown mode or a bad factor throws; the input arrays are not written to', () => {
    assert.throws(() => P.transform('linear', DATA, 1, 1), /Unknown plot mode/);
    [0, -1, NaN, Infinity].forEach((f) => assert.throws(() => P.transform('loglog', DATA, f, 1), /factor/));
    [0, -1, 1.5, NaN].forEach((s) => assert.throws(() => P.transform('loglog', DATA, 1, s), /stride/));
    const copy = { q: Array.from(DATA.q), I: Array.from(DATA.I), sigma: Array.from(DATA.sigma) };
    P.MODES.forEach((mode) => P.transform(mode, DATA, 1000, 1));
    assert.deepEqual({ q: Array.from(DATA.q), I: Array.from(DATA.I), sigma: Array.from(DATA.sigma) }, copy);
});

test('staggerFactor: dataset k of the display order is multiplied by 10^(k*n); off means 1', () => {
    assert.equal(P.staggerFactor({ on: true, decades: 1 }, 0), 1);
    assert.equal(P.staggerFactor({ on: true, decades: 1 }, 3), 1000);
    assert.equal(P.staggerFactor({ on: true, decades: 2 }, 2), 10000);
    near(P.staggerFactor({ on: true, decades: 0.5 }, 1), Math.sqrt(10));
    assert.equal(P.staggerFactor({ on: false, decades: 2 }, 2), 1);
    assert.equal(P.staggerFactor(null, 2), 1);
    assert.equal(P.staggerFactor({ on: true, decades: NaN }, 2), 1);
});

// ------------------------------------------------------------------ model curves

test("transform('porod'): x = q, y = q^4*I*f, error q^4*sigma*f, both axes as measured (no background is taken off); negative intensities are drawn", () => {
    const t = P.transform('porod', DATA, 1, 1);
    assert.equal(t.points.length, 4);
    assert.equal(t.hidden, 0);
    assert.deepEqual(t.points.map((p) => p.x), [0.01, 0.02, 0.05, 0.1]);
    near(t.points[0].y, 1e-6);                                // 1e-8 * 100
    near(t.points[0].yMin, 0.9e-6);
    near(t.points[0].yMax, 1.1e-6);
    near(t.points[1].y, 8e-6);                                // 1.6e-7 * 50
    near(t.points[1].yMin, -1.6e-6, 'a bar may go below zero on a linear axis');
    near(t.points[2].y, -6.25e-6);                            // 6.25e-6 * -1
    near(t.points[2].yMin, -1.25e-5);
    near(t.points[2].yMax, 0);
    near(t.points[3].y, 4e-4);
    assert.deepEqual([t.points[3].yMin, t.points[3].yMax], [null, null], 'sigma 0: no bar');
    const ten = P.transform('porod', DATA, 10, 1);
    near(ten.points[0].y, 1e-5);
    near(ten.points[0].yMax, 1.1e-5);
    assert.equal(P.transform('porod', { q: DATA.q, I: DATA.I, sigma: null }, 1, 1).points[0].yMax, null);
});

test('curve: a model value that cannot be drawn is a gap (NaN), not a missing point; nonFinite counts the non-finite ones', () => {
    const q = f64([0.01, 0.02, 0.03, 0.04, 0.05]);
    const I = f64([10, NaN, 0, -2, Infinity]);
    const log = P.curve('loglog', q, I, 1);
    assert.deepEqual(log.points.map((p) => p.x), [0.01, 0.02, 0.03, 0.04, 0.05]);
    assert.deepEqual(log.points.map((p) => p.y), [10, NaN, NaN, NaN, NaN]);
    assert.equal(log.nonFinite, 2);
    const guinier = P.curve('guinier', q, I, 1);
    near(guinier.points[0].x, 1e-4);
    near(guinier.points[0].y, Math.log(10));
    assert.deepEqual(guinier.points.slice(1).map((p) => p.y), [NaN, NaN, NaN, NaN]);
    assert.equal(guinier.nonFinite, 2);
    const kratky = P.curve('kratky', q, I, 10);
    near(kratky.points[0].y, 0.01);                           // 1e-4 * 10 * 10
    near(kratky.points[2].y, 0);
    near(kratky.points[3].y, -0.032);                         // 0.0016 * -2 * 10
    assert.deepEqual([kratky.points[1].y, kratky.points[4].y], [NaN, NaN]);
    assert.equal(kratky.nonFinite, 2);
    const porod = P.curve('porod', q, I, 10);
    assert.deepEqual(porod.points.map((p) => p.x), [0.01, 0.02, 0.03, 0.04, 0.05]);
    near(porod.points[0].y, 1e-6);                            // 1e-8 * 10 * 10
    near(porod.points[2].y, 0);
    near(porod.points[3].y, -5.12e-5);                        // 2.56e-6 * -2 * 10
    assert.deepEqual([porod.points[1].y, porod.points[4].y], [NaN, NaN]);
    assert.equal(porod.nonFinite, 2);
    near(P.curve('loglog', q, I, 100).points[0].y, 1000);
    assert.ok(log.points.every((p) => !('yMin' in p)));
});

test('curve: points whose q cannot be on the axis are left out; q and I must have the same length', () => {
    const c = P.curve('loglog', f64([0, NaN, 0.1, 0.2]), f64([1, 1, NaN, 3]), 1);
    assert.deepEqual(c.points.map((p) => p.x), [0.1, 0.2]);
    assert.equal(c.nonFinite, 1, 'counted over every value of the model, as FitResult.nonFiniteCurvePoints does');
    assert.throws(() => P.curve('loglog', f64([1, 2]), f64([1]), 1), /same length/);
    const big = P.curve('loglog', f64(Array.from({ length: 12000 }, (_, i) => i + 1)), new Float64Array(12000).fill(2), 1, 3);
    assert.equal(big.points.length, 4001, '0, 3, ..., 11997 and the last point');
    assert.equal(big.points[1].x, 4);
    assert.equal(big.points[4000].x, 12000);
    const gaps = new Float64Array(12000).fill(2);
    gaps[1] = NaN;
    assert.equal(P.curve('loglog', f64(Array.from({ length: 12000 }, (_, i) => i + 1)), gaps, 1, 3).nonFinite, 1, 'also when the point is not drawn');
});

// ------------------------------------------------------------------ range boxes

test('rangeBoxes: two borderless boxes outside the fit range in the neutral role; squared in Guinier mode', () => {
    const boxes = P.rangeBoxes('loglog', { qMin: 0.01, qMax: 0.2, userEdited: false });
    assert.deepEqual(Object.keys(boxes), ['sfRangeLow', 'sfRangeHigh']);
    assert.deepEqual(boxes.sfRangeLow, { type: 'box', tpsRole: 'outOfRange', xMax: 0.01, borderWidth: 0, drawTime: 'beforeDatasetsDraw' });
    assert.deepEqual(boxes.sfRangeHigh, { type: 'box', tpsRole: 'outOfRange', xMin: 0.2, borderWidth: 0, drawTime: 'beforeDatasetsDraw' });
    assert.deepEqual(P.rangeBoxes('kratky', { qMin: 0.01, qMax: 0.2 }), boxes);
    assert.deepEqual(P.rangeBoxes('porod', { qMin: 0.01, qMax: 0.2 }), boxes);
    assert.deepEqual(P.rangeLines('porod', { qMin: 0.01, qMax: 0.2 }), P.rangeLines('kratky', { qMin: 0.01, qMax: 0.2 }));
    const g = P.rangeBoxes('guinier', { qMin: 0.01, qMax: 0.2 });
    near(g.sfRangeLow.xMax, 1e-4);
    near(g.sfRangeHigh.xMin, 0.04);
    assert.deepEqual(P.rangeBoxes('loglog', null), {});
    assert.deepEqual(P.rangeBoxes('loglog', undefined), {});
    assert.deepEqual(Object.keys(P.rangeBoxes('loglog', { qMin: NaN, qMax: 0.2 })), ['sfRangeHigh']);
    assert.throws(() => P.rangeBoxes('nope', { qMin: 1, qMax: 2 }), /Unknown plot mode/);
});

// ------------------------------------------------------------------ main config

test('mainConfig: axis types and titles follow the mode; intensity carries cm^-1 only when every shown file is official', () => {
    const official = [serie(0, { active: true }), serie(1)];
    const mixed = [serie(0, { active: true }), serie(1, { data: dataset(4, { kind: 'generic' }) })];
    const scales = (mode, series) => P.mainConfig(view({ mode, series })).options.scales;
    const of = (s) => [s.x.type, s.y.type, s.x.title.text, s.y.title.text];
    assert.deepEqual(of(scales('loglog', official)), ['logarithmic', 'logarithmic', 'q (Å⁻¹)', 'I(q) (cm⁻¹)']);
    assert.deepEqual(of(scales('guinier', official)), ['linear', 'linear', 'q² (Å⁻²)', 'ln [I(q) / cm⁻¹]']);
    assert.deepEqual(of(scales('kratky', official)), ['linear', 'linear', 'q (Å⁻¹)', 'q²·I(q) (Å⁻²·cm⁻¹)']);
    assert.deepEqual(of(scales('loglog', mixed)), ['logarithmic', 'logarithmic', 'q (Å⁻¹)', 'I(q)']);
    assert.deepEqual(of(scales('guinier', mixed)), ['linear', 'linear', 'q² (Å⁻²)', 'ln I(q)']);
    assert.deepEqual(of(scales('kratky', mixed)), ['linear', 'linear', 'q (Å⁻¹)', 'q²·I(q)']);
    assert.deepEqual(of(scales('porod', official)), ['linear', 'linear', 'q (Å⁻¹)', 'I(q)·q⁴ (cm⁻¹·Å⁻⁴)']);
    assert.deepEqual(of(scales('porod', mixed)), ['linear', 'linear', 'q (Å⁻¹)', 'I(q)·q⁴']);
    assert.deepEqual(of(scales('loglog', [])), ['logarithmic', 'logarithmic', 'q (Å⁻¹)', 'I(q)']);
    const s = scales('loglog', official);
    assert.equal(s.x.title.display, true);
    assert.equal(s.x.title.font.family, ChartTheme.FONT);
    assert.equal(s.y.ticks.font.family, ChartTheme.MONO);
    const staggered = P.mainConfig(view({ series: official, stagger: { on: true, decades: 1 } })).options.scales.y.title.text;
    assert.equal(staggered, 'I(q) (cm⁻¹)（各組已錯開）');
    assert.throws(() => P.mainConfig(view({ mode: 'x' })), /Unknown plot mode/);
});

test('mainConfig: a hollow points-only dataset per file in its series colour; the active curve has its own role, the others their series', () => {
    const fit1 = { q: f64([0.01, 0.02, 0.03, 0.04]), I: f64([90, 45, 30, 22]) };
    const preview = { q: f64([0.01, 0.04]), I: f64([95, 20]) };
    const config = P.mainConfig(view({ series: [
        serie(0, { fitCurve: fit1 }),
        serie(2, { active: true, fitCurve: fit1 }),
        serie(5),
    ], preview }));
    assert.equal(config.type, 'scatter');
    assert.deepEqual(kinds(config), ['data:0:d1', 'curve:0:d1', 'data:2:d3', 'curve:modelCurve:d3', 'data:5:d6']);
    const [d0, c0, d2, c2, d5] = config.data.datasets;
    [d0, d2, d5].forEach((d) => {
        assert.equal(d.showLine, false);
        assert.equal(d.pointStyle, 'circle');
        assert.ok(d.pointRadius > 0);
        assert.equal(d.tpsHollow, true, 'hollow points: the curve shows through them');
        assert.equal(d.borderWidth, 1);
        assert.equal(d.data.length, 4);
    });
    assert.deepEqual([d2.pointRadius, d0.pointRadius], [2, 1.5]);
    assert.deepEqual([c2.borderWidth, c0.borderWidth], [2, 1.5]);
    assert.deepEqual([c2.tpsRole, c2.tpsSeries, c2.label, c2.sfLegend], ['modelCurve', undefined, '模型', true]);
    assert.deepEqual([c0.tpsRole, c0.tpsSeries, c0.sfLegend], [undefined, 0, undefined]);
    [c0, c2].forEach((c) => {
        assert.equal(c.showLine, true);
        assert.equal(c.pointRadius, 0);
        assert.equal('borderDash' in c, false, 'the dash of a reused colour comes from ChartTheme');
        assert.equal('sfErrorBars' in c, false);
    });
    assert.deepEqual([d0.label, d2.label, d5.label], ['file0.dat', 'file2.dat', 'file5.dat']);
    assert.deepEqual(c0.data.map((p) => p.y), [90, 45, 30, 22], 'a file that is not active draws its own fit');
    assert.deepEqual(c2.data, [{ x: 0.01, y: 95 }, { x: 0.04, y: 20 }], 'the active file draws the curve of the form');
    // the active file stands out; lines are drawn above points
    assert.ok(d2.pointRadius > d0.pointRadius && d0.pointRadius === d5.pointRadius);
    assert.ok(c2.borderWidth > c0.borderWidth);
    assert.ok(c0.order < d0.order && c2.order < d2.order && c2.order < c0.order && d2.order < d0.order);
    assert.deepEqual([d0, c0, d2, c2, d5].map((d) => d.sfErrorBars === true), [false, false, true, false, false]);
    assert.ok(d2.data.every((p) => 'yMin' in p && 'yMax' in p), 'the error bar plugin reads yMin and yMax');
});

test('mainConfig: the active file falls back to its own fit; a preview without files is one model curve', () => {
    const fit = { q: f64([0.01, 0.02]), I: f64([9, 8]) };
    const own = P.mainConfig(view({ series: [serie(3, { active: true, fitCurve: fit })] }));
    assert.deepEqual(kinds(own), ['data:3:d4', 'curve:modelCurve:d4']);
    assert.deepEqual(own.data.datasets[1].data.map((p) => p.y), [9, 8]);
    const alone = P.mainConfig(view({ preview: { q: f64([0.001, 0.01]), I: f64([5, 4]) } }));
    assert.equal(alone.data.datasets.length, 1);
    assert.deepEqual([alone.data.datasets[0].tpsRole, alone.data.datasets[0].showLine, alone.data.datasets[0].sfKind], ['modelCurve', true, 'curve']);
    assert.deepEqual(P.mainConfig(view()).data.datasets, []);
    const noActive = P.mainConfig(view({ series: [serie(0)], preview: fit }));
    assert.deepEqual(kinds(noActive), ['data:0:d1'], 'the preview belongs to the active file');
});

test('mainConfig: from the ninth file on the point style changes with floor(index / 8)', () => {
    const series = [0, 7, 8, 15, 16, 24, 32].map((i) => serie(i));
    const config = P.mainConfig(view({ series }));
    assert.deepEqual(config.data.datasets.map((d) => d.pointStyle), ['circle', 'circle', 'rect', 'rect', 'triangle', 'rectRot', 'circle']);
    assert.deepEqual(config.data.datasets.map((d) => d.tpsSeries), [0, 7, 8, 15, 16, 24, 32]);
});

test('mainConfig: staggering multiplies dataset k of the display order and its curve, and leaves the data alone', () => {
    const fit = { q: f64([0.01, 0.02, 0.03, 0.04]), I: f64([1, 2, 3, 4]) };
    const series = [serie(4, { fitCurve: fit }), serie(9, { fitCurve: fit }), serie(11, { active: true, fitCurve: fit })];
    const before = series.map((s) => Array.from(s.data.I));
    const plain = P.mainConfig(view({ series }));
    const stag = P.mainConfig(view({ series, stagger: { on: true, decades: 2 } }));
    [0, 1, 2].forEach((k) => {
        const f = Math.pow(10, 2 * k);
        near(stag.data.datasets[2 * k].data[0].y, plain.data.datasets[2 * k].data[0].y * f, 'data ' + k);
        near(stag.data.datasets[2 * k].data[0].yMax, plain.data.datasets[2 * k].data[0].yMax * f, 'bar ' + k);
        near(stag.data.datasets[2 * k + 1].data[3].y, 4 * f, 'curve ' + k);
    });
    assert.deepEqual(series.map((s) => Array.from(s.data.I)), before);
    const g = P.mainConfig(view({ mode: 'guinier', series, stagger: { on: true, decades: 1 } }));
    near(g.data.datasets[4].data[0].y, Math.log(100) + 2 * Math.LN10);
});

test('mainConfig: options of the site (no parsing, no animation), zoom gestures that leave the plain wheel to the page, one fixed y axis width', () => {
    const o = P.mainConfig(view({ series: [serie(0, { active: true })] })).options;
    assert.equal(o.parsing, false);
    assert.equal(o.animation, false);
    assert.equal(o.responsive, true);
    assert.equal(o.maintainAspectRatio, false);
    assert.deepEqual(o.plugins.zoom, {
        pan: { enabled: true, mode: 'xy', modifierKey: 'shift' },
        zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, drag: { enabled: true, borderWidth: 1 }, mode: 'xy' },
    });
    const scale = { width: 114 };
    o.scales.y.afterFit(scale);
    assert.equal(scale.width, P.Y_AXIS_WIDTH);
    assert.deepEqual(o.plugins.annotation.annotations, {});
    const ranged = P.mainConfig(view({ mode: 'guinier', series: [serie(0, { active: true })], range: { qMin: 0.1, qMax: 0.2 } }));
    assert.deepEqual(ranged.options.plugins.annotation.annotations,
        { ...P.rangeBoxes('guinier', { qMin: 0.1, qMax: 0.2 }), ...P.rangeLines('guinier', { qMin: 0.1, qMax: 0.2 }) });
    // the legend lists the files and the model curve of the active one, not the curves of the other files
    const fit = { q: f64([0.01]), I: f64([1]) };
    const config = P.mainConfig(view({ series: [serie(0, { active: true, fitCurve: fit }), serie(1, { fitCurve: fit })] }));
    const filter = config.options.plugins.legend.labels.filter;
    assert.deepEqual(config.data.datasets.map((d, i) => filter({ datasetIndex: i }, config.data)), [true, true, true, false]);
    assert.equal(config.options.plugins.legend.display, true);
});

test('rangeLines: a dashed line of the reference role on each end of the fit range, in the x of the mode', () => {
    assert.deepEqual(P.rangeLines('loglog', null), {});
    const lines = P.rangeLines('guinier', { qMin: 0.1, qMax: 0.2 });
    assert.deepEqual(Object.keys(lines), ['sfRangeLowLine', 'sfRangeHighLine']);
    near(lines.sfRangeLowLine.xMin, 0.01);
    near(lines.sfRangeHighLine.xMax, 0.04);
    Object.values(lines).forEach((line) => {
        assert.deepEqual([line.type, line.tpsRole, line.borderWidth, line.drawTime], ['line', 'reference', 1, 'beforeDatasetsDraw']);
        assert.equal(line.xMin, line.xMax);
        assert.ok(line.borderDash.length === 2);
    });
    assert.deepEqual(Object.keys(P.rangeLines('kratky', { qMin: NaN, qMax: 0.2 })), ['sfRangeHighLine']);
    assert.throws(() => P.rangeLines('nope', { qMin: 1, qMax: 2 }), /Unknown plot mode/);
});

test('mainConfig: the legend is hidden above LEGEND_MAX_SERIES files (the file list carries the colour samples)', () => {
    const many = (n) => P.mainConfig(view({ series: Array.from({ length: n }, (_, i) => serie(i, { active: i === 0 })) }));
    assert.equal(P.LEGEND_MAX_SERIES, 6);
    assert.equal(many(6).options.plugins.legend.display, true);
    assert.equal(many(7).options.plugins.legend.display, false);
    assert.equal(many(1).options.plugins.legend.labels.usePointStyle, true);
});

test('mainConfig: the x axis starts on the data range (a wider preview grid does not stretch it); nothing is fixed without data', () => {
    const wide = { q: f64([0.0001, 0.5, 5]), I: f64([9, 8, 7]) };
    const log = P.mainConfig(view({ series: [serie(0, { active: true })], preview: wide })).options.scales;
    const qs = Array.from(serie(0).data.q).filter((q) => q > 0);
    assert.ok(log.x.min < Math.min(...qs) && log.x.min > Math.min(...qs) / 1.2);
    assert.ok(log.x.max > Math.max(...qs) && log.x.max < Math.max(...qs) * 1.2);
    assert.equal('min' in log.y, false);
    const kratky = P.mainConfig(view({ mode: 'kratky', series: [serie(0, { active: true })] })).options.scales;
    assert.deepEqual([kratky.x.min, kratky.x.max], [0, Math.max(...qs)]);
    const porod = P.mainConfig(view({ mode: 'porod', series: [serie(0, { active: true })], preview: wide })).options.scales;
    assert.deepEqual([porod.x.min, porod.x.max], [0, Math.max(...qs)]);
    assert.equal('min' in porod.y, false);
    const alone = P.mainConfig(view({ preview: wide })).options.scales;
    assert.equal('min' in alone.x, false);
    assert.equal('max' in alone.x, false);
});

test('mainConfig: Guinier starts on a low-q window (to a tenth of the low-q level, not beyond the fit range) with y around those points', () => {
    const q = Float64Array.from({ length: 100 }, (_, i) => 0.005 * (i + 1));
    const rg = 30;
    const data = { kind: 'official', q, I: q.map((x) => 1000 * Math.exp(-x * x * rg * rg / 3)), sigma: null };
    const s = (range) => P.mainConfig(view({ mode: 'guinier', series: [serie(0, { active: true, data })], range })).options.scales;
    const free = s(null);
    const end = Math.sqrt(free.x.max);
    assert.equal(free.x.min, 0);
    const atEnd = 1000 * Math.exp(-end * end * 300);
    assert.ok(atEnd < 100 && atEnd > 60, 'I(end) is just below a tenth of I(0): ' + atEnd);
    assert.ok(free.y.max > Math.log(1000) - 0.2 && free.y.max < Math.log(1000) + 0.4);
    assert.ok(free.y.min < Math.log(100) && free.y.min > Math.log(100) - 0.8);
    near(s({ qMin: 0.005, qMax: 0.03 }).x.max, 0.0009);
    assert.ok(s({ qMin: 0.005, qMax: 0.45 }).x.max < 0.02, 'a fit range beyond the window does not widen it');
});

test('mainConfig: display decimation above 5000 points per dataset, the data and the fit keep every point', () => {
    const big = dataset(12000);
    const fit = { q: big.q, I: big.I.map((v) => v * 0.9) };
    const config = P.mainConfig(view({ series: [serie(0, { active: true, data: big, fitCurve: fit }), serie(1)] }));
    assert.equal(config.data.datasets[0].data.length, 4001, '0, 3, ..., 11997 and the last point');
    assert.equal(config.data.datasets[0].data[1].x, big.q[3]);
    assert.equal(config.data.datasets[0].data[4000].x, big.q[11999]);
    assert.equal(config.data.datasets[1].data.length, 4001, 'the curve is thinned the same way');
    assert.equal(config.data.datasets[2].data.length, 4);
    assert.equal(big.q.length, 12000);
    const stats = P.viewStats(view({ series: [serie(0, { active: true, data: big, fitCurve: fit }), serie(1)] }));
    assert.equal(stats.displayStride, 3);
    assert.equal(P.viewStats(view({ series: [serie(0, { data: dataset(5000) })] })).displayStride, 1);
});

test('viewStats: hidden points summed over the shown files, non-finite points of the active curve', () => {
    const neg = dataset(4, { I: f64([1, -1, 0, 2]) });
    const series = [serie(0, { active: true, data: neg }), serie(1, { data: neg }), serie(2)];
    const preview = { q: f64([0.01, 0.02, 0.03]), I: f64([1, NaN, NaN]) };
    assert.deepEqual(P.viewStats(view({ series, preview })), { hidden: 4, displayStride: 1, nonFinite: 2, points: 8 });
    assert.deepEqual(P.viewStats(view({ mode: 'guinier', series })), { hidden: 4, displayStride: 1, nonFinite: 0, points: 8 });
    assert.deepEqual(P.viewStats(view({ mode: 'kratky', series })), { hidden: 0, displayStride: 1, nonFinite: 0, points: 12 });
    assert.deepEqual(P.viewStats(view({ mode: 'porod', series })), { hidden: 0, displayStride: 1, nonFinite: 0, points: 12 });
    assert.deepEqual(P.viewStats(view()), { hidden: 0, displayStride: 1, nonFinite: 0, points: 0 });
});

// ------------------------------------------------------------------ residual config

test('residualConfig: the residuals of the active file against q or q^2, NaN skipped, with a reference line at 0', () => {
    const residuals = { q: f64([0.01, 0.02, 0.03, 0.04]), r: f64([NaN, 1.5, -0.5, NaN]) };
    const base = view({ series: [serie(0, { active: true })], residuals });
    const log = P.residualConfig(base);
    assert.equal(log.type, 'scatter');
    assert.equal(log.data.datasets.length, 1);
    assert.equal(log.data.datasets[0].tpsRole, 'residual');
    assert.equal(log.data.datasets[0].showLine, false);
    assert.deepEqual(log.data.datasets[0].data, [{ x: 0.02, y: 1.5 }, { x: 0.03, y: -0.5 }]);
    assert.deepEqual([log.options.scales.x.type, log.options.scales.y.type], ['logarithmic', 'linear']);
    assert.deepEqual([log.options.scales.x.title.text, log.options.scales.y.title.text], ['q (Å⁻¹)', '(I − I模型)/w']);
    const zero = log.options.plugins.annotation.annotations.sfZero;
    assert.deepEqual([zero.type, zero.tpsRole, zero.yMin, zero.yMax], ['line', 'reference', 0, 0]);
    assert.equal(log.options.parsing, false);
    assert.equal(log.options.animation, false);
    assert.equal(log.options.plugins.zoom.zoom.wheel.enabled, false, 'zooming happens on the main chart only');
    assert.equal(log.options.plugins.zoom.pan.enabled, false);

    const guinier = P.residualConfig({ ...base, mode: 'guinier' });
    near(guinier.data.datasets[0].data[0].x, 4e-4);
    near(guinier.data.datasets[0].data[1].x, 9e-4);
    assert.deepEqual(guinier.data.datasets[0].data.map((p) => p.y), [1.5, -0.5], 'the residual itself does not change with the mode');
    assert.deepEqual([guinier.options.scales.x.type, guinier.options.scales.x.title.text], ['linear', 'q² (Å⁻²)']);
    const kratky = P.residualConfig({ ...base, mode: 'kratky' });
    assert.deepEqual(kratky.data.datasets[0].data.map((p) => p.x), [0.02, 0.03]);
    assert.deepEqual([kratky.options.scales.x.type, kratky.options.scales.x.title.text], ['linear', 'q (Å⁻¹)']);
    const porod = P.residualConfig({ ...base, mode: 'porod' });
    assert.deepEqual(porod.data.datasets[0].data, kratky.data.datasets[0].data, 'the residuals are not multiplied by q^4');
    assert.deepEqual([porod.options.scales.x.type, porod.options.scales.y.type, porod.options.scales.x.title.text, porod.options.scales.y.title.text],
        ['linear', 'linear', 'q (Å⁻¹)', kratky.options.scales.y.title.text]);

    const none = P.residualConfig(view({ series: [serie(0, { active: true })] }));
    assert.deepEqual(none.data.datasets[0].data, []);
    assert.throws(() => P.residualConfig({ ...base, residuals: { q: f64([1, 2]), r: f64([1]) } }), /same length/);
});

test('residualConfig: the display stride of the data applies; its y axis is as wide as that of the main chart', () => {
    const n = 12000;
    const q = f64(Array.from({ length: n }, (_, i) => 0.001 * (i + 1)));
    const r = new Float64Array(n).fill(0.25);
    r[3] = NaN;
    const config = P.residualConfig(view({ series: [serie(0, { active: true })], residuals: { q, r } }));
    assert.equal(config.data.datasets[0].data.length, 4000, '4001 taken, one of them NaN');
    assert.equal(config.data.datasets[0].data[1].x, q[6]);
    const a = { width: 35 };
    const b = { width: 114 };
    config.options.scales.y.afterFit(a);
    P.mainConfig(view()).options.scales.y.afterFit(b);
    assert.equal(a.width, b.width);
    assert.equal(a.width, 72);
});

// ------------------------------------------------------------------ colours come from ChartTheme only

function fullView(mode) {
    const fit = { q: f64([0.01, 0.02, 0.03, 0.04]), I: f64([90, 45, 30, 22]) };
    return view({ mode, series: [serie(0, { fitCurve: fit }), serie(3, { active: true, fitCurve: fit }), serie(9, { fitCurve: fit })],
        preview: { q: f64([0.01, 0.04]), I: f64([95, 20]) }, range: { qMin: 0.015, qMax: 0.035, userEdited: true },
        stagger: { on: true, decades: 1 }, residuals: { q: f64([0.01, 0.02, 0.03, 0.04]), r: f64([NaN, 1, -1, NaN]) } });
}

test('every dataset, scale and annotation is tagged with tpsRole or tpsSeries, and no colour is set here', () => {
    P.MODES.forEach((mode) => {
        [P.mainConfig(fullView(mode)), P.residualConfig(fullView(mode))].forEach((config) => {
            const tagged = (item) => typeof item.tpsRole === 'string' || Number.isInteger(item.tpsSeries);
            assert.ok(config.data.datasets.length > 0);
            config.data.datasets.forEach((d) => assert.ok(tagged(d), mode + ' dataset ' + d.label));
            Object.entries(config.options.scales).forEach(([id, s]) => assert.ok(tagged(s), mode + ' scale ' + id));
            const annotations = Object.entries(config.options.plugins.annotation.annotations);
            assert.ok(annotations.length > 0);
            annotations.forEach(([id, a]) => assert.ok(tagged(a), mode + ' annotation ' + id));
            assert.deepEqual(colourKeys(config), [], mode);
            assert.ok(!JSON.stringify(config, (k, v) => (k === 'data' && Array.isArray(v) ? undefined : v)).match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i));
            walk(config, [], (path, key, value) => assert.notEqual(key === 'tpsRole' && value, 'model'));
        });
    });
});

test('ChartTheme.colorize gives palette colours to points, curves, the residuals and the out-of-range boxes in both themes', () => {
    ['light', 'dark'].forEach((theme) => {
        const p = ChartTheme.PALETTES[theme];
        const main = ChartTheme.colorize(P.mainConfig(fullView('loglog')), theme);
        const expected = [p.series[0], p.series[0], p.series[3], p.modelCurve, p.series[1], p.series[1]];
        assert.deepEqual(main.data.datasets.map((d) => d.borderColor), expected, theme);
        const fills = main.data.datasets.map((d) => d.backgroundColor);
        [0, 2, 4].forEach((i) => assert.match(fills[i], /^rgba\(0, 0, 0, 0\)$/, 'data points are hollow'));
        assert.deepEqual([fills[1], fills[3], fills[5]], [p.series[0], p.modelCurve, p.series[1]]);
        assert.equal(main.data.datasets[0].borderColor, main.data.datasets[1].borderColor, 'the curve of a file that is not active has the colour of its data');
        assert.notEqual(main.data.datasets[2].borderColor, main.data.datasets[3].borderColor, 'the active curve does not: it must show through its own points');
        p.series.forEach((colour) => assert.notEqual(p.modelCurve, colour, theme));
        assert.equal(main.options.plugins.zoom.zoom.drag.backgroundColor, p.outOfRange, 'the drag box follows the theme');
        const lines = main.options.plugins.annotation.annotations;
        assert.equal(lines.sfRangeLowLine.borderColor, p.reference);
        assert.deepEqual(main.data.datasets.map((d) => d.borderDash), [[], [], [], undefined, [6, 4], [6, 4]], 'a reused colour is dashed; the model curve is solid');
        const boxes = main.options.plugins.annotation.annotations;
        assert.equal(typeof p.outOfRange, 'string');
        assert.equal(boxes.sfRangeLow.backgroundColor, p.outOfRange);
        assert.equal(boxes.sfRangeHigh.backgroundColor, p.outOfRange);
        assert.equal(boxes.sfRangeLow.borderWidth, 0);
        assert.equal(main.options.scales.x.ticks.color, p.text);
        assert.equal(main.options.scales.y.border.color, p.grid, 'the axis line stays neutral');
        assert.equal(main.options.scales.y.afterFit, P.mainConfig(view()).options.scales.y.afterFit, 'functions survive the copy');
        const residual = ChartTheme.colorize(P.residualConfig(fullView('loglog')), theme);
        assert.equal(residual.data.datasets[0].borderColor, p.residual);
        assert.equal(residual.options.plugins.annotation.annotations.sfZero.borderColor, p.reference);
        const assignments = ChartTheme.colorAssignments(P.mainConfig(fullView('guinier')), p);
        const at = (path) => assignments.find((a) => a.path.join('.') === path).value;
        assert.equal(at('data.datasets.0.borderColor'), at('data.datasets.1.borderColor'));
        assert.equal(at('data.datasets.3.borderColor'), p.modelCurve);
        assert.equal(at('options.plugins.annotation.annotations.sfRangeLow.backgroundColor'), p.outOfRange);
    });
    assert.notEqual(ChartTheme.PALETTES.light.outOfRange, ChartTheme.PALETTES.dark.outOfRange);
});

test('the outOfRange role is neutral and translucent in both palettes: black-based in light, white-based in dark', () => {
    Object.entries(ChartTheme.PALETTES).forEach(([name, p]) => {
        assert.match(p.outOfRange, /^rgba\((\d+), \1, \1, 0\.\d+\)$/, name + ': the three channels are equal');
        [p.region, p.regionAlt, p.grid].forEach((other) => assert.notEqual(p.outOfRange, other, name));
        const alpha = (value) => Number(/([\d.]+)\)$/.exec(value)[1]);
        assert.ok(alpha(p.outOfRange) > alpha(p.grid) && alpha(p.outOfRange) <= 0.2, name + ': a little stronger than the grid');
    });
    assert.match(ChartTheme.PALETTES.light.outOfRange, /^rgba\(0, 0, 0,/);
    assert.match(ChartTheme.PALETTES.dark.outOfRange, /^rgba\(255, 255, 255,/);
    // a box takes the role as its fill and gets no border colour; other annotation roles are untouched
    const config = { data: { datasets: [] }, options: { plugins: { annotation: { annotations: {
        low: { type: 'box', tpsRole: 'outOfRange', xMax: 0.01, borderWidth: 0 }, old: { type: 'box', tpsRole: 'region' },
    } } } } };
    const p = ChartTheme.PALETTES.dark;
    const paths = ChartTheme.colorAssignments(config, p).map((a) => a.path.join('.') + '=' + a.value);
    assert.ok(paths.includes('options.plugins.annotation.annotations.low.backgroundColor=' + p.outOfRange));
    assert.ok(paths.includes('options.plugins.annotation.annotations.old.backgroundColor=' + p.region));
    assert.ok(!paths.some((s) => s.indexOf('annotations.low.borderColor') >= 0));
});

// ------------------------------------------------------------------ determinism and immutability

test('the same view gives deeply equal configs, and the view is not modified', () => {
    P.MODES.forEach((mode) => {
        const v = fullView(mode);
        const snapshot = JSON.stringify(v, (k, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value));
        const first = [P.mainConfig(v), P.residualConfig(v), P.viewStats(v)];
        const second = [P.mainConfig(v), P.residualConfig(v), P.viewStats(v)];
        assert.deepStrictEqual(second, first);
        assert.notEqual(second[0], first[0]);
        assert.notEqual(second[0].data.datasets[0].data, first[0].data.datasets[0].data);
        assert.equal(JSON.stringify(v, (k, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value)), snapshot);
    });
});

test('configs work from frozen views and from the shown files of a real page state', () => {
    const deepFreeze = (o) => {
        if (o !== null && typeof o === 'object' && !ArrayBuffer.isView(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
        return o;
    };
    const frozen = deepFreeze(fullView('kratky'));
    assert.doesNotThrow(() => { P.mainConfig(frozen); P.residualConfig(frozen); P.viewStats(frozen); });
    let state = S.initial();
    const file = (name) => ({ fileName: name, dataset: Object.freeze(dataset(6, { fileName: name, kind: 'generic' })), issues: [], notes: {} });
    state = S.reduce(state, { type: 'addFiles', files: [file('a.dat'), { fileName: 'bad', dataset: null, issues: [], notes: {} }, file('c.dat')] });
    const series = S.shownFiles(state).map((f) => ({ id: f.id, index: f.index, label: f.fileName, active: f.id === state.activeId,
        data: f.dataset, fitCurve: null }));
    const config = P.mainConfig(view({ mode: state.plotMode, series, stagger: state.stagger, range: state.range }));
    assert.deepEqual(config.data.datasets.map((d) => d.tpsSeries), [0, 2], 'the series index is the position in the list');
    assert.deepEqual(config.data.datasets.map((d) => d.sfErrorBars === true), [true, false]);
});

// ---------------------------------------------------------------- 對數軸的刻度文字（Task 11 瀏覽器實看後補）
test('[sasfit-plot-data] 對數軸刻度：長軸只標 10 的次方，短軸標 1-2-5，不到一個級距時每個刻度都標；沒有尾端的 0', () => {
    const label = (scale, v) => P.logTickLabel.call(scale, v);
    const long = { min: 1e-3, max: 1e6 };
    assert.deepEqual([0.001, 0.002, 0.005, 0.01, 1, 5, 1000, 1e4, 1e5, 1e6].map((v) => label(long, v)),
        ['0.001', '', '', '0.01', '1', '', '1000', '10000', '1e5', '1e6']);
    const short = { min: 0.005, max: 0.4 };
    assert.deepEqual([0.005, 0.006, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.3, 0.4].map((v) => label(short, v)),
        ['0.005', '', '0.01', '0.02', '', '0.05', '0.1', '0.2', '', '']);
    const narrow = { min: 0.11, max: 0.19 };
    assert.deepEqual([0.11, 0.125, 0.19].map((v) => label(narrow, v)), ['0.11', '0.125', '0.19']);
    assert.equal(label({ min: 1e-6, max: 1e-4 }, 2e-5), '2e-5');
    assert.equal(label(long, 0), '');
    assert.equal(label(long, NaN), '');
    assert.equal(label(undefined, 100), '100', '沒有 scale（this）時照 1-2-5 規則');
});

test('[sasfit-plot-data] 只有對數軸帶刻度 callback 並關掉 autoSkip；線性軸沿用 Chart.js 的格式', () => {
    const d = { kind: 'official', q: Float64Array.from([0.01, 0.02, 0.03]), I: Float64Array.from([3, 2, 1]), sigma: null };
    const v = (mode) => ({ mode, series: [{ id: 'd1', index: 0, label: 'a', active: true, data: d, fitCurve: null }], preview: null,
        range: null, stagger: { on: false, decades: 1 }, residuals: null });
    const log = P.mainConfig(v('loglog')).options.scales;
    assert.equal(log.x.ticks.callback, P.logTickLabel);
    assert.equal(log.y.ticks.callback, P.logTickLabel);
    assert.equal(log.x.ticks.autoSkip, false);
    assert.equal(P.residualConfig(v('loglog')).options.scales.x.ticks.callback, P.logTickLabel);
    assert.equal(P.residualConfig(v('loglog')).options.scales.y.ticks.callback, undefined);
    const linear = P.mainConfig(v('kratky')).options.scales;
    assert.equal(linear.x.ticks.callback, undefined);
    assert.equal(linear.y.ticks.callback, undefined);
});

test('[sasfit-plot-data] 對數軸只留有標文字的刻度（沒標的不畫格線）；會剩不到兩個刻度時不動', () => {
    const d = { kind: 'official', q: Float64Array.from([0.01, 0.02, 0.03]), I: Float64Array.from([3, 2, 1]), sigma: null };
    const config = P.mainConfig({ mode: 'loglog', series: [{ id: 'd1', index: 0, label: 'a', active: true, data: d, fitCurve: null }],
        preview: null, range: null, stagger: { on: false, decades: 1 }, residuals: null });
    const { afterBuildTicks } = config.options.scales.x;
    assert.equal(typeof afterBuildTicks, 'function');
    assert.equal(config.options.scales.y.afterBuildTicks, afterBuildTicks);
    const scale = { min: 0.005, max: 0.4, ticks: [0.005, 0.006, 0.007, 0.01, 0.02, 0.03, 0.1, 0.4].map((value) => ({ value })) };
    afterBuildTicks(scale);
    assert.deepEqual(scale.ticks.map((t) => t.value), [0.005, 0.01, 0.02, 0.1]);
    const sparse = { min: 0.3, max: 40, ticks: [0.3, 0.4, 1, 30].map((value) => ({ value })) };
    const before = sparse.ticks;
    afterBuildTicks(sparse);
    assert.equal(sparse.ticks, before, '1-2-5 規則在這四個刻度裡只留得下 1：不足兩個，所以原樣保留');
});

test('[sasfit-plot-data] 窄的橫軸（手機寬度，繪圖區不到 260 px）：有標文字的刻度最多留約 4 個，等間隔取、不重疊（審查修正 E12）', () => {
    const d = { kind: 'official', q: Float64Array.from([0.01, 0.02, 0.03]), I: Float64Array.from([3, 2, 1]), sigma: null };
    const config = P.mainConfig({ mode: 'loglog', series: [{ id: 'd1', index: 0, label: 'a', active: true, data: d, fitCurve: null }],
        preview: null, range: null, stagger: { on: false, decades: 1 }, residuals: null });
    const { afterBuildTicks } = config.options.scales.x;
    const ticks = () => [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3].map((value) => ({ value }));
    const run = (extra) => {
        const scale = { min: 0.005, max: 0.4, ticks: ticks(), ...extra };
        afterBuildTicks(scale);
        return scale.ticks.map((t) => t.value);
    };
    const all = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2];
    assert.deepEqual(run({ width: 218, isHorizontal: () => true }), [0.005, 0.02, 0.1], '6 個 → 每隔一個');
    assert.deepEqual(run({ width: 259, isHorizontal: () => true }), [0.005, 0.02, 0.1]);
    assert.deepEqual(run({ width: 260, isHorizontal: () => true }), all, '夠寬：不動');
    assert.deepEqual(run({ width: 120, isHorizontal: () => false }), all, '縱軸不受影響');
    assert.deepEqual(run({}), all, '沒有尺寸資訊（測試、舊版 Chart.js）：不動');
    const four = { min: 0.01, max: 0.2, width: 200, isHorizontal: () => true, ticks: [0.01, 0.02, 0.05, 0.1].map((value) => ({ value })) };
    afterBuildTicks(four);
    assert.equal(four.ticks.length, 4, '4 個以內不必再刪');
});

test('[sasfit-plot-data] 兩張圖的版面留白相同且不讓 Chart.js 依點的大小自動加（否則繪圖區右緣差幾個像素）', () => {
    const d = { kind: 'official', q: Float64Array.from([0.01, 0.02, 0.03]), I: Float64Array.from([3, 2, 1]), sigma: null };
    const v = { mode: 'loglog', series: [{ id: 'd1', index: 0, label: 'a', active: true, data: d, fitCurve: null }], preview: null,
        range: null, stagger: { on: false, decades: 1 }, residuals: null };
    const main = P.mainConfig(v).options.layout;
    const residual = P.residualConfig(v).options.layout;
    assert.equal(main.autoPadding, false);
    assert.deepEqual(main, residual);
    assert.notEqual(main.padding, residual.padding, '各自一份，Chart.js 寫入其中一份不影響另一份');
});
