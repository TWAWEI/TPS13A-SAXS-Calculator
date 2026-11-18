/**
 * sasfit-weights.js -- polydispersity sample points and weights.
 *
 * Ported from sasmodels/weights.py (Dispersion, Gaussian/Rectangle/Uniform/
 * LogNormal/Schulz/Boltzmann dispersions, and the module-level get_weights).
 * Copyright (c) 2009-2022, SasView Developers -- BSD 3-Clause,
 * see wasm/LICENSE-sasmodels.txt
 *
 * Pure computation: no DOM, no inputs mutated.
 *
 * Deliberate deviation: npts above SasFitValidate.MAX_PD_POINTS and non-finite
 * npts / width / nsigmas are an Error (sasmodels raises ValueError for int(nan)
 * and otherwise returns NaN weights or tries to allocate).
 */

(function () {
    'use strict';

    // Class defaults of the sasmodels dispersions (weights.py `default`).
    const DEFAULTS = Object.freeze({
        gaussian: Object.freeze({ npts: 35, width: 0, nsigmas: 3 }),
        rectangle: Object.freeze({ npts: 35, width: 0, nsigmas: 1.73205 }),
        uniform: Object.freeze({ npts: 35, width: 0, nsigmas: null }),
        lognormal: Object.freeze({ npts: 80, width: 0, nsigmas: 8 }),
        schulz: Object.freeze({ npts: 80, width: 0, nsigmas: 8 }),
        boltzmann: Object.freeze({ npts: 35, width: 0, nsigmas: 3 }),
    });

    const MIN_LOG_LIMIT = 1e-8; // max(lb, 1e-8) in LogNormal / Schulz

    // Lanczos approximation (g = 7, n = 9); log-gamma for real z > 0.
    const LANCZOS_G = 7;
    const LANCZOS_COEF = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);

    function gammaln(z) {
        if (z < 0.5) {
            // reflection: Gamma(z) Gamma(1-z) = pi / sin(pi z)
            return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - gammaln(1 - z);
        }
        const zm = z - 1;
        let a = LANCZOS_COEF[0];
        const t = zm + LANCZOS_G + 0.5;
        for (let i = 1; i < LANCZOS_COEF.length; i++) a += LANCZOS_COEF[i] / (zm + i);
        return HALF_LOG_2PI + (zm + 0.5) * Math.log(t) - t + Math.log(a);
    }

    /** numpy.linspace(start, stop, npts): start + i*step, last point set to stop. */
    function linspace(start, stop, npts) {
        const out = new Array(npts);
        const step = (stop - start) / (npts - 1);
        for (let i = 0; i < npts; i++) out[i] = start + i * step;
        out[npts - 1] = stop;
        return out;
    }

    /** Dispersion._linspace: center + linspace(-ns*sigma, +ns*sigma, npts), kept if lb <= x <= ub. */
    function linspaceWithin(center, sigma, lb, ub, npts, nsigmas) {
        const offsets = linspace(-nsigmas * sigma, +nsigmas * sigma, npts);
        return offsets.map((o) => center + o).filter((x) => x >= lb && x <= ub);
    }

    // Each entry returns { x, px } like the subclass _weights(center, sigma, lb, ub).
    const WEIGHTS = {
        gaussian(center, sigma, lb, ub, npts, nsigmas) {
            const x = linspaceWithin(center, sigma, lb, ub, npts, nsigmas);
            const px = x.map((v) => Math.exp((v - center) ** 2 / (-2.0 * sigma * sigma)));
            return { x, px };
        },
        uniform(center, sigma, lb, ub, npts) {
            const x = linspace(center - sigma, center + sigma, npts).filter((v) => v >= lb && v <= ub);
            return { x, px: x.map(() => 1) };
        },
        rectangle(center, sigma, lb, ub, npts, nsigmas) {
            const limit = Math.abs(sigma) * Math.sqrt(3.0);
            const x = linspaceWithin(center, sigma, lb, ub, npts, nsigmas)
                .filter((v) => Math.abs(v - center) <= limit);
            return { x, px: x.map(() => 1) };
        },
        lognormal(center, sigma, lb, ub, npts, nsigmas) {
            const x = linspaceWithin(center, sigma, Math.max(lb, MIN_LOG_LIMIT),
                Math.max(ub, MIN_LOG_LIMIT), npts, nsigmas);
            // sigma in the lognormal function is in ln(R) space, thus needs converting
            const sig = Math.abs(sigma / center);
            const px = x.map((v) => Math.exp(-0.5 * ((Math.log(v) - Math.log(center)) / sig) ** 2) / (v * sig));
            return { x, px };
        },
        schulz(center, sigma, lb, ub, npts, nsigmas) {
            const x = linspaceWithin(center, sigma, Math.max(lb, MIN_LOG_LIMIT),
                Math.max(ub, MIN_LOG_LIMIT), npts, nsigmas);
            const z = (center / sigma) ** 2;
            const px = x.map((v) => {
                const R = v / center;
                return Math.exp(z * Math.log(z) + (z - 1) * Math.log(R) - R * z - Math.log(center) - gammaln(z));
            });
            return { x, px };
        },
        boltzmann(center, sigma, lb, ub, npts, nsigmas) {
            const x = linspaceWithin(center, sigma, lb, ub, npts, nsigmas);
            return { x, px: x.map((v) => Math.exp(-Math.abs(v - center) / Math.abs(sigma))) };
        },
    };

    /** Dispersion.get_weights: width 0 or npts < 2 gives the single point `center` (if within limits). */
    function rawWeights(sampler, center, width, npts, nsigmas, lb, ub, relative) {
        const sigma = relative ? width * center : width;
        // For orientation, the jitter is relative to 0 not the angle
        const c = relative ? center : 0;
        if (sigma === 0 || npts < 2) {
            return c >= lb && c <= ub ? { x: [c], px: [1.0] } : { x: [], px: [] };
        }
        return sampler(c, sigma, lb, ub, npts, nsigmas);
    }

    /**
     * weights.get_weights(disperser, n, width, nsigmas, value, limits, relative);
     * returns { x, w } as Float64Arrays, w normalised to sum 1.
     * npts / nsigmas null or undefined take the class default; npts is truncated like int().
     */
    function getWeights(type, center, width, npts, nsigmas, lower, upper, relative) {
        if (!Object.prototype.hasOwnProperty.call(WEIGHTS, type)) {
            throw new Error('Unknown polydispersity distribution: ' + type);
        }
        const d = DEFAULTS[type];
        const n = npts == null ? d.npts : Math.trunc(npts);
        const ns = nsigmas == null ? d.nsigmas : nsigmas;
        const w0 = width == null ? d.width : width;
        const maxPoints = globalThis.SasFitValidate.MAX_PD_POINTS;
        if (!Number.isFinite(n) || n > maxPoints) {
            throw new Error('Polydispersity npts must be a finite number, at most ' + maxPoints + ', got ' + npts);
        }
        if (!Number.isFinite(w0)) throw new Error('Polydispersity width must be a finite number, got ' + w0);
        // uniform has no nsigmas (class default null)
        if (ns !== null && !Number.isFinite(ns)) {
            throw new Error('Polydispersity nsigmas must be a finite number, got ' + ns);
        }
        const { x, px } = rawWeights(WEIGHTS[type], center, w0, n, ns, lower, upper, relative);
        const total = px.reduce((s, v) => s + v, 0);
        return { x: Float64Array.from(x), w: Float64Array.from(px, (v) => v / total) };
    }

    globalThis.SasFitWeights = Object.freeze({ getWeights, gammaln, DEFAULTS });
})();
