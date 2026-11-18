'use strict';
/**
 * sasfit-hints.js: which messages the SAS fitting page shows
 * (design spec 5.7 items 1-11 and 13, 12, 16; plan M3 Task 7).
 * Every hint has a fixed id; a test asserts by id and each text once, verbatim.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitHints: H, SasFitWorkerCore: Core, SasFitWorkerClient: Client, SasFitWeighting: W,
    SasFitForm: F, SasFitJobs: J, SasFitState: S, SasFitEvaluate: E,
} = require('./load.js');
const { FIT_RESULT_FIELDS, loadKernels, makeCore } = require('./sasfit-fit-helpers.js');

const isDeepFrozen = (o) => o === null || typeof o !== 'object' || ArrayBuffer.isView(o)
    || (Object.isFrozen(o) && Object.values(o).every(isDeepFrozen));
const ids = (hints) => hints.map((h) => h.id);
const byId = (hints, id) => hints.find((h) => h.id === id);
const TONES = ['ok', 'warn', 'error'];

/** A frozen FitResult with every field of design spec 4.9; a clean converged fit unless overridden. */
function result(overrides) {
    const r = {
        params: { scale: 1, background: 0.001, radius: 50, thickness: 10 },
        names: ['scale', 'radius', 'thickness'],
        errors: { scale: 0.01, radius: 0.5, thickness: 0.2 },
        errorsScaled: { scale: 0.011, radius: 0.55, thickness: 0.22 },
        displayErrorsScaled: false,
        covariance: [[1e-4, 0, 0], [0, 0.25, 0], [0, 0, 0.04]],
        correlation: [[1, 0.1, 0.2], [0.1, 1, 0.3], [0.2, 0.3, 1]],
        chi2: 110, chi2r: 1.1, dof: 100, iterations: 12, status: 'converged', atBound: {},
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: new Float64Array(3), residuals: new Float64Array(3),
        settings: { modelSpec: { model: 'core_shell_sphere', structure: null, lowQPowerLaw: false }, weighting: 'sigma',
            range: { qMin: 0.01, qMax: 0.3 }, cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10 },
        ...overrides,
    };
    assert.deepEqual(Object.keys(r).sort(), [...FIT_RESULT_FIELDS].sort());
    return Object.freeze(r);
}
const weighted = (weighting, extra) => result({
    settings: { ...result().settings, weighting }, displayErrorsScaled: weighting !== 'sigma', ...extra,
});

function dataset(q, I, sigma) {
    return Object.freeze({
        fileName: 'a.dat', kind: 'generic', header: null, q: Float64Array.from(q), I: Float64Array.from(I),
        sigma: sigma === null ? null : Float64Array.from(sigma), dq: null, condition: null, qUnit: 'A',
    });
}
const Q6 = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
const CLEAN = dataset(Q6, [6, 5, 4, 3, 2, 1], [1, 1, 1, 1, 1, 1]);
const SPEC = Object.freeze({ model: 'sphere', structure: null, lowQPowerLaw: false });
const NOTES = Object.freeze({ skipped: 0, placeholders: 0, sorted: false, suspectNm: false });
const pre = (extra) => H.preFitHints({
    modelSpec: SPEC, dataset: CLEAN, range: { qMin: 0.01, qMax: 0.06 }, weighting: 'sigma', notes: NOTES, ...extra,
});

test('module is frozen; thresholds are named constants', () => {
    assert.ok(Object.isFrozen(H));
    assert.equal(H.CHI2R_WARN, 10);
    assert.equal(H.CHI2R_LOW, 0.1);
    assert.equal(H.CORRELATION_WARN, 0.98);
});

