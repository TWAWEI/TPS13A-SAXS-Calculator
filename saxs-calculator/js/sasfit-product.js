/**
 * sasfit-product.js -- P@S: a form factor combined with a structure factor,
 * with the beta approximation and the effective-radius modes.
 *
 * Ported from sasmodels 1.0.12:
 *   product.py  make_extra_pars, make_product_info, ProductKernel.__init__,
 *               ProductKernel.Iq, _Intermediates
 * Copyright (c) 2009-2022, SasView Developers -- BSD 3-Clause,
 * see wasm/LICENSE-sasmodels.txt
 *
 * Pure computation, usable in a Web Worker and in Node; no inputs are mutated.
 * P and S are evaluated only through the SasFitKernel kernels handed to
 * create() (kernel.Fq for P, kernel.Iq for S). product.py slices one shared
 * values vector into a P and an S vector; here the same split is done on the
 * parameter object, and each kernel assembles its own buffers.
 *
 * Deliberate deviations from the sasmodels source:
 *   - cutoff is a required option, as in SasFitKernel.
 *   - create() refuses a P without F(q) or without effective radius modes.
 *     That is the rule of the design spec; sasmodels itself builds such a
 *     product and merely leaves out the corresponding mode parameter
 *     (product.py:152, 161).
 *   - An S parameter whose name is also a P parameter (other than
 *     volfraction) is an Error. In 1.0.12 the "_S" tag is dead code
 *     (product.py:201-205 keeps pair[0], the untagged parameter), so sasmodels
 *     would build a table with a duplicate name. None of the supported
 *     combinations collide.
 *   - Parameter values must be numbers (sasmodels applies float()). The two
 *     mode parameters are read as in product.py:437-440: int() for
 *     radius_effective_mode, "> 0" for structure_factor_mode.
 *   - With radius_effective_mode > 0 the radius_effective_pd* parameters of S
 *     are dropped unread. sasmodels still builds that distribution in
 *     get_mesh and then forces its length to 1 (product.py:480-483), so an
 *     invalid radius_effective_pd_type raises there and not here.
 *   - Magnetic parameters are not ported (see sasfit-kernel.js).
 *   - parts() returns the intermediates that product.py exposes through the
 *     lazy kernel.results (_Intermediates) together with I(q).
 */

