'use strict';
/**
 * 數值不變測試（改版規格 §8.3，v5.2 結果磚）。
 *
 * 各頁的結果 HTML 都由純函式產生（*ResultsHtml、LiposomeSection.resultsHtml）。本檔用固定輸入呼叫，
 * 經 tests/result-pairs.js 摘要後與 v5.1 擷取的 fixture 比對：pairs（標籤｜數值）與 alerts 必須相同，
 * numbers（所有數字）必須等於 fixture 加上該案例列出的 extraNumbers。版面（順序、主角、列表）可以變。
 *
 * fixture 只在 v5.1 標記下擷取一次（Task 2），之後不應再更新：
 *   GOLDEN_UPDATE=1 node --test saxs-calculator/tests/result-golden.test.js
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Protein, Dndc, SAXS } = require('./load.js');
const { summarize } = require('./result-pairs.js');

const JS = path.join(__dirname, '..', 'js');
const FIXTURE = path.join(__dirname, 'fixtures', 'result-golden-v5.1.json');
const UPDATE = process.env.GOLDEN_UPDATE === '1';

// classic script 以裸名稱取用這些模組；load.js 把它們掛在另一個 window 物件上
['FormUtils', 'MassUnits', 'SAXSCalculations', 'DndcCalculations', 'LiposomeCalculations', 'ResultTiles']
    .forEach(name => { globalThis[name] = window[name]; });
// dndc-ui.js 頂層會註冊 DOMContentLoaded；純函式本身不碰 document
globalThis.document = { addEventListener() {}, getElementById: () => null };

[
    'alerts.js', 'dndc-ui.js', 'section-protein.js', 'section-saxs.js', 'section-sample.js', 'section-mw.js',
    'section-centrifuge.js', 'dndc-theory-ui.js', 'dndc-hplc-results.js', 'dndc-multi-ui.js', 'dndc-slice-ui.js',
    'section-liposome.js',
].forEach(file => {
    const full = path.join(JS, file);
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
});
const Lipo = window.LiposomeSection.resultsHtml;

const HEWL = 'KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL';
const PROTEIN = Object.freeze({ molecularWeight: 69293.82, dryVolume: 87005.4 });
const SAXS_FULL = Object.freeze({
    wavelength: 1.03321, concentration: 2, i0Guinier: 0.105, rgGuinier: 28.1, guinierQmax: 0.04,
    i0Pr: 0.104, rgPr: 28.3, dmax: 85, porodVolume: 110000, mwFromPorod: 66666.7,
});
const ratio = (mw, ref) => (mw / ref).toFixed(2);
const LIPO_DILUTION = Object.freeze({
    factor: 0.45231, sd: 0.01234, n: 40, qCovered: [0.0213, 0.1487], lsqScale: 0.45012,
    excluded: { outOfRange: 2, nonPositive: 1 }, flags: { factorAboveOne: false, lowCoverage: true },
});
const LIPO_SPECTRA = Object.freeze({
    a: { values: [0.123456, 0.234567, 0.198765], sd: 0.00123 },
    subtracted: { wavelength: new Array(301).fill(0), dropped: 3 },
    fit: { k: 0.98765, rms: 0.000987, n: 301, flags: { negativeScale: true } },
});
const LIPO_DL = Object.freeze({
    dl: 0.123456, dlSd: 0.004567, relA: 0.0123, relF: 0.0234, dlSdExcel: 0.001234,
    doxConc: 0.000987, doxSd: 0.0000321, lipidActual: 0.00799, aPrimary: 0.234567, sdA: 0.00123,
    params: { wavelengths: [480, 495, 510], factor: 0.45231, factorSource: 'saxs' },
    flags: { epsilonWavelengthMismatch: false, absorbanceAboveLinear: true, wavelengthSpreadHigh: false },
});

/** 每個案例：name、html()、extraNumbers（v5.2 新增、刻意重複顯示的數字，例如主角膠囊上的比值） */
const CASES = Object.freeze([
    { name: 'protein', html: () => proteinResultsHtml(ProteinAnalysisResult(), 'HEWL <test>') },
    {
        name: 'saxs-porod-hero', html: () => saxsResultsHtml(SAXS_FULL, PROTEIN),
        extraNumbers: [ratio(66666.7, 69293.82)],
    },
    {
        name: 'saxs-guinier-hero-qrg-warning',
        html: () => saxsResultsHtml({ ...SAXS_FULL, guinierQmax: 0.05, porodVolume: NaN, mwFromPorod: null }, PROTEIN),
        extraNumbers: ['0', ratio(SAXS.calculateMwFromI0(0.105, 2), 69293.82)],
    },
    {
        name: 'saxs-no-protein',
        html: () => saxsResultsHtml({ ...SAXS_FULL, mwFromPorod: null, porodVolume: NaN }, null),
    },
    {
        name: 'saxs-empty',
        html: () => saxsResultsHtml({
            wavelength: 1.03321, concentration: 0, i0Guinier: NaN, rgGuinier: NaN, guinierQmax: NaN,
            i0Pr: NaN, rgPr: NaN, dmax: NaN, porodVolume: NaN, mwFromPorod: null,
        }, PROTEIN),
    },
    {
        name: 'sample', html: () => sampleResultsHtml({
            concentration: 1.2345678, concentrationMolar: 17.8123, absorbance: 0.5, pathLength: 1, epsilon: 43824, mw: 66430.3,
        }),
    },
    { name: 'dilution-with-uv', html: () => dilutionFactorResultsHtml({ injectedVolume: 100, dilutionFactor: 12.3456, uvConcentration: 5.4321 }) },
    { name: 'dilution-no-uv', html: () => dilutionFactorResultsHtml({ injectedVolume: 50, dilutionFactor: 8.1, uvConcentration: null }) },
    {
        name: 'mw-forward-dimer', html: () => mwResultsHtml({
            mode: 'forward', retentionTime: 7.26412, massResolution: 3500, oligomer: 2, mw: 138587.64, poreSize: 100, flowRate: 0.35,
        }, 69293.82),
    },
    {
        name: 'mw-forward-no-resolution', html: () => mwResultsHtml({
            mode: 'forward', retentionTime: 9.5, massResolution: null, oligomer: 1, mw: 14313.1, poreSize: 300, flowRate: 0.5,
        }, undefined),
    },
    {
        name: 'mw-reverse-with-protein', html: () => mwResultsHtml({
            mode: 'reverse', estimatedMw: 101234.5, massResolution: 3600, retentionTime: 12.5, poreSize: 300, flowRate: 0.5,
        }, 69293.82),
    },
    {
        name: 'mw-reverse-no-protein', html: () => mwResultsHtml({
            mode: 'reverse', estimatedMw: 71234.5, massResolution: 3600, retentionTime: 12.5, poreSize: 300, flowRate: 0.5,
        }, undefined),
    },
    {
        name: 'centrifuge', html: () => centrifugeResultsHtml({
            rcf: 15000.4, sedimentationCoeffSvedberg: 4.567, particleRadius: 2.789, buoyancyFactor: 0.2701,
            velocity: 0.0001234, time: 30, distance: 0.2222, radius: 8.5, rpm: 13000,
        }),
    },
    { name: 'dndc-correction', html: () => dndcCorrectionResultsHtml(Dndc.comprehensiveCorrection(0.185, 25, 589, 20, 658)) },
    { name: 'dndc-ll', html: () => llResultsHtml(0.187654, 0.190123) },
    {
        name: 'hplc-dndc-height', html: () => hplcDndcResultsHtml({
            dndc: 0.18523, concentration: 1.2345, riPeakValue: 2.3456e-4, riValue: 2.2e-4, peakMode: 'height',
            alignmentInfo: { lag: 1.2345, correlation: 0.97, skipped: false, clamped: false, reason: null }, warnings: [],
        }, { peakMode: 'height' }, []),
    },
    {
        name: 'hplc-dndc-area-skipped', html: () => hplcDndcResultsHtml({
            dndc: 0.000456, concentration: null, riPeakValue: 1.1e-3, riValue: null, peakMode: 'area <b>',
            alignmentInfo: { lag: 0, correlation: null, skipped: true, clamped: false, reason: 'manual concentration supplied' },
            warnings: ['來自結果 <i>1</i>'],
        }, { peakMode: 'area' }, ['參數警告']),
    },
    {
        name: 'multi-manual', html: () => multiFitResultsHtml(
            { dnDc: 0.18512, rSquared: 0.999543, intercept: -1.23e-6, stdError: 4.56e-4 },
            multiFitSource('manual'), 5, []),
    },
    {
        name: 'multi-astra-low-r2', html: () => multiFitResultsHtml(
            { dnDc: 0.17, rSquared: 0.9712, intercept: 2.5e-5, stdError: 1.2e-3 },
            multiFitSource('astra'), 4, ['負斜率 <x>']),
    },
    {
        name: 'slice', html: () => sliceResultsHtml({
            dndc: 0.1849, fitResult: { rSquared: 0.99891, intercept: 1.1e-6, stdError: 2.2e-4, slope: 0.1849 },
            sliceCount: 42, warnings: ['結果警告'],
        }, ['參數警告']),
    },
    { name: 'lipo-dilution', html: () => Lipo.dilution(LIPO_DILUTION, 0.02, 0.15) },
    { name: 'lipo-spectra', html: () => Lipo.spectra(LIPO_SPECTRA.a, LIPO_SPECTRA.subtracted, LIPO_SPECTRA.fit) },
    { name: 'lipo-spectra-no-fit', html: () => Lipo.spectra(LIPO_SPECTRA.a, { ...LIPO_SPECTRA.subtracted, dropped: 0 }, null) },
    { name: 'lipo-dl', html: () => Lipo.dl(LIPO_DL) },
]);

function ProteinAnalysisResult() {
    return Protein.analyzeProtein(HEWL);
}

const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : {};
const captured = {};

CASES.forEach(c => {
    test(`[golden] ${c.name}`, () => {
        const got = summarize(c.html());
        if (UPDATE) {
            captured[c.name] = got;
            return;
        }
        const want = fixture[c.name];
        assert.ok(want, `fixture 沒有 ${c.name}：先在 v5.1 標記下以 GOLDEN_UPDATE=1 擷取`);
        assert.deepEqual(got.pairs, want.pairs, '標籤｜數值');
        assert.deepEqual(got.alerts, want.alerts, '提示框文字');
        assert.deepEqual(got.numbers, [...want.numbers, ...(c.extraNumbers || [])].sort(), '所有數字');
    });
});

test('[golden] fixture 與案例一一對應（沒有遺漏、沒有殘留）', { skip: UPDATE && '擷取模式' }, () => {
    assert.deepEqual(Object.keys(fixture).sort(), CASES.map(c => c.name).sort());
});

after(() => {
    if (UPDATE) fs.writeFileSync(FIXTURE, `${JSON.stringify(captured, null, 2)}\n`);
});
