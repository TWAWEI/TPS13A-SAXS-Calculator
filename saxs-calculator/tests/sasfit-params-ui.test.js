'use strict';
/**
 * sasfit-params-ui.js 的 stub-DOM 測試（M3 計畫 Task 12）：模型選單與搜尋、S(Q)、參數表的就地更新、
 * PD 列、SLD 面板、預覽排程（debounce、latest-wins、計算中、暫停、非有限點、錯誤路由）。
 * 假的 Worker client 與可手動推進的計時器見 tests/sasfit-ui-helpers.js。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');

const Html = globalThis.SasFitHtml;
const Form = globalThis.SasFitForm;
const Jobs = globalThis.SasFitJobs;
const Hints = globalThis.SasFitHints;
const Sld = globalThis.SasFitSld;
const MODULES = ['SasFitDataUi', 'SasFitParamsUi'];
const OFFICIAL = 'SYNTH_sphere_10.dat';

after(ui.restoreGlobals);

const boot = (options) => ui.boot({ modules: MODULES, ...options });
const lastView = (page) => page.plots.views[page.plots.views.length - 1];
const field = (page, name, key) => page.$(Html.paramFieldId(name, key));
const fieldError = (page, name, key) => page.$(Html.paramErrorId(name, key));

function type(page, name, key, value) {
    const input = field(page, name, key);
    input.value = value;
    input.fire('input');
    return input;
}

function choose(page, id, value) {
    const select = page.$(id);
    select.value = value;
    select.fire('change');
}

async function load(page, names = [OFFICIAL]) {
    const input = page.$('sfFileInput');
    input.files = names.map(ui.fixtureFile);
    input.fire('change');
    await ui.flush();
    await ui.flush();
}

/** 讓目前排定的預覽送出並以 values 回應；回傳該次請求。 */
async function answer(page, make = (q) => Float64Array.from(q, (x) => 1 / x)) {
    page.timers.advance(150);
    const call = page.client.evaluations[page.client.evaluations.length - 1];
    call.resolve({ I: make(call.request.q), extras: {} });
    await ui.flush();
    return call.request;
}

function codedError(code, message, detail) {
    return Object.assign(new Error(message), { code, detail });
}

// ---------------------------------------------------------------- 啟動
test('[sasfit-params-ui] 模組頂層不碰 document；create 回傳 render 與三個預覽方法', () => {
    const saved = global.document;
    delete global.document;
    try {
        assert.doesNotThrow(() => ui.loadModule('sasfit-params-ui.js'));
    } finally {
        global.document = saved;
    }
    assert.ok(Object.isFrozen(globalThis.SasFitParamsUi));
});

test('[sasfit-params-ui] 啟動：模型選單兩個 optgroup 共 13 項、選中 sphere；參數表與模型說明來自 SasFitHtml', () => {
    const page = boot();
    const select = page.$('sfModel');
    assert.equal(select.querySelectorAll('optgroup').length, 2);
    assert.equal(select.querySelectorAll('option').length, 13);
    assert.equal(select.value, 'sphere');
    const form = page.Section.getForm();
    const ctx = { fitResult: null, matches: false, locked: false };
    assert.equal(page.$('sfParamHead').innerHTML, Html.paramTableHeadHtml(ctx));
    assert.equal(page.$('sfParamBody').innerHTML, Html.paramTableHtml(Form.rows(form), ctx));
    assert.equal(page.$('sfModelInfo').innerHTML, Html.modelInfoHtml(globalThis.SasFitMeta.models.sphere));
    assert.match(page.$('sfModelInfo').innerHTML, /href="https:\/\/www\.sasview\.org\/docs\/user\/models\/sphere\.html"/);
    assert.equal(page.$('sfSldPanel').hidden === true || page.$('sfSldPanel').innerHTML === '', true);
});

