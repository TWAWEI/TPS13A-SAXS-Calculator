/**
 * sasfit-jobs.js -- builds what the SAS fitting page sends to the Worker from
 * the model form (design spec 4.9, 4.10, 12; plan M3 Task 6). Original code.
 *
 *   modelSpec(form)   -> { model, structure, lowQPowerLaw }
 *   params(form)      -> the flat parameters of SasFitEvaluate, numbers (and
 *                        the *_pd_type strings), in the order of the table
 *   previewGrid()     -> the q grid of a preview without data
 *   previewRequest(form, dataset | null)
 *                     -> { modelSpec, params, q, opts: { cutoff }, index,
 *                          onData, decimated, paused, cost }
 *   fitReadiness(form, dataset, { range, weighting })
 *                     -> { ok, reason, nPoints, nFree }
 *   fitJob(form, dataset, { range, weighting, maxSteps })
 *                     -> the job of SasFitWorkerClient.fit
 *   fullRange(dataset)-> SasFitState.fullRange
 *   writtenValues(form, fitResult)     -> { name: number } of the fitted names, rounded
 *   applyResult(form, fitResult)       -> form with the fitted values (writtenValues)
 *   resultMatchesForm(form, fitResult) -> boolean
 *
 * What is sent, and why:
 *   - Only the rows of the parameter table: no orientation parameter, no
 *     radius_effective while the model defines it (radius_effective_mode >= 1).
 *     The compute core rejects any name it does not know.
 *   - A dispersity takes part only while its row is open. An open row ALWAYS
 *     sends all four of <name>_pd, _pd_n, _pd_nsigma, _pd_type, so that no
 *     default of the compute core (sasmodels: 8 sigmas for schulz and
 *     lognormal) can apply behind the user's back. A distribution without
 *     nsigmas (uniform) sends SasFitForm.PD_NSIGMAS_UNUSED; the core ignores it.
 *   - With a structure factor both structure_factor_mode and
 *     radius_effective_mode are always sent (the core's defaults 0 / 1 happen
 *     to be the page's, so a missing key would go unnoticed).
 *   - A fitted width that is exactly 0 starts from SasFitForm.PD_FIT_START
 *     (design spec 5.7 item 12; the form already does this when the box is
 *     ticked, this is the second line of defence).
 *
 * Preview (plan M3, performance decisions 1-2): q is the finite q > 0 of the
 * dataset (`index` = their positions in the data, onData true), or the default
 * grid when there is no dataset or it has no such q (onData false, index
 * 0..n-1). cost = points x mesh x classWeight, mesh = SasFitForm.validate's.
 * Above PREVIEW_BUDGET the grid is thinned to max(PREVIEW_MIN_POINTS,
 * floor(PREVIEW_BUDGET / (mesh x classWeight))) evenly spaced points, first
 * and last included (decimated true). `cost` is the cost of the grid as
 * returned; if it still exceeds PREVIEW_PAUSE_COST, paused is true: the page
 * does not send the request by itself, only on the user's "update" button.
 * A fit always uses every point.
 *
 * Fitted values are written back ROUNDED (SasFitFormat.inputValue: two digits
 * beyond the error's second significant figure, 6 to 15 significant figures;
 * a value on a bound is kept exactly): writtenValues(form, fitResult).
 * "Continue from the current values" therefore starts from the rounded
 * values, less than 0.001 sigma away from the exact ones.
 *
 * resultMatchesForm replaces a "result is stale" flag: it compares
 * settings.modelSpec and EVERY key of fitResult.params (the fitted names
 * through the same rounding) with params(form), in both directions. Bounds and fit ticks do not take part. A stopped result
 * and an invalid form never match.
 *
 * Nothing given is modified; what is returned is frozen (typed arrays cannot
 * be; data arrays are passed on by reference, never copied or written to).
 * Programming errors throw an Error in English; the text for the user is the
 * `reason` of fitReadiness (Traditional Chinese).
 *
 * Pure logic: no DOM, no timers; other SasFit modules are read at call time.
 */

