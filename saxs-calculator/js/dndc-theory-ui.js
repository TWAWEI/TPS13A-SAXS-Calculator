/**
 * TPS13A SAXS Calculator - dn/dc Theory UI
 * 理論計算頁面：折射率增量的理論估算與手動濃度解析。
 */

// ========================
// 理論計算頁面
// ========================
function initDndcTheorySection() {
    const calcCorrBtn = document.getElementById('calculateDndcCorrection');
    const calcLLBtn = document.getElementById('calculateLorentzLorenz');

    if (calcCorrBtn) {
        calcCorrBtn.addEventListener('click', () => {
            const refDndc = parseFloat(document.getElementById('dndcRefValue').value);
            const refTemp = parseFloat(document.getElementById('dndcRefTemp').value);
            const refWave = parseFloat(document.getElementById('dndcRefWave').value);
            const targetTemp = parseFloat(document.getElementById('dndcTargetTemp').value);
            const targetWave = parseFloat(document.getElementById('dndcTargetWave').value);

            if ([refDndc, refTemp, refWave, targetTemp, targetWave].some(isNaN)) {
                showDndcAlert('dndcCorrectionResults', 'error', '請填入所有參數');
                return;
            }

            const result = DndcCalculations.comprehensiveCorrection(
                refDndc, refTemp, refWave, targetTemp, targetWave
            );

            document.getElementById('dndcCorrectionResults').innerHTML = dndcCorrectionResultsHtml(result);
        });
    }

    if (calcLLBtn) {
        calcLLBtn.addEventListener('click', () => {
            const nP = parseFloat(document.getElementById('llNPolymer').value);
            const nS = parseFloat(document.getElementById('llNSolvent').value);
            const dP = parseFloat(document.getElementById('llDensityPolymer').value);
            const dS = parseFloat(document.getElementById('llDensitySolvent').value);

            if ([nP, nS, dP, dS].some(isNaN)) {
                showDndcAlert('llResults', 'error', '請填入所有參數');
                return;
            }
            if (dP <= 0) {
                showDndcAlert('llResults', 'error', '聚合物密度必須大於 0 g/mL (蛋白質約 1.37 ≈ 1/v̄)');
                return;
            }
            if (nP <= 0 || nS <= 0) {
                showDndcAlert('llResults', 'error', '折射率必須大於 0');
                return;
            }

            let llResult, gdResult;
            try {
                llResult = DndcCalculations.lorentzLorenz(nP, nS, dP, dS);
                gdResult = DndcCalculations.gladstoneDale(nP, nS, dP);
            } catch (err) {
                showDndcAlert('llResults', 'error', `計算錯誤: ${err.message}`);
                return;
            }

            document.getElementById('llResults').innerHTML = llResultsHtml(llResult, gdResult);
        });
    }
}

/**
 * 解析「手動濃度」欄位。
 * 空白（或純空白字元）視為未填 → null（改由 UV 計算）；
 * 其餘一律 parseFloat，讓 0 與負值能被後續驗證攔下，而不是被當成未填。
 *
 * @param {string} rawValue - input 的原始字串
 * @returns {number|null} 濃度 (mg/mL) 或 null
 */
function parseManualConcentration(rawValue) {
    if (rawValue == null || String(rawValue).trim() === '') return null;
    const parsed = parseFloat(rawValue);
    return Number.isNaN(parsed) ? null : parsed;
}

/** 理論校正結果（純函式） */
function dndcCorrectionResultsHtml(result) {
    const { tile, tiles, rows } = ResultTiles;
    const signed = value => `${value >= 0 ? '+' : ''}${value.toFixed(6)}`;
    return `
        ${tiles([
            tile({ label: '最終 d<i>n</i>/d<i>c</i>', value: result.finalDndc.toFixed(4), hero: true }),
            tile({ label: '參考 d<i>n</i>/d<i>c</i>', value: result.refDndc.toFixed(4) }),
            tile({ label: '溫度校正後', value: result.tempCorrected.toFixed(4) }),
        ])}
        ${rows([
            { label: '溫度貢獻', value: signed(result.tempContribution) },
            { label: '波長貢獻', value: signed(result.waveContribution) },
        ])}
        <div class="formula-note mt-md">
            溫度校正: d<i>n</i>/d<i>c</i>(<i>T</i>) = d<i>n</i>/d<i>c</i>(25°C) × (1 + α×Δ<i>T</i>), α = −4×10⁻⁴ °C⁻¹<br>
            波長校正 (Cauchy): d<i>n</i>/d<i>c</i>(λ₂) = d<i>n</i>/d<i>c</i>(λ₁) × (<i>A</i> + <i>B</i>/λ₂²) / (<i>A</i> + <i>B</i>/λ₁²)，
            蛋白質預設 <i>A</i> = 0.1756 mL/g、<i>B</i> = 5.0×10³ nm²·mL/g
        </div>
    `;
}

/** Lorentz-Lorenz／Gladstone-Dale 結果（純函式） */
function llResultsHtml(llResult, gdResult) {
    const { tile, tiles } = ResultTiles;
    return tiles([
        tile({ label: 'Lorentz-Lorenz d<i>n</i>/d<i>c</i>', value: llResult.toFixed(4), unit: 'mL/g' }),
        tile({ label: 'Gladstone-Dale (近似)', value: gdResult.toFixed(4), unit: 'mL/g' }),
    ]);
}
