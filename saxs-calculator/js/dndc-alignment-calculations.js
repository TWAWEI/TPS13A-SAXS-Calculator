/**
 * TPS13A SAXS Calculator - UV／RI 時間延遲估計與對齊，含 _resolveAlignment（對應 Python alignment.py）
 *
 * 2026-10-14 從 dndc-calculations.js 純搬移拆出。頂層宣告（函式與常數）在全域作用域，由 dndc-calculations.js 結尾的匯出區塊
 * 在載入期讀取，所以本檔必須排在 dndc-calculations.js 之前（tests/structure.test.js 檢查）。
 * 注意：私有函式 _resolveAlignment 由 dndc-calculations.js 直接呼叫（共用全域作用域），改名或移動時要一起改。
 */

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
