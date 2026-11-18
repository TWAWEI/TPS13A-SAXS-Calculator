'use strict';
/**
 * sasfit-fitter.js and sasfit-linalg.js, in layers that can fail on their own:
 * SVD -> covariance -> Jacobian -> LM against the polished bumps reference
 * (gate G4, design spec 11) -> behaviour -> determinism.
 *
 * The fitter knows no model. `buildProblem` below turns a fit.json case into
 * residuals(p) = (I - I_model)/w with SasFitEvaluate, SasFitWeighting and the
 * wasm kernels; the production version of that glue belongs to the worker core.
 * bumps' residual has the opposite sign, (theory - I)/w, so its Jacobian is
 * compared with the sign flipped; chi2 and the covariance do not depend on it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitMeta, SasFitKernel, SasFitEvaluate, SasFitWeighting, SasFitLinalg, SasFitFitter,
} = require('./load.js');
const { loadFixture, num, loadWasm } = require('./sasfit-helpers.js');

const svdFix = loadFixture('svd');
const fitFix = loadFixture('fit');

const SV_REL = 1e-10;            // singular values: relative ...
const SV_ABS_SCALE = 1e-12;      // ... plus this times the largest one
const ORTHO_TOL = 1e-12;
const COV_TOL = 1e-8;            // |dC_ij| <= tol*sqrt(C_ii*C_jj)
const JAC_TOL = 1e-6;            // per column: |dJ_ij| <= tol*max_i|J_ij|
const G4_PARAM_SIGMA = 0.01;     // design spec 11, G4
const G4_STDERR_REL = 0.02;
const G4_CHI2R_REL = 1e-3;
const FIT_CASES = 12;
const WASM_MODELS = SasFitMeta.order.filter((name) => SasFitMeta.models[name].kind === 'c');

let kernelsPromise = null;
function loadKernels() {
    if (!kernelsPromise) {
        kernelsPromise = Promise.all(WASM_MODELS.map((name) => SasFitKernel.instantiate(loadWasm(name))))
            .then((list) => Object.freeze(Object.fromEntries(WASM_MODELS.map((name, i) => [name, list[i]]))));
    }
    return kernelsPromise;
}

const flat = (rows) => Float64Array.from(rows.flat());

/** residuals(p) and the fit problem of a fit.json case (all points take part). */
function buildProblem(c, kernels) {
    const dataset = {
        q: Float64Array.from(c.data.q), I: Float64Array.from(c.data.I),
        sigma: Float64Array.from(c.data.sigma), kind: 'generic', header: null,
    };
    const range = { qMin: dataset.q[0], qMax: dataset.q[dataset.q.length - 1] };
    const sel = SasFitWeighting.select(dataset, c.weighting, range);
    assert.equal(sel.q.length, dataset.q.length, c.label + ': every point is usable');
    const opts = { cutoff: fitFix.cutoff };
    const residuals = (p) => {
        const params = { ...c.params, ...Object.fromEntries(c.names.map((name, j) => [name, p[j]])) };
        const { I } = SasFitEvaluate.evaluate(c.modelSpec, params, sel.q, opts, kernels);
        return Float64Array.from(I, (model, i) => (sel.I[i] - model) / sel.w[i]);
    };
    return {
        names: c.names,
        start: c.names.map((name) => c.params[name]),
        lower: c.names.map((name) => num(c.bounds[name][0])),
        upper: c.names.map((name) => num(c.bounds[name][1])),
        residuals,
    };
}

const refVector = (c, key) => c.names.map((name) => c[key].values[name]);

/** Largest |dC_ij| / sqrt(C_ii*C_jj) between C (row-major, or rows) and reference rows. */
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

// ---------------------------------------------------------------------- SVD

test('modules are frozen and export the interface', () => {
    assert.ok(Object.isFrozen(SasFitFitter) && Object.isFrozen(SasFitLinalg));
    for (const name of ['fit', 'jacobian', 'covariance', 'svd']) assert.equal(typeof SasFitFitter[name], 'function', name);
    assert.equal(SasFitFitter.svd, SasFitLinalg.svd);
    assert.equal(SasFitFitter.covariance, SasFitLinalg.covariance);
    assert.deepEqual({ ...SasFitFitter.DEFAULTS }, { method: 'lm', maxSteps: 200, ftol: 1e-10, xtol: 1e-10 });
});

