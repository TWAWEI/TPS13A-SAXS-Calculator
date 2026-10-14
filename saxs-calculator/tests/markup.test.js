'use strict';
/**
 * 標記不變測試（改版規格 §8.2）：JS 與測試都靠 id、for、aria-*、data-section 取元素。
 * 改版只能換 class 與包裝層，這四類屬性必須與 v4.15 的 index.html 完全相同；
 * 唯一允許的新增是側欄的主題切換控制。
 *
 * fixture（tests/fixtures/markup-v4.15.json）由 v4.15（commit 6b02fbe）的 index.html 產生：
 *   node -e "const {markupCounts}=require('./saxs-calculator/tests/style-scan.js');const html=require('child_process').execSync('git show 6b02fbe:saxs-calculator/index.html').toString();require('fs').writeFileSync('saxs-calculator/tests/fixtures/markup-v4.15.json', JSON.stringify(markupCounts(html), null, 2)+'\n')"
 * v5.1 補 aria-live 時要更新 fixture，並在 commit 訊息說明。
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

test('[markup] id／for／aria-*／data-section 與 v4.15 相同（只多了主題切換控制）', () => {
    const current = markupCounts(read('index.html'));
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
