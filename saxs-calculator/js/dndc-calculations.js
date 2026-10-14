/**
 * TPS13A SAXS Calculator - dn/dc Calculations Module
 * HPLC 與 Slice dn/dc 主流程（對應 Python calculator.py）＋ window.DndcCalculations 匯出。
 *
 * 2026-10-14 拆檔（純搬移）：理論與校正 → dndc-theory-calculations.js；基線、峰值、線性擬合 →
 * dndc-signal-calculations.js；對齊 → dndc-alignment-calculations.js。結尾的匯出區塊在載入期
 * 讀取那三個檔的頂層宣告，所以它們必須排在本檔之前。
 */

// ============================================================
// Calculator — HPLC & Slice dn/dc
// ============================================================

/** 負 dn/dc 的警告文字（與 Python dndc.calculator.NEGATIVE_DNDC_WARNING 相同）。 */
const NEGATIVE_DNDC_WARNING = 'dn/dc 為負：請檢查 RI 極性或峰／基線區間';

/** UV 峰為負時的錯誤訊息（與 Python dndc.calculator.NEGATIVE_UV_PEAK_MESSAGE 相同）。 */
const NEGATIVE_UV_PEAK_MESSAGE = 'UV 峰為負：基線區間落在峰上或極性反轉，請檢查 UV 峰範圍與基線範圍';

/**
 * 最終 dn/dc 為負時回傳警告。蛋白質的 dn/dc 必為正，負值幾乎都是設定錯誤；
 * 但少數樣品在高折射率溶劑中本來就是負的，所以只警告、不擋（使用者 2026-10-14 定案）。
 *
 * @param {number} dndc - mL/g
 * @returns {string[]} 新陣列
 */
function negativeDndcWarnings(dndc) {
    return dndc < 0 ? [NEGATIVE_DNDC_WARNING] : [];
}

/**
 * Create a boolean mask for indices where time falls within [start, end].
 *
 * @param {number[]} time - Time axis
 * @param {number} start - Window start (inclusive)
 * @param {number} end - Window end (inclusive)
 * @returns {boolean[]} Mask array
 */
function _createMask(time, start, end) {
    return time.map(t => t >= start && t <= end);
}

/**
 * 確認訊號在「基線 + 峰」計算視窗內沒有非有限值。
 *
 * CSV 常見的單位列、註解列、空白格會被 parseCSV 存成 NaN；一旦落在計算
 * 視窗內，梯形積分與基線擬合會整條污染成 NaN，使用者只會看到 "NaN" 或
 * 一個偏掉的數字。這裡直接失敗並指出欄位與時間區間。
 *
 * @param {number[]} time - Time axis
 * @param {number[]} signal - Signal array to check
 * @param {boolean[][]} masks - Masks whose union defines the region of interest
 * @param {string} label - Human-readable channel name (e.g. 'UV', 'RI')
 * @throws {Error} When any masked sample is not finite
 */
function _assertFiniteInWindows(time, signal, masks, label) {
    let count = 0;
    let tMin = Infinity;
    let tMax = -Infinity;

    for (let i = 0; i < signal.length; i++) {
        let inWindow = false;
        for (const mask of masks) {
            if (mask[i]) { inWindow = true; break; }
        }
        if (!inWindow || Number.isFinite(signal[i])) { continue; }

        count++;
        if (Number.isFinite(time[i])) {
            if (time[i] < tMin) { tMin = time[i]; }
            if (time[i] > tMax) { tMax = time[i]; }
        }
    }

    if (count === 0) { return; }

    const range = Number.isFinite(tMin) && Number.isFinite(tMax)
        ? `（t = ${tMin.toFixed(2)}–${tMax.toFixed(2)} min）` : '';
    throw new Error(
        `${label} 欄在基線／峰範圍內有 ${count} 個非數值或空白格${range}，` +
        '請檢查原始檔案（單位列、註解列）或改選其他欄位'
    );
}

/**
 * 驗證光學／校正參數（空欄位在 UI 端會 parseFloat 成 NaN，NaN <= 0 為 false
 * 會整路穿過舊的檢查，最後印出 "NaN"）。
 *
 * @param {object} params - { epsilon, pathLen, riFactor }
 * @param {boolean} needsUv - 是否需要用 UV 換算濃度（無手動濃度時為 true）
 * @throws {Error} 任一參數非有限或 <= 0
 */
function _assertOpticalParams({ epsilon, pathLen, riFactor }, needsUv) {
    if (!Number.isFinite(riFactor) || riFactor <= 0) {
        throw new Error('RI 校正因子 (K_RI) 必須是大於 0 的數值');
    }
    if (!needsUv) { return; }
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
        throw new Error('消光係數 ε 必須是大於 0 的數值');
    }
    if (!Number.isFinite(pathLen) || pathLen <= 0) {
        throw new Error('光徑長度必須是大於 0 的數值');
    }
}