test('svd.json holds the eight matrices of the plan', () => {
    assert.equal(svdFix.cases.length, 8);
    assert.equal(svdFix.floor, 1e-8);
    assert.deepEqual(svdFix.cases.filter((c) => c.illConditioned).map((c) => c.label),
        ['rank-deficient 10x4', 'condition 1e12 8x4']);
    assert.ok(svdFix.cases.some((c) => c.m === 1 && c.n === 1) && svdFix.cases.some((c) => c.n === 1 && c.m > 1));
});

test('svd: singular values against the exact ones, V orthogonal, |A v_k| = s_k', () => {
    let worstS = 0;
    let worstOrtho = 0;
    for (const c of svdFix.cases) {
        const { m, n } = c;
        const A = flat(c.A);
        const { s, V } = SasFitLinalg.svd(A, m, n);
        assert.equal(s.length, n);
        assert.equal(V.length, n * n);
        const sMax = c.s[0];
        for (let k = 0; k < n; k++) {
            if (k > 0) assert.ok(s[k] <= s[k - 1], c.label + ': descending');
            const err = Math.abs(s[k] - c.s[k]);
            assert.ok(err <= SV_REL * c.s[k] + SV_ABS_SCALE * sMax, c.label + ' s[' + k + '] ' + s[k] + ' vs ' + c.s[k]);
            worstS = Math.max(worstS, err / sMax);
            let norm = 0;
            for (let i = 0; i < m; i++) {
                let av = 0;
                for (let j = 0; j < n; j++) av += A[i * n + j] * V[j * n + k];
                norm += av * av;
            }
            assert.ok(Math.abs(Math.sqrt(norm) - s[k]) <= SV_REL * s[k] + SV_ABS_SCALE * sMax, c.label + ' |A v_' + k + '|');
        }
        for (let a = 0; a < n; a++) {
            for (let b = 0; b < n; b++) {
                let dot = 0;
                for (let i = 0; i < n; i++) dot += V[i * n + a] * V[i * n + b];
                const err = Math.abs(dot - (a === b ? 1 : 0));
                assert.ok(err <= ORTHO_TOL, c.label + ' V orthogonality ' + err);
                worstOrtho = Math.max(worstOrtho, err);
            }
        }
    }
    console.log('svd: worst |ds|/s_max = ' + worstS.toExponential(2) + ', worst |V\'V - I| = ' + worstOrtho.toExponential(2));
});

test('svd: inputs are checked and not modified', () => {
    const A = Float64Array.of(1, 2, 3, 4, 5, 6);
    const before = Array.from(A);
    SasFitLinalg.svd(A, 3, 2);
    assert.deepEqual(Array.from(A), before);
    assert.throws(() => SasFitLinalg.svd(A, 2, 2), /6|4/);
    assert.throws(() => SasFitLinalg.svd(A, 2, 3), /m >= n/);
    assert.throws(() => SasFitLinalg.svd(Float64Array.of(1, NaN), 2, 1), /finite/);
    assert.deepEqual(Array.from(SasFitLinalg.svd([3, 4], 2, 1).s), [5]);
});

// --------------------------------------------------------------- covariance

test('covariance: exact C in the scaled norm; illConditioned exactly when a singular value was replaced', () => {
    let worst = 0;
    for (const c of svdFix.cases) {
        const A = flat(c.A);
        const before = Array.from(A);
        const { C, illConditioned } = SasFitLinalg.covariance(A, c.m, c.n);
        assert.deepEqual(Array.from(A), before, c.label + ': input untouched');
        assert.equal(illConditioned, c.illConditioned, c.label);
        const err = covarianceError(C, c.C);
        assert.ok(err <= COV_TOL, c.label + ': scaled covariance error ' + err);
        worst = Math.max(worst, err);
    }
    console.log('covariance: worst scaled error vs exact C = ' + worst.toExponential(2));
});

