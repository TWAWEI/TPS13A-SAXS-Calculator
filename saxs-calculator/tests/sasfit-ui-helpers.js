'use strict';
/**
 * SAS 擬合頁 DOM 模組（sasfit-data-ui／sasfit-params-ui／sasfit-fit-ui）測試共用的 stub DOM 與假相依。
 *
 * 做法延續 tests/sasfit-section.test.js（本 repo 沒有 jsdom）：靜態元素只 stub 到用得到的屬性與事件；
 * 另外多做一件事——元素的 innerHTML 被賦值時，把字串裡的每個標籤解析成子元素（屬性、value／checked／
 * disabled／hidden、class、data-*、緊接在標籤後的文字），這樣事件委派（event.target 是動態產生的輸入框）
 * 與「就地更新某個動態 id」都測得到。解析只認 SasFitHtml 產生的格式（屬性一律雙引號、值已跳脫）。
 *
 * 事件由 node.fire(type, extra) 觸發：target 是 node，沿 parent 往上冒泡。
 * 模組以 vm 載入（DOM 模組不在 tests/load.js 的 LOAD_ORDER）；每次 boot 一份新的 section 實例。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('./load.js');

const JS = path.join(__dirname, '..', 'js');
const FIXTURES = path.join(__dirname, 'fixtures', 'sasfit', 'dat');
const MODULE_FILES = Object.freeze({
    SasFitDataUi: 'sasfit-data-ui.js', SasFitParamsUi: 'sasfit-params-ui.js', SasFitFitUi: 'sasfit-fit-ui.js',
});
const ENTITIES = Object.freeze({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'" });
const TAG_RE = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>([^<]*)|<\/([a-zA-Z][\w-]*)>/g;
const ATTR_RE = /([\w:-]+)(?:="([^"]*)")?/g;
const VOID_TAGS = Object.freeze(['input', 'br', 'hr', 'img']);

require(path.join(JS, 'a11y-utils.js'));                    // 掛到 load.js 建立的 window 物件上

const decode = (text) => text.replace(/&(?:amp|lt|gt|quot|#0?39);/g, (m) => ENTITIES[m]);
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function matches(node, selector) {
    return selector.split(',').some((part) => {
        const sel = part.trim();
        const m = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel);
        if (m === null) throw new Error('stub DOM: unsupported selector ' + selector);
        if (m[1] && node.tagName !== m[1].toLowerCase()) return false;
        if (m[2] && !node.classList.contains(m[2])) return false;
        if (m[3]) {
            const value = node.getAttribute(m[3]);
            if (value === null || (m[4] !== undefined && value !== m[4])) return false;
        }
        return true;
    });
}

function makeElement(id, tagName = 'div') {
    const listeners = {};
    const attrs = {};
    const classes = new Set();
    const styleProps = {};
    let html = '';
    const node = {
        id, tagName, hidden: false, disabled: false, checked: false, textContent: '', value: '', focusCount: 0,
        parent: null, children: [], htmlSets: 0, dataset: {}, listeners,
        style: { setProperty(name, value) { styleProps[name] = value; }, getPropertyValue: (name) => styleProps[name] || '' },
        classList: {
            add: (name) => { classes.add(name); },
            remove: (name) => { classes.delete(name); },
            contains: (name) => classes.has(name),
            toggle(name, on) {
                const want = on === undefined ? !classes.has(name) : Boolean(on);
                if (want) classes.add(name); else classes.delete(name);
                return want;
            },
        },
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        listenerCount: (type) => (listeners[type] || []).length,
        fire(type, extra) {
            const e = { type, target: node, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...extra };
            for (let at = node; at !== null; at = at.parent) (at.listeners[type] || []).forEach((fn) => fn(e));
            return e;
        },
        setAttribute(name, value) {
            attrs[name] = String(value);
            if (name.indexOf('data-') === 0) node.dataset[camel(name.slice(5))] = String(value);
        },
        removeAttribute(name) { delete attrs[name]; },
        getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
        hasAttribute: (name) => Object.hasOwn(attrs, name),
        focus() { node.focusCount += 1; node.ownerDocument && (node.ownerDocument.activeElement = node); },
        scrollIntoView() {},
        contains(other) {
            for (let at = other; at; at = at.parent) if (at === node) return true;
            return false;
        },
        closest(selector) {
            for (let at = node; at !== null; at = at.parent) if (matches(at, selector)) return at;
            return null;
        },
        descendants() { return node.children.flatMap((child) => [child].concat(child.descendants())); },
        querySelectorAll: (selector) => node.descendants().filter((child) => matches(child, selector)),
        querySelector: (selector) => node.querySelectorAll(selector)[0] || null,
    };
    Object.defineProperty(node, 'innerHTML', {
        get: () => html,
        set(value) {
            html = String(value);
            node.htmlSets += 1;
            node.children = parseChildren(html, node);
        },
    });
    return node;
}

function applyAttributes(node, text) {
    for (const m of text.matchAll(ATTR_RE)) {
        const name = m[1];
        const value = m[2] === undefined ? '' : decode(m[2]);
        node.setAttribute(name, value);
        if (name === 'id') node.id = value;
        else if (name === 'class') value.split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
        else if (name === 'value') node.value = value;
        else if (name === 'checked' || name === 'disabled' || name === 'hidden') node[name] = true;
    }
}

/** 把 html 解析成一棵 stub 元素樹，回傳最上層的子元素。 */
function parseChildren(html, root) {
    const top = [];
    const stack = [];
    for (const m of html.matchAll(TAG_RE)) {
        if (m[4] !== undefined) {                              // 結束標籤
            while (stack.length > 0 && stack.pop().tagName !== m[4].toLowerCase()) { /* 跳過未關閉的 */ }
            continue;
        }
        const node = makeElement('', m[1].toLowerCase());
        applyAttributes(node, m[2]);
        node.textContent = decode(m[3]).trim();
        const parent = stack.length > 0 ? stack[stack.length - 1] : null;
        node.parent = parent === null ? root : parent;
        node.ownerDocument = root.ownerDocument;
        (parent === null ? top : parent.children).push(node);
        if (node.tagName === 'option' && parent !== null && parent.tagName === 'select') {
            if (node.hasAttribute('selected') || parent.children.filter((c) => c.tagName === 'option').length === 1) parent.value = node.value;
        }
        if (VOID_TAGS.indexOf(node.tagName) < 0) stack.push(node);
    }
    return top;
}

