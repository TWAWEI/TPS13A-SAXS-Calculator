'use strict';
/**
 * sasfit-state.js: the page state reducer of the SAS fitting page
 * (design spec 4.8, 5.2, 5.4, 7; plan M3 Task 5).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitState: S, SasFitWeighting: W, SasFitDataIo: IO, SasFitWorkerCore: Core,
} = require('./load.js');

const isView = (o) => ArrayBuffer.isView(o);
const isDeepFrozen = (o) => o === null || typeof o !== 'object' || isView(o)
    || (Object.isFrozen(o) && Object.values(o).every(isDeepFrozen));
const run = (state, ...actions) => actions.reduce((s, a) => S.reduce(s, a), state);

/** A frozen dataset as SasFitDataIo makes it; sigma: array | null. */
function dataset(fileName, q, I, sigma, extra) {
    return Object.freeze({
        fileName, kind: 'generic', header: null,
        q: Float64Array.from(q), I: Float64Array.from(I), sigma: sigma === null ? null : Float64Array.from(sigma),
        dq: null, condition: IO.conditionFromName(fileName), qUnit: 'A', ...extra,
    });
}
const NOTES = Object.freeze({ skipped: 0, placeholders: 0, sorted: false, suspectNm: false });
const Q5 = [0.01, 0.02, 0.03, 0.04, 0.05];
const withSigma = (name) => dataset(name, Q5, [5, 4, 3, 2, 1], [0.1, 0.1, 0.1, 0.1, 0.1]);
const noSigma = (name) => dataset(name, Q5, [5, 4, 3, 2, 1], null);
const good = (name, ds) => Object.freeze({ fileName: name, dataset: ds || withSigma(name), issues: Object.freeze([]), notes: NOTES });
const bad = (name) => Object.freeze({
    fileName: name, dataset: null,
    issues: Object.freeze([Object.freeze({ line: null, message: '沒有可用的資料列' })]), notes: NOTES,
});
const add = (...files) => ({ type: 'addFiles', files });
const loaded = (...files) => S.reduce(S.initial(), add(...files));
const RESULT = (status, extra) => Object.freeze({ status, chi2r: 1.2, iterations: 7, params: Object.freeze({}), ...extra });

test('module is frozen; constants of the plan', () => {
    assert.ok(Object.isFrozen(S));
    assert.equal(S.MAX_FILES, 500);
    assert.equal(S.DEFAULT_SHOWN, 8);
    assert.deepEqual([...S.TABS], ['data', 'model', 'fit', 'sequence']);
    assert.deepEqual([...S.PLOT_VIEWS], ['curve', 'shape']);
    assert.ok(Object.isFrozen(S.TABS) && Object.isFrozen(S.PLOT_VIEWS));
    assert.deepEqual([...S.PLOT_MODES], ['loglog', 'guinier', 'kratky', 'porod']);
});

test('initial(): empty, idle, deep-frozen, no stale / forced flags', () => {
    const s = S.initial();
    assert.ok(isDeepFrozen(s));
    assert.deepEqual(JSON.parse(JSON.stringify(s)), {
        files: [], activeId: null, shown: {}, conditionName: '條件', fitResults: {},
        range: null, weighting: 'sigma', weightingUserSet: false, maxSteps: 200, plotMode: 'loglog',
        stagger: { on: false, decades: 1 },
        fit: { phase: 'idle', datasetId: null, iteration: 0, chi2r: null, outcome: null },
        tab: 'data', nextId: 1, notice: null, removed: null, plotView: 'curve',
        seq: {
            phase: 'idle', selected: {}, options: { chain: true, sort: true }, order: null, rows: {},
            form: null, settings: null, warnings: [], y: null, outcome: null,
        },
    });
    assert.equal('resultStale' in s, false);
    assert.equal('weightingForced' in s, false);
    assert.equal(S.capacity(s), 500);
    assert.equal(S.active(s), null);
    assert.deepEqual(S.shownFiles(s), []);
});

test('addFiles: ids in order (failed files too), issues / notes / dataset by reference, condition from the dataset', () => {
    const files = [bad('x.dat'), good('a_10.dat'), good('b_-2.5.dat')];
    const s = loaded(...files);
    assert.deepEqual(s.files.map((f) => f.id), ['d1', 'd2', 'd3']);
    assert.equal(s.nextId, 4);
    s.files.forEach((f, i) => {
        assert.equal(f.fileName, files[i].fileName);
        assert.equal(f.dataset, files[i].dataset);
        assert.equal(f.issues, files[i].issues);
        assert.equal(f.notes, files[i].notes);
    });
    assert.deepEqual(s.files.map((f) => f.condition), [null, 10, -2.5]);
    assert.equal(s.activeId, 'd2', 'first file WITH a dataset');
    assert.deepEqual({ ...s.shown }, { d2: true, d3: true });
    assert.ok(isDeepFrozen(s));
    assert.equal(S.active(s), s.files[1]);
});

