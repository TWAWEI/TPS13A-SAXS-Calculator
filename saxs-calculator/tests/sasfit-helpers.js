'use strict';
/**
 * Shared helpers for the sasfit tests (no test cases here).
 *
 *   loadFixture(name)        parse tests/fixtures/sasfit/<name>.json as-is
 *   num(v)                   map the fixture's "inf" / "-inf" / "nan" strings to numbers
 *   assertClose(got, ref, label)
 *                            element-wise |got - ref| <= 1e-9*|ref| + 1e-12*max|ref|,
 *                            lengths equal, every value finite (plan rule 6; never loosen)
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

function assertClose(got, ref, label) {
    const tag = label || 'values';
    assert.equal(got.length, ref.length, tag + ': length ' + got.length + ' != ' + ref.length);
    let refMax = 0;
    for (let i = 0; i < ref.length; i++) refMax = Math.max(refMax, Math.abs(ref[i]));
    const tol = Array.from(ref, (r) => REL_TOL * Math.abs(r) + ABS_TOL_SCALE * refMax);
    for (let i = 0; i < ref.length; i++) {
        assert.ok(Number.isFinite(got[i]), tag + ': non-finite got[' + i + '] = ' + got[i]);
        if (Math.abs(got[i] - ref[i]) <= tol[i]) continue;
        const k = worstPoint(got, ref, tol);
        const rel = Math.abs(got[k] - ref[k]) / Math.abs(ref[k]);
        assert.fail(tag + ': worst index ' + k + ' got=' + got[k] + ' ref=' + ref[k] + ' rel=' + rel);
    }
}

module.exports = { loadFixture, num, assertClose, loadWasm };
