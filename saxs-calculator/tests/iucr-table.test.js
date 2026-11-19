'use strict';
/**
 * IUCr 彙整表頁（js/section-iucr.js）的特性測試（SAS 模型擬合 M4，Task 0）。
 * result-golden 不涵蓋 IUCr 頁，這裡鎖住現況：formatIUCrValue、updateIUCrTable 寫入的 13 個儲存格、
 * 以及「複製表格」基準 fixture（tests/fixtures/sasfit/iucr-copy-v5.2.json，由真實瀏覽器擷取一次，不得重產）。
 * Task 17 之後，本檔除了標明的「複製基準」那一項，其餘必須一字不改仍然通過。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MassUnits } = require('./load.js');

const FILE = path.join(__dirname, '..', 'js', 'section-iucr.js');
const COPY_FIXTURE = path.join(__dirname, 'fixtures', 'sasfit', 'iucr-copy-v5.2.json');

// 與 result-golden.test.js 相同的輸入，另補 name 與 partialSpecificVolume
const PROTEIN = Object.freeze({
    name: 'HEWL', molecularWeight: 69293.82, dryVolume: 87005.4, partialSpecificVolume: 0.7388,
});
const SAXS_FULL = Object.freeze({
    wavelength: 1.03321, concentration: 2, i0Guinier: 0.105, rgGuinier: 28.1, guinierQmax: 0.04,
    i0Pr: 0.104, rgPr: 28.3, dmax: 85, porodVolume: 110000, mwFromPorod: 66666.7,
});
const CELL_IDS = Object.freeze([
    'iucr-protein', 'iucr-dryvol', 'iucr-vbar', 'iucr-mw-seq', 'iucr-wavelength', 'iucr-concentration',
    'iucr-i0-pr', 'iucr-rg-pr', 'iucr-i0-guinier', 'iucr-rg-guinier', 'iucr-dmax', 'iucr-porod', 'iucr-mw-porod',
]);

/** 在獨立的 vm 全域載入 section-iucr.js；假元素記錄 textContent 與 classList */
function load(appState) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, {
                id, textContent: '',
                classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
            });
        }
        return elements.get(id);
    };
    CELL_IDS.forEach(element);
    element('iucrWarning');
    const sandbox = {
        AppState: appState, MassUnits,
        document: { getElementById: id => elements.get(id) || null },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${fs.readFileSync(FILE, 'utf8')}\n;globalThis.__api = { formatIUCrValue, updateIUCrTable };`,
        sandbox, { filename: FILE });
    return { api: sandbox.__api, elements };
}

test('[iucr] formatIUCrValue：非有限值一律 "-"，有限值 toFixed', () => {
    const { api } = load({});
    assert.equal(api.formatIUCrValue(NaN, 5), '-');
    assert.equal(api.formatIUCrValue(Infinity, 5), '-');
    assert.equal(api.formatIUCrValue(-Infinity, 2), '-');
    assert.equal(api.formatIUCrValue(undefined, 5), '-');
    assert.equal(api.formatIUCrValue(1.03321, 5), '1.03321');
    assert.equal(api.formatIUCrValue(28.1, 2), '28.10');
});

test('[iucr] updateIUCrTable：13 個儲存格的文字與警示隱藏', () => {
    const { api, elements } = load({ proteinData: PROTEIN, saxsData: SAXS_FULL });
    api.updateIUCrTable();
    const text = id => elements.get(id).textContent;
    assert.equal(text('iucr-protein'), 'HEWL');
    assert.equal(text('iucr-dryvol'), '87005.4');
    assert.equal(text('iucr-vbar'), '0.738800');
    assert.equal(text('iucr-mw-seq'), MassUnits.formatKDa(69293.82));
    assert.equal(text('iucr-wavelength'), '1.03321');
    assert.equal(text('iucr-concentration'), '2');
    assert.equal(text('iucr-i0-pr'), '0.10400');
    assert.equal(text('iucr-rg-pr'), '28.30');
    assert.equal(text('iucr-i0-guinier'), '0.10500');
    assert.equal(text('iucr-rg-guinier'), '28.10');
    assert.equal(text('iucr-dmax'), '85');
    assert.equal(text('iucr-porod'), '110,000');
    assert.equal(text('iucr-mw-porod'), MassUnits.formatKDa(66666.7));
    assert.equal(elements.get('iucrWarning').classList.contains('hidden'), true);
});

test('[iucr] updateIUCrTable：蛋白質缺欄位時該格為 "-"，SAXS 缺值時同樣', () => {
    const { api, elements } = load({
        proteinData: { name: '', molecularWeight: NaN, dryVolume: NaN, partialSpecificVolume: NaN },
        saxsData: { wavelength: NaN, concentration: NaN, dmax: NaN, porodVolume: NaN, mwFromPorod: NaN },
    });
    api.updateIUCrTable();
    CELL_IDS.forEach(id => assert.equal(elements.get(id).textContent.trim().length > 0, true, id));
    ['iucr-protein', 'iucr-dryvol', 'iucr-vbar', 'iucr-wavelength', 'iucr-concentration', 'iucr-i0-pr',
        'iucr-rg-pr', 'iucr-i0-guinier', 'iucr-rg-guinier', 'iucr-dmax', 'iucr-porod']
        .forEach(id => assert.equal(elements.get(id).textContent, '-', id));
});

test('[iucr] updateIUCrTable：兩者皆 null 時不寫任何元素、警示不動', () => {
    const { api, elements } = load({ proteinData: null, saxsData: null });
    api.updateIUCrTable();
    CELL_IDS.forEach(id => assert.equal(elements.get(id).textContent, '', id));
    assert.equal(elements.get('iucrWarning').classList.contains('hidden'), false);
});

test('[iucr] 只有 SAXS 資料時只寫 SAXS 的格子', () => {
    const { api, elements } = load({ proteinData: null, saxsData: SAXS_FULL });
    api.updateIUCrTable();
    assert.equal(elements.get('iucr-protein').textContent, '');
    assert.equal(elements.get('iucr-wavelength').textContent, '1.03321');
    assert.equal(elements.get('iucrWarning').classList.contains('hidden'), true);
});

// 複製基準：記錄「現況不複製輸入框的值」。Task 17 會刻意改變這件事並改寫這一項——
// 這是本檔唯一允許日後修改的測試。
test('[iucr] 複製基準 fixture：HTML 有 3 個 <input>，文字不含輸入框的預設值（現況）', () => {
    const fixture = JSON.parse(fs.readFileSync(COPY_FIXTURE, 'utf8'));
    assert.equal(fixture.inputs.length, 3);
    for (const state of ['default', 'filled']) {
        const { html, text } = fixture[state];
        assert.equal((html.match(/<input/g) || []).length, 3, `${state} html`);
        fixture.inputs.forEach(input => {
            assert.equal(text.includes(input.value), false, `${state} text 不應含 ${input.id} 的值`);
        });
        assert.match(text, /^Parameter\tValue/);
    }
});
