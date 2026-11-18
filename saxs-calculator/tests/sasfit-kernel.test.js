'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitMeta, SasFitKernel } = require('./load.js');
const { loadFixture, assertClose, loadWasm } = require('./sasfit-helpers.js');

const fq = loadFixture('fq');
const g1 = loadFixture('g1');
const kernelArgs = loadFixture('kernel-args');
const VALUES_ALIGN = 32;
const PD_STEP = 100;
const G1_PLAIN_C_CASES = 82;   // 13 defaults + 68 single-parameter pd + 1 two-parameter pd

const isPlainC = (c) => c.modelSpec.structure === null && !c.modelSpec.lowQPowerLaw
    && SasFitMeta.models[c.modelSpec.model].kind === 'c';
const g1Plain = g1.cases.filter(isPlainC);
const cModels = SasFitMeta.order.filter((name) => SasFitMeta.models[name].kind === 'c');

const exportsCache = new Map();
function wasmExports(model) {
    if (!exportsCache.has(model)) exportsCache.set(model, SasFitKernel.instantiate(loadWasm(model)));
    return exportsCache.get(model);
}
async function kernelFor(model) {
    return SasFitKernel.create(SasFitMeta.models[model], await wasmExports(model));
}
const TWO_PD = Object.freeze({
    radius_pd: 0.15, radius_pd_n: 15, radius_pd_nsigma: 3, radius_pd_type: 'gaussian',
    length_pd: 0.2, length_pd_n: 15, length_pd_nsigma: 3, length_pd_type: 'gaussian',
});

test('instantiate resolves the wasm exports of every C model', async () => {
    assert.equal(cModels.length, 13);
    for (const name of cModels) {
        const ex = await wasmExports(name);
        assert.equal(typeof ex[name + '_Iq'], 'function', name);
        assert.equal(typeof ex.malloc, 'function', name);
        assert.equal(typeof ex.free, 'function', name);
        assert.ok(ex.memory instanceof WebAssembly.Memory, name);
    }
});

test('fq fixture has the expected shape', () => {
    assert.equal(fq.cases.length, 38);
    assert.equal(fq.q.length, 100);
});

let fqRan = 0;
fq.cases.forEach((c) => {
    test('Fq matches sasmodels call_Fq: ' + c.label, async () => {
        const kernel = await kernelFor(c.model);
        const got = kernel.Fq(Float64Array.from(fq.q), c.pars,
            { cutoff: c.cutoff, radiusEffectiveMode: c.radiusEffectiveMode });
        assertClose(got.F1, c.F1, c.label + ' F1');
        assertClose(got.F2, c.F2, c.label + ' F2');
        assertClose([got.radiusEffective], [c.radiusEffective], c.label + ' radiusEffective');
        assertClose([got.shellVolume], [c.shellVolume], c.label + ' shellVolume');
        assertClose([got.volumeRatio], [c.volumeRatio], c.label + ' volumeRatio');
        fqRan += 1;
    });
});

test('every fq case was exercised', () => {
    assert.equal(fqRan, 38);
});

let g1Ran = 0;
g1Plain.forEach((c) => {
    test('Iq matches sasmodels DirectModel: ' + c.label, async () => {
        const kernel = await kernelFor(c.modelSpec.model);
        const got = kernel.Iq(Float64Array.from(g1.q), c.pars, { cutoff: g1.cutoff });
        assert.ok(got instanceof Float64Array);
        assertClose(got, c.Iq, c.label);
        g1Ran += 1;
    });
});

test('every plain C-kernel g1 case was exercised', () => {
    assert.equal(g1.q.length, 200);
    assert.equal(g1Plain.length, G1_PLAIN_C_CASES);
    assert.equal(g1Ran, g1Plain.length);
    const models = new Set(g1Plain.map((c) => c.modelSpec.model));
    assert.deepEqual([...models].sort(), [...cModels].sort());
});

