'use strict';
/**
 * Structural invariants for the split-out js/ and css/ modules (batch 3, S1–S4).
 *
 * 這些檔案是 classic <script>／多個 <link>，沒有 build 也沒有模組作用域：
 *   1. 任一檔語法錯 → 該檔靜默不執行，其他檔照跑，症狀是「某個按鈕沒反應」。
 *   2. 兩個檔同時在頂層宣告同一個 const/let/class → 整頁 SyntaxError 全掛。
 *   3. 拆出新檔卻忘了在 index.html 加 <script>／<link> → 同樣是靜默失效。
 * 三種都只在瀏覽器裡才看得到，單元測試看不到，所以用靜態掃描把規則釘住。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const CSS_DIR = path.join(ROOT, 'css');

// 全域規則：檔案 ≤ 800 行（典型 200–400）。index.html 無 build/template 層，已知例外。
const MAX_LINES = 800;

// 「棘輪」名單：允許暫時超過 800 行的檔案。下面的測試會同時檢查名單內的檔案『確實還是超行』，
// 拆完之後不移除名單就會失敗，債務不會被默默留著。2026-10-14 拆完 calculations.js 與
// dndc-calculations.js 後清空。
const PENDING_SPLIT = Object.freeze([]);

// 拆檔群組：負責匯出命名空間的原檔，在載入期讀取分檔的頂層宣告（函式與常數），所以分檔必須先載入。
const SPLIT_GROUPS = Object.freeze({
    'calculations.js': Object.freeze(['sample-prep-calculations.js', 'hplc-calculations.js', 'detector-calculations.js']),
    'dndc-calculations.js': Object.freeze(['dndc-theory-calculations.js', 'dndc-signal-calculations.js', 'dndc-alignment-calculations.js']),
});

const listFiles = (dir, ext) =>
    fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort();

const JS_FILES = listFiles(JS_DIR, '.js');
const CSS_FILES = listFiles(CSS_DIR, '.css');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/**
 * 依 index.html 出現順序取出本地資源清單（跳過 CDN）。
 * 每筆 { path, version }：path 不含查詢字串，version 是 ?v= 的值（沒有則為 null）。
 */
function localRefs(pattern) {
    const found = [];
    for (const m of INDEX_HTML.matchAll(pattern)) {
        const [file, query = ''] = m[1].split('?');
        found.push(Object.freeze({ path: file, version: new URLSearchParams(query).get('v') }));
    }
    return found;
}

const SCRIPT_ENTRIES = localRefs(/<script\s+src="(js\/[^"]+)"/g);
const LINK_ENTRIES = localRefs(/<link\s+rel="stylesheet"\s+href="(css\/[^"]+)"/g);
const SCRIPT_REFS = SCRIPT_ENTRIES.map(e => e.path);
const LINK_REFS = LINK_ENTRIES.map(e => e.path);

/** 側欄 footer 的版本號（例如 "4.15"），是 ?v= 的唯一來源。 */
const PAGE_VERSION = (INDEX_HTML.match(/Version\s+(\d+\.\d+)/) || [])[1] || null;

/**
 * 抓一個檔案的頂層宣告識別字。
 *
 * 只認第 0 欄（無縮排）的宣告——IIFE 包起來的模組內部都有縮排，不是全域。
 */
