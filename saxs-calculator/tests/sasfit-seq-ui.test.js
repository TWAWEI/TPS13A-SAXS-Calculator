'use strict';
/**
 * sasfit-seq-ui.js（M4 計畫 Task 10、12）：序列分段的選檔表、選項、可否執行的說明；結果列、趨勢圖與點列載入。
 * 執行、停止與鎖定在 sasfit-seq-ui-run.test.js。stub DOM 見 tests/sasfit-ui-helpers.js。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const m4 = require('./sasfit-m4-helpers.js');

const F = globalThis.SasFitForm;
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-seq-ui.js'), 'utf8');
const genericEntry = (name, fixture) => ({
    fileName: name, issues: [], notes: {}, dataset: globalThis.SasFitDataIo.parse(ui.fixtureText(fixture), { fileName: name, qUnit: 'A' }).dataset,
});
const texts = (node) => [node.textContent].concat(node.descendants().map((child) => child.textContent)).join(' ');

afterEach(() => m4.restore());

// ---------------------------------------------------------------- 模組與分段
test('[seq-ui] 模組頂層不碰 document；不自己組 HTML、不做數字格式', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const top = SOURCE.split('\n').filter((line) => /^\S/.test(line) && !/^(\/\*\*| \*|\(function|\}\)\(\);)/.test(line));
    assert.deepEqual(top, [], 'IIFE 之外沒有程式');
    assert.doesNotMatch(code, /document\b/);
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML/);
    assert.doesNotMatch(code, /toFixed|toPrecision|toExponential/);
    assert.doesNotMatch(code, /['"`]<[a-z]/, '沒有 HTML 字串');
});

test('[seq-ui] 第四個分頁鈕可點；section 把序列模組建立一次；沒有序列時 running() false、barText() 空字串', () => {
    const page = m4.seqPage();
    page.$('sfTabSeq').fire('click');
    assert.equal(page.Section.getState().tab, 'sequence');
    assert.equal(page.$('sfPanelSeq').hidden, false);
    assert.equal(page.$('sfPanelFit').hidden, true);
    assert.equal(page.$('sfTabSeq').getAttribute('aria-selected'), 'true');
    assert.equal(page.ctx.sequence.running(), false);
    assert.equal(page.ctx.sequence.barText(), '');
});

// ---------------------------------------------------------------- 表格與空狀態
test('[seq-ui] 沒有資料：「請先載入資料」、表格隱藏、執行與全選鈕停用', () => {
    const page = m4.seqPage({ files: [] });
    assert.equal(page.$('sfSeqEmpty').hidden, false);
    assert.equal(page.$('sfSeqEmpty').textContent, '請先載入資料');
    assert.equal(page.$('sfSeqWrapper').hidden, true);
    assert.equal(page.$('sfSeqRun').disabled, true);
    assert.equal(page.$('sfSeqSettings').textContent, '請先載入資料');
    assert.equal(page.$('sfSeqAll').disabled, true);
    assert.equal(page.$('sfSeqNone').disabled, true);
    assert.equal(page.$('sfSeqLock').hidden, true);
});

test('[seq-ui] 有資料還沒跑：每個有資料的檔一列、都勾選、表頭只有固定欄；讀不出資料的檔不列', () => {
    const files = m4.seqEntries().concat([{ fileName: 'bad.txt', dataset: null, issues: [], notes: {} }]);
    const page = m4.seqPage({ files });
    assert.equal(page.$('sfSeqEmpty').hidden, true);
    assert.equal(page.$('sfSeqWrapper').hidden, false);
    assert.deepEqual(page.rowIds(), ['d1', 'd2', 'd3']);
    for (const id of ['d1', 'd2', 'd3']) {
        assert.equal(page.pick(id).checked, true, id);
        assert.equal(page.pick(id).disabled, false, id);
        assert.equal(page.load(id).disabled, true, id + '：還沒有結果可載入');
    }
    assert.equal(page.$('sfSeqHead').querySelectorAll('th').length, 5);
    assert.match(texts(page.body()), /尚未執行序列/);
    assert.equal(page.$('sfSeqAll').disabled, false);
});

test('[seq-ui] render 經 ctx.setHtml：沒有改變時不重建表格', () => {
    const page = m4.seqPage();
    const sets = page.body().htmlSets;
    const headSets = page.$('sfSeqHead').htmlSets;
    page.ctx.refresh();
    page.ctx.refresh();
    assert.equal(page.body().htmlSets, sets);
    assert.equal(page.$('sfSeqHead').htmlSets, headSets);
});

// ---------------------------------------------------------------- 勾選與選項
test('[seq-ui] 勾選（委派在 #sfSeqBody）→ setSeqSelected；重建後焦點仍在同一個勾選框', () => {
    const page = m4.seqPage();
    const box = page.pick('d2');
    box.focus();
    box.checked = false;
    box.fire('change');
    assert.equal(page.Section.getState().seq.selected.d2, false);
    assert.equal(page.pick('d2').checked, false);
    assert.equal(page.pick('d1').checked, true);
    assert.notEqual(page.pick('d2'), box, '表格已重建');
    assert.equal(page.document.activeElement, page.pick('d2'), '焦點靠 id 回到新的勾選框');
    page.pick('d2').checked = true;
    page.pick('d2').fire('change');
    assert.equal(page.Section.getState().seq.selected.d2, true);
});

test('[seq-ui] 全選／全不選 → setSeqAll；全不選時執行鈕停用並寫原因', () => {
    const page = m4.seqPage();
    page.$('sfSeqNone').fire('click');
    assert.deepEqual(page.Section.getState().seq.selected, { d1: false, d2: false, d3: false });
    assert.ok(['d1', 'd2', 'd3'].every((id) => page.pick(id).checked === false));
    assert.equal(page.$('sfSeqSettings').textContent, '請至少勾選一個要擬合的資料');
    assert.equal(page.$('sfSeqRun').disabled, true);
    page.$('sfSeqAll').fire('click');
    assert.deepEqual(page.Section.getState().seq.selected, { d1: true, d2: true, d3: true });
    assert.match(page.$('sfSeqSettings').textContent, /將擬合 3 個檔/);
});

test('[seq-ui] 兩個選項 → setSeqOption；checkbox 跟著狀態', () => {
    const page = m4.seqPage();
    assert.equal(page.$('sfSeqChain').checked, true);
    assert.equal(page.$('sfSeqSort').checked, true);
    page.$('sfSeqChain').checked = false;
    page.$('sfSeqChain').fire('change');
    assert.deepEqual(page.Section.getState().seq.options, { chain: false, sort: true });
    page.$('sfSeqSort').checked = false;
    page.$('sfSeqSort').fire('change');
    assert.deepEqual(page.Section.getState().seq.options, { chain: false, sort: false });
    page.ctx.dispatch({ type: 'setSeqOption', key: 'chain', value: true });
    assert.equal(page.$('sfSeqChain').checked, true);
    assert.equal(page.$('sfSeqSort').checked, false);
});

// ---------------------------------------------------------------- 可否執行
test('[seq-ui] 摘要：模型、各檔的預設範圍、權重、擬合哪些參數、最大步數、檔數；編輯過範圍時寫出範圍', () => {
    const page = m4.seqPage();
    const text = page.$('sfSeqSettings').textContent;
    assert.match(text, /模型 sphere/);
    assert.match(text, /各檔的預設範圍/);
    assert.match(text, /權重 資料 σ/);
    assert.match(text, /擬合 scale、background、radius/);
    assert.match(text, /最大步數 200/);
    assert.match(text, /將擬合 3 個檔$/);
    page.ctx.dispatch({ type: 'setRange', qMin: 0.01, qMax: 0.07 });
    assert.match(page.$('sfSeqSettings').textContent, /q 0\.01–0\.07 Å⁻¹（各檔截到自己的可用範圍）/);
});

test('[seq-ui] 表單無效或沒有勾選參數 → 寫 fitReadiness 的原因', () => {
    const page = m4.seqPage();
    page.ctx.setForm(F.reduce(page.ctx.getForm(), { type: 'setValue', name: 'radius', value: 'abc' }));
    page.ctx.refresh();
    assert.equal(page.$('sfSeqSettings').textContent, '參數表有不合法的欄位，請先修正。');
    const none = m4.seqPage({ ticks: [] });
    none.ctx.setForm(['scale', 'background'].reduce((form, name) => F.reduce(form, { type: 'setFit', name, fit: false }), none.ctx.getForm()));
    none.ctx.refresh();
    assert.equal(none.$('sfSeqSettings').textContent, '請至少勾選一個要擬合的參數。');
});

test('[seq-ui] 勾選的檔都會被跳過 → 「勾選的資料都無法擬合：原因」；部分會跳過 → 提示；只有一個檔也可執行', () => {
    const page = m4.seqPage();
    page.ctx.dispatch({ type: 'setRange', qMin: 5, qMax: 6 });
    assert.match(page.$('sfSeqSettings').textContent, /^勾選的資料都無法擬合：要求的擬合範圍內沒有可參與擬合的資料點$/);
    assert.equal(page.$('sfSeqHints').innerHTML, '');

    const mixed = m4.seqPage({ files: m4.seqEntries().concat([genericEntry('nosigma.txt', 'generic-2col.txt')]) });
    assert.match(mixed.$('sfSeqSettings').textContent, /將擬合 3 個檔，跳過 1 個$/);
    const hints = texts(mixed.$('sfSeqHints'));
    assert.match(hints, /1 個檔沒有條件值，排在最後：nosigma\.txt/);
    assert.match(hints, /1 個勾選的檔會被跳過：此資料沒有可用的誤差欄/);

    const one = m4.seqPage({ files: m4.seqEntries().slice(0, 1) });
    assert.match(one.$('sfSeqSettings').textContent, /將擬合 1 個檔$/);
});

test('[seq-ui] 單筆擬合進行中：鎖定提示顯示，勾選、選項、全選都停用，改不動選取', async () => {
    const page = m4.seqPage({ script: [{ wait: true }] });
    page.$('sfFitStart').fire('click');
    assert.equal(page.Section.getState().fit.phase, 'running');
    assert.equal(page.Section.getState().seq.phase, 'idle');
    assert.equal(page.$('sfSeqLock').hidden, false);
    assert.equal(page.$('sfSeqLock').textContent, globalThis.SasFitHints.LOCKED_TEXT);
    assert.ok(['d1', 'd2', 'd3'].every((id) => page.pick(id).disabled && page.load(id).disabled));
    assert.ok(['sfSeqChain', 'sfSeqSort', 'sfSeqAll', 'sfSeqNone', 'sfSeqRun'].every((id) => page.$(id).disabled), '控制項都停用');
    page.pick('d1').checked = false;
    page.pick('d1').fire('change');
    assert.equal(page.Section.getState().seq.selected.d1, undefined, '狀態沒被改');
    assert.equal(page.pick('d1').checked, true, '畫面回到狀態');
    assert.equal(page.ctx.sequence.running(), false);
    page.$('sfFitStop').fire('click');
    await ui.flush();
    assert.equal(page.Section.getState().fit.phase, 'idle');
    assert.equal(page.$('sfSeqLock').hidden, true);
    assert.equal(page.pick('d1').disabled, false);
});

// ================================================================ Task 12：結果列、趨勢圖、點列載入
const View = globalThis.SasFitSeqView;
const Jobs = globalThis.SasFitJobs;
const RADII = [{ values: { radius: 50.12 } }, { values: { radius: 52.07 } }, { values: { radius: 53.95 } }];
const lastTrend = (page) => page.plots.trends[page.plots.trends.length - 1];
/** 可比較的 config：函式（tooltip 的 callback）不比。 */
const plain = (config) => JSON.parse(JSON.stringify(config));
async function settle() {
    for (let i = 0; i < 4; i++) await ui.flush();
}
/** 跑完一次序列的頁面。 */
async function finished(options = {}) {
    const page = m4.seqPage({ script: RADII, ...options });
    page.$('sfTabSeq').fire('click');
    page.$('sfSeqRun').fire('click');
    await settle();
    assert.equal(page.Section.getState().seq.phase, 'idle');
    return page;
}

