'use strict';
/**
 * Shared helpers for the sasfit fitter / worker tests (no test cases here).
 *
 *   pseudoGaussian(seed)     deterministic pseudo-noise: () -> a number of mean 0, variance 1
 *   decayProblem(overrides)  a cheap smooth 3-parameter SasFitFitter problem,
 *                            y = a*exp(-b*x) + c on 40 points (truth 5, 1.3, 0.5; start 3, 0.7, 0.2)
 *   expDecay                 the reviewer's 2-parameter wall problem a*exp(-k*t), true k = 0.70:
 *                            { exact(p) -> residuals, problem(residuals, start) }
 *   recordCalls(residuals)   { residuals, calls }: the same function, recording every p it is given
 *
 *   FIT_RESULT_FIELDS        the keys of a FitResult as the worker core and the client deliver it
 *   fitFixture()             fixtures/sasfit/fit.json (parsed once)
 *   caseOf(prefix)           the one fit.json case whose label starts with prefix
 *   fitJob(c, extra)         a fit.json case as the job of SasFitWorkerClient.fit: bounds as numbers,
 *                            typed arrays, the case's own `range` when it has one, else the full q range
 *   fitMessage(c, jobId, extra)   the same as the 'fit' message of SasFitWorkerCore
 *   directKernels(names)     Promise<{ name: wasm exports }> straight from the .wasm files
 *   loadKernels()            the same for every C model of SasFitMeta, instantiated once per test file
 *   usedPoints(c)            how many points of a fit.json case take part: its `nUsed`, else all
 *   buildProblem(c, kernels) the SasFitFitter problem of a fit.json case: residuals(p) = (I - I_model)/w on
 *                            the points SasFitWeighting.select keeps (asserted to be usedPoints(c) points)
 *   refVector(c, key)        c[key].values in the order of c.names (key: 'ref' | 'bumpsRaw')
 *   covarianceError(C, refRows)   largest |dC_ij|/sqrt(C_ii*C_jj) against reference rows
 *   G4                       the thresholds of gate G4 (design spec 11); never loosen
 *   g4Ratios(c, values, errors, chi2r, ref?)   { dp, de, dchi } of a result against c.ref (or `ref`):
 *                            worst parameter difference in sigma, worst relative error difference,
 *                            relative chi2r difference; values and errors are keyed by name
 *   settle()                 Promise resolved in a later macrotask (setImmediate)
 *   makeCore(overrides)      { core, posts, loads, ofType(type) }: a SasFitWorkerCore with a counting
 *                            loadWasm, collected posts and an immediate yieldTask
 *
 *   CLIENT_VERSION           the cache version the client tests create their clients with
 *   evalRequest(extra)       a small sphere request for SasFitWorkerClient.evaluate
 *   fakeWorkers(options)     { client, workers, last() }: a client over hand-driven fake Workers. Every
 *                            created worker records url, sent messages and terminate calls, and has
 *                            reply(data) to feed a message. options: Client = the module to use
 *                            (default the loaded one), onCreate(count) called before each creation
 *                            (may throw, or return a replacement for the worker object)
 *   rejection(promise)       the Error a promise rejects with (fails when it resolves)
 *   outcome(promise)         'pending' | 'resolved' | 'rejected' after a macrotask, without waiting further
 */
const assert = require('node:assert/strict');
const {
    SasFitMeta, SasFitKernel, SasFitEvaluate, SasFitWeighting, SasFitWorkerCore, SasFitWorkerClient,
} = require('./load.js');
const { loadFixture, num, loadWasm } = require('./sasfit-helpers.js');

const FIT_RESULT_FIELDS = Object.freeze(['params', 'names', 'errors', 'errorsScaled', 'displayErrorsScaled',
    'covariance', 'correlation', 'chi2', 'chi2r', 'dof', 'iterations', 'status', 'atBound', 'illConditioned',
    'blockedByNonFinite', 'jacobianNonFinite', 'nonFiniteCurvePoints', 'curve', 'residuals', 'settings']);

