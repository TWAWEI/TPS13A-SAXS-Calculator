'use strict';
/**
 * sasfit-worker-core.js: "message -> computation -> message" as pure logic
 * (design spec 4.9, 4.10, 12; plan M2 Task 4 and review section D).
 *
 * The core gets everything from outside: loadWasm (here the synchronous test
 * helper wrapped in a Promise, with a call counter), post (collects the
 * outgoing messages) and yieldTask (immediate, or held by the test to prove
 * latest-wins).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitMeta, SasFitKernel, SasFitEvaluate, SasFitWeighting, SasFitWorkerCore,
} = require('./load.js');
const { loadFixture, num, loadWasm } = require('./sasfit-helpers.js');

const fitFix = loadFixture('fit');
const G4_PARAM_SIGMA = 0.01;     // design spec 11, G4 -- the same limits as sasfit-fitter.test.js
const G4_STDERR_REL = 0.02;
const G4_CHI2R_REL = 1e-3;
const FIT_RESULT_FIELDS = Object.freeze(['params', 'errors', 'errorsScaled', 'displayErrorsScaled', 'chi2',
    'chi2r', 'dof', 'iterations', 'status', 'atBound', 'illConditioned', 'curve', 'residuals', 'settings']);
const Q = Float64Array.from({ length: 40 }, (_, i) => 0.005 * Math.pow(1.06, i));
const CUT = Object.freeze({ cutoff: 1e-5 });
// The scan of the hayter_msa characterisation test in sasfit-product.test.js (design spec 16)
const HMSA_SCAN = Object.freeze({ q: 1e-3, from: 80, to: 105, steps: 201,
    pars: Object.freeze({ charge: 16.3, concentration_salt: 0.056, volfraction: 0.056 }) });

const caseOf = (prefix) => {
    const found = fitFix.cases.filter((c) => c.label.startsWith(prefix));
    assert.equal(found.length, 1, 'fit.json case ' + prefix);
    return found[0];
};
const immediate = () => Promise.resolve();
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A core with a counting loadWasm and collected posts. */
function makeCore(overrides) {
    const posts = [];
    const loads = [];
    const deps = Object.assign({
        loadWasm: (name) => { loads.push(name); return Promise.resolve(loadWasm(name)); },
        post: (message) => { posts.push(message); },
        yieldTask: immediate,
    }, overrides);
    const core = SasFitWorkerCore.create(deps);
    const ofType = (type) => posts.filter((m) => m.type === type);
    return { core, posts, loads, ofType };
}

/** A yieldTask the test releases by hand, one waiting call at a time or all at once. */
function manualYield() {
    const waiting = [];
    const yieldTask = () => new Promise((resolve) => { waiting.push(resolve); });
    const releaseAll = () => { waiting.splice(0).forEach((resolve) => resolve()); };
    return { yieldTask, releaseAll, waiting };
}

const evalMessage = (reqId, extra) => Object.assign({
    type: 'evaluate', reqId, modelSpec: { model: 'sphere' }, params: {}, q: Q, opts: { cutoff: 1e-5 },
}, extra);

function fitMessage(c, jobId, extra) {
    const q = Float64Array.from(c.data.q);
    return Object.assign({
        type: 'fit',
        jobId,
        modelSpec: c.modelSpec,
        params: c.params,
        fitFlags: c.fitFlags,
        bounds: Object.fromEntries(Object.entries(c.bounds).map(([k, [lo, hi]]) => [k, [num(lo), num(hi)]])),
        data: { q, I: Float64Array.from(c.data.I), sigma: Float64Array.from(c.data.sigma), kind: 'generic', header: null },
        range: { qMin: q[0], qMax: q[q.length - 1] },
        weighting: c.weighting,
        options: { maxSteps: fitFix.fitOptions.steps, cutoff: fitFix.cutoff },
    }, extra);
}

async function directKernels(names) {
    const list = await Promise.all(names.map((name) => SasFitKernel.instantiate(loadWasm(name))));
    return Object.fromEntries(names.map((name, i) => [name, list[i]]));
}

