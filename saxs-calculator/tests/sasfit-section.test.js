'use strict';
/**
 * section-sasfit.js 的 stub-DOM 測試（M3 計畫 Task 10b）：啟動、必要元素檢查、分段切換（滑鼠與鍵盤）、
 * 空狀態、狀態與表單的持有、交給三個分段模組的 ctx（dispatch／refresh／setForm／client／preview）。
 *
 * 做法仿 tests/liposome-section.test.js：DOM 只 stub 到 getElementById 與元素的
 * hidden／disabled／textContent／innerHTML／屬性／classList／事件監聽／focus。
 * SasFit 純模組與 FormUtils 等由 tests/load.js 載入（SasFit* 在 globalThis，其餘在它建立的 window 物件上）；
 * section-sasfit.js 是 DOM 模組，不在 LOAD_ORDER：這裡以 vm 載入，每個測試一份新的模組實例。
 * document 只在本檔建立，after() 還原。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('./load.js');
const { read } = require('./style-scan.js');

const SECTION_FILE = path.join(__dirname, '..', 'js', 'section-sasfit.js');
const SECTION_SOURCE = fs.readFileSync(SECTION_FILE, 'utf8');
const SEGMENT_GLOBALS = ['SasFitDataUi', 'SasFitParamsUi', 'SasFitFitUi'];
const TABS = [
    { key: 'data', tab: 'sfTabData', panel: 'sfPanelData' },
    { key: 'model', tab: 'sfTabModel', panel: 'sfPanelModel' },
    { key: 'fit', tab: 'sfTabFit', panel: 'sfPanelFit' },
];

const savedDocument = global.document;
require(path.join(__dirname, '..', 'js', 'a11y-utils.js'));   // 掛到 load.js 建立的 window 物件上

/** 載入一份新的 section-sasfit.js（取代 globalThis.SasFitSection）。 */
function loadSection() {
    vm.runInThisContext(SECTION_SOURCE, { filename: SECTION_FILE });
    return globalThis.SasFitSection;
}

// ---------------------------------------------------------------- stub DOM
function makeElement(id) {
    const listeners = {};
    const attrs = {};
    const classes = new Set();
    const node = {
        id, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', focusCount: 0,
        listeners,
        classList: {
            add: name => { classes.add(name); },
            remove: name => { classes.delete(name); },
            contains: name => classes.has(name),
            toggle(name, on) {
                const want = on === undefined ? !classes.has(name) : Boolean(on);
                if (want) classes.add(name); else classes.delete(name);
                return want;
            },
        },
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        listenerCount: type => (listeners[type] || []).length,
        fire(type, event) {
            const e = { target: node, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...event };
            (listeners[type] || []).forEach(fn => fn(e));
            return e;
        },
        setAttribute(name, value) { attrs[name] = String(value); },
        removeAttribute(name) { delete attrs[name]; },
        getAttribute: name => (Object.hasOwn(attrs, name) ? attrs[name] : null),
        focus() { node.focusCount += 1; },
    };
    return node;
}

/** 以 index.html 的初始標記為準：第一個分段選中，其餘兩個面板 hidden。 */
function makeDom(Section, omit = []) {
    const elements = new Map(Section.ELEMENT_IDS.filter(id => !omit.includes(id)).map(id => [id, makeElement(id)]));
    TABS.forEach(({ tab, panel }, i) => {
        const tabEl = elements.get(tab);
        const panelEl = elements.get(panel);
        if (tabEl) {
            tabEl.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
            tabEl.setAttribute('tabindex', i === 0 ? '0' : '-1');
            if (i === 0) tabEl.classList.add('active');
        }
        if (panelEl) panelEl.hidden = i !== 0;
    });
    global.document = { getElementById: id => elements.get(id) || null };
    return id => elements.get(id);
}

