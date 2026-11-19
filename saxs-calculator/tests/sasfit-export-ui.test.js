'use strict';
/**
 * sasfit-export-ui.js（M4 Task 15、17）：匯出按鈕、下載、各圖 PNG、送進 IUCr 表格。stub DOM（tests/sasfit-ui-helpers.js）。
 *
 * deps.download 記錄 (Blob, 檔名)；deps.now 固定；deps.version 固定（Node 裡 SasFitWorkerClient.scriptVersion 是 null）。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitExport, SasFitReport, SasFitJobs, SasFitForm, SasFitIucr } = require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const m4 = require('./sasfit-m4-helpers.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-export-ui.js'), 'utf8');
const NOW = Date.UTC(2026, 10, 19, 8, 0, 0);
const AT = '2026-11-19T08:00:00.000Z';
const SOFTWARE = SasFitExport.software('9.9');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const MODULES = ['SasFitDataUi', 'SasFitParamsUi', 'SasFitFitUi', 'SasFitSeqUi', 'SasFitExportUi'];
const realTheme = window.ChartTheme;

/** 一份啟動好的頁面：三個合成檔、sphere、radius 勾選；download／now／version／sendIucr 都是假的。 */
function page({ deps = {}, charts = {} } = {}) {
    const downloads = [];
    const sent = [];
    const exported = [];
    const shapeBlobs = { next: null, calls: 0 };
    window.ChartTheme = Object.freeze({ ...realTheme, exportPng(chart) { exported.push(chart); return PNG_URL; } });
    const realShape = globalThis.SasFitShape3d;
    globalThis.SasFitShape3d = Object.freeze({
        ...realShape, create: () => ({ render() {}, exportBlob() { shapeBlobs.calls += 1; return Promise.resolve(shapeBlobs.next); } }),
    });
    let booted;
    try {
        booted = ui.boot({
            modules: MODULES,
            deps: {
                download: (blob, name) => { downloads.push({ blob, name }); }, now: () => NOW, version: () => '9.9',
                sendIucr: (data) => { sent.push(data); }, ...deps,
            },
        });
    } finally {
        globalThis.SasFitShape3d = realShape;
    }
    booted.plots.getChart = (id) => (Object.hasOwn(charts, id) ? charts[id] : null);
    booted.ctx.dispatch({ type: 'addFiles', files: m4.seqEntries() });
    booted.ctx.setForm(SasFitForm.reduce(booted.ctx.getForm(), { type: 'setFit', name: 'radius', fit: true }));
    booted.ctx.refresh();
    const { ctx, $ } = booted;
    /** 讓擬合對象有一筆結果，並（預設）寫回表單，結果因此與表單相符。 */
    const fit = ({ apply = true, ...options } = {}) => {
        const state = ctx.getState();
        const file = state.files.find((f) => f.id === state.activeId);
        const job = SasFitJobs.fitJob(ctx.getForm(), file.dataset, { range: state.range, weighting: state.weighting, maxSteps: state.maxSteps });
        const result = m4.fakeResult({ job, values: { radius: 50.12 }, ...options });
        ctx.dispatch({ type: 'fitStarted' });
        ctx.dispatch({ type: 'fitSettled', result });
        if (apply && result.status !== 'stopped') ctx.setForm(SasFitJobs.applyResult(ctx.getForm(), result));
        ctx.refresh();
        return { file, result };
    };
    return { ...booted, downloads, sent, exported, shapeBlobs, fit, note: () => $('sfExportNote').textContent };
}

const restore = () => { window.ChartTheme = realTheme; ui.restoreGlobals(); };
const textOf = (blob) => blob.text();
const bytesOf = async (blob) => [...new Uint8Array(await blob.arrayBuffer())];

test.afterEach(restore);

// ---------------------------------------------------------------- 可用性
test('[sasfit-export-ui] 沒有結果時 CSV／TXT 停用並說明；有結果後啟用', () => {
    const p = page();
    assert.equal(p.$('sfExportCsv').disabled, true);
    assert.equal(p.$('sfExportTxt').disabled, true);
    assert.equal(p.note(), '尚無擬合結果可匯出');
    p.fit();
    assert.equal(p.$('sfExportCsv').disabled, false);
    assert.equal(p.$('sfExportTxt').disabled, false);
    assert.equal(p.note(), '');
});

