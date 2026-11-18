'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitDataIo: D, SasFitWeighting: W } = require('./load.js');

const DIR = path.join(__dirname, 'fixtures', 'sasfit', 'dat');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const arr = (x) => Array.from(x);
const parse = (name, extra) => D.parse(read(name), { fileName: name, ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), a + ' vs ' + b);

test('module is frozen and exports the interface', () => {
    assert.ok(Object.isFrozen(D));
    assert.deepEqual({ ...D.LIMITS }, { MAX_BYTES: 5 * 1024 * 1024, MAX_POINTS: 100000, MAX_ISSUES_LISTED: 5 });
    assert.ok(Object.isFrozen(D.LIMITS));
    assert.equal(typeof D.parse, 'function');
    assert.equal(typeof D.conditionFromName, 'function');
});

test('official-mini.dat: kind, ten header fields, placeholder, arrays', () => {
    const r = parse('official-mini.dat');
    const ds = r.dataset;
    assert.equal(ds.kind, 'official');
    assert.deepEqual({ ...ds.header }, {
        outputName: 'SYNTH_mini_10', totalFrames: 100, energyKeV: 15, scalingFactor: 1, sampleTransmission: 0.5,
        cellTransmission: 0.8, thicknessMm: 1, sddMm: 3000, qStart: 0.005, frameTimeS: 2,
    });
    assert.equal(ds.q.length, 11);
    assert.equal(r.notes.placeholders, 1);
    assert.ok(ds.q instanceof Float64Array && ds.I instanceof Float64Array && ds.sigma instanceof Float64Array);
    assert.equal(ds.dq, null);
    near(ds.q[0], 0.003); near(ds.I[0], -0.0019020); assert.equal(ds.sigma[0], 0);
    near(ds.q[4], 0.0048); near(ds.I[4], 150); near(ds.sigma[10], 1);
    assert.equal(ds.condition, 10);
    assert.equal(ds.qUnit, 'A');
    assert.equal(r.issues.length, 0);
    assert.equal(r.notes.sorted, false);
});

test('official: LF, TAB-less and merged-file frame time variants give the same result', () => {
    const base = parse('official-mini.dat').dataset;
    const text = read('official-mini.dat');
    const variants = [
        text.replace(/\r\n/g, '\n'),
        text.replace(/\t/g, ' '),
        text.replace('2.000000      sec', '   2.00000'),
    ];
    for (const v of variants) {
        const ds = D.parse(v, { fileName: 'official-mini.dat' }).dataset;
        assert.equal(ds.kind, 'official');
        assert.deepEqual({ ...ds.header }, { ...base.header });
        assert.deepEqual(arr(ds.q), arr(base.q));
        assert.deepEqual(arr(ds.I), arr(base.I));
    }
});

test('official: a real 0 0 0 row is a data point, not a placeholder', () => {
    const text = read('official-mini.dat').replace(/^ +000 +000 +000/m,
        '      0.00000E+00          0.00000E+00              0.00000E+00');
    const r = D.parse(text, { fileName: 'x.dat' });
    assert.equal(r.notes.placeholders, 0);
    assert.equal(r.dataset.q.length, 12);
});

test('official detection: each missing marker falls back to the generic rules', () => {
    const text = read('official-mini.dat');
    const noMode = text.replace('Data Collection Mode', 'Something else');
    const noFrame = text.replace('Single Frame Time:', 'Frame Time is');
    const noTable = text.replace(/\s+Q\s+I\s+ERROR/, '\r\n     Q    Intensity');
    for (const t of [noMode, noFrame, noTable]) {
        const r = D.parse(t, { fileName: 'x.dat' });
        assert.ok(r.dataset === null || r.dataset.kind === 'generic');
    }
    assert.equal(D.parse(noMode, { fileName: 'x.dat' }).notes.placeholders, 0);
});

test('official: an extra parameter echo line after line 25 still counts as official', () => {
    const lines = read('official-mini.dat').split('\r\n');
    lines.splice(25, 0, ' 7.00\t\tExtra echo line');
    const r = D.parse(lines.join('\r\n'), { fileName: 'x.dat' });
    assert.equal(r.dataset.kind, 'official');
    assert.equal(r.dataset.q.length, 11);
    assert.equal(r.dataset.header.frameTimeS, 2);
});

