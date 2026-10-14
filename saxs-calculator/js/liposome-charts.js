/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：Chart.js 圖表
 *
 * 三張圖：
 *   renderDilutionChart — log-log：solution、bypass、bypass ÷ 稀釋因子（虛線），q 視窗用 box 註解標出
 *   renderSpectraChart  — 含藥、空白、扣背景三條線，三個讀值波長畫垂直線
 *   renderFitChart      — 含藥實測 vs（空白 + k×純 DOX）模型，殘差走第二 y 軸
 *
 * 每個 canvas 只保留一個 Chart 實例（Map<canvasId, Chart>），重畫前 destroy。
 * 顏色由 ChartTheme 依 tpsRole 決定（js/chart-theme.js）；本檔只標用途。
 * 依賴：全域 Chart（Chart.js 4）與 annotation 外掛（index.html 已載入）、ChartTheme（呼叫時才取用）。
 */
(function attachLiposomeCharts(global) {
    'use strict';

    const charts = new Map();

    function getChart(canvasId) {
        return charts.get(canvasId) || null;
    }

    /** 銷毀並移除某 canvas 的實例；沒有就 no-op（例如這次沒有純 DOX 檔，要收掉上次的擬合圖）。 */
    function destroyChart(canvasId) {
        const old = charts.get(canvasId);
        if (!old) return;
        old.destroy();
        charts.delete(canvasId);
    }

    function replaceChart(canvasId, config) {
        const canvas = typeof document !== 'undefined' ? document.getElementById(canvasId) : null;
        if (!canvas || typeof global.Chart !== 'function') return null;
        destroyChart(canvasId);
        const chart = new global.Chart(canvas, global.ChartTheme.colorize(config));
        charts.set(canvasId, chart);
        return chart;
    }

    function axis(title, extra = {}) {
        const { ChartTheme } = global;
        return {
            title: { display: true, text: title, font: { family: ChartTheme.FONT, size: 11 } },
            ticks: { font: { family: ChartTheme.MONO, size: 10 } },
            ...extra,
        };
    }

    /** x 軸：只留水平格線 */
    function xAxis(title, extra = {}) {
        return axis(title, { grid: { display: false }, ...extra });
    }

    function baseOptions() {
        const { ChartTheme } = global;
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            normalized: true,
            plugins: {
                legend: { labels: { font: { family: ChartTheme.FONT, size: 12 } } },
                tooltip: {
                    cornerRadius: 8,
                    padding: 10,
                    titleFont: { family: ChartTheme.FONT, size: 12 },
                    bodyFont: { family: ChartTheme.MONO, size: 11 },
                },
            },
        };
    }

    /** role：ChartTheme 的用途名稱（primary／reference／model／residual） */
    function line(label, xs, ys, role, extra = {}) {
        return {
            label,
            data: xs.map((x, k) => ({ x, y: ys[k] })),
            tpsRole: role,
            borderWidth: 2,
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
        if (!(Number.isFinite(p.factor) && p.factor > 0)) throw new Error('稀釋因子必須是正數');
        const sol = positivePoints(p.solution.q, p.solution.i);
        const byp = positivePoints(p.bypass.q, p.bypass.i);
        const scaled = byp.py.map(y => y / p.factor);
        const options = baseOptions();
        options.scales = {
            x: xAxis('q (Å⁻¹)', { type: 'logarithmic' }),
            y: axis('I(q)', { type: 'logarithmic' }),
        };
        options.plugins.annotation = {
            annotations: {
                window: {
                    type: 'box',
                    tpsRole: 'region',
                    xMin: p.qMin,
                    xMax: p.qMax,
                    borderWidth: 0,
                    label: { display: true, content: 'q 視窗', position: 'start', font: { size: 10 } },
                },
            },
        };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('solution cell', sol.px, sol.py, 'primary'),
                    line('bypass', byp.px, byp.py, 'reference'),
                    line(`bypass ÷ ${p.factor.toPrecision(4)}`, byp.px, scaled, 'model', { borderDash: [5, 4] }),
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
            x: xAxis('波長 (nm)', { type: 'linear', min: useClip ? lo : dataLo, max: useClip ? hi : dataHi }),
            y: axis('吸光度 (A.U.)', { type: 'linear' }),
        };
        const annotations = {};
        p.wavelengths.forEach((w, k) => {
            annotations[`wl${k}`] = {
                type: 'line',
                tpsRole: 'marker',
                xMin: w,
                xMax: w,
                borderWidth: 1,
                borderDash: [3, 3],
                label: { display: k === 1, content: `${w} nm`, position: 'end', font: { size: 10 } },
            };
        });
        options.plugins.annotation = { annotations };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('含藥 (Chol-DOX-Liposome)', p.loaded.wavelength, p.loaded.absorbance, 'reference'),
                    line('空白 (Chol-Liposome)', p.blank.wavelength, p.blank.absorbance, 'model'),
                    line('扣背景 (純 DOX 訊號)', p.subtracted.wavelength, p.subtracted.absorbance, 'primary', { borderWidth: 2.5 }),
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
            x: xAxis('波長 (nm)', { type: 'linear' }),
            y: axis('吸光度 (A.U.)', { type: 'linear', position: 'left' }),
            y1: axis('殘差', { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }),
        };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('含藥實測', p.loaded.wavelength, p.loaded.absorbance, 'primary', { yAxisID: 'y' }),
                    line('空白 + k×純 DOX', p.model.wavelength, p.model.absorbance, 'model', { yAxisID: 'y', borderDash: [5, 4] }),
                    line('殘差', p.residual.wavelength, p.residual.absorbance, 'residual', { yAxisID: 'y1', borderWidth: 1.5 }),
                ],
            },
            options,
        });
    }

    global.LiposomeCharts = Object.freeze({
        getChart,
        destroyChart,
        renderDilutionChart,
        renderSpectraChart,
        renderFitChart,
    });
})(typeof window !== 'undefined' ? window : globalThis);
