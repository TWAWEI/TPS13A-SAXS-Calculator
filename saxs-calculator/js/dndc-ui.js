/**
 * TPS13A SAXS Calculator - dn/dc UI Module
 * UI 事件綁定、結果顯示
 */

// 全域狀態：儲存已載入的色譜數據供多個頁面共用
const DndcState = {
    loadedData: null,   // { parsed, headers, time, uv, ri, columns }
    charts: {},
    lastHplcResult: null,
    lastHplcParams: null,
    lastSliceResult: null,
    // { result, xData, yData, source: 'manual' | 'astra' } — 供 CSV 匯出使用，
    // 不再從 DOM 表格刮資料
    lastMultiResult: null
};

// 欄位下拉的「未選擇」哨兵值。沒有這個選項時瀏覽器會自動選中第一個 option
// （通常是 Time 欄），偵測失敗就會拿時間當 RI 訊號算出看似合理的 dn/dc。
const NO_COLUMN = '-1';

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
                    波長校正 (Cauchy): d<i>n</i>/d<i>c</i>(λ₂) = d<i>n</i>/d<i>c</i>(λ₁) × (<i>A</i> + <i>B</i>/λ₂²) / (<i>A</i> + <i>B</i>/λ₁²)，
                    蛋白質預設 <i>A</i> = 0.1756 mL/g、<i>B</i> = 5.0×10³ nm²·mL/g
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

/**
 * 重建欄位下拉，第一個永遠是「-- 無 --」哨兵。
 *
 * 沒有哨兵時，自動偵測失敗（-1）會讓瀏覽器預設選中第一個 option（Time 欄），
 * 於是程式把時間值當成 RI／UV 訊號算出一個外觀正常但科學上錯誤的 dn/dc。
 *
 * @param {string} selectId - select 元素 id
 * @param {string[]} headers - 欄位標頭
 * @param {number} detectedIndex - 自動偵測到的索引（失敗為 -1）
 * @returns {void}
 */
function populateColumnSelect(selectId, headers, detectedIndex) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    sel.innerHTML = `<option value="${NO_COLUMN}">-- 無 --</option>`;
    headers.forEach((h, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = h;
        sel.appendChild(opt);
    });
    sel.value = Number.isInteger(detectedIndex) && detectedIndex >= 0
        ? String(detectedIndex) : NO_COLUMN;
}

/**
 * 載入完成後回報欄位偵測與資料品質問題。
 *
 * @param {{ok: boolean, message: string}} sync - syncSelectedColumns 的結果
 * @param {{headers: string[], stats: object}} parsed - parseCSV 的結果
 * @returns {void}
 */
function reportLoadIssues(sync, parsed) {
    const messages = [];
    if (!sync.ok) {
        messages.push(sync.message);
    }

    const stats = parsed && parsed.stats;
    if (stats && Array.isArray(stats.nonNumeric)) {
        stats.nonNumeric.forEach((count, idx) => {
            if (!count) return;
            const name = (parsed.headers && parsed.headers[idx]) || `第 ${idx + 1} 欄`;
            messages.push(`欄位「${name}」有 ${count} 個非數值／空白格（共 ${stats.rowCount} 列）`);
        });
    }

    if (messages.length === 0) return;
    showDndcAlerts('hplcDndcResults', sync.ok ? 'warning' : 'error', messages);
}

/**
 * 讀取欄位下拉的索引。未選擇（哨兵 -1）、空選單或無法解析都回 -1。
 *
 * @param {string} selectId - select 元素 id
 * @returns {number} 欄位索引，未選擇時為 -1
 */
function readColumnIndex(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return -1;
    const idx = parseInt(el.value, 10);
    return Number.isInteger(idx) && idx >= 0 ? idx : -1;
}

/**
 * 依三個欄位下拉的目前選擇，把 time / uv / ri 陣列寫回 DndcState.loadedData。
 *
 * 載入完成時、下拉變更時、以及每個計算入口都會呼叫，讓「自動偵測峰值」與
 * 「Slice 分析」不再因為欄位還沒同步而誤報「請先載入數據檔案」。
 *
 * @returns {{ok: boolean, message: string, timeIdx: number, uvIdx: number, riIdx: number}}
 */
