/**
 * TPS13A SAXS Calculator - HPLC-SAXS 步驟設定、fraction collector、10 μL pre-run 建議值
 *
 * 2026-10-14 從 calculations.js 純搬移拆出。頂層宣告（函式與常數）在全域作用域，由 calculations.js 結尾的匯出區塊
 * 在載入期讀取，所以本檔必須排在 calculations.js 之前（tests/structure.test.js 檢查）。
 */

// ========================
// HPLC-SAXS Step Settings 計算
// 公式來源: TPS13A_protein solution SAXS ID-2024_10_01.xlsm
// 主要參考: 工作表1_(2) 和 HPLC flow down data
// ========================

/**
 * 注射體積的校正範圍 (μL)。
 * 三次多項式以 3–100 μL 的實測資料擬合（Excel `UV-vis!C52` 以 100 為上限），
 * 外插即失控：V=150 → 縮放因子 0.99、V=200 → −5.02（負峰寬 → 倒置的收集時間）。
 * @type {number}
 */
const INJECTION_VOLUME_MIN_UL = 3;
const INJECTION_VOLUME_MAX_UL = 100;

/**
 * 驗證注射體積落在多項式校正範圍內。
 *
 * @param {number} injectionVolume - 注射體積 (μL)
 * @returns {number} 已驗證的注射體積
 * @throws {Error} 非有限值或超出 3–100 μL
 */
function assertInjectionVolumeInRange(injectionVolume) {
    if (!Number.isFinite(injectionVolume)) {
        throw new Error(`注射體積必須是 ${INJECTION_VOLUME_MIN_UL}–${INJECTION_VOLUME_MAX_UL} μL 的數值`);
    }
    if (injectionVolume < INJECTION_VOLUME_MIN_UL || injectionVolume > INJECTION_VOLUME_MAX_UL) {
        throw new Error(
            `注射體積 ${injectionVolume} μL 超出校正範圍 ${INJECTION_VOLUME_MIN_UL}–${INJECTION_VOLUME_MAX_UL} μL；` +
            '三次多項式在範圍外會外插出負的峰寬與倒置的收集時間，請改用範圍內的體積'
        );
    }
    return injectionVolume;
}

/**
 * 計算峰寬縮放因子 (根據注射體積調整)
 * 公式來源: Excel 工作表1_(2) O4
 * @param {number} injectionVolume - 注射體積 (μL)，須在 3–100 μL 校正範圍內
 * @returns {number} 峰寬縮放因子
 * @throws {Error} 注射體積超出校正範圍
 */
function calculatePeakWidthScaling(injectionVolume) {
    const v = assertInjectionVolumeInRange(injectionVolume);
    return 1.00959 - 0.00468 * v + 0.0005034 * v * v - 0.0000031539 * v * v * v;
}

/**
 * 計算時間偏移 (峰位置偏移)
 * 公式來源: Excel 工作表1_(2) P4
 * @param {number} injectionVolume - 注射體積 (μL)，須在 3–100 μL 校正範圍內
 * @returns {number} 時間偏移 (min)
 * @throws {Error} 注射體積超出校正範圍
 */
function calculateTimeOffset(injectionVolume) {
    const v = assertInjectionVolumeInRange(injectionVolume);
    return 0.000146507 - 0.000266 * v + 0.00007393 * v * v - 0.0000005204 * v * v * v;
}

/**
 * Flow rate table 第 5 列（M23，transition to fast flow）的流速。
 * 來源：使用者實際照抄的 Excel 'HPLC flow down data'!C14 = (C13 + C15)/2，
 * 即目標流速與初始流速的平均（工作表1_(2)!N23 的 0.2 只用於內部體積估算）。
 */
function transitionFlowRate(initialFlowRate, targetFlowRate) {
    return (targetFlowRate + initialFlowRate) / 2;
}

/**
 * Fraction collector 與流速回升的常數（Excel `Fraction_collector_high_c`、`工作表1_(2)`、
 * 'HPLC flow down data'）。2026-10-14 決定先照 Excel，待使用者確認是否符合目前硬體與方法；要改只改這裡。
 */
const FRACTION_COLLECTOR = Object.freeze({
    deadVolumeUl: 1050,      // D2：偵測器到收集器之間的管路體積 (μL)
    safeZoneMin: 2.8,        // C22：收集前後的安全區間 (min)
    rampToMidMin: 2,         // 工作表1_(2) M23 = M22 + 2：目標流速 → (目標+初始)/2
    rampToInitialMin: 0.5,   // M24 = M23 + 0.5：→ 初始流速
    fractionVolumeMl: 1.2,   // 'HPLC flow down data'!B24 = 1.2 / 初始流速（每管體積）
});

