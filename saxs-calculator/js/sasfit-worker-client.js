/**
 * sasfit-worker-client.js -- main-thread side of the SAS fitting Worker
 * (design spec 3.3, 4.10): owns the Worker's life cycle and turns the message
 * protocol of sasfit-worker-core.js into promises. Original code.
 *
 *   SasFitWorkerClient.create({ createWorker?, version? }) -> client (frozen)
 *     createWorker(url) -> Worker-like { postMessage, terminate, onmessage,
 *                 onerror, onmessageerror }; default: new Worker(url)
 *     version     cache version; default: the ?v= of this script's own URL,
 *                 read from document.currentScript when the file loads. There
 *                 is no version written in the code; create() throws without one.
 *   The Worker is started by the first request, as js/sasfit-worker.js?v=<version>
 *   (relative to the page, like the <script> tags of index.html).
 *
 *   client.evaluate({ modelSpec, params, q, opts }) -> Promise<{ I, extras }>
 *     Latest-wins: a newer evaluate makes the pending one reject with an Error
 *     whose `superseded` is true (code 'SUPERSEDED'); callers ignore those.
 *   client.fit(job, { onProgress }) -> Promise<FitResult>
 *     job = { modelSpec, params, fitFlags, bounds, data: { q, I, sigma },
 *     range, weighting, options }. One fit at a time: a second one rejects with
 *     code 'BUSY'. onProgress({ iteration, chi2r }) once per accepted step.
 *     The FitResult (see sasfit-worker-core.js) is frozen, apart from the two
 *     typed arrays, which cannot be.
 *   client.stop()
 *     Terminates the Worker (a running fit cannot be interrupted otherwise) and
 *     starts a new one. A pending fit RESOLVES with a synthetic result:
 *     status 'stopped', params as they were sent, no errors, chi2 / chi2r / dof
 *     / curve / residuals null, iterations = the last reported one. A pending
 *     evaluate rejects with code 'STOPPED'.
 *   client.dispose()
 *     Terminates without a new Worker; pending and later requests reject with
 *     code 'DISPOSED'.
 *   client.version
 *
 * Rejections are Error objects with `code`, a Traditional-Chinese `message`
 * for the user and, where there is one, `detail` (technical, English). Codes:
 * ERROR_CODES below for the client's own, SasFitWorkerCore.ERROR_CODES for
 * those the Worker reports.
 *
 * A Worker that fails (its error or messageerror event) is terminated and
 * every pending request rejects with 'WORKER_CRASH'. The replacement is
 * started by the next request, not at once: if the Worker script itself
 * cannot load, an immediate restart would fail and restart for ever.
 *
 * Request ids come from one counter per client; nothing here uses the clock
 * or random numbers. Arguments are never modified; q and the data arrays are
 * copied by postMessage (structured clone), not transferred.
 */

