'use strict';
/**
 * 標記不變測試（改版規格 §8.2）：JS 與測試都靠 id、for、aria-*、data-section 取元素。
 * 改版只能換 class 與包裝層，這四類屬性必須與 v4.15 的 index.html 完全相同；
 * 唯一允許的新增是側欄的主題切換控制，唯一允許的改名是 v5.1 分子量改 kDa 的 aria-label。
 *
 * fixture（tests/fixtures/markup-v4.15.json）由 v4.15（commit 6b02fbe）的 index.html 產生：
 *   node -e "const {markupCounts}=require('./saxs-calculator/tests/style-scan.js');const html=require('child_process').execSync('git show 6b02fbe:saxs-calculator/index.html').toString();require('fs').writeFileSync('saxs-calculator/tests/fixtures/markup-v4.15.json', JSON.stringify(markupCounts(html), null, 2)+'\n')"
 * v5.2（結果磚）補 aria-live 時要更新 fixture，並在 commit 訊息說明。
 *
 * 區段規則（SAS 模型擬合規格 §3.3 第 2 點）：該功能新增的標記一律包在成對註解
 * <!-- sasfit:begin -->、<!-- sasfit:end --> 之間。比對 fixture 之前先在「原始 HTML」上把這些區段切掉
 * （markupCounts 第一步就剝掉註解，順序反過來標記就不見了），其餘仍須與 v4.15 完全相同。
 * 區段的數目與順序由 REGION_SIGNATURES 決定：之後新增區段只在清單尾端加一個簽名。
 * 區段內可以自由使用 id 與 aria-*，由本檔後半的測試約束（id 不重複、不與區段外衝突、前綴、標籤、參照）。
 * fixture 不得為了這個功能重產。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, markupCounts } = require('./style-scan.js');

const FIXTURE = JSON.parse(read('tests/fixtures/markup-v4.15.json'));

const ALLOWED_ADDITIONS = Object.freeze({
    'id=themeToggle': 1,
    'id=themeAuto': 1,
    'id=themeLight': 1,
    'id=themeDark': 1,
    'for=themeAuto': 1,
    'for=themeLight': 1,
    'for=themeDark': 1,
});

// v5.1：分子量單位改 kDa（docs/superpowers/specs/2026-10-15-kda-units-design.md §4）
const ALLOWED_RENAMES = Object.freeze({
    'aria-label=分子量 MW (kDa)': 'aria-label=分子量 MW (Da)',
});

const BEGIN = '<!-- sasfit:begin -->';
const END = '<!-- sasfit:end -->';
const LOOSE_MARKER = /<!--\s*sasfit:(?:begin|end)\s*-->/g;

/** 依文件順序，每個區段必須含對應的字串（M3：側欄按鈕、整個分頁）。 */
const REGION_SIGNATURES = Object.freeze(['data-section="sasfit"', 'id="section-sasfit"']);

/** 區段內允許的 id：分頁本身，或規格 §5 的前綴 sf。 */
const REGION_ID = /^(?:section-sasfit|sf[A-Z]\w*)$/;

/** 指向其他元素 id 的屬性（值可以是以空白分隔的多個 id）。 */
const REFERENCE_ATTRIBUTES = Object.freeze(['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']);

const countOf = (text, needle) => text.split(needle).length - 1;

/**
 * 把原始 HTML（未去註解）切成區段外與各區段的內文。
 * 標記不成對、順序顛倒或巢狀時丟 Error。
 *
 * @param {string} html - 原始 HTML
 * @returns {{outside: string, regions: string[]}} 區段外的字串（各區段連同兩個標記切掉後接起來）與各區段內文
 */
function splitRegions(html) {
    const regions = [];
    const kept = [];
    let pos = 0;
    for (;;) {
        const begin = html.indexOf(BEGIN, pos);
        const strayEnd = html.indexOf(END, pos);
        if (begin < 0) {
            if (strayEnd >= 0) throw new Error('sasfit:end 前面沒有對應的 sasfit:begin');
            kept.push(html.slice(pos));
            return Object.freeze({ outside: kept.join(''), regions: Object.freeze(regions) });
        }
        if (strayEnd >= 0 && strayEnd < begin) throw new Error('sasfit:end 前面沒有對應的 sasfit:begin');
        const inner = begin + BEGIN.length;
        const end = html.indexOf(END, inner);
        if (end < 0) throw new Error('sasfit:begin 沒有對應的 sasfit:end');
        const nested = html.indexOf(BEGIN, inner);
        if (nested >= 0 && nested < end) throw new Error('sasfit 區段不得巢狀');
        kept.push(html.slice(pos, begin));
        regions.push(html.slice(inner, end));
        pos = end + END.length;
    }
}

