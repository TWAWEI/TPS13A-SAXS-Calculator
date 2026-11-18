'use strict';
/**
 * sasfit-jobs.js: the evaluate / fit requests built from the model form
 * (design spec 4.9, 4.10, 12; plan M3 Task 6). The requests are handed to the
 * real compute core (wasm) and to SasFitWorkerCore, not only compared by shape.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitJobs: J, SasFitForm: F, SasFitMeta: M, SasFitEvaluate: E, SasFitWeighting: W, SasFitState: S,
} = require('./load.js');
const { loadKernels, makeCore } = require('./sasfit-fit-helpers.js');

const MODELS = M.order.filter((name) => !M.models[name].isStructureFactor);
const WITH_S = MODELS.filter((name) => F.canTakeStructure(name));
const Q = Float64Array.from({ length: 12 }, (_, i) => 0.01 * Math.pow(1.36, i));      // 0.01 .. 0.29
const PD_KEYS = ['_pd', '_pd_n', '_pd_nsigma', '_pd_type'];

const run = (form, ...actions) => actions.reduce((f, a) => F.reduce(f, a), form);
const setValue = (name, value) => ({ type: 'setValue', name, value });
const pdField = (name, field, value) => ({ type: 'setPdField', name, field, value });
const isDeepFrozen = (o) => o === null || typeof o !== 'object' || ArrayBuffer.isView(o)
    || (Object.isFrozen(o) && Object.values(o).every(isDeepFrozen));
const allFinite = (values) => values.every(Number.isFinite);
const differs = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-9 * Math.abs(b[i]));

/** Every dispersity of the form opened: width 0.1, 5 points (a small mesh keeps the sweep fast). */
function openAllPds(form) {
    return Object.keys(form.pds).reduce((f, name) => run(f,
        { type: 'togglePd', name }, pdField(name, 'width', '0.1'), pdField(name, 'npts', '5')), form);
}

function dataset(q, I, sigma) {
    return Object.freeze({
        fileName: 'synthetic.dat', kind: 'generic', header: null, q: Float64Array.from(q), I: Float64Array.from(I),
        sigma: sigma === null ? null : Float64Array.from(sigma), dq: null, condition: null, qUnit: 'A',
    });
}

async function evaluate(form, q) {
    return E.evaluate(J.modelSpec(form), J.params(form), q || Q, { cutoff: J.CUTOFF }, await loadKernels()).I;
}

test('module is frozen; constants of the plan', () => {
    assert.ok(Object.isFrozen(J));
    assert.equal(J.CUTOFF, 1e-5);
    assert.equal(J.CUTOFF, E.DEFAULT_CUTOFF);
    assert.equal(J.PREVIEW_BUDGET, 150000);
    assert.equal(J.PREVIEW_PAUSE_COST, 1300000);
    assert.equal(J.PREVIEW_MIN_POINTS, 50);
});

test('modelSpec(form)', () => {
    assert.deepEqual({ ...J.modelSpec(F.create('sphere')) }, { model: 'sphere', structure: null, lowQPowerLaw: false });
    const form = run(F.create('vesicle'), { type: 'setStructure', structure: 'hayter_msa' }, { type: 'setLowQ', on: true });
    assert.deepEqual({ ...J.modelSpec(form) }, { model: 'vesicle', structure: 'hayter_msa', lowQPowerLaw: true });
    assert.ok(Object.isFrozen(J.modelSpec(form)));
});

test('params(form): numbers of the visible rows; nothing of a closed dispersity; no mode keys without S', () => {
    const p = J.params(F.create('sphere'));
    assert.deepEqual({ ...p }, { scale: 1, background: 0.001, sld: 1, sld_solvent: 6, radius: 50 });
    assert.ok(Object.isFrozen(p));
    const cyl = J.params(F.create('cylinder'));
    assert.equal('theta' in cyl || 'phi' in cyl, false);
    assert.equal(Object.keys(cyl).some((k) => k.indexOf('_pd') >= 0 || k.indexOf('_mode') >= 0), false);
    assert.deepEqual({ ...J.params(run(F.create('guinier'), { type: 'setLowQ', on: true })) },
        { scale: 1, background: 0.001, rg: 60, lowq_scale: 0, lowq_power: 4 });
});