test('models without F(q) return F1 null', async () => {
    const kernel = await kernelFor('lamellar');
    assert.equal(SasFitMeta.models.lamellar.haveFq, false);
    const got = kernel.Fq(Float64Array.from(g1.q), {}, { cutoff: 0, radiusEffectiveMode: 0 });
    assert.equal(got.F1, null);
    assert.equal(got.F2.length, g1.q.length);
});

test('details length is 4*maxPd+4 and values are padded to a multiple of 32', () => {
    const parSets = [{}, { radius_pd: 0.2, radius_pd_n: 80, radius_pd_nsigma: 3, radius_pd_type: 'schulz' }];
    for (const name of cModels) {
        const meta = SasFitMeta.models[name];
        const hasRadius = meta.params.some((p) => p.name === 'radius' && p.pd);
        for (const pars of hasRadius ? parSets : [{}]) {
            const args = SasFitKernel.makeKernelArgs(meta, pars);
            assert.ok(args.details instanceof Int32Array);
            assert.ok(args.values instanceof Float64Array);
            assert.equal(args.details.length, 4 * meta.layout.maxPd + 4, name);
            assert.equal(args.values.length % VALUES_ALIGN, 0, name);
            const used = meta.layout.nvalues + 2 * args.numWeights;
            assert.ok(args.values.length >= used && args.values.length - used < VALUES_ALIGN, name);
        }
    }
});

test('kernel-args fixture has the expected cases', () => {
    assert.equal(kernelArgs.cases.length, 9);
    const labels = kernelArgs.cases.map((c) => c.label);
    for (const needed of ['cylinder radius n35 length n35 (tie)', 'cylinder radius n35 length n15',
        'core_shell_cylinder radius n20 thickness n35 length n20']) {
        assert.ok(labels.includes(needed), needed);
    }
});

kernelArgs.cases.forEach((c) => {
    test('details and values equal sasmodels make_kernel_args: ' + c.label, () => {
        const got = SasFitKernel.makeKernelArgs(SasFitMeta.models[c.model], c.pars);
        assert.deepEqual(Array.from(got.details), c.details);
        assert.equal(got.numEval, c.numEval);
        assert.equal(got.numWeights, c.numWeights);
        assertClose(got.values, c.values, c.label + ' values');
        const scalars = SasFitMeta.models[c.model].layout.nvalues;
        assert.deepEqual(Array.from(got.values.subarray(0, scalars)), c.values.slice(0, scalars));
        assert.deepEqual(Array.from(got.values, (v) => v === 0), c.values.map((v) => v === 0));
    });
});

test('details and values follow the sasmodels layout (cylinder)', () => {
    const meta = SasFitMeta.models.cylinder;
    const mono = SasFitKernel.makeKernelArgs(meta, {});
    // pd_par, pd_length, pd_offset, pd_stride, num_eval, num_weights, num_active, theta_par
    assert.deepEqual(Array.from(mono.details),
        [5, 4, 3, 2, 1, 1, 1, 1, 5, 4, 3, 2, 1, 1, 1, 1, 1, 6, 0, 4]);
    // scale, background, sld, sld_solvent, radius, length, theta, phi,
    // up_frac_i, up_frac_f, up_theta, up_phi, 2 x (M0, mtheta, mphi),
    // one dispersity per kernel parameter (orientation -> 0), one weight each, padding
    assert.deepEqual(Array.from(mono.values), [
        1, 0.001, 4, 1, 20, 400, 60, 60, 0, 0, 90, 0, 0, 0, 0, 0, 0, 0,
        4, 1, 20, 400, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0]);

    const two = SasFitKernel.makeKernelArgs(meta, TWO_PD);
    assert.deepEqual(Array.from(two.details),
        [3, 2, 5, 4, 15, 15, 1, 1, 17, 2, 33, 32, 1, 15, 225, 225, 225, 34, 2, 4]);
    assert.equal(two.numEval, 225);
    assert.equal(two.numWeights, 34);
    assert.equal(two.values.length, 96);   // 18 + 2*34 = 86 -> 96
});

