/**
 * sasfit-state.js -- the page state of the SAS fitting page as an immutable
 * reducer (design spec 4.8, 5.2, 5.4, 6, 7; plan M3 Task 5, M4 Task 2). Original code.
 *
 *   state = { files: [{ id, fileName, dataset | null, issues, notes, condition }],
 *             activeId, shown: { id: boolean }, conditionName,
 *             fitResults: { id: FitResult },
 *             range: { qMin, qMax, userEdited } | null,
 *             weighting, weightingUserSet, maxSteps, plotMode,
 *             stagger: { on, decades },
 *             fit: { phase: 'idle' | 'running', datasetId, iteration, chi2r, outcome },
 *             tab, nextId, notice,
 *             removed: { file, index, shown, result, wasActive, seqSelected, seqRow, seqOrderAt } | null,
 *             plotView: 'curve' | 'shape',
 *             seq: { phase: 'idle' | 'running', selected: { id: boolean }, options: { chain, sort },
 *                    order: [id] | null, rows: { id: row }, form, settings, warnings: [string], y, outcome } }
 *   row = { id, state: 'pending' | 'running' | 'done' | 'skipped' | 'error', result: FitResult | null,
 *           range: { qMin, qMax } | null, note, startedFrom: id | null }
 *
 * files     every loaded file in list order, the ones that could not be parsed
 *           included (dataset null: never active, never shown, no `shown` entry).
 *           Ids are 'd1', 'd2', ... from the counter nextId and are never reused.
 *           `condition` starts as dataset.condition and is edited here; the
 *           Dataset itself is never changed.
 * removed   the file removed last, with what undoRemove needs to put it back
 *           (its FitResult included). A new removal replaces it; addFiles and
 *           dismissRemoved clear it. Ids are never reused, so it cannot clash.
 * fitResults  one FitResult per dataset id, shared by single and sequence
 *           fitting (design spec 7). Whether a result still matches the form
 *           is NOT stored: SasFitJobs.resultMatchesForm answers that.
 * range     the fit range of the active dataset. While userEdited is false it
 *           follows SasFitWeighting.defaultRange whenever the active dataset
 *           or the weighting changes; once the user edited it, it stays.
 *           An inverted range (qMin > qMax) is kept as typed: the fit is then
 *           refused by SasFitJobs.fitReadiness, with a reason.
 * weighting follows SasFitWeighting.defaultMode of the active dataset until
 *           the user chooses one. 'sigma' is never kept on a dataset without a
 *           usable sigma: it becomes 'none' whoever set it, and that voids the
 *           user's choice (weightingUserSet false). The hint about it comes
 *           from the data itself (SasFitHints), so no flag is stored.
 * fit       phase 'running' between fitStarted and fitSettled. datasetId is
 *           the dataset being fitted (the active one, or fitStarted's `id`
 *           for sequence fitting); after the run it, iteration and chi2r stay
 *           as the last run left them and outcome says how it ended:
 *           the FitResult status, or 'error' for fitSettled { result: null }.
 *           A 'stopped' result is not stored (the earlier result is kept).
 *           During a sequence the phase stays 'running' from seqStarted to
 *           seqSettled: seqStep stores one row and moves datasetId to the next
 *           dataset in one step, so nothing ever sees 'idle' in between.
 * plotView  what the plot card shows: the curves or the 3D sketch of the model.
 * seq       sequence fitting (design spec 7).
 *   selected  the ticks of the sequence table. A file with data that has no
 *             entry counts as ticked (seqSelectedFiles), so loading files
 *             writes nothing here.
 *   options   chain: start each fit from the last usable result; sort: by condition.
 *   order     the ids of the last run in its order (skipped ones included), null before the first run.
 *   rows      one row per item of the last run's plan. A row that was fitted
 *             carries its FitResult, which is also put into fitResults (unless
 *             'stopped', which is stored nowhere).
 *   form      the form the last run started from (by reference; SasFitForm freezes
 *             it): loading a row later starts from it. settings: { weighting,
 *             maxSteps, rangeEdited } of that run. Both null before the first run.
 *   y         the parameter the trend chart shows, null = the first one.
 *   outcome   how the last run ended: 'finished' | 'stopped' | 'aborted'; null
 *             before the first run and while one runs. fit.outcome gets the same value.
 *
 * Locks. While a sequence is running only SEQ_RUNNING_ACTIONS are accepted;
 * while a single fit is running only RUNNING_ACTIONS; every other action
 * throws (the page disables those controls). A sequence must be ended with
 * seqSettled on every path, or the page stays locked.
 *
 * reduce() never modifies the state or the action it is given and returns a
 * frozen state. Datasets, issues, notes and FitResults are kept by reference:
 * their producers (SasFitDataIo, SasFitWorkerClient) freeze them, and their
 * typed arrays are never written to. Every Error is a programming error (the
 * page validates before it dispatches) and is in English; the only text for
 * the user made here is `notice`.
 *
 * Pure logic: no DOM, no timers; the only globals are other SasFit modules,
 * read at call time.
 */

