/**
 * TPS13A SAXS Calculator - dn/dc ASTRA UI
 * ASTRA .afe7 頁面：檔案解析、UV 現況摘要、積分範圍與色譜圖疊加。
 */

// ========================
// .afe7 的 UV 現況摘要（純文字組字，可在 Node 測）
// ========================

/**
 * 有設定 UV 儀器卻沒有 UV 時間序列時的說明。
 *
 * 使用者的 BSA 檔就是這種：ASTRA 專案裡掛了 Generic UV，但實際只錄了 RI。
 * 這不是壞檔，也不影響本頁的 ASTRA-style 擬合（只用 RI 面積 vs 注射質量），
 * 所以文案必須同時講「缺什麼」與「不影響什麼」，否則使用者會以為要重做實驗。
 */
const ASTRA_UV_MISSING_TEXT =
    '⚠️ 此檔未含 UV 數據（ASTRA 有設定 Generic UV 儀器，但沒有 UV 時間序列）'
    + '——ASTRA-style 擬合不需要 UV；若要走 UV+RI 請從 ChemStation 匯出 CSV';

/** 連 UV 儀器都沒設定：一句話講完就好。 */
const ASTRA_UV_ABSENT_TEXT = '此檔未設定 UV 儀器，無 UV 數據';

/**
 * ASTRA 單位的消光係數顯示格式：整數不補小數點，非整數留一位。
 *
 * @param {number} value - mL·g⁻¹·cm⁻¹
 * @returns {string} 顯示字串
 */
