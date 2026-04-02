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

            const isAfe7 = file.name.toLowerCase().endsWith('.afe7');

            try {
                if (isAfe7) {
                    // ASTRA .afe7 檔案
                    document.getElementById('dndcFileStatus').textContent = '正在載入 ASTRA 檔案...';
                    const astraResult = await DndcAstraParser.parseAfe7File(file);

                    if (!astraResult.riChannel) {
                        document.getElementById('dndcFileStatus').textContent = '未找到 RI 通道數據';
                        return;
                    }

                    // 列出所有可用通道
                    const channels = astraResult.allChannels || [];
                    const channelData = astraResult.channelData || {};

                    // 找到 time 軸（用 RI 通道的 time）
                    const riCh = astraResult.riChannel;
                    if (!riCh) {
                        document.getElementById('dndcFileStatus').textContent = '未找到 RI 通道數據';
                        return;
                    }
                    const time = riCh.time;

                    // 建立表頭：Time + 所有通道
                    const headers = ['Time (min)'];
                    const channelKeys = [];
                    for (const ch of channels) {
                        if (channelData[ch.dnCode]) {
                            headers.push(`${ch.label} (DN ${ch.dnCode})`);
                            channelKeys.push(ch.dnCode);
                        }
                    }

                    // 建立 parsed data
                    const data = time.map((t, i) => {
                        const row = [t];
                        for (const dk of channelKeys) {
                            const chData = channelData[dk];
                            row.push(chData && i < chData.values.length ? chData.values[i] : 0);
                        }
                        return row;
                    });
                    const parsed = { headers, data };

                    // 自動偵測 UV 和 RI 欄位
                    let uvIdx = -1;
                    let riIdx = -1;
                    headers.forEach((h, idx) => {
                        const hl = h.toLowerCase();
                        if (hl.includes('ri_aux') || hl.includes('12025')) riIdx = idx;
                        else if (hl.includes('dri') && riIdx < 0) riIdx = idx;
                        if (hl.includes('uv') || hl.includes('abs') || hl.includes('280')) uvIdx = idx;
                    });

                    // 更新欄位下拉選單
                    const selects = ['dndcTimeCol', 'dndcUvCol', 'dndcRiCol'];
                    const detectedIndices = [0, uvIdx, riIdx];

                    selects.forEach((selId, i) => {
                        const sel = document.getElementById(selId);
                        sel.innerHTML = '<option value="-1">-- 無 --</option>';
                        headers.forEach((h, idx) => {
                            const opt = document.createElement('option');
                            opt.value = idx;
                            opt.textContent = h;
                            if (idx === detectedIndices[i]) opt.selected = true;
                            sel.appendChild(opt);
                        });
                    });

                    DndcState.loadedData = { parsed, headers };
                    // 預設用偵測到的欄位
                    DndcState.loadedData.time = time;
                    DndcState.loadedData.ri = riIdx >= 0 ? data.map(r => r[riIdx]) : riCh.values;
                    DndcState.loadedData.uv = uvIdx >= 0 ? data.map(r => r[uvIdx]) : new Array(time.length).fill(0);

                    const sampleName = astraResult.sample ? astraResult.sample.name : '';

                    // 自動填入濃度（ASTRA 內的 g/mL → mg/mL）
                    const concGml = astraResult.sample ? astraResult.sample.concentrationGml : 0;
                    if (concGml > 0) {
                        const concMgml = concGml * 1000;
                        document.getElementById('dndcManualC').value = concMgml.toFixed(3);
                    }

                    document.getElementById('dndcFileStatus').textContent =
                        `已載入: ${file.name} (${sampleName}, ${time.length} 點, ${channelKeys.length} 通道)`;

                    // 自動繪製所有通道
                    displayAllChannelsChart(parsed);

                } else {
                    // CSV/TSV 檔案
                    const text = await DndcFileParser.readFile(file);
                    const parsed = DndcFileParser.parseCSV(text);

                    if (parsed.data.length === 0) {
                        document.getElementById('dndcFileStatus').textContent = '檔案解析失敗：無有效數據';
                        return;
                    }

                    const detected = DndcFileParser.autoDetectColumns(parsed.headers);

                    const selects = ['dndcTimeCol', 'dndcUvCol', 'dndcRiCol'];
                    const detectedIndices = [detected.timeCol, detected.uvCol, detected.riCol];

                    selects.forEach((selId, i) => {
                        const sel = document.getElementById(selId);
                        sel.innerHTML = '';
                        parsed.headers.forEach((h, idx) => {
                            const opt = document.createElement('option');
                            opt.value = idx;
                            opt.textContent = h;
                            if (idx === detectedIndices[i]) opt.selected = true;
                            sel.appendChild(opt);
                        });
                    });

                    DndcState.loadedData = { parsed, headers: parsed.headers };

                    document.getElementById('dndcFileStatus').textContent =
                        `已載入: ${file.name} (${parsed.data.length} 列, ${parsed.headers.length} 欄)`;

                    // 自動繪製所有通道
                    displayAllChannelsChart(parsed);
                }

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

            if (timeIdx < 0 || riIdx < 0) {
                showDndcAlert('hplcDndcResults', 'error', '請選擇 Time 和 RI 欄位');
                return;
            }

            const time = parsed.data.map(r => r[timeIdx]);
            const uv = uvIdx >= 0 ? parsed.data.map(r => r[uvIdx]) : new Array(parsed.data.length).fill(0);
            const ri = parsed.data.map(r => r[riIdx]);

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
                manualC: parseFloat(document.getElementById('dndcManualC').value) || null,
                autoAlign: document.getElementById('dndcAutoAlign').checked,
                decimalPlaces: 4
            };

            // 檢查：無 UV 數據時必須有手動濃度
            const uvAllZero = uv.every(v => v === 0);
            if (uvAllZero && !params.manualC) {
                showDndcAlert('hplcDndcResults', 'error', '此檔案無 UV 通道，請在「手動濃度」欄位輸入樣品濃度 (mg/mL)');
                return;
            }

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
                <div class="stat-value" style="font-size: 1.75rem;">${formatDndc(result.dndc)} <span class="stat-unit">mL/g</span></div>
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
                <div class="result-value">${result.deltaRi != null ? result.deltaRi.toFixed(6) : '-'}</div>
            </div>
            <div class="result-item">
                <div class="result-label">RI peak area</div>
                <div class="result-value">${result.riPeakArea != null ? result.riPeakArea.toFixed(6) : '-'}</div>
            </div>
            ${alignInfo}
        </div>
    `;
}

// ========================
// 全通道預覽圖
// ========================
function displayAllChannelsChart(parsed) {
    const card = document.getElementById('dndcChromatogramCard');
    card.classList.remove('hidden');

    const togglesDiv = document.getElementById('dndcChannelToggles');
    const headers = parsed.headers;
    const data = parsed.data;

    // Time 固定為 col 0
    const time = data.map(r => r[0]);

    const colors = [
        'rgba(45, 49, 146, 0.85)',
        'rgba(26, 122, 76, 0.85)',
        'rgba(180, 83, 9, 0.85)',
        'rgba(196, 43, 28, 0.85)',
        'rgba(107, 33, 168, 0.85)',
        'rgba(190, 24, 93, 0.85)',
        'rgba(14, 116, 144, 0.85)',
        'rgba(101, 163, 13, 0.85)',
        'rgba(217, 70, 239, 0.85)',
        'rgba(234, 88, 12, 0.85)'
    ];

    // 建立 checkbox toggles（跳過 Time 欄）
    const channelIndices = [];
    for (let i = 1; i < headers.length; i++) {
        channelIndices.push(i);
    }

    // 預設顯示前 3 個通道
    const defaultVisible = new Set(channelIndices.slice(0, 3));

    togglesDiv.innerHTML = channelIndices.map((colIdx, i) => {
        const color = colors[i % colors.length];
        const checked = defaultVisible.has(colIdx) ? 'checked' : '';
        return `<label style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid ${color}; background: ${checked ? color.replace('0.85', '0.1') : 'transparent'};">
            <input type="checkbox" class="dndc-channel-toggle" data-col="${colIdx}" ${checked} style="margin: 0;">
            <span style="color: ${color}; font-weight: 500;">${headers[colIdx]}</span>
        </label>`;
    }).join('');

    // 儲存供重繪用
    DndcState.channelChartData = { time, headers, data, colors, channelIndices };

    // 繪製
    redrawChannelsChart();

    // 綁定 checkbox 事件
    togglesDiv.querySelectorAll('.dndc-channel-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            // 更新 label 背景
            const label = cb.closest('label');
            const colIdx = parseInt(cb.dataset.col);
            const i = channelIndices.indexOf(colIdx);
            const color = colors[i % colors.length];
            label.style.background = cb.checked ? color.replace('0.85', '0.1') : 'transparent';
            redrawChannelsChart();
        });
    });
}

function redrawChannelsChart() {
    const { time, headers, data, colors, channelIndices } = DndcState.channelChartData;

    if (DndcState.charts.chromatogram) {
        DndcState.charts.chromatogram.destroy();
    }

    const canvas = document.getElementById('dndcChromatogramChart');
    if (!canvas) return;

    // 收集勾選的通道
    const datasets = [];
    const toggles = document.querySelectorAll('.dndc-channel-toggle');

    toggles.forEach((cb) => {
        if (!cb.checked) return;
        const colIdx = parseInt(cb.dataset.col);
        const i = channelIndices.indexOf(colIdx);
        const color = colors[i % colors.length];
        const values = data.map(r => r[colIdx]);

        datasets.push({
            label: headers[colIdx],
            data: time.map((t, j) => ({ x: t, y: values[j] })),
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            showLine: true,
            yAxisID: `y${datasets.length}`
        });
    });

    // 每個通道獨立 y 軸（因為量級可能差很多）
    const scales = {
        x: {
            type: 'linear',
            title: { display: true, text: 'Time (min)', color: 'rgba(26,26,46,0.7)', font: { family: "'Times New Roman', serif", size: 12, style: 'italic' } },
            ticks: { color: 'rgba(26,26,46,0.7)', font: { size: 10 } },
            grid: { color: 'rgba(26,26,46,0.08)' }
        }
    };

    datasets.forEach((ds, i) => {
        scales[`y${i}`] = {
            type: 'linear',
            position: i === 0 ? 'left' : 'right',
            title: { display: i < 2, text: ds.label, color: ds.borderColor, font: { family: "'Times New Roman', serif", size: 11 } },
            ticks: { color: ds.borderColor, font: { size: 9 } },
            grid: { display: i === 0, color: 'rgba(26,26,46,0.06)' }
        };
    });

    DndcState.charts.chromatogram = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: {
                    labels: { color: 'rgba(26,26,46,0.7)', font: { family: "'Times New Roman', serif", size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(26,26,46,0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.85)',
                    cornerRadius: 4, padding: 8
                }
            },
            scales
        }
    });
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
    const fit = result.fitResult;
    const rSquared = fit ? fit.rSquared : 0;

    const r2Quality = rSquared >= 0.999 ? '優良' :
        rSquared >= 0.99 ? '良好' :
        rSquared >= 0.95 ? '可接受' : '偏低';
    const r2Class = rSquared >= 0.99 ? 'alert-success' :
        rSquared >= 0.95 ? 'alert-warning' : 'alert-error';

    resultsDiv.innerHTML = `
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
                <div class="result-value">${fit ? fit.intercept.toExponential(4) : '-'}</div>
            </div>
            <div class="result-item">
                <div class="result-label">標準誤差</div>
                <div class="result-value">${fit ? fit.stdError.toExponential(4) : '-'}</div>
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
}

