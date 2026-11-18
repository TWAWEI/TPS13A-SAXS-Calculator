'use strict';
/**
 * Gate G4 (design spec 11): the sasfit fitter against bumps 1.0.4 `lm`,
 * polished to the true minimum (decision 20), on every case of fit.json --
 * through SasFitFitter directly and through the message interface of
 * SasFitWorkerCore. Also here, because they need the same cases: the
 * Jacobian against bumps' lsqerror.jacobian, the proof that the Jacobian is
 * unchanged where no retry is needed, and determinism.
 *
 * The fitter knows no model; buildProblem (sasfit-fit-helpers.js) turns a
 * case into residuals(p) = (I - I_model)/w. bumps' residual has the opposite
 * sign, (theory - I)/w, so its Jacobian is compared with the sign flipped;
 * chi2 and the covariance do not depend on it.
 *
 * Thresholds: G4 in sasfit-fit-helpers.js -- 0.01 sigma, 2 %, 1e-3. Never loosen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitEvaluate, SasFitFitter } = require('./load.js');
const { num } = require('./sasfit-helpers.js');
const {
    fitFixture, fitMessage, makeCore, loadKernels, usedPoints, buildProblem, refVector, covarianceError, G4, g4Ratios,
    pseudoGaussian,
} = require('./sasfit-fit-helpers.js');

const fitFix = fitFixture();
const COV_TOL = 1e-8;            // |dC_ij| <= tol*sqrt(C_ii*C_jj)
const JAC_TOL = 1e-6;            // per column: |dJ_ij| <= tol*max_i|J_ij|
const FIT_CASES = 19;            // 12 of the M2 plan + 7 appended after the M2 review
const MASKED = Object.freeze({ '10a ': 145, '10b ': 148, '10c ': 148, '10d ': 150, '11 ': 72 });
const flat = (rows) => Float64Array.from(rows.flat());
const sci = (v) => v.toExponential(2);
const byName = (c, values) => Object.fromEntries(c.names.map((name, j) => [name, values[j]]));

test('fit.json holds the G4 cases with the documented conventions', () => {
    assert.equal(fitFix.cases.length, FIT_CASES);
    assert.equal(fitFix.bumps, '1.0.4');
    assert.equal(fitFix.cutoff, 1e-5);
    assert.deepEqual(fitFix.fitOptions, { steps: 200, ftol: 1e-10, xtol: 1e-10 });
    assert.equal(new Set(fitFix.cases.map((c) => c.label)).size, FIT_CASES, 'labels are unique');
    assert.deepEqual(fitFix.cases.slice(0, 12).map((c) => c.weighting).filter((w) => w !== 'sigma'), ['sqrtI', 'absI', 'none']);
    assert.deepEqual(fitFix.cases.filter((c) => Object.keys(c.ref.atBound).length > 0).map((c) => c.ref.atBound),
        [{ rg: 'upper' }, { radius: 'lower' }, { thickness: 'upper' }]);
    assert.ok(fitFix.cases.some((c) => c.names.includes('radius_pd')));
    assert.ok(fitFix.cases.some((c) => c.modelSpec.structure === 'hardsphere'));
    assert.ok(fitFix.cases.some((c) => c.modelSpec.structure === 'hayter_msa' && c.names.includes('charge')));
    assert.ok(fitFix.cases.some((c) => c.modelSpec.lowQPowerLaw));
});

test('fit.json: the masked and range-restricted cases store full data and the number of points that take part', () => {
    const dirty = fitFix.cases.filter((c) => c.label.startsWith('10'));
    assert.deepEqual(dirty.map((c) => c.weighting), ['sigma', 'sqrtI', 'absI', 'none']);
    for (const c of dirty) {
        assert.equal(c.data.q.length, 150, c.label);
        assert.deepEqual(c.data, dirty[0].data, 'the four weightings fit the same data');
        assert.equal(c.data.sigma.filter((s) => s === 0).length, 4);
        assert.equal(c.data.sigma.filter((s) => s < 0).length, 1);
        assert.equal(c.data.I.filter((v) => v === 0).length, 2);
        assert.ok(c.data.I.filter((v) => v <= 0).length >= 10, 'about a dozen points with I <= 0');
    }
    const seen = {};
    for (const c of fitFix.cases.filter((x) => x.nUsed !== undefined)) {
        const prefix = Object.keys(MASKED).find((p) => c.label.startsWith(p));
        assert.ok(prefix, c.label + ' is expected to be masked');
        seen[prefix] = c.nUsed;
        assert.ok(c.nUsed < c.data.q.length || c.weighting === 'none', c.label);
        assert.equal(c.ref.dof, c.nUsed - c.names.length, c.label + ': dof');
        assert.equal(c.ref.residuals.length, c.nUsed, c.label);
        assert.equal(c.ref.jacobian.length, c.nUsed, c.label);
    }
    assert.deepEqual(seen, { ...MASKED });
    const ranged = fitFix.cases.filter((c) => c.range !== undefined);
    assert.deepEqual(ranged.map((c) => c.label), ['11 sphere restricted q range']);
    assert.ok(ranged[0].range.qMin > ranged[0].data.q[0] && ranged[0].range.qMax < ranged[0].data.q[119], 'restricted on both sides');
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
        console.log('jacobian ' + c.label.padEnd(48) + ' worst column-scaled error ' + worst.toExponential(2)
            + ' | residuals ' + rErr.toExponential(2));
        assert.ok(worst <= JAC_TOL, c.label + ': Jacobian error ' + worst);
    }
});

/** The Jacobian rule as it was before the retries existed: one step per column, nothing else. */
function plainForwardJacobian(residuals, p, upper) {
    const r0 = residuals(Float64Array.from(p));
    const n = p.length;
    const J = new Float64Array(r0.length * n);
    for (let j = 0; j < n; j++) {
        const size = Math.abs(p[j]) * 1e-4 || 1e-4;
        const h = p[j] + size > upper[j] ? -size : size;
        const shifted = Float64Array.from(p);
        shifted[j] = p[j] + h;
        const r1 = residuals(shifted);
        for (let i = 0; i < r0.length; i++) J[i * n + j] = (r1[i] - r0[i]) / h;
    }
    return J;
}

