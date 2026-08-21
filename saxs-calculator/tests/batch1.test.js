'use strict';
/**
 * Regression tests for the 2026-08-21 batch-1 fixes (silent-failure paths).
 *
 * 原則：算不出來就 throw 含可行動訊息的 Error，不回 0、不回 NaN、不靜默用預設值。
 * HPLC-SAXS 的期望值全部來自 TPS13A Excel 工作簿
 * (TPS13A_protein solution SAXS ID-2024_10_01.xlsm, 工作表1_(2) /
 * HPLC flow down data / Fraction_collector_high_c)，不是從被測程式碼跑出來的。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SAXS, Dndc, FileParser, FormUtils } = require('./load.js');

const approx = (actual, expected, rel, msg) =>
    assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel,
        `${msg}: ${actual} != ${expected} (rel ${rel})`);

// ---------------------------------------------------------------- fixtures
const DT = 0.01;

/** 合成色譜圖：UV 與 RI 皆為同一個高斯峰（batch0 同款）。 */
function chromatogram({ uvHeight = 0.5, riHeight = 1.3875e-4, center = 8, sigma = 0.3 } = {}) {
    const time = [], uv = [], ri = [];
    for (let t = 0; t <= 20 + DT / 2; t += DT) {
        const g = Math.exp(-0.5 * ((t - center) / sigma) ** 2);
        time.push(Number(t.toFixed(4)));
        uv.push(uvHeight * g);
        ri.push(riHeight * g);
    }
    return { time, uv, ri };
}

const PARAMS = {
    peakStart: 7, peakEnd: 9,
    bl1Start: 3, bl1End: 4, bl2Start: 15, bl2End: 16,
    epsilon: 0.667, pathLen: 1, riFactor: 1, riDelay: 0,
    baselineMode: 'const', peakMode: 'height',
    manualC: null, autoAlign: false, decimalPlaces: 6,
};

/** 找出 time 陣列中最接近 target 的索引。 */
const indexNear = (time, target) =>
    time.reduce((best, t, i) => Math.abs(t - target) < Math.abs(time[best] - target) ? i : best, 0);

// ---------------------------------------------------------------- [48] peak / baseline windows
test('[48] measurePeak: 空的 peak 遮罩 throw，不回 0/undefined', () => {
    const signal = [0, 1, 2, 1, 0];
    const time = [0, 1, 2, 3, 4];
    const emptyMask = time.map(() => false);
    assert.throws(() => Dndc.measurePeak(signal, time, emptyMask, 'height'), /峰範圍/);
    assert.throws(() => Dndc.measurePeak(signal, time, emptyMask, 'area'), /沒有任何資料點/);
});

test('[48] computeHplcDndc: peak 範圍落在資料之外 → throw（不再顯示 dn/dc = 0）', () => {
    const { time, uv, ri } = chromatogram();
    assert.throws(
        () => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, peakStart: 30, peakEnd: 32 }),
        /峰範圍/);
});

test('[48] baselineCorrect: BL1 空視窗 throw 且訊息指名 BL1', () => {
    const time = [0, 1, 2, 3];
    const signal = [1, 1, 2, 1];
    const bl1 = [false, false, false, false];
    const bl2 = [false, false, false, true];
    assert.throws(() => Dndc.baselineCorrect(time, signal, 'const', bl1, bl2), /BL1/);
    assert.throws(() => Dndc.baselineCorrect(time, signal, 'linear', bl1, bl2), /BL1/);
});

test('[48] baselineCorrect: BL2 空視窗 throw 且訊息指名 BL2（const 模式也不再靜默用單一視窗）', () => {
    const time = [0, 1, 2, 3];
    const signal = [1, 1, 2, 1];
    const bl1 = [true, false, false, false];
    const bl2 = [false, false, false, false];
    assert.throws(() => Dndc.baselineCorrect(time, signal, 'const', bl1, bl2), /BL2/);
});