test('covariance: the 1e-8 floor is inclusive, and a hand-made case', () => {
    // J = diag(2, s) stacked on zeros: C = diag(1/4, 1/max(s, 1e-8)^2).
    const at = (sv) => SasFitLinalg.covariance(Float64Array.of(2, 0, 0, sv, 0, 0), 3, 2);
    assert.deepEqual(Array.from(at(0.5).C), [0.25, 0, 0, 4]);
    assert.equal(at(0.5).illConditioned, false);
    assert.equal(at(1.1e-8).illConditioned, false);
    assert.equal(at(1e-8).illConditioned, true);          // s <= tol (lsqerror.py:284)
    assert.equal(at(0).illConditioned, true);
    assert.equal(at(0).C[3], 1 / (1e-8 * 1e-8));
    assert.equal(at(1e-8).C[3], 1 / (1e-8 * 1e-8));
    assert.ok(at(1.1e-8).C[3] < 1e16);
});

test('covariance: a non-finite Jacobian gives NaN and illConditioned; m < n is refused', () => {
    const { C, illConditioned } = SasFitLinalg.covariance(Float64Array.of(1, 0, NaN, 1, 0, 0), 3, 2);
    assert.equal(illConditioned, true);
    assert.ok(Array.from(C).every(Number.isNaN));
    assert.throws(() => SasFitLinalg.covariance(Float64Array.of(1, 2), 1, 2), /m >= n/);
});

test('covariance of the bumps Jacobian of every fit case reproduces bumps covariance and stderr', () => {
    let worst = 0;
    for (const c of fitFix.cases) {
        const m = c.ref.jacobian.length;
        const n = c.names.length;
        const { C, illConditioned } = SasFitFitter.covariance(flat(c.ref.jacobian), m, n);
        assert.equal(illConditioned, false, c.label);     // min singular value >= 0.195 in the fixture
        const err = covarianceError(C, c.ref.covariance);
        assert.ok(err <= COV_TOL, c.label + ': ' + err);
        worst = Math.max(worst, err);
        c.names.forEach((name, j) => {
            const rel = Math.abs(Math.sqrt(C[j * n + j]) - c.ref.stderr[name]) / c.ref.stderr[name];
            assert.ok(rel <= COV_TOL, c.label + ' stderr ' + name + ' ' + rel);
        });
    }
    console.log('covariance from bumps Jacobians: worst scaled error = ' + worst.toExponential(2));
});

// ----------------------------------------------------------------- Jacobian

test('fit.json holds the twelve G4 cases with the documented conventions', () => {
    assert.equal(fitFix.cases.length, FIT_CASES);
    assert.equal(fitFix.bumps, '1.0.4');
    assert.equal(fitFix.cutoff, 1e-5);
    assert.deepEqual(fitFix.fitOptions, { steps: 200, ftol: 1e-10, xtol: 1e-10 });
    assert.deepEqual(fitFix.cases.map((c) => c.weighting).filter((w) => w !== 'sigma'), ['sqrtI', 'absI', 'none']);
    assert.deepEqual(fitFix.cases.filter((c) => Object.keys(c.ref.atBound).length > 0).map((c) => c.ref.atBound),
        [{ rg: 'upper' }, { radius: 'lower' }]);
    assert.ok(fitFix.cases.some((c) => c.names.includes('radius_pd')));
    assert.ok(fitFix.cases.some((c) => c.modelSpec.structure === 'hardsphere'));
    assert.ok(fitFix.cases.some((c) => c.modelSpec.lowQPowerLaw));
});

test('jacobian: residuals and Jacobian at the reference point against bumps lsqerror.jacobian', async () => {
    const kernels = await loadKernels();
    for (const c of fitFix.cases) {
        const problem = buildProblem(c, kernels);
        const p = refVector(c, 'ref');
        const r = problem.residuals(Float64Array.from(p));
        const rScale = c.ref.residuals.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
        const rErr = c.ref.residuals.reduce((max, v, i) => Math.max(max, Math.abs(-r[i] - v)), 0) / rScale;
        const { J, m, n } = SasFitFitter.jacobian(problem.residuals, p, problem.lower, problem.upper);
        assert.equal(m, c.ref.jacobian.length);
        assert.equal(n, c.names.length);
        let worst = 0;
        for (let j = 0; j < n; j++) {
            const colMax = c.ref.jacobian.reduce((max, row) => Math.max(max, Math.abs(row[j])), 0);
            for (let i = 0; i < m; i++) {
                worst = Math.max(worst, Math.abs(-J[i * n + j] - c.ref.jacobian[i][j]) / colMax);
            }
        }
        console.log('jacobian ' + c.label.padEnd(36) + ' worst column-scaled error ' + worst.toExponential(2)
            + ' | residuals ' + rErr.toExponential(2));
        assert.ok(worst <= JAC_TOL, c.label + ': Jacobian error ' + worst);
    }
});

