/**
 * TPS13A SAXS Calculator - dn/dc HPLC Results
 * HPLC dn/dc 的結果顯示：對齊資訊、警告、色譜圖與全通道預覽。
 */

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
        ${renderWarningsHtml([...warnings, ...(result.warnings || [])])}
        <div class="stat-card mb-md">
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
                <div class="result-value">${escapeHtmlDndc(result.peakMode)}</div>
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

    // 建立 checkbox toggles（跳過 Time 欄）
    const channelIndices = [];
    for (let i = 1; i < headers.length; i++) {
        channelIndices.push(i);
    }

    // 預設顯示前 3 個通道
    const defaultVisible = new Set(channelIndices.slice(0, 3));
    const seriesCount = ChartTheme.palette().series.length;

    // 顏色跟著通道（series = 通道在 channelIndices 的位置），不跟著勾選順序；
    // 系列色用完後重用同色、改虛線（與圖線一致）
    togglesDiv.innerHTML = channelIndices.map((colIdx, i) => {
        const checked = defaultVisible.has(colIdx);
        const classes = ['channel-chip', checked ? 'is-on' : '', i >= seriesCount ? 'channel-chip--dashed' : '']
            .filter(Boolean).join(' ');
        return `<label class="${classes}" data-series="${i}">
            <input type="checkbox" class="dndc-channel-toggle" data-col="${colIdx}" ${checked ? 'checked' : ''}>
            <span>${escapeHtmlDndc(headers[colIdx])}</span>
        </label>`;
    }).join('');
    paintChannelChips();

    // 儲存供重繪用
    DndcState.channelChartData = { time, headers, data, channelIndices };

    // 繪製
    redrawChannelsChart();

    // 綁定 checkbox 事件
    togglesDiv.querySelectorAll('.dndc-channel-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            cb.closest('label').classList.toggle('is-on', cb.checked);
            redrawChannelsChart();
        });
    });
}

/**
 * 依主題設定每個通道膠囊的 --chip-color（原始碼裡沒有色碼；切換主題時由 initChannelChipTheme 重設）。
 * @param {('light'|'dark')} [themeName] - 省略時用目前生效的主題
 */
function paintChannelChips(themeName) {
    const palette = ChartTheme.palette(themeName);
    document.querySelectorAll('#dndcChannelToggles .channel-chip').forEach(label => {
        label.style.setProperty('--chip-color', ChartTheme.seriesColor(palette, Number(label.dataset.series)));
    });
}

/** 由 dndc-ui.js 的 DOMContentLoaded 呼叫：主題切換時重設通道膠囊顏色（圖表本身由 ChartTheme.init 處理） */
function initChannelChipTheme() {
    document.addEventListener('tps:themechange', event => paintChannelChips(event.detail && event.detail.theme));
}

function redrawChannelsChart() {
    const { time, headers, data, channelIndices } = DndcState.channelChartData;

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
        const values = data.map(r => r[colIdx]);

        datasets.push({
            label: headers[colIdx],
            data: time.map((t, j) => ({ x: t, y: values[j] })),
            tpsSeries: channelIndices.indexOf(colIdx),
            borderWidth: 2,
            pointRadius: 0,
            showLine: true,
            yAxisID: `y${datasets.length}`
        });
    });

    // 每個通道獨立 y 軸（因為量級可能差很多）；軸線用該通道的顏色，刻度與標題用文字色
    const scales = {
        x: {
            type: 'linear',
            title: { display: true, text: 'Time (min)', font: { family: ChartTheme.FONT, size: 12, style: 'italic' } },
            ticks: { font: { size: 10 } },
            grid: { display: false }
        }
    };

    datasets.forEach((ds, i) => {
        scales[`y${i}`] = {
            type: 'linear',
            position: i === 0 ? 'left' : 'right',
            tpsSeries: ds.tpsSeries,
            title: { display: i < 2, text: ds.label, font: { family: ChartTheme.FONT, size: 11 } },
            ticks: { font: { size: 9 } },
            grid: { display: i === 0 }
        };
    });

    DndcState.charts.chromatogram = new Chart(canvas, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: {
                    labels: { font: { family: ChartTheme.FONT, size: 12 } }
                },
                tooltip: {
                    cornerRadius: 8, padding: 10
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
                }
            },
            scales
        }
    }));
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
