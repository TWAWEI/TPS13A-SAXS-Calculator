/**
 * TPS13A SAXS Calculator - 偵測器距離（Eiger 9M 行程 2,200–10,000 mm）與 Rg 比較
 *
 * 2026-10-14 從 calculations.js 純搬移拆出。頂層宣告（函式與常數）在全域作用域，由 calculations.js 結尾的匯出區塊
 * 在載入期讀取，所以本檔必須排在 calculations.js 之前（tests/structure.test.js 檢查）。
 */

// ========================
// SAXS Detector Distance Calculation
// 公式來源: TPS13A_protein solution SAXS ID-2024_10_01.xlsm
// 參考: HPLC flow down data 分頁
// ========================

/**
 * 比較實測 Rg 與預測 Rg（偵測器距離面板的「改用實測」提示用）。
 * @param {number} measured - 實測 Rg (Å)
 * @param {number} predicted - 預測 Rg (Å)
 * @returns {{ percent: number, ratio: number }} percent = (measured − predicted)/predicted × 100
 */
function compareRg(measured, predicted) {
    if (!Number.isFinite(measured) || !Number.isFinite(predicted) || predicted <= 0) {
        throw new Error('compareRg: measured 與 predicted 必須是有限數且 predicted > 0');
    }
    const ratio = measured / predicted;
    return { percent: (ratio - 1) * 100, ratio };
}

// Eiger 9M 偵測器實際行程（mm）— 2026-08-22 TPS 13A 光束線確認。
// 注意：Excel 線性模型的 BSA 錨點 1900 mm 本身就低於下限，所以「建議值低於行程」是常態。
const DETECTOR_SD_MIN_MM = 2200;
const DETECTOR_SD_MAX_MM = 10000;

/**
 * 計算 SAXS 偵測器建議距離
 * 根據蛋白質 MW 或 Rg 計算最佳的樣本到偵測器距離 (Sample-Detector distance)
 * 
 * @param {number} mwOrRg - 分子量 (Da) 或 Rg (Å)
 * @param {string} inputType - 'mw' 或 'rg'，指定輸入類型
 * @returns {object} 偵測器距離計算結果
 * 
 * 公式說明 (基於 TPS13A 實測數據擬合，用於偵測器距離估算):
 *   - Rg = 0.6914 × MW^(1/3) (BSA 校正，球狀蛋白 cube-root scaling)
 *   - qmin = 0.224 / Rg (基於 BSA: Rg=28, qmin=0.008)
 *   - 9M SD = 67.857 × Rg (基於 BSA: Rg=28, SD=1900)
 *   注意：此處 Rg 公式與 SAXS 理論頁面的 Rg = 0.251 × MW^0.43 不同，
 *   因為本函數是專門為偵測器距離估算而用 TPS13A 實測數據校正的。
 * 
 * 參考數據 (from Excel):
 *   BSA monomer: MW=66500, Rg=28 Å, qmin=0.008 Å⁻¹, 9M SD=1900 mm
 *   BSA dimer: MW=130000, Rg=35.01 Å, qmin=0.0064 Å⁻¹, 9M SD=2376 mm
 *   Cytc: MW=12700, Rg=16.12 Å, qmin=0.0139 Å⁻¹, 9M SD=1094 mm
 *   Target: MW=900000, Rg=66.73 Å, qmin=0.003357 Å⁻¹, 9M SD=4528 mm
 */
function calculateDetectorDistance(mwOrRg, inputType = 'mw') {
    // Calibration constants from BSA monomer (MW=66500, Rg=28)
    const BSA_MW = 66500;
    const BSA_RG = 28;
    const BSA_SD = 1900;   // mm
    const BSA_QMIN = 0.008; // Å⁻¹

    // Derived coefficients
    // Rg = k × MW^(1/3) where k = BSA_RG / BSA_MW^(1/3) = 28 / 40.54 = 0.6906
    const RG_COEFF = BSA_RG / Math.pow(BSA_MW, 1 / 3);  // ≈ 0.6906

    // qmin = c1 / Rg where c1 = BSA_QMIN × BSA_RG = 0.008 × 28 = 0.224
    const QMIN_COEFF = BSA_QMIN * BSA_RG;  // = 0.224

    // SD = c2 × Rg where c2 = BSA_SD / BSA_RG = 1900 / 28 = 67.857
    const SD_COEFF = BSA_SD / BSA_RG;  // ≈ 67.857

    let rg, mw;

    if (inputType === 'mw') {
        mw = mwOrRg;
        // Rg = k × MW^(1/3) (cube root scaling for spherical proteins)
        rg = RG_COEFF * Math.pow(mw, 1 / 3);
    } else {
        rg = mwOrRg;
        // Reverse calculate MW from Rg
        mw = Math.pow(rg / RG_COEFF, 3);
    }

    // qmin 計算: qmin = 0.224 / Rg
    const qmin = QMIN_COEFF / rg;

    // 建議偵測器距離: SD = 67.857 × Rg
    const suggestedSD = SD_COEFF * rg;

    // 顯示精度先定案，行程判斷與夾限後的 qmin 都用這組值，畫面與提示才不會互相打架
    const rgRounded = parseFloat(rg.toFixed(2));
    const qminRounded = parseFloat(qmin.toFixed(6));
    const sdRounded = parseFloat(suggestedSD.toFixed(0));

    // 9M 行程夾限：建議值本身不夾（照 Excel 模型顯示），只補「夾到極限後實際可達的 qmin」。
    // qmin ∝ 1/SD ⇒ 距離被迫縮短時 qmin 變大（Guinier 區變窄），變長時 qmin 變小。
    const sdStatus = sdRounded < DETECTOR_SD_MIN_MM ? 'below'
        : sdRounded > DETECTOR_SD_MAX_MM ? 'above'
            : 'ok';
    const sdLimit = sdStatus === 'below' ? DETECTOR_SD_MIN_MM
        : sdStatus === 'above' ? DETECTOR_SD_MAX_MM
            : null;
    const qminAtLimit = sdLimit === null ? null
        : parseFloat((qminRounded * sdRounded / sdLimit).toFixed(6));
    const qRgAtLimit = qminAtLimit === null ? null
        : parseFloat((qminAtLimit * rgRounded).toFixed(3));

    return {
        mw: parseFloat(mw.toFixed(0)),
        rg: rgRounded,
        qmin: qminRounded,
        suggestedSD: sdRounded,
        suggestedSDMeters: parseFloat((suggestedSD / 1000).toFixed(2)),
        referenceProtein: 'BSA monomer',
        referenceRg: BSA_RG,
        referenceSD: BSA_SD,
        sdStatus,        // 'ok' | 'below' | 'above'
        sdLimit,         // 被夾到的極限 (mm)，ok 時為 null
        qminAtLimit,     // 夾到極限時可達的 qmin (Å⁻¹)，ok 時為 null
        qRgAtLimit       // qminAtLimit × Rg（BSA 基準 0.224），ok 時為 null
    };
}
