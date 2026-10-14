'use strict';
/**
 * 分子量單位（v5.1）的 DOM 與存檔部分：誤輸入提示（MassUnits.initInputHints／writeInput）與
 * form-persistence.js 的舊存檔換算（readFormState）。
 * Node 沒有 DOM：提示用最小的假 document 測；form-persistence.js 是 classic script，
 * 以 vm 在全域執行，localStorage 換成記憶體版的 safeStorage。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MassUnits } = require('./load.js');

const HINT = '超過 10,000 kDa（10 MDa），是不是輸入了 Da？例：66500 Da 請輸入 66.5';

// ---------------------------------------------------------------- 假 DOM
/** 只實作 mass-units.js 用到的介面；closest() 依 anchors 對照表回傳 */
function fakeDocument() {
    const byId = new Map();
    const doc = {
        getElementById: id => byId.get(id) || null,
        createElement: tag => fakeElement(doc, byId, tag),
        input(id, value, anchors) {
            const el = fakeElement(doc, byId, 'input', { id, value, anchors });
            byId.set(id, el);
            return el;
        },
    };
    return doc;
}

function fakeElement(doc, byId, tag, props = {}) {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
        tagName: tag.toUpperCase(), id: '', className: '', textContent: '', value: '',
        ownerDocument: doc, anchors: {}, next: null,
        ...props,
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
        listenerCount: type => (listeners.get(type) || []).length,
        fire(type) { (listeners.get(type) || []).forEach(fn => fn()); },
        closest: selector => el.anchors[selector] || null,
        after(node) {
            el.next = node;
            if (node.id) byId.set(node.id, node);
        },
    };
    return el;
}

function formRow(doc, id, value = '') {
    const group = doc.createElement('div');
    const input = doc.input(id, value, { '.form-input-group': group });
    return { group, input };
}

// ---------------------------------------------------------------- 提示
test('[mass-dom] 提示建在 .form-input-group 之後，帶 aria-live 並串進 aria-describedby', () => {
    const doc = fakeDocument();
    const { group, input } = formRow(doc, 'inputMw');
    input.setAttribute('aria-describedby', 'note1');
    MassUnits.initInputHints(doc);

    const hint = doc.getElementById('inputMwUnitHint');
    assert.ok(hint, '沒有建立提示');
    assert.equal(group.next, hint);
    assert.equal(hint.className, 'field-warning');
    assert.equal(hint.getAttribute('aria-live'), 'polite');
    assert.equal(input.getAttribute('aria-describedby'), 'note1 inputMwUnitHint');
    assert.equal(hint.textContent, '');
});

test('[mass-dom] 理論值面板的欄位：提示接在 .info-panel-header 之後', () => {
    const doc = fakeDocument();
    const header = doc.createElement('div');
    doc.input('theoreticalMWInput', '', { '.info-panel-header': header });
    MassUnits.initInputHints(doc);
    assert.equal(header.next, doc.getElementById('theoreticalMWInputUnitHint'));
});

test('[mass-dom] 初始化當下就檢查（剛還原的 Da 值）；input 事件更新；改回 kDa 就清掉', () => {
    const doc = fakeDocument();
    const { input } = formRow(doc, 'targetProteinMW', '66500');
    MassUnits.initInputHints(doc);
    const hint = doc.getElementById('targetProteinMWUnitHint');
    assert.equal(hint.textContent, HINT);

    input.value = '66.5';
    input.fire('input');
    assert.equal(hint.textContent, '');

    input.value = '150000';
    input.fire('change');
    assert.equal(hint.textContent, HINT);
});

test('[mass-dom] writeInput：寫 kDa 三位小數並清掉舊提示（程式設值不會觸發 input 事件）', () => {
    const doc = fakeDocument();
    const { input } = formRow(doc, 'mwInput', '66500');
    MassUnits.initInputHints(doc);
    MassUnits.writeInput(input, 69293.82);
    assert.equal(input.value, '69.294');
    assert.equal(doc.getElementById('mwInputUnitHint').textContent, '');
    assert.doesNotThrow(() => MassUnits.writeInput(null, 1000));
});

test('[mass-dom] initInputHints 叫兩次：不重建提示、不重複串 id、不重複綁事件', () => {
    const doc = fakeDocument();
    const { input } = formRow(doc, 'centrifugeMw', '66.5');
    MassUnits.initInputHints(doc);
    MassUnits.initInputHints(doc);
    assert.equal(input.getAttribute('aria-describedby'), 'centrifugeMwUnitHint');
    assert.equal(input.listenerCount('input'), 1);
    assert.equal(input.listenerCount('change'), 1);
});

// ---------------------------------------------------------------- 存檔換算
const STORE = new Map();
const writes = [];
globalThis.MassUnits = MassUnits;   // classic script 以裸名稱取用
globalThis.safeStorage = Object.freeze({
    get: key => (STORE.has(key) ? STORE.get(key) : null),
    set: (key, value) => { writes.push(key); STORE.set(key, value); return true; },
    remove: key => STORE.delete(key),
});
const persistence = path.join(__dirname, '..', 'js', 'form-persistence.js');
vm.runInThisContext(fs.readFileSync(persistence, 'utf8'), { filename: persistence });
const KEY = 'tps13a-form-state';

function seed(state) {
    STORE.clear();
    writes.length = 0;
    STORE.set(KEY, JSON.stringify(state));
}

const stored = () => JSON.parse(STORE.get(KEY));

test('[mass-dom] 舊存檔（無 massUnit）：分子量 ÷ 1000、寫回帶標記；再讀一次不會再除', () => {
    seed({ savedAt: '2026-10-01T08:00:00.000Z', values: { inputMw: '69293.82', centrifugeMw: '150000', uvAbsorbance: '0.5' } });
    const first = readFormState();
    assert.deepEqual(first.values, { inputMw: '69.294', centrifugeMw: '150', uvAbsorbance: '0.5' });
    assert.equal(first.massMigrated, true);
    assert.equal(first.savedAt, '2026-10-01T08:00:00.000Z');
    assert.equal(stored().massUnit, 'kDa');
    assert.deepEqual(stored().values, first.values);

    writes.length = 0;
    const second = readFormState();
    assert.deepEqual(second.values, first.values);
    assert.equal(second.massMigrated, false);
    assert.deepEqual(writes, [], '已換算過的存檔不該再寫');
});

test('[mass-dom] 新存檔（massUnit: kDa）：大值也原樣（交給提示），不寫回', () => {
    seed({ savedAt: null, massUnit: 'kDa', values: { targetProteinMW: '66500' } });
    const state = readFormState();
    assert.deepEqual(state.values, { targetProteinMW: '66500' });
    assert.equal(state.massMigrated, false);
    assert.deepEqual(writes, []);
});

test('[mass-dom] v4.6 以前的扁平格式：換算分子量，並照舊清掉密碼欄位', () => {
    seed({ inputMw: '66500', dndcPasswordInput: 'secret' });
    const state = readFormState();
    assert.deepEqual(state.values, { inputMw: '66.5' });
    assert.equal(state.massMigrated, true);
    assert.ok(!('dndcPasswordInput' in stored().values));
});

test('[mass-dom] 舊存檔裡 < 1,000 的值不換算，也不說「已換算」，但補上標記', () => {
    seed({ savedAt: null, values: { mwInput: '66.5' } });
    const state = readFormState();
    assert.deepEqual(state.values, { mwInput: '66.5' });
    assert.equal(state.massMigrated, false);
    assert.equal(stored().massUnit, 'kDa');
});
