/**
 * TPS13A SAXS Calculator - Core Calculations Module
 * SAXS 理論值（I(0)、Rg、Dmax、Porod）＋ window.SAXSCalculations 匯出。
 *
 * 2026-10-14 拆檔（純搬移）：離心／樣品／SEC → sample-prep-calculations.js；HPLC-SAXS 步驟與
 * fraction collector → hplc-calculations.js；偵測器距離 → detector-calculations.js。
 * 結尾的匯出區塊在載入期讀取那三個檔的頂層函式，所以它們必須排在本檔之前。
 */

// ========================
// SAXS 結構參數計算
// ========================

// ---- 物理常數 (模組層) ----
const NA_AVOGADRO = 6.022e23;           // 亞佛加德羅常數 (1/mol)
const ELECTRON_RADIUS_CM = 2.818e-13;   // 電子經典半徑 (cm)
const RHO_E_PROTEIN = 0.44;             // 蛋白質平均電子密度 (e/Å³)
const RHO_E_SOLVENT = 0.334;            // 水電子密度 (e/Å³)
const VBAR_PROTEIN_REF = 0.73;          // 蛋白質參考部分比容 (cm³/g)

// 散射長度密度差 (cm⁻²)
// Δρ_e (e/Å³) × 10²⁴ (→ e/cm³) × r_e (cm) ≈ 2.99 × 10¹⁰ cm⁻²
const DELTA_SLD = (RHO_E_PROTEIN - RHO_E_SOLVENT) * 1e24 * ELECTRON_RADIUS_CM;

/**
 * I(0)/(c·MW) for proteins, cm⁻¹/(mg/mL·Da)
 * 第一原理值 (v̄ = 0.73 cm³/g, ρ_e = 0.44 e/Å³) ≈ 7.9 × 10⁻⁷
 * 推導: I(0) = (c/1000) × (MW/NA) × (Δρ_SLD × v̄)²，c 以 mg/mL 代入
 * 與 Excel `Protein_Io_cal_` 的第一原理算法一致
 */
const I0_CONTRAST_FACTOR = Math.pow(DELTA_SLD * VBAR_PROTEIN_REF, 2) / (NA_AVOGADRO * 1000);

/**
 * 計算理論 I(0)
 * 用於與實驗值比較，驗證樣品單分散性
 *
 * 主值 theoreticalI0 一律用經驗式（與 TPS13A 實測 BSA 一致）:
 *   I(0) = c × MW × I0_CONTRAST_FACTOR (≈ 7.9 × 10⁻⁷ cm⁻¹/(mg/mL·Da))
 *   驗算: BSA (66,430 Da) @ 1 mg/mL → 0.0525 cm⁻¹ (實測 0.0526)
 *
 * 有序列組成時另外附上 exactI0 — TPS13A Excel `Protein_Io_cal_` 的第一原理式:
 *   I(0) [cm⁻¹] = n × [r_e × (N_e − ρ_s × V_dry)]²
 *   n     = (c/1000) × NA / MW      分子數密度 (molecules/cm³)
 *   N_e   = 分子總電子數 (由序列組成加總)
 *   V_dry = 乾燥體積 (Å³，Excel 晶體殘基體積表)，ρ_s = 0.334 e/Å³
 *   r_e   = 2.818 × 10⁻¹³ cm
 *   驗算: Excel 範例 (MW 38,536.61、N_e 20,605、V_dry 48,694.7 Å³) @ 1 mg/mL
 *         → 0.0234 cm⁻¹ (Excel N18)
 *   注意: 晶體殘基體積讓 ρ_e 只有 ≈0.42 e/Å³，此式對 BSA 給 0.042，比實測低約
 *         20%——所以只作參考，不當主值（2026-08-21 使用者決定）。
 *
 * v̄ 不是 I(0) 的自由乘數 (過剩電子數已由 N_e − ρ_s·V_dry 決定)，
 * partialSpecificVolume 僅作紀錄，不參與計算。
 *
 * @param {number} mw - 分子量 (Da)
 * @param {number} concentration - 濃度 (mg/mL)
 * @param {object|number} [opts] - 選用參數 (舊版可傳 v̄ 數值，僅作紀錄)
 * @param {number} [opts.electrons] - 分子總電子數 N_e
 * @param {number} [opts.dryVolume] - 乾燥體積 V_dry (Å³)
 * @param {number} [opts.partialSpecificVolume] - 部分比容 (cm³/g)，僅作紀錄
 * @returns {object} 理論 I(0) 計算結果：theoreticalI0（經驗式主值）、exactI0（Excel 精確式，無組成時為 null）
 */
