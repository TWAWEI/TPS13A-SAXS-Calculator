# 脂質體 DOX 載藥量（D/L）頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `saxs-calculator/` 新增一個公開分頁「脂質體 DOX 載藥」，取代本地 Excel 的 dilution／DL 工作表與 UV 扣背景步驟，上線為 v4.14。

**Architecture:** 三個無 DOM 的純模組（計算、檔案解析、圖表）＋兩個 UI 模組（三個面板、結果表）＋ index.html 一個 section。全部是 classic `<script>`，共用全域作用域；純模組與結果表用 IIFE 掛 `window.*`，可在 Node 直接 `require` 測試。狀態物件不就地修改，每次更新產生新物件。

**Tech Stack:** Vanilla JS（ES2020，無 build）、Chart.js 4.5.1 + chartjs-plugin-annotation 3.1.0（已載入）、`node --test`（Node 26）、既有工具 `FormUtils` / `A11y` / `showAlert` / `downloadCsv` / `DndcFileParser.readFile`。

**規格：** `docs/superpowers/specs/2026-09-05-liposome-dox-loading-design.md`（以下簡稱「規格」）。任何與規格衝突處以規格為準；本計畫刻意偏離規格的兩點在 Task 9 與 Task 11 標明。

**工作目錄：** 所有相對路徑以 `saxs-calculator/` 為根，除非寫成 `docs/…` 或 `.gitignore`。測試指令一律在 repo 根目錄 `/Users/hsutingwei/Desktop/TPS13A` 執行。

---

## 開工前必讀（沒有這些脈絡會踩雷）

1. **`tests/structure.test.js` 是守門員。** 它掃 `js/*.js`：(a) 每個檔都要出現在 index.html 的 `<script>`；(b) 跨檔不可有重複的**第 0 欄**頂層宣告（`const/let/var/class/function`）；(c) 每檔 ≤ 800 行；(d) `app.js` 最後。所以**每一個建立新 js 檔的 task，都要在同一個 commit 加 `<script>` 標籤**，否則測試紅。IIFE 內縮排的宣告不算頂層。
2. **CSP：** 不得用行內 `<script>`、`onclick=""`、新 CDN。所有事件用 `addEventListener`。
3. **任何使用者字串進 innerHTML 都要過 `FormUtils.escapeHtml`**（`escapeHtml()` 是它的全域薄包裝）。
4. **`showAlert(containerId, type, msg)`** 會取代整個容器的 innerHTML 並把 role 改成 alert；成功後要呼叫 `A11y.focusResults(containerId)` 把 role 拿掉並移焦點。
5. **`DndcFileParser.readFile(file)`** 回傳 `Promise<string>`。`FormUtils.readPositiveField(id, label)` / `FormUtils.parseFiniteNumber(raw, label)` 失敗會 throw 中文訊息，直接顯示即可。
6. 既有的頂層識別字 **`readFile`、`linearFit`、`_std`、`calculateDilutionFactor`、`escapeHtml`、`showAlert`、`STORAGE_KEY`** 都已被佔用，新檔不要在第 0 欄再宣告這些名字。
7. 測試風格看 `tests/extinction.test.js`：`'use strict'`、`node:test` + `node:assert/strict`、`require('./load.js')`、每個 test 名稱用 `[標籤] 中文描述`。
8. 跑全部測試：`node --test saxs-calculator/tests/*.test.js`。基準：109 passed。
9. Commit 訊息格式 `<type>: <description>`（feat / test / fix / docs / refactor），不要加 Co-Authored-By。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `js/liposome-calculations.js` | 建立 | 純計算：內插、樣本標準差、稀釋因子、光譜扣背景、純 DOX 縮放擬合、讀值、D/L 與誤差。掛 `window.LiposomeCalculations` |
| `js/liposome-file-parsers.js` | 建立 | `.dat` 與兩欄光譜文字解析、大小／點數上限。掛 `window.LiposomeFileParsers` |
| `js/liposome-charts.js` | 建立 | 三張 Chart.js 圖（稀釋 log-log、光譜、擬合），實例管理。掛 `window.LiposomeCharts` |
| `js/liposome-results-table.js` | 建立 | 結果表：localStorage 持久化、渲染、刪列、清空 dialog、CSV。掛 `window.LiposomeResultsTable` |
| `js/section-liposome.js` | 建立 | 三個面板的 UI 與狀態、來源 chip、D/L 快照。掛 `window.LiposomeSection` |
| `index.html` | 修改 | 側欄項、section 標記、清空確認 dialog、5 個 `<script>`、版本 4.14 |
| `js/form-persistence.js:13` | 修改 | `PERSIST_SKIP_IDS` 加四個 chip 欄位 |
| `js/app.js:37` | 修改 | 呼叫 `window.LiposomeSection?.init()` |
| `tests/load.js` | 修改 | 加載三個可測模組 |
| `tests/liposome.test.js` | 建立 | 公開單元測試（合成資料 + Excel 六列回歸） |
| `tests/liposome-local.test.js` | 建立 | 讀 gitignored fixture，不存在就 skip |

**不改 CSS**：全部重用 `.card / .grid / .form-* / .result-grid / .stat-card / .table / .alert-* / .info-panel-chip / .modal-dialog / .chart-container`。

---

### Task 1: 計算模組骨架 — `interpolateLinear` 與 `sampleStd`

**Files:**
- Create: `js/liposome-calculations.js`
- Modify: `index.html:1828`（`dndc-charts.js` 之後加 `<script>`）
- Modify: `tests/load.js`
- Create: `tests/liposome.test.js`

- [ ] **Step 1: 在 `tests/load.js` 加載新模組**

在 `require(path.join(JS, 'dndc-astra-ui.js'));` 之後加：

```js
require(path.join(JS, 'liposome-calculations.js'));
```

在 `module.exports = {` 物件裡加：

```js
    Liposome: window.LiposomeCalculations,
```

- [ ] **Step 2: 寫失敗的測試**

建立 `tests/liposome.test.js`：

```js
'use strict';
/**
 * 脂質體 DOX 載藥量（D/L）計算模組。
 *
 * 規格：docs/superpowers/specs/2026-09-05-liposome-dox-loading-design.md
 * 所有回歸值來自本地 Excel「Liposome DOX-loading calculation-Bypass.xlsx」的 DL 工作表
 * （openpyxl data_only 讀出的完整快取值，不是顯示值）。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Liposome } = require('./load.js');

const approx = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol,
        `${msg}: ${actual} != ${expected} (±${tol})`);

const relApprox = (actual, expected, rel, msg) =>
    assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected),
        `${msg}: ${actual} != ${expected} (rel ±${rel})`);

// ---------------------------------------------------------------- 基礎工具
test('[lipo] interpolateLinear 在格點上取值、格點間線性、範圍外 throw', () => {
    const xs = [0, 1, 2, 4];
    const ys = [0, 10, 20, 40];
    assert.equal(Liposome.interpolateLinear(xs, ys, 0), 0, '左端點');
    assert.equal(Liposome.interpolateLinear(xs, ys, 4), 40, '右端點');
    assert.equal(Liposome.interpolateLinear(xs, ys, 2), 20, '中間格點');
    approx(Liposome.interpolateLinear(xs, ys, 3), 30, 1e-12, '格點間');
    approx(Liposome.interpolateLinear(xs, ys, 0.25), 2.5, 1e-12, '第一段');
    assert.throws(() => Liposome.interpolateLinear(xs, ys, -0.1), /超出範圍/);
    assert.throws(() => Liposome.interpolateLinear(xs, ys, 4.1), /超出範圍/);
    assert.throws(() => Liposome.interpolateLinear([1], [1], 1), /至少/);
});

test('[lipo] sampleStd 是 n−1 的樣本標準差（Excel STDEV.S），n<2 回 0', () => {
    // Excel DL!F2 = STDEV.S(0.90287, 0.91973, 0.94266) = 0.019972016256085294
    approx(Liposome.sampleStd([0.90287, 0.91973, 0.94266]), 0.019972016256085294, 1e-15, 'DOX-18 F 欄');
    assert.equal(Liposome.sampleStd([5]), 0);
    assert.equal(Liposome.sampleStd([]), 0);
});

test('[lipo] DEFAULTS 與規格一致', () => {
    const d = Liposome.DEFAULTS;
    assert.deepEqual(
        [d.Q_MIN, d.Q_MAX, d.MIN_WINDOW_POINTS, d.EPSILON_DOX, d.PATH_CM, d.PRIMARY_WAVELENGTH_NM, d.FIT_MIN_NM, d.FIT_MAX_NM, d.LSQ_WARN_REL],
        [0.1, 0.15, 5, 9250, 0.2, 495, 450, 550, 0.05]);
    assert.deepEqual([...d.WAVELENGTHS_NM], [494, 495, 496]);
    assert.ok(Object.isFrozen(d));
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 載入時 `Cannot find module '.../js/liposome-calculations.js'` 或 `Liposome` 為 undefined → FAIL。

- [ ] **Step 4: 建立模組（只含這兩個函式與 DEFAULTS）**

建立 `js/liposome-calculations.js`：

```js
/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥量（D/L）純計算模組
 *
 * 對應本地 Excel「Liposome DOX-loading calculation-Bypass.xlsx」：
 *   dilution 工作表 → computeDilutionFactor（q 視窗內 I_bypass / I_solution 的平均）
 *   DL 工作表       → computeDrugToLipid（A(495) / (ε·l) ÷ (c_lipid × 稀釋因子)）
 * 加上 Excel 沒做的 UV 扣背景（subtractSpectra）與純 DOX 縮放擬合（fitPureDoxScale）。
 *
 * 設計規則（規格 §4）：
 *   - 純函式、無 DOM、不改動輸入；回傳物件一律 Object.freeze
 *   - 內部單位：濃度 M、長度 cm、q Å⁻¹、波長 nm；mM ↔ M 只在 UI 層換算
 *   - 算不出就 throw 中文訊息，絕不回 0 / NaN
 *
 * IIFE：內部識別字不進全域（classic <script> 共用作用域，tests/structure.test.js 會盯）。
 */
(function attachLiposomeCalculations(global) {
    'use strict';

    const DEFAULTS = Object.freeze({
        Q_MIN: 0.1,                       // Å⁻¹，Excel dilution 頁與操作說明
        Q_MAX: 0.15,
        MIN_WINDOW_POINTS: 5,
        EPSILON_DOX: 9250,                // L·mol⁻¹·cm⁻¹ @495 nm，Lee et al., Int. J. Nanomed. 20 (2025) 6357–6378
        PATH_CM: 0.2,                     // SAXS 毛細管厚度
        WAVELENGTHS_NM: Object.freeze([494, 495, 496]),
        PRIMARY_INDEX: 1,                 // Excel J 欄只用 495 nm
        PRIMARY_WAVELENGTH_NM: 495,
        FIT_MIN_NM: 450,
        FIT_MAX_NM: 550,
        MIN_FIT_POINTS: 10,
        MIN_OVERLAP_POINTS: 10,
        LSQ_WARN_REL: 0.05,
    });

    function assertFinite(value, label) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`${label} 必須是有限數值（目前：${String(value)}）`);
        }
    }

    function assertPositive(value, label) {
        assertFinite(value, label);
        if (value <= 0) throw new Error(`${label} 必須大於 0（目前：${value}）`);
    }

    /**
     * 樣本標準差（n − 1，Excel STDEV.S）。n < 2 回 0。
     * @param {number[]} values
     * @returns {number}
     */
    function sampleStd(values) {
        const n = values.length;
        if (n < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / n;
        const ss = values.reduce((a, v) => a + (v - mean) * (v - mean), 0);
        return Math.sqrt(ss / (n - 1));
    }

    function mean(values) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    /**
     * 線性內插。xs 必須嚴格遞增；x 超出 [xs[0], xs[last]] → throw。
     * 二分搜尋找區間，剛好落在格點上時直接回傳格點值（避免浮點誤差）。
     * @param {number[]} xs
     * @param {number[]} ys
     * @param {number} x
     * @returns {number}
     */
    function interpolateLinear(xs, ys, x) {
        assertFinite(x, 'x');
        const n = xs.length;
        if (n < 2 || ys.length !== n) throw new Error('內插至少需要 2 個點，且 xs 與 ys 長度相同');
        if (x < xs[0] || x > xs[n - 1]) {
            throw new Error(`x = ${x} 超出範圍 [${xs[0]}, ${xs[n - 1]}]`);
        }
        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid; else hi = mid;
        }
        if (x === xs[lo]) return ys[lo];
        if (x === xs[hi]) return ys[hi];
        const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
        return ys[lo] + t * (ys[hi] - ys[lo]);
    }

    global.LiposomeCalculations = Object.freeze({
        DEFAULTS,
        interpolateLinear,
        sampleStd,
    });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: 在 index.html 加 `<script>`**

在 `<script src="js/dndc-charts.js"></script>`（約 1828 行）之後、`<!-- dn/dc 分頁 UI` 註解之前插入：

```html
    <!-- 脂質體 DOX 載藥：純模組（無 DOM 相依） -->
    <script src="js/liposome-calculations.js"></script>
```

- [ ] **Step 6: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 112`（109 + 3），`fail 0`。structure 測試也要綠（新檔已被引用）。

- [ ] **Step 7: Commit**

```bash
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/index.html saxs-calculator/tests/load.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): calculation module skeleton — interpolateLinear, sampleStd, DEFAULTS"
```

---

### Task 2: `computeDilutionFactor`

**Files:**
- Modify: `js/liposome-calculations.js`
- Modify: `tests/liposome.test.js`

- [ ] **Step 1: 寫失敗的測試**

在 `tests/liposome.test.js` 末尾加：

```js
// ---------------------------------------------------------------- 稀釋因子
/** Guinier 型合成曲線 I(q) = 10·exp(−(30q)²/3)，q 0.005…0.3 步進 0.001。 */
function guinierCurve(scale, qOffset) {
    const q = [];
    const i = [];
    for (let k = 0; k <= 295; k++) {
        // toFixed 避免 0.005 + 95×0.001 變成 0.09999999999999999 而掉出 q ≥ 0.1 的視窗
        const qk = Number((0.005 + k * 0.001 + qOffset).toFixed(6));
        q.push(qk);
        i.push(scale * 10 * Math.exp(-((30 * qk) ** 2) / 3));
    }
    return { q, i };
}

test('[lipo] 稀釋因子 (a) 同格點：平均、最小平方都回 0.45，SD 為 0', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0);
    const r = Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.1, qMax: 0.15 });
    approx(r.factor, 0.45, 1e-9, 'factor');
    approx(r.lsqScale, 0.45, 1e-9, 'lsqScale');
    assert.ok(r.sd < 1e-9, `sd ${r.sd}`);
    assert.equal(r.n, 51, '0.100…0.150 步進 0.001 = 51 點');
    assert.deepEqual(r.excluded, { outOfRange: 0, nonPositive: 0 });
    assert.ok(Object.isFrozen(r));
});

test('[lipo] 稀釋因子 (b) 偏移格點：內插後仍在 0.45 ± 1e-3（線性內插對高斯有二階誤差，勿改內插法）', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0.0003);
    const r = Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.1, qMax: 0.15 });
    approx(r.factor, 0.45, 1e-3, 'factor');
    assert.ok(r.sd < 1e-3, `sd ${r.sd}`);
    approx(r.lsqScale, 0.45, 1e-3, 'lsqScale');
});

