'use strict';
/**
 * sasfit-fit-ui.js 的 stub-DOM 測試（M3 計畫 Task 13）：擬合範圍、權重、步數、開始／停止／回復／繼續、
 * 進度與朗讀、結果與規格 §5.7 的提示、錯誤路由、每一條路徑結束後都回到 idle。
 * 三個分段模組都載入（真的資料分段與模型分段），Worker client 與計時器是假的。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const { FIT_RESULT_FIELDS } = require('./sasfit-fit-helpers.js');

const Html = globalThis.SasFitHtml;
const Jobs = globalThis.SasFitJobs;
const Hints = globalThis.SasFitHints;
const Weighting = globalThis.SasFitWeighting;
const OFFICIAL = 'SYNTH_sphere_10.dat';

after(ui.restoreGlobals);

const lastView = (page) => page.plots.views[page.plots.views.length - 1];
const field = (page, name, key) => page.$(Html.paramFieldId(name, key));
const lastFit = (page) => page.client.fits[page.client.fits.length - 1];
const phase = (page) => page.Section.getState().fit.phase;

async function load(page, files = [ui.fixtureFile(OFFICIAL)]) {
    const input = page.$('sfFileInput');
    input.files = files;
    input.fire('change');
    await ui.flush();
    await ui.flush();
}

function type(page, id, value) {
    const input = page.$(id);
    input.value = value;
    input.fire('input');
    return input;
}

function tick(page, name) {
    const box = field(page, name, 'fit');
    box.checked = true;
    box.fire('change');
}

/** 一個載好官方檔、勾了 radius 的頁面。 */
async function ready(files) {
    const page = ui.boot();
    await load(page, files);
    tick(page, 'radius');
    return page;
}

const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

/** 由送出的 job 合成一個 FitResult（欄位與 Worker 給的相同）。 */
function resultOf(job, overrides = {}) {
    const names = Object.keys(job.fitFlags).filter((name) => job.fitFlags[name]);
    const n = job.data.q.length;
    const { values = {}, ...rest } = overrides;
    const result = {
        params: { ...job.params, ...values }, names,
        errors: Object.fromEntries(names.map((name) => [name, 0.5])),
        errorsScaled: Object.fromEntries(names.map((name) => [name, 1])),
        displayErrorsScaled: job.weighting !== 'sigma', covariance: identity(names.length), correlation: identity(names.length),
        chi2: 52, chi2r: 1.04, dof: 50, iterations: 7, status: 'converged', atBound: {},
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: Float64Array.from({ length: n }, () => 1), residuals: Float64Array.from({ length: n }, () => 0.1),
        settings: { modelSpec: job.modelSpec, weighting: job.weighting, range: job.range, cutoff: job.options.cutoff,
            maxSteps: job.options.maxSteps, method: 'lm', ftol: 1e-10, xtol: 1e-10 },
        ...rest,
    };
    assert.deepEqual(Object.keys(result).sort(), [...FIT_RESULT_FIELDS].sort());
    return Object.freeze(result);
}

const stoppedOf = (job, iterations) => resultOf(job, {
    status: 'stopped', names: [], errors: {}, errorsScaled: {}, covariance: [], correlation: [], chi2: null, chi2r: null, dof: null,
    curve: null, residuals: null, iterations,
});

/** 按開始、以 overrides 結束這次擬合。 */
async function fitOnce(page, overrides) {
    page.$('sfFitStart').fire('click');
    const call = lastFit(page);
    const result = resultOf(call.job, overrides);
    call.resolve(result);
    await ui.flush();
    return { call, result };
}

function codedError(code, message, detail) {
    return Object.assign(new Error(message), { code, detail });
}

// ---------------------------------------------------------------- 啟動與空狀態
test('[sasfit-fit-ui] 模組頂層不碰 document；沒有資料時開始停用、範圍與權重停用、說明請先載入資料', () => {
    const saved = global.document;
    delete global.document;
    try {
        assert.doesNotThrow(() => ui.loadModule('sasfit-fit-ui.js'));
    } finally {
        global.document = saved;
    }
    const page = ui.boot();
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.$('sfFitStop').disabled, true);
    assert.equal(page.$('sfFitRevert').disabled, true);
    assert.equal(page.$('sfRangeInfo').textContent, '請先載入資料，才能設定擬合範圍並開始擬合。');
    for (const id of ['sfQMin', 'sfQMax', 'sfRangeFull', 'sfRangeDefault', 'sfWeighting']) assert.equal(page.$(id).disabled, true, id);
    assert.equal(page.$('sfMaxSteps').disabled, false);
    assert.equal(page.$('sfMaxSteps').value, '200');
    assert.equal(page.$('sfFitResults').innerHTML, '');
});

