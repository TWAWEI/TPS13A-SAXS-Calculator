'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitMeta, SasFitKernel, SasFitProduct, SasFitEvaluate, SasFitValidate } = require('./load.js');
const { loadFixture, qOf, isComponentGated, assertClose, assertCloseRel, loadWasm } = require('./sasfit-helpers.js');

const g1 = loadFixture('g1');
// 100 without S(Q): 86 (17 defaults incl. the two S(q) alone, 68 single-pd, 1 two-pd, minus the
// two P@S defaults, plus 2 low-Q) and, from the M1 review, 4 hayter_msa S(q) with non-default
// parameters ("hmsa:"), 8 with the other four distributions ("dist:"), 2 with three pd ("pd3:").
// 67 with S(Q): 59 gated end to end (the 58 of sasfit-product.test.js + 1 low-Q) and 8
// P@hayter_msa with non-default S parameters (gate "component"), which are NOT compared end to
// end here or anywhere: their gate is the component layer of sasfit-product.test.js (spec 16).
const G1_CASES = 167;
const G1_STRICT_CASES = 100;
const G1_PRODUCT_CASES = 59;
const G1_COMPONENT_ONLY_CASES = 8;
const G1_END_TO_END_GATED_CASES = 159;   // strict + product
const G1_ADDED = Object.freeze({ hmsa: 12, dist: 8, pd3: 2 });
const G1_LOWQ_CASES = 3;
// End-to-end P@S only (plan rule 6, spec 15 decision 19); the component layer at 1e-9 is in
// sasfit-product.test.js.
const END_TO_END_REL = 1e-7;
const STRICT_REL = 1e-9;
const ABS_TOL_SCALE = 1e-12;
const DEFAULT_CUTOFF = 1e-5;
const CUT = Object.freeze({ cutoff: g1.cutoff });
const q = Float64Array.from(g1.q);
const WASM_MODELS = SasFitMeta.order.filter((name) => SasFitMeta.models[name].kind === 'c');
const SCHULZ = Object.freeze(
    { radius_pd: 0.2, radius_pd_n: 80, radius_pd_nsigma: 3, radius_pd_type: 'schulz' });
const SPHERE = Object.freeze({ model: 'sphere', structure: null, lowQPowerLaw: false });
const SPHERE_LOWQ = Object.freeze({ model: 'sphere', structure: null, lowQPowerLaw: true });
const SPHERE_HS = Object.freeze({ model: 'sphere', structure: 'hardsphere', lowQPowerLaw: false });

let kernelsPromise = null;
function loadKernels() {
    if (!kernelsPromise) {
        kernelsPromise = Promise.all(WASM_MODELS.map((name) => SasFitKernel.instantiate(loadWasm(name))))
            .then((list) => Object.freeze(Object.fromEntries(WASM_MODELS.map((name, i) => [name, list[i]]))));
    }
    return kernelsPromise;
}

/** Worst |got - ref| relative to the tolerance of the group (<= 1 passes), for the report. */
function toleranceRatio(got, ref, rel) {
    const refMax = ref.reduce((m, r) => Math.max(m, Math.abs(r)), 0);
    let worst = 0;
    for (let i = 0; i < ref.length; i++) {
        const tol = rel * Math.abs(ref[i]) + ABS_TOL_SCALE * refMax;
        worst = Math.max(worst, Math.abs(got[i] - ref[i]) / tol);
    }
    return worst;
}

test('g1 has the expected number of cases', () => {
    assert.equal(g1.cutoff, DEFAULT_CUTOFF);
    assert.equal(g1.q.length, 200);
    assert.equal(g1.cases.length, G1_CASES);
    assert.equal(g1.cases.filter((c) => c.modelSpec.structure === null).length, G1_STRICT_CASES);
    assert.equal(g1.cases.filter((c) => c.modelSpec.structure !== null && !isComponentGated(c)).length,
        G1_PRODUCT_CASES);
    const componentOnly = g1.cases.filter(isComponentGated);
    assert.equal(componentOnly.length, G1_COMPONENT_ONLY_CASES);
    componentOnly.forEach((c) => {
        assert.ok(/^hmsa: /.test(c.label) && c.modelSpec.structure === 'hayter_msa' && !c.modelSpec.lowQPowerLaw,
            'only P@hayter_msa "hmsa:" cases may be component-gated: ' + c.label);
    });
    assert.equal(G1_STRICT_CASES + G1_PRODUCT_CASES, G1_END_TO_END_GATED_CASES);
    assert.equal(G1_END_TO_END_GATED_CASES + G1_COMPONENT_ONLY_CASES, G1_CASES);
    const added = { hmsa: 0, dist: 0, pd3: 0 };
    g1.cases.forEach((c) => {
        const prefix = /^(hmsa|dist|pd3): /.exec(c.label);
        if (prefix) added[prefix[1]] += 1;
    });
    assert.deepEqual(added, G1_ADDED);
    assert.equal(new Set(g1.cases.map((c) => c.label)).size, g1.cases.length, 'labels are unique');
    assert.equal(g1.cases.filter((c) => c.modelSpec.lowQPowerLaw).length, G1_LOWQ_CASES);
    assert.equal(WASM_MODELS.length, 13);
});

