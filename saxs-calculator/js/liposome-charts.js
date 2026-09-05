/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：Chart.js 圖表
 *
 * 三張圖：
 *   renderDilutionChart — log-log：solution、bypass、bypass ÷ 稀釋因子（虛線），q 視窗用 box 註解標出
 *   renderSpectraChart  — 含藥、空白、扣背景三條線，三個讀值波長畫垂直線
 *   renderFitChart      — 含藥實測 vs（空白 + k×純 DOX）模型，殘差走第二 y 軸
 *
 * 每個 canvas 只保留一個 Chart 實例（Map<canvasId, Chart>），重畫前 destroy。
 * 顏色沿用 charts.js 的字面值先例（Chart.js 讀不到 CSS 變數）。
 * 依賴：全域 Chart（Chart.js 4）與 annotation 外掛（index.html 已載入）。
 */
(function attachLiposomeCharts(global) {
    'use strict';

    const LIPO_CHART_COLORS = Object.freeze({
        primary: '#F04E4E',                    // --color-accent-brand，僅限圖線
        reference: '#5a5a78',                  // --color-text-muted
        model: '#047857',                      // emerald 文字色（CLAUDE.md）
        residual: '#92400e',                   // --color-accent-tertiary-text
        window: 'rgba(240, 78, 78, 0.08)',
        marker: 'rgba(168, 85, 85, 0.55)',
        text: 'rgba(26, 26, 46, 0.65)',
        grid: 'rgba(26, 26, 46, 0.12)',
    });

    const FONT = "'Inter', sans-serif";
    const MONO = "'JetBrains Mono', monospace";
    const charts = new Map();

    function getChart(canvasId) {
        return charts.get(canvasId) || null;
    }

    function replaceChart(canvasId, config) {
        const canvas = typeof document !== 'undefined' ? document.getElementById(canvasId) : null;
        if (!canvas || typeof global.Chart !== 'function') return null;
        const old = charts.get(canvasId);
        if (old) old.destroy();
        const chart = new global.Chart(canvas, config);
        charts.set(canvasId, chart);
        return chart;
    }

    function axis(title, extra = {}) {
        return {
            title: { display: true, text: title, color: LIPO_CHART_COLORS.text, font: { family: FONT, size: 11 } },
            ticks: { color: LIPO_CHART_COLORS.text, font: { family: MONO, size: 10 } },
            grid: { color: LIPO_CHART_COLORS.grid },
            ...extra,
        };
    }

    function baseOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            normalized: true,
            plugins: {
                legend: { labels: { color: LIPO_CHART_COLORS.text, font: { family: FONT, size: 11 } } },
                tooltip: {
                    backgroundColor: 'rgba(80, 20, 20, 0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255, 255, 255, 0.85)',
                    borderColor: 'rgba(240, 78, 78, 0.35)',
                    borderWidth: 1,
                    cornerRadius: 4,
                    padding: 8,
                    titleFont: { family: FONT, size: 12 },
                    bodyFont: { family: MONO, size: 11 },
                },
            },
        };
    }

    function line(label, xs, ys, color, extra = {}) {
        return {
            label,
            data: xs.map((x, k) => ({ x, y: ys[k] })),
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            ...extra,
        };
    }

    /** log-log 只能畫正值。 */
    function positivePoints(xs, ys) {
        const px = [];
        const py = [];
        xs.forEach((x, k) => {
            if (x > 0 && ys[k] > 0) { px.push(x); py.push(ys[k]); }
        });
        return { px, py };
    }

    /**
     * @param {string} canvasId
     * @param {{solution:{q:number[],i:number[]}, bypass:{q:number[],i:number[]}, factor:number, qMin:number, qMax:number}} p
     */
    function renderDilutionChart(canvasId, p) {
        const sol = positivePoints(p.solution.q, p.solution.i);
        const byp = positivePoints(p.bypass.q, p.bypass.i);
        const scaled = byp.py.map(y => y / p.factor);
        const options = baseOptions();
        options.scales = {
            x: axis('q (Å⁻¹)', { type: 'logarithmic' }),
            y: axis('I(q)', { type: 'logarithmic' }),
        };
        options.plugins.annotation = {
            annotations: {
                window: {
                    type: 'box',
                    xMin: p.qMin,
                    xMax: p.qMax,
                    backgroundColor: LIPO_CHART_COLORS.window,
                    borderWidth: 0,
                    label: { display: true, content: 'q 視窗', position: 'start', font: { size: 10 }, color: LIPO_CHART_COLORS.text },
                },
            },
        };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('solution cell', sol.px, sol.py, LIPO_CHART_COLORS.primary),
                    line('bypass', byp.px, byp.py, LIPO_CHART_COLORS.reference),
                    line(`bypass ÷ ${p.factor.toPrecision(4)}`, byp.px, scaled, LIPO_CHART_COLORS.model, { borderDash: [5, 4] }),
                ],
            },
            options,
        });
    }

    /**
     * @param {string} canvasId
     * @param {{loaded, blank, subtracted, wavelengths:number[]}} p - 三條 {wavelength, absorbance}
     */
    function renderSpectraChart(canvasId, p) {
        const options = baseOptions();
        const dataLo = p.loaded.wavelength[0];
        const dataHi = p.loaded.wavelength[p.loaded.wavelength.length - 1];
        const lo = Math.max(dataLo, 250);
        const hi = Math.min(dataHi, 600);
        const useClip = hi > lo;
        options.scales = {
            x: axis('波長 (nm)', { type: 'linear', min: useClip ? lo : dataLo, max: useClip ? hi : dataHi }),
            y: axis('吸光度 (A.U.)', { type: 'linear' }),
        };
        const annotations = {};
        p.wavelengths.forEach((w, k) => {
            annotations[`wl${k}`] = {
                type: 'line',
                xMin: w,
                xMax: w,
                borderColor: LIPO_CHART_COLORS.marker,
                borderWidth: 1,
                borderDash: [3, 3],
                label: { display: k === 1, content: `${w} nm`, position: 'end', font: { size: 10 }, color: LIPO_CHART_COLORS.text },
            };
        });
        options.plugins.annotation = { annotations };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('含藥 (Chol-DOX-Liposome)', p.loaded.wavelength, p.loaded.absorbance, LIPO_CHART_COLORS.reference),
                    line('空白 (Chol-Liposome)', p.blank.wavelength, p.blank.absorbance, LIPO_CHART_COLORS.model),
                    line('扣背景 (純 DOX 訊號)', p.subtracted.wavelength, p.subtracted.absorbance, LIPO_CHART_COLORS.primary, { borderWidth: 2 }),
                ],
            },
            options,
        });
    }

    /**
     * @param {string} canvasId
     * @param {{loaded, model, residual}} p - {wavelength, absorbance} ×3
     */
    function renderFitChart(canvasId, p) {
        const options = baseOptions();
        options.scales = {
            x: axis('波長 (nm)', { type: 'linear' }),
            y: axis('吸光度 (A.U.)', { type: 'linear', position: 'left' }),
            y1: axis('殘差', { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }),
        };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('含藥實測', p.loaded.wavelength, p.loaded.absorbance, LIPO_CHART_COLORS.primary, { yAxisID: 'y' }),
                    line('空白 + k×純 DOX', p.model.wavelength, p.model.absorbance, LIPO_CHART_COLORS.model, { yAxisID: 'y', borderDash: [5, 4] }),
                    line('殘差', p.residual.wavelength, p.residual.absorbance, LIPO_CHART_COLORS.residual, { yAxisID: 'y1', borderWidth: 1 }),
                ],
            },
            options,
        });
    }

    global.LiposomeCharts = Object.freeze({
        LIPO_CHART_COLORS,
        getChart,
        renderDilutionChart,
        renderSpectraChart,
        renderFitChart,
    });
})(typeof window !== 'undefined' ? window : globalThis);