test('a polydisperse width or count of zero keeps the parameter monodisperse', () => {
    const meta = SasFitMeta.models.sphere;
    const mono = Array.from(SasFitKernel.makeKernelArgs(meta, {}).values);
    const noCount = SasFitKernel.makeKernelArgs(meta, { radius_pd: 0.2 });
    const noWidth = SasFitKernel.makeKernelArgs(meta, { radius_pd_n: 35, radius_pd_type: 'schulz' });
    assert.deepEqual(Array.from(noCount.values), mono);
    assert.deepEqual(Array.from(noWidth.values), mono);
    assert.equal(noCount.numEval, 1);
});

test('the pd mesh is evaluated in chunks of 100 points', async () => {
    const ex = await wasmExports('cylinder');
    const calls = [];
    const counting = Object.assign({}, ex, {
        cylinder_Iq(nq, start, stop, ...rest) {
            calls.push([start, stop]);
            return ex.cylinder_Iq(nq, start, stop, ...rest);
        },
    });
    const kernel = SasFitKernel.create(SasFitMeta.models.cylinder, counting);
    const c = g1Plain.find((k) => k.label === 'cylinder radius+length gaussian n15');
    assert.deepEqual(c.pars, TWO_PD);
    const got = kernel.Iq(Float64Array.from(g1.q), c.pars, { cutoff: g1.cutoff });
    assert.deepEqual(calls, [[0, PD_STEP], [PD_STEP, 2 * PD_STEP], [2 * PD_STEP, 225]]);
    assertClose(got, c.Iq, c.label + ' (counting exports)');

    calls.length = 0;
    kernel.Iq(Float64Array.from(g1.q), {}, { cutoff: g1.cutoff });
    assert.deepEqual(calls, [[0, 1]]);
});

test('200 calls neither grow the wasm memory nor leak a buffer', async () => {
    const ex = await wasmExports('core_shell_cylinder');
    const kernel = SasFitKernel.create(SasFitMeta.models.core_shell_cylinder, ex);
    const q = Float64Array.from(g1.q);
    const pars = { radius_pd: 0.15, radius_pd_n: 35, radius_pd_nsigma: 3, radius_pd_type: 'gaussian' };
    const first = kernel.Iq(q, pars, { cutoff: 1e-5 });
    const bytes = ex.memory.buffer.byteLength;
    const probe = ex.malloc(64);
    ex.free(probe);
    let last = first;
    for (let i = 0; i < 200; i++) {
        last = i % 2 === 0 ? kernel.Iq(q, pars, { cutoff: 1e-5 })
            : kernel.Fq(q, pars, { cutoff: 1e-5, radiusEffectiveMode: 1 }).F2;
    }
    assert.equal(ex.memory.buffer.byteLength, bytes);
    const again = ex.malloc(64);
    ex.free(again);
    assert.equal(again, probe, 'allocator returns the same block when nothing leaked');
    assert.deepEqual(Array.from(kernel.Iq(q, pars, { cutoff: 1e-5 })), Array.from(first));
    assert.equal(last.length, q.length);
});

test('buffers are freed when the kernel call throws', async () => {
    const ex = await wasmExports('sphere');
    const failing = Object.assign({}, ex, { sphere_Iq() { throw new Error('boom'); } });
    const kernel = SasFitKernel.create(SasFitMeta.models.sphere, failing);
    const probe = ex.malloc(64);
    ex.free(probe);
    assert.throws(() => kernel.Iq(Float64Array.from(g1.q), {}, { cutoff: 0 }), /boom/);
    const again = ex.malloc(64);
    ex.free(again);
    assert.equal(again, probe);
});

test('q and pars are not modified', async () => {
    const kernel = await kernelFor('cylinder');
    const q = Float64Array.from(g1.q);
    const qCopy = Float64Array.from(q);
    const pars = Object.freeze(Object.assign({ scale: 2, background: 0.5, radius: 25 }, TWO_PD));
    const parsCopy = JSON.stringify(pars);
    kernel.Iq(q, pars, { cutoff: 1e-5 });
    kernel.Fq(q, pars, { cutoff: 1e-5, radiusEffectiveMode: 1 });
    assert.deepEqual(q, qCopy);
    assert.equal(JSON.stringify(pars), parsCopy);
    const plain = kernel.Iq(Array.from(q), pars, { cutoff: 1e-5 });
    assert.deepEqual(Array.from(plain), Array.from(kernel.Iq(q, pars, { cutoff: 1e-5 })));
});

