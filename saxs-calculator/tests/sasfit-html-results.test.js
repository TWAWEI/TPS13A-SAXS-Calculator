'use strict';
/**
 * sasfit-html.js: the fit segment and the panels -- result tiles, hints and status chips, the SLD panel and
 * the model information (design spec 4.7, 5.3, 5.4, 5.7). Helpers: tests/sasfit-html-helpers.js.
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

// ------------------------------------------------------------------ results


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
    assert.ok(scaled.includes(ResultTiles.tile({ label: 'radius', value: '50.1', unit: 'Å', sub: ['± 1.0'] })));
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
    assert.deepEqual(units, [['χ²ᵣ', ''], ['sld', '10⁻⁶ Å⁻²'], ['charge', 'e（基本電荷）'], ['temperature', 'K'], ['volfraction', ''], ['lowq_scale', '']]);
});

test('resultsHtml: background is in cm⁻¹ when the data are on absolute scale, without a unit otherwise', () => {
    const r = fitResult({ names: ['scale', 'background'], errors: { scale: 0.01, background: 0.0002 }, errorsScaled: { scale: 0.01, background: 0.0002 } });
    const tileOf = (ctx) => /<div class="tile"><div class="tile-label">background<\/div>.*?<\/div><\/div>/.exec(H.resultsHtml(r, ctx))[0];
    assert.equal(tileOf({ matches: true, fileName: 'a', absolute: true }),
        ResultTiles.tile({ label: 'background', value: '0.00100', unit: 'cm⁻¹', sub: ['± 0.00020'] }));
    assert.equal(tileOf({ matches: true, fileName: 'a' }), ResultTiles.tile({ label: 'background', value: '0.00100', sub: ['± 0.00020'] }));
});

test('resultsHtml: a tile never rounds its value away -- the three cases of the UI review', () => {
    const r = fitResult({
        params: { scale: 0.04871, background: -0.9626, sld: 1, radius: 50, charge: 72.7417 },
        names: ['scale', 'background', 'charge'],
        errors: { scale: 1.0, background: 3.5, charge: 5700 }, errorsScaled: { scale: 1.0, background: 3.5, charge: 5700 },
        settings: { ...fitResult().settings, modelSpec: { model: 'sphere', structure: 'hayter_msa', lowQPowerLaw: false } },
    });
    const html = H.resultsHtml(r, { matches: true, fileName: 'a', absolute: true });
    const NOTE = '誤差大於數值，此參數無法由資料決定';
    assert.ok(html.includes(ResultTiles.tile({ label: 'charge', value: '72.7', unit: 'e（基本電荷）', sub: ['± 5700', NOTE] })), html);
    assert.ok(html.includes(ResultTiles.tile({ label: 'scale', value: '0.0487', sub: ['± 1.0', NOTE] })));
    assert.ok(html.includes(ResultTiles.tile({ label: 'background', value: '−0.963', unit: 'cm⁻¹', sub: ['± 3.5', NOTE] })));
    assert.doesNotMatch(html, /-\d/, 'no ASCII minus in front of a digit');
    const ill = H.resultsHtml({ ...r, illConditioned: true }, { matches: true, fileName: 'a' });
    assert.ok(ill.includes(ResultTiles.tile({ label: 'scale', value: '0.0487', sub: ['± 1.0', NOTE] })), '1.0 is not > 1000 x 0.0487');
    const lost = H.resultsHtml({ ...r, illConditioned: true, errors: { ...r.errors, scale: 1e8 } }, { matches: true, fileName: 'a' });
    assert.ok(lost.includes(ResultTiles.tile({ label: 'scale', value: '0.0487', sub: ['誤差無法決定', NOTE] })));
});

test('resultsHtml: the tile shows the value that is written into the parameter table (same rounding)', () => {
    const J = globalThis.SasFitJobs;
    const form = F.create('sphere');
    const exact = { scale: 1.0013090858486413, background: 0.0013628359882335626, radius: 49.99493550916302 };
    const errors = { scale: 0.002073006854671509, background: 0.0001943752294732052, radius: 0.0033299359837592308 };
    const r = fitResult({
        params: { ...J.params(form), ...exact }, names: Object.keys(exact), errors, errorsScaled: errors,
        settings: { ...fitResult().settings, modelSpec: J.modelSpec(form) },
    });
    const applied = J.applyResult(form, r);
    const html = H.resultsHtml(r, { matches: true, fileName: 'a' });
    const shown = Object.fromEntries(Object.keys(exact).map((name) => [name,
        new RegExp('tile-label">' + name + '</div><div class="tile-value">([^<]*)').exec(html)[1]]));
    assert.deepEqual(shown, { scale: '1.0013', background: '0.00136', radius: '49.9949' });
    Object.keys(exact).forEach((name) => {
        const input = applied.fields[name].value;
        const decimals = (shown[name].split('.')[1] || '').length;
        assert.equal(Number(input).toFixed(decimals), shown[name], name + ': the tile is the input rounded to the place of the error');
    });
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
    assert.equal(options.length, 1 + Sld.PRESETS.length);
    assert.equal(options.length, 10, 'custom + nine presets');
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
    assert.ok(/f ≈ Z/.test(html) && /異常散射/.test(html) && /15 keV/.test(html));
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

test('SLD panel: a preset shows its note; the help text names the elements affected at 15 keV and how to write D', () => {
    const head = Sld.PRESETS.find((p) => p.id === 'lipid_head');
    const html = H.sldPanelHtml(sldView({ formula: head.formula, density: String(head.density), presetId: head.id,
        result: Sld.compute(head.formula, head.density) }));
    assert.ok(html.includes(esc('成分密度，不可直接當作殼層 SLD')));
    const peg = Sld.PRESETS.find((p) => p.id === 'peg');
    assert.ok(H.sldPanelHtml(sldView({ presetId: 'peg' })).includes(esc(peg.note)));
    assert.doesNotMatch(H.sldPanelHtml(sldView({ presetId: 'water' })), /<div class="[^"]*"><\/div>/, 'an empty note leaves no empty element');
    const help = /id="sfSldHelp">([^<]*)</.exec(html)[1];
    ['Rb', 'Sr', 'Y', 'Zr', 'Br', 'Kr', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Th', 'U'].forEach((el) => assert.ok(help.includes(el), el));
    assert.match(help, /實際 SLD 會低約 4–10 %（例：Au 131\.5 → 約 124）/);
    assert.match(help, /氘寫成 D（例：D2O）/);
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

