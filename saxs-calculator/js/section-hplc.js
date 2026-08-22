/**
 * TPS13A SAXS Calculator - HPLC-SAXS Section
 * HPLC-SAXS 區段：峰型參數、建議值與量測設定計算。
 */

// ========================
// HPLC-SAXS Section
// ========================
function initHPLCSection() {
    const calculateBtn = document.getElementById('calculateHPLCSAXS');

    if (!calculateBtn) {
        console.warn('HPLC-SAXS calculate button not found');
        return;
    }

    calculateBtn.addEventListener('click', () => {
        const ALERT_ID = 'hplcSaxsAlert';

        let params;
        try {
            params = {
                peakCenter: FormUtils.readPositiveField('hplcPeakCenter', 'Peak center'),
                peakFWHM: FormUtils.readPositiveField('hplcPeakFWHM', 'Peak width (FWHM)'),
                injectionVolume: FormUtils.readPositiveField('hplcInjectionVolume', 'Volume to inject in SAXS exp'),
                targetFlowRate: FormUtils.readPositiveField('hplcTargetFlowRate', 'Target flow rate'),
                initialFlowRate: FormUtils.readPositiveField('hplcInitialFlowRate', 'Initial flow rate')
            };
        } catch (err) {
            showAlert(ALERT_ID, 'error', err.message);
            return;
        }

        try {
            // Calculate HPLC-SAXS settings（注射體積超出 3–100 μL 校正範圍會 throw）
            const result = SAXSCalculations.calculateHPLCSAXSSettings(params);

            // Calculate suggested values for 10μL pre-run
            const suggested = SAXSCalculations.calculateSuggestedParams(params.peakCenter, params.peakFWHM);

            clearAlert(ALERT_ID);
            displayHPLCSAXSResults(result, suggested);
        } catch (err) {
            // 領域驗證錯誤（超出校正範圍等）直接顯示；非預期錯誤另記 console 供除錯
            if (err instanceof TypeError || err instanceof RangeError) {
                console.error('[HPLC-SAXS]', err);
            }
            showAlert(ALERT_ID, 'error', err.message);
        }
    });

    // Also update suggested values when peak center/FWHM changes
    ['hplcPeakCenter', 'hplcPeakFWHM'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => {
                const peakCenter = parseFloat(document.getElementById('hplcPeakCenter').value);
                const peakFWHM = parseFloat(document.getElementById('hplcPeakFWHM').value);

                if (!isNaN(peakCenter) && !isNaN(peakFWHM)) {
                    const suggested = SAXSCalculations.calculateSuggestedParams(peakCenter, peakFWHM);
                    updateSuggestedValues(suggested);
                }
            });
        }
    });
}

function displayHPLCSAXSResults(result, suggested) {
    // Update suggested values
    updateSuggestedValues(suggested);

    // Update Flow Rate Table
    const flowRateTableBody = document.getElementById('flowRateTableBody');
    if (flowRateTableBody) {
        flowRateTableBody.innerHTML = result.flowRateTable.map(row => `
            <tr${row.note ? ' class="flow-rate-row--note"' : ''}>
                <td>${row.time.toFixed(2)}</td>
                <td>${row.flowRate.toFixed(3)}</td>
                <td>${row.note || '-'}</td>
            </tr>
        `).join('');
    }

    // Update Report Stoptime
    const reportStoptimeEl = document.getElementById('reportStoptime');
    if (reportStoptimeEl) {
        reportStoptimeEl.textContent = result.reportStoptime;
    }

    // Update Fraction Collector
    const fractionStartTime = document.getElementById('fractionStartTime');
    const fractionStopTime = document.getElementById('fractionStopTime');
    const timePerFraction = document.getElementById('timePerFraction');

    if (fractionStartTime) fractionStartTime.textContent = result.fractionCollector.startTime.toFixed(2);
    if (fractionStopTime) fractionStopTime.textContent = result.fractionCollector.stopTime.toFixed(2);
    if (timePerFraction) timePerFraction.textContent = result.fractionCollector.timePerFraction.toFixed(2);

    // Update Detector Settings Table
    const detectorTableBody = document.getElementById('detectorSettingsTableBody');
    if (detectorTableBody) {
        detectorTableBody.innerHTML = result.detectorSettings.map(row => {
            // Highlight step 4 (main data collection)
            const isMainStep = row.step === 4;
            const rowStyle = isMainStep ? 'background: rgba(245, 158, 11, 0.15);' : '';
            // Text colours chosen for ≥4.5:1 on the light row backgrounds (WCAG AA)
            const frameStyle = isMainStep ? 'color: #92400e; font-weight: 700;' : '';

            return `
                <tr style="${rowStyle}">
                    <td>${row.step}</td>
                    <td style="color: ${row.mode === 'TM' ? '#1d4ed8' : '#047857'}; font-weight: 600;">${row.mode}</td>
                    <td style="${frameStyle}">${row.frame}</td>
                    <td>${row.wait}</td>
                    <td>${row.exposure}</td>
                    <td>${row.hold}</td>
                </tr>
            `;
        }).join('');
    }


    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('hplcSaxsResults');
}

function updateSuggestedValues(suggested) {
    const suggestPeakCenter = document.getElementById('suggestPeakCenter');
    const suggestPeakWidth = document.getElementById('suggestPeakWidth');
    const suggestSampleVolume = document.getElementById('suggestSampleVolume');

    if (suggestPeakCenter) suggestPeakCenter.textContent = suggested.suggestPeakCenter;
    if (suggestPeakWidth) suggestPeakWidth.textContent = suggested.suggestPeakWidth;
    if (suggestSampleVolume) suggestSampleVolume.textContent = suggested.suggestSampleVolume;
}
