'use strict';
/**
 * 結果 HTML → 可比對的摘要（數值不變測試用，改版規格 §8.3）。不是測試檔。
 *
 * 只認自家模板的標記：標籤／數值／附註三類 class（v5.1 的 result-*／stat-*，v5.2 的 tile-*／result-row-*），
 * 以及 .alert 提示框。模板產生的 HTML 結構規整，用小型堆疊解析即可，不需要 DOM。
 *
 *   pairs   「標籤｜數值」，數值去掉所有空白（單位併在數值後：「69.29kDa」），排序
 *   alerts  每個 .alert 的文字，排序
 *   notes   每則附註（數值下方說明、公式說明）的文字，排序——不含數字的說明也鎖住
 *   numbers 整段 HTML 文字裡的所有數字（含標籤、附註、提示框），排序
 */
const ROLE_BY_CLASS = Object.freeze({
    'result-label': 'label', 'stat-label': 'label', 'tile-label': 'label', 'result-row-label': 'label',
    'result-value': 'value', 'stat-value': 'value', 'tile-value': 'value', 'result-row-value': 'value',
    'alert': 'alert',
    'result-note': 'note', 'stat-sub': 'note', 'formula-note': 'note',
    'tile-sub': 'note', 'result-row-note': 'note', 'result-list-foot': 'note',
});
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr']);
const ENTITIES = Object.freeze({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'" });
const NUMBER = /\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/gi;

/** 去標籤、解實體、壓空白 */
function textOf(html) {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(?:lt|gt|amp|quot|#0?39);/g, entity => ENTITIES[entity])
        .replace(/\s+/g, ' ')
        .trim();
}

/** 依文件順序列出 { role, text } */
function fields(html) {
    const found = [];
    const stack = [];
    for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
        const [whole, closing, rawName, attrs] = match;
        const name = rawName.toLowerCase();
        if (closing) {
            const index = stack.map(entry => entry.name).lastIndexOf(name);
            if (index < 0) continue;
            const open = stack[index];
            stack.length = index;
            if (open.role) found.push({ at: open.at, role: open.role, text: textOf(html.slice(open.contentStart, match.index)) });
            continue;
        }
        if (VOID_TAGS.has(name) || attrs.trim().endsWith('/')) continue;
        const classes = ((attrs.match(/\bclass="([^"]*)"/) || [])[1] || '').split(/\s+/);
        const role = classes.map(c => ROLE_BY_CLASS[c]).find(Boolean) || null;
        stack.push({ name, role, at: match.index, contentStart: match.index + whole.length });
    }
    return found.sort((x, y) => x.at - y.at);
}

function summarize(html) {
    const list = fields(html);
    const pairs = [];
    let current = null;
    for (const field of list) {
        if (field.role === 'label') {
            current = { label: field.text, value: null };
            pairs.push(current);
        } else if (field.role === 'value' && current && current.value === null) {
            current.value = field.text.replace(/\s+/g, '');
        }
    }
    return {
        pairs: pairs.map(p => `${p.label}｜${p.value}`).sort(),
        alerts: list.filter(f => f.role === 'alert').map(f => f.text).sort(),
        notes: list.filter(f => f.role === 'note').map(f => f.text).sort(),
        numbers: (textOf(html).match(NUMBER) || []).sort(),
    };
}

module.exports = { summarize, textOf };
