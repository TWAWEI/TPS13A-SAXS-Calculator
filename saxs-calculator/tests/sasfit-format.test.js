'use strict';
/**
 * sasfit-format.js: the number rules of the SAS fitting page (fix pass A),
 * as one table. Every row is value, error -> tile value, tile error, kind,
 * text written back into the input.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./load.js');

const F = globalThis.SasFitFormat;

// value, error, shown value, shown error, kind, input text
const TABLE = [
    // the three mismatches of the UI review: the tile no longer rounds the value away
    [72.7417, 5700, '72.7', '5700', 'undetermined', '72.7417'],
    [0.04871, 1.0, '0.0487', '1.0', 'undetermined', '0.04871'],
    [-0.9626, 3.5, '−0.963', '3.5', 'undetermined', '-0.9626'],
    // normal: error 2 s.f., value to the same place
    [49.944379323722, 0.0312, '49.944', '0.031', 'normal', '49.94438'],
    [49.94437932372238, 0.28, '49.94', '0.28', 'normal', '49.9444'],
    [1.0013090858486413, 0.002073, '1.0013', '0.0021', 'normal', '1.001309'],
    [0.0013628359882335626, 0.00019437, '0.00136', '0.00019', 'normal', '0.00136284'],
    [1.0e-3, 3.5e-4, '0.00100', '0.00035', 'normal', '0.001'],
    [1.2345e-3, 2e-5, '0.001234', '0.000020', 'normal', '0.0012345'],
    [9.96, 0.0996, '9.96', '0.10', 'normal', '9.96'],
    [1234.5, 99.6, '1230', '100', 'normal', '1234.5'],
    [12345, 996, '12300', '1000', 'normal', '12345'],
    [123456, 0.5, '123456.00', '0.50', 'normal', '123456'],
    [100000, 2, '100000.0', '2.0', 'normal', '100000'],
    [99999, 2, '99999.0', '2.0', 'normal', '99999'],
    // never fewer than 3 significant figures of the value
    [2.5, 0.996, '2.50', '1.00', 'normal', '2.5'],
    [15, 12, '15.0', '12.0', 'normal', '15'],
    [70000, 30000, '70000', '30000', 'normal', '70000'],
    [0.5, 0.2, '0.500', '0.200', 'normal', '0.5'],
    // small and large: one shared exponent, taken from the larger number, mantissa renormalised
    [-2.2497415222375204e-4, 7.7259e-5, '−2.25e−4', '0.77e−4', 'normal', '-0.000224974'],
    [0.00099, 0.0005, '9.90e−4', '5.00e−4', 'normal', '0.00099'],
    [1e-9, 1e-10, '1.00e−9', '0.10e−9', 'normal', '1e-9'],
    [9.99999e-5, 1e-6, '1.000e−4', '1.0e−6', 'normal', '0.0000999999'],
    [9.9996e-5, 3e-8, '9.9996e−5', '3.0e−8', 'normal', '0.000099996'],
    [1e9, 1e7, '1.000e9', '1.0e7', 'normal', '1000000000'],
    [1.23456e9, 4e8, '1.23e9', '0.40e9', 'normal', '1234560000'],
    [-5e7, 1e3, '−5.00000e7', '1000', 'normal', '-50000000'],
    [999999.6, 0.3, '999999.60', '0.30', 'normal', '999999.6'],
    [999999.96, 0.03, '999999.960', '0.030', 'normal', '999999.96'],
    [999999.9996, 0.03, '1.000000000e6', '0.030', 'normal', '999999.9996'],
    // error far below the value: at most 10 significant figures, the error on its own
    [49.94, 1e-9, '49.94000000', '1.0e−9', 'normal', '49.94'],
    [6, 1e-13, '6.000000000', '1.0e−13', 'normal', '6'],
    [0.001, 1e-20, '0.001000000000', '1.0e−20', 'normal', '0.001'],
    // error >= |value|: both in their own notation
    [24.007498678809114, 143923.08, '24.0', '140000', 'undetermined', '24.0075'],
    [15.776024832728607, 100483523.6, '15.8', '1.0e8', 'undetermined', '15.776'],
    [8.868806643068467e-5, 4.2771e-4, '8.87e−5', '4.3e−4', 'undetermined', '0.0000886881'],
    [1e-5, 1e5, '1.00e−5', '100000', 'undetermined', '0.00001'],
    [7e4, 3e5, '70000', '300000', 'undetermined', '70000'],
    [0.0996, 0.0996, '0.0996', '0.10', 'undetermined', '0.0996'],
    [0, 0.01, '0', '0.010', 'undetermined', '0'],
    [0, 2e7, '0', '2.0e7', 'undetermined', '0'],
    [-3, 3, '−3.00', '3.0', 'undetermined', '-3'],
    // no usable error
    [1, NaN, '1.0000', '—', 'no-error', '1'],
    [1, 0, '1.0000', '—', 'no-error', '1'],
    [1, -1, '1.0000', '—', 'no-error', '1'],
    [1, Infinity, '1.0000', '—', 'no-error', '1'],
    [-0.0009626123456789, undefined, '−9.6261e−4', '—', 'no-error', '-0.00096261235'],
    [49.94437932372238, null, '49.944', '—', 'no-error', '49.944379'],
    [0, NaN, '0', '—', 'no-error', '0'],
    // no usable value
    [NaN, 1, '—', '1.0', 'no-value', 'NaN'],
    [Infinity, 0.5, '—', '0.50', 'no-value', 'Infinity'],
    [NaN, NaN, '—', '—', 'no-error', 'NaN'],
];

test('module is frozen', () => {
    assert.ok(Object.isFrozen(F));
    assert.equal(F.MINUS, '−');
    assert.equal(F.MISSING, '—');
});

test('valueError and inputText: the whole table', () => {
    for (const [value, error, shownValue, shownError, kind, input] of TABLE) {
        const label = String(value) + ' ± ' + String(error);
        assert.deepEqual({ ...F.valueError(value, error) }, { value: shownValue, error: shownError, kind }, label);
        assert.equal(F.inputText(value, error), input, label + ' (input)');
        assert.ok(Object.isFrozen(F.valueError(value, error)));
    }
});

test('no displayed text has a padded mantissa, a zero mantissa or an ASCII minus', () => {
    const magnitudes = [];
    for (let e = -9; e <= 9; e++) for (const m of [1, 1.5, 2.2497, 9.4, 9.96, 9.9999, 9.99999999]) magnitudes.push(m * Math.pow(10, e));
    let checked = 0;
    for (const v of magnitudes) {
        for (const err of magnitudes) {
            for (const sign of [1, -1]) {
                const r = F.valueError(sign * v, err);
                const label = (sign * v) + ' ± ' + err + ' -> ' + r.value + ' ± ' + r.error;
                for (const text of [r.value, r.error]) {
                    assert.doesNotMatch(text, /-/, label);
                    assert.doesNotMatch(text, /^−?0+(\.0+)?(e|$)/, label + ': zero mantissa');
                    assert.doesNotMatch(text, /^−?\d{2,}(\.\d+)?e/, label + ': mantissa >= 10');
                    assert.doesNotMatch(text, /^−?0\.0\d*e/, label + ': mantissa < 0.1');
                    assert.match(text, /^−?\d+(\.\d+)?(e−?\d+)?$/, label);
                }
                const digits = r.value.replace(/e.*$/, '').replace(/^−?0*\.?0*/, '').replace('.', '').length;
                assert.ok(digits >= 3 || /^−?\d+$/.test(r.value), label + ': fewer than 3 significant figures');
                assert.ok(r.value.length <= 16 && r.error.length <= 12, label + ': too long');
                const shown = Number(r.value.replace(/−/g, '-'));
                const tolerance = r.kind === 'normal' ? Math.max(0.5 * err, 1e-9 * v) : 0.006 * v;
                assert.ok(Math.abs(shown - sign * v) <= tolerance, label + ': the text is not the number');
                const shownErr = Number(r.error.replace(/−/g, '-'));
                assert.ok(Math.abs(shownErr - err) <= 0.06 * err, label + ': the error text is not the error');
                checked += 1;
            }
        }
    }
    assert.equal(checked, 19 * 7 * 19 * 7 * 2);
});

