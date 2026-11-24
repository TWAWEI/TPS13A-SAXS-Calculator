'use strict';
/**
 * sasfit-state.js: the sequence part of the page state -- file selection,
 * options, the run (seqStarted / seqStep / seqSettled) and what is locked
 * while a sequence runs (design spec 7; plan M4 Task 2).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitState: S, SasFitForm: Form, SasFitDataIo: IO } = require('./load.js');

const isView = (o) => ArrayBuffer.isView(o);
const isDeepFrozen = (o) => o === null || typeof o !== 'object' || isView(o)
    || (Object.isFrozen(o) && Object.values(o).every(isDeepFrozen));
const run = (state, ...actions) => actions.reduce((s, a) => S.reduce(s, a), state);

const NOTES = Object.freeze({ skipped: 0, placeholders: 0, sorted: false, suspectNm: false });
const Q5 = [0.01, 0.02, 0.03, 0.04, 0.05];
function dataset(fileName) {
    return Object.freeze({
        fileName, kind: 'generic', header: null, q: Float64Array.from(Q5), I: Float64Array.from([5, 4, 3, 2, 1]),
        sigma: Float64Array.from([0.1, 0.1, 0.1, 0.1, 0.1]), dq: null, condition: IO.conditionFromName(fileName), qUnit: 'A',
    });
}
const good = (name) => Object.freeze({ fileName: name, dataset: dataset(name), issues: Object.freeze([]), notes: NOTES });
const bad = (name) => Object.freeze({ fileName: name, dataset: null, issues: Object.freeze([]), notes: NOTES });
const add = (...files) => ({ type: 'addFiles', files });
const loaded = (...files) => S.reduce(S.initial(), add(...files));
const RESULT = (status, extra) => Object.freeze({ status, chi2r: 1.2, iterations: 7, params: Object.freeze({}), ...extra });

const FORM = Form.create('sphere');
const SETTINGS = Object.freeze({ weighting: 'sigma', maxSteps: 200, rangeEdited: false });
const RANGE = Object.freeze({ qMin: 0.01, qMax: 0.05 });
const item = (id, extra) => ({ id, range: RANGE, note: '', skip: null, ...extra });
const plan = (items, warnings) => ({ items, warnings: warnings || [] });
const started = (state, items, warnings) => S.reduce(state, { type: 'seqStarted', plan: plan(items, warnings), form: FORM, settings: SETTINGS });
const row = (id, state, extra) => ({ id, state, result: null, range: RANGE, note: '', startedFrom: null, ...extra });
const step = (id, state, next, extra) => ({ type: 'seqStep', id, row: row(id, state, extra), next });

/** d1 a.dat, d2 x.dat (failed), d3 b.dat, d4 c.dat */
const four = () => loaded(good('a_10.dat'), bad('x.dat'), good('b_20.dat'), good('c_30.dat'));
const ids = (files) => files.map((f) => f.id);

// ------------------------------------------------------------------ selection and options

test('seqSelectedFiles: files with data count as selected until they are set to false; failed files never', () => {
    const s = four();
    assert.deepEqual({ ...s.seq.selected }, {}, 'loading files writes no selection');
    assert.deepEqual(ids(S.seqSelectedFiles(s)), ['d1', 'd3', 'd4']);
    assert.ok(Object.isFrozen(S.seqSelectedFiles(s)));
    assert.equal(S.seqSelectedFiles(s)[1], s.files[2], 'the file entries themselves');
    const off = S.reduce(s, { type: 'setSeqSelected', id: 'd3', selected: false });
    assert.deepEqual({ ...off.seq.selected }, { d3: false });
    assert.deepEqual(ids(S.seqSelectedFiles(off)), ['d1', 'd4']);
    const on = S.reduce(off, { type: 'setSeqSelected', id: 'd3', selected: true });
    assert.deepEqual(ids(S.seqSelectedFiles(on)), ['d1', 'd3', 'd4']);
    assert.ok(isDeepFrozen(on));
    assert.deepEqual(S.seqSelectedFiles(S.initial()), []);
});

