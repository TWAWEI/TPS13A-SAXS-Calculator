/**
 * sasfit-data-io.js -- reader for SAS data files handed over as text (design
 * spec 4.8): the official TPS 13A reduced .dat (27-line header) and generic
 * 2-4 column text files (q, I, optional sigma, optional dQ). Original code.
 *
 * Pure parsing: no DOM, no file access (the page reads the file and hands the
 * text over), no global state; nothing passed in is modified and every
 * returned object is frozen (the Float64Array columns are, by convention,
 * never written to after parse returns). Cleaning only flags, never drops a
 * data point: I < 0, sigma = 0 and non-finite rows stay in the arrays (the
 * weighting module masks them). Only the "000 000 000" placeholder rows of an
 * official file and lines that cannot be read are left out.
 *
 * Bounds (untrusted input): a token longer than MAX_TOKEN_CHARS is refused
 * before any regular expression sees it, and the number pattern has one way
 * to match a digit run, so no input makes parsing super-linear. At most
 * MAX_ISSUES issues are kept per file (issueOverflow counts the rest) and
 * reading stops one row past MAX_POINTS. conditionFromName looks only at the
 * last MAX_NAME_TAIL characters of a name.
 *
 * Generic files: the column count and the separator are those of the first
 * candidate line whose tokens are ALL numbers; candidate lines before it (a
 * header that starts with a digit, such as a date) are skipped. Without any
 * such line the first candidate decides, so that its errors are reported.
 *
 * suspectNm (generic file read as 1/Angstrom): max q > NM_SUSPECT_Q, or max
 * q > NM_SUSPECT_QMAX with the smallest positive q > NM_SUSPECT_QMIN (the
 * usual BioSAXS range in 1/nm is about 0.05-5).
 *
 * parse(text, { fileName, qUnit }) -> { dataset, issues, issueOverflow, notes }
 * never throws for bad file content; it returns { dataset: null, issues }
 * instead. Messages are Traditional Chinese
 * and may quote file content (cut to 40 characters): escape before innerHTML.
 */