test('[lipo] 稀釋因子：預設 q 視窗 0.1–0.15、視窗不足 5 點 throw、非正強度被排除並計數', () => {
    const solution = guinierCurve(1, 0);
    const bypass = guinierCurve(0.45, 0);
    const byDefault = Liposome.computeDilutionFactor(solution, bypass);
    assert.equal(byDefault.n, 51);

    assert.throws(() => Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.1, qMax: 0.102 }),
        /只有 3 個有效點/);
    assert.throws(() => Liposome.computeDilutionFactor(solution, bypass, { qMin: 0.15, qMax: 0.1 }),
        /上限必須大於下限/);

    // bypass 在視窗內有 2 點是負值 → 排除、計數，其餘照算
    const dented = { q: bypass.q, i: bypass.i.map((v, k) => (bypass.q[k] > 0.1199 && bypass.q[k] < 0.1211 ? -1 : v)) };
    const r = Liposome.computeDilutionFactor(solution, dented);
    assert.equal(r.excluded.nonPositive, 2);
    assert.equal(r.n, 49);
    approx(r.factor, 0.45, 1e-9, 'factor after exclusion');

    // bypass 的 q 範圍沒蓋住視窗 → 超出的點計入 outOfRange
    const short = { q: bypass.q.filter(q => q <= 0.13), i: bypass.i.filter((_, k) => bypass.q[k] <= 0.13) };
    const r2 = Liposome.computeDilutionFactor(solution, short);
    assert.ok(r2.excluded.outOfRange > 0);
    assert.equal(r2.n + r2.excluded.outOfRange, 51);
});

test('[lipo] 稀釋因子：曲線 q 非嚴格遞增或長度不一致 throw', () => {
    assert.throws(() => Liposome.computeDilutionFactor({ q: [0.1, 0.1, 0.2], i: [1, 1, 1] }, guinierCurve(1, 0)), /嚴格遞增/);
    assert.throws(() => Liposome.computeDilutionFactor({ q: [0.1, 0.2], i: [1] }, guinierCurve(1, 0)), /長度不一致/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 4 個新測試 FAIL，`Liposome.computeDilutionFactor is not a function`。

- [ ] **Step 3: 實作**

在 `js/liposome-calculations.js` 的 `interpolateLinear` 之後、`global.LiposomeCalculations = …` 之前加：

```js
    function isStrictlyIncreasing(xs) {
        for (let k = 1; k < xs.length; k++) {
            if (!(xs[k] > xs[k - 1])) return false;
        }
        return true;
    }

    /**
     * 檢查 {xKey: number[], yKey: number[]} 形狀的曲線。
     */
    function assertCurve(curve, xKey, yKey, label) {
        if (!curve || !Array.isArray(curve[xKey]) || !Array.isArray(curve[yKey])) {
            throw new Error(`${label} 缺少 ${xKey} / ${yKey} 陣列`);
        }
        if (curve[xKey].length !== curve[yKey].length) {
            throw new Error(`${label} 的 ${xKey} 與 ${yKey} 長度不一致`);
        }
        if (curve[xKey].length < 2) throw new Error(`${label} 至少需要 2 個點`);
        if (!isStrictlyIncreasing(curve[xKey])) throw new Error(`${label} 的 ${xKey} 必須嚴格遞增`);
    }

    function inRange(x, lo, hi) {
        return x >= lo && x <= hi;
    }

    /**
     * 稀釋因子：q 視窗內 I_bypass / I_solution 的逐點比值平均（Excel dilution 頁），
     * bypass 先線性內插到 solution 的 q 格點。另回最小平方縮放（PRIMUS I Scale 等價式）供對照。
     *
     * @param {{q:number[], i:number[]}} solution - solution cell 曲線（q 嚴格遞增）
     * @param {{q:number[], i:number[]}} bypass - bypass 曲線
     * @param {{qMin?:number, qMax?:number}} [options]
     * @returns {{factor:number, sd:number, n:number, lsqScale:number,
     *            excluded:{outOfRange:number, nonPositive:number}, ratios:number[], q:number[]}}
     */
    function computeDilutionFactor(solution, bypass, options = {}) {
        const qMin = options.qMin ?? DEFAULTS.Q_MIN;
        const qMax = options.qMax ?? DEFAULTS.Q_MAX;
        assertCurve(solution, 'q', 'i', 'solution cell 曲線');
        assertCurve(bypass, 'q', 'i', 'bypass 曲線');
        assertFinite(qMin, 'q 下限');
        assertFinite(qMax, 'q 上限');
        if (!(qMax > qMin)) throw new Error(`q 視窗上限必須大於下限（目前 ${qMin}–${qMax}）`);

        const bq = bypass.q;
        const bi = bypass.i;
        const bLo = bq[0];
        const bHi = bq[bq.length - 1];
        let outOfRange = 0;
        let nonPositive = 0;
        const q = [];
        const iSol = [];
        const iByp = [];

        solution.q.forEach((qk, k) => {
            if (!inRange(qk, qMin, qMax)) return;
            if (!inRange(qk, bLo, bHi)) { outOfRange += 1; return; }
            const s = solution.i[k];
            const b = interpolateLinear(bq, bi, qk);
            if (!(s > 0) || !(b > 0)) { nonPositive += 1; return; }
            q.push(qk);
            iSol.push(s);
            iByp.push(b);
        });

        if (q.length < DEFAULTS.MIN_WINDOW_POINTS) {
            throw new Error(`q 視窗 ${qMin}–${qMax} Å⁻¹ 內只有 ${q.length} 個有效點，至少需要 ${DEFAULTS.MIN_WINDOW_POINTS} 個`);
        }

        const ratios = iSol.map((s, k) => iByp[k] / s);
        const num = iSol.reduce((acc, s, k) => acc + s * iByp[k], 0);
        const den = iSol.reduce((acc, s) => acc + s * s, 0);

        return Object.freeze({
            factor: mean(ratios),
            sd: sampleStd(ratios),
            n: ratios.length,
            lsqScale: num / den,
            excluded: Object.freeze({ outOfRange, nonPositive }),
            ratios: Object.freeze(ratios),
            q: Object.freeze(q),
        });
    }
```

並把 `computeDilutionFactor` 加進 `global.LiposomeCalculations` 的物件。

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 116`，`fail 0`。若 (b) 的 factor 不在 0.45 ± 1e-3，先印出 `r.factor`——它應該是 0.4502 左右；若差很多，檢查 `inRange` 邊界與 `interpolateLinear` 的二分搜尋，**不要**改容差。

- [ ] **Step 5: Commit**

```bash
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): computeDilutionFactor — interpolated point-wise ratio mean with LSQ reference"
```

---

### Task 3: `subtractSpectra` 與 `absorbanceAt`

**Files:**
- Modify: `js/liposome-calculations.js`
- Modify: `tests/liposome.test.js`

- [ ] **Step 1: 寫失敗的測試**

在 `tests/liposome.test.js` 末尾加：

```js
// ---------------------------------------------------------------- 光譜
/** 合成光譜：blank = 2·exp(−λ/150)，pure = 高斯（中心 495、寬 25、峰 1），loaded = blank + k·pure。 */
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

test('[lipo] subtractSpectra 回 loaded − blank（同格點時精確到 1e-9），結果凍結', () => {
    const s = syntheticSpectra(0.8);
    const r = Liposome.subtractSpectra(s.loaded, s.blank);
    assert.equal(r.wavelength.length, 201);
    assert.equal(r.dropped, 0);
    r.absorbance.forEach((a, j) => approx(a, 0.8 * s.pure.absorbance[j], 1e-9, `λ=${r.wavelength[j]}`));
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.absorbance));
});

test('[lipo] subtractSpectra 以 loaded 格點為準、blank 內插；loaded 超出 blank 範圍的點捨棄並計數', () => {
    const s = syntheticSpectra(0.8, 1, 400, 600);
    const blankHalf = syntheticSpectra(0.8, 0.5, 450, 550).blank;     // 0.5 nm 格點、範圍較窄
    const r = Liposome.subtractSpectra(s.loaded, blankHalf);
    assert.equal(r.wavelength.length, 101, '450…550 共 101 點');
    assert.equal(r.dropped, 100);
    r.absorbance.forEach((a, j) => approx(a, 0.8 * Math.exp(-((r.wavelength[j] - 495) ** 2) / 1250), 1e-6, `λ=${r.wavelength[j]}`));
});

test('[lipo] subtractSpectra 重疊不足 10 點 throw', () => {
    const s = syntheticSpectra(0.8, 1, 400, 600);
    const tiny = syntheticSpectra(0.8, 1, 500, 505).blank;
    assert.throws(() => Liposome.subtractSpectra(s.loaded, tiny), /重疊只有 6 點/);
});

test('[lipo] absorbanceAt 在 1 nm 與 0.5 nm 格點上讀 494/495/496 都對到解析值；超出範圍 throw', () => {
    for (const step of [1, 0.5]) {
        const s = syntheticSpectra(0.8, step);
        const sub = Liposome.subtractSpectra(s.loaded, s.blank);
        const [a494, a495, a496] = Liposome.absorbanceAt(sub, [494, 495, 496]);
        approx(a495, 0.8, 1e-6, `A495 step ${step}`);
        approx(a494, 0.8 * Math.exp(-1 / 1250), 1e-6, `A494 step ${step}`);
        approx(a496, 0.8 * Math.exp(-1 / 1250), 1e-6, `A496 step ${step}`);
    }
    const sub = Liposome.subtractSpectra(syntheticSpectra(0.8).loaded, syntheticSpectra(0.8).blank);
    assert.throws(() => Liposome.absorbanceAt(sub, [494, 495, 650]), /650 nm 超出光譜範圍 400–600 nm/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 4 個新測試 FAIL（`subtractSpectra is not a function`）。

- [ ] **Step 3: 實作**

在 `computeDilutionFactor` 之後加：

```js
    /**
     * 扣背景：以 loaded 的波長格點為準，blank 內插後相減。
     * loaded 超出 blank 範圍的點捨棄（計入 dropped）。重疊 < MIN_OVERLAP_POINTS → throw。
     *
     * @param {{wavelength:number[], absorbance:number[]}} loaded - 含藥光譜
     * @param {{wavelength:number[], absorbance:number[]}} blank - 空白脂質體光譜
     * @returns {{wavelength:number[], absorbance:number[], dropped:number}}
     */
    function subtractSpectra(loaded, blank) {
        assertCurve(loaded, 'wavelength', 'absorbance', '含藥光譜');
        assertCurve(blank, 'wavelength', 'absorbance', '空白光譜');
        const bw = blank.wavelength;
        const ba = blank.absorbance;
        const lo = bw[0];
        const hi = bw[bw.length - 1];
        const wavelength = [];
        const absorbance = [];
        let dropped = 0;
        loaded.wavelength.forEach((w, k) => {
            if (!inRange(w, lo, hi)) { dropped += 1; return; }
            wavelength.push(w);
            absorbance.push(loaded.absorbance[k] - interpolateLinear(bw, ba, w));
        });
        if (wavelength.length < DEFAULTS.MIN_OVERLAP_POINTS) {
            throw new Error(`兩條光譜的波長重疊只有 ${wavelength.length} 點，至少需要 ${DEFAULTS.MIN_OVERLAP_POINTS} 點`);
        }
        return Object.freeze({
            wavelength: Object.freeze(wavelength),
            absorbance: Object.freeze(absorbance),
            dropped,
        });
    }

    /**
     * 讀取指定波長的吸光度（線性內插）。任一波長超出範圍 → throw。
     * @param {{wavelength:number[], absorbance:number[]}} spectrum
     * @param {number[]} wavelengthsNm
     * @returns {number[]}
     */
    function absorbanceAt(spectrum, wavelengthsNm) {
        assertCurve(spectrum, 'wavelength', 'absorbance', '光譜');
        const ws = spectrum.wavelength;
        const lo = ws[0];
        const hi = ws[ws.length - 1];
        return wavelengthsNm.map((w) => {
            assertFinite(w, '讀值波長');
            if (!inRange(w, lo, hi)) throw new Error(`波長 ${w} nm 超出光譜範圍 ${lo}–${hi} nm`);
            return interpolateLinear(ws, spectrum.absorbance, w);
        });
    }
```

把 `subtractSpectra`、`absorbanceAt` 加進匯出物件。

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 120`，`fail 0`。

- [ ] **Step 5: Commit**

```bash
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): subtractSpectra and absorbanceAt"
```

---

### Task 4: `fitPureDoxScale`

**Files:**
- Modify: `js/liposome-calculations.js`
- Modify: `tests/liposome.test.js`

- [ ] **Step 1: 寫失敗的測試**

```js
// ---------------------------------------------------------------- 純 DOX 縮放擬合
test('[lipo] fitPureDoxScale 在合成資料上回復 k = 0.8、殘差 0；model 覆蓋整段重疊', () => {
    const s = syntheticSpectra(0.8);
    const r = Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure, { fitMin: 450, fitMax: 550 });
    approx(r.k, 0.8, 1e-9, 'k');
    assert.ok(r.rms < 1e-9, `rms ${r.rms}`);
    assert.equal(r.n, 101, '450…550 步進 1');
    assert.equal(r.model.wavelength.length, 201, 'model 涵蓋 400…600 整段');
    r.model.absorbance.forEach((m, j) => approx(m, s.loaded.absorbance[j], 1e-9, `model λ=${r.model.wavelength[j]}`));
    r.residual.absorbance.forEach((d) => assert.ok(Math.abs(d) < 1e-9));
    assert.ok(Object.isFrozen(r));
});

test('[lipo] fitPureDoxScale 預設擬合範圍 450–550；範圍點數不足或純 DOX 全零 throw', () => {
    const s = syntheticSpectra(0.8);
    approx(Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure).k, 0.8, 1e-9, '預設範圍');
    assert.throws(() => Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure, { fitMin: 500, fitMax: 505 }),
        /只有 6 點/);
    const zero = { wavelength: s.pure.wavelength, absorbance: s.pure.absorbance.map(() => 0) };
    assert.throws(() => Liposome.fitPureDoxScale(s.loaded, s.blank, zero), /全為 0/);
    assert.throws(() => Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure, { fitMin: 550, fitMax: 450 }),
        /上限必須大於下限/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 2 個新測試 FAIL。

- [ ] **Step 3: 實作**

```js
    /**
     * 純 DOX 縮放擬合：在 fitMin–fitMax 內求最小平方 k，使 blank + k·pure ≈ loaded。
     * k = Σ[(L−B)·P] / Σ(P²)。model 與 residual 覆蓋三條光譜的整段重疊範圍。
     *
     * @returns {{k:number, rms:number, n:number,
     *            model:{wavelength:number[], absorbance:number[]},
     *            residual:{wavelength:number[], absorbance:number[]}}}
     */
    function fitPureDoxScale(loaded, blank, pure, options = {}) {
        const fitMin = options.fitMin ?? DEFAULTS.FIT_MIN_NM;
        const fitMax = options.fitMax ?? DEFAULTS.FIT_MAX_NM;
        assertCurve(loaded, 'wavelength', 'absorbance', '含藥光譜');
        assertCurve(blank, 'wavelength', 'absorbance', '空白光譜');
        assertCurve(pure, 'wavelength', 'absorbance', '純 DOX 光譜');
        assertFinite(fitMin, '擬合下限');
        assertFinite(fitMax, '擬合上限');
        if (!(fitMax > fitMin)) throw new Error(`擬合範圍上限必須大於下限（目前 ${fitMin}–${fitMax}）`);

        const bw = blank.wavelength;
        const pw = pure.wavelength;
        const lo = Math.max(bw[0], pw[0]);
        const hi = Math.min(bw[bw.length - 1], pw[pw.length - 1]);

        const wavelength = [];
        const L = [];
        const B = [];
        const P = [];
        loaded.wavelength.forEach((w, k) => {
            if (!inRange(w, lo, hi)) return;
            wavelength.push(w);
            L.push(loaded.absorbance[k]);
            B.push(interpolateLinear(bw, blank.absorbance, w));
            P.push(interpolateLinear(pw, pure.absorbance, w));
        });

        let num = 0;
        let den = 0;
        let n = 0;
        wavelength.forEach((w, j) => {
            if (!inRange(w, fitMin, fitMax)) return;
            num += (L[j] - B[j]) * P[j];
            den += P[j] * P[j];
            n += 1;
        });
        if (n < DEFAULTS.MIN_FIT_POINTS) {
            throw new Error(`擬合範圍 ${fitMin}–${fitMax} nm 內只有 ${n} 點，至少需要 ${DEFAULTS.MIN_FIT_POINTS} 點`);
        }
        if (!(den > 0)) throw new Error('純 DOX 光譜在擬合範圍內全為 0，無法縮放');

        const k = num / den;
        const model = B.map((b, j) => b + k * P[j]);
        const residual = L.map((l, j) => l - model[j]);
        let ss = 0;
        wavelength.forEach((w, j) => {
            if (inRange(w, fitMin, fitMax)) ss += residual[j] * residual[j];
        });

        return Object.freeze({
            k,
            rms: Math.sqrt(ss / n),
            n,
            model: Object.freeze({ wavelength: Object.freeze(wavelength), absorbance: Object.freeze(model) }),
            residual: Object.freeze({ wavelength: Object.freeze(wavelength), absorbance: Object.freeze(residual) }),
        });
    }
```

加進匯出物件。

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 122`，`fail 0`。

- [ ] **Step 5: Commit**

```bash
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): fitPureDoxScale least-squares scaling for the concentration check"
```

---

### Task 5: `computeDrugToLipid`（Excel DL 頁回歸）

**Files:**
- Modify: `js/liposome-calculations.js`
- Modify: `tests/liposome.test.js`

- [ ] **Step 1: 寫失敗的測試**

```js
// ---------------------------------------------------------------- D/L（Excel DL 工作表）
// 欄位：A494, A495, A496, M（脂質原始濃度 M）, N（稀釋因子）, Q（D/L）, R（Excel 誤差，僅 UV）
// Q、R 是 openpyxl data_only 讀出的完整快取值（2026-09-05），ε = 9250、l = 0.2。
const EXCEL_DL_ROWS = [
    ['DOX-18',      0.90287, 0.91973, 0.94266, 0.0117, 0.454, 0.09359376319728743,  0.002032396638192102],
    ['DOX-20',      0.74644, 1.05761, 0.89623, 0.0108, 0.526, 0.10063390386584302,  0.01480767552474392],
    ['DOX-22',      0.07752, 0.0764,  0.08737, 0.011,  0.556, 0.006752337687589486, 0.0005334920222687899],
    ['Chol-DOX-18', 0.69825, 0.8085,  0.69407, 0.01,   0.54,  0.08093093093093093,  0.006495815219697592],
    ['Chol-DOX-20', 0.86094, 0.74027, 0.96326, 0.0105, 0.556, 0.06854161458478004,  0.01033496895850612],
    ['Chol-DOX-22', 0.80352, 0.75896, 0.79255, 0.01,   0.417, 0.0983809708989565,   0.0030095498767000206],
];