function calculateTheoreticalI0(mw, concentration, opts = {}) {
    // 相容舊簽名 calculateTheoreticalI0(mw, c, vbar)
    const options = (typeof opts === 'number')
        ? { partialSpecificVolume: opts }
        : (opts || {});

    const { electrons, dryVolume } = options;
    const partialSpecificVolume = Number.isFinite(options.partialSpecificVolume)
        ? options.partialSpecificVolume
        : VBAR_PROTEIN_REF;

    const hasComposition = Number.isFinite(electrons) && electrons > 0
        && Number.isFinite(dryVolume) && dryVolume > 0;

    // 主值：經驗式（與實測 BSA 0.0526 cm⁻¹ 一致）
    const theoreticalI0 = concentration * mw * I0_CONTRAST_FACTOR;

    // 參考值：Excel Protein_Io_cal_ 精確式（需序列組成）
    let exactI0 = null;
    let excessElectrons = null;
    if (hasComposition) {
        const numberDensity = (concentration / 1000) * NA_AVOGADRO / mw;  // molecules/cm³
        excessElectrons = electrons - RHO_E_SOLVENT * dryVolume;          // e/molecule
        const excessLength = ELECTRON_RADIUS_CM * excessElectrons;        // cm
        exactI0 = numberDensity * excessLength * excessLength;
    }

    const perConcentration = concentration !== 0 ? theoreticalI0 / concentration : 0;
    const I0_per_c_per_MW = mw !== 0 ? perConcentration / mw : 0;

    return {
        theoreticalI0: theoreticalI0,           // cm⁻¹
        I0_per_concentration: perConcentration, // cm⁻¹/(mg/mL)
        I0_per_c_per_MW: I0_per_c_per_MW,       // cm⁻¹/(mg/mL × Da)
        constant_k: I0_per_c_per_MW,
        method: 'empirical',                    // 主值算法（固定經驗式）
        empiricalI0: theoreticalI0,             // 與 theoreticalI0 相同，保留給既有讀取處
        exactI0: exactI0,                       // cm⁻¹，Excel 精確式；無組成時 null
        electrons: hasComposition ? electrons : null,
        dryVolume: hasComposition ? dryVolume : null,
        excessElectrons: excessElectrons,       // N_e − ρ_s × V_dry
        mw: mw,
        concentration: concentration,
        partialSpecificVolume: partialSpecificVolume
    };
}

/**
 * 從分子量計算理論 Rg (迴旋半徑)
 * 使用 Flory-Kratky 關係式，適用於球狀蛋白質
 * 
 * @param {number} mw - 分子量 (Da)
 * @param {string} proteinType - 蛋白質類型: 'globular', 'unfolded', 'idp'
 * @param {number} [nResidues] - 殘基數 N（unfolded / IDP 分支需要）
 * @returns {object} 理論 Rg 計算結果
 *
 * 經驗公式（注意自變數不同）:
 *   球狀蛋白質 (globular): Rg = 0.251 × MW^0.43   ← MW (Da)
 *   展開蛋白質 (unfolded): Rg = 2.54 × N^0.522    ← N (殘基數)
 *   本質無序蛋白 (IDP):    Rg = 2.49 × N^0.509    ← N (殘基數)
 *
 * 球狀分支來源: TPS13A Excel `Input protein information!M21`
 *   Rg = 10^(0.43·log10(MW/1000) − 0.31) × 10 (Å) ≡ 0.2508 × MW^0.4301
 *   驗算: BSA 66,430 → 29.7 Å；lysozyme 14,313 → 15.4 Å
 *
 * unfolded / IDP 的冪次律以「殘基數」為自變數（不是 Da）；未提供 nResidues 時
 * 以 MW / 110 Da 估算並在回傳物件標記 residueEstimate = true。
 *   驗算: BSA 583 殘基 → unfolded 70.6 Å（若誤用 Da 會得到 836 Å）
 *
 * 參考文獻 (unfolded / IDP 分支):
 *   Fischer et al. (2004) Protein Science
 *   Bernado & Blackledge (2009) Biophys J
 */
