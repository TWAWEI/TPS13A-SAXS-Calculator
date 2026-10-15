/**
 * TPS13A SAXS Calculator - 結果磚（v5.2，改版規格 §7）
 *
 * 純字串組裝，不碰 DOM（Node 測試也會載入）。參數都是 HTML 片段：數字由呼叫端格式化，
 * 來自使用者或檔案的字串由呼叫端先跳脫（escapeHtml／escapeHtmlDndc，與 v5.1 的模板相同）。
 *
 *   ResultTiles.tiles([
 *       ResultTiles.tile({ label: '濃度', value: '1.2345', unit: 'mg/mL', hero: true }),
 *       hasUv && ResultTiles.tile({ label: 'On-column 濃度', value: '0.4400', unit: 'mg/mL' }),
 *   ]) + ResultTiles.rows([{ label: '光徑', value: 1, unit: 'cm' }])
 *
 * 版面：.tiles 兩欄（≤640px 一欄）；主角 .tile--hero 跨兩欄、放大、珊瑚色；.tile--wide 只跨欄。
 * 次要數值放 .result-list（分組列表樣式的唯讀列）。樣式在 css/tiles.css。
 */
(function attachResultTiles(global) {
    'use strict';

    const CHIP_TONES = Object.freeze(['ok', 'warn', 'error']);

    const unitHtml = unit => (unit ? `<span class="tile-unit">${unit}</span>` : '');

    /** 附註可傳字串或陣列；空字串略過 */
    function notesHtml(notes, className) {
        return [].concat(notes || [])
            .filter(note => note !== '' && note !== null && note !== undefined)
            .map(note => `<div class="${className}">${note}</div>`)
            .join('');
    }

    function chipHtml(chip) {
        if (!chip) return '';
        if (!CHIP_TONES.includes(chip.tone)) {
            throw new Error(`ResultTiles: chip tone 必須是 ${CHIP_TONES.join('／')}，收到 ${chip.tone}`);
        }
        return `<span class="tile-chip tile-chip--${chip.tone}">${chip.text}</span>`;
    }

    /**
     * 一個磚。
     *
     * @param {{label: string, value: (string|number), unit?: string, sub?: (string|string[]),
     *          hero?: boolean, wide?: boolean, chip?: {tone: string, text: string}}} spec
     * @returns {string} HTML 片段
     */
    function tile({ label, value, unit = '', sub = [], hero = false, wide = false, chip = null }) {
        const modifier = hero ? ' tile--hero' : wide ? ' tile--wide' : '';
        return `<div class="tile${modifier}"><div class="tile-label">${label}</div>`
            + `<div class="tile-value">${value}${unitHtml(unit)}</div>`
            + chipHtml(chip)
            + notesHtml(sub, 'tile-sub')
            + '</div>';
    }

    /** 磚的格線；false／null／空字串（條件式磚）略過 */
    function tiles(items) {
        return `<div class="tiles">${items.filter(Boolean).join('')}</div>`;
    }

    /**
     * 唯讀列表的一列。
     *
     * @param {{label: string, value: (string|number), unit?: string, note?: (string|string[])}} spec
     * @returns {string} HTML 片段
     */
    function row({ label, value, unit = '', note = [] }) {
        return `<div class="result-row"><div class="result-row-label">${label}</div>`
            + `<div class="result-row-value">${value}${unitHtml(unit)}</div>`
            + notesHtml(note, 'result-row-note')
            + '</div>';
    }

    /** 唯讀列表；false／null 略過，全部略過時回空字串 */
    function rows(items) {
        const present = items.filter(Boolean);
        return present.length ? `<div class="result-list">${present.map(row).join('')}</div>` : '';
    }

    global.ResultTiles = Object.freeze({ tile, tiles, row, rows });
})(typeof window !== 'undefined' ? window : globalThis);