/** 暫時換掉 console 的一個方法，回傳呼叫紀錄。 */
function captureConsole(method, fn) {
    const original = console[method];
    const calls = [];
    console[method] = (...args) => { calls.push(args.map(String).join(' ')); };
    try {
        fn();
    } finally {
        console[method] = original;
    }
    return calls;
}

/** 假的分段模組：記錄 create 收到的 ctx 與 render 次數。 */
function fakeSegments(extra = {}) {
    const record = { ctx: {}, renders: { SasFitDataUi: 0, SasFitParamsUi: 0, SasFitFitUi: 0 }, created: [] };
    SEGMENT_GLOBALS.forEach((name) => {
        globalThis[name] = {
            create(ctx) {
                record.ctx[name] = ctx;
                record.created.push(name);
                return { render() { record.renders[name] += 1; }, ...(extra[name] || {}) };
            },
        };
    });
    return record;
}

function clearSegments() {
    SEGMENT_GLOBALS.forEach((name) => { delete globalThis[name]; });
}

/** 一份啟動好的頁面：{ Section, $, deps, clients }。 */
function boot({ segments = null } = {}) {
    clearSegments();
    const record = segments === null ? null : fakeSegments(segments);
    const Section = loadSection();
    const $ = makeDom(Section);
    const clients = [];
    const deps = { createClient: () => { const client = { id: clients.length + 1 }; clients.push(client); return client; } };
    assert.equal(Section.init(deps), true);
    return { Section, $, deps, clients, record };
}

const tabState = $ => TABS.map(({ tab, panel }) => ({
    selected: $(tab).getAttribute('aria-selected'),
    tabindex: $(tab).getAttribute('tabindex'),
    active: $(tab).classList.contains('active'),
    panelHidden: $(panel).hidden,
}));

const expectedTabs = selected => TABS.map(({ key }) => ({
    selected: String(key === selected), tabindex: key === selected ? '0' : '-1', active: key === selected, panelHidden: key !== selected,
}));

after(() => {
    clearSegments();
    delete globalThis.SasFitSection;
    if (savedDocument === undefined) delete global.document;
    else global.document = savedDocument;
});

// ---------------------------------------------------------------- 載入與啟動
test('[sasfit-section] 模組頂層不碰 document：沒有 document 的環境載入不丟錯，匯出凍結物件', () => {
    delete global.document;
    assert.equal(typeof document, 'undefined');
    const Section = loadSection();
    assert.ok(Object.isFrozen(Section));
    for (const name of ['init', 'getState', 'getForm']) assert.equal(typeof Section[name], 'function', name);
    const errors = captureConsole('error', () => { assert.equal(Section.init(), false); });
    assert.equal(errors.length, 1, '沒有 document 時 init 回報一次錯誤後返回');
});