(function () {
    'use strict';

    const CUTOFF = 1e-5;                      // design spec 4.2, decision 15 (= SasFitEvaluate.DEFAULT_CUTOFF)
    const PREVIEW_BUDGET = 150000;            // about 230 ms for the cylinder class
    const PREVIEW_PAUSE_COST = 1300000;       // about 2 s by the same cost model
    const PREVIEW_MIN_POINTS = 50;
    const PREVIEW_GRID = Object.freeze({ log10Min: -3, log10Max: 0, points: 200 });      // the grid of gate G1
    // 1-D models that need an orientation average cost about 100x more per point (design spec 11)
    const HEAVY_MODELS = Object.freeze(['cylinder', 'core_shell_cylinder', 'ellipsoid', 'flexible_cylinder']);
    const CLASS_WEIGHT_HEAVY = 1;
    const CLASS_WEIGHT_LIGHT = 0.01;
    const PD_SUFFIX = '_pd';
    const STRUCTURE_MODE_ID = 'structure_factor_mode';
    const RADIUS_MODE_ID = 'radius_effective_mode';
    const SIGMA_MODE = 'sigma';
    const STOPPED = 'stopped';
    const REASONS = Object.freeze({
        noData: '請先載入資料並選擇作用中的資料。',
        invalidForm: '參數表有不合法的欄位，請先修正。',
        nothingFitted: '請至少勾選一個要擬合的參數。',
        noRange: '沒有可用的擬合範圍，請設定 Qmin 與 Qmax。',
        invertedRange: 'Qmin 不可大於 Qmax。',
        noSigma: '此資料沒有可用的誤差欄，不能使用「資料 σ」權重。',
        tooFewPoints: (nPoints, nFree) => '範圍內可參與擬合的資料點（' + nPoints + ' 點）必須多於要擬合的參數個數（' + nFree + ' 個）。',
    });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const numberOf = (text) => Number(text.trim());               // only for fields validate() has accepted
    const boundOf = (text, unbounded) => (text.trim() === '' ? unbounded : numberOf(text));

    function assertValid(form, what) {
        const { valid, errors } = globalThis.SasFitForm.validate(form);
        if (valid) return;
        const key = Object.keys(errors)[0];
        throw new Error(what + ': the form is not valid (' + key + ': ' + errors[key] + ')');
    }

    function modelSpec(form) {
        return Object.freeze({ model: form.model, structure: form.structure, lowQPowerLaw: form.lowQ });
    }

    /** The four dispersity entries of an open row. */
    function pdEntries(row) {
        const { pd, name } = row;
        const nsigmas = pd.hasNsigmas ? numberOf(pd.nsigmas) : globalThis.SasFitForm.PD_NSIGMAS_UNUSED;
        return [
            [name + PD_SUFFIX, numberOf(pd.width)], [name + '_pd_n', numberOf(pd.npts)],
            [name + '_pd_nsigma', nsigmas], [name + '_pd_type', pd.type],
        ];
    }

    const isOpen = (row) => row.pd !== null && row.pd.open;

    /** params of a form that is known to be valid. */
    function paramsOfValid(form) {
        const entries = [];
        globalThis.SasFitForm.rows(form).forEach((row) => {
            if (row.fittable) entries.push([row.name, numberOf(row.value)]);
            if (isOpen(row)) pdEntries(row).forEach((entry) => entries.push(entry));
        });
        if (form.structure !== null) {
            entries.push([STRUCTURE_MODE_ID, form.structureMode], [RADIUS_MODE_ID, form.radiusMode]);
        }
        return Object.freeze(Object.fromEntries(entries));
    }

    function params(form) {
        assertValid(form, 'params');
        return paramsOfValid(form);
    }

    // ------------------------------------------------------------- preview

    function previewGrid() {
        const { log10Min, log10Max, points } = PREVIEW_GRID;
        const step = (log10Max - log10Min) / (points - 1);
        return Float64Array.from({ length: points }, (_, i) => Math.pow(10, log10Min + i * step));
    }

    /** Positions of the finite q > 0 of a dataset. */
    function usableIndex(dataset) {
        const keep = [];
        for (let i = 0; i < dataset.q.length; i++) {
            if (Number.isFinite(dataset.q[i]) && dataset.q[i] > 0) keep.push(i);
        }
        return keep;
    }

    /** { q, index, onData } before any thinning. */
    function previewPoints(dataset) {
        const keep = dataset === null ? [] : usableIndex(dataset);
        if (keep.length === 0) {
            const q = previewGrid();
            return { q, index: Uint32Array.from(q, (_, i) => i), onData: false };
        }
        return { q: Float64Array.from(keep, (i) => dataset.q[i]), index: Uint32Array.from(keep), onData: true };
    }

    /** `count` positions 0..n-1, evenly spaced, first and last included (2 <= count <= n). */
    function evenPositions(n, count) {
        return Array.from({ length: count }, (_, k) => Math.round(k * (n - 1) / (count - 1)));
    }

    function previewRequest(form, dataset) {
        assertValid(form, 'previewRequest');
        const { mesh } = globalThis.SasFitForm.validate(form);
        const perPoint = mesh * (HEAVY_MODELS.indexOf(form.model) >= 0 ? CLASS_WEIGHT_HEAVY : CLASS_WEIGHT_LIGHT);
        const all = previewPoints(dataset === undefined ? null : dataset);
        const target = Math.max(PREVIEW_MIN_POINTS, Math.floor(PREVIEW_BUDGET / perPoint));
        const decimated = all.q.length * perPoint > PREVIEW_BUDGET && target < all.q.length;
        const picked = decimated ? evenPositions(all.q.length, target) : null;
        const q = decimated ? Float64Array.from(picked, (i) => all.q[i]) : all.q;
        const index = decimated ? Uint32Array.from(picked, (i) => all.index[i]) : all.index;
        const cost = q.length * perPoint;
        return Object.freeze({
            modelSpec: modelSpec(form), params: paramsOfValid(form), q, opts: Object.freeze({ cutoff: CUTOFF }),
            index, onData: all.onData, decimated, paused: cost > PREVIEW_PAUSE_COST, cost,
        });
    }

    // ------------------------------------------------------------- fit

    /** [{ name, fit, value, lower, upper }] of everything the page can fit, in table order (a width follows its parameter). */
    function fitItems(form) {
        const items = [];
        globalThis.SasFitForm.rows(form).forEach((row) => {
            if (row.fittable) items.push({ name: row.name, fit: row.fit, value: row.value, lower: row.lower, upper: row.upper });
            if (isOpen(row)) {
                const { pd } = row;
                items.push({ name: row.name + PD_SUFFIX, fit: pd.fit, value: pd.width, lower: pd.lower, upper: pd.upper, isWidth: true });
            }
        });
        return items;
    }

    const notReady = (reason, nPoints, nFree) => Object.freeze({ ok: false, reason, nPoints, nFree });

    function fitReadiness(form, dataset, settings) {
        const weighting = globalThis.SasFitWeighting;
        const { range, weighting: mode } = isObject(settings) ? settings : {};
        if (weighting.MODES.indexOf(mode) < 0) throw new Error('Unknown weighting mode: ' + String(mode));
        if (!isObject(dataset)) return notReady(REASONS.noData, null, null);
        if (!globalThis.SasFitForm.validate(form).valid) return notReady(REASONS.invalidForm, null, null);
        const nFree = fitItems(form).filter((item) => item.fit).length;
        if (nFree === 0) return notReady(REASONS.nothingFitted, null, 0);
        if (!isObject(range)) return notReady(REASONS.noRange, null, nFree);
        if (!(range.qMin <= range.qMax)) return notReady(REASONS.invertedRange, null, nFree);
        if (mode === SIGMA_MODE && weighting.defaultMode(dataset) !== SIGMA_MODE) return notReady(REASONS.noSigma, null, nFree);
        const nPoints = weighting.select(dataset, mode, range).index.length;
        if (nPoints <= nFree) return notReady(REASONS.tooFewPoints(nPoints, nFree), nPoints, nFree);
        return Object.freeze({ ok: true, reason: null, nPoints, nFree });
    }

    function fitJob(form, dataset, settings) {
        const ready = fitReadiness(form, dataset, settings);
        if (!ready.ok) throw new Error('fitJob: not ready to fit: ' + ready.reason);
        const items = fitItems(form);
        const fitted = items.filter((item) => item.fit);
        const starts = fitted.filter((item) => item.isWidth && numberOf(item.value) === 0)
            .map((item) => [item.name, globalThis.SasFitForm.PD_FIT_START]);
        const { range, weighting, maxSteps } = settings;
        return Object.freeze({
            modelSpec: modelSpec(form),
            params: Object.freeze({ ...paramsOfValid(form), ...Object.fromEntries(starts) }),
            fitFlags: Object.freeze(Object.fromEntries(items.map((item) => [item.name, item.fit]))),
            bounds: Object.freeze(Object.fromEntries(fitted.map((item) => [item.name,
                Object.freeze([boundOf(item.lower, -Infinity), boundOf(item.upper, Infinity)])]))),
            data: Object.freeze({
                q: dataset.q, I: dataset.I, sigma: dataset.sigma === undefined ? null : dataset.sigma,
                kind: dataset.kind === undefined ? 'generic' : dataset.kind,       // decides the mask in the Worker (decision D1)
            }),
            range: Object.freeze({ qMin: range.qMin, qMax: range.qMax }),
            weighting,
            options: Object.freeze({ maxSteps, cutoff: CUTOFF }),
        });
    }

    const fullRange = (dataset) => globalThis.SasFitState.fullRange(dataset);

    // ------------------------------------------------------------- results

    function sameSpec(form, fitResult) {
        const theirs = isObject(fitResult.settings) ? fitResult.settings.modelSpec : null;
        const mine = modelSpec(form);
        return isObject(theirs) && Object.keys(mine).every((key) => theirs[key] === mine[key]);
    }

    function assertResult(fitResult, what) {
        if (!isObject(fitResult) || !isObject(fitResult.params) || !Array.isArray(fitResult.names)) {
            throw new Error(what + ' needs a FitResult');
        }
    }

    /** [lower, upper] of a fitted name as the form has them now (an empty or unreadable bound is open). */
    function boundsOf(form, name) {
        const base = name.slice(0, -PD_SUFFIX.length);
        const holder = has(form.fields, name) ? form.fields[name]
            : (name.endsWith(PD_SUFFIX) && has(form.pds, base) ? form.pds[base] : null);
        if (holder === null) return null;
        const read = (text, open) => (typeof text === 'string' && text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : open);
        return [read(holder.lower, -Infinity), read(holder.upper, Infinity)];
    }

    /**
     * { name: number } of the fitted names as the page writes and shows them: rounded by SasFitFormat.inputValue
     * with the error the page displays (a value on a bound stays exactly there). applyResult writes these numbers
     * and resultMatchesForm compares with them, so a result matches the form it was written into.
     */
    function writtenValues(form, fitResult) {
        const format = globalThis.SasFitFormat;
        const shown = isObject(fitResult.errors) || isObject(fitResult.errorsScaled) ? globalThis.SasFitWorkerCore.displayErrors(fitResult) : null;
        const atBound = isObject(fitResult.atBound) ? fitResult.atBound : {};
        return Object.freeze(Object.fromEntries(fitResult.names.map((name) => {
            const exact = fitResult.params[name];
            if (has(atBound, name)) return [name, exact];
            return [name, format.inputValue(exact, isObject(shown) ? shown[name] : NaN, boundsOf(form, name))];
        })));
    }

    /** The fitted values (fitResult.names) written into the form, rounded (writtenValues); everything else stays as it is. */
    function applyResult(form, fitResult) {
        assertResult(fitResult, 'applyResult');
        if (fitResult.names.length === 0) return form;
        if (!sameSpec(form, fitResult)) {
            throw new Error('applyResult: the result belongs to ' + JSON.stringify(fitResult.settings && fitResult.settings.modelSpec)
                + ', the form is ' + JSON.stringify(modelSpec(form)));
        }
        return globalThis.SasFitForm.reduce(form, { type: 'applyValues', values: writtenValues(form, fitResult) });
    }

    function resultMatchesForm(form, fitResult) {
        if (!isObject(fitResult) || !isObject(fitResult.params) || fitResult.status === STOPPED) return false;
        if (!sameSpec(form, fitResult) || !globalThis.SasFitForm.validate(form).valid) return false;
        const mine = paramsOfValid(form);
        const theirs = { ...fitResult.params, ...(Array.isArray(fitResult.names) ? writtenValues(form, fitResult) : {}) };
        const keys = Object.keys(theirs);
        return keys.length === Object.keys(mine).length && keys.every((key) => has(mine, key) && mine[key] === theirs[key]);
    }

    globalThis.SasFitJobs = Object.freeze({
        CUTOFF, PREVIEW_BUDGET, PREVIEW_PAUSE_COST, PREVIEW_MIN_POINTS,
        modelSpec, params, previewGrid, previewRequest, fitReadiness, fitJob, fullRange, writtenValues, applyResult, resultMatchesForm,
    });
})();