test('jacobian: without a non-finite neighbour it is bit-identical to the single-step rule and costs n + 1 evaluations', async () => {
    const kernels = await loadKernels();
    let compared = 0;
    for (const c of fitFix.cases) {
        const problem = buildProblem(c, kernels);
        for (const p of [problem.start, refVector(c, 'ref'), refVector(c, 'bumpsRaw')]) {
            let evaluations = 0;
            const counted = (x) => { evaluations++; return problem.residuals(x); };
            const { J, nonFiniteColumns } = SasFitFitter.jacobian(counted, p, problem.lower, problem.upper);
            assert.equal(evaluations, p.length + 1, c.label + ': no retry');
            assert.deepEqual(nonFiniteColumns, [], c.label);
            const want = plainForwardJacobian(problem.residuals, p, problem.upper);
            assert.equal(Buffer.from(J.buffer).toString('hex'), Buffer.from(want.buffer).toString('hex'), c.label + ': bit-identical');
            compared += J.length;
        }
    }
    console.log('jacobian default path: ' + compared + ' entries bit-identical to the single-step rule');
});

// ------------------------------------------------------------------ G4 (LM)

test('G4: LM from the same start against the polished bumps reference', async () => {
    const kernels = await loadKernels();
    const failures = [];
    for (const c of fitFix.cases) {
        const problem = buildProblem(c, kernels);
        const result = SasFitFitter.fit(problem, { method: 'lm' });
        const got = [byName(c, result.values), byName(c, result.errors), result.chi2r];
        const ref = g4Ratios(c, ...got);
        const raw = g4Ratios(c, ...got, { values: c.bumpsRaw.values, stderr: c.bumpsRaw.stderr, chi2r: c.bumpsRaw.sumsq / c.ref.dof });
        console.log('G4 ' + c.label.padEnd(48) + ' it ' + String(result.iterations).padStart(3) + ' pts ' + usedPoints(c)
            + ' | vs polished: dp/sigma ' + sci(ref.dp) + ' dstderr ' + sci(ref.de) + ' dchi2r ' + sci(ref.dchi)
            + ' | vs raw bumps: dp/sigma ' + sci(raw.dp) + ' dstderr ' + sci(raw.de) + ' dchi2r ' + sci(raw.dchi)
            + ' | bumps nit ' + c.bumpsRaw.nit);
        assert.equal(result.status, 'converged', c.label);
        assert.equal(result.dof, c.ref.dof, c.label);
        assert.equal(result.dof, usedPoints(c) - c.names.length, c.label + ': dof from the points that take part');
        assert.deepEqual([result.illConditioned, result.blockedByNonFinite, result.jacobianNonFinite], [false, false, false], c.label);
        assert.deepEqual({ ...result.atBound }, c.ref.atBound, c.label);
        for (const [name, side] of Object.entries(c.ref.atBound)) {
            const j = c.names.indexOf(name);
            assert.equal(result.values[j], side === 'upper' ? problem.upper[j] : problem.lower[j], c.label + ': exactly on the bound');
            assert.ok(Number.isFinite(result.errors[j]) && result.errors[j] > 0, c.label + ': error of a parameter on a bound');
        }
        if (!(ref.dp < G4.PARAM_SIGMA) || !(ref.de <= G4.STDERR_REL) || !(ref.dchi <= G4.CHI2R_REL)) failures.push(c.label);
        assert.ok(covarianceError(result.covariance, c.ref.covariance) <= G4.STDERR_REL * 2, c.label + ': covariance');
    }
    assert.deepEqual(failures, [], 'G4 thresholds (0.01 sigma, 2 %, 1e-3) exceeded');
});