test('G1: every g1 case through evaluate (1e-9; end-to-end P@S 1e-7; component-gated cases only run)', async (t) => {
    const kernels = await loadKernels();
    const ran = { strict: 0, product: 0, componentOnly: 0 };
    const worst = { strict: { ratio: -1, label: '' }, product: { ratio: -1, label: '' } };
    const notCompared = { nonFinite: 0, worstRel: 0, label: '' };
    for (const c of g1.cases) {
        const out = SasFitEvaluate.evaluate(c.modelSpec, c.pars, qOf(g1, c), CUT, kernels);
        if (isComponentGated(c)) {
            // evaluate must run and return a full curve; the numbers are reported, not gated
            assert.ok(out.I instanceof Float64Array && out.I.length === c.Iq.length, c.label);
            assert.equal(out.extras.S.length, c.Iq.length, c.label);
            out.I.forEach((v, i) => {
                const rel = Math.abs(v - c.Iq[i]) / Math.abs(c.Iq[i]);
                if (!Number.isFinite(v)) notCompared.nonFinite += 1;
                else if (rel > notCompared.worstRel) Object.assign(notCompared, { worstRel: rel, label: c.label });
            });
            ran.componentOnly += 1;
            continue;
        }
        const isProduct = c.modelSpec.structure !== null;
        const group = isProduct ? 'product' : 'strict';
        if (isProduct) assertCloseRel(out.I, c.Iq, c.label, END_TO_END_REL);
        else assertClose(out.I, c.Iq, c.label);
        const ratio = toleranceRatio(out.I, c.Iq, isProduct ? END_TO_END_REL : STRICT_REL);
        if (ratio > worst[group].ratio) worst[group] = { ratio, label: c.label };
        ran[group] += 1;
    }
    assert.deepEqual(ran, { strict: G1_STRICT_CASES, product: G1_PRODUCT_CASES,
        componentOnly: G1_COMPONENT_ONLY_CASES });
    assert.equal(ran.strict + ran.product, G1_END_TO_END_GATED_CASES);
    assert.equal(ran.strict + ran.product + ran.componentOnly, G1_CASES);
    assert.equal(ran.strict + ran.product + ran.componentOnly, g1.cases.length, 'no g1 case may be skipped');
    t.diagnostic('G1 component-only (P@hayter_msa, non-default S parameters): ' + ran.componentOnly
        + ' cases run but NOT compared end to end; non-finite points ' + notCompared.nonFinite
        + ', worst relative difference ' + notCompared.worstRel.toExponential(3) + ' at "' + notCompared.label + '"');
    t.diagnostic('G1 strict (1e-9): ' + ran.strict + ' cases, worst |d|/tol = '
        + worst.strict.ratio.toExponential(3) + ' at "' + worst.strict.label + '"');
    t.diagnostic('G1 P@S end-to-end (1e-7): ' + ran.product + ' cases, worst |d|/tol = '
        + worst.product.ratio.toExponential(3) + ' at "' + worst.product.label + '"');
});