test('jacobian: the bumps step rule (h = 1e-4|p|, 1e-4 at 0, backward only when p + h > upper)', () => {
    const calls = [];
    const residuals = (p) => {
        calls.push(Array.from(p));
        return [p[0] * p[0], p[0] * p[1], p[2] + 3 * p[3]];
    };
    const p = [2, 10, 0, 5];
    const lower = [2, -Infinity, 0, 0];             // on a lower bound: still a forward step
    const upper = [Infinity, 10.0005, Infinity, 5 + 5e-4];
    const { J, m, n } = SasFitFitter.jacobian(residuals, p, lower, upper);
    assert.equal(m, 3);
    assert.equal(n, 4);
    // p[1] + 1e-3 > 10.0005 -> backward; p[3] + 5e-4 equals its upper bound -> forward (strictly greater).
    assert.deepEqual(calls, [
        [2, 10, 0, 5], [2 + 2e-4, 10, 0, 5], [2, 10 - 1e-3, 0, 5], [2, 10, 1e-4, 5], [2, 10, 0, 5 + 5e-4],
    ]);
    const h0 = (2 + 2e-4) - 2;
    assert.equal(J[0], ((2 + 2e-4) * (2 + 2e-4) - 4) / 2e-4);
    assert.ok(Math.abs(J[0] - (4 + h0)) < 1e-9);
    assert.equal(J[1 * 4 + 1], (2 * (10 - 1e-3) - 20) / -1e-3);
    assert.equal(J[2 * 4 + 2], ((1e-4 + 15) - 15) / 1e-4);
    assert.equal(J[2 * 4 + 3], ((0 + 3 * (5 + 5e-4)) - 15) / 5e-4);
    assert.deepEqual(p, [2, 10, 0, 5]);
});

// ------------------------------------------------------------------ G4 (LM)

/** The three G4 ratios of a result against a reference { values, stderr } and chi2r. */
function g4Ratios(c, result, values, stderr, chi2r) {
    let dp = 0;
    let de = 0;
    c.names.forEach((name, j) => {
        dp = Math.max(dp, Math.abs(result.values[j] - values[name]) / stderr[name]);
        de = Math.max(de, Math.abs(result.errors[j] - stderr[name]) / stderr[name]);
    });
    return { dp, de, dchi: Math.abs(result.chi2r - chi2r) / chi2r };
}

const sci = (v) => v.toExponential(2);

test('G4: LM from the same start against the polished bumps reference', async () => {
    const kernels = await loadKernels();
    const failures = [];
    for (const c of fitFix.cases) {
        const problem = buildProblem(c, kernels);
        const result = SasFitFitter.fit(problem, { method: 'lm' });
        const ref = g4Ratios(c, result, c.ref.values, c.ref.stderr, c.ref.chi2r);
        const raw = g4Ratios(c, result, c.bumpsRaw.values, c.bumpsRaw.stderr, c.bumpsRaw.sumsq / c.ref.dof);
        console.log('G4 ' + c.label.padEnd(36) + ' it ' + String(result.iterations).padStart(2)
            + ' | vs polished: dp/sigma ' + sci(ref.dp) + ' dstderr ' + sci(ref.de) + ' dchi2r ' + sci(ref.dchi)
            + ' | vs raw bumps: dp/sigma ' + sci(raw.dp) + ' dstderr ' + sci(raw.de) + ' dchi2r ' + sci(raw.dchi)
            + ' | bumps nit ' + c.bumpsRaw.nit);
        assert.equal(result.status, 'converged', c.label);
        assert.equal(result.dof, c.ref.dof, c.label);
        assert.equal(result.illConditioned, false, c.label);
        assert.deepEqual({ ...result.atBound }, c.ref.atBound, c.label);
        for (const [name, side] of Object.entries(c.ref.atBound)) {
            const j = c.names.indexOf(name);
            assert.equal(result.values[j], side === 'upper' ? problem.upper[j] : problem.lower[j], c.label + ': exactly on the bound');
            assert.ok(Number.isFinite(result.errors[j]) && result.errors[j] > 0, c.label + ': error of a parameter on a bound');
        }
        if (!(ref.dp < G4_PARAM_SIGMA) || !(ref.de <= G4_STDERR_REL) || !(ref.dchi <= G4_CHI2R_REL)) failures.push(c.label);
        assert.ok(covarianceError(result.covariance, c.ref.covariance) <= G4_STDERR_REL * 2, c.label + ': covariance');
    }
    assert.deepEqual(failures, [], 'G4 thresholds (0.01 sigma, 2 %, 1e-3) exceeded');
});