test('kind follows error >= |value|; illConditioned with error > 1000 |value| shows no number for the error', () => {
    assert.equal(F.isUndetermined(72.7, 5700), true);
    assert.equal(F.isUndetermined(-3, 3), true);
    assert.equal(F.isUndetermined(3, 2.999), false);
    assert.equal(F.isUndetermined(3, NaN), false);
    assert.equal(F.isUndetermined(NaN, 3), false);
    assert.deepEqual({ ...F.valueError(15.776, 1.0e8, { illConditioned: true }) }, { value: '15.8', error: '無法決定', kind: 'undeterminable' });
    assert.deepEqual({ ...F.valueError(15.776, 15000, { illConditioned: true }) }, { value: '15.8', error: '15000', kind: 'undetermined' });
    assert.deepEqual({ ...F.valueError(15.776, 1.0e8, { illConditioned: false }) }, { value: '15.8', error: '1.0e8', kind: 'undetermined' });
    assert.deepEqual({ ...F.valueError(15.776, 1.0e8, null) }, { value: '15.8', error: '1.0e8', kind: 'undetermined' });
    assert.equal(F.valueError(0, 5, { illConditioned: true }).kind, 'undeterminable');
});

test('number: significant figures, plain from 1e-3 to below 1e6, rounding carry', () => {
    const cases = [[0, 5, '0'], [1e-9, 5, '1.0000e-9'], [-1.2345678e-4, 5, '-1.2346e-4'], [0.001, 5, '0.0010000'],
        [0.00099999, 3, '0.00100'], [0.00099999, 5, '9.9999e-4'], [9.99999e-5, 3, '1.00e-4'], [99999.4, 5, '99999'], [99999.96, 5, '100000'],
        [123456, 3, '123000'], [999999.6, 3, '1.00e6'], [1e6, 5, '1.0000e6'], [-3.14159, 3, '-3.14'], [642.123, 3, '642'],
        [20852.93, 3, '20900'], [0.0996, 2, '0.10'], [1e9, 3, '1.00e9'], [NaN, 3, '—'], [Infinity, 3, '—'], ['1', 3, '—']];
    for (const [value, digits, text] of cases) assert.equal(F.number(value, digits), text, String(value));
    assert.equal(F.display('-1.5e-4'), '−1.5e−4');
    assert.equal(F.display(F.number(-0.5, 2)), '−0.50');
});

