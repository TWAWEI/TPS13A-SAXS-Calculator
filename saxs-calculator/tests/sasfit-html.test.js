'use strict';
/**
 * sasfit-html.js: the pure HTML builders of the SAS fitting page
 * (design spec 5.2-5.4, 5.7 items 5, 8, 11; 13; plan M3 Task 8).
 *
 * The core requirement is that no string from a file or from the user reaches
 * the output unescaped. checkMarkup() is a structural proof of that: once
 * every well-formed tag (lower-case name, whitelisted attribute names,
 * double-quoted values without `"`, `<`, `>`) is removed, no `<` or `>` may
 * be left. The XSS matrix runs every builder with every payload in every
 * string input.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SasFitHtml: H, SasFitForm: F, SasFitHints: Hints, SasFitSld: Sld, SasFitMeta: Meta, SasFitDataIo: DataIo,
    FormUtils, ResultTiles,
} = require('./load.js');
const { FIT_RESULT_FIELDS } = require('./sasfit-fit-helpers.js');

const esc = FormUtils.escapeHtml;
const count = (text, needle) => text.split(needle).length - 1;
const ID_RE = /^sf[A-Z]\w*$/;
const TAG_RE = /<\/?([a-z][a-z0-9]*)((?:\s+[a-z][a-z-]*(?:="[^"<>]*")?)*)\s*>/g;
const ATTR_RE = /\s+([a-z][a-z-]*)(?:="([^"<>]*)")?/g;
const ALLOWED_TAGS = Object.freeze(['a', 'button', 'div', 'input', 'label', 'li', 'optgroup', 'option', 'p', 'select', 'span',
    'strong', 'td', 'th', 'tr', 'ul']);
const ALLOWED_ATTRS = Object.freeze(['aria-controls', 'aria-describedby', 'aria-expanded', 'aria-hidden', 'aria-invalid',
    'aria-label', 'aria-labelledby', 'aria-live', 'autocomplete', 'checked', 'class', 'colspan', 'data-action',
    'data-field', 'data-group', 'data-hint', 'data-id', 'data-param', 'data-series', 'data-target', 'disabled', 'for', 'label',
    'hidden', 'href', 'id', 'inputmode', 'maxlength', 'name', 'placeholder', 'rel', 'role', 'scope', 'selected',
    'spellcheck', 'step', 'target', 'title', 'type', 'value']);

/** Every tag of html as { name, attrs: { name: value | true }, closing }; throws on anything that is not a well-formed tag. */
function checkMarkup(html, label) {
    assert.equal(typeof html, 'string', label);
    const tags = [];
    const rest = html.replace(TAG_RE, (whole, name, attrText) => {
        const attrs = {};
        for (const m of attrText.matchAll(ATTR_RE)) {
            assert.ok(!Object.prototype.hasOwnProperty.call(attrs, m[1]), label + ': duplicate attribute ' + m[1] + ' in ' + whole);
            attrs[m[1]] = m[2] === undefined ? true : m[2];
        }
        tags.push({ name, attrs, closing: whole[1] === '/' });
        return '';
    });
    assert.ok(!/[<>]/.test(rest), label + ': a < or > outside a well-formed tag: ' + rest.slice(0, 300));
    tags.forEach((t) => {
        assert.ok(ALLOWED_TAGS.includes(t.name), label + ': unexpected tag <' + t.name + '>');
        Object.keys(t.attrs).forEach((a) => {
            assert.ok(!/^on/.test(a), label + ': event handler attribute ' + a);
            assert.ok(ALLOWED_ATTRS.includes(a), label + ': unexpected attribute ' + a);
        });
    });
    assert.ok(!/javascript:/i.test(html), label + ': javascript: URL');
    return tags;
}
const openTags = (html, name) => checkMarkup(html, name).filter((t) => !t.closing && t.name === name);
const byAttr = (tags, attr, value) => tags.filter((t) => !t.closing && t.attrs[attr] === value);
const idsOf = (tags) => tags.filter((t) => !t.closing && t.attrs.id !== undefined).map((t) => t.attrs.id);
const textOf = (html) => html.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();

function fitResult(overrides) {
    const r = {
        params: { scale: 1.2345, background: 0.001, radius: 50.1234, radius_pd: 0.1, thickness: 10 },
        names: ['scale', 'radius', 'radius_pd'],
        errors: { scale: 0.0123, radius: 0.5, radius_pd: 0.01 },
        errorsScaled: { scale: 0.0246, radius: 1, radius_pd: 0.02 },
        displayErrorsScaled: false,
        covariance: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        correlation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        chi2: 110, chi2r: 1.1, dof: 97, iterations: 12, status: 'converged', atBound: {},
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve: new Float64Array(3), residuals: new Float64Array(3),
        settings: { modelSpec: { model: 'core_shell_sphere', structure: null, lowQPowerLaw: false }, weighting: 'sigma',
            range: { qMin: 0.01, qMax: 0.3 }, cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10 },
        ...overrides,
    };
    assert.deepEqual(Object.keys(r).sort(), [...FIT_RESULT_FIELDS].sort());
    return Object.freeze(r);
}

const fileRow = (overrides) => Object.freeze({
    id: 'd1', index: 0, fileName: 'a.dat', hasData: true, shown: true, active: false, condition: null,
    statusText: '未擬合', issues: [], issueOverflow: 0, locked: false, ...overrides,
});

// ------------------------------------------------------------------ module shape

test('SasFitHtml is one frozen export on globalThis and reads nothing at load time', () => {
    assert.equal(globalThis.SasFitHtml, H);
    assert.ok(Object.isFrozen(H));
    ['fileRowsHtml', 'paramTableHeadHtml', 'paramTableHtml', 'sldPanelHtml', 'sldOutputHtml', 'weightingOptionsHtml',
        'resultsHtml', 'hintsHtml', 'statusChipHtml', 'modelInfoHtml', 'formatValueError', 'formatNumber', 'unitText',
        'paramFieldId', 'paramErrorId', 'fileControlId'].forEach((name) => assert.equal(typeof H[name], 'function', name));
    assert.equal(H.MISSING, '—');
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'sasfit-html.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bdocument\b|\bChart\b|setTimeout|setInterval|innerHTML/.test(code), 'no DOM, Chart or timers');
    assert.ok(!/style=/.test(code), 'no inline style');
    assert.equal(count(code, 'escapeHtml'), 1, 'escapeHtml is reached once, through host().FormUtils');
    assert.ok(/host\(\)\.FormUtils\.escapeHtml/.test(code));
});

// ------------------------------------------------------------------ units and numbers

test('unitText turns the ten unit strings of the meta into display text', () => {
    assert.equal(H.unitText('Ang'), 'Å');
    assert.equal(H.unitText('1e-6/Ang^2'), '10⁻⁶ Å⁻²');
    assert.equal(H.unitText('1/Ang'), 'Å⁻¹');
    assert.equal(H.unitText('1/cm'), 'cm⁻¹');
    assert.equal(H.unitText('degrees'), '°');
    assert.equal(H.unitText(''), '');
    assert.equal(H.unitText('None'), '');
    assert.equal(H.unitText(undefined), '');
    assert.equal(H.unitText(null), '');
    ['e', 'K', 'M', 'furlongs'].forEach((u) => assert.equal(H.unitText(u), u));
    const seen = new Set();
    Object.values(Meta.models).forEach((m) => m.params.forEach((p) => seen.add(p.units)));
    assert.deepEqual([...seen].sort(), ['', '1/Ang', '1/cm', '1e-6/Ang^2', 'Ang', 'K', 'M', 'None', 'degrees', 'e'].sort());
    seen.forEach((u) => assert.ok(!/Ang|None|degrees|\^/.test(H.unitText(u)), 'still raw: ' + u));
});

test('formatValueError: error to 2 significant figures, value to the same decimal', () => {
    assert.deepEqual(H.formatValueError(50.1234, 0.0123), { value: '50.123', error: '0.012' });
    assert.deepEqual(H.formatValueError(1234.5, 12), { value: '1235', error: '12' });
    assert.deepEqual(H.formatValueError(12345, 1234), { value: '12300', error: '1200' });
    assert.deepEqual(H.formatValueError(50, 0.5), { value: '50.00', error: '0.50' });
    assert.deepEqual(H.formatValueError(1.5, 0.0996), { value: '1.50', error: '0.10' });
    assert.deepEqual(H.formatValueError(-3.21987, 0.045), { value: '-3.220', error: '0.045' });
    assert.deepEqual(H.formatValueError(0.001, 0.0001), { value: '0.00100', error: '0.00010' });
    assert.deepEqual(H.formatValueError(0, 0.25), { value: '0.00', error: '0.25' });
});