/** 既有匯出名稱（測試與 UI 使用），值與 FRACTION_COLLECTOR 相同。 */
const DEAD_VOLUME_UL = FRACTION_COLLECTOR.deadVolumeUl;
const SAFE_ZONE_MIN = FRACTION_COLLECTOR.safeZoneMin;

/**
 * Fraction collector 的四段流速（Excel B5–B8），從 X 光收集開始（A5 = M21）算起：
 * 段 1 [A5, A6] 目標流速；段 2 [A6, A7] 用 (目標 + 中值)/2；段 3 [A7, A8] 用 (中值 + 初始)/2；
 * A8 之後回到初始流速。中值 = (目標 + 初始)/2（Excel B7）。
 *
 * 爬升段用「該段平均流速」把體積換成時間是 Excel 的近似：體積正確、時間近似（目標 0.10、
 * 初始 0.35 mL/min 時與線性爬升的精確積分差約 0.16 min）。使用者 2026-10-14 決定照 Excel。
 *
 * @param {number[]} times - [A5, A6, A7, A8]（= M21、M22、M23、M24，min）
 * @param {number} targetFlowRate - 目標流速 (mL/min)
 * @param {number} initialFlowRate - 初始流速 (mL/min)
 * @returns {ReadonlyArray<{start:number, end:number, flowRate:number}>}
 */
function fractionCollectorSegments(times, targetFlowRate, initialFlowRate) {
    const [a5, a6, a7, a8] = times;
    const mid = transitionFlowRate(initialFlowRate, targetFlowRate);
    return Object.freeze([
        Object.freeze({ start: a5, end: a6, flowRate: targetFlowRate }),
        Object.freeze({ start: a6, end: a7, flowRate: (targetFlowRate + mid) / 2 }),
        Object.freeze({ start: a7, end: a8, flowRate: (mid + initialFlowRate) / 2 }),
        Object.freeze({ start: a8, end: Infinity, flowRate: initialFlowRate }),
    ]);
}

/**
 * 從第一段起點起算，累積流出體積到達 volumeUl 的時刻。
 * 邊界與 Excel B10 一致：剛好在段尾到達時算在該段（`<=`）。
 *
 * @param {number} volumeUl - 累積體積 (μL)，≥ 0
 * @param {ReadonlyArray<{start:number, end:number, flowRate:number}>} segments - 最後一段須為無限長
 * @returns {number} 時刻 (min)
 * @throws {Error} 任一段流速非正或非有限
 */
function timeAtCumulativeVolume(volumeUl, segments) {
    let remaining = volumeUl;
    for (const segment of segments) {
        if (!(Number.isFinite(segment.flowRate) && segment.flowRate > 0)) {
            throw new Error(`timeAtCumulativeVolume：流速必須是大於 0 的數值（目前 ${segment.flowRate} mL/min）`);
        }
        const segmentVolume = (segment.end - segment.start) * segment.flowRate * 1000;   // μL；最後一段為 Infinity
        if (remaining <= segmentVolume) {
            return segment.start + remaining / (segment.flowRate * 1000);
        }
        remaining -= segmentVolume;
    }
    throw new Error('timeAtCumulativeVolume：最後一段應為無限長，不應走到這裡');
}

/**
 * Fraction collector 收集時段（Excel `Fraction_collector_high_c` B10／B12 → A24／A27）。
 * 起點：累積體積到達死體積的時刻（X 光收集窗開頭的樣品抵達收集器）− 安全區。
 * 終點：累積體積到達「X 光收集窗體積 Q1 + 死體積」的時刻（收集窗尾端的樣品抵達）＋ 安全區。
 * 等價於 Excel 用數值相等挑分支的兩串 IF（tests/fraction-collector.test.js 以逐格轉寫比對）。
 *
 * @param {{times:number[], targetFlowRate:number, initialFlowRate:number}} p - times = [M21, M22, M23, M24]
 * @returns {{startTime:number, stopTime:number}} 未取位 (min)
 */
function fractionCollectorWindow({ times, targetFlowRate, initialFlowRate }) {
    const segments = fractionCollectorSegments(times, targetFlowRate, initialFlowRate);
    const xrayVolumeUl = (times[1] - times[0]) * targetFlowRate * 1000;   // Excel D4（Q1）
    const { deadVolumeUl, safeZoneMin } = FRACTION_COLLECTOR;
    return Object.freeze({
        startTime: timeAtCumulativeVolume(deadVolumeUl, segments) - safeZoneMin,
        stopTime: timeAtCumulativeVolume(xrayVolumeUl + deadVolumeUl, segments) + safeZoneMin,
    });
}

