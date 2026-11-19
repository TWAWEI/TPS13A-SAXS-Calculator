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

// 複製基準：fixture 記錄的是 Task 17 之前的行為（HTML 帶 3 個 <input>、文字不含輸入框的值），不重產。
// Task 17 起複製內容改由 iucrCopySource 處理過的複本產生：輸入框換成現值的文字、不留 <input>、空的擬合段不進複製。
// 瀏覽器裡的實際行為由 tools/sasfit/check_iucr_copy.py 對照這份 fixture 把關（三個輸入框清空時，文字與 fixture
// 逐字相同、HTML 等於 fixture 去掉 <input> 標籤）；這裡只確認 fixture 仍是那份舊行為的紀錄。
test('[iucr] 複製基準 fixture 仍是舊行為的紀錄（HTML 有 3 個 <input>、文字不含輸入框的預設值）；新行為由 iucrCopySource 產生', () => {
    const fixture = JSON.parse(fs.readFileSync(COPY_FIXTURE, 'utf8'));
    assert.equal(fixture.inputs.length, 3);
    for (const state of ['default', 'filled']) {
        const { html, text } = fixture[state];
        assert.equal((html.match(/<input/g) || []).length, 3, `${state} html`);
        fixture.inputs.forEach(input => {
            assert.equal(text.includes(input.value), false, `${state} text 不含 ${input.id} 的值（舊行為）`);
        });
        assert.match(text, /^Parameter\tValue/);
        assert.equal(html.includes('iucr-sf'), false, 'fixture 早於擬合段');
    }
    const source = fs.readFileSync(FILE, 'utf8');
    assert.match(source, /iucrCopySource\(table\)/, '複製按鈕必須經 iucrCopySource');
    assert.doesNotMatch(source, /table\.outerHTML|table\.innerText/, '不得再直接複製表格本身');
});

// ---------------------------------------------------------------- 擬合段（M4 Task 17）
const { SasFitIucr } = require('./load.js');

/** 假的 DOM 節點：只做 iucrCopySource 用得到的部分。 */
function fakeNode(tag, props = {}) {
    const node = {
        tagName: tag, nodeType: tag === '#comment' ? 8 : (tag === '#text' ? 3 : 1), childNodes: [], parentNode: null, attrs: {}, removed: 0,
        className: '', value: '', nodeValue: '', normalized: 0, ...props,
        setAttribute(name, value) { node.attrs[name] = String(value); },
        getAttribute: name => (Object.hasOwn(node.attrs, name) ? node.attrs[name] : null),
        appendChild(child) { child.parentNode = node; node.childNodes.push(child); return child; },
        remove() {
            node.removed += 1;
            if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter(n => n !== node);
            node.parentNode = null;
        },
        replaceWith(other) {
            const siblings = node.parentNode.childNodes;
            siblings[siblings.indexOf(node)] = other;
            other.parentNode = node.parentNode;
            node.parentNode = null;
        },
        normalize() { node.normalized += 1; },
        all() { return node.childNodes.flatMap(child => [child].concat(child.all ? child.all() : [])); },
        querySelectorAll(selector) {
            const tags = selector.split(',').map(t => t.trim());
            return node.all().filter(n => tags.includes(n.tagName));
        },
        querySelector(selector) { return node.all().find(n => '#' + n.attrs.id === selector) || null; },
        cloneNode() {
            const copy = fakeNode(tag, { nodeValue: node.nodeValue });
            Object.assign(copy.attrs, node.attrs);
            node.childNodes.forEach(child => copy.appendChild(child.cloneNode(true)));      // 與真的 cloneNode 相同：不帶 value
            return copy;
        },
    };
    return node;
}

/** 一張假表格：三個輸入框（現值可設定）、表格直屬的兩個註解、擬合段的 tbody。 */
function fakeTable({ values = ['0.01-0.3', '', '293'], empty = 'true', innerTextThrows = false } = {}) {
    const wrapper = fakeNode('div');
    const table = wrapper.appendChild(fakeNode('table'));
    table.attrs.id = 'iucrTable';
    const body = table.appendChild(fakeNode('tbody'));
    const inputs = values.map((value) => {
        const cell = body.appendChild(fakeNode('tr')).appendChild(fakeNode('td'));
        return cell.appendChild(fakeNode('input', { value }));
    });
    table.appendChild(fakeNode('#comment'));
    const block = table.appendChild(fakeNode('tbody'));
    block.attrs.id = 'iucr-sf-body';
    block.attrs['data-empty'] = empty;
    table.appendChild(fakeNode('#comment'));
    const created = [];
    const doc = {
        createElement(tag) {
            const node = fakeNode(tag);
            created.push(node);
            return node;
        },
        createTextNode: value => fakeNode('#text', { nodeValue: value }),
        getElementById: () => null,
    };
    const decorate = (clone) => {
        Object.defineProperty(clone, 'outerHTML', { get: () => 'HTML:' + clone.all().filter(n => n.tagName === '#text').map(n => n.nodeValue).join('|') });
        Object.defineProperty(clone, 'innerText', { get() { if (innerTextThrows) throw new Error('layout failed'); return 'TEXT'; } });
        return clone;
    };
    const realClone = table.cloneNode;
    table.cloneNode = deep => decorate(realClone(deep));
    return { wrapper, table, inputs, block, doc, created };
}