test('formatValueError: an unusable error leaves the value at 5 significant figures and a dash', () => {
    [0, NaN, Infinity, -Infinity, -0.5, undefined, null, '0.1'].forEach((error) => {
        assert.deepEqual(H.formatValueError(50.12345678, error), { value: '50.123', error: '—' }, String(error));
    });
    assert.deepEqual(H.formatValueError(NaN, 0.5), { value: '—', error: '0.50' });
    assert.deepEqual(H.formatValueError(NaN, NaN), { value: '—', error: '—' });
    assert.deepEqual(H.formatValueError('<b>', 1), { value: '—', error: '1.0' });
    assert.deepEqual(H.formatValueError(Infinity, 1), { value: '—', error: '1.0' });
});

test('formatValueError: very small and very large numbers share one exponent', () => {
    assert.deepEqual(H.formatValueError(2.5e-6, 1.2e-7), { value: '2.50e-6', error: '0.12e-6' });
    assert.deepEqual(H.formatValueError(3.2e8, 4.5e6), { value: '3.200e8', error: '0.045e8' });
    assert.deepEqual(H.formatValueError(-2.5e-6, 1.2e-7), { value: '-2.50e-6', error: '0.12e-6' });
    assert.deepEqual(H.formatValueError(0, 1.2e-7), { value: '0.0e-7', error: '1.2e-7' });
    assert.deepEqual(H.formatValueError(2.5e-6, NaN), { value: '2.5000e-6', error: '—' });
    assert.deepEqual(H.formatValueError(123456789, 0), { value: '1.2346e8', error: '—' });
});

test('formatNumber: significant figures, plain between 1e-3 and 1e5, a dash for anything that is not a finite number', () => {
    assert.equal(H.formatNumber(1.1, 3), '1.10');
    assert.equal(H.formatNumber(1234.5, 3), '1230');
    assert.equal(H.formatNumber(0.012345, 3), '0.0123');
    assert.equal(H.formatNumber(99999, 3), '100000');
    assert.equal(H.formatNumber(1234567, 3), '1.23e6');
    assert.equal(H.formatNumber(0.00012345, 3), '1.23e-4');
    assert.equal(H.formatNumber(0, 3), '0');
    assert.equal(H.formatNumber(9.4263, 6), '9.42630');
    [NaN, Infinity, -Infinity, undefined, null, '1', {}].forEach((v) => assert.equal(H.formatNumber(v, 3), '—'));
});

// ------------------------------------------------------------------ file rows

test('fileRowsHtml: one row per file with a colour sample, show, active, name, condition, status and remove', () => {
    const html = H.fileRowsHtml([
        fileRow({ id: 'd1', index: 0, fileName: 'B1216_1_10.dat', active: true, condition: 10, statusText: 'χ²ᵣ 1.10 已收斂' }),
        fileRow({ id: 'd2', index: 1, fileName: 'b.dat', shown: false, condition: -2.5 }),
    ]);
    const tags = checkMarkup(html, 'fileRows');
    assert.equal(tags.filter((t) => t.name === 'tr' && !t.closing).length, 2);
    const first = byAttr(tags, 'data-id', 'd1');
    assert.deepEqual(first.map((t) => t.attrs['data-action'] || t.name), ['tr', 'show', 'active', 'condition', 'remove']);
    const show = byAttr(tags, 'data-action', 'show');
    assert.deepEqual(show.map((t) => [t.attrs.type, t.attrs.checked === true, t.attrs['aria-label']]),
        [['checkbox', true, '顯示 B1216_1_10.dat'], ['checkbox', false, '顯示 b.dat']]);
    const active = byAttr(tags, 'data-action', 'active');
    assert.deepEqual(active.map((t) => [t.attrs.type, t.attrs.name, t.attrs.checked === true]),
        [['radio', 'sfActive', true], ['radio', 'sfActive', false]]);
    assert.ok(active.every((t) => /作用中/.test(t.attrs['aria-label']) && t.attrs.disabled === undefined));
    const cond = byAttr(tags, 'data-action', 'condition');
    assert.deepEqual(cond.map((t) => [t.attrs.type, t.attrs.value, t.attrs['aria-label']]),
        [['number', '10', 'B1216_1_10.dat 的條件值'], ['number', '-2.5', 'b.dat 的條件值']]);
    const remove = byAttr(tags, 'data-action', 'remove');
    assert.deepEqual(remove.map((t) => [t.name, t.attrs.type, t.attrs['aria-label']]),
        [['button', 'button', '移除 B1216_1_10.dat'], ['button', 'button', '移除 b.dat']]);
    const chips = tags.filter((t) => !t.closing && /\bchannel-chip\b/.test(t.attrs.class || ''));
    assert.deepEqual(chips.map((t) => [t.attrs['data-series'], t.attrs['aria-hidden']]), [['0', 'true'], ['1', 'true']]);
    assert.ok(/χ²ᵣ 1\.10 已收斂/.test(html) && /未擬合/.test(html));
    assert.ok(/class="[^"]*\bis-active\b/.test(html.slice(0, html.indexOf('</tr>'))));
    assert.equal(tags.filter((t) => !t.closing && t.name === 'th').every((t) => t.attrs.scope === 'row'), true);
    assert.equal(H.fileRowsHtml([]), '');
});

test('fileRowsHtml: the ninth file on reuses a colour, its sample is dashed like its curve', () => {
    const html = H.fileRowsHtml([fileRow({ id: 'd8', index: 7 }), fileRow({ id: 'd9', index: 8 })]);
    const chips = openTags(html, 'span').filter((t) => /\bchannel-chip\b/.test(t.attrs.class || ''));
    assert.deepEqual(chips.map((t) => /channel-chip--dashed/.test(t.attrs.class)), [false, true]);
    assert.deepEqual(chips.map((t) => t.attrs['data-series']), ['7', '8']);
});

test('fileRowsHtml: issues are listed in the row with their line, at most MAX_ISSUES_LISTED plus the rest as a count', () => {
    const issues = Array.from({ length: 7 }, (_, i) => ({ line: i + 3, message: '欄數不對 ' + i }));
    const html = H.fileRowsHtml([fileRow({ issues, issueOverflow: 4 })]);
    const items = html.match(/<li>[^<]*<\/li>/g);
    assert.equal(items.length, DataIo.LIMITS.MAX_ISSUES_LISTED + 1);
    assert.equal(items[0], '<li>第 3 行：欄數不對 0</li>');
    assert.equal(items[5], '<li>另有 6 行</li>');          // 2 not listed here + 4 the caller left out
    const noLine = H.fileRowsHtml([fileRow({ issues: [{ line: null, message: '檔案沒有可用的資料列' }] })]);
    assert.ok(noLine.includes('<li>檔案沒有可用的資料列</li>'));
    assert.ok(!/另有/.test(noLine));
    assert.ok(!/<ul/.test(H.fileRowsHtml([fileRow()])));
});

test('fileRowsHtml: a file that failed has its name, the reasons and remove only', () => {
    const html = H.fileRowsHtml([fileRow({ id: 'd3', hasData: false, statusText: '無法載入',
        issues: [{ line: 28, message: '不是數字' }] })]);
    const tags = checkMarkup(html, 'failed');
    assert.deepEqual(tags.filter((t) => t.attrs['data-action']).map((t) => t.attrs['data-action']), ['remove']);
    assert.equal(openTags(html, 'input').length, 0);
    assert.ok(html.includes('a.dat') && html.includes('第 28 行：不是數字') && html.includes('無法載入'));
    assert.ok(!/channel-chip/.test(html));
    assert.equal(count(html, '<td'), 5, 'the row keeps the six columns of the table');
    assert.ok(/sf-file-row--failed/.test(html));
});

test('fileRowsHtml: while a fit runs, active and remove are disabled, show and condition stay usable', () => {
    const tags = checkMarkup(H.fileRowsHtml([fileRow({ locked: true }), fileRow({ id: 'd2', hasData: false, locked: true })]), 'locked');
    const state = (action) => byAttr(tags, 'data-action', action).map((t) => t.attrs.disabled === true);
    assert.deepEqual(state('active'), [true]);
    assert.deepEqual(state('remove'), [true, true]);
    assert.deepEqual(state('show'), [false]);
    assert.deepEqual(state('condition'), [false]);
});

