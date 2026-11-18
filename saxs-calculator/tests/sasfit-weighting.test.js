'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitWeighting: W } = require('./load.js');

const f64 = (a) => Float64Array.from(a);
const ds = (q, I, sigma, kind, header) => ({
    q: f64(q), I: f64(I), sigma: sigma ? f64(sigma) : null, kind: kind || 'generic', header: header || null,
});
const arr = (x) => Array.from(x);

test('module is frozen and exports the interface', () => {
    assert.ok(Object.isFrozen(W));
    assert.deepEqual(W.MODES, ['sigma', 'sqrtI', 'absI', 'none']);
    for (const n of ['weights', 'mask', 'countExcluded', 'defaultMode', 'defaultRange', 'select']) assert.equal(typeof W[n], 'function', n);
});

test('weights: the four modes of spec 4.8 (12: sqrt|I| and |I| take the absolute value)', () => {
    const d = ds([1, 2, 3, 4], [4, -9, 0, 16], [0.5, 0.25, 2, 8]);
    assert.deepEqual(arr(W.weights(d, 'sigma')), [0.5, 0.25, 2, 8]);
    assert.deepEqual(arr(W.weights(d, 'sqrtI')), [2, 3, 0, 4]);
    assert.deepEqual(arr(W.weights(d, 'absI')), [4, 9, 0, 16]);
    assert.deepEqual(arr(W.weights(d, 'none')), [1, 1, 1, 1]);
    assert.ok(W.weights(d, 'none') instanceof Float64Array);
});

test('weights: sigma mode without sigma, unknown mode, length mismatch all throw naming the value', () => {
    assert.throws(() => W.weights(ds([1], [1], null), 'sigma'), /sigma/);
    assert.throws(() => W.weights(ds([1], [1], null), 'bogus'), /bogus/);
    assert.throws(() => W.weights(ds([1], [1], null), undefined), /undefined/);
    assert.throws(() => W.weights({ q: f64([1, 2]), I: f64([1]), sigma: null }, 'none'), /length/);
    assert.throws(() => W.weights({ q: f64([1]), I: f64([1]), sigma: f64([1, 2]) }, 'sigma'), /length/);
});

// Rows: 0 sigma=0 | 1 sigma<0 | 2 sigma NaN | 3 I=0 | 4 I<0 (sigma ok) | 5 I NaN | 6 q=0 | 7 q<0 | 8 q NaN | 9 q Inf | 10 good
const Q = [1, 1, 1, 1, 1, 1, 0, -1, NaN, Infinity, 1];
const I = [5, 5, 5, 0, -5, NaN, 5, 5, 5, 5, 5];
const S = [0, -1, NaN, 1, 1, 1, 1, 1, 1, 1, 1];
test('mask sigma mode: sigma<=0 or non-finite out; I<0 with sigma>0 stays in (spec 15 row 5); I=0 stays in', () => {
    const m = W.mask(ds(Q, I, S), 'sigma');
    assert.ok(m instanceof Uint8Array);
    // rows: s=0 out, s<0 out, s NaN out, I=0 IN, I<0 IN, I NaN out, q=0 out, q<0 out, q NaN out, q Inf out, good IN
    assert.deepEqual(arr(m), [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1]);
});

test('mask sqrtI / absI: I=0 gives w=0 -> out (spec table); I<0 uses |I| -> in; none: I=0 in', () => {
    const d = ds(Q, I, S);
    // sigma column is irrelevant; I NaN out, q rules unchanged; rows 0,1,2 have I=5 -> in
    const expectW = [1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1];
    assert.deepEqual(arr(W.mask(d, 'sqrtI')), expectW);
    assert.deepEqual(arr(W.mask(d, 'absI')), expectW);
    // none: w=1 everywhere; only I NaN and the q rules exclude
    assert.deepEqual(arr(W.mask(d, 'none')), [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1]);
});

test('defaultMode: sigma when present, else none (spec 4.8: missing sigma -> unweighted)', () => {
    assert.equal(W.defaultMode(ds([1], [1], [1])), 'sigma');
    assert.equal(W.defaultMode(ds([1], [1], null)), 'none');
});

