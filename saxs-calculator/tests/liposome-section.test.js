'use strict';
/**
 * section-liposome.js 的 stub-DOM 測試：載入真正的 section / calc / parser / results-table /
 * FormUtils / A11y 模組，DOM 只 stub 到 getElementById 與元素的 value / files / disabled /
 * hidden / innerHTML / 屬性 / 事件監聽。目的不是驗公式（tests/liposome.test.js 管），
 * 而是釘住 UI 狀態機：必要元素檢查、讀檔期間的按鈕停用、面板 2 的原子更新、
 * 十個欄位的快照作廢、殘留警告清除、q 視窗來源、未命名樣品計數、讀檔錯誤訊息、跳脫。
 *
 * 隔離：stub 的 window / document 只在本檔建立，after() 還原；模組先從 require.cache 清掉
 * 再載入，所以 tests/load.js 那條線（掛在另一個 window 物件上）不受影響。
 * node --test 預設每個檔各自一個 process，這裡仍照規矩收拾。
 *
 * SAXS 真實曲線的情境讀 tests/fixtures-local/liposome/*.dat（gitignore），不存在就 skip；
 * 光譜與合成 SAXS 曲線都在本檔產生。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'js');
const FIX = path.join(__dirname, 'fixtures-local', 'liposome');
const SOLUTION = path.join(FIX, 'solution.dat');
const BYPASS = path.join(FIX, 'bypass.dat');
const fixtures = fs.existsSync(SOLUTION) && fs.existsSync(BYPASS);
const needsFixtures = { skip: !fixtures && '本地 fixture 不存在' };

// ---------------------------------------------------------------- stub DOM
const elements = new Map();

function makeElement(id) {
    const listeners = {};
    const attrs = {};
    const node = {
        id, value: '', files: [], disabled: false, hidden: false, textContent: '', className: '', innerHTML: '', maxLength: -1,
        listeners,
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        /** 回 { accepted, done }：done 等所有 handler（含 async）結束。disabled 的按鈕不接受 click。 */
        dispatch(type) {
            if (type === 'click' && node.disabled) return { accepted: false, done: Promise.resolve() };
            const results = (listeners[type] || []).map(fn => fn({ target: node }));
            return { accepted: true, done: Promise.all(results) };
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        removeAttribute(k) { delete attrs[k]; },
        getAttribute(k) { return Object.hasOwn(attrs, k) ? attrs[k] : null; },
        focus() {},
        scrollIntoView() {},
    };
    elements.set(id, node);
    return node;
}

const IDS = [
    'lipoSolutionFile', 'lipoBypassFile', 'lipoQMin', 'lipoQMax', 'lipoComputeDilution', 'lipoDilutionResults',
    'lipoDilutionFactor', 'lipoDilutionChip', 'lipoFactorEcho', 'lipoDilutionPng', 'lipoLoadedFile', 'lipoBlankFile', 'lipoPureFile',
    'lipoComputeSpectra', 'lipoSpectraResults', 'lipoFitChartWrap', 'lipoSpectraPng', 'lipoFitPng', 'lipoWl1', 'lipoWl2', 'lipoWl3',
    'lipoAbs1', 'lipoAbs2', 'lipoAbs3', 'lipoAbsChip', 'lipoAbsSummary', 'lipoSampleName', 'lipoComputeDl', 'lipoDlResults', 'lipoAddResult',
    'lipoFitMin', 'lipoFitMax', 'lipoEpsilon', 'lipoPathLength', 'lipoLipidConc',
    'lipoResultsBody', 'lipoResultsWrapper', 'lipoResultsEmpty', 'lipoResultsAbsHeader', 'lipoResultsCount', 'lipoExportCsv',
    'lipoClearResults', 'lipoClearDialog', 'lipoClearCancel', 'lipoResultsAlert', 'lipoDilutionChart', 'lipoSpectraChart', 'lipoFitChart',
];
IDS.forEach(makeElement);
const $ = id => elements.get(id);

