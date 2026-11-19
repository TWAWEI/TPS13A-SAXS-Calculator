/**
 * sasfit-iucr.js -- what the SAS fitting page sends to the IUCr table page:
 * the data object, whether a result may be sent, and the rows of the block
 * "Model fitting (analytical scattering model)" as an HTML string (design
 * spec 8; plan M4 Task 16; fix pass after the M4 reviews). Original code.
 *
 *   HEADING, SENDABLE, FIXED_NOTE
 *   canSend(form, fitResult) -> { ok, reason }
 *       ok only for a result whose status is in SENDABLE ('converged'), that
 *       was fitted with the data's sigma as weights (project owner,
 *       2026-11-19: no other weighting has an accepted goodness-of-fit
 *       statistic to report), that was not blocked by a region the model
 *       cannot compute, and that still matches the parameter table
 *       (SasFitJobs.resultMatchesForm): what goes into a submission table
 *       must be the parameters on the screen.
 *       Warnings (a parameter on a bound, ill-conditioning, strong
 *       correlations, ...) do not stop it: they become Notes rows. reason is
 *       Traditional Chinese for the page ('' when ok).
 *   data({ fileName, fitResult, form, version, absolute? }) -> frozen sasfitData
 *       { datasetName, model, structureFactorMode, radiusEffectiveMode,
 *         params: [{ name, value, error, errorScaled, errorShown, unit, fitted, atBound }],
 *         measure: { isChi2, label, value }, chi2r, errorsScaled, dof, qMin,
 *         qMax, npoints, weighting, status, assumptions: [text], notes: [text],
 *         software }
 *       Everything comes from the FitResult (SasFitExport.paramRows); the form
 *       is only used for canSend, and data() throws when that fails. An open
 *       dispersity is a row <name>_pd whose unit is the distribution. Texts
 *       are English (the table is), numbers stay numbers. `absolute` (official
 *       file) gives the background its unit. There is no CorMap P-value: this
 *       tool does not compute one, and the first note (FIXED_NOTE) says so and
 *       that the block is supplementary to the IUCr template. measure.isChi2
 *       is always true and errorsScaled always false (sigma weighting only);
 *       the keys stay for readers of the object. An assumption of an open
 *       dispersity says what its width means for that distribution
 *       (sasmodels weights.py).
 *   rowsHtml(data | null) -> the <tr>s of the block: the heading, then either
 *       the placeholder (null) or the rows. Five columns as the table's head:
 *       (blank) | Parameter | Value | +- | Unit. Value and error follow the
 *       page's display rule (SasFitFormat, the value rounded as it is written
 *       back); a fixed parameter has 'fixed', one on a bound 'at upper bound'
 *       in the error column. Ids are 'iucr-sf-' + lower-case letters, digits
 *       and single hyphens, numbered -- a parameter name never becomes an id.
 *       It accepts ANY object: missing or wrong fields give empty cells.
 *
 * The fit measure is the reduced chi-square: only fits with sigma weighting
 * get here (decision 24 names the measure of the others, which stay on the
 * SAS fitting page and in its exports).
 *
 * SECURITY: every string that reaches the HTML passes FormUtils.escapeHtml
 * here -- the file name, parameter names, units, notes, the software text.
 *
 * Pure: no DOM, no timers; nothing given is modified; other globals are read
 * at call time (FormUtils through host()).
 */