test('[seq-ui] 序列完成後表格三列有數字與狀態；表頭多了各擬合參數', async () => {
    const page = await finished();
    assert.equal(page.$('sfSeqHead').querySelectorAll('th').length, 8);
    const text = texts(page.body());
    for (const value of ['50.120', '52.070', '53.950']) assert.ok(text.includes(value), value);
    assert.equal(text.split('已收斂').length - 1, 3);
    assert.match(text, /初值來自 SYNTH_sphere_10\.dat/);
    assert.ok(['d1', 'd2', 'd3'].every((id) => page.load(id).disabled === false));
});

test('[seq-ui] 進行中表格每個節流週期最多重建一次，結束時一定重建；重建後焦點仍在原本的勾選框', async () => {
    const page = m4.seqPage({ script: [RADII[0], { wait: true, ...RADII[1] }, RADII[2]] });
    page.pick('d3').focus();
    page.$('sfSeqRun').fire('click');
    await settle();
    const sets = page.body().htmlSets;
    assert.doesNotMatch(texts(page.body()), /50\.120/, '第 1 筆完成了，但還沒到重繪的時間');
    page.timers.advance(250);
    assert.equal(page.body().htmlSets, sets + 1);
    assert.match(texts(page.body()), /50\.120/);
    assert.match(texts(page.body()), /擬合中/);
    page.timers.advance(2000);
    assert.equal(page.body().htmlSets, sets + 1);
    page.client.release();
    await settle();
    assert.equal(page.body().htmlSets, sets + 2);
    assert.match(texts(page.body()), /53\.950/);
});

