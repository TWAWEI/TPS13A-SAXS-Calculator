/**
 * sasfit-sq-derived.js -- two numbers the 3D sketch of a model with a
 * structure factor needs on the main thread (design spec 6; decision 43):
 * the effective radius the model hands to S(Q), and the Debye screening
 * length of hayter_msa.
 *
 * Ported from sasmodels 1.0.12: the radius_effective functions of
 * models/sphere.c, core_shell_sphere.c, vesicle.c, ellipsoid.c, cylinder.c and
 * core_shell_cylinder.c, their average over the dispersity mesh (kernel_iq.c,
 * kernel.py), and the Debye length of models/hayter_msa.c.
 * Copyright (c) 2009-2022, SasView Developers -- BSD 3-Clause,
 * see wasm/LICENSE-sasmodels.txt
 *
 *   radiusEffective(model, params, { cutoff }?) -> number (Angstrom) | null
 *       params: the flat parameters of SasFitJobs.params(form) -- the model's sizes, their <name>_pd,
 *       _pd_n, _pd_nsigma, _pd_type while a dispersity is open, radius_effective_mode and, in mode 0,
 *       radius_effective. Mode 0: the radius_effective parameter (what the user typed). Mode k >= 1: the
 *       model's k-th definition, averaged over the dispersity mesh exactly as the compute core does it --
 *       the weights of SasFitWeights.getWeights multiplied over the parameters, points with a weight
 *       product <= cutoff (default SasFitJobs.CUTOFF) left out, sum(w R) / sum(w). A missing size takes
 *       the model's default, as in the compute core. null for a model without effective-radius modes, an
 *       unknown mode or a size that is not a finite number.
 *   modeName(model, mode) -> '外半徑（outer radius）' | '自行輸入' (mode 0) | null
 *   debyeLength({ radiusEffective, volfraction, charge, temperature, salt, dielectric }) -> Angstrom | null
 *       kappa^-1 as hayter_msa.c computes it: ionic strength from the counter-ions of the particles
 *       (charge x volfraction / particle volume, monovalent) and a 1:1 salt (2 x salt in mol/L), with
 *       the same constants and the same order of operations (the result equals the C code bit for bit).
 *       null when it is not a finite positive length (no ions at all, a non-positive temperature,
 *       dielectric constant or radius, anything not finite).
 *
 * Pure: no DOM, no timers; SasFitMeta, SasFitWeights and SasFitJobs are read at call time. Nothing given
 * is modified.
 */