const stripHtmlComments = src => src.replace(/<!--[\s\S]*?-->/g, '');

/** 某個屬性在一段 HTML 裡的全部值（依出現順序）。 */
function attributeValues(html, name) {
    return [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(m => m[1]);
}

/** 一段 HTML 裡的表單控制項：{ tag, id, labelled }。 */
function formControls(html) {
    return [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => Object.freeze({
        tag: m[0],
        id: (m[0].match(/\sid="([^"]*)"/) || [])[1] || null,
        labelled: /\saria-label(?:ledby)?="[^"]+"/.test(m[0]),
    }));
}

const PAGE = read('index.html');
const SPLIT = splitRegions(PAGE);
const REGIONS = SPLIT.regions.map(stripHtmlComments);
const OUTSIDE = stripHtmlComments(SPLIT.outside);

/** 把改名後的鍵換回 fixture 裡的舊名再比對 */
function undoRenames(counts) {
    return Object.entries(counts).reduce((acc, [key, n]) => {
        const original = ALLOWED_RENAMES[key] || key;
        return { ...acc, [original]: (acc[original] || 0) + n };
    }, {});
}

test('[markup] id／for／aria-*／data-section 與 v4.15 相同（只多了主題切換控制、改了分子量單位；sasfit 區段除外）', () => {
    const current = undoRenames(markupCounts(SPLIT.outside));
    const keys = new Set([...Object.keys(FIXTURE), ...Object.keys(current)]);
    const problems = [];
    for (const key of keys) {
        const diff = (current[key] || 0) - (FIXTURE[key] || 0);
        if (diff < 0) problems.push(`少了 ${key}（${-diff} 個）`);
        if (diff > 0 && diff > (ALLOWED_ADDITIONS[key] || 0)) problems.push(`多了 ${key}（${diff} 個）`);
    }
    assert.deepEqual(problems, []);
});

test('[markup] fixture 本身沒被清空', () => {
    assert.ok(Object.keys(FIXTURE).length > 300, `fixture 只有 ${Object.keys(FIXTURE).length} 筆，看起來不對`);
});

// ---------------------------------------------------------------- sasfit 區段規則
test('[markup] splitRegions：切掉成對的區段；不成對、順序顛倒、巢狀都丟 Error', () => {
    const two = splitRegions(`a${BEGIN}one${END}b${BEGIN}two${END}c`);
    assert.equal(two.outside, 'abc');
    assert.deepEqual([...two.regions], ['one', 'two']);
    assert.deepEqual([...splitRegions('plain').regions], []);
    assert.equal(splitRegions('plain').outside, 'plain');
    assert.throws(() => splitRegions(`a${BEGIN}b${BEGIN}c${END}d${END}`), /巢狀/);
    assert.throws(() => splitRegions(`a${BEGIN}b${BEGIN}c${END}`), /巢狀/);
    assert.throws(() => splitRegions(`a${BEGIN}b`), /沒有對應的 sasfit:end/);
    assert.throws(() => splitRegions(`a${END}b`), /沒有對應的 sasfit:begin/);
    assert.throws(() => splitRegions(`a${END}b${BEGIN}c${END}`), /沒有對應的 sasfit:begin/);
    assert.throws(() => splitRegions(`a${BEGIN}b${END}c${END}`), /沒有對應的 sasfit:begin/);
});

test('[markup] sasfit 區段：成對標記的數目與順序等於 REGION_SIGNATURES，每段含自己的簽名', () => {
    assert.equal((PAGE.match(LOOSE_MARKER) || []).length, countOf(PAGE, BEGIN) + countOf(PAGE, END),
        '有寫法不完全相同的 sasfit 標記（多一個空白？）——只接受逐字相同的寫法');
    assert.equal(SPLIT.regions.length, REGION_SIGNATURES.length,
        `預期 ${REGION_SIGNATURES.length} 個區段，實際 ${SPLIT.regions.length} 個`);
    REGION_SIGNATURES.forEach((signature, i) => {
        assert.ok(REGIONS[i].includes(signature), `第 ${i + 1} 個區段應含 ${signature}`);
    });
});