// ---------------------------------------------------------------- 搜尋與換模型
test('[sasfit-params-ui] 搜尋：選單只剩符合者加上目前的模型，value 不變、表單不變、沒有送預覽；change 才換表單', async () => {
    const page = boot();
    await answer(page);
    const form = page.Section.getForm();
    const sent = page.client.evaluations.length;
    const search = page.$('sfModelSearch');
    search.value = 'cyl';
    search.fire('input');
    const names = page.$('sfModel').querySelectorAll('option').map((o) => o.value);
    assert.deepEqual(names, Form.models('cyl', 'sphere').flatMap((g) => g.items.map((i) => i.name)));
    assert.ok(names.includes('sphere') && names.includes('cylinder') && !names.includes('ellipsoid'));
    assert.equal(page.$('sfModel').value, 'sphere');
    assert.equal(page.Section.getForm(), form);
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, sent, '搜尋不送預覽');

    choose(page, 'sfModel', 'cylinder');
    assert.equal(page.Section.getForm().model, 'cylinder');
    assert.ok(field(page, 'length', 'value'), '參數表換成 cylinder 的列');
    assert.match(page.$('sfModelInfo').innerHTML, /cylinder\.html/);
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, sent + 1);
    assert.equal(page.client.evaluations[sent].request.modelSpec.model, 'cylinder');
});

// ---------------------------------------------------------------- S(Q) 與低 Q
test('[sasfit-params-ui] S(Q)：不可接的模型停用並說明；可接時顯示模式選單與 §4.4 的說明（一般模型與 vesicle）', () => {
    const page = boot();
    choose(page, 'sfModel', 'guinier');
    assert.equal(page.$('sfStructure').disabled, true);
    assert.match(page.$('sfStructureNote').textContent, /不能接結構因子/);
    assert.equal(page.$('sfStructureOptions').hidden, true);

    choose(page, 'sfModel', 'core_shell_sphere');
    assert.equal(page.$('sfStructure').disabled, false);
    assert.equal(page.$('sfStructureNote').hidden, true);
    choose(page, 'sfStructure', 'hardsphere');
    assert.equal(page.Section.getForm().structure, 'hardsphere');
    assert.equal(page.$('sfStructureOptions').hidden, false);
    const modes = page.$('sfRadiusMode').querySelectorAll('option');
    assert.deepEqual(modes.map((o) => o.value), ['0', '1', '2']);
    assert.match(modes[0].textContent, /^unconstrained/);
    assert.deepEqual(modes.slice(1).map((o) => o.textContent), globalThis.SasFitMeta.models.core_shell_sphere.reffModes);
    assert.equal(page.$('sfRadiusMode').value, '1');
    assert.equal(page.$('sfStructureNote').textContent, '接 S(Q) 時強度同時乘上 scale 與 volfraction；volfraction 也決定 S(Q) 的形狀。');

    choose(page, 'sfRadiusMode', '0');
    assert.equal(page.Section.getForm().radiusMode, 0);
    assert.equal(field(page, 'radius_effective', 'value').disabled, false, 'unconstrained 時 radius_effective 可輸入');
    choose(page, 'sfStructureMode', '1');
    assert.equal(page.Section.getForm().structureMode, 1);

    choose(page, 'sfModel', 'vesicle');
    assert.equal(page.Section.getForm().structure, 'hardsphere');
    assert.equal(page.$('sfStructureNote').textContent, '接 S(Q) 時使用模型本身的 volfraction。');
    choose(page, 'sfStructure', '');
    assert.equal(page.Section.getForm().structure, null);
    assert.equal(page.$('sfStructureOptions').hidden, true);
});

test('[sasfit-params-ui] hayter_msa：出現 §16 的提示，charge 的下限欄是 0.5（§5.7 第 10 點）；低 Q 冪律加兩列', () => {
    const page = boot();
    assert.equal(page.$('sfModelHints').innerHTML, '');
    choose(page, 'sfStructure', 'hayter_msa');
    assert.equal(page.$('sfModelHints').innerHTML, Html.hintsHtml(Hints.preFitHints({ modelSpec: Jobs.modelSpec(page.Section.getForm()) })));
    assert.match(page.$('sfModelHints').innerHTML, /hayter_msa 在低 q 可能出現不連續/);
    assert.equal(field(page, 'charge', 'lower').value, '0.5');

    const lowQ = page.$('sfLowQ');
    lowQ.checked = true;
    lowQ.fire('change');
    assert.equal(page.Section.getForm().lowQ, true);
    assert.ok(field(page, 'lowq_scale', 'value') && field(page, 'lowq_power', 'value'));
});

