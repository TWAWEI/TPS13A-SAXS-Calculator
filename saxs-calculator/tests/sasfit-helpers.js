'use strict';
/**
 * Shared helpers for the sasfit tests (no test cases here).
 *
 *   loadFixture(name)        parse tests/fixtures/sasfit/<name>.json as-is
 *   num(v)                   map the fixture's "inf" / "-inf" / "nan" strings to numbers
 *   qOf(fixture, c)          the q grid of a case as a Float64Array: its own `q` when it
 *                            has one (g1 "hmsa:" S(q) cases), else the fixture's
 *   isComponentGated(c)      g1 case with gate "component": P@hayter_msa with non-default
 *                            S parameters, never compared end to end (design spec 16)
 *   assertClose(got, ref, label)
 *                            element-wise |got - ref| <= 1e-9*|ref| + 1e-12*max|ref|,
 *                            lengths equal, every value finite (plan rule 6; never loosen)
 *   assertCloseRel(got, ref, label, rel)
 *                            same shape with a caller-given relative term; ONLY for the
 *                            end-to-end I(q) of P@S cases (see the comment at the function)
 *   loadWasm(model)          bytes of saxs-calculator/wasm/sas-<model>.wasm
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sasfit');
const WASM_DIR = path.join(__dirname, '..', 'wasm');
const REL_TOL = 1e-9;
const ABS_TOL_SCALE = 1e-12;
const NON_FINITE = Object.freeze({ inf: Infinity, '-inf': -Infinity, nan: NaN });

function loadFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name + '.json'), 'utf8'));
}

function num(v) {
    if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(NON_FINITE, v)) {
        return NON_FINITE[v];
    }
    return v;
}

function qOf(fixture, c) {
    return Float64Array.from(c.q === undefined ? fixture.q : c.q);
}

function isComponentGated(c) {
    if (c.gate !== undefined && c.gate !== 'component') throw new Error('unknown gate ' + c.gate + ': ' + c.label);
    return c.gate === 'component';
}

function loadWasm(model) {
    return fs.readFileSync(path.join(WASM_DIR, 'sas-' + model + '.wasm'));
}

/** Worst point: index, got, ref and relative difference, for the failure message. */
function worstPoint(got, ref, tol) {
    let worst = { i: -1, excess: -Infinity };
    for (let i = 0; i < ref.length; i++) {
        const excess = Math.abs(got[i] - ref[i]) - tol[i];
        if (!(excess <= worst.excess)) worst = { i, excess };
    }
    return worst.i;
}

function assertWithin(got, ref, label, rel) {
    const tag = label || 'values';
    assert.equal(got.length, ref.length, tag + ': length ' + got.length + ' != ' + ref.length);
    let refMax = 0;
    for (let i = 0; i < ref.length; i++) refMax = Math.max(refMax, Math.abs(ref[i]));
    const tol = Array.from(ref, (r) => rel * Math.abs(r) + ABS_TOL_SCALE * refMax);
    for (let i = 0; i < ref.length; i++) {
        assert.ok(Number.isFinite(got[i]), tag + ': non-finite got[' + i + '] = ' + got[i]);
        if (Math.abs(got[i] - ref[i]) <= tol[i]) continue;
        const k = worstPoint(got, ref, tol);
        const relDiff = Math.abs(got[k] - ref[k]) / Math.abs(ref[k]);
        assert.fail(tag + ': worst index ' + k + ' got=' + got[k] + ' ref=' + ref[k] + ' rel=' + relDiff);
    }
}

function assertClose(got, ref, label) {
    assertWithin(got, ref, label, REL_TOL);
}

/**
 * |got - ref| <= rel*|ref| + 1e-12*max|ref|. ONLY for the end-to-end I(q) of
 * P@S cases (rel = 1e-7); everything else uses assertClose.
 *
 * Why P@S cannot be held to 1e-9 end to end: the closed form in sasmodels'
 * hardsphere.c cancels catastrophically for 2qR ~ 0.05-0.13 (just above its
 * Taylor cutoff). There a 1-ulp change of R_eff moves S(q) by 2.3e-9 in native
 * sasmodels itself. R_eff comes from the polydisperse average of P, and the JS
 * Schulz weights agree with numpy to 1.4e-14 but not bit for bit, so R_eff can
 * be 1 ulp off. P@S is therefore gated in two layers (sasfit-product.test.js):
 * components and the composition with the reference R_eff injected at 1e-9,
 * the end-to-end curve at 1e-7.
 */
function assertCloseRel(got, ref, label, rel) {
    assert.ok(typeof rel === 'number' && rel > 0, 'assertCloseRel needs an explicit relative tolerance');
    assertWithin(got, ref, label, rel);
}

module.exports = { loadFixture, num, qOf, isComponentGated, assertClose, assertCloseRel, loadWasm };
