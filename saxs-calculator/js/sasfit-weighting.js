/**
 * sasfit-weighting.js -- fit weights, the usable-point mask and the default fit
 * range (design spec 4.8). Original code, not a port.
 *
 * Pure computation, usable on the main thread and in a Web Worker; the dataset
 * is only read (q, I, sigma, kind, header.qStart) and every returned array is
 * newly allocated. Every Error names the offending mode or value.
 *
 * A point is usable when finite(q), q > 0, finite(I), finite(w) and w > 0.
 * The residual of a usable point is (I - I_model) / w.
 *
 * Official TPS 13A files (dataset.kind 'official', owner decision D1, spec 15):
 * the beamline writes sigma = 0 for bins without valid data (the beamstop
 * region). In such a file a row whose sigma is 0, negative or not finite is
 * therefore unusable in EVERY mode, not only with weighting 'sigma'. Generic
 * files (kind 'generic' or absent) and files without an error column keep
 * the rule above. weights() is not affected: the mask is.
 */

(function () {
    'use strict';

    const { assertObject } = globalThis.SasFitValidate;

    const MODES = Object.freeze(['sigma', 'sqrtI', 'absI', 'none']);
    const KINDS = Object.freeze(['official', 'generic']);

    function assertMode(mode) {
        if (MODES.indexOf(mode) < 0) {
            throw new Error('Unknown weighting mode ' + String(mode) + ' (expected one of ' + MODES.join(', ') + ')');
        }
    }

    function assertDataset(dataset) {
        assertObject(dataset, 'dataset');
        const { q, I, sigma } = dataset;
        if (!(q instanceof Float64Array) || !(I instanceof Float64Array)) {
            throw new Error('dataset.q and dataset.I must be Float64Array');
        }
        if (q.length !== I.length) {
            throw new Error('dataset.q length ' + q.length + ' does not match dataset.I length ' + I.length);
        }
        if (sigma !== null && sigma !== undefined) {
            if (!(sigma instanceof Float64Array) || sigma.length !== q.length) {
                throw new Error('dataset.sigma must be null or a Float64Array of length ' + q.length
                    + ', got length ' + (sigma && sigma.length));
            }
        }
        if (dataset.kind !== undefined && KINDS.indexOf(dataset.kind) < 0) {
            throw new Error('dataset.kind must be one of ' + KINDS.join(', ') + ' (or absent), got ' + String(dataset.kind));
        }
    }

    /** The error column that decides validity by itself: that of an official file; null otherwise. */
    function validitySigma(dataset) {
        return dataset.kind === 'official' && dataset.sigma instanceof Float64Array ? dataset.sigma : null;
    }

    /** How many rows of an official file are invalid by their sigma alone (0 for any other dataset). */
    function countInvalidSigma(dataset) {
        assertDataset(dataset);
        const sigma = validitySigma(dataset);
        if (sigma === null) return 0;
        return sigma.reduce((count, s) => count + (Number.isFinite(s) && s > 0 ? 0 : 1), 0);
    }

    /** w_i for the mode; mode 'sigma' needs dataset.sigma. */
    function weights(dataset, mode) {
        assertMode(mode);
        assertDataset(dataset);
        const n = dataset.q.length;
        if (mode === 'sigma') {
            if (!dataset.sigma) throw new Error("Weighting mode 'sigma' needs dataset.sigma, but it is null");
            return Float64Array.from(dataset.sigma);
        }
        const w = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            if (mode === 'none') w[i] = 1;
            else if (mode === 'absI') w[i] = Math.abs(dataset.I[i]);
            else w[i] = Math.sqrt(Math.abs(dataset.I[i]));
        }
        return w;
    }

    /** The mask for weights w that were already computed for this dataset. */
    function maskOf(dataset, w) {
        const { q, I } = dataset;
        const sigma = validitySigma(dataset);
        const m = new Uint8Array(q.length);
        for (let i = 0; i < q.length; i++) {
            const valid = sigma === null || (Number.isFinite(sigma[i]) && sigma[i] > 0);
            m[i] = (valid && Number.isFinite(q[i]) && q[i] > 0 && Number.isFinite(I[i])
                && Number.isFinite(w[i]) && w[i] > 0) ? 1 : 0;
        }
        return m;
    }

    /** 1 where the point may take part in a fit (all conditions of spec 4.8). */
    function mask(dataset, mode) {
        return maskOf(dataset, weights(dataset, mode));
    }

    /** How many points of the dataset the mask of this mode leaves out (the page shows it per mode). */
    function countExcluded(dataset, mode) {
        return mask(dataset, mode).reduce((count, usable) => count + (usable ? 0 : 1), 0);
    }

    /**
     * 'sigma' when the dataset has an error column with at least one usable value
     * (finite and > 0), else 'none': a column of zeros or NaN would leave no point to fit.
     */
    function defaultMode(dataset) {
        const sigma = dataset ? dataset.sigma : null;
        if (!(sigma instanceof Float64Array)) return 'none';
        return sigma.some((s) => Number.isFinite(s) && s > 0) ? 'sigma' : 'none';
    }

    /** header.qStart when it applies: official file and a finite positive number. */
    function officialQStart(dataset) {
        const h = dataset.header;
        if (dataset.kind !== 'official' || h === null || typeof h !== 'object') return null;
        return (typeof h.qStart === 'number' && Number.isFinite(h.qStart) && h.qStart > 0) ? h.qStart : null;
    }

    /**
     * { qMin, qMax } over the usable points; qMin is also lifted to qStart
     * (official files only). null when no usable point lies in that range,
     * which includes qStart beyond the last usable q.
     */
    function defaultRange(dataset, mode) {
        const m = mask(dataset, mode);
        const { q } = dataset;
        let first = -1;
        let last = -1;
        for (let i = 0; i < m.length; i++) {
            if (m[i]) {
                if (first < 0) first = i;
                last = i;
            }
        }
        if (first < 0) return null;
        const qStart = officialQStart(dataset);
        const qMin = qStart === null ? q[first] : Math.max(qStart, q[first]);
        return qMin > q[last] ? null : { qMin, qMax: q[last] };
    }

    /** Usable points with qMin <= q <= qMax (both bounds inclusive); index points into the dataset. */
    function select(dataset, mode, range) {
        if (range === null || typeof range !== 'object'
            || !(range.qMin <= range.qMax)) {
            throw new Error('range must be { qMin, qMax } with qMin <= qMax, got ' + JSON.stringify(range));
        }
        const w = weights(dataset, mode);
        const m = maskOf(dataset, w);
        const { q, I } = dataset;
        const keep = [];
        for (let i = 0; i < m.length; i++) {
            if (m[i] && q[i] >= range.qMin && q[i] <= range.qMax) keep.push(i);
        }
        return {
            index: Uint32Array.from(keep),
            q: Float64Array.from(keep, (i) => q[i]),
            I: Float64Array.from(keep, (i) => I[i]),
            w: Float64Array.from(keep, (i) => w[i]),
        };
    }

    globalThis.SasFitWeighting = Object.freeze({
        MODES, KINDS, weights, mask, countExcluded, countInvalidSigma, defaultMode, defaultRange, select,
    });
})();
