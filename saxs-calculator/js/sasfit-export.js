/**
 * sasfit-export.js -- what the export files of the SAS fitting page are made
 * of: numbers and CSV cells, comment lines, file names, the rows of a fitted
 * model as a FitResult describes them, and the fit-curve CSV (design spec 9;
 * plan M4 Task 13). Original code.
 *
 *   num(x)                 the export text of a number: String(x), the shortest
 *                          text that reads back to the same double, locale-free;
 *                          '' for NaN, +-Infinity and anything that is not a
 *                          number. -0 is written '0' (String(-0)): the sign of
 *                          zero is not kept.
 *   cell(value)            one CSV cell (RFC 4180). A number is num(x) and stays
 *                          a number (a negative one too). A TEXT that starts
 *                          with = + - @ TAB or CR gets a leading apostrophe
 *                          (formula injection, OWASP), then the RFC quoting; a
 *                          text with the comment character is quoted as well.
 *                          A line break inside a text becomes one blank: a row
 *                          is one line for tools that read line by line.
 *   commentLine(key, value)  '# key: value' for a value that may hold text of the
 *                          user (file and condition names) -- never quoted (a quoted line would
 *                          not start with the comment prefix); in the value
 *                          , ; " and every control character become '_', so a
 *                          spreadsheet cannot split a file name into a cell
 *                          that starts a formula, and no value adds a line.
 *   safeName(text, fallback)  a text usable inside a file name: NFC; the path
 *                          and a data extension (.dat, .txt, .csv, any case; no
 *                          other: 'sample.v2' keeps its name) are dropped; \ / : * ? " < > | control and
 *                          bidirectional-control characters and lone surrogates
 *                          become '_'; leading/trailing blanks and dots go; a
 *                          reserved device name (CON, PRN, AUX, NUL, COM1-9,
 *                          LPT1-9) gets a leading '_'; cut at NAME_MAX_BYTES
 *                          UTF-8 bytes on a code point boundary and trimmed
 *                          again; '' -> fallback. CJK, '@' and '+' are kept.
 *   safeLabel(text, fallback)  the same for a label that is not a file name (the
 *                          condition name): nothing is taken off as a path or
 *                          an extension, so 'mg/mL' becomes 'mg_mL'.
 *   fileName(kind, { dataName, modelSpec, conditionName })
 *                          kind: 'fit' | 'report' | 'sequence' | 'png-main' |
 *                          'png-residual' | 'png-shape' | 'png-trend'
 *   modelText(modelSpec)   'core_shell_sphere@hardsphere+power_law'
 *   combinationText(fitResult)   'P*S' | 'P*(1+beta*(S-1))' | null (no S(Q))
 *   radiusModeText(fitResult)    how the effective radius is defined, or null
 *   software(version)      the software line; throws unless version is a
 *                          non-empty string (the page takes it from
 *                          SasFitWorkerClient.scriptVersion, which is null
 *                          without ?v= -- "vnull" must never be written)
 *   paramRows(fitResult, bounds, { absolute }?)
 *       -> [{ name, value, error, errorScaled, errorShown, unit, fitted,
 *             atBound, lower, upper, pd }] in the order of the parameter table.
 *       EVERYTHING comes from the FitResult: the rows and units from a form
 *       skeleton rebuilt from settings.modelSpec and the two mode parameters,
 *       the values and the dispersity settings from fitResult.params. An open
 *       dispersity is a row <name>_pd of its own with pd = { type, npts,
 *       nsigmas } (nsigmas null for a distribution without it). The settings
 *       (_pd_n, _pd_nsigma, _pd_type, the two modes) and a radius_effective
 *       that the model defines are not rows. bounds: { name: [lower, upper] }
 *       as the caller read them from a form of the SAME model spec, or null
 *       (a FitResult carries no bounds): lower / upper are then null.
 *       unit is the ASCII unit of the meta ('Ang', '1e-6/Ang^2', '' for none);
 *       absolute: true gives the background '1/cm' (official files).
 *   shownText(fitResult, name) -> { value, error, kind }: the text the page
 *       shows for that name (see the function).
 *   inFit(dataset, fitResult) -> Uint8Array, 1 where the point took part:
 *       SasFitWeighting.select(dataset, weighting, range).index, the Worker's
 *       own selection. NOT "the residual is finite": a failed fit has NaN
 *       residuals on points that did take part.
 *   fitCsv({ file, fitResult, software }) -> string (no BOM: the download adds
 *       it). Comment lines, the header q,I,sigma,I_model,residual,in_fit, then
 *       EVERY data point at full precision. Line ends are \n. Throws for a
 *       'stopped' result (it has no curve).
 *   dataUrlBytes(dataUrl) -> { mime, bytes: Uint8Array }: only a PNG as
 *       data:image/png;base64,... -- decoded here, never fetched (the page's
 *       connect-src blocks fetch of data: and blob: URLs).
 *
 * The name of the fit measure follows decision 24: 'chi2r' only with sigma
 * weighting, else 'weighted_mean_square_residual' (SasFitHints.measure).
 *
 * Pure: no DOM, no timers, no clock; nothing given is modified; the other
 * SasFit modules are read at call time.
 */