test('official: an unreadable header value becomes null, others still read', () => {
    const text = read('official-mini.dat').replace(' 15.0000 ', ' abc     ');
    const ds = D.parse(text, { fileName: 'x.dat' }).dataset;
    assert.equal(ds.kind, 'official');
    assert.equal(ds.header.energyKeV, null);
    assert.equal(ds.header.qStart, 0.005);
});

test('official: a fourth column is read as dq', () => {
    const lines = read('official-mini.dat').split('\r\n');
    lines[27] = lines[27] + '  0.50000E-03';
    const ds = D.parse(lines.join('\r\n'), { fileName: 'x.dat' }).dataset;
    assert.ok(ds.dq instanceof Float64Array);
    near(ds.dq[0], 0.0005);
    assert.ok(Number.isNaN(ds.dq[1]));
});

test('generic 2 / 3 / 4 columns, three separators, BOM, skipped lines', () => {
    const two = parse('generic-2col.txt');
    assert.equal(two.dataset.kind, 'generic');
    assert.equal(two.dataset.header, null);
    assert.deepEqual(arr(two.dataset.q), [0.01, 0.02, 0.03, 0.04]);
    assert.deepEqual(arr(two.dataset.I), [100, 80, 60.5, 45.25]);
    assert.equal(two.dataset.sigma, null);
    assert.equal(two.dataset.dq, null);
    assert.equal(two.notes.skipped, 4);
    const three = parse('generic-3col.csv').dataset;
    assert.deepEqual(arr(three.sigma), [5, 4, 3]);
    assert.equal(three.dq, null);
    const four = parse('generic-4col.dat').dataset;
    assert.deepEqual(arr(four.sigma), [5, 4, 3]);
    assert.deepEqual(arr(four.dq), [0.001, 0.002, 0.003]);
    assert.equal(parse('generic-2col.txt').issues.length, 0);
});

test('generic: qUnit nm divides q and dq by 10 and leaves I alone; nm suspicion flag', () => {
    const nm = parse('generic-4col.dat', { qUnit: 'nm' }).dataset;
    near(nm.q[2], 0.003); near(nm.dq[2], 0.0003); assert.equal(nm.I[2], 60); assert.equal(nm.qUnit, 'nm');
    assert.equal(parse('generic-nm.txt').notes.suspectNm, true);
    assert.equal(parse('generic-nm.txt', { qUnit: 'nm' }).notes.suspectNm, false);
    assert.equal(parse('generic-3col.csv').notes.suspectNm, false);
    assert.throws(() => D.parse('1 2', { qUnit: 'pm' }), /pm/);
});

test('tokens: strict numbers, D exponent, non-finite words', () => {
    const bad = (line) => D.parse('1 2\n' + line + '\n', {});
    for (const line of ['0x10 5', '1e 5', '1 abc']) {
        const r = bad(line);
        assert.equal(r.dataset.q.length, 1, line);
        assert.equal(r.issues[0].line, 2, line);
    }
    const empty = D.parse('1,2,3\n1,,3\n', {});
    assert.equal(empty.dataset.q.length, 1);
    assert.equal(empty.issues[0].line, 2);
    near(D.parse('1.5D-03 2\n', {}).dataset.q[0], 0.0015);
    const nf = D.parse('1 2\nNaN 3\n-inf 4\n5 6\n', {}).dataset;
    assert.equal(nf.q.length, 4);
    assert.ok(Number.isNaN(nf.q[3]) || Number.isNaN(nf.q[2]));
    assert.ok(nf.q.includes(-Infinity));
});