test('fileRowsHtml: a status tone turns the status into a chip; an unknown tone throws', () => {
    assert.ok(H.fileRowsHtml([fileRow({ statusText: '已收斂', statusTone: 'ok' })])
        .includes('<span class="tile-chip tile-chip--ok">已收斂</span>'));
    assert.throws(() => H.fileRowsHtml([fileRow({ statusTone: 'x" onload="1' })]), /tone/);
});

// ------------------------------------------------------------------ parameter table

const HEAD = ['擬合', '參數', '數值', '±', '下限', '上限', 'PD'];

test('paramTableHeadHtml: seven column headers with scope; the error column says when it is multiplied', () => {
    const plain = H.paramTableHeadHtml({ fitResult: null, matches: false });
    const ths = openTags(plain, 'th');
    assert.equal(ths.length, 7);
    assert.ok(ths.every((t) => t.attrs.scope === 'col'));
    assert.deepEqual(plain.match(/<th[^>]*>([^<]*)<\/th>/g).map((s) => s.replace(/<[^>]*>/g, '')), HEAD);
    assert.equal(H.paramTableHeadHtml(undefined), plain);
    assert.equal(H.paramTableHeadHtml({ fitResult: fitResult(), matches: true }), plain);

    const scaled = fitResult({ displayErrorsScaled: true, chi2r: 4 });
    const html = H.paramTableHeadHtml({ fitResult: scaled, matches: true });
    const column = Hints.errorColumn(scaled);
    assert.equal(column.label, '±（已乘 √χ²ᵣ）');
    assert.ok(html.includes('>' + column.label + '</th>'));
    const th = openTags(html, 'th')[3];
    assert.equal(th.attrs.title, column.title);
    assert.ok(/SasView/.test(th.attrs.title) && /2\.00/.test(th.attrs.title));
    assert.equal(H.paramTableHeadHtml({ fitResult: scaled, matches: false }), plain, 'a result that does not match the form shows no errors');
});

function tableOf(form, ctx) {
    const rows = F.rows(form);
    const html = H.paramTableHtml(rows, ctx);
    return { rows, html, tags: checkMarkup(html, 'paramTable') };
}
const fieldOf = (tags, param, field) => tags.find((t) => !t.closing && t.attrs['data-param'] === param && t.attrs['data-field'] === field);

test('paramTableHtml: one row of seven cells per parameter, name and unit, labelled inputs', () => {
    const { rows, html, tags } = tableOf(F.create('sphere'));
    const trs = tags.filter((t) => t.name === 'tr' && !t.closing);
    const paramRows = trs.filter((t) => /\bsf-param-row\b/.test(t.attrs.class));
    assert.deepEqual(paramRows.map((t) => t.attrs['data-param']), rows.map((r) => r.name));
    html.split('</tr>').filter((s) => /sf-param-row/.test(s)).forEach((row) => {
        assert.equal(count(row, '<td') + count(row, '<th'), 7, row.slice(0, 80));
        assert.equal(count(row, '<th scope="row"'), 1);
    });
    assert.ok(html.includes('<span class="sf-param-name">radius</span><span class="sf-param-unit">Å</span>'));
    assert.ok(html.includes('<span class="sf-param-name">sld</span><span class="sf-param-unit">10⁻⁶ Å⁻²</span>'));
    assert.ok(html.includes('<span class="sf-param-name">scale</span></th>'), 'no empty unit element');
    const radius = { fit: fieldOf(tags, 'radius', 'fit'), value: fieldOf(tags, 'radius', 'value'),
        lower: fieldOf(tags, 'radius', 'lower'), upper: fieldOf(tags, 'radius', 'upper') };
    assert.equal(radius.fit.attrs.type, 'checkbox');
    assert.equal(radius.fit.attrs.checked, undefined);
    assert.equal(fieldOf(tags, 'scale', 'fit').attrs.checked, true);
    assert.deepEqual([radius.fit, radius.value, radius.lower, radius.upper].map((t) => t.attrs['aria-label']),
        ['擬合 radius', 'radius 數值', 'radius 下限', 'radius 上限']);
    assert.equal(radius.value.attrs.value, '50');
    assert.equal(radius.lower.attrs.value, '0');
    assert.equal(radius.upper.attrs.value, '');
    assert.equal(radius.upper.attrs.placeholder, '不限');
    assert.equal(radius.lower.attrs.placeholder, '不限');
    assert.equal(radius.value.attrs.placeholder, undefined);
    assert.equal(radius.value.attrs['aria-invalid'], undefined);
    assert.equal(radius.value.attrs.id, H.paramFieldId('radius', 'value'));
});

test('paramTableHtml: an SLD parameter has a formula button next to its value; others do not', () => {
    const { tags } = tableOf(F.create('sphere'));
    const buttons = byAttr(tags, 'data-action', 'sld');
    assert.deepEqual(buttons.map((t) => t.attrs['data-param']), ['sld', 'sld_solvent']);
    assert.ok(buttons.every((t) => t.name === 'button' && t.attrs.type === 'button' && /sld/.test(t.attrs['aria-label'])));
});

test('paramTableHtml: a row that cannot be fitted has no tick box and shows its note', () => {
    const form = F.reduce(F.create('sphere'), { type: 'setStructure', structure: 'hardsphere' });
    const { rows, html, tags } = tableOf(form);
    const derived = rows.filter((r) => !r.fittable);
    assert.deepEqual(derived.map((r) => r.name), ['radius_effective']);
    assert.equal(fieldOf(tags, 'radius_effective', 'fit'), undefined);
    assert.equal(fieldOf(tags, 'radius_effective', 'value').attrs.disabled, true);
    assert.ok(html.includes('<span class="sf-param-note">' + derived[0].note + '</span>'));
    assert.ok(fieldOf(tags, 'volfraction', 'fit') !== undefined);
    assert.deepEqual(tags.filter((t) => /\bsf-param-row\b/.test(t.attrs.class || '')).map((t) => t.attrs['data-group']),
        rows.map((r) => r.group));
});

test('paramTableHtml: every field has its error element; a field with an error is invalid and describes itself by it', () => {
    let form = F.reduce(F.create('sphere'), { type: 'setValue', name: 'radius', value: 'abc' });
    form = F.reduce(form, { type: 'setLower', name: 'scale', value: '5' });
    form = F.reduce(form, { type: 'setUpper', name: 'scale', value: '2' });
    const { rows, html, tags } = tableOf(form);
    const radiusRow = rows.find((r) => r.name === 'radius');
    assert.ok(radiusRow.errors.value, 'the form reports the error');
    const input = fieldOf(tags, 'radius', 'value');
    assert.equal(input.attrs['aria-invalid'], 'true');
    assert.equal(input.attrs['aria-describedby'], H.paramErrorId('radius', 'value'));
    assert.equal(input.attrs.value, 'abc', 'what the user typed stays in the field');
    assert.ok(html.includes('<p class="sf-field-error" id="' + H.paramErrorId('radius', 'value') + '">' + esc(radiusRow.errors.value) + '</p>'));
    const scaleRow = rows.find((r) => r.name === 'scale');
    Object.keys(scaleRow.errors).forEach((field) => {
        assert.equal(fieldOf(tags, 'scale', field).attrs['aria-invalid'], 'true', field);
        assert.ok(html.includes(esc(scaleRow.errors[field])));
    });
    assert.ok(Object.keys(scaleRow.errors).length > 0);
    // fields without an error: the element exists, is hidden and empty, and the input is not marked
    const ok = fieldOf(tags, 'background', 'value');
    assert.equal(ok.attrs['aria-invalid'], undefined);
    assert.equal(ok.attrs['aria-describedby'], H.paramErrorId('background', 'value'));
    assert.ok(html.includes('<p class="sf-field-error" id="' + H.paramErrorId('background', 'value') + '" hidden></p>'));
    const errorEls = tags.filter((t) => !t.closing && t.attrs.class === 'sf-field-error');
    const described = tags.filter((t) => !t.closing && t.attrs['aria-describedby']);
    assert.deepEqual(described.map((t) => t.attrs['aria-describedby']).sort(), errorEls.map((t) => t.attrs.id).sort());
});

