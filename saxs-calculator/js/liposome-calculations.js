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

    global.LiposomeCalculations = Object.freeze({
        DEFAULTS,
        interpolateLinear,
        sampleStd,
    });
})(typeof window !== 'undefined' ? window : globalThis);
