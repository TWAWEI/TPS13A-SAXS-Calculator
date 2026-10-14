/**
 * TPS13A SAXS Calculator - Charts Module
 * 使用 Chart.js 產生視覺化圖表。顏色由 ChartTheme 依 tpsRole／tpsSeries 決定（js/chart-theme.js）。
 */

// 通用圖表配置（每次呼叫回傳新物件；顏色由 ChartTheme.colorize 填入）
function commonOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    font: { family: ChartTheme.FONT, size: 12, weight: 500 }
                }
            },
            tooltip: {
                cornerRadius: 8,
                padding: 10,
                titleFont: { family: ChartTheme.FONT, size: 12, weight: 600 },
                bodyFont: { family: ChartTheme.MONO, size: 11 }
            }
        }
    };
}

/**
 * 建立氨基酸組成圓餅圖
 */
function createCompositionChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const sorted = Object.entries(composition)
        .sort((a, b) => b[1] - a[1]);

    // 系列色只有 8 色：前 7 名各一色，其餘併成「Others」（reference 灰）
    const topCount = ChartTheme.palette().series.length - 1;
    const top = sorted.slice(0, topCount);
    const others = sorted.slice(topCount).reduce((sum, [, count]) => sum + count, 0);

    const labels = top.map(([aa]) => aa);
    const data = top.map(([, count]) => count);

    if (others > 0) {
        labels.push('Others');
        data.push(others);
    }

    const base = commonOptions();
    return new Chart(ctx, ChartTheme.colorize({
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                tpsSeries: 'byIndex',
                tpsOthersIndex: others > 0 ? labels.length - 1 : -1,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            ...base,
            cutout: '65%',
            plugins: {
                ...base.plugins,
                legend: {
                    position: 'right',
                    labels: {
                        padding: 10,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { family: ChartTheme.FONT, size: 12 }
                    }
                },
                tooltip: {
                    ...base.plugins.tooltip,
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
    }));
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

    const base = commonOptions();
    return new Chart(ctx, ChartTheme.colorize({
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: data,
                tpsRole: 'primary',
                borderWidth: 0,
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            ...base,
            plugins: {
                ...base.plugins,
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: {
                        font: { family: ChartTheme.MONO, size: 10, weight: 500 }
                    },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { font: { size: 10 } }
                }
            }
        }
    }));
}

// 導出函數
window.SAXSCharts = {
    createCompositionChart,
    createCompositionBarChart
};