test('extras: P@S intermediates from one evaluation of P, {} otherwise', async () => {
    const kernels = await loadKernels();
    const pars = Object.assign({ volfraction: 0.25, radius_effective_mode: 1 }, SCHULZ);
    let calls = 0;
    const counted = Object.assign({}, kernels.sphere,
        { sphere_Iq: (...args) => { calls += 1; return kernels.sphere.sphere_Iq(...args); } });
    const out = SasFitEvaluate.evaluate(SPHERE_HS, pars, q, CUT, Object.assign({}, kernels, { sphere: counted }));
    assert.equal(calls, 1, 'P is evaluated once (80 mesh points are one chunk)');
    const product = SasFitProduct.create(SasFitMeta.models.sphere, SasFitMeta.models.hardsphere,
        SasFitKernel.create(SasFitMeta.models.sphere, kernels.sphere),
        SasFitKernel.create(SasFitMeta.models.hardsphere, kernels.hardsphere));
    const parts = product.parts(q, pars, CUT);
    assert.deepEqual(Object.keys(out.extras).sort(), ['S', 'radiusEffective', 'volumeRatio']);
    assert.equal(out.extras.radiusEffective, parts.radiusEffective);
    assert.equal(out.extras.volumeRatio, parts.volumeRatio);
    assert.deepEqual(out.extras.S, parts.S);
    assert.deepEqual(out.I, parts.Iq);
    assert.ok(Math.abs(out.extras.radiusEffective - 50) < 5, 'average radius of the distribution');
    assert.equal(out.extras.volumeRatio, 1);

    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE, {}, q, CUT, kernels).extras, {});
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE_LOWQ, {}, q, CUT, kernels).extras, {});
    const js = { model: 'power_law', structure: null, lowQPowerLaw: false };
    assert.deepEqual(SasFitEvaluate.evaluate(js, {}, q, CUT, kernels).extras, {});
});

test('low-Q power law: I_total = I_model + lowq_scale*q^-lowq_power, one background', async () => {
    const kernels = await loadKernels();
    const lowq = { lowq_scale: 2e-6, lowq_power: 3.5 };
    const cases = [
        [SPHERE, { scale: 0.8, background: 0.002 }],
        [SPHERE_HS, Object.assign({ scale: 0.8, background: 0.002, structure_factor_mode: 1 }, SCHULZ)],
        [{ model: 'guinier_porod', structure: null, lowQPowerLaw: false }, { background: 0.01 }],
    ];
    cases.forEach(([spec, pars]) => {
        const withLowQ = Object.assign({}, spec, { lowQPowerLaw: true });
        const total = SasFitEvaluate.evaluate(withLowQ, Object.assign({}, pars, lowq), q, CUT, kernels);
        const noBackground = Object.assign({}, pars, { background: 0 });
        const model = SasFitEvaluate.evaluate(spec, noBackground, q, CUT, kernels);
        const expected = model.I.map((v, i) => v + lowq.lowq_scale * Math.pow(q[i], -lowq.lowq_power)
            + pars.background);
        assertClose(total.I, expected, spec.model + ' low-Q identity');
        // the term is really there: 2e-6 * (1e-3)^-3.5 = 6.3e4 at the lowest q
        assert.ok(total.I[0] - model.I[0] > 6e4, spec.model + ' low-Q term at q[0]');
        assert.deepEqual(Object.keys(total.extras), Object.keys(model.extras));
    });
});

test('low-Q power law defaults: lowq_scale 0 and lowq_power 4', async () => {
    const kernels = await loadKernels();
    const plain = SasFitEvaluate.evaluate(SPHERE, {}, q, CUT, kernels).I;
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE_LOWQ, {}, q, CUT, kernels).I, plain);
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE_LOWQ, { lowq_power: 2 }, q, CUT, kernels).I, plain);
    const scaleOnly = SasFitEvaluate.evaluate(SPHERE_LOWQ, { lowq_scale: 1e-6 }, q, CUT, kernels).I;
    const explicit = SasFitEvaluate.evaluate(SPHERE_LOWQ, { lowq_scale: 1e-6, lowq_power: 4 }, q, CUT, kernels).I;
    assert.deepEqual(scaleOnly, explicit);
    assert.notDeepEqual(scaleOnly, plain);
    assert.equal(scaleOnly[0], plain[0] + 1e-6 * Math.pow(q[0], -4));
});