test('params(form): an open dispersity ALWAYS sends its four keys, with the UI defaults', () => {
    const open = run(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    const p = J.params(open);
    assert.deepEqual(PD_KEYS.map((k) => p['radius' + k]), [0, 35, 3, 'gaussian']);
    const schulz = J.params(run(open, pdField('radius', 'type', 'schulz'), pdField('radius', 'width', '0.2')));
    assert.equal(schulz.radius_pd, 0.2);
    assert.equal(schulz.radius_pd_n, 80);
    assert.equal(schulz.radius_pd_nsigma, 3, 'not the sasmodels default of 8');
    assert.equal(schulz.radius_pd_type, 'schulz');
    const uniform = J.params(run(open, pdField('radius', 'type', 'uniform'), pdField('radius', 'nsigmas', 'junk')));
    assert.deepEqual(PD_KEYS.map((k) => uniform['radius' + k]), [0, 35, F.PD_NSIGMAS_UNUSED, 'uniform']);
    const closed = J.params(run(open, pdField('radius', 'width', '0.2'), { type: 'togglePd', name: 'radius' }));
    assert.equal(Object.keys(closed).some((k) => k.indexOf('_pd') >= 0), false);
});

test('params(form): with S both mode keys are always there; a model-defined radius_effective is not sent', () => {
    const form = run(F.create('sphere'), { type: 'setStructure', structure: 'hardsphere' });
    const p = J.params(form);
    assert.equal(p.structure_factor_mode, 0);
    assert.equal(p.radius_effective_mode, 1);
    assert.equal('radius_effective' in p, false);
    assert.equal(p.volfraction, 0.2);
    const free = J.params(run(form, { type: 'setRadiusMode', mode: 0 }, { type: 'setStructureMode', mode: 1 }));
    assert.equal(free.structure_factor_mode, 1);
    assert.equal(free.radius_effective_mode, 0);
    assert.equal(free.radius_effective, 50);
    const vesicle = J.params(run(F.create('vesicle'), { type: 'setStructure', structure: 'hardsphere' }));
    assert.equal(vesicle.volfraction, M.models.vesicle.params.find((x) => x.name === 'volfraction').def);
    assert.equal(Object.keys(vesicle).filter((k) => k === 'volfraction').length, 1);
});

test('params(form): an invalid form is an Error naming the field', () => {
    assert.throws(() => J.params(run(F.create('sphere'), setValue('radius', 'abc'))), /radius\.value/);
});

test('compute core accepts the params of every model, low-Q on / off, dispersities closed / open', async () => {
    let count = 0;
    for (const model of MODELS) {
        for (const lowQ of [false, true]) {
            for (const pd of [false, true]) {
                let form = run(F.create(model), { type: 'setLowQ', on: lowQ });
                if (lowQ) form = run(form, setValue('lowq_scale', '1e-6'));
                if (pd) form = openAllPds(form);
                const label = model + (lowQ ? ' +lowQ' : '') + (pd ? ' +pd' : '');
                const I = await evaluate(form);
                assert.ok(allFinite(I), label + ': ' + Array.from(I).join(' '));
                count += 1;
            }
        }
    }
    assert.equal(count, 13 * 4);
});

test('compute core accepts the params of every allowed P@S combination (all modes, low-Q, dispersities)', async () => {
    let count = 0;
    for (const model of WITH_S) {
        const radiusModes = M.models[model].reffModes.length + 1;
        for (const structure of F.STRUCTURES) {
            for (let radiusMode = 0; radiusMode < radiusModes; radiusMode++) {
                for (const structureMode of [0, 1]) {
                    for (const [lowQ, pd] of [[false, false], [true, false], [false, true], [true, true]]) {
                        let form = run(F.create(model), { type: 'setStructure', structure },
                            { type: 'setRadiusMode', mode: radiusMode }, { type: 'setStructureMode', mode: structureMode },
                            { type: 'setLowQ', on: lowQ });
                        if (pd) form = openAllPds(form);
                        const label = [model, structure, 'rm' + radiusMode, 'sm' + structureMode, lowQ, pd].join(' ');
                        const params = J.params(form);
                        assert.equal(params.structure_factor_mode, structureMode, label);
                        assert.equal(params.radius_effective_mode, radiusMode, label);
                        assert.equal('radius_effective' in params, radiusMode === 0, label);
                        const I = await evaluate(form);
                        assert.ok(allFinite(I), label + ': ' + Array.from(I).join(' '));
                        count += 1;
                    }
                }
            }
        }
    }
    // radius modes incl. 0: sphere 2, core_shell_sphere 3, vesicle 2, ellipsoid 5, cylinder 8, core_shell_cylinder 8
    assert.equal(count, 28 * 2 * 2 * 4);
});

test('every distribution type of the form is accepted and changes I', async () => {
    const mono = await evaluate(F.create('sphere'));
    for (const type of F.PD_TYPES) {
        const form = run(F.create('sphere'), { type: 'togglePd', name: 'radius' },
            pdField('radius', 'type', type), pdField('radius', 'width', '0.15'));
        const I = await evaluate(form);
        assert.ok(allFinite(I), type);
        assert.ok(differs(I, mono), type + ' has no effect');
    }
});

test('the mode keys take effect: structure mode 1 and radius mode 0 each change I', async () => {
    for (const model of WITH_S) {
        for (const structure of F.STRUCTURES) {
            const pdName = Object.keys(F.create(model).pds)[0];
            // beta(q) is 1 for a monodisperse sphere: a size distribution makes the two structure modes differ
            const base = run(F.create(model), { type: 'setStructure', structure }, { type: 'togglePd', name: pdName },
                pdField(pdName, 'width', '0.2'), pdField(pdName, 'npts', '9'));
            const label = model + '@' + structure;
            const I0 = await evaluate(base);
            const beta = await evaluate(run(base, { type: 'setStructureMode', mode: 1 }));
            assert.ok(differs(beta, I0), label + ': structure_factor_mode 1 has no effect');
            // radius_effective 111 is used only in mode 0: without the mode key the core would stay in mode 1
            const free = run(base, { type: 'setRadiusMode', mode: 0 }, setValue('radius_effective', '111'));
            assert.ok(differs(await evaluate(free), I0), label + ': radius_effective_mode 0 has no effect');
            const { radius_effective_mode: dropped, ...withoutKey } = J.params(free);
            assert.equal(dropped, 0);
            const defaulted = E.evaluate(J.modelSpec(free), withoutKey, Q, { cutoff: J.CUTOFF }, await loadKernels()).I;
            assert.equal(differs(defaulted, I0), false, label + ': without the key the core stays in mode 1');
        }
    }
});

test('previewGrid(): 200 log-spaced points 1e-3 .. 1, a new array each time', () => {
    const g = J.previewGrid();
    assert.ok(g instanceof Float64Array);
    assert.equal(g.length, 200);
    assert.equal(g[0], 1e-3);
    assert.ok(Math.abs(g[199] - 1) < 1e-15);
    assert.ok(Math.abs(g[100] / g[99] - Math.pow(10, 3 / 199)) < 1e-12);
    assert.notEqual(J.previewGrid(), g);
});

test('previewRequest without data: the default grid, index 0..199, nothing decimated', async () => {
    const form = F.create('sphere');
    const r = J.previewRequest(form, null);
    assert.deepEqual([...r.q], [...J.previewGrid()]);
    assert.deepEqual([...r.index], Array.from({ length: 200 }, (_, i) => i));
    assert.ok(r.index instanceof Uint32Array);
    assert.deepEqual({ ...r.modelSpec }, { ...J.modelSpec(form) });
    assert.deepEqual({ ...r.params }, { ...J.params(form) });
    assert.deepEqual({ ...r.opts }, { cutoff: 1e-5 });
    assert.deepEqual([r.decimated, r.paused, r.onData], [false, false, false]);
    assert.equal(r.cost, 200 * 0.01);
    assert.ok(isDeepFrozen(r));
    const { modelSpec, params, q, opts } = r;
    assert.ok(allFinite(E.evaluate(modelSpec, params, q, opts, await loadKernels()).I));
});

test('previewRequest with data: only finite q > 0, index points back into the data', () => {
    const ds = dataset([-0.01, 0, 0.01, NaN, 0.02, Infinity, 0.03], [1, 1, 1, 1, 1, 1, 1], null);
    const r = J.previewRequest(F.create('sphere'), ds);
    assert.deepEqual([...r.q], [0.01, 0.02, 0.03]);
    assert.deepEqual([...r.index], [2, 4, 6]);
    assert.equal(r.onData, true);
    assert.deepEqual([...ds.q].map(String), ['-0.01', '0', '0.01', 'NaN', '0.02', 'Infinity', '0.03'], 'data untouched');
    const none = J.previewRequest(F.create('sphere'), dataset([0, -1, NaN], [1, 1, 1], null));
    assert.equal(none.onData, false, 'no usable q: the default grid');
    assert.equal(none.q.length, 200);
});

const linear = (n) => Array.from({ length: n }, (_, i) => 0.001 * (i + 1));
const flat = (n) => new Array(n).fill(1);

test('previewRequest: a heavy mesh is decimated to the budget, first and last point kept', () => {
    const form = run(F.create('cylinder'),
        { type: 'togglePd', name: 'radius' }, pdField('radius', 'width', '0.1'),
        { type: 'togglePd', name: 'length' }, pdField('length', 'width', '0.1'));
    const r = J.previewRequest(form, dataset(linear(400), flat(400), null));
    assert.equal(r.decimated, true);
    assert.equal(r.paused, false);
    assert.equal(r.q.length, Math.floor(150000 / 1225));
    assert.equal(r.q.length, 122);
    assert.ok(r.q instanceof Float64Array && r.index instanceof Uint32Array);
    assert.equal(r.index[0], 0);
    assert.equal(r.index[121], 399);
    assert.ok(r.index.every((v, i) => i === 0 || v > r.index[i - 1]), 'strictly increasing');
    assert.deepEqual([...r.q], Array.from(r.index, (i) => 0.001 * (i + 1)));
    assert.equal(r.cost, 122 * 1225);
});

test('previewRequest: cheap models, zero-width dispersities and short data are not decimated', () => {
    const sphere = run(F.create('sphere'), { type: 'togglePd', name: 'radius' },
        pdField('radius', 'type', 'schulz'), pdField('radius', 'width', '0.2'));
    const r = J.previewRequest(sphere, dataset(linear(800), flat(800), null));
    assert.deepEqual([r.decimated, r.paused, r.q.length], [false, false, 800]);
    assert.equal(r.cost, 800 * 80 * 0.01);
    const zero = run(F.create('cylinder'), { type: 'togglePd', name: 'radius' }, { type: 'togglePd', name: 'length' });
    assert.deepEqual([J.previewRequest(zero, dataset(linear(400), flat(400), null)).decimated], [false]);
    // 40 points x 5000 > budget, but the minimum of 50 points is more than the data has
    const big = run(F.create('cylinder'), { type: 'togglePd', name: 'radius' }, pdField('radius', 'width', '0.1'),
        pdField('radius', 'npts', '100'), { type: 'togglePd', name: 'length' }, pdField('length', 'width', '0.1'),
        pdField('length', 'npts', '50'));
    const short = J.previewRequest(big, dataset(linear(40), flat(40), null));
    assert.deepEqual([short.decimated, short.q.length, short.paused], [false, 40, false]);
});

test('previewRequest: a fitted zero-width dispersity counts; the minimum of 50 points; paused over the pause cost', () => {
    const fitted = run(F.create('cylinder'), { type: 'togglePd', name: 'radius' }, pdField('radius', 'npts', '1000'),
        { type: 'setPdFit', name: 'radius', fit: true }, pdField('radius', 'width', '0'));
    const r = J.previewRequest(fitted, dataset(linear(400), flat(400), null));
    assert.deepEqual([r.decimated, r.q.length, r.paused], [true, 150, false]);
    const csc = ['radius', 'thickness', 'length'].reduce((f, name) => run(f,
        { type: 'togglePd', name }, pdField(name, 'width', '0.1')), F.create('core_shell_cylinder'));
    const heavy = J.previewRequest(csc, dataset(linear(400), flat(400), null));
    assert.deepEqual([heavy.decimated, heavy.q.length, heavy.paused], [true, 50, true]);
    assert.equal(heavy.cost, 50 * 42875);
    assert.ok(heavy.cost > J.PREVIEW_PAUSE_COST);
    assert.equal(heavy.index[49], 399);
});

test('previewRequest: an invalid form is an Error', () => {
    assert.throws(() => J.previewRequest(run(F.create('sphere'), setValue('radius', '')), null), /radius\.value/);
});

// ------------------------------------------------------------------ fit

const FIT_Q = Float64Array.from({ length: 60 }, (_, i) => 0.008 + 0.004 * i);
const TRUTH = run(F.create('sphere'), setValue('radius', '60'), setValue('scale', '0.02'), setValue('background', '0.01'),
    { type: 'togglePd', name: 'radius' }, pdField('radius', 'type', 'schulz'), pdField('radius', 'width', '0.12'));

/** Noise-free sphere data with 2 % errors, from the form above. */
async function sphereData() {
    const I = await evaluate(TRUTH, FIT_Q);
    return dataset(FIT_Q, I, Array.from(I, (v) => 0.02 * v));
}
const START = run(TRUTH, setValue('radius', '55'), setValue('scale', '0.015'), pdField('radius', 'width', '0.08'),
    { type: 'setFit', name: 'radius', fit: true }, { type: 'setPdFit', name: 'radius', fit: true });
const fullOf = (ds) => ({ range: S.fullRange(ds), weighting: 'sigma', maxSteps: 200 });

test('fitJob: flags in table order, bounds of the fitted names only, data { q, I, sigma }, options', async () => {
    const ds = await sphereData();
    const form = run(START, { type: 'setLowQ', on: true }, { type: 'setFit', name: 'lowq_power', fit: true },
        { type: 'setUpper', name: 'radius', value: '200' }, { type: 'setLower', name: 'background', value: '' });
    const job = J.fitJob(form, ds, { range: { qMin: 0.01, qMax: 0.2, userEdited: true }, weighting: 'sigma', maxSteps: 77 });
    assert.deepEqual(Object.keys(job), ['modelSpec', 'params', 'fitFlags', 'bounds', 'data', 'range', 'weighting', 'options']);
    assert.deepEqual(Object.entries(job.fitFlags), [['scale', true], ['background', true], ['sld', false],
        ['sld_solvent', false], ['radius', true], ['radius_pd', true], ['lowq_scale', false], ['lowq_power', true]]);
    assert.deepEqual(JSON.parse(JSON.stringify(job.bounds, (k, v) => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : v))),
        { scale: [0, 'inf'], background: ['-inf', 'inf'], radius: [0, 200], radius_pd: [0, 0.4], lowq_power: [0, 6] });
    assert.deepEqual(Object.keys(job.data), ['q', 'I', 'sigma', 'kind']);
    assert.equal(job.data.q, ds.q);
    assert.equal(job.data.I, ds.I);
    assert.equal(job.data.sigma, ds.sigma);
    assert.deepEqual({ ...job.range }, { qMin: 0.01, qMax: 0.2 });
    assert.equal(job.weighting, 'sigma');
    assert.deepEqual({ ...job.options }, { maxSteps: 77, cutoff: 1e-5 });
    assert.deepEqual({ ...job.modelSpec }, { model: 'sphere', structure: null, lowQPowerLaw: true });
    assert.deepEqual({ ...job.params }, { ...J.params(form) });
    assert.ok(isDeepFrozen(job));
    assert.ok(structuredClone(job), 'postMessage can clone it');
    const noSigma = J.fitJob(START, dataset(ds.q, ds.I, null), { range: S.fullRange(ds), weighting: 'none', maxSteps: 5 });
    assert.equal(noSigma.data.sigma, null);
});

