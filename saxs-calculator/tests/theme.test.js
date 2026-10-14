'use strict';
/**
 * 主題切換與圖表主題（改版規格 §4、§6、§8.1-4）。
 * theme-init.js 與 chart-theme.js 由 tests/load.js 在沒有 document 的 Node 環境載入——
 * 能載入本身就證明兩檔的頂層沒有碰 DOM／Chart。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ThemeInit } = require('./load.js');

/** 暫時把 window.document 換成只有 <html data-theme> 的 stub */
function withThemeAttr(value, fn) {
    const saved = window.document;
    window.document = { documentElement: { getAttribute: name => (name === 'data-theme' ? value : null) } };
    try {
        return fn();
    } finally {
        if (saved === undefined) delete window.document;
        else window.document = saved;
    }
}

// ---------------------------------------------------------------- ThemeInit
test('[theme] normalize：只有 light／dark 會保留，其他一律 auto', () => {
    assert.equal(ThemeInit.normalize('light'), 'light');
    assert.equal(ThemeInit.normalize('dark'), 'dark');
    for (const raw of [null, undefined, '', 'auto', 'Dark', 'system', '1']) {
        assert.equal(ThemeInit.normalize(raw), 'auto', String(raw));
    }
});

test('[theme] resolve：手動優先，自動跟系統', () => {
    assert.equal(ThemeInit.resolve('light', true), 'light');
    assert.equal(ThemeInit.resolve('dark', false), 'dark');
    assert.equal(ThemeInit.resolve('auto', true), 'dark');
    assert.equal(ThemeInit.resolve('auto', false), 'light');
});

test('[theme] effective：讀 data-theme；沒有 document 時是淺色', () => {
    assert.equal(ThemeInit.effective(), 'light');
    assert.equal(withThemeAttr('dark', () => ThemeInit.effective()), 'dark');
    assert.equal(withThemeAttr('light', () => ThemeInit.effective()), 'light');
});

test('[theme] localStorage 鍵名', () => {
    assert.equal(ThemeInit.STORAGE_KEY, 'tps13a-theme');
});
