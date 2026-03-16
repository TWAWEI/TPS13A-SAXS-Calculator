/**
 * TPS13A SAXS Calculator - dn/dc UI Module
 * UI 事件綁定、結果顯示
 */

// 全域狀態：儲存已載入的色譜數據供多個頁面共用
const DndcState = {
    loadedData: null,   // { time, uv, ri, headers }
    charts: {}
};

// ========================
// 初始化
// ========================
function initDndcSections() {
    initDndcTheorySection();
    initDndcHplcSection();
    initDndcMultiSection();
    initDndcSliceSection();
}

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

            document.getElementById('dndcCorrectionResults').innerHTML = `
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">參考 d<i>n</i>/d<i>c</i></div>
                        <div class="result-value">${result.refDndc.toFixed(4)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">溫度校正後</div>
                        <div class="result-value">${result.tempCorrected.toFixed(4)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">溫度貢獻</div>
                        <div class="result-value">${result.tempContribution >= 0 ? '+' : ''}${result.tempContribution.toFixed(6)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">最終 d<i>n</i>/d<i>c</i></div>
                        <div class="result-value" style="font-size: 1.25rem; color: var(--color-accent-primary);">${result.finalDndc.toFixed(4)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">波長貢獻</div>
                        <div class="result-value">${result.waveContribution >= 0 ? '+' : ''}${result.waveContribution.toFixed(6)}</div>
                    </div>
                </div>
                <div class="formula-note mt-md">
                    溫度校正: d<i>n</i>/d<i>c</i>(<i>T</i>) = d<i>n</i>/d<i>c</i>(25°C) × (1 + α×Δ<i>T</i>), α = −4×10⁻⁴ °C⁻¹<br>
                    波長校正: d<i>n</i>/d<i>c</i>(λ₂) = d<i>n</i>/d<i>c</i>(λ₁) × (λ₁/λ₂)²
                </div>
            `;
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

            const llResult = DndcCalculations.lorentzLorenz(nP, nS, dP, dS);
            const gdResult = DndcCalculations.gladstoneDale(nP, nS);

            document.getElementById('llResults').innerHTML = `
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">Lorentz-Lorenz d<i>n</i>/d<i>c</i></div>
                        <div class="result-value" style="font-size: 1.25rem; color: var(--color-accent-primary);">${llResult.toFixed(4)} <span style="font-size: 0.75rem;">mL/g</span></div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Gladstone-Dale (近似)</div>
                        <div class="result-value">${gdResult.toFixed(4)} <span style="font-size: 0.75rem;">mL/g</span></div>
                    </div>
                </div>
            `;
        });
    }
}

// ========================
// HPLC dn/dc 頁面
// ========================
function initDndcHplcSection() {
    const fileInput = document.getElementById('dndcFileInput');
    const calcBtn = document.getElementById('calculateHplcDndc');

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await DndcFileParser.readFile(file);
                const parsed = DndcFileParser.parseCSV(text);

                if (parsed.data.length === 0) {
                    document.getElementById('dndcFileStatus').textContent = '檔案解析失敗：無有效數據';
                    return;
                }

                // 自動偵測欄位
                const detected = DndcFileParser.autoDetectColumns(parsed.headers);

                // 更新欄位下拉選單
                const selects = ['dndcTimeCol', 'dndcUvCol', 'dndcRiCol'];
                const detectedIndices = [detected.timeCol, detected.uvCol, detected.riCol];

                selects.forEach((selId, i) => {
                    const sel = document.getElementById(selId);
                    sel.innerHTML = parsed.headers.map((h, idx) =>
                        `<option value="${idx}" ${idx === detectedIndices[i] ? 'selected' : ''}>${h}</option>`
                    ).join('');
                });

                // 儲存數據
                DndcState.loadedData = {
                    parsed,
                    headers: parsed.headers
                };

                document.getElementById('dndcFileStatus').textContent =
                    `已載入: ${file.name} (${parsed.data.length} 列, ${parsed.headers.length} 欄)`;

            } catch (err) {
                document.getElementById('dndcFileStatus').textContent = `載入失敗: ${err.message}`;
            }
        });
    }

    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            if (!DndcState.loadedData) {
                showDndcAlert('hplcDndcResults', 'error', '請先載入數據檔案');
                return;
            }

            const parsed = DndcState.loadedData.parsed;
            const timeIdx = parseInt(document.getElementById('dndcTimeCol').value);
            const uvIdx = parseInt(document.getElementById('dndcUvCol').value);
            const riIdx = parseInt(document.getElementById('dndcRiCol').value);

            const time = DndcFileParser.getColumnData(parsed, timeIdx);
            const uv = DndcFileParser.getColumnData(parsed, uvIdx);
            const ri = DndcFileParser.getColumnData(parsed, riIdx);

            // 儲存供 slice 頁面使用
            DndcState.loadedData.time = time;
            DndcState.loadedData.uv = uv;
            DndcState.loadedData.ri = ri;

            const params = {
                peakStart: parseFloat(document.getElementById('dndcPeakStart').value),
                peakEnd: parseFloat(document.getElementById('dndcPeakEnd').value),
                bl1Start: parseFloat(document.getElementById('dndcBl1Start').value),
                bl1End: parseFloat(document.getElementById('dndcBl1End').value),
                bl2Start: parseFloat(document.getElementById('dndcBl2Start').value),
                bl2End: parseFloat(document.getElementById('dndcBl2End').value),
                epsilon: parseFloat(document.getElementById('dndcEpsilon').value),
                pathLen: parseFloat(document.getElementById('dndcPathLen').value),
                riFactor: parseFloat(document.getElementById('dndcRiFactor').value),
                riDelay: 0,
                baselineMode: document.getElementById('dndcBaselineMode').value,
                peakMode: 'area',
                manualC: null,
                autoAlign: document.getElementById('dndcAutoAlign').checked,
                decimalPlaces: 4
            };

            try {
                const result = DndcCalculations.computeHplcDndc(time, uv, ri, params);
                displayHplcDndcResults(result, params);
                displayChromatogram(time, uv, ri, params);
            } catch (err) {
                showDndcAlert('hplcDndcResults', 'error', `計算錯誤: ${err.message}`);
            }
        });
    }
}

