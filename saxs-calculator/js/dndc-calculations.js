/**
 * TPS13A SAXS Calculator - dn/dc Calculations Module
 * HPLC-based dn/dc determination: theoretical values, baseline correction,
 * peak measurement, signal alignment, linear fitting, and calculator functions.
 *
 * Ported from Python modules: theoretical.py, baseline.py, peak.py,
 * alignment.py, linear_fit.py, calculator.py
 */

// ============================================================
// Theoretical dn/dc Values & Corrections
// ============================================================

/**
 * Empirical dn/dc values (mL/g) for common polymer/biomolecule classes
 * at 25 °C, 633 nm, in aqueous solvent.
 * @type {Object<string, number>}
 */
const EMPIRICAL_VALUES = Object.freeze({
    protein: 0.185,
    DNA: 0.168,
    RNA: 0.170,
    polystyrene: 0.184,
    PMMA: 0.088,
    PEG: 0.135,
    dextran: 0.150
});

/**
 * Literature dn/dc values with Chinese labels for UI display.
 * Values are strings to preserve formatting intent.
 * @type {Object<string, string>}
 */
const LITERATURE_VALUES = Object.freeze({
    "BSA (牛血清白蛋白)": "0.185",
    "溶菌酶": "0.188",
    "DNA (雙鏈)": "0.168",
    "RNA": "0.170",
    "聚乙二醇 (PEG)": "0.135",
    "葡聚糖": "0.150",
    "聚丙烯酸": "0.180"
});

/**
 * Apply temperature correction to a dn/dc value measured at 25 °C.
 *
 * Uses the empirical linear coefficient −4 × 10⁻⁴ /°C.
 *
 * @param {number} dndcAt25 - dn/dc measured at 25 °C (mL/g)
 * @param {number} targetTemp - Target temperature (°C)
 * @returns {number} Temperature-corrected dn/dc
 */
function temperatureCorrection(dndcAt25, targetTemp) {
    const TEMP_COEFF = -4e-4;
    return dndcAt25 * (1 + TEMP_COEFF * (targetTemp - 25));
}

/**
 * Default Cauchy dispersion coefficients for the specific refractive index
 * increment of proteins.
 *
 * 由蛋白質色散錨點 0.190 mL/g @ 589 nm、0.188 mL/g @ 633 nm 反推的 Cauchy
 * 擬合（A = 0.1756 mL/g、B = 5.0 × 10³ nm²·mL/g）；**未經原始文獻表值驗證**，
 * 僅作為比 λ⁻² 更合理的一階色散近似。若有實測色散資料應改用實測值。
 *   A: mL/g (wavelength-independent term)
 *   B: nm²·mL/g (dispersion term)
 * @type {{A: number, B: number}}
 */
const WAVELENGTH_CAUCHY_DEFAULTS = Object.freeze({ A: 0.1756, B: 5.0e3 });

/**
 * Apply wavelength correction using a Cauchy dispersion ratio.
 *
 *   dn/dc(λ₂) = dn/dc(λ₁) × (A + B/λ₂²) / (A + B/λ₁²)
 *
 * The previous λ⁻² scaling implicitly assumed A = 0, which overestimates the
 * dispersion (e.g. 589 → 658 nm was 20 % low).
 *
 * @param {number} dndcRef - dn/dc at the reference wavelength (mL/g)
 * @param {number} lambdaRef - Reference wavelength (nm)
 * @param {number} lambdaTarget - Target wavelength (nm)
 * @param {number} [cauchyA] - Cauchy constant term A (mL/g), protein default
 * @param {number} [cauchyB] - Cauchy dispersion term B (nm²·mL/g), protein default
 * @returns {number} Wavelength-corrected dn/dc (mL/g)
 */
function wavelengthCorrection(
    dndcRef,
    lambdaRef,
    lambdaTarget,
    cauchyA = WAVELENGTH_CAUCHY_DEFAULTS.A,
    cauchyB = WAVELENGTH_CAUCHY_DEFAULTS.B
) {
    if (!Number.isFinite(lambdaRef) || lambdaRef <= 0
        || !Number.isFinite(lambdaTarget) || lambdaTarget <= 0) {
        throw new Error('波長必須為大於 0 的有限數值 (nm)。');
    }
    const refTerm = cauchyA + cauchyB / (lambdaRef ** 2);
    const targetTerm = cauchyA + cauchyB / (lambdaTarget ** 2);
    if (!Number.isFinite(refTerm) || refTerm === 0) {
        throw new Error('波長校正失敗：Cauchy 係數無效（A + B/λ² = 0）。');
    }
    return dndcRef * (targetTerm / refTerm);
}

