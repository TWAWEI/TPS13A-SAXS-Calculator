/**
 * sasfit-linalg.js -- the dense linear algebra of the sasfit fitter: a
 * one-sided Jacobi SVD and the covariance bumps derives from it. Original code.
 *
 *   SasFitLinalg.svd(A, m, n, options?) -> { s, V, converged }
 *     A is row-major, m rows of n, m >= n, finite (else an Error). s holds the
 *     singular values in descending order, V (row-major n x n) the right
 *     singular vectors in its columns. U is not formed.
 *   SasFitLinalg.covariance(J, m, n, options?) -> { C, illConditioned, converged, nonFinite }
 *     C = V*diag(1/s^2)*V' (row-major n x n) with singular values <= 1e-8
 *     replaced by 1e-8, as bumps 1.0.4 lsqerror.py:283-285 does;
 *     illConditioned says that a value was replaced, and nothing else. A J
 *     that is not finite gives an all-NaN C with nonFinite true (and
 *     illConditioned false: nothing was decomposed). Needs m >= n.
 *   SasFitLinalg.decompose(A, m, n, maxSweeps?) -> { W, s, V, converged }
 *     The unsorted factorisation A = W*V' behind both (W has orthogonal
 *     columns of norm s); the LM iteration solves its damped step with it.
 *     No checks: A must be finite.
 *
 * options = { maxSweeps }: the cap on Jacobi sweeps, a positive integer,
 * default 60 (a dozen columns need 6-10). `converged` is false when the cap
 * was reached before a sweep found nothing left to rotate: the factors may
 * then be only approximately orthogonal, so s, V and C are not to be trusted. It has not
 * been seen with the default; the option exists so that this path can be tested.
 *
 * Why Jacobi: JavaScript has no SVD, the matrices are small (a dozen columns)
 * and the method is accurate to the last bits for columns of very different
 * scale, which is what a Jacobian of mixed parameters is. Pure: inputs are
 * only read, every result is newly allocated.
 */

(function () {
    'use strict';

    const SV_FLOOR = 1e-8;            // lsqerror.py:265
    const MAX_SWEEPS = 60;
    const ROTATE_TOL = 4 * Number.EPSILON;

    function allFinite(a) {
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
        return true;
    }

    function checkMatrix(A, m, n, what) {
        if (!Number.isInteger(m) || !Number.isInteger(n) || n < 0 || m < n) {
            throw new Error(what + ' needs integer sizes with m >= n >= 0, got m = ' + m + ', n = ' + n);
        }
        if (A === null || typeof A !== 'object' || A.length !== m * n) {
            throw new Error(what + ' needs ' + (m * n) + ' values (m*n), got ' + (A && A.length));
        }
    }

    /** Columns p and q of the row-major matrix M (n columns) rotated in place. */
    function rotate(M, rows, n, p, q, c, s) {
        for (let i = 0; i < rows; i++) {
            const a = M[i * n + p];
            const b = M[i * n + q];
            M[i * n + p] = c * a - s * b;
            M[i * n + q] = s * a + c * b;
        }
    }

    /** One Jacobi sweep over all column pairs of W (and V); true when it rotated. */
    function sweep(W, V, m, n) {
        let rotated = false;
        for (let p = 0; p < n - 1; p++) {
            for (let q = p + 1; q < n; q++) {
                let alpha = 0;
                let beta = 0;
                let gamma = 0;
                for (let i = 0; i < m; i++) {
                    const a = W[i * n + p];
                    const b = W[i * n + q];
                    alpha += a * a;
                    beta += b * b;
                    gamma += a * b;
                }
                if (gamma === 0 || Math.abs(gamma) <= ROTATE_TOL * Math.sqrt(alpha) * Math.sqrt(beta)) continue;
                const zeta = (beta - alpha) / (2 * gamma);
                const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.hypot(1, zeta));
                const c = 1 / Math.hypot(1, t);
                rotate(W, m, n, p, q, c, c * t);
                rotate(V, n, n, p, q, c, c * t);
                rotated = true;
            }
        }
        return rotated;
    }

    /**
     * A = (W with orthogonal columns) * V', by one-sided Jacobi on a copy of A;
     * s[k] is the norm of column k of W. Not sorted. A must be finite.
     */
    function decompose(A, m, n, maxSweeps = MAX_SWEEPS) {
        const W = Float64Array.from(A);
        const V = new Float64Array(n * n);
        for (let j = 0; j < n; j++) V[j * n + j] = 1;
        let converged = false;
        for (let k = 0; k < maxSweeps && !converged; k++) converged = !sweep(W, V, m, n);
        const s = new Float64Array(n);
        for (let j = 0; j < n; j++) {
            let sum = 0;
            for (let i = 0; i < m; i++) sum += W[i * n + j] * W[i * n + j];
            s[j] = Math.sqrt(sum);
        }
        return { W, s, V, converged };
    }

    /** options.maxSweeps, checked; the default when options is left out. */
    function sweepsOf(options) {
        if (options === undefined || options === null || options.maxSweeps === undefined) return MAX_SWEEPS;
        if (!Number.isInteger(options.maxSweeps) || options.maxSweeps < 1) {
            throw new Error('maxSweeps must be a positive integer, got ' + String(options.maxSweeps));
        }
        return options.maxSweeps;
    }

    function svd(A, m, n, options) {
        checkMatrix(A, m, n, 'svd');
        if (!allFinite(A)) throw new Error('svd needs a finite matrix');
        const raw = decompose(A, m, n, sweepsOf(options));
        const order = Array.from(raw.s, (_, j) => j).sort((a, b) => raw.s[b] - raw.s[a] || a - b);
        const V = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < n; k++) V[i * n + k] = raw.V[i * n + order[k]];
        }
        return { s: Float64Array.from(order, (j) => raw.s[j]), V, converged: raw.converged };
    }

    function covariance(J, m, n, options) {
        checkMatrix(J, m, n, 'covariance');
        const maxSweeps = sweepsOf(options);
        if (!allFinite(J)) {
            return { C: new Float64Array(n * n).fill(NaN), illConditioned: false, converged: true, nonFinite: true };
        }
        const { s, V, converged } = decompose(J, m, n, maxSweeps);
        let illConditioned = false;
        const inv = Float64Array.from(s, (sv) => {
            if (sv <= SV_FLOOR) illConditioned = true;
            const used = sv <= SV_FLOOR ? SV_FLOOR : sv;
            return 1 / (used * used);
        });
        const C = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
            for (let j = i; j < n; j++) {
                let sum = 0;
                for (let k = 0; k < n; k++) sum += V[i * n + k] * inv[k] * V[j * n + k];
                C[i * n + j] = sum;
                C[j * n + i] = sum;
            }
        }
        return { C, illConditioned, converged, nonFinite: false };
    }

    globalThis.SasFitLinalg = Object.freeze({ svd, covariance, decompose, allFinite, SV_FLOOR });
})();
