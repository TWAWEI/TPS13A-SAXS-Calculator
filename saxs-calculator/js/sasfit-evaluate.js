/**
 * sasfit-evaluate.js -- the single entry point of the SAS model computation.
 *
 *   SasFitEvaluate.evaluate(modelSpec, params, q, opts, kernels) -> { I, extras }
 *
 *   modelSpec  { model, structure: null | 'hardsphere' | 'hayter_msa', lowQPowerLaw: boolean }
 *              (structure and lowQPowerLaw may be left out: null and false)
 *   params     flat object: scale, background, the model parameters and their
 *              *_pd / *_pd_n / *_pd_nsigma / *_pd_type; with a structure also
 *              the S parameters, structure_factor_mode and radius_effective_mode;
 *              with lowQPowerLaw also lowq_scale and lowq_power. Anything left
 *              out takes the sasmodels default (so *_pd_n 0 = monodisperse; the
 *              UI defaults are the caller's business). Unknown names are an Error.
 *   q          Float64Array or array of numbers
 *   opts       { cutoff = 1e-5 }: dispersity-weight cutoff. This is the only
 *              place with a cutoff default; the kernels require it.
 *   kernels    { [modelName]: wasmExports } from SasFitKernel.instantiate, for
 *              every C model the spec names. The two JS models need none.
 *   I          Float64Array, scale and background included
 *   extras     P@S: { radiusEffective, volumeRatio, S } as P returned them
 *              (radiusEffective is 0 in radius_effective_mode 0, where S uses
 *              the radius_effective parameter); otherwise {}
 *
 * Dispatch: a C model goes to SasFitKernel, guinier_porod / power_law to
 * SasFitPyModels, model + structure to SasFitProduct (which owns the rule for
 * which models can take S(Q)).
 *
 * Low-Q power law (design spec 4.5): I_total = I_model + lowq_scale * q^-lowq_power,
 * with the model's background counted once. This equals the sasmodels sum
 * model "<model>+power_law" with outer scale 1, A_scale = scale,
 * B_scale = lowq_scale, B_power = lowq_power (mixture.py:216-235); only the
 * order of the two additions differs. Defaults: lowq_scale 0, lowq_power 4.
 *
 * Pure computation, usable in a Web Worker and in Node. No inputs are mutated
 * and there is no module state: the kernel and product objects are rebuilt on
 * every call. They are closures over the wasm exports, not buffers; measured
 * in Node 26 (arm64, 2026-11-18) a kernel takes 0.07 us and a product 3.6 us
 * to build, next to 43 us for the cheapest P@S evaluation of 400 points
 * (sphere@hardsphere, monodisperse) and 1.2 ms with an 80-point distribution.
 * Non-finite output (q = 0, NaN parameters) is returned as it is; judging it
 * is up to the caller.
 */