test('lowq_* parameters are legal only with lowQPowerLaw', async () => {
    const kernels = await loadKernels();
    const run = (spec, pars) => () => SasFitEvaluate.evaluate(spec, pars, q, CUT, kernels);
    assert.throws(run(SPHERE, { lowq_scale: 1e-6 }), /lowq_scale/);
    assert.throws(run(SPHERE, { lowq_power: 4 }), /lowq_power/);
    assert.throws(run(SPHERE_HS, { lowq_scale: 1e-6 }), /lowq_scale/);
    assert.throws(run({ model: 'power_law', structure: null, lowQPowerLaw: false }, { lowq_power: 4 }),
        /lowq_power/);
    assert.throws(run(SPHERE_LOWQ, { lowq_scale: '1e-6' }), /lowq_scale must be a number/);
    assert.throws(run(SPHERE_LOWQ, { lowq_power: null }), /lowq_power must be a number/);
    assert.throws(run(SPHERE_LOWQ, { lowq_offset: 1 }), /lowq_offset/);
});

test('opts.cutoff defaults to 1e-5', async () => {
    const kernels = await loadKernels();
    const pars = { radius_pd: 0.3, radius_pd_n: 80, radius_pd_nsigma: 8, radius_pd_type: 'schulz' };
    const explicit = SasFitEvaluate.evaluate(SPHERE, pars, q, { cutoff: DEFAULT_CUTOFF }, kernels).I;
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE, pars, q, {}, kernels).I, explicit);
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE, pars, q, undefined, kernels).I, explicit);
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE, pars, q, null, kernels).I, explicit);
    assert.deepEqual(SasFitEvaluate.evaluate(SPHERE, pars, q, { cutoff: undefined }, kernels).I, explicit);
    // the cutoff is really passed on: integrating the whole mesh gives another curve
    assert.notDeepEqual(SasFitEvaluate.evaluate(SPHERE, pars, q, { cutoff: 0 }, kernels).I, explicit);
    assert.equal(SasFitEvaluate.DEFAULT_CUTOFF, DEFAULT_CUTOFF);
    [-1, NaN, Infinity, '1e-5'].forEach((cutoff) => {
        assert.throws(() => SasFitEvaluate.evaluate(SPHERE, pars, q, { cutoff }, kernels), /cutoff/);
        const js = { model: 'power_law', structure: null, lowQPowerLaw: false };
        assert.throws(() => SasFitEvaluate.evaluate(js, {}, q, { cutoff }, kernels), /cutoff/);
    });
});

test('errors: unknown model, missing wasm, model that cannot take S(Q)', async () => {
    const kernels = await loadKernels();
    const run = (spec, pars, k) => () => SasFitEvaluate.evaluate(spec, pars || {}, q, CUT, k || kernels);
    const spec = (model, structure) => ({ model, structure, lowQPowerLaw: false });
    assert.throws(run(spec('no_such_model', null)), /Unknown model: no_such_model/);
    assert.throws(run(spec('toString', null)), /Unknown model: toString/);
    assert.throws(run(spec('sphere', 'no_such_s')), /Unknown model: no_such_s/);
    assert.throws(run(spec('sphere', 'toString')), /Unknown model: toString/);
    const withoutSphere = Object.fromEntries(Object.entries(kernels).filter(([name]) => name !== 'sphere'));
    assert.throws(run(spec('sphere', null), {}, withoutSphere), /No wasm kernel loaded for sphere/);
    assert.throws(run(spec('sphere', 'hardsphere'), {}, withoutSphere), /No wasm kernel loaded for sphere/);
    assert.throws(run(spec('sphere', 'hardsphere'), {}, { sphere: kernels.sphere }),
        /No wasm kernel loaded for hardsphere/);
    assert.throws(() => SasFitEvaluate.evaluate(spec('sphere', null), {}, q, CUT, null),
        /kernels must be an object/);
    assert.throws(() => SasFitEvaluate.evaluate(spec('sphere', null), {}, q, CUT, undefined),
        /kernels must be an object/);
    assert.throws(run(spec('lamellar', 'hardsphere')), /lamellar cannot take a structure factor/);
    assert.throws(run(spec('mono_gauss_coil', 'hayter_msa')), /mono_gauss_coil cannot take a structure factor/);
    assert.throws(run(spec('power_law', 'hardsphere')), /power_law cannot take a structure factor/);
    assert.throws(run(spec('sphere', 'cylinder')), /cylinder is not a structure factor/);
    assert.throws(run(spec('sphere', null), { radus: 50 }), /radus/);
    assert.throws(run(spec('sphere', 'hardsphere'), { charge: 19 }), /charge/);
    // the JS models need no wasm at all
    assert.equal(SasFitEvaluate.evaluate(spec('power_law', null), {}, q, CUT, {}).I.length, q.length);
});

