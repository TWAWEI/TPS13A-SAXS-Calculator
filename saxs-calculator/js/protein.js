/**
 * TPS13A SAXS Calculator - Protein Analysis Module
 * 蛋白質序列分析與計算
 */

// 氨基酸資料表
// volume / electrons 為「殘基」值（已扣一個水），與 TPS13A Excel
// `Protein_Io_cal_` 分頁（電子數 B 欄、殘基體積 AN 欄）一致。
// mw 仍為自由氨基酸分子量，聚合時另扣 (n−1) × H2O。
const AMINO_ACIDS = {
    'A': { name: 'Ala', mw: 89.09, volume: 91.5, electrons: 38 },
    'R': { name: 'Arg', mw: 174.20, volume: 180.8, electrons: 85 },
    'N': { name: 'Asn', mw: 132.12, volume: 135.2, electrons: 60 },
    'D': { name: 'Asp', mw: 133.10, volume: 113.6, electrons: 59 },
    'C': { name: 'Cys', mw: 121.16, volume: 105.6, electrons: 53 },
    'E': { name: 'Glu', mw: 147.13, volume: 140.6, electrons: 67 },
    'Q': { name: 'Gln', mw: 146.15, volume: 161.1, electrons: 68 },
    'G': { name: 'Gly', mw: 75.07, volume: 66.4, electrons: 30 },
    'H': { name: 'His', mw: 155.16, volume: 167.3, electrons: 72 },
    'I': { name: 'Ile', mw: 131.18, volume: 168.8, electrons: 62 },
    'L': { name: 'Leu', mw: 131.18, volume: 167.9, electrons: 62 },
    'K': { name: 'Lys', mw: 146.19, volume: 176.2, electrons: 71 },
    'M': { name: 'Met', mw: 149.21, volume: 170.8, electrons: 70 },
    'F': { name: 'Phe', mw: 165.19, volume: 203.4, electrons: 78 },
    'P': { name: 'Pro', mw: 115.13, volume: 129.3, electrons: 52 },
    'S': { name: 'Ser', mw: 105.09, volume: 99.1, electrons: 46 },
    'T': { name: 'Thr', mw: 119.12, volume: 122.1, electrons: 54 },
    'W': { name: 'Trp', mw: 204.23, volume: 237.6, electrons: 98 },
    'Y': { name: 'Tyr', mw: 181.19, volume: 203.6, electrons: 86 },
    'V': { name: 'Val', mw: 117.15, volume: 141.7, electrons: 54 }
};

// 消光係數 (280nm, M-1 cm-1)
const EXTINCTION_COEFFS = {
    'W': 5500,  // Tryptophan
    'Y': 1490,  // Tyrosine
    'C': 125    // Cystine (disulfide)
};

const WATER_MW = 18.015;

/**
 * 解析蛋白質序列
 * @param {string} sequence - 單字母氨基酸序列
 * @returns {object} 解析結果
 */
function parseSequence(sequence) {
    // 清理序列：移除空白、數字、換行
    const cleaned = sequence.toUpperCase().replace(/[^A-Z]/g, '');
    
    // 統計各氨基酸數量
    const composition = {};
    let validCount = 0;
    let invalidChars = [];
    
    for (const char of cleaned) {
        if (AMINO_ACIDS[char]) {
            composition[char] = (composition[char] || 0) + 1;
            validCount++;
        } else {
            invalidChars.push(char);
        }
    }
    
    return {
        sequence: cleaned,
        length: validCount,
        composition: composition,
        invalidChars: [...new Set(invalidChars)],
        isValid: invalidChars.length === 0 && validCount > 0
    };
}

/**
 * 計算分子量
 * @param {object} composition - 氨基酸組成
 * @returns {number} 分子量 (Da)
 */