// ---------------------------------------------------------------- 範圍
test('[sasfit-fit-ui] 範圍：載入後是 defaultRange；手動改 → userEdited，之後換權重範圍不變；預設範圍／全範圍', async () => {
    const page = await ready();
    const dataset = page.Section.getState().files[0].dataset;
    const def = Weighting.defaultRange(dataset, 'sigma');
    assert.equal(Number(page.$('sfQMin').value), Number(def.qMin.toPrecision(6)));
    assert.equal(Number(page.$('sfQMax').value), Number(def.qMax.toPrecision(6)));
    assert.equal(page.Section.getState().range.userEdited, false);

    type(page, 'sfQMax', '0.07');
    assert.deepEqual(page.Section.getState().range, { qMin: def.qMin, qMax: 0.07, userEdited: true });
    assert.equal(page.$('sfQMax').value, '0.07', '輸入框保留正在打的字');
    assert.deepEqual(lastView(page).range, { qMin: def.qMin, qMax: 0.07 }, '圖上的灰色區跟著變');
    const select = page.$('sfWeighting');
    select.value = 'none';
    select.fire('change');
    assert.equal(page.Section.getState().weighting, 'none');
    assert.equal(page.Section.getState().range.qMax, 0.07, '手動改過的範圍不跟權重變');

    page.$('sfRangeDefault').fire('click');
    const defNone = Weighting.defaultRange(dataset, 'none');
    assert.deepEqual(page.Section.getState().range, { qMin: defNone.qMin, qMax: defNone.qMax, userEdited: false });
    assert.equal(Number(page.$('sfQMax').value), Number(defNone.qMax.toPrecision(6)));
    select.value = 'sigma';
    select.fire('change');
    assert.equal(page.Section.getState().range.qMin, def.qMin, '之後換權重會跟著變');

    page.$('sfRangeFull').fire('click');
    const full = Jobs.fullRange(dataset);
    assert.deepEqual(page.Section.getState().range, { ...full, userEdited: true });
    assert.equal(Number(page.$('sfQMin').value), Number(full.qMin.toPrecision(6)));
});

test('[sasfit-fit-ui] 範圍不合法（Qmin ≥ Qmax、非數字）：aria-invalid、錯誤文字、開始停用、狀態不變；改回後恢復', async () => {
    const page = await ready();
    const before = page.Section.getState().range;
    assert.equal(page.$('sfFitStart').disabled, false);
    type(page, 'sfQMin', '0.5');
    assert.equal(page.$('sfQMin').getAttribute('aria-invalid'), 'true');
    assert.equal(page.$('sfQMinError').textContent, 'Q 下限必須小於 Q 上限');
    assert.equal(page.$('sfQMinError').hidden, false);
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.Section.getState().range, before, '不合法的範圍不寫入狀態');
    assert.equal(page.$('sfQMin').value, '0.5', '輸入框不被改回');

    type(page, 'sfQMin', '0.01');
    type(page, 'sfQMax', '');
    assert.equal(page.$('sfQMin').getAttribute('aria-invalid'), null);
    assert.equal(page.$('sfQMax').getAttribute('aria-invalid'), 'true');
    assert.equal(page.$('sfQMaxError').textContent, 'Q 上限必須是大於 0 的數字');
    assert.equal(page.$('sfFitStart').disabled, true);
    type(page, 'sfQMax', '0.2');
    assert.equal(page.$('sfQMaxError').hidden, true);
    assert.equal(page.$('sfFitStart').disabled, false);
    assert.deepEqual(page.Section.getState().range, { qMin: 0.01, qMax: 0.2, userEdited: true });
});

test('[sasfit-fit-ui] sfRangeInfo：範圍內 N 點、自由參數 M 個；N ≤ M 或沒勾參數時停用並說明（規格 §12）', async () => {
    const page = await ready();
    const state = page.Section.getState();
    const info = Jobs.fitReadiness(page.Section.getForm(), state.files[0].dataset, { range: state.range, weighting: state.weighting });
    assert.equal(info.nFree, 3);
    assert.equal(page.$('sfRangeInfo').textContent, `範圍內 ${info.nPoints} 點可參與擬合，自由參數 3 個`);

    type(page, 'sfQMin', '0.05');
    type(page, 'sfQMax', '0.0502');
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.match(page.$('sfRangeInfo').textContent, /必須多於要擬合的參數個數（3 個）/);
    page.$('sfRangeDefault').fire('click');
    assert.equal(page.$('sfFitStart').disabled, false);

    for (const name of ['scale', 'background', 'radius']) {
        const box = field(page, name, 'fit');
        box.checked = false;
        box.fire('change');
    }
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.$('sfRangeInfo').textContent, '請至少勾選一個要擬合的參數。');
});

