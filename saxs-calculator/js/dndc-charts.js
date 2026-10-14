/**
 * TPS13A SAXS Calculator - dn/dc Charts Module
 * 使用 Chart.js 產生 dn/dc 相關圖表。顏色由 ChartTheme 依 tpsRole 決定（js/chart-theme.js）。
 */

// dn/dc 圖表共用設定（每次呼叫回傳新物件；顏色由 ChartTheme.colorize 填入）
function dndcChartDefaults() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    font: { family: ChartTheme.FONT, size: 12 }
                }
            },
            tooltip: {
                cornerRadius: 8,
                padding: 10,
                titleFont: { family: ChartTheme.FONT, size: 12 },
                bodyFont: { family: ChartTheme.MONO, size: 11 }
            },
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'xy'
                },
                zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    mode: 'xy'
                }
            }
        }
    };
}

/** 座標軸標題（斜體、系統字） */
function dndcAxisTitle(text) {
    return { display: true, text, font: { family: ChartTheme.FONT, size: 12, style: 'italic' } };
}

/**
 * 建立色譜圖（UV + RI 雙軸）
 * @param {string} canvasId - Canvas 元素 ID
 * @param {number[]} time - 時間陣列
 * @param {number[]} uvSignal - UV 訊號
 * @param {number[]} riSignal - RI 訊號
 * @param {object} [options] - 可選參數 { peakStart, peakEnd, uvBaseline, riBaseline }
 * @returns {Chart} Chart.js 實例
 */
function createChromatogramChart(canvasId, time, uvSignal, riSignal, options) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const datasets = [
        {
            label: 'UV (280 nm)',
            data: time.map((t, i) => ({ x: t, y: uvSignal[i] })),
            tpsRole: 'primary',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y'
        },
        {
            label: 'dRI',
            data: time.map((t, i) => ({ x: t, y: riSignal[i] })),
            tpsRole: 'model',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y1'
        }
    ];

    const annotations = {};
    if (options && options.peakStart != null && options.peakEnd != null) {
        annotations.peakRegion = {
            type: 'box',
            tpsRole: 'region',
            xMin: options.peakStart,
            xMax: options.peakEnd,
            borderWidth: 0
        };
        annotations.peakStartLine = {
            type: 'line',
            tpsRole: 'marker',
            xMin: options.peakStart, xMax: options.peakStart,
            borderWidth: 1.5,
            borderDash: [4, 4],
            label: { display: true, content: 'Peak', position: 'start', font: { size: 10 } }
        };
        annotations.peakEndLine = {
            type: 'line',
            tpsRole: 'marker',
            xMin: options.peakEnd, xMax: options.peakEnd,
            borderWidth: 1.5,
            borderDash: [4, 4]
        };
    }
    if (options && options.bl1Start != null) {
        annotations.bl1Region = {
            type: 'box',
            tpsRole: 'regionAlt',
            xMin: options.bl1Start, xMax: options.bl1End,
            borderWidth: 0
        };
        annotations.bl1Line = {
            type: 'line',
            tpsRole: 'residual',
            xMin: options.bl1Start, xMax: options.bl1Start,
            borderWidth: 1, borderDash: [3, 3],
            label: { display: true, content: 'BL1', position: 'start', font: { size: 10 } }
        };
    }
    if (options && options.bl2Start != null) {
        annotations.bl2Region = {
            type: 'box',
            tpsRole: 'regionAlt',
            xMin: options.bl2Start, xMax: options.bl2End,
            borderWidth: 0
        };
        annotations.bl2Line = {
            type: 'line',
            tpsRole: 'residual',
            xMin: options.bl2Start, xMax: options.bl2Start,
            borderWidth: 1, borderDash: [3, 3],
            label: { display: true, content: 'BL2', position: 'start', font: { size: 10 } }
        };
    }

    const base = dndcChartDefaults();
    return new Chart(ctx, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            ...base,
            showLine: true,
            plugins: {
                ...base.plugins,
                annotation: { annotations }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: dndcAxisTitle('Time (min)'),
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                },
                // 雙軸：軸線用該訊號的顏色，刻度與標題用文字色（標題寫明是哪個訊號）
                y: {
                    type: 'linear',
                    position: 'left',
                    tpsRole: 'primary',
                    title: dndcAxisTitle('UV (AU)'),
                    ticks: { font: { size: 10 } }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    tpsRole: 'model',
                    title: dndcAxisTitle('dRI (RIU)'),
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    }));
}

/**
 * 建立線性擬合圖
 * @param {string} canvasId - Canvas 元素 ID
 * @param {number[]} xData - X 軸資料（濃度）
 * @param {number[]} yData - Y 軸資料（ΔRI）
 * @param {object} fitResult - { dnDc, intercept, rSquared }
 * @param {object} [labels] - { xLabel, yLabel, title }
 * @returns {Chart} Chart.js 實例
 */
function createLinearFitChart(canvasId, xData, yData, fitResult, labels) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // 沒有資料點就不畫（空陣列會讓 Math.min() 回 Infinity）
    if (!Array.isArray(xData) || xData.length === 0) return null;

    const xLabel = (labels && labels.xLabel) || 'Concentration (g/mL)';
    const yLabel = (labels && labels.yLabel) || 'Δn (RIU)';

    // 擬合失敗（例如有效切片 < 2）時 fitResult 為 null：只畫散點，不解參考
    const hasFit = Boolean(fitResult) &&
        Number.isFinite(fitResult.dnDc) && Number.isFinite(fitResult.intercept);

    const datasets = [
        {
            label: 'Data',
            data: xData.map((x, i) => ({ x, y: yData[i] })),
            tpsRole: 'primary',
            pointRadius: 4,
            pointHoverRadius: 6
        }
    ];

    if (hasFit) {
        // 擬合線的端點
        const xMin = Math.min(...xData);
        const xMax = Math.max(...xData);
        const margin = (xMax - xMin) * 0.05;
        const fitLine = [
            { x: xMin - margin, y: fitResult.dnDc * (xMin - margin) + fitResult.intercept },
            { x: xMax + margin, y: fitResult.dnDc * (xMax + margin) + fitResult.intercept }
        ];
        const r2Text = Number.isFinite(fitResult.rSquared) ? fitResult.rSquared.toFixed(6) : '-';

        datasets.push({
            label: `Fit (dn/dc = ${fitResult.dnDc.toFixed(4)}, R² = ${r2Text})`,
            data: fitLine,
            tpsRole: 'fit',
            borderWidth: 2,
            pointRadius: 0,
            showLine: true,
            borderDash: [6, 3]
        });
    }

    return new Chart(ctx, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            ...dndcChartDefaults(),
            scales: {
                x: {
                    type: 'linear',
                    title: dndcAxisTitle(xLabel),
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    title: dndcAxisTitle(yLabel),
                    ticks: { font: { size: 10 } }
                }
            }
        }
    }));
}

window.DndcCharts = {
    createChromatogramChart,
    createLinearFitChart
};
