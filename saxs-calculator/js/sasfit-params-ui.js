/**
 * sasfit-params-ui.js -- the model segment of the SAS fitting page and the
 * live preview of the model curve (design spec 4.10, 5.3, 5.7 items 9, 10
 * and 12, 12; plan M3 Task 12). Original code. DOM module: loaded before
 * section-sasfit.js, which calls SasFitParamsUi.create(ctx) once.
 *
 *   SasFitParamsUi.create(ctx) -> { render(), schedulePreview(), cancelPreview(), lastPreview(), previewStatus() }
 *     lastPreview()    the latest preview curve { q, I } (frozen) | null
 *     previewStatus()  { computing, paused, previewPoints, allNonFinite, error } (frozen) for the status line
 *     schedulePreview() plans a preview of the current form again; cancelPreview() drops the pending
 *     timer and returns true while an evaluation already sent is still being computed;
 *                      debounce timer (a fit is about to start)
 *
 * The form: model select with a search box, S(Q), its two modes, the low-Q
 * power law, the parameter table (SasFitHtml.paramTableHtml; value, bounds,
 * fit ticks, dispersity rows by event delegation on data-param / data-field /
 * data-action) and the formula panel for SLD parameters.
 *
 * Typing never rebuilds the table: the form is replaced, and the values,
 * field errors and error cells are updated in place. The table is rebuilt
 * only when its structure changes (model, S(Q), effective radius mode, low-Q
 * rows, a dispersity row opened / closed or its distribution, the fit lock),
 * through ctx.setHtml, which keeps the focus.
 *
 * Preview policy (plan M3, performance decisions 1-3 and decision 22):
 *   - planned whenever the form, the active dataset or its FitResult changed;
 *     both render() and previewStatus() plan, so whichever runs first in a
 *     refresh sees the current status
 *   - nothing is sent while the page section is not shown (no Worker for a
 *     visitor of the other pages), while a fit runs, while the form is
 *     invalid (the old curve stays), or while the active dataset's FitResult
 *     matches the form (its full-resolution curve is drawn instead)
 *   - debounce 150 ms, latest wins (a superseded answer is ignored);
 *     "computing" only after 300 ms without an answer
 *   - SasFitJobs.previewRequest decides about thinning and pausing; a paused
 *     preview is sent only by #sfPreviewNow
 *   - an answer whose values are all non-finite leaves the curve as it is;
 *     one with some non-finite values is drawn (the chart leaves gaps) and
 *     the status line counts them
 *   - errors go where SasFitHints.errorNotice says: the status line or
 *     #sfAlert; detail goes to console.warn; the next good answer clears both
 *
 * SECURITY: every string from the user (formula text, error text) reaches the
 * page through the SasFitHtml builders (which escape) or textContent.
 */