// ---------------------------------------------------------------- 預覽排程
test('[sasfit-params-ui] 啟動後排一次預覽（沒有資料時用 previewGrid）；回來的曲線以 view.preview 交給 plots', async () => {
    const page = boot();
    assert.equal(page.client.evaluations.length, 0);
    page.timers.advance(149);
    assert.equal(page.client.evaluations.length, 0, '150 ms 之前不送');
    page.timers.advance(1);
    assert.equal(page.client.evaluations.length, 1);
    const { request } = page.client.evaluations[0];
    const expected = Jobs.previewRequest(page.Section.getForm(), null);
    assert.deepEqual(Object.keys(request).sort(), ['modelSpec', 'opts', 'params', 'q']);
    assert.deepEqual(request.params, expected.params);
    assert.deepEqual(Array.from(request.q), Array.from(Jobs.previewGrid()));
    const I = Float64Array.from(request.q, (q) => 1 / q);
    page.client.evaluations[0].resolve({ I, extras: {} });
    await ui.flush();
    assert.equal(lastView(page).preview.q, request.q);
    assert.equal(lastView(page).preview.I, I);
    assert.equal(page.ctx.preview.last().I, I);
    assert.match(page.$('sfMainChart').getAttribute('aria-label'), /模型曲線預覽/);
});

test('[sasfit-params-ui] 150 ms 內連改三次只送一次，請求是最後的值；作用中資料存在時 q 來自資料', async () => {
    const page = boot();
    await load(page);
    await answer(page);
    const sent = page.client.evaluations.length;
    type(page, 'radius', 'value', '51');
    page.timers.advance(100);
    type(page, 'radius', 'value', '52');
    page.timers.advance(100);
    type(page, 'radius', 'value', '53');
    page.timers.advance(149);
    assert.equal(page.client.evaluations.length, sent);
    page.timers.advance(1);
    assert.equal(page.client.evaluations.length, sent + 1);
    const { request } = page.client.evaluations[sent];
    const dataset = page.Section.getState().files[0].dataset;
    const expected = Jobs.previewRequest(page.Section.getForm(), dataset);
    assert.equal(request.params.radius, 53);
    assert.deepEqual(request.params, expected.params);
    assert.deepEqual(Array.from(request.q), Array.from(expected.q));
    assert.deepEqual(request.opts, { cutoff: Jobs.CUTOFF });
});

test('[sasfit-params-ui] 送出後 300 ms 未回才顯示「計算中…」，朗讀區不變；回來後清除', async () => {
    const page = boot();
    page.timers.advance(150);
    page.timers.advance(299);
    assert.doesNotMatch(page.$('sfPlotStatus').textContent, /計算中/);
    page.timers.advance(1);
    assert.match(page.$('sfPlotStatus').textContent, /^計算中…/);
    assert.equal(page.$('sfPlotLive').textContent, '');
    assert.equal(page.ctx.preview.status().computing, true);
    const call = page.client.evaluations[0];
    call.resolve({ I: Float64Array.from(call.request.q, () => 1), extras: {} });
    await ui.flush();
    assert.doesNotMatch(page.$('sfPlotStatus').textContent, /計算中/);
    assert.equal(page.ctx.preview.status().computing, false);
});