test('[48] baselineCorrect: 兩個視窗都有資料時照常運作（const = 減去平均）', () => {
    const time = [0, 1, 2, 3];
    const signal = [1, 5, 5, 3];
    const bl1 = [true, false, false, false];
    const bl2 = [false, false, false, true];
    const corrected = Dndc.baselineCorrect(time, signal, 'const', bl1, bl2);
    assert.deepEqual(corrected, [-1, 3, 3, 1]); // mean of {1, 3} = 2
});

// ---------------------------------------------------------------- [61] slice count
test('[61] computeSliceDndc: 有效切片 < 2 → throw（不再回傳 fitResult=null 讓繪圖丟 TypeError）', () => {
    const time = [0, 1, 2, 3, 4, 5];
    const uv = [0, 0, 0, 1, 0, 0];
    const ri = [0, 0, 0, 1e-4, 0, 0];
    const params = {
        ...PARAMS,
        peakStart: 2.5, peakEnd: 3.5,
        bl1Start: 0, bl1End: 1, bl2Start: 4, bl2End: 5
    };
    assert.throws(() => Dndc.computeSliceDndc(time, uv, ri, params), /有效切片/);
});

test('[61] computeSliceDndc: 正常資料仍回傳 fitResult（守門不影響有效案例）', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeSliceDndc(time, uv, ri, PARAMS);
    assert.ok(r.fitResult && Number.isFinite(r.fitResult.dnDc), 'fitResult present');
    approx(r.dndc, 0.185, 2e-3, 'slice dndc');
});

// ---------------------------------------------------------------- [63] NaN 守門
test('[63] parseCSV: 逐欄統計非數值格數，值仍存成 NaN', () => {
    const text = 'Time,UV,RI\nmin,AU,RIU\n0.1,0.5,1e-4\n0.2,,2e-4\n';
    const parsed = FileParser.parseCSV(text);

    assert.deepEqual(parsed.headers, ['Time', 'UV', 'RI']);
    assert.equal(parsed.stats.rowCount, 3);
    assert.deepEqual(parsed.stats.nonNumeric, [1, 2, 1]); // 單位列 3 格 + 空白格 1 格
    assert.ok(Number.isNaN(parsed.data[0][0]), '單位列存成 NaN');
    assert.ok(Number.isNaN(parsed.data[2][1]), '空白格存成 NaN');
    assert.equal(parsed.data[1][2], 1e-4);
});

test('[63] parseCSV: 全數值檔案的統計為全 0', () => {
    const parsed = FileParser.parseCSV('Time,RI\n0.1,1e-4\n0.2,2e-4\n');
    assert.deepEqual(parsed.stats.nonNumeric, [0, 0]);
    assert.equal(parsed.stats.rowCount, 2);
});

test('[63] computeHplcDndc: 峰範圍內的 NaN → throw 並指出是 RI 欄', () => {
    const { time, uv, ri } = chromatogram();
    const bad = ri.slice();
    bad[indexNear(time, 8)] = NaN;
    assert.throws(() => Dndc.computeHplcDndc(time, uv, bad, PARAMS), /RI/);
});

test('[63] computeHplcDndc: 基線範圍內的 NaN（UV 欄）→ throw 並指出是 UV 欄', () => {
    const { time, uv, ri } = chromatogram();
    const bad = uv.slice();
    bad[indexNear(time, 3.5)] = NaN;
    assert.throws(() => Dndc.computeHplcDndc(time, bad, ri, PARAMS), /UV/);
});

test('[63] computeHplcDndc: 視窗外的 NaN 不影響計算（不過度攔截）', () => {
    const { time, uv, ri } = chromatogram();
    const bad = ri.slice();
    bad[indexNear(time, 19.5)] = NaN;   // 落在 peak 7–9 與 bl 3–4 / 15–16 之外
    const r = Dndc.computeHplcDndc(time, uv, bad, PARAMS);
    approx(r.dndc, 0.185, 1e-3, 'dndc unaffected');
});

