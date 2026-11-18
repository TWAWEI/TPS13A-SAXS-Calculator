/**
 * sasfit-py-models.js -- the two sasmodels models that are written in Python
 * and therefore have no WebAssembly kernel: guinier_porod and power_law.
 *
 * Ported from sasmodels 1.0.12:
 *   models/guinier_porod.py  Iq
 *   models/power_law.py      Iq
 *   kernelpy.py              PyKernel, _loops (monodisperse path)
 *   kernel.py                Kernel.Fq, Kernel.Iq (scale and background)
 * Copyright (c) 2009-2022, SasView Developers -- BSD 3-Clause,
 * see wasm/LICENSE-sasmodels.txt
 *
 * Pure computation, usable in a Web Worker and in Node; no inputs are mutated.
 * Iq(q, pars) returns scale*Iq + background, the same level as
 * SasFitKernel's kernel.Iq.
 *
 * Why there is no dispersity loop and no volume normalisation: neither model
 * has a polydisperse parameter, so _loops always takes its num_active == 0
 * branch (kernelpy.py:225-229) with weight_norm = 1, and neither defines
 * form_volume, so form and shell volume are both 1.0 (kernelpy.py:175-177).
 * Kernel.Iq (kernel.py:94-98) then reduces to scale*Iq + background.
 *
 * Deliberate deviations from the sasmodels source:
 *   - Parameter values must be numbers (sasmodels applies float()).
 *   - There is no cutoff option: with no dispersity mesh it has no effect.
 */

(function () {
    'use strict';

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    function checkQ(q) {
        const ok = Array.isArray(q) || q instanceof Float64Array;
        if (!ok || !Array.prototype.every.call(q, (v) => typeof v === 'number')) {
            throw new Error('q must be a Float64Array or an array of numbers');
        }
    }

    function readNumber(pars, name, fallback) {
        if (!has(pars, name)) return fallback;
        const v = pars[name];
        if (typeof v !== 'number') {
            throw new Error('Parameter ' + name + ' must be a number, got ' + typeof v);
        }
        return v;
    }

    /** get_mesh raises on leftovers (direct_model.py:121-122). */
    function assertNoUnusedPars(meta, pars) {
        const known = new Set(['scale', 'background'].concat(meta.params.map((p) => p.name)));
        const unused = Object.keys(pars).filter((k) => !known.has(k));
        if (unused.length > 0) {
            throw new Error('Unused parameters in call to ' + meta.name + ': ' + unused.join(', '));
        }
    }

    /**
     * guinier_porod.Iq (guinier_porod.py:101-120). Returns zeros when rg <= 0
     * or porod_exp <= s; q = 0 gives inf for s > 0, as in numpy.
     */
    function guinierPorod(q, rg, s, porodExp) {
        const n = 3.0 - s;
        const ms = 0.5 * (porodExp - s);
        const iq = new Float64Array(q.length);
        if (rg <= 0.0 || ms <= 0.0) return iq;
        const q1 = Math.sqrt(n * ms) / rg;
        const porodScale = Math.exp(-ms) * Math.pow(n * ms / (rg * rg), ms);
        for (let i = 0; i < q.length; i++) {
            const qi = q[i];
            if (qi < q1) {
                const qr = qi * rg;
                iq[i] = Math.pow(qi, -s) * Math.exp(-(qr * qr) / n);
            } else {
                iq[i] = Math.pow(qi, -porodExp) * porodScale;
            }
        }
        return iq;
    }

    /** power_law.Iq (power_law.py:49-53): q**-power; q = 0 gives inf for power > 0. */
    function powerLaw(q, power) {
        const iq = new Float64Array(q.length);
        for (let i = 0; i < q.length; i++) iq[i] = Math.pow(q[i], -power);
        return iq;
    }

    /** Kernel form functions, called with the kernel parameters in meta order. */
    const FORMS = Object.freeze({ guinier_porod: guinierPorod, power_law: powerLaw });

    function modelMeta(name) {
        const meta = globalThis.SasFitMeta && globalThis.SasFitMeta.models[name];
        if (!meta || meta.kind !== 'js') throw new Error('No python-model metadata for ' + name);
        return meta;
    }

    /**
     * PyKernel through Kernel.Iq: form() is the whole result (weight 1, form
     * and shell volume 1), so I = scale/1 * Iq/1 + background.
     */
    function makeModel(name) {
        const form = FORMS[name];
        function Iq(q, pars) {
            checkQ(q);
            if (pars === null || typeof pars !== 'object') throw new Error('pars must be an object');
            const meta = modelMeta(name);
            assertNoUnusedPars(meta, pars);
            const scale = readNumber(pars, 'scale', meta.common.scale.def);
            const background = readNumber(pars, 'background', meta.common.background.def);
            const args = meta.params.map((p) => readNumber(pars, p.name, p.def));
            return form(q, ...args).map((v) => scale * v + background);
        }
        return Object.freeze({ name, Iq });
    }

    const models = Object.freeze({
        guinier_porod: makeModel('guinier_porod'),
        power_law: makeModel('power_law'),
    });

    globalThis.SasFitPyModels = Object.freeze({ models });
})();
