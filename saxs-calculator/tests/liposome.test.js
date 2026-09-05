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

// ---------------------------------------------------------------- 稀釋因子
/** Guinier 型合成曲線 I(q) = 10·exp(−(30q)²/3)，q 0.005…0.3 步進 0.001。 */
function guinierCurve(scale, qOffset) {
    const q = [];
    const i = [];
    for (let k = 0; k <= 295; k++) {
        // toFixed 避免 0.005 + 95×0.001 變成 0.09999999999999999 而掉出 q ≥ 0.1 的視窗
        const qk = Number((0.005 + k * 0.001 + qOffset).toFixed(6));
        q.push(qk);
        i.push(scale * 10 * Math.exp(-((30 * qk) ** 2) / 3));
    }
    return { q, i };
}

test('[lipo] 稀釋因子 (a) 同格點：平均、最小平方都回 0.45，SD 為 0', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0);
    const r = Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.1, qMax: 0.15 });
    approx(r.factor, 0.45, 1e-9, 'factor');
    approx(r.lsqScale, 0.45, 1e-9, 'lsqScale');
    assert.ok(r.sd < 1e-9, `sd ${r.sd}`);
    assert.equal(r.n, 51, '0.100…0.150 步進 0.001 = 51 點');
    assert.deepEqual(r.excluded, { outOfRange: 0, nonPositive: 0 });
    assert.ok(Object.isFrozen(r));
});

test('[lipo] 稀釋因子 (b) 偏移格點：內插後仍在 0.45 ± 1e-3（線性內插對高斯有二階誤差，勿改內插法）', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0.0003);
    const r = Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.1, qMax: 0.15 });
    approx(r.factor, 0.45, 1e-3, 'factor');
    assert.ok(r.sd < 1e-3, `sd ${r.sd}`);
    approx(r.lsqScale, 0.45, 1e-3, 'lsqScale');
});

test('[lipo] 稀釋因子：預設 q 視窗 0.1–0.15、視窗不足 5 點 throw、非正強度被排除並計數', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0);
    const byDefault = Liposome.computeDilutionFactor(solution, bypass);
    assert.equal(byDefault.n, 51);

    assert.throws(() => Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.1, qMax: 0.102 }),
        /只有 3 個有效點/);
    assert.throws(() => Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.15, qMax: 0.1 }),
        /上限必須大於下限/);

    // bypass 在視窗內有 2 點是負值 → 排除、計數，其餘照算
    const dented = { q: bypass.q, i: bypass.i.map((v, k) => (bypass.q[k] > 0.1199 && bypass.q[k] < 0.1211 ? -1 : v)) };
    const r = Liposome.computeDilutionFactor(solution, dented);
    assert.equal(r.excluded.nonPositive, 2);
    assert.equal(r.n, 49);
    approx(r.factor, 0.45, 1e-9, 'factor after exclusion');

    // bypass 的 q 範圍沒蓋住視窗 → 超出的點計入 outOfRange
    const short = { q: bypass.q.filter(q => q <= 0.13), i: bypass.i.filter((_, k) => bypass.q[k] <= 0.13) };
    const r2 = Liposome.computeDilutionFactor(solution, short);
    assert.ok(r2.excluded.outOfRange > 0);
    assert.equal(r2.n + r2.excluded.outOfRange, 51);
});

test('[lipo] 稀釋因子：曲線 q 非嚴格遞增或長度不一致 throw', () => {
    assert.throws(() => Liposome.computeDilutionFactor({ q: [0.1, 0.1, 0.2], i: [1, 1, 1] }, guinierCurve(1, 0)), /嚴格遞增/);
    assert.throws(() => Liposome.computeDilutionFactor({ q: [0.1, 0.2], i: [1] }, guinierCurve(1, 0)), /長度不一致/);
});

// ---------------------------------------------------------------- 光譜
/** 合成光譜：blank = 2·exp(−λ/150)，pure = 高斯（中心 495、寬 25、峰 1），loaded = blank + k·pure。 */
function syntheticSpectra(k, step = 1, from = 400, to = 600) {
    const wavelength = [];
    for (let w = from; w <= to + 1e-9; w += step) wavelength.push(Number(w.toFixed(4)));
    const blankA = wavelength.map(w => 2 * Math.exp(-w / 150));
    const pureA = wavelength.map(w => Math.exp(-((w - 495) ** 2) / (2 * 25 ** 2)));
    const loadedA = blankA.map((b, j) => b + k * pureA[j]);
    return {
        loaded: { wavelength, absorbance: loadedA },
        blank: { wavelength, absorbance: blankA },
        pure: { wavelength, absorbance: pureA },
    };
}

test('[lipo] subtractSpectra 回 loaded − blank（同格點時精確到 1e-9），結果凍結', () => {
    const s = syntheticSpectra(0.8);
    const r = Liposome.subtractSpectra(s.loaded, s.blank);
    assert.equal(r.wavelength.length, 201);
    assert.equal(r.dropped, 0);
    r.absorbance.forEach((a, j) => approx(a, 0.8 * s.pure.absorbance[j], 1e-9, `λ=${r.wavelength[j]}`));
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.absorbance));
});

test('[lipo] subtractSpectra 以 loaded 格點為準、blank 內插；loaded 超出 blank 範圍的點捨棄並計數', () => {
    const s = syntheticSpectra(0.8, 1, 400, 600);
    const blankHalf = syntheticSpectra(0.8, 0.5, 450, 550).blank;     // 0.5 nm 格點、範圍較窄
    const r = Liposome.subtractSpectra(s.loaded, blankHalf);
    assert.equal(r.wavelength.length, 101, '450…550 共 101 點');
    assert.equal(r.dropped, 100);
    r.absorbance.forEach((a, j) => approx(a, 0.8 * Math.exp(-((r.wavelength[j] - 495) ** 2) / 1250), 1e-6, `λ=${r.wavelength[j]}`));
});

test('[lipo] subtractSpectra 重疊不足 10 點 throw', () => {
    const s = syntheticSpectra(0.8, 1, 400, 600);
    const tiny = syntheticSpectra(0.8, 1, 500, 505).blank;
    assert.throws(() => Liposome.subtractSpectra(s.loaded, tiny), /重疊只有 6 點/);
});

test('[lipo] absorbanceAt 在 1 nm 與 0.5 nm 格點上讀 494/495/496 都對到解析值；超出範圍 throw', () => {
    for (const step of [1, 0.5]) {
        const s = syntheticSpectra(0.8, step);
        const sub = Liposome.subtractSpectra(s.loaded, s.blank);
        const [a494, a495, a496] = Liposome.absorbanceAt(sub, [494, 495, 496]);
        approx(a495, 0.8, 1e-6, `A495 step ${step}`);
        approx(a494, 0.8 * Math.exp(-1 / 1250), 1e-6, `A494 step ${step}`);
        approx(a496, 0.8 * Math.exp(-1 / 1250), 1e-6, `A496 step ${step}`);
    }
    const sub = Liposome.subtractSpectra(syntheticSpectra(0.8).loaded, syntheticSpectra(0.8).blank);
    assert.throws(() => Liposome.absorbanceAt(sub, [494, 495, 650]), /650 nm 超出光譜範圍 400–600 nm/);
});
