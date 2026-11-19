/**
 * sasfit-export-ui.js -- the export buttons of the SAS fitting page: the
 * fit-curve CSV, the report TXT, the sequence CSV, the PNG of every chart and
 * of the 3D sketch, and "send to the IUCr table" (design spec 8, 9; plan M4
 * Tasks 15 and 17). Original code.
 *
 * A segment module of section-sasfit.js (key 'export'; it is not a tab). It
 * only wires: every string comes from the pure builders (SasFitExport,
 * SasFitReport), every file name from SasFitExport.fileName.
 *
 *   SasFitExportUi.create(ctx) -> { render() }
 *       render() enables each button when there is something to export and
 *       says why not otherwise: for the two buttons of the fit segment in
 *       #sfExportNote, for the others (they sit elsewhere) in their title.
 *       A result that no longer matches the parameter table CAN be exported --
 *       it is the record of that fit -- and #sfExportNote says so.
 *   SasFitExportUi.download(blob, fileName, timers?)
 *       the page's own download (ctx.deps.download defaults to it): an object
 *       URL on an <a download rel="noopener" hidden> that is put into the
 *       document, clicked, and removed with its URL revoked in the next timer
 *       tick (revoking at once can cancel the download). It throws what the
 *       platform throws and leaves no node behind.
 *
 * What is exported
 *   #sfExportCsv / #sfExportTxt   the result of the fit target, whatever the
 *       form says now: the model of the file name and the rows of the report
 *       come from the FitResult. Bounds are not part of a FitResult: they are
 *       read from the form while its model spec is the result's, else the
 *       report says they were not recorded.
 *   #sfSeqCsv                     the last sequence run (SasFitReport.sequenceCsv)
 *   #sfMainPng / #sfResidualPng / #sfSeqTrendPng
 *       ChartTheme.exportPng (always light on white) gives a data: URL; its
 *       bytes are decoded by SasFitExport.dataUrlBytes and wrapped in a Blob.
 *       Nothing here asks the network layer for a data: or blob: URL -- the
 *       page's connect-src refuses both.
 *   #sfShapePng                   ctx.shape.exportBlob() of the 3D sketch
 *   #sfSendIucr                   not a file: SasFitIucr.data of the fit target's result goes to
 *       ctx.deps.sendIucr (the IUCr table page's setIUCrModelFit) as a NEW frozen object on every
 *       click. It is enabled only while SasFitIucr.canSend says so (converged, not blocked, still
 *       the parameters on the page) and no fit runs; #sfSendIucrNote says why not, or that it was
 *       sent. The table keeps what was sent: editing a parameter afterwards changes only the note.
 * Text files start with a BOM (Excel then reads UTF-8).
 *
 * ctx.deps used here: download(blob, fileName), now() -> ms, version() -> the
 * page version (the ?v= of the scripts) or null, plots.getChart(id),
 * sendIucr(data).
 *
 * Every failure is caught: the message goes to #sfExportNote (textContent)
 * and the detail to console.warn; the rest of the page is not affected.
 * Nothing here touches document while the file loads.
 */

