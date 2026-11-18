'use strict';
/**
 * sasfit-fitter.js where the model cannot be computed (design spec 16:
 * hayter_msa returns whole-curve NaN in parts of parameter space). Two rules,
 * both from the M2 review:
 *   F1  a fit that stops against a non-finite region is 'failed' with
 *       blockedByNonFinite, never 'converged';
 *   F2  a non-finite neighbour of the Jacobian is stepped around (-h, +h/2,
 *       -h/2), and only a column with no usable step is held for the iteration
 *       or, in the final Jacobian, reported by jacobianNonFinite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitFitter } = require('./load.js');
const { decayProblem, expDecay, recordCalls } = require('./sasfit-fit-helpers.js');

const CHI2_REL = 1e-9;
const JAC_STEP = 1e-4;
const sameChi2 = (got, want, label) => assert.ok(Math.abs(got - want) <= CHI2_REL * want, label + ': chi2 ' + got + ' vs ' + want);
const nanRow = (r, i) => { const out = Array.from(r); out[i] = NaN; return out; };

// ------------------------------------------------------------- F1: walls

test('F1: a whole-curve NaN wall before the minimum -> failed + blockedByNonFinite at the best point, never converged', () => {
    const plain = SasFitFitter.fit(expDecay.problem(expDecay.exact));
    assert.equal(plain.status, 'converged');
    assert.ok(Math.abs(plain.values[1] - 0.70) < 0.01, 'the unwrapped minimum is at k = 0.70');
    const walled = (p) => (p[1] < 0.75 ? expDecay.exact(p).map(() => NaN) : expDecay.exact(p));
    for (const start of [[8, 1.2], [12, 2.0], [9, 0.8], [10, 0.7501]]) {
        const result = SasFitFitter.fit(expDecay.problem(walled, start));
        const label = 'start ' + start;
        assert.equal(result.status, 'failed', label);
        assert.equal(result.blockedByNonFinite, true, label);
        assert.ok(result.values[1] >= 0.75 && result.values[1] < 0.76, label + ': stopped at the wall, k = ' + result.values[1]);
        assert.ok(Number.isFinite(result.chi2) && result.chi2 > 10 * plain.chi2, label + ': chi2 ' + result.chi2 + ' is reported');
        assert.equal(result.chi2r, result.chi2 / result.dof);
        sameChi2(expDecay.exact(result.values).reduce((s, v) => s + v * v, 0), result.chi2, label);
        assert.equal(result.jacobianNonFinite, false, label + ': the finite side is enough for the errors');
        assert.equal(result.illConditioned, false, label);
        assert.ok(result.errors.every((e) => Number.isFinite(e) && e > 0), label + ': errors ' + result.errors);
    }
});

test('F1: a wall made of a single NaN row is the same wall', () => {
    const walled = (p) => (p[1] < 0.9 ? nanRow(expDecay.exact(p), 4) : expDecay.exact(p));
    for (const start of [[8, 1.2], [12, 2.0]]) {
        const result = SasFitFitter.fit(expDecay.problem(walled, start));
        assert.equal(result.status, 'failed', 'start ' + start);
        assert.equal(result.blockedByNonFinite, true);
        assert.ok(result.values[1] >= 0.9 && result.values[1] < 0.91, 'k = ' + result.values[1]);
        assert.ok(Number.isFinite(result.chi2));
    }
});

test('F1: a non-finite start is failed + blockedByNonFinite, and its Jacobian cannot be computed', () => {
    const result = SasFitFitter.fit(expDecay.problem((p) => (p[1] < 0.9 ? nanRow(expDecay.exact(p), 4) : expDecay.exact(p)), [9, 0.8]));
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite, result.illConditioned],
        ['failed', true, true, false]);
    assert.equal(result.chi2, Infinity);
    assert.deepEqual(result.values, [9, 0.8]);
});

test('F1: an overshoot into NaN that the fit recovers from is not a wall', () => {
    const plain = SasFitFitter.fit(decayProblem());
    const base = decayProblem();
    let poisoned = 0;
    const result = SasFitFitter.fit({ ...base, residuals: (p) => { if (p[1] > 1.32) { poisoned++; return nanRow(base.residuals(p), 7); } return base.residuals(p); } });
    assert.ok(poisoned > 0);
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite], ['converged', false, false]);
    sameChi2(result.chi2, plain.chi2, 'overshoot');
});

test('F1/F2: only finite trials -> both flags false, on every terminal status', () => {
    for (const options of [undefined, { maxSteps: 2 }, { shouldStop: () => true }]) {
        const result = SasFitFitter.fit(decayProblem(), options);
        assert.equal(result.blockedByNonFinite, false, result.status);
        assert.equal(result.jacobianNonFinite, false, result.status);
    }
    assert.equal(SasFitFitter.fit(decayProblem({ upper: [Infinity, 1.1, Infinity] })).blockedByNonFinite, false);
});

/** The minimum of decayProblem to rounding: the default fit, polished with tolerances far below the defaults. */
function polishedDecay() {
    const base = decayProblem();
    const first = SasFitFitter.fit(base);
    return SasFitFitter.fit({ ...base, start: first.values }, { ftol: 1e-15, xtol: 1e-15 });
}