let fitFixtureCache = null;
function fitFixture() {
    if (fitFixtureCache === null) fitFixtureCache = loadFixture('fit');
    return fitFixtureCache;
}

function caseOf(prefix) {
    const found = fitFixture().cases.filter((c) => c.label.startsWith(prefix));
    assert.equal(found.length, 1, 'fit.json case ' + prefix);
    return found[0];
}

function fitJob(c, extra) {
    const q = Float64Array.from(c.data.q);
    const fix = fitFixture();
    return Object.assign({
        modelSpec: c.modelSpec,
        params: c.params,
        fitFlags: c.fitFlags,
        bounds: Object.fromEntries(Object.entries(c.bounds).map(([k, [lo, hi]]) => [k, [num(lo), num(hi)]])),
        data: { q, I: Float64Array.from(c.data.I), sigma: Float64Array.from(c.data.sigma), kind: 'generic', header: null },
        range: c.range ? { qMin: c.range.qMin, qMax: c.range.qMax } : { qMin: q[0], qMax: q[q.length - 1] },
        weighting: c.weighting,
        options: { maxSteps: fix.fitOptions.steps, cutoff: fix.cutoff },
    }, extra);
}

const fitMessage = (c, jobId, extra) => Object.assign({ type: 'fit', jobId }, fitJob(c), extra);

async function directKernels(names) {
    const list = await Promise.all(names.map((name) => SasFitKernel.instantiate(loadWasm(name))));
    return Object.fromEntries(names.map((name, i) => [name, list[i]]));
}

let kernelsPromise = null;
function loadKernels() {
    if (kernelsPromise === null) {
        const names = SasFitMeta.order.filter((name) => SasFitMeta.models[name].kind === 'c');
        kernelsPromise = directKernels(names).then(Object.freeze);
    }
    return kernelsPromise;
}

const usedPoints = (c) => (c.nUsed === undefined ? c.data.q.length : c.nUsed);

function buildProblem(c, kernels) {
    const job = fitJob(c);
    const sel = SasFitWeighting.select(job.data, c.weighting, job.range);
    assert.equal(sel.q.length, usedPoints(c), c.label + ': the points that take part');
    const opts = { cutoff: fitFixture().cutoff };
    const residuals = (p) => {
        const params = { ...c.params, ...Object.fromEntries(c.names.map((name, j) => [name, p[j]])) };
        const { I } = SasFitEvaluate.evaluate(c.modelSpec, params, sel.q, opts, kernels);
        return Float64Array.from(I, (model, i) => (sel.I[i] - model) / sel.w[i]);
    };
    return {
        names: c.names,
        start: c.names.map((name) => c.params[name]),
        lower: c.names.map((name) => job.bounds[name][0]),
        upper: c.names.map((name) => job.bounds[name][1]),
        residuals,
    };
}

const refVector = (c, key) => c.names.map((name) => c[key].values[name]);

function covarianceError(C, refRows) {
    const n = refRows.length;
    let worst = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const got = Array.isArray(C[i]) ? C[i][j] : C[i * n + j];
            worst = Math.max(worst, Math.abs(got - refRows[i][j]) / Math.sqrt(refRows[i][i] * refRows[j][j]));
        }
    }
    return worst;
}

const G4 = Object.freeze({ PARAM_SIGMA: 0.01, STDERR_REL: 0.02, CHI2R_REL: 1e-3 });