test('[sasfit-params-ui] 被取代的請求以 SUPERSEDED reject：畫面不變、console.warn 沒被呼叫、較新的回應照常生效', async () => {
    const page = boot();
    page.timers.advance(150);
    type(page, 'radius', 'value', '60');
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, 2);
    const renders = page.plots.views.length;
    const warnings = await ui.captureConsole('warn', async () => {
        page.client.evaluations[0].reject(Object.assign(new Error('已被較新的請求取代'), { code: 'SUPERSEDED', superseded: true }));
        await ui.flush();
    });
    assert.deepEqual(warnings, []);
    assert.equal(page.plots.views.length, renders, '沒有重繪');
    assert.equal(page.$('sfAlert').innerHTML, '');
    assert.equal(page.ctx.preview.last(), null);
    const call = page.client.evaluations[1];
    call.resolve({ I: Float64Array.from(call.request.q, () => 2), extras: {} });
    await ui.flush();
    assert.equal(page.ctx.preview.last().q, call.request.q);
});

test('[sasfit-params-ui] 較舊的回應晚到（表單已再改）：不採用', async () => {
    const page = boot();
    page.timers.advance(150);
    type(page, 'radius', 'value', '70');
    const old = page.client.evaluations[0];
    old.resolve({ I: Float64Array.from(old.request.q, () => 9), extras: {} });
    await ui.flush();
    assert.equal(page.ctx.preview.last(), null, '舊表單的曲線不畫');
});

test('[sasfit-params-ui] 換作用中資料：以新資料重送預覽', async () => {
    const page = boot();
    await load(page, ['SYNTH_sphere_10.dat', 'generic-3col.csv']);
    await answer(page);
    const sent = page.client.evaluations.length;
    const [, second] = page.Section.getState().files;
    page.$(Html.fileControlId(second.id, 'active')).fire('change');
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, sent + 1);
    assert.deepEqual(Array.from(page.client.evaluations[sent].request.q), Array.from(Jobs.previewRequest(page.Section.getForm(), second.dataset).q));
});

test('[sasfit-params-ui] 頁面分頁不是顯示中的那一個：不排預覽、不建立 Worker；切過來（側欄 click）後才排', () => {
    const page = boot({ sectionActive: false });
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, 0);
    assert.equal(page.created.count, 0, '沒有建立 Worker client');
    page.document.fire('click');
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, 0, '還沒切過來');
    page.$('section-sasfit').classList.add('active');
    page.document.fire('click');
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, 1);
    assert.equal(page.created.count, 1);
});

// ---------------------------------------------------------------- 暫停與降點
function heavy(page, pds, model = 'cylinder') {
    choose(page, 'sfModel', model);
    pds.forEach((name) => {
        page.$('sfPdToggle_' + name).fire('click');
        type(page, name, 'pd.width', '0.1');
    });
}

test('[sasfit-params-ui] 降點：cylinder 兩個 35 點 PD 配官方檔的點數 → 狀態列「預覽以 N 點計算」，不暫停', async () => {
    const page = boot();
    await load(page, [OFFICIAL]);
    heavy(page, ['radius', 'length']);
    const dataset = page.Section.getState().files[0].dataset;
    const expected = Jobs.previewRequest(page.Section.getForm(), dataset);
    assert.deepEqual([expected.decimated, expected.paused], [true, false]);
    assert.equal(page.$('sfPreviewNow').hidden, true);
    const request = await answer(page);
    assert.equal(request.q.length, expected.q.length);
    assert.match(page.$('sfPlotStatus').textContent, new RegExp(`預覽以 ${expected.q.length} 點計算`));
    assert.equal(lastView(page).preview.q.length, expected.q.length);
});