test('[sasfit-fit-ui] 參數表有不合法欄位時不允許擬合', async () => {
    const page = await ready();
    const input = field(page, 'radius', 'value');
    input.value = 'x';
    input.fire('input');
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.$('sfRangeInfo').textContent, '參數表有不合法的欄位，請先修正。');
});

// ---------------------------------------------------------------- 權重與擬合前提示
test('[sasfit-fit-ui] 權重選單＝weightingOptionsHtml，選項文字含各自的排除點數（§5.7 第 11 點）', async () => {
    const page = await ready();
    const dataset = page.Section.getState().files[0].dataset;
    const counts = Hints.excludedCounts(dataset);
    assert.equal(page.$('sfWeighting').innerHTML, Html.weightingOptionsHtml(counts, true, 'sigma'));
    assert.match(page.$('sfWeighting').innerHTML, new RegExp(`資料 σ（排除 ${counts.sigma} 點）`));
    assert.equal(page.$('sfWeighting').value, 'sigma');
});

test('[sasfit-fit-ui] 沒有可用 σ 的檔：「資料 σ」停用、已選不加權、no-sigma 提示（§5.7 第 13 點）', async () => {
    const page = await ready([ui.fixtureFile('generic-2col.txt')]);
    assert.equal(page.Section.getState().weighting, 'none');
    assert.equal(page.$('sfWeighting').value, 'none');
    const sigma = page.$('sfWeighting').querySelectorAll('option').find((o) => o.value === 'sigma');
    assert.equal(sigma.disabled, true);
    assert.match(sigma.textContent, /此檔沒有可用的誤差/);
    assert.equal(page.$('sfPreFitHints').querySelectorAll('[data-hint="no-sigma"]').length, 1);
});

test('[sasfit-fit-ui] √|I| 而範圍內有 I ≤ 0：第 11 點的警告；suspectNm 的檔有 suspect-nm 提示；hayter 提示', async () => {
    const page = await ready();
    page.$('sfRangeFull').fire('click');
    const select = page.$('sfWeighting');
    select.value = 'sqrtI';
    select.fire('change');
    const state = page.Section.getState();
    const expected = Hints.preFitHints({ modelSpec: Jobs.modelSpec(page.Section.getForm()), dataset: state.files[0].dataset,
        range: state.range, weighting: 'sqrtI', notes: state.files[0].notes });
    assert.ok(expected.some((h) => h.id === 'nonpositive-weight'), '合成官方檔的 beamstop 列 I < 0');
    assert.equal(page.$('sfPreFitHints').innerHTML, Html.hintsHtml(expected));

    const nm = await ready([ui.fixtureFile('generic-nm.txt')]);
    assert.equal(nm.Section.getState().files[0].notes.suspectNm, true);
    assert.equal(nm.$('sfPreFitHints').querySelectorAll('[data-hint="suspect-nm"]').length, 1);
});

test('[sasfit-fit-ui] 最大步數：合法值寫入狀態；不合法時 aria-invalid、說明、開始停用', async () => {
    const page = await ready();
    type(page, 'sfMaxSteps', '2');
    assert.equal(page.Section.getState().maxSteps, 2);
    assert.equal(page.$('sfMaxStepsError').hidden, true);
    type(page, 'sfMaxSteps', '0');
    assert.equal(page.$('sfMaxSteps').getAttribute('aria-invalid'), 'true');
    assert.equal(page.$('sfMaxStepsError').textContent, '最大步數必須是 1 到 10000 的整數');
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.Section.getState().maxSteps, 2);
    type(page, 'sfMaxSteps', '1.5');
    assert.equal(page.$('sfFitStart').disabled, true);
    type(page, 'sfMaxSteps', '50');
    assert.equal(page.$('sfFitStart').disabled, false);
    assert.equal(page.Section.getState().maxSteps, 50);
});

