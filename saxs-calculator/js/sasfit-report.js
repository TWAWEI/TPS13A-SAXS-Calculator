/**
 * sasfit-report.js -- the report TXT of one fit and the CSV of a sequence
 * (design spec 9; plan M4 Task 14). Original code.
 *
 *   reportTxt({ file, fitResult, bounds, software, generatedAt, conditionName, matchesForm })
 *       -> string. Keys in English, explanations in Traditional Chinese
 *       (engineering decision 11). Line ends are CRLF (Windows Notepad); no
 *       BOM here -- the download adds it. Everything about the fit comes from
 *       the FitResult (SasFitExport.paramRows); `bounds` is { name: [lower,
 *       upper] } read by the caller from a form of the same model spec, or
 *       null: a FitResult carries no bounds, and the report says which it was.
 *       Numbers are written in full (SasFitExport.num); each parameter also
 *       has the text the page shows (SasFitExport.shownText -> SasFitFormat),
 *       so the report can be compared with the screen. BOTH errors are listed
 *       (unscaled, and multiplied by sqrt(measure)), with a line that says
 *       which one the page shows. generatedAt is a text given by the caller
 *       (no clock here). matchesForm === false adds a line saying that the
 *       parameter table was changed after this fit. Throws for a 'stopped' result.
 *       The last section, [SasView parameter text], is SasFitSasView.text of the same result and bounds on one
 *       line after 'Text: ', with SasFitSasView.notes before it -- or the reason why this fit has none.
 *   sequenceCsv({ state, software }) -> string (no BOM; line ends \n).
 *       One row per item of the last run (state.seq.order), skipped and failed
 *       ones included. The numbers are those the sequence table shows -- the
 *       values of state.fitResults[id] as it is NOW, for a row the run
 *       finished and whose result is of the run's model -- at full precision;
 *       status_text and note are the table's texts (SasFitSeqView.tableRows),
 *       status is the code (converged, maxiter, failed, skipped, error, pending). As in
 *       the table, a value on a bound has no error (it means nothing) and the
 *       note says so. Throws when no sequence has run (seq.order null).
 *
 * The fit measure is called reduced chi-square only with sigma weighting
 * (decision 24, SasFitHints.measure). Text of the user (file names, header
 * fields, condition names) loses its control characters before it is written,
 * so it cannot add lines to a report; CSV cells go through SasFitExport.cell.
 *
 * Pure: no DOM, no timers, no clock; nothing given is modified; other globals
 * are read at call time.
 */