test('fitJob: a closed dispersity is neither flagged nor sent, even when its width was ticked', async () => {
    const ds = await sphereData();
    const job = J.fitJob(run(START, { type: 'togglePd', name: 'radius' }), ds, fullOf(ds));
    assert.equal('radius_pd' in job.fitFlags, false);
    assert.equal('radius_pd' in job.bounds, false);
    assert.equal('radius_pd' in job.params, false);
});

test('fitJob: a fitted width of exactly 0 starts from PD_FIT_START (spec 5.7 item 12, second line of defence)', async () => {
    const ds = await sphereData();
    const zero = run(START, pdField('radius', 'width', '0'));
    assert.equal(J.params(zero).radius_pd, 0, 'the form itself still says 0');
    assert.equal(J.fitJob(zero, ds, fullOf(ds)).params.radius_pd, F.PD_FIT_START);
    const fixed = run(zero, { type: 'setPdFit', name: 'radius', fit: false });
    assert.equal(J.fitJob(fixed, ds, fullOf(ds)).params.radius_pd, 0, 'a fixed width stays 0');
});

test('fitJob: refuses what fitReadiness refuses', async () => {
    const ds = await sphereData();
    assert.throws(() => J.fitJob(START, ds, { range: null, weighting: 'sigma', maxSteps: 200 }), /擬合範圍/);
    assert.throws(() => J.fitJob(START, null, fullOf(ds)), /載入資料/);
});