test('errors: malformed modelSpec and params', async () => {
    const kernels = await loadKernels();
    const run = (spec, pars) => () => SasFitEvaluate.evaluate(spec, pars, q, CUT, kernels);
    assert.throws(run(null, {}), /modelSpec must be an object/);
    assert.throws(run({ model: 7, structure: null, lowQPowerLaw: false }, {}), /modelSpec.model/);
    assert.throws(run({ model: 'sphere', structure: 3, lowQPowerLaw: false }, {}), /modelSpec.structure/);
    assert.throws(run({ model: 'sphere', structure: null, lowQPowerLaw: 'yes' }, {}), /lowQPowerLaw/);
    assert.throws(run(SPHERE, null), /params must be an object/);
    assert.throws(() => SasFitEvaluate.evaluate(SPHERE, {}, 'q', CUT, kernels), /q must be a Float64Array/);
    // structure and lowQPowerLaw may be left out
    const short = SasFitEvaluate.evaluate({ model: 'sphere' }, {}, q, CUT, kernels);
    assert.deepEqual(short.I, SasFitEvaluate.evaluate(SPHERE, {}, q, CUT, kernels).I);
});

test('non-finite model output is returned, not thrown', async () => {
    const kernels = await loadKernels();
    const q0 = Float64Array.from([0, 0.01]);
    const powerLaw = { model: 'power_law', structure: null, lowQPowerLaw: false };
    const js = SasFitEvaluate.evaluate(powerLaw, {}, q0, CUT, kernels);
    assert.equal(js.I[0], Infinity);
    const lowq = SasFitEvaluate.evaluate(SPHERE_LOWQ, { lowq_scale: 1e-6 }, q0, CUT, kernels);
    assert.equal(lowq.I[0], Infinity);
    assert.ok(Number.isFinite(lowq.I[1]));
    const nan = SasFitEvaluate.evaluate(SPHERE, { radius: NaN }, q0, CUT, kernels);
    assert.ok(Number.isNaN(nan.I[1]));
});

test('inputs are not modified; the result is new on every call', async () => {
    const kernels = await loadKernels();
    const spec = Object.freeze({ model: 'sphere', structure: 'hardsphere', lowQPowerLaw: true });
    const pars = Object.freeze(Object.assign({ lowq_scale: 1e-6, lowq_power: 4, volfraction: 0.2 }, SCHULZ));
    const opts = Object.freeze({ cutoff: DEFAULT_CUTOFF });
    const qIn = Float64Array.from(q);
    const parsCopy = Object.assign({}, pars);
    const first = SasFitEvaluate.evaluate(spec, pars, qIn, opts, kernels);
    assert.deepEqual(qIn, q);
    assert.deepEqual(pars, parsCopy);
    assert.ok(first.I instanceof Float64Array);
    assert.equal(first.I.length, q.length);
    const second = SasFitEvaluate.evaluate(spec, pars, qIn, opts, kernels);
    assert.notEqual(second.I, first.I);
    assert.deepEqual(second.I, first.I);
    assert.deepEqual(second.extras.S, first.extras.S);
});

test('q must be a Float64Array of 1..MAX_Q_POINTS points for every kind of model', async () => {
    const kernels = await loadKernels();
    const specs = [SPHERE, SPHERE_LOWQ, SPHERE_HS, { model: 'power_law' },
        { model: 'guinier_porod', lowQPowerLaw: true }];
    const tooLong = new Float64Array(SasFitValidate.MAX_Q_POINTS + 1);
    specs.forEach((spec) => {
        const run = (qIn) => () => SasFitEvaluate.evaluate(spec, {}, qIn, CUT, kernels);
        assert.throws(run(Array.from(q)), /q must be a Float64Array, got Array/, spec.model);
        assert.throws(run(new Float32Array(4)), /q must be a Float64Array, got Float32Array/, spec.model);
        assert.throws(run(undefined), /q must be a Float64Array, got undefined/, spec.model);
        assert.throws(run(new Float64Array(0)), /q must have 1\.\.1000000 points, got 0/, spec.model);
        assert.throws(run(tooLong), /q must have 1\.\.1000000 points, got 1000001/, spec.model);
        assert.equal(run(Float64Array.of(0.01))().I.length, 1);
    });
});

