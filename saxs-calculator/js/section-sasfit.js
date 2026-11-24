/**
 * section-sasfit.js -- page controller of the SAS fitting page (#section-sasfit;
 * design spec 3, 5.1; plan M3 Task 10b). Original code.
 *
 * It owns the page state (SasFitState), the model form (SasFitForm) and the
 * Worker client, switches the four segments (data / model / fit / sequence) and hands one
 * context object to the segment modules (the module 'shape' is the switch
 * of the plot card and the 3D sketch -- it has no tab). Everything inside a segment -- file
 * list, parameter table, fit controls, charts -- belongs to those modules.
 *
 *   SasFitSection.init(deps?) -> boolean
 *       Called once from app.js on DOMContentLoaded; a second call does nothing
 *       and returns true. It never throws: a missing element, a segment module
 *       that breaks the contract below or a failing first render is reported
 *       with console.error and init returns false (app.js has more to start).
 *       deps (all optional, for tests):
 *         createClient()        default: SasFitWorkerClient.create()
 *         readFile(file)        default: DndcFileParser.readFile(file) -> Promise<string>
 *         timers                default: { setTimeout, clearTimeout } of the platform
 *         plots                 default: globalThis.SasFitPlots, or null while that module does not exist
 *         raf(fn) / cancelRaf(id)   default: requestAnimationFrame / cancelAnimationFrame of the window
 *         matchMedia(query)     default: window.matchMedia; { matches: false } where there is none
 *         createCanvas()        default: a new <canvas> element (off screen: the PNG of the 3D sketch)
 *         observeResize(element, fn)   default: a ResizeObserver on the element that calls fn()
 *         download(blob, fileName)     default: SasFitExportUi.download (an object URL on a temporary <a download>)
 *         now()                 default: Date.now()
 *         version()             default: SasFitWorkerClient.scriptVersion (the ?v= of the scripts; null without one)
 *         copyText(text) -> Promise   default: SasFitExportUi.copyText (Clipboard API, else a hidden textarea)
 *         sendIucr(data)        default: setIUCrModelFit(data) of js/section-iucr.js (a top-level function: a window property)
 *   SasFitSection.getState() -> the frozen SasFitState state
 *   SasFitSection.getForm()  -> the frozen SasFitForm form
 *   SasFitSection.ELEMENT_IDS       the static ids of index.html this page needs; init checks all of them
 *   SasFitSection.SEGMENT_MODULES   [{ key, global }] in creation order
 *
 * HOW A SEGMENT MODULE REGISTERS
 * A segment module is a script loaded BEFORE this one that defines its global:
 *     globalThis.SasFitDataUi   = Object.freeze({ create })     data segment   (key 'data')
 *     globalThis.SasFitParamsUi = Object.freeze({ create })     model segment  (key 'model')
 *     globalThis.SasFitFitUi    = Object.freeze({ create })     fit segment    (key 'fit')
 *     globalThis.SasFitSeqUi    = Object.freeze({ create })     sequence segment (key 'sequence')
 *     globalThis.SasFitShape3d  = Object.freeze({ create })     plot card: curves | 3D sketch (key 'shape'; not a tab)
 *     globalThis.SasFitExportUi = Object.freeze({ create })     export buttons (key 'export'; not a tab)
 * init calls create(ctx) of each one that exists, in that order, exactly once.
 * create binds the module's own event listeners and returns
 *     { render() }                                   every segment
 *     { render(), schedulePreview(), cancelPreview(), lastPreview(), previewStatus() }   the model segment
 *     { render(), running(), barText() }             the sequence segment
 *     { render(), forgetRevert(), setBarProgress(text) }   the fit segment
 *     { render(), exportBlob() }                     the 3D sketch
 * render() draws the segment from ctx.getState() / ctx.getForm(); it must not
 * dispatch, and it must leave alone what did not change: refresh() runs while
 * the user is typing (see setHtml). A module that is not there yet is skipped,
 * and this file then keeps that segment's empty state (see PLACEHOLDERS).
 *
 *   ctx (frozen, the same object for every module)
 *     el(id)                 document.getElementById(id), looked up on every call (dynamic ids included)
 *     getState()             the current state
 *     dispatch(action, options?) -> state
 *                            state = SasFitState.reduce(state, action), then re-render:
 *                            'setTab' redraws only the segment control; every other action
 *                            calls refresh(). options.silent === true skips the re-render
 *                            (for a field the user is typing in: rebuilding its list would
 *                            drop the focus). An action reduce() refuses throws, and nothing
 *                            changes.
 *     getForm()              the current form
 *     setForm(form) -> form  replaces the form and does NOT re-render (typing must not rebuild
 *                            the parameter table); call refresh() when the table has to follow
 *     refresh()              the segment control, the placeholders, then render() of every segment
 *     setHtml(element, html) -> boolean
 *                            element.innerHTML = html, unless html is what setHtml last wrote
 *                            there (then nothing is touched and false is returned). When the
 *                            focused element is inside, focus and caret go to the new element
 *                            with the same id. html must come from the SasFitHtml builders,
 *                            which escape (design spec 13).
 *     client                 the SasFitWorkerClient, created by deps.createClient() the first
 *                            time it is read (so a visitor who never fits never starts one);
 *                            a getter -- read it when it is needed, do not copy it in create()
 *     deps                   the resolved deps (frozen)
 *     preview                { schedule(), cancel(), last(), status() } -> the model segment's
 *                            schedulePreview / cancelPreview / lastPreview / previewStatus;
 *                            no-ops (last() null, status() an empty frozen object) while there
 *                            is no model segment. last() is the latest preview curve { q, I };
 *                            status() is what SasFitHints.plotStatus needs to know about the
 *                            preview: { computing, paused, previewPoints, allNonFinite, error }
 *     sequence               { running(), barText() } -> the sequence segment: whether a sequence
 *                            is running and the progress text the fit bar shows for it; false
 *                            and '' while there is no sequence segment
 *     fit                    { forgetRevert(), setBarProgress(text) } -> the fit segment; no-ops
 *                            while there is none
 *     shape                  { exportBlob() } -> the PNG of the 3D sketch as a Promise<Blob | null>;
 *                            resolves null while there is no such module
 *
 * The state and the form are never modified: every change replaces the frozen
 * object. Non-SasFit globals are read through host() at call time; nothing
 * here touches document while the file loads.
 */