test('paramTableHtml: a polydisperse parameter has an expand button; its row is filled only when open', () => {
    const closed = tableOf(F.create('sphere'));
    const toggles = byAttr(closed.tags, 'data-action', 'togglePd');
    assert.deepEqual(toggles.map((t) => t.attrs['data-param']), ['radius']);
    assert.equal(toggles[0].attrs['aria-expanded'], 'false');
    assert.equal(toggles[0].attrs['aria-controls'], 'sfPdRow_radius');
    assert.ok(closed.html.includes('<tr class="sf-pd-row" id="sfPdRow_radius" data-param="radius" hidden></tr>'));
    assert.equal(fieldOf(closed.tags, 'radius', 'pd.width'), undefined);

    const open = tableOf(F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' }));
    const toggle = byAttr(open.tags, 'data-action', 'togglePd')[0];
    assert.equal(toggle.attrs['aria-expanded'], 'true');
    const pdRow = open.tags.find((t) => t.attrs.id === toggle.attrs['aria-controls']);
    assert.equal(pdRow.name, 'tr');
    assert.equal(pdRow.attrs.hidden, undefined);
    assert.ok(open.html.includes('<td colspan="7">'));
    const fields = ['pd.fit', 'pd.width', 'pd.lower', 'pd.upper', 'pd.type', 'pd.npts', 'pd.nsigmas'];
    const els = fields.map((f) => fieldOf(open.tags, 'radius', f));
    assert.ok(els.every((t) => t !== undefined));
    assert.deepEqual(els.map((t) => t.attrs['aria-label']), ['擬合 radius 的 PD 寬度', 'radius 的 PD 寬度', 'radius 的 PD 寬度下限',
        'radius 的 PD 寬度上限', 'radius 的 PD 分布', 'radius 的 PD 點數', 'radius 的 PD nsigmas']);
    assert.deepEqual([els[1], els[2], els[3], els[5], els[6]].map((t) => t.attrs.value), ['0', '0', '0.4', '35', '3']);
    assert.equal(els[4].name, 'select');
    const options = open.html.slice(open.html.indexOf('<select'), open.html.indexOf('</select>')).match(/<option[^>]*>[^<]*/g);
    assert.deepEqual(options.map((o) => o.replace(/<[^>]*>/, '')), F.PD_TYPES);
    assert.equal(options.filter((o) => / selected/.test(o)).length, 1);
    assert.ok(/value="gaussian" selected/.test(options.find((o) => / selected/.test(o))));
    assert.equal(els[6].attrs.disabled, undefined);
    els.forEach((t) => assert.equal(t.attrs.id, H.paramFieldId('radius', t.attrs['data-field'])));
});

test('paramTableHtml: nsigmas is disabled for uniform; PD field errors are attached to their fields', () => {
    let form = F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    form = F.reduce(form, { type: 'setPdField', name: 'radius', field: 'type', value: 'uniform' });
    form = F.reduce(form, { type: 'setPdField', name: 'radius', field: 'npts', value: '-3' });
    const { rows, html, tags } = tableOf(form);
    assert.equal(fieldOf(tags, 'radius', 'pd.nsigmas').attrs.disabled, true);
    const pd = rows.find((r) => r.name === 'radius').pd;
    assert.ok(pd.errors.npts);
    const npts = fieldOf(tags, 'radius', 'pd.npts');
    assert.equal(npts.attrs['aria-invalid'], 'true');
    assert.equal(npts.attrs['aria-describedby'], H.paramErrorId('radius', 'pd.npts'));
    assert.ok(html.includes('id="' + H.paramErrorId('radius', 'pd.npts') + '">' + esc(pd.errors.npts) + '</p>'));
    assert.equal(fieldOf(tags, 'radius', 'pd.width').attrs['aria-invalid'], undefined);
});

test('paramTableHtml: the error column is empty without a matching result', () => {
    const form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    const cells = (ctx) => tableOf(form, ctx).html.match(/<(?:td|span) class="sf-param-pm"[^>]*>[^<]*/g).map((s) => s.replace(/<[^>]*>/, ''));
    const n = F.rows(form).length + 1;
    assert.deepEqual(cells(undefined), Array(n).fill(''));
    assert.deepEqual(cells({ fitResult: null, matches: false }), Array(n).fill(''));
    assert.deepEqual(cells({ fitResult: fitResult(), matches: false }), Array(n).fill(''));
    assert.deepEqual(cells({ fitResult: fitResult({ status: 'stopped' }), matches: true }), Array(n).fill(''));
});

test('paramTableHtml: the error column shows the errors the page displays, per parameter (spec 5.7 items 5 and 8)', () => {
    const form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    const cellOf = (html, id) => new RegExp('id="' + id + '">([^<]*)<').exec(html)[1];
    const plain = tableOf(form, { fitResult: fitResult(), matches: true }).html;
    assert.equal(cellOf(plain, 'sfPm_scale'), '± 0.012');
    assert.equal(cellOf(plain, 'sfPm_radius'), '± 0.50');
    assert.equal(cellOf(plain, 'sfPm_radius_pd'), '± 0.010');
    assert.equal(cellOf(plain, 'sfPm_thickness'), '', 'a fixed parameter has no error');
    assert.equal(cellOf(plain, 'sfPm_background'), '');

    const scaled = tableOf(form, { fitResult: fitResult({ displayErrorsScaled: true }), matches: true }).html;
    assert.equal(cellOf(scaled, 'sfPm_scale'), '± 0.025');
    assert.equal(cellOf(scaled, 'sfPm_radius'), '± 1.0');

    const special = fitResult({ atBound: { radius: 'upper' }, errors: { scale: NaN, radius: 0.5, radius_pd: 0 } });
    const html = tableOf(form, { fitResult: special, matches: true }).html;
    assert.equal(cellOf(html, 'sfPm_radius'), Hints.AT_BOUND_ERROR_TEXT);
    assert.equal(cellOf(html, 'sfPm_radius'), '貼邊界，誤差無意義');
    assert.equal(cellOf(html, 'sfPm_scale'), '無法計算');
    assert.equal(cellOf(html, 'sfPm_radius_pd'), '無法計算');
});

test('paramTableHtml: locked disables every control of the table', () => {
    const form = F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    const { tags } = tableOf(form, { fitResult: null, matches: false, locked: true });
    const controls = tags.filter((t) => !t.closing && ['input', 'select', 'button'].includes(t.name));
    assert.ok(controls.length > 20);
    assert.ok(controls.every((t) => t.attrs.disabled === true));
    assert.ok(tableOf(form).tags.some((t) => t.name === 'input' && t.attrs.disabled === undefined));
});

test('paramTableHtml: every model of the page renders, ids are unique and in the sf namespace', () => {
    Meta.order.filter((name) => !Meta.models[name].isStructureFactor).forEach((model) => {
        let form = F.create(model);
        F.rows(form).filter((r) => r.pd !== null).forEach((r) => { form = F.reduce(form, { type: 'togglePd', name: r.name }); });
        if (F.canTakeStructure(model)) form = F.reduce(form, { type: 'setStructure', structure: 'hayter_msa' });
        form = F.reduce(form, { type: 'setLowQ', on: true });
        const { tags } = tableOf(form, { fitResult: null, matches: false });
        const ids = idsOf(tags);
        assert.equal(new Set(ids).size, ids.length, model + ': duplicate ids');
        ids.forEach((id) => assert.match(id, ID_RE, model));
    });
});

// ------------------------------------------------------------------ weighting

test('weightingOptionsHtml: four options with the points each weighting leaves out (spec 5.7 item 11)', () => {
    const html = H.weightingOptionsHtml({ sigma: 3, sqrtI: 1, absI: 1, none: 0 }, true, 'sqrtI');
    checkMarkup(html, 'weighting');
    const options = html.match(/<option[^>]*>[^<]*<\/option>/g);
    assert.deepEqual(options, [
        '<option value="sigma">資料 σ（排除 3 點）</option>',
        '<option value="sqrtI" selected>√|I|（排除 1 點）</option>',
        '<option value="absI">|I|（排除 1 點）</option>',
        '<option value="none">不加權（排除 0 點）</option>',
    ]);
});

test('weightingOptionsHtml: without a usable sigma the sigma option is disabled; without data no counts', () => {
    const noSigma = H.weightingOptionsHtml({ sigma: null, sqrtI: 0, absI: 0, none: 0 }, false, 'none');
    assert.ok(noSigma.includes('<option value="sigma" disabled>資料 σ（此檔沒有可用的誤差）</option>'));
    assert.ok(noSigma.includes('<option value="none" selected>不加權（排除 0 點）</option>'));
    const empty = H.weightingOptionsHtml(null, true, 'sigma');
    assert.deepEqual(empty.match(/>[^<]+</g), ['>資料 σ<', '>√|I|<', '>|I|<', '>不加權<']);
    assert.equal(count(empty, ' selected'), 1);
    assert.equal(count(H.weightingOptionsHtml(null, true, 'bogus'), ' selected'), 0);
    const all = H.weightingOptionsHtml({ sigma: 12, sqrtI: 0, absI: 0, none: 0 }, false, 'none');
    assert.ok(all.includes('<option value="sigma" disabled>'), 'a sigma column without any usable value');
});

// ------------------------------------------------------------------ results

const tileLabels = (html) => (html.match(/<div class="tile-label">[^<]*/g) || []).map((s) => s.replace(/<[^>]*>/, ''));

test('resultsHtml: one hero tile for chi2r with the status, one regular tile per fitted parameter', () => {
    const r = fitResult();
    const html = H.resultsHtml(r, { matches: true, fileName: 'a.dat' });
    checkMarkup(html, 'results');
    assert.equal(count(html, 'tile--hero'), 1);
    assert.deepEqual(tileLabels(html), ['χ²ᵣ', 'scale', 'radius', 'radius 的 PD 寬度']);
    assert.equal(html.match(/<div class="tile(?: tile--hero)?">/g).length, 4, 'fixed parameters have no tile');
    assert.equal(count(html, '<div class="tiles">'), 1);
    const hero = ResultTiles.tile({ label: 'χ²ᵣ', value: '1.10', hero: true, chip: { tone: 'ok', text: '已收斂' },
        sub: '自由度 97・100 點・12 次迭代' });
    assert.ok(html.includes(hero), html);
    assert.ok(html.includes(ResultTiles.tile({ label: 'scale', value: '1.234', sub: '± 0.012' })) ||
        html.includes(ResultTiles.tile({ label: 'scale', value: '1.235', sub: '± 0.012' })));
    assert.ok(html.includes(ResultTiles.tile({ label: 'radius', value: '50.12', unit: 'Å', sub: '± 0.50' })));
    assert.ok(html.includes(ResultTiles.tile({ label: 'radius 的 PD 寬度', value: '0.100', sub: '± 0.010' })));
    assert.ok(html.includes('a.dat'));
    assert.ok(!/參數已修改/.test(html));
});

test('resultsHtml: the chip follows statusLabel and is never ok while chi2r gives reason for doubt (spec 5.7 item 1)', () => {
    const chipOf = (r) => /<span class="tile-chip tile-chip--(\w+)">([^<]*)</.exec(H.resultsHtml(r, { matches: true, fileName: 'a' })).slice(1);
    assert.deepEqual(chipOf(fitResult()), ['ok', '已收斂']);
    assert.deepEqual(chipOf(fitResult({ chi2r: Hints.CHI2R_WARN * 2 })), ['warn', '已收斂']);
    assert.deepEqual(chipOf(fitResult({ chi2r: Hints.CHI2R_LOW / 2 })), ['warn', '已收斂']);
    assert.deepEqual(chipOf(fitResult({ status: 'maxiter' })), ['warn', '未收斂（達最大步數）']);
    assert.deepEqual(chipOf(fitResult({ status: 'failed', blockedByNonFinite: true })), ['error', '失敗']);
    [fitResult(), fitResult({ chi2r: 1e4 }), fitResult({ status: 'failed' })].forEach((r) => {
        const label = Hints.statusLabel(r);
        assert.deepEqual(chipOf(r), [label.tone, label.text]);
    });
});

test('resultsHtml: errors as the page displays them; at a bound and not computable say so', () => {
    const scaled = H.resultsHtml(fitResult({ displayErrorsScaled: true }), { matches: true, fileName: 'a' });
    assert.ok(scaled.includes(ResultTiles.tile({ label: 'radius', value: '50.1', unit: 'Å', sub: '± 1.0' })));
    const special = H.resultsHtml(fitResult({ atBound: { radius: 'lower' }, errors: { scale: NaN, radius: 0.5, radius_pd: 0.01 } }),
        { matches: true, fileName: 'a' });
    assert.ok(special.includes(ResultTiles.tile({ label: 'radius', value: '50.123', unit: 'Å', sub: Hints.AT_BOUND_ERROR_TEXT })));
    assert.ok(special.includes(ResultTiles.tile({ label: 'scale', value: '1.2345', sub: '誤差無法計算' })));
});

test('resultsHtml: units come from the model and the structure factor of the result', () => {
    const r = fitResult({
        params: { scale: 1, background: 0, sld: 9.4, radius: 50, charge: 19, temperature: 318, volfraction: 0.2, lowq_scale: 1 },
        names: ['sld', 'charge', 'temperature', 'volfraction', 'lowq_scale'],
        errors: { sld: 0.1, charge: 1, temperature: 2, volfraction: 0.01, lowq_scale: 0.1 },
        errorsScaled: { sld: 0.1, charge: 1, temperature: 2, volfraction: 0.01, lowq_scale: 0.1 },
        settings: { ...fitResult().settings, modelSpec: { model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: true } },
    });
    const html = H.resultsHtml(r, { matches: true, fileName: 'a' });
    const units = html.match(/<div class="tile-label">[^<]*<\/div><div class="tile-value">[^<]*(?:<span class="tile-unit">[^<]*)?/g)
        .map((s) => [/tile-label">([^<]*)/.exec(s)[1], (/tile-unit">([^<]*)/.exec(s) || [null, ''])[1]]);
    assert.deepEqual(units, [['χ²ᵣ', ''], ['sld', '10⁻⁶ Å⁻²'], ['charge', 'e'], ['temperature', 'K'], ['volfraction', ''], ['lowq_scale', '']]);
});

