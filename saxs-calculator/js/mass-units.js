/**
 * TPS13A SAXS Calculator - 分子量單位（v5.1）
 *
 * 計算函式與 Excel 對照一律用 Da；畫面（輸入欄位與結果）一律用 kDa。換算只發生在這裡：
 *   讀欄位：kDaToDa(數值)            寫欄位：writeInput(el, da)
 *   顯示：  formatKDa(da) + ' kDa'   （蛋白質頁另有 formatDa 的 Da 精確值）
 *
 * 欄位值超過 10,000 kDa（10 MDa）多半是照舊習慣輸入了 Da：欄位下方提示，但照樣計算。
 * 本檔頂層只定義常數與函式，不碰 document（Node 測試也會載入本檔）。
 */
(function attachMassUnits(global) {
    'use strict';

    const DA_PER_KDA = 1000;
    const DISPLAY_DECIMALS = 2;
    const INPUT_DECIMALS = 3;            // 自動帶入的精度：0.001 kDa = 1 Da
    const WARN_ABOVE_KDA = 10000;
    const STATE_UNIT = 'kDa';            // form-persistence 存檔裡的單位標記
    const HINT_SUFFIX = 'UnitHint';

    /** 收分子量的 5 個欄位（v5.0 以前收 Da） */
    const INPUT_IDS = Object.freeze([
        'theoreticalMWInput',   // SAXS 理論值面板
        'inputMw',              // 樣品計算
        'mwInput',              // 分子量解析度
        'centrifugeMw',         // 離心參數
        'targetProteinMW',      // 偵測器距離
    ]);

    const HINT_TEXT = '超過 10,000 kDa（10 MDa），是不是輸入了 Da？例：66500 Da 請輸入 66.5';

    const daToKDa = da => da / DA_PER_KDA;
    const kDaToDa = kDa => kDa * DA_PER_KDA;

    /** 固定 en-US：千分位與 NaN 的寫法不隨瀏覽器語系變動 */
    function formatFixed(value, decimals) {
        if (!Number.isFinite(value)) return '-';
        return value.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
    }

    /** Da → kDa 顯示字串（2 位小數、千分位）；非有限值回 '-' */
    const formatKDa = da => formatFixed(Number.isFinite(da) ? daToKDa(da) : NaN, DISPLAY_DECIMALS);

    /** Da 顯示字串（2 位小數、千分位）；只用在蛋白質頁的精確值 */
    const formatDa = da => formatFixed(da, DISPLAY_DECIMALS);

    /** Da → 欄位值（kDa，最多 3 位小數、去掉尾端 0）；非有限值回 '' */
    function toInputValue(da) {
        if (!Number.isFinite(da)) return '';
        return String(Number(daToKDa(da).toFixed(INPUT_DECIMALS)));
    }

    const isLikelyDa = kDa => Number.isFinite(kDa) && kDa > WARN_ABOVE_KDA;

    /** 欄位字串 → 提示文字（不需要提示時回 ''） */
    function hintMessage(value) {
        const text = typeof value === 'string' ? value.trim() : '';
        return text !== '' && isLikelyDa(Number(text)) ? HINT_TEXT : '';
    }

    /**
     * v5.0 以前的存檔（Da）→ kDa。只換 INPUT_IDS 裡的數值字串，其餘原樣；回傳新物件。
     *
     * @param {Object<string, string|boolean>} values - 存檔的欄位值
     * @returns {Object<string, string|boolean>} 換算後的新物件
     */
    function migrateSavedValues(values) {
        const migrated = { ...values };
        INPUT_IDS.forEach(id => {
            const raw = migrated[id];
            if (typeof raw !== 'string' || raw.trim() === '') return;
            const da = Number(raw);
            if (Number.isFinite(da)) migrated[id] = toInputValue(da);
        });
        return migrated;
    }

    function hintFor(input) {
        return input.ownerDocument.getElementById(input.id + HINT_SUFFIX);
    }

    function refreshHint(input) {
        const hint = hintFor(input);
        if (!hint) return;
        const message = hintMessage(input.value);
        if (hint.textContent !== message) hint.textContent = message;
    }

    /** 自動帶入（序列分析結果）：寫入 kDa 值並更新提示——程式設值不會觸發 input 事件 */
    function writeInput(input, da) {
        if (!input) return;
        input.value = toInputValue(da);
        refreshHint(input);
    }

    /**
     * 在欄位後面建立提示元素：表單列表放在 .form-input-group 之後（該列 flex-wrap，提示自成一行），
     * 理論值面板放在 .info-panel-header 之後。元素一直存在、空白時由 CSS 隱藏，aria-live 才讀得到。
     */
    function createHint(doc, input) {
        const anchor = input.closest('.form-input-group') || input.closest('.info-panel-header');
        if (!anchor) return;
        const hint = doc.createElement('p');
        hint.className = 'field-warning';
        hint.id = input.id + HINT_SUFFIX;
        hint.setAttribute('aria-live', 'polite');
        anchor.after(hint);

        const describedBy = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        input.setAttribute('aria-describedby', [...describedBy, hint.id].join(' '));
    }

    /** 由 app.js 在 initFormPersistence 之後呼叫：當下的值（可能是剛還原的）也會檢查 */
    function initInputHints(doc = global.document) {
        if (!doc) return;
        INPUT_IDS.forEach(id => {
            const input = doc.getElementById(id);
            if (!input) return;
            if (!hintFor(input)) createHint(doc, input);
            const update = () => refreshHint(input);
            input.addEventListener('input', update);
            input.addEventListener('change', update);
            update();
        });
    }

    global.MassUnits = Object.freeze({
        DA_PER_KDA,
        WARN_ABOVE_KDA,
        STATE_UNIT,
        INPUT_IDS,
        daToKDa,
        kDaToDa,
        formatKDa,
        formatDa,
        toInputValue,
        isLikelyDa,
        hintMessage,
        migrateSavedValues,
        writeInput,
        initInputHints,
    });
})(typeof window !== 'undefined' ? window : globalThis);
