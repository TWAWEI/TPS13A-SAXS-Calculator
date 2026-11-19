/**
 * sasfit-fit-ui.js -- the fit segment of the SAS fitting page and the fit bar
 * that is on every tab (design spec 5.1, 5.4, 5.7, 12; plan M3 Task 13; fix
 * pass B after the UI review of 2026-11-19). Original code. DOM module:
 * loaded before section-sasfit.js, which calls SasFitFitUi.create(ctx) once.
 *
 *   SasFitFitUi.create(ctx) -> { render(), forgetRevert(), setBarProgress(text) }
 *       forgetRevert()        drops the revert point: the form was replaced as a whole (a row of a
 *                             sequence was loaded), so "the parameters before the fit" no longer exist
 *       setBarProgress(text)  writes the progress line of the fit bar; it then belongs to the active
 *                             dataset like any other progress text (cleared when another one is chosen)
 *
 * What it owns:
 *   fit bar   start / stop, the fit measure of the active dataset
 *             (SasFitHtml.fitBarHtml), one line that says what a fit would
 *             use -- range, points, the NAMES of the free parameters
 *             (SasFitLabels.fitSummary) -- or why it cannot start
 *             (SasFitJobs.fitReadiness), and the progress line
 *   settings  q range (two inputs, "full range", "default range"), weighting
 *             (the options say how many points each one leaves out), maximum
 *             number of steps, "revert" (it belongs to the dataset whose fit
 *             it undoes: for another one it is disabled and says whose it
 *             is); the hints before a fit (SasFitHints.preFitHints)
 *   results   the FitResult of the ACTIVE dataset: the hero tile
 *             (SasFitHtml.resultsHtml), then -- only while the result matches
 *             the form -- the hints of design spec 5.7 (SasFitHints.fitHints),
 *             then the fitted parameters (SasFitHtml.resultParamsHtml). A
 *             result that is not the one of the current parameters (changed
 *             since, or a new fit is running) is marked and shown subdued.
 *
 * A finished fit writes its values into the form (SasFitJobs.applyResult) and
 * keeps the form from before the fit for "revert". A stopped fit changes
 * nothing. "Continue" starts again from the form as it is and keeps the
 * revert point of the first run.
 *
 * Progress: the visible line (#sfFitProgress) says what is fitted and for how
 * long (a tick every second through ctx.deps.timers) and follows every
 * accepted step; after a finished fit it is blank (the measure line of the
 * bar has the result), after a stop or a failure it says so. The screen
 * reader region (#sfFitLive) is written only when a fit starts and when it
 * ends. Errors go where SasFitHints.errorNotice says
 * (#sfFitAlert or #sfAlert), their detail to console.warn, and both alerts are
 * cleared when the next fit starts or succeeds.
 *
 * Focus: "start" is disabled while a fit runs, so the focus moves to "stop";
 * when a fit stops or fails it returns to "start"; a finished fit moves it to
 * the results on the fit tab (A11y.focusResults), else to "start".
 *
 * A sequence (SasFitSeqUi; ctx.sequence.running()) uses this bar too: "start"
 * is disabled as during any fit, "stop" stops it (the client resolves the
 * running fit as 'stopped' and the sequence ends there), the progress line is
 * written by the sequence through setBarProgress, and the measure line is
 * blank until the sequence has ended (it would show one dataset's old result
 * next to the progress of another).
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
    const PARAMS_ID = 'sfFitParams';
    const STALE_CLASS = 'is-stale';
    const TICK_MS = 1000;
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
        rangeInfo: (points, free) => '範圍內 ' + points + ' 點可參與擬合；擬合 ' + free + ' 個參數',
        qMinNumber: 'q 下限必須是不小於 0 的數字',
        qMaxNumber: 'q 上限必須是大於 0 的數字',
        qOrder: 'q 下限必須小於 q 上限',
        steps: (max) => '最大步數必須是 1 到 ' + max + ' 的整數',
        fixFields: '擬合範圍或最大步數有不合法的欄位，請先修正。',
        starting: '開始擬合…',
        waitingPreview: '等待預覽完成…',
        notApplied: '擬合結果無法寫入參數表，參數表仍是擬合前的數值；下列為擬合結果',
        progress: (step, label, value) => '第 ' + step + ' 步，' + label + '＝' + value,
        stopped: (step) => (step > 0 ? '已停止（第 ' + step + ' 步），參數未變更' : '已停止，尚未完成第一步；參數未變更'),
        finished: (status, label, value, steps) => '擬合結束：' + status + '，' + label + '＝' + value + '，共 ' + steps + ' 步',
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

    // ------------------------------------------------------------- elapsed time of a running fit

    /** The line of a running fit: what is fitted and for how long, then the latest step (never read out: see setProgress). */
    function runningText(ui) {
        const { seconds, waiting, step } = ui.store.get();
        const head = waiting && step === '' ? TEXT.waitingPreview : globalThis.SasFitLabels.elapsedText(ui.ctx.getForm().model, seconds);
        return step === '' ? head : head + '；' + step;
    }

    function stopClock(ui) {
        const { tick } = ui.store.get();
        if (tick !== null) ui.ctx.deps.timers.clearTimeout(tick);
        ui.store.set({ tick: null });
    }

    /** One second later: count it and show it, as long as this run is still the one that is running. */
    function onTick(ui, run) {
        ui.store.set({ tick: null });
        if (run !== ui.store.get().run || !isRunning(ui.ctx.getState())) return;
        ui.store.set({ seconds: ui.store.get().seconds + 1 });
        setProgress(ui, runningText(ui), false);
        ui.store.set({ tick: ui.ctx.deps.timers.setTimeout(() => onTick(ui, run), TICK_MS) });
    }

    function startClock(ui, run, waiting) {
        stopClock(ui);
        ui.store.set({ seconds: 0, waiting, step: '' });
        ui.store.set({ tick: ui.ctx.deps.timers.setTimeout(() => onTick(ui, run), TICK_MS) });
    }

    function focusOn(ctx, id) {
        const element = ctx.el(id);
        if (element && typeof element.focus === 'function') element.focus();
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

    /**
     * { ok, summary, info }: whether a fit can start now; the line of the fit bar (the range, the points and the
     * names that are fitted, or why a fit cannot start); the line under the range (blank while the range typed is
     * not valid: it would describe the range before it).
     */
    function readiness(ui, state) {
        const file = activeFile(state);
        if (file === null) return { ok: false, summary: TEXT.needData, info: '' };
        const { rangeErrors, stepsError } = ui.store.get();
        const form = ui.ctx.getForm();
        const ready = globalThis.SasFitJobs.fitReadiness(form, file.dataset, { range: state.range, weighting: state.weighting });
        const fieldsOk = rangeErrors.qMin === '' && rangeErrors.qMax === '' && stepsError === '';
        if (!ready.ok) return { ok: false, summary: ready.reason, info: '' };
        const names = globalThis.SasFitJobs.fitNames(form).free;
        const summary = globalThis.SasFitLabels.fitSummary({ range: state.range, nPoints: ready.nPoints, names });
        const rangeOk = rangeErrors.qMin === '' && rangeErrors.qMax === '';
        return { ok: fieldsOk, summary: fieldsOk ? summary : TEXT.fixFields, info: rangeOk ? TEXT.rangeInfo(ready.nPoints, ready.nFree) : '' };
    }

    /** "Revert" belongs to the dataset whose fit it would undo: { enabled, note }. */
    function revertState(ui, state) {
        const { before, beforeFor } = ui.store.get();
        if (before === null) return { enabled: false, note: '' };
        if (beforeFor === state.activeId) return { enabled: !isRunning(state), note: '' };
        const owner = state.files.find((file) => file.id === beforeFor);
        return { enabled: false, note: owner === undefined ? '' : globalThis.SasFitHints.revertOtherText(owner.fileName) };
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
        ctx.el('sfRangeInfo').textContent = ready.info;
        ctx.el('sfFitSummary').textContent = ready.summary;
        const form = ctx.getForm();
        const hints = globalThis.SasFitHints.preFitHints({
            modelSpec: globalThis.SasFitJobs.modelSpec(form), dataset, range: state.range, weighting: state.weighting,
            notes: file === null ? null : file.notes, fit: dataset === null ? null : globalThis.SasFitJobs.fitNames(form),
        });
        ctx.setHtml(ctx.el('sfPreFitHints'), globalThis.SasFitHtml.hintsHtml(hints));
        ctx.el('sfFitStart').disabled = locked || !ready.ok;
        ctx.el('sfFitStop').disabled = !locked;
        const revert = revertState(ui, state);
        ctx.el('sfFitRevert').disabled = !revert.enabled;
        ctx.el('sfFitRevertNote').textContent = revert.note;
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
        const params = ctx.el(PARAMS_ID);
        const notApplied = result !== null && store.get().unapplied === result;
        ctx.setHtml(results, html.resultsHtml(result, {
            matches, notApplied, running: locked, fileName: file === null ? '' : file.fileName, hasData: file !== null,
        }));
        ctx.setHtml(params, html.resultParamsHtml(result, { absolute: file !== null && file.dataset.kind === 'official' }));
        // a result that is not the one of the current parameters (changed since, or a new fit is running) is shown subdued
        const stale = result !== null && (locked || !(matches || notApplied));
        [results, params].forEach((element) => element.classList.toggle(STALE_CLASS, stale));
        results.setAttribute('aria-busy', String(locked));
        const inSequence = isObject(ctx.sequence) && ctx.sequence.running() === true;
        ctx.setHtml(ctx.el('sfFitMeasure'), inSequence ? '' : html.fitBarHtml({ result, matches: matches || notApplied, running: locked }));
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
        stopClock(ui);
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
        store.set({ step: TEXT.progress(iteration, globalThis.SasFitHints.measure(ctx.getState().weighting).label, chi2rText(chi2r)) });
        setProgress(ui, runningText(ui), false);
    }

    /** The fitted values go into the form; a result that cannot be applied is shown without changing it, and said so. */
    function applyToForm(ui, result) {
        const { ctx } = ui;
        try {
            ctx.setForm(globalThis.SasFitJobs.applyResult(ctx.getForm(), result));
            return true;
        } catch (err) {
            console.warn(LOG + ' 擬合結果無法套用到參數表：' + (err instanceof Error ? err.message : String(err)));
            ui.store.set({ unapplied: result });
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
            focusOn(ctx, 'sfFitStart');                            // "stop" is disabled again: the focus must not fall to the page
            return;
        }
        const { pending, keepBefore, before, beforeFor } = store.get();
        const applied = applyToForm(ui, result);
        const fitted = ctx.getState().fit.datasetId;
        if (applied) store.set({ before: keepBefore && before !== null && beforeFor === fitted ? before : pending, beforeFor: fitted });
        clearAlerts(ctx);
        if (!applied) showAlert(ctx, 'sfFitAlert', FIT_ERROR_ID, TEXT.notApplied);
        settle(ui, result);
        const label = globalThis.SasFitHints.statusLabel(result).text;
        // the bar's measure line shows the result: the progress line is cleared, the screen reader region is told
        setProgress(ui, '', false);
        ctx.el('sfFitLive').textContent = TEXT.finished(label, globalThis.SasFitHints.measure(result).label, chi2rText(result.chi2r),
            Number.isInteger(result.iterations) ? result.iterations : 0);
        const a11y = host().A11y;
        if (ctx.getState().tab === FIT_TAB && isObject(a11y)) a11y.focusResults(RESULTS_ID);
        else focusOn(ctx, 'sfFitStart');                           // on the other tabs the results are not on screen
    }

    function onFailure(ui, run, err) {
        const { ctx, store } = ui;
        if (run !== store.get().run) return;
        const notice = globalThis.SasFitHints.errorNotice(err, 'fit');
        settle(ui, null);
        focusOn(ctx, 'sfFitStart');
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
        // A preview still on its timer is dropped. One already in the Worker cannot be: the fit waits behind it (up
        // to about 2 s for the heaviest previews) and the progress line says so until the first step arrives.
        const waiting = ctx.preview.cancel() === true;
        clearAlerts(ctx);
        const run = store.get().run + 1;
        store.set({ run, pending: form, keepBefore, unapplied: null });
        ctx.dispatch({ type: 'fitStarted' });
        startClock(ui, run, waiting);
        setProgress(ui, runningText(ui), false);
        ctx.el('sfFitLive').textContent = waiting ? TEXT.waitingPreview : TEXT.starting;
        focusOn(ctx, 'sfFitStop');                                 // "start" is disabled now: the focus goes to what can be done
        let promise;
        try {
            promise = ctx.client.fit(job, { onProgress: (progress) => onProgress(ui, run, progress) });
        } catch (err) {
            promise = Promise.reject(err);                         // the client could not be created
        }
        promise.then((result) => onResult(ui, run, result), (err) => onFailure(ui, run, err)).catch((err) => {
            console.error(LOG + ' 處理擬合結果時發生未預期的錯誤', err);       // a bug here must not leave the page locked
            settle(ui, null);
            focusOn(ctx, 'sfFitStart');
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
        if (!revertState(ui, ctx.getState()).enabled) return;
        store.set({ before: null, beforeFor: null });
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
            beforeFor: null, run: 0, progress: '', progressFor: null, unapplied: null, tick: null, seconds: 0, waiting: false, step: '',
        }) });
        bind(ui);
        return Object.freeze({
            render: () => render(ui),
            forgetRevert: () => { ui.store.set({ before: null, beforeFor: null }); },
            setBarProgress: (text) => setProgress(ui, typeof text === 'string' ? text : '', false),
        });
    }

    globalThis.SasFitFitUi = Object.freeze({ create });
})();
