'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitMeta, SasFitKernel, SasFitProduct } = require('./load.js');
const { loadFixture, assertClose, assertCloseRel, loadWasm } = require('./sasfit-helpers.js');

const g1 = loadFixture('g1');
// 2 defaults + 24 structure-factor-mode + 28 effective-radius-mode + 1 vesicle with its own
// volfraction + 3 with a polydisperse S.radius_effective ("spd:")
const G1_PRODUCT_CASES = 58;
const G1_GROUPS = Object.freeze({ default: 2, sfmode: 24, reff: 28, vesicle: 1, spd: 3 });
// P@S is gated in two layers (see assertCloseRel in sasfit-helpers.js): components and the
// composition with the reference R_eff injected at 1e-9, the end-to-end curve at 1e-7.
const END_TO_END_REL = 1e-7;
// core_shell_cylinder@hardsphere reff mode 3: R_eff from sasmodels, and the worst point (index 5)
const ILL_CONDITIONED = Object.freeze({ radiusEffective: 39.94281915922375, volfraction: 0.2, qIndex: 5 });
const S_CAPABLE = Object.freeze(
    ['sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder', 'core_shell_cylinder']);
const STRUCTURES = Object.freeze(['hardsphere', 'hayter_msa']);
const SCHULZ = Object.freeze(
    { radius_pd: 0.2, radius_pd_n: 80, radius_pd_nsigma: 3, radius_pd_type: 'schulz' });
const CUT = Object.freeze({ cutoff: g1.cutoff });

const isProduct = (c) => c.modelSpec.structure !== null && !c.modelSpec.lowQPowerLaw;
const g1Product = g1.cases.filter(isProduct);
const q = Float64Array.from(g1.q);

function groupOf(label) {
    if (/^spd: /.test(label)) return 'spd';
    if (/ default$/.test(label)) return 'default';
    if (/ sfmode [01] /.test(label)) return 'sfmode';
    if (/ reff mode \d+$/.test(label)) return 'reff';
    if (/own volfraction/.test(label)) return 'vesicle';
    return 'unknown';
}

const exportsCache = new Map();
function wasmExports(model) {
    if (!exportsCache.has(model)) exportsCache.set(model, SasFitKernel.instantiate(loadWasm(model)));
    return exportsCache.get(model);
}
async function kernelFor(model) {
    return SasFitKernel.create(SasFitMeta.models[model], await wasmExports(model));
}
async function productFor(p, s) {
    return SasFitProduct.create(SasFitMeta.models[p], SasFitMeta.models[s],
        await kernelFor(p), await kernelFor(s));
}

test('g1 has the expected P@S cases', () => {
    assert.equal(g1Product.length, G1_PRODUCT_CASES);
    const groups = { default: 0, sfmode: 0, reff: 0, vesicle: 0, spd: 0 };
    g1Product.forEach((c) => {
        const group = groupOf(c.label);
        assert.ok(group in groups, 'unclassified case ' + c.label);
        groups[group] += 1;
    });
    assert.deepEqual(groups, G1_GROUPS);
    assert.deepEqual([...new Set(g1Product.map((c) => c.modelSpec.model))].sort(), [...S_CAPABLE].sort());
    assert.deepEqual([...new Set(g1Product.map((c) => c.modelSpec.structure))].sort(), [...STRUCTURES]);
});

/**
 * The same case with the reference R_eff injected: radius_effective_mode 0 and
 * radius_effective = the value sasmodels evaluated S with. This is the same
 * computation: the mode only switches the R_eff accumulation of P
 * (kernel_iq.c:732-733; F, F^2 and the volumes do not depend on it), and S
 * gets either P's value as a length-1 distribution (product.py:480-483,
 * 506-509) or the parameter value (product.py:488). A radius_effective
 * distribution given together with a mode > 0 is ignored by sasmodels, so it
 * is removed here; in mode 0 it stays.
 */
