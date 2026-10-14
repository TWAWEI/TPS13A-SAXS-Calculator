'use strict';
/**
 * 負峰保留正負號、負 dn/dc 警告、負 UV 峰拒絕（待辦批次 v4.15 規格 §6，與 Python 版一致）。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Dndc } = require('./load.js');

const DT = 0.01;

/** 合成色譜圖：UV 與 RI 為同一個高斯峰（與 batch0／batch1 同款）。 */
function chromatogram({ uvHeight = 0.5, riHeight = 1.3875e-4, center = 8, sigma = 0.3 } = {}) {
    const time = [];
    const uv = [];
    const ri = [];
    for (let t = 0; t <= 20 + DT / 2; t += DT) {
        const g = Math.exp(-0.5 * ((t - center) / sigma) ** 2);
        time.push(Number(t.toFixed(4)));
        uv.push(uvHeight * g);
        ri.push(riHeight * g);
    }
    return { time, uv, ri };
}

const PARAMS = Object.freeze({
    peakStart: 7, peakEnd: 9,
    bl1Start: 3, bl1End: 4, bl2Start: 15, bl2End: 16,
    epsilon: 0.667, pathLen: 1, riFactor: 1, riDelay: 0,
    baselineMode: 'const', peakMode: 'height',
    manualC: null, autoAlign: false, decimalPlaces: 6,
});

// dn/dc = riHeight / (uvHeight / (ε·l) / 1000) = 1.3875e-4 / 7.4963e-4 ≈ 0.18509 mL/g
const DNDC = 1.3875e-4 / (0.5 / 0.667 / 1000);
const negate = arr => arr.map(v => -v);
const near = (actual, expected, rel, msg) =>
    assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${msg}: ${actual} != ${expected}`);

test('[sign] measurePeak：負峰的峰高與面積保留負號，正峰不變', () => {
    const { time, uv } = chromatogram();
    const mask = time.map(t => t >= 6 && t <= 10);
    const pos = Dndc.measurePeak(uv, time, mask, 'height');
    const negHeight = Dndc.measurePeak(negate(uv), time, mask, 'height');
    const negArea = Dndc.measurePeak(negate(uv), time, mask, 'area');
    near(negHeight.peakHeight, -0.5, 1e-9, '負峰峰高');
    assert.ok(negArea.peakArea < 0, `負峰面積應為負：${negArea.peakArea}`);
    near(negArea.peakArea, -pos.peakArea, 1e-12, '負峰面積 = −正峰面積');
    assert.ok(pos.peakHeight > 0 && pos.peakArea > 0, '正峰不變');
});

test('[sign] computeHplcDndc：負 RI 峰 → 負 dn/dc＋警告；正峰沒有警告', () => {
    const { time, uv, ri } = chromatogram();
    for (const peakMode of ['height', 'area']) {
        const neg = Dndc.computeHplcDndc(time, uv, negate(ri), { ...PARAMS, peakMode });
        near(neg.dndc, -DNDC, 1e-6, `${peakMode} 負 dn/dc`);
        assert.deepEqual(neg.warnings, [Dndc.NEGATIVE_DNDC_WARNING], `${peakMode} 警告`);
        const pos = Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, peakMode });
        near(pos.dndc, DNDC, 1e-6, `${peakMode} 正 dn/dc`);
        assert.deepEqual(pos.warnings, [], `${peakMode} 正峰無警告`);
    }
});

test('[sign] computeHplcDndc：UV 峰為負 → 明確錯誤（不再說成「無法求得有效濃度」）', () => {
    const { time, uv, ri } = chromatogram();
    assert.throws(() => Dndc.computeHplcDndc(time, negate(uv), ri, PARAMS), /UV 峰為負/);
    assert.throws(
        () => Dndc.computeHplcDndc(time, negate(uv), negate(ri), { ...PARAMS, peakMode: 'area' }),
        /UV 峰為負/);
});

test('[sign] computeHplcDndc：手動濃度時不檢查 UV 的符號', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeHplcDndc(time, negate(uv), ri, { ...PARAMS, manualC: 0.75 });
    assert.ok(r.dndc > 0);
    assert.deepEqual(r.warnings, []);
});

test('[sign] computeSliceDndc：負 RI 峰 → 負斜率＋警告', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeSliceDndc(time, uv, negate(ri), PARAMS);
    near(r.dndc, -DNDC, 1e-6, 'slice 負斜率');
    assert.deepEqual(r.warnings, [Dndc.NEGATIVE_DNDC_WARNING]);
    assert.deepEqual(Dndc.computeSliceDndc(time, uv, ri, PARAMS).warnings, []);
});

test('[sign] negativeDndcWarnings：只有負值才警告；訊息與 Python 相同', () => {
    assert.equal(Dndc.NEGATIVE_DNDC_WARNING, 'dn/dc 為負：請檢查 RI 極性或峰／基線區間');
    assert.equal(Dndc.NEGATIVE_UV_PEAK_MESSAGE, 'UV 峰為負：峰範圍內沒有 UV 峰、基線區間落在峰上，或極性反轉，請檢查 UV 峰範圍與基線範圍');
    assert.deepEqual(Dndc.negativeDndcWarnings(-0.01), [Dndc.NEGATIVE_DNDC_WARNING]);
    assert.deepEqual(Dndc.negativeDndcWarnings(0.185), []);
    assert.deepEqual(Dndc.negativeDndcWarnings(0), []);
});

test('[sign] measurePeak：峰區正負都有時，峰高取 |v| 最大點的原值、面積取淨積分', () => {
    const time = [0, 1, 2, 3, 4];
    const signal = [0, -1, 0, 3, 0];
    const mask = time.map(() => true);
    const r = Dndc.measurePeak(signal, time, mask, 'height');
    assert.equal(r.peakHeight, 3);
    assert.equal(r.peakArea, 2);   // 梯形：四段 −0.5、−0.5、+1.5、+1.5 → 淨面積 2（≠ 峰高 3，也 ≠ 絕對值面積 4）
});

test('[sign] computeSliceDndc：峰邊緣 UV 因雜訊略低於 0 不會被拒絕（使用者定案，規格 §6.3）', () => {
    const { time, uv, ri } = chromatogram();
    const dipped = uv.map((v, i) => (time[i] >= 7 && time[i] <= 7.05 ? -0.03 : v));   // 峰區左緣塞入負值（> 5% 門檻才會被算進切片）
    const r = Dndc.computeSliceDndc(time, dipped, ri, PARAMS);
    assert.ok(Number.isFinite(r.dndc));
    assert.ok(r.sliceCount >= 2);
});
