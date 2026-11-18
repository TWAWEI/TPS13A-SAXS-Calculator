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
const {
    esc, count, ID_RE, TAG_RE, ATTR_RE, ALLOWED_TAGS, ALLOWED_ATTRS, checkMarkup, openTags, byAttr, idsOf, textOf, fitResult, fileRow, tableOf, fieldOf, tileLabels, sldView,
} = require('./sasfit-html-helpers.js');


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
    ['K', 'M', 'furlongs'].forEach((u) => assert.equal(H.unitText(u), u));
    assert.equal(H.unitText('e'), 'e（基本電荷）', 'a bare e after a number reads like an exponent');
    const seen = new Set();
    Object.values(Meta.models).forEach((m) => m.params.forEach((p) => seen.add(p.units)));
    assert.deepEqual([...seen].sort(), ['', '1/Ang', '1/cm', '1e-6/Ang^2', 'Ang', 'K', 'M', 'None', 'degrees', 'e'].sort());
    seen.forEach((u) => assert.ok(!/Ang|None|degrees|\^/.test(H.unitText(u)), 'still raw: ' + u));
});

test('formatValueError and formatNumber are SasFitFormat for the screen (one rule: tests/sasfit-format.test.js)', () => {
    const Format = globalThis.SasFitFormat;
    assert.deepEqual({ ...H.formatValueError(50.1234, 0.0123) }, { value: '50.123', error: '0.012', kind: 'normal' });
    assert.deepEqual(H.formatValueError(72.7417, 5700), Format.valueError(72.7417, 5700));
    assert.deepEqual({ ...H.formatValueError(15.8, 1e8, { illConditioned: true }) }, { value: '15.8', error: '無法決定', kind: 'undeterminable' });
    assert.equal(H.formatNumber(1.1, 3), '1.10');
    assert.equal(H.formatNumber(-0.012345, 3), '−0.0123', 'U+2212 on the screen');
    assert.equal(H.formatNumber(123456, 3), '123000');
    assert.equal(H.formatNumber(1234567, 3), '1.23e6');
    assert.equal(H.formatNumber(0.00012345, 3), '1.23e−4');
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
    assert.equal(column.label, '±（已乘 √均方）');
    assert.ok(html.includes('>' + column.label + '</th>'));
    const th = openTags(html, 'th')[3];
    assert.equal(th.attrs.title, column.title);
    assert.ok(/SasView/.test(th.attrs.title) && /2\.00/.test(th.attrs.title));
    assert.equal(H.paramTableHeadHtml({ fitResult: scaled, matches: false }), plain, 'a result that does not match the form shows no errors');
});


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

test('paramTableHtml: an error that is >= the value keeps its number; ill-conditioned and far larger says so in words', () => {
    const form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    const cellOf = (html, id) => new RegExp('id="' + id + '">([^<]*)<').exec(html)[1];
    const big = { errors: { scale: 5700, radius: 1e8, radius_pd: 0.01 } };
    assert.equal(cellOf(tableOf(form, { fitResult: fitResult(big), matches: true }).html, 'sfPm_scale'), '± 5700');
    assert.equal(cellOf(tableOf(form, { fitResult: fitResult(big), matches: true }).html, 'sfPm_radius'), '± 1.0e8');
    const ill = tableOf(form, { fitResult: fitResult({ ...big, illConditioned: true }), matches: true }).html;
    assert.equal(cellOf(ill, 'sfPm_radius'), '無法決定');
    assert.equal(cellOf(ill, 'sfPm_scale'), '無法決定', '5700 > 1000 x 1.2345');
    assert.equal(cellOf(ill, 'sfPm_radius_pd'), '± 0.010');
});

test('paramTableHtml: background shows cm⁻¹ only for data on absolute scale; a derived value shows a dash', () => {
    const unitOfRow = (html, name) => {
        const row = new RegExp('<tr class="sf-param-row" data-param="' + name + '"[\\s\\S]*?</th>').exec(html)[0];
        return (/sf-param-unit">([^<]*)/.exec(row) || [null, ''])[1];
    };
    const form = F.reduce(F.create('sphere'), { type: 'setStructure', structure: 'hayter_msa' });
    const generic = tableOf(form, { fitResult: null, matches: false }).html;
    const official = tableOf(form, { fitResult: null, matches: false, absolute: true }).html;
    assert.equal(unitOfRow(generic, 'background'), '');
    assert.equal(unitOfRow(official, 'background'), 'cm⁻¹');
    assert.equal(unitOfRow(official, 'scale'), '');
    assert.equal(unitOfRow(official, 'charge'), 'e（基本電荷）');
    assert.equal(unitOfRow(official, 'dielectconst'), '', 'unit None shows nothing');
    assert.equal(fieldOf(checkMarkup(official, 't'), 'radius_effective', 'value').attrs.value, '—');
    assert.equal(fieldOf(checkMarkup(official, 't'), 'radius_effective', 'value').attrs.disabled, true);
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
