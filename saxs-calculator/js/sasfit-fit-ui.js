/**
 * sasfit-fit-ui.js -- the fit segment of the SAS fitting page (design spec
 * 5.4, 5.7, 12; plan M3 Task 13). Original code. DOM module: loaded before
 * section-sasfit.js, which calls SasFitFitUi.create(ctx) once.
 *
 *   SasFitFitUi.create(ctx) -> { render() }
 *
 * What it owns:
 *   settings  Q range (two inputs, "full range", "default range"), weighting
 *             (the options say how many points each one leaves out), maximum
 *             number of steps; the line that says how many points and free
 *             parameters there are, or why a fit cannot start
 *             (SasFitJobs.fitReadiness); the hints before a fit
 *             (SasFitHints.preFitHints)
 *   run       start / stop / revert / "continue from the current values".
 *             Start cancels the pending preview, sends SasFitJobs.fitJob and
 *             dispatches fitStarted; every way the fit can end dispatches
 *             fitSettled, so the page never stays locked.
 *   results   the FitResult of the ACTIVE dataset: tiles
 *             (SasFitHtml.resultsHtml, with the "parameters were changed"
 *             notice when the result no longer matches the form) and, only
 *             while it matches, the hints of design spec 5.7
 *             (SasFitHints.fitHints). The error column of the parameter table
 *             follows the same rule in sasfit-params-ui.js.
 *
 * A finished fit writes its values into the form (SasFitJobs.applyResult) and
 * keeps the form from before the fit for "revert". A stopped fit changes
 * nothing. "Continue" starts again from the form as it is and keeps the
 * revert point of the first run.
 *
 * Progress: the visible line (#sfFitProgress) follows every accepted step;
 * the screen reader region (#sfFitLive) is written only when a fit starts
 * and when it ends. Errors go where SasFitHints.errorNotice says (#sfFitAlert
 * or #sfAlert), their detail to console.warn, and both alerts are cleared
 * when the next fit starts or succeeds.
 *
 * While a fit runs every control here except "stop" is disabled. render()
 * does not dispatch and writes HTML only through ctx.setHtml, so nothing is
 * rebuilt (and no focus lost) when nothing changed.
 *
 * SECURITY: file names and error texts reach the page through the SasFitHtml
 * builders (which escape) or textContent.
 */