function syncSelectedColumns() {
    const data = DndcState.loadedData;
    const timeIdx = readColumnIndex('dndcTimeCol');
    const uvIdx = readColumnIndex('dndcUvCol');
    const riIdx = readColumnIndex('dndcRiCol');
    const fail = (message) => ({ ok: false, message, timeIdx, uvIdx, riIdx });

    if (!data || !data.parsed || !Array.isArray(data.parsed.data) || data.parsed.data.length === 0) {
        return fail('請先載入數據檔案（CSV/TSV 或 ASTRA .afe7）');
    }
    if (timeIdx < 0 || riIdx < 0) {
        return fail('尚未選擇 Time / RI 欄位——自動偵測失敗時請在「欄位對應」手動指定');
    }
    if (timeIdx === riIdx) {
        return fail('同一欄被同時選為「時間軸」與「RI」，請重新指定欄位');
    }
    if (uvIdx >= 0 && uvIdx === riIdx) {
        return fail('同一欄被同時選為「UV」與「RI」，請重新指定欄位');
    }

    const rows = data.parsed.data;
    DndcState.loadedData = {
        ...data,
        time: rows.map(r => r[timeIdx]),
        uv: uvIdx >= 0 ? rows.map(r => r[uvIdx]) : new Array(rows.length).fill(0),
        ri: rows.map(r => r[riIdx]),
        columns: { timeIdx, uvIdx, riIdx }
    };

    return { ok: true, message: '', timeIdx, uvIdx, riIdx };
}

/**
 * 檢查目前選定欄位是否含非數值／空白格，回傳可顯示的警告字串。
 *
 * @returns {string[]} 警告訊息（沒有問題時為空陣列）
 */
function selectedColumnWarnings() {
    const data = DndcState.loadedData;
    if (!data || !data.columns) return [];

    const headers = (data.parsed && data.parsed.headers) || [];
    const time = Array.isArray(data.time) ? data.time : [];
    const channels = [
        { role: 'Time', idx: data.columns.timeIdx, values: data.time },
        { role: 'UV', idx: data.columns.uvIdx, values: data.uv },
        { role: 'RI', idx: data.columns.riIdx, values: data.ri }
    ];

    const warnings = [];
    for (const ch of channels) {
        if (ch.idx < 0 || !Array.isArray(ch.values)) continue;

        let count = 0;
        let tMin = Infinity;
        let tMax = -Infinity;
        for (let i = 0; i < ch.values.length; i++) {
            if (Number.isFinite(ch.values[i])) continue;
            count++;
            const t = time[i];
            if (Number.isFinite(t)) {
                if (t < tMin) tMin = t;
                if (t > tMax) tMax = t;
            }
        }
        if (count === 0) continue;

        const name = headers[ch.idx] || `第 ${ch.idx + 1} 欄`;
        const range = Number.isFinite(tMin) && Number.isFinite(tMax)
            ? `（t = ${tMin.toFixed(2)}–${tMax.toFixed(2)} min）` : '';
        warnings.push(
            `${ch.role} 欄「${name}」有 ${count} 個非數值／空白格${range}；` +
            '若落在基線或峰範圍內，計算會直接中止'
        );
    }
    return warnings;
}

/**
 * 讀取並驗證 HPLC / Slice 共用的計算參數。
 *
 * 空欄位在 type=number 會讀成 ''，parseFloat 得到 NaN，而 NaN <= 0 與
 * NaN >= NaN 都是 false——舊的檢查因此全部穿過，最後顯示 "NaN" 或靜默的 0。
 * 這裡改用 FormUtils 的守門函式，一律 throw 帶欄位名稱的錯誤。
 *
 * @param {object} [options]
 * @param {boolean} [options.withManualC=true] - 是否讀取「手動濃度」欄位
 * @returns {object} 凍結的參數物件（傳給 DndcCalculations）
 * @throws {Error} 任一欄位無效時
 */
