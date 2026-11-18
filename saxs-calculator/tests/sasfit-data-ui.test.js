'use strict';
/**
 * sasfit-data-ui.js 的 stub-DOM 測試（M3 計畫 Task 11）：依序讀檔、容量與大小上限、拖放、清單的事件委派、
 * Q 單位、圖模式與錯開、交給 plots 的 view、狀態列、系列色樣本、擬合進行中的停用。
 * stub DOM 與假相依見 tests/sasfit-ui-helpers.js；plots、readFile 都是注入的假物件。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const { ChartTheme } = require('./load.js');
const ui = require('./sasfit-ui-helpers.js');

const State = globalThis.SasFitState;
const Html = globalThis.SasFitHtml;
const MODULES = ['SasFitDataUi'];
const OFFICIAL = 'SYNTH_sphere_10.dat';

after(ui.restoreGlobals);

const boot = (options) => ui.boot({ modules: MODULES, ...options });
const lastView = (page) => page.plots.views[page.plots.views.length - 1];

/** 經由檔案輸入載入檔案並等它讀完。 */
async function load(page, files) {
    const input = page.$('sfFileInput');
    input.files = files;
    input.fire('change');
    await ui.flush();
    await ui.flush();
}

function genericText(n, scale = 1) {
    return Array.from({ length: n }, (_, i) => `${((i + 1) * 0.001 * scale).toFixed(6)} ${(100 / (i + 1)).toFixed(6)} 0.5`).join('\n');
}

const synthFit = (dataset, status = 'converged') => Object.freeze({
    status, chi2r: 1.04, iterations: 5, names: ['radius'], params: { radius: 50 },
    curve: Float64Array.from(dataset.I), residuals: Float64Array.from(dataset.q, () => 0.5),
    settings: { modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false }, weighting: 'sigma' },
});

// ---------------------------------------------------------------- 啟動
test('[sasfit-data-ui] 模組頂層不碰 document；create 回傳帶 render 的凍結物件', () => {
    const saved = global.document;
    delete global.document;
    try {
        assert.doesNotThrow(() => ui.loadModule('sasfit-data-ui.js'));
    } finally {
        global.document = saved;
    }
    assert.ok(Object.isFrozen(globalThis.SasFitDataUi));
    assert.equal(typeof globalThis.SasFitDataUi.create, 'function');
});

test('[sasfit-data-ui] 啟動後的空狀態：清單隱藏、空狀態文字、圖以空的 view 更新', () => {
    const page = boot();
    assert.equal(page.$('sfDataEmpty').hidden, false);
    assert.equal(page.$('sfDataEmpty').textContent, '尚未載入資料。');
    assert.equal(page.$('sfDataWrapper').hidden, true);
    assert.equal(page.plots.views.length, 1);
    assert.deepEqual(lastView(page).series, []);
    assert.equal(page.$('sfMainChart').getAttribute('aria-label'), '尚未載入資料');
    assert.equal(page.$('sfResidualChart').getAttribute('aria-label'), '尚無擬合結果');
});

