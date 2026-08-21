/**
 * TPS13A SAXS Calculator - 共用表單／儲存工具
 *
 * 這個模組刻意保持「無副作用 + 可在 Node 測試」：
 *   - parse* 系列是純函式，只吃字串／數字，錯誤時 throw 可行動的訊息
 *   - read*Field 是 DOM 薄包裝，讓 UI 層一行就能完成「讀取 + 驗證」
 *   - createSafeStorage 讓 localStorage / sessionStorage 被瀏覽器封鎖時
 *     不會炸掉整個 init 流程（Safari「阻擋所有 Cookie」、企業政策等）
 *
 * 載入順序必須在其他 js 之前（index.html 第一支 <script>）。
 */
(function attachFormUtils(global) {
    'use strict';

    /**
     * 把使用者輸入描述成可讀字串，用在錯誤訊息裡。
     * @param {*} rawValue - 原始輸入
     * @returns {string} 描述文字
     */
    function describeRaw(rawValue) {
        if (rawValue === null || rawValue === undefined) return '未填寫';
        const text = String(rawValue).trim();
        return text === '' ? '空白' : `「${text}」`;
    }

    /**
     * 解析必須為「有限且大於 0」的數值。
     *
     * @param {string|number} rawValue - 原始輸入
     * @param {string} label - 欄位名稱（顯示用）
     * @returns {number} 已驗證的數值
     * @throws {Error} 空白／無法解析／≤ 0 時丟出含欄位名稱的錯誤
     */
    function parsePositiveNumber(rawValue, label) {
        const value = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
        if (!Number.isFinite(value)) {
            throw new Error(`${label} 必須是大於 0 的數值（目前：${describeRaw(rawValue)}）`);
        }
        if (value <= 0) {
            throw new Error(`${label} 必須大於 0（目前：${value}）`);
        }
        return value;
    }

    /**
     * 解析必須為「有限」的數值（允許 0 與負值，例如時間邊界／延遲）。
     *
     * @param {string|number} rawValue - 原始輸入
     * @param {string} label - 欄位名稱（顯示用）
     * @returns {number} 已驗證的數值
     * @throws {Error} 空白或無法解析時丟出含欄位名稱的錯誤
     */
    function parseFiniteNumber(rawValue, label) {
        const value = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
        if (!Number.isFinite(value)) {
            throw new Error(`${label} 必須是數值（目前：${describeRaw(rawValue)}）`);
        }
        return value;
    }

    /**
     * 取得欄位元素，找不到時丟出明確錯誤（避免 null.value 的 TypeError）。
     *
     * @param {string} id - 元素 id
     * @param {string} label - 欄位名稱（顯示用）
     * @returns {HTMLInputElement} 元素
     */
    function requireField(id, label) {
        const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
        if (!el) {
            throw new Error(`找不到欄位「${label}」(#${id})，請重新整理頁面`);
        }
        return el;
    }

    /**
     * 讀取並驗證「大於 0」的表單欄位。
     *
     * @param {string} id - 元素 id
     * @param {string} label - 欄位名稱（顯示用）
     * @returns {number} 已驗證的數值
     */
    function readPositiveField(id, label) {
        return parsePositiveNumber(requireField(id, label).value, label);
    }

    /**
     * 讀取並驗證「有限數值」的表單欄位。
     *
     * @param {string} id - 元素 id
     * @param {string} label - 欄位名稱（顯示用）
     * @returns {number} 已驗證的數值
     */
    function readFiniteField(id, label) {
        return parseFiniteNumber(requireField(id, label).value, label);
    }

    /**
     * 包一層 try/catch 的 Storage 存取器。
     * 儲存被封鎖時 get 回 null、set/remove 回 false，呼叫端照常運作。
     *
     * @param {function(): Storage|null} getStore - 延遲取得 Storage 的函式
     * @param {string} storeName - 名稱（僅用於 console 訊息）
     * @returns {{get: function(string): (string|null), set: function(string, string): boolean, remove: function(string): boolean}}
     */
    function createSafeStorage(getStore, storeName) {
        const warn = (action, err) => {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(`[${storeName}] ${action} 失敗（儲存可能被瀏覽器封鎖）:`, err && err.message ? err.message : err);
            }
        };
        return {
            get(key) {
                try {
                    const store = getStore();
                    return store ? store.getItem(key) : null;
                } catch (err) {
                    warn(`讀取 ${key}`, err);
                    return null;
                }
            },
            set(key, value) {
                try {
                    const store = getStore();
                    if (!store) return false;
                    store.setItem(key, value);
                    return true;
                } catch (err) {
                    warn(`寫入 ${key}`, err);
                    return false;
                }
            },
            remove(key) {
                try {
                    const store = getStore();
                    if (!store) return false;
                    store.removeItem(key);
                    return true;
                } catch (err) {
                    warn(`刪除 ${key}`, err);
                    return false;
                }
            }
        };
    }

    const safeLocal = createSafeStorage(
        () => (typeof window !== 'undefined' ? window.localStorage : null), 'localStorage');
    const safeSession = createSafeStorage(
        () => (typeof window !== 'undefined' ? window.sessionStorage : null), 'sessionStorage');

    global.FormUtils = Object.freeze({
        parsePositiveNumber,
        parseFiniteNumber,
        readPositiveField,
        readFiniteField,
        createSafeStorage,
        safeLocal,
        safeSession
    });
})(typeof window !== 'undefined' ? window : globalThis);
