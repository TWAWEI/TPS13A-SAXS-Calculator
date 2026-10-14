'use strict';
/**
 * 主題切換與圖表主題（改版規格 §4、§6、§8.1-4）。
 * theme-init.js 與 chart-theme.js 由 tests/load.js 在沒有 document 的 Node 環境載入——
 * 能載入本身就證明兩檔的頂層沒有碰 DOM／Chart。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ThemeInit, ChartTheme } = require('./load.js');

/** 暫時把 window.document 換成只有 <html data-theme> 的 stub */
function withThemeAttr(value, fn) {
    const saved = window.document;
    window.document = { documentElement: { getAttribute: name => (name === 'data-theme' ? value : null) } };
    try {
        return fn();
    } finally {
        if (saved === undefined) delete window.document;
        else window.document = saved;
    }
}

// ---------------------------------------------------------------- ThemeInit
test('[theme] normalize：只有 light／dark 會保留，其他一律 auto', () => {
    assert.equal(ThemeInit.normalize('light'), 'light');
    assert.equal(ThemeInit.normalize('dark'), 'dark');
    for (const raw of [null, undefined, '', 'auto', 'Dark', 'system', '1']) {
        assert.equal(ThemeInit.normalize(raw), 'auto', String(raw));
    }
});

test('[theme] resolve：手動優先，自動跟系統', () => {
    assert.equal(ThemeInit.resolve('light', true), 'light');
    assert.equal(ThemeInit.resolve('dark', false), 'dark');
    assert.equal(ThemeInit.resolve('auto', true), 'dark');
    assert.equal(ThemeInit.resolve('auto', false), 'light');
});

test('[theme] effective：讀 data-theme；沒有 document 時是淺色', () => {
    assert.equal(ThemeInit.effective(), 'light');
    assert.equal(withThemeAttr('dark', () => ThemeInit.effective()), 'dark');
    assert.equal(withThemeAttr('light', () => ThemeInit.effective()), 'light');
});

test('[theme] localStorage 鍵名', () => {
    assert.equal(ThemeInit.STORAGE_KEY, 'tps13a-theme');
});

// ---------------------------------------------------------------- ChartTheme.colorAssignments
const valueAt = (assignments, path) => {
    const hit = assignments.find(a => a.path.join('.') === path);
    return hit ? hit.value : undefined;
};

test('[chart-theme] dataset、scale、annotation 依 tpsRole 上色', () => {
    const p = ChartTheme.PALETTES.dark;
    const structure = {
        data: { datasets: [{ tpsRole: 'primary' }, { tpsRole: 'model' }, { tpsRole: 'region' }, { label: '未標記' }] },
        options: {
            scales: { x: {}, y: { tpsRole: 'primary' } },
            plugins: {
                annotation: {
                    annotations: {
                        box: { type: 'box', tpsRole: 'region', label: { content: 'q' } },
                        line: { type: 'line', tpsRole: 'marker', label: { content: 'Peak' } },
                        plain: { type: 'line' },
                    },
                },
            },
        },
    };
    const a = ChartTheme.colorAssignments(structure, p);
    assert.equal(valueAt(a, 'data.datasets.0.borderColor'), p.primary);
    assert.equal(valueAt(a, 'data.datasets.1.borderColor'), p.model);
    assert.equal(valueAt(a, 'data.datasets.2.backgroundColor'), p.region);
    assert.equal(valueAt(a, 'data.datasets.2.borderColor'), p.marker);
    assert.equal(valueAt(a, 'data.datasets.3.borderColor'), undefined, '沒有標記的 dataset 不上色');
    assert.equal(valueAt(a, 'options.scales.x.ticks.color'), p.text);
    assert.equal(valueAt(a, 'options.scales.x.border.color'), p.grid);
    assert.equal(valueAt(a, 'options.scales.y.border.color'), p.primary, '帶用途的軸只有軸線上色');
    assert.equal(valueAt(a, 'options.scales.y.ticks.color'), p.text, '刻度一律文字色');
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.box.backgroundColor'), p.region);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.box.label.color'), p.text);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.box.label.backgroundColor'), undefined);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.line.borderColor'), p.marker);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.line.label.backgroundColor'), p.surface);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.plain.borderColor'), undefined);
    assert.equal(valueAt(a, 'options.plugins.legend.labels.color'), p.text);
    assert.equal(valueAt(a, 'options.plugins.tooltip.backgroundColor'), p.tooltipBg);
});