(function () {
    'use strict';

    const DEFAULT_MODEL = 'sphere';
    const TAB_ACTION = 'setTab';
    const ACTIVE_CLASS = 'active';
    const NAV_KEYS = Object.freeze(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
    const TAB_ELEMENTS = Object.freeze({
        data: Object.freeze({ tab: 'sfTabData', panel: 'sfPanelData' }),
        model: Object.freeze({ tab: 'sfTabModel', panel: 'sfPanelModel' }),
        fit: Object.freeze({ tab: 'sfTabFit', panel: 'sfPanelFit' }),
        sequence: Object.freeze({ tab: 'sfTabSeq', panel: 'sfPanelSeq' }),
    });
    const TABLIST_ID = 'sfTabs';
    const WORKSPACE_ID = 'sfWorkspace';       // carries data-tab: the narrow layout keeps the plot in view while the model is edited
    const SEGMENT_MODULES = Object.freeze([
        Object.freeze({ key: 'data', global: 'SasFitDataUi' }),
        Object.freeze({ key: 'model', global: 'SasFitParamsUi' }),
        Object.freeze({ key: 'fit', global: 'SasFitFitUi' }),
        Object.freeze({ key: 'shape', global: 'SasFitShape3d' }),         // not a tab: the 3D sketch and the switch of the plot card
        Object.freeze({ key: 'sequence', global: 'SasFitSeqUi' }),        // after the others: it draws from what they have set
        Object.freeze({ key: 'export', global: 'SasFitExportUi' }),       // not a tab; last: its buttons follow what the others drew
    ]);
    const ELEMENT_IDS = Object.freeze([
        'sfAlert', WORKSPACE_ID, TABLIST_ID, 'sfTabData', 'sfTabModel', 'sfTabFit', 'sfTabSeq',
        'sfPanelData', 'sfPanelModel', 'sfPanelFit', 'sfPanelSeq',
        // fit bar (on every tab)
        'sfFitBar', 'sfFitStart', 'sfFitStop', 'sfFitMeasure', 'sfFitSummary', 'sfFitProgress', 'sfFitLive',
        // data segment
        'sfDataLock', 'sfDrop', 'sfFileInput', 'sfQUnit', 'sfDataAlert', 'sfUndo', 'sfUndoText', 'sfUndoBtn',
        'sfDataWrapper', 'sfCondHead', 'sfDataBody', 'sfDataEmpty', 'sfShownNote', 'sfConditionName', 'sfStagger', 'sfStaggerDecades',
        // model segment
        'sfModelLock', 'sfModel', 'sfModelInfo', 'sfStructure', 'sfStructureNote', 'sfStructureOptions',
        'sfStructureMode', 'sfRadiusMode', 'sfLowQ', 'sfModelHints', 'sfParamWrapper', 'sfParamHead', 'sfParamBody',
        // fit segment
        'sfQMin', 'sfQMinError', 'sfQMax', 'sfQMaxError', 'sfRangeFull', 'sfRangeDefault', 'sfRangeInfo', 'sfWeighting',
        'sfMaxSteps', 'sfMaxStepsError', 'sfFitRevert', 'sfFitRevertNote', 'sfPreFitHints', 'sfFitAlert',
        'sfFitResults', 'sfFitHints', 'sfFitParams',
        // exports and the IUCr table
        'sfExportRow', 'sfExportCsv', 'sfExportTxt', 'sfExportNote', 'sfSendIucr', 'sfSendIucrNote', 'sfCopySasview', 'sfSasviewNote', 'sfMainPng', 'sfResidualPng',
        // sequence segment
        'sfSeqLock', 'sfSeqChain', 'sfSeqSort', 'sfSeqSettings', 'sfSeqHints', 'sfSeqRun', 'sfSeqProgress', 'sfSeqLive',
        'sfSeqTrendBox', 'sfSeqY', 'sfSeqTrend', 'sfSeqTrendNote', 'sfSeqTrendPng', 'sfSeqAll', 'sfSeqNone', 'sfSeqEmpty',
        'sfSeqWrapper', 'sfSeqHead', 'sfSeqBody', 'sfSeqCsv',
        // charts
        'sfPlotTitle', 'sfModeLogLog', 'sfModeGuinier', 'sfModeKratky', 'sfModePorod', 'sfResetZoom', 'sfPlotStatus', 'sfPreviewNow', 'sfPlotLive',
        'sfMainChart', 'sfResidualEmpty', 'sfResidualBox', 'sfResidualChart',
        // plot card: the switch between the curves and the 3D sketch, and the sketch
        'sfViewTabs', 'sfViewCurve', 'sfViewShape', 'sfCurveTools', 'sfCurveView', 'sfShapeTools', 'sfShapeView', 'sfShapeStatus',
        'sfShapeStage', 'sfShapeCanvas', 'sfShapeHelp', 'sfShapeText', 'sfShapeDims', 'sfShapeExtras', 'sfShapeReset', 'sfShapeSpin', 'sfShapePng',
    ]);
    const TEXT = Object.freeze({
        empty: '尚未載入資料。',
        needData: '請先載入資料，才能設定擬合範圍並開始擬合。',
        seqEmpty: '請先載入資料',
        renderFailed: '畫面更新時發生錯誤，部分內容可能不是最新的；請重新整理頁面後再試',
    });
    const LOG = '[sasfit]';
    const SECTION_ID = 'section-sasfit';
    const DROP_SELECTOR = '#sfDrop';
    const GUARDED_DRAG_EVENTS = Object.freeze(['dragover', 'drop']);

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const isObject = (v) => v !== null && typeof v === 'object';
    const el = (id) => document.getElementById(id);

    /** Everything the page holds; replaced as a whole (frozen) on every change. */
    let page = Object.freeze({
        initialised: false, bound: false, context: null, state: null, form: null, client: null, deps: null, segments: Object.freeze({}),
    });

    const update = (changes) => { page = Object.freeze({ ...page, ...changes }); };

    function getState() {
        if (page.state === null) update({ state: globalThis.SasFitState.initial() });
        return page.state;
    }

    function getForm() {
        if (page.form === null) update({ form: globalThis.SasFitForm.create(DEFAULT_MODEL) });
        return page.form;
    }

    // ------------------------------------------------------------- deps and client

    const NO_MEDIA = Object.freeze({ matches: false });

    /** Calls fn whenever the element gets another size (nothing happens where the platform cannot tell). */
    function observeResize(element, fn) {
        const Observer = host().ResizeObserver;
        if (typeof Observer !== 'function') return;
        new Observer(() => fn()).observe(element);
    }

    function resolveDeps(given) {
        const g = isObject(given) ? given : {};
        return Object.freeze({
            createClient: g.createClient || (() => globalThis.SasFitWorkerClient.create()),
            readFile: g.readFile || ((file) => host().DndcFileParser.readFile(file)),
            timers: g.timers || Object.freeze({
                setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
                clearTimeout: (id) => globalThis.clearTimeout(id),
            }),
            plots: g.plots || globalThis.SasFitPlots || null,
            raf: g.raf || ((fn) => host().requestAnimationFrame(fn)),
            cancelRaf: g.cancelRaf || ((id) => host().cancelAnimationFrame(id)),
            matchMedia: g.matchMedia || ((query) => (typeof host().matchMedia === 'function' ? host().matchMedia(query) : NO_MEDIA)),
            createCanvas: g.createCanvas || (() => document.createElement('canvas')),
            observeResize: g.observeResize || observeResize,
            download: g.download || ((blob, fileName) => globalThis.SasFitExportUi.download(blob, fileName)),
            now: g.now || (() => Date.now()),
            version: g.version || (() => globalThis.SasFitWorkerClient.scriptVersion),
            sendIucr: g.sendIucr || ((data) => host().setIUCrModelFit(data)),
            copyText: g.copyText || ((text) => globalThis.SasFitExportUi.copyText(text)),
        });
    }

    function getClient() {
        if (page.client === null) update({ client: page.deps.createClient() });
        return page.client;
    }

    // ------------------------------------------------------------- render layer

    function renderTabs(state) {
        Object.keys(TAB_ELEMENTS).forEach((key) => {
            const selected = key === state.tab;
            const tab = el(TAB_ELEMENTS[key].tab);
            tab.classList.toggle(ACTIVE_CLASS, selected);
            tab.setAttribute('aria-selected', String(selected));
            tab.setAttribute('tabindex', selected ? '0' : '-1');
            el(TAB_ELEMENTS[key].panel).hidden = !selected;
        });
        el(WORKSPACE_ID).setAttribute('data-tab', state.tab);
    }

    /** The empty state of a segment whose module does not exist yet; the module takes over once it registers. */
    const PLACEHOLDERS = Object.freeze({
        data(state) {
            const empty = state.files.length === 0;
            el('sfDataEmpty').textContent = TEXT.empty;
            el('sfDataEmpty').hidden = !empty;
            el('sfDataWrapper').hidden = empty;
        },
        model() {},
        fit() {
            el('sfFitStart').disabled = true;
            el('sfFitSummary').textContent = TEXT.needData;
        },
        sequence(state) {
            const empty = !state.files.some((file) => file.dataset !== null);
            el('sfSeqEmpty').textContent = TEXT.seqEmpty;
            el('sfSeqEmpty').hidden = !empty;
            el('sfSeqWrapper').hidden = true;                 // without the module there is nothing to list
            el('sfSeqRun').disabled = true;
        },
        shape() {},                           // the markup starts in the curve view, which needs no module
        export() {},                          // the markup ships every export button disabled
    });

    function renderPlaceholders(state) {
        SEGMENT_MODULES.filter(({ key }) => page.segments[key] === undefined).forEach(({ key }) => PLACEHOLDERS[key](state));
    }

    /** One segment's render; a failure is logged and announced, and never stops the other segments. */
    function renderSegment(key) {
        try {
            page.segments[key].render();
        } catch (err) {
            console.error(LOG + ' 分段 ' + key + ' 重繪失敗：' + (err instanceof Error ? err.message : String(err)), err);
            el('sfAlert').textContent = TEXT.renderFailed;
        }
    }

    /** Draw everything from the current state and form. */
    function refresh() {
        const state = getState();
        renderTabs(state);
        renderPlaceholders(state);
        SEGMENT_MODULES.forEach(({ key }) => {
            if (page.segments[key] !== undefined) renderSegment(key);
        });
    }

    // ------------------------------------------------------------- state and form

    function dispatch(action, options) {
        const state = globalThis.SasFitState.reduce(getState(), action);      // throws before anything changes
        update({ state });
        if (isObject(options) && options.silent === true) return state;
        if (isObject(action) && action.type === TAB_ACTION) renderTabs(state);
        else refresh();
        return state;
    }

    function setForm(form) {
        if (!isObject(form)) throw new Error('setForm needs a form object, got ' + String(form));
        update({ form });
        return form;
    }

    // ------------------------------------------------------------- html

    const written = new WeakMap();          // element -> the html setHtml last wrote there

    /** The focused element when it is inside `element` and has an id, else null. */
    function focusedInside(element) {
        const focused = typeof document.activeElement === 'object' ? document.activeElement : null;
        if (!focused || !focused.id || typeof element.contains !== 'function' || !element.contains(focused)) return null;
        return focused;
    }

    function caretOf(input) {
        try {
            return typeof input.selectionStart === 'number' ? [input.selectionStart, input.selectionEnd] : null;
        } catch (err) {
            return null;                      // inputs without a text selection (number, checkbox) throw in some browsers
        }
    }

    function restoreFocus(id, caret) {
        const next = el(id);
        if (!next || typeof next.focus !== 'function') return;
        next.focus({ preventScroll: true });
        if (caret === null || typeof next.setSelectionRange !== 'function') return;
        try {
            next.setSelectionRange(caret[0], caret[1]);
        } catch (err) {
            // the new element has no text selection: the focus alone is what can be kept
        }
    }

    function setHtml(element, html) {
        if (!isObject(element)) throw new Error('setHtml needs an element');
        if (typeof html !== 'string') throw new Error('setHtml needs html as a string');
        if (written.get(element) === html) return false;
        const focused = focusedInside(element);
        const caret = focused === null ? null : caretOf(focused);
        element.innerHTML = html;
        written.set(element, html);
        if (focused !== null) restoreFocus(focused.id, caret);
        return true;
    }

    // ------------------------------------------------------------- segments

    const NO_PREVIEW_STATUS = Object.freeze({});

    function buildContext() {
        const model = () => page.segments.model;
        const call = (method, fallback) => () => (model() !== undefined && typeof model()[method] === 'function' ? model()[method]() : fallback);
        const sequence = (method, fallback) => () => {
            const segment = page.segments.sequence;
            return segment !== undefined && typeof segment[method] === 'function' ? segment[method]() : fallback;
        };
        const fitCall = (method, arg) => {
            const segment = page.segments.fit;
            if (segment !== undefined && typeof segment[method] === 'function') segment[method](arg);
        };
        const shapeBlob = () => {
            const segment = page.segments.shape;
            return segment !== undefined && typeof segment.exportBlob === 'function' ? segment.exportBlob() : Promise.resolve(null);
        };
        const ctx = {
            el, getState, dispatch, getForm, setForm, refresh, setHtml,
            deps: page.deps,
            preview: Object.freeze({
                schedule: call('schedulePreview', undefined),
                cancel: call('cancelPreview', undefined),
                last: call('lastPreview', null),
                status: call('previewStatus', NO_PREVIEW_STATUS),
            }),
            sequence: Object.freeze({ running: sequence('running', false), barText: sequence('barText', '') }),
            fit: Object.freeze({ forgetRevert: () => fitCall('forgetRevert'), setBarProgress: (text) => fitCall('setBarProgress', text) }),
            shape: Object.freeze({ exportBlob: shapeBlob }),
        };
        Object.defineProperty(ctx, 'client', { get: getClient, enumerable: true });
        return Object.freeze(ctx);
    }

    /**
     * create(ctx) of every segment module that exists and has no segment yet; throws when one breaks the contract.
     * Each segment is kept as soon as it exists: create() binds events, so a later init must not create it again.
     */
    function createSegments(ctx) {
        SEGMENT_MODULES.forEach(({ key, global }) => {
            const module = globalThis[global];
            if (module === undefined || page.segments[key] !== undefined) return;
            if (!isObject(module) || typeof module.create !== 'function') throw new Error(global + '.create is not a function');
            const segment = module.create(ctx);
            if (!isObject(segment) || typeof segment.render !== 'function') {
                throw new Error(global + '.create(ctx) must return an object with render()');
            }
            update({ segments: Object.freeze({ ...page.segments, [key]: segment }) });
        });
    }

    // ------------------------------------------------------------- segment control

    function onTabKey(event) {
        if (NAV_KEYS.indexOf(event.key) < 0) return;
        event.preventDefault();                                   // Home / End would scroll the page
        // the tabs this page has (the same four as SasFitState.TABS)
        const next = globalThis.SasFitState.nextTab(Object.keys(TAB_ELEMENTS), getState().tab, event.key);
        dispatch({ type: TAB_ACTION, tab: next });
        el(TAB_ELEMENTS[next].tab).focus();
    }

    function bindTabs() {
        Object.keys(TAB_ELEMENTS).forEach((key) => {
            el(TAB_ELEMENTS[key].tab).addEventListener('click', () => dispatch({ type: TAB_ACTION, tab: key }));
        });
        el(TABLIST_ID).addEventListener('keydown', onTabKey);
    }

    /** The page section is the one on screen (an element that is not there counts as shown). */
    function sectionShown() {
        const section = el(SECTION_ID);
        return !section || !isObject(section.classList) || section.classList.contains(ACTIVE_CLASS);
    }

    /**
     * A file dropped next to the drop zone would make the browser open it and leave the page. While this section
     * is on screen, drags outside #sfDrop are cancelled; #sfDrop handles its own (SasFitDataUi).
     */
    function onStrayDrag(event) {
        if (!sectionShown()) return;
        const target = event.target;
        const inZone = isObject(target) && typeof target.closest === 'function' && target.closest(DROP_SELECTOR) !== null;
        if (!inZone) event.preventDefault();
    }

    /** Listeners of the skeleton, bound once however often init runs. */
    function bindOnce() {
        if (page.bound) return;
        bindTabs();
        if (typeof document.addEventListener === 'function') {
            GUARDED_DRAG_EVENTS.forEach((type) => document.addEventListener(type, onStrayDrag));
        }
        update({ bound: true });
    }

    // ------------------------------------------------------------- start

    function missingElements() {
        if (typeof document === 'undefined') return ['document'];
        return ELEMENT_IDS.filter((id) => !el(id));
    }

    /** May run again after a failure: what already exists (deps, context, segments, listeners) is kept. */
    function start(deps) {
        if (page.deps === null) {
            update({ deps: resolveDeps(deps), state: globalThis.SasFitState.initial(), form: globalThis.SasFitForm.create(DEFAULT_MODEL) });
        }
        if (page.context === null) update({ context: buildContext() });
        createSegments(page.context);
        bindOnce();                       // before the first refresh: the tabs work even if a segment fails to draw
        refresh();
        update({ initialised: true });
    }

    function init(deps) {
        if (page.initialised) return true;
        const missing = missingElements();
        if (missing.length > 0) {
            // no throw: init runs inside DOMContentLoaded, and a throw would also stop what app.js starts after it
            console.error(LOG + ' 缺少元素：' + missing.join(', '));
            return false;
        }
        try {
            start(deps);
        } catch (err) {
            console.error(LOG + ' 啟動失敗：' + (err instanceof Error ? err.message : String(err)), err);
            return false;
        }
        return true;
    }

    globalThis.SasFitSection = Object.freeze({ init, getState, getForm, ELEMENT_IDS, SEGMENT_MODULES });
})();