test('[sasfit-params-ui] 暫停：不自動送出、狀態列說明、「更新曲線」出現；按下送一次；變回便宜後按鈕隱藏並恢復自動預覽', async () => {
    const page = boot();
    await answer(page);
    heavy(page, ['radius', 'thickness', 'length'], 'core_shell_cylinder');
    assert.equal(Jobs.previewRequest(page.Section.getForm(), null).paused, true);
    const sent = page.client.evaluations.length;
    page.timers.advance(2000);
    assert.equal(page.client.evaluations.length, sent, '暫停時不自動送出');
    assert.match(page.$('sfPlotStatus').textContent, /即時預覽已暫停/);
    assert.equal(page.$('sfPreviewNow').hidden, false);

    page.$('sfPreviewNow').fire('click');
    assert.equal(page.client.evaluations.length, sent + 1);
    const call = page.client.evaluations[sent];
    assert.deepEqual(call.request.params, Jobs.previewRequest(page.Section.getForm(), null).params);
    call.resolve({ I: Float64Array.from(call.request.q, () => 3), extras: {} });
    await ui.flush();
    assert.equal(page.ctx.preview.last().q, call.request.q);
    assert.equal(page.$('sfPreviewNow').hidden, false, '組態沒變：仍是暫停');

    type(page, 'length', 'pd.width', '0');
    type(page, 'thickness', 'pd.width', '0');
    assert.equal(page.$('sfPreviewNow').hidden, true);
    assert.doesNotMatch(page.$('sfPlotStatus').textContent, /已暫停/);
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, sent + 2, '恢復自動預覽');
});

// ---------------------------------------------------------------- 欄位錯誤與就地更新
test('[sasfit-params-ui] 不合法的輸入：aria-invalid、錯誤文字、不送預覽、原曲線保留；改回合法後清除並送預覽', async () => {
    const page = boot();
    await answer(page);
    const curve = page.ctx.preview.last();
    const sent = page.client.evaluations.length;
    const input = type(page, 'radius', 'value', 'abc');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(fieldError(page, 'radius', 'value').hidden, false);
    assert.equal(fieldError(page, 'radius', 'value').textContent, Form.validate(page.Section.getForm()).errors['radius.value']);
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, sent);
    assert.equal(page.ctx.preview.last(), curve);
    assert.equal(lastView(page).preview, curve);

    type(page, 'radius', 'value', '55');
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(fieldError(page, 'radius', 'value').hidden, true);
    assert.equal(fieldError(page, 'radius', 'value').textContent, '');
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, sent + 1);
});

test('[sasfit-params-ui] 打字不重建參數表（innerHTML 賦值次數不變）；跨欄位的錯誤也就地更新', () => {
    const page = boot();
    const body = page.$('sfParamBody');
    const sets = body.htmlSets;
    type(page, 'radius', 'value', '4');
    type(page, 'radius', 'value', '45');
    type(page, 'radius', 'lower', '10');
    type(page, 'radius', 'upper', '5');
    assert.equal(body.htmlSets, sets);
    assert.equal(field(page, 'radius', 'lower').getAttribute('aria-invalid'), 'true', '下限 ≥ 上限的錯誤標在下限欄');
    assert.match(fieldError(page, 'radius', 'lower').textContent, /下限必須小於上限/);
    type(page, 'radius', 'upper', '100');
    assert.equal(field(page, 'radius', 'lower').getAttribute('aria-invalid'), null);
    const fit = field(page, 'radius', 'fit');
    fit.checked = true;
    fit.fire('change');
    assert.equal(page.Section.getForm().fields.radius.fit, true);
    assert.equal(body.htmlSets, sets);
    page.ctx.refresh();
    assert.equal(body.htmlSets, sets, '重繪也不重建');
});

// ---------------------------------------------------------------- 預覽結果（決策 22）與錯誤
test('[sasfit-params-ui] 全部非有限：曲線不更新，狀態列「這組參數算不出模型曲線」；部分非有限：照畫並回報點數', async () => {
    const page = boot();
    await answer(page);
    const good = page.ctx.preview.last();
    type(page, 'radius', 'value', '61');
    await answer(page, (q) => Float64Array.from(q, () => NaN));
    assert.equal(page.ctx.preview.last(), good, '曲線不更新');
    assert.match(page.$('sfPlotStatus').textContent, /這組參數算不出模型曲線，請檢查數值/);

    type(page, 'radius', 'value', '62');
    const request = await answer(page, (q) => Float64Array.from(q, (x, i) => (i < 3 ? NaN : 1 / x)));
    assert.equal(page.ctx.preview.last().q, request.q);
    assert.match(page.$('sfPlotStatus').textContent, /模型曲線有 3 點無法計算/);
    assert.doesNotMatch(page.$('sfPlotStatus').textContent, /算不出模型曲線/);
});

