'use strict';
/**
 * 對比度測試（改版規格 §3.1、§3.3、§8.1-1）：用 WCAG 2.x 公式檢查 tokens.css 兩個主題的配色。
 * 半透明色先疊在指定底色上再算。文字 ≥ 4.5，元件 ≥ 3。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCode, parseCustomProperties, blockBody } = require('./style-scan.js');

const TOKENS = readCode('css/tokens.css');
const LIGHT_BODY = blockBody(TOKENS, ':root');
const AUTO_DARK_BODY = blockBody(TOKENS, ':root:not([data-theme="light"])');
const MANUAL_DARK_BODY = blockBody(TOKENS, ':root[data-theme="dark"]');

const LIGHT = parseCustomProperties(LIGHT_BODY || '');
const DARK = new Map([...LIGHT, ...parseCustomProperties(AUTO_DARK_BODY || '')]);
const THEMES = Object.freeze({ light: LIGHT, dark: DARK });

/** '#RGB' | '#RRGGBB' | 'rgb(a)(r, g, b[, a])' → { r, g, b, a }（0–255，a 0–1） */
function parseColor(value) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
    if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
    throw new Error(`無法解析的顏色：${value}`);
}

/** 把 top 疊在不透明的 bottom 上 */
function over(top, bottom) {
    const a = top.a;
    return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function luminance({ r, g, b }) {
    const lin = c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * 解析一個底色描述：'--a' 或 '--a over --b'（a 疊在 b 上；b 也可以再疊）。
 * 前景若半透明，也先疊在底色上。
 */
function resolveSurface(theme, spec) {
    const parts = spec.split(' over ').map(s => s.trim());
    let color = parseColor(theme.get(parts[parts.length - 1]));
    for (let i = parts.length - 2; i >= 0; i--) color = over(parseColor(theme.get(parts[i])), color);
    return color;
}

function ratio(theme, fgName, bgSpec) {
    const bg = resolveSurface(theme, bgSpec);
    return contrast(over(parseColor(theme.get(fgName)), bg), bg);
}

const GLASS = '--glass-sidebar over --color-bg-primary';
const NEUTRAL_SURFACES = ['--color-bg-card', '--color-bg-primary', '--color-bg-tertiary', '--color-bg-hover', '--color-bg-sidebar', GLASS];

/** [前景, 底色, 門檻, 用在哪裡] */
const PAIRS = Object.freeze([
    ...['--color-text-primary', '--color-text-secondary', '--color-text-muted', '--color-accent-text']
        .flatMap(fg => NEUTRAL_SURFACES.map(bg => [fg, bg, 4.5, '一般文字'])),
    ...['--color-accent-text', '--color-text-primary', '--color-text-muted']
        .map(fg => [fg, '--color-accent-tint over --color-bg-card', 4.5, '理論值面板強調格、流速表提示列、卡片上的來源 chip']),
    ['--color-accent-text', '--color-accent-tint over --color-bg-tertiary', 4.5, '理論值面板上的來源 chip'],
    ...['success', 'warning', 'danger'].flatMap(s => [
        [`--color-${s}-text`, `--color-${s}-bg`, 4.5, '提示框、徽章'],
        [`--color-${s}-text`, '--color-bg-card', 4.5, '卡片上的狀態文字'],
        [`--color-${s}-text`, '--color-bg-tertiary', 4.5, '表格 hover 列、理論值面板'],
    ]),
    ...['--color-text-primary', '--color-success-text', '--color-accent-text']
        .map(fg => [fg, '--color-warning-bg', 4.5, 'Detector Setting 表主步驟列（§5.6）']),
    ...['--color-accent-primary', '--color-accent-primary-hover', '--color-danger']
        .map(bg => ['--color-text-on-accent', bg, 4.5, '白字按鈕、選中導覽項']),
    ['--color-text-primary', '--color-bg-raised', 4.5, '分段控制選中塊'],
    ...['--color-accent-primary', '--color-accent-primary-hover', '--color-focus']
        .flatMap(fg => ['--color-bg-card', '--color-bg-primary', '--color-bg-sidebar', GLASS].map(bg => [fg, bg, 3, '按鈕外形、焦點框'])),
    ...['--color-danger', '--color-success', '--color-warning']
        .map(fg => [fg, '--color-bg-card', 3, '卡片內的語意填色']),
]);

test('[contrast] 兩個深色區塊逐字相同', () => {
    assert.ok(LIGHT_BODY, 'tokens.css 找不到 :root 區塊');
    assert.ok(AUTO_DARK_BODY, '找不到 :root:not([data-theme="light"]) 區塊');
    assert.ok(MANUAL_DARK_BODY, '找不到 :root[data-theme="dark"] 區塊');
    const norm = s => s.trim().replace(/\s+/g, ' ');
    assert.equal(norm(AUTO_DARK_BODY), norm(MANUAL_DARK_BODY));
});

test('[contrast] 深色區塊只覆寫淺色已有的 token（不新增名稱）', () => {
    const extra = [...parseCustomProperties(AUTO_DARK_BODY).keys()].filter(name => !LIGHT.has(name));
    assert.deepEqual(extra, []);
});

test('[contrast] 深色區塊都包在 @media screen 裡（列印一律淺色）', () => {
    assert.match(TOKENS, /@media screen and \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
    assert.match(TOKENS, /@media screen\s*\{\s*:root\[data-theme="dark"\]/);
});

for (const [themeName, theme] of Object.entries(THEMES)) {
    test(`[contrast] ${themeName}：文字 ≥ 4.5、元件 ≥ 3`, () => {
        const failures = PAIRS
            .map(([fg, bg, min, where]) => ({ fg, bg, min, where, value: ratio(theme, fg, bg) }))
            .filter(p => p.value < p.min)
            .map(p => `${p.fg} on ${p.bg} = ${p.value.toFixed(2)} < ${p.min}（${p.where}）`);
        assert.deepEqual(failures, []);
    });
}
