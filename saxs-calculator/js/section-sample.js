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
            mw = MassUnits.kDaToDa(FormUtils.readPositiveField('inputMw', '分子量'));
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

function sampleResultsHtml(data) {
    const { tile, tiles, rows } = ResultTiles;
    return `
        ${tiles([
            tile({ label: '濃度', value: data.concentration.toFixed(4), unit: 'mg/mL', hero: true }),
            tile({ label: '濃度 (μM)', value: data.concentrationMolar.toFixed(2), unit: 'μM' }),
            tile({ label: '吸光值', value: data.absorbance, unit: 'AU' }),
        ])}

        <div class="section-divider"><span>輸入參數</span></div>

        ${rows([
            { label: '光徑', value: data.pathLength, unit: 'cm' },
            { label: '消光係數', value: data.epsilon.toLocaleString(), unit: 'M⁻¹ cm⁻¹' },
            { label: '分子量', value: MassUnits.formatKDa(data.mw), unit: 'kDa' },
        ])}
    `;
}

function displaySampleResults(data) {
    const resultsDiv = document.getElementById('sampleResults');

    resultsDiv.innerHTML = sampleResultsHtml(data);

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('sampleResults');
}

function dilutionFactorResultsHtml(data) {
    const { tile, tiles, rows } = ResultTiles;
    const onColumnConc = (data.uvConcentration && data.uvConcentration > 0)
        ? (data.uvConcentration / data.dilutionFactor)
        : null;
    const hasOnColumn = onColumnConc !== null;

    return `
        ${tiles([
            tile({ label: '稀釋因子 (DF)', value: data.dilutionFactor.toFixed(2) }),
            hasOnColumn && tile({ label: 'On-column 濃度', value: onColumnConc.toFixed(4), unit: 'mg/mL' }),
        ])}
        ${rows([
            { label: '注射體積', value: data.injectedVolume, unit: 'μL' },
            hasOnColumn && { label: 'UV 量測濃度', value: data.uvConcentration.toFixed(4), unit: 'mg/mL' },
        ])}
        ${hasOnColumn ? '' : `
        <div class="alert alert-info" style="margin-top: 0.75rem;">
            先計算 UV 濃度，即可同時顯示 on-column 濃度估算
        </div>
        `}
        <div class="alert alert-warning" style="margin-top: 0.75rem;">
            <strong>注意：</strong>此為經驗公式估算，誤差約 ±7.33%
        </div>
    `;
}

function displayDilutionFactorResults(data) {
    const resultsDiv = document.getElementById('dilutionFactorResults');

    resultsDiv.innerHTML = dilutionFactorResultsHtml(data);

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('dilutionFactorResults');
}