test('addFiles: real SasFitDataIo.parse output is accepted as it is', () => {
    const parsed = IO.parse('0.01 5 0.1\n0.02 4 0.1\n0.03 3 0.1\n', { fileName: 'run_3.txt' });
    const s = loaded({ fileName: 'run_3.txt', ...parsed });
    assert.equal(s.files[0].dataset, parsed.dataset);
    assert.equal(s.files[0].condition, 3);
    assert.equal(s.weighting, 'sigma');
    assert.deepEqual({ ...s.range }, { qMin: 0.01, qMax: 0.03, userEdited: false });
});

test('addFiles: ids are never reused after a removal', () => {
    const s = run(loaded(good('a.dat'), good('b.dat')), { type: 'removeFile', id: 'd2' }, add(good('c.dat')));
    assert.deepEqual(s.files.map((f) => f.id), ['d1', 'd3']);
});

test('addFiles: only the first DEFAULT_SHOWN files with a dataset are shown', () => {
    const many = Array.from({ length: 10 }, (_, i) => good('f' + i + '.dat'));
    const s = run(loaded(bad('x.dat'), ...many), add(good('late.dat')));
    const shownIds = s.files.filter((f) => s.shown[f.id] === true).map((f) => f.id);
    assert.deepEqual(shownIds, ['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']);
    assert.equal(s.shown.d10, false);
    assert.equal(s.shown.d12, false);
    assert.equal('d1' in s.shown, false, 'a failed file has no shown entry');
});

test('addFiles: MAX_FILES is enforced; the rest is skipped with a notice; clearNotice', () => {
    const many = Array.from({ length: 499 }, (_, i) => good('f' + i + '.dat'));
    const s = loaded(...many);
    assert.equal(S.capacity(s), 1);
    assert.equal(s.notice, null);
    const full = S.reduce(s, add(good('y.dat'), good('z.dat'), bad('w.dat')));
    assert.equal(full.files.length, 500);
    assert.equal(full.files[499].fileName, 'y.dat');
    assert.equal(S.capacity(full), 0);
    assert.equal(full.notice, '清單最多 500 個檔，已略過 2 個檔。');
    assert.equal(S.reduce(full, { type: 'clearNotice' }).notice, null);
    const none = S.reduce(full, add(good('q.dat')));
    assert.equal(none.files.length, 500);
    assert.equal(none.notice, '清單最多 500 個檔，已略過 1 個檔。');
});

test('addFiles: `skipped` (files the loader did not read) is added to the notice; issueOverflow is kept', () => {
    const s = S.reduce(S.initial(), { type: 'addFiles', files: [{ ...good('a.dat'), issueOverflow: 7 }, good('b.dat')], skipped: 3 });
    assert.equal(s.notice, '清單最多 500 個檔，已略過 3 個檔。');
    assert.deepEqual(s.files.map((f) => f.issueOverflow), [7, 0]);
    assert.throws(() => S.reduce(S.initial(), { type: 'addFiles', files: [], skipped: -1 }), /skipped/);
    assert.throws(() => S.reduce(S.initial(), { type: 'addFiles', files: [{ ...good('a.dat'), issueOverflow: 1.5 }] }), /issueOverflow/);
});

test('notice: cleared by the next load without skipped files and by a removal', () => {
    const noticed = S.reduce(S.initial(), { type: 'addFiles', files: [good('a.dat'), good('b.dat')], skipped: 2 });
    assert.notEqual(noticed.notice, null);
    assert.equal(S.reduce(noticed, add(good('c.dat'))).notice, null);
    assert.equal(S.reduce(noticed, { type: 'removeFile', id: 'd1' }).notice, null);
});

test('addFiles: malformed input is an Error naming the problem', () => {
    const s = S.initial();
    assert.throws(() => S.reduce(s, { type: 'addFiles' }), /files/);
    assert.throws(() => S.reduce(s, add({ fileName: 3, dataset: null, issues: [], notes: NOTES })), /fileName/);
    assert.throws(() => S.reduce(s, add({ fileName: 'a', dataset: {}, issues: [], notes: NOTES })), /dataset/);
    assert.throws(() => S.reduce(s, add({ fileName: 'a', dataset: null, issues: null, notes: NOTES })), /issues/);
    assert.throws(() => S.reduce(s, add({ fileName: 'a', dataset: null, issues: [], notes: null })), /notes/);
});

test('failed files cannot be active or shown', () => {
    const s = loaded(bad('x.dat'), good('a.dat'));
    assert.throws(() => S.reduce(s, { type: 'setActive', id: 'd1' }), /d1.*no data/);
    assert.throws(() => S.reduce(s, { type: 'setShown', id: 'd1', shown: true }), /d1.*no data/);
    assert.throws(() => S.reduce(s, { type: 'setActive', id: 'nope' }), /Unknown file id: nope/);
    const onlyBad = loaded(bad('x.dat'));
    assert.equal(onlyBad.activeId, null);
    assert.equal(onlyBad.range, null);
});

