'use strict';
/**
 * Decision H-1 (spec 15): the fit measure is called chi2r only when the
 * weights are the data's sigma. With sqrt|I|, |I| or no weighting the same
 * number has no absolute scale: it is labelled "加權殘差均方", gets no
 * high / low hint and does not colour the status chip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitHints: H, SasFitHtml: Html, ResultTiles } = require('./load.js');
const { FIT_RESULT_FIELDS } = require('./sasfit-fit-helpers.js');

const byId = (hints, id) => hints.find((h) => h.id === id);
function result(weighting, overrides) {
    const r = {
        params: { scale: 1, background: 0.001, radius: 50 }, names: ['scale', 'radius'],
        errors: { scale: 0.01, radius: 0.5 }, errorsScaled: { scale: 0.02, radius: 1 }, displayErrorsScaled: weighting !== 'sigma',
        covariance: [[1e-4, 0], [0, 0.25]], correlation: [[1, 0.1], [0.1, 1]],
        chi2: 110, chi2r: 1.1, dof: 100, iterations: 12, status: 'converged', atBound: {},
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: new Float64Array(3), residuals: new Float64Array(3),
        settings: { modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false }, weighting,
            range: { qMin: 0.01, qMax: 0.3 }, cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10 },
        ...overrides,
    };
    assert.deepEqual(Object.keys(r).sort(), [...FIT_RESULT_FIELDS].sort());
    return Object.freeze(r);
}
const OTHERS = ['sqrtI', 'absI', 'none'];
const NOTE = '權重不是資料的 σ：這個數值沒有絕對意義（不是 χ²ᵣ），只能比較同一組資料、同一種權重的不同擬合';

test('measure: label and note by weighting (a FitResult or the name of a weighting)', () => {
    assert.deepEqual({ ...H.measure('sigma') }, { isChi2: true, label: 'χ²ᵣ', note: '' });
    OTHERS.forEach((w) => assert.deepEqual({ ...H.measure(w) }, { isChi2: false, label: '加權殘差均方', note: NOTE }, w));
    assert.equal(H.measure(result('sigma')).label, 'χ²ᵣ');
    assert.equal(H.measure(result('none')).label, '加權殘差均方');
    assert.equal(H.measure(undefined).isChi2, false, 'unknown: do not claim a chi-square');
    assert.equal(H.measure(null).label, '加權殘差均方');
});

test('the four cases of the review: no local-minimum / too-small hint and a plain chip unless the weights are sigma', () => {
    const cases = [['none', 117], ['none', 20900], ['sqrtI', 0.126], ['absI', 0.0336]];
    for (const [weighting, chi2r] of cases) {
        const r = result(weighting, { chi2r });
        const ids = H.fitHints(r).map((h) => h.id);
        assert.deepEqual(ids, ['scaled-errors'], weighting + ' ' + chi2r);
        assert.deepEqual({ ...H.statusLabel(r) }, { text: '已收斂', tone: 'ok' }, weighting + ' ' + chi2r);
    }
    assert.deepEqual(H.fitHints(result('sigma', { chi2r: 117 })).map((h) => h.id), ['local-minimum']);
    assert.equal(H.statusLabel(result('sigma', { chi2r: 117 })).tone, 'warn');
    assert.deepEqual(H.fitHints(result('sigma', { chi2r: 0.0336 })).map((h) => h.id), ['overestimated-errors']);
    assert.equal(H.statusLabel(result('sigma', { chi2r: 0.0336 })).tone, 'warn');
});

test('chip: a measure that is not finite and the flags of the fit turn "converged" into a warning in every mode', () => {
    for (const weighting of ['sigma', 'none']) {
        assert.equal(H.statusLabel(result(weighting)).tone, 'ok', weighting);
        assert.equal(H.statusLabel(result(weighting, { chi2r: NaN })).tone, 'warn', weighting);
        assert.equal(H.statusLabel(result(weighting, { illConditioned: true })).tone, 'warn', weighting);
        assert.equal(H.statusLabel(result(weighting, { jacobianNonFinite: true })).tone, 'warn', weighting);
        assert.equal(H.statusLabel(result(weighting, { nonFiniteCurvePoints: 2 })).tone, 'warn', weighting);
        assert.equal(H.statusLabel(result(weighting, { status: 'maxiter' })).tone, 'warn', weighting);
        assert.equal(H.statusLabel(result(weighting, { status: 'failed' })).tone, 'error', weighting);
    }
});

test('texts of the high / low hints (sigma only)', () => {
    assert.equal(byId(H.fitHints(result('sigma', { chi2r: 50 })), 'local-minimum').text,
        'χ²ᵣ 遠大於 1：模型與資料不符。可能停在局部極小值（請換起始值重試）、模型不適用，或資料誤差被低估。此時參數誤差沒有參考價值');
    assert.equal(byId(H.fitHints(result('sigma', { chi2r: 0.01 })), 'overestimated-errors').text,
        'χ²ᵣ 遠小於 1：資料的誤差可能被高估，或自由參數過多');
    assert.equal(byId(H.fitHints(result('sigma', { illConditioned: true })), 'ill-conditioned').text,
        '參數無法由資料獨立決定（彼此高度相關，或某個參數對曲線幾乎沒有影響），誤差不可靠');
});

test('scaled errors: the label and the conversion do not speak of chi2r', () => {
    const r = result('sqrtI', { chi2r: 0.126 });
    const column = H.errorColumn(r);
    assert.equal(column.label, '±（已乘 √均方）');
    const text = '誤差已乘 √(加權殘差均方)＝0.355；SasView 在相同權重下顯示未乘的值＝此處誤差 ÷ 0.355';
    assert.equal(column.title, text);
    assert.equal(byId(H.fitHints(r), 'scaled-errors').text, text);
    assert.equal(byId(H.fitHints(result('none', { chi2r: NaN })), 'scaled-errors').text,
        '誤差已乘 √(加權殘差均方)；SasView 在相同權重下顯示未乘的值');
    assert.doesNotMatch(JSON.stringify(H.fitHints(result('none', { chi2r: 20900 })).map((h) => h.text)), /χ/);
    assert.equal(H.errorColumn(result('sigma')).label, '±');
});

test('hero tile: chi2r for sigma; "加權殘差均方" with the note below it otherwise', () => {
    const tile = (r) => /<div class="tile tile--hero">.*?<\/div><\/div>/.exec(Html.resultsHtml(r, { matches: true, fileName: 'a' }))[0];
    assert.equal(tile(result('sigma')), ResultTiles.tile({ label: 'χ²ᵣ', value: '1.10', hero: true,
        chip: { tone: 'ok', text: '已收斂' }, sub: ['自由度 100・102 點・12 次迭代'] }));
    assert.equal(tile(result('none', { chi2r: 117 })), ResultTiles.tile({ label: '加權殘差均方', value: '117', hero: true,
        chip: { tone: 'ok', text: '已收斂' }, sub: ['自由度 100・102 點・12 次迭代', NOTE] }));
    OTHERS.forEach((w) => assert.doesNotMatch(Html.resultsHtml(result(w), { matches: true, fileName: 'a' }).replace(NOTE, ''), /χ/, w));
});

test('plot status: why points are hidden, by plot mode', () => {
    assert.equal(H.plotStatus({ hidden: 19, mode: 'loglog' }).text, '19 點 I ≤ 0 或無效，對數軸無法顯示（不影響擬合）');
    assert.equal(H.plotStatus({ hidden: 19, mode: 'guinier' }).text, '19 點 I ≤ 0 或無效，Guinier 座標（ln I）無法顯示（不影響擬合）');
    assert.equal(H.plotStatus({ hidden: 2, mode: 'kratky' }).text, '2 點的 q 或 I 不是有效數值，無法顯示');
    assert.equal(H.plotStatus({ hidden: 2 }).text, '2 點無法顯示');
    assert.equal(H.plotStatus({ hidden: 0, mode: 'loglog' }).text, '');
});

test('hayter notice does not lean on chi2r', () => {
    const hint = byId(H.preFitHints({ modelSpec: { model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: false } }), 'hayter');
    assert.equal(hint.text, '結構因子 hayter_msa 在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同），'
        + '擬合得到的誤差可能不可靠；請連同殘差圖一起判斷結果');
});
