/**
 * sasfit-validate.js -- input checks shared by the sasfit compute modules
 * (kernel, product, py-models, evaluate), so that the same mistake gives the
 * same message whichever module meets it first.
 *
 * Pure computation, usable in a Web Worker and in Node; no inputs are mutated.
 * Every Error names the offending parameter or value.
 */

(function () {
    'use strict';

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

    function checkQ(q) {
        const ok = Array.isArray(q) || q instanceof Float64Array;
        if (!ok || !Array.prototype.every.call(q, (v) => typeof v === 'number')) {
            throw new Error('q must be a Float64Array or an array of numbers');
        }
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
        PD_SUFFIXES, has, isObject, assertObject, readNumber, checkQ, readCutoff,
        isPolydisperse, pdNames, knownNames, assertNoUnusedPars,
    });
})();
