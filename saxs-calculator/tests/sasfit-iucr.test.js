'use strict';
/**
 * sasfit-iucr.js（M4 Task 16）：送進 IUCr 表格的資料物件、可否送出的判斷、「Model fitting」列的 HTML。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitIucr: U, SasFitJobs, SasFitForm, SasFitFormat } = require('./load.js');
const h = require('./sasfit-export-helpers.js');

const ID_RE = /^iucr-sf(?:-[a-z0-9]+)*$/;
const PAYLOADS = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "' onmouseover='x", '&lt;b&gt;', 'javascript:alert(1)'];

const dataOf = (fitResult = h.sphereResult(), extra = {}) => U.data({
    fileName: 'SYNTH_tiny.dat', fitResult, form: h.formOf(fitResult), version: '9.9', ...extra,
});
const isDeepFrozen = (value) => value === null || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

/** <tr> 的陣列：{ id, cells: [{ colspan, html, text }] } */
function rowsOf(html) {
    return [...html.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({
        id: (m[1].match(/\sid="([^"]*)"/) || [])[1] || null,
        cls: (m[1].match(/\sclass="([^"]*)"/) || [])[1] || '',
        cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({
            colspan: Number((c[1].match(/colspan="(\d+)"/) || [0, 1])[1]), html: c[2],
            text: c[2].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&'),
        })),
    }));
}
const rowById = (html, id) => rowsOf(html).find((row) => row.id === id);
const texts = (row) => row.cells.map((cell) => cell.text);