test('fitReadiness: every reason, in Chinese; nPoints and nFree when ready', async () => {
    const ds = await sphereData();
    const settings = fullOf(ds);
    const ready = J.fitReadiness(START, ds, settings);
    assert.deepEqual({ ...ready }, { ok: true, reason: null, nPoints: 60, nFree: 4 });
    assert.ok(Object.isFrozen(ready));
    const reasonOf = (form, data, s) => {
        const r = J.fitReadiness(form, data, s);
        assert.equal(r.ok, false);
        return r.reason;
    };
    assert.equal(reasonOf(START, null, settings), '請先載入資料並選擇作用中的資料。');
    assert.equal(reasonOf(run(START, setValue('radius', 'x')), ds, settings), '參數表有不合法的欄位，請先修正。');
    const none = ['scale', 'background', 'radius'].reduce((f, name) => run(f, { type: 'setFit', name, fit: false }),
        run(START, { type: 'setPdFit', name: 'radius', fit: false }));
    assert.equal(reasonOf(none, ds, settings), '請至少勾選一個要擬合的參數。');
    assert.equal(reasonOf(START, ds, { ...settings, range: null }), '沒有可用的擬合範圍，請設定 Qmin 與 Qmax。');
    assert.equal(reasonOf(START, ds, { ...settings, range: { qMin: 0.2, qMax: 0.1 } }), 'Qmin 不可大於 Qmax。');
    assert.equal(reasonOf(START, dataset(ds.q, ds.I, null), settings), '此資料沒有可用的誤差欄，不能使用「資料 σ」權重。');
    const few = J.fitReadiness(START, ds, { ...settings, range: { qMin: ds.q[0], qMax: ds.q[3] } });
    assert.deepEqual({ ...few }, {
        ok: false, reason: '範圍內可參與擬合的資料點（4 點）必須多於要擬合的參數個數（4 個）。', nPoints: 4, nFree: 4,
    });
    assert.equal(J.fitReadiness(START, ds, { ...settings, range: { qMin: ds.q[0], qMax: ds.q[4] } }).ok, true);
    assert.equal(few.nPoints, W.select(ds, 'sigma', { qMin: ds.q[0], qMax: ds.q[3] }).index.length);
    assert.throws(() => J.fitReadiness(START, ds, { ...settings, weighting: 'poisson' }), /poisson/);
});