test('defaultMode: an error column without a single usable value (finite, > 0) falls back to none', () => {
    assert.equal(W.defaultMode(ds([1, 2, 3], [1, 1, 1], [0, 0, 0])), 'none');
    assert.equal(W.defaultMode(ds([1, 2, 3], [1, 1, 1], [0, -1, NaN])), 'none');
    assert.equal(W.defaultMode(ds([1, 2], [1, 1], [Infinity, -Infinity])), 'none');
    assert.equal(W.defaultMode(ds([1, 2, 3], [1, 1, 1], [0, NaN, 1e-300])), 'sigma', 'one usable value is enough');
    assert.equal(W.defaultMode({ q: f64([1]), I: f64([1]), sigma: undefined }), 'none');
    assert.equal(W.defaultMode({ q: f64([]), I: f64([]), sigma: f64([]) }), 'none');
    assert.equal(W.defaultMode(null), 'none');
    // the mode it returns always leaves the usable points of that mode to fit
    assert.equal(W.defaultRange(ds([1, 2, 3], [1, 1, 1], [0, 0, 0]), W.defaultMode(ds([1, 2, 3], [1, 1, 1], [0, 0, 0]))).qMin, 1);
});

test('countExcluded: the number of points the mask of each mode leaves out', () => {
    const d = ds(Q, I, S);                               // the 11 rows of the mask tests below
    assert.equal(W.countExcluded(d, 'sigma'), 8);
    assert.equal(W.countExcluded(d, 'sqrtI'), 6);
    assert.equal(W.countExcluded(d, 'absI'), 6);
    assert.equal(W.countExcluded(d, 'none'), 5);
    for (const mode of W.MODES) {
        assert.equal(W.countExcluded(d, mode), arr(W.mask(d, mode)).filter((m) => m === 0).length, mode);
    }
    assert.equal(W.countExcluded(ds([1, 2], [3, 4], [1, 1]), 'sigma'), 0);
    assert.throws(() => W.countExcluded(ds([1], [1], null), 'sigma'), /sigma/);
    assert.throws(() => W.countExcluded(ds([1], [1], null), 'bogus'), /bogus/);
});

test('select and mask agree for every mode (select computes the weights once and reuses them)', () => {
    const d = ds(Q.map((q, i) => (q === 1 ? 1 + i : q)), I, S);
    for (const mode of W.MODES) {
        const m = arr(W.mask(d, mode));
        const s = W.select(d, mode, { qMin: 0, qMax: Infinity });
        assert.deepEqual(arr(s.index), m.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), mode);
        assert.deepEqual(arr(s.w), arr(s.index).map((i) => W.weights(d, mode)[i]), mode);
    }
});

// Official-file-like: first 5 points I<0 and sigma=0 (beamstop region), qStart 0.005 (spec 15 row 4).
const oq = [0.001, 0.002, 0.003, 0.004, 0.0045, 0.006, 0.007, 0.008, 0.009];
const oI = [-1, -1, -1, -1, -1, 3, 2, 1, 0.5];
const oS = [0, 0, 0, 0, 0, 0.3, 0.2, 0.1, 0.05];
test('defaultRange: qMin = max(qStart, first usable q) -- sigma mode, usable starts at 0.006 > qStart', () => {
    const d = ds(oq, oI, oS, 'official', { qStart: 0.005 });
    assert.deepEqual(W.defaultRange(d, 'sigma'), { qMin: 0.006, qMax: 0.009 });
});

test('defaultRange: none mode, first usable point 0.001 < qStart -> qMin = qStart (spec 15 row 4)', () => {
    const d = ds(oq, oI, oS, 'official', { qStart: 0.005 });
    assert.deepEqual(W.defaultRange(d, 'none'), { qMin: 0.005, qMax: 0.009 });
});

test('defaultRange: generic kind ignores header.qStart; bad qStart (0, negative, NaN, string) ignored', () => {
    const g = ds(oq, oI, oS, 'generic', { qStart: 0.005 });
    assert.deepEqual(W.defaultRange(g, 'none'), { qMin: 0.001, qMax: 0.009 });
    for (const bad of [0, -0.005, NaN, Infinity, '0.005', null]) {
        const d = ds(oq, oI, oS, 'official', { qStart: bad });
        assert.deepEqual(W.defaultRange(d, 'none'), { qMin: 0.001, qMax: 0.009 }, String(bad));
    }
    assert.deepEqual(W.defaultRange(ds(oq, oI, oS, 'official', null), 'none'), { qMin: 0.001, qMax: 0.009 });
});