function formatAstraUvExtinction(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * 找出解析結果裡的 UV 通道（instrument 名稱含 UV）。
 *
 * @param {object} parsed - parseAfe7 的回傳值
 * @returns {object|null} 通道摘要，沒有時為 null
 */
function findAstraUvChannel(parsed) {
    const channels = (parsed && parsed.allChannels) || [];
    return channels.find(ch => /uv/i.test(String((ch && ch.instrument) || ''))) || null;
}

/**
 * 單一 .afe7 的 UV 現況摘要文字。
 *
 * 檔案內的消光係數是 ASTRA 單位（mL·g⁻¹cm⁻¹，BSA 存 667），而 HPLC dn/dc 頁
 * 要填的是 mL·mg⁻¹cm⁻¹（0.667）——差 1000 倍，所以一律兩個單位一起講。
 *
 * @param {object|null} parsed - parseAfe7 的回傳值
 * @returns {string[]} 摘要行；沒有解析結果時為空陣列
 */
function describeAstraUv(parsed) {
    if (!parsed) return [];

    const lines = [];
    const uvExtinction = Number((parsed.sample && parsed.sample.uvExtinction));
    if (Number.isFinite(uvExtinction) && uvExtinction > 0) {
        lines.push(
            `檔案內 UV 消光係數：${formatAstraUvExtinction(uvExtinction)} mL·g⁻¹·cm⁻¹`
            + `（= ${(uvExtinction / 1000).toFixed(3)} mL·mg⁻¹·cm⁻¹）`
        );
    }

    const uvChannel = findAstraUvChannel(parsed);
    if (uvChannel || parsed.hasUvChannel === true) {
        const label = (uvChannel && (uvChannel.label || uvChannel.instrument)) || '未命名通道';
        lines.push(`UV 通道：${label}`);
    } else if (parsed.uvConfigured) {
        lines.push(ASTRA_UV_MISSING_TEXT);
    } else {
        lines.push(ASTRA_UV_ABSENT_TEXT);
    }

    return lines;
}

/**
 * 多檔摘要：訊息相同的檔案合併成一組，避免同一句話重複 8 次。
 *
 * @param {Array<object>} parsedFiles - 每個元素是 parseAfe7 結果 + fileName
 * @returns {Array<{heading: string|null, fileNames: string[], lines: string[]}>}
 *          heading 為 null 代表不需要標題（單檔）
 */
function summarizeAstraUvFiles(parsedFiles) {
    const files = Array.isArray(parsedFiles) ? parsedFiles : [];
    if (files.length === 0) return [];

    const groups = [];
    const byKey = new Map();
    for (const pf of files) {
        const lines = describeAstraUv(pf);
        // 用 JSON 當分組鍵：訊息裡本來就有全形括號與破折號，隨手挑的分隔字元不夠安全
        const key = JSON.stringify(lines);
        const fileName = (pf && pf.fileName) || '（未命名檔案）';
        if (byKey.has(key)) {
            const existing = byKey.get(key);
            byKey.set(key, { ...existing, fileNames: [...existing.fileNames, fileName] });
        } else {
            byKey.set(key, { lines, fileNames: [fileName] });
            groups.push(key);
        }
    }

    const ordered = groups.map(key => byKey.get(key));
    const allSame = ordered.length === 1;
    return ordered.map(g => ({
        ...g,
        heading: allSame
            ? (files.length > 1 ? `（${files.length} 個檔案相同）` : null)
            : g.fileNames.join('、')
    }));
}

/**
 * 把 UV 摘要畫進 #astraFileSummary。沒有內容時整塊隱藏。
 *
 * 檔名與通道名稱都來自 .afe7／檔案系統，屬不受信任輸入，一律過 escapeHtmlDndc。
 *
 * @param {Array<object>} parsedFiles - 解析結果（含 fileName）
 * @returns {void}
 */
function renderAstraFileSummary(parsedFiles) {
    const el = document.getElementById('astraFileSummary');
    if (!el) return;

    const groups = summarizeAstraUvFiles(parsedFiles);
    if (groups.length === 0) {
        el.innerHTML = '';
        el.hidden = true;
        return;
    }

    // .alert 是 display:flex（橫排），多行要包一層區塊元素才會由上往下堆疊
    const blocks = groups.map(g => {
        const heading = g.heading
            ? `<div><strong>${escapeHtmlDndc(g.heading)}</strong></div>` : '';
        const lines = g.lines.map(line => `<div>${escapeHtmlDndc(line)}</div>`).join('');
        return `<div>${heading}${lines}</div>`;
    }).join('');

    el.innerHTML = `<div>${blocks}</div>`;
    el.hidden = false;
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
        renderAstraFileSummary([]);   // 收掉上一批檔案的摘要

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

            // 檔案裡的 UV 現況（消光係數／有無 UV 通道）
            renderAstraFileSummary(parsedFiles);

            // 顯示色譜圖和積分範圍控制
            const chartCard = document.getElementById('astraChromatogramCard');
            chartCard.classList.remove('hidden');

            const intStart = parseFloat(document.getElementById('astraIntStart').value) || 5;
            const intEnd = parseFloat(document.getElementById('astraIntEnd').value) || 12;
            displayAstraChromatogramsWithRange(parsedFiles, intStart, intEnd);

        } catch (err) {
            statusEl.textContent = `解析失敗: ${err.message}`;
            renderAstraFileSummary([]);
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
        // 樣品名／檔名／濃度都直接來自 .afe7（SQLite）與檔案系統，屬不受信任輸入
        const sampleName = escapeHtmlDndc(inj.sampleName);
        const fileName = escapeHtmlDndc(inj.fileName);
        const concentration = escapeHtmlDndc(inj.concentration);
        tableHtml += `
            <tr>
                <td><input type="checkbox" class="astra-row-check" data-astra-idx="${i}" aria-label="納入 ${sampleName} 的擬合" checked></td>
                <td style="font-size: 0.75rem;">${fileName}</td>
                <td>${sampleName}</td>
                <td><input type="number" class="form-input" value="${concentration}" step="0.0001" data-astra-idx="${i}" data-field="conc" aria-label="${sampleName} 濃度 (g/mL)"></td>
                <td><input type="number" class="form-input" value="${inj.injectionVolumeMl || ''}" step="0.001" data-astra-idx="${i}" data-field="vol" placeholder="mL" aria-label="${sampleName} 注射體積 (mL)"></td>
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

// 純文案函式對外（tests/ 在 Node 端直接測，不需要 DOM）
window.DndcAstraUi = Object.freeze({
    describeAstraUv,
    summarizeAstraUvFiles,
    ASTRA_UV_MISSING_TEXT,
    ASTRA_UV_ABSENT_TEXT,
});