function displayHplcDndcResults(result, params) {
    const resultsDiv = document.getElementById('hplcDndcResults');
    const alignInfo = result.alignmentLag != null
        ? `<div class="result-item"><div class="result-label">UV-RI 時間偏移</div><div class="result-value">${result.alignmentLag.toFixed(4)} <span style="font-size: 0.75rem;">min</span></div></div>`
        : '';

    resultsDiv.innerHTML = `
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i></div>
                <div class="stat-value" style="font-size: 1.75rem;">${result.dnDc.toFixed(4)} <span class="stat-unit">mL/g</span></div>
            </div>
        </div>
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">濃度</div>
                <div class="result-value">${result.concentration != null ? result.concentration.toFixed(4) : '-'} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">Δ UV</div>
                <div class="result-value">${result.deltaUv != null ? result.deltaUv.toFixed(6) : '-'}</div>
            </div>
            <div class="result-item">
                <div class="result-label">Δ RI</div>
                <div class="result-value">${result.deltaRi.toFixed(6)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">RI peak area</div>
                <div class="result-value">${result.riPeakArea.toFixed(6)}</div>
            </div>
            ${alignInfo}
        </div>
    `;
}

function displayChromatogram(time, uv, ri, params) {
    const card = document.getElementById('dndcChromatogramCard');
    card.classList.remove('hidden');

    if (DndcState.charts.chromatogram) {
        DndcState.charts.chromatogram.destroy();
    }

    DndcState.charts.chromatogram = DndcCharts.createChromatogramChart(
        'dndcChromatogramChart', time, uv, ri,
        { peakStart: params.peakStart, peakEnd: params.peakEnd }
    );
}

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
                <td><input type="number" class="form-input" step="0.0001"></td>
                <td><input type="number" class="form-input" step="0.000001"></td>
                <td><button class="btn btn-sm btn-secondary" onclick="this.closest('tr').remove()">✕</button></td>
            `;
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
                displayMultiFitResults(result, concentrations, riValues);
            } catch (err) {
                showDndcAlert('multiDndcResults', 'error', `擬合錯誤: ${err.message}`);
            }
        });
    }
}

function displayMultiFitResults(result, xData, yData) {
    const resultsDiv = document.getElementById('multiDndcResults');

    const r2Quality = result.rSquared >= 0.999 ? '優良' :
        result.rSquared >= 0.99 ? '良好' :
        result.rSquared >= 0.95 ? '可接受' : '偏低';
    const r2Class = result.rSquared >= 0.99 ? 'alert-success' :
        result.rSquared >= 0.95 ? 'alert-warning' : 'alert-error';

    resultsDiv.innerHTML = `
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i> (斜率)</div>
                <div class="stat-value" style="font-size: 1.75rem;">${result.dnDc.toFixed(4)} <span class="stat-unit">mL/g</span></div>
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
        { xLabel: 'Concentration (g/mL)', yLabel: 'ΔRI (RIU)' }
    );
}