(function () {
    'use strict';

    const LOG = '[sasfit]';
    const DEBOUNCE_MS = 150;
    const SLOW_MS = 300;
    const SLD_DIGITS = 6;
    const SECTION_ID = 'section-sasfit';
    const SECTION_ACTIVE = 'active';
    const VOLFRACTION = 'volfraction';
    const MESH_ERROR_KEY = 'form.mesh';
    const PAGE_ERROR_ID = 'page-error';
    const TEXT_FIELDS = Object.freeze({ value: 'setValue', lower: 'setLower', upper: 'setUpper' });
    const PD_PREFIX = 'pd.';
    const PD_TEXT_KEYS = Object.freeze(['width', 'lower', 'upper', 'npts', 'nsigmas']);
    const SLD_IDS = Object.freeze({ preset: 'sfSldPreset', formula: 'sfSldFormula', density: 'sfSldDensity',
        output: 'sfSldOutput', apply: 'sfSldApply', cancel: 'sfSldCancel' });
    const NO_STATUS = Object.freeze({ computing: false, paused: false, previewPoints: 0, allNonFinite: false, error: '' });
    const TEXT = Object.freeze({
        noStructure: '此模型不能接結構因子：需要有 F(q) 與有效半徑定義的形狀模型。',
        structureGeneral: '接 S(Q) 時強度同時乘上 scale 與 volfraction；volfraction 也決定 S(Q) 的形狀。',
        structureOwnVolfraction: '接 S(Q) 時使用模型本身的 volfraction。',
        unconstrained: 'unconstrained（自行輸入 radius_effective）',
    });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isRunning = (state) => state.fit.phase === 'running';
    const metaOf = (model) => globalThis.SasFitMeta.models[model];

    /** A value that is replaced as a whole (frozen) on every change. */
    function makeStore(initial) {
        let value = Object.freeze({ ...initial });
        return Object.freeze({
            get: () => value,
            set(changes) { value = Object.freeze({ ...value, ...changes }); return value; },
        });
    }

    const setStatus = (ui, changes) => ui.store.set({ status: Object.freeze({ ...ui.store.get().status, ...changes }) });

    function activeDataset(state) {
        const file = globalThis.SasFitState.active(state);
        return file === null ? null : file.dataset;
    }

    const activeResult = (state) => (state.activeId !== null && has(state.fitResults, state.activeId) ? state.fitResults[state.activeId] : null);

    /** The page section is the one on screen (an element that is not there counts as shown). */
    function sectionShown(ctx) {
        const section = ctx.el(SECTION_ID);
        return !section || !isObject(section.classList) || section.classList.contains(SECTION_ACTIVE);
    }

    // ------------------------------------------------------------- page alert

    function showPageAlert(ctx, text) {
        ctx.setHtml(ctx.el('sfAlert'), globalThis.SasFitHtml.hintsHtml([{ id: PAGE_ERROR_ID, tone: 'error', text }]));
    }

    const clearPageAlert = (ctx) => ctx.setHtml(ctx.el('sfAlert'), '');

    // ------------------------------------------------------------- preview

    function clearTimer(ui, key) {
        const id = ui.store.get()[key];
        if (id === null) return;
        ui.ctx.deps.timers.clearTimeout(id);
        ui.store.set({ [key]: null });
    }

    function countFinite(values) {
        let count = 0;
        for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) count += 1;
        return count;
    }

    function onCurve(ui, seq, request, result) {
        if (seq !== ui.store.get().seq) return;                 // a newer plan took over
        clearTimer(ui, 'slowTimer');
        const drawable = isObject(result) && isObject(result.I) && countFinite(result.I) > 0;
        if (drawable) ui.store.set({ curve: Object.freeze({ q: request.q, I: result.I }) });
        setStatus(ui, {
            computing: false, error: '', allNonFinite: !drawable,
            previewPoints: drawable ? (request.decimated ? request.q.length : 0) : ui.store.get().status.previewPoints,
        });
        clearPageAlert(ui.ctx);
        ui.ctx.refresh();
    }

    function onError(ui, seq, err) {
        if (seq !== ui.store.get().seq) return;
        clearTimer(ui, 'slowTimer');
        const notice = globalThis.SasFitHints.errorNotice(err, 'preview');
        setStatus(ui, { computing: false });
        if (notice.where !== 'ignore') {
            if (notice.detail !== '') console.warn(LOG + ' ' + notice.detail);
            if (notice.where === 'preview') setStatus(ui, { error: notice.text });
            else showPageAlert(ui.ctx, notice.text);
        }
        ui.ctx.refresh();
    }

    function onSlow(ui, seq) {
        ui.store.set({ slowTimer: null });
        if (seq !== ui.store.get().seq) return;
        setStatus(ui, { computing: true });
        ui.ctx.refresh();
    }

    /** Send the preview of the current form now (the debounce is over, or the user asked for it). */
    function send(ui) {
        const { ctx, store } = ui;
        clearTimer(ui, 'timer');
        clearTimer(ui, 'slowTimer');
        const state = ctx.getState();
        const form = ctx.getForm();
        if (isRunning(state) || !globalThis.SasFitForm.validate(form).valid) return;
        const request = globalThis.SasFitJobs.previewRequest(form, activeDataset(state));
        const seq = store.get().seq + 1;
        store.set({ seq, inFlight: seq, slowTimer: ctx.deps.timers.setTimeout(() => onSlow(ui, seq), SLOW_MS) });
        const landed = () => { if (store.get().inFlight === seq) store.set({ inFlight: null }); };
        try {
            ctx.client.evaluate({ modelSpec: request.modelSpec, params: request.params, q: request.q, opts: request.opts })
                .then((result) => { landed(); onCurve(ui, seq, request, result); }, (err) => { landed(); onError(ui, seq, err); })
                .catch((err) => console.error(LOG + ' 處理預覽結果時發生未預期的錯誤', err));
        } catch (err) {
            landed();
            onError(ui, seq, err);                                // the client could not be created
        }
    }

    /** What to do about the preview of a form that just changed. */
    function decide(ui, form, dataset, result) {
        const { store } = ui;
        clearTimer(ui, 'timer');
        clearTimer(ui, 'slowTimer');
        store.set({ seq: store.get().seq + 1 });                  // an answer still on its way belongs to an older form
        if (result !== null && globalThis.SasFitJobs.resultMatchesForm(form, result)) {
            setStatus(ui, { ...NO_STATUS });                      // the FitResult's own curve is drawn
            return;
        }
        if (!globalThis.SasFitForm.validate(form).valid) {
            setStatus(ui, { computing: false, paused: false });   // field errors say why; the old curve stays
            return;
        }
        const paused = globalThis.SasFitJobs.previewRequest(form, dataset).paused;
        setStatus(ui, { computing: false, paused });
        if (!paused) store.set({ timer: ui.ctx.deps.timers.setTimeout(() => send(ui), DEBOUNCE_MS) });
    }

    /** Plan a preview when the form, the active dataset or its FitResult is not the one planned for. */
    function plan(ui) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        if (isRunning(state) || !sectionShown(ctx)) return;
        const form = ctx.getForm();
        const dataset = activeDataset(state);
        const result = activeResult(state);
        const { planned } = store.get();
        if (planned !== null && planned.form === form && planned.dataset === dataset && planned.result === result) return;
        store.set({ planned: Object.freeze({ form, dataset, result }) });
        decide(ui, form, dataset, result);
    }

    /**
     * Drops the preview that is still waiting for its timer. One that was already sent cannot be taken back (the
     * Worker computes it to the end; stopping it would throw away the loaded wasm): returns true in that case, so
     * that the caller can say a fit started now first waits for it.
     */
    function cancelPreview(ui) {
        const inFlight = ui.store.get().inFlight !== null;
        if (ui.store.get().timer === null) return inFlight;
        clearTimer(ui, 'timer');
        ui.store.set({ planned: null });                          // not sent: plan again once the fit is over
        return inFlight;
    }

    function schedulePreview(ui) {
        ui.store.set({ planned: null });
        plan(ui);
    }

    // ------------------------------------------------------------- model, S(Q), low-Q

    function renderModelPick(ui, form, locked) {
        const { ctx } = ui;
        const html = globalThis.SasFitHtml;
        const select = ctx.el('sfModel');
        ctx.setHtml(select, html.modelOptionsHtml(globalThis.SasFitForm.models(ui.store.get().query, form.model), form.model));
        if (select.value !== form.model) select.value = form.model;
        select.disabled = locked;
        ctx.el('sfModelSearch').disabled = locked;
        ctx.setHtml(ctx.el('sfModelInfo'), html.modelInfoHtml(metaOf(form.model)));
    }

    function structureNote(form, capable) {
        if (!capable) return TEXT.noStructure;
        if (form.structure === null) return '';
        return metaOf(form.model).params.some((p) => p.name === VOLFRACTION) ? TEXT.structureOwnVolfraction : TEXT.structureGeneral;
    }

    function modelHints(form) {
        const { errors } = globalThis.SasFitForm.validate(form);
        const hints = globalThis.SasFitHints.preFitHints({ modelSpec: globalThis.SasFitJobs.modelSpec(form) });
        return has(errors, MESH_ERROR_KEY) ? hints.concat([{ id: 'mesh', tone: 'error', text: errors[MESH_ERROR_KEY] }]) : hints;
    }

    function setValue(element, value) {
        if (element.value !== value) element.value = value;
    }

    function renderStructure(ui, form, locked) {
        const { ctx } = ui;
        const capable = globalThis.SasFitForm.canTakeStructure(form.model);
        const structure = ctx.el('sfStructure');
        setValue(structure, form.structure === null ? '' : form.structure);
        structure.disabled = locked || !capable;
        const note = ctx.el('sfStructureNote');
        note.textContent = structureNote(form, capable);
        note.hidden = note.textContent === '';
        ctx.el('sfStructureOptions').hidden = form.structure === null;
        const modes = [{ value: 0, label: TEXT.unconstrained }]
            .concat(metaOf(form.model).reffModes.map((label, i) => ({ value: i + 1, label })));
        const radius = ctx.el('sfRadiusMode');
        ctx.setHtml(radius, globalThis.SasFitHtml.optionsHtml(modes, form.radiusMode));
        setValue(radius, String(form.radiusMode));
        setValue(ctx.el('sfStructureMode'), String(form.structureMode));
        radius.disabled = locked;
        ctx.el('sfStructureMode').disabled = locked;
        const lowQ = ctx.el('sfLowQ');
        if (lowQ.checked !== form.lowQ) lowQ.checked = form.lowQ;
        lowQ.disabled = locked;
        ctx.setHtml(ctx.el('sfModelHints'), globalThis.SasFitHtml.hintsHtml(modelHints(form)));
    }

    // ------------------------------------------------------------- parameter table

    /** What decides the rows and controls of the table; while it stays the same the table is updated in place. */
    function tableKey(form, locked, absolute) {
        return JSON.stringify([form.model, form.structure, form.radiusMode, form.lowQ, locked, absolute,
            Object.keys(form.pds).map((name) => [name, form.pds[name].open, form.pds[name].type])]);
    }

    function syncField(ctx, name, field, value, error) {
        const html = globalThis.SasFitHtml;
        const input = ctx.el(html.paramFieldId(name, field));
        if (!input) return;
        setValue(input, value);
        const message = typeof error === 'string' ? error : '';
        const note = ctx.el(html.paramErrorId(name, field));
        if (note) {
            if (note.textContent !== message) note.textContent = message;
            note.hidden = message === '';
        }
        if (message === '') input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true');
    }

    function syncCheck(ctx, name, field, checked) {
        const box = ctx.el(globalThis.SasFitHtml.paramFieldId(name, field));
        if (box && box.checked !== checked) box.checked = checked;
    }

    function syncRow(ctx, row) {
        if (row.fittable) syncCheck(ctx, row.name, 'fit', row.fit);
        Object.keys(TEXT_FIELDS).forEach((field) => syncField(ctx, row.name, field, row[field], row.errors[field]));
        if (row.pd === null || !row.pd.open) return;
        syncCheck(ctx, row.name, 'pd.fit', row.pd.fit);
        PD_TEXT_KEYS.forEach((key) => syncField(ctx, row.name, PD_PREFIX + key, row.pd[key], row.pd.errors[key]));
    }

    function renderTable(ui, state, form, locked) {
        const { ctx, store } = ui;
        const html = globalThis.SasFitHtml;
        const result = activeResult(state);
        const active = globalThis.SasFitState.active(state);
        const absolute = active !== null && active.dataset.kind === 'official';      // background is then in 1/cm
        const resultCtx = {
            fitResult: result, matches: result !== null && globalThis.SasFitJobs.resultMatchesForm(form, result), locked, absolute,
        };
        const rows = globalThis.SasFitForm.rows(form);
        ctx.setHtml(ctx.el('sfParamHead'), html.paramTableHeadHtml(resultCtx));
        const key = tableKey(form, locked, absolute);
        if (key !== store.get().tableKey) {
            ctx.setHtml(ctx.el('sfParamBody'), html.paramTableHtml(rows, resultCtx));
            store.set({ tableKey: key });
            return;
        }
        rows.forEach((row) => syncRow(ctx, row));
        html.paramErrorCells(rows, resultCtx).forEach((cell) => {
            const element = ctx.el(cell.id);
            if (element && element.textContent !== cell.text) element.textContent = cell.text;
        });
    }

    function render(ui) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        const form = ctx.getForm();
        const locked = isRunning(state);
        const { sld } = store.get();
        if (sld !== null && (locked || !has(form.fields, sld.target))) closeSld(ui);
        plan(ui);
        renderModelPick(ui, form, locked);
        renderStructure(ui, form, locked);
        renderTable(ui, state, form, locked);
        ctx.el('sfPreviewNow').hidden = locked || !store.get().status.paused;
    }

    // ------------------------------------------------------------- form events

    /** Replace the form by reduce(form, action) and redraw; a refused action is a bug and is logged. */
    function applyAction(ui, action) {
        const { ctx } = ui;
        if (isRunning(ctx.getState())) return;
        try {
            ctx.setForm(globalThis.SasFitForm.reduce(ctx.getForm(), action));
        } catch (err) {
            console.error(LOG + ' 表單動作失敗：' + action.type, err);
        }
        ctx.refresh();
    }

    function fieldAction(name, field, target) {
        if (has(TEXT_FIELDS, field)) return { type: TEXT_FIELDS[field], name, value: String(target.value) };
        if (field === 'fit') return { type: 'setFit', name, fit: target.checked === true };
        if (field === 'pd.fit') return { type: 'setPdFit', name, fit: target.checked === true };
        if (field.indexOf(PD_PREFIX) !== 0) return null;
        return { type: 'setPdField', name, field: field.slice(PD_PREFIX.length), value: String(target.value) };
    }

    const isTextField = (field) => has(TEXT_FIELDS, field) || PD_TEXT_KEYS.indexOf(field.slice(PD_PREFIX.length)) >= 0;
    const closestWith = (event, attribute) => (typeof event.target.closest === 'function' ? event.target.closest('[' + attribute + ']') : null);

    function onTableEdit(ui, event, textFields) {
        const target = closestWith(event, 'data-field');
        if (target === null) return;
        const { param, field } = target.dataset;
        if (isTextField(field) !== textFields) return;            // text fields answer to input, ticks and selects to change
        const action = fieldAction(param, field, target);
        if (action !== null) applyAction(ui, action);
    }

    function onTableClick(ui, event) {
        const target = closestWith(event, 'data-action');
        if (target === null || isRunning(ui.ctx.getState())) return;
        const { action, param } = target.dataset;
        if (action === 'togglePd') applyAction(ui, { type: 'togglePd', name: param });
        else if (action === 'sld') openSld(ui, param, target.id);
    }

    function bindForm(ui) {
        const { ctx } = ui;
        ctx.el('sfModelSearch').addEventListener('input', (event) => {
            ui.store.set({ query: String(event.target.value) });
            renderModelPick(ui, ctx.getForm(), isRunning(ctx.getState()));       // the form does not change: no preview
        });
        ctx.el('sfModel').addEventListener('change', (event) => {
            if (event.target.value !== ctx.getForm().model) applyAction(ui, { type: 'setModel', model: event.target.value });
        });
        ctx.el('sfStructure').addEventListener('change', (event) => {
            applyAction(ui, { type: 'setStructure', structure: event.target.value === '' ? null : event.target.value });
        });
        ctx.el('sfStructureMode').addEventListener('change', (event) => applyAction(ui, { type: 'setStructureMode', mode: Number(event.target.value) }));
        ctx.el('sfRadiusMode').addEventListener('change', (event) => applyAction(ui, { type: 'setRadiusMode', mode: Number(event.target.value) }));
        ctx.el('sfLowQ').addEventListener('change', (event) => applyAction(ui, { type: 'setLowQ', on: event.target.checked === true }));
        const body = ctx.el('sfParamBody');
        body.addEventListener('input', (event) => onTableEdit(ui, event, true));
        body.addEventListener('change', (event) => onTableEdit(ui, event, false));
        body.addEventListener('click', (event) => onTableClick(ui, event));
        ctx.el('sfPreviewNow').addEventListener('click', () => send(ui));
    }

    /** The section becomes the one on screen by a click in the sidebar: plan the first preview then. */
    function bindSection(ui) {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
        document.addEventListener('click', () => {
            if (ui.store.get().planned === null && sectionShown(ui.ctx) && !isRunning(ui.ctx.getState())) ui.ctx.refresh();
        });
    }

    // ------------------------------------------------------------- SLD panel (design spec 4.7)

    /** { result, error, ready } of what is typed: the composition shows as soon as the formula parses. */
    function computeSld(formula, density) {
        const sld = globalThis.SasFitSld;
        if (formula.trim() === '') return { result: null, error: null, ready: false };
        try {
            if (density.trim() === '') return { result: { atoms: sld.parseFormula(formula).atoms, sld: NaN, electronDensity: NaN }, error: null, ready: false };
            const result = sld.compute(formula, sld.parseDensity(density));       // strict: no 0x10, no value that overflows
            return { result, error: null, ready: Number.isFinite(result.sld) };
        } catch (err) {
            return { result: null, error: err instanceof Error ? err : new Error(String(err)), ready: false };
        }
    }

    function sldView(sld) {
        const computed = computeSld(sld.formula, sld.density);
        return { view: { target: sld.target, formula: sld.formula, density: sld.density, presetId: sld.presetId,
            result: computed.result, error: computed.error }, computed };
    }

    function markInvalid(element, invalid) {
        if (!element) return;
        if (invalid) element.setAttribute('aria-invalid', 'true'); else element.removeAttribute('aria-invalid');
    }

    /** Draw the panel: everything (the inputs included) or only its output while the user is typing. */
    function renderSld(ui, whole) {
        const { ctx, store } = ui;
        const { sld } = store.get();
        const { view, computed } = sldView(sld);
        const html = globalThis.SasFitHtml;
        if (whole) ctx.setHtml(ctx.el('sfSldPanel'), html.sldPanelHtml(view));
        else ctx.setHtml(ctx.el(SLD_IDS.output), html.sldOutputHtml(view));
        const densityBad = computed.error !== null && computed.error.code === 'bad_density';
        markInvalid(ctx.el(SLD_IDS.formula), computed.error !== null && !densityBad);
        markInvalid(ctx.el(SLD_IDS.density), densityBad);
        const apply = ctx.el(SLD_IDS.apply);
        if (apply) apply.disabled = !computed.ready;
        store.set({ sld: Object.freeze({ ...sld, value: computed.ready ? computed.result.sld : null }) });
    }

    function focusOn(ctx, id) {
        const element = ctx.el(id);
        if (element && typeof element.focus === 'function') element.focus();
    }

    function openSld(ui, target, triggerId) {
        const { ctx, store } = ui;
        store.set({ sld: Object.freeze({ target, triggerId, formula: '', density: '', presetId: '', value: null }) });
        ctx.el('sfSldPanel').hidden = false;
        renderSld(ui, true);
        focusOn(ctx, SLD_IDS.preset);
    }

    function closeSld(ui) {
        const { ctx, store } = ui;
        store.set({ sld: null });
        ctx.setHtml(ctx.el('sfSldPanel'), '');
        ctx.el('sfSldPanel').hidden = true;
    }

    function applySld(ui) {
        const { ctx, store } = ui;
        const { sld } = store.get();
        if (sld === null || sld.value === null) return;
        const value = String(Number(sld.value.toPrecision(SLD_DIGITS)));
        closeSld(ui);
        applyAction(ui, { type: 'setValue', name: sld.target, value });
        focusOn(ctx, globalThis.SasFitHtml.paramFieldId(sld.target, 'value'));
    }

    function cancelSld(ui) {
        const { sld } = ui.store.get();
        if (sld === null) return;
        closeSld(ui);
        focusOn(ui.ctx, sld.triggerId);
    }

    function onSldPreset(ui, presetId) {
        const { sld } = ui.store.get();
        const preset = globalThis.SasFitSld.PRESETS.find((p) => p.id === presetId);
        ui.store.set({ sld: Object.freeze(preset === undefined ? { ...sld, presetId: '' }
            : { ...sld, presetId: preset.id, formula: preset.formula, density: String(preset.density) }) });
        renderSld(ui, true);
    }

    function onSldInput(ui, target) {
        const { ctx, store } = ui;
        const { sld } = store.get();
        const key = target.id === SLD_IDS.formula ? 'formula' : target.id === SLD_IDS.density ? 'density' : null;
        if (key === null) return;
        store.set({ sld: Object.freeze({ ...sld, [key]: String(target.value), presetId: '' }) });   // no longer the preset's values
        const preset = ctx.el(SLD_IDS.preset);
        if (preset) setValue(preset, '');
        renderSld(ui, false);
    }

    function bindSld(ui) {
        const panel = ui.ctx.el('sfSldPanel');
        panel.addEventListener('input', (event) => { if (ui.store.get().sld !== null) onSldInput(ui, event.target); });
        panel.addEventListener('change', (event) => {
            if (ui.store.get().sld !== null && event.target.id === SLD_IDS.preset) onSldPreset(ui, event.target.value);
        });
        panel.addEventListener('click', (event) => {
            if (event.target.id === SLD_IDS.apply) applySld(ui);
            else if (event.target.id === SLD_IDS.cancel) cancelSld(ui);
        });
        panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') cancelSld(ui); });
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({
            tableKey: null, query: '', sld: null, curve: null, status: NO_STATUS, planned: null, timer: null, slowTimer: null, seq: 0, inFlight: null,
        }) });
        bindForm(ui);
        bindSld(ui);
        bindSection(ui);
        return Object.freeze({
            render: () => render(ui),
            schedulePreview: () => schedulePreview(ui),
            cancelPreview: () => cancelPreview(ui),
            lastPreview: () => ui.store.get().curve,
            previewStatus: () => { plan(ui); return ui.store.get().status; },
        });
    }

    globalThis.SasFitParamsUi = Object.freeze({ create });
})();