test('error reporting: line numbers, reasons, null datasets, 40-character quotes', () => {
    const bad = parse('generic-bad.txt');
    assert.deepEqual(bad.issues.map((i) => i.line), [3, 7]);
    assert.match(bad.issues[0].message, /欄數/);
    assert.match(bad.issues[1].message, /abc/);
    assert.equal(bad.dataset.q.length, 6);
    const comma = parse('generic-decimal-comma.txt');
    assert.equal(comma.dataset, null);
    assert.match(comma.issues[0].message, /不支援小數逗號/);
    for (const text of [read('empty.txt'), '# only\n; comments\n', 42, null, undefined]) {
        const r = D.parse(text, { fileName: 'x' });
        assert.equal(r.dataset, null);
        assert.ok(r.issues.length >= 1);
    }
    const long = D.parse('1 2\n1 ' + 'z'.repeat(100) + '\n', {});
    assert.ok(long.issues[0].message.length < 70);
    assert.ok(!long.issues[0].message.includes('z'.repeat(41)));
});

test('point limit: more than MAX_POINTS rows gives no dataset', () => {
    const rows = [];
    for (let i = 0; i <= D.LIMITS.MAX_POINTS; i++) rows.push((i + 1) + ' 1');
    const r = D.parse(rows.join('\n'), {});
    assert.equal(r.dataset, null);
    assert.match(r.issues[0].message, /上限/);
    assert.equal(D.parse(rows.slice(1).join('\n'), {}).dataset.q.length, D.LIMITS.MAX_POINTS);
});

test('sorting: stable by q, non-finite q last, duplicates kept; sorted files untouched', () => {
    const r = parse('generic-unsorted.txt');
    assert.equal(r.notes.sorted, true);
    assert.deepEqual(arr(r.dataset.q.slice(0, 4)), [0.01, 0.02, 0.02, 0.03]);
    assert.deepEqual(arr(r.dataset.I.slice(0, 4)), [10, 20, 21, 30]);
    assert.ok(Number.isNaN(r.dataset.q[4]));
    assert.equal(r.dataset.I[4], 99);
    const ok = parse('generic-3col.csv');
    assert.equal(ok.notes.sorted, false);
    assert.deepEqual(arr(ok.dataset.q), [0.01, 0.02, 0.03]);
});

test('cleaning only flags: I < 0, sigma = 0 and non-finite rows stay in the arrays', () => {
    const r = D.parse('0.01 -5 0\n0.02 inf 1\n0.03 4 nan\n0.04 3 1\n', {});
    assert.equal(r.dataset.q.length, 4);
    assert.equal(r.dataset.I[0], -5);
    assert.equal(r.dataset.sigma[0], 0);
    assert.equal(r.dataset.I[1], Infinity);
});

test('conditionFromName', () => {
    const c = D.conditionFromName;
    assert.equal(c('B1216_1_10.dat'), 10);
    assert.equal(c('T_-5.5.dat'), -5.5);
    assert.equal(c('run-3.dat'), 3);
    assert.equal(c('sample.v2.dat'), 2);
    assert.equal(c('abc.dat'), null);
    assert.equal(c('x_1e3.dat'), 3);
    assert.equal(c(undefined), null);
    assert.equal(D.parse('1 2\n', { fileName: 'B1216_1_10.dat' }).dataset.condition, 10);
    assert.equal(D.parse('1 2\n', { fileName: 'abc.dat' }).dataset.condition, null);
});

test('G5 default range through SasFitWeighting', () => {
    const ds = parse('official-mini.dat').dataset;
    const sigma = W.defaultRange(ds, 'sigma');
    assert.equal(sigma.qMin, 0.005);
    near(sigma.qMax, 0.012);
    assert.ok(W.defaultRange(ds, 'none').qMin >= ds.header.qStart);
    assert.equal(W.defaultMode(ds), 'sigma');
    assert.equal(W.defaultMode(parse('generic-nosigma-zero.txt').dataset), 'none');
});

test('results are frozen and parse is repeatable and does not touch its input', () => {
    const text = read('official-mini.dat');
    const a = D.parse(text, { fileName: 'a.dat' });
    const b = D.parse(text, { fileName: 'a.dat' });
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.dataset) && Object.isFrozen(a.dataset.header));
    assert.ok(Object.isFrozen(a.issues) && Object.isFrozen(a.notes));
    assert.deepEqual(arr(a.dataset.I), arr(b.dataset.I));
    assert.deepEqual({ ...a.dataset.header }, { ...b.dataset.header });
    const bad = parse('generic-bad.txt');
    assert.ok(Object.isFrozen(bad.issues[0]));
});
