'use strict';
/**
 * sasfit-export.js（M4 Task 13）：匯出的數字、CSV 儲存格、註解列、檔名、由 FitResult 取參數列、擬合曲線 CSV、
 * data URL → 位元組。
 *
 * 黃金字串（FIT_CSV_GOLDEN）是完整的期望輸出：改輸出格式必須同時改這裡，並在 commit 訊息說明。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitExport: E, SasFitMeta, SasFitWeighting, SasFitDataIo, SasFitWorkerClient } = require('./load.js');
const h = require('./sasfit-export-helpers.js');

const SOFTWARE = 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9';
const READ_LINE = '# UTF-8 with BOM; comment lines start with "# "; read with numpy.genfromtxt(f, delimiter=",", comments="#", '
    + 'encoding="utf-8-sig") (first row = column names -> nan) or pandas.read_csv(f, comment="#")';
const FIT_CSV_GOLDEN = [
    '# SAS model fit: data, fitted curve and residuals',
    READ_LINE,
    '# software: sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9',
    '# data_file: SYNTH_tiny.dat',
    '# units: q in 1/Ang; I, sigma and I_model in the units of the data file',
    '# model: sphere',
    '# weighting: sigma',
    '# q_range: 0.015 to 0.05 1/Ang',
    '# points_fitted: 4',
    '# dof: 2',
    '# chi2: 4.5',
    '# chi2r: 2.25',
    '# status: converged',
    '# iterations: 6',
    '# errors: not scaled',
    '# param scale = 0.98 +/- 0.012 (fitted)',
    '# param background = 0.001 (fixed)',
    '# param sld = 1 1e-6/Ang^2 (fixed)',
    '# param sld_solvent = 6 1e-6/Ang^2 (fixed)',
    '# param radius = 50.0123456789 +/- 0.125 Ang (fitted)',
    'q,I,sigma,I_model,residual,in_fit',
    '0.01,10,0.5,10.5,,0',
    '0.02,8,0.25,8.25,-1,1',
    '0.03,6,0.125,5.875,1,1',
    '0.04,4,0.0625,4.125,-2,1',
    '0.05,2.5,0.5,2.75,-0.5,1',
    '',
].join('\n');

const csvOf = (fitResult, file = h.file()) => E.fitCsv({ file, fitResult, software: SOFTWARE });
const deepFrozenCopy = (value) => JSON.stringify(value, (key, v) => (ArrayBuffer.isView(v) ? Array.from(v, String) : v));

// ---------------------------------------------------------------- num 與 cell
test('[sasfit-export] num：String(x) 的最短可讀回表示；非有限值與非數字是空字串；-0 寫成 0', () => {
    assert.equal(E.num(50.0123456789), '50.0123456789');
    assert.equal(E.num(0.1 + 0.2), '0.30000000000000004');
    assert.equal(E.num(1e21), '1e+21');
    assert.equal(E.num(5e-324), '5e-324');
    assert.equal(E.num(-1e-5), '-0.00001');
    assert.equal(E.num(-0), '0');
    assert.equal(E.num(0), '0');
    [NaN, Infinity, -Infinity, null, undefined, '1', {}, true].forEach((x) => assert.equal(E.num(x), '', String(x)));
    [1e-300, 5e-324, 0.1 + 0.2, 1e21, 123456789.123456789, -2.5e-7].forEach((x) => assert.ok(Object.is(Number(E.num(x)), x), String(x)));
});

test('[sasfit-export] num 與語系無關：小數點一定是「.」、沒有千分位', () => {
    const original = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = () => '1.234,5';          // eslint-disable-line no-extend-native
    try {
        assert.equal(E.num(1234.5), '1234.5');
        assert.equal(E.cell(1234.5), '1234.5');
    } finally {
        Number.prototype.toLocaleString = original;             // eslint-disable-line no-extend-native
    }
});

test('[sasfit-export] cell：RFC 4180 引號', () => {
    assert.equal(E.cell('plain'), 'plain');
    assert.equal(E.cell('a,b'), '"a,b"');
    assert.equal(E.cell('he said "x"'), '"he said ""x"""');
    assert.equal(E.cell('two\nlines'), '"two\nlines"');
    assert.equal(E.cell('cr\rhere'), '"cr\rhere"');
    assert.equal(E.cell('中文 檔名'), '中文 檔名');
    [null, undefined, NaN, Infinity].forEach((v) => assert.equal(E.cell(v), '', String(v)));
});

test('[sasfit-export] cell：文字型以 = + - @ TAB CR 開頭時前置單引號；數字型不處理（負數仍是數字）', () => {
    assert.equal(E.cell('=1+1'), "'=1+1");
    assert.equal(E.cell('+1'), "'+1");
    assert.equal(E.cell('-1'), "'-1");
    assert.equal(E.cell('@x'), "'@x");
    assert.equal(E.cell('\t=1'), "'\t=1");
    assert.equal(E.cell('\r=1'), '"\'\r=1"');
    assert.equal(E.cell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
    assert.equal(E.cell(-1), '-1');
    assert.equal(E.cell(-1e-5), '-0.00001');
    assert.equal(E.cell('a=1'), 'a=1');
});

// ---------------------------------------------------------------- 註解列
test('[sasfit-export] commentLine：以「# 」開頭、不加引號；逗號、分號、引號與控制字元換成底線', () => {
    assert.equal(E.commentLine('data_file', 'a.dat'), '# data_file: a.dat');
    const line = E.commentLine('data_file', 'a,=HYPERLINK("x").dat');
    assert.equal(line, '# data_file: a_=HYPERLINK(_x_).dat');
    assert.doesNotMatch(line, /[,"]/);
    assert.equal(E.commentLine('k', 'a;b\tc\r\nd\u0000e\u2028f'), '# k: a_b_c__d_e_f');
    assert.equal(E.commentLine('n', 1.5), '# n: 1.5');
    assert.equal(E.commentLine('n', NaN), '# n: ');
    assert.equal(E.commentLine('n', null), '# n: ');
});

test('[sasfit-export] fitCsv：檔名裡的逗號、公式與換行不會讓註解列多出儲存格或多出一行', () => {
    const csv = csvOf(h.sphereResult(), h.file(h.dataset(), 'a,=HYPERLINK("x")\n=cmd.dat'));
    const { comments, rows } = h.splitCsv(csv);
    assert.ok(comments.includes('# data_file: a_=HYPERLINK(_x_)_=cmd.dat'));
    comments.forEach((line) => assert.match(line, /^# /));
    assert.equal(rows.length, 5);
    assert.equal(csv.split('\n').filter((line) => line !== '' && !line.startsWith('# ')).length, 6);       // 表頭＋5 列
});

// ---------------------------------------------------------------- 檔名
test('[sasfit-export] safeName：路徑、副檔名、不安全字元、保留名、頭尾的點與空白', () => {
    assert.equal(E.safeName('../../etc/passwd', 'FB'), 'passwd');
    assert.equal(E.safeName('C:\\data\\a.dat', 'FB'), 'a');
    assert.equal(E.safeName('con.dat', 'FB'), '_con');
    assert.equal(E.safeName('COM1', 'FB'), '_COM1');
    assert.equal(E.safeName('lpt9.x.dat', 'FB'), '_lpt9.x');
    assert.equal(E.safeName('console.dat', 'FB'), 'console');
    assert.equal(E.safeName('  .hidden. ', 'FB'), 'hidden');
    assert.equal(E.safeName('a\u202Egpj.dat', 'FB'), 'a_gpj');
    assert.equal(E.safeName('a\u0000b', 'FB'), 'a_b');
    assert.equal(E.safeName('a:b*c?d"e<f>g|h.txt', 'FB'), 'a_b_c_d_e_f_g_h');
    assert.equal(E.safeName('', 'FB'), 'FB');
    assert.equal(E.safeName('...', 'FB'), 'FB');
    assert.equal(E.safeName(' . . ', 'FB'), 'FB');
    assert.equal(E.safeName(undefined, 'FB'), 'FB');
    assert.equal(E.safeName(42, 'FB'), 'FB');
});

test('[sasfit-export] safeName：中文、@、+ 與數字裡的小數點保留；NFC 正規化', () => {
    assert.equal(E.safeName('樣品 1.5 mg@25°C+鹽.dat', 'FB'), '樣品 1.5 mg@25°C+鹽');
    assert.equal(E.safeName('B1216_1.5', 'FB'), 'B1216_1.5');                 // 「.5」不是副檔名（副檔名以字母開頭）
    assert.equal(E.safeName('e\u0301.dat', 'FB'), '\u00E9');
    assert.equal(E.safeName('name.tar.gz', 'FB'), 'name.tar');
});

test('[sasfit-export] safeName：以 UTF-8 位元組計上限 120，在碼位邊界截斷，截斷後再去尾端的點與空白', () => {
    const bytes = (s) => Buffer.byteLength(s, 'utf8');
    assert.equal(E.NAME_MAX_BYTES, 120);
    assert.equal(E.safeName('x'.repeat(300), 'FB'), 'x'.repeat(120));
    const cjk = E.safeName('中'.repeat(100), 'FB');
    assert.equal(cjk, '中'.repeat(40));
    assert.equal(bytes(cjk), 120);
    assert.equal(E.safeName('a'.repeat(119) + '.b.dat', 'FB'), 'a'.repeat(119));       // 截斷處剛好是「.」
    assert.equal(E.safeName('a'.repeat(118) + '  bcd', 'FB'), 'a'.repeat(118));
    const emoji = E.safeName('😀'.repeat(40) + '.txt', 'FB');
    assert.equal(emoji, '😀'.repeat(30));
    assert.equal(bytes(emoji), 120);
    assert.equal(E.safeName('中'.repeat(39) + 'ab😀', 'FB'), '中'.repeat(39) + 'ab');     // 不留半個代理對
    assert.equal(E.safeName('a\uD800b.dat', 'FB'), 'a_b');                              // 落單的代理碼位
    ['x'.repeat(300), '中'.repeat(100), '😀'.repeat(40), '\u202E'.repeat(200), '/'.repeat(10) + 'é'.repeat(200)].forEach((name) => {
        const safe = E.safeName(name, 'FB');
        assert.ok(bytes(safe) <= 120, name.slice(0, 5));
        assert.doesNotMatch(safe, /[\\/]/);
        assert.equal(safe, safe.normalize('NFC'));
        assert.ok(safe.isWellFormed());
    });
});

test('[sasfit-export] modelText 與 fileName 的每一種 kind', () => {
    const plain = { model: 'sphere', structure: null, lowQPowerLaw: false };
    const full = { model: 'core_shell_sphere', structure: 'hardsphere', lowQPowerLaw: true };
    assert.equal(E.modelText(plain), 'sphere');
    assert.equal(E.modelText(full), 'core_shell_sphere@hardsphere+power_law');
    assert.equal(E.modelText({ model: 'a/b', structure: '..\\x', lowQPowerLaw: false }), 'a_b@___x');
    assert.throws(() => E.modelText(null), /model spec/);
    const info = { dataName: 'dir/SYNTH_sphere_10.dat', modelSpec: full, conditionName: '濃度 (mg/mL)' };
    assert.equal(E.fileName('fit', info), 'SYNTH_sphere_10_core_shell_sphere@hardsphere+power_law_fit.csv');
    assert.equal(E.fileName('report', info), 'SYNTH_sphere_10_core_shell_sphere@hardsphere+power_law_report.txt');
    assert.equal(E.fileName('sequence', info), '濃度 (mg_mL)_sequence.csv');
    assert.equal(E.fileName('png-main', { ...info, modelSpec: plain }), 'SYNTH_sphere_10_sphere_main.png');
    assert.equal(E.fileName('png-residual', { ...info, modelSpec: plain }), 'SYNTH_sphere_10_sphere_residual.png');
    assert.equal(E.fileName('png-shape', { ...info, modelSpec: plain }), 'SYNTH_sphere_10_sphere_shape.png');
    assert.equal(E.fileName('png-trend', info), '濃度 (mg_mL)_trend.png');
    assert.equal(E.fileName('png-shape', { dataName: '', modelSpec: plain }), 'sasfit_sphere_shape.png');
    assert.equal(E.fileName('sequence', { conditionName: ' ' }), 'condition_sequence.csv');
    assert.equal(E.safeLabel('濃度 (mg/mL) v1.5', 'FB'), '濃度 (mg_mL) v1.5');          // 標籤不是路徑：斜線換掉、不去副檔名
    assert.equal(E.safeLabel('..\\..\\con', 'FB'), '_.._con');
    assert.equal(E.safeLabel('nul', 'FB'), '_nul');
    assert.throws(() => E.fileName('zip', info), /Unknown export file kind/);
    ['fit', 'report', 'sequence', 'png-main', 'png-residual', 'png-shape', 'png-trend'].forEach((kind) => {
        assert.doesNotMatch(E.fileName(kind, { dataName: '../../x/..\\evil', modelSpec: plain, conditionName: '..\\..\\c' }), /[\\/]/);
    });
});

test('[sasfit-export] software：含頁面版本與 sasmodels 版本；沒有版本就丟 Error（不輸出 vnull）', () => {
    assert.equal(E.software('9.9'), SOFTWARE);
    assert.ok(E.software('9.9').includes(SasFitMeta.sasmodelsVersion));
    [undefined, null, '', ' ', 5.2, 'a b', '1,2', '9.9\n# x'].forEach((v) => assert.throws(() => E.software(v), /page version/, String(v)));
    assert.equal(SasFitWorkerClient.scriptVersion, null);            // Node 裡沒有 ?v=：呼叫端必須處理 null
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-export.js'), 'utf8');
    assert.doesNotMatch(source, /v\d+\.\d+/, '原始碼不得寫死版本');
});

// ---------------------------------------------------------------- paramRows
test('[sasfit-export] paramRows：sphere（擬合 scale、radius）→ 5 列，順序同參數表，fitted 與誤差正確', () => {
    const rows = E.paramRows(h.sphereResult(), null);
    assert.deepEqual(rows.map((r) => r.name), ['scale', 'background', 'sld', 'sld_solvent', 'radius']);
    assert.deepEqual(rows.map((r) => r.fitted), [true, false, false, false, true]);
    assert.deepEqual(rows.map((r) => r.unit), ['', '', '1e-6/Ang^2', '1e-6/Ang^2', 'Ang']);
    const radius = rows[4];
    assert.deepEqual({ ...radius }, {
        name: 'radius', value: 50.0123456789, error: 0.125, errorScaled: 0.1875, errorShown: 0.125, unit: 'Ang', fitted: true,
        atBound: null, lower: null, upper: null, pd: null,
    });
    const fixed = rows[1];
    assert.deepEqual([fixed.error, fixed.errorScaled, fixed.errorShown], [null, null, null]);
    assert.ok(Object.isFrozen(rows) && rows.every(Object.isFrozen));
    assert.equal(E.paramRows.length, 3, '簽名是 (fitResult, bounds, options)：不需要表單');
});

test('[sasfit-export] paramRows：權重不是 σ 時 errorShown 是已乘的；貼上限；上下限由呼叫端傳入；官方檔的 background 單位', () => {
    const none = E.paramRows(h.sphereResult({ weighting: 'none', chi2r: 4 }), null);
    assert.equal(none[4].error, 0.125);
    assert.equal(none[4].errorScaled, 0.25);
    assert.equal(none[4].errorShown, 0.25);
    const bound = E.paramRows(h.sphereResult({ atUpper: true }), { radius: [0, 60], scale: [0, Infinity] }, { absolute: true });
    assert.equal(bound[4].atBound, 'upper');
    assert.deepEqual([bound[4].lower, bound[4].upper], [0, 60]);
    assert.deepEqual([bound[0].lower, bound[0].upper], [0, Infinity]);
    assert.deepEqual([bound[1].lower, bound[1].upper], [null, null]);
    assert.equal(bound[1].unit, '1/cm');
});

test('[sasfit-export] paramRows：core_shell_sphere@hardsphere＋radius_pd 擬合 → 有 radius_pd 一列，設定取自 params', () => {
    const rows = E.paramRows(h.coreShellResult(), null);
    assert.deepEqual(rows.map((r) => r.name),
        ['scale', 'background', 'radius', 'radius_pd', 'thickness', 'sld_core', 'sld_shell', 'sld_solvent', 'volfraction']);
    const width = rows[3];
    assert.equal(width.fitted, true);
    assert.equal(width.value, 0.1);
    assert.deepEqual({ ...width.pd }, { type: 'schulz', npts: 80, nsigmas: 3 });
    assert.equal(rows[2].pd, null);
    // 由模型決定的 radius_effective、兩個模式參數與 _pd_n／_pd_nsigma／_pd_type 都不是列
    assert.ok(rows.every((r) => !/radius_effective|_mode$|_pd_/.test(r.name)));
    const uniform = h.coreShellResult();
    const params = { ...uniform.params, radius_pd_type: 'uniform' };
    assert.equal(E.paramRows({ ...uniform, params }, null)[3].pd.nsigmas, null);
});

test('[sasfit-export] paramRows：低 q 冪律與 hayter_msa 的列；有效半徑不由模型決定時是一列', () => {
    const rows = E.paramRows(h.coreShellResult({ structure: 'hayter_msa', lowQ: true }), null).map((r) => r.name);
    assert.deepEqual(rows.slice(-7), ['volfraction', 'charge', 'temperature', 'concentration_salt', 'dielectconst', 'lowq_scale', 'lowq_power']);
    const free = h.coreShellResult();
    const params = { ...free.params, radius_effective_mode: 0, radius_effective: 70 };
    assert.ok(E.paramRows({ ...free, params }, null).some((r) => r.name === 'radius_effective' && r.value === 70));
    assert.equal(E.radiusModeText({ ...free, params }), 'unconstrained (radius_effective is a parameter)');
});

test('[sasfit-export] combinationText／radiusModeText：取自結果的兩個模式參數', () => {
    assert.equal(E.combinationText(h.sphereResult()), null);
    assert.equal(E.radiusModeText(h.sphereResult()), null);
    assert.equal(E.combinationText(h.coreShellResult()), 'P*S');
    assert.equal(E.combinationText(h.coreShellResult({ beta: true })), 'P*(1+beta*(S-1))');
    assert.equal(E.radiusModeText(h.coreShellResult()), 'outer radius');
});

// ---------------------------------------------------------------- inFit 與 fitCsv
test('[sasfit-export] fitCsv：黃金字串', () => {
    assert.equal(csvOf(h.sphereResult()), FIT_CSV_GOLDEN);
});

test('[sasfit-export] fitCsv：來回一致——q、I、sigma、I_model 讀回後逐元素 Object.is 相同', () => {
    const special = h.dataset({
        I: Float64Array.of(1e-300, 5e-324, 0.1 + 0.2, 1e21, -0), sigma: Float64Array.of(0.1 + 0.7, 1e-17, 3, 1 / 3, 2),
    });
    const result = { ...h.sphereResult(), curve: Float64Array.of(Math.PI, 1e-310, -1.5e300, 2 / 3, 7) };
    const { header, rows } = h.splitCsv(csvOf(result, h.file(special)));
    assert.deepEqual(header, ['q', 'I', 'sigma', 'I_model', 'residual', 'in_fit']);
    assert.equal(rows.length, 5);
    rows.forEach((row, i) => {
        assert.equal(row.length, 6);
        assert.ok(Object.is(Number(row[0]), special.q[i]), 'q ' + i);
        if (i < 4) assert.ok(Object.is(Number(row[1]), special.I[i]), 'I ' + i);
        assert.ok(Object.is(Number(row[2]), special.sigma[i]), 'sigma ' + i);
        assert.ok(Object.is(Number(row[3]), result.curve[i]), 'I_model ' + i);
    });
    assert.equal(rows[4][1], '0');
    assert.equal(Number(rows[4][1]) === 0, true);                   // -0 讀回是 0（符號不保留）
    assert.equal(rows[0][4], '');                                   // 未參與的點：殘差 NaN ↔ 空字串
    assert.ok(Object.is(Number(rows[1][4]), result.residuals[1]));
});

test('[sasfit-export] fitCsv：沒有 σ 欄的檔 sigma 欄是空的；曲線的非有限值是空的', () => {
    const noSigma = h.dataset({ sigma: null });
    const result = { ...h.sphereResult({ weighting: 'none', data: noSigma }), curve: Float64Array.of(1, NaN, Infinity, 4, 5) };
    const { rows } = h.splitCsv(csvOf(result, h.file(noSigma)));
    assert.deepEqual(rows.map((r) => r[2]), ['', '', '', '', '']);
    assert.deepEqual(rows.map((r) => r[3]), ['1', '', '', '4', '5']);
});

test('[sasfit-export] in_fit 等於 SasFitWeighting.select 的 index，不由殘差是否有限推斷', () => {
    const data = h.dataset();
    const result = h.sphereResult();
    const flags = E.inFit(data, result);
    const expected = new Uint8Array(5);
    SasFitWeighting.select(data, 'sigma', h.RANGE).index.forEach((i) => { expected[i] = 1; });
    assert.deepEqual([...flags], [...expected]);
    assert.deepEqual([...flags], [0, 1, 1, 1, 1]);
    // 失敗的擬合：範圍內某一點的殘差是 NaN → in_fit 仍是 1、殘差欄是空的
    const residuals = Float64Array.from(result.residuals);
    residuals[2] = NaN;
    const failed = { ...result, status: 'failed', blockedByNonFinite: true, residuals };
    const { rows } = h.splitCsv(csvOf(failed));
    assert.deepEqual(rows.map((r) => r[5]), ['0', '1', '1', '1', '1']);
    assert.equal(rows[2][4], '');
    assert.equal(rows[1][4], '-1');
});

test('[sasfit-export] in_fit：官方檔 σ＝0 的列在任何權重下都不參與', () => {
    const official = h.officialDataset({ sigma: Float64Array.of(0.5, 0, 0.125, 0.0625, 0.5) });
    const flags = E.inFit(official, h.sphereResult({ weighting: 'none', data: official }));
    assert.deepEqual([...flags], [0, 0, 1, 1, 1]);
});

test('[sasfit-export] 量度名稱：sigma → 註解鍵 chi2r；none → weighted_mean_square_residual，且不出現 chi2r', () => {
    const sigma = h.splitCsv(csvOf(h.sphereResult())).comments;
    assert.ok(sigma.includes('# chi2r: 2.25'));
    assert.ok(!sigma.some((line) => line.includes('weighted_mean_square_residual:')));
    const none = csvOf(h.sphereResult({ weighting: 'none', chi2r: 4 }));
    assert.ok(none.includes('# weighted_mean_square_residual: 4\n'));
    assert.doesNotMatch(none, /chi2r/);
    assert.ok(none.includes('# errors: multiplied by sqrt(weighted_mean_square_residual)\n'));
    assert.ok(none.includes('# param radius = 50.0123456789 +/- 0.25 Ang (fitted)\n'));
});

test('[sasfit-export] fitCsv：貼上限、多分散、S(Q) 與官方檔的註解列', () => {
    const bound = csvOf(h.sphereResult({ atUpper: true }));
    assert.ok(bound.includes('# param radius = 60 +/- 0.125 Ang (fitted, at upper bound)\n'));
    const official = h.file(h.officialDataset());
    const shell = csvOf(h.coreShellResult(), official);
    assert.ok(shell.includes('# model: core_shell_sphere@hardsphere\n'));
    assert.ok(shell.includes('# structure_factor: hardsphere combined as P*S; effective radius: outer radius\n'));
    assert.ok(shell.includes('# param radius_pd = 0.1 +/- 0.01 (fitted; schulz distribution; 80 points; 3 sigmas)\n'));
    assert.ok(shell.includes('# units: q in 1/Ang; I, sigma and I_model in 1/cm (official TPS 13A file, absolute scale)\n'));
    assert.ok(shell.includes('# param background = 0.001 1/cm (fixed)\n'));
    h.splitCsv(shell).comments.forEach((line) => assert.match(line, /^# /));
});

test('[sasfit-export] fitCsv：stopped 丟 Error；maxiter、failed 照樣產生；資料對不上丟 Error', () => {
    assert.throws(() => csvOf(h.sphereResult({ status: 'stopped' })), /stopped/);
    assert.ok(csvOf(h.sphereResult({ status: 'maxiter' })).includes('# status: maxiter\n'));
    assert.ok(csvOf(h.sphereResult({ status: 'failed' })).includes('# status: failed\n'));
    assert.throws(() => csvOf({ ...h.sphereResult(), curve: new Float64Array(3) }), /does not belong/);
    assert.throws(() => csvOf(null), /FitResult/);
    assert.throws(() => E.fitCsv({ file: { fileName: 'x', dataset: null }, fitResult: h.sphereResult(), software: SOFTWARE }), /file with data/);
});

test('[sasfit-export] 匯出檔交給 SasFitDataIo.parse 不丟例外（6 欄：得到問題訊息）', () => {
    const parsed = SasFitDataIo.parse('\uFEFF' + csvOf(h.sphereResult()), { fileName: 'x_fit.csv', qUnit: 'A' });
    assert.ok(parsed.dataset === null || parsed.issues.length > 0);
});

test('[sasfit-export] 不修改傳入的物件', () => {
    const file = h.file(h.officialDataset());
    const result = h.coreShellResult();
    const before = [deepFrozenCopy(file), deepFrozenCopy(result)];
    csvOf(result, file);
    E.paramRows(result, { radius: [0, 100] });
    E.inFit(file.dataset, result);
    assert.deepEqual([deepFrozenCopy(file), deepFrozenCopy(result)], before);
});

// ---------------------------------------------------------------- dataUrlBytes
test('[sasfit-export] dataUrlBytes：只接受 PNG 的 base64 data URL，解成位元組', () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const out = E.dataUrlBytes('data:image/png;base64,' + png.toString('base64'));
    assert.equal(out.mime, 'image/png');
    assert.ok(out.bytes instanceof Uint8Array);
    assert.deepEqual([...out.bytes], [...png]);
    assert.deepEqual([...out.bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.throws(() => E.dataUrlBytes('data:image/jpeg;base64,' + png.toString('base64')), /only data:image\/png/);
    assert.throws(() => E.dataUrlBytes('blob:http://x/1'), /only data:image\/png/);
    assert.throws(() => E.dataUrlBytes('data:image/png;base64,###'), /damaged/);
    assert.throws(() => E.dataUrlBytes('data:image/png;base64,'), /damaged/);
    assert.throws(() => E.dataUrlBytes('data:image/png;base64,' + Buffer.from('not a png image').toString('base64')), /not a PNG/);
    assert.throws(() => E.dataUrlBytes(null), /only data:image\/png/);
});

test('[sasfit-export] 原始碼：沒有 fetch、沒有 Date、註解前綴是常數「# 」', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-export.js'), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /\bDate\b/);
    assert.equal(E.COMMENT, '# ');
    assert.ok(Object.isFrozen(E));
});
