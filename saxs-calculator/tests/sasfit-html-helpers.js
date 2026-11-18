'use strict';
/**
 * Shared helpers of the sasfit-html*.test.js files (no test cases here): the structural markup check
 * (checkMarkup), a complete FitResult, a file row, and small readers of the built HTML.
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

function tableOf(form, ctx) {
    const rows = F.rows(form);
    const html = H.paramTableHtml(rows, ctx);
    return { rows, html, tags: checkMarkup(html, 'paramTable') };
}
const fieldOf = (tags, param, field) => tags.find((t) => !t.closing && t.attrs['data-param'] === param && t.attrs['data-field'] === field);

const tileLabels = (html) => (html.match(/<div class="tile-label">[^<]*/g) || []).map((s) => s.replace(/<[^>]*>/, ''));

const sldView = (overrides) => ({ target: 'sld_solvent', formula: 'H2O', density: '0.9982', presetId: '',
    result: Sld.compute('H2O', 0.9982), error: null, ...overrides });

module.exports = {
    esc, count, ID_RE, TAG_RE, ATTR_RE, ALLOWED_TAGS, ALLOWED_ATTRS, checkMarkup, openTags, byAttr, idsOf, textOf, fitResult, fileRow, tableOf, fieldOf, tileLabels, sldView,
};
