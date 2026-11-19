'use strict';
/**
 * sasfit-report.js（M4 Task 14）：報告 TXT 與序列結果 CSV。
 *
 * 黃金字串（REPORT_GOLDEN、SEQUENCE_GOLDEN）是完整的期望輸出：改輸出格式必須同時改這裡，並在 commit 訊息說明。
 *
 * 規格 §9 報告 TXT 的每一項（REQUIRED 逐項斷言「這一行存在」）：
 *   資料檔名與檔頭（能量、q_start、厚度、SF、透射率）；模型、S(Q) 組合與有效半徑模式；
 *   多分散設定（分布、寬度、npts、nsigmas、cutoff）；各參數值、誤差（不乘／乘兩欄）、擬合或固定、觸及邊界；
 *   χ²、量度、自由度、點數、q 範圍、權重；演算法與設定、迭代數、狀態；f≈Z 的註記；軟體與版本。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SasFitReport: R, SasFitExport: E, SasFitFormat, SasFitHtml, SasFitSeqView, SasFitState } = require('./load.js');
const h = require('./sasfit-export-helpers.js');
const m4 = require('./sasfit-m4-helpers.js');

const SOFTWARE = E.software('9.9');
const AT = '2026-11-19T08:00:00.000Z';
const BOUNDS = Object.freeze({ scale: [0, Infinity], radius: [0, 60] });
const SLD_NOTE = '- SLD 若由本頁的化學式計算器求得，是以 f ≈ Z 計算（忽略異常散射），SLD 與能量無關。15 keV 下，含 Rb、Sr、Y、Zr、Br、Kr 或 '
    + 'Pt、Au、Hg、Tl、Pb、Bi、Th、U 的物質，實際 SLD 會低約 4–10 %，對比度平方的誤差約為兩倍；其他能量下受影響的元素不同。';
const KERNEL_NOTE = '模型計算核心：SasView sasmodels 1.0.12（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly';

const REPORT_GOLDEN = [
    'SAS model fitting report（SAS 模型擬合報告）',
    'Generated: 2026-11-19T08:00:00.000Z',
    'Software: sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9',
    '',
    '[Data]',
    'Data file: SYNTH_tiny.dat',
    'File kind: generic text file（一般文字檔，強度單位依原檔）',
    'Number of points in file: 5',
    'Header: none（無檔頭）',
    '',
    '[Model]',
    'Model: sphere（均勻球）',
    'Structure factor S(Q): none',
    'Combination of P and S: -',
    'Effective radius of S(Q): -',
    'Low-q power law: no',
    'Model string: sphere',
    '',
    '[Polydispersity]',
    'none',
    'Integration cutoff: 0.00001',
    '',
    '[Parameters]',
    'Errors shown on the page: error（畫面顯示的是未乘的誤差；權重＝資料 σ）',
    'Columns: name | value | error | error_scaled | shown on the page | unit | state | at bound | lower | upper',
    'scale | 0.98 | 0.012 | 0.018000000000000002 | 0.980 ± 0.012 | - | fitted | - | 0 | unbounded',
    'background | 0.001 | - | - | 0.001 | - | fixed | - | - | -',
    'sld | 1 | - | - | 1 | 1e-6/Ang^2 | fixed | - | - | -',
    'sld_solvent | 6 | - | - | 6 | 1e-6/Ang^2 | fixed | - | - | -',
    'radius | 50.0123456789 | 0.125 | 0.1875 | 50.01 ± 0.13 | Ang | fitted | - | 0 | 60',
    '上下限為匯出當時參數表的設定（FitResult 本身不記錄上下限）',
    '',
    '[Fit quality]',
    'Sum of squared weighted residuals (chi2): 4.5',
    'Reduced chi-square（約化 χ²）: 2.25',
    'Degrees of freedom: 2',
    'Points used: 4',
    'Points excluded: 1 (of 5)',
    'q range (1/Ang): 0.015 to 0.05',
    'Weighting: sigma（資料 σ）',
    '',
    '[Algorithm and status]',
    'Algorithm: Levenberg-Marquardt (lm), Nielsen damping update, forward-difference Jacobian, projected bounds',
    'Errors: from the covariance J^T J at the solution (SVD, singular values floored at 1e-8), as bumps / SasView',
    'ftol: 1e-10',
    'xtol: 1e-10',
    'Max steps: 200',
    'Iterations: 6',
    'Status: converged（已收斂）',
    'At bound: none',
    'Undetermined (error >= |value|): none',
    'illConditioned: false（參數無法由資料獨立決定（彼此高度相關，或某個參數對曲線幾乎沒有影響），誤差不可靠）',
    'blockedByNonFinite: false（擬合被模型無法計算的區域擋住，參數是目前為止最好的點）',
    'jacobianNonFinite: false（部分參數的誤差無法計算；其餘參數的誤差是把那些參數固定後算出的，數值偏小）',
    'nonFiniteCurvePoints: 0（模型曲線中無法計算（非有限）的點數）',
    'Strong correlations (|r| > 0.98): none',
    '',
    '[Notes]',
    SLD_NOTE,
    KERNEL_NOTE,
    '',
].join('\r\n');

const SEQUENCE_GOLDEN = [
    '# SAS model fitting: results of a sequence',
    '# UTF-8 with BOM; comment lines start with "# "; read with pandas.read_csv(f, comment="#") (text columns: file, status, status_text, started_from, note)',
    '# software: sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9',
    '# model: sphere',
    '# weighting: sigma',
    '# condition_name: 條件',
    '# errors: not scaled',
    '# outcome: finished',
    'index,file,條件,scale,scale_error,background,background_error,radius,radius_error,chi2r,dof,iterations,status,status_text,q_min,q_max,started_from,note',
    '1,SYNTH_sphere_10.dat,10,1,0.01,0.001,0.0001,50.12,0.05,1.1,54,7,converged,已收斂,0.005,0.35,,',
    '2,SYNTH_sphere_20.dat,20,1,0.01,0.001,0.0001,52.07,0.05,1.1,54,7,converged,已收斂,0.005,0.35,SYNTH_sphere_10.dat,',
    '3,SYNTH_sphere_30.dat,30,1,0.01,0.001,0.0001,53.95,0.05,1.1,54,7,converged,已收斂,0.005,0.35,SYNTH_sphere_20.dat,',
    '',
].join('\n');

const report = (options = {}) => R.reportTxt({
    file: h.file(), fitResult: h.sphereResult(), bounds: BOUNDS, software: SOFTWARE, generatedAt: AT, ...options,
});
const linesOf = (text) => text.split('\r\n');
const official = () => h.file(h.officialDataset());
const snapshot = (value) => JSON.stringify(value, (key, v) => (ArrayBuffer.isView(v) ? Array.from(v, String) : v));

// ---------------------------------------------------------------- 報告 TXT
test('[sasfit-report] reportTxt：黃金字串', () => {
    assert.equal(report(), REPORT_GOLDEN);
});

test('[sasfit-report] reportTxt：換行全是 CRLF，沒有落單的 LF；沒有 BOM', () => {
    const text = report({ file: official(), fitResult: h.coreShellResult() });
    assert.ok(text.endsWith('\r\n'));
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(text.replace(/\r\n/g, '').includes('\r'), false);
    assert.notEqual(text.charCodeAt(0), 0xFEFF);
});

test('[sasfit-report] 規格 §9 的每一項都有一行（官方檔、core_shell_sphere@hardsphere、多分散）', () => {
    const lines = linesOf(report({ file: official(), fitResult: h.coreShellResult(), bounds: null }));
    const REQUIRED = [
        'Data file: B1216_out.dat', 'Output filename: B1216_out.dat', 'Photon energy (keV): 15',
        'Wavelength (Ang): 0.8265613228880018（由能量換算：12.398419843320026 / E）',
        'Starting q for binning (1/Ang): 0.005', 'Sample thickness (mm): 1.5', 'Scaling factor: 0.0125',
        'Sample transmission: 0.75', 'Empty-cell transmission: 0.875', 'Sample-to-detector distance (mm): 2500',
        'Total frames: 10', 'Single frame time (s): 2', 'Number of points in file: 5',
        'Model: core_shell_sphere（核殼球）', 'Structure factor S(Q): hardsphere（硬球）', 'Combination of P and S: P*S',
        'Effective radius of S(Q): outer radius', 'Low-q power law: no', 'Model string: core_shell_sphere@hardsphere',
        'radius: schulz distribution, width 0.1 (fitted), 80 points, 3 sigmas', 'Integration cutoff: 0.00001',
        'Columns: name | value | error | error_scaled | shown on the page | unit | state | at bound | lower | upper',
        'radius | 60 | 0.5 | 0.75 | 60.00 ± 0.50 | Ang | fitted | - | - | -',
        'radius_pd | 0.1 | 0.01 | 0.015 | 0.100 ± 0.010 | - | fitted | - | - | -',
        'background | 0.001 | - | - | 0.001 | 1/cm | fixed | - | - | -',
        'Sum of squared weighted residuals (chi2): 2.25', 'Reduced chi-square（約化 χ²）: 2.25', 'Degrees of freedom: 1',
        'Points used: 4', 'Points excluded: 1 (of 5)', 'q range (1/Ang): 0.015 to 0.05', 'Weighting: sigma（資料 σ）',
        'Algorithm: Levenberg-Marquardt (lm), Nielsen damping update, forward-difference Jacobian, projected bounds',
        'ftol: 1e-10', 'xtol: 1e-10', 'Max steps: 200', 'Iterations: 6', 'Status: converged（已收斂）',
        'Strong correlations (|r| > 0.98): none', SLD_NOTE, KERNEL_NOTE,
        'Software: sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v9.9', 'Generated: ' + AT,
    ];
    REQUIRED.forEach((line) => assert.ok(lines.includes(line), '缺少：' + line));
    assert.ok(lines.includes('File kind: official TPS 13A reduced file（官方還原檔，絕對強度 1/cm）'));
});

test('[sasfit-report] 檔頭缺欄位寫「-」；能量不可用時波長也是「-」；有條件值時列出', () => {
    const header = { ...h.HEADER, energyKeV: null, thicknessMm: null };
    const lines = linesOf(report({ file: { ...h.file(h.officialDataset({ header })), condition: 25 }, conditionName: '溫度 (°C)' }));
    assert.ok(lines.includes('Photon energy (keV): -'));
    assert.ok(lines.includes('Wavelength (Ang): -'));
    assert.ok(lines.includes('Sample thickness (mm): -'));
    assert.ok(lines.includes('Condition (溫度 (°C)): 25'));
});

test('[sasfit-report] 兩種誤差：sigma 權重註明畫面顯示未乘的；none 註明顯示已乘的，兩欄相差 √(量度)', () => {
    const sigma = linesOf(report());
    assert.ok(sigma.includes('Errors shown on the page: error（畫面顯示的是未乘的誤差；權重＝資料 σ）'));
    const none = linesOf(report({ fitResult: h.sphereResult({ weighting: 'none', chi2r: 4 }) }));
    assert.ok(none.includes('Errors shown on the page: error_scaled（畫面顯示的是已乘 √(加權殘差均方) 的誤差；權重不是資料 σ）'));
    const radius = none.find((line) => line.startsWith('radius | ')).split(' | ');
    assert.equal(Number(radius[3]) / Number(radius[2]), Math.sqrt(4));
    assert.equal(radius[4], '50.01 ± 0.25');
});

test('[sasfit-report] 參數列：全精度欄讀回後 Object.is 相同；畫面格式欄等於 SasFitFormat.valueError 與結果磚', () => {
    const result = h.sphereResult();
    const lines = linesOf(report({ fitResult: result }));
    const tiles = SasFitHtml.resultParamsHtml(result, { absolute: false });
    ['scale', 'radius'].forEach((name) => {
        const cells = lines.find((line) => line.startsWith(name + ' | ')).split(' | ');
        assert.ok(Object.is(Number(cells[1]), result.params[name]), name);
        assert.ok(Object.is(Number(cells[2]), result.errors[name]), name);
        assert.ok(Object.is(Number(cells[3]), result.errorsScaled[name]), name);
        const shown = SasFitFormat.valueError(SasFitFormat.inputValue(result.params[name], result.errors[name]), result.errors[name]);
        assert.equal(cells[4], shown.value + ' ± ' + shown.error);
        assert.ok(tiles.includes('>' + shown.value + '<') || tiles.includes(shown.value), '結果磚的數值文字');
        assert.ok(tiles.includes('± ' + shown.error), '結果磚的誤差文字');
    });
});

test('[sasfit-report] 量度名稱：sigma → reduced chi-square；none → weighted mean-square residual，並附說明', () => {
    const sigma = report();
    assert.ok(sigma.includes('Reduced chi-square（約化 χ²）: 2.25\r\n'));
    assert.equal(sigma.includes('Weighted mean-square residual'), false);
    const none = report({ fitResult: h.sphereResult({ weighting: 'none', chi2r: 4 }) });
    assert.ok(none.includes('Weighted mean-square residual（加權殘差均方；weighting none）: 4\r\n'));
    assert.ok(none.includes('此數值不是 χ²ᵣ，沒有絕對意義；參數誤差已乘 √(加權殘差均方)，SasView 在相同權重下顯示未乘的值\r\n'));
    assert.equal(none.includes('Reduced chi-square'), false);
    assert.doesNotMatch(none, /chi2r/);
    assert.ok(none.includes('Weighting: none（不加權）\r\n'));
});

test('[sasfit-report] bounds：有值時註明是匯出當時的設定；null 時下限、上限寫「-」並註明未記錄', () => {
    const kept = linesOf(report());
    assert.ok(kept.includes('上下限為匯出當時參數表的設定（FitResult 本身不記錄上下限）'));
    assert.ok(kept.includes('radius | 50.0123456789 | 0.125 | 0.1875 | 50.01 ± 0.13 | Ang | fitted | - | 0 | 60'));
    const lost = linesOf(report({ bounds: null }));
    assert.ok(lost.includes('上下限未記錄（匯出時參數表的模型已與這次擬合不同）'));
    assert.ok(lost.includes('radius | 50.0123456789 | 0.125 | 0.1875 | 50.01 ± 0.13 | Ang | fitted | - | - | -'));
    assert.equal(lost.includes('上下限為匯出當時參數表的設定（FitResult 本身不記錄上下限）'), false);
});

test('[sasfit-report] 貼邊界：at bound 欄、旗標列與註記；畫面格式欄不帶誤差', () => {
    const lines = linesOf(report({ fitResult: h.sphereResult({ atUpper: true }) }));
    assert.ok(lines.includes('radius | 60 | 0.125 | 0.1875 | 60.000 | Ang | fitted | upper | 0 | 60'));
    assert.ok(lines.includes('At bound: radius (upper)'));
    assert.ok(lines.includes('- 貼在邊界上的參數（at bound）仍列出有限的誤差，那是把它當自由參數算出來的數字，不代表該參數的不確定度。'));
    assert.equal(linesOf(report()).some((line) => line.includes('貼在邊界上的參數')), false);
});

test('[sasfit-report] 旗標、誤差大於數值與強相關都寫明', () => {
    const base = h.sphereResult();
    const flagged = {
        ...base, illConditioned: true, jacobianNonFinite: true, nonFiniteCurvePoints: 3,
        errors: { scale: 5, radius: 0.125 }, errorsScaled: { scale: 7.5, radius: 0.1875 },
        correlation: [[1, -0.995], [-0.995, 1]],
    };
    const lines = linesOf(report({ fitResult: flagged }));
    assert.ok(lines.some((line) => line.startsWith('illConditioned: true（')));
    assert.ok(lines.some((line) => line.startsWith('jacobianNonFinite: true（')));
    assert.ok(lines.includes('nonFiniteCurvePoints: 3（模型曲線中無法計算（非有限）的點數）'));
    assert.ok(lines.includes('Undetermined (error >= |value|): scale'));
    assert.ok(lines.includes('Strong correlations (|r| > 0.98):'));
    assert.ok(lines.includes('  scale ~ radius: -0.995'));
    assert.ok(lines.includes('Status: converged（已收斂・有警示）'));
    assert.ok(lines.includes('- 誤差大於數值的參數（undetermined）與 0 無法區分，或無法由這組資料決定。'));
});

test('[sasfit-report] hayter_msa 的限制句只在用到它時出現；f ≈ Z 的句子在模型有 SLD 參數時出現', () => {
    const hayter = '- 結構因子 hayter_msa 在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同），擬合得到的誤差可能不可靠；請連同殘差圖一起判斷結果。';
    assert.ok(linesOf(report({ fitResult: h.coreShellResult({ structure: 'hayter_msa' }) })).includes(hayter));
    assert.equal(linesOf(report({ fitResult: h.coreShellResult() })).includes(hayter), false);
    assert.equal(linesOf(report()).includes(hayter), false);
    [report(), report({ fitResult: h.coreShellResult() }), report({ fitResult: h.coreShellResult({ beta: true, lowQ: true }) })]
        .forEach((text) => assert.ok(linesOf(text).includes(SLD_NOTE)));
    const guinier = { ...h.sphereResult(), params: { scale: 1, background: 0.001, rg: 60 }, names: ['scale'],
        settings: { ...h.sphereResult().settings, modelSpec: { model: 'guinier', structure: null, lowQPowerLaw: false } } };
    assert.equal(linesOf(report({ fitResult: guinier, bounds: null })).includes(SLD_NOTE), false);
});

test('[sasfit-report] β 組合、低 q 冪律與有效半徑模式的文字', () => {
    const lines = linesOf(report({ fitResult: h.coreShellResult({ beta: true, lowQ: true }), bounds: null }));
    assert.ok(lines.includes('Combination of P and S: P*(1+beta*(S-1))'));
    assert.ok(lines.includes('Low-q power law: yes（lowq_scale * q^-lowq_power，與模型共用 background）'));
    assert.ok(lines.includes('Model string: core_shell_sphere@hardsphere+power_law'));
});

test('[sasfit-report] maxiter、failed 照樣產生並寫明狀態；stopped 丟 Error；缺軟體字串或時間丟 Error', () => {
    assert.ok(report({ fitResult: h.sphereResult({ status: 'maxiter' }) }).includes('Status: maxiter（未收斂（達最大步數））\r\n'));
    const failed = report({ fitResult: h.sphereResult({ status: 'failed', blockedByNonFinite: true }) });
    assert.ok(failed.includes('Status: failed（失敗）\r\n'));
    assert.ok(failed.includes('blockedByNonFinite: true（'));
    assert.throws(() => report({ fitResult: h.sphereResult({ status: 'stopped' }) }), /stopped/);
    assert.throws(() => report({ software: '' }), /software/);
    assert.throws(() => report({ generatedAt: undefined }), /generatedAt/);
    assert.throws(() => report({ generatedAt: 12345 }), /generatedAt/);
});

test('[sasfit-report] 與目前參數表不符時加一行說明', () => {
    const changed = 'Parameter table at export: changed since this fit（匯出時參數表已在這次擬合之後改過；本報告記錄的是這次擬合當時的參數）';
    assert.ok(linesOf(report({ matchesForm: false })).includes(changed));
    assert.equal(linesOf(report({ matchesForm: true })).includes(changed), false);
    assert.equal(linesOf(report()).includes(changed), false);
});

test('[sasfit-report] 檔名、檔頭欄位與條件名稱裡的控制字元被換掉（不能靠換行偽造報告內容）', () => {
    const header = { ...h.HEADER, outputName: 'out\r\nStatus: converged（偽造）' };
    const file = { ...h.file(h.officialDataset({ header }), 'a.dat\nReduced chi-square（約化 χ²）: 1'), condition: 5 };
    const lines = linesOf(report({ file, conditionName: 'c\u2028d\te', generatedAt: 'now\r\nx' }));
    assert.ok(lines.includes('Data file: a.dat_Reduced chi-square（約化 χ²）: 1'));
    assert.ok(lines.includes('Output filename: out__Status: converged（偽造）'));
    assert.ok(lines.includes('Condition (c_d_e): 5'));
    assert.ok(lines.includes('Generated: now__x'));
    assert.equal(lines.filter((line) => line.startsWith('Status: ')).length, 1);
    assert.equal(lines.filter((line) => line.startsWith('Reduced chi-square')).length, 1);
});

test('[sasfit-report] 不修改傳入的物件；原始碼沒有 Date 與 toFixed／toPrecision', () => {
    const file = official();
    const result = h.coreShellResult();
    const before = [snapshot(file), snapshot(result), snapshot(BOUNDS)];
    report({ file, fitResult: result });
    assert.deepEqual([snapshot(file), snapshot(result), snapshot(BOUNDS)], before);
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sasfit-report.js'), 'utf8');
    assert.doesNotMatch(source, /\bDate\b|toFixed|toPrecision|toLocaleString/);
    assert.doesNotMatch(source, /v\d+\.\d+/, '原始碼不得寫死版本');
    assert.ok(Object.isFrozen(R));
});

// ---------------------------------------------------------------- 序列結果 CSV
const seqCsv = (state) => R.sequenceCsv({ state, software: SOFTWARE });

test('[sasfit-report] sequenceCsv：黃金字串', () => {
    assert.equal(seqCsv(m4.seqState().state), SEQUENCE_GOLDEN);
});

test('[sasfit-report] sequenceCsv：三筆收斂＋一筆跳過＋一筆出錯 → 5 列，後兩者數值為空而狀態與註記有字', () => {
    const [d1, d2, d3] = m4.seqDatasets();
    const noSigma = Object.freeze({ ...d1, sigma: null, fileName: 'nosigma.dat', condition: 5 });
    const extra = Object.freeze({ ...d2, fileName: '=cmd.dat', condition: 40 });
    const files = [d1, d2, d3, noSigma, extra].map((dataset) => ({ fileName: dataset.fileName, dataset, issues: [], notes: {} }));
    const steps = [{ values: { radius: 50.12 } }, { values: { radius: 52.07 } }, { values: { radius: 53.95 } }, { error: '模型無法計算, 請重試' }];
    const { state } = m4.seqState({ files, steps, weighting: 'sigma' });
    const { comments, header, rows } = h.splitCsv(seqCsv(state));
    comments.forEach((line) => assert.match(line, /^# /));
    assert.equal(rows.length, 5);
    rows.forEach((row) => assert.equal(row.length, header.length));
    const col = (name) => header.indexOf(name);
    const byFile = (name) => rows.find((row) => row[col('file')] === name);
    const skipped = byFile('nosigma.dat');
    const failed = byFile("'=cmd.dat");                     // 檔名經 cell：公式注入防護
    assert.ok(skipped && failed, '跳過與出錯的列都在');
    [skipped, failed].forEach((row) => {
        ['scale', 'scale_error', 'radius', 'radius_error', 'chi2r', 'dof', 'iterations'].forEach((name) => assert.equal(row[col(name)], '', name));
        assert.notEqual(row[col('status_text')], '');
    });
    assert.equal(skipped[col('status')], 'skipped');
    assert.notEqual(skipped[col('note')], '');
    assert.equal(failed[col('status')], 'error');
    assert.equal(failed[col('note')], '模型無法計算, 請重試');
    assert.deepEqual(rows.map((row) => row[col('index')]), ['1', '2', '3', '4', '5']);
    assert.equal(rows.filter((row) => row[col('status')] === 'converged').length, 3);
});

test('[sasfit-report] sequenceCsv：數字與表格同一來源、全精度；被單筆擬合取代的列有註記；貼邊界的值不列誤差', () => {
    const { state, form } = m4.seqState();
    const id = state.seq.order[1];
    const dataset = state.files.find((file) => file.id === id).dataset;
    const job = globalThis.SasFitJobs.fitJob(form, dataset, { range: { qMin: 0.005, qMax: 0.2 }, weighting: 'sigma', maxSteps: 200 });
    const replaced = m4.fakeResult({ job, values: { radius: 52.123456789012 }, atBound: Object.freeze({ scale: 'upper' }) });
    const next = Object.freeze({ ...state, fitResults: Object.freeze({ ...state.fitResults, [id]: replaced }) });
    const { header, rows } = h.splitCsv(seqCsv(next));
    const col = (name) => header.indexOf(name);
    const row = rows[1];
    assert.ok(Object.is(Number(row[col('radius')]), 52.123456789012));
    assert.equal(row[col('q_max')], '0.2');
    assert.equal(row[col('scale_error')], '');
    assert.match(row[col('note')], /scale 貼上限/);
    assert.match(row[col('note')], /已單獨重新擬合/);
    // 與表格一致：表格有數字的列 CSV 才有數字
    const table = SasFitSeqView.tableRows(next);
    rows.forEach((csvRow, i) => {
        const view = table.find((r) => r.id === next.seq.order[i]);
        assert.equal(csvRow[col('radius')] !== '', view.cells[2].value !== SasFitFormat.MISSING);
        assert.equal(csvRow[col('status_text')], view.status.text);
    });
});

test('[sasfit-report] sequenceCsv：權重不是 σ 時表頭與量度欄改名，條件名稱經 cell', () => {
    const { state } = m4.seqState({ weighting: 'none', conditionName: '=濃度, mg/mL' });
    const csv = seqCsv(state);
    const { header } = h.splitCsv(csv);
    assert.ok(header.includes('radius_error_scaled'));
    assert.ok(header.includes('weighted_mean_square_residual'));
    assert.equal(header.includes('chi2r'), false);
    assert.equal(header[2], "'=濃度, mg/mL");
    assert.ok(csv.includes('# condition_name: =濃度_ mg/mL\n'));
    assert.ok(csv.includes('# errors: multiplied by sqrt(weighted_mean_square_residual)\n'));
    assert.doesNotMatch(csv, /chi2r/);
});

test('[sasfit-report] sequenceCsv：尚未執行（seq.order 為 null）丟 Error；不修改 state', () => {
    assert.throws(() => seqCsv(SasFitState.initial()), /no sequence has run/);
    assert.throws(() => R.sequenceCsv({ state: m4.seqState().state, software: '' }), /software/);
    const { state } = m4.seqState();
    const before = snapshot(state);
    seqCsv(state);
    assert.equal(snapshot(state), before);
});

test('[sasfit-report] sequenceCsv：停止的序列，未跑的列狀態是 pending、數值為空', () => {
    const { state } = m4.seqState({ steps: [{ values: { radius: 50.12 } }] });
    const { header, rows } = h.splitCsv(seqCsv(state));
    assert.equal(rows.length, 3);
    assert.equal(rows[2][header.indexOf('status')], 'pending');
    assert.equal(rows[2][header.indexOf('radius')], '');
    assert.ok(seqCsv(state).includes('# outcome: stopped\n'));
});