test('[63] computeSliceDndc: 視窗內 NaN → throw', () => {
    const { time, uv, ri } = chromatogram();
    const bad = ri.slice();
    bad[indexNear(time, 8.1)] = NaN;
    assert.throws(() => Dndc.computeSliceDndc(time, uv, bad, PARAMS), /RI/);
});

// ---------------------------------------------------------------- [25] 計算層參數守門
test('[25] computeHplcDndc: epsilon / pathLen / riFactor 為 NaN 或 ≤ 0 → throw（不再輸出 "NaN"）', () => {
    const { time, uv, ri } = chromatogram();
    assert.throws(() => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, epsilon: NaN }), /消光係數/);
    assert.throws(() => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, pathLen: NaN }), /光徑/);
    assert.throws(() => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, riFactor: NaN }), /RI 校正因子/);
    assert.throws(() => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, pathLen: 0 }), /光徑/);
});

test('[25] computeSliceDndc: 同樣攔下 NaN 參數', () => {
    const { time, uv, ri } = chromatogram();
    assert.throws(() => Dndc.computeSliceDndc(time, uv, ri, { ...PARAMS, epsilon: NaN }), /消光係數/);
    assert.throws(() => Dndc.computeSliceDndc(time, uv, ri, { ...PARAMS, riFactor: 0 }), /RI 校正因子/);
});

test('[25] FormUtils.parsePositiveNumber / parseFiniteNumber 的邊界行為', () => {
    assert.equal(FormUtils.parsePositiveNumber('0.667', 'ε'), 0.667);
    assert.throws(() => FormUtils.parsePositiveNumber('', 'ε'), /ε/);
    assert.throws(() => FormUtils.parsePositiveNumber('abc', 'ε'), /ε/);
    assert.throws(() => FormUtils.parsePositiveNumber('0', 'ε'), /大於 0/);
    assert.throws(() => FormUtils.parsePositiveNumber('-1', 'ε'), /大於 0/);
    assert.throws(() => FormUtils.parsePositiveNumber(NaN, 'ε'), /ε/);

    assert.equal(FormUtils.parseFiniteNumber('0', 'Peak start'), 0);
    assert.equal(FormUtils.parseFiniteNumber('-2.5', 'RI 延遲'), -2.5);
    assert.throws(() => FormUtils.parseFiniteNumber('', 'Peak start'), /Peak start/);
});

// ---------------------------------------------------------------- [62] safe storage
test('[62] createSafeStorage: 儲存被封鎖時 get 回 null、set/remove 回 false，不 throw', () => {
    const blocked = () => { throw new Error('SecurityError'); };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        const store = FormUtils.createSafeStorage(blocked, 'blocked');
        assert.equal(store.get('k'), null);
        assert.equal(store.set('k', 'v'), false);
        assert.equal(store.remove('k'), false);
    } finally {
        console.warn = originalWarn;
    }
});

test('[62] createSafeStorage: 正常 Storage 照常運作', () => {
    const data = new Map();
    const fake = {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k)
    };
    const store = FormUtils.createSafeStorage(() => fake, 'fake');
    assert.equal(store.set('a', '1'), true);
    assert.equal(store.get('a'), '1');
    assert.equal(store.remove('a'), true);
    assert.equal(store.get('a'), null);
});

// ---------------------------------------------------------------- [46] Excel flow rate table
// Excel 範例（工作表1_(2)）：peak center 10.937 min、FWHM 1 min、100 μL、0.35/0.35
const EXCEL_CASE = {
    peakCenter: 10.937, peakFWHM: 1, injectionVolume: 100,
    targetFlowRate: 0.35, initialFlowRate: 0.35
};

test('[46] Excel 範例：flow rate table 六列時間 = 0 / 9.98 / 10.08 / 13.92 / 15.92 / 16.42', () => {
    const r = SAXS.calculateHPLCSAXSSettings(EXCEL_CASE);
    const times = r.flowRateTable.map(row => row.time);
    const expected = [0, 9.98, 10.08, 13.92, 15.92, 16.42];
    expected.forEach((t, i) => {
        assert.ok(Math.abs(times[i] - t) <= 0.011, `M${19 + i} 時間 ${times[i]} != ${t}`);
    });
});