/**
 * Apply both temperature and wavelength corrections, returning a
 * detailed breakdown of each contribution.
 *
 * @param {number} refDndc - Reference dn/dc value (mL/g)
 * @param {number} refTemp - Temperature at which refDndc was measured (°C)
 * @param {number} refWave - Wavelength at which refDndc was measured (nm)
 * @param {number} targetTemp - Desired temperature (°C)
 * @param {number} targetWave - Desired wavelength (nm)
 * @param {number} [cauchyA] - Cauchy constant term A (mL/g)
 * @param {number} [cauchyB] - Cauchy dispersion term B (nm²·mL/g)
 * @returns {object} Correction breakdown
 */
function comprehensiveCorrection(
    refDndc, refTemp, refWave, targetTemp, targetWave,
    cauchyA = WAVELENGTH_CAUCHY_DEFAULTS.A,
    cauchyB = WAVELENGTH_CAUCHY_DEFAULTS.B
) {
    const TEMP_COEFF = -4e-4;
    // Back-calculate the value at 25 °C from the reference conditions
    const at25 = refDndc / (1 + TEMP_COEFF * (refTemp - 25));
    const tempCorrected = temperatureCorrection(at25, targetTemp);
    const tempContribution = tempCorrected - refDndc;
    const finalDndc = wavelengthCorrection(tempCorrected, refWave, targetWave, cauchyA, cauchyB);
    const waveContribution = finalDndc - tempCorrected;

    return {
        refDndc,
        refTemp,
        refWave,
        tempCorrected,
        tempContribution,
        finalDndc,
        waveContribution,
        cauchyA,
        cauchyB
    };
}

/**
 * Estimate dn/dc via the Lorentz-Lorenz equation (volume-additivity form).
 *
 *   dn/dc = (n_s² + 2)² / (6·n_s) × [f(n_p) − f(n_s)] / ρ_p,
 *   where f(n) = (n² − 1) / (n² + 2)
 *
 * Under the volume-additivity assumption both refraction terms are divided by
 * the polymer density (the solvent volume displaced per gram of polymer is
 * 1/ρ_p), so `densitySolvent` does not enter the formula.
 *
 * @param {number} nPolymer - Refractive index of the polymer
 * @param {number} nSolvent - Refractive index of the solvent
 * @param {number} densityPolymer - Density of the polymer (g/mL), ≈ 1/v̄
 * @param {number} [densitySolvent] - Density of the solvent (g/mL); kept for
 *        API compatibility, unused under the volume-additivity assumption
 * @returns {number} Estimated dn/dc (mL/g)
 */
function lorentzLorenz(nPolymer, nSolvent, densityPolymer, densitySolvent) {
    if (!(densityPolymer > 0)) {
        throw new Error('聚合物密度必須大於 0 g/mL。');
    }
    const n0Sq = nSolvent ** 2;
    const npSq = nPolymer ** 2;
    const prefactor = (n0Sq + 2) ** 2 / (6.0 * nSolvent);
    const fPolymer = (npSq - 1) / (npSq + 2);
    const fSolvent = (n0Sq - 1) / (n0Sq + 2);
    return prefactor * (fPolymer - fSolvent) / densityPolymer;
}

/**
 * Estimate dn/dc via the Gladstone-Dale approximation.
 *
 *   dn/dc = (n_p − n_s) / ρ_p   [mL/g]
 *
 * @param {number} nPolymer - Refractive index of the polymer
 * @param {number} nSolvent - Refractive index of the solvent
 * @param {number} densityPolymer - Density of the polymer (g/mL), ≈ 1/v̄
 * @returns {number} Estimated dn/dc (mL/g)
 */
function gladstoneDale(nPolymer, nSolvent, densityPolymer) {
    if (!(densityPolymer > 0)) {
        throw new Error('聚合物密度必須大於 0 g/mL。');
    }
    return (nPolymer - nSolvent) / densityPolymer;
}

/**
 * Estimate apparent molecular weight from static light scattering data.
 *
 * @param {number} dndc - dn/dc value (mL/g)
 * @param {number} intensity - Scattered intensity (arbitrary or absolute units)
 * @param {number} concentration - Sample concentration (g/mL)
 * @param {number} wavelengthNm - Laser wavelength (nm)
 * @param {number} nSolvent - Solvent refractive index
 * @returns {number} Estimated molecular weight (Da)
 */
function estimateMolecularWeight(dndc, intensity, concentration, wavelengthNm, nSolvent) {
    const wavelengthCm = wavelengthNm * 1e-7;
    const NA = 6.022e23;
    const kConstant = 4.0 * Math.PI ** 2 * nSolvent ** 2 * dndc ** 2
        / (NA * wavelengthCm ** 4);
    return intensity / (kConstant * concentration);
}

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

