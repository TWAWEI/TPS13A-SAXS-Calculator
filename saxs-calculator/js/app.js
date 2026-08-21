/**
 * TPS13A SAXS Calculator - Main Application
 * 主應用程式邏輯
 */

// ========================
// Global State
// ========================
const AppState = {
    proteinData: null,
    saxsData: null,
    charts: {},
    dndcUnlocked: false
};

// Storage 在部分瀏覽器設定下（Safari「阻擋所有 Cookie」、企業政策、無痕模式）
// 連存取器本身都會 throw SecurityError。全部走 FormUtils 的安全包裝，
// 避免一個 getItem 就讓 DOMContentLoaded 後面所有 init 停擺。
const safeStorage = FormUtils.safeLocal;
const safeSession = FormUtils.safeSession;

// ========================
// dn/dc Password Lock
// ========================
const DNDC_HASH = '53e6b431c5618bbe2d7a231a2ebb5b846a87182568c66da31e1e5f7006ef3e5a';

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function initDndcLock() {
    const unlockBtn = document.getElementById('dndcNavUnlock');
    if (!unlockBtn) return;

    // 檢查 sessionStorage 是否已解鎖
    if (safeSession.get('dndcUnlocked') === 'true') {
        unlockDndc({ moveFocus: false });
        return;
    }

    const dialog = document.getElementById('dndcPasswordModal');
    const input = document.getElementById('dndcPasswordInput');
    const errorDiv = document.getElementById('dndcPasswordError');
    const form = document.getElementById('dndcPasswordForm');
    const cancelBtn = document.getElementById('dndcPasswordCancel');
    if (!dialog || !input || !errorDiv || !form || !cancelBtn) return;

    // 原生 <dialog> 自帶焦點鎖定、Escape 關閉與背景 inert。
    // 舊瀏覽器沒有 showModal 時退回 open 屬性，至少不讓 dn/dc 完全不可達。
    const supportsDialog = typeof dialog.showModal === 'function';

    const clearError = () => {
        errorDiv.classList.add('hidden');
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
    };

    const showError = () => {
        errorDiv.classList.remove('hidden');
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'dndcPasswordError');
        input.value = '';
        input.focus();
    };

    // 只要還鎖著，焦點就回到觸發器；已解鎖時交給 unlockDndc 處理。
    const restoreTrigger = () => {
        if (AppState.dndcUnlocked) return;
        unlockBtn.setAttribute('aria-expanded', 'false');
        unlockBtn.focus();
    };

    const openDialog = () => {
        if (AppState.dndcUnlocked) return;
        input.value = '';
        clearError();
        unlockBtn.setAttribute('aria-expanded', 'true');
        if (supportsDialog) {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
        input.focus();
    };

    const closeDialog = () => {
        if (supportsDialog) {
            if (dialog.open) dialog.close();   // close 事件負責清值與還焦點
        } else {
            dialog.removeAttribute('open');
            input.value = '';
            restoreTrigger();
        }
    };

    const handleSubmit = async (event) => {
        if (event) event.preventDefault();
        const pwd = input.value;
        if (!pwd) {
            input.focus();
            return;
        }
        try {
            const hash = await sha256(pwd);
            if (hash === DNDC_HASH) {
                clearError();
                safeSession.set('dndcUnlocked', 'true');
                unlockDndc({ moveFocus: false });
                closeDialog();
                focusFirstDndcNavItem();
            } else {
                showError();
            }
        } catch (err) {
            // crypto.subtle 在非安全上下文（http:// 且非 localhost）不存在
            console.error('dn/dc 密碼驗證失敗:', err);
            errorDiv.textContent = '無法驗證密碼（瀏覽器不支援或非安全連線）';
            showError();
        }
    };

    // 事件只綁一次；舊版每次開啟都重新指派 onclick
    unlockBtn.addEventListener('click', openDialog);
    form.addEventListener('submit', handleSubmit);
    cancelBtn.addEventListener('click', closeDialog);
    input.addEventListener('input', clearError);

    // close 涵蓋所有關閉路徑：Escape、取消鈕、背景點擊、解鎖成功
    dialog.addEventListener('close', () => {
        input.value = '';
        restoreTrigger();
    });

    // 點擊 backdrop（事件 target 是 dialog 本體）關閉
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog();
    });
}

function focusFirstDndcNavItem() {
    const navItems = document.getElementById('dndcNavItems');
    const firstItem = navItems && navItems.querySelector('.nav-item');
    if (firstItem) firstItem.focus();
}

