'use strict';
/**
 * 消光係數單位換算與串接（v4.12）。
 *
 * 三個單位在光束線現場天天被混用，一錯就是 1000 倍：
 *   ε        [M⁻¹cm⁻¹]      Pace 1995 序列估計，蛋白質分析頁顯示
 *   ε_mass   [mL·mg⁻¹·cm⁻¹] = ε / MW[Da]，就是 A280 (0.1%)；HPLC dn/dc 頁的輸入
 *   ASTRA    [mL·g⁻¹·cm⁻¹]  = ε_mass × 1000；.afe7 的 m_dUVExtinctionCoefficient
 *
 * BSA 錨點：序列 ε = 42,925、MW = 66,463 Da ⇒ ε_mass = 0.646、ASTRA 645.8。
 * 文獻實測 A280(0.1%) = 0.667（.afe7 內存 667），序列估計本來就會略低，
 * 兩個數字都要能同時出現在畫面上，使用者才知道差異是預期的。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Protein, AstraUi } = require('./load.js');

const BSA_SEQUENCE =
    'DTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKD' +
    'DSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLTSSARQRLRCASIQKFGERALKAWS' +
    'VARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEA' +
    'KDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRS' +
    'LGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHK' +
    'PKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALA';

const BSA_EPSILON = 42925;          // M⁻¹cm⁻¹（5500×2 Trp + 1490×20 Tyr + 125×17 SS）
const BSA_MW = 66463.38;            // Da，本專案的殘基加成模型
const BSA_MASS_EXTINCTION = 0.646;  // mL·mg⁻¹·cm⁻¹（文獻實測 0.667）

const approx = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol,
        `${msg}: ${actual} != ${expected} (±${tol})`);

// ---------------------------------------------------------------- 換算本身
test('[ε] BSA 序列 ε 除以 MW 得到 ε_mass 0.646 與 ASTRA 645.8', () => {
    const r = Protein.calculateMassExtinction({ epsilon: BSA_EPSILON }, BSA_MW);
    approx(r.mlPerMgCm, BSA_MASS_EXTINCTION, 0.001, 'ε_mass');
    assert.equal(r.mlPerMgCm.toFixed(3), '0.646', 'HPLC dn/dc 欄位填的就是這個字串');
    assert.equal(r.mlPerGCm.toFixed(1), '645.8', 'ASTRA 單位（m_dUVExtinctionCoefficient）');
});

test('[ε] 兩個單位剛好差 1000 倍，不是各自算出來的', () => {
    for (const [eps, mw] of [[42925, 66463.38], [5500, 1000], [0, 12345]]) {
        const r = Protein.calculateMassExtinction({ epsilon: eps }, mw);
        approx(r.mlPerGCm, r.mlPerMgCm * 1000, 1e-9, `ε=${eps} MW=${mw}`);
    }
});

test('[ε] mlPerGCm 與既有的 calculateEpsilonCm2g 同值（cm²g⁻¹ 就是 mL·g⁻¹cm⁻¹）', () => {
    const ext = { epsilon: BSA_EPSILON };
    const legacy = Protein.calculateEpsilonCm2g(ext, BSA_MW);
    approx(Protein.calculateMassExtinction(ext, BSA_MW).mlPerGCm, legacy, 1e-9, '新舊一致');
});

test('[ε] 沒有芳香族殘基時 ε_mass = 0，不是錯誤', () => {
    const r = Protein.calculateMassExtinction({ epsilon: 0 }, 5000);
    assert.equal(r.mlPerMgCm, 0);
    assert.equal(r.mlPerGCm, 0);
});

// ---------------------------------------------------------------- 輸入驗證
test('[ε] MW 無效一律 throw，不回 Infinity/NaN 讓錯誤數字流進 dn/dc', () => {
    const ext = { epsilon: BSA_EPSILON };
    for (const mw of [0, -1, NaN, Infinity, null, undefined, '66463']) {
        assert.throws(() => Protein.calculateMassExtinction(ext, mw),
            /分子量/, `MW = ${String(mw)} 應該要 throw`);
    }
});

test('[ε] 消光係數資料無效也 throw', () => {
    for (const ext of [null, undefined, {}, { epsilon: NaN }, { epsilon: -1 }]) {
        assert.throws(() => Protein.calculateMassExtinction(ext, BSA_MW),
            /消光係數/, `extinctionData = ${JSON.stringify(ext)} 應該要 throw`);
    }
});

// ---------------------------------------------------------------- analyzeProtein
test('[ε] analyzeProtein(BSA) 帶回 massExtinction，數字與單獨呼叫一致', () => {
    const r = Protein.analyzeProtein(BSA_SEQUENCE);
    assert.equal(r.error, false);
    assert.equal(r.extinction.epsilon, BSA_EPSILON);
    approx(r.molecularWeight, BSA_MW, 0.01, 'MW');

    assert.ok(r.massExtinction, 'analyzeProtein 應回傳 massExtinction');
    approx(r.massExtinction.mlPerMgCm, BSA_MASS_EXTINCTION, 0.001, 'ε_mass');
    approx(r.massExtinction.mlPerGCm, r.epsilonCm2g, 1e-9, 'ASTRA 單位 = 既有 epsilonCm2g');
});

test('[ε] 還原態半胱氨酸沒有二硫鍵貢獻，ε_mass 跟著降', () => {
    const composition = Protein.parseSequence(BSA_SEQUENCE).composition;
    const reduced = Protein.calculateExtinctionCoeff(composition, true);
    assert.equal(reduced.epsilon, 40800, '42,925 − 17×125');
    const r = Protein.calculateMassExtinction(reduced, BSA_MW);
    assert.equal(r.mlPerMgCm.toFixed(3), '0.614');
});

// ---------------------------------------------------------------- .afe7 UV 摘要
const BSA_AFE7 = Object.freeze({
    sample: { name: 'BSA', uvExtinction: 667 },
    uvConfigured: true,
    hasUvChannel: false,
    allChannels: [{ dnCode: 12025, label: 'RI_Aux', instrument: 'WNGOInstrument' }],
});

test('[afe7] 有 UV 消光係數時同時給兩個單位（667 → 0.667）', () => {
    const lines = AstraUi.describeAstraUv(BSA_AFE7);
    assert.equal(lines[0],
        '檔案內 UV 消光係數：667 mL·g⁻¹·cm⁻¹（= 0.667 mL·mg⁻¹·cm⁻¹）');
});

test('[afe7] 有設定 UV 儀器但沒有 UV 時間序列 → 明確說「不影響 ASTRA-style 擬合」', () => {
    const lines = AstraUi.describeAstraUv(BSA_AFE7);
    assert.equal(lines.length, 2);
    assert.equal(lines[1],
        '⚠️ 此檔未含 UV 數據（ASTRA 有設定 Generic UV 儀器，但沒有 UV 時間序列）'
        + '——ASTRA-style 擬合不需要 UV；若要走 UV+RI 請從 ChemStation 匯出 CSV');
});

test('[afe7] 完全沒設定 UV 儀器 → 一句話講完，不要嚇使用者', () => {
    const lines = AstraUi.describeAstraUv({
        sample: { name: 'X', uvExtinction: null },
        uvConfigured: false,
        hasUvChannel: false,
        allChannels: [],
    });
    assert.deepEqual(lines, ['此檔未設定 UV 儀器，無 UV 數據']);
});

test('[afe7] 有 UV 通道時報出通道名稱，取代警告', () => {
    const lines = AstraUi.describeAstraUv({
        sample: { name: 'X', uvExtinction: 667 },
        uvConfigured: true,
        hasUvChannel: true,
        allChannels: [
            { dnCode: 12025, label: 'RI_Aux', instrument: 'WNGOInstrument' },
            { dnCode: 12777, label: 'UV_280', instrument: 'WGenericUVInstrument' },
        ],
    });
    assert.equal(lines.length, 2);
    assert.equal(lines[1], 'UV 通道：UV_280');
    assert.ok(!lines.some(l => l.includes('未含 UV 數據')), '有通道就不該再警告');
});

test('[afe7] 沒有解析結果時不編故事', () => {
    assert.deepEqual(AstraUi.describeAstraUv(null), []);
    assert.deepEqual(AstraUi.describeAstraUv(undefined), []);
});

test('[afe7] 非整數的消光係數保留一位小數，換算仍是三位', () => {
    const lines = AstraUi.describeAstraUv({
        sample: { uvExtinction: 646.44 },
        uvConfigured: false,
        hasUvChannel: false,
        allChannels: [],
    });
    assert.equal(lines[0],
        '檔案內 UV 消光係數：646.4 mL·g⁻¹·cm⁻¹（= 0.646 mL·mg⁻¹·cm⁻¹）');
});

// ---------------------------------------------------------------- 多檔合併
test('[afe7] 多檔訊息相同時只顯示一次並標明檔案數', () => {
    const groups = AstraUi.summarizeAstraUvFiles([
        { fileName: 'a_10uL.afe7', ...BSA_AFE7 },
        { fileName: 'b_20uL.afe7', ...BSA_AFE7 },
        { fileName: 'c_50uL.afe7', ...BSA_AFE7 },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].heading, '（3 個檔案相同）');
    assert.equal(groups[0].lines.length, 2);
});

test('[afe7] 單檔不加多餘標題', () => {
    const groups = AstraUi.summarizeAstraUvFiles([{ fileName: 'a.afe7', ...BSA_AFE7 }]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].heading, null);
});

test('[afe7] 訊息不同就分組列出各自的檔名', () => {
    const noUv = {
        fileName: 'no_uv.afe7',
        sample: { uvExtinction: null },
        uvConfigured: false,
        hasUvChannel: false,
        allChannels: [],
    };
    const groups = AstraUi.summarizeAstraUvFiles([
        { fileName: 'a.afe7', ...BSA_AFE7 },
        noUv,
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map(g => g.heading), ['a.afe7', 'no_uv.afe7']);
});

test('[afe7] 空清單不產生摘要區塊', () => {
    assert.deepEqual(AstraUi.summarizeAstraUvFiles([]), []);
    assert.deepEqual(AstraUi.summarizeAstraUvFiles(null), []);
});
