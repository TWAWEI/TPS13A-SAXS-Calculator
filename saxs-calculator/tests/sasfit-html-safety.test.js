'use strict';
/**
 * sasfit-html.js across all builders: unique ids, accessible names and the XSS matrix (design spec 13).
 * Helpers: tests/sasfit-html-helpers.js.
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