test('[sasfit-params-ui] 預覽錯誤 BAD_PARAMS：狀態列顯示 message、console.warn 收到 detail；再改參數會再送；成功後清掉', async () => {
    const page = boot();
    page.timers.advance(150);
    const warnings = await ui.captureConsole('warn', async () => {
        page.client.evaluations[0].reject(codedError('BAD_PARAMS', '參數不合法', 'radius must be finite'));
        await ui.flush();
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /radius must be finite/);
    assert.match(page.$('sfPlotStatus').textContent, /參數不合法/);
    assert.equal(page.$('sfAlert').innerHTML, '');

    type(page, 'radius', 'value', '58');
    await answer(page);
    assert.equal(page.client.evaluations.length, 2, '錯誤之後不卡死');
    assert.doesNotMatch(page.$('sfPlotStatus').textContent, /參數不合法/);
});

test('[sasfit-params-ui] WASM_LOAD／WORKER_START_FAILED／WORKER_CRASH：sfAlert 顯示各自的文字與解法；下一次成功時清掉', async () => {
    for (const [code, message] of [['WASM_LOAD', '模型核心載入失敗'], ['WORKER_START_FAILED', '計算執行緒無法啟動'], ['WORKER_CRASH', '計算執行緒異常結束']]) {
        const page = boot();
        page.timers.advance(150);
        const err = codedError(code, message, 'ellipsoid: Failed to fetch');
        const warnings = await ui.captureConsole('warn', async () => {
            page.client.evaluations[0].reject(err);
            await ui.flush();
        });
        assert.equal(warnings.length, 1, code);
        assert.match(warnings[0], /ellipsoid: Failed to fetch/);
        const expected = Hints.errorNotice(err, 'preview');
        assert.equal(expected.where, 'page');
        assert.equal(page.$('sfAlert').innerHTML, Html.hintsHtml([{ id: 'page-error', tone: 'error', text: expected.text }]));
        assert.match(page.$('sfAlert').innerHTML, new RegExp(message));

        type(page, 'radius', 'value', '57');
        await answer(page);
        assert.equal(page.$('sfAlert').innerHTML, '', code + '：下一次成功時清掉');
    }
});

test('[sasfit-params-ui] 建立 Worker client 就丟例外：sfAlert 顯示一般錯誤，不丟到外面', async () => {
    const page = boot();
    Object.defineProperty(page.client, 'evaluate', { value() { throw new Error('boom'); } });
    const warnings = await ui.captureConsole('warn', () => { page.timers.advance(150); });
    assert.equal(warnings.length, 1);
    assert.match(page.$('sfAlert').innerHTML, /發生未預期的錯誤/);
});

// ---------------------------------------------------------------- PD
test('[sasfit-params-ui] PD：展開重建表格、aria-expanded、預設 gaussian／35／3；勾擬合寬度而寬度為 0 → 0.05；換 schulz → 80／3', () => {
    const page = boot();
    const body = page.$('sfParamBody');
    const sets = body.htmlSets;
    assert.equal(page.$('sfPdToggle_radius').getAttribute('aria-expanded'), 'false');
    page.$('sfPdToggle_radius').fire('click');
    assert.equal(body.htmlSets, sets + 1);
    assert.equal(page.$('sfPdToggle_radius').getAttribute('aria-expanded'), 'true');
    assert.equal(page.$('sfPdRow_radius').hidden, false);
    assert.equal(field(page, 'radius', 'pd.type').value, 'gaussian');
    assert.equal(field(page, 'radius', 'pd.npts').value, '35');
    assert.equal(field(page, 'radius', 'pd.nsigmas').value, '3');
    assert.equal(field(page, 'radius', 'pd.width').value, '0');

    const fit = field(page, 'radius', 'pd.fit');
    fit.checked = true;
    fit.fire('change');
    assert.equal(page.Section.getForm().pds.radius.width, '0.05');
    assert.equal(field(page, 'radius', 'pd.width').value, '0.05', '寬度欄就地變成 0.05（§5.7 第 12 點）');
    assert.equal(body.htmlSets, sets + 1);
    page.timers.advance(150);
    const { request } = page.client.evaluations[page.client.evaluations.length - 1];
    assert.equal(request.params.radius_pd, 0.05);
    assert.equal(request.params.radius_pd_n, 35);

    choose(page, Html.paramFieldId('radius', 'pd.type'), 'schulz');
    assert.equal(page.Section.getForm().pds.radius.type, 'schulz');
    assert.equal(field(page, 'radius', 'pd.npts').value, '80');
    assert.equal(field(page, 'radius', 'pd.nsigmas').value, '3');

    type(page, 'radius', 'pd.npts', '0');
    assert.equal(field(page, 'radius', 'pd.npts').getAttribute('aria-invalid'), 'true');
    assert.match(fieldError(page, 'radius', 'pd.npts').textContent, /PD 點數必須是/);

    page.$('sfPdToggle_radius').fire('click');
    assert.equal(page.$('sfPdToggle_radius').getAttribute('aria-expanded'), 'false');
    assert.equal(page.$('sfPdRow_radius').hidden, true);
});

// ---------------------------------------------------------------- SLD 面板
test('[sasfit-params-ui] SLD 面板：開啟、即時顯示元素組成、預設物質、錯誤時停用套用、套用與取消的焦點', () => {
    const page = boot();
    const panel = page.$('sfSldPanel');
    const button = page.$('sfSldBtn_sld');
    button.fire('click');
    assert.equal(panel.hidden, false);
    assert.equal(panel.innerHTML, Html.sldPanelHtml({ target: 'sld', formula: '', density: '', presetId: '', result: null, error: null }));
    assert.equal(page.$('sfSldApply').disabled, true);
    assert.equal(page.$('sfSldPreset').focusCount, 1, '焦點進到面板');

    const formula = page.$('sfSldFormula');
    const panelSets = panel.htmlSets;
    formula.value = 'H2O';
    formula.fire('input');
    assert.match(page.$('sfSldOutput').innerHTML, /H 2、O 1/);
    assert.equal(page.$('sfSldApply').disabled, true, '還沒有密度');
    assert.equal(panel.htmlSets, panelSets, '打字時不重建輸入框');

    formula.value = 'Xx2';
    formula.fire('input');
    assert.equal(formula.getAttribute('aria-invalid'), 'true');
    let expected;
    try { Sld.parseFormula('Xx2'); } catch (err) { expected = err.message; }
    assert.ok(page.$('sfSldOutput').innerHTML.includes(window.FormUtils.escapeHtml(expected)));
    assert.equal(page.$('sfSldApply').disabled, true);

    formula.value = '<b>';
    formula.fire('input');
    assert.doesNotMatch(page.$('sfSldOutput').innerHTML, /<b>/);

    const preset = Sld.PRESETS[0];
    const select = page.$('sfSldPreset');
    select.value = preset.id;
    select.fire('change');
    assert.equal(page.$('sfSldFormula').value, preset.formula);
    assert.equal(page.$('sfSldDensity').value, String(preset.density));
    // 選預設物質會重建整個面板（stub 的子元素沒有自己的 innerHTML，所以看面板的）
    assert.ok(panel.innerHTML.includes(window.FormUtils.escapeHtml('出處：' + preset.source)));
    assert.ok(panel.innerHTML.includes(window.FormUtils.escapeHtml('密度 ' + preset.density + ' g/cm³')));
    assert.match(panel.innerHTML, /SLD/);
    assert.equal(page.$('sfSldApply').disabled, false);

    const density = page.$('sfSldDensity');
    density.value = '-1';
    density.fire('input');
    assert.equal(density.getAttribute('aria-invalid'), 'true');
    assert.equal(page.$('sfSldApply').disabled, true);
    assert.equal(page.$('sfSldPreset').value, '', '手改後不再是預設物質');
    density.value = String(preset.density);
    density.fire('input');
    assert.equal(page.$('sfSldApply').disabled, false);

    const before = page.Section.getForm();
    page.$('sfSldCancel').fire('click');
    assert.equal(panel.hidden, true);
    assert.equal(page.Section.getForm(), before, '取消不改表單');
    assert.equal(page.$('sfSldBtn_sld').focusCount, 1, '焦點回到「化學式」按鈕');
});

test('[sasfit-params-ui] SLD 套用：數值欄填入 6 位有效數字的 SLD、面板關閉、焦點到數值欄、送預覽；Escape 等同取消', () => {
    const page = boot();
    page.timers.advance(150);
    const sent = page.client.evaluations.length;
    page.$('sfSldBtn_sld_solvent').fire('click');
    const formula = page.$('sfSldFormula');
    formula.value = 'H2O';
    formula.fire('input');
    const density = page.$('sfSldDensity');
    density.value = '0.997';
    density.fire('input');
    page.$('sfSldApply').fire('click');
    const expected = String(Number(Sld.compute('H2O', 0.997).sld.toPrecision(6)));
    assert.equal(page.Section.getForm().fields.sld_solvent.value, expected);
    assert.equal(field(page, 'sld_solvent', 'value').value, expected);
    assert.equal(page.$('sfSldPanel').hidden, true);
    assert.equal(field(page, 'sld_solvent', 'value').focusCount, 1);
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, sent + 1);
    assert.equal(page.client.evaluations[sent].request.params.sld_solvent, Number(expected));

    page.$('sfSldBtn_sld').fire('click');
    page.$('sfSldFormula').fire('keydown', { key: 'Escape' });
    assert.equal(page.$('sfSldPanel').hidden, true);
    assert.equal(page.$('sfSldBtn_sld').focusCount, 1);
});

