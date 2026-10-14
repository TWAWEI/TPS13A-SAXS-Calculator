/**
 * TPS13A SAXS Calculator - 側欄「自動／淺色／深色」切換（v5.0）
 *
 * index.html 的 <fieldset id="themeToggle"> 是三個原生 radio：方向鍵切換、Tab 進出都是瀏覽器內建行為。
 * 變更時寫 localStorage（FormUtils.safeLocal）、更新 <html data-theme>，並在 document 派發
 *   CustomEvent('tps:themechange', { detail: { theme: 'light' | 'dark' } })   // theme = 生效主題
 * 圖表（ChartTheme.init）與 HPLC 通道膠囊（initChannelChipTheme）靠這個事件換色。
 * 自動模式下系統外觀改變時也派發同一個事件。
 *
 * 由 app.js 的 DOMContentLoaded 呼叫 ThemeToggle.init()。
 */
(function attachThemeToggle(global) {
    'use strict';

    const EVENT = 'tps:themechange';

    function dispatch() {
        global.document.dispatchEvent(new CustomEvent(EVENT, { detail: { theme: ThemeInit.effective() } }));
    }

    /** 套用一個選擇：寫入儲存（失敗時本次頁面照樣切換，下次開頁回到自動）、更新屬性、派發事件 */
    function choose(choice) {
        const normalized = ThemeInit.normalize(choice);
        const saved = normalized === 'auto'
            ? FormUtils.safeLocal.remove(ThemeInit.STORAGE_KEY)
            : FormUtils.safeLocal.set(ThemeInit.STORAGE_KEY, normalized);
        if (!saved) console.warn('[theme] 無法儲存外觀設定，只在這次開頁有效');
        ThemeInit.apply(normalized);
        dispatch();
    }

    function init() {
        const fieldset = global.document.getElementById('themeToggle');
        if (!fieldset) return;

        const current = ThemeInit.readStored();
        fieldset.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.checked = radio.value === current;
            radio.addEventListener('change', () => {
                if (radio.checked) choose(radio.value);
            });
        });

        // 自動模式（沒有 data-theme）時跟著系統外觀變；手動模式不理會系統
        if (typeof global.matchMedia === 'function') {
            global.matchMedia(ThemeInit.DARK_QUERY).addEventListener('change', () => {
                if (!global.document.documentElement.hasAttribute('data-theme')) dispatch();
            });
        }
    }

    global.ThemeToggle = Object.freeze({ EVENT, init });
})(typeof window !== 'undefined' ? window : globalThis);