const sameValues = (got, want, label) => {
    assert.equal(got.length, want.length, label + ': length');
    for (let i = 0; i < want.length; i++) assert.ok(Object.is(got[i], want[i]), label + '[' + i + ']: ' + got[i] + ' != ' + want[i]);
};

/** Plain snapshot of a message for the "input was not modified" checks. */
const snapshot = (message) => structuredClone(message);

async function expectError(message, code, deps) {
    const h = makeCore(deps);
    await h.core.handle(message);
    assert.equal(h.posts.length, 1, code + ': exactly one message, got ' + JSON.stringify(h.posts.map((m) => m.type)));
    const err = h.posts[0];
    assert.equal(err.type, 'error');
    assert.equal(err.code, code, 'detail: ' + err.detail);
    assert.ok(SasFitWorkerCore.ERROR_CODES.includes(err.code));
    assert.match(err.message, /[一-鿿]/, 'the message is readable Chinese');
    assert.equal(typeof err.detail, 'string');
    return err;
}

// ------------------------------------------------------------------ module

test('module is frozen and exports the interface', () => {
    assert.ok(Object.isFrozen(SasFitWorkerCore));
    for (const name of ['create', 'buildFitResult', 'modelsOf', 'settingsOf', 'displayErrors']) {
        assert.equal(typeof SasFitWorkerCore[name], 'function', name);
    }
    assert.ok(Object.isFrozen(SasFitWorkerCore.ERROR_CODES));
    assert.deepEqual([...SasFitWorkerCore.ERROR_CODES], ['BAD_MESSAGE', 'UNKNOWN_TYPE', 'UNKNOWN_MODEL',
        'BAD_PARAMS', 'BAD_FIT_FLAGS', 'BAD_BOUNDS', 'BAD_DATA', 'BAD_RANGE', 'BAD_WEIGHTING', 'BAD_OPTIONS',
        'TOO_FEW_POINTS', 'WASM_LOAD', 'WASM_TRAP', 'INTERNAL']);
});

test('create needs loadWasm, post and yieldTask (no silent default for yieldTask)', () => {
    const ok = { loadWasm: () => {}, post: () => {}, yieldTask: immediate };
    assert.doesNotThrow(() => SasFitWorkerCore.create(ok));
    for (const key of Object.keys(ok)) {
        const deps = Object.assign({}, ok, { [key]: undefined });
        assert.throws(() => SasFitWorkerCore.create(deps), new RegExp(key));
    }
    assert.throws(() => SasFitWorkerCore.create(null), /loadWasm/);
});

test('the source does not reference Worker or timer globals', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'sasfit-worker-core.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const word of ['self', 'fetch', 'postMessage', 'setTimeout', 'importScripts', 'window', 'document', 'Math.random', 'Date']) {
        assert.ok(!new RegExp('\\b' + word.replace('.', '\\.') + '\\b').test(code), 'references ' + word);
    }
});

test('modelsOf lists the wasm modules a spec needs', () => {
    assert.deepEqual(SasFitWorkerCore.modelsOf({ model: 'sphere' }), ['sphere']);
    assert.deepEqual(SasFitWorkerCore.modelsOf({ model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: true }),
        ['sphere', 'hayter_msa']);
    assert.deepEqual(SasFitWorkerCore.modelsOf({ model: 'power_law', structure: null }), []);
    assert.deepEqual(SasFitWorkerCore.modelsOf({ model: 'guinier_porod' }), []);
    assert.throws(() => SasFitWorkerCore.modelsOf({ model: 'nope' }), (err) => err.code === 'UNKNOWN_MODEL');
    assert.throws(() => SasFitWorkerCore.modelsOf({ model: 'constructor' }), (err) => err.code === 'UNKNOWN_MODEL');
    assert.throws(() => SasFitWorkerCore.modelsOf({ model: 'sphere', structure: '__proto__' }), (err) => err.code === 'UNKNOWN_MODEL');
    assert.throws(() => SasFitWorkerCore.modelsOf(null), (err) => err.code === 'BAD_MESSAGE');
});