test('resultsHtml: a result the form no longer matches is announced above the tiles', () => {
    const html = H.resultsHtml(fitResult(), { matches: false, fileName: 'a.dat' });
    checkMarkup(html, 'stale');
    assert.ok(html.indexOf('參數已修改，下列為上次擬合的結果') >= 0);
    assert.ok(html.indexOf('參數已修改，下列為上次擬合的結果') < html.indexOf('class="tiles"'));
    assert.equal(count(html, 'tile--hero'), 1);
    assert.ok(html.includes('± 0.50'), 'the tiles still show the last fit');
});

test('resultsHtml: stopped has no tiles, a chi2r that is not finite shows a dash, no result is an empty string', () => {
    const stopped = H.resultsHtml(fitResult({ status: 'stopped', iterations: 7 }), { matches: false, fileName: 'a' });
    checkMarkup(stopped, 'stopped');
    assert.ok(stopped.includes('已停止（第 7 步），參數未變更'));
    assert.ok(!/class="tile/.test(stopped));
    const blocked = H.resultsHtml(fitResult({ status: 'failed', blockedByNonFinite: true, chi2r: NaN, chi2: NaN }), { matches: true, fileName: 'a' });
    assert.ok(blocked.includes('<div class="tile-value">—</div>'));
    assert.equal(count(blocked, 'tile--hero'), 1);
    assert.equal(H.resultsHtml(null, { matches: false, fileName: 'a' }), '');
    assert.equal(H.resultsHtml(undefined), '');
});

// ------------------------------------------------------------------ hints and chips

test('hintsHtml: one compact alert per hint, the class follows the tone, an action becomes a button', () => {
    const hints = [
        { id: 'blocked', tone: 'error', text: '錯誤' },
        { id: 'maxiter', tone: 'warn', text: '未收斂', action: 'continue' },
        { id: 'scaled-errors', tone: 'ok', text: '已乘' },
    ];
    const html = H.hintsHtml(hints);
    const tags = checkMarkup(html, 'hints');
    const alerts = tags.filter((t) => !t.closing && /\balert\b/.test(t.attrs.class || ''));
    assert.deepEqual(alerts.map((t) => [t.attrs.class, t.attrs['data-hint']]), [
        ['alert alert--compact alert-error', 'blocked'],
        ['alert alert--compact alert-warning', 'maxiter'],
        ['alert alert--compact alert-info', 'scaled-errors'],
    ]);
    const buttons = tags.filter((t) => !t.closing && t.name === 'button');
    assert.deepEqual(buttons.map((t) => [t.attrs.type, t.attrs['data-action']]), [['button', 'continue']]);
    assert.ok(html.includes('>從目前的值繼續擬合</button>'));
    assert.equal(H.hintsHtml([]), '');
    assert.throws(() => H.hintsHtml([{ id: 'x', tone: 'loud', text: 't' }]), /tone/);
    assert.throws(() => H.hintsHtml([{ id: 'x', tone: 'ok', text: 't', action: 'explode' }]), /action/);
});

test('hintsHtml renders every hint SasFitHints can produce', () => {
    const r = fitResult({ status: 'maxiter', atBound: { radius: 'upper' }, illConditioned: true, displayErrorsScaled: true,
        nonFiniteCurvePoints: 3, correlation: [[1, 0.995, 0], [0.995, 1, 0], [0, 0, 1]] });
    const hints = Hints.fitHints(r);
    assert.ok(hints.length >= 5);
    const html = H.hintsHtml(hints);
    checkMarkup(html, 'fitHints');
    hints.forEach((h) => assert.ok(html.includes(esc(h.text)), h.id));
    assert.equal(count(html, 'data-action="continue"'), 1);
});

test('statusChipHtml: a chip in the tone of the label', () => {
    assert.equal(H.statusChipHtml({ text: '已收斂', tone: 'ok' }), '<span class="tile-chip tile-chip--ok">已收斂</span>');
    assert.equal(H.statusChipHtml(Hints.statusLabel(null)), '<span class="tile-chip tile-chip--warn">未擬合</span>');
    assert.throws(() => H.statusChipHtml({ text: 'x', tone: 'blue' }), /tone/);
});

// ------------------------------------------------------------------ SLD panel

const sldView = (overrides) => ({ target: 'sld_solvent', formula: 'H2O', density: '0.9982', presetId: '',
    result: Sld.compute('H2O', 0.9982), error: null, ...overrides });

test('sldPanelHtml: labelled formula, density and preset inputs, apply and cancel', () => {
    const html = H.sldPanelHtml(sldView());
    const tags = checkMarkup(html, 'sld');
    const controls = tags.filter((t) => !t.closing && ['input', 'select'].includes(t.name));
    assert.deepEqual(controls.map((t) => t.attrs.id), ['sfSldPreset', 'sfSldFormula', 'sfSldDensity']);
    const labels = tags.filter((t) => !t.closing && t.name === 'label').map((t) => t.attrs.for);
    assert.deepEqual(labels, ['sfSldPreset', 'sfSldFormula', 'sfSldDensity']);
    assert.equal(tags.find((t) => t.attrs.id === 'sfSldFormula').attrs.value, 'H2O');
    assert.equal(tags.find((t) => t.attrs.id === 'sfSldDensity').attrs.value, '0.9982');
    assert.equal(tags.find((t) => t.attrs.id === 'sfSldFormula').attrs.maxlength, String(Sld.MAX_FORMULA_LENGTH));
    const options = html.slice(html.indexOf('<select'), html.indexOf('</select>')).match(/<option[^>]*>[^<]*/g);
    assert.equal(options.length, 9);
    assert.equal(options[0], '<option value="" selected>自訂');
    assert.deepEqual(options.slice(1).map((o) => /value="([^"]*)"/.exec(o)[1]), Sld.PRESETS.map((p) => p.id));
    Sld.PRESETS.forEach((p) => assert.ok(html.includes('>' + esc(p.label)), p.id));
    const apply = tags.find((t) => t.attrs.id === 'sfSldApply');
    const cancel = tags.find((t) => t.attrs.id === 'sfSldCancel');
    assert.deepEqual([apply.name, apply.attrs.type, apply.attrs.disabled], ['button', 'button', undefined]);
    assert.deepEqual([cancel.name, cancel.attrs.type, cancel.attrs.disabled], ['button', 'button', undefined]);
    assert.ok(html.includes('>套用</button>') && html.includes('>取消</button>'));
    assert.ok(tags.some((t) => t.attrs['data-target'] === 'sld_solvent'));
    assert.ok(html.includes('sld_solvent'));
    assert.ok(/f ≈ Z/.test(html) && /吸收邊/.test(html));
    assert.ok(html.includes('句點是小數點；水合物請寫成 CuSO4·5H2O 或 CuSO4(H2O)5'));
    const output = tags.find((t) => t.attrs.id === 'sfSldOutput');
    assert.equal(output.attrs['aria-live'], 'polite');
    assert.ok(html.includes('id="sfSldOutput" aria-live="polite">' + H.sldOutputHtml(sldView()) + '</div>'));
});

test('sldOutputHtml: the parsed composition, the SLD and the electron density', () => {
    const view = sldView({ formula: 'CuSO4·5H2O', density: '2.286', result: Sld.compute('CuSO4·5H2O', 2.286) });
    const html = H.sldOutputHtml(view);
    checkMarkup(html, 'sldOutput');
    assert.ok(html.includes(Sld.compositionText(view.result.atoms)));
    assert.ok(html.includes('Cu 1、S 1、O 9、H 10'));
    assert.ok(html.includes(H.formatNumber(view.result.sld, 6)) && html.includes('10⁻⁶ Å⁻²'));
    assert.ok(html.includes(H.formatNumber(view.result.electronDensity, 4)) && html.includes('e/Å³'));
    assert.ok(/class="result-list"/.test(html));
    const water = H.sldOutputHtml(sldView());
    assert.ok(/9\.4\d{4}</.test(water), 'water is about 9.4e-6 per square angstrom: ' + water);
    assert.ok(!/出處/.test(water), 'a custom formula has no source');
});

test('sldOutputHtml: a preset also shows its own formula, density and source', () => {
    Sld.PRESETS.forEach((p) => {
        const html = H.sldPanelHtml(sldView({ formula: p.formula, density: String(p.density), presetId: p.id,
            result: Sld.compute(p.formula, p.density) }));
        checkMarkup(html, p.id);
        assert.ok(html.includes('<option value="' + p.id + '" selected>'), p.id);
        assert.equal(count(html, ' selected'), 1);
        assert.ok(html.includes(esc(p.source)), p.id + ' source');
        assert.ok(html.includes(p.density + ' g/cm³'), p.id + ' density');
        assert.ok(count(html, esc(p.formula)) >= 2, p.id + ' formula in the field and in the preset note');
    });
    assert.ok(!/出處/.test(H.sldPanelHtml(sldView({ presetId: 'no-such-preset' }))));
    assert.ok(H.sldPanelHtml(sldView({ presetId: 'no-such-preset' })).includes('<option value="" selected>'));
});

test('sldPanelHtml: an error is shown, marks its field and disables apply', () => {
    let error;
    try { Sld.compute('H2Xx', 1); } catch (e) { error = e; }
    const html = H.sldPanelHtml(sldView({ formula: 'H2Xx', result: null, error }));
    const tags = checkMarkup(html, 'sldError');
    assert.ok(html.includes('<p class="sf-field-error" id="sfSldError">' + esc(error.message) + '</p>'));
    assert.equal(tags.find((t) => t.attrs.id === 'sfSldFormula').attrs['aria-invalid'], 'true');
    assert.equal(tags.find((t) => t.attrs.id === 'sfSldDensity').attrs['aria-invalid'], undefined);
    assert.ok(/sfSldError/.test(tags.find((t) => t.attrs.id === 'sfSldFormula').attrs['aria-describedby']));
    assert.equal(tags.find((t) => t.attrs.id === 'sfSldApply').attrs.disabled, true);
    assert.ok(!/result-list/.test(html));

    let densityError;
    try { Sld.compute('H2O', -1); } catch (e) { densityError = e; }
    const d = checkMarkup(H.sldPanelHtml(sldView({ density: '-1', result: null, error: densityError })), 'density');
    assert.equal(d.find((t) => t.attrs.id === 'sfSldDensity').attrs['aria-invalid'], 'true');
    assert.equal(d.find((t) => t.attrs.id === 'sfSldFormula').attrs['aria-invalid'], undefined);

    const text = H.sldPanelHtml(sldView({ result: null, error: '純文字的錯誤' }));
    assert.ok(text.includes('>純文字的錯誤</p>'));
    const empty = checkMarkup(H.sldPanelHtml(sldView({ formula: '', density: '', result: null })), 'empty');
    assert.equal(empty.find((t) => t.attrs.id === 'sfSldApply').attrs.disabled, true, 'nothing to apply yet');
    assert.ok(H.sldPanelHtml(sldView({ formula: '', result: null })).includes('<p class="sf-field-error" id="sfSldError" hidden></p>'));
});

// ------------------------------------------------------------------ model info

test('modelInfoHtml: the title, a link to the SasView documentation and the acknowledgement; nothing else from the meta', () => {
    Meta.order.forEach((name) => {
        const html = H.modelInfoHtml(Meta.models[name]);
        const tags = checkMarkup(html, name);
        assert.ok(html.includes(esc(Meta.models[name].title)), name);
        const links = tags.filter((t) => !t.closing && t.name === 'a');
        assert.equal(links.length, 1);
        assert.deepEqual(links[0].attrs, { href: 'https://www.sasview.org/docs/user/models/' + name + '.html',
            target: '_blank', rel: 'noopener' });
    });
    const html = H.modelInfoHtml(Meta.models.sphere);
    assert.ok(html.includes('模型計算核心：SasView sasmodels 1.0.12（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly'));
    assert.ok(!html.includes(Meta.models.sphere.params[0].description));
});

test('modelInfoHtml: a name that is not a model of the meta throws, so the link can only point at a known page', () => {
    ['../../evil', 'javascript:alert(1)', 'toString', '__proto__', '', undefined].forEach((name) => {
        assert.throws(() => H.modelInfoHtml({ name, title: 't' }), /Unknown model/, String(name));
    });
    assert.throws(() => H.modelInfoHtml(null), /Unknown model/);
});

// ------------------------------------------------------------------ ids and accessibility

function pageHtml() {
    const files = [
        fileRow({ id: 'd1', index: 0, fileName: 'a.dat', active: true }),
        fileRow({ id: 'd2', index: 1, fileName: 'a.dat' }),                   // the same name twice
        fileRow({ id: 'd3', index: 2, fileName: 'bad.txt', hasData: false, issues: [{ line: 1, message: 'x' }] }),
        fileRow({ id: 'd10', index: 9, fileName: 'c.dat' }),
    ];
    let form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    form = F.reduce(form, { type: 'togglePd', name: 'thickness' });
    form = F.reduce(form, { type: 'setStructure', structure: 'hayter_msa' });
    form = F.reduce(form, { type: 'setValue', name: 'radius', value: '' });
    const r = fitResult({ status: 'maxiter' });
    return [
        H.fileRowsHtml(files), H.paramTableHeadHtml({ fitResult: r, matches: true }),
        H.paramTableHtml(F.rows(form), { fitResult: r, matches: true }), H.sldPanelHtml(sldView()),
        H.weightingOptionsHtml({ sigma: 0, sqrtI: 0, absI: 0, none: 0 }, true, 'sigma'),
        H.resultsHtml(r, { matches: true, fileName: 'a.dat' }), H.hintsHtml(Hints.fitHints(r)),
        H.modelInfoHtml(Meta.models.core_shell_sphere),
    ].join('');
}

test('ids are unique across every builder for one page state, deterministic, and in the sf namespace', () => {
    const html = pageHtml();
    const tags = checkMarkup(html, 'page');
    const ids = idsOf(tags);
    assert.ok(ids.length > 60);
    assert.equal(new Set(ids).size, ids.length, 'duplicate: ' + ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
    ids.forEach((id) => assert.match(id, ID_RE));
    assert.equal(pageHtml(), html, 'the same state gives the same string');
    ['aria-describedby', 'aria-controls', 'aria-labelledby', 'for'].forEach((attr) => {
        tags.filter((t) => !t.closing && t.attrs[attr] !== undefined).forEach((t) => {
            t.attrs[attr].split(/\s+/).forEach((ref) => assert.ok(ids.includes(ref), attr + ' -> ' + ref));
        });
    });
    ['d1', 'd2', 'd10'].forEach((id) => ['show', 'active', 'condition', 'remove'].forEach((action) => {
        assert.ok(ids.includes(H.fileControlId(id, action)), id + ' ' + action);
    }));
});

test('every input, select and button has an accessible name; no positive tabindex, no colour, no handler', () => {
    const html = pageHtml();
    const tags = checkMarkup(html, 'page');
    const labelled = new Set(tags.filter((t) => t.name === 'label' && t.attrs.for).map((t) => t.attrs.for));
    tags.filter((t) => !t.closing && ['input', 'select'].includes(t.name)).forEach((t) => {
        assert.ok(t.attrs['aria-label'] || labelled.has(t.attrs.id), 'no name: ' + JSON.stringify(t.attrs));
        assert.ok(t.attrs.id, 'no id: ' + JSON.stringify(t.attrs));
    });
    (html.match(/<button[^>]*>[^<]*<\/button>/g) || []).forEach((b) => {
        assert.ok(/>[^<\s][^<]*<\/button>/.test(b), 'a button without text: ' + b);
        assert.ok(/ type="button"/.test(b), b);
    });
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(html), 'no colour literal');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), 'no emoji or pictograph');
    tags.filter((t) => !t.closing && t.name === 'th').forEach((t) => assert.ok(['col', 'row'].includes(t.attrs.scope)));
});

