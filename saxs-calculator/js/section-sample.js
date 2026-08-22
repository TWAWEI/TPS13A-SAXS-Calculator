/**
 * TPS13A SAXS Calculator - Sample Calculations Section
 * 樣品計算區段：濃度／體積換算與稀釋倍率。
 */

// ========================
// Sample Calculations Section
// ========================
function initSampleSection() {
    const calculateBtn = document.getElementById('calculateSample');

    calculateBtn.addEventListener('click', () => {
        // 空欄位 parseFloat 會得到 NaN，而 NaN <= 0 為 false——舊的檢查漏掉
        // pathLength，NaN 會一路傳進計算並印出 "NaN mg/mL"、汙染 AppState
        let absorbance, pathLength, epsilon, mw;
        try {
            absorbance = FormUtils.readPositiveField('uvAbsorbance', 'UV 吸光值');
            pathLength = FormUtils.readPositiveField('pathLength', '光徑長度');
            epsilon = FormUtils.readPositiveField('inputEpsilon', '消光係數 ε (莫耳)');
            mw = FormUtils.readPositiveField('inputMw', '分子量');
        } catch (err) {
            showAlert('sampleResults', 'error', err.message);
            return;
        }

        const concentration = SAXSCalculations.calculateConcentrationFromUV(
            absorbance, epsilon, pathLength, mw
        );

        // 最後一道防線：不讓 NaN／Infinity 寫進 AppState（稀釋倍率頁面會沿用）
        if (!Number.isFinite(concentration) || concentration <= 0) {
            showAlert('sampleResults', 'error',
                '無法從輸入值算出有效濃度，請確認 UV 吸光值、消光係數、光徑長度與分子量');
            return;
        }

        // Store latest UV concentration for dilution factor use
        AppState.lastUVConcentration = concentration;

        displaySampleResults({
            absorbance,
            pathLength,
            epsilon,
            mw,
            concentration,
            // Excel `Calculations of sample!N65`: c(mg/mL) × 10⁶ / MW → μM
            concentrationMolar: (concentration / mw) * 1e6 // μM
        });
    });

    // Dilution factor estimation
    const dfBtn = document.getElementById('calculateDilutionFactor');
    if (dfBtn) {
        dfBtn.addEventListener('click', () => {
            const injVol = parseFloat(document.getElementById('dfInjectionVolume').value);
            if (isNaN(injVol) || injVol <= 0) {
                showAlert('dilutionFactorResults', 'error', '注射體積必須大於 0');
                return;
            }

            const df = SAXSCalculations.calculateDilutionFactorEmpirical(injVol);
            const uvConc = AppState.lastUVConcentration;

            displayDilutionFactorResults({ injectedVolume: injVol, dilutionFactor: df, uvConcentration: uvConc });
        });
    }
}

function displaySampleResults(data) {
    const resultsDiv = document.getElementById('sampleResults');

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item" style="border-left-color: var(--color-accent-secondary);">
                <div class="result-label">濃度</div>
                <div class="result-value">${data.concentration.toFixed(4)} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
            <div class="result-item" style="border-left-color: var(--color-accent-secondary);">
                <div class="result-label">濃度 (μM)</div>
                <div class="result-value">${data.concentrationMolar.toFixed(2)} <span style="font-size: 0.75rem;">μM</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>輸入參數</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">吸光值</div>
                <div class="result-value">${data.absorbance} AU</div>
            </div>
            <div class="result-item">
                <div class="result-label">光徑</div>
                <div class="result-value">${data.pathLength} cm</div>
            </div>
            <div class="result-item">
                <div class="result-label">消光係數</div>
                <div class="result-value">${data.epsilon.toLocaleString()} M⁻¹ cm⁻¹</div>
            </div>
            <div class="result-item">
                <div class="result-label">分子量</div>
                <div class="result-value">${data.mw.toFixed(2)} Da</div>
            </div>
        </div>
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('sampleResults');
}

function displayDilutionFactorResults(data) {
    const resultsDiv = document.getElementById('dilutionFactorResults');
    const onColumnConc = (data.uvConcentration && data.uvConcentration > 0)
        ? (data.uvConcentration / data.dilutionFactor)
        : null;

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item" style="border-left-color: #f59e0b;">
                <div class="result-label">稀釋因子 (DF)</div>
                <div class="result-value">${data.dilutionFactor.toFixed(2)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">注射體積</div>
                <div class="result-value">${data.injectedVolume} <span style="font-size: 0.75rem;">μL</span></div>
            </div>
        </div>
        ${onColumnConc !== null ? `
        <div class="section-divider"><span>On-column 濃度估算</span></div>
        <div class="result-grid">
            <div class="result-item" style="border-left-color: #10b981;">
                <div class="result-label">UV 量測濃度</div>
                <div class="result-value">${data.uvConcentration.toFixed(4)} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
            <div class="result-item" style="border-left-color: #10b981;">
                <div class="result-label">On-column 濃度</div>
                <div class="result-value">${onColumnConc.toFixed(4)} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
        </div>
        ` : `
        <div class="alert alert-info" style="margin-top: 0.75rem;">
            先計算 UV 濃度，即可同時顯示 on-column 濃度估算
        </div>
        `}
        <div class="alert alert-warning" style="margin-top: 0.75rem;">
            <strong>注意：</strong>此為經驗公式估算，誤差約 ±7.33%
        </div>
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('dilutionFactorResults');
}