function topLevelIdentifiers(source) {
    const re = /^(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm;
    const names = [];
    for (const m of source.matchAll(re)) names.push(m[1]);
    return names;
}

// ---------------------------------------------------------------- (a) 語法
test('[structure] 每個 js/*.js 都通過 node --check', () => {
    assert.ok(JS_FILES.length > 0, 'js/ 目錄是空的？');
    for (const file of JS_FILES) {
        assert.doesNotThrow(
            () => execFileSync(process.execPath, ['--check', path.join(JS_DIR, file)],
                { stdio: 'pipe' }),
            `${file} 語法錯誤`
        );
    }
});

// ---------------------------------------------------------------- (b) 全域衝突
test('[structure] 跨檔沒有重複的頂層識別字（classic script 共用全域作用域）', () => {
    const owners = new Map();   // identifier -> [files]
    for (const file of JS_FILES) {
        const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
        for (const name of topLevelIdentifiers(source)) {
            if (!owners.has(name)) owners.set(name, []);
            const files = owners.get(name);
            if (!files.includes(file)) owners.set(name, [...files, file]);
        }
    }

    const clashes = [...owners.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([name, files]) => `${name} → ${files.join(', ')}`);

    assert.deepEqual(clashes, [],
        `重複的頂層宣告會在載入時 SyntaxError 讓整頁掛掉:\n  ${clashes.join('\n  ')}`);
});

test('[structure] 同一檔內也沒有重複的頂層識別字', () => {
    for (const file of JS_FILES) {
        const names = topLevelIdentifiers(fs.readFileSync(path.join(JS_DIR, file), 'utf8'));
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        assert.deepEqual([...new Set(dupes)], [], `${file} 內有重複宣告`);
    }
});

// ---------------------------------------------------------------- (c) index.html 引用
test('[structure] index.html 引用了每一個 js/*.js，且沒有重複', () => {
    assert.deepEqual([...SCRIPT_REFS].sort(), JS_FILES.map(f => `js/${f}`),
        '有檔案沒被引用（靜默失效）或引用了不存在的檔');
    assert.equal(new Set(SCRIPT_REFS).size, SCRIPT_REFS.length, '有重複的 <script>');
});

test('[structure] app.js 是最後一個載入的腳本（DOMContentLoaded 啟動點）', () => {
    assert.equal(SCRIPT_REFS[SCRIPT_REFS.length - 1], 'js/app.js');
});

test('[structure] 載入期就取值的檔排在其相依檔之後', () => {
    // app.js 頂層 `const safeStorage = FormUtils.safeLocal;` 在載入當下就求值
    const pos = name => SCRIPT_REFS.indexOf(name);
    assert.ok(pos('js/form-utils.js') >= 0, 'form-utils.js 未被引用');
    assert.ok(pos('js/form-utils.js') < pos('js/app.js'),
        'form-utils.js 必須在 app.js 之前');
});

test('[structure] index.html 引用了每一個 css/*.css，且沒有重複', () => {
    assert.deepEqual([...LINK_REFS].sort(), CSS_FILES.map(f => `css/${f}`),
        '有樣式檔沒被引用或引用了不存在的檔');
    assert.equal(new Set(LINK_REFS).size, LINK_REFS.length, '有重複的 <link>');
});

test('[structure] 每個本地 css/js 引用都帶 ?v=，且等於側欄版本號（避免 Pages 快取讓新 HTML 配舊檔）', () => {
    assert.ok(PAGE_VERSION, '找不到側欄 footer 的「Version X.Y」');
    const mismatched = [...SCRIPT_ENTRIES, ...LINK_ENTRIES]
        .filter(e => e.version !== PAGE_VERSION)
        .map(e => `${e.path}（?v=${e.version}）`);
    assert.deepEqual(mismatched, [],
        `本地引用的 ?v= 必須等於 ${PAGE_VERSION}；bump 版本時 footer 與 ?v= 要一起改`);
});

test('[structure] 沒有 @import：多一輪序列請求，改用多個 <link>', () => {
    for (const file of CSS_FILES) {
        const source = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
        assert.ok(!/^\s*@import/m.test(source), `${file} 使用了 @import`);
    }
});

// ---------------------------------------------------------------- 檔案大小預算
test('[structure] js/ 與 css/ 每個檔都 ≤ 800 行', () => {
    const oversized = [];
    for (const [dir, files] of [[JS_DIR, JS_FILES], [CSS_DIR, CSS_FILES]]) {
        for (const file of files) {
            const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').length;
            if (lines > MAX_LINES && !PENDING_SPLIT.includes(file)) {
                oversized.push(`${file}: ${lines} 行`);
            }
        }
    }
    assert.deepEqual(oversized, [], `超過 ${MAX_LINES} 行:\n  ${oversized.join('\n  ')}`);
});

test('[structure] 待拆名單沒有過期項目（拆完就要從名單移除）', () => {
    const stale = PENDING_SPLIT.filter(file => {
        const full = path.join(JS_DIR, file);
        if (!fs.existsSync(full)) return true;
        return fs.readFileSync(full, 'utf8').split('\n').length <= MAX_LINES;
    });
    assert.deepEqual(stale, [],
        `已經不超行（或不存在）了，請從 PENDING_SPLIT 移除: ${stale.join(', ')}`);
});

test('[structure] section-liposome.js 排在它呼叫的所有模組之後（liposome-*.js、alerts.js、dndc-export.js）', () => {
    const pos = name => SCRIPT_REFS.indexOf(name);
    const section = pos('js/section-liposome.js');
    assert.ok(section >= 0, 'section-liposome.js 未被引用');
    const deps = [
        ...JS_FILES.filter(f => f.startsWith('liposome-')).map(f => `js/${f}`),
        'js/alerts.js',
        'js/dndc-export.js',
    ];
    assert.ok(deps.length >= 6, `相依清單異常：${deps.join(', ')}`);
    for (const dep of deps) {
        assert.ok(pos(dep) >= 0, `${dep} 未被引用`);
        assert.ok(pos(dep) < section, `${dep} 必須排在 section-liposome.js 之前`);
    }
});

test('[structure] 拆出的分檔在 index.html 與 tests/load.js 都排在原檔之前', () => {
    const { LOAD_ORDER } = require('./load.js');
    const orders = [
        ['index.html', SCRIPT_REFS.map(ref => ref.replace(/^js\//, ''))],
        ['tests/load.js', [...LOAD_ORDER]],
    ];
    for (const [owner, parts] of Object.entries(SPLIT_GROUPS)) {
        for (const [label, order] of orders) {
            const ownerPos = order.indexOf(owner);
            assert.ok(ownerPos >= 0, `${label} 沒有載入 ${owner}`);
            for (const part of parts) {
                const partPos = order.indexOf(part);
                assert.ok(partPos >= 0, `${label} 沒有載入 ${part}`);
                assert.ok(partPos < ownerPos, `${label}：${part} 必須排在 ${owner} 之前`);
            }
        }
    }
});

test('[structure] tests/load.js 的載入順序與 index.html 的相對順序一致', () => {
    const { LOAD_ORDER } = require('./load.js');
    const pageOrder = SCRIPT_REFS.map(ref => ref.replace(/^js\//, ''));
    const missing = LOAD_ORDER.filter(file => !pageOrder.includes(file));
    assert.deepEqual(missing, [], `load.js 載入了 index.html 沒有引用的檔：${missing.join(', ')}`);
    const positions = LOAD_ORDER.map(file => pageOrder.indexOf(file));
    const outOfOrder = LOAD_ORDER.filter((file, i) => i > 0 && positions[i] < positions[i - 1]);
    assert.deepEqual(outOfOrder, [], `這些檔在 load.js 裡排得比 index.html 早：${outOfOrder.join(', ')}`);
});

// ---------------------------------------------------------------- v5.0 主題
test('[structure] theme-init.js：<head> 唯一的本地 script、同步載入、在 CSP 之後與所有 stylesheet 之前', () => {
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
    const headLocal = [...head.matchAll(/<script\s+src="(js\/[^"?]+)/g)].map(m => m[1]);
    assert.deepEqual(headLocal, ['js/theme-init.js']);

    const tags = [...head.matchAll(/<script\s[^>]*>/g)].map(m => m[0]);
    const blocking = tags.filter(tag => !/\b(?:defer|async)\b/.test(tag));
    assert.equal(blocking.length, 1, `<head> 只能有一個同步 script：${blocking.join(' ')}`);
    assert.match(blocking[0], /js\/theme-init\.js/);

    const at = head.indexOf('js/theme-init.js');
    assert.ok(head.indexOf('Content-Security-Policy') < at, 'theme-init.js 必須在 CSP meta 之後');
    assert.ok(at < head.indexOf('rel="stylesheet"'), 'theme-init.js 必須在第一個 stylesheet 之前（避免深色使用者看到淺色閃一下）');
});