test('first active dataset: weighting = defaultMode, range = defaultRange with userEdited false', () => {
    const a = loaded(good('a.dat'));
    assert.equal(a.weighting, 'sigma');
    assert.deepEqual({ ...a.range }, { qMin: 0.01, qMax: 0.05, userEdited: false });
    const b = loaded(good('b.dat', noSigma('b.dat')));
    assert.equal(b.weighting, 'none');
    assert.equal(b.weightingUserSet, false);
    const zeros = dataset('z.dat', Q5, [5, 4, 3, 2, 1], [0, 0, NaN, -1, 0]);
    assert.equal(loaded(good('z.dat', zeros)).weighting, 'none', 'an error column without a usable value');
});

test('first active dataset: defaultRange null gives range null', () => {
    const official = dataset('o.dat', Q5, [5, 4, 3, 2, 1], [1, 1, 1, 1, 1], { kind: 'official', header: Object.freeze({ qStart: 9 }) });
    assert.equal(W.defaultRange(official, 'sigma'), null);
    assert.equal(loaded(good('o.dat', official)).range, null);
});

test('setActive: default weighting follows the data while the user has not chosen one', () => {
    const s = loaded(good('a.dat'), good('b.dat', noSigma('b.dat')));
    const onB = S.reduce(s, { type: 'setActive', id: 'd2' });
    assert.equal(onB.activeId, 'd2');
    assert.equal(onB.weighting, 'none');
    assert.equal(S.reduce(onB, { type: 'setActive', id: 'd1' }).weighting, 'sigma');
});

test('setActive: a chosen weighting is kept, except sigma on data without usable sigma', () => {
    const s = loaded(good('a.dat'), good('b.dat', noSigma('b.dat')), good('c.dat'));
    const sqrt = run(s, { type: 'setWeighting', mode: 'sqrtI' }, { type: 'setActive', id: 'd2' });
    assert.equal(sqrt.weighting, 'sqrtI');
    assert.equal(sqrt.weightingUserSet, true);
    assert.equal(S.reduce(sqrt, { type: 'setActive', id: 'd3' }).weighting, 'sqrtI');
    const sigma = run(s, { type: 'setWeighting', mode: 'sigma' }, { type: 'setActive', id: 'd2' });
    assert.equal(sigma.weighting, 'none', 'forced whoever set it');
    assert.equal(sigma.weightingUserSet, false, 'the forced change voids the choice');
    assert.equal(S.reduce(sigma, { type: 'setActive', id: 'd3' }).weighting, 'sigma');
});

test('setActive: the range follows the data unless the user edited it', () => {
    const wide = dataset('w.dat', [0.1, 0.2, 0.3], [3, 2, 1], [1, 1, 1]);
    const s = loaded(good('a.dat'), good('w.dat', wide));
    assert.deepEqual({ ...S.reduce(s, { type: 'setActive', id: 'd2' }).range }, { qMin: 0.1, qMax: 0.3, userEdited: false });
    const edited = run(s, { type: 'setRange', qMin: 0.02, qMax: 0.04 }, { type: 'setActive', id: 'd2' });
    assert.deepEqual({ ...edited.range }, { qMin: 0.02, qMax: 0.04, userEdited: true });
});

test('setWeighting: marks the choice; recomputes the default range only while the range is not edited', () => {
    // I = 0 at the first point: excluded under sqrtI / absI, kept under sigma and none
    const ds = dataset('a.dat', Q5, [0, 4, 3, 2, 1], [0.1, 0.1, 0.1, 0.1, 0.1]);
    const s = loaded(good('a.dat', ds));
    assert.equal(s.range.qMin, 0.01);
    const sqrt = S.reduce(s, { type: 'setWeighting', mode: 'sqrtI' });
    assert.equal(sqrt.weighting, 'sqrtI');
    assert.equal(sqrt.weightingUserSet, true);
    assert.deepEqual({ ...sqrt.range }, { qMin: 0.02, qMax: 0.05, userEdited: false });
    const edited = run(s, { type: 'setRange', qMin: 0.01, qMax: 0.03 }, { type: 'setWeighting', mode: 'absI' });
    assert.deepEqual({ ...edited.range }, { qMin: 0.01, qMax: 0.03, userEdited: true });
    assert.equal(edited.weighting, 'absI');
});

test('setWeighting: sigma without usable sigma and unknown modes are Errors; no data is fine', () => {
    const s = loaded(good('b.dat', noSigma('b.dat')));
    assert.throws(() => S.reduce(s, { type: 'setWeighting', mode: 'sigma' }), /sigma/);
    assert.throws(() => S.reduce(s, { type: 'setWeighting', mode: 'poisson' }), /poisson/);
    const empty = S.reduce(S.initial(), { type: 'setWeighting', mode: 'none' });
    assert.equal(empty.weighting, 'none');
    assert.equal(empty.range, null);
    assert.equal(S.reduce(empty, add(good('a.dat'))).weighting, 'none', 'a choice made before loading is kept');
});