test('[seq-ui] 重建表格後焦點留在同一個載入鈕或勾選框（靠 id）', async () => {
    const page = await finished();
    page.pick('d3').focus();
    page.ctx.dispatch({ type: 'setConditionName', name: '溫度' });
    assert.equal(page.document.activeElement, page.pick('d3'));
    page.load('d2').focus();
    page.ctx.dispatch({ type: 'setCondition', id: 'd1', value: 11 });
    assert.equal(page.document.activeElement, page.load('d2'));
});

// ---------------------------------------------------------------- 趨勢圖
test('[seq-ui] 趨勢圖：有點時顯示，renderTrend 收到 trendConfig，canvas 的 aria-label 是 trend.label；y 預設第一個選項', async () => {
    const page = await finished();
    const state = page.Section.getState();
    assert.equal(page.$('sfSeqTrendBox').hidden, false);
    const trend = View.trend(state, null);
    assert.deepEqual(plain(lastTrend(page)), plain(View.trendConfig(trend)));
    assert.equal(page.$('sfSeqTrend').getAttribute('aria-label'), trend.label);
    assert.deepEqual(page.$('sfSeqY').querySelectorAll('option').map((o) => [o.value, o.textContent]),
        [['scale', 'scale'], ['background', 'background'], ['radius', 'radius'], ['$measure', '約化 χ²']]);
    assert.equal(page.$('sfSeqY').value, 'scale');
    assert.equal(page.$('sfSeqTrendNote').textContent, '');
});