test('a clean converged fit has no hints; hints are frozen data, not HTML', () => {
    assert.deepEqual(H.fitHints(result()), []);
    assert.deepEqual(H.fitHints(null), []);
    const everything = H.fitHints(weighted('none', {
        status: 'failed', blockedByNonFinite: true, jacobianNonFinite: true, illConditioned: true, nonFiniteCurvePoints: 2,
        atBound: { radius: 'upper' }, correlation: [[1, 0.99, 0], [0.99, 1, 0], [0, 0, 1]], errors: { scale: NaN, radius: 1, thickness: 1 },
    })).concat(H.fitHints(result({ status: 'maxiter', chi2r: 0.01 })), H.fitHints(result({ iterations: 0, chi2r: 50 })),
        H.fitHints(result({ status: 'stopped' })), pre({ modelSpec: { ...SPEC, structure: 'hayter_msa' } }));
    assert.ok(everything.length >= 12);
    assert.ok(Object.isFrozen(H.fitHints(result())) && Object.isFrozen(pre()));
    everything.forEach((h) => {
        assert.ok(isDeepFrozen(h), h.id + ' is frozen');
        assert.ok(typeof h.id === 'string' && h.id !== '');
        assert.ok(TONES.includes(h.tone), h.id + ' tone ' + h.tone);
        assert.ok(typeof h.text === 'string' && h.text !== '');
        assert.equal(/[<>&]/.test(h.text), false, h.id + ' is plain text');
    });
});

// ------------------------------------------------------------------ spec 5.7 item 1

test('5.7-1: chi2r above CHI2R_WARN on a converged fit -> local-minimum', () => {
    assert.equal(ids(H.fitHints(result({ chi2r: 1.1 }))).includes('local-minimum'), false);
    assert.equal(ids(H.fitHints(result({ chi2r: 10 }))).includes('local-minimum'), false, 'exactly 10 does not count');
    const hint = byId(H.fitHints(result({ chi2r: 10.01 })), 'local-minimum');
    assert.equal(hint.text, '擬合可能停在局部極小值，請調整起始值後重試');
    assert.equal(hint.tone, 'warn');
    assert.ok(byId(H.fitHints(weighted('none', { chi2r: 1234 })), 'local-minimum'), 'whatever the weighting');
    assert.equal(ids(H.fitHints(result({ chi2r: Infinity, status: 'failed', blockedByNonFinite: true }))).includes('local-minimum'), false);
    assert.equal(ids(H.fitHints(result({ chi2r: 500, status: 'maxiter' }))).includes('local-minimum'), false,
        'not converged: the offer to continue is the message');
});

test('5.7-1: chi2r below CHI2R_LOW -> overestimated-errors, ONLY with sigma weighting', () => {
    const hint = byId(H.fitHints(result({ chi2r: 0.09 })), 'overestimated-errors');
    assert.equal(hint.text, 'χ²ᵣ 遠小於 1：資料的誤差可能被高估');
    assert.equal(hint.tone, 'warn');
    assert.equal(ids(H.fitHints(result({ chi2r: 0.1 }))).includes('overestimated-errors'), false, 'exactly 0.1 does not count');
    ['sqrtI', 'absI', 'none'].forEach((weighting) => {
        assert.equal(ids(H.fitHints(weighted(weighting, { chi2r: 0.001 }))).includes('overestimated-errors'), false, weighting);
    });
    assert.ok(byId(H.fitHints(result({ chi2r: 0.01, status: 'maxiter' })), 'overestimated-errors'));
});

test('5.7-1: statusLabel is one text per status and never "ok" when chi2r says otherwise', () => {
    assert.deepEqual({ ...H.statusLabel(result()) }, { text: '已收斂', tone: 'ok' });
    assert.deepEqual({ ...H.statusLabel(result({ status: 'maxiter' })) }, { text: '未收斂（達最大步數）', tone: 'warn' });
    assert.deepEqual({ ...H.statusLabel(result({ status: 'stopped', chi2r: null })) }, { text: '已停止', tone: 'warn' });
    assert.deepEqual({ ...H.statusLabel(result({ status: 'failed' })) }, { text: '失敗', tone: 'error' });
    assert.deepEqual({ ...H.statusLabel(null) }, { text: '未擬合', tone: 'warn' });
    assert.equal(new Set(['converged', 'maxiter', 'stopped', 'failed'].map((status) => H.statusLabel(result({ status })).text)).size, 4);
    assert.deepEqual({ ...H.statusLabel(result({ chi2r: 10.01 })) }, { text: '已收斂', tone: 'warn' });
    assert.deepEqual({ ...H.statusLabel(result({ chi2r: 0.09 })) }, { text: '已收斂', tone: 'warn' });
    assert.equal(H.statusLabel(weighted('none', { chi2r: 0.09 })).tone, 'ok', 'a small chi2r means nothing without data errors');
    assert.equal(H.statusLabel(result({ chi2r: NaN })).tone, 'warn');
    assert.equal(H.statusLabel(result({ chi2r: 10 })).tone, 'ok');
    assert.throws(() => H.statusLabel(result({ status: 'done' })), /done/);
});