test('[sasfit-export-ui] 沒有資料時說明是「請先載入資料」', () => {
    const p = page();
    p.ctx.getState().files.map((f) => f.id).forEach((id) => p.ctx.dispatch({ type: 'removeFile', id }));
    assert.equal(p.$('sfExportCsv').disabled, true);
    assert.equal(p.note(), '請先載入資料並完成擬合');
});

test('[sasfit-export-ui] 擬合進行中停用；結束後恢復', () => {
    const p = page();
    p.fit();
    p.ctx.dispatch({ type: 'fitStarted' });
    ['sfExportCsv', 'sfExportTxt', 'sfSeqCsv'].forEach((id) => assert.equal(p.$(id).disabled, true, id));
    assert.equal(p.note(), '擬合進行中，結束後才能匯出');
    p.ctx.dispatch({ type: 'fitSettled', result: null });
    assert.equal(p.$('sfExportCsv').disabled, false);
});

test('[sasfit-export-ui] 結果與表單不符仍可匯出，並註明匯出的是上一次擬合的結果', () => {
    const p = page();
    p.fit();
    p.ctx.setForm(SasFitForm.reduce(p.ctx.getForm(), { type: 'setValue', name: 'radius', value: '77' }));
    p.ctx.refresh();
    assert.equal(p.$('sfExportCsv').disabled, false);
    assert.equal(p.note(), '匯出的是上一次擬合的結果；之後改過的參數不在其中');
});

// ---------------------------------------------------------------- CSV 與 TXT
test('[sasfit-export-ui] CSV：BOM＋fitCsv、text/csv、檔名取自結果的模型規格', async () => {
    const p = page();
    const { file, result } = p.fit();
    p.$('sfExportCsv').fire('click');
    assert.equal(p.downloads.length, 1);
    const { blob, name } = p.downloads[0];
    assert.equal(blob.type, 'text/csv;charset=utf-8');
    assert.equal(name, 'SYNTH_sphere_10_sphere_fit.csv');
    assert.equal(name, SasFitExport.fileName('fit', { dataName: file.fileName, modelSpec: result.settings.modelSpec }));
    assert.equal(await textOf(blob), SasFitExport.fitCsv({ file, fitResult: result, software: SOFTWARE }));
    assert.deepEqual((await bytesOf(blob)).slice(0, 3), [0xEF, 0xBB, 0xBF]);        // BOM（Blob.text() 會吃掉它）
    assert.equal(p.note(), '已下載 SYNTH_sphere_10_sphere_fit.csv');
});

test('[sasfit-export-ui] TXT：BOM＋reportTxt、text/plain、時間來自 deps.now、上下限取自表單', async () => {
    const p = page();
    const { file, result } = p.fit();
    p.$('sfExportTxt').fire('click');
    const { blob, name } = p.downloads[0];
    assert.equal(blob.type, 'text/plain;charset=utf-8');
    assert.equal(name, 'SYNTH_sphere_10_sphere_report.txt');
    const text = await textOf(blob);
    assert.deepEqual((await bytesOf(blob)).slice(0, 3), [0xEF, 0xBB, 0xBF]);
    const bounds = { scale: [0, Infinity], background: [-Infinity, Infinity], sld: [-Infinity, Infinity], sld_solvent: [-Infinity, Infinity], radius: [0, Infinity] };
    assert.equal(text, SasFitReport.reportTxt({ file, fitResult: result, bounds, software: SOFTWARE, generatedAt: AT, conditionName: '條件', matchesForm: true }));
    assert.ok(text.includes('Generated: ' + AT + '\r\n'));
    assert.ok(text.includes('上下限為匯出當時參數表的設定'));
    assert.ok(text.includes('Software: ' + SOFTWARE));
});

