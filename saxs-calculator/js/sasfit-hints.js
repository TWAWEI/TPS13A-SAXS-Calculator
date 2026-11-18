/**
 * sasfit-hints.js -- which messages the SAS fitting page shows, as data
 * (design spec 5.7, 12, 16; plan M3 Task 7). Original code.
 *
 * A hint is a frozen { id, tone: 'ok' | 'warn' | 'error', text, ... }: plain
 * text in Traditional Chinese, never HTML (SasFitHtml escapes and renders it).
 * Ids are fixed; some hints carry extra data (action, params, pairs, factor,
 * zero / negative).
 *
 *   fitHints(fitResult) -> hints about a FitResult, in the order of FIT_HINT_IDS
 *     stopped              a stopped fit: the only hint it gets
 *     blocked              status 'failed' with blockedByNonFinite (5.7 item 3)
 *     failed               status 'failed' without it (does not happen today)
 *     maxiter              action 'continue': fit on from the current values (item 7)
 *     zero-steps           converged without an accepted step (item 2)
 *     local-minimum        converged with chi2r > CHI2R_WARN (item 1)
 *     overestimated-errors chi2r < CHI2R_LOW, only when the weighting is the
 *                          data's sigma: the other weightings do not use the
 *                          data's errors, so the sentence would not hold
 *     jacobian-nan         jacobianNonFinite; names the parameters without an
 *                          error (item 3); never speaks of correlation
 *     ill-conditioned      illConditioned (item 3)
 *     at-bound             parameters on a bound: their errors mean nothing (item 5)
 *     undetermined         fitted parameters whose displayed error is >= |value|
 *                          (SasFitFormat.isUndetermined): the data do not determine them
 *     strong-correlation   pairs with |correlation| > CORRELATION_WARN (item 6)
 *     non-finite-curve     nonFiniteCurvePoints > 0 (item 4)
 *     scaled-errors        the errors shown are multiplied by sqrt(chi2r);
 *                          SasView shows them unmultiplied (item 8)
 *   statusLabel(fitResult | null) -> { text, tone }: one text per status. A
 *     converged fit is 'ok' only while chi2r gives no reason for doubt, so the
 *     chip never says "good" by itself (item 1).
 *   strongCorrelations(fitResult, threshold?) -> [{ a, b, r }], each pair once
 *   errorColumn(fitResult | null) -> { label, title } of the error column
 *   preFitHints({ modelSpec, dataset, range, weighting, notes }) -> hints before
 *     a fit, in the order of PRE_FIT_HINT_IDS
 *     hayter               hayter_msa is selected (item 10, spec 16); shown
 *                          with or without data
 *     no-sigma             SasFitWeighting.defaultMode(dataset) is 'none'
 *                          (item 13): decided from the data, not from a flag
 *     invalid-sigma        official file with sigma = 0 rows and a weighting other
 *                          than sigma: those rows are never fitted (decision D1)
 *     nonpositive-weight   sqrtI / absI weighting with I <= 0 in the range (item 11)
 *     suspect-nm           notes.suspectNm of the file
 *   excludedCounts(dataset) -> { sigma, sqrtI, absI, none }: points each
 *     weighting leaves out (item 11); sigma is null without an error column
 *   plotStatus({ computing, paused, previewPoints, hidden, displayStride,
 *                nonFinite, allNonFinite, error }) -> { text, live }
 *     the status line under the plot; `live` (for the aria-live region) is the
 *     same without "computing".
 *   errorNotice(err, source: 'preview' | 'fit') -> { where, text, detail }
 *     where: 'ignore' | 'preview' | 'fit' | 'page'. text is the error's own
 *     message (already Chinese); detail is technical and goes to console.warn
 *     (item 9). ERROR_ROUTES lists every code of SasFitWorkerCore and
 *     SasFitWorkerClient; anything else goes to the page with a general text.
 *
 * Non-finite numbers in a FitResult (hayter_msa, spec 16) are expected input:
 * nothing here throws on them.
 *
 * Pure logic: no DOM, no HTML, no timers; the only other global is
 * SasFitWeighting, read at call time.
 */

