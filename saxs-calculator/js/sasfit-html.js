/**
 * sasfit-html.js -- the HTML of the SAS fitting page as pure strings
 * (design spec 5.2-5.4, 5.7 items 5, 8 and 11, 13; plan M3 Task 8; fix pass B
 * after the UI review of 2026-11-19). Original code.
 *
 * Every function returns a string for an element's inner HTML and touches
 * nothing. SECURITY: text and attribute values are escaped where they are
 * put into the string -- text by esc(), attributes by attrs(), both through
 * host().FormUtils.escapeHtml (the only implementation). That covers file
 * names, header values, issue messages, formulas, parameter names and units,
 * hint and error texts, the condition name. Numbers are formatted by
 * SasFitFormat; a value that is not a finite number becomes MISSING and is
 * never interpolated. What selects a class or a link (tone, action, model
 * name) is looked up in a fixed table and throws when unknown; what becomes
 * part of an id is encoded by idToken(). The only markup that is not built
 * from escaped text is fixed here: the chi-square of the fit measure
 * (CHI2_HTML, <sup> / <sub>) and the <wbr> after an underscore of a name.
 *
 *   fileRowsHtml(rows)            <tr> rows of #sfDataBody (five columns: show, fit target, name with its
 *                                 status under it, condition, remove). rows: [{ id, index, fileName, hasData,
 *                                 shown, active, condition, conditionName, statusText, statusTone?,
 *                                 statusMeasure?: { isChi2, label, value, short }, issues, issueOverflow, locked }]
 *   middleEllipsis(name)          a long file name without its middle (the title has all of it)
 *   paramTableHeadHtml(resultCtx) the <tr> of #sfParamHead: fit / parameter / value / error / (details)
 *   paramTableHtml(rows, resultCtx)   <tr> rows of #sfParamBody from SasFitForm.rows(form). Per parameter:
 *                                 its row of five cells (the last one a disclosure button), a full-width line
 *                                 for the message of its value, and a detail row with its bounds, its
 *                                 dispersity (a switch, and the fields while it takes part) and, for an SLD
 *                                 parameter, the formula button with the panel in the same row. A closed
 *                                 detail row is an empty hidden <tr>, so that aria-controls resolves.
 *       resultCtx = { fitResult | null, matches, locked?, absolute?, details?: { name: boolean },
 *                     sld?: view of the open formula panel }: errors are shown only for a result that
 *       matches the form (SasFitJobs.resultMatchesForm); locked disables every control (a fit is running)
 *   detailOpen(row, fitResult, details), openDetails(rows, resultCtx)   which detail rows are open
 *   paramErrorCells(rows, resultCtx)  [{ id, text }] of the cells that change while the table stays: the
 *                                 error column and the markers of collapsed rows (SasFitLabels.paramMarker)
 *   optionsHtml(options, selected)    <option>s from [{ value, label }]
 *   modelOptionsHtml(groups, selected)   <optgroup>s of the model select: 'sphere — 均勻球' (SasFitLabels)
 *   sldPanelHtml(view)            the formula panel; view = { target, formula, density, presetId,
 *                                 result | null (SasFitSld.compute), error | null (an Error or a string) }
 *   sldOutputHtml(view)           only the content of #sfSldOutput (error, composition, SLD, preset source), so
 *                                 that typing does not rebuild the inputs
 *   weightingOptionsHtml(counts, hasSigma, selected)   <option>s; counts = SasFitHints.excludedCounts(dataset) | null
 *   resultsHtml(fitResult, ctx)   the head of the results: notice of a result that is not the current one,
 *                                 file name, the ONE hero tile; ctx = { matches, notApplied, running, fileName, hasData }
 *   resultParamsHtml(fitResult, ctx)  the fitted parameters, shown after the hints: tiles (a list for screen
 *                                 readers), or a read-only list above four of them; ctx = { absolute }
 *   fitBarHtml(view)              the fit measure of the fit bar; view = { result, matches, running }
 *   measureHtml(measure)          the name of the fit measure: chi-square with <sup> / <sub> only for sigma weighting
 *   hintsHtml(hints)              SasFitHints hints as compact alerts
 *   statusChipHtml({ text, tone })    a status chip
 *   modelInfoHtml(meta)           title, SasView documentation link, acknowledgement
 *   formatValueError(value, error), formatNumber(value, digits), unitText(units)
 *   paramFieldId, paramErrorId, paramErrorRowId, detailRowId, moreButtonId, markerId, sldSlotId, fileControlId
 *
 * Fields of the parameter table carry data-param and data-field: fit, value,
 * lower, upper, and for the dispersity pd.fit, pd.width, pd.lower, pd.upper,
 * pd.type, pd.npts, pd.nsigmas. Buttons and list controls carry data-action
 * (toggleDetail, togglePd, sld; show, active, condition, remove; continue).
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
    const UNDETERMINED_NOTE = '誤差大於數值：與 0 無法區分，或無法由這組資料決定';
    const BACKGROUND = 'background';
    const ABSOLUTE_UNIT = '1/cm';              // intensity of an official (absolute-scale) file
    const CHI2R_DIGITS = 3;
    const SLD_DIGITS = 6;
    const DENSITY_DIGITS = 4;
    const PARAM_COLUMNS = 5;
    const DETAIL_HEAD = '範圍與多分散';
    const MORE_LABEL = '更多';
    const PD_LABEL = '多分散';
    const CONDITION_NAME = '條件值';
    const NAME_MAX = 44;                      // file names longer than this lose their middle on screen (title: all of it)
    const NAME_HEAD = 26;
    const ELLIPSIS = '…';
    const LIST_MAX_TILES = 4;                 // more fitted parameters than this are a list, not tiles
    const CHI2_HTML = 'χ<sup>2</sup><sub>r</sub>';      // "約化 χ²" in plain text (SasFitHints.measure().label)
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
        Object.freeze({ key: 'width', text: '寬度', label: ' 的多分散寬度', mode: 'decimal' }),
        Object.freeze({ key: 'lower', text: '寬度下限', label: ' 的多分散寬度下限', mode: 'decimal' }),
        Object.freeze({ key: 'upper', text: '寬度上限', label: ' 的多分散寬度上限', mode: 'decimal' }),
        Object.freeze({ key: 'npts', text: '取點數', label: ' 的多分散取點數', mode: 'numeric' }),
        Object.freeze({ key: 'nsigmas', text: '範圍（σ 倍數）', label: ' 的多分散範圍（σ 倍數）', mode: 'decimal' }),
    ]);
    const TEXT = Object.freeze({
        stale: '參數已改動，以下是上一次擬合的結果（不是目前參數的）',
        running: '擬合進行中，以下是上一次擬合的結果',
        notFitted: '尚未擬合',
        staleChip: '參數已改動',
        sldApprox: '以 f ≈ Z 計算（忽略異常散射），SLD 與能量無關。15 keV 下，含 Rb、Sr、Y、Zr、Br、Kr 或 Pt、Au、Hg、Tl、Pb、Bi、'
            + 'Th、U 的物質，實際 SLD 會低約 4–10 %（例：Au 131.5 → 約 124），對比度平方的誤差約為兩倍；其他能量下受影響的元素不同。',
        sldSyntax: '句點是小數點；水合物請寫成 CuSO4·5H2O 或 CuSO4(H2O)5；氘寫成 D（例：D2O）',
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

    const detailRowId = (name) => 'sfDetail_' + idToken(name);
    const moreButtonId = (name) => 'sfMore_' + idToken(name);
    const markerId = (name) => 'sfMark_' + idToken(name);
    const paramErrorRowId = (name) => 'sfErrRow_' + idToken(name);
    const sldSlotId = (name) => 'sfSldSlot_' + idToken(name);

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

    /** The name of the fit measure as HTML: chi-square with real super- and subscripts, anything else as text. */
    const measureHtml = (measure) => (isObject(measure) && measure.isChi2 === true ? CHI2_HTML : esc(isObject(measure) ? text(measure.label) : ''));

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
            const short = globalThis.SasFitHints.AT_BOUND_SHORT;
            const side = fitResult.atBound[name];
            return { value: formatNumber(exact, VALUE_DIGITS), error: globalThis.SasFitHints.AT_BOUND_ERROR_TEXT, kind: 'at-bound',
                short: has(short, side) ? short[side] : globalThis.SasFitHints.AT_BOUND_ERROR_TEXT };
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
        if (fitted.kind === 'at-bound') return fitted.short;          // the hint and the tile have the sentence
        return fitted.kind === 'undeterminable' ? fitted.error : '± ' + fitted.error;
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

    /** A long name with its middle cut out (the ends tell files of one series apart); the cell's title has all of it. */
    function middleEllipsis(name) {
        const chars = Array.from(text(name));
        if (chars.length <= NAME_MAX) return chars.join('');
        return chars.slice(0, NAME_HEAD).join('') + ELLIPSIS + chars.slice(chars.length - (NAME_MAX - NAME_HEAD - 1)).join('');
    }

    /**
     * The status of a file. Without a result: plain text. With one: a short chip -- the fit measure, its value and
     * (unless the fit simply converged) one word that says what is wrong, so the colour is never the only cue --
     * with the full status as title and for screen readers.
     */
    function fileStatusHtml(row) {
        if (row.statusTone === undefined || row.statusTone === null) return esc(row.statusText);
        const m = row.statusMeasure;
        if (!isObject(m)) return statusChipHtml({ text: row.statusText, tone: row.statusTone });
        assertTone(row.statusTone);
        const short = text(m.short) === '' ? '' : ' ' + esc(m.short);
        return '<span' + attrs({ class: 'tile-chip tile-chip--' + row.statusTone, title: row.statusText }) + '>'
            + '<span aria-hidden="true">' + measureHtml(m) + ' ' + esc(m.value) + short + '</span>'
            + '<span class="sr-only">' + esc(row.statusText) + '</span></span>';
    }

    function removeButtonHtml(row) {
        return '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', id: fileControlId(row.id, 'remove'),
            'data-action': 'remove', 'data-id': row.id, 'aria-label': '移除 ' + row.fileName, disabled: row.locked === true })
            + '>移除</button>';
    }

    function fileNameCellHtml(row, chip) {
        return '<th scope="row" class="sf-file-name">' + chip + '<span' + attrs({ class: 'sf-file-text', title: row.fileName }) + '>'
            + esc(middleEllipsis(row.fileName)) + '</span><span class="sf-file-status">' + fileStatusHtml(row) + '</span>'
            + issuesHtml(row) + '</th>';
    }

    function failedFileRowHtml(row) {
        return '<tr' + attrs({ class: 'sf-file-row sf-file-row--failed', 'data-id': row.id }) + '><td></td><td></td>'
            + fileNameCellHtml(row, '') + '<td></td><td>' + removeButtonHtml(row) + '</td></tr>';
    }

    function fileRowHtml(row) {
        if (row.hasData !== true) return failedFileRowHtml(row);
        const control = (action, extra) => '<input' + attrs({ id: fileControlId(row.id, action), 'data-action': action, 'data-id': row.id, ...extra }) + '>';
        const condition = text(row.conditionName).trim() === '' ? CONDITION_NAME : row.conditionName.trim();
        return '<tr' + attrs({ class: 'sf-file-row' + (row.active === true ? ' is-active' : ''), 'data-id': row.id }) + '>'
            + '<td>' + control('show', { type: 'checkbox', 'aria-label': '顯示 ' + row.fileName, checked: row.shown === true }) + '</td>'
            + '<td>' + control('active', { type: 'radio', name: 'sfActive', 'aria-label': '設為擬合對象：' + row.fileName,
                checked: row.active === true, disabled: row.locked === true }) + '</td>'
            + fileNameCellHtml(row, seriesChipHtml(row.index))
            + '<td>' + control('condition', { type: 'number', step: 'any', class: 'form-input sf-num',
                value: isNumber(row.condition) ? String(row.condition) : '', 'aria-label': row.fileName + ' 的' + condition }) + '</td>'
            + '<td>' + removeButtonHtml(row) + '</td></tr>';
    }

    const fileRowsHtml = (rows) => list(rows).map(fileRowHtml).join('');

    // ------------------------------------------------------------- parameter table (design spec 5.3)

    function paramTableHeadHtml(resultCtx) {
        const column = globalThis.SasFitHints.errorColumn(shownResult(resultCtx));
        const th = (label, title) => '<th' + attrs({ scope: 'col', title: title || null }) + '>' + esc(label) + '</th>';
        return '<tr>' + th('擬合') + th('參數') + th('數值') + th(column.label, column.title)
            + '<th scope="col"><span class="sr-only">' + DETAIL_HEAD + '</span></th></tr>';
    }

    /** A text input of the table. spec: { name, field, value, label, error, disabled, mode, placeholder }. */
    function inputHtml(spec) {
        return '<input' + attrs({
            type: 'text', inputmode: spec.mode || 'decimal', class: 'form-input sf-num', id: paramFieldId(spec.name, spec.field),
            value: text(spec.value), placeholder: spec.placeholder || null, autocomplete: 'off',
            'data-param': spec.name, 'data-field': spec.field, 'aria-label': spec.label, 'aria-describedby': paramErrorId(spec.name, spec.field),
            'aria-invalid': spec.error ? 'true' : null, disabled: spec.disabled === true,
        }) + '>';
    }

    const fieldErrorHtml = (name, field, message) => errorElHtml(paramErrorId(name, field), message);

    /** An input of a detail row with its visible label above it. */
    function labelledHtml(spec, caption) {
        return '<div class="sf-detail-field"><label' + attrs({ for: paramFieldId(spec.name, spec.field) }) + '>' + caption + '</label>'
            + inputHtml(spec) + '</div>';
    }

    function checkHtml(name, field, label, checked, disabled) {
        return '<input' + attrs({ type: 'checkbox', id: paramFieldId(name, field), 'data-param': name, 'data-field': field,
            'aria-label': label, checked: checked === true, disabled }) + '>';
    }

    function pdTypeHtml(row, disabled) {
        const id = paramFieldId(row.name, 'pd.type');
        const options = globalThis.SasFitForm.PD_TYPES.map((type) => optionHtml(type, type, type === row.pd.type));
        return '<div class="sf-detail-field"><label' + attrs({ for: id }) + '>分布</label><select' + attrs({ class: 'form-select', id,
            'data-param': row.name, 'data-field': 'pd.type', 'aria-label': row.name + ' 的多分散分布', disabled }) + '>'
            + options.join('') + '</select></div>';
    }

    function pdFieldHtml(row, def, locked) {
        const field = 'pd.' + def.key;
        const errors = isObject(row.pd.errors) ? row.pd.errors : {};
        return labelledHtml({ name: row.name, field, value: row.pd[def.key], label: row.name + def.label, error: errors[def.key],
            mode: def.mode, disabled: locked || (def.key === 'nsigmas' && row.pd.hasNsigmas !== true) }, def.text);
    }

    /** The dispersity of a parameter: its switch and, while it takes part, its fields. The group exists while closed too (aria-controls). */
    function pdBlockHtml(row, fitResult, locked) {
        const groupId = 'sfPdRow_' + idToken(row.name);
        const open = row.pd.open === true;
        const toggle = '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', id: 'sfPdToggle_' + idToken(row.name),
            'data-action': 'togglePd', 'data-param': row.name, 'aria-expanded': open ? 'true' : 'false', 'aria-controls': groupId,
            'aria-label': row.name + ' 的多分散', disabled: locked }) + '>' + PD_LABEL + '</button>';
        const group = '<div' + attrs({ class: 'sf-pd-fields', id: groupId, role: 'group', 'aria-label': row.name + ' 的多分散', hidden: !open }) + '>';
        if (!open) return toggle + group + '</div>';
        const fields = PD_FIELDS.map((def) => pdFieldHtml(row, def, locked));
        const errors = isObject(row.pd.errors) ? row.pd.errors : {};
        return toggle + group
            + '<label class="sf-detail-field sf-detail-field--check">' + checkHtml(row.name, 'pd.fit', '擬合 ' + row.name + ' 的多分散寬度', row.pd.fit, locked)
            + '<span>擬合寬度</span></label>'
            + fields[0]
            + '<span' + attrs({ class: 'sf-param-pm', id: 'sfPm_' + idToken(row.name + PD_SUFFIX) }) + '>'
            + esc(errorCellText(fitResult, row.name + PD_SUFFIX)) + '</span>'
            + fields[1] + fields[2] + pdTypeHtml(row, locked) + fields[3] + fields[4]
            + PD_FIELDS.map((def) => fieldErrorHtml(row.name, 'pd.' + def.key, errors[def.key])).join('') + '</div>';
    }

    /** The formula button of an SLD parameter and the place of its panel (c.sld: the view of the open panel, or null). */
    function sldBlockHtml(row, c) {
        const slotId = sldSlotId(row.name);
        const open = isObject(c.sld) && c.sld.target === row.name;
        return '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', id: 'sfSldBtn_' + idToken(row.name),
            'data-action': 'sld', 'data-param': row.name, 'aria-expanded': open ? 'true' : 'false', 'aria-controls': slotId,
            'aria-label': '以化學式計算 ' + row.name, disabled: c.locked }) + '>化學式</button>'
            + '<div' + attrs({ class: 'sf-sld-slot', id: slotId, hidden: !open }) + '>' + (open ? sldPanelHtml(c.sld) : '') + '</div>';
    }

    const hasAny = (errors) => isObject(errors) && Object.keys(errors).some((key) => text(errors[key]) !== '');

    /**
     * Whether the detail row of a parameter is open. A field error inside it always opens it (the message would be
     * hidden otherwise); else what the user chose (details[name]: true / false); else open when the shown fit
     * left the parameter or its width on a bound.
     */
    function detailOpen(row, fitResult, details) {
        if (row.fittable !== true) return false;
        const errors = isObject(row.errors) ? row.errors : {};
        if (text(errors.lower) !== '' || text(errors.upper) !== '') return true;
        if (isObject(row.pd) && row.pd.open === true && hasAny(row.pd.errors)) return true;
        const chosen = isObject(details) ? details[row.name] : undefined;
        if (chosen === true || chosen === false) return chosen;
        const atBound = isObject(fitResult) && isObject(fitResult.atBound) ? fitResult.atBound : {};
        return has(atBound, row.name) || has(atBound, row.name + PD_SUFFIX);
    }

    function detailRowHtml(row, c, open) {
        const id = detailRowId(row.name);
        if (!open) return '<tr' + attrs({ class: 'sf-detail-row', id, 'data-param': row.name, hidden: true }) + '></tr>';
        const errors = isObject(row.errors) ? row.errors : {};
        const bound = (field) => labelledHtml({ name: row.name, field, value: row[field], label: row.name + FIELD_LABELS[field],
            error: errors[field], placeholder: UNBOUNDED, disabled: c.locked }, FIELD_LABELS[field].trim());
        return '<tr' + attrs({ class: 'sf-detail-row', id, 'data-param': row.name }) + '><td colspan="' + PARAM_COLUMNS + '">'
            + '<div' + attrs({ class: 'sf-detail', role: 'group', 'aria-label': row.name + ' 的' + DETAIL_HEAD }) + '>'
            + bound('lower') + bound('upper') + fieldErrorHtml(row.name, 'lower', errors.lower) + fieldErrorHtml(row.name, 'upper', errors.upper)
            + (isObject(row.pd) ? pdBlockHtml(row, c.fitResult, c.locked) : '')
            + (row.isSld === true ? sldBlockHtml(row, c) : '') + '</div></td></tr>';
    }

    /** A parameter name that may wrap after an underscore and nowhere else. */
    const nameHtml = (name) => esc(name).split('_').join('_<wbr>');

    function nameCellHtml(row, absolute) {
        const unit = unitText(row.name === BACKGROUND && absolute ? ABSOLUTE_UNIT : row.unit);
        return '<th scope="row"><span class="sf-param-name">' + nameHtml(row.label === undefined ? row.name : row.label) + '</span>'
            + (unit === '' ? '' : '<span class="sf-param-unit">' + esc(unit) + '</span>')
            + (text(row.note) === '' ? '' : '<span class="sf-param-note">' + esc(row.note) + '</span>')
            + '<span' + attrs({ class: 'sf-param-marker', id: markerId(row.name) }) + '>' + esc(globalThis.SasFitLabels.paramMarker(row)) + '</span></th>';
    }

    function moreCellHtml(row, c, open) {
        if (row.fittable !== true) return '<td></td>';
        return '<td><button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm sf-more', id: moreButtonId(row.name),
            'data-action': 'toggleDetail', 'data-param': row.name, 'aria-expanded': open ? 'true' : 'false',
            'aria-controls': detailRowId(row.name), 'aria-label': row.name + ' 的' + DETAIL_HEAD, disabled: c.locked })
            + '>' + MORE_LABEL + '</button></td>';
    }

    /** The full-width line under a row for the message of its value field. */
    function valueErrorRowHtml(row, message) {
        return '<tr' + attrs({ class: 'sf-param-error', id: paramErrorRowId(row.name), hidden: text(message) === '' }) + '><td colspan="'
            + PARAM_COLUMNS + '">' + fieldErrorHtml(row.name, 'value', message) + '</td></tr>';
    }

    function paramRowHtml(row, c) {
        const errors = isObject(row.errors) ? row.errors : {};
        const disabled = c.locked || row.fittable !== true;
        const open = detailOpen(row, c.fitResult, c.details);
        return '<tr' + attrs({ class: 'sf-param-row' + (open ? ' is-open' : ''), 'data-param': row.name, 'data-group': row.group }) + '>'
            + '<td>' + (row.fittable === true ? checkHtml(row.name, 'fit', '擬合 ' + row.name, row.fit, c.locked) : '') + '</td>'
            + nameCellHtml(row, c.absolute)
            + '<td>' + inputHtml({ name: row.name, field: 'value', value: row.value, label: row.name + FIELD_LABELS.value,
                error: errors.value, disabled }) + '</td>'
            + '<td' + attrs({ class: 'sf-param-pm', id: 'sfPm_' + idToken(row.name) }) + '>' + esc(errorCellText(c.fitResult, row.name)) + '</td>'
            + moreCellHtml(row, c, open) + '</tr>'
            + valueErrorRowHtml(row, errors.value) + detailRowHtml(row, c, open);
    }

    /** resultCtx -> what every row needs. */
    function tableContext(resultCtx) {
        const ctx = isObject(resultCtx) ? resultCtx : {};
        return { fitResult: shownResult(ctx), locked: ctx.locked === true, absolute: ctx.absolute === true,
            details: isObject(ctx.details) ? ctx.details : {}, sld: isObject(ctx.sld) ? ctx.sld : null };
    }

    function paramTableHtml(rows, resultCtx) {
        const c = tableContext(resultCtx);
        return list(rows).map((row) => paramRowHtml(row, c)).join('');
    }

    /** [{ id, text }]: the cells paramTableHtml(rows, resultCtx) fills with text that changes while the table stays: errors and markers. */
    function paramErrorCells(rows, resultCtx) {
        const c = tableContext(resultCtx);
        const cell = (name) => Object.freeze({ id: 'sfPm_' + idToken(name), text: errorCellText(c.fitResult, name) });
        return Object.freeze(list(rows).flatMap((row) => {
            const marker = Object.freeze({ id: markerId(row.name), text: globalThis.SasFitLabels.paramMarker(row) });
            const width = isObject(row.pd) && row.pd.open === true && detailOpen(row, c.fitResult, c.details) ? [cell(row.name + PD_SUFFIX)] : [];
            return [cell(row.name), marker].concat(width);
        }));
    }

    /** { name: boolean } of the rows whose detail row is open: what the table's structure depends on. */
    function openDetails(rows, resultCtx) {
        const c = tableContext(resultCtx);
        return Object.freeze(Object.fromEntries(list(rows).map((row) => [row.name, detailOpen(row, c.fitResult, c.details)])));
    }

    // ------------------------------------------------------------- selects of the model segment (design spec 5.3)

    /** <option>s from [{ value, label }]; `selected` is compared as text. */
    function optionsHtml(options, selected) {
        return list(options).map((o) => optionHtml(String(o.value), text(o.label), String(o.value) === String(selected))).join('');
    }

    /** <optgroup>s of the model select from SasFitForm.models(): 'sphere — 均勻球'. */
    function modelOptionsHtml(groups, selected) {
        const label = globalThis.SasFitLabels.modelLabel;
        return list(groups).map((g) => '<optgroup' + attrs({ label: text(g.group) }) + '>'
            + list(g.items).map((item) => optionHtml(item.name, label(item.name), item.name === selected)).join('') + '</optgroup>').join('');
    }

    // ------------------------------------------------------------- SLD panel (design spec 4.7)

    const presetOf = (id) => globalThis.SasFitSld.PRESETS.find((p) => p.id === id) || null;

    function presetRow(preset) {
        if (preset === null) return null;
        return { label: esc(preset.label), value: esc(preset.formula),
            note: [esc('密度 ' + String(preset.density) + ' g/cm³'), esc('出處：' + preset.source), esc(text(preset.note))] };
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
        return isPd ? name.slice(0, -PD_SUFFIX.length) + ' 的多分散寬度' : name;
    }

    /** The lines under the value of a fitted parameter. */
    function tileSubLines(fitted) {
        if (fitted.kind === 'no-error') return ['誤差' + NOT_COMPUTABLE];
        if (fitted.kind === 'at-bound') return [fitted.short + '，誤差無意義'];
        if (fitted.kind === 'undeterminable') return ['誤差' + fitted.error, UNDETERMINED_NOTE];
        return fitted.kind === 'undetermined' ? ['± ' + fitted.error, UNDETERMINED_NOTE] : ['± ' + fitted.error];
    }

    /** { label, value, unit, sub } of a fitted name, every text escaped. */
    function fittedItem(fitResult, name, absolute) {
        const fitted = fittedText(fitResult, name);
        return { label: esc(tileLabel(String(name))), value: esc(fitted.value),
            unit: esc(unitOf(isObject(fitResult.settings) ? fitResult.settings.modelSpec : null, name, absolute)),
            sub: tileSubLines(fitted).map(esc) };
    }

    /** Tiles as a list: a screen reader would otherwise read them as one run of numbers. */
    function tileListHtml(tiles, extraClass) {
        return '<div' + attrs({ class: 'tiles sf-tiles' + (extraClass ? ' ' + extraClass : ''), role: 'list' }) + '>'
            + tiles.map((tile) => '<div class="sf-tile-item" role="listitem">' + tile + '</div>').join('') + '</div>';
    }

    function heroTileHtml(fitResult) {
        const label = globalThis.SasFitHints.statusLabel(fitResult);
        assertTone(label.tone);
        const whole = (n) => (Number.isInteger(n) ? String(n) : MISSING);
        const points = Number.isInteger(fitResult.dof) ? fitResult.dof + list(fitResult.names).length : NaN;
        const measure = globalThis.SasFitHints.measure(fitResult);
        const counts = '自由度 ' + whole(fitResult.dof) + '・' + whole(points) + ' 點・' + whole(fitResult.iterations) + ' 次迭代';
        return host().ResultTiles.tile({ label: measureHtml(measure), value: formatNumber(fitResult.chi2r, CHI2R_DIGITS), hero: true,
            chip: { tone: label.tone, text: esc(label.text) }, sub: [counts, esc(measure.note)] });
    }

    /**
     * The head of the results (#sfFitResults): the notice of a result that is not the current one, the file name
     * and the hero tile. ctx = { matches, notApplied, running, fileName, hasData }. Without a result: the empty
     * state of a dataset that was not fitted yet ('' while there is no dataset).
     */
    function resultsHtml(fitResult, ctx) {
        const context = isObject(ctx) ? ctx : {};
        if (!isObject(fitResult)) {
            return context.hasData === true ? '<p class="stat-sub sf-result-empty">' + globalThis.SasFitHints.NOT_FITTED_TEXT + '</p>' : '';
        }
        if (fitResult.status === 'stopped') {
            const step = Number.isInteger(fitResult.iterations) ? fitResult.iterations : MISSING;
            return '<p class="stat-sub sf-result-note">已停止（第 ' + step + ' 步），參數未變更</p>';
        }
        // a result that could not be written into the form: the form was not edited, so "parameters changed" would be wrong
        const current = context.matches === true || context.notApplied === true;
        const note = context.running === true ? TEXT.running : (current ? '' : TEXT.stale);
        const stale = note === '' ? '' : '<div class="alert alert--compact alert-warning">' + note + '</div>';
        const file = text(context.fileName) === '' ? '' : '<p class="stat-sub sf-result-file">' + esc(context.fileName) + '</p>';
        return stale + file + tileListHtml([heroTileHtml(fitResult)], 'sf-tiles--hero');
    }

    /**
     * The fitted parameters (#sfFitParams), shown after the hints: tiles up to LIST_MAX_TILES of them, a read-only
     * list beyond (still one hero tile on the page). ctx = { absolute }.
     */
    function resultParamsHtml(fitResult, ctx) {
        if (!isObject(fitResult) || fitResult.status === 'stopped') return '';
        const absolute = isObject(ctx) && ctx.absolute === true;
        const items = list(fitResult.names).map((name) => fittedItem(fitResult, name, absolute));
        if (items.length === 0) return '';
        if (items.length <= LIST_MAX_TILES) return tileListHtml(items.map((item) => host().ResultTiles.tile(item)), '');
        return host().ResultTiles.rows(items.map((item) => ({ label: item.label, value: item.value, unit: item.unit, note: item.sub })));
    }

    /**
     * The fit measure of the fit bar (#sfFitMeasure), visible on every tab. view = { result: FitResult | null,
     * matches, running }: the measure with its name (chi-square only with sigma weighting), the status chip, the
     * steps, and a chip when the parameters were changed since.
     */
    function fitBarHtml(view) {
        const v = isObject(view) ? view : {};
        const r = v.result;
        if (!isObject(r) || r.status === 'stopped') return '<span class="sf-fitbar-none">' + TEXT.notFitted + '</span>';
        const label = globalThis.SasFitHints.statusLabel(r);
        assertTone(label.tone);
        const steps = Number.isInteger(r.iterations) ? '<span class="sf-fitbar-steps">' + r.iterations + ' 步</span>' : '';
        const stale = v.matches === true || v.running === true ? '' : statusChipHtml({ text: TEXT.staleChip, tone: 'warn' });
        return '<span class="sf-fitbar-name">' + measureHtml(globalThis.SasFitHints.measure(r)) + '</span>'
            + '<strong class="sf-fitbar-value">' + formatNumber(r.chi2r, CHI2R_DIGITS) + '</strong>'
            + statusChipHtml(label) + steps + stale;
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
        MISSING, WEIGHTING_LABELS,
        fileRowsHtml, paramTableHeadHtml, paramTableHtml, paramErrorCells, openDetails, detailOpen, optionsHtml, modelOptionsHtml,
        sldPanelHtml, sldOutputHtml, weightingOptionsHtml, resultsHtml, resultParamsHtml, fitBarHtml,
        hintsHtml, statusChipHtml, measureHtml, modelInfoHtml, formatValueError, formatNumber, unitText, middleEllipsis,
        paramFieldId, paramErrorId, paramErrorRowId, detailRowId, moreButtonId, markerId, sldSlotId, fileControlId,
    });
})();
