/**
 * TPS13A SAXS Calculator - SAXS Parameters Section
 * SAXS 參數區段：理論值面板、Guinier 分析輸入與結果顯示。
 */

// ========================
// SAXS Parameters Section
// ========================

/**
 * 取得序列分析可提供的理論值選用參數 (電子數、乾燥體積、殘基數)。
 * 有這些資訊時 calculateTheoreticalI0 會改用 Excel `Protein_Io_cal_` 精確式。
 *
 * 只有在「理論值面板實際使用的 MW」與序列分析結果相符時才回傳，
 * 避免使用者手動改 MW 後，仍套用另一個蛋白質的電子數與乾燥體積。
 *
 * @param {number} mwUsed - 面板實際採用的分子量 (Da)
 * @returns {object} opts (可能為空物件)
 */
/**
 * 顯示理論 I(0)：主值為經驗式（與實測 BSA 一致），
 * 有序列組成時附上 Excel 精確式作參考（對 BSA 低約 20%，見 calculations.js 說明）。
 */
function renderTheoreticalI0(result, valueEl, concentrationState) {
    const methodEl = document.getElementById('theoreticalI0Method');

    // 濃度未填／非數字／≤ 0 時不得靜默代入 1.0 mg/mL：理論 I(0) 與 c 成正比，
    // 顯示出來的會是一個和樣品無關、卻格式完整看似權威的數字。
    if (concentrationState && !concentrationState.valid) {
        if (valueEl) valueEl.textContent = '--';
        if (methodEl) {
            methodEl.textContent = concentrationState.message;
            methodEl.style.color = concentrationState.isError ? 'var(--color-accent-danger)' : '';
        }
        return;
    }

    if (valueEl) valueEl.textContent = result.theoreticalI0.toExponential(2);
    if (!methodEl) return;
    methodEl.style.color = '';
    if (Number.isFinite(result.exactI0)) {
        methodEl.textContent = `經驗式（BSA 校正）· Excel 精確式（序列）${result.exactI0.toExponential(2)}`;
    } else {
        methodEl.textContent = '經驗式 c×MW×7.9×10⁻⁷（BSA 校正）';
    }
}

/**
 * 讀取「樣品濃度」欄位供理論值面板使用。
 *
 * @returns {{valid: boolean, isError: boolean, value: number|null, message: string}}
 */
function readPanelConcentration() {
    const el = document.getElementById('sampleConcentration');
    const value = parseFloat(el ? el.value : '');
    if (!Number.isFinite(value)) {
        return { valid: false, isError: false, value: null, message: '請輸入濃度 (mg/mL) 以取得理論 I(0)' };
    }
    if (value <= 0) {
        return { valid: false, isError: true, value, message: `濃度必須大於 0（目前 ${value} mg/mL）` };
    }
    return { valid: true, isError: false, value, message: '' };
}

function getTheoreticalOpts(mwUsed) {
    const protein = AppState.proteinData;
    if (!protein || !Number.isFinite(protein.molecularWeight)) return {};
    if (!Number.isFinite(mwUsed)) return {};
    // MW 欄位以整數顯示，容許 1 Da 的四捨五入誤差
    if (Math.abs(mwUsed - protein.molecularWeight) > 1) return {};

    const opts = {};
    if (Number.isFinite(protein.electronCount) && protein.electronCount > 0) {
        opts.electrons = protein.electronCount;
    }
    if (Number.isFinite(protein.dryVolume) && protein.dryVolume > 0) {
        opts.dryVolume = protein.dryVolume;
    }
    if (Number.isFinite(protein.length) && protein.length > 0) {
        opts.nResidues = protein.length;
    }
    return opts;
}

