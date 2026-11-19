/**
 * sasfit-labels.js -- plain texts of the SAS fitting page that are put
 * together from data: names of models, the fit summary, the texts read by
 * screen readers for the two charts (design spec 5.1, 5.3, 5.4, 5.6; fix pass
 * B after the UI review of 2026-11-19). Original code.
 *
 * Everything here returns PLAIN TEXT in Traditional Chinese, never HTML: the
 * DOM modules write it with textContent or aria-label, SasFitHtml escapes it.
 *
 *   MODEL_NAMES                 { sasmodels name: Chinese name } of the 13
 *                               models and the 2 structure factors
 *   modelLabel(name)            'sphere — 均勻球'; the bare name when there is
 *                               no Chinese name or it says nothing new
 *   measureName(isChi2)         '約化 χ²' | '加權殘差均方': the fit measure in
 *                               plain-text contexts (decision H-1: chi-square
 *                               only with the data's sigma as weights)
 *   plotTitle(mode)             the title of the plot card
 *   rangeText(range)            'q 0.005–0.07 Å⁻¹' | ''
 *   fitSummary({ range, nPoints, names })
 *                               'q 0.005–0.07 Å⁻¹ · 57 點 · 擬合 scale、radius'
 *   paramMarker(row)            what a collapsed row of the parameter table
 *                               hides and must still say: edited bounds, a
 *                               dispersity that takes part ('' when nothing)
 *   boundsText(lower, upper)    '0–45' | '≥ 0.5' | '≤ 6' | ''
 *   elapsedText(model, seconds) '正在擬合 sphere…已 3 s'
 *   chartLabel(info)            aria-label of the main chart; info = { count,
 *                               mode, active, model, preview, range,
 *                               fit: { isChi2, value, status } | null }
 *   residualLabel(info)         aria-label of the residual chart; info =
 *                               { name, r } | null (r: the residuals; values
 *                               that are not finite are no points)
 *   residualStats(r)            { count, min, max, beyond } (beyond: |r| > 3)
 *
 * Pure: no DOM, no timers; SasFitFormat is read at call time.
 */

