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
