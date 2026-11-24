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
 *   measure(fitResult | weighting) -> { isChi2, label, note }: the fit measure
 *     is "chi2r" only with sigma weighting; otherwise "加權殘差均方" with a note
 *     that it has no absolute meaning (decision H-1). local-minimum and
 *     overestimated-errors exist only for a real chi2r.
 *   statusLabel(fitResult | null) -> { text, tone, short }: one text per
 *     status. A converged fit is 'ok' only while the measure is finite, a real
 *     chi2r gives no reason for doubt and no flag (ill-conditioned, Jacobian or
 *     curve not finite) is set; otherwise the TEXT says why ("已收斂・約化 χ²
 *     偏大" / "偏小" with sigma weighting, "已收斂・有警示" for a flag), so the
 *     tone is never the only cue. short: that reason for a narrow chip.
 *   strongCorrelations(fitResult, threshold?) -> [{ a, b, r }], each pair once
 *   errorColumn(fitResult | null) -> { label, title } of the error column
 *   preFitHints({ modelSpec, dataset, range, weighting, notes, fit }) -> hints
 *     before a fit, in the order of PRE_FIT_HINT_IDS
 *     hayter               hayter_msa is selected (item 10, spec 16); shown
 *                          with or without data
 *     fixed-size           fit = SasFitJobs.fitNames(form): the model has size
 *                          parameters and none is ticked (first-fit guidance);
 *                          local-minimum says the same after a fit with a
 *                          chi2r > CHI2R_WARN
 *     no-sigma             SasFitWeighting.defaultMode(dataset) is 'none'
 *                          (item 13): decided from the data, not from a flag
 *     invalid-sigma        official file with sigma = 0 rows and a weighting other
 *                          than sigma: those rows are never fitted (decision D1)
 *     nonpositive-weight   sqrtI / absI weighting with I <= 0 in the range (item 11)
 *     suspect-nm           notes.suspectNm of the file
 *   excludedCounts(dataset) -> { sigma, sqrtI, absI, none }: points each
 *     weighting leaves out (item 11); sigma is null without an error column
 *   plotStatus({ computing, paused, fresh, stale, zoomed, previewPoints, hidden,
 *                mode, displayStride, nonFinite, allNonFinite, error }) -> { text, live }
 *     the status line under the plot; `live` (for the aria-live region) is the
 *     same without "computing". A paused preview has three states: not updated
 *     (paused), being computed (only "computing"), updated by hand (fresh).
 *     stale: a field error keeps the old curve on screen.
 *   errorNotice(err, source: 'preview' | 'fit') -> { where, text, detail }
 *     where: 'ignore' | 'preview' | 'fit' | 'page'. text is the error's own
 *     message (already Chinese); detail is technical and goes to console.warn
 *     (item 9). ERROR_ROUTES lists every code of SasFitWorkerCore and
 *     SasFitWorkerClient; anything else goes to the page with a general text.
 *
 * Non-finite numbers in a FitResult (hayter_msa, spec 16) are expected input:
 * nothing here throws on them.
 *
 * Pure logic: no DOM, no HTML, no timers; the other globals (SasFitWeighting,
 * SasFitWorkerCore, SasFitFormat, SasFitJobs.sizeNames) are read at call time.
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
    const AT_BOUND_ERROR_TEXT = '貼邊界，誤差無意義';                    // design spec 5.7 item 5 (the result tile)
    const AT_BOUND_SHORT = Object.freeze({ lower: '貼下限', upper: '貼上限' });      // the error column: the hint has the sentence
    const ERROR_LABEL = '±';
    const ERROR_LABEL_SCALED = '±（已乘 √均方）';
    // label is plain text (progress line, live region, select, aria-label); SasFitHtml writes chi-square with <sup> / <sub>
    const MEASURE_CHI2 = Object.freeze({ isChi2: true, label: '約化 χ²', note: '' });
    const MEASURE_RELATIVE = Object.freeze({
        isChi2: false, label: '加權殘差均方',
        note: '權重不是資料的 σ：這個數值沒有絕對意義（不是約化 χ²），只能比較同一組資料、同一種權重的不同擬合',
    });
    const HIDDEN_TEXT = Object.freeze({
        loglog: (n) => n + ' 點 I ≤ 0 或無效，對數軸無法顯示（不影響擬合）',
        guinier: (n) => n + ' 點 I ≤ 0 或無效，Guinier 座標（ln I）無法顯示（不影響擬合）',
        kratky: (n) => n + ' 點的 q 或 I 不是有效數值，無法顯示',
        porod: (n) => n + ' 點的 q 或 I 不是有效數值，無法顯示',
    });
    const BOUND_NAMES = Object.freeze({ lower: '下限', upper: '上限' });
    const STATUS_LABELS = Object.freeze({
        converged: Object.freeze({ text: '已收斂', tone: 'ok' }),
        maxiter: Object.freeze({ text: '未收斂（達最大步數）', tone: 'warn' }),
        stopped: Object.freeze({ text: '已停止', tone: 'warn' }),
        failed: Object.freeze({ text: '失敗', tone: 'error' }),
    });
    const NOT_FITTED = Object.freeze({ text: '未擬合', tone: 'warn', short: '' });
    // what makes "converged" doubtful, in words: the tone of the chip alone would say it by colour only (WCAG 1.4.1)
    const DOUBT = Object.freeze({
        high: Object.freeze({ text: '約化 χ² 偏大', short: '偏大' }),
        low: Object.freeze({ text: '約化 χ² 偏小', short: '偏小' }),
        flagged: Object.freeze({ text: '有警示', short: '有警示' }),
    });
    const STATUS_SHORT = Object.freeze({ converged: '', maxiter: '未收斂', stopped: '已停止', failed: '失敗' });
    const STATUS_SEPARATOR = '・';
    const FIT_HINT_IDS = Object.freeze(['stopped', 'blocked', 'failed', 'maxiter', 'zero-steps', 'local-minimum',
        'overestimated-errors', 'jacobian-nan', 'ill-conditioned', 'at-bound', 'undetermined', 'strong-correlation', 'non-finite-curve',
        'scaled-errors']);
    const PRE_FIT_HINT_IDS = Object.freeze(['hayter', 'fixed-size', 'no-sigma', 'invalid-sigma', 'nonpositive-weight', 'suspect-nm']);
    const TEXT = Object.freeze({
        blocked: '在這組參數附近模型無法計算，擬合無法繼續；下列為目前最好的參數。請調整起始值或上下限後重試',
        failed: '擬合失敗，請調整起始值或上下限後重試',
        maxiter: '已達最大步數仍未收斂，可從目前的值繼續擬合',
        zeroSteps: '擬合沒有走任何一步：起始點已是極小值，或一步都走不動',
        localMinimum: '約化 χ² 遠大於 1：模型與資料不符。可能停在局部極小值（請換起始值重試）、模型不適用，或資料誤差被低估。此時參數誤差沒有參考價值',
        fixedSize: (names) => '也可能是尺寸參數被固定：' + names + ' 沒有勾選擬合，請換起始值，或到「模型」勾選要擬合的尺寸參數',
        overestimated: '約化 χ² 遠小於 1：資料的誤差可能被高估，或自由參數過多',
        jacobianRest: '其餘參數的誤差是把這些參數固定後算出的，數值偏小',
        illConditioned: '參數無法由資料獨立決定（彼此高度相關，或某個參數對曲線幾乎沒有影響），誤差不可靠',
        hayter: '結構因子 hayter_msa 在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同），'
            + '擬合得到的誤差可能不可靠；請連同殘差圖一起判斷結果',
        noSigmaUnweighted: '此檔沒有可用的誤差欄，權重使用不加權',
        noSigmaOther: '此檔沒有可用的誤差欄，不能使用「資料 σ」權重',
        suspectNm: 'q 範圍像是 nm⁻¹（一般 SAXS 在 Å⁻¹ 下 q 約 0.003–0.5）：若單位確實是 nm⁻¹，請移除此檔，把 q 單位改選 nm⁻¹ 後重新載入',
        computing: '計算中…',
        paused: '即時預覽已暫停（多分散網格過大），曲線尚未更新；按「更新曲線」重算',
        pausedFresh: '曲線已更新（手動）；再改參數後需再按「更新曲線」',
        staleCurve: '參數表有錯誤，曲線尚未更新',
        zoomed: '已縮放',
        locked: '擬合進行中，參數與資料已鎖定',
        notFittedYet: '此資料尚未擬合',
        revertOther: (name) => '可還原的是「' + name + '」擬合前的參數；請先把它設為擬合對象',
        allNonFinite: '這組參數算不出模型曲線，請檢查數值',
        scaledNoFactor: '誤差已乘 √(加權殘差均方)；SasView 在相同權重下顯示未乘的值',
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

    /**
     * What the fit measure (FitResult.chi2r) is called: chi2r only when the weights are the data's sigma (decision
     * H-1). Takes a FitResult or the name of a weighting; anything else is not a chi-square.
     */
    function measure(source) {
        const weighting = isObject(source) ? weightingOf(source) : source;
        return weighting === SIGMA_MODE ? MEASURE_CHI2 : MEASURE_RELATIVE;
    }

    // high / low only mean something for a real chi-square
    const chi2rHigh = (r) => measure(r).isChi2 && Number.isFinite(r.chi2r) && r.chi2r > CHI2R_WARN;
    const chi2rLow = (r) => measure(r).isChi2 && Number.isFinite(r.chi2r) && r.chi2r < CHI2R_LOW;
    /** Flags that make "converged" doubtful whatever the weighting. */
    const flagged = (r) => r.illConditioned === true || r.jacobianNonFinite === true || r.nonFiniteCurvePoints > 0;

    /** Why a converged fit is doubtful, or null: chi-square too high / too low (sigma weighting only), or a flag. */
    function doubtOf(r) {
        if (chi2rHigh(r)) return DOUBT.high;
        if (chi2rLow(r)) return DOUBT.low;
        return !Number.isFinite(r.chi2r) || flagged(r) ? DOUBT.flagged : null;
    }

    /**
     * { text, tone, short }: the status in words. A converged fit that is doubtful says why in the text itself
     * ("已收斂・約化 χ² 偏大"), so the colour of the chip is never the only cue; `short` is that reason (or the
     * status when it is not "converged") for the narrow chip of the file list, '' for a plain converged fit.
     */
    function statusLabel(fitResult) {
        if (fitResult === null || fitResult === undefined) return NOT_FITTED;
        if (!has(STATUS_LABELS, fitResult.status)) throw new Error('Unknown fit status: ' + String(fitResult.status));
        const label = STATUS_LABELS[fitResult.status];
        const short = STATUS_SHORT[fitResult.status];
        const doubt = label.tone === 'ok' ? doubtOf(fitResult) : null;
        if (doubt === null) return Object.freeze({ text: label.text, tone: label.tone, short });
        return Object.freeze({ text: label.text + STATUS_SEPARATOR + doubt.text, tone: 'warn', short: doubt.short });
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
        return hint('undetermined', 'warn', '下列參數的誤差大於數值（與 0 無法區分，或無法由這組資料決定）：' + params.join(LIST_SEPARATOR),
            { params: Object.freeze(params) });
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
        return '誤差已乘 √(加權殘差均方)＝' + f + '；SasView 在相同權重下顯示未乘的值＝此處誤差 ÷ ' + f;
    }

    function errorColumn(fitResult) {
        const scaled = isObject(fitResult) && fitResult.displayErrorsScaled === true && fitResult.status !== 'stopped';
        return Object.freeze(scaled
            ? { label: ERROR_LABEL_SCALED, title: scaledErrorsText(fitResult) }
            : { label: ERROR_LABEL, title: '' });
    }

    /** Size parameters of the fitted model that were not fitted (design spec 5.7: first-fit guidance). */
    function fixedSizeOf(r) {
        const spec = isObject(r.settings) ? r.settings.modelSpec : null;
        const sizes = isObject(spec) ? globalThis.SasFitJobs.sizeNames(spec.model) : [];
        return sizes.filter((name) => r.names.indexOf(name) < 0);
    }

    function localMinimumHint(r) {
        const fixed = fixedSizeOf(r);
        const text = fixed.length === 0 ? TEXT.localMinimum : TEXT.localMinimum + '。' + TEXT.fixedSize(fixed.join(LIST_SEPARATOR));
        return hint('local-minimum', 'warn', text, { fixedSize: Object.freeze(fixed) });
    }

    /** The hints that depend on how the fit ended. */
    function statusHints(r) {
        const converged = r.status === 'converged';
        return [
            r.status === 'failed' && r.blockedByNonFinite ? hint('blocked', 'error', TEXT.blocked) : null,
            r.status === 'failed' && !r.blockedByNonFinite ? hint('failed', 'error', TEXT.failed) : null,
            r.status === 'maxiter' ? hint('maxiter', 'warn', TEXT.maxiter, { action: 'continue' }) : null,
            converged && r.iterations === 0 ? hint('zero-steps', 'warn', TEXT.zeroSteps) : null,
            converged && chi2rHigh(r) ? localMinimumHint(r) : null,
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

    /**
     * Before the first fit: no size parameter is ticked, so only the others are fitted (the defaults tick scale
     * and background). fit = SasFitJobs.fitNames(form).
     */
    function fixedSizeHint(fit) {
        if (!isObject(fit) || !Array.isArray(fit.fixedSize) || !Array.isArray(fit.free)) return null;
        if (fit.fixedSize.length === 0 || fit.sizeFitted > 0 || fit.free.length === 0) return null;
        const text = '尺寸參數（' + fit.fixedSize.join(LIST_SEPARATOR) + '）目前固定，只擬合 ' + fit.free.join(' 與 ')
            + '；要擬合尺寸請到「模型」勾選';
        return hint('fixed-size', 'ok', text, { fixedSize: fit.fixedSize });
    }

    function preFitHints(input) {
        const { modelSpec, dataset, range, weighting, notes, fit } = isObject(input) ? input : {};
        const hints = [isObject(modelSpec) && modelSpec.structure === HAYTER ? hint('hayter', 'warn', TEXT.hayter) : null,
            fixedSizeHint(fit)];
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
        const pausedText = s.paused ? (s.fresh ? TEXT.pausedFresh : (s.computing ? null : TEXT.paused)) : null;
        const parts = [
            s.stale ? TEXT.staleCurve : null,
            pausedText,
            s.previewPoints > 0 ? '預覽以 ' + s.previewPoints + ' 點計算' : null,
            s.zoomed ? TEXT.zoomed : null,
            s.displayStride > 1 ? '點數較多，圖上每 ' + s.displayStride + ' 點顯示 1 點（擬合仍使用全部點）' : null,
            s.hidden > 0 ? (has(HIDDEN_TEXT, s.mode) ? HIDDEN_TEXT[s.mode](s.hidden) : s.hidden + ' 點無法顯示') : null,
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
        AT_BOUND_SHORT, LOCKED_TEXT: TEXT.locked, NOT_FITTED_TEXT: TEXT.notFittedYet, revertOtherText: TEXT.revertOther,
        measure, fitHints, statusLabel, strongCorrelations, errorColumn, preFitHints, excludedCounts, plotStatus, errorNotice,
    });
})();