function withReferenceRadius(c) {
    const mode = 'radius_effective_mode' in c.pars ? c.pars.radius_effective_mode : 1;
    const entries = Object.entries(c.pars)
        .filter(([key]) => mode === 0 || !key.startsWith('radius_effective_pd'));
    return Object.assign(Object.fromEntries(entries),
        { radius_effective_mode: 0, radius_effective: c.intermediates.radiusEffectiveUsed });
}

const ran = { components: 0, composition: 0, endToEnd: 0 };
g1Product.forEach((c) => {
    test('P@S components match sasmodels (1e-9): ' + c.label, async () => {
        const product = await productFor(c.modelSpec.model, c.modelSpec.structure);
        const parts = product.parts(q, c.pars, CUT);
        const ref = c.intermediates;
        assertClose([parts.radiusEffective], [ref.radiusEffectiveP], c.label + ' radiusEffective');
        assertClose([parts.volumeRatio], [ref.volumeRatio], c.label + ' volumeRatio');
        assertClose([parts.shellVolume], [ref.shellVolume], c.label + ' shellVolume');
        ran.components += 1;
    });

    test('P@S composition and S(q) with the reference R_eff match sasmodels (1e-9): ' + c.label, async () => {
        const product = await productFor(c.modelSpec.model, c.modelSpec.structure);
        const parts = product.parts(q, withReferenceRadius(c), CUT);
        assert.ok(parts.Iq instanceof Float64Array);
        assertClose(parts.S, c.intermediates.S, c.label + ' S(q)');
        assertClose(parts.Iq, c.Iq, c.label + ' I(q)');
        ran.composition += 1;
    });

    test('P@S end to end matches sasmodels (1e-7): ' + c.label, async () => {
        const product = await productFor(c.modelSpec.model, c.modelSpec.structure);
        const got = product.Iq(q, c.pars, CUT);
        assert.ok(got instanceof Float64Array);
        assertCloseRel(got, c.Iq, c.label, END_TO_END_REL);
        ran.endToEnd += 1;
    });
});

test('every P@S g1 case was exercised in all three layers', () => {
    assert.deepEqual(ran, { components: g1Product.length, composition: g1Product.length,
        endToEnd: g1Product.length });
    assert.equal(ran.endToEnd, G1_PRODUCT_CASES);
    g1Product.forEach((c) => {
        assert.equal(c.intermediates.S.length, g1.q.length, c.label);
        const mode = 'radius_effective_mode' in c.pars ? c.pars.radius_effective_mode : 1;
        assert.equal(c.intermediates.radiusEffectiveP === 0, mode === 0, c.label);
    });
});

test('withReferenceRadius drops a radius_effective distribution only when sasmodels ignores it', () => {
    const spd = g1Product.filter((c) => groupOf(c.label) === 'spd');
    const kept = spd.filter((c) => 'radius_effective_pd' in withReferenceRadius(c));
    assert.deepEqual(kept.map((c) => c.pars.radius_effective_mode), [0, 0]);
    const dropped = spd.filter((c) => !('radius_effective_pd' in withReferenceRadius(c)));
    assert.deepEqual(dropped.map((c) => c.pars.radius_effective_mode), [1]);
    assert.ok(Object.keys(dropped[0].pars).some((k) => k.startsWith('radius_effective_pd')));
});

/** The next representable double above a positive finite x. */
function nextUp(x) {
    const bits = new BigUint64Array(1);
    const view = new Float64Array(bits.buffer);
    view[0] = x;
    bits[0] += 1n;
    return view[0];
}

