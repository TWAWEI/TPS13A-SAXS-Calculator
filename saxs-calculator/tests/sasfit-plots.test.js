'use strict';
/**
 * sasfit-plots.js（M3 計畫 Task 11）：Chart 實例的建立與更新、誤差棒外掛、主圖與殘差圖的 x 軸同步、重設縮放。
 * Chart 與 document 都是假的（做法仿 tests/theme.test.js 的 stubChart）；ChartTheme 是真的，所以顏色是調色盤的值。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChartTheme } = require('./load.js');

const Plots = globalThis.SasFitPlots;
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-plots.js'), 'utf8');
const savedDocument = global.document;
const savedChart = window.Chart;

// ---------------------------------------------------------------- 假 Chart
let created = [];

class FakeChart {
    constructor(canvas, config) {
        this.canvas = canvas;
        this.config = config;
        this.data = config.data;
        this.updates = [];
        this.destroyed = false;
        this.resets = 0;
        this.scales = { x: { min: 0.01, max: 0.5 } };
        created.push(this);
    }

    update(mode) { this.updates.push(mode); }

    destroy() { this.destroyed = true; }

    resetZoom() { this.resets += 1; this.scales = { x: { min: 0.001, max: 1 } }; }
}

function installDom() {
    const canvases = { sfMainChart: { id: 'sfMainChart' }, sfResidualChart: { id: 'sfResidualChart' } };
    global.document = { getElementById: (id) => canvases[id] || null };
    return canvases;
}

const dataset = (n = 5, kind = 'official') => ({
    kind, q: Float64Array.from({ length: n }, (_, i) => 0.01 * (i + 1)), I: Float64Array.from({ length: n }, (_, i) => 10 / (i + 1)),
    sigma: Float64Array.from({ length: n }, () => 0.1),
});

function viewOf(overrides = {}) {
    return {
        mode: 'loglog',
        series: [{ id: 'd1', index: 0, label: 'a.dat', active: true, data: dataset(), fitCurve: null },
            { id: 'd2', index: 1, label: 'b.dat', active: false, data: dataset(), fitCurve: null }],
        preview: null, range: { qMin: 0.02, qMax: 0.04 }, stagger: { on: false, decades: 1 }, residuals: null,
        ...overrides,
    };
}

beforeEach(() => {
    Plots.destroy();
    created = [];
    window.Chart = FakeChart;
    installDom();
});

after(() => {
    Plots.destroy();
    if (savedChart === undefined) delete window.Chart; else window.Chart = savedChart;
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
});

// ---------------------------------------------------------------- 模組
test('[sasfit-plots] 匯出凍結物件；頂層不碰 document 與 Chart', () => {
    assert.ok(Object.isFrozen(Plots));
    for (const name of ['render', 'resetZoom', 'getChart', 'destroy']) assert.equal(typeof Plots[name], 'function', name);
    assert.equal(Plots.ERROR_BARS.id, 'sfErrorBars');
    const top = SOURCE.split('\n').filter((line) => /^\S/.test(line) && !/^(\/\*\*| \*|\(function|\}\)\(\);)/.test(line));
    assert.deepEqual(top, [], 'IIFE 之外沒有程式');
});

test('[sasfit-plots] Chart 不存在（CDN 還沒載入或被擋）：render 回 null、不丟錯', () => {
    delete window.Chart;
    assert.equal(Plots.render(viewOf()), null);
    assert.equal(created.length, 0);
    assert.equal(Plots.getChart('sfMainChart'), null);
    assert.doesNotThrow(() => Plots.resetZoom());
});

test('[sasfit-plots] 沒有 canvas：render 回 null', () => {
    global.document = { getElementById: () => null };
    assert.equal(Plots.render(viewOf()), null);
    assert.equal(created.length, 0);
});

// ---------------------------------------------------------------- 建立與更新
test('[sasfit-plots] 第一次 render：兩張圖各建立一次，config 已上色，主圖帶 id 為 sfErrorBars 的外掛', () => {
    const main = Plots.render(viewOf());
    assert.equal(created.length, 2);
    assert.equal(main, created[0]);
    assert.equal(created[0].canvas.id, 'sfMainChart');
    assert.equal(created[1].canvas.id, 'sfResidualChart');
    assert.equal(Plots.getChart('sfMainChart'), created[0]);
    assert.equal(Plots.getChart('sfResidualChart'), created[1]);
    const palette = ChartTheme.PALETTES.light;
    assert.equal(created[0].config.data.datasets[0].borderColor, palette.series[0]);
    assert.equal(created[0].config.data.datasets[1].borderColor, palette.series[1]);
    assert.ok(created[0].config.plugins.some((p) => p.id === 'sfErrorBars'), '誤差棒外掛（以 id 比對：colorize 會拷貝外掛物件）');
    assert.ok(created[0].config.plugins.some((p) => p.id === 'tpsCanvasBackground'), 'colorize 加的白底外掛');
    assert.ok(!created[1].config.plugins.some((p) => p.id === 'sfErrorBars'), '殘差圖沒有誤差棒');
    assert.equal(created[0].config.options.plugins.annotation.annotations.sfRangeLow.backgroundColor, palette.outOfRange);
});

test('[sasfit-plots] 殘差圖的 x 範圍取自主圖，且自己不開縮放', () => {
    Plots.render(viewOf());
    const x = created[1].config.options.scales.x;
    assert.equal(x.min, 0.01);
    assert.equal(x.max, 0.5);
    const zoom = created[1].config.options.plugins.zoom;
    assert.equal(zoom.zoom.wheel.enabled, false);
    assert.equal(zoom.pan.enabled, false);
    assert.equal(created[0].config.options.plugins.zoom.zoom.wheel.enabled, true);
});

test('[sasfit-plots] 模式沒變的再次 render：不重建，換上的 datasets 與 annotations 帶調色盤顏色，以 ChartTheme.applyTo 收尾', () => {
    Plots.render(viewOf());
    const [main, residual] = created;
    const optionsBefore = main.config.options;
    const calls = [];
    const realApplyTo = ChartTheme.applyTo;
    const originalTheme = window.ChartTheme;
    window.ChartTheme = Object.freeze({ ...originalTheme, applyTo(chart, name) { calls.push(chart); return realApplyTo(chart, name); } });
    try {
        Plots.render(viewOf({ range: { qMin: 0.03, qMax: 0.05 }, residuals: { q: dataset().q, r: Float64Array.from([1, -1, 0.5, 0, 2]) } }));
    } finally {
        window.ChartTheme = originalTheme;
    }
    assert.equal(created.length, 2, '沒有重建');
    assert.equal(main.destroyed, false);
    assert.deepEqual(calls, [main, residual], '兩張圖各以 applyTo 更新一次');
    assert.deepEqual(main.updates, ['none']);
    assert.equal(main.config.options, optionsBefore, 'options 物件沿用（縮放保留）');
    const palette = ChartTheme.PALETTES.light;
    assert.equal(main.config.data.datasets[0].borderColor, palette.series[0], '新 dataset 不是 Chart.js 預設色');
    assert.equal(main.config.options.plugins.annotation.annotations.sfRangeLow.xMax, 0.03);
    assert.equal(main.config.options.plugins.annotation.annotations.sfRangeLow.backgroundColor, palette.outOfRange);
    assert.equal(residual.config.data.datasets[0].data.length, 5);
    assert.equal(residual.config.data.datasets[0].borderColor, palette.residual);
});

test('[sasfit-plots] 再次 render 時軸標題跟著 view（一般檔沒有 cm⁻¹、錯開時加註）', () => {
    Plots.render(viewOf());
    const main = created[0];
    assert.match(main.config.options.scales.y.title.text, /cm⁻¹/);
    const generic = viewOf();
    Plots.render({ ...generic, series: generic.series.map((s) => ({ ...s, data: dataset(5, 'generic') })) });
    assert.doesNotMatch(main.config.options.scales.y.title.text, /cm⁻¹/);
});

test('[sasfit-plots] 模式變了：兩張圖 destroy 後重建，x 軸型別跟著模式', () => {
    Plots.render(viewOf());
    const [main, residual] = created;
    Plots.render(viewOf({ mode: 'guinier' }));
    assert.equal(main.destroyed, true);
    assert.equal(residual.destroyed, true);
    assert.equal(created.length, 4);
    assert.equal(created[2].config.options.scales.x.type, 'linear');
    assert.equal(created[3].config.options.scales.x.type, 'linear');
    assert.equal(Plots.getChart('sfMainChart'), created[2]);
});

// ---------------------------------------------------------------- x 軸同步與重設
test('[sasfit-plots] 主圖縮放或平移完成：x 範圍寫進殘差圖並以 applyTo 更新', () => {
    Plots.render(viewOf());
    const [main, residual] = created;
    const { zoom } = main.config.options.plugins;
    assert.equal(typeof zoom.zoom.onZoomComplete, 'function');
    assert.equal(typeof zoom.pan.onPanComplete, 'function');
    main.scales = { x: { min: 0.02, max: 0.1 } };
    zoom.zoom.onZoomComplete({ chart: main });
    assert.equal(residual.config.options.scales.x.min, 0.02);
    assert.equal(residual.config.options.scales.x.max, 0.1);
    assert.deepEqual(residual.updates, ['none']);
    main.scales = { x: { min: 0.03, max: 0.2 } };
    zoom.pan.onPanComplete({ chart: main });
    assert.equal(residual.config.options.scales.x.min, 0.03);
    assert.equal(residual.config.options.scales.x.max, 0.2);
    assert.equal(residual.updates.length, 2);
});

test('[sasfit-plots] resetZoom：主圖重設，殘差圖跟回主圖重設後的範圍', () => {
    Plots.render(viewOf());
    const [main, residual] = created;
    Plots.resetZoom();
    assert.equal(main.resets, 1);
    assert.equal(residual.config.options.scales.x.min, 0.001);
    assert.equal(residual.config.options.scales.x.max, 1);
    assert.ok(residual.updates.length >= 1);
});

test('[sasfit-plots] 縮放狀態：isZoomed 讀主圖的 isZoomedOrPanned；縮放、平移、重設之後通知 listener', () => {
    const seen = [];
    Plots.setZoomListener((zoomed) => seen.push(zoomed));
    Plots.render(viewOf());
    const [main] = created;
    assert.equal(Plots.isZoomed(), false, '沒有 isZoomedOrPanned 的圖視為未縮放');
    main.zoomed = true;
    main.isZoomedOrPanned = () => main.zoomed;
    main.config.options.plugins.zoom.zoom.onZoomComplete({ chart: main });
    assert.deepEqual(seen, [true]);
    assert.equal(Plots.isZoomed(), true);
    main.zoomed = false;
    Plots.resetZoom();
    assert.deepEqual(seen, [true, false]);
    Plots.setZoomListener(null);
    main.config.options.plugins.zoom.pan.onPanComplete({ chart: main });
    assert.deepEqual(seen, [true, false]);
});

test('[sasfit-plots] 更新既有的圖：未縮放時寫入新的預設軸範圍與圖例顯示；縮放中保留使用者的視野', () => {
    Plots.render(viewOf());
    const [main] = created;
    const first = { ...main.config.options.scales.x };
    assert.ok(first.min > 0 && first.max > first.min, '預設 x 範圍取資料範圍');
    const wider = viewOf({ series: [{ id: 'd1', index: 0, label: 'a.dat', active: true, data: dataset(20), fitCurve: null }] });
    Plots.render(wider);
    assert.ok(main.config.options.scales.x.max > first.max, '資料變寬，預設範圍跟著變');
    main.isZoomedOrPanned = () => true;
    main.config.options.scales.x.min = 0.02;
    main.config.options.scales.x.max = 0.03;
    Plots.render(viewOf());
    assert.deepEqual([main.config.options.scales.x.min, main.config.options.scales.x.max], [0.02, 0.03]);
    const many = Array.from({ length: 7 }, (_, i) => ({ id: 'd' + i, index: i, label: i + '.dat', active: i === 0, data: dataset(), fitCurve: null }));
    Plots.render(viewOf({ series: many }));
    assert.equal(main.config.options.plugins.legend.display, false);
});

test('[sasfit-plots] 誤差棒畫在資料點之前，不透明度取自主題的 errorBarAlpha', () => {
    assert.equal(typeof Plots.ERROR_BARS.beforeDatasetsDraw, 'function');
    assert.equal(Plots.ERROR_BARS.afterDatasetsDraw, undefined);
    const alphas = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { alphas.push(ctx.globalAlpha); } };
    const chart = { ctx, chartArea: { left: 0, right: 100, top: 0, bottom: 200 }, scales: { y: { getPixelForValue: (v) => 200 - v } },
        data: { datasets: [{ data: [{ x: 1, y: 50, yMin: 40, yMax: 60 }], borderColor: 'c', sfErrorBars: true }] },
        isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 10 }] }) };
    Plots.ERROR_BARS.beforeDatasetsDraw(chart);
    assert.deepEqual(alphas, [window.ChartTheme.palette().errorBarAlpha]);
    assert.ok(alphas[0] > 0 && alphas[0] < 1);
});

test('[sasfit-plots] destroy：兩張圖都銷毀，之後 render 重新建立', () => {
    Plots.render(viewOf());
    Plots.destroy();
    assert.ok(created.every((c) => c.destroyed));
    assert.equal(Plots.getChart('sfMainChart'), null);
    Plots.render(viewOf());
    assert.equal(created.length, 4);
});

// ---------------------------------------------------------------- 誤差棒外掛
function barChart(points, { visible = true, color = 'c1', flagged = true } = {}) {
    const log = [];
    const ctx = {
        save() { log.push(['save']); }, restore() { log.push(['restore']); }, beginPath() { log.push(['beginPath']); },
        moveTo(x, y) { log.push(['moveTo', x, y]); }, lineTo(x, y) { log.push(['lineTo', x, y]); },
        stroke() { log.push(['stroke', ctx.strokeStyle, ctx.lineWidth]); },
    };
    const datasets = [{ data: points, borderColor: color, ...(flagged ? { sfErrorBars: true } : {}) }];
    const chart = {
        ctx, data: { datasets }, chartArea: { left: 0, right: 100, top: 0, bottom: 200 },
        scales: { y: { getPixelForValue: (v) => 200 - v } },       // 值 0..200 → 像素 200..0
        isDatasetVisible: () => visible,
        getDatasetMeta: () => ({ data: points.map((p) => ({ x: p.x })) }),
    };
    return { chart, log };
}
const lines = (log) => log.filter(([op]) => op === 'moveTo' || op === 'lineTo');

test('[sasfit-plots] 誤差棒：每點一條垂直線，x 取點元素的像素、y 取 yMin／yMax 的像素', () => {
    const { chart, log } = barChart([{ x: 10, y: 50, yMin: 40, yMax: 60 }, { x: 20, y: 80, yMin: 70, yMax: 95 }]);
    Plots.ERROR_BARS.beforeDatasetsDraw(chart);
    assert.deepEqual(lines(log), [['moveTo', 10, 140], ['lineTo', 10, 160], ['moveTo', 20, 105], ['lineTo', 20, 130]]);
    assert.deepEqual(log[0], ['save']);
    assert.deepEqual(log[log.length - 1], ['restore']);
    assert.equal(log.filter(([op]) => op === 'save').length, log.filter(([op]) => op === 'restore').length);
    assert.deepEqual(log.filter(([op]) => op === 'stroke'), [['stroke', 'c1', 1]]);
});

test('[sasfit-plots] 誤差棒：yMin 為 null 而 yMax 有值時畫到圖區底；兩者皆 null、兩端都在圖區外同側、x 在圖區外的點不畫', () => {
    const { chart, log } = barChart([
        { x: 10, y: 5, yMin: null, yMax: 9 },              // 到底
        { x: 20, y: 5, yMin: null, yMax: null },           // 不畫
        { x: 30, y: 300, yMin: 250, yMax: 350 },           // 都在上方之外
        { x: 40, y: -30, yMin: -50, yMax: -10 },           // 都在下方之外
        { x: 150, y: 50, yMin: 40, yMax: 60 },             // x 在圖區外
        { x: 50, y: 190, yMin: 180, yMax: 260 },           // 上端超出：截在圖區頂
    ]);
    Plots.ERROR_BARS.beforeDatasetsDraw(chart);
    assert.deepEqual(lines(log), [['moveTo', 10, 191], ['lineTo', 10, 200], ['moveTo', 50, 0], ['lineTo', 50, 20]]);
});

test('[sasfit-plots] 誤差棒：只畫標了 sfErrorBars 的 dataset；隱藏的 dataset 不畫', () => {
    const points = [{ x: 10, y: 50, yMin: 40, yMax: 60 }];
    const unflagged = barChart(points, { flagged: false });
    Plots.ERROR_BARS.beforeDatasetsDraw(unflagged.chart);
    assert.deepEqual(unflagged.log, []);
    const hidden = barChart(points, { visible: false });
    Plots.ERROR_BARS.beforeDatasetsDraw(hidden.chart);
    assert.deepEqual(lines(hidden.log), []);
});

test('[sasfit-plots] 誤差棒的顏色＝該 dataset 當下的 borderColor（主題切換後跟著變）', () => {
    const { chart, log } = barChart([{ x: 10, y: 50, yMin: 40, yMax: 60 }], { color: 'light-colour' });
    Plots.ERROR_BARS.beforeDatasetsDraw(chart);
    chart.data.datasets[0].borderColor = 'dark-colour';
    Plots.ERROR_BARS.beforeDatasetsDraw(chart);
    assert.deepEqual(log.filter(([op]) => op === 'stroke').map(([, colour]) => colour), ['light-colour', 'dark-colour']);
});

test('[sasfit-plots] 誤差棒：圖還沒排版好（沒有 chartArea 或 y 軸）時不丟錯', () => {
    assert.doesNotThrow(() => Plots.ERROR_BARS.beforeDatasetsDraw({ ctx: {}, data: { datasets: [] }, chartArea: undefined, scales: {} }));
});

// ---------------------------------------------------------------- 序列的趨勢圖（M4 Task 9）
const { seqState } = require('./sasfit-m4-helpers.js');

const SeqView = globalThis.SasFitSeqView;
const trendConfigOf = (options, y = 'radius') => SeqView.trendConfig(SeqView.trend(seqState(options).state, y));
function installTrendDom() {
    const canvases = { sfMainChart: { id: 'sfMainChart' }, sfResidualChart: { id: 'sfResidualChart' }, sfSeqTrend: { id: 'sfSeqTrend' } };
    global.document = { getElementById: (id) => canvases[id] || null };
}

test('[sasfit-plots] renderTrend：第一次在 #sfSeqTrend 建立，已上色，帶誤差棒外掛', () => {
    installTrendDom();
    const config = trendConfigOf();
    const chart = Plots.renderTrend(config);
    assert.equal(created.length, 1);
    assert.equal(chart, created[0]);
    assert.equal(chart.canvas.id, 'sfSeqTrend');
    assert.equal(Plots.getChart('sfSeqTrend'), chart);
    assert.ok(chart.config.plugins.some((plugin) => plugin.id === Plots.ERROR_BARS.id));
    assert.equal(chart.config.data.datasets[0].borderColor, ChartTheme.PALETTES.light.series[0]);
    assert.equal(chart.config.data.datasets[0].backgroundColor, ChartTheme.PALETTES.light.series[0], '實心點：形狀區分未收斂');
    assert.equal(config.plugins, undefined, '傳入的 config 沒被改');
    assert.equal(config.data.datasets[0].borderColor, undefined);
    assert.match(SOURCE, /createChart\(canvas, \{ \.\.\.config, plugins: \[ERROR_BARS\] \}\)/);
});

test('[sasfit-plots] renderTrend：之後的呼叫把新資料與軸標題寫進既有實例並以 ChartTheme.applyTo 更新', () => {
    installTrendDom();
    const chart = Plots.renderTrend(trendConfigOf());
    const next = trendConfigOf({ conditionName: 'pH' }, SeqView.MEASURE_KEY);
    assert.equal(Plots.renderTrend(next), chart);
    assert.equal(created.length, 1);
    assert.equal(chart.config.data.datasets[0].label, '約化 χ²');
    assert.equal(chart.config.data.datasets[0].borderColor, ChartTheme.PALETTES.light.series[0], '新 dataset 已上色');
    assert.equal(chart.config.options.scales.x.title.text, 'pH');
    assert.equal(chart.config.options.scales.y.title.text, '約化 χ²');
    assert.deepEqual(chart.updates, ['none']);
    assert.equal(chart.config.options.plugins.tooltip.callbacks.label({ parsed: { x: 1, y: 2 } }), '約化 χ² 2.0000');
});

test('[sasfit-plots] renderTrend(null) 銷毀；destroy() 連趨勢圖一起；主圖換模式不動趨勢圖', () => {
    installTrendDom();
    const first = Plots.renderTrend(trendConfigOf());
    assert.equal(Plots.renderTrend(null), null);
    assert.equal(first.destroyed, true);
    assert.equal(Plots.getChart('sfSeqTrend'), null);
    assert.doesNotThrow(() => Plots.renderTrend(null));
    const second = Plots.renderTrend(trendConfigOf());
    Plots.render(viewOf());
    Plots.render(viewOf({ mode: 'kratky' }));
    assert.equal(second.destroyed, false, '主圖重建不銷毀趨勢圖');
    assert.equal(Plots.getChart('sfSeqTrend'), second);
    Plots.destroy();
    assert.equal(second.destroyed, true);
    assert.equal(Plots.getChart('sfSeqTrend'), null);
    assert.equal(Plots.getChart('nope'), null);
});

test('[sasfit-plots] renderTrend：沒有 Chart 或沒有 canvas → null、不丟錯', () => {
    assert.equal(Plots.renderTrend(trendConfigOf()), null, 'installDom 的文件沒有 sfSeqTrend');
    installTrendDom();
    delete window.Chart;
    assert.equal(Plots.renderTrend(trendConfigOf()), null);
    assert.equal(created.length, 0);
});
