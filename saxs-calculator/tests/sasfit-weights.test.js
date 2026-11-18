'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitWeights } = require('./load.js');
const { loadFixture, num, assertClose } = require('./sasfit-helpers.js');

const fx = loadFixture('weights');

test('weights fixture has the expected sections', () => {
    assert.equal(fx.cases.length, 34);
    assert.equal(fx.gammaln.length, 13);
});

fx.cases.forEach((c) => {
    test('getWeights matches sasmodels: ' + c.label, () => {
        const got = SasFitWeights.getWeights(
            c.type, c.center, c.width, c.npts, c.nsigmas, num(c.lower), num(c.upper), c.relative);
        assertClose(got.x, c.x, c.label + ' x');
        assertClose(got.w, c.w, c.label + ' w');
    });
});

test('gammaln matches scipy.special.gammaln', () => {
    const got = fx.gammaln.map((p) => SasFitWeights.gammaln(p.z));
    assertClose(got, fx.gammaln.map((p) => p.gammaln), 'gammaln');
});

test('DEFAULTS equal the sasmodels class defaults', () => {
    assert.deepEqual(SasFitWeights.DEFAULTS, {
        gaussian: { npts: 35, width: 0, nsigmas: 3 },
        rectangle: { npts: 35, width: 0, nsigmas: 1.73205 },
        uniform: { npts: 35, width: 0, nsigmas: null },
        lognormal: { npts: 80, width: 0, nsigmas: 8 },
        schulz: { npts: 80, width: 0, nsigmas: 8 },
        boltzmann: { npts: 35, width: 0, nsigmas: 3 },
    });
});

test('unknown distribution name throws an Error naming it', () => {
    assert.throws(() => SasFitWeights.getWeights('nope', 50, 0.1, 35, 3, 0, Infinity, true), /nope/);
    assert.throws(() => SasFitWeights.getWeights('array', 50, 0.1, 35, 3, 0, Infinity, true), /array/);
});

test('missing npts / nsigmas fall back to the class defaults', () => {
    const a = SasFitWeights.getWeights('gaussian', 50, 0.2, undefined, undefined, 0, Infinity, true);
    const b = SasFitWeights.getWeights('gaussian', 50, 0.2, 35, 3, 0, Infinity, true);
    assert.deepEqual(Array.from(a.x), Array.from(b.x));
});

test('npts is truncated like int(); fewer than 2 points is the single point at the centre', () => {
    const at = (npts) => SasFitWeights.getWeights('gaussian', 50, 0.2, npts, 3, 0, Infinity, true);
    assert.deepEqual(at(3.7), at(3));
    assert.equal(at(3.7).x.length, 3);
    [0, 0.5, 1, 1.9, -5].forEach((npts) => {
        assert.deepEqual(Array.from(at(npts).x), [50], 'npts ' + npts);
        assert.deepEqual(Array.from(at(npts).w), [1], 'npts ' + npts);
    });
});

test('non-finite or oversized npts / width / nsigmas throw a clear Error', () => {
    const run = (npts, width, nsigmas) => () =>
        SasFitWeights.getWeights('schulz', 50, width, npts, nsigmas, 0, Infinity, true);
    assert.throws(run(1e9, 0.2, 3), /npts must be a finite number, at most 1000, got 1000000000/);
    assert.throws(run(1001, 0.2, 3), /npts must be a finite number, at most 1000, got 1001/);
    assert.throws(run(NaN, 0.2, 3), /npts must be a finite number, at most 1000, got NaN/);
    assert.throws(run(Infinity, 0.2, 3), /npts must be a finite number, at most 1000, got Infinity/);
    assert.throws(run(80, NaN, 3), /width must be a finite number, got NaN/);
    assert.throws(run(80, Infinity, 3), /width must be a finite number, got Infinity/);
    assert.throws(run(80, 0.2, NaN), /nsigmas must be a finite number, got NaN/);
    assert.throws(run(80, 0.2, -Infinity), /nsigmas must be a finite number, got -Infinity/);
    assert.equal(run(1000, 0.2, 3)().x.length, 1000);
    // uniform has no nsigmas (class default null)
    assert.equal(SasFitWeights.getWeights('uniform', 50, 0.2, 35, null, 0, Infinity, true).x.length, 35);
});
