'use strict';
/**
 * sasfit-sequence.js（M4 計畫 Task 8）：序列的排程（順序、每檔範圍、跳過）、可否當初值、起始表單。
 * 執行器 run 的測試在 sasfit-sequence-run.test.js。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const { seqFiles, sphereForm, fakeResult } = require('./sasfit-m4-helpers.js');

const Seq = globalThis.SasFitSequence;
const Weighting = globalThis.SasFitWeighting;
const Hints = globalThis.SasFitHints;
const DataIo = globalThis.SasFitDataIo;

const OPTIONS = Object.freeze({ chain: true, sort: true });
const UNEDITED = Object.freeze({ qMin: 0.005, qMax: 0.35, userEdited: false });
const edited = (qMin, qMax) => Object.freeze({ qMin, qMax, userEdited: true });
const planOf = (overrides = {}) => Seq.plan({
    files: seqFiles(), selected: {}, options: OPTIONS, range: UNEDITED, weighting: 'sigma', form: sphereForm(), ...overrides,
});
const genericFile = (id, fixture) => Object.freeze({
    id, fileName: fixture, issues: [], issueOverflow: 0, notes: {}, condition: null,
    dataset: DataIo.parse(ui.fixtureText(fixture), { fileName: fixture, qUnit: 'A' }).dataset,
});
/** 四個檔，條件值依序為 conditions。 */
function fourFiles(conditions) {
    const three = seqFiles();
    const all = three.concat([Object.freeze({ ...three[0], id: 'd4', fileName: 'fourth.dat' })]);
    return all.map((file, i) => Object.freeze({ ...file, condition: conditions[i] }));
}

test('[sasfit-sequence] 匯出凍結物件；純模組', () => {
    assert.ok(Object.isFrozen(Seq));
    for (const name of ['plan', 'isUsableStart', 'startForm', 'run']) assert.equal(typeof Seq[name], 'function', name);
});

// ---------------------------------------------------------------- 順序
test('[sasfit-sequence] plan：依條件值由小到大，沒有條件值的排最後並警告', () => {
    const plan = planOf({ files: fourFiles([30, 10, null, 20]) });
    assert.deepEqual(plan.items.map((item) => item.id), ['d2', 'd4', 'd1', 'd3']);
    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0], /^1 個檔沒有條件值，排在最後：SYNTH_sphere_30\.dat/);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.items) && Object.isFrozen(plan.items[0]));
});

test('[sasfit-sequence] plan：不排序 → 清單順序、無警告；全部沒有條件值 → 清單順序＋警告；同值穩定', () => {
    const unsorted = planOf({ files: fourFiles([30, 10, null, 20]), options: { chain: true, sort: false } });
    assert.deepEqual(unsorted.items.map((item) => item.id), ['d1', 'd2', 'd3', 'd4']);
    assert.deepEqual(unsorted.warnings, []);
    const blank = planOf({ files: fourFiles([null, null, null, null]) });
    assert.deepEqual(blank.items.map((item) => item.id), ['d1', 'd2', 'd3', 'd4']);
    assert.match(blank.warnings[0], /^4 個檔沒有條件值，排在最後：SYNTH_sphere_10\.dat、SYNTH_sphere_20\.dat、SYNTH_sphere_30\.dat…/);
    const ties = planOf({ files: fourFiles([5, 1, 5, 5]) });
    assert.deepEqual(ties.items.map((item) => item.id), ['d2', 'd1', 'd3', 'd4']);
});

test('[sasfit-sequence] plan：只排有資料且被勾選的檔（沒設定過的視為勾選）', () => {
    const failed = Object.freeze({ id: 'd9', fileName: 'bad.txt', dataset: null, issues: [], issueOverflow: 0, notes: {}, condition: null });
    const plan = planOf({ files: seqFiles().concat([failed]), selected: { d2: false, d3: true } });
    assert.deepEqual(plan.items.map((item) => item.id), ['d1', 'd3']);
});

// ---------------------------------------------------------------- 每檔的範圍
test('[sasfit-sequence] plan：範圍未編輯 → 每個檔用自己的預設範圍，註記留白', () => {
    const files = seqFiles();
    const moved = Object.freeze({ ...files[1].dataset, header: Object.freeze({ ...files[1].dataset.header, qStart: 0.02 }) });
    const plan = planOf({ files: [files[0], Object.freeze({ ...files[1], dataset: moved }), files[2]] });
    plan.items.forEach((item, i) => {
        const dataset = i === 1 ? moved : files[i].dataset;
        assert.deepEqual(item.range, Weighting.defaultRange(dataset, 'sigma'));
        assert.equal(item.note, '');
        assert.equal(item.skip, null);
    });
    assert.equal(plan.items[1].range.qMin, 0.02);
    assert.equal(plan.items[0].range.qMin, 0.005);
    assert.equal(plan.items[2].range.qMin, 0.005);
});

