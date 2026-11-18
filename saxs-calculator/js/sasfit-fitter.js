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
 *                onProgress({ iteration, chi2 }), shouldStop(), svdMaxSweeps }
 *              all optional; svdMaxSweeps caps the Jacobi sweeps of the final
 *              covariance (SasFitLinalg, default 60) and exists for tests.
 *     result   { names, values, errors, illConditioned, jacobianNonFinite,
 *                blockedByNonFinite, chi2, dof, chi2r, iterations, status,
 *                atBound, covariance }
 *              chi2 = sum(r^2); dof = m - n (<= 0 is an Error); errors =
 *              sqrt(diag(C)), NOT multiplied by sqrt(chi2r); covariance is n
 *              rows of n; atBound[name] is 'lower' | 'upper' for a value that is
 *              exactly equal to its bound. status: 'converged' | 'maxiter' |
 *              'stopped' | 'failed' (see "Non-finite regions" below).
 *              illConditioned: a singular value of the final Jacobian was
 *              replaced by the 1e-8 floor (or, never seen, its SVD did not
 *              converge within the sweep cap). It never stands for "not finite".
 *              jacobianNonFinite: a column of the final Jacobian could not be
 *              computed with any of the four steps; that parameter's error and
 *              covariance row/column are NaN, the others are those of the fit
 *              with that parameter held (so they are a lower estimate).
 *   SasFitFitter.jacobian(residuals, p, lower, upper) -> { J, m, n, nonFiniteColumns }
 *     Forward difference exactly as bumps (lsqerror.py:99-110): h = 1e-4*|p|,
 *     h = 1e-4 where that is 0, and h = -h where p + h > upper (strictly); the
 *     lower bound is not looked at for this first step. J is row-major, m rows
 *     of n. Only when that column is not finite, the steps -h, +h/2, -h/2 are
 *     tried in this order, skipping any that would leave [lower, upper]; the
 *     first finite column is used. A column that no step can compute is NaN
 *     and listed in nonFiniteColumns. When no retry is needed the result is
 *     bit for bit what bumps' rule gives.
 *   SasFitFitter.covariance(J, m, n) -> { C, illConditioned, converged, nonFinite }
 *     C = V*diag(1/s^2)*V' from the SVD of J, singular values <= 1e-8 replaced
 *     by 1e-8 (lsqerror.py:283-285); illConditioned says that happened. Needs
 *     m >= n. See sasfit-linalg.js.
 *   SasFitFitter.svd(A, m, n) -> { s, V, converged }
 *     One-sided Jacobi; s descending, V row-major n x n. Needs m >= n.
 *
 * The LM iteration: Marquardt scaling (columns of J scaled to unit norm), the
 * damped step from the SVD of the scaled Jacobian (no normal equations), an
 * active set for the bounds (a parameter on a bound whose gradient points
 * outward is held, as mpfit.py:1103-1121 does) and projection of the trial
 * point onto the bounds, which is what makes a value on a bound exactly equal
 * to it. A parameter on a bound still gets its covariance row as if it were
 * free, like bumps. The Jacobian of the iteration and of the covariance is the
 * same function.
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
 *   damping               the damping factor passed 1e30: no shorter step exists
 *   gtol (mpfit.py:1182)  the cosine between r and every free column of J is
 *        <= 1e-10; bumps leaves MPFit's default in force (fitters.py:716)
 *   steps (mpfit.py:1327) accepted steps >= maxSteps -> 'maxiter'
 * A step is accepted when chi2 falls and ratio >= 1e-4 (mpfit.py:1307).
 *
 * Non-finite regions (hayter_msa returns NaN for the whole curve in parts of
 * parameter space, design spec 16). A point with any non-finite residual has
 * chi2 = infinity: as a trial step it is rejected and the damping rises; it is
 * never an Error. What must not happen is that the shrinking steps in front
 * of such a region satisfy ftol, xtol or the damping limit and the fit reports
 * 'converged' at the edge of the region. The exact rule:
 *   0. Only trial steps for which the linear model predicted a relative gain
 *      above ftol count below ("meaningful steps"). A non-finite step with a
 *      predicted gain <= ftol hides nothing: had it been computable, the ftol
 *      test could have ended the fit right there. This keeps an isolated NaN
 *      next to a real minimum (hayter_msa has those) from turning a finished
 *      fit into 'failed'.
 *   1. A "wall" opens at a meaningful non-finite step, or at an iteration in
 *      which a Jacobian column had to be held (below). The smallest damping at
 *      which that happened is remembered. A later meaningful step of the same
 *      iteration that is finite and still rejected takes the wall of this
 *      iteration back: a shorter, computable step was refused on its merits,
 *      so the non-finite region is not what stops the fit. The wall closes
 *      when a step is accepted at a damping no larger than the remembered one,
 *      in an iteration without held columns: the optimiser is back to steps as
 *      long as the ones that ran into the region.
 *   2. ftol / xtol / damping fire after rejected steps only, and the last
 *      meaningful one of them was non-finite, or a column was held
 *      -> 'failed', blockedByNonFinite.
 *   3. They fire in any other way while a wall is open -> one probe: the
 *      Jacobian at the final point and one step at the remembered damping. A
 *      held column or a non-finite probe step -> 'failed', blockedByNonFinite.
 *      A finite step that is acceptable is taken and the fit goes on with the
 *      wall closed; a finite step that is not leaves the status 'converged'.
 *   4. gtol (a stationary point of every parameter) and "every parameter is
 *      held on a bound" end the fit as 'converged' whatever happened before,
 *      unless a column was held because it could not be computed -> 'failed',
 *      blockedByNonFinite.
 *   5. A start point that is not finite is 'failed', blockedByNonFinite and
 *      jacobianNonFinite: values are the start, chi2 is Infinity, errors NaN.
 *   6. 'maxiter' and 'stopped' are reported as such; blockedByNonFinite is
 *      true only together with 'failed'. With finite trial steps only, none of
 *      this applies and the terminal status is the one of the tests above.
 * 'failed' therefore always means "the model cannot be computed around here";
 * values are the best point found, chi2 is reported, errors are computed where
 * the final Jacobian allows.
 * In the iteration, a Jacobian column that none of the four steps can compute
 * is held for that iteration: the parameter is left out of the step like one
 * on an active bound, and the others move.
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

    /** Column j of the Jacobian with the step h: (r(p + h*e_j) - r0)/h; null unless every entry is finite. */
    function differenceColumn(residuals, p, r0, j, h) {
        const shifted = Float64Array.from(p);
        shifted[j] = p[j] + h;
        const r1 = callResiduals(residuals, shifted, r0.length);
        const column = new Float64Array(r0.length);
        for (let i = 0; i < r0.length; i++) column[i] = (r1[i] - r0[i]) / h;
        return allFinite(column) ? column : null;
    }

    /** After the bumps step h failed: the first finite column of -h, +h/2, -h/2 (steps inside the bounds only), or null. */
    function retryColumn(residuals, p, r0, j, h, bounds) {
        const steps = [-h, h / 2, -h / 2].filter((step) => p[j] + step >= bounds.lower[j] && p[j] + step <= bounds.upper[j]);
        for (const step of steps) {
            const column = differenceColumn(residuals, p, r0, j, step);
            if (column !== null) return column;
        }
        return null;
    }

    /**
     * Forward-difference Jacobian at p, given r0 = residuals(p): { J, failed }.
     * `failed` lists the columns no step could compute; they are NaN in J.
     */
    function differentiate(residuals, p, r0, bounds) {
        const m = r0.length;
        const n = p.length;
        const J = new Float64Array(m * n);
        const failed = [];
        for (let j = 0; j < n; j++) {
            const h = stepOf(p[j], bounds.upper[j]);
            const column = differenceColumn(residuals, p, r0, j, h) || retryColumn(residuals, p, r0, j, h, bounds);
            if (column === null) failed.push(j);
            for (let i = 0; i < m; i++) J[i * n + j] = column === null ? NaN : column[i];
        }
        return { J, failed };
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
        const bounds = { lower: readVector(lower, point.length, 'lower'), upper: readVector(upper, point.length, 'upper') };
        const r0 = callResiduals(residuals, point, null);
        const { J, failed } = differentiate(residuals, point, r0, bounds);
        return { J, m: r0.length, n: point.length, nonFiniteColumns: failed };
    }

    // ------------------------------------------------------------- LM parts

    function sumsq(r) {
        let sum = 0;
        for (let i = 0; i < r.length; i++) sum += r[i] * r[i];
        return sum;
    }

    /** A copy of J (n columns) with the listed columns set to zero. */
    function zeroColumns(J, n, columns) {
        const out = Float64Array.from(J);
        for (let i = 0; i < out.length; i += n) columns.forEach((j) => { out[i + j] = 0; });
        return out;
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
     * The linear model at the current point: J (columns that could not be computed
     * set to zero, and how many: `held`), the free set (not on an active bound, not
     * held), the SVD of the scaled free columns, W'r, and the gradient cosine (gtol test).
     */
    function linearise(prob, state) {
        const { n } = prob;
        const m = state.r.length;
        const raw = differentiate(prob.residuals, state.p, state.r, prob);
        const J = raw.failed.length === 0 ? raw.J : zeroColumns(raw.J, n, raw.failed);
        const { norms, g } = columnStats(J, state.r, n);
        const free = freeIndices(state.p, g, prob.lower, prob.upper).filter((j) => raw.failed.indexOf(j) < 0);
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
        return { J, held: raw.failed.length, norms, free, s, V, wr, gnorm };
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

    /**
     * One trial step at the given damping; evaluates the residuals unless the projected
     * step is null. `finite` is false when the residuals at the trial point are not.
     */
    function trialStep(prob, state, sys, lambda) {
        const delta = dampedStep(sys, lambda, prob.n);
        const p = Float64Array.from(state.p, (v, j) => Math.min(Math.max(v + delta[j], prob.lower[j]), prob.upper[j]));
        const step = Float64Array.from(p, (v, j) => v - state.p[j]);
        const rejected = { accepted: false, finite: true, actred: -1, prered: 0, ratio: 0 };
        if (step.every((v) => v === 0)) {
            return { ...rejected, pnorm: scaledNorm(delta, sys.norms), xnorm: scaledNorm(state.p, sys.norms) };
        }
        const r = callResiduals(prob.residuals, p, state.r.length);
        const chi2 = sumsq(r);
        // mpfit.py:1269-1271: a point more than 10 times worse in norm counts as actred = -1.
        // A non-finite chi2 fails this comparison too (NaN and Infinity are never smaller).
        const comparable = 0.1 * Math.sqrt(chi2) < Math.sqrt(state.chi2);
        const actred = comparable ? 1 - chi2 / state.chi2 : -1;
        const prered = predictedReduction(sys.J, state.r, step, state.chi2);
        const ratio = prered !== 0 ? actred / prered : 0;
        const accepted = comparable && chi2 < state.chi2 && ratio >= ACCEPT_RATIO;
        const pnorm = scaledNorm(step, sys.norms);
        const xnorm = scaledNorm(accepted ? p : state.p, sys.norms);
        return { accepted, finite: Number.isFinite(chi2), actred, prered, ratio, pnorm, xnorm, p, r, chi2 };
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

    // In a state, `wall` is null or the damping remembered when a non-finite region was
    // met ("Non-finite regions" in the file header), and `blocked` says the fit ended there.

    const blockedAt = (state) => ({ ...state, status: 'failed', blocked: true });

    /**
     * A non-finite trial step for which the linear model predicted a gain above ftol. Below
     * ftol it hides nothing: a finite value there could have ended the fit by the ftol test.
     */
    const hidesGain = (cfg, trial) => !trial.finite && trial.prered > cfg.ftol;

    /** The state after an accepted trial step. */
    function acceptedState(state, trial, lambda, wall, status) {
        return { p: trial.p, r: trial.r, chi2: trial.chi2, lambda, iterations: state.iterations + 1, wall, blocked: false, status };
    }

    /** One iteration: linearise, then trial steps with rising damping until one is accepted or a test ends the fit. */
    function iterateOnce(prob, cfg, state) {
        const sys = linearise(prob, state);
        if (sys.free.length === 0 || sys.gnorm <= GTOL) {
            return sys.held > 0 ? blockedAt(state) : { ...state, wall: null, status: 'converged' };
        }
        let lambda = state.lambda;
        const inherited = sys.held > 0 && state.wall === null ? lambda : state.wall;
        let wall = inherited;
        let hidden = false;             // the last rejected step with a predicted gain above ftol was non-finite
        for (;;) {
            const used = lambda;
            const trial = trialStep(prob, state, sys, used);
            if (!trial.accepted && trial.prered > cfg.ftol) {
                hidden = !trial.finite;
                wall = hidden ? Math.min(used, wall === null ? used : wall) : inherited;
            }
            lambda = nextLambda(used, trial);
            const iterations = state.iterations + (trial.accepted ? 1 : 0);
            if (trial.accepted) cfg.onProgress(Object.freeze({ iteration: iterations, chi2: trial.chi2 }));
            const status = statusAfter(cfg, trial, iterations, lambda);
            if (trial.accepted) {
                const closed = wall !== null && sys.held === 0 && used <= wall;
                return acceptedState(state, trial, lambda, closed ? null : wall, status);
            }
            if (status !== null) {
                return hidden || sys.held > 0 ? blockedAt({ ...state, lambda }) : { ...state, lambda, wall, status };
            }
        }
    }

    /**
     * A fit about to end as 'converged' while a wall is open: the Jacobian here and one
     * trial step at the damping from before the wall decide (rule 3 of the file header).
     */
    function probeWall(prob, cfg, state) {
        const sys = linearise(prob, state);
        if (sys.held > 0) return blockedAt(state);
        const settled = { ...state, wall: null, status: 'converged' };
        if (sys.free.length === 0 || sys.gnorm <= GTOL) return settled;
        const trial = trialStep(prob, state, sys, state.wall);
        if (hidesGain(cfg, trial)) return blockedAt(state);
        if (!trial.accepted) return settled;
        const iterations = state.iterations + 1;
        cfg.onProgress(Object.freeze({ iteration: iterations, chi2: trial.chi2 }));
        const status = iterations >= cfg.maxSteps ? 'maxiter' : null;
        return acceptedState(state, trial, nextLambda(state.wall, trial), null, status);
    }

    function iterate(prob, cfg, first) {
        let state = first;
        for (;;) {
            if (state.status === null) {
                state = cfg.shouldStop() ? { ...state, status: 'stopped' } : iterateOnce(prob, cfg, state);
            } else if (state.status === 'converged' && state.wall !== null) {
                state = probeWall(prob, cfg, state);
            } else {
                return state;
            }
        }
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
            svd: o.svdMaxSweeps === undefined ? undefined : { maxSweeps: o.svdMaxSweeps },
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
        if (o.svdMaxSweeps !== undefined && (!Number.isInteger(o.svdMaxSweeps) || o.svdMaxSweeps < 1)) {
            throw new Error('svdMaxSweeps must be a positive integer, got ' + String(o.svdMaxSweeps));
        }
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

    /** C (row-major k x k, over the parameters `kept`) spread into n x n, NaN in every other row and column. */
    function spread(C, kept, n) {
        const out = new Float64Array(n * n).fill(NaN);
        kept.forEach((a, i) => kept.forEach((b, j) => { out[a * n + b] = C[i * kept.length + j]; }));
        return out;
    }

    /** The covariance of the parameters whose Jacobian column exists, the others held (their rows are NaN). */
    function partialCovariance(J, m, n, failed, svdOptions) {
        const kept = Array.from({ length: n }, (_, j) => j).filter((j) => failed.indexOf(j) < 0);
        const k = kept.length;
        const reduced = new Float64Array(m * k);
        for (let i = 0; i < m; i++) kept.forEach((j, c) => { reduced[i * k + c] = J[i * n + j]; });
        const { C, illConditioned, converged } = covariance(reduced, m, k, svdOptions);
        return { C: spread(C, kept, n), illConditioned: illConditioned || !converged, jacobianNonFinite: true };
    }

    /** Covariance at p from the bumps Jacobian (with its retries); all NaN when the point itself is not finite. */
    function errorsAt(prob, cfg, state) {
        const { n } = prob;
        const m = state.r.length;
        if (!Number.isFinite(state.chi2)) {
            return { C: new Float64Array(n * n).fill(NaN), illConditioned: false, jacobianNonFinite: true };
        }
        const { J, failed } = differentiate(prob.residuals, state.p, state.r, prob);
        if (failed.length > 0) return partialCovariance(J, m, n, failed, cfg.svd);
        const { C, illConditioned, converged } = covariance(J, m, n, cfg.svd);
        return { C, illConditioned: illConditioned || !converged, jacobianNonFinite: false };
    }

    function buildResult(prob, cfg, state, dof) {
        const { n } = prob;
        const { C, illConditioned, jacobianNonFinite } = errorsAt(prob, cfg, state);
        const rows = Array.from({ length: n }, (_, i) => Object.freeze(Array.from(C.subarray(i * n, (i + 1) * n))));
        return Object.freeze({
            names: prob.names,
            values: Object.freeze(Array.from(state.p)),
            errors: Object.freeze(rows.map((row, i) => Math.sqrt(row[i]))),
            illConditioned,
            jacobianNonFinite,
            blockedByNonFinite: state.blocked,
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
            p: prob.p, r, chi2: finite ? sum : Infinity, lambda: LAMBDA_START, iterations: 0, wall: null,
            blocked: !finite, status: finite ? null : 'failed',
        };
        return buildResult(prob, cfg, iterate(prob, cfg, first), dof);
    }

    globalThis.SasFitFitter = Object.freeze({ fit, jacobian, covariance, svd, DEFAULTS });
})();
