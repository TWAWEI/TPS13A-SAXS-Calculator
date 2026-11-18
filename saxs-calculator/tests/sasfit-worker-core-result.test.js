'use strict';
/**
 * sasfit-worker-core.js after the M2 review: the FitResult fields added for
 * the page (names, covariance, correlation, the two non-finite flags and
 * nonFiniteCurvePoints), the upper limit of maxSteps, the error mapping by
 * call site, and what happens when even the error message cannot be posted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SasFitWeighting, SasFitWorkerCore } = require('./load.js');
const { FIT_RESULT_FIELDS, caseOf, fitMessage, makeCore } = require('./sasfit-fit-helpers.js');

const evalMessage = (reqId, extra) => Object.assign({
    type: 'evaluate', reqId, modelSpec: { model: 'sphere' }, params: {},
    q: Float64Array.from({ length: 20 }, (_, i) => 0.005 * Math.pow(1.1, i)), opts: { cutoff: 1e-5 },
}, extra);

/** Run fn with a global SasFit module replaced by a stub; always restored. */
async function withGlobal(name, stub, fn) {
    const real = globalThis[name];
    globalThis[name] = stub;
    try {
        return await fn();
    } finally {
        globalThis[name] = real;
    }
}

// ------------------------------------------------------------ FitResult

test('FitResult: names in fitter order, covariance and correlation as plain n x n arrays, flags and counts always present', async () => {
    const c = caseOf('2 core_shell_sphere');
    const h = makeCore();
    await h.core.handle(fitMessage(c, 1));
    const { fitResult } = h.ofType('result')[0];
    assert.deepEqual(Object.keys(fitResult).sort(), [...FIT_RESULT_FIELDS].sort());
    assert.deepEqual(fitResult.names, Object.keys(c.fitFlags), 'the key order of fitFlags');
    const n = fitResult.names.length;
    for (const key of ['covariance', 'correlation']) {
        assert.ok(Array.isArray(fitResult[key]) && fitResult[key].length === n, key);
        fitResult[key].forEach((row) => assert.ok(Array.isArray(row) && row.length === n && row.every(Number.isFinite), key));
        assert.ok(!Object.isFrozen(fitResult[key]) && !Object.isFrozen(fitResult[key][0]), key + ' is plain');
    }
    fitResult.names.forEach((a, i) => {
        assert.equal(Math.sqrt(fitResult.covariance[i][i]), fitResult.errors[a], a);
        assert.equal(fitResult.correlation[i][i], 1);
        fitResult.names.forEach((b, j) => {
            assert.equal(fitResult.covariance[i][j], fitResult.covariance[j][i]);
            assert.equal(fitResult.correlation[i][j],
                fitResult.covariance[i][j] / Math.sqrt(fitResult.covariance[i][i] * fitResult.covariance[j][j]));
            assert.ok(Math.abs(fitResult.correlation[i][j]) <= 1 + 1e-12);
            const want = c.ref.covariance[c.names.indexOf(a)][c.names.indexOf(b)];
            const scale = Math.sqrt(c.ref.stderr[a] * c.ref.stderr[a] * c.ref.stderr[b] * c.ref.stderr[b]);
            assert.ok(Math.abs(fitResult.covariance[i][j] - want) <= 0.04 * scale, 'covariance ' + a + ',' + b + ' vs bumps');
        });
    });
    assert.ok(fitResult.correlation.flat().some((v) => Math.abs(v) > 0.5 && v !== 1), 'this case has correlated parameters');
    assert.deepEqual([fitResult.blockedByNonFinite, fitResult.jacobianNonFinite, fitResult.illConditioned, fitResult.nonFiniteCurvePoints],
        [false, false, false, 0]);
    assert.deepEqual(structuredClone(fitResult), fitResult, 'crosses postMessage unchanged');
});

function builtFrom(overrides) {
    const data = { q: Float64Array.of(0.01, 0.02, 0.03, 0.04), I: Float64Array.of(10, 8, 6, 4), sigma: null };
    const fit = Object.freeze(Object.assign({
        names: Object.freeze(['a', 'b']), values: Object.freeze([2, 3]), errors: Object.freeze([0.5, 0.25]),
        illConditioned: false, jacobianNonFinite: false, blockedByNonFinite: false, chi2: 8, dof: 2, chi2r: 4,
        iterations: 6, status: 'converged', atBound: Object.freeze({}),
        covariance: Object.freeze([Object.freeze([0.25, -0.1]), Object.freeze([-0.1, 0.0625])]),
    }, overrides.fit));
    return SasFitWorkerCore.buildFitResult({
        params: { a: 1, b: 1, c: 9 }, fit, data, selection: SasFitWeighting.select(data, 'none', { qMin: 0.01, qMax: 0.04 }),
        curve: overrides.curve || Float64Array.of(9, 7, 7, 3), weighting: 'none',
        settings: { modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false }, weighting: 'none',
            range: { qMin: 0.01, qMax: 0.04 }, cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10 },
    });
}