// ---------------------------------------------------------------- 開始與進度
test('[sasfit-fit-ui] 開始：先取消預覽、送出 fitJob、狀態 running、控制項停用；進度每步更新、朗讀區只在開始與結束更新', async () => {
    const page = await ready();
    const pendingTimers = page.timers.pendingCount();
    assert.ok(pendingTimers > 0, '勾選 radius 後有一個尚未觸發的預覽計時器');
    const evaluations = page.client.evaluations.length;
    const state = page.Section.getState();
    const expected = Jobs.fitJob(page.Section.getForm(), state.files[0].dataset,
        { range: state.range, weighting: state.weighting, maxSteps: state.maxSteps });
    page.$('sfFitStart').fire('click');

    assert.equal(page.client.fits.length, 1);
    assert.deepEqual(lastFit(page).job, expected);
    assert.equal(lastFit(page).job.data.q, state.files[0].dataset.q, '資料陣列以參照交出，不複製');
    assert.equal(phase(page), 'running');
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, evaluations, '預覽計時器已取消，擬合中不送預覽');
    assert.equal(page.$('sfFitStart').disabled, true);
    assert.equal(page.$('sfFitStop').disabled, false);
    for (const id of ['sfQMin', 'sfQMax', 'sfRangeFull', 'sfRangeDefault', 'sfWeighting', 'sfMaxSteps', 'sfModel', 'sfFileInput']) {
        assert.equal(page.$(id).disabled, true, id);
    }
    assert.equal(field(page, 'radius', 'value').disabled, true);
    assert.equal(page.$('sfFitResults').getAttribute('aria-busy'), 'true');
    assert.equal(page.$('sfFitProgress').textContent, '開始擬合…');
    assert.equal(page.$('sfFitLive').textContent, '開始擬合…');

    const { onProgress } = lastFit(page).options;
    const bodySets = page.$('sfParamBody').htmlSets;
    onProgress({ iteration: 1, chi2r: 12.3456 });
    assert.equal(page.$('sfFitProgress').textContent, '第 1 步，χ²ᵣ＝12.3');
    onProgress({ iteration: 2, chi2r: 1.5 });
    assert.equal(page.$('sfFitProgress').textContent, '第 2 步，χ²ᵣ＝1.50');
    assert.deepEqual([page.Section.getState().fit.iteration, page.Section.getState().fit.chi2r], [2, 1.5]);
    assert.equal(page.$('sfFitLive').textContent, '開始擬合…', '每一步不朗讀');
    assert.equal(page.$('sfParamBody').htmlSets, bodySets, '進度不重繪其他分段');

    lastFit(page).resolve(resultOf(lastFit(page).job, { values: { radius: 50.2 } }));
    await ui.flush();
    assert.equal(phase(page), 'idle');
    assert.equal(page.$('sfFitLive').textContent, '擬合結束：已收斂，χ²ᵣ＝1.04，共 7 步');
    assert.equal(page.$('sfFitProgress').textContent, page.$('sfFitLive').textContent);
    assert.equal(page.$('sfFitResults').getAttribute('aria-busy'), 'false');
});

// ---------------------------------------------------------------- 結束
test('[sasfit-fit-ui] converged：表單＝applyResult、結果磚與提示、± 欄、檔案列狀態、殘差、回復可用、焦點到結果、不送預覽', async () => {
    const page = await ready();
    page.$('sfTabFit').fire('click');
    const formBefore = page.Section.getForm();
    const evaluations = page.client.evaluations.length;
    const { result } = await fitOnce(page, { values: { radius: 50.2, scale: 1.01 } });
    const form = page.Section.getForm();
    const id = page.Section.getState().activeId;

    assert.deepEqual(form, Jobs.applyResult(formBefore, result));
    assert.equal(form.fields.radius.value, '50.2');
    assert.equal(Jobs.resultMatchesForm(form, result), true);
    assert.equal(page.Section.getState().fitResults[id], result);
    assert.equal(page.$('sfFitResults').innerHTML, Html.resultsHtml(result, { matches: true, fileName: OFFICIAL }));
    assert.match(page.$('sfFitResults').innerHTML, /tile--hero/);
    assert.equal(page.$('sfFitHints').innerHTML, Html.hintsHtml(Hints.fitHints(result)));
    assert.equal(field(page, 'radius', 'value').value, '50.2', '參數表的值更新');
    assert.equal(page.$('sfPm_radius').textContent, '± 0.50');
    assert.match(page.$('sfDataBody').innerHTML, /χ²ᵣ 1\.04・已收斂/);
    assert.deepEqual(lastView(page).residuals, { q: page.Section.getState().files[0].dataset.q, r: result.residuals });
    assert.equal(lastView(page).series[0].fitCurve.I, result.curve, '作用中資料畫 fitResult.curve（全部點）');
    assert.equal(lastView(page).preview, null);
    assert.equal(page.$('sfFitRevert').disabled, false);
    assert.equal(page.$('sfFitResults').focusCount, 1, 'A11y.focusResults');
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, evaluations, '結果與表單相符：不送 evaluate、不排預覽');
});

test('[sasfit-fit-ui] 權重不是資料 σ 時 ± 欄表頭註明已乘 √χ²ᵣ，並有換算的提示（§5.7 第 8 點）', async () => {
    const page = await ready();
    const select = page.$('sfWeighting');
    select.value = 'none';
    select.fire('change');
    const { result } = await fitOnce(page, { values: { radius: 50.2 } });
    assert.equal(result.displayErrorsScaled, true);
    assert.match(page.$('sfParamHead').innerHTML, /已乘 √χ²ᵣ/);
    assert.equal(page.$('sfPm_radius').textContent, '± 1.0');
    assert.equal(page.$('sfFitHints').querySelectorAll('[data-hint="scaled-errors"]').length, 1);
});

