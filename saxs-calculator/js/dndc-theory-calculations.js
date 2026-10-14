/**
 * TPS13A SAXS Calculator - dn/dc 理論值、溫度／波長校正、Lorentz-Lorenz、Gladstone-Dale（對應 Python theoretical.py）
 *
 * 2026-10-14 從 dndc-calculations.js 純搬移拆出。頂層宣告（函式與常數）在全域作用域，由 dndc-calculations.js 結尾的匯出區塊
 * 在載入期讀取，所以本檔必須排在 dndc-calculations.js 之前（tests/structure.test.js 檢查）。
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
 * Default Cauchy dispersion coefficients for the specific refractive index
 * increment of proteins.
 *
 * 由蛋白質色散錨點 0.190 mL/g @ 589 nm、0.188 mL/g @ 633 nm 反推的 Cauchy
 * 擬合（A = 0.1756 mL/g、B = 5.0 × 10³ nm²·mL/g）；**未經原始文獻表值驗證**，
 * 僅作為比 λ⁻² 更合理的一階色散近似。若有實測色散資料應改用實測值。
 *   A: mL/g (wavelength-independent term)
 *   B: nm²·mL/g (dispersion term)
 * @type {{A: number, B: number}}
 */
const WAVELENGTH_CAUCHY_DEFAULTS = Object.freeze({ A: 0.1756, B: 5.0e3 });

/**
 * Apply wavelength correction using a Cauchy dispersion ratio.
 *
 *   dn/dc(λ₂) = dn/dc(λ₁) × (A + B/λ₂²) / (A + B/λ₁²)
 *
 * The previous λ⁻² scaling implicitly assumed A = 0, which overestimates the
 * dispersion (e.g. 589 → 658 nm was 20 % low).
 *
 * @param {number} dndcRef - dn/dc at the reference wavelength (mL/g)
 * @param {number} lambdaRef - Reference wavelength (nm)
 * @param {number} lambdaTarget - Target wavelength (nm)
 * @param {number} [cauchyA] - Cauchy constant term A (mL/g), protein default
 * @param {number} [cauchyB] - Cauchy dispersion term B (nm²·mL/g), protein default
 * @returns {number} Wavelength-corrected dn/dc (mL/g)
 */
function wavelengthCorrection(
    dndcRef,
    lambdaRef,
    lambdaTarget,
    cauchyA = WAVELENGTH_CAUCHY_DEFAULTS.A,
    cauchyB = WAVELENGTH_CAUCHY_DEFAULTS.B
) {
    if (!Number.isFinite(lambdaRef) || lambdaRef <= 0
        || !Number.isFinite(lambdaTarget) || lambdaTarget <= 0) {
        throw new Error('波長必須為大於 0 的有限數值 (nm)。');
    }
    const refTerm = cauchyA + cauchyB / (lambdaRef ** 2);
    const targetTerm = cauchyA + cauchyB / (lambdaTarget ** 2);
    if (!Number.isFinite(refTerm) || refTerm === 0) {
        throw new Error('波長校正失敗：Cauchy 係數無效（A + B/λ² = 0）。');
    }
    return dndcRef * (targetTerm / refTerm);
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
 * @param {number} [cauchyA] - Cauchy constant term A (mL/g)
 * @param {number} [cauchyB] - Cauchy dispersion term B (nm²·mL/g)
 * @returns {object} Correction breakdown
 */
function comprehensiveCorrection(
    refDndc, refTemp, refWave, targetTemp, targetWave,
    cauchyA = WAVELENGTH_CAUCHY_DEFAULTS.A,
    cauchyB = WAVELENGTH_CAUCHY_DEFAULTS.B
) {
    const TEMP_COEFF = -4e-4;
    // Back-calculate the value at 25 °C from the reference conditions
    const at25 = refDndc / (1 + TEMP_COEFF * (refTemp - 25));
    const tempCorrected = temperatureCorrection(at25, targetTemp);
    const tempContribution = tempCorrected - refDndc;
    const finalDndc = wavelengthCorrection(tempCorrected, refWave, targetWave, cauchyA, cauchyB);
    const waveContribution = finalDndc - tempCorrected;

    return {
        refDndc,
        refTemp,
        refWave,
        tempCorrected,
        tempContribution,
        finalDndc,
        waveContribution,
        cauchyA,
        cauchyB
    };
}

/**
 * Estimate dn/dc via the Lorentz-Lorenz equation (volume-additivity form).
 *
 *   dn/dc = (n_s² + 2)² / (6·n_s) × [f(n_p) − f(n_s)] / ρ_p,
 *   where f(n) = (n² − 1) / (n² + 2)
 *
 * Under the volume-additivity assumption both refraction terms are divided by
 * the polymer density (the solvent volume displaced per gram of polymer is
 * 1/ρ_p), so `densitySolvent` does not enter the formula.
 *
 * @param {number} nPolymer - Refractive index of the polymer
 * @param {number} nSolvent - Refractive index of the solvent
 * @param {number} densityPolymer - Density of the polymer (g/mL), ≈ 1/v̄
 * @param {number} [densitySolvent] - Density of the solvent (g/mL); kept for
 *        API compatibility, unused under the volume-additivity assumption
 * @returns {number} Estimated dn/dc (mL/g)
 */
function lorentzLorenz(nPolymer, nSolvent, densityPolymer, densitySolvent) {
    if (!(densityPolymer > 0)) {
        throw new Error('聚合物密度必須大於 0 g/mL。');
    }
    const n0Sq = nSolvent ** 2;
    const npSq = nPolymer ** 2;
    const prefactor = (n0Sq + 2) ** 2 / (6.0 * nSolvent);
    const fPolymer = (npSq - 1) / (npSq + 2);
    const fSolvent = (n0Sq - 1) / (n0Sq + 2);
    return prefactor * (fPolymer - fSolvent) / densityPolymer;
}

/**
 * Estimate dn/dc via the Gladstone-Dale approximation.
 *
 *   dn/dc = (n_p − n_s) / ρ_p   [mL/g]
 *
 * @param {number} nPolymer - Refractive index of the polymer
 * @param {number} nSolvent - Refractive index of the solvent
 * @param {number} densityPolymer - Density of the polymer (g/mL), ≈ 1/v̄
 * @returns {number} Estimated dn/dc (mL/g)
 */
function gladstoneDale(nPolymer, nSolvent, densityPolymer) {
    if (!(densityPolymer > 0)) {
        throw new Error('聚合物密度必須大於 0 g/mL。');
    }
    return (nPolymer - nSolvent) / densityPolymer;
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
