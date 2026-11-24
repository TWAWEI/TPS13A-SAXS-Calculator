/**
 * sasfit-sasview.js -- a fit result as the text of SasView's "Copy Params" /
 * "Paste Params" (design spec 9, decision 41). Original code; the FORMAT is
 * SasView's, established from its source and checked against a real SasView
 * 6.1.0 fit page (see below).
 *
 *   TOKEN, MODELS, STRUCTURES, PD_TYPES     the only identifiers that are written besides parameter names
 *   check(fitResult) -> { ok, reason }      reason (Traditional Chinese) says why this fit has no SasView text
 *   text(fitResult, bounds) -> string       throws the reason when check() fails. bounds: { name: [lower, upper] }
 *       as SasFitExport.paramRows takes them (read by the caller from a form of the same model spec), or null:
 *       then the default limits of the model are written
 *   notes(fitResult, { boundsKnown }) -> [string]   what the user has to do in SasView for THIS fit, and what
 *       SasView does not take from the text (Traditional Chinese); empty when check() fails
 *
 * The format (SasView 6.1.0: FittingUtilities.formatParameters, FittingWidget.getFitParameters / getFitPage /
 * getFitModel / clipboard_paste / updatePageWithParameters / updateFullModel, PolydispersityWidget.gatherPolyParams /
 * updateFullPolyModel; the same functions of FittingWidget.py in 5.0.6):
 *   lines joined by ':' and fields by ',' -- no escaping exists, so no field may hold either. The first line is
 *   the token 'sasview_parameter_values'. Paste reads only lines with more than one field.
 *     model_name,<form factor>                      compared with the model chosen on the fit page (a mismatch asks)
 *     <name>,<True|False>,<value>,<error|None>,<min>,<max>,()
 *         checked for fitting, value, error (never read back by paste), limits ('inf' / '-inf' as Python prints
 *         them), the constraint tuple (empty). Six fields: "more than five" tells paste that an error is there.
 *     structure_factor_mode,None,<0|1>,None,,,()    a choice parameter: 'None' for "no checkbox", the value is the
 *     radius_effective_mode,None,<k>,None,,,()      index of the choice (0 = unconstrained, k = the k-th mode)
 *     <name>.width,<True|False>,<width>,<error|None>,<min>,<max>,<npts>,<nsigmas>,<distribution>
 *     polydisperse_params,<True|False>              the Polydispersity checkbox of the fit page
 *     magnetic_params,False / 2D_params,False       the fit here is 1D and not magnetic
 *     fitpage_model,<form factor> / fitpage_structure,<S or None>   information only: paste does not select a model
 *   The structure factor is not part of model_name: a P@S fit has model_name = P and the parameters of both.
 *   A radius_effective that the model defines (mode > 0) is computed by SasView and is not written.
 *
 * What was checked against SasView 6.1.0 (its own FittingWidget driven headless, values read back from its
 * kernel): the parameter names, their order, the dispersity names, the effective-radius modes and the default
 * values of all 13 form factors alone and with both structure factors are the same as on this page. Pasting sets
 * the value, the fit checkbox and the limits of every parameter and both mode choices. Limits of SasView itself:
 *   - a value is rounded to 5 significant digits ('%-7.5g'), in 5.0.x as well; the error column is not read;
 *   - with a structure factor chosen, 6.x (6.0.0 by its source, 6.1.0 as run) skips the row of 'background';
 *     5.0.6 does not, by its source;
 *   - the distribution of a dispersity is not pasted (6.1.0 and earlier): it has to be chosen first;
 *   - 6.1.0: a change of Npts or Nsigs in the dispersity table -- typed or pasted -- is written into the
 *     WIDTH of the calculation, and Npts / Nsigs themselves do not reach it (PolydispersityWidget
 *     .onPolyModelChange writes every column to '<name>.width'). 5.0.6 and 6.0.0 write them where they belong,
 *     and so does the development branch after 6.1.0 (source only: none of the three was run).
 *   notes() tells the user each of these that applies to the fit at hand.
 *
 * Errors: the unscaled 1 s.d. (fitResult.errors) with every weighting -- what SasView itself computes; the page
 * shows the scaled one when the weighting is not the data's sigma. None for a parameter on a bound.
 *
 * Only numbers (SasFitExport.num) and identifiers checked against a whitelist or NAME_RE are written: no file
 * name, no text of the user. Pure: no DOM, no timers; nothing given is modified; other SasFit modules are read at
 * call time.
 */

