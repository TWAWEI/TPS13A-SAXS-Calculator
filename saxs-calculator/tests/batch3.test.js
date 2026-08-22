'use strict';
/**
 * Regression tests for the 2026-08-22 batch-3 fixes (JS hygiene / security).
 *
 * 兩類測試：
 *   1. 行為測試 — FormUtils.escapeHtml（H2）、baselineCorrect / measurePeak 的
 *      未知 mode（H6）。
 *   2. 原始碼不變量 — CDN 鎖版本 + SRI（H1）、CSP meta（H8）、
 *      「不得有第二份跳脫實作」（H2）、「不得有行內事件處理器」（H8）。
 *      這幾條在瀏覽器裡才會出事（載入被擋、按鈕沒反應），單元測試看不到，
 *      所以用靜態掃描把規則釘住。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Dndc, FormUtils } = require('./load.js');

const ROOT = path.join(__dirname, '..');
const readSrc = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

// 動態列舉：拆檔後再新增 js 檔也會自動納入這些靜態掃描
const JS_FILES = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(f => f.endsWith('.js')).sort().map(f => `js/${f}`);

// ---------------------------------------------------------------- [51/68] escapeHtml
test('[51] escapeHtml: 五個 HTML 特殊字元全部跳脫（含 " 與 \'）', () => {
    assert.equal(FormUtils.escapeHtml('<'), '&lt;');
    assert.equal(FormUtils.escapeHtml('>'), '&gt;');
    assert.equal(FormUtils.escapeHtml('&'), '&amp;');
    assert.equal(FormUtils.escapeHtml('"'), '&quot;');
    assert.equal(FormUtils.escapeHtml("'"), '&#39;');
});

test('[51] escapeHtml: & 先跳脫，不會產生雙重解碼', () => {
    assert.equal(FormUtils.escapeHtml('&lt;'), '&amp;lt;');
    assert.equal(FormUtils.escapeHtml('a&b<c>d'), 'a&amp;b&lt;c&gt;d');
});

test('[51] escapeHtml: CSV 標頭的 XSS payload 不再含可執行標記', () => {
    const evil = '<img src=x onerror=window.__xss=1>';
    const escaped = FormUtils.escapeHtml(evil);
    assert.equal(escaped, '&lt;img src=x onerror=window.__xss=1&gt;');
    assert.ok(!escaped.includes('<'), '不得留下 <');
    assert.ok(!escaped.includes('>'), '不得留下 >');
});

test('[68] escapeHtml: 屬性位置的引號跳出攻擊被擋下', () => {
    // .afe7 樣品名塞進 aria-label="…" / value="…"：舊版的 textContent→innerHTML
    // 技巧不會跳脫引號，這個 payload 可以直接關掉屬性再開一個事件處理器
    const evil = '" onmouseover="window.__xss=1';
    const escaped = FormUtils.escapeHtml(evil);
    assert.ok(!escaped.includes('"'), `屬性仍可被跳出: ${escaped}`);
    assert.equal(escaped, '&quot; onmouseover=&quot;window.__xss=1');
});

test('[51] escapeHtml: null / undefined 回空字串，數字照樣轉字串', () => {
    assert.equal(FormUtils.escapeHtml(null), '');
    assert.equal(FormUtils.escapeHtml(undefined), '');
    assert.equal(FormUtils.escapeHtml(0), '0');
    assert.equal(FormUtils.escapeHtml(1.5e-6), '0.0000015');
});

test('[51] escapeHtml: 乾淨字串原樣回傳（不影響正常欄位名顯示）', () => {
    assert.equal(FormUtils.escapeHtml('UV 280 nm (mAU)'), 'UV 280 nm (mAU)');
    assert.equal(FormUtils.escapeHtml('dRI (RIU)'), 'dRI (RIU)');
});

test('[51] escapeHtml 只有一份實作：任一 js/*.js 不得再自建 div.innerHTML', () => {
    for (const file of JS_FILES) {
        const src = readSrc(file);
        assert.ok(!/textContent\s*=\s*\w+;\s*\n\s*return\s+\w+\.innerHTML/.test(src),
            `${file} 仍有自己的 textContent→innerHTML 跳脫實作`);
    }
    // 兩個舊名稱都必須轉呼叫 FormUtils.escapeHtml（拆檔後不再綁定在哪一個檔）
    const allJs = JS_FILES.map(readSrc).join('\n');
    assert.match(allJs,
        /function escapeHtml\(text\) \{\s*return FormUtils\.escapeHtml\(text\);/);
    assert.match(allJs,
        /function escapeHtmlDndc\(text\) \{\s*return FormUtils\.escapeHtml\(text\);/);
});

// ---------------------------------------------------------------- [90] 未知 mode
test('[90] baselineCorrect: 未知 mode throw，不靜默當成 linear', () => {
    const time = [0, 1, 2, 3, 4, 5];
    const signal = [1, 1, 5, 5, 1, 1];
    const bl1 = [true, true, false, false, false, false];
    const bl2 = [false, false, false, false, true, true];

    assert.throws(() => Dndc.baselineCorrect(time, signal, 'quadratic', bl1, bl2),
        /未知的 mode "quadratic"/);
    assert.throws(() => Dndc.baselineCorrect(time, signal, undefined, bl1, bl2),
        /未知的 mode/);
    assert.throws(() => Dndc.baselineCorrect(time, signal, 'Const', bl1, bl2),
        /未知的 mode/, '大小寫必須嚴格比對');
});

test('[90] baselineCorrect: const / linear 仍照常運作', () => {
    const time = [0, 1, 2, 3, 4, 5];
    const signal = [1, 1, 5, 5, 1, 1];
    const bl1 = [true, true, false, false, false, false];
    const bl2 = [false, false, false, false, true, true];

    const constCorrected = Dndc.baselineCorrect(time, signal, 'const', bl1, bl2);
    assert.deepEqual(constCorrected, [0, 0, 4, 4, 0, 0]);

    const linearCorrected = Dndc.baselineCorrect(time, signal, 'linear', bl1, bl2);
    assert.equal(linearCorrected.length, signal.length);
    assert.ok(Math.abs(linearCorrected[0]) < 1e-12);
});

test('[90] measurePeak: 未知 mode throw，不回 undefined 的 value', () => {
    const signal = [0, 1, 2, 1, 0];
    const time = [0, 1, 2, 3, 4];
    const mask = [true, true, true, true, true];

    assert.throws(() => Dndc.measurePeak(signal, time, mask, 'peakarea'),
        /未知的 mode "peakarea"/);
    assert.throws(() => Dndc.measurePeak(signal, time, mask, undefined), /未知的 mode/);
    // 物件查表的原型鏈漏洞：valueMap['constructor'] 本來會回 Object 建構子
    assert.throws(() => Dndc.measurePeak(signal, time, mask, 'constructor'), /未知的 mode/);
});

test('[90] measurePeak: height / area / spi 仍照常運作', () => {
    const signal = [0, 1, 2, 1, 0];
    const time = [0, 1, 2, 3, 4];
    const mask = [true, true, true, true, true];

    assert.equal(Dndc.measurePeak(signal, time, mask, 'height').value, 2);
    assert.equal(Dndc.measurePeak(signal, time, mask, 'area').value, 4);
    assert.equal(Dndc.measurePeak(signal, time, mask, 'spi').value, 2);
});

// ---------------------------------------------------------------- [50] CDN 鎖版本 + SRI
test('[50] index.html：所有 jsdelivr <script> 都鎖確切版本並帶 SRI', () => {
    const html = readSrc('index.html');
    const tags = html.match(/<script[^>]*cdn\.jsdelivr\.net[^>]*>/g) || [];
    assert.equal(tags.length, 4, '預期四支 CDN script');

    for (const tag of tags) {
        const src = (tag.match(/src="([^"]+)"/) || [])[1];
        assert.ok(src, `找不到 src: ${tag}`);
        // 確切版本（@x.y.z）+ 完整檔名（.js）：短網址的 302 目標會隨新版變動
        assert.match(src, /@\d+\.\d+\.\d+\//, `未鎖版本或未帶完整路徑: ${src}`);
        assert.match(src, /\.js$/, `未帶完整檔名: ${src}`);
        assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]+"/, `缺少 SRI: ${src}`);
        assert.match(tag, /crossorigin="anonymous"/, `缺少 crossorigin: ${src}`);
    }
});

// ---------------------------------------------------------------- [107] CSP
test('[107] index.html：CSP meta 存在且 script-src 不含 unsafe-inline/eval', () => {
    const html = readSrc('index.html');
    const meta = (html.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/) || [])[0];
    assert.ok(meta, '缺少 CSP meta');

    const content = (meta.match(/content="([^"]+)"/) || [])[1];
    assert.ok(content, 'CSP meta 沒有 content');

    for (const directive of ['default-src', 'script-src', 'style-src', 'connect-src',
        'img-src', 'object-src', 'base-uri', 'form-action']) {
        assert.ok(content.includes(directive), `CSP 缺少 ${directive}`);
    }

    const scriptSrc = content.split(';').find(d => d.trim().startsWith('script-src'));
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src 不得有 'unsafe-inline'");
    assert.ok(!/'unsafe-eval'/.test(scriptSrc), "script-src 不得有 'unsafe-eval'");
    assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"), 'sql.js 需要 wasm-unsafe-eval');
    assert.ok(content.includes('connect-src \'self\' https://cdn.jsdelivr.net'),
        'sql.js 抓 .wasm 需要 connect-src 允許 jsdelivr');
});

test('[107] 全站不得有行內事件處理器（CSP 會靜默擋掉，按了沒反應）', () => {
    const files = ['index.html', ...JS_FILES];
    const inlineHandler = /<[a-z][^>]*\son(?:click|change|input|submit|load|error|focus|blur|keydown|keyup|mouseover|mouseout)\s*=/i;

    for (const file of files) {
        // HTML 註解裡提到 <script> / onclick="" 是說明文字，不會執行
        const src = readSrc(file).replace(/<!--[\s\S]*?-->/g, '');
        assert.ok(!inlineHandler.test(src), `${file} 有行內事件處理器`);

        // 行內 <script>：有 body 卻沒有 src 的都算（CSP 沒有 'unsafe-inline' 會被擋）。
        // 只掃 HTML；.js 檔裡的 "<script>" 只會出現在註解或 createElement 字串。
        if (!file.endsWith('.html')) continue;
        for (const block of src.match(/<script\b[^>]*>[^<]*/g) || []) {
            const openTag = block.slice(0, block.indexOf('>') + 1);
            const body = block.slice(openTag.length);
            if (body.trim() === '') continue;
            assert.ok(/\bsrc=/.test(openTag), `${file} 有行內 <script> 區塊: ${openTag}`);
        }
    }
});
