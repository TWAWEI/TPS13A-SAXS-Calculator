/**
 * TPS13A SAXS Calculator - dn/dc Export
 * dn/dc 分頁的匯出：CSV／PNG 下載與圖表控制。
 */

// ========================
// 匯出功能
// ========================
/**
 * 觸發瀏覽器下載。
 *
 * 連結必須先掛進 DOM 再 click（分離節點在部分瀏覽器不會觸發下載），
 * 且 objectURL 要延後一個 tick 才 revoke，否則下載可能被取消。
 *
 * @param {string} href - 下載來源（blob: 或 data: URL）
 * @param {string} filename - 檔名
 * @param {boolean} revoke - 是否需要 revokeObjectURL
 * @returns {void}
 */
function triggerDownload(href, filename, revoke) {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        link.remove();
        if (revoke) URL.revokeObjectURL(href);
    }, 0);
}

function downloadCsv(filename, csvContent) {
    // BOM 讓 Excel 正確辨識 UTF-8
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(URL.createObjectURL(blob), filename, true);
}

function downloadChartPng(chart, filename) {
    if (!chart) {
        showDndcAlert('hplcDndcResults', 'error', '尚未產生圖表，請先執行計算');
        return;
    }
    triggerDownload(chart.toBase64Image('image/png', 1), filename, false);
}

function initChartControls() {
    const resetBtn = document.getElementById('resetChartZoom');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (DndcState.charts.chromatogram) {
                DndcState.charts.chromatogram.resetZoom();
            }
        });
    }
}

function initExportButtons() {
    // HPLC CSV export
    const exportHplcCsv = document.getElementById('exportHplcCsv');
    if (exportHplcCsv) {
        exportHplcCsv.addEventListener('click', () => {
            const r = DndcState.lastHplcResult;
            const p = DndcState.lastHplcParams;
            if (!r || !p) {
                showDndcAlert('hplcDndcResults', 'error',
                    '尚無結果可匯出，請先按「計算 dn/dc」（換檔後需重新計算）');
                return;
            }

            const lines = [
                'Parameter,Value',
                `dn/dc (mL/g),${r.dndc}`,
                `RI Peak Value,${r.riPeakValue}`,
                `RI (corrected),${r.riValue}`,
                `${p.peakMode === 'area' ? 'UV Integral (mg·min/mL)' : 'Concentration (mg/mL)'},${r.concentration}`,
                `Peak Mode,${r.peakMode}`,
                `Baseline Mode,${r.baselineMode}`,
                `Alignment Lag,${r.alignmentInfo ? r.alignmentInfo.lag : 'N/A'}`,
                `Epsilon,${p.epsilon}`,
                `Path Length,${p.pathLen}`,
                `RI Factor,${p.riFactor}`,
                `RI Delay,${p.riDelay}`,
                `Peak Range,${p.peakStart}-${p.peakEnd}`,
                `Baseline 1,${p.bl1Start}-${p.bl1End}`,
                `Baseline 2,${p.bl2Start}-${p.bl2End}`
            ];
            downloadCsv('hplc_dndc_result.csv', lines.join('\n'));
        });
    }

    // HPLC chart export
    const exportHplcChart = document.getElementById('exportHplcChart');
    if (exportHplcChart) {
        exportHplcChart.addEventListener('click', () => {
            downloadChartPng(DndcState.charts.chromatogram, 'hplc_chromatogram.png');
        });
    }

    // Multi-injection CSV export（手動表格與 ASTRA 質量法共用同一份狀態）
    const exportMultiCsv = document.getElementById('exportMultiCsv');
    if (exportMultiCsv) {
        exportMultiCsv.addEventListener('click', () => {
            const stored = DndcState.lastMultiResult;
            if (!stored || !stored.result) {
                showDndcAlert('multiDndcResults', 'error',
                    '尚未完成擬合，請先按「計算 dn/dc」或「ASTRA 線性擬合」再匯出');
                return;
            }

            const meta = multiFitSource(stored.source);
            const { result, xData, yData } = stored;
            const lines = [meta.csvHeader];
            for (let i = 0; i < xData.length; i++) {
                lines.push(`${xData[i]},${yData[i]}`);
            }
            lines.push('');
            lines.push(`Method,${meta.methodName}`);
            lines.push(`dn/dc (slope),${result.dnDc}`);
            lines.push(`R-squared,${result.rSquared}`);
            lines.push(`Intercept,${result.intercept}`);
            lines.push(`Std Error,${result.stdError}`);
            downloadCsv('multi_injection_dndc.csv', lines.join('\n'));
        });
    }

    // Slice CSV export
    const exportSliceCsv = document.getElementById('exportSliceCsv');
    if (exportSliceCsv) {
        exportSliceCsv.addEventListener('click', () => {
            const r = DndcState.lastSliceResult;
            if (!r) {
                showDndcAlert('sliceDndcResults', 'error',
                    '尚無結果可匯出，請先按「Slice-by-slice 分析」（換檔後需重新分析）');
                return;
            }

            const lines = ['Time (min),Concentration (g/mL),RI (RIU),dn/dc (slice)'];
            for (let i = 0; i < r.sliceConcentrations.length; i++) {
                lines.push([
                    r.sliceTimes[i].toFixed(4),
                    r.sliceConcentrations[i].toExponential(6),
                    r.sliceRiValues[i].toExponential(6),
                    r.sliceDndcValues[i].toFixed(6)
                ].join(','));
            }
            lines.push('');
            lines.push(`Overall dn/dc (mL/g),${r.dndc}`);
            if (r.fitResult) {
                lines.push(`R-squared,${r.fitResult.rSquared}`);
                lines.push(`Intercept,${r.fitResult.intercept}`);
                lines.push(`Std Error,${r.fitResult.stdError}`);
            }
            downloadCsv('slice_dndc_result.csv', lines.join('\n'));
        });
    }
}
