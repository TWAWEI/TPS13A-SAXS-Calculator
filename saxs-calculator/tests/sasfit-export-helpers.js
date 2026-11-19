'use strict';
/**
 * 匯出與 IUCr 測試（M4 Task 13–17）共用的固定小 fixture 與工具。
 *
 *   dataset(overrides?)   5 個資料點的一般檔 Dataset（q 0.01–0.05；σ 皆為 2 的負次方，殘差因此是整數或半整數）
 *   officialDataset()     同樣 5 點、kind 'official'、帶官方檔頭
 *   file(dataset?, name?) state.files 的一個項目
 *   sphereResult(options) 完整的 FitResult（鍵與 SasFitWorkerCore.buildFitResult 相同）：sphere，擬合 scale、radius，
 *                         範圍 q 0.015–0.05（第 1 點不參與）。options：weighting（'sigma'｜'none'…）、atUpper（radius 貼上限）、
 *                         status、其餘鍵直接覆寫
 *   coreShellResult(options)  core_shell_sphere@hardsphere，radius 開多分散（schulz）並擬合其寬度；options.beta、
 *                         options.structure（'hayter_msa'）、options.lowQ
 *   formOf(fitResult)     與結果相符的表單（resultMatchesForm 為 true）
 *   parseCsv(text)        小型 RFC 4180 解析器 → 列的陣列（每列是字串陣列）；不處理註解，呼叫端先濾掉
 *   splitCsv(text)        { comments: [字串], header: [欄名], rows: [[字串]] }
 */
require('./load.js');

const Q = [0.01, 0.02, 0.03, 0.04, 0.05];
const I = [10, 8, 6, 4, 2.5];
const SIGMA = [0.5, 0.25, 0.125, 0.0625, 0.5];
const CURVE = [10.5, 8.25, 5.875, 4.125, 2.75];
const RANGE = Object.freeze({ qMin: 0.015, qMax: 0.05 });
const HEADER = Object.freeze({
    outputName: 'B1216_out.dat', totalFrames: 10, energyKeV: 15, scalingFactor: 0.0125, sampleTransmission: 0.75,
    cellTransmission: 0.875, thicknessMm: 1.5, sddMm: 2500, qStart: 0.005, frameTimeS: 2,
});

function dataset(overrides = {}) {
    return Object.freeze({
        fileName: 'SYNTH_tiny.dat', kind: 'generic', header: null, q: Float64Array.from(Q), I: Float64Array.from(I),
        sigma: Float64Array.from(SIGMA), dq: null, condition: null, qUnit: 'A', ...overrides,
    });
}

const officialDataset = (overrides = {}) => dataset({ kind: 'official', header: HEADER, fileName: 'B1216_out.dat', ...overrides });

function file(data = dataset(), name) {
    return Object.freeze({ id: 'd1', fileName: name === undefined ? data.fileName : name, dataset: data, issues: [], issueOverflow: 0, notes: {}, condition: null });
}

function residualsOf(data, curve, weighting) {
    const picked = globalThis.SasFitWeighting.select(data, weighting, RANGE);
    const out = new Float64Array(data.q.length).fill(NaN);
    picked.index.forEach((i, k) => { out[i] = (data.I[i] - curve[i]) / picked.w[k]; });
    return out;
}

function build({ params, names, errors, modelSpec, weighting = 'sigma', chi2r = 2.25, status = 'converged', atBound = {}, data = dataset(), ...rest }) {
    const root = Math.sqrt(chi2r);
    const n = names.length;
    const identity = names.map((_, i) => names.map((__, j) => (i === j ? 1 : 0)));
    const curve = Float64Array.from(CURVE);
    return Object.freeze({
        params: Object.freeze(params), names: Object.freeze(names.slice()),
        errors: Object.freeze(Object.fromEntries(names.map((name) => [name, errors[name]]))),
        errorsScaled: Object.freeze(Object.fromEntries(names.map((name) => [name, errors[name] * root]))),
        displayErrorsScaled: weighting !== 'sigma', covariance: identity, correlation: identity,
        chi2: chi2r * (4 - n), chi2r, dof: 4 - n, iterations: 6, status, atBound: Object.freeze(atBound),
        illConditioned: false, blockedByNonFinite: false, jacobianNonFinite: false, nonFiniteCurvePoints: 0,
        curve, residuals: residualsOf(data, curve, weighting),
        settings: Object.freeze({ modelSpec: Object.freeze(modelSpec), weighting, range: RANGE, cutoff: 1e-5, maxSteps: 200, method: 'lm', ftol: 1e-10, xtol: 1e-10 }),
        ...rest,
    });
}

