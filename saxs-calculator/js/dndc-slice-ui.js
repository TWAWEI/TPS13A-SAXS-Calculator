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

/** Slice-by-slice 擬合結果（純函式；呼叫前已確認 result.fitResult 存在） */
function sliceResultsHtml(result, warnings = []) {
    const { tile, tiles } = ResultTiles;
    const fit = result.fitResult;
    const grade = dndcR2Grade(fit.rSquared);
    return `
        ${renderWarningsHtml([...warnings, ...(result.warnings || [])])}
        ${tiles([
            tile({ label: 'd<i>n</i>/d<i>c</i> (斜率)', value: formatDndc(result.dndc), unit: 'mL/g', hero: true }),
            tile({ label: '<i>R</i>²', value: fit.rSquared.toFixed(6) }),
            tile({ label: '標準誤差', value: fit.stdError.toExponential(4) }),
            tile({ label: '截距', value: fit.intercept.toExponential(4) }),
            tile({ label: '有效切片數', value: result.sliceCount }),
        ])}
        <div class="alert ${grade.alertClass} mt-md">
            擬合品質：${grade.quality} (<i>R</i>² ${grade.comparator} ${grade.bound})
        </div>
    `;
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

    resultsDiv.innerHTML = sliceResultsHtml(result, warnings);

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
        `dn/dc ${formatDndc(fit.slope)} mL/g，R² ${fit.rSquared.toFixed(4)}（擬合品質${dndcR2Grade(fit.rSquared).quality}）`);

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('sliceDndcResults');
}