test('setSeqSelected: unknown ids, files without data and non-booleans are Errors', () => {
    const s = four();
    assert.throws(() => S.reduce(s, { type: 'setSeqSelected', id: 'zz', selected: true }), /Unknown file id: zz/);
    assert.throws(() => S.reduce(s, { type: 'setSeqSelected', id: 'd2', selected: true }), /d2.*no data/);
    assert.throws(() => S.reduce(s, { type: 'setSeqSelected', id: 'd1', selected: 1 }), /selected/);
});

test('setSeqAll writes every file with data; addFiles leaves the ticks alone', () => {
    const s = four();
    const none = S.reduce(s, { type: 'setSeqAll', selected: false });
    assert.deepEqual({ ...none.seq.selected }, { d1: false, d3: false, d4: false });
    assert.deepEqual(S.seqSelectedFiles(none), []);
    const more = S.reduce(none, add(good('d_40.dat')));
    assert.equal(more.seq.selected, none.seq.selected, 'addFiles does not touch the selection');
    assert.deepEqual(ids(S.seqSelectedFiles(more)), ['d5'], 'a new file starts selected');
    const all = S.reduce(more, { type: 'setSeqAll', selected: true });
    assert.deepEqual({ ...all.seq.selected }, { d1: true, d3: true, d4: true, d5: true });
    assert.throws(() => S.reduce(s, { type: 'setSeqAll', selected: 'yes' }), /selected/);
});

test('setSeqOption: chain and sort are booleans; setSeqY: a name or null', () => {
    const s = four();
    const next = run(s, { type: 'setSeqOption', key: 'chain', value: false });
    assert.deepEqual({ ...next.seq.options }, { chain: false, sort: true });
    assert.deepEqual({ ...S.reduce(next, { type: 'setSeqOption', key: 'sort', value: false }).seq.options }, { chain: false, sort: false });
    assert.throws(() => S.reduce(s, { type: 'setSeqOption', key: 'order', value: true }), /Unknown sequence option: order/);
    assert.throws(() => S.reduce(s, { type: 'setSeqOption', key: 'toString', value: true }), /Unknown sequence option/);
    assert.throws(() => S.reduce(s, { type: 'setSeqOption', key: 'chain', value: 1 }), /value/);
    assert.equal(S.reduce(s, { type: 'setSeqY', name: 'radius' }).seq.y, 'radius');
    assert.equal(run(s, { type: 'setSeqY', name: '$measure' }, { type: 'setSeqY', name: null }).seq.y, null);
    ['', 3, undefined].forEach((name) => assert.throws(() => S.reduce(s, { type: 'setSeqY', name }), /setSeqY/));
});

// ------------------------------------------------------------------ removal and undo

test('removeFile takes the selection, the row and the place in the order with it; undoRemove puts them back', () => {
    let s = run(four(), { type: 'setSeqSelected', id: 'd3', selected: false });
    s = started(s, [item('d4'), item('d3', { skip: '沒有可用的誤差欄', range: null }), item('d1')]);
    s = run(s, step('d4', 'done', 'd1', { result: RESULT('converged') }), step('d1', 'done', null, { result: RESULT('maxiter') }),
        { type: 'seqSettled', outcome: 'finished' });
    assert.deepEqual([...s.seq.order], ['d4', 'd3', 'd1']);
    const rowD3 = s.seq.rows.d3;
    const gone = S.reduce(s, { type: 'removeFile', id: 'd3' });
    assert.ok(isDeepFrozen(gone));
    assert.deepEqual([...gone.seq.order], ['d4', 'd1']);
    assert.deepEqual(Object.keys(gone.seq.rows).sort(), ['d1', 'd4']);
    assert.equal('d3' in gone.seq.selected, false);
    assert.deepEqual([gone.removed.seqSelected, gone.removed.seqOrderAt], [false, 1]);
    assert.equal(gone.removed.seqRow, rowD3);
    const back = S.reduce(gone, { type: 'undoRemove' });
    assert.ok(isDeepFrozen(back));
    assert.deepEqual([...back.seq.order], ['d4', 'd3', 'd1']);
    assert.equal(back.seq.rows.d3, rowD3);
    assert.equal(back.seq.selected.d3, false);
    assert.deepEqual([...s.seq.order], ['d4', 'd3', 'd1'], 'the earlier states are untouched');
    assert.deepEqual([...gone.seq.order], ['d4', 'd1']);
});

