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
const { Liposome, LiposomeParsers, LiposomeTable } = require('./load.js');

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
    approx(Liposome.sampleStd([0.90287, 0.91973, 0.94266]), 0.019972016256085294, 1e-12, 'DOX-18 F 欄');
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

// ---------------------------------------------------------------- 純 DOX 縮放擬合
test('[lipo] fitPureDoxScale 在合成資料上回復 k = 0.8、殘差 0；model 覆蓋整段重疊', () => {
    const s = syntheticSpectra(0.8);
    const r = Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure, { fitMin: 450, fitMax: 550 });
    approx(r.k, 0.8, 1e-9, 'k');
    assert.ok(r.rms < 1e-9, `rms ${r.rms}`);
    assert.equal(r.n, 101, '450…550 步進 1');
    assert.equal(r.model.wavelength.length, 201, 'model 涵蓋 400…600 整段');
    r.model.absorbance.forEach((m, j) => approx(m, s.loaded.absorbance[j], 1e-9, `model λ=${r.model.wavelength[j]}`));
    r.residual.absorbance.forEach((d) => assert.ok(Math.abs(d) < 1e-9));
    assert.ok(Object.isFrozen(r));
});

test('[lipo] fitPureDoxScale 預設擬合範圍 450–550；範圍點數不足或純 DOX 全零 throw', () => {
    const s = syntheticSpectra(0.8);
    approx(Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure).k, 0.8, 1e-9, '預設範圍');
    assert.throws(() => Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure, { fitMin: 500, fitMax: 505 }),
        /只有 6 點/);
    const zero = { wavelength: s.pure.wavelength, absorbance: s.pure.absorbance.map(() => 0) };
    assert.throws(() => Liposome.fitPureDoxScale(s.loaded, s.blank, zero), /全為 0/);
    assert.throws(() => Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure, { fitMin: 550, fitMax: 450 }),
        /上限必須大於下限/);
});

// ---------------------------------------------------------------- D/L（Excel DL 工作表）
// 欄位：A494, A495, A496, M（脂質原始濃度 M）, N（稀釋因子）, Q（D/L）, R（Excel 誤差，僅 UV）
// Q、R 是 openpyxl data_only 讀出的完整快取值（2026-09-05），ε = 9250、l = 0.2。
const EXCEL_DL_ROWS = [
    ['DOX-18',      0.90287, 0.91973, 0.94266, 0.0117, 0.454, 0.09359376319728743,  0.002032396638192102],
    ['DOX-20',      0.74644, 1.05761, 0.89623, 0.0108, 0.526, 0.10063390386584302,  0.01480767552474392],
    ['DOX-22',      0.07752, 0.0764,  0.08737, 0.011,  0.556, 0.006752337687589486, 0.0005334920222687899],
    ['Chol-DOX-18', 0.69825, 0.8085,  0.69407, 0.01,   0.54,  0.08093093093093093,  0.006495815219697592],
    ['Chol-DOX-20', 0.86094, 0.74027, 0.96326, 0.0105, 0.556, 0.06854161458478004,  0.01033496895850612],
    ['Chol-DOX-22', 0.80352, 0.75896, 0.79255, 0.01,   0.417, 0.0983809708989565,   0.0030095498767000206],
];

test('[lipo] computeDrugToLipid 重現 Excel DL 頁六列的 Q 與 R（factorSd = 0 時 dlSd = dlSdExcel）', () => {
    for (const [name, a494, a495, a496, lipidM, factor, Q, R] of EXCEL_DL_ROWS) {
        const r = Liposome.computeDrugToLipid({
            absorbances: [a494, a495, a496],
            primaryIndex: 1,
            primaryWavelengthNm: 495,
            epsilon: 9250,
            pathCm: 0.2,
            lipidMolar: lipidM,
            factor,
            factorSd: 0,
        });
        relApprox(r.dl, Q, 1e-9, `${name} Q`);
        relApprox(r.dlSdExcel, R, 1e-9, `${name} R`);
        relApprox(r.dlSd, R, 1e-9, `${name} dlSd（factorSd=0 時等於 Excel）`);
        assert.equal(r.aPrimary, a495);
        relApprox(r.doxConc, a495 / (9250 * 0.2), 1e-12, `${name} J`);
        relApprox(r.lipidActual, lipidM * factor, 1e-12, `${name} O`);
        assert.equal(r.relF, 0);
        assert.ok(Object.isFrozen(r));
    }
});