// ---------------------------------------------------------------- 資料物件
test('[sasfit-iucr] data：規格 §8 的每個鍵都在、型別正確、深層凍結', () => {
    const data = dataOf();
    assert.deepEqual(Object.keys(data).sort(), ['assumptions', 'chi2r', 'datasetName', 'dof', 'errorsScaled', 'measure', 'model', 'notes', 'npoints',
        'params', 'qMax', 'qMin', 'radiusEffectiveMode', 'software', 'status', 'structureFactorMode', 'weighting'].sort());
    assert.equal(data.datasetName, 'SYNTH_tiny.dat');
    assert.equal(data.model, 'sphere');
    assert.equal(data.structureFactorMode, null);
    assert.equal(data.radiusEffectiveMode, null);
    assert.equal(data.chi2r, 2.25);
    assert.equal(data.dof, 2);
    assert.equal(data.npoints, 4);
    assert.equal(data.qMin, 0.015);
    assert.equal(data.qMax, 0.05);
    assert.equal(data.weighting, 'sigma');
    assert.equal(data.status, 'converged');
    assert.equal(data.software, 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9');
    assert.ok(Array.isArray(data.assumptions) && Array.isArray(data.notes));
    assert.ok(isDeepFrozen(data));
});

test('[sasfit-iucr] data：sphere → params 5 列（表格順序），fitted 與誤差正確；固定參數三個誤差都是 null', () => {
    const { params } = dataOf();
    assert.deepEqual(params.map((p) => p.name), ['scale', 'background', 'sld', 'sld_solvent', 'radius']);
    assert.deepEqual(params.map((p) => p.fitted), [true, false, false, false, true]);
    assert.deepEqual(Object.keys(params[0]).sort(), ['atBound', 'error', 'errorScaled', 'errorShown', 'fitted', 'name', 'unit', 'value'].sort());
    assert.deepEqual({ ...params[4] }, { name: 'radius', value: 50.0123456789, error: 0.125, errorScaled: 0.1875, errorShown: 0.125, unit: 'Å', fitted: true, atBound: null });
    assert.deepEqual([params[1].error, params[1].errorScaled, params[1].errorShown], [null, null, null]);
    assert.equal(params[2].unit, '10⁻⁶ Å⁻²');
    assert.equal(dataOf(h.sphereResult(), { absolute: true }).params[1].unit, 'cm⁻¹');
});

test('[sasfit-iucr] data：只收 σ 權重的擬合 → 顯示未乘的誤差、Reduced χ²；其他權重不能送出（使用者決定 2026-11-19）', () => {
    const sigma = dataOf();
    assert.equal(sigma.errorsScaled, false);
    assert.deepEqual({ ...sigma.measure }, { isChi2: true, label: 'Reduced χ²', value: 2.25 });
    assert.equal(sigma.params[4].errorShown, sigma.params[4].error);
    assert.equal(sigma.notes.some((n) => /multiplied/.test(n)), false);
    for (const weighting of ['none', 'sqrtI', 'absI']) {
        const result = h.sphereResult({ weighting, chi2r: 4 });
        const form = h.formOf(result);
        assert.deepEqual({ ...U.canSend(form, result) },
            { ok: false, reason: '只有以資料 σ 加權的擬合可以送進 IUCr 表格（其他權重沒有公認的適合度統計量）' }, weighting);
        assert.throws(() => U.data({ fileName: 'a.dat', fitResult: result, form, version: '9.9' }), /σ 加權/, weighting);
    }
    // 未收斂的原因排在權重之前：先說最根本的
    const bad = h.sphereResult({ weighting: 'none', status: 'maxiter' });
    assert.equal(U.canSend(h.formOf(bad), bad).reason, '擬合未收斂，不能送進表格');
});

test('[sasfit-iucr] data：core_shell_sphere@hardsphere＋radius_pd 擬合', () => {
    const data = dataOf(h.coreShellResult());
    assert.equal(data.model, 'core_shell_sphere@hardsphere');
    assert.equal(data.structureFactorMode, 'P*S');
    assert.equal(data.radiusEffectiveMode, 'outer radius');
    const width = data.params.find((p) => p.name === 'radius_pd');
    assert.equal(width.unit, 'schulz');
    assert.equal(width.fitted, true);
    assert.ok(data.assumptions.includes('radius: schulz distribution, fitted width (radius_pd), 80 points, ±3σ; width = σ/centre (relative standard deviation; the centre is the mean)'));
    assert.ok(data.assumptions.includes('Structure factor hardsphere combined as P*S; effective radius: outer radius'));
    assert.equal(dataOf(h.coreShellResult({ beta: true })).structureFactorMode, 'P*(1+beta*(S-1))');
    assert.equal(dataOf(h.coreShellResult({ lowQ: true })).model, 'core_shell_sphere@hardsphere+power_law');
    assert.ok(dataOf(h.coreShellResult({ lowQ: true })).assumptions.some((a) => /^Low-q power law/.test(a)));
    assert.equal(data.assumptions.some((a) => /^Low-q power law/.test(a)), false);
});

test('[sasfit-iucr] data：固定寬度的多分散寫出寬度；hayter_msa 的限制句只在用到它時出現；f ≈ Z 在模型有 SLD 參數時出現', () => {
    const base = h.coreShellResult();
    const fixedWidth = { ...base, names: ['scale', 'radius'], errors: { scale: 0.02, radius: 0.5 }, errorsScaled: { scale: 0.03, radius: 0.75 },
        covariance: [[1, 0], [0, 1]], correlation: [[1, 0], [0, 1]] };
    assert.ok(dataOf(fixedWidth).assumptions.includes('radius: schulz distribution, width 0.1 (fixed), 80 points, ±3σ; width = σ/centre (relative standard deviation; the centre is the mean)'));
    const hayter = /hayter_msa .* low q/;
    assert.ok(dataOf(h.coreShellResult({ structure: 'hayter_msa' })).assumptions.some((a) => hayter.test(a)));
    assert.equal(dataOf(base).assumptions.some((a) => hayter.test(a)), false);
    assert.equal(dataOf().assumptions.some((a) => hayter.test(a)), false);
    [dataOf(), dataOf(base)].forEach((data) => assert.ok(data.assumptions.some((a) => a.includes('f ≈ Z'))));
    assert.deepEqual([...dataOf().assumptions], ['X-ray SLDs: where computed with the formula calculator of this tool, f ≈ Z (no anomalous correction)']);
});

test('[sasfit-iucr] data：貼上限 → atBound 與 Notes', () => {
    const data = dataOf(h.sphereResult({ atUpper: true }));
    assert.equal(data.params[4].atBound, 'upper');
    assert.ok(data.notes.includes('radius at upper bound; its error is not meaningful'));
});

test('[sasfit-iucr] canSend：五種原因', () => {
    const good = h.sphereResult();
    const form = h.formOf(good);
    assert.deepEqual({ ...U.canSend(form, good) }, { ok: true, reason: '' });
    assert.deepEqual({ ...U.canSend(form, null) }, { ok: false, reason: '尚未擬合' });
    assert.deepEqual({ ...U.canSend(form, undefined) }, { ok: false, reason: '尚未擬合' });
    assert.equal(U.canSend(form, h.sphereResult({ status: 'maxiter' })).reason, '擬合未收斂，不能送進表格');
    assert.equal(U.canSend(form, h.sphereResult({ status: 'stopped' })).reason, '擬合未收斂，不能送進表格');
    assert.equal(U.canSend(form, h.sphereResult({ status: 'failed' })).reason, '擬合失敗，不能送進表格');
    assert.equal(U.canSend(form, h.sphereResult({ status: 'failed', blockedByNonFinite: true })).reason, '擬合被無法計算的區域擋住，不能送進表格');
    assert.equal(U.canSend(form, h.sphereResult({ blockedByNonFinite: true })).reason, '擬合被無法計算的區域擋住，不能送進表格');
    const edited = SasFitForm.reduce(form, { type: 'setValue', name: 'sld', value: '2' });
    assert.equal(U.canSend(edited, good).reason, '參數在擬合後改過；請重新擬合，或還原擬合前的參數');
    assert.equal(U.canSend(SasFitForm.create('cylinder'), good).ok, false);
    ['maxiter', 'failed', 'stopped'].forEach((status) => assert.equal(U.canSend(form, h.sphereResult({ status })).ok, false, status));
    assert.deepEqual([...U.SENDABLE], ['converged']);
});

test('[sasfit-iucr] converged＋每一種警示仍可送出，Notes 有對應的句子', () => {
    const base = h.sphereResult();
    const cases = [
        [h.sphereResult({ atUpper: true }), /radius at upper bound/],
        [{ ...base, illConditioned: true }, /cannot be determined independently/],
        [{ ...base, jacobianNonFinite: true }, /could not be computed for some parameters/],
        [{ ...base, correlation: [[1, -0.995], [-0.995, 1]] }, /scale and radius are strongly correlated \(r = −0\.995\)/],
        [{ ...base, errors: { scale: 5, radius: 0.125 }, errorsScaled: { scale: 7.5, radius: 0.1875 } }, /scale: error larger than the value/],
        [h.sphereResult({ chi2r: 50 }), /Reduced χ² is much larger than 1/],
        [{ ...base, nonFiniteCurvePoints: 3 }, /model curve could not be computed at 3 points/],
    ];
    cases.forEach(([result, pattern]) => {
        const form = h.formOf(result);
        assert.equal(U.canSend(form, result).ok, true, String(pattern));
        const { notes } = U.data({ fileName: 'a.dat', fitResult: result, form, version: '9.9' });
        assert.ok(notes.some((note) => pattern.test(note)), String(pattern) + ' / ' + notes.join(' | '));
    });
    assert.deepEqual([...dataOf().notes], [U.FIXED_NOTE], '沒有警示時只有固定的那一句');
    // 貼邊界的參數不重複列在「誤差大於數值」
    const bound = h.sphereResult({ atUpper: true, errors: { scale: 0.012, radius: 500 } });
    assert.equal(dataOf(bound).notes.some((note) => /radius: error larger/.test(note)), false);
});

test('[sasfit-iucr] data：不能送出就丟 Error；version 缺就丟 Error；輸出不含寫死的版本', () => {
    const good = h.sphereResult();
    assert.throws(() => U.data({ fileName: 'a', fitResult: h.sphereResult({ status: 'maxiter' }), form: h.formOf(good), version: '9.9' }), /未收斂/);
    assert.throws(() => U.data({ fileName: 'a', fitResult: good, form: SasFitForm.create('cylinder'), version: '9.9' }), /改過/);
    [undefined, null, ''].forEach((version) => {
        assert.throws(() => U.data({ fileName: 'a', fitResult: good, form: h.formOf(good), version }), /page version/, String(version));
    });
    assert.ok(dataOf().software.includes('v9.9'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-iucr.js'), 'utf8');
    assert.doesNotMatch(source, /v\d+\.\d+/);
    assert.doesNotMatch(source, /toFixed|toPrecision|toLocaleString|\bDate\b/);
});

test('[sasfit-iucr] 沒有 CorMap P-value 的列或鍵；Notes 的第一句固定說明「補充段落、未計算 CorMap」（使用者決定 2026-11-19）', () => {
    assert.equal(U.FIXED_NOTE, 'Supplementary to the IUCr template; applies to the data file named here. CorMap P-value not computed.');
    const noted = { ...h.sphereResult({ atUpper: true }), illConditioned: true };
    [dataOf(), dataOf(h.coreShellResult({ structure: 'hayter_msa', lowQ: true })), dataOf(noted)].forEach((data) => {
        assert.equal(data.notes[0], U.FIXED_NOTE, '固定句在其他註記之前');
        assert.equal(data.notes.filter((note) => note === U.FIXED_NOTE).length, 1);
        const rest = { ...data, notes: data.notes.slice(1) };
        assert.doesNotMatch(JSON.stringify(rest), /CorMap|P-value/i, '除了那一句，物件沒有 CorMap');
        const html = U.rowsHtml(data);
        assert.equal(rowById(html, 'iucr-sf-n-0').cells[2].text, U.FIXED_NOTE);
        assert.equal(rowById(html, 'iucr-sf-n-0').cells[1].text, 'Notes');
        assert.equal(html.split('CorMap').length - 1, 1);
    });
    assert.ok(dataOf(noted).notes.length >= 3);
    assert.doesNotMatch(U.rowsHtml(null), /CorMap|P-value/i);
});

test('[sasfit-iucr] Assumptions：每種分布都寫明寬度的定義（對照 sasmodels weights.py）', () => {
    const base = h.coreShellResult();
    const expected = {
        gaussian: 'width = σ/centre (relative standard deviation)',
        schulz: 'width = σ/centre (relative standard deviation; the centre is the mean)',
        rectangle: 'width = σ/centre (relative standard deviation; half-width √3 σ)',
        lognormal: 'width = σ of ln x; the centre is the median',
        uniform: 'width = half-width/centre',
        boltzmann: 'width = e-folding length/centre',
    };
    Object.keys(expected).forEach((type) => {
        const result = { ...base, params: { ...base.params, radius_pd_type: type } };
        const line = dataOf(result).assumptions.find((a) => a.startsWith('radius: '));
        assert.ok(line.startsWith('radius: ' + type + ' distribution, fitted width (radius_pd), '), type + ' / ' + line);
        assert.ok(line.endsWith('; ' + expected[type]), type + ' / ' + line);
    });
});

test('[sasfit-iucr] 不修改傳入的物件', () => {
    const result = h.coreShellResult();
    const form = h.formOf(result);
    const snap = (v) => JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x, String) : x));
    const before = [snap(result), snap(form)];
    U.rowsHtml(U.data({ fileName: 'a.dat', fitResult: result, form, version: '9.9' }));
    assert.deepEqual([snap(result), snap(form)], before);
});

