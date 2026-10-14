'use strict';
/**
 * Load the browser-global calculation modules into Node for testing.
 *
 * 瀏覽器裡的 classic <script> 共用同一個全域作用域；require() 卻讓每個檔各有自己的模組作用域。
 * 拆檔後，分檔（例如 hplc-calculations.js）的頂層函式要在原檔（calculations.js）結尾的匯出區塊
 * 被讀到，require() 之下會 ReferenceError。所以這裡用 vm.runInThisContext 逐檔執行，
 * 語意與瀏覽器相同。順序必須與 index.html 一致（tests/structure.test.js 會檢查拆檔群組）。
 *
 * Usage: node --test saxs-calculator/tests/
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 瀏覽器腳本會把自己掛到 window.*，所以 Node 端需要一個 window 物件。
global.window = global.window || {};

const JS = path.join(__dirname, '..', 'js');

/** 依序載入的檔案；相對順序與 index.html 一致。 */
const LOAD_ORDER = Object.freeze([
    'form-utils.js',
    'protein.js',
    'calculations.js',
    'detector-limits-ui.js',
    'dndc-calculations.js',
    'dndc-file-parser.js',
    'dndc-astra-parser.js',
    'liposome-calculations.js',
    'liposome-file-parsers.js',
    'liposome-results-table.js',   // 頂層無 DOM 存取；只用 rowsToCsv / csvCell
    'dndc-astra-ui.js',            // UI 檔，但頂層只有函式宣告；純文案函式從 window.DndcAstraUi 取用
]);

/** 以瀏覽器 classic script 的語意執行一個 js/ 檔（共用 globalThis 與頂層宣告）。 */
function loadScript(file) {
    const full = path.join(JS, file);
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
}

LOAD_ORDER.forEach(loadScript);

module.exports = {
    LOAD_ORDER,
    SAXS: window.SAXSCalculations,
    DetectorLimits: window.DetectorLimits,
    Protein: window.ProteinAnalysis,
    Dndc: window.DndcCalculations,
    FileParser: window.DndcFileParser,
    AstraParser: window.DndcAstraParser,
    AstraUi: window.DndcAstraUi,
    FormUtils: window.FormUtils,
    Liposome: window.LiposomeCalculations,
    LiposomeParsers: window.LiposomeFileParsers,
    LiposomeTable: window.LiposomeResultsTable,
};