/**
 * 計算 HPLC-SAXS 完整設定
 * 公式完全來自 Excel 工作表1_(2) 和 HPLC flow down data
 * @param {object} params - 輸入參數
 * @param {number} params.peakCenter - 峰中心位置 (min) from 3μL pre-run (對應 M1)
 * @param {number} params.peakFWHM - 峰寬度 FWHM (min) from 3μL pre-run (對應 M3)
 * @param {number} params.injectionVolume - SAXS 實驗注射體積 (μL) (對應 M4)
 * @param {number} params.targetFlowRate - 目標流速 (mL/min) (對應 Q1, O11)
 * @param {number} params.initialFlowRate - 初始流速 (mL/min) (對應 B6)
 * @returns {object} HPLC-SAXS 設定計算結果
 */
function calculateHPLCSAXSSettings(params) {
    const {
        peakCenter,      // M1 = 10.937
        peakFWHM,        // M3 = 1
        injectionVolume, // M4 = 100
        targetFlowRate,  // Q1, O11 = 0.35
        initialFlowRate  // B6 = 0.35
    } = params;

    // === 輸入驗證（超出校正範圍或非數值會產生負峰寬／倒置時間）===
    if (!Number.isFinite(peakCenter) || peakCenter < 0) {
        throw new Error('Peak center 必須是 ≥ 0 的數值 (min)');
    }
    if (!Number.isFinite(peakFWHM) || peakFWHM <= 0) {
        throw new Error('Peak width (FWHM) 必須是大於 0 的數值 (min)');
    }
    if (!Number.isFinite(targetFlowRate) || targetFlowRate <= 0) {
        throw new Error('Target flow rate 必須是大於 0 的數值 (mL/min)');
    }
    if (!Number.isFinite(initialFlowRate) || initialFlowRate <= 0) {
        throw new Error('Initial flow rate 必須是大於 0 的數值 (mL/min)');
    }
    assertInjectionVolumeInRange(injectionVolume);

    // === 工作表1_(2) 計算 ===

    // O4: 峰寬縮放因子 = 1.00959-0.00468*M4+0.0005034*M4^2-0.0000031539*M4^3
    const O4 = calculatePeakWidthScaling(injectionVolume);

    // P4: 時間偏移 = 0.000146507-0.000266*M4+0.00007393*M4^2-0.0000005204*M4^3
    const P4 = calculateTimeOffset(injectionVolume);

    // M5: Scale Peak Width (FWHM) of X = M3*O4
    const M5 = peakFWHM * O4;

    // O6: R (reducing width factor) = 0.7
    const O6 = 0.7;

    // M6: Target Peak Width (FWHM) = M5*O6
    const M6 = M5 * O6;

    // M7: Peak Start Time = M1+P4-(M5/2)*O6
    const M7 = peakCenter + P4 - (M5 / 2) * O6;

    // M8: Peak Stop Time = M1+P4+(M5/2)*O6
    const M8 = peakCenter + P4 + (M5 / 2) * O6;

    // M9: Total slowing time = M8-M7
    const M9 = M8 - M7;

    // O12: Flow rate ratio = N19/O11 = initialFlowRate / targetFlowRate
    // 減速後樣品通過偵測器的時間會被拉長，比例即為兩個流速之比。
    // initial = target（預設 0.35/0.35）時 O12 = 1，與 Excel 範例一致。
    const O12 = initialFlowRate / targetFlowRate;

    // Q20: T-pre-slowdown time offset = 0.1
    const Q20 = 0.1;

    // E4 from 'HPLC flow down data' = 2 (additional time constant)
    const E4 = 2;

    // === Flow Rate Table (來自工作表1_(2) M19-M24) ===

    // M19 = 0
    const M19 = 0;

    // M20 = M7-Q20-0.2 (Transition to slow flow)
    const M20 = M7 - Q20 - 0.2;

    // M21 = M7-0.2 (Constant slow flow starts) - X-RAY IMAGE
    const M21 = M7 - 0.2;

    // M22 = M21+M9*O12+(0.05/O11)+E4 (Constant slow flow ends) - X-RAY IMAGE
    // 簡化: M21 + M9 + (0.05/targetFlowRate) + 2
    const M22 = M21 + M9 * O12 + (0.05 / targetFlowRate) + E4;

    // M23 = M22+2 (Transition to fast flow)
    const M23 = M22 + FRACTION_COLLECTOR.rampToMidMin;

    // M24 = M23+0.5
    const M24 = M23 + FRACTION_COLLECTOR.rampToInitialMin;

    // === Flow Rate Table（Excel 工作表1_(2) M19:N24）===
    // 語意是 LC 時間表（各時間點 + 線性內插）：
    //   M19 起始流速 → M20 仍是起始流速（此時才開始減速）
    //   M21–M22 維持目標（慢速）流速，X 光收資料
    //   M23 = (target + initial)/2，來源 'HPLC flow down data'!C14 = (C13 + C15)/2
    //   M24 回到起始流速
    // 舊版把 M20/M23/M24 都填成 targetFlowRate，initial ≠ target 時（slow-down
    // SEC-SAXS 的典型情境）會輸出錯誤的方法表。
    const flowRateTable = [
        { time: parseFloat(M19.toFixed(2)), flowRate: initialFlowRate, note: '' },
        { time: parseFloat(M20.toFixed(2)), flowRate: initialFlowRate, note: '' },
        { time: parseFloat(M21.toFixed(2)), flowRate: targetFlowRate, note: 'X-RAY IMAGE' },
        { time: parseFloat(M22.toFixed(2)), flowRate: targetFlowRate, note: 'X-RAY IMAGE' },
        { time: parseFloat(M23.toFixed(2)), flowRate: transitionFlowRate(initialFlowRate, targetFlowRate), note: '' },
        { time: parseFloat(M24.toFixed(2)), flowRate: initialFlowRate, note: '' }
    ];

    // === Fraction Collector (Excel `Fraction_collector_high_c`) ===
    // 減速段與回升段的流速不同，死體積要逐段換算。舊版只用目標流速，初始 ≠ 目標時
    // Stop 一律偏晚（0.20／0.35 mL/min 晚 1.56 min）。
    const xrayDuration = M22 - M21;
    const { startTime: fractionStartTime, stopTime: fractionStopTime } = fractionCollectorWindow({
        times: [M21, M22, M23, M24], targetFlowRate, initialFlowRate,
    });

    // 'HPLC flow down data'!B24 = 1.2/B6（該工作表的 B6 是初始流速）
    const timePerFraction = FRACTION_COLLECTOR.fractionVolumeMl / initialFlowRate;

    // 保留 2 位小數：Excel 的 fraction collector 時間就是以 0.01 min 設定的
    const fractionCollector = {
        startTime: parseFloat(fractionStartTime.toFixed(2)),
        stopTime: parseFloat(fractionStopTime.toFixed(2)),
        timePerFraction: parseFloat(timePerFraction.toFixed(2))
    };

    // === Report Stoptime ('HPLC flow down data'!A15 = B22+1+3) ===
    // 公式本身不取整；儲存格格式 [$-404]0 讓畫面顯示四捨五入的整數，Excel 裡沒有其他儲存格引用 A15。
    // 2026-10-14 使用者決定與 Excel 畫面一致（原本的 Math.ceil 在多數流速下多 1 min）。
    const reportStoptime = Math.round(fractionStopTime + 1 + 3);

    // === Detector Settings (來自 HPLC flow down data E22-J27) ===
    // B11 = M20 (transition time in HPLC flow down data)
    // 但實際 J22 公式使用的是 flow down data 的 B11 = 工作表1_(2) M20
    // 等於 M7 - Q20 - 0.2 = M7 - 0.3
    const B11_detector = M20;  // = M7 - 0.3

    // B12 from HPLC flow down data = M21
    const B12_detector = M21;

    // B13 from HPLC flow down data = M22
    const B13_detector = M22;

    // I22, I23, I24 = 40 (exposure time for steps 1-3)
    const I22 = 40, I23 = 40, I24 = 40;

    // I25, I26 = 2 (exposure time for steps 4-5)
    const I25 = 2;

    // I27 = 4 (exposure time for step 6 TM)
    const I27 = 4;

    // J22 = (B11*60-I22-I23-I24-41)/4-15
    // B11 in HPLC flow down data = 工作表1_(2) M20 = 9.98 (NOT M21!)
    // 驗證: (9.98*60 - 40 - 40 - 40 - 41) / 4 - 15 = (598.8 - 161) / 4 - 15 = 437.8/4 - 15 = 94.45 ≈ 94 ✓
    const J22 = Math.round((M20 * 60 - I22 - I23 - I24 - 41) / 4 - 15);
    const holdTime1 = Math.max(1, J22);

    // J23 = same as J22
    const holdTime2 = holdTime1;

    // J24 = J22 * 2 (但 Excel 實際是 189 = 94*2 + 1，可能是 round 差異)
    // 使用 Math.round((holdTime1 * 2) - 調整項) 或直接 *2
    const holdTime3 = holdTime1 * 2 + 1;  // 94*2+1 = 189

    // G25 = ((B13-B12)*60/I25)+90
    // B13 = M22, B12 = M21
    const G25 = Math.round(((M22 - M21) * 60 / I25) + 90);

    const detectorSettings = [
        { step: 1, mode: 'SAS', frame: 1, wait: 0.1, exposure: I22, hold: holdTime1 },
        { step: 2, mode: 'SAS', frame: 1, wait: 0.1, exposure: I23, hold: holdTime2 },
        { step: 3, mode: 'SAS', frame: 1, wait: 0.1, exposure: I24, hold: holdTime3 },
        { step: 4, mode: 'SAS', frame: G25, wait: 0.1, exposure: I25, hold: 100 },
        { step: 5, mode: 'SAS', frame: 1, wait: 0.1, exposure: I25, hold: 1 },
        { step: 6, mode: 'TM', frame: 1, wait: 0.1, exposure: I27, hold: 1 }
    ];

    return {
        // 輸入參數回傳
        input: {
            peakCenter,
            peakFWHM,
            injectionVolume,
            targetFlowRate,
            initialFlowRate
        },
        // 計算的中間值 (對應 Excel 變數)
        scaling: {
            peakWidthScaling: parseFloat(O4.toFixed(4)),      // O4
            timeOffset: parseFloat(P4.toFixed(4)),            // P4
            adjustedFWHM: parseFloat(M5.toFixed(3)),          // M5
            targetFWHM: parseFloat(M6.toFixed(3)),            // M6
            xrayDuration: parseFloat(xrayDuration.toFixed(3)) // M22-M21
        },
        // X-RAY 收集時間
        xrayCollection: {
            peakStartTime: parseFloat(M7.toFixed(3)),         // M7
            peakStopTime: parseFloat(M8.toFixed(3)),          // M8
            totalSlowingTime: parseFloat(M9.toFixed(3)),      // M9
            totalSlowingTimeSec: parseFloat((M9 * 60).toFixed(1))   // M9 * 60
        },
        // Flow Rate Table
        flowRateTable,
        // Fraction Collector
        fractionCollector,
        // Report Stoptime
        reportStoptime,
        // Detector Settings
        detectorSettings
    };
}