test('[sasfit-sequence] plan：編輯過的範圍截到各檔可參與的首尾 q，並註記；落在資料之內則原樣', () => {
    const wide = planOf({ range: edited(0.001, 1) });
    wide.items.forEach((item, i) => {
        const dataset = seqFiles()[i].dataset;
        const mask = Weighting.mask(dataset, 'sigma');
        const usable = Array.from(dataset.q).filter((_, k) => mask[k] === 1);
        assert.deepEqual(item.range, { qMin: usable[0], qMax: usable[usable.length - 1] });
        assert.match(item.note, /^擬合範圍截為 q 0\.005–0\.35 Å⁻¹（要求 q 0\.001–1 Å⁻¹）$/);
        assert.equal(item.skip, null);
    });
    const inside = planOf({ range: edited(0.01, 0.07) });
    inside.items.forEach((item) => {
        assert.deepEqual(item.range, { qMin: 0.01, qMax: 0.07 });
        assert.equal(item.note, '');
    });
});

test('[sasfit-sequence] plan：要求的範圍內沒有點 → 跳過並說明；點數不多於參數個數 → 跳過', () => {
    const none = planOf({ range: edited(5, 6) });
    none.items.forEach((item) => assert.match(item.skip, /沒有可參與擬合的資料點/));
    const few = planOf({ range: edited(0.005, 0.0055) });
    few.items.forEach((item) => assert.match(item.skip, /必須多於要擬合的參數個數/));
});

test('[sasfit-sequence] plan：σ 權重下沒有可用 σ 的檔跳過（不改用別的權重）；不加權時照常；官方檔與一般檔可混用', () => {
    const files = seqFiles().slice(0, 1).concat([genericFile('d2', 'generic-2col.txt'), genericFile('d3', 'generic-3col.csv')]);
    const sigma = planOf({ files, options: { chain: true, sort: false } });
    assert.equal(sigma.items[0].skip, null);
    assert.match(sigma.items[1].skip, /沒有可用的誤差欄/);
    assert.equal(sigma.items[1].range, null);
    const none = planOf({ files, weighting: 'none', options: { chain: true, sort: false }, form: sphereForm([]) });
    assert.equal(none.items[0].skip, null);
    // 官方檔的 σ = 0 列在任何權重下都不參與；一般檔沒有這條規則：各自依自己的遮罩
    assert.equal(none.items[0].range.qMin, 0.005);
    assert.equal(none.items[1].range.qMin, files[1].dataset.q[0]);
    assert.equal(none.items[1].skip, null);
});

test('[sasfit-sequence] plan：表單無效或沒有勾選參數 → 每一筆都跳過並帶原因；不修改傳入的物件', () => {
    const F = globalThis.SasFitForm;
    const nothing = ['scale', 'background'].reduce((form, name) => F.reduce(form, { type: 'setFit', name, fit: false }), F.create('sphere'));
    planOf({ form: nothing }).items.forEach((item) => assert.match(item.skip, /至少勾選一個/));
    const files = Object.freeze(seqFiles());
    const selected = Object.freeze({});
    planOf({ files, selected });
    assert.throws(() => Seq.plan({ files, selected, options: OPTIONS, range: UNEDITED, weighting: 'bogus', form: sphereForm() }), /weighting/i);
});

// ---------------------------------------------------------------- 可否當初值
test('[sasfit-sequence] isUsableStart：收斂、非 blockedByNonFinite、σ 權重時 χ²ᵣ ≤ CHI2R_WARN', () => {
    const warn = Hints.CHI2R_WARN;
    assert.equal(Seq.isUsableStart(fakeResult({ chi2r: 1.2 })), true);
    assert.equal(Seq.isUsableStart(fakeResult({ chi2r: warn })), true);
    assert.equal(Seq.isUsableStart(fakeResult({ chi2r: warn + 0.01 })), false);
    assert.equal(Seq.isUsableStart(fakeResult({ chi2r: NaN })), false);
    assert.equal(Seq.isUsableStart(fakeResult({ chi2r: 117, weighting: 'none' })), true, '不是 χ²ᵣ，不套門檻');
    assert.equal(Seq.isUsableStart(fakeResult({ blockedByNonFinite: true })), false);
    for (const status of ['maxiter', 'failed', 'stopped']) assert.equal(Seq.isUsableStart(fakeResult({ status })), false, status);
    assert.equal(Seq.isUsableStart(null), false);
    assert.equal(Seq.isUsableStart(undefined), false);
    assert.equal(Seq.isUsableStart(fakeResult({ values: { radius: 0 }, names: ['radius'], atBound: { radius: 'lower' } })), true, '貼邊界仍可當初值');
});

test('[sasfit-sequence] 門檻只引用 SasFitHints.CHI2R_WARN，原始碼不另寫數字', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'sasfit-sequence.js'), 'utf8');
    assert.match(source, /SasFitHints\.CHI2R_WARN/);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /\b10\b/);
});

