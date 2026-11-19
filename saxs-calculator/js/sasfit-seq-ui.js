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
        ctx.el('sfSeqRun').disabled = true;                // nothing is bound to it yet: it only says what a run would do
        if (locked) return;                               // the plan of a run in progress is in the state, not here
        const ready = readiness(ui, state);
        ctx.el('sfSeqSettings').textContent = ready.ok ? summaryText(ui, state, ready.plan) : ready.reason;
        ctx.setHtml(ctx.el('sfSeqHints'), globalThis.SasFitHtml.hintsHtml(ready.ok ? planHints(ready.plan) : []));
        ui.store.set({ ready: ready.ok });
    }

    function render(ui) {
        const state = ui.ctx.getState();
        const locked = isRunning(state);
        renderOptions(ui, state, locked);
        renderTable(ui, state, locked);
        renderReadiness(ui, state, locked);
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
        Object.keys(OPTION_INPUTS).forEach((key) => {
            ctx.el(OPTION_INPUTS[key]).addEventListener('change', (event) => {
                change(ui, { type: 'setSeqOption', key, value: event.target.checked === true });
            });
        });
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({ planInputs: null, plan: null, ready: false, barText: '' }) });
        bind(ui);
        return Object.freeze({
            render: () => render(ui),
            running: () => seqRunning(ctx.getState()),
            barText: () => ui.store.get().barText,
        });
    }

    globalThis.SasFitSeqUi = Object.freeze({ create });
})();
