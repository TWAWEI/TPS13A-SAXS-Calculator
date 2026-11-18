'use strict';
/**
 * sasfit-data-io: bounds on untrusted input (fix pass A): no super-linear
 * regular expression, capped issue lists, early stop past the point limit;
 * the column-count rule of generic files and the 1/nm suspicion rule.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SasFitDataIo: D } = require('./load.js');

const arr = (x) => Array.from(x);
const elapsed = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
const LONG = 80000;
const BUDGET_MS = 100;

test('a token of 80 000 digits is refused in linear time, with a message', () => {
    const text = '0.01 1 0.1\n0.02 ' + '9'.repeat(LONG) + ' 0.1\n0.03 3 0.1\n';
    let r;
    const ms = elapsed(() => { r = D.parse(text, { fileName: 'a.txt' }); });
    assert.ok(ms < BUDGET_MS, ms + ' ms');
    assert.deepEqual(arr(r.dataset.q), [0.01, 0.03]);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].line, 2);
    assert.match(r.issues[0].message, /^數字過長（超過 64 個字元）：「9{40}…」$/);
});

test('digit runs that end in a non-number do not backtrack (number pattern is unambiguous)', () => {
    const bad = '1'.repeat(60) + 'x';                          // within the token limit: reaches the pattern
    const text = Array.from({ length: 2000 }, () => '0.01 ' + bad).join('\n');
    const ms = elapsed(() => D.parse(text, { fileName: 'a.txt' }));
    assert.ok(ms < BUDGET_MS, ms + ' ms');
    const longExp = '1e' + '1'.repeat(LONG);
    assert.ok(elapsed(() => D.parse('0.01 ' + longExp + '\n', {})) < BUDGET_MS);
});

test('an official header line of 80 000 digits (output name, numbers) is read in linear time', () => {
    const digits = '7'.repeat(LONG);
    const text = ['Data Collection Mode : x', digits + '    Output filename', digits + '    Total Frame Numbers',
        digits + 'x    Photon Energy (keV)', ' Single Frame Time : ' + digits, ' Q   I   ERROR', '0.01 1 0.1', '0.02 2 0.1'].join('\n');
    let r;
    const ms = elapsed(() => { r = D.parse(text, { fileName: '' }); });
    assert.ok(ms < BUDGET_MS, ms + ' ms');
    assert.equal(r.dataset.kind, 'official');
    assert.equal(r.dataset.header.totalFrames, null, 'a number longer than the token limit is not a header value');
    assert.equal(r.dataset.header.frameTimeS, null);
    assert.equal(r.dataset.header.energyKeV, null);
    assert.equal(r.dataset.condition, Number('7'.repeat(64)), 'only the last 64 characters of a name are looked at');
});

test('conditionFromName is linear in the length of the name', () => {
    for (const name of ['1'.repeat(LONG) + 'x', '.'.repeat(LONG), '1.'.repeat(LONG / 2) + 'a', 'a'.repeat(LONG) + '_12.dat']) {
        assert.ok(elapsed(() => D.conditionFromName(name)) < BUDGET_MS, name.slice(-8));
    }
    assert.equal(D.conditionFromName('a'.repeat(LONG) + '_12.dat'), 12);
    assert.equal(D.conditionFromName('B1216_1_10.dat'), 10);
    assert.equal(D.conditionFromName('T_-10.dat'), -10);
});

test('issues: at most MAX_ISSUES are kept, issueOverflow counts the rest', () => {
    const bad = Array.from({ length: 130 }, (_, i) => '0.0' + (i + 1) + ' x 1').join('\n');
    const r = D.parse('0.001 1 0.1\n' + bad + '\n0.9 2 0.1\n', { fileName: 'a.txt' });
    assert.equal(r.issues.length, D.LIMITS.MAX_ISSUES);
    assert.equal(r.issueOverflow, 130 - D.LIMITS.MAX_ISSUES);
    assert.deepEqual(arr(r.dataset.q), [0.001, 0.9]);
    assert.equal(D.parse('0.01 1\n0.02 2\n', {}).issueOverflow, 0);
    assert.equal(D.parse('', {}).issueOverflow, 0);
    assert.equal(D.parse(null, {}).issueOverflow, 0);
    const official = ['Data Collection Mode : x', ' Single Frame Time : 2', ' Q I ERROR', '0.01 1 0.1']
        .concat(Array.from({ length: 70 }, () => '0.02 y 1')).join('\n');
    const o = D.parse(official, {});
    assert.equal(o.issues.length, D.LIMITS.MAX_ISSUES);
    assert.equal(o.issueOverflow, 20);
});

test('point limit: reading stops one row past MAX_POINTS (generic and official)', () => {
    const n = D.LIMITS.MAX_POINTS + 5000;
    const rows = Array.from({ length: n }, (_, i) => (i + 1) + ' 1 0.1');
    const g = D.parse(rows.join('\n') + '\nbad row x\n', { fileName: 'big.txt' });
    assert.equal(g.dataset, null);
    assert.deepEqual(g.issues.map((x) => x.message), ['資料點數超過上限 100000 點，未讀完']);
    const o = D.parse(['Data Collection Mode : x', ' Single Frame Time : 2', ' Q I ERROR'].concat(rows).join('\n') + '\n1 x 1\n', {});
    assert.equal(o.dataset, null);
    assert.deepEqual(o.issues.map((x) => x.message), ['資料點數超過上限 100000 點，未讀完']);
    const exact = D.parse(rows.slice(0, D.LIMITS.MAX_POINTS).join('\n'), {});
    assert.equal(exact.dataset.q.length, D.LIMITS.MAX_POINTS);
});

test('generic: the column count comes from the first line whose tokens are all numbers', () => {
    const r = D.parse('17-Nov-2026 lysozyme\n2026 run 3\n0.01 1 0.1\n0.02 2 0.1\n', { fileName: 'a.dat' });
    assert.deepEqual(arr(r.dataset.q), [0.01, 0.02]);
    assert.deepEqual(arr(r.dataset.sigma), [0.1, 0.1]);
    assert.equal(r.issues.length, 0);
    assert.equal(r.notes.skipped, 2);
    const later = D.parse('0.01 1 0.1\n0.02 2\n3 mM NaCl\n0.03 3 0.1\n', {});
    assert.deepEqual(arr(later.dataset.q), [0.01, 0.03], 'after the table has started a bad line is an issue, not a header');
    assert.deepEqual(later.issues.map((x) => x.line), [2, 3]);
    const sep = D.parse('1;2;3;4;5 header\n0.01,1,0.1\n0.02,2,0.2\n', {});
    assert.deepEqual(arr(sep.dataset.I), [1, 2], 'the separator is that of the table, not of the skipped line');
});

test('generic: without any all-numeric line the first candidate decides and its errors are reported', () => {
    const r = D.parse('0,01;1;0,1\n', { fileName: 'a.csv' });
    assert.equal(r.dataset, null);
    assert.match(r.issues[0].message, /^不支援小數逗號/);
    const five = D.parse('1 2 3 4 5\n1 2 3 4 5\n', {});
    assert.equal(five.dataset, null);
    assert.match(five.issues[0].message, /^資料列欄數為 5，需為 2 至 4 欄/);
});

test('1/nm suspicion: max q > 5, or max q > 1 with the smallest positive q > 0.02', () => {
    const flag = (qs, extra) => D.parse(qs.map((q) => q + ' 1 0.1').join('\n'), { fileName: 'a.txt', ...extra }).notes.suspectNm;
    assert.equal(flag([0.05, 2.5, 4.9]), true, 'the usual BioSAXS range in 1/nm');
    assert.equal(flag([0.03, 1.2]), true);
    assert.equal(flag([0.005, 0.3]), false, 'SAXS in 1/Angstrom');
    assert.equal(flag([0.005, 3.0]), false, 'SAXS + WAXS in 1/Angstrom');
    assert.equal(flag([0.05, 0.9]), false);
    assert.equal(flag([0.02, 1.5]), false, 'the limits themselves do not count');
    assert.equal(flag([0.001, 5.1]), true);
    assert.equal(flag([-1, 0, NaN, 0.05, 2.5]), true, 'q <= 0 and non-finite q are not looked at');
    assert.equal(flag([0.05, 2.5, 4.9], { qUnit: 'nm' }), false);
});