const DEFAULT_VALUES = Object.freeze({
    lipoQMin: '0.1', lipoQMax: '0.15', lipoWl1: '494', lipoWl2: '495', lipoWl3: '496',
    lipoFitMin: '450', lipoFitMax: '550', lipoEpsilon: '9250', lipoPathLength: '0.2', lipoLipidConc: '11.7',
});
const FILE_IDS = ['lipoSolutionFile', 'lipoBypassFile', 'lipoLoadedFile', 'lipoBlankFile', 'lipoPureFile'];
$('lipoSampleName').maxLength = 60;

function memoryStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: k => { map.delete(k); },
        clear: () => map.clear(),
        key: n => [...map.keys()][n] ?? null,
        get length() { return map.size; },
    };
}

// ---------------------------------------------------------------- 全域與模組（本檔專用，after() 還原）
const savedGlobals = { window: global.window, document: global.document };
const stubWindow = { localStorage: memoryStorage() };   // classic-script 全域：模組都掛在這裡
global.window = stubWindow;
global.document = { getElementById: id => elements.get(id) || null };

const MODULES = ['form-utils.js', 'a11y-utils.js', 'liposome-calculations.js', 'liposome-file-parsers.js',
    'liposome-charts.js', 'liposome-results-table.js', 'section-liposome.js'].map(f => path.join(JS, f));
const SECTION = MODULES[MODULES.length - 1];

function requireFresh(file) {
    delete require.cache[require.resolve(file)];
    require(file);
}
MODULES.slice(0, -1).forEach(requireFresh);

const Calc = stubWindow.LiposomeCalculations;
const Table = stubWindow.LiposomeResultsTable;
const RealCharts = stubWindow.LiposomeCharts;   // 只用它的 destroyChart / getChart（不需要 Chart.js）

const alerts = [];
const chartCalls = [];
const destroyed = [];
const liveCharts = new Map();
let readDelayMs = 0;
let readFailure = null;

stubWindow.showAlert = (id, type, msg) => {
    const container = $(id);
    alerts.push({ id, type, msg });
    stubWindow.A11y.markLiveRegion(container, type);
    container.innerHTML = `<div class="alert alert-${type}">${stubWindow.FormUtils.escapeHtml(msg)}</div>`;
};
stubWindow.clearAlert = (id) => { $(id).innerHTML = ''; };
stubWindow.downloadChartPng = () => {};
stubWindow.downloadCsv = () => {};
stubWindow.LiposomeCharts = {
    getChart: id => liveCharts.get(id) || null,
    destroyChart(id) { destroyed.push(id); liveCharts.delete(id); },
    renderDilutionChart(id, p) { chartCalls.push(['dilution', p.factor]); liveCharts.set(id, {}); },
    renderSpectraChart(id, p) { chartCalls.push(['spectra', p.wavelengths.slice()]); liveCharts.set(id, {}); },
    renderFitChart(id) { chartCalls.push(['fit']); liveCharts.set(id, {}); },
};
stubWindow.DndcFileParser = {
    readFile: file => (readFailure
        ? Promise.reject(readFailure)
        : new Promise(resolve => setTimeout(() => resolve(file.text), readDelayMs))),
};

function freshSection() {
    requireFresh(SECTION);
    return stubWindow.LiposomeSection;
}

let shared = null;
/** 共用的一個已 init 的 section；只 init 一次，避免 stub 元素被重複綁事件。 */
function section() {
    if (!shared) {
        shared = freshSection();
        shared.init();
    }
    return shared;
}

after(() => {
    MODULES.forEach(file => { delete require.cache[require.resolve(file)]; });
    for (const [name, value] of Object.entries(savedGlobals)) {
        if (value === undefined) delete global[name];
        else global[name] = value;
    }
});