// ------------------------------------------------------------------ the XSS matrix

const PAYLOADS = Object.freeze([
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "'",
    '&',
    '" onmouseover="alert(1)" x="',
    "' onfocus='alert(1)' autofocus='",
    '</td></tr></table><svg onload=alert(1)>',
]);

/** Every string input of every builder set to the payload: [label, () => html, the payload must appear escaped]. */
function matrix(p) {
    const row = { name: 'radius', label: p, unit: p, group: p, value: p, lower: p, upper: p, hardMin: 0, hardMax: null, fit: true,
        fittable: true, derived: false, note: p, isSld: true,
        pd: { open: true, fit: true, width: p, lower: p, upper: p, type: p, npts: p, nsigmas: p, hasNsigmas: true,
            errors: { width: p, lower: p, upper: p, npts: p, nsigmas: p } },
        errors: { value: p, lower: p, upper: p } };
    const evil = fitResult({ names: [p, 'radius'], params: { [p]: p, radius: p }, errors: { [p]: p, radius: p },
        errorsScaled: { [p]: p, radius: p }, atBound: { [p]: p }, chi2r: p, dof: p, iterations: p,
        settings: { ...fitResult().settings, modelSpec: { model: p, structure: p, lowQPowerLaw: false } } });
    const stopped = fitResult({ status: 'stopped', iterations: p });
    return [
        ['fileRowsHtml', () => H.fileRowsHtml([
            fileRow({ id: p, index: p, fileName: p, condition: p, statusText: p, issues: [{ line: p, message: p }], issueOverflow: p }),
            fileRow({ id: p + '2', fileName: p, hasData: false, statusText: p, issues: [{ line: 3, message: p }] })]), true],
        ['paramTableHeadHtml', () => H.paramTableHeadHtml({ fitResult: fitResult({ displayErrorsScaled: true, chi2r: p }), matches: true }), false],
        ['paramTableHtml', () => H.paramTableHtml([row, { ...row, name: p, pd: { ...row.pd, hasNsigmas: false } },
            { ...row, name: 'x', derived: true, fittable: false, pd: null }], { fitResult: evil, matches: true }), true],
        ['sldPanelHtml', () => H.sldPanelHtml({ target: p, formula: p, density: p, presetId: p,
            result: { sld: p, electronDensity: p, molarMass: p, electrons: p, atoms: { [p]: 1, H: p } }, error: null }), true],
        ['sldPanelHtml (error)', () => H.sldPanelHtml({ target: p, formula: p, density: p, presetId: p, result: null,
            error: Object.assign(new Error(p), { code: p, position: p }) }), true],
        ['sldOutputHtml', () => H.sldOutputHtml({ target: p, formula: p, density: p, presetId: 'water', result: null, error: p }), true],
        ['weightingOptionsHtml', () => H.weightingOptionsHtml({ sigma: p, sqrtI: p, absI: p, none: p }, p, p), false],
        ['resultsHtml', () => H.resultsHtml(evil, { matches: p, fileName: p }), true],
        ['resultsHtml (stopped)', () => H.resultsHtml(stopped, { matches: false, fileName: p }), false],
        ['hintsHtml', () => H.hintsHtml([{ id: p, tone: 'warn', text: p, action: 'continue' }, { id: p, tone: 'error', text: p }]), true],
        ['statusChipHtml', () => H.statusChipHtml({ text: p, tone: 'ok' }), true],
        ['modelInfoHtml', () => H.modelInfoHtml({ ...Meta.models.sphere, title: p, category: p }), true],
    ];
}