(function () {
    'use strict';

    const DEFAULT_CUTOFF = 1e-5;                 // design spec 4.2, decision 15
    const LOWQ_SCALE_ID = 'lowq_scale';
    const LOWQ_POWER_ID = 'lowq_power';
    const LOWQ_DEFAULTS = Object.freeze({ [LOWQ_SCALE_ID]: 0, [LOWQ_POWER_ID]: 4 });   // design spec 4.5
    const NO_EXTRAS = Object.freeze({});

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';

    function metaOf(name) {
        const models = globalThis.SasFitMeta.models;
        if (!has(models, name)) throw new Error('Unknown model: ' + name);
        return models[name];
    }

    /** Normalised copy of modelSpec: { model, structure, lowQPowerLaw }. */
    function readSpec(modelSpec) {
        if (!isObject(modelSpec)) throw new Error('modelSpec must be an object');
        const { model, structure = null, lowQPowerLaw = false } = modelSpec;
        if (typeof model !== 'string') throw new Error('modelSpec.model must be a model name');
        if (structure !== null && typeof structure !== 'string') {
            throw new Error('modelSpec.structure must be a model name or null');
        }
        if (typeof lowQPowerLaw !== 'boolean') throw new Error('modelSpec.lowQPowerLaw must be a boolean');
        return { model, structure, lowQPowerLaw };
    }

    function readCutoff(opts) {
        const cutoff = isObject(opts) && opts.cutoff !== undefined ? opts.cutoff : DEFAULT_CUTOFF;
        if (typeof cutoff !== 'number' || !(cutoff >= 0) || !Number.isFinite(cutoff)) {
            throw new Error('cutoff must be a finite number >= 0, got ' + cutoff);
        }
        return cutoff;
    }

    function readLowQ(params, name) {
        if (!has(params, name)) return LOWQ_DEFAULTS[name];
        const v = params[name];
        if (typeof v !== 'number') throw new Error('Parameter ' + name + ' must be a number, got ' + typeof v);
        return v;
    }

    /**
     * Split the flat parameters: the low-Q term (null without lowQPowerLaw) and
     * the rest, which the model rejects if it does not know a name. Without
     * lowQPowerLaw the lowq_* names stay in the rest and are rejected there.
     */
    function splitParams(params, lowQPowerLaw) {
        if (!isObject(params)) throw new Error('params must be an object');
        if (!lowQPowerLaw) return { modelPars: params, lowQ: null };
        const modelPars = {};
        Object.keys(params).forEach((key) => {
            if (key !== LOWQ_SCALE_ID && key !== LOWQ_POWER_ID) modelPars[key] = params[key];
        });
        const lowQ = { scale: readLowQ(params, LOWQ_SCALE_ID), power: readLowQ(params, LOWQ_POWER_ID) };
        return { modelPars, lowQ };
    }

    /** The SasFitKernel kernel of a C model; null for a JS model, which has none. */
    function kernelOf(meta, kernels) {
        if (meta.kind !== 'c') return null;
        if (!isObject(kernels)) throw new Error('kernels must be an object of wasm exports by model name');
        if (!has(kernels, meta.name) || !kernels[meta.name]) {
            throw new Error('No wasm kernel loaded for ' + meta.name);
        }
        return globalThis.SasFitKernel.create(meta, kernels[meta.name]);
    }

    function evaluatePlain(meta, pars, q, cutoff, kernels) {
        const kernel = kernelOf(meta, kernels);
        const I = kernel === null
            ? globalThis.SasFitPyModels.models[meta.name].Iq(q, pars)
            : kernel.Iq(q, pars, { cutoff });
        return { I, extras: NO_EXTRAS };
    }

    /**
     * P@S. SasFitProduct.create checks the composition (can P take S(Q), is S
     * a structure factor) before it looks at the kernels, so a JS model as P
     * is refused there with the same message as any other unsuitable P.
     */
    function evaluateProduct(pMeta, sMeta, pars, q, cutoff, kernels) {
        const product = globalThis.SasFitProduct.create(
            pMeta, sMeta, kernelOf(pMeta, kernels), kernelOf(sMeta, kernels));
        const parts = product.parts(q, pars, { cutoff });
        const extras = Object.freeze({
            radiusEffective: parts.radiusEffective, volumeRatio: parts.volumeRatio, S: parts.S,
        });
        return { I: parts.Iq, extras };
    }

    /** I + scale * q^-power on a new array (design spec 4.5). */
    function addPowerLaw(I, q, lowQ) {
        const out = new Float64Array(I.length);
        for (let i = 0; i < I.length; i++) out[i] = I[i] + lowQ.scale * Math.pow(q[i], -lowQ.power);
        return out;
    }

    function evaluate(modelSpec, params, q, opts, kernels) {
        const spec = readSpec(modelSpec);
        const meta = metaOf(spec.model);
        const sMeta = spec.structure === null ? null : metaOf(spec.structure);
        const cutoff = readCutoff(opts);
        const { modelPars, lowQ } = splitParams(params, spec.lowQPowerLaw);
        const base = sMeta === null
            ? evaluatePlain(meta, modelPars, q, cutoff, kernels)
            : evaluateProduct(meta, sMeta, modelPars, q, cutoff, kernels);
        const I = lowQ === null ? base.I : addPowerLaw(base.I, q, lowQ);
        return Object.freeze({ I, extras: base.extras });
    }

    globalThis.SasFitEvaluate = Object.freeze({ evaluate, DEFAULT_CUTOFF });
})();