test('[sasfit-fit-ui] 回復擬合前參數：表單回到按開始當時的值（含 PD 寬度），結果變成「參數已修改」、± 清空、送預覽', async () => {
    const page = await ready();
    page.$('sfPdToggle_radius').fire('click');
    const width = field(page, 'radius', 'pd.width');
    width.value = '0.1';
    width.fire('input');
    const pdFit = field(page, 'radius', 'pd.fit');
    pdFit.checked = true;
    pdFit.fire('change');
    const formBefore = page.Section.getForm();
    await fitOnce(page, { values: { radius: 50.2, radius_pd: 0.12 } });
    assert.equal(field(page, 'radius', 'pd.width').value, '0.12');
    const evaluations = page.client.evaluations.length;

    page.$('sfFitRevert').fire('click');
    assert.equal(page.Section.getForm(), formBefore);
    assert.equal(field(page, 'radius', 'pd.width').value, '0.1');
    assert.equal(field(page, 'radius', 'value').value, '50');
    assert.match(page.$('sfFitResults').innerHTML, /參數已修改，下列為上次擬合的結果/);
    assert.equal(page.$('sfFitHints').innerHTML, '');
    assert.equal(page.$('sfPm_radius').textContent, '');
    assert.equal(page.$('sfFitRevert').disabled, true);
    assert.equal(page.$('sfFitStart').focusCount, 1);
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, evaluations + 1, '回復後送預覽');
    assert.equal(lastView(page).residuals, null);
});

test('[sasfit-fit-ui] 停止：client.stop 被呼叫；stopped 的結果 → 「已停止（第 N 步），參數未變更」、表單不變、先前的結果保留', async () => {
    const page = await ready();
    const first = await fitOnce(page, { values: { radius: 50.2 } });
    const id = page.Section.getState().activeId;
    const form = page.Section.getForm();

    page.$('sfFitStart').fire('click');
    lastFit(page).options.onProgress({ iteration: 3, chi2r: 2 });
    page.$('sfFitStop').fire('click');
    assert.equal(page.client.stops, 1);
    lastFit(page).resolve(stoppedOf(lastFit(page).job, 3));
    await ui.flush();
    assert.equal(phase(page), 'idle');
    assert.equal(page.Section.getState().fit.outcome, 'stopped');
    assert.equal(page.$('sfFitProgress').textContent, '已停止（第 3 步），參數未變更');
    assert.equal(page.$('sfFitLive').textContent, '已停止（第 3 步），參數未變更');
    assert.equal(page.Section.getForm(), form);
    assert.equal(page.Section.getState().fitResults[id], first.result, '先前的結果保留');
    assert.equal(page.$('sfFitStart').disabled, false);
    assert.equal(page.$('sfFitStop').disabled, true);
    page.$('sfFitStop').fire('click');
    assert.equal(page.client.stops, 1, '沒有擬合在跑時停止鈕不做事');
});

test('[sasfit-fit-ui] maxiter：提示內有「從目前的值繼續擬合」，按下以目前表單再送一次；回復點仍是第一次擬合之前（§5.7 第 7 點）', async () => {
    const page = await ready();
    const original = page.Section.getForm();
    await fitOnce(page, { status: 'maxiter', values: { radius: 51.5 } });
    assert.match(page.$('sfDataBody').innerHTML, /未收斂（達最大步數）/);
    const button = page.$('sfFitHints').querySelector('[data-action="continue"]');
    assert.ok(button, '有繼續擬合的按鈕');
    assert.equal(button.textContent, '從目前的值繼續擬合');

    button.fire('click');
    assert.equal(page.client.fits.length, 2);
    assert.equal(lastFit(page).job.params.radius, 51.5, '以結果的值為新的起始值');
    assert.equal(page.$('sfFitHints').innerHTML, '', '擬合進行中不提供繼續');
    lastFit(page).resolve(resultOf(lastFit(page).job, { values: { radius: 50.1 } }));
    await ui.flush();
    assert.equal(page.Section.getForm().fields.radius.value, '50.1');
    page.$('sfFitRevert').fire('click');
    assert.equal(page.Section.getForm(), original);
});

