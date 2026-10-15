'use strict';
/**
 * 結果磚組裝（v5.2，改版規格 §7.1）。ResultTiles 只組字串，參數都是 HTML 片段。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultTiles } = require('./load.js');

test('[tiles] tile：標籤在數值前，單位在數值框內', () => {
    const html = ResultTiles.tile({ label: '濃度', value: '1.2345', unit: 'mg/mL' });
    assert.equal(html,
        '<div class="tile"><div class="tile-label">濃度</div>'
        + '<div class="tile-value">1.2345<span class="tile-unit">mg/mL</span></div></div>');
});

test('[tiles] tile：沒有單位就不輸出單位元素', () => {
    assert.doesNotMatch(ResultTiles.tile({ label: 'R²', value: '0.999' }), /tile-unit/);
});

test('[tiles] tile：hero／wide 修飾、附註可多行、膠囊依語氣上色', () => {
    const html = ResultTiles.tile({
        label: 'MW', value: '66.50', unit: 'kDa', hero: true,
        sub: ['第一行', '', '第二行'], chip: { tone: 'ok', text: '✓ 比值 1.00' },
    });
    assert.match(html, /^<div class="tile tile--hero">/);
    assert.match(html, /<span class="tile-chip tile-chip--ok">✓ 比值 1.00<\/span>/);
    assert.equal((html.match(/class="tile-sub"/g) || []).length, 2, '空字串附註略過');
    assert.match(ResultTiles.tile({ label: 'x', value: '1', wide: true }), /^<div class="tile tile--wide">/);
    assert.match(ResultTiles.tile({ label: 'x', value: '1', sub: '單行' }), /<div class="tile-sub">單行<\/div>/);
});

test('[tiles] tile：未知的膠囊語氣直接丟錯（不靜默換色）', () => {
    assert.throws(() => ResultTiles.tile({ label: 'x', value: '1', chip: { tone: 'great', text: 'y' } }), /tone/);
});

test('[tiles] tiles：略過 false／空字串（條件式磚）', () => {
    const a = ResultTiles.tile({ label: 'a', value: '1' });
    assert.equal(ResultTiles.tiles([a, false, '', null]), `<div class="tiles">${a}</div>`);
});

test('[tiles] rows：唯讀列表；略過 false；空清單回空字串', () => {
    const html = ResultTiles.rows([
        { label: '光徑', value: 1, unit: 'cm' },
        false,
        { label: '名稱', value: 'BSA', note: '附註' },
    ]);
    assert.equal(html,
        '<div class="result-list">'
        + '<div class="result-row"><div class="result-row-label">光徑</div>'
        + '<div class="result-row-value">1<span class="tile-unit">cm</span></div></div>'
        + '<div class="result-row"><div class="result-row-label">名稱</div>'
        + '<div class="result-row-value">BSA</div><div class="result-row-note">附註</div></div>'
        + '</div>');
    assert.equal(ResultTiles.rows([false, null]), '');
});

test('[tiles] 數值 0 照常輸出（不被當成缺值）', () => {
    assert.match(ResultTiles.tile({ label: 'n', value: 0 }), /<div class="tile-value">0<\/div>/);
    assert.match(ResultTiles.row({ label: 'n', value: 0 }), /<div class="result-row-value">0<\/div>/);
});
