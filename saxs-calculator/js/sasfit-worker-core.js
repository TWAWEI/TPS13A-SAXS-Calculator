/**
 * sasfit-worker-core.js -- the Web Worker's "message -> computation -> message"
 * logic as plain functions (design spec 4.9, 4.10, 12). Original code.
 *
 *   SasFitWorkerCore.create({ loadWasm, post, yieldTask, instantiate? }) -> { handle }
 *     loadWasm(modelName) -> Promise<ArrayBuffer | typed array>   bytes of one model
 *     post(message)                                               outgoing message
 *     yieldTask() -> Promise   resolves in a LATER TASK (the Worker passes a
 *                 setTimeout 0). Required: queued 'message' events are tasks,
 *                 so awaiting anything that resolves in a microtask would let
 *                 every queued evaluate be computed and latest-wins would do
 *                 nothing once the wasm is cached.
 *     instantiate(bytes) -> Promise<wasm exports>   optional, SasFitKernel.instantiate
 *                 by default; tests use it to make a kernel trap.
 *   core.handle(message) -> Promise<void>; never rejects, every failure
 *     becomes an 'error' message.
 *
 * Incoming (plain data, as structured clone delivers it; never modified):
 *   { type: 'evaluate', reqId, modelSpec, params, q: Float64Array, opts?: { cutoff } }
 *   { type: 'fit', jobId, modelSpec, params, fitFlags: { name: true }, bounds: { name: [lo, hi] },
 *     data: { q, I: Float64Array, sigma: Float64Array | null }, range: { qMin, qMax },
 *     weighting: one of SasFitWeighting.MODES, options?: { maxSteps, cutoff } }
 *   reqId / jobId: a finite number or a non-empty string.
 * Outgoing (plain, not frozen; the receiver freezes what it keeps):
 *   { type: 'curve', reqId, I, extras }
 *   { type: 'progress', jobId, iteration, chi2r }      one per accepted step
 *   { type: 'result', jobId, fitResult }
 *   { type: 'error', reqId | jobId, code, message, detail }
 *     code: one of ERROR_CODES; message: Traditional Chinese, for the user;
 *     detail: the technical text (English), for the console.
 *
 * evaluate is latest-wins: a request is dropped without any answer (errors
 * included) as soon as a newer evaluate has arrived. A fit is never dropped.
 * Inside a Worker a running fit cannot be interrupted by a message (the loop
 * is synchronous); "stop" is worker.terminate() on the client side.
 *
 * Fit rules:
 *   - fitFlags may name scale, background, the parameters of P and S, the
 *     *_pd widths of polydisperse parameters and, with lowQPowerLaw,
 *     lowq_scale / lowq_power. Values must be booleans; at least one is true.
 *     The fitted parameters keep the key order of fitFlags.
 *   - bounds keys come from the same set; [lo, hi] with lo <= hi, lo finite
 *     or -Infinity, hi finite or +Infinity. A fitted name without bounds is
 *     unbounded.
 *   - Every fitted name needs a finite start value in params. A start outside
 *     its bounds is clipped onto the bound (the rule of SasFitFitter).
 *   - Points: SasFitWeighting.select(data, weighting, range); residual
 *     r = (I - I_model)/w. The number of selected points must exceed the
 *     number of fitted parameters (TOO_FEW_POINTS).
 *   - Non-finite model output is expected input (hayter_msa, design spec 16):
 *     the fitter rejects such steps; a fit that cannot start or continue ends
 *     as a result with status 'failed', not as an error.
 *
 * FitResult (design spec 4.9): { params, errors, errorsScaled,
 *   displayErrorsScaled, chi2, chi2r, dof, iterations, status, atBound,
 *   illConditioned, curve, residuals, settings }
 *   params        every parameter that was sent, fitted ones replaced
 *   errors        { name: sqrt(C_jj) } of the fitted parameters
 *   errorsScaled  { name: error * sqrt(chi2r) }
 *   displayErrorsScaled   weighting !== 'sigma' (decisions 2 and 16): which
 *                 of the two the page shows; displayErrors(fitResult) picks it
 *   curve         model on ALL data points; residuals: (I - curve)/w on the
 *                 points that took part, NaN elsewhere
 *   settings      { modelSpec, weighting, range, cutoff, maxSteps, method, ftol, xtol }
 *
 * A wasm trap (Error 'wasm kernel <name> failed', see sasfit-kernel.js) drops
 * that model's instance; the next request loads it again. A failed load is
 * not cached either.
 *
 * No Worker globals, no timers, no clock, no random numbers in this file.
 */