test('setRange / rangeDefault / rangeFull', () => {
    const ds = dataset('a.dat', [-0.01, 0, 0.01, 0.02, NaN, 0.05], [1, 1, 0, 4, 3, 2], [1, 1, 1, 1, 1, 0]);
    const s = loaded(good('a.dat', ds));
    assert.deepEqual({ ...s.range }, { qMin: 0.01, qMax: 0.02, userEdited: false });
    const set = S.reduce(s, { type: 'setRange', qMin: 0.015, qMax: 0.04 });
    assert.deepEqual({ ...set.range }, { qMin: 0.015, qMax: 0.04, userEdited: true });
    assert.deepEqual({ ...S.reduce(set, { type: 'rangeDefault' }).range }, { qMin: 0.01, qMax: 0.02, userEdited: false });
    assert.deepEqual({ ...S.reduce(s, { type: 'rangeFull' }).range }, { qMin: 0.01, qMax: 0.05, userEdited: true });
    assert.deepEqual(S.fullRange(ds), { qMin: 0.01, qMax: 0.05 });
    assert.equal(S.fullRange(dataset('n.dat', [0, -1, NaN], [1, 1, 1], null)), null);
    assert.throws(() => S.reduce(s, { type: 'setRange', qMin: NaN, qMax: 1 }), /qMin/);
    assert.throws(() => S.reduce(s, { type: 'setRange', qMin: 0.1, qMax: '1' }), /qMax/);
    ['setRange', 'rangeDefault', 'rangeFull'].forEach((type) => {
        assert.throws(() => S.reduce(S.initial(), { type, qMin: 0.1, qMax: 1 }), /active dataset/, type);
    });
});

test('setRange keeps an inverted range as typed (fit readiness reports it)', () => {
    const s = S.reduce(loaded(good('a.dat')), { type: 'setRange', qMin: 0.04, qMax: 0.02 });
    assert.deepEqual({ ...s.range }, { qMin: 0.04, qMax: 0.02, userEdited: true });
});

test('removeFile: drops shown and fitResults of the file; other files keep theirs', () => {
    let s = loaded(good('a.dat'), good('b.dat'));
    s = run(s, { type: 'fitStarted' }, { type: 'fitSettled', result: RESULT('converged') },
        { type: 'setActive', id: 'd2' }, { type: 'fitStarted' }, { type: 'fitSettled', result: RESULT('maxiter') });
    assert.deepEqual(Object.keys(s.fitResults), ['d1', 'd2']);
    const gone = S.reduce(s, { type: 'removeFile', id: 'd1' });
    assert.deepEqual(gone.files.map((f) => f.id), ['d2']);
    assert.deepEqual(Object.keys(gone.fitResults), ['d2']);
    assert.deepEqual({ ...gone.shown }, { d2: true });
    assert.equal(gone.activeId, 'd2');
    assert.throws(() => S.reduce(s, { type: 'removeFile', id: 'zz' }), /Unknown file id: zz/);
});

test('removeFile of the active file: next file with a dataset, else the previous one, else back to the start', () => {
    const s = loaded(good('a.dat'), good('b.dat'), bad('x.dat'), good('c.dat', noSigma('c.dat')));
    const onB = S.reduce(s, { type: 'setActive', id: 'd2' });
    const next = S.reduce(onB, { type: 'removeFile', id: 'd2' });
    assert.equal(next.activeId, 'd4', 'skips the failed file');
    assert.equal(next.weighting, 'none', 'the activation rule applies');
    const prev = S.reduce(next, { type: 'removeFile', id: 'd4' });
    assert.equal(prev.activeId, 'd1');
    assert.equal(prev.weighting, 'sigma');
    const custom = run(prev, { type: 'setWeighting', mode: 'absI' }, { type: 'setRange', qMin: 0.02, qMax: 0.03 });
    const empty = S.reduce(custom, { type: 'removeFile', id: 'd1' });
    assert.equal(empty.activeId, null);
    assert.equal(empty.range, null);
    assert.equal(empty.weighting, 'sigma');
    assert.equal(empty.weightingUserSet, false);
    assert.deepEqual(empty.files.map((f) => f.id), ['d3']);
    assert.equal(S.reduce(empty, { type: 'removeFile', id: 'd3' }).files.length, 0);
});

test('setCondition changes only the file entry; setConditionName', () => {
    const s = loaded(good('a_10.dat'), good('b.dat'));
    const ds = s.files[0].dataset;
    const t = S.reduce(s, { type: 'setCondition', id: 'd1', value: 12.5 });
    assert.equal(t.files[0].condition, 12.5);
    assert.equal(t.files[0].dataset, ds);
    assert.equal(ds.condition, 10);
    assert.equal(t.files[1], s.files[1]);
    assert.equal(S.reduce(t, { type: 'setCondition', id: 'd1', value: null }).files[0].condition, null);
    [NaN, Infinity, '3', undefined].forEach((value) => {
        assert.throws(() => S.reduce(s, { type: 'setCondition', id: 'd1', value }), /condition/);
    });
    assert.equal(S.reduce(s, { type: 'setConditionName', name: 'Temperature (K)' }).conditionName, 'Temperature (K)');
    assert.throws(() => S.reduce(s, { type: 'setConditionName', name: 5 }), /name/);
});

