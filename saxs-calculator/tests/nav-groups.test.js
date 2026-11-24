'use strict';
/**
 * 側欄分組（v5.4）：三個群組的標題、順序，以及每個群組有哪些 data-section（依文件順序）。
 * v5.5：dn/dc 解鎖鈕改用一般項目的外觀（.nav-item.nav-item--lock），不再是按鈕式的小標題。
 *   13A 工具 → 計算工具（含上鎖的 dn/dc 子群組）→ 輸出
 * dn/dc 的解鎖鈕與四個項目必須留在「計算工具」群組裡面，id 與 aria 屬性不變（js/dndc-lock.js 靠它們）。
 *
 * 靜態解析 index.html 的 <nav class="sidebar-nav">；屬性數目另由 tests/markup.test.js 對 v4.15 fixture 把關。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCode } = require('./style-scan.js');

const EXPECTED_GROUPS = Object.freeze([
    Object.freeze({
        title: '13A 工具',
        sections: Object.freeze(['protein', 'saxs', 'hplc', 'sample', 'mw', 'centrifuge', 'detector']),
    }),
    Object.freeze({
        title: '計算工具',
        sections: Object.freeze(['sasfit', 'liposome', 'dndc-theory', 'dndc-hplc', 'dndc-multi', 'dndc-slice']),
    }),
    Object.freeze({ title: '輸出', sections: Object.freeze(['iucr']) }),
]);
const DNDC_SECTIONS = Object.freeze(['dndc-theory', 'dndc-hplc', 'dndc-multi', 'dndc-slice']);

const GROUP_OPEN = '<div class="nav-section">';

/** <nav class="sidebar-nav"> 的內文（已去註解）。 */
function navHtml() {
    const page = readCode('index.html');
    const start = page.indexOf('<nav class="sidebar-nav"');
    const end = page.indexOf('</nav>', start);
    assert.ok(start >= 0 && end > start, '找不到 <nav class="sidebar-nav">');
    return page.slice(page.indexOf('>', start) + 1, end);
}

/** 某段 HTML 裡的 data-section 值（依出現順序）。 */
const sectionsIn = html => [...html.matchAll(/\sdata-section="([^"]*)"/g)].map(m => m[1]);

/** 把 nav 內文切成最上層群組：{ title, sections, html }。 */
function navGroups(nav) {
    return nav.split(GROUP_OPEN).slice(1).map((html) => {
        const title = html.match(/^\s*<div class="nav-section-title"[^>]*>([^<]*)<\/div>/);
        return Object.freeze({ title: title ? title[1].trim() : null, sections: sectionsIn(html), html });
    });
}

const NAV = navHtml();
const GROUPS = navGroups(NAV);

test('[nav-groups] 三個群組：標題與順序是 13A 工具 → 計算工具 → 輸出', () => {
    assert.deepEqual(GROUPS.map(g => g.title), EXPECTED_GROUPS.map(g => g.title));
    assert.equal(NAV.split(GROUP_OPEN)[0].trim(), '', '第一個群組之前不應有其他內容');
});

test('[nav-groups] 每個群組的 data-section 與順序', () => {
    GROUPS.forEach((group, i) => {
        assert.deepEqual(group.sections, [...EXPECTED_GROUPS[i].sections], `群組「${group.title}」`);
    });
});

test('[nav-groups] 每個 data-section 在側欄恰好出現一次，而且都有對應的分頁', () => {
    const all = sectionsIn(NAV);
    assert.deepEqual(all, EXPECTED_GROUPS.flatMap(g => g.sections));
    assert.equal(new Set(all).size, all.length);
    const page = readCode('index.html');
    assert.deepEqual(all.filter(name => !page.includes(`id="section-${name}"`)), [], '側欄項目沒有對應的 #section-*');
});

