/**
 * TPS13A SAXS Calculator - dn/dc Multi-injection UI
 * 多注射線性擬合頁面：表格輸入、擬合與結果顯示。
 */

// ========================
// 多注射擬合頁面
// ========================
function initDndcMultiSection() {
    const addBtn = document.getElementById('addInjectionRow');
    const calcBtn = document.getElementById('calculateMultiDndc');

    // ASTRA file parsing
    initAstraSection();


    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const tbody = document.getElementById('multiInjectionBody');
            const rowCount = tbody.rows.length + 1;
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${rowCount}</td>
                <td><input type="number" class="form-input" step="0.0001" aria-label="第 ${rowCount} 組 濃度 (g/mL)"></td>
                <td><input type="number" class="form-input" step="0.000001" aria-label="第 ${rowCount} 組 ΔRI (RIU)"></td>
                <td><button type="button" class="btn btn-sm btn-secondary js-remove-injection-row" aria-label="刪除第 ${rowCount} 組資料">✕</button></td>
            `;
            // 刪除鍵改用 addEventListener：CSP 的 script-src 不含 'unsafe-inline'，
            // 行內 onclick="" 會被瀏覽器擋掉（按了沒反應）。
            const removeBtn = row.querySelector('.js-remove-injection-row');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => row.remove());
            }
        });
    }

    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            const tbody = document.getElementById('multiInjectionBody');
            const rows = tbody.rows;
            const concentrations = [];
            const riValues = [];

            for (let i = 0; i < rows.length; i++) {
                const inputs = rows[i].querySelectorAll('input');
                const c = parseFloat(inputs[0].value);
                const ri = parseFloat(inputs[1].value);
                if (!isNaN(c) && !isNaN(ri)) {
                    concentrations.push(c);
                    riValues.push(ri);
                }
            }

            if (concentrations.length < 2) {
                showDndcAlert('multiDndcResults', 'error', '至少需要 2 組有效資料點');
                return;
            }

            try {
                const result = DndcCalculations.linearFit(concentrations, riValues);
                displayMultiFitResults(result, concentrations, riValues, 'manual');
                const multiExport = document.getElementById('multiExportBtns');
                if (multiExport) multiExport.classList.remove('hidden');
            } catch (err) {
                hideElement('multiDndcChartContainer');
                hideElement('multiExportBtns');
                reportDndcError('multiDndcResults', err, '擬合錯誤');
            }
        });
    }
}

/**
 * 兩條擬合路徑的座標軸與單位定義。
 * manual: 手動輸入濃度 (g/mL) vs ΔRI (RIU)
 * astra:  注入質量 (g) vs RI 面積×流速 (RIU·mL)
 */
const MULTI_FIT_SOURCES = Object.freeze({
    manual: Object.freeze({
        methodName: '手動輸入濃度',
        xLabel: 'Concentration (g/mL)',
        yLabel: 'ΔRI (RIU)',
        csvHeader: 'Concentration (g/mL),dRI (RIU)'
    }),
    astra: Object.freeze({
        methodName: '質量法（ASTRA 檔案）',
        xLabel: 'Injected mass (g)',
        yLabel: '∫ΔRI dV (RIU·mL)',
        csvHeader: 'Mass (g),RI area x volume (RIU*mL)'
    })
});

/**
 * 取得擬合來源的標籤定義。
 *
 * @param {string} source - 'manual' 或 'astra'
 * @returns {object} 標籤定義（未知來源退回 manual）
 */
function multiFitSource(source) {
    return MULTI_FIT_SOURCES[source] || MULTI_FIT_SOURCES.manual;
}

function displayMultiFitResults(result, xData, yData, source = 'manual') {
    const resultsDiv = document.getElementById('multiDndcResults');
    const meta = multiFitSource(source);

    // 匯出改從狀態輸出，不再從 DOM 表格刮資料（表格 id 兩條路徑不同）
    DndcState.lastMultiResult = {
        result,
        xData: xData.slice(),
        yData: yData.slice(),
        source: MULTI_FIT_SOURCES[source] ? source : 'manual'
    };

    const r2Quality = result.rSquared >= 0.999 ? '優良' :
        result.rSquared >= 0.99 ? '良好' :
        result.rSquared >= 0.95 ? '可接受' : '偏低';
    const r2Class = result.rSquared >= 0.99 ? 'alert-success' :
        result.rSquared >= 0.95 ? 'alert-warning' : 'alert-error';

    resultsDiv.innerHTML = `
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i> (斜率)</div>
                <div class="stat-value" style="font-size: 1.75rem;">${formatDndc(result.dnDc)} <span class="stat-unit">mL/g</span></div>
            </div>
        </div>
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label"><i>R</i>²</div>
                <div class="result-value">${result.rSquared.toFixed(6)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">截距</div>
                <div class="result-value">${result.intercept.toExponential(4)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">標準誤差</div>
                <div class="result-value">${result.stdError.toExponential(4)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">資料點數</div>
                <div class="result-value">${xData.length}</div>
            </div>
            <div class="result-item">
                <div class="result-label">方法</div>
                <div class="result-value" style="font-size: 0.875rem;">${escapeHtmlDndc(meta.methodName)}</div>
            </div>
        </div>
        <div class="alert ${r2Class} mt-md">
            擬合品質：${r2Quality} (<i>R</i>² ${result.rSquared >= 0.999 ? '≥' : result.rSquared >= 0.99 ? '≥' : '<'} ${result.rSquared >= 0.999 ? '0.999' : result.rSquared >= 0.99 ? '0.99' : '0.95'})
        </div>
    `;

    // 顯示擬合圖
    const chartContainer = document.getElementById('multiDndcChartContainer');
    chartContainer.classList.remove('hidden');

    if (DndcState.charts.multiFit) {
        DndcState.charts.multiFit.destroy();
    }

    DndcState.charts.multiFit = DndcCharts.createLinearFitChart(
        'multiDndcChart', xData, yData, result,
        { xLabel: meta.xLabel, yLabel: meta.yLabel }
    );

    // Chart.js 只畫像素；把關鍵數字寫進 aria-label，AT 才讀得到圖的結論
    A11y.describeChart('multiDndcChart',
        `多注射線性擬合圖：${meta.xLabel} 對 ${meta.yLabel}，${xData.length} 個資料點，` +
        `dn/dc ${formatDndc(result.dnDc)} mL/g，R² ${result.rSquared.toFixed(4)}（擬合品質${r2Quality}）`);

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('multiDndcResults');
}
