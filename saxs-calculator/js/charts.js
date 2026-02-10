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

// 導出函數
window.SAXSCharts = {
    CHART_COLORS,
    createCompositionChart,
    createCompositionBarChart
};