// ---------------------------------------------------------------- behaviour

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

test('fit: result shape, frozen, plain data', () => {
    const result = SasFitFitter.fit(decayProblem());
    assert.deepEqual(Object.keys(result).sort(), ['atBound', 'chi2', 'chi2r', 'covariance', 'dof', 'errors',
        'illConditioned', 'iterations', 'names', 'status', 'values'].sort());
    assert.equal(result.status, 'converged');
    assert.equal(result.dof, 37);
    assert.equal(result.chi2r, result.chi2 / 37);
    assert.deepEqual(result.atBound, {});
    assert.ok(Math.abs(result.values[0] - 5) < 0.1 && Math.abs(result.values[1] - 1.3) < 0.05);
    result.errors.forEach((e, j) => assert.equal(e, Math.sqrt(result.covariance[j][j])));
    for (const part of [result, result.names, result.values, result.errors, result.atBound, result.covariance,
        result.covariance[0]]) assert.ok(Object.isFrozen(part));
    assert.deepEqual(structuredClone(result), result);
});

test('fit: maxSteps reached -> maxiter with a complete result', () => {
    const full = SasFitFitter.fit(decayProblem());
    assert.ok(full.iterations > 3);
    const result = SasFitFitter.fit(decayProblem(), { maxSteps: 3 });
    assert.equal(result.status, 'maxiter');
    assert.equal(result.iterations, 3);
    assert.ok(result.chi2 > full.chi2);
    assert.ok(result.errors.every((e) => Number.isFinite(e) && e > 0));
    assert.equal(result.covariance.length, 3);
});

test('fit: shouldStop is asked before every iteration; true on the second call -> stopped after one step', () => {
    let asked = 0;
    const result = SasFitFitter.fit(decayProblem(), { shouldStop: () => ++asked === 2 });
    assert.equal(asked, 2);
    assert.equal(result.status, 'stopped');
    assert.equal(result.iterations, 1);
    assert.ok(result.errors.every(Number.isFinite));
});

test('fit: onProgress once per accepted step, iteration counts up, chi2 is that point\'s sum of squares and never rises', () => {
    const seen = [];
    const problem = decayProblem();
    let evaluations = [];
    const spy = { ...problem, residuals: (p) => { const r = problem.residuals(p); evaluations.push(r.reduce((s, v) => s + v * v, 0)); return r; } };
    const result = SasFitFitter.fit(spy, { onProgress: (info) => seen.push({ ...info, frozen: Object.isFrozen(info) }) });
    assert.equal(seen.length, result.iterations);
    seen.forEach((info, k) => {
        assert.equal(info.iteration, k + 1);
        assert.ok(info.frozen);
        assert.ok(evaluations.includes(info.chi2), 'chi2 of an evaluated point');
        if (k > 0) assert.ok(info.chi2 < seen[k - 1].chi2);
    });
    assert.ok(seen[0].chi2 < evaluations[0]);
    assert.equal(seen[seen.length - 1].chi2, result.chi2);
});

