/**
 * sasfit-fitter.js -- Levenberg-Marquardt least squares with bounds, and the
 * parameter covariance (design spec 4.9). Original code. The error analysis
 * follows bumps 1.0.4 lsqerror.py at the level of the algorithm (not a line by
 * line port), so the errors agree with what SasView shows.
 *
 *   SasFitFitter.fit(problem, options) -> FitResult (frozen, plain data)
 *     problem  { names: string[], start, lower, upper: number[],
 *                residuals(p: Float64Array) -> array of m numbers }
 *              residuals may return non-finite values (hayter_msa does, design
 *              spec 16): such a point counts as chi2 = infinity.
 *     options  { method: 'lm', maxSteps: 200, ftol: 1e-10, xtol: 1e-10,
 *                onProgress({ iteration, chi2 }), shouldStop() }  -- all optional
 *     result   { names, values, errors, illConditioned, chi2, dof, chi2r,
 *                iterations, status, atBound, covariance }
 *              chi2 = sum(r^2); dof = m - n (<= 0 is an Error); errors =
 *              sqrt(diag(C)), NOT multiplied by sqrt(chi2r); covariance is n
 *              rows of n; atBound[name] is 'lower' | 'upper' for a value that is
 *              exactly equal to its bound. status: 'converged' | 'maxiter' |
 *              'stopped' | 'failed'. 'failed' means there was nothing to work
 *              with: the start point is not finite (values are the start, chi2
 *              is Infinity, errors and covariance NaN), or at some point no row
 *              of the Jacobian was finite (values are the best point so far).
 *   SasFitFitter.jacobian(residuals, p, lower, upper) -> { J, m, n }
 *     Forward difference exactly as bumps (lsqerror.py:99-110): h = 1e-4*|p|,
 *     h = 1e-4 where that is 0, and h = -h where p + h > upper (strictly). The
 *     lower bound is not looked at. J is row-major, m rows of n.
 *   SasFitFitter.covariance(J, m, n) -> { C, illConditioned }
 *     C = V*diag(1/s^2)*V' from the SVD of J, singular values <= 1e-8 replaced
 *     by 1e-8 (lsqerror.py:283-285); illConditioned says that happened (or
 *     that J is not finite, in which case C is NaN). Needs m >= n.
 *   SasFitFitter.svd(A, m, n) -> { s, V }
 *     One-sided Jacobi; s descending, V row-major n x n. Needs m >= n.
 *
 * The LM iteration: Marquardt scaling (columns of J scaled to unit norm), the
 * damped step from the SVD of the scaled Jacobian (no normal equations), an
 * active set for the bounds (a parameter on a bound whose gradient points
 * outward is held, as mpfit.py:1103-1121 does) and projection of the trial
 * point onto the bounds, which is what makes a value on a bound exactly equal
 * to it. A parameter on a bound still gets its covariance row as if it were
 * free, like bumps. The Jacobian of the iteration and of the covariance is the
 * same forward difference; in the iteration, rows that are not finite (a NaN
 * of the model at p + h) are left out of that one step, and if no row is left
 * the fit ends as 'failed'.
 *
 * Termination follows bumps' lm, i.e. MPFit (mpfit.py), tested after every
 * trial step, accepted or not:
 *   ftol (mpfit.py:1317)  |actred| <= ftol and prered <= ftol and ratio <= 2,
 *        actred = 1 - chi2_new/chi2 (mpfit.py:1269-1271, -1 for a far worse or
 *        non-finite point), prered = the reduction the linear model predicts
 *        for the step, relative to chi2 (mpfit.py:1281-1283), ratio = actred/prered
 *   xtol (mpfit.py:1319)  MPFit tests its trust radius against xtol*|D x|; this
 *        fitter has a damping factor instead of a radius, so it tests the scaled
 *        length of the trial step, |D dp| <= xtol*|D p|. A rejected step raises
 *        the damping tenfold, which shortens the next one.
 *   gtol (mpfit.py:1182)  the cosine between r and every free column of J is
 *        <= 1e-10; bumps leaves MPFit's default in force (fitters.py:716)
 *   steps (mpfit.py:1327) accepted steps >= maxSteps -> 'maxiter'
 * A step is accepted when chi2 falls and ratio >= 1e-4 (mpfit.py:1307).
 *
 * shouldStop is asked once before every iteration. Inside a Web Worker the
 * loop is synchronous and no message can arrive, so there the real "stop" is
 * worker.terminate(); shouldStop serves callers that can answer synchronously.
 *
 * Pure and deterministic: no model knowledge, no module state, no clock, no
 * random numbers; the problem and its arrays are only read.
 */