(function () {
    'use strict';

    const MAX_FILES = 500;
    const DEFAULT_SHOWN = 8;
    const ID_PREFIX = 'd';
    const TABS = Object.freeze(['data', 'model', 'fit', 'sequence']);
    const PLOT_VIEWS = Object.freeze(['curve', 'shape']);
    const PLOT_MODES = Object.freeze(['loglog', 'guinier', 'kratky', 'porod']);
    const DEFAULT_CONDITION_NAME = '條件';                 // design spec 5.2
    const DEFAULT_WEIGHTING = 'sigma';                     // design spec 4.8
    const FALLBACK_WEIGHTING = 'none';
    const DEFAULT_STAGGER = Object.freeze({ on: false, decades: 1 });
    const RESULT_STATUSES = Object.freeze(['converged', 'maxiter', 'stopped', 'failed']);
    const NOT_STORED_STATUS = 'stopped';
    const ERROR_OUTCOME = 'error';
    const NO_RESULT = 'none';
    const IDLE_FIT = Object.freeze({ phase: 'idle', datasetId: null, iteration: 0, chi2r: null, outcome: null });
    const SINGLE_FIT_END = 'fitSettled';
    const RUNNING_ACTIONS = Object.freeze(['setShown', 'setPlotMode', 'setStagger', 'setTab', 'setConditionName',
        'setCondition', 'clearNotice', 'dismissRemoved', 'fitProgress', SINGLE_FIT_END, 'setPlotView', 'setSeqY']);
    const SEQ_RUNNING_ACTIONS = Object.freeze(RUNNING_ACTIONS.filter((type) => type !== SINGLE_FIT_END)
        .concat(['seqStep', 'seqSettled']));
    const SEQ_OPTIONS = Object.freeze(['chain', 'sort']);
    const SEQ_OUTCOMES = Object.freeze(['finished', 'stopped', 'aborted']);
    const ROW_STATES = Object.freeze(['pending', 'running', 'done', 'skipped', 'error']);
    const IDLE_SEQ = Object.freeze({
        phase: 'idle', selected: Object.freeze({}), options: Object.freeze({ chain: true, sort: true }), order: null,
        rows: Object.freeze({}), form: null, settings: null, warnings: Object.freeze([]), y: null, outcome: null,
    });
    const TAB_KEYS = Object.freeze({
        ArrowLeft: (i, n) => (i + n - 1) % n, ArrowRight: (i, n) => (i + 1) % n, Home: () => 0, End: (i, n) => n - 1,
    });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const skippedNotice = (count) => '清單最多 ' + MAX_FILES + ' 個檔，已略過 ' + count + ' 個檔。';

    /** A new frozen state: `state` with the given top-level fields replaced. */
    const withFields = (state, changes) => Object.freeze({ ...state, ...changes });

    function initial() {
        return Object.freeze({
            files: Object.freeze([]), activeId: null, shown: Object.freeze({}), conditionName: DEFAULT_CONDITION_NAME,
            fitResults: Object.freeze({}), range: null, weighting: DEFAULT_WEIGHTING, weightingUserSet: false,
            maxSteps: globalThis.SasFitFitter.DEFAULTS.maxSteps, plotMode: PLOT_MODES[0], stagger: DEFAULT_STAGGER,
            fit: IDLE_FIT, tab: TABS[0], nextId: 1, notice: null, removed: null, plotView: PLOT_VIEWS[0], seq: IDLE_SEQ,
        });
    }

    // ------------------------------------------------------------- selectors

    function fileOf(state, id) {
        const file = state.files.find((f) => f.id === id);
        if (file === undefined) throw new Error('Unknown file id: ' + String(id));
        return file;
    }

    /** The file entry of id, which must have a dataset. */
    function dataFileOf(state, id) {
        const file = fileOf(state, id);
        if (file.dataset === null) throw new Error('File ' + id + ' (' + file.fileName + ') has no data');
        return file;
    }

    const active = (state) => (state.activeId === null ? null : fileOf(state, state.activeId));
    const capacity = (state) => MAX_FILES - state.files.length;

    function requireActive(state, what) {
        const file = active(state);
        if (file === null) throw new Error(what + ' needs an active dataset');
        return file;
    }

    /** The files to draw, in list order, each with its list position `index`; the active one is always among them. */
    function shownFiles(state) {
        return Object.freeze(state.files.map((file, index) => ({ file, index }))
            .filter(({ file }) => file.dataset !== null && (state.shown[file.id] === true || file.id === state.activeId))
            .map(({ file, index }) => Object.freeze({ ...file, index })));
    }

    /** The files a sequence would fit, in list order: those with data whose tick was not taken away. */
    function seqSelectedFiles(state) {
        return Object.freeze(state.files.filter((file) => file.dataset !== null && state.seq.selected[file.id] !== false));
    }

    function datasetStatus(state, id) {
        fileOf(state, id);
        return has(state.fitResults, id) ? state.fitResults[id].status : NO_RESULT;
    }

    /** The smallest and largest finite q > 0 of a dataset, or null when it has none. */
    function fullRange(dataset) {
        let qMin = Infinity;
        let qMax = -Infinity;
        for (let i = 0; i < dataset.q.length; i++) {
            const q = dataset.q[i];
            if (Number.isFinite(q) && q > 0) {
                if (q < qMin) qMin = q;
                if (q > qMax) qMax = q;
            }
        }
        return qMax > 0 ? Object.freeze({ qMin, qMax }) : null;
    }

    function nextTab(tabs, current, key) {
        const at = tabs.indexOf(current);
        if (at < 0) throw new Error('Unknown tab: ' + String(current));
        return has(TAB_KEYS, key) ? tabs[TAB_KEYS[key](at, tabs.length)] : current;
    }

    // ------------------------------------------------------------- range and weighting

    function defaultRangeOf(dataset, weighting) {
        const range = globalThis.SasFitWeighting.defaultRange(dataset, weighting);
        return range === null ? null : Object.freeze({ qMin: range.qMin, qMax: range.qMax, userEdited: false });
    }

    const rangeEdited = (state) => state.range !== null && state.range.userEdited === true;

    /** The weighting fields for `dataset` as the active one (see the header). */
    function weightingFor(state, dataset) {
        const fallback = globalThis.SasFitWeighting.defaultMode(dataset);
        if (!state.weightingUserSet) return { weighting: fallback, weightingUserSet: false };
        if (state.weighting === DEFAULT_WEIGHTING && fallback !== DEFAULT_WEIGHTING) {
            return { weighting: FALLBACK_WEIGHTING, weightingUserSet: false };
        }
        return { weighting: state.weighting, weightingUserSet: true };
    }

    /** Make the file `id` the active one: weighting and (unless edited) the range follow its data. */
    function activate(state, id) {
        const { dataset } = dataFileOf(state, id);
        const weight = weightingFor(state, dataset);
        const range = rangeEdited(state) ? state.range : defaultRangeOf(dataset, weight.weighting);
        return withFields(state, { activeId: id, ...weight, range });
    }

    const deactivate = (state) => withFields(state, {
        activeId: null, range: null, weighting: DEFAULT_WEIGHTING, weightingUserSet: false,
    });

    // ------------------------------------------------------------- files

    function assertFileInput(file, at) {
        const what = 'addFiles: files[' + at + ']';
        if (!isObject(file) || typeof file.fileName !== 'string') throw new Error(what + '.fileName must be a string');
        const { dataset } = file;
        const ok = dataset === null || (isObject(dataset) && dataset.q instanceof Float64Array && dataset.I instanceof Float64Array);
        if (!ok) throw new Error(what + '.dataset must be null or a Dataset with q and I as Float64Array');
        if (!Array.isArray(file.issues)) throw new Error(what + '.issues must be an array');
        if (!isObject(file.notes)) throw new Error(what + '.notes must be an object');
        if (file.issueOverflow !== undefined && !isCount(file.issueOverflow)) {
            throw new Error(what + '.issueOverflow must be an integer >= 0');
        }
    }

    const conditionOf = (dataset) => (dataset !== null && isFiniteNumber(dataset.condition) ? dataset.condition : null);

    const isCount = (v) => Number.isInteger(v) && v >= 0;

    /** `skipped`: files the loader left unread because the list was full (they join the notice). */
    function addFiles(state, { files, skipped: unread }) {
        if (!Array.isArray(files)) throw new Error('addFiles needs files: an array');
        if (unread !== undefined && !isCount(unread)) throw new Error('addFiles: skipped must be an integer >= 0');
        files.forEach(assertFileInput);
        const taken = files.slice(0, capacity(state));
        const entries = taken.map((file, i) => Object.freeze({
            id: ID_PREFIX + (state.nextId + i), fileName: file.fileName, dataset: file.dataset,
            issues: file.issues, issueOverflow: file.issueOverflow === undefined ? 0 : file.issueOverflow,
            notes: file.notes, condition: conditionOf(file.dataset),
        }));
        const shown = { ...state.shown };
        let withData = state.files.filter((f) => f.dataset !== null).length;
        entries.filter((entry) => entry.dataset !== null).forEach((entry) => {
            shown[entry.id] = withData < DEFAULT_SHOWN;
            withData += 1;
        });
        const skipped = files.length - taken.length + (unread === undefined ? 0 : unread);
        const next = withFields(state, {
            files: Object.freeze(state.files.concat(entries)), shown: Object.freeze(shown), removed: null,
            nextId: state.nextId + taken.length, notice: skipped > 0 ? skippedNotice(skipped) : null,
        });
        const first = entries.find((entry) => entry.dataset !== null);
        return next.activeId === null && first !== undefined ? activate(next, first.id) : next;
    }

    const without = (map, id) => Object.freeze(Object.fromEntries(Object.entries(map).filter(([key]) => key !== id)));

    /** The file that takes over from the removed active one: the next with data, else the previous, else null. */
    function successorOf(files, at) {
        const hasData = (f) => f.dataset !== null;
        const after = files.slice(at + 1).find(hasData);
        if (after !== undefined) return after;
        const before = files.slice(0, at).reverse().find(hasData);
        return before === undefined ? null : before;
    }

    /** What undoRemove needs to put a removed file back: the entry, its place, and what belonged to it. */
    function removedOf(state, file, at) {
        const { seq } = state;
        const orderAt = seq.order === null ? -1 : seq.order.indexOf(file.id);
        return Object.freeze({
            file, index: at, shown: has(state.shown, file.id) ? state.shown[file.id] : null,
            result: has(state.fitResults, file.id) ? state.fitResults[file.id] : null, wasActive: state.activeId === file.id,
            seqSelected: has(seq.selected, file.id) ? seq.selected[file.id] : null,
            seqRow: has(seq.rows, file.id) ? seq.rows[file.id] : null, seqOrderAt: orderAt < 0 ? null : orderAt,
        });
    }

    const withSeq = (state, changes) => withFields(state, { seq: Object.freeze({ ...state.seq, ...changes }) });

    /** The sequence state without anything of the file `id`. */
    function seqWithout(seq, id) {
        return Object.freeze({
            ...seq, selected: without(seq.selected, id), rows: without(seq.rows, id),
            order: seq.order === null ? null : Object.freeze(seq.order.filter((other) => other !== id)),
        });
    }

    /** The sequence state with what removeFile took away for the file `id` put back. */
    function seqRestored(seq, id, { seqSelected, seqRow, seqOrderAt }) {
        const order = seq.order === null || seqOrderAt === null ? seq.order : seq.order.slice();
        if (order !== seq.order) order.splice(Math.min(seqOrderAt, order.length), 0, id);
        return Object.freeze({
            ...seq, order: order === null ? null : Object.freeze(order),
            selected: seqSelected === null ? seq.selected : Object.freeze({ ...seq.selected, [id]: seqSelected }),
            rows: seqRow === null ? seq.rows : Object.freeze({ ...seq.rows, [id]: seqRow }),
        });
    }

    function removeFile(state, { id }) {
        const file = fileOf(state, id);
        const at = state.files.indexOf(file);
        const next = withFields(state, {
            files: Object.freeze(state.files.filter((f) => f.id !== id)),
            shown: without(state.shown, id), fitResults: without(state.fitResults, id), notice: null,
            removed: removedOf(state, file, at), seq: seqWithout(state.seq, id),
        });
        if (state.activeId !== id) return next;
        const successor = successorOf(state.files, at);
        return successor === null ? deactivate(next) : activate(next, successor.id);
    }

    /**
     * Puts the file removed last back at its place, with its "shown" tick, its FitResult and what the sequence
     * held for it; it is the active one again when it was (or when there is none now). Only the last removal can be undone, and only until the
     * list changes again (addFiles and removeFile start anew; dismissRemoved forgets it).
     */
    function undoRemove(state) {
        const { removed } = state;
        if (removed === null) throw new Error('undoRemove: nothing to undo');
        const { file, index, shown, result, wasActive } = removed;
        const files = state.files.slice();
        files.splice(Math.min(index, files.length), 0, file);
        const next = withFields(state, {
            files: Object.freeze(files), removed: null, notice: null,
            shown: shown === null ? state.shown : Object.freeze({ ...state.shown, [file.id]: shown }),
            fitResults: result === null ? state.fitResults : Object.freeze({ ...state.fitResults, [file.id]: result }),
            seq: seqRestored(state.seq, file.id, removed),
        });
        return file.dataset !== null && (wasActive || next.activeId === null) ? activate(next, file.id) : next;
    }

    const dismissRemoved = (state) => withFields(state, { removed: null });

    const setActive = (state, { id }) => activate(state, id);

    function setShown(state, { id, shown }) {
        dataFileOf(state, id);
        if (typeof shown !== 'boolean') throw new Error('setShown needs shown: boolean');
        return withFields(state, { shown: Object.freeze({ ...state.shown, [id]: shown }) });
    }

    function setCondition(state, { id, value }) {
        const file = fileOf(state, id);
        if (value !== null && !isFiniteNumber(value)) throw new Error('setCondition: condition must be a finite number or null');
        const files = state.files.map((f) => (f === file ? Object.freeze({ ...f, condition: value }) : f));
        return withFields(state, { files: Object.freeze(files) });
    }

    function setConditionName(state, { name }) {
        if (typeof name !== 'string') throw new Error('setConditionName needs name: string');
        return withFields(state, { conditionName: name });
    }

    // ------------------------------------------------------------- fit settings

    function setRange(state, { qMin, qMax }) {
        requireActive(state, 'setRange');
        if (!isFiniteNumber(qMin)) throw new Error('setRange: qMin must be a finite number');
        if (!isFiniteNumber(qMax)) throw new Error('setRange: qMax must be a finite number');
        return withFields(state, { range: Object.freeze({ qMin, qMax, userEdited: true }) });
    }

    function rangeDefault(state) {
        const { dataset } = requireActive(state, 'rangeDefault');
        return withFields(state, { range: defaultRangeOf(dataset, state.weighting) });
    }

    function rangeFull(state) {
        const full = fullRange(requireActive(state, 'rangeFull').dataset);
        return withFields(state, { range: full === null ? null : Object.freeze({ ...full, userEdited: true }) });
    }

    function setWeighting(state, { mode }) {
        const weighting = globalThis.SasFitWeighting;
        if (weighting.MODES.indexOf(mode) < 0) throw new Error('Unknown weighting mode: ' + String(mode));
        const file = active(state);
        if (file !== null && mode === DEFAULT_WEIGHTING && weighting.defaultMode(file.dataset) !== DEFAULT_WEIGHTING) {
            throw new Error("Weighting 'sigma' needs a dataset with a usable sigma column");
        }
        const range = file === null || rangeEdited(state) ? state.range : defaultRangeOf(file.dataset, mode);
        return withFields(state, { weighting: mode, weightingUserSet: true, range });
    }

    function setMaxSteps(state, { value }) {
        const max = globalThis.SasFitWorkerCore.MAX_STEPS;
        if (!Number.isInteger(value) || value < 1 || value > max) {
            throw new Error('maxSteps must be an integer from 1 to ' + max + ', got ' + String(value));
        }
        return withFields(state, { maxSteps: value });
    }

    function setPlotMode(state, { mode }) {
        if (PLOT_MODES.indexOf(mode) < 0) throw new Error('Unknown plot mode: ' + String(mode));
        return withFields(state, { plotMode: mode });
    }

    function setStagger(state, { on, decades }) {
        if (typeof on !== 'boolean') throw new Error('setStagger needs on: boolean');
        if (!isFiniteNumber(decades) || decades < 0) throw new Error('setStagger: decades must be a finite number >= 0');
        return withFields(state, { stagger: Object.freeze({ on, decades }) });
    }

    function setTab(state, { tab }) {
        if (TABS.indexOf(tab) < 0) throw new Error('Unknown tab: ' + String(tab));
        return withFields(state, { tab });
    }

    function setPlotView(state, { view }) {
        if (PLOT_VIEWS.indexOf(view) < 0) throw new Error('Unknown plot view: ' + String(view));
        return withFields(state, { plotView: view });
    }

    const clearNotice = (state) => withFields(state, { notice: null });

    // ------------------------------------------------------------- fit life cycle

    function fitStarted(state, { id }) {
        const file = id === undefined ? requireActive(state, 'fitStarted') : dataFileOf(state, id);
        return withFields(state, { fit: Object.freeze({ ...IDLE_FIT, phase: 'running', datasetId: file.id }) });
    }

    function requireRunning(state, type) {
        if (state.fit.phase !== 'running') throw new Error(type + ': no fit is running');
    }

    function fitProgress(state, { iteration, chi2r }) {
        requireRunning(state, 'fitProgress');
        if (!Number.isInteger(iteration) || iteration < 0) throw new Error('fitProgress: iteration must be an integer >= 0');
        if (chi2r !== null && typeof chi2r !== 'number') throw new Error('fitProgress: chi2r must be a number or null');
        return withFields(state, { fit: Object.freeze({ ...state.fit, iteration, chi2r }) });
    }

    function fitSettled(state, action) {
        requireRunning(state, 'fitSettled');
        if (!has(action, 'result')) throw new Error('fitSettled needs result: a FitResult or null');
        const { result } = action;
        if (result === null) {
            return withFields(state, { fit: Object.freeze({ ...state.fit, phase: 'idle', outcome: ERROR_OUTCOME }) });
        }
        if (!isObject(result) || RESULT_STATUSES.indexOf(result.status) < 0) {
            throw new Error('fitSettled: result.status must be one of ' + RESULT_STATUSES.join(', '));
        }
        const fit = Object.freeze({
            phase: 'idle', datasetId: state.fit.datasetId, iteration: result.iterations, chi2r: result.chi2r, outcome: result.status,
        });
        if (result.status === NOT_STORED_STATUS) return withFields(state, { fit });
        return withFields(state, { fit, fitResults: Object.freeze({ ...state.fitResults, [fit.datasetId]: result }) });
    }

    // ------------------------------------------------------------- sequence: selection and options

    function setSeqSelected(state, { id, selected }) {
        dataFileOf(state, id);
        if (typeof selected !== 'boolean') throw new Error('setSeqSelected needs selected: boolean');
        return withSeq(state, { selected: Object.freeze({ ...state.seq.selected, [id]: selected }) });
    }

    function setSeqAll(state, { selected }) {
        if (typeof selected !== 'boolean') throw new Error('setSeqAll needs selected: boolean');
        const entries = state.files.filter((file) => file.dataset !== null).map((file) => [file.id, selected]);
        return withSeq(state, { selected: Object.freeze(Object.fromEntries(entries)) });
    }

    function setSeqOption(state, { key, value }) {
        if (SEQ_OPTIONS.indexOf(key) < 0) throw new Error('Unknown sequence option: ' + String(key));
        if (typeof value !== 'boolean') throw new Error('setSeqOption needs value: boolean');
        return withSeq(state, { options: Object.freeze({ ...state.seq.options, [key]: value }) });
    }

    function setSeqY(state, { name }) {
        if (name !== null && (typeof name !== 'string' || name === '')) {
            throw new Error('setSeqY needs name: a non-empty string or null');
        }
        return withSeq(state, { y: name });
    }

    // ------------------------------------------------------------- sequence: the run

    /** A frozen { qMin, qMax } copy, or null; `required` refuses null. */
    function rangeCopy(range, what, required) {
        if (range === null && !required) return null;
        if (!isObject(range) || !isFiniteNumber(range.qMin) || !isFiniteNumber(range.qMax)) {
            throw new Error(what + '.range must be { qMin, qMax } with finite numbers' + (required ? '' : ' or null'));
        }
        return Object.freeze({ qMin: range.qMin, qMax: range.qMax });
    }

    /** The row a plan item starts as: skipped with its reason, or pending with its range and note. */
    function rowOfItem(state, item, at) {
        const what = 'seqStarted: plan.items[' + at + ']';
        if (!isObject(item)) throw new Error(what + ' must be an object');
        dataFileOf(state, item.id);
        if (item.skip !== null && typeof item.skip !== 'string') throw new Error(what + '.skip must be a string or null');
        if (typeof item.note !== 'string') throw new Error(what + '.note must be a string');
        const skipped = item.skip !== null;
        return Object.freeze({
            id: item.id, state: skipped ? 'skipped' : 'pending', result: null,
            range: rangeCopy(item.range === undefined ? null : item.range, what, !skipped),
            note: skipped ? item.skip : item.note, startedFrom: null,
        });
    }

    function settingsCopy(settings) {
        if (!isObject(settings)) throw new Error('seqStarted needs settings: { weighting, maxSteps, rangeEdited }');
        const { weighting, maxSteps, rangeEdited } = settings;
        if (globalThis.SasFitWeighting.MODES.indexOf(weighting) < 0) {
            throw new Error('seqStarted: settings.weighting is not a weighting mode: ' + String(weighting));
        }
        if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('seqStarted: settings.maxSteps must be an integer >= 1');
        if (typeof rangeEdited !== 'boolean') throw new Error('seqStarted: settings.rangeEdited must be a boolean');
        return Object.freeze({ weighting, maxSteps, rangeEdited });
    }

    function planRows(state, plan) {
        if (!isObject(plan) || !Array.isArray(plan.items)) throw new Error('seqStarted needs plan.items: an array');
        if (!Array.isArray(plan.warnings) || plan.warnings.some((w) => typeof w !== 'string')) {
            throw new Error('seqStarted needs plan.warnings: an array of strings');
        }
        const rows = plan.items.map((item, at) => rowOfItem(state, item, at));
        rows.forEach((row, at) => {
            if (rows.findIndex((other) => other.id === row.id) !== at) throw new Error('seqStarted: ' + row.id + ' is in the plan twice');
        });
        return rows;
    }

    function seqStarted(state, { plan, form, settings }) {
        const rows = planRows(state, plan);
        const first = rows.find((row) => row.state === 'pending');
        if (first === undefined) throw new Error('seqStarted: the plan has nothing to fit');
        if (!isObject(form)) throw new Error('seqStarted needs form: the form the sequence starts from');
        const seq = Object.freeze({
            ...state.seq, phase: 'running', order: Object.freeze(rows.map((row) => row.id)),
            rows: Object.freeze(Object.fromEntries(rows.map((row) => [row.id, row]))),
            form, settings: settingsCopy(settings), warnings: Object.freeze(plan.warnings.slice()), outcome: null,
        });
        return withFields(state, { seq, fit: Object.freeze({ ...IDLE_FIT, phase: 'running', datasetId: first.id }) });
    }

    function requireSequence(state, type) {
        if (state.seq.phase !== 'running') throw new Error(type + ': no sequence is running');
    }

    const isResult = (result) => isObject(result) && RESULT_STATUSES.indexOf(result.status) >= 0;

    /** The row seqStep stores for `id`, validated; a 'stopped' result is dropped (it is stored nowhere). */
    function stepRow(id, row) {
        if (!isObject(row)) throw new Error('seqStep needs row: an object');
        if (row.id !== id) throw new Error('seqStep: row.id (' + String(row.id) + ') must be ' + id);
        if (ROW_STATES.indexOf(row.state) < 0) throw new Error('seqStep: row.state must be one of ' + ROW_STATES.join(', '));
        if (row.result !== null && !isResult(row.result)) {
            throw new Error('seqStep: row.result.status must be one of ' + RESULT_STATUSES.join(', '));
        }
        if (typeof row.note !== 'string') throw new Error('seqStep: row.note must be a string');
        if (row.startedFrom !== null && typeof row.startedFrom !== 'string') {
            throw new Error('seqStep: row.startedFrom must be a file id or null');
        }
        const kept = row.result !== null && row.result.status !== NOT_STORED_STATUS;
        return Object.freeze({
            id, state: row.state, result: kept ? row.result : null, range: rangeCopy(row.range, 'seqStep: row', false),
            note: row.note, startedFrom: row.startedFrom,
        });
    }

    /** Stores the row of the dataset being fitted (and its result) and moves on to `next` -- never through 'idle'. */
    function seqStep(state, action) {
        requireSequence(state, 'seqStep');
        const { id, next } = action;
        const { seq, fit } = state;
        if (id !== fit.datasetId) {
            throw new Error('seqStep: ' + String(id) + ' is not the dataset being fitted (' + String(fit.datasetId) + ')');
        }
        const row = stepRow(id, action.row);
        const canFollow = next === null || (next !== id && has(seq.rows, next) && seq.rows[next].state === 'pending');
        if (!has(action, 'next') || !canFollow) {
            throw new Error('seqStep: next must be the id of a pending row of this sequence, or null: ' + String(next));
        }
        return withFields(state, {
            seq: Object.freeze({ ...seq, rows: Object.freeze({ ...seq.rows, [id]: row }) }),
            fitResults: row.result === null ? state.fitResults : Object.freeze({ ...state.fitResults, [id]: row.result }),
            fit: next === null ? fit : Object.freeze({ ...IDLE_FIT, phase: 'running', datasetId: next }),
        });
    }

    /** Ends the sequence on every path: both phases idle, the row that was being fitted is pending again. */
    function seqSettled(state, { outcome }) {
        requireSequence(state, 'seqSettled');
        if (SEQ_OUTCOMES.indexOf(outcome) < 0) throw new Error('seqSettled: outcome must be one of ' + SEQ_OUTCOMES.join(', '));
        const rows = Object.entries(state.seq.rows)
            .map(([id, row]) => [id, row.state === 'running' ? Object.freeze({ ...row, state: 'pending' }) : row]);
        return withFields(state, {
            fit: Object.freeze({ ...state.fit, phase: 'idle', outcome }),
            seq: Object.freeze({ ...state.seq, phase: 'idle', outcome, rows: Object.freeze(Object.fromEntries(rows)) }),
        });
    }

    // ------------------------------------------------------------- reduce

    const ACTIONS = Object.freeze({
        addFiles, removeFile, undoRemove, dismissRemoved, setActive, setShown, setCondition, setConditionName,
        setRange, rangeDefault, rangeFull, setWeighting, setMaxSteps, setPlotMode, setStagger, setTab, clearNotice,
        fitStarted, fitProgress, fitSettled,
        setPlotView, setSeqSelected, setSeqAll, setSeqOption, setSeqY, seqStarted, seqStep, seqSettled,
    });
    const ACTION_TYPES = Object.freeze(Object.keys(ACTIONS));

    function reduce(state, action) {
        if (!isObject(state) || !has(state, 'files') || !has(state, 'fit') || !has(state, 'seq')) throw new Error('reduce needs a state');
        if (!isObject(action)) throw new Error('reduce needs an action object');
        if (!has(ACTIONS, action.type)) throw new Error('Unknown action type: ' + String(action.type));
        if (state.seq.phase === 'running') {
            if (SEQ_RUNNING_ACTIONS.indexOf(action.type) < 0) throw new Error(action.type + ' is not allowed while a sequence is running');
        } else if (state.fit.phase === 'running' && RUNNING_ACTIONS.indexOf(action.type) < 0) {
            throw new Error(action.type + ' is not allowed while a fit is running');
        }
        return ACTIONS[action.type](state, action);
    }

    globalThis.SasFitState = Object.freeze({
        MAX_FILES, DEFAULT_SHOWN, TABS, PLOT_MODES, PLOT_VIEWS, ACTION_TYPES, RUNNING_ACTIONS, SEQ_RUNNING_ACTIONS,
        initial, reduce, capacity, active, shownFiles, seqSelectedFiles, datasetStatus, fullRange, nextTab,
    });
})();
