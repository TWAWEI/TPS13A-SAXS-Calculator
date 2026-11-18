'use strict';
/**
 * Gate G3: sasmodels' own model tests (model_info.tests) and the 1D smoke
 * tests of model_test.py run_all, replayed against the JS port with sasmodels'
 * own tolerance (is_near, digits 5) and its API defaults (*_pd_n 0, cutoff 0).
 *
 * The adapter mirrors model_test.py run_one (336-357):
 *   kind 'Iq'  call_kernel  -> SasFitEvaluate.evaluate (P, P@S and the JS models)
 *   kind 'Fq'  call_Fq      -> kernel.Fq, compared in sasmodels' order
 *                              F (skipped when the model has no F), F^2, R_eff,
 *                              V_shell, form:shell ratio
 * Two things sasmodels' call_Fq accepts that the production kernels do not are
 * handled here, in the adapter, and nowhere else:
 *   - a C model without effective-radius modes called with mode 1 (the Fq
 *     smoke test): sasmodels generates CALL_RADIUS_EFFECTIVE as 0.0
 *     (generate.py:1034), so mode 1 returns the same as mode 0 (R_eff 0);
 *     kernel.Fq rejects modes above reffModes.length, so mode 0 is passed.
 *   - the two Python-kernel models: PyKernel returns F None, F^2 = Iq (weight,
 *     form and shell volume 1), R_eff 1.0 for any mode other than 0
 *     (kernelpy.py:176-181, 187-188), V_shell 1, ratio 1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitMeta, SasFitKernel, SasFitPyModels, SasFitEvaluate } = require('./load.js');
const { loadFixture, num, loadWasm } = require('./sasfit-helpers.js');

const g3 = loadFixture('g3');
const G3_ENTRIES = 97;
const G3_OFFICIAL = 52;
const G3_SMOKE = 45;
// official 1D non-magnetic tests + 3 smoke tests per model
const G3_PER_MODEL = Object.freeze({
    sphere: 15, core_shell_sphere: 5, vesicle: 7, ellipsoid: 8, cylinder: 19,
    core_shell_cylinder: 4, flexible_cylinder: 7, lamellar: 4, guinier: 4, guinier_porod: 4,
    power_law: 4, mono_gauss_coil: 4, gaussian_peak: 3, hardsphere: 4, hayter_msa: 5,
});
const DIGITS = g3.tolerance.digits;
const OPTS = Object.freeze({ cutoff: g3.cutoff });
const WASM_MODELS = SasFitMeta.order.filter((name) => SasFitMeta.models[name].kind === 'c');
const PY_KERNEL_RADIUS = 1.0;   // kernelpy.py:181: no radius_effective and no form_volume

/** model_test.py is_near (443-471), as recorded in the fixture's `tolerance`. */
function isNear(target, actual, digits) {
    if (target === null) return !Number.isNaN(actual);
    if (target === 0) return actual === 0;
    if (Number.isFinite(target)) {
        const shift = Math.ceil(Math.log10(Math.abs(target)));
        return Math.abs(target - actual) < 1.5 * Math.pow(10, shift - digits);
    }
    if (target === actual) return true;
    return Number.isNaN(target) === Number.isNaN(actual);
}

const target = (v) => (v === null ? null : num(v));

/** _check_vectors (364-381); a null target vector is not compared. */
function checkVector(failures, name, expected, actual) {
    if (!(actual.length > 0)) return failures.push(name + '(...) expected return value');
    if (expected === null) return undefined;
    if (expected.length !== actual.length) return failures.push(name + '(...) returned wrong length');
    for (let i = 0; i < expected.length; i++) {
        if (!isNear(target(expected[i]), actual[i], DIGITS)) {
            return failures.push(name + '[' + i + ']: expected ' + expected[i] + ', actual ' + actual[i]);
        }
    }
    return undefined;
}

/** _check_scalar (359-362). */
function checkScalar(failures, name, expected, actual) {
    if (!isNear(target(expected), actual, DIGITS)) {
        failures.push(name + ': expected ' + expected + ', actual ' + actual);
    }
}

/** call_Fq for one entry; see the file header for the two adapter rules. */
function callFq(entry, kernels) {
    const meta = SasFitMeta.models[entry.model];
    const q = Float64Array.from(entry.q);
    const mode = entry.radiusEffectiveMode;
    if (meta.kind === 'js') {
        const F2 = SasFitPyModels.models[entry.model].Iq(q, Object.assign({}, entry.pars, { scale: 1, background: 0 }));
        return { F1: null, F2, radiusEffective: mode === 0 ? 0 : PY_KERNEL_RADIUS, shellVolume: 1, volumeRatio: 1 };
    }
    const kernel = SasFitKernel.create(meta, kernels[entry.model]);
    const radiusEffectiveMode = meta.reffModes.length === 0 ? 0 : mode;
    return kernel.Fq(q, entry.pars, { cutoff: OPTS.cutoff, radiusEffectiveMode });
}

