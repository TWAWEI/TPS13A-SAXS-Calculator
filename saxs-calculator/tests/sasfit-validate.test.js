'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitMeta, SasFitValidate: V } = require('./load.js');

test('SasFitValidate is frozen and exports the shared helpers', () => {
    assert.ok(Object.isFrozen(V));
    for (const name of ['has', 'isObject', 'assertObject', 'readNumber', 'readFinite', 'readPdCount',
        'checkQ', 'readCutoff', 'isPolydisperse', 'pdNames', 'knownNames', 'assertNoUnusedPars',
        'assertEvalPoints']) {
        assert.equal(typeof V[name], 'function', name);
    }
    assert.equal(V.MAX_PD_POINTS, 1000);
    assert.equal(V.MAX_EVAL_POINTS, 1e6);
    assert.equal(V.MAX_Q_POINTS, 1e6);
    assert.deepEqual(V.PD_SUFFIXES, ['_pd', '_pd_n', '_pd_nsigma', '_pd_type']);
});

test('has is an own-property test', () => {
    assert.equal(V.has({ a: 1 }, 'a'), true);
    assert.equal(V.has({}, 'constructor'), false);
    assert.equal(V.has({}, 'toString'), false);
    assert.equal(V.has({}, '__proto__'), false);
    assert.equal(V.has(JSON.parse('{"__proto__":{}}'), '__proto__'), true);
});

test('assertObject names what is wrong', () => {
    assert.throws(() => V.assertObject(null, 'pars'), /pars must be an object/);
    assert.throws(() => V.assertObject(3, 'modelSpec'), /modelSpec must be an object/);
    V.assertObject({}, 'pars');
});

test('readNumber: own numeric value, fallback, or an Error naming the parameter', () => {
    assert.equal(V.readNumber({ radius: 40 }, 'radius', 50), 40);
    assert.equal(V.readNumber({}, 'radius', 50), 50);
    assert.equal(V.readNumber({}, 'toString', 7), 7);
    assert.throws(() => V.readNumber({ radius: '40' }, 'radius', 50), /Parameter radius must be a number, got string/);
    assert.throws(() => V.readNumber({ radius: null }, 'radius', 50), /Parameter radius must be a number, got object/);
    assert.ok(Number.isNaN(V.readNumber({ radius: NaN }, 'radius', 50)), 'NaN is a number; the model output shows it');
});

test('readFinite rejects NaN and infinities by name', () => {
    assert.equal(V.readFinite({ radius_pd: 0.2 }, 'radius_pd', 0), 0.2);
    assert.equal(V.readFinite({}, 'radius_pd', 0), 0);
    [NaN, Infinity, -Infinity].forEach((v) => {
        assert.throws(() => V.readFinite({ radius_pd: v }, 'radius_pd', 0),
            new RegExp('Parameter radius_pd must be a finite number, got ' + v));
    });
    assert.throws(() => V.readFinite({ radius_pd: '0.2' }, 'radius_pd', 0), /radius_pd must be a number/);
});

test('readPdCount: any finite number up to MAX_PD_POINTS after truncation, returned as given', () => {
    assert.equal(V.readPdCount({}, 'radius_pd_n', 0), 0);
    // int() happens in SasFitWeights, as in sasmodels; 0.5 is not "== 0" there (direct_model.py:143)
    [0, 0.5, 3.7, 35, 1000, 1000.9, -5].forEach((n) => {
        assert.equal(V.readPdCount({ radius_pd_n: n }, 'radius_pd_n', 0), n);
    });
    [1001, 1e9, 1e300].forEach((n) => {
        assert.throws(() => V.readPdCount({ radius_pd_n: n }, 'radius_pd_n', 0),
            (err) => err.message === 'Parameter radius_pd_n must be a finite number of points, at most 1000, got ' + n);
    });
    [NaN, Infinity, -Infinity].forEach((n) => {
        assert.throws(() => V.readPdCount({ radius_pd_n: n }, 'radius_pd_n', 0),
            /Parameter radius_pd_n must be a finite number of points, at most 1000, got /);
    });
    assert.throws(() => V.readPdCount({ radius_pd_n: '35' }, 'radius_pd_n', 0), /radius_pd_n must be a number/);
});