(function () {
    'use strict';

    const WORKER_PATH = 'js/sasfit-worker.js';
    const SAFE_VERSION = /^[\w.-]+$/;
    const MESSAGES = Object.freeze({
        SUPERSEDED: '這次計算已被較新的請求取代。',
        BUSY: '擬合正在進行中，請等它結束或先按停止。',
        STOPPED: '計算已停止。',
        WORKER_CRASH: '計算執行緒異常結束，已重設，可直接重試。',
        DISPOSED: '計算功能已關閉，請重新整理頁面。',
        POST_FAILED: '計算請求無法送出，請檢查輸入資料。',
    });
    const ERROR_CODES = Object.freeze(Object.keys(MESSAGES));
    const BAD_MESSAGE = 'BAD_MESSAGE';          // a SasFitWorkerCore code, for a request that is not even an object
    const BAD_MESSAGE_TEXT = '計算請求的格式不正確。';

    /** The ?v= of this script's URL. document.currentScript exists only while the script runs, and not in Node. */
    function readScriptVersion() {
        if (typeof document === 'undefined' || !document || !document.currentScript) return null;
        const src = String(document.currentScript.src || '');
        const at = src.indexOf('?');
        return at < 0 ? null : new URLSearchParams(src.slice(at + 1)).get('v');
    }
    const scriptVersion = readScriptVersion();

    const isObject = (v) => v !== null && typeof v === 'object';

    function workerUrl(version) {
        return WORKER_PATH + '?v=' + encodeURIComponent(version);
    }

    function clientError(code, detail, extra) {
        return Object.assign(new Error(MESSAGES[code]), { code, detail: detail === undefined ? '' : String(detail) }, extra);
    }

    /** The Error for an 'error' message of the Worker. */
    function remoteError(data) {
        const message = typeof data.message === 'string' && data.message !== '' ? data.message : String(data.code);
        return Object.assign(new Error(message), { code: data.code, detail: data.detail === undefined ? '' : String(data.detail) });
    }

    const frozenCopy = (obj) => Object.freeze({ ...obj });

    /** A FitResult with its plain objects frozen (new objects; the typed arrays are shared as received). */
    function freezeResult(fitResult) {
        const settings = isObject(fitResult.settings)
            ? Object.freeze({
                ...fitResult.settings,
                modelSpec: isObject(fitResult.settings.modelSpec) ? frozenCopy(fitResult.settings.modelSpec) : fitResult.settings.modelSpec,
                range: isObject(fitResult.settings.range) ? frozenCopy(fitResult.settings.range) : fitResult.settings.range,
            })
            : fitResult.settings;
        const part = (key) => (isObject(fitResult[key]) ? frozenCopy(fitResult[key]) : fitResult[key]);
        return Object.freeze({
            ...fitResult,
            params: part('params'),
            errors: part('errors'),
            errorsScaled: part('errorsScaled'),
            atBound: part('atBound'),
            settings,
        });
    }

    /** What a stopped fit resolves with (the Worker is gone, so the client builds it). */
    function stoppedResult(pendingFit) {
        return freezeResult({
            status: 'stopped',
            params: pendingFit.params,
            errors: {},
            errorsScaled: {},
            displayErrorsScaled: pendingFit.settings.weighting !== 'sigma',
            chi2: null,
            chi2r: null,
            dof: null,
            iterations: pendingFit.iteration,
            atBound: {},
            illConditioned: false,
            curve: null,
            residuals: null,
            settings: pendingFit.settings,
        });
    }

    // Below, `c` is the private, mutable record of one client:
    //   createWorker, version, worker (null until needed), nextId,
    //   evaluation: null | { reqId, resolve, reject }
    //   fitting:    null | { jobId, resolve, reject, onProgress, params, settings, iteration }
    //   disposed

    /** Take both pending requests off the record and return them. */
    function takePending(c) {
        const taken = { evaluation: c.evaluation, fitting: c.fitting };
        c.evaluation = null;
        c.fitting = null;
        return taken;
    }

    function rejectAll(c, makeError) {
        const { evaluation, fitting } = takePending(c);
        if (evaluation) evaluation.reject(makeError());
        if (fitting) fitting.reject(makeError());
    }

    function onReply(c, data) {
        if (!isObject(data) || typeof data.type !== 'string') return;      // not a protocol message: nothing to settle
        const ev = c.evaluation;
        const fit = c.fitting;
        if (data.type === 'error' && data.reqId === undefined && data.jobId === undefined) {
            rejectAll(c, () => remoteError(data));
        } else if (ev && data.reqId === ev.reqId && (data.type === 'curve' || data.type === 'error')) {
            c.evaluation = null;
            if (data.type === 'error') ev.reject(remoteError(data));
            else ev.resolve(Object.freeze({ I: data.I, extras: frozenCopy(data.extras) }));
        } else if (fit && data.jobId === fit.jobId && data.type === 'progress') {
            fit.iteration = data.iteration;
            fit.onProgress(Object.freeze({ iteration: data.iteration, chi2r: data.chi2r }));
        } else if (fit && data.jobId === fit.jobId && (data.type === 'result' || data.type === 'error')) {
            c.fitting = null;
            if (data.type === 'error') fit.reject(remoteError(data));
            else fit.resolve(freezeResult(data.fitResult));
        }
        // anything else belongs to a request that was superseded or stopped: ignored on purpose
    }

    function onCrash(c, worker, event) {
        if (c.worker !== worker) return;
        c.worker = null;
        worker.terminate();
        const detail = isObject(event) && event.message ? String(event.message) : 'worker error';
        rejectAll(c, () => clientError('WORKER_CRASH', detail));
    }

    /** Start a Worker and wire it; events of a Worker that is no longer the current one are ignored. */
    function startWorker(c) {
        const worker = c.createWorker(workerUrl(c.version));
        worker.onmessage = (event) => { if (c.worker === worker) onReply(c, event.data); };
        worker.onerror = (event) => onCrash(c, worker, event);
        worker.onmessageerror = (event) => onCrash(c, worker, event);
        c.worker = worker;
        return worker;
    }

    /** Post to the (possibly new) Worker; false with the reason passed to onFail when postMessage throws. */
    function post(c, message, onFail) {
        try {
            (c.worker || startWorker(c)).postMessage(message);
            return true;
        } catch (err) {
            onFail(clientError('POST_FAILED', err instanceof Error ? err.message : String(err)));
            return false;
        }
    }

    function evaluate(c, request) {
        if (c.disposed) return Promise.reject(clientError('DISPOSED'));
        if (!isObject(request)) return Promise.reject(Object.assign(new Error(BAD_MESSAGE_TEXT), { code: BAD_MESSAGE, detail: 'evaluate needs a request object' }));
        const previous = c.evaluation;
        c.evaluation = null;
        if (previous) previous.reject(clientError('SUPERSEDED', '', { superseded: true }));
        c.nextId += 1;
        const reqId = c.nextId;
        const { modelSpec, params, q, opts } = request;
        return new Promise((resolve, reject) => {
            c.evaluation = { reqId, resolve, reject };
            post(c, { type: 'evaluate', reqId, modelSpec, params, q, opts }, (err) => {
                c.evaluation = null;
                reject(err);
            });
        });
    }

    /** The fit message of a job: only the protocol's fields, and of data only what the Worker reads. */
    function fitMessage(jobId, job) {
        const data = isObject(job.data)
            ? { q: job.data.q, I: job.data.I, sigma: job.data.sigma === undefined ? null : job.data.sigma }
            : job.data;
        const { modelSpec, params, fitFlags, bounds, range, weighting, options } = job;
        return { type: 'fit', jobId, modelSpec, params, fitFlags, bounds, data, range, weighting, options };
    }

    /** { settings, onProgress } of a fit call; throws an Error with a code when the job cannot even be described. */
    function readFitCall(job, callOptions) {
        const onProgress = isObject(callOptions) && callOptions.onProgress !== undefined ? callOptions.onProgress : () => {};
        if (typeof onProgress !== 'function') {
            throw Object.assign(new Error(BAD_MESSAGE_TEXT), { code: BAD_MESSAGE, detail: 'onProgress must be a function' });
        }
        return { settings: globalThis.SasFitWorkerCore.settingsOf(job), onProgress };
    }

    function fit(c, job, callOptions) {
        if (c.disposed) return Promise.reject(clientError('DISPOSED'));
        if (c.fitting) return Promise.reject(clientError('BUSY'));
        let call = null;
        try {
            call = readFitCall(job, callOptions);
        } catch (err) {
            return Promise.reject(err);
        }
        c.nextId += 1;
        const jobId = c.nextId;
        return new Promise((resolve, reject) => {
            c.fitting = {
                jobId, resolve, reject, onProgress: call.onProgress,
                params: isObject(job.params) ? { ...job.params } : {}, settings: call.settings, iteration: 0,
            };
            post(c, fitMessage(jobId, job), (err) => {
                c.fitting = null;
                reject(err);
            });
        });
    }

    function stop(c) {
        if (c.disposed) return;
        const { evaluation, fitting } = takePending(c);
        if (c.worker) {
            c.worker.terminate();
            c.worker = null;
            startWorker(c);
        }
        if (evaluation) evaluation.reject(clientError('STOPPED'));
        if (fitting) fitting.resolve(stoppedResult(fitting));
    }

    function dispose(c) {
        if (c.disposed) return;
        c.disposed = true;
        if (c.worker) c.worker.terminate();
        c.worker = null;
        rejectAll(c, () => clientError('DISPOSED'));
    }

    function create(options) {
        const o = isObject(options) ? options : {};
        const version = o.version === undefined || o.version === null ? scriptVersion : o.version;
        if (typeof version !== 'string' || !SAFE_VERSION.test(version)) {
            throw new Error('SasFitWorkerClient needs a cache version (the ?v= of its <script> URL, or options.version), got '
                + String(version));
        }
        const createWorker = o.createWorker === undefined ? (url) => new Worker(url) : o.createWorker;
        if (typeof createWorker !== 'function') throw new Error('SasFitWorkerClient: createWorker must be a function');
        const c = { createWorker, version, worker: null, nextId: 0, evaluation: null, fitting: null, disposed: false };
        return Object.freeze({
            evaluate: (request) => evaluate(c, request),
            fit: (job, callOptions) => fit(c, job, callOptions),
            stop: () => stop(c),
            dispose: () => dispose(c),
            version,
        });
    }

    globalThis.SasFitWorkerClient = Object.freeze({ create, ERROR_CODES, WORKER_PATH, scriptVersion });
})();
