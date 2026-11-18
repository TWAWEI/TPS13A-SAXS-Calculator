'use strict';
/**
 * sasfit-worker-core.js: the 'fit' message (design spec 4.9, 4.10; plan M2
 * Task 4 and review section D) -- progress and result messages, the curve and
 * residuals over all data points, the error display rule, limits, P@hayter_msa
 * fits (design spec 16) and the pure helpers settingsOf / buildFitResult.
 * Gate G4 through this interface is in sasfit-g4.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitEvaluate, SasFitWeighting, SasFitWorkerCore } = require('./load.js');
const {
    FIT_RESULT_FIELDS, G4, caseOf, fitMessage, directKernels, makeCore, pseudoGaussian,
} = require('./sasfit-fit-helpers.js');

const CUT = Object.freeze({ cutoff: 1e-5 });

const sameValues = (got, want, label) => {
    assert.equal(got.length, want.length, label + ': length');
    for (let i = 0; i < want.length; i++) assert.ok(Object.is(got[i], want[i]), label + '[' + i + ']: ' + got[i] + ' != ' + want[i]);
};

// --------------------------------------------------------------------- fit

test('fit: progress messages with rising iteration and chi2r, then one result with every FitResult field', async () => {
    const c = caseOf('1 sphere');
    const h = makeCore();
    const message = fitMessage(c, 'job-1');
    await h.core.handle(message);
    assert.equal(h.ofType('error').length, 0, JSON.stringify(h.ofType('error')));
    const progress = h.ofType('progress');
    assert.ok(progress.length >= 2, 'progress messages: ' + progress.length);
    progress.forEach((p, i) => {
        assert.deepEqual(Object.keys(p).sort(), ['chi2r', 'iteration', 'jobId', 'type']);
        assert.equal(p.jobId, 'job-1');
        assert.equal(p.iteration, i + 1);
        assert.ok(Number.isFinite(p.chi2r) && p.chi2r > 0);
        if (i > 0) assert.ok(p.chi2r <= progress[i - 1].chi2r, 'chi2r does not rise');
    });
    assert.equal(h.posts[h.posts.length - 1].type, 'result');
    assert.equal(h.ofType('result').length, 1);
    const { jobId, fitResult } = h.ofType('result')[0];
    assert.equal(jobId, 'job-1');
    assert.deepEqual(Object.keys(fitResult).sort(), [...FIT_RESULT_FIELDS].sort());
    assert.equal(fitResult.status, 'converged');
    assert.equal(fitResult.iterations, progress.length);
    assert.equal(progress[progress.length - 1].chi2r, fitResult.chi2r, 'the last progress is the result');
    assert.equal(fitResult.dof, 117);
    assert.equal(fitResult.chi2r, fitResult.chi2 / fitResult.dof);
    assert.deepEqual(fitResult.atBound, {});
    assert.equal(fitResult.illConditioned, false);

    // params: every parameter; fitted ones new, fixed ones as sent
    assert.deepEqual(Object.keys(fitResult.params).sort(), Object.keys(c.params).sort());
    assert.equal(fitResult.params.sld, c.params.sld);
    assert.equal(fitResult.params.sld_solvent, c.params.sld_solvent);
    for (const name of c.names) assert.notEqual(fitResult.params[name], c.params[name], name);
    assert.deepEqual(Object.keys(fitResult.errors).sort(), [...c.names].sort());
    assert.deepEqual(fitResult.settings, {
        modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false },
        weighting: 'sigma',
        range: message.range,
        cutoff: 1e-5,
        maxSteps: 200,
        method: 'lm',
        ftol: 1e-10,
        xtol: 1e-10,
    });
    assert.ok(!Object.isFrozen(fitResult));
});

test('fit: curve covers ALL data points; residuals are NaN at masked or out-of-range points', async () => {
    const c = caseOf('1 sphere');
    const base = fitMessage(c, 7);
    const n = base.data.q.length;
    const sigma = Float64Array.from(base.data.sigma);
    sigma[20] = 0;                                    // not usable with weighting 'sigma'
    const I = Float64Array.from(base.data.I);
    I[30] = NaN;                                      // never usable
    const range = { qMin: base.data.q[10], qMax: base.data.q[n - 6] };   // both ends inclusive
    const message = Object.assign({}, base, { data: Object.assign({}, base.data, { sigma, I }), range });
    const h = makeCore();
    await h.core.handle(message);
    const { fitResult } = h.ofType('result')[0];
    const used = (i) => i >= 10 && i <= n - 6 && i !== 20 && i !== 30;
    assert.equal(fitResult.dof, n - 10 - 5 - 2 - 3);
    assert.ok(fitResult.curve instanceof Float64Array && fitResult.residuals instanceof Float64Array);
    assert.equal(fitResult.curve.length, n);
    assert.equal(fitResult.residuals.length, n);

    const kernels = await directKernels(['sphere']);
    const want = SasFitEvaluate.evaluate(c.modelSpec, fitResult.params, base.data.q, CUT, kernels).I;
    sameValues(fitResult.curve, want, 'curve');
    let chi2 = 0;
    for (let i = 0; i < n; i++) {
        if (!used(i)) {
            assert.ok(Number.isNaN(fitResult.residuals[i]), 'residual ' + i + ' should be NaN');
            continue;
        }
        assert.equal(fitResult.residuals[i], (I[i] - want[i]) / sigma[i], 'residual ' + i);
        chi2 += fitResult.residuals[i] * fitResult.residuals[i];
    }
    assert.ok(Math.abs(chi2 - fitResult.chi2) <= 1e-12 * chi2, 'chi2 is the sum of the squared residuals');
    assert.deepEqual(fitResult.settings.range, range);
});

test('error display rule: sigma weighting shows the raw errors, the other three errors*sqrt(chi2r); both are in the result', async () => {
    const h = makeCore();
    const cases = [['1 sphere', false], ['9a ', true], ['9b ', true], ['9c ', true]];
    for (const [prefix, scaled] of cases) {
        const c = caseOf(prefix);
        await h.core.handle(fitMessage(c, prefix));
        const { fitResult } = h.ofType('result').pop();
        assert.equal(fitResult.displayErrorsScaled, scaled, c.label);
        const root = Math.sqrt(fitResult.chi2r);
        for (const name of c.names) {
            assert.ok(fitResult.errors[name] > 0, c.label);
            assert.equal(fitResult.errorsScaled[name], fitResult.errors[name] * root, c.label + ' ' + name);
        }
        assert.notEqual(root, 1);
        const shown = SasFitWorkerCore.displayErrors(fitResult);
        assert.deepEqual(shown, scaled ? fitResult.errorsScaled : fitResult.errors, c.label);
    }
});

test('fit: maxSteps reached is reported as a result with status maxiter', async () => {
    const c = caseOf('1 sphere');
    const h = makeCore();
    await h.core.handle(fitMessage(c, 1, { options: { maxSteps: 2 } }));
    const { fitResult } = h.ofType('result')[0];
    assert.equal(fitResult.status, 'maxiter');
    assert.equal(fitResult.iterations, 2);
    assert.equal(h.ofType('progress').length, 2);
    assert.equal(fitResult.settings.maxSteps, 2);
    assert.equal(fitResult.settings.cutoff, SasFitEvaluate.DEFAULT_CUTOFF);
    assert.ok(Number.isFinite(fitResult.errors.radius));
});

test('fit: a start outside the bounds is clipped onto the bound (the rule of the fitter)', async () => {
    const c = caseOf('1 sphere');
    const h = makeCore();
    const bounds = { radius: [10, 40], scale: [0, Infinity] };          // start radius 57; background unbounded by default
    await h.core.handle(fitMessage(c, 1, { bounds }));
    const { fitResult } = h.ofType('result')[0];
    assert.ok(fitResult.params.radius >= 10 && fitResult.params.radius <= 40, 'radius ' + fitResult.params.radius);
    assert.ok(Number.isFinite(fitResult.params.background));
});

test('fit: too few usable points in range -> TOO_FEW_POINTS, nothing is fitted or loaded', async () => {
    const c = caseOf('1 sphere');
    const base = fitMessage(c, 'few');
    for (const points of [3, 2, 0]) {
        const range = points === 0 ? { qMin: 10, qMax: 20 } : { qMin: base.data.q[5], qMax: base.data.q[5 + points - 1] };
        const h = makeCore();
        await h.core.handle(Object.assign({}, base, { range }));
        assert.deepEqual(h.posts.map((m) => [m.type, m.code, m.jobId]), [['error', 'TOO_FEW_POINTS', 'few']]);
        assert.deepEqual(h.loads, []);
    }
    const h = makeCore();
    await h.core.handle(Object.assign({}, base, { range: { qMin: base.data.q[5], qMax: base.data.q[8] } }));   // 4 points, 3 parameters
    assert.equal(h.ofType('result').length, 1);
    assert.equal(h.ofType('result')[0].fitResult.dof, 1);
});

test('fit without sigma works with the other weightings; options may be left out', async () => {
    const c = caseOf('9c ');
    const base = fitMessage(c, 'n');
    const h = makeCore();
    await h.core.handle(Object.assign({}, base, { data: { q: base.data.q, I: base.data.I, sigma: null }, options: undefined }));
    const { fitResult } = h.ofType('result')[0];
    assert.equal(fitResult.status, 'converged');
    assert.equal(fitResult.settings.maxSteps, 200);
    assert.equal(fitResult.settings.cutoff, 1e-5);
    assert.ok(Math.abs(fitResult.params.radius - c.ref.values.radius) < G4.PARAM_SIGMA * c.ref.stderr.radius);
});

// ------------------------------------------------- hayter_msa fits (spec 16)

const HMSA_SPEC = Object.freeze({ model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: false });
const HMSA_TRUTH = Object.freeze({ scale: 1, background: 0.001, radius: 30, sld: 1, sld_solvent: 6,
    volfraction: 0.1, charge: 12, temperature: 298, concentration_salt: 0.02, dielectconst: 78 });
const HMSA_START = Object.freeze({ radius: 33, charge: 8, volfraction: 0.13 });
const HMSA_FLAGS = Object.freeze({ radius: true, charge: true, volfraction: true });
const HMSA_Q = Float64Array.from({ length: 100 }, (_, i) => 0.008 * Math.pow(10, 1.5 * i / 99));
const HMSA_SEED = 20261118;

/** A fit message of sphere@hayter_msa on synthetic data: the model at `truth` plus 3% pseudo-noise. */
async function hmsaFitMessage(truth, start, chargeBounds) {
    const kernels = await directKernels(['sphere', 'hayter_msa']);
    const exact = SasFitEvaluate.evaluate(HMSA_SPEC, truth, HMSA_Q, CUT, kernels).I;
    assert.ok(exact.every(Number.isFinite), 'the synthetic curve is finite');
    const next = pseudoGaussian(HMSA_SEED);
    const sigma = Float64Array.from(exact, (v) => 0.03 * Math.abs(v) + 1e-4);
    const I = Float64Array.from(exact, (v, i) => v + next() * sigma[i]);
    return {
        type: 'fit', jobId: 'hmsa', modelSpec: HMSA_SPEC, params: Object.assign({}, truth, start), fitFlags: HMSA_FLAGS,
        bounds: { radius: [5, 200], charge: chargeBounds, volfraction: [0.001, 0.5] },
        data: { q: HMSA_Q, I, sigma }, range: { qMin: HMSA_Q[0], qMax: HMSA_Q[HMSA_Q.length - 1] }, weighting: 'sigma',
    };
}

