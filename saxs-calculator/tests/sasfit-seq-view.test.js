'use strict';
/**
 * sasfit-seq-view.js（M4 計畫 Task 9）：序列表（選檔＋結果）的列與 HTML、趨勢圖的資料與 config。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./load.js');
const ui = require('./sasfit-ui-helpers.js');
const { checkMarkup, textOf } = require('./sasfit-html-helpers.js');
const { seqState, loadedState, sphereForm, fakeResult } = require('./sasfit-m4-helpers.js');

const View = globalThis.SasFitSeqView;
const S = globalThis.SasFitState;
const F = globalThis.SasFitForm;
const Format = globalThis.SasFitFormat;
const Hints = globalThis.SasFitHints;
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-seq-view.js'), 'utf8');
const PAYLOADS = Object.freeze([
    '<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "'", '&', '" onmouseover="alert(1)" x="',
    "' onfocus='alert(1)' autofocus='", '</td></tr></table><svg onload=alert(1)>',
]);
const rowOf = (state, id) => View.tableRows(state).find((row) => row.id === id);
const generic = (name, fixture) => ({
    fileName: name, issues: [], notes: {}, dataset: globalThis.SasFitDataIo.parse(ui.fixtureText(fixture), { fileName: name, qUnit: 'A' }).dataset,
});

test('[sasfit-seq-view] 匯出凍結物件；原始碼不自己做數字格式、不寫死 χ²ᵣ', () => {
    assert.ok(Object.isFrozen(View));
    assert.equal(View.MEASURE_KEY, '$measure');
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /toFixed|toPrecision|toExponential/);
    assert.doesNotMatch(code, /χ²ᵣ|約化 χ²/);
    assert.doesNotMatch(code, /document\b/);
});

// ---------------------------------------------------------------- columns
test('[sasfit-seq-view] columns：名稱取第一筆有結果的列（擬合器順序）；量度依權重命名', () => {
    const open = F.reduce(F.reduce(sphereForm(), { type: 'togglePd', name: 'radius' }), { type: 'setPdFit', name: 'radius', fit: true });
    const done = View.columns(seqState({ form: open }).state);
    assert.deepEqual(done.names, ['scale', 'background', 'radius', 'radius_pd']);
    assert.deepEqual(done.measure, Hints.measure('sigma'));
    assert.equal(done.scaled, false);
    const none = View.columns(seqState({ weighting: 'none' }).state);
    assert.equal(none.measure.label, '加權殘差均方');
    assert.equal(none.scaled, true);
    const before = View.columns(loadedState({}));
    assert.deepEqual(before.names, []);
    assert.equal(before.measure.isChi2, true, '還沒跑過：取目前的權重');
    assert.equal(View.columns(loadedState({ weighting: 'none' })).scaled, true);
    const firstFailed = View.columns(seqState({ steps: [{ error: 'x' }, {}, {}] }).state);
    assert.deepEqual(firstFailed.names, ['scale', 'background', 'radius']);
});

// ---------------------------------------------------------------- tableRows
test('[sasfit-seq-view] tableRows：還沒跑過 → 每個有資料的檔一列、都勾選、數值「—」', () => {
    const base = loadedState({ files: [{ fileName: 'bad.txt', dataset: null, issues: [], notes: {} }].concat(seqState().state.files.map((f) => ({ ...f }))) });
    const rows = View.tableRows(base);
    assert.equal(rows.length, 3, '讀不出資料的檔不列');
    rows.forEach((row) => {
        assert.equal(row.selected, true);
        assert.equal(row.canLoad, false);
        assert.deepEqual(row.cells, []);
        assert.equal(row.measure, Format.MISSING);
        assert.equal(row.status.text, '尚未執行序列');
        assert.equal(row.stale, false);
    });
    assert.deepEqual(rows.map((row) => row.condition), ['10', '20', '30']);
    assert.equal(rowOf(S.reduce(base, { type: 'setSeqSelected', id: rows[1].id, selected: false }), rows[1].id).selected, false);
});

test('[sasfit-seq-view] tableRows：完成的列有 值 ± 顯示的誤差、量度、狀態、初值來源；順序是執行順序', () => {
    const { state } = seqState({ conditions: [30, 10, 20] });
    const rows = View.tableRows(state);
    assert.deepEqual(rows.map((row) => row.id), ['d2', 'd3', 'd1']);
    const first = rows[0];
    const result = state.fitResults.d2;
    const expected = Format.valueError(Format.inputValue(result.params.radius, result.errors.radius), result.errors.radius, { illConditioned: false });
    assert.deepEqual(first.cells[2], { value: expected.value, error: expected.error, mark: '' });
    assert.equal(first.measure, Format.display(Format.number(1.1, 3)));
    assert.equal(first.status.text, '已收斂');
    assert.equal(first.status.tone, 'ok');
    assert.equal(first.canLoad, true);
    assert.equal(first.note, '');
    assert.equal(rows[1].note, '初值來自 SYNTH_sphere_20.dat');
});

test('[sasfit-seq-view] tableRows：權重不是 σ 時顯示乘過的誤差；貼邊界只給標記', () => {
    const { state } = seqState({ weighting: 'none', steps: [{ values: { radius: 50.12 }, chi2r: 4 }, { values: { radius: 0 }, atBound: { radius: 'lower' } }, {}] });
    const [a, b] = View.tableRows(state);
    const r = state.fitResults.d1;
    assert.equal(r.errorsScaled.radius, r.errors.radius * 2);
    assert.equal(a.cells[2].error, Format.valueError(Format.inputValue(50.12, r.errorsScaled.radius), r.errorsScaled.radius).error);
    assert.deepEqual(b.cells[2], { value: '0', error: '', mark: Hints.AT_BOUND_SHORT.lower });
});

test('[sasfit-seq-view] tableRows：跳過、出錯、停在途中的列數值是「—」，狀態與註記說明原因', () => {
    const files = seqState().state.files.map((f) => ({ ...f })).concat([generic('nosigma.txt', 'generic-2col.txt')]);
    const { state } = seqState({ files, steps: [{}, { error: '模型參數不合法' }] });
    const rows = View.tableRows(state);
    const byName = Object.fromEntries(rows.map((row) => [row.fileName, row]));
    assert.equal(byName['SYNTH_sphere_20.dat'].status.text, '錯誤');
    assert.equal(byName['SYNTH_sphere_20.dat'].note, '模型參數不合法；初值來自 SYNTH_sphere_10.dat');
    assert.equal(byName['SYNTH_sphere_30.dat'].status.text, '未擬合');
    assert.equal(byName['nosigma.txt'].status.text, '已跳過');
    assert.match(byName['nosigma.txt'].note, /沒有可用的誤差欄/);
    ['SYNTH_sphere_20.dat', 'SYNTH_sphere_30.dat', 'nosigma.txt'].forEach((name) => {
        assert.ok(byName[name].cells.every((cell) => cell.value === Format.MISSING && cell.error === ''), name);
        assert.equal(byName[name].measure, Format.MISSING);
        assert.equal(byName[name].canLoad, false);
    });
    assert.equal(byName['nosigma.txt'].condition, '');
});

test('[sasfit-seq-view] tableRows：序列後被單筆擬合取代 → stale、顯示目前的數字；模型不同 → 數值「—」、不能載入', () => {
    const { state } = seqState();
    const again = fakeResult({ job: null, values: { scale: 1, background: 0.001, radius: 61.5 }, names: ['scale', 'background', 'radius'] });
    const replaced = Object.freeze({ ...state, fitResults: Object.freeze({ ...state.fitResults, d2: again }) });
    const row = rowOf(replaced, 'd2');
    assert.equal(row.stale, true);
    assert.match(row.cells[2].value, /^61\.5/);
    assert.equal(row.canLoad, true);
    assert.equal(rowOf(replaced, 'd1').stale, false);
    const other = fakeResult({ values: { radius: 61.5 }, settings: { ...again.settings, modelSpec: { model: 'cylinder', structure: null, lowQPowerLaw: false } } });
    const foreign = rowOf(Object.freeze({ ...state, fitResults: Object.freeze({ ...state.fitResults, d2: other }) }), 'd2');
    assert.equal(foreign.stale, true);
    assert.equal(foreign.canLoad, false);
    assert.ok(foreign.cells.every((cell) => cell.value === Format.MISSING));
});

test('[sasfit-seq-view] tableRows：執行中的列是「擬合中」，其後是「等待中」；移除的檔不列', () => {
    const { state: done, form, plan } = seqState();
    const running = S.reduce(S.reduce(loadedState({}), { type: 'seqStarted', plan, form, settings: done.seq.settings }), { type: 'fitProgress', iteration: 2, chi2r: 3 });
    assert.deepEqual(View.tableRows(running).map((row) => row.status.text), ['擬合中', '等待中', '等待中']);
    const removed = S.reduce(done, { type: 'removeFile', id: 'd2' });
    assert.deepEqual(View.tableRows(removed).map((row) => row.id), ['d1', 'd3']);
    assert.equal(rowOf(removed, 'd3').note, '', '初值來源的檔已移除：不寫');
});

// ---------------------------------------------------------------- html
test('[sasfit-seq-view] headHtml：表頭 scope="col"；條件欄用條件名稱；誤差已乘時註明；量度名稱不寫死', () => {
    const sigma = View.headHtml(View.columns(seqState().state), 'Temperature (K)');
    const tags = checkMarkup(sigma, 'head');
    const heads = tags.filter((t) => !t.closing && t.name === 'th');
    assert.equal(heads.length, 3 + 3 + 2);
    heads.forEach((t) => assert.equal(t.attrs.scope, 'col'));
    assert.match(textOf(sigma), /Temperature \(K\)/);
    assert.ok(sigma.includes(globalThis.SasFitHtml.measureHtml(Hints.measure('sigma'))));
    assert.ok(!sigma.includes('已乘'));
    const none = View.headHtml(View.columns(seqState({ weighting: 'none' }).state), '  ');
    assert.match(textOf(none), /條件值/);
    assert.match(textOf(none), /已乘 √均方/);
    assert.match(textOf(none), /加權殘差均方/);
    const empty = View.headHtml(View.columns(loadedState({})), '條件');
    assert.equal(checkMarkup(empty, 'empty head').filter((t) => !t.closing && t.name === 'th').length, 5);
});

test('[sasfit-seq-view] bodyHtml：每列 data-id；勾選與載入鈕都有 id、aria-label；locked 與 canLoad 決定停用', () => {
    const rows = View.tableRows(seqState({ steps: [{}, { error: 'x' }, {}] }).state);
    const html = View.bodyHtml(rows, { locked: false });
    const tags = checkMarkup(html, 'body');
    const trs = tags.filter((t) => !t.closing && t.name === 'tr');
    assert.deepEqual(trs.map((t) => t.attrs['data-id']), ['d1', 'd2', 'd3']);
    const picks = tags.filter((t) => t.attrs && t.attrs['data-action'] === 'pick');
    const loads = tags.filter((t) => t.attrs && t.attrs['data-action'] === 'load');
    assert.deepEqual(picks.map((t) => t.attrs.id), ['sfSeqPick_d1', 'sfSeqPick_d2', 'sfSeqPick_d3']);
    assert.deepEqual(loads.map((t) => t.attrs.id), ['sfSeqLoad_d1', 'sfSeqLoad_d2', 'sfSeqLoad_d3']);
    assert.equal(picks[0].attrs.type, 'checkbox');
    assert.equal(picks[0].attrs['aria-label'], '將 SYNTH_sphere_10.dat 納入序列擬合');
    assert.equal(picks[0].attrs.checked, true);
    assert.equal(picks[0].attrs.disabled, undefined);
    assert.equal(loads[0].attrs.type, 'button');
    assert.equal(loads[0].attrs['aria-label'], '載入 SYNTH_sphere_10.dat 的擬合參數');
    assert.deepEqual(loads.map((t) => t.attrs.disabled), [undefined, true, undefined]);
    const locked = checkMarkup(View.bodyHtml(rows, { locked: true }), 'locked');
    locked.filter((t) => t.attrs && t.attrs['data-action']).forEach((t) => assert.equal(t.attrs.disabled, true));
    assert.match(textOf(html), /已收斂/);
    assert.equal(View.bodyHtml([], { locked: false }), '');
});

test('[sasfit-seq-view] bodyHtml：長檔名中段省略、title 是完整檔名；stale 有標記', () => {
    const { state } = seqState();
    const long = 'A'.repeat(40) + '_middle_' + 'B'.repeat(40) + '.dat';
    const renamed = Object.freeze({ ...state, files: Object.freeze(state.files.map((f, i) => (i === 2 ? Object.freeze({ ...f, fileName: long }) : f))),
        fitResults: Object.freeze({ ...state.fitResults, d2: fakeResult({ values: { scale: 1, background: 0.001, radius: 60 } }) }) });
    const html = View.bodyHtml(View.tableRows(renamed), { locked: false });
    const tags = checkMarkup(html, 'long');
    assert.ok(tags.some((t) => t.attrs && t.attrs.title === long));
    assert.ok(!textOf(html).includes(long));
    assert.ok(textOf(html).includes(globalThis.SasFitHtml.middleEllipsis(long)));
    assert.match(textOf(html), /已單獨重新擬合/);
});

test('[sasfit-seq-view] XSS 矩陣：檔名、條件名稱、註記、狀態、數值格的每個字串都跳脫', () => {
    PAYLOADS.forEach((p) => {
        const rows = [{ id: p, fileName: p, condition: p, selected: true, canLoad: true, cells: [{ value: p, error: p, mark: p }],
            measure: p, status: { text: p, tone: 'warn' }, note: p, stale: true }];
        const outputs = {
            body: View.bodyHtml(rows, { locked: false }),
            head: View.headHtml({ names: [p], measure: { isChi2: false, label: p, note: p }, scaled: true }, p),
            options: View.yOptionsHtml([{ value: p, label: p }], p),
        };
        Object.entries(outputs).forEach(([where, html]) => {
            checkMarkup(html, where + ' / ' + p);
            assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<svg'), where);
            if (/[<>&"']/.test(p)) assert.ok(!textOf(html).includes(p) || p === "'" || p === '&', where + ': raw payload');
        });
    });
    const { state } = seqState({ conditionName: '"><script>' });
    const evil = Object.freeze({ ...state, files: Object.freeze(state.files.map((f) => Object.freeze({ ...f, fileName: '<img src=x onerror=1>.dat' }))),
        seq: Object.freeze({ ...state.seq, rows: Object.freeze(Object.fromEntries(Object.entries(state.seq.rows).map(([id, row]) => [id, Object.freeze({ ...row, note: 'a <b>bold</b> note' })]))) }) });
    const html = View.headHtml(View.columns(evil), evil.conditionName) + View.bodyHtml(View.tableRows(evil), { locked: false });
    assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<b>'));
    assert.ok(html.includes('&lt;b&gt;bold'));
});

test('[sasfit-seq-view] bodyHtml：500 列在 200 ms 內', () => {
    const row = View.tableRows(seqState().state)[0];
    const rows = Array.from({ length: 500 }, (_, i) => ({ ...row, id: 'd' + (i + 1), fileName: 'file_' + i + '.dat' }));
    const t0 = process.hrtime.bigint();
    const html = View.bodyHtml(rows, { locked: false });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 200, ms + ' ms');
    assert.equal(html.split('<tr').length - 1, 500);
});

// ---------------------------------------------------------------- 趨勢
test('[sasfit-seq-view] yOptions：被擬合的名稱＋量度；沒有結果 → 空陣列', () => {
    assert.deepEqual(View.yOptions(seqState().state), [
        { value: 'scale', label: 'scale' }, { value: 'background', label: 'background' }, { value: 'radius', label: 'radius' },
        { value: View.MEASURE_KEY, label: '約化 χ²' }]);
    assert.equal(View.yOptions(seqState({ weighting: 'none' }).state)[3].label, '加權殘差均方');
    assert.deepEqual(View.yOptions(loadedState({})), []);
    const html = View.yOptionsHtml(View.yOptions(seqState().state), 'radius');
    const options = checkMarkup(html, 'options').filter((t) => !t.closing);
    assert.deepEqual(options.map((t) => t.attrs.value), ['scale', 'background', 'radius', '$measure']);
    assert.deepEqual(options.map((t) => t.attrs.selected), [undefined, undefined, true, undefined]);
});

test('[sasfit-seq-view] trend：三筆收斂 → 三點、x 與 y 遞增、誤差棒＝值 ∓ 顯示的誤差、圓點', () => {
    const { state } = seqState({ conditionName: 'Temperature (K)' });
    const trend = View.trend(state, 'radius');
    assert.deepEqual(trend.points.map((p) => [p.x, p.y, p.id, p.style]), [[10, 50.12, 'd1', 'circle'], [20, 52.07, 'd2', 'circle'], [30, 53.95, 'd3', 'circle']]);
    trend.points.forEach((p) => {
        assert.ok(Math.abs(p.yMax - p.y - 0.05) < 1e-12 && Math.abs(p.y - p.yMin - 0.05) < 1e-12);
    });
    assert.equal(trend.xTitle, 'Temperature (K)');
    assert.equal(trend.yTitle, 'radius');
    assert.equal(trend.omitted, 0);
    assert.equal(trend.byOrder, false);
    assert.equal(trend.label, 'radius 對 Temperature (K) 的趨勢，3 點，由 50.1 到 54.0');
    assert.equal(View.trend(seqState({ conditionName: ' ' }).state, 'radius').xTitle, '條件值');
    const scaled = View.trend(seqState({ weighting: 'none', steps: [{ values: { radius: 50 }, chi2r: 4 }, {}, {}] }).state, 'radius');
    assert.ok(Math.abs(scaled.points[0].yMax - 50.1) < 1e-12, '誤差棒用乘過的誤差');
});

test('[sasfit-seq-view] trend：貼邊界沒有誤差棒；maxiter 是三角形；failed、跳過、沒有條件值、y 非有限的不畫', () => {
    const { state } = seqState({ steps: [{ values: { radius: 0 }, atBound: { radius: 'lower' } }, { values: { radius: 52 }, status: 'maxiter' }, { values: { radius: 54 }, status: 'failed' }] });
    const trend = View.trend(state, 'radius');
    assert.deepEqual(trend.points.map((p) => [p.x, p.y, p.yMin, p.yMax, p.style]), [[10, 0, null, null, 'circle'], [20, 52, 52 - 0.05, 52 + 0.05, 'triangle']]);
    assert.equal(trend.omitted, 1);
    const blank = View.trend(seqState({ conditions: [10, null, 30] }).state, 'radius');
    assert.deepEqual(blank.points.map((p) => p.x), [10, 30]);
    assert.equal(blank.omitted, 1);
    const nan = View.trend(seqState({ steps: [{ values: { radius: NaN } }, {}, {}] }).state, 'radius');
    assert.equal(nan.points.length, 2);
    assert.equal(nan.omitted, 1);
    const empty = View.trend(loadedState({}), 'radius');
    assert.deepEqual(empty.points, []);
    assert.equal(empty.label, '尚無可畫的結果');
});

test('[sasfit-seq-view] trend：全部沒有條件值 → 橫軸改用序號；量度沒有誤差棒、名稱依權重', () => {
    const byOrder = View.trend(seqState({ conditions: [null, null, null] }).state, 'radius');
    assert.equal(byOrder.byOrder, true);
    assert.deepEqual(byOrder.points.map((p) => p.x), [1, 2, 3]);
    assert.equal(byOrder.xTitle, '序號');
    assert.equal(byOrder.omitted, 0);
    const { state } = seqState({ steps: [{ chi2r: 0.9 }, { chi2r: 1.3 }, { chi2r: 1.05 }] });
    const measure = View.trend(state, View.MEASURE_KEY);
    assert.deepEqual(measure.points.map((p) => [p.y, p.yMin, p.yMax]), [[0.9, null, null], [1.3, null, null], [1.05, null, null]]);
    assert.equal(measure.yTitle, '約化 χ²');
    assert.equal(View.trend(seqState({ weighting: 'none' }).state, View.MEASURE_KEY).yTitle, '加權殘差均方');
    assert.equal(View.trend(state, null).yTitle, 'scale', 'y 為 null → 第一個選項');
    assert.equal(View.trend(state, 'gone').yTitle, 'scale', '不存在的名稱 → 第一個選項');
});

test('[sasfit-seq-view] trend：點依 x 排序（不排序執行時線不會來回）', () => {
    const trend = View.trend(seqState({ conditions: [30, 10, 20], options: { sort: false } }).state, 'radius');
    assert.deepEqual(trend.points.map((p) => p.x), [10, 20, 30]);
    assert.deepEqual(trend.points.map((p) => p.id), ['d2', 'd3', 'd1']);
});

test('[sasfit-seq-view] trendConfig：scatter＋連線、tpsSeries 0、sfErrorBars、逐點 pointStyle、沒有顏色與 plugins 陣列、縮放關閉', () => {
    const trend = View.trend(seqState({ steps: [{}, { status: 'maxiter' }, {}] }).state, 'radius');
    const config = View.trendConfig(trend);
    assert.equal(config.type, 'scatter');
    assert.equal(config.plugins, undefined);
    assert.equal(config.data.datasets.length, 1);
    const [ds] = config.data.datasets;
    assert.equal(ds.showLine, true);
    assert.equal(ds.tpsSeries, 0);
    assert.equal(ds.sfErrorBars, true);
    assert.equal(ds.tpsHollow, undefined);
    assert.deepEqual(ds.pointStyle, ['circle', 'triangle', 'circle']);
    assert.deepEqual(Object.keys(ds.data[0]).sort(), ['x', 'y', 'yMax', 'yMin']);
    assert.equal(config.options.scales.x.title.text, trend.xTitle);
    assert.equal(config.options.scales.y.title.text, trend.yTitle);
    assert.equal(config.options.plugins.legend.display, false);
    const { zoom } = config.options.plugins;
    assert.equal(zoom.pan.enabled, false);
    assert.ok([zoom.zoom.wheel, zoom.zoom.pinch, zoom.zoom.drag].every((z) => z.enabled === false));
    const text = JSON.stringify(config);
    assert.doesNotMatch(text, /[cC]olor/);
    assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b|rgb\(/i);
    const tip = config.options.plugins.tooltip.callbacks.label({ parsed: { x: 20, y: 52.0712345 }, dataIndex: 1 });
    assert.equal(tip, 'radius ' + Format.display(Format.number(52.0712345, 5)));
    assert.ok(Object.isFrozen(trend));
});

// ---------------------------------------------------------------- 點列載入用的表單
test('[sasfit-seq-view] loadForm：序列的表單快照＋該列目前的擬合值；結果對不上快照（固定參數不同、另一個模型）或沒有結果 → null', () => {
    const { state, form } = seqState();
    const Jobs = globalThis.SasFitJobs;
    const loaded = View.loadForm(state, 'd2');
    assert.deepEqual(loaded, Jobs.applyResult(form, state.fitResults.d2));
    assert.equal(Jobs.resultMatchesForm(loaded, state.fitResults.d2), true);
    assert.equal(View.loadForm(loadedState({}), 'd1'), null, '還沒跑過');
    assert.equal(View.loadForm(seqState({ steps: [{}, { error: 'x' }, {}] }).state, 'd2'), null, '出錯的列');
    // 之後的單筆擬合：同一個模型、同樣的固定參數 → 仍可載入；固定參數（sld）不同 → 不能（載入後表單會對不上結果）
    const same = fakeResult({ values: { scale: 1, background: 0.001, radius: 61.5 }, names: ['scale', 'background', 'radius'] });
    const sameState = Object.freeze({ ...state, fitResults: Object.freeze({ ...state.fitResults, d2: same }) });
    assert.equal(Number(View.loadForm(sameState, 'd2').fields.radius.value), 61.5);
    const other = fakeResult({ values: { scale: 1, background: 0.001, radius: 61.5, sld: 2 }, names: ['scale', 'background', 'radius'] });
    const otherState = Object.freeze({ ...state, fitResults: Object.freeze({ ...state.fitResults, d2: other }) });
    assert.equal(View.loadForm(otherState, 'd2'), null);
    assert.equal(rowOf(otherState, 'd2').canLoad, false);
    assert.equal(rowOf(otherState, 'd2').stale, true);
    assert.match(rowOf(otherState, 'd2').cells[2].value, /^61\.5/, '數字照樣顯示');
});