test('setShown, setMaxSteps, setPlotMode, setStagger, setTab, setPlotView validate their payload', () => {
    const s = loaded(good('a.dat'), good('b.dat'));
    assert.equal(S.reduce(s, { type: 'setShown', id: 'd2', shown: false }).shown.d2, false);
    assert.throws(() => S.reduce(s, { type: 'setShown', id: 'd2', shown: 1 }), /shown/);
    assert.equal(S.reduce(s, { type: 'setMaxSteps', value: 1 }).maxSteps, 1);
    assert.equal(S.reduce(s, { type: 'setMaxSteps', value: Core.MAX_STEPS }).maxSteps, 10000);
    [0, 1.5, Core.MAX_STEPS + 1, '200', NaN].forEach((value) => {
        assert.throws(() => S.reduce(s, { type: 'setMaxSteps', value }), /maxSteps/);
    });
    S.PLOT_MODES.forEach((mode) => assert.equal(S.reduce(s, { type: 'setPlotMode', mode }).plotMode, mode));
    assert.throws(() => S.reduce(s, { type: 'setPlotMode', mode: 'zimm' }), /zimm/);
    assert.deepEqual({ ...S.reduce(s, { type: 'setStagger', on: true, decades: 0 }).stagger }, { on: true, decades: 0 });
    assert.deepEqual({ ...S.reduce(s, { type: 'setStagger', on: true, decades: 0.5 }).stagger }, { on: true, decades: 0.5 });
    [-1, NaN, Infinity, '1'].forEach((decades) => {
        assert.throws(() => S.reduce(s, { type: 'setStagger', on: true, decades }), /decades/);
    });
    assert.throws(() => S.reduce(s, { type: 'setStagger', on: 'yes', decades: 1 }), /on/);
    S.TABS.forEach((tab) => assert.equal(S.reduce(s, { type: 'setTab', tab }).tab, tab));
    assert.equal(S.reduce(s, { type: 'setTab', tab: 'sequence' }).tab, 'sequence');
    assert.throws(() => S.reduce(s, { type: 'setTab', tab: 'export' }), /Unknown tab: export/);
    assert.equal(s.plotView, 'curve');
    S.PLOT_VIEWS.forEach((view) => assert.equal(S.reduce(s, { type: 'setPlotView', view }).plotView, view));
    ['3d', undefined, null, 'Shape'].forEach((view) => {
        assert.throws(() => S.reduce(s, { type: 'setPlotView', view }), /Unknown plot view/);
    });
});

test('fit life cycle: started, progress, settled', () => {
    const s = loaded(good('a.dat'), good('b.dat'));
    const started = S.reduce(s, { type: 'fitStarted' });
    assert.deepEqual({ ...started.fit }, { phase: 'running', datasetId: 'd1', iteration: 0, chi2r: null, outcome: null });
    const going = S.reduce(started, { type: 'fitProgress', iteration: 3, chi2r: 4.5 });
    assert.deepEqual({ ...going.fit }, { phase: 'running', datasetId: 'd1', iteration: 3, chi2r: 4.5, outcome: null });
    const result = RESULT('converged');
    const done = S.reduce(going, { type: 'fitSettled', result });
    assert.deepEqual({ ...done.fit }, { phase: 'idle', datasetId: 'd1', iteration: 7, chi2r: 1.2, outcome: 'converged' });
    assert.equal(done.fitResults.d1, result, 'kept by reference');
    assert.equal(S.datasetStatus(done, 'd1'), 'converged');
    assert.equal(S.datasetStatus(done, 'd2'), 'none');
    assert.throws(() => S.datasetStatus(done, 'zz'), /Unknown file id/);
    assert.throws(() => S.reduce(S.initial(), { type: 'fitStarted' }), /active dataset/);
});

test('fitStarted { id } fits another dataset without changing the active one (sequence fitting)', () => {
    const s = loaded(good('a.dat'), good('b.dat'), bad('x.dat'));
    const started = S.reduce(s, { type: 'fitStarted', id: 'd2' });
    assert.equal(started.fit.datasetId, 'd2');
    assert.equal(started.activeId, 'd1');
    const done = S.reduce(started, { type: 'fitSettled', result: RESULT('failed') });
    assert.deepEqual(Object.keys(done.fitResults), ['d2']);
    assert.equal(S.datasetStatus(done, 'd2'), 'failed');
    assert.throws(() => S.reduce(s, { type: 'fitStarted', id: 'd3' }), /no data/);
});