function unlockDndc({ moveFocus = false } = {}) {
    AppState.dndcUnlocked = true;
    const navItems = document.getElementById('dndcNavItems');
    const unlockBtn = document.getElementById('dndcNavUnlock');
    if (navItems) navItems.classList.remove('hidden');
    if (unlockBtn) {
        unlockBtn.textContent = '🔓 dn/dc 工具';
        unlockBtn.setAttribute('aria-expanded', 'true');
        // 解鎖後已無 dialog 可開：移除 popup 語意並退出 tab 順序，
        // 避免留下一個「可聚焦但按了沒反應」的控制項。
        unlockBtn.removeAttribute('aria-haspopup');
        unlockBtn.removeAttribute('aria-controls');
        unlockBtn.disabled = true;
        unlockBtn.style.cursor = 'default';
    }
    if (moveFocus) focusFirstDndcNavItem();
}

// ========================
// Navigation
// ========================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    const sections = document.querySelectorAll('.section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionId = item.dataset.section;

            // Update nav active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Show corresponding section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `section-${sectionId}`) {
                    section.classList.add('active');
                }
            });

            // Update aria-current
            navItems.forEach(nav => nav.removeAttribute('aria-current'));
            item.setAttribute('aria-current', 'page');

            // Close mobile menu if open
            setMobileMenu(false);
        });
    });

    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    const setMobileMenu = (isOpen, { returnFocus = false } = {}) => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open', isOpen);
        if (sidebarOverlay) sidebarOverlay.classList.toggle('active', isOpen);
        if (mobileMenuBtn) {
            mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
            mobileMenuBtn.setAttribute('aria-label', isOpen ? '關閉選單' : '開啟選單');
            if (!isOpen && returnFocus) mobileMenuBtn.focus();
        }
    };

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            setMobileMenu(!(sidebar && sidebar.classList.contains('open')));
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => setMobileMenu(false));
    }

    // Escape 關閉行動選單並把焦點還給漢堡鈕（側欄是 off-canvas，不關就沒有出口）
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            setMobileMenu(false, { returnFocus: true });
        }
    });

    // Sidebar collapse toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const toggleIcon = document.getElementById('sidebarToggleIcon');
    const appLayout = document.querySelector('.app-layout');

    if (sidebarToggle && sidebar && appLayout) {
        // 圖示是 aria-hidden 的箭頭，狀態必須另外用 aria-expanded/aria-label 表達
        const syncCollapseState = (isCollapsed) => {
            appLayout.classList.toggle('sidebar-collapsed', isCollapsed);
            if (toggleIcon) toggleIcon.textContent = isCollapsed ? '▶' : '◀';
            sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
            sidebarToggle.setAttribute('aria-label', isCollapsed ? '展開側邊欄' : '收合側邊欄');

            // 收合時只看得到 data-short 縮寫，補 title 讓 hover 讀得到完整名稱；
            // 展開時標籤已經完整可見，留著 title 只會重複朗讀。
            sidebar.querySelectorAll('.nav-item[data-title]').forEach(item => {
                if (isCollapsed) {
                    item.setAttribute('title', item.dataset.title);
                } else {
                    item.removeAttribute('title');
                }
            });
        };

        // Restore state from sessionStorage
        if (safeSession.get('sidebarCollapsed') === 'true') {
            sidebar.classList.add('collapsed');
            syncCollapseState(true);
        } else {
            syncCollapseState(false);
        }

        sidebarToggle.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            syncCollapseState(isCollapsed);
            safeSession.set('sidebarCollapsed', String(isCollapsed));
        });
    }
}

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
                <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.25rem;">晶體殘基體積推得，SAXS 對比用；非熱力學偏比容</div>
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
                <div class="result-label"><i>ε</i> (cm² g⁻¹)</div>
                <div class="result-value">${result.epsilonCm2g.toFixed(2)}</div>
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
}

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
        } else {
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

    // Detector distance elements
    const detectorDistanceSource = document.getElementById('detectorDistanceSource');
    const suggestedQminDisplay = document.getElementById('suggestedQminDisplay');
    const suggestedSDDisplay = document.getElementById('suggestedSDDisplay');
    const suggestedQrangeDisplay = document.getElementById('suggestedQrangeDisplay');

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

        // Calculate and display detector distance recommendations using MW
        const detectorResult = SAXSCalculations.calculateDetectorDistance(proteinMw, 'mw');

        if (detectorDistanceSource) {
            detectorDistanceSource.textContent = `Rg: ${detectorResult.rg.toFixed(1)} Å`;
        }
        if (suggestedQminDisplay) {
            suggestedQminDisplay.textContent = detectorResult.qmin.toFixed(4);
        }
        if (suggestedSDDisplay) {
            suggestedSDDisplay.textContent = detectorResult.suggestedSD.toLocaleString();
        }
        if (suggestedQrangeDisplay) {
            suggestedQrangeDisplay.textContent = `${detectorResult.qmin.toFixed(3)}-0.4`;
        }
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

// ========================
// HPLC-SAXS Section
// ========================
function initHPLCSection() {
    const calculateBtn = document.getElementById('calculateHPLCSAXS');

    if (!calculateBtn) {
        console.warn('HPLC-SAXS calculate button not found');
        return;
    }

    calculateBtn.addEventListener('click', () => {
        const ALERT_ID = 'hplcSaxsAlert';

        let params;
        try {
            params = {
                peakCenter: FormUtils.readPositiveField('hplcPeakCenter', 'Peak center'),
                peakFWHM: FormUtils.readPositiveField('hplcPeakFWHM', 'Peak width (FWHM)'),
                injectionVolume: FormUtils.readPositiveField('hplcInjectionVolume', 'Volume to inject in SAXS exp'),
                targetFlowRate: FormUtils.readPositiveField('hplcTargetFlowRate', 'Target flow rate'),
                initialFlowRate: FormUtils.readPositiveField('hplcInitialFlowRate', 'Initial flow rate')
            };
        } catch (err) {
            showAlert(ALERT_ID, 'error', err.message);
            return;
        }

        try {
            // Calculate HPLC-SAXS settings（注射體積超出 3–100 μL 校正範圍會 throw）
            const result = SAXSCalculations.calculateHPLCSAXSSettings(params);

            // Calculate suggested values for 10μL pre-run
            const suggested = SAXSCalculations.calculateSuggestedParams(params.peakCenter, params.peakFWHM);

            clearAlert(ALERT_ID);
            displayHPLCSAXSResults(result, suggested);
        } catch (err) {
            // 領域驗證錯誤（超出校正範圍等）直接顯示；非預期錯誤另記 console 供除錯
            if (err instanceof TypeError || err instanceof RangeError) {
                console.error('[HPLC-SAXS]', err);
            }
            showAlert(ALERT_ID, 'error', err.message);
        }
    });

    // Also update suggested values when peak center/FWHM changes
    ['hplcPeakCenter', 'hplcPeakFWHM'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => {
                const peakCenter = parseFloat(document.getElementById('hplcPeakCenter').value);
                const peakFWHM = parseFloat(document.getElementById('hplcPeakFWHM').value);

                if (!isNaN(peakCenter) && !isNaN(peakFWHM)) {
                    const suggested = SAXSCalculations.calculateSuggestedParams(peakCenter, peakFWHM);
                    updateSuggestedValues(suggested);
                }
            });
        }
    });
}