// ---------------------------------------------------------------- 資料與操作小工具
function syntheticSpectra(k, step = 1, from = 400, to = 600) {
    const wavelength = [];
    for (let w = from; w <= to + 1e-9; w += step) wavelength.push(Number(w.toFixed(4)));
    const blankA = wavelength.map(w => 2 * Math.exp(-w / 150));
    const pureA = wavelength.map(w => Math.exp(-((w - 495) ** 2) / (2 * 25 ** 2)));
    const loadedA = blankA.map((b, j) => b + k * pureA[j]);
    return {
        loaded: { wavelength, absorbance: loadedA },
        blank: { wavelength, absorbance: blankA },
        pure: { wavelength, absorbance: pureA },
    };
}

/** 合成 SAXS 曲線文字（q, I, err）：Guinier 型，scale 就是相對強度。 */
function saxsText(scale) {
    const lines = [];
    for (let k = 0; k <= 295; k++) {
        const q = Number((0.005 + k * 0.001).toFixed(6));
        const i = scale * 10 * Math.exp(-((30 * q) ** 2) / 3);
        lines.push(`${q} ${i} ${i * 0.01}`);
    }
    return lines.join('\n');
}

const spectrumText = s => s.wavelength.map((w, j) => `${w} ${s.absorbance[j]}`).join('\n');
const fileOf = (name, text, size) => ({ name, size: size ?? Buffer.byteLength(text, 'utf8'), text });
const fixtureFile = p => fileOf(path.basename(p), fs.readFileSync(p, 'utf8'));

function setFile(id, file) {
    $(id).files = file ? [file] : [];
    $(id).dispatch('change');
}
function setSaxsFiles(solution, bypass) {
    setFile('lipoSolutionFile', solution);
    setFile('lipoBypassFile', bypass);
}
function setSpectraFiles(s, { pure }) {
    setFile('lipoLoadedFile', fileOf('loaded.txt', spectrumText(s.loaded)));
    setFile('lipoBlankFile', fileOf('blank.txt', spectrumText(s.blank)));
    setFile('lipoPureFile', pure ? fileOf('pure.txt', spectrumText(s.pure)) : null);
}

async function click(id) {
    const r = $(id).dispatch('click');
    await r.done;
    return r.accepted;
}
function input(id, value) {
    $(id).value = value;
    $(id).dispatch('input');
}
function setManualAbs(a1, a2, a3) {
    input('lipoAbs1', String(a1));
    input('lipoAbs2', String(a2));
    input('lipoAbs3', String(a3));
}
const absValues = () => ['lipoAbs1', 'lipoAbs2', 'lipoAbs3'].map(id => $(id).value);

/** 每個情境開頭：輸入框回預設值、清掉檔案與記錄；不動 section state（各情境自己建立需要的狀態）。 */
function resetInputs() {
    Object.entries(DEFAULT_VALUES).forEach(([id, v]) => { $(id).value = v; });
    FILE_IDS.forEach(id => { $(id).files = []; });
    $('lipoSampleName').value = '';
    alerts.length = 0;
    chartCalls.length = 0;
    destroyed.length = 0;
    readDelayMs = 0;
    readFailure = null;
}

// ---------------------------------------------------------------- S0 init
test('[lipo-section] S0 缺少必要元素：console.error 且不 throw、不綁事件；第二次 init 是 no-op', () => {
    const errors = [];
    const originalError = console.error;
    console.error = msg => errors.push(String(msg));
    const savedNode = elements.get('lipoFitPng');
    elements.delete('lipoFitPng');
    try {
        assert.doesNotThrow(() => freshSection().init());
    } finally {
        elements.set('lipoFitPng', savedNode);
        console.error = originalError;
    }
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^\[liposome\] 缺少元素：lipoFitPng$/);
    assert.equal($('lipoComputeDilution').listeners.click, undefined, '缺元素時不得綁事件');

    const S = section();
    S.init();
    assert.equal($('lipoComputeDilution').listeners.click.length, 1, '重複 init 不得重複綁事件');
    assert.deepEqual(S.getState().dilution, { factor: null, sd: 0, n: 0, source: null, qMin: null, qMax: null });
    assert.equal($('lipoAddResult').disabled, true);
    assert.equal($('lipoDilutionChip').hidden, true);
});

