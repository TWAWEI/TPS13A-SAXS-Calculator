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

test('fileRowsHtml: one row per file with a colour sample, show, fit target, name with its status, condition and remove', () => {
    const html = H.fileRowsHtml([
        fileRow({ id: 'd1', index: 0, fileName: 'B1216_1_10.dat', active: true, condition: 10, statusText: '約化 χ² 1.10 已收斂' }),
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
    assert.ok(active.every((t) => /^設為擬合對象：/.test(t.attrs['aria-label']) && t.attrs.disabled === undefined));
    const cond = byAttr(tags, 'data-action', 'condition');
    assert.deepEqual(cond.map((t) => [t.attrs.type, t.attrs.value, t.attrs['aria-label']]),
        [['number', '10', 'B1216_1_10.dat 的條件值'], ['number', '-2.5', 'b.dat 的條件值']]);
    const remove = byAttr(tags, 'data-action', 'remove');
    assert.deepEqual(remove.map((t) => [t.name, t.attrs.type, t.attrs['aria-label']]),
        [['button', 'button', '移除 B1216_1_10.dat'], ['button', 'button', '移除 b.dat']]);
    const chips = tags.filter((t) => !t.closing && /\bchannel-chip\b/.test(t.attrs.class || ''));
    assert.deepEqual(chips.map((t) => [t.attrs['data-series'], t.attrs['aria-hidden']]), [['0', 'true'], ['1', 'true']]);
    assert.ok(/約化 χ² 1\.10 已收斂/.test(html) && /未擬合/.test(html));
    assert.equal(count(html, '<span class="sf-file-status">'), 2, 'the status is in the name cell, under the name');
    assert.equal(count(html.slice(0, html.indexOf('</tr>')), '<td'), 4, 'five columns: show, fit target, name and status, condition, remove');
    // the column of the condition has the name the user gave it
    const named = checkMarkup(H.fileRowsHtml([fileRow({ fileName: 'a.dat', conditionName: ' Temperature (K) ' })]), 'named');
    assert.equal(byAttr(named, 'data-action', 'condition')[0].attrs['aria-label'], 'a.dat 的Temperature (K)');
    assert.equal(byAttr(checkMarkup(H.fileRowsHtml([fileRow({ conditionName: '  ' })]), 'blank'), 'data-action', 'condition')[0].attrs['aria-label'], 'a.dat 的條件值');
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
    assert.equal(count(html, '<td'), 4, 'the row keeps the five columns of the table');
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

test('fileRowsHtml: the status of a fitted file is a short chip (measure, value, one word when doubtful) with the full status as title and for screen readers', () => {
    const full = '約化 χ² 711・已收斂・約化 χ² 偏大';
    const chi = H.fileRowsHtml([fileRow({ statusText: full, statusTone: 'warn', statusMeasure: { isChi2: true, label: '約化 χ²', value: '711', short: '偏大' } })]);
    checkMarkup(chi, 'status chip');
    assert.ok(chi.includes('<span class="tile-chip tile-chip--warn" title="' + full + '">'
        + '<span aria-hidden="true">χ<sup>2</sup><sub>r</sub> 711 偏大</span><span class="sr-only">' + full + '</span></span>'));
    const plain = H.fileRowsHtml([fileRow({ statusText: '約化 χ² 1.02・已收斂', statusTone: 'ok', statusMeasure: { isChi2: true, label: '約化 χ²', value: '1.02', short: '' } })]);
    assert.ok(plain.includes('<span aria-hidden="true">χ<sup>2</sup><sub>r</sub> 1.02</span>'), 'a plain converged fit needs no extra word');
    const other = H.fileRowsHtml([fileRow({ statusText: '加權殘差均方 117・已收斂', statusTone: 'ok', statusMeasure: { isChi2: false, label: '加權殘差均方', value: '117', short: '' } })]);
    assert.ok(other.includes('<span aria-hidden="true">加權殘差均方 117</span>'), 'not a chi-square without sigma weighting');
    assert.equal(/χ/.test(other.replace(/title="[^"]*"/, '')), false);
    assert.throws(() => H.fileRowsHtml([fileRow({ statusText: 'x', statusTone: 'bad', statusMeasure: { isChi2: true, value: '1', short: '' } })]), /tone/);
});

test('fileRowsHtml: a long file name loses its middle on screen; the title and every label keep all of it', () => {
    const long = '20261118_TPS13A_BSA_5mgmL_HEPES_pH7.5_150mMNaCl_run0042_frame0123-0145_avg_sub_buffer_0007.dat';
    assert.equal(H.middleEllipsis('short.dat'), 'short.dat');
    const cut = H.middleEllipsis(long);
    assert.equal(Array.from(cut).length, 44);
    assert.ok(cut.startsWith(long.slice(0, 26)) && cut.endsWith(long.slice(-17)) && cut.includes('…'));
    assert.equal(Array.from(H.middleEllipsis('長'.repeat(60))).length, 44, 'counted in characters, not in UTF-16 units');
    const tags = checkMarkup(H.fileRowsHtml([fileRow({ fileName: long })]), 'long name');
    const name = tags.find((t) => !t.closing && t.attrs.class === 'sf-file-text');
    assert.equal(name.attrs.title, long);
    assert.equal(byAttr(tags, 'data-action', 'remove')[0].attrs['aria-label'], '移除 ' + long);
    assert.equal(H.fileRowsHtml([fileRow({ fileName: long })]).includes('>' + long + '<'), false);
});

// ------------------------------------------------------------------ parameter table

const HEAD = ['擬合', '參數', '數值', '±', '範圍與多分散'];
const trs = (tags) => tags.filter((t) => t.name === 'tr' && !t.closing);
const cellOf = (html, id) => new RegExp('id="' + id + '">([^<]*)<').exec(html)[1];
const openAll = (form) => Object.fromEntries(F.rows(form).map((r) => [r.name, true]));

test('paramTableHeadHtml: five column headers with scope (the last one for screen readers); the error column says when it is multiplied', () => {
    const plain = H.paramTableHeadHtml({ fitResult: null, matches: false });
    const ths = openTags(plain, 'th');
    assert.equal(ths.length, 5);
    assert.ok(ths.every((t) => t.attrs.scope === 'col'));
    assert.deepEqual(plain.match(/<th[^>]*>.*?<\/th>/g).map((s) => s.replace(/<[^>]*>/g, '')), HEAD);
    assert.ok(plain.includes('<th scope="col"><span class="sr-only">範圍與多分散</span></th>'));
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

test('paramTableHtml: per parameter one row of five cells, a line for the message of its value and a detail row (both hidden while not needed)', () => {
    const form = F.create('sphere');
    const { rows, html, tags } = tableOf(form);
    const all = trs(tags);
    assert.equal(all.length, rows.length * 3);
    rows.forEach((row, i) => {
        const [main, error, detail] = all.slice(i * 3, i * 3 + 3);
        assert.equal(main.attrs.class, 'sf-param-row');
        assert.equal(main.attrs['data-param'], row.name);
        assert.deepEqual([error.attrs.class, error.attrs.id, error.attrs.hidden], ['sf-param-error', H.paramErrorRowId(row.name), true]);
        assert.deepEqual([detail.attrs.class, detail.attrs.id, detail.attrs.hidden], ['sf-detail-row', H.detailRowId(row.name), true]);
    });
    const firstRow = html.slice(0, html.indexOf('</tr>'));
    assert.equal(count(firstRow, '<td') + count(firstRow, '<th'), 5);
    assert.ok(html.includes('<tr class="sf-detail-row" id="sfDetail_radius" data-param="radius" hidden></tr>'), 'closed: an empty row that aria-controls can point to');
    const value = fieldOf(tags, 'radius', 'value');
    assert.deepEqual([value.attrs.type, value.attrs.inputmode, value.attrs.value, value.attrs['aria-label'], value.attrs['aria-describedby']],
        ['text', 'decimal', '50', 'radius 數值', 'sfErr_radius_value']);
    assert.equal(fieldOf(tags, 'radius', 'fit').attrs['aria-label'], '擬合 radius');
    assert.equal(fieldOf(tags, 'scale', 'fit').attrs.checked, true);
    assert.equal(fieldOf(tags, 'radius', 'lower'), undefined, 'the bounds are in the detail row');
    assert.ok(html.includes('<span class="sf-param-unit">Å</span>') && html.includes('<span class="sf-param-unit">10⁻⁶ Å⁻²</span>'));
    assert.equal(tags.filter((t) => t.name === 'th' && !t.closing).every((t) => t.attrs.scope === 'row'), true);
});

test('paramTableHtml: one disclosure button per parameter names what it opens and points at its detail row', () => {
    const { rows, tags } = tableOf(F.create('sphere'));
    const more = byAttr(tags, 'data-action', 'toggleDetail');
    assert.equal(more.length, rows.length);
    more.forEach((button, i) => {
        const name = rows[i].name;
        assert.deepEqual([button.name, button.attrs.type, button.attrs.id, button.attrs['aria-expanded'], button.attrs['aria-controls'], button.attrs['aria-label']],
            ['button', 'button', H.moreButtonId(name), 'false', H.detailRowId(name), name + ' 的範圍與多分散']);
    });
    const ids = idsOf(tags);
    more.forEach((button) => assert.ok(ids.includes(button.attrs['aria-controls'])));
    const opened = tableOf(F.create('sphere'), { fitResult: null, matches: false, details: { radius: true } });
    assert.equal(byAttr(opened.tags, 'data-param', 'radius').find((t) => t.attrs['data-action'] === 'toggleDetail').attrs['aria-expanded'], 'true');
    assert.ok(/<tr class="sf-param-row is-open" data-param="radius"/.test(opened.html));
    assert.equal(byAttr(opened.tags, 'data-param', 'scale').find((t) => t.attrs['data-action'] === 'toggleDetail').attrs['aria-expanded'], 'false');
});

test('paramTableHtml: a parameter name may wrap after an underscore only (<wbr>), and is escaped', () => {
    const form = F.reduce(F.reduce(F.create('sphere'), { type: 'setStructure', structure: 'hayter_msa' }), { type: 'setRadiusMode', mode: 0 });
    const { html } = tableOf(form);
    assert.ok(html.includes('<span class="sf-param-name">concentration_<wbr>salt</span>'));
    assert.ok(html.includes('<span class="sf-param-name">radius_<wbr>effective</span>'));
    assert.ok(html.includes('<span class="sf-param-name">scale</span>'));
    const evil = [{ ...F.rows(F.create('sphere'))[0], name: 'a_<b>', label: 'a_<b>' }];
    const out = H.paramTableHtml(evil, null);
    checkMarkup(out, 'evil name');
    assert.ok(out.includes('<span class="sf-param-name">a_<wbr>&lt;b&gt;</span>'));
});

test('paramTableHtml: an open detail row holds the bounds with visible labels; a polydisperse parameter also its switch, an SLD its formula button', () => {
    const form = F.create('sphere');
    const { html, tags } = tableOf(form, { fitResult: null, matches: false, details: openAll(form) });
    const lower = fieldOf(tags, 'radius', 'lower');
    const upper = fieldOf(tags, 'radius', 'upper');
    assert.deepEqual([lower.attrs.value, lower.attrs['aria-label'], lower.attrs.placeholder], ['0', 'radius 下限', '不限']);
    assert.deepEqual([upper.attrs.value, upper.attrs['aria-label'], upper.attrs.placeholder], ['', 'radius 上限', '不限']);
    assert.ok(html.includes('<label for="sfLower_radius">下限</label>') && html.includes('<label for="sfUpper_radius">上限</label>'));
    assert.ok(html.includes('<div class="sf-detail" role="group" aria-label="radius 的範圍與多分散">'));
    const pdToggles = byAttr(tags, 'data-action', 'togglePd');
    assert.deepEqual(pdToggles.map((t) => t.attrs['data-param']), ['radius'], 'only the polydisperse size parameter');
    assert.deepEqual([pdToggles[0].attrs.id, pdToggles[0].attrs['aria-expanded'], pdToggles[0].attrs['aria-controls'], pdToggles[0].attrs['aria-label']],
        ['sfPdToggle_radius', 'false', 'sfPdRow_radius', 'radius 的多分散']);
    assert.ok(html.includes('>多分散</button><div class="sf-pd-fields" id="sfPdRow_radius" role="group" aria-label="radius 的多分散" hidden></div>'));
    const sld = byAttr(tags, 'data-action', 'sld');
    assert.deepEqual(sld.map((t) => t.attrs['data-param']), ['sld', 'sld_solvent']);
    assert.deepEqual([sld[0].attrs.id, sld[0].attrs['aria-expanded'], sld[0].attrs['aria-controls'], sld[0].attrs['aria-label']],
        ['sfSldBtn_sld', 'false', 'sfSldSlot_sld', '以化學式計算 sld']);
    assert.ok(html.includes('<div class="sf-sld-slot" id="sfSldSlot_sld" hidden></div>'));
    const ids = idsOf(tags);
    [...pdToggles, ...sld].forEach((t) => assert.ok(ids.includes(t.attrs['aria-controls']), t.attrs.id));
});

test('paramTableHtml: the formula panel is rendered inside the detail row of its parameter (ctx.sld), and only there', () => {
    const form = F.create('sphere');
    const { html, tags } = tableOf(form, { fitResult: null, matches: false, details: { sld: true, sld_solvent: true }, sld: sldView({ target: 'sld_solvent' }) });
    const buttons = byAttr(tags, 'data-action', 'sld');
    assert.deepEqual(buttons.map((t) => t.attrs['aria-expanded']), ['false', 'true']);
    assert.ok(html.includes('<div class="sf-sld-slot" id="sfSldSlot_sld_solvent">' + H.sldPanelHtml(sldView({ target: 'sld_solvent' })) + '</div>'));
    assert.ok(html.includes('<div class="sf-sld-slot" id="sfSldSlot_sld" hidden></div>'));
    assert.equal(count(html, 'id="sfSldPreset"'), 1);
    const detail = html.slice(html.indexOf('id="sfDetail_sld_solvent"'), html.indexOf('id="sfErrRow_radius"'));
    assert.ok(detail.includes('id="sfSldApply"'), 'the panel sits in the same detail row as its trigger');
    const closed = tableOf(form, { fitResult: null, matches: false, details: {}, sld: sldView({ target: 'sld_solvent' }) }).html;
    assert.equal(closed.includes('sfSldPreset'), false, 'a closed detail row has no panel');
});

test('paramTableHtml: a row that cannot be fitted has no tick box, no detail button, shows a dash and its note', () => {
    const form = F.reduce(F.create('sphere'), { type: 'setStructure', structure: 'hardsphere' });
    const { rows, html, tags } = tableOf(form, { fitResult: null, matches: false, details: { radius_effective: true } });
    const derived = rows.filter((r) => !r.fittable);
    assert.deepEqual(derived.map((r) => r.name), ['radius_effective']);
    assert.equal(fieldOf(tags, 'radius_effective', 'fit'), undefined);
    assert.deepEqual([fieldOf(tags, 'radius_effective', 'value').attrs.disabled, fieldOf(tags, 'radius_effective', 'value').attrs.value], [true, '—']);
    assert.equal(byAttr(tags, 'data-param', 'radius_effective').some((t) => t.attrs['data-action'] === 'toggleDetail'), false);
    assert.equal(fieldOf(tags, 'radius_effective', 'lower'), undefined, 'not even when asked to open');
    assert.ok(html.includes('<span class="sf-param-note">' + derived[0].note + '</span>'));
    assert.ok(fieldOf(tags, 'volfraction', 'fit') !== undefined);
    assert.deepEqual(tags.filter((t) => /\bsf-param-row\b/.test(t.attrs.class || '')).map((t) => t.attrs['data-group']), rows.map((r) => r.group));
});

test('paramTableHtml: the message of a value is a full-width line under its row; a field with an error is invalid and describes itself by it', () => {
    let form = F.reduce(F.create('sphere'), { type: 'setValue', name: 'radius', value: 'abc' });
    form = F.reduce(form, { type: 'setLower', name: 'scale', value: 'x' });
    const { html, tags } = tableOf(form);
    const line = tags.find((t) => t.attrs.id === 'sfErrRow_radius');
    assert.equal(line.attrs.hidden, undefined, 'shown');
    assert.ok(html.includes('<tr class="sf-param-error" id="sfErrRow_radius"><td colspan="5"><p class="sf-field-error" id="sfErr_radius_value">radius 的數值必須是數字</p></td></tr>'));
    assert.deepEqual([fieldOf(tags, 'radius', 'value').attrs['aria-invalid'], fieldOf(tags, 'radius', 'value').attrs['aria-describedby']], ['true', 'sfErr_radius_value']);
    assert.equal(tags.find((t) => t.attrs.id === 'sfErrRow_scale').attrs.hidden, true);
    assert.ok(html.includes('<p class="sf-field-error" id="sfErr_scale_value" hidden></p>'), 'every value has its (empty) message element');
    // a bound with an error opens its detail row by itself, and the message is a line of its own inside it
    assert.equal(fieldOf(tags, 'scale', 'lower').attrs['aria-invalid'], 'true');
    assert.ok(html.includes('<p class="sf-field-error" id="sfErr_scale_lower">scale 的下限必須是數字（留空表示不設限）</p>'));
    assert.ok(html.includes('<p class="sf-field-error" id="sfErr_scale_upper" hidden></p>'));
    const ids = idsOf(tags);
    tags.filter((t) => !t.closing && t.attrs['aria-describedby']).forEach((t) => assert.ok(ids.includes(t.attrs['aria-describedby']), t.attrs.id));
});

test('detailOpen: a field error inside always opens the row; else the user\'s choice; else open when the shown fit left the parameter (or its width) on a bound', () => {
    const sphere = F.create('sphere');
    const row = (form, name) => F.rows(form).find((r) => r.name === name);
    assert.equal(H.detailOpen(row(sphere, 'radius'), null, {}), false);
    assert.equal(H.detailOpen(row(sphere, 'radius'), null, { radius: true }), true);
    assert.equal(H.detailOpen(row(sphere, 'radius'), null, undefined), false);
    const badBound = F.reduce(sphere, { type: 'setUpper', name: 'radius', value: 'x' });
    assert.equal(H.detailOpen(row(badBound, 'radius'), null, { radius: false }), true, 'the user cannot hide a message');
    const badValue = F.reduce(sphere, { type: 'setValue', name: 'radius', value: 'x' });
    assert.equal(H.detailOpen(row(badValue, 'radius'), null, {}), false, 'the message of a value is outside the detail row');
    let pd = F.reduce(sphere, { type: 'togglePd', name: 'radius' });
    assert.equal(H.detailOpen(row(pd, 'radius'), null, {}), false, 'a dispersity without an error does not open it');
    pd = F.reduce(pd, { type: 'setPdField', name: 'radius', field: 'npts', value: '0' });
    assert.equal(H.detailOpen(row(pd, 'radius'), null, { radius: false }), true);
    const atBound = fitResult({ atBound: { radius: 'upper' } });
    assert.equal(H.detailOpen(row(sphere, 'radius'), atBound, {}), true);
    assert.equal(H.detailOpen(row(sphere, 'radius'), atBound, { radius: false }), false, 'the user may close it again');
    assert.equal(H.detailOpen(row(sphere, 'scale'), atBound, {}), false);
    assert.equal(H.detailOpen(row(sphere, 'radius'), fitResult({ atBound: { radius_pd: 'lower' } }), {}), true);
    const derived = F.reduce(sphere, { type: 'setStructure', structure: 'hardsphere' });
    assert.equal(H.detailOpen(row(derived, 'radius_effective'), null, { radius_effective: true }), false);
    // openDetails is detailOpen for every row; a result that does not match the form opens nothing
    assert.deepEqual({ ...H.openDetails(F.rows(sphere), { fitResult: atBound, matches: true, details: { scale: true } }) },
        { scale: true, background: false, sld: false, sld_solvent: false, radius: true });
    assert.equal(H.openDetails(F.rows(sphere), { fitResult: atBound, matches: false }).radius, false);
    assert.ok(Object.isFrozen(H.openDetails(F.rows(sphere), null)));
});

test('paramTableHtml: a collapsed row still tells the truth: a marker for edited bounds and for a dispersity that takes part', () => {
    const marker = (form, name) => cellOf(tableOf(form).html, H.markerId(name));
    const sphere = F.create('sphere');
    assert.equal(marker(sphere, 'radius'), '');
    assert.equal(marker(sphere, 'scale'), '', 'default bounds (0, open) are not marked');
    assert.equal(marker(F.reduce(sphere, { type: 'setUpper', name: 'radius', value: '45' }), 'radius'), '0–45');
    assert.equal(marker(F.reduce(sphere, { type: 'setLower', name: 'radius', value: '' }), 'radius'), '不限');
    assert.equal(marker(F.reduce(sphere, { type: 'setLower', name: 'background', value: '0' }), 'background'), '≥ 0');
    let pd = F.reduce(sphere, { type: 'togglePd', name: 'radius' });
    assert.equal(marker(pd, 'radius'), '', 'open with width 0: no effect yet');
    pd = F.reduce(pd, { type: 'setPdField', name: 'radius', field: 'width', value: '0.1' });
    assert.equal(marker(pd, 'radius'), '多分散 0.1');
    assert.equal(marker(F.reduce(pd, { type: 'setUpper', name: 'radius', value: '45' }), 'radius'), '0–45 · 多分散 0.1');
    assert.equal(marker(F.reduce(pd, { type: 'setPdFit', name: 'radius', fit: true }), 'radius'), '多分散（擬合寬度）');
    assert.equal(marker(F.reduce(pd, { type: 'togglePd', name: 'radius' }), 'radius'), '', 'closed: it does not take part');
});

test('paramTableHtml: an open dispersity: defaults, labelled fields with the new names, the error of the width next to it', () => {
    const form = F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    const { html, tags } = tableOf(form, { fitResult: null, matches: false, details: { radius: true } });
    assert.equal(byAttr(tags, 'data-action', 'togglePd')[0].attrs['aria-expanded'], 'true');
    const group = tags.find((t) => t.attrs.id === 'sfPdRow_radius');
    assert.deepEqual([group.attrs.role, group.attrs['aria-label'], group.attrs.hidden], ['group', 'radius 的多分散', undefined]);
    const pd = (key) => fieldOf(tags, 'radius', 'pd.' + key);
    assert.deepEqual(['width', 'lower', 'upper', 'npts', 'nsigmas'].map((k) => pd(k).attrs.value), ['0', '0', '0.4', '35', '3']);
    assert.deepEqual(['width', 'lower', 'upper', 'npts', 'nsigmas'].map((k) => pd(k).attrs['aria-label']),
        ['radius 的多分散寬度', 'radius 的多分散寬度下限', 'radius 的多分散寬度上限', 'radius 的多分散取點數', 'radius 的多分散範圍（σ 倍數）']);
    assert.deepEqual([pd('fit').attrs.type, pd('fit').attrs.checked, pd('fit').attrs['aria-label']], ['checkbox', undefined, '擬合 radius 的多分散寬度']);
    assert.equal(pd('npts').attrs.inputmode, 'numeric');
    ['寬度', '寬度下限', '寬度上限', '分布', '取點數', '範圍（σ 倍數）'].forEach((label) => assert.ok(html.includes('>' + label + '</label>'), label));
    assert.equal(/npts|nsigmas|>PD</.test(html.replace(/id="[^"]*"|for="[^"]*"|data-field="[^"]*"|aria-describedby="[^"]*"/g, '')), false, 'no jargon left on screen');
    const type = pd('type');
    assert.deepEqual([type.name, type.attrs['aria-label']], ['select', 'radius 的多分散分布']);
    assert.equal(count(html, '<option'), F.PD_TYPES.length);
    assert.ok(html.includes('<option value="gaussian" selected>gaussian</option>'));
    assert.ok(html.includes('<span class="sf-param-pm" id="sfPm_radius_pd"></span>'));
    const closed = tableOf(form, { fitResult: null, matches: false, details: {} });
    assert.equal(fieldOf(closed.tags, 'radius', 'pd.width'), undefined, 'the detail row is closed: its fields are not in the table');
});

test('paramTableHtml: the range of sigmas is disabled for uniform; messages of the dispersity are lines of their own in its group', () => {
    let form = F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    form = F.reduce(form, { type: 'setPdField', name: 'radius', field: 'type', value: 'uniform' });
    form = F.reduce(form, { type: 'setPdField', name: 'radius', field: 'npts', value: '0' });
    const { html, tags } = tableOf(form);
    assert.equal(tags.find((t) => t.attrs.id === 'sfMore_radius').attrs['aria-expanded'], 'true', 'the error opens the detail row');
    assert.equal(fieldOf(tags, 'radius', 'pd.nsigmas').attrs.disabled, true);
    assert.equal(fieldOf(tags, 'radius', 'pd.width').attrs.disabled, undefined);
    assert.equal(fieldOf(tags, 'radius', 'pd.npts').attrs['aria-invalid'], 'true');
    assert.ok(html.includes('<p class="sf-field-error" id="sfErr_radius_pd_npts">radius 的多分散取點數必須是 1 到 1000 的整數</p>'));
    assert.ok(html.includes('<p class="sf-field-error" id="sfErr_radius_pd_width" hidden></p>'));
});

test('paramTableHtml: the error column is empty without a matching result', () => {
    const form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    const cells = (ctx) => tableOf(form, { details: { radius: true }, ...ctx }).html.match(/<(?:td|span) class="sf-param-pm"[^>]*>[^<]*/g).map((s) => s.replace(/<[^>]*>/, ''));
    const n = F.rows(form).length + 1;
    assert.deepEqual(cells(undefined), Array(n).fill(''));
    assert.deepEqual(cells({ fitResult: null, matches: false }), Array(n).fill(''));
    assert.deepEqual(cells({ fitResult: fitResult(), matches: false }), Array(n).fill(''));
    assert.deepEqual(cells({ fitResult: fitResult({ status: 'stopped' }), matches: true }), Array(n).fill(''));
});

test('paramTableHtml: the error column shows the errors the page displays, per parameter (spec 5.7 items 5 and 8)', () => {
    const form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    const table = (r) => tableOf(form, { fitResult: r, matches: true, details: { radius: true } }).html;
    const plain = table(fitResult());
    assert.equal(cellOf(plain, 'sfPm_scale'), '± 0.012');
    assert.equal(cellOf(plain, 'sfPm_radius'), '± 0.50');
    assert.equal(cellOf(plain, 'sfPm_radius_pd'), '± 0.010');
    assert.equal(cellOf(plain, 'sfPm_thickness'), '', 'a fixed parameter has no error');
    assert.equal(cellOf(plain, 'sfPm_background'), '');

    const scaled = table(fitResult({ displayErrorsScaled: true }));
    assert.equal(cellOf(scaled, 'sfPm_scale'), '± 0.025');
    assert.equal(cellOf(scaled, 'sfPm_radius'), '± 1.0');

    const special = fitResult({ atBound: { radius: 'upper', scale: 'lower' }, errors: { scale: NaN, radius: 0.5, radius_pd: 0 } });
    const html = table(special);
    assert.equal(cellOf(html, 'sfPm_radius'), '貼上限', 'short in the narrow column: the hint and the tile have the sentence');
    assert.equal(cellOf(html, 'sfPm_scale'), '貼下限');
    assert.equal(cellOf(html, 'sfPm_radius_pd'), '無法計算');
    assert.equal(cellOf(table(fitResult({ errors: { scale: NaN, radius: 0.5, radius_pd: 0.01 } })), 'sfPm_scale'), '無法計算');
    // a parameter on a bound opens its detail row, where the bound is
    assert.equal(tableOf(form, { fitResult: special, matches: true }).tags.find((t) => t.attrs.id === 'sfMore_radius').attrs['aria-expanded'], 'true');
});

test('paramTableHtml: an error that is >= the value keeps its number; ill-conditioned and far larger says so in words', () => {
    const form = F.reduce(F.create('core_shell_sphere'), { type: 'togglePd', name: 'radius' });
    const table = (r) => tableOf(form, { fitResult: r, matches: true, details: { radius: true } }).html;
    const big = { errors: { scale: 5700, radius: 1e8, radius_pd: 0.01 } };
    assert.equal(cellOf(table(fitResult(big)), 'sfPm_scale'), '± 5700');
    assert.equal(cellOf(table(fitResult(big)), 'sfPm_radius'), '± 1.0e8');
    const ill = table(fitResult({ ...big, illConditioned: true }));
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
    assert.equal(cellOf(official, 'sfMark_charge'), '', 'the lower bound 0.5 of charge is its default: no marker');
});

test('paramTableHtml: locked disables every control of the table', () => {
    const form = F.reduce(F.create('sphere'), { type: 'togglePd', name: 'radius' });
    const { tags } = tableOf(form, { fitResult: null, matches: false, locked: true, details: openAll(form) });
    const controls = tags.filter((t) => !t.closing && ['input', 'select', 'button'].includes(t.name));
    assert.ok(controls.length > 30);
    assert.ok(controls.every((t) => t.attrs.disabled === true));
    assert.ok(tableOf(form).tags.some((t) => t.name === 'input' && t.attrs.disabled === undefined));
});

test('paramTableHtml: every model of the page renders with every detail row open; ids are unique and in the sf namespace', () => {
    Meta.order.filter((name) => !Meta.models[name].isStructureFactor).forEach((model) => {
        let form = F.create(model);
        F.rows(form).filter((r) => r.pd !== null).forEach((r) => { form = F.reduce(form, { type: 'togglePd', name: r.name }); });
        if (F.canTakeStructure(model)) form = F.reduce(form, { type: 'setStructure', structure: 'hayter_msa' });
        form = F.reduce(form, { type: 'setLowQ', on: true });
        const sldName = (F.rows(form).find((r) => r.isSld) || {}).name;
        const ctx = { fitResult: null, matches: false, details: openAll(form), sld: sldName === undefined ? null : sldView({ target: sldName }) };
        const { tags } = tableOf(form, ctx);
        const ids = idsOf(tags);
        assert.equal(new Set(ids).size, ids.length, model + ': duplicate ids');
        ids.forEach((id) => assert.match(id, ID_RE, model));
        tags.filter((t) => !t.closing && (t.attrs['aria-controls'] || t.attrs['aria-describedby'] || t.attrs.for)).forEach((t) => {
            [t.attrs['aria-controls'], t.attrs['aria-describedby'], t.attrs.for].filter(Boolean).join(' ').split(/\s+/)
                .forEach((id) => assert.ok(ids.includes(id), model + ': ' + id + ' does not exist'));
        });
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

test('modelOptionsHtml: one optgroup per group, the 13 models with their Chinese names, exactly the selected one marked', () => {
    const html = H.modelOptionsHtml(F.models(), 'cylinder');
    assert.ok(html.includes('<option value="sphere">sphere — 均勻球</option>'));
    assert.ok(html.includes('<option value="cylinder" selected>cylinder — 圓柱</option>'));
    assert.ok(html.includes('<option value="flexible_cylinder">flexible_cylinder — 柔性圓柱（蠕蟲鏈）</option>'));
    assert.ok(html.includes('<option value="guinier">Guinier</option>'), 'a name that says nothing new is not repeated');
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

test('paramErrorCells: the same ids and texts as the cells of paramTableHtml that change in place (errors and markers)', () => {
    let form = F.create('core_shell_sphere');
    form = F.reduce(form, { type: 'togglePd', name: 'radius' });
    form = F.reduce(form, { type: 'setPdField', name: 'radius', field: 'width', value: '0.1' });
    const rows = F.rows(form);
    const result = fitResult({ atBound: { scale: 'lower' } });
    const details = { radius: true };
    for (const ctx of [{ fitResult: result, matches: true, details }, { fitResult: result, matches: false, details }, { fitResult: null, matches: false, details }]) {
        const cells = H.paramErrorCells(rows, ctx);
        const html = H.paramTableHtml(rows, ctx);
        assert.equal(cells.length, rows.length * 2 + 1, 'an error cell and a marker per row, and the error of the open dispersity');
        for (const cell of cells) {
            const m = new RegExp('id="' + cell.id + '">([^<]*)<').exec(html);
            assert.ok(m, cell.id + ' is in the table');
            assert.equal(m[1], esc(cell.text), cell.id);
        }
    }
    const shown = Object.fromEntries(H.paramErrorCells(rows, { fitResult: result, matches: true, details }).map((c) => [c.id, c.text]));
    assert.equal(shown.sfPm_radius, '± 0.50');
    assert.equal(shown.sfPm_radius_pd, '± 0.010');
    assert.equal(shown.sfPm_scale, '貼下限');
    assert.equal(shown.sfPm_thickness, '', 'not fitted: empty');
    assert.equal(shown.sfMark_radius, '多分散 0.1');
    assert.equal(shown.sfMark_scale, '');
    const closed = H.paramErrorCells(rows, { fitResult: result, matches: true, details: { radius: false } });
    assert.equal(closed.some((c) => c.id === 'sfPm_radius_pd'), false, 'the width\'s error cell exists only while its detail row is open');
    assert.ok(H.paramErrorCells(rows, { fitResult: result, matches: false }).filter((c) => /^sfPm_/.test(c.id)).every((c) => c.text === ''));
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