function displayHPLCSAXSResults(result, suggested) {
    // Update suggested values
    updateSuggestedValues(suggested);

    // Update Flow Rate Table
    const flowRateTableBody = document.getElementById('flowRateTableBody');
    if (flowRateTableBody) {
        flowRateTableBody.innerHTML = result.flowRateTable.map(row => `
            <tr${row.note ? ' class="flow-rate-row--note"' : ''}>
                <td>${row.time.toFixed(2)}</td>
                <td>${row.flowRate.toFixed(3)}</td>
                <td>${row.note || '-'}</td>
            </tr>
        `).join('');
    }

    // Update Report Stoptime
    const reportStoptimeEl = document.getElementById('reportStoptime');
    if (reportStoptimeEl) {
        reportStoptimeEl.textContent = result.reportStoptime;
    }

    // Update Fraction Collector
    const fractionStartTime = document.getElementById('fractionStartTime');
    const fractionStopTime = document.getElementById('fractionStopTime');
    const timePerFraction = document.getElementById('timePerFraction');

    if (fractionStartTime) fractionStartTime.textContent = result.fractionCollector.startTime.toFixed(2);
    if (fractionStopTime) fractionStopTime.textContent = result.fractionCollector.stopTime.toFixed(2);
    if (timePerFraction) timePerFraction.textContent = result.fractionCollector.timePerFraction.toFixed(2);

    // Update Detector Settings Table
    const detectorTableBody = document.getElementById('detectorSettingsTableBody');
    if (detectorTableBody) {
        detectorTableBody.innerHTML = result.detectorSettings.map(row => {
            // Highlight step 4 (main data collection)
            const isMainStep = row.step === 4;
            const rowStyle = isMainStep ? 'background: rgba(245, 158, 11, 0.15);' : '';
            // Text colours chosen for ≥4.5:1 on the light row backgrounds (WCAG AA)
            const frameStyle = isMainStep ? 'color: #92400e; font-weight: 700;' : '';

            return `
                <tr style="${rowStyle}">
                    <td>${row.step}</td>
                    <td style="color: ${row.mode === 'TM' ? '#1d4ed8' : '#047857'}; font-weight: 600;">${row.mode}</td>
                    <td style="${frameStyle}">${row.frame}</td>
                    <td>${row.wait}</td>
                    <td>${row.exposure}</td>
                    <td>${row.hold}</td>
                </tr>
            `;
        }).join('');
    }


    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('hplcSaxsResults');
}

function updateSuggestedValues(suggested) {
    const suggestPeakCenter = document.getElementById('suggestPeakCenter');
    const suggestPeakWidth = document.getElementById('suggestPeakWidth');
    const suggestSampleVolume = document.getElementById('suggestSampleVolume');

    if (suggestPeakCenter) suggestPeakCenter.textContent = suggested.suggestPeakCenter;
    if (suggestPeakWidth) suggestPeakWidth.textContent = suggested.suggestPeakWidth;
    if (suggestSampleVolume) suggestSampleVolume.textContent = suggested.suggestSampleVolume;
}


