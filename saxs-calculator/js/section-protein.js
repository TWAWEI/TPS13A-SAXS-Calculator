/**
 * TPS13A SAXS Calculator - Protein Analysis Section
 * 蛋白質序列分析區段：序列輸入、結果顯示、組成圖表。
 */

// ========================
// Protein Analysis Section
// ========================
function initProteinSection() {
    const sequenceInput = document.getElementById('proteinSequence');
    const analyzeBtn = document.getElementById('analyzeProtein');
    const clearBtn = document.getElementById('clearSequence');
    const loadSampleBtn = document.getElementById('loadSampleSequence');
    const lengthDisplay = document.getElementById('sequenceLength');

    // Update length on input
    sequenceInput.addEventListener('input', () => {
        const cleaned = sequenceInput.value.toUpperCase().replace(/[^A-Z]/g, '');
        lengthDisplay.textContent = `長度: ${cleaned.length} 殘基`;
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        sequenceInput.value = '';
        lengthDisplay.textContent = '長度: 0 殘基';
        document.getElementById('proteinResults').innerHTML = `
            <div class="alert alert-info">
                請輸入蛋白質序列後點擊「分析序列」
            </div>
        `;
        document.getElementById('proteinStats').innerHTML = '';
        destroyCharts();
    });

    // Load sample sequence — BSA (PDB: 3V03, Chain A)
    loadSampleBtn.addEventListener('click', () => {
        const sampleSequence = `DTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLTSSARQRLRCASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALA`;
        sequenceInput.value = sampleSequence;
        document.getElementById('proteinName').value = 'BSA (Bovine Serum Albumin, PDB: 3V03)';
        lengthDisplay.textContent = `長度: ${sampleSequence.length} 殘基`;
    });

    // Analyze button
    analyzeBtn.addEventListener('click', () => {
        const sequence = sequenceInput.value;
        const proteinName = document.getElementById('proteinName').value || 'Unknown';
        const reducedCysteine = document.getElementById('reducedCysteine').checked;

        if (!sequence.trim()) {
            showAlert('proteinResults', 'error', '請輸入蛋白質序列');
            return;
        }

        const result = ProteinAnalysis.analyzeProtein(sequence);

        if (result.error) {
            showAlert('proteinResults', 'error', result.message);
            return;
        }

        // Update extinction coefficient if reduced cysteine
        if (reducedCysteine) {
            result.extinction = ProteinAnalysis.calculateExtinctionCoeff(
                ProteinAnalysis.parseSequence(sequence).composition,
                true
            );
            result.epsilonCm2g = ProteinAnalysis.calculateEpsilonCm2g(
                result.extinction,
                result.molecularWeight
            );
            // ε 變了，兩個質量單位也要跟著重算，否則三格數字會互相矛盾
            result.massExtinction = ProteinAnalysis.calculateMassExtinction(
                result.extinction,
                result.molecularWeight
            );
        }

        // Store in global state
        AppState.proteinData = {
            name: proteinName,
            ...result
        };

        // Display results
        displayProteinResults(result, proteinName);
        displayProteinStats(result);
        createProteinCharts(result.composition);

        // Update other forms with protein data
        updateFormsWithProteinData(result);

        // Update theoretical I(0) display
        updateTheoreticalI0FromProtein();

        // Update IUCr table
        updateIUCrTable();
    });

    // Chart type tabs
    document.querySelectorAll('[data-chart]').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('[data-chart]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const chartType = tab.dataset.chart;
            document.getElementById('chartContainer-bar').classList.toggle('hidden', chartType !== 'bar');
            document.getElementById('chartContainer-doughnut').classList.toggle('hidden', chartType !== 'doughnut');
        });
    });
}

