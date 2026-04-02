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
 * Apply wavelength correction using the λ⁻² dispersion relation.
 *
 * @param {number} dndcRef - dn/dc at the reference wavelength (mL/g)
 * @param {number} refWavelength - Reference wavelength (nm)
 * @param {number} targetWavelength - Target wavelength (nm)
 * @returns {number} Wavelength-corrected dn/dc
 */
function wavelengthCorrection(dndcRef, refWavelength, targetWavelength) {
    return dndcRef * (refWavelength / targetWavelength) ** 2;
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
 * @returns {object} Correction breakdown
 */
function comprehensiveCorrection(refDndc, refTemp, refWave, targetTemp, targetWave) {
    const TEMP_COEFF = -4e-4;
    // Back-calculate the value at 25 °C from the reference conditions
    const at25 = refDndc / (1 + TEMP_COEFF * (refTemp - 25));
    const tempCorrected = temperatureCorrection(at25, targetTemp);
    const tempContribution = tempCorrected - refDndc;
    const finalDndc = wavelengthCorrection(tempCorrected, refWave, targetWave);
    const waveContribution = finalDndc - tempCorrected;

    return {
        refDndc,
        refTemp,
        refWave,
        tempCorrected,
        tempContribution,
        finalDndc,
        waveContribution
    };
}

/**
 * Estimate dn/dc via the Lorentz-Lorenz equation.
 *
 * @param {number} nPolymer - Refractive index of the polymer
 * @param {number} nSolvent - Refractive index of the solvent
 * @param {number} densityPolymer - Density of the polymer (g/mL)
 * @param {number} densitySolvent - Density of the solvent (g/mL)
 * @returns {number} Estimated dn/dc (mL/g)
 */
function lorentzLorenz(nPolymer, nSolvent, densityPolymer, densitySolvent) {
    const n0Sq = nSolvent ** 2;
    const npSq = nPolymer ** 2;
    const prefactor = (n0Sq + 2) ** 2 / (6.0 * nSolvent);
    const rPolymer = (npSq - 1) / ((npSq + 2) * densityPolymer);
    const rSolvent = (n0Sq - 1) / ((n0Sq + 2) * densitySolvent);
    return prefactor * (rPolymer - rSolvent);
}

/**
 * Estimate dn/dc via the Gladstone-Dale approximation.
 *
 * @param {number} polymerRefraction - Specific refraction of the polymer
 * @param {number} solventRefraction - Specific refraction of the solvent
 * @returns {number} Estimated dn/dc
 */
function gladstoneDale(polymerRefraction, solventRefraction) {
    return polymerRefraction - solventRefraction;
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

    if (combinedIndices.length === 0) {
        throw new Error("Baseline windows are empty — no data points in the selected range.");
    }

    if (mode === "const") {
        // Constant baseline: subtract the mean of both windows
        let sum = 0;
        for (const idx of combinedIndices) { sum += signal[idx]; }
        const mean = sum / combinedIndices.length;
        return signal.map(v => v - mean);
    }

    // Linear baseline: fit a line through the two window centres
    if (bl1Indices.length === 0 || bl2Indices.length === 0) {
        throw new Error("Linear baseline requires both windows to contain data points.");
    }

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
 * Compute the optimal time lag between a reference and target signal.
 *
 * Three strategies are available:
 *  - "peak_max": align by the index of maximum absolute value
 *  - "regional": cross-correlation within a masked region
 *  - "global": cross-correlation over the full signals
 *
 * @param {number[]} refSignal - Reference signal (e.g. UV)
 * @param {number[]} targetSignal - Target signal (e.g. RI)
 * @param {string} [strategy="peak_max"] - Alignment strategy
 * @param {boolean[]} [mask=null] - Boolean mask for regional strategy
 * @param {number} [maxLag=50] - Maximum lag to search (points)
 * @returns {object} { lag, correlation, strategy }
 */
function computeTimeLag(refSignal, targetSignal, strategy = "peak_max", mask = null, maxLag = 50) {
    if (strategy === "peak_max") {
        // Find index of maximum absolute value in each signal
        let maxRef = 0, idxRef = 0;
        for (let i = 0; i < refSignal.length; i++) {
            const v = Math.abs(refSignal[i]);
            if (v > maxRef) { maxRef = v; idxRef = i; }
        }
        let maxTgt = 0, idxTgt = 0;
        for (let i = 0; i < targetSignal.length; i++) {
            const v = Math.abs(targetSignal[i]);
            if (v > maxTgt) { maxTgt = v; idxTgt = i; }
        }
        const lag = idxTgt - idxRef;
        const shifted = _shiftSignal(targetSignal, -lag);
        const correlation = _pearsonCorrelation(refSignal, shifted);
        return { lag, correlation, strategy };
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

    return { lag: bestLag, correlation: bestCorr, strategy };
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
 * Apply the RI detector delay by shifting the RI signal.
 *
 * @param {number[]} riSignal - RI detector signal
 * @param {number[]} time - Time axis
 * @param {number} riDelay - RI delay in time units (e.g. minutes)
 * @returns {number[]} Delay-corrected RI signal (new array)
 */
function _applyRiDelay(riSignal, time, riDelay) {
    if (riDelay === 0) { return riSignal.slice(); }
    // Convert time-based delay to number of points
    const dt = time.length > 1 ? (time[time.length - 1] - time[0]) / (time.length - 1) : 1;
    const pts = Math.round(riDelay / dt);
    return shiftArray(riSignal, pts);
}

/**
 * Compute concentration from UV absorbance via Beer-Lambert law.
 *
 * C = A / (ε × l)
 *
 * @param {number[]} uvSignal - UV absorbance signal
 * @param {number} epsilon - Molar absorptivity / extinction coefficient
 * @param {number} pathLen - Optical path length (cm)
 * @returns {number[]} Concentration array (same units as ε implies)
 */
function _computeConcentration(uvSignal, epsilon, pathLen) {
    const factor = epsilon * pathLen;
    if (factor === 0) {
        throw new Error("epsilon × pathLen must not be zero.");
    }
    return uvSignal.map(a => a / factor);
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
 * @param {number} params.epsilon - Extinction coefficient
 * @param {number} params.pathLen - Path length (cm)
 * @param {number} params.riFactor - RI calibration factor (RI units per Δn)
 * @param {number} params.riDelay - RI detector delay (time units)
 * @param {string} params.baselineMode - "const" or "linear"
 * @param {string} params.peakMode - "height", "area", or "spi"
 * @param {number|null} params.manualC - Manual concentration override (if provided)
 * @param {boolean} params.autoAlign - Whether to auto-align UV and RI
 * @param {number} params.decimalPlaces - Rounding precision
 * @returns {object} Calculation result
 */
function computeHplcDndc(time, uvSignal, riSignal, params) {
    const {
        peakStart, peakEnd,
        bl1Start, bl1End, bl2Start, bl2End,
        epsilon, pathLen, riFactor, riDelay,
        baselineMode, peakMode,
        manualC, autoAlign, decimalPlaces
    } = params;

    // Build masks
    const bl1Mask = _createMask(time, bl1Start, bl1End);
    const bl2Mask = _createMask(time, bl2Start, bl2End);
    const peakMask = _createMask(time, peakStart, peakEnd);

    // Apply RI delay
    let riCorrected = _applyRiDelay(riSignal, time, riDelay);

    // Auto-align if requested
    let alignmentInfo = null;
    if (autoAlign) {
        alignmentInfo = computeTimeLag(uvSignal, riCorrected, "peak_max", null, 50);
        riCorrected = _shiftSignal(riCorrected, -alignmentInfo.lag);
    }

    // Baseline correction
    const uvCorrected = baselineCorrect(time, uvSignal, baselineMode, bl1Mask, bl2Mask);
    const riBaselineCorrected = baselineCorrect(time, riCorrected, baselineMode, bl1Mask, bl2Mask);

    // Peak measurement on RI signal
    const riPeak = measurePeak(riBaselineCorrected, time, peakMask, peakMode);
    const riValue = riPeak.value / riFactor;

    // Concentration from UV
    let concentration;
    if (manualC !== null && manualC !== undefined) {
        concentration = manualC;
    } else {
        const concArray = _computeConcentration(uvCorrected, epsilon, pathLen);
        const uvPeak = measurePeak(concArray, time, peakMask, peakMode);
        concentration = uvPeak.value;
    }

    // dn/dc
    const dndc = concentration !== 0 ? riValue / concentration : 0;

    return {
        dndc: parseFloat(dndc.toFixed(decimalPlaces || 6)),
        riPeakValue: riPeak.value,
        riValue,
        concentration,
        peakMode,
        baselineMode,
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
 * @returns {object} Slice-based dn/dc result
 */
function computeSliceDndc(time, uvSignal, riSignal, params, minUvFraction = 0.05) {
    const {
        peakStart, peakEnd,
        bl1Start, bl1End, bl2Start, bl2End,
        epsilon, pathLen, riFactor, riDelay,
        baselineMode,
        autoAlign, decimalPlaces
    } = params;

    // Build masks
    const bl1Mask = _createMask(time, bl1Start, bl1End);
    const bl2Mask = _createMask(time, bl2Start, bl2End);
    const peakMask = _createMask(time, peakStart, peakEnd);

    // Apply RI delay
    let riCorrected = _applyRiDelay(riSignal, time, riDelay);

    // Auto-align if requested
    let alignmentInfo = null;
    if (autoAlign) {
        alignmentInfo = computeTimeLag(uvSignal, riCorrected, "peak_max", null, 50);
        riCorrected = _shiftSignal(riCorrected, -alignmentInfo.lag);
    }

    // Baseline correction
    const uvCorrected = baselineCorrect(time, uvSignal, baselineMode, bl1Mask, bl2Mask);
    const riBaselineCorrected = baselineCorrect(time, riCorrected, baselineMode, bl1Mask, bl2Mask);

    // Concentration array from UV
    const concArray = _computeConcentration(uvCorrected, epsilon, pathLen);

    // Find peak-region max UV for thresholding
    let maxUv = 0;
    for (let i = 0; i < uvCorrected.length; i++) {
        if (peakMask[i] && Math.abs(uvCorrected[i]) > maxUv) {
            maxUv = Math.abs(uvCorrected[i]);
        }
    }
    const uvThreshold = maxUv * minUvFraction;

    // Collect slice data
    const sliceConcentrations = [];
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
        sliceRiValues.push(ri);
        sliceTimes.push(time[i]);
        sliceDndcValues.push(ri / c);
    }

    // Linear fit: RI vs concentration → slope = dn/dc
    let fitResult = null;
    let dndc = 0;
    if (sliceConcentrations.length >= 2) {
        fitResult = linearFit(sliceConcentrations, sliceRiValues);
        dndc = fitResult.dnDc;
    } else if (sliceDndcValues.length === 1) {
        dndc = sliceDndcValues[0];
    }

    return {
        dndc: parseFloat(dndc.toFixed(decimalPlaces || 6)),
        fitResult,
        sliceCount: sliceConcentrations.length,
        sliceConcentrations,
        sliceRiValues,
        sliceTimes,
        sliceDndcValues,
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
