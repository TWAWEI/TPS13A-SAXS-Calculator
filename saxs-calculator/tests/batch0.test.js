'use strict';
/**
 * Regression tests for the 2026-08-21 batch-0 science fixes.
 *
 * Every expected value comes from the TPS13A Excel workbook
 * (TPS13A_protein solution SAXS ID-2024_10_01.xlsm) or from BSA reference
 * data — never from running the code under test.
 *
 * Run: node --test saxs-calculator/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SAXS, Protein, Dndc } = require('./load.js');

const within = (actual, lo, hi, msg) =>
    assert.ok(actual >= lo && actual <= hi, `${msg}: ${actual} not in [${lo}, ${hi}]`);
const approx = (actual, expected, rel, msg) =>
    assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel,
        `${msg}: ${actual} != ${expected} (rel ${rel})`);

// BSA reference (monomer)
const BSA_MW = 66430;

// ---------------------------------------------------------------- I(0)
test('I(0) contrast factor is first-principles (~7.9e-7), not 7.8e-6', () => {
    approx(SAXS.I0_CONTRAST_FACTOR, 7.9e-7, 0.1, 'I0_CONTRAST_FACTOR');
});

test('BSA 1 mg/mL theoretical I(0) ≈ 0.05 cm⁻¹ (Excel Protein_Io_cal_ method)', () => {
    const r = SAXS.calculateTheoreticalI0(BSA_MW, 1);
    within(r.theoreticalI0, 0.044, 0.055, 'theoreticalI0');
});

test('Excel-exact I(0): example protein (N_e 20605, V_dry 48694.7 Å³) → Protein_Io_cal_!N18 = 0.02337 cm⁻¹', () => {
    const r = SAXS.calculateTheoreticalI0(38536.61, 1, { electrons: 20605, dryVolume: 48694.7 });
    approx(r.exactI0, 0.023371, 2e-3, 'Excel N18 (reference value)');
    // primary value stays empirical, matching measured BSA 0.0526 cm⁻¹ at 1 mg/mL
    approx(r.theoreticalI0, 38536.61 * 7.9e-7, 0.02, 'primary I(0) is empirical');
});

test('I(0) no longer scales with (v̄/0.73)² — v̄ is not a free multiplier on contrast', () => {
    const a = SAXS.calculateTheoreticalI0(BSA_MW, 1).theoreticalI0;
    const b = SAXS.calculateTheoreticalI0(BSA_MW, 1, { partialSpecificVolume: 0.76 }).theoreticalI0;
    const c = SAXS.calculateTheoreticalI0(BSA_MW, 1, 0.76).theoreticalI0;
    assert.ok(Math.abs(b - a) < 1e-12 && Math.abs(c - a) < 1e-12, `v̄ must not rescale I(0): ${a} ${b} ${c}`);
});

test('measured I(0)=0.0526 cm⁻¹ at 1 mg/mL back-calculates to BSA MW', () => {
    const mw = SAXS.calculateMwFromI0(0.0526, 1);
    within(mw, 60000, 70000, 'MW from I(0)');
});

// ---------------------------------------------------------------- Rg
test('globular theoretical Rg follows Excel 0.251×MW^0.43 (BSA 29.7 Å, lysozyme 15.4 Å)', () => {
    approx(SAXS.calculateTheoreticalRg(BSA_MW, 'globular').theoreticalRg, 29.7, 0.02, 'BSA Rg');
    approx(SAXS.calculateTheoreticalRg(14313, 'globular').theoreticalRg, 15.4, 0.02, 'lysozyme Rg');
});

test('unfolded Rg uses residue count, not Da: BSA (583 aa) ≈ 2.54×583^0.522 ≈ 70.6 Å', () => {
    const withN = SAXS.calculateTheoreticalRg(BSA_MW, 'unfolded', 583).theoreticalRg;
    approx(withN, 70.6, 0.03, 'unfolded Rg with nResidues');
    const estimated = SAXS.calculateTheoreticalRg(BSA_MW, 'unfolded').theoreticalRg;
    within(estimated, 60, 85, 'unfolded Rg with MW/110 residue estimate (not 836 Å)');
});

test('HPLC dn/dc: zero / invalid concentration throws instead of returning 0', () => {
    const { time, uv, ri } = chromatogram({ uvZero: true });
    assert.throws(() => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, autoAlign: false }));
});

test('theoretical Dmax for BSA lands in the physical 75–95 Å range', () => {
    const all = SAXS.calculateAllTheoreticalParams(BSA_MW, 1, 'globular');
    const dmax = all.theoreticalDmax ?? all.dmax ?? (all.dmaxResult && all.dmaxResult.dmax);
    assert.ok(Number.isFinite(dmax), 'Dmax present');
    within(dmax, 75, 95, 'BSA theoretical Dmax');
});

// ---------------------------------------------------------------- electrons / volume
const EXCEL_EXAMPLE = 'A'.repeat(19) + 'R'.repeat(22) + 'N'.repeat(14) + 'D'.repeat(21) +
    'C'.repeat(3) + 'Q'.repeat(13) + 'E'.repeat(29) + 'G'.repeat(22) + 'H'.repeat(8) +
    'I'.repeat(23) + 'L'.repeat(28) + 'K'.repeat(32) + 'M'.repeat(7) + 'F'.repeat(13) +
    'P'.repeat(15) + 'S'.repeat(20) + 'T'.repeat(18) + 'W' + 'Y'.repeat(12) + 'V'.repeat(18);

test('electron count matches Excel Protein_Io_cal_!B16 (no water subtraction)', () => {
    const { composition, length } = Protein.parseSequence(EXCEL_EXAMPLE);
    assert.equal(length, 338);
    assert.equal(Protein.calculateElectronCount(composition), 20605);
});

test('Gly-Gly electrons = 2×30 (Excel residue table, no terminal correction)', () => {
    const { composition } = Protein.parseSequence('GG');
    assert.equal(Protein.calculateElectronCount(composition), 60);
});

test('dry volume matches Excel Protein_Io_cal_!B15 (48,694.7 Å³)', () => {
    const { composition } = Protein.parseSequence(EXCEL_EXAMPLE);
    approx(Protein.calculateDryVolume(composition), 48694.7, 1e-4, 'dry volume');
});

test('residue electron table equals Excel AP column', () => {
    const excel = { R: 85, N: 60, D: 59, C: 53, E: 67, Q: 68, K: 71, P: 52, A: 38, G: 30, W: 98, Y: 86 };
    for (const [aa, e] of Object.entries(excel)) {
        assert.equal(Protein.AMINO_ACIDS[aa].electrons, e, `electrons[${aa}]`);
    }
});

// ---------------------------------------------------------------- dn/dc synthetic chromatogram
const DT = 0.01;
function chromatogram({ uvHeight = 0.5, riHeight = 1.3875e-4, center = 8, sigma = 0.3, riDelay = 0, uvZero = false } = {}) {
    const time = [], uv = [], ri = [];
    for (let t = 0; t <= 20 + DT / 2; t += DT) {
        const g = (c) => Math.exp(-0.5 * ((t - c) / sigma) ** 2);
        time.push(t);
        uv.push(uvZero ? 0 : uvHeight * g(center));
        ri.push(riHeight * g(center + riDelay));
    }
    return { time, uv, ri };
}
// c_peak = 0.5 AU / (0.667 mL/(mg·cm) × 1 cm) = 0.75 mg/mL = 7.5e-4 g/mL
// Δn_peak = 0.185 mL/g × 7.5e-4 g/mL = 1.3875e-4 RIU  → dn/dc = 0.185 mL/g
const PARAMS = {
    peakStart: 7, peakEnd: 9,
    bl1Start: 3, bl1End: 4, bl2Start: 15, bl2End: 16,
    epsilon: 0.667, pathLen: 1, riFactor: 1, riDelay: 0,
    baselineMode: 'const', peakMode: 'height',
    manualC: null, autoAlign: false, decimalPlaces: 6,
};

test('HPLC dn/dc: height mode → 0.185 mL/g (not 1.85e-4)', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeHplcDndc(time, uv, ri, PARAMS);
    approx(r.dndc, 0.185, 1e-3, 'dndc height');
    approx(r.concentration, 0.75, 1e-3, 'concentration stays mg/mL for display');
});

test('HPLC dn/dc: area mode → 0.185 mL/g (shape factor cancels)', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, peakMode: 'area' });
    approx(r.dndc, 0.185, 1e-3, 'dndc area');
});

test('HPLC dn/dc: manualC 0.75 mg/mL + height mode → 0.185 mL/g', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, manualC: 0.75 });
    approx(r.dndc, 0.185, 1e-3, 'dndc manualC');
});

test('HPLC dn/dc: manualC + area mode is rejected (RIU·min ÷ mg/mL is not mL/g)', () => {
    const { time, uv, ri } = chromatogram();
    assert.throws(() => Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, manualC: 0.75, peakMode: 'area' }));
});

test('Slice dn/dc: slope over g/mL concentrations → 0.185 mL/g, R² ≈ 1', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeSliceDndc(time, uv, ri, PARAMS);
    approx(r.dndc, 0.185, 1e-3, 'slice dndc');
    assert.ok(r.fitResult.rSquared > 0.9999, `R² ${r.fitResult.rSquared}`);
    const cmax = Math.max(...r.sliceConcentrations);
    within(cmax, 7.0e-4, 7.6e-4, 'sliceConcentrations are g/mL (peak 7.5e-4)');
});

test('no UV channel (all zero) + manualC + autoAlign → alignment skipped, dn/dc 0.185 (not 0)', () => {
    const { time, uv, ri } = chromatogram({ uvZero: true });
    const r = Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, manualC: 0.75, autoAlign: true });
    approx(r.dndc, 0.185, 1e-3, 'dndc with zero UV');
    assert.equal(r.alignmentInfo && r.alignmentInfo.skipped, true, 'alignmentInfo.skipped');
});

test('autoAlign recovers a 0.2 min RI delay (20 points) and slice dn/dc stays 0.185', () => {
    const { time, uv, ri } = chromatogram({ riDelay: 0.2 });
    const r = Dndc.computeSliceDndc(time, uv, ri, { ...PARAMS, autoAlign: true });
    assert.equal(Math.abs(r.alignmentInfo.lag), 20, `lag ${r.alignmentInfo.lag}`);
    approx(r.dndc, 0.185, 2e-3, 'slice dndc after auto-align');
    assert.ok(r.fitResult.rSquared > 0.999, `R² ${r.fitResult.rSquared}`);
});

test('manual riDelay=+0.2 min (RI later than UV) shifts RI earlier: slice fit R² ≈ 1', () => {
    const { time, uv, ri } = chromatogram({ riDelay: 0.2 });
    const r = Dndc.computeSliceDndc(time, uv, ri, { ...PARAMS, riDelay: 0.2 });
    approx(r.dndc, 0.185, 2e-3, 'slice dndc with manual delay');
    assert.ok(r.fitResult.rSquared > 0.999, `R² ${r.fitResult.rSquared} — wrong sign would give a banana plot`);
});

test('peak_max alignment clamps absurd lags instead of applying them', () => {
    const { time, uv, ri } = chromatogram({ riDelay: 3.0 }); // 300 points ≫ maxLag 50
    const info = Dndc.computeTimeLag(uv, ri, 'peak_max', null, 50);
    assert.equal(info.lag, 0, 'lag reset to 0');
    assert.equal(info.clamped, true, 'clamped flag');
});

// ---------------------------------------------------------------- theory
test('wavelength correction is Cauchy dispersion: 0.185@589 → 658 nm ≈ 0.182–0.186', () => {
    // Literature dispersion anchors put the 589→658 nm change at −1% … −2.5%
    const v = Dndc.wavelengthCorrection(0.185, 589, 658);
    within(typeof v === 'number' ? v : v.dndc, 0.185 * 0.975, 0.185 * 0.99, '589→658 (−1%…−2.5%)');
    const same = Dndc.wavelengthCorrection(0.185, 658, 658);
    approx(typeof same === 'number' ? same : same.dndc, 0.185, 1e-12, 'identity');
    const blue = Dndc.wavelengthCorrection(0.185, 633, 436);
    approx(typeof blue === 'number' ? blue : blue.dndc, 0.197, 0.03, '633→436');
});

test('Lorentz-Lorenz divides both terms by ρ_polymer: protein params → ≈0.178 mL/g, never negative', () => {
    const protein = Dndc.lorentzLorenz(1.60, 1.333, 1.37, 1.0);
    approx(typeof protein === 'number' ? protein : protein.dndc, 0.178, 0.03, 'protein LL');
    const page = Dndc.lorentzLorenz(1.45, 1.333, 1.35, 1.0);
    approx(typeof page === 'number' ? page : page.dndc, 0.083, 0.025, 'old page defaults');
    const zero = Dndc.lorentzLorenz(1.5, 1.5, 1.35, 1.0);
    approx((typeof zero === 'number' ? zero : zero.dndc) + 1, 1, 1e-12, 'n_p = n_s → 0');
});

test('Gladstone-Dale = (n_p − n_s)/ρ_p', () => {
    const v = Dndc.gladstoneDale(1.45, 1.333, 1.35);
    approx(typeof v === 'number' ? v : v.dndc, 0.0867, 1e-3, 'GD');
});
