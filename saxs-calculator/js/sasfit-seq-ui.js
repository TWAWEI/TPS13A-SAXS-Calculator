/**
 * sasfit-seq-ui.js -- the sequence segment of the SAS fitting page (design
 * spec 7; plan M4 Tasks 10-12). Original code. DOM module: loaded before
 * section-sasfit.js, which calls SasFitSeqUi.create(ctx) once.
 *
 *   SasFitSeqUi.create(ctx) -> { render(), running(), barText() }
 *       running()   a sequence is running
 *       barText()   the progress text of the running sequence for the fit bar ('' when none runs)
 *
 * What it owns:
 *   options   "start each fit from the previous result" and "order by the
 *             condition value" (state.seq.options)
 *   summary   one line that says what a sequence would use -- model, range,
 *             weighting, fitted names, steps: all of them are set on the model
 *             and fit tabs and only read here -- or why it cannot run
 *   table     ONE table (SasFitSeqView.headHtml / bodyHtml) that both selects
 *             the files and lists their results; ticks by event delegation
 *             (data-action "pick"), "all" / "none"
 *
 *   run       "run" plans the sequence, locks the page (action seqStarted) and
 *             hands the plan to SasFitSequence.run with the Worker client as
 *             fitOne. There is no stop button here: "stop" of the fit bar
 *             stops the running fit (it resolves as 'stopped') and the runner
 *             ends the sequence there. There is no resume: a new run starts over.
 *
 * Rendering during a run (plan M4, performance decision 7). A run of 500
 * files with fits of a few milliseconds must not redraw the page 500 times:
 * seqStep and fitProgress are dispatched SILENTLY, the progress text is
 * written directly (here and, through ctx.fit.setBarProgress, into the fit
 * bar), and ONE throttled ctx.refresh() (REFRESH_MS, ctx.deps.timers) updates
 * everything else; the end of the run always refreshes once.
 *
 * Unlocking. seqSettled is dispatched on EVERY path -- the runner resolving
 * with any outcome, the runner or this module throwing, the client getter
 * throwing, a state dispatch throwing (the runner then aborts) -- by finish()
 * and, should finish() itself fail, by the last catch of start(). A "stop"
 * that does not end the run within STOP_GRACE_MS (stop() threw before it
 * could resolve the fit) abandons the run: the page is unlocked with a page
 * alert, and whatever the abandoned run still reports is ignored.
 * After the end THIS module clears the progress line of the fit bar
 * (ctx.fit.setBarProgress) -- or leaves "stopped" / "aborted" there.
 *
 * After a run (finished or stopped): when the fit target (state.activeId) was
 * fitted in it, its values are written into the form and the revert point of
 * the fit tab is dropped, so the page does not call a form the user never
 * touched "changed"; otherwise the form stays and a note says that rows can
 * be loaded from the table.
 *
 * Whether a sequence can run is decided by planning it (SasFitSequence.plan):
 * the same function the run uses, so the summary cannot promise what the run
 * would not do. The plan is kept until one of its inputs is replaced.
 *
 * render() does not dispatch and writes HTML only through ctx.setHtml: the
 * table is rebuilt only when its HTML changes, and the focus returns to the
 * checkbox or button with the same id.
 *
 * SECURITY: file names, condition names, notes and error texts reach the page
 * through the SasFitSeqView / SasFitHtml builders (which escape) or
 * textContent. Nothing here builds HTML.
 */

