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

module.exports = { fakeContext, fakeFrames, fakeCanvas, shapePage, restore };