test('F1: a NaN right next to a real minimum hides no gain (predicted reduction <= ftol) -> converged, not blocked', () => {
    const base = decayProblem();
    const at = polishedDecay().values;
    let poisoned = 0;
    // A NaN shell around the minimum: every point closer than 1e-5 (relative) except the minimum itself.
    // The Jacobian steps (1e-4) reach over it; every trial step of the iteration lands in it.
    const residuals = (p) => {
        const off = Math.max(...at.map((v, j) => Math.abs(p[j] - v) / Math.abs(v)));
        if (off > 0 && off < 1e-5) { poisoned++; return base.residuals(p).map(() => NaN); }
        return base.residuals(p);
    };
    const result = SasFitFitter.fit({ ...base, start: at, residuals });
    assert.ok(poisoned > 0, 'trial steps landed in the shell');
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite, result.iterations], ['converged', false, false, 0]);
    assert.deepEqual(result.values, at);
});

test('F1: a non-finite step followed by shorter finite steps that are refused on their merits is not a wall', () => {
    const base = decayProblem();
    const at = polishedDecay().values;
    const hb = JAC_STEP * Math.abs(at[1]);
    let calls = 0;
    let poisoned = 0;
    // A jump of the model (finite, wrong) in the Jacobian column of b -- the column comes out as
    // 0.05*r -- sends the iteration in a useless direction with a large predicted gain: every finite
    // trial is worse. One trial in the middle of that run cannot be computed.
    const r0 = base.residuals(at);
    const trials = [];
    const residuals = (p) => {
        calls++;
        if (p[0] === at[0] && p[2] === at[2] && p[1] === at[1] + hb) return r0.map((v) => v * (1 + 0.05 * hb));
        if (calls > 4 && trials.length < 12) trials.push(calls === 6 ? 'NaN' : 'finite');
        if (calls === 6) { poisoned++; return r0.map(() => NaN); }      // start, 3 columns, trial 1, trial 2
        return base.residuals(p);
    };
    const result = SasFitFitter.fit({ ...base, start: at, residuals });
    assert.equal(poisoned, 1);
    assert.deepEqual(trials.slice(0, 4), ['finite', 'NaN', 'finite', 'finite'], 'finite trials before and after the non-finite one');
    assert.ok(calls > 12, calls + ' evaluations');
    assert.deepEqual([result.status, result.blockedByNonFinite, result.iterations], ['converged', false, 0]);
    assert.deepEqual(result.values, at);
});

// ----------------------------------------------------------- F2: stripes