// ---------------------------------------------------------------- S1 稀釋因子（真實曲線）
test('[lipo-section] S1 稀釋因子：真實曲線 → 0.4386 ± 1%、n = 40、chip「SAXS 計算」、state 凍結', needsFixtures, async () => {
    const S = section();
    resetInputs();
    setSaxsFiles(fixtureFile(SOLUTION), fixtureFile(BYPASS));
    assert.equal($('lipoComputeDilution').disabled, false, '兩檔都選了才啟用');
    assert.equal(await click('lipoComputeDilution'), true);

    const d = S.getState().dilution;
    assert.ok(Math.abs(d.factor / 0.4386 - 1) < 0.01, `factor ${d.factor}`);
    assert.equal(d.n, 40);
    assert.deepEqual([d.source, d.qMin, d.qMax], ['saxs', 0.1, 0.15]);
    assert.ok(!('lsqScale' in d), 'lsqScale 只渲染不進 state');
    assert.ok(Object.isFrozen(S.getState()) && Object.isFrozen(d));
    assert.equal($('lipoDilutionFactor').value, d.factor.toPrecision(6));
    assert.equal($('lipoDilutionChip').hidden, false);
    assert.equal($('lipoDilutionChip').textContent, 'SAXS 計算');
    assert.match($('lipoFactorEcho').textContent, /^SAXS 計算：0\.43\d\d ± 0\.01\d（n = 40）$/);
    assert.match($('lipoDilutionResults').innerHTML, /實際涵蓋 0\.\d{3}–0\.\d{3}，n = 40/);
    assert.equal($('lipoDilutionResults').getAttribute('role'), null, 'focusResults 清掉 live region');
    assert.deepEqual(chartCalls.at(-1), ['dilution', d.factor]);
    assert.equal($('lipoDilutionPng').disabled, false);
});

// ---------------------------------------------------------------- S2 讀檔期間的按鈕停用
test('[lipo-section] S2 讀檔期間按鈕停用：第二次點擊被擋、完成後恢復、只畫一次', async () => {
    const S = section();
    resetInputs();
    setSaxsFiles(fileOf('solution.dat', saxsText(1)), fileOf('bypass.dat', saxsText(0.45)));
    readDelayMs = 10;

    const first = $('lipoComputeDilution').dispatch('click');
    const second = $('lipoComputeDilution').dispatch('click');
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false, '讀檔中按鈕已停用');
    assert.equal($('lipoComputeDilution').disabled, true);
    await first.done;

    assert.equal($('lipoComputeDilution').disabled, false, 'finally 的 syncButtons 恢復');
    assert.equal(chartCalls.filter(c => c[0] === 'dilution').length, 1);
    assert.ok(Math.abs(S.getState().dilution.factor - 0.45) < 1e-9);
    assert.equal($('lipoDilutionResults').innerHTML.includes('alert-warning'), false, '合成曲線同形狀，不該有警告');
});