function loadM4(appState, doc) {
    const sandbox = { AppState: appState, MassUnits, SasFitIucr, document: doc };
    vm.createContext(sandbox);
    vm.runInContext(`${fs.readFileSync(FILE, 'utf8')}\n;globalThis.__api = { setIUCrModelFit, renderIUCrModelFit, iucrCopySource, updateIUCrTable };`,
        sandbox, { filename: FILE });
    return sandbox.__api;
}

const SENT = Object.freeze({ datasetName: 'a.dat', model: 'sphere', params: Object.freeze([]), assumptions: Object.freeze([]), notes: Object.freeze([]) });

test('[iucr] setIUCrModelFit：以新物件取代 AppState.sasfitData、寫入列的 HTML 與 data-empty；舊物件不被修改', () => {
    const body = { innerHTML: '', attrs: {}, setAttribute(name, value) { body.attrs[name] = value; } };
    const old = Object.freeze({ datasetName: 'old.dat' });
    const state = { proteinData: null, saxsData: null, sasfitData: old };
    const api = loadM4(state, { getElementById: id => (id === 'iucr-sf-body' ? body : null) });
    api.setIUCrModelFit(SENT);
    assert.equal(state.sasfitData, SENT);
    assert.deepEqual(old, { datasetName: 'old.dat' });
    assert.equal(body.innerHTML, SasFitIucr.rowsHtml(SENT));
    assert.equal(body.attrs['data-empty'], 'false');
    api.setIUCrModelFit(null);
    assert.equal(state.sasfitData, null);
    assert.equal(body.innerHTML, SasFitIucr.rowsHtml(null));
    assert.equal(body.attrs['data-empty'], 'true');
    assert.equal(state.proteinData, null);
});

test('[iucr] renderIUCrModelFit：沒有 tbody 或沒有 SasFitIucr 時靜默返回；updateIUCrTable 不動擬合段', () => {
    const state = { proteinData: null, saxsData: null, sasfitData: SENT };
    const api = loadM4(state, { getElementById: () => null });
    assert.doesNotThrow(() => api.renderIUCrModelFit());
    assert.doesNotThrow(() => api.setIUCrModelFit(SENT));
    const sandbox = { AppState: state, MassUnits, document: { getElementById: () => ({ innerHTML: 'keep', setAttribute() {} }) } };
    vm.createContext(sandbox);
    vm.runInContext(`${fs.readFileSync(FILE, 'utf8')}\n;globalThis.__r = renderIUCrModelFit;`, sandbox, { filename: FILE });
    assert.doesNotThrow(() => sandbox.__r());
    assert.doesNotMatch(fs.readFileSync(FILE, 'utf8').split('function updateIUCrTable')[1].split('\nfunction ')[0], /iucr-sf|sasfitData|innerHTML/);
});

test('[iucr] iucrCopySource：輸入框換成「原表格」的現值、空的擬合段與表格直屬的註解不進複本、複本掛在 sr-only 容器', () => {
    const t = fakeTable();
    const state = { proteinData: null, saxsData: null, sasfitData: null };
    const api = loadM4(state, t.doc);
    const source = api.iucrCopySource(t.table);
    assert.equal(source.html, 'HTML:0.01-0.3||293');
    assert.equal(source.text, 'TEXT');
    assert.equal(source.node.querySelectorAll('input, select, textarea').length, 0);
    assert.equal(source.node.querySelector('#iucr-sf-body'), null);
    assert.equal(source.node.childNodes.some(n => n.nodeType === 8), false);
    assert.ok(source.node.normalized >= 1);
    const holder = t.created[0];
    assert.equal(holder.className, 'sr-only');
    assert.equal(holder.attrs['aria-hidden'], 'true');
    assert.equal(holder.parentNode, t.wrapper);
    assert.equal(source.node.parentNode, holder);
    source.release();
    assert.equal(holder.parentNode, null);
    assert.equal(t.wrapper.childNodes.includes(holder), false);
    // 原表格不變
    assert.equal(t.table.querySelectorAll('input').length, 3);
    assert.deepEqual(t.inputs.map(input => input.value), ['0.01-0.3', '', '293']);
    assert.equal(t.table.querySelector('#iucr-sf-body'), t.block);
    assert.equal(t.table.childNodes.filter(n => n.nodeType === 8).length, 2);
    assert.deepEqual(state, { proteinData: null, saxsData: null, sasfitData: null });
});

test('[iucr] iucrCopySource：已送入的擬合段留在複本裡', () => {
    const t = fakeTable({ empty: 'false' });
    const source = loadM4({ sasfitData: SENT }, t.doc).iucrCopySource(t.table);
    assert.notEqual(source.node.querySelector('#iucr-sf-body'), null);
    source.release();
});

test('[iucr] iucrCopySource：讀取文字時丟例外也會移除暫時的容器', () => {
    const t = fakeTable({ innerTextThrows: true });
    const api = loadM4({ sasfitData: null }, t.doc);
    assert.throws(() => api.iucrCopySource(t.table), /layout failed/);
    assert.equal(t.created[0].removed, 1);
    assert.equal(t.wrapper.childNodes.length, 1, '只剩表格本身');
});

test('[iucr] select 以所選項目的文字進複本', () => {
    const t = fakeTable({ values: ['x'] });
    const select = fakeNode('select', { selectedIndex: 1, options: [{ text: 'A' }, { text: '第二項' }] });
    t.inputs[0].replaceWith(select);
    const source = loadM4({ sasfitData: null }, t.doc).iucrCopySource(t.table);
    assert.equal(source.html, 'HTML:第二項');
    source.release();
});