test('[seq-ui] 換 y → setSeqY＋重畫；沒有改變時不重畫', async () => {
    const page = await finished();
    const select = page.$('sfSeqY');
    select.value = 'radius';
    select.fire('change');
    assert.equal(page.Section.getState().seq.y, 'radius');
    assert.deepEqual(lastTrend(page).data.datasets[0].data.map((p) => p.y), [50.12, 52.07, 53.95]);
    assert.equal(lastTrend(page).options.scales.y.title.text, 'radius');
    assert.match(page.$('sfSeqTrend').getAttribute('aria-label'), /^radius 對 條件 的趨勢，3 點/);
    assert.equal(page.$('sfSeqY').value, 'radius');
    const drawn = page.plots.trends.length;
    page.ctx.refresh();
    page.ctx.dispatch({ type: 'setPlotMode', mode: 'kratky' });
    assert.equal(page.plots.trends.length, drawn);
    select.value = '$measure';
    select.fire('change');
    assert.equal(lastTrend(page).options.scales.y.title.text, '約化 χ²');
    assert.equal(page.plots.trends.length, drawn + 1);
});

test('[seq-ui] 趨勢圖的說明：有沒畫出的筆、沒有條件值時橫軸改用序號；沒有可畫的點 → 區塊隱藏、renderTrend(null)', async () => {
    const some = await finished({ script: [RADII[0], { reject: 'BAD_PARAMS' }, RADII[2]] });
    assert.match(some.$('sfSeqTrendNote').textContent, /^1 筆沒有畫出/);
    assert.equal(lastTrend(some).data.datasets[0].data.length, 2);

    const blank = m4.seqPage({ script: RADII });
    ['d1', 'd2', 'd3'].forEach((id) => blank.ctx.dispatch({ type: 'setCondition', id, value: null }));
    blank.$('sfSeqRun').fire('click');
    await settle();
    assert.match(blank.$('sfSeqTrendNote').textContent, /沒有條件值，橫軸改用序號/);
    assert.deepEqual(lastTrend(blank).data.datasets[0].data.map((p) => p.x), [1, 2, 3]);

    const none = m4.seqPage();
    assert.equal(none.$('sfSeqTrendBox').hidden, true);
    assert.equal(lastTrend(none), null);
    assert.equal(none.$('sfSeqTrend').getAttribute('aria-label'), '尚無可畫的結果');
    const failed = await finished({ script: [{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }] });
    assert.equal(failed.$('sfSeqTrendBox').hidden, true);
    assert.equal(lastTrend(failed), null);
});