// ---------------------------------------------------------------- evaluate

test('evaluate: one curve message equal to SasFitEvaluate; wasm is loaded once per model', async () => {
    const h = makeCore();
    await h.core.handle(evalMessage(1));
    assert.equal(h.posts.length, 1);
    const [curve] = h.posts;
    assert.deepEqual(Object.keys(curve).sort(), ['I', 'extras', 'reqId', 'type']);
    assert.equal(curve.type, 'curve');
    assert.equal(curve.reqId, 1);
    const kernels = await directKernels(['sphere']);
    const want = SasFitEvaluate.evaluate({ model: 'sphere' }, {}, Q, CUT, kernels);
    assert.ok(curve.I instanceof Float64Array);
    sameValues(curve.I, want.I, 'I');
    assert.deepEqual(curve.extras, {});
    assert.ok(!Object.isFrozen(curve), 'outgoing messages are plain');

    for (let reqId = 2; reqId <= 5; reqId++) await h.core.handle(evalMessage(reqId));
    assert.equal(h.ofType('curve').length, 5);
    assert.deepEqual(h.loads, ['sphere']);
});

test('evaluate: P@S loads two modules and returns the extras; a JS model loads none', async () => {
    const h = makeCore();
    const spec = { model: 'sphere', structure: 'hardsphere', lowQPowerLaw: false };
    await h.core.handle(evalMessage(1, { modelSpec: spec, params: { volfraction: 0.2 } }));
    assert.deepEqual([...h.loads].sort(), ['hardsphere', 'sphere']);
    const kernels = await directKernels(['sphere', 'hardsphere']);
    const want = SasFitEvaluate.evaluate(spec, { volfraction: 0.2 }, Q, CUT, kernels);
    const [curve] = h.posts;
    sameValues(curve.I, want.I, 'I');
    assert.deepEqual(Object.keys(curve.extras).sort(), ['S', 'radiusEffective', 'volumeRatio']);
    sameValues(curve.extras.S, want.extras.S, 'S');
    assert.equal(curve.extras.radiusEffective, want.extras.radiusEffective);
    assert.ok(!Object.isFrozen(curve.extras));

    const js = makeCore();
    await js.core.handle(evalMessage(1, { modelSpec: { model: 'power_law' }, params: { power: 3.5 } }));
    assert.equal(js.posts[0].type, 'curve');
    assert.deepEqual(js.loads, []);
});

test('evaluate: the cutoff defaults to SasFitEvaluate.DEFAULT_CUTOFF when opts is left out', async () => {
    const h = makeCore();
    const params = { radius_pd: 0.2, radius_pd_n: 40, radius_pd_type: 'schulz', radius_pd_nsigma: 3 };
    await h.core.handle(evalMessage(1, { params, opts: undefined }));
    await h.core.handle(evalMessage(2, { params, opts: { cutoff: 0 } }));
    const kernels = await directKernels(['sphere']);
    sameValues(h.posts[0].I, SasFitEvaluate.evaluate({ model: 'sphere' }, params, Q, CUT, kernels).I, 'default');
    sameValues(h.posts[1].I, SasFitEvaluate.evaluate({ model: 'sphere' }, params, Q, { cutoff: 0 }, kernels).I, 'cutoff 0');
});

test('latest-wins while the wasm is still loading: only the newest reqId is answered', async () => {
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    const loads = [];
    const h = makeCore({ loadWasm: (name) => { loads.push(name); return gate.then(() => loadWasm(name)); } });
    const first = h.core.handle(evalMessage(1));
    await settle();                                  // request 1 is past its yield, waiting for the wasm
    assert.deepEqual(loads, ['sphere']);
    const second = h.core.handle(evalMessage(2));
    const third = h.core.handle(evalMessage(3, { params: { radius: 80 } }));
    await settle();
    assert.equal(h.posts.length, 0);
    release();
    await Promise.all([first, second, third]);
    assert.deepEqual(h.posts.map((m) => [m.type, m.reqId]), [['curve', 3]]);
    assert.deepEqual(loads, ['sphere'], 'one load shared by the three requests');
    const kernels = await directKernels(['sphere']);
    sameValues(h.posts[0].I, SasFitEvaluate.evaluate({ model: 'sphere' }, { radius: 80 }, Q, CUT, kernels).I, 'I');
});