test('[sasfit-section] 必要元素清單都在 index.html 的 sasfit 區段裡，且沒有重複', () => {
    const Section = loadSection();
    const html = read('index.html');
    const region = html.slice(html.indexOf('id="section-sasfit"'), html.lastIndexOf('<!-- sasfit:end -->'));
    const ids = new Set([...region.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    assert.ok(Section.ELEMENT_IDS.length >= 50, `必要元素只有 ${Section.ELEMENT_IDS.length} 個`);
    assert.deepEqual(Section.ELEMENT_IDS.filter(id => !ids.has(id)), [], 'index.html 沒有這些 id');
    assert.equal(new Set(Section.ELEMENT_IDS).size, Section.ELEMENT_IDS.length);
    for (const { tab, panel } of TABS) assert.ok(Section.ELEMENT_IDS.includes(tab) && Section.ELEMENT_IDS.includes(panel));
});

test('[sasfit-section] init 缺必要元素：console.error 列出缺的 id，不丟例外、不綁事件', () => {
    clearSegments();
    const Section = loadSection();
    const $ = makeDom(Section, ['sfFitStart', 'sfMainChart']);
    let result;
    const errors = captureConsole('error', () => { result = Section.init(); });
    assert.equal(result, false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /sfFitStart/);
    assert.match(errors[0], /sfMainChart/);
    assert.equal($('sfTabData').listenerCount('click'), 0);
    assert.equal($('sfTabs').listenerCount('keydown'), 0);
});

test('[sasfit-section] init 第二次呼叫不重複綁事件、不重建分段模組、不重設狀態', () => {
    const { Section, $, record } = boot({ segments: {} });
    $('sfTabModel').fire('click');
    assert.equal(Section.init(), true);
    for (const { tab } of TABS) assert.equal($(tab).listenerCount('click'), 1, tab);
    assert.equal($('sfTabs').listenerCount('keydown'), 1);
    assert.deepEqual(record.created, SEGMENT_GLOBALS);
    assert.equal(Section.getState().tab, 'model');
});

// ---------------------------------------------------------------- 分段切換
test('[sasfit-section] 啟動後畫面與初始狀態一致：資料分段選中', () => {
    const { Section, $ } = boot();
    assert.equal(Section.getState().tab, 'data');
    assert.deepEqual(tabState($), expectedTabs('data'));
});

test('[sasfit-section] 點分頁鈕：該鈕 aria-selected／tabindex／.active，面板 hidden 互換', () => {
    const { Section, $ } = boot();
    for (const { key, tab } of [TABS[2], TABS[1], TABS[0]]) {
        $(tab).fire('click');
        assert.equal(Section.getState().tab, key);
        assert.deepEqual(tabState($), expectedTabs(key));
    }
});

test('[sasfit-section] 方向鍵／Home／End 依 SasFitState.nextTab 移動，焦點移到新分頁，並取消預設捲動', () => {
    const { Section, $ } = boot();
    const order = SasFitState.TABS;
    let current = 'data';
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'ArrowLeft']) {
        const next = SasFitState.nextTab(order, current, key);
        const target = $(TABS.find(t => t.key === next).tab);
        const before = target.focusCount;
        const event = $('sfTabs').fire('keydown', { key });
        assert.equal(event.defaultPrevented, true, key);
        assert.equal(Section.getState().tab, next, key);
        assert.deepEqual(tabState($), expectedTabs(next), key);
        assert.equal(target.focusCount, before + 1, `${key} 之後焦點應在 ${next}`);
        current = next;
    }
});

test('[sasfit-section] 其他按鍵不切換分段、不取消預設行為', () => {
    const { Section, $ } = boot();
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowDown']) {
        const event = $('sfTabs').fire('keydown', { key });
        assert.equal(event.defaultPrevented, false, key);
        assert.equal(Section.getState().tab, 'data', key);
    }
    assert.equal($('sfTabData').focusCount, 0);
});

// ---------------------------------------------------------------- 空狀態、狀態與表單
test('[sasfit-section] 啟動後的空狀態：sfDataEmpty 有文字、開始擬合停用、擬合列的摘要說明請先載入資料', () => {
    const { $ } = boot();
    assert.ok($('sfDataEmpty').textContent.length > 0);
    assert.equal($('sfDataEmpty').hidden, false);
    assert.equal($('sfDataWrapper').hidden, true);
    assert.equal($('sfFitStart').disabled, true);
    assert.match($('sfFitSummary').textContent, /請先載入資料/);
});

test('[sasfit-section] getState 是 SasFitState.initial() 形狀的凍結物件；getForm 是 SasFitForm.create(\'sphere\')', () => {
    const { Section } = boot();
    assert.ok(Object.isFrozen(Section.getState()));
    assert.deepEqual(Section.getState(), SasFitState.initial());
    assert.deepEqual(Section.getForm(), SasFitForm.create('sphere'));
});