test('[seq-ui] 趨勢圖在分段不在畫面上時照常更新；沒有 plots（Chart.js 被擋）時不丟例外', async () => {
    const page = m4.seqPage({ script: RADII });
    assert.equal(page.Section.getState().tab, 'data');
    page.$('sfSeqRun').fire('click');
    await settle();
    assert.equal(lastTrend(page).data.datasets[0].data.length, 3);
    const bare = m4.seqPage({ script: RADII, deps: { plots: { render: () => null, setZoomListener() {}, resetZoom() {} } } });
    bare.$('sfSeqRun').fire('click');
    await settle();
    assert.equal(bare.Section.getState().seq.outcome, 'finished');
    assert.equal(bare.$('sfSeqTrendBox').hidden, false);
});

// ---------------------------------------------------------------- 點列載入
test('[seq-ui] 點列載入：設為擬合對象、以序列開始時的表單為底載入、清掉還原點、重繪、排預覽、朗讀、焦點留在該鈕', async () => {
    const page = await finished();
    const snapshot = page.Section.getState().seq.form;
    const before = page.refreshes();
    page.load('d3').focus();
    page.load('d3').fire('click');
    const state = page.Section.getState();
    assert.equal(state.activeId, 'd3');
    const form = page.ctx.getForm();
    assert.equal(Number(form.fields.radius.value), 53.95);
    assert.deepEqual(form, Jobs.applyResult(snapshot, state.fitResults.d3));
    assert.equal(Jobs.resultMatchesForm(form, state.fitResults.d3), true);
    assert.equal(page.$('sfFitRevert').disabled, true);
    assert.ok(page.refreshes() > before);
    // 預覽重新規劃過：結果與表單相符，所以畫的是這筆結果自己的曲線，不必再算預覽
    page.timers.advance(500);
    assert.equal(page.client.evaluations.length, 0);
    const view = page.plots.views[page.plots.views.length - 1];
    assert.equal(view.series.find((series) => series.active).id, 'd3');
    assert.equal(view.series.find((series) => series.active).fitCurve.I, state.fitResults.d3.curve);
    assert.equal(view.preview, null);
    assert.equal(page.$('sfSeqLive').textContent, '已載入 SYNTH_sphere_30.dat 的擬合參數（模型與上下限回到序列開始時的設定）');
    assert.equal(page.document.activeElement, page.load('d3'));
    // 擬合分段與擬合列顯示的就是這一筆
    assert.match(page.$('sfFitResults').innerHTML, /SYNTH_sphere_30\.dat/);
    assert.doesNotMatch(page.$('sfFitMeasure').innerHTML, /參數已改動/);
    assert.match(page.$('sfFitMeasure').innerHTML, /sf-fitbar-value/);
    // 3D 用的是這組尺寸
    assert.equal(globalThis.SasFitShapeView.shapeParams(form).radius, 53.95);
});

