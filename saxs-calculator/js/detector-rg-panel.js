'use strict';
/**
 * 偵測器距離建議面板（SAXS 結構參數頁）— Rg 輸入與來源管理
 *
 * 三個 Rg 來源：
 *   predicted — 由 MW 推得（calculateDetectorDistance 的 MW^⅓ 球狀模型，BSA 28 Å ↔ 1900 mm）
 *   manual    — 使用者直接在面板輸入框改的值
 *   measured  — 下方「量測結果輸入」的 Guinier Rg
 *
 * 規則（2026-08-21 與使用者確認）：
 *   - 序列分析／MW 改變只更新 predicted；面板若在 manual/measured 來源則不自動切換
 *   - 出現有效的 Guinier Rg 時只顯示「↺ 改用實測」連結，使用者點了才切
 *   - 輸入框空白或 ≤0 → 三個建議值顯示 "--" 並提示，不靜默沿用舊值
 */
(function () {
    const SOURCE_LABEL = Object.freeze({
        predicted: '序列預測',
        manual: '手動',
        measured: 'Guinier 實測',
    });

    const state = {
        source: 'predicted',
        predicted: null,   // Å，由 MW 推得
        manual: null,      // Å，使用者輸入
        measured: null,    // Å，Guinier
    };

    const els = {};

    function $(id) { return document.getElementById(id); }

    function currentRg() {
        if (state.source === 'manual') return state.manual;
        if (state.source === 'measured') return state.measured;
        return state.predicted;
    }

    function isValidRg(v) {
        return Number.isFinite(v) && v > 0;
    }

    function setChip(source) {
        if (!els.chip) return;
        els.chip.textContent = SOURCE_LABEL[source];
        els.chip.className = `info-panel-chip info-panel-chip--${source}`;
        els.chip.title = source === 'predicted'
            ? 'Rg = 0.6906 × MW^⅓（球狀蛋白，Excel 偵測器表校正：BSA 28 Å ↔ 1900 mm）'
            : source === 'manual' ? '使用者輸入的 Rg' : '來自下方「Rg from Guinier」欄位';
    }

    function renderValues(rg) {
        if (!isValidRg(rg)) {
            if (els.qmin) els.qmin.textContent = '--';
            if (els.sd) els.sd.textContent = '--';
            if (els.qrange) els.qrange.textContent = '--';
            if (els.hint) { els.hint.textContent = '請輸入大於 0 的 Rg (Å)'; els.hint.hidden = false; }
            // 沒有有效 Rg 就沒有行程可判斷，別留著上一次的警告
            window.DetectorLimits.apply(els.sdLimitHint, els.sdBadge, null);
            return;
        }
        if (els.hint) els.hint.hidden = true;
        const r = window.SAXSCalculations.calculateDetectorDistance(rg, 'rg');
        if (els.qmin) els.qmin.textContent = r.qmin.toFixed(4);
        if (els.sd) els.sd.textContent = r.suggestedSD.toLocaleString('en-US');
        if (els.qrange) els.qrange.textContent = `${r.qmin.toFixed(3)}-0.4`;
        // 建議值超出 9M 行程時補上警告與徽章（值本身不夾）
        window.DetectorLimits.apply(els.sdLimitHint, els.sdBadge, r);
    }

    function renderLinks() {
        const shown = currentRg();
        const cmp = window.SAXSCalculations.compareRg;

        // 回到序列預測：只有離開 predicted 且 predicted 可用時顯示
        if (els.resetLink) {
            const show = state.source !== 'predicted' && isValidRg(state.predicted);
            els.resetLink.hidden = !show;
            if (show) els.resetLink.textContent = `↺ 回到序列預測 ${state.predicted.toFixed(1)}`;
        }
        // 改用實測：有有效 Guinier 值、且與目前顯示的 Rg 不同時顯示（只提示不自動切）
        if (els.measuredLink) {
            const differs = isValidRg(state.measured)
                && !(isValidRg(shown) && Math.abs(shown - state.measured) < 0.005);
            els.measuredLink.hidden = !differs;
            if (differs) {
                const diff = isValidRg(state.predicted) ? cmp(state.measured, state.predicted) : null;
                const diffText = diff === null ? '' : `（比預測 ${diff.percent >= 0 ? '+' : '−'}${Math.abs(diff.percent).toFixed(0)}%）`;
                els.measuredLink.textContent = `↺ 改用實測 ${state.measured.toFixed(1)}${diffText}`;
            }
        }
    }

    function render() {
        const rg = currentRg();
        if (els.input && document.activeElement !== els.input) {
            els.input.value = isValidRg(rg) ? rg.toFixed(1) : '';
        }
        setChip(state.source);
        renderValues(rg);
        renderLinks();
    }

    function switchTo(source) {
        state.source = source;
        render();
    }

    /** 序列分析或理論面板 MW 改變時呼叫：只更新 predicted，不改來源。 */
    function setPredictedFromMw(mw) {
        if (!Number.isFinite(mw) || mw <= 0) {
            state.predicted = null;
        } else {
            state.predicted = window.SAXSCalculations.calculateDetectorDistance(mw, 'mw').rg;
        }
        render();
    }

    /** Guinier Rg 欄位變動或 SAXS 計算後呼叫：只記錄並提示，不自動切換。 */
    function notifyMeasured(rg) {
        state.measured = isValidRg(rg) ? rg : null;
        if (state.source === 'measured' && state.measured === null) {
            // 實測值被清掉：退回預測，避免面板掛在一個不存在的來源上
            state.source = isValidRg(state.predicted) ? 'predicted' : 'manual';
        }
        render();
    }

    function onManualInput() {
        const v = parseFloat(els.input.value);
        state.manual = Number.isFinite(v) ? v : null;
        state.source = 'manual';
        setChip('manual');
        renderValues(state.manual);
        renderLinks();
    }

    function init() {
        els.input = $('detectorRgInput');
        els.chip = $('detectorRgSource');
        els.qmin = $('suggestedQminDisplay');
        els.sd = $('suggestedSDDisplay');
        els.qrange = $('suggestedQrangeDisplay');
        els.hint = $('detectorRgHint');
        els.sdLimitHint = $('detectorSdLimitHint');
        els.sdBadge = $('suggestedSDBadge');
        els.resetLink = $('detectorRgReset');
        els.measuredLink = $('detectorRgUseMeasured');
        if (!els.input) return;

        els.input.addEventListener('input', onManualInput);
        els.resetLink?.addEventListener('click', () => switchTo('predicted'));
        els.measuredLink?.addEventListener('click', () => switchTo('measured'));

        const guinier = $('rgGuinier');
        if (guinier) {
            guinier.addEventListener('input', () => notifyMeasured(parseFloat(guinier.value)));
            if (guinier.value) notifyMeasured(parseFloat(guinier.value));
        }
        render();
    }

    window.DetectorRgPanel = Object.freeze({
        init,
        setPredictedFromMw,
        notifyMeasured,
        getState: () => ({ ...state, shown: currentRg() }),
    });
})();
