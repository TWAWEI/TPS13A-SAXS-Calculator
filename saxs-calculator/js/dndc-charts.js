/**
 * TPS13A SAXS Calculator - dn/dc Charts Module
 * 使用 Chart.js 產生 dn/dc 相關圖表
 */

const DNDC_CHART_COLORS = {
    uv: 'rgba(45, 49, 146, 0.85)',
    ri: 'rgba(26, 122, 76, 0.85)',
    baseline: 'rgba(180, 83, 9, 0.6)',
    fit: 'rgba(196, 43, 28, 0.85)',
    scatter: 'rgba(45, 49, 146, 0.7)',
    peakRegion: 'rgba(45, 49, 146, 0.08)',
    grid: 'rgba(26, 26, 46, 0.08)',
    text: 'rgba(26, 26, 46, 0.7)'
};

const dndcChartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            labels: {
                color: DNDC_CHART_COLORS.text,
                font: { family: "'Inter', sans-serif", size: 12 }
            }
        },
        tooltip: {
            backgroundColor: 'rgba(26, 26, 46, 0.92)',
            titleColor: '#fff',
            bodyColor: 'rgba(255, 255, 255, 0.85)',
            borderColor: 'rgba(26, 26, 46, 0.2)',
            borderWidth: 1,
            cornerRadius: 4,
            padding: 8,
            titleFont: { family: "'Inter', sans-serif", size: 12 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 }
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
            borderColor: DNDC_CHART_COLORS.uv,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y'
        },
        {
            label: 'dRI',
            data: time.map((t, i) => ({ x: t, y: riSignal[i] })),
            borderColor: DNDC_CHART_COLORS.ri,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y1'
        }
    ];

    const annotations = {};
    if (options && options.peakStart != null && options.peakEnd != null) {
        annotations.peakRegion = {
            type: 'box',
            xMin: options.peakStart,
            xMax: options.peakEnd,
            backgroundColor: DNDC_CHART_COLORS.peakRegion,
            borderWidth: 0
        };
        annotations.peakStartLine = {
            type: 'line',
            xMin: options.peakStart, xMax: options.peakStart,
            borderColor: 'rgba(99, 102, 241, 0.6)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            label: { display: true, content: 'Peak', position: 'start', font: { size: 9 }, color: 'rgba(99, 102, 241, 0.8)' }
        };
        annotations.peakEndLine = {
            type: 'line',
            xMin: options.peakEnd, xMax: options.peakEnd,
            borderColor: 'rgba(99, 102, 241, 0.6)',
            borderWidth: 1.5,
            borderDash: [4, 4]
        };
    }
    if (options && options.bl1Start != null) {
        annotations.bl1Region = {
            type: 'box',
            xMin: options.bl1Start, xMax: options.bl1End,
            backgroundColor: 'rgba(180, 83, 9, 0.08)',
            borderWidth: 0
        };
        annotations.bl1Line = {
            type: 'line',
            xMin: options.bl1Start, xMax: options.bl1Start,
            borderColor: DNDC_CHART_COLORS.baseline,
            borderWidth: 1, borderDash: [3, 3],
            label: { display: true, content: 'BL1', position: 'start', font: { size: 9 }, color: DNDC_CHART_COLORS.baseline }
        };
    }
    if (options && options.bl2Start != null) {
        annotations.bl2Region = {
            type: 'box',
            xMin: options.bl2Start, xMax: options.bl2End,
            backgroundColor: 'rgba(180, 83, 9, 0.08)',
            borderWidth: 0
        };
        annotations.bl2Line = {
            type: 'line',
            xMin: options.bl2Start, xMax: options.bl2Start,
            borderColor: DNDC_CHART_COLORS.baseline,
            borderWidth: 1, borderDash: [3, 3],
            label: { display: true, content: 'BL2', position: 'start', font: { size: 9 }, color: DNDC_CHART_COLORS.baseline }
        };
    }

    return new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            ...dndcChartDefaults,
            showLine: true,
            plugins: {
                ...dndcChartDefaults.plugins,
                annotation: { annotations }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (min)',
                        color: DNDC_CHART_COLORS.text,
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: DNDC_CHART_COLORS.text, font: { size: 10 } },
                    grid: { color: DNDC_CHART_COLORS.grid }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'UV (AU)',
                        color: DNDC_CHART_COLORS.uv,
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: DNDC_CHART_COLORS.uv, font: { size: 10 } },
                    grid: { color: DNDC_CHART_COLORS.grid }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'dRI (RIU)',
                        color: DNDC_CHART_COLORS.ri,
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: DNDC_CHART_COLORS.ri, font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    });
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

    const xLabel = (labels && labels.xLabel) || 'Concentration (g/mL)';
    const yLabel = (labels && labels.yLabel) || 'Δn (RIU)';

    // 擬合線的端點
    const xMin = Math.min(...xData);
    const xMax = Math.max(...xData);
    const margin = (xMax - xMin) * 0.05;
    const fitLine = [
        { x: xMin - margin, y: fitResult.dnDc * (xMin - margin) + fitResult.intercept },
        { x: xMax + margin, y: fitResult.dnDc * (xMax + margin) + fitResult.intercept }
    ];

    return new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Data',
                    data: xData.map((x, i) => ({ x, y: yData[i] })),
                    backgroundColor: DNDC_CHART_COLORS.scatter,
                    borderColor: DNDC_CHART_COLORS.scatter,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: `Fit (dn/dc = ${fitResult.dnDc.toFixed(4)}, R² = ${fitResult.rSquared.toFixed(6)})`,
                    data: fitLine,
                    borderColor: DNDC_CHART_COLORS.fit,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    showLine: true,
                    borderDash: [6, 3]
                }
            ]
        },
        options: {
            ...dndcChartDefaults,
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: xLabel,
                        color: DNDC_CHART_COLORS.text,
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: DNDC_CHART_COLORS.text, font: { size: 10 } },
                    grid: { color: DNDC_CHART_COLORS.grid }
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: yLabel,
                        color: DNDC_CHART_COLORS.text,
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: DNDC_CHART_COLORS.text, font: { size: 10 } },
                    grid: { color: DNDC_CHART_COLORS.grid }
                }
            }
        }
    });
}

window.DndcCharts = {
    DNDC_CHART_COLORS,
    createChromatogramChart,
    createLinearFitChart
};