test('[lipo] computeDrugToLipid 重現 Excel DL 頁六列的 Q 與 R（factorSd = 0 時 dlSd = dlSdExcel）', () => {
    for (const [name, a494, a495, a496, lipidM, factor, Q, R] of EXCEL_DL_ROWS) {
        const r = Liposome.computeDrugToLipid({
            absorbances: [a494, a495, a496],
            primaryIndex: 1,
            primaryWavelengthNm: 495,
            epsilon: 9250,
            pathCm: 0.2,
            lipidMolar: lipidM,
            factor,
            factorSd: 0,
        });
        relApprox(r.dl, Q, 1e-9, `${name} Q`);
        relApprox(r.dlSdExcel, R, 1e-9, `${name} R`);
        relApprox(r.dlSd, R, 1e-9, `${name} dlSd（factorSd=0 時等於 Excel）`);
        assert.equal(r.aPrimary, a495);
        relApprox(r.doxConc, a495 / (9250 * 0.2), 1e-12, `${name} J`);
        relApprox(r.lipidActual, lipidM * factor, 1e-12, `${name} O`);
        assert.equal(r.relF, 0);
        assert.ok(Object.isFrozen(r));
    }
});

test('[lipo] computeDrugToLipid 納入稀釋因子離散：dlSd = dl·√(relA² + relF²)', () => {
    const base = { absorbances: [0.90287, 0.91973, 0.94266], epsilon: 9250, pathCm: 0.2, lipidMolar: 0.0117, factor: 0.454 };
    const r = Liposome.computeDrugToLipid({ ...base, factorSd: 0.0129 });
    const relA = 0.019972016256085294 / 0.91973;
    const relF = 0.0129 / 0.454;
    relApprox(r.relA, relA, 1e-12, 'relA');
    relApprox(r.relF, relF, 1e-12, 'relF');
    relApprox(r.dlSd, r.dl * Math.sqrt(relA * relA + relF * relF), 1e-12, 'dlSd');
    assert.ok(r.dlSd > r.dlSdExcel, '加了因子離散後誤差只會變大');
});

test('[lipo] computeDrugToLipid 預設 primaryIndex 1 / 495 nm；主波長吸光度非正、參數非正、吸光度數量錯 throw', () => {
    const ok = { absorbances: [0.1, 0.2, 0.3], epsilon: 9250, pathCm: 0.2, lipidMolar: 0.01, factor: 0.5 };
    assert.equal(Liposome.computeDrugToLipid(ok).aPrimary, 0.2);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, 0, 0.3] }), /主波長 495 nm 的吸光度非正/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, -0.2, 0.3], primaryWavelengthNm: 500 }), /主波長 500 nm/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, 0.2] }), /三個吸光度/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, absorbances: [0.1, NaN, 0.3] }), /吸光度 #2/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, lipidMolar: 0 }), /脂質原始濃度 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, factor: -1 }), /稀釋因子 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, epsilon: 0 }), /ε 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, pathCm: 0 }), /光徑 必須大於 0/);
    assert.throws(() => Liposome.computeDrugToLipid({ ...ok, factorSd: -0.1 }), /離散度不可為負/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 3 個新測試 FAIL。

- [ ] **Step 3: 實作**

```js
    /**
     * D/L 與誤差（Excel DL 工作表 F/J/K/O/Q/R 欄 + 因子離散）。
     *
     * @param {{absorbances:number[], primaryIndex?:number, primaryWavelengthNm?:number,
     *          epsilon:number, pathCm:number, lipidMolar:number, factor:number, factorSd?:number}} params
     * @returns {{aPrimary:number, sdA:number, doxConc:number, doxSd:number, lipidActual:number,
     *            dl:number, dlSd:number, dlSdExcel:number, relA:number, relF:number}}
     */
    function computeDrugToLipid(params) {
        const p = params || {};
        const primaryIndex = p.primaryIndex ?? DEFAULTS.PRIMARY_INDEX;
        const primaryWavelengthNm = p.primaryWavelengthNm ?? DEFAULTS.PRIMARY_WAVELENGTH_NM;
        const factorSd = p.factorSd ?? 0;

        if (!Array.isArray(p.absorbances) || p.absorbances.length !== 3) {
            throw new Error('需要三個吸光度（494 / 495 / 496 nm 或自訂的三個波長）');
        }
        p.absorbances.forEach((a, k) => assertFinite(a, `吸光度 #${k + 1}`));
        if (!(primaryIndex >= 0 && primaryIndex < 3)) throw new Error('primaryIndex 必須是 0、1 或 2');

        const aPrimary = p.absorbances[primaryIndex];
        if (!(aPrimary > 0)) {
            throw new Error(`主波長 ${primaryWavelengthNm} nm 的吸光度非正（${aPrimary}）`);
        }
        assertPositive(p.epsilon, 'ε');
        assertPositive(p.pathCm, '光徑');
        assertPositive(p.lipidMolar, '脂質原始濃度');
        assertPositive(p.factor, '稀釋因子');
        assertFinite(factorSd, '稀釋因子離散度');
        if (factorSd < 0) throw new Error(`稀釋因子離散度不可為負（目前：${factorSd}）`);

        const sdA = sampleStd(p.absorbances);                 // Excel F
        const denom = p.epsilon * p.pathCm;
        const doxConc = aPrimary / denom;                      // Excel J
        const doxSd = sdA / denom;                             // Excel K
        const lipidActual = p.lipidMolar * p.factor;           // Excel O
        const dl = doxConc / lipidActual;                      // Excel Q
        const relA = sdA / aPrimary;
        const relF = factorSd / p.factor;

        return Object.freeze({
            aPrimary,
            sdA,
            doxConc,
            doxSd,
            lipidActual,
            dl,
            dlSd: dl * Math.sqrt(relA * relA + relF * relF),
            dlSdExcel: dl * relA,                              // Excel R
            relA,
            relF,
        });
    }
```

加進匯出物件。最終匯出：

```js
    global.LiposomeCalculations = Object.freeze({
        DEFAULTS,
        interpolateLinear,
        sampleStd,
        computeDilutionFactor,
        subtractSpectra,
        absorbanceAt,
        fitPureDoxScale,
        computeDrugToLipid,
    });
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 125`，`fail 0`。檔案行數：`wc -l saxs-calculator/js/liposome-calculations.js` 約 360 行（上限 800，不要為了縮行數刪註解）。

- [ ] **Step 5: Commit**

```bash
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): computeDrugToLipid with Excel DL-sheet regression and factor-scatter error"
```

---

### Task 6: 檔案解析模組 `liposome-file-parsers.js`

**Files:**
- Create: `js/liposome-file-parsers.js`
- Modify: `index.html`（`liposome-calculations.js` 之後加 `<script>`）
- Modify: `tests/load.js`
- Modify: `tests/liposome.test.js`

- [ ] **Step 1: `tests/load.js` 加載**

在 `require(path.join(JS, 'liposome-calculations.js'));` 之後加：

```js
require(path.join(JS, 'liposome-file-parsers.js'));
```

`module.exports` 加：

```js
    LiposomeParsers: window.LiposomeFileParsers,
```

- [ ] **Step 2: 寫失敗的測試**

`tests/liposome.test.js` 頂部的 require 改成：

```js
const { Liposome, LiposomeParsers } = require('./load.js');
```

末尾加：

```js
// ---------------------------------------------------------------- 檔案解析
const PRIMUS_DAT = [
    'Sample description: BSA merged',
    'Sample:   c= 1.000 mg/ml  Code: ',
    ' q(A-1)  I(q)  error',
    '',
    '# comment line',
    ' 1.0000E-02  1.5659E+00  3.7940E-02',
    ' 1.1000E-02  1.6071E+00  8.5800E-03',
    ' 1.2000E-02  1.5007E+00  5.7700E-03',
    '',
].join('\n');

test('[lipo-parse] parseSaxsDat 跳過文字標頭／空行／# 註解，保留 err 欄，計數 skipped', () => {
    const r = LiposomeParsers.parseSaxsDat(PRIMUS_DAT);
    assert.deepEqual(r.q, [0.01, 0.011, 0.012]);
    assert.deepEqual(r.i, [1.5659, 1.6071, 1.5007]);
    assert.deepEqual(r.err, [0.03794, 0.00858, 0.00577]);
    assert.equal(r.skipped, 3, '三行文字標頭；空行與 # 行不算 skipped');
    assert.equal(r.sorted, false);
    assert.ok(Object.isFrozen(r));
});

test('[lipo-parse] parseSaxsDat 接受逗號／tab／分號分隔；兩欄檔 err 為 null；缺第三欄的列讓 err 為 null', () => {
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1,2,0.5\n0.2,1,0.4').err, [0.5, 0.4]);
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1\t2\t0.5\r\n0.2\t1\t0.4').q, [0.1, 0.2]);
    assert.deepEqual(LiposomeParsers.parseSaxsDat('0.1;2\n0.2;1').i, [2, 1]);
    assert.equal(LiposomeParsers.parseSaxsDat('0.1 2\n0.2 1').err, null);
    assert.equal(LiposomeParsers.parseSaxsDat('0.1 2 0.5\n0.2 1').err, null, '有一列缺 err 就整個 null');
});

test('[lipo-parse] parseSaxsDat 亂序 q 穩定排序並設 sorted=true；重複 q throw；無數值列 throw', () => {
    const r = LiposomeParsers.parseSaxsDat('0.00045597 -0.00377 0\n0 0 0\n0.0057 1.5659 0.03794');
    assert.deepEqual(r.q, [0, 0.00045597, 0.0057]);
    assert.deepEqual(r.i, [0, -0.00377, 1.5659]);
    assert.equal(r.sorted, true);
    assert.throws(() => LiposomeParsers.parseSaxsDat('0.1 1\n0.1 2'), /q 有重複值 0.1/);
    assert.throws(() => LiposomeParsers.parseSaxsDat('q I err\nhello world'), /找不到數值列/);
    assert.throws(() => LiposomeParsers.parseSaxsDat(''), /找不到數值列/);
    assert.throws(() => LiposomeParsers.parseSaxsDat(null), /不是文字/);
});

test('[lipo-parse] parseUvSpectrum 兩欄、標頭列跳過、遞減匯出被排序、重複波長 throw', () => {
    const r = LiposomeParsers.parseUvSpectrum('wavelength [nm],abs.\n190,-3.635\n190.5,-4.531\n191,-5.041');
    assert.deepEqual(r.wavelength, [190, 190.5, 191]);
    assert.deepEqual(r.absorbance, [-3.635, -4.531, -5.041]);
    assert.equal(r.skipped, 1);
    assert.equal(r.sorted, false);

    const desc = LiposomeParsers.parseUvSpectrum('850 0.02\n849.5 0.028\n849 0.03');
    assert.deepEqual(desc.wavelength, [849, 849.5, 850]);
    assert.deepEqual(desc.absorbance, [0.03, 0.028, 0.02]);
    assert.equal(desc.sorted, true);

    assert.throws(() => LiposomeParsers.parseUvSpectrum('500 1\n500 2'), /波長 有重複值 500/);
});