(function () {
    'use strict';

    // product.py:142-145
    const STRUCTURE_MODE_ID = 'structure_factor_mode';
    const RADIUS_MODE_ID = 'radius_effective_mode';
    const RADIUS_ID = 'radius_effective';
    const VOLFRAC_ID = 'volfraction';
    // scale / background: COMMON_PARAMETERS (modelinfo.py:50-53), the product table
    // does not inherit the defaults of P or S; modes: make_extra_pars (product.py:156, 165)
    const DEFAULTS = Object.freeze({
        scale: 1, background: 0.001, [STRUCTURE_MODE_ID]: 0, [RADIUS_MODE_ID]: 1,
    });
    const PD_SUFFIXES = Object.freeze(['_pd', '_pd_n', '_pd_nsigma', '_pd_type']);
    // Where a product parameter goes: the P kernel, the S kernel, S.radius_effective
    // (replaced by P's value when the mode is > 0), or read by the product itself.
    const TO_P = 'p';
    const TO_S = 's';
    const TO_RADIUS = 'radius';
    const TO_PRODUCT = 'product';

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const hasParam = (meta, name) => meta.params.some((p) => p.name === name);

    /** parameter.polydisperse (modelinfo.py:167): these accept the *_pd names. */
    function pdNames(param) {
        const polydisperse = param.type === 'volume' || param.type === 'orientation';
        return polydisperse ? PD_SUFFIXES.map((s) => param.name + s) : [];
    }

    function readNumber(pars, name, fallback) {
        if (!has(pars, name)) return fallback;
        const v = pars[name];
        if (typeof v !== 'number') {
            throw new Error('Parameter ' + name + ' must be a number, got ' + typeof v);
        }
        return v;
    }

    /** The spec's "can take S(Q)" rule: P needs F(q) and effective radius modes. */
    function assertCanTakeStructure(pMeta) {
        const missing = [];
        if (!pMeta.haveFq) missing.push('no F(q)');
        if (pMeta.reffModes.length === 0) missing.push('no effective radius modes');
        if (missing.length > 0) {
            throw new Error(pMeta.name + ' cannot take a structure factor: ' + missing.join(', '));
        }
    }

    /** make_product_info (product.py:181-190) plus the checks listed in the header. */
    function assertComposition(pMeta, sMeta) {
        assertCanTakeStructure(pMeta);
        if (!sMeta.isStructureFactor) throw new Error(sMeta.name + ' is not a structure factor');
        const first = sMeta.params.slice(0, 2).map((p) => p.name);
        if (first[0] !== RADIUS_ID || first[1] !== VOLFRAC_ID) {
            throw new Error('S needs ' + RADIUS_ID + ' and ' + VOLFRAC_ID + ' as its first parameters');
        }
        if (sMeta.layout.nmagnetic !== 0) throw new Error('S should not have SLD parameters');
        if (hasParam(pMeta, RADIUS_ID)) throw new Error('P should not have ' + RADIUS_ID);
        const clash = sMeta.params.map((p) => p.name)
            .filter((name) => name !== VOLFRAC_ID && hasParam(pMeta, name));
        if (clash.length > 0) {
            throw new Error('Parameters of ' + sMeta.name + ' collide with ' + pMeta.name + ': '
                + clash.join(', '));
        }
    }

    function assertKernel(kernel, meta, role) {
        const usable = kernel && kernel.name === meta.name
            && typeof kernel.Fq === 'function' && typeof kernel.Iq === 'function';
        if (!usable) throw new Error(role + ' kernel must be the SasFitKernel kernel of ' + meta.name);
    }

    /** S parameters of the combined table: volfraction is elided when P has its own (product.py:201-205). */
    function sListOf(sMeta, pHasVolfrac) {
        return sMeta.params.filter((p) => p.name !== VOLFRAC_ID || !pHasVolfrac);
    }

    /** scale, background, P, S, the two mode parameters (product.py:146-170, 208). */
    function paramNamesOf(pMeta, sMeta, pHasVolfrac) {
        return Object.freeze(['scale', 'background']
            .concat(pMeta.params.map((p) => p.name))
            .concat(sListOf(sMeta, pHasVolfrac).map((p) => p.name))
            .concat([STRUCTURE_MODE_ID, RADIUS_MODE_ID]));
    }

    /** Destination of every accepted parameter name, *_pd names included. */
    function routesOf(pMeta, sMeta, pHasVolfrac) {
        const routes = new Map();
        const add = (param, to) => [param.name].concat(pdNames(param)).forEach((n) => routes.set(n, to));
        ['scale', 'background', STRUCTURE_MODE_ID, RADIUS_MODE_ID].forEach((n) => routes.set(n, TO_PRODUCT));
        pMeta.params.forEach((p) => add(p, TO_P));
        sListOf(sMeta, pHasVolfrac).forEach((p) => {
            // S.volfraction is replaced by volfraction*volume_ratio, so it is read here
            if (p.name === VOLFRAC_ID) routes.set(p.name, TO_PRODUCT);
            else add(p, p.name === RADIUS_ID ? TO_RADIUS : TO_S);
        });
        return routes;
    }

    /**
     * The value slices of ProductKernel.Iq (product.py:454-458, 485-493) as
     * parameter objects: P and S both get scale 1 and background 0. Leftover
     * names raise as in get_mesh (direct_model.py:121-122).
     */
    function splitPars(routes, name, pars) {
        const out = { [TO_P]: { scale: 1, background: 0 }, [TO_S]: { scale: 1, background: 0 }, [TO_RADIUS]: {} };
        const unused = [];
        Object.keys(pars).forEach((key) => {
            const to = routes.get(key);
            if (to === undefined) unused.push(key);
            else if (to !== TO_PRODUCT) out[to][key] = pars[key];
        });
        if (unused.length > 0) {
            throw new Error('Unused parameters in call to ' + name + ': ' + unused.join(', '));
        }
        return out;
    }

    /** product.py:521-532: PS = Fsq + F^2 (S - 1) in beta mode, else Fsq*S. */
    function combine(fq, S, betaMode, combinedScale, background) {
        const out = new Float64Array(S.length);
        for (let i = 0; i < S.length; i++) {
            const ps = betaMode ? fq.F2[i] + fq.F1[i] * fq.F1[i] * (S[i] - 1) : fq.F2[i] * S[i];
            out[i] = combinedScale * ps + background;
        }
        return out;
    }

    /**
     * create(pMeta, sMeta, pKernel, sKernel) -> { name, paramNames, Iq, parts }
     *   Iq(q, pars, { cutoff })    -> Float64Array, ProductKernel.Iq
     *   parts(q, pars, { cutoff }) -> { Iq, S, radiusEffective, shellVolume, volumeRatio }
     * radiusEffective is what P returned, so it is 0 in radius_effective_mode 0.
     */
    function create(pMeta, sMeta, pKernel, sKernel) {
        assertComposition(pMeta, sMeta);
        assertKernel(pKernel, pMeta, 'P');
        assertKernel(sKernel, sMeta, 'S');
        const name = pMeta.name + '@' + sMeta.name;
        const pHasVolfrac = hasParam(pMeta, VOLFRAC_ID);
        const routes = routesOf(pMeta, sMeta, pHasVolfrac);
        const volfracDefault = (pHasVolfrac ? pMeta : sMeta).params.find((p) => p.name === VOLFRAC_ID).def;

        /** ProductKernel.Iq (product.py:430-549). cutoff is validated by the kernels. */
        function parts(q, pars, opts) {
            if (pars === null || typeof pars !== 'object') throw new Error('pars must be an object');
            const cutoff = opts ? opts.cutoff : undefined;
            const split = splitPars(routes, name, pars);
            const scale = readNumber(pars, 'scale', DEFAULTS.scale);
            const background = readNumber(pars, 'background', DEFAULTS.background);
            const volfrac = readNumber(pars, VOLFRAC_ID, volfracDefault);
            const erMode = Math.trunc(readNumber(pars, RADIUS_MODE_ID, DEFAULTS[RADIUS_MODE_ID]));
            const betaMode = readNumber(pars, STRUCTURE_MODE_ID, DEFAULTS[STRUCTURE_MODE_ID]) > 0;
            readNumber(pars, RADIUS_ID, 0);   // type check even when P's value replaces it
            const fq = pKernel.Fq(q, split[TO_P], { cutoff, radiusEffectiveMode: erMode });
            // R_eff from P is monodisperse; S sees the volume fraction enclosed by the shape
            const radius = erMode > 0 ? { [RADIUS_ID]: fq.radiusEffective } : split[TO_RADIUS];
            const sPars = Object.assign({}, split[TO_S], radius, { [VOLFRAC_ID]: volfrac * fq.volumeRatio });
            const S = sKernel.Iq(q, sPars, { cutoff });
            // P with its own volfraction is already on absolute scale (product.py:529-531)
            let combinedScale = scale / fq.shellVolume;
            if (!pHasVolfrac) combinedScale *= volfrac;
            return Object.freeze({
                Iq: combine(fq, S, betaMode, combinedScale, background),
                S,
                radiusEffective: fq.radiusEffective,
                shellVolume: fq.shellVolume,
                volumeRatio: fq.volumeRatio,
            });
        }

        const Iq = (q, pars, opts) => parts(q, pars, opts).Iq;

        return Object.freeze({ name, paramNames: paramNamesOf(pMeta, sMeta, pHasVolfrac), Iq, parts });
    }

    globalThis.SasFitProduct = Object.freeze({ create });
})();
