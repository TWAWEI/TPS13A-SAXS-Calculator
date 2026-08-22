'use strict';
/**
 * 9M 偵測器行程上下限提示 — 共用文案與元素套用
 *
 * SAXS 結構參數頁的「偵測器距離建議」面板與「偵測器」頁顯示同一段警告，
 * 文案只能有一份：兩邊各寫一次遲早會漂移，使用者在兩頁看到不同數字就不會再信任工具。
 *
 * 行程與夾限後的 qmin 由 SAXSCalculations.calculateDetectorDistance 算好（sdStatus /
 * sdLimit / qminAtLimit / qRgAtLimit），這裡只負責格式化與顯示，不做科學計算。
 */
(function () {
    /** 建議值超出行程時，貼在 SD 數字旁的徽章文字。 */
    const LIMIT_BADGE_TEXT = '超出行程';

    /** qmin·Rg 在本模型恆為 0.224（BSA 錨點 0.008 × 28）；above 時附上讓使用者比對。 */
    const BSA_QRG_REFERENCE = 0.224;

    function formatMm(mm) {
        return Number(mm).toLocaleString('en-US');
    }

    /**
     * 產生一行提示文字。
     *
     * @param {object|null} result - calculateDetectorDistance 的回傳值
     * @returns {string|null} 需要提示時回傳文字，行程內或無結果時回 null
     */
    function describe(result) {
        if (!result || result.sdStatus === 'ok' || !result.sdStatus) return null;
        if (!Number.isFinite(result.qminAtLimit) || !Number.isFinite(result.qRgAtLimit)) return null;

        const limit = formatMm(result.sdLimit);
        const qmin = result.qminAtLimit.toFixed(4);
        const qRg = result.qRgAtLimit.toFixed(2);

        if (result.sdStatus === 'below') {
            // below 時 q·Rg 一定小於 0.224，沒有判讀疑慮，不附基準值
            return `⚠️ 低於 9M 最近行程 ${limit} mm — 請設 ${limit} mm，`
                + `此時 qmin ≈ ${qmin} Å⁻¹（q·Rg = ${qRg}）`;
        }
        return `⚠️ 超過 9M 最遠行程 ${limit} mm — 請設 ${limit} mm，`
            + `此時 qmin ≈ ${qmin} Å⁻¹（q·Rg = ${qRg}，BSA 基準 ${BSA_QRG_REFERENCE.toFixed(2)}）`;
    }

    /**
     * 把提示與徽章套到指定元素上；result 為 null／行程內時兩者都隱藏。
     * 文字一律走 textContent，不碰 innerHTML。
     */
    function apply(hintEl, badgeEl, result) {
        const text = describe(result);
        if (hintEl) {
            hintEl.textContent = text === null ? '' : text;
            hintEl.hidden = text === null;
        }
        if (badgeEl) {
            badgeEl.textContent = LIMIT_BADGE_TEXT;
            badgeEl.hidden = text === null;
        }
    }

    window.DetectorLimits = Object.freeze({
        describe,
        apply,
        LIMIT_BADGE_TEXT,
    });
})();