test('removeFile / undoRemove of a file the sequence never saw: nothing of seq is invented', () => {
    const s = four();
    const gone = S.reduce(s, { type: 'removeFile', id: 'd3' });
    assert.deepEqual([gone.removed.seqSelected, gone.removed.seqRow, gone.removed.seqOrderAt], [null, null, null]);
    assert.equal(gone.seq.order, null);
    const back = S.reduce(gone, { type: 'undoRemove' });
    assert.equal(back.seq.order, null);
    assert.deepEqual({ ...back.seq.selected }, {});
    assert.deepEqual({ ...back.seq.rows }, {});
    // a failed file: in no map at all
    const failed = S.reduce(S.reduce(s, { type: 'removeFile', id: 'd2' }), { type: 'undoRemove' });
    assert.deepEqual({ ...failed.seq.selected }, {});
    // in the order but removed, then the order shrank meanwhile is impossible (a new removal replaces `removed`);
    // the place is still clamped to the length of the order
    let t = started(s, [item('d1'), item('d3')]);
    t = run(t, step('d1', 'done', 'd3'), step('d3', 'done', null), { type: 'seqSettled', outcome: 'finished' });
    const last = S.reduce(S.reduce(t, { type: 'removeFile', id: 'd3' }), { type: 'undoRemove' });
    assert.deepEqual([...last.seq.order], ['d1', 'd3']);
});

// ------------------------------------------------------------------ seqStarted

test('seqStarted: both phases run, the first fittable item is fitted, rows are rebuilt from the plan', () => {
    const base = run(four(), { type: 'setSeqY', name: 'radius' });
    const items = [item('d4', { skip: '點數不足', range: null }), item('d1', { note: '擬合範圍截為 q 0.01–0.05 Å⁻¹' }), item('d3')];
    const s = started(base, items, ['1 個檔沒有條件值，排在最後：x.dat']);
    assert.ok(isDeepFrozen(s));
    assert.equal(s.seq.phase, 'running');
    assert.deepEqual({ ...s.fit }, { phase: 'running', datasetId: 'd1', iteration: 0, chi2r: null, outcome: null });
    assert.deepEqual([...s.seq.order], ['d4', 'd1', 'd3']);
    assert.deepEqual(JSON.parse(JSON.stringify(s.seq.rows)), {
        d4: { id: 'd4', state: 'skipped', result: null, range: null, note: '點數不足', startedFrom: null },
        d1: { id: 'd1', state: 'pending', result: null, range: RANGE, note: '擬合範圍截為 q 0.01–0.05 Å⁻¹', startedFrom: null },
        d3: { id: 'd3', state: 'pending', result: null, range: RANGE, note: '', startedFrom: null },
    });
    assert.deepEqual([...s.seq.warnings], ['1 個檔沒有條件值，排在最後：x.dat']);
    assert.equal(s.seq.form, FORM, 'the form snapshot is kept by reference');
    assert.deepEqual({ ...s.seq.settings }, { ...SETTINGS });
    assert.notEqual(s.seq.settings, SETTINGS, 'a copy: the caller may reuse its object');
    assert.equal(s.seq.outcome, null);
    assert.equal(s.seq.y, 'radius', 'the chosen trend y is kept');
    assert.equal(s.activeId, 'd1', 'the active dataset does not change');
});