function displayProteinResults(result, name) {
    const resultsDiv = document.getElementById('proteinResults');

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">蛋白質名稱</div>
                <div class="result-value">${escapeHtml(name)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">序列長度</div>
                <div class="result-value">${result.length} <span style="font-size: 0.75rem;">殘基</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">分子量</div>
                <div class="result-value">${result.molecularWeight.toFixed(2)} <span style="font-size: 0.75rem;">Da</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">分子量 (kDa)</div>
                <div class="result-value">${result.molecularWeightKDa.toFixed(3)} <span style="font-size: 0.75rem;">kDa</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>物理參數</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">乾燥體積</div>
                <div class="result-value">${result.dryVolume.toFixed(1)} <span style="font-size: 0.75rem;">Å³</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">電子數</div>
                <div class="result-value">${result.electronCount}</div>
            </div>
            <div class="result-item">
                <div class="result-label"><i>v̄</i> = <i>V</i><sub>dry</sub>/<i>M</i></div>
                <div class="result-value">${result.partialSpecificVolume.toFixed(4)} <span style="font-size: 0.75rem;">cm³/g</span></div>
                <div class="result-note">晶體殘基體積推得，SAXS 對比用；非熱力學偏比容</div>
            </div>
            <div class="result-item">
                <div class="result-label">dn/dc</div>
                <div class="result-value">${result.dndc.toFixed(4)} <span style="font-size: 0.75rem;">mL/g</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>消光係數 (280 nm)</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label"><i>ε</i> (M⁻¹ cm⁻¹)</div>
                <div class="result-value">${result.extinction.epsilon.toLocaleString()}</div>
            </div>
            <div class="result-item">
                <div class="result-label"><i>ε</i><sub>mass</sub> (mL·mg⁻¹·cm⁻¹)</div>
                <div class="result-value">${result.massExtinction.mlPerMgCm.toFixed(3)}</div>
                <div class="result-note">= A280 (0.1%)，HPLC dn/dc 頁用</div>
            </div>
            <div class="result-item">
                <div class="result-label">ASTRA 單位 (mL·g⁻¹·cm⁻¹)</div>
                <div class="result-value">${result.massExtinction.mlPerGCm.toFixed(1)}</div>
                <div class="result-note">.afe7 的 UV 消光係數欄位</div>
            </div>
            <div class="result-item">
                <div class="result-label">Trp (W)</div>
                <div class="result-value">${result.extinction.nTrp}</div>
            </div>
            <div class="result-item">
                <div class="result-label">Tyr (Y)</div>
                <div class="result-value">${result.extinction.nTyr}</div>
            </div>
            <div class="result-item">
                <div class="result-label">Cys (C)</div>
                <div class="result-value">${result.extinction.nCys}</div>
            </div>
            <div class="result-item">
                <div class="result-label">二硫鍵數</div>
                <div class="result-value">${result.extinction.nDisulfide}</div>
            </div>
        </div>

        <div class="formula-note">
            <i>ε</i><sub>mass</sub> = <i>ε</i> / MW（Pace 1995 序列估計；BSA 文獻實測 0.667）
        </div>
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('proteinResults');
}

function displayProteinStats(result) {
    const statsDiv = document.getElementById('proteinStats');
    statsDiv.classList.remove('hidden');

    statsDiv.innerHTML = `
        <div class="stat-card">
            <div class="stat-content">
                <div class="stat-label">分子量</div>
                <div class="stat-value">${result.molecularWeightKDa.toFixed(2)}<span class="stat-unit">kDa</span></div>
                <div class="stat-sub">${result.molecularWeight.toFixed(0)} Da</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-content">
                <div class="stat-label">序列長度</div>
                <div class="stat-value">${result.length}<span class="stat-unit">殘基</span></div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-content">
                <div class="stat-label">乾燥體積</div>
                <div class="stat-value">${(result.dryVolume / 1000).toFixed(1)}<span class="stat-unit">×10³ Å³</span></div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-content">
                <div class="stat-label">消光係數 <i>ε</i></div>
                <div class="stat-value">${(result.extinction.epsilon / 1000).toFixed(1)}<span class="stat-unit">×10³</span></div>
                <div class="stat-sub">M⁻¹ cm⁻¹ @ 280nm</div>
            </div>
        </div>
    `;
}

function createProteinCharts(composition) {
    // Destroy existing charts
    destroyCharts();

    const compositionCard = document.getElementById('compositionCard');
    compositionCard.classList.remove('hidden');

    // Create bar chart
    AppState.charts.bar = SAXSCharts.createCompositionBarChart('compositionBarChart', composition);

    // Create doughnut chart
    AppState.charts.doughnut = SAXSCharts.createCompositionChart('compositionDoughnutChart', composition);

    // Chart.js 只畫像素；把關鍵數字寫進 aria-label，AT 才讀得到圖的結論
    describeCompositionCharts(composition);
}

/**
 * 依實際組成更新兩張氨基酸組成圖的無障礙描述。
 *
 * @param {Object} composition - 各殘基數量（key 為單字母代碼）
 * @returns {void}
 */
function describeCompositionCharts(composition) {
    const entries = Object.entries(composition || {})
        .filter(([, n]) => Number(n) > 0)
        .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return;

    const total = entries.reduce((sum, [, n]) => sum + Number(n), 0);
    const top = entries.slice(0, 5)
        .map(([aa, n]) => `${aa} ${n} 個（${((n / total) * 100).toFixed(1)}%）`)
        .join('、');

    A11y.describeChart('compositionBarChart',
        `氨基酸組成長條圖，共 ${total} 個殘基、${entries.length} 種氨基酸；` +
        `最多的五種為 ${top}。完整數值見左側「氨基酸組成」列表`);
    A11y.describeChart('compositionDoughnutChart',
        `氨基酸分類比例環圖，共 ${total} 個殘基；` +
        `占比最高的五種氨基酸為 ${top}。完整數值見左側「氨基酸組成」列表`);
}

function destroyCharts() {
    Object.values(AppState.charts).forEach(chart => {
        if (chart) chart.destroy();
    });
    AppState.charts = {};
}

function updateFormsWithProteinData(result) {
    // Update Sample calculation form
    const epsilonInput = document.getElementById('inputEpsilon');
    const mwInput = document.getElementById('inputMw');
    if (epsilonInput) epsilonInput.value = result.extinction.epsilon;
    if (mwInput) mwInput.value = result.molecularWeight.toFixed(2);

    // Update Centrifuge form
    // 注意: 不要把序列算出的 v̄ (= V_dry/M，晶體殘基體積推得) 填進離心頁。
    // Svedberg 方程需要的是熱力學偏比容 (BSA 0.733 cm³/g)，兩者不同，
    // 離心頁維持 0.73 的預設值。
    const centrifugeMw = document.getElementById('centrifugeMw');
    if (centrifugeMw) centrifugeMw.value = result.molecularWeight.toFixed(0);

    // Update MW Resolution form
    const mwResolutionInput = document.getElementById('mwInput');
    if (mwResolutionInput) mwResolutionInput.value = result.molecularWeight.toFixed(2);

    // HPLC dn/dc 頁的質量消光係數（mL·mg⁻¹cm⁻¹）。
    // 由 dndc-hplc-ui.js 決定要不要覆蓋——使用者手動改過的值不動。
    if (result.massExtinction && typeof applySequenceEpsilon === 'function') {
        applySequenceEpsilon(result.massExtinction.mlPerMgCm);
    }
}