// ---------------------------------------------------------------- ctx 與分段模組
test('[sasfit-section] 三個分段模組存在才建立，依序收到同一個凍結的 ctx；啟動時各 render 一次', () => {
    const { record, Section, $ } = boot({ segments: {} });
    assert.deepEqual(record.created, SEGMENT_GLOBALS);
    const ctx = record.ctx.SasFitDataUi;
    assert.equal(record.ctx.SasFitParamsUi, ctx);
    assert.equal(record.ctx.SasFitFitUi, ctx);
    assert.ok(Object.isFrozen(ctx));
    for (const name of ['el', 'getState', 'dispatch', 'getForm', 'setForm', 'refresh']) assert.equal(typeof ctx[name], 'function', name);
    for (const name of ['schedule', 'cancel', 'last']) assert.equal(typeof ctx.preview[name], 'function', name);
    assert.equal(ctx.el('sfDataBody'), $('sfDataBody'));
    assert.equal(ctx.el('sfNoSuchElement'), null);
    assert.equal(ctx.getState(), Section.getState());
    assert.equal(ctx.getForm(), Section.getForm());
    assert.deepEqual(record.renders, { SasFitDataUi: 1, SasFitParamsUi: 1, SasFitFitUi: 1 });
});

test('[sasfit-section] 有分段模組時，骨架不再代管該分段的空狀態', () => {
    const { $ } = boot({ segments: {} });
    assert.equal($('sfFitStart').disabled, false, '擬合分段存在時由它決定按鈕狀態');
    assert.equal($('sfRangeInfo').textContent, '');
});

test('[sasfit-section] dispatch：狀態以 SasFitState.reduce 更新並重繪各分段；setTab 只換分段；silent 不重繪', () => {
    const { record, Section, $ } = boot({ segments: {} });
    const ctx = record.ctx.SasFitDataUi;
    const before = Section.getState();
    const after1 = ctx.dispatch({ type: 'setPlotMode', mode: 'kratky' });
    assert.equal(after1, Section.getState());
    assert.deepEqual(after1, SasFitState.reduce(before, { type: 'setPlotMode', mode: 'kratky' }));
    assert.ok(Object.isFrozen(after1));
    assert.equal(before.plotMode, 'loglog', '舊的狀態物件不被修改');
    assert.deepEqual(record.renders, { SasFitDataUi: 2, SasFitParamsUi: 2, SasFitFitUi: 2 });

    ctx.dispatch({ type: 'setTab', tab: 'fit' });
    assert.deepEqual(tabState($), expectedTabs('fit'));
    assert.deepEqual(record.renders, { SasFitDataUi: 2, SasFitParamsUi: 2, SasFitFitUi: 2 }, 'setTab 不重繪分段內容');

    ctx.dispatch({ type: 'setConditionName', name: '溫度 (K)' }, { silent: true });
    assert.equal(Section.getState().conditionName, '溫度 (K)');
    assert.deepEqual(record.renders, { SasFitDataUi: 2, SasFitParamsUi: 2, SasFitFitUi: 2 });

    ctx.refresh();
    assert.deepEqual(record.renders, { SasFitDataUi: 3, SasFitParamsUi: 3, SasFitFitUi: 3 });
});

test('[sasfit-section] dispatch 不認得的 action：丟 Error，狀態不變、不重繪', () => {
    const { record, Section } = boot({ segments: {} });
    const before = Section.getState();
    assert.throws(() => record.ctx.SasFitDataUi.dispatch({ type: 'noSuchAction' }));
    assert.equal(Section.getState(), before);
    assert.deepEqual(record.renders, { SasFitDataUi: 1, SasFitParamsUi: 1, SasFitFitUi: 1 });
});

test('[sasfit-section] setForm：換掉表單但不重繪（打字時參數表不得重建）；非物件丟 Error', () => {
    const { record, Section } = boot({ segments: {} });
    const ctx = record.ctx.SasFitParamsUi;
    const next = SasFitForm.reduce(Section.getForm(), { type: 'setModel', model: 'cylinder' });
    assert.equal(ctx.setForm(next), next);
    assert.equal(Section.getForm(), next);
    assert.equal(ctx.getForm(), next);
    assert.deepEqual(record.renders, { SasFitDataUi: 1, SasFitParamsUi: 1, SasFitFitUi: 1 });
    assert.throws(() => ctx.setForm(null), /form/);
    assert.equal(Section.getForm(), next);
});