test('[sasfit-export-ui] 換過模型後匯出：檔名與內容仍是那次擬合的模型，上下限未記錄，不丟例外', async () => {
    const p = page();
    p.fit();
    p.ctx.setForm(SasFitForm.create('cylinder'));
    p.ctx.refresh();
    p.$('sfExportTxt').fire('click');
    p.$('sfExportCsv').fire('click');
    assert.equal(p.downloads.length, 2);
    assert.equal(p.downloads[0].name, 'SYNTH_sphere_10_sphere_report.txt');
    assert.equal(p.downloads[1].name, 'SYNTH_sphere_10_sphere_fit.csv');
    const text = await textOf(p.downloads[0].blob);
    assert.ok(text.includes('上下限未記錄（匯出時參數表的模型已與這次擬合不同）'));
    assert.ok(text.includes('Parameter table at export: changed since this fit'));
    assert.ok(text.includes('Model: sphere（均勻球）'));
});

test('[sasfit-export-ui] 版本是 null（沒有 ?v=）→ 不下載，訊息顯示在 sfExportNote，console.warn', async () => {
    const p = page({ deps: { version: () => null } });
    p.fit();
    const warnings = await ui.captureConsole('warn', () => { p.$('sfExportCsv').fire('click'); });
    assert.equal(p.downloads.length, 0);
    assert.match(p.note(), /匯出失敗/);
    assert.equal(warnings.length, 1);
    assert.equal(p.$('sfExportCsv').disabled, false);
});

test('[sasfit-export-ui] download 丟例外 → 訊息顯示在 sfExportNote，其他按鈕照常', async () => {
    const p = page({ deps: { download: () => { throw new Error('quota'); } } });
    p.fit();
    const warnings = await ui.captureConsole('warn', () => { p.$('sfExportTxt').fire('click'); });
    assert.match(p.note(), /匯出失敗/);
    assert.equal(warnings.length, 1);
    assert.equal(p.$('sfExportTxt').disabled, false);
});

// ---------------------------------------------------------------- 序列 CSV
test('[sasfit-export-ui] 序列 CSV：沒跑過序列或沒有完成的列時停用；有結果後 BOM＋sequenceCsv、檔名用條件名稱', async () => {
    const p = page();
    assert.equal(p.$('sfSeqCsv').disabled, true);
    assert.notEqual(p.$('sfSeqCsv').getAttribute('title'), null);
    const seq = m4.seqState({ conditionName: '濃度 (mg/mL)' });
    const state = p.ctx.getState();
    const form = p.ctx.getForm();
    const plan = globalThis.SasFitSequence.plan({ files: state.files, selected: state.seq.selected, options: state.seq.options, range: state.range, weighting: state.weighting, form });
    p.ctx.dispatch({ type: 'setConditionName', name: '濃度 (mg/mL)' });
    p.ctx.dispatch({ type: 'seqStarted', plan, form, settings: { weighting: state.weighting, maxSteps: state.maxSteps, rangeEdited: false } });
    assert.equal(p.$('sfSeqCsv').disabled, true, '進行中');
    const todo = plan.items.filter((item) => item.skip === null);
    todo.forEach((item, k) => {
        const dataset = state.files.find((f) => f.id === item.id).dataset;
        const job = SasFitJobs.fitJob(form, dataset, { range: item.range, weighting: state.weighting, maxSteps: state.maxSteps });
        const row = { id: item.id, state: 'done', result: m4.fakeResult({ job, values: { radius: 50 + 2 * k } }), range: item.range, note: '', startedFrom: null };
        p.ctx.dispatch({ type: 'seqStep', id: item.id, row, next: k + 1 < todo.length ? todo[k + 1].id : null });
    });
    p.ctx.dispatch({ type: 'seqSettled', outcome: 'finished' });
    assert.equal(p.$('sfSeqCsv').disabled, false);
    assert.equal(p.$('sfSeqCsv').getAttribute('title'), null);
    p.$('sfSeqCsv').fire('click');
    const { blob, name } = p.downloads[0];
    assert.equal(name, '濃度 (mg_mL)_sequence.csv');
    assert.equal(blob.type, 'text/csv;charset=utf-8');
    assert.equal(await textOf(blob), SasFitReport.sequenceCsv({ state: p.ctx.getState(), software: SOFTWARE }));
    assert.ok(seq.state.seq.order.length === 3);
});