// ------------------------------------------------------------------ items 2-8

test('5.7-2: zero accepted steps on a converged fit -> zero-steps', () => {
    const hint = byId(H.fitHints(result({ iterations: 0 })), 'zero-steps');
    assert.equal(hint.text, '擬合沒有走任何一步：起始點已是極小值，或一步都走不動');
    assert.equal(ids(H.fitHints(result({ iterations: 1 }))).includes('zero-steps'), false);
    assert.deepEqual(ids(H.fitHints(result({ status: 'stopped', iterations: 0, chi2r: null }))), ['stopped']);
});

test('5.7-3: blocked, jacobian-nan and ill-conditioned are three different messages', () => {
    const blocked = byId(H.fitHints(result({ status: 'failed', blockedByNonFinite: true })), 'blocked');
    assert.equal(blocked.text, '在這組參數附近模型無法計算，擬合無法繼續；下列為目前最好的參數。請調整起始值或上下限後重試');
    assert.equal(blocked.tone, 'error');
    assert.equal(ids(H.fitHints(result({ blockedByNonFinite: true }))).includes('blocked'), false, 'only with status failed');

    const jac = byId(H.fitHints(result({ jacobianNonFinite: true, errors: { scale: 0.01, radius: NaN, thickness: NaN } })), 'jacobian-nan');
    assert.equal(jac.text, '下列參數的誤差無法計算：radius、thickness。其餘參數的誤差是把這些參數固定後算出的，數值偏小');
    assert.deepEqual([...jac.params], ['radius', 'thickness']);
    assert.equal(jac.text.includes('相關性'), false);
    const jacNone = byId(H.fitHints(result({ jacobianNonFinite: true })), 'jacobian-nan');
    assert.equal(jacNone.text, '部分參數的誤差無法計算；其餘參數的誤差是把這些參數固定後算出的，數值偏小');

    const ill = byId(H.fitHints(result({ illConditioned: true })), 'ill-conditioned');
    assert.equal(ill.text, '參數相關性過高，誤差不可靠');

    const all = H.fitHints(result({
        status: 'failed', blockedByNonFinite: true, jacobianNonFinite: true, illConditioned: true,
        errors: { scale: NaN, radius: NaN, thickness: NaN },
    }));
    const three = ['blocked', 'jacobian-nan', 'ill-conditioned'].map((id) => byId(all, id).text);
    assert.equal(new Set(three).size, 3);
});

test('a failed result without blockedByNonFinite still says it failed', () => {
    const hint = byId(H.fitHints(result({ status: 'failed' })), 'failed');
    assert.equal(hint.text, '擬合失敗，請調整起始值或上下限後重試');
    assert.equal(hint.tone, 'error');
    assert.equal(ids(H.fitHints(result({ status: 'failed', blockedByNonFinite: true }))).includes('failed'), false);
});

test('5.7-4: non-finite curve points', () => {
    assert.equal(byId(H.fitHints(result({ nonFiniteCurvePoints: 7 })), 'non-finite-curve').text, '模型曲線有 7 點無法計算');
    assert.equal(ids(H.fitHints(result({ nonFiniteCurvePoints: 0 }))).includes('non-finite-curve'), false);
});

test('5.7-5: parameters on a bound', () => {
    const hint = byId(H.fitHints(result({ atBound: { radius: 'upper', scale: 'lower' } })), 'at-bound');
    assert.equal(hint.text, '下列參數停在邊界上，誤差沒有意義：radius（上限）、scale（下限）');
    assert.deepEqual(hint.params.map((p) => ({ ...p })), [{ name: 'radius', bound: 'upper' }, { name: 'scale', bound: 'lower' }]);
    assert.equal(H.AT_BOUND_ERROR_TEXT, '貼邊界，誤差無意義');
});