// ---------------------------------------------------------------- 讀檔
test('[sasfit-data-ui] 選 3 個檔（官方、一般、壞檔）：依序讀取，三列，壞檔有原因，第一個成功的是作用中', async () => {
    const order = [];
    const gates = [];
    const readFile = (file) => new Promise((resolve) => { order.push('start:' + file.name); gates.push(() => { order.push('end:' + file.name); resolve(file.text); }); });
    const page = boot({ readFile });
    const input = page.$('sfFileInput');
    input.files = [ui.fixtureFile('empty.txt'), ui.fixtureFile(OFFICIAL), ui.fixtureFile('generic-3col.csv')];
    input.value = 'C:\\fakepath\\empty.txt';
    input.fire('change');
    assert.equal(input.value, '', '輸入框清空，才能重選同一個檔');
    await ui.flush();
    assert.deepEqual(order, ['start:empty.txt'], '前一個讀完才讀下一個');
    assert.equal(page.$('sfFileInput').disabled, true, '讀取中不能再選檔');
    assert.equal(page.$('sfDrop').getAttribute('aria-busy'), 'true');
    while (gates.length > 0) { gates.shift()(); await ui.flush(); }
    await ui.flush();
    assert.deepEqual(order, ['start:empty.txt', 'end:empty.txt', `start:${OFFICIAL}`, `end:${OFFICIAL}`, 'start:generic-3col.csv', 'end:generic-3col.csv']);

    const state = page.Section.getState();
    assert.equal(state.files.length, 3);
    assert.equal(state.files[0].dataset, null);
    assert.equal(state.activeId, state.files[1].id, '第一個成功的檔是作用中');
    const body = page.$('sfDataBody');
    assert.equal(body.querySelectorAll('tr').length, 3);
    assert.equal(body.querySelectorAll('.sf-file-row--failed').length, 1);
    assert.match(body.innerHTML, /檔案沒有可用的資料列|沒有/);
    assert.match(body.innerHTML, /無法載入/);
    assert.equal(page.$('sfDataEmpty').hidden, true);
    assert.equal(page.$('sfDataWrapper').hidden, false);
    assert.equal(page.$('sfFileInput').disabled, false);
    assert.equal(page.$('sfDrop').getAttribute('aria-busy'), 'false');
    assert.equal(lastView(page).series.length, 2);
});

test('[sasfit-data-ui] 清單的 HTML 就是 SasFitHtml.fileRowsHtml 的輸出（狀態「未擬合」、系列序號＝清單位置）', async () => {
    const page = boot();
    await load(page, [ui.fixtureFile(OFFICIAL), ui.fixtureFile('generic-bad.txt')]);
    const state = page.Section.getState();
    const [a, b] = state.files;
    const expected = Html.fileRowsHtml([
        { id: a.id, index: 0, fileName: a.fileName, hasData: true, shown: true, active: true, condition: 10, statusText: '未擬合', issues: a.issues, issueOverflow: 0, locked: false },
        { id: b.id, index: 1, fileName: b.fileName, hasData: true, shown: true, active: false, condition: b.condition, statusText: '未擬合', issues: b.issues, issueOverflow: 0, locked: false },
    ]);
    assert.equal(page.$('sfDataBody').innerHTML, expected);
    assert.match(page.$('sfDataBody').innerHTML, /第 \d+ 行：/, '解析不了的行列出行號');
});

test('[sasfit-data-ui] 檔案超過大小上限：不讀取，該列顯示大小與上限；其他檔照常', async () => {
    const page = boot();
    const big = ui.fileOf('big.dat', '', globalThis.SasFitDataIo.LIMITS.MAX_BYTES + 1024 * 1024);
    await load(page, [big, ui.fixtureFile(OFFICIAL)]);
    assert.deepEqual(page.reads, [OFFICIAL], '超過上限的檔沒有被讀');
    assert.match(page.$('sfDataBody').innerHTML, /檔案 6\.0 MB 超過上限 5 MB，未讀取/);
    assert.equal(page.Section.getState().files.length, 2);
    assert.equal(page.Section.getState().files[1].dataset.kind, 'official');
});

test('[sasfit-data-ui] 讀檔 reject：該列顯示「無法讀取」與原因（已跳脫），其他檔不受影響', async () => {
    const readFile = (file) => (file.name === 'bad.dat' ? Promise.reject(new Error('Failed <b>to</b> read')) : Promise.resolve(file.text));
    const page = boot({ readFile });
    const warnings = await ui.captureConsole('warn', () => load(page, [ui.fileOf('bad.dat', ''), ui.fixtureFile(OFFICIAL)]));
    assert.equal(warnings.length, 1);
    const html = page.$('sfDataBody').innerHTML;
    assert.match(html, /無法讀取：Failed &lt;b&gt;to&lt;\/b&gt; read/);
    assert.doesNotMatch(html, /<b>to<\/b>/);
    assert.equal(page.Section.getState().files[1].dataset.kind, 'official');
});

