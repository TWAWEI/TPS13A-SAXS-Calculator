/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥量（D/L）純計算模組
 *
 * 對應本地 Excel「Liposome DOX-loading calculation-Bypass.xlsx」：
 *   dilution 工作表 → computeDilutionFactor（q 視窗內 I_bypass / I_solution 的平均）
 *   DL 工作表       → computeDrugToLipid（A(495) / (ε·l) ÷ (c_lipid × 稀釋因子)）
 * 加上 Excel 沒做的 UV 扣背景（subtractSpectra）與純 DOX 縮放擬合（fitPureDoxScale）。
 *
 * 設計規則（規格 §4）：
 *   - 純函式、無 DOM、不改動輸入；回傳物件一律 Object.freeze
 *   - 內部單位：濃度 M、長度 cm、q Å⁻¹、波長 nm；mM ↔ M 只在 UI 層換算
 *   - 算不出就 throw 中文訊息，絕不回 0 / NaN
 *
 * IIFE：內部識別字不進全域（classic <script> 共用作用域，tests/structure.test.js 會盯）。
 */
(function attachLiposomeCalculations(global) {
    'use strict';

    const DEFAULTS = Object.freeze({
        Q_MIN: 0.1,                       // Å⁻¹，Excel dilution 頁與操作說明
        Q_MAX: 0.15,
        MIN_WINDOW_POINTS: 5,
        EPSILON_DOX: 9250,                // L·mol⁻¹·cm⁻¹ @495 nm，Lee et al., Int. J. Nanomed. 20 (2025) 6357–6378
        PATH_CM: 0.2,                     // SAXS 毛細管厚度
        WAVELENGTHS_NM: Object.freeze([494, 495, 496]),
        PRIMARY_INDEX: 1,                 // Excel J 欄只用 495 nm
        PRIMARY_WAVELENGTH_NM: 495,
        FIT_MIN_NM: 450,
        FIT_MAX_NM: 550,
        MIN_FIT_POINTS: 10,
        MIN_OVERLAP_POINTS: 10,
        LSQ_WARN_REL: 0.05,
    });

    function assertFinite(value, label) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`${label} 必須是有限數值（目前：${String(value)}）`);
        }
    }

    function assertPositive(value, label) {
        assertFinite(value, label);
        if (value <= 0) throw new Error(`${label} 必須大於 0（目前：${value}）`);
    }

    /**
     * 樣本標準差（n − 1，Excel STDEV.S）。n < 2 回 0。
     * @param {number[]} values
     * @returns {number}
     */
    function sampleStd(values) {
        const n = values.length;
        if (n < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / n;
        const ss = values.reduce((a, v) => a + (v - mean) * (v - mean), 0);
        return Math.sqrt(ss / (n - 1));
    }

    function mean(values) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    /**
     * 線性內插。xs 必須嚴格遞增；x 超出 [xs[0], xs[last]] → throw。
     * 二分搜尋找區間，剛好落在格點上時直接回傳格點值（避免浮點誤差）。
     * @param {number[]} xs
     * @param {number[]} ys
     * @param {number} x
     * @returns {number}
     */
    function interpolateLinear(xs, ys, x) {
        assertFinite(x, 'x');
        const n = xs.length;
        if (n < 2 || ys.length !== n) throw new Error('內插至少需要 2 個點，且 xs 與 ys 長度相同');
        if (x < xs[0] || x > xs[n - 1]) {
            throw new Error(`x = ${x} 超出範圍 [${xs[0]}, ${xs[n - 1]}]`);
        }
        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid; else hi = mid;
        }
        if (x === xs[lo]) return ys[lo];
        if (x === xs[hi]) return ys[hi];
        const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
        return ys[lo] + t * (ys[hi] - ys[lo]);
    }

    function isStrictlyIncreasing(xs) {
        for (let k = 1; k < xs.length; k++) {
            if (!(xs[k] > xs[k - 1])) return false;
        }
        return true;
    }

    /**
     * 檢查 {xKey: number[], yKey: number[]} 形狀的曲線。
     */
    function assertCurve(curve, xKey, yKey, label) {
        if (!curve || !Array.isArray(curve[xKey]) || !Array.isArray(curve[yKey])) {
            throw new Error(`${label} 缺少 ${xKey} / ${yKey} 陣列`);
        }
        if (curve[xKey].length !== curve[yKey].length) {
            throw new Error(`${label} 的 ${xKey} 與 ${yKey} 長度不一致`);
        }
        if (curve[xKey].length < 2) throw new Error(`${label} 至少需要 2 個點`);
        if (!isStrictlyIncreasing(curve[xKey])) throw new Error(`${label} 的 ${xKey} 必須嚴格遞增`);
    }

    function inRange(x, lo, hi) {
        return x >= lo && x <= hi;
    }

    /**
     * 稀釋因子：q 視窗內 I_bypass / I_solution 的逐點比值平均（Excel dilution 頁），
     * bypass 先線性內插到 solution 的 q 格點。另回最小平方縮放（PRIMUS I Scale 等價式）供對照。
     *
     * @param {{q:number[], i:number[]}} solution - solution cell 曲線（q 嚴格遞增）
     * @param {{q:number[], i:number[]}} bypass - bypass 曲線
     * @param {{qMin?:number, qMax?:number}} [options]
     * @returns {{factor:number, sd:number, n:number, lsqScale:number,
     *            excluded:{outOfRange:number, nonPositive:number}, ratios:number[], q:number[]}}
     */
    function computeDilutionFactor(solution, bypass, options = {}) {
        const qMin = options.qMin ?? DEFAULTS.Q_MIN;
        const qMax = options.qMax ?? DEFAULTS.Q_MAX;
        assertCurve(solution, 'q', 'i', 'solution cell 曲線');
        assertCurve(bypass, 'q', 'i', 'bypass 曲線');
        assertFinite(qMin, 'q 下限');
        assertFinite(qMax, 'q 上限');
        if (!(qMax > qMin)) throw new Error(`q 視窗上限必須大於下限（目前 ${qMin}–${qMax}）`);

        const bq = bypass.q;
        const bi = bypass.i;
        const bLo = bq[0];
        const bHi = bq[bq.length - 1];
        let outOfRange = 0;
        let nonPositive = 0;
        const q = [];
        const iSol = [];
        const iByp = [];

        solution.q.forEach((qk, k) => {
            if (!inRange(qk, qMin, qMax)) return;
            if (!inRange(qk, bLo, bHi)) { outOfRange += 1; return; }
            const s = solution.i[k];
            const b = interpolateLinear(bq, bi, qk);
            if (!(s > 0) || !(b > 0)) { nonPositive += 1; return; }
            q.push(qk);
            iSol.push(s);
            iByp.push(b);
        });

        if (q.length < DEFAULTS.MIN_WINDOW_POINTS) {
            throw new Error(`q 視窗 ${qMin}–${qMax} Å⁻¹ 內只有 ${q.length} 個有效點，至少需要 ${DEFAULTS.MIN_WINDOW_POINTS} 個`);
        }

        const ratios = iSol.map((s, k) => iByp[k] / s);
        const num = iSol.reduce((acc, s, k) => acc + s * iByp[k], 0);
        const den = iSol.reduce((acc, s) => acc + s * s, 0);

        return Object.freeze({
            factor: mean(ratios),
            sd: sampleStd(ratios),
            n: ratios.length,
            lsqScale: num / den,
            excluded: Object.freeze({ outOfRange, nonPositive }),
            ratios: Object.freeze(ratios),
            q: Object.freeze(q),
        });
    }

    global.LiposomeCalculations = Object.freeze({
        DEFAULTS,
        interpolateLinear,
        sampleStd,
        computeDilutionFactor,
    });
})(typeof window !== 'undefined' ? window : globalThis);