test('fullRange is the one of SasFitState', () => {
    const ds = dataset([0, 0.02, 0.01, NaN], [1, 1, 1, 1], null);
    assert.deepEqual({ ...J.fullRange(ds) }, { qMin: 0.01, qMax: 0.02 });
    assert.equal(J.fullRange(dataset([0], [1], null)), null);
});

/** Run a job through a real SasFitWorkerCore; the 'result' message's FitResult. */
async function fitThroughCore(job) {
    const { core, posts, ofType } = makeCore();
    await core.handle({ type: 'fit', jobId: 1, ...structuredClone(job) });
    assert.deepEqual(ofType('error'), [], 'the core reports no error');
    assert.equal(posts[posts.length - 1].type, 'result');
    return Object.freeze(posts[posts.length - 1].fitResult);
}

test('a built fit job runs end to end through SasFitWorkerCore and recovers the truth', async () => {
    const ds = await sphereData();
    const result = await fitThroughCore(J.fitJob(START, ds, fullOf(ds)));
    assert.equal(result.status, 'converged');
    assert.deepEqual(result.names, ['scale', 'background', 'radius', 'radius_pd']);
    assert.ok(Math.abs(result.params.radius - 60) < 1e-4, 'radius ' + result.params.radius);
    assert.ok(Math.abs(result.params.radius_pd - 0.12) < 1e-5, 'radius_pd ' + result.params.radius_pd);
    assert.equal(result.params.radius_pd_nsigma, 3);
    assert.equal(result.params.radius_pd_type, 'schulz');
    assert.deepEqual({ ...result.settings.modelSpec }, { ...J.modelSpec(START) });

    const applied = J.applyResult(START, result);
    const written = J.writtenValues(START, result);
    assert.equal(applied.fields.radius.value, String(written.radius));
    assert.equal(applied.pds.radius.width, String(written.radius_pd));
    const shown = globalThis.SasFitWorkerCore.displayErrors(result);
    result.names.forEach((name) => {
        assert.ok(Math.abs(written[name] - result.params[name]) < 0.01 * shown[name], name + ' moved by more than 0.01 sigma');
    });
    assert.deepEqual(applied.fields.sld, START.fields.sld, 'fixed parameters untouched');
    assert.equal(applied.fields.radius.upper, START.fields.radius.upper);
    assert.equal(START.fields.radius.value, '55', 'the form given is not changed');
    assert.equal(J.resultMatchesForm(applied, result), true);
    assert.equal(J.resultMatchesForm(START, result), false);
});

