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

test('G6 element table: the 84 fixture elements plus exactly D (deuterium), Z and mass equal', () => {
    const symbols = Object.keys(FX.elements);
    assert.equal(symbols.length, 84);
    assert.deepEqual(Object.keys(FX.isotopes), ['D']);
    assert.deepEqual(Object.keys(S.ELEMENTS).sort(), symbols.concat(['D']).sort());
    symbols.forEach((sym) => {
        assert.equal(S.ELEMENTS[sym].z, FX.elements[sym][0], sym + ' Z');
        assert.equal(S.ELEMENTS[sym].mass, FX.elements[sym][1], sym + ' mass');
    });
    assert.equal(S.ELEMENTS.D.z, FX.isotopes.D[0]);
    assert.equal(S.ELEMENTS.D.z, 1);
    assert.equal(S.ELEMENTS.D.mass, FX.isotopes.D[1]);
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

test('deuterium: D counts one electron and its own mass; Dy, Ds and Db are not read as D', () => {
    FX.isotopeCases.forEach((c) => {
        const out = S.compute(c.formula, c.density);
        assert.deepEqual({ ...out.atoms }, c.atoms, c.formula);
        assert.ok(relDiff(out.molarMass, c.molarMass) < 1e-14, c.formula);
        assert.equal(out.electrons, c.electrons);
        assert.ok(relDiff(out.sld, c.sld) < 1e-13, c.formula + ' ' + out.sld);
    });
    const light = S.compute('H2O', 1.1044);
    const heavy = S.compute('D2O', 1.1044);
    assert.ok(heavy.sld < light.sld, 'same electrons in a heavier molecule: fewer electrons per gram');
    assert.deepEqual({ ...S.parseFormula('Dy2O3').atoms }, { Dy: 2, O: 3 });
    assert.throws(() => S.parseFormula('Ds'), (e) => e.code === 'unsupported_element');
    assert.throws(() => S.parseFormula('Db2'), (e) => e.code === 'unsupported_element');
    assert.throws(() => S.parseFormula('T2O'), (e) => e.code === 'unknown_element');
});

test('parseDensity: a plain decimal number > 0, strictly; compute refuses a result that is not finite', () => {
    assert.equal(S.parseDensity('0.9982'), 0.9982);
    assert.equal(S.parseDensity(' 1e0 '), 1);
    assert.equal(S.parseDensity('.5'), 0.5);
    assert.equal(S.parseDensity('19.'), 19);
    for (const bad of ['', ' ', '0', '-1', '+1', '0x10', '1,0', '1e400', 'Infinity', 'NaN', '1 2', '1e', 'abc', '1'.repeat(40), null, 1]) {
        assert.throws(() => S.parseDensity(bad), (e) => e.code === 'bad_density' && /密度/.test(e.message), String(bad));
    }
    assert.throws(() => S.compute('H2O', 1e308), (e) => e.code === 'bad_density', 'the SLD would not be finite');
    assert.throws(() => S.compute('H2O', Infinity), (e) => e.code === 'bad_density');
    assert.ok(Number.isFinite(S.compute('H2O', 1e250).sld));
});

/**
 * The nine presets (design spec 4.7; owner decisions D2 and D3 of 2026-11-18). Expected values come from
 * fixtures/sasfit/sld.json `presets`, computed with periodictable by tools/sasfit/gen_reference_sld.py.
 */
const PRESET_IDS = ['water', 'protein', 'lipid_head', 'lipid_head_hydrated', 'lipid_tail', 'peg', 'sio2', 'au', 'fe3o4'];
const PRESET_LABELS = ['水（20 °C）', '蛋白質（平均）', '脂質頭基（PC，不含水合水）', '脂質頭區（PC，含 8 個水合水）', '脂質尾鏈（液態相）',
    'PEG（塊材，非晶態）', 'SiO₂（非晶態）', 'Au（面心立方）', 'Fe₃O₄（磁鐵礦）'];
// SLD (1e-6 A^-2) and electron density (e/A^3) to 4 significant figures, for the record of the review
const PRESET_ROUNDED = Object.freeze({
    water: [9.403, 0.3337], protein: [12.24, 0.4344], lipid_head: [14.49, 0.5141], lipid_head_hydrated: [12.30, 0.4366],
    lipid_tail: [7.728, 0.2742], peg: [10.40, 0.3691], sio2: [18.64, 0.6615], au: [131.5, 4.667], fe3o4: [41.68, 1.479],
});

test('PRESETS: the nine materials with sources, notes and the SLD of the periodictable reference', () => {
    assert.ok(Object.isFrozen(S.PRESETS));
    assert.deepEqual(S.PRESETS.map((p) => p.id), PRESET_IDS);
    assert.deepEqual(FX.presets.map((p) => p.id), PRESET_IDS);
    assert.deepEqual(S.PRESETS.map((p) => p.label), PRESET_LABELS);
    S.PRESETS.forEach((p, i) => {
        assert.ok(Object.isFrozen(p));
        assert.deepEqual(Object.keys(p), ['id', 'label', 'formula', 'density', 'source', 'note']);
        assert.ok(typeof p.source === 'string' && p.source.trim().length > 10, p.id + ' source');
        assert.equal(typeof p.note, 'string');
        const ref = FX.presets[i];
        assert.equal(p.formula, ref.formula);
        assert.equal(p.density, ref.density);
        const out = S.compute(p.formula, p.density);
        assert.ok(relDiff(out.sld, ref.sld) < 1e-13, p.id + ' SLD ' + out.sld);
        assert.ok(relDiff(out.electronDensity, ref.electronDensity) < 1e-13, p.id);
        assert.equal(out.electrons, ref.electrons);
        assert.deepEqual([sig4(out.sld), sig4(out.electronDensity)], PRESET_ROUNDED[p.id], p.id);
    });
});

test('PRESETS: the lipid presets partition DOPC; the hydrated head region is head + 8 waters in 559 A^3', () => {
    const by = Object.fromEntries(S.PRESETS.map((p) => [p.id, { ...p, ...S.compute(p.formula, p.density) }]));
    assert.equal(by.lipid_head.electrons + 2 * by.lipid_tail.electrons, S.compute('C44H84NO8P', 1).electrons);
    assert.equal(by.lipid_head.electrons, 164);
    assert.equal(by.lipid_head_hydrated.electrons, 164 + 8 * 10);
    assert.deepEqual({ ...by.lipid_head_hydrated.atoms }, { C: 10, H: 34, N: 1, O: 16, P: 1 });
    const volume = (p) => p.molarMass / (S.N_A * p.density) * 1e24;
    assert.ok(Math.abs(volume(by.lipid_head) - 319) < 0.1, 'V_H ' + volume(by.lipid_head));
    assert.ok(Math.abs(volume(by.lipid_head_hydrated) - 559) < 0.5, 'head + 8 waters ' + volume(by.lipid_head_hydrated));
    assert.ok(Math.abs(2 * volume(by.lipid_tail) - 984) < 1, 'two chains ' + 2 * volume(by.lipid_tail));
    assert.match(by.lipid_head.note, /成分密度，不可直接當作殼層 SLD/);
    assert.equal(by.lipid_head_hydrated.note, '頭區 SLD 隨水合數而變：5–12 個水為 0.42–0.46 e/Å³；V_H 取 319 Å³（文獻範圍 319–340）');
    assert.match(by.lipid_tail.note, /V_H＝319 Å³/);
    assert.match(by.peg.note, /水溶液/);
    for (const n of [5, 12]) {
        const rho = S.compute('C10H18NO8P·' + n + 'H2O', (311.227 + n * 18.015) / (S.N_A * (319 + n * 29.9686) * 1e-24)).electronDensity;
        assert.ok(rho > 0.415 && rho < 0.46, n + ' waters: ' + rho);
    }
});
