'use strict';
/**
 * sasfit-sld.js: chemical formula -> X-ray SLD (design spec 4.7, decision 21) and gate G6
 * against tests/fixtures/sasfit/sld.json (periodictable 2.1.0, tools/sasfit/gen_reference_sld.py).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitSld: S } = require('./load.js');
const { loadFixture } = require('./sasfit-helpers.js');

const FX = loadFixture('sld');
const G6_REL = 1e-6;
const relDiff = (got, ref) => Math.abs(got - ref) / Math.abs(ref);
const plain = (o) => JSON.parse(JSON.stringify(o));
const sig4 = (x) => Number(x.toPrecision(4));

/** Where each invalid string of the fixture goes wrong (1-based character); the fixture stores no position. */
const INVALID_POSITION = Object.freeze({
    Xx2: 1, 'H2O)': 4, '(H2O': 1, '2H2O': 1, '': 1, '   ': 1, h2o: 1, 'H-2': 2, 'CuSO4·': 6, '·5H2O': 1,
    Tc: 1, Pm: 1, Og: 1, '()': 1,
});

function thrown(text) {
    try {
        S.parseFormula(text);
    } catch (err) {
        return err;
    }
    return assert.fail('parseFormula accepted ' + JSON.stringify(text));
}

test('module is frozen; constants are the spec values', () => {
    assert.ok(Object.isFrozen(S));
    assert.equal(S.R_E, 2.8179403262e-5);
    assert.equal(S.N_A, 6.02214076e23);
    assert.equal(S.R_E, FX.conventions.rE_A);
    assert.equal(S.N_A, FX.conventions.N_A);
});

test('G6 element table: exactly the 84 fixture elements, Z and mass equal', () => {
    const symbols = Object.keys(FX.elements);
    assert.equal(symbols.length, 84);
    assert.deepEqual(Object.keys(S.ELEMENTS).sort(), symbols.slice().sort());
    symbols.forEach((sym) => {
        assert.equal(S.ELEMENTS[sym].z, FX.elements[sym][0], sym + ' Z');
        assert.equal(S.ELEMENTS[sym].mass, FX.elements[sym][1], sym + ' mass');
    });
    assert.ok(Object.isFrozen(S.ELEMENTS) && Object.isFrozen(S.ELEMENTS.H));
});

test('G6 cases: composition equal, molar mass / electrons / rho_e / SLD within 1e-6', (t) => {
    assert.equal(FX.cases.length, 21);
    let worst = 0;
    FX.cases.forEach((c) => {
        const parsed = S.parseFormula(c.formula);
        assert.deepEqual(plain(parsed.atoms), c.atoms, c.formula);
        assert.deepEqual(Object.keys(parsed.atoms), Object.keys(c.atoms), c.formula + ' order');
        assert.deepEqual([...parsed.symbols], Object.keys(c.atoms));
        const out = S.compute(c.formula, c.density);
        [['molarMass', c.molarMass], ['electrons', c.electrons], ['electronDensity', c.electronDensity], ['sld', c.sld]]
            .forEach(([key, ref]) => {
                const d = relDiff(out[key], ref);
                worst = Math.max(worst, d);
                assert.ok(d <= G6_REL, c.formula + ' ' + key + ': ' + out[key] + ' vs ' + ref);
            });
    });
    t.diagnostic('G6 worst relative difference ' + worst);
    assert.ok(worst <= G6_REL);
});

test('water at 1.0 g/cm3 is 9.420e-6 A^-2', () => {
    assert.equal(sig4(S.compute('H2O', 1.0).sld), 9.420);
    assert.equal(S.compute('H2O', 1.0).sld.toPrecision(4), '9.420');
});

