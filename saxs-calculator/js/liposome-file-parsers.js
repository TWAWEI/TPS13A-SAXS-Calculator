/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：檔案解析（SAXS .dat 與兩欄 UV-Vis 光譜）
 *
 * 兩個解析器共用 numericRows：逐行 trim、跳過空行與 # 註解、以空白／逗號／分號切欄，
 * 前 minCols 欄必須是有限數，否則整行略過並計入 skipped——PRIMUS/ATSAS 的文字標頭與
 * 儀器匯出的欄名列就這樣自然被跳過。不用 DndcFileParser.parseCSV：它固定把第一列當標頭，
 * 會吃掉沒有標頭的光譜檔第一列。
 *
 * 內插需要嚴格遞增的 x，這裡是唯一的保證點：非遞增就穩定排序（sorted: true），重複 x 就 throw。
 */
(function attachLiposomeFileParsers(global) {
    'use strict';

    const LIMITS = Object.freeze({
        MAX_BYTES: 5 * 1024 * 1024,
        MAX_POINTS: 100000,
    });

    const SPLIT_RE = /[\s,;]+/;

    /**
     * @param {string} text
     * @param {number} minCols
     * @returns {{rows:number[][], skipped:number}}
     */
    function numericRows(text, minCols) {
        if (typeof text !== 'string') throw new Error('檔案內容不是文字');
        const rows = [];
        let skipped = 0;
        text.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) return;
            const fields = trimmed.split(SPLIT_RE).map(Number);
            if (fields.length < minCols || fields.slice(0, minCols).some(v => !Number.isFinite(v))) {
                skipped += 1;
                return;
            }
            rows.push(fields);
        });
        if (rows.length === 0) throw new Error(`找不到數值列（每列至少要有 ${minCols} 欄數字）`);
        if (rows.length > LIMITS.MAX_POINTS) {
            throw new Error(`資料點 ${rows.length} 超過上限 ${LIMITS.MAX_POINTS}`);
        }
        return { rows, skipped };
    }

    /**
     * 依第 0 欄排序（已遞增就原樣回傳），重複 x → throw。
     * @returns {{ordered:number[][], sorted:boolean}}
     */
    function orderRows(rows, xLabel) {
        let monotonic = true;
        for (let k = 1; k < rows.length; k++) {
            if (!(rows[k][0] > rows[k - 1][0])) { monotonic = false; break; }
        }
        const ordered = monotonic ? rows : rows.slice().sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < ordered.length; k++) {
            if (ordered[k][0] === ordered[k - 1][0]) {
                throw new Error(`${xLabel} 有重複值 ${ordered[k][0]}，無法內插`);
            }
        }
        return { ordered, sorted: !monotonic };
    }

    /**
     * SAXS .dat：q, I(q)[, error]。
     * @param {string} text
     * @returns {{q:number[], i:number[], err:number[]|null, skipped:number, sorted:boolean}}
     */
    function parseSaxsDat(text) {
        const { rows, skipped } = numericRows(text, 2);
        const { ordered, sorted } = orderRows(rows, 'q');
        const hasErr = ordered.every(r => r.length >= 3 && Number.isFinite(r[2]));
        return Object.freeze({
            q: Object.freeze(ordered.map(r => r[0])),
            i: Object.freeze(ordered.map(r => r[1])),
            err: hasErr ? Object.freeze(ordered.map(r => r[2])) : null,
            skipped,
            sorted,
        });
    }

    /**
     * 兩欄 UV-Vis 光譜：wavelength [nm], absorbance。
     * @param {string} text
     * @returns {{wavelength:number[], absorbance:number[], skipped:number, sorted:boolean}}
     */
    function parseUvSpectrum(text) {
        const { rows, skipped } = numericRows(text, 2);
        const { ordered, sorted } = orderRows(rows, '波長');
        return Object.freeze({
            wavelength: Object.freeze(ordered.map(r => r[0])),
            absorbance: Object.freeze(ordered.map(r => r[1])),
            skipped,
            sorted,
        });
    }

    global.LiposomeFileParsers = Object.freeze({
        LIMITS,
        parseSaxsDat,
        parseUvSpectrum,
    });
})(typeof window !== 'undefined' ? window : globalThis);