function readHplcParams({ withManualC = true } = {}) {
    const manualC = withManualC
        ? parseManualConcentration(document.getElementById('dndcManualC').value)
        : null;

    const params = Object.freeze({
        peakStart: FormUtils.readFiniteField('dndcPeakStart', 'Peak start'),
        peakEnd: FormUtils.readFiniteField('dndcPeakEnd', 'Peak end'),
        bl1Start: FormUtils.readFiniteField('dndcBl1Start', 'Baseline 1 start'),
        bl1End: FormUtils.readFiniteField('dndcBl1End', 'Baseline 1 end'),
        bl2Start: FormUtils.readFiniteField('dndcBl2Start', 'Baseline 2 start'),
        bl2End: FormUtils.readFiniteField('dndcBl2End', 'Baseline 2 end'),
        epsilon: FormUtils.readPositiveField('dndcEpsilon', '消光係數 ε'),
        pathLen: FormUtils.readPositiveField('dndcPathLen', '光徑長度'),
        riFactor: FormUtils.readPositiveField('dndcRiFactor', 'RI 校正因子 (K_RI)'),
        riDelay: FormUtils.readFiniteField('dndcRiDelay', 'RI 延遲時間（無延遲請填 0）'),
        baselineMode: document.getElementById('dndcBaselineMode').value,
        peakMode: document.getElementById('dndcPeakMode').value || 'area',
        // 空白 → null（自動從 UV 計算）；有填就照實傳，讓 <= 0 的值能被驗證接到
        manualC,
        autoAlign: document.getElementById('dndcAutoAlign').checked,
        decimalPlaces: 4
    });

    if (params.peakStart >= params.peakEnd) {
        throw new Error('Peak start 必須小於 Peak end');
    }
    if (params.bl1Start >= params.bl1End) {
        throw new Error('Baseline 1 start 必須小於 Baseline 1 end');
    }
    if (params.bl2Start >= params.bl2End) {
        throw new Error('Baseline 2 start 必須小於 Baseline 2 end');
    }
    if (params.manualC !== null && !(params.manualC > 0)) {
        throw new Error('手動濃度必須大於 0 mg/mL（留空則自動從 UV 計算）');
    }
    return params;
}

/**
 * 統一的錯誤顯示：領域錯誤直接顯示訊息，非預期錯誤（TypeError 等）不把
 * 實作細節丟給使用者，改記進 console。
 *
 * @param {string} containerId - 顯示容器 id
 * @param {Error} err - 捕捉到的錯誤
 * @param {string} prefix - 顯示前綴，例如「計算錯誤」
 */
function reportDndcError(containerId, err, prefix) {
    const isDomainError = err instanceof Error && !(err instanceof TypeError) &&
        !(err instanceof RangeError) && !(err instanceof ReferenceError);
    if (isDomainError) {
        showDndcAlert(containerId, 'error', `${prefix}: ${err.message}`);
        return;
    }
    console.error(`[dn/dc] ${prefix}`, err);
    showDndcAlert(containerId, 'error',
        `${prefix}: 發生非預期的內部錯誤，請檢查輸入資料，並在瀏覽器主控台查看詳細訊息`);
}

/**
 * 載入新檔案時清掉上一個檔案的計算結果與匯出入口。
 *
 * 否則使用者換檔後直接按「📥 CSV」會匯出上一個檔案的 dn/dc，
 * 檔名與內容都看不出來源已經不同。
 *
 * @returns {void}
 */
