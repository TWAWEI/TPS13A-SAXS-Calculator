'use strict';
/**
 * sasfit-sq-derived.js：結構因子示意圖要的兩個數（v5.8，規格 §6、決策 43）——
 *   radiusEffective：與 sasmodels 1.0.12 的 radius_effective（含多分散平均）相同，以本站 wasm 核心回報的值為準逐一比對；
 *   debyeLength：hayter_msa.c 的 κ⁻¹，以 tools/sasfit/build/hayter_msa.c 的原式編成 C 程式算出的值釘住（逐位元相同）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitSqDerived: D, SasFitKernel, SasFitEvaluate, SasFitMeta, SasFitJobs, SasFitForm } = require('./load.js');
const { loadWasm } = require('./sasfit-helpers.js');

const MODELS = ['sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder', 'core_shell_cylinder'];
const KERNELS = MODELS.concat(['hardsphere']);
const Q = Float64Array.of(0.01);
const CUT = Object.freeze({ cutoff: SasFitJobs.CUTOFF });
const REL = 1e-12;

let kernelsPromise = null;
function loadKernels() {
    if (!kernelsPromise) {
        kernelsPromise = Promise.all(KERNELS.map((name) => SasFitKernel.instantiate(loadWasm(name))))
            .then((list) => Object.freeze(Object.fromEntries(KERNELS.map((name, i) => [name, list[i]]))));
    }
    return kernelsPromise;
}

/** The volume parameters of a model (the arguments of its radius_effective, in order). */
const volumeNames = (model) => SasFitMeta.models[model].params.filter((p) => p.type === 'volume').map((p) => p.name);

/** Off-default sizes, so that a mode that returns a single dimension cannot agree by accident. */
const SIZES = {
    sphere: { radius: 43 }, core_shell_sphere: { radius: 37, thickness: 11 }, vesicle: { radius: 80, thickness: 25 },
    ellipsoid: { radius_polar: 30, radius_equatorial: 120 }, cylinder: { radius: 25, length: 180 },
    core_shell_cylinder: { radius: 18, thickness: 7, length: 150 },
};
const pd = (type, width, npts, nsigma) => ({ type, width, npts, nsigma });
/** Dispersity settings: none, one on the first size, one on the last, and every size at once. */
function dispersities(model) {
    const names = volumeNames(model);
    return [
        {},
        { [names[0]]: pd('gaussian', 0.1, 35, 3) },
        { [names[names.length - 1]]: pd('lognormal', 0.15, 80, 3) },
        Object.fromEntries(names.map((name, i) => [name, [pd('schulz', 0.2, 40, 3), pd('rectangle', 0.1, 21, 1.73205), pd('boltzmann', 0.1, 25, 3)][i]])),
    ];
}

function paramsOf(model, mode, spread) {
    const flat = { ...SIZES[model], radius_effective_mode: mode, volfraction: 0.2, radius_effective: 50 };
    Object.entries(spread).forEach(([name, d]) => {
        Object.assign(flat, { [name + '_pd']: d.width, [name + '_pd_n']: d.npts, [name + '_pd_nsigma']: d.nsigma, [name + '_pd_type']: d.type });
    });
    if (model === 'vesicle') delete flat.volfraction;          // vesicle brings its own volfraction (SasFitProduct)
    return flat;
}

test('[sq-derived] radiusEffective = the R_eff the wasm kernel reports (every mode of the six models, with and without dispersity)', async () => {
    const kernels = await loadKernels();
    let compared = 0;
    for (const model of MODELS) {
        const modes = SasFitMeta.models[model].reffModes.length;
        assert.ok(modes >= 1, model);
        for (let mode = 1; mode <= modes; mode++) {
            for (const spread of dispersities(model)) {
                const params = paramsOf(model, mode, spread);
                const spec = { model, structure: 'hardsphere', lowQPowerLaw: false };
                const kernel = SasFitEvaluate.evaluate(spec, params, Q, CUT, kernels).extras.radiusEffective;
                const ours = D.radiusEffective(model, params);
                const label = `${model} mode ${mode} ${JSON.stringify(spread)}`;
                assert.ok(Number.isFinite(kernel) && kernel > 0, label + ': kernel ' + kernel);
                assert.ok(Math.abs(ours - kernel) <= REL * kernel, `${label}: ${ours} vs kernel ${kernel}`);
                compared += 1;
            }
        }
    }
    assert.equal(compared, 4 * (1 + 2 + 1 + 4 + 7 + 7));
});