test('hardsphere S(q) is ill-conditioned just above its Taylor cutoff (why end to end is 1e-7)', async () => {
    const sKernel = await kernelFor('hardsphere');
    const { radiusEffective, volfraction, qIndex } = ILL_CONDITIONED;
    const at = [g1.q[qIndex]];
    const X = 2 * at[0] * radiusEffective;
    assert.ok(X > 0.05 && X < 0.13, '2qR = ' + X + ' is in the cancellation band of hardsphere.c');
    const up = nextUp(radiusEffective);
    assert.ok(up > radiusEffective && (up - radiusEffective) / radiusEffective < 2.3e-16);
    const S = (r) => sKernel.Iq(at, { scale: 1, background: 0, radius_effective: r, volfraction }, CUT)[0];
    const change = Math.abs(S(up) - S(radiusEffective)) / S(radiusEffective);
    // 2.3e-9 measured in native sasmodels as well: a 1-ulp input change exceeds the 1e-9 rule
    assert.ok(change > 1e-10 && change < 1e-7, 'relative change of S for a 1-ulp change of R_eff: ' + change);
    const c = g1Product.find((k) => k.label === 'core_shell_cylinder@hardsphere reff mode 3');
    assert.equal(c.intermediates.radiusEffectiveUsed, radiusEffective);
});

test('paramNames follow the product.py order', async () => {
    const sphereMsa = await productFor('sphere', 'hayter_msa');
    assert.deepEqual(sphereMsa.paramNames, ['scale', 'background', 'sld', 'sld_solvent', 'radius',
        'radius_effective', 'volfraction', 'charge', 'temperature', 'concentration_salt', 'dielectconst',
        'structure_factor_mode', 'radius_effective_mode']);
    assert.ok(Object.isFrozen(sphereMsa.paramNames));
    assert.ok(Object.isFrozen(sphereMsa));
    assert.equal(sphereMsa.name, 'sphere@hayter_msa');

    const vesicleHs = await productFor('vesicle', 'hardsphere');
    assert.deepEqual(vesicleHs.paramNames, ['scale', 'background', 'sld', 'sld_solvent', 'volfraction',
        'radius', 'thickness', 'radius_effective', 'structure_factor_mode', 'radius_effective_mode']);
    assert.equal(vesicleHs.paramNames.filter((n) => n === 'volfraction').length, 1);
    assert.ok(!vesicleHs.paramNames.some((n) => /_S$/.test(n)));
});

test('every S-capable model combines with both structure factors', async () => {
    for (const p of S_CAPABLE) {
        for (const s of STRUCTURES) {
            const product = await productFor(p, s);
            const names = product.paramNames;
            assert.equal(new Set(names).size, names.length, p + '@' + s + ' has duplicate names');
            assert.deepEqual(names.slice(-2), ['structure_factor_mode', 'radius_effective_mode']);
            assert.deepEqual(names.slice(0, 2), ['scale', 'background']);
        }
    }
});

test('models that cannot take S(Q) are rejected with the reason', async () => {
    const hs = await kernelFor('hardsphere');
    const meta = SasFitMeta.models;
    const cannot = SasFitMeta.order.filter((n) => !S_CAPABLE.includes(n));
    assert.equal(cannot.length, 9);
    for (const name of cannot) {
        const pKernel = meta[name].kind === 'c' ? await kernelFor(name) : hs;
        assert.throws(() => SasFitProduct.create(meta[name], meta.hardsphere, pKernel, hs),
            new RegExp(name + ' cannot take a structure factor'), name);
    }
    assert.throws(() => SasFitProduct.create(meta.lamellar, meta.hardsphere, hs, hs), /no F\(q\)/);
    assert.throws(() => SasFitProduct.create(meta.lamellar, meta.hardsphere, hs, hs),
        /no effective radius modes/);
    // mono_gauss_coil has effective radius modes but no F(q)
    assert.throws(() => SasFitProduct.create(meta.mono_gauss_coil, meta.hardsphere, hs, hs),
        (err) => /no F\(q\)/.test(err.message) && !/effective radius/.test(err.message));
});