function resetLoadedResults() {
    DndcState.lastHplcResult = null;
    DndcState.lastHplcParams = null;
    DndcState.lastSliceResult = null;
    DndcState.lastMultiResult = null;
    ['hplcExportBtns', 'sliceExportBtns', 'multiExportBtns'].forEach(id => hideElement(id));
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

            // CSV 與 .afe7 兩條分支共用：先把上一個檔案的結果與匯出鈕收乾淨
            resetLoadedResults();

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
                        populateColumnSelect(selId, headers, detectedIndices[i]);
                    });

                    // 預設用偵測到的欄位（RI 欄偵測失敗時退回 RI 通道原始值）
                    DndcState.loadedData = {
                        parsed,
                        headers,
                        time,
                        ri: riIdx >= 0 ? data.map(r => r[riIdx]) : riCh.values,
                        uv: uvIdx >= 0 ? data.map(r => r[uvIdx]) : new Array(time.length).fill(0),
                        columns: { timeIdx: 0, uvIdx, riIdx }
                    };
                    // 下拉若已選到有效欄位就以下拉為準（與 CSV 分支同一條路徑）
                    syncSelectedColumns();

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
                        populateColumnSelect(selId, parsed.headers, detectedIndices[i]);
                    });

                    DndcState.loadedData = { parsed, headers: parsed.headers };
                    // 與 .afe7 分支一致：載入當下就把 time/uv/ri 準備好，
                    // 「自動偵測峰值」與 Slice 分析不必先算過一次才能用
                    const sync = syncSelectedColumns();

                    document.getElementById('dndcFileStatus').textContent =
                        `已載入: ${file.name} (${parsed.data.length} 列, ${parsed.headers.length} 欄)`;

                    reportLoadIssues(sync, parsed);

                    // 自動繪製所有通道
                    displayAllChannelsChart(parsed);
                }

            } catch (err) {
                document.getElementById('dndcFileStatus').textContent = `載入失敗: ${err.message}`;
            }
        });
    }

    // 欄位下拉變更時同步 time/uv/ri，讓其他頁面立即拿到正確的欄位
    ['dndcTimeCol', 'dndcUvCol', 'dndcRiCol'].forEach(selId => {
        const sel = document.getElementById(selId);
        if (sel) sel.addEventListener('change', () => { syncSelectedColumns(); });
    });

    // Auto-detect peak button
    const autoDetectBtn = document.getElementById('autoDetectPeak');
    if (autoDetectBtn) {
        autoDetectBtn.addEventListener('click', () => {
            const sync = syncSelectedColumns();
            if (!sync.ok) {
                showDndcAlert('hplcDndcResults', 'error', sync.message);
                return;
            }

            const time = DndcState.loadedData.time;
            const ri = DndcState.loadedData.ri;
            if (!ri.some(Number.isFinite)) {
                showDndcAlert('hplcDndcResults', 'error',
                    '選定的 RI 欄沒有任何數值，請改選其他欄位或檢查檔案格式');
                return;
            }

            // Find peak: locate max RI signal
            let maxVal = -Infinity;
            let maxIdx = 0;
            for (let i = 0; i < ri.length; i++) {
                if (Math.abs(ri[i]) > maxVal) {
                    maxVal = Math.abs(ri[i]);
                    maxIdx = i;
                }
            }

            // Find peak boundaries: walk left/right from max until signal drops below 5% of max
            const threshold = maxVal * 0.05;
            let leftIdx = maxIdx;
            while (leftIdx > 0 && Math.abs(ri[leftIdx]) > threshold) leftIdx--;
            let rightIdx = maxIdx;
            while (rightIdx < ri.length - 1 && Math.abs(ri[rightIdx]) > threshold) rightIdx++;

            const peakStart = time[leftIdx];
            const peakEnd = time[rightIdx];

            // Auto baseline windows
            const [bl1Start, bl1End, bl2Start, bl2End] =
                DndcCalculations.autoBaselineWindows(time, peakStart, peakEnd);

            // Fill in the form fields
            document.getElementById('dndcPeakStart').value = peakStart.toFixed(2);
            document.getElementById('dndcPeakEnd').value = peakEnd.toFixed(2);
            document.getElementById('dndcBl1Start').value = bl1Start.toFixed(2);
            document.getElementById('dndcBl1End').value = bl1End.toFixed(2);
            document.getElementById('dndcBl2Start').value = bl2Start.toFixed(2);
            document.getElementById('dndcBl2End').value = bl2End.toFixed(2);

            showDndcAlert('hplcDndcResults', 'success',
                `自動偵測完成: Peak ${peakStart.toFixed(1)}–${peakEnd.toFixed(1)} min`);
        });
    }

    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            const sync = syncSelectedColumns();
            if (!sync.ok) {
                showDndcAlert('hplcDndcResults', 'error', sync.message);
                return;
            }

            const { time, uv, ri } = DndcState.loadedData;

            let params;
            try {
                params = readHplcParams();
            } catch (err) {
                reportDndcError('hplcDndcResults', err, '輸入錯誤');
                return;
            }

            // 資料品質警告：與結果一起顯示，不再被 innerHTML 覆蓋
            const warnings = selectedColumnWarnings();
            if (params.bl1End > params.peakStart || params.bl2Start < params.peakEnd) {
                warnings.push('Baseline window 與 peak 區域重疊，基線可能被峰訊號拉高，結果準確性存疑');
            }

            // 檢查：無 UV 數據時必須有手動濃度
            const uvAllZero = uv.every(v => v === 0);
            if (uvAllZero && params.manualC === null) {
                showDndcAlert('hplcDndcResults', 'error',
                    '選定的 UV 欄全為 0（此檔案可能沒有 UV 通道），請在「手動濃度」欄位輸入樣品濃度 (mg/mL)，或改選正確的 UV 欄');
                return;
            }

            try {
                const result = DndcCalculations.computeHplcDndc(time, uv, ri, params);
                DndcState.lastHplcResult = result;
                DndcState.lastHplcParams = params;
                displayHplcDndcResults(result, params, warnings);
                displayChromatogram(time, uv, ri, params);
                const hplcExport = document.getElementById('hplcExportBtns');
                if (hplcExport) hplcExport.classList.remove('hidden');
            } catch (err) {
                reportDndcError('hplcDndcResults', err, '計算錯誤');
            }
        });
    }
}