test('[sasfit-data-ui] 一次選的檔超過清單容量：只讀放得下的，sfDataAlert 說明略過幾個', async () => {
    const page = boot();
    const many = Array.from({ length: State.MAX_FILES + 3 }, (_, i) => ui.fileOf(`f${i}.txt`, '0.01 1 0.1\n0.02 2 0.1\n0.03 3 0.1'));
    await load(page, many);
    assert.equal(page.reads.length, State.MAX_FILES, '多出的檔沒有被讀');
    assert.equal(page.Section.getState().files.length, State.MAX_FILES);
    assert.equal(page.$('sfDataAlert').textContent, `清單最多 ${State.MAX_FILES} 個檔，已略過 3 個檔（未讀取）。`);
});

test('[sasfit-data-ui] 檔名含 HTML：innerHTML 沒有未跳脫的標記；canvas 的 aria-label 說明組數、模式與作用中', async () => {
    const page = boot();
    const evil = '<img src=x onerror=alert(1)>.dat';
    await load(page, [ui.fileOf(evil, ui.fixtureText(OFFICIAL))]);
    const html = page.$('sfDataBody').innerHTML;
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;\.dat/);
    assert.equal(page.$('sfMainChart').getAttribute('aria-label'), `1 組資料，模式 log-log，作用中：${evil}`);
});

// ---------------------------------------------------------------- 拖放
test('[sasfit-data-ui] 拖放：dragover 取消預設並加 is-dragover；dragleave 移除；drop 取 dataTransfer.files', async () => {
    const page = boot();
    const drop = page.$('sfDrop');
    const over = drop.fire('dragover');
    assert.equal(over.defaultPrevented, true);
    assert.equal(drop.classList.contains('is-dragover'), true);
    drop.fire('dragleave');
    assert.equal(drop.classList.contains('is-dragover'), false);
    drop.fire('dragover');
    const dropped = drop.fire('drop', { dataTransfer: { files: [ui.fixtureFile(OFFICIAL)] } });
    assert.equal(dropped.defaultPrevented, true);
    assert.equal(drop.classList.contains('is-dragover'), false);
    await ui.flush();
    await ui.flush();
    assert.equal(page.Section.getState().files.length, 1);
});

// ---------------------------------------------------------------- 清單操作
async function threeFiles(page) {
    await load(page, ['SYNTH_sphere_10.dat', 'SYNTH_sphere_20.dat', 'SYNTH_sphere_30.dat'].map(ui.fixtureFile));
    return page.Section.getState().files.map((f) => f.id);
}

test('[sasfit-data-ui] 清單：切換顯示、換作用中、移除——狀態與交給 plots 的 view 一致', async () => {
    const page = boot();
    const [a, b, c] = await threeFiles(page);
    assert.deepEqual(lastView(page).series.map((s) => [s.id, s.index, s.active]), [[a, 0, true], [b, 1, false], [c, 2, false]]);

    const show = page.$(Html.fileControlId(b, 'show'));
    show.checked = false;
    show.fire('change');
    assert.equal(page.Section.getState().shown[b], false);
    assert.deepEqual(lastView(page).series.map((s) => s.id), [a, c]);

    page.$(Html.fileControlId(c, 'active')).fire('change');
    assert.equal(page.Section.getState().activeId, c);
    assert.deepEqual(lastView(page).series.map((s) => [s.id, s.active]), [[a, false], [c, true]]);
    assert.equal(page.$('sfDataBody').querySelectorAll('.is-active').length, 1);

    page.$(Html.fileControlId(c, 'remove')).fire('click');
    const state = page.Section.getState();
    assert.deepEqual(state.files.map((f) => f.id), [a, b]);
    assert.equal(state.activeId, b, '移除作用中的檔後由前一個有資料的檔接手');
    assert.deepEqual(lastView(page).series.map((s) => [s.id, s.index, s.active]), [[a, 0, false], [b, 1, true]]);
    assert.equal(page.$('sfDataWrapper').focusCount, 1, '按鈕消失後焦點留在清單');
});