(function () {
    'use strict';

    const METHOD = 'lm';
    const LOWQ_NAMES = Object.freeze(['lowq_scale', 'lowq_power']);
    const COMMON_NAMES = Object.freeze(['scale', 'background']);
    const PD_WIDTH_SUFFIX = '_pd';
    const TRAP_PATTERNS = Object.freeze([/^wasm kernel (\S+) failed/, /^wasm malloc failed for \d+ bytes \((\S+)\)/]);

    const MESSAGES = Object.freeze({
        BAD_MESSAGE: '計算請求的格式不正確，請重新整理頁面後再試。',
        UNKNOWN_TYPE: '收到無法辨識的計算請求，請重新整理頁面後再試。',
        UNKNOWN_MODEL: '找不到指定的模型。',
        BAD_PARAMS: '模型參數不合法，請檢查輸入值。',
        BAD_FIT_FLAGS: '請至少勾選一個要擬合的參數，且只能勾選此模型的參數。',
        BAD_BOUNDS: '參數上下限不合法：下限不可大於上限，且必須是數字。',
        BAD_DATA: '資料格式不正確，無法擬合。',
        BAD_RANGE: '擬合範圍不合法：Qmin 不可大於 Qmax。',
        BAD_WEIGHTING: '權重選項不合法；資料沒有誤差欄時不能使用「資料 σ」。',
        BAD_OPTIONS: '擬合設定不合法（最大步數或 cutoff）。',
        TOO_FEW_POINTS: '範圍內可參與擬合的資料點太少，必須多於要擬合的參數個數。',
        WASM_LOAD: '模型計算模組載入失敗，請確認網路連線後重試。',
        WASM_TRAP: '模型計算發生執行期錯誤，計算模組已重設，可直接重試。',
        INTERNAL: '計算時發生未預期的錯誤。',
    });
    const ERROR_CODES = Object.freeze(Object.keys(MESSAGES));

    const { has, isObject, isPolydisperse, MAX_Q_POINTS } = globalThis.SasFitValidate;
    const isPlainObject = (v) => isObject(v) && !Array.isArray(v) && !ArrayBuffer.isView(v);
    const isId = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v !== '');

    /** An Error that carries its protocol code; the message is the user's text. */
    function fail(code, detail) {
        return Object.assign(new Error(MESSAGES[code]), { code, detail: String(detail) });
    }

    // ------------------------------------------------------------- reading

    /** Normalised copy { model, structure, lowQPowerLaw }; both names must be known models. */
    function readSpec(modelSpec) {
        if (!isPlainObject(modelSpec)) throw fail('BAD_MESSAGE', 'modelSpec must be an object');
        const { model, structure = null, lowQPowerLaw = false } = modelSpec;
        if (typeof model !== 'string' || (structure !== null && typeof structure !== 'string')
            || typeof lowQPowerLaw !== 'boolean') {
            throw fail('BAD_MESSAGE', 'modelSpec needs model: string, structure: string | null, lowQPowerLaw: boolean');
        }
        const models = globalThis.SasFitMeta.models;
        [model, structure].forEach((name) => {
            if (name !== null && !has(models, name)) throw fail('UNKNOWN_MODEL', 'Unknown model: ' + name);
        });
        return { model, structure, lowQPowerLaw };
    }

    /** The wasm modules a spec needs: P and S when they are C models. */
    function modelsOf(modelSpec) {
        const spec = readSpec(modelSpec);
        const models = globalThis.SasFitMeta.models;
        return [spec.model, spec.structure].filter((name) => name !== null && models[name].kind === 'c');
    }

    /** The names a fit may vary (see "Fit rules" in the header). */
    function fittableNames(spec) {
        const models = globalThis.SasFitMeta.models;
        const names = new Set(COMMON_NAMES);
        [spec.model, spec.structure].filter((name) => name !== null).forEach((name) => {
            models[name].params.forEach((p) => {
                names.add(p.name);
                if (isPolydisperse(p)) names.add(p.name + PD_WIDTH_SUFFIX);
            });
        });
        if (spec.lowQPowerLaw) LOWQ_NAMES.forEach((name) => names.add(name));
        return names;
    }

    function readFitFlags(fitFlags, known) {
        if (!isPlainObject(fitFlags)) throw fail('BAD_FIT_FLAGS', 'fitFlags must be an object of booleans');
        const keys = Object.keys(fitFlags);
        keys.forEach((key) => {
            if (!known.has(key)) throw fail('BAD_FIT_FLAGS', 'Not a fittable parameter of this model: ' + key);
            if (typeof fitFlags[key] !== 'boolean') throw fail('BAD_FIT_FLAGS', 'fitFlags.' + key + ' must be a boolean');
        });
        const names = keys.filter((key) => fitFlags[key]);
        if (names.length === 0) throw fail('BAD_FIT_FLAGS', 'No parameter is selected for fitting');
        return names;
    }

    function readBoundPair(key, pair) {
        const ok = Array.isArray(pair) && pair.length === 2
            && typeof pair[0] === 'number' && typeof pair[1] === 'number'
            && pair[0] <= pair[1] && pair[0] < Infinity && pair[1] > -Infinity;
        if (!ok) throw fail('BAD_BOUNDS', 'Bounds of ' + key + ' must be [lo, hi] with lo <= hi, got ' + JSON.stringify(pair));
        return pair;
    }

    /** { lower, upper } in the order of names; a name without bounds is unbounded. */
    function readBounds(bounds, names, known) {
        if (!isPlainObject(bounds)) throw fail('BAD_BOUNDS', 'bounds must be an object of [lo, hi]');
        Object.keys(bounds).forEach((key) => {
            if (!known.has(key)) throw fail('BAD_BOUNDS', 'Bounds for a name that cannot be fitted: ' + key);
            readBoundPair(key, bounds[key]);
        });
        const pairs = names.map((name) => (has(bounds, name) ? bounds[name] : [-Infinity, Infinity]));
        return { lower: pairs.map((pair) => pair[0]), upper: pairs.map((pair) => pair[1]) };
    }

    /** The dataset as SasFitWeighting wants it: { q, I, sigma | null }. */
    function readData(data) {
        if (!isPlainObject(data)) throw fail('BAD_DATA', 'data must be an object');
        const { q, I } = data;
        const sigma = data.sigma === undefined ? null : data.sigma;
        if (!(q instanceof Float64Array) || !(I instanceof Float64Array)) throw fail('BAD_DATA', 'data.q and data.I must be Float64Array');
        if (q.length < 1 || q.length > MAX_Q_POINTS || I.length !== q.length) {
            throw fail('BAD_DATA', 'data.q has ' + q.length + ' points (1..' + MAX_Q_POINTS + ') and data.I ' + I.length);
        }
        if (sigma !== null && (!(sigma instanceof Float64Array) || sigma.length !== q.length)) {
            throw fail('BAD_DATA', 'data.sigma must be null or a Float64Array of ' + q.length + ' values');
        }
        return { q, I, sigma };
    }

    function readRange(range) {
        const ok = isPlainObject(range) && typeof range.qMin === 'number' && typeof range.qMax === 'number'
            && range.qMin <= range.qMax;
        if (!ok) throw fail('BAD_RANGE', 'range must be { qMin, qMax } with qMin <= qMax, got ' + JSON.stringify(range));
        return { qMin: range.qMin, qMax: range.qMax };
    }

    function readWeighting(weighting) {
        const modes = globalThis.SasFitWeighting.MODES;
        if (modes.indexOf(weighting) < 0) {
            throw fail('BAD_WEIGHTING', 'Unknown weighting ' + String(weighting) + ' (expected one of ' + modes.join(', ') + ')');
        }
        return weighting;
    }

    /** { maxSteps, cutoff } with the defaults of the fitter and of SasFitEvaluate. */
    function readFitOptions(options) {
        const o = options === undefined || options === null ? {} : options;
        if (!isPlainObject(o)) throw fail('BAD_OPTIONS', 'options must be an object');
        const maxSteps = o.maxSteps === undefined ? globalThis.SasFitFitter.DEFAULTS.maxSteps : o.maxSteps;
        const cutoff = o.cutoff === undefined ? globalThis.SasFitEvaluate.DEFAULT_CUTOFF : o.cutoff;
        if (!Number.isInteger(maxSteps) || maxSteps < 1) throw fail('BAD_OPTIONS', 'maxSteps must be a positive integer, got ' + String(maxSteps));
        if (typeof cutoff !== 'number' || !(cutoff >= 0) || !Number.isFinite(cutoff)) {
            throw fail('BAD_OPTIONS', 'cutoff must be a finite number >= 0, got ' + String(cutoff));
        }
        return { maxSteps, cutoff };
    }

    /** The settings recorded in a FitResult, from a fit message (also used by the client for a stopped fit). */
    function settingsOf(message) {
        if (!isPlainObject(message)) throw fail('BAD_MESSAGE', 'the fit message must be an object');
        const modelSpec = readSpec(message.modelSpec);
        const weighting = readWeighting(message.weighting);
        const range = readRange(message.range);
        const { maxSteps, cutoff } = readFitOptions(message.options);
        const { ftol, xtol } = globalThis.SasFitFitter.DEFAULTS;
        return { modelSpec, weighting, range, cutoff, maxSteps, method: METHOD, ftol, xtol };
    }

    function readStart(params, names) {
        return names.map((name) => {
            const v = has(params, name) ? params[name] : undefined;
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                throw fail('BAD_PARAMS', 'Fitted parameter ' + name + ' needs a finite start value, got ' + String(v));
            }
            return v;
        });
    }

    /** Everything a fit needs, checked; nothing of the message is copied or changed beyond what is listed. */
    function readFitJob(message) {
        if (!isPlainObject(message.params)) throw fail('BAD_MESSAGE', 'params must be an object');
        const settings = settingsOf(message);
        const known = fittableNames(settings.modelSpec);
        const names = readFitFlags(message.fitFlags, known);
        const { lower, upper } = readBounds(message.bounds, names, known);
        const data = readData(message.data);
        if (settings.weighting === 'sigma' && data.sigma === null) {
            throw fail('BAD_WEIGHTING', "Weighting 'sigma' needs data.sigma, but it is null");
        }
        const start = readStart(message.params, names);
        return { jobId: message.jobId, params: message.params, settings, names, start, lower, upper, data };
    }

    function readEvaluate(message) {
        const spec = readSpec(message.modelSpec);
        if (!isPlainObject(message.params)) throw fail('BAD_MESSAGE', 'params must be an object');
        if (!(message.q instanceof Float64Array)) throw fail('BAD_MESSAGE', 'q must be a Float64Array');
        const opts = message.opts === undefined || message.opts === null ? {} : message.opts;
        if (!isPlainObject(opts)) throw fail('BAD_MESSAGE', 'opts must be an object');
        return { spec, params: message.params, q: message.q, opts: { cutoff: opts.cutoff } };
    }

    // ------------------------------------------------------------ FitResult

    const displayErrors = (fitResult) => (fitResult.displayErrorsScaled ? fitResult.errorsScaled : fitResult.errors);

    /** (I - curve)/w on the selected points, NaN on every other point. */
    function residualsOf(data, selection, curve) {
        const out = new Float64Array(data.q.length).fill(NaN);
        selection.index.forEach((i, k) => { out[i] = (data.I[i] - curve[i]) / selection.w[k]; });
        return out;
    }

    /**
     * buildFitResult({ params, fit, data, selection, curve, weighting, settings }) -> FitResult
     *   params     the parameters as sent (flat); fit: the SasFitFitter result
     *   data       { q, I, sigma }; selection: SasFitWeighting.select of it
     *   curve      the model at the fitted parameters on all of data.q
     * Pure; the result is a new plain object and shares no array with the inputs.
     */
    function buildFitResult({ params, fit, data, selection, curve, weighting, settings }) {
        const byName = (values) => Object.fromEntries(fit.names.map((name, j) => [name, values[j]]));
        const root = Math.sqrt(fit.chi2r);
        return {
            params: { ...params, ...byName(fit.values) },
            errors: byName(fit.errors),
            errorsScaled: byName(fit.errors.map((e) => e * root)),
            displayErrorsScaled: weighting !== 'sigma',
            chi2: fit.chi2,
            chi2r: fit.chi2r,
            dof: fit.dof,
            iterations: fit.iterations,
            status: fit.status,
            atBound: { ...fit.atBound },
            illConditioned: fit.illConditioned,
            curve: Float64Array.from(curve),
            residuals: residualsOf(data, selection, curve),
            settings: { ...settings, modelSpec: { ...settings.modelSpec }, range: { ...settings.range } },
        };
    }

    // ------------------------------------------------------------- the core

    /** The model named by a wasm failure of the compute core, or null. */
    function trappedModel(err) {
        const text = err instanceof Error ? err.message : '';
        const hit = TRAP_PATTERNS.map((re) => re.exec(text)).find((m) => m !== null);
        return hit ? hit[1] : null;
    }

    /**
     * { code, message, detail } of anything thrown. A plain Error without a
     * code comes from the compute core's input checks (BAD_PARAMS); any other
     * kind (TypeError, ...) is a bug and reported as INTERNAL.
     */
    function describe(err) {
        if (!(err instanceof Error)) return { code: 'INTERNAL', message: MESSAGES.INTERNAL, detail: String(err) };
        if (has(MESSAGES, err.code)) return { code: err.code, message: err.message, detail: err.detail };
        if (trappedModel(err) !== null) return { code: 'WASM_TRAP', message: MESSAGES.WASM_TRAP, detail: err.message };
        if (err.constructor === Error) return { code: 'BAD_PARAMS', message: MESSAGES.BAD_PARAMS, detail: err.message };
        return { code: 'INTERNAL', message: MESSAGES.INTERNAL, detail: String(err.stack || err.message) };
    }

    /** reqId and jobId of a message, where they are usable ids. */
    function idsOf(message) {
        const ids = {};
        if (isObject(message) && isId(message.reqId)) ids.reqId = message.reqId;
        if (isObject(message) && isId(message.jobId)) ids.jobId = message.jobId;
        return ids;
    }

    function assertDeps(deps) {
        ['loadWasm', 'post', 'yieldTask'].forEach((key) => {
            if (!isObject(deps) || typeof deps[key] !== 'function') throw new Error('SasFitWorkerCore.create needs ' + key + ' as a function');
        });
        if (deps.instantiate !== undefined && typeof deps.instantiate !== 'function') {
            throw new Error('SasFitWorkerCore.create: instantiate must be a function when given');
        }
    }

    // Below, `ctx` is the private state of one core: the injected functions,
    // `cache` (model name -> Promise<wasm exports>) and `evaluateSeq`, a
    // one-element counter holding the sequence number of the newest evaluate.

    /** Post; if that throws (a message that cannot be cloned), say so once. */
    function send(ctx, message) {
        try {
            ctx.post(message);
        } catch (err) {
            const text = 'post failed: ' + String(err);
            try {
                ctx.post({ type: 'error', ...idsOf(message), code: 'INTERNAL', message: MESSAGES.INTERNAL, detail: text });
            } catch (again) {
                // No channel is left to report on, and handle() must not reject: the caller's
                // post is broken for plain data too, which only the caller can notice.
            }
        }
    }

    function sendError(ctx, message, err) {
        const model = trappedModel(err);
        if (model !== null) ctx.cache.delete(model);
        send(ctx, { type: 'error', ...idsOf(message), ...describe(err) });
    }

    /** The exports of one model; loaded once, forgotten again when the load fails. */
    function kernelOf(ctx, name) {
        if (ctx.cache.has(name)) return ctx.cache.get(name);
        const entry = Promise.resolve().then(() => ctx.loadWasm(name)).then(ctx.instantiate).catch((err) => {
            if (ctx.cache.get(name) === entry) ctx.cache.delete(name);
            throw fail('WASM_LOAD', name + ': ' + (err instanceof Error ? err.message : String(err)));
        });
        ctx.cache.set(name, entry);
        return entry;
    }

    async function kernelsFor(ctx, spec) {
        const names = modelsOf(spec);
        const list = await Promise.all(names.map((name) => kernelOf(ctx, name)));
        return Object.fromEntries(names.map((name, i) => [name, list[i]]));
    }

    async function runEvaluate(ctx, message) {
        if (!isId(message.reqId)) throw fail('BAD_MESSAGE', 'evaluate needs a reqId (finite number or non-empty string)');
        ctx.evaluateSeq[0] += 1;
        const mine = ctx.evaluateSeq[0];
        const superseded = () => mine !== ctx.evaluateSeq[0];
        try {
            await ctx.yieldTask();
            if (superseded()) return;
            const req = readEvaluate(message);
            const kernels = await kernelsFor(ctx, req.spec);
            if (superseded()) return;
            const out = globalThis.SasFitEvaluate.evaluate(req.spec, req.params, req.q, req.opts, kernels);
            send(ctx, { type: 'curve', reqId: message.reqId, I: out.I, extras: { ...out.extras } });
        } catch (err) {
            if (!superseded()) sendError(ctx, message, err);
        }
    }

    /** model(values, q) -> I and the SasFitFitter problem of a job on its selected points. */
    function fitProblem(job, selection, kernels) {
        const { modelSpec, cutoff } = job.settings;
        const withValues = (values) => ({ ...job.params, ...Object.fromEntries(job.names.map((name, j) => [name, values[j]])) });
        const model = (values, q) => globalThis.SasFitEvaluate.evaluate(modelSpec, withValues(values), q, { cutoff }, kernels).I;
        const residuals = (p) => {
            const I = model(p, selection.q);
            return Float64Array.from(I, (value, i) => (selection.I[i] - value) / selection.w[i]);
        };
        return { model, problem: { names: job.names, start: job.start, lower: job.lower, upper: job.upper, residuals } };
    }

    async function runFit(ctx, message) {
        if (!isId(message.jobId)) throw fail('BAD_MESSAGE', 'fit needs a jobId (finite number or non-empty string)');
        const job = readFitJob(message);
        const { weighting, range, maxSteps } = job.settings;
        const selection = globalThis.SasFitWeighting.select(job.data, weighting, range);
        const dof = selection.q.length - job.names.length;
        if (dof <= 0) {
            throw fail('TOO_FEW_POINTS', selection.q.length + ' usable points in range for ' + job.names.length + ' fitted parameters');
        }
        const kernels = await kernelsFor(ctx, job.settings.modelSpec);
        const { model, problem } = fitProblem(job, selection, kernels);
        const onProgress = ({ iteration, chi2 }) => send(ctx, { type: 'progress', jobId: job.jobId, iteration, chi2r: chi2 / dof });
        const fit = globalThis.SasFitFitter.fit(problem, { method: METHOD, maxSteps, onProgress });
        const curve = model(fit.values, job.data.q);
        const fitResult = buildFitResult({ params: job.params, fit, data: job.data, selection, curve, weighting, settings: job.settings });
        send(ctx, { type: 'result', jobId: job.jobId, fitResult });
    }

    async function handleWith(ctx, message) {
        try {
            if (!isPlainObject(message) || typeof message.type !== 'string') {
                throw fail('BAD_MESSAGE', 'a message must be an object with a type');
            }
            if (message.type === 'evaluate') await runEvaluate(ctx, message);
            else if (message.type === 'fit') await runFit(ctx, message);
            else throw fail('UNKNOWN_TYPE', 'Unknown message type: ' + message.type);
        } catch (err) {
            sendError(ctx, message, err);
        }
    }

    function create(deps) {
        assertDeps(deps);
        const ctx = {
            loadWasm: deps.loadWasm,
            post: deps.post,
            yieldTask: deps.yieldTask,
            instantiate: deps.instantiate || globalThis.SasFitKernel.instantiate,
            cache: new Map(),
            evaluateSeq: new Uint32Array(1),
        };
        return Object.freeze({ handle: (message) => handleWith(ctx, message) });
    }

    globalThis.SasFitWorkerCore = Object.freeze({
        create, buildFitResult, modelsOf, settingsOf, displayErrors, ERROR_CODES,
    });
})();