test('fit: non-finite residuals reject the step, never throw, and the fit ends at the same minimum', () => {
    const plain = SasFitFitter.fit(decayProblem());
    for (const bad of [NaN, Infinity]) {
        let poisoned = 0;
        const base = decayProblem();
        // The first trial steps overshoot b; those points "cannot be computed".
        const residuals = (p) => {
            const r = base.residuals(p);
            if (p[1] > 1.32) { poisoned++; r[7] = bad; }
            return r;
        };
        const result = SasFitFitter.fit({ ...base, residuals });
        assert.ok(poisoned > 0, 'the wrapper was triggered');
        assert.equal(result.status, 'converged');
        assert.ok(Math.abs(result.chi2 - plain.chi2) <= 1e-9 * plain.chi2, result.chi2 + ' vs ' + plain.chi2);
        result.values.forEach((v, j) => assert.ok(Math.abs(v - plain.values[j]) <= 1e-3 * plain.errors[j]));
        assert.ok(result.values[1] <= 1.32);
    }
});

test('fit: a NaN in the Jacobian evaluation only drops that row from the step', () => {
    const base = decayProblem();
    const plain = SasFitFitter.fit(base);
    let poisoned = 0;
    // Exactly the forward-difference points of b during the first iterations are poisoned.
    const residuals = (p) => {
        const r = base.residuals(p);
        if (poisoned < 2 && p[1] !== 0.7 && p[0] === 3 && p[2] === 0.2) { poisoned++; r[3] = NaN; }
        return r;
    };
    const result = SasFitFitter.fit({ ...base, residuals });
    assert.ok(poisoned > 0);
    assert.equal(result.status, 'converged');
    assert.ok(Math.abs(result.chi2 - plain.chi2) <= 1e-9 * plain.chi2);
});

test('fit: a non-finite start point -> failed, reporting the start', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
        const base = decayProblem();
        const result = SasFitFitter.fit({ ...base, residuals: (p) => base.residuals(p).map((v, i) => (i === 5 ? bad : v)) });
        assert.equal(result.status, 'failed');
        assert.deepEqual(result.values, [3, 0.7, 0.2]);
        assert.equal(result.iterations, 0);
        assert.equal(result.chi2, Infinity);
        assert.equal(result.chi2r, Infinity);
        assert.equal(result.dof, 37);
        assert.ok(result.errors.every(Number.isNaN));
        assert.ok(result.covariance.flat().every(Number.isNaN));
        assert.ok(Object.isFrozen(result));
    }
    const nanStart = SasFitFitter.fit(decayProblem({ start: [3, NaN, 0.2] }));
    assert.equal(nanStart.status, 'failed');
});

test('fit: no finite row in the Jacobian -> failed at the best point so far, not a false convergence', () => {
    const base = decayProblem();
    // Only the start point itself can be computed.
    const residuals = (p) => (p[0] === 3 && p[1] === 0.7 && p[2] === 0.2 ? base.residuals(p) : base.residuals(p).map(() => NaN));
    const result = SasFitFitter.fit({ ...base, residuals });
    assert.equal(result.status, 'failed');
    assert.equal(result.iterations, 0);
    assert.deepEqual(result.values, [3, 0.7, 0.2]);
    assert.ok(Number.isFinite(result.chi2) && result.chi2 > 0);
    assert.ok(result.errors.every(Number.isNaN));
    assert.equal(result.illConditioned, true);
});

test('fit: the final Jacobian not finite -> errors NaN and illConditioned, values kept', () => {
    const base = decayProblem();
    const plain = SasFitFitter.fit(base);
    // Poison only the forward-difference point of b taken at the final solution.
    const hb = Math.abs(plain.values[1]) * 1e-4;
    const residuals = (p) => {
        const r = base.residuals(p);
        if (p[0] === plain.values[0] && p[1] === plain.values[1] + hb) r[0] = NaN;
        return r;
    };
    const result = SasFitFitter.fit({ ...base, residuals });
    assert.deepEqual(result.values, plain.values);
    assert.equal(result.illConditioned, true);
    assert.ok(result.errors.every(Number.isNaN));
});