test('5.7-6: strongCorrelations and the strong-correlation hint', () => {
    const r = result({ correlation: [[1, 0.5, NaN], [0.5, 1, -0.99], [NaN, -0.99, 1]] });
    const pairs = H.strongCorrelations(r);
    assert.deepEqual(pairs.map((p) => ({ ...p })), [{ a: 'radius', b: 'thickness', r: -0.99 }]);
    assert.ok(isDeepFrozen(pairs));
    const hint = byId(H.fitHints(r), 'strong-correlation');
    assert.equal(hint.text, 'radius 與 thickness 高度相關（−0.99）');
    assert.equal(hint.tone, 'warn');
    assert.deepEqual(hint.pairs, pairs);
    const edge = result({ correlation: [[1, 0.98, 0.9800001], [0.98, 1, 0], [0.9800001, 0, 1]] });
    assert.deepEqual(H.strongCorrelations(edge).map((p) => [p.a, p.b]), [['scale', 'thickness']], 'exactly 0.98 does not count');
    assert.deepEqual(H.strongCorrelations(r, 0.4).map((p) => [p.a, p.b]), [['scale', 'radius'], ['radius', 'thickness']]);
    const two = result({ correlation: [[1, 0.99996, -1], [0.99996, 1, 0], [-1, 0, 1]] });
    assert.equal(byId(H.fitHints(two), 'strong-correlation').text,
        'scale 與 radius 高度相關（0.9999）；scale 與 thickness 高度相關（−1.00）');
    assert.equal(ids(H.fitHints(result())).includes('strong-correlation'), false);
    assert.deepEqual(H.strongCorrelations(result({ status: 'stopped', names: [], correlation: [] })), []);
});

test('5.7-7: maxiter offers to continue from the current values; no other status does', () => {
    const hint = byId(H.fitHints(result({ status: 'maxiter' })), 'maxiter');
    assert.equal(hint.text, '已達最大步數仍未收斂，可從目前的值繼續擬合');
    assert.equal(hint.action, 'continue');
    ['converged', 'failed', 'stopped'].forEach((status) => {
        assert.equal(H.fitHints(result({ status })).some((h) => 'action' in h), false, status);
    });
});

test('5.7-8: scaled errors say how they differ from SasView, with the factor', () => {
    const hint = byId(H.fitHints(weighted('none', { chi2r: 2.25 })), 'scaled-errors');
    assert.equal(hint.text, '顯示的誤差已乘 √χ²ᵣ（= 1.50）。SasView 顯示的是未乘的值，兩者相差 1.50 倍：把此處的誤差除以 1.50 即為 SasView 的數值');
    assert.equal(hint.factor, 1.5);
    assert.equal(hint.tone, 'ok');
    assert.equal(ids(H.fitHints(result({ chi2r: 2.25 }))).includes('scaled-errors'), false, 'sigma weighting shows raw errors');
    assert.deepEqual({ ...H.errorColumn(weighted('none', { chi2r: 2.25 })) }, {
        label: '±（已乘 √χ²ᵣ）',
        title: '顯示的誤差已乘 √χ²ᵣ（= 1.50）。SasView 顯示的是未乘的值，兩者相差 1.50 倍：把此處的誤差除以 1.50 即為 SasView 的數值',
    });
    assert.deepEqual({ ...H.errorColumn(result()) }, { label: '±', title: '' });
    assert.deepEqual({ ...H.errorColumn(null) }, { label: '±', title: '' });
    const noFactor = H.errorColumn(weighted('none', { chi2r: Infinity }));
    assert.equal(noFactor.title, '顯示的誤差已乘 √χ²ᵣ。SasView 顯示的是未乘的值，兩者相差 √χ²ᵣ 倍');
    assert.equal(byId(H.fitHints(weighted('none', { chi2r: 1e-6 })), 'scaled-errors').text.includes('（= 0.00100）'), true);
});