test('XSS matrix: every builder escapes every payload in every string input', () => {
    let cells = 0;
    PAYLOADS.forEach((p) => {
        matrix(p).forEach(([label, build, appears]) => {
            const html = build();
            const where = label + ' with ' + JSON.stringify(p);
            const tags = checkMarkup(html, where);
            assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<svg'), where);
            if (/[<>"']/.test(p)) assert.ok(!html.includes(p), where + ': the raw payload is in the output');
            if (appears) assert.ok(html.includes(esc(p)), where + ': the payload never reached the output, the cell proves nothing');
            tags.forEach((t) => Object.keys(t.attrs).forEach((a) => {
                assert.ok(!/^(?:on\w+|style|src|srcdoc|formaction|autofocus|x)$/.test(a), where + ': attribute ' + a);
            }));
            tags.filter((t) => t.attrs.href !== undefined).forEach((t) => assert.match(t.attrs.href, /^https:\/\/www\.sasview\.org\/docs\/user\/models\/\w+\.html$/));
            const ids = idsOf(tags);
            ids.forEach((id) => assert.match(id, ID_RE, where));
            cells += 1;
        });
    });
    assert.equal(cells, PAYLOADS.length * 12);
});

test('XSS matrix: text-only inputs come out as text, attribute values stay inside their quotes', () => {
    const p = '" onmouseover="alert(1)" x="';
    const html = H.fileRowsHtml([fileRow({ fileName: p })]);
    const tags = checkMarkup(html, 'attr');
    const show = byAttr(tags, 'data-action', 'show')[0];
    assert.equal(show.attrs['aria-label'], '顯示 &quot; onmouseover=&quot;alert(1)&quot; x=&quot;');
    assert.deepEqual(Object.keys(show.attrs).sort(), ['aria-label', 'checked', 'data-action', 'data-id', 'id', 'type']);
    assert.ok(textOf(html).includes('&quot; onmouseover=&quot;alert(1)&quot; x=&quot;'));
    assert.ok(H.fileRowsHtml([fileRow({ fileName: "a'b&c" })]).includes('a&#39;b&amp;c'));
});

test('XSS matrix: values that select a class, an id or a link are whitelisted or encoded, never interpolated', () => {
    const p = '"><script>alert(1)</script>';
    assert.throws(() => H.hintsHtml([{ id: 'x', tone: p, text: 't' }]), /tone/);
    assert.throws(() => H.hintsHtml([{ id: 'x', tone: 'ok', text: 't', action: p }]), /action/);
    assert.throws(() => H.statusChipHtml({ text: 't', tone: p }), /tone/);
    assert.throws(() => H.modelInfoHtml({ name: p, title: 't' }), /Unknown model/);
    assert.match(H.paramFieldId(p, 'value'), ID_RE);
    assert.match(H.paramErrorId(p, 'pd.width'), ID_RE);
    assert.match(H.fileControlId(p, 'remove'), ID_RE);
    assert.notEqual(H.paramFieldId('a<', 'value'), H.paramFieldId('a>', 'value'));
    assert.throws(() => H.paramFieldId('radius', p), /field/);
    assert.throws(() => H.fileControlId('d1', p), /action/);
    // numbers are formatted by the module; a string in a numeric slot never reaches the output
    const html = H.resultsHtml(fitResult({ chi2r: p, dof: p, iterations: p }), { matches: true, fileName: 'a' });
    assert.ok(!html.includes('script'));
    assert.ok(html.includes('<div class="tile-value">—</div>'));
});

test('builders do not modify what they are given', () => {
    const form = F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    const rows = F.rows(form);
    const r = fitResult();
    const before = JSON.stringify([rows, r, Sld.PRESETS]);
    const view = Object.freeze(sldView());
    const hints = Hints.fitHints(fitResult({ status: 'maxiter' }));
    H.paramTableHtml(rows, Object.freeze({ fitResult: r, matches: true }));
    H.resultsHtml(r, Object.freeze({ matches: true, fileName: 'a' }));
    H.sldPanelHtml(view);
    H.hintsHtml(hints);
    H.fileRowsHtml(Object.freeze([fileRow({ issues: Object.freeze([Object.freeze({ line: 1, message: 'x' })]) })]));
    assert.equal(JSON.stringify([rows, r, Sld.PRESETS]), before);
});

// ------------------------------------------------------------------ additions for the model segment (plan M3 Task 12)

test('modelOptionsHtml: one optgroup per group, the 13 models, exactly the selected one marked', () => {
    const html = H.modelOptionsHtml(F.models(''), 'cylinder');
    const tags = checkMarkup(html, 'modelOptionsHtml');
    const groups = tags.filter((t) => t.name === 'optgroup' && !t.closing);
    assert.deepEqual(groups.map((t) => t.attrs.label), ['形狀', '與形狀無關']);
    const options = tags.filter((t) => t.name === 'option' && !t.closing);
    assert.equal(options.length, 13);
    assert.deepEqual(options.filter((t) => t.attrs.selected === true).map((t) => t.attrs.value), ['cylinder']);
    assert.equal(H.modelOptionsHtml([], 'sphere'), '');
    assert.equal(H.modelOptionsHtml(undefined, 'sphere'), '');
});

test('modelOptionsHtml and optionsHtml escape labels and values', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const groups = [{ group: evil, items: [{ name: evil, title: evil }] }];
    for (const html of [H.modelOptionsHtml(groups, evil), H.optionsHtml([{ value: evil, label: evil }], evil)]) {
        checkMarkup(html, 'options');
        assert.equal(html.includes('<img'), false);
        assert.ok(html.includes(esc(evil)));
    }
});

test('optionsHtml: values are compared as text, so a numeric mode selects its option', () => {
    const html = H.optionsHtml([{ value: 0, label: 'unconstrained' }, { value: 1, label: 'radius' }], 1);
    const options = checkMarkup(html, 'optionsHtml').filter((t) => t.name === 'option' && !t.closing);
    assert.deepEqual(options.map((t) => [t.attrs.value, t.attrs.selected === true]), [['0', false], ['1', true]]);
    assert.equal(H.optionsHtml(null, 0), '');
});

test('paramErrorCells: the same ids and texts as the error cells of paramTableHtml', () => {
    let form = F.create('core_shell_sphere');
    form = F.reduce(form, { type: 'togglePd', name: 'radius' });
    const rows = F.rows(form);
    const result = fitResult({ atBound: { scale: 'lower' } });
    for (const ctx of [{ fitResult: result, matches: true }, { fitResult: result, matches: false }, { fitResult: null, matches: false }]) {
        const cells = H.paramErrorCells(rows, ctx);
        const html = H.paramTableHtml(rows, ctx);
        assert.equal(cells.length, rows.length + 1, 'one per row and one for the open dispersity');
        for (const cell of cells) {
            const m = new RegExp('id="' + cell.id + '">([^<]*)<').exec(html);
            assert.ok(m, cell.id + ' is in the table');
            assert.equal(m[1], esc(cell.text), cell.id);
        }
    }
    const shown = Object.fromEntries(H.paramErrorCells(rows, { fitResult: result, matches: true }).map((c) => [c.id, c.text]));
    assert.equal(shown.sfPm_radius, '± 0.50');
    assert.equal(shown.sfPm_radius_pd, '± 0.010');
    assert.equal(shown.sfPm_scale, Hints.AT_BOUND_ERROR_TEXT);
    assert.equal(shown.sfPm_thickness, '', 'not fitted: empty');
    assert.ok(H.paramErrorCells(rows, { fitResult: result, matches: false }).every((c) => c.text === ''));
    assert.ok(Object.isFrozen(H.paramErrorCells(rows, null)));
});

test('sldOutputHtml: a result without an SLD (formula typed, no density yet) shows only the composition', () => {
    const partial = { atoms: Sld.parseFormula('H2O').atoms, sld: NaN, electronDensity: NaN };
    const html = H.sldOutputHtml({ target: 'sld', formula: 'H2O', density: '', presetId: '', result: partial, error: null });
    checkMarkup(html, 'sldOutputHtml partial');
    assert.ok(textOf(html).includes('元素組成 H 2、O 1'));
    assert.equal(textOf(html).includes('SLD'), false);
    assert.equal(textOf(html).includes('電子密度'), false);
    assert.equal(html.includes(H.MISSING), false, 'no dash with a unit behind it');
});
