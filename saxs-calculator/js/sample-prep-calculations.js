/**
 * TPS13A SAXS Calculator - 樣品前處理計算：離心參數、UV 濃度、SEC 稀釋因子與滯留時間、質量解析度
 *
 * 2026-10-14 從 calculations.js 純搬移拆出。函式宣告在全域作用域，由 calculations.js 結尾的匯出區塊
 * 在載入期讀取，所以本檔必須排在 calculations.js 之前（tests/structure.test.js 檢查）。
 */

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
    // 轉換為 mg/mL: c(mg/mL) = c(M) × MW(Da) / 1000(g→mg cancelled by L→mL)
    // ε 單位 M⁻¹cm⁻¹, c(M) × MW(g/mol) = g/L = mg/mL
    return concentrationM * mw;
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

/**
 * 經驗稀釋因子估算 (TPS 13A SEC-HPLC 校正)
 * 公式: DF = 1.907 + 12.981 × exp(-0.0431 × V)
 * 校準值: 100μL→2, 50μL→3.66, 30μL→5.25, 15μL→8.77
 * 誤差: ±7.33%
 *
 * @param {number} injectedVolume - 注射體積 (μL)
 * @returns {number} 稀釋因子
 */
function calculateDilutionFactorEmpirical(injectedVolume) {
    const df = 1.907 + 12.981 * Math.exp(-0.0431 * injectedVolume);
    return df;
}
