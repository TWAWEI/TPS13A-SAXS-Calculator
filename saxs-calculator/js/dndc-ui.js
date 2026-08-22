/**
 * TPS13A SAXS Calculator - dn/dc UI (shared)
 * dn/dc 分頁的共用狀態、初始化進入點與共用小工具
 * （各頁面的實作在 js/dndc-*-ui.js）。
 */

// 全域狀態：儲存已載入的色譜數據供多個頁面共用
const DndcState = {
    loadedData: null,   // { parsed, headers, time, uv, ri, columns }
    charts: {},
    lastHplcResult: null,
    lastHplcParams: null,
    lastSliceResult: null,
    // { result, xData, yData, source: 'manual' | 'astra' } — 供 CSV 匯出使用，
    // 不再從 DOM 表格刮資料
    lastMultiResult: null
};

// 欄位下拉的「未選擇」哨兵值。沒有這個選項時瀏覽器會自動選中第一個 option
// （通常是 Time 欄），偵測失敗就會拿時間當 RI 訊號算出看似合理的 dn/dc。
const NO_COLUMN = '-1';

// ========================
// 初始化
// ========================
function initDndcSections() {
    initDndcTheorySection();
    initDndcHplcSection();
    initDndcMultiSection();
    initDndcSliceSection();
}

/**
 * 統一的錯誤顯示：領域錯誤直接顯示訊息，非預期錯誤（TypeError 等）不把
 * 實作細節丟給使用者，改記進 console。
 *
 * @param {string} containerId - 顯示容器 id
 * @param {Error} err - 捕捉到的錯誤
 * @param {string} prefix - 顯示前綴，例如「計算錯誤」
 */
function reportDndcError(containerId, err, prefix) {
    const isDomainError = err instanceof Error && !(err instanceof TypeError) &&
        !(err instanceof RangeError) && !(err instanceof ReferenceError);
    if (isDomainError) {
        showDndcAlert(containerId, 'error', `${prefix}: ${err.message}`);
        return;
    }
    console.error(`[dn/dc] ${prefix}`, err);
    showDndcAlert(containerId, 'error',
        `${prefix}: 發生非預期的內部錯誤，請檢查輸入資料，並在瀏覽器主控台查看詳細訊息`);
}

/**
 * 載入新檔案時清掉上一個檔案的計算結果與匯出入口。
 *
 * 否則使用者換檔後直接按「CSV」會匯出上一個檔案的 dn/dc，
 * 檔名與內容都看不出來源已經不同。
 *
 * @returns {void}
 */
function resetLoadedResults() {
    DndcState.lastHplcResult = null;
    DndcState.lastHplcParams = null;
    DndcState.lastSliceResult = null;
    DndcState.lastMultiResult = null;
    ['hplcExportBtns', 'sliceExportBtns', 'multiExportBtns'].forEach(id => hideElement(id));
}

// ========================
// 工具函數
// ========================
function formatDndc(value) {
    // NaN / Infinity 直接印出 "NaN" 會被當成有效結果抄進實驗紀錄
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 0.001) return value.toFixed(4);
    return value.toExponential(4);
}

/**
 * 隱藏元素（不存在時安靜略過）。
 *
 * @param {string} elementId - 元素 id
 * @returns {void}
 */
function hideElement(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.classList.add('hidden');
}

/**
 * 跳脫 HTML（單一實作在 js/form-utils.js，這裡只是既有呼叫端的薄包裝）。
 *
 * CSV 標頭與 .afe7 內的樣品名／檔名都是不受信任輸入，塞進 innerHTML
 * （含 aria-label="…"、value="…" 這類屬性位置）之前一律要過這裡。
 *
 * @param {*} text - 任意值
 * @returns {string} 已跳脫的字串
 */
function escapeHtmlDndc(text) {
    return FormUtils.escapeHtml(text);
}

function showDndcAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (container) {
        // live region 要標在持久存在的容器上，訊息節點本身標了不會被朗讀
        A11y.markLiveRegion(container, type);
        container.innerHTML =
            `<div class="alert alert-${type}">${escapeHtmlDndc(message)}</div>`;
    }
}

/**
 * 一次顯示多則訊息（例如載入後的欄位品質警告）。
 *
 * @param {string} containerId - 容器 id
 * @param {string} type - alert 型別（error / warning / info / success）
 * @param {string[]} messages - 訊息陣列
 * @returns {void}
 */
function showDndcAlerts(containerId, type, messages) {
    const container = document.getElementById(containerId);
    if (!container || !Array.isArray(messages) || messages.length === 0) return;
    A11y.markLiveRegion(container, type);
    const items = messages.map(m => `<div>${escapeHtmlDndc(m)}</div>`).join('');
    container.innerHTML = `<div class="alert alert-${type}">${items}</div>`;
}

// 在 DOMContentLoaded 時初始化
document.addEventListener('DOMContentLoaded', () => {
    initDndcSections();
    initExportButtons();
    initChartControls();
});
