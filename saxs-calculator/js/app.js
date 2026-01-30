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
    charts: {}
};

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

            // Close mobile menu if open
            document.getElementById('sidebar').classList.remove('open');
        });
    });

    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
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

    // Load sample sequence (from Excel)
    loadSampleBtn.addEventListener('click', () => {
        const sampleSequence = `GASMSKRKAPQETLNGGITDMLVELANFEKNVSQAIHKYNAYRKAASVIAKYPHKIKSGAEAKKLPGVGTKIAEKIDEFLATGKLRKLEKIRQDDTSSSINFLTRVTGIGPSAARKLVDEGIKTLEDLRKNEDKLNHHQRIGLKYFEDFEKRIPREEMLQMQDIVLNEVKKLDPEYIATVCGSFRRGAESSGDMDVLLTHPNFTSESSKQPKLLHRVVEQLQKVRFITDTLSKGETKFMGVCQLPSENDENEYPHRRIDIRLIPKDQYYCGVLYFTGSDIFNKNMRAHALEKGFTINEYTIRPLGVTGVAGEPLPVDSEQDIFDYIQWRYREPKDRSE`;
        sequenceInput.value = sampleSequence;
        document.getElementById('proteinName').value = 'Sample Protein';
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
            document.getElementById('chartContainer-bar').style.display =
                chartType === 'bar' ? 'block' : 'none';
            document.getElementById('chartContainer-doughnut').style.display =
                chartType === 'doughnut' ? 'block' : 'none';
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
                <div class="result-label">部分比容 v̄</div>
                <div class="result-value">${result.partialSpecificVolume.toFixed(4)} <span style="font-size: 0.75rem;">cm³/g</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">dn/dc</div>
                <div class="result-value">${result.dndc.toFixed(4)} <span style="font-size: 0.75rem;">mL/g</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>消光係數 (280 nm)</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">ε (M⁻¹ cm⁻¹)</div>
                <div class="result-value">${result.extinction.epsilon.toLocaleString()}</div>
            </div>
            <div class="result-item">
                <div class="result-label">ε (cm² g⁻¹)</div>
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
}

function displayProteinStats(result) {
    const statsDiv = document.getElementById('proteinStats');
    statsDiv.style.display = 'grid';

    statsDiv.innerHTML = `
        <div class="stat-card">
            <div class="stat-icon primary">⚖️</div>
            <div class="stat-content">
                <div class="stat-label">分子量</div>
                <div class="stat-value">${result.molecularWeightKDa.toFixed(2)}<span class="stat-unit">kDa</span></div>
                <div class="stat-sub">${result.molecularWeight.toFixed(0)} Da</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon success">📏</div>
            <div class="stat-content">
                <div class="stat-label">序列長度</div>
                <div class="stat-value">${result.length}<span class="stat-unit">殘基</span></div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon warning">📦</div>
            <div class="stat-content">
                <div class="stat-label">乾燥體積</div>
                <div class="stat-value">${(result.dryVolume / 1000).toFixed(1)}<span class="stat-unit">×10³ Å³</span></div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon danger">🔬</div>
            <div class="stat-content">
                <div class="stat-label">消光係數 ε</div>
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
    compositionCard.style.display = 'block';

    // Create bar chart
    AppState.charts.bar = SAXSCharts.createCompositionBarChart('compositionBarChart', composition);

    // Create doughnut chart
    AppState.charts.doughnut = SAXSCharts.createCompositionChart('compositionDoughnutChart', composition);
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
    const centrifugeMw = document.getElementById('centrifugeMw');
    const vbar = document.getElementById('vbar');
    if (centrifugeMw) centrifugeMw.value = result.molecularWeight.toFixed(0);
    if (vbar) vbar.value = result.partialSpecificVolume.toFixed(4);

    // Update MW Resolution form
    const mwResolutionInput = document.getElementById('mwInput');
    if (mwResolutionInput) mwResolutionInput.value = result.molecularWeight.toFixed(2);
}

// ========================
// SAXS Parameters Section
// ========================
function initSAXSSection() {
    const calculateBtn = document.getElementById('calculateSAXS');
    const concentrationInput = document.getElementById('sampleConcentration');
    const theoreticalI0Display = document.getElementById('theoreticalI0Display');
    const theoreticalRgDisplay = document.getElementById('theoreticalRgDisplay');
    const predictedRgDisplay = document.getElementById('predictedRgDisplay');
    const theoreticalDmaxDisplay = document.getElementById('theoreticalDmaxDisplay');
    const theoreticalMWSource = document.getElementById('theoreticalMWSource');

    // Function to update all theoretical values display
    function updateTheoreticalValues() {
        const concentration = parseFloat(concentrationInput.value) || 1.0;
        const proteinMw = AppState.proteinData?.molecularWeight;

        if (proteinMw) {
            // Calculate all theoretical parameters at once
            const result = SAXSCalculations.calculateAllTheoreticalParams(proteinMw, concentration, 'globular');

            if (theoreticalI0Display) {
                theoreticalI0Display.textContent = result.theoreticalI0.toExponential(2);
            }
            if (theoreticalRgDisplay) {
                theoreticalRgDisplay.textContent = result.theoreticalRg.toFixed(1);
            }
            if (predictedRgDisplay) {
                predictedRgDisplay.textContent = result.predictedRg.toFixed(2);
            }
            if (theoreticalDmaxDisplay) {
                theoreticalDmaxDisplay.textContent = result.theoreticalDmax.toFixed(0);
            }
            if (theoreticalMWSource) {
                theoreticalMWSource.textContent = `MW: ${proteinMw.toFixed(0)} Da`;
            }
        } else {
            if (theoreticalI0Display) theoreticalI0Display.textContent = '--';
            if (theoreticalRgDisplay) theoreticalRgDisplay.textContent = '--';
            if (predictedRgDisplay) predictedRgDisplay.textContent = '--';
            if (theoreticalDmaxDisplay) theoreticalDmaxDisplay.textContent = '--';
            if (theoreticalMWSource) theoreticalMWSource.textContent = '請先分析序列';
        }
    }

    // Update theoretical values when concentration changes
    if (concentrationInput) {
        concentrationInput.addEventListener('input', updateTheoreticalValues);
    }

    // Initial update if protein data exists
    updateTheoreticalValues();

    calculateBtn.addEventListener('click', () => {
        const concentration = parseFloat(document.getElementById('sampleConcentration').value);
        const xrayEnergy = parseFloat(document.getElementById('xrayEnergy').value);
        const i0Guinier = parseFloat(document.getElementById('i0Guinier').value);
        const rgGuinier = parseFloat(document.getElementById('rgGuinier').value);
        const i0Pr = parseFloat(document.getElementById('i0Pr').value);
        const rgPr = parseFloat(document.getElementById('rgPr').value);
        const dmax = parseFloat(document.getElementById('dmax').value);
        const porodVolume = parseFloat(document.getElementById('porodVolume').value);

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
            theoreticalParams = SAXSCalculations.calculateAllTheoreticalParams(proteinMw, concentration, 'globular');
        }

        // Store SAXS data
        AppState.saxsData = {
            concentration,
            wavelength,
            xrayEnergy,
            i0Guinier,
            rgGuinier,
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
    const theoreticalMWSource = document.getElementById('theoreticalMWSource');

    // Detector distance elements
    const detectorDistanceSource = document.getElementById('detectorDistanceSource');
    const suggestedQminDisplay = document.getElementById('suggestedQminDisplay');
    const suggestedSDDisplay = document.getElementById('suggestedSDDisplay');
    const suggestedQrangeDisplay = document.getElementById('suggestedQrangeDisplay');

    if (!concentrationInput) return;

    const concentration = parseFloat(concentrationInput.value) || 1.0;
    const proteinMw = AppState.proteinData?.molecularWeight;

    if (proteinMw) {
        const result = SAXSCalculations.calculateAllTheoreticalParams(proteinMw, concentration, 'globular');

        if (theoreticalI0Display) {
            theoreticalI0Display.textContent = result.theoreticalI0.toExponential(2);
        }
        if (theoreticalRgDisplay) {
            theoreticalRgDisplay.textContent = result.theoreticalRg.toFixed(1);
        }
        if (predictedRgDisplay) {
            predictedRgDisplay.textContent = result.predictedRg.toFixed(2);
        }
        if (theoreticalDmaxDisplay) {
            theoreticalDmaxDisplay.textContent = result.theoreticalDmax.toFixed(0);
        }
        if (theoreticalMWSource) {
            theoreticalMWSource.textContent = `MW: ${proteinMw.toFixed(0)} Da`;
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
                <div class="result-label">I(0) from Guinier</div>
                <div class="result-value">${isNaN(data.i0Guinier) ? '-' : data.i0Guinier.toFixed(5)} <span style="font-size: 0.75rem;">cm⁻¹</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">Rg from Guinier</div>
                <div class="result-value">${isNaN(data.rgGuinier) ? '-' : data.rgGuinier.toFixed(2)} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>P(r) 分析</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">I(0) from P(r)</div>
                <div class="result-value">${isNaN(data.i0Pr) ? '-' : data.i0Pr.toFixed(5)} <span style="font-size: 0.75rem;">cm⁻¹</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">Rg from P(r)</div>
                <div class="result-value">${isNaN(data.rgPr) ? '-' : data.rgPr.toFixed(2)} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
            <div class="result-item">
                <div class="result-label">Dmax</div>
                <div class="result-value">${isNaN(data.dmax) ? '-' : data.dmax} <span style="font-size: 0.75rem;">Å</span></div>
            </div>
        </div>
        
        <div class="section-divider"><span>體積與分子量</span></div>
        
        <div class="result-grid">
            <div class="result-item">
                <div class="result-label">Porod Volume</div>
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
        </div>
        
        ${data.mwFromPorod && proteinMw ? `
        <div class="alert ${Math.abs(data.mwFromPorod - proteinMw) / proteinMw < 0.2 ? 'alert-success' : 'alert-warning'}" style="margin-top: 1rem;">
            <strong>MW 比較：</strong>Porod / 序列 = ${(data.mwFromPorod / proteinMw).toFixed(2)}
            ${Math.abs(data.mwFromPorod - proteinMw) / proteinMw < 0.2 ?
                '✓ 符合預期 (單體)' :
                '⚠️ 可能有聚集或複合物形成'}
        </div>
        ` : ''}
    `;
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
        const peakCenter = parseFloat(document.getElementById('hplcPeakCenter').value);
        const peakFWHM = parseFloat(document.getElementById('hplcPeakFWHM').value);
        const injectionVolume = parseFloat(document.getElementById('hplcInjectionVolume').value);
        const targetFlowRate = parseFloat(document.getElementById('hplcTargetFlowRate').value);
        const initialFlowRate = parseFloat(document.getElementById('hplcInitialFlowRate').value);

        // Validate inputs
        if (isNaN(peakCenter) || isNaN(peakFWHM) || isNaN(injectionVolume) ||
            isNaN(targetFlowRate) || isNaN(initialFlowRate)) {
            alert('請填寫所有必要參數');
            return;
        }

        // Calculate HPLC-SAXS settings
        const result = SAXSCalculations.calculateHPLCSAXSSettings({
            peakCenter,
            peakFWHM,
            injectionVolume,
            targetFlowRate,
            initialFlowRate
        });

        // Calculate suggested values for 10μL pre-run
        const suggested = SAXSCalculations.calculateSuggestedParams(peakCenter, peakFWHM);

        // Display results
        displayHPLCSAXSResults(result, suggested);
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
            <tr${row.note ? ' style="background: rgba(var(--color-primary-rgb), 0.1);"' : ''}>
                <td>${row.time.toFixed(2)}</td>
                <td>${row.flowRate.toFixed(3)}</td>
                <td style="color: ${row.note ? 'var(--color-primary)' : 'var(--color-text-muted)'}; font-weight: ${row.note ? '600' : '400'};">${row.note || '-'}</td>
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

    if (fractionStartTime) fractionStartTime.textContent = result.fractionCollector.startTime.toFixed(1);
    if (fractionStopTime) fractionStopTime.textContent = result.fractionCollector.stopTime.toFixed(1);
    if (timePerFraction) timePerFraction.textContent = result.fractionCollector.timePerFraction.toFixed(1);

    // Update Detector Settings Table
    const detectorTableBody = document.getElementById('detectorSettingsTableBody');
    if (detectorTableBody) {
        detectorTableBody.innerHTML = result.detectorSettings.map(row => {
            // Highlight step 4 (main data collection)
            const isMainStep = row.step === 4;
            const rowStyle = isMainStep ? 'background: rgba(245, 158, 11, 0.15);' : '';
            const frameStyle = isMainStep ? 'color: #f59e0b; font-weight: 700;' : '';

            return `
                <tr style="${rowStyle}">
                    <td>${row.step}</td>
                    <td style="color: ${row.mode === 'TM' ? '#3b82f6' : '#10b981'}; font-weight: 600;">${row.mode}</td>
                    <td style="${frameStyle}">${row.frame}</td>
                    <td>${row.wait}</td>
                    <td>${row.exposure}</td>
                    <td>${row.hold}</td>
                </tr>
            `;
        }).join('');
    }

    console.log('HPLC-SAXS Settings calculated:', result);
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
        const absorbance = parseFloat(document.getElementById('uvAbsorbance').value);
        const pathLength = parseFloat(document.getElementById('pathLength').value);
        const epsilon = parseFloat(document.getElementById('inputEpsilon').value);
        const mw = parseFloat(document.getElementById('inputMw').value);

        if (isNaN(absorbance) || isNaN(epsilon) || isNaN(mw)) {
            showAlert('sampleResults', 'error', '請填入所有必要參數');
            return;
        }

        const concentration = SAXSCalculations.calculateConcentrationFromUV(
            absorbance, epsilon, pathLength, mw
        );

        displaySampleResults({
            absorbance,
            pathLength,
            epsilon,
            mw,
            concentration,
            concentrationMolar: (concentration * 1000 / mw) * 1e6 // μM
        });
    });
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
                <div class="result-value">${data.epsilon.toLocaleString()} M⁻¹cm⁻¹</div>
            </div>
            <div class="result-item">
                <div class="result-label">分子量</div>
                <div class="result-value">${data.mw.toFixed(2)} Da</div>
            </div>
        </div>
    `;
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

        // Calculate RCF
        const rcf = SAXSCalculations.calculateRCF(rpm, radius);

        // Estimate particle radius from MW (assuming spherical protein)
        // R ≈ (3 × v̄ × MW / (4π × NA))^(1/3)
        const NA = 6.022e23;
        const particleRadius = Math.pow(3 * vbar * mw / (4 * Math.PI * NA * 1e-3), 1 / 3) * 1e-2; // m

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
            // MW → Rg mode
            modeByMwBtn.style.background = 'var(--color-primary)';
            modeByMwBtn.style.color = 'white';
            modeByMwBtn.style.border = 'none';
            modeByRgBtn.style.background = 'var(--color-bg-tertiary)';
            modeByRgBtn.style.color = 'var(--color-text)';
            modeByRgBtn.style.border = '1px solid var(--color-border)';

            mwInputGroup.style.display = 'block';
            rgInputGroup.style.display = 'none';
            mwResultCard.style.display = 'none';
            rgResultCard.style.display = 'block';
        } else {
            // Rg → MW mode
            modeByRgBtn.style.background = 'var(--color-primary)';
            modeByRgBtn.style.color = 'white';
            modeByRgBtn.style.border = 'none';
            modeByMwBtn.style.background = 'var(--color-bg-tertiary)';
            modeByMwBtn.style.color = 'var(--color-text)';
            modeByMwBtn.style.border = '1px solid var(--color-border)';

            mwInputGroup.style.display = 'none';
            rgInputGroup.style.display = 'block';
            mwResultCard.style.display = 'block';
            rgResultCard.style.display = 'none';
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

    copyBtn.addEventListener('click', () => {
        const table = document.getElementById('iucrTable');
        const range = document.createRange();
        range.selectNode(table);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);

        try {
            document.execCommand('copy');
            copyBtn.textContent = '✓ 已複製';
            setTimeout(() => {
                copyBtn.textContent = '📋 複製表格';
            }, 2000);
        } catch (err) {
            console.error('Copy failed:', err);
        }

        window.getSelection().removeAllRanges();
    });
}

function updateIUCrTable() {
    const protein = AppState.proteinData;
    const saxs = AppState.saxsData;

    // Update protein info
    if (protein) {
        document.getElementById('iucr-protein').textContent = protein.name || '-';
        document.getElementById('iucr-dryvol').textContent = protein.dryVolume?.toFixed(1) || '-';
        document.getElementById('iucr-vbar').textContent = protein.partialSpecificVolume?.toFixed(6) || '-';
        document.getElementById('iucr-mw-seq').textContent = protein.molecularWeight?.toFixed(2) || '-';
    }

    // Update SAXS data
    if (saxs) {
        document.getElementById('iucr-wavelength').textContent = saxs.wavelength?.toFixed(5) || '-';
        document.getElementById('iucr-concentration').textContent = saxs.concentration || '-';
        document.getElementById('iucr-i0-pr').textContent = saxs.i0Pr?.toFixed(5) || '-';
        document.getElementById('iucr-rg-pr').textContent = saxs.rgPr?.toFixed(2) || '-';
        document.getElementById('iucr-i0-guinier').textContent = saxs.i0Guinier?.toFixed(5) || '-';
        document.getElementById('iucr-rg-guinier').textContent = saxs.rgGuinier?.toFixed(2) || '-';
        document.getElementById('iucr-dmax').textContent = saxs.dmax || '-';
        document.getElementById('iucr-porod').textContent = saxs.porodVolume?.toLocaleString() || '-';
        document.getElementById('iucr-mw-porod').textContent = saxs.mwFromPorod?.toFixed(0) || '-';
    }

    // Hide warning if data is available
    if (protein || saxs) {
        document.getElementById('iucrWarning').style.display = 'none';
    }
}

// ========================
// Utility Functions
// ========================
function showAlert(containerId, type, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================
// Initialize Application
// ========================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initProteinSection();
    initSAXSSection();
    initHPLCSection();
    initSampleSection();
    initMWSection();
    initCentrifugeSection();
    initDetectorSection();
    initIUCrSection();

    console.log('TPS13A SAXS Calculator initialized');
});
