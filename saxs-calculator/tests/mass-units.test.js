'use strict';
/**
 * 分子量單位（v5.1 規格 docs/superpowers/specs/2026-10-15-kda-units-design.md）。
 * 計算一律用 Da，畫面一律用 kDa：mass-units.js 是兩者之間唯一的換算點。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MassUnits } = require('./load.js');
const { read, readCode } = require('./style-scan.js');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------- 換算與格式
test('[mass] daToKDa／kDaToDa 互為反函數', () => {
    assert.equal(MassUnits.daToKDa(66500), 66.5);
    assert.equal(MassUnits.kDaToDa(66.5), 66500);
    for (const da of [12700, 66430.5, 69293.82, 1.5e6]) {
        assert.ok(Math.abs(MassUnits.kDaToDa(MassUnits.daToKDa(da)) - da) < 1e-9, String(da));
    }
});

test('[mass] formatKDa：固定 2 位、en-US 千分位、非有限值回 -', () => {
    assert.equal(MassUnits.formatKDa(69293.82), '69.29');
    assert.equal(MassUnits.formatKDa(66500), '66.50');
    assert.equal(MassUnits.formatKDa(130000), '130.00');
    assert.equal(MassUnits.formatKDa(3500), '3.50');
    assert.equal(MassUnits.formatKDa(1234567), '1,234.57');
    for (const bad of [NaN, Infinity, undefined, null]) {
        assert.equal(MassUnits.formatKDa(bad), '-', String(bad));
    }
});

test('[mass] formatDa：固定 2 位、en-US 千分位', () => {
    assert.equal(MassUnits.formatDa(69293.82), '69,293.82');
    assert.equal(MassUnits.formatDa(12700), '12,700.00');
    assert.equal(MassUnits.formatDa(NaN), '-');
});

test('[mass] toInputValue：kDa、最多 3 位小數（1 Da）、去尾端 0', () => {
    assert.equal(MassUnits.toInputValue(69293.82), '69.294');
    assert.equal(MassUnits.toInputValue(66500), '66.5');
    assert.equal(MassUnits.toInputValue(66430), '66.43');
    assert.equal(MassUnits.toInputValue(130000), '130');
    assert.equal(MassUnits.toInputValue(NaN), '');
    assert.equal(MassUnits.toInputValue(undefined), '');
});

test('[mass] 1 Da 精度：帶入值換回 Da 與序列 MW 相差 ≤ 0.5 Da（SAXS 面板的 1 Da 容差成立）', () => {
    for (const da of [12345.678, 66430.5, 69293.82, 150000.4999]) {
        const back = MassUnits.kDaToDa(Number(MassUnits.toInputValue(da)));
        assert.ok(Math.abs(back - da) <= 0.5 + 1e-9, `${da} → ${back}`);
    }
});

test('[mass] isLikelyDa／hintMessage：大於 10,000 kDa 才提示', () => {
    assert.equal(MassUnits.isLikelyDa(10000), false);
    assert.equal(MassUnits.isLikelyDa(10000.01), true);
    assert.equal(MassUnits.isLikelyDa(66500), true);
    assert.equal(MassUnits.isLikelyDa(NaN), false);
    assert.equal(MassUnits.hintMessage('66.5'), '');
    assert.equal(MassUnits.hintMessage(''), '');
    assert.equal(MassUnits.hintMessage('abc'), '');
    assert.equal(MassUnits.hintMessage('66500'),
        '超過 10,000 kDa（10 MDa），是不是輸入了 Da？例：66500 Da 請輸入 66.5');
});

// ---------------------------------------------------------------- 存檔遷移
test('[mass] migrateSavedValues：只換 5 個分子量欄位，其餘原樣，不修改傳入物件', () => {
    const before = Object.freeze({
        theoreticalMWInput: '69294',
        inputMw: '69293.82',
        mwInput: '150000',
        centrifugeMw: '50000',
        targetProteinMW: '12700',
        uvAbsorbance: '0.5',
        proteinSequence: 'MKV',
        someCheckbox: true,
    });
    const after = MassUnits.migrateSavedValues(before);
    assert.deepEqual(after, {
        theoreticalMWInput: '69.294',
        inputMw: '69.294',
        mwInput: '150',
        centrifugeMw: '50',
        targetProteinMW: '12.7',
        uvAbsorbance: '0.5',
        proteinSequence: 'MKV',
        someCheckbox: true,
    });
    assert.notEqual(after, before);
});

test('[mass] migrateSavedValues：空字串與非數值原樣保留', () => {
    const after = MassUnits.migrateSavedValues({ inputMw: '', mwInput: ' ', centrifugeMw: 'abc' });
    assert.deepEqual(after, { inputMw: '', mwInput: ' ', centrifugeMw: 'abc' });
});

test('[mass] INPUT_IDS 的 5 個欄位都在 index.html 裡', () => {
    const html = read('index.html');
    assert.equal(MassUnits.INPUT_IDS.length, 5);
    for (const id of MassUnits.INPUT_IDS) {
        assert.match(html, new RegExp(`id="${id}"`), id);
    }
});

// ---------------------------------------------------------------- 畫面不再出現 Da
/**
 * 畫面層（index.html、各頁 section-*.js、偵測器 UI）不得把 Da 當單位顯示。
 * 允許的只有：公式說明「MW 以 Da 代入」，以及蛋白質頁的 Da 精確值（formatDa 那一處）。
 * 計算模組（protein.js、calculations.js…）本來就以 Da 為單位，不在掃描範圍。
 */
const UI_FILES = Object.freeze([
    'index.html',
    'js/detector-rg-panel.js',
    'js/detector-limits-ui.js',
    ...fs.readdirSync(path.join(__dirname, '..', 'js'))
        .filter(f => /^section-.*\.js$/.test(f)).sort().map(f => `js/${f}`),
]);
const ALLOWED_DA = Object.freeze([
    /MW 以 Da 代入/g,
    /\$\{MassUnits\.formatDa\([^)]*\)\} Da/g,
]);

test('[mass] 畫面層不再出現 Da 單位（公式補註與蛋白質頁精確值除外）', () => {
    const problems = [];
    for (const file of UI_FILES) {
        const code = ALLOWED_DA.reduce((src, re) => src.replace(re, ''), readCode(file));
        code.split('\n').forEach((line, i) => {
            if (/\bDa\b/.test(line)) problems.push(`${file}:${i + 1}（去註解後）${line.trim().slice(0, 100)}`);
        });
    }
    assert.deepEqual(problems, []);
});

test('[mass] 蛋白質頁保留 Da 精確值', () => {
    const code = readCode('js/section-protein.js');
    assert.match(code, /\$\{MassUnits\.formatDa\(result\.molecularWeight\)\} Da/);
});

test('[mass] 以 Da 為自變數的公式說明都補註「MW 以 Da 代入」', () => {
    const html = read('index.html');
    // 理論值面板公式列、detectorRgSource 的 title、偵測器頁 0.69 × MW^1/3 與 0.251 × MW^0.43 附註
    assert.ok((html.match(/MW 以 Da 代入/g) || []).length >= 4, 'index.html 少於 4 處補註');
    assert.match(readCode('js/detector-rg-panel.js'), /MW 以 Da 代入/);
    assert.match(readCode('js/section-saxs.js'), /MW 以 Da 代入/);
});