test('[sasfit-fit-ui] failed＋blockedByNonFinite：結果照常顯示並有對應提示；jacobianNonFinite：該參數 ± 欄「無法計算」', async () => {
    const page = await ready();
    const blocked = await fitOnce(page, { status: 'failed', blockedByNonFinite: true, values: { radius: 49 } });
    assert.match(page.$('sfFitResults').innerHTML, /tile--hero/);
    assert.equal(page.$('sfFitHints').querySelectorAll('[data-hint="blocked"]').length, 1);
    assert.equal(page.Section.getForm().fields.radius.value, '49', '目前最好的參數');
    assert.match(page.$('sfDataBody').innerHTML, /失敗/);
    assert.equal(blocked.result.status, 'failed');

    const jac = await fitOnce(page, { jacobianNonFinite: true, errors: { scale: 0.5, background: 0.5, radius: NaN },
        errorsScaled: { scale: 1, background: 1, radius: NaN }, values: { radius: 50.3 } });
    assert.equal(jac.result.jacobianNonFinite, true);
    assert.equal(page.$('sfPm_radius').textContent, '無法計算');
    assert.equal(page.$('sfPm_scale').textContent, '± 0.50');
    assert.equal(page.$('sfFitHints').querySelectorAll('[data-hint="jacobian-nan"]').length, 1);
    assert.equal(page.$('sfFitHints').querySelectorAll('[data-hint="ill-conditioned"]').length, 0, '不是「相關性過高」');
});

test('[sasfit-fit-ui] §5.7 其餘提示都出現在結果區：貼邊界、強相關、0 步、局部極小、χ²ᵣ 過小、非有限點、病態', async () => {
    const page = await ready();
    await fitOnce(page, {
        chi2r: 25, iterations: 0, atBound: { radius: 'upper' }, illConditioned: true, nonFiniteCurvePoints: 4,
        correlation: [[1, 0.995, 0], [0.995, 1, 0], [0, 0, 1]], values: { radius: 50.4 },
    });
    const ids = page.$('sfFitHints').querySelectorAll('[data-hint]').map((h) => h.getAttribute('data-hint'));
    for (const id of ['zero-steps', 'local-minimum', 'ill-conditioned', 'at-bound', 'strong-correlation', 'non-finite-curve']) {
        assert.ok(ids.includes(id), id);
    }
    assert.equal(page.$('sfPm_radius').textContent, Hints.AT_BOUND_ERROR_TEXT);
    assert.match(page.$('sfFitResults').innerHTML, new RegExp(Hints.AT_BOUND_ERROR_TEXT));
    assert.match(page.$('sfFitHints').innerHTML, /模型曲線有 4 點無法計算/);

    await fitOnce(page, { chi2r: 0.02, values: { radius: 50.5 } });
    assert.equal(page.$('sfFitHints').querySelectorAll('[data-hint="overestimated-errors"]').length, 1);
});

// ---------------------------------------------------------------- 錯誤
test('[sasfit-fit-ui] fit 以 TOO_FEW_POINTS reject：sfFitAlert 顯示 message、console.warn 有 detail、按鈕恢復', async () => {
    const page = await ready();
    page.$('sfFitStart').fire('click');
    const err = codedError('TOO_FEW_POINTS', '可參與擬合的點太少', 'selected 2 points, 3 parameters');
    const warnings = await ui.captureConsole('warn', async () => { lastFit(page).reject(err); await ui.flush(); });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /selected 2 points, 3 parameters/);
    assert.equal(page.$('sfFitAlert').innerHTML, Html.hintsHtml([{ id: 'fit-error', tone: 'error', text: Hints.errorNotice(err, 'fit').text }]));
    assert.equal(page.$('sfAlert').innerHTML, '');
    assert.equal(phase(page), 'idle');
    assert.equal(page.Section.getState().fit.outcome, 'error');
    assert.equal(page.$('sfFitStart').disabled, false);
    assert.equal(page.$('sfFitStop').disabled, true);
    assert.equal(field(page, 'radius', 'value').disabled, false);
    assert.equal(page.$('sfFitLive').textContent, '擬合沒有完成');
});

test('[sasfit-fit-ui] WORKER_CRASH：sfAlert 顯示、可直接重試；下一次擬合開始時兩個提示都清掉；BUSY 不顯示任何錯誤', async () => {
    const page = await ready();
    page.$('sfFitStart').fire('click');
    const crash = codedError('WORKER_CRASH', '計算執行緒異常結束', 'boom (worker.js:1)');
    await ui.captureConsole('warn', async () => { lastFit(page).reject(crash); await ui.flush(); });
    assert.match(page.$('sfAlert').innerHTML, /計算執行緒異常結束/);
    assert.equal(page.$('sfFitAlert').innerHTML, '');
    assert.equal(phase(page), 'idle');

    page.$('sfFitStart').fire('click');
    assert.equal(page.client.fits.length, 2, '再按一次會送出新的 fit');
    assert.equal(page.$('sfAlert').innerHTML, '', '開始時清掉');
    const warnings = await ui.captureConsole('warn', async () => {
        lastFit(page).reject(codedError('BUSY', '已有擬合進行中', undefined));
        await ui.flush();
    });
    assert.deepEqual(warnings, []);
    assert.equal(page.$('sfAlert').innerHTML, '');
    assert.equal(page.$('sfFitAlert').innerHTML, '');
    assert.equal(phase(page), 'idle');
});