test('polydispersity bounds reach the caller as Errors naming the parameter', async () => {
    const kernels = await loadKernels();
    const run = (spec, pars) => () => SasFitEvaluate.evaluate(spec, pars, q, CUT, kernels);
    for (const spec of [SPHERE, SPHERE_LOWQ, SPHERE_HS]) {
        assert.throws(run(spec, { radius_pd: 0.1, radius_pd_n: 1e9 }),
            /Parameter radius_pd_n must be a finite number of points, at most 1000, got 1000000000/);
        assert.throws(run(spec, { radius_pd: 0.1, radius_pd_n: NaN }), /radius_pd_n must be a finite number/);
        assert.throws(run(spec, { radius_pd: NaN, radius_pd_n: 35 }), /radius_pd must be a finite number, got NaN/);
        assert.throws(run(spec, { radius_pd: 0.1, radius_pd_n: 35, radius_pd_nsigma: Infinity }),
            /radius_pd_nsigma must be a finite number, got Infinity/);
        // int() as in sasmodels
        const base = { radius_pd: 0.2, radius_pd_nsigma: 3, radius_pd_type: 'schulz' };
        assert.deepEqual(run(spec, Object.assign({ radius_pd_n: 20.9 }, base))().I,
            run(spec, Object.assign({ radius_pd_n: 20 }, base))().I);
    }
    const csc = { model: 'core_shell_cylinder', structure: 'hayter_msa' };
    const pd = (name, n) => ({ [name + '_pd']: 0.1, [name + '_pd_n']: n });
    assert.throws(run(csc, Object.assign({}, pd('radius', 101), pd('thickness', 100), pd('length', 100))),
        /Polydispersity mesh of core_shell_cylinder has 1010000 points .* the limit is 1000000/);
    assert.throws(run({ model: 'sphere', structure: 'hayter_msa' },
        Object.assign({ radius_effective_mode: 0 }, pd('radius_effective', 1001))),
        /radius_effective_pd_n must be .* at most 1000, got 1001/);
});

test('own __proto__ and constructor keys are unknown parameters, with or without lowQPowerLaw', async () => {
    const kernels = await loadKernels();
    const specs = [];
    for (const lowQPowerLaw of [false, true]) {
        specs.push({ model: 'sphere', structure: null, lowQPowerLaw });
        specs.push({ model: 'sphere', structure: 'hardsphere', lowQPowerLaw });
        specs.push({ model: 'vesicle', structure: 'hayter_msa', lowQPowerLaw });
        specs.push({ model: 'power_law', structure: null, lowQPowerLaw });
    }
    const texts = ['{"__proto__":{}}', '{"__proto__":{"radius":10}}', '{"__proto__":null}',
        '{"radius":40,"__proto__":{"lowq_scale":1}}', '{"constructor":1}', '{"constructor":{"prototype":{}}}'];
    for (const spec of specs) {
        for (const text of texts) {
            const key = text.includes('__proto__') ? '__proto__' : 'constructor';
            const tag = JSON.stringify(spec) + ' ' + text;
            const pars = JSON.parse(text);
            assert.ok(Object.keys(pars).includes(key), tag);
            assert.throws(() => SasFitEvaluate.evaluate(spec, pars, q, CUT, kernels),
                (err) => err.constructor === Error
                    && err.message.startsWith('Unused parameters in call to ')
                    && err.message.split(': ')[1].split(', ').includes(key), tag);
        }
    }
    assert.equal(Object.prototype.radius, undefined);
    assert.equal(Object.prototype.lowq_scale, undefined);
});

test('a kernels map with a replaced wasm instance uses the new instance', async () => {
    const kernels = await loadKernels();
    const before = SasFitEvaluate.evaluate(SPHERE, {}, q, CUT, kernels).I;
    const fresh = await SasFitKernel.instantiate(loadWasm('sphere'));
    let calls = 0;
    const counted = Object.assign({}, fresh,
        { sphere_Iq: (...args) => { calls += 1; return fresh.sphere_Iq(...args); } });
    const after = SasFitEvaluate.evaluate(SPHERE, {}, q, CUT, Object.assign({}, kernels, { sphere: counted })).I;
    assert.equal(calls, 1);
    assert.deepEqual(after, before);
});