function initSAXSSection() {
    const calculateBtn = document.getElementById('calculateSAXS');
    const concentrationInput = document.getElementById('sampleConcentration');
    const theoreticalI0Display = document.getElementById('theoreticalI0Display');
    const theoreticalRgDisplay = document.getElementById('theoreticalRgDisplay');
    const predictedRgDisplay = document.getElementById('predictedRgDisplay');
    const theoreticalDmaxDisplay = document.getElementById('theoreticalDmaxDisplay');
    const theoreticalMWInput = document.getElementById('theoreticalMWInput');

    // Function to update all theoretical values display
    function updateTheoreticalValues() {
        const concentrationState = readPanelConcentration();
        // Rg / Predicted Rg / Dmax 不依賴濃度，照常顯示；只有 I(0) 需要濃度
        const concentration = concentrationState.valid ? concentrationState.value : NaN;
        // Use manual MW input if available, otherwise use protein data MW
        let proteinMw = parseFloat(theoreticalMWInput?.value);
        if (isNaN(proteinMw) || proteinMw <= 0) {
            proteinMw = AppState.proteinData?.molecularWeight;
        }

        if (proteinMw) {
            // Calculate all theoretical parameters at once
            const result = SAXSCalculations.calculateAllTheoreticalParams(proteinMw, concentration, 'globular', getTheoreticalOpts(proteinMw));

            renderTheoreticalI0(result, theoreticalI0Display, concentrationState);
            if (theoreticalRgDisplay) {
                theoreticalRgDisplay.textContent = result.theoreticalRg.toFixed(1);
            }
            if (predictedRgDisplay) {
                predictedRgDisplay.textContent = result.predictedRg.toFixed(2);
            }
            if (theoreticalDmaxDisplay) {
                theoreticalDmaxDisplay.textContent = result.theoreticalDmax.toFixed(0);
            }
            // MW input already has the value, no need to update
            window.DetectorRgPanel?.setPredictedFromMw(proteinMw);
        } else {
            window.DetectorRgPanel?.setPredictedFromMw(NaN);
            if (theoreticalI0Display) theoreticalI0Display.textContent = '--';
            const theoreticalI0Method = document.getElementById('theoreticalI0Method');
            if (theoreticalI0Method) theoreticalI0Method.textContent = '';
            if (theoreticalRgDisplay) theoreticalRgDisplay.textContent = '--';
            if (predictedRgDisplay) predictedRgDisplay.textContent = '--';
            if (theoreticalDmaxDisplay) theoreticalDmaxDisplay.textContent = '--';
            // Clear input placeholder if no valid MW
            if (theoreticalMWInput && !theoreticalMWInput.value) {
                theoreticalMWInput.placeholder = '--';
            }
        }
    }

    // Update theoretical values when concentration changes
    if (concentrationInput) {
        concentrationInput.addEventListener('input', updateTheoreticalValues);
    }

    // Update theoretical values when MW input changes
    if (theoreticalMWInput) {
        theoreticalMWInput.addEventListener('input', updateTheoreticalValues);
        theoreticalMWInput.addEventListener('change', updateTheoreticalValues);
    }

    // Initial update if protein data exists
    updateTheoreticalValues();

    calculateBtn.addEventListener('click', () => {
        const concentration = parseFloat(document.getElementById('sampleConcentration').value);
        const xrayEnergy = parseFloat(document.getElementById('xrayEnergy').value);
        const i0Guinier = parseFloat(document.getElementById('i0Guinier').value);
        const rgGuinier = parseFloat(document.getElementById('rgGuinier').value);
        window.DetectorRgPanel?.notifyMeasured(rgGuinier);
        const guinierQmax = parseFloat(document.getElementById('guinierQmax').value);
        const i0Pr = parseFloat(document.getElementById('i0Pr').value);
        const rgPr = parseFloat(document.getElementById('rgPr').value);
        const dmax = parseFloat(document.getElementById('dmax').value);
        const porodVolume = parseFloat(document.getElementById('porodVolume').value);

        // Validate required inputs
        if (isNaN(concentration) || concentration <= 0) {
            showAlert('saxsResults', 'error', '樣品濃度必須大於 0');
            return;
        }
        if (isNaN(xrayEnergy) || xrayEnergy <= 0) {
            showAlert('saxsResults', 'error', 'X 射線能量必須大於 0');
            return;
        }

        // Calculate wavelength from energy
        const wavelength = 12.398 / xrayEnergy; // Å

        // Calculate MW from Porod volume
        let mwFromPorod = null;
        if (!isNaN(porodVolume) && porodVolume > 0) {
            mwFromPorod = SAXSCalculations.estimateMwFromPorodVolume(porodVolume);
        }

        // Calculate all theoretical values if protein data exists
        let theoreticalParams = null;
        const proteinMw = AppState.proteinData?.molecularWeight;
        if (proteinMw) {
            theoreticalParams = SAXSCalculations.calculateAllTheoreticalParams(proteinMw, concentration, 'globular', getTheoreticalOpts(proteinMw));
        }

        // Store SAXS data
        AppState.saxsData = {
            concentration,
            wavelength,
            xrayEnergy,
            i0Guinier,
            rgGuinier,
            guinierQmax,
            i0Pr,
            rgPr,
            dmax,
            porodVolume,
            mwFromPorod,
            theoreticalI0: theoreticalParams?.theoreticalI0,
            theoreticalRg: theoreticalParams?.theoreticalRg,
            theoreticalDmax: theoreticalParams?.theoreticalDmax
        };

        // Display results
        displaySAXSResults(AppState.saxsData);

        // Update IUCr table
        updateIUCrTable();
    });
}

