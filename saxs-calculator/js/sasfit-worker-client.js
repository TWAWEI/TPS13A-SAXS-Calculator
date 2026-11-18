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
 *     An onProgress that throws does not disturb the fit: the exception is
 *     caught, later progress is still delivered, the fit settles as usual, and
 *     the exception is rethrown from a microtask (queueMicrotask), so it shows
 *     up as an uncaught error of the page instead of vanishing.
 *     The FitResult (see sasfit-worker-core.js) is frozen, apart from the two
 *     typed arrays, which cannot be.
 *   client.stop()
 *     With nothing pending it does nothing (a warm Worker with its loaded wasm
 *     is kept). Otherwise it terminates the Worker -- a running fit cannot be
 *     interrupted in any other way -- and settles everything pending: a fit
 *     RESOLVES with a synthetic result that has the keys of a real FitResult
 *     (status 'stopped', params as they were sent, names / covariance /
 *     correlation empty, no errors, the three flags false,
 *     nonFiniteCurvePoints 0, chi2 / chi2r / dof / curve / residuals null,
 *     iterations = the last reported one); an evaluate rejects with code
 *     'STOPPED'. The replacement Worker is started lazily, by the next request.
 *   client.dispose()
 *     Terminates without a new Worker; pending and later requests reject with
 *     code 'DISPOSED'.
 *   client.version
 *
 * Every promise settles on every path. Rejections are Error objects with
 * `code`, a Traditional-Chinese `message` for the user and, where there is
 * one, `detail` (technical, English). Codes: ERROR_CODES below for the
 * client's own, SasFitWorkerCore.ERROR_CODES for those the Worker reports.
 *   SUPERSEDED / BUSY / STOPPED / DISPOSED   as described above
 *   WORKER_START_FAILED   the Worker could not be created (createWorker threw),
 *                         its script could not be fetched (an error event
 *                         without a message), or its entry script reported
 *                         that importScripts failed
 *   POST_FAILED           postMessage threw (data that cannot be cloned)
 *   WORKER_CRASH          the Worker's error event with a message (an uncaught
 *                         exception; detail = "message (file:line)"), its
 *                         messageerror event, or a 'result' / 'curve' message
 *                         that is not what the protocol says (fitResult not
 *                         an object, I not a Float64Array, ...)
 *
 * A Worker that fails in one of the WORKER_CRASH ways, or after it started in
 * one of the last two WORKER_START_FAILED ways, is terminated and
 * every pending request rejects. The replacement is started by the next
 * request, not at once: if the Worker script itself cannot load, an immediate
 * restart would fail and restart for ever. If terminate() itself throws, the
 * pending requests are settled first and the exception then propagates to the
 * caller (of stop / dispose, or the event dispatcher).
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
        WORKER_START_FAILED: '計算執行緒無法啟動，請確認網路連線並重新整理頁面後再試。',
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

    /** The user's text for an 'error' message: its own, else (the Worker entry sends none) the client's for that code. */
    function remoteText(data) {
        if (typeof data.message === 'string' && data.message !== '') return data.message;
        if (data.code === BAD_MESSAGE) return BAD_MESSAGE_TEXT;
        return Object.prototype.hasOwnProperty.call(MESSAGES, data.code) ? MESSAGES[data.code] : String(data.code);
    }

    /** The Error for an 'error' message of the Worker. */
    function remoteError(data) {
        return Object.assign(new Error(remoteText(data)), { code: data.code, detail: data.detail === undefined ? '' : String(data.detail) });
    }

    const errorText = (err) => (err instanceof Error ? err.message : String(err));
    const isFloat64Array = (v) => Object.prototype.toString.call(v) === '[object Float64Array]';

    const frozenCopy = (obj) => Object.freeze({ ...obj });

    /** A frozen copy of a matrix given as an array of rows; anything else is returned as it is. */
    const frozenRows = (rows) => (Array.isArray(rows)
        ? Object.freeze(rows.map((row) => (Array.isArray(row) ? Object.freeze(row.slice()) : row)))
        : rows);

    /** A FitResult with its plain objects and arrays frozen (new objects; the typed arrays are shared as received). */
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
            names: Array.isArray(fitResult.names) ? Object.freeze(fitResult.names.slice()) : fitResult.names,
            covariance: frozenRows(fitResult.covariance),
            correlation: frozenRows(fitResult.correlation),
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
            names: [],
            errors: {},
            errorsScaled: {},
            displayErrorsScaled: pendingFit.settings.weighting !== 'sigma',
            covariance: [],
            correlation: [],
            chi2: null,
            chi2r: null,
            dof: null,
            iterations: pendingFit.iteration,
            atBound: {},
            illConditioned: false,
            blockedByNonFinite: false,
            jacobianNonFinite: false,
            nonFiniteCurvePoints: 0,
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

    /** Forget the current Worker, then terminate it (in this order: a terminate() that throws leaves no stale Worker). */
    function dropWorker(c) {
        const worker = c.worker;
        c.worker = null;
        if (worker) worker.terminate();
    }

    /** "message (file:line)" of a Worker error event, as far as the event has them. */
    function crashDetail(event) {
        if (!isObject(event) || !event.message) return 'worker error';
        const line = event.lineno ? ':' + event.lineno : '';
        return String(event.message) + (event.filename ? ' (' + event.filename + line + ')' : '');
    }

    /** Terminate the Worker (if it is still the current one) and reject everything pending with makeError(). */
    function abandon(c, worker, makeError) {
        if (c.worker !== worker) return;
        try {
            dropWorker(c);
        } finally {
            rejectAll(c, makeError);
        }
    }

    function onCrash(c, worker, event) {
        abandon(c, worker, () => clientError('WORKER_CRASH', crashDetail(event)));
    }

    /**
     * The Worker's error event. A script that throws gives an ErrorEvent with a message; a Worker
     * script that cannot be fetched gives a bare Event, which is a failed start, not a crash.
     */
    function onWorkerError(c, worker, event) {
        if (isObject(event) && event.message) onCrash(c, worker, event);
        else abandon(c, worker, () => clientError('WORKER_START_FAILED', 'the Worker script could not be loaded (error event without a message)'));
    }

    /** Hand a progress message to the caller; an exception of the callback is rethrown later, outside the message handler. */
    function reportProgress(fit, data) {
        fit.iteration = data.iteration;
        try {
            fit.onProgress(Object.freeze({ iteration: data.iteration, chi2r: data.chi2r }));
        } catch (err) {
            queueMicrotask(() => { throw err; });
        }
    }

    function settleEvaluation(c, worker, ev, data) {
        if (data.type === 'curve' && (!isFloat64Array(data.I) || !isObject(data.extras))) {
            onCrash(c, worker, { message: 'malformed curve message: I must be a Float64Array and extras an object' });
            return;
        }
        c.evaluation = null;
        if (data.type === 'error') ev.reject(remoteError(data));
        else ev.resolve(Object.freeze({ I: data.I, extras: frozenCopy(data.extras) }));
    }

    function settleFit(c, worker, fit, data) {
        if (data.type === 'result' && (!isObject(data.fitResult) || Array.isArray(data.fitResult))) {
            onCrash(c, worker, { message: 'malformed result message: fitResult must be an object' });
            return;
        }
        c.fitting = null;
        if (data.type === 'error') fit.reject(remoteError(data));
        else fit.resolve(freezeResult(data.fitResult));
    }

    function onReply(c, worker, data) {
        if (!isObject(data) || typeof data.type !== 'string') return;      // not a protocol message: nothing to settle
        const ev = c.evaluation;
        const fit = c.fitting;
        if (data.type === 'error' && data.reqId === undefined && data.jobId === undefined) {
            // The entry script reporting that it cannot start is about to die: do not post to it again.
            if (data.code === 'WORKER_START_FAILED') abandon(c, worker, () => remoteError(data));
            else rejectAll(c, () => remoteError(data));
        } else if (ev && data.reqId === ev.reqId && (data.type === 'curve' || data.type === 'error')) {
            settleEvaluation(c, worker, ev, data);
        } else if (fit && data.jobId === fit.jobId && data.type === 'progress') {
            reportProgress(fit, data);
        } else if (fit && data.jobId === fit.jobId && (data.type === 'result' || data.type === 'error')) {
            settleFit(c, worker, fit, data);
        }
        // anything else belongs to a request that was superseded or stopped: ignored on purpose
    }

    /** onReply, with anything it might throw turned into a crash of that Worker, so that no promise is left hanging. */
    function onMessage(c, worker, event) {
        if (c.worker !== worker) return;
        try {
            onReply(c, worker, event.data);
        } catch (err) {
            onCrash(c, worker, { message: 'reply could not be handled: ' + errorText(err) });
        }
    }

    /** Start a Worker and wire it; events of a Worker that is no longer the current one are ignored. */
    function startWorker(c) {
        const worker = c.createWorker(workerUrl(c.version));
        if (!isObject(worker) || typeof worker.postMessage !== 'function') throw new Error('createWorker did not return a Worker');
        worker.onmessage = (event) => onMessage(c, worker, event);
        worker.onerror = (event) => onWorkerError(c, worker, event);
        worker.onmessageerror = (event) => onCrash(c, worker, { message: 'a message of the Worker could not be deserialised' });
        c.worker = worker;
        return worker;
    }

    /** Post to the Worker, starting one if there is none; a failure of either step goes to onFail with its own code. */
    function post(c, message, onFail) {
        let worker = c.worker;
        if (!worker) {
            try {
                worker = startWorker(c);
            } catch (err) {
                onFail(clientError('WORKER_START_FAILED', errorText(err)));
                return;
            }
        }
        try {
            worker.postMessage(message);
        } catch (err) {
            onFail(clientError('POST_FAILED', errorText(err)));
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
            ? {
                q: job.data.q, I: job.data.I, sigma: job.data.sigma === undefined ? null : job.data.sigma,
                kind: job.data.kind === undefined ? 'generic' : job.data.kind,
            }
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
        if (!evaluation && !fitting) return;        // idle: keep the warm Worker
        try {
            dropWorker(c);
        } finally {
            if (evaluation) evaluation.reject(clientError('STOPPED'));
            if (fitting) fitting.resolve(stoppedResult(fitting));
        }
    }

    function dispose(c) {
        if (c.disposed) return;
        c.disposed = true;
        try {
            dropWorker(c);
        } finally {
            rejectAll(c, () => clientError('DISPOSED'));
        }
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