/**
 * Translate a machine-readable alignment reason into a beamline-friendly
 * Chinese message.
 *
 * @param {string|null} reason - alignmentInfo.reason
 * @returns {string} Display text
 */
function alignmentReasonText(reason) {
    if (!reason) return '';
    if (reason.startsWith('reference signal is constant')) {
        return 'UV 參考訊號為常數（多半是此檔案沒有 UV 通道），無法估算 UV–RI 時間偏移';
    }
    if (reason.startsWith('manual concentration supplied')) {
        return '已輸入手動濃度，UV 訊號未參與計算，因此不進行自動對齊';
    }
    if (reason.startsWith('lag exceeds maxLag')) {
        return `估算出的時間偏移超出容許範圍（${reason}），已忽略不套用，請改用「RI 延遲」手動輸入`;
    }
    return reason;
}

/**
 * Build the alignment result-items plus an explicit warning banner when the
 * auto-alignment was skipped or clamped.
 *
 * @param {object|null} ai - result.alignmentInfo
 * @returns {{items: string, alert: string}} HTML fragments
 */
function renderAlignmentInfo(ai) {
    if (!ai) return { items: '', alert: '' };

    const inactive = ai.skipped || ai.clamped;
    const corr = ai.correlation != null ? ai.correlation : null;
    const badgeStyle = 'padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.75rem;';

    let corrBadge;
    if (inactive) {
        corrBadge = `<span class="alert-warning" style="${badgeStyle}">未套用</span>`;
    } else if (corr != null) {
        corrBadge = corr >= 0.95 ? `<span class="alert-success" style="${badgeStyle}">Good (${corr.toFixed(3)})</span>`
            : corr >= 0.85 ? `<span class="alert-warning" style="${badgeStyle}">Fair (${corr.toFixed(3)})</span>`
            : `<span class="alert-error" style="${badgeStyle}">Poor (${corr.toFixed(3)})</span>`;
    } else {
        corrBadge = '';
    }

    const items = `
            <div class="result-item">
                <div class="result-label">UV-RI 時間偏移</div>
                <div class="result-value">${ai.lag.toFixed(4)} <span style="font-size: 0.75rem;">pts</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">對齊品質</div>
                <div class="result-value">${corrBadge}</div>
            </div>`;

    const alert = inactive
        ? `<div class="alert alert-warning mt-md">${ai.skipped ? '已略過自動對齊' : '自動對齊結果已被忽略'}：${escapeHtmlDndc(alignmentReasonText(ai.reason))}</div>`
        : '';

    return { items, alert };
}

/**
 * 把警告陣列渲染成結果區最上方的警告條。
 *
 * @param {string[]} warnings - 警告訊息
 * @returns {string} HTML 片段（沒有警告時為空字串）
 */
function renderWarningsHtml(warnings) {
    if (!Array.isArray(warnings) || warnings.length === 0) return '';
    const items = warnings.map(w => `<div>⚠️ ${escapeHtmlDndc(w)}</div>`).join('');
    return `<div class="alert alert-warning" role="status" style="margin-bottom: 1rem;">${items}</div>`;
}

