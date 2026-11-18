'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitMeta, SasFitPyModels } = require('./load.js');
const { loadFixture, num, assertClose } = require('./sasfit-helpers.js');

const g1 = loadFixture('g1');
const g2 = loadFixture('g2');
const G2_CASES = 14;            // 7 guinier_porod + 4 power_law on q, 3 on qZero
const G2_NON_FINITE_CASES = 2;  // guinier_porod default and power_law default at q = 0
const G1_PY_DEFAULT_CASES = 2;  // guinier_porod default, power_law default
const jsModels = SasFitMeta.order.filter((name) => SasFitMeta.models[name].kind === 'js');

const isPyDefault = (c) => c.modelSpec.structure === null && !c.modelSpec.lowQPowerLaw
    && SasFitMeta.models[c.modelSpec.model].kind === 'js';
const g1Py = g1.cases.filter(isPyDefault);

/**
 * Finite reference points go through assertClose; a non-finite reference point
 * must be matched by the same non-finite value (same sign, or NaN for NaN).
 * Returns the number of non-finite reference points.
 */
function assertMatches(got, refRaw, label) {
    const ref = refRaw.map(num);
    assert.equal(got.length, ref.length, label + ': length');
    const finite = ref.map((_, i) => i).filter((i) => Number.isFinite(ref[i]));
    assertClose(finite.map((i) => got[i]), finite.map((i) => ref[i]), label);
    const others = ref.map((_, i) => i).filter((i) => !Number.isFinite(ref[i]));
    others.forEach((i) => {
        assert.ok(!Number.isFinite(got[i]), label + ': got[' + i + '] = ' + got[i] + ' should be ' + ref[i]);
        assert.ok(Object.is(got[i], ref[i]), label + ': got[' + i + '] = ' + got[i] + ', ref ' + ref[i]);
    });
    return others.length;
}

test('g2 fixture has the expected shape', () => {
    assert.equal(g2.cases.length, G2_CASES);
    assert.equal(g2.q.length, 200);
    assert.equal(g2.qZero.length, 5);
    assert.equal(g2.qZero[0], 0);
    assert.deepEqual([...new Set(g2.cases.map((c) => c.model))].sort(), [...jsModels].sort());
    assert.deepEqual([...new Set(g2.cases.map((c) => c.qKey))].sort(), ['q', 'qZero']);
});

test('SasFitPyModels exposes exactly the js-kind models of the meta', () => {
    assert.deepEqual(jsModels, ['guinier_porod', 'power_law']);
    assert.deepEqual(Object.keys(SasFitPyModels.models).sort(), [...jsModels].sort());
    assert.ok(Object.isFrozen(SasFitPyModels));
    assert.ok(Object.isFrozen(SasFitPyModels.models));
    jsModels.forEach((name) => {
        assert.ok(Object.isFrozen(SasFitPyModels.models[name]), name);
        assert.equal(typeof SasFitPyModels.models[name].Iq, 'function', name);
    });
});

let g2Ran = 0;
let g2NonFiniteCases = 0;
g2.cases.forEach((c) => {
    test('Iq matches sasmodels (g2): ' + c.label, () => {
        const got = SasFitPyModels.models[c.model].Iq(Float64Array.from(g2[c.qKey]), c.pars);
        assert.ok(got instanceof Float64Array);
        if (assertMatches(got, c.Iq, c.label) > 0) g2NonFiniteCases += 1;
        g2Ran += 1;
    });
});

test('every g2 case was exercised', () => {
    assert.equal(g2Ran, g2.cases.length);
    assert.equal(g2Ran, G2_CASES);
    assert.equal(g2NonFiniteCases, G2_NON_FINITE_CASES);
});

let g1Ran = 0;
g1Py.forEach((c) => {
    test('Iq matches sasmodels DirectModel (g1): ' + c.label, () => {
        const got = SasFitPyModels.models[c.modelSpec.model].Iq(Float64Array.from(g1.q), c.pars);
        assertClose(got, c.Iq, c.label);
        g1Ran += 1;
    });
});

test('every python-model g1 case was exercised', () => {
    assert.equal(g1Py.length, G1_PY_DEFAULT_CASES);
    assert.equal(g1Ran, g1Py.length);
    assert.deepEqual(g1Py.map((c) => c.modelSpec.model).sort(), [...jsModels].sort());
});

test('guinier_porod returns exactly the background when rg <= 0 or porod_exp <= s', () => {
    const q = Float64Array.from(g2.q);
    const flat = (pars) => Array.from(SasFitPyModels.models.guinier_porod.Iq(q, pars));
    const expected = Array.from(q, () => 0.003);
    assert.deepEqual(flat({ rg: 0, background: 0.003 }), expected);
    assert.deepEqual(flat({ rg: -5, background: 0.003 }), expected);
    assert.deepEqual(flat({ s: 2, porod_exp: 1.5, background: 0.003 }), expected);
    assert.deepEqual(flat({ s: 1, porod_exp: 1, background: 0.003, scale: 7 }), expected);
});