// ---------------------------------------------------------------- PNG
test('[sasfit-export-ui] 主圖／殘差 PNG：ChartTheme.exportPng → dataUrlBytes → Blob image/png', async () => {
    const main = { id: 'main' };
    const residual = { id: 'residual' };
    const p = page({ charts: { sfMainChart: main, sfResidualChart: residual } });
    p.fit();
    p.$('sfMainPng').fire('click');
    p.$('sfResidualPng').fire('click');
    assert.deepEqual(p.exported, [main, residual]);
    assert.deepEqual(p.downloads.map((d) => d.name), ['SYNTH_sphere_10_sphere_main.png', 'SYNTH_sphere_10_sphere_residual.png']);
    for (const { blob } of p.downloads) {
        assert.equal(blob.type, 'image/png');
        assert.deepEqual(await bytesOf(blob), [...PNG]);
    }
});

test('[sasfit-export-ui] 沒有圖（getChart 回 null）→ 不下載，sfExportNote 顯示「尚無圖可匯出」', () => {
    const p = page();
    p.$('sfMainPng').fire('click');
    assert.equal(p.downloads.length, 0);
    assert.equal(p.note(), '尚無圖可匯出');
    assert.equal(p.exported.length, 0);
    assert.equal(p.$('hplcDndcResults'), null);
});

test('[sasfit-export-ui] 殘差圖收起來時殘差 PNG 停用；趨勢圖的框收起來時趨勢 PNG 停用', () => {
    const p = page({ charts: { sfSeqTrend: { id: 'trend' } } });
    p.$('sfResidualBox').hidden = true;
    p.$('sfSeqTrendBox').hidden = true;
    p.ctx.refresh();
    assert.equal(p.$('sfResidualPng').disabled, p.$('sfResidualBox').hidden);
    assert.equal(p.$('sfSeqTrendPng').disabled, p.$('sfSeqTrendBox').hidden);
    assert.equal(p.$('sfMainPng').disabled, false);
});

test('[sasfit-export-ui] 趨勢圖 PNG：getChart(sfSeqTrend)，檔名用條件名稱', async () => {
    const trend = { id: 'trend' };
    const p = page({ charts: { sfSeqTrend: trend } });
    p.$('sfSeqTrendBox').hidden = false;
    p.ctx.refresh();
    p.$('sfSeqTrendPng').disabled = false;
    p.$('sfSeqTrendPng').fire('click');
    assert.deepEqual(p.exported, [trend]);
    assert.equal(p.downloads[0].name, '條件_trend.png');
    assert.deepEqual(await bytesOf(p.downloads[0].blob), [...PNG]);
});

test('[sasfit-export-ui] 3D PNG：曲線檢視或模型無形狀時停用；結構檢視時用 3D 分段的 exportBlob', async () => {
    const p = page();
    assert.equal(p.$('sfShapePng').disabled, true);
    p.ctx.dispatch({ type: 'setPlotView', view: 'shape' });
    assert.equal(p.$('sfShapePng').disabled, false);
    const blob = new Blob([PNG], { type: 'image/png' });
    p.shapeBlobs.next = blob;
    p.$('sfShapePng').fire('click');
    await ui.flush();
    assert.equal(p.shapeBlobs.calls, 1);
    assert.equal(p.downloads[0].blob, blob);
    assert.equal(p.downloads[0].name, 'SYNTH_sphere_10_sphere_shape.png');
    p.shapeBlobs.next = null;
    p.$('sfShapePng').fire('click');
    await ui.flush();
    assert.equal(p.downloads.length, 1);
    assert.equal(p.note(), '尚無圖可匯出');
    p.ctx.setForm(SasFitForm.create('guinier'));
    p.ctx.refresh();
    assert.equal(p.$('sfShapePng').disabled, true);
});