function calculateMolecularWeight(composition) {
    let mw = 0;
    let totalResidues = 0;
    
    for (const [aa, count] of Object.entries(composition)) {
        if (AMINO_ACIDS[aa]) {
            mw += AMINO_ACIDS[aa].mw * count;
            totalResidues += count;
        }
    }
    
    // 減去聚合時失去的水分子 (n-1 個水分子)
    if (totalResidues > 1) {
        mw -= (totalResidues - 1) * WATER_MW;
    }
    
    return mw;
}

/**
 * 計算乾燥體積
 * @param {object} composition - 氨基酸組成
 * @returns {number} 體積 (Å³)
 */
function calculateDryVolume(composition) {
    let volume = 0;
    
    for (const [aa, count] of Object.entries(composition)) {
        if (AMINO_ACIDS[aa]) {
            volume += AMINO_ACIDS[aa].volume * count;
        }
    }
    
    return volume;
}

/**
 * 計算總電子數
 * @param {object} composition - 氨基酸組成
 * @returns {number} 電子數
 */
function calculateElectronCount(composition) {
    let electrons = 0;

    for (const [aa, count] of Object.entries(composition)) {
        if (AMINO_ACIDS[aa]) {
            electrons += AMINO_ACIDS[aa].electrons * count;
        }
    }

    // 表值為殘基電子數（已扣一個水），與 TPS13A Excel `Protein_Io_cal_!B16`
    // 一致（該式的扣水項乘 0），因此這裡不再扣水。
    return electrons;
}

/**
 * 計算消光係數 (280nm)
 * @param {object} composition - 氨基酸組成
 * @param {boolean} reducedCysteine - 是否為還原態半胱氨酸
 * @returns {object} 消光係數資訊
 */
function calculateExtinctionCoeff(composition, reducedCysteine = false) {
    const nW = composition['W'] || 0;  // Trp
    const nY = composition['Y'] || 0;  // Tyr
    const nC = composition['C'] || 0;  // Cys
    
    // 二硫鍵數量 (假設全部形成)
    const nDisulfide = reducedCysteine ? 0 : Math.floor(nC / 2);
    
    // ε = nW × 5500 + nY × 1490 + nDisulfide × 125
    const epsilon = nW * EXTINCTION_COEFFS['W'] + 
                   nY * EXTINCTION_COEFFS['Y'] + 
                   nDisulfide * EXTINCTION_COEFFS['C'];
    
    return {
        epsilon: epsilon,           // M-1 cm-1
        nTrp: nW,
        nTyr: nY,
        nCys: nC,
        nDisulfide: nDisulfide
    };
}

/**
 * 計算 dn/dc (折射率增量)
 * @param {number} mw - 分子量
 * @returns {number} dn/dc (mL/g)
 */
function calculateDnDc(mw) {
    // 典型蛋白質 dn/dc ≈ 0.185 mL/g
    // 可根據組成微調，這裡使用標準值
    return 0.185;
}

/**
 * 計算部分比容 (partial specific volume)
 * @param {object} composition - 氨基酸組成
 * @returns {number} v-bar (cm³/g)
 */
function calculatePartialSpecificVolume(composition) {
    // 使用加權平均計算
    // 典型蛋白質 v-bar ≈ 0.73 cm³/g
    const dryVolume = calculateDryVolume(composition);
    const mw = calculateMolecularWeight(composition);
    
    // V(Å³) → cm³/mol，除以 MW 得到 cm³/g
    // 1 Å³ = 1e-24 cm³, 乘以 Avogadro 數
    const avogadro = 6.022e23;
    const vbar = (dryVolume * 1e-24 * avogadro) / mw;
    
    return vbar;
}

/**
 * 計算 epsilon (cm² g⁻¹) 用於 SAXS
 * @param {object} extinctionData - 消光係數資料
 * @param {number} mw - 分子量
 * @returns {number} epsilon (cm² g⁻¹)
 */
function calculateEpsilonCm2g(extinctionData, mw) {
    // 將 M-1 cm-1 轉換為 cm² g⁻¹
    // ε (cm² g⁻¹) = ε (M⁻¹ cm⁻¹) / MW × 1000
    return (extinctionData.epsilon / mw) * 1000;
}

