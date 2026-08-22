/**
 * TPS13A SAXS Calculator - dn/dc HPLC UI
 * HPLC dn/dc 頁面：欄位選擇、參數讀取與事件綁定。
 */

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