test('a P@S job with low-Q runs through SasFitWorkerCore too', async () => {
    const truth = run(F.create('sphere'), { type: 'setStructure', structure: 'hardsphere' }, { type: 'setLowQ', on: true },
        setValue('scale', '0.02'), setValue('lowq_scale', '1e-7'), setValue('lowq_power', '3'));
    const I = await evaluate(truth, FIT_Q);
    const ds = dataset(FIT_Q, I, Array.from(I, (v) => 0.02 * v));
    const start = run(truth, setValue('volfraction', '0.15'), { type: 'setFit', name: 'volfraction', fit: true },
        { type: 'setFit', name: 'lowq_scale', fit: true });
    const result = await fitThroughCore(J.fitJob(start, ds, fullOf(ds)));
    assert.equal(result.status, 'converged');
    assert.deepEqual(result.names, ['scale', 'background', 'volfraction', 'lowq_scale']);
    assert.ok(Math.abs(result.params.volfraction - 0.2) < 1e-5, 'volfraction ' + result.params.volfraction);
    assert.equal(J.resultMatchesForm(J.applyResult(start, result), result), true);
});

/** A FitResult-like object for a form: what the worker would return had it fitted `names` to `values`. */
function resultFor(form, values, extra) {
    const names = Object.keys(values);
    const settings = Object.freeze({ modelSpec: J.modelSpec(form), weighting: 'sigma' });
    return Object.freeze({ status: 'converged', names, params: Object.freeze({ ...J.params(form), ...values }), settings, ...extra });
}

