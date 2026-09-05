'use strict';
/**
 * 脂質體 DOX 載藥量（D/L）計算模組。
 *
 * 規格：docs/superpowers/specs/2026-09-05-liposome-dox-loading-design.md
 * 所有回歸值來自本地 Excel「Liposome DOX-loading calculation-Bypass.xlsx」的 DL 工作表
 * （openpyxl data_only 讀出的完整快取值，不是顯示值）。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Liposome } = require('./load.js');

const approx = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol,
        `${msg}: ${actual} != ${expected} (±${tol})`);

const relApprox = (actual, expected, rel, msg) =>
    assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected),
        `${msg}: ${actual} != ${expected} (rel ±${rel})`);

// ---------------------------------------------------------------- 基礎工具
test('[lipo] interpolateLinear 在格點上取值、格點間線性、範圍外 throw', () => {
    const xs = [0, 1, 2, 4];
    const ys = [0, 10, 20, 40];
    assert.equal(Liposome.interpolateLinear(xs, ys, 0), 0, '左端點');
    assert.equal(Liposome.interpolateLinear(xs, ys, 4), 40, '右端點');
    assert.equal(Liposome.interpolateLinear(xs, ys, 2), 20, '中間格點');
    approx(Liposome.interpolateLinear(xs, ys, 3), 30, 1e-12, '格點間');
    approx(Liposome.interpolateLinear(xs, ys, 0.25), 2.5, 1e-12, '第一段');
    assert.throws(() => Liposome.interpolateLinear(xs, ys, -0.1), /超出範圍/);
    assert.throws(() => Liposome.interpolateLinear(xs, ys, 4.1), /超出範圍/);
    assert.throws(() => Liposome.interpolateLinear([1], [1], 1), /至少/);
});

test('[lipo] sampleStd 是 n−1 的樣本標準差（Excel STDEV.S），n<2 回 0', () => {
    // Excel DL!F2 = STDEV.S(0.90287, 0.91973, 0.94266) = 0.019972016256085294
    approx(Liposome.sampleStd([0.90287, 0.91973, 0.94266]), 0.019972016256085294, 1e-15, 'DOX-18 F 欄');
    assert.equal(Liposome.sampleStd([5]), 0);
    assert.equal(Liposome.sampleStd([]), 0);
});

test('[lipo] DEFAULTS 與規格一致', () => {
    const d = Liposome.DEFAULTS;
    assert.deepEqual(
        [d.Q_MIN, d.Q_MAX, d.MIN_WINDOW_POINTS, d.EPSILON_DOX, d.PATH_CM, d.PRIMARY_WAVELENGTH_NM, d.FIT_MIN_NM, d.FIT_MAX_NM, d.LSQ_WARN_REL],
        [0.1, 0.15, 5, 9250, 0.2, 495, 450, 550, 0.05]);
    assert.deepEqual([...d.WAVELENGTHS_NM], [494, 495, 496]);
    assert.ok(Object.isFrozen(d));
});