test('[sasfit-fit-ui] 建立 client 或 fit 同步丟例外、fit resolve 成不是結果的東西：都回到 idle 並顯示一般錯誤', async () => {
    const page = await ready();
    Object.defineProperty(page.client, 'fit', { configurable: true, value() { throw new Error('cannot start'); } });
    await ui.captureConsole('warn', async () => { page.$('sfFitStart').fire('click'); await ui.flush(); });
    assert.equal(phase(page), 'idle');
    assert.match(page.$('sfAlert').innerHTML, /發生未預期的錯誤/);

    Object.defineProperty(page.client, 'fit', { configurable: true, value: () => Promise.resolve(undefined) });
    await ui.captureConsole('warn', async () => { page.$('sfFitStart').fire('click'); await ui.flush(); });
    assert.equal(phase(page), 'idle');
    assert.equal(page.$('sfFitStart').disabled, false);
});

test('[sasfit-fit-ui] onProgress 收到不合格的內容或在擬合結束後才到：不丟例外、不改狀態；之後照常結束', async () => {
    const page = await ready();
    page.$('sfFitStart').fire('click');
    const { onProgress } = lastFit(page).options;
    assert.doesNotThrow(() => { onProgress(undefined); onProgress({ iteration: -1, chi2r: 1 }); onProgress({ iteration: 1.5 }); });
    assert.equal(page.Section.getState().fit.iteration, 0);
    onProgress({ iteration: 4, chi2r: NaN });
    assert.equal(page.$('sfFitProgress').textContent, '第 4 步，χ²ᵣ＝—');
    lastFit(page).resolve(resultOf(lastFit(page).job, { values: { radius: 50.2 } }));
    await ui.flush();
    assert.equal(phase(page), 'idle');
    const text = page.$('sfFitProgress').textContent;
    assert.doesNotThrow(() => onProgress({ iteration: 9, chi2r: 1 }));
    assert.equal(page.$('sfFitProgress').textContent, text, '結束後才到的進度不寫入');
});

test('[sasfit-fit-ui] 結果的值寫不進表單（非有限）：結果照常存入與顯示，表單不變，console.warn 說明', async () => {
    const page = await ready();
    const form = page.Section.getForm();
    page.$('sfFitStart').fire('click');
    const result = resultOf(lastFit(page).job, { status: 'failed', blockedByNonFinite: true, values: { radius: NaN } });
    const warnings = await ui.captureConsole('warn', async () => { lastFit(page).resolve(result); await ui.flush(); });
    assert.equal(warnings.length, 1);
    assert.equal(page.Section.getForm(), form);
    assert.equal(phase(page), 'idle');
    assert.equal(page.Section.getState().fitResults[page.Section.getState().activeId], result);
    assert.equal(page.$('sfFitRevert').disabled, true, '表單沒變：沒有可回復的');
});

// ---------------------------------------------------------------- 結果與表單是否相符
test('[sasfit-fit-ui] 擬合後改參數：結果區出現「參數已修改…」、± 清空、作用中曲線改用預覽；改回去 → 恢復', async () => {
    const page = await ready();
    const { result } = await fitOnce(page, { values: { radius: 50.2 } });
    const input = field(page, 'radius', 'value');
    const bodySets = page.$('sfParamBody').htmlSets;
    input.value = '50.3';
    input.fire('input');
    assert.match(page.$('sfFitResults').innerHTML, /參數已修改，下列為上次擬合的結果/);
    assert.match(page.$('sfFitResults').innerHTML, /tile--hero/, '上次的結果仍看得到');
    assert.equal(page.$('sfFitHints').innerHTML, '');
    assert.equal(page.$('sfPm_radius').textContent, '');
    assert.equal(page.$('sfPm_scale').textContent, '');
    assert.equal(lastView(page).series[0].fitCurve, null);
    assert.equal(lastView(page).residuals, null);
    assert.equal(page.$('sfParamBody').htmlSets, bodySets, '打字不重建參數表');
    page.timers.advance(150);
    const call = page.client.evaluations[page.client.evaluations.length - 1];
    assert.equal(call.request.params.radius, 50.3);
    const I = Float64Array.from(call.request.q, () => 2);
    call.resolve({ I, extras: {} });
    await ui.flush();
    assert.equal(lastView(page).preview.I, I, '作用中資料的曲線改用預覽');

    input.value = '50.2';
    input.fire('input');
    assert.equal(page.$('sfFitResults').innerHTML, Html.resultsHtml(result, { matches: true, fileName: OFFICIAL }));
    assert.equal(page.$('sfPm_radius').textContent, '± 0.50');
    assert.equal(lastView(page).series[0].fitCurve.I, result.curve);
    assert.equal(page.$('sfFitHints').innerHTML, Html.hintsHtml(Hints.fitHints(result)));
});