test('applyResult: only the fitted names are written, rounded by SasFitFormat.inputValue', () => {
    const form = run(START, { type: 'setStructure', structure: 'hardsphere' });
    const result = resultFor(form, { radius: 61.123456789012345, radius_pd: 0.1 });
    const applied = J.applyResult(form, result);
    assert.equal(applied.fields.radius.value, '61.123457', 'no error in the result: 8 significant figures');
    assert.equal(applied.pds.radius.width, '0.1');
    const withErrors = { ...result, errors: { radius: 0.0312, radius_pd: 0.004 }, displayErrorsScaled: false };
    const rounded = J.applyResult(form, withErrors);
    assert.equal(rounded.fields.radius.value, '61.12346', 'two digits beyond the second significant figure of the error');
    assert.equal(rounded.pds.radius.width, '0.1');
    assert.deepEqual({ ...J.writtenValues(form, withErrors) }, { radius: 61.12346, radius_pd: 0.1 });
    assert.deepEqual(applied.fields.scale, form.fields.scale);
    assert.equal(applied.structureMode, form.structureMode);
    assert.equal(J.applyResult(form, resultFor(form, {}, { status: 'stopped' })), form, 'nothing fitted: the same form');
    assert.throws(() => J.applyResult(F.create('cylinder'), result), /sphere/);
    assert.throws(() => J.applyResult(form, null), /FitResult/);
});

test('resultMatchesForm: false after any change of a value, the model, S(Q), low-Q or a dispersity', () => {
    const form = run(START, { type: 'setStructure', structure: 'hardsphere' });
    const result = resultFor(form, { radius: 61, radius_pd: 0.1 });
    const applied = J.applyResult(form, result);
    assert.equal(J.resultMatchesForm(applied, result), true);
    const changes = {
        value: setValue('sld', '2'),
        'fitted value': setValue('radius', '62'),
        model: { type: 'setModel', model: 'ellipsoid' },
        'no S': { type: 'setStructure', structure: null },
        'other S': { type: 'setStructure', structure: 'hayter_msa' },
        'structure mode': { type: 'setStructureMode', mode: 1 },
        'radius mode': { type: 'setRadiusMode', mode: 0 },
        'low-Q': { type: 'setLowQ', on: true },
        'pd closed': { type: 'togglePd', name: 'radius' },
        'pd width': pdField('radius', 'width', '0.11'),
        'pd type': pdField('radius', 'type', 'gaussian'),
        'pd npts': pdField('radius', 'npts', '81'),
        'pd nsigmas': pdField('radius', 'nsigmas', '4'),
        'invalid': setValue('radius', 'abc'),
    };
    Object.keys(changes).forEach((label) => {
        assert.equal(J.resultMatchesForm(run(applied, changes[label]), result), false, label);
    });
    const plain = F.create('sphere');
    const opened = run(plain, { type: 'togglePd', name: 'radius' });
    assert.equal(J.resultMatchesForm(opened, resultFor(plain, {})), false, 'a dispersity opened afterwards');
});

test('resultMatchesForm: bounds and fit ticks do not matter; stopped and null never match', () => {
    const form = START;
    const result = resultFor(form, {});
    assert.equal(J.resultMatchesForm(form, result), true);
    const same = run(form, { type: 'setLower', name: 'radius', value: '10' }, { type: 'setUpper', name: 'scale', value: '5' },
        { type: 'setFit', name: 'sld', fit: true }, { type: 'setPdFit', name: 'radius', fit: false },
        pdField('radius', 'upper', '0.3'), setValue('radius', '55.0'));
    assert.equal(J.resultMatchesForm(same, result), true);
    assert.equal(J.resultMatchesForm(form, resultFor(form, {}, { status: 'stopped' })), false);
    assert.equal(J.resultMatchesForm(form, null), false);
    assert.equal(J.resultMatchesForm(form, resultFor(form, {}, { status: 'failed' })), true);
});