test('[sasfit-data-ui] 條件值：合法數字寫入狀態且不重建清單；非數字標 aria-invalid、不寫入；清空為 null', async () => {
    const page = boot();
    const [a] = await threeFiles(page);
    const body = page.$('sfDataBody');
    const sets = body.htmlSets;
    const input = page.$(Html.fileControlId(a, 'condition'));
    assert.equal(input.value, '10');
    input.value = '298.15';
    input.fire('input');
    assert.equal(page.Section.getState().files[0].condition, 298.15);
    assert.equal(input.getAttribute('aria-invalid'), null);
    input.value = '12abc';
    input.fire('input');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(page.Section.getState().files[0].condition, 298.15, '不合法的輸入不寫入狀態');
    input.value = '';
    input.fire('input');
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(page.Section.getState().files[0].condition, null);
    page.ctx.refresh();
    assert.equal(body.htmlSets, sets, '打條件值與之後的重繪都不重建清單（焦點不掉）');
});

test('[sasfit-data-ui] 重繪時清單沒有變化就不重設 innerHTML', async () => {
    const page = boot();
    await threeFiles(page);
    const body = page.$('sfDataBody');
    const sets = body.htmlSets;
    page.ctx.refresh();
    page.ctx.dispatch({ type: 'setPlotMode', mode: 'kratky' });
    assert.equal(body.htmlSets, sets);
});

// ---------------------------------------------------------------- Q 單位
test('[sasfit-data-ui] Q 單位：選 nm⁻¹ 後載入的一般檔 q 為 1/10；官方檔不受影響；已載入的檔不變', async () => {
    const page = boot();
    const text = genericText(20, 10);
    await load(page, [ui.fileOf('before.txt', text)]);
    page.$('sfQUnit').value = 'nm';
    await load(page, [ui.fileOf('after.txt', text), ui.fixtureFile(OFFICIAL)]);
    const [before, afterFile, official] = page.Section.getState().files;
    assert.equal(before.dataset.qUnit, 'A');
    assert.equal(afterFile.dataset.qUnit, 'nm');
    assert.ok(Math.abs(afterFile.dataset.q[0] - before.dataset.q[0] / 10) < 1e-15);
    const reference = globalThis.SasFitDataIo.parse(ui.fixtureText(OFFICIAL), { fileName: OFFICIAL, qUnit: 'A' }).dataset;
    assert.deepEqual(Array.from(official.dataset.q), Array.from(reference.q));
});

// ---------------------------------------------------------------- 圖模式、狀態列、錯開
test('[sasfit-data-ui] 圖模式三個按鈕：aria-pressed 只有一個為 true，view.mode 跟著變', async () => {
    const page = boot();
    await threeFiles(page);
    const pressed = () => ['sfModeLogLog', 'sfModeGuinier', 'sfModeKratky'].map((id) => page.$(id).getAttribute('aria-pressed'));
    assert.deepEqual(pressed(), ['true', 'false', 'false']);
    page.$('sfModeGuinier').fire('click');
    assert.deepEqual(pressed(), ['false', 'true', 'false']);
    assert.equal(page.$('sfModeGuinier').classList.contains('active'), true);
    assert.equal(page.$('sfModeLogLog').classList.contains('active'), false);
    assert.equal(lastView(page).mode, 'guinier');
    assert.match(page.$('sfMainChart').getAttribute('aria-label'), /模式 Guinier/);
    page.$('sfModeKratky').fire('click');
    assert.deepEqual(pressed(), ['false', 'false', 'true']);
    assert.equal(page.Section.getState().plotMode, 'kratky');
});

test('[sasfit-data-ui] 狀態列來自 SasFitHints.plotStatus：log-log 顯示各顯示中資料的隱藏點數總和', async () => {
    const page = boot();
    await threeFiles(page);
    const view = lastView(page);
    const { hidden } = globalThis.SasFitPlotData.viewStats(view);
    assert.ok(hidden > 0, '合成官方檔的 beamstop 列 I < 0');
    assert.equal(page.$('sfPlotStatus').textContent, globalThis.SasFitHints.plotStatus({ hidden, displayStride: 1 }).text);
    assert.match(page.$('sfPlotStatus').textContent, new RegExp(`隱藏了 ${hidden} 點`));
    assert.equal(page.$('sfPlotLive').textContent, page.$('sfPlotStatus').textContent);
});