(function () {
    'use strict';

    const LOG = '[sasfit]';
    const RANGE_DIGITS = 6;
    const CHI2R_DIGITS = 3;
    const RESULTS_ID = 'sfFitResults';
    const FIT_TAB = 'fit';
    const PAGE_ERROR_ID = 'page-error';
    const FIT_ERROR_ID = 'fit-error';
    const CONTINUE_ACTION = 'continue';
    const STOPPED = 'stopped';
    const RANGE_INPUTS = Object.freeze({ qMin: 'sfQMin', qMax: 'sfQMax' });
    const RANGE_ERRORS = Object.freeze({ qMin: 'sfQMinError', qMax: 'sfQMaxError' });
    const NO_ERRORS = Object.freeze({ qMin: '', qMax: '' });
    const LOCKED_CONTROLS = Object.freeze(['sfQMin', 'sfQMax', 'sfRangeFull', 'sfRangeDefault', 'sfWeighting', 'sfMaxSteps']);
    const TEXT = Object.freeze({
        needData: '請先載入資料，才能設定擬合範圍並開始擬合。',
        rangeInfo: (points, free) => '範圍內 ' + points + ' 點可參與擬合，自由參數 ' + free + ' 個',
        qMinNumber: 'Q 下限必須是不小於 0 的數字',
        qMaxNumber: 'Q 上限必須是大於 0 的數字',
        qOrder: 'Q 下限必須小於 Q 上限',
        steps: (max) => '最大步數必須是 1 到 ' + max + ' 的整數',
        starting: '開始擬合…',
        progress: (step, chi2r) => '第 ' + step + ' 步，χ²ᵣ＝' + chi2r,
        stopped: (step) => '已停止（第 ' + step + ' 步），參數未變更',
        finished: (label, chi2r, steps) => '擬合結束：' + label + '，χ²ᵣ＝' + chi2r + '，共 ' + steps + ' 步',
        failed: '擬合沒有完成',
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isRunning = (state) => state.fit.phase === 'running';
    const chi2rText = (value) => globalThis.SasFitHtml.formatNumber(value, CHI2R_DIGITS);

    /** A value that is replaced as a whole (frozen) on every change. */
    function makeStore(initial) {
        let value = Object.freeze({ ...initial });
        return Object.freeze({
            get: () => value,
            set(changes) { value = Object.freeze({ ...value, ...changes }); return value; },
        });
    }

    const activeFile = (state) => globalThis.SasFitState.active(state);
    const activeResult = (state) => (state.activeId !== null && has(state.fitResults, state.activeId) ? state.fitResults[state.activeId] : null);

    // ------------------------------------------------------------- alerts and live text

    function showAlert(ctx, elementId, hintId, text) {
        ctx.setHtml(ctx.el(elementId), globalThis.SasFitHtml.hintsHtml([{ id: hintId, tone: 'error', text }]));
    }

    function clearAlerts(ctx) {
        ctx.setHtml(ctx.el('sfFitAlert'), '');
        ctx.setHtml(ctx.el('sfAlert'), '');
    }

    /** The progress line; `live` also tells the screen reader (start and end of a fit only). */
    function setProgress(ui, text, live) {
        ui.store.set({ progress: text, progressFor: ui.ctx.getState().activeId });
        ui.ctx.el('sfFitProgress').textContent = text;
        if (live) ui.ctx.el('sfFitLive').textContent = text;
    }

    // ------------------------------------------------------------- settings

    const rangeText = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(RANGE_DIGITS))) : '');
    const textsOf = (range) => (range === null ? { qMin: '', qMax: '' } : { qMin: rangeText(range.qMin), qMax: rangeText(range.qMax) });

    function markField(ctx, inputId, errorId, message) {
        const input = ctx.el(inputId);
        const note = ctx.el(errorId);
        if (message === '') input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true');
        if (note.textContent !== message) note.textContent = message;
        note.hidden = message === '';
    }

    /** The two range inputs follow the state, except while they hold what the user is typing. */
    function renderRange(ui, state) {
        const { ctx, store } = ui;
        if (state.range !== store.get().rangeSeen) {
            store.set({ rangeSeen: state.range, rangeErrors: NO_ERRORS });
            const texts = textsOf(state.range);
            Object.keys(RANGE_INPUTS).forEach((key) => { ctx.el(RANGE_INPUTS[key]).value = texts[key]; });
        }
        const errors = store.get().rangeErrors;
        Object.keys(RANGE_INPUTS).forEach((key) => markField(ctx, RANGE_INPUTS[key], RANGE_ERRORS[key], errors[key]));
    }

    /** The number in a number input, or NaN (an empty field included). */
    function numberIn(input) {
        const bad = isObject(input.validity) && input.validity.badInput === true;
        const text = String(input.value).trim();
        return bad || text === '' ? NaN : Number(text);
    }

    function rangeErrorsOf(qMin, qMax) {
        const errors = {
            qMin: Number.isFinite(qMin) && qMin >= 0 ? '' : TEXT.qMinNumber,
            qMax: Number.isFinite(qMax) && qMax > 0 ? '' : TEXT.qMaxNumber,
        };
        if (errors.qMin === '' && errors.qMax === '' && qMin >= qMax) errors.qMin = TEXT.qOrder;
        return Object.freeze(errors);
    }

    function onRangeInput(ui) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        if (isRunning(state) || state.activeId === null) return;
        const qMin = numberIn(ctx.el(RANGE_INPUTS.qMin));
        const qMax = numberIn(ctx.el(RANGE_INPUTS.qMax));
        const errors = rangeErrorsOf(qMin, qMax);
        store.set({ rangeErrors: errors });
        if (errors.qMin === '' && errors.qMax === '') {
            // silent, so that the inputs keep the text being typed: the new range is ours
            store.set({ rangeSeen: ctx.dispatch({ type: 'setRange', qMin, qMax }, { silent: true }).range });
        }
        ctx.refresh();
    }

    function onStepsInput(ui) {
        const { ctx, store } = ui;
        if (isRunning(ctx.getState())) return;
        const max = globalThis.SasFitWorkerCore.MAX_STEPS;
        const value = numberIn(ctx.el('sfMaxSteps'));
        const valid = Number.isInteger(value) && value >= 1 && value <= max;
        store.set({ stepsError: valid ? '' : TEXT.steps(max) });
        if (valid) ctx.dispatch({ type: 'setMaxSteps', value }, { silent: true });
        ctx.refresh();
    }

    function renderWeighting(ui, state, dataset) {
        const { ctx } = ui;
        const weighting = globalThis.SasFitWeighting;
        const hasSigma = dataset === null || weighting.defaultMode(dataset) === 'sigma';
        const select = ctx.el('sfWeighting');
        ctx.setHtml(select, globalThis.SasFitHtml.weightingOptionsHtml(globalThis.SasFitHints.excludedCounts(dataset), hasSigma, state.weighting));
        if (select.value !== state.weighting) select.value = state.weighting;
    }

    function renderSteps(ui, state) {
        const { ctx, store } = ui;
        const input = ctx.el('sfMaxSteps');
        const { stepsError } = store.get();
        if (stepsError === '' && Number(input.value) !== state.maxSteps) input.value = String(state.maxSteps);
        markField(ctx, 'sfMaxSteps', 'sfMaxStepsError', stepsError);
    }

    /** { ok, text }: whether a fit can start now, and the line that says so. */
    function readiness(ui, state) {
        const file = activeFile(state);
        if (file === null) return { ok: false, text: TEXT.needData };
        const { rangeErrors, stepsError } = ui.store.get();
        const ready = globalThis.SasFitJobs.fitReadiness(ui.ctx.getForm(), file.dataset, { range: state.range, weighting: state.weighting });
        const text = ready.ok ? TEXT.rangeInfo(ready.nPoints, ready.nFree) : ready.reason;
        return { ok: ready.ok && rangeErrors.qMin === '' && rangeErrors.qMax === '' && stepsError === '', text };
    }

    function renderSettings(ui, state) {
        const { ctx } = ui;
        const file = activeFile(state);
        const dataset = file === null ? null : file.dataset;
        const locked = isRunning(state);
        renderRange(ui, state);
        renderWeighting(ui, state, dataset);
        renderSteps(ui, state);
        LOCKED_CONTROLS.forEach((id) => { ctx.el(id).disabled = locked || (dataset === null && id !== 'sfMaxSteps'); });
        const ready = readiness(ui, state);
        ctx.el('sfRangeInfo').textContent = ready.text;
        const hints = globalThis.SasFitHints.preFitHints({
            modelSpec: globalThis.SasFitJobs.modelSpec(ctx.getForm()), dataset, range: state.range, weighting: state.weighting,
            notes: file === null ? null : file.notes,
        });
        ctx.setHtml(ctx.el('sfPreFitHints'), globalThis.SasFitHtml.hintsHtml(hints));
        ctx.el('sfFitStart').disabled = locked || !ready.ok;
        ctx.el('sfFitStop').disabled = !locked;
        ctx.el('sfFitRevert').disabled = locked || ui.store.get().before === null;
    }

    // ------------------------------------------------------------- results

    function renderResults(ui, state) {
        const { ctx, store } = ui;
        const html = globalThis.SasFitHtml;
        const file = activeFile(state);
        const result = activeResult(state);
        const matches = result !== null && globalThis.SasFitJobs.resultMatchesForm(ctx.getForm(), result);
        const locked = isRunning(state);
        const results = ctx.el(RESULTS_ID);
        ctx.setHtml(results, html.resultsHtml(result, { matches, fileName: file === null ? '' : file.fileName }));
        results.setAttribute('aria-busy', String(locked));
        // the hints describe the result as fitted; "continue" must not be offered for other values or during a run
        ctx.setHtml(ctx.el('sfFitHints'), matches && !locked ? html.hintsHtml(globalThis.SasFitHints.fitHints(result)) : '');
        if (!locked && store.get().progress !== '' && store.get().progressFor !== state.activeId) {
            store.set({ progress: '' });                           // the line belonged to another dataset
            ctx.el('sfFitProgress').textContent = '';
        }
    }

    function render(ui) {
        const state = ui.ctx.getState();
        renderSettings(ui, state);
        renderResults(ui, state);
    }

    // ------------------------------------------------------------- running a fit

    /** fitSettled on every path: a page that stays locked could only be reloaded. */
    function settle(ui, result) {
        const { ctx } = ui;
        if (!isRunning(ctx.getState())) return;
        try {
            ctx.dispatch({ type: 'fitSettled', result });
        } catch (err) {
            console.error(LOG + ' 擬合結果無法寫入狀態', err);
            ctx.dispatch({ type: 'fitSettled', result: null });
        }
    }

    function onProgress(ui, run, progress) {
        const { ctx, store } = ui;
        if (run !== store.get().run || !isRunning(ctx.getState()) || !isObject(progress)) return;
        const { iteration, chi2r } = progress;
        if (!Number.isInteger(iteration) || iteration < 0) return;
        ctx.dispatch({ type: 'fitProgress', iteration, chi2r: typeof chi2r === 'number' ? chi2r : null }, { silent: true });
        setProgress(ui, TEXT.progress(iteration, chi2rText(chi2r)), false);
    }

    /** The fitted values go into the form; a result that cannot be applied is shown without changing it. */
    function applyToForm(ui, result) {
        const { ctx } = ui;
        try {
            ctx.setForm(globalThis.SasFitJobs.applyResult(ctx.getForm(), result));
            return true;
        } catch (err) {
            console.warn(LOG + ' 擬合結果無法套用到參數表：' + (err instanceof Error ? err.message : String(err)));
            return false;
        }
    }

    function onResult(ui, run, result) {
        const { ctx, store } = ui;
        if (run !== store.get().run) return;
        if (!isObject(result)) {
            onFailure(ui, run, new Error('the fit resolved without a result'));
            return;
        }
        if (result.status === STOPPED) {
            const step = Number.isInteger(result.iterations) ? result.iterations : ctx.getState().fit.iteration;
            settle(ui, result);
            setProgress(ui, TEXT.stopped(step), true);
            return;
        }
        const { pending, keepBefore, before } = store.get();
        if (applyToForm(ui, result)) store.set({ before: keepBefore && before !== null ? before : pending });
        clearAlerts(ctx);
        settle(ui, result);
        const label = globalThis.SasFitHints.statusLabel(result).text;
        setProgress(ui, TEXT.finished(label, chi2rText(result.chi2r), Number.isInteger(result.iterations) ? result.iterations : 0), true);
        const a11y = host().A11y;
        if (ctx.getState().tab === FIT_TAB && isObject(a11y)) a11y.focusResults(RESULTS_ID);
    }

    function onFailure(ui, run, err) {
        const { ctx, store } = ui;
        if (run !== store.get().run) return;
        const notice = globalThis.SasFitHints.errorNotice(err, 'fit');
        settle(ui, null);
        if (notice.where === 'ignore') {
            setProgress(ui, '', false);
            return;
        }
        if (notice.detail !== '') console.warn(LOG + ' ' + notice.detail);
        if (notice.where === 'page') showAlert(ctx, 'sfAlert', PAGE_ERROR_ID, notice.text);
        else showAlert(ctx, 'sfFitAlert', FIT_ERROR_ID, notice.text);
        setProgress(ui, TEXT.failed, true);
    }

    function start(ui, keepBefore) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        if (isRunning(state) || !readiness(ui, state).ok) return;
        const form = ctx.getForm();
        const job = globalThis.SasFitJobs.fitJob(form, activeFile(state).dataset,
            { range: state.range, weighting: state.weighting, maxSteps: state.maxSteps });
        ctx.preview.cancel();                                      // a preview queued behind the fit would only wait for it
        clearAlerts(ctx);
        const run = store.get().run + 1;
        store.set({ run, pending: form, keepBefore });
        ctx.dispatch({ type: 'fitStarted' });
        setProgress(ui, TEXT.starting, true);
        let promise;
        try {
            promise = ctx.client.fit(job, { onProgress: (progress) => onProgress(ui, run, progress) });
        } catch (err) {
            promise = Promise.reject(err);                         // the client could not be created
        }
        promise.then((result) => onResult(ui, run, result), (err) => onFailure(ui, run, err)).catch((err) => {
            console.error(LOG + ' 處理擬合結果時發生未預期的錯誤', err);       // a bug here must not leave the page locked
            settle(ui, null);
        });
    }

    function stop(ui) {
        const { ctx } = ui;
        if (!isRunning(ctx.getState())) return;
        try {
            ctx.client.stop();                                     // the pending fit resolves as 'stopped'
        } catch (err) {
            console.warn(LOG + ' 停止擬合時發生錯誤', err);
            showAlert(ctx, 'sfAlert', PAGE_ERROR_ID, globalThis.SasFitHints.errorNotice(err, 'fit').text);
        }
    }

    function revert(ui) {
        const { ctx, store } = ui;
        const { before } = store.get();
        if (before === null || isRunning(ctx.getState())) return;
        store.set({ before: null });
        ctx.setForm(before);
        ctx.refresh();                                             // the model segment plans the preview of the old values
        ctx.el('sfFitStart').focus();                              // the revert button is disabled now
    }

    // ------------------------------------------------------------- events

    function dispatchSetting(ui, action) {
        const { ctx } = ui;
        if (isRunning(ctx.getState()) || ctx.getState().activeId === null) return;
        try {
            ctx.dispatch(action);
        } catch (err) {
            console.error(LOG + ' 設定無法套用：' + action.type, err);
            ctx.refresh();
        }
    }

    function bind(ui) {
        const { ctx } = ui;
        Object.keys(RANGE_INPUTS).forEach((key) => ctx.el(RANGE_INPUTS[key]).addEventListener('input', () => onRangeInput(ui)));
        ctx.el('sfRangeFull').addEventListener('click', () => dispatchSetting(ui, { type: 'rangeFull' }));
        ctx.el('sfRangeDefault').addEventListener('click', () => dispatchSetting(ui, { type: 'rangeDefault' }));
        ctx.el('sfWeighting').addEventListener('change', (event) => dispatchSetting(ui, { type: 'setWeighting', mode: event.target.value }));
        ctx.el('sfMaxSteps').addEventListener('input', () => onStepsInput(ui));
        ctx.el('sfFitStart').addEventListener('click', () => start(ui, false));
        ctx.el('sfFitStop').addEventListener('click', () => stop(ui));
        ctx.el('sfFitRevert').addEventListener('click', () => revert(ui));
        ctx.el('sfFitHints').addEventListener('click', (event) => {
            const target = typeof event.target.closest === 'function' ? event.target.closest('[data-action]') : null;
            if (target !== null && target.dataset.action === CONTINUE_ACTION) start(ui, true);
        });
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({
            rangeSeen: undefined, rangeErrors: NO_ERRORS, stepsError: '', before: null, pending: null, keepBefore: false,
            run: 0, progress: '', progressFor: null,
        }) });
        bind(ui);
        return Object.freeze({ render: () => render(ui) });
    }

    globalThis.SasFitFitUi = Object.freeze({ create });
})();