test('seqStarted: an earlier run is cleared first (rows, order, warnings, outcome); fitResults stay', () => {
    let s = started(four(), [item('d1'), item('d3'), item('d4')], ['w']);
    s = run(s, step('d1', 'done', 'd3', { result: RESULT('converged') }), { type: 'seqSettled', outcome: 'stopped' });
    assert.equal(s.seq.outcome, 'stopped');
    const again = started(s, [item('d3')]);
    assert.deepEqual(Object.keys(again.seq.rows), ['d3']);
    assert.deepEqual([...again.seq.order], ['d3']);
    assert.deepEqual([...again.seq.warnings], []);
    assert.equal(again.seq.outcome, null);
    assert.equal(again.fit.outcome, null);
    assert.deepEqual(Object.keys(again.fitResults), ['d1'], 'results of the earlier run are kept');
});

test('seqStarted: a plan needs an item that is not skipped; bad plans, forms and settings are Errors', () => {
    const s = four();
    const start = (p, form, settings) => () => S.reduce(s, { type: 'seqStarted', plan: p, form, settings });
    assert.throws(start(plan([]), FORM, SETTINGS), /nothing to fit/);
    assert.throws(start(plan([item('d1', { skip: 'a' }), item('d3', { skip: 'b' })]), FORM, SETTINGS), /nothing to fit/);
    assert.throws(start(null, FORM, SETTINGS), /plan/);
    assert.throws(start({ items: 'd1', warnings: [] }, FORM, SETTINGS), /plan\.items/);
    assert.throws(start({ items: [item('d1')] }, FORM, SETTINGS), /plan\.warnings/);
    assert.throws(start(plan([item('zz')]), FORM, SETTINGS), /Unknown file id: zz/);
    assert.throws(start(plan([item('d2')]), FORM, SETTINGS), /d2.*no data/);
    assert.throws(start(plan([item('d1'), item('d1')]), FORM, SETTINGS), /twice/);
    assert.throws(start(plan([item('d1', { skip: 3 })]), FORM, SETTINGS), /skip/);
    assert.throws(start(plan([item('d1', { note: null })]), FORM, SETTINGS), /note/);
    assert.throws(start(plan([item('d1', { range: null })]), FORM, SETTINGS), /range/);
    assert.throws(start(plan([item('d1', { range: { qMin: 0.01, qMax: NaN } })]), FORM, SETTINGS), /range/);
    assert.throws(start(plan([item('d1')]), null, SETTINGS), /form/);
    assert.throws(start(plan([item('d1')]), FORM, null), /settings/);
    assert.throws(start(plan([item('d1')]), FORM, { ...SETTINGS, rangeEdited: 'no' }), /rangeEdited/);
    assert.throws(start(plan([item('d1')]), FORM, { ...SETTINGS, weighting: 'poisson' }), /weighting/);
    assert.throws(start(plan([item('d1')]), FORM, { ...SETTINGS, maxSteps: 0 }), /maxSteps/);
});

test('seqStarted does not modify the plan, the form or the settings it is given', () => {
    const p = plan([item('d1'), item('d3', { skip: 'x' })], ['w']);
    const before = JSON.stringify(p);
    const s = S.reduce(four(), { type: 'seqStarted', plan: p, form: FORM, settings: SETTINGS });
    assert.equal(JSON.stringify(p), before);
    assert.equal(Object.isFrozen(p.items), false, 'the plan itself is not frozen by the reducer');
    assert.notEqual(s.seq.rows.d1.range, p.items[0].range);
    assert.ok(Object.isFrozen(s.seq.rows.d1.range));
});

// ------------------------------------------------------------------ seqStep

