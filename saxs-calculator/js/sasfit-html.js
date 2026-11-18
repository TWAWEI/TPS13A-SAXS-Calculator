/**
 * sasfit-html.js -- the HTML of the SAS fitting page as pure strings
 * (design spec 5.2-5.4, 5.7 items 5, 8 and 11, 13; plan M3 Task 8). Original code.
 *
 * Every function returns a string for an element's inner HTML and touches
 * nothing. SECURITY: text and attribute values are escaped where they are
 * put into the string -- text by esc(), attributes by attrs(), both through
 * host().FormUtils.escapeHtml (the only implementation). That covers file
 * names, header values, issue messages, formulas, parameter names and units,
 * hint and error texts. Numbers are formatted here (formatNumber,
 * formatValueError); a value that is not a finite number becomes MISSING and
 * is never interpolated. What selects a class or a link (tone, action, model
 * name) is looked up in a fixed table and throws when unknown; what becomes
 * part of an id is encoded by idToken().
 *
 *   fileRowsHtml(rows)            <tr> rows of #sfDataBody. rows: [{ id, index, fileName, hasData, shown, active,
 *                                 condition, statusText, statusTone?, issues, issueOverflow, locked }]
 *   paramTableHeadHtml(resultCtx) the <tr> of #sfParamHead
 *   paramTableHtml(rows, resultCtx)   <tr> rows of #sfParamBody from SasFitForm.rows(form); a polydisperse
 *                                 parameter is followed by its PD row (empty and hidden while closed)
 *       resultCtx = { fitResult | null, matches, locked? }: errors are shown only for a result that matches the
 *       form (SasFitJobs.resultMatchesForm); locked disables every control (a fit is running)
 *   paramErrorCells(rows, resultCtx)  [{ id, text }] of the error column, to update the cells without a rebuild
 *   optionsHtml(options, selected)    <option>s from [{ value, label }]
 *   modelOptionsHtml(groups, selected)   <optgroup>s of the model select from SasFitForm.models
 *   sldPanelHtml(view)            the formula panel of #sfSldPanel; view = { target, formula, density, presetId,
 *                                 result | null (SasFitSld.compute), error | null (an Error or a string) }
 *   sldOutputHtml(view)           only the content of #sfSldOutput (error, composition, SLD, preset source), so
 *                                 that typing does not rebuild the inputs
 *   weightingOptionsHtml(counts, hasSigma, selected)   <option>s; counts = SasFitHints.excludedCounts(dataset) | null
 *   resultsHtml(fitResult, ctx)   result tiles; ctx = { matches, fileName }
 *   hintsHtml(hints)              SasFitHints hints as compact alerts
 *   statusChipHtml({ text, tone })    a status chip
 *   modelInfoHtml(meta)           title, SasView documentation link, acknowledgement
 *   formatValueError(value, error, options?) -> { value, error, kind } (SasFitFormat.valueError)
 *   formatNumber(value, digits) (SasFitFormat.number for the screen);  unitText(units)
 *   paramFieldId(name, field), paramErrorId(name, field), fileControlId(id, action)   the ids used below
 *
 * Fields of the parameter table carry data-param and data-field: fit, value,
 * lower, upper, and for the dispersity pd.fit, pd.width, pd.lower, pd.upper,
 * pd.type, pd.npts, pd.nsigmas. Buttons and list controls carry data-action.
 *
 * No colours, no inline styles, no event handler attributes (CSP). Pure: no
 * DOM, no timers; FormUtils, ResultTiles and ChartTheme are read through
 * host() at call time, the SasFit modules from globalThis at call time.
 */

