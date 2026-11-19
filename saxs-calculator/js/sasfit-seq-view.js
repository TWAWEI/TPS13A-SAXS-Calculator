/**
 * sasfit-seq-view.js -- what the sequence segment of the SAS fitting page
 * shows, as data and as HTML strings: the ONE table that both selects the files
 * of a sequence and lists their results, and the trend chart (design spec 7;
 * plan M4 Task 9). Original code.
 *
 *   MEASURE_KEY                 the y value of the trend chart that means "the fit measure"
 *   columns(state) -> { names, measure, scaled }
 *       names    the fitted names (fitter order, widths as <name>_pd) of the
 *                first row of the last run that has a result; [] before that
 *       measure  SasFitHints.measure of the weighting of the last run (of the
 *                page before the first run): chi-square only with sigma
 *       scaled   the errors shown are the ones multiplied by sqrt(measure)
 *   tableRows(state) -> [{ id, fileName, condition, selected, canLoad,
 *                          cells: [{ value, error, mark }], measure,
 *                          status: { text, tone | null }, note, stale }]
 *       One row per file WITH DATA: those of the last run in its order, then
 *       the others in list order. Texts only (display form, not escaped).
 *       Numbers are shown for a row the run finished ('done'), and they are
 *       ALWAYS the run's own result (state.seq.rows[id].result): one table,
 *       one chart and one CSV never mix the fit measures or weightings of two
 *       fits (fix pass after the M4 reviews). stale: a single fit has replaced
 *       that file's entry in state.fitResults since -- said in the note row,
 *       the numbers stay the run's. Skipped, failed and unfinished rows say why.
 *       canLoad: the row shows a result (loadForm is not null).
 *   shownResult(state, id) -> FitResult | null   the result those numbers come from
 *   loadForm(state, id) -> form | null
 *       The form that loading the row of file `id` gives: the form the last
 *       run started from with the fitted values of the run's result written
 *       in. The snapshot is the base because a FitResult carries neither
 *       bounds nor fit ticks -- the form on the page may be anything by now.
 *       null when the row shows no result.
 *   headHtml(columns, conditionName) -> the <tr> of the table head: tick,
 *       file, condition, the fit measure (its cell also carries the status),
 *       then the fitted names
 *   bodyHtml(rows, { locked })       -> the <tr>s of the body. The checkbox
 *       (sfSeqPick_<id>) and the load button (sfSeqLoad_<id>) carry ids, so
 *       ctx.setHtml can give the focus back after a rebuild. A row with
 *       something to say (where its start values came from, why it was
 *       skipped, a later single fit) is followed by ONE note row whose cell
 *       spans the table and names the file's row header in `headers`.
 *   pickId(id), loadId(id), nameId(id)   those ids
 *   counts(state) -> { converged, other, skipped }   of the rows of the last run
 *   yOptions(state) -> [{ value, label }]: the fitted names, then the measure
 *   yOptionsHtml(options, selected)  -> <option>s
 *   trend(state, yName) -> { points: [{ x, y, yMin, yMax, id, style }], xTitle,
 *                            yTitle, omitted, byOrder, label }
 *       x = the condition value; when no file of the run has one, the position
 *       in the run (byOrder). Error bars from the DISPLAYED errors; none for a
 *       value on a bound or for the measure. style: the Chart.js pointStyle --
 *       a fit that did not converge is a triangle (shape, not colour: tpsHollow
 *       is a property of a whole dataset). Failed, skipped and unfinished rows,
 *       rows without a condition and values that are not finite are left out
 *       and counted in `omitted`. Points are in x order. label: for aria-label.
 *   trendConfig(trend) -> Chart.js config without colours and without the
 *       `plugins` array (SasFitPlots.renderTrend adds the error bars)
 *
 * Numbers become text only through SasFitFormat; the name of the fit measure
 * only through SasFitHints.measure / SasFitHtml.measureHtml. Non-finite
 * numbers (hayter_msa, design spec 16) are expected input.
 *
 * SECURITY: every string that reaches the HTML passes FormUtils.escapeHtml
 * here (file names, condition names, notes, error texts).
 *
 * Pure: no DOM, no timers; nothing given is modified; other globals are read
 * at call time (FormUtils and ChartTheme through host()).
 */