test('a stopped result gives only the stopped line and never throws', () => {
    const stopped = result({
        status: 'stopped', names: [], errors: {}, errorsScaled: {}, covariance: [], correlation: [], chi2: null, chi2r: null,
        dof: null, iterations: 4, curve: null, residuals: null, displayErrorsScaled: true,
    });
    const hints = H.fitHints(stopped);
    assert.deepEqual(hints.map((h) => ({ ...h })), [{ id: 'stopped', tone: 'ok', text: '已停止（第 4 步）' }]);
});

test('the order of fit hints is fixed', () => {
    const all = H.fitHints(weighted('none', {
        status: 'failed', blockedByNonFinite: true, jacobianNonFinite: true, illConditioned: true, nonFiniteCurvePoints: 2,
        atBound: { radius: 'upper' }, correlation: [[1, 0.99, 0], [0.99, 1, 0], [0, 0, 1]], errors: { scale: NaN, radius: 1, thickness: 1 },
    }));
    assert.deepEqual(ids(all), ['blocked', 'jacobian-nan', 'ill-conditioned', 'at-bound', 'strong-correlation',
        'non-finite-curve', 'scaled-errors']);
    assert.deepEqual(ids(H.fitHints(result({ iterations: 0, chi2r: 50 }))), ['zero-steps', 'local-minimum']);
    assert.deepEqual(ids(H.fitHints(result({ status: 'maxiter', chi2r: 0.01 }))), ['maxiter', 'overestimated-errors']);
    assert.deepEqual([...H.FIT_HINT_IDS], ['stopped', 'blocked', 'failed', 'maxiter', 'zero-steps', 'local-minimum',
        'overestimated-errors', 'jacobian-nan', 'ill-conditioned', 'at-bound', 'strong-correlation', 'non-finite-curve', 'scaled-errors']);
});

test('a real FitResult from SasFitWorkerCore: unweighted fit of exact data', async () => {
    const q = Float64Array.from({ length: 40 }, (_, i) => 0.01 + 0.005 * i);
    const truth = F.create('sphere');
    const I = E.evaluate(J.modelSpec(truth), J.params(truth), q, { cutoff: J.CUTOFF }, await loadKernels()).I;
    const ds = dataset(q, I, null);
    const start = F.reduce(F.reduce(truth, { type: 'setValue', name: 'radius', value: '52' }), { type: 'setFit', name: 'radius', fit: true });
    const { core, posts } = makeCore();
    await core.handle({ type: 'fit', jobId: 1, ...J.fitJob(start, ds, { range: S.fullRange(ds), weighting: 'none', maxSteps: 200 }) });
    const { fitResult } = posts[posts.length - 1];
    assert.equal(fitResult.status, 'converged');
    const hints = H.fitHints(fitResult);
    assert.ok(byId(hints, 'scaled-errors'), ids(hints).join(','));
    assert.equal(ids(hints).includes('overestimated-errors'), false, 'chi2r is tiny, but no data errors were used');
    assert.equal(H.statusLabel(fitResult).text, '已收斂');
});

// ------------------------------------------------------------------ before the fit (items 10, 11, 13)

test('preFitHints: nothing to say about clean data and a plain model', () => {
    assert.deepEqual(pre(), []);
    assert.deepEqual(pre({ notes: undefined }), []);
});

test('5.7-10: hayter_msa notice (spec 16), with or without data', () => {
    const spec = { model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: false };
    const hint = byId(pre({ modelSpec: spec }), 'hayter');
    assert.equal(hint.text, '結構因子 hayter_msa 在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同），'
        + '擬合得到的誤差可能不可靠；請連同 χ²ᵣ 一起判斷結果');
    assert.equal(hint.tone, 'warn');
    ['低 q 可能出現不連續或無法計算的點', 'sasmodels／SasView 相同', '誤差可能不可靠'].forEach((part) => assert.ok(hint.text.includes(part)));
    assert.deepEqual(ids(H.preFitHints({ modelSpec: spec, dataset: null, range: null, weighting: 'sigma', notes: null })), ['hayter']);
    assert.equal(ids(pre({ modelSpec: { ...SPEC, structure: 'hardsphere' } })).includes('hayter'), false);
});

test('preFitHints: no dataset and no hayter_msa -> nothing', () => {
    assert.deepEqual(H.preFitHints({ modelSpec: SPEC, dataset: null, range: null, weighting: 'sqrtI', notes: null }), []);
});