test('[lipo] computeDrugToLipid 納入稀釋因子離散：dlSd = dl·√(relA² + relF²)', () => {
    const base = { absorbances: [0.90287, 0.91973, 0.94266], epsilon: 9250, pathCm: 0.2, lipidMolar: 0.0117, factor: 0.454 };
    const r = Liposome.computeDrugToLipid({ ...base, factorSd: 0.0129 });
    const relA = 0.019972016256085294 / 0.91973;
    const relF = 0.0129 / 0.454;
    relApprox(r.relA, relA, 1e-12, 'relA');
    relApprox(r.relF, relF, 1e-12, 'relF');
    relApprox(r.dlSd, r.dl * Math.sqrt(relA * relA + relF * relF), 1e-12, 'dlSd');
    assert.ok(r.dlSd > r.dlSdExcel, '加了因子離散後誤差只會變大');
});

test('[lipo] computeDrugToLipid 預設 primaryIndex 1 / 495 nm；主波長吸光度非正、參數非正、吸光度數量錯 throw', () => {
    const ok = { absorbances: [0.1, 0.2, 0.3], epsilon: 9250, pathCm: 0.2, lipidMolar: 0.01, factor: 0.5 };
    assert.equal(Liposome.computeDrugToLipid(ok).aPrimary, 0.2);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, 0, 0.3] }), /主波長 495 nm 的吸光度非正/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, -0.2, 0.3], primaryWavelengthNm: 500 }), /主波長 500 nm/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, 0.2] }), /三個吸光度/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, NaN, 0.3] }), /吸光度 #2/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, lipidMolar: 0 }), /脂質原始濃度 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, factor: -1 }), /稀釋因子 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, epsilon: 0 }), /ε 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, pathCm: 0 }), /光徑 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, factorSd: -0.1 }), /離散度不可為負/);
});

// ---------------------------------------------------------------- 邊界防呆（code review 追加）
test('[lipo] 曲線內含 NaN y 值一律 throw（computeDilutionFactor / subtractSpectra / absorbanceAt / fitPureDoxScale）', () => {
    const solution = guinierCurve(1, 0);
    const bypassNaN = { q: solution.q, i: solution.i.map((v, k) => (k === 120 ? NaN : v * 0.45)) };
    assert.throws(() => Liposome.computeDilutionFactor(solution, bypassNaN), /不是有限數值/);

    const s = syntheticSpectra(0.8);
    const loadedNaN = { wavelength: s.loaded.wavelength, absorbance: s.loaded.absorbance.map((v, k) => (k === 50 ? NaN : v)) };
    assert.throws(() => Liposome.subtractSpectra(loadedNaN, s.blank), /不是有限數值/);
    assert.throws(() => Liposome.absorbanceAt(loadedNaN, [495]), /不是有限數值/);
    assert.throws(() => Liposome.fitPureDoxScale(loadedNaN, s.blank, s.pure), /不是有限數值/);
});

test('[lipo] 五個公開函式接受深度凍結的曲線／參數（唯讀陣列）不會 throw，且結果不變', () => {
    const freezeCurve = (curve, xKey, yKey) => Object.freeze({
        [xKey]: Object.freeze(curve[xKey].slice()),
        [yKey]: Object.freeze(curve[yKey].slice()),
    });

    const solution = freezeCurve(guinierCurve(1, 0), 'q', 'i');
    const bypass = freezeCurve(guinierCurve(0.45, 0), 'q', 'i');
    const dil = Liposome.computeDilutionFactor(solution, bypass, Object.freeze({ qMin: 0.1, qMax: 0.15 }));
    approx(dil.factor, 0.45, 1e-9, 'frozen computeDilutionFactor');

    const s = syntheticSpectra(0.8);
    const loaded = freezeCurve(s.loaded, 'wavelength', 'absorbance');
    const blank = freezeCurve(s.blank, 'wavelength', 'absorbance');
    const pure = freezeCurve(s.pure, 'wavelength', 'absorbance');

    const sub = Liposome.subtractSpectra(loaded, blank);
    approx(sub.absorbance[0], 0.8 * s.pure.absorbance[0], 1e-9, 'frozen subtractSpectra');

    const [a495] = Liposome.absorbanceAt(sub, Object.freeze([495]));
    approx(a495, 0.8, 1e-6, 'frozen absorbanceAt');

    const fit = Liposome.fitPureDoxScale(loaded, blank, pure, Object.freeze({ fitMin: 450, fitMax: 550 }));
    approx(fit.k, 0.8, 1e-9, 'frozen fitPureDoxScale');

    const dl = Liposome.computeDrugToLipid(Object.freeze({
        absorbances: Object.freeze([0.90287, 0.91973, 0.94266]),
        epsilon: 9250, pathCm: 0.2, lipidMolar: 0.0117, factor: 0.454, factorSd: 0,
    }));
    relApprox(dl.dl, 0.09359376319728743, 1e-9, 'frozen computeDrugToLipid');
});

