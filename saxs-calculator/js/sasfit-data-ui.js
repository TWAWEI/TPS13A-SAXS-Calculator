/**
 * sasfit-data-ui.js -- the data segment of the SAS fitting page and the plot
 * area that every segment shares (design spec 5.2, 5.6; plan M3 Task 11).
 * Original code. DOM module: loaded before section-sasfit.js, which calls
 * SasFitDataUi.create(ctx) once (see its header for ctx).
 *
 *   SasFitDataUi.create(ctx) -> { render() }
 *
 * What it owns:
 *   files     the file input and the drop zone (#sfDrop). Files are cut to
 *             the capacity of the list and checked against the size limit
 *             BEFORE anything is read, then read one after the other through
 *             ctx.deps.readFile and parsed by SasFitDataIo with the q unit
 *             chosen at that moment. A file that cannot be read or parsed
 *             becomes a row with its reasons; the others are not affected.
 *   list      #sfDataBody = SasFitHtml.fileRowsHtml; show / active / condition
 *             / remove by event delegation (data-action, data-id); the strip
 *             that undoes the last removal (state.removed); the condition
 *             name as the header of its column.
 *   display   condition name, staggering, the three plot mode buttons, reset
 *             zoom (enabled only while the main chart is zoomed or panned).
 *   plots     the view of SasFitPlotData from the state, the form and the
 *             latest preview (ctx.preview), drawn by ctx.deps.plots; the status
 *             line under the title (SasFitHints.plotStatus) and the canvas labels.
 *
 * The view (plan M3, assumption a11): every shown file draws its points; a
 * file that is not the active one draws the curve of its own FitResult. The
 * active file draws the full-resolution curve and the residuals of its
 * FitResult as long as that result matches the form
 * (SasFitJobs.resultMatchesForm); otherwise it draws the preview of the form
 * and no residuals (they would belong to another curve).
 *
 * render() does not dispatch and leaves alone what did not change: the list
 * is rebuilt only when a row changes (a condition being typed is not such a
 * change), so the focus survives a refresh.
 *
 * SECURITY: file names, header fields and error texts reach the page only
 * through the SasFitHtml builders (which escape) or textContent. While a fit
 * runs, what the state's fit lock forbids is disabled: file input, drop zone,
 * q unit, "active" and "remove".
 */