test('latest-wins with the wasm cached: three queued requests compute once (yieldTask is what makes it work)', async () => {
    const manual = manualYield();
    const h = makeCore({ yieldTask: manual.yieldTask });
    const warm = h.core.handle(evalMessage(0));
    manual.releaseAll();
    await warm;
    assert.deepEqual(h.posts.map((m) => m.reqId), [0]);

    // params whose values record every read: a request that is dropped never reads them
    const reads = [];
    const spy = (reqId) => Object.defineProperty({}, 'radius', {
        enumerable: true, get() { reads.push(reqId); return 40 + reqId; },
    });
    const pending = [1, 2, 3].map((reqId) => h.core.handle(evalMessage(reqId, { params: spy(reqId) })));
    assert.equal(manual.waiting.length, 3, 'each request yields before it computes');
    manual.releaseAll();
    await Promise.all(pending);
    assert.deepEqual(h.posts.map((m) => [m.type, m.reqId]), [['curve', 0], ['curve', 3]]);
    assert.ok(reads.length > 0 && reads.every((reqId) => reqId === 3), 'only request 3 was computed: ' + reads);
    assert.deepEqual(h.loads, ['sphere']);
});

test('latest-wins also drops the error of a superseded request', async () => {
    const manual = manualYield();
    const h = makeCore({ yieldTask: manual.yieldTask });
    const pending = [h.core.handle(evalMessage(1, { modelSpec: { model: 'nope' } })), h.core.handle(evalMessage(2))];
    manual.releaseAll();
    await Promise.all(pending);
    assert.deepEqual(h.posts.map((m) => [m.type, m.reqId]), [['curve', 2]]);
});

test('hayter_msa NaN is data, not an error: the curve comes back with the NaN in it', async () => {
    const spec = { model: 'sphere', structure: 'hayter_msa' };
    const kernels = await directKernels(['sphere', 'hayter_msa']);
    const q = Float64Array.of(HMSA_SCAN.q);
    let params = null;
    for (let i = 0; i < HMSA_SCAN.steps && params === null; i++) {
        const radius = HMSA_SCAN.from + (HMSA_SCAN.to - HMSA_SCAN.from) * i / (HMSA_SCAN.steps - 1);
        const candidate = Object.assign({ radius_effective: radius, radius_effective_mode: 0 }, HMSA_SCAN.pars);
        if (!Number.isFinite(SasFitEvaluate.evaluate(spec, candidate, q, CUT, kernels).I[0])) params = candidate;
    }
    assert.ok(params !== null, 'the scan of sasfit-product.test.js has a non-finite point');
    const h = makeCore();
    await h.core.handle(evalMessage(1, { modelSpec: spec, params, q }));
    assert.deepEqual(h.posts.map((m) => m.type), ['curve']);
    assert.ok(!Number.isFinite(h.posts[0].I[0]), 'I = ' + h.posts[0].I[0]);
});

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