test('grammar: counts, decimals, nesting, whitespace', () => {
    assert.deepEqual(plain(S.parseFormula('NaCl').atoms), { Na: 1, Cl: 1 });
    assert.deepEqual(plain(S.parseFormula('C2.5H4O').atoms), { C: 2.5, H: 4, O: 1 });
    assert.deepEqual(plain(S.parseFormula('((CH3)2SiO)10').atoms), { C: 20, H: 60, Si: 10, O: 10 });
    assert.deepEqual(plain(S.parseFormula('(H2O)0.5').atoms), { H: 1, O: 0.5 });
    assert.deepEqual(plain(S.parseFormula(' Ca3 (PO4)2 ').atoms), { Ca: 3, P: 2, O: 8 });
    assert.deepEqual(plain(S.parseFormula('HOH').atoms), { H: 2, O: 1 });
    assert.deepEqual(plain(S.parseFormula('CO').atoms), { C: 1, O: 1 });
    assert.deepEqual(plain(S.parseFormula('Co').atoms), { Co: 1 });
});

test('grammar: hydrate separators, multipliers and the ASCII period', () => {
    const ref = { Cu: 1, S: 1, O: 9, H: 10 };
    ['CuSO4·5H2O', 'CuSO4•5H2O', 'CuSO4⋅5H2O', 'CuSO4(H2O)5', 'CuSO4 · 5 H2O', 'CuSO4·H2O·4H2O']
        .forEach((text) => assert.deepEqual(plain(S.parseFormula(text).atoms), ref, text));
    assert.deepEqual(plain(S.parseFormula('CuSO4.5H2O').atoms), { Cu: 1, S: 1, O: 5.5, H: 2 });
    assert.deepEqual(plain(S.parseFormula('CuSO4·2.5H2O').atoms), { Cu: 1, S: 1, O: 6.5, H: 5 });
    assert.deepEqual(plain(S.parseFormula('CuSO4·H2O').atoms), { Cu: 1, S: 1, O: 5, H: 2 });
});

test('fixture invalid strings: code = fixture category, position and Chinese reason in the message', () => {
    assert.equal(FX.invalid.length, 14);
    FX.invalid.forEach(({ formula, category }) => {
        const err = thrown(formula);
        const tag = JSON.stringify(formula);
        assert.ok(err instanceof Error, tag);
        assert.equal(err.code, category, tag);
        assert.ok(Object.prototype.hasOwnProperty.call(INVALID_POSITION, formula), 'position table lacks ' + tag);
        assert.equal(err.position, INVALID_POSITION[formula], tag + ' position');
        assert.ok(err.message.includes('第 ' + err.position + ' 個字元'), tag + ': ' + err.message);
        assert.match(err.message, /[一-鿿]/);
    });
});

test('errors about elements name the symbol', () => {
    assert.ok(thrown('Xx2').message.includes('Xx'));
    assert.ok(thrown('Tc').message.includes('Tc'));
    assert.ok(thrown('H2Og').message.includes('Og'));
    assert.equal(thrown('H2Og').position, 3);
    assert.equal(thrown('NaCl2Zz').position, 6);
});

test('more rejected input, each with its own code and position', () => {
    const cases = [
        ['H2..5', 'invalid_character', 3], ['H2.', 'invalid_character', 3], ['H.5', 'invalid_character', 2],
        ['H2O))', 'unbalanced_parenthesis', 4], ['((H2O)', 'unbalanced_parenthesis', 1],
        ['A1(OH)3', 'unknown_element', 1], ['Na(2Cl)', 'leading_count', 4], ['Ca()2', 'empty_group', 3],
        ['CuSO4··H2O', 'missing_part', 6], ['CuSO4·5', 'missing_part', 6], ['CuSO4 · ', 'missing_part', 7],
        ['(CuSO4·5H2O)2', 'invalid_character', 7], ['H0', 'invalid_count', 2], ['H2O·0H2O', 'invalid_count', 5],
        ['H2O!', 'invalid_character', 4], ['H₂O', 'invalid_character', 2],
    ];
    cases.forEach(([text, code, position]) => {
        const err = thrown(text);
        assert.equal(err.code, code, text + ': ' + err.message);
        assert.equal(err.position, position, text + ': ' + err.message);
    });
    assert.equal(thrown(null).code, 'empty');
    assert.equal(thrown(undefined).code, 'empty');
    assert.equal(thrown('H'.repeat(S.MAX_FORMULA_LENGTH + 1)).code, 'too_long');
    assert.deepEqual([...S.ERROR_CODES].sort(), ['empty', 'empty_group', 'invalid_character', 'invalid_count',
        'leading_count', 'missing_part', 'too_long', 'unbalanced_parenthesis', 'unknown_element', 'unsupported_element']);
});