test('buildFitResult: correlation = C_ij/sqrt(C_ii C_jj), NaN where a variance is not positive; copies, not aliases', () => {
    const plain = builtFrom({});
    assert.deepEqual(Object.keys(plain).sort(), [...FIT_RESULT_FIELDS].sort());
    assert.deepEqual(plain.names, ['a', 'b']);
    assert.deepEqual(plain.covariance, [[0.25, -0.1], [-0.1, 0.0625]]);
    assert.deepEqual(plain.correlation, [[1, -0.1 / Math.sqrt(0.25 * 0.0625)], [-0.1 / Math.sqrt(0.25 * 0.0625), 1]]);
    assert.ok(!Object.isFrozen(plain.names) && !Object.isFrozen(plain.covariance[0]));

    const nan = builtFrom({ fit: { covariance: [[0.25, NaN], [NaN, NaN]], errors: [0.5, NaN], jacobianNonFinite: true } });
    assert.deepEqual(nan.correlation, [[1, NaN], [NaN, NaN]]);
    assert.equal(nan.jacobianNonFinite, true);
    const zero = builtFrom({ fit: { covariance: [[0, 0], [0, 4]] } });
    assert.deepEqual(zero.correlation, [[NaN, NaN], [NaN, 1]], 'a zero variance has no correlation, not Infinity');
    const negative = builtFrom({ fit: { covariance: [[-1, 0.5], [0.5, 4]] } });
    assert.deepEqual(negative.correlation, [[NaN, NaN], [NaN, 1]]);
});

test('buildFitResult: the non-finite flags are passed on and nonFiniteCurvePoints counts NaN and +-Infinity of the whole curve', () => {
    assert.equal(builtFrom({}).nonFiniteCurvePoints, 0);
    assert.equal(builtFrom({ curve: Float64Array.of(9, NaN, Infinity, -Infinity) }).nonFiniteCurvePoints, 3);
    const blocked = builtFrom({ fit: { status: 'failed', blockedByNonFinite: true } });
    assert.deepEqual([blocked.status, blocked.blockedByNonFinite, blocked.jacobianNonFinite, blocked.illConditioned],
        ['failed', true, false, false]);
});

// ---------------------------------------------------------------- limits

test('maxSteps has an upper bound: MAX_STEPS = 10000 is accepted, anything above is BAD_OPTIONS', async () => {
    assert.equal(SasFitWorkerCore.MAX_STEPS, 10000);
    const c = caseOf('1 sphere');
    assert.equal(SasFitWorkerCore.settingsOf(fitMessage(c, 1, { options: { maxSteps: 10000 } })).maxSteps, 10000);
    for (const maxSteps of [10001, 1e6, Number.MAX_SAFE_INTEGER, Infinity]) {
        assert.throws(() => SasFitWorkerCore.settingsOf(fitMessage(c, 1, { options: { maxSteps } })), (err) => err.code === 'BAD_OPTIONS');
        const h = makeCore();
        await h.core.handle(fitMessage(c, 'big', { options: { maxSteps } }));
        assert.deepEqual(h.posts.map((m) => [m.type, m.code, m.jobId]), [['error', 'BAD_OPTIONS', 'big']]);
        assert.match(h.posts[0].detail, /10000/);
        assert.deepEqual(h.loads, [], 'refused before anything is loaded');
    }
});

// --------------------------------------------------------- error mapping

test('error mapping: only what the compute core throws while evaluating the model is BAD_PARAMS', async () => {
    const c = caseOf('1 sphere');
    // the real compute core refusing a parameter, in evaluate and inside a fit
    const viaEvaluate = makeCore();
    await viaEvaluate.core.handle(evalMessage(1, { params: { nonsense: 1 } }));
    assert.deepEqual([viaEvaluate.posts[0].code, viaEvaluate.posts[0].reqId], ['BAD_PARAMS', 1]);
    const viaFit = makeCore();
    await viaFit.core.handle(fitMessage(c, 'j', { params: Object.assign({}, c.params, { nonsense: 1 }) }));
    assert.deepEqual(viaFit.posts.map((m) => [m.type, m.code, m.jobId]), [['error', 'BAD_PARAMS', 'j']]);
    assert.match(viaFit.posts[0].detail, /nonsense/);
});