test('[chart-theme] tpsSeries 依編號取色；用完重用同色並改虛線', () => {
    const p = ChartTheme.PALETTES.light;
    const n = p.series.length;
    const structure = { data: { datasets: [{ tpsSeries: 1 }, { tpsSeries: n + 1 }] }, options: { scales: { y0: { tpsSeries: 1 } } } };
    const a = ChartTheme.colorAssignments(structure, p);
    assert.equal(valueAt(a, 'data.datasets.0.borderColor'), p.series[1]);
    assert.deepEqual(valueAt(a, 'data.datasets.0.borderDash'), []);
    assert.equal(valueAt(a, 'data.datasets.1.borderColor'), p.series[1]);
    assert.deepEqual(valueAt(a, 'data.datasets.1.borderDash'), [6, 4]);
    assert.equal(valueAt(a, 'options.scales.y0.border.color'), p.series[1]);
});

test('[chart-theme] 圓餅圖：每片一色，Others 用 reference，分隔線是卡片色', () => {
    const p = ChartTheme.PALETTES.light;
    const structure = { data: { datasets: [{ tpsSeries: 'byIndex', tpsOthersIndex: 3, data: [5, 4, 3, 9] }] }, options: {} };
    const a = ChartTheme.colorAssignments(structure, p);
    assert.deepEqual(valueAt(a, 'data.datasets.0.backgroundColor'), [p.series[0], p.series[1], p.series[2], p.reference]);
    assert.equal(valueAt(a, 'data.datasets.0.borderColor'), p.surface);
});

test('[chart-theme] 系列色 8 色，兩個主題長度一致', () => {
    assert.equal(ChartTheme.PALETTES.light.series.length, 8);
    assert.equal(ChartTheme.PALETTES.dark.series.length, 8);
    assert.equal(ChartTheme.PALETTES.light.series[0], ChartTheme.PALETTES.light.primary, 'series[0] 與主線一致');
    assert.equal(ChartTheme.PALETTES.dark.series[0], ChartTheme.PALETTES.dark.primary);
});

// ---------------------------------------------------------------- colorize
test('[chart-theme] colorize 不修改傳入的 config（含淺展開共用的巢狀物件），data 陣列沿用參照', () => {
    const shared = { plugins: { legend: { labels: { font: { size: 12 } } } } };
    const points = [{ x: 0, y: 1 }];
    const label = () => 'x';
    const config = {
        type: 'scatter',
        data: { datasets: [{ tpsRole: 'primary', data: points }] },
        options: { ...shared, plugins: { ...shared.plugins, tooltip: { callbacks: { label } } }, scales: { x: {} } },
    };
    const before = JSON.stringify(config);
    const out = ChartTheme.colorize(config, 'dark');
    assert.equal(JSON.stringify(config), before, '原 config 不變');
    assert.equal(shared.plugins.legend.labels.color, undefined, '共用物件沒被寫到');
    assert.equal(out.data.datasets[0].data, points, 'data 陣列沿用參照（不複製上萬點）');
    assert.equal(out.options.plugins.tooltip.callbacks.label, label, '函式沿用參照');
    assert.equal(out.data.datasets[0].borderColor, ChartTheme.PALETTES.dark.primary);
    assert.ok(out.plugins.some(pl => pl.id === 'tpsCanvasBackground'), '帶白底外掛');
});

// ---------------------------------------------------------------- applyTo / exportPng
function stubChart(log) {
    const options = { plugins: { legend: { labels: {} } }, scales: { x: { ticks: {} } } };
    const chart = {
        config: { data: { datasets: [{ tpsRole: 'primary', data: [] }] }, options },
        stop() { log.push('stop'); },
        update(mode) { log.push(`update:${mode}:${this.config.data.datasets[0].borderColor}:${Boolean(this.$tpsExportBackground)}`); },
        toBase64Image() {
            log.push(`image:${this.config.data.datasets[0].borderColor}:${Boolean(this.$tpsExportBackground)}`);
            if (this.failOnImage) throw new Error('boom');
            return 'data:image/png;base64,AAA';
        },
    };
    return { chart, refs: { options, plugins: options.plugins, legend: options.plugins.legend, scaleX: options.scales.x } };
}