test('[lipo] 稀釋因子：solution 側非正值也會被排除並計數（不只 bypass 側）', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0);
    const dented = { q: solution.q, i: solution.i.map((v, k) => (solution.q[k] > 0.1199 && solution.q[k] < 0.1211 ? -1 : v)) };
    const r = Liposome.computeDilutionFactor(dented, bypass);
    assert.equal(r.excluded.nonPositive, 2);
    assert.equal(r.n, 49);
    approx(r.factor, 0.45, 1e-9, 'factor after solution-side exclusion');
});

// ---------------------------------------------------------------- 檔案解析
const PRIMUS_DAT = [
    'Sample description: BSA merged',
    'Sample:   c= 1.000 mg/ml  Code: ',
    ' q(A-1)  I(q)  error',
    '',
    '# comment line',
    ' 1.0000E-02  1.5659E+00  3.7940E-02',
    ' 1.1000E-02  1.6071E+00  8.5800E-03',
    ' 1.2000E-02  1.5007E+00  5.7700E-03',
    '',
].join('\n');

test('[lipo-parse] parseSaxsDat 跳過文字標頭／空行／# 註解，保留 err 欄，計數 skipped', () => {
    const r = LiposomeParsers.parseSaxsDat(PRIMUS_DAT);
    assert.deepEqual(r.q, [0.01, 0.011, 0.012]);
    assert.deepEqual(r.i, [1.5659, 1.6071, 1.5007]);
    assert.deepEqual(r.err, [0.03794, 0.00858, 0.00577]);
    assert.equal(r.skipped, 3, '三行文字標頭；空行與 # 行不算 skipped');
    assert.equal(r.sorted, false);
    assert.ok(Object.isFrozen(r));
});

test('[lipo-parse] parseSaxsDat 接受逗號／tab／分號分隔；兩欄檔 err 為 null；缺第三欄的列讓 err 為 null', () => {
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1,2,0.5\n0.2,1,0.4').err, [0.5, 0.4]);
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1\t2\t0.5\r\n0.2\t1\t0.4').q, [0.1, 0.2]);
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1;2\n0.2;1').i, [2, 1]);
    assert.equal(LiposomeParsers.parseSaxsDat('0.1 2\n0.2 1').err, null);
    assert.equal(LiposomeParsers.parseSaxsDat('0.1 2 0.5\n0.2 1').err, null, '有一列缺 err 就整個 null');
});

test('[lipo-parse] parseSaxsDat 亂序 q 穩定排序並設 sorted=true；重複 q throw；無數值列 throw', () => {
    const r = LiposomeParsers.parseSaxsDat('0.00045597 -0.00377 0\n0 0 0\n0.0057 1.5659 0.03794');
    assert.deepEqual(r.q, [0, 0.00045597, 0.0057]);
    assert.deepEqual(r.i, [0, -0.00377, 1.5659]);
    assert.equal(r.sorted, true);
    assert.throws(() => LiposomeParsers.parseSaxsDat('0.1 1\n0.1 2'), /q 有重複值 0.1/);
    assert.throws(() => LiposomeParsers.parseSaxsDat('q I err\nhello world'), /找不到數值列/);
    assert.throws(() => LiposomeParsers.parseSaxsDat(''), /找不到數值列/);
    assert.throws(() => LiposomeParsers.parseSaxsDat(null), /不是文字/);
});

test('[lipo-parse] parseUvSpectrum 兩欄、標頭列跳過、遞減匯出被排序、重複波長 throw', () => {
    const r = LiposomeParsers.parseUvSpectrum('wavelength [nm],abs.\n190,-3.635\n190.5,-4.531\n191,-5.041');
    assert.deepEqual(r.wavelength, [190, 190.5, 191]);
    assert.deepEqual(r.absorbance, [-3.635, -4.531, -5.041]);
    assert.equal(r.skipped, 1);
    assert.equal(r.sorted, false);

    const desc = LiposomeParsers.parseUvSpectrum('850 0.02\n849.5 0.028\n849 0.03');
    assert.deepEqual(desc.wavelength, [849, 849.5, 850]);
    assert.deepEqual(desc.absorbance, [0.03, 0.028, 0.02]);
    assert.equal(desc.sorted, true);

    assert.throws(() => LiposomeParsers.parseUvSpectrum('500 1\n500 2'), /波長 有重複值 500/);
});

