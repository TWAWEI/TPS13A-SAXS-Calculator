'use strict';
/**
 * sasfit-worker-core.js: "message -> computation -> message" as pure logic
 * (design spec 4.9, 4.10, 12; plan M2 Task 4 and review section D).
 *
 * The core gets everything from outside: loadWasm (here the synchronous test
 * helper wrapped in a Promise, with a call counter), post (collects the
 * outgoing messages) and yieldTask (immediate, or held by the test to prove
 * latest-wins) -- makeCore in sasfit-fit-helpers.js.
 *
 * This file: the module, evaluate, latest-wins, errors and message validation.
 * Fits are in sasfit-worker-core-fit.test.js, the FitResult fields and error
 * mapping added by the M2 review in sasfit-worker-core-result.test.js, gate G4
 * through the message interface in sasfit-g4.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitMeta, SasFitKernel, SasFitEvaluate, SasFitWorkerCore } = require('./load.js');
const { loadWasm } = require('./sasfit-helpers.js');
const { caseOf, fitMessage, directKernels, settle, makeCore } = require('./sasfit-fit-helpers.js');

const Q = Float64Array.from({ length: 40 }, (_, i) => 0.005 * Math.pow(1.06, i));
const CUT = Object.freeze({ cutoff: 1e-5 });
// The scan of the hayter_msa characterisation test in sasfit-product.test.js (design spec 16)
const HMSA_SCAN = Object.freeze({ q: 1e-3, from: 80, to: 105, steps: 201,
    pars: Object.freeze({ charge: 16.3, concentration_salt: 0.056, volfraction: 0.056 }) });

const immediate = () => Promise.resolve();

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
    assert.equal(SasFitWorkerCore.MAX_STEPS, 10000);
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