test('S must be a structure factor and the kernels must match the metas', async () => {
    const meta = SasFitMeta.models;
    const sphere = await kernelFor('sphere');
    const hs = await kernelFor('hardsphere');
    assert.throws(() => SasFitProduct.create(meta.sphere, meta.cylinder, sphere, sphere),
        /cylinder is not a structure factor/);
    assert.throws(() => SasFitProduct.create(meta.sphere, meta.hardsphere, hs, hs), /kernel/);
    assert.throws(() => SasFitProduct.create(meta.sphere, meta.hardsphere, sphere, {}), /kernel/);
    assert.throws(() => SasFitProduct.create(meta.sphere, meta.hardsphere, null, hs), /kernel/);
    const noRadius = Object.assign({}, meta.hardsphere, { params: meta.hardsphere.params.slice(1) });
    assert.throws(() => SasFitProduct.create(meta.sphere, noRadius, sphere, hs),
        /radius_effective and volfraction as its first parameters/);
    const withReff = Object.assign({}, meta.sphere,
        { params: meta.sphere.params.concat(meta.hardsphere.params[0]) });
    assert.throws(() => SasFitProduct.create(withReff, meta.hardsphere, sphere, hs),
        /P should not have radius_effective/);
});

test('defaults: scale 1, background 0.001, modes 0 and 1, P and S parameter defaults', async () => {
    const product = await productFor('sphere', 'hayter_msa');
    const explicit = { scale: 1, background: 0.001, sld: 1, sld_solvent: 6, radius: 50,
        radius_effective: 20.75, volfraction: 0.0192, charge: 19, temperature: 318.16,
        concentration_salt: 0, dielectconst: 71.08, structure_factor_mode: 0, radius_effective_mode: 1 };
    assert.deepEqual(Object.keys(explicit), product.paramNames);
    assert.deepEqual(Array.from(product.Iq(q, {}, CUT)), Array.from(product.Iq(q, explicit, CUT)));

    const vesicle = await productFor('vesicle', 'hardsphere');
    assert.deepEqual(Array.from(vesicle.Iq(q, {}, CUT)),
        Array.from(vesicle.Iq(q, { volfraction: 0.05, radius_effective: 50 }, CUT)));
});

test('Iq is P and S combined as in ProductKernel.Iq (P*S and beta)', async () => {
    const pKernel = await kernelFor('core_shell_sphere');
    const sKernel = await kernelFor('hardsphere');
    const product = await productFor('core_shell_sphere', 'hardsphere');
    const shape = Object.assign({ thickness: 15 }, SCHULZ);
    for (const beta of [0, 1]) {
        const pars = Object.assign({ scale: 0.7, background: 0.02, volfraction: 0.3,
            structure_factor_mode: beta, radius_effective_mode: 2 }, shape);
        const fq = pKernel.Fq(q, shape, { cutoff: g1.cutoff, radiusEffectiveMode: 2 });
        const sPars = { scale: 1, background: 0, radius_effective: fq.radiusEffective,
            volfraction: 0.3 * fq.volumeRatio };
        const S = sKernel.Iq(q, sPars, CUT);
        const combined = 0.7 / fq.shellVolume * 0.3;
        const expected = Array.from(q, (_, i) => combined
            * (beta ? fq.F2[i] + fq.F1[i] * fq.F1[i] * (S[i] - 1) : fq.F2[i] * S[i]) + 0.02);
        assert.deepEqual(Array.from(product.Iq(q, pars, CUT)), expected);

        const parts = product.parts(q, pars, CUT);
        assert.ok(Object.isFrozen(parts));
        assert.deepEqual(Array.from(parts.Iq), expected);
        assert.deepEqual(Array.from(parts.S), Array.from(S));
        assert.equal(parts.radiusEffective, fq.radiusEffective);
        assert.equal(parts.volumeRatio, fq.volumeRatio);
        assert.equal(parts.shellVolume, fq.shellVolume);
    }
});