function calculateTheoreticalRg(mw, proteinType = 'globular', nResidues = null) {
    const AVG_RESIDUE_MW = 110;  // Da/殘基（一般蛋白質平均）
    const hasResidueCount = Number.isFinite(nResidues) && nResidues > 0;
    const residues = hasResidueCount ? nResidues : Math.round(mw / AVG_RESIDUE_MW);

    let Rg, formula, coefficient, exponent, basis;

    switch (proteinType.toLowerCase()) {
        case 'globular':
            // TPS13A Excel 校正 (Input protein information!M21)
            coefficient = 0.2508;
            exponent = 0.4301;
            basis = 'mw';
            formula = 'Rg = 0.251 × MW^0.43 (TPS13A Excel 校正)';
            break;
        case 'unfolded':
            // For chemically unfolded proteins (N = 殘基數)
            coefficient = 2.54;
            exponent = 0.522;
            basis = 'residues';
            formula = 'Rg = 2.54 × N^0.522 (N = 殘基數)';
            break;
        case 'idp':
            // For intrinsically disordered proteins (N = 殘基數)
            coefficient = 2.49;
            exponent = 0.509;
            basis = 'residues';
            formula = 'Rg = 2.49 × N^0.509 (N = 殘基數)';
            break;
        default:
            coefficient = 0.2508;
            exponent = 0.4301;
            basis = 'mw';
            formula = 'Rg = 0.251 × MW^0.43 (TPS13A Excel 校正)';
    }

    const usesResidues = basis === 'residues';
    Rg = coefficient * Math.pow(usesResidues ? residues : mw, exponent);

    // Excel Predicted Rg (基於 TPS13A Excel 數據校正)
    // 公式: Predicted Rg = 0.2508 × MW^0.4301
    // 校正自 Excel 數據:
    //   MW=20000 → Rg=17.76
    //   MW=38542 → Rg=23.55
    //   MW=66463 (BSA) → Rg=29.77
    const PREDICTED_RG_COEFF = 0.2508;
    const PREDICTED_RG_EXP = 0.4301;
    const predictedRg = PREDICTED_RG_COEFF * Math.pow(mw, PREDICTED_RG_EXP);

    // 也計算 qRg 建議範圍 (Guinier 適用範圍: qRg < 1.3)
    const qMaxGuinier = 1.3 / Rg;  // Å⁻¹

    return {
        theoreticalRg: Rg,           // Å (該構型的經驗公式)
        predictedRg: predictedRg,    // Å (Excel 實驗校正)
        formula: formula,
        predictedFormula: 'Rg = 0.2508 × MW^0.4301',
        proteinType: proteinType,
        coefficient: coefficient,
        exponent: exponent,
        basis: basis,                // 'mw' | 'residues'
        nResidues: usesResidues ? residues : null,
        residueEstimate: usesResidues && !hasResidueCount,
        qMaxGuinier: qMaxGuinier,    // Å⁻¹
        mw: mw
    };
}

/**
 * 從 Rg 計算理論 Dmax (最大粒子尺寸)
 * 
 * @param {number} rg - 迴旋半徑 (Å)
 * @param {string} shape - 形狀: 'sphere', 'globular', 'elongated'
 * @returns {object} 理論 Dmax 計算結果
 * 
 * 經驗關係:
 *   球形 (sphere): Dmax = 2.58 × Rg (理論值 for perfect sphere)
 *   球狀蛋白 (globular): Dmax ≈ 2.5~3.0 × Rg
 *   伸長型 (elongated): Dmax ≈ 3.5~4.0 × Rg
 */
function calculateTheoreticalDmax(rg, shape = 'globular') {
    let factor, dmaxMin, dmaxMax, formula;

    switch (shape.toLowerCase()) {
        case 'sphere':
            // 完美球形: Dmax = 2 × √(5/3) × Rg ≈ 2.58 × Rg
            factor = 2.58;
            dmaxMin = 2.5 * rg;
            dmaxMax = 2.7 * rg;
            formula = 'Dmax = 2.58 × Rg (sphere)';
            break;
        case 'globular':
            // 一般球狀蛋白
            factor = 2.8;
            dmaxMin = 2.5 * rg;
            dmaxMax = 3.0 * rg;
            formula = 'Dmax ≈ 2.5~3.0 × Rg (globular)';
            break;
        case 'elongated':
            // 伸長型蛋白
            factor = 3.5;
            dmaxMin = 3.0 * rg;
            dmaxMax = 4.0 * rg;
            formula = 'Dmax ≈ 3.0~4.0 × Rg (elongated)';
            break;
        default:
            factor = 2.8;
            dmaxMin = 2.5 * rg;
            dmaxMax = 3.0 * rg;
            formula = 'Dmax ≈ 2.5~3.0 × Rg';
    }

    const dmax = factor * rg;

    return {
        theoreticalDmax: dmax,       // Å
        dmaxRange: { min: dmaxMin, max: dmaxMax },
        factor: factor,
        formula: formula,
        shape: shape,
        rg: rg
    };
}

/**
 * 從分子量計算所有理論 SAXS 參數
 * 一次計算 I(0), Rg, Dmax 所有理論值
 * 
 * @param {number} mw - 分子量 (Da)
 * @param {number} concentration - 濃度 (mg/mL)
 * @param {string} proteinType - 蛋白質類型
 * @param {object} [opts] - 選用序列資訊
 * @param {number} [opts.electrons] - 分子總電子數 N_e (啟用 Excel 精確 I(0))
 * @param {number} [opts.dryVolume] - 乾燥體積 V_dry (Å³)
 * @param {number} [opts.nResidues] - 殘基數 (unfolded / IDP 的 Rg 用)
 * @returns {object} 所有理論參數
 */
