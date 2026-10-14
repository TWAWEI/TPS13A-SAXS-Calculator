'use strict';
/**
 * Token 用途測試（改版規格 §3.2、§3.3 規則 3–4、§8.1-2）。
 *
 *   1. 每個 var(--x) 都要在 tokens.css 定義過——改名後漏改的舊名在瀏覽器裡會靜默變成初始值（通常是透明或黑色）。
 *   2. 文字色（CSS 的 color:、行內 style 的 color:、style.color =）只能用文字 token。
 *      填色 token（--color-accent-primary、--color-success…）在深色下當文字只有 3:1 上下。
 *   3. 用 --color-text-on-accent（白字）的規則，背景必須是 accent-primary／-hover／danger 其中之一。
 *   4. 不加左側色條（§3.3 規則 6）：任何 border-left 宣告都不行（CSS 與行內 style 都算）。
 *
 * PENDING_TOKEN_FILES 是棘輪名單：v5.0 改版期間暫時允許違規的檔案；名單內的檔案必須確實還有違規。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, readCode, CSS_FILES, JS_FILES, parseCustomProperties, cssRules } = require('./style-scan.js');

const PENDING_TOKEN_FILES = Object.freeze([
    'css/components.css',
    'css/layout.css',
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);

// 執行時才由 JS 設定的自訂屬性（不在 tokens.css）
const RUNTIME_PROPERTIES = Object.freeze(['--chip-color']);

const DEFINED = new Set([...parseCustomProperties(readCode('css/tokens.css')).keys(), ...RUNTIME_PROPERTIES]);

const TEXT_VALUE = /^(?:inherit|currentColor|transparent|var\(--color-(?:text-[\w-]+|accent-text|(?:success|warning|danger)-text)\))(?:\s*!important)?$/;
const ON_ACCENT_BACKGROUND = /background(?:-color)?\s*:\s*var\(--color-(?:accent-primary|accent-primary-hover|danger)\)/;

const ALL_FILES = Object.freeze([...CSS_FILES, ...JS_FILES, 'index.html']);

function undefinedVars(file) {
    const used = [...readCode(file).matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
    return [...new Set(used.filter(name => !DEFINED.has(name)))].map(name => `未定義 ${name}`);
}

/** 檔案裡所有「文字色」的值。 */
function textColorValues(file) {
    const code = readCode(file);
    const values = [];
    if (file.endsWith('.css')) {
        for (const m of code.matchAll(/(?:^|[{;\s])color\s*:\s*([^;}]+)/g)) values.push(m[1].trim());
        return values;
    }
    // index.html 與 JS 模板字串裡的行內 style="…"
    for (const m of code.matchAll(/style="([^"]*)"/g)) {
        for (const d of m[1].matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)) values.push(d[1].trim());
    }
    // element.style.color = …（空字串＝清除，允許）
    for (const m of code.matchAll(/\.style\.color\s*=\s*([^;\n]+)/g)) {
        const raw = m[1].trim();
        if (raw === "''" || raw === '""') continue;
        values.push(raw.replace(/^['"`]|['"`]$/g, ''));
    }
    for (const m of code.matchAll(/setProperty\(\s*['"]color['"]\s*,\s*([^)]+)\)/g)) values.push(m[1].trim());
    return values;
}

function badTextColors(file) {
    return textColorValues(file).filter(v => !TEXT_VALUE.test(v)).map(v => `文字色 ${v}`);
}

function badOnAccent(file) {
    if (!file.endsWith('.css')) return [];
    return cssRules(read(file))
        .filter(r => /color\s*:\s*var\(--color-text-on-accent\)/.test(r.body) && !ON_ACCENT_BACKGROUND.test(r.body))
        .map(r => `白字沒有配強調色底：${r.selector}`);
}

function leftBars(file) {
    const hits = [...readCode(file).matchAll(/border-left(?:-color|-width|-style)?\s*:\s*([^;"}]+)/g)];
    return hits.map(m => `左側色條 border-left: ${m[1].trim()}`);
}

function violations(file) {
    return [...undefinedVars(file), ...badTextColors(file), ...badOnAccent(file), ...leftBars(file)];
}

test('[tokens] var() 只引用已定義的 token；文字色只用文字 token；白字只放在強調色底上；沒有左側色條', () => {
    const offenders = ALL_FILES
        .filter(file => !PENDING_TOKEN_FILES.includes(file))
        .map(file => [file, violations(file)])
        .filter(([, v]) => v.length > 0)
        .map(([file, v]) => `${file}: ${v.join('；')}`);
    assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('[tokens] 棘輪名單沒有過期項目（改乾淨就要移出名單）', () => {
    const stale = PENDING_TOKEN_FILES.filter(file => violations(file).length === 0);
    assert.deepEqual(stale, [], `已無違規，請從 PENDING_TOKEN_FILES 移除: ${stale.join(', ')}`);
});