test('[sasfit-data-ui] 12 000 點的檔：狀態列說明每 3 點顯示 1 點，狀態裡的 Dataset 仍是 12 000 點', async () => {
    const page = boot();
    await load(page, [ui.fileOf('long.txt', genericText(12000, 0.05))]);
    assert.match(page.$('sfPlotStatus').textContent, /每 3 點顯示 1 點（擬合仍使用全部點）/);
    assert.equal(page.Section.getState().files[0].dataset.q.length, 12000);
    assert.equal(lastView(page).series[0].data.q.length, 12000);
});

test('[sasfit-data-ui] 錯開：勾選與級距改變 view.stagger；Dataset 不變；級距不合法時標 aria-invalid、沿用舊值', async () => {
    const page = boot();
    await threeFiles(page);
    const before = page.Section.getState().files.map((f) => f.dataset);
    const box = page.$('sfStagger');
    const decades = page.$('sfStaggerDecades');
    decades.value = '1';
    box.checked = true;
    box.fire('change');
    assert.deepEqual(lastView(page).stagger, { on: true, decades: 1 });
    decades.value = '2.5';
    decades.fire('input');
    assert.deepEqual(lastView(page).stagger, { on: true, decades: 2.5 });
    decades.value = '-1';
    decades.fire('input');
    assert.equal(decades.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(page.Section.getState().stagger, { on: true, decades: 2.5 });
    page.Section.getState().files.forEach((f, i) => assert.equal(f.dataset, before[i]));
});

test('[sasfit-data-ui] 條件名稱寫入狀態；「重設縮放」交給 plots', async () => {
    const page = boot();
    const name = page.$('sfConditionName');
    name.value = 'Temperature (K)';
    name.fire('input');
    assert.equal(page.Section.getState().conditionName, 'Temperature (K)');
    page.$('sfResetZoom').fire('click');
    assert.equal(page.plots.resets, 1);
});

// ---------------------------------------------------------------- view 的組成
test('[sasfit-data-ui] view：series 來自 shownFiles；range 來自狀態；沒有結果時 preview／residuals／fitCurve 為 null', async () => {
    const page = boot();
    await threeFiles(page);
    const state = page.Section.getState();
    const view = lastView(page);
    assert.deepEqual(view.series.map((s) => s.id), State.shownFiles(state).map((f) => f.id));
    assert.equal(view.series[0].data, state.files[0].dataset);
    assert.equal(view.series[0].label, 'SYNTH_sphere_10.dat');
    assert.deepEqual(view.range, { qMin: state.range.qMin, qMax: state.range.qMax });
    assert.equal(view.preview, null);
    assert.equal(view.residuals, null);
    assert.ok(view.series.every((s) => s.fitCurve === null));
    assert.ok(Object.isFrozen(view));
});

test('[sasfit-data-ui] view：非作用中而有 FitResult 的檔帶 fitCurve；作用中的結果與表單不符時不畫它的曲線與殘差', async () => {
    const page = boot();
    const [a, b] = await threeFiles(page);
    const files = page.Section.getState().files;
    const fitOn = (id, result) => {
        page.ctx.dispatch({ type: 'setActive', id });
        page.ctx.dispatch({ type: 'fitStarted' });
        page.ctx.dispatch({ type: 'fitSettled', result });
    };
    fitOn(b, synthFit(files[1].dataset));
    fitOn(a, synthFit(files[0].dataset));          // radius 50 是 sphere 表單的預設值，但 params 不完整 → 與表單不符
    const view = lastView(page);
    const sb = view.series.find((s) => s.id === b);
    assert.equal(sb.fitCurve.q, files[1].dataset.q);
    assert.equal(sb.fitCurve.I, page.Section.getState().fitResults[b].curve);
    assert.equal(view.series.find((s) => s.id === a).fitCurve, null);
    assert.equal(view.residuals, null);
    assert.match(page.$('sfDataBody').innerHTML, /χ²ᵣ 1\.04・已收斂/);
});

test('[sasfit-data-ui] view：作用中的結果與表單相符時畫全解析度的 fitResult.curve 與殘差，不用預覽', async () => {
    const page = boot();
    const [a] = await threeFiles(page);
    const dataset = page.Section.getState().files[0].dataset;
    const form = page.Section.getForm();
    const result = Object.freeze({ ...synthFit(dataset), params: globalThis.SasFitJobs.params(form) });
    page.ctx.dispatch({ type: 'fitStarted' });
    page.ctx.dispatch({ type: 'fitSettled', result });
    const view = lastView(page);
    assert.equal(view.series.find((s) => s.id === a).fitCurve.I, result.curve);
    assert.equal(view.preview, null);
    assert.deepEqual(view.residuals, { q: dataset.q, r: result.residuals });
    assert.match(page.$('sfResidualChart').getAttribute('aria-label'), /SYNTH_sphere_10\.dat 的殘差，\d+ 點/);
});

// ---------------------------------------------------------------- 系列色樣本
test('[sasfit-data-ui] 系列色樣本：重建清單後依序號設 --chip-color；主題切換時重設', async () => {
    const page = boot();
    await threeFiles(page);
    const chips = () => page.$('sfDataBody').querySelectorAll('.sf-series-chip');
    const colours = () => chips().map((chip) => chip.style.getPropertyValue('--chip-color'));
    assert.equal(chips().length, 3);
    assert.deepEqual(colours(), [0, 1, 2].map((i) => ChartTheme.seriesColor(ChartTheme.PALETTES.light, i)));
    page.document.fire('tps:themechange', { theme: 'dark' });
    assert.deepEqual(colours(), [0, 1, 2].map((i) => ChartTheme.seriesColor(ChartTheme.PALETTES.dark, i)));
});

// ---------------------------------------------------------------- 擬合進行中
test('[sasfit-data-ui] 擬合進行中：檔案輸入、拖放、Q 單位、作用中、移除停用；顯示、圖模式、錯開仍可用', async () => {
    const page = boot();
    const [a, b] = await threeFiles(page);
    page.ctx.dispatch({ type: 'fitStarted' });
    assert.equal(page.$('sfFileInput').disabled, true);
    assert.equal(page.$('sfQUnit').disabled, true);
    assert.equal(page.$('sfDrop').getAttribute('aria-disabled'), 'true');
    assert.equal(page.$(Html.fileControlId(b, 'active')).disabled, true);
    assert.equal(page.$(Html.fileControlId(b, 'remove')).disabled, true);
    assert.equal(page.$(Html.fileControlId(b, 'show')).disabled, false);

    page.$('sfDrop').fire('drop', { dataTransfer: { files: [ui.fixtureFile(OFFICIAL)] } });
    await ui.flush();
    assert.equal(page.Section.getState().files.length, 3, '擬合中拖放的檔不加入');
    assert.match(page.$('sfDataAlert').textContent, /擬合進行中/);
    page.$(Html.fileControlId(b, 'remove')).fire('click');
    page.$(Html.fileControlId(b, 'active')).fire('change');
    assert.equal(page.Section.getState().files.length, 3);
    assert.equal(page.Section.getState().activeId, a);

    const show = page.$(Html.fileControlId(b, 'show'));
    show.checked = false;
    show.fire('change');
    assert.equal(page.Section.getState().shown[b], false);
    page.$('sfModeKratky').fire('click');
    assert.equal(page.Section.getState().plotMode, 'kratky');
    page.$('sfStagger').checked = true;
    page.$('sfStagger').fire('change');
    assert.equal(page.Section.getState().stagger.on, true);

    page.ctx.dispatch({ type: 'fitSettled', result: null });
    assert.equal(page.$('sfFileInput').disabled, false);
    assert.equal(page.$(Html.fileControlId(b, 'remove')).disabled, false);
});
