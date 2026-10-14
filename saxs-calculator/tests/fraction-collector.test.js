'use strict';
/**
 * Fraction collector 收集時段 vs Excel `Fraction_collector_high_c`（待辦批次 v4.15 規格 §5）。
 *
 * 標準答案 excelChain 是 Excel 公式鏈的逐格轉寫，含 B10 的四路 IF 與 B12 的十路 IF——刻意照抄 Excel
 * 用「數值相等」挑分支的寫法，不重構，才能證明新寫法與 Excel 等價。儲存格對照：
 *   A4:A8 = 工作表1_(2)!M20:M24；B5 = B6 = 目標流速、B7 = (目標+初始)/2、B8 = 初始流速；
 *   D2 = 1050 μL；C22 = 2.8 min；A24 = B10 − C22；A27 = B12 + C22；'HPLC flow down data'!A15 = B22 + 1 + 3。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SAXS } = require('./load.js');

function excelChain({ peakCenter = 10.937, peakFWHM = 1, injectionVolume = 100, targetFlowRate, initialFlowRate }) {
    const inj = injectionVolume;
    const O4 = 1.00959 - 0.00468 * inj + 0.0005034 * inj ** 2 - 0.0000031539 * inj ** 3;
    const P4 = 0.000146507 - 0.000266 * inj + 0.00007393 * inj ** 2 - 0.0000005204 * inj ** 3;
    const M5 = peakFWHM * O4;
    const O6 = 0.7;
    const M7 = peakCenter + P4 - (M5 / 2) * O6;
    const M8 = peakCenter + P4 + (M5 / 2) * O6;
    const M9 = M8 - M7;
    const O11 = targetFlowRate;
    const O12 = initialFlowRate / O11;
    const M21 = M7 - 0.2;
    const M22 = M21 + M9 * O12 + 0.05 / O11 + 2;
    const M23 = M22 + 2;
    const M24 = M23 + 0.5;
    const [A5, A6, A7, A8] = [M21, M22, M23, M24];
    const C14 = (targetFlowRate + initialFlowRate) / 2;
    const [B5, B6, B7, B8] = [targetFlowRate, targetFlowRate, C14, initialFlowRate];
    const D2 = 1050;
    const C22 = 2.8;
    const D4 = (A6 - A5) * B5 * 1000;
    const E4 = (A7 - A6) * ((B6 + B7) / 2) * 1000;
    const F4 = (A8 - A7) * ((B7 + B8) / 2) * 1000;
    const G4 = D4 + E4;
    const H4 = D4 + E4 + F4;
    const E10 = D2 / (B5 * 1000) + A5;
    const E19 = (D2 - D4) / ((B6 + B7) * 500) + A6;
    const E26 = (D2 - G4) / ((B7 + B8) * 500) + A7;
    const E32 = (D2 - H4) / (B8 * 1000) + A8;
    const I4 = A8 - E26;
    const J4 = A7 - E19;
    const K4 = A6 - E10;
    const L4 = I4 * (B7 + B8) * 500;
    const M4 = J4 * (B6 + B7) * 500;
    const N4 = K4 * 1000 * B6;
    const O4x = M4 + F4;
    const P4x = N4 + E4;
    const Q4x = N4 + E4 + F4;

    let B10;
    if (D4 >= D2) B10 = E10;
    else if (D2 > D4 && D2 <= G4) B10 = E19;
    else if (D2 > G4 && D2 <= H4) B10 = E26;
    else B10 = E32;

    const M10 = E10 + D4 / (B5 * 1000);
    const M12 = A6 + (D4 - N4) / ((B6 + B7) * 500);
    const M14 = A7 + (D4 - P4x) / ((B7 + B8) * 500);
    const M16 = A8 + (D4 - Q4x) / (B8 * 1000);
    const M19 = E19 + D4 / ((B6 + B7) * 500);
    const M21x = A7 + (D4 - M4) / ((B7 + B8) * 500);
    const M23x = A8 + (D4 - O4x) / (B8 * 1000);
    const M26 = E26 + D4 / ((B7 + B8) * 500);
    const M28 = A8 + (D4 - L4) / (B8 * 1000);
    const M32 = E32 + D4 / (B8 * 1000);

    let B12 = null;
    if (B10 === E19 && D4 <= M4) B12 = M19;
    else if (B10 === E19 && M4 < D4 && D4 <= O4x) B12 = M21x;
    else if (B10 === E19 && O4x < D4) B12 = M23x;
    else if (B10 === E10 && D4 <= N4) B12 = M10;
    else if (B10 === E10 && N4 < D4 && D4 <= P4x) B12 = M12;
    else if (B10 === E10 && P4x < D4 && D4 <= Q4x) B12 = M14;
    else if (B10 === E10 && Q4x < D4) B12 = M16;
    else if (B10 === E26 && D4 <= L4) B12 = M26;
    else if (B10 === E26 && L4 < D4) B12 = M28;
    else if (B10 === E32) B12 = M32;

    return { times: [A5, A6, A7, A8], start: B10 - C22, stop: B12 === null ? null : B12 + C22 };
}

const TARGETS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.50];
const INITIALS = [0.20, 0.35, 0.50];
const VOLUMES = [10, 50, 100];   // 校正範圍 3–100 μL；超出會 throw（batch1 測試 [47]）

test('[fc] 72 個格點：新寫法與 Excel B10／B12 逐格轉寫差 < 1e-9', () => {
    const mismatches = [];
    for (const targetFlowRate of TARGETS) {
        for (const initialFlowRate of INITIALS) {
            for (const injectionVolume of VOLUMES) {
                const xl = excelChain({ injectionVolume, targetFlowRate, initialFlowRate });
                const tag = `${targetFlowRate}/${initialFlowRate}/${injectionVolume} μL`;
                assert.notEqual(xl.stop, null, `Excel B12 落到 FALSE：${tag}`);
                const w = SAXS.fractionCollectorWindow({ times: xl.times, targetFlowRate, initialFlowRate });
                if (Math.abs(w.startTime - xl.start) > 1e-9 || Math.abs(w.stopTime - xl.stop) > 1e-9) {
                    mismatches.push(`${tag}：start ${w.startTime} vs ${xl.start}，stop ${w.stopTime} vs ${xl.stop}`);
                }
            }
        }
    }
    assert.deepEqual(mismatches, [], '有格點不一致：停下來回報，不要改這個測試');
});

test('[fc] calculateHPLCSAXSSettings：Start／Stop（取兩位）與報告結束時間（四捨五入）與 Excel 一致', () => {
    for (const targetFlowRate of TARGETS) {
        for (const initialFlowRate of INITIALS) {
            const xl = excelChain({ targetFlowRate, initialFlowRate });
            const r = SAXS.calculateHPLCSAXSSettings({
                peakCenter: 10.937, peakFWHM: 1, injectionVolume: 100, targetFlowRate, initialFlowRate,
            });
            const tag = `${targetFlowRate}/${initialFlowRate}`;
            assert.ok(Math.abs(r.fractionCollector.startTime - xl.start) <= 0.005 + 1e-9, `${tag} start`);
            assert.ok(Math.abs(r.fractionCollector.stopTime - xl.stop) <= 0.005 + 1e-9, `${tag} stop`);
            assert.equal(r.reportStoptime, Math.round(xl.stop + 1 + 3), `${tag} report stoptime`);
        }
    }
});

// 規格 §5.1 的回歸值（峰中心 10.937、FWHM 1、注射 100 μL）
const SPEC_TABLE = Object.freeze([
    // [目標, 初始, Start, Stop, 報告結束時間]
    [0.35, 0.35, 10.28, 19.72, 24],
    [0.30, 0.35, 10.78, 20.26, 24],
    [0.20, 0.35, 12.53, 21.79, 26],
    [0.15, 0.35, 14.10, 23.10, 27],
    [0.10, 0.35, 16.99, 25.48, 29],
    [0.05, 0.35, 24.35, 32.14, 36],
    [0.35, 0.50, 10.28, 20.03, 24],
]);

test('[fc] 規格 §5.1 表格各列', () => {
    for (const [targetFlowRate, initialFlowRate, start, stop, report] of SPEC_TABLE) {
        const r = SAXS.calculateHPLCSAXSSettings({
            peakCenter: 10.937, peakFWHM: 1, injectionVolume: 100, targetFlowRate, initialFlowRate,
        });
        const tag = `${targetFlowRate}/${initialFlowRate}`;
        assert.ok(Math.abs(r.fractionCollector.startTime - start) < 0.006, `${tag} start ${r.fractionCollector.startTime} != ${start}`);
        assert.ok(Math.abs(r.fractionCollector.stopTime - stop) < 0.006, `${tag} stop ${r.fractionCollector.stopTime} != ${stop}`);
        assert.equal(r.reportStoptime, report, `${tag} report stoptime`);
    }
});

test('[fc] 常數集中在凍結的 FRACTION_COLLECTOR，既有匯出名稱數值不變', () => {
    const fc = SAXS.FRACTION_COLLECTOR;
    assert.ok(Object.isFrozen(fc));
    assert.equal(fc.deadVolumeUl, 1050);
    assert.equal(fc.safeZoneMin, 2.8);
    assert.equal(fc.rampToMidMin, 2);
    assert.equal(fc.rampToInitialMin, 0.5);
    assert.equal(fc.fractionVolumeMl, 1.2);
    assert.equal(SAXS.DEAD_VOLUME_UL, 1050);
    assert.equal(SAXS.SAFE_ZONE_MIN, 2.8);
});

test('[fc] timeAtCumulativeVolume：剛好落在段尾時算在該段（Excel B10 的 <=），跨段連續；流速非正 → throw', () => {
    const segs = SAXS.fractionCollectorSegments([0, 1, 3, 4], 1, 1);   // 目標＝初始＝1 mL/min：每段 1000 μL/min
    assert.equal(SAXS.timeAtCumulativeVolume(1000, segs), 1);           // 剛好第 1 段段尾
    assert.equal(SAXS.timeAtCumulativeVolume(3000, segs), 3);           // 剛好第 2 段段尾
    assert.equal(SAXS.timeAtCumulativeVolume(0, segs), 0);
    assert.ok(Math.abs(SAXS.timeAtCumulativeVolume(4500, segs) - 4.5) < 1e-12, '第 4 段（無限長）');
    assert.throws(() => SAXS.timeAtCumulativeVolume(10, SAXS.fractionCollectorSegments([0, 1, 3, 4], 0, 1)), /流速/);
});