test('5.7-11: I <= 0 inside the range under sqrtI / absI weighting', () => {
    const ds = dataset(Q6, [0, -0.001, 4, 0, 2, -1], [1, 1, 1, 1, 1, 1]);
    const range = { qMin: 0.01, qMax: 0.05 };
    ['sqrtI', 'absI'].forEach((weighting) => {
        const hint = byId(pre({ dataset: ds, range, weighting }), 'nonpositive-weight');
        assert.equal(hint.text, '擬合範圍內有 3 點 I ≤ 0：I＝0 的 2 點被排除；I < 0 的 1 點以 |I| 當權重，接近 0 的負值權重極小，會主導擬合');
        assert.equal(hint.tone, 'warn');
        assert.deepEqual([hint.zero, hint.negative], [2, 1]);
    });
    ['sigma', 'none'].forEach((weighting) => {
        assert.equal(ids(pre({ dataset: ds, range, weighting })).includes('nonpositive-weight'), false, weighting);
    });
    assert.equal(ids(pre({ dataset: ds, range: { qMin: 0.03, qMax: 0.03 }, weighting: 'sqrtI' })).includes('nonpositive-weight'), false);
    assert.equal(ids(pre({ dataset: ds, range: null, weighting: 'sqrtI' })).includes('nonpositive-weight'), false);
    const onlyZero = byId(pre({ dataset: ds, range: { qMin: 0.04, qMax: 0.04 }, weighting: 'absI' }), 'nonpositive-weight');
    assert.equal(onlyZero.text, '擬合範圍內有 1 點 I ≤ 0：I＝0 的 1 點被排除');
    const onlyNegative = byId(pre({ dataset: ds, range: { qMin: 0.06, qMax: 0.06 }, weighting: 'absI' }), 'nonpositive-weight');
    assert.equal(onlyNegative.text, '擬合範圍內有 1 點 I ≤ 0：I < 0 的 1 點以 |I| 當權重，接近 0 的負值權重極小，會主導擬合');
});

test('5.7-11: excludedCounts per weighting mode, from SasFitWeighting.countExcluded', () => {
    const ds = dataset([0, 0.01, 0.02, 0.03], [5, 0, 3, NaN], [1, 1, 0, 1]);
    const counts = H.excludedCounts(ds);
    assert.deepEqual({ ...counts }, { sigma: 3, sqrtI: 3, absI: 3, none: 2 });
    W.MODES.forEach((mode) => assert.equal(counts[mode], W.countExcluded(ds, mode), mode));
    assert.deepEqual({ ...H.excludedCounts(dataset([0.01, 0.02], [0, 1], null)) }, { sigma: null, sqrtI: 1, absI: 1, none: 0 });
    assert.deepEqual(Object.keys(counts), [...W.MODES]);
    assert.equal(H.excludedCounts(null), null);
});

test('5.7-13: no-sigma comes from the data itself (SasFitWeighting.defaultMode), not from a flag', () => {
    const none = dataset(Q6, [6, 5, 4, 3, 2, 1], null);
    const unusable = dataset(Q6, [6, 5, 4, 3, 2, 1], [0, 0, NaN, -1, 0, 0]);
    [none, unusable].forEach((ds) => {
        assert.equal(W.defaultMode(ds), 'none');
        const hint = byId(pre({ dataset: ds, weighting: 'none' }), 'no-sigma');
        assert.equal(hint.text, '此檔沒有可用的誤差欄，權重使用不加權');
        assert.equal(hint.tone, 'warn');
    });
    assert.equal(byId(pre({ dataset: none, weighting: 'absI' }), 'no-sigma').text, '此檔沒有可用的誤差欄，不能使用「資料 σ」權重');
    assert.equal(ids(pre({ weighting: 'none' })).includes('no-sigma'), false, 'data with errors, user chose no weighting');
});

test('suspect-nm from the load notes', () => {
    const hint = byId(pre({ notes: { ...NOTES, suspectNm: true } }), 'suspect-nm');
    assert.equal(hint.text, 'q 範圍像是 nm⁻¹（一般 SAXS 在 Å⁻¹ 下 q 約 0.003–0.5）：若單位確實是 nm⁻¹，請移除此檔，把 Q 單位改選 nm⁻¹ 後重新載入');
    assert.equal(hint.tone, 'warn');
});

