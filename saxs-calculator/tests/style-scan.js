'use strict';
/**
 * 靜態樣式掃描的共用工具：no-color-literals／token-usage／contrast／markup 測試共用。
 * 不是測試檔（檔名不以 .test.js 結尾），node --test 不會直接執行它。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** 讀 saxs-calculator/ 底下的相對路徑。 */
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 列出某目錄下某副檔名的檔案，回傳 'dir/file' 形式的相對路徑（排序過）。 */
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith(ext)).sort().map(f => `${dir}/${f}`);

const CSS_FILES = Object.freeze(list('css', '.css'));
const JS_FILES = Object.freeze(list('js', '.js'));

const stripCssComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtmlComments = src => src.replace(/<!--[\s\S]*?-->/g, '');
/** 去掉 JS 的區塊註解與行註解；`://`（網址）前面是冒號，不會被當成註解。 */
const stripJsComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** 依副檔名去掉註解。 */
function stripComments(rel, src) {
    if (rel.endsWith('.css')) return stripCssComments(src);
    if (rel.endsWith('.html')) return stripHtmlComments(src);
    return stripJsComments(src);
}

/** 讀檔並去掉註解。 */
const readCode = rel => stripComments(rel, read(rel));

/** 解析 `--name: value;` 宣告成 Map（只看傳入的區塊內文）。 */
function parseCustomProperties(body) {
    const map = new Map();
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
    return map;
}

/** 取出 `selector {` 之後、配對的 `}` 之前的內文（selector 必須逐字出現）。 */
function blockBody(src, selector) {
    const start = src.indexOf(`${selector} {`);
    if (start < 0) return null;
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') depth--;
        if (depth === 0) return src.slice(open + 1, i);
    }
    return null;
}

/** 列出最內層的 CSS 規則 { selector, body }（@media 內的規則也會列出）。 */
function cssRules(src) {
    const rules = [];
    for (const m of stripCssComments(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        rules.push(Object.freeze({ selector: m[1].trim(), body: m[2] }));
    }
    return rules;
}

/**
 * index.html 裡 JS 與測試賴以取元素的屬性（id、for、data-section、aria-*），以「屬性=值」計數。
 * 改版規格 §8.2 的標記不變測試與其 fixture 產生指令共用這個函式。
 */
function markupCounts(html) {
    const counts = {};
    for (const m of stripHtmlComments(html).matchAll(/\s(id|for|data-section|aria-[\w-]+)="([^"]*)"/g)) {
        const key = `${m[1]}=${m[2]}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = {
    ROOT,
    read,
    readCode,
    CSS_FILES,
    JS_FILES,
    stripComments,
    parseCustomProperties,
    blockBody,
    cssRules,
    markupCounts,
};