test('defaultRange: qMax is the last usable point (trailing sigma=0 point excluded)', () => {
    const d = ds([1, 2, 3, 4], [1, 1, 1, 1], [1, 1, 1, 0]);
    assert.deepEqual(W.defaultRange(d, 'sigma'), { qMin: 1, qMax: 3 });
});

test('defaultRange: nothing usable -> null; qStart beyond the last usable q -> null (empty range)', () => {
    assert.equal(W.defaultRange(ds([1, 2], [1, 1], [0, 0]), 'sigma'), null);
    assert.equal(W.defaultRange(ds([1, 2], [1, 1], [1, 1], 'official', { qStart: 5 }), 'sigma'), null);
    // qStart equal to the last usable q: a single-point range, inclusive
    assert.deepEqual(W.defaultRange(ds([1, 2], [1, 1], [1, 1], 'official', { qStart: 2 }), 'sigma'), { qMin: 2, qMax: 2 });
});

test('select: usable points inside [qMin, qMax], bounds inclusive; index into the original data', () => {
    const d = ds([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [4, 9, -1, 16, 25, 36], [1, 0, 2, 4, NaN, 6]);
    const s = W.select(d, 'sigma', { qMin: 0.2, qMax: 0.6 });
    // point 0 below range; point 1 sigma=0 out; point 4 sigma NaN out; 2,3,5 in (point 2 has I<0, still in); 0.6 = qMax in
    assert.deepEqual(arr(s.index), [2, 3, 5]);
    assert.deepEqual(arr(s.q), [0.3, 0.4, 0.6]);
    assert.deepEqual(arr(s.I), [-1, 16, 36]);
    assert.deepEqual(arr(s.w), [2, 4, 6]);
    assert.ok(s.index instanceof Uint32Array && s.q instanceof Float64Array);
    // lower bound inclusive too
    assert.deepEqual(arr(W.select(d, 'none', { qMin: 0.3, qMax: 0.3 }).index), [2]);
});

test('select: sqrtI weights are sqrt|I|; empty selection gives empty arrays; bad mode / sigma null throw', () => {
    const d = ds([1, 2, 3], [4, -9, 0], null);
    const s = W.select(d, 'sqrtI', { qMin: 0, qMax: 10 });
    assert.deepEqual(arr(s.index), [0, 1]);   // I=0 point excluded
    assert.deepEqual(arr(s.w), [2, 3]);
    assert.equal(W.select(d, 'none', { qMin: 5, qMax: 6 }).index.length, 0);
    assert.throws(() => W.select(d, 'sigma', { qMin: 0, qMax: 10 }), /sigma/);
    assert.throws(() => W.select(d, 'weird', { qMin: 0, qMax: 10 }), /weird/);
    assert.throws(() => W.select(d, 'none', { qMin: 3, qMax: 1 }), /range/);
    assert.throws(() => W.select(d, 'none', null), /range/);
});

test('inputs are never mutated; outputs are fresh allocations', () => {
    const d = ds([1, 2, 3], [4, 5, 6], [1, 1, 1], 'official', { qStart: 1 });
    const snap = JSON.stringify([arr(d.q), arr(d.I), arr(d.sigma), d.header]);
    const s = W.select(d, 'none', { qMin: 1, qMax: 3 });
    const w = W.weights(d, 'sigma');
    W.mask(d, 'sigma'); W.defaultRange(d, 'sigma');
    assert.equal(JSON.stringify([arr(d.q), arr(d.I), arr(d.sigma), d.header]), snap);
    assert.notEqual(s.q.buffer, d.q.buffer);
    assert.notEqual(w.buffer, d.sigma.buffer);
    s.q[0] = 99; w[0] = 99;
    assert.equal(d.q[0], 1); assert.equal(d.sigma[0], 1);
    const range = { qMin: 1, qMax: 3 };
    W.select(d, 'none', range);
    assert.deepEqual(range, { qMin: 1, qMax: 3 });
});
