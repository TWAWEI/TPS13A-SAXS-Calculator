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

// 尚未拆分的計算模組（batch 3 的範圍是 app.js / dndc-ui.js / styles.css）。
// 這是「棘輪」名單：下面的測試會同時檢查名單內的檔案『確實還是超行』，
// 拆完之後不移除名單就會失敗，債務不會被默默留著。
const PENDING_SPLIT = Object.freeze(['calculations.js', 'dndc-calculations.js']);

const listFiles = (dir, ext) =>
    fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort();

const JS_FILES = listFiles(JS_DIR, '.js');
const CSS_FILES = listFiles(CSS_DIR, '.css');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** 依 index.html 出現順序取出本地資源清單（跳過 CDN）。 */
function localRefs(pattern) {
    const found = [];
    for (const m of INDEX_HTML.matchAll(pattern)) found.push(m[1]);
    return found;
}

const SCRIPT_REFS = localRefs(/<script\s+src="(js\/[^"]+)"/g);
const LINK_REFS = localRefs(/<link\s+rel="stylesheet"\s+href="(css\/[^"]+)"/g);

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