test('P@hayter_msa fit with a positive lower bound on charge converges to the truth', async (t) => {
    const h = makeCore();
    await h.core.handle(await hmsaFitMessage(HMSA_TRUTH, HMSA_START, [1, 100]));
    assert.equal(h.ofType('error').length, 0, JSON.stringify(h.ofType('error')));
    const { fitResult } = h.ofType('result')[0];
    assert.equal(fitResult.status, 'converged');
    assert.deepEqual(fitResult.atBound, {});
    assert.equal(fitResult.illConditioned, false);
    assert.ok(fitResult.chi2r > 0.6 && fitResult.chi2r < 1.6, 'chi2r ' + fitResult.chi2r);
    assert.ok(fitResult.curve.every(Number.isFinite));
    for (const name of Object.keys(HMSA_FLAGS)) {
        const off = Math.abs(fitResult.params[name] - HMSA_TRUTH[name]) / fitResult.errors[name];
        t.diagnostic(name + ' = ' + fitResult.params[name] + ' +- ' + fitResult.errors[name] + ' (' + off.toFixed(2) + ' sigma from the truth)');
        assert.ok(off < 3, name + ' is ' + off + ' sigma from the truth');
    }
    assert.deepEqual([...h.loads].sort(), ['hayter_msa', 'sphere']);
});