(function () {
    'use strict';

    const JAC_STEP = 1e-4;            // lsqerror.py:99
    const GTOL = 1e-10;               // mpfit.py:604
    const ACCEPT_RATIO = 1e-4;        // mpfit.py:1307
    const DEFAULTS = Object.freeze({ method: 'lm', maxSteps: 200, ftol: 1e-10, xtol: 1e-10 });
    const LAMBDA_START = 1e-3;
    const LAMBDA_FACTOR = 10;
    const LAMBDA_MIN = 1e-12;
    const LAMBDA_MAX = 1e30;
    const GOOD_RATIO = 0.75;          // lower the damping after a step this well predicted
    const NOOP = () => {};
    const NEVER = () => false;

    const { svd, covariance, decompose, allFinite } = globalThis.SasFitLinalg;

    // ------------------------------------------------------------- Jacobian

    /** residuals(p) on a private copy of p, as a new Float64Array of the expected length. */
    function callResiduals(residuals, p, m) {
        const r = residuals(Float64Array.from(p));
        if (r === null || typeof r !== 'object' || typeof r.length !== 'number') {
            throw new Error('residuals(p) must return an array of numbers');
        }
        if (m !== null && r.length !== m) {
            throw new Error('residuals(p) returned ' + r.length + ' values, expected ' + m);
        }
        return Float64Array.from(r);
    }

    /** The bumps step for one parameter (lsqerror.py:99-105). */
    function stepOf(pj, upperJ) {
        const h = Math.abs(pj) * JAC_STEP || JAC_STEP;
        return pj + h > upperJ ? -h : h;
    }

    /** Forward-difference Jacobian at p, given r0 = residuals(p). */
    function forwardJacobian(residuals, p, r0, upper) {
        const m = r0.length;
        const n = p.length;
        const J = new Float64Array(m * n);
        for (let j = 0; j < n; j++) {
            const h = stepOf(p[j], upper[j]);
            const shifted = Float64Array.from(p);
            shifted[j] = p[j] + h;
            const r1 = callResiduals(residuals, shifted, m);
            for (let i = 0; i < m; i++) J[i * n + j] = (r1[i] - r0[i]) / h;
        }
        return J;
    }

    function readVector(v, n, what) {
        if (!Array.isArray(v) && !(v instanceof Float64Array)) throw new Error(what + ' must be an array of numbers');
        if (n !== null && v.length !== n) throw new Error(what + ' has ' + v.length + ' entries, expected ' + n);
        for (let j = 0; j < v.length; j++) {
            if (typeof v[j] !== 'number') throw new Error(what + '[' + j + '] is not a number: ' + String(v[j]));
        }
        return Float64Array.from(v);
    }

    function jacobian(residuals, p, lower, upper) {
        if (typeof residuals !== 'function') throw new Error('jacobian needs a residuals function');
        const point = readVector(p, null, 'p');
        readVector(lower, point.length, 'lower');
        const hi = readVector(upper, point.length, 'upper');
        const r0 = callResiduals(residuals, point, null);
        return { J: forwardJacobian(residuals, point, r0, hi), m: r0.length, n: point.length };
    }

    // ------------------------------------------------------------- LM parts

    function sumsq(r) {
        let sum = 0;
        for (let i = 0; i < r.length; i++) sum += r[i] * r[i];
        return sum;
    }

    /** J with every row that holds a non-finite entry set to zero (a copy), and how many rows were kept. */
    function finiteRows(J, m, n) {
        if (allFinite(J)) return { J, kept: m };
        const out = Float64Array.from(J);
        let kept = m;
        for (let i = 0; i < m; i++) {
            let ok = true;
            for (let j = 0; j < n; j++) ok = ok && Number.isFinite(J[i * n + j]);
            if (!ok) {
                out.fill(0, i * n, (i + 1) * n);
                kept--;
            }
        }
        return { J: out, kept };
    }

    /** Per column of J: its norm (1 for a zero column) and its product with r. */
    function columnStats(J, r, n) {
        const norms = new Float64Array(n);
        const g = new Float64Array(n);
        for (let i = 0; i < r.length; i++) {
            for (let j = 0; j < n; j++) {
                norms[j] += J[i * n + j] * J[i * n + j];
                g[j] += J[i * n + j] * r[i];
            }
        }
        return { norms: norms.map((v) => (v > 0 ? Math.sqrt(v) : 1)), g };
    }

    /** Parameters not held on a bound: on a bound, the descent direction -g must point inside. */
    function freeIndices(p, g, lower, upper) {
        const free = [];
        for (let j = 0; j < p.length; j++) {
            const held = (p[j] <= lower[j] && g[j] > 0) || (p[j] >= upper[j] && g[j] < 0);
            if (!held) free.push(j);
        }
        return free;
    }

    /**
     * The linear model at the current point: J (finite rows, and how many), the free
     * set, the SVD of the scaled free columns, W'r, and the gradient cosine (gtol test).
     */
    function linearise(prob, state) {
        const { n } = prob;
        const m = state.r.length;
        const { J, kept } = finiteRows(forwardJacobian(prob.residuals, state.p, state.r, prob.upper), m, n);
        const { norms, g } = columnStats(J, state.r, n);
        const free = freeIndices(state.p, g, prob.lower, prob.upper);
        const k = free.length;
        const scaled = new Float64Array(m * k);
        for (let i = 0; i < m; i++) {
            for (let c = 0; c < k; c++) scaled[i * k + c] = J[i * n + free[c]] / norms[free[c]];
        }
        const { W, s, V } = decompose(scaled, m, k);
        const wr = new Float64Array(k);
        for (let i = 0; i < m; i++) {
            for (let c = 0; c < k; c++) wr[c] += W[i * k + c] * state.r[i];
        }
        const rnorm = Math.sqrt(state.chi2);
        const gnorm = rnorm === 0 ? 0 : free.reduce((max, j) => Math.max(max, Math.abs(g[j]) / (norms[j] * rnorm)), 0);
        return { J, kept, norms, free, s, V, wr, gnorm };
    }

    /** Damped step for all n parameters (0 for held ones): -(J'J + lambda*D)^-1 J'r. */
    function dampedStep(sys, lambda, n) {
        const { free, s, V, wr, norms } = sys;
        const k = free.length;
        const delta = new Float64Array(n);
        for (let c = 0; c < k; c++) {
            let y = 0;
            for (let e = 0; e < k; e++) {
                const denom = s[e] * s[e] + lambda;
                if (denom > 0) y -= V[c * k + e] * wr[e] / denom;
            }
            delta[free[c]] = y / norms[free[c]];
        }
        return delta;
    }

    function scaledNorm(v, norms) {
        let sum = 0;
        for (let j = 0; j < v.length; j++) sum += (v[j] * norms[j]) * (v[j] * norms[j]);
        return Math.sqrt(sum);
    }

    /** 1 - |r + J*step|^2 / chi2: the relative reduction the linear model predicts. */
    function predictedReduction(J, r, step, chi2) {
        const n = step.length;
        let sum = 0;
        for (let i = 0; i < r.length; i++) {
            let lin = r[i];
            for (let j = 0; j < n; j++) lin += J[i * n + j] * step[j];
            sum += lin * lin;
        }
        return 1 - sum / chi2;
    }

    /** One trial step at the given damping; evaluates the residuals unless the projected step is null. */
    function trialStep(prob, state, sys, lambda) {
        const delta = dampedStep(sys, lambda, prob.n);
        const p = Float64Array.from(state.p, (v, j) => Math.min(Math.max(v + delta[j], prob.lower[j]), prob.upper[j]));
        const step = Float64Array.from(p, (v, j) => v - state.p[j]);
        const rejected = { accepted: false, actred: -1, prered: 0, ratio: 0 };
        if (step.every((v) => v === 0)) {
            return { ...rejected, pnorm: scaledNorm(delta, sys.norms), xnorm: scaledNorm(state.p, sys.norms) };
        }
        const r = callResiduals(prob.residuals, p, state.r.length);
        const chi2 = sumsq(r);
        // mpfit.py:1269-1271: a point more than 10 times worse in norm counts as actred = -1.
        const comparable = Number.isFinite(chi2) && 0.1 * Math.sqrt(chi2) < Math.sqrt(state.chi2);
        const actred = comparable ? 1 - chi2 / state.chi2 : -1;
        const prered = predictedReduction(sys.J, state.r, step, state.chi2);
        const ratio = prered !== 0 ? actred / prered : 0;
        const accepted = comparable && chi2 < state.chi2 && ratio >= ACCEPT_RATIO;
        const pnorm = scaledNorm(step, sys.norms);
        const xnorm = scaledNorm(accepted ? p : state.p, sys.norms);
        return { accepted, actred, prered, ratio, pnorm, xnorm, p, r, chi2 };
    }

    function nextLambda(lambda, trial) {
        if (!trial.accepted) return lambda * LAMBDA_FACTOR;
        return trial.ratio >= GOOD_RATIO ? Math.max(lambda / LAMBDA_FACTOR, LAMBDA_MIN) : lambda;
    }

    /** The termination tests after a trial step (see the file header); null = go on. */
    function statusAfter(cfg, trial, iterations, lambda) {
        const ftolHit = Math.abs(trial.actred) <= cfg.ftol && trial.prered <= cfg.ftol && 0.5 * trial.ratio <= 1;
        const xtolHit = trial.pnorm <= cfg.xtol * trial.xnorm;
        if (ftolHit || xtolHit) return 'converged';
        if (iterations >= cfg.maxSteps) return 'maxiter';
        return lambda > LAMBDA_MAX ? 'converged' : null;
    }

    /** One iteration: linearise, then trial steps with rising damping until one is accepted or a test ends the fit. */
    function iterateOnce(prob, cfg, state) {
        const sys = linearise(prob, state);
        if (sys.kept === 0) return { ...state, status: 'failed' };      // nothing to differentiate
        if (sys.free.length === 0 || sys.gnorm <= GTOL) return { ...state, status: 'converged' };
        let lambda = state.lambda;
        for (;;) {
            const trial = trialStep(prob, state, sys, lambda);
            lambda = nextLambda(lambda, trial);
            const iterations = state.iterations + (trial.accepted ? 1 : 0);
            if (trial.accepted) cfg.onProgress(Object.freeze({ iteration: iterations, chi2: trial.chi2 }));
            const status = statusAfter(cfg, trial, iterations, lambda);
            if (trial.accepted) return { p: trial.p, r: trial.r, chi2: trial.chi2, lambda, iterations, status };
            if (status !== null) return { ...state, lambda, status };
        }
    }

    function iterate(prob, cfg, first) {
        let state = first;
        while (state.status === null) {
            state = cfg.shouldStop() ? { ...state, status: 'stopped' } : iterateOnce(prob, cfg, state);
        }
        return state;
    }

    // ---------------------------------------------------------- fit: in/out

    function readOptions(options) {
        const o = options === undefined || options === null ? {} : options;
        if (typeof o !== 'object') throw new Error('options must be an object');
        const cfg = {
            method: o.method === undefined ? DEFAULTS.method : o.method,
            maxSteps: o.maxSteps === undefined ? DEFAULTS.maxSteps : o.maxSteps,
            ftol: o.ftol === undefined ? DEFAULTS.ftol : o.ftol,
            xtol: o.xtol === undefined ? DEFAULTS.xtol : o.xtol,
            onProgress: o.onProgress === undefined ? NOOP : o.onProgress,
            shouldStop: o.shouldStop === undefined ? NEVER : o.shouldStop,
        };
        if (cfg.method !== 'lm') throw new Error("Unknown fit method " + String(cfg.method) + " (only 'lm')");
        if (!Number.isInteger(cfg.maxSteps) || cfg.maxSteps < 1) {
            throw new Error('maxSteps must be a positive integer, got ' + String(cfg.maxSteps));
        }
        ['ftol', 'xtol'].forEach((key) => {
            if (typeof cfg[key] !== 'number' || !(cfg[key] > 0) || !Number.isFinite(cfg[key])) {
                throw new Error(key + ' must be a positive number, got ' + String(cfg[key]));
            }
        });
        if (typeof cfg.onProgress !== 'function' || typeof cfg.shouldStop !== 'function') {
            throw new Error('onProgress and shouldStop must be functions');
        }
        return cfg;
    }

    /** Checked private copy of the problem; the start is clipped into the bounds. */
    function readProblem(problem) {
        if (problem === null || typeof problem !== 'object') throw new Error('problem must be an object');
        const { names, residuals } = problem;
        if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== 'string')) {
            throw new Error('problem.names must be a non-empty array of parameter names');
        }
        if (new Set(names).size !== names.length) throw new Error('problem.names has duplicates: ' + names.join(', '));
        if (typeof residuals !== 'function') throw new Error('problem.residuals must be a function');
        const n = names.length;
        const start = readVector(problem.start, n, 'problem.start');
        const lower = readVector(problem.lower, n, 'problem.lower');
        const upper = readVector(problem.upper, n, 'problem.upper');
        for (let j = 0; j < n; j++) {
            if (!(lower[j] <= upper[j])) {
                throw new Error('Bounds of ' + names[j] + ' are not ordered: [' + lower[j] + ', ' + upper[j] + ']');
            }
        }
        const p = start.map((v, j) => Math.min(Math.max(v, lower[j]), upper[j]));
        return { names: Object.freeze(names.slice()), n, lower, upper, p, residuals };
    }

    function boundsReached(prob, p) {
        const atBound = {};
        prob.names.forEach((name, j) => {
            if (p[j] === prob.lower[j]) atBound[name] = 'lower';
            else if (p[j] === prob.upper[j]) atBound[name] = 'upper';
        });
        return Object.freeze(atBound);
    }

    /** Covariance at p from the bumps Jacobian; all NaN when there is no finite point to use. */
    function errorsAt(prob, state) {
        const { n } = prob;
        if (!Number.isFinite(state.chi2)) return { C: new Float64Array(n * n).fill(NaN), illConditioned: false };
        const J = forwardJacobian(prob.residuals, state.p, state.r, prob.upper);
        return covariance(J, state.r.length, n);
    }

    function buildResult(prob, state, dof) {
        const { n } = prob;
        const { C, illConditioned } = errorsAt(prob, state);
        const rows = Array.from({ length: n }, (_, i) => Object.freeze(Array.from(C.subarray(i * n, (i + 1) * n))));
        return Object.freeze({
            names: prob.names,
            values: Object.freeze(Array.from(state.p)),
            errors: Object.freeze(rows.map((row, i) => Math.sqrt(row[i]))),
            illConditioned,
            chi2: state.chi2,
            dof,
            chi2r: state.chi2 / dof,
            iterations: state.iterations,
            status: state.status,
            atBound: boundsReached(prob, state.p),
            covariance: Object.freeze(rows),
        });
    }

    function fit(problem, options) {
        const cfg = readOptions(options);
        const prob = readProblem(problem);
        const r = callResiduals(prob.residuals, prob.p, null);
        const dof = r.length - prob.n;
        if (dof <= 0) {
            throw new Error('Not enough points: ' + r.length + ' residuals for ' + prob.n + ' fitted parameters');
        }
        const sum = sumsq(r);
        const finite = Number.isFinite(sum);
        const first = {
            p: prob.p, r, chi2: finite ? sum : Infinity, lambda: LAMBDA_START, iterations: 0,
            status: finite ? null : 'failed',
        };
        return buildResult(prob, iterate(prob, cfg, first), dof);
    }

    globalThis.SasFitFitter = Object.freeze({ fit, jacobian, covariance, svd, DEFAULTS });
})();
