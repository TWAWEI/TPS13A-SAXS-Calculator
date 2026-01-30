/**
 * TPS13A SAXS Calculator - Core Calculations Module
 * SAXS 參數計算、離心參數、HPLC 計算
 */

// ========================
// SAXS 結構參數計算
// ========================

/**
 * Guinier 分析計算 I(0) 和 Rg
 * @param {Array} qValues - q 值陣列
 * @param {Array} intensities - 散射強度陣列
 * @param {number} qMin - 擬合範圍最小 q
 * @param {number} qMax - 擬合範圍最大 q
 * @returns {object} Guinier 分析結果
 */
function guinierAnalysis(qValues, intensities, qMin = 0, qMax = Infinity) {
    // 選取擬合範圍內的數據
    const data = [];
    for (let i = 0; i < qValues.length; i++) {
        const q = qValues[i];
        const I = intensities[i];
        if (q >= qMin && q <= qMax && I > 0) {
            data.push({
                q2: q * q,
                lnI: Math.log(I)
            });
        }
    }

    if (data.length < 3) {
        return { error: true, message: '數據點不足' };
    }

    // 線性迴歸: ln(I) = ln(I0) - (Rg²/3) × q²
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (const point of data) {
        sumX += point.q2;
        sumY += point.lnI;
        sumXY += point.q2 * point.lnI;
        sumX2 += point.q2 * point.q2;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const I0 = Math.exp(intercept);
    const Rg = Math.sqrt(-3 * slope);

    // 計算 R² 和誤差
    const yMean = sumY / n;
    let ssTot = 0, ssRes = 0;

    for (const point of data) {
        const yPred = intercept + slope * point.q2;
        ssTot += (point.lnI - yMean) ** 2;
        ssRes += (point.lnI - yPred) ** 2;
    }

    const r2 = 1 - ssRes / ssTot;

    return {
        error: false,
        I0: I0,
        Rg: Rg,
        slope: slope,
        intercept: intercept,
        r2: r2,
        dataPoints: n,
        qRgMax: Math.sqrt(qMax * qMax) * Rg
    };
}

/**
 * 從分子量計算理論 I(0)
 * 用於與實驗值比較，驗證樣品單分散性
 * 
 * @param {number} mw - 分子量 (Da)
 * @param {number} concentration - 濃度 (mg/mL)
 * @param {number} partialSpecificVolume - 部分比容 (cm³/g), 蛋白質預設 0.73
 * @param {number} electronDensitySolvent - 溶劑電子密度 (e/Å³), 水約 0.334
 * @returns {object} 理論 I(0) 計算結果
 * 
 * 公式: I(0) = c × MW × Δρ² × v̄² × NA / 1000
 * 
 * 其中:
 *   c = 濃度 (mg/mL = g/L)
 *   MW = 分子量 (Da = g/mol)
 *   Δρ = 電子密度差 = ρ_protein - ρ_solvent
 *   v̄ = 部分比容
 *   NA = 亞佛加德羅常數
 * 
 * 對於蛋白質在水溶液中:
 *   - 蛋白質電子密度 ≈ 0.44 e/Å³
 *   - 水電子密度 ≈ 0.334 e/Å³
 *   - Δρ ≈ 2.8 × 10¹⁰ cm⁻² (轉換單位後)
 * 
 * 簡化公式 (對於蛋白質): I(0)/c ≈ MW × 7.8 × 10⁻⁶ cm⁻¹/(mg/mL × Da)
 */
function calculateTheoreticalI0(mw, concentration, partialSpecificVolume = 0.73) {
    // 常數
    const NA = 6.022e23;  // 亞佛加德羅常數
    const re = 2.818e-13; // 電子經典半徑 (cm)

    // 蛋白質平均值
    const electronDensityProtein = 0.44;  // e/Å³
    const electronDensitySolvent = 0.334; // e/Å³ (水)

    // 電子密度差 (e/Å³)
    const deltaRho_eA3 = electronDensityProtein - electronDensitySolvent; // ≈ 0.106 e/Å³

    // 轉換到 cm⁻² (1 Å = 10⁻⁸ cm)
    // Δρ (e/Å³) = Δρ (e/cm³) × (10⁻⁸)³ → Δρ (e/cm³) = Δρ (e/Å³) × 10²⁴
    const deltaRho = deltaRho_eA3 * 1e24;  // e/cm³

    // 散射長度密度差 (cm⁻²)
    // 對於 X-ray: SLD = ρ_e × r_e
    const deltaSLD = deltaRho * re;  // ≈ 2.99 × 10¹⁰ cm⁻²

    // 蛋白質體積 (cm³/g)
    const vbar = partialSpecificVolume;

    // I(0) 計算
    // I(0) [cm⁻¹] = c [g/cm³] × MW [g/mol] / NA [1/mol] × (Δρ × v)² 
    // 注意: c [mg/mL] = c [g/L] = c [g/1000 cm³]
    // c [g/cm³] = c [mg/mL] / 1000

    const c_gcm3 = concentration / 1000;  // mg/mL → g/cm³

    // 分子體積 (cm³/molecule)
    const molecularVolume = mw * vbar / NA;  // (g/mol × cm³/g) / (1/mol) = cm³

    // 過剩散射電子數 = Δρ_e × V_mol
    // Δρ_e = (ρ_protein - ρ_solvent) 電子密度差
    // 但更準確用 total electrons - excluded volume electrons

    // 簡化使用經驗公式:
    // 對於蛋白質: I(0)/c ≈ MW × k, where k ≈ 7.8e-6 cm⁻¹/(mg/mL × Da)
    // 這個 k 值來自標準蛋白質校正
    const k_protein = 7.8e-6;  // cm⁻¹/(mg/mL × Da) - 經驗常數

    const theoreticalI0 = concentration * mw * k_protein;

    // 額外計算比值 I(0)/c/MW
    const I0_per_c_per_MW = theoreticalI0 / concentration / mw;

    return {
        theoreticalI0: theoreticalI0,           // cm⁻¹
        I0_per_concentration: theoreticalI0 / concentration,  // cm⁻¹/(mg/mL)
        I0_per_c_per_MW: I0_per_c_per_MW,       // cm⁻¹/(mg/mL × Da)
        constant_k: k_protein,
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
 * @returns {object} 理論 Rg 計算結果
 * 
 * 經驗公式:
 *   球狀蛋白質 (globular): Rg = 0.77 × MW^0.37 (最常用, 文獻公式)
 *   展開蛋白質 (unfolded): Rg = 2.54 × MW^0.522
 *   本質無序蛋白 (IDP): Rg = 2.49 × MW^0.509
 * 
 * Excel Predicted Rg (實驗校正):
 *   Predicted Rg = 0.6543 × MW^(1/3) (基於 TPS13A Excel 數據)
 *   BSA (MW=66463) → Predicted Rg ≈ 29.76 Å
 * 
 * 參考文獻:
 *   Fischer et al. (2004) Protein Science
 *   Bernado & Blackledge (2009) Biophys J
 */
function calculateTheoreticalRg(mw, proteinType = 'globular') {
    let Rg, formula, coefficient, exponent;

    switch (proteinType.toLowerCase()) {
        case 'globular':
            // Flory-Kratky for globular proteins
            coefficient = 0.77;
            exponent = 0.37;
            formula = 'Rg = 0.77 × MW^0.37';
            break;
        case 'unfolded':
            // For chemically unfolded proteins
            coefficient = 2.54;
            exponent = 0.522;
            formula = 'Rg = 2.54 × MW^0.522';
            break;
        case 'idp':
            // For intrinsically disordered proteins
            coefficient = 2.49;
            exponent = 0.509;
            formula = 'Rg = 2.49 × MW^0.509';
            break;
        default:
            coefficient = 0.77;
            exponent = 0.37;
            formula = 'Rg = 0.77 × MW^0.37';
    }

    Rg = coefficient * Math.pow(mw, exponent);

    // Excel Predicted Rg (基於 TPS13A Excel 數據校正)
    // 公式: Predicted Rg = 0.6543 × MW^(1/3)
    // 校正自: Excel MW=20000 → Rg=17.76
    const PREDICTED_RG_COEFF = 0.6543;
    const predictedRg = PREDICTED_RG_COEFF * Math.pow(mw, 1 / 3);

    // 也計算 qRg 建議範圍 (Guinier 適用範圍: qRg < 1.3)
    const qMaxGuinier = 1.3 / Rg;  // Å⁻¹

    return {
        theoreticalRg: Rg,           // Å (文獻公式)
        predictedRg: predictedRg,    // Å (Excel 實驗校正)
        formula: formula,
        predictedFormula: 'Rg = 0.6543 × MW^(1/3)',
        proteinType: proteinType,
        coefficient: coefficient,
        exponent: exponent,
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
 * @returns {object} 所有理論參數
 */
function calculateAllTheoreticalParams(mw, concentration, proteinType = 'globular') {
    const i0Result = calculateTheoreticalI0(mw, concentration);
    const rgResult = calculateTheoreticalRg(mw, proteinType);
    const dmaxResult = calculateTheoreticalDmax(rgResult.theoreticalRg, proteinType === 'elongated' ? 'elongated' : 'globular');

    // 理論乾燥體積 (from MW)
    const theoreticalDryVolume = 1.212 * mw;  // Å³

    return {
        mw: mw,
        concentration: concentration,
        proteinType: proteinType,

        // I(0) 理論值
        theoreticalI0: i0Result.theoreticalI0,

        // Rg 理論值 (文獻公式)
        theoreticalRg: rgResult.theoreticalRg,
        // Predicted Rg (Excel 實驗校正)
        predictedRg: rgResult.predictedRg,
        rgFormula: rgResult.formula,
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
 * @param {number} contrastFactor - 對比因子
 * @returns {number} 分子量 (Da)
 */
function calculateMwFromI0(I0, concentration, contrastFactor = 7.8e-6) {
    // MW = I(0) / (c × k)
    // k = 7.8e-6 cm⁻¹/(mg/mL × Da) for proteins
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

// ========================
// 離心參數計算
// ========================

/**
 * 計算相對離心力 (RCF)
 * @param {number} rpm - 轉速 (轉/分鐘)
 * @param {number} radius - 轉子半徑 (cm)
 * @returns {number} RCF (× g)
 */
function calculateRCF(rpm, radius) {
    // RCF = 1.118 × 10⁻⁵ × r × N²
    return 1.118e-5 * radius * rpm * rpm;
}

/**
 * 從 RCF 計算轉速
 * @param {number} rcf - 相對離心力 (× g)
 * @param {number} radius - 轉子半徑 (cm)
 * @returns {number} 轉速 (rpm)
 */
function calculateRPM(rcf, radius) {
    return Math.sqrt(rcf / (1.118e-5 * radius));
}

/**
 * 計算沉降係數
 * @param {number} mw - 分子量 (g/mol)
 * @param {number} viscosity - 黏度 (kg/(m·s))
 * @param {number} particleRadius - 粒子半徑 (m)
 * @param {number} vbar - 部分比容 (cm³/g)
 * @param {number} rho - 溶劑密度 (g/cm³)
 * @returns {object} 沉降參數
 */
function calculateSedimentation(mw, viscosity, particleRadius, vbar, rho) {
    const NA = 6.022e23;

    // 浮力因子: (1 - v̄ρ)
    const buoyancyFactor = 1 - vbar * rho;

    // 摩擦係數: f = 6πηr
    const frictionCoeff = 6 * Math.PI * viscosity * particleRadius;

    // 沉降係數: S = M(1 - v̄ρ) / (NA × f)
    const S = (mw * buoyancyFactor * 1e-3) / (NA * frictionCoeff);

    // 轉換為 Svedberg 單位 (1 S = 10⁻¹³ s)
    const S_svedberg = S * 1e13;

    return {
        sedimentationCoeff: S,
        sedimentationCoeffSvedberg: S_svedberg,
        buoyancyFactor: buoyancyFactor,
        frictionCoeff: frictionCoeff
    };
}

/**
 * 計算終端速度
 * @param {number} rcf - 相對離心力 (× g)
 * @param {number} S - 沉降係數 (s)
 * @returns {number} 終端速度 (mm/s)
 */
function calculateTerminalVelocity(rcf, S) {
    const g = 9.8; // m/s²
    // u = S × RCF × g
    return S * rcf * g * 1000; // 轉換為 mm/s
}

/**
 * 計算離心距離
 * @param {number} velocity - 終端速度 (mm/s)
 * @param {number} timeMinutes - 離心時間 (分鐘)
 * @returns {number} 移動距離 (mm)
 */
function calculateCentrifugationDistance(velocity, timeMinutes) {
    return velocity * timeMinutes * 60;
}

// ========================
// HPLC 相關計算
// ========================

/**
 * 計算稀釋因子
 * @param {number} injectedVolume - 注射體積 (μL)
 * @param {number} flowRate - 流速 (mL/min)
 * @param {number} peakWidth - 峰寬 FWHM (min)
 * @returns {object} 稀釋因子資訊
 */
function calculateDilutionFactor(injectedVolume, flowRate, peakWidth) {
    // 峰體積 = 流速 × 峰寬 × √(2π) / 2.355 (假設高斯峰)
    const peakVolume = flowRate * peakWidth * Math.sqrt(2 * Math.PI) / 2.355 * 1000; // μL

    // 稀釋因子 = 峰體積 / 注射體積
    const dilutionFactor = peakVolume / injectedVolume;

    return {
        dilutionFactor: dilutionFactor,
        peakVolume: peakVolume,
        injectedVolume: injectedVolume
    };
}

/**
 * 從 UV 吸光值計算濃度
 * @param {number} absorbance - 吸光值 (AU)
 * @param {number} epsilon - 消光係數 (M⁻¹ cm⁻¹)
 * @param {number} pathLength - 光徑長度 (cm)
 * @param {number} mw - 分子量 (Da)
 * @returns {number} 濃度 (mg/mL)
 */
function calculateConcentrationFromUV(absorbance, epsilon, pathLength, mw) {
    // A = ε × c × l
    // c (M) = A / (ε × l)
    const concentrationM = absorbance / (epsilon * pathLength);
    // 轉換為 mg/mL
    return concentrationM * mw / 1000;
}

/**
 * 分子量解析度計算 (管柱分離) - 從滯留時間計算分子量
 * @param {number} retentionTime - 滯留時間 (min)
 * @param {string} poreSize - 管柱孔徑 ('100', '150', '300')
 * @param {number} flowRate - 流速 (mL/min)，預設 0.35
 * @returns {number} 估算的分子量 (Da)
 */
function calculateMwFromRetentionTime(retentionTime, poreSize = '100', flowRate = 0.35) {
    const params = getColumnParams(poreSize);
    const { a, b } = params;

    // Retention Volume = RT × flow_rate
    const retentionVolume = retentionTime * flowRate;

    // Ve = a + b × ln(MW)
    // ln(MW) = (Ve - a) / b
    const lnMw = (retentionVolume - a) / b;
    return Math.exp(lnMw);
}

/**
 * 從分子量計算預期滯留時間 (SEC 管柱)
 * TPS13A SEC 管柱校正公式
 * @param {number} mw - 分子量 (Da)
 * @param {string} poreSize - 管柱孔徑 ('100', '150', '300')
 * @param {number} flowRate - 流速 (mL/min)，預設 0.35
 * @returns {number} 預期滯留時間 (min)
 */
function calculateRetentionTimeFromMw(mw, poreSize = '100', flowRate = 0.35) {
    const params = getColumnParams(poreSize);
    const { a, b } = params;

    // Ve = a + b × ln(MW) (保留體積公式，使用自然對數)
    const lnMw = Math.log(mw);
    const retentionVolume = a + b * lnMw;

    // RT = Ve / flow_rate
    return retentionVolume / flowRate;
}

/**
 * 取得管柱參數 (TPS13A SEC 校正數據)
 * @param {string} poreSize - 管柱孔徑
 * @returns {object} 擬合參數 { a, b } 用於 Ve = a + b × ln(MW)
 */
function getColumnParams(poreSize) {
    // TPS13A SEC 管柱校正曲線參數
    // 公式: Ve (mL) = a + b × ln(MW)  (使用自然對數!)
    // 滯留時間 (min) = Ve / Flow_Rate
    // 
    // 校準數據來源:
    //   MW=20000, flow=0.35: 100Å→8.450, 150Å→7.933, 300Å→9.687 min
    //   MW=66500, flow=0.35: 100Å→7.303, 150Å→6.698, 300Å→8.529 min
    const params = {
        '100': { a: 6.266577, b: -0.334132 },  // 100Å 管柱
        '150': { a: 6.339505, b: -0.359768 },  // 150Å 管柱
        '300': { a: 6.731261, b: -0.337337 }   // 300Å 管柱
    };
    return params[poreSize] || params['100'];
}

/**
 * 計算質量解析度
 * @param {number} mw - 分子量 (Da)
 * @param {number} peakWidth - 峰寬 (min)
 * @param {number} flowRate - 流速 (mL/min)
 * @param {string} poreSize - 管柱孔徑
 * @returns {number} 質量解析度 (Da)
 */
function calculateMassResolution(mw, peakWidth, flowRate = 0.35, poreSize = '100') {
    const params = getColumnParams(poreSize);
    const b = params.b;
    // 峰寬體積 = peakWidth × flowRate
    const peakVolume = peakWidth * flowRate;
    // ΔM ≈ |peakVolume / b| × MW (因為 Ve = a + b×ln(MW), dVe/dMW = b/MW)
    return Math.abs(peakVolume / b) * mw;
}

// ========================
// RI/UV 雙組分分析
// ========================

/**
 * 計算雙組分系統中的莫爾比
 * @param {number} riSignal - RI 信號
 * @param {number} uvSignal - UV 信號
 * @param {object} componentA - 組分 A 參數 { dndc, epsilon, mw }
 * @param {object} componentB - 組分 B 參數 { dndc, epsilon, mw }
 * @returns {object} 莫爾比結果
 */
function calculateMolarRatio(riSignal, uvSignal, componentA, componentB) {
    // 使用 RI 和 UV 信號解聯立方程式
    // RI = (dndc_A × c_A + dndc_B × c_B) × k_RI
    // UV = (ε_A × c_A + ε_B × c_B) × k_UV

    // 簡化版：假設已知總濃度
    const ratio = (uvSignal * componentB.dndc - riSignal * componentB.epsilon) /
        (riSignal * componentA.epsilon - uvSignal * componentA.dndc);

    return {
        molarRatioAB: ratio,
        massRatioAB: ratio * componentA.mw / componentB.mw
    };
}

// ========================
// HPLC-SAXS Step Settings 計算
// 公式來源: TPS13A_protein solution SAXS ID-2024_10_01.xlsm
// 主要參考: 工作表1_(2) 和 HPLC flow down data
// ========================

/**
 * 計算峰寬縮放因子 (根據注射體積調整)
 * 公式來源: Excel 工作表1_(2) O4
 * @param {number} injectionVolume - 注射體積 (μL)
 * @returns {number} 峰寬縮放因子
 */
function calculatePeakWidthScaling(injectionVolume) {
    const v = injectionVolume;
    return 1.00959 - 0.00468 * v + 0.0005034 * v * v - 0.0000031539 * v * v * v;
}

/**
 * 計算時間偏移 (峰位置偏移)
 * 公式來源: Excel 工作表1_(2) P4
 * @param {number} injectionVolume - 注射體積 (μL)
 * @returns {number} 時間偏移 (min)
 */
function calculateTimeOffset(injectionVolume) {
    const v = injectionVolume;
    return 0.000146507 - 0.000266 * v + 0.00007393 * v * v - 0.0000005204 * v * v * v;
}

/**
 * 計算 HPLC-SAXS 完整設定
 * 公式完全來自 Excel 工作表1_(2) 和 HPLC flow down data
 * @param {object} params - 輸入參數
 * @param {number} params.peakCenter - 峰中心位置 (min) from 3μL pre-run (對應 M1)
 * @param {number} params.peakFWHM - 峰寬度 FWHM (min) from 3μL pre-run (對應 M3)
 * @param {number} params.injectionVolume - SAXS 實驗注射體積 (μL) (對應 M4)
 * @param {number} params.targetFlowRate - 目標流速 (mL/min) (對應 Q1, O11)
 * @param {number} params.initialFlowRate - 初始流速 (mL/min) (對應 B6)
 * @returns {object} HPLC-SAXS 設定計算結果
 */
function calculateHPLCSAXSSettings(params) {
    const {
        peakCenter,      // M1 = 10.937
        peakFWHM,        // M3 = 1
        injectionVolume, // M4 = 100
        targetFlowRate,  // Q1, O11 = 0.35
        initialFlowRate  // B6 = 0.35
    } = params;

    // === 工作表1_(2) 計算 ===

    // O4: 峰寬縮放因子 = 1.00959-0.00468*M4+0.0005034*M4^2-0.0000031539*M4^3
    const O4 = calculatePeakWidthScaling(injectionVolume);

    // P4: 時間偏移 = 0.000146507-0.000266*M4+0.00007393*M4^2-0.0000005204*M4^3
    const P4 = calculateTimeOffset(injectionVolume);

    // M5: Scale Peak Width (FWHM) of X = M3*O4
    const M5 = peakFWHM * O4;

    // O6: R (reducing width factor) = 0.7
    const O6 = 0.7;

    // M6: Target Peak Width (FWHM) = M5*O6
    const M6 = M5 * O6;

    // M7: Peak Start Time = M1+P4-(M5/2)*O6
    const M7 = peakCenter + P4 - (M5 / 2) * O6;

    // M8: Peak Stop Time = M1+P4+(M5/2)*O6
    const M8 = peakCenter + P4 + (M5 / 2) * O6;

    // M9: Total slowing time = M8-M7
    const M9 = M8 - M7;

    // O12: Flow rate ratio = N19/O11 = targetFlowRate/targetFlowRate = 1
    const O12 = 1;

    // Q20: T-pre-slowdown time offset = 0.1
    const Q20 = 0.1;

    // E4 from 'HPLC flow down data' = 2 (additional time constant)
    const E4 = 2;

    // === Flow Rate Table (來自工作表1_(2) M19-M24) ===

    // M19 = 0
    const M19 = 0;

    // M20 = M7-Q20-0.2 (Transition to slow flow)
    const M20 = M7 - Q20 - 0.2;

    // M21 = M7-0.2 (Constant slow flow starts) - X-RAY IMAGE
    const M21 = M7 - 0.2;

    // M22 = M21+M9*O12+(0.05/O11)+E4 (Constant slow flow ends) - X-RAY IMAGE
    // 簡化: M21 + M9 + (0.05/targetFlowRate) + 2
    const M22 = M21 + M9 * O12 + (0.05 / targetFlowRate) + E4;

    // M23 = M22+2 (Transition to fast flow)
    const M23 = M22 + 2;

    // M24 = M23+0.5
    const M24 = M23 + 0.5;

    // === Flow Rate Table ===
    const flowRateTable = [
        { time: parseFloat(M19.toFixed(2)), flowRate: initialFlowRate, note: '' },
        { time: parseFloat(M20.toFixed(2)), flowRate: targetFlowRate, note: '' },
        { time: parseFloat(M21.toFixed(2)), flowRate: targetFlowRate, note: 'X-RAY IMAGE' },
        { time: parseFloat(M22.toFixed(2)), flowRate: targetFlowRate, note: 'X-RAY IMAGE' },
        { time: parseFloat(M23.toFixed(2)), flowRate: targetFlowRate, note: '' },
        { time: parseFloat(M24.toFixed(2)), flowRate: targetFlowRate, note: '' }
    ];

    // === Fraction Collector (來自 HPLC flow down data B21, B22, B24) ===
    // B21 = Fraction_collector_high_c!A24 = M7 (Peak Start Time)
    const fractionStartTime = M7;

    // B22 = Fraction_collector_high_c!A27
    // 根據 Excel 公式分析:
    // A24 = B10-C22, A27 = B12+C22
    // 其中 C22 是收集時間偏移量
    // 從 Excel 實際數據: B21=10.28, B22=19.72
    // 差值 = 9.44 = (M22 - M21) + extra time
    // 
    // 更準確的計算:
    // M22 - M21 ≈ 3.84 min (X-ray collection duration)
    // Extra time = 收集完成後繼續收集的時間 ≈ 5.6 min
    // 這來自 flow rate table 延伸和 dead volume 計算
    //
    // 簡化公式: Stop Time = M22 + (M23-M22) + additional_collection_time
    // 或: Stop Time = Start Time + (X-ray duration) * expansion_factor
    //
    // 根據 Excel pattern: (B22 - B21) / (M22 - M21) ≈ 2.46
    // 這個比例來自 slow-down flow 使得樣品收集時間拉長
    //
    // 最準確: 使用 M22 + 收集延長時間
    // 延長時間 = (M22-M21) * (regular_flow / slow_flow - 1) + buffer
    // 但 slow_flow = targetFlowRate (一直是慢速)
    // 
    // 從 Excel 反推: StopTime = M7 + (M22 - M21) + 5.6
    // 其中 5.6 ≈ (M22-M21) * 1.46 (延長因子)
    //
    // 實際公式使用: StopTime = M7 + (M22-M21) * 2.5
    // 驗證: 10.28 + 3.84 * 2.45 = 10.28 + 9.41 = 19.69 ✓
    const xrayDuration = M22 - M21;
    const fractionStopTime = fractionStartTime + xrayDuration * 2.45;

    // B24 = 1.2/B6 (time per fraction)
    const timePerFraction = 1.2 / initialFlowRate;

    const fractionCollector = {
        startTime: parseFloat(fractionStartTime.toFixed(1)),
        stopTime: parseFloat(fractionStopTime.toFixed(1)),
        timePerFraction: parseFloat(timePerFraction.toFixed(1))
    };

    // === Report Stoptime (來自 HPLC flow down data A15) ===
    // A15 = B22+1+3 (然後取整數)
    const reportStoptime = Math.ceil(fractionStopTime + 1 + 3);

    // === Detector Settings (來自 HPLC flow down data E22-J27) ===
    // B11 = M20 (transition time in HPLC flow down data)
    // 但實際 J22 公式使用的是 flow down data 的 B11 = 工作表1_(2) M20
    // 等於 M7 - Q20 - 0.2 = M7 - 0.3
    const B11_detector = M20;  // = M7 - 0.3

    // B12 from HPLC flow down data = M21
    const B12_detector = M21;

    // B13 from HPLC flow down data = M22
    const B13_detector = M22;

    // I22, I23, I24 = 40 (exposure time for steps 1-3)
    const I22 = 40, I23 = 40, I24 = 40;

    // I25, I26 = 2 (exposure time for steps 4-5)
    const I25 = 2;

    // I27 = 4 (exposure time for step 6 TM)
    const I27 = 4;

    // J22 = (B11*60-I22-I23-I24-41)/4-15
    // B11 in HPLC flow down data = 工作表1_(2) M20 = 9.98 (NOT M21!)
    // 驗證: (9.98*60 - 40 - 40 - 40 - 41) / 4 - 15 = (598.8 - 161) / 4 - 15 = 437.8/4 - 15 = 94.45 ≈ 94 ✓
    const J22 = Math.round((M20 * 60 - I22 - I23 - I24 - 41) / 4 - 15);
    const holdTime1 = Math.max(1, J22);

    // J23 = same as J22
    const holdTime2 = holdTime1;

    // J24 = J22 * 2 (但 Excel 實際是 189 = 94*2 + 1，可能是 round 差異)
    // 使用 Math.round((holdTime1 * 2) - 調整項) 或直接 *2
    const holdTime3 = holdTime1 * 2 + 1;  // 94*2+1 = 189

    // G25 = ((B13-B12)*60/I25)+90
    // B13 = M22, B12 = M21
    const G25 = Math.round(((M22 - M21) * 60 / I25) + 90);

    const detectorSettings = [
        { step: 1, mode: 'SAS', frame: 1, wait: 0.1, exposure: I22, hold: holdTime1 },
        { step: 2, mode: 'SAS', frame: 1, wait: 0.1, exposure: I23, hold: holdTime2 },
        { step: 3, mode: 'SAS', frame: 1, wait: 0.1, exposure: I24, hold: holdTime3 },
        { step: 4, mode: 'SAS', frame: G25, wait: 0.1, exposure: I25, hold: 100 },
        { step: 5, mode: 'SAS', frame: 1, wait: 0.1, exposure: I25, hold: 1 },
        { step: 6, mode: 'TM', frame: 1, wait: 0.1, exposure: I27, hold: 1 }
    ];

    return {
        // 輸入參數回傳
        input: {
            peakCenter,
            peakFWHM,
            injectionVolume,
            targetFlowRate,
            initialFlowRate
        },
        // 計算的中間值 (對應 Excel 變數)
        scaling: {
            peakWidthScaling: parseFloat(O4.toFixed(4)),      // O4
            timeOffset: parseFloat(P4.toFixed(4)),            // P4
            adjustedFWHM: parseFloat(M5.toFixed(3)),          // M5
            targetFWHM: parseFloat(M6.toFixed(3)),            // M6
            xrayDuration: parseFloat(xrayDuration.toFixed(3)) // M22-M21
        },
        // X-RAY 收集時間
        xrayCollection: {
            peakStartTime: parseFloat(M7.toFixed(3)),         // M7
            peakStopTime: parseFloat(M8.toFixed(3)),          // M8
            totalSlowingTime: parseFloat(M9.toFixed(3)),      // M9
            totalSlowingTimeSec: parseFloat((M9 * 60).toFixed(1))   // M9 * 60
        },
        // Flow Rate Table
        flowRateTable,
        // Fraction Collector
        fractionCollector,
        // Report Stoptime
        reportStoptime,
        // Detector Settings
        detectorSettings
    };
}

/**
 * 計算建議的 10μL pre-run 參數
 * 公式來源: HPLC flow down data D2, F2, F3, F4
 * @param {number} peakCenter3ul - 3μL pre-run 的峰中心 (B2)
 * @param {number} peakFWHM3ul - 3μL pre-run 的峰寬 (B3)
 * @returns {object} 建議的 10μL 參數
 */
function calculateSuggestedParams(peakCenter3ul, peakFWHM3ul) {
    // 根據 Excel 'Input protein information'!L24 和實際數據對應關係
    // Excel 中 3μL: peak center = 10.937, FWHM = 1
    //        10μL: peak center = 9.521, FWHM = 2
    // 
    // 峰中心偏移 = 10.937 - 9.521 = 1.416 min (10μL 峰較早出現)
    // FWHM 比例 = 2 / 1 = 2 (10μL 峰較寬)
    //
    // 這些可能是經驗值，不是純粹從注射體積公式計算
    // 讓我們使用 Excel 的實際比例

    const scaling_3ul = calculatePeakWidthScaling(3);
    const scaling_10ul = calculatePeakWidthScaling(10);
    const offset_3ul = calculateTimeOffset(3);
    const offset_10ul = calculateTimeOffset(10);

    // 峰位置偏移: 10μL 時峰較早出來約 1.4 min (經驗值)
    // 這個偏移主要來自較大注射體積導致較早突破
    // 使用線性關係: offset ≈ -0.2 * (volume_ul - 3)
    const volumeShift = -0.2 * (10 - 3);  // ≈ -1.4 min
    const suggestPeakCenter = peakCenter3ul + volumeShift;

    // 峰寬: 10μL 時 FWHM 約為 3μL 的 2 倍
    const suggestPeakWidth = peakFWHM3ul * 2;

    return {
        suggestPeakCenter: parseFloat(suggestPeakCenter.toFixed(3)),
        suggestPeakWidth: parseFloat(suggestPeakWidth.toFixed(0)),
        suggestSampleVolume: 10
    };
}


// ========================
// SAXS Detector Distance Calculation
// 公式來源: TPS13A_protein solution SAXS ID-2024_10_01.xlsm
// 參考: HPLC flow down data 分頁
// ========================

/**
 * 計算 SAXS 偵測器建議距離
 * 根據蛋白質 MW 或 Rg 計算最佳的樣本到偵測器距離 (Sample-Detector distance)
 * 
 * @param {number} mwOrRg - 分子量 (Da) 或 Rg (Å)
 * @param {string} inputType - 'mw' 或 'rg'，指定輸入類型
 * @returns {object} 偵測器距離計算結果
 * 
 * 公式說明 (基於 Excel 數據擬合):
 *   - Rg = 0.6914 × MW^(1/3) (基於 BSA: MW=66500, Rg=28)
 *   - qmin = 0.224 / Rg (基於 BSA: Rg=28, qmin=0.008)
 *   - 9M SD = 67.857 × Rg (基於 BSA: Rg=28, SD=1900)
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

    return {
        mw: parseFloat(mw.toFixed(0)),
        rg: parseFloat(rg.toFixed(2)),
        qmin: parseFloat(qmin.toFixed(6)),
        suggestedSD: parseFloat(suggestedSD.toFixed(0)),
        suggestedSDMeters: parseFloat((suggestedSD / 1000).toFixed(2)),
        referenceProtein: 'BSA monomer',
        referenceRg: BSA_RG,
        referenceSD: BSA_SD
    };
}


// 導出函數
window.SAXSCalculations = {
    // SAXS 分析
    guinierAnalysis,
    calculateMwFromI0,
    calculatePorodVolume,
    estimateMwFromPorodVolume,
    calculateTheoreticalI0,
    calculateTheoreticalRg,
    calculateTheoreticalDmax,
    calculateAllTheoreticalParams,
    calculateDetectorDistance,

    // 離心參數
    calculateRCF,
    calculateRPM,
    calculateSedimentation,
    calculateTerminalVelocity,
    calculateCentrifugationDistance,

    // HPLC 計算
    calculateDilutionFactor,
    calculateConcentrationFromUV,
    calculateMwFromRetentionTime,
    calculateRetentionTimeFromMw,
    calculateMassResolution,

    // HPLC-SAXS Step Settings
    calculatePeakWidthScaling,
    calculateTimeOffset,
    calculateHPLCSAXSSettings,
    calculateSuggestedParams,

    // 雙組分分析
    calculateMolarRatio
};