/**
 * Apply the RI detector delay by shifting the RI signal.
 *
 * Sign convention (matches the UI label): a POSITIVE riDelay means the RI
 * detector sits downstream of the UV detector, i.e. the RI peak arrives LATER
 * than the UV peak. Compensating therefore moves the RI trace EARLIER
 * (shiftArray with a negative point count).
 *
 * @param {number[]} riSignal - RI detector signal
 * @param {number[]} time - Time axis
 * @param {number} riDelay - RI delay in time units (e.g. minutes); positive =
 *        RI later than UV
 * @returns {number[]} Delay-corrected RI signal (new array)
 */
function _applyRiDelay(riSignal, time, riDelay) {
    if (riDelay === 0) { return riSignal.slice(); }
    // Convert time-based delay to number of points
    const dt = time.length > 1 ? (time[time.length - 1] - time[0]) / (time.length - 1) : 1;
    const pts = Math.round(riDelay / dt);
    return shiftArray(riSignal, -pts);
}

/**
 * Compute concentration from UV absorbance via Beer-Lambert law.
 *
 * C = A / (ε × l)
 *
 * ε is the MASS extinction coefficient in mL/(mg·cm) (UI default 0.667 for
 * protein at 280 nm), so the resulting concentration is in mg/mL.
 *
 * @param {number[]} uvSignal - UV absorbance signal (AU)
 * @param {number} epsilon - Mass extinction coefficient, mL/(mg·cm)
 * @param {number} pathLen - Optical path length (cm)
 * @returns {number[]} Concentration array (mg/mL)
 */
function _computeConcentration(uvSignal, epsilon, pathLen) {
    const factor = epsilon * pathLen;
    if (factor === 0) {
        throw new Error("epsilon × pathLen must not be zero.");
    }
    return uvSignal.map(a => a / factor);
}

/**
 * Convert a concentration from mg/mL to g/mL.
 * dn/dc = Δn / c is only in mL/g when c is expressed in g/mL.
 *
 * @param {number} concentrationMgml - Concentration in mg/mL
 * @returns {number} Concentration in g/mL
 */
const MGML_PER_GML = 1000;
function _toGramsPerMl(concentrationMgml) {
    return concentrationMgml / MGML_PER_GML;
}

/**
 * Compute dn/dc from HPLC data using total peak integration.
 *
 * The method baseline-corrects both UV and RI signals, optionally
 * auto-aligns them, and derives dn/dc = RI_peak / (concentration_peak).
 *
 * @param {number[]} time - Time axis
 * @param {number[]} uvSignal - UV detector signal
 * @param {number[]} riSignal - RI detector signal
 * @param {object} params - Calculation parameters
 * @param {number} params.peakStart - Peak region start (time units)
 * @param {number} params.peakEnd - Peak region end (time units)
 * @param {number} params.bl1Start - Baseline window 1 start
 * @param {number} params.bl1End - Baseline window 1 end
 * @param {number} params.bl2Start - Baseline window 2 start
 * @param {number} params.bl2End - Baseline window 2 end
 * @param {number} params.epsilon - Mass extinction coefficient, mL/(mg·cm)
 * @param {number} params.pathLen - Path length (cm)
 * @param {number} params.riFactor - RI calibration factor (RI units per Δn)
 * @param {number} params.riDelay - RI detector delay (time units, positive = RI later)
 * @param {string} params.baselineMode - "const" or "linear"
 * @param {string} params.peakMode - "height", "area", or "spi"
 * @param {number|null} params.manualC - Manual concentration override, mg/mL
 * @param {boolean} params.autoAlign - Whether to auto-align UV and RI
 * @param {number} params.decimalPlaces - Display precision hint (not applied here)
 * @returns {object} Calculation result; `dndc` in mL/g, `concentration` in
 *          mg/mL, `concentrationGml` in g/mL
 */