test('[sasfit-section] client 延後建立：啟動時不呼叫 createClient，第一次取用才建立，之後是同一個', () => {
    const { record, clients } = boot({ segments: {} });
    assert.equal(clients.length, 0);
    const ctx = record.ctx.SasFitFitUi;
    const first = ctx.client;
    assert.equal(clients.length, 1);
    assert.equal(first, clients[0]);
    assert.equal(ctx.client, first);
    assert.equal(record.ctx.SasFitDataUi.client, first);
    assert.equal(clients.length, 1);
});

test('[sasfit-section] deps：注入的值原樣交給分段模組，沒給的用預設（計時器、readFile、plots）', () => {
    clearSegments();
    const record = fakeSegments();
    const Section = loadSection();
    makeDom(Section);
    const plots = { render() {} };
    const timers = { setTimeout() {}, clearTimeout() {} };
    assert.equal(Section.init({ plots, timers }), true);
    const { deps } = record.ctx.SasFitDataUi;
    assert.ok(Object.isFrozen(deps));
    assert.equal(deps.plots, plots);
    assert.equal(deps.timers, timers);
    assert.equal(typeof deps.readFile, 'function');
    assert.equal(typeof deps.createClient, 'function');

    const plain = boot({ segments: {} }).record.ctx.SasFitDataUi.deps;
    assert.equal(typeof plain.timers.setTimeout, 'function');
    assert.equal(typeof plain.timers.clearTimeout, 'function');
    assert.equal(plain.plots, globalThis.SasFitPlots, '沒給時用 SasFitPlots（tests/load.js 已載入 sasfit-plots.js）');
    assert.equal(typeof plain.plots.render, 'function');
});

test('[sasfit-section] ctx.setHtml：寫入 innerHTML；與上次寫入的相同就不碰；參數不對丟 Error', () => {
    const { record, $ } = boot({ segments: {} });
    const { setHtml } = record.ctx.SasFitDataUi;
    const target = $('sfFitResults');
    let sets = 0;
    let html = '';
    Object.defineProperty(target, 'innerHTML', { get: () => html, set(value) { html = value; sets += 1; } });
    assert.equal(setHtml(target, '<p>a</p>'), true);
    assert.equal(target.innerHTML, '<p>a</p>');
    assert.equal(setHtml(target, '<p>a</p>'), false);
    assert.equal(sets, 1, '相同的 HTML 不重設（焦點與捲動位置不受影響）');
    assert.equal(setHtml(target, ''), true);
    assert.equal(sets, 2);
    assert.throws(() => setHtml(null, ''), /element/);
    assert.throws(() => setHtml(target, 42), /string/);
});

test('[sasfit-section] ctx.setHtml：焦點在被重建的容器內時，移到同 id 的新元素並還原游標；在容器外則不動', () => {
    const { record, $ } = boot({ segments: {} });
    const { setHtml } = record.ctx.SasFitDataUi;
    const container = $('sfParamBody');
    const old = { id: 'sfValue_radius', selectionStart: 2, selectionEnd: 3 };
    const fresh = makeElement('sfValue_radius');
    const selections = [];
    fresh.setSelectionRange = (a, b) => { selections.push([a, b]); };
    container.contains = node => node === old;
    const byId = document.getElementById;
    document.getElementById = id => (id === 'sfValue_radius' ? fresh : byId(id));
    document.activeElement = old;
    assert.equal(setHtml(container, '<tr></tr>'), true);
    assert.equal(fresh.focusCount, 1);
    assert.deepEqual(selections, [[2, 3]]);

    document.activeElement = { id: 'somewhereElse' };
    assert.equal(setHtml(container, '<tr><td></td></tr>'), true);
    assert.equal(fresh.focusCount, 1, '焦點不在容器內：不搬動');

    // 沒有文字游標的輸入（number、checkbox）：讀 selectionStart 會丟例外，只還原焦點
    const numberInput = { id: 'sfValue_radius' };
    Object.defineProperty(numberInput, 'selectionStart', { get() { throw new Error('InvalidStateError'); } });
    container.contains = node => node === numberInput;
    document.activeElement = numberInput;
    assert.equal(setHtml(container, '<tr><td>x</td></tr>'), true);
    assert.equal(fresh.focusCount, 2);
    assert.equal(selections.length, 1);
});

