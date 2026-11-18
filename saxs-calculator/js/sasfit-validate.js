/**
 * sasfit-validate.js -- input checks shared by the sasfit compute modules
 * (kernel, product, py-models, evaluate), so that the same mistake gives the
 * same message whichever module meets it first.
 *
 * Pure computation, usable in a Web Worker and in Node; no inputs are mutated.
 * Every Error names the offending parameter or value.
 *
 * Size limits (design spec 12). They keep a typo such as radius_pd_n = 1e9
 * from freezing the Worker or ending in "RangeError: Invalid array length":
 *   MAX_PD_POINTS    points of one parameter's distribution (*_pd_n)
 *   MAX_EVAL_POINTS  points of the whole dispersity mesh (product of the lengths)
 *   MAX_Q_POINTS     points of q
 * sasmodels has no such limits; they are far above anything the page offers
 * (the largest sasmodels default is 80 points per parameter).
 */

(function () {
    'use strict';

    const MAX_PD_POINTS = 1000;
    const MAX_EVAL_POINTS = 1e6;
    const MAX_Q_POINTS = 1e6;
    const COMMON_NAMES = Object.freeze(['scale', 'background']);
    // The four dispersity names of a polydisperse parameter (direct_model.py:139-142).
    const PD_SUFFIXES = Object.freeze(['_pd', '_pd_n', '_pd_nsigma', '_pd_type']);

    /** Own-property test: names such as "constructor" or "__proto__" are never inherited hits. */
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    const isObject = (v) => v !== null && typeof v === 'object';

    function assertObject(value, label) {
        if (!isObject(value)) throw new Error(label + ' must be an object');
    }

    /** pars[name] when it is an own property (it must be a number), else the fallback. */
    function readNumber(pars, name, fallback) {
        if (!has(pars, name)) return fallback;
        const v = pars[name];
        if (typeof v !== 'number') {
            throw new Error('Parameter ' + name + ' must be a number, got ' + typeof v);
        }
        return v;
    }

    /** readNumber that also rejects NaN and the infinities. */
    function readFinite(pars, name, fallback) {
        const v = readNumber(pars, name, fallback);
        if (!Number.isFinite(v)) throw new Error('Parameter ' + name + ' must be a finite number, got ' + v);
        return v;
    }

    /**
     * A *_pd_n value. It is returned as given: sasmodels compares the raw
     * value with 0 (direct_model.py:143) and applies int() only when it builds
     * the distribution (weights.py:31), where fewer than 2 points -- negative
     * counts included -- give the single point at the centre (weights.py:66).
     */
    function readPdCount(pars, name, fallback) {
        const v = readNumber(pars, name, fallback);
        if (!Number.isFinite(v) || Math.trunc(v) > MAX_PD_POINTS) {
            throw new Error('Parameter ' + name + ' must be a finite number of points, at most '
                + MAX_PD_POINTS + ', got ' + v);
        }
        return v;
    }

    function typeName(v) {
        if (v === null || typeof v !== 'object') return v === null ? 'null' : typeof v;
        return v.constructor && v.constructor.name ? v.constructor.name : 'object';
    }

    /**
     * q is a Float64Array of 1..MAX_Q_POINTS points. O(1) on purpose: this
     * runs on every evaluation of a fit, so the values are not scanned (a
     * typed array can only hold numbers; NaN in q gives NaN out). Callers
     * convert plain arrays once, with Float64Array.from.
     */
    function checkQ(q) {
        if (!(q instanceof Float64Array)) throw new Error('q must be a Float64Array, got ' + typeName(q));
        if (q.length < 1 || q.length > MAX_Q_POINTS) {
            throw new Error('q must have 1..' + MAX_Q_POINTS + ' points, got ' + q.length);
        }
    }

    /**
     * The dispersity mesh has prod(lengths) points. The product is taken as a
     * double, before the details buffer (int32) or any wasm buffer exists.
     * names / lengths: one entry per kernel parameter; those of length 1 are
     * left out of the message.
     */
    function assertEvalPoints(modelName, names, lengths) {
        const total = lengths.reduce((product, n) => product * n, 1);
        if (total <= MAX_EVAL_POINTS) return;
        const active = names.map((name, i) => name + ' ' + lengths[i]).filter((_, i) => lengths[i] > 1);
        throw new Error('Polydispersity mesh of ' + modelName + ' has ' + total + ' points ('
            + active.join(' x ') + '), the limit is ' + MAX_EVAL_POINTS);
    }

    /**
     * opts.cutoff, a finite number >= 0. Without a fallback the option is
     * required; with one, a missing opts or an undefined cutoff takes it.
     */
    function readCutoff(opts, fallback) {
        const given = isObject(opts) ? opts.cutoff : undefined;
        const cutoff = given === undefined ? fallback : given;
        if (typeof cutoff !== 'number' || !(cutoff >= 0) || !Number.isFinite(cutoff)) {
            const what = fallback === undefined ? 'cutoff is required and' : 'cutoff';
            throw new Error(what + ' must be a finite number >= 0, got ' + cutoff);
        }
        return cutoff;
    }

    /** parameter.polydisperse (modelinfo.py:167); `pd` in the meta is membership of pd_1d. */
    function isPolydisperse(param) {
        return param.type === 'volume' || param.type === 'orientation';
    }

    /** The *_pd names a parameter accepts: none unless it is polydisperse. */
    function pdNames(param) {
        return isPolydisperse(param) ? PD_SUFFIXES.map((s) => param.name + s) : [];
    }

    /** Every name a single model accepts: scale, background, its parameters and their *_pd names. */
    function knownNames(meta) {
        const known = new Set(COMMON_NAMES);
        meta.params.forEach((p) => {
            known.add(p.name);
            pdNames(p).forEach((n) => known.add(n));
        });
        return known;
    }

    /**
     * get_mesh raises on leftovers (direct_model.py:121-122). `known` is
     * anything with has(name): a Set of names or a Map keyed by name. Only own
     * keys of pars count, so an own "__proto__" key is reported like any other.
     */
    function assertNoUnusedPars(modelName, pars, known) {
        const unused = Object.keys(pars).filter((k) => !known.has(k));
        if (unused.length > 0) {
            throw new Error('Unused parameters in call to ' + modelName + ': ' + unused.join(', '));
        }
    }

    globalThis.SasFitValidate = Object.freeze({
        MAX_PD_POINTS, MAX_EVAL_POINTS, MAX_Q_POINTS, PD_SUFFIXES,
        has, isObject, assertObject, readNumber, readFinite, readPdCount, checkQ, readCutoff,
        isPolydisperse, pdNames, knownNames, assertNoUnusedPars, assertEvalPoints,
    });
})();