// ---------------------------------------------------------------- S3 光譜讀值與殘留警告
test('[lipo-section] S3 光譜讀值：五位小數、SD 用四捨五入值；波長超出範圍 → 錯誤且輸入不動；修正後結果與標線恢復', async () => {
    const S = section();
    resetInputs();
    setSpectraFiles(syntheticSpectra(0.8), { pure: true });
    assert.equal(await click('lipoComputeSpectra'), true);

    const st = S.getState();
    const shown = absValues();
    shown.forEach(v => assert.match(v, /^\d\.\d{5}$/));
    assert.equal(st.absorbance.sd, Calc.sampleStd(shown.map(Number)), 'SD 由四捨五入後的三值算');
    assert.equal(st.absorbance.source, 'spectrum');
    assert.ok(Object.isFrozen(st.spectra) && Object.isFrozen(st.absorbance) && Object.isFrozen(st.absorbance.values));
    assert.ok(Math.abs(st.spectra.fit.k - 0.8) < 1e-6);
    assert.equal($('lipoFitPng').hidden, false);
    assert.equal($('lipoFitChartWrap').hidden, false);
    assert.equal($('lipoSpectraResults').getAttribute('role'), null);
    assert.equal($('lipoAbsChip').textContent, '光譜讀值');
    assert.match($('lipoAbsSummary').textContent, /^光譜讀值：三點譜線離散（含譜帶斜率） \d/);
    assert.deepEqual(chartCalls.map(c => c[0]), ['spectra', 'fit']);
    const goodHtml = $('lipoSpectraResults').innerHTML;

    chartCalls.length = 0;
    input('lipoWl2', '700');
    assert.equal($('lipoSpectraResults').getAttribute('role'), 'alert');
    assert.match(alerts.at(-1).msg, /700 nm 超出光譜範圍/);
    assert.deepEqual(absValues(), shown, '錯誤時輸入框不動');
    assert.equal(chartCalls.length, 0, '錯誤時圖表不動');
    assert.equal(S.getState().dl, null);

    input('lipoWl2', '495');
    assert.equal($('lipoSpectraResults').getAttribute('role'), null, '重讀成功要清掉 role="alert"');
    assert.equal($('lipoSpectraResults').innerHTML, goodHtml, '結果區由結果取代錯誤訊息');
    assert.deepEqual(chartCalls.at(-1), ['spectra', [494, 495, 496]]);

    input('lipoWl2', '500');
    const card = $('lipoSpectraResults').innerHTML.match(/stat-value">([\d.]+)/)[1];
    assert.equal(card, $('lipoAbs2').value, 'stat-card 與輸入框同一個值');
    assert.deepEqual(chartCalls.at(-1), ['spectra', [494, 500, 496]], '標線跟著讀值波長');
    assert.equal($('lipoResultsAbsHeader').textContent, 'A(500 nm)', '主波長改了，結果表表頭跟著改');
    input('lipoWl2', '495');
});

// ---------------------------------------------------------------- S4 原子更新
test('[lipo-section] S4 原子更新：重算中途失敗 → state、輸入、圖表、chip 全不動；之後無純 DOX → 擬合圖銷毀並隱藏', async () => {
    const S = section();
    resetInputs();
    setSpectraFiles(syntheticSpectra(0.8), { pure: true });
    await click('lipoComputeSpectra');
    const before = S.getState();
    const absBefore = absValues();

    input('lipoWl2', '700');                                  // 讓第三步 absorbanceAt 失敗
    setSpectraFiles(syntheticSpectra(0.5), { pure: false });   // 新檔案不得進 state
    alerts.length = 0;
    chartCalls.length = 0;
    destroyed.length = 0;
    assert.equal(await click('lipoComputeSpectra'), true);

    const st = S.getState();
    assert.equal(st.spectra, before.spectra, 'spectra 同一個物件');
    assert.equal(st.absorbance, before.absorbance, 'absorbance 同一個物件');
    assert.ok(st.spectra.fit, '舊的擬合還在');
    assert.deepEqual(absValues(), absBefore);
    assert.equal($('lipoFitPng').hidden, false);
    assert.equal($('lipoFitChartWrap').hidden, false);
    assert.equal(chartCalls.length, 0);
    assert.deepEqual(destroyed, []);
    assert.equal($('lipoAbsChip').textContent, '光譜讀值');
    assert.match(alerts.at(-1).msg, /700 nm 超出光譜範圍/);
    assert.equal($('lipoComputeSpectra').disabled, false, 'finally 恢復按鈕');

    input('lipoWl2', '495');
    assert.equal(await click('lipoComputeSpectra'), true);
    const after2 = S.getState();
    assert.equal(after2.spectra.fit, null);
    assert.equal($('lipoAbs2').value, '0.50000', 'k = 0.5、純 DOX 在 495 nm 為 1');
    assert.equal($('lipoFitPng').hidden, true);
    assert.equal($('lipoFitChartWrap').hidden, true);
    assert.deepEqual(destroyed, ['lipoFitChart'], '沒有擬合時要銷毀上一張擬合圖');
    assert.equal($('lipoSpectraResults').getAttribute('role'), null);

    // 真正的 charts 模組：不存在的 canvas 是 no-op
    assert.doesNotThrow(() => RealCharts.destroyChart('lipoFitChart'));
    assert.equal(RealCharts.getChart('lipoFitChart'), null);
});

// ---------------------------------------------------------------- S5 q 視窗來源、失敗的 D/L
test('[lipo-section] S5a 手動因子的快照 q 視窗為 null；D/L 計算失敗 → 快照作廢、按鈕停用', async () => {
    const S = section();
    resetInputs();
    setManualAbs(0.79, 0.8, 0.79);
    input('lipoDilutionFactor', '0.45');
    assert.equal($('lipoDilutionChip').textContent, '手動');
    await click('lipoComputeDl');

    const p = S.getState().dl.params;
    assert.deepEqual([p.qMin, p.qMax, p.factorSource, p.factorSd, p.absSource], [null, null, 'manual', 0, 'manual']);
    assert.equal($('lipoAddResult').disabled, false);
    assert.equal($('lipoDlResults').getAttribute('role'), null);

    $('lipoEpsilon').value = '';
    await click('lipoComputeDl');
    assert.equal(S.getState().dl, null, '失敗時快照作廢');
    assert.equal($('lipoAddResult').disabled, true);
    assert.equal($('lipoDlResults').getAttribute('role'), 'alert');
    assert.match(alerts.at(-1).msg, /ε/);
    $('lipoEpsilon').value = DEFAULT_VALUES.lipoEpsilon;
});

test('[lipo-section] S5b SAXS 因子的快照取計算當下的 q 視窗，之後改 q 輸入框不影響', needsFixtures, async () => {
    const S = section();
    resetInputs();
    setManualAbs(0.79, 0.8, 0.79);
    setSaxsFiles(fixtureFile(SOLUTION), fixtureFile(BYPASS));
    await click('lipoComputeDilution');

    $('lipoQMin').value = '0.05';
    await click('lipoComputeDl');
    const p = S.getState().dl.params;
    assert.deepEqual([p.qMin, p.qMax, p.factorSource], [0.1, 0.15, 'saxs']);
    assert.equal(p.factorSd, S.getState().dilution.sd);
    assert.ok(p.factorSd > 0);
    $('lipoQMin').value = DEFAULT_VALUES.lipoQMin;
});

// ---------------------------------------------------------------- S6 手動輸入留空
test('[lipo-section] S6 手動吸光度留空 → state 存 null、SD 為 0、摘要提示；因子清空 → chip 隱藏與回顯一致', () => {
    const S = section();
    resetInputs();
    setManualAbs(0.79, 0.8, 0.79);
    input('lipoAbs2', '');
    const a = S.getState().absorbance;
    assert.deepEqual([...a.values], [0.79, null, 0.79]);
    assert.equal(a.sd, 0);
    assert.equal(a.source, 'manual');
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.values));
    assert.equal($('lipoAbsSummary').textContent, '手動：三個吸光度都填好才能算 D/L');
    assert.equal($('lipoAbsChip').textContent, '手動');
    input('lipoAbs2', '0.8');
    assert.match($('lipoAbsSummary').textContent, /^手動：三點譜線離散（含譜帶斜率） \d/);

    input('lipoDilutionFactor', '1.2');
    assert.equal($('lipoDilutionChip').hidden, false);
    assert.match($('lipoFactorEcho').textContent, /^手動因子 1\.200（> 1，請確認方向）/);
    input('lipoDilutionFactor', '');
    assert.equal(S.getState().dilution.factor, null);
    assert.equal($('lipoDilutionChip').hidden, true, '欄位清空後 chip 隱藏');
    assert.equal($('lipoFactorEcho').textContent, '尚未設定稀釋因子');
});