test('[sasfit-params-ui] 換模型後目標參數不存在：SLD 面板自動關閉', () => {
    const page = boot();
    page.$('sfSldBtn_sld').fire('click');
    choose(page, 'sfModel', 'guinier');
    assert.equal(page.$('sfSldPanel').hidden, true);
    assert.equal(page.$('sfSldPanel').innerHTML, '');
});

// ---------------------------------------------------------------- 擬合進行中
test('[sasfit-params-ui] cancelPreview 取消尚未觸發的計時器；擬合進行中輸入全部停用、不送預覽；結束後補送', async () => {
    const page = boot();
    await load(page);
    await answer(page);
    const sent = page.client.evaluations.length;
    type(page, 'radius', 'value', '66');
    page.ctx.preview.cancel();
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, sent, '計時器已取消');

    page.ctx.dispatch({ type: 'fitStarted' });
    for (const id of ['sfModel', 'sfModelSearch', 'sfStructure', 'sfLowQ']) assert.equal(page.$(id).disabled, true, id);
    assert.equal(field(page, 'radius', 'value').disabled, true);
    assert.equal(field(page, 'radius', 'fit').disabled, true);
    assert.equal(page.$('sfPdToggle_radius').disabled, true);
    assert.equal(page.$('sfSldBtn_sld').disabled, true);
    page.ctx.preview.schedule();
    type(page, 'radius', 'value', '67');
    page.timers.advance(1000);
    assert.equal(page.client.evaluations.length, sent, '擬合進行中不送任何預覽');
    assert.equal(page.Section.getForm().fields.radius.value, '66', '擬合進行中的輸入不改表單');

    page.ctx.dispatch({ type: 'fitSettled', result: null });
    assert.equal(field(page, 'radius', 'value').disabled, false);
    page.timers.advance(150);
    assert.equal(page.client.evaluations.length, sent + 1, '被取消的那次預覽在擬合結束後補送');
    assert.equal(page.client.evaluations[sent].request.params.radius, 66);
});