test('P@hayter_msa with charge allowed down to 0: the fit ends as a result (failed or converged), never an error or a hang', async (t) => {
    // Nearly uncharged, salty particles: the best fit lies at charge ~ 0, where hayter_msa.c
    // returns NaN for every neighbouring point the Jacobian needs (design spec 16).
    const truth = Object.assign({}, HMSA_TRUTH, { charge: 1e-3, concentration_salt: 0.5 });
    const driven = makeCore();
    await driven.core.handle(await hmsaFitMessage(truth, Object.assign({}, HMSA_START, { charge: 3 }), [0, 100]));
    assert.deepEqual(driven.ofType('error'), []);
    const result = driven.ofType('result')[0].fitResult;
    t.diagnostic('driven towards 0: status ' + result.status + ', charge ' + result.params.charge + ', ' + result.iterations + ' steps');
    assert.ok(['failed', 'converged'].includes(result.status), result.status);
    assert.equal(result.blockedByNonFinite, result.status === 'failed', 'failed always comes with blockedByNonFinite');
    assert.ok(result.params.charge >= 0 && result.params.charge <= 100);
    assert.equal(result.curve.length, HMSA_Q.length);
    assert.ok(Number.isFinite(result.params.radius) && Number.isFinite(result.params.volfraction));

    // Starting on charge = 0 itself: the model is NaN everywhere, so there is nothing to fit.
    const stuck = makeCore();
    const message = await hmsaFitMessage(HMSA_TRUTH, Object.assign({}, HMSA_START, { charge: 0 }), [0, 100]);
    await stuck.core.handle(message);
    assert.deepEqual(stuck.posts.map((m) => m.type), ['result']);
    const failed = stuck.posts[0].fitResult;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.iterations, 0);
    assert.deepEqual(failed.params, message.params, 'the parameters are returned as they were sent');
    assert.equal(failed.chi2, Infinity);
    assert.deepEqual([failed.blockedByNonFinite, failed.jacobianNonFinite, failed.illConditioned, failed.nonFiniteCurvePoints],
        [true, true, false, HMSA_Q.length]);
    assert.ok(Number.isNaN(failed.errors.charge) && Number.isNaN(failed.errorsScaled.charge));
    assert.ok(failed.curve.every(Number.isNaN) && failed.residuals.every(Number.isNaN));
    assert.deepEqual(failed.atBound, { charge: 'lower' });
});