test('a hollow shape scales the volume fraction seen by S and keeps its own out of the scale', async () => {
    const pKernel = await kernelFor('vesicle');
    const sKernel = await kernelFor('hardsphere');
    const product = await productFor('vesicle', 'hardsphere');
    const pPars = Object.assign({ volfraction: 0.08 }, SCHULZ);
    const fq = pKernel.Fq(q, pPars, { cutoff: g1.cutoff, radiusEffectiveMode: 1 });
    assert.ok(fq.volumeRatio > 1, 'vesicle form:shell volume ratio');
    const S = sKernel.Iq(q, { scale: 1, background: 0, radius_effective: fq.radiusEffective,
        volfraction: 0.08 * fq.volumeRatio }, CUT);
    const expected = Array.from(q, (_, i) => 2 / fq.shellVolume * (fq.F2[i] * S[i]) + 0.001);
    assert.deepEqual(Array.from(product.Iq(q, Object.assign({ scale: 2 }, pPars), CUT)), expected);
});

test('radius_effective_mode 0 uses the given radius_effective; other modes ignore it', async () => {
    const product = await productFor('sphere', 'hardsphere');
    const at = (pars) => Array.from(product.Iq(q, Object.assign({}, SCHULZ, pars), CUT));
    assert.notDeepEqual(at({ radius_effective_mode: 0, radius_effective: 40 }),
        at({ radius_effective_mode: 0, radius_effective: 60 }));
    assert.deepEqual(at({ radius_effective_mode: 0 }), at({ radius_effective_mode: 0, radius_effective: 50 }));
    assert.deepEqual(at({ radius_effective_mode: 1, radius_effective: 40 }), at({ radius_effective: 60 }));
    assert.equal(product.parts(q, { radius_effective_mode: 0 }, CUT).radiusEffective, 0);
    // int() and "> 0" as in product.py:437-440
    assert.deepEqual(at({ radius_effective_mode: 1.9 }), at({ radius_effective_mode: 1 }));
    assert.deepEqual(at({ structure_factor_mode: 0.5 }), at({ structure_factor_mode: 1 }));
    assert.deepEqual(at({ structure_factor_mode: -1 }), at({ structure_factor_mode: 0 }));
    assert.notDeepEqual(at({ structure_factor_mode: 1 }), at({ structure_factor_mode: 0 }));
    assert.throws(() => product.Iq(q, { radius_effective_mode: 2 }, CUT), /radiusEffectiveMode/);
    assert.throws(() => product.Iq(q, { radius_effective_mode: -1 }, CUT), /radiusEffectiveMode/);
});

test('polydisperse S radius_effective (hayter_msa) is averaged by S in mode 0 and ignored otherwise', async () => {
    const pKernel = await kernelFor('sphere');
    const sKernel = await kernelFor('hayter_msa');
    const product = await productFor('sphere', 'hayter_msa');
    const sPd = { radius_effective_pd: 0.15, radius_effective_pd_n: 35, radius_effective_pd_nsigma: 3,
        radius_effective_pd_type: 'gaussian' };
    const mono = Array.from(product.Iq(q, { radius_effective_mode: 0 }, CUT));
    const poly = Array.from(product.Iq(q, Object.assign({ radius_effective_mode: 0 }, sPd), CUT));
    assert.notDeepEqual(poly, mono);
    const fq = pKernel.Fq(q, {}, { cutoff: g1.cutoff, radiusEffectiveMode: 0 });
    const S = sKernel.Iq(q, Object.assign({ scale: 1, background: 0, radius_effective: 20.75,
        volfraction: 0.0192 * fq.volumeRatio }, sPd), CUT);
    const combined = 1 / fq.shellVolume * 0.0192;
    assert.deepEqual(poly, Array.from(q, (_, i) => combined * (fq.F2[i] * S[i]) + 0.001));

    assert.deepEqual(Array.from(product.Iq(q, Object.assign({ radius_effective_mode: 1 }, sPd), CUT)),
        Array.from(product.Iq(q, { radius_effective_mode: 1 }, CUT)));
    const hs = await productFor('sphere', 'hardsphere');
    assert.throws(() => hs.Iq(q, { radius_effective_pd: 0.1 }, CUT), /radius_effective_pd/);
});