test('fit: G4 through the message interface -- all fit.json cases against the polished bumps reference', async (t) => {
    const h = makeCore();
    for (const c of fitFix.cases) {
        const before = h.ofType('result').length;
        await h.core.handle(fitMessage(c, c.label));
        assert.equal(h.ofType('result').length, before + 1, c.label + ': ' + JSON.stringify(h.ofType('error')));
        const { fitResult } = h.ofType('result')[before];
        let worstParam = 0;
        let worstErr = 0;
        for (const name of c.names) {
            const sigma = c.ref.stderr[name];
            worstParam = Math.max(worstParam, Math.abs(fitResult.params[name] - c.ref.values[name]) / sigma);
            worstErr = Math.max(worstErr, Math.abs(fitResult.errors[name] - sigma) / sigma);
        }
        const chi2rDiff = Math.abs(fitResult.chi2r - c.ref.chi2r) / c.ref.chi2r;
        t.diagnostic(c.label + ': ' + fitResult.status + ', ' + fitResult.iterations + ' steps, param '
            + worstParam.toExponential(1) + ' sigma, stderr ' + worstErr.toExponential(1) + ', chi2r ' + chi2rDiff.toExponential(1));
        assert.equal(fitResult.status, 'converged', c.label);
        assert.ok(worstParam < G4_PARAM_SIGMA, c.label + ': parameter off by ' + worstParam + ' sigma');
        assert.ok(worstErr <= G4_STDERR_REL, c.label + ': stderr off by ' + worstErr);
        assert.ok(chi2rDiff <= G4_CHI2R_REL, c.label + ': chi2r off by ' + chi2rDiff);
        assert.equal(fitResult.dof, c.ref.dof, c.label);
        assert.deepEqual(fitResult.atBound, c.ref.atBound || {}, c.label);
        for (const [name, side] of Object.entries(fitResult.atBound)) {
            assert.equal(fitResult.params[name], num(c.bounds[name][side === 'lower' ? 0 : 1]), c.label + ': exactly on the bound');
        }
    }
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

// ------------------------------------------------------------------ errors

test('errors become error messages with id, code, Chinese message and detail; handle never rejects', async () => {
    await expectError(null, 'BAD_MESSAGE');
    await expectError('evaluate', 'BAD_MESSAGE');
    await expectError({ reqId: 1 }, 'BAD_MESSAGE');
    const unknown = await expectError({ type: 'explode', reqId: 4, jobId: 'j' }, 'UNKNOWN_TYPE');
    assert.equal(unknown.reqId, 4);
    assert.equal(unknown.jobId, 'j');
    await expectError({ type: 'constructor', reqId: 4 }, 'UNKNOWN_TYPE');
    await expectError(evalMessage(undefined), 'BAD_MESSAGE');
    await expectError(evalMessage(NaN), 'BAD_MESSAGE');
    await expectError(evalMessage({}), 'BAD_MESSAGE');

    const model = await expectError(evalMessage(5, { modelSpec: { model: 'no_such_model' } }), 'UNKNOWN_MODEL');
    assert.equal(model.reqId, 5);
    assert.ok(!('jobId' in model));
    assert.match(model.detail, /no_such_model/);
    await expectError(evalMessage(5, { modelSpec: { model: 'toString' } }), 'UNKNOWN_MODEL');
    await expectError(evalMessage(5, { modelSpec: { model: 'sphere', structure: 'nope' } }), 'UNKNOWN_MODEL');
    await expectError(evalMessage(5, { modelSpec: null }), 'BAD_MESSAGE');
    await expectError(evalMessage(5, { modelSpec: { model: 'sphere', lowQPowerLaw: 'yes' } }), 'BAD_MESSAGE');
    await expectError(evalMessage(5, { params: null }), 'BAD_MESSAGE');
    await expectError(evalMessage(5, { q: Array.from(Q) }), 'BAD_MESSAGE');
    await expectError(evalMessage(5, { opts: 3 }), 'BAD_MESSAGE');
});

test('errors thrown by the compute core (invalid parameters) -> BAD_PARAMS with the original text as detail', async () => {
    const unused = await expectError(evalMessage(6, { params: { radius: 50, nonsense: 1 } }), 'BAD_PARAMS');
    assert.match(unused.detail, /Unused parameters in call to sphere: nonsense/);
    const proto = JSON.parse('{"__proto__": 1, "radius": 50}');
    assert.match((await expectError(evalMessage(6, { params: proto }), 'BAD_PARAMS')).detail, /__proto__/);
    await expectError(evalMessage(6, { params: { constructor: 1 } }), 'BAD_PARAMS');
    await expectError(evalMessage(6, { params: { radius: '50' } }), 'BAD_PARAMS');
    await expectError(evalMessage(6, { params: { radius_pd: 0.1, radius_pd_n: 5000 } }), 'BAD_PARAMS');
    await expectError(evalMessage(6, { opts: { cutoff: -1 } }), 'BAD_PARAMS');
    await expectError(evalMessage(6, { q: new Float64Array(0) }), 'BAD_PARAMS');
    // a composition the product module refuses
    await expectError(evalMessage(6, { modelSpec: { model: 'guinier', structure: 'hardsphere' } }), 'BAD_PARAMS');
});

test('loadWasm failures -> WASM_LOAD, and the next request loads again', async () => {
    let fail = true;
    const loads = [];
    const flaky = (name) => {
        loads.push(name);
        return fail ? Promise.reject(new Error('HTTP 404 for sas-' + name + '.wasm')) : Promise.resolve(loadWasm(name));
    };
    const h = makeCore({ loadWasm: flaky });
    await h.core.handle(evalMessage(1));
    assert.deepEqual(h.posts.map((m) => [m.type, m.code, m.reqId]), [['error', 'WASM_LOAD', 1]]);
    assert.match(h.posts[0].detail, /sphere/);
    assert.match(h.posts[0].detail, /HTTP 404/);
    fail = false;
    await h.core.handle(evalMessage(2));
    assert.equal(h.posts[1].type, 'curve');
    assert.deepEqual(loads, ['sphere', 'sphere']);

    const thrower = makeCore({ loadWasm: () => { throw new Error('synchronous failure'); } });
    await thrower.core.handle(fitMessage(caseOf('1 sphere'), 'j'));
    assert.deepEqual(thrower.posts.map((m) => [m.type, m.code, m.jobId]), [['error', 'WASM_LOAD', 'j']]);

    // bytes that are not a wasm module (an HTML error page served with status 200)
    const html = makeCore({ loadWasm: () => Promise.resolve(new TextEncoder().encode('<!DOCTYPE html>')) });
    await html.core.handle(evalMessage(1));
    assert.deepEqual(html.posts.map((m) => [m.type, m.code]), [['error', 'WASM_LOAD']]);
    const notBytes = makeCore({ loadWasm: () => Promise.resolve('sphere') });
    await notBytes.core.handle(evalMessage(1));
    assert.deepEqual(notBytes.posts.map((m) => [m.type, m.code]), [['error', 'WASM_LOAD']]);
});

test('a wasm trap -> WASM_TRAP; the instance is dropped and the next request loads the module again', async () => {
    let trapNext = false;
    const instantiate = async (bytes) => {
        const ex = await SasFitKernel.instantiate(bytes);
        const sphereIq = (...args) => {
            if (trapNext) {
                trapNext = false;
                throw new WebAssembly.RuntimeError('unreachable');
            }
            return ex.sphere_Iq(...args);
        };
        return Object.assign({}, ex, { sphere_Iq: sphereIq });
    };
    const h = makeCore({ instantiate });
    await h.core.handle(evalMessage(1));
    assert.equal(h.posts[0].type, 'curve');
    trapNext = true;
    await h.core.handle(evalMessage(2));
    assert.deepEqual([h.posts[1].type, h.posts[1].code, h.posts[1].reqId], ['error', 'WASM_TRAP', 2]);
    assert.match(h.posts[1].detail, /wasm kernel sphere failed/);
    assert.deepEqual(h.loads, ['sphere']);
    await h.core.handle(evalMessage(3));
    assert.equal(h.posts[2].type, 'curve');
    assert.deepEqual(h.loads, ['sphere', 'sphere'], 'reloaded after the trap');

    trapNext = true;                                   // a trap in the middle of a fit
    await h.core.handle(fitMessage(caseOf('1 sphere'), 'j'));
    const last = h.posts[h.posts.length - 1];
    assert.deepEqual([last.type, last.code, last.jobId], ['error', 'WASM_TRAP', 'j']);
    assert.equal(h.ofType('result').length, 0);
});

test('fit message validation: every bad field has its own code', async () => {
    const c = caseOf('1 sphere');
    const bad = (extra, code) => expectError(fitMessage(c, 'v', extra), code);
    assert.equal((await bad({ jobId: null }, 'BAD_MESSAGE')).jobId, undefined);
    assert.equal((await bad({ modelSpec: { model: 'zzz' } }, 'UNKNOWN_MODEL')).jobId, 'v');
    await bad({ params: [1, 2] }, 'BAD_MESSAGE');

    await bad({ fitFlags: null }, 'BAD_FIT_FLAGS');
    await bad({ fitFlags: {} }, 'BAD_FIT_FLAGS');
    await bad({ fitFlags: { radius: false } }, 'BAD_FIT_FLAGS');
    await bad({ fitFlags: { radius: 1 } }, 'BAD_FIT_FLAGS');
    assert.match((await bad({ fitFlags: { radius: true, length: true } }, 'BAD_FIT_FLAGS')).detail, /length/);
    await bad({ fitFlags: JSON.parse('{"radius": true, "__proto__": true}') }, 'BAD_FIT_FLAGS');
    await bad({ fitFlags: { constructor: true } }, 'BAD_FIT_FLAGS');
    await bad({ fitFlags: { radius_pd_n: true } }, 'BAD_FIT_FLAGS');
    await bad({ fitFlags: { lowq_scale: true } }, 'BAD_FIT_FLAGS');       // no low-Q term in this spec
    await bad({ fitFlags: { volfraction: true } }, 'BAD_FIT_FLAGS');      // no structure factor

    await bad({ bounds: null }, 'BAD_BOUNDS');
    await bad({ bounds: { radius: [100, 10] } }, 'BAD_BOUNDS');
    await bad({ bounds: { radius: [NaN, 10] } }, 'BAD_BOUNDS');
    await bad({ bounds: { radius: [1] } }, 'BAD_BOUNDS');
    await bad({ bounds: { radius: ['1', '2'] } }, 'BAD_BOUNDS');
    await bad({ bounds: { radius: [Infinity, Infinity] } }, 'BAD_BOUNDS');
    await bad({ bounds: { radius: [-Infinity, -Infinity] } }, 'BAD_BOUNDS');
    await bad({ bounds: { nonsense: [0, 1] } }, 'BAD_BOUNDS');
    await bad({ bounds: JSON.parse('{"__proto__": [0, 1]}') }, 'BAD_BOUNDS');

    const data = fitMessage(c, 'v').data;
    await bad({ data: null }, 'BAD_DATA');
    await bad({ data: Object.assign({}, data, { q: Array.from(data.q) }) }, 'BAD_DATA');
    await bad({ data: Object.assign({}, data, { I: data.I.subarray(1) }) }, 'BAD_DATA');
    await bad({ data: Object.assign({}, data, { sigma: data.sigma.subarray(1) }) }, 'BAD_DATA');
    await bad({ data: { q: new Float64Array(0), I: new Float64Array(0), sigma: null } }, 'BAD_DATA');

    await bad({ range: null }, 'BAD_RANGE');
    await bad({ range: { qMin: 0.1, qMax: 0.01 } }, 'BAD_RANGE');
    await bad({ range: { qMin: NaN, qMax: 1 } }, 'BAD_RANGE');
    await bad({ range: { qMin: '0', qMax: 1 } }, 'BAD_RANGE');

    await bad({ weighting: 'poisson' }, 'BAD_WEIGHTING');
    await bad({ weighting: undefined }, 'BAD_WEIGHTING');
    await bad({ data: Object.assign({}, data, { sigma: null }) }, 'BAD_WEIGHTING');   // 'sigma' without sigma

    await bad({ options: 5 }, 'BAD_OPTIONS');
    await bad({ options: { maxSteps: 0 } }, 'BAD_OPTIONS');
    await bad({ options: { maxSteps: 2.5 } }, 'BAD_OPTIONS');
    await bad({ options: { cutoff: -1 } }, 'BAD_OPTIONS');
    await bad({ options: { cutoff: NaN } }, 'BAD_OPTIONS');

    await bad({ params: Object.assign({}, c.params, { radius: undefined }) }, 'BAD_PARAMS');
    await bad({ params: Object.assign({}, c.params, { radius: NaN }) }, 'BAD_PARAMS');
    await bad({ params: { scale: 1, background: 0 } }, 'BAD_PARAMS');     // fitted radius has no start value
    await bad({ params: Object.assign({}, c.params, { nonsense: 1 }) }, 'BAD_PARAMS');
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
    assert.ok(Math.abs(fitResult.params.radius - c.ref.values.radius) < G4_PARAM_SIGMA * c.ref.stderr.radius);
});

test('incoming messages are not modified', async () => {
    const c = caseOf('5 ');
    const h = makeCore();
    const evalMsg = evalMessage(1, { modelSpec: { model: 'sphere', structure: 'hardsphere' }, params: { radius: 30 }, q: Float64Array.from(Q) });
    const fitMsg = fitMessage(c, 2);
    const bad = fitMessage(c, 3, { bounds: { radius: [5, 1] } });
    const before = [evalMsg, fitMsg, bad].map(snapshot);
    for (const message of [evalMsg, fitMsg, bad]) await h.core.handle(message);
    assert.deepEqual(h.posts.filter((m) => m.type !== 'progress').map((m) => m.type), ['curve', 'result', 'error']);
    assert.deepEqual([evalMsg, fitMsg, bad], before);
    // the result does not alias the input arrays
    const { fitResult } = h.ofType('result')[0];
    assert.notEqual(fitResult.params, fitMsg.params);
    assert.notEqual(fitResult.curve, fitMsg.data.I);
});

test('a post that throws does not make handle reject', async () => {
    const seen = [];
    const core = SasFitWorkerCore.create({
        loadWasm: (name) => Promise.resolve(loadWasm(name)),
        yieldTask: immediate,
        post: (message) => {
            seen.push(message.type);
            if (message.type === 'curve') throw new Error('DataCloneError');
        },
    });
    await core.handle(evalMessage(1));
    assert.deepEqual(seen, ['curve', 'error']);
});

// ------------------------------------------------- hayter_msa fits (spec 16)

const HMSA_SPEC = Object.freeze({ model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: false });
const HMSA_TRUTH = Object.freeze({ scale: 1, background: 0.001, radius: 30, sld: 1, sld_solvent: 6,
    volfraction: 0.1, charge: 12, temperature: 298, concentration_salt: 0.02, dielectconst: 78 });
const HMSA_START = Object.freeze({ radius: 33, charge: 8, volfraction: 0.13 });
const HMSA_FLAGS = Object.freeze({ radius: true, charge: true, volfraction: true });
const HMSA_Q = Float64Array.from({ length: 100 }, (_, i) => 0.008 * Math.pow(10, 1.5 * i / 99));
const HMSA_SEED = 20261118;

/** Deterministic pseudo-noise: sum of 12 uniform numbers of a 32-bit LCG, minus 6 (mean 0, variance 1). */
function pseudoGaussian(seed) {
    let state = seed >>> 0;
    const uniform = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    return () => {
        let sum = 0;
        for (let k = 0; k < 12; k++) sum += uniform();
        return sum - 6;
    };
}

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
        illConditioned: true, chi2: 8, dof: 2, chi2r: 4, iterations: 6, status: 'maxiter',
        atBound: Object.freeze({ b: 'upper' }), covariance: Object.freeze([]),
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

test('every model of the meta table is reachable through the core', async () => {
    const h = makeCore();
    let reqId = 0;
    for (const name of SasFitMeta.order.filter((n) => !SasFitMeta.models[n].isStructureFactor)) {
        await h.core.handle(evalMessage(++reqId, { modelSpec: { model: name, lowQPowerLaw: true }, params: { lowq_scale: 1e-9 } }));
        const last = h.posts[h.posts.length - 1];
        assert.equal(last.type, 'curve', name + ': ' + last.detail);
        assert.ok(last.I.every(Number.isFinite), name);
    }
});
