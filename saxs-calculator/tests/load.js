'use strict';
/**
 * Load the browser-global calculation modules into Node for testing.
 *
 * 瀏覽器裡的 classic <script> 共用同一個全域作用域；require() 卻讓每個檔各有自己的模組作用域。
 * 拆檔後，分檔（例如 hplc-calculations.js）的頂層宣告（函式與常數）要在原檔（calculations.js）結尾的匯出區塊
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
    'theme-init.js',               // index.html 在 <head> 載入；頂層只在有 document 時才動 DOM
    'form-utils.js',
    'mass-units.js',               // 頂層只定義常數與函式（不碰 document）
    'result-tiles.js',             // 純字串組裝（不碰 document）
    'chart-theme.js',              // 頂層只定義常數與函式（不碰 Chart／document）
    'protein.js',
    'sample-prep-calculations.js',
    'hplc-calculations.js',
    'detector-calculations.js',
    'calculations.js',
    'detector-limits-ui.js',
    'dndc-theory-calculations.js',
    'dndc-signal-calculations.js',
    'dndc-alignment-calculations.js',
    'dndc-calculations.js',
    'dndc-file-parser.js',
    'dndc-astra-parser.js',
    'liposome-calculations.js',
    'liposome-file-parsers.js',
    'liposome-results-table.js',   // 頂層無 DOM 存取；只用 rowsToCsv / csvCell
    'dndc-astra-ui.js',            // UI 檔，但頂層只有函式宣告；純文案函式從 window.DndcAstraUi 取用
    'sasfit-meta.js',              // 產生檔；IIFE，只掛 globalThis.SasFitMeta
    'sasfit-validate.js',          // IIFE，只掛 globalThis.SasFitValidate；sasfit 各計算模組共用的輸入檢查
    'sasfit-weights.js',           // IIFE，只掛 globalThis.SasFitWeights
    'sasfit-kernel.js',            // IIFE，只掛 globalThis.SasFitKernel；wasm bytes 由呼叫端傳入
    'sasfit-product.js',           // IIFE，只掛 globalThis.SasFitProduct；kernel 由呼叫端傳入
    'sasfit-py-models.js',        // IIFE，只掛 globalThis.SasFitPyModels；呼叫時才讀 SasFitMeta
    'sasfit-evaluate.js',         // IIFE，只掛 globalThis.SasFitEvaluate；呼叫時才讀其他 SasFit 模組
    'sasfit-weighting.js',        // IIFE，只掛 globalThis.SasFitWeighting；純函式，只讀 SasFitValidate
    'sasfit-data-io.js',          // IIFE，只掛 globalThis.SasFitDataIo；純文字解析，無相依
    'sasfit-sld.js',              // IIFE，只掛 globalThis.SasFitSld；化學式解析與 X 光 SLD，無相依
    'sasfit-linalg.js',           // IIFE，只掛 globalThis.SasFitLinalg；Jacobi SVD 與共變異，無相依
    'sasfit-fitter.js',           // IIFE，只掛 globalThis.SasFitFitter；載入時讀 SasFitLinalg，與模型無關
    'sasfit-worker-core.js',      // IIFE，只掛 globalThis.SasFitWorkerCore；wasm 載入、post、yieldTask 皆由呼叫端注入
    'sasfit-worker-client.js',    // IIFE，只掛 globalThis.SasFitWorkerClient；頂層只在有 document 時讀 currentScript，呼叫時才建 Worker
    'sasfit-form.js',             // IIFE，只掛 globalThis.SasFitForm；模型表單與驗證，呼叫時才讀 SasFitMeta／SasFitValidate
    'sasfit-state.js',            // IIFE，只掛 globalThis.SasFitState；頁面狀態 reducer，呼叫時才讀 SasFitWeighting／SasFitFitter／SasFitWorkerCore
    'sasfit-format.js',           // IIFE，只掛 globalThis.SasFitFormat；數值±誤差的文字與回填捨入，純函式、無相依
    'sasfit-labels.js',           // IIFE，只掛 globalThis.SasFitLabels；組合出來的純文字（模型名、擬合摘要、圖的朗讀文字），呼叫時才讀 SasFitFormat
    'sasfit-jobs.js',             // IIFE，只掛 globalThis.SasFitJobs；Worker 請求的組裝，呼叫時才讀 SasFitForm／SasFitState／SasFitWeighting
    'sasfit-hints.js',            // IIFE，只掛 globalThis.SasFitHints；提示與錯誤訊息的選擇，呼叫時才讀 SasFitWeighting
    'sasfit-html.js',             // IIFE，只掛 globalThis.SasFitHtml；純 HTML 字串，呼叫時才經 host() 讀 FormUtils／ResultTiles／ChartTheme
    'sasfit-plot-data.js',        // IIFE，只掛 globalThis.SasFitPlotData；圖表 config 的純資料，呼叫時才經 host() 讀 ChartTheme
    'sasfit-plots.js',            // IIFE，只掛 globalThis.SasFitPlots；Chart 實例與誤差棒外掛，頂層不碰 document／Chart
    'sasfit-shape-geom.js',       // IIFE，只掛 globalThis.SasFitShapeGeom；3D 示意圖的網格與蠕蟲鏈中心線，純函式、無相依
    'sasfit-shape-view.js',       // IIFE，只掛 globalThis.SasFitShapeView；3D 的視角、投影、繪製順序、比例尺與文字，呼叫時才讀其他 SasFit 模組
    'sasfit-shape3d.js',          // IIFE，只掛 globalThis.SasFitShape3d；3D 的 Canvas 繪製，頂層不碰 document，呼叫時才經 host() 讀 ChartTheme
    'sasfit-sequence.js',         // IIFE，只掛 globalThis.SasFitSequence；序列擬合的排程、起始值規則與執行器（client 由呼叫端注入），呼叫時才讀其他 SasFit 模組
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
    ThemeInit: window.ThemeInit,
    ChartTheme: window.ChartTheme,
    MassUnits: window.MassUnits,
    ResultTiles: window.ResultTiles,
    SasFitMeta: globalThis.SasFitMeta,
    SasFitValidate: globalThis.SasFitValidate,
    SasFitWeights: globalThis.SasFitWeights,
    SasFitKernel: globalThis.SasFitKernel,
    SasFitProduct: globalThis.SasFitProduct,
    SasFitPyModels: globalThis.SasFitPyModels,
    SasFitEvaluate: globalThis.SasFitEvaluate,
    SasFitWeighting: globalThis.SasFitWeighting,
    SasFitDataIo: globalThis.SasFitDataIo,
    SasFitSld: globalThis.SasFitSld,
    SasFitLinalg: globalThis.SasFitLinalg,
    SasFitFitter: globalThis.SasFitFitter,
    SasFitWorkerCore: globalThis.SasFitWorkerCore,
    SasFitWorkerClient: globalThis.SasFitWorkerClient,
    SasFitForm: globalThis.SasFitForm,
    SasFitState: globalThis.SasFitState,
    SasFitFormat: globalThis.SasFitFormat,
    SasFitLabels: globalThis.SasFitLabels,
    SasFitJobs: globalThis.SasFitJobs,
    SasFitHints: globalThis.SasFitHints,
    SasFitHtml: globalThis.SasFitHtml,
    SasFitPlotData: globalThis.SasFitPlotData,
    SasFitPlots: globalThis.SasFitPlots,
    SasFitShapeGeom: globalThis.SasFitShapeGeom,
    SasFitShapeView: globalThis.SasFitShapeView,
    SasFitShape3d: globalThis.SasFitShape3d,
    SasFitSequence: globalThis.SasFitSequence,
};
