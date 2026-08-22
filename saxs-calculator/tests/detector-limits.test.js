'use strict';
/**
 * Eiger 9M 偵測器行程上下限提示（v4.11）。
 *
 * 事實來源（2026-08-22 TPS 13A 光束線確認）：9M 只能走 2,200–10,000 mm。
 * Excel 線性模型 SD = 1900 × Rg / 28 的 BSA 錨點 1900 mm 本身就低於下限，
 * 所以「建議值低於行程」是常態，不是 bug —— 建議值不夾，只補警告與夾到極限後的 qmin。
 *
 * 夾限後可達的 qmin：qmin ∝ 1/SD ⇒ qminAtLimit = qmin × suggestedSD / sdLimit，
 * 並給 qmin·Rg（BSA 基準 0.224）讓使用者判斷 Guinier 區夠不夠。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SAXS, DetectorLimits } = require('./load.js');

const approx = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol,
        `${msg}: ${actual} != ${expected} (±${tol})`);

const MIN_MM = SAXS.DETECTOR_SD_MIN_MM;
const MAX_MM = SAXS.DETECTOR_SD_MAX_MM;

// ---------------------------------------------------------------- 常數
test('[9M] 行程常數就是光束線確認的 2,200 / 10,000 mm', () => {
    assert.equal(MIN_MM, 2200);
    assert.equal(MAX_MM, 10000);
});

// ---------------------------------------------------------------- below
test('[9M] BSA (66,500 Da) 的建議 1,900 mm 低於最近行程，值不被夾掉', () => {
    const r = SAXS.calculateDetectorDistance(66500, 'mw');
    assert.equal(r.suggestedSD, 1900, '建議值必須照 Excel 模型顯示，不夾');
    assert.equal(r.sdStatus, 'below');
    assert.equal(r.sdLimit, MIN_MM);
});

test('[9M] BSA 夾到最近行程後的 qmin 與 q·Rg', () => {
    const r = SAXS.calculateDetectorDistance(66500, 'mw');
    // qmin ∝ 1/SD：0.008 × 1900/2200
    approx(r.qminAtLimit, r.qmin * r.suggestedSD / MIN_MM, 5e-7, 'qminAtLimit');
    approx(r.qminAtLimit, 0.006909, 5e-7, 'qminAtLimit (Excel 錨點推得)');
    approx(r.qRgAtLimit, 0.193, 5e-4, 'qRgAtLimit');
});

// ---------------------------------------------------------------- 邊界
test('[9M] 邊界含等於：剛好 2,200 mm 與剛好 10,000 mm 都算 ok', () => {
    const low = SAXS.calculateDetectorDistance(32.43, 'rg');   // → 2,201 mm
    assert.ok(low.suggestedSD >= MIN_MM && low.suggestedSD <= MAX_MM,
        `32.43 Å 應落在行程內，實得 ${low.suggestedSD} mm`);
    assert.equal(low.sdStatus, 'ok');

    const high = SAXS.calculateDetectorDistance(147.37, 'rg'); // → 10,000 mm
    assert.equal(high.suggestedSD, MAX_MM, '147.37 Å 應剛好落在最遠行程');
    assert.equal(high.sdStatus, 'ok');
});

test('[9M] ok 時三個新欄位為 null，不留半調子的數字', () => {
    for (const rg of [32.43, 50, 147.37]) {
        const r = SAXS.calculateDetectorDistance(rg, 'rg');
        assert.equal(r.sdStatus, 'ok', `Rg ${rg} 應在行程內`);
        assert.equal(r.sdLimit, null);
        assert.equal(r.qminAtLimit, null);
        assert.equal(r.qRgAtLimit, null);
    }
});

// ---------------------------------------------------------------- above
test('[9M] Rg 148 Å 超過最遠行程', () => {
    const r = SAXS.calculateDetectorDistance(148, 'rg');
    assert.equal(r.sdStatus, 'above');
    assert.equal(r.sdLimit, MAX_MM);
    assert.ok(r.suggestedSD > MAX_MM, '建議值本身不夾');
});

test('[9M] Rg 200 Å 夾到最遠行程後的 qmin 與 q·Rg', () => {
    const r = SAXS.calculateDetectorDistance(200, 'rg');
    assert.equal(r.sdStatus, 'above');
    approx(r.qminAtLimit, r.qmin * r.suggestedSD / MAX_MM, 5e-7, 'qminAtLimit');
    approx(r.qminAtLimit, 0.001520, 5e-7, 'qminAtLimit');
    approx(r.qRgAtLimit, 0.304, 5e-4, 'qRgAtLimit');
    approx(r.qRgAtLimit, r.qminAtLimit * r.rg, 5e-4, 'q·Rg 就是 qminAtLimit × Rg');
});

test('[9M] 夾限不改變物理：qmin × SD 在夾限前後守恆', () => {
    for (const rg of [10, 28, 200, 400]) {
        const r = SAXS.calculateDetectorDistance(rg, 'rg');
        if (r.sdStatus === 'ok') continue;
        approx(r.qminAtLimit * r.sdLimit, r.qmin * r.suggestedSD, 1e-3,
            `Rg ${rg}: qmin·SD 應守恆`);
    }
});

// ---------------------------------------------------------------- 既有欄位不變
test('[9M] 既有欄位與精度沒被新欄位動到', () => {
    const r = SAXS.calculateDetectorDistance(66500, 'mw');
    assert.equal(r.mw, 66500);
    approx(r.rg, 28, 5e-3, 'rg');
    approx(r.qmin, 0.008, 5e-7, 'qmin');
    assert.equal(r.suggestedSDMeters, 1.9);
    assert.equal(r.referenceProtein, 'BSA monomer');
});

// ---------------------------------------------------------------- 文案
test('[9M] 提示文案：ok 沒有訊息，below/above 各一行', () => {
    assert.equal(DetectorLimits.describe(SAXS.calculateDetectorDistance(50, 'rg')), null);
    assert.equal(DetectorLimits.describe(null), null);

    const below = DetectorLimits.describe(SAXS.calculateDetectorDistance(66500, 'mw'));
    assert.equal(below,
        '⚠️ 低於 9M 最近行程 2,200 mm — 請設 2,200 mm，此時 qmin ≈ 0.0069 Å⁻¹（q·Rg = 0.19）');

    const above = DetectorLimits.describe(SAXS.calculateDetectorDistance(200, 'rg'));
    assert.equal(above,
        '⚠️ 超過 9M 最遠行程 10,000 mm — 請設 10,000 mm，此時 qmin ≈ 0.0015 Å⁻¹（q·Rg = 0.30，BSA 基準 0.22）');

    for (const text of [below, above]) {
        assert.ok(!text.includes('\n'), '提示是一行');
    }
});