test('[lipo-parse] LIMITS：點數超過 MAX_POINTS throw；MAX_BYTES 為 5 MB', () => {
    assert.equal(LiposomeParsers.LIMITS.MAX_BYTES, 5 * 1024 * 1024);
    assert.equal(LiposomeParsers.LIMITS.MAX_POINTS, 100000);
    const big = Array.from({ length: 100001 }, (_, k) => `${k} 1`).join('\n');
    assert.throws(() => LiposomeParsers.parseSaxsDat(big), /超過上限 100000/);
});

test('[lipo-parse] 行首／行尾多餘分隔符不產生空欄', () => {
    assert.equal(LiposomeParsers.parseSaxsDat('0.1,1,\n0.2,2,').err, null);
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1,1,0.5,\n0.2,2,0.4,').err, [0.5, 0.4]);
    assert.deepEqual(LiposomeParsers.parseSaxsDat(',0.1,1\n,0.2,2').q, [0.1, 0.2]);
    assert.deepEqual(LiposomeParsers.parseUvSpectrum('190;0.1;\n191;0.2;').absorbance, [0.1, 0.2]);
});

test('[lipo-parse] BOM、CRLF 尾端空白、Infinity／1e400 都在邊界處理', () => {
    assert.deepEqual(LiposomeParsers.parseSaxsDat('﻿0.1 1 0.5\r\n0.2 2 0.4  \r\n').err, [0.5, 0.4]);
    const r = LiposomeParsers.parseSaxsDat('Infinity 1\n0.1 1e400\n0.2 2\n0.3 3');
    assert.deepEqual(r.q, [0.2, 0.3]);
    assert.equal(r.skipped, 2);
    assert.equal(LiposomeParsers.parseSaxsDat('0.1 1 Infinity\n0.2 2 0.4').err, null);
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1 1\r0.2 2\r0.3 3').q, [0.1, 0.2, 0.3]);
});

// ---------------------------------------------------------------- 結果表 CSV
test('[lipo-table] csvCell：數字原樣、字串含逗號／引號／換行時 RFC 4180 引號', () => {
    assert.equal(LiposomeTable.csvCell(0.09359376319728743), '0.09359376319728743');
    assert.equal(LiposomeTable.csvCell(NaN), '');
    assert.equal(LiposomeTable.csvCell(null), '');
    assert.equal(LiposomeTable.csvCell('DOX-18'), 'DOX-18');
    assert.equal(LiposomeTable.csvCell('a,b'), '"a,b"');
    assert.equal(LiposomeTable.csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(LiposomeTable.csvCell('two\nlines'), '"two\nlines"');
});

test('[lipo-table] rowsToCsv：標頭 + 每列 + 中繼欄位，不四捨五入', () => {
    const row = {
        id: 'x1', sampleName: 'DOX-18, batch "A"', factor: 0.454, factorSource: 'manual',
        aPrimary: 0.91973, primaryWavelengthNm: 495,
        doxConcMM: 0.4971513513513514, lipidActualMM: 5.3118,
        dl: 0.09359376319728743, dlSd: 0.002032396638192102, addedAt: '2026-09-05T08:00:00.000Z',
        meta: { epsilon: 9250, pathCm: 0.2, qMin: 0.1, qMax: 0.15, wavelengths: [494, 495, 496], absorbances: [0.90287, 0.91973, 0.94266], factorSd: 0, absSource: 'manual' },
    };
    const csv = LiposomeTable.rowsToCsv([row]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0],
        'Sample,Dilution factor,Factor source,Factor SD,A(primary),Primary wavelength (nm),DOX conc (mM),Lipid actual (mM),D/L,D/L error,Added at,Epsilon (L/mol/cm),Path (cm),q min,q max,Wavelengths (nm),Absorbances,Absorbance source');
    assert.equal(lines[1],
        '"DOX-18, batch ""A""",0.454,manual,0,0.91973,495,0.4971513513513514,5.3118,0.09359376319728743,0.002032396638192102,2026-09-05T08:00:00.000Z,9250,0.2,0.1,0.15,494|495|496,0.90287|0.91973|0.94266,manual');
});