test('[sq-derived] radiusEffective: mode 0 is the radius_effective parameter; shape-less models, unknown modes and bad input give null', () => {
    assert.equal(D.radiusEffective('sphere', { radius: 43, radius_effective_mode: 0, radius_effective: 61.5 }), 61.5);
    assert.equal(D.radiusEffective('sphere', { radius: 43, radius_effective_mode: 0 }), null);
    assert.equal(D.radiusEffective('guinier', { rg: 60, radius_effective_mode: 1 }), null);
    assert.equal(D.radiusEffective('flexible_cylinder', { length: 1000, kuhn_length: 100, radius: 20, radius_effective_mode: 1 }), null);
    assert.equal(D.radiusEffective('sphere', { radius: 43, radius_effective_mode: 2 }), null, 'sphere has one mode');
    assert.equal(D.radiusEffective('sphere', { radius: NaN, radius_effective_mode: 1 }), null);
    assert.equal(D.radiusEffective('sphere', null), null);
    assert.equal(D.radiusEffective('cylinder', { radius: 25, radius_effective_mode: 4 }), 200, 'a missing size takes the default (length 400), as in the compute core');
});

test('[sq-derived] radiusEffective of a page form (SasFitJobs.params): the ellipsoid default with S(Q) is 270.7 Å (規格 §16)', () => {
    let form = SasFitForm.reduce(SasFitForm.create('ellipsoid'), { type: 'setStructure', structure: 'hardsphere' });
    const params = SasFitJobs.params(form);
    assert.ok(Math.abs(D.radiusEffective('ellipsoid', params) - 270.7) < 0.05);
    form = SasFitForm.reduce(SasFitForm.create('core_shell_sphere'), { type: 'setStructure', structure: 'hayter_msa' });
    assert.equal(D.radiusEffective('core_shell_sphere', SasFitJobs.params(form)), 70, 'outer radius 60 + 10');
});

test('[sq-derived] modeName: the Chinese name of an effective-radius mode, the sasmodels name next to it; mode 0 is user-entered', () => {
    assert.equal(D.modeName('core_shell_sphere', 1), '外半徑（outer radius）');
    assert.equal(D.modeName('core_shell_sphere', 2), '核半徑（core radius）');
    assert.equal(D.modeName('cylinder', 1), '排除體積（excluded volume）');
    assert.equal(D.modeName('ellipsoid', 2), '等體積球（equivalent volume sphere）');
    assert.equal(D.modeName('sphere', 0), '自行輸入');
    MODELS.forEach((model) => SasFitMeta.models[model].reffModes.forEach((name, i) => {
        const zh = D.modeName(model, i + 1);
        assert.ok(zh.endsWith('（' + name + '）') && /[一-鿿]/.test(zh), model + ' ' + name + ': ' + zh);
    }));
    assert.equal(D.modeName('sphere', 5), null);
});

// tools/sasfit/build/hayter_msa.c lines 308-337 compiled with cc -ffp-contract=off, printed with %.17g (2026-11-24)
const DEBYE_C = [
    [{ radiusEffective: 20.75, volfraction: 0.0192, charge: 19, temperature: 318.16, salt: 0, dielectric: 71.08 }, 33.238762420080157],
    [{ radiusEffective: 50, volfraction: 0.0192, charge: 19, temperature: 318.16, salt: 0, dielectric: 71.08 }, 124.32907434300296],
    [{ radiusEffective: 70, volfraction: 0.0192, charge: 19, temperature: 318.16, salt: 0, dielectric: 71.08 }, 205.95140248819612],
    [{ radiusEffective: 25, volfraction: 0.15, charge: 12, temperature: 298.15, salt: 0.1, dielectric: 78.4 }, 8.674292022143657],
];

test('[sq-derived] debyeLength: κ⁻¹ of hayter_msa.c, bit for bit with the C code (defaults: 33.24 Å; counter-ions and salt both count)', () => {
    DEBYE_C.forEach(([input, expected]) => assert.equal(D.debyeLength(input), expected, JSON.stringify(input)));
    const base = DEBYE_C[0][0];
    assert.ok(D.debyeLength({ ...base, salt: 0.1 }) < D.debyeLength(base) / 3, 'salt screens');
    assert.ok(D.debyeLength({ ...base, temperature: 400 }) > D.debyeLength(base), 'warmer: longer');
});

test('[sq-derived] debyeLength: null when it is not a finite positive length (no ions at all, bad input)', () => {
    const base = DEBYE_C[0][0];
    assert.equal(D.debyeLength({ ...base, charge: 0, salt: 0 }), null, 'no counter-ions and no salt: nothing screens');
    [['radiusEffective', 0], ['temperature', 0], ['dielectric', 0], ['volfraction', -1], ['salt', NaN], ['charge', Infinity]].forEach(([key, value]) => {
        assert.equal(D.debyeLength({ ...base, [key]: value }), null, key + ' ' + value);
    });
    assert.equal(D.debyeLength(null), null);
});

test('[sq-derived] module: frozen, pure (no DOM, no Math.random), the C constants', () => {
    assert.ok(Object.isFrozen(D));
    assert.deepEqual(Object.keys(D).sort(), ['debyeLength', 'modeName', 'radiusEffective']);
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'sasfit-sq-derived.js'), 'utf8');
    assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|Math\.random|setTimeout/);
    assert.match(source, /1\.602189e-19/);
    assert.match(source, /4\.18879020478639\b/);
});