test('compositionText: first-appearance order, no padded decimals', () => {
    assert.equal(S.compositionText(S.parseFormula('CuSO4·5H2O').atoms), 'Cu 1、S 1、O 9、H 10');
    assert.equal(S.compositionText(S.parseFormula('C2.5H4O').atoms), 'C 2.5、H 4、O 1');
    assert.equal(S.compositionText({ H: 0.1 + 0.2, O: 1 }), 'H 0.3、O 1');
    assert.equal(S.compositionText({}), '');
});

test('compute: frozen result, atom order, density must be a finite positive number', () => {
    const out = S.compute('CuSO4·5H2O', 2.286);
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.atoms));
    assert.deepEqual(Object.keys(out.atoms), ['Cu', 'S', 'O', 'H']);
    assert.deepEqual(Object.keys(out).sort(), ['atoms', 'electronDensity', 'electrons', 'molarMass', 'sld']);
    const parsed = S.parseFormula('H2O');
    assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.atoms) && Object.isFrozen(parsed.symbols));
    [0, -1, NaN, Infinity, '1', null, undefined].forEach((density) => {
        assert.throws(() => S.compute('H2O', density), (err) => err.code === 'bad_density' && /密度/.test(err.message),
            String(density));
    });
    assert.throws(() => S.compute('Xx', 1), (err) => err.code === 'unknown_element');
    // doubling the density doubles the SLD; rho_e and SLD are tied by r_e
    assert.ok(relDiff(S.compute('SiO2', 4.4).sld, 2 * S.compute('SiO2', 2.2).sld) < 1e-14);
    assert.ok(relDiff(out.sld, S.R_E * out.electronDensity * 1e6) < 1e-14);
});

/**
 * Expected values of the eight presets, computed independently of the JS with periodictable 2.1.0
 * masses and the spec constants (throwaway script, 2026-11-18): formula, density (g/cm3),
 * SLD (1e-6 A^-2) and electron density (e/A^3), 4 significant figures.
 */
const PRESET_EXPECTED = Object.freeze({
    water: ['H2O', 0.9982, 9.403, 0.3337],
    protein: ['C4.9384H7.7583N1.3577O1.4773S0.0417', 1.35, 12.24, 0.4344],
    lipid_head: ['C10H18NO8P', 1.62, 14.49, 0.5141],
    lipid_tail: ['C17H33', 0.801, 7.728, 0.2742],
    peg: ['C2H4O', 1.125, 10.40, 0.3691],
    sio2: ['SiO2', 2.2, 18.64, 0.6615],
    au: ['Au', 19.32, 131.5, 4.667],
    fe3o4: ['Fe3O4', 5.17, 41.68, 1.479],
});

test('PRESETS: the eight materials of spec 4.7 with sources and the expected SLD', () => {
    assert.ok(Object.isFrozen(S.PRESETS));
    assert.deepEqual(S.PRESETS.map((p) => p.id), Object.keys(PRESET_EXPECTED));
    assert.equal(new Set(S.PRESETS.map((p) => p.id)).size, 8);
    const labels = S.PRESETS.map((p) => p.label);
    ['水', '蛋白質（平均）', '脂質頭基', '脂質尾鏈', 'PEG', 'SiO₂', 'Au', 'Fe₃O₄'].forEach((name, i) => {
        assert.ok(labels[i].startsWith(name), labels[i] + ' should start with ' + name);
    });
    S.PRESETS.forEach((p) => {
        assert.ok(Object.isFrozen(p));
        assert.deepEqual(Object.keys(p), ['id', 'label', 'formula', 'density', 'source']);
        assert.ok(typeof p.source === 'string' && p.source.trim().length > 10, p.id + ' source');
        const [formula, density, sld, rhoE] = PRESET_EXPECTED[p.id];
        assert.equal(p.formula, formula);
        assert.equal(p.density, density);
        const out = S.compute(p.formula, p.density);
        assert.equal(sig4(out.sld), sld, p.id + ' SLD ' + out.sld);
        assert.equal(sig4(out.electronDensity), rhoE, p.id + ' rho_e ' + out.electronDensity);
    });
});