test('F2: a NaN stripe across the path of the optimiser is stepped over; same chi2 as the unwrapped problem', () => {
    const spy = recordCalls(expDecay.exact);
    const plain = SasFitFitter.fit(expDecay.problem(spy.residuals));
    const firstTrial = spy.calls[3][1];                    // start, two Jacobian columns, then the first trial step
    assert.ok(firstTrial !== 1.2 && Math.abs(firstTrial - 1.2) > 0.05, 'first trial k = ' + firstTrial);
    let poisoned = 0;
    const striped = (p) => {
        if (Math.abs(p[1] - firstTrial) < 0.01) { poisoned++; return expDecay.exact(p).map(() => NaN); }
        return expDecay.exact(p);
    };
    const result = SasFitFitter.fit(expDecay.problem(striped));
    assert.ok(poisoned > 0, 'the stripe was hit');
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite], ['converged', false, false]);
    sameChi2(result.chi2, plain.chi2, 'stripe on the path');
});

test('F2: a NaN stripe right next to the minimum (where +h lands) -> the Jacobian steps the other way; same chi2, finite errors', () => {
    const plain = SasFitFitter.fit(expDecay.problem(expDecay.exact));
    const h = JAC_STEP * plain.values[1];
    let poisoned = 0;
    const striped = (p) => {
        if (p[1] > plain.values[1] + 0.5 * h && p[1] < plain.values[1] + 1.5 * h) { poisoned++; return expDecay.exact(p).map(() => NaN); }
        return expDecay.exact(p);
    };
    const result = SasFitFitter.fit(expDecay.problem(striped));
    assert.ok(poisoned > 0, 'the stripe was hit');
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite, result.illConditioned],
        ['converged', false, false, false]);
    sameChi2(result.chi2, plain.chi2, 'stripe next to the minimum');
    result.errors.forEach((e, j) => assert.ok(Math.abs(e - plain.errors[j]) <= 1e-2 * plain.errors[j], 'error ' + j + ': ' + e + ' vs ' + plain.errors[j]));
});

test('F2: a start whose +h neighbour is NaN no longer fails; the fit converges to the same chi2', () => {
    const plain = SasFitFitter.fit(expDecay.problem(expDecay.exact));
    const h = JAC_STEP * 1.2;
    const spy = recordCalls((p) => (p[1] > 1.2 + 0.5 * h && p[1] < 1.2 + 1.5 * h ? expDecay.exact(p).map(() => NaN) : expDecay.exact(p)));
    const result = SasFitFitter.fit(expDecay.problem(spy.residuals));
    assert.deepEqual(spy.calls.slice(0, 4), [[8, 1.2], [8 + 8e-4, 1.2], [8, 1.2 + h], [8, 1.2 - h]], 'the -h retry comes right after the failed +h');
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite], ['converged', false, false]);
    sameChi2(result.chi2, plain.chi2, '+h neighbour NaN');
});