test('seqStep: stores the row and its result, and moves to the next dataset without passing through idle', () => {
    const result = RESULT('converged', { curve: Float64Array.from(Q5) });
    let s = started(four(), [item('d1'), item('d3'), item('d4')]);
    s = S.reduce(s, { type: 'fitProgress', iteration: 4, chi2r: 9 });
    const next = S.reduce(s, step('d1', 'done', 'd3', { result, startedFrom: null, note: 'n' }));
    assert.ok(isDeepFrozen(next));
    assert.deepEqual({ ...next.fit }, { phase: 'running', datasetId: 'd3', iteration: 0, chi2r: null, outcome: null });
    assert.equal(next.seq.phase, 'running');
    assert.equal(next.fitResults.d1, result, 'shared with single fitting, by reference');
    assert.equal(next.seq.rows.d1.result, result);
    assert.deepEqual([next.seq.rows.d1.state, next.seq.rows.d1.note], ['done', 'n']);
    assert.equal(next.seq.rows.d3.state, 'pending');
    const third = S.reduce(next, step('d3', 'error', 'd4', { note: '參數超出範圍' }));
    assert.equal(third.fit.datasetId, 'd4');
    assert.equal('d3' in third.fitResults, false, 'a row without a result stores none');
    assert.equal(third.seq.rows.d3.state, 'error');
    const end = S.reduce(third, step('d4', 'done', null, { result: RESULT('maxiter'), startedFrom: 'd1' }));
    assert.equal(end.fit.phase, 'running', 'still running until seqSettled');
    assert.equal(end.seq.phase, 'running');
    assert.equal(end.fit.datasetId, 'd4');
    assert.equal(end.seq.rows.d4.startedFrom, 'd1');
    assert.equal(S.datasetStatus(end, 'd4'), 'maxiter');
});

test('seqStep: a stopped result is not stored anywhere; the earlier result of that dataset is kept', () => {
    const earlier = RESULT('converged');
    let s = run(four(), { type: 'fitStarted' }, { type: 'fitSettled', result: earlier });
    s = started(s, [item('d1'), item('d3')]);
    const stopped = S.reduce(s, step('d1', 'pending', null, { result: RESULT('stopped', { chi2r: null }) }));
    assert.equal(stopped.fitResults.d1, earlier);
    assert.equal(stopped.seq.rows.d1.result, null, 'the row does not keep a stopped result either');
    assert.equal(stopped.seq.rows.d1.state, 'pending');
});

test('seqStep: the id must be the dataset being fitted; rows and next are validated', () => {
    const s = started(four(), [item('d1'), item('d3'), item('d4', { skip: 'x' })]);
    assert.throws(() => S.reduce(s, step('d3', 'done', null)), /seqStep: d3 is not the dataset being fitted \(d1\)/);
    assert.throws(() => S.reduce(s, { type: 'seqStep', id: 'd1', row: row('d3', 'done'), next: null }), /row\.id/);
    assert.throws(() => S.reduce(s, { type: 'seqStep', id: 'd1', row: null, next: null }), /row/);
    assert.throws(() => S.reduce(s, step('d1', 'finished', null)), /row\.state/);
    assert.throws(() => S.reduce(s, step('d1', 'done', null, { result: { status: 'ok' } })), /result\.status/);
    assert.throws(() => S.reduce(s, step('d1', 'done', null, { note: 4 })), /note/);
    assert.throws(() => S.reduce(s, step('d1', 'done', null, { startedFrom: 7 })), /startedFrom/);
    assert.throws(() => S.reduce(s, step('d1', 'done', 'zz')), /next/);
    assert.throws(() => S.reduce(s, step('d1', 'done', 'd4')), /next/, 'a skipped item is never fitted');
    assert.throws(() => S.reduce(s, step('d1', 'done', 'd1')), /next/);
    assert.throws(() => S.reduce(s, { type: 'seqStep', id: 'd1', row: row('d1', 'done') }), /next/, 'next must be given (null at the end)');
    assert.throws(() => S.reduce(four(), step('d1', 'done', null)), /seqStep: no sequence is running/);
});

// ------------------------------------------------------------------ seqSettled

