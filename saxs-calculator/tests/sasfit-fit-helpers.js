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
 *   settle()                 Promise resolved in a later macrotask (setImmediate)
 *   makeCore(overrides)      { core, posts, loads, ofType(type) }: a SasFitWorkerCore with a counting
 *                            loadWasm, collected posts and an immediate yieldTask
 */
const assert = require('node:assert/strict');
const { SasFitKernel, SasFitWorkerCore } = require('./load.js');
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
};