(function () {
    'use strict';

    const LIMITS = Object.freeze({
        MAX_BYTES: 5 * 1024 * 1024, MAX_POINTS: 100000, MAX_ISSUES_LISTED: 5, MAX_ISSUES: 50, MAX_TOKEN_CHARS: 64,
        MAX_NAME_TAIL: 64,
    });
    const NM_SUSPECT_Q = 5;
    const NM_SUSPECT_QMAX = 1;
    const NM_SUSPECT_QMIN = 0.02;
    const QUOTE_MAX = 40;
    const OFFICIAL_SCAN_LINES = 60;
    const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/;       // one way to match a digit run
    const NON_FINITE_RE = /^([+-]?)(nan|inf|infinity)$/i;
    const DATA_START_RE = /^\s*[0-9+\-.]/;
    const NON_FINITE_START_RE = /^\s*[+-]?(?:nan|inf|infinity)(?=[\s,;]|$)/i;
    const SINGLE_FRAME_RE = /^\s*Single Frame Time\s*:/;
    const FRAME_TIME_RE = /Single Frame Time\s*:\s*([-+.\deE]+)/;
    const TABLE_HEAD_RE = /^\s*Q\s+I\s+ERROR\b/;
    // header key -> [explanation label printed after the value, 'string' | 'number']
    const HEADER_LABELS = Object.freeze([
        ['outputName', 'Output filename', 'string'],
        ['totalFrames', 'Total Frame Numbers', 'number'],
        ['energyKeV', 'Photon Energy (keV)', 'number'],
        ['scalingFactor', 'Scaling Factor', 'number'],
        ['sampleTransmission', 'Sample Transmission coefficient', 'number'],
        ['cellTransmission', 'Empty Cell Transmission coefficient', 'number'],
        ['thicknessMm', 'Sample thickness (mm)', 'number'],
        ['sddMm', 'Sample-to-Detector Distance (mm)', 'number'],
        ['qStart', 'Starting Q-value for data binning', 'number'],
    ]);

    const quote = (s) => '「' + (s.length > QUOTE_MAX ? s.slice(0, QUOTE_MAX) + '…' : s) + '」';
    const issue = (line, message) => Object.freeze({ line, message });

    /** A finite number, +-Infinity or NaN for the accepted spellings; undefined when the token is not a number. */
    function parseToken(token) {
        if (token.length > LIMITS.MAX_TOKEN_CHARS) return undefined;
        if (NUMBER_RE.test(token)) return Number(token.replace(/[dD]/, 'e'));
        const m = NON_FINITE_RE.exec(token);
        if (!m) return undefined;
        if (m[2].toLowerCase() === 'nan') return NaN;
        return m[1] === '-' ? -Infinity : Infinity;
    }

    /** Number found at the end of a name; a '-' in front is a minus sign unless it follows a letter or digit. */
    function conditionFromName(fileName) {
        if (typeof fileName !== 'string') return null;
        const base = fileName.slice(-LIMITS.MAX_NAME_TAIL).replace(/\.[A-Za-z][A-Za-z0-9]*$/, '');
        const m = /(\d+(?:\.\d+)?)$/.exec(base);
        if (!m) return null;
        const before = base.charAt(m.index - 1);
        const negative = before === '-' && !/[A-Za-z0-9]/.test(base.charAt(m.index - 2));
        return negative ? -Number(m[1]) : Number(m[1]);
    }

    function splitLines(text) {
        const lines = text.replace(/^﻿/, '').split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        return lines;
    }

    /** { tableStart } when the lines have the official layout, else null (spec 4.8 + plan Task 1). */
    function detectOfficial(lines) {
        const first = lines.find((l) => l.trim() !== '');
        if (first === undefined || first.indexOf('Data Collection Mode') < 0) return null;
        const scan = Math.min(OFFICIAL_SCAN_LINES, lines.length);
        for (let i = 0; i < scan; i++) {
            if (SINGLE_FRAME_RE.test(lines[i])) {
                return TABLE_HEAD_RE.test(lines[i + 1] || '') ? { frameLine: i, tableStart: i + 2 } : null;
            }
        }
        return null;
    }

    function headerValue(lines, count, label, kind) {
        for (let i = 0; i < count; i++) {
            const idx = lines[i].indexOf(label);
            if (idx < 0) continue;
            const raw = lines[i].slice(0, idx).trim();
            if (kind === 'string') return raw === '' ? null : raw;
            const v = parseToken(raw);
            return v === undefined || !Number.isFinite(v) ? null : v;
        }
        return null;
    }

    function readHeader(lines, frameLine) {
        const header = {};
        for (const [key, label, kind] of HEADER_LABELS) header[key] = headerValue(lines, frameLine, label, kind);
        const m = FRAME_TIME_RE.exec(lines[frameLine]);
        const t = m ? parseToken(m[1]) : undefined;
        header.frameTimeS = t === undefined || !Number.isFinite(t) ? null : t;
        return Object.freeze(header);
    }

    /** One data row -> [q, I, sigma, dq|null] numbers, or { error } describing the first problem. */
    function readRow(tokens, expectedCols) {
        if (expectedCols !== null && tokens.length !== expectedCols) {
            return { error: '欄數為 ' + tokens.length + '，應為 ' + expectedCols };
        }
        const values = [];
        for (const t of tokens) {
            const v = parseToken(t);
            if (v === undefined) {
                if (t.length > LIMITS.MAX_TOKEN_CHARS) return { error: '數字過長（超過 ' + LIMITS.MAX_TOKEN_CHARS + ' 個字元）：' + quote(t) };
                const decimalComma = /^[+-]?\d*,\d+$/.test(t);
                return { error: decimalComma ? '不支援小數逗號，請改用小數點：' + quote(t) : '無法讀成數字：' + quote(t) };
            }
            values.push(v);
        }
        return { values };
    }

    /** Collects at most MAX_ISSUES issues; `overflow` counts the ones left out. */
    function issueLog() {
        const list = [];
        const log = { list, overflow: 0 };
        log.add = (line, message) => {
            if (list.length < LIMITS.MAX_ISSUES) list.push(issue(line, message)); else log.overflow += 1;
        };
        return log;
    }

    const rowsFull = (rows) => rows.length > LIMITS.MAX_POINTS;      // one row past the limit is enough to refuse the file

    function parseOfficialRows(lines, start) {
        const rows = [];
        const log = issueLog();
        let placeholders = 0;
        for (let i = start; i < lines.length && !rowsFull(rows); i++) {
            const tokens = lines[i].trim().split(/\s+/);
            if (tokens.length === 1 && tokens[0] === '') continue;
            if (tokens.length === 3 && tokens.every((t) => t === '000')) { placeholders++; continue; }
            if (tokens.length < 3) { log.add(i + 1, '欄數為 ' + tokens.length + '，應至少 3 欄：' + quote(lines[i].trim())); continue; }
            const r = readRow(tokens.slice(0, 3), null);
            if (r.error) { log.add(i + 1, r.error); continue; }
            const dq = tokens.length > 3 ? parseToken(tokens[3]) : undefined;
            rows.push(dq === undefined ? r.values : r.values.concat([dq]));
        }
        return { rows, issues: log.list, issueOverflow: log.overflow, placeholders, skipped: 0 };
    }

    function isCandidate(line) {
        const t = line.trim();
        if (t === '' || t.charAt(0) === '#' || t.charAt(0) === ';') return false;
        return DATA_START_RE.test(line) || NON_FINITE_START_RE.test(line);
    }

    /** ';' beats ',' beats whitespace; decided once from the first candidate line. */
    const pickSeparator = (line) => (line.indexOf(';') >= 0 ? ';' : (line.indexOf(',') >= 0 ? ',' : null));

    function splitRow(line, sep) {
        return sep === null ? line.trim().split(/\s+/) : line.split(sep).map((t) => t.trim());
    }

    const allNumeric = (tokens) => tokens.every((t) => parseToken(t) !== undefined);

    /**
     * Where the table of a generic file starts: { at, sep, cols } of the first candidate line whose tokens are all
     * numbers, else of the first candidate line (its errors are then reported); null without a candidate.
     */
    function findTable(lines) {
        let first = null;
        for (let i = 0; i < lines.length; i++) {
            if (!isCandidate(lines[i])) continue;
            const sep = pickSeparator(lines[i]);
            const tokens = splitRow(lines[i], sep);
            const found = { at: i, sep, cols: tokens.length };
            if (allNumeric(tokens)) return found;
            if (first === null) first = found;
        }
        return first;
    }

    function parseGenericRows(lines) {
        const rows = [];
        const log = issueLog();
        const table = findTable(lines);
        const done = (skipped) => ({ rows, issues: log.list, issueOverflow: log.overflow, placeholders: 0, skipped });
        if (table === null) return done(lines.length);
        if (table.cols < 2 || table.cols > 4) {
            log.add(table.at + 1, '資料列欄數為 ' + table.cols + '，需為 2 至 4 欄：' + quote(lines[table.at].trim()));
            return done(table.at);
        }
        let skipped = table.at;
        for (let i = table.at; i < lines.length && !rowsFull(rows); i++) {
            if (!isCandidate(lines[i])) { skipped++; continue; }
            const tokens = splitRow(lines[i], table.sep);
            const empty = tokens.indexOf('');
            const r = empty >= 0 ? { error: '第 ' + (empty + 1) + ' 欄是空的' } : readRow(tokens, table.cols);
            if (r.error) log.add(i + 1, r.error); else rows.push(r.values);
        }
        return done(skipped);
    }

    /** Total order for q: finite ascending, non-finite last (never a - b). */
    function qOrder(a, b) {
        const fa = Number.isFinite(a);
        const fb = Number.isFinite(b);
        if (fa && fb) return a < b ? -1 : (a > b ? 1 : 0);
        if (fa) return -1;
        return fb ? 1 : 0;
    }

    /** { rows, sorted } with the rows in q order (stable); the input array is not changed. */
    function sortRows(rows) {
        let ordered = true;
        for (let i = 1; i < rows.length && ordered; i++) ordered = qOrder(rows[i - 1][0], rows[i][0]) <= 0;
        if (ordered) return { rows, sorted: false };
        return { rows: rows.slice().sort((a, b) => qOrder(a[0], b[0])), sorted: true };
    }

    function buildColumns(rows, scale) {
        const n = rows.length;
        const q = new Float64Array(n);
        const I = new Float64Array(n);
        const hasCol = (k) => rows.some((r) => r.length > k);
        const col = (r, k) => (r.length > k ? r[k] : NaN);
        const sigma = hasCol(2) ? new Float64Array(n) : null;
        const dq = hasCol(3) ? new Float64Array(n) : null;
        for (let i = 0; i < n; i++) {
            q[i] = rows[i][0] * scale;
            I[i] = rows[i][1];
            if (sigma) sigma[i] = col(rows[i], 2);
            if (dq) dq[i] = col(rows[i], 3) * scale;
        }
        return { q, I, sigma, dq };
    }

    function suspectNm(q, qUnit, official) {
        if (official || qUnit !== 'A') return false;
        let max = -Infinity;
        let min = Infinity;
        for (let i = 0; i < q.length; i++) {
            if (!Number.isFinite(q[i]) || !(q[i] > 0)) continue;
            if (q[i] > max) max = q[i];
            if (q[i] < min) min = q[i];
        }
        return max > NM_SUSPECT_Q || (max > NM_SUSPECT_QMAX && min > NM_SUSPECT_QMIN);
    }

    function failure(issues, notes, issueOverflow) {
        return Object.freeze({ dataset: null, issues: Object.freeze(issues), issueOverflow, notes: Object.freeze(notes) });
    }

    function assembleDataset(parsed, ctx) {
        const { official, header, fileName, qUnit } = ctx;
        const sortedResult = sortRows(parsed.rows);
        const cols = buildColumns(sortedResult.rows, official || qUnit === 'A' ? 1 : 0.1);
        const condition = conditionFromName(fileName) ?? (header ? conditionFromName(header.outputName) : null);
        const dataset = Object.freeze({
            fileName, kind: official ? 'official' : 'generic', header, q: cols.q, I: cols.I,
            sigma: cols.sigma, dq: cols.dq, condition, qUnit: official ? 'A' : qUnit,
        });
        const notes = Object.freeze({
            skipped: parsed.skipped, placeholders: parsed.placeholders, sorted: sortedResult.sorted,
            suspectNm: suspectNm(cols.q, qUnit, official),
        });
        return { dataset, notes };
    }

    function parse(text, options) {
        const opts = options || {};
        const qUnit = opts.qUnit === undefined ? 'A' : opts.qUnit;
        if (qUnit !== 'A' && qUnit !== 'nm') throw new Error("qUnit must be 'A' or 'nm', got " + String(qUnit));
        const fileName = typeof opts.fileName === 'string' ? opts.fileName : '';
        const emptyNotes = { skipped: 0, placeholders: 0, sorted: false, suspectNm: false };
        if (typeof text !== 'string') return failure([issue(null, '輸入不是文字內容')], emptyNotes, 0);
        const lines = splitLines(text);
        const found = detectOfficial(lines);
        const parsed = found ? parseOfficialRows(lines, found.tableStart) : parseGenericRows(lines);
        const issues = parsed.issues.slice();
        const notes = { ...emptyNotes, skipped: parsed.skipped, placeholders: parsed.placeholders };
        if (parsed.rows.length === 0) issues.push(issue(null, '檔案沒有可用的資料列'));
        if (parsed.rows.length > LIMITS.MAX_POINTS) {
            issues.push(issue(null, '資料點數超過上限 ' + LIMITS.MAX_POINTS + ' 點，未讀完'));
        }
        if (parsed.rows.length === 0 || parsed.rows.length > LIMITS.MAX_POINTS) return failure(issues, notes, parsed.issueOverflow);
        const header = found ? readHeader(lines, found.frameLine) : null;
        const built = assembleDataset(parsed, { official: Boolean(found), header, fileName, qUnit });
        return Object.freeze({
            dataset: built.dataset, issues: Object.freeze(issues), issueOverflow: parsed.issueOverflow, notes: built.notes,
        });
    }

    globalThis.SasFitDataIo = Object.freeze({ LIMITS, parse, conditionFromName });
})();
