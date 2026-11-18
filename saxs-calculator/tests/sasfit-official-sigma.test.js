'use strict';
/**
 * Owner decision D1 (spec 15, amending decision 12): in an official TPS 13A
 * file a row whose sigma is 0, negative or not finite is INVALID in every
 * weighting mode (the beamline writes sigma = 0 for masked bins: the
 * beamstop region). Generic files are unaffected. Covers SasFitWeighting, the
 * job / client / Worker path of `kind`, the hints, and the fits end to end.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    SasFitWeighting: W, SasFitDataIo: IO, SasFitForm: Form, SasFitJobs: Jobs, SasFitState: State, SasFitHints: Hints,
} = require('./load.js');
const { makeCore, fakeWorkers, CLIENT_VERSION } = require('./sasfit-fit-helpers.js');

const DAT = path.join(__dirname, 'fixtures', 'sasfit', 'dat');
const synth = () => IO.parse(fs.readFileSync(path.join(DAT, 'SYNTH_sphere_10.dat'), 'utf8'), { fileName: 'SYNTH_sphere_10.dat' }).dataset;
const f64 = (a) => Float64Array.from(a);
const ds = (kind, sigma) => ({
    kind, header: null, q: f64([0.01, 0.02, 0.03, 0.04, 0.05, 0.06]), I: f64([-0.5, 4, 3, 0, 2, 1]),
    sigma: sigma === null ? null : f64(sigma),
});
const SIG = [0, 0.1, NaN, 0.1, -1, 0.1];
const MODES = ['sigma', 'sqrtI', 'absI', 'none'];

test('official: sigma <= 0 or non-finite masks the point in every mode; generic files keep the old rule', () => {
    assert.deepEqual(Array.from(W.mask(ds('official', SIG), 'sigma')), [0, 1, 0, 1, 0, 1]);
    assert.deepEqual(Array.from(W.mask(ds('official', SIG), 'none')), [0, 1, 0, 1, 0, 1]);
    assert.deepEqual(Array.from(W.mask(ds('official', SIG), 'sqrtI')), [0, 1, 0, 0, 0, 1], 'I = 0 is still excluded as well');
    assert.deepEqual(Array.from(W.mask(ds('official', SIG), 'absI')), [0, 1, 0, 0, 0, 1]);
    assert.deepEqual(Array.from(W.mask(ds('generic', SIG), 'none')), [1, 1, 1, 1, 1, 1]);
    assert.deepEqual(Array.from(W.mask(ds('generic', SIG), 'sqrtI')), [1, 1, 1, 0, 1, 1]);
    assert.deepEqual(Array.from(W.mask(ds(undefined, SIG), 'none')), [1, 1, 1, 1, 1, 1], 'no kind = generic');
    assert.deepEqual(Array.from(W.mask(ds('official', null), 'none')), [1, 1, 1, 1, 1, 1], 'no error column: nothing to judge by');
});

test('official: countExcluded, select and defaultRange follow the same mask; weights are unchanged', () => {
    const d = ds('official', SIG);
    assert.deepEqual(MODES.map((m) => W.countExcluded(d, m)), [3, 4, 4, 3]);
    assert.deepEqual(Array.from(W.select(d, 'none', { qMin: 0, qMax: 1 }).index), [1, 3, 5]);
    assert.deepEqual(Array.from(W.select(d, 'absI', { qMin: 0, qMax: 1 }).index), [1, 5]);
    assert.deepEqual(W.defaultRange(d, 'none'), { qMin: 0.02, qMax: 0.06 });
    assert.deepEqual(Array.from(W.weights(d, 'none')), [1, 1, 1, 1, 1, 1]);
    assert.throws(() => W.mask({ ...d, kind: 'weird' }, 'none'), /kind/);
});

test('synthetic official file: the five beamstop rows are excluded by all four weightings', () => {
    const d = synth();
    assert.deepEqual(MODES.map((m) => W.countExcluded(d, m)), [5, 5, 5, 5]);
    const full = State.fullRange(d);
    MODES.forEach((m) => assert.equal(W.select(d, m, full).index.length, 300, m));
    MODES.forEach((m) => assert.equal(W.defaultRange(d, m).qMin, 0.005, m));
});

test('fitJob carries data.kind; fitReadiness counts with it', () => {
    const d = synth();
    const form = Form.reduce(Form.create('sphere'), { type: 'setFit', name: 'radius', fit: true });
    const settings = { range: State.fullRange(d), weighting: 'none', maxSteps: 200 };
    assert.equal(Jobs.fitReadiness(form, d, settings).nPoints, 300);
    const job = Jobs.fitJob(form, d, settings);
    assert.equal(job.data.kind, 'official');
    assert.equal(Jobs.fitJob(form, { ...d, kind: 'generic' }, settings).data.kind, 'generic');
});

test('client: the fit message carries data.kind (generic when the job has none)', async () => {
    const d = synth();
    const base = {
        modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false }, params: { scale: 1, background: 0.001, sld: 1, sld_solvent: 6, radius: 51 },
        fitFlags: { radius: true }, bounds: {}, range: { qMin: 0.001, qMax: 0.35 }, weighting: 'none',
    };
    const h = fakeWorkers();
    h.client.fit({ ...base, data: { q: d.q, I: d.I, sigma: d.sigma, kind: 'official', header: d.header } }).catch(() => {});
    const sent = h.last().sent[h.last().sent.length - 1];
    assert.deepEqual(Object.keys(sent.data).sort(), ['I', 'kind', 'q', 'sigma']);
    assert.equal(sent.data.kind, 'official');
    h.client.dispose();
    const g = fakeWorkers();
    g.client.fit({ ...base, data: { q: d.q, I: d.I, sigma: d.sigma } }).catch(() => {});
    assert.equal(g.last().sent[g.last().sent.length - 1].data.kind, 'generic');
    g.client.dispose();
    assert.equal(typeof CLIENT_VERSION, 'string');
});

const message = (d, weighting, extra) => ({
    type: 'fit', jobId: 1, modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false },
    params: { scale: 1, background: 0.001, sld: 1, sld_solvent: 6, radius: 51 },
    fitFlags: { scale: true, background: true, radius: true },
    bounds: { scale: [0, Infinity], radius: [0, Infinity] },
    data: { q: d.q, I: d.I, sigma: d.sigma, kind: d.kind }, range: { qMin: 0.001, qMax: 0.35 }, weighting,
    options: { maxSteps: 200, cutoff: 1e-5 }, ...extra,
});

test('Worker: data.kind is validated; absent means generic', async () => {
    const d = synth();
    const bad = makeCore();
    await bad.core.handle(message({ ...d, kind: 'official ' }, 'none'));
    assert.equal(bad.ofType('error')[0].code, 'BAD_DATA');
    assert.match(bad.ofType('error')[0].detail, /kind/);
    const generic = makeCore();
    await generic.core.handle(message({ ...d, kind: undefined }, 'none'));
    const r = generic.ofType('result')[0].fitResult;
    assert.equal(r.dof + r.names.length, 305, 'a generic file keeps its sigma = 0 rows with weighting none');
});

test('end to end: an official file fitted over the FULL q range no longer runs away with any weighting', async () => {
    const d = synth();
    for (const weighting of MODES) {
        const h = makeCore();
        await h.core.handle(message(d, weighting));
        assert.equal(h.ofType('error').length, 0, weighting + ': ' + JSON.stringify(h.ofType('error')));
        const r = h.ofType('result')[0].fitResult;
        assert.equal(r.status, 'converged', weighting);
        assert.equal(r.dof + r.names.length, 300, weighting + ': the five beamstop rows take no part');
        assert.ok(Math.abs(r.params.radius - 50) < 0.2, weighting + ': radius ' + r.params.radius);
        assert.ok(Math.abs(r.params.scale - 1) < 0.05, weighting + ': scale ' + r.params.scale);
        for (let i = 0; i < 5; i++) assert.ok(Number.isNaN(r.residuals[i]), weighting + ': no residual at beamstop row ' + i);
    }
});

test('hints: beamstop rows of an official file are not reported as "I < 0 weighted by |I|"; a note says they are invalid', () => {
    const d = synth();
    const input = (weighting, dataset) => ({
        modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false }, dataset, range: State.fullRange(dataset), weighting,
        notes: { skipped: 0, placeholders: 1, sorted: false, suspectNm: false },
    });
    const of = (weighting, dataset, id) => Hints.preFitHints(input(weighting, dataset)).find((h) => h.id === id);
    const np = of('sqrtI', d, 'nonpositive-weight');
    assert.equal(np.negative, 2, 'only the two real negative points of the file, not the five beamstop rows');
    assert.equal(np.text, '擬合範圍內有 2 點 I ≤ 0：I < 0 的 2 點以 |I| 當權重，接近 0 的負值權重極小，會主導擬合');
    const note = of('sqrtI', d, 'invalid-sigma');
    assert.equal(note.tone, 'ok');
    assert.equal(note.count, 5);
    assert.equal(note.text, '此檔有 5 點 σ＝0（光束擋片區或無效的點）：官方檔的這些點在任何權重下都不參與擬合');
    assert.equal(of('sigma', d, 'invalid-sigma'), undefined, 'with sigma weighting it goes without saying');
    assert.equal(of('none', { ...d, kind: 'generic' }, 'invalid-sigma'), undefined);
    assert.equal(of('sqrtI', { ...d, kind: 'generic' }, 'nonpositive-weight').negative, 7);
    assert.ok(Hints.PRE_FIT_HINT_IDS.includes('invalid-sigma'));
});