(function () {
    'use strict';

    const MEASURE_KEY = '$measure';
    const SIGMA_MODE = 'sigma';
    const MEASURE_DIGITS = 3;
    const LONE_DIGITS = 5;
    const LABEL_DIGITS = 3;
    const NOTE_SEPARATOR = '；';
    const DEFAULT_CONDITION = '條件值';
    const POINT_STYLES = Object.freeze({ converged: 'circle', maxiter: 'triangle' });
    const POINT_RADIUS = 4;
    const LINE_WIDTH = 1.5;
    const FIXED_COLUMNS = 4;                     // tick, file, condition, fit measure
    const AXIS_ROLE = 'grid';                    // as SasFitPlotData: only the axis line takes the colour
    const TEXT = Object.freeze({
        pick: '納入', file: '檔名', status: '狀態', load: '載入',
        pickLabel: (name) => '將 ' + name + ' 納入序列擬合',
        loadLabel: (name) => '載入 ' + name + ' 的擬合參數',
        scaledError: '± 已乘 √均方',
        notRun: '尚未執行序列', notIncluded: '未納入上次序列', skipped: '已跳過', error: '錯誤',
        pending: '未擬合', waiting: '等待中', running: '擬合中',
        stale: '已單獨重新擬合',
        startedFrom: (name) => '初值來自 ' + name,
        byOrder: '序號',
        noPoints: '尚無可畫的結果',
        trendLabel: (y, x, count, first, last) => y + ' 對 ' + x + ' 的趨勢，' + count + ' 點，由 ' + first + ' 到 ' + last,
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const esc = (value) => host().FormUtils.escapeHtml(value);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const text = (v) => (typeof v === 'string' ? v : '');
    const numberText = (value, digits) => globalThis.SasFitFormat.display(globalThis.SasFitFormat.number(value, digits));
    const pickId = (id) => 'sfSeqPick_' + id;
    const loadId = (id) => 'sfSeqLoad_' + id;
    const nameId = (id) => 'sfSeqName_' + id;

    /** ' name="value"' for every entry; true -> a bare attribute; false, null and undefined -> nothing. */
    function attrs(map) {
        return Object.keys(map).map((name) => {
            const value = map[name];
            if (value === false || value === null || value === undefined) return '';
            return value === true ? ' ' + name : ' ' + name + '="' + esc(String(value)) + '"';
        }).join('');
    }

    // ------------------------------------------------------------- what a row shows

    /** { seqRow, result, stale }: the row of the last run for a file and the run's own FitResult its numbers come from (or null). */
    function shownOf(state, id) {
        const { seq } = state;
        const seqRow = has(seq.rows, id) ? seq.rows[id] : null;
        if (seqRow === null || seqRow.state !== 'done' || !isObject(seqRow.result)) return { seqRow, result: null, stale: false };
        const current = has(state.fitResults, id) ? state.fitResults[id] : null;
        return { seqRow, result: seqRow.result, stale: current !== seqRow.result };
    }

    const shownResult = (state, id) => shownOf(state, id).result;

    /** See the header. */
    function loadForm(state, id) {
        const { result } = shownOf(state, id);
        if (result === null) return null;
        try {
            return globalThis.SasFitJobs.applyResult(state.seq.form, result);
        } catch (err) {
            return null;                      // the values cannot be written into that form: nothing to load
        }
    }

    /** The files with data: those of the last run in its order, then the rest in list order. */
    function orderedFiles(state) {
        const withData = state.files.filter((file) => file.dataset !== null);
        const order = state.seq.order === null ? [] : state.seq.order;
        const ran = order.map((id) => withData.find((file) => file.id === id)).filter((file) => file !== undefined);
        return ran.concat(withData.filter((file) => order.indexOf(file.id) < 0));
    }

    function weightingOf(state) {
        return state.seq.settings === null ? state.weighting : state.seq.settings.weighting;
    }

    function columns(state) {
        const { seq } = state;
        const first = (seq.order === null ? [] : seq.order).map((id) => seq.rows[id])
            .find((row) => isObject(row) && isObject(row.result) && Array.isArray(row.result.names));
        const weighting = weightingOf(state);
        return Object.freeze({
            names: Object.freeze(first === undefined ? [] : first.result.names.slice()),
            measure: globalThis.SasFitHints.measure(weighting), scaled: weighting !== SIGMA_MODE,
        });
    }

    const displayedError = (result, name) => {
        const errors = globalThis.SasFitWorkerCore.displayErrors(result);
        return isObject(errors) ? errors[name] : NaN;
    };

    const EMPTY_CELL = () => Object.freeze({ value: globalThis.SasFitFormat.MISSING, error: '', mark: '' });

    /** { value, error, mark } of a fitted name: the texts of the result tile; a value on a bound has a mark and no error. */
    function cellOf(result, name) {
        if (result === null || result.names.indexOf(name) < 0) return EMPTY_CELL();
        const format = globalThis.SasFitFormat;
        const exact = result.params[name];
        if (isObject(result.atBound) && has(result.atBound, name)) {
            const short = globalThis.SasFitHints.AT_BOUND_SHORT;
            const side = result.atBound[name];
            return Object.freeze({ value: numberText(exact, LONE_DIGITS), error: '', mark: has(short, side) ? short[side] : '' });
        }
        const error = displayedError(result, name);
        const shown = format.valueError(format.inputValue(exact, error), error, { illConditioned: result.illConditioned === true });
        return Object.freeze({ value: shown.value, error: shown.error, mark: '' });
    }

    function statusOf(state, id, shown) {
        const { seqRow, result } = shown;
        const { seq } = state;
        const plain = (label) => Object.freeze({ text: label, tone: null });
        if (seqRow === null) return plain(seq.order === null ? TEXT.notRun : TEXT.notIncluded);
        if (seqRow.state === 'skipped') return plain(TEXT.skipped);
        if (seqRow.state === 'error') return Object.freeze({ text: TEXT.error, tone: 'error' });
        if (result === null) {
            if (seq.phase !== 'running') return plain(TEXT.pending);
            return plain(state.fit.datasetId === id ? TEXT.running : TEXT.waiting);
        }
        const label = globalThis.SasFitHints.statusLabel(result);
        return Object.freeze({ text: label.text, tone: label.tone });
    }

    function noteOf(state, seqRow) {
        if (seqRow === null) return '';
        const source = seqRow.startedFrom === null ? undefined : state.files.find((file) => file.id === seqRow.startedFrom);
        return [text(seqRow.note), source === undefined ? '' : TEXT.startedFrom(source.fileName)].filter((part) => part !== '').join(NOTE_SEPARATOR);
    }

    function tableRows(state) {
        const { names } = columns(state);
        const selected = globalThis.SasFitState.seqSelectedFiles(state).map((file) => file.id);
        return Object.freeze(orderedFiles(state).map((file) => {
            const shown = shownOf(state, file.id);
            const { result } = shown;
            return Object.freeze({
                id: file.id, fileName: file.fileName,
                condition: isNumber(file.condition) ? globalThis.SasFitFormat.display(String(file.condition)) : '',
                selected: selected.indexOf(file.id) >= 0, canLoad: result !== null && loadForm(state, file.id) !== null,
                cells: Object.freeze(names.map((name) => cellOf(result, name))),
                measure: result === null ? globalThis.SasFitFormat.MISSING : numberText(result.chi2r, MEASURE_DIGITS),
                status: statusOf(state, file.id, shown), note: noteOf(state, shown.seqRow), stale: shown.stale,
            });
        }));
    }

    // ------------------------------------------------------------- html

    /** converged / not converged or failed / skipped among the rows of the last run. */
    function counts(state) {
        const rows = (state.seq.order === null ? [] : state.seq.order).map((id) => state.seq.rows[id]).filter(isObject);
        const done = rows.filter((row) => row.state === 'done' && isObject(row.result));
        const converged = done.filter((row) => row.result.status === 'converged').length;
        return Object.freeze({
            converged, skipped: rows.filter((row) => row.state === 'skipped').length,
            other: done.length - converged + rows.filter((row) => row.state === 'error').length,
        });
    }

    const th = (html) => '<th scope="col">' + html + '</th>';

    function headHtml(cols, conditionName) {
        const condition = text(conditionName).trim() === '' ? DEFAULT_CONDITION : conditionName.trim();
        const sub = cols.scaled === true ? '<span class="sf-seq-sub">' + esc(TEXT.scaledError) + '</span>' : '';
        const names = cols.names.map((name) => th('<span class="sf-seq-param">' + esc(name) + '</span>' + sub));
        const measure = globalThis.SasFitHtml.measureHtml(cols.measure) + '<span class="sf-seq-sub">' + TEXT.status + '</span>';
        return '<tr>' + th('<span class="sr-only">' + TEXT.pick + '</span>') + th(TEXT.file) + th(esc(condition)) + th(measure)
            + names.join('') + '</tr>';
    }

    function cellHtml(cell) {
        const extra = text(cell.mark) !== '' ? '<span class="sf-seq-mark">' + esc(cell.mark) + '</span>'
            : (text(cell.error) !== '' ? '<span class="sf-seq-err">± ' + esc(cell.error) + '</span>' : '');
        return '<td class="sf-seq-num"><span class="sf-seq-value">' + esc(cell.value) + '</span>' + extra + '</td>';
    }

    /** The fit measure with the status under it. */
    function fitHtml(row) {
        const status = isObject(row.status) ? row.status : { text: '', tone: null };
        const chip = status.tone === null || status.tone === undefined
            ? '<span class="sf-seq-state">' + esc(status.text) + '</span>' : globalThis.SasFitHtml.statusChipHtml(status);
        return '<td class="sf-seq-num sf-seq-fit"><span class="sf-seq-value">' + esc(row.measure) + '</span>' + chip + '</td>';
    }

    /** The row under a file's row that says what there is to say about it; '' when there is nothing. */
    function noteRowHtml(row, span) {
        const stale = row.stale === true ? globalThis.SasFitHtml.statusChipHtml({ text: TEXT.stale, tone: 'warn' }) : '';
        const note = text(row.note) === '' ? '' : '<span class="sf-seq-note">' + esc(row.note) + '</span>';
        if (stale === '' && note === '') return '';
        // the box stays in the visible part of the table (CSS: sticky, as wide as the wrapper): a note is never cut off by the scrolling
        return '<tr class="sf-seq-noterow"><td' + attrs({ colspan: span, headers: nameId(row.id) }) + '><div class="sf-seq-notebox">'
            + stale + note + '</div></td></tr>';
    }

    function rowHtml(row, locked) {
        const pick = '<input' + attrs({ type: 'checkbox', id: pickId(row.id), 'data-action': 'pick', 'data-id': row.id,
            'aria-label': TEXT.pickLabel(row.fileName), checked: row.selected === true, disabled: locked }) + '>';
        const load = '<button' + attrs({ type: 'button', class: 'btn btn-secondary btn-sm', id: loadId(row.id), 'data-action': 'load',
            'data-id': row.id, 'aria-label': TEXT.loadLabel(row.fileName), disabled: locked || row.canLoad !== true }) + '>' + TEXT.load + '</button>';
        const name = '<span' + attrs({ class: 'sf-file-text', title: row.fileName }) + '>'
            + esc(globalThis.SasFitHtml.middleEllipsis(row.fileName)) + '</span>';
        const noteRow = noteRowHtml(row, FIXED_COLUMNS + row.cells.length);
        return '<tr' + attrs({ class: noteRow === '' ? 'sf-seq-row' : 'sf-seq-row sf-seq-row--noted', 'data-id': row.id }) + '>'
            + '<td class="sf-seq-pick">' + pick + '</td>'
            + '<th' + attrs({ scope: 'row', class: 'sf-seq-name', id: nameId(row.id) }) + '><span class="sf-seq-namebox">' + name + load + '</span></th>'
            + '<td class="sf-seq-num">' + esc(row.condition) + '</td>' + fitHtml(row) + row.cells.map(cellHtml).join('') + '</tr>' + noteRow;
    }

    function bodyHtml(rows, options) {
        const locked = isObject(options) && options.locked === true;
        return rows.map((row) => rowHtml(row, locked)).join('');
    }

    // ------------------------------------------------------------- trend

    function yOptions(state) {
        const cols = columns(state);
        if (cols.names.length === 0) return Object.freeze([]);
        return Object.freeze(cols.names.map((name) => Object.freeze({ value: name, label: name }))
            .concat([Object.freeze({ value: MEASURE_KEY, label: cols.measure.label })]));
    }

    function yOptionsHtml(options, selected) {
        return options.map((option) => '<option' + attrs({ value: option.value, selected: option.value === selected }) + '>'
            + esc(option.label) + '</option>').join('');
    }

    /** { y, yMin, yMax } of a result for the chosen y, or null when there is nothing finite to draw. */
    function yOf(result, yName) {
        if (yName === MEASURE_KEY) return isNumber(result.chi2r) ? { y: result.chi2r, yMin: null, yMax: null } : null;
        const y = result.names.indexOf(yName) < 0 ? NaN : result.params[yName];
        if (!isNumber(y)) return null;
        const error = displayedError(result, yName);
        const bars = isNumber(error) && error > 0 && !(isObject(result.atBound) && has(result.atBound, yName));
        return { y, yMin: bars ? y - error : null, yMax: bars ? y + error : null };
    }

    /** The point of one item of the run, or null when it is left out. */
    function pointOf(state, id, at, yName, byOrder) {
        const file = state.files.find((f) => f.id === id);
        const { result } = shownOf(state, id);
        if (file === undefined || result === null || !has(POINT_STYLES, result.status)) return null;
        if (!byOrder && !isNumber(file.condition)) return null;
        const value = yOf(result, yName);
        return value === null ? null : Object.freeze({ x: byOrder ? at + 1 : file.condition, ...value, id, style: POINT_STYLES[result.status] });
    }

    function trend(state, yName) {
        const options = yOptions(state);
        const chosen = options.find((option) => option.value === yName) || options[0];
        const order = (state.seq.order === null ? [] : state.seq.order).filter((id) => state.files.some((file) => file.id === id));
        const byOrder = order.length > 0 && order.every((id) => !isNumber(state.files.find((file) => file.id === id).condition));
        const points = chosen === undefined ? [] : order.map((id, at) => pointOf(state, id, at, chosen.value, byOrder))
            .filter((point) => point !== null).sort((a, b) => a.x - b.x);
        const name = state.conditionName.trim();
        const xTitle = byOrder ? TEXT.byOrder : (name === '' ? DEFAULT_CONDITION : name);
        const yTitle = chosen === undefined ? '' : chosen.label;
        const label = points.length === 0 ? TEXT.noPoints : TEXT.trendLabel(yTitle, xTitle, points.length,
            numberText(points[0].y, LABEL_DIGITS), numberText(points[points.length - 1].y, LABEL_DIGITS));
        return Object.freeze({ points: Object.freeze(points), xTitle, yTitle, omitted: order.length - points.length, byOrder, label });
    }

    function trendAxis(title) {
        const theme = host().ChartTheme;
        return { type: 'linear', tpsRole: AXIS_ROLE, title: { display: true, text: title, font: { family: theme.FONT, size: 11 } },
            ticks: { font: { family: theme.MONO, size: 10 } } };
    }

    function trendConfig(view) {
        const theme = host().ChartTheme;
        const off = () => ({ enabled: false });
        return {
            type: 'scatter',
            data: { datasets: [{
                label: view.yTitle, data: view.points.map(({ x, y, yMin, yMax }) => ({ x, y, yMin, yMax })), showLine: true,
                tpsSeries: 0, sfErrorBars: true, pointStyle: view.points.map((point) => point.style),
                pointRadius: POINT_RADIUS, pointHoverRadius: POINT_RADIUS + 1, borderWidth: LINE_WIDTH,
            }] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: { x: trendAxis(view.xTitle), y: trendAxis(view.yTitle) },
                plugins: {
                    legend: { display: false },
                    tooltip: { cornerRadius: 8, padding: 10, titleFont: { family: theme.FONT, size: 12 }, bodyFont: { family: theme.MONO, size: 11 },
                        callbacks: {
                            title: (items) => (items.length === 0 ? '' : view.xTitle + ' ' + numberText(items[0].parsed.x, LONE_DIGITS)),
                            label: (item) => view.yTitle + ' ' + numberText(item.parsed.y, LONE_DIGITS),
                        } },
                    zoom: { pan: off(), zoom: { wheel: off(), pinch: off(), drag: off() } },
                },
            },
        };
    }

    globalThis.SasFitSeqView = Object.freeze({
        MEASURE_KEY, columns, tableRows, shownResult, loadForm, counts, headHtml, bodyHtml, pickId, loadId, nameId, yOptions, yOptionsHtml, trend, trendConfig,
    });
})();