test('error mapping: an Error of the fitter, of the weighting or a TypeError anywhere is INTERNAL, whatever its constructor', async () => {
    const c = caseOf('1 sphere');
    const run = async (name, stub, message) => {
        const h = makeCore();
        await withGlobal(name, stub, () => h.core.handle(message));
        assert.equal(h.posts.length, 1, name);
        return h.posts[0];
    };
    const fitterStub = Object.assign({}, globalThis.SasFitFitter, { fit: () => { throw new Error('fitter invariant broken'); } });
    const fromFitter = await run('SasFitFitter', fitterStub, fitMessage(c, 'f'));
    assert.deepEqual([fromFitter.type, fromFitter.code, fromFitter.jobId], ['error', 'INTERNAL', 'f']);
    assert.match(fromFitter.detail, /fitter invariant broken/);
    assert.match(fromFitter.message, /[一-鿿]/);

    const weightingStub = Object.assign({}, globalThis.SasFitWeighting, { select: () => { throw new Error('select went wrong'); } });
    const fromWeighting = await run('SasFitWeighting', weightingStub, fitMessage(c, 'w'));
    assert.deepEqual([fromWeighting.code, fromWeighting.jobId], ['INTERNAL', 'w']);

    // inside the model evaluation: a plain Error is the core's validation, any other kind is a bug
    const evaluateStub = (err) => Object.assign({}, globalThis.SasFitEvaluate, { evaluate: () => { throw err; } });
    assert.equal((await run('SasFitEvaluate', evaluateStub(new TypeError('x is not a function')), evalMessage(3))).code, 'INTERNAL');
    assert.equal((await run('SasFitEvaluate', evaluateStub(new RangeError('Invalid array length')), fitMessage(c, 'r'))).code, 'INTERNAL');
    const plain = await run('SasFitEvaluate', evaluateStub(new Error('radius must be finite')), fitMessage(c, 'p'));
    assert.deepEqual([plain.code, plain.detail], ['BAD_PARAMS', 'radius must be finite']);
    assert.equal((await run('SasFitEvaluate', evaluateStub('a string'), evalMessage(4))).code, 'INTERNAL');
    // a wasm trap raised through the same call keeps its own code
    assert.equal((await run('SasFitEvaluate', evaluateStub(new Error('wasm kernel sphere failed: unreachable')), evalMessage(5))).code, 'WASM_TRAP');
});

// --------------------------------------------------------------- onFatal

test('a post that fails for the error message too goes to onFatal; handle still resolves', async () => {
    const fatal = [];
    const core = SasFitWorkerCore.create({
        loadWasm: () => Promise.reject(new Error('unused')),
        yieldTask: () => Promise.resolve(),
        post: () => { throw new Error('DataCloneError: channel is gone'); },
        onFatal: (err) => { fatal.push(err); },
    });
    await core.handle({ type: 'nonsense', reqId: 1 });
    assert.equal(fatal.length, 1);
    assert.ok(fatal[0] instanceof Error);
    assert.match(fatal[0].message, /channel is gone/);
    assert.throws(() => SasFitWorkerCore.create({ loadWasm: () => {}, post: () => {}, yieldTask: () => {}, onFatal: 'log' }), /onFatal/);
});

test('without onFatal the failure is not swallowed: it is rethrown from a microtask (an uncaught error of the Worker)', async () => {
    const queued = [];
    const sandbox = { queueMicrotask: (fn) => { queued.push(fn); } };
    for (const name of ['SasFitMeta', 'SasFitValidate', 'SasFitKernel', 'SasFitEvaluate', 'SasFitWeighting', 'SasFitFitter']) {
        sandbox[name] = globalThis[name];
    }
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-worker-core.js'), 'utf8'), sandbox);
    const core = sandbox.SasFitWorkerCore.create({
        loadWasm: () => Promise.reject(new Error('unused')), yieldTask: () => Promise.resolve(),
        post: () => { throw new Error('channel is gone'); },
    });
    await core.handle({ type: 'nonsense', reqId: 1 });
    assert.equal(queued.length, 1);
    assert.throws(() => queued[0](), /channel is gone/);
    // an onFatal that throws itself does not make handle reject either; its error surfaces the same way
    const rude = sandbox.SasFitWorkerCore.create({
        loadWasm: () => Promise.reject(new Error('unused')), yieldTask: () => Promise.resolve(),
        post: () => { throw new Error('gone'); }, onFatal: () => { throw new Error('logger broken'); },
    });
    await rude.handle({ type: 'nonsense', reqId: 2 });
    assert.equal(queued.length, 2);
    assert.throws(() => queued[1](), /logger broken/);
});