// ========================
// Sample Calculations Section
// ========================
function initSampleSection() {
    const calculateBtn = document.getElementById('calculateSample');

    calculateBtn.addEventListener('click', () => {
        // 空欄位 parseFloat 會得到 NaN，而 NaN <= 0 為 false——舊的檢查漏掉
        // pathLength，NaN 會一路傳進計算並印出 "NaN mg/mL"、汙染 AppState
        let absorbance, pathLength, epsilon, mw;
        try {
            absorbance = FormUtils.readPositiveField('uvAbsorbance', 'UV 吸光值');
            pathLength = FormUtils.readPositiveField('pathLength', '光徑長度');
            epsilon = FormUtils.readPositiveField('inputEpsilon', '消光係數 ε (莫耳)');
            mw = FormUtils.readPositiveField('inputMw', '分子量');
        } catch (err) {
            showAlert('sampleResults', 'error', err.message);
            return;
        }

        const concentration = SAXSCalculations.calculateConcentrationFromUV(
            absorbance, epsilon, pathLength, mw
        );

        // 最後一道防線：不讓 NaN／Infinity 寫進 AppState（稀釋倍率頁面會沿用）
        if (!Number.isFinite(concentration) || concentration <= 0) {
            showAlert('sampleResults', 'error',
                '無法從輸入值算出有效濃度，請確認 UV 吸光值、消光係數、光徑長度與分子量');
            return;
        }

        // Store latest UV concentration for dilution factor use
        AppState.lastUVConcentration = concentration;

        displaySampleResults({
            absorbance,
            pathLength,
            epsilon,
            mw,
            concentration,
            // Excel `Calculations of sample!N65`: c(mg/mL) × 10⁶ / MW → μM
            concentrationMolar: (concentration / mw) * 1e6 // μM
        });
    });

    // Dilution factor estimation
    const dfBtn = document.getElementById('calculateDilutionFactor');
    if (dfBtn) {
        dfBtn.addEventListener('click', () => {
            const injVol = parseFloat(document.getElementById('dfInjectionVolume').value);
            if (isNaN(injVol) || injVol <= 0) {
                showAlert('dilutionFactorResults', 'error', '注射體積必須大於 0');
                return;
            }

            const df = SAXSCalculations.calculateDilutionFactorEmpirical(injVol);
            const uvConc = AppState.lastUVConcentration;

            displayDilutionFactorResults({ injectedVolume: injVol, dilutionFactor: df, uvConcentration: uvConc });
        });
    }
}

function displaySampleResults(data) {
    const resultsDiv = document.getElementById('sampleResults');

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item" style="border-left-color: var(--color-accent-secondary);">
                <div class="result-label">濃度</div>
                <div class="result-value">${data.concentration.toFixed(4)} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
            <div class="result-item" style="border-left-color: var(--color-accent-secondary);">
                <div class="result-label">濃度 (μM)</div>
                <div class="result-value">${data.concentrationMolar.toFixed(2)} <span style="font-size: 0.75rem;">μM</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>輸入參數</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">吸光值</div>
                <div class="result-value">${data.absorbance} AU</div>
            </div>
            <div class="result-item">
                <div class="result-label">光徑</div>
                <div class="result-value">${data.pathLength} cm</div>
            </div>
            <div class="result-item">
                <div class="result-label">消光係數</div>
                <div class="result-value">${data.epsilon.toLocaleString()} M⁻¹ cm⁻¹</div>
            </div>
            <div class="result-item">
                <div class="result-label">分子量</div>
                <div class="result-value">${data.mw.toFixed(2)} Da</div>
            </div>
        </div>
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('sampleResults');
}

function displayDilutionFactorResults(data) {
    const resultsDiv = document.getElementById('dilutionFactorResults');
    const onColumnConc = (data.uvConcentration && data.uvConcentration > 0)
        ? (data.uvConcentration / data.dilutionFactor)
        : null;

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item" style="border-left-color: #f59e0b;">
                <div class="result-label">稀釋因子 (DF)</div>
                <div class="result-value">${data.dilutionFactor.toFixed(2)}</div>
            </div>
            <div class="result-item">
                <div class="result-label">注射體積</div>
                <div class="result-value">${data.injectedVolume} <span style="font-size: 0.75rem;">μL</span></div>
            </div>
        </div>
        ${onColumnConc !== null ? `
        <div class="section-divider"><span>On-column 濃度估算</span></div>
        <div class="result-grid">
            <div class="result-item" style="border-left-color: #10b981;">
                <div class="result-label">UV 量測濃度</div>
                <div class="result-value">${data.uvConcentration.toFixed(4)} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
            <div class="result-item" style="border-left-color: #10b981;">
                <div class="result-label">On-column 濃度</div>
                <div class="result-value">${onColumnConc.toFixed(4)} <span style="font-size: 0.75rem;">mg/mL</span></div>
            </div>
        </div>
        ` : `
        <div class="alert alert-info" style="margin-top: 0.75rem;">
            先計算 UV 濃度，即可同時顯示 on-column 濃度估算
        </div>
        `}
        <div class="alert alert-warning" style="margin-top: 0.75rem;">
            <strong>注意：</strong>此為經驗公式估算，誤差約 ±7.33%
        </div>
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('dilutionFactorResults');
}

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