test('[markup] sasfit 區段：id 不重複（跨區段也不重複），也不與區段外的 id 衝突', () => {
    const ids = REGIONS.flatMap(region => attributeValues(region, 'id'));
    assert.ok(ids.length > 0, '區段內沒有任何 id');
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual([...new Set(duplicated)], [], '區段內有重複的 id');
    const outside = new Set(attributeValues(OUTSIDE, 'id'));
    assert.deepEqual(ids.filter(id => outside.has(id)), [], '區段內的 id 與區段外的衝突');
});

test('[markup] sasfit 區段：id 只能是 section-sasfit 或 sf 前綴', () => {
    const ids = REGIONS.flatMap(region => attributeValues(region, 'id'));
    assert.ok(ids.includes('section-sasfit'), '區段內找不到 section-sasfit');
    assert.deepEqual(ids.filter(id => !REGION_ID.test(id)), []);
});

test('[markup] sasfit 區段：每個表單控制項都有 id 與標籤；for／aria-controls／aria-labelledby／aria-describedby 指到的 id 都在區段內', () => {
    const all = REGIONS.join('\n');
    const ids = new Set(attributeValues(all, 'id'));
    const labelTargets = new Set(attributeValues(all, 'for'));
    const controls = formControls(all);
    assert.ok(controls.length > 0, '區段內沒有任何表單控制項');
    assert.deepEqual(controls.filter(c => c.id === null).map(c => c.tag), [], '表單控制項沒有 id');
    assert.deepEqual(controls.filter(c => c.id !== null && !c.labelled && !labelTargets.has(c.id)).map(c => c.id), [],
        '表單控制項沒有標籤（需要 <label for> 或 aria-label／aria-labelledby）');
    const dangling = REFERENCE_ATTRIBUTES.flatMap(name => attributeValues(all, name)
        .flatMap(value => value.split(/\s+/).filter(Boolean))
        .filter(id => !ids.has(id))
        .map(id => `${name}=${id}`));
    assert.deepEqual(dangling, [], '指到區段內不存在的 id');
});

test('[markup] sasfit 區段：data-section="sasfit" 全文件恰好一次；區段內沒有行內 style', () => {
    assert.equal(countOf(stripHtmlComments(PAGE), 'data-section="sasfit"'), 1);
    REGIONS.forEach((region, i) => {
        assert.ok(!/\sstyle="/.test(region), `第 ${i + 1} 個區段有行內 style`);
    });
});

test('[markup] sasfit 區段：沒有事件處理屬性、<script>、javascript: 與帶 href 的 <a>（模型文件連結由 JS 建立）', () => {
    assert.ok(REGIONS.length > 0);
    REGIONS.forEach((region, i) => {
        const label = `區段 ${i + 1}`;
        assert.doesNotMatch(region, /<[^>]*\son[a-z]+\s*=/i, `${label}：不得有 on*= 屬性（CSP；事件一律 addEventListener）`);
        assert.doesNotMatch(region, /<\s*script\b/i, `${label}：不得有 <script>`);
        assert.doesNotMatch(region, /javascript\s*:/i, `${label}：不得有 javascript: 網址`);
        assert.doesNotMatch(region, /<a\b[^>]*\shref\s*=/i, `${label}：不得有帶 href 的 <a>`);
    });
    // 規則本身抓得到這四種寫法
    const bad = ['<button onclick="x()">', '<div ONLOAD = "x">', '<script src="a.js">', '<a href="javascript:alert(1)">', '<a class="x" href="https://e.org">'];
    const rules = [/<[^>]*\son[a-z]+\s*=/i, /<\s*script\b/i, /javascript\s*:/i, /<a\b[^>]*\shref\s*=/i];
    bad.forEach((html) => assert.ok(rules.some((rule) => rule.test(html)), html));
    assert.ok(!rules.some((rule) => rule.test('<a id="sfDocs" role="link">文件</a><p data-on="1">section</p>')));
});