test('G4 through the message interface: all fit.json cases, with the mask count and dof of the masked ones', async (t) => {
    const h = makeCore();
    for (const c of fitFix.cases) {
        const before = h.ofType('result').length;
        await h.core.handle(fitMessage(c, c.label));
        assert.equal(h.ofType('result').length, before + 1, c.label + ': ' + JSON.stringify(h.ofType('error')));
        const { fitResult } = h.ofType('result')[before];
        const { dp, de, dchi } = g4Ratios(c, fitResult.params, fitResult.errors, fitResult.chi2r);
        t.diagnostic(c.label + ': ' + fitResult.status + ', ' + fitResult.iterations + ' steps, param '
            + dp.toExponential(1) + ' sigma, stderr ' + de.toExponential(1) + ', chi2r ' + dchi.toExponential(1));
        assert.equal(fitResult.status, 'converged', c.label);
        assert.ok(dp < G4.PARAM_SIGMA, c.label + ': parameter off by ' + dp + ' sigma');
        assert.ok(de <= G4.STDERR_REL, c.label + ': stderr off by ' + de);
        assert.ok(dchi <= G4.CHI2R_REL, c.label + ': chi2r off by ' + dchi);
        assert.equal(fitResult.dof, c.ref.dof, c.label);
        const taking = fitResult.residuals.filter((r) => !Number.isNaN(r)).length;
        assert.equal(taking, usedPoints(c), c.label + ': points that took part');
        assert.equal(fitResult.dof, taking - c.names.length, c.label);
        assert.equal(fitResult.curve.length, c.data.q.length, c.label + ': the curve covers the full data');
        assert.deepEqual(fitResult.atBound, c.ref.atBound || {}, c.label);
        for (const [name, side] of Object.entries(fitResult.atBound)) {
            assert.equal(fitResult.params[name], num(c.bounds[name][side === 'lower' ? 0 : 1]), c.label + ': exactly on the bound');
        }
    }
});

// ------------------------------------------------- damping (speed regression)