test('fitSettled: stopped keeps the earlier result; null (an error) only ends the run', () => {
    const first = RESULT('maxiter');
    const s = run(loaded(good('a.dat')), { type: 'fitStarted' }, { type: 'fitSettled', result: first }, { type: 'fitStarted' });
    const stopped = S.reduce(s, { type: 'fitSettled', result: RESULT('stopped', { chi2r: null, iterations: 4 }) });
    assert.equal(stopped.fitResults.d1, first);
    assert.deepEqual({ ...stopped.fit }, { phase: 'idle', datasetId: 'd1', iteration: 4, chi2r: null, outcome: 'stopped' });
    const errored = S.reduce(S.reduce(s, { type: 'fitProgress', iteration: 2, chi2r: 9 }), { type: 'fitSettled', result: null });
    assert.equal(errored.fitResults.d1, first);
    assert.deepEqual({ ...errored.fit }, { phase: 'idle', datasetId: 'd1', iteration: 2, chi2r: 9, outcome: 'error' });
    assert.throws(() => S.reduce(s, { type: 'fitSettled', result: { status: 'done' } }), /status/);
    assert.throws(() => S.reduce(s, { type: 'fitSettled' }), /result/);
});

test('fitProgress / fitSettled outside a running fit are Errors', () => {
    const s = loaded(good('a.dat'));
    assert.throws(() => S.reduce(s, { type: 'fitProgress', iteration: 1, chi2r: 1 }), /no fit is running/);
    assert.throws(() => S.reduce(s, { type: 'fitSettled', result: null }), /no fit is running/);
    const running = S.reduce(s, { type: 'fitStarted' });
    assert.throws(() => S.reduce(running, { type: 'fitProgress', iteration: -1, chi2r: 1 }), /iteration/);
    assert.throws(() => S.reduce(running, { type: 'fitProgress', iteration: 1, chi2r: '1' }), /chi2r/);
    assert.equal(S.reduce(running, { type: 'fitProgress', iteration: 1, chi2r: Infinity }).fit.chi2r, Infinity);
});

const ALLOWED_WHILE_RUNNING = [
    { type: 'setShown', id: 'd2', shown: false },
    { type: 'setPlotMode', mode: 'kratky' },
    { type: 'setStagger', on: true, decades: 2 },
    { type: 'setTab', tab: 'fit' },
    { type: 'setConditionName', name: '幀號' },
    { type: 'setCondition', id: 'd1', value: 3 },
    { type: 'clearNotice' },
    { type: 'dismissRemoved' },
    { type: 'fitProgress', iteration: 1, chi2r: 2 },
    { type: 'fitSettled', result: null },
    { type: 'setPlotView', view: 'shape' },
    { type: 'setSeqY', name: 'radius' },
];
const SEQ_PLAN = Object.freeze({ items: [{ id: 'd1', range: { qMin: 0.01, qMax: 0.05 }, note: '', skip: null }], warnings: [] });
const SEQ_SETTINGS = Object.freeze({ weighting: 'sigma', maxSteps: 200, rangeEdited: false });
const SEQ_FORM = Object.freeze({ model: 'sphere' });
const SEQ_ROW = Object.freeze({ id: 'd1', state: 'done', result: null, range: null, note: '', startedFrom: null });
/** Blocked while a single fit runs, and an Error without a running sequence too. */
const NEEDS_A_SEQUENCE = ['seqStep', 'seqSettled'];
const BLOCKED_WHILE_RUNNING = [
    { type: 'setSeqSelected', id: 'd2', selected: false },
    { type: 'setSeqAll', selected: false },
    { type: 'setSeqOption', key: 'chain', value: false },
    { type: 'seqStarted', plan: SEQ_PLAN, form: SEQ_FORM, settings: SEQ_SETTINGS },
    { type: 'seqStep', id: 'd1', row: SEQ_ROW, next: null },
    { type: 'seqSettled', outcome: 'finished' },
    add(good('c.dat')),
    { type: 'removeFile', id: 'd2' },
    { type: 'undoRemove' },
    { type: 'setActive', id: 'd2' },
    { type: 'setRange', qMin: 0.02, qMax: 0.03 },
    { type: 'rangeDefault' },
    { type: 'rangeFull' },
    { type: 'setWeighting', mode: 'none' },
    { type: 'setMaxSteps', value: 50 },
    { type: 'fitStarted' },
];

test('the two lists cover every action type', () => {
    const listed = ALLOWED_WHILE_RUNNING.concat(BLOCKED_WHILE_RUNNING).map((a) => a.type).sort();
    assert.deepEqual(listed, [...S.ACTION_TYPES].sort());
    assert.deepEqual(ALLOWED_WHILE_RUNNING.map((a) => a.type).sort(), [...S.RUNNING_ACTIONS].sort());
});

const runningState = () => S.reduce(loaded(good('a.dat'), good('b.dat')), { type: 'fitStarted' });

ALLOWED_WHILE_RUNNING.forEach((action) => {
    test('while a fit is running: ' + action.type + ' is allowed', () => {
        const before = runningState();
        const after = S.reduce(before, action);
        assert.notEqual(after, before);
        assert.ok(isDeepFrozen(after));
    });
});

BLOCKED_WHILE_RUNNING.forEach((action) => {
    test('while a fit is running: ' + action.type + ' throws', () => {
        assert.throws(() => S.reduce(runningState(), action), new RegExp(action.type + ' is not allowed while a fit is running'));
    });
});