// ---------------------------------------------------------------- S7 結果表交接
test('[lipo-section] S7 未命名樣品計數只增不減；樣品名截到 maxlength 並跳脫；列凍結；寫入成功清掉表格警告', async () => {
    const S = section();
    resetInputs();
    setManualAbs(0.79, 0.8, 0.79);
    input('lipoDilutionFactor', '0.45');
    Table.clear();

    await click('lipoComputeDl');
    await click('lipoAddResult');
    assert.equal($('lipoAddResult').disabled, true, '加入後停用，直到下次計算');
    await click('lipoComputeDl');
    await click('lipoAddResult');
    assert.deepEqual(Table.getRows().map(r => r.sampleName), ['樣品 1', '樣品 2']);

    Table.remove(Table.getRows()[1].id);
    await click('lipoComputeDl');
    await click('lipoAddResult');
    assert.deepEqual(Table.getRows().map(r => r.sampleName), ['樣品 1', '樣品 3'], '刪掉 2 之後不重用 2');
    assert.ok(Table.getRows().every(r => Object.isFrozen(r) && Object.isFrozen(r.meta)));
    assert.deepEqual([Table.getRows()[0].meta.qMin, Table.getRows()[0].meta.qMax], [null, null]);
    assert.ok(S.getState().dl, '加入後快照保留，只停用按鈕避免重複加入');

    stubWindow.showAlert('lipoResultsAlert', 'error', '假的上限警告');
    $('lipoSampleName').value = '  ' + 'x'.repeat(80) + '  ';
    await click('lipoComputeDl');
    await click('lipoAddResult');
    assert.equal(Table.getRows().at(-1).sampleName.length, 60);
    assert.equal($('lipoResultsAlert').innerHTML, '', '寫入成功後警告清掉');

    $('lipoSampleName').value = 'A <b>x</b>';
    await click('lipoComputeDl');
    await click('lipoAddResult');
    assert.ok($('lipoResultsBody').innerHTML.includes('A &lt;b&gt;x&lt;/b&gt;'));
    assert.ok(!$('lipoResultsBody').innerHTML.includes('<b>'));
    $('lipoSampleName').value = '';
    Table.clear();
});