(function () {
    'use strict';

    const EOL = '\r\n';
    const HC_KEV_ANGSTROM = 12.398;        // h c in keV Å as the SAXS page uses it (section-saxs.js): both show the same wavelength
    const SIGMA_MODE = 'sigma';
    const HAYTER = 'hayter_msa';
    const NONE = 'none';
    const DASH = '-';
    const SEPARATOR = ' | ';
    const CONTROL_RE = /[\u0000-\u001F\u007F\u2028\u2029]/g;
    const WEIGHTING_NAMES = Object.freeze({
        sigma: 'sigma（資料 σ）', sqrtI: 'sqrtI（√|I|）', absI: 'absI（|I|）', none: 'none（不加權）',
    });
    const KIND_NAMES = Object.freeze({
        official: 'official TPS 13A reduced file（官方還原檔，絕對強度 1/cm）',
        generic: 'generic text file（一般文字檔，強度單位依原檔）',
    });
    // [header key, the key printed in the report]
    const HEADER_KEYS = Object.freeze([
        ['outputName', 'Output filename'], ['energyKeV', 'Photon energy (keV)'], ['qStart', 'Starting q for binning (1/Ang)'],
        ['thicknessMm', 'Sample thickness (mm)'], ['scalingFactor', 'Scaling factor'],
        ['sampleTransmission', 'Sample transmission'], ['cellTransmission', 'Empty-cell transmission'],
        ['sddMm', 'Sample-to-detector distance (mm)'], ['totalFrames', 'Total frames'], ['frameTimeS', 'Single frame time (s)'],
    ]);
    const FLAGS = Object.freeze([
        ['illConditioned', '參數無法由資料獨立決定（彼此高度相關，或某個參數對曲線幾乎沒有影響），誤差不可靠'],
        ['blockedByNonFinite', '擬合被模型無法計算的區域擋住，參數是目前為止最好的點'],
        ['jacobianNonFinite', '部分參數的誤差無法計算；其餘參數的誤差是把那些參數固定後算出的，數值偏小'],
    ]);
    const TEXT = Object.freeze({
        title: 'SAS model fitting report（SAS 模型擬合報告）',
        kernel: (version) => '模型計算核心：SasView sasmodels ' + version + '（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly',
        noHeader: 'Header: none（無檔頭）',
        wavelength: 'Wavelength (Ang)',
        wavelengthNote: '（由能量換算：' + HC_KEV_ANGSTROM + ' / E）',
        shownUnscaled: 'Errors shown on the page: error（畫面顯示的是未乘的誤差；權重＝資料 σ）',
        shownScaled: 'Errors shown on the page: error_scaled（畫面顯示的是已乘 √(加權殘差均方) 的誤差；權重不是資料 σ）',
        columns: 'Columns: name | value | error | error_scaled | shown on the page | unit | state | at bound | lower | upper',
        boundsKept: '上下限為匯出當時參數表的設定（FitResult 本身不記錄上下限）',
        boundsLost: '上下限未記錄（匯出時參數表的模型已與這次擬合不同）',
        notChi2: '此數值不是 χ²ᵣ，沒有絕對意義；參數誤差已乘 √(加權殘差均方)，SasView 在相同權重下顯示未乘的值',
        algorithm: 'Algorithm: Levenberg-Marquardt (lm), Nielsen damping update, forward-difference Jacobian, projected bounds',
        covariance: 'Errors: from the covariance (J^T J)^-1 at the solution (SVD, singular values floored at 1e-8), as bumps / SasView',
        curveFlag: '模型曲線中無法計算（非有限）的點數',
        sld: 'SLD 若由本頁的化學式計算器求得，是以 f ≈ Z 計算（忽略異常散射），SLD 與能量無關。15 keV 下，Rb、Sr、Y、Zr、Br、Kr 與 '
            + 'Pt、Au、Hg、Tl、Pb、Bi、Th、U 這些元素的散射因子低約 4–10 %，含這些元素的物質實際 SLD 會低於計算值（幅度依它們所占的電子比例而定）；'
            + 'Δρ² 的相對誤差至少約為 SLD 相對誤差的兩倍。其他能量下受影響的元素不同。',
        hayter: '結構因子 hayter_msa 在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同），擬合得到的誤差可能不可靠；請連同殘差圖一起判斷結果。',
        atBound: '貼在邊界上的參數（at bound）仍列出有限的誤差，那是把它當自由參數算出來的數字，不代表該參數的不確定度。',
        undetermined: '誤差大於數值的參數（undetermined）與 0 無法區分，或無法由這組資料決定。',
        changed: 'Parameter table at export: changed since this fit（匯出時參數表已在這次擬合之後改過；本報告記錄的是這次擬合當時的參數）',
        sasviewTitle: 'SasView parameter text',
        sasviewIntro: 'SasView「Copy Params／Paste Params」格式的參數文字（下面 Text 之後的一整行；頁面的「複製 SasView 參數」複製的是同一段）',
        sasviewNone: 'Not available（無法產生）',
        seqTitle: 'SAS model fitting: results of a sequence',
        seqRead: 'UTF-8 with BOM; comment lines start with "# "; read with pandas.read_csv(f, comment="#") '
            + '(text columns: file, status, status_text, started_from, note)',
        boundNote: (name, side) => name + ' ' + side,
        staleNote: '已單獨重新擬合',
    });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const num = (x) => globalThis.SasFitExport.num(x);
    /** A text of the user on one line of the report: control characters cannot start a new line. */
    const clean = (value) => String(value === null || value === undefined ? '' : value).replace(CONTROL_RE, '_');
    const line = (key, value) => key + ': ' + (typeof value === 'number' ? num(value) : clean(value));
    const orDash = (textValue) => (textValue === '' ? DASH : textValue);
    const section = (title, lines) => ['', '[' + title + ']'].concat(lines);

    // ------------------------------------------------------------- report: data and model

    function headerLines(header) {
        if (!isObject(header)) return [TEXT.noHeader];
        const lines = [];
        HEADER_KEYS.forEach(([key, label]) => {
            const value = header[key];
            lines.push(line(label, value === null || value === undefined ? DASH : value));
            if (key === 'energyKeV') {
                const usable = typeof value === 'number' && Number.isFinite(value) && value > 0;
                lines.push(TEXT.wavelength + ': ' + (usable ? num(HC_KEV_ANGSTROM / value) + TEXT.wavelengthNote : DASH));
            }
        });
        return lines;
    }

    function dataLines(file, conditionName) {
        const { dataset } = file;
        const kind = dataset.kind === 'official' ? 'official' : 'generic';
        const condition = typeof file.condition === 'number' && Number.isFinite(file.condition)
            ? [line('Condition (' + clean(conditionName === undefined ? '' : conditionName) + ')', file.condition)] : [];
        return section('Data', [
            line('Data file', file.fileName), line('File kind', KIND_NAMES[kind]), line('Number of points in file', dataset.q.length),
        ].concat(condition, headerLines(dataset.header)));
    }

    const labelled = (name) => {
        const names = globalThis.SasFitLabels.MODEL_NAMES;
        return has(names, name) ? name + '（' + names[name] + '）' : name;
    };

    function modelLines(fitResult) {
        const exporter = globalThis.SasFitExport;
        const { modelSpec } = fitResult.settings;
        const hasS = typeof modelSpec.structure === 'string';
        return section('Model', [
            line('Model', labelled(modelSpec.model)),
            line('Structure factor S(Q)', hasS ? labelled(modelSpec.structure) : NONE),
            line('Combination of P and S', hasS ? exporter.combinationText(fitResult) : DASH),
            line('Effective radius of S(Q)', hasS ? exporter.radiusModeText(fitResult) : DASH),
            line('Low-q power law', modelSpec.lowQPowerLaw === true ? 'yes（lowq_scale * q^-lowq_power，與模型共用 background）' : 'no'),
            line('Model string', exporter.modelText(modelSpec)),
        ]);
    }

    function dispersityLines(fitResult, rows) {
        const widths = rows.filter((row) => row.pd !== null);
        const lines = widths.map((row) => row.name.slice(0, -'_pd'.length) + ': ' + clean(row.pd.type) + ' distribution, width ' + num(row.value)
            + ' (' + (row.fitted ? 'fitted' : 'fixed') + '), ' + num(row.pd.npts) + ' points'
            + (row.pd.nsigmas === null ? '' : ', ' + num(row.pd.nsigmas) + ' sigmas'));
        return section('Polydispersity', (lines.length === 0 ? [NONE] : lines).concat([line('Integration cutoff', fitResult.settings.cutoff)]));
    }

    // ------------------------------------------------------------- report: parameters

    const boundText = (value) => {
        if (value === null) return DASH;
        return Number.isFinite(value) ? num(value) : 'unbounded';
    };

    function shownColumn(fitResult, row) {
        const shown = globalThis.SasFitExport.shownText(fitResult, row.name);
        if (!row.fitted) return shown.value;
        return row.atBound !== null ? shown.value : shown.value + ' ± ' + shown.error;
    }

    function paramLine(fitResult, row) {
        return [
            row.name, num(row.value), orDash(num(row.error)), orDash(num(row.errorScaled)), shownColumn(fitResult, row), orDash(row.unit),
            row.fitted ? 'fitted' : 'fixed', row.atBound === null ? DASH : row.atBound, boundText(row.lower), boundText(row.upper),
        ].join(SEPARATOR);
    }

    function parameterLines(fitResult, rows, bounds) {
        const scaled = fitResult.displayErrorsScaled === true;
        return section('Parameters', [scaled ? TEXT.shownScaled : TEXT.shownUnscaled, TEXT.columns]
            .concat(rows.map((row) => paramLine(fitResult, row)), [isObject(bounds) ? TEXT.boundsKept : TEXT.boundsLost]));
    }

    // ------------------------------------------------------------- report: fit quality, algorithm, notes

    function measureLines(fitResult) {
        const { weighting } = fitResult.settings;
        if (globalThis.SasFitHints.measure(fitResult).isChi2) return [line('Reduced chi-square（約化 χ²）', fitResult.chi2r)];
        return [line('Weighted mean-square residual（加權殘差均方；weighting ' + clean(weighting) + '）', fitResult.chi2r), TEXT.notChi2];
    }

    function qualityLines(file, fitResult) {
        const { settings } = fitResult;
        const used = fitResult.dof + fitResult.names.length;
        const weighting = has(WEIGHTING_NAMES, settings.weighting) ? WEIGHTING_NAMES[settings.weighting] : clean(settings.weighting);
        return section('Fit quality', [line('Sum of squared weighted residuals (chi2)', fitResult.chi2)].concat(measureLines(fitResult), [
            line('Degrees of freedom', fitResult.dof), line('Points used', used),
            line('Points excluded', (file.dataset.q.length - used) + ' (of ' + file.dataset.q.length + ')'),
            line('q range (1/Ang)', num(settings.range.qMin) + ' to ' + num(settings.range.qMax)), line('Weighting', weighting),
        ]));
    }

    function correlationLines(fitResult) {
        const hints = globalThis.SasFitHints;
        const pairs = hints.strongCorrelations(fitResult);
        const head = 'Strong correlations (|r| > ' + hints.CORRELATION_WARN + ')';
        return pairs.length === 0 ? [head + ': ' + NONE] : [head + ':'].concat(pairs.map((p) => '  ' + p.a + ' ~ ' + p.b + ': ' + num(p.r)));
    }

    function flagLines(fitResult, rows) {
        const atBound = rows.filter((row) => row.atBound !== null).map((row) => row.name + ' (' + row.atBound + ')');
        const undetermined = rows.filter((row) => row.fitted && row.atBound === null
            && globalThis.SasFitFormat.isUndetermined(row.value, row.errorShown)).map((row) => row.name);
        return [
            line('At bound', atBound.length === 0 ? NONE : atBound.join(', ')),
            line('Undetermined (error >= |value|)', undetermined.length === 0 ? NONE : undetermined.join(', ')),
        ].concat(FLAGS.map(([key, meaning]) => key + ': ' + String(fitResult[key] === true) + '（' + meaning + '）'),
            ['nonFiniteCurvePoints: ' + num(fitResult.nonFiniteCurvePoints) + '（' + TEXT.curveFlag + '）'], correlationLines(fitResult));
    }

    function algorithmLines(fitResult, rows) {
        const { settings } = fitResult;
        const label = globalThis.SasFitHints.statusLabel(fitResult);
        return section('Algorithm and status', [
            TEXT.algorithm, TEXT.covariance, line('ftol', settings.ftol), line('xtol', settings.xtol),
            line('Max steps', settings.maxSteps), line('Iterations', fitResult.iterations),
            line('Status', clean(fitResult.status) + '（' + label.text + '）'),
        ].concat(flagLines(fitResult, rows)));
    }

    /** The model of the result has a scattering length density among its parameters. */
    function hasSld(fitResult) {
        const meta = globalThis.SasFitMeta.models[fitResult.settings.modelSpec.model];
        return isObject(meta) && meta.params.some((p) => p.type === 'sld');
    }

    function noteLines(fitResult, rows) {
        const notes = [];
        if (hasSld(fitResult)) notes.push(TEXT.sld);
        if (fitResult.settings.modelSpec.structure === HAYTER) notes.push(TEXT.hayter);
        if (rows.some((row) => row.atBound !== null)) notes.push(TEXT.atBound);
        if (rows.some((row) => row.fitted && row.atBound === null && globalThis.SasFitFormat.isUndetermined(row.value, row.errorShown))) {
            notes.push(TEXT.undetermined);
        }
        return section('Notes', notes.map((note) => '- ' + note).concat([TEXT.kernel(globalThis.SasFitMeta.sasmodelsVersion)]));
    }

    /** The text of SasView's "Paste Params" and what this fit needs in SasView, or why there is none (SasFitSasView). */
    function sasviewLines(fitResult, bounds) {
        const sasview = globalThis.SasFitSasView;
        const checked = sasview.check(fitResult);
        if (!checked.ok) return section(TEXT.sasviewTitle, [TEXT.sasviewIntro, line(TEXT.sasviewNone, checked.reason)]);
        const known = isObject(bounds);
        return section(TEXT.sasviewTitle, [TEXT.sasviewIntro]
            .concat(sasview.notes(fitResult, { boundsKnown: known }).map((note) => '- ' + note), [line('Text', sasview.text(fitResult, known ? bounds : null))]));
    }

    function reportTxt(input) {
        const { file, fitResult, bounds, software, generatedAt, conditionName, matchesForm } = isObject(input) ? input : {};
        const exporter = globalThis.SasFitExport;
        exporter.assertExportable(file, fitResult, 'reportTxt');
        if (typeof software !== 'string' || software === '') throw new Error('reportTxt needs the software text');
        if (typeof generatedAt !== 'string' || generatedAt === '') throw new Error('reportTxt needs generatedAt as a text');
        const rows = exporter.paramRows(fitResult, isObject(bounds) ? bounds : null, { absolute: file.dataset.kind === 'official' });
        const lines = [TEXT.title, line('Generated', generatedAt), line('Software', software)].concat(
            matchesForm === false ? [TEXT.changed] : [],
            dataLines(file, conditionName), modelLines(fitResult), dispersityLines(fitResult, rows),
            parameterLines(fitResult, rows, bounds), qualityLines(file, fitResult), algorithmLines(fitResult, rows),
            noteLines(fitResult, rows), sasviewLines(fitResult, bounds));
        return lines.join(EOL) + EOL;
    }

    // ------------------------------------------------------------- sequence CSV

    /** The FitResult whose numbers the sequence table shows for a file -- the run's own -- or null (the rule of SasFitSeqView). */
    const shownResult = (state, id) => globalThis.SasFitSeqView.shownResult(state, id);

    function seqHeader(columns, conditionName) {
        const exporter = globalThis.SasFitExport;
        const errorTail = columns.scaled ? '_error_scaled' : '_error';
        const name = String(conditionName).trim() === '' ? 'condition' : conditionName;
        return ['index', 'file', name].concat(columns.names.flatMap((n) => [n, n + errorTail]),
            [columns.measure.isChi2 ? 'chi2r' : 'weighted_mean_square_residual', 'dof', 'iterations', 'status', 'status_text', 'q_min', 'q_max',
                'started_from', 'note']).map(exporter.cell).join(',');
    }

    /** value and displayed error of every column; a value on a bound has no error (as in the table). */
    function seqNumbers(result, names) {
        if (result === null) return names.flatMap(() => [null, null]);
        const errors = globalThis.SasFitWorkerCore.displayErrors(result);
        return names.flatMap((name) => {
            const fitted = result.names.indexOf(name) >= 0;
            const onBound = isObject(result.atBound) && has(result.atBound, name);
            return [fitted ? result.params[name] : null, fitted && !onBound && isObject(errors) ? errors[name] : null];
        });
    }

    /** The status of a row as a code: the FitResult status of a row with numbers, else the state of the run's row. */
    const statusCode = (seqEntry, result) => (result !== null ? result.status : (isObject(seqEntry) ? seqEntry.state : ''));

    function seqRow(state, view, at, names) {
        const exporter = globalThis.SasFitExport;
        const file = state.files.find((f) => f.id === view.id);
        const seqEntry = state.seq.rows[view.id];
        const result = shownResult(state, view.id);
        const range = result !== null ? result.settings.range : (isObject(seqEntry) ? seqEntry.range : null);
        const source = isObject(seqEntry) && seqEntry.startedFrom !== null ? state.files.find((f) => f.id === seqEntry.startedFrom) : undefined;
        const marks = view.cells.map((c, i) => (c.mark === '' ? '' : TEXT.boundNote(names[i], c.mark))).filter((t) => t !== '');
        const note = [isObject(seqEntry) && typeof seqEntry.note === 'string' ? seqEntry.note : ''].concat(marks, view.stale ? [TEXT.staleNote] : [])
            .filter((t) => t !== '').join('；');
        return [at + 1, file.fileName, typeof file.condition === 'number' ? file.condition : null].concat(seqNumbers(result, names), [
            result === null ? null : result.chi2r, result === null ? null : result.dof, result === null ? null : result.iterations,
            statusCode(seqEntry, result), view.status.text, isObject(range) ? range.qMin : null, isObject(range) ? range.qMax : null,
            source === undefined ? '' : source.fileName, note,
        ]).map(exporter.cell).join(',');
    }

    function sequenceCsv(input) {
        const { state, software } = isObject(input) ? input : {};
        if (!isObject(state) || !isObject(state.seq) || !Array.isArray(state.seq.order)) throw new Error('sequenceCsv: no sequence has run yet');
        if (typeof software !== 'string' || software === '') throw new Error('sequenceCsv needs the software text');
        const exporter = globalThis.SasFitExport;
        const view = globalThis.SasFitSeqView;
        const columns = view.columns(state);
        const rows = view.tableRows(state);
        const ran = state.seq.order.map((id) => rows.find((row) => row.id === id)).filter((row) => row !== undefined);
        const weighting = state.seq.settings === null ? state.weighting : state.seq.settings.weighting;
        const comments = [
            exporter.COMMENT + TEXT.seqTitle, exporter.COMMENT + TEXT.seqRead, exporter.COMMENT + 'software: ' + clean(software),
            exporter.commentLine('model', isObject(state.seq.form) ? exporter.modelText(globalThis.SasFitJobs.modelSpec(state.seq.form)) : ''),
            exporter.commentLine('weighting', weighting), exporter.commentLine('condition_name', state.conditionName),
            exporter.commentLine('errors', columns.scaled ? 'multiplied by sqrt(weighted_mean_square_residual)' : 'not scaled'),
            exporter.commentLine('outcome', state.seq.outcome === null ? '' : state.seq.outcome),
        ];
        return comments.concat([seqHeader(columns, state.conditionName)], ran.map((row, at) => seqRow(state, row, at, columns.names)))
            .join('\n') + '\n';
    }

    globalThis.SasFitReport = Object.freeze({ EOL, HC_KEV_ANGSTROM, reportTxt, sequenceCsv });
})();