(function () {
    'use strict';

    // hayter_msa.c (sasmodels 1.0.12) lines 308-310, 328, and kernel_header.c's M_4PI_3
    const ELECTRON_CHARGE = 1.602189e-19;        // C
    const BOLTZMANN = 1.380662e-23;              // J/K
    const VACUUM_PERMITTIVITY = 8.85418782E-12;  // C^2 / (N m^2)
    const AVOGADRO = 6.022E23;
    const M_4PI_3 = 4.18879020478639;
    const ANGSTROM = 1.0E-10;                    // m
    const M_TO_ANGSTROM = 1.0E10;
    const LITRE_PER_M3 = 1.0E3;
    const USER_MODE = 0;
    const USER_MODE_NAME = '自行輸入';
    const PD_DEFAULTS = Object.freeze({ npts: 0, width: 0, nsigma: 3, type: 'gaussian' });      // as SasFitKernel reads them

    const cube = (x) => x * x * x;
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

    // ------------------------------------------------------------- the radius_effective functions of the C models

    function ellipsoidCurvature(polar, equatorial) {
        if (polar === equatorial) return polar;
        if (polar * equatorial === 0) return 0;
        const ratio = polar < equatorial ? polar / equatorial : equatorial / polar;       // Isihara, J. Chem. Phys. 18 (1950) eq. 26
        const e1 = Math.sqrt(1.0 - ratio * ratio);
        const b1 = 1.0 + Math.asin(e1) / (e1 * ratio);
        const bL = (1.0 + e1) / (1.0 - e1);
        const b2 = 1.0 + 0.5 * ratio * ratio / e1 * Math.log(bL);
        const delta = 0.75 * b1 * b2;
        const ddd = 2.0 * (delta + 1.0) * polar * equatorial * equatorial;
        return 0.5 * Math.cbrt(ddd);
    }

    const excludedVolume = (radius, length) => 0.5 * Math.cbrt(0.75 * radius * (2.0 * radius * length
        + (radius + length) * (Math.PI * radius + length)));

    const ELLIPSOID = [
        (p, e) => ellipsoidCurvature(p, e),
        (p, e) => Math.cbrt(p * e * e),
        (p, e) => (p < e ? p : e),
        (p, e) => (p > e ? p : e),
    ];
    const CYLINDER = [
        (r, l) => excludedVolume(r, l),
        (r, l) => Math.cbrt(Math.PI * r * r * l / M_4PI_3),
        (r) => r,
        (r, l) => 0.5 * l,
        (r, l) => (r < 0.5 * l ? r : 0.5 * l),
        (r, l) => (r > 0.5 * l ? r : 0.5 * l),
        (r, l) => Math.sqrt(r * r + 0.25 * l * l),
    ];
    const CORE_SHELL_CYLINDER = [
        (r, t, l) => excludedVolume(r + t, l + 2.0 * t),
        (r, t, l) => Math.cbrt(Math.PI * (r + t) * (r + t) * (l + 2.0 * t) / M_4PI_3),
        (r, t) => r + t,
        (r, t, l) => 0.5 * l + t,
        (r, t, l) => (r < 0.5 * l ? r + t : 0.5 * l + t),
        (r, t, l) => (r > 0.5 * l ? r + t : 0.5 * l + t),
        (r, t, l) => Math.sqrt((r + t) * (r + t) + 0.25 * (l + 2.0 * t) * (l + 2.0 * t)),
    ];
    /** model -> one function per mode (index mode - 1), taking the volume parameters in the order of the C signature */
    const RADII = Object.freeze({
        sphere: [(r) => r],
        core_shell_sphere: [(r, t) => r + t, (r) => r],
        vesicle: [(r, t) => r + t],
        ellipsoid: ELLIPSOID,
        cylinder: CYLINDER,
        core_shell_cylinder: CORE_SHELL_CYLINDER,
    });

    const MODE_ZH = Object.freeze({
        radius: '半徑', 'outer radius': '外半徑', 'core radius': '核半徑', 'average curvature': '平均曲率',
        'equivalent volume sphere': '等體積球', 'min radius': '最小半徑', 'max radius': '最大半徑',
        'excluded volume': '排除體積', 'half length': '長度的一半', 'half min dimension': '最小尺寸的一半',
        'half max dimension': '最大尺寸的一半', 'half diagonal': '對角線的一半', 'half outer length': '外長度的一半',
        'half min outer dimension': '外部最小尺寸的一半', 'half max outer dimension': '外部最大尺寸的一半',
        'half outer diagonal': '外部對角線的一半',
    });

    // ------------------------------------------------------------- the dispersity mesh

    const metaOf = (model) => (has(globalThis.SasFitMeta.models, model) ? globalThis.SasFitMeta.models[model] : null);

    /** { x, w } of one volume parameter, as SasFitKernel's parWeights reads it; null when its value is not finite. */
    function pointsOf(param, params) {
        const value = has(params, param.name) ? params[param.name] : param.def;
        if (!isNumber(value)) return null;
        const read = (suffix, fallback) => (has(params, param.name + suffix) ? params[param.name + suffix] : fallback);
        const npts = read('_pd_n', PD_DEFAULTS.npts);
        const width = read('_pd', PD_DEFAULTS.width);
        if (!param.pd || npts === 0 || width === 0) return { x: [value], w: [1] };
        const nsigma = read('_pd_nsigma', PD_DEFAULTS.nsigma);
        const type = read('_pd_type', PD_DEFAULTS.type);
        return globalThis.SasFitWeights.getWeights(type, value, width, npts, nsigma, param.min, param.max, param.relativePd);
    }

    /** sum(w R(x)) / sum(w) over the product mesh, w > cutoff only (kernel_iq.c; kernel.py: an empty sum counts as 1). */
    function meshAverage(lists, radius, cutoff) {
        const at = lists.map(() => 0);
        const values = lists.map((list) => list.x[0]);
        let [sum, norm] = [0, 0];
        for (;;) {
            const weight = lists.reduce((product, list, k) => product * list.w[at[k]], 1);
            if (weight > cutoff) {
                sum += weight * radius(...values);
                norm += weight;
            }
            let k = lists.length - 1;
            while (k >= 0 && at[k] === lists[k].x.length - 1) { at[k] = 0; values[k] = lists[k].x[0]; k -= 1; }
            if (k < 0) break;
            at[k] += 1;
            values[k] = lists[k].x[at[k]];
        }
        return sum / (norm === 0 ? 1 : norm);
    }

    function radiusEffective(model, params, options) {
        const meta = metaOf(model);
        if (meta === null || !has(RADII, model) || !isObject(params)) return null;
        const mode = params.radius_effective_mode;
        if (mode === USER_MODE) return isNumber(params.radius_effective) ? params.radius_effective : null;
        if (!Number.isInteger(mode) || mode < 1 || mode > RADII[model].length) return null;
        const lists = meta.params.filter((param) => param.type === 'volume').map((param) => pointsOf(param, params));
        if (lists.some((list) => list === null || list.x.length === 0)) return null;
        const cutoff = isObject(options) && isNumber(options.cutoff) ? options.cutoff : globalThis.SasFitJobs.CUTOFF;
        const value = meshAverage(lists, RADII[model][mode - 1], cutoff);
        return isNumber(value) ? value : null;
    }

    function modeName(model, mode) {
        if (mode === USER_MODE) return USER_MODE_NAME;
        const meta = metaOf(model);
        if (meta === null || !Number.isInteger(mode) || mode < 1 || mode > meta.reffModes.length) return null;
        const name = meta.reffModes[mode - 1];
        return (has(MODE_ZH, name) ? MODE_ZH[name] : name) + '（' + name + '）';
    }

    // ------------------------------------------------------------- hayter_msa.c: the Debye length

    function debyeLength(input) {
        if (!isObject(input)) return null;
        const { radiusEffective: radius, volfraction, charge, temperature, salt, dielectric } = input;
        if (![radius, volfraction, charge, temperature, salt, dielectric].every(isNumber)) return null;
        if (radius <= 0 || temperature <= 0 || dielectric <= 0 || volfraction < 0 || salt < 0) return null;
        const beta = 1.0 / (BOLTZMANN * temperature);
        const perm = dielectric * VACUUM_PERMITTIVITY;
        const siDiam = 2 * radius * ANGSTROM;
        const vp = M_4PI_3 * cube(siDiam / 2.0);
        const cs = salt * AVOGADRO * LITRE_PER_M3;
        const ionic = 0.5 * ELECTRON_CHARGE * ELECTRON_CHARGE * (charge * volfraction / vp + 2.0 * cs);
        const kappa = Math.sqrt(2 * beta * ionic / perm);
        if (!isNumber(kappa) || kappa <= 0) return null;
        return M_TO_ANGSTROM / kappa;
    }

    globalThis.SasFitSqDerived = Object.freeze({ radiusEffective, modeName, debyeLength });
})();
