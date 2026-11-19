'use strict';
/**
 * M4（3D 結構示意、序列、匯出）DOM 測試共用的假相依，建立在 tests/sasfit-ui-helpers.js 的 stub DOM 之上。
 *
 *   fakeContext()   假的 2D context：calls 是 { name, args, style }（style＝呼叫當下的樣式）
 *   fakeFrames()    假的 requestAnimationFrame：raf／cancelRaf、flush(time) 執行目前排著的回呼、pending()、
 *                   requested／cancelled 計數
 *   shapePage(options) 一份啟動好的頁面，3D 需要的相依都已注入：
 *                   frames、observers（observeResize 的 { element, fn }）、canvases（createCanvas 建的假畫布）、
 *                   media（matchMedia('(prefers-reduced-motion: reduce)') 回傳的同一個物件；options.reducedMotion
 *                   決定 matches；其他查詢回傳另一個物件，options.coarse 決定它的 matches）、
 *                   captures（舞台目前捕捉中的 pointerId）、
 *                   windowListeners（window.addEventListener 收到的 { type: [fn] }）、
 *                   context／canvas／stage（畫面上的畫布與舞台；stage 的 CSS 尺寸預設 575×414）、
 *                   segment（SasFitShape3d.create 的回傳）、creates()（create 被呼叫的次數）、
 *                   paints()（畫面上的畫布被重畫的次數）、builds()（SasFitShapeGeom.build 被呼叫的次數）
 *   restore()       還原本檔動過的全域（window 上的假函式、SasFitShapeGeom 的包裝）
 *
 * 序列擬合（M4 Task 8–12）：
 *   seqDatasets()   三個合成檔 SYNTH_sphere_{10,20,30}.dat 的 Dataset（SasFitDataIo.parse；條件值 10／20／30）
 *   seqFiles(conditions?)  同三個檔的 state.files 項目（id d1–d3；conditions 可覆寫條件值）
 *   sphereForm(ticks?)     sphere 表單，勾選擬合 ticks（預設 scale、background 之外再加 radius）
 *   fakeResult({ job?, status, values, errors, chi2r, weighting, ... })  完整的 FitResult（鍵與
 *                   SasFitWorkerCore.buildFitResult 相同）；給 job 時 params／settings 取自它，所以結果對得上表單
 *   seqClient(script)  照腳本回覆的假 client：script[k] 是第 k 次 fit 的回覆——
 *                   { values, status, chi2r, progress: n, ... }（先發 n 個進度事件再 resolve fakeResult）、
 *                   { reject: code }、{ throws: true }（同步丟例外）、{ wait: true }（等 stop() 才以 'stopped' resolve）、
 *                   { raw: 任意值 }（原樣 resolve）。腳本用完後一律收斂。jobs 是收到的 job、stops 是 stop() 次數
 *   seqState({ steps, weighting, conditions, form, files, outcome, conditionName, options })
 *                   經 SasFitState.reduce 走完一次序列的狀態（不經執行器）：steps[k] 是第 k 個要擬合的項目的結果——
 *                   fakeResult 的參數，或 { error: 訊息 }；steps 比項目少時，其餘留在 pending。回傳 { state, form, plan }
 */
const ui = require('./sasfit-ui-helpers.js');

const STYLE_KEYS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline'];
const METHODS = ['save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke',
    'arc', 'clip', 'fillText', 'setTransform'];
const REAL_GEOM = globalThis.SasFitShapeGeom;
const counters = { builds: 0 };

function fakeContext() {
    const calls = [];
    const stack = [];
    let style = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '', textAlign: 'start', textBaseline: 'alphabetic' };
    const ctx = { calls };
    STYLE_KEYS.forEach((key) => Object.defineProperty(ctx, key, { get: () => style[key], set: (value) => { style = { ...style, [key]: value }; } }));
    METHODS.forEach((name) => {
        ctx[name] = (...args) => {
            if (name === 'save') stack.push(style);
            if (name === 'restore') style = stack.pop();
            calls.push({ name, args, style });
        };
    });
    ctx.only = (name) => calls.filter((call) => call.name === name);
    return ctx;
}

function fakeFrames() {
    let nextId = 1;
    const pending = new Map();
    const frames = {
        requested: 0, cancelled: 0,
        raf(fn) { frames.requested += 1; const id = nextId++; pending.set(id, fn); return id; },
        cancelRaf(id) { if (pending.delete(id)) frames.cancelled += 1; },
        pending: () => pending.size,
        /** 執行目前排著的回呼各一次（回呼裡新排的留到下一次 flush）。 */
        flush(time = 0) {
            const now = [...pending.entries()];
            now.forEach(([id, fn]) => { if (pending.delete(id)) fn(time); });
            return now.length;
        },
    };
    return frames;
}

