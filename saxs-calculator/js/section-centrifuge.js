/**
 * TPS13A SAXS Calculator - Centrifuge Section
 * 離心參數區段：RCF ↔ RPM 換算與轉子參數。
 */

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
