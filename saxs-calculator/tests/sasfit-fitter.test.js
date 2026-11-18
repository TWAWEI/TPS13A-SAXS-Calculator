'use strict';
/**
 * sasfit-fitter.js and sasfit-linalg.js, in layers that can fail on their own:
 * SVD -> covariance -> the Jacobian step rule -> behaviour of the LM fit.
 * The comparisons with bumps on the fit.json cases (Jacobian, gate G4,
 * determinism) are in sasfit-g4.test.js; non-finite model output is in
 * sasfit-fitter-nonfinite.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitLinalg, SasFitFitter } = require('./load.js');
const { loadFixture } = require('./sasfit-helpers.js');
const { decayProblem, covarianceError } = require('./sasfit-fit-helpers.js');

const svdFix = loadFixture('svd');

const SV_REL = 1e-10;            // singular values: relative ...
const SV_ABS_SCALE = 1e-12;      // ... plus this times the largest one
const ORTHO_TOL = 1e-12;
const COV_TOL = 1e-8;            // |dC_ij| <= tol*sqrt(C_ii*C_jj)
const flat = (rows) => Float64Array.from(rows.flat());

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

test('covariance: a non-finite Jacobian gives NaN and nonFinite, not illConditioned; m < n is refused', () => {
    const { C, illConditioned, nonFinite, converged } = SasFitLinalg.covariance(Float64Array.of(1, 0, NaN, 1, 0, 0), 3, 2);
    assert.deepEqual([illConditioned, nonFinite, converged], [false, true, true]);
    assert.ok(Array.from(C).every(Number.isNaN));
    assert.equal(SasFitLinalg.covariance(Float64Array.of(1, 0, 0, 1, 0, 0), 3, 2).nonFinite, false);
    assert.throws(() => SasFitLinalg.covariance(Float64Array.of(1, 2), 1, 2), /m >= n/);
});

test('svd / covariance: `converged` is false when the sweep cap is reached, true otherwise; the fitter reports it as illConditioned', () => {
    const big = svdFix.cases.find((c) => c.label === '50x12');
    const A = flat(big.A);
    assert.equal(SasFitLinalg.svd(A, big.m, big.n).converged, true);
    assert.equal(SasFitLinalg.svd(A, big.m, big.n, { maxSweeps: 1 }).converged, false);
    assert.equal(SasFitLinalg.svd(A, big.m, big.n, { maxSweeps: 60 }).converged, true);
    assert.equal(SasFitLinalg.svd([3, 4], 2, 1, { maxSweeps: 1 }).converged, true, 'nothing to rotate');
    const capped = SasFitLinalg.covariance(A, big.m, big.n, { maxSweeps: 1 });
    assert.deepEqual([capped.converged, capped.illConditioned, capped.nonFinite], [false, false, false]);
    assert.equal(SasFitLinalg.covariance(A, big.m, big.n).converged, true);
    for (const c of svdFix.cases) assert.equal(SasFitLinalg.covariance(flat(c.A), c.m, c.n).converged, true, c.label);
    for (const bad of [0, 1.5, -1, '3']) {
        assert.throws(() => SasFitLinalg.svd(A, big.m, big.n, { maxSweeps: bad }), /maxSweeps/);
        assert.throws(() => SasFitFitter.fit(decayProblem(), { svdMaxSweeps: bad }), /svdMaxSweeps/);
    }
    const plain = SasFitFitter.fit(decayProblem());
    const cut = SasFitFitter.fit(decayProblem(), { svdMaxSweeps: 1 });
    assert.equal(plain.illConditioned, false);
    assert.equal(cut.illConditioned, true, 'the covariance SVD did not converge');
    assert.deepEqual(cut.values, plain.values, 'the iteration is not affected');
    assert.deepEqual([cut.status, cut.jacobianNonFinite, cut.blockedByNonFinite], ['converged', false, false]);
});

// ----------------------------------------------------------------- Jacobian

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

// ---------------------------------------------------------------- behaviour

test('fit: result shape, frozen, plain data', () => {
    const result = SasFitFitter.fit(decayProblem());
    assert.deepEqual(Object.keys(result).sort(), ['atBound', 'blockedByNonFinite', 'chi2', 'chi2r', 'covariance', 'dof',
        'errors', 'illConditioned', 'iterations', 'jacobianNonFinite', 'names', 'status', 'values'].sort());
    assert.deepEqual([result.blockedByNonFinite, result.jacobianNonFinite, result.illConditioned], [false, false, false]);
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

test('fit: a NaN in the Jacobian evaluation is stepped around (the other steps of that column are tried)', () => {
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
    assert.equal(poisoned, 2, '+h and -h of b at the start; +h/2 is used');
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
        assert.deepEqual([result.blockedByNonFinite, result.jacobianNonFinite, result.illConditioned], [true, true, false]);
        assert.ok(Object.isFrozen(result));
    }
    const nanStart = SasFitFitter.fit(decayProblem({ start: [3, NaN, 0.2] }));
    assert.equal(nanStart.status, 'failed');
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