test('[chart-theme] applyTo 只寫葉節點：options 與其巢狀物件的參照都不變', () => {
    const log = [];
    const { chart, refs } = stubChart(log);
    ChartTheme.applyTo(chart, 'dark');
    assert.equal(chart.config.options, refs.options);
    assert.equal(chart.config.options.plugins, refs.plugins);
    assert.equal(chart.config.options.plugins.legend, refs.legend);
    assert.equal(chart.config.options.scales.x, refs.scaleX);
    assert.equal(chart.config.options.scales.x.ticks.color, ChartTheme.PALETTES.dark.text);
    assert.deepEqual(log, [`update:none:${ChartTheme.PALETTES.dark.primary}:false`]);
});

test('[chart-theme] exportPng（深色模式）：換淺色 → 白底 → 取圖 → 還原深色', () => {
    const log = [];
    const { chart } = stubChart(log);
    const L = ChartTheme.PALETTES.light.primary;
    const D = ChartTheme.PALETTES.dark.primary;
    withThemeAttr('dark', () => ChartTheme.applyTo(chart));
    log.length = 0;
    const url = withThemeAttr('dark', () => ChartTheme.exportPng(chart));
    assert.equal(url, 'data:image/png;base64,AAA');
    assert.deepEqual(log, ['stop', `update:none:${L}:true`, `image:${L}:true`, `update:none:${D}:false`]);
});

test('[chart-theme] exportPng 中途丟例外也會還原主題與白底旗標', () => {
    const log = [];
    const { chart } = stubChart(log);
    chart.failOnImage = true;
    withThemeAttr('dark', () => ChartTheme.applyTo(chart));
    assert.throws(() => withThemeAttr('dark', () => ChartTheme.exportPng(chart)), /boom/);
    assert.equal(chart.config.data.datasets[0].borderColor, ChartTheme.PALETTES.dark.primary);
    assert.equal(chart.$tpsExportBackground, false);
});

test('[chart-theme] exportPng（淺色模式）不換色，只開白底', () => {
    const log = [];
    const { chart } = stubChart(log);
    ChartTheme.applyTo(chart, 'light');
    log.length = 0;
    withThemeAttr('light', () => ChartTheme.exportPng(chart));
    const L = ChartTheme.PALETTES.light.primary;
    assert.deepEqual(log, ['stop', `update:none:${L}:true`, `image:${L}:true`, `update:none:${L}:false`]);
});

// ---------------------------------------------------------------- v5.0 code review 修正
test('[chart-theme] 列印前把所有圖表換成淺色、列印後換回目前主題（canvas 是點陣圖，不會跟著 @media print）', () => {
    const listeners = {};
    const saved = { document: window.document, addEventListener: window.addEventListener, Chart: window.Chart };
    const log = [];
    const { chart } = stubChart(log);
    window.document = {
        addEventListener() {},
        documentElement: { getAttribute: name => (name === 'data-theme' ? 'dark' : null) },
    };
    window.addEventListener = (type, fn) => { listeners[type] = fn; };
    window.Chart = function Chart() {};
    window.Chart.instances = { 0: chart };
    try {
        ChartTheme.init();
        assert.equal(typeof listeners.beforeprint, 'function', '沒有註冊 beforeprint');
        assert.equal(typeof listeners.afterprint, 'function', '沒有註冊 afterprint');
        listeners.beforeprint();
        assert.equal(chart.config.data.datasets[0].borderColor, ChartTheme.PALETTES.light.primary);
        listeners.afterprint();
        assert.equal(chart.config.data.datasets[0].borderColor, ChartTheme.PALETTES.dark.primary);
    } finally {
        Object.entries(saved).forEach(([key, value]) => {
            if (value === undefined) delete window[key];
            else window[key] = value;
        });
    }
});

test('[theme] ThemeToggle.init：舊瀏覽器的 MediaQueryList 只有 addListener 也不會丟例外', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const file = path.join(__dirname, '..', 'js', 'theme-toggle.js');
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });

    const saved = { document: window.document, matchMedia: window.matchMedia, localStorage: window.localStorage };
    let registered = null;
    window.localStorage = { getItem: () => null };
    window.document = {
        getElementById: () => ({ querySelectorAll: () => [] }),
        documentElement: { hasAttribute: () => false, getAttribute: () => null },
    };
    window.matchMedia = () => ({ matches: false, addListener: fn => { registered = fn; } });
    try {
        assert.doesNotThrow(() => window.ThemeToggle.init());
        assert.equal(typeof registered, 'function', '應改用 addListener 註冊系統外觀監聽');
    } finally {
        Object.entries(saved).forEach(([key, value]) => {
            if (value === undefined) delete window[key];
            else window[key] = value;
        });
    }
});