test('BLOCKED actions all work when no fit is running (the lock is what stops them)', () => {
    const idle = S.reduce(loaded(good('a.dat'), good('b.dat'), good('z.dat')), { type: 'removeFile', id: 'd3' });      // something to undo
    BLOCKED_WHILE_RUNNING.filter((a) => NEEDS_A_SEQUENCE.indexOf(a.type) < 0)
        .forEach((action) => assert.ok(S.reduce(idle, action), action.type));
    NEEDS_A_SEQUENCE.forEach((type) => {
        const action = BLOCKED_WHILE_RUNNING.find((a) => a.type === type);
        assert.throws(() => S.reduce(idle, action), new RegExp(type + ': no sequence is running'));
    });
});

test('shownFiles: list order, list index, the active file even when unticked, never a failed file', () => {
    const s = run(loaded(bad('x.dat'), good('a.dat'), good('b.dat'), good('c.dat')),
        { type: 'setShown', id: 'd2', shown: false }, { type: 'setShown', id: 'd3', shown: false });
    const shown = S.shownFiles(s);
    assert.deepEqual(shown.map((f) => [f.id, f.index]), [['d2', 1], ['d4', 3]]);
    assert.equal(shown[0].dataset, s.files[1].dataset);
    assert.equal(shown[0].fileName, 'a.dat');
    assert.ok(Object.isFrozen(shown) && Object.isFrozen(shown[0]));
});

test('nextTab: arrows cycle, Home / End, other keys stay', () => {
    assert.equal(S.nextTab(S.TABS, 'fit', 'ArrowRight'), 'sequence');
    assert.equal(S.nextTab(S.TABS, 'model', 'End'), 'sequence');
    assert.equal(S.nextTab(S.TABS, 'sequence', 'ArrowRight'), 'data');
    assert.equal(S.nextTab(S.TABS, 'data', 'ArrowLeft'), 'sequence');
    assert.equal(S.nextTab(S.TABS, 'sequence', 'Home'), 'data');
    const tabs = ['data', 'model', 'fit'];                 // a page that has only these three (until the fourth button lands)
    assert.equal(S.nextTab(tabs, 'data', 'ArrowLeft'), 'fit');
    assert.equal(S.nextTab(tabs, 'fit', 'ArrowRight'), 'data');
    assert.equal(S.nextTab(tabs, 'data', 'ArrowRight'), 'model');
    assert.equal(S.nextTab(tabs, 'model', 'ArrowLeft'), 'data');
    assert.equal(S.nextTab(tabs, 'model', 'Home'), 'data');
    assert.equal(S.nextTab(tabs, 'model', 'End'), 'fit');
    assert.equal(S.nextTab(tabs, 'model', 'Enter'), 'model');
    assert.throws(() => S.nextTab(tabs, 'nope', 'Home'), /nope/);
});

test('reduce: unknown action types and non-objects are Errors', () => {
    assert.throws(() => S.reduce(S.initial(), { type: 'explode' }), /Unknown action type: explode/);
    assert.throws(() => S.reduce(S.initial(), null), /action/);
    assert.throws(() => S.reduce(null, { type: 'clearNotice' }), /state/);
});

test('every action returns a new deep-frozen state, leaves its input alone and shares datasets / results', () => {
    const q = Float64Array.from(Q5);
    const ds = withSigma('a.dat');
    const result = RESULT('converged', { curve: Float64Array.from(Q5) });
    const actions = [
        add(good('a.dat', ds), good('b.dat'), bad('x.dat')),
        { type: 'setActive', id: 'd2' }, { type: 'setActive', id: 'd1' },
        { type: 'setShown', id: 'd2', shown: false }, { type: 'setCondition', id: 'd1', value: 4 },
        { type: 'setConditionName', name: 'T' }, { type: 'setRange', qMin: 0.02, qMax: 0.04 },
        { type: 'rangeDefault' }, { type: 'rangeFull' }, { type: 'setWeighting', mode: 'sqrtI' },
        { type: 'setMaxSteps', value: 30 }, { type: 'setPlotMode', mode: 'guinier' },
        { type: 'setStagger', on: true, decades: 1 }, { type: 'setTab', tab: 'model' },
        { type: 'setPlotView', view: 'shape' }, { type: 'setSeqSelected', id: 'd2', selected: false },
        { type: 'setSeqAll', selected: true }, { type: 'setSeqOption', key: 'sort', value: false },
        { type: 'setSeqY', name: 'radius' },
        { type: 'seqStarted', plan: SEQ_PLAN, form: SEQ_FORM, settings: SEQ_SETTINGS },
        { type: 'seqStep', id: 'd1', row: { ...SEQ_ROW, result: RESULT('maxiter') }, next: null },
        { type: 'seqSettled', outcome: 'finished' },
        { type: 'fitStarted' }, { type: 'fitProgress', iteration: 1, chi2r: 3 }, { type: 'fitSettled', result },
        { type: 'removeFile', id: 'd3' }, { type: 'undoRemove' }, { type: 'removeFile', id: 'd2' }, { type: 'dismissRemoved' },
        { type: 'clearNotice' },
    ];
    assert.deepEqual(actions.map((a) => a.type).filter((t, i, all) => all.indexOf(t) === i).sort(), [...S.ACTION_TYPES].sort());
    let state = S.initial();
    actions.forEach((action) => {
        const snapshot = JSON.stringify(state);
        const next = S.reduce(state, action);
        assert.notEqual(next, state, action.type);
        assert.ok(isDeepFrozen(next), action.type);
        assert.equal(JSON.stringify(state), snapshot, action.type + ' changed its input');
        state = next;
    });
    assert.equal(state.files[0].dataset, ds);
    assert.equal(state.fitResults.d1, result);
    assert.deepEqual([...ds.q], [...q], 'typed arrays are not written to');
});

