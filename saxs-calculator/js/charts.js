/**
 * TPS13A SAXS Calculator - Charts Module
 * 使用 Chart.js 產生視覺化圖表
 */

// 顏色配置
const CHART_COLORS = {
    primary: 'rgba(99, 102, 241, 1)',      // Indigo
    primaryLight: 'rgba(99, 102, 241, 0.2)',
    secondary: 'rgba(16, 185, 129, 1)',    // Emerald
    secondaryLight: 'rgba(16, 185, 129, 0.2)',
    tertiary: 'rgba(245, 158, 11, 1)',     // Amber
    tertiaryLight: 'rgba(245, 158, 11, 0.2)',
    danger: 'rgba(239, 68, 68, 1)',        // Red
    dangerLight: 'rgba(239, 68, 68, 0.2)',
    text: 'rgba(226, 232, 240, 1)',        // Slate 200
    grid: 'rgba(71, 85, 105, 0.3)',        // Slate 600
    background: 'rgba(15, 23, 42, 1)'      // Slate 900
};

// 通用圖表配置
const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            labels: {
                color: CHART_COLORS.text,
                font: { family: "'Inter', sans-serif" }
            }
        },
        tooltip: {
            backgroundColor: 'rgba(30, 41, 59, 0.95)',
            titleColor: CHART_COLORS.text,
            bodyColor: CHART_COLORS.text,
            borderColor: 'rgba(71, 85, 105, 0.5)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12
        }
    },
    scales: {
        x: {
            ticks: { color: CHART_COLORS.text },
            grid: { color: CHART_COLORS.grid }
        },
        y: {
            ticks: { color: CHART_COLORS.text },
            grid: { color: CHART_COLORS.grid }
        }
    }
};

/**
 * 建立氨基酸組成圓餅圖
 * @param {string} canvasId - Canvas 元素 ID
 * @param {object} composition - 氨基酸組成
 * @returns {Chart} Chart.js 實例
 */
function createCompositionChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // 排序並取前10個
    const sorted = Object.entries(composition)
        .sort((a, b) => b[1] - a[1]);

    const top10 = sorted.slice(0, 10);
    const others = sorted.slice(10).reduce((sum, [, count]) => sum + count, 0);

    const labels = top10.map(([aa]) => aa);
    const data = top10.map(([, count]) => count);

    if (others > 0) {
        labels.push('Others');
        data.push(others);
    }

    // 生成漸變顏色
    const colors = labels.map((_, i) => {
        const hue = (i * 35) % 360;
        return `hsla(${hue}, 70%, 60%, 0.85)`;
    });

    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: 'rgba(15, 23, 42, 1)',
                borderWidth: 2,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: CHART_COLORS.text,
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    callbacks: {
                        label: function (context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.raw / total) * 100).toFixed(1);
                            return `${context.label}: ${context.raw} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * 建立氨基酸組成長條圖
 * @param {string} canvasId - Canvas 元素 ID
 * @param {object} composition - 氨基酸組成
 * @returns {Chart} Chart.js 實例
 */
function createCompositionBarChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // 按標準順序排列
    const aaOrder = ['A', 'R', 'N', 'D', 'C', 'E', 'Q', 'G', 'H', 'I', 'L', 'K', 'M', 'F', 'P', 'S', 'T', 'W', 'Y', 'V'];
    const labels = aaOrder;
    const data = aaOrder.map(aa => composition[aa] || 0);

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: data,
                backgroundColor: data.map((_, i) => {
                    const hue = (i * 18) % 360;
                    return `hsla(${hue}, 65%, 55%, 0.85)`;
                }),
                borderColor: 'transparent',
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            ...commonOptions,
            plugins: {
                ...commonOptions.plugins,
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: CHART_COLORS.text },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                }
            }
        }
    });
}

/**
 * 建立 Guinier 圖
 * @param {string} canvasId - Canvas 元素 ID
 * @param {Array} qValues - q 值
 * @param {Array} intensities - 散射強度
 * @param {object} guinierResult - Guinier 分析結果
 * @returns {Chart} Chart.js 實例
 */
function createGuinierPlot(canvasId, qValues, intensities, guinierResult) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // 準備數據
    const data = [];
    const fitLine = [];

    for (let i = 0; i < qValues.length; i++) {
        if (intensities[i] > 0) {
            const q2 = qValues[i] * qValues[i];
            const lnI = Math.log(intensities[i]);
            data.push({ x: q2, y: lnI });

            if (guinierResult && !guinierResult.error) {
                const yFit = guinierResult.intercept + guinierResult.slope * q2;
                fitLine.push({ x: q2, y: yFit });
            }
        }
    }

    const datasets = [{
        label: 'Data',
        data: data,
        backgroundColor: CHART_COLORS.primaryLight,
        borderColor: CHART_COLORS.primary,
        pointRadius: 3,
        pointHoverRadius: 5,
        showLine: false
    }];

    if (fitLine.length > 0) {
        datasets.push({
            label: 'Guinier Fit',
            data: fitLine,
            borderColor: CHART_COLORS.secondary,
            borderWidth: 2,
            pointRadius: 0,
            fill: false
        });
    }

    return new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            ...commonOptions,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'q² (Å⁻²)',
                        color: CHART_COLORS.text
                    },
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                },
                y: {
                    title: {
                        display: true,
                        text: 'ln[I(q)]',
                        color: CHART_COLORS.text
                    },
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                }
            }
        }
    });
}

/**
 * 建立 Kratky 圖
 * @param {string} canvasId - Canvas 元素 ID
 * @param {Array} qValues - q 值
 * @param {Array} intensities - 散射強度
 * @returns {Chart} Chart.js 實例
 */
function createKratkyPlot(canvasId, qValues, intensities) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const data = [];
    for (let i = 0; i < qValues.length; i++) {
        if (intensities[i] > 0) {
            data.push({
                x: qValues[i],
                y: qValues[i] * qValues[i] * intensities[i]
            });
        }
    }

    return new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Kratky Plot',
                data: data,
                backgroundColor: CHART_COLORS.tertiaryLight,
                borderColor: CHART_COLORS.tertiary,
                pointRadius: 2,
                showLine: true,
                fill: false
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'q (Å⁻¹)',
                        color: CHART_COLORS.text
                    },
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                },
                y: {
                    title: {
                        display: true,
                        text: 'q²I(q)',
                        color: CHART_COLORS.text
                    },
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                }
            }
        }
    });
}

/**
 * 建立 HPLC 色譜圖
 * @param {string} canvasId - Canvas 元素 ID  
 * @param {Array} timeData - 時間數據
 * @param {Array} uvSignal - UV 信號
 * @param {Array} riSignal - RI 信號 (可選)
 * @returns {Chart} Chart.js 實例
 */
function createChromatogram(canvasId, timeData, uvSignal, riSignal = null) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const datasets = [{
        label: 'UV (280nm)',
        data: timeData.map((t, i) => ({ x: t, y: uvSignal[i] })),
        borderColor: CHART_COLORS.primary,
        backgroundColor: CHART_COLORS.primaryLight,
        pointRadius: 0,
        fill: true,
        tension: 0.3
    }];

    if (riSignal) {
        datasets.push({
            label: 'RI',
            data: timeData.map((t, i) => ({ x: t, y: riSignal[i] })),
            borderColor: CHART_COLORS.secondary,
            backgroundColor: 'transparent',
            pointRadius: 0,
            yAxisID: 'y2',
            tension: 0.3
        });
    }

    return new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...commonOptions,
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (min)',
                        color: CHART_COLORS.text
                    },
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                },
                y: {
                    title: {
                        display: true,
                        text: 'UV (AU)',
                        color: CHART_COLORS.text
                    },
                    ticks: { color: CHART_COLORS.text },
                    grid: { color: CHART_COLORS.grid }
                },
                ...(riSignal ? {
                    y2: {
                        position: 'right',
                        title: {
                            display: true,
                            text: 'RI (dRI)',
                            color: CHART_COLORS.text
                        },
                        ticks: { color: CHART_COLORS.text },
                        grid: { display: false }
                    }
                } : {})
            }
        }
    });
}

// 導出函數
window.SAXSCharts = {
    CHART_COLORS,
    createCompositionChart,
    createCompositionBarChart,
    createGuinierPlot,
    createKratkyPlot,
    createChromatogram
};