test('F2: jacobian() retries -h, +h/2, -h/2 in that order, inside the bounds only, and reports the columns it could not compute', () => {
    const f = (p) => [p[0] * p[0], 3 * p[0]];
    // every neighbour is NaN: all four steps are tried, the column is NaN
    const all = recordCalls((p) => (p[0] === 2 ? f(p) : [NaN, 1]));
    const none = SasFitFitter.jacobian(all.residuals, [2], [-Infinity], [Infinity]);
    assert.deepEqual(all.calls, [[2], [2 + 2e-4], [2 - 2e-4], [2 + 1e-4], [2 - 1e-4]]);
    assert.deepEqual(none.nonFiniteColumns, [0]);
    assert.ok(Array.from(none.J).every(Number.isNaN));
    // only above p: the first retry (-h) is used, with its own sign
    const above = recordCalls((p) => (p[0] > 2 ? [NaN, NaN] : f(p)));
    const back = SasFitFitter.jacobian(above.residuals, [2], [-Infinity], [Infinity]);
    assert.deepEqual(above.calls, [[2], [2 + 2e-4], [2 - 2e-4]]);
    assert.deepEqual(back.nonFiniteColumns, []);
    assert.equal(back.J[0], ((2 - 2e-4) * (2 - 2e-4) - 4) / -2e-4);
    // on a lower bound: -h and -h/2 would leave the bounds and are skipped
    const low = recordCalls((p) => (p[0] > 2 + 1.5e-4 ? [NaN, NaN] : f(p)));
    const half = SasFitFitter.jacobian(low.residuals, [2], [2], [Infinity]);
    assert.deepEqual(low.calls, [[2], [2 + 2e-4], [2 + 1e-4]]);
    assert.equal(half.J[1], (3 * (2 + 1e-4) - 6) / 1e-4);
    // bumps goes backward when p + h > upper; the retry +h is outside, -h/2 (here: forward) is inside
    const high = recordCalls((p) => (p[0] < 10 ? [NaN, NaN] : f(p)));
    const up = SasFitFitter.jacobian(high.residuals, [10], [0], [10.0005]);
    assert.deepEqual(high.calls, [[10], [10 - 1e-3], [10 - 5e-4], [10 + 5e-4]]);
    assert.deepEqual(up.nonFiniteColumns, []);
    // a mixed matrix: column 1 is fine and untouched by the trouble of column 0
    const mixed = SasFitFitter.jacobian((p) => (p[0] !== 2 ? [NaN, NaN] : [p[0] + p[1], p[1] * p[1]]), [2, 5], [0, 0], [9, 9]);
    assert.deepEqual(mixed.nonFiniteColumns, [0]);
    assert.ok(Number.isNaN(mixed.J[0]) && Number.isNaN(mixed.J[2]));
    assert.equal(mixed.J[1], ((2 + 5 + 5e-4) - 7) / 5e-4);
});

test('F2: a parameter that cannot be differentiated at one point is held for that iteration only', () => {
    const base = decayProblem();
    const plain = SasFitFitter.fit(base);
    let poisoned = 0;
    // At the start point, no neighbour in c can be computed; trial steps (which move a and b) can.
    const residuals = (p) => {
        if (p[0] === 3 && p[1] === 0.7 && p[2] !== 0.2) { poisoned++; return base.residuals(p).map(() => NaN); }
        return base.residuals(p);
    };
    const spy = recordCalls(residuals);
    const result = SasFitFitter.fit({ ...base, residuals: spy.residuals });
    assert.equal(poisoned, 4, 'the four steps of c at the start');
    assert.equal(spy.calls[7][2], 0.2, 'the first trial step leaves c alone');
    assert.ok(spy.calls[7][0] !== 3 && spy.calls[7][1] !== 0.7);
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite], ['converged', false, false]);
    sameChi2(result.chi2, plain.chi2, 'held for one iteration');
});

test('F2: a parameter that can never be differentiated -> the fit of the others is failed + blockedByNonFinite, not converged', () => {
    const base = decayProblem();
    // c can only be 0.2: the fit in a and b converges, but nothing is known about c.
    const result = SasFitFitter.fit({ ...base, residuals: (p) => (p[2] !== 0.2 ? base.residuals(p).map(() => NaN) : base.residuals(p)) });
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite, result.illConditioned],
        ['failed', true, true, false]);
    assert.equal(result.values[2], 0.2);
    assert.ok(result.iterations > 0 && Number.isFinite(result.chi2));
    assert.ok(Number.isNaN(result.errors[2]));
    assert.ok(Number.isFinite(result.errors[0]) && Number.isFinite(result.errors[1]), 'errors of the computable parameters');
});

test('F2: no neighbour of the start can be computed -> failed + blockedByNonFinite at the start, errors NaN, not illConditioned', () => {
    const base = decayProblem();
    const residuals = (p) => (p[0] === 3 && p[1] === 0.7 && p[2] === 0.2 ? base.residuals(p) : base.residuals(p).map(() => NaN));
    const result = SasFitFitter.fit({ ...base, residuals });
    assert.deepEqual([result.status, result.blockedByNonFinite, result.jacobianNonFinite, result.illConditioned],
        ['failed', true, true, false]);
    assert.equal(result.iterations, 0);
    assert.deepEqual(result.values, [3, 0.7, 0.2]);
    assert.ok(Number.isFinite(result.chi2) && result.chi2 > 0);
    assert.ok(result.errors.every(Number.isNaN) && result.covariance.flat().every(Number.isNaN));
});

