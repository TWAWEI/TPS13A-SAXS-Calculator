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

    /**
     * 扣背景：以 loaded 的波長格點為準，blank 內插後相減。
     * loaded 超出 blank 範圍的點捨棄（計入 dropped）。重疊 < MIN_OVERLAP_POINTS → throw。
     *
     * @param {{wavelength:number[], absorbance:number[]}} loaded - 含藥光譜
     * @param {{wavelength:number[], absorbance:number[]}} blank - 空白脂質體光譜
     * @returns {{wavelength:number[], absorbance:number[], dropped:number}}
     */
    function subtractSpectra(loaded, blank) {
        assertCurve(loaded, 'wavelength', 'absorbance', '含藥光譜');
        assertCurve(blank, 'wavelength', 'absorbance', '空白光譜');
        const bw = blank.wavelength;
        const ba = blank.absorbance;
        const lo = bw[0];
        const hi = bw[bw.length - 1];
        const wavelength = [];
        const absorbance = [];
        let dropped = 0;
        loaded.wavelength.forEach((w, k) => {
            if (!inRange(w, lo, hi)) { dropped += 1; return; }
            wavelength.push(w);
            absorbance.push(loaded.absorbance[k] - interpolateLinear(bw, ba, w));
        });
        if (wavelength.length < DEFAULTS.MIN_OVERLAP_POINTS) {
            throw new Error(`兩條光譜的波長重疊只有 ${wavelength.length} 點，至少需要 ${DEFAULTS.MIN_OVERLAP_POINTS} 點`);
        }
        return Object.freeze({
            wavelength: Object.freeze(wavelength),
            absorbance: Object.freeze(absorbance),
            dropped,
        });
    }

    /**
     * 讀取指定波長的吸光度（線性內插）。任一波長超出範圍 → throw。
     * @param {{wavelength:number[], absorbance:number[]}} spectrum
     * @param {number[]} wavelengthsNm
     * @returns {number[]}
     */
    function absorbanceAt(spectrum, wavelengthsNm) {
        assertCurve(spectrum, 'wavelength', 'absorbance', '光譜');
        const ws = spectrum.wavelength;
        const lo = ws[0];
        const hi = ws[ws.length - 1];
        return wavelengthsNm.map((w) => {
            assertFinite(w, '讀值波長');
            if (!inRange(w, lo, hi)) throw new Error(`波長 ${w} nm 超出光譜範圍 ${lo}–${hi} nm`);
            return interpolateLinear(ws, spectrum.absorbance, w);
        });
    }

    /**
     * 純 DOX 縮放擬合：在 fitMin–fitMax 內求最小平方 k，使 blank + k·pure ≈ loaded。
     * k = Σ[(L−B)·P] / Σ(P²)。model 與 residual 覆蓋三條光譜的整段重疊範圍。
     *
     * @returns {{k:number, rms:number, n:number,
     *            model:{wavelength:number[], absorbance:number[]},
     *            residual:{wavelength:number[], absorbance:number[]}}}
     */
    function fitPureDoxScale(loaded, blank, pure, options = {}) {
        const fitMin = options.fitMin ?? DEFAULTS.FIT_MIN_NM;
        const fitMax = options.fitMax ?? DEFAULTS.FIT_MAX_NM;
        assertCurve(loaded, 'wavelength', 'absorbance', '含藥光譜');
        assertCurve(blank, 'wavelength', 'absorbance', '空白光譜');
        assertCurve(pure, 'wavelength', 'absorbance', '純 DOX 光譜');
        assertFinite(fitMin, '擬合下限');
        assertFinite(fitMax, '擬合上限');
        if (!(fitMax > fitMin)) throw new Error(`擬合範圍上限必須大於下限（目前 ${fitMin}–${fitMax}）`);

        const bw = blank.wavelength;
        const pw = pure.wavelength;
        const lo = Math.max(bw[0], pw[0]);
        const hi = Math.min(bw[bw.length - 1], pw[pw.length - 1]);

        const wavelength = [];
        const L = [];
        const B = [];
        const P = [];
        loaded.wavelength.forEach((w, k) => {
            if (!inRange(w, lo, hi)) return;
            wavelength.push(w);
            L.push(loaded.absorbance[k]);
            B.push(interpolateLinear(bw, blank.absorbance, w));
            P.push(interpolateLinear(pw, pure.absorbance, w));
        });

        let num = 0;
        let den = 0;
        let n = 0;
        wavelength.forEach((w, j) => {
            if (!inRange(w, fitMin, fitMax)) return;
            num += (L[j] - B[j]) * P[j];
            den += P[j] * P[j];
            n += 1;
        });
        if (n < DEFAULTS.MIN_FIT_POINTS) {
            throw new Error(`擬合範圍 ${fitMin}–${fitMax} nm 內只有 ${n} 點，至少需要 ${DEFAULTS.MIN_FIT_POINTS} 點`);
        }
        if (!(den > 0)) throw new Error('純 DOX 光譜在擬合範圍內全為 0，無法縮放');

        const k = num / den;
        const model = B.map((b, j) => b + k * P[j]);
        const residual = L.map((l, j) => l - model[j]);
        let ss = 0;
        wavelength.forEach((w, j) => {
            if (inRange(w, fitMin, fitMax)) ss += residual[j] * residual[j];
        });

        return Object.freeze({
            k,
            rms: Math.sqrt(ss / n),
            n,
            model: Object.freeze({ wavelength: Object.freeze(wavelength), absorbance: Object.freeze(model) }),
            residual: Object.freeze({ wavelength: Object.freeze(wavelength), absorbance: Object.freeze(residual) }),
        });
    }

    global.LiposomeCalculations = Object.freeze({
        DEFAULTS,
        interpolateLinear,
        sampleStd,
        computeDilutionFactor,
        subtractSpectra,
        absorbanceAt,
        fitPureDoxScale,
    });
})(typeof window !== 'undefined' ? window : globalThis);