test('[lipo-table] rowsToCsv 空表只回標頭；缺 meta 的列與 Infinity 都變空欄', () => {
    const header = LiposomeTable.rowsToCsv([]);
    assert.equal(header.split('\n').length, 1);
    const line = LiposomeTable.rowsToCsv([{ id: 'x', sampleName: 'S', factor: Infinity, dl: 0.1, dlSd: 0.01 }]).split('\n')[1];
    assert.equal(line, 'S,,,,,,,,0.1,0.01,,,,,,,,');
});

test('[lipo-table] isRow 只接受 id 字串、有限 dl、有限主波長、字串樣品名', () => {
    const good = { id: 'a', dl: 0.1, primaryWavelengthNm: 495, sampleName: 'S' };
    assert.equal(LiposomeTable.isRow(good), true);
    assert.equal(LiposomeTable.isRow({ ...good, primaryWavelengthNm: '495' }), false);
    assert.equal(LiposomeTable.isRow({ ...good, sampleName: 5 }), false);
    assert.equal(LiposomeTable.isRow({ ...good, dl: NaN }), false);
    assert.equal(LiposomeTable.isRow(null), false);
});

// ---------------------------------------------------------------- 資料品質旗標（Task 11b）
test('[lipo-flags] DEFAULTS 多了四個品質門檻常數', () => {
    const d = Liposome.DEFAULTS;
    assert.deepEqual([d.EPSILON_REF_NM, d.A_MAX_LINEAR, d.WAVELENGTH_SPREAD_WARN_REL, d.WINDOW_COVERAGE_WARN],
        [495, 1.5, 0.05, 0.5]);
});

test('[lipo-flags] computeDilutionFactor 回傳 qCovered 與 flags（因子 > 1、涵蓋不足）', () => {
    const solution = guinierCurve(1, 0);
    const ok = Liposome.computeDilutionFactor(solution, guinierCurve(0.45, 0));
    assert.deepEqual([...ok.qCovered], [0.1, 0.15]);
    assert.deepEqual(ok.flags, { factorAboveOne: false, lowCoverage: false });

    const swapped = Liposome.computeDilutionFactor(guinierCurve(0.45, 0), solution);
    approx(swapped.factor, 1 / 0.45, 1e-9, '選反時因子 > 1');
    assert.equal(swapped.flags.factorAboveOne, true);

    const short = { q: solution.q.filter(q => q <= 0.11), i: solution.i.filter((_, k) => solution.q[k] <= 0.11) };
    const low = Liposome.computeDilutionFactor(solution, { q: short.q, i: short.i.map(v => 0.45 * v) });
    assert.deepEqual([...low.qCovered], [0.1, 0.11]);
    assert.equal(low.flags.lowCoverage, true, '只涵蓋 0.01 / 0.05 = 20% 的視窗');
    assert.ok(Object.isFrozen(ok.flags) && Object.isFrozen(ok.qCovered));
});

test('[lipo-flags] computeDrugToLipid 回傳 flags（ε 波長不符、吸光度超線性、三波長離散）', () => {
    const base = { absorbances: [0.90287, 0.91973, 0.94266], epsilon: 9250, pathCm: 0.2, lipidMolar: 0.0117, factor: 0.454 };
    assert.deepEqual(Liposome.computeDrugToLipid(base).flags,
        { epsilonWavelengthMismatch: false, absorbanceAboveLinear: false, wavelengthSpreadHigh: false });
    assert.equal(Liposome.computeDrugToLipid({ ...base, primaryWavelengthNm: 480 }).flags.epsilonWavelengthMismatch, true);
    assert.equal(Liposome.computeDrugToLipid({ ...base, primaryWavelengthNm: 495.5 }).flags.epsilonWavelengthMismatch, false, '±1 nm 內不算');
    assert.equal(Liposome.computeDrugToLipid({ ...base, absorbances: [1.6, 1.7, 1.8] }).flags.absorbanceAboveLinear, true);
    // Excel DOX-20：0.74644 / 1.05761 / 0.89623 → |A1−A3|/A2 = 14% > 5%
    assert.equal(Liposome.computeDrugToLipid({ ...base, absorbances: [0.74644, 1.05761, 0.89623] }).flags.wavelengthSpreadHigh, true);
});

test('[lipo-flags] fitPureDoxScale 回傳 flags.negativeScale', () => {
    const s = syntheticSpectra(0.8);
    assert.equal(Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure).flags.negativeScale, false);
    // 含藥／空白互換 → k 為負
    assert.equal(Liposome.fitPureDoxScale(s.blank, s.loaded, s.pure).flags.negativeScale, true);
});