(function () {
    'use strict';

    const MODEL_NAMES = Object.freeze({
        sphere: '均勻球', core_shell_sphere: '核殼球', vesicle: '囊泡', ellipsoid: '旋轉橢球', cylinder: '圓柱',
        core_shell_cylinder: '核殼圓柱', flexible_cylinder: '柔性圓柱（蠕蟲鏈）', lamellar: '層狀', guinier: 'Guinier',
        guinier_porod: 'Guinier–Porod', power_law: '冪律', mono_gauss_coil: '高斯鏈（單分散）', gaussian_peak: '高斯峰',
        hardsphere: '硬球', hayter_msa: 'Hayter–Penfold MSA（帶電球）',
    });
    const NAME_SEPARATOR = ' — ';
    const MEASURE_NAMES = Object.freeze({ chi2: '約化 χ²', relative: '加權殘差均方' });
    const MODE_NAMES = Object.freeze({ loglog: 'log-log', guinier: 'Guinier', kratky: 'Kratky' });
    const PLOT_TITLES = Object.freeze({ loglog: 'I(q)', guinier: 'ln I – q²', kratky: 'q²·I – q' });
    const Q_UNIT = 'Å⁻¹';
    const RANGE_DIGITS = 3;
    const MEASURE_DIGITS = 3;
    const RESIDUAL_DIGITS = 2;
    const RESIDUAL_LIMIT = 3;
    const WIDTH_DIGITS = 3;
    const DASH = '–';
    const DOT = ' · ';
    const LIST_SEPARATOR = '、';
    const TEXT = Object.freeze({
        noChart: '尚未載入資料',
        noResidual: '尚無擬合結果',
        pd: '多分散',
        pdFitted: '多分散（擬合寬度）',
    });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const text = (v) => (typeof v === 'string' ? v : '');
    const shown = (value, digits) => globalThis.SasFitFormat.display(globalThis.SasFitFormat.number(value, digits));
    /** A q value of the fit range: RANGE_DIGITS significant figures without trailing zeros (0.005, not 0.00500). */
    const qText = (value) => globalThis.SasFitFormat.display(String(Number(value.toPrecision(RANGE_DIGITS))));

    function modelLabel(name) {
        const id = text(name);
        if (!has(MODEL_NAMES, id)) return id;
        const zh = MODEL_NAMES[id];
        return zh.toLowerCase() === id.toLowerCase() ? zh : id + NAME_SEPARATOR + zh;
    }

    const measureName = (isChi2) => (isChi2 === true ? MEASURE_NAMES.chi2 : MEASURE_NAMES.relative);

    function plotTitle(mode) {
        if (!has(PLOT_TITLES, mode)) throw new Error('Unknown plot mode: ' + String(mode));
        return PLOT_TITLES[mode];
    }

    function rangeText(range) {
        if (!isObject(range) || !Number.isFinite(range.qMin) || !Number.isFinite(range.qMax)) return '';
        return 'q ' + qText(range.qMin) + DASH + qText(range.qMax) + ' ' + Q_UNIT;
    }

    function fitSummary(info) {
        const { range, nPoints, names } = isObject(info) ? info : {};
        const list = Array.isArray(names) ? names : [];
        return [
            rangeText(range),
            Number.isInteger(nPoints) ? nPoints + ' 點' : '',
            list.length > 0 ? '擬合 ' + list.join(LIST_SEPARATOR) : '',
        ].filter((part) => part !== '').join(DOT);
    }

    /** An empty bound is open. '' when both are. */
    function boundsText(lower, upper) {
        const lo = text(lower).trim();
        const hi = text(upper).trim();
        if (lo === '' && hi === '') return '';
        if (hi === '') return '≥ ' + lo;
        return lo === '' ? '≤ ' + hi : lo + DASH + hi;
    }

    /** The width of a dispersity as the marker shows it: a number is shortened, anything else stays as typed. */
    function widthText(width) {
        const value = Number(text(width).trim());
        if (text(width).trim() === '' || !Number.isFinite(value)) return text(width).trim();
        return globalThis.SasFitFormat.display(String(Number(value.toPrecision(WIDTH_DIGITS))));
    }

    function pdMarker(pd) {
        if (!isObject(pd) || pd.open !== true) return '';
        if (pd.fit === true) return TEXT.pdFitted;
        const value = Number(text(pd.width).trim());
        return value > 0 ? TEXT.pd + ' ' + widthText(pd.width) : '';
    }

    function paramMarker(row) {
        if (!isObject(row)) return '';
        const defaults = isObject(row.defaults) ? row.defaults : null;
        const edited = defaults !== null && (text(row.lower).trim() !== text(defaults.lower) || text(row.upper).trim() !== text(defaults.upper));
        const bounds = edited ? (boundsText(row.lower, row.upper) === '' ? '不限' : boundsText(row.lower, row.upper)) : '';
        return [bounds, pdMarker(row.pd)].filter((part) => part !== '').join(DOT);
    }

    function elapsedText(model, seconds) {
        const s = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
        return '正在擬合 ' + text(model) + '…已 ' + s + ' s';
    }

    // ------------------------------------------------------------- charts

    function fitText(fit) {
        if (!isObject(fit)) return '';
        return measureName(fit.isChi2) + ' ' + shown(fit.value, MEASURE_DIGITS) + (text(fit.status) === '' ? '' : '（' + fit.status + '）');
    }

    function chartLabel(info) {
        const i = isObject(info) ? info : {};
        const mode = has(MODE_NAMES, i.mode) ? MODE_NAMES[i.mode] : text(i.mode);
        const model = text(i.model) === '' ? '' : '模型 ' + modelLabel(i.model);
        if (!(i.count > 0)) return i.preview === true ? [model + ' 的曲線預覽', '模式 ' + mode, '尚未載入資料'].join('，') : TEXT.noChart;
        const range = rangeText(i.range);
        return [
            i.count + ' 組資料', '模式 ' + mode, '擬合對象：' + (text(i.active) === '' ? '—' : i.active), model,
            fitText(i.fit), range === '' ? '' : '擬合範圍 ' + range,
        ].filter((part) => part !== '').join('，');
    }

    function residualStats(r) {
        const stats = { count: 0, min: Infinity, max: -Infinity, beyond: 0 };
        const values = isObject(r) && typeof r.length === 'number' ? r : [];
        for (let k = 0; k < values.length; k++) {
            const v = values[k];
            if (!Number.isFinite(v)) continue;
            stats.count += 1;
            if (v < stats.min) stats.min = v;
            if (v > stats.max) stats.max = v;
            if (Math.abs(v) > RESIDUAL_LIMIT) stats.beyond += 1;
        }
        return Object.freeze(stats.count === 0 ? { count: 0, min: NaN, max: NaN, beyond: 0 } : stats);
    }

    function residualLabel(info) {
        if (!isObject(info)) return TEXT.noResidual;
        const stats = residualStats(info.r);
        if (stats.count === 0) return TEXT.noResidual;
        return text(info.name) + ' 的殘差，' + stats.count + ' 點，範圍 ' + shown(stats.min, RESIDUAL_DIGITS) + ' 至 '
            + shown(stats.max, RESIDUAL_DIGITS) + '，|殘差| > ' + RESIDUAL_LIMIT + ' 的有 ' + stats.beyond + ' 點';
    }

    globalThis.SasFitLabels = Object.freeze({
        MODEL_NAMES, MODE_NAMES, RESIDUAL_LIMIT,
        modelLabel, measureName, plotTitle, rangeText, fitSummary, boundsText, paramMarker, elapsedText,
        chartLabel, residualLabel, residualStats,
    });
})();
