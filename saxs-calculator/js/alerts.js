/**
 * TPS13A SAXS Calculator - Alerts
 * 共用的提示訊息顯示／清除，與 escapeHtml 薄包裝。
 */

// ========================
// Utility Functions
// ========================
function showAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (!container) return;
    A11y.markLiveRegion(container, type);
    container.innerHTML =
        `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
}

/**
 * 清空提示容器（計算成功後不要留著上一次的錯誤訊息）。
 *
 * @param {string} containerId - 容器 id
 * @returns {void}
 */
function clearAlert(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
}

/**
 * 跳脫 HTML（單一實作在 js/form-utils.js，這裡只是既有呼叫端的薄包裝）。
 *
 * @param {*} text - 任意值
 * @returns {string} 已跳脫的字串
 */
function escapeHtml(text) {
    return FormUtils.escapeHtml(text);
}