test('[sasfit-fit-ui] 換作用中資料：顯示該資料自己的結果（沒有就清空）；表單不變；不相符時 ± 為空並有「參數已修改」', async () => {
    const page = await ready(['SYNTH_sphere_10.dat', 'SYNTH_sphere_20.dat'].map(ui.fixtureFile));
    const [a, b] = page.Section.getState().files.map((f) => f.id);
    const fitA = await fitOnce(page, { values: { radius: 50.2 } });
    const form = page.Section.getForm();

    page.$(Html.fileControlId(b, 'active')).fire('change');
    assert.equal(page.Section.getForm(), form, '表單不變');
    assert.equal(page.$('sfFitResults').innerHTML, '', 'B 沒有結果');
    assert.equal(page.$('sfFitHints').innerHTML, '');
    assert.equal(page.$('sfPm_radius').textContent, '', 'A 的誤差不擺在 B 旁邊');
    assert.equal(lastView(page).series.find((s) => s.id === a).fitCurve.I, fitA.result.curve, '非作用中的 A 畫自己的擬合曲線');

    const fitB = await fitOnce(page, { values: { radius: 49.7 } });
    assert.equal(page.$('sfFitResults').innerHTML, Html.resultsHtml(fitB.result, { matches: true, fileName: 'SYNTH_sphere_20.dat' }));

    page.$(Html.fileControlId(a, 'active')).fire('change');
    assert.equal(page.Section.getForm().fields.radius.value, '49.7', '表單是 B 擬合出來的值');
    assert.equal(page.$('sfFitResults').innerHTML, Html.resultsHtml(fitA.result, { matches: false, fileName: 'SYNTH_sphere_10.dat' }));
    assert.match(page.$('sfFitResults').innerHTML, /參數已修改，下列為上次擬合的結果/);
    assert.equal(page.$('sfPm_radius').textContent, '');
    assert.equal(page.$('sfFitHints').innerHTML, '');
});

test('[sasfit-fit-ui] 已停止的那行字只屬於當時的資料：換作用中資料後清掉', async () => {
    const page = await ready(['SYNTH_sphere_10.dat', 'SYNTH_sphere_20.dat'].map(ui.fixtureFile));
    const b = page.Section.getState().files[1].id;
    page.$('sfFitStart').fire('click');
    lastFit(page).resolve(stoppedOf(lastFit(page).job, 0));
    await ui.flush();
    assert.match(page.$('sfFitProgress').textContent, /已停止/);
    page.$(Html.fileControlId(b, 'active')).fire('change');
    assert.equal(page.$('sfFitProgress').textContent, '');
});

test('[sasfit-fit-ui] 重繪時結果與提示沒有變化就不重設 innerHTML（焦點不掉）', async () => {
    const page = await ready();
    await fitOnce(page, { values: { radius: 50.2 } });
    const sets = ['sfFitResults', 'sfFitHints', 'sfPreFitHints', 'sfWeighting'].map((id) => page.$(id).htmlSets);
    page.ctx.refresh();
    page.ctx.dispatch({ type: 'setPlotMode', mode: 'kratky' });
    assert.deepEqual(['sfFitResults', 'sfFitHints', 'sfPreFitHints', 'sfWeighting'].map((id) => page.$(id).htmlSets), sets);
});

test('[sasfit-fit-ui] 處理結果時自己出錯（例：移動焦點失敗）：console.error 記錄，頁面不會停在 running', async () => {
    const page = await ready();
    page.$('sfTabFit').fire('click');
    const original = window.A11y;
    window.A11y = Object.freeze({ ...original, focusResults() { throw new Error('focus failed'); } });
    try {
        page.$('sfFitStart').fire('click');
        const result = resultOf(lastFit(page).job, { values: { radius: 50.2 } });
        const errors = await ui.captureConsole('error', async () => { lastFit(page).resolve(result); await ui.flush(); });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /focus failed/);
        assert.equal(phase(page), 'idle');
        assert.equal(page.Section.getState().fitResults[page.Section.getState().activeId], result);
        assert.equal(page.$('sfFitStart').disabled, false);
    } finally {
        window.A11y = original;
    }
});