function g4Ratios(c, values, errors, chi2r, ref) {
    const want = ref || { values: c.ref.values, stderr: c.ref.stderr, chi2r: c.ref.chi2r };
    let dp = 0;
    let de = 0;
    for (const name of c.names) {
        dp = Math.max(dp, Math.abs(values[name] - want.values[name]) / want.stderr[name]);
        de = Math.max(de, Math.abs(errors[name] - want.stderr[name]) / want.stderr[name]);
    }
    return { dp, de, dchi: Math.abs(chi2r - want.chi2r) / want.chi2r };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function makeCore(overrides) {
    const posts = [];
    const loads = [];
    const deps = Object.assign({
        loadWasm: (name) => { loads.push(name); return Promise.resolve(loadWasm(name)); },
        post: (message) => { posts.push(message); },
        yieldTask: () => Promise.resolve(),
    }, overrides);
    const core = SasFitWorkerCore.create(deps);
    const ofType = (type) => posts.filter((m) => m.type === type);
    return { core, posts, loads, ofType };
}

const CLIENT_VERSION = '9.87';
const EVAL_Q = Float64Array.from({ length: 30 }, (_, i) => 0.006 * Math.pow(1.08, i));
const evalRequest = (extra) => Object.assign({ modelSpec: { model: 'sphere' }, params: { radius: 40 }, q: EVAL_Q, opts: { cutoff: 1e-5 } }, extra);

function fakeWorkers(options) {
    const o = options || {};
    const workers = [];
    let created = 0;
    const createWorker = (url) => {
        created += 1;
        const replacement = o.onCreate ? o.onCreate(created) : undefined;
        if (replacement !== undefined) return replacement;
        const worker = { url, sent: [], terminated: 0, onmessage: null, onerror: null, onmessageerror: null };
        worker.postMessage = (message) => { worker.sent.push(message); };
        worker.terminate = () => { worker.terminated += 1; };
        worker.reply = (data) => worker.onmessage({ data });
        workers.push(worker);
        return worker;
    };
    const client = (o.Client || SasFitWorkerClient).create({ createWorker, version: CLIENT_VERSION });
    return { workers, client, last: () => workers[workers.length - 1], created: () => created };
}

async function rejection(promise) {
    try {
        await promise;
    } catch (err) {
        // by name: an Error made in another realm (a vm context) is not `instanceof Error` here
        assert.ok(err !== null && typeof err === 'object' && typeof err.message === 'string', 'rejections are Error objects, got ' + String(err));
        return err;
    }
    return assert.fail('the promise did not reject');
}

async function outcome(promise) {
    let state = 'pending';
    promise.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
    await settle();
    return state;
}

/** Sum of 12 uniform numbers of a 32-bit LCG, minus 6 (mean 0, variance 1). */
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

/** y = a*exp(-b*x) + c with a fixed pseudo-noise; cheap, smooth, three parameters. */
function decayProblem(overrides) {
    const x = Array.from({ length: 40 }, (_, i) => 0.1 * i);
    const y = x.map((xi, i) => 5 * Math.exp(-1.3 * xi) + 0.5 + 0.02 * Math.sin(12.9898 * (i + 1)));
    const residuals = (p) => x.map((xi, i) => (y[i] - (p[0] * Math.exp(-p[1] * xi) + p[2])) / 0.02);
    return {
        names: ['a', 'b', 'c'], start: [3, 0.7, 0.2],
        lower: [0, 0, -Infinity], upper: [Infinity, 10, Infinity], residuals, ...overrides,
    };
}

const EXP_T = Object.freeze(Array.from({ length: 30 }, (_, i) => 0.2 * i));
const EXP_SIGMA = 0.05;
const EXP_Y = Object.freeze((() => {
    const noise = pseudoGaussian(7);
    return EXP_T.map((t) => 10 * Math.exp(-0.70 * t) + EXP_SIGMA * noise());
})());

const expDecay = Object.freeze({
    exact: (p) => EXP_T.map((t, i) => (EXP_Y[i] - p[0] * Math.exp(-p[1] * t)) / EXP_SIGMA),
    problem: (residuals, start) => ({
        names: ['a', 'k'], start: start || [8, 1.2], lower: [0, 0], upper: [Infinity, 10], residuals,
    }),
});

function recordCalls(residuals) {
    const calls = [];
    return { calls, residuals: (p) => { calls.push(Array.from(p)); return residuals(p); } };
}

module.exports = {
    pseudoGaussian, decayProblem, expDecay, recordCalls,
    FIT_RESULT_FIELDS, fitFixture, caseOf, fitJob, fitMessage, directKernels, settle, makeCore,
    loadKernels, usedPoints, buildProblem, refVector, covarianceError, G4, g4Ratios,
    CLIENT_VERSION, EVAL_Q, evalRequest, fakeWorkers, rejection, outcome,
};
