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
 *   - 面板 2 的更新是原子的：扣背景、擬合、讀值三者都成功後才動 state 與畫面（Task 11b）
 *   - D/L 快照的 q 視窗取自 state.dilution（稀釋因子計算當下），手動因子時為 null
 *   - state 與其巢狀物件都 Object.freeze；每次更新產生新物件
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
    /** 主波長在三個讀值波長中的索引（Excel J 欄只用 495 nm）。 */
    const primary = () => Calc().DEFAULTS.PRIMARY_INDEX;

    const INVALIDATING_IDS = Object.freeze([
        'lipoDilutionFactor', 'lipoAbs1', 'lipoAbs2', 'lipoAbs3',
        'lipoWl1', 'lipoWl2', 'lipoWl3', 'lipoLipidConc', 'lipoEpsilon', 'lipoPathLength',
    ]);

    const SOURCE_LABEL = Object.freeze({ saxs: 'SAXS 計算', manual: '手動', spectrum: '光譜讀值' });

    /** 三個波長吸光度的樣本標準差不只是雜訊，也含吸收帶在 ±1 nm 的斜率（科學審查措辭）。 */
    const SPREAD_LABEL = '三點譜線離散（含譜帶斜率）';

    /** 樣品名長度上限：以輸入框的 maxlength 為準，沒有就用這個值。 */
    const SAMPLE_NAME_MAX_FALLBACK = 60;

    const BYTES_PER_MB = 1048576;

    const initialState = () => Object.freeze({
        dilution: Object.freeze({ factor: null, sd: 0, n: 0, source: null, qMin: null, qMax: null }),
        spectra: null,
        absorbance: Object.freeze({ values: Object.freeze([null, null, null]), sd: 0, source: null }),
        dl: null,
    });

    let state = initialState();
    let initialised = false;
    let untitledCount = 0;
    const els = {};

    function setState(patch) {
        state = Object.freeze({ ...state, ...patch });
    }

    const $ = (id) => document.getElementById(id);
    const wlEls = () => [els.wl1, els.wl2, els.wl3];
    const absEls = () => [els.abs1, els.abs2, els.abs3];

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

    function warningRows(texts) {
        return texts.map(warningRow).join('');
    }

    /**
     * 一格結果。label / value / unit 全部經 escapeHtml——value 目前都是數字格式化後的字串，
     * 逸出等於沒動；這樣日後放進任何字串也不會變成 HTML。
     */
    function resultItem(label, value, unit = '') {
        return `<div class="result-item"><div class="result-label">${esc(label)}</div><div class="result-value">${esc(String(value))}${unit ? ` <span class="stat-unit">${esc(unit)}</span>` : ''}</div></div>`;
    }

    function pct(rel) {
        return `${(rel * 100).toFixed(2)}%`;
    }

    /** 中文句子裡的拉丁詞前後補半形空格；純中文標籤不補。 */
    function padLatin(label) {
        return /^[\x20-\x7e]+$/.test(label) ? ` ${label} ` : label;
    }

    /** 讀檔（含大小上限），回 Promise<string>；讀取失敗的訊息帶上檔案標籤。 */
    function readChecked(input, label) {
        const shown = padLatin(label);
        const file = input && input.files && input.files[0];
        if (!file) throw new Error(`請先選擇${shown}檔案`);
        const maxBytes = Parsers().LIMITS.MAX_BYTES;
        if (file.size > maxBytes) {
            throw new Error(`${shown.trimStart()}檔案 ${(file.size / BYTES_PER_MB).toFixed(1)} MB 超過上限 ${(maxBytes / BYTES_PER_MB).toFixed(0)} MB`);
        }
        return global.DndcFileParser.readFile(file).catch((err) => {
            throw new Error(`無法讀取${shown}檔案：${err.message}`);
        });
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
            const direction = d.factor > 1 ? '（> 1，請確認方向）' : '';
            els.factorEcho.textContent = `手動因子 ${d.factor.toPrecision(4)}${direction}，無離散度（誤差只含 UV 項）`;
        }
    }

    function dilutionWarnings(r) {
        const rel = Math.abs(r.lsqScale / r.factor - 1);
        const texts = [];
        if (r.flags.factorAboveOne) texts.push('稀釋因子 > 1：bypass 應比 solution cell 稀，通常代表兩個檔案選反');
        if (r.flags.lowCoverage) texts.push('有效點只涵蓋 q 視窗的一小段，請確認兩條曲線的 q 範圍');
        if (rel > Calc().DEFAULTS.LSQ_WARN_REL) {
            texts.push(`逐點平均與最小平方縮放相差 ${pct(rel)}，請確認 q 視窗內兩曲線形狀一致`);
        }
        return warningRows(texts);
    }

    function renderDilutionResults(r, qMin, qMax) {
        const excluded = r.excluded.outOfRange + r.excluded.nonPositive;
        els.dilutionResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">稀釋因子（I_bypass / I_solution 逐點平均）</div>
                    <div class="stat-value">${r.factor.toPrecision(4)} <span class="stat-unit">± ${r.sd.toPrecision(2)}</span></div>
                    <div class="stat-sub">q 視窗 ${qMin}–${qMax} Å⁻¹，實際涵蓋 ${r.qCovered[0].toFixed(3)}–${r.qCovered[1].toFixed(3)}，n = ${r.n}，相對離散 ${pct(r.sd / r.factor)}</div>
                </div>
            </div>
            <div class="result-grid mt-sm">
                ${resultItem('最小平方縮放（PRIMUS I Scale 等價）', r.lsqScale.toPrecision(4))}
                ${resultItem('排除點', String(excluded), excluded ? `超出範圍 ${r.excluded.outOfRange}、非正 ${r.excluded.nonPositive}` : '')}
            </div>
            ${dilutionWarnings(r)}`;
        global.A11y.focusResults('lipoDilutionResults');
    }

    async function onComputeDilution() {
        els.computeDilution.disabled = true;   // 讀檔期間擋重複點擊；finally 的 syncButtons 恢復
        try {
            const [solText, bypText] = await Promise.all([
                readChecked(els.solutionFile, 'solution cell'),
                readChecked(els.bypassFile, 'bypass'),
            ]);
            const solution = Parsers().parseSaxsDat(solText);
            const bypass = Parsers().parseSaxsDat(bypText);
            const qMin = global.FormUtils.readPositiveField('lipoQMin', 'q 下限');
            const qMax = global.FormUtils.readPositiveField('lipoQMax', 'q 上限');
            const r = Calc().computeDilutionFactor(solution, bypass, { qMin, qMax });

            setState({ dilution: Object.freeze({ factor: r.factor, sd: r.sd, n: r.n, source: 'saxs', qMin, qMax }) });
            invalidateDl();
            els.factor.value = r.factor.toPrecision(6);
            setChip(els.factorChip, 'saxs');
            syncFactorEcho();
            renderDilutionResults(r, qMin, qMax);
            Charts().renderDilutionChart('lipoDilutionChart', { solution, bypass, factor: r.factor, qMin, qMax });
            global.A11y.describeChart('lipoDilutionChart',
                `log-log 疊圖：solution cell、bypass、bypass 除以 ${r.factor.toPrecision(4)}；q 視窗 ${qMin}–${qMax}`);
        } catch (err) {
            global.showAlert('lipoDilutionResults', 'error', err.message);
        } finally {
            syncButtons();
        }
    }

    function onFactorInput() {
        const v = parseFloat(els.factor.value);
        const factor = Number.isFinite(v) ? v : null;
        setState({ dilution: Object.freeze({ ...state.dilution, factor, sd: 0, n: 0, source: 'manual', qMin: null, qMax: null }) });
        setChip(els.factorChip, factor === null ? null : 'manual');   // 欄位清空：chip 隱藏，與回顯「尚未設定」一致
        syncFactorEcho();
    }

    // ------------------------------------------------------------ 面板 2：光譜
    function currentWavelengths() {
        return wlEls().map((el, k) =>
            global.FormUtils.parsePositiveNumber(el.value, `讀值波長 ${k + 1}`));
    }

    function updateAbsSummary() {
        if (!els.absSummary) return;
        const a = state.absorbance;
        if (!a.source) { els.absSummary.textContent = ''; return; }
        const label = SOURCE_LABEL[a.source];
        els.absSummary.textContent = a.values.every(Number.isFinite)
            ? `${label}：${SPREAD_LABEL} ${a.sd.toPrecision(3)}`
            : `${label}：三個吸光度都填好才能算 D/L`;
    }

    /** 五位小數四捨五入（與輸入框顯示一致），SD 用四捨五入後的值算（與 Excel 一致）。 */
    function roundedAbsorbances(raw) {
        return Calc().roundAbsorbances(raw);
    }

    /** 把已寫進 state 的光譜讀值反映到輸入框、chip 與摘要（只碰 DOM）。 */
    function applyAbsorbances(shown) {
        absEls().forEach((el, k) => { el.value = shown[k].toFixed(5); });
        setChip(els.absChip, 'spectrum');
        updateAbsSummary();
    }

    /** 結果區 HTML（純函式）：stat-card + 擬合摘要 + 警告列。 */
    function spectraResultsHtml(a, subtracted, fit) {
        const fitHtml = fit
            ? `<div class="result-grid mt-sm">
                   ${resultItem('純 DOX 縮放係數 k', fit.k.toPrecision(4))}
                   ${resultItem('擬合殘差 RMS', fit.rms.toPrecision(3), `A.U.，n = ${fit.n}`)}
               </div>
               <p class="stat-sub mt-sm">k 是讓「空白 + k×純 DOX」最貼近含藥光譜的縮放；殘差大代表兩樣品的脂質濃度可能不一致。網站不判定通過與否，請看下方擬合圖。</p>`
            : '';
        const warn = fit && fit.flags.negativeScale
            ? warningRow('縮放係數 k 為負：含藥／空白檔可能互換，或扣背景過頭')
            : '';
        const dropped = subtracted.dropped ? `，捨棄 ${subtracted.dropped} 點（超出空白光譜範圍）` : '';
        return `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">扣背景後 A(主波長)</div>
                    <div class="stat-value">${a.values[primary()].toFixed(5)} <span class="stat-unit">± ${a.sd.toPrecision(2)}</span></div>
                    <div class="stat-sub">± 為${SPREAD_LABEL}；重疊 ${subtracted.wavelength.length} 點${dropped}</div>
                </div>
            </div>
            ${fitHtml}${warn}`;
    }

    function renderSpectraResults(subtracted, fit) {
        els.spectraResults.innerHTML = spectraResultsHtml(state.absorbance, subtracted, fit);
        global.A11y.focusResults('lipoSpectraResults');
    }

    /** 光譜圖與其文字描述；讀值波長改變時也要跟著重畫（標線跟隨）。 */
    function renderSpectraChart(spectra, wls) {
        const { loaded, blank, subtracted } = spectra;
        Charts().renderSpectraChart('lipoSpectraChart', { loaded, blank, subtracted, wavelengths: wls });
        global.A11y.describeChart('lipoSpectraChart',
            `含藥、空白與扣背景光譜；主波長 ${wls[primary()]} nm 吸光度 ${state.absorbance.values[primary()]}`);
    }

    async function onComputeSpectra() {
        els.computeSpectra.disabled = true;   // 讀檔期間擋重複點擊；finally 的 syncButtons 恢復
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
            const wls = currentWavelengths();
            const { shown, sd } = roundedAbsorbances(Calc().absorbanceAt(subtracted, wls));

            // 扣背景、擬合、讀值三者都成功，才一次更新 state 與畫面
            const spectra = Object.freeze({ loaded, blank, subtracted, fit });
            setState({ spectra, absorbance: Object.freeze({ values: shown, sd, source: 'spectrum' }) });
            invalidateDl();
            applyAbsorbances(shown);
            renderSpectraResults(subtracted, fit);
            renderSpectraChart(spectra, wls);
            els.fitChartWrap.hidden = !fit;
            if (fit) {
                Charts().renderFitChart('lipoFitChart', { loaded, model: fit.model, residual: fit.residual });
                global.A11y.describeChart('lipoFitChart', `含藥實測與空白加 ${fit.k.toPrecision(3)} 倍純 DOX 的模型，殘差 RMS ${fit.rms.toPrecision(2)}`);
            } else {
                Charts().destroyChart('lipoFitChart');   // 上一次的擬合圖不留在隱藏的容器裡
            }
        } catch (err) {
            global.showAlert('lipoSpectraResults', 'error', err.message);
        } finally {
            syncButtons();
        }
    }

    function onWavelengthInput(event) {
        const primaryEl = wlEls()[primary()];
        if (event.target === primaryEl) Table().setPrimaryWavelength(parseFloat(primaryEl.value));
        if (!state.spectra) return;
        try {
            const wls = currentWavelengths();
            const { shown, sd } = roundedAbsorbances(Calc().absorbanceAt(state.spectra.subtracted, wls));
            setState({ absorbance: Object.freeze({ values: shown, sd, source: 'spectrum' }) });
            applyAbsorbances(shown);
            // 重讀成功：用結果取代可能殘留的錯誤訊息並清掉 role="alert"；不搶正在輸入的焦點
            els.spectraResults.innerHTML = spectraResultsHtml(state.absorbance, state.spectra.subtracted, state.spectra.fit);
            global.A11y.clearLiveRegion(els.spectraResults);
            renderSpectraChart(state.spectra, wls);
        } catch (err) {
            global.showAlert('lipoSpectraResults', 'error', err.message);
        }
    }

    function onAbsInput() {
        const values = Object.freeze(absEls().map((el) => {
            const v = parseFloat(el.value);
            return Number.isFinite(v) ? v : null;
        }));
        const complete = values.every(Number.isFinite);
        setState({ absorbance: Object.freeze({ values, sd: complete ? Calc().sampleStd(values) : 0, source: 'manual' }) });
        setChip(els.absChip, 'manual');
        updateAbsSummary();
    }

    // ------------------------------------------------------------ 面板 3：D/L
    function dlWarnings(snap) {
        const d = Calc().DEFAULTS;
        const texts = [];
        if (snap.flags.epsilonWavelengthMismatch) {
            texts.push(`主波長 ${snap.params.wavelengths[primary()]} nm 與 ε 的量測波長 ${d.EPSILON_REF_NM} nm 不同，請改用對應波長的 ε`);
        }
        if (snap.flags.absorbanceAboveLinear) {
            texts.push(`A(主波長) > ${d.A_MAX_LINEAR} 超出線性範圍，請稀釋後重測或縮短光程`);
        }
        if (snap.flags.wavelengthSpreadHigh) {
            texts.push(`三個波長的吸光度相差超過 ${(d.WAVELENGTH_SPREAD_WARN_REL * 100).toFixed(0)}%，平滑吸收帶不會如此，請檢查光譜`);
        }
        return warningRows(texts);
    }

    function renderDlResults(snap) {
        const p = snap.params;
        els.dlResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">D/L（drug-to-lipid 莫耳比）</div>
                    <div class="stat-value">${snap.dl.toPrecision(4)} <span class="stat-unit">± ${snap.dlSd.toPrecision(2)}</span></div>
                    <div class="stat-sub">誤差 = D/L × √(relA² + relF²)：${SPREAD_LABEL}貢獻 ${pct(snap.relA)}，稀釋因子離散貢獻 ${pct(snap.relF)}</div>
                    <div class="stat-sub">此為精密度，不含 ε、光程、脂質配製濃度的系統誤差</div>
                    <div class="stat-sub">Excel 原式（僅 UV）：${snap.dl.toPrecision(4)} ± ${snap.dlSdExcel.toPrecision(2)}</div>
                </div>
            </div>
            <div class="result-grid mt-sm">
                ${resultItem('[DOX]', (snap.doxConc * 1000).toPrecision(4), `± ${(snap.doxSd * 1000).toPrecision(2)} mM`)}
                ${resultItem('脂質實際濃度', (snap.lipidActual * 1000).toPrecision(4), 'mM')}
                ${resultItem(`A(${p.wavelengths[primary()]} nm)`, snap.aPrimary.toFixed(5), `${SPREAD_LABEL} ${snap.sdA.toPrecision(2)}`)}
                ${resultItem('稀釋因子', p.factor.toPrecision(4), SOURCE_LABEL[p.factorSource])}
            </div>
            ${dlWarnings(snap)}`;
        global.A11y.focusResults('lipoDlResults');
    }

    function onComputeDl() {
        try {
            const absorbances = absEls().map((el, k) =>
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
                absorbances, primaryIndex: primary(), primaryWavelengthNm: wavelengths[primary()],
                epsilon, pathCm, lipidMolar: lipidMM / 1000, factor, factorSd,
            });
            // q 視窗是稀釋因子計算當下的參數；手動因子時為 null
            const { qMin, qMax } = state.dilution;
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
            invalidateDl();
        }
    }

    /** 未命名樣品的預設名：以「現有列數 + 1」為起點，但計數器只增不減，刪列後不會撞名。 */
    function nextUntitledName() {
        untitledCount = Math.max(untitledCount, Table().getRows().length) + 1;
        return `樣品 ${untitledCount}`;
    }

    function onAddResult() {
        const snap = state.dl;
        if (!snap) return;
        const p = snap.params;
        const maxLen = els.sampleName.maxLength > 0 ? els.sampleName.maxLength : SAMPLE_NAME_MAX_FALLBACK;
        const name = (els.sampleName.value || '').trim().slice(0, maxLen) || nextUntitledName();
        const row = {
            id: (global.crypto && typeof global.crypto.randomUUID === 'function')
                ? global.crypto.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            sampleName: name,
            factor: p.factor,
            factorSource: p.factorSource,
            aPrimary: snap.aPrimary,
            primaryWavelengthNm: p.wavelengths[primary()],
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
        try {
            if (Table().add(row)) setAddEnabled(false);
        } catch (err) {
            global.showAlert('lipoResultsAlert', 'error', err.message);
        }
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
        wlEls().forEach(el => el.addEventListener('input', onWavelengthInput));
        absEls().forEach(el => el.addEventListener('input', onAbsInput));
        INVALIDATING_IDS.forEach(id => $(id)?.addEventListener('input', invalidateDl));

        els.dilutionPng.addEventListener('click', () => {
            const chart = Charts().getChart('lipoDilutionChart');
            if (chart) global.downloadChartPng(chart, 'liposome-dilution.png');
        });
        els.spectraPng.addEventListener('click', () => {
            const chart = Charts().getChart('lipoSpectraChart');
            if (chart) global.downloadChartPng(chart, 'liposome-spectra.png');
        });
        els.fitPng.addEventListener('click', () => {
            const chart = Charts().getChart('lipoFitChart');
            if (chart) global.downloadChartPng(chart, 'liposome-fit.png');
        });
    }

    const ELEMENT_IDS = Object.freeze({
        solutionFile: 'lipoSolutionFile', bypassFile: 'lipoBypassFile', qMin: 'lipoQMin', qMax: 'lipoQMax',
        computeDilution: 'lipoComputeDilution', dilutionResults: 'lipoDilutionResults',
        factor: 'lipoDilutionFactor', factorChip: 'lipoDilutionChip', factorEcho: 'lipoFactorEcho', dilutionPng: 'lipoDilutionPng',
        loadedFile: 'lipoLoadedFile', blankFile: 'lipoBlankFile', pureFile: 'lipoPureFile',
        computeSpectra: 'lipoComputeSpectra', spectraResults: 'lipoSpectraResults', fitChartWrap: 'lipoFitChartWrap', spectraPng: 'lipoSpectraPng', fitPng: 'lipoFitPng',
        wl1: 'lipoWl1', wl2: 'lipoWl2', wl3: 'lipoWl3', abs1: 'lipoAbs1', abs2: 'lipoAbs2', abs3: 'lipoAbs3',
        absChip: 'lipoAbsChip', absSummary: 'lipoAbsSummary',
        sampleName: 'lipoSampleName', computeDl: 'lipoComputeDl', dlResults: 'lipoDlResults', addResult: 'lipoAddResult',
    });

    function init() {
        if (initialised) return;
        const missing = Object.values(ELEMENT_IDS).filter(id => !$(id));
        if (missing.length) {
            // 不 throw：init 在 DOMContentLoaded 裡，throw 會連帶擋掉後面的 initDndcLock()
            console.error(`[liposome] 缺少元素：${missing.join(', ')}`);
            return;
        }
        Object.entries(ELEMENT_IDS).forEach(([key, id]) => { els[key] = $(id); });

        state = initialState();
        Table().init();
        Table().setPrimaryWavelength(parseFloat(wlEls()[primary()].value));
        setChip(els.factorChip, null);
        setChip(els.absChip, null);
        syncFactorEcho();
        syncButtons();
        setAddEnabled(false);
        bind();
        initialised = true;
    }

    global.LiposomeSection = Object.freeze({ init, getState: () => state });
})(typeof window !== 'undefined' ? window : globalThis);