test('F2: the final Jacobian uses the retries; a column that still fails gives jacobianNonFinite and NaN for that parameter only', () => {
    const base = decayProblem();
    const plain = SasFitFitter.fit(base);
    const [a, b, c] = plain.values;
    const hb = JAC_STEP * Math.abs(b);
    // (1) only +h of b at the solution is poisoned: -h is used, nothing is flagged
    const one = SasFitFitter.fit({ ...base, residuals: (p) => (p[0] === a && p[2] === c && p[1] === b + hb ? nanRow(base.residuals(p), 0) : base.residuals(p)) });
    assert.deepEqual(one.values, plain.values);
    assert.deepEqual([one.status, one.jacobianNonFinite, one.illConditioned, one.blockedByNonFinite], ['converged', false, false, false]);
    one.errors.forEach((e, j) => assert.ok(Math.abs(e - plain.errors[j]) <= 1e-2 * plain.errors[j], 'error ' + j));
    assert.notDeepEqual(one.errors, plain.errors, 'a backward difference was used for b');
    // (2) no neighbour in b at the solution: b gets NaN, a and c keep (conditional) errors. The step
    // budget ends the fit on the step that reaches the solution, so the iteration never differentiates there
    // (if it did, b would be held and the fit would end as failed + blockedByNonFinite -- the test above).
    const capped = { maxSteps: plain.iterations };
    assert.deepEqual(SasFitFitter.fit(base, capped).values, plain.values);
    const none = SasFitFitter.fit({ ...base, residuals: (p) => (p[0] === a && p[2] === c && p[1] !== b ? nanRow(base.residuals(p), 0) : base.residuals(p)) }, capped);
    assert.deepEqual(none.values, plain.values);
    assert.deepEqual([none.status, none.jacobianNonFinite, none.illConditioned, none.blockedByNonFinite], ['maxiter', true, false, false]);
    assert.ok(Number.isNaN(none.errors[1]));
    for (const j of [0, 2]) {
        assert.ok(none.errors[j] > 0 && none.errors[j] <= plain.errors[j], 'error ' + j + ' with b held: ' + none.errors[j]);
        assert.equal(none.errors[j], Math.sqrt(none.covariance[j][j]));
        assert.ok(Number.isNaN(none.covariance[j][1]) && Number.isNaN(none.covariance[1][j]));
    }
    assert.ok(Number.isFinite(none.covariance[0][2]) && none.covariance[0][2] === none.covariance[2][0]);
    assert.ok(Object.isFrozen(none.covariance) && Object.isFrozen(none.covariance[1]));
});

// ----------------------------------------------------------- determinism

test('determinism: walls, stripes and held columns give bit-identical results twice', () => {
    const base = decayProblem();
    const problems = [
        () => expDecay.problem((p) => (p[1] < 0.75 ? expDecay.exact(p).map(() => NaN) : expDecay.exact(p))),
        () => expDecay.problem((p) => (p[1] < 0.9 ? nanRow(expDecay.exact(p), 4) : expDecay.exact(p)), [12, 2]),
        () => expDecay.problem((p) => (Math.abs(p[1] - 0.9) < 0.01 ? expDecay.exact(p).map(() => NaN) : expDecay.exact(p))),
        () => ({ ...base, residuals: (p) => (p[2] !== 0.2 ? base.residuals(p).map(() => NaN) : base.residuals(p)) }),
    ];
    for (const make of problems) {
        const first = SasFitFitter.fit(make());
        const second = SasFitFitter.fit(make());
        assert.deepEqual(first, second);
        const bits = (r) => Buffer.from(Float64Array.from([...r.values, ...r.errors, r.chi2, ...r.covariance.flat()]).buffer).toString('hex');
        assert.equal(bits(first), bits(second));
    }
});