/** sphere + low-Q power law on seeded synthetic data, fitting radius, lowq_scale, lowq_power and background. */
function lowQProblem(seed, kernels) {
    const q = Float64Array.from({ length: 150 }, (_, i) => Math.pow(10, -2.3 + 1.8 * i / 149));
    const spec = { model: 'sphere', structure: null, lowQPowerLaw: true };
    const truth = { scale: 0.02, background: 0.005, sld: 1, sld_solvent: 6, radius: 50, lowq_scale: 1e-8, lowq_power: 4 };
    const model = (params) => SasFitEvaluate.evaluate(spec, params, q, { cutoff: fitFix.cutoff }, kernels).I;
    const exact = model(truth);
    const noise = pseudoGaussian(seed);
    const sigma = Float64Array.from(exact, (v) => 0.03 * Math.abs(v) + 1e-4);
    const I = Float64Array.from(exact, (v, i) => v + noise() * sigma[i]);
    const residuals = (p) => {
        const curve = model({ ...truth, radius: p[0], lowq_scale: p[1], lowq_power: p[2], background: p[3] });
        return Float64Array.from(curve, (v, i) => (I[i] - v) / sigma[i]);
    };
    return {
        names: ['radius', 'lowq_scale', 'lowq_power', 'background'], start: [56, 1.3e-8, 3.7, 0.004],
        lower: [1, 0, 0, -Infinity], upper: [1000, Infinity, 6, Infinity], residuals,
    };
}

test('damping: a low-Q power law with lowq_power free converges to the minimum in a few dozen steps', async () => {
    // The valley of (lowq_scale, lowq_power) is long and curved. With the first damping rule (x10 on a
    // rejected step, /10 only after a well predicted one) these three fits took 101, 111 and 102 accepted
    // steps; with Nielsen's update they take 26, 35 and 31 (measured 2026-11-18; the M2 reviewer measured
    // 8-24 for bumps lm on fits of this kind). The ceiling leaves more than 50 % headroom over the slowest and is half the old count.
    const MAX_ITERATIONS = 55;
    const kernels = await loadKernels();
    for (const seed of [901, 902, 908]) {
        const problem = lowQProblem(seed, kernels);
        const result = SasFitFitter.fit(problem);
        // the reference chi2: the same fit continued from its result with tolerances far below the defaults
        const polished = SasFitFitter.fit({ ...problem, start: result.values }, { ftol: 1e-15, xtol: 1e-15 });
        console.log('damping seed ' + seed + ': ' + result.iterations + ' steps, chi2 ' + result.chi2 + ' (polished ' + polished.chi2 + ')');
        assert.deepEqual([result.status, result.blockedByNonFinite, result.illConditioned], ['converged', false, false], 'seed ' + seed);
        assert.deepEqual({ ...result.atBound }, {}, 'seed ' + seed);
        assert.ok(result.chi2r > 0.6 && result.chi2r < 1.6, 'seed ' + seed + ': chi2r ' + result.chi2r);
        assert.ok(Math.abs(result.chi2 - polished.chi2) <= 1e-9 * polished.chi2, 'seed ' + seed + ': chi2 ' + result.chi2 + ' vs ' + polished.chi2);
        result.values.forEach((v, j) => assert.ok(Math.abs(v - polished.values[j]) <= 1e-3 * polished.errors[j], 'seed ' + seed + ' ' + problem.names[j]));
        assert.ok(result.iterations <= MAX_ITERATIONS, 'seed ' + seed + ': ' + result.iterations + ' accepted steps (ceiling ' + MAX_ITERATIONS + ')');
    }
});

// -------------------------------------------------------------- determinism

test('determinism: the same input twice gives bit-identical results', async () => {
    const kernels = await loadKernels();
    for (const c of [fitFix.cases[0], fitFix.cases[4], fitFix.cases[7], fitFix.cases[14], fitFix.cases[18]]) {
        const a = SasFitFitter.fit(buildProblem(c, kernels));
        const b = SasFitFitter.fit(buildProblem(c, kernels));
        assert.deepEqual(a, b, c.label);
        const bits = (r) => Buffer.from(Float64Array.from([...r.values, ...r.errors, r.chi2, ...r.covariance.flat()]).buffer).toString('hex');
        assert.equal(bits(a), bits(b), c.label);
    }
});