test('preFitHints: fixed order', () => {
    const ds = dataset(Q6, [0, 5, 4, 3, 2, 1], null);
    const hints = pre({
        modelSpec: { ...SPEC, structure: 'hayter_msa' }, dataset: ds, weighting: 'sqrtI', notes: { ...NOTES, suspectNm: true },
    });
    assert.deepEqual(ids(hints), ['hayter', 'no-sigma', 'nonpositive-weight', 'suspect-nm']);
    assert.deepEqual([...H.PRE_FIT_HINT_IDS], ['hayter', 'no-sigma', 'invalid-sigma', 'nonpositive-weight', 'suspect-nm']);
});

// ------------------------------------------------------------------ plot status

test('plotStatus: each part alone', () => {
    const one = (input) => ({ ...H.plotStatus(input) });
    assert.deepEqual(one({}), { text: '', live: '' });
    assert.deepEqual(one(), { text: '', live: '' });
    assert.deepEqual(one({ computing: true }), { text: '計算中…', live: '' });
    assert.deepEqual(one({ paused: true }), {
        text: '多分散網格過大，即時預覽已暫停，請按「更新曲線」', live: '多分散網格過大，即時預覽已暫停，請按「更新曲線」',
    });
    assert.equal(one({ previewPoints: 122 }).text, '預覽以 122 點計算');
    assert.equal(one({ hidden: 5 }).text, '隱藏了 5 點');
    assert.equal(one({ hidden: 0 }).text, '');
    assert.equal(one({ displayStride: 3 }).text, '點數較多，圖上每 3 點顯示 1 點（擬合仍使用全部點）');
    assert.equal(one({ displayStride: 1 }).text, '');
    assert.equal(one({ nonFinite: 4 }).text, '模型曲線有 4 點無法計算');
    assert.equal(one({ nonFinite: 0 }).text, '');
    assert.equal(one({ allNonFinite: true }).text, '這組參數算不出模型曲線，請檢查數值');
    assert.equal(one({ error: '模型參數不合法，請檢查輸入值。' }).text, '模型參數不合法，請檢查輸入值。');
    assert.equal(one({ previewPoints: null, hidden: null, displayStride: null, nonFinite: null, error: null }).text, '');
});

test('plotStatus: combined in a fixed order with full-width semicolons; live leaves out "computing"', () => {
    const s = H.plotStatus({
        computing: true, paused: true, previewPoints: 50, hidden: 2, displayStride: 4, nonFinite: 3, allNonFinite: false, error: '錯誤',
    });
    const rest = '多分散網格過大，即時預覽已暫停，請按「更新曲線」；預覽以 50 點計算；點數較多，圖上每 4 點顯示 1 點（擬合仍使用全部點）；'
        + '隱藏了 2 點；模型曲線有 3 點無法計算；錯誤';
    assert.equal(s.text, '計算中…；' + rest);
    assert.equal(s.live, rest);
    assert.ok(Object.isFrozen(s));
    assert.equal(H.plotStatus({ nonFinite: 200, allNonFinite: true }).text, '這組參數算不出模型曲線，請檢查數值', 'not both');
});

// ------------------------------------------------------------------ errors (item 9, spec 12)

const errorOf = (code, message, detail) => Object.assign(new Error(message || '訊息'), { code, detail: detail === undefined ? 'tech' : detail });
const EXPECTED_WHERE = {
    SUPERSEDED: 'ignore', STOPPED: 'ignore', BUSY: 'ignore',
    BAD_PARAMS: 'source', UNKNOWN_MODEL: 'source',
    TOO_FEW_POINTS: 'fit', BAD_RANGE: 'fit', BAD_BOUNDS: 'fit', BAD_FIT_FLAGS: 'fit', BAD_WEIGHTING: 'fit', BAD_OPTIONS: 'fit', BAD_DATA: 'fit',
    WASM_LOAD: 'page', WASM_TRAP: 'page', WORKER_CRASH: 'page', WORKER_START_FAILED: 'page', INTERNAL: 'page',
    BAD_MESSAGE: 'page', UNKNOWN_TYPE: 'page', POST_FAILED: 'page', DISPOSED: 'page',
};

