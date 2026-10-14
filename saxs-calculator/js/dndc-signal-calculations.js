/**
 * TPS13A SAXS Calculator - 基線校正、峰值量測、線性擬合（對應 Python baseline.py、peak.py、linear_fit.py）
 *
 * 2026-10-14 從 dndc-calculations.js 純搬移拆出。函式宣告在全域作用域，由 dndc-calculations.js 結尾的匯出區塊
 * 在載入期讀取，所以本檔必須排在 dndc-calculations.js 之前（tests/structure.test.js 檢查）。
 */

// ============================================================
// Baseline Correction
// ============================================================

/**
 * Automatically determine two baseline windows flanking a peak.
 *
 * @param {number[]} time - Time axis array
 * @param {number} peakStart - Start of the peak region (time units)
 * @param {number} peakEnd - End of the peak region (time units)
 * @param {number} [width=1.0] - Width of each baseline window
 * @param {number} [margin=0.5] - Gap between peak edge and baseline window
 * @returns {number[]} [bl1Start, bl1End, bl2Start, bl2End]
 */
function autoBaselineWindows(time, peakStart, peakEnd, width = 1.0, margin = 0.5) {
    const tMin = Math.min(...time);
    const tMax = Math.max(...time);

    let bl1End = peakStart - margin;
    let bl1Start = bl1End - width;
    let bl2Start = peakEnd + margin;
    let bl2End = bl2Start + width;

    // Clamp to data range
    bl1Start = Math.max(bl1Start, tMin);
    bl1End = Math.max(bl1End, tMin);
    bl2Start = Math.min(bl2Start, tMax);
    bl2End = Math.min(bl2End, tMax);

    return [bl1Start, bl1End, bl2Start, bl2End];
}

/**
 * Shift an array by a given number of points.
 * Positive pts shifts right (fills leading with first value),
 * negative pts shifts left (fills trailing with last value).
 *
 * @param {number[]} arr - Input array
 * @param {number} pts - Number of points to shift (integer)
 * @returns {number[]} New shifted array (original is not mutated)
 */
function shiftArray(arr, pts) {
    const n = arr.length;
    if (pts === 0) {
        return arr.slice();
    }
    const result = new Array(n);
    if (pts > 0) {
        const shift = Math.min(pts, n);
        for (let i = 0; i < shift; i++) {
            result[i] = arr[0];
        }
        for (let i = shift; i < n; i++) {
            result[i] = arr[i - shift];
        }
    } else {
        const shift = Math.min(-pts, n);
        for (let i = 0; i < n - shift; i++) {
            result[i] = arr[i + shift];
        }
        for (let i = n - shift; i < n; i++) {
            result[i] = arr[n - 1];
        }
    }
    return result;
}

/** 合法的基線模式。未知模式一律 throw，不靜默退回 linear。 */
const BASELINE_MODES = Object.freeze(['const', 'linear']);

/**
 * Apply baseline correction to a signal.
 *
 * @param {number[]} time - Time axis array
 * @param {number[]} signal - Raw signal array (same length as time)
 * @param {string} mode - "const" for constant offset, "linear" for linear baseline
 * @param {boolean[]} bl1Mask - Boolean mask for the first baseline window
 * @param {boolean[]} bl2Mask - Boolean mask for the second baseline window
 * @returns {number[]} Baseline-corrected signal (new array)
 * @throws {Error} mode 不是 const／linear 時
 */
function baselineCorrect(time, signal, mode, bl1Mask, bl2Mask) {
    // 打錯字或漏傳（undefined）以前會靜默走 linear 分支，算出的 dn/dc
    // 看起來完全正常但用的不是使用者選的基線模型。
    if (!BASELINE_MODES.includes(mode)) {
        throw new Error(`baselineCorrect: 未知的 mode "${mode}"（需為 const 或 linear）`);
    }

    const n = signal.length;

    // Gather indices for each window and the union
    const bl1Indices = [];
    const bl2Indices = [];
    for (let i = 0; i < n; i++) {
        if (bl1Mask[i]) { bl1Indices.push(i); }
        if (bl2Mask[i]) { bl2Indices.push(i); }
    }
    const combinedIndices = [];
    for (let i = 0; i < n; i++) {
        if (bl1Mask[i] || bl2Mask[i]) { combinedIndices.push(i); }
    }

    // 空視窗 = 使用者把基線範圍設在資料之外（常見於時間單位 min/sec 弄錯）。
    // 靜默用單一視窗或回傳未校正訊號都會產生看似合理但錯誤的 dn/dc，因此直接失敗。
    if (bl1Indices.length === 0 && bl2Indices.length === 0) {
        throw new Error('基線視窗 BL1 與 BL2 內都沒有資料點，請確認基線時間範圍落在色譜圖的時間軸內（單位為分鐘）');
    }
    if (bl1Indices.length === 0) {
        throw new Error('基線視窗 BL1 (bl1Start–bl1End) 內沒有任何資料點，請調整 Baseline 1 範圍');
    }
    if (bl2Indices.length === 0) {
        throw new Error('基線視窗 BL2 (bl2Start–bl2End) 內沒有任何資料點，請調整 Baseline 2 範圍');
    }

    if (mode === "const") {
        // Constant baseline: subtract the mean of both windows
        let sum = 0;
        for (const idx of combinedIndices) { sum += signal[idx]; }
        const mean = sum / combinedIndices.length;
        return signal.map(v => v - mean);
    }

    // Linear baseline: fit a line through the two window centres
    // （兩個視窗都非空已在上方檢查過）

    const meanOf = (indices, arr) => {
        let s = 0;
        for (const i of indices) { s += arr[i]; }
        return s / indices.length;
    };

    const meanT1 = meanOf(bl1Indices, time);
    const meanS1 = meanOf(bl1Indices, signal);
    const meanT2 = meanOf(bl2Indices, time);
    const meanS2 = meanOf(bl2Indices, signal);

    const denom = meanT2 - meanT1;
    if (denom === 0) {
        // Baseline windows overlap or identical — fall back to constant baseline
        const mean = (meanS1 + meanS2) / 2;
        return signal.map(v => v - mean);
    }

    const slope = (meanS2 - meanS1) / denom;
    const intercept = meanS1 - slope * meanT1;

    return time.map((t, i) => signal[i] - (slope * t + intercept));
}