test('inputValue: moves a value by less than 0.001 sigma, keeps 6..15 significant figures, is idempotent', () => {
    const values = [49.94437932372238, 1.0013090858486413, 0.0013628359882335626, -0.00022497415222375204, 1622.876520500591,
        0.0006172337797488577, 24.007498678809114, 123456.78901234567, 9.99999999e-5, 3.3333333333333335e8, -7.123456789012345e-9];
    const ratios = [1e-9, 1e-6, 1e-3, 0.02, 0.5, 1, 30, 1e6];
    for (const v of values) {
        for (const ratio of ratios) {
            const err = Math.abs(v) * ratio;
            const r = F.inputValue(v, err);
            const text = F.inputText(v, err);
            const label = v + ' ± ' + err + ' -> ' + text;
            assert.equal(Number(text), r, label);
            assert.equal(F.inputValue(r, err), r, label + ': not idempotent');
            const digits = text.replace(/e.*$/, '').replace(/^-?0*\.?0*/, '').replace('.', '').length;
            assert.ok(digits <= 15, label + ': ' + digits + ' digits');
            assert.match(text, /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/, label + ': the form must be able to read it');
            if (ratio >= 1e-9 * 1e3) assert.ok(Math.abs(r - v) < 1e-3 * err, label + ': moved by ' + Math.abs(r - v) / err + ' sigma');
            assert.ok(Math.abs(r - v) <= 5.1e-6 * Math.abs(v), label + ': fewer than 6 significant figures');
        }
        const lone = F.inputText(v, NaN);
        assert.ok(Math.abs(Number(lone) - v) <= 5.1e-8 * Math.abs(v), lone);
        assert.ok(lone.replace(/e.*$/, '').replace(/[-.]/g, '').replace(/^0+|0+$/g, '').length <= 8, lone);
    }
});

test('inputValue: a value inside its bounds stays inside', () => {
    assert.equal(F.inputValue(0.1234563, 0.5, [0.1234562, 1]), 0.1234562, 'rounding to 0.123456 would leave the range');
    assert.equal(F.inputValue(0.39999951, 0.5, [0, 0.3999996]), 0.3999996);
    assert.equal(F.inputValue(0.4, 0.5, [0, 0.4]), 0.4);
    assert.equal(F.inputValue(0, 0.5, [0, 0.4]), 0);
    assert.equal(F.inputValue(5.0000004, 1, [-Infinity, Infinity]), 5);
    assert.equal(F.inputValue(5.0000004, 1, [6, 7]), 5, 'a start outside the bounds is not moved onto them here');
    assert.equal(F.inputValue(NaN, 1, [0, 1]), NaN);
});