(function () {
    'use strict';

    const TOKEN = 'sasview_parameter_values';
    const LINE_SEP = ':';
    const FIELD_SEP = ',';
    const MODELS = Object.freeze([
        'sphere', 'core_shell_sphere', 'vesicle', 'ellipsoid', 'cylinder', 'core_shell_cylinder', 'flexible_cylinder', 'lamellar',
        'guinier', 'guinier_porod', 'power_law', 'mono_gauss_coil', 'gaussian_peak',
    ]);
    const STRUCTURES = Object.freeze(['hardsphere', 'hayter_msa']);
    const PD_TYPES = Object.freeze(['gaussian', 'rectangle', 'uniform', 'lognormal', 'schulz', 'boltzmann']);
    const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const TRUE = 'True';
    const FALSE = 'False';
    const NONE = 'None';
    const NO_CONSTRAINT = '()';
    const WIDTH_SUFFIX = '.width';
    const PD_SUFFIX = '_pd';
    const BACKGROUND = 'background';
    const STRUCTURE_MODE_ID = 'structure_factor_mode';
    const RADIUS_MODE_ID = 'radius_effective_mode';
    const DEFAULT_PD = 'gaussian';
    // a dispersity that is not open: width 0 with the texts of a fresh SasView table, so that pasting it changes nothing there
    const CLOSED_WIDTH = Object.freeze([FALSE, '0', NONE, '0.0', '1.0', '35', '3', DEFAULT_PD]);
    const SIGMA_MODE = 'sigma';
    const TEXT = Object.freeze({
        noResult: '沒有擬合結果',
        lowQ: '低 q 冪律附加項不是 SasView 的內建模型，無法以 SasView 參數文字表示',
        model: (name) => 'SasView 參數文字不支援模型 ' + name,
        structure: (name) => 'SasView 參數文字不支援結構因子 ' + name,
        name: (name) => '參數名稱 ' + name + ' 不能寫進 SasView 參數文字',
        value: (name) => name + ' 不是有限的數值，無法寫進 SasView 參數文字',
        pd: (name) => name + ' 的多分散設定（分布、點數或 σ 數）無法寫進 SasView 參數文字',
        choose: (model, structure) => '在 SasView 的 Fit 頁先選模型 ' + model + (structure === null ? '' : '、Structure factor 選 ' + structure)
            + '，再用 Edit → Paste Params 貼上（SasView 5 與 6 相同）。',
        precision: 'SasView 貼上時每個數值只取 5 位有效數字，誤差欄不會貼上。',
        unscaled: '文字裡的誤差是未乘 √(加權殘差均方) 的 1 σ（SasView 自己的算法）；這次的權重不是資料 σ，本頁顯示的是已乘的值。',
        background: (value) => 'SasView 6 選了結構因子時不會貼上 background：請手動輸入 ' + value + '。',
        pdFunction: (list) => 'SasView 6.1 及更早版本不會貼上分布類型：貼上「之前」先在 Polydispersity 分頁的 Function 選好 ' + list + '。',
        pdWidth: (list) => 'SasView 6.1 貼上 Npts／Nsigs 時會把計算用的 PD 寬度蓋掉（表格顯示仍正確），Npts／Nsigs 本身也不會生效：'
            + '貼上後請把 PD 寬度先改成別的值、再改回 ' + list + '；Nsigs 與 SasView 的預設不同時，兩邊的曲線會有差異。',
        defaultBounds: '上下限是模型的預設值（匯出時參數表的模型已與這次擬合不同）。',
    });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const num = (x) => globalThis.SasFitExport.num(x);
    const flag = (on) => (on ? TRUE : FALSE);
    const structureOf = (modelSpec) => (typeof modelSpec.structure === 'string' && modelSpec.structure !== '' ? modelSpec.structure : null);
    const baseName = (widthName) => widthName.slice(0, -PD_SUFFIX.length);

    // ------------------------------------------------------------- what cannot be written

    function isResult(fitResult) {
        return isObject(fitResult) && isObject(fitResult.params) && Array.isArray(fitResult.names) && isObject(fitResult.settings)
            && isObject(fitResult.settings.modelSpec) && typeof fitResult.settings.modelSpec.model === 'string';
    }

    /** Why the model of the result has no SasView text; '' when it has. */
    function specReason(modelSpec) {
        if (modelSpec.lowQPowerLaw === true) return TEXT.lowQ;
        if (MODELS.indexOf(modelSpec.model) < 0) return TEXT.model(modelSpec.model.replace(/[^\w@+.-]/g, '_'));
        const structure = structureOf(modelSpec);
        if (structure !== null && STRUCTURES.indexOf(structure) < 0) return TEXT.structure(structure.replace(/[^\w@+.-]/g, '_'));
        return '';
    }

    /** Why one row cannot be written; '' when it can. */
    function rowReason(row) {
        const name = row.pd === null ? row.name : baseName(row.name);
        if (!NAME_RE.test(name)) return TEXT.name(name.replace(/[^\w]/g, '_'));
        if (!isFiniteNumber(row.value)) return TEXT.value(row.name);
        if (row.pd === null) return '';
        const sigmasOk = row.pd.nsigmas === null || isFiniteNumber(row.pd.nsigmas);
        return PD_TYPES.indexOf(row.pd.type) >= 0 && isFiniteNumber(row.pd.npts) && sigmasOk ? '' : TEXT.pd(name);
    }

    function modeReason(fitResult) {
        if (structureOf(fitResult.settings.modelSpec) === null) return '';
        const bad = [STRUCTURE_MODE_ID, RADIUS_MODE_ID].find((id) => !Number.isInteger(fitResult.params[id]) || fitResult.params[id] < 0);
        return bad === undefined ? '' : TEXT.value(bad);
    }

    function check(fitResult) {
        const no = (reason) => Object.freeze({ ok: false, reason });
        if (!isResult(fitResult)) return no(TEXT.noResult);
        const spec = specReason(fitResult.settings.modelSpec);
        if (spec !== '') return no(spec);
        const reasons = globalThis.SasFitExport.paramRows(fitResult, null).map(rowReason).concat([modeReason(fitResult)]);
        const first = reasons.find((reason) => reason !== '');
        return first === undefined ? Object.freeze({ ok: true, reason: '' }) : no(first);
    }

    // ------------------------------------------------------------- limits

    /** A limit as Python prints a float that SasView reads back with float(). */
    function limitText(value) {
        if (value === Infinity) return 'inf';
        if (value === -Infinity) return '-inf';
        return num(value);
    }

    /** A limit of a form field: empty is open, an unreadable text is open as well. */
    function limitOf(fieldText, open) {
        if (typeof fieldText !== 'string' || fieldText.trim() === '') return open;
        const value = globalThis.SasFitForm.parseNumber(fieldText);
        return isFiniteNumber(value) ? value : open;
    }

    /** { name: [lower, upper] } of the model's default form (the limits of sasmodels; the page's own for a width). */
    function defaultBounds(modelSpec) {
        const form = globalThis.SasFitForm;
        const base = form.create(modelSpec.model);
        const structure = structureOf(modelSpec);
        const skeleton = structure === null ? base : form.reduce(base, { type: 'setStructure', structure });
        const entries = [];
        form.rows(skeleton).forEach((row) => {
            entries.push([row.name, [limitOf(row.lower, -Infinity), limitOf(row.upper, Infinity)]]);
            if (row.pd !== null) entries.push([row.name + PD_SUFFIX, [limitOf(row.pd.lower, -Infinity), limitOf(row.pd.upper, Infinity)]]);
        });
        return Object.fromEntries(entries);
    }

    /** [lower text, upper text] of a row: what the caller gave, else the model's default. */
    function limitsOf(row, defaults) {
        const fallback = has(defaults, row.name) ? defaults[row.name] : [-Infinity, Infinity];
        return [row.lower === null ? fallback[0] : row.lower, row.upper === null ? fallback[1] : row.upper].map(limitText);
    }

    // ------------------------------------------------------------- lines

    /** The unscaled error of a fitted parameter that is not on a bound, else 'None'. */
    function errorText(row) {
        return row.fitted && row.atBound === null && isFiniteNumber(row.error) ? num(row.error) : NONE;
    }

    const paramLine = (row, defaults) => [row.name, flag(row.fitted), num(row.value), errorText(row)].concat(limitsOf(row, defaults), [NO_CONSTRAINT]);

    function widthLine(row, defaults) {
        const sigmas = row.pd.nsigmas === null ? '' : num(row.pd.nsigmas);
        return [baseName(row.name) + WIDTH_SUFFIX, flag(row.fitted), num(row.value), errorText(row)]
            .concat(limitsOf(row, defaults), [num(row.pd.npts), sigmas, row.pd.type]);
    }

    const modeLine = (id, value) => [id, NONE, num(value), NONE, '', '', NO_CONSTRAINT];

    /** The names of the form factor's parameters that can have a dispersity, in the order of the table. */
    function dispersityNames(modelSpec) {
        const form = globalThis.SasFitForm;
        return form.rows(form.create(modelSpec.model)).filter((row) => row.pd !== null).map((row) => row.name);
    }

    /** The lines of the dispersity table: every open width, and width 0 for the others while one is open. */
    function widthLines(fitResult, rows, defaults) {
        const open = rows.filter((row) => row.pd !== null);
        if (open.length === 0) return [];
        return dispersityNames(fitResult.settings.modelSpec).map((name) => {
            const row = open.find((candidate) => baseName(candidate.name) === name);
            return row === undefined ? [name + WIDTH_SUFFIX].concat(CLOSED_WIDTH) : widthLine(row, defaults);
        });
    }

    /** The parameter lines in SasView's order: scale, background, the two modes of a P@S model, then the rest. */
    function mainLines(fitResult, rows, defaults) {
        const lines = rows.filter((row) => row.pd === null).map((row) => paramLine(row, defaults));
        if (structureOf(fitResult.settings.modelSpec) === null) return lines;
        const modes = [STRUCTURE_MODE_ID, RADIUS_MODE_ID].map((id) => modeLine(id, fitResult.params[id]));
        const at = lines.findIndex((line) => line[0] === BACKGROUND) + 1;
        return lines.slice(0, at).concat(modes, lines.slice(at));
    }

    function text(fitResult, bounds) {
        const checked = check(fitResult);
        if (!checked.ok) throw new Error(checked.reason);
        const { modelSpec } = fitResult.settings;
        const structure = structureOf(modelSpec);
        const rows = globalThis.SasFitExport.paramRows(fitResult, isObject(bounds) ? bounds : null);
        const defaults = defaultBounds(modelSpec);
        const widths = widthLines(fitResult, rows, defaults);
        const lines = [[TOKEN], ['model_name', modelSpec.model]].concat(mainLines(fitResult, rows, defaults), widths, [
            ['polydisperse_params', flag(widths.length > 0)], ['magnetic_params', FALSE], ['2D_params', FALSE],
            ['fitpage_model', modelSpec.model], ['fitpage_structure', structure === null ? NONE : structure],
        ]);
        return lines.map((fields) => fields.join(FIELD_SEP)).join(LINE_SEP);
    }

    // ------------------------------------------------------------- what the user has to know

    function notes(fitResult, options) {
        if (!check(fitResult).ok) return Object.freeze([]);
        const { modelSpec, weighting } = fitResult.settings;
        const structure = structureOf(modelSpec);
        const widths = globalThis.SasFitExport.paramRows(fitResult, null).filter((row) => row.pd !== null);
        const other = widths.filter((row) => row.pd.type !== DEFAULT_PD);
        const out = [TEXT.choose(modelSpec.model, structure), TEXT.precision];
        if (weighting !== SIGMA_MODE && fitResult.names.length > 0) out.push(TEXT.unscaled);
        if (structure !== null) out.push(TEXT.background(num(fitResult.params[BACKGROUND])));
        if (other.length > 0) out.push(TEXT.pdFunction(other.map((row) => baseName(row.name) + ' → ' + row.pd.type).join('、')));
        if (widths.length > 0) out.push(TEXT.pdWidth(widths.map((row) => baseName(row.name) + ' ' + num(row.value)).join('、')));
        if (!(isObject(options) && options.boundsKnown === true)) out.push(TEXT.defaultBounds);
        return Object.freeze(out);
    }

    globalThis.SasFitSasView = Object.freeze({ TOKEN, MODELS, STRUCTURES, PD_TYPES, check, text, notes });
})();