(function () {
    'use strict';

    const LOG = '[sasfit]';
    const DOT = ' · ';
    const LIST_SEPARATOR = '、';
    const ANY_RANGE = Object.freeze({ qMin: 0, qMax: Infinity });
    const FORM_CHECK_WEIGHTING = 'none';             // asks fitReadiness about the form alone (no dataset lacks this weighting)
    const OPTION_INPUTS = Object.freeze({ chain: 'sfSeqChain', sort: 'sfSeqSort' });
    const REFRESH_MS = 250;                          // at most one full redraw per this long while a sequence runs
    const LIVE_QUIET_MS = 2000;                      // the screen reader hears of finished rows at most this often
    const STOP_GRACE_MS = 1000;                      // a working stop ends the run at once; after this long it has failed
    const MEASURE_DIGITS = 3;
    const SEQUENCE_TAB = 'sequence';
    const PAGE_ERROR_ID = 'page-error';
    const STOPPED = 'stopped';
    // what fitOne answers once "stop" was pressed and the fit before it had already ended: the runner stops there
    const STOP_RESULT = Object.freeze({ status: STOPPED, names: Object.freeze([]), params: Object.freeze({}) });
    const DONE_STATES = Object.freeze(['done', 'error']);
    const TEXT = Object.freeze({
        noData: '請先載入資料',
        noneTicked: '請至少勾選一個要擬合的資料',
        allSkipped: (reason) => '勾選的資料都無法擬合：' + reason,
        ownRanges: '各檔的預設範圍',
        clippedRanges: (range) => range + '（各檔截到自己的可用範圍）',
        model: (name) => '模型 ' + name,
        weighting: (label) => '權重 ' + label,
        fitted: (names) => '擬合 ' + names,
        steps: (count) => '最大步數 ' + count,
        counts: (fit, skip) => '將擬合 ' + fit + ' 個檔' + (skip > 0 ? '，跳過 ' + skip + ' 個' : ''),
        willSkip: (count, reason) => count + ' 個勾選的檔會被跳過：' + reason,
        started: (total) => '序列擬合開始，共 ' + total + ' 筆',
        progress: (k, total, name) => '序列擬合 第 ' + k + '／' + total + ' 筆：' + name,
        step: (step, label, value) => '第 ' + step + ' 步，' + label + '＝' + value,
        rowDone: (k, total, name, status) => '第 ' + k + '／' + total + ' 筆 ' + name + '：' + status,
        finished: (done, total) => '序列擬合完成，共 ' + done + '／' + total + ' 筆',
        stopped: (done, total) => '序列已停止，完成 ' + done + '／' + total + ' 筆',
        aborted: (done, total) => '序列中止，完成 ' + done + '／' + total + ' 筆',
        abortedBar: '序列中止',
        loadedActive: (name) => '已把 ' + name + ' 的序列結果載入參數表；其他資料可由下表逐列載入',
        loadRows: '序列結果可由下表逐列載入',
        inconsistent: '序列擬合已中止：擬合的狀態與頁面不一致，請再執行一次',
        stopFailed: '停止沒有成功，序列已中止；若仍有擬合在背景執行，請重新整理頁面',
        cannotStart: '序列擬合無法開始，請重新整理頁面後再試',
        endFailed: '序列擬合結束時發生未預期的錯誤，部分結果可能沒有顯示；請重新整理頁面後再試',
        rowError: '出錯',
    });

    const isObject = (v) => v !== null && typeof v === 'object';
    const isRunning = (state) => state.fit.phase === 'running';
    const seqRunning = (state) => state.seq.phase === 'running';

    /** A value that is replaced as a whole (frozen) on every change. */
    function makeStore(initial) {
        let value = Object.freeze({ ...initial });
        return Object.freeze({
            get: () => value,
            set(changes) { value = Object.freeze({ ...value, ...changes }); return value; },
        });
    }

    // ------------------------------------------------------------- what a sequence would do

    /** The plan of a sequence started now; planned again only when one of its inputs was replaced. */
    function trialPlan(ui, state) {
        const form = ui.ctx.getForm();
        const inputs = [state.files, state.seq.selected, state.seq.options, state.range, state.weighting, form];
        const { planInputs, plan } = ui.store.get();
        if (planInputs !== null && inputs.every((input, i) => input === planInputs[i])) return plan;
        const next = globalThis.SasFitSequence.plan({
            files: state.files, selected: state.seq.selected, options: state.seq.options, range: state.range,
            weighting: state.weighting, form,
        });
        ui.store.set({ planInputs: Object.freeze(inputs), plan: next });
        return next;
    }

    /** Why the form alone forbids every fit (invalid field, nothing ticked), or null. */
    function formReason(form, dataset) {
        const ready = globalThis.SasFitJobs.fitReadiness(form, dataset, { range: ANY_RANGE, weighting: FORM_CHECK_WEIGHTING });
        return !ready.ok && ready.nPoints === null ? ready.reason : null;
    }

    /** { ok, reason, plan }: whether a sequence can start now; plan is null while there is nothing to plan. */
    function readiness(ui, state) {
        const withData = state.files.filter((file) => file.dataset !== null);
        if (withData.length === 0) return { ok: false, reason: TEXT.noData, plan: null };
        if (globalThis.SasFitState.seqSelectedFiles(state).length === 0) return { ok: false, reason: TEXT.noneTicked, plan: null };
        const blocked = formReason(ui.ctx.getForm(), withData[0].dataset);
        if (blocked !== null) return { ok: false, reason: blocked, plan: null };
        const plan = trialPlan(ui, state);
        const fittable = plan.items.filter((item) => item.skip === null);
        if (fittable.length === 0) return { ok: false, reason: TEXT.allSkipped(plan.items[0].skip), plan };
        return { ok: true, reason: '', plan };
    }

    /** The line that says what a sequence would use. */
    function summaryText(ui, state, plan) {
        const form = ui.ctx.getForm();
        const labels = globalThis.SasFitLabels;
        const edited = state.range !== null && state.range.userEdited === true;
        const fittable = plan.items.filter((item) => item.skip === null).length;
        return [
            TEXT.model(form.structure === null ? form.model : form.model + ' × ' + form.structure),
            edited ? TEXT.clippedRanges(labels.rangeText(state.range)) : TEXT.ownRanges,
            TEXT.weighting(globalThis.SasFitHtml.WEIGHTING_LABELS[state.weighting]),
            TEXT.fitted(globalThis.SasFitJobs.fitNames(form).free.join(LIST_SEPARATOR)),
            TEXT.steps(state.maxSteps),
            TEXT.counts(fittable, plan.items.length - fittable),
        ].join(DOT);
    }

    /** What the user should know before the run: files without a condition, files that will be skipped. */
    function planHints(plan) {
        if (plan === null) return [];
        const skipped = plan.items.filter((item) => item.skip !== null);
        const hints = plan.warnings.map((text, i) => ({ id: 'seq-warning-' + i, tone: 'warn', text }));
        if (skipped.length > 0 && skipped.length < plan.items.length) {
            hints.push({ id: 'seq-skip', tone: 'warn', text: TEXT.willSkip(skipped.length, skipped[0].skip) });
        }
        return hints;
    }

    // ------------------------------------------------------------- render

    function renderOptions(ui, state, locked) {
        Object.keys(OPTION_INPUTS).forEach((key) => {
            const input = ui.ctx.el(OPTION_INPUTS[key]);
            if (input.checked !== state.seq.options[key]) input.checked = state.seq.options[key];
            input.disabled = locked;
        });
    }

    function renderTable(ui, state, locked) {
        const { ctx } = ui;
        const view = globalThis.SasFitSeqView;
        const rows = view.tableRows(state);
        const empty = rows.length === 0;
        ctx.setHtml(ctx.el('sfSeqHead'), view.headHtml(view.columns(state), state.conditionName));
        ctx.setHtml(ctx.el('sfSeqBody'), view.bodyHtml(rows, { locked }));
        ctx.el('sfSeqEmpty').textContent = TEXT.noData;
        ctx.el('sfSeqEmpty').hidden = !empty;
        ctx.el('sfSeqWrapper').hidden = empty;
        ['sfSeqAll', 'sfSeqNone'].forEach((id) => { ctx.el(id).disabled = locked || empty; });
    }

    /** The summary line (or why a sequence cannot run), the hints of the plan and the run button. */
    function renderReadiness(ui, state, locked) {
        const { ctx } = ui;
        ctx.el('sfSeqLock').textContent = globalThis.SasFitHints.LOCKED_TEXT;
        ctx.el('sfSeqLock').hidden = !locked;
        if (locked) {                                     // the plan of a run in progress is in the state, not here
            ctx.el('sfSeqRun').disabled = true;
            return;
        }
        const ready = readiness(ui, state);
        // the line that says how the last run ended goes with its rows
        if (ui.store.get().noteRows !== state.seq.rows) ctx.el('sfSeqProgress').textContent = '';
        ctx.el('sfSeqRun').disabled = !ready.ok;
        ctx.el('sfSeqSettings').textContent = ready.ok ? summaryText(ui, state, ready.plan) : ready.reason;
        const hints = endHints(ui, state).concat(ready.ok ? planHints(ready.plan) : []);
        ctx.setHtml(ctx.el('sfSeqHints'), globalThis.SasFitHtml.hintsHtml(hints));
    }

    /** What the last run left to say (which result went into the form); gone once the rows of that run are. */
    function endHints(ui, state) {
        const { note, noteRows } = ui.store.get();
        return note !== '' && noteRows === state.seq.rows ? [{ id: 'seq-end', tone: 'ok', text: note }] : [];
    }

    function render(ui) {
        const state = ui.ctx.getState();
        const locked = isRunning(state);
        renderOptions(ui, state, locked);
        renderTable(ui, state, locked);
        renderReadiness(ui, state, locked);
    }

    // ------------------------------------------------------------- progress of a run

    const fileName = (state, id) => {
        const file = state.files.find((f) => f.id === id);
        return file === undefined ? '' : file.fileName;
    };

    /** The progress text, written directly (no redraw): here and in the fit bar. */
    function showProgress(ui, text) {
        ui.store.set({ barText: text });
        ui.ctx.el('sfSeqProgress').textContent = text;
        ui.ctx.fit.setBarProgress(text);
    }

    function progressText(ui) {
        const { current, total, step } = ui.store.get();
        if (current === null) return '';
        const head = TEXT.progress(current.k, total, fileName(ui.ctx.getState(), current.id));
        return step === '' ? head : head + '；' + step;
    }

    /** One full redraw at most every REFRESH_MS while the run goes on. */
    function scheduleRefresh(ui, run) {
        const { store, ctx } = ui;
        if (store.get().refreshTimer !== null) return;
        store.set({ refreshTimer: ctx.deps.timers.setTimeout(() => {
            store.set({ refreshTimer: null });
            if (run === store.get().run && seqRunning(ctx.getState())) ctx.refresh();
        }, REFRESH_MS) });
    }

    function clearTimer(ui, key) {
        const id = ui.store.get()[key];
        if (id !== null) ui.ctx.deps.timers.clearTimeout(id);
        ui.store.set({ [key]: null });
    }

    /** Tells the screen reader that a row ended, at most every LIVE_QUIET_MS (500 rows must not flood it). */
    function announceRow(ui, text) {
        const { store, ctx } = ui;
        if (store.get().liveTimer !== null) return;
        ctx.el('sfSeqLive').textContent = text;
        store.set({ liveTimer: ctx.deps.timers.setTimeout(() => store.set({ liveTimer: null }), LIVE_QUIET_MS) });
    }

    function onRow(ui, event) {
        const { ctx, store } = ui;
        const { row } = event;
        if (row.state === 'running') {
            store.set({ current: Object.freeze({ id: event.id, k: store.get().finished + 1 }), step: '' });
            showProgress(ui, progressText(ui));
            return;
        }
        // silent: one redraw per row would be 500 redraws; a dispatch that throws goes back to the runner, which aborts
        ctx.dispatch({ type: 'seqStep', id: event.id, row, next: event.next }, { silent: true });
        if (DONE_STATES.indexOf(row.state) < 0) return;
        const { finished, total } = store.set({ finished: store.get().finished + 1 });
        const status = row.result === null ? TEXT.rowError : globalThis.SasFitHints.statusLabel(row.result).text;
        announceRow(ui, TEXT.rowDone(finished, total, fileName(ctx.getState(), event.id), status));
    }

    function onStep(ui, event) {
        const { ctx, store } = ui;
        const { iteration, chi2r } = event;
        if (!Number.isInteger(iteration) || iteration < 0) return;
        ctx.dispatch({ type: 'fitProgress', iteration, chi2r: typeof chi2r === 'number' ? chi2r : null }, { silent: true });
        const label = globalThis.SasFitHints.measure(ctx.getState().seq.settings.weighting).label;
        store.set({ step: TEXT.step(iteration, label, globalThis.SasFitHtml.formatNumber(chi2r, MEASURE_DIGITS)) });
        showProgress(ui, progressText(ui));
    }

    /** An event of the runner. What an abandoned run still reports is ignored; an exception goes back to the runner. */
    function onEvent(ui, run, event) {
        const { store } = ui;
        if (run !== store.get().run) return;
        if (event.type === 'start') store.set({ total: event.fittable });
        else if (event.type === 'row') onRow(ui, event);
        else if (event.type === 'progress') onStep(ui, event);
        if (event.type !== 'end') scheduleRefresh(ui, run);
    }

    // ------------------------------------------------------------- the end of a run

    function showPageAlert(ctx, text) {
        ctx.setHtml(ctx.el('sfAlert'), globalThis.SasFitHtml.hintsHtml([{ id: PAGE_ERROR_ID, tone: 'error', text }]));
    }

    /** seqSettled, whatever happens: a page that stays locked could only be reloaded. */
    function settle(ui, outcome) {
        const { ctx } = ui;
        if (!seqRunning(ctx.getState())) return;
        try {
            ctx.dispatch({ type: 'seqSettled', outcome }, { silent: true });
        } catch (err) {
            console.error(LOG + ' 序列的結束狀態無法寫入', err);
            ctx.dispatch({ type: 'seqSettled', outcome: 'aborted' }, { silent: true });
        }
    }

    /**
     * The fit target's own result goes into the form when this run fitted it; -> the note for the hints.
     * The form is locked during a run, so ctx.getForm() is still the form the run started from.
     */
    function loadActive(ui) {
        const { ctx } = ui;
        const state = ctx.getState();
        const rows = Object.values(state.seq.rows);
        const own = state.activeId === null ? undefined : rows.find((row) => row.id === state.activeId && row.state === 'done' && row.result !== null);
        if (own === undefined) return rows.some((row) => row.state === 'done') ? TEXT.loadRows : '';
        try {
            ctx.setForm(globalThis.SasFitJobs.applyResult(ctx.getForm(), own.result));
        } catch (err) {
            console.warn(LOG + ' 序列結果無法套用到參數表：' + (err instanceof Error ? err.message : String(err)));
            return TEXT.loadRows;
        }
        ctx.fit.forgetRevert();                            // the form is that result now: there is nothing "before the fit" to return to
        return TEXT.loadedActive(fileName(state, own.id));
    }

    function reportAbort(ui, error) {
        const notice = globalThis.SasFitHints.errorNotice(error, 'fit');
        if (notice.detail !== '') console.warn(LOG + ' ' + notice.detail);
        showPageAlert(ui.ctx, notice.where === 'ignore' || notice.text === '' ? TEXT.inconsistent : notice.text);
    }

    function focusOn(ctx, id) {
        const element = ctx.el(id);
        if (element && typeof element.focus === 'function') element.focus();
    }

    /** The end of a run on every path: unlock first, then say how it ended. */
    function finish(ui, run, end) {
        const { ctx, store } = ui;
        if (run !== store.get().run) return;               // abandoned: abandon() has unlocked and reported
        ['refreshTimer', 'liveTimer', 'stopTimer'].forEach((key) => clearTimer(ui, key));
        const outcome = isObject(end) && typeof end.outcome === 'string' ? end.outcome : 'aborted';
        settle(ui, outcome);
        const settled = ctx.getState().seq.outcome;        // what the state accepted
        const { finished, total } = store.get();
        const note = settled === 'aborted' ? '' : loadActive(ui);
        store.set({ current: null, step: '', note, noteRows: ctx.getState().seq.rows });
        const text = TEXT[settled === 'finished' ? 'finished' : (settled === STOPPED ? 'stopped' : 'aborted')](finished, total);
        // the fit bar's progress line is ours to end: blank after a finished run (its measure line is back), else why it ended
        showProgress(ui, settled === 'finished' ? '' : (settled === STOPPED ? text : TEXT.abortedBar));
        store.set({ barText: '' });
        ctx.el('sfSeqProgress').textContent = text;
        if (settled === 'aborted') reportAbort(ui, isObject(end) ? end.error : undefined);
        ctx.refresh();
        ctx.el('sfSeqLive').textContent = text;
        focusOn(ctx, ctx.getState().tab === SEQUENCE_TAB ? 'sfSeqRun' : 'sfFitStart');
    }

    /** "Stop" did not end the run (stop() failed before it could resolve the fit): give the run up and unlock. */
    function abandon(ui, run) {
        const { ctx, store } = ui;
        store.set({ stopTimer: null });
        if (run !== store.get().run || !seqRunning(ctx.getState())) return;
        store.set({ run: run + 1 });                       // whatever that run still reports is ignored from here on
        ['refreshTimer', 'liveTimer'].forEach((key) => clearTimer(ui, key));
        settle(ui, 'aborted');
        store.set({ current: null, step: '', note: '', barText: '', noteRows: ctx.getState().seq.rows });
        ctx.el('sfSeqProgress').textContent = TEXT.abortedBar;
        ctx.fit.setBarProgress(TEXT.abortedBar);
        showPageAlert(ctx, TEXT.stopFailed);
        ctx.refresh();
        ctx.el('sfSeqLive').textContent = TEXT.stopFailed;
        focusOn(ctx, ctx.getState().tab === SEQUENCE_TAB ? 'sfSeqRun' : 'sfFitStart');
    }

    /** "Stop" of the fit bar during a sequence (SasFitFitUi has already called client.stop()). */
    function onStop(ui) {
        const { ctx, store } = ui;
        if (!seqRunning(ctx.getState()) || store.get().stopTimer !== null) return;
        const { run } = store.get();
        // no further fit is sent, and the run is given up if it has not ended by itself after the grace period
        store.set({ stopRequested: true, stopTimer: ctx.deps.timers.setTimeout(() => abandon(ui, run), STOP_GRACE_MS) });
    }

    /** finish() itself failed: unlock and say so, with nothing that can throw left unguarded. */
    function lastResort(ui) {
        const { ctx } = ui;
        try {
            settle(ui, 'aborted');
            showPageAlert(ctx, TEXT.endFailed);
            ctx.fit.setBarProgress(TEXT.abortedBar);
            ctx.refresh();
        } catch (err) {
            console.error(LOG + ' 序列結束後無法更新畫面', err);
        }
    }

    // ------------------------------------------------------------- starting a run

    /**
     * One fit of the run. After "stop", and for a run that was abandoned, nothing is sent any more. ctx.client is a
     * getter that may throw (the Worker cannot be created): the runner then aborts.
     */
    function fitOne(ui, run, job, onProgress) {
        const { stopRequested, run: current } = ui.store.get();
        if (stopRequested || run !== current) return Promise.resolve(STOP_RESULT);
        return ui.ctx.client.fit(job, { onProgress });
    }

    function runSequence(ui, run, plan, form, settings) {
        const { ctx } = ui;
        const state = ctx.getState();
        return globalThis.SasFitSequence.run({
            plan, form, settings, chain: state.seq.options.chain,
            datasetOf: (id) => state.files.find((file) => file.id === id).dataset,       // the list is locked during a run
            fitOne: (job, onProgress) => fitOne(ui, run, job, onProgress),
            onEvent: (event) => onEvent(ui, run, event),
        });
    }

    function start(ui) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        if (isRunning(state)) return;
        const ready = readiness(ui, state);
        if (!ready.ok) {
            ctx.refresh();
            return;
        }
        const form = ctx.getForm();
        const settings = { weighting: state.weighting, maxSteps: state.maxSteps, rangeEdited: state.range !== null && state.range.userEdited === true };
        ctx.preview.cancel();                              // a preview still on its timer must not start during the run
        ctx.setHtml(ctx.el('sfAlert'), '');
        const run = store.get().run + 1;
        store.set({ run, total: 0, finished: 0, current: null, step: '', note: '', stopRequested: false });
        try {
            ctx.dispatch({ type: 'seqStarted', plan: ready.plan, form, settings });      // not silent: the whole page locks
        } catch (err) {
            console.error(LOG + ' 序列擬合無法開始', err);
            showPageAlert(ctx, TEXT.cannotStart);
            return;
        }
        focusOn(ctx, 'sfFitStop');                         // "run" is disabled now: the focus goes to what can be done
        ctx.el('sfSeqLive').textContent = TEXT.started(ready.plan.items.filter((item) => item.skip === null).length);
        let promise;
        try {
            promise = runSequence(ui, run, ready.plan, form, settings);
        } catch (err) {
            promise = Promise.reject(err);
        }
        const failed = (err) => finish(ui, run, { outcome: 'aborted', error: err });
        promise.then((end) => finish(ui, run, end), failed).catch((err) => {
            console.error(LOG + ' 處理序列結果時發生未預期的錯誤', err);       // a bug here must not leave the page locked
            lastResort(ui);
        });
    }

    // ------------------------------------------------------------- events

    /** A change of the selection or of an option; refused while anything runs (the state would throw). */
    function change(ui, action) {
        const { ctx } = ui;
        if (isRunning(ctx.getState())) {
            ctx.refresh();                                 // puts the control back to what the state says
            return;
        }
        try {
            ctx.dispatch(action);
        } catch (err) {
            console.error(LOG + ' 序列設定無法套用：' + action.type, err);
            ctx.refresh();
        }
    }

    function onBodyChange(ui, event) {
        const target = isObject(event.target) && typeof event.target.closest === 'function' ? event.target.closest('[data-action]') : null;
        if (target === null || target.dataset.action !== 'pick') return;
        const { id } = target.dataset;
        if (isRunning(ui.ctx.getState())) {
            // refused (the box is disabled; this is the second line of defence): the tick goes back to what the state says
            target.checked = globalThis.SasFitState.seqSelectedFiles(ui.ctx.getState()).some((file) => file.id === id);
            return;
        }
        change(ui, { type: 'setSeqSelected', id, selected: target.checked === true });
    }

    function bind(ui) {
        const { ctx } = ui;
        ctx.el('sfSeqBody').addEventListener('change', (event) => onBodyChange(ui, event));
        ctx.el('sfSeqAll').addEventListener('click', () => change(ui, { type: 'setSeqAll', selected: true }));
        ctx.el('sfSeqNone').addEventListener('click', () => change(ui, { type: 'setSeqAll', selected: false }));
        ctx.el('sfSeqRun').addEventListener('click', () => start(ui));
        ctx.el('sfFitStop').addEventListener('click', () => onStop(ui));
        Object.keys(OPTION_INPUTS).forEach((key) => {
            ctx.el(OPTION_INPUTS[key]).addEventListener('change', (event) => {
                change(ui, { type: 'setSeqOption', key, value: event.target.checked === true });
            });
        });
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({
            planInputs: null, plan: null, barText: '', run: 0, total: 0, finished: 0, current: null, step: '',
            note: '', noteRows: null, stopRequested: false, refreshTimer: null, liveTimer: null, stopTimer: null,
        }) });
        bind(ui);
        return Object.freeze({
            render: () => render(ui),
            running: () => seqRunning(ctx.getState()),
            barText: () => ui.store.get().barText,
        });
    }

    globalThis.SasFitSeqUi = Object.freeze({ create });
})();