(function () {
    'use strict';

    const BOM = '\uFEFF';
    const CSV_TYPE = 'text/csv;charset=utf-8';
    const TXT_TYPE = 'text/plain;charset=utf-8';
    const STOPPED = 'stopped';
    const LOG = '[sasfit]';
    const NOTE_ID = 'sfExportNote';
    const SEND_NOTE_ID = 'sfSendIucrNote';
    const CHARTS = Object.freeze({
        sfMainPng: Object.freeze({ chart: 'sfMainChart', kind: 'png-main' }),
        sfResidualPng: Object.freeze({ chart: 'sfResidualChart', kind: 'png-residual' }),
        sfSeqTrendPng: Object.freeze({ chart: 'sfSeqTrend', kind: 'png-trend' }),
    });
    const TEXT = Object.freeze({
        noData: '請先載入資料並完成擬合',
        noResult: '尚無擬合結果可匯出',
        running: '擬合進行中，結束後才能匯出',
        stale: '匯出的是上一次擬合的結果；之後改過的參數不在其中',
        noChart: '尚無圖可匯出',
        noResidual: '尚無擬合結果，沒有殘差圖',
        noTrend: '尚無趨勢圖',
        noSequence: '尚無序列擬合的結果',
        noVersion: '讀不到頁面版本（腳本網址沒有 ?v=），無法寫入軟體版本；請重新整理頁面',
        notShape: '切到「結構」檢視且模型有固定形狀時才能匯出',
        sendRunning: '擬合進行中，結束後才能送出',
        sent: (name) => '已送進 IUCr 表格（' + name + '）；再次送出會取代它',
        sendFailed: (message) => '送出失敗：' + message,
        done: (name) => '已下載 ' + name,
        failed: (message) => '匯出失敗：' + message,
    });

    const host = () => (typeof window !== 'undefined' ? window : globalThis);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';

    function makeStore(initial) {
        let value = Object.freeze({ ...initial });
        return Object.freeze({ get: () => value, set(changes) { value = Object.freeze({ ...value, ...changes }); } });
    }

    // ------------------------------------------------------------- download

    function download(blob, fileName, timers) {
        const global = host();
        const later = isObject(timers) && typeof timers.setTimeout === 'function' ? timers.setTimeout : (fn, ms) => global.setTimeout(fn, ms);
        const url = global.URL.createObjectURL(blob);
        const link = document.createElement('a');
        const release = () => {
            link.remove();
            global.URL.revokeObjectURL(url);
        };
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.setAttribute('rel', 'noopener');
        link.hidden = true;
        try {
            document.body.appendChild(link);
            link.click();
        } catch (err) {
            release();
            throw err;
        }
        later(release, 0);
    }

    // ------------------------------------------------------------- what there is to export

    const activeFile = (state) => globalThis.SasFitState.active(state);

    function activeResult(state) {
        const result = state.activeId !== null && has(state.fitResults, state.activeId) ? state.fitResults[state.activeId] : null;
        return result !== null && result.status !== STOPPED ? result : null;
    }

    const isRunning = (state) => state.fit.phase === 'running';

    function sameSpec(form, fitResult) {
        const mine = globalThis.SasFitJobs.modelSpec(form);
        const theirs = fitResult.settings.modelSpec;
        return Object.keys(mine).every((key) => mine[key] === theirs[key]);
    }

    /** A bound of the form as a number: empty is open, anything unreadable is "not recorded". */
    function boundOf(text, open) {
        if (typeof text !== 'string') return null;
        if (text.trim() === '') return open;
        const value = globalThis.SasFitForm.parseNumber(text);
        return value === undefined ? null : value;
    }

    /** { name: [lower, upper] } of the form while its model spec is the result's, else null. */
    function boundsOf(form, fitResult) {
        if (!sameSpec(form, fitResult)) return null;
        const entries = [];
        globalThis.SasFitForm.rows(form).forEach((row) => {
            if (row.fittable) entries.push([row.name, [boundOf(row.lower, -Infinity), boundOf(row.upper, Infinity)]]);
            if (row.pd !== null && row.pd.open) entries.push([row.name + '_pd', [boundOf(row.pd.lower, -Infinity), boundOf(row.pd.upper, Infinity)]]);
        });
        return Object.fromEntries(entries);
    }

    function softwareOf(ctx) {
        const version = ctx.deps.version();
        if (typeof version !== 'string' || version === '') throw new Error(TEXT.noVersion);
        return globalThis.SasFitExport.software(version);
    }

    /** Whether the last sequence run has a finished row. */
    function hasSequence(state) {
        const { seq } = state;
        return Array.isArray(seq.order) && seq.order.some((id) => has(seq.rows, id) && seq.rows[id].state === 'done');
    }

    function shapeAvailable(ctx) {
        return ctx.getState().plotView === 'shape' && globalThis.SasFitShapeGeom.hasShape(ctx.getForm().model);
    }

    // ------------------------------------------------------------- the builders of each file

    function fitCsvFile(ctx) {
        const state = ctx.getState();
        const file = activeFile(state);
        const fitResult = activeResult(state);
        const exporter = globalThis.SasFitExport;
        return {
            name: exporter.fileName('fit', { dataName: file.fileName, modelSpec: fitResult.settings.modelSpec }),
            blob: new Blob([BOM + exporter.fitCsv({ file, fitResult, software: softwareOf(ctx) })], { type: CSV_TYPE }),
        };
    }

    function reportFile(ctx) {
        const state = ctx.getState();
        const form = ctx.getForm();
        const file = activeFile(state);
        const fitResult = activeResult(state);
        const text = globalThis.SasFitReport.reportTxt({
            file, fitResult, bounds: boundsOf(form, fitResult), software: softwareOf(ctx),
            generatedAt: new Date(ctx.deps.now()).toISOString(), conditionName: state.conditionName,
            matchesForm: globalThis.SasFitJobs.resultMatchesForm(form, fitResult),
        });
        return {
            name: globalThis.SasFitExport.fileName('report', { dataName: file.fileName, modelSpec: fitResult.settings.modelSpec }),
            blob: new Blob([BOM + text], { type: TXT_TYPE }),
        };
    }

    function sequenceFile(ctx) {
        const state = ctx.getState();
        return {
            name: globalThis.SasFitExport.fileName('sequence', { conditionName: state.conditionName }),
            blob: new Blob([BOM + globalThis.SasFitReport.sequenceCsv({ state, software: softwareOf(ctx) })], { type: CSV_TYPE }),
        };
    }

    /** What the names of the PNG files are made of: the fit target and the model on the page. */
    function nameInfo(ctx) {
        const state = ctx.getState();
        const file = activeFile(state);
        return {
            dataName: file === null ? '' : file.fileName, modelSpec: globalThis.SasFitJobs.modelSpec(ctx.getForm()),
            conditionName: state.conditionName,
        };
    }

    /** The PNG of a chart, or null while the chart does not exist. */
    function chartFile(ctx, { chart: chartId, kind }) {
        const plots = ctx.deps.plots;
        const chart = isObject(plots) && typeof plots.getChart === 'function' ? plots.getChart(chartId) : null;
        if (!chart) return null;
        const exporter = globalThis.SasFitExport;
        const { mime, bytes } = exporter.dataUrlBytes(host().ChartTheme.exportPng(chart));
        return { name: exporter.fileName(kind, nameInfo(ctx)), blob: new Blob([bytes], { type: mime }) };
    }

    // ------------------------------------------------------------- actions

    function say(ui, text) {
        ui.store.set({ message: text, messageFor: ui.ctx.getState() });
        ui.ctx.el(NOTE_ID).textContent = text;
    }

    function fail(ui, err) {
        console.warn(LOG + ' 匯出失敗', err);
        say(ui, TEXT.failed(err instanceof Error ? err.message : String(err)));
    }

    /** Hands a built file to the download; null means there was nothing to draw. */
    function deliver(ui, file) {
        if (file === null) {
            say(ui, TEXT.noChart);
            return;
        }
        ui.ctx.deps.download(file.blob, file.name);
        say(ui, TEXT.done(file.name));
    }

    /** A click handler that builds a file and downloads it; nothing it throws leaves this module. */
    function exporting(ui, build) {
        return () => {
            try {
                deliver(ui, build(ui.ctx));
            } catch (err) {
                fail(ui, err);
            }
        };
    }

    function exportShape(ui) {
        const { ctx } = ui;
        let pending;
        try {
            pending = Promise.resolve(ctx.shape.exportBlob());
        } catch (err) {
            pending = Promise.reject(err);
        }
        pending.then((blob) => deliver(ui, blob ? { blob, name: globalThis.SasFitExport.fileName('png-shape', nameInfo(ctx)) } : null))
            .catch((err) => fail(ui, err));
    }

    // ------------------------------------------------------------- render

    /** Disabled with the reason as its title, or enabled without one. */
    function setButton(ctx, id, reason) {
        const button = ctx.el(id);
        button.disabled = reason !== '';
        if (reason === '') button.removeAttribute('title');
        else button.setAttribute('title', reason);
    }

    /** Why the fit cannot be exported ('' when it can) and the note under the buttons. */
    function fitExportState(ctx) {
        const state = ctx.getState();
        if (isRunning(state)) return { reason: TEXT.running, note: TEXT.running };
        if (activeFile(state) === null) return { reason: TEXT.noData, note: TEXT.noData };
        const result = activeResult(state);
        if (result === null) return { reason: TEXT.noResult, note: TEXT.noResult };
        return { reason: '', note: globalThis.SasFitJobs.resultMatchesForm(ctx.getForm(), result) ? '' : TEXT.stale };
    }

    /** Why the result cannot go to the IUCr table ('' when it can). */
    function sendReason(ctx, state) {
        if (isRunning(state)) return TEXT.sendRunning;
        return globalThis.SasFitIucr.canSend(ctx.getForm(), activeResult(state)).reason;
    }

    function renderSend(ui, state) {
        const { ctx, store } = ui;
        const reason = sendReason(ctx, state);
        ctx.el('sfSendIucr').disabled = reason !== '';
        // "sent" stays while nothing changed since; a changed parameter brings the reason back (the table keeps its snapshot)
        const { sent, sentState, sentForm } = store.get();
        const kept = reason === '' && sentState === state && sentForm === ctx.getForm() ? sent : '';
        const note = kept !== '' ? kept : reason;
        if (ctx.el(SEND_NOTE_ID).textContent !== note) ctx.el(SEND_NOTE_ID).textContent = note;
    }

    /** Sends the result of the fit target to the IUCr table page as a new frozen object; nothing it throws leaves this module. */
    function sendIucr(ui) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        const form = ctx.getForm();
        try {
            const file = activeFile(state);
            const version = ctx.deps.version();
            if (typeof version !== 'string' || version === '') throw new Error(TEXT.noVersion);
            const data = globalThis.SasFitIucr.data({
                fileName: file === null ? '' : file.fileName, fitResult: activeResult(state), form, version,
                absolute: file !== null && file.dataset.kind === 'official',
            });
            ctx.deps.sendIucr(data);
            store.set({ sent: TEXT.sent(data.datasetName), sentState: state, sentForm: form });
            ctx.el(SEND_NOTE_ID).textContent = store.get().sent;
            ctx.el('sfSendIucr').focus();
        } catch (err) {
            console.warn(LOG + ' 送進 IUCr 表格失敗', err);
            ctx.el(SEND_NOTE_ID).textContent = TEXT.sendFailed(err instanceof Error ? err.message : String(err));
        }
    }

    function render(ui) {
        const { ctx, store } = ui;
        const state = ctx.getState();
        const fit = fitExportState(ctx);
        ['sfExportCsv', 'sfExportTxt'].forEach((id) => { ctx.el(id).disabled = fit.reason !== ''; });
        setButton(ctx, 'sfSeqCsv', isRunning(state) ? TEXT.running : (hasSequence(state) ? '' : TEXT.noSequence));
        setButton(ctx, 'sfResidualPng', ctx.el('sfResidualBox').hidden ? TEXT.noResidual : '');
        setButton(ctx, 'sfSeqTrendPng', ctx.el('sfSeqTrendBox').hidden ? TEXT.noTrend : '');
        setButton(ctx, 'sfShapePng', shapeAvailable(ctx) ? '' : TEXT.notShape);
        setButton(ctx, 'sfMainPng', '');
        renderSend(ui, state);
        // what the last click said stays until the page state changes; then the note describes the state again
        const kept = store.get().messageFor === state ? store.get().message : '';
        const note = kept !== '' ? kept : fit.note;
        if (ctx.el(NOTE_ID).textContent !== note) ctx.el(NOTE_ID).textContent = note;
    }

    function bind(ui) {
        const { ctx } = ui;
        ctx.el('sfExportCsv').addEventListener('click', exporting(ui, fitCsvFile));
        ctx.el('sfExportTxt').addEventListener('click', exporting(ui, reportFile));
        ctx.el('sfSeqCsv').addEventListener('click', exporting(ui, sequenceFile));
        Object.keys(CHARTS).forEach((id) => ctx.el(id).addEventListener('click', exporting(ui, (context) => chartFile(context, CHARTS[id]))));
        ctx.el('sfShapePng').addEventListener('click', () => exportShape(ui));
        ctx.el('sfSendIucr').addEventListener('click', () => sendIucr(ui));
    }

    function create(ctx) {
        const ui = Object.freeze({ ctx, store: makeStore({ message: '', messageFor: null, sent: '', sentState: null, sentForm: null }) });
        bind(ui);
        return Object.freeze({ render: () => render(ui) });
    }

    globalThis.SasFitExportUi = Object.freeze({ create, download });
})();