function calculateAllTheoreticalParams(mw, concentration, proteinType = 'globular', opts = {}) {
    const options = opts || {};
    const i0Result = calculateTheoreticalI0(mw, concentration, options);
    const rgResult = calculateTheoreticalRg(mw, proteinType, options.nResidues);
    const dmaxResult = calculateTheoreticalDmax(rgResult.theoreticalRg, proteinType === 'elongated' ? 'elongated' : 'globular');

    // 理論乾燥體積 (from MW)
    const theoreticalDryVolume = 1.212 * mw;  // Å³

    return {
        mw: mw,
        concentration: concentration,
        proteinType: proteinType,

        // I(0) 理論值
        theoreticalI0: i0Result.theoreticalI0,
        i0Method: i0Result.method,   // 'empirical'（主值）
        empiricalI0: i0Result.empiricalI0,
        exactI0: i0Result.exactI0,   // Excel 精確式參考值（無序列組成時 null）

        // Rg 理論值 (該構型的經驗公式)
        theoreticalRg: rgResult.theoreticalRg,
        // Predicted Rg (Excel 實驗校正)
        predictedRg: rgResult.predictedRg,
        rgFormula: rgResult.formula,
        rgBasis: rgResult.basis,
        rgResidueEstimate: rgResult.residueEstimate,
        predictedRgFormula: rgResult.predictedFormula,
        qMaxGuinier: rgResult.qMaxGuinier,

        // Dmax 理論值
        theoreticalDmax: dmaxResult.theoreticalDmax,
        dmaxRange: dmaxResult.dmaxRange,
        dmaxFormula: dmaxResult.formula,

        // 乾燥體積
        theoreticalDryVolume: theoreticalDryVolume
    };
}

/**
 * 從 I(0) 計算分子量
 * @param {number} I0 - 零角散射強度 (cm⁻¹)
 * @param {number} concentration - 濃度 (mg/mL)
 * @param {number} contrastFactor - 對比因子 cm⁻¹/(mg/mL × Da)，預設為蛋白質第一原理值
 * @returns {number} 分子量 (Da)
 */
function calculateMwFromI0(I0, concentration, contrastFactor = I0_CONTRAST_FACTOR) {
    // MW = I(0) / (c × k)
    // k = I0_CONTRAST_FACTOR ≈ 7.9e-7 cm⁻¹/(mg/mL × Da) for proteins (v̄ = 0.73)
    const mw = I0 / (concentration * contrastFactor);
    return mw;
}

/**
 * 計算 Porod 體積
 * @param {number} I0 - 零角散射強度
 * @param {number} porodInvariant - Porod 不變量
 * @returns {number} Porod 體積 (Å³)
 */
function calculatePorodVolume(I0, porodInvariant) {
    // Vp = 2π² I(0) / Q
    return 2 * Math.PI * Math.PI * I0 / porodInvariant;
}

/**
 * 從 Porod 體積估算分子量
 * @param {number} porodVolume - Porod 體積 (Å³)
 * @returns {number} 分子量 (Da)
 */
function estimateMwFromPorodVolume(porodVolume) {
    // MW ≈ Vp / 1.66 (Å³/Da)
    return porodVolume / 1.66;
}

// 導出函數
window.SAXSCalculations = {
    // 物理常數
    I0_CONTRAST_FACTOR,

    // SAXS 分析
    calculateMwFromI0,
    calculatePorodVolume,
    estimateMwFromPorodVolume,
    calculateTheoreticalI0,
    calculateTheoreticalRg,
    calculateTheoreticalDmax,
    calculateAllTheoreticalParams,
    calculateDetectorDistance,
    DETECTOR_SD_MIN_MM,
    DETECTOR_SD_MAX_MM,
    compareRg,

    // 離心參數
    calculateRCF,
    calculateRPM,
    calculateSedimentation,
    calculateTerminalVelocity,
    calculateCentrifugationDistance,

    // HPLC 計算
    calculateDilutionFactor,
    calculateDilutionFactorEmpirical,
    calculateConcentrationFromUV,
    calculateMwFromRetentionTime,
    calculateRetentionTimeFromMw,
    calculateMassResolution,

    // HPLC-SAXS Step Settings
    INJECTION_VOLUME_MIN_UL,
    INJECTION_VOLUME_MAX_UL,
    transitionFlowRate,
    DEAD_VOLUME_UL,
    SAFE_ZONE_MIN,
    calculatePeakWidthScaling,
    calculateTimeOffset,
    calculateHPLCSAXSSettings,
    calculateSuggestedParams
};