// ========================
// Slice-by-slice 頁面
// ========================
function initDndcSliceSection() {
    const calcBtn = document.getElementById('calculateSliceDndc');

    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            if (!DndcState.loadedData || !DndcState.loadedData.time) {
                showDndcAlert('sliceDndcResults', 'error', '請先在「HPLC dn/dc」頁面載入數據檔案');
                return;
            }

            const { time, uv, ri } = DndcState.loadedData;
            const minUvFraction = parseFloat(document.getElementById('sliceMinUvFraction').value) || 0.05;

            const params = {
                peakStart: parseFloat(document.getElementById('dndcPeakStart').value),
                peakEnd: parseFloat(document.getElementById('dndcPeakEnd').value),
                bl1Start: parseFloat(document.getElementById('dndcBl1Start').value),
                bl1End: parseFloat(document.getElementById('dndcBl1End').value),
                bl2Start: parseFloat(document.getElementById('dndcBl2Start').value),
                bl2End: parseFloat(document.getElementById('dndcBl2End').value),
                epsilon: parseFloat(document.getElementById('dndcEpsilon').value),
                pathLen: parseFloat(document.getElementById('dndcPathLen').value),
                riFactor: parseFloat(document.getElementById('dndcRiFactor').value),
                riDelay: 0,
                baselineMode: document.getElementById('dndcBaselineMode').value,
                peakMode: 'area',
                manualC: null,
                autoAlign: document.getElementById('dndcAutoAlign').checked,
                decimalPlaces: 4
            };

            try {
                const result = DndcCalculations.computeSliceDndc(time, uv, ri, params, minUvFraction);
                displaySliceResults(result);
            } catch (err) {
                showDndcAlert('sliceDndcResults', 'error', `分析錯誤: ${err.message}`);
            }
        });
    }
}

function displaySliceResults(result) {
    const resultsDiv = document.getElementById('sliceDndcResults');

    const r2Quality = result.rSquared >= 0.999 ? '優良' :
        result.rSquared >= 0.99 ? '良好' :
        result.rSquared >= 0.95 ? '可接受' : '偏低';
    const r2Class = result.rSquared >= 0.99 ? 'alert-success' :
        result.rSquared >= 0.95 ? 'alert-warning' : 'alert-error';

    resultsDiv.innerHTML = `
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i> (斜率)</div>
                <div class="stat-value" style="font-size: 1.75rem;">${result.dnDc.toFixed(4)} <span class="stat-unit">mL/g</span></div>
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
                <div class="result-label">有效切片數</div>
                <div class="result-value">${result.nSlices}</div>
            </div>
        </div>
        <div class="alert ${r2Class} mt-md">
            擬合品質：${r2Quality} (<i>R</i>² ${result.rSquared >= 0.999 ? '≥' : result.rSquared >= 0.99 ? '≥' : '<'} ${result.rSquared >= 0.999 ? '0.999' : result.rSquared >= 0.99 ? '0.99' : '0.95'})
        </div>
    `;

    // 顯示擬合圖
    const chartContainer = document.getElementById('sliceDndcChartContainer');
    chartContainer.classList.remove('hidden');

    if (DndcState.charts.sliceFit) {
        DndcState.charts.sliceFit.destroy();
    }

    DndcState.charts.sliceFit = DndcCharts.createLinearFitChart(
        'sliceDndcChart', result.concentrations, result.riValues, result.fitResult,
        { xLabel: 'Concentration (g/mL)', yLabel: 'Δn (RIU)' }
    );
}

// ========================
// ASTRA .afe7 解析
// ========================
function initAstraSection() {
    const parseBtn = document.getElementById('parseAstraFiles');
    const fileInput = document.getElementById('astraFileInput');

    if (!parseBtn || !fileInput) return;

    parseBtn.addEventListener('click', async () => {
        const files = fileInput.files;
        if (!files || files.length === 0) {
            document.getElementById('astraParseStatus').textContent = '請先選擇 .afe7 檔案';
            return;
        }

        const statusEl = document.getElementById('astraParseStatus');
        const resultsEl = document.getElementById('astraParseResults');
        statusEl.textContent = '正在載入 sql.js 和解析檔案...';
        resultsEl.innerHTML = '';

        const intStart = parseFloat(document.getElementById('astraIntStart').value) || 5;
        const intEnd = parseFloat(document.getElementById('astraIntEnd').value) || 12;

        const parsedFiles = [];

        try {
            for (let i = 0; i < files.length; i++) {
                statusEl.textContent = `解析中... (${i + 1}/${files.length}) ${files[i].name}`;
                const result = await DndcAstraParser.parseAfe7File(files[i]);
                parsedFiles.push({ fileName: files[i].name, ...result });
            }

            statusEl.textContent = `成功解析 ${parsedFiles.length} 個檔案`;
            displayAstraResults(parsedFiles, intStart, intEnd);

        } catch (err) {
            statusEl.textContent = `解析失敗: ${err.message}`;
        }
    });
}