function sphereResult({ atUpper = false, ...options } = {}) {
    return build({
        params: { scale: 0.98, background: 0.001, sld: 1, sld_solvent: 6, radius: atUpper ? 60 : 50.0123456789 },
        names: ['scale', 'radius'], errors: { scale: 0.012, radius: 0.125 },
        modelSpec: { model: 'sphere', structure: null, lowQPowerLaw: false },
        atBound: atUpper ? { radius: 'upper' } : {}, ...options,
    });
}

function coreShellResult({ beta = false, structure = 'hardsphere', lowQ = false, ...options } = {}) {
    const sParams = structure === 'hayter_msa'
        ? { volfraction: 0.2, charge: 19, temperature: 318.16, concentration_salt: 0, dielectconst: 71.08 } : { volfraction: 0.2 };
    return build({
        params: {
            scale: 1, background: 0.001, radius: 60, radius_pd: 0.1, radius_pd_n: 80, radius_pd_nsigma: 3, radius_pd_type: 'schulz',
            thickness: 10, sld_core: 1, sld_shell: 2, sld_solvent: 3, ...sParams, ...(lowQ ? { lowq_scale: 0.5, lowq_power: 4 } : {}),
            structure_factor_mode: beta ? 1 : 0, radius_effective_mode: 1,
        },
        names: ['scale', 'radius', 'radius_pd'], errors: { scale: 0.02, radius: 0.5, radius_pd: 0.01 },
        modelSpec: { model: 'core_shell_sphere', structure, lowQPowerLaw: lowQ }, ...options,
    });
}

/** 與結果相符的表單：模型規格、數值、多分散設定與擬合勾選都照結果。 */
function formOf(fitResult) {
    const F = globalThis.SasFitForm;
    const { modelSpec } = fitResult.settings;
    const { params } = fitResult;
    let form = F.create(modelSpec.model);
    if (modelSpec.lowQPowerLaw) form = F.reduce(form, { type: 'setLowQ', on: true });
    if (modelSpec.structure !== null) {
        form = F.reduce(form, { type: 'setStructure', structure: modelSpec.structure });
        form = F.reduce(form, { type: 'setStructureMode', mode: params.structure_factor_mode });
        form = F.reduce(form, { type: 'setRadiusMode', mode: params.radius_effective_mode });
    }
    Object.keys(form.pds).filter((name) => Object.hasOwn(params, name + '_pd')).forEach((name) => {
        form = F.reduce(form, { type: 'togglePd', name });
        form = F.reduce(form, { type: 'setPdField', name, field: 'type', value: params[name + '_pd_type'] });
        form = F.reduce(form, { type: 'setPdField', name, field: 'npts', value: String(params[name + '_pd_n']) });
        form = F.reduce(form, { type: 'setPdField', name, field: 'nsigmas', value: String(params[name + '_pd_nsigma']) });
        form = F.reduce(form, { type: 'setPdField', name, field: 'width', value: String(params[name + '_pd']) });
        form = F.reduce(form, { type: 'setPdFit', name, fit: fitResult.names.includes(name + '_pd') });
    });
    Object.keys(form.fields).forEach((name) => {
        if (Object.hasOwn(params, name)) form = F.reduce(form, { type: 'setValue', name, value: String(params[name]) });
        form = F.reduce(form, { type: 'setFit', name, fit: fitResult.names.includes(name) });
    });
    return form;
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    return rows;
}

function splitCsv(text) {
    const lines = text.split('\n');
    const comments = lines.filter((line) => line.startsWith('#'));
    const [header, ...rows] = parseCsv(lines.filter((line) => !line.startsWith('#')).join('\n'));
    return { comments, header, rows };
}

module.exports = { dataset, officialDataset, file, sphereResult, coreShellResult, formOf, parseCsv, splitCsv, RANGE, HEADER };