// ========================
// ASTRA .afe7 解析
// ========================
function initAstraSection() {
    const parseBtn = document.getElementById('parseAstraFiles');
    const fileInput = document.getElementById('astraFileInput');

    if (!parseBtn || !fileInput) return;

    // Step 1: 載入檔案並顯示色譜圖
    parseBtn.addEventListener('click', async () => {
        const files = fileInput.files;
        if (!files || files.length === 0) {
            document.getElementById('astraParseStatus').textContent = '請先選擇 .afe7 檔案';
            return;
        }

        const statusEl = document.getElementById('astraParseStatus');
        statusEl.textContent = '正在載入 sql.js 和解析檔案...';
        document.getElementById('astraParseResults').innerHTML = '';

        const parsedFiles = [];

        try {
            for (let i = 0; i < files.length; i++) {
                statusEl.textContent = `解析中... (${i + 1}/${files.length}) ${files[i].name}`;
                const result = await DndcAstraParser.parseAfe7File(files[i]);
                parsedFiles.push({ fileName: files[i].name, ...result });
            }

            // 儲存解析結果
            DndcState.astraParsedFiles = parsedFiles;

            statusEl.textContent = `成功解析 ${parsedFiles.length} 個檔案，請在下方調整積分範圍`;

            // 顯示色譜圖和積分範圍控制
            const chartCard = document.getElementById('astraChromatogramCard');
            chartCard.classList.remove('hidden');

            const intStart = parseFloat(document.getElementById('astraIntStart').value) || 5;
            const intEnd = parseFloat(document.getElementById('astraIntEnd').value) || 12;
            displayAstraChromatogramsWithRange(parsedFiles, intStart, intEnd);

        } catch (err) {
            statusEl.textContent = `解析失敗: ${err.message}`;
        }
    });

    // Step 2: 套用積分範圍並計算
    const applyBtn = document.getElementById('applyAstraIntegration');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            if (!DndcState.astraParsedFiles || DndcState.astraParsedFiles.length === 0) {
                return;
            }
            const intStart = parseFloat(document.getElementById('astraIntStart').value) || 5;
            const intEnd = parseFloat(document.getElementById('astraIntEnd').value) || 12;

            // 更新色譜圖上的積分範圍標示
            displayAstraChromatogramsWithRange(DndcState.astraParsedFiles, intStart, intEnd);

            // 計算並顯示結果表格
            displayAstraResults(DndcState.astraParsedFiles, intStart, intEnd);
        });
    }

    // 即時更新圖上的積分範圍標示
    const intStartInput = document.getElementById('astraIntStart');
    const intEndInput = document.getElementById('astraIntEnd');
    if (intStartInput && intEndInput) {
        const updateRange = () => {
            if (!DndcState.astraParsedFiles) return;
            const intStart = parseFloat(intStartInput.value) || 5;
            const intEnd = parseFloat(intEndInput.value) || 12;
            displayAstraChromatogramsWithRange(DndcState.astraParsedFiles, intStart, intEnd);
        };
        intStartInput.addEventListener('change', updateRange);
        intEndInput.addEventListener('change', updateRange);
    }
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

        // K_cal（僅顯示用，RI_Aux 已是 RIU 單位不需乘）
        const kCal = pf.riDetector && pf.riDetector.calibrationConstant
            ? pf.riDetector.calibrationConstant : null;

        // 流速
        const flowRate = pf.experiment ? pf.experiment.flowRateMlMin : 0.5;

        // RI 面積 (RIU·mL) = ∫ΔRI dt × flow_rate
        const riAreaVolume = Math.abs(area) * flowRate;

        // 注入質量（從 ASTRA 取）— 如果沒有則讓使用者輸入
        const concGml = pf.sample ? pf.sample.concentrationGml : 0;

        // 從檔名提取注射體積（例如 _10uL_, _100ul_, _50μL_）
        const volMatch = pf.fileName.match(/[\s_](\d+(?:\.\d+)?)\s*[uμ][Ll]/i);
        const extractedVolUl = volMatch ? parseFloat(volMatch[1]) : 0;
        const extractedVolMl = extractedVolUl / 1000;

        injections.push({
            fileName: pf.fileName,
            sampleName: pf.sample ? pf.sample.name : 'Unknown',
            concentration: concGml,
            riArea: area,
            riAreaVolume,
            kCal,
            flowRate,
            injectionVolumeMl: extractedVolMl,
            time: pf.riChannel.time,
            values: pf.riChannel.values
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
                        <th><input type="checkbox" id="astraSelectAll" checked></th>
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
                <td><input type="checkbox" class="astra-row-check" data-astra-idx="${i}" checked></td>
                <td style="font-size: 0.75rem;">${inj.fileName}</td>
                <td>${inj.sampleName}</td>
                <td><input type="number" class="form-input" value="${inj.concentration}" step="0.0001" data-astra-idx="${i}" data-field="conc"></td>
                <td><input type="number" class="form-input" value="${inj.injectionVolumeMl || ''}" step="0.001" data-astra-idx="${i}" data-field="vol" placeholder="mL"></td>
                <td style="font-family: var(--font-mono); white-space: nowrap;">${inj.riAreaVolume.toExponential(2)}</td>
                <td style="font-family: var(--font-mono); white-space: nowrap;">${inj.kCal ? inj.kCal.toExponential(2) : '-'}</td>
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

    // 全選/取消全選
    document.getElementById('astraSelectAll').addEventListener('change', (e) => {
        document.querySelectorAll('.astra-row-check').forEach(cb => {
            cb.checked = e.target.checked;
        });
    });

    // 綁定擬合按鈕
    document.getElementById('fitAstraData').addEventListener('click', () => {
        const table = document.getElementById('astraInjectionTable');
        const rows = table.querySelectorAll('tbody tr');
        const masses = [];
        const areas = [];

        rows.forEach((row, i) => {
            const checkbox = row.querySelector('.astra-row-check');
            if (!checkbox || !checkbox.checked) return;

            const concInput = row.querySelector('[data-field="conc"]');
            const volInput = row.querySelector('[data-field="vol"]');
            const conc = parseFloat(concInput.value);
            const vol = parseFloat(volInput.value);

            if (!isNaN(conc) && !isNaN(vol) && conc > 0 && vol > 0) {
                masses.push(conc * vol);
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
// ASTRA 色譜圖疊加（含積分範圍標示）
// ========================
function displayAstraChromatogramsWithRange(parsedFiles, intStart, intEnd) {
    if (DndcState.charts.astraChromatogram) {
        DndcState.charts.astraChromatogram.destroy();
    }

    const canvas = document.getElementById('astraChromatogramCanvas');
    if (!canvas) return;

    const colors = [
        'rgba(45, 49, 146, 0.8)',
        'rgba(26, 122, 76, 0.8)',
        'rgba(180, 83, 9, 0.8)',
        'rgba(196, 43, 28, 0.8)',
        'rgba(107, 33, 168, 0.8)',
        'rgba(190, 24, 93, 0.8)',
        'rgba(14, 116, 144, 0.8)',
        'rgba(101, 163, 13, 0.8)'
    ];

    const datasets = [];
    for (let i = 0; i < parsedFiles.length; i++) {
        const pf = parsedFiles[i];
        if (!pf.riChannel) continue;

        const volMatch = pf.fileName.match(/[\s_](\d+(?:\.\d+)?)\s*[uμ][Ll]/i);
        const label = volMatch ? `${volMatch[1]} μL` : pf.fileName.split('.')[0].slice(0, 20);

        datasets.push({
            label,
            data: pf.riChannel.time.map((t, j) => ({ x: t, y: pf.riChannel.values[j] })),
            borderColor: colors[i % colors.length],
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            showLine: true
        });
    }

    // 積分範圍標示（用半透明填充 dataset 模擬）
    // 找 y 軸範圍
    let yMin = Infinity, yMax = -Infinity;
    for (const pf of parsedFiles) {
        if (!pf.riChannel) continue;
        for (const v of pf.riChannel.values) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
        }
    }
    const yPad = (yMax - yMin) * 0.05;

    // 加一個填充區域表示積分範圍
    datasets.push({
        label: `積分範圍 (${intStart.toFixed(1)} – ${intEnd.toFixed(1)} min)`,
        data: [
            { x: intStart, y: yMin - yPad },
            { x: intStart, y: yMax + yPad },
            { x: intEnd, y: yMax + yPad },
            { x: intEnd, y: yMin - yPad }
        ],
        backgroundColor: 'rgba(45, 49, 146, 0.08)',
        borderColor: 'rgba(45, 49, 146, 0.3)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
        fill: true
    });

    DndcState.charts.astraChromatogram = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: 'rgba(26, 26, 46, 0.7)',
                        font: { family: "'Times New Roman', serif", size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 26, 46, 0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255, 255, 255, 0.85)',
                    cornerRadius: 4,
                    padding: 8
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (min)',
                        color: 'rgba(26, 26, 46, 0.7)',
                        font: { family: "'Times New Roman', serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: 'rgba(26, 26, 46, 0.7)', font: { size: 10 } },
                    grid: { color: 'rgba(26, 26, 46, 0.08)' }
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'dRI (RIU)',
                        color: 'rgba(26, 26, 46, 0.7)',
                        font: { family: "'Times New Roman', serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: 'rgba(26, 26, 46, 0.7)', font: { size: 10 } },
                    grid: { color: 'rgba(26, 26, 46, 0.08)' }
                }
            }
        }
    });
}

// ========================
// 工具函數
// ========================
function formatDndc(value) {
    if (Math.abs(value) >= 0.001) return value.toFixed(4);
    return value.toExponential(4);
}

function escapeHtmlDndc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showDndcAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `<div class="alert alert-${type}">${escapeHtmlDndc(message)}</div>`;
    }
}

// 在 DOMContentLoaded 時初始化
document.addEventListener('DOMContentLoaded', initDndcSections);