test('[sasfit-section] ctx.preview 轉給模型分段；沒有模型分段時是空動作', () => {
    const calls = [];
    const curve = { q: new Float64Array(1), I: new Float64Array(1) };
    const { record } = boot({ segments: { SasFitParamsUi: {
        schedulePreview() { calls.push('schedule'); }, cancelPreview() { calls.push('cancel'); }, lastPreview: () => curve,
    } } });
    const { preview } = record.ctx.SasFitFitUi;
    preview.schedule();
    preview.cancel();
    assert.deepEqual(calls, ['schedule', 'cancel']);
    assert.equal(preview.last(), curve);
    assert.deepEqual(preview.status(), {}, '模型分段沒有 previewStatus 時是空物件');
    assert.ok(Object.isFrozen(preview.status()));

    const status = Object.freeze({ computing: true, paused: false, previewPoints: 120, allNonFinite: false, error: '' });
    const withStatus = boot({ segments: { SasFitParamsUi: {
        schedulePreview() {}, cancelPreview() {}, lastPreview: () => null, previewStatus: () => status,
    } } });
    assert.equal(withStatus.record.ctx.SasFitDataUi.preview.status(), status);

    clearSegments();
    const data = { ctx: null };
    globalThis.SasFitDataUi = { create(ctx) { data.ctx = ctx; return { render() {} }; } };
    const Section = loadSection();
    makeDom(Section);
    assert.equal(Section.init({ createClient: () => ({}) }), true);
    assert.doesNotThrow(() => { data.ctx.preview.schedule(); data.ctx.preview.cancel(); });
    assert.equal(data.ctx.preview.last(), null);
    assert.deepEqual(data.ctx.preview.status(), {});
});

test('[sasfit-section] 分段模組的 create 沒有回傳帶 render 的物件：init 回報錯誤並返回，不丟例外', () => {
    clearSegments();
    globalThis.SasFitDataUi = { create: () => ({}) };
    const Section = loadSection();
    makeDom(Section);
    let result;
    const errors = captureConsole('error', () => { result = Section.init({ createClient: () => ({}) }); });
    assert.equal(result, false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /SasFitDataUi/);
});

// ---------------------------------------------------------------- 防護（修正批次 A：程式審查 M3 與拖放）
test('[sasfit-section] 某個分段的 render 丟例外：console.error、sfAlert 顯示訊息，其餘分段照常重繪，之後的 dispatch 仍可用', () => {
    clearSegments();
    const record = fakeSegments({ SasFitParamsUi: { render() { throw new Error('boom <b>'); } } });
    const Section = loadSection();
    const $ = makeDom(Section);
    let ok;
    const errors = captureConsole('error', () => { ok = Section.init({ createClient: () => ({}) }); });
    assert.equal(ok, true, '一個分段壞掉不擋住整頁');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /model/);
    assert.match(errors[0], /boom/);
    assert.equal($('sfAlert').textContent, '畫面更新時發生錯誤，部分內容可能不是最新的；請重新整理頁面後再試');
    assert.equal($('sfAlert').innerHTML, '', '訊息以 textContent 寫入');
    assert.deepEqual([record.renders.SasFitDataUi, record.renders.SasFitFitUi], [1, 1]);
    const again = captureConsole('error', () => record.ctx.SasFitDataUi.dispatch({ type: 'setPlotMode', mode: 'kratky' }));
    assert.equal(again.length, 1);
    assert.equal(Section.getState().plotMode, 'kratky');
    assert.deepEqual([record.renders.SasFitDataUi, record.renders.SasFitFitUi], [2, 2]);
    const viaRefresh = captureConsole('error', () => record.ctx.SasFitFitUi.refresh());
    assert.equal(viaRefresh.length, 1);
});