test('[46] Excel HPLC flow down data：六列流速 = [initial, initial, target, target, (target+initial)/2, initial]', () => {
    const r = SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, targetFlowRate: 0.1, initialFlowRate: 0.5 });
    const rates = r.flowRateTable.map(row => row.flowRate);
    assert.deepEqual(rates, [0.5, 0.5, 0.1, 0.1, 0.3, 0.5]);   // C14 = (C13 + C15)/2
});

test('[46] O12 = initial/target：減速時 X 光收集時間 (M22−M21) 變長', () => {
    const equal = SAXS.calculateHPLCSAXSSettings(EXCEL_CASE);
    const slowed = SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, targetFlowRate: 0.2 });

    const span = (r) => r.flowRateTable[3].time - r.flowRateTable[2].time;
    assert.ok(span(slowed) > span(equal) + 0.5,
        `slow-down 應拉長收集時間: ${span(slowed)} vs ${span(equal)}`);

    // initial = target 時 O12 = 1，維持 Excel 範例的 3.84 min
    approx(span(equal), 3.84, 5e-3, 'M22 − M21 (equal flow)');
});

test('[46] Fraction collector：Excel 範例 start 10.28 / stop 19.72（死體積 1050 μL、安全區 2.8 min）', () => {
    const r = SAXS.calculateHPLCSAXSSettings(EXCEL_CASE);
    approx(r.fractionCollector.startTime, 10.28, 1e-3, 'fraction start');
    approx(r.fractionCollector.stopTime, 19.72, 1e-3, 'fraction stop');
    assert.equal(SAXS.DEAD_VOLUME_UL, 1050);
    assert.equal(SAXS.SAFE_ZONE_MIN, 2.8);
});

test('[46] Fraction collector 隨流速改變（不再是寫死的 ×2.45）', () => {
    const slow = SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, targetFlowRate: 0.2 });
    // start = M21 + 1050/(0.2×1000) − 2.8 = 10.08 + 5.25 − 2.8
    approx(slow.fractionCollector.startTime, 12.53, 2e-3, 'fraction start @0.2 mL/min');
    const span = slow.fractionCollector.stopTime - slow.fractionCollector.startTime;
    approx(span, 2.8 + (slow.flowRateTable[3].time - slow.flowRateTable[2].time) + 2.8, 2e-3, 'collection span');
});

// ---------------------------------------------------------------- [47] injection volume range
test('[47] 注射體積 150 μL → throw（三次式外插會產生負峰寬）', () => {
    assert.throws(() => SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, injectionVolume: 150 }), /3–100/);
    assert.throws(() => SAXS.calculatePeakWidthScaling(200), /3–100/);
    assert.throws(() => SAXS.calculateTimeOffset(0), /3–100/);
    assert.throws(() => SAXS.calculatePeakWidthScaling(NaN), /3–100/);
});

test('[47] 校正範圍端點 3 與 100 μL 仍可計算，且縮放因子為正', () => {
    assert.ok(SAXS.calculatePeakWidthScaling(3) > 0, 'V=3');
    assert.ok(SAXS.calculatePeakWidthScaling(100) > 0, 'V=100');
    assert.equal(SAXS.INJECTION_VOLUME_MIN_UL, 3);
    assert.equal(SAXS.INJECTION_VOLUME_MAX_UL, 100);
});

test('[47] 流速 / 峰參數為 0 或 NaN → throw 而非產出負時間', () => {
    assert.throws(() => SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, targetFlowRate: 0 }), /Target flow rate/);
    assert.throws(() => SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, initialFlowRate: NaN }), /Initial flow rate/);
    assert.throws(() => SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, peakFWHM: 0 }), /FWHM/);
    assert.throws(() => SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, peakCenter: NaN }), /Peak center/);
});