// ========================
// Centrifuge Section
// ========================
function initCentrifugeSection() {
    const calculateBtn = document.getElementById('calculateCentrifuge');

    calculateBtn.addEventListener('click', () => {
        const rpm = parseFloat(document.getElementById('rpm').value);
        const radius = parseFloat(document.getElementById('rotorRadius').value);
        const mw = parseFloat(document.getElementById('centrifugeMw').value);
        const viscosity = parseFloat(document.getElementById('viscosity').value);
        const vbar = parseFloat(document.getElementById('vbar').value);
        const rho = parseFloat(document.getElementById('solventDensity').value);
        const time = parseFloat(document.getElementById('centrifugeTime').value);

        // Validate inputs
        if (isNaN(rpm) || rpm <= 0 || isNaN(radius) || radius <= 0) {
            showAlert('centrifugeResults', 'error', '轉速和轉子半徑必須大於 0');
            return;
        }
        if (isNaN(mw) || mw <= 0) {
            showAlert('centrifugeResults', 'error', '分子量必須大於 0');
            return;
        }
        if (isNaN(viscosity) || viscosity <= 0 || isNaN(vbar) || vbar <= 0 || isNaN(rho) || rho <= 0) {
            showAlert('centrifugeResults', 'error', '黏度、部分比容和溶劑密度必須大於 0');
            return;
        }
        if (isNaN(time) || time <= 0) {
            showAlert('centrifugeResults', 'error', '離心時間必須大於 0');
            return;
        }

        // Calculate RCF
        const rcf = SAXSCalculations.calculateRCF(rpm, radius);

        // Estimate particle radius from MW (assuming spherical protein)
        // R[cm] = (3 × v̄[cm³/g] × MW[g/mol] / (4π × NA[1/mol]))^(1/3)
        const NA = 6.022e23;
        const particleRadius = Math.pow(3 * vbar * mw / (4 * Math.PI * NA), 1 / 3) * 1e-2; // cm → m

        // Calculate sedimentation
        const sedResult = SAXSCalculations.calculateSedimentation(mw, viscosity, particleRadius, vbar, rho);

        // Calculate terminal velocity and distance
        const velocity = SAXSCalculations.calculateTerminalVelocity(rcf, sedResult.sedimentationCoeff);
        const distance = SAXSCalculations.calculateCentrifugationDistance(velocity, time);

        displayCentrifugeResults({
            rpm, radius, mw, viscosity, vbar, rho, time,
            rcf,
            particleRadius: particleRadius * 1e9, // nm
            ...sedResult,
            velocity,
            distance
        });
    });
}

function displayCentrifugeResults(data) {
    const resultsDiv = document.getElementById('centrifugeResults');

    resultsDiv.innerHTML = `
        <div class="result-grid">
            <div class="result-item" style="border-left-color: var(--color-accent-danger);">
                <div class="result-label">相對離心力 (RCF)</div>
                <div class="result-value">${data.rcf.toFixed(0)} <span style="font-size: 0.75rem;">× g</span></div>
            </div>
            <div class="result-item" style="border-left-color: var(--color-accent-danger);">
                <div class="result-label">沉降係數</div>
                <div class="result-value">${data.sedimentationCoeffSvedberg.toFixed(2)} <span style="font-size: 0.75rem;">S</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>粒子參數</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">估算粒子半徑</div>
                <div class="result-value">${data.particleRadius.toFixed(2)} <span style="font-size: 0.75rem;">nm</span></div>
                <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.25rem;">無水球近似；實際沉降係數約為此值的 0.75–0.85 倍（水合與形狀因子）</div>
            </div>
            <div class="result-item">
                <div class="result-label">浮力因子</div>
                <div class="result-value">${data.buoyancyFactor.toFixed(4)}</div>
            </div>
        </div>
        
        <div class="section-divider"><span>離心結果</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">終端速度</div>
                <div class="result-value">${(data.velocity * 1000).toFixed(4)} <span style="font-size: 0.75rem;">μm/s</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">移動距離 (${data.time} min)</div>
                <div class="result-value">${data.distance.toFixed(4)} <span style="font-size: 0.75rem;">mm</span></div>
            </div>
        </div>
        
        <div class="alert alert-info" style="margin-top: 1rem;">
            <strong>公式：</strong>RCF = 1.118 × 10⁻⁵ × r × N² <br>
            其中 r = ${data.radius} cm, N = ${data.rpm} rpm
        </div>
    `;

    // 把焦點帶到結果，鍵盤／螢幕閱讀器使用者才知道計算完成了
    A11y.focusResults('centrifugeResults');
}