test('q and pars are not modified', async () => {
    const product = await productFor('cylinder', 'hayter_msa');
    const qCopy = Float64Array.from(q);
    const pars = Object.freeze(Object.assign({ scale: 2, background: 0.5, volfraction: 0.1, charge: 10,
        structure_factor_mode: 1, radius_effective_mode: 3 }, SCHULZ));
    const parsCopy = JSON.stringify(pars);
    const got = product.Iq(q, pars, CUT);
    product.parts(q, pars, CUT);
    assert.deepEqual(q, qCopy);
    assert.equal(JSON.stringify(pars), parsCopy);
    assert.deepEqual(Array.from(product.Iq(Array.from(q), pars, CUT)), Array.from(got));
});

test('unknown parameter names throw an Error naming them', async () => {
    const product = await productFor('vesicle', 'hardsphere');
    assert.throws(() => product.Iq(q, { radius: 40, nope: 1 }, CUT), /nope/);
    assert.throws(() => product.Iq(q, { volfraction_S: 0.1 }, CUT), /volfraction_S/);
    assert.throws(() => product.Iq(q, { charge: 10 }, CUT), /charge/);
    assert.throws(() => product.Iq(q, { sld_pd: 0.1 }, CUT), /sld_pd/);
    assert.throws(() => product.Iq(q, { volfraction_pd: 0.1 }, CUT), /volfraction_pd/);
    assert.throws(() => product.Iq(q, { structure_factor_mode_pd: 0.1 }, CUT), /structure_factor_mode_pd/);
    assert.throws(() => product.Iq(q, { sld_M0: 1 }, CUT), /sld_M0/);
    assert.throws(() => product.Iq(q, { lowq_scale: 1 }, CUT), /lowq_scale/);
});

test('invalid inputs fail fast', async () => {
    const product = await productFor('sphere', 'hardsphere');
    assert.throws(() => product.Iq(q, {}), /cutoff is required/);
    assert.throws(() => product.Iq(q, {}, {}), /cutoff is required/);
    assert.throws(() => product.Iq(q, {}, { cutoff: -1 }), /cutoff/);
    assert.throws(() => product.Iq(q, null, CUT), /pars must be an object/);
    assert.throws(() => product.Iq('q', {}, CUT), /q must be/);
    for (const name of ['scale', 'background', 'radius', 'volfraction', 'radius_effective',
        'structure_factor_mode', 'radius_effective_mode']) {
        assert.throws(() => product.Iq(q, { [name]: '1' }, CUT), new RegExp(name + ' must be a number'), name);
    }
    assert.throws(() => product.Iq(q, { radius_effective_mode: NaN }, CUT), /radiusEffectiveMode/);
});

test('the kernels are reached only through the public Fq / Iq API', async () => {
    const calls = [];
    const pReal = await kernelFor('sphere');
    const sReal = await kernelFor('hardsphere');
    const spy = (kernel, tag) => Object.freeze({
        name: kernel.name,
        Fq: (...args) => { calls.push([tag + '.Fq', args[2]]); return kernel.Fq(...args); },
        Iq: (...args) => { calls.push([tag + '.Iq', args[2]]); return kernel.Iq(...args); },
    });
    const product = SasFitProduct.create(SasFitMeta.models.sphere, SasFitMeta.models.hardsphere,
        spy(pReal, 'P'), spy(sReal, 'S'));
    product.Iq(q, { radius_effective_mode: 0 }, { cutoff: 1e-4 });
    assert.deepEqual(calls, [['P.Fq', { cutoff: 1e-4, radiusEffectiveMode: 0 }], ['S.Iq', { cutoff: 1e-4 }]]);
});

test('sasfit-product.js has no browser or Node I/O dependencies', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-product.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['window', 'document', 'fetch', 'require', 'XMLHttpRequest', 'malloc', 'memory']) {
        assert.ok(!new RegExp('\\b' + banned + '\\b').test(code), banned);
    }
    assert.ok(src.split('\n').length <= 800);
    assert.match(src, /Copyright \(c\) 2009-2022, SasView Developers -- BSD 3-Clause,\s+\* see wasm\/LICENSE-sasmodels\.txt/);
});