test('seqSettled: both phases go back to idle on every outcome; done rows and results stay, a running row is pending again', () => {
    ['finished', 'stopped', 'aborted'].forEach((outcome) => {
        let s = started(four(), [item('d1'), item('d3'), item('d4')]);
        s = run(s, step('d1', 'done', 'd3', { result: RESULT('converged') }),
            { type: 'seqStep', id: 'd3', row: row('d3', 'running'), next: 'd4' });
        s = S.reduce(s, { type: 'seqStep', id: 'd4', row: row('d4', 'running'), next: null });
        const done = S.reduce(s, { type: 'seqSettled', outcome });
        assert.ok(isDeepFrozen(done), outcome);
        assert.equal(done.fit.phase, 'idle', outcome);
        assert.equal(done.seq.phase, 'idle', outcome);
        assert.equal(done.fit.outcome, outcome);
        assert.equal(done.seq.outcome, outcome);
        assert.deepEqual(Object.values(done.seq.rows).map((r) => r.state), ['done', 'pending', 'pending'], outcome);
        assert.equal(done.seq.rows.d1, s.seq.rows.d1, 'finished rows are the same objects');
        assert.deepEqual(Object.keys(done.fitResults), ['d1']);
        assert.deepEqual([...done.seq.order], ['d1', 'd3', 'd4']);
        assert.equal(done.seq.form, FORM, 'the snapshot stays for loading rows later');
        assert.ok(S.reduce(done, { type: 'setActive', id: 'd3' }), 'the page is unlocked');
    });
});

test('seqSettled: settles straight after seqStarted too (the runner failed before its first fit)', () => {
    const s = S.reduce(started(four(), [item('d1')]), { type: 'seqSettled', outcome: 'aborted' });
    assert.deepEqual([s.fit.phase, s.seq.phase, s.seq.outcome], ['idle', 'idle', 'aborted']);
    assert.equal(s.seq.rows.d1.state, 'pending');
});

test('seqSettled: unknown outcomes and no running sequence are Errors', () => {
    const s = started(four(), [item('d1')]);
    ['done', 'error', 'converged', undefined, null].forEach((outcome) => {
        assert.throws(() => S.reduce(s, { type: 'seqSettled', outcome }), /seqSettled: outcome must be one of finished, stopped, aborted/);
    });
    assert.throws(() => S.reduce(four(), { type: 'seqSettled', outcome: 'finished' }), /seqSettled: no sequence is running/);
    const settled = S.reduce(s, { type: 'seqSettled', outcome: 'finished' });
    assert.throws(() => S.reduce(settled, { type: 'seqSettled', outcome: 'finished' }), /no sequence is running/);
});

// ------------------------------------------------------------------ the lock while a sequence runs

const ALLOWED_IN_SEQUENCE = [
    { type: 'setShown', id: 'd3', shown: false },
    { type: 'setPlotMode', mode: 'kratky' },
    { type: 'setStagger', on: true, decades: 2 },
    { type: 'setTab', tab: 'sequence' },
    { type: 'setConditionName', name: '幀號' },
    { type: 'setCondition', id: 'd1', value: 3 },
    { type: 'clearNotice' },
    { type: 'dismissRemoved' },
    { type: 'fitProgress', iteration: 1, chi2r: 2 },
    { type: 'setSeqY', name: 'radius' },
    step('d1', 'done', 'd3'),
    { type: 'seqSettled', outcome: 'stopped' },
];
const BLOCKED_IN_SEQUENCE = [
    add(good('e.dat')),
    { type: 'removeFile', id: 'd3' },
    { type: 'undoRemove' },
    { type: 'setActive', id: 'd3' },
    { type: 'setRange', qMin: 0.02, qMax: 0.03 },
    { type: 'rangeDefault' },
    { type: 'rangeFull' },
    { type: 'setWeighting', mode: 'none' },
    { type: 'setMaxSteps', value: 50 },
    { type: 'fitStarted' },
    { type: 'fitSettled', result: null },
    { type: 'setSeqSelected', id: 'd3', selected: false },
    { type: 'setSeqAll', selected: false },
    { type: 'setSeqOption', key: 'chain', value: false },
    { type: 'seqStarted', plan: plan([item('d1')]), form: FORM, settings: SETTINGS },
];