function displayHplcDndcResults(result, params, warnings = []) {
    const resultsDiv = document.getElementById('hplcDndcResults');
    const alignment = renderAlignmentInfo(result.alignmentInfo);
    const alignInfo = alignment.items;

    const isArea = params.peakMode === 'area';
    const riUnit = isArea ? 'RIU·min' : 'RIU';
    // area 模式的分母其實是 UV 峰的梯形積分，不是瞬時濃度
    const concLabel = isArea ? 'UV 積分' : '濃度';
    const concUnit = isArea ? 'mg·min/mL' : 'mg/mL';

    resultsDiv.innerHTML = `
        ${renderWarningsHtml(warnings)}
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i></div>
                <div class="stat-value" style="font-size: 1.75rem;">${formatDndc(result.dndc)} <span class="stat-unit">mL/g</span></div>
            </div>
        </div>
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">${concLabel}</div>
                <div class="result-value">${result.concentration != null ? result.concentration.toFixed(4) : '-'} <span style="font-size: 0.75rem;">${concUnit}</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">RI peak value</div>
                <div class="result-value">${result.riPeakValue != null ? result.riPeakValue.toExponential(4) : '-'} <span style="font-size: 0.75rem;">${riUnit}</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">RI (corrected)</div>
                <div class="result-value">${result.riValue != null ? result.riValue.toExponential(4) : '-'} <span style="font-size: 0.75rem;">RIU</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">Peak 模式</div>
                <div class="result-value">${result.peakMode}</div>
            </div>
            ${alignInfo}
        </div>
        ${alignment.alert}
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('hplcDndcResults');
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
        'rgba(240, 78, 78, 0.85)',
        'rgba(16, 185, 129, 0.85)',
        'rgba(236, 130, 130, 0.85)',
        'rgba(5, 150, 105, 0.85)',
        'rgba(234, 156, 156, 0.85)',
        'rgba(52, 211, 153, 0.85)',
        'rgba(232, 182, 182, 0.85)',
        'rgba(200, 50, 50, 0.85)',
        'rgba(236, 130, 130, 0.85)',
        'rgba(16, 185, 129, 0.85)'
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
            title: { display: true, text: 'Time (min)', color: 'rgba(13,33,55,0.65)', font: { family: "'Inter', sans-serif", size: 12, style: 'italic' } },
            ticks: { color: 'rgba(13,33,55,0.65)', font: { size: 10 } },
            grid: { color: 'rgba(26, 26, 46, 0.12)' }
        }
    };

    datasets.forEach((ds, i) => {
        scales[`y${i}`] = {
            type: 'linear',
            position: i === 0 ? 'left' : 'right',
            title: { display: i < 2, text: ds.label, color: ds.borderColor, font: { family: "'Inter', sans-serif", size: 11 } },
            ticks: { color: ds.borderColor, font: { size: 9 } },
            grid: { display: i === 0, color: 'rgba(26, 26, 46, 0.10)' }
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
                    labels: { color: 'rgba(13,33,55,0.65)', font: { family: "'Inter', sans-serif", size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,50,100,0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.85)',
                    cornerRadius: 4, padding: 8
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
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
        {
            peakStart: params.peakStart, peakEnd: params.peakEnd,
            bl1Start: params.bl1Start, bl1End: params.bl1End,
            bl2Start: params.bl2Start, bl2End: params.bl2End
        }
    );

    A11y.describeChart('dndcChromatogramChart',
        `UV 與 RI 色譜圖，共 ${time.length} 個時間點；` +
        `峰範圍 ${params.peakStart}–${params.peakEnd} 分鐘，` +
        `基線 1 ${params.bl1Start}–${params.bl1End} 分鐘，` +
        `基線 2 ${params.bl2Start}–${params.bl2End} 分鐘`);
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
                <td><input type="number" class="form-input" step="0.0001" aria-label="第 ${rowCount} 組 濃度 (g/mL)"></td>
                <td><input type="number" class="form-input" step="0.000001" aria-label="第 ${rowCount} 組 ΔRI (RIU)"></td>
                <td><button type="button" class="btn btn-sm btn-secondary" aria-label="刪除第 ${rowCount} 組資料" onclick="this.closest('tr').remove()">✕</button></td>
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

    const rSquared = fit.rSquared;

    const r2Quality = rSquared >= 0.999 ? '優良' :
        rSquared >= 0.99 ? '良好' :
        rSquared >= 0.95 ? '可接受' : '偏低';
    const r2Class = rSquared >= 0.99 ? 'alert-success' :
        rSquared >= 0.95 ? 'alert-warning' : 'alert-error';

    resultsDiv.innerHTML = `
        ${renderWarningsHtml(warnings)}
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
                <div class="result-value">${fit.intercept.toExponential(4)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">標準誤差</div>
                <div class="result-value">${fit.stdError.toExponential(4)}</div>
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

    A11y.describeChart('sliceDndcChart',
        `Slice-by-slice 線性擬合圖：濃度 (g/mL) 對 Δn (RIU)，${result.sliceCount} 個有效切片，` +
        `dn/dc ${formatDndc(fit.slope)} mL/g，R² ${rSquared.toFixed(4)}（擬合品質${r2Quality}）`);

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('sliceDndcResults');
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
        <div class="table-wrapper mt-md" tabindex="0" role="region" aria-label="ASTRA 注射解析結果表（可橫向捲動）">
            <table class="table" id="astraInjectionTable">
                <thead>
                    <tr>
                        <th><input type="checkbox" id="astraSelectAll" aria-label="全選／取消全選所有注射" checked></th>
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
                <td><input type="checkbox" class="astra-row-check" data-astra-idx="${i}" aria-label="納入 ${inj.sampleName} 的擬合" checked></td>
                <td style="font-size: 0.75rem;">${inj.fileName}</td>
                <td>${inj.sampleName}</td>
                <td><input type="number" class="form-input" value="${inj.concentration}" step="0.0001" data-astra-idx="${i}" data-field="conc" aria-label="${inj.sampleName} 濃度 (g/mL)"></td>
                <td><input type="number" class="form-input" value="${inj.injectionVolumeMl || ''}" step="0.001" data-astra-idx="${i}" data-field="vol" placeholder="mL" aria-label="${inj.sampleName} 注射體積 (mL)"></td>
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
            displayMultiFitResults(result, masses, areas, 'astra');
            const multiExport = document.getElementById('multiExportBtns');
            if (multiExport) multiExport.classList.remove('hidden');
        } catch (err) {
            hideElement('multiDndcChartContainer');
            hideElement('multiExportBtns');
            reportDndcError('multiDndcResults', err, '擬合錯誤');
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
        'rgba(240, 78, 78, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(236, 130, 130, 0.8)',
        'rgba(5, 150, 105, 0.8)',
        'rgba(234, 156, 156, 0.8)',
        'rgba(52, 211, 153, 0.8)',
        'rgba(232, 182, 182, 0.8)',
        'rgba(200, 50, 50, 0.8)'
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
        backgroundColor: 'rgba(240, 78, 78, 0.07)',
        borderColor: 'rgba(240, 78, 78, 0.3)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
        fill: true
    });

    A11y.describeChart('astraChromatogramCanvas',
        `ASTRA RI 色譜圖疊加，共 ${datasets.length - 1} 條注射曲線；` +
        `積分範圍 ${intStart.toFixed(1)}–${intEnd.toFixed(1)} 分鐘。` +
        '各注射的濃度、體積與 RI 面積見上方注射解析結果表');

    DndcState.charts.astraChromatogram = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: 'rgba(26, 26, 46, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(80, 20, 20, 0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255, 255, 255, 0.85)',
                    cornerRadius: 4,
                    padding: 8
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (min)',
                        color: 'rgba(26, 26, 46, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: 'rgba(26, 26, 46, 0.65)', font: { size: 10 } },
                    grid: { color: 'rgba(26, 26, 46, 0.12)' }
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'dRI (RIU)',
                        color: 'rgba(26, 26, 46, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: 'rgba(26, 26, 46, 0.65)', font: { size: 10 } },
                    grid: { color: 'rgba(26, 26, 46, 0.12)' }
                }
            }
        }
    });
}

