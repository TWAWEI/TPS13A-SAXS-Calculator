/**
 * TPS13A SAXS Calculator - Charts Module
 * 使用 Chart.js 產生視覺化圖表
 */

// 顏色配置 — light theme
const CHART_COLORS = {
    primary: 'rgba(45, 49, 146, 1)',        // Deep royal blue
    primaryLight: 'rgba(45, 49, 146, 0.12)',
    secondary: 'rgba(26, 122, 76, 1)',      // Forest green
    secondaryLight: 'rgba(26, 122, 76, 0.12)',
    tertiary: 'rgba(180, 83, 9, 1)',        // Amber
    tertiaryLight: 'rgba(180, 83, 9, 0.12)',
    danger: 'rgba(196, 43, 28, 1)',         // Red
    dangerLight: 'rgba(196, 43, 28, 0.12)',
    text: 'rgba(26, 26, 46, 0.7)',          // Dark navy muted
    grid: 'rgba(26, 26, 46, 0.08)',         // Very subtle
    background: 'rgba(248, 247, 244, 1)'    // Warm paper
};

// 通用圖表配置
const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            labels: {
                color: CHART_COLORS.text,
                font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: 500 }
            }
        },
        tooltip: {
            backgroundColor: 'rgba(26, 26, 46, 0.92)',
            titleColor: '#fff',
            bodyColor: 'rgba(255, 255, 255, 0.85)',
            borderColor: 'rgba(26, 26, 46, 0.2)',
            borderWidth: 1,
            cornerRadius: 6,
            padding: 10,
            titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: 600 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 }
        }
    },
    scales: {
        x: {
            ticks: { color: CHART_COLORS.text, font: { size: 11 } },
            grid: { color: CHART_COLORS.grid }
        },
        y: {
            ticks: { color: CHART_COLORS.text, font: { size: 11 } },
            grid: { color: CHART_COLORS.grid }
        }
    }
};

/**
 * 建立氨基酸組成圓餅圖
 */
function createCompositionChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

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

    // Muted, sophisticated palette
    const colors = labels.map((_, i) => {
        const hue = (i * 33 + 220) % 360;
        return `oklch(0.6 0.12 ${hue})`;
    });

    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: '#ffffff',
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: CHART_COLORS.text,
                        padding: 10,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 26, 46, 0.92)',
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
 */
function createCompositionBarChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

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
                backgroundColor: 'rgba(45, 49, 146, 0.7)',
                hoverBackgroundColor: 'rgba(45, 49, 146, 0.9)',
                borderColor: 'transparent',
                borderRadius: 3,
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
                    ticks: {
                        color: CHART_COLORS.text,
                        font: { family: "'JetBrains Mono', monospace", size: 10, weight: 500 }
                    },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: CHART_COLORS.text, font: { size: 10 } },
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