test('checkQ: a Float64Array of 1..MAX_Q_POINTS points, checked without scanning it', () => {
    V.checkQ(new Float64Array(1));
    V.checkQ(Float64Array.from([0.01, NaN]));   // values are not inspected (hot path)
    assert.throws(() => V.checkQ([0.01, 0.02]), /q must be a Float64Array, got Array/);
    assert.throws(() => V.checkQ('q'), /q must be a Float64Array, got string/);
    assert.throws(() => V.checkQ(null), /q must be a Float64Array, got null/);
    assert.throws(() => V.checkQ(new Float32Array(3)), /q must be a Float64Array, got Float32Array/);
    assert.throws(() => V.checkQ(new Float64Array(0)), /q must have 1\.\.1000000 points, got 0/);
    // one 8 MB zero-filled buffer, shared with the at-the-limit view below
    const big = new Float64Array(V.MAX_Q_POINTS + 1);
    assert.throws(() => V.checkQ(big), /q must have 1\.\.1000000 points, got 1000001/);
    V.checkQ(big.subarray(1));
});

test('assertEvalPoints: the product of the mesh lengths as a double, at most MAX_EVAL_POINTS', () => {
    V.assertEvalPoints('cylinder', ['radius', 'length'], [1000, 1000]);
    V.assertEvalPoints('sphere', ['sld', 'radius'], [1, 80]);
    assert.throws(() => V.assertEvalPoints('cylinder', ['sld', 'radius', 'length'], [1, 1000, 1001]),
        (err) => err.message === 'Polydispersity mesh of cylinder has 1001000 points '
            + '(radius 1000 x length 1001), the limit is 1000000');
    // far beyond int32: the product must not wrap
    assert.throws(() => V.assertEvalPoints('m', ['a', 'b', 'c', 'd', 'e'], [1000, 1000, 1000, 1000, 1000]),
        /has 1000000000000000 points \(a 1000 x b 1000 x c 1000 x d 1000 x e 1000\), the limit is 1000000/);
});

test('readCutoff: required without a fallback, defaulted with one', () => {
    assert.equal(V.readCutoff({ cutoff: 0 }), 0);
    assert.equal(V.readCutoff({ cutoff: 1e-4 }, 1e-5), 1e-4);
    [undefined, null, {}, { cutoff: undefined }].forEach((opts) => {
        assert.equal(V.readCutoff(opts, 1e-5), 1e-5);
        assert.throws(() => V.readCutoff(opts), /cutoff is required and must be a finite number >= 0, got undefined/);
    });
    [-1, NaN, Infinity, '1e-5', null].forEach((cutoff) => {
        assert.throws(() => V.readCutoff({ cutoff }), /cutoff is required and must be a finite number >= 0, got /);
        assert.throws(() => V.readCutoff({ cutoff }, 1e-5), /^Error: cutoff must be a finite number >= 0, got /);
    });
});

test('pd names exist only for polydisperse (volume / orientation) parameters', () => {
    const cylinder = SasFitMeta.models.cylinder;
    const byName = Object.fromEntries(cylinder.params.map((p) => [p.name, p]));
    assert.equal(V.isPolydisperse(byName.radius), true);
    assert.equal(V.isPolydisperse(byName.theta), true);
    assert.equal(V.isPolydisperse(byName.sld), false);
    assert.deepEqual(V.pdNames(byName.radius), ['radius_pd', 'radius_pd_n', 'radius_pd_nsigma', 'radius_pd_type']);
    assert.deepEqual(V.pdNames(byName.sld), []);
    const known = V.knownNames(cylinder);
    assert.deepEqual([...known].filter((n) => !/_pd/.test(n)),
        ['scale', 'background', 'sld', 'sld_solvent', 'radius', 'length', 'theta', 'phi']);
    assert.ok(known.has('length_pd_type') && known.has('theta_pd_n') && !known.has('sld_pd'));
    assert.deepEqual([...V.knownNames(SasFitMeta.models.power_law)], ['scale', 'background', 'power']);
});

test('assertNoUnusedPars names the model and every unknown own key', () => {
    const known = V.knownNames(SasFitMeta.models.sphere);
    V.assertNoUnusedPars('sphere', { radius: 1, radius_pd_n: 3 }, known);
    assert.throws(() => V.assertNoUnusedPars('sphere', { radus: 1, nope: 2 }, known),
        /Unused parameters in call to sphere: radus, nope/);
    assert.throws(() => V.assertNoUnusedPars('sphere', { constructor: 1 }, known), /constructor/);
    assert.throws(() => V.assertNoUnusedPars('sphere', JSON.parse('{"__proto__":{}}'), known), /__proto__/);
    V.assertNoUnusedPars('a@b', { x: 1 }, new Map([['x', 'p']]));
});

test('sasfit-validate.js has no browser or Node I/O dependencies', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-validate.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['window', 'document', 'fetch', 'require', 'XMLHttpRequest']) {
        assert.ok(!new RegExp('\\b' + banned + '\\b').test(code), banned);
    }
    assert.ok(src.split('\n').length <= 800);
});
