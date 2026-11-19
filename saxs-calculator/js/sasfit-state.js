/**
 * sasfit-state.js -- the page state of the SAS fitting page as an immutable
 * reducer (design spec 4.8, 5.2, 5.4, 7; plan M3 Task 5). Original code.
 *
 *   state = { files: [{ id, fileName, dataset | null, issues, notes, condition }],
 *             activeId, shown: { id: boolean }, conditionName,
 *             fitResults: { id: FitResult },
 *             range: { qMin, qMax, userEdited } | null,
 *             weighting, weightingUserSet, maxSteps, plotMode,
 *             stagger: { on, decades },
 *             fit: { phase: 'idle' | 'running', datasetId, iteration, chi2r, outcome },
 *             tab, nextId, notice,
 *             removed: { file, index, shown, result, wasActive } | null }
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
 *
 * While a fit is running only RUNNING_ACTIONS are accepted; every other
 * action throws (the page disables those controls).
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
    const TABS = Object.freeze(['data', 'model', 'fit']);
    const PLOT_MODES = Object.freeze(['loglog', 'guinier', 'kratky']);
    const DEFAULT_CONDITION_NAME = '條件';                 // design spec 5.2
    const DEFAULT_WEIGHTING = 'sigma';                     // design spec 4.8
    const FALLBACK_WEIGHTING = 'none';
    const DEFAULT_STAGGER = Object.freeze({ on: false, decades: 1 });
    const RESULT_STATUSES = Object.freeze(['converged', 'maxiter', 'stopped', 'failed']);
    const NOT_STORED_STATUS = 'stopped';
    const ERROR_OUTCOME = 'error';
    const NO_RESULT = 'none';
    const IDLE_FIT = Object.freeze({ phase: 'idle', datasetId: null, iteration: 0, chi2r: null, outcome: null });
    const RUNNING_ACTIONS = Object.freeze(['setShown', 'setPlotMode', 'setStagger', 'setTab', 'setConditionName',
        'setCondition', 'clearNotice', 'dismissRemoved', 'fitProgress', 'fitSettled']);
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
            fit: IDLE_FIT, tab: TABS[0], nextId: 1, notice: null, removed: null,
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
        return Object.freeze({
            file, index: at, shown: has(state.shown, file.id) ? state.shown[file.id] : null,
            result: has(state.fitResults, file.id) ? state.fitResults[file.id] : null, wasActive: state.activeId === file.id,
        });
    }

    function removeFile(state, { id }) {
        const file = fileOf(state, id);
        const at = state.files.indexOf(file);
        const next = withFields(state, {
            files: Object.freeze(state.files.filter((f) => f.id !== id)),
            shown: without(state.shown, id), fitResults: without(state.fitResults, id), notice: null,
            removed: removedOf(state, file, at),
        });
        if (state.activeId !== id) return next;
        const successor = successorOf(state.files, at);
        return successor === null ? deactivate(next) : activate(next, successor.id);
    }

    /**
     * Puts the file removed last back at its place, with its "shown" tick and its FitResult; it is the active one
     * again when it was (or when there is none now). Only the last removal can be undone, and only until the
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

    // ------------------------------------------------------------- reduce

    const ACTIONS = Object.freeze({
        addFiles, removeFile, undoRemove, dismissRemoved, setActive, setShown, setCondition, setConditionName,
        setRange, rangeDefault, rangeFull, setWeighting, setMaxSteps, setPlotMode, setStagger, setTab, clearNotice,
        fitStarted, fitProgress, fitSettled,
    });
    const ACTION_TYPES = Object.freeze(Object.keys(ACTIONS));

    function reduce(state, action) {
        if (!isObject(state) || !has(state, 'files') || !has(state, 'fit')) throw new Error('reduce needs a state');
        if (!isObject(action)) throw new Error('reduce needs an action object');
        if (!has(ACTIONS, action.type)) throw new Error('Unknown action type: ' + String(action.type));
        if (state.fit.phase === 'running' && RUNNING_ACTIONS.indexOf(action.type) < 0) {
            throw new Error(action.type + ' is not allowed while a fit is running');
        }
        return ACTIONS[action.type](state, action);
    }

    globalThis.SasFitState = Object.freeze({
        MAX_FILES, DEFAULT_SHOWN, TABS, PLOT_MODES, ACTION_TYPES, RUNNING_ACTIONS,
        initial, reduce, capacity, active, shownFiles, datasetStatus, fullRange, nextTab,
    });
})();