// Update all theoretical values when protein analysis is done
function updateTheoreticalValuesFromProtein() {
    const concentrationInput = document.getElementById('sampleConcentration');
    const theoreticalI0Display = document.getElementById('theoreticalI0Display');
    const theoreticalRgDisplay = document.getElementById('theoreticalRgDisplay');
    const predictedRgDisplay = document.getElementById('predictedRgDisplay');
    const theoreticalDmaxDisplay = document.getElementById('theoreticalDmaxDisplay');
    const theoreticalMWInput = document.getElementById('theoreticalMWInput');

    if (!concentrationInput) return;

    const concentrationState = readPanelConcentration();
    const concentration = concentrationState.valid ? concentrationState.value : NaN;
    const proteinMw = AppState.proteinData?.molecularWeight;

    if (proteinMw) {
        const result = SAXSCalculations.calculateAllTheoreticalParams(proteinMw, concentration, 'globular', getTheoreticalOpts(proteinMw));

        renderTheoreticalI0(result, theoreticalI0Display, concentrationState);
        if (theoreticalRgDisplay) {
            theoreticalRgDisplay.textContent = result.theoreticalRg.toFixed(1);
        }
        if (predictedRgDisplay) {
            predictedRgDisplay.textContent = result.predictedRg.toFixed(2);
        }
        if (theoreticalDmaxDisplay) {
            theoreticalDmaxDisplay.textContent = result.theoreticalDmax.toFixed(0);
        }
        // Update MW input field with protein MW from sequence analysis
        if (theoreticalMWInput) {
            theoreticalMWInput.value = proteinMw.toFixed(0);
        }

        // 偵測器距離建議：只更新「序列預測」Rg，面板若在手動／實測來源不會被覆蓋
        window.DetectorRgPanel?.setPredictedFromMw(proteinMw);
    }
}

// Keep backward compatibility
function updateTheoreticalI0FromProtein() {
    updateTheoreticalValuesFromProtein();
}