(function () {
    'use strict';

    const LOG = '[sasfit]';
    const BYTES_PER_MB = 1024 * 1024;
    const MAX_TOTAL_POINTS = 2000000;        // all loaded files together (three Float64Array columns: about 50 MB)
    const CHI2R_DIGITS = 3;
    const DRAG_CLASS = 'is-dragover';
    const ACTIVE_CLASS = 'active';
    const CHIP_SELECTOR = '.sf-series-chip';
    const CHIP_COLOR = '--chip-color';
    const THEME_EVENT = 'tps:themechange';
    const MAIN_CANVAS = 'sfMainChart';
    const RESIDUAL_CANVAS = 'sfResidualChart';
    const MODE_BUTTONS = Object.freeze({ loglog: 'sfModeLogLog', guinier: 'sfModeGuinier', kratky: 'sfModeKratky', porod: 'sfModePorod' });
    const FAILED_STATUS = Object.freeze({ text: '無法載入', tone: 'error', measure: null });
    const TEXT = Object.freeze({
        empty: '尚未載入資料。',
        tooLarge: (mb, maxMb) => '檔案 ' + mb + ' MB 超過上限 ' + maxMb + ' MB，未讀取',
        unreadable: (reason) => '無法讀取：' + reason,
        reading: (done, total) => '讀取中…（' + done + '／' + total + '）',
        lockedDrop: '擬合進行中，無法加入檔案；請在擬合結束後再載入。',
        sorted: 'q 未依大小排列，已自動排序',
        suspectNm: 'q 範圍像是 nm⁻¹（一般 SAXS 在 Å⁻¹ 下 q 約 0.003–0.5），請確認 q 單位',
        overBudget: (max) => '已載入的資料點總數將超過上限 ' + max + ' 點，此檔未加入',
        removed: (name) => '已移除 ' + name,
        conditionHead: '條件值',
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isRunning = (state) => state.fit.phase === 'running';
    const messageOf = (err) => (err instanceof Error ? err.message : String(err));

    /** A value that is replaced as a whole (frozen) on every change. */
    function makeStore(initial) {
        let value = Object.freeze({ ...initial });
        return Object.freeze({
            get: () => value,
            set(changes) { value = Object.freeze({ ...value, ...changes }); return value; },
        });
    }

    // ------------------------------------------------------------- view of the plots

    /** The FitResult of a file when it has a curve to draw, else null. */
    function resultOf(state, id) {
        const result = has(state.fitResults, id) ? state.fitResults[id] : null;
        return isObject(result) && isObject(result.curve) ? result : null;
    }

    /** The active file's FitResult while it still describes the form, else null. */
    function matchingResult(state, form) {
        if (state.activeId === null) return null;
        const result = resultOf(state, state.activeId);
        return result !== null && globalThis.SasFitJobs.resultMatchesForm(form, result) ? result : null;
    }

    function buildView(state, form, preview) {
        const matched = matchingResult(state, form);
        const series = globalThis.SasFitState.shownFiles(state).map((file) => {
            const active = file.id === state.activeId;
            const result = active ? matched : resultOf(state, file.id);
            return Object.freeze({
                id: file.id, index: file.index, label: file.fileName, active, data: file.dataset,
                fitCurve: result === null ? null : Object.freeze({ q: file.dataset.q, I: result.curve }),
            });
        });
        const activeFile = globalThis.SasFitState.active(state);
        const residuals = matched !== null && isObject(matched.residuals)
            ? Object.freeze({ q: activeFile.dataset.q, r: matched.residuals }) : null;
        return Object.freeze({
            mode: state.plotMode, series: Object.freeze(series), preview: matched === null ? preview : null,
            range: state.range === null ? null : Object.freeze({ qMin: state.range.qMin, qMax: state.range.qMax }),
            stagger: state.stagger, residuals,
        });
    }

    /** What the main chart's label says about the fit drawn in it: the measure, its value and the status in words. */
    function fitInfo(result) {
        if (result === null) return null;
        const hints = globalThis.SasFitHints;
        return { isChi2: hints.measure(result).isChi2, value: result.chi2r, status: hints.statusLabel(result).text };
    }

    /**
     * aria-label of the two canvases: Chart.js draws pixels only, so the labels carry the result (model, fit
     * measure and status, fit range; number, range and outliers of the residuals).
     */
    function describeCharts(ui, state, view) {
        const a11y = host().A11y;
        if (!isObject(a11y)) return;
        const labels = globalThis.SasFitLabels;
        const active = view.series.find((s) => s.active);
        const form = ui.ctx.getForm();
        a11y.describeChart(MAIN_CANVAS, labels.chartLabel({
            count: view.series.length, mode: view.mode, active: active === undefined ? '' : active.label, model: form.model,
            preview: view.preview !== null, range: view.range, fit: fitInfo(matchingResult(state, form)),
        }));
        a11y.describeChart(RESIDUAL_CANVAS, labels.residualLabel(view.residuals === null || active === undefined
            ? null : { name: active.label, r: view.residuals.r }));
    }

    /** The status line: what the view hides or thins, and what the preview reports. */
    function renderStatus(ui, view) {
        const { ctx } = ui;
        const stats = globalThis.SasFitPlotData.viewStats(view);
        const preview = ctx.preview.status();
        const drawsPreview = view.preview !== null;
        const paused = preview.paused === true;
        const fresh = preview.fresh === true;
        // "computed with N points" only describes the curve on screen: not while a paused preview waits for its update
        const points = drawsPreview && preview.previewPoints > 0 && (!paused || fresh) ? preview.previewPoints : 0;
        const status = globalThis.SasFitHints.plotStatus({
            computing: preview.computing === true, paused, fresh: paused && fresh, stale: drawsPreview && preview.stale === true,
            zoomed: ui.store.get().zoomed, previewPoints: points,
            hidden: stats.hidden, mode: view.mode, displayStride: stats.displayStride, nonFinite: stats.nonFinite,
            allNonFinite: preview.allNonFinite === true, error: preview.error,
        });
        ctx.el('sfPlotStatus').textContent = status.text;
        if (ui.store.get().live === status.live) return;
        ui.store.set({ live: status.live });
        ctx.el('sfPlotLive').textContent = status.live;       // announced only when it changes, never "computing"
    }

    function renderPlots(ui, state) {
        const { ctx } = ui;
        const view = buildView(state, ctx.getForm(), ctx.preview.last());
        if (isObject(ctx.deps.plots)) ctx.deps.plots.render(view);
        describeCharts(ui, state, view);
        renderStatus(ui, view);
        ctx.el('sfPlotTitle').textContent = globalThis.SasFitLabels.plotTitle(state.plotMode);
        ctx.el('sfResetZoom').disabled = !ui.store.get().zoomed;
        // without residuals the chart would be an empty frame of 140 px: one line says so instead
        ctx.el('sfResidualBox').hidden = view.residuals === null;
        ctx.el('sfResidualEmpty').hidden = view.residuals !== null;
        Object.keys(MODE_BUTTONS).forEach((mode) => {
            const button = ctx.el(MODE_BUTTONS[mode]);
            button.setAttribute('aria-pressed', String(mode === state.plotMode));
            button.classList.toggle(ACTIVE_CLASS, mode === state.plotMode);
        });
    }

    // ------------------------------------------------------------- file list

    /** What the reader noted about a loaded file, as lines of its row (empty bins of an official file are routine: not listed). */
    function noteIssues(notes) {
        if (!isObject(notes)) return [];
        return [
            notes.sorted === true ? TEXT.sorted : null,
            notes.suspectNm === true ? TEXT.suspectNm : null,
        ].filter((message) => message !== null).map((message) => Object.freeze({ line: null, message }));
    }

    function statusOf(state, file) {
        if (file.dataset === null) return FAILED_STATUS;
        const result = has(state.fitResults, file.id) ? state.fitResults[file.id] : null;
        const label = globalThis.SasFitHints.statusLabel(result);
        if (result === null) return { text: label.text, tone: undefined, measure: null };
        const measure = globalThis.SasFitHints.measure(result);
        const value = globalThis.SasFitHtml.formatNumber(result.chi2r, CHI2R_DIGITS);
        // text: all of it, for the title and screen readers; measure: what the narrow chip shows
        return { text: measure.label + ' ' + value + '・' + label.text, tone: label.tone,
            measure: Object.freeze({ isChi2: measure.isChi2, label: measure.label, value, short: label.short }) };
    }

    function rowOf(state, file, index) {
        const status = statusOf(state, file);
        return {
            id: file.id, index, fileName: file.fileName, hasData: file.dataset !== null,
            shown: state.shown[file.id] === true, active: file.id === state.activeId, condition: file.condition,
            statusText: status.text, statusTone: status.tone, statusMeasure: status.measure, conditionName: state.conditionName,
            issues: file.issues.concat(noteIssues(file.dataset === null ? null : file.notes)), issueOverflow: file.issueOverflow,
            locked: isRunning(state),
        };
    }

    const rowsOf = (state) => state.files.map((file, index) => rowOf(state, file, index));

    function paintChips(ui, themeName) {
        const theme = host().ChartTheme;
        const palette = theme.palette(themeName);
        ui.ctx.el('sfDataBody').querySelectorAll(CHIP_SELECTOR).forEach((chip) => {
            chip.style.setProperty(CHIP_COLOR, theme.seriesColor(palette, Number(chip.dataset.series)));
        });
    }

    /** The condition inputs follow the state without a rebuild (unless the user is typing there). */
    function syncConditions(ui, state) {
        state.files.filter((file) => file.dataset !== null).forEach((file) => {
            const input = ui.ctx.el(globalThis.SasFitHtml.fileControlId(file.id, 'condition'));
            if (!input || input.getAttribute('aria-invalid') === 'true') return;
            const text = file.condition === null ? '' : String(file.condition);
            if (input.value.trim() === '' ? text !== '' : Number(input.value) !== file.condition) input.value = text;
        });
    }

    function renderList(ui, state) {
        const { ctx } = ui;
        const rows = rowsOf(state);
        // What the rows' HTML depends on, without building it. The condition is left out: typing one must not
        // rebuild the list under the caret. A file's issues never change after loading: their count is enough.
        const key = JSON.stringify(rows.map((row) => [row.id, row.index, row.fileName, row.hasData, row.shown, row.active,
            row.statusText, row.statusTone, row.statusMeasure, row.conditionName, row.locked, row.issues.length, row.issueOverflow]));
        if (key !== ui.store.get().listKey) {
            ctx.setHtml(ctx.el('sfDataBody'), globalThis.SasFitHtml.fileRowsHtml(rows));
            ui.store.set({ listKey: key });
            paintChips(ui);
        } else {
            syncConditions(ui, state);
        }
        const empty = state.files.length === 0;
        ctx.el('sfDataEmpty').textContent = TEXT.empty;
        ctx.el('sfDataEmpty').hidden = !empty;
        ctx.el('sfDataWrapper').hidden = empty;
        const name = state.conditionName.trim();
        ctx.el('sfCondHead').textContent = name === '' ? TEXT.conditionHead : name;      // the name the user gave the column
        const withData = state.files.filter((file) => file.dataset !== null).length;
        ctx.el('sfShownNote').hidden = withData <= globalThis.SasFitState.DEFAULT_SHOWN;
        renderUndo(ui, state);
    }

    /** The strip that offers to put the file removed last back (with its fit result). */
    function renderUndo(ui, state) {
        const { ctx } = ui;
        const { removed } = state;
        ctx.el('sfUndo').hidden = removed === null;
        ctx.el('sfUndoText').textContent = removed === null ? '' : TEXT.removed(removed.file.fileName);
        ctx.el('sfUndoBtn').disabled = isRunning(state);
    }

    function renderControls(ui, state) {
        const { ctx } = ui;
        const locked = isRunning(state);
        const { notice, loading } = ui.store.get();
        ctx.el('sfFileInput').disabled = locked || loading;
        ctx.el('sfQUnit').disabled = locked || loading;
        ctx.el('sfDrop').setAttribute('aria-disabled', String(locked || loading));
        ctx.el('sfDrop').setAttribute('aria-busy', String(loading));
        ctx.el('sfDataLock').hidden = !locked;
        ctx.el('sfDataAlert').textContent = notice !== '' ? notice : (state.notice === null ? '' : state.notice);
        const stagger = ctx.el('sfStagger');
        if (stagger.checked !== state.stagger.on) stagger.checked = state.stagger.on;
        const decades = ctx.el('sfStaggerDecades');
        if (decades.getAttribute('aria-invalid') !== 'true' && Number(decades.value) !== state.stagger.decades) {
            decades.value = String(state.stagger.decades);
        }
    }

    function render(ui) {
        const state = ui.ctx.getState();
        renderList(ui, state);
        renderControls(ui, state);
        renderPlots(ui, state);
    }

    // ------------------------------------------------------------- loading files

    const failedEntry = (fileName, message) => Object.freeze({
        fileName, dataset: null, issues: Object.freeze([Object.freeze({ line: null, message })]), notes: Object.freeze({}),
    });

    const pointsOf = (dataset) => (dataset === null ? 0 : dataset.q.length);

    /**
     * One file -> the entry of the addFiles action; never rejects. `used` is the number of points loaded so far
     * (list + this selection): a file that would pass MAX_TOTAL_POINTS is not added.
     */
    async function readEntry(ui, file, qUnit, used) {
        const io = globalThis.SasFitDataIo;
        const fileName = typeof file.name === 'string' ? file.name : '';
        if (file.size > io.LIMITS.MAX_BYTES) {
            return failedEntry(fileName, TEXT.tooLarge((file.size / BYTES_PER_MB).toFixed(1), (io.LIMITS.MAX_BYTES / BYTES_PER_MB).toFixed(0)));
        }
        try {
            const text = await ui.ctx.deps.readFile(file);
            const parsed = io.parse(text, { fileName, qUnit });
            if (used + pointsOf(parsed.dataset) > MAX_TOTAL_POINTS) return failedEntry(fileName, TEXT.overBudget(MAX_TOTAL_POINTS));
            return Object.freeze({
                fileName, dataset: parsed.dataset, issues: parsed.issues, issueOverflow: parsed.issueOverflow, notes: parsed.notes,
            });
        } catch (err) {
            console.warn(LOG + ' 讀檔失敗', err);                 // no file name in the console (it may identify a sample)
            return failedEntry(fileName, TEXT.unreadable(messageOf(err)));
        }
    }

    function progress(ui, done, total) {
        ui.store.set({ notice: TEXT.reading(done, total) });
        ui.ctx.el('sfDataAlert').textContent = ui.store.get().notice;
    }

    /** The files of a selection that fit into the list, read one after the other (the list keeps their order). */
    async function readEntries(ui, taken) {
        const qUnit = ui.ctx.el('sfQUnit').value === 'nm' ? 'nm' : 'A';
        const entries = [];
        let used = ui.ctx.getState().files.reduce((sum, f) => sum + pointsOf(f.dataset), 0);
        for (const file of taken) {
            progress(ui, entries.length, taken.length);
            const entry = await readEntry(ui, file, qUnit, used);
            used += pointsOf(entry.dataset);
            entries.push(entry);
        }
        return entries;
    }

    /** Read the files, then add them to the list in one action (its notice says how many did not fit). */
    async function loadFiles(ui, fileList) {
        const { ctx } = ui;
        const files = Array.from(fileList || []);
        if (files.length === 0 || ui.store.get().loading) return;
        if (isRunning(ctx.getState())) {
            ui.store.set({ notice: TEXT.lockedDrop });
            ctx.refresh();
            return;
        }
        const taken = files.slice(0, globalThis.SasFitState.capacity(ctx.getState()));
        ui.store.set({ loading: true });
        ctx.refresh();
        const entries = await readEntries(ui, taken);
        const locked = isRunning(ctx.getState());                 // a fit may have started while the files were read
        ui.store.set({ loading: false, notice: locked ? TEXT.lockedDrop : '' });
        if (locked) ctx.refresh();
        else ctx.dispatch({ type: 'addFiles', files: entries, skipped: files.length - taken.length });
    }

    function startLoading(ui, fileList) {
        loadFiles(ui, fileList).catch((err) => {
            console.error(LOG + ' 載入檔案時發生未預期的錯誤', err);
            ui.store.set({ loading: false, notice: TEXT.unreadable(messageOf(err)) });
            ui.ctx.refresh();
        });
    }

    // ------------------------------------------------------------- events

    function bindFiles(ui) {
        const { ctx } = ui;
        const input = ctx.el('sfFileInput');
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            input.value = '';                                      // so that the same file can be chosen again
            startLoading(ui, files);
        });
        const drop = ctx.el('sfDrop');
        drop.addEventListener('dragover', (event) => {
            event.preventDefault();                                // without it the browser opens the file instead
            drop.classList.add(DRAG_CLASS);
        });
        drop.addEventListener('dragleave', () => drop.classList.remove(DRAG_CLASS));
        drop.addEventListener('drop', (event) => {
            event.preventDefault();
            drop.classList.remove(DRAG_CLASS);
            startLoading(ui, isObject(event.dataTransfer) ? event.dataTransfer.files : []);
        });
    }

    /** The number typed into a number input: { ok, value } with null for an empty field. */
    function numberOf(input) {
        const bad = isObject(input.validity) && input.validity.badInput === true;
        const text = String(input.value).trim();
        if (text === '' && !bad) return { ok: true, value: null };
        const value = Number(text);
        return bad || !Number.isFinite(value) ? { ok: false, value: null } : { ok: true, value };
    }

    function markInvalid(input, invalid) {
        if (invalid) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }

    function onCondition(ui, target) {
        const parsed = numberOf(target);
        markInvalid(target, !parsed.ok);
        if (parsed.ok) ui.ctx.dispatch({ type: 'setCondition', id: target.dataset.id, value: parsed.value }, { silent: true });
    }

    const targetOf = (event) => (typeof event.target.closest === 'function' ? event.target.closest('[data-action]') : null);

    function bindList(ui) {
        const { ctx } = ui;
        const body = ctx.el('sfDataBody');
        body.addEventListener('change', (event) => {
            const target = targetOf(event);
            if (target === null) return;
            const { action, id } = target.dataset;
            if (action === 'show') ctx.dispatch({ type: 'setShown', id, shown: target.checked === true });
            else if (action === 'active' && !isRunning(ctx.getState())) ctx.dispatch({ type: 'setActive', id });
        });
        body.addEventListener('input', (event) => {
            const target = targetOf(event);
            if (target !== null && target.dataset.action === 'condition') onCondition(ui, target);
        });
        body.addEventListener('click', (event) => {
            const target = targetOf(event);
            if (target === null || target.dataset.action !== 'remove' || isRunning(ctx.getState())) return;
            ui.store.set({ notice: '' });                          // a message about an earlier load no longer applies
            ctx.dispatch({ type: 'removeFile', id: target.dataset.id });
            ctx.el('sfDataWrapper').focus();                       // the button is gone: keep the focus near the list
        });
    }

    function onStagger(ui) {
        const { ctx } = ui;
        const decades = ctx.el('sfStaggerDecades');
        const parsed = numberOf(decades);
        const valid = parsed.ok && parsed.value !== null && parsed.value >= 0;
        markInvalid(decades, !valid);
        ctx.dispatch({ type: 'setStagger', on: ctx.el('sfStagger').checked === true, decades: valid ? parsed.value : ctx.getState().stagger.decades });
    }

    function bindDisplay(ui) {
        const { ctx } = ui;
        ctx.el('sfConditionName').addEventListener('input', (event) => {
            ctx.dispatch({ type: 'setConditionName', name: String(event.target.value) });      // the list's column takes the name
        });
        ctx.el('sfStagger').addEventListener('change', () => onStagger(ui));
        ctx.el('sfStaggerDecades').addEventListener('input', () => onStagger(ui));
        Object.keys(MODE_BUTTONS).forEach((mode) => {
            ctx.el(MODE_BUTTONS[mode]).addEventListener('click', () => ctx.dispatch({ type: 'setPlotMode', mode }));
        });
        ctx.el('sfResetZoom').addEventListener('click', () => {
            if (isObject(ctx.deps.plots)) ctx.deps.plots.resetZoom();
            ctx.el(MODE_BUTTONS[ctx.getState().plotMode]).focus();     // the button is disabled once the zoom is reset
        });
        ctx.el('sfUndoBtn').addEventListener('click', () => {
            if (ctx.getState().removed === null || isRunning(ctx.getState())) return;
            ctx.dispatch({ type: 'undoRemove' });
            ctx.el('sfDataWrapper').focus();                       // the strip is gone: back to the list
        });
        if (isObject(ctx.deps.plots) && typeof ctx.deps.plots.setZoomListener === 'function') {
            ctx.deps.plots.setZoomListener((zoomed) => {
                if (ui.store.get().zoomed === zoomed) return;
                ui.store.set({ zoomed });
                ctx.refresh();
            });
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            // the charts recolour themselves (ChartTheme.init); the colour samples of the list are ours
            document.addEventListener(THEME_EVENT, (event) => paintChips(ui, isObject(event.detail) ? event.detail.theme : undefined));
        }
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({ listKey: null, notice: '', loading: false, live: '', zoomed: false }) });
        bindFiles(ui);
        bindList(ui);
        bindDisplay(ui);
        return Object.freeze({ render: () => render(ui) });
    }

    globalThis.SasFitDataUi = Object.freeze({ MAX_TOTAL_POINTS, create });
})();