test('fit: start outside the bounds is clipped; a value on a bound is exactly the bound, with a finite error', () => {
    const seen = [];
    const base = decayProblem({ start: [3, 50, 0.2] });
    const first = SasFitFitter.fit({ ...base, residuals: (p) => { seen.push(Array.from(p)); return base.residuals(p); } });
    assert.deepEqual(seen[0], [3, 10, 0.2]);
    assert.equal(first.status, 'converged');
    const upper = SasFitFitter.fit(decayProblem({ upper: [Infinity, 1.1, Infinity] }));
    assert.equal(upper.values[1], 1.1);
    assert.deepEqual({ ...upper.atBound }, { b: 'upper' });
    const lower = SasFitFitter.fit(decayProblem({ start: [3, 2, 0.2], lower: [0, 1.5, -Infinity] }));
    assert.equal(lower.values[1], 1.5);
    assert.deepEqual({ ...lower.atBound }, { b: 'lower' });
    for (const result of [upper, lower]) {
        assert.equal(result.status, 'converged');
        assert.ok(result.errors.every((e) => Number.isFinite(e) && e > 0));
    }
    // The constrained minimum: the same fit with b removed from the problem.
    const base2 = decayProblem();
    const reduced = SasFitFitter.fit({
        names: ['a', 'c'], start: [3, 0.2], lower: [0, -Infinity], upper: [Infinity, Infinity],
        residuals: (p) => base2.residuals([p[0], 1.1, p[1]]),
    });
    assert.ok(Math.abs(upper.chi2 - reduced.chi2) <= 1e-9 * reduced.chi2);
});

test('fit: problem and options are validated with messages that name the culprit', () => {
    const few = decayProblem();
    assert.throws(() => SasFitFitter.fit({ ...few, residuals: () => [1, 2, 3] }), /3 residuals for 3/);
    assert.throws(() => SasFitFitter.fit({ ...few, residuals: () => [1, 2] }), /Not enough points/);
    assert.throws(() => SasFitFitter.fit(decayProblem({ lower: [0, 5, 0], upper: [1, 4, 1] })), /b/);
    assert.throws(() => SasFitFitter.fit(decayProblem({ start: [1, 2] })), /start/);
    assert.throws(() => SasFitFitter.fit(decayProblem({ names: ['a', 'a', 'c'] })), /duplicates/);
    assert.throws(() => SasFitFitter.fit(decayProblem({ residuals: null })), /residuals/);
    assert.throws(() => SasFitFitter.fit(decayProblem(), { method: 'de' }), /de/);
    assert.throws(() => SasFitFitter.fit(decayProblem(), { maxSteps: 0 }), /maxSteps/);
    assert.throws(() => SasFitFitter.fit(decayProblem(), { ftol: -1 }), /ftol/);
    assert.throws(() => SasFitFitter.fit(null), /problem/);
});

test('fit: the problem, its arrays and the p handed to residuals are not shared or modified', () => {
    const problem = decayProblem();
    const frozen = Object.freeze({
        ...problem, names: Object.freeze(problem.names), start: Object.freeze(problem.start),
        lower: Object.freeze(problem.lower), upper: Object.freeze(problem.upper),
        // A hostile callee: it scribbles on its argument.
        residuals: (p) => { const r = problem.residuals(p); p.fill(-1); return r; },
    });
    const options = Object.freeze({ maxSteps: 50 });
    const result = SasFitFitter.fit(frozen, options);
    assert.equal(result.status, 'converged');
    assert.deepEqual(result.values, SasFitFitter.fit(decayProblem()).values);
    assert.notEqual(result.names, frozen.names);
});

// -------------------------------------------------------------- determinism

test('determinism: the same input twice gives bit-identical results', async () => {
    const kernels = await loadKernels();
    for (const c of [fitFix.cases[0], fitFix.cases[4], fitFix.cases[7]]) {
        const a = SasFitFitter.fit(buildProblem(c, kernels));
        const b = SasFitFitter.fit(buildProblem(c, kernels));
        assert.deepEqual(a, b, c.label);
        const bits = (r) => Buffer.from(Float64Array.from([...r.values, ...r.errors, r.chi2, ...r.covariance.flat()]).buffer).toString('hex');
        assert.equal(bits(a), bits(b), c.label);
    }
});
