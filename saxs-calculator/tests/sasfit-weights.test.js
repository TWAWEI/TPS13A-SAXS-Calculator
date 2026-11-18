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
