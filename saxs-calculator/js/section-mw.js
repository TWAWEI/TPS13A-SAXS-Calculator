/**
 * TPS13A SAXS Calculator - MW Resolution Section
 * 分子量解析度區段：管柱解析度與 RT ↔ MW 換算。
 */

// ========================
// MW Resolution Section
// ========================
function initMWSection() {
    // 所有需要監聽的輸入元素
    const mwInput = document.getElementById('mwInput');
    const oligomerInput = document.getElementById('mwOligomer');
    const injectionInput = document.getElementById('mwInjectionVolume');
    const flowRateInput = document.getElementById('mwFlowRate');
    const poreSizeSelect = document.getElementById('poreSize');
    const retentionTimeInput = document.getElementById('retentionTimeInput');

    // 自動計算函數 (MW → RT)
    function autoCalculateMwToRt() {
        const baseMw = parseFloat(mwInput.value);
        if (isNaN(baseMw) || baseMw <= 0) return;

        const poreSize = poreSizeSelect.value;
        const flowRate = parseFloat(flowRateInput.value) || 0.35;
        const oligomer = parseInt(oligomerInput.value) || 1;
        const mw = baseMw * oligomer;

        const retentionTime = SAXSCalculations.calculateRetentionTimeFromMw(mw, poreSize, flowRate);

        displayMWResults({
            mode: 'forward',
            poreSize,
            flowRate,
            injectionVolume: parseFloat(injectionInput.value) || 3,
            baseMw,
            oligomer,
            mw,
            retentionTime,
            peakWidth: NaN,
            massResolution: null
        });
    }

    // 自動計算函數 (RT → MW)
    function autoCalculateRtToMw() {
        const rt = parseFloat(retentionTimeInput.value);
        if (isNaN(rt) || rt <= 0) return;

        const poreSize = poreSizeSelect.value;
        const flowRate = parseFloat(flowRateInput.value) || 0.35;

        const estimatedMw = SAXSCalculations.calculateMwFromRetentionTime(rt, poreSize, flowRate);

        displayMWResults({
            mode: 'reverse',
            poreSize,
            flowRate,
            retentionTime: rt,
            estimatedMw,
            peakWidth: NaN,
            massResolution: null
        });
    }

    // 監聽 MW 相關輸入變更 → 自動計算 RT
    [mwInput, oligomerInput, flowRateInput, poreSizeSelect].forEach(el => {
        el.addEventListener('input', autoCalculateMwToRt);
        el.addEventListener('change', autoCalculateMwToRt);
    });

    // 監聽 RT 輸入變更 → 自動計算 MW
    retentionTimeInput.addEventListener('input', autoCalculateRtToMw);
    retentionTimeInput.addEventListener('change', autoCalculateRtToMw);

    // 保留按鈕功能作為備用
    const calculateBtn = document.getElementById('calculateMW');
    const calculateReverseBtn = document.getElementById('calculateMWReverse');

    if (calculateBtn) {
        calculateBtn.addEventListener('click', autoCalculateMwToRt);
    }
    if (calculateReverseBtn) {
        calculateReverseBtn.addEventListener('click', autoCalculateRtToMw);
    }

    // 初始化時如果有值就自動計算
    if (mwInput.value) {
        autoCalculateMwToRt();
    }
}

function displayMWResults(data) {
    const resultsDiv = document.getElementById('mwResults');
    const proteinMw = AppState.proteinData?.molecularWeight;

    if (data.mode === 'forward') {
        // 從 MW 計算滯留時間
        const oligomerText = data.oligomer > 1 ? ` (${data.oligomer}mer)` : '';
        resultsDiv.innerHTML = `
            <div class="result-grid">
                <div class="result-item" style="border-left-color: var(--color-accent-tertiary);">
                    <div class="result-label">預期滯留時間</div>
                    <div class="result-value">${data.retentionTime.toFixed(3)} <span style="font-size: 0.75rem;">min</span></div>
                </div>
                ${data.massResolution ? `
                <div class="result-item">
                    <div class="result-label">質量解析度</div>
                    <div class="result-value">± ${data.massResolution.toFixed(0)} <span style="font-size: 0.75rem;">Da</span></div>
                </div>
                ` : ''}
            </div>
            
            <div class="section-divider"><span>輸入參數</span></div>
            
            <div class="result-grid">
                <div class="result-item">
                    <div class="result-label">實際分子量${oligomerText}</div>
                    <div class="result-value">${data.mw.toLocaleString()} <span style="font-size: 0.75rem;">Da</span></div>
                </div>
                <div class="result-item">
                    <div class="result-label">管柱孔徑</div>
                    <div class="result-value">${data.poreSize} Å</div>
                </div>
                <div class="result-item">
                    <div class="result-label">流速</div>
                    <div class="result-value">${data.flowRate} <span style="font-size: 0.75rem;">mL/min</span></div>
                </div>
            </div>
            
            <div class="alert alert-success" style="margin-top: 1rem;">
                <strong>✓ 計算完成</strong><br>
                流速 ${data.flowRate} mL/min 條件下<br>
                分子量 ${(data.mw / 1000).toFixed(2)} kDa 預期在 <strong>${data.retentionTime.toFixed(3)} min</strong> 出峰
            </div>
        `;
    } else {
        // 反向計算：從滯留時間估算 MW
        resultsDiv.innerHTML = `
            <div class="result-grid">
                <div class="result-item" style="border-left-color: var(--color-accent-secondary);">
                    <div class="result-label">估算分子量</div>
                    <div class="result-value">${data.estimatedMw.toFixed(0)} <span style="font-size: 0.75rem;">Da</span></div>
                </div>
                ${data.massResolution ? `
                <div class="result-item">
                    <div class="result-label">質量解析度</div>
                    <div class="result-value">± ${data.massResolution.toFixed(0)} <span style="font-size: 0.75rem;">Da</span></div>
                </div>
                ` : ''}
            </div>
            
            <div class="section-divider"><span>輸入參數</span></div>
            
            <div class="result-grid">
                <div class="result-item">
                    <div class="result-label">滯留時間</div>
                    <div class="result-value">${data.retentionTime.toFixed(3)} min</div>
                </div>
                <div class="result-item">
                    <div class="result-label">管柱孔徑</div>
                    <div class="result-value">${data.poreSize} Å</div>
                </div>
                <div class="result-item">
                    <div class="result-label">流速</div>
                    <div class="result-value">${data.flowRate} <span style="font-size: 0.75rem;">mL/min</span></div>
                </div>
            </div>
            
            ${proteinMw ? `
            <div class="alert ${Math.abs(data.estimatedMw - proteinMw) / proteinMw < 0.3 ? 'alert-success' : 'alert-warning'}" style="margin-top: 1rem;">
                <strong>與序列 MW 比較：</strong><br>
                序列 MW: ${proteinMw.toFixed(0)} Da<br>
                SEC MW: ${data.estimatedMw.toFixed(0)} Da<br>
                比值: ${(data.estimatedMw / proteinMw).toFixed(2)}
            </div>
            ` : ''}
        `;
    }

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('mwResults');
}
