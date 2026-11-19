/**
 * sasfit-sequence.js -- sequence fitting of the SAS fitting page: which files
 * are fitted in which order with which range, where each fit starts from, and
 * the runner that sends them one after the other (design spec 7; plan M4
 * Task 8). Original code.
 *
 *   plan({ files, selected, options, range, weighting, form })
 *       -> { items: [{ id, range, note, skip }], warnings }
 *     files / selected   state.files and state.seq.selected: an item for every
 *                        file with data whose tick was not taken away
 *     options.sort       by condition value, ascending and stable; files
 *                        without one go last (in list order) with a warning.
 *                        Off: list order.
 *     range              state.range at the start. Not edited by the user
 *                        (null or userEdited false): every file gets its OWN
 *                        SasFitWeighting.defaultRange. Edited: the requested
 *                        range clipped to the first and last q of the file
 *                        that can take part with this weighting; a clipped
 *                        range is said in `note`.
 *     skip               null, or why this file is not fitted: no usable sigma
 *                        with sigma weighting (the weighting is NEVER changed
 *                        for one file: one trend chart cannot mix two fit
 *                        measures), no point in the range, not more points
 *                        than free parameters, an invalid form. The texts are
 *                        SasFitJobs.fitReadiness's, except the empty range.
 *   isUsableStart(fitResult) -> boolean
 *       converged, not blockedByNonFinite and -- when the measure is a real
 *       chi-square -- chi2r <= SasFitHints.CHI2R_WARN. A value on a bound does
 *       not disqualify it.
 *   startForm(form0, lastUsable | null, chain) -> form
 *       form0 itself, or form0 with the fitted values of lastUsable written in
 *       through SasFitJobs.applyResult (the rounding of a single fit). Bounds,
 *       fit ticks, dispersity settings and the model always come from form0.
 *   run({ plan, form, settings: { weighting, maxSteps }, chain, datasetOf(id),
 *         fitOne(job, onProgress) -> Promise<FitResult>, onEvent })
 *       -> Promise<{ outcome: 'finished' | 'stopped' | 'aborted', error? }>
 *     The promise always resolves. Events, in order:
 *       { type: 'start', total, fittable }
 *       per fitted item (skipped ones send nothing: the page already shows them):
 *         { type: 'row', id, row: { state: 'running', ... }, next }
 *         { type: 'progress', id, iteration, chi2r } ...
 *         { type: 'row', id, row: { state: 'done' | 'error' | 'pending', ... }, next }
 *       { type: 'end', outcome, error? }
 *     row = { id, state, result, range, note, startedFrom } (the row of
 *     SasFitState); next = the id fitted after this one, or null.
 *     - a result with status 'stopped' ends the run: that row is 'pending'
 *       again and nothing more is sent. There is no resume.
 *     - fitOne rejecting (or throwing): SasFitHints.errorNotice decides. An
 *       error of the page (Worker cannot start, wasm, crash) or one the page
 *       ignores (BUSY, SUPERSEDED, STOPPED: the state is no longer what the
 *       runner thinks) aborts the run; any other marks the row 'error' with
 *       the message and the run goes on.
 *     - onEvent throwing (a state dispatch that failed) aborts the run:
 *       swallowing it would lose every later result without anyone noticing.
 *       Only the 'end' event may throw without consequence (console.error).
 *
 * Non-finite numbers in a FitResult (hayter_msa, design spec 16) are expected
 * input: such a fit is a row like any other and the run goes on.
 *
 * Pure logic apart from run (async, and it touches only what it is given): no
 * DOM, no timers; other SasFit modules are read at call time. Nothing given is
 * modified; plans, rows and events are frozen.
 */