// ---------------------------------------------------------------- S8 讀檔錯誤
test('[lipo-section] S8 讀檔失敗、超過大小上限、沒選檔的訊息；清掉空白檔後光譜按鈕停用', async () => {
    section();
    resetInputs();
    setSaxsFiles(fileOf('solution.dat', 'x'), fileOf('bypass.dat', 'x'));
    readFailure = new Error('NotReadableError');
    await click('lipoComputeDilution');
    readFailure = null;
    assert.equal(alerts.at(-1).msg, '無法讀取 solution cell 檔案：NotReadableError');
    assert.equal($('lipoComputeDilution').disabled, false, '失敗後按鈕恢復');

    $('lipoSolutionFile').files = [fileOf('solution.dat', 'x', 6 * 1048576)];
    await click('lipoComputeDilution');
    assert.equal(alerts.at(-1).msg, 'solution cell 檔案 6.0 MB 超過上限 5 MB');

    $('lipoSolutionFile').files = [];
    $('lipoComputeDilution').disabled = false;   // 強制觸發 handler（正常情況按鈕已停用）
    await click('lipoComputeDilution');
    assert.equal(alerts.at(-1).msg, '請先選擇 solution cell 檔案');
    assert.equal($('lipoComputeDilution').disabled, true, 'finally 依檔案狀態重新停用');

    setSpectraFiles(syntheticSpectra(0.8), { pure: false });
    assert.equal($('lipoComputeSpectra').disabled, false);
    setFile('lipoBlankFile', null);
    assert.equal($('lipoComputeSpectra').disabled, true);
});