test('nothing given is modified', async () => {
    const ds = await sphereData();
    const before = JSON.stringify([START, Array.from(ds.q), Array.from(ds.I), Array.from(ds.sigma)]);
    J.params(START);
    J.previewRequest(START, ds);
    J.fitReadiness(START, ds, fullOf(ds));
    J.fitJob(START, ds, fullOf(ds));
    J.resultMatchesForm(START, resultFor(START, { radius: 1 }));
    assert.equal(JSON.stringify([START, Array.from(ds.q), Array.from(ds.I), Array.from(ds.sigma)]), before);
});

// ------------------------------------------------------------------ rounded write-back (fix pass A, number rule 6)

const fullResult = (form, values, errors, extra) => resultFor(form, values, {
    errors: Object.freeze(errors), errorsScaled: Object.freeze(errors), displayErrorsScaled: false, atBound: Object.freeze({}), ...extra,
});

test('write-back: apply -> the result matches its own form -> edit -> no match -> the old text -> match again', () => {
    const exact = { scale: 1.0013090858486413, background: 0.0013628359882335626, radius: 49.99493550916302 };
    const errors = { scale: 0.002073006854671509, background: 0.0001943752294732052, radius: 0.0033299359837592308 };
    const result = fullResult(START, exact, errors);
    const applied = J.applyResult(START, result);
    assert.deepEqual([applied.fields.scale.value, applied.fields.background.value, applied.fields.radius.value],
        ['1.001309', '0.00136284', '49.994936']);
    assert.equal(J.resultMatchesForm(applied, result), true);
    assert.equal(J.resultMatchesForm(START, result), false, 'the form before the fit (revert) does not match');
    const edited = run(applied, setValue('radius', '49.99'));
    assert.equal(J.resultMatchesForm(edited, result), false);
    assert.equal(J.resultMatchesForm(run(edited, setValue('radius', '49.994936')), result), true);
    assert.equal(J.resultMatchesForm(run(edited, setValue('radius', String(exact.radius))), result), false,
        'the exact double is no longer what the page holds');
    assert.equal(J.applyResult(applied, result).fields.radius.value, '49.994936', 'applying twice changes nothing');
});

test('write-back: no input ever holds more than 15 significant digits; every value moves by < 0.01 sigma', () => {
    const exact = { scale: 1622.876520500591, background: -0.00022497415222375204, radius: 15.776024832728607 };
    for (const ratio of [1e-12, 1e-6, 1e-3, 0.05, 1, 40, 1e7]) {
        const errors = Object.fromEntries(Object.keys(exact).map((k) => [k, Math.abs(exact[k]) * ratio]));
        const result = fullResult(START, exact, errors);
        const applied = J.applyResult(START, result);
        Object.keys(exact).forEach((name) => {
            const text = applied.fields[name].value;
            assert.ok(text.replace(/e.*$/, '').replace(/[-.]/g, '').replace(/^0+/, '').length <= 15, name + ': ' + text);
            if (ratio >= 1e-6) assert.ok(Math.abs(Number(text) - exact[name]) < 0.01 * errors[name], name + ' ' + text + ' at ratio ' + ratio);
        });
        assert.equal(J.resultMatchesForm(applied, result), true, 'ratio ' + ratio);
        assert.equal(F.validate(applied).valid, true);
    }
});

test('write-back: a value on a bound is written exactly; rounding never leaves the bounds of the form', () => {
    const bounded = run(START, { type: 'setLower', name: 'radius', value: '49.99493551' }, { type: 'setUpper', name: 'scale', value: '1.0013089' });
    const onBound = fullResult(bounded, { radius: 49.99493551, scale: 1.00130889 }, { radius: 0.5, scale: 0.5 }, { atBound: { radius: 'lower' } });
    const applied = J.applyResult(bounded, onBound);
    assert.equal(applied.fields.radius.value, '49.99493551', 'on the bound: exactly the bound');
    assert.equal(applied.fields.scale.value, '1.0013089', 'rounding to 1.00131 would pass the upper bound');
    assert.equal(J.resultMatchesForm(applied, onBound), true);
    const pd = fullResult(START, { radius_pd: 0.39999951 }, { radius_pd: 0.3 });
    assert.equal(J.applyResult(START, pd).pds.radius.width, '0.4', 'the upper bound of the width (0.4) is respected');
});