test('[nav-groups] 群組標題都是純文字標題（不是按鈕）：dn/dc 解鎖鈕不再借用標題樣式（v5.5）', () => {
    const titles = [...NAV.matchAll(/<(div|button)\b[^>]*class="nav-section-title[^"]*"[^>]*>([^<]*)</g)]
        .map(m => `${m[1]}:${m[2].trim()}`);
    assert.deepEqual(titles, ['div:13A 工具', 'div:計算工具', 'div:輸出']);
});

test('[nav-groups] dn/dc 解鎖鈕長得像一般項目（.nav-item），但不是分頁：沒有 data-section／aria-current／.active（v5.5）', () => {
    const plain = [...NAV.matchAll(/<button\b[^>]*class="[^"]*\bnav-item\b(?!-)[^"]*"[^>]*>/g)]
        .map(m => m[0]).filter(tag => !/\sdata-section="/.test(tag));
    assert.equal(plain.length, 1, '沒有 data-section 的 .nav-item 只能是解鎖鈕');
    assert.match(plain[0], /\sid="dndcNavUnlock"/);
    assert.match(plain[0], /\sclass="nav-item nav-item--lock"/);
    assert.doesNotMatch(plain[0], /\saria-current=|\bactive\b/);
});

test('[nav-groups] dn/dc 子群組在「計算工具」裡面：解鎖鈕在脂質體之後、四個項目之前，項目預設隱藏', () => {
    const calc = GROUPS[1].html;
    const at = needle => calc.indexOf(needle);
    assert.ok(at('id="dndcNavSection"') > at('data-section="liposome"'), '#dndcNavSection 應在脂質體項目之後');
    assert.ok(at('id="dndcNavUnlock"') > at('id="dndcNavSection"'), '#dndcNavUnlock 應在 #dndcNavSection 裡面');
    assert.ok(at('id="dndcNavItems"') > at('id="dndcNavUnlock"'), '#dndcNavItems 應在解鎖鈕之後');
    assert.match(calc, /<div id="dndcNavItems" class="hidden">/);
    assert.deepEqual(sectionsIn(calc.slice(at('id="dndcNavItems"'))), [...DNDC_SECTIONS]);
    assert.deepEqual(sectionsIn(calc.slice(0, at('id="dndcNavSection"'))), ['sasfit', 'liposome']);
    // 子群組不是最上層群組：不帶 .nav-section（否則會多一段群組間距，也會被 navGroups 切成第四組）
    assert.doesNotMatch(calc, /<div[^>]*class="[^"]*\bnav-section\b(?!-)[^"]*"[^>]*id="dndcNavSection"/);
});

test('[nav-groups] dn/dc 解鎖鈕的屬性不變（js/dndc-lock.js 依賴）', () => {
    const button = (NAV.match(/<button\b[^>]*id="dndcNavUnlock"[^>]*>[\s\S]*?<\/button>/) || [])[0];
    assert.ok(button, '找不到 #dndcNavUnlock');
    assert.match(button, /\stype="button"/);
    assert.match(button, /\sclass="nav-item nav-item--lock"/);
    assert.match(button, /\saria-haspopup="dialog"/);
    assert.match(button, /\saria-controls="dndcPasswordModal"/);
    assert.match(button, /\saria-expanded="false"/);
});

test('[nav-groups] dn/dc 解鎖鈕的文字是「dn/dc 工具」，不帶鎖的符號；窄欄縮寫與其他項目同一套（v5.6）', () => {
    const button = (NAV.match(/<button\b[^>]*id="dndcNavUnlock"[^>]*>[\s\S]*?<\/button>/) || [])[0];
    assert.ok(button, '找不到 #dndcNavUnlock');
    assert.match(button, />\s*<span class="nav-item-text">dn\/dc 工具<\/span>\s*<\/button>$/);
    assert.match(button, /\sdata-short="dn\/dc"/);
    assert.match(button, /\sdata-title="dn\/dc 工具"/);
    assert.doesNotMatch(NAV, /[\u{1F512}\u{1F513}]/u, '側欄不應再有鎖的符號');
    // 解鎖時 js/dndc-lock.js 不得改寫按鈕文字，窄欄的 CSS 也不再用 ::after 補符號
    const lockJs = readCode('js/dndc-lock.js');
    assert.doesNotMatch(lockJs, /[\u{1F512}\u{1F513}]/u);
    assert.doesNotMatch(lockJs, /unlockBtn\.(textContent|innerText|innerHTML)\s*=/);
    const layoutCss = readCode('css/layout.css');
    assert.doesNotMatch(layoutCss, /[\u{1F512}\u{1F513}]/u);
    // 解鎖後窄欄隱藏父項目（HPLC dn/dc 的縮寫同為「dn/dc」，避免重複）
    assert.match(layoutCss, /\.sidebar\.collapsed \.nav-item--lock\[disabled\]\s*\{\s*display:\s*none;\s*\}/);
});

test('[nav-groups] 起始頁仍是蛋白質分析（.active 與 aria-current 只在它身上）', () => {
    const active = [...NAV.matchAll(/<button class="nav-item active"[^>]*>/g)].map(m => m[0]);
    assert.equal(active.length, 1);
    assert.match(active[0], /data-section="protein"/);
    assert.match(active[0], /aria-current="page"/);
    assert.equal(NAV.split('aria-current=').length - 1, 1);
});

test('[nav-groups] 沒有行內 style 與事件處理屬性（CSP）', () => {
    assert.doesNotMatch(NAV, /\sstyle="/);
    assert.doesNotMatch(NAV, /<[^>]*\son[a-z]+\s*=/i);
});