(function () {
    'use strict';

    const COMMENT = '# ';
    const NAME_MAX_BYTES = 120;
    const PD_SUFFIX = '_pd';
    const BACKGROUND = 'background';
    const ABSOLUTE_UNIT = '1/cm';
    const NO_UNIT = 'None';
    const STOPPED = 'stopped';
    const SHOWN_DIGITS = 5;                    // a value without an error on the page (SasFitHtml)
    const STRUCTURE_MODE_ID = 'structure_factor_mode';
    const RADIUS_MODE_ID = 'radius_effective_mode';
    const COMBINATIONS = Object.freeze(['P*S', 'P*(1+beta*(S-1))']);
    const RADIUS_FREE = 'unconstrained (radius_effective is a parameter)';
    const PNG_PREFIX = 'data:image/png;base64,';
    const PNG_MIME = 'image/png';
    const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
    const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    const FORMULA_START_RE = /^[=+\-@\t\r]/;
    // '#' too: pandas.read_csv(comment="#") cuts a row at an unquoted one (verified with pandas 2.3.3 and 3.0.2)
    const NEEDS_QUOTES_RE = /[",\r\n#]/;
    const COMMENT_UNSAFE_RE = /[,;"\u0000-\u001F\u007F\u2028\u2029]/g;
    const NAME_UNSAFE_RE = /[\\/:*?"<>|\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;
    const CONTROL_RE = /[\u0000-\u001F\u007F\u2028\u2029]/g;
    const VERSION_RE = /^[\w.-]+$/;
    const EXTENSION_RE = /\.(?:dat|txt|csv)$/i;       // only what a data file is called: 'sample.v2' keeps its '.v2'
    const LINE_BREAK_RE = /\r\n?|\n/g;
    const BREAK_THEN_FORMULA_RE = /^[\r\n]+[=+\-@\t]/;
    const EDGE_RE = /^[\s.]+|[\s.]+$/g;
    const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
    const MODEL_UNSAFE_RE = /[^\w@+]/g;
    const DATA_FALLBACK = 'sasfit';
    const CONDITION_FALLBACK = 'condition';
    const FILE_KINDS = Object.freeze({
        fit: Object.freeze({ by: 'data', tail: '_fit.csv' }),
        report: Object.freeze({ by: 'data', tail: '_report.txt' }),
        sequence: Object.freeze({ by: 'condition', tail: '_sequence.csv' }),
        'png-main': Object.freeze({ by: 'data', tail: '_main.png' }),
        'png-residual': Object.freeze({ by: 'data', tail: '_residual.png' }),
        'png-shape': Object.freeze({ by: 'data', tail: '_shape.png' }),
        'png-trend': Object.freeze({ by: 'condition', tail: '_trend.png' }),
    });
    const CSV_HEADER = Object.freeze(['q', 'I', 'sigma', 'I_model', 'residual', 'in_fit']);
    const TITLE_LINE = 'SAS model fit: data, fitted curve and residuals';
    const READ_LINE = 'UTF-8 with BOM; comment lines start with "# "; read with '
        + 'numpy.genfromtxt(f, delimiter=",", comments="#", encoding="utf-8-sig") (first row = column names -> nan) '
        + 'or pandas.read_csv(f, comment="#")';
    const UNITS_LINE = Object.freeze({
        official: 'q in 1/Ang; I, sigma and I_model in 1/cm (official TPS 13A file, absolute scale)',
        generic: 'q in 1/Ang; I, sigma and I_model in the units of the data file',
    });
    // the weight w of residual = (I - I_model)/w for each weighting (SasFitWeighting.weights)
    const RESIDUAL_WEIGHTS = Object.freeze({ sigma: 'w = sigma', sqrtI: 'w = sqrt(|I|)', absI: 'w = |I|', none: 'w = 1' });
    const MEASURE_KEYS = Object.freeze({ chi2: 'chi2r', relative: 'weighted_mean_square_residual' });
    const BOUND_NOTES = Object.freeze({ lower: ', at lower bound', upper: ', at upper bound' });

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isObject = (v) => v !== null && typeof v === 'object';
    const text = (v) => (typeof v === 'string' ? v : '');

    // ------------------------------------------------------------- numbers, cells, comments

    function num(x) {
        return typeof x === 'number' && Number.isFinite(x) ? String(x) : '';
    }

    function cell(value) {
        if (typeof value === 'number') return num(value);
        if (value === null || value === undefined) return '';
        const raw = String(value);
        const flat = raw.replace(LINE_BREAK_RE, ' ');             // one row stays one line for tools that read line by line
        const guarded = FORMULA_START_RE.test(raw) || BREAK_THEN_FORMULA_RE.test(raw) ? "'" + flat : flat;
        return NEEDS_QUOTES_RE.test(guarded) ? '"' + guarded.replace(/"/g, '""') + '"' : guarded;
    }

    const valueText = (value) => (typeof value === 'number' ? num(value) : String(value === null || value === undefined ? '' : value));
    /** A value of a comment line: one line, no separator a spreadsheet would split at. */
    const commentValue = (value) => valueText(value).replace(COMMENT_UNSAFE_RE, '_');

    function commentLine(key, value) {
        return COMMENT + commentValue(key) + ': ' + commentValue(value);
    }

    /** A comment line of text this program wrote itself (it may hold commas): only control characters are replaced. */
    const programLine = (key, value) => COMMENT + key + ': ' + valueText(value).replace(CONTROL_RE, '_');

    // ------------------------------------------------------------- file names

    /** UTF-8 length of one code point. */
    function bytesOf(codePoint) {
        if (codePoint < 0x80) return 1;
        if (codePoint < 0x800) return 2;
        return codePoint < 0x10000 ? 3 : 4;
    }

    const isSurrogate = (codePoint) => codePoint >= 0xD800 && codePoint <= 0xDFFF;

    /** The text cut at `limit` UTF-8 bytes on a code point boundary; a lone surrogate becomes '_'. */
    function cutBytes(value, limit) {
        const kept = [];
        let used = 0;
        for (const ch of value) {
            const codePoint = ch.codePointAt(0);
            const size = bytesOf(codePoint);
            if (used + size > limit) break;
            kept.push(isSurrogate(codePoint) ? '_' : ch);
            used += isSurrogate(codePoint) ? 1 : size;
        }
        return kept.join('');
    }

    /** The cleaning both kinds of name share: unsafe characters, edges, reserved names, the byte limit. */
    function cleanName(base, fallback) {
        const cleaned = base.replace(NAME_UNSAFE_RE, '_').replace(EDGE_RE, '');
        const guarded = RESERVED_RE.test(cleaned) ? '_' + cleaned : cleaned;
        const cut = cutBytes(guarded, NAME_MAX_BYTES).replace(EDGE_RE, '');
        return cut === '' ? text(fallback) : cut;
    }

    function safeName(value, fallback) {
        const whole = text(value).normalize('NFC');
        const base = whole.slice(Math.max(whole.lastIndexOf('/'), whole.lastIndexOf('\\')) + 1).trim();
        return cleanName(base.replace(EXTENSION_RE, ''), fallback);
    }

    /** As safeName for a text that is a label, not a file name: no path and no extension are taken off ('mg/mL' -> 'mg_mL'). */
    const safeLabel = (value, fallback) => cleanName(text(value).normalize('NFC').trim(), fallback);

    function assertSpec(modelSpec) {
        if (!isObject(modelSpec) || typeof modelSpec.model !== 'string' || modelSpec.model === '') {
            throw new Error('A model spec { model, structure, lowQPowerLaw } is needed, got ' + JSON.stringify(modelSpec));
        }
    }

    function modelText(modelSpec) {
        assertSpec(modelSpec);
        const structure = typeof modelSpec.structure === 'string' && modelSpec.structure !== '' ? '@' + modelSpec.structure : '';
        return (modelSpec.model + structure + (modelSpec.lowQPowerLaw === true ? '+power_law' : '')).replace(MODEL_UNSAFE_RE, '_');
    }

    function fileName(kind, info) {
        if (!has(FILE_KINDS, kind)) throw new Error('Unknown export file kind: ' + String(kind));
        const { by, tail } = FILE_KINDS[kind];
        const i = isObject(info) ? info : {};
        if (by === 'condition') return safeLabel(i.conditionName, CONDITION_FALLBACK) + tail;
        return safeName(i.dataName, DATA_FALLBACK) + '_' + modelText(i.modelSpec) + tail;
    }

    function software(version) {
        if (typeof version !== 'string' || !VERSION_RE.test(version)) {
            throw new Error('software() needs the page version (letters, digits, dot, hyphen), got ' + String(version));
        }
        return 'sasmodels ' + globalThis.SasFitMeta.sasmodelsVersion + ' (WebAssembly), TPS13A SAXS Calculator v' + version;
    }

    // ------------------------------------------------------------- the model of a FitResult

    function assertResult(fitResult, what) {
        if (!isObject(fitResult) || !isObject(fitResult.params) || !Array.isArray(fitResult.names) || !isObject(fitResult.settings)) {
            throw new Error(what + ' needs a FitResult');
        }
        assertSpec(fitResult.settings.modelSpec);
    }

    /** A form of the result's model spec with default values: only its rows, units and order are used. */
    function skeletonOf(fitResult) {
        const form = globalThis.SasFitForm;
        const { modelSpec } = fitResult.settings;
        const { params } = fitResult;
        const base = form.create(modelSpec.model);
        const lowQ = modelSpec.lowQPowerLaw === true ? form.reduce(base, { type: 'setLowQ', on: true }) : base;
        if (typeof modelSpec.structure !== 'string') return lowQ;
        const withS = form.reduce(lowQ, { type: 'setStructure', structure: modelSpec.structure });
        return has(params, RADIUS_MODE_ID) ? form.reduce(withS, { type: 'setRadiusMode', mode: params[RADIUS_MODE_ID] }) : withS;
    }

    function combinationText(fitResult) {
        assertResult(fitResult, 'combinationText');
        if (typeof fitResult.settings.modelSpec.structure !== 'string') return null;
        const mode = fitResult.params[STRUCTURE_MODE_ID];
        return COMBINATIONS[mode === 1 ? 1 : 0];
    }

    function radiusModeText(fitResult) {
        assertResult(fitResult, 'radiusModeText');
        const { modelSpec } = fitResult.settings;
        if (typeof modelSpec.structure !== 'string') return null;
        const mode = fitResult.params[RADIUS_MODE_ID];
        const modes = globalThis.SasFitMeta.models[modelSpec.model].reffModes;
        if (mode === 0) return RADIUS_FREE;
        return Number.isInteger(mode) && mode >= 1 && mode <= modes.length ? modes[mode - 1] : String(mode);
    }

    const numberOr = (value, fallback) => (typeof value === 'number' ? value : fallback);

    /** The row of one name; `extra` holds what differs between a parameter and a width. */
    function rowOf(fitResult, bounds, name, extra) {
        const shown = globalThis.SasFitWorkerCore.displayErrors(fitResult);
        const fitted = fitResult.names.indexOf(name) >= 0;
        const pick = (map) => (fitted && isObject(map) && has(map, name) ? numberOr(map[name], null) : null);
        const pair = isObject(bounds) && Array.isArray(bounds[name]) ? bounds[name] : null;
        const side = isObject(fitResult.atBound) && has(fitResult.atBound, name) ? fitResult.atBound[name] : null;
        return Object.freeze({
            name, value: numberOr(fitResult.params[name], NaN), error: pick(fitResult.errors), errorScaled: pick(fitResult.errorsScaled),
            errorShown: pick(shown), unit: '', fitted, atBound: side,
            lower: pair === null ? null : numberOr(pair[0], null), upper: pair === null ? null : numberOr(pair[1], null), pd: null, ...extra,
        });
    }

    /** { type, npts, nsigmas } of an open dispersity as it was sent. */
    function pdOf(params, name) {
        const type = text(params[name + '_pd_type']);
        const defaults = globalThis.SasFitForm.PD_UI_DEFAULTS;
        const usesSigmas = !has(defaults, type) || defaults[type].nsigmas !== null;
        return Object.freeze({
            type, npts: numberOr(params[name + '_pd_n'], NaN), nsigmas: usesSigmas ? numberOr(params[name + '_pd_nsigma'], NaN) : null,
        });
    }

    function paramRows(fitResult, bounds, options) {
        assertResult(fitResult, 'paramRows');
        const absolute = isObject(options) && options.absolute === true;
        const { params } = fitResult;
        const rows = [];
        globalThis.SasFitForm.rows(skeletonOf(fitResult)).forEach((row) => {
            if (row.derived || !has(params, row.name)) return;
            const unit = row.name === BACKGROUND && absolute ? ABSOLUTE_UNIT : (row.unit === NO_UNIT ? '' : row.unit);
            rows.push(rowOf(fitResult, bounds, row.name, { unit }));
            const width = row.name + PD_SUFFIX;
            if (row.pd !== null && has(params, width)) rows.push(rowOf(fitResult, bounds, width, { pd: pdOf(params, row.name) }));
        });
        return Object.freeze(rows);
    }

    /**
     * { value, error, kind } of one name as the page shows it (the rule of the result tiles, SasFitHtml): the value
     * rounded as it was written back, then SasFitFormat.valueError with the displayed error. kind 'fixed' (the full
     * number, no error) for a name that was not fitted, 'at-bound' (no error: it means nothing) for one on a bound.
     */
    function shownText(fitResult, name) {
        assertResult(fitResult, 'shownText');
        const format = globalThis.SasFitFormat;
        const exact = fitResult.params[name];
        const lone = (kind, body) => Object.freeze({ value: format.display(body), error: '', kind });
        if (fitResult.names.indexOf(name) < 0) return lone('fixed', typeof exact === 'number' && Number.isFinite(exact) ? num(exact) : format.MISSING);
        if (isObject(fitResult.atBound) && has(fitResult.atBound, name)) return lone('at-bound', format.number(exact, SHOWN_DIGITS));
        const errors = globalThis.SasFitWorkerCore.displayErrors(fitResult);
        const error = isObject(errors) ? errors[name] : NaN;
        return format.valueError(format.inputValue(exact, error), error, { illConditioned: fitResult.illConditioned === true });
    }

    function inFit(dataset, fitResult) {
        assertResult(fitResult, 'inFit');
        const { weighting, range } = fitResult.settings;
        const flags = new Uint8Array(dataset.q.length);
        globalThis.SasFitWeighting.select(dataset, weighting, range).index.forEach((i) => { flags[i] = 1; });
        return flags;
    }

    // ------------------------------------------------------------- fit-curve CSV

    /** 'chi2r' or 'weighted_mean_square_residual': the key of the fit measure in a comment line. */
    const measureKey = (fitResult) => (globalThis.SasFitHints.measure(fitResult).isChi2 ? MEASURE_KEYS.chi2 : MEASURE_KEYS.relative);

    /** '# param radius = 50.01 +/- 0.12 Ang (fitted)' */
    function paramLine(row) {
        const error = row.fitted && row.errorShown !== null ? ' +/- ' + num(row.errorShown) : '';
        const unit = row.unit === '' ? '' : ' ' + row.unit;
        const state = row.fitted ? 'fitted' + (row.atBound === null ? '' : BOUND_NOTES[row.atBound] || '') : 'fixed';
        const pd = row.pd === null ? '' : '; ' + row.pd.type + ' distribution; ' + num(row.pd.npts) + ' points'
            + (row.pd.nsigmas === null ? '' : '; ' + num(row.pd.nsigmas) + ' sigmas');
        return COMMENT + 'param ' + (row.name + ' = ' + num(row.value) + error + unit + ' (' + state + pd + ')').replace(CONTROL_RE, '_');
    }

    function modelLines(fitResult) {
        const { modelSpec } = fitResult.settings;
        const lines = [commentLine('model', modelText(modelSpec))];
        if (typeof modelSpec.structure === 'string') {
            lines.push(programLine('structure_factor', modelSpec.structure.replace(MODEL_UNSAFE_RE, '_') + ' combined as '
                + combinationText(fitResult) + '; effective radius: ' + radiusModeText(fitResult)));
        }
        return lines;
    }

    /** '# residual: (I - I_model)/w; w = sigma (weighting sigma)': what the residual column is. */
    function residualLine(weighting) {
        const w = has(RESIDUAL_WEIGHTS, weighting) ? RESIDUAL_WEIGHTS[weighting] : 'w by the weighting';
        return programLine('residual', '(I - I_model)/w; ' + w + ' (weighting ' + commentValue(weighting) + ')');
    }

    function commentLines({ file, fitResult, software: softwareText }) {
        const { settings } = fitResult;
        const official = file.dataset.kind === 'official';
        const scaled = fitResult.displayErrorsScaled === true;
        return [
            COMMENT + TITLE_LINE, COMMENT + READ_LINE,
            programLine('software', softwareText), commentLine('data_file', file.fileName),
            programLine('units', official ? UNITS_LINE.official : UNITS_LINE.generic),
        ].concat(modelLines(fitResult), [
            commentLine('weighting', settings.weighting), residualLine(settings.weighting),
            commentLine('q_range', num(settings.range.qMin) + ' to ' + num(settings.range.qMax) + ' 1/Ang'),
            commentLine('points_fitted', fitResult.dof + fitResult.names.length), commentLine('dof', fitResult.dof),
            commentLine('chi2', fitResult.chi2), commentLine(measureKey(fitResult), fitResult.chi2r),
            commentLine('status', fitResult.status), commentLine('iterations', fitResult.iterations),
            commentLine('errors', scaled ? 'multiplied by sqrt(weighted_mean_square_residual)' : 'not scaled'),
        ], paramRows(fitResult, null, { absolute: official }).map(paramLine));
    }

    function assertExportable(file, fitResult, what) {
        assertResult(fitResult, what);
        if (!isObject(file) || !isObject(file.dataset)) throw new Error(what + ' needs a file with data');
        if (fitResult.status === STOPPED) throw new Error(what + ': a stopped fit has no curve to export');
        const n = file.dataset.q.length;
        if (!isObject(fitResult.curve) || fitResult.curve.length !== n || !isObject(fitResult.residuals) || fitResult.residuals.length !== n) {
            throw new Error(what + ': the result does not belong to this data (' + n + ' points)');
        }
    }

    function fitCsv(input) {
        const { file, fitResult } = isObject(input) ? input : {};
        assertExportable(file, fitResult, 'fitCsv');
        const { q, I, sigma } = file.dataset;
        const flags = inFit(file.dataset, fitResult);
        const lines = commentLines(input).concat([CSV_HEADER.join(',')]);
        for (let i = 0; i < q.length; i++) {
            lines.push([q[i], I[i], sigma ? sigma[i] : null, fitResult.curve[i], fitResult.residuals[i], flags[i]].map(cell).join(','));
        }
        return lines.join('\n') + '\n';
    }

    // ------------------------------------------------------------- PNG bytes

    function dataUrlBytes(dataUrl) {
        if (typeof dataUrl !== 'string' || dataUrl.indexOf(PNG_PREFIX) !== 0) {
            throw new Error('dataUrlBytes accepts only ' + PNG_PREFIX + '...');
        }
        const body = dataUrl.slice(PNG_PREFIX.length);
        if (body === '' || !BASE64_RE.test(body)) throw new Error('dataUrlBytes: the base64 body is damaged');
        const binary = globalThis.atob(body);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error('dataUrlBytes: the data is not a PNG image');
        return Object.freeze({ mime: PNG_MIME, bytes });
    }

    globalThis.SasFitExport = Object.freeze({
        COMMENT, NAME_MAX_BYTES, CSV_HEADER, READ_LINE,
        num, cell, commentLine, safeName, safeLabel, fileName, modelText, combinationText, radiusModeText, software,
        paramRows, shownText, inFit, measureKey, assertExportable, fitCsv, dataUrlBytes,
    });
})();
