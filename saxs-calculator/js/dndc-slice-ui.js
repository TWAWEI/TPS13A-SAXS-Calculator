/**
 * TPS13A SAXS Calculator - dn/dc Slice UI
 * Slice-by-slice 頁面：逐切片 dn/dc 分析與結果顯示。
 */

// ========================
// Slice-by-slice 頁面
// ========================
function initDndcSliceSection() {
    const calcBtn = document.getElementById('calculateSliceDndc');

    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            const sync = syncSelectedColumns();
            if (!sync.ok) {
                showDndcAlert('sliceDndcResults', 'error',
                    `${sync.message}（請先到「HPLC dn/dc」頁面載入檔案並確認欄位對應）`);
                return;
            }

            const { time, uv, ri } = DndcState.loadedData;

            let params;
            let minUvFraction;
            try {
                // Slice 模式一律從 UV 逐點換算濃度，不吃手動濃度
                params = readHplcParams({ withManualC: false });
                minUvFraction = FormUtils.readFiniteField('sliceMinUvFraction', '最小 UV 閾值');
                if (!(minUvFraction >= 0) || minUvFraction >= 1) {
                    throw new Error('最小 UV 閾值必須介於 0 與 1 之間（例如 0.05 表示峰值的 5%）');
                }
            } catch (err) {
                reportDndcError('sliceDndcResults', err, '輸入錯誤');
                return;
            }

            try {
                const result = DndcCalculations.computeSliceDndc(time, uv, ri, params, minUvFraction);
                DndcState.lastSliceResult = result;
                displaySliceResults(result, selectedColumnWarnings());
                const sliceExport = document.getElementById('sliceExportBtns');
                if (sliceExport) sliceExport.classList.remove('hidden');
            } catch (err) {
                // 失敗時不要留下上一輪的擬合圖與匯出按鈕（會被誤讀成本次結果）
                hideElement('sliceDndcChartContainer');
                hideElement('sliceExportBtns');
                reportDndcError('sliceDndcResults', err, '分析錯誤');
            }
        });
    }
}

function displaySliceResults(result, warnings = []) {
    const resultsDiv = document.getElementById('sliceDndcResults');
    const fit = result.fitResult;

    // 沒有擬合結果就不要打開圖表容器（createLinearFitChart 也會擋，這是第二道）
    if (!fit) {
        showDndcAlert('sliceDndcResults', 'warning',
            `有效切片數不足（${result.sliceCount} 個，至少需要 2 個），` +
            '請檢查峰範圍是否涵蓋訊號，或降低「最小 UV 閾值」');
        const emptyChart = document.getElementById('sliceDndcChartContainer');
        if (emptyChart) emptyChart.classList.add('hidden');
        return;
    }

    const rSquared = fit.rSquared;

    const r2Quality = rSquared >= 0.999 ? '優良' :
        rSquared >= 0.99 ? '良好' :
        rSquared >= 0.95 ? '可接受' : '偏低';
    const r2Class = rSquared >= 0.99 ? 'alert-success' :
        rSquared >= 0.95 ? 'alert-warning' : 'alert-error';

    resultsDiv.innerHTML = `
        ${renderWarningsHtml(warnings)}
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i> (斜率)</div>
                <div class="stat-value" style="font-size: 1.75rem;">${formatDndc(result.dndc)} <span class="stat-unit">mL/g</span></div>
            </div>
        </div>
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label"><i>R</i>²</div>
                <div class="result-value">${rSquared.toFixed(6)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">截距</div>
                <div class="result-value">${fit.intercept.toExponential(4)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">標準誤差</div>
                <div class="result-value">${fit.stdError.toExponential(4)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">有效切片數</div>
                <div class="result-value">${result.sliceCount}</div>
            </div>
        </div>
        <div class="alert ${r2Class} mt-md">
            擬合品質：${r2Quality} (<i>R</i>² ${rSquared >= 0.999 ? '≥' : rSquared >= 0.99 ? '≥' : '<'} ${rSquared >= 0.999 ? '0.999' : rSquared >= 0.99 ? '0.99' : '0.95'})
        </div>
    `;

    // 顯示擬合圖
    const chartContainer = document.getElementById('sliceDndcChartContainer');
    chartContainer.classList.remove('hidden');

    if (DndcState.charts.sliceFit) {
        DndcState.charts.sliceFit.destroy();
    }

    DndcState.charts.sliceFit = DndcCharts.createLinearFitChart(
        'sliceDndcChart', result.sliceConcentrations, result.sliceRiValues, result.fitResult,
        { xLabel: 'Concentration (g/mL)', yLabel: 'Δn (RIU)' }
    );

    A11y.describeChart('sliceDndcChart',
        `Slice-by-slice 線性擬合圖：濃度 (g/mL) 對 Δn (RIU)，${result.sliceCount} 個有效切片，` +
        `dn/dc ${formatDndc(fit.slope)} mL/g，R² ${rSquared.toFixed(4)}（擬合品質${r2Quality}）`);

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('sliceDndcResults');
}