// ========================
// Detector Distance Section
// ========================
function initDetectorSection() {
    const calculateBtn = document.getElementById('calculateDetectorBtn');
    const targetMwInput = document.getElementById('targetProteinMW');
    const targetRgInput = document.getElementById('targetProteinRg');
    const modeByMwBtn = document.getElementById('modeByMW');
    const modeByRgBtn = document.getElementById('modeByRg');
    const mwInputGroup = document.getElementById('mwInputGroup');
    const rgInputGroup = document.getElementById('rgInputGroup');
    const mwResultCard = document.getElementById('mwResultCard');
    const rgResultCard = document.getElementById('rgResultCard');

    let currentMode = 'mw'; // 'mw' or 'rg'

    function setMode(mode) {
        currentMode = mode;

        if (mode === 'mw') {
            modeByMwBtn.classList.add('active');
            modeByRgBtn.classList.remove('active');
            mwInputGroup.classList.remove('hidden');
            rgInputGroup.classList.add('hidden');
            mwResultCard.classList.add('hidden');
            rgResultCard.classList.remove('hidden');
        } else {
            modeByRgBtn.classList.add('active');
            modeByMwBtn.classList.remove('active');
            mwInputGroup.classList.add('hidden');
            rgInputGroup.classList.remove('hidden');
            mwResultCard.classList.remove('hidden');
            rgResultCard.classList.add('hidden');
        }

        calculateAndDisplayResults();
    }

    function calculateAndDisplayResults() {
        let result;

        if (currentMode === 'mw') {
            const mw = parseFloat(targetMwInput.value);
            if (isNaN(mw) || mw <= 0) return;
            result = SAXSCalculations.calculateDetectorDistance(mw, 'mw');
        } else {
            const rg = parseFloat(targetRgInput.value);
            if (isNaN(rg) || rg <= 0) return;
            result = SAXSCalculations.calculateDetectorDistance(rg, 'rg');
        }

        // Update display
        document.getElementById('detectorRgResult').textContent = result.rg.toFixed(2);
        document.getElementById('detectorQminResult').textContent = result.qmin.toFixed(4);
        document.getElementById('detectorSDResult').textContent = result.suggestedSD.toLocaleString();
        document.getElementById('detectorSDMeters').textContent = result.suggestedSDMeters.toFixed(2);
        document.getElementById('detectorMwResult').textContent = result.mw.toLocaleString();
    }

    // Mode toggle buttons
    if (modeByMwBtn) {
        modeByMwBtn.addEventListener('click', () => setMode('mw'));
    }
    if (modeByRgBtn) {
        modeByRgBtn.addEventListener('click', () => setMode('rg'));
    }

    // Calculate on button click
    if (calculateBtn) {
        calculateBtn.addEventListener('click', calculateAndDisplayResults);
    }

    // Auto-calculate on input change
    if (targetMwInput) {
        targetMwInput.addEventListener('input', calculateAndDisplayResults);
        targetMwInput.addEventListener('change', calculateAndDisplayResults);
    }
    if (targetRgInput) {
        targetRgInput.addEventListener('input', calculateAndDisplayResults);
        targetRgInput.addEventListener('change', calculateAndDisplayResults);
    }

    // Initial calculation with default value
    calculateAndDisplayResults();
}