test('the two lists cover every action type; SEQ_RUNNING_ACTIONS is RUNNING_ACTIONS without fitSettled plus the two seq actions', () => {
    const listed = ALLOWED_IN_SEQUENCE.concat(BLOCKED_IN_SEQUENCE).map((a) => a.type).sort();
    assert.deepEqual(listed, [...S.ACTION_TYPES].sort());
    assert.deepEqual(ALLOWED_IN_SEQUENCE.map((a) => a.type).sort(), [...S.SEQ_RUNNING_ACTIONS].sort());
    const expected = S.RUNNING_ACTIONS.filter((type) => type !== 'fitSettled').concat(['seqStep', 'seqSettled']);
    assert.deepEqual([...S.SEQ_RUNNING_ACTIONS].sort(), expected.sort());
    assert.ok(Object.isFrozen(S.SEQ_RUNNING_ACTIONS));
    ['setSeqY'].forEach((type) => assert.ok(S.RUNNING_ACTIONS.indexOf(type) >= 0, type));
    ['seqStep', 'seqSettled', 'seqStarted'].forEach((type) => assert.equal(S.RUNNING_ACTIONS.indexOf(type), -1, type));
});

const sequenceState = () => started(S.reduce(four(), { type: 'removeFile', id: 'd2' }), [item('d1'), item('d3'), item('d4')]);

ALLOWED_IN_SEQUENCE.forEach((action) => {
    test('while a sequence is running: ' + action.type + ' is allowed', () => {
        const before = sequenceState();
        const snapshot = JSON.stringify(before);
        const after = S.reduce(before, action);
        assert.notEqual(after, before);
        assert.ok(isDeepFrozen(after));
        assert.equal(JSON.stringify(before), snapshot, action.type + ' changed its input');
    });
});

BLOCKED_IN_SEQUENCE.forEach((action) => {
    test('while a sequence is running: ' + action.type + ' throws', () => {
        assert.throws(() => S.reduce(sequenceState(), action), new RegExp(action.type + ' is not allowed while a sequence is running'));
    });
});

test('BLOCKED actions of a sequence work once it has settled (the lock is what stops them)', () => {
    const idle = S.reduce(sequenceState(), { type: 'seqSettled', outcome: 'finished' });
    assert.notEqual(idle.removed, null, 'something to undo');
    BLOCKED_IN_SEQUENCE.filter((a) => a.type !== 'fitSettled').forEach((action) => assert.ok(S.reduce(idle, action), action.type));
    assert.throws(() => S.reduce(idle, { type: 'fitSettled', result: null }), /no fit is running/);
});

test('a sequence keeps fit.phase running from seqStarted to seqSettled, whatever happens in between', () => {
    let s = sequenceState();
    const phases = [];
    const actions = [
        { type: 'fitProgress', iteration: 1, chi2r: 5 }, step('d1', 'done', 'd3', { result: RESULT('converged') }),
        { type: 'setTab', tab: 'fit' }, { type: 'fitProgress', iteration: 2, chi2r: 4 },
        step('d3', 'error', 'd4', { note: 'x' }), { type: 'setSeqY', name: 'radius' },
        step('d4', 'done', null, { result: RESULT('failed') }),
    ];
    actions.forEach((action) => {
        s = S.reduce(s, action);
        phases.push(s.fit.phase + '/' + s.seq.phase);
    });
    assert.deepEqual(phases, actions.map(() => 'running/running'));
    assert.deepEqual(Object.keys(s.fitResults).sort(), ['d1', 'd4']);
});

test('while a single fit runs, a sequence cannot start, step or settle; the fit still settles normally', () => {
    const fitting = S.reduce(four(), { type: 'fitStarted' });
    assert.equal(fitting.seq.phase, 'idle');
    assert.throws(() => started(fitting, [item('d1')]), /seqStarted is not allowed while a fit is running/);
    assert.throws(() => S.reduce(fitting, step('d1', 'done', null)), /seqStep is not allowed while a fit is running/);
    assert.throws(() => S.reduce(fitting, { type: 'seqSettled', outcome: 'stopped' }), /seqSettled is not allowed while a fit is running/);
    assert.equal(S.reduce(fitting, { type: 'fitSettled', result: RESULT('converged') }).fit.phase, 'idle');
});