(function () {
    'use strict';

    const LOG = '[sasfit]';
    const SIGMA_MODE = 'sigma';
    const STOPPED = 'stopped';
    const CONVERGED = 'converged';
    const NAMES_LISTED = 3;
    const LIST_SEPARATOR = '、';
    const ANY_RANGE = Object.freeze({ qMin: 0, qMax: Infinity });      // lets fitReadiness reach its checks of the data
    const ABORT_ROUTES = Object.freeze(['page', 'ignore']);
    const TEXT = Object.freeze({
        noCondition: (count, names, more) => count + ' 個檔沒有條件值，排在最後：' + names + (more ? '…' : ''),
        clipped: (actual, wanted) => '擬合範圍截為 ' + actual + '（要求 ' + wanted + '）',
        emptyRange: '要求的擬合範圍內沒有可參與擬合的資料點',
    });

    const isObject = (v) => v !== null && typeof v === 'object';
    const rangeText = (range) => globalThis.SasFitLabels.rangeText(range);

    // ------------------------------------------------------------- order

    const hasCondition = (file) => typeof file.condition === 'number' && Number.isFinite(file.condition);

    /** { files, warnings }: the files in the order they are fitted. */
    function ordered(files, sort) {
        if (!sort) return { files, warnings: [] };
        const withValue = files.filter(hasCondition).map((file, at) => ({ file, at }))
            .sort((a, b) => a.file.condition - b.file.condition || a.at - b.at).map(({ file }) => file);
        const blank = files.filter((file) => !hasCondition(file));
        if (blank.length === 0) return { files: withValue, warnings: [] };
        const names = blank.slice(0, NAMES_LISTED).map((file) => file.fileName).join(LIST_SEPARATOR);
        return { files: withValue.concat(blank), warnings: [TEXT.noCondition(blank.length, names, blank.length > NAMES_LISTED)] };
    }

    // ------------------------------------------------------------- the range of one file

    /** { qMin, qMax } of the points of the dataset that can take part with this weighting, or null. */
    function usableSpan(dataset, weighting) {
        const mask = globalThis.SasFitWeighting.mask(dataset, weighting);
        let qMin = Infinity;
        let qMax = -Infinity;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] !== 1) continue;
            if (dataset.q[i] < qMin) qMin = dataset.q[i];
            if (dataset.q[i] > qMax) qMax = dataset.q[i];
        }
        return qMax >= qMin ? { qMin, qMax } : null;
    }

    /** { range, note } | { skip } of the requested range on this dataset. */
    function clippedRange(dataset, weighting, wanted) {
        const span = usableSpan(dataset, weighting);
        if (span === null) return { skip: TEXT.emptyRange };
        const range = Object.freeze({ qMin: Math.max(wanted.qMin, span.qMin), qMax: Math.min(wanted.qMax, span.qMax) });
        if (!(range.qMin <= range.qMax)) return { skip: TEXT.emptyRange };
        const clipped = range.qMin !== wanted.qMin || range.qMax !== wanted.qMax;
        return { range, note: clipped ? TEXT.clipped(rangeText(range), rangeText(wanted)) : '' };
    }

    const skipped = (id, reason) => Object.freeze({ id, range: null, note: '', skip: reason });

    function itemOf(file, { range, weighting, form }) {
        const { dataset, id } = file;
        const jobs = globalThis.SasFitJobs;
        // what does not depend on the range comes first: an invalid form, nothing ticked, no usable sigma
        // (SasFitWeighting.mask would throw on a dataset without an error column)
        const basics = jobs.fitReadiness(form, dataset, { range: ANY_RANGE, weighting });
        if (!basics.ok && basics.nPoints === null) return skipped(id, basics.reason);
        const edited = isObject(range) && range.userEdited === true;
        const own = edited ? clippedRange(dataset, weighting, range)
            : { range: globalThis.SasFitWeighting.defaultRange(dataset, weighting), note: '' };
        if (own.skip !== undefined) return skipped(id, own.skip);
        if (own.range === null) return skipped(id, TEXT.emptyRange);
        const actual = Object.freeze({ qMin: own.range.qMin, qMax: own.range.qMax });
        const ready = jobs.fitReadiness(form, dataset, { range: actual, weighting });
        return ready.ok ? Object.freeze({ id, range: actual, note: own.note, skip: null }) : skipped(id, ready.reason);
    }

    function plan(input) {
        const { files, selected, options, range, weighting, form } = isObject(input) ? input : {};
        if (!Array.isArray(files) || !isObject(selected) || !isObject(options)) {
            throw new Error('SasFitSequence.plan needs files (array), selected and options (objects)');
        }
        if (globalThis.SasFitWeighting.MODES.indexOf(weighting) < 0) throw new Error('Unknown weighting mode: ' + String(weighting));
        const chosen = files.filter((file) => file.dataset !== null && selected[file.id] !== false);
        const order = ordered(chosen, options.sort === true);
        return Object.freeze({
            items: Object.freeze(order.files.map((file) => itemOf(file, { range, weighting, form }))),
            warnings: Object.freeze(order.warnings),
        });
    }

    // ------------------------------------------------------------- start values

    function isUsableStart(fitResult) {
        if (!isObject(fitResult) || fitResult.status !== CONVERGED || fitResult.blockedByNonFinite === true) return false;
        const hints = globalThis.SasFitHints;
        if (!hints.measure(fitResult).isChi2) return true;        // not a chi-square: its size says nothing
        return Number.isFinite(fitResult.chi2r) && fitResult.chi2r <= hints.CHI2R_WARN;
    }

    function startForm(form0, lastUsable, chain) {
        if (chain !== true || !isObject(lastUsable)) return form0;
        return globalThis.SasFitJobs.applyResult(form0, lastUsable);
    }

    // ------------------------------------------------------------- the runner

    const rowOf = (base, state, result, note) => Object.freeze({ ...base, state, result, note: note === undefined ? base.note : note });
    const rowEvent = (row, next) => Object.freeze({ type: 'row', id: row.id, row, next });
    const ended = (outcome, error) => ({ end: error === undefined ? { outcome } : { outcome, error } });

    /** A progress report of the Worker as an event; a throwing onEvent is kept in `guard` (the fit cannot be cancelled from here). */
    function forward(run, id, guard, progress) {
        if (guard.error !== null || !isObject(progress)) return;
        try {
            run.onEvent(Object.freeze({ type: 'progress', id, iteration: progress.iteration, chi2r: progress.chi2r }));
        } catch (err) {
            guard.error = err;
        }
    }

    /** What a rejected (or throwing) fit means: the run is aborted, or only this row is marked. */
    function failed(run, base, next, err) {
        const notice = globalThis.SasFitHints.errorNotice(err, 'fit');
        if (ABORT_ROUTES.indexOf(notice.where) >= 0) return ended('aborted', err);
        run.onEvent(rowEvent(rowOf(base, 'error', null, notice.text), next));
        return { end: null, usable: null };
    }

    /** One fit: -> { end: { outcome, error? } | null, usable: FitResult | null }. onEvent may throw out of here. */
    async function fitItem(run, item, last, next) {
        const startedFrom = run.chain && last !== null ? last.id : null;
        const base = Object.freeze({ id: item.id, state: 'running', result: null, range: item.range, note: item.note, startedFrom });
        run.onEvent(rowEvent(base, next));
        const guard = { error: null };
        let result;
        try {
            const form = startForm(run.form, last === null ? null : last.result, run.chain);
            const job = globalThis.SasFitJobs.fitJob(form, run.datasetOf(item.id),
                { range: item.range, weighting: run.settings.weighting, maxSteps: run.settings.maxSteps });
            result = await run.fitOne(job, (progress) => forward(run, item.id, guard, progress));
        } catch (err) {
            return guard.error === null ? failed(run, base, next, err) : ended('aborted', guard.error);
        }
        if (guard.error !== null) return ended('aborted', guard.error);
        if (!isObject(result) || typeof result.status !== 'string') return ended('aborted', new Error('the fit resolved without a result'));
        if (result.status === STOPPED) {
            run.onEvent(rowEvent(rowOf(base, 'pending', null), null));
            return ended(STOPPED);
        }
        run.onEvent(rowEvent(rowOf(base, 'done', result), next));
        return { end: null, usable: isUsableStart(result) ? result : null };
    }

    async function runItems(run) {
        const todo = run.plan.items.filter((item) => item.skip === null);
        run.onEvent(Object.freeze({ type: 'start', total: run.plan.items.length, fittable: todo.length }));
        let last = null;                      // { id, result }: the last result a fit may start from
        for (let k = 0; k < todo.length; k++) {
            const step = await fitItem(run, todo[k], last, k + 1 < todo.length ? todo[k + 1].id : null);
            if (step.end !== null) return step.end;
            if (step.usable !== null) last = Object.freeze({ id: todo[k].id, result: step.usable });
        }
        return { outcome: 'finished' };
    }

    function assertRun(run) {
        if (!isObject(run) || !isObject(run.plan) || !Array.isArray(run.plan.items)) throw new Error('SasFitSequence.run needs plan.items');
        if (!isObject(run.form) || !isObject(run.settings)) throw new Error('SasFitSequence.run needs form and settings');
        if (typeof run.chain !== 'boolean') throw new Error('SasFitSequence.run needs chain: boolean');
        ['datasetOf', 'fitOne', 'onEvent'].forEach((name) => {
            if (typeof run[name] !== 'function') throw new Error('SasFitSequence.run needs ' + name + ': a function');
        });
    }

    async function run(input) {
        let end;
        try {
            assertRun(input);
            end = await runItems(input);
        } catch (err) {
            end = { outcome: 'aborted', error: err };
        }
        try {
            if (isObject(input) && typeof input.onEvent === 'function') input.onEvent(Object.freeze({ type: 'end', ...end }));
        } catch (err) {
            console.error(LOG + ' 序列結束事件的處理發生錯誤', err);       // the promise still resolves: the caller must be able to unlock
        }
        return Object.freeze(end);
    }

    globalThis.SasFitSequence = Object.freeze({ plan, isUsableStart, startForm, run });
})();