/** 離屏畫布：toBlob 以 { type, width, height, context } 回覆。 */
function fakeCanvas() {
    const context = fakeContext();
    const canvas = {
        width: 300, height: 150, context, contexts: 0,
        getContext(kind) { canvas.contexts += 1; return kind === '2d' ? context : null; },
        toBlob(resolve, type) { resolve({ type, width: canvas.width, height: canvas.height, context }); },
    };
    return canvas;
}

function countBuilds() {
    globalThis.SasFitShapeGeom = Object.freeze({
        ...REAL_GEOM,
        build(...args) { counters.builds += 1; return REAL_GEOM.build(...args); },
    });
}

function restore() {
    globalThis.SasFitShapeGeom = REAL_GEOM;
    delete window.addEventListener;
    delete window.devicePixelRatio;
    ui.restoreGlobals();
}

/** ui.boot，結束後（成功或失敗）把 SasFitShape3d 換回真的模組。 */
function bootWith(real, options) {
    try {
        return ui.boot(options);
    } finally {
        globalThis.SasFitShape3d = real;
    }
}

function shapePage({ modules = ['SasFitDataUi', 'SasFitParamsUi'], reducedMotion = false, coarse = false, ratio = 1, size = [575, 414], ...rest } = {}) {
    const frames = fakeFrames();
    const observers = [];
    const canvases = [];
    const queries = [];
    const media = { matches: reducedMotion };
    const pointer = { matches: coarse };
    const windowListeners = {};
    countBuilds();
    counters.builds = 0;
    window.devicePixelRatio = ratio;
    window.addEventListener = (type, fn, options) => { (windowListeners[type] ||= []).push({ fn, options }); };
    const real = globalThis.SasFitShape3d;
    const captured = { segment: null, creates: 0 };
    globalThis.SasFitShape3d = Object.freeze({
        ...real,
        create(ctx) { captured.creates += 1; captured.segment = real.create(ctx); return captured.segment; },
    });
    const page = bootWith(real, {
        modules, ...rest,
        deps: {
            raf: frames.raf, cancelRaf: frames.cancelRaf,
            matchMedia: (query) => { queries.push(query); return /reduced-motion/.test(query) ? media : pointer; },
            createCanvas: () => { const canvas = fakeCanvas(); canvases.push(canvas); return canvas; },
            observeResize: (element, fn) => { observers.push({ element, fn }); },
        },
    });
    const context = fakeContext();
    const canvas = page.$('sfShapeCanvas');
    Object.assign(canvas, { width: 300, height: 150, contexts: 0, getContext(kind) { canvas.contexts += 1; return kind === '2d' ? context : null; } });
    const stage = page.$('sfShapeStage');
    [stage.clientWidth, stage.clientHeight] = size;
    const captures = [];
    stage.setPointerCapture = (id) => { captures.push(id); };
    stage.releasePointerCapture = (id) => { captures.splice(captures.indexOf(id), 1); };
    return {
        ...page, frames, observers, canvases, queries, media, windowListeners, context, canvas, stage,
        segment: captured.segment, creates: () => captured.creates, captures,
        paints: () => context.only('clearRect').length,
        builds: () => counters.builds,
        /** 換表單並重繪（等同使用者在參數表改了一格）。 */
        act(action) { page.ctx.setForm(globalThis.SasFitForm.reduce(page.ctx.getForm(), action)); page.ctx.refresh(); },
        showShape() { page.$('sfViewShape').fire('click'); return frames.flush(); },
    };
}

// ---------------------------------------------------------------- 序列擬合

const SEQ_FILES = ['SYNTH_sphere_10.dat', 'SYNTH_sphere_20.dat', 'SYNTH_sphere_30.dat'];
const DEFAULT_ERRORS = { scale: 0.01, background: 0.0001, radius: 0.05 };

const seqDatasets = () => SEQ_FILES.map((name) => globalThis.SasFitDataIo.parse(ui.fixtureText(name), { fileName: name, qUnit: 'A' }).dataset);

function seqFiles(conditions) {
    return seqDatasets().map((dataset, i) => Object.freeze({
        id: 'd' + (i + 1), fileName: SEQ_FILES[i], dataset, issues: [], issueOverflow: 0, notes: {},
        condition: conditions === undefined ? dataset.condition : conditions[i],
    }));
}

function sphereForm(ticks = ['radius']) {
    const F = globalThis.SasFitForm;
    return ticks.reduce((form, name) => F.reduce(form, { type: 'setFit', name, fit: true }), F.create('sphere'));
}