/** run_one (336-357): the failure messages of one entry (empty = pass). */
function runOne(entry, kernels) {
    const failures = [];
    if (entry.kind === 'Iq') {
        const spec = { model: entry.model, structure: entry.structure, lowQPowerLaw: false };
        const out = SasFitEvaluate.evaluate(spec, entry.pars, Float64Array.from(entry.q), OPTS, kernels);
        checkVector(failures, 'I', entry.expected, out.I);
        return failures;
    }
    assert.equal(entry.kind, 'Fq', 'unknown kind ' + entry.kind);
    assert.equal(entry.structure, null, 'an Fq test on a product is not part of the fixture');
    const fq = callFq(entry, kernels);
    if (fq.F1 !== null) checkVector(failures, 'F', entry.expected.F1, fq.F1);
    checkVector(failures, 'F^2', entry.expected.F2, fq.F2);
    checkScalar(failures, 'R_eff', entry.expected.radiusEffective, fq.radiusEffective);
    checkScalar(failures, 'volume', entry.expected.shellVolume, fq.shellVolume);
    checkScalar(failures, 'form:shell ratio', entry.expected.volumeRatio, fq.volumeRatio);
    return failures;
}

async function loadKernels() {
    const list = await Promise.all(WASM_MODELS.map((name) => SasFitKernel.instantiate(loadWasm(name))));
    return Object.freeze(Object.fromEntries(WASM_MODELS.map((name, i) => [name, list[i]])));
}

function countBy(entries, key) {
    const counts = {};
    entries.forEach((e) => { counts[key(e)] = (counts[key(e)] || 0) + 1; });
    return counts;
}

test('g3 has the expected entries and tolerance rule', () => {
    assert.equal(g3.sasmodelsVersion, SasFitMeta.sasmodelsVersion);
    assert.equal(g3.cutoff, 0);
    assert.equal(DIGITS, 5);
    assert.equal(g3.tolerance.rules.targetFinite, '|t-a| < 1.5*10^(ceil(log10|t|)-digits)');
    assert.equal(g3.cases.length, G3_ENTRIES);
    assert.deepEqual(countBy(g3.cases, (e) => e.source), { official: G3_OFFICIAL, smoke: G3_SMOKE });
    assert.deepEqual(countBy(g3.cases, (e) => e.model), G3_PER_MODEL);
    assert.deepEqual(Object.keys(G3_PER_MODEL), SasFitMeta.order);
});

test('is_near follows model_test.py', () => {
    assert.equal(isNear(null, 3, 5), true);
    assert.equal(isNear(null, Infinity, 5), true);       // "not NaN", not "finite"
    assert.equal(isNear(null, NaN, 5), false);
    assert.equal(isNear(0, 0, 5), true);
    assert.equal(isNear(0, 1e-300, 5), false);
    // target 1234.5: shift 4, bound 1.5e-1 (strict)
    assert.equal(isNear(1234.5, 1234.5 + 0.149, 5), true);
    assert.equal(isNear(1234.5, 1234.5 + 0.151, 5), false);
    // an exact power of ten keeps shift = log10: 1 -> bound 1.5e-5
    assert.equal(isNear(1, 1 + 1.4e-5, 5), true);
    assert.equal(isNear(1, 1 + 1.6e-5, 5), false);
    assert.equal(isNear(-0.05, -0.05 + 1.4e-6, 5), true);
    assert.equal(isNear(-0.05, -0.05 + 1.6e-6, 5), false);
    assert.equal(isNear(2, NaN, 5), false);
    assert.equal(isNear(Infinity, Infinity, 5), true);
    // As written in model_test.py:466-471, an infinite target that differs from the actual
    // value falls through to the NaN comparison, so it only rejects NaN (the docstring and the
    // fixture's "targetInf" note say "must be equal"). No g3 target is infinite.
    assert.equal(isNear(Infinity, -Infinity, 5), true);
    assert.equal(isNear(Infinity, 5, 5), true);
    assert.equal(isNear(Infinity, NaN, 5), false);
    assert.equal(isNear(NaN, NaN, 5), true);
    assert.equal(isNear(NaN, 1, 5), false);
});

test('no g3 target is infinite or NaN', () => {
    const flat = (e) => (e.kind === 'Iq' ? e.expected
        : [].concat(e.expected.F1, e.expected.F2, e.expected.radiusEffective,
            e.expected.shellVolume, e.expected.volumeRatio));
    g3.cases.forEach((e) => flat(e).forEach((v) => {
        assert.ok(v === null || Number.isFinite(v), e.model + ' / ' + e.label + ': target ' + v);
    }));
});

test('G3: sasmodels official 1D tests and smoke tests', async (t) => {
    const kernels = await loadKernels();
    const ran = {};
    const passed = {};
    const failures = [];
    SasFitMeta.order.forEach((name) => { ran[name] = 0; passed[name] = 0; });
    for (const entry of g3.cases) {
        const messages = runOne(entry, kernels);
        ran[entry.model] += 1;
        if (messages.length === 0) passed[entry.model] += 1;
        else failures.push(entry.model + ' / ' + entry.label + ': ' + messages.join('; '));
    }
    const total = Object.values(ran).reduce((a, b) => a + b, 0);
    SasFitMeta.order.forEach((name) => {
        t.diagnostic('G3 ' + name + ': ' + passed[name] + '/' + ran[name] + ' passed');
    });
    t.diagnostic('G3 total: ' + Object.values(passed).reduce((a, b) => a + b, 0) + '/' + total + ' passed');
    assert.deepEqual(failures, []);
    assert.deepEqual(ran, G3_PER_MODEL);
    assert.deepEqual(ran, countBy(g3.cases, (e) => e.model));
    assert.deepEqual(passed, ran);
    assert.equal(total, G3_ENTRIES);
    assert.equal(total, g3.cases.length, 'no g3 entry may be skipped');
});