// ----------------------------------------------------------- pure helpers

test('settingsOf normalises the fit settings and rejects bad ones with a code', () => {
    const c = caseOf('5 ');
    const message = fitMessage(c, 1, { options: { maxSteps: 50 } });
    const settings = SasFitWorkerCore.settingsOf(message);
    assert.deepEqual(settings, {
        modelSpec: { model: 'sphere', structure: 'hardsphere', lowQPowerLaw: false },
        weighting: 'sigma', range: message.range, cutoff: 1e-5, maxSteps: 50, method: 'lm', ftol: 1e-10, xtol: 1e-10,
    });
    assert.notEqual(settings.range, message.range, 'a copy');
    assert.throws(() => SasFitWorkerCore.settingsOf(Object.assign({}, message, { weighting: 'x' })), (err) => err.code === 'BAD_WEIGHTING');
    assert.throws(() => SasFitWorkerCore.settingsOf(Object.assign({}, message, { range: {} })), (err) => err.code === 'BAD_RANGE');
});

test('buildFitResult is a pure function of its inputs', () => {
    const data = { q: Float64Array.of(0.01, 0.02, 0.03, 0.04), I: Float64Array.of(10, 8, 6, 4), sigma: null };
    const selection = SasFitWeighting.select(data, 'none', { qMin: 0.02, qMax: 0.04 });
    const fit = Object.freeze({
        names: Object.freeze(['a', 'b']), values: Object.freeze([2, 3]), errors: Object.freeze([0.5, 0.25]),
        illConditioned: true, jacobianNonFinite: false, blockedByNonFinite: false, chi2: 8, dof: 2, chi2r: 4,
        iterations: 6, status: 'maxiter', atBound: Object.freeze({ b: 'upper' }),
        covariance: Object.freeze([Object.freeze([0.25, 0]), Object.freeze([0, 0.0625])]),
    });
    const input = {
        params: Object.freeze({ a: 1, b: 1, c: 9 }), fit, data, selection,
        curve: Float64Array.of(9, 7, 7, 3), weighting: 'none',
        settings: Object.freeze({
            modelSpec: Object.freeze({ model: 'sphere', structure: null, lowQPowerLaw: false }), weighting: 'none',
            range: Object.freeze({ qMin: 0.02, qMax: 0.04 }), cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10,
        }),
    };
    const result = SasFitWorkerCore.buildFitResult(input);
    assert.deepEqual(result.params, { a: 2, b: 3, c: 9 });
    assert.deepEqual(result.errors, { a: 0.5, b: 0.25 });
    assert.deepEqual(result.errorsScaled, { a: 1, b: 0.5 });
    assert.equal(result.displayErrorsScaled, true);
    assert.deepEqual([result.chi2, result.chi2r, result.dof, result.iterations, result.status], [8, 4, 2, 6, 'maxiter']);
    assert.deepEqual(result.atBound, { b: 'upper' });
    assert.equal(result.illConditioned, true);
    sameValues(result.residuals, [NaN, 1, -1, 1], 'residuals');
    sameValues(result.curve, [9, 7, 7, 3], 'curve');
    assert.notEqual(result.curve, input.curve);
    assert.deepEqual(result.settings, input.settings);
    assert.notEqual(result.settings, input.settings);
    assert.notEqual(result.settings.range, input.settings.range);
    assert.ok(!Object.isFrozen(result) && !Object.isFrozen(result.settings));
    assert.equal(SasFitWorkerCore.buildFitResult(Object.assign({}, input, { weighting: 'sigma' })).displayErrorsScaled, false);
});