// ------------------------------------------------------------------ undo of a removal (fix pass B)

test('removeFile remembers the file; undoRemove puts it back at its place with its shown tick and its FitResult', () => {
    const result = RESULT('converged', { curve: Float64Array.from(Q5) });
    let s = S.reduce(S.initial(), add(good('a.dat'), good('b.dat'), good('c.dat')));
    s = S.reduce(s, { type: 'setActive', id: 'd2' });
    s = S.reduce(s, { type: 'setShown', id: 'd2', shown: false });
    s = S.reduce(S.reduce(s, { type: 'fitStarted' }), { type: 'fitSettled', result });
    assert.equal(s.removed, null);
    const before = s;
    const gone = S.reduce(s, { type: 'removeFile', id: 'd2' });
    assert.ok(isDeepFrozen(gone));
    assert.deepEqual(gone.files.map((f) => f.id), ['d1', 'd3']);
    assert.equal('d2' in gone.fitResults, false);
    assert.equal(gone.activeId, 'd3', 'the next file takes over');
    assert.equal(gone.removed.file, before.files[1]);
    assert.deepEqual([gone.removed.index, gone.removed.shown, gone.removed.wasActive], [1, false, true]);
    assert.equal(gone.removed.result, result);
    const back = S.reduce(gone, { type: 'undoRemove' });
    assert.ok(isDeepFrozen(back));
    assert.deepEqual(back.files.map((f) => f.id), ['d1', 'd2', 'd3']);
    assert.equal(back.files[1], before.files[1], 'the same entry (dataset by reference)');
    assert.equal(back.fitResults.d2, result, 'the fit result is restored');
    assert.equal(back.shown.d2, false);
    assert.equal(back.activeId, 'd2', 'it was the active one: it is again');
    assert.equal(back.removed, null);
    assert.equal(JSON.stringify(gone.files.map((f) => f.id)), '["d1","d3"]', 'undo did not change its input');
});

test('undoRemove: a file that was not active stays inactive; the last file of the list returns to the end; a failed file comes back too', () => {
    let s = S.reduce(S.initial(), add(good('a.dat'), bad('x.dat'), good('c.dat')));
    const last = S.reduce(S.reduce(s, { type: 'removeFile', id: 'd3' }), { type: 'undoRemove' });
    assert.deepEqual(last.files.map((f) => f.id), ['d1', 'd2', 'd3']);
    assert.equal(last.activeId, 'd1');
    assert.equal(last.shown.d3, true);
    const failed = S.reduce(S.reduce(s, { type: 'removeFile', id: 'd2' }), { type: 'undoRemove' });
    assert.deepEqual(failed.files.map((f) => f.id), ['d1', 'd2', 'd3']);
    assert.equal('d2' in failed.shown, false, 'a file without data has no shown entry');
    s = S.reduce(S.initial(), add(good('only.dat')));
    const empty = S.reduce(s, { type: 'removeFile', id: 'd1' });
    assert.equal(empty.activeId, null);
    const again = S.reduce(empty, { type: 'undoRemove' });
    assert.equal(again.activeId, 'd1');
    assert.notEqual(again.range, null, 'the range follows the restored data');
});

test('undoRemove: only the last removal, only until the list changes; dismissRemoved forgets it; nothing to undo is an Error', () => {
    let s = S.reduce(S.initial(), add(good('a.dat'), good('b.dat'), good('c.dat')));
    assert.throws(() => S.reduce(s, { type: 'undoRemove' }), /nothing to undo/);
    s = S.reduce(S.reduce(s, { type: 'removeFile', id: 'd1' }), { type: 'removeFile', id: 'd2' });
    assert.equal(s.removed.file.id, 'd2');
    assert.deepEqual(S.reduce(s, { type: 'undoRemove' }).files.map((f) => f.id), ['d2', 'd3']);
    assert.equal(S.reduce(s, add(good('d.dat'))).removed, null, 'loading files forgets the removed one');
    const dismissed = S.reduce(s, { type: 'dismissRemoved' });
    assert.equal(dismissed.removed, null);
    assert.throws(() => S.reduce(dismissed, { type: 'undoRemove' }), /nothing to undo/);
    const d4 = S.reduce(S.reduce(s, { type: 'undoRemove' }), add(good('e.dat')));
    assert.deepEqual(d4.files.map((f) => f.id), ['d2', 'd3', 'd4'], 'ids are never reused: the restored id cannot clash');
});