test('[lipo-parse] LIMITS：點數超過 MAX_POINTS throw；MAX_BYTES 為 5 MB', () => {
    assert.equal(LiposomeParsers.LIMITS.MAX_BYTES, 5 * 1024 * 1024);
    assert.equal(LiposomeParsers.LIMITS.MAX_POINTS, 100000);
    const big = Array.from({ length: 100001 }, (_, k) => `${k} 1`).join('\n');
    assert.throws(() => LiposomeParsers.parseSaxsDat(big), /超過上限 100000/);
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 載入失敗（找不到 `liposome-file-parsers.js`）。

- [ ] **Step 4: 建立模組**

`js/liposome-file-parsers.js`：

```js
/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：檔案解析（SAXS .dat 與兩欄 UV-Vis 光譜）
 *
 * 兩個解析器共用 numericRows：逐行 trim、跳過空行與 # 註解、以空白／逗號／分號切欄，
 * 前 minCols 欄必須是有限數，否則整行略過並計入 skipped——PRIMUS/ATSAS 的文字標頭與
 * 儀器匯出的欄名列就這樣自然被跳過。不用 DndcFileParser.parseCSV：它固定把第一列當標頭，
 * 會吃掉沒有標頭的光譜檔第一列。
 *
 * 內插需要嚴格遞增的 x，這裡是唯一的保證點：非遞增就穩定排序（sorted: true），重複 x 就 throw。
 */
(function attachLiposomeFileParsers(global) {
    'use strict';

    const LIMITS = Object.freeze({
        MAX_BYTES: 5 * 1024 * 1024,
        MAX_POINTS: 100000,
    });

    const SPLIT_RE = /[\s,;]+/;

    /**
     * @param {string} text
     * @param {number} minCols
     * @returns {{rows:number[][], skipped:number}}
     */
    function numericRows(text, minCols) {
        if (typeof text !== 'string') throw new Error('檔案內容不是文字');
        const rows = [];
        let skipped = 0;
        text.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) return;
            const fields = trimmed.split(SPLIT_RE).map(Number);
            if (fields.length < minCols || fields.slice(0, minCols).some(v => !Number.isFinite(v))) {
                skipped += 1;
                return;
            }
            rows.push(fields);
        });
        if (rows.length === 0) throw new Error(`找不到數值列（每列至少要有 ${minCols} 欄數字）`);
        if (rows.length > LIMITS.MAX_POINTS) {
            throw new Error(`資料點 ${rows.length} 超過上限 ${LIMITS.MAX_POINTS}`);
        }
        return { rows, skipped };
    }

    /**
     * 依第 0 欄排序（已遞增就原樣回傳），重複 x → throw。
     * @returns {{ordered:number[][], sorted:boolean}}
     */
    function orderRows(rows, xLabel) {
        let monotonic = true;
        for (let k = 1; k < rows.length; k++) {
            if (!(rows[k][0] > rows[k - 1][0])) { monotonic = false; break; }
        }
        const ordered = monotonic ? rows : rows.slice().sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < ordered.length; k++) {
            if (ordered[k][0] === ordered[k - 1][0]) {
                throw new Error(`${xLabel} 有重複值 ${ordered[k][0]}，無法內插`);
            }
        }
        return { ordered, sorted: !monotonic };
    }

    /**
     * SAXS .dat：q, I(q)[, error]。
     * @param {string} text
     * @returns {{q:number[], i:number[], err:number[]|null, skipped:number, sorted:boolean}}
     */
    function parseSaxsDat(text) {
        const { rows, skipped } = numericRows(text, 2);
        const { ordered, sorted } = orderRows(rows, 'q');
        const hasErr = ordered.every(r => r.length >= 3 && Number.isFinite(r[2]));
        return Object.freeze({
            q: Object.freeze(ordered.map(r => r[0])),
            i: Object.freeze(ordered.map(r => r[1])),
            err: hasErr ? Object.freeze(ordered.map(r => r[2])) : null,
            skipped,
            sorted,
        });
    }

    /**
     * 兩欄 UV-Vis 光譜：wavelength [nm], absorbance。
     * @param {string} text
     * @returns {{wavelength:number[], absorbance:number[], skipped:number, sorted:boolean}}
     */
    function parseUvSpectrum(text) {
        const { rows, skipped } = numericRows(text, 2);
        const { ordered, sorted } = orderRows(rows, '波長');
        return Object.freeze({
            wavelength: Object.freeze(ordered.map(r => r[0])),
            absorbance: Object.freeze(ordered.map(r => r[1])),
            skipped,
            sorted,
        });
    }

    global.LiposomeFileParsers = Object.freeze({
        LIMITS,
        parseSaxsDat,
        parseUvSpectrum,
    });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: index.html 加 `<script>`**

在 `<script src="js/liposome-calculations.js"></script>` 之後：

```html
    <script src="js/liposome-file-parsers.js"></script>
```

- [ ] **Step 6: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 130`，`fail 0`。

- [ ] **Step 7: Commit**

```bash
git add saxs-calculator/js/liposome-file-parsers.js saxs-calculator/index.html saxs-calculator/tests/load.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): .dat and two-column spectrum parsers with size limits"
```

---

### Task 7: 本地 fixture 回歸測試（不存在就 skip）

**Files:**
- Create: `tests/liposome-local.test.js`
- 已存在（gitignored）：`tests/fixtures-local/liposome/solution.dat`、`bypass.dat`

- [ ] **Step 1: 寫測試**

```js
'use strict';
/**
 * 用本地 Excel 匯出的真實 SAXS 曲線驗證稀釋因子（規格 §9.2）。
 *
 * fixture 在 tests/fixtures-local/liposome/（.gitignore 擋住，論文資料不進公開 repo）。
 * 不存在就 skip，公開 CI 仍然綠。
 *
 * Excel dilution 頁（逐列硬配對）得 0.4386；本模組內插法 2026-09-05 預算得 0.4394（+0.19%）。
 * PRIMUS 截圖的 0.454 用這兩條曲線重現不了（各種視窗／權重都在 0.436–0.442），不斷言 lsqScale。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Liposome, LiposomeParsers } = require('./load.js');

const DIR = path.join(__dirname, 'fixtures-local', 'liposome');
const SOLUTION = path.join(DIR, 'solution.dat');
const BYPASS = path.join(DIR, 'bypass.dat');
const available = fs.existsSync(SOLUTION) && fs.existsSync(BYPASS);

test('[lipo-local] Excel dilution 頁兩條曲線：內插法平均在 0.4386 ± 1%', { skip: !available && '本地 fixture 不存在' }, () => {
    const solution = LiposomeParsers.parseSaxsDat(fs.readFileSync(SOLUTION, 'utf8'));
    const bypass = LiposomeParsers.parseSaxsDat(fs.readFileSync(BYPASS, 'utf8'));
    assert.equal(bypass.sorted, true, 'bypass 檔開頭有一列亂序的 q = 0，解析器要排序');
    assert.equal(solution.q.length, 373);
    assert.equal(bypass.q.length, 815);

    const r = Liposome.computeDilutionFactor(solution, bypass);
    assert.equal(r.n, 40, 'q 0.1–0.15 內 40 點，與 Excel FILTER 一致');
    assert.ok(Math.abs(r.factor / 0.4386 - 1) < 0.01, `factor ${r.factor} 偏離 0.4386 超過 1%`);
    assert.ok(r.sd / r.factor < 0.05, `相對離散 ${r.sd / r.factor} 應約 3%`);
});
```

- [ ] **Step 2: 跑測試**

Run: `node --test saxs-calculator/tests/liposome-local.test.js`
Expected: PASS（本機有 fixture）。再把 `saxs-calculator/tests/fixtures-local` 暫時改名（例如加 `.off` 後綴）跑一次同一個測試，確認 `skipped 1`，然後改回來。

- [ ] **Step 3: Commit**

```bash
git add saxs-calculator/tests/liposome-local.test.js
git commit -m "test(liposome): local-fixture regression against the Excel dilution sheet (skips when absent)"
```

---

### Task 8: 圖表模組 `liposome-charts.js`

沒有單元測試（Chart.js 需要 canvas）；`tests/structure.test.js` 會做語法檢查與引用檢查，實際畫面在 Task 12 用 Chrome 驗。

**Files:**
- Create: `js/liposome-charts.js`
- Modify: `index.html`（`liposome-file-parsers.js` 之後加 `<script>`）

- [ ] **Step 1: 建立模組**

```js
/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：Chart.js 圖表
 *
 * 三張圖：
 *   renderDilutionChart — log-log：solution、bypass、bypass ÷ 稀釋因子（虛線），q 視窗用 box 註解標出
 *   renderSpectraChart  — 含藥、空白、扣背景三條線，三個讀值波長畫垂直線
 *   renderFitChart      — 含藥實測 vs（空白 + k×純 DOX）模型，殘差走第二 y 軸
 *
 * 每個 canvas 只保留一個 Chart 實例（Map<canvasId, Chart>），重畫前 destroy。
 * 顏色沿用 charts.js 的字面值先例（Chart.js 讀不到 CSS 變數）。
 * 依賴：全域 Chart（Chart.js 4）與 annotation 外掛（index.html 已載入）。
 */
(function attachLiposomeCharts(global) {
    'use strict';

    const LIPO_CHART_COLORS = Object.freeze({
        primary: '#F04E4E',                    // --color-accent-brand，僅限圖線
        reference: '#5a5a78',                  // --color-text-muted
        model: '#047857',                      // emerald 文字色（CLAUDE.md）
        residual: '#92400e',                   // --color-accent-tertiary-text
        window: 'rgba(240, 78, 78, 0.08)',
        marker: 'rgba(168, 85, 85, 0.55)',
        text: 'rgba(26, 26, 46, 0.65)',
        grid: 'rgba(26, 26, 46, 0.12)',
    });

    const FONT = "'Inter', sans-serif";
    const MONO = "'JetBrains Mono', monospace";
    const charts = new Map();

    function getChart(canvasId) {
        return charts.get(canvasId) || null;
    }

    function replaceChart(canvasId, config) {
        const canvas = typeof document !== 'undefined' ? document.getElementById(canvasId) : null;
        if (!canvas || typeof global.Chart !== 'function') return null;
        const old = charts.get(canvasId);
        if (old) old.destroy();
        const chart = new global.Chart(canvas, config);
        charts.set(canvasId, chart);
        return chart;
    }

    function axis(title, extra = {}) {
        return {
            title: { display: true, text: title, color: LIPO_CHART_COLORS.text, font: { family: FONT, size: 11 } },
            ticks: { color: LIPO_CHART_COLORS.text, font: { family: MONO, size: 10 } },
            grid: { color: LIPO_CHART_COLORS.grid },
            ...extra,
        };
    }

    function baseOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            normalized: true,
            plugins: {
                legend: { labels: { color: LIPO_CHART_COLORS.text, font: { family: FONT, size: 11 } } },
                tooltip: {
                    backgroundColor: 'rgba(80, 20, 20, 0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255, 255, 255, 0.85)',
                    borderColor: 'rgba(240, 78, 78, 0.35)',
                    borderWidth: 1,
                    cornerRadius: 4,
                    padding: 8,
                    titleFont: { family: FONT, size: 12 },
                    bodyFont: { family: MONO, size: 11 },
                },
            },
        };
    }

    function line(label, xs, ys, color, extra = {}) {
        return {
            label,
            data: xs.map((x, k) => ({ x, y: ys[k] })),
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            ...extra,
        };
    }

    /** log-log 只能畫正值。 */
    function positivePoints(xs, ys) {
        const px = [];
        const py = [];
        xs.forEach((x, k) => {
            if (x > 0 && ys[k] > 0) { px.push(x); py.push(ys[k]); }
        });
        return { px, py };
    }

    /**
     * @param {string} canvasId
     * @param {{solution:{q:number[],i:number[]}, bypass:{q:number[],i:number[]}, factor:number, qMin:number, qMax:number}} p
     */
    function renderDilutionChart(canvasId, p) {
        const sol = positivePoints(p.solution.q, p.solution.i);
        const byp = positivePoints(p.bypass.q, p.bypass.i);
        const scaled = byp.py.map(y => y / p.factor);
        const options = baseOptions();
        options.scales = {
            x: axis('q (Å⁻¹)', { type: 'logarithmic' }),
            y: axis('I(q)', { type: 'logarithmic' }),
        };
        options.plugins.annotation = {
            annotations: {
                window: {
                    type: 'box',
                    xMin: p.qMin,
                    xMax: p.qMax,
                    backgroundColor: LIPO_CHART_COLORS.window,
                    borderWidth: 0,
                    label: { display: true, content: 'q 視窗', position: 'start', font: { size: 10 }, color: LIPO_CHART_COLORS.text },
                },
            },
        };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('solution cell', sol.px, sol.py, LIPO_CHART_COLORS.primary),
                    line('bypass', byp.px, byp.py, LIPO_CHART_COLORS.reference),
                    line(`bypass ÷ ${p.factor.toPrecision(4)}`, byp.px, scaled, LIPO_CHART_COLORS.model, { borderDash: [5, 4] }),
                ],
            },
            options,
        });
    }

    /**
     * @param {string} canvasId
     * @param {{loaded, blank, subtracted, wavelengths:number[]}} p - 三條 {wavelength, absorbance}
     */
    function renderSpectraChart(canvasId, p) {
        const options = baseOptions();
        const dataLo = p.loaded.wavelength[0];
        const dataHi = p.loaded.wavelength[p.loaded.wavelength.length - 1];
        const lo = Math.max(dataLo, 250);
        const hi = Math.min(dataHi, 600);
        const useClip = hi > lo;
        options.scales = {
            x: axis('波長 (nm)', { type: 'linear', min: useClip ? lo : dataLo, max: useClip ? hi : dataHi }),
            y: axis('吸光度 (A.U.)', { type: 'linear' }),
        };
        const annotations = {};
        p.wavelengths.forEach((w, k) => {
            annotations[`wl${k}`] = {
                type: 'line',
                xMin: w,
                xMax: w,
                borderColor: LIPO_CHART_COLORS.marker,
                borderWidth: 1,
                borderDash: [3, 3],
                label: { display: k === 1, content: `${w} nm`, position: 'end', font: { size: 10 }, color: LIPO_CHART_COLORS.text },
            };
        });
        options.plugins.annotation = { annotations };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('含藥 (Chol-DOX-Liposome)', p.loaded.wavelength, p.loaded.absorbance, LIPO_CHART_COLORS.reference),
                    line('空白 (Chol-Liposome)', p.blank.wavelength, p.blank.absorbance, LIPO_CHART_COLORS.model),
                    line('扣背景 (純 DOX 訊號)', p.subtracted.wavelength, p.subtracted.absorbance, LIPO_CHART_COLORS.primary, { borderWidth: 2 }),
                ],
            },
            options,
        });
    }

    /**
     * @param {string} canvasId
     * @param {{loaded, model, residual}} p - {wavelength, absorbance} ×3
     */
    function renderFitChart(canvasId, p) {
        const options = baseOptions();
        options.scales = {
            x: axis('波長 (nm)', { type: 'linear' }),
            y: axis('吸光度 (A.U.)', { type: 'linear', position: 'left' }),
            y1: axis('殘差', { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }),
        };
        return replaceChart(canvasId, {
            type: 'line',
            data: {
                datasets: [
                    line('含藥實測', p.loaded.wavelength, p.loaded.absorbance, LIPO_CHART_COLORS.primary, { yAxisID: 'y' }),
                    line('空白 + k×純 DOX', p.model.wavelength, p.model.absorbance, LIPO_CHART_COLORS.model, { yAxisID: 'y', borderDash: [5, 4] }),
                    line('殘差', p.residual.wavelength, p.residual.absorbance, LIPO_CHART_COLORS.residual, { yAxisID: 'y1', borderWidth: 1 }),
                ],
            },
            options,
        });
    }

    global.LiposomeCharts = Object.freeze({
        LIPO_CHART_COLORS,
        getChart,
        renderDilutionChart,
        renderSpectraChart,
        renderFitChart,
    });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: index.html 加 `<script>`**

在 `<script src="js/liposome-file-parsers.js"></script>` 之後：

```html
    <script src="js/liposome-charts.js"></script>
```

- [ ] **Step 3: 跑測試**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 131`（含 local），`fail 0`。structure 測試：語法、引用、無重複識別字都綠。

- [ ] **Step 4: Commit**

```bash
git add saxs-calculator/js/liposome-charts.js saxs-calculator/index.html
git commit -m "feat(liposome): Chart.js renderers for dilution, spectra and fit"
```

---

### Task 9: 結果表模組 `liposome-results-table.js`

**偏離規格 §7 的一點：** 結果表從一開始就獨立成檔（規格說先單檔、超 800 行再拆）。理由：CSV 組字串是純函式要在 Node 測，獨立成 IIFE 才能 `require`。

**Files:**
- Create: `js/liposome-results-table.js`
- Modify: `index.html`（`liposome-charts.js` 之後加 `<script>`）
- Modify: `tests/load.js`
- Modify: `tests/liposome.test.js`

- [ ] **Step 1: `tests/load.js` 加載**

```js
require(path.join(JS, 'liposome-results-table.js'));   // 頂層無 DOM 存取；只用 rowsToCsv / csvCell
```

`module.exports` 加：

```js
    LiposomeTable: window.LiposomeResultsTable,
```

- [ ] **Step 2: 寫失敗的測試**

`tests/liposome.test.js` 的 require 改為 `const { Liposome, LiposomeParsers, LiposomeTable } = require('./load.js');`，末尾加：

```js
// ---------------------------------------------------------------- 結果表 CSV
test('[lipo-table] csvCell：數字原樣、字串含逗號／引號／換行時 RFC 4180 引號', () => {
    assert.equal(LiposomeTable.csvCell(0.09359376319728743), '0.09359376319728743');
    assert.equal(LiposomeTable.csvCell(NaN), '');
    assert.equal(LiposomeTable.csvCell(null), '');
    assert.equal(LiposomeTable.csvCell('DOX-18'), 'DOX-18');
    assert.equal(LiposomeTable.csvCell('a,b'), '"a,b"');
    assert.equal(LiposomeTable.csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(LiposomeTable.csvCell('two\nlines'), '"two\nlines"');
});

test('[lipo-table] rowsToCsv：標頭 + 每列 + 中繼欄位，不四捨五入', () => {
    const row = {
        id: 'x1', sampleName: 'DOX-18, batch "A"', factor: 0.454, factorSource: 'manual',
        aPrimary: 0.91973, primaryWavelengthNm: 495,
        doxConcMM: 0.4971513513513514, lipidActualMM: 5.3118,
        dl: 0.09359376319728743, dlSd: 0.002032396638192102, addedAt: '2026-09-05T08:00:00.000Z',
        meta: { epsilon: 9250, pathCm: 0.2, qMin: 0.1, qMax: 0.15, wavelengths: [494, 495, 496], absorbances: [0.90287, 0.91973, 0.94266], factorSd: 0, absSource: 'manual' },
    };
    const csv = LiposomeTable.rowsToCsv([row]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0],
        'Sample,Dilution factor,Factor source,Factor SD,A(primary),Primary wavelength (nm),DOX conc (mM),Lipid actual (mM),D/L,D/L error,Added at,Epsilon (L/mol/cm),Path (cm),q min,q max,Wavelengths (nm),Absorbances,Absorbance source');
    assert.equal(lines[1],
        '"DOX-18, batch ""A""",0.454,manual,0,0.91973,495,0.4971513513513514,5.3118,0.09359376319728743,0.002032396638192102,2026-09-05T08:00:00.000Z,9250,0.2,0.1,0.15,494|495|496,0.90287|0.91973|0.94266,manual');
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 載入失敗（找不到 `liposome-results-table.js`）。

- [ ] **Step 4: 建立模組**

```js
/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：結果表
 *
 * 一列 = 一個樣品的 D/L 快照（由 section-liposome.js 的「加入結果表」送進來）。
 * 責任：localStorage 持久化（key tps13a.liposome.results，上限 200 列）、渲染、刪列、
 * 清空（原生 <dialog> 確認）、CSV 匯出（RFC 4180 引號，UTF-8 BOM 由 downloadCsv 加）。
 *
 * 頂層不碰 DOM，Node 可 require 測 csvCell / rowsToCsv。
 * 依賴（呼叫時才取用）：FormUtils.safeLocal、FormUtils.escapeHtml、showAlert、clearAlert、downloadCsv。
 */
(function attachLiposomeResultsTable(global) {
    'use strict';

    const RESULTS_KEY = 'tps13a.liposome.results';
    const MAX_ROWS = 200;

    const CSV_HEADER = [
        'Sample', 'Dilution factor', 'Factor source', 'Factor SD', 'A(primary)', 'Primary wavelength (nm)',
        'DOX conc (mM)', 'Lipid actual (mM)', 'D/L', 'D/L error', 'Added at',
        'Epsilon (L/mol/cm)', 'Path (cm)', 'q min', 'q max', 'Wavelengths (nm)', 'Absorbances', 'Absorbance source',
    ];

    const SOURCE_LABEL = Object.freeze({ saxs: 'SAXS 計算', manual: '手動', spectrum: '光譜讀值' });

    let rows = Object.freeze([]);
    let primaryWavelengthNm = 495;
    const els = {};

    // ------------------------------------------------------------ CSV（純函式）
    function csvCell(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function rowToCsv(r) {
        const m = r.meta || {};
        return [
            r.sampleName, r.factor, r.factorSource, m.factorSd, r.aPrimary, r.primaryWavelengthNm,
            r.doxConcMM, r.lipidActualMM, r.dl, r.dlSd, r.addedAt,
            m.epsilon, m.pathCm, m.qMin, m.qMax,
            Array.isArray(m.wavelengths) ? m.wavelengths.join('|') : '',
            Array.isArray(m.absorbances) ? m.absorbances.join('|') : '',
            m.absSource,
        ].map(csvCell).join(',');
    }

    function rowsToCsv(list) {
        return [CSV_HEADER.join(','), ...list.map(rowToCsv)].join('\n');
    }

    // ------------------------------------------------------------ 持久化
    function isRow(r) {
        return !!r && typeof r === 'object' && typeof r.id === 'string' && Number.isFinite(r.dl);
    }

    function loadRows() {
        const raw = global.FormUtils.safeLocal.get(RESULTS_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter(isRow) : [];
        } catch (err) {
            console.warn('[liposome] 結果表 JSON 損壞，已忽略', err);
            return [];
        }
    }

    function setRows(next) {
        rows = Object.freeze(next);
        global.FormUtils.safeLocal.set(RESULTS_KEY, JSON.stringify(rows));
        render();
    }

    // ------------------------------------------------------------ 渲染
    function fmt(v, digits) {
        return Number.isFinite(v) ? v.toPrecision(digits) : '-';
    }

    function absCell(r) {
        const same = r.primaryWavelengthNm === primaryWavelengthNm;
        const title = same ? '' : ` title="讀值波長 ${r.primaryWavelengthNm} nm"`;
        const tag = same ? '' : ` <small>(${r.primaryWavelengthNm})</small>`;
        return `<td class="text-right"${title}>${fmt(r.aPrimary, 5)}${tag}</td>`;
    }

    function rowHtml(r) {
        const esc = global.FormUtils.escapeHtml;
        const when = new Date(r.addedAt);
        const whenText = Number.isNaN(when.getTime()) ? '-' : when.toLocaleString('zh-TW', { hour12: false });
        return `<tr>
            <td>${esc(r.sampleName)}</td>
            <td class="text-right">${fmt(r.factor, 4)}</td>
            <td>${esc(SOURCE_LABEL[r.factorSource] || r.factorSource)}</td>
            ${absCell(r)}
            <td class="text-right">${fmt(r.doxConcMM, 4)}</td>
            <td class="text-right">${fmt(r.lipidActualMM, 4)}</td>
            <td class="text-right"><strong>${fmt(r.dl, 4)}</strong></td>
            <td class="text-right">${fmt(r.dlSd, 3)}</td>
            <td>${esc(whenText)}</td>
            <td class="text-center"><button type="button" class="btn btn-secondary btn-sm" data-delete-id="${esc(r.id)}" aria-label="刪除 ${esc(r.sampleName)}">刪除</button></td>
        </tr>`;
    }

    function render() {
        if (!els.body) return;
        els.body.innerHTML = rows.map(rowHtml).join('');
        if (els.absHeader) els.absHeader.textContent = `A(${primaryWavelengthNm} nm)`;
        const empty = rows.length === 0;
        if (els.empty) els.empty.hidden = !empty;
        if (els.wrapper) els.wrapper.hidden = empty;
        if (els.exportBtn) els.exportBtn.disabled = empty;
        if (els.clearBtn) els.clearBtn.disabled = empty;
        if (els.count) els.count.textContent = empty ? '' : `${rows.length} 列`;
    }

    // ------------------------------------------------------------ 操作
    function add(row) {
        if (!isRow(row)) throw new Error('結果列格式不正確');
        if (rows.length >= MAX_ROWS) {
            global.showAlert('lipoResultsAlert', 'error', `結果表已達 ${MAX_ROWS} 列上限，請先匯出 CSV 再清空`);
            return false;
        }
        setRows([...rows, row]);
        global.clearAlert('lipoResultsAlert');
        return true;
    }

    function remove(id) {
        setRows(rows.filter(r => r.id !== id));
    }

    function clear() {
        setRows([]);
    }

    function setPrimaryWavelength(nm) {
        if (!Number.isFinite(nm)) return;
        primaryWavelengthNm = nm;
        render();
    }

    function exportCsv() {
        if (rows.length === 0) return;
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        global.downloadCsv(`liposome-DL-${stamp}.csv`, rowsToCsv(rows));
    }

    function bindClearDialog() {
        const dialog = els.dialog;
        if (!dialog || !els.clearBtn) return;
        const supportsDialog = typeof dialog.showModal === 'function';
        els.clearBtn.addEventListener('click', () => {
            // returnValue 會跨次保留：確認清空一次後，下次用 Escape 關閉也會帶著 'confirm' 觸發 close。
            // 每次開啟前清掉，否則會無聲清空整張表。
            dialog.returnValue = '';
            if (supportsDialog) dialog.showModal(); else dialog.setAttribute('open', '');
        });
        dialog.addEventListener('close', () => {
            if (dialog.returnValue === 'confirm') clear();
            // 清空後 clearBtn 已被 render() 停用，焦點移不過去；改落在空狀態文字
            const target = rows.length === 0 ? els.empty : els.clearBtn;
            if (target) { target.setAttribute('tabindex', '-1'); target.focus(); }
        });
        els.dialogCancel?.addEventListener('click', () => {
            if (supportsDialog) dialog.close('cancel'); else dialog.removeAttribute('open');
        });
    }

    function init() {
        const $ = id => document.getElementById(id);
        els.body = $('lipoResultsBody');
        els.wrapper = $('lipoResultsWrapper');
        els.empty = $('lipoResultsEmpty');
        els.absHeader = $('lipoResultsAbsHeader');
        els.count = $('lipoResultsCount');
        els.exportBtn = $('lipoExportCsv');
        els.clearBtn = $('lipoClearResults');
        els.dialog = $('lipoClearDialog');
        els.dialogCancel = $('lipoClearCancel');
        if (!els.body) return;

        rows = Object.freeze(loadRows());
        render();

        els.body.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-delete-id]');
            if (btn) remove(btn.dataset.deleteId);
        });
        els.exportBtn?.addEventListener('click', exportCsv);
        bindClearDialog();
    }

    global.LiposomeResultsTable = Object.freeze({
        RESULTS_KEY,
        MAX_ROWS,
        csvCell,
        rowsToCsv,
        init,
        add,
        remove,
        clear,
        setPrimaryWavelength,
        getRows: () => rows,
    });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: index.html 加 `<script>`**

在 `<script src="js/liposome-charts.js"></script>` 之後：

```html
    <script src="js/liposome-results-table.js"></script>
```

- [ ] **Step 6: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 133`，`fail 0`。

- [ ] **Step 7: Commit**

```bash
git add saxs-calculator/js/liposome-results-table.js saxs-calculator/index.html saxs-calculator/tests/load.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): results table with localStorage persistence and RFC 4180 CSV export"
```

---

### Task 10: index.html 標記、側欄、dialog、持久化例外、版本

> 2026-09-05 實作後補記：品質審查要求的修正（`3419ca2`）已同步進下面的標記——`min`/`step` 改成讓預設值落在格點上、計算填入的欄位 `step="any"`、兩個 `aria-describedby`；另在 `css/components.css` 加了 `.btn[hidden]`、`.btn:disabled`、`.table caption` 三條規則（本 task 原文說不改 CSS，該說法作廢）。

這個 task 只動標記與兩行 JS，不含面板邏輯（Task 11）。做完頁面會多一個分頁，按鈕還沒反應是預期的。

**Files:**
- Modify: `index.html`（側欄 ~95 行、section 插在 `section-detector` 結束之後 / `section-dndc-theory` 之前、dialog 在 `dndcPasswordModal` 之後、版本 131 行）
- Modify: `js/form-persistence.js:13`
- Modify: `js/app.js:37`

- [ ] **Step 1: 側欄**

在 `data-section="detector"` 的 `</button>` 之後（`</div>` 收掉「分析工具」nav-section 之前）加：

```html
                    <button class="nav-item" data-section="liposome" data-short="載藥" data-title="脂質體 DOX 載藥">
                        <span class="nav-item-text">脂質體 DOX 載藥</span>
                    </button>
```

- [ ] **Step 2: section 標記**

找到 `<section class="section" id="section-dndc-theory"`，它上方有一行 `<!-- Section: dn/dc Theoretical Calculator -->` 註解；把整段插在**那行註解之前**（否則 dn/dc 的註解會落在脂質體 section 上方）：

```html
            <!-- ============ 脂質體 DOX 載藥量 (D/L) ============ -->
            <section class="section" id="section-liposome" aria-labelledby="liposome-title">
                <div class="page-header">
                    <h1 class="page-title" id="liposome-title">脂質體 DOX 載藥量 (D/L)</h1>
                    <p class="page-subtitle">由 solution cell 與 bypass 的 SAXS 曲線求稀釋因子，UV-Vis 光譜扣背景得純 DOX 吸收，再算 drug-to-lipid 莫耳比與誤差。一次一個樣品，結果累積在最下方的表格。</p>
                </div>

                <!-- 面板 1：稀釋因子 -->
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">1. 稀釋因子（SAXS）</h2>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-2">
                            <div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoSolutionFile">Solution cell 曲線 (.dat)</label>
                                    <input type="file" class="form-input" id="lipoSolutionFile" accept=".dat,.txt,.csv">
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoBypassFile">Bypass 曲線 (.dat)</label>
                                    <input type="file" class="form-input" id="lipoBypassFile" accept=".dat,.txt,.csv">
                                </div>
                                <div class="grid grid-2">
                                    <div class="form-group">
                                        <label class="form-label" for="lipoQMin">q 下限</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoQMin" value="0.1" min="0.005" max="2" step="0.005">
                                            <span class="input-unit">Å⁻¹</span>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoQMax">q 上限</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoQMax" value="0.15" min="0.005" max="2" step="0.005">
                                            <span class="input-unit">Å⁻¹</span>
                                        </div>
                                    </div>
                                </div>
                                <button type="button" class="btn btn-primary btn-lg btn-full" id="lipoComputeDilution" disabled>計算稀釋因子</button>
                                <div class="form-group mt-md">
                                    <label class="form-label" for="lipoDilutionFactor">目前採用的稀釋因子 <span class="info-panel-chip" id="lipoDilutionChip" hidden>手動</span></label>
                                    <input type="number" class="form-input" id="lipoDilutionFactor" placeholder="計算後自動填入，或手動輸入 PRIMUS 的 I Scale" min="0.0001" step="any" aria-describedby="lipoFactorEcho">
                                    <div class="stat-sub" id="lipoFactorEcho">尚未設定稀釋因子</div>
                                </div>
                            </div>
                            <div>
                                <div id="lipoDilutionResults" class="mt-sm"></div>
                                <div class="chart-container mt-md">
                                    <canvas id="lipoDilutionChart" role="img" aria-label="尚未載入 SAXS 曲線"></canvas>
                                </div>
                                <button type="button" class="btn btn-secondary btn-sm mt-sm" id="lipoDilutionPng" disabled>下載 PNG</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 面板 2：UV 光譜 -->
                <div class="card mt-lg">
                    <div class="card-header">
                        <h2 class="card-title">2. UV-Vis 光譜扣背景</h2>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-2">
                            <div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoLoadedFile">含藥光譜 Chol-DOX-Liposome（波長, 吸光度）</label>
                                    <input type="file" class="form-input" id="lipoLoadedFile" accept=".csv,.txt,.tsv,.dat">
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoBlankFile">空白光譜 Chol-Liposome</label>
                                    <input type="file" class="form-input" id="lipoBlankFile" accept=".csv,.txt,.tsv,.dat">
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoPureFile">純 DOX 光譜（選填，用於濃度一致性檢查）</label>
                                    <input type="file" class="form-input" id="lipoPureFile" accept=".csv,.txt,.tsv,.dat">
                                </div>
                                <div class="grid grid-2">
                                    <div class="form-group">
                                        <label class="form-label" for="lipoFitMin">擬合下限</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoFitMin" value="450" min="190" max="900" step="1">
                                            <span class="input-unit">nm</span>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoFitMax">擬合上限</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoFitMax" value="550" min="190" max="900" step="1">
                                            <span class="input-unit">nm</span>
                                        </div>
                                    </div>
                                </div>
                                <button type="button" class="btn btn-primary btn-lg btn-full" id="lipoComputeSpectra" disabled>扣背景</button>

                                <div class="section-divider mt-md"><span>讀值波長與吸光度</span></div>
                                <div class="grid grid-3">
                                    <div class="form-group">
                                        <label class="form-label" for="lipoWl1">波長 1</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoWl1" value="494" min="190" max="900" step="0.5">
                                            <span class="input-unit">nm</span>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoWl2">主波長</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoWl2" value="495" min="190" max="900" step="0.5">
                                            <span class="input-unit">nm</span>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoWl3">波長 3</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoWl3" value="496" min="190" max="900" step="0.5">
                                            <span class="input-unit">nm</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="grid grid-3">
                                    <div class="form-group">
                                        <label class="form-label" for="lipoAbs1">A(波長 1)</label>
                                        <input type="number" class="form-input" id="lipoAbs1" step="any" placeholder="扣背景後自動填入">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoAbs2">A(主波長) <span class="info-panel-chip" id="lipoAbsChip" hidden>手動</span></label>
                                        <input type="number" class="form-input" id="lipoAbs2" step="any" aria-describedby="lipoAbsSummary" placeholder="扣背景後自動填入">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoAbs3">A(波長 3)</label>
                                        <input type="number" class="form-input" id="lipoAbs3" step="any" placeholder="扣背景後自動填入">
                                    </div>
                                </div>
                                <div class="stat-sub" id="lipoAbsSummary"></div>
                            </div>
                            <div>
                                <div id="lipoSpectraResults" class="mt-sm"></div>
                                <div class="chart-container mt-md">
                                    <canvas id="lipoSpectraChart" role="img" aria-label="尚未載入光譜"></canvas>
                                </div>
                                <div class="chart-container mt-md" id="lipoFitChartWrap" hidden>
                                    <canvas id="lipoFitChart" role="img" aria-label="尚未載入純 DOX 光譜"></canvas>
                                </div>
                                <button type="button" class="btn btn-secondary btn-sm mt-sm" id="lipoSpectraPng" disabled>下載 PNG</button>
                                <button type="button" class="btn btn-secondary btn-sm mt-sm" id="lipoFitPng" hidden>下載擬合圖 PNG</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 面板 3：D/L -->
                <div class="card mt-lg">
                    <div class="card-header">
                        <h2 class="card-title">3. D/L（drug-to-lipid 莫耳比）</h2>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-2">
                            <div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoSampleName">樣品名</label>
                                    <input type="text" class="form-input" id="lipoSampleName" maxlength="60" placeholder="例如 Chol-DOX-20">
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="lipoLipidConc">脂質原始濃度</label>
                                    <div class="form-input-group">
                                        <input type="number" class="form-input" id="lipoLipidConc" min="0.01" step="0.01" placeholder="例如 11.7">
                                        <span class="input-unit">mM</span>
                                    </div>
                                </div>
                                <div class="grid grid-2">
                                    <div class="form-group">
                                        <label class="form-label" for="lipoEpsilon">ε (DOX)</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoEpsilon" value="9250" min="10" step="10">
                                            <span class="input-unit">L·mol⁻¹·cm⁻¹</span>
                                        </div>
                                        <div class="stat-sub">495 nm，Lee et al., Int. J. Nanomed. 20 (2025) 6357–6378</div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="lipoPathLength">光徑</label>
                                        <div class="form-input-group">
                                            <input type="number" class="form-input" id="lipoPathLength" value="0.2" min="0.01" step="0.01">
                                            <span class="input-unit">cm</span>
                                        </div>
                                        <div class="stat-sub">SAXS 毛細管厚度</div>
                                    </div>
                                </div>
                                <button type="button" class="btn btn-primary btn-lg btn-full" id="lipoComputeDl">計算 D/L</button>
                                <button type="button" class="btn btn-secondary btn-full mt-sm" id="lipoAddResult" disabled>加入結果表</button>
                            </div>
                            <div>
                                <div id="lipoDlResults" class="mt-sm"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 結果表 -->
                <div class="card mt-lg">
                    <div class="card-header">
                        <h2 class="card-title">結果表 <span class="stat-sub" id="lipoResultsCount"></span></h2>
                    </div>
                    <div class="card-body">
                        <div id="lipoResultsAlert"></div>
                        <p class="stat-sub" id="lipoResultsEmpty">尚無結果。在上方算出 D/L 後按「加入結果表」。</p>
                        <div class="table-wrapper" id="lipoResultsWrapper" tabindex="0" role="region" aria-label="脂質體 D/L 結果表（可橫向捲動）" hidden>
                            <table class="table" id="lipoResultsTable">
                                <caption class="stat-sub">每列一個樣品；數值以完整精度存檔，表格顯示 4 位有效數字。</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">樣品</th>
                                        <th scope="col" class="text-right">稀釋因子</th>
                                        <th scope="col">因子來源</th>
                                        <th scope="col" class="text-right" id="lipoResultsAbsHeader">A(495 nm)</th>
                                        <th scope="col" class="text-right">[DOX] mM</th>
                                        <th scope="col" class="text-right">脂質實際 mM</th>
                                        <th scope="col" class="text-right">D/L</th>
                                        <th scope="col" class="text-right">誤差</th>
                                        <th scope="col">加入時間</th>
                                        <th scope="col"><span class="sr-only">操作</span></th>
                                    </tr>
                                </thead>
                                <tbody id="lipoResultsBody"></tbody>
                            </table>
                        </div>
                        <div class="mt-md">
                            <button type="button" class="btn btn-primary" id="lipoExportCsv" disabled>匯出 CSV</button>
                            <button type="button" class="btn btn-secondary" id="lipoClearResults" disabled>清空</button>
                        </div>
                    </div>
                </div>
            </section>
```

- [ ] **Step 3: 清空確認 dialog**

在 `</dialog>`（dndcPasswordModal 結束）之後、`</body>` 之前加：

```html
    <!-- 脂質體結果表：清空確認 -->
    <dialog id="lipoClearDialog" class="modal-dialog" aria-labelledby="lipoClearTitle" aria-describedby="lipoClearDesc">
        <form method="dialog" class="modal-content">
            <h2 class="modal-title" id="lipoClearTitle">清空結果表？</h2>
            <p class="modal-desc" id="lipoClearDesc">所有列都會被刪除，且無法復原。建議先匯出 CSV。</p>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="lipoClearCancel">取消</button>
                <button type="submit" class="btn btn-primary" value="confirm">清空</button>
            </div>
        </form>
    </dialog>
```

- [ ] **Step 4: 版本、持久化例外、app.js**

- `index.html:131`：`Version 4.13` → `Version 4.14`。
- `js/form-persistence.js:13`：

```js
const PERSIST_SKIP_IDS = Object.freeze([
    'dndcPasswordInput', 'detectorRgInput',
    // 脂質體頁的 chip 管理欄位：重新整理後沒有 SD 與來源，還原數值只會做出沒有來源的因子
    'lipoDilutionFactor', 'lipoAbs1', 'lipoAbs2', 'lipoAbs3',
]);
```

- `js/app.js`：在 `initIUCrSection();` 之後加：

```js
    window.LiposomeSection?.init();
```

（`LiposomeSection` 在 Task 11 才存在；`?.` 讓這個 commit 的頁面不炸。）

- [ ] **Step 5: 跑測試 + 開頁面**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 133`，`fail 0`。

用 Chrome 開 `saxs-calculator/index.html`（或 `python3 -m http.server` 後開 localhost），點側欄「脂質體 DOX 載藥」：三張卡與結果表出現、console 無錯。

- [ ] **Step 6: Commit**

```bash
git add saxs-calculator/index.html saxs-calculator/js/form-persistence.js saxs-calculator/js/app.js
git commit -m "feat(liposome): page markup, nav item, clear-confirm dialog, persistence exceptions; bump to v4.14"
```

---

### Task 11: 面板 UI 模組 `section-liposome.js`

**偏離規格 §7 的兩點：**
1. 規格說「匯出全域 `initLiposomeSection()`」；這裡改成 IIFE 掛 `window.LiposomeSection = { init }`，`app.js` 用 `window.LiposomeSection?.init()` 呼叫（Task 10 已寫好）。理由：~450 行的 UI 若照 section-*.js 的寫法全部塞進一個頂層函式，內部 helper 沒法分段；IIFE 讓 helper 在縮排內，不會撞到全域識別字。
2. 樣品名在「加入結果表」當下讀取，不在「計算 D/L」時快照。它是標籤不是參數，使用者常常算完才想到要命名；規格要求快照的目的（吸光度改了 D/L 還是舊的）由 `INVALIDATING_IDS` 保證，樣品名不在其中。

**Files:**
- Create: `js/section-liposome.js`
- Modify: `index.html`（`section-iucr.js` 之後加 `<script>`）

- [ ] **Step 1: 建立模組**

```js
/**
 * TPS13A SAXS Calculator - 脂質體 DOX 載藥：三個面板的 UI 與狀態
 *
 * 流程（規格 §2）：面板 1 稀釋因子 → 面板 2 光譜扣背景與讀值 → 面板 3 D/L → 加入結果表。
 *
 * 狀態規則（規格 §3、§7）：
 *   - 輸入框是真值，state 是鏡像：lipoDilutionFactor / lipoAbs1–3 每次 input 都同步回 state
 *   - state.dl 是快照，只在「計算 D/L」成功時建立；INVALIDATING_IDS 任一 input 事件就作廢
 *     並停用「加入結果表」，直到下一次計算成功
 *   - 錯誤：showAlert 取代結果區；輸入值、chip、圖表不動
 *   - 成功：渲染函式自組 HTML（含警告列），再 A11y.focusResults
 *
 * 依賴：LiposomeCalculations、LiposomeFileParsers、LiposomeCharts、LiposomeResultsTable、
 *       DndcFileParser.readFile、FormUtils、A11y、showAlert、downloadChartPng。
 */
(function attachLiposomeSection(global) {
    'use strict';

    const Calc = () => global.LiposomeCalculations;
    const Parsers = () => global.LiposomeFileParsers;
    const Charts = () => global.LiposomeCharts;
    const Table = () => global.LiposomeResultsTable;
    const esc = (v) => global.FormUtils.escapeHtml(v);

    const INVALIDATING_IDS = Object.freeze([
        'lipoDilutionFactor', 'lipoAbs1', 'lipoAbs2', 'lipoAbs3',
        'lipoWl1', 'lipoWl2', 'lipoWl3', 'lipoLipidConc', 'lipoEpsilon', 'lipoPathLength',
    ]);

    const SOURCE_LABEL = Object.freeze({ saxs: 'SAXS 計算', manual: '手動', spectrum: '光譜讀值' });

    const initialState = () => Object.freeze({
        dilution: Object.freeze({ factor: null, sd: 0, n: 0, lsqScale: null, source: null }),
        spectra: null,
        absorbance: Object.freeze({ values: Object.freeze([null, null, null]), sd: 0, source: null }),
        dl: null,
    });

    let state = initialState();
    const els = {};

    function setState(patch) {
        state = Object.freeze({ ...state, ...patch });
    }

    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------ 共用小工具
    function setChip(chip, source) {
        if (!chip) return;
        if (!source) { chip.hidden = true; return; }
        chip.hidden = false;
        chip.textContent = SOURCE_LABEL[source];
        chip.className = `info-panel-chip${source === 'manual' ? ' info-panel-chip--manual' : ''}`;
    }

    function setAddEnabled(enabled) {
        if (els.addResult) els.addResult.disabled = !enabled;
    }

    function invalidateDl() {
        if (state.dl) setState({ dl: null });
        setAddEnabled(false);
    }

    function warningRow(text) {
        return `<div class="alert alert-warning mt-sm">${esc(text)}</div>`;
    }

    function resultItem(label, value, unit = '') {
        return `<div class="result-item"><div class="result-label">${esc(label)}</div><div class="result-value">${value}${unit ? ` <span class="stat-unit">${esc(unit)}</span>` : ''}</div></div>`;
    }

    function pct(rel) {
        return `${(rel * 100).toFixed(2)}%`;
    }

    /** 讀檔（含大小上限），回 Promise<string>。 */
    function readChecked(input, label) {
        const file = input && input.files && input.files[0];
        if (!file) throw new Error(`請先選擇${label}檔案`);
        if (file.size > Parsers().LIMITS.MAX_BYTES) {
            throw new Error(`${label}檔案 ${(file.size / 1048576).toFixed(1)} MB 超過上限 5 MB`);
        }
        return global.DndcFileParser.readFile(file);
    }

    function syncButtons() {
        if (els.computeDilution) {
            els.computeDilution.disabled = !(els.solutionFile?.files?.length && els.bypassFile?.files?.length);
        }
        if (els.computeSpectra) {
            els.computeSpectra.disabled = !(els.loadedFile?.files?.length && els.blankFile?.files?.length);
        }
        if (els.dilutionPng) els.dilutionPng.disabled = !Charts().getChart('lipoDilutionChart');
        if (els.spectraPng) els.spectraPng.disabled = !Charts().getChart('lipoSpectraChart');
        if (els.fitPng) els.fitPng.hidden = !(state.spectra && state.spectra.fit);
    }

    // ------------------------------------------------------------ 面板 1：稀釋因子
    function syncFactorEcho() {
        if (!els.factorEcho) return;
        const d = state.dilution;
        if (!(d.factor > 0)) { els.factorEcho.textContent = '尚未設定稀釋因子'; return; }
        if (d.source === 'saxs') {
            els.factorEcho.textContent = `SAXS 計算：${d.factor.toPrecision(4)} ± ${d.sd.toPrecision(2)}（n = ${d.n}）`;
        } else {
            els.factorEcho.textContent = `手動因子 ${d.factor.toPrecision(4)}，無離散度（誤差只含 UV 項）`;
        }
    }

    function renderDilutionResults(r, qMin, qMax) {
        const rel = Math.abs(r.lsqScale / r.factor - 1);
        const warn = rel > Calc().DEFAULTS.LSQ_WARN_REL
            ? warningRow(`逐點平均與最小平方縮放相差 ${pct(rel)}，請確認 q 視窗內兩曲線形狀一致`)
            : '';
        const excluded = r.excluded.outOfRange + r.excluded.nonPositive;
        els.dilutionResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">稀釋因子（I_bypass / I_solution 逐點平均）</div>
                    <div class="stat-value">${r.factor.toPrecision(4)} <span class="stat-unit">± ${r.sd.toPrecision(2)}</span></div>
                    <div class="stat-sub">q ${qMin}–${qMax} Å⁻¹，n = ${r.n}，相對離散 ${pct(r.sd / r.factor)}</div>
                </div>
            </div>
            <div class="result-grid mt-sm">
                ${resultItem('最小平方縮放（PRIMUS I Scale 等價）', r.lsqScale.toPrecision(4))}
                ${resultItem('排除點', String(excluded), excluded ? `超出範圍 ${r.excluded.outOfRange}、非正 ${r.excluded.nonPositive}` : '')}
            </div>
            ${warn}`;
        global.A11y.focusResults('lipoDilutionResults');
    }

    async function onComputeDilution() {
        try {
            const [solText, bypText] = await Promise.all([
                readChecked(els.solutionFile, ' solution cell '),
                readChecked(els.bypassFile, ' bypass '),
            ]);
            const solution = Parsers().parseSaxsDat(solText);
            const bypass = Parsers().parseSaxsDat(bypText);
            const qMin = global.FormUtils.readPositiveField('lipoQMin', 'q 下限');
            const qMax = global.FormUtils.readPositiveField('lipoQMax', 'q 上限');
            const r = Calc().computeDilutionFactor(solution, bypass, { qMin, qMax });

            setState({ dilution: { factor: r.factor, sd: r.sd, n: r.n, lsqScale: r.lsqScale, source: 'saxs' } });
            invalidateDl();
            els.factor.value = r.factor.toPrecision(6);
            setChip(els.factorChip, 'saxs');
            syncFactorEcho();
            renderDilutionResults(r, qMin, qMax);
            Charts().renderDilutionChart('lipoDilutionChart', { solution, bypass, factor: r.factor, qMin, qMax });
            global.A11y.describeChart('lipoDilutionChart',
                `log-log 疊圖：solution cell、bypass、bypass 除以 ${r.factor.toPrecision(4)}；q 視窗 ${qMin}–${qMax}`);
            syncButtons();
        } catch (err) {
            global.showAlert('lipoDilutionResults', 'error', err.message);
        }
    }

    function onFactorInput() {
        const v = parseFloat(els.factor.value);
        setState({ dilution: { ...state.dilution, factor: Number.isFinite(v) ? v : null, sd: 0, n: 0, source: 'manual' } });
        setChip(els.factorChip, 'manual');
        syncFactorEcho();
    }

    // ------------------------------------------------------------ 面板 2：光譜
    function currentWavelengths() {
        return [els.wl1, els.wl2, els.wl3].map((el, k) =>
            global.FormUtils.parsePositiveNumber(el.value, `讀值波長 ${k + 1}`));
    }

    function updateAbsSummary() {
        if (!els.absSummary) return;
        const a = state.absorbance;
        if (!a.source) { els.absSummary.textContent = ''; return; }
        const label = SOURCE_LABEL[a.source];
        els.absSummary.textContent = a.values.every(Number.isFinite)
            ? `${label}：三值樣本標準差 ${a.sd.toPrecision(3)}`
            : `${label}：三個吸光度都填好才能算 D/L`;
    }

    /** 從扣背景光譜讀三個波長，填入輸入框（五位小數），state 鏡像輸入框的值。 */
    function readAbsorbancesFromSpectrum() {
        const wls = currentWavelengths();
        const raw = Calc().absorbanceAt(state.spectra.subtracted, wls);
        const shown = raw.map(v => Number(v.toFixed(5)));
        [els.abs1, els.abs2, els.abs3].forEach((el, k) => { el.value = shown[k].toFixed(5); });
        setState({ absorbance: { values: Object.freeze(shown), sd: Calc().sampleStd(shown), source: 'spectrum' } });
        setChip(els.absChip, 'spectrum');
        updateAbsSummary();
    }

    function renderSpectraResults(subtracted, fit) {
        const a = state.absorbance;
        const fitHtml = fit
            ? `<div class="result-grid mt-sm">
                   ${resultItem('純 DOX 縮放係數 k', fit.k.toPrecision(4))}
                   ${resultItem('擬合殘差 RMS', fit.rms.toPrecision(3), `A.U.，n = ${fit.n}`)}
               </div>
               <p class="stat-sub mt-sm">k 是讓「空白 + k×純 DOX」最貼近含藥光譜的縮放；殘差大代表兩樣品的脂質濃度可能不一致。網站不判定通過與否，請看下方擬合圖。</p>`
            : '';
        els.spectraResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">扣背景後 A(主波長)</div>
                    <div class="stat-value">${a.values[1].toFixed(5)} <span class="stat-unit">± ${a.sd.toPrecision(2)}</span></div>
                    <div class="stat-sub">重疊 ${subtracted.wavelength.length} 點${subtracted.dropped ? `，捨棄 ${subtracted.dropped} 點（超出空白光譜範圍）` : ''}</div>
                </div>
            </div>
            ${fitHtml}`;
        global.A11y.focusResults('lipoSpectraResults');
    }

    async function onComputeSpectra() {
        try {
            const [loadedText, blankText] = await Promise.all([
                readChecked(els.loadedFile, '含藥光譜'),
                readChecked(els.blankFile, '空白光譜'),
            ]);
            const loaded = Parsers().parseUvSpectrum(loadedText);
            const blank = Parsers().parseUvSpectrum(blankText);
            const subtracted = Calc().subtractSpectra(loaded, blank);

            let fit = null;
            if (els.pureFile.files.length) {
                const pure = Parsers().parseUvSpectrum(await readChecked(els.pureFile, '純 DOX 光譜'));
                const fitMin = global.FormUtils.readPositiveField('lipoFitMin', '擬合下限');
                const fitMax = global.FormUtils.readPositiveField('lipoFitMax', '擬合上限');
                fit = Calc().fitPureDoxScale(loaded, blank, pure, { fitMin, fitMax });
            }

            setState({ spectra: Object.freeze({ loaded, blank, subtracted, fit }) });
            invalidateDl();
            readAbsorbancesFromSpectrum();
            renderSpectraResults(subtracted, fit);

            const wls = currentWavelengths();
            Charts().renderSpectraChart('lipoSpectraChart', { loaded, blank, subtracted, wavelengths: wls });
            global.A11y.describeChart('lipoSpectraChart',
                `含藥、空白與扣背景光譜；主波長 ${wls[1]} nm 吸光度 ${state.absorbance.values[1]}`);
            els.fitChartWrap.hidden = !fit;
            if (fit) {
                Charts().renderFitChart('lipoFitChart', { loaded, model: fit.model, residual: fit.residual });
                global.A11y.describeChart('lipoFitChart', `含藥實測與空白加 ${fit.k.toPrecision(3)} 倍純 DOX 的模型，殘差 RMS ${fit.rms.toPrecision(2)}`);
            }
            syncButtons();
        } catch (err) {
            global.showAlert('lipoSpectraResults', 'error', err.message);
        }
    }

    function onWavelengthInput() {
        const wl2 = parseFloat(els.wl2.value);
        Table().setPrimaryWavelength(wl2);
        if (!state.spectra) return;
        try {
            readAbsorbancesFromSpectrum();
        } catch (err) {
            global.showAlert('lipoSpectraResults', 'error', err.message);
        }
    }

    function onAbsInput() {
        const values = [els.abs1, els.abs2, els.abs3].map(el => parseFloat(el.value));
        const complete = values.every(Number.isFinite);
        setState({ absorbance: { values: Object.freeze(values), sd: complete ? Calc().sampleStd(values) : 0, source: 'manual' } });
        setChip(els.absChip, 'manual');
        updateAbsSummary();
    }

    // ------------------------------------------------------------ 面板 3：D/L
    function renderDlResults(snap) {
        const p = snap.params;
        els.dlResults.innerHTML = `
            <div class="stat-card">
                <div class="stat-content">
                    <div class="stat-label">D/L（drug-to-lipid 莫耳比）</div>
                    <div class="stat-value">${snap.dl.toPrecision(4)} <span class="stat-unit">± ${snap.dlSd.toPrecision(2)}</span></div>
                    <div class="stat-sub">誤差 = D/L × √(relA² + relF²)：UV 三波長貢獻 ${pct(snap.relA)}，稀釋因子貢獻 ${pct(snap.relF)}</div>
                    <div class="stat-sub">Excel 原式（僅 UV）：${snap.dl.toPrecision(4)} ± ${snap.dlSdExcel.toPrecision(2)}</div>
                </div>
            </div>
            <div class="result-grid mt-sm">
                ${resultItem('[DOX]', (snap.doxConc * 1000).toPrecision(4), `± ${(snap.doxSd * 1000).toPrecision(2)} mM`)}
                ${resultItem('脂質實際濃度', (snap.lipidActual * 1000).toPrecision(4), 'mM')}
                ${resultItem(`A(${p.wavelengths[1]} nm)`, snap.aPrimary.toFixed(5), `SD ${snap.sdA.toPrecision(2)}`)}
                ${resultItem('稀釋因子', p.factor.toPrecision(4), SOURCE_LABEL[p.factorSource])}
            </div>`;
        global.A11y.focusResults('lipoDlResults');
    }

    function onComputeDl() {
        try {
            const absorbances = [els.abs1, els.abs2, els.abs3].map((el, k) =>
                global.FormUtils.parseFiniteNumber(el.value, `吸光度 ${k + 1}`));
            const wavelengths = currentWavelengths();
            const epsilon = global.FormUtils.readPositiveField('lipoEpsilon', 'ε');
            const pathCm = global.FormUtils.readPositiveField('lipoPathLength', '光徑');
            const lipidMM = global.FormUtils.readPositiveField('lipoLipidConc', '脂質原始濃度');
            const factor = global.FormUtils.parsePositiveNumber(els.factor.value, '稀釋因子（請先計算或手動輸入）');
            const factorSource = state.dilution.source || 'manual';
            const factorSd = factorSource === 'saxs' ? state.dilution.sd : 0;
            const absSource = state.absorbance.source || 'manual';

            const r = Calc().computeDrugToLipid({
                absorbances, primaryIndex: 1, primaryWavelengthNm: wavelengths[1],
                epsilon, pathCm, lipidMolar: lipidMM / 1000, factor, factorSd,
            });
            const qMin = parseFloat(els.qMin.value);
            const qMax = parseFloat(els.qMax.value);
            const snapshot = Object.freeze({
                ...r,
                params: Object.freeze({ absorbances: Object.freeze(absorbances), wavelengths: Object.freeze(wavelengths), epsilon, pathCm, lipidMM, factor, factorSd, factorSource, absSource, qMin, qMax }),
            });
            setState({ dl: snapshot });
            renderDlResults(snapshot);
            setAddEnabled(true);
        } catch (err) {
            const hint = state.absorbance.source === 'spectrum' && /吸光度非正/.test(err.message)
                ? '；請確認含藥／空白檔沒有互換'
                : '';
            global.showAlert('lipoDlResults', 'error', err.message + hint);
            setAddEnabled(false);
        }
    }

    function onAddResult() {
        const snap = state.dl;
        if (!snap) return;
        const p = snap.params;
        const existing = Table().getRows().length;
        const name = (els.sampleName.value || '').trim().slice(0, 60) || `樣品 ${existing + 1}`;
        const row = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            sampleName: name,
            factor: p.factor,
            factorSource: p.factorSource,
            aPrimary: snap.aPrimary,
            primaryWavelengthNm: p.wavelengths[1],
            doxConcMM: snap.doxConc * 1000,
            lipidActualMM: snap.lipidActual * 1000,
            dl: snap.dl,
            dlSd: snap.dlSd,
            addedAt: new Date().toISOString(),
            meta: {
                epsilon: p.epsilon, pathCm: p.pathCm, qMin: p.qMin, qMax: p.qMax,
                wavelengths: [...p.wavelengths], absorbances: [...p.absorbances],
                factorSd: p.factorSd, absSource: p.absSource,
            },
        };
        if (Table().add(row)) setAddEnabled(false);
    }

    // ------------------------------------------------------------ init
    function bind() {
        els.solutionFile.addEventListener('change', syncButtons);
        els.bypassFile.addEventListener('change', syncButtons);
        els.loadedFile.addEventListener('change', syncButtons);
        els.blankFile.addEventListener('change', syncButtons);
        els.computeDilution.addEventListener('click', onComputeDilution);
        els.computeSpectra.addEventListener('click', onComputeSpectra);
        els.computeDl.addEventListener('click', onComputeDl);
        els.addResult.addEventListener('click', onAddResult);
        els.factor.addEventListener('input', onFactorInput);
        [els.wl1, els.wl2, els.wl3].forEach(el => el.addEventListener('input', onWavelengthInput));
        [els.abs1, els.abs2, els.abs3].forEach(el => el.addEventListener('input', onAbsInput));
        INVALIDATING_IDS.forEach(id => $(id)?.addEventListener('input', invalidateDl));

        els.dilutionPng?.addEventListener('click', () => {
            const chart = Charts().getChart('lipoDilutionChart');
            if (chart) global.downloadChartPng(chart, 'liposome-dilution.png');
        });
        els.spectraPng?.addEventListener('click', () => {
            const chart = Charts().getChart('lipoSpectraChart');
            if (chart) global.downloadChartPng(chart, 'liposome-spectra.png');
        });
        els.fitPng?.addEventListener('click', () => {
            const chart = Charts().getChart('lipoFitChart');
            if (chart) global.downloadChartPng(chart, 'liposome-fit.png');
        });
    }

    function init() {
        const ids = {
            solutionFile: 'lipoSolutionFile', bypassFile: 'lipoBypassFile', qMin: 'lipoQMin', qMax: 'lipoQMax',
            computeDilution: 'lipoComputeDilution', dilutionResults: 'lipoDilutionResults',
            factor: 'lipoDilutionFactor', factorChip: 'lipoDilutionChip', factorEcho: 'lipoFactorEcho', dilutionPng: 'lipoDilutionPng',
            loadedFile: 'lipoLoadedFile', blankFile: 'lipoBlankFile', pureFile: 'lipoPureFile',
            computeSpectra: 'lipoComputeSpectra', spectraResults: 'lipoSpectraResults', fitChartWrap: 'lipoFitChartWrap', spectraPng: 'lipoSpectraPng', fitPng: 'lipoFitPng',
            wl1: 'lipoWl1', wl2: 'lipoWl2', wl3: 'lipoWl3', abs1: 'lipoAbs1', abs2: 'lipoAbs2', abs3: 'lipoAbs3',
            absChip: 'lipoAbsChip', absSummary: 'lipoAbsSummary',
            sampleName: 'lipoSampleName', computeDl: 'lipoComputeDl', dlResults: 'lipoDlResults', addResult: 'lipoAddResult',
        };
        Object.entries(ids).forEach(([key, id]) => { els[key] = $(id); });
        if (!els.computeDilution) return;   // 頁面沒有這個分頁（例如測試環境）

        state = initialState();
        Table().init();
        Table().setPrimaryWavelength(parseFloat(els.wl2.value));
        setChip(els.factorChip, null);
        setChip(els.absChip, null);
        syncFactorEcho();
        syncButtons();
        setAddEnabled(false);
        bind();
    }

    global.LiposomeSection = Object.freeze({ init, getState: () => state });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: index.html 加 `<script>`**

在 `<script src="js/section-iucr.js"></script>` 之後：

```html
    <script src="js/section-liposome.js"></script>
```

- [ ] **Step 3: 跑測試 + 行數**

Run: `node --test saxs-calculator/tests/*.test.js && wc -l saxs-calculator/js/section-liposome.js`
Expected: `pass 133`，`fail 0`；行數 < 800（預估 420）。

- [ ] **Step 4: 用本地 fixture 走一遍（開發者自測，Task 12 會再正式驗）**

Chrome 開頁面 → 脂質體分頁：
1. 面板 1 選 `tests/fixtures-local/liposome/solution.dat` 與 `bypass.dat`，按計算。期望：因子 ≈ 0.4394 ± 0.013，n = 40，圖出現，chip「SAXS 計算」，回顯「SAXS 計算：0.4394 ± 0.013（n = 40）」。
2. 手改因子為 0.454：chip 變「手動」，回顯改成「手動因子 0.4540，無離散度」。
3. 面板 2 暫時沒有真實光譜檔：用兩個小文字檔（`400 0.5\n495 1.2\n600 0.1` 與 `400 0.3\n495 0.4\n600 0.05`）確認扣背景、三個吸光度自動填入、chip「光譜讀值」。
4. 面板 3 填脂質 11.7 mM，按計算 D/L → 有數字；改任一吸光度 → 「加入結果表」變灰；再按計算 → 恢復；按加入 → 表格出現一列、按鈕變灰；重新整理 → 列仍在；匯出 CSV → Excel 開啟正常；清空 → dialog 確認。
5. Console 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add saxs-calculator/js/section-liposome.js saxs-calculator/index.html
git commit -m "feat(liposome): panel UI — dilution, spectra subtraction, D/L snapshot and results hand-off"
```

---

### Task 11b: 科學審查補強 — 資料品質旗標、警告列與措辭（不改既有公式）

> 2026-09-05 science-reviewer 審 `liposome-calculations.js` 後新增。結論：六條公式代數正確、Excel DOX-18 逐步手算吻合、單位鏈無誤、**無 CRITICAL**；但有幾個「數學算得出、科學上不合理」的情況沒有守門，以及誤差的口徑要講清楚。本 task 只加旗標、警告與文字，**不改任何既有公式與既有測試的期望值**。同時順手修規格審查者對 Task 11 的四個觀察。

**Files:**
- Modify: `js/liposome-calculations.js`（DEFAULTS 常數、三個函式回傳多一個 `flags`／`qCovered`）
- Modify: `tests/liposome.test.js`（旗標測試）
- Modify: `js/section-liposome.js`（警告列、措辭、四個狀態修正）
- Modify: `index.html`（三段說明文字）

- [ ] **Step 1: 寫失敗的測試**（附在 `tests/liposome.test.js` 末尾）

```js
// ---------------------------------------------------------------- 資料品質旗標（Task 11b）
test('[lipo-flags] DEFAULTS 多了四個品質門檻常數', () => {
    const d = Liposome.DEFAULTS;
    assert.deepEqual([d.EPSILON_REF_NM, d.A_MAX_LINEAR, d.WAVELENGTH_SPREAD_WARN_REL, d.WINDOW_COVERAGE_WARN],
        [495, 1.5, 0.05, 0.5]);
});

test('[lipo-flags] computeDilutionFactor 回傳 qCovered 與 flags（因子 > 1、涵蓋不足）', () => {
    const solution = guinierCurve(1, 0);
    const ok = Liposome.computeDilutionFactor(solution, guinierCurve(0.45, 0));
    assert.deepEqual([...ok.qCovered], [0.1, 0.15]);
    assert.deepEqual(ok.flags, { factorAboveOne: false, lowCoverage: false });

    const swapped = Liposome.computeDilutionFactor(guinierCurve(0.45, 0), solution);
    approx(swapped.factor, 1 / 0.45, 1e-9, '選反時因子 > 1');
    assert.equal(swapped.flags.factorAboveOne, true);

    const short = { q: solution.q.filter(q => q <= 0.11), i: solution.i.filter((_, k) => solution.q[k] <= 0.11) };
    const low = Liposome.computeDilutionFactor(solution, { q: short.q, i: short.i.map(v => 0.45 * v) });
    assert.deepEqual([...low.qCovered], [0.1, 0.11]);
    assert.equal(low.flags.lowCoverage, true, '只涵蓋 0.01 / 0.05 = 20% 的視窗');
    assert.ok(Object.isFrozen(ok.flags) && Object.isFrozen(ok.qCovered));
});

test('[lipo-flags] computeDrugToLipid 回傳 flags（ε 波長不符、吸光度超線性、三波長離散）', () => {
    const base = { absorbances: [0.90287, 0.91973, 0.94266], epsilon: 9250, pathCm: 0.2, lipidMolar: 0.0117, factor: 0.454 };
    assert.deepEqual(Liposome.computeDrugToLipid(base).flags,
        { epsilonWavelengthMismatch: false, absorbanceAboveLinear: false, wavelengthSpreadHigh: false });
    assert.equal(Liposome.computeDrugToLipid({ ...base, primaryWavelengthNm: 480 }).flags.epsilonWavelengthMismatch, true);
    assert.equal(Liposome.computeDrugToLipid({ ...base, primaryWavelengthNm: 495.5 }).flags.epsilonWavelengthMismatch, false, '±1 nm 內不算');
    assert.equal(Liposome.computeDrugToLipid({ ...base, absorbances: [1.6, 1.7, 1.8] }).flags.absorbanceAboveLinear, true);
    // Excel DOX-20：0.74644 / 1.05761 / 0.89623 → |A1−A3|/A2 = 14% > 5%
    assert.equal(Liposome.computeDrugToLipid({ ...base, absorbances: [0.74644, 1.05761, 0.89623] }).flags.wavelengthSpreadHigh, true);
});

test('[lipo-flags] fitPureDoxScale 回傳 flags.negativeScale', () => {
    const s = syntheticSpectra(0.8);
    assert.equal(Liposome.fitPureDoxScale(s.loaded, s.blank, s.pure).flags.negativeScale, false);
    // 含藥／空白互換 → k 為負
    assert.equal(Liposome.fitPureDoxScale(s.blank, s.loaded, s.pure).flags.negativeScale, true);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test saxs-calculator/tests/liposome.test.js`
Expected: 4 個新測試 FAIL（`qCovered`／`flags` 為 undefined）。

- [ ] **Step 3: 計算模組加旗標**

`DEFAULTS` 加四個常數（放在 `LSQ_WARN_REL` 之後）：

```js
        EPSILON_REF_NM: 495,              // ε 9250 的量測波長；主波長偏離 > 1 nm 就提醒
        A_MAX_LINEAR: 1.5,                // Beer–Lambert 線性範圍上限（雜散光造成負偏差）
        WAVELENGTH_SPREAD_WARN_REL: 0.05, // |A(λ1) − A(λ3)| / A(主) > 5% → 平滑吸收帶不可能，資料有問題
        WINDOW_COVERAGE_WARN: 0.5,        // 有效點實際涵蓋的 q 範圍 < 視窗寬度的 50% → 提醒
```

`computeDilutionFactor` 回傳物件加：

```js
            qCovered: Object.freeze([q[0], q[q.length - 1]]),
            flags: Object.freeze({
                factorAboveOne: mean(ratios) > 1,
                lowCoverage: (q[q.length - 1] - q[0]) < DEFAULTS.WINDOW_COVERAGE_WARN * (qMax - qMin),
            }),
```

`computeDrugToLipid` 回傳物件加（`p.absorbances` 已驗證為三個有限數）：

```js
            flags: Object.freeze({
                epsilonWavelengthMismatch: Math.abs(primaryWavelengthNm - DEFAULTS.EPSILON_REF_NM) > 1,
                absorbanceAboveLinear: aPrimary > DEFAULTS.A_MAX_LINEAR,
                wavelengthSpreadHigh: Math.abs(p.absorbances[0] - p.absorbances[2]) / aPrimary > DEFAULTS.WAVELENGTH_SPREAD_WARN_REL,
            }),
```

`fitPureDoxScale` 回傳物件加 `flags: Object.freeze({ negativeScale: k < 0 })`。

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: 全綠，總數 = 之前的通過數 + 4；既有測試不需改動（回傳物件只是多欄位）。

- [ ] **Step 5: UI 警告列、措辭與四個狀態修正**（`js/section-liposome.js`）

面板 1：
- `onComputeDilution` 成功時把 `qMin`、`qMax` 存進 `state.dilution`（`{ …, qMin, qMax }`），D/L 快照的 `qMin/qMax` 改從 `state.dilution` 取（因子來源為手動時為 `null`），不再於 D/L 時讀輸入框。
- `renderDilutionResults` 的 `.stat-sub` 改成「q 視窗 ${qMin}–${qMax} Å⁻¹，實際涵蓋 ${r.qCovered[0].toFixed(3)}–${r.qCovered[1].toFixed(3)}，n = …」。
- 警告列（沿用 `warningRow`）：`r.flags.factorAboveOne` →「稀釋因子 > 1：bypass 應比 solution cell 稀，通常代表兩個檔案選反」；`r.flags.lowCoverage` →「有效點只涵蓋 q 視窗的一小段，請確認兩條曲線的 q 範圍」。
- 手動因子 > 1 時（`onFactorInput`）`lipoFactorEcho` 補「（> 1，請確認方向）」。

面板 2：
- 「三值樣本標準差」與 stat-card 的 `±` 標籤改為「三點譜線離散（含譜帶斜率）」；`updateAbsSummary` 同步。
- `fit.flags.negativeScale` → 警告列「縮放係數 k 為負：含藥／空白檔可能互換，或扣背景過頭」。
- **修觀察 3（原子性）**：`onComputeSpectra` 先算 `subtracted`、`fit`、再用 `Calc().absorbanceAt(subtracted, currentWavelengths())` 試讀；三者都成功後才 `setState`、填輸入框、渲染、畫圖。任一步 throw → `showAlert`，state 與畫面完全不動。
- **修觀察 1（殘留警告）**：`onWavelengthInput` 成功重讀後呼叫 `renderSpectraResults(state.spectra.subtracted, state.spectra.fit)`，讓舊的錯誤訊息被結果取代並清掉 `role="alert"`。

面板 3：
- `renderDlResults` 的誤差說明改為兩行 `.stat-sub`：「誤差 = D/L × √(relA² + relF²)：三點譜線離散貢獻 x%，稀釋因子離散貢獻 y%」、「此為精密度，不含 ε、光程、脂質配製濃度的系統誤差」。
- 警告列：`epsilonWavelengthMismatch` →「主波長 ${λ} nm 與 ε 的量測波長 495 nm 不同，請改用對應波長的 ε」；`absorbanceAboveLinear` →「A(主波長) > 1.5 超出線性範圍，請稀釋後重測或縮短光程」；`wavelengthSpreadHigh` →「三個波長的吸光度相差超過 5%，平滑吸收帶不會如此，請檢查光譜」。
- **修觀察 2**：`onComputeDl` 的 catch 內呼叫 `invalidateDl()`。

- [ ] **Step 6: index.html 三段說明**

- `#lipoPathLength` 下方的 `.stat-sub`：「有效光程；建議以已知濃度標準液校正，圓管內徑不等於光程」。
- 面板 1 卡片 `.card-body` 開頭加 `<p class="stat-sub">假設：UV 吸光度在 bypass 的稀釋狀態、同一支毛細管量測；solution cell 曲線對應面板 3 輸入的原始脂質濃度。</p>`。
- 面板 2 卡片 `.card-body` 開頭加 `<p class="stat-sub">假設：吸光度來自已破膜或濁度可由空白抵消的樣品；包覆態 DOX 的 ε 可能低於自由 DOX。</p>`。

- [ ] **Step 7: 跑測試、瀏覽器抽查、commit**

Run: `node --test saxs-calculator/tests/*.test.js`（全綠）；`wc -l saxs-calculator/js/section-liposome.js` < 800。
瀏覽器：兩個 .dat 選反 → 出現「選反」警告；改主波長為 480 → D/L 結果出現 ε 波長警告；Excel DOX-20 三值 → 三波長離散警告。

```bash
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/js/section-liposome.js saxs-calculator/index.html saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): data-quality flags and warnings from science review; precision wording; atomic spectra update"
```

---

### Task 12: 驗證、審查、上線（主 session 執行）

這個 task 由主 session（有 Chrome 與 agent 工具）執行，不派給實作 subagent。

**Files:** 無新檔；可能修 bug。

- [ ] **Step 1: 全部測試**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: `pass 133`（109 舊 + 23 公開新 + 1 本地），`fail 0`，`skipped 0`。

- [ ] **Step 2: science-reviewer agent 審 `js/liposome-calculations.js`**

審查重點交給 agent：內插方向（bypass → solution 格點）、比值定義（I_byp / I_sol，應 < 1）、`fitPureDoxScale` 的最小平方解、`computeDrugToLipid` 的單位（M、cm）與誤差傳遞、Excel 六列回歸是否真的等價。CRITICAL / HIGH 全修，MEDIUM 盡量。

- [ ] **Step 3: Chrome 驗收（規格 §9.3）**

1. `index.html` 開啟後 console 無 error / warning（CSP 違規也算）。
2. 用本地 fixture 走 Task 11 Step 4 的流程，數字對照：因子 0.4394 ± 1%；D/L 用 DOX-18 的三個吸光度 0.90287 / 0.91973 / 0.94266、11.7 mM、因子手填 0.454 → D/L 0.09359、Excel 原式誤差 0.00203。
3. axe-core（devtools 或既有的檢查方式）該分頁 0 違規。
4. 鍵盤：Tab 走完所有輸入、三個計算鈕、加入、表格刪除鈕、匯出、清空 → dialog 內 Tab 循環、Escape 關閉、Enter 確認。**先確認清空一次，再開 dialog 按 Escape，表格必須還在**（returnValue 殘留的回歸）。Chromium 在背景分頁會延後 `<dialog>` 的 close 事件，這段要在可見分頁操作。
5. 收合側欄：短標「載藥」顯示正常（`data-short="載藥"`）。
6. ≤ 768px：`.grid-2` 塌成單欄，結果卡在輸入卡下方，計算後焦點會跳到結果。

- [ ] **Step 4: code-reviewer agent 審整批 diff**

`git diff 083ef7c...HEAD -- saxs-calculator/`。重點：CSP（無行內 script）、innerHTML 是否全部過 escapeHtml、不可變更新、錯誤不靜默、檔案 ≤ 800 行。

- [ ] **Step 5: 更新規格與記憶**

- 規格補記實作偏離：§7「結果表獨立成 `liposome-results-table.js`；UI 模組用 IIFE 掛 `LiposomeSection`；樣品名在加入時讀取」；§3.1–3.3「結果容器不放靜態 `role="status"`，由 `showAlert` / `A11y.focusResults` 動態管理（與全站一致）」；§3.4「CSV 欄名用英文且多三個中繼欄（Factor SD、Absorbances、Absorbance source），與表格中文欄名不逐字對應，換取跨語系可讀」。
- 記憶 `project_liposome_dl.md` 狀態改為「v4.14 已上線 <commit>」。

- [ ] **Step 6: Push 與部署確認**

```bash
git push origin main
```

等 GitHub Pages 更新（`max-age=600`，最多 10 分鐘），開線上網址確認側欄版本顯示 4.14、脂質體分頁可用。

---

## 完成定義

- [ ] 全部 task 的 checkbox 勾完
- [ ] `node --test saxs-calculator/tests/*.test.js` 133 passed
- [ ] science-reviewer 與 code-reviewer 無 CRITICAL / HIGH 未處理
- [ ] Chrome：console 乾淨、axe 0、鍵盤流程通
- [ ] 線上顯示 Version 4.14