// ---------------------------------------------------------------- S9 科學旗標 → 警告列
test('[lipo-section] S9a 兩檔選反 → 因子 > 1 的警告列，文字經跳脫（稀釋因子 &gt; 1）', needsFixtures, async () => {
    const S = section();
    resetInputs();
    setSaxsFiles(fixtureFile(BYPASS), fixtureFile(SOLUTION));
    await click('lipoComputeDilution');
    const html = $('lipoDilutionResults').innerHTML;
    assert.ok(S.getState().dilution.factor > 1);
    assert.ok(html.includes('稀釋因子 &gt; 1：bypass 應比 solution cell 稀，通常代表兩個檔案選反'));
    assert.ok(!html.includes('稀釋因子 > 1'), '警告文字必須經 escapeHtml');
    assert.ok(!/<(?!\/?(div|span|p)\b)/.test(html), '結果區只該有 div / span / p 標籤');
});

test('[lipo-section] S9b 主波長 480 nm → ε 波長不符警告；Excel DOX-20 三值 → 三波長離散警告；SD 標籤改為譜線離散', async () => {
    section();
    resetInputs();
    setSpectraFiles(syntheticSpectra(0.8), { pure: false });
    await click('lipoComputeSpectra');
    input('lipoDilutionFactor', '0.45');
    input('lipoWl2', '480');
    await click('lipoComputeDl');
    let html = $('lipoDlResults').innerHTML;
    assert.match(html, /主波長 480 nm 與 ε 的量測波長 495 nm 不同，請改用對應波長的 ε/);
    assert.ok(html.includes('三點譜線離散（含譜帶斜率） 0.'), 'A(主波長) 的離散標籤');
    assert.ok(!/SD \d/.test(html), '不再用裸的「SD」');
    input('lipoWl2', '495');

    setManualAbs(0.74644, 1.05761, 0.89623);
    await click('lipoComputeDl');
    html = $('lipoDlResults').innerHTML;
    assert.match(html, /三個波長的吸光度相差超過 5%，平滑吸收帶不會如此，請檢查光譜/);
    assert.ok(!html.includes('ε 的量測波長'), '波長已回 495，不該再有 ε 警告');
});

// ---------------------------------------------------------------- S10 快照作廢
test('[lipo-section] S10 INVALIDATING_IDS：十個欄位任一 input 都作廢快照並停用「加入結果表」', async () => {
    const S = section();
    resetInputs();
    setManualAbs(0.79, 0.8, 0.79);
    input('lipoDilutionFactor', '0.45');
    const ids = ['lipoDilutionFactor', 'lipoAbs1', 'lipoAbs2', 'lipoAbs3', 'lipoWl1', 'lipoWl2', 'lipoWl3',
        'lipoLipidConc', 'lipoEpsilon', 'lipoPathLength'];
    for (const id of ids) {
        await click('lipoComputeDl');
        assert.ok(S.getState().dl, `${id}：計算後應有快照`);
        assert.equal($('lipoAddResult').disabled, false, `${id}：計算後加入鈕啟用`);
        $(id).dispatch('input');   // 值不變，只發事件
        assert.equal(S.getState().dl, null, `${id} input 後快照應作廢`);
        assert.equal($('lipoAddResult').disabled, true, `${id} input 後加入鈕應停用`);
    }
    $('lipoQMin').dispatch('input');
    await click('lipoComputeDl');
    $('lipoQMin').dispatch('input');
    assert.ok(S.getState().dl, 'q 視窗不在作廢名單（快照的 q 取自 state.dilution）');
});