// ========================
// IUCr Table Section
// ========================
function initIUCrSection() {
    const copyBtn = document.getElementById('copyIUCrTable');
    if (!copyBtn) return;

    copyBtn.addEventListener('click', async () => {
        const table = document.getElementById('iucrTable');
        if (!table) return;
        try {
            // Modern Clipboard API: copy table as both HTML and plain text
            const html = table.outerHTML;
            const text = table.innerText;
            if (navigator.clipboard && navigator.clipboard.write) {
                const blob = new Blob([html], { type: 'text/html' });
                const textBlob = new Blob([text], { type: 'text/plain' });
                await navigator.clipboard.write([
                    new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
                ]);
            } else {
                await navigator.clipboard.writeText(text);
            }
            copyBtn.textContent = '✓ 已複製';
            setTimeout(() => {
                copyBtn.textContent = '複製表格';
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            const range = document.createRange();
            range.selectNode(table);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            try {
                document.execCommand('copy');
                copyBtn.textContent = '✓ 已複製';
                setTimeout(() => {
                    copyBtn.textContent = '複製表格';
                }, 2000);
            } catch (fallbackErr) {
                copyBtn.textContent = '複製失敗';
                setTimeout(() => {
                    copyBtn.textContent = '複製表格';
                }, 2000);
            }
            window.getSelection().removeAllRanges();
        }
    });
}

/**
 * IUCr 表格用的數值格式化。
 *
 * `value?.toFixed(d) || '-'` 對 NaN 無效：NaN.toFixed(5) 回傳字串 "NaN"（truthy），
 * 未填欄位會被直接抄進投稿用的 SAS 資料表。
 *
 * @param {number} value - 數值
 * @param {number} digits - 小數位數
 * @returns {string} 格式化字串，非有限值一律 '-'
 */
function formatIUCrValue(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function updateIUCrTable() {
    const protein = AppState.proteinData;
    const saxs = AppState.saxsData;
    const fmt = formatIUCrValue;
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    // Update protein info
    if (protein) {
        setText('iucr-protein', protein.name || '-');
        setText('iucr-dryvol', fmt(protein.dryVolume, 1));
        setText('iucr-vbar', fmt(protein.partialSpecificVolume, 6));
        setText('iucr-mw-seq', fmt(protein.molecularWeight, 2));
    }

    // Update SAXS data
    if (saxs) {
        setText('iucr-wavelength', fmt(saxs.wavelength, 5));
        setText('iucr-concentration', Number.isFinite(saxs.concentration) ? String(saxs.concentration) : '-');
        setText('iucr-i0-pr', fmt(saxs.i0Pr, 5));
        setText('iucr-rg-pr', fmt(saxs.rgPr, 2));
        setText('iucr-i0-guinier', fmt(saxs.i0Guinier, 5));
        setText('iucr-rg-guinier', fmt(saxs.rgGuinier, 2));
        setText('iucr-dmax', Number.isFinite(saxs.dmax) ? String(saxs.dmax) : '-');
        // 固定 en-US：中文語系的 toLocaleString() 會把 NaN 印成「非數值」，
        // 且千分位格式不應隨瀏覽器語系變動
        setText('iucr-porod', Number.isFinite(saxs.porodVolume)
            ? saxs.porodVolume.toLocaleString('en-US') : '-');
        setText('iucr-mw-porod', fmt(saxs.mwFromPorod, 0));
    }

    // Hide warning if data is available
    if (protein || saxs) {
        document.getElementById('iucrWarning').classList.add('hidden');
    }
}

// ========================
// Utility Functions
// ========================
function showAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    if (!container) return;
    A11y.markLiveRegion(container, type);
    container.innerHTML =
        `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
}

/**
 * 清空提示容器（計算成功後不要留著上一次的錯誤訊息）。
 *
 * @param {string} containerId - 容器 id
 * @returns {void}
 */
function clearAlert(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================
// localStorage Persistence
// ========================
const STORAGE_KEY = 'tps13a-form-state';

// 永不持久化：檔案欄位（無意義）與密碼欄位（光束線是共用電腦，明文外洩）
const PERSIST_SKIP_TYPES = Object.freeze(['file', 'password']);
const PERSIST_SKIP_IDS = Object.freeze(['dndcPasswordInput']);

// 還原後需要補派 input 事件的欄位（其衍生顯示不會在 init 時自行重算）
const PERSIST_DERIVED_IDS = Object.freeze([
    'proteinSequence',    // → 序列長度
    'hplcPeakCenter',     // → 10 μL 建議值
    'hplcPeakFWHM',       // → 10 μL 建議值
    'retentionTimeInput'  // → RT → MW
]);

// 還原（與還原後補派的 input 事件）期間暫停自動存檔，否則 savedAt 會被改寫成
// 「這次開啟頁面的時間」，提示條上的時間就永遠是現在。
let suppressAutoSave = false;

/**
 * 在暫停自動存檔的狀態下執行 fn。
 *
 * @param {function(): void} fn - 要執行的動作
 * @returns {void}
 */
function withAutoSaveSuppressed(fn) {
    const previous = suppressAutoSave;
    suppressAutoSave = true;
    try {
        fn();
    } finally {
        suppressAutoSave = previous;
    }
}

/**
 * 這個欄位可以被持久化嗎？
 *
 * @param {HTMLElement} el - 表單元素
 * @returns {boolean} 可持久化為 true
 */
function isPersistableField(el) {
    return !PERSIST_SKIP_TYPES.includes(el.type) && !PERSIST_SKIP_IDS.includes(el.id);
}

/**
 * 取得欄位的預設值。
 *
 * <select> 沒有 defaultValue 屬性（回 undefined），若直接比對會讓每一個下拉都被
 * 當成「已被使用者改過」而存檔，還原提示條就會每次開頁都出現。改為比對 HTML 上
 * 標了 selected 的選項（沒有的話就是第一個選項）。
 *
 * @param {HTMLElement} el - 表單元素
 * @returns {string} 預設值字串
 */
function fieldDefaultValue(el) {
    if (el.tagName !== 'SELECT') return el.defaultValue;
    const preselected = Array.from(el.options).find(opt => opt.defaultSelected) || el.options[0];
    return preselected ? preselected.value : '';
}

function saveFormState() {
    const values = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
        if (!isPersistableField(el)) return;
        // 只存「偏離預設值」的欄位：checkbox / select 若無條件存檔，存過一次之後
        // 每次開頁都會被判定成「有還原內容」而彈出提示條
        if (el.type === 'checkbox') {
            if (el.checked !== el.defaultChecked) values[el.id] = el.checked;
        } else if (el.value !== '' && el.value !== fieldDefaultValue(el)) {
            values[el.id] = el.value;
        }
    });
    safeStorage.set(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), values }));
}

/**
 * 讀取存檔（相容 v4.6 之前的扁平格式），並一次性清掉曾經落地的敏感欄位。
 *
 * @returns {{savedAt: string|null, values: object}|null} 解析結果
 */
function readFormState() {
    const raw = safeStorage.get(STORAGE_KEY);
    if (!raw) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.warn('[form-state] 存檔格式損壞，已清除:', err.message);
        safeStorage.remove(STORAGE_KEY);
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const hasEnvelope = parsed.values && typeof parsed.values === 'object';
    const rawValues = hasEnvelope ? parsed.values : parsed;
    const savedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : null;

    // 一次性清理：舊版本可能已把明文密碼寫進 localStorage
    const leaked = PERSIST_SKIP_IDS.filter(id => id in rawValues);
    const values = { ...rawValues };
    if (leaked.length > 0) {
        leaked.forEach(id => { delete values[id]; });
        safeStorage.set(STORAGE_KEY, JSON.stringify({ savedAt, values }));
    }

    return { savedAt, values };
}

/**
 * 把 ISO 時間字串格式化成 YYYY-MM-DD HH:mm。
 *
 * @param {string|null} iso - ISO 時間字串
 * @returns {string} 顯示字串（無法解析時回 '先前'）
 */
function formatSavedAt(iso) {
    if (!iso) return '先前';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '先前';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 顯示「已還原上次輸入值」提示條，附清除與關閉按鈕。
 *
 * 光束線工作站多人共用同一個瀏覽器 profile，靜默把上一位使用者的參數填回
 * 欄位是實際會造成錯誤科學結論的資料完整性風險。
 *
 * @param {string|null} savedAt - 存檔時間（ISO）
 * @returns {void}
 */
function showRestoreNotice(savedAt) {
    const main = document.getElementById('main-content');
    if (!main) return;

    const existing = document.getElementById('restoreNotice');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.id = 'restoreNotice';
    notice.className = 'alert alert-info';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1rem;';

    const text = document.createElement('span');
    text.style.flex = '1 1 20rem';
    text.textContent = `已還原 ${formatSavedAt(savedAt)} 儲存的輸入值，請確認是否為本次樣品的參數。`;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-sm btn-secondary';
    clearBtn.textContent = '清除已儲存的輸入';
    clearBtn.addEventListener('click', () => {
        safeStorage.remove(STORAGE_KEY);
        window.location.reload();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-sm btn-secondary';
    closeBtn.setAttribute('aria-label', '關閉還原提示');
    closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', () => notice.remove());

    notice.append(text, clearBtn, closeBtn);
    main.prepend(notice);
}

/**
 * 還原後補派 input 事件，讓衍生顯示（序列長度、建議值、RT→MW）與欄位一致。
 *
 * 延到目前這個 task 之後執行：initFormPersistence 是 DOMContentLoaded 的第一個
 * 呼叫，此時其他區段的事件監聽器都還沒綁定。
 *
 * @param {string[]} restoredIds - 實際被還原的欄位 id
 * @returns {void}
 */
function dispatchDerivedUpdates(restoredIds) {
    const targets = PERSIST_DERIVED_IDS.filter(id => restoredIds.includes(id));
    if (targets.length === 0) return;

    setTimeout(() => {
        withAutoSaveSuppressed(() => {
            targets.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    }, 0);
}

function restoreFormState() {
    const state = readFormState();
    if (!state) return;

    const restoredIds = [];
    withAutoSaveSuppressed(() => {
        Object.entries(state.values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (!el || !isPersistableField(el)) return;
            if (el.type === 'checkbox') {
                el.checked = Boolean(value);
            } else {
                el.value = value;
            }
            restoredIds.push(id);
        });
    });

    if (restoredIds.length === 0) return;
    showRestoreNotice(state.savedAt);
    dispatchDerivedUpdates(restoredIds);
}

function initFormPersistence() {
    restoreFormState();

    // Debounced auto-save on any input change（還原期間不計入）
    let saveTimer = null;
    const scheduleSave = () => {
        if (suppressAutoSave) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveFormState, 500);
    };
    document.addEventListener('input', scheduleSave);
    document.addEventListener('change', scheduleSave);
}

// ========================
// Initialize Application
// ========================
document.addEventListener('DOMContentLoaded', () => {
    initFormPersistence();
    initNavigation();
    initProteinSection();
    initSAXSSection();
    initHPLCSection();
    initSampleSection();
    initMWSection();
    initCentrifugeSection();
    initDetectorSection();
    initIUCrSection();
    initDndcLock();
});