test('[sasfit-export-ui] 原始碼：沒有 fetch、不碰 hplcDndcResults、頂層不碰 document、沒有 innerHTML', () => {
    assert.doesNotMatch(SOURCE, /\bfetch\s*\(/);
    assert.doesNotMatch(SOURCE, /hplcDndcResults/);
    assert.doesNotMatch(SOURCE, /innerHTML/);
    const sandbox = { globalThis: {} };
    assert.doesNotThrow(() => new Function('globalThis', 'window', 'document', SOURCE)(sandbox.globalThis, undefined, undefined));
    assert.equal(typeof sandbox.globalThis.SasFitExportUi.create, 'function');
});

// ---------------------------------------------------------------- 預設的 download
function downloadEnv({ createThrows = false } = {}) {
    const env = { created: [], revoked: [], appended: [], removed: [], timers: [], clicks: 0 };
    const link = {
        attrs: {}, hidden: false,
        setAttribute(name, value) { link.attrs[name] = String(value); },
        click() { env.clicks += 1; },
        remove() { env.removed.push(link); },
    };
    env.link = link;
    global.document = {
        createElement(tag) { assert.equal(tag, 'a'); return link; },
        body: { appendChild(node) { env.appended.push(node); } },
    };
    window.URL = {
        createObjectURL(blob) { if (createThrows) throw new Error('no blob urls'); env.created.push(blob); return 'blob:http://x/1'; },
        revokeObjectURL(url) { env.revoked.push(url); },
    };
    env.setTimeout = (fn, ms) => { env.timers.push({ fn, ms }); return env.timers.length; };
    return env;
}

function withExportUi(fn) {
    ui.loadModule('sasfit-export-ui.js');
    const savedDocument = global.document;
    try {
        return fn(globalThis.SasFitExportUi);
    } finally {
        delete globalThis.SasFitExportUi;
        delete window.URL;
        if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
    }
}

test('[sasfit-export-ui] 預設的 download：<a download rel=noopener hidden>、blob: 網址、計時器裡移除並 revoke 恰好一次', () => {
    withExportUi((module) => {
        const env = downloadEnv();
        const blob = new Blob(['x']);
        module.download(blob, '樣品@1+2_fit.csv', { setTimeout: env.setTimeout });
        assert.deepEqual(env.created, [blob]);
        assert.equal(env.link.attrs.href, 'blob:http://x/1');
        assert.equal(env.link.attrs.download, '樣品@1+2_fit.csv');
        assert.equal(env.link.attrs.rel, 'noopener');
        assert.equal(env.link.hidden, true);
        assert.deepEqual(env.appended, [env.link]);
        assert.equal(env.clicks, 1);
        assert.deepEqual(env.revoked, [], '點擊當下還不能 revoke');
        assert.equal(env.timers.length, 1);
        env.timers[0].fn();
        assert.deepEqual(env.revoked, ['blob:http://x/1']);
        assert.deepEqual(env.removed, [env.link]);
    });
});

test('[sasfit-export-ui] 預設的 download：createObjectURL 丟例外 → 例外傳出、不留下節點', () => {
    withExportUi((module) => {
        const env = downloadEnv({ createThrows: true });
        assert.throws(() => module.download(new Blob(['x']), 'a.csv', { setTimeout: env.setTimeout }), /no blob urls/);
        assert.deepEqual(env.appended, []);
        assert.equal(env.clicks, 0);
        assert.equal(env.timers.length, 0);
    });
});

test('[sasfit-export-ui] 預設的 download：click 丟例外也會移除節點並 revoke', () => {
    withExportUi((module) => {
        const env = downloadEnv();
        env.link.click = () => { throw new Error('blocked'); };
        assert.throws(() => module.download(new Blob(['x']), 'a.csv', { setTimeout: env.setTimeout }), /blocked/);
        assert.deepEqual(env.removed, [env.link]);
        assert.deepEqual(env.revoked, ['blob:http://x/1']);
    });
});

// ---------------------------------------------------------------- 送進 IUCr 表格（Task 17）
const sendNote = (p) => p.$('sfSendIucrNote').textContent;

test('[sasfit-export-ui] 送進 IUCr：沒有結果、未收斂、參數改過、擬合進行中都停用並說明原因', () => {
    const p = page();
    assert.equal(p.$('sfSendIucr').disabled, true);
    assert.equal(sendNote(p), '尚未擬合');
    p.fit({ status: 'maxiter' });
    assert.equal(p.$('sfSendIucr').disabled, true);
    assert.equal(sendNote(p), '擬合未收斂，不能送進表格');
    p.fit();
    assert.equal(p.$('sfSendIucr').disabled, false);
    assert.equal(sendNote(p), '');
    p.ctx.setForm(SasFitForm.reduce(p.ctx.getForm(), { type: 'setValue', name: 'sld', value: '2' }));
    p.ctx.refresh();
    assert.equal(p.$('sfSendIucr').disabled, true);
    assert.equal(sendNote(p), '參數在擬合後改過；請重新擬合，或還原擬合前的參數');
    p.ctx.setForm(SasFitForm.reduce(p.ctx.getForm(), { type: 'setValue', name: 'sld', value: '1' }));
    p.ctx.dispatch({ type: 'fitStarted' });
    assert.equal(p.$('sfSendIucr').disabled, true);
    assert.equal(sendNote(p), '擬合進行中，結束後才能送出');
});

test('[sasfit-export-ui] 送進 IUCr：按下後把 SasFitIucr.data 的凍結物件交給 deps.sendIucr，說明已送出，焦點留在按鈕', () => {
    const p = page();
    const { file, result } = p.fit();
    p.$('sfSendIucr').fire('click');
    assert.equal(p.sent.length, 1);
    const data = p.sent[0];
    assert.ok(Object.isFrozen(data) && Object.isFrozen(data.params));
    assert.deepEqual(data, SasFitIucr.data({ fileName: file.fileName, fitResult: result, form: p.ctx.getForm(), version: '9.9', absolute: true }));
    assert.equal(data.datasetName, 'SYNTH_sphere_10.dat');
    assert.ok(data.software.endsWith('v9.9'));
    assert.equal(sendNote(p), '已送進 IUCr 表格（SYNTH_sphere_10.dat）；再次送出會取代它');
    assert.equal(p.$('sfSendIucr').focusCount, 1);
    p.ctx.refresh();
    assert.equal(sendNote(p), '已送進 IUCr 表格（SYNTH_sphere_10.dat）；再次送出會取代它', '重繪不洗掉訊息');
    // 再送一次：是另一個新物件
    p.$('sfSendIucr').fire('click');
    assert.equal(p.sent.length, 2);
    assert.notEqual(p.sent[1], p.sent[0]);
    assert.deepEqual(p.sent[1], p.sent[0]);
});

test('[sasfit-export-ui] 送出後又改了參數：不再送出，說明改回不能送的原因', () => {
    const p = page();
    p.fit();
    p.$('sfSendIucr').fire('click');
    p.ctx.setForm(SasFitForm.reduce(p.ctx.getForm(), { type: 'setValue', name: 'radius', value: '70' }));
    p.ctx.refresh();
    assert.equal(p.$('sfSendIucr').disabled, true);
    assert.equal(sendNote(p), '參數在擬合後改過；請重新擬合，或還原擬合前的參數');
    assert.equal(p.sent.length, 1);
});

test('[sasfit-export-ui] 送進 IUCr：sendIucr 或 data() 丟例外 → 訊息顯示在 sfSendIucrNote、console.warn，頁面其他部分照常', async () => {
    const p = page({ deps: { sendIucr: () => { throw new Error('table missing'); } } });
    p.fit();
    const warnings = await ui.captureConsole('warn', () => { p.$('sfSendIucr').fire('click'); });
    assert.match(sendNote(p), /送出失敗：table missing/);
    assert.equal(warnings.length, 1);
    assert.equal(p.$('sfExportCsv').disabled, false);
    const q = page({ deps: { version: () => null } });
    q.fit();
    const more = await ui.captureConsole('warn', () => { q.$('sfSendIucr').fire('click'); });
    assert.match(sendNote(q), /送出失敗/);
    assert.equal(q.sent.length, 0);
    assert.equal(more.length, 1);
});

test('[sasfit-export-ui] 預設的 sendIucr 是頁面的 setIUCrModelFit（頂層函式在瀏覽器裡是 window 的屬性）', () => {
    const received = [];
    window.setIUCrModelFit = (data) => { received.push(data); };
    try {
        const p = page({ deps: { sendIucr: undefined } });
        p.fit();
        p.$('sfSendIucr').fire('click');
        assert.equal(received.length, 1);
        assert.equal(received[0].model, 'sphere');
    } finally {
        delete window.setIUCrModelFit;
    }
});