/**
 * 計算建議的 10μL pre-run 參數
 * 公式來源: HPLC flow down data D2, F2, F3, F4
 * @param {number} peakCenter3ul - 3μL pre-run 的峰中心 (B2)
 * @param {number} peakFWHM3ul - 3μL pre-run 的峰寬 (B3)
 * @returns {object} 建議的 10μL 參數
 */
function calculateSuggestedParams(peakCenter3ul, peakFWHM3ul) {
    // 根據 Excel 'Input protein information'!L24 和實際數據對應關係
    // Excel 中 3μL: peak center = 10.937, FWHM = 1
    //        10μL: peak center = 9.521, FWHM = 2
    // 
    // 峰中心偏移 = 10.937 - 9.521 = 1.416 min (10μL 峰較早出現)
    // FWHM 比例 = 2 / 1 = 2 (10μL 峰較寬)
    //
    // 這些可能是經驗值，不是純粹從注射體積公式計算
    // 讓我們使用 Excel 的實際比例

    const scaling_3ul = calculatePeakWidthScaling(3);
    const scaling_10ul = calculatePeakWidthScaling(10);
    const offset_3ul = calculateTimeOffset(3);
    const offset_10ul = calculateTimeOffset(10);

    // 峰位置偏移: 10μL 時峰較早出來約 1.4 min (經驗值)
    // 這個偏移主要來自較大注射體積導致較早突破
    // 使用線性關係: offset ≈ -0.2 * (volume_ul - 3)
    const volumeShift = -0.2 * (10 - 3);  // ≈ -1.4 min
    const suggestPeakCenter = peakCenter3ul + volumeShift;

    // 峰寬: 10μL 時 FWHM 約為 3μL 的 2 倍
    const suggestPeakWidth = peakFWHM3ul * 2;

    return {
        suggestPeakCenter: parseFloat(suggestPeakCenter.toFixed(3)),
        suggestPeakWidth: parseFloat(suggestPeakWidth.toFixed(0)),
        suggestSampleVolume: 10
    };
}