/** { document, $ }：靜態元素依 ids 建立；$ 也找得到動態產生的 id。 */
function makeDom(ids) {
    const listeners = {};
    const doc = {
        activeElement: null,
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        fire(type, detail) { (listeners[type] || []).forEach((fn) => fn({ type, detail, target: doc })); },
    };
    const statics = new Map(ids.map((id) => {
        const node = makeElement(id);
        node.ownerDocument = doc;
        return [id, node];
    }));
    const find = (id) => {
        if (statics.has(id)) return statics.get(id);
        for (const node of statics.values()) {
            const hit = node.descendants().find((child) => child.id === id);
            if (hit !== undefined) return hit;
        }
        return null;
    };
    doc.getElementById = find;
    return { document: doc, $: find };
}

// ---------------------------------------------------------------- 假相依

/** 可手動推進的計時器。 */
function fakeTimers() {
    let now = 0;
    let nextId = 1;
    const pending = new Map();
    return {
        setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { pending.delete(id); },
        pendingCount: () => pending.size,
        advance(ms) {
            now += ms;
            [...pending.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at).forEach(([id, t]) => {
                if (pending.delete(id)) t.fn();
            });
        },
    };
}

/** 假的 Worker client：evaluate／fit 回可手動結清的 Promise，並記錄呼叫。 */
function fakeClient() {
    const client = {
        evaluations: [], fits: [], stops: 0,
        evaluate(request) {
            return new Promise((resolve, reject) => { client.evaluations.push({ request, resolve, reject }); });
        },
        fit(job, options) {
            return new Promise((resolve, reject) => { client.fits.push({ job, options, resolve, reject }); });
        },
        stop() { client.stops += 1; },
    };
    return client;
}

function fakePlots() {
    const plots = { views: [], resets: 0, render(view) { plots.views.push(view); return null; }, resetZoom() { plots.resets += 1; } };
    return plots;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** 暫時換掉 console 的一個方法，回傳呼叫紀錄（fn 可以是 async）。 */
async function captureConsole(method, fn) {
    const original = console[method];
    const calls = [];
    console[method] = (...args) => { calls.push(args.map(String).join(' ')); };
    try {
        await fn();
    } finally {
        console[method] = original;
    }
    return calls;
}

const fixtureText = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const fileOf = (name, text, size) => ({ name, text, size: size === undefined ? Buffer.byteLength(text) : size });
const fixtureFile = (name) => fileOf(name, fixtureText(name));

function loadModule(file) {
    const full = path.join(JS, file);
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
}

const savedDocument = global.document;

function restoreGlobals() {
    Object.keys(MODULE_FILES).forEach((name) => { delete globalThis[name]; });
    delete globalThis.SasFitSection;
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
}

/**
 * 一份啟動好的頁面。modules：要載入的分段模組全域名稱；其餘不存在（由骨架代管空狀態）。
 * 回傳 { Section, $, document, client, timers, plots, reads, created, ctx }；ctx 由一個探針分段取得；
 * created.count 是 createClient 被呼叫的次數；sectionActive 為 false 時頁面分頁不是顯示中的那一個。
 */
function boot({ modules = Object.keys(MODULE_FILES), readFile, extraIds = [], sectionActive = true } = {}) {
    Object.keys(MODULE_FILES).forEach((name) => { delete globalThis[name]; });
    modules.forEach((name) => loadModule(MODULE_FILES[name]));
    const probe = { ctx: null };
    loadModule('section-sasfit.js');
    const Section = globalThis.SasFitSection;
    const dom = makeDom(Section.ELEMENT_IDS.concat(['section-sasfit'], extraIds));
    global.document = dom.document;
    if (sectionActive) dom.$('section-sasfit').classList.add('active');
    const client = fakeClient();
    const timers = fakeTimers();
    const plots = fakePlots();
    const reads = [];
    const created = { count: 0 };
    const deps = {
        createClient: () => { created.count += 1; return client; }, timers, plots,
        readFile: readFile || ((file) => { reads.push(file.name); return Promise.resolve(file.text); }),
    };
    // 探針：借第一個存在的分段模組的 create 取得 ctx
    const first = modules[0];
    if (first !== undefined) {
        const original = globalThis[first];
        globalThis[first] = Object.freeze({ create(ctx) { probe.ctx = ctx; return original.create(ctx); } });
    }
    assert.equal(Section.init(deps), true, 'SasFitSection.init 失敗');
    return { Section, $: dom.$, document: dom.document, client, timers, plots, reads, created, ctx: probe.ctx };
}

module.exports = {
    makeDom, makeElement, fakeTimers, fakeClient, fakePlots, flush, captureConsole,
    fixtureText, fixtureFile, fileOf, boot, restoreGlobals, loadModule,
};
