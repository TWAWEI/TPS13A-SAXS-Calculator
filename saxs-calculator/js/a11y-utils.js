/**
 * TPS13A SAXS Calculator - 共用無障礙工具（WCAG 4.1.3 Status Messages / 2.4.3 Focus Order）
 *
 * 為什麼需要這一層：
 *   - 直接 `container.innerHTML = '<div role="status">…</div>'` 幾乎不會被朗讀。
 *     ARIA live region 必須在內容變動「之前」就存在於無障礙樹裡，
 *     所以要標的是持久存在的容器，不是每次重建的訊息節點。
 *   - 按下「計算」後焦點停在按鈕上；≤768px 時 .grid-2 塌成單欄，
 *     結果卡會落到輸入卡下方看不見的位置，使用者會以為「按了沒反應」。
 *
 * 無副作用、無狀態；載入順序需在 app.js / dndc-ui.js 之前。
 */
(function attachA11yUtils(global) {
    'use strict';

    /**
     * 把持久存在的容器標成 live region，之後換內容才會被螢幕閱讀器朗讀。
     * 錯誤用 role="alert"（assertive，立即打斷）；其餘用 role="status"（polite）。
     *
     * @param {HTMLElement|null} container - 訊息容器（非訊息節點本身）
     * @param {string} type - alert 型別（error / warning / info / success）
     * @returns {void}
     */
    function markLiveRegion(container, type) {
        if (!container || typeof container.setAttribute !== 'function') return;
        if (type === 'error') {
            container.setAttribute('role', 'alert');
            container.removeAttribute('aria-live');   // role="alert" 已隱含 assertive
        } else {
            container.setAttribute('role', 'status');
            container.setAttribute('aria-live', 'polite');
        }
        container.setAttribute('aria-atomic', 'true');
    }

    /**
     * 移除 live region 語意。結果由焦點移動宣告，若留著 live region
     * 整張結果表會在插入時被完整朗讀一次，再朗讀一次。
     *
     * @param {HTMLElement|null} container - 容器
     * @returns {void}
     */
    function clearLiveRegion(container) {
        if (!container || typeof container.removeAttribute !== 'function') return;
        container.removeAttribute('role');
        container.removeAttribute('aria-live');
        container.removeAttribute('aria-atomic');
    }

    /**
     * 計算成功後把捲動位置與鍵盤焦點帶到結果區。
     *
     * @param {string} containerId - 結果容器 id
     * @returns {boolean} 是否成功移動焦點
     */
    function focusResults(containerId) {
        const el = typeof document !== 'undefined' && document.getElementById(containerId);
        if (!el) return false;
        clearLiveRegion(el);
        el.setAttribute('tabindex', '-1');

        // 尊重 prefers-reduced-motion：顯式的 behavior:'smooth' 會蓋過
        // CSS 的 scroll-behavior: auto，所以要在 JS 這一層再判斷一次
        const reduceMotion = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        try {
            el.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
            el.focus({ preventScroll: true });
        } catch (err) {
            // 舊瀏覽器不支援 options 物件
            el.scrollIntoView();
            el.focus();
        }
        return true;
    }

    /**
     * 更新圖表 canvas 的無障礙描述（Chart.js 只畫像素，AT 讀到的是空元素）。
     *
     * @param {string} canvasId - canvas 元素 id
     * @param {string} description - 圖表內容描述，含關鍵數字
     * @returns {void}
     */
    function describeChart(canvasId, description) {
        const el = typeof document !== 'undefined' && document.getElementById(canvasId);
        if (!el || !description) return;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', description);
    }

    global.A11y = Object.freeze({
        markLiveRegion,
        clearLiveRegion,
        focusResults,
        describeChart
    });
})(typeof window !== 'undefined' ? window : globalThis);