(function () {
    'use strict';

    const CHI2R_WARN = 10;
    const CHI2R_LOW = 0.1;
    const CORRELATION_WARN = 0.98;
    const SIGMA_MODE = 'sigma';
    const NO_WEIGHT_MODE = 'none';
    const HAYTER = 'hayter_msa';
    const SEPARATOR = '；';
    const LIST_SEPARATOR = '、';
    const MINUS = '−';
    const FACTOR_DIGITS = 3;
    const FACTOR_PLAIN_FROM = 1000;
    const AT_BOUND_ERROR_TEXT = '貼邊界，誤差無意義';                    // design spec 5.7 item 5 (the error column)
    const ERROR_LABEL = '±';
    const ERROR_LABEL_SCALED = '±（已乘 √χ²ᵣ）';
    const BOUND_NAMES = Object.freeze({ lower: '下限', upper: '上限' });
    const STATUS_LABELS = Object.freeze({
        converged: Object.freeze({ text: '已收斂', tone: 'ok' }),
        maxiter: Object.freeze({ text: '未收斂（達最大步數）', tone: 'warn' }),
        stopped: Object.freeze({ text: '已停止', tone: 'warn' }),
        failed: Object.freeze({ text: '失敗', tone: 'error' }),
    });
    const NOT_FITTED = Object.freeze({ text: '未擬合', tone: 'warn' });
    const FIT_HINT_IDS = Object.freeze(['stopped', 'blocked', 'failed', 'maxiter', 'zero-steps', 'local-minimum',
        'overestimated-errors', 'jacobian-nan', 'ill-conditioned', 'at-bound', 'undetermined', 'strong-correlation', 'non-finite-curve',
        'scaled-errors']);
    const PRE_FIT_HINT_IDS = Object.freeze(['hayter', 'no-sigma', 'invalid-sigma', 'nonpositive-weight', 'suspect-nm']);
    const TEXT = Object.freeze({
        blocked: '在這組參數附近模型無法計算，擬合無法繼續；下列為目前最好的參數。請調整起始值或上下限後重試',
        failed: '擬合失敗，請調整起始值或上下限後重試',
        maxiter: '已達最大步數仍未收斂，可從目前的值繼續擬合',
        zeroSteps: '擬合沒有走任何一步：起始點已是極小值，或一步都走不動',
        localMinimum: '擬合可能停在局部極小值，請調整起始值後重試',
        overestimated: 'χ²ᵣ 遠小於 1：資料的誤差可能被高估',
        jacobianRest: '其餘參數的誤差是把這些參數固定後算出的，數值偏小',
        illConditioned: '參數相關性過高，誤差不可靠',
        hayter: '結構因子 hayter_msa 在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同），'
            + '擬合得到的誤差可能不可靠；請連同 χ²ᵣ 一起判斷結果',
        noSigmaUnweighted: '此檔沒有可用的誤差欄，權重使用不加權',
        noSigmaOther: '此檔沒有可用的誤差欄，不能使用「資料 σ」權重',
        suspectNm: 'q 範圍像是 nm⁻¹（一般 SAXS 在 Å⁻¹ 下 q 約 0.003–0.5）：若單位確實是 nm⁻¹，請移除此檔，把 Q 單位改選 nm⁻¹ 後重新載入',
        computing: '計算中…',
        paused: '多分散網格過大，即時預覽已暫停，請按「更新曲線」',
        allNonFinite: '這組參數算不出模型曲線，請檢查數值',
        scaledNoFactor: '顯示的誤差已乘 √χ²ᵣ。SasView 顯示的是未乘的值，兩者相差 √χ²ᵣ 倍',
        general: '發生未預期的錯誤，請重新整理頁面後再試',
        openOverHttp: '請確認此頁是以 http(s) 開啟（不是 file://），並重新整理頁面',
    });
    const nonFiniteCurveText = (count) => '模型曲線有 ' + count + ' 點無法計算';
    // 'source': shown where the request came from (the preview or the fit)
    const ERROR_ROUTES = Object.freeze({
        SUPERSEDED: 'ignore', STOPPED: 'ignore', BUSY: 'ignore',
        BAD_PARAMS: 'source', UNKNOWN_MODEL: 'source',
        TOO_FEW_POINTS: 'fit', BAD_RANGE: 'fit', BAD_BOUNDS: 'fit', BAD_FIT_FLAGS: 'fit', BAD_WEIGHTING: 'fit',
        BAD_OPTIONS: 'fit', BAD_DATA: 'fit',
        WASM_LOAD: 'page', WASM_TRAP: 'page', WORKER_CRASH: 'page', WORKER_START_FAILED: 'page', INTERNAL: 'page',
        BAD_MESSAGE: 'page', UNKNOWN_TYPE: 'page', POST_FAILED: 'page', DISPOSED: 'page',
    });
    const ERROR_REMEDIES = Object.freeze({ WASM_LOAD: TEXT.openOverHttp, WORKER_START_FAILED: TEXT.openOverHttp });
    const ERROR_SOURCES = Object.freeze(['preview', 'fit']);

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const hint = (id, tone, text, extra) => Object.freeze({ id, tone, text, ...extra });
    const weightingOf = (fitResult) => (isObject(fitResult.settings) ? fitResult.settings.weighting : undefined);

    // ------------------------------------------------------------- after a fit

    const chi2rHigh = (r) => Number.isFinite(r.chi2r) && r.chi2r > CHI2R_WARN;
    const chi2rLow = (r) => Number.isFinite(r.chi2r) && r.chi2r < CHI2R_LOW && weightingOf(r) === SIGMA_MODE;

    function statusLabel(fitResult) {
        if (fitResult === null || fitResult === undefined) return NOT_FITTED;
        if (!has(STATUS_LABELS, fitResult.status)) throw new Error('Unknown fit status: ' + String(fitResult.status));
        const label = STATUS_LABELS[fitResult.status];
        const doubtful = !Number.isFinite(fitResult.chi2r) || chi2rHigh(fitResult) || chi2rLow(fitResult);
        return label.tone === 'ok' && doubtful ? Object.freeze({ text: label.text, tone: 'warn' }) : label;
    }

    function strongCorrelations(fitResult, threshold) {
        const limit = threshold === undefined ? CORRELATION_WARN : threshold;
        const { names, correlation } = fitResult;
        const pairs = [];
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const r = correlation[i][j];
                if (Number.isFinite(r) && Math.abs(r) > limit) pairs.push(Object.freeze({ a: names[i], b: names[j], r }));
            }
        }
        return Object.freeze(pairs);
    }

    /** Two decimals; a value that would round to 1.00 without being 1 shows four, cut off (0.99996 -> 0.9999). */
    function correlationText(r) {
        const size = Math.abs(r);
        const rounded = size.toFixed(2);
        const text = size < 1 && Number(rounded) >= 1 ? (Math.floor(size * 1e4) / 1e4).toFixed(4) : rounded;
        return (r < 0 ? MINUS : '') + text;
    }

    function correlationHint(fitResult) {
        const pairs = strongCorrelations(fitResult);
        if (pairs.length === 0) return null;
        const text = pairs.map((p) => p.a + ' 與 ' + p.b + ' 高度相關（' + correlationText(p.r) + '）').join(SEPARATOR);
        return hint('strong-correlation', 'warn', text, { pairs });
    }

    function jacobianHint(fitResult) {
        if (!fitResult.jacobianNonFinite) return null;
        const params = fitResult.names.filter((name) => !Number.isFinite(fitResult.errors[name]));
        const text = params.length === 0
            ? '部分參數的誤差無法計算；' + TEXT.jacobianRest
            : '下列參數的誤差無法計算：' + params.join(LIST_SEPARATOR) + '。' + TEXT.jacobianRest;
        return hint('jacobian-nan', 'warn', text, { params: Object.freeze(params) });
    }

    function atBoundHint(fitResult) {
        const params = Object.keys(fitResult.atBound).map((name) => Object.freeze({ name, bound: fitResult.atBound[name] }));
        if (params.length === 0) return null;
        const list = params.map((p) => p.name + '（' + BOUND_NAMES[p.bound] + '）').join(LIST_SEPARATOR);
        return hint('at-bound', 'warn', '下列參數停在邊界上，誤差沒有意義：' + list, { params: Object.freeze(params) });
    }

    /** Fitted parameters whose displayed error is at least as large as the value (not those on a bound: they have their own hint). */
    function undeterminedHint(fitResult) {
        const errors = globalThis.SasFitWorkerCore.displayErrors(fitResult);
        if (!isObject(errors) || !isObject(fitResult.params)) return null;
        const params = fitResult.names.filter((name) => !has(fitResult.atBound || {}, name)
            && globalThis.SasFitFormat.isUndetermined(fitResult.params[name], errors[name]));
        if (params.length === 0) return null;
        return hint('undetermined', 'warn', '下列參數的誤差大於數值，無法由資料決定：' + params.join(LIST_SEPARATOR), { params: Object.freeze(params) });
    }

    /** sqrt(chi2r) when the page shows the multiplied errors and the factor is a usable number, else null. */
    function scaleFactor(fitResult) {
        const factor = Math.sqrt(fitResult.chi2r);
        return Number.isFinite(factor) && factor > 0 ? factor : null;
    }

    function scaledErrorsText(fitResult) {
        const factor = scaleFactor(fitResult);
        if (factor === null) return TEXT.scaledNoFactor;
        const f = factor >= FACTOR_PLAIN_FROM ? String(Math.round(factor)) : factor.toPrecision(FACTOR_DIGITS);
        return '顯示的誤差已乘 √χ²ᵣ（= ' + f + '）。SasView 顯示的是未乘的值，兩者相差 ' + f + ' 倍：把此處的誤差除以 ' + f + ' 即為 SasView 的數值';
    }

    function errorColumn(fitResult) {
        const scaled = isObject(fitResult) && fitResult.displayErrorsScaled === true && fitResult.status !== 'stopped';
        return Object.freeze(scaled
            ? { label: ERROR_LABEL_SCALED, title: scaledErrorsText(fitResult) }
            : { label: ERROR_LABEL, title: '' });
    }

    /** The hints that depend on how the fit ended. */
    function statusHints(r) {
        const converged = r.status === 'converged';
        return [
            r.status === 'failed' && r.blockedByNonFinite ? hint('blocked', 'error', TEXT.blocked) : null,
            r.status === 'failed' && !r.blockedByNonFinite ? hint('failed', 'error', TEXT.failed) : null,
            r.status === 'maxiter' ? hint('maxiter', 'warn', TEXT.maxiter, { action: 'continue' }) : null,
            converged && r.iterations === 0 ? hint('zero-steps', 'warn', TEXT.zeroSteps) : null,
            converged && chi2rHigh(r) ? hint('local-minimum', 'warn', TEXT.localMinimum) : null,
            r.status !== 'failed' && chi2rLow(r) ? hint('overestimated-errors', 'warn', TEXT.overestimated) : null,
        ];
    }

    /** The hints about the errors and the curve. */
    function qualityHints(r) {
        return [
            jacobianHint(r),
            r.illConditioned ? hint('ill-conditioned', 'warn', TEXT.illConditioned) : null,
            atBoundHint(r),
            undeterminedHint(r),
            correlationHint(r),
            r.nonFiniteCurvePoints > 0 ? hint('non-finite-curve', 'warn', nonFiniteCurveText(r.nonFiniteCurvePoints)) : null,
            r.displayErrorsScaled ? hint('scaled-errors', 'ok', scaledErrorsText(r), { factor: scaleFactor(r) }) : null,
        ];
    }

    function fitHints(fitResult) {
        if (fitResult === null || fitResult === undefined) return Object.freeze([]);
        if (!has(STATUS_LABELS, fitResult.status)) throw new Error('Unknown fit status: ' + String(fitResult.status));
        if (fitResult.status === 'stopped') {
            return Object.freeze([hint('stopped', 'ok', '已停止（第 ' + fitResult.iterations + ' 步）')]);
        }
        return Object.freeze(statusHints(fitResult).concat(qualityHints(fitResult)).filter((h) => h !== null));
    }

    // ------------------------------------------------------------- before a fit

    /**
     * { zero, negative } in qMin <= q <= qMax: points left out because I = 0, and points with I < 0 that DO take
     * part. Both only among the points that are valid otherwise (the mask of weighting 'none': an official file's
     * sigma = 0 rows are not among them).
     */
    function nonPositiveCounts(dataset, range) {
        const valid = globalThis.SasFitWeighting.mask(dataset, NO_WEIGHT_MODE);
        const counts = { zero: 0, negative: 0 };
        for (let i = 0; i < dataset.q.length; i++) {
            const q = dataset.q[i];
            if (valid[i] !== 1 || !(q >= range.qMin && q <= range.qMax)) continue;
            if (dataset.I[i] === 0) counts.zero += 1;
            else if (dataset.I[i] < 0) counts.negative += 1;
        }
        return counts;
    }

    /** Official files: the rows that no weighting uses (decision D1). Not shown with sigma weighting, where it is plain. */
    function invalidSigmaHint(dataset, weighting) {
        if (weighting === SIGMA_MODE) return null;
        const count = globalThis.SasFitWeighting.countInvalidSigma(dataset);
        if (count === 0) return null;
        return hint('invalid-sigma', 'ok', '此檔有 ' + count + ' 點 σ＝0（光束擋片區或無效的點）：官方檔的這些點在任何權重下都不參與擬合', { count });
    }

    function nonPositiveHint(dataset, range, weighting) {
        if (weighting === SIGMA_MODE || weighting === NO_WEIGHT_MODE || !isObject(range)) return null;
        const { zero, negative } = nonPositiveCounts(dataset, range);
        if (zero + negative === 0) return null;
        const parts = [];
        if (zero > 0) parts.push('I＝0 的 ' + zero + ' 點被排除');
        if (negative > 0) parts.push('I < 0 的 ' + negative + ' 點以 |I| 當權重，接近 0 的負值權重極小，會主導擬合');
        const text = '擬合範圍內有 ' + (zero + negative) + ' 點 I ≤ 0：' + parts.join(SEPARATOR);
        return hint('nonpositive-weight', 'warn', text, { zero, negative });
    }

    function noSigmaHint(dataset, weighting) {
        if (globalThis.SasFitWeighting.defaultMode(dataset) !== NO_WEIGHT_MODE) return null;
        return hint('no-sigma', 'warn', weighting === NO_WEIGHT_MODE ? TEXT.noSigmaUnweighted : TEXT.noSigmaOther);
    }

    function preFitHints(input) {
        const { modelSpec, dataset, range, weighting, notes } = isObject(input) ? input : {};
        const hints = [isObject(modelSpec) && modelSpec.structure === HAYTER ? hint('hayter', 'warn', TEXT.hayter) : null];
        if (isObject(dataset)) {
            hints.push(noSigmaHint(dataset, weighting), invalidSigmaHint(dataset, weighting), nonPositiveHint(dataset, range, weighting),
                isObject(notes) && notes.suspectNm === true ? hint('suspect-nm', 'warn', TEXT.suspectNm) : null);
        }
        return Object.freeze(hints.filter((h) => h !== null));
    }

    function excludedCounts(dataset) {
        if (!isObject(dataset)) return null;
        const weighting = globalThis.SasFitWeighting;
        return Object.freeze(Object.fromEntries(weighting.MODES.map((mode) => [mode,
            mode === SIGMA_MODE && !dataset.sigma ? null : weighting.countExcluded(dataset, mode)])));
    }

    // ------------------------------------------------------------- plot status

    function plotStatus(input) {
        const s = isObject(input) ? input : {};
        const parts = [
            s.paused ? TEXT.paused : null,
            s.previewPoints > 0 ? '預覽以 ' + s.previewPoints + ' 點計算' : null,
            s.displayStride > 1 ? '點數較多，圖上每 ' + s.displayStride + ' 點顯示 1 點（擬合仍使用全部點）' : null,
            s.hidden > 0 ? '隱藏了 ' + s.hidden + ' 點' : null,
            s.allNonFinite ? TEXT.allNonFinite : null,
            !s.allNonFinite && s.nonFinite > 0 ? nonFiniteCurveText(s.nonFinite) : null,
            typeof s.error === 'string' && s.error !== '' ? s.error : null,
        ].filter((part) => part !== null);
        const live = parts.join(SEPARATOR);
        return Object.freeze({ text: (s.computing ? [TEXT.computing] : []).concat(parts).join(SEPARATOR), live });
    }

    // ------------------------------------------------------------- errors

    function technicalText(err) {
        if (!(err instanceof Error)) return String(err);
        if (typeof err.detail === 'string') return err.detail;
        return typeof err.code === 'string' && has(ERROR_ROUTES, err.code) ? '' : String(err.stack || err.message);
    }

    function errorNotice(err, source) {
        if (ERROR_SOURCES.indexOf(source) < 0) throw new Error('errorNotice: source must be one of ' + ERROR_SOURCES.join(', '));
        const detail = technicalText(err);
        const code = err instanceof Error && typeof err.code === 'string' && has(ERROR_ROUTES, err.code) ? err.code : null;
        if (code === null) return Object.freeze({ where: 'page', text: TEXT.general, detail });
        const route = ERROR_ROUTES[code];
        if (route === 'ignore') return Object.freeze({ where: 'ignore', text: '', detail });
        const text = err.message + (has(ERROR_REMEDIES, code) ? ERROR_REMEDIES[code] : '');
        return Object.freeze({ where: route === 'source' ? source : route, text, detail });
    }

    globalThis.SasFitHints = Object.freeze({
        CHI2R_WARN, CHI2R_LOW, CORRELATION_WARN, AT_BOUND_ERROR_TEXT, FIT_HINT_IDS, PRE_FIT_HINT_IDS, ERROR_ROUTES,
        fitHints, statusLabel, strongCorrelations, errorColumn, preFitHints, excludedCounts, plotStatus, errorNotice,
    });
})();