function fakeResult({ job = null, status = 'converged', values = {}, errors = {}, chi2r = 1.1, weighting, names, ...rest } = {}) {
    const fitted = names || (job === null ? Object.keys(values) : Object.keys(job.fitFlags).filter((name) => job.fitFlags[name]));
    const mode = weighting || (job === null ? 'sigma' : job.weighting);
    const base = job === null ? { scale: 1, background: 0.001, sld: 1, sld_solvent: 6, radius: 50 } : job.params;
    const errorOf = (name) => (Object.hasOwn(errors, name) ? errors[name] : (DEFAULT_ERRORS[name] || 0.01));
    const root = Math.sqrt(chi2r);
    const identity = fitted.map((_, i) => fitted.map((__, j) => (i === j ? 1 : 0)));
    return Object.freeze({
        params: Object.freeze({ ...base, ...values }), names: Object.freeze(fitted.slice()),
        errors: Object.freeze(Object.fromEntries(fitted.map((name) => [name, errorOf(name)]))),
        errorsScaled: Object.freeze(Object.fromEntries(fitted.map((name) => [name, errorOf(name) * root]))),
        displayErrorsScaled: mode !== 'sigma', covariance: identity, correlation: identity,
        chi2: chi2r * 54, chi2r, dof: 54, iterations: 7, status, atBound: Object.freeze({}),
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: new Float64Array(3), residuals: new Float64Array(3),
        settings: Object.freeze({
            modelSpec: job === null ? Object.freeze({ model: 'sphere', structure: null, lowQPowerLaw: false }) : job.modelSpec,
            weighting: mode, range: job === null ? Object.freeze({ qMin: 0.005, qMax: 0.35 }) : job.range,
            cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10,
        }),
        ...rest,
    });
}

function seqClient(script = []) {
    const client = { jobs: [], stops: 0, waiting: null, stopThrows: false };
    client.fit = (job, options) => {
        const step = script[client.jobs.length] || {};
        client.jobs.push(job);
        if (step.throws === true) throw new Error('seqClient: scripted throw');
        if (step.reject !== undefined) return Promise.reject(Object.assign(new Error('錯誤 ' + step.reject), { code: step.reject, detail: 'detail of ' + step.reject }));
        if (step.wait === true) return new Promise((resolve) => { client.waiting = () => resolve(fakeResult({ job, status: 'stopped', names: [] })); });
        const { progress = 0, raw, ...result } = step;
        for (let i = 1; i <= progress; i++) options.onProgress({ iteration: i, chi2r: 10 / i });
        return Promise.resolve(Object.hasOwn(step, 'raw') ? raw : fakeResult({ job, ...result }));
    };
    client.stop = () => {
        client.stops += 1;
        if (client.stopThrows) throw new Error('seqClient: stop failed');
        const release = client.waiting;
        client.waiting = null;
        if (release !== null) release();
    };
    return client;
}

const DEFAULT_STEPS = [{ values: { radius: 50.12 } }, { values: { radius: 52.07 } }, { values: { radius: 53.95 } }];

function loadedState({ files, conditions, weighting, conditionName }) {
    const S = globalThis.SasFitState;
    const entries = files || seqDatasets().map((dataset, i) => ({ fileName: SEQ_FILES[i], dataset, issues: [], notes: {} }));
    let state = S.reduce(S.initial(), { type: 'addFiles', files: entries });
    (conditions || []).forEach((value, i) => { state = S.reduce(state, { type: 'setCondition', id: state.files[i].id, value }); });
    if (weighting !== undefined) state = S.reduce(state, { type: 'setWeighting', mode: weighting });
    return conditionName === undefined ? state : S.reduce(state, { type: 'setConditionName', name: conditionName });
}

function seqState({ steps = DEFAULT_STEPS, form = sphereForm(), outcome, options = {}, ...load } = {}) {
    const S = globalThis.SasFitState;
    let state = loadedState(load);
    Object.keys(options).forEach((key) => { state = S.reduce(state, { type: 'setSeqOption', key, value: options[key] }); });
    const { weighting, maxSteps } = state;
    const plan = globalThis.SasFitSequence.plan({ files: state.files, selected: state.seq.selected, options: state.seq.options, range: state.range, weighting, form });
    state = S.reduce(state, { type: 'seqStarted', plan, form, settings: { weighting, maxSteps, rangeEdited: state.range !== null && state.range.userEdited } });
    const todo = plan.items.filter((item) => item.skip === null);
    let last = null;
    todo.slice(0, steps.length).forEach((item, k) => {
        const step = steps[k];
        const dataset = state.files.find((file) => file.id === item.id).dataset;
        const job = globalThis.SasFitJobs.fitJob(form, dataset, { range: item.range, weighting, maxSteps });
        const result = step.error === undefined ? fakeResult({ job, ...step }) : null;
        const row = { id: item.id, state: result === null ? 'error' : 'done', result, range: item.range,
            note: result === null ? step.error : item.note, startedFrom: state.seq.options.chain ? last : null };
        state = S.reduce(state, { type: 'seqStep', id: item.id, row, next: k + 1 < todo.length ? todo[k + 1].id : null });
        if (globalThis.SasFitSequence.isUsableStart(result)) last = item.id;
    });
    const how = outcome || (steps.length < todo.length ? 'stopped' : 'finished');
    return { state: S.reduce(state, { type: 'seqSettled', outcome: how }), form, plan };
}

module.exports = { loadedState, seqState, fakeContext, fakeFrames, fakeCanvas, shapePage, restore, seqDatasets, seqFiles, sphereForm, fakeResult, seqClient, SEQ_FILES };