/**
 * Apply baseline correction to a signal.
 *
 * @param {number[]} time - Time axis array
 * @param {number[]} signal - Raw signal array (same length as time)
 * @param {string} mode - "const" for constant offset, "linear" for linear baseline
 * @param {boolean[]} bl1Mask - Boolean mask for the first baseline window
 * @param {boolean[]} bl2Mask - Boolean mask for the second baseline window
 * @returns {number[]} Baseline-corrected signal (new array)
 */
function baselineCorrect(time, signal, mode, bl1Mask, bl2Mask) {
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

/**
 * Measure a peak using one of three modes.
 *
 * @param {number[]} correctedSignal - Baseline-corrected signal
 * @param {number[]} time - Time axis
 * @param {boolean[]} peakMask - Boolean mask for the peak region
 * @param {string} mode - "height", "area", or "spi" (single-point interpolation)
 * @returns {object} { value, mode, peakHeight, peakArea, spi }
 */
function measurePeak(correctedSignal, time, peakMask, mode) {
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
// Signal Alignment (Time-Lag Estimation)
// ============================================================

/**
 * Normalize an array to zero mean, unit standard deviation.
 * Returns a new array.
 *
 * @param {number[]} arr - Input array
 * @returns {number[]} Normalized array
 */
function _normalize(arr) {
    const n = arr.length;
    if (n === 0) { return []; }
    let sum = 0;
    for (let i = 0; i < n; i++) { sum += arr[i]; }
    const mean = sum / n;
    let ssq = 0;
    for (let i = 0; i < n; i++) { ssq += (arr[i] - mean) ** 2; }
    const std = Math.sqrt(ssq / n) || 1;
    return arr.map(v => (v - mean) / std);
}

/**
 * Compute Pearson correlation coefficient between two arrays.
 *
 * @param {number[]} a - First array
 * @param {number[]} b - Second array
 * @returns {number} Pearson r
 */
function _pearsonCorrelation(a, b) {
    const n = a.length;
    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const meanA = sumA / n;
    const meanB = sumB / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
        const dA = a[i] - meanA;
        const dB = b[i] - meanB;
        num += dA * dB;
        denA += dA * dA;
        denB += dB * dB;
    }
    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : num / den;
}

/**
 * Compute cross-correlation between two signals at a specific lag.
 * The reference signal is shifted by `lag` points.
 *
 * @param {number[]} ref - Reference signal (normalized)
 * @param {number[]} target - Target signal (normalized)
 * @param {number} lag - Integer lag (positive = ref shifted right)
 * @returns {number} Cross-correlation value
 */
function _crossCorrelationAtLag(ref, target, lag) {
    const n = ref.length;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
        const j = i - lag;
        if (j >= 0 && j < n) {
            sum += ref[j] * target[i];
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
}

/**
 * Shift a signal by `lag` points. Positive lag shifts right,
 * filling with the edge value.
 *
 * @param {number[]} signal - Input signal
 * @param {number} lag - Integer shift amount
 * @returns {number[]} New shifted signal
 */
function _shiftSignal(signal, lag) {
    return shiftArray(signal, lag);
}

/**
 * Median of an array (does not mutate the input).
 *
 * @param {number[]} arr - Input array
 * @returns {number} Median value (0 for an empty array)
 */
function _median(arr) {
    if (arr.length === 0) { return 0; }
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

/**
 * Population standard deviation of an array.
 *
 * @param {number[]} arr - Input array
 * @returns {number} Standard deviation (0 for an empty array)
 */
function _std(arr) {
    const n = arr.length;
    if (n === 0) { return 0; }
    let sum = 0;
    for (let i = 0; i < n; i++) { sum += arr[i]; }
    const mean = sum / n;
    let ssq = 0;
    for (let i = 0; i < n; i++) { ssq += (arr[i] - mean) ** 2; }
    return Math.sqrt(ssq / n);
}

/**
 * Build a fully populated alignment-info object.
 * Every caller receives the same shape so the UI never has to guess.
 * A skipped alignment reports method 'none' — no strategy was actually run.
 *
 * @param {object} fields - Partial alignment info
 * @returns {object} { lag, correlation, method, strategy, skipped, clamped, reason }
 */
function _alignmentInfo({ lag = 0, correlation = 0, method = 'peak_max', skipped = false, clamped = false, reason = null }) {
    const resolvedMethod = skipped ? 'none' : method;
    return { lag, correlation, method: resolvedMethod, strategy: resolvedMethod, skipped, clamped, reason };
}

/**
 * Compute the optimal time lag between a reference and target signal.
 *
 * Three strategies are available:
 *  - "peak_max": align by the index of maximum absolute deviation from the
 *    signal's own median (so a non-zero offset does not bias the peak search)
 *  - "regional": cross-correlation within a masked region
 *  - "global": cross-correlation over the full signals
 *
 * Guard rails: a constant (or all-zero) reference signal carries no timing
 * information, and a lag beyond `maxLag` is almost certainly spurious — in
 * both cases lag 0 is returned with `skipped` / `clamped` set, so the caller
 * never silently shifts the peak out of the integration window.
 *
 * @param {number[]} refSignal - Reference signal (e.g. UV)
 * @param {number[]} targetSignal - Target signal (e.g. RI)
 * @param {string} [strategy="peak_max"] - Alignment strategy
 * @param {boolean[]} [mask=null] - Boolean mask for regional strategy
 * @param {number} [maxLag=50] - Maximum lag to search / accept (points)
 * @returns {object} { lag, correlation, method, strategy, skipped, clamped, reason }
 */
function computeTimeLag(refSignal, targetSignal, strategy = "peak_max", mask = null, maxLag = 50) {
    // A constant reference signal (typically an absent UV channel filled with
    // zeros) cannot define a lag.
    if (_std(refSignal) < 1e-12) {
        return _alignmentInfo({
            method: strategy,
            skipped: true,
            reason: 'reference signal is constant'
        });
    }

    if (strategy === "peak_max") {
        // Remove each signal's own median before locating the peak, so a
        // baseline offset does not dominate the |max| search.
        const refMedian = _median(refSignal);
        const tgtMedian = _median(targetSignal);

        let maxRef = -Infinity, idxRef = 0;
        for (let i = 0; i < refSignal.length; i++) {
            const v = Math.abs(refSignal[i] - refMedian);
            if (v > maxRef) { maxRef = v; idxRef = i; }
        }
        let maxTgt = -Infinity, idxTgt = 0;
        for (let i = 0; i < targetSignal.length; i++) {
            const v = Math.abs(targetSignal[i] - tgtMedian);
            if (v > maxTgt) { maxTgt = v; idxTgt = i; }
        }
        const lag = idxTgt - idxRef;

        if (Math.abs(lag) > maxLag) {
            return _alignmentInfo({
                method: strategy,
                clamped: true,
                reason: `lag exceeds maxLag (${lag} > ±${maxLag} pts)`
            });
        }

        const shifted = _shiftSignal(targetSignal, -lag);
        const correlation = _pearsonCorrelation(refSignal, shifted);
        return _alignmentInfo({ lag, correlation, method: strategy });
    }

    // Cross-correlation search (regional or global)
    let ref, tgt;
    if (strategy === "regional" && mask !== null) {
        // Extract masked regions
        ref = [];
        tgt = [];
        for (let i = 0; i < refSignal.length; i++) {
            if (mask[i]) {
                ref.push(refSignal[i]);
                tgt.push(targetSignal[i]);
            }
        }
    } else {
        // Global: use full signals
        ref = refSignal.slice();
        tgt = targetSignal.slice();
    }

    const normRef = _normalize(ref);
    const normTgt = _normalize(tgt);

    let bestLag = 0;
    let bestCorr = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
        const corr = _crossCorrelationAtLag(normRef, normTgt, lag);
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    return _alignmentInfo({ lag: bestLag, correlation: bestCorr, method: strategy });
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

// ============================================================
// Calculator — HPLC & Slice dn/dc
// ============================================================

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
 * Decide whether auto-alignment is meaningful and, if so, apply it.
 *
 * Alignment is skipped when a manual concentration is supplied (the UV trace
 * is then unused) or when the UV reference is constant/absent — in those cases
 * a bogus lag would shift the RI peak out of the integration window and
 * silently produce dn/dc = 0.
 *
 * @param {number[]} uvSignal - UV reference signal
 * @param {number[]} riSignal - RI signal (already delay-corrected)
 * @param {number|null|undefined} manualC - Manual concentration override
 * @param {number} [maxLag=50] - Maximum acceptable lag (points)
 * @returns {{alignmentInfo: object, riAligned: number[]}}
 */
function _resolveAlignment(uvSignal, riSignal, manualC, maxLag = 50) {
    if (manualC !== null && manualC !== undefined) {
        return {
            alignmentInfo: _alignmentInfo({
                skipped: true,
                reason: 'manual concentration supplied — UV signal is not used'
            }),
            riAligned: riSignal
        };
    }

    const info = computeTimeLag(uvSignal, riSignal, 'peak_max', null, maxLag);
    if (info.skipped || info.clamped) {
        return { alignmentInfo: info, riAligned: riSignal };
    }
    return { alignmentInfo: info, riAligned: _shiftSignal(riSignal, -info.lag) };
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
        riCorrected: riBaselineCorrected
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
        riCorrected: riBaselineCorrected
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
    computeSliceDndc
});
