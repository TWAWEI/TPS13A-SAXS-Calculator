/**
 * TPS13A SAXS Calculator - Detector Distance Section
 * 偵測器距離區段：q 範圍與樣品-偵測器距離建議。
 */

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