function displaySAXSResults(data) {
    const resultsDiv = document.getElementById('saxsResults');

    const proteinMw = AppState.proteinData?.molecularWeight;
    const dryVolume = AppState.proteinData?.dryVolume;

    // Calculate MW from I(0) if concentration and I(0) are valid
    let mwFromI0Guinier = null;
    let mwFromI0Pr = null;
    if (data.concentration > 0) {
        if (!isNaN(data.i0Guinier) && data.i0Guinier > 0) {
            mwFromI0Guinier = SAXSCalculations.calculateMwFromI0(data.i0Guinier, data.concentration);
        }
        if (!isNaN(data.i0Pr) && data.i0Pr > 0) {
            mwFromI0Pr = SAXSCalculations.calculateMwFromI0(data.i0Pr, data.concentration);
        }
    }

    // Build MW comparison alert
    let mwAlertHtml = '';
    if (proteinMw) {
        const comparisons = [];
        if (data.mwFromPorod) {
            const ratio = data.mwFromPorod / proteinMw;
            comparisons.push(`Porod / 序列 = ${ratio.toFixed(2)}`);
        }
        if (mwFromI0Guinier) {
            const ratio = mwFromI0Guinier / proteinMw;
            comparisons.push(`I(0) Guinier / 序列 = ${ratio.toFixed(2)}`);
        }
        if (mwFromI0Pr) {
            const ratio = mwFromI0Pr / proteinMw;
            comparisons.push(`I(0) P(r) / 序列 = ${ratio.toFixed(2)}`);
        }
        if (comparisons.length > 0) {
            // Use the first available MW ratio for color coding
            const firstMw = data.mwFromPorod || mwFromI0Guinier || mwFromI0Pr;
            const isClose = Math.abs(firstMw - proteinMw) / proteinMw < 0.2;
            mwAlertHtml = `
            <div class="alert ${isClose ? 'alert-success' : 'alert-warning'}" style="margin-top: 1rem;">
                <strong>MW 比較：</strong>${comparisons.join(' | ')}
                <br>${isClose ? '✓ 符合預期 (單體)' : '⚠️ 可能有聚集或複合物形成'}
            </div>`;
        }
    }

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">X 射線波長</div>
                <div class="result-value">${data.wavelength.toFixed(5)} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">樣品濃度</div>
                <div class="result-value">${data.concentration} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
        </div>

        <div class="section-divider"><span>Guinier 分析</span></div>

        <div class="result-grid">
            <div class="result-item">
                <div class="result-label"><i>I</i>(0) from Guinier</div>
                <div class="result-value">${isNaN(data.i0Guinier) ? '-' : data.i0Guinier.toFixed(5)} <span style="font-size: 0.75rem;">cm⁻¹</span></div>
            </div>
            <div class="result-item">
                <div class="result-label"><i>R</i><sub>g</sub> from Guinier</div>
                <div class="result-value">${isNaN(data.rgGuinier) ? '-' : data.rgGuinier.toFixed(2)} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
        </div>
        ${(() => {
            if (!isNaN(data.guinierQmax) && !isNaN(data.rgGuinier) && data.guinierQmax > 0 && data.rgGuinier > 0) {
                const qRg = data.guinierQmax * data.rgGuinier;
                if (qRg > 1.3) {
                    return `<div class="alert alert-warning" style="margin-top: 0.5rem;">
                        ⚠️ <i>q</i><sub>max</sub> × <i>R</i><sub>g</sub> = ${qRg.toFixed(2)} > 1.3 — Guinier 擬合可能不可靠，建議降低 <i>q</i><sub>max</sub>
                    </div>`;
                }
                return `<div class="alert alert-success" style="margin-top: 0.5rem;">
                    ✓ <i>q</i><sub>max</sub> × <i>R</i><sub>g</sub> = ${qRg.toFixed(2)} ≤ 1.3 — Guinier 擬合範圍有效
                </div>`;
            }
            return '';
        })()}

        <div class="section-divider"><span><i>P</i>(<i>r</i>) 分析</span></div>

        <div class="result-grid">
            <div class="result-item">
                <div class="result-label"><i>I</i>(0) from <i>P</i>(<i>r</i>)</div>
                <div class="result-value">${isNaN(data.i0Pr) ? '-' : data.i0Pr.toFixed(5)} <span style="font-size: 0.75rem;">cm⁻¹</span></div>
            </div>
            <div class="result-item">
                <div class="result-label"><i>R</i><sub>g</sub> from <i>P</i>(<i>r</i>)</div>
                <div class="result-value">${isNaN(data.rgPr) ? '-' : data.rgPr.toFixed(2)} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
            <div class="result-item">
                <div class="result-label"><i>D</i><sub>max</sub></div>
                <div class="result-value">${isNaN(data.dmax) ? '-' : data.dmax} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
        </div>

        <div class="section-divider"><span>體積與分子量</span></div>

        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">Porod volume</div>
                <div class="result-value">${isNaN(data.porodVolume) ? '-' : data.porodVolume.toLocaleString()} <span style="font-size: 0.75rem;">Å³</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">乾燥體積 (序列)</div>
                <div class="result-value">${dryVolume ? dryVolume.toFixed(1) : '-'} <span style="font-size: 0.75rem;">Å³</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">MW from Porod</div>
                <div class="result-value">${data.mwFromPorod ? data.mwFromPorod.toFixed(0) : '-'} <span style="font-size: 0.75rem;">Da</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">MW from 序列</div>
                <div class="result-value">${proteinMw ? proteinMw.toFixed(0) : '-'} <span style="font-size: 0.75rem;">Da</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">MW from <i>I</i>(0) Guinier</div>
                <div class="result-value">${mwFromI0Guinier ? mwFromI0Guinier.toFixed(0) : '-'} <span style="font-size: 0.75rem;">Da</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">MW from <i>I</i>(0) <i>P</i>(<i>r</i>)</div>
                <div class="result-value">${mwFromI0Pr ? mwFromI0Pr.toFixed(0) : '-'} <span style="font-size: 0.75rem;">Da</span></div>
            </div>
        </div>

        ${mwAlertHtml}
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('saxsResults');
}