// ========================
// 工具函數
// ========================
function formatDndc(value) {
    // NaN / Infinity 直接印出 "NaN" 會被當成有效結果抄進實驗紀錄
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 0.001) return value.toFixed(4);
    return value.toExponential(4);
}

/**
 * 隱藏元素（不存在時安靜略過）。
 *
 * @param {string} elementId - 元素 id
 * @returns {void}
 */
function hideElement(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.classList.add('hidden');
}

function escapeHtmlDndc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showDndcAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (container) {
        // live region 要標在持久存在的容器上，訊息節點本身標了不會被朗讀
        A11y.markLiveRegion(container, type);
        container.innerHTML =
            `<div class="alert alert-${type}">${escapeHtmlDndc(message)}</div>`;
    }
}

/**
 * 一次顯示多則訊息（例如載入後的欄位品質警告）。
 *
 * @param {string} containerId - 容器 id
 * @param {string} type - alert 型別（error / warning / info / success）
 * @param {string[]} messages - 訊息陣列
 * @returns {void}
 */
function showDndcAlerts(containerId, type, messages) {
    const container = document.getElementById(containerId);
    if (!container || !Array.isArray(messages) || messages.length === 0) return;
    A11y.markLiveRegion(container, type);
    const items = messages.map(m => `<div>${escapeHtmlDndc(m)}</div>`).join('');
    container.innerHTML = `<div class="alert alert-${type}">${items}</div>`;
}

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

// 在 DOMContentLoaded 時初始化
document.addEventListener('DOMContentLoaded', () => {
    initDndcSections();
    initExportButtons();
    initChartControls();
});
