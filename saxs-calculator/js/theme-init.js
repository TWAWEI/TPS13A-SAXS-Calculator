/**
 * TPS13A SAXS Calculator - 主題初始化（v5.0）
 *
 * 在 <head> 以同步 <script> 載入、排在所有 stylesheet 之前：第一次繪製前就把
 * <html data-theme> 設好，深色使用者才不會先看到淺色閃一下。
 *   - localStorage 'tps13a-theme' = 'light' | 'dark'；不存在或其他值 = 自動（跟隨系統）
 *   - 手動 → data-theme="light|dark"；自動 → 移除屬性，交給 tokens.css 的 media query
 *
 * 此時 form-utils.js 還沒載入，所以自己包 try/catch。頂層的設定動作只在有 document 時執行，
 * Node 測試（tests/load.js）可以直接載入本檔。
 */
(function attachThemeInit(global) {
    'use strict';

    const STORAGE_KEY = 'tps13a-theme';
    const DARK_QUERY = '(prefers-color-scheme: dark)';

    /** localStorage 原始值 → 'light' | 'dark' | 'auto' */
    function normalize(raw) {
        return raw === 'light' || raw === 'dark' ? raw : 'auto';
    }

    /** 使用者選擇＋系統是否深色 → 生效主題：手動優先，自動跟系統 */
    function resolve(choice, systemDark) {
        if (choice === 'light' || choice === 'dark') return choice;
        return systemDark ? 'dark' : 'light';
    }

    function systemPrefersDark() {
        return typeof global.matchMedia === 'function' && global.matchMedia(DARK_QUERY).matches;
    }

    /** 目前生效的主題（呼叫時才讀 DOM 與 matchMedia；沒有 document 時視為自動） */
    function effective() {
        const root = global.document && global.document.documentElement;
        const attr = root ? root.getAttribute('data-theme') : null;
        return resolve(normalize(attr), systemPrefersDark());
    }

    /** 讀使用者的選擇；儲存被封鎖時視為自動 */
    function readStored() {
        try {
            return normalize(global.localStorage.getItem(STORAGE_KEY));
        } catch (err) {
            console.warn('[theme] 無法讀取 localStorage，改用自動主題：', err && err.message ? err.message : err);
            return 'auto';
        }
    }

    /** 把選擇寫到 <html data-theme> */
    function apply(choice) {
        const root = global.document.documentElement;
        if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
        else root.removeAttribute('data-theme');
    }

    global.ThemeInit = Object.freeze({ STORAGE_KEY, DARK_QUERY, normalize, resolve, effective, readStored, apply });

    if (global.document) apply(readStored());
})(typeof window !== 'undefined' ? window : globalThis);