/**
 * 質量消光係數：把 ε [M⁻¹cm⁻¹] 換成濃度單位可直接用的兩種寫法。
 *
 *   ε_mass [mL·mg⁻¹·cm⁻¹] = ε / MW[Da]   ← 就是 A280 (0.1%)，HPLC dn/dc 頁的輸入
 *   ASTRA  [mL·g⁻¹·cm⁻¹]  = ε_mass × 1000 ← .afe7 的 m_dUVExtinctionCoefficient
 *
 * 兩者只差 1000 倍，混用就是 1000 倍的濃度誤差，所以一次回傳兩個值，
 * 呼叫端不必自己乘除。回傳的是未四捨五入的原始數字，格式化交給顯示層。
 *
 * @param {{epsilon: number}} extinctionData - calculateExtinctionCoeff 的結果
 * @param {number} mw - 分子量 (Da)
 * @returns {{mlPerMgCm: number, mlPerGCm: number}} 兩種單位的質量消光係數
 * @throws {Error} ε 或 MW 無效時（寧可中止，也不要讓 NaN/Infinity 流進 dn/dc 計算）
 */
function calculateMassExtinction(extinctionData, mw) {
    const epsilon = extinctionData && extinctionData.epsilon;
    if (!Number.isFinite(epsilon) || epsilon < 0) {
        throw new Error('消光係數 ε 無效：需要 ≥ 0 的數值 (M⁻¹cm⁻¹)');
    }
    if (!Number.isFinite(mw) || mw <= 0) {
        throw new Error('分子量無效：需要大於 0 的數值 (Da)');
    }

    const mlPerMgCm = epsilon / mw;
    return { mlPerMgCm, mlPerGCm: mlPerMgCm * 1000 };
}

/**
 * 完整蛋白質分析
 * @param {string} sequence - 蛋白質序列
 * @returns {object} 完整分析結果
 */
function analyzeProtein(sequence) {
    const parsed = parseSequence(sequence);
    
    if (!parsed.isValid) {
        return {
            error: true,
            message: parsed.length === 0 ? 
                '請輸入有效的蛋白質序列' : 
                `包含無效字符: ${parsed.invalidChars.join(', ')}`,
            parsed: parsed
        };
    }
    
    const mw = calculateMolecularWeight(parsed.composition);
    const dryVolume = calculateDryVolume(parsed.composition);
    const electrons = calculateElectronCount(parsed.composition);
    const extinction = calculateExtinctionCoeff(parsed.composition);
    const vbar = calculatePartialSpecificVolume(parsed.composition);
    const dndc = calculateDnDc(mw);
    const epsilonCm2g = calculateEpsilonCm2g(extinction, mw);
    const massExtinction = calculateMassExtinction(extinction, mw);

    return {
        error: false,
        sequence: parsed.sequence,
        length: parsed.length,
        composition: parsed.composition,
        molecularWeight: mw,
        molecularWeightKDa: mw / 1000,
        dryVolume: dryVolume,
        electronCount: electrons,
        extinction: extinction,
        epsilonCm2g: epsilonCm2g,
        // ε_mass（mL·mg⁻¹cm⁻¹）與 ASTRA 單位（mL·g⁻¹cm⁻¹）；後者與 epsilonCm2g 同值
        massExtinction: massExtinction,
        partialSpecificVolume: vbar,
        dndc: dndc,
        // 用於 IUCr 表格
        iucrParams: {
            mw: mw.toFixed(2),
            vbar: vbar.toFixed(6),
            dndc: dndc.toFixed(4)
        }
    };
}

// 導出函數
window.ProteinAnalysis = {
    parseSequence,
    calculateMolecularWeight,
    calculateDryVolume,
    calculateElectronCount,
    calculateExtinctionCoeff,
    calculatePartialSpecificVolume,
    calculateDnDc,
    calculateEpsilonCm2g,
    calculateMassExtinction,
    analyzeProtein,
    AMINO_ACIDS
};