test('[sasfit-section] 分頁鈕在第一次重繪之前就綁好（第一次重繪出錯也能切分段）', () => {
    clearSegments();
    let seen = null;
    const Section = loadSection();
    const $ = makeDom(Section);
    fakeSegments({ SasFitDataUi: { render() { if (seen === null) seen = $('sfTabModel').listenerCount('click'); } } });
    assert.equal(Section.init({ createClient: () => ({}) }), true);
    assert.equal(seen, 1);
});

test('[sasfit-section] init 中途失敗後再呼叫：已建立的分段不重建、分頁鈕不重複綁定', () => {
    clearSegments();
    const record = fakeSegments();
    globalThis.SasFitFitUi = { create() { throw new Error('fit segment broke'); } };
    const Section = loadSection();
    const $ = makeDom(Section);
    let first;
    const errors = captureConsole('error', () => { first = Section.init({ createClient: () => ({}) }); });
    assert.equal(first, false);
    assert.equal(errors.length, 1);
    assert.deepEqual(record.created, ['SasFitDataUi', 'SasFitParamsUi']);
    globalThis.SasFitFitUi = { create(ctx) { record.created.push('SasFitFitUi'); record.ctx.SasFitFitUi = ctx; return { render() {} }; } };
    assert.equal(Section.init({ createClient: () => ({}) }), true);
    assert.deepEqual(record.created, ['SasFitDataUi', 'SasFitParamsUi', 'SasFitFitUi'], '前兩個沒有重建（它們的事件不會綁兩次）');
    for (const { tab } of TABS) assert.equal($(tab).listenerCount('click'), 1, tab);
    assert.equal($('sfTabs').listenerCount('keydown'), 1);
    assert.equal(record.ctx.SasFitFitUi, record.ctx.SasFitDataUi, '同一個 ctx');
    assert.equal(Section.init(), true);
    assert.equal($('sfTabs').listenerCount('keydown'), 1);
});

test('[sasfit-section] 把檔案拖到 #sfDrop 以外：本分頁顯示中時取消瀏覽器的預設行為（不會離開頁面）；其他分頁不干涉', () => {
    clearSegments();
    const Section = loadSection();
    const $ = makeDom(Section);
    const listeners = {};
    const section = { classList: { contains: (name) => name === 'active' && section.active }, active: true };
    const base = global.document;
    global.document = { ...base, getElementById: (id) => (id === 'section-sasfit' ? section : base.getElementById(id)),
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } };
    assert.equal(Section.init({ createClient: () => ({}) }), true);
    assert.deepEqual([listeners.dragover.length, listeners.drop.length], [1, 1]);
    const fire = (type, target) => {
        const event = { type, target, prevented: false, preventDefault() { event.prevented = true; } };
        listeners[type].forEach((fn) => fn(event));
        return event.prevented;
    };
    const inside = { closest: (sel) => (sel === '#sfDrop' ? $('sfDrop') : null) };
    const outside = { closest: () => null };
    assert.equal(fire('dragover', outside), true);
    assert.equal(fire('drop', outside), true);
    assert.equal(fire('drop', inside), false, '#sfDrop 自己處理');
    assert.equal(fire('drop', {}), true, '沒有 closest 的目標視為區域外');
    section.active = false;
    assert.equal(fire('drop', outside), false, '別的分頁顯示中：不干涉');
    assert.equal(fire('dragover', outside), false);
    assert.equal(Section.init(), true);
    assert.equal(listeners.drop.length, 1, '不重複綁定');
});