test('[seq-ui] 點列載入以快照為底：之後改過上下限、勾選或換過模型，載入後都回到序列開始時的設定', async () => {
    const page = await finished();
    const snapshot = page.Section.getState().seq.form;
    let form = F.reduce(page.ctx.getForm(), { type: 'setUpper', name: 'radius', value: '60' });
    form = F.reduce(form, { type: 'setFit', name: 'scale', fit: false });
    page.ctx.setForm(F.reduce(form, { type: 'setModel', model: 'cylinder' }));
    page.ctx.refresh();
    assert.equal(page.load('d2').disabled, false, '換過模型仍可載入：底是快照，不是目前的表單');
    page.load('d2').fire('click');
    const loaded = page.ctx.getForm();
    assert.equal(loaded.model, 'sphere');
    assert.equal(loaded.fields.radius.upper, snapshot.fields.radius.upper);
    assert.equal(loaded.fields.scale.fit, true);
    assert.equal(Number(loaded.fields.radius.value), 52.07);
    assert.equal(Jobs.resultMatchesForm(loaded, page.Section.getState().fitResults.d2), true);
});

test('[seq-ui] 點列載入：結果對不上快照（另一個模型、或固定參數不同）→ 表單不變並說明', async () => {
    const page = await finished();
    const state = page.Section.getState();
    const other = m4.fakeResult({ values: { radius: 61.5 }, settings: { ...state.fitResults.d2.settings, modelSpec: { model: 'cylinder', structure: null, lowQPowerLaw: false } } });
    page.ctx.dispatch({ type: 'setActive', id: 'd2' });
    page.ctx.dispatch({ type: 'fitStarted' });
    page.ctx.dispatch({ type: 'fitSettled', result: other });
    assert.equal(page.load('d2').disabled, true, '另一個模型的結果：不能載入');
    const before = page.ctx.getForm();
    page.load('d2').fire('click');                             // 按鈕停用時瀏覽器不會送事件；這裡是第二道防線
    assert.equal(page.ctx.getForm(), before);
    assert.match(texts(page.$('sfSeqHints')), /無法載入/);
    assert.equal(page.Section.getState().activeId, 'd2');
});

test('[seq-ui] stale：序列後對其中一檔做單筆擬合 → 該列標「已單獨重新擬合」並顯示新數字，仍可載入', async () => {
    const page = await finished({ script: RADII.concat([{ values: { radius: 51.5 } }]) });
    page.ctx.dispatch({ type: 'setActive', id: 'd2' });
    page.$('sfFitStart').fire('click');
    await settle();
    assert.equal(page.Section.getState().fitResults.d2.params.radius, 51.5);
    const rows = page.body().querySelectorAll('tr');
    const row = rows.find((tr) => tr.dataset.id === 'd2');
    assert.match(texts(row), /已單獨重新擬合/);
    assert.match(texts(row), /51\.500/);
    assert.doesNotMatch(texts(rows.find((tr) => tr.dataset.id === 'd1')), /已單獨重新擬合/);
    assert.equal(page.load('d2').disabled, false);
    assert.deepEqual(lastTrend(page).data.datasets[0].data.map((p) => p.y).length, 3);
});

test('[seq-ui] 移除一個檔 → 它的列消失、趨勢圖少一點；復原 → 連同結果回來', async () => {
    const page = await finished();
    page.$('sfSeqY').value = 'radius';
    page.$('sfSeqY').fire('change');
    page.ctx.dispatch({ type: 'removeFile', id: 'd2' });
    assert.deepEqual(page.rowIds(), ['d1', 'd3']);
    assert.deepEqual(lastTrend(page).data.datasets[0].data.map((p) => p.y), [50.12, 53.95]);
    page.ctx.dispatch({ type: 'undoRemove' });
    assert.deepEqual(page.rowIds(), ['d1', 'd2', 'd3']);
    assert.match(texts(page.body()), /52\.070/);
    assert.deepEqual(lastTrend(page).data.datasets[0].data.map((p) => p.y), [50.12, 52.07, 53.95]);
    assert.equal(page.load('d2').disabled, false);
});

test('[seq-ui] 單筆擬合或序列進行中：載入鈕停用，點了也不動表單', async () => {
    const page = await finished({ script: RADII.concat([{ wait: true }]) });
    page.$('sfFitStart').fire('click');
    assert.ok(['d1', 'd2', 'd3'].every((id) => page.load(id).disabled && page.pick(id).disabled));
    const form = page.ctx.getForm();
    page.load('d3').fire('click');
    assert.equal(page.ctx.getForm(), form);
    assert.equal(page.Section.getState().activeId, 'd1');
    page.$('sfFitStop').fire('click');
    await settle();
    assert.equal(page.load('d3').disabled, false);
});