test('errorNotice: EVERY code of the worker core and of the client is routed', () => {
    const codes = [...Core.ERROR_CODES, ...Client.ERROR_CODES];
    assert.equal(new Set(codes).size, codes.length);
    assert.deepEqual([...codes].sort(), Object.keys(EXPECTED_WHERE).sort(), 'a new code needs a route (and a line in this table)');
    assert.deepEqual(Object.keys(H.ERROR_ROUTES).sort(), [...codes].sort());
    codes.forEach((code) => {
        ['preview', 'fit'].forEach((source) => {
            const notice = H.errorNotice(errorOf(code), source);
            const expected = EXPECTED_WHERE[code] === 'source' ? source : EXPECTED_WHERE[code];
            assert.equal(notice.where, expected, code + ' from ' + source);
            assert.ok(Object.isFrozen(notice));
            if (expected === 'ignore') assert.equal(notice.text, '', code);
            else assert.ok(notice.text.startsWith('訊息'), code);
            assert.equal(notice.detail, 'tech');
        });
    });
});

test('errorNotice: the text is the error\'s own message; detail is for the console', () => {
    const notice = H.errorNotice(errorOf('BAD_PARAMS', '模型參數不合法，請檢查輸入值。', 'Unused parameters in call to sphere: x'), 'preview');
    assert.deepEqual({ ...notice }, { where: 'preview', text: '模型參數不合法，請檢查輸入值。', detail: 'Unused parameters in call to sphere: x' });
    assert.equal(H.errorNotice(errorOf('WORKER_CRASH', '計算執行緒異常結束，已重設，可直接重試。', ''), 'fit').detail, '');
    assert.equal(H.errorNotice(errorOf('INTERNAL', 'm', undefined), 'fit').detail, 'tech');
    assert.equal(H.errorNotice(Object.assign(new Error('m'), { code: 'INTERNAL' }), 'fit').detail, '');
});

test('errorNotice: WASM_LOAD and WORKER_START_FAILED add what to do (spec 12), each with its own message', () => {
    const wasm = H.errorNotice(errorOf('WASM_LOAD', '模型計算模組載入失敗，請確認網路連線後重試。', 'ellipsoid: Failed to fetch'), 'preview');
    assert.equal(wasm.text, '模型計算模組載入失敗，請確認網路連線後重試。請確認此頁是以 http(s) 開啟（不是 file://），並重新整理頁面');
    assert.equal(wasm.where, 'page');
    const start = H.errorNotice(errorOf('WORKER_START_FAILED', '計算執行緒無法啟動，請確認網路連線並重新整理頁面後再試。'), 'fit');
    assert.equal(start.text, '計算執行緒無法啟動，請確認網路連線並重新整理頁面後再試。請確認此頁是以 http(s) 開啟（不是 file://），並重新整理頁面');
    const crash = H.errorNotice(errorOf('WORKER_CRASH', '計算執行緒異常結束，已重設，可直接重試。'), 'fit');
    assert.equal(crash.text, '計算執行緒異常結束，已重設，可直接重試。');
    assert.notEqual(crash.text, start.text);
});

test('errorNotice: anything without a known code goes to the page with a general message', () => {
    const general = '發生未預期的錯誤，請重新整理頁面後再試';
    const plain = H.errorNotice(new TypeError('x is not a function'), 'fit');
    assert.equal(plain.where, 'page');
    assert.equal(plain.text, general);
    assert.ok(plain.detail.includes('x is not a function'));
    assert.deepEqual({ ...H.errorNotice('boom', 'preview') }, { where: 'page', text: general, detail: 'boom' });
    assert.equal(H.errorNotice(errorOf('NEW_CODE'), 'fit').where, 'page');
    assert.equal(H.errorNotice(errorOf('toString'), 'fit').where, 'page', 'inherited names are not codes');
    assert.equal(H.errorNotice(null, 'fit').where, 'page');
    assert.throws(() => H.errorNotice(errorOf('INTERNAL'), 'sequence'), /source/);
});