// ---------------------------------------------------------------- 列的 HTML
test('[sasfit-iucr] rowsHtml(null)：恰好兩列——標題與「尚未送入擬合結果」', () => {
    const html = U.rowsHtml(null);
    const rows = rowsOf(html);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].cls, 'table-section-header');
    assert.equal(rows[0].cells.length, 1);
    assert.equal(rows[0].cells[0].colspan, 5);
    assert.equal(rows[0].cells[0].text, U.HEADING);
    assert.equal(U.HEADING, 'Model fitting (analytical scattering model)');
    assert.equal(rows[1].id, 'iucr-sf-empty');
    assert.deepEqual(texts(rows[1]), ['', '尚未送入擬合結果']);
    assert.equal(rows[1].cells[1].colspan, 4);
    assert.equal(U.rowsHtml(undefined), html);
});

test('[sasfit-iucr] rowsHtml：sphere 的列（順序、五欄、文字）', () => {
    const html = U.rowsHtml(dataOf());
    const rows = rowsOf(html);
    assert.equal(html.includes('iucr-sf-empty'), false);
    assert.deepEqual(rows.map((row) => row.id), ['iucr-sf-heading', 'iucr-sf-file', 'iucr-sf-model', 'iucr-sf-p-0', 'iucr-sf-p-1', 'iucr-sf-p-2', 'iucr-sf-p-3',
        'iucr-sf-p-4', 'iucr-sf-qrange', 'iucr-sf-npoints', 'iucr-sf-weighting', 'iucr-sf-measure', 'iucr-sf-status', 'iucr-sf-errors', 'iucr-sf-a-0',
        'iucr-sf-n-0', 'iucr-sf-software']);
    rows.forEach((row) => assert.equal(row.cells.reduce((sum, cell) => sum + cell.colspan, 0), 5, row.id));
    assert.deepEqual(texts(rowById(html, 'iucr-sf-file')), ['', 'Data file', 'SYNTH_tiny.dat', '', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-model')), ['', 'Model', 'sphere', '', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-p-0')), ['', 'scale', '0.980', '0.012', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-p-1')), ['', 'background', '0.001', 'fixed', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-p-2')), ['', 'sld', '1', 'fixed', '10⁻⁶ Å⁻²']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-p-4')), ['', 'radius', '50.01', '0.13', 'Å']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-qrange')), ['', 'q-range for fitting', '0.015–0.05', '', 'Å⁻¹']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-npoints')), ['', 'Number of points', '4', '', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-weighting')), ['', 'Weighting', '1/σ² (data errors)', '', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-measure')), ['', 'Reduced χ²', '2.25 (dof ' + dataOf().dof + ')', '', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-n-0')), ['', 'Notes', U.FIXED_NOTE]);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-status')), ['', 'Status', 'converged', '', '']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-errors')), ['', 'Parameter errors (±)', '1 s.d., not scaled']);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-a-0')).slice(0, 2), ['', 'Assumptions']);
    assert.match(rowById(html, 'iucr-sf-a-0').cells[2].text, /f ≈ Z/);
    assert.equal(rowById(html, 'iucr-sf-a-0').cells[2].colspan, 3);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-software')), ['', 'Software', 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9']);
});