// ---------------------------------------------------------------- 起始表單
test('[sasfit-sequence] startForm：沒有可用結果或 chain 關 → form0 本身；否則只換被擬合的值', () => {
    const F = globalThis.SasFitForm;
    const opened = F.reduce(F.reduce(sphereForm(), { type: 'togglePd', name: 'radius' }), { type: 'setPdFit', name: 'radius', fit: true });
    const form0 = F.reduce(opened, { type: 'setUpper', name: 'radius', value: '80' });
    assert.equal(Seq.startForm(form0, null, true), form0);
    const job = globalThis.SasFitJobs.fitJob(form0, seqFiles()[0].dataset, { range: { qMin: 0.005, qMax: 0.35 }, weighting: 'sigma', maxSteps: 50 });
    const result = fakeResult({ job, values: { scale: 1.02, background: 0.0011, radius: 51.25, radius_pd: 0.08 } });
    assert.equal(Seq.startForm(form0, result, false), form0);
    const next = Seq.startForm(form0, result, true);
    assert.equal(Number(next.fields.radius.value), 51.25);
    assert.equal(Number(next.pds.radius.width), 0.08);
    assert.equal(next.fields.radius.upper, '80');
    assert.equal(next.fields.radius.fit, true);
    assert.deepEqual(next.fields.sld, form0.fields.sld);
    assert.equal(next.pds.radius.fit, true);
    assert.equal(Number(form0.fields.radius.value), 50, 'form0 沒被改');
});

// ---------------------------------------------------------------- 審查後修正（2026-11-19：使用者決定 D1、工程決定 E1）
test('[sasfit-sequence] isUsableStart：illConditioned 或 jacobianNonFinite 的結果不當初值（任何權重）', () => {
    for (const weighting of ['sigma', 'none']) {
        assert.equal(Seq.isUsableStart(fakeResult({ weighting, illConditioned: true })), false, weighting + ' illConditioned');
        assert.equal(Seq.isUsableStart(fakeResult({ weighting, jacobianNonFinite: true })), false, weighting + ' jacobianNonFinite');
        assert.equal(Seq.isUsableStart(fakeResult({ weighting })), true, weighting);
    }
});

test('[sasfit-sequence] heldBack：誤差不是有限值或 ≥ |值| 的參數不沿用；貼邊界的值照舊沿用；看的是畫面顯示的誤差', () => {
    const values = { scale: 1.02, background: 0.001, radius: 51.25 };
    assert.deepEqual(Seq.heldBack(fakeResult({ values, errors: { scale: 0.01, background: 0.0001, radius: 0.3 } })), []);
    assert.deepEqual(Seq.heldBack(fakeResult({ values, errors: { scale: 0.01, background: 0.001, radius: 80 } })), ['background', 'radius']);
    assert.deepEqual(Seq.heldBack(fakeResult({ values, errors: { scale: NaN, background: 0.0001, radius: Infinity } })), ['scale', 'radius']);
    const onBound = fakeResult({ values: { ...values, radius: 80 }, errors: { scale: 0.01, background: 0.0001, radius: 900 }, atBound: { radius: 'upper' } });
    assert.deepEqual(Seq.heldBack(onBound), [], '貼邊界的值不算「未能決定」（與畫面的分類相同）');
    // 非 σ 權重：畫面顯示的是乘過 √均方 的誤差
    const scaled = fakeResult({ values, weighting: 'none', chi2r: 400, errors: { scale: 0.01, background: 0.00001, radius: 3 } });
    assert.deepEqual(Seq.heldBack(scaled), ['radius']);
    assert.ok(Object.isFrozen(Seq.heldBack(scaled)));
});

test('[sasfit-sequence] startForm：未能決定的參數留在 form0 的原始值，其餘沿用上一筆', () => {
    const F = globalThis.SasFitForm;
    const form0 = F.reduce(F.reduce(sphereForm(), { type: 'togglePd', name: 'radius' }), { type: 'setPdFit', name: 'radius', fit: true });
    const job = globalThis.SasFitJobs.fitJob(form0, seqFiles()[0].dataset, { range: { qMin: 0.005, qMax: 0.35 }, weighting: 'sigma', maxSteps: 50 });
    const result = fakeResult({ job, values: { scale: 1.02, background: 0.0011, radius: 51.25, radius_pd: 0.3 }, errors: { radius_pd: 4 } });
    assert.deepEqual(Seq.heldBack(result), ['radius_pd']);
    const next = Seq.startForm(form0, result, true);
    assert.equal(Number(next.fields.radius.value), 51.25);
    assert.equal(next.pds.radius.width, form0.pds.radius.width, '寬度沒被上一筆定不出來的值帶走');
    const none = fakeResult({ job, values: { radius: 51.25 }, errors: { scale: 9, background: 9, radius: 900, radius_pd: 9 } });
    assert.equal(Seq.startForm(form0, none, true), form0, '全部未能決定 → form0 本身');
});