test('Iq applies scale and background outside the kernel', async () => {
    const kernel = await kernelFor('sphere');
    const q = Float64Array.from(g1.q);
    const base = kernel.Iq(q, { scale: 1, background: 0 }, { cutoff: 0 });
    const got = kernel.Iq(q, { scale: 3, background: 0.25 }, { cutoff: 0 });
    assertClose(got, Array.from(base, (v) => 3 * v + 0.25), 'scale/background');
});

test('unknown parameter names throw an Error naming them', async () => {
    const kernel = await kernelFor('sphere');
    const q = Float64Array.from(g1.q);
    assert.throws(() => kernel.Iq(q, { radius: 40, nope: 1 }, { cutoff: 0 }), /nope/);
    assert.throws(() => kernel.Iq(q, { sld_pd: 0.1 }, { cutoff: 0 }), /sld_pd/);
    assert.throws(() => kernel.Fq(q, { radius_effective_mode: 1 }, { cutoff: 0, radiusEffectiveMode: 1 }),
        /radius_effective_mode/);
    assert.throws(() => SasFitKernel.makeKernelArgs(SasFitMeta.models.sphere, { lenght: 3 }), /lenght/);
});

test('invalid inputs fail fast', async () => {
    const kernel = await kernelFor('sphere');
    const q = Float64Array.from(g1.q);
    assert.throws(() => kernel.Fq(q, {}, { cutoff: 0 }), /radiusEffectiveMode/);
    assert.throws(() => kernel.Fq(q, {}, { cutoff: 0, radiusEffectiveMode: 1.5 }), /radiusEffectiveMode/);
    assert.throws(() => kernel.Iq(q, {}, { cutoff: -1 }), /cutoff/);
    assert.throws(() => kernel.Iq(q, {}), /cutoff is required/);
    assert.throws(() => kernel.Iq(q, {}, {}), /cutoff is required/);
    assert.throws(() => kernel.Iq(q, {}, { cutoff: '0' }), /cutoff/);
    assert.throws(() => kernel.Iq(q, {}, { cutoff: Infinity }), /cutoff/);
    assert.throws(() => kernel.Fq(q, {}, { radiusEffectiveMode: 1 }), /cutoff is required/);
    assert.throws(() => kernel.Iq(q, { radius: '50' }, { cutoff: 0 }), /radius/);
    assert.throws(() => kernel.Iq('q', {}, { cutoff: 0 }), /q/);
    assert.throws(() => kernel.Iq(q, { radius_pd: 0.1, radius_pd_n: 35, radius_pd_type: 'nope' }, { cutoff: 0 }),
        /nope/);
    assert.throws(() => SasFitKernel.create(SasFitMeta.models.power_law, {}), /power_law/);
    assert.throws(() => SasFitKernel.create(SasFitMeta.models.sphere, {}), /sphere_Iq/);
    await assert.rejects(SasFitKernel.instantiate('not bytes'), /bytes/);
});

test('too many polydisperse parameters is rejected like make_details', () => {
    const meta = SasFitMeta.models.sphere;
    const squeezed = Object.assign({}, meta, { layout: Object.assign({}, meta.layout, { maxPd: 0 }) });
    const pars = { radius_pd: 0.1, radius_pd_n: 35 };
    assert.throws(() => SasFitKernel.makeKernelArgs(squeezed, pars), /Too many polydisperse parameters/);
});

test('sasfit-kernel.js has no browser or Node I/O dependencies', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-kernel.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['window', 'document', 'fetch', 'require', 'XMLHttpRequest']) {
        assert.ok(!new RegExp('\\b' + banned + '\\b').test(code), banned);
    }
    assert.ok(src.split('\n').length <= 800);
    assert.match(src, /Copyright \(c\) 2009-2022, SasView Developers -- BSD 3-Clause,\s+\* see wasm\/LICENSE-sasmodels\.txt/);
});