test('[sasfit-iucr] rowsHtml：畫面格式與結果磚相同（回填後的值）；負號是 U+2212；貼邊界與量度', () => {
    const negative = h.sphereResult();
    const withNegative = { ...negative, params: { ...negative.params, scale: 0.98, background: -0.0015 } };
    const form = h.formOf(withNegative);
    const html = U.rowsHtml(U.data({ fileName: 'a.dat', fitResult: withNegative, form, version: '9.9' }));
    assert.equal(rowById(html, 'iucr-sf-p-1').cells[2].text, '−0.0015');
    const shown = SasFitFormat.valueError(SasFitFormat.inputValue(50.0123456789, 0.125), 0.125);
    assert.deepEqual(texts(rowById(html, 'iucr-sf-p-4')).slice(2, 4), [shown.value, shown.error]);
    const bound = U.rowsHtml(dataOf(h.sphereResult({ atUpper: true })));
    assert.deepEqual(texts(rowById(bound, 'iucr-sf-p-4')), ['', 'radius', '60.000', 'at upper bound', 'Å']);
    assert.deepEqual(texts(rowById(bound, 'iucr-sf-n-0')).slice(0, 3), ['', 'Notes', U.FIXED_NOTE]);
    assert.deepEqual(texts(rowById(bound, 'iucr-sf-n-1')).slice(0, 3), ['', '', 'radius at upper bound; its error is not meaningful']);
    // dof 不是整數（不完整的物件）時只寫量度
    assert.deepEqual(texts(rowById(U.rowsHtml({ ...dataOf(), dof: undefined }), 'iucr-sf-measure')), ['', 'Reduced χ²', '2.25', '', '']);
});