(function () {
    'use strict';

    const HEADING = 'Model fitting (analytical scattering model)';
    const FIXED_NOTE = 'Supplementary to the IUCr template; applies to the data file named here. CorMap P-value not computed.';
    const SENDABLE = Object.freeze(['converged']);
    const EMPTY_TEXT = '尚未送入擬合結果';
    const ID = 'iucr-sf';
    const COLUMNS = 5;
    const HAYTER = 'hayter_msa';
    const PD_SUFFIX = '_pd';
    const MEASURE_DIGITS = 3;
    const RANGE_DIGITS = 3;
    const CORRELATION_DIGITS = 3;
    const SHOWN_DIGITS = 5;
    const Q_UNIT = 'Å⁻¹';
    const CHARGE_UNIT = 'e';
    const CHARGE_TEXT = 'e (elementary charge)';
    const REASONS = Object.freeze({
        none: '尚未擬合',
        notConverged: '擬合未收斂，不能送進表格',
        failed: '擬合失敗，不能送進表格',
        blocked: '擬合被無法計算的區域擋住，不能送進表格',
        changed: '參數在擬合後改過；請重新擬合，或還原擬合前的參數',
        weighting: '只有以資料 σ 加權的擬合可以送進 IUCr 表格（其他權重沒有公認的適合度統計量）',
    });
    const WEIGHTING_NAMES = Object.freeze({ sigma: '1/σ² (data errors)' });
    // what the width of a distribution is (sasmodels weights.py; the centre is the parameter's value)
    const PD_WIDTHS = Object.freeze({
        gaussian: 'width = σ/centre (relative standard deviation)',
        schulz: 'width = σ/centre (relative standard deviation; the centre is the mean)',
        rectangle: 'width = σ/centre (relative standard deviation; half-width √3 σ)',
        lognormal: 'width = σ of ln x; the centre is the median',
        uniform: 'width = half-width/centre',
        boltzmann: 'width = e-folding length/centre',
    });
    const TEXT = Object.freeze({
        chi2: 'Reduced χ²',
        dof: (value, dof) => value + ' (dof ' + dof + ')',
        errorsPlain: '1 s.d., not scaled',
        sld: 'X-ray SLDs: where computed with the formula calculator of this tool, f ≈ Z (no anomalous correction)',
        hayter: 'hayter_msa (sasmodels) can return discontinuous or non-computable points at low q, as in SasView; '
            + 'the errors of the fitted parameters may be unreliable',
        lowQ: 'Low-q power law lowq_scale × q^(−lowq_power) added to the model; it shares the background',
        structure: (name, combination, radius) => 'Structure factor ' + name + ' combined as ' + combination + '; effective radius: ' + radius,
        pdFitted: (name, pd) => name + ': ' + pd.type + ' distribution, fitted width (' + name + PD_SUFFIX + '), ' + pdTail(pd) + pdMeaning(pd),
        pdFixed: (name, pd, width) => name + ': ' + pd.type + ' distribution, width ' + width + ' (fixed), ' + pdTail(pd) + pdMeaning(pd),
        atBound: (name, side) => name + ' at ' + side + ' bound; its error is not meaningful',
        illConditioned: 'The parameters cannot be determined independently from the data (ill-conditioned); the errors are unreliable',
        jacobian: 'The error could not be computed for some parameters; the other errors are underestimated',
        correlated: (a, b, r) => a + ' and ' + b + ' are strongly correlated (r = ' + r + ')',
        undetermined: (name) => name + ': error larger than the value (not determined by these data)',
        chi2High: 'Reduced χ² is much larger than 1: model and data disagree; the parameter errors are not meaningful',
        curve: (count) => 'The model curve could not be computed at ' + count + ' points',
        boundCell: (side) => 'at ' + side + ' bound',
        fixed: 'fixed',
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const esc = (value) => host().FormUtils.escapeHtml(value);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const text = (v) => (typeof v === 'string' ? v : (isNumber(v) ? String(v) : ''));
    const list = (v) => (Array.isArray(v) ? v : []);
    const shownNumber = (value, digits) => globalThis.SasFitFormat.display(globalThis.SasFitFormat.number(value, digits));
    /** A setting (a count, a number of sigmas) as the user typed it: every digit, no rounding. */
    const settingText = (value) => (isNumber(value) ? globalThis.SasFitFormat.display(String(value)) : globalThis.SasFitFormat.MISSING);

    function pdTail(pd) {
        return settingText(pd.npts) + ' points' + (pd.nsigmas === null ? '' : ', ±' + settingText(pd.nsigmas) + 'σ');
    }

    const pdMeaning = (pd) => (has(PD_WIDTHS, pd.type) ? '; ' + PD_WIDTHS[pd.type] : '');

    function deepFreeze(value) {
        if (!isObject(value) || Object.isFrozen(value)) return value;
        Object.values(value).forEach(deepFreeze);
        return Object.freeze(value);
    }

    // ------------------------------------------------------------- may it be sent

    const refuse = (reason) => Object.freeze({ ok: false, reason });

    function canSend(form, fitResult) {
        if (!isObject(fitResult)) return refuse(REASONS.none);
        if (fitResult.blockedByNonFinite === true) return refuse(REASONS.blocked);
        if (fitResult.status === 'failed') return refuse(REASONS.failed);
        if (SENDABLE.indexOf(fitResult.status) < 0) return refuse(REASONS.notConverged);
        if (!globalThis.SasFitHints.measure(fitResult).isChi2) return refuse(REASONS.weighting);
        if (!globalThis.SasFitJobs.resultMatchesForm(form, fitResult)) return refuse(REASONS.changed);
        return Object.freeze({ ok: true, reason: '' });
    }

    // ------------------------------------------------------------- the data object

    function hasSld(modelSpec) {
        const meta = globalThis.SasFitMeta.models[modelSpec.model];
        return isObject(meta) && meta.params.some((p) => p.type === 'sld');
    }

    function assumptionsOf(fitResult, rows) {
        const exporter = globalThis.SasFitExport;
        const { modelSpec } = fitResult.settings;
        const out = rows.filter((row) => row.pd !== null).map((row) => {
            const base = row.name.slice(0, -PD_SUFFIX.length);
            return row.fitted ? TEXT.pdFitted(base, row.pd) : TEXT.pdFixed(base, row.pd, settingText(row.value));
        });
        if (hasSld(modelSpec)) out.push(TEXT.sld);
        if (typeof modelSpec.structure === 'string') {
            out.push(TEXT.structure(modelSpec.structure, exporter.combinationText(fitResult), exporter.radiusModeText(fitResult)));
        }
        if (modelSpec.structure === HAYTER) out.push(TEXT.hayter);
        if (modelSpec.lowQPowerLaw === true) out.push(TEXT.lowQ);
        return out;
    }

    function notesOf(fitResult, rows) {
        const hints = globalThis.SasFitHints;
        const format = globalThis.SasFitFormat;
        const out = [FIXED_NOTE].concat(rows.filter((row) => row.atBound !== null).map((row) => TEXT.atBound(row.name, row.atBound)));
        if (fitResult.illConditioned === true) out.push(TEXT.illConditioned);
        if (fitResult.jacobianNonFinite === true) out.push(TEXT.jacobian);
        hints.strongCorrelations(fitResult).forEach((p) => out.push(TEXT.correlated(p.a, p.b, shownNumber(p.r, CORRELATION_DIGITS))));
        rows.filter((row) => row.fitted && row.atBound === null && format.isUndetermined(row.value, row.errorShown))
            .forEach((row) => out.push(TEXT.undetermined(row.name)));
        if (isNumber(fitResult.chi2r) && fitResult.chi2r > hints.CHI2R_WARN) out.push(TEXT.chi2High);
        if (fitResult.nonFiniteCurvePoints > 0) out.push(TEXT.curve(fitResult.nonFiniteCurvePoints));
        return out;
    }

    function paramOf(row) {
        // the page spells the charge unit out in Chinese; this table is English
        const unit = row.pd !== null ? row.pd.type : (row.unit === CHARGE_UNIT ? CHARGE_TEXT : globalThis.SasFitHtml.unitText(row.unit));
        return {
            name: row.name, value: row.value, error: row.error, errorScaled: row.errorScaled, errorShown: row.errorShown, unit,
            fitted: row.fitted, atBound: row.atBound,
        };
    }

    function data(input) {
        const { fileName, fitResult, form, version, absolute } = isObject(input) ? input : {};
        const sendable = canSend(form, fitResult);
        if (!sendable.ok) throw new Error('SasFitIucr.data: this result cannot be sent (' + sendable.reason + ')');
        const exporter = globalThis.SasFitExport;
        const software = exporter.software(version);
        const { settings } = fitResult;
        const rows = exporter.paramRows(fitResult, null, { absolute: absolute === true });
        const measure = { isChi2: true, label: TEXT.chi2, value: fitResult.chi2r };       // canSend: sigma weighting only
        return deepFreeze({
            datasetName: text(fileName), model: exporter.modelText(settings.modelSpec),
            structureFactorMode: exporter.combinationText(fitResult), radiusEffectiveMode: exporter.radiusModeText(fitResult),
            params: rows.map(paramOf), measure, chi2r: fitResult.chi2r, errorsScaled: false,
            dof: fitResult.dof, qMin: settings.range.qMin, qMax: settings.range.qMax, npoints: fitResult.dof + fitResult.names.length,
            weighting: settings.weighting, status: fitResult.status,
            assumptions: assumptionsOf(fitResult, rows), notes: notesOf(fitResult, rows), software,
        });
    }

    // ------------------------------------------------------------- rows

    const rowId = (suffix) => ' id="' + esc(ID + '-' + suffix) + '"';

    /** One row of five columns: (blank) | label | value | error | unit. labelHtml is trusted HTML written in this file. */
    function row(suffix, labelHtml, value, error, unit) {
        return '<tr' + rowId(suffix) + '><td></td><td>' + labelHtml + '</td><td>' + esc(text(value)) + '</td><td>' + esc(text(error))
            + '</td><td>' + esc(text(unit)) + '</td></tr>';
    }

    /** A row whose text takes the last three columns (sentences, the software line). */
    function wideRow(suffix, label, value) {
        return '<tr' + rowId(suffix) + '><td></td><td>' + esc(label) + '</td><td colspan="' + (COLUMNS - 2) + '">' + esc(text(value)) + '</td></tr>';
    }

    const headingRow = () => '<tr' + rowId('heading') + ' class="table-section-header"><td colspan="' + COLUMNS + '">' + esc(HEADING) + '</td></tr>';

    /** [value, error] of a parameter as the page shows them (the rule of the result tiles). */
    function shownPair(param) {
        const format = globalThis.SasFitFormat;
        const value = isObject(param) ? param.value : NaN;
        if (!isObject(param) || param.fitted !== true) {
            return [isNumber(value) ? format.display(format.inputText(value, NaN)) : format.MISSING, TEXT.fixed];
        }
        if (param.atBound !== null && param.atBound !== undefined) return [shownNumber(value, SHOWN_DIGITS), TEXT.boundCell(text(param.atBound))];
        const shown = format.valueError(format.inputValue(value, param.errorShown), param.errorShown);
        return [shown.value, shown.error];
    }

    function paramRow(param, index) {
        const [value, error] = shownPair(param);
        return row('p-' + index, esc(isObject(param) ? text(param.name) : ''), value, error, isObject(param) ? param.unit : '');
    }

    /** One row per sentence; only the first carries the title. */
    const sentenceRows = (prefix, title, sentences) => list(sentences).map((sentence, i) => wideRow(prefix + '-' + i, i === 0 ? title : '', sentence));

    function qRangeText(d) {
        const format = globalThis.SasFitFormat;
        const one = (q) => (isNumber(q) ? format.display(String(Number(format.number(q, RANGE_DIGITS)))) : format.MISSING);
        return one(d.qMin) + '–' + one(d.qMax);
    }

    /** '1.02 (dof 54)': the reduced chi-square with its degrees of freedom. */
    function measureText(measure, dof) {
        const value = shownNumber(measure.value, MEASURE_DIGITS);
        return Number.isInteger(dof) ? TEXT.dof(value, String(dof)) : value;
    }

    function fitRows(d) {
        const measure = isObject(d.measure) ? d.measure : {};
        const weighting = has(WEIGHTING_NAMES, d.weighting) ? WEIGHTING_NAMES[d.weighting] : text(d.weighting);
        return [
            row('qrange', '<i>q</i>-range for fitting', qRangeText(d), '', Q_UNIT),
            row('npoints', 'Number of points', Number.isInteger(d.npoints) ? String(d.npoints) : globalThis.SasFitFormat.MISSING, '', ''),
            row('weighting', 'Weighting', weighting, '', ''),
            row('measure', esc(text(measure.label)), measureText(measure, d.dof), '', ''),
            row('status', 'Status', d.status, '', ''),
            wideRow('errors', 'Parameter errors (±)', TEXT.errorsPlain),
        ];
    }

    function rowsHtml(data) {
        if (!isObject(data)) {
            return headingRow() + '<tr' + rowId('empty') + '><td></td><td colspan="' + (COLUMNS - 1) + '">' + EMPTY_TEXT + '</td></tr>';
        }
        const combination = text(data.structureFactorMode) === '' ? [] : [row('sfmode', 'Structure-factor combination', data.structureFactorMode, '', '')];
        return [headingRow(), row('file', 'Data file', data.datasetName, '', ''), row('model', 'Model', data.model, '', '')]
            .concat(combination, list(data.params).map(paramRow), fitRows(data),
                sentenceRows('a', 'Assumptions', data.assumptions), sentenceRows('n', 'Notes', data.notes),
                [wideRow('software', 'Software', data.software)])
            .join('');
    }

    globalThis.SasFitIucr = Object.freeze({ HEADING, SENDABLE, FIXED_NOTE, EMPTY_TEXT, canSend, data, rowsHtml });
})();
