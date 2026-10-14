'use strict';
/**
 * 色碼字面值只能出現在 css/tokens.css 與 js/chart-theme.js（改版規格 §3.3 規則 5）。
 * 其他地方寫死的顏色在深色模式下不會跟著換，這是深色模式最常見的漏網之魚。
 *
 * PENDING_LITERAL_FILES 是棘輪名單：v5.0 改版期間暫時允許的檔案。名單內的檔案必須「確實還有」
 * 字面值（清乾淨了就要移出名單），名單外的檔案一個都不能有。v5.0 完成時名單為空。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCode, CSS_FILES, JS_FILES } = require('./style-scan.js');

const EXEMPT = Object.freeze(['css/tokens.css', 'js/chart-theme.js']);

const PENDING_LITERAL_FILES = Object.freeze([
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
]);

// #hex（前面不能是 & 或字母數字，排除 &#10; 這類 HTML 實體）與顏色函式。transparent／currentColor／inherit 允許。
const COLOR_LITERAL = /(?<![&\w])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g;

const SCANNED = Object.freeze([...CSS_FILES, ...JS_FILES, 'index.html'].filter(f => !EXEMPT.includes(f)));

function literalsIn(file) {
    return [...readCode(file).matchAll(COLOR_LITERAL)].map(m => m[0]);
}

test('[colors] 色碼字面值只出現在 tokens.css 與 chart-theme.js（棘輪名單除外）', () => {
    const offenders = SCANNED
        .filter(file => !PENDING_LITERAL_FILES.includes(file))
        .map(file => [file, literalsIn(file)])
        .filter(([, hits]) => hits.length > 0)
        .map(([file, hits]) => `${file}: ${[...new Set(hits)].join(' ')}`);
    assert.deepEqual(offenders, [], `改用 var(--…) 或 class:\n  ${offenders.join('\n  ')}`);
});

test('[colors] 棘輪名單沒有過期項目（清乾淨就要移出名單）', () => {
    const stale = PENDING_LITERAL_FILES.filter(file => literalsIn(file).length === 0);
    assert.deepEqual(stale, [], `已經沒有色碼字面值，請從 PENDING_LITERAL_FILES 移除: ${stale.join(', ')}`);
});