test('[sasfit-iucr] rowsHtml：有 S(Q) 才有組合列；Assumptions 與 Notes 每則一列，第一列才有標題', () => {
    const plain = U.rowsHtml(dataOf());
    assert.equal(rowById(plain, 'iucr-sf-sfmode'), undefined);
    assert.equal(rowById(plain, 'iucr-sf-n-1'), undefined, '沒有警示：Notes 只有固定句');
    const result = { ...h.coreShellResult({ structure: 'hayter_msa' }), illConditioned: true, nonFiniteCurvePoints: 2 };
    const html = U.rowsHtml(dataOf(result));
    assert.deepEqual(texts(rowById(html, 'iucr-sf-sfmode')), ['', 'Structure-factor combination', 'P*S', '', '']);
    assert.equal(rowById(html, 'iucr-sf-a-0').cells[1].text, 'Assumptions');
    assert.equal(rowById(html, 'iucr-sf-a-1').cells[1].text, '');
    assert.ok(rowById(html, 'iucr-sf-a-3'), '多分散、f≈Z、S(Q)、hayter 共四則');
    assert.equal(rowById(html, 'iucr-sf-n-0').cells[1].text, 'Notes');
    assert.equal(rowById(html, 'iucr-sf-n-1').cells[1].text, '');
    const width = rowsOf(html).find((row) => row.cells[1] && row.cells[1].text === 'radius_pd');
    assert.deepEqual(texts(width), ['', 'radius_pd', '0.100', '0.010', 'schulz']);
    const charge = rowsOf(html).find((row) => row.cells[1] && row.cells[1].text === 'charge');
    assert.deepEqual(texts(charge), ['', 'charge', '19', 'fixed', 'e (elementary charge)']);          // 表格是英文的：不用畫面上的中文單位
    assert.doesNotMatch(html, /[\u4E00-\u9FFF]/, '已送入的段落沒有中文');
});