test('guinier_porod switches branch at q1 = sqrt(n*ms)/rg and is continuous there', () => {
    const rg = 30;
    const s = 0.5;
    const porodExp = 4;
    const q1 = Math.sqrt((3 - s) * 0.5 * (porodExp - s)) / rg;
    const pars = { rg, s, porod_exp: porodExp, scale: 1, background: 0 };
    const got = SasFitPyModels.models.guinier_porod.Iq([q1 * (1 - 1e-12), q1, q1 * (1 + 1e-12)], pars);
    const guinier = Math.pow(q1, -s) * Math.exp(-((q1 * rg) ** 2) / (3 - s));
    assertClose([got[0], got[1], got[2]], [guinier, guinier, guinier], 'continuity at q1');
});

test('scale and background are applied as scale*Iq + background', () => {
    const q = Float64Array.from(g2.q);
    jsModels.forEach((name) => {
        const model = SasFitPyModels.models[name];
        const base = model.Iq(q, { scale: 1, background: 0 });
        const got = model.Iq(q, { scale: 3, background: 0.25 });
        assertClose(got, Array.from(base, (v) => 3 * v + 0.25), name + ' scale/background');
    });
});

test('defaults come from the model meta', () => {
    const q = Float64Array.from(g2.q);
    const gp = SasFitPyModels.models.guinier_porod;
    assert.deepEqual(Array.from(gp.Iq(q, {})),
        Array.from(gp.Iq(q, { scale: 1, background: 0.001, rg: 60, s: 1, porod_exp: 3 })));
    const pl = SasFitPyModels.models.power_law;
    assert.deepEqual(Array.from(pl.Iq(q, {})), Array.from(pl.Iq(q, { scale: 1, background: 0.001, power: 4 })));
});

test('q and pars are not modified; plain arrays are accepted', () => {
    const q = Float64Array.from(g2.qZero);
    const qCopy = Float64Array.from(q);
    const pars = Object.freeze({ scale: 2, background: 0.5, rg: 25, s: 0.5, porod_exp: 3.5 });
    const parsCopy = JSON.stringify(pars);
    const got = SasFitPyModels.models.guinier_porod.Iq(q, pars);
    assert.deepEqual(q, qCopy);
    assert.equal(JSON.stringify(pars), parsCopy);
    assert.notEqual(got, q);
    const plain = SasFitPyModels.models.guinier_porod.Iq(Array.from(q), pars);
    assert.deepEqual(Array.from(plain), Array.from(got));
    const frozenPl = Object.freeze({ power: 2 });
    SasFitPyModels.models.power_law.Iq(q, frozenPl);
    assert.deepEqual(q, qCopy);
});

test('unknown parameter names throw an Error naming them', () => {
    const q = Float64Array.from(g2.q);
    const gp = SasFitPyModels.models.guinier_porod;
    const pl = SasFitPyModels.models.power_law;
    assert.throws(() => gp.Iq(q, { rg: 40, nope: 1 }), /nope/);
    assert.throws(() => gp.Iq(q, { power: 4 }), /power/);
    assert.throws(() => pl.Iq(q, { rg: 40 }), /rg/);
    // neither model has a polydisperse parameter, so the *_pd names are unused too
    assert.throws(() => gp.Iq(q, { rg_pd: 0.1 }), /rg_pd/);
    assert.throws(() => pl.Iq(q, { power_pd_n: 35 }), /power_pd_n/);
});

test('invalid inputs fail fast', () => {
    const q = Float64Array.from(g2.q);
    const pl = SasFitPyModels.models.power_law;
    assert.throws(() => pl.Iq('q', {}), /q must be/);
    assert.throws(() => pl.Iq([0.1, '0.2'], {}), /q must be/);
    assert.throws(() => pl.Iq(q, null), /pars must be an object/);
    assert.throws(() => pl.Iq(q), /pars must be an object/);
    assert.throws(() => pl.Iq(q, { power: '4' }), /power/);
    assert.throws(() => pl.Iq(q, { scale: '1' }), /scale/);
});

test('sasfit-py-models.js has no browser or Node I/O dependencies', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-py-models.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['window', 'document', 'fetch', 'require', 'XMLHttpRequest']) {
        assert.ok(!new RegExp('\\b' + banned + '\\b').test(code), banned);
    }
    assert.ok(src.split('\n').length <= 800);
    assert.match(src, /Copyright \(c\) 2009-2022, SasView Developers -- BSD 3-Clause,\s+\* see wasm\/LICENSE-sasmodels\.txt/);
});