(function () {
    'use strict';

    const MISSING = '—';
    const UNBOUNDED = '不限';
    const NOT_COMPUTABLE = '無法計算';
    const VALUE_DIGITS = 5;
    const UNDETERMINED_NOTE = '誤差大於數值，此參數無法由資料決定';
    const BACKGROUND = 'background';
    const ABSOLUTE_UNIT = '1/cm';              // intensity of an official (absolute-scale) file
    const CHI2R_DIGITS = 3;
    const SLD_DIGITS = 6;
    const DENSITY_DIGITS = 4;
    const PARAM_COLUMNS = 7;
    const PD_SUFFIX = '_pd';
    const DOCS_URL = 'https://www.sasview.org/docs/user/models/';
    const SLD_UNIT = '1e-6/Ang^2';
    // 'e' alone next to a number reads like an exponent (100 e): it is spelled out
    const UNIT_TEXT = Object.freeze({
        Ang: 'Å', '1e-6/Ang^2': '10⁻⁶ Å⁻²', '1/Ang': 'Å⁻¹', '1/cm': 'cm⁻¹', degrees: '°', None: '', e: 'e（基本電荷）',
    });
    const TONES = Object.freeze(['ok', 'warn', 'error']);
    const ALERT_CLASS = Object.freeze({ ok: 'alert-info', warn: 'alert-warning', error: 'alert-error' });
    const ACTION_LABELS = Object.freeze({ continue: '從目前的值繼續擬合' });
    const WEIGHTING_LABELS = Object.freeze({ sigma: '資料 σ', sqrtI: '√|I|', absI: '|I|', none: '不加權' });
    const FIELD_IDS = Object.freeze({
        fit: 'sfFit_', value: 'sfValue_', lower: 'sfLower_', upper: 'sfUpper_',
        'pd.fit': 'sfPdFit_', 'pd.width': 'sfPdWidth_', 'pd.lower': 'sfPdLower_', 'pd.upper': 'sfPdUpper_',
        'pd.type': 'sfPdType_', 'pd.npts': 'sfPdNpts_', 'pd.nsigmas': 'sfPdNsigmas_',
    });
    const FILE_IDS = Object.freeze({ show: 'sfShow_', active: 'sfActive_', condition: 'sfCond_', remove: 'sfRemove_' });
    const FIELD_LABELS = Object.freeze({ value: ' 數值', lower: ' 下限', upper: ' 上限' });
    const PD_FIELDS = Object.freeze([
        Object.freeze({ key: 'width', text: '寬度', label: ' 的 PD 寬度', mode: 'decimal' }),
        Object.freeze({ key: 'lower', text: '寬度下限', label: ' 的 PD 寬度下限', mode: 'decimal' }),
        Object.freeze({ key: 'upper', text: '寬度上限', label: ' 的 PD 寬度上限', mode: 'decimal' }),
        Object.freeze({ key: 'npts', text: 'npts', label: ' 的 PD 點數', mode: 'numeric' }),
        Object.freeze({ key: 'nsigmas', text: 'nsigmas', label: ' 的 PD nsigmas', mode: 'decimal' }),
    ]);
    const TEXT = Object.freeze({
        stale: '參數已修改，下列為上次擬合的結果',
        sldApprox: '以 f ≈ Z 計算（忽略異常散射），SLD 與能量無關；含吸收邊靠近 15 keV 的元素'
            + '（Au、Pt 的 L 邊，Br、Sr 的 K 邊等）時誤差較大。',
        sldSyntax: '句點是小數點；水合物請寫成 CuSO4·5H2O 或 CuSO4(H2O)5',
        noSigma: '此檔沒有可用的誤差',
        docs: 'SasView 模型文件（另開視窗）',
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const esc = (value) => host().FormUtils.escapeHtml(value);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const text = (v) => (typeof v === 'string' ? v : '');
    const list = (v) => (Array.isArray(v) ? v : []);

    /** ' name="value"' for every entry; true -> a bare attribute; false, null and undefined -> nothing. */
    function attrs(map) {
        return Object.keys(map).map((name) => {
            const value = map[name];
            if (value === false || value === null || value === undefined) return '';
            return value === true ? ' ' + name : ' ' + name + '="' + esc(value) + '"';
        }).join('');
    }

    /** A string as part of an id: word characters stay, anything else becomes _u<code point>_. */
    function idToken(value) {
        return Array.from(String(value)).map((ch) => (/^[A-Za-z0-9_]$/.test(ch) ? ch : '_u' + ch.codePointAt(0).toString(16) + '_')).join('');
    }

    function assertTone(tone) {
        if (TONES.indexOf(tone) < 0) throw new Error('Unknown tone: ' + String(tone) + ' (expected one of ' + TONES.join(', ') + ')');
    }

    function paramFieldId(name, field) {
        if (!has(FIELD_IDS, field)) throw new Error('Unknown field: ' + String(field));
        return FIELD_IDS[field] + idToken(name);
    }

    function paramErrorId(name, field) {
        if (!has(FIELD_IDS, field) || field === 'fit' || field === 'pd.fit' || field === 'pd.type') {
            throw new Error('No error element for field: ' + String(field));
        }
        return 'sfErr_' + idToken(name) + '_' + field.replace('.', '_');
    }

    function fileControlId(id, action) {
        if (!has(FILE_IDS, action)) throw new Error('Unknown action: ' + String(action));
        return FILE_IDS[action] + idToken(id);
    }

    // ------------------------------------------------------------- numbers and units

    function unitText(units) {
        if (typeof units !== 'string') return '';
        return has(UNIT_TEXT, units) ? UNIT_TEXT[units] : units;
    }

    /** A number for the screen (SasFitFormat.number with U+2212 as minus); MISSING for anything that is not a finite number. */
    const formatNumber = (value, digits) => globalThis.SasFitFormat.display(globalThis.SasFitFormat.number(value, digits));

    /** { value, error, kind } for the screen: SasFitFormat.valueError, the one rule of the page. */
    const formatValueError = (value, error, options) => globalThis.SasFitFormat.valueError(value, error, options);

    // ------------------------------------------------------------- shared pieces

    function statusChipHtml(label) {
        assertTone(label.tone);
        return '<span class="tile-chip tile-chip--' + label.tone + '">' + esc(label.text) + '</span>';
    }

    const errorElHtml = (id, message) => '<p' + attrs({ class: 'sf-field-error', id, hidden: !message }) + '>' + esc(text(message)) + '</p>';

    const optionHtml = (value, label, selected, disabled) =>
        '<option' + attrs({ value, selected: selected === true, disabled: disabled === true }) + '>' + esc(label) + '</option>';

    /** The fit result whose errors the parameter table may show, or null. */
    function shownResult(resultCtx) {
        const r = isObject(resultCtx) ? resultCtx.fitResult : null;
        return isObject(r) && resultCtx.matches === true && r.status !== 'stopped' ? r : null;
    }

    /**
     * { value, error, kind } of a fitted name as the page displays it. The value is the one written into the
     * parameter table (SasFitFormat.inputValue), so a tile and its input never disagree. kind: the kinds of
     * SasFitFormat.valueError, or 'at-bound' (error = the text of design spec 5.7 item 5).
     */
    function fittedText(fitResult, name) {
        const format = globalThis.SasFitFormat;
        const exact = isObject(fitResult.params) ? fitResult.params[name] : NaN;
        if (isObject(fitResult.atBound) && has(fitResult.atBound, name)) {
            return { value: formatNumber(exact, VALUE_DIGITS), error: globalThis.SasFitHints.AT_BOUND_ERROR_TEXT, kind: 'at-bound' };
        }
        const errors = globalThis.SasFitWorkerCore.displayErrors(fitResult);
        const error = isObject(errors) ? errors[name] : NaN;
        return format.valueError(format.inputValue(exact, error), error, { illConditioned: fitResult.illConditioned === true });
    }

    /** The text of the error column for a parameter: empty unless it was fitted in the shown result. */
    function errorCellText(fitResult, name) {
        if (fitResult === null || list(fitResult.names).indexOf(name) < 0) return '';
        const fitted = fittedText(fitResult, name);
        if (fitted.kind === 'no-error') return NOT_COMPUTABLE;
        return fitted.kind === 'at-bound' || fitted.kind === 'undeterminable' ? fitted.error : '± ' + fitted.error;
    }

    // ------------------------------------------------------------- file list (design spec 5.2)

    function issuesHtml(row) {
        const max = globalThis.SasFitDataIo.LIMITS.MAX_ISSUES_LISTED;
        const issues = list(row.issues);
        if (issues.length === 0) return '';
        const more = Math.max(0, issues.length - max) + (Number.isInteger(row.issueOverflow) && row.issueOverflow > 0 ? row.issueOverflow : 0);
        const items = issues.slice(0, max).map((issue) =>
            '<li>' + (Number.isInteger(issue.line) ? '第 ' + issue.line + ' 行：' : '') + esc(issue.message) + '</li>');
        return '<ul class="sf-file-issues">' + items.join('') + (more > 0 ? '<li>另有 ' + more + ' 行</li>' : '') + '</ul>';
    }

    function seriesChipHtml(index) {
        const series = Number.isInteger(index) && index >= 0 ? index : 0;
        const dashed = series >= host().ChartTheme.PALETTES.light.series.length;
        return '<span' + attrs({ class: 'channel-chip sf-series-chip' + (dashed ? ' channel-chip--dashed' : ''),
            'data-series': String(series), 'aria-hidden': 'true' }) + '></span>';
    }

    function fileStatusHtml(row) {
        return row.statusTone === undefined || row.statusTone === null
            ? esc(row.statusText) : statusChipHtml({ text: row.statusText, tone: row.statusTone });
    }

    function removeButtonHtml(row) {
        return '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', id: fileControlId(row.id, 'remove'),
            'data-action': 'remove', 'data-id': row.id, 'aria-label': '移除 ' + row.fileName, disabled: row.locked === true })
            + '>移除</button>';
    }

    function fileNameCellHtml(row, chip) {
        return '<th scope="row" class="sf-file-name">' + chip + '<span class="sf-file-text">' + esc(row.fileName) + '</span>'
            + issuesHtml(row) + '</th>';
    }

    function failedFileRowHtml(row) {
        return '<tr' + attrs({ class: 'sf-file-row sf-file-row--failed', 'data-id': row.id }) + '><td></td><td></td>'
            + fileNameCellHtml(row, '') + '<td></td><td class="sf-file-status">' + fileStatusHtml(row) + '</td>'
            + '<td>' + removeButtonHtml(row) + '</td></tr>';
    }

    function fileRowHtml(row) {
        if (row.hasData !== true) return failedFileRowHtml(row);
        const control = (action, extra) => '<input' + attrs({ id: fileControlId(row.id, action), 'data-action': action, 'data-id': row.id, ...extra }) + '>';
        return '<tr' + attrs({ class: 'sf-file-row' + (row.active === true ? ' is-active' : ''), 'data-id': row.id }) + '>'
            + '<td>' + control('show', { type: 'checkbox', 'aria-label': '顯示 ' + row.fileName, checked: row.shown === true }) + '</td>'
            + '<td>' + control('active', { type: 'radio', name: 'sfActive', 'aria-label': '設為作用中：' + row.fileName,
                checked: row.active === true, disabled: row.locked === true }) + '</td>'
            + fileNameCellHtml(row, seriesChipHtml(row.index))
            + '<td>' + control('condition', { type: 'number', step: 'any', class: 'form-input sf-num',
                value: isNumber(row.condition) ? String(row.condition) : '', 'aria-label': row.fileName + ' 的條件值' }) + '</td>'
            + '<td class="sf-file-status">' + fileStatusHtml(row) + '</td>'
            + '<td>' + removeButtonHtml(row) + '</td></tr>';
    }

    const fileRowsHtml = (rows) => list(rows).map(fileRowHtml).join('');

    // ------------------------------------------------------------- parameter table (design spec 5.3)

    function paramTableHeadHtml(resultCtx) {
        const column = globalThis.SasFitHints.errorColumn(shownResult(resultCtx));
        const th = (label, title) => '<th' + attrs({ scope: 'col', title: title || null }) + '>' + esc(label) + '</th>';
        return '<tr>' + th('擬合') + th('參數') + th('數值') + th(column.label, column.title) + th('下限') + th('上限') + th('PD') + '</tr>';
    }

    /** A text input of the table with its error element. spec: { name, field, value, label, error, disabled, mode, placeholder }. */
    function fieldHtml(spec) {
        const errorId = paramErrorId(spec.name, spec.field);
        return '<input' + attrs({
            type: 'text', inputmode: spec.mode || 'decimal', class: 'form-input sf-num', id: paramFieldId(spec.name, spec.field),
            value: text(spec.value), placeholder: spec.placeholder || null, autocomplete: 'off',
            'data-param': spec.name, 'data-field': spec.field, 'aria-label': spec.label, 'aria-describedby': errorId,
            'aria-invalid': spec.error ? 'true' : null, disabled: spec.disabled === true,
        }) + '>' + errorElHtml(errorId, spec.error);
    }

    function checkHtml(name, field, label, checked, disabled) {
        return '<input' + attrs({ type: 'checkbox', id: paramFieldId(name, field), 'data-param': name, 'data-field': field,
            'aria-label': label, checked: checked === true, disabled }) + '>';
    }

    function pdTypeHtml(row, disabled) {
        const id = paramFieldId(row.name, 'pd.type');
        const options = globalThis.SasFitForm.PD_TYPES.map((type) => optionHtml(type, type, type === row.pd.type));
        return '<div class="sf-pd-field"><label' + attrs({ for: id }) + '>分布</label><select' + attrs({ class: 'form-select', id,
            'data-param': row.name, 'data-field': 'pd.type', 'aria-label': row.name + ' 的 PD 分布', disabled }) + '>'
            + options.join('') + '</select></div>';
    }

    function pdFieldHtml(row, def, locked) {
        const field = 'pd.' + def.key;
        const errors = isObject(row.pd.errors) ? row.pd.errors : {};
        return '<div class="sf-pd-field"><label' + attrs({ for: paramFieldId(row.name, field) }) + '>' + def.text + '</label>'
            + fieldHtml({ name: row.name, field, value: row.pd[def.key], label: row.name + def.label, error: errors[def.key],
                mode: def.mode, disabled: locked || (def.key === 'nsigmas' && row.pd.hasNsigmas !== true) }) + '</div>';
    }

    /** The row under a polydisperse parameter; it exists while closed too (hidden, empty) so that aria-controls resolves. */
    function pdRowHtml(row, fitResult, locked) {
        const open = '<tr' + attrs({ class: 'sf-pd-row', id: 'sfPdRow_' + idToken(row.name), 'data-param': row.name, hidden: row.pd.open !== true }) + '>';
        if (row.pd.open !== true) return open + '</tr>';
        const fields = PD_FIELDS.map((def) => pdFieldHtml(row, def, locked));
        return open + '<td colspan="' + PARAM_COLUMNS + '"><div' + attrs({ class: 'sf-pd-fields', role: 'group', 'aria-label': row.name + ' 的多分散度' }) + '>'
            + '<label class="sf-pd-field sf-pd-field--check">' + checkHtml(row.name, 'pd.fit', '擬合 ' + row.name + ' 的 PD 寬度', row.pd.fit, locked)
            + '<span>擬合寬度</span></label>'
            + fields[0]
            + '<span' + attrs({ class: 'sf-param-pm', id: 'sfPm_' + idToken(row.name + PD_SUFFIX) }) + '>'
            + esc(errorCellText(fitResult, row.name + PD_SUFFIX)) + '</span>'
            + fields[1] + fields[2] + pdTypeHtml(row, locked) + fields[3] + fields[4] + '</div></td></tr>';
    }

    function valueCellHtml(row, errors, disabled) {
        const button = row.isSld === true ? '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm',
            id: 'sfSldBtn_' + idToken(row.name), 'data-action': 'sld', 'data-param': row.name,
            'aria-label': '以化學式計算 ' + row.name, disabled }) + '>化學式</button>' : '';
        const input = fieldHtml({ name: row.name, field: 'value', value: row.value, label: row.name + FIELD_LABELS.value,
            error: errors.value, disabled });
        return '<td>' + input + button + '</td>';
    }

    function nameCellHtml(row, absolute) {
        const unit = unitText(row.name === BACKGROUND && absolute ? ABSOLUTE_UNIT : row.unit);
        return '<th scope="row"><span class="sf-param-name">' + esc(row.label === undefined ? row.name : row.label) + '</span>'
            + (unit === '' ? '' : '<span class="sf-param-unit">' + esc(unit) + '</span>')
            + (text(row.note) === '' ? '' : '<span class="sf-param-note">' + esc(row.note) + '</span>') + '</th>';
    }

    function pdToggleHtml(row, locked) {
        if (!isObject(row.pd)) return '<td></td>';
        return '<td><button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', id: 'sfPdToggle_' + idToken(row.name),
            'data-action': 'togglePd', 'data-param': row.name, 'aria-expanded': row.pd.open === true ? 'true' : 'false',
            'aria-controls': 'sfPdRow_' + idToken(row.name), 'aria-label': row.name + ' 的多分散度', disabled: locked }) + '>PD</button></td>';
    }

    function paramRowHtml(row, fitResult, locked, absolute) {
        const errors = isObject(row.errors) ? row.errors : {};
        const disabled = locked || row.fittable !== true;
        const bound = (field) => '<td>' + fieldHtml({ name: row.name, field, value: row[field], label: row.name + FIELD_LABELS[field],
            error: errors[field], placeholder: UNBOUNDED, disabled }) + '</td>';
        return '<tr' + attrs({ class: 'sf-param-row', 'data-param': row.name, 'data-group': row.group }) + '>'
            + '<td>' + (row.fittable === true ? checkHtml(row.name, 'fit', '擬合 ' + row.name, row.fit, locked) : '') + '</td>'
            + nameCellHtml(row, absolute) + valueCellHtml(row, errors, disabled)
            + '<td' + attrs({ class: 'sf-param-pm', id: 'sfPm_' + idToken(row.name) }) + '>' + esc(errorCellText(fitResult, row.name)) + '</td>'
            + bound('lower') + bound('upper') + pdToggleHtml(row, locked) + '</tr>'
            + (isObject(row.pd) ? pdRowHtml(row, fitResult, locked) : '');
    }

    function paramTableHtml(rows, resultCtx) {
        const fitResult = shownResult(resultCtx);
        const locked = isObject(resultCtx) && resultCtx.locked === true;
        const absolute = isObject(resultCtx) && resultCtx.absolute === true;
        return list(rows).map((row) => paramRowHtml(row, fitResult, locked, absolute)).join('');
    }

    /** [{ id, text }]: the text of every cell of the error column that paramTableHtml(rows, resultCtx) builds. */
    function paramErrorCells(rows, resultCtx) {
        const fitResult = shownResult(resultCtx);
        const cell = (name) => Object.freeze({ id: 'sfPm_' + idToken(name), text: errorCellText(fitResult, name) });
        return Object.freeze(list(rows).flatMap((row) => (
            isObject(row.pd) && row.pd.open === true ? [cell(row.name), cell(row.name + PD_SUFFIX)] : [cell(row.name)])));
    }

    // ------------------------------------------------------------- selects of the model segment (design spec 5.3)

    /** <option>s from [{ value, label }]; `selected` is compared as text. */
    function optionsHtml(options, selected) {
        return list(options).map((o) => optionHtml(String(o.value), text(o.label), String(o.value) === String(selected))).join('');
    }

    /** <optgroup>s of the model select from SasFitForm.models(query, keep). */
    function modelOptionsHtml(groups, selected) {
        return list(groups).map((g) => '<optgroup' + attrs({ label: text(g.group) }) + '>'
            + list(g.items).map((item) => optionHtml(item.name, item.name, item.name === selected)).join('') + '</optgroup>').join('');
    }

    // ------------------------------------------------------------- SLD panel (design spec 4.7)

    const presetOf = (id) => globalThis.SasFitSld.PRESETS.find((p) => p.id === id) || null;

    function presetRow(preset) {
        if (preset === null) return null;
        return { label: esc(preset.label), value: esc(preset.formula),
            note: [esc('密度 ' + String(preset.density) + ' g/cm³'), esc('出處：' + preset.source)] };
    }

    function sldRows(result) {
        if (!isObject(result)) return [];
        const atoms = Object.fromEntries(Object.entries(isObject(result.atoms) ? result.atoms : {}).filter(([, n]) => isNumber(n)));
        const composition = { label: '元素組成', value: esc(globalThis.SasFitSld.compositionText(atoms)) };
        if (!isNumber(result.sld)) return [composition];          // the formula parses but there is no density yet
        return [
            composition,
            { label: 'SLD', value: formatNumber(result.sld, SLD_DIGITS), unit: esc(unitText(SLD_UNIT)) },
            { label: '電子密度', value: formatNumber(result.electronDensity, DENSITY_DIGITS), unit: 'e/Å³' },
        ];
    }

    const sldErrorText = (error) => (error instanceof Error ? error.message : text(error));

    function sldOutputHtml(view) {
        const message = sldErrorText(view.error);
        const rows = message === '' ? sldRows(view.result) : [];
        return errorElHtml('sfSldError', message) + host().ResultTiles.rows(rows.concat(presetRow(presetOf(view.presetId))));
    }

    function sldInputsHtml(view) {
        const densityBad = isObject(view.error) && view.error.code === 'bad_density';
        const invalid = sldErrorText(view.error) !== '';
        const preset = presetOf(view.presetId);
        const options = [optionHtml('', '自訂', preset === null)]
            .concat(globalThis.SasFitSld.PRESETS.map((p) => optionHtml(p.id, p.label, p === preset)));
        const common = { type: 'text', class: 'form-input', autocomplete: 'off', spellcheck: 'false' };
        return '<div class="form-group"><label class="form-label" for="sfSldPreset">預設物質</label>'
            + '<select class="form-select" id="sfSldPreset">' + options.join('') + '</select></div>'
            + '<div class="form-group"><label class="form-label" for="sfSldFormula">化學式</label><input' + attrs({ ...common,
                id: 'sfSldFormula', value: text(view.formula), maxlength: String(globalThis.SasFitSld.MAX_FORMULA_LENGTH),
                'aria-describedby': 'sfSldError sfSldHelp', 'aria-invalid': invalid && !densityBad ? 'true' : null }) + '></div>'
            + '<div class="form-group"><label class="form-label" for="sfSldDensity">密度</label><div class="form-input-group"><input'
            + attrs({ ...common, inputmode: 'decimal', id: 'sfSldDensity', value: text(view.density), 'aria-describedby': 'sfSldError',
                'aria-invalid': densityBad ? 'true' : null }) + '><span class="input-unit">g/cm³</span></div></div>';
    }

    function sldPanelHtml(view) {
        const ready = isObject(view.result) && sldErrorText(view.error) === '';
        return '<div' + attrs({ class: 'sf-sld', role: 'group', 'aria-labelledby': 'sfSldTitle', 'data-target': view.target }) + '>'
            + '<p class="sf-sld-title" id="sfSldTitle">以化學式計算 SLD：<strong>' + esc(view.target) + '</strong></p>'
            + sldInputsHtml(view)
            + '<div id="sfSldOutput" aria-live="polite">' + sldOutputHtml(view) + '</div>'
            + '<p class="stat-sub" id="sfSldHelp">' + esc(TEXT.sldApprox + TEXT.sldSyntax) + '</p>'
            + '<div class="sf-sld-actions"><button' + attrs({ type: 'button', class: 'btn btn-primary btn-sm', id: 'sfSldApply', disabled: !ready })
            + '>套用</button><button type="button" class="btn btn-secondary btn-sm" id="sfSldCancel">取消</button></div></div>';
    }

    // ------------------------------------------------------------- fit segment (design spec 5.4, 5.7)

    function weightingOptionsHtml(counts, hasSigma, selected) {
        return globalThis.SasFitWeighting.MODES.map((mode) => {
            const unusable = mode === 'sigma' && !hasSigma;
            const n = isObject(counts) ? counts[mode] : null;
            const note = unusable ? '（' + TEXT.noSigma + '）' : Number.isInteger(n) ? '（排除 ' + n + ' 點）' : '';
            return optionHtml(mode, WEIGHTING_LABELS[mode] + note, mode === selected, unusable);
        }).join('');
    }

    /**
     * The display unit of a fitted name: from the model, then the structure factor; background is in the unit of
     * the intensity when the data are on absolute scale; dispersities and the rest have none.
     */
    function unitOf(modelSpec, name, absolute) {
        const meta = globalThis.SasFitMeta;
        if (name === BACKGROUND) return absolute ? unitText(ABSOLUTE_UNIT) : '';
        if (!isObject(modelSpec)) return '';
        const models = [modelSpec.model, modelSpec.structure].filter((m) => typeof m === 'string' && has(meta.models, m));
        for (const model of models) {
            const param = meta.models[model].params.find((p) => p.name === name);
            if (param !== undefined) return unitText(param.units);
        }
        return '';
    }

    function tileLabel(name) {
        const isPd = name.length > PD_SUFFIX.length && name.slice(-PD_SUFFIX.length) === PD_SUFFIX;
        return isPd ? name.slice(0, -PD_SUFFIX.length) + ' 的 PD 寬度' : name;
    }

    /** The lines under the value of a parameter tile. */
    function tileSubLines(fitted) {
        if (fitted.kind === 'no-error') return ['誤差' + NOT_COMPUTABLE];
        if (fitted.kind === 'at-bound') return [fitted.error];
        if (fitted.kind === 'undeterminable') return ['誤差' + fitted.error, UNDETERMINED_NOTE];
        return fitted.kind === 'undetermined' ? ['± ' + fitted.error, UNDETERMINED_NOTE] : ['± ' + fitted.error];
    }

    function paramTileHtml(fitResult, name, absolute) {
        const fitted = fittedText(fitResult, name);
        return host().ResultTiles.tile({ label: esc(tileLabel(String(name))), value: esc(fitted.value),
            unit: esc(unitOf(isObject(fitResult.settings) ? fitResult.settings.modelSpec : null, name, absolute)),
            sub: tileSubLines(fitted).map(esc) });
    }

    function heroTileHtml(fitResult) {
        const label = globalThis.SasFitHints.statusLabel(fitResult);
        assertTone(label.tone);
        const whole = (n) => (Number.isInteger(n) ? String(n) : MISSING);
        const points = Number.isInteger(fitResult.dof) ? fitResult.dof + list(fitResult.names).length : NaN;
        const measure = globalThis.SasFitHints.measure(fitResult);
        const counts = '自由度 ' + whole(fitResult.dof) + '・' + whole(points) + ' 點・' + whole(fitResult.iterations) + ' 次迭代';
        return host().ResultTiles.tile({ label: esc(measure.label), value: formatNumber(fitResult.chi2r, CHI2R_DIGITS), hero: true,
            chip: { tone: label.tone, text: esc(label.text) }, sub: [counts, esc(measure.note)] });
    }

    function resultsHtml(fitResult, ctx) {
        if (!isObject(fitResult)) return '';
        if (fitResult.status === 'stopped') {
            const step = Number.isInteger(fitResult.iterations) ? fitResult.iterations : MISSING;
            return '<p class="stat-sub sf-result-note">已停止（第 ' + step + ' 步），參數未變更</p>';
        }
        const context = isObject(ctx) ? ctx : {};
        const stale = context.matches === true ? '' : '<div class="alert alert--compact alert-warning">' + TEXT.stale + '</div>';
        const file = text(context.fileName) === '' ? '' : '<p class="stat-sub sf-result-file">' + esc(context.fileName) + '</p>';
        const tiles = [heroTileHtml(fitResult)]
            .concat(list(fitResult.names).map((name) => paramTileHtml(fitResult, name, context.absolute === true)));
        return stale + file + host().ResultTiles.tiles(tiles);
    }

    function hintHtml(hint) {
        assertTone(hint.tone);
        const action = hint.action === undefined || hint.action === null ? null : hint.action;
        if (action !== null && !has(ACTION_LABELS, action)) throw new Error('Unknown hint action: ' + String(action));
        const button = action === null ? '' : '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': action })
            + '>' + ACTION_LABELS[action] + '</button>';
        return '<div' + attrs({ class: 'alert alert--compact ' + ALERT_CLASS[hint.tone], 'data-hint': hint.id }) + '>'
            + '<span class="sf-hint-text">' + esc(hint.text) + '</span>' + button + '</div>';
    }

    const hintsHtml = (hints) => list(hints).map(hintHtml).join('');

    // ------------------------------------------------------------- model info (design spec 5.3, 17)

    function modelInfoHtml(meta) {
        const all = globalThis.SasFitMeta;
        const name = isObject(meta) ? meta.name : undefined;
        if (typeof name !== 'string' || !has(all.models, name) || !/^\w+$/.test(name)) throw new Error('Unknown model: ' + String(name));
        return '<p class="sf-model-title">' + esc(meta.title) + '</p>'
            + '<p class="stat-sub"><a' + attrs({ href: DOCS_URL + name + '.html', target: '_blank', rel: 'noopener' }) + '>' + TEXT.docs + '</a></p>'
            + '<p class="stat-sub">' + esc('模型計算核心：SasView sasmodels ' + all.sasmodelsVersion
                + '（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly') + '</p>';
    }

    globalThis.SasFitHtml = Object.freeze({
        MISSING,
        fileRowsHtml, paramTableHeadHtml, paramTableHtml, paramErrorCells, optionsHtml, modelOptionsHtml, sldPanelHtml, sldOutputHtml, weightingOptionsHtml, resultsHtml,
        hintsHtml, statusChipHtml, modelInfoHtml, formatValueError, formatNumber, unitText,
        paramFieldId, paramErrorId, fileControlId,
    });
})();