test('[sasfit-iucr] rowsHtml：每個 id 都符合 iucr-sf 的樣式且不重複', () => {
    const html = U.rowsHtml(dataOf({ ...h.coreShellResult({ structure: 'hayter_msa', lowQ: true }), illConditioned: true }));
    const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 15);
    ids.forEach((id) => assert.match(id, ID_RE));
    assert.equal(new Set(ids).size, ids.length);
    assert.doesNotMatch(html, /<(?:input|select|textarea|button|a|script|img)\b/i);
    assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/i);
});

test('[sasfit-iucr] rowsHtml 的 XSS 矩陣：任何欄位的惡意字串都不會變成標籤或屬性', () => {
    const base = JSON.parse(JSON.stringify(dataOf(h.coreShellResult())));
    const inject = (payload) => [
        { ...base, datasetName: payload }, { ...base, model: payload }, { ...base, software: payload },
        { ...base, structureFactorMode: payload }, { ...base, weighting: payload }, { ...base, status: payload },
        { ...base, assumptions: [payload, payload] }, { ...base, notes: [payload] },
        { ...base, measure: { ...base.measure, label: payload } },
        { ...base, params: base.params.map((p) => ({ ...p, name: payload, unit: payload })) },
        { ...base, params: base.params.map((p) => ({ ...p, atBound: payload })) },
    ];
    PAYLOADS.forEach((payload) => {
        inject(payload).forEach((data, i) => {
            const html = U.rowsHtml(data);
            const label = payload + ' #' + i;
            [...html.matchAll(/</g)].forEach((m) => {
                assert.match(html.slice(m.index, m.index + 8), /^<\/?(?:tr|td|i|sub|sup)\b/, label + '：' + html.slice(m.index, m.index + 30));
            });
            assert.doesNotMatch(html, /<[^>]*\son\w+\s*=/i, label);
            [...html.matchAll(/<[a-z]+((?:\s[^>]*)?)>/g)].forEach((tag) => {
                assert.match(tag[1], /^(?:\s+[a-z-]+="[^"<>]*")*$/, label + '：屬性 ' + tag[0]);
            });
            assert.equal(html.includes('<script'), false, label);
            assert.equal(html.includes('<img'), false, label);
        });
    });
    // 被跳脫的內容還在（以文字形式）
    const html = U.rowsHtml({ ...base, datasetName: PAYLOADS[0] });
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.equal(rowById(html, 'iucr-sf-file').cells[2].text, PAYLOADS[0]);
});

test('[sasfit-iucr] rowsHtml：不完整或型別不對的物件不丟例外，數字欄以「—」表示', () => {
    const odd = { datasetName: 5, model: null, params: [{ name: 'x', value: NaN, errorShown: null, fitted: true, atBound: null, unit: null }], measure: null,
        qMin: NaN, qMax: undefined, npoints: 'many', assumptions: 'none', notes: null, software: undefined };
    const html = U.rowsHtml(odd);
    assert.ok(rowsOf(html).length >= 8);
    assert.equal(rowById(html, 'iucr-sf-p-0').cells[2].text, '—');
    rowsOf(html).forEach((row) => assert.equal(row.cells.reduce((sum, cell) => sum + cell.colspan, 0), 5, row.id));
});

test('[sasfit-iucr] resultMatchesForm 是送出的條件：fixture 的表單與結果相符', () => {
    [h.sphereResult(), h.coreShellResult(), h.coreShellResult({ structure: 'hayter_msa', lowQ: true, beta: true })].forEach((result) => {
        assert.equal(SasFitJobs.resultMatchesForm(h.formOf(result), result), true);
    });
});

test('[sasfit-iucr] index.html 的靜態擬合段（區段 3）與 rowsHtml(null) 相同（去掉標籤之間的空白後）', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const m = /<tbody id="iucr-sf-body" class="iucr-sf-body" data-empty="true">([\s\S]*?)<\/tbody>/.exec(page);
    assert.ok(m, 'index.html 沒有 tbody#iucr-sf-body');
    assert.equal(m[1].replace(/>\s+</g, '><').trim(), U.rowsHtml(null));
});