function displayAstraResults(parsedFiles, intStart, intEnd) {
    const resultsEl = document.getElementById('astraParseResults');

    // 計算每個檔案的 RI 面積
    const injections = [];
    for (const pf of parsedFiles) {
        if (!pf.riChannel) continue;

        const time = pf.riChannel.time;
        const values = pf.riChannel.values;

        // 簡易基線校正：取積分範圍外的平均值
        let blSum = 0, blCount = 0;
        for (let i = 0; i < time.length; i++) {
            if (time[i] < intStart || time[i] > intEnd) {
                blSum += values[i];
                blCount++;
            }
        }
        const blMean = blCount > 0 ? blSum / blCount : 0;

        // 梯形積分
        let area = 0;
        for (let i = 0; i < time.length - 1; i++) {
            if (time[i] >= intStart && time[i + 1] <= intEnd) {
                const h = time[i + 1] - time[i];
                const v1 = values[i] - blMean;
                const v2 = values[i + 1] - blMean;
                area += 0.5 * (v1 + v2) * h;
            }
        }

        // RI 校正（K_cal）
        const kCal = pf.riDetector && pf.riDetector.calibrationConstant
            ? pf.riDetector.calibrationConstant : 1.0;

        // 流速
        const flowRate = pf.experiment ? pf.experiment.flowRateMlMin : 0.5;

        // RI 面積 (RIU·mL)
        const riAreaVolume = Math.abs(area) * kCal * flowRate;

        // 注入質量（從 ASTRA 取）— 如果沒有則讓使用者輸入
        const concGml = pf.sample ? pf.sample.concentrationGml : 0;

        injections.push({
            fileName: pf.fileName,
            sampleName: pf.sample ? pf.sample.name : 'Unknown',
            concentration: concGml,
            riArea: area,
            riAreaVolume,
            kCal,
            flowRate,
            injectionVolume: 0 // 需要使用者輸入
        });
    }

    if (injections.length === 0) {
        resultsEl.innerHTML = '<div class="alert alert-error">未找到有效的 RI 通道數據</div>';
        return;
    }

    // 顯示解析結果表格，讓使用者確認/修改濃度和體積
    let tableHtml = `
        <div class="table-wrapper mt-md">
            <table class="table" id="astraInjectionTable">
                <thead>
                    <tr>
                        <th>檔案</th>
                        <th>樣品</th>
                        <th>濃度 (g/mL)</th>
                        <th>注射體積 (mL)</th>
                        <th>RI 面積</th>
                        <th><i>K</i><sub>cal</sub></th>
                    </tr>
                </thead>
                <tbody>
    `;

    injections.forEach((inj, i) => {
        tableHtml += `
            <tr>
                <td style="font-size: 0.75rem;">${inj.fileName}</td>
                <td>${inj.sampleName}</td>
                <td><input type="number" class="form-input" value="${inj.concentration}" step="0.0001" data-astra-idx="${i}" data-field="conc"></td>
                <td><input type="number" class="form-input" value="0.05" step="0.001" data-astra-idx="${i}" data-field="vol"></td>
                <td style="font-family: var(--font-mono);">${inj.riAreaVolume.toExponential(4)}</td>
                <td style="font-family: var(--font-mono);">${inj.kCal.toExponential(4)}</td>
            </tr>
        `;
    });

    tableHtml += `
                </tbody>
            </table>
        </div>
        <button class="btn btn-primary btn-lg btn-full mt-md" id="fitAstraData">
            ASTRA 線性擬合
        </button>
    `;

    resultsEl.innerHTML = tableHtml;

    // 綁定擬合按鈕
    document.getElementById('fitAstraData').addEventListener('click', () => {
        const table = document.getElementById('astraInjectionTable');
        const rows = table.querySelectorAll('tbody tr');
        const masses = [];
        const areas = [];

        rows.forEach((row, i) => {
            const concInput = row.querySelector('[data-field="conc"]');
            const volInput = row.querySelector('[data-field="vol"]');
            const conc = parseFloat(concInput.value);
            const vol = parseFloat(volInput.value);

            if (!isNaN(conc) && !isNaN(vol) && conc > 0 && vol > 0) {
                masses.push(conc * vol); // mass in grams
                areas.push(injections[i].riAreaVolume);
            }
        });

        if (masses.length < 2) {
            showDndcAlert('multiDndcResults', 'error', '至少需要 2 組有效資料（請確認濃度和體積都已填入）');
            return;
        }

        try {
            const result = DndcCalculations.linearFit(masses, areas);
            // slope = dn/dc (因為 x = mass, y = RI_area_volume = dn/dc × mass)
            displayMultiFitResults(result, masses, areas);
        } catch (err) {
            showDndcAlert('multiDndcResults', 'error', `擬合錯誤: ${err.message}`);
        }
    });
}

// ========================
// 工具函數
// ========================
function showDndcAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    }
}

// 在 DOMContentLoaded 時初始化
document.addEventListener('DOMContentLoaded', initDndcSections);