// ============================================================
// Peak Measurement
// ============================================================

/** 合法的峰量測模式。未知模式會讓 value 變成 undefined，因此一律 throw。 */
const PEAK_MODES = Object.freeze(['height', 'area', 'spi']);

/**
 * Measure a peak using one of three modes.
 *
 * @param {number[]} correctedSignal - Baseline-corrected signal
 * @param {number[]} time - Time axis
 * @param {boolean[]} peakMask - Boolean mask for the peak region
 * @param {string} mode - "height", "area", or "spi" (single-point interpolation)
 * @returns {object} { value, mode, peakHeight, peakArea, spi }
 * @throws {Error} mode 不是 height／area／spi 時
 */
function measurePeak(correctedSignal, time, peakMask, mode) {
    // valueMap[mode] 對未知 mode 會回 undefined，一路傳下去變成 NaN 的 dn/dc；
    // 用陣列白名單而非物件查表，順便擋掉 "constructor" 這類原型鏈上的鍵。
    if (!PEAK_MODES.includes(mode)) {
        throw new Error(`measurePeak: 未知的 mode "${mode}"（需為 height、area 或 spi）`);
    }

    // Extract peak region
    const sig = [];
    const t = [];
    for (let i = 0; i < correctedSignal.length; i++) {
        if (peakMask[i]) {
            sig.push(correctedSignal[i]);
            t.push(time[i]);
        }
    }

    // 空的 peak 遮罩會讓 height/area 得 0、spi 得 undefined，最後靜默產出
    // dn/dc = 0 或 NaN。直接失敗，讓使用者知道範圍設錯了。
    if (sig.length === 0) {
        throw new Error('峰範圍 (peakStart–peakEnd) 內沒有任何資料點，請檢查時間單位與範圍');
    }

    // Height: maximum absolute value
    const peakHeight = sig.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);

    // Area: trapezoidal integration of absolute area
    let peakArea = 0;
    for (let i = 1; i < sig.length; i++) {
        peakArea += (t[i] - t[i - 1]) * (sig[i] + sig[i - 1]) / 2;
    }
    peakArea = Math.abs(peakArea);

    // SPI: value at the midpoint index
    const spi = sig[Math.floor(sig.length / 2)];

    const valueMap = { height: peakHeight, area: peakArea, spi };
    return {
        value: valueMap[mode],
        mode,
        peakHeight,
        peakArea,
        spi
    };
}

// ============================================================
// Linear Fit (Least Squares)
// ============================================================

/**
 * Perform a least-squares linear fit: y = slope * x + intercept.
 *
 * @param {number[]} concentrations - Independent variable (x)
 * @param {number[]} refractiveIndices - Dependent variable (y)
 * @returns {object} { dnDc, intercept, rSquared, stdError, yPred, residuals }
 */
function linearFit(concentrations, refractiveIndices) {
    const n = concentrations.length;
    if (n < 2) {
        throw new Error("linearFit requires at least 2 data points.");
    }

    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += concentrations[i];
        sumY += refractiveIndices[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let ssXY = 0, ssXX = 0;
    for (let i = 0; i < n; i++) {
        const dx = concentrations[i] - meanX;
        ssXY += dx * (refractiveIndices[i] - meanY);
        ssXX += dx * dx;
    }

    if (ssXX === 0) {
        throw new Error("All concentration values are identical — cannot compute linear fit.");
    }
    const slope = ssXY / ssXX;
    const intercept = meanY - slope * meanX;

    // Predictions and residuals
    const yPred = concentrations.map(x => slope * x + intercept);
    const residuals = refractiveIndices.map((y, i) => y - yPred[i]);

    // R²
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
        ssTot += (refractiveIndices[i] - meanY) ** 2;
        ssRes += residuals[i] ** 2;
    }
    const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

    // Standard error of the slope
    const mse = n > 2 ? ssRes / (n - 2) : 0;
    const stdError = ssXX > 0 ? Math.sqrt(mse / ssXX) : 0;

    return {
        dnDc: slope,
        intercept,
        rSquared,
        stdError,
        yPred,
        residuals
    };
}