function computeHplcDndc(time, uvSignal, riSignal, params) {
    const {
        peakStart, peakEnd,
        bl1Start, bl1End, bl2Start, bl2End,
        epsilon, pathLen, riFactor, riDelay,
        baselineMode, peakMode,
        manualC, autoAlign, decimalPlaces
    } = params;

    const hasManualC = manualC !== null && manualC !== undefined;

    // A manual scalar concentration cannot normalise an integrated RI area:
    // RIU·min ÷ (mg/mL) is not mL/g.
    if (hasManualC && peakMode === 'area') {
        throw new Error('手動濃度不能搭配「面積」模式（RIU·min ÷ mg/mL 量綱不成立）。請改用「峰高」模式，或到多注射擬合頁面使用質量法。');
    }

    _assertOpticalParams({ epsilon, pathLen, riFactor }, !hasManualC);

    // Build masks
    const bl1Mask = _createMask(time, bl1Start, bl1End);
    const bl2Mask = _createMask(time, bl2Start, bl2End);
    const peakMask = _createMask(time, peakStart, peakEnd);

    // 非數值（NaN）在進入積分／基線擬合之前就攔下
    const windows = [bl1Mask, bl2Mask, peakMask];
    _assertFiniteInWindows(time, riSignal, windows, 'RI');
    if (!hasManualC) { _assertFiniteInWindows(time, uvSignal, windows, 'UV'); }

    // Apply RI delay
    let riCorrected = _applyRiDelay(riSignal, time, riDelay);

    // Auto-align if requested (skipped when it would be meaningless)
    let alignmentInfo = null;
    if (autoAlign) {
        const aligned = _resolveAlignment(uvSignal, riCorrected, manualC, 50);
        alignmentInfo = aligned.alignmentInfo;
        riCorrected = aligned.riAligned;
    }

    // Baseline correction
    const uvCorrected = baselineCorrect(time, uvSignal, baselineMode, bl1Mask, bl2Mask);
    const riBaselineCorrected = baselineCorrect(time, riCorrected, baselineMode, bl1Mask, bl2Mask);

    // Peak measurement on RI signal
    const riPeak = measurePeak(riBaselineCorrected, time, peakMask, peakMode);
    const riValue = riPeak.value / riFactor;

    // Concentration from UV (mg/mL)
    let concentration;
    if (hasManualC) {
        concentration = manualC;
    } else {
        const concArray = _computeConcentration(uvCorrected, epsilon, pathLen);
        const uvPeak = measurePeak(concArray, time, peakMask, peakMode);
        // 峰值保留符號後，負 UV 峰會走到下方的「無法求得有效濃度」——那句話講錯原因，先攔下
        if (uvPeak.value < 0) {
            throw new Error(NEGATIVE_UV_PEAK_MESSAGE);
        }
        concentration = uvPeak.value;
    }

    // dn/dc [mL/g] = Δn / c[g/mL]
    // 濃度為 0 / 負值 / 非有限值時直接失敗，不要靜默回傳 dn/dc = 0
    const concentrationGml = _toGramsPerMl(concentration);
    if (!Number.isFinite(concentrationGml) || concentrationGml <= 0) {
        throw new Error('無法求得有效濃度（UV 峰區或基線區可能設錯、UV 全為雜訊、或手動濃度 ≤ 0），請檢查峰範圍與基線範圍');
    }
    const dndc = riValue / concentrationGml;

    return {
        dndc,                    // mL/g (formatting is the display layer's job)
        riPeakValue: riPeak.value,
        riValue,
        concentration,           // mg/mL
        concentrationGml,        // g/mL
        peakMode,
        baselineMode,
        decimalPlaces,
        alignmentInfo,
        uvCorrected,
        riCorrected: riBaselineCorrected,
        warnings: negativeDndcWarnings(dndc)
    };
}

/**
 * Compute dn/dc on a slice-by-slice (point-by-point) basis within the peak.
 *
 * For each time slice where UV is above a minimum fraction of its max,
 * dn/dc_i = RI_i / concentration_i. An overall dn/dc is obtained by
 * linear regression of RI vs. concentration.
 *
 * @param {number[]} time - Time axis
 * @param {number[]} uvSignal - UV detector signal
 * @param {number[]} riSignal - RI detector signal
 * @param {object} params - Same parameter object as computeHplcDndc
 * @param {number} [minUvFraction=0.05] - Minimum UV fraction to include a slice
 * @returns {object} Slice-based dn/dc result; `dndc` in mL/g,
 *          `sliceConcentrations` in g/mL, `sliceConcentrationsMgml` in mg/mL
 */
