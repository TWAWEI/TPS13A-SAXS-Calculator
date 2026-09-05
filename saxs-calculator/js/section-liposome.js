/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：三個面板的 UI 與狀態
 *
 * 流程（規格 §2）：面板 1 稀釋因子 → 面板 2 光譜扣背景與讀值 → 面板 3 D/L → 加入結果表。
 *
 * 狀態規則（規格 §3、§7）：
 *   - 輸入框是真值，state 是鏡像：lipoDilutionFactor / lipoAbs1–3 每次 input 都同步回 state
 *   - state.dl 是快照，只在「計算 D/L」成功時建立；INVALIDATING_IDS 任一 input 事件就作廢
 *     並停用「加入結果表」，直到下一次計算成功
 *   - 錯誤：showAlert 取代結果區；輸入值、chip、圖表不動
 *   - 成功：渲染函式自組 HTML（含警告列），再 A11y.focusResults
 *
 * 依賴：LiposomeCalculations、LiposomeFileParsers、LiposomeCharts、LiposomeResultsTable、
 *       DndcFileParser.readFile、FormUtils、A11y、showAlert、downloadChartPng。
 */
(function attachLiposomeSection(global) {
    'use strict';

    const Calc = () => global.LiposomeCalculations;
    const Parsers = () => global.LiposomeFileParsers;
    const Charts = () => global.LiposomeCharts;
    const Table = () => global.LiposomeResultsTable;
    const esc = (v) => global.FormUtils.escapeHtml(v);

    const INVALIDATING_IDS = Object.freeze([
        'lipoDilutionFactor', 'lipoAbs1', 'lipoAbs2', 'lipoAbs3',
        'lipoWl1', 'lipoWl2', 'lipoWl3', 'lipoLipidConc', 'lipoEpsilon', 'lipoPathLength',
    ]);

    const SOURCE_LABEL = Object.freeze({ saxs: 'SAXS 計算', manual: '手動', spectrum: '光譜讀值' });

    const initialState = () => Object.freeze({
        dilution: Object.freeze({ factor: null, sd: 0, n: 0, lsqScale: null, source: null }),
        spectra: null,
        absorbance: Object.freeze({ values: Object.freeze([null, null, null]), sd: 0, source: null }),
        dl: null,
    });

    let state = initialState();
    const els = {};

    function setState(patch) {
        state = Object.freeze({ ...state, ...patch });
    }

    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------ 共用小工具
    function setChip(chip, source) {
        if (!chip) return;
        if (!source) { chip.hidden = true; return; }
        chip.hidden = false;
        chip.textContent = SOURCE_LABEL[source];
        chip.className = `info-panel-chip${source === 'manual' ? ' info-panel-chip--manual' : ''}`;
    }

    function setAddEnabled(enabled) {
        if (els.addResult) els.addResult.disabled = !enabled;
    }

    function invalidateDl() {
        if (state.dl) setState({ dl: null });
        setAddEnabled(false);
    }

    function warningRow(text) {
        return `<div class="alert alert-warning mt-sm">${esc(text)}</div>`;
    }

    function resultItem(label, value, unit = '') {
        return `<div class="result-item"><div class="result-label">${esc(label)}</div><div class="result-value">${value}${unit ? ` <span class="stat-unit">${esc(unit)}</span>` : ''}</div></div>`;
    }

    function pct(rel) {
        return `${(rel * 100).toFixed(2)}%`;
    }

    /** 讀檔（含大小上限），回 Promise<string>。 */
    function readChecked(input, label) {
        const file = input && input.files && input.files[0];
        if (!file) throw new Error(`請先選擇${label}檔案`);
        if (file.size > Parsers().LIMITS.MAX_BYTES) {
            throw new Error(`${label}檔案 ${(file.size / 1048576).toFixed(1)} MB 超過上限 5 MB`);
        }
        return global.DndcFileParser.readFile(file);
    }

    function syncButtons() {
        if (els.computeDilution) {
            els.computeDilution.disabled = !(els.solutionFile?.files?.length && els.bypassFile?.files?.length);
        }
        if (els.computeSpectra) {
            els.computeSpectra.disabled = !(els.loadedFile?.files?.length && els.blankFile?.files?.length);
        }
        if (els.dilutionPng) els.dilutionPng.disabled = !Charts().getChart('lipoDilutionChart');
        if (els.spectraPng) els.spectraPng.disabled = !Charts().getChart('lipoSpectraChart');
        if (els.fitPng) els.fitPng.hidden = !(state.spectra && state.spectra.fit);
    }

    // ------------------------------------------------------------ 面板 1：稀釋因子
    function syncFactorEcho() {
        if (!els.factorEcho) return;
        const d = state.dilution;
        if (!(d.factor > 0)) { els.factorEcho.textContent = '尚未設定稀釋因子'; return; }
        if (d.source === 'saxs') {
            els.factorEcho.textContent = `SAXS 計算：${d.factor.toPrecision(4)} ± ${d.sd.toPrecision(2)}（n = ${d.n}）`;
        } else {
            els.factorEcho.textContent = `手動因子 ${d.factor.toPrecision(4)}，無離散度（誤差只含 UV 項）`;
        }
    }

    function renderDilutionResults(r, qMin, qMax) {
        const rel = Math.abs(r.lsqScale / r.factor - 1);
        const warn = rel > Calc().DEFAULTS.LSQ_WARN_REL
            ? warningRow(`逐點平均與最小平方縮放相差 ${pct(rel)}，請確認 q 視窗內兩曲線形狀一致`)
            : '';
        const excluded = r.excluded.outOfRange + r.excluded.nonPositive;
        els.dilutionResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">稀釋因子（I_bypass / I_solution 逐點平均）</div>
                    <div class="stat-value">${r.factor.toPrecision(4)} <span class="stat-unit">± ${r.sd.toPrecision(2)}</span></div>
                    <div class="stat-sub">q ${qMin}–${qMax} Å⁻¹，n = ${r.n}，相對離散 ${pct(r.sd / r.factor)}</div>
                </div>
            </div>
            <div class="result-grid mt-sm">
                ${resultItem('最小平方縮放（PRIMUS I Scale 等價）', r.lsqScale.toPrecision(4))}
                ${resultItem('排除點', String(excluded), excluded ? `超出範圍 ${r.excluded.outOfRange}、非正 ${r.excluded.nonPositive}` : '')}
            </div>
            ${warn}`;
        global.A11y.focusResults('lipoDilutionResults');
    }

    async function onComputeDilution() {
        try {
            const [solText, bypText] = await Promise.all([
                readChecked(els.solutionFile, ' solution cell '),
                readChecked(els.bypassFile, ' bypass '),
            ]);
            const solution = Parsers().parseSaxsDat(solText);
            const bypass = Parsers().parseSaxsDat(bypText);
            const qMin = global.FormUtils.readPositiveField('lipoQMin', 'q 下限');
            const qMax = global.FormUtils.readPositiveField('lipoQMax', 'q 上限');
            const r = Calc().computeDilutionFactor(solution, bypass, { qMin, qMax });

            setState({ dilution: { factor: r.factor, sd: r.sd, n: r.n, lsqScale: r.lsqScale, source: 'saxs' } });
            invalidateDl();
            els.factor.value = r.factor.toPrecision(6);
            setChip(els.factorChip, 'saxs');
            syncFactorEcho();
            renderDilutionResults(r, qMin, qMax);
            Charts().renderDilutionChart('lipoDilutionChart', { solution, bypass, factor: r.factor, qMin, qMax });
            global.A11y.describeChart('lipoDilutionChart',
                `log-log 疊圖：solution cell、bypass、bypass 除以 ${r.factor.toPrecision(4)}；q 視窗 ${qMin}–${qMax}`);
            syncButtons();
        } catch (err) {
            global.showAlert('lipoDilutionResults', 'error', err.message);
        }
    }

    function onFactorInput() {
        const v = parseFloat(els.factor.value);
        setState({ dilution: { ...state.dilution, factor: Number.isFinite(v) ? v : null, sd: 0, n: 0, source: 'manual' } });
        setChip(els.factorChip, 'manual');
        syncFactorEcho();
    }

    // ------------------------------------------------------------ 面板 2：光譜
    function currentWavelengths() {
        return [els.wl1, els.wl2, els.wl3].map((el, k) =>
            global.FormUtils.parsePositiveNumber(el.value, `讀值波長 ${k + 1}`));
    }

    function updateAbsSummary() {
        if (!els.absSummary) return;
        const a = state.absorbance;
        if (!a.source) { els.absSummary.textContent = ''; return; }
        const label = SOURCE_LABEL[a.source];
        els.absSummary.textContent = a.values.every(Number.isFinite)
            ? `${label}：三值樣本標準差 ${a.sd.toPrecision(3)}`
            : `${label}：三個吸光度都填好才能算 D/L`;
    }

    /** 從扣背景光譜讀三個波長，填入輸入框（五位小數），state 鏡像輸入框的值。 */
    function readAbsorbancesFromSpectrum() {
        const wls = currentWavelengths();
        const raw = Calc().absorbanceAt(state.spectra.subtracted, wls);
        const shown = raw.map(v => Number(v.toFixed(5)));
        [els.abs1, els.abs2, els.abs3].forEach((el, k) => { el.value = shown[k].toFixed(5); });
        setState({ absorbance: { values: Object.freeze(shown), sd: Calc().sampleStd(shown), source: 'spectrum' } });
        setChip(els.absChip, 'spectrum');
        updateAbsSummary();
    }

    function renderSpectraResults(subtracted, fit) {
        const a = state.absorbance;
        const fitHtml = fit
            ? `<div class="result-grid mt-sm">
                   ${resultItem('純 DOX 縮放係數 k', fit.k.toPrecision(4))}
                   ${resultItem('擬合殘差 RMS', fit.rms.toPrecision(3), `A.U.，n = ${fit.n}`)}
               </div>
               <p class="stat-sub mt-sm">k 是讓「空白 + k×純 DOX」最貼近含藥光譜的縮放；殘差大代表兩樣品的脂質濃度可能不一致。網站不判定通過與否，請看下方擬合圖。</p>`
            : '';
        els.spectraResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">扣背景後 A(主波長)</div>
                    <div class="stat-value">${a.values[1].toFixed(5)} <span class="stat-unit">± ${a.sd.toPrecision(2)}</span></div>
                    <div class="stat-sub">重疊 ${subtracted.wavelength.length} 點${subtracted.dropped ? `，捨棄 ${subtracted.dropped} 點（超出空白光譜範圍）` : ''}</div>
                </div>
            </div>
            ${fitHtml}`;
        global.A11y.focusResults('lipoSpectraResults');
    }

    async function onComputeSpectra() {
        try {
            const [loadedText, blankText] = await Promise.all([
                readChecked(els.loadedFile, '含藥光譜'),
                readChecked(els.blankFile, '空白光譜'),
            ]);
            const loaded = Parsers().parseUvSpectrum(loadedText);
            const blank = Parsers().parseUvSpectrum(blankText);
            const subtracted = Calc().subtractSpectra(loaded, blank);

            let fit = null;
            if (els.pureFile.files.length) {
                const pure = Parsers().parseUvSpectrum(await readChecked(els.pureFile, '純 DOX 光譜'));
                const fitMin = global.FormUtils.readPositiveField('lipoFitMin', '擬合下限');
                const fitMax = global.FormUtils.readPositiveField('lipoFitMax', '擬合上限');
                fit = Calc().fitPureDoxScale(loaded, blank, pure, { fitMin, fitMax });
            }

            setState({ spectra: Object.freeze({ loaded, blank, subtracted, fit }) });
            invalidateDl();
            readAbsorbancesFromSpectrum();
            renderSpectraResults(subtracted, fit);

            const wls = currentWavelengths();
            Charts().renderSpectraChart('lipoSpectraChart', { loaded, blank, subtracted, wavelengths: wls });
            global.A11y.describeChart('lipoSpectraChart',
                `含藥、空白與扣背景光譜；主波長 ${wls[1]} nm 吸光度 ${state.absorbance.values[1]}`);
            els.fitChartWrap.hidden = !fit;
            if (fit) {
                Charts().renderFitChart('lipoFitChart', { loaded, model: fit.model, residual: fit.residual });
                global.A11y.describeChart('lipoFitChart', `含藥實測與空白加 ${fit.k.toPrecision(3)} 倍純 DOX 的模型，殘差 RMS ${fit.rms.toPrecision(2)}`);
            }
            syncButtons();
        } catch (err) {
            global.showAlert('lipoSpectraResults', 'error', err.message);
        }
    }

    function onWavelengthInput() {
        const wl2 = parseFloat(els.wl2.value);
        Table().setPrimaryWavelength(wl2);
        if (!state.spectra) return;
        try {
            readAbsorbancesFromSpectrum();
        } catch (err) {
            global.showAlert('lipoSpectraResults', 'error', err.message);
        }
    }

    function onAbsInput() {
        const values = [els.abs1, els.abs2, els.abs3].map(el => parseFloat(el.value));
        const complete = values.every(Number.isFinite);
        setState({ absorbance: { values: Object.freeze(values), sd: complete ? Calc().sampleStd(values) : 0, source: 'manual' } });
        setChip(els.absChip, 'manual');
        updateAbsSummary();
    }

    // ------------------------------------------------------------ 面板 3：D/L
    function renderDlResults(snap) {
        const p = snap.params;
        els.dlResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">D/L（drug-to-lipid 莫耳比）</div>
                    <div class="stat-value">${snap.dl.toPrecision(4)} <span class="stat-unit">± ${snap.dlSd.toPrecision(2)}</span></div>
                    <div class="stat-sub">誤差 = D/L × √(relA² + relF²)：UV 三波長貢獻 ${pct(snap.relA)}，稀釋因子貢獻 ${pct(snap.relF)}</div>
                    <div class="stat-sub">Excel 原式（僅 UV）：${snap.dl.toPrecision(4)} ± ${snap.dlSdExcel.toPrecision(2)}</div>
                </div>
            </div>
            <div class="result-grid mt-sm">
                ${resultItem('[DOX]', (snap.doxConc * 1000).toPrecision(4), `± ${(snap.doxSd * 1000).toPrecision(2)} mM`)}
                ${resultItem('脂質實際濃度', (snap.lipidActual * 1000).toPrecision(4), 'mM')}
                ${resultItem(`A(${p.wavelengths[1]} nm)`, snap.aPrimary.toFixed(5), `SD ${snap.sdA.toPrecision(2)}`)}
                ${resultItem('稀釋因子', p.factor.toPrecision(4), SOURCE_LABEL[p.factorSource])}
            </div>`;
        global.A11y.focusResults('lipoDlResults');
    }

    function onComputeDl() {
        try {
            const absorbances = [els.abs1, els.abs2, els.abs3].map((el, k) =>
                global.FormUtils.parseFiniteNumber(el.value, `吸光度 ${k + 1}`));
            const wavelengths = currentWavelengths();
            const epsilon = global.FormUtils.readPositiveField('lipoEpsilon', 'ε');
            const pathCm = global.FormUtils.readPositiveField('lipoPathLength', '光徑');
            const lipidMM = global.FormUtils.readPositiveField('lipoLipidConc', '脂質原始濃度');
            const factor = global.FormUtils.parsePositiveNumber(els.factor.value, '稀釋因子（請先計算或手動輸入）');
            const factorSource = state.dilution.source || 'manual';
            const factorSd = factorSource === 'saxs' ? state.dilution.sd : 0;
            const absSource = state.absorbance.source || 'manual';

            const r = Calc().computeDrugToLipid({
                absorbances, primaryIndex: 1, primaryWavelengthNm: wavelengths[1],
                epsilon, pathCm, lipidMolar: lipidMM / 1000, factor, factorSd,
            });
            const qMin = parseFloat(els.qMin.value);
            const qMax = parseFloat(els.qMax.value);
            const snapshot = Object.freeze({
                ...r,
                params: Object.freeze({ absorbances: Object.freeze(absorbances), wavelengths: Object.freeze(wavelengths), epsilon, pathCm, lipidMM, factor, factorSd, factorSource, absSource, qMin, qMax }),
            });
            setState({ dl: snapshot });
            renderDlResults(snapshot);
            setAddEnabled(true);
        } catch (err) {
            const hint = state.absorbance.source === 'spectrum' && /吸光度非正/.test(err.message)
                ? '；請確認含藥／空白檔沒有互換'
                : '';
            global.showAlert('lipoDlResults', 'error', err.message + hint);
            setAddEnabled(false);
        }
    }

    function onAddResult() {
        const snap = state.dl;
        if (!snap) return;
        const p = snap.params;
        const existing = Table().getRows().length;
        const name = (els.sampleName.value || '').trim().slice(0, 60) || `樣品 ${existing + 1}`;
        const row = {
            id: (global.crypto && typeof global.crypto.randomUUID === 'function')
                ? global.crypto.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            sampleName: name,
            factor: p.factor,
            factorSource: p.factorSource,
            aPrimary: snap.aPrimary,
            primaryWavelengthNm: p.wavelengths[1],
            doxConcMM: snap.doxConc * 1000,
            lipidActualMM: snap.lipidActual * 1000,
            dl: snap.dl,
            dlSd: snap.dlSd,
            addedAt: new Date().toISOString(),
            meta: {
                epsilon: p.epsilon, pathCm: p.pathCm, qMin: p.qMin, qMax: p.qMax,
                wavelengths: [...p.wavelengths], absorbances: [...p.absorbances],
                factorSd: p.factorSd, absSource: p.absSource,
            },
        };
        if (Table().add(row)) setAddEnabled(false);
    }

    // ------------------------------------------------------------ init
    function bind() {
        els.solutionFile.addEventListener('change', syncButtons);
        els.bypassFile.addEventListener('change', syncButtons);
        els.loadedFile.addEventListener('change', syncButtons);
        els.blankFile.addEventListener('change', syncButtons);
        els.computeDilution.addEventListener('click', onComputeDilution);
        els.computeSpectra.addEventListener('click', onComputeSpectra);
        els.computeDl.addEventListener('click', onComputeDl);
        els.addResult.addEventListener('click', onAddResult);
        els.factor.addEventListener('input', onFactorInput);
        [els.wl1, els.wl2, els.wl3].forEach(el => el.addEventListener('input', onWavelengthInput));
        [els.abs1, els.abs2, els.abs3].forEach(el => el.addEventListener('input', onAbsInput));
        INVALIDATING_IDS.forEach(id => $(id)?.addEventListener('input', invalidateDl));

        els.dilutionPng?.addEventListener('click', () => {
            const chart = Charts().getChart('lipoDilutionChart');
            if (chart) global.downloadChartPng(chart, 'liposome-dilution.png');
        });
        els.spectraPng?.addEventListener('click', () => {
            const chart = Charts().getChart('lipoSpectraChart');
            if (chart) global.downloadChartPng(chart, 'liposome-spectra.png');
        });
        els.fitPng?.addEventListener('click', () => {
            const chart = Charts().getChart('lipoFitChart');
            if (chart) global.downloadChartPng(chart, 'liposome-fit.png');
        });
    }

    function init() {
        const ids = {
            solutionFile: 'lipoSolutionFile', bypassFile: 'lipoBypassFile', qMin: 'lipoQMin', qMax: 'lipoQMax',
            computeDilution: 'lipoComputeDilution', dilutionResults: 'lipoDilutionResults',
            factor: 'lipoDilutionFactor', factorChip: 'lipoDilutionChip', factorEcho: 'lipoFactorEcho', dilutionPng: 'lipoDilutionPng',
            loadedFile: 'lipoLoadedFile', blankFile: 'lipoBlankFile', pureFile: 'lipoPureFile',
            computeSpectra: 'lipoComputeSpectra', spectraResults: 'lipoSpectraResults', fitChartWrap: 'lipoFitChartWrap', spectraPng: 'lipoSpectraPng', fitPng: 'lipoFitPng',
            wl1: 'lipoWl1', wl2: 'lipoWl2', wl3: 'lipoWl3', abs1: 'lipoAbs1', abs2: 'lipoAbs2', abs3: 'lipoAbs3',
            absChip: 'lipoAbsChip', absSummary: 'lipoAbsSummary',
            sampleName: 'lipoSampleName', computeDl: 'lipoComputeDl', dlResults: 'lipoDlResults', addResult: 'lipoAddResult',
        };
        Object.entries(ids).forEach(([key, id]) => { els[key] = $(id); });
        if (!els.computeDilution) return;   // 頁面沒有這個分頁（例如測試環境）

        state = initialState();
        Table().init();
        Table().setPrimaryWavelength(parseFloat(els.wl2.value));
        setChip(els.factorChip, null);
        setChip(els.absChip, null);
        syncFactorEcho();
        syncButtons();
        setAddEnabled(false);
        bind();
    }

    global.LiposomeSection = Object.freeze({ init, getState: () => state });
})(typeof window !== 'undefined' ? window : globalThis);