function computeSliceDndc(time, uvSignal, riSignal, params, minUvFraction = 0.05) {
    const {
        peakStart, peakEnd,
        bl1Start, bl1End, bl2Start, bl2End,
        epsilon, pathLen, riFactor, riDelay,
        baselineMode,
        autoAlign, decimalPlaces
    } = params;

    // Slice 模式一律用 UV 逐點換算濃度，因此 UV 參數必須有效
    _assertOpticalParams({ epsilon, pathLen, riFactor }, true);

    // Build masks
    const bl1Mask = _createMask(time, bl1Start, bl1End);
    const bl2Mask = _createMask(time, bl2Start, bl2End);
    const peakMask = _createMask(time, peakStart, peakEnd);

    // 非數值（NaN）在進入積分／基線擬合之前就攔下
    const windows = [bl1Mask, bl2Mask, peakMask];
    _assertFiniteInWindows(time, riSignal, windows, 'RI');
    _assertFiniteInWindows(time, uvSignal, windows, 'UV');

    // Apply RI delay
    let riCorrected = _applyRiDelay(riSignal, time, riDelay);

    // Auto-align if requested (skipped when it would be meaningless).
    // Slice mode always derives concentration point-by-point from UV, so a
    // manual concentration must not gate the alignment here.
    let alignmentInfo = null;
    if (autoAlign) {
        const aligned = _resolveAlignment(uvSignal, riCorrected, null, 50);
        alignmentInfo = aligned.alignmentInfo;
        riCorrected = aligned.riAligned;
    }

    // Baseline correction
    const uvCorrected = baselineCorrect(time, uvSignal, baselineMode, bl1Mask, bl2Mask);
    const riBaselineCorrected = baselineCorrect(time, riCorrected, baselineMode, bl1Mask, bl2Mask);

    // Concentration array from UV (mg/mL)
    const concArrayMgml = _computeConcentration(uvCorrected, epsilon, pathLen);
    // dn/dc in mL/g requires concentration in g/mL
    const concArray = concArrayMgml.map(_toGramsPerMl);

    // Find peak-region max UV for thresholding
    let maxUv = 0;
    for (let i = 0; i < uvCorrected.length; i++) {
        if (peakMask[i] && Math.abs(uvCorrected[i]) > maxUv) {
            maxUv = Math.abs(uvCorrected[i]);
        }
    }
    const uvThreshold = maxUv * minUvFraction;

    // Collect slice data
    const sliceConcentrations = [];      // g/mL
    const sliceConcentrationsMgml = [];  // mg/mL
    const sliceRiValues = [];
    const sliceTimes = [];
    const sliceDndcValues = [];

    for (let i = 0; i < time.length; i++) {
        if (!peakMask[i]) { continue; }
        if (Math.abs(uvCorrected[i]) < uvThreshold) { continue; }

        const c = concArray[i];
        const ri = riBaselineCorrected[i] / riFactor;
        if (c === 0) { continue; }

        sliceConcentrations.push(c);
        sliceConcentrationsMgml.push(concArrayMgml[i]);
        sliceRiValues.push(ri);
        sliceTimes.push(time[i]);
        sliceDndcValues.push(ri / c);
    }

    // Linear fit: RI vs concentration → slope = dn/dc
    // 少於 2 個切片無法做迴歸；回傳單點值或 0 會讓畫面出現一個沒有統計意義
    // 的 dn/dc（且下游繪圖會對 null fitResult 丟 TypeError），因此直接失敗。
    if (sliceConcentrations.length < 2) {
        throw new Error(
            `有效切片不足 2 個（目前 ${sliceConcentrations.length} 個：UV 高於峰內最大值 ` +
            `${(minUvFraction * 100).toFixed(0)}% 的點太少），請放寬峰範圍或檢查 UV 訊號`
        );
    }

    const fitResult = linearFit(sliceConcentrations, sliceRiValues);
    const dndc = fitResult.dnDc;

    return {
        dndc,                    // mL/g (formatting is the display layer's job)
        fitResult,
        sliceCount: sliceConcentrations.length,
        sliceConcentrations,     // g/mL
        sliceConcentrationsMgml, // mg/mL
        sliceRiValues,
        sliceTimes,
        sliceDndcValues,
        decimalPlaces,
        alignmentInfo,
        uvCorrected,
        riCorrected: riBaselineCorrected,
        warnings: negativeDndcWarnings(dndc)
    };
}

// ============================================================
// Public API — export everything on window.DndcCalculations
// ============================================================

window.DndcCalculations = Object.freeze({
    // Theoretical
    EMPIRICAL_VALUES,
    LITERATURE_VALUES,
    WAVELENGTH_CAUCHY_DEFAULTS,
    temperatureCorrection,
    wavelengthCorrection,
    comprehensiveCorrection,
    lorentzLorenz,
    gladstoneDale,
    estimateMolecularWeight,

    // Baseline
    autoBaselineWindows,
    shiftArray,
    baselineCorrect,

    // Peak
    measurePeak,

    // Alignment
    computeTimeLag,

    // Linear Fit
    linearFit,

    // Calculator
    computeHplcDndc,
    computeSliceDndc,
    NEGATIVE_DNDC_WARNING,
    NEGATIVE_UV_PEAK_MESSAGE,
    negativeDndcWarnings
});
