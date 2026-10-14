# 待辦批次 v4.15 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上線 saxs-calculator v4.15：靜態資源版本查詢、兩個超行計算檔拆檔、fraction collector 照 Excel 分段計算、dn/dc 負峰保留符號與警告、脂質體 SEM 與標準液對照；dndc Python repo 同步修三個 xfail 與負峰處理。

**Architecture:** 純前端 classic script 網站（無 build），所有 `js/*.js` 共用一個全域作用域；測試用 `node:test`，以 `tests/load.js` 把計算模組載進 Node。拆檔前先把測試載入器換成 `vm.runInThisContext`，讓 Node 與瀏覽器一樣共用全域作用域。Python 端是獨立的本地 git repo（py3.9 venv、pytest、Streamlit）。

**Tech Stack:** HTML/CSS/vanilla JS、Chart.js 4.5.1（CDN、`defer`）、node:test；Python 3.9、numpy、pandas、pytest、Streamlit。

**規格：** `docs/superpowers/specs/2026-10-14-backlog-batch-design.md`（以下簡稱「規格」）。每個任務都標了對應的規格章節。

---

## 共同規則（每個任務都適用）

- 路徑：repo 根目錄 `/Users/hsutingwei/Desktop/TPS13A`（以下簡稱 `ROOT`）。網站在 `ROOT/saxs-calculator/`；Python repo 在 `ROOT/dndc calculator/`（路徑有空白，一律加引號；它是**獨立 git repo**，沒有 remote）。
- JS 測試：`cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`，結尾要看到 `# fail 0`。起始基準：159 pass。
- Python 測試：`cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator" && .venv_mac/bin/python -m pytest -q`。起始基準：326 passed / 3 xfailed。
- **Python `src/dndc/**/*.py` 是 CRLF 換行**。用 Edit 改過的檔會變成 LF，改完一律執行 `perl -pi -e 's/\r?\n/\r\n/' <檔案>` 轉回，並用 `git diff --stat` 確認只有少量行數變動。`tests/` 是 LF，不用轉。
- CSP：`index.html` 禁止行內 `<script>` 與 `onclick=""`；事件一律 `addEventListener`。
- 任何來自檔案或使用者輸入的字串進 `innerHTML` 前要過 `FormUtils.escapeHtml`（脂質體模組裡是 `esc()`）。
- 不可變：新物件用 `Object.freeze`；不要就地改傳入的物件或陣列。
- Commit 訊息用 conventional commits（`feat:`／`fix:`／`refactor:`／`test:`／`docs:`），**不加 Co-Authored-By 之類的署名行**（使用者全域設定）。
- **Task 13 之前不要 push**。dndc repo 永遠不 push。
- 遇到計畫說「停下來回報」的情況，或測試結果與計畫的預期不同，停下來回報，不要自行改期望值。

## 任務相依

```
saxs-calculator：Task 1 → 2 → 3 → 4 → 5 → 6
                                  └→ 9 → 10        （9、10 在 Task 3 之後即可，與 4–6 無相依，但都會改 index.html／共用測試，請依序做）
dndc repo：     Task 7 → 8                         （與上面完全獨立，可以平行）
收尾：          Task 11 → 12 → 13                  （全部任務完成後）
```

## 檔案地圖

| 檔案 | 動作 | 職責 |
|---|---|---|
| `saxs-calculator/index.html` | 改 | 本地資源加 `?v=`；新增 6 個分檔的 `<script>`；脂質體新增 `lipoPureConc` 欄位與 `lipoStdCompare` 容器 |
| `saxs-calculator/tests/structure.test.js` | 改 | `?v=` 一致性測試；拆檔順序測試；`PENDING_SPLIT` 清空 |
| `saxs-calculator/tests/load.js` | 改寫 | `vm.runInThisContext` 逐檔載入，匯出 `LOAD_ORDER` |
| `saxs-calculator/js/sample-prep-calculations.js` | 新（搬移） | 離心、UV 濃度、SEC 稀釋與滯留、質量解析度 |
| `saxs-calculator/js/hplc-calculations.js` | 新（搬移）＋ Task 4 修改 | HPLC-SAXS 步驟、fraction collector |
| `saxs-calculator/js/detector-calculations.js` | 新（搬移） | 偵測器距離 |
| `saxs-calculator/js/calculations.js` | 縮小 | SAXS 理論值＋`window.SAXSCalculations` 匯出 |
| `saxs-calculator/js/dndc-theory-calculations.js` | 新（搬移） | dn/dc 理論與校正 |
| `saxs-calculator/js/dndc-signal-calculations.js` | 新（搬移）＋ Task 5 修改 | 基線、峰值量測、線性擬合 |
| `saxs-calculator/js/dndc-alignment-calculations.js` | 新（搬移） | UV／RI 對齊 |
| `saxs-calculator/js/dndc-calculations.js` | 縮小＋ Task 5 修改 | HPLC／Slice 主流程＋`window.DndcCalculations` 匯出 |
| `saxs-calculator/tests/fraction-collector.test.js` | 新 | Excel 公式鏈逐格轉寫當標準答案 |
| `saxs-calculator/tests/batch1.test.js` | 改 | 測試 [46] 的 Stop 期望值改成 Excel 值 |
| `saxs-calculator/tests/dndc-sign.test.js` | 新 | 負峰符號、負 dn/dc 警告、負 UV 峰 |
| `saxs-calculator/js/dndc-hplc-results.js`、`dndc-slice-ui.js`、`dndc-multi-ui.js` | 改 | 顯示負 dn/dc 警告 |
| `saxs-calculator/js/liposome-calculations.js` | 改 | `standardErrorOfMean`、`compareWithStandard` |
| `saxs-calculator/js/section-liposome.js` | 改 | 面板 1 SEM 小字、標準液對照 |
| `saxs-calculator/tests/liposome.test.js`、`liposome-section.test.js` | 改 | 新純函式與 UI 測試 |
| `dndc calculator/src/dndc/peak.py`、`broadening.py` | 改 | 峰值保留符號；FWHM 不再扣最小值 |
| `dndc calculator/src/dndc/models.py`、`calculator.py`、`validation.py` | 改 | `warnings` 欄位、負 UV 拒絕、RI 因子守門 |
| `dndc calculator/src/dndc/web/pages/hplc_page.py`、`hplc_slice.py`、`src/dndc/__main__.py` | 改 | 顯示警告 |
| `dndc calculator/tests/test_peak.py`、`test_broadening.py`、`test_calculator.py`、`test_io_validation.py` | 改 | 拿掉 xfail、新測試 |
| `docs/superpowers/specs/2026-09-05-liposome-dox-loading-design.md`、`CLAUDE.md` | 改 | 決策紀錄、測試基準、版本規則 |

---

### Task 1: 靜態資源版本查詢 `?v=`（規格 §3）

**Files:**
- Modify: `saxs-calculator/tests/structure.test.js:38-46`（`localRefs` 與 `SCRIPT_REFS`／`LINK_REFS`），並新增一個測試
- Modify: `saxs-calculator/index.html`（42 個本地引用；footer 上方加註解）

- [ ] **Step 1: 改 `localRefs` 並寫失敗測試**

把 `structure.test.js` 第 38–46 行：

```js
/** 依 index.html 出現順序取出本地資源清單（跳過 CDN）。 */
function localRefs(pattern) {
    const found = [];
    for (const m of INDEX_HTML.matchAll(pattern)) found.push(m[1]);
    return found;
}

const SCRIPT_REFS = localRefs(/<script\s+src="(js\/[^"]+)"/g);
const LINK_REFS = localRefs(/<link\s+rel="stylesheet"\s+href="(css\/[^"]+)"/g);
```

換成：

```js
/**
 * 依 index.html 出現順序取出本地資源清單（跳過 CDN）。
 * 每筆 { path, version }：path 不含查詢字串，version 是 ?v= 的值（沒有則為 null）。
 */
function localRefs(pattern) {
    const found = [];
    for (const m of INDEX_HTML.matchAll(pattern)) {
        const [file, query = ''] = m[1].split('?');
        found.push(Object.freeze({ path: file, version: new URLSearchParams(query).get('v') }));
    }
    return found;
}

const SCRIPT_ENTRIES = localRefs(/<script\s+src="(js\/[^"]+)"/g);
const LINK_ENTRIES = localRefs(/<link\s+rel="stylesheet"\s+href="(css\/[^"]+)"/g);
const SCRIPT_REFS = SCRIPT_ENTRIES.map(e => e.path);
const LINK_REFS = LINK_ENTRIES.map(e => e.path);

/** 側欄 footer 的版本號（例如 "4.15"），是 ?v= 的唯一來源。 */
const PAGE_VERSION = (INDEX_HTML.match(/Version\s+(\d+\.\d+)/) || [])[1] || null;
```

在 `test('[structure] index.html 引用了每一個 css/*.css，且沒有重複', …)` 之後新增：

```js
test('[structure] 每個本地 css/js 引用都帶 ?v=，且等於側欄版本號（避免 Pages 快取讓新 HTML 配舊檔）', () => {
    assert.ok(PAGE_VERSION, '找不到側欄 footer 的「Version X.Y」');
    const mismatched = [...SCRIPT_ENTRIES, ...LINK_ENTRIES]
        .filter(e => e.version !== PAGE_VERSION)
        .map(e => `${e.path}（?v=${e.version}）`);
    assert.deepEqual(mismatched, [],
        `本地引用的 ?v= 必須等於 ${PAGE_VERSION}；bump 版本時 footer 與 ?v= 要一起改`);
});
```

- [ ] **Step 2: 跑測試，確認新測試失敗、其他照過**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/structure.test.js`
Expected: 只有「每個本地 css/js 引用都帶 ?v=」失敗，訊息列出 42 個檔案（`?v=null`）；其餘 structure 測試通過。

- [ ] **Step 3: 替 index.html 加上 `?v=4.14`**

```bash
cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator
sed -i '' -E 's#(<script src="js/[^"?]+)"#\1?v=4.14"#g; s#(<link rel="stylesheet" href="css/[^"?]+)"#\1?v=4.14"#g' index.html
grep -c '?v=4.14"' index.html
```

Expected: `42`（37 個 script＋5 個 stylesheet）。

在 `index.html` 的 footer（`<div class="sidebar-footer">` 那一行）正上方加一行註解：

```html
            <!-- 版本號同時是所有本地 css/js 的 ?v=：bump 時兩者一起改（tests/structure.test.js 檢查） -->
```

- [ ] **Step 4: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`（160 pass）。

- [ ] **Step 5: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/index.html saxs-calculator/tests/structure.test.js
git commit -m "feat: version query on local css/js so Pages cache cannot mix old assets with new HTML"
```

---

### Task 2: 測試載入器改用共用全域作用域（規格 §4.1）

**Files:**
- Rewrite: `saxs-calculator/tests/load.js`

- [ ] **Step 1: 改寫 `tests/load.js`**

整檔換成：

```js
'use strict';
/**
 * Load the browser-global calculation modules into Node for testing.
 *
 * 瀏覽器裡的 classic <script> 共用同一個全域作用域；require() 卻讓每個檔各有自己的模組作用域。
 * 拆檔後，分檔（例如 hplc-calculations.js）的頂層函式要在原檔（calculations.js）結尾的匯出區塊
 * 被讀到，require() 之下會 ReferenceError。所以這裡用 vm.runInThisContext 逐檔執行，
 * 語意與瀏覽器相同。順序必須與 index.html 一致（tests/structure.test.js 會檢查拆檔群組）。
 *
 * Usage: node --test saxs-calculator/tests/
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global.window || {};

const JS = path.join(__dirname, '..', 'js');

/** 依序載入的檔案；相對順序與 index.html 一致。 */
const LOAD_ORDER = Object.freeze([
    'form-utils.js',
    'calculations.js',
    'detector-limits-ui.js',
    'protein.js',
    'dndc-calculations.js',
    'dndc-file-parser.js',
    'dndc-astra-parser.js',
    'dndc-astra-ui.js',            // UI 檔，但頂層只有函式宣告；純文案函式從 window.DndcAstraUi 取用
    'liposome-calculations.js',
    'liposome-file-parsers.js',
    'liposome-results-table.js',   // 頂層無 DOM 存取；只用 rowsToCsv / csvCell
]);

/** 以瀏覽器 classic script 的語意執行一個 js/ 檔（共用 globalThis 與頂層宣告）。 */
function loadScript(file) {
    const full = path.join(JS, file);
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
}

LOAD_ORDER.forEach(loadScript);

module.exports = {
    LOAD_ORDER,
    SAXS: window.SAXSCalculations,
    DetectorLimits: window.DetectorLimits,
    Protein: window.ProteinAnalysis,
    Dndc: window.DndcCalculations,
    FileParser: window.DndcFileParser,
    AstraParser: window.DndcAstraParser,
    AstraUi: window.DndcAstraUi,
    FormUtils: window.FormUtils,
    Liposome: window.LiposomeCalculations,
    LiposomeParsers: window.LiposomeFileParsers,
    LiposomeTable: window.LiposomeResultsTable,
};
```

- [ ] **Step 2: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`，測試數與 Task 1 相同（160）。若有 `SyntaxError: Identifier '…' has already been declared`，代表兩個檔頂層宣告撞名（瀏覽器裡也會壞），停下來回報。

- [ ] **Step 3: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/tests/load.js
git commit -m "test: load browser scripts with vm.runInThisContext so Node shares one global scope like the page"
```

---

### Task 3: 拆檔（純搬移，規格 §4.2–4.3）

**Files:**
- Create: `saxs-calculator/js/{sample-prep,hplc,detector}-calculations.js`、`saxs-calculator/js/dndc-{theory,signal,alignment}-calculations.js`
- Modify: `saxs-calculator/js/calculations.js`、`saxs-calculator/js/dndc-calculations.js`（只剩主體與匯出）
- Modify: `saxs-calculator/index.html`（`<script>` 與載入順序註解）、`saxs-calculator/tests/load.js`、`saxs-calculator/tests/structure.test.js`

> 這個任務**只搬移**，不改任何函式內容。必須在 Task 4 之前做，下面的行號以 commit `947bd9f` 的檔案為準（Task 1–2 不動這兩個檔）。

- [ ] **Step 1: 寫失敗測試**

在 `structure.test.js`：

1. 把第 26–29 行：

```js
// 尚未拆分的計算模組（batch 3 的範圍是 app.js / dndc-ui.js / styles.css）。
// 這是「棘輪」名單：下面的測試會同時檢查名單內的檔案『確實還是超行』，
// 拆完之後不移除名單就會失敗，債務不會被默默留著。
const PENDING_SPLIT = Object.freeze(['calculations.js', 'dndc-calculations.js']);
```

換成：

```js
// 「棘輪」名單：允許暫時超過 800 行的檔案。下面的測試會同時檢查名單內的檔案『確實還是超行』，
// 拆完之後不移除名單就會失敗，債務不會被默默留著。2026-10-14 拆完 calculations.js 與
// dndc-calculations.js 後清空。
const PENDING_SPLIT = Object.freeze([]);

// 拆檔群組：負責匯出命名空間的原檔，在載入期讀取分檔的頂層函式，所以分檔必須先載入。
const SPLIT_GROUPS = Object.freeze({
    'calculations.js': Object.freeze(['sample-prep-calculations.js', 'hplc-calculations.js', 'detector-calculations.js']),
    'dndc-calculations.js': Object.freeze(['dndc-theory-calculations.js', 'dndc-signal-calculations.js', 'dndc-alignment-calculations.js']),
});
```

2. 在檔尾新增：

```js
test('[structure] 拆出的分檔在 index.html 與 tests/load.js 都排在原檔之前', () => {
    const { LOAD_ORDER } = require('./load.js');
    const orders = [
        ['index.html', SCRIPT_REFS.map(ref => ref.replace(/^js\//, ''))],
        ['tests/load.js', [...LOAD_ORDER]],
    ];
    for (const [owner, parts] of Object.entries(SPLIT_GROUPS)) {
        for (const [label, order] of orders) {
            const ownerPos = order.indexOf(owner);
            assert.ok(ownerPos >= 0, `${label} 沒有載入 ${owner}`);
            for (const part of parts) {
                const partPos = order.indexOf(part);
                assert.ok(partPos >= 0, `${label} 沒有載入 ${part}`);
                assert.ok(partPos < ownerPos, `${label}：${part} 必須排在 ${owner} 之前`);
            }
        }
    }
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/structure.test.js`
Expected: 兩個失敗——「≤ 800 行」（列出 `calculations.js: 1052 行`、`dndc-calculations.js: 1138 行`）與「分檔排在原檔之前」（沒有載入 `sample-prep-calculations.js`）。

- [ ] **Step 3: 用腳本切檔**

在 `ROOT` 執行（腳本先核對每個切點的內容，對不上就中止，不會寫入任何檔）：

```bash
cd /Users/hsutingwei/Desktop/TPS13A
node - <<'EOF'
const fs = require('fs');
const path = require('path');
const JS = path.join('saxs-calculator', 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8').split('\n');
const slice = (lines, from, to) => lines.slice(from - 1, to).join('\n');   // 1-based，含頭尾
const expect = (lines, n, text, file) => {
    if (!lines[n - 1].startsWith(text)) {
        throw new Error(`${file} 第 ${n} 行應以「${text}」開頭，實際：「${lines[n - 1]}」——檔案已變動，停下來回報`);
    }
};

const calc = read('calculations.js');
const dndc = read('dndc-calculations.js');
if (calc.length !== 1052 || dndc.length !== 1138) {
    throw new Error(`行數不符（calculations ${calc.length - 1}、dndc ${dndc.length - 1}），停下來回報`);
}
[[6, '// ==='], [342, '}'], [344, '// ==='], [541, '}'], [543, '// ==='], [875, '}'],
 [878, '// ==='], [991, '}'], [994, '/**'], [1006, '}'], [1008, '// 導出函數']]
    .forEach(([n, t]) => expect(calc, n, t, 'calculations.js'));
[[10, '// ==='], [206, '}'], [208, '// ==='], [418, '}'], [420, '// ==='], [644, '}'],
 [646, '// ==='], [708, '}'], [710, '// ==='], [842, '}'], [844, '/**'], [874, '}'],
 [876, '/**'], [1102, '}'], [1104, '// ===']]
    .forEach(([n, t]) => expect(dndc, n, t, 'dndc-calculations.js'));

const SPLIT_NOTE = (owner) => [
    ' *',
    ` * 2026-10-14 從 ${owner} 純搬移拆出。函式宣告在全域作用域，由 ${owner} 結尾的匯出區塊`,
    ` * 在載入期讀取，所以本檔必須排在 ${owner} 之前（tests/structure.test.js 檢查）。`,
    ' */',
].join('\n');
const header = (title, owner) => `/**\n * TPS13A SAXS Calculator - ${title}\n${SPLIT_NOTE(owner)}`;
const write = (file, parts) => fs.writeFileSync(path.join(JS, file), parts.join('\n\n') + '\n');

write('sample-prep-calculations.js', [
    header('樣品前處理計算：離心參數、UV 濃度、SEC 稀釋因子與滯留時間、質量解析度', 'calculations.js'),
    slice(calc, 344, 541), slice(calc, 994, 1006),
]);
write('hplc-calculations.js', [
    header('HPLC-SAXS 步驟設定、fraction collector、10 μL pre-run 建議值', 'calculations.js'),
    slice(calc, 543, 875),
]);
write('detector-calculations.js', [
    header('偵測器距離（Eiger 9M 行程 2,200–10,000 mm）與 Rg 比較', 'calculations.js'),
    slice(calc, 878, 991),
]);
write('calculations.js', [
    [
        '/**',
        ' * TPS13A SAXS Calculator - Core Calculations Module',
        ' * SAXS 理論值（I(0)、Rg、Dmax、Porod）＋ window.SAXSCalculations 匯出。',
        ' *',
        ' * 2026-10-14 拆檔（純搬移）：離心／樣品／SEC → sample-prep-calculations.js；HPLC-SAXS 步驟與',
        ' * fraction collector → hplc-calculations.js；偵測器距離 → detector-calculations.js。',
        ' * 結尾的匯出區塊在載入期讀取那三個檔的頂層函式，所以它們必須排在本檔之前。',
        ' */',
    ].join('\n'),
    slice(calc, 6, 342), slice(calc, 1008, 1051),
]);

write('dndc-theory-calculations.js', [
    header('dn/dc 理論值、溫度／波長校正、Lorentz-Lorenz、Gladstone-Dale（對應 Python theoretical.py）', 'dndc-calculations.js'),
    slice(dndc, 10, 206),
]);
write('dndc-signal-calculations.js', [
    header('基線校正、峰值量測、線性擬合（對應 Python baseline.py、peak.py、linear_fit.py）', 'dndc-calculations.js'),
    slice(dndc, 208, 418), slice(dndc, 646, 708),
]);
write('dndc-alignment-calculations.js', [
    header('UV／RI 時間延遲估計與對齊，含 _resolveAlignment（對應 Python alignment.py）', 'dndc-calculations.js'),
    slice(dndc, 420, 644), slice(dndc, 844, 874),
]);
write('dndc-calculations.js', [
    [
        '/**',
        ' * TPS13A SAXS Calculator - dn/dc Calculations Module',
        ' * HPLC 與 Slice dn/dc 主流程（對應 Python calculator.py）＋ window.DndcCalculations 匯出。',
        ' *',
        ' * 2026-10-14 拆檔（純搬移）：理論與校正 → dndc-theory-calculations.js；基線、峰值、線性擬合 →',
        ' * dndc-signal-calculations.js；對齊 → dndc-alignment-calculations.js。結尾的匯出區塊在載入期',
        ' * 讀取那三個檔的頂層宣告，所以它們必須排在本檔之前。',
        ' */',
    ].join('\n'),
    slice(dndc, 710, 842), slice(dndc, 876, 1102), slice(dndc, 1104, 1137),
]);
console.log('split done');
EOF
wc -l saxs-calculator/js/*calculations.js
```

Expected: 印出 `split done`；八個檔都 ≤ 450 行（約：sample-prep 225、hplc 341、detector 122、calculations 395、dndc-theory 205、dndc-signal 284、dndc-alignment 265、dndc-calculations 410）。

- [ ] **Step 4: 核對是純搬移**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
T=$(mktemp -d)
git show HEAD:saxs-calculator/js/calculations.js | grep -v '^[[:space:]]*$' | sort > "$T/c0"
cat saxs-calculator/js/{sample-prep,hplc,detector}-calculations.js saxs-calculator/js/calculations.js | grep -v '^[[:space:]]*$' | sort > "$T/c1"
diff "$T/c0" "$T/c1"
git show HEAD:saxs-calculator/js/dndc-calculations.js | grep -v '^[[:space:]]*$' | sort > "$T/d0"
cat saxs-calculator/js/dndc-{theory,signal,alignment}-calculations.js saxs-calculator/js/dndc-calculations.js | grep -v '^[[:space:]]*$' | sort > "$T/d1"
diff "$T/d0" "$T/d1"
```

Expected: 兩個 `diff` 的差異**只有**檔頭註解行（以 `/**`、` *`、` */` 開頭）。只要出現任何程式行，停下來回報。

- [ ] **Step 5: 更新 index.html**

把：

```html
    <script src="js/calculations.js?v=4.14"></script>
```

換成：

```html
    <script src="js/sample-prep-calculations.js?v=4.14"></script>
    <script src="js/hplc-calculations.js?v=4.14"></script>
    <script src="js/detector-calculations.js?v=4.14"></script>
    <script src="js/calculations.js?v=4.14"></script>
```

把：

```html
    <script src="js/dndc-calculations.js?v=4.14"></script>
```

換成：

```html
    <script src="js/dndc-theory-calculations.js?v=4.14"></script>
    <script src="js/dndc-signal-calculations.js?v=4.14"></script>
    <script src="js/dndc-alignment-calculations.js?v=4.14"></script>
    <script src="js/dndc-calculations.js?v=4.14"></script>
```

把載入順序註解：

```html
         (2) app.js 永遠最後——它只有 DOMContentLoaded 啟動點。
         tests/structure.test.js 會盯著這兩條與「跨檔重複宣告」。 -->
```

換成：

```html
         (2) app.js 永遠最後——它只有 DOMContentLoaded 啟動點；
         (3) 拆檔群組：負責匯出命名空間的原檔（calculations.js、dndc-calculations.js）
             在載入期讀取分檔的頂層函式，所以分檔排在原檔之前。
         tests/structure.test.js 會盯著這三條與「跨檔重複宣告」。 -->
```

- [ ] **Step 6: 更新 tests/load.js 的 `LOAD_ORDER`**

```js
const LOAD_ORDER = Object.freeze([
    'form-utils.js',
    'sample-prep-calculations.js',
    'hplc-calculations.js',
    'detector-calculations.js',
    'calculations.js',
    'detector-limits-ui.js',
    'protein.js',
    'dndc-theory-calculations.js',
    'dndc-signal-calculations.js',
    'dndc-alignment-calculations.js',
    'dndc-calculations.js',
    'dndc-file-parser.js',
    'dndc-astra-parser.js',
    'dndc-astra-ui.js',            // UI 檔，但頂層只有函式宣告；純文案函式從 window.DndcAstraUi 取用
    'liposome-calculations.js',
    'liposome-file-parsers.js',
    'liposome-results-table.js',   // 頂層無 DOM 存取；只用 rowsToCsv / csvCell
]);
```

- [ ] **Step 7: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`（161 pass）。

- [ ] **Step 8: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js saxs-calculator/index.html saxs-calculator/tests/load.js saxs-calculator/tests/structure.test.js
git commit -m "refactor: split calculations.js and dndc-calculations.js by domain (pure move, export files load last)"
```

---

### Task 4: Fraction collector 照 Excel 分段計算（規格 §5）

**Files:**
- Create: `saxs-calculator/tests/fraction-collector.test.js`
- Modify: `saxs-calculator/js/hplc-calculations.js`（常數、三個新函式、M23／M24、fraction collector 區塊、報告結束時間）
- Modify: `saxs-calculator/js/calculations.js`（匯出區塊）
- Modify: `saxs-calculator/tests/batch1.test.js`（測試 [46]「Fraction collector 隨流速改變」）

- [ ] **Step 1: 寫失敗測試 `tests/fraction-collector.test.js`**

```js
'use strict';
/**
 * Fraction collector 收集時段 vs Excel `Fraction_collector_high_c`（待辦批次 v4.15 規格 §5）。
 *
 * 標準答案 excelChain 是 Excel 公式鏈的逐格轉寫，含 B10 的四路 IF 與 B12 的十路 IF——刻意照抄 Excel
 * 用「數值相等」挑分支的寫法，不重構，才能證明新寫法與 Excel 等價。儲存格對照：
 *   A4:A8 = 工作表1_(2)!M20:M24；B5 = B6 = 目標流速、B7 = (目標+初始)/2、B8 = 初始流速；
 *   D2 = 1050 μL；C22 = 2.8 min；A24 = B10 − C22；A27 = B12 + C22；'HPLC flow down data'!A15 = B22 + 1 + 3。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SAXS } = require('./load.js');

function excelChain({ peakCenter = 10.937, peakFWHM = 1, injectionVolume = 100, targetFlowRate, initialFlowRate }) {
    const inj = injectionVolume;
    const O4 = 1.00959 - 0.00468 * inj + 0.0005034 * inj ** 2 - 0.0000031539 * inj ** 3;
    const P4 = 0.000146507 - 0.000266 * inj + 0.00007393 * inj ** 2 - 0.0000005204 * inj ** 3;
    const M5 = peakFWHM * O4;
    const O6 = 0.7;
    const M7 = peakCenter + P4 - (M5 / 2) * O6;
    const M8 = peakCenter + P4 + (M5 / 2) * O6;
    const M9 = M8 - M7;
    const O11 = targetFlowRate;
    const O12 = initialFlowRate / O11;
    const M21 = M7 - 0.2;
    const M22 = M21 + M9 * O12 + 0.05 / O11 + 2;
    const M23 = M22 + 2;
    const M24 = M23 + 0.5;
    const [A5, A6, A7, A8] = [M21, M22, M23, M24];
    const C14 = (targetFlowRate + initialFlowRate) / 2;
    const [B5, B6, B7, B8] = [targetFlowRate, targetFlowRate, C14, initialFlowRate];
    const D2 = 1050;
    const C22 = 2.8;
    const D4 = (A6 - A5) * B5 * 1000;
    const E4 = (A7 - A6) * ((B6 + B7) / 2) * 1000;
    const F4 = (A8 - A7) * ((B7 + B8) / 2) * 1000;
    const G4 = D4 + E4;
    const H4 = D4 + E4 + F4;
    const E10 = D2 / (B5 * 1000) + A5;
    const E19 = (D2 - D4) / ((B6 + B7) * 500) + A6;
    const E26 = (D2 - G4) / ((B7 + B8) * 500) + A7;
    const E32 = (D2 - H4) / (B8 * 1000) + A8;
    const I4 = A8 - E26;
    const J4 = A7 - E19;
    const K4 = A6 - E10;
    const L4 = I4 * (B7 + B8) * 500;
    const M4 = J4 * (B6 + B7) * 500;
    const N4 = K4 * 1000 * B6;
    const O4x = M4 + F4;
    const P4x = N4 + E4;
    const Q4x = N4 + E4 + F4;

    let B10;
    if (D4 >= D2) B10 = E10;
    else if (D2 > D4 && D2 <= G4) B10 = E19;
    else if (D2 > G4 && D2 <= H4) B10 = E26;
    else B10 = E32;

    const M10 = E10 + D4 / (B5 * 1000);
    const M12 = A6 + (D4 - N4) / ((B6 + B7) * 500);
    const M14 = A7 + (D4 - P4x) / ((B7 + B8) * 500);
    const M16 = A8 + (D4 - Q4x) / (B8 * 1000);
    const M19 = E19 + D4 / ((B6 + B7) * 500);
    const M21x = A7 + (D4 - M4) / ((B7 + B8) * 500);
    const M23x = A8 + (D4 - O4x) / (B8 * 1000);
    const M26 = E26 + D4 / ((B7 + B8) * 500);
    const M28 = A8 + (D4 - L4) / (B8 * 1000);
    const M32 = E32 + D4 / (B8 * 1000);

    let B12 = null;
    if (B10 === E19 && D4 <= M4) B12 = M19;
    else if (B10 === E19 && M4 < D4 && D4 <= O4x) B12 = M21x;
    else if (B10 === E19 && O4x < D4) B12 = M23x;
    else if (B10 === E10 && D4 <= N4) B12 = M10;
    else if (B10 === E10 && N4 < D4 && D4 <= P4x) B12 = M12;
    else if (B10 === E10 && P4x < D4 && D4 <= Q4x) B12 = M14;
    else if (B10 === E10 && Q4x < D4) B12 = M16;
    else if (B10 === E26 && D4 <= L4) B12 = M26;
    else if (B10 === E26 && L4 < D4) B12 = M28;
    else if (B10 === E32) B12 = M32;

    return { times: [A5, A6, A7, A8], start: B10 - C22, stop: B12 === null ? null : B12 + C22 };
}

const TARGETS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.50];
const INITIALS = [0.20, 0.35, 0.50];
const VOLUMES = [10, 50, 100];   // 校正範圍 3–100 μL；超出會 throw（batch1 測試 [47]）

test('[fc] 72 個格點：新寫法與 Excel B10／B12 逐格轉寫差 < 1e-9', () => {
    const mismatches = [];
    for (const targetFlowRate of TARGETS) {
        for (const initialFlowRate of INITIALS) {
            for (const injectionVolume of VOLUMES) {
                const xl = excelChain({ injectionVolume, targetFlowRate, initialFlowRate });
                const tag = `${targetFlowRate}/${initialFlowRate}/${injectionVolume} μL`;
                assert.notEqual(xl.stop, null, `Excel B12 落到 FALSE：${tag}`);
                const w = SAXS.fractionCollectorWindow({ times: xl.times, targetFlowRate, initialFlowRate });
                if (Math.abs(w.startTime - xl.start) > 1e-9 || Math.abs(w.stopTime - xl.stop) > 1e-9) {
                    mismatches.push(`${tag}：start ${w.startTime} vs ${xl.start}，stop ${w.stopTime} vs ${xl.stop}`);
                }
            }
        }
    }
    assert.deepEqual(mismatches, [], '有格點不一致：停下來回報，不要改這個測試');
});

test('[fc] calculateHPLCSAXSSettings：Start／Stop（取兩位）與報告結束時間（四捨五入）與 Excel 一致', () => {
    for (const targetFlowRate of TARGETS) {
        for (const initialFlowRate of INITIALS) {
            const xl = excelChain({ targetFlowRate, initialFlowRate });
            const r = SAXS.calculateHPLCSAXSSettings({
                peakCenter: 10.937, peakFWHM: 1, injectionVolume: 100, targetFlowRate, initialFlowRate,
            });
            const tag = `${targetFlowRate}/${initialFlowRate}`;
            assert.ok(Math.abs(r.fractionCollector.startTime - xl.start) <= 0.005 + 1e-9, `${tag} start`);
            assert.ok(Math.abs(r.fractionCollector.stopTime - xl.stop) <= 0.005 + 1e-9, `${tag} stop`);
            assert.equal(r.reportStoptime, Math.round(xl.stop + 1 + 3), `${tag} report stoptime`);
        }
    }
});

// 規格 §5.1 的回歸值（峰中心 10.937、FWHM 1、注射 100 μL）
const SPEC_TABLE = Object.freeze([
    // [目標, 初始, Start, Stop, 報告結束時間]
    [0.35, 0.35, 10.28, 19.72, 24],
    [0.30, 0.35, 10.78, 20.26, 24],
    [0.20, 0.35, 12.53, 21.79, 26],
    [0.15, 0.35, 14.10, 23.10, 27],
    [0.10, 0.35, 16.99, 25.48, 29],
    [0.05, 0.35, 24.35, 32.14, 36],
    [0.35, 0.50, 10.28, 20.03, 24],
]);

test('[fc] 規格 §5.1 表格各列', () => {
    for (const [targetFlowRate, initialFlowRate, start, stop, report] of SPEC_TABLE) {
        const r = SAXS.calculateHPLCSAXSSettings({
            peakCenter: 10.937, peakFWHM: 1, injectionVolume: 100, targetFlowRate, initialFlowRate,
        });
        const tag = `${targetFlowRate}/${initialFlowRate}`;
        assert.ok(Math.abs(r.fractionCollector.startTime - start) < 0.006, `${tag} start ${r.fractionCollector.startTime} != ${start}`);
        assert.ok(Math.abs(r.fractionCollector.stopTime - stop) < 0.006, `${tag} stop ${r.fractionCollector.stopTime} != ${stop}`);
        assert.equal(r.reportStoptime, report, `${tag} report stoptime`);
    }
});

test('[fc] 常數集中在凍結的 FRACTION_COLLECTOR，既有匯出名稱數值不變', () => {
    const fc = SAXS.FRACTION_COLLECTOR;
    assert.ok(Object.isFrozen(fc));
    assert.equal(fc.deadVolumeUl, 1050);
    assert.equal(fc.safeZoneMin, 2.8);
    assert.equal(fc.rampToMidMin, 2);
    assert.equal(fc.rampToInitialMin, 0.5);
    assert.equal(fc.fractionVolumeMl, 1.2);
    assert.equal(SAXS.DEAD_VOLUME_UL, 1050);
    assert.equal(SAXS.SAFE_ZONE_MIN, 2.8);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/fraction-collector.test.js`
Expected: FAIL（`SAXS.fractionCollectorWindow is not a function`、`SAXS.FRACTION_COLLECTOR` 為 undefined、§5.1 表格的 Stop 與報告結束時間不符）。

- [ ] **Step 3: 實作——常數與三個新函式**

在 `saxs-calculator/js/hplc-calculations.js`，把：

```js
/**
 * 系統死體積（μL）與收集安全區間（min）。
 * 來源：Excel `Fraction_collector_high_c`（偵測器到收集器之間的管路體積）。
 * @type {number}
 */
const DEAD_VOLUME_UL = 1050;
const SAFE_ZONE_MIN = 2.8;
```

換成：

```js
/**
 * Fraction collector 與流速回升的常數（Excel `Fraction_collector_high_c`、`工作表1_(2)`、
 * 'HPLC flow down data'）。2026-10-14 決定先照 Excel，待使用者確認是否符合目前硬體與方法；要改只改這裡。
 */
const FRACTION_COLLECTOR = Object.freeze({
    deadVolumeUl: 1050,      // D2：偵測器到收集器之間的管路體積 (μL)
    safeZoneMin: 2.8,        // C22：收集前後的安全區間 (min)
    rampToMidMin: 2,         // 工作表1_(2) M23 = M22 + 2：目標流速 → (目標+初始)/2
    rampToInitialMin: 0.5,   // M24 = M23 + 0.5：→ 初始流速
    fractionVolumeMl: 1.2,   // 'HPLC flow down data'!B24 = 1.2 / 初始流速（每管體積）
});

/** 既有匯出名稱（測試與 UI 使用），值與 FRACTION_COLLECTOR 相同。 */
const DEAD_VOLUME_UL = FRACTION_COLLECTOR.deadVolumeUl;
const SAFE_ZONE_MIN = FRACTION_COLLECTOR.safeZoneMin;

/**
 * Fraction collector 的四段流速（Excel B5–B8），從 X 光收集開始（A5 = M21）算起：
 * 段 1 [A5, A6] 目標流速；段 2 [A6, A7] 用 (目標 + 中值)/2；段 3 [A7, A8] 用 (中值 + 初始)/2；
 * A8 之後回到初始流速。中值 = (目標 + 初始)/2（Excel B7）。
 *
 * 爬升段用「該段平均流速」把體積換成時間是 Excel 的近似：體積正確、時間近似（目標 0.10、
 * 初始 0.35 mL/min 時與線性爬升的精確積分差約 0.16 min）。使用者 2026-10-14 決定照 Excel。
 *
 * @param {number[]} times - [A5, A6, A7, A8]（= M21、M22、M23、M24，min）
 * @param {number} targetFlowRate - 目標流速 (mL/min)
 * @param {number} initialFlowRate - 初始流速 (mL/min)
 * @returns {ReadonlyArray<{start:number, end:number, flowRate:number}>}
 */
function fractionCollectorSegments(times, targetFlowRate, initialFlowRate) {
    const [a5, a6, a7, a8] = times;
    const mid = transitionFlowRate(initialFlowRate, targetFlowRate);
    return Object.freeze([
        Object.freeze({ start: a5, end: a6, flowRate: targetFlowRate }),
        Object.freeze({ start: a6, end: a7, flowRate: (targetFlowRate + mid) / 2 }),
        Object.freeze({ start: a7, end: a8, flowRate: (mid + initialFlowRate) / 2 }),
        Object.freeze({ start: a8, end: Infinity, flowRate: initialFlowRate }),
    ]);
}

/**
 * 從第一段起點起算，累積流出體積到達 volumeUl 的時刻。
 * 邊界與 Excel B10 一致：剛好在段尾到達時算在該段（`<=`）。
 *
 * @param {number} volumeUl - 累積體積 (μL)，≥ 0
 * @param {ReadonlyArray<{start:number, end:number, flowRate:number}>} segments - 最後一段須為無限長
 * @returns {number} 時刻 (min)
 */
function timeAtCumulativeVolume(volumeUl, segments) {
    let remaining = volumeUl;
    for (const segment of segments) {
        const segmentVolume = (segment.end - segment.start) * segment.flowRate * 1000;   // μL；最後一段為 Infinity
        if (remaining <= segmentVolume) {
            return segment.start + remaining / (segment.flowRate * 1000);
        }
        remaining -= segmentVolume;
    }
    throw new Error('timeAtCumulativeVolume：最後一段應為無限長，不應走到這裡');
}

/**
 * Fraction collector 收集時段（Excel `Fraction_collector_high_c` B10／B12 → A24／A27）。
 * 起點：累積體積到達死體積的時刻（X 光收集窗開頭的樣品抵達收集器）− 安全區。
 * 終點：累積體積到達「X 光收集窗體積 Q1 + 死體積」的時刻（收集窗尾端的樣品抵達）＋ 安全區。
 * 等價於 Excel 用數值相等挑分支的兩串 IF（tests/fraction-collector.test.js 以逐格轉寫比對）。
 *
 * @param {{times:number[], targetFlowRate:number, initialFlowRate:number}} p - times = [M21, M22, M23, M24]
 * @returns {{startTime:number, stopTime:number}} 未取位 (min)
 */
function fractionCollectorWindow({ times, targetFlowRate, initialFlowRate }) {
    const segments = fractionCollectorSegments(times, targetFlowRate, initialFlowRate);
    const xrayVolumeUl = (times[1] - times[0]) * targetFlowRate * 1000;   // Excel D4（Q1）
    const { deadVolumeUl, safeZoneMin } = FRACTION_COLLECTOR;
    return Object.freeze({
        startTime: timeAtCumulativeVolume(deadVolumeUl, segments) - safeZoneMin,
        stopTime: timeAtCumulativeVolume(xrayVolumeUl + deadVolumeUl, segments) + safeZoneMin,
    });
}
```

- [ ] **Step 4: 實作——M23／M24 改用常數**

```js
    // M23 = M22+2 (Transition to fast flow)
    const M23 = M22 + 2;

    // M24 = M23+0.5
    const M24 = M23 + 0.5;
```

換成：

```js
    // M23 = M22+2 (Transition to fast flow)
    const M23 = M22 + FRACTION_COLLECTOR.rampToMidMin;

    // M24 = M23+0.5
    const M24 = M23 + FRACTION_COLLECTOR.rampToInitialMin;
```

- [ ] **Step 5: 實作——fraction collector 區塊與報告結束時間**

把從 `    // === Fraction Collector (Excel \`Fraction_collector_high_c\`) ===` 到 `    const reportStoptime = Math.ceil(fractionStopTime + 1 + 3);` 的整段（原檔如下）：

```js
    // === Fraction Collector (Excel `Fraction_collector_high_c`) ===
    // 舊版用「×2.45 反推」硬湊 Excel 範例的 19.72，換了流速就完全失準。
    // 實際物理量：
    //   起始 = X 光開始時間 + 死體積走完所需時間 − 安全區間
    //   結束 = 起始 + 安全區間 + X 光收集時間 + 安全區間
    // 死體積 1050 μL 與安全區間 2.8 min 為 Excel 表上的常數。
    // 注意：本式對應 Excel Fraction_collector_high_c 的第一分支，適用於
    // (M22 − M21) × flow × 1000 ≥ 1050 μL；更慢的流速 Excel 會分段續算。
    const xrayDuration = M22 - M21;
    const deadVolumeTime = DEAD_VOLUME_UL / (targetFlowRate * 1000);   // min
    const fractionStartTime = M21 + deadVolumeTime - SAFE_ZONE_MIN;
    const fractionStopTime = fractionStartTime + SAFE_ZONE_MIN + xrayDuration + SAFE_ZONE_MIN;

    // B24 = 1.2/B6 (time per fraction)
    const timePerFraction = 1.2 / initialFlowRate;

    // 保留 2 位小數：Excel 的 fraction collector 時間就是以 0.01 min 設定的
    const fractionCollector = {
        startTime: parseFloat(fractionStartTime.toFixed(2)),
        stopTime: parseFloat(fractionStopTime.toFixed(2)),
        timePerFraction: parseFloat(timePerFraction.toFixed(2))
    };

    // === Report Stoptime (來自 HPLC flow down data A15) ===
    // A15 = B22+1+3 (然後取整數)
    const reportStoptime = Math.ceil(fractionStopTime + 1 + 3);
```

換成：

```js
    // === Fraction Collector (Excel `Fraction_collector_high_c`) ===
    // 減速段與回升段的流速不同，死體積要逐段換算。舊版只用目標流速，初始 ≠ 目標時
    // Stop 一律偏晚（0.20／0.35 mL/min 晚 1.56 min）。
    const xrayDuration = M22 - M21;
    const { startTime: fractionStartTime, stopTime: fractionStopTime } = fractionCollectorWindow({
        times: [M21, M22, M23, M24], targetFlowRate, initialFlowRate,
    });

    // 'HPLC flow down data'!B24 = 1.2/B6（該工作表的 B6 是初始流速）
    const timePerFraction = FRACTION_COLLECTOR.fractionVolumeMl / initialFlowRate;

    // 保留 2 位小數：Excel 的 fraction collector 時間就是以 0.01 min 設定的
    const fractionCollector = {
        startTime: parseFloat(fractionStartTime.toFixed(2)),
        stopTime: parseFloat(fractionStopTime.toFixed(2)),
        timePerFraction: parseFloat(timePerFraction.toFixed(2))
    };

    // === Report Stoptime ('HPLC flow down data'!A15 = B22+1+3) ===
    // 公式本身不取整；儲存格格式 [$-404]0 讓畫面顯示四捨五入的整數，Excel 裡沒有其他儲存格引用 A15。
    // 2026-10-14 使用者決定與 Excel 畫面一致（原本的 Math.ceil 在多數流速下多 1 min）。
    const reportStoptime = Math.round(fractionStopTime + 1 + 3);
```

- [ ] **Step 6: 匯出新名稱**

在 `saxs-calculator/js/calculations.js` 的匯出區塊，把：

```js
    DEAD_VOLUME_UL,
    SAFE_ZONE_MIN,
```

換成：

```js
    DEAD_VOLUME_UL,
    SAFE_ZONE_MIN,
    FRACTION_COLLECTOR,
    fractionCollectorSegments,
    timeAtCumulativeVolume,
    fractionCollectorWindow,
```

- [ ] **Step 7: 修正 batch1 測試 [46] 的錯誤期望值**

在 `saxs-calculator/tests/batch1.test.js`，把：

```js
test('[46] Fraction collector 隨流速改變（不再是寫死的 ×2.45）', () => {
    const slow = SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, targetFlowRate: 0.2 });
    // start = M21 + 1050/(0.2×1000) − 2.8 = 10.08 + 5.25 − 2.8
    approx(slow.fractionCollector.startTime, 12.53, 2e-3, 'fraction start @0.2 mL/min');
    const span = slow.fractionCollector.stopTime - slow.fractionCollector.startTime;
    approx(span, 2.8 + (slow.flowRateTable[3].time - slow.flowRateTable[2].time) + 2.8, 2e-3, 'collection span');
});
```

換成：

```js
test('[46] Fraction collector 隨流速改變（Excel 分段計算，目標 0.20／初始 0.35）', () => {
    const slow = SAXS.calculateHPLCSAXSSettings({ ...EXCEL_CASE, targetFlowRate: 0.2 });
    // 死體積在慢流速段內走完：start = M21 + 1050/(0.2×1000) − 2.8 = 10.08 + 5.25 − 2.8
    approx(slow.fractionCollector.startTime, 12.53, 2e-3, 'fraction start @0.2 mL/min');
    // 收集窗尾端的樣品在 M22 之後才走完死體積，要用回升段的流速逐段換算（Excel B12）→ 21.79。
    // 舊期望值（Stop − Start = 2.8 + 收集時間 + 2.8 → 23.35）是由錯誤公式推得，不是 Excel 的值。
    approx(slow.fractionCollector.stopTime, 21.79, 2e-3, 'fraction stop @0.2/0.35 mL/min');
});
```

- [ ] **Step 8: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`（165 pass）。若 72 格點測試有不一致，停下來回報。

- [ ] **Step 9: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js/hplc-calculations.js saxs-calculator/js/calculations.js saxs-calculator/tests/fraction-collector.test.js saxs-calculator/tests/batch1.test.js
git commit -m "fix: fraction collector stop time walks the flow ramp segments like Excel; report stoptime rounds like Excel's display

The old formula assumed the whole dead volume passed at the target flow, so the
stop time was late whenever initial != target (0.20/0.35 mL/min: 23.35 vs Excel 21.79).
Test [46] asserted that wrong derivation; its expected stop now comes from the
Excel chain (Fraction_collector_high_c B12), verified against a cell-by-cell
transcription on a 72-point grid."
```

---

### Task 5: dn/dc 負峰保留符號、負 dn/dc 警告、負 UV 峰拒絕——JS 計算（規格 §6.1–6.3）

**Files:**
- Create: `saxs-calculator/tests/dndc-sign.test.js`
- Modify: `saxs-calculator/js/dndc-signal-calculations.js`（`measurePeak`）
- Modify: `saxs-calculator/js/dndc-calculations.js`（常數、`negativeDndcWarnings`、`computeHplcDndc`、`computeSliceDndc`、匯出）

- [ ] **Step 1: 寫失敗測試 `tests/dndc-sign.test.js`**

```js
'use strict';
/**
 * 負峰保留正負號、負 dn/dc 警告、負 UV 峰拒絕（待辦批次 v4.15 規格 §6，與 Python 版一致）。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Dndc } = require('./load.js');

const DT = 0.01;

/** 合成色譜圖：UV 與 RI 為同一個高斯峰（與 batch0／batch1 同款）。 */
function chromatogram({ uvHeight = 0.5, riHeight = 1.3875e-4, center = 8, sigma = 0.3 } = {}) {
    const time = [];
    const uv = [];
    const ri = [];
    for (let t = 0; t <= 20 + DT / 2; t += DT) {
        const g = Math.exp(-0.5 * ((t - center) / sigma) ** 2);
        time.push(Number(t.toFixed(4)));
        uv.push(uvHeight * g);
        ri.push(riHeight * g);
    }
    return { time, uv, ri };
}

const PARAMS = Object.freeze({
    peakStart: 7, peakEnd: 9,
    bl1Start: 3, bl1End: 4, bl2Start: 15, bl2End: 16,
    epsilon: 0.667, pathLen: 1, riFactor: 1, riDelay: 0,
    baselineMode: 'const', peakMode: 'height',
    manualC: null, autoAlign: false, decimalPlaces: 6,
});

// dn/dc = riHeight / (uvHeight / (ε·l) / 1000) = 1.3875e-4 / 7.4963e-4 ≈ 0.18509 mL/g
const DNDC = 1.3875e-4 / (0.5 / 0.667 / 1000);
const negate = arr => arr.map(v => -v);
const near = (actual, expected, rel, msg) =>
    assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${msg}: ${actual} != ${expected}`);

test('[sign] measurePeak：負峰的峰高與面積保留負號，正峰不變', () => {
    const { time, uv } = chromatogram();
    const mask = time.map(t => t >= 6 && t <= 10);
    const pos = Dndc.measurePeak(uv, time, mask, 'height');
    const negHeight = Dndc.measurePeak(negate(uv), time, mask, 'height');
    const negArea = Dndc.measurePeak(negate(uv), time, mask, 'area');
    near(negHeight.peakHeight, -0.5, 1e-9, '負峰峰高');
    assert.ok(negArea.peakArea < 0, `負峰面積應為負：${negArea.peakArea}`);
    near(negArea.peakArea, -pos.peakArea, 1e-12, '負峰面積 = −正峰面積');
    assert.ok(pos.peakHeight > 0 && pos.peakArea > 0, '正峰不變');
});

test('[sign] computeHplcDndc：負 RI 峰 → 負 dn/dc＋警告；正峰沒有警告', () => {
    const { time, uv, ri } = chromatogram();
    for (const peakMode of ['height', 'area']) {
        const neg = Dndc.computeHplcDndc(time, uv, negate(ri), { ...PARAMS, peakMode });
        near(neg.dndc, -DNDC, 1e-6, `${peakMode} 負 dn/dc`);
        assert.deepEqual(neg.warnings, [Dndc.NEGATIVE_DNDC_WARNING], `${peakMode} 警告`);
        const pos = Dndc.computeHplcDndc(time, uv, ri, { ...PARAMS, peakMode });
        near(pos.dndc, DNDC, 1e-6, `${peakMode} 正 dn/dc`);
        assert.deepEqual(pos.warnings, [], `${peakMode} 正峰無警告`);
    }
});

test('[sign] computeHplcDndc：UV 峰為負 → 明確錯誤（不再說成「無法求得有效濃度」）', () => {
    const { time, uv, ri } = chromatogram();
    assert.throws(() => Dndc.computeHplcDndc(time, negate(uv), ri, PARAMS), /UV 峰為負/);
    assert.throws(
        () => Dndc.computeHplcDndc(time, negate(uv), negate(ri), { ...PARAMS, peakMode: 'area' }),
        /UV 峰為負/);
});

test('[sign] computeHplcDndc：手動濃度時不檢查 UV 的符號', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeHplcDndc(time, negate(uv), ri, { ...PARAMS, manualC: 0.75 });
    assert.ok(r.dndc > 0);
    assert.deepEqual(r.warnings, []);
});

test('[sign] computeSliceDndc：負 RI 峰 → 負斜率＋警告', () => {
    const { time, uv, ri } = chromatogram();
    const r = Dndc.computeSliceDndc(time, uv, negate(ri), PARAMS);
    near(r.dndc, -DNDC, 1e-6, 'slice 負斜率');
    assert.deepEqual(r.warnings, [Dndc.NEGATIVE_DNDC_WARNING]);
    assert.deepEqual(Dndc.computeSliceDndc(time, uv, ri, PARAMS).warnings, []);
});

test('[sign] negativeDndcWarnings：只有負值才警告；訊息與 Python 相同', () => {
    assert.equal(Dndc.NEGATIVE_DNDC_WARNING, 'dn/dc 為負：請檢查 RI 極性或峰／基線區間');
    assert.equal(Dndc.NEGATIVE_UV_PEAK_MESSAGE, 'UV 峰為負：基線區間落在峰上或極性反轉，請檢查 UV 峰範圍與基線範圍');
    assert.deepEqual(Dndc.negativeDndcWarnings(-0.01), [Dndc.NEGATIVE_DNDC_WARNING]);
    assert.deepEqual(Dndc.negativeDndcWarnings(0.185), []);
    assert.deepEqual(Dndc.negativeDndcWarnings(0), []);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/dndc-sign.test.js`
Expected: FAIL（負峰峰高為 +0.5、`warnings` 為 undefined、負 UV 峰的錯誤訊息是「無法求得有效濃度」或計算成功）。

- [ ] **Step 3: `measurePeak` 保留符號**

在 `saxs-calculator/js/dndc-signal-calculations.js`，把：

```js
    // Height: maximum absolute value
    const peakHeight = sig.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);

    // Area: trapezoidal integration of absolute area
    let peakArea = 0;
    for (let i = 1; i < sig.length; i++) {
        peakArea += (t[i] - t[i - 1]) * (sig[i] + sig[i - 1]) / 2;
    }
    peakArea = Math.abs(peakArea);
```

換成：

```js
    // Height：絕對值最大那一點的原值（保留正負號；負峰 = 訊號低於基線，例如樣品折射率低於溶劑或極性反轉）
    const peakHeight = sig.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);

    // Area：梯形積分，保留正負號
    let peakArea = 0;
    for (let i = 1; i < sig.length; i++) {
        peakArea += (t[i] - t[i - 1]) * (sig[i] + sig[i - 1]) / 2;
    }
```

- [ ] **Step 4: 常數與 `negativeDndcWarnings`**

在 `saxs-calculator/js/dndc-calculations.js`，緊接在

```js
// ============================================================
// Calculator — HPLC & Slice dn/dc
// ============================================================
```

之後插入：

```js

/** 負 dn/dc 的警告文字（與 Python dndc.calculator.NEGATIVE_DNDC_WARNING 相同）。 */
const NEGATIVE_DNDC_WARNING = 'dn/dc 為負：請檢查 RI 極性或峰／基線區間';

/** UV 峰為負時的錯誤訊息（與 Python dndc.calculator.NEGATIVE_UV_PEAK_MESSAGE 相同）。 */
const NEGATIVE_UV_PEAK_MESSAGE = 'UV 峰為負：基線區間落在峰上或極性反轉，請檢查 UV 峰範圍與基線範圍';

/**
 * 最終 dn/dc 為負時回傳警告。蛋白質的 dn/dc 必為正，負值幾乎都是設定錯誤；
 * 但少數樣品在高折射率溶劑中本來就是負的，所以只警告、不擋（使用者 2026-10-14 定案）。
 *
 * @param {number} dndc - mL/g
 * @returns {string[]} 新陣列
 */
function negativeDndcWarnings(dndc) {
    return dndc < 0 ? [NEGATIVE_DNDC_WARNING] : [];
}
```

- [ ] **Step 5: `computeHplcDndc` 加負 UV 檢查與 `warnings`**

把：

```js
        const uvPeak = measurePeak(concArray, time, peakMask, peakMode);
        concentration = uvPeak.value;
```

換成：

```js
        const uvPeak = measurePeak(concArray, time, peakMask, peakMode);
        // 峰值保留符號後，負 UV 峰會走到下方的「無法求得有效濃度」——那句話講錯原因，先攔下
        if (uvPeak.value < 0) {
            throw new Error(NEGATIVE_UV_PEAK_MESSAGE);
        }
        concentration = uvPeak.value;
```

在 `computeHplcDndc` 的回傳物件，把（前面有 `baselineMode,`，只出現一次）：

```js
        baselineMode,
        decimalPlaces,
        alignmentInfo,
        uvCorrected,
        riCorrected: riBaselineCorrected
    };
}
```

換成：

```js
        baselineMode,
        decimalPlaces,
        alignmentInfo,
        uvCorrected,
        riCorrected: riBaselineCorrected,
        warnings: negativeDndcWarnings(dndc)
    };
}
```

- [ ] **Step 6: `computeSliceDndc` 加 `warnings`**

在 `computeSliceDndc` 的回傳物件，把（前面有 `sliceDndcValues,`，只出現一次）：

```js
        sliceDndcValues,
        decimalPlaces,
        alignmentInfo,
        uvCorrected,
        riCorrected: riBaselineCorrected
    };
}
```

換成：

```js
        sliceDndcValues,
        decimalPlaces,
        alignmentInfo,
        uvCorrected,
        riCorrected: riBaselineCorrected,
        warnings: negativeDndcWarnings(dndc)
    };
}
```

> 兩個回傳物件的後四行完全相同，所以舊字串必須包含前一行（`baselineMode,` 或 `sliceDndcValues,`）才唯一。改完用 `grep -n "warnings: negativeDndcWarnings" saxs-calculator/js/dndc-calculations.js` 確認有兩處。

- [ ] **Step 7: 匯出**

在 `window.DndcCalculations = Object.freeze({` 區塊，把：

```js
    computeHplcDndc,
    computeSliceDndc
});
```

換成：

```js
    computeHplcDndc,
    computeSliceDndc,
    NEGATIVE_DNDC_WARNING,
    NEGATIVE_UV_PEAK_MESSAGE,
    negativeDndcWarnings
});
```

- [ ] **Step 8: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`（171 pass）。

- [ ] **Step 9: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js/dndc-signal-calculations.js saxs-calculator/js/dndc-calculations.js saxs-calculator/tests/dndc-sign.test.js
git commit -m "fix: keep the sign of dn/dc peak height and area; warn on negative dn/dc, reject negative UV peaks"
```

---

### Task 6: dn/dc 畫面顯示負值警告（規格 §6.2）

**Files:**
- Modify: `saxs-calculator/js/dndc-hplc-results.js`（`displayHplcDndcResults`）
- Modify: `saxs-calculator/js/dndc-slice-ui.js`（`displaySliceResults`）
- Modify: `saxs-calculator/js/dndc-multi-ui.js`（`displayMultiFitResults`）

> 這三個檔是 DOM 畫面，沒有單元測試；驗證在 Task 13 的瀏覽器步驟。

- [ ] **Step 1: HPLC 結果**

在 `dndc-hplc-results.js` 的 `displayHplcDndcResults` 裡，把：

```js
        ${renderWarningsHtml(warnings)}
```

換成：

```js
        ${renderWarningsHtml([...warnings, ...(result.warnings || [])])}
```

- [ ] **Step 2: Slice 結果**

在 `dndc-slice-ui.js` 的 `displaySliceResults` 裡，做同樣的替換：

```js
        ${renderWarningsHtml(warnings)}
```

換成：

```js
        ${renderWarningsHtml([...warnings, ...(result.warnings || [])])}
```

- [ ] **Step 3: 手動多注射（只限 `source === 'manual'`）**

在 `dndc-multi-ui.js` 的 `displayMultiFitResults` 裡，把：

```js
    resultsDiv.innerHTML = `
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i> (斜率)</div>
                <div class="stat-value" style="font-size: 1.75rem;">${formatDndc(result.dnDc)} <span class="stat-unit">mL/g</span></div>
```

換成：

```js
    // 負斜率警告只給手動多注射；ASTRA 多注射（source === 'astra'）沿用它自己的慣例（規格 §6.2）
    const signWarnings = source === 'manual' ? DndcCalculations.negativeDndcWarnings(result.dnDc) : [];

    resultsDiv.innerHTML = `
        ${renderWarningsHtml(signWarnings)}
        <div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
            <div class="stat-content">
                <div class="stat-label">d<i>n</i>/d<i>c</i> (斜率)</div>
                <div class="stat-value" style="font-size: 1.75rem;">${formatDndc(result.dnDc)} <span class="stat-unit">mL/g</span></div>
```

- [ ] **Step 4: 跑全部測試（語法與結構）**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`。

- [ ] **Step 5: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js/dndc-hplc-results.js saxs-calculator/js/dndc-slice-ui.js saxs-calculator/js/dndc-multi-ui.js
git commit -m "feat: show the negative dn/dc warning on HPLC, slice and manual multi-injection results"
```

---

### Task 7: Python——峰值保留符號、FWHM 不再扣最小值、清掉三個 xfail（規格 §6.1、§6.5、§6.6）

**Files:**
- Modify: `dndc calculator/src/dndc/peak.py:43-44`
- Modify: `dndc calculator/src/dndc/broadening.py:70-72`
- Modify: `dndc calculator/src/dndc/calculator.py:29`（未使用的 import）
- Modify: `dndc calculator/tests/test_peak.py`、`dndc calculator/tests/test_broadening.py`

- [ ] **Step 1: 拿掉 xfail 標記、加一個負峰 FWHM 測試（RED）**

`tests/test_peak.py`：刪掉 `test_measure_peak_negative_peak_height_should_preserve_sign` 與 `test_measure_peak_negative_peak_area_should_preserve_sign` 兩個函式上方各自的 `@pytest.mark.bug(BUG_NEGATIVE_PEAK_ABS)` 與整個 `@pytest.mark.xfail(...)` 裝飾器（函式本文與斷言不動）。刪掉第 47 行 `BUG_NEGATIVE_PEAK_ABS = "src/dndc/peak.py:36"`（先 `grep -n BUG_NEGATIVE_PEAK_ABS tests/test_peak.py` 確認沒有其他用處）。把模組 docstring 第 14 行：

```
  - 負峰符號遺失：對照已知缺陷，xfail(strict=True) 鎖定。
```

換成：

```
  - 負峰保留符號：峰高取絕對值最大點的原值、面積不取絕對值（2026-10-14 修正，原以 xfail 鎖定）。
```

`tests/test_broadening.py`：刪掉 `test_measure_fwhm_baseline_corrected_peak_truncated_at_2sigma_is_unbiased` 上方的 `@pytest.mark.bug("dndc calculator/src/dndc/broadening.py:71")` 與整個 `@pytest.mark.xfail(...)`。在 `test_measure_fwhm_returns_none_for_short_signal` 之前新增：

```python
def test_measure_fwhm_negative_peak_matches_positive_peak():
    """負峰（已基線校正、訊號在 0 之下）翻正後量測，FWHM 與同寬正峰相同。"""
    sigma = 0.3
    dt = sigma / 200.0
    t = np.arange(-4.0 * sigma, 4.0 * sigma + dt / 2, dt)
    signal = -np.exp(-0.5 * (t / sigma) ** 2)

    fwhm = _measure_fwhm(signal, t)

    assert fwhm is not None
    assert fwhm == pytest.approx(FWHM_FACTOR * sigma, rel=1e-3)
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator" && .venv_mac/bin/python -m pytest -q tests/test_peak.py tests/test_broadening.py`
Expected: 4 failed（兩個負峰、±2σ FWHM、負峰 FWHM），其餘通過。

- [ ] **Step 3: 修 `peak.py`**

把：

```python
    peak_height = float(np.max(np.abs(sig_in_peak)))
    peak_area = float(np.abs(np.trapezoid(sig_in_peak, time_in_peak)))
```

換成：

```python
    # 峰高：峰區內絕對值最大那一點的原值（保留正負號；負峰 = 訊號低於基線）
    peak_height = float(sig_in_peak[int(np.argmax(np.abs(sig_in_peak)))])
    # 峰面積：梯形積分，保留正負號
    peak_area = float(np.trapezoid(sig_in_peak, time_in_peak))
```

- [ ] **Step 4: 修 `broadening.py` 的 `_measure_fwhm`**

把：

```python
    # 使用最小值作為基線（峰範圍內最低點）
    baseline = np.min(signal)
    s = np.abs(signal - baseline)
    peak_val = np.max(s)
```

換成：

```python
    # 輸入已是基線校正後的訊號（基線 = 0），不可再扣峰區最小值（峰區只取 ±2σ 時會讓
    # FWHM 低估約 10%）。依絕對值最大點的符號決定峰方向，負峰翻正後量測。
    apex = float(signal[int(np.argmax(np.abs(signal)))])
    s = signal if apex >= 0 else -signal
    peak_val = np.max(s)
```

- [ ] **Step 5: 刪掉 `calculator.py` 未使用的 import**

把 `from .peak import detect_peak_direction, measure_peak` 換成 `from .peak import measure_peak`。

- [ ] **Step 6: 轉回 CRLF**

```bash
cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator"
for f in src/dndc/peak.py src/dndc/broadening.py src/dndc/calculator.py; do perl -pi -e 's/\r?\n/\r\n/' "$f"; done
file src/dndc/peak.py src/dndc/broadening.py src/dndc/calculator.py
git diff --stat
```

Expected: 三個檔都顯示 `with CRLF line terminators`；`git diff --stat` 每個 src 檔只有個位數到十幾行變動。

- [ ] **Step 7: 更新過時的測試說明**

`tests/test_broadening.py` 模組 docstring：

把 `- ``_measure_fwhm``：FWHM 應等於解析式 2*sqrt(2*ln2)*sigma ≈ 2.3548*sigma。` 換成：

```
- ``_measure_fwhm``：FWHM 應等於解析式 2*sqrt(2*ln2)*sigma ≈ 2.3548*sigma。輸入是已基線校正的訊號，
  不再扣峰區最小值；負峰依符號翻正後量測（2026-10-14 修正，原以 xfail 鎖定）。
```

把描述 wiener xfail 的那幾行（`；輸出長度不得改變、不得產生 NaN；已知 bug` 到 `這個違反面積守恆的迴歸。`）換成：

```
；輸出長度不得改變、不得產生 NaN；反卷積後訊號面積（Σresult）必須等於原訊號面積（Σsignal）
  （直流增益 1/(1+NSR) 的 bug 已於 895c18a 修正）。
```

把 `test_measure_fwhm_returns_none_for_flat_signal` 的 docstring `"""完全平坦訊號（peak_val < 1e-15）沒有可量測的半高寬。"""` 換成 `"""完全平坦訊號沒有半高交叉點，無法量測半高寬。"""`。

- [ ] **Step 8: 跑全部測試**

Run: `cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator" && .venv_mac/bin/python -m pytest -q`
Expected: `330 passed`，**0 xfailed**（326 + 3 個原 xfail + 1 個新測試）。

- [ ] **Step 9: Commit（dndc repo）**

```bash
cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator"
git add src/dndc/peak.py src/dndc/broadening.py src/dndc/calculator.py tests/test_peak.py tests/test_broadening.py
git commit -m "fix: keep the sign of peak height/area; FWHM no longer subtracts the window minimum from a baseline-corrected peak"
```

---

### Task 8: Python——負 dn/dc 警告、負 UV 峰拒絕、RI 因子守門、畫面顯示（規格 §6.2–6.4、§6.6）

**Files:**
- Modify: `dndc calculator/src/dndc/models.py`（`CalculationResult`）
- Modify: `dndc calculator/src/dndc/calculator.py`（常數、兩個 helper、`compute_hplc_dndc`、`_compute_concentration`、`SliceResult`、`compute_slice_dndc`）
- Modify: `dndc calculator/src/dndc/validation.py:97-99`
- Modify: `dndc calculator/src/dndc/web/pages/hplc_page.py`、`dndc calculator/src/dndc/web/pages/hplc_slice.py`、`dndc calculator/src/dndc/__main__.py`
- Modify: `dndc calculator/tests/test_calculator.py`、`dndc calculator/tests/test_io_validation.py`

- [ ] **Step 1: 寫失敗測試**

`tests/test_calculator.py`：

1. 把 import：

```python
from dndc.calculator import (
    _apply_ri_delay,
    _validate_hplc_columns,
    compute_hplc_dndc,
    compute_interactive_dndc,
    compute_slice_dndc,
)
```

換成：

```python
from dndc.calculator import (
    NEGATIVE_DNDC_WARNING,
    _apply_ri_delay,
    _validate_hplc_columns,
    compute_hplc_dndc,
    compute_interactive_dndc,
    compute_slice_dndc,
)
```

2. 在 `test_compute_hplc_dndc_negative_ri_peak_auto_align_recovers_delay`：docstring 的這五行

```
    期望值：物理上負峰的 dn/dc 應為 -0.185（Δn 為負），但 measure_peak
    (src/dndc/peak.py:35-36) 對 height/area 都取絕對值，符號在量測層即遺失，
    因此目前可回復的是「量值」+0.185。符號遺失本身由 test_peak.py 的兩個
    xfail（negative_peak_height/area_should_preserve_sign）單獨鎖定，
    此處不重複主張，只鎖定「對齊沒有被負相關係數破壞」。
```

換成：

```
    期望值：負峰的 dn/dc 為 -0.185（Δn 為負）。measure_peak 自 2026-10-14 起保留正負號，
    所以同時鎖定「對齊沒有被負相關係數破壞」與「符號正確、附負值警告」。
```

並把最後一行斷言 `assert abs(result.dn_dc) == pytest.approx(dn_dc_magnitude, rel=5e-3)` 換成：

```python
    assert result.dn_dc == pytest.approx(-dn_dc_magnitude, rel=5e-3)
    assert result.warnings == (NEGATIVE_DNDC_WARNING,)
```

3. 在該測試之後新增：

```python
# ---------------------------------------------------------------------------
# 負 dn/dc 警告、負 UV 峰、RI 因子（2026-10-14 待辦批次 §6）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("peak_mode", ["height", "area"])
def test_compute_hplc_dndc_negative_ri_peak_gives_signed_dndc_and_warning(
    chromatogram_factory, peak_mode
):
    """負 RI 峰：dn/dc 保留負號並附警告（只警告不擋）。"""
    dn_dc_target, uv_height, epsilon, path_len = 0.185, 0.5, 0.667, 1.0
    ri_height = -_expected_ri_height(dn_dc_target, uv_height, epsilon, path_len)
    chrom = chromatogram_factory(uv_height=uv_height, ri_height=ri_height, sigma=0.3)
    params = _params(epsilon=epsilon, path_len=path_len, peak_mode=peak_mode)

    result = compute_hplc_dndc(chrom.df, params)

    assert result.dn_dc == pytest.approx(-dn_dc_target, rel=1e-3)
    assert result.warnings == (NEGATIVE_DNDC_WARNING,)


def test_compute_hplc_dndc_positive_peak_has_no_warning(chromatogram_factory):
    dn_dc_target, uv_height, epsilon, path_len = 0.185, 0.5, 0.667, 1.0
    ri_height = _expected_ri_height(dn_dc_target, uv_height, epsilon, path_len)
    chrom = chromatogram_factory(uv_height=uv_height, ri_height=ri_height, sigma=0.3)

    result = compute_hplc_dndc(chrom.df, _params(epsilon=epsilon, path_len=path_len))

    assert result.dn_dc == pytest.approx(dn_dc_target, rel=1e-3)
    assert result.warnings == ()


@pytest.mark.parametrize("peak_mode", ["height", "area"])
def test_compute_hplc_dndc_negative_uv_peak_raises_specific_error(
    chromatogram_factory, peak_mode
):
    """UV 峰為負（基線區間落在峰上或極性反轉）：明確拒絕，不說成「無法求得有效濃度」。"""
    ri_height = -_expected_ri_height(0.185, 0.5, 0.667, 1.0)
    chrom = chromatogram_factory(uv_height=-0.5, ri_height=ri_height, sigma=0.3)

    with pytest.raises(ValueError, match="UV 峰為負"):
        compute_hplc_dndc(chrom.df, _params(peak_mode=peak_mode))


@pytest.mark.parametrize("ri_factor", [-1.0, 0.0])
def test_compute_hplc_dndc_rejects_non_positive_ri_factor(chromatogram_factory, ri_factor):
    """CLI 與直接呼叫不經過 validate_params，計算函式自己也要擋（與 JS 一致）。"""
    with pytest.raises(ValueError, match="RI 校正因子"):
        compute_hplc_dndc(chromatogram_factory().df, _params(ri_factor=ri_factor))


@pytest.mark.parametrize("ri_factor", [-1.0, 0.0])
def test_compute_slice_dndc_rejects_non_positive_ri_factor(chromatogram_factory, ri_factor):
    with pytest.raises(ValueError, match="RI 校正因子"):
        compute_slice_dndc(chromatogram_factory().df, _params(ri_factor=ri_factor))


def test_compute_slice_dndc_negative_ri_peak_gives_signed_slope_and_warning(
    chromatogram_factory,
):
    dn_dc_target, uv_height, epsilon, path_len = 0.185, 0.5, 0.667, 1.0
    ri_height = -_expected_ri_height(dn_dc_target, uv_height, epsilon, path_len)
    chrom = chromatogram_factory(uv_height=uv_height, ri_height=ri_height, sigma=0.3)

    result = compute_slice_dndc(chrom.df, _params(epsilon=epsilon, path_len=path_len))

    assert result.dn_dc == pytest.approx(-dn_dc_target, rel=1e-3)
    assert result.warnings == (NEGATIVE_DNDC_WARNING,)
```

`tests/test_io_validation.py`：在 `test_validate_params_default_config_has_no_errors` 之後新增：

```python
@pytest.mark.parametrize("ri_factor", [-1.0, 0.0])
def test_validate_params_rejects_non_positive_ri_factor(ri_factor):
    """負的 ri_factor 會悄悄翻轉 dn/dc 的符號，與 0 一樣要擋。"""
    errors = validation.validate_params(_valid_params(ri_factor=ri_factor))
    assert any("ri_factor" in e for e in errors)
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator" && .venv_mac/bin/python -m pytest -q tests/test_calculator.py tests/test_io_validation.py`
Expected: ImportError（`NEGATIVE_DNDC_WARNING` 不存在）導致 `test_calculator.py` 整檔收集失敗；`test_validate_params_rejects_non_positive_ri_factor[-1.0]` 失敗。

- [ ] **Step 3: `models.py`**

在 `CalculationResult` 裡，把：

```python
    params: CalculationParams
    alignment_lag: float | None = None
```

換成：

```python
    params: CalculationParams
    alignment_lag: float | None = None
    warnings: tuple[str, ...] = ()
```

- [ ] **Step 4: `calculator.py`——常數與 helper**

在：

```python
_NAN_ADVICE_ALIGNED = (
    "請把基線／峰範圍避開該區間，或調整 RI 延遲／關閉自動對齊"
)
```

之後插入：

```python

NEGATIVE_DNDC_WARNING = "dn/dc 為負：請檢查 RI 極性或峰／基線區間"
NEGATIVE_UV_PEAK_MESSAGE = (
    "UV 峰為負：基線區間落在峰上或極性反轉，請檢查 UV 峰範圍與基線範圍"
)


def _negative_dndc_warnings(dn_dc: float) -> tuple[str, ...]:
    """最終 dn/dc 為負時回傳警告。

    蛋白質的 dn/dc 必為正，負值幾乎都是設定錯誤；但少數樣品在高折射率溶劑中
    本來就是負的，所以只警告、不擋（使用者 2026-10-14 定案；與 JS 一致）。
    """
    return (NEGATIVE_DNDC_WARNING,) if dn_dc < 0 else ()


def _assert_ri_factor_positive(ri_factor: float) -> None:
    """RI 校正因子必須 > 0。負值會靜默翻轉 dn/dc 的符號；與 JS _assertOpticalParams 一致。"""
    if not (math.isfinite(ri_factor) and ri_factor > 0):
        raise ValueError("RI 校正因子 (K_RI) 必須是大於 0 的數值")
```

- [ ] **Step 5: `calculator.py`——HPLC 主流程**

把：

```python
    _validate_hplc_columns(df, params)
    _validate_manual_c_peak_mode(params)
```

換成：

```python
    _validate_hplc_columns(df, params)
    _validate_manual_c_peak_mode(params)
    _assert_ri_factor_positive(params.ri_factor)
```

把：

```python
        params=params,
        alignment_lag=alignment_lag,
    )
```

換成：

```python
        params=params,
        alignment_lag=alignment_lag,
        warnings=_negative_dndc_warnings(dn_dc),
    )
```

在 `_compute_concentration` 裡，把：

```python
    delta_uv = uv_peak.value
```

換成：

```python
    delta_uv = uv_peak.value
    # 峰值保留符號後，負 UV 峰會讓濃度變負，再被呼叫端說成「無法求得有效濃度」——先攔下講對原因
    if delta_uv < 0:
        raise ValueError(NEGATIVE_UV_PEAK_MESSAGE)
```

- [ ] **Step 6: `calculator.py`——Slice**

在 `SliceResult` 裡，把：

```python
    broadening_nsr: float | None = None
```

換成：

```python
    broadening_nsr: float | None = None
    warnings: tuple[str, ...] = ()
```

在 `compute_slice_dndc` 裡，把：

```python
        ValueError: 當資料不足或無法計算時。
    """
    _validate_hplc_columns(df, params)
```

換成：

```python
        ValueError: 當資料不足或無法計算時。
    """
    _validate_hplc_columns(df, params)
    _assert_ri_factor_positive(params.ri_factor)
```

把回傳的

```python
        broadening_nsr=applied_nsr,
    )
```

換成：

```python
        broadening_nsr=applied_nsr,
        warnings=_negative_dndc_warnings(fit.dn_dc),
    )
```

- [ ] **Step 7: `validation.py`**

把：

```python
    if not isinstance(ri_factor, (int, float)) or ri_factor == 0:
        errors.append("RI 因子 (ri_factor) 不可為 0")
```

換成：

```python
    if not isinstance(ri_factor, (int, float)) or ri_factor <= 0:
        errors.append("RI 因子 (ri_factor) 必須 > 0（負值會翻轉 dn/dc 的符號）")
```

- [ ] **Step 8: 畫面與 CLI 顯示警告**

`src/dndc/web/pages/hplc_page.py` 的 `_display_results`，在

```python
    c4.metric("Delta UV", f"{result.delta_uv:.6f}" if result.delta_uv is not None else "N/A")
```

之後插入：

```python

    for warning in result.warnings:
        st.warning(warning)
```

`src/dndc/web/pages/hplc_slice.py` 的 `_display_slice_result`，在

```python
    c4.metric("標準誤差", f"{result.std_error:.6f}")
```

之後插入：

```python

    for warning in result.warnings:
        st.warning(warning)
```

`src/dndc/__main__.py`，在

```python
    print(f"RI peak ({result.peak_result.mode}) = {result.peak_result.value:.{dp}f}")
```

之後插入：

```python
    for warning in result.warnings:
        print(f"警告：{warning}", file=sys.stderr)
```

- [ ] **Step 9: 轉回 CRLF**

```bash
cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator"
for f in src/dndc/models.py src/dndc/calculator.py src/dndc/validation.py src/dndc/__main__.py src/dndc/web/pages/hplc_page.py src/dndc/web/pages/hplc_slice.py; do perl -pi -e 's/\r?\n/\r\n/' "$f"; done
file src/dndc/models.py src/dndc/calculator.py src/dndc/validation.py src/dndc/__main__.py src/dndc/web/pages/hplc_page.py src/dndc/web/pages/hplc_slice.py
git diff --stat
```

Expected: 全部 `with CRLF line terminators`；每個 src 檔只有少量行數變動。

- [ ] **Step 10: 跑全部測試**

Run: `cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator" && .venv_mac/bin/python -m pytest -q`
Expected: `342 passed`、0 xfailed（330＋test_calculator 新增 10 個參數化案例＋test_io_validation 2 個）。記下實際數字，Task 11 要寫進 CLAUDE.md。

- [ ] **Step 11: Commit（dndc repo）**

```bash
cd "/Users/hsutingwei/Desktop/TPS13A/dndc calculator"
git add src/dndc tests/test_calculator.py tests/test_io_validation.py
git commit -m "feat: warn on negative dn/dc, reject negative UV peaks, guard ri_factor <= 0 inside the compute functions"
```

---

### Task 9: 脂質體——SEM 與標準液對照的純函式（規格 §7.1–7.2）

**Files:**
- Modify: `saxs-calculator/js/liposome-calculations.js`（`DEFAULTS`、兩個新函式、匯出）
- Modify: `saxs-calculator/tests/liposome.test.js`

- [ ] **Step 1: 寫失敗測試**

在 `tests/liposome.test.js` 檔尾新增：

```js
// ---------------------------------------------------------------- 2026-10-14 待辦批次 §7
test('[lipo] standardErrorOfMean：SD/√n；n < 2、非整數或非有限 → null', () => {
    assert.equal(Liposome.standardErrorOfMean(0.03, 4), 0.015);
    assert.ok(Math.abs(Liposome.standardErrorOfMean(0.0132, 40) - 0.0132 / Math.sqrt(40)) < 1e-15);
    assert.equal(Liposome.standardErrorOfMean(0.03, 1), null);
    assert.equal(Liposome.standardErrorOfMean(0.03, 2.5), null);
    assert.equal(Liposome.standardErrorOfMean(NaN, 10), null);
});

test('[lipo] compareWithStandard：k × c_pure 對 ε 法 [DOX]；差 > 10% 才警告；k < 0 或濃度非正不比較', () => {
    // 同基準：純 DOX 在 495 nm 的 A = 1、ε 9250、光徑 0.2 cm → c_pure = 1/1850 M 時兩法一致
    const same = Liposome.compareWithStandard({ k: 0.8, pureConcMolar: 1 / 1850, doxConcMolar: 0.8 / 1850 });
    assert.ok(Math.abs(same.relDiff) < 1e-12);
    assert.equal(same.exceedsWarn, false);
    assert.ok(Object.isFrozen(same));

    const high = Liposome.compareWithStandard({ k: 0.8, pureConcMolar: 7e-4, doxConcMolar: 0.8 / 1850 });
    assert.ok(Math.abs(high.doxConcStd - 5.6e-4) < 1e-15);
    assert.ok(Math.abs(high.relDiff - (5.6e-4 / (0.8 / 1850) - 1)) < 1e-12);
    assert.equal(high.exceedsWarn, true);

    assert.equal(Liposome.compareWithStandard({ k: 1, pureConcMolar: 1.09e-3, doxConcMolar: 1e-3 }).exceedsWarn, false);
    assert.equal(Liposome.compareWithStandard({ k: 1, pureConcMolar: 0.89e-3, doxConcMolar: 1e-3 }).exceedsWarn, true);

    assert.equal(Liposome.compareWithStandard({ k: -0.1, pureConcMolar: 1e-3, doxConcMolar: 1e-3 }), null);
    assert.equal(Liposome.compareWithStandard({ k: 1, pureConcMolar: 0, doxConcMolar: 1e-3 }), null);
    assert.equal(Liposome.compareWithStandard({ k: 1, pureConcMolar: NaN, doxConcMolar: 1e-3 }), null);
    assert.equal(Liposome.compareWithStandard({ k: 1, pureConcMolar: 1e-3, doxConcMolar: 0 }), null);
    assert.equal(Liposome.DEFAULTS.STD_COMPARE_WARN_REL, 0.10);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/liposome.test.js`
Expected: FAIL（`Liposome.standardErrorOfMean is not a function`）。

- [ ] **Step 3: 實作**

在 `liposome-calculations.js` 的 `DEFAULTS`，把：

```js
        WINDOW_COVERAGE_WARN: 0.5,        // 有效點實際涵蓋的 q 範圍 < 視窗寬度的 50% → 提醒
    });
```

換成：

```js
        WINDOW_COVERAGE_WARN: 0.5,        // 有效點實際涵蓋的 q 範圍 < 視窗寬度的 50% → 提醒
        STD_COMPARE_WARN_REL: 0.10,       // 標準液法與 ε 法的 [DOX] 相差 > 10% → 提醒（2026-10-14 使用者定案）
    });
```

在 `global.LiposomeCalculations = Object.freeze({` 之前插入：

```js
    /**
     * 平均值的標準誤 SEM = SD / √n，只當對照顯示。相鄰 q 點的雜訊通常相關、比值也可能隨 q 漂移，
     * 兩者都會讓 SEM 低估真正的不確定度，所以 D/L 誤差仍用 SD（2026-10-14 使用者定案）。
     *
     * @param {number} sd - 樣本標準差
     * @param {number} n - 點數
     * @returns {number|null} n < 2、n 非整數或 sd 非有限時為 null
     */
    function standardErrorOfMean(sd, n) {
        if (!Number.isFinite(sd) || !Number.isInteger(n) || n < 2) return null;
        return sd / Math.sqrt(n);
    }

    /**
     * 純 DOX 標準液法的 [DOX] 對照：[DOX]_std = k × c_pure。
     * 與 computeDrugToLipid 的 [DOX] = A(主波長)/(ε·l) 同基準（扣背景後的比色槽光譜、不含稀釋修正），
     * 前提是標準液與樣品用同一光徑、且標準液在線性範圍內量測。
     *
     * @param {{k:number, pureConcMolar:number, doxConcMolar:number}} p - 濃度單位皆為 M
     * @returns {{doxConcStd:number, relDiff:number, exceedsWarn:boolean}|null}
     *          k < 0、標準液濃度或主值 [DOX] 非正（或非有限）時為 null
     */
    function compareWithStandard({ k, pureConcMolar, doxConcMolar }) {
        if (!(Number.isFinite(k) && k >= 0)) return null;
        if (!(Number.isFinite(pureConcMolar) && pureConcMolar > 0)) return null;
        if (!(Number.isFinite(doxConcMolar) && doxConcMolar > 0)) return null;
        const doxConcStd = k * pureConcMolar;
        const relDiff = doxConcStd / doxConcMolar - 1;
        return Object.freeze({
            doxConcStd,
            relDiff,
            exceedsWarn: Math.abs(relDiff) > DEFAULTS.STD_COMPARE_WARN_REL,
        });
    }

```

匯出區塊把：

```js
        fitPureDoxScale,
        computeDrugToLipid,
    });
```

換成：

```js
        fitPureDoxScale,
        computeDrugToLipid,
        standardErrorOfMean,
        compareWithStandard,
    });
```

- [ ] **Step 4: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`（173 pass）。

- [ ] **Step 5: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js/liposome-calculations.js saxs-calculator/tests/liposome.test.js
git commit -m "feat(liposome): SEM helper and pure-DOX standard comparison for [DOX]"
```

---

### Task 10: 脂質體——畫面（規格 §7.1–7.3）

**Files:**
- Modify: `saxs-calculator/index.html`（面板 2 新欄位、面板 3 對照容器）
- Modify: `saxs-calculator/js/section-liposome.js`
- Modify: `saxs-calculator/tests/liposome-section.test.js`

- [ ] **Step 1: 寫失敗測試**

`tests/liposome-section.test.js`：

1. 在 `const IDS = [` 清單最後的 `'lipoFitChart',` 之後加上 `'lipoPureConc', 'lipoStdCompare',`。
2. 在檔尾新增：

```js
// ---------------------------------------------------------------- S11／S12（2026-10-14 待辦批次 §7）
test('[lipo-section] S11 標準液對照：同基準差 0%；> 10% 加警告；改濃度不作廢快照；手動吸光度不顯示', async () => {
    const S = section();
    resetInputs();
    $('lipoPureConc').value = '';
    setSpectraFiles(syntheticSpectra(0.8), { pure: true });
    await click('lipoComputeSpectra');
    input('lipoDilutionFactor', '0.45');
    await click('lipoComputeDl');
    assert.equal($('lipoStdCompare').hidden, true, '沒填標準液濃度 → 不顯示');

    // 合成純 DOX 在 495 nm 的 A = 1；ε 9250、光徑 0.2 cm → c_pure = 1/1850 M = 0.54054 mM 時兩法一致
    input('lipoPureConc', '0.54054');
    assert.equal($('lipoStdCompare').hidden, false);
    assert.match($('lipoStdCompare').innerHTML, /標準液法對照/);
    assert.doesNotMatch($('lipoStdCompare').innerHTML, /alert-warning/);
    assert.ok(S.getState().dl, '改標準液濃度不作廢快照');
    assert.equal($('lipoAddResult').disabled, false, '改標準液濃度不停用加入鈕');

    input('lipoPureConc', '0.7');   // 0.8 × 0.7 mM = 0.56 mM vs ε 法 0.4324 mM → +29.50%
    assert.match($('lipoStdCompare').innerHTML, /\+29\.50%/);
    assert.match($('lipoStdCompare').innerHTML, /alert-warning/);

    setManualAbs(0.8, 0.8, 0.8);
    await click('lipoComputeDl');
    assert.equal($('lipoStdCompare').hidden, true, '手動吸光度 → 不顯示對照');
    $('lipoPureConc').value = '';
});

test('[lipo-section] S12 面板 1 顯示 SEM 對照（n 與 SD 同一行）', async () => {
    section();
    resetInputs();
    setSaxsFiles(fileOf('solution.dat', saxsText(1)), fileOf('bypass.dat', saxsText(0.44)));
    await click('lipoComputeDilution');
    assert.match($('lipoDilutionResults').innerHTML, /SEM \d+\.\d{2}%（僅供對照，D\/L 誤差用 SD）/);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/liposome-section.test.js`
Expected: S11、S12 失敗（`lipoStdCompare` 永遠 hidden／沒有 SEM 字樣）；其他通過。

- [ ] **Step 3: index.html**

在面板 2，緊接在含 `id="lipoPureFile"` 的那個 `<div class="form-group">…</div>` 之後插入：

```html
                                <div class="form-group">
                                    <label class="form-label" for="lipoPureConc">純 DOX 標準液濃度（選填，對照用）</label>
                                    <div class="form-input-group">
                                        <input type="number" class="form-input" id="lipoPureConc" min="0" step="0.001" placeholder="例如 0.05">
                                        <span class="input-unit">mM</span>
                                    </div>
                                    <div class="stat-sub">標準液與樣品須用同一光徑，且在線性範圍內量測（建議 A &lt; 1.5）。Excel 工作表2 的 4.6 mM 光譜 A(495) = 7.25，已飽和，不能用。</div>
                                </div>
```

在面板 3，把：

```html
                                <div id="lipoDlResults" class="mt-sm"></div>
```

換成：

```html
                                <div id="lipoDlResults" class="mt-sm"></div>
                                <div id="lipoStdCompare" class="mt-sm" aria-live="polite" hidden></div>
```

- [ ] **Step 4: section-liposome.js——元素與綁定**

在 `ELEMENT_IDS` 裡，把：

```js
        sampleName: 'lipoSampleName', computeDl: 'lipoComputeDl', dlResults: 'lipoDlResults', addResult: 'lipoAddResult',
    });
```

換成：

```js
        sampleName: 'lipoSampleName', computeDl: 'lipoComputeDl', dlResults: 'lipoDlResults', addResult: 'lipoAddResult',
        pureConc: 'lipoPureConc', stdCompare: 'lipoStdCompare',
    });
```

在 `bind()` 裡，把：

```js
        INVALIDATING_IDS.forEach(id => $(id)?.addEventListener('input', invalidateDl));
```

換成：

```js
        INVALIDATING_IDS.forEach(id => $(id)?.addEventListener('input', invalidateDl));
        // 標準液濃度不影響 D/L：不作廢快照，只即時更新對照那一行（規格 §7.2）
        els.pureConc.addEventListener('input', updateStdCompare);
```

- [ ] **Step 5: section-liposome.js——作廢時隱藏對照**

把：

```js
    function invalidateDl() {
        if (state.dl) setState({ dl: null });
        setAddEnabled(false);
    }
```

換成：

```js
    function invalidateDl() {
        if (state.dl) setState({ dl: null });
        setAddEnabled(false);
        updateStdCompare();
    }
```

- [ ] **Step 6: section-liposome.js——面板 1 的 SEM**

在 `renderDilutionResults` 裡，把：

```js
        const excluded = r.excluded.outOfRange + r.excluded.nonPositive;
```

換成：

```js
        const excluded = r.excluded.outOfRange + r.excluded.nonPositive;
        const sem = Calc().standardErrorOfMean(r.sd, r.n);
        const semText = sem === null ? '' : `；SEM ${pct(sem / r.factor)}（僅供對照，D/L 誤差用 SD）`;
```

並把同一函式裡：

```js
，n = ${r.n}，相對離散 ${pct(r.sd / r.factor)}</div>
```

換成：

```js
，n = ${r.n}，相對離散 ${pct(r.sd / r.factor)}${semText}</div>
```

- [ ] **Step 7: section-liposome.js——對照值**

在 `renderDlResults` 的 `global.A11y.focusResults('lipoDlResults');` 之後（同一函式內）加一行：

```js
        updateStdCompare();
```

在 `renderDlResults` 函式結束之後插入：

```js
    /**
     * 標準液法 [DOX] 對照（面板 3 結果下方）。只改這一行，不重繪結果、不搬焦點（打字中呼叫也安全）。
     * 不顯示的情況：沒有 D/L 快照、沒有純 DOX 擬合、吸光度是手動輸入的、濃度未填或非正、k < 0。
     */
    function updateStdCompare() {
        const el = els.stdCompare;
        if (!el) return;
        const snap = state.dl;
        const fit = state.spectra && state.spectra.fit;
        const pureMM = parseFloat(els.pureConc ? els.pureConc.value : '');
        const cmp = (snap && fit && snap.params.absSource !== 'manual')
            ? Calc().compareWithStandard({ k: fit.k, pureConcMolar: pureMM / 1000, doxConcMolar: snap.doxConc })
            : null;
        if (!cmp) {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }
        const sign = cmp.relDiff >= 0 ? '+' : '−';
        const line = `標準液法對照：[DOX] = ${(cmp.doxConcStd * 1000).toPrecision(4)} mM（與 ε 法相差 ${sign}${pct(Math.abs(cmp.relDiff))}）`;
        const limit = (Calc().DEFAULTS.STD_COMPARE_WARN_REL * 100).toFixed(0);
        const warn = cmp.exceedsWarn
            ? warningRow(`標準液法與 ε 法的 [DOX] 相差超過 ${limit}%，請檢查 ε、光徑或標準液濃度`)
            : '';
        el.innerHTML = `<div class="stat-sub">${esc(line)}</div>${warn}`;
        el.hidden = false;
    }
```

- [ ] **Step 8: 跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
Expected: `# fail 0`（175 pass）。S0（缺元素）與 S10（十個作廢欄位）照舊通過。

- [ ] **Step 9: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/index.html saxs-calculator/js/section-liposome.js saxs-calculator/tests/liposome-section.test.js
git commit -m "feat(liposome): SEM next to the dilution spread and a pure-DOX standard cross-check for [DOX]"
```

---

### Task 11: 文件（規格 §7.1、§7.2、§8.3）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-liposome-dox-loading-design.md`（§10 表格）
- Modify: `CLAUDE.md`（「驗證」段）

- [ ] **Step 1: 脂質體規格 §10 加兩列**

在 `| 工作表2 與 DL!D10 | 不使用 | …` 那一列之後加：

```markdown
| 稀釋因子誤差（2026-10-14） | 主值 SD；面板 1 另顯示 SEM，僅供對照 | 相鄰 q 點的雜訊通常相關、比值也可能隨 q 漂移，兩者都會讓 SEM 低估；使用者定案 |
| 純 DOX 標準液對照（2026-10-14） | k × c_pure 得 [DOX] 只當對照，與 ε 法差 > 10% 提醒；吸光度手動輸入時不顯示 | 繞過 ε 與光徑兩大系統誤差的獨立檢查；主值仍用 ε 法（使用者定案） |
```

- [ ] **Step 2: CLAUDE.md**

在「### 驗證」段：

1. 把 `（py3.9 venv；基準 2026-08-21：194 passed / 27 xfailed / 0 failed）` 換成 `（py3.9 venv；基準 2026-10-14：<Task 8 Step 10 的實際數字> passed / 0 xfailed / 0 failed）`。
2. 在該段最後加一條：

```markdown
- 改 saxs-calculator 後 bump 版本：側欄 footer 的 `Version X.Y` 與 `index.html` 所有本地 `?v=` 一起改（`tests/structure.test.js` 會檢查兩者一致）
```

- [ ] **Step 3: Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add docs/superpowers/specs/2026-09-05-liposome-dox-loading-design.md CLAUDE.md
git commit -m "docs: record liposome SEM and standard-check decisions; pytest baseline and ?v= bump rule"
```

---

### Task 12: 審查（規格 §8.2）

- [ ] **Step 1: science-reviewer**

派 `science-reviewer` agent，提供：規格路徑、`git -C /Users/hsutingwei/Desktop/TPS13A diff 947bd9f..HEAD -- saxs-calculator/js` 與 `git -C "/Users/hsutingwei/Desktop/TPS13A/dndc calculator" diff HEAD~2..HEAD -- src`。請它檢查：
- fraction collector 的分段換算與 Excel `Fraction_collector_high_c` 的等價性與物理意義（規格 §5.2）；
- 峰值符號與負 dn/dc 警告、負 UV 拒絕在 Python 與 JS 是否一致（規格 §6）；
- `compareWithStandard` 與 `computeDrugToLipid` 的 [DOX] 是否同一基準、單位換算是否正確（規格 §7.2）。

- [ ] **Step 2: code-reviewer**

派 `code-reviewer` agent 審同樣兩段 diff，加上 `saxs-calculator/tests` 與 `dndc calculator/tests` 的變更。重點：拆檔確為純搬移、CSP／`escapeHtml`、不可變、CRLF、測試是否真的驗證行為。

- [ ] **Step 3: 修正**

所有 Critical／Important 都修完、重跑兩套測試全過，各自 commit（訊息 `fix: address review — …`）。

---

### Task 13: 瀏覽器驗收、bump v4.15、上線（規格 §8.1、§8.3）

> 這個任務由主 session 執行（需要 Chrome 工具）。

- [ ] **Step 1: 起本機伺服器**

```bash
cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator && python3 -m http.server 8765
```

（背景執行；開 `http://localhost:8765/index.html`）

- [ ] **Step 2: 逐項驗收（Chrome，分頁要在前景）**

- console 沒有任何錯誤（特別注意拆檔後的 `ReferenceError`）。
- HPLC-SAXS 頁：峰中心 10.937、FWHM 1、注射 100 μL、目標 0.20、初始 0.35 → Start 12.53、Stop 21.79、報告結束時間 26；目標＝初始＝0.35 → 10.28／19.72／24。
- 脂質體頁：用 `tests/fixtures-local/liposome/` 或合成資料跑完三個面板；面板 1 看到 SEM 小字；上傳純 DOX 光譜並填標準液濃度後，面板 3 下方出現對照行；改標準液濃度時「加入結果表」不會被停用。
- dn/dc 頁（解鎖後）：正常資料的 dn/dc 與上線版 v4.14 相同；把 RI 欄位乘以 −1 的資料（或在 console 用 `DndcCalculations.computeHplcDndc` 驗證）看到負值與警告條。
- 其他頁（蛋白質、SAXS、樣品、分子量、離心、偵測器、IUCr）各按一次計算，沒有錯誤。

- [ ] **Step 3: bump 版本到 v4.15**

```bash
cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator
sed -i '' -e 's/Version 4\.14/Version 4.15/' -e 's/?v=4\.14"/?v=4.15"/g' index.html
grep -c '?v=4.15"' index.html
cd .. && node --test saxs-calculator/tests/*.test.js
```

Expected: `48`（43 個 script＋5 個 stylesheet）；測試 `# fail 0`。

- [ ] **Step 4: Commit 並 push**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/index.html
git commit -m "chore: v4.15"
git push origin main
```

- [ ] **Step 5: 確認 Pages 上線**

```bash
gh run list --limit 1
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')"
URL=$(gh api repos/TWAWEI/TPS13A-SAXS-Calculator/pages --jq .html_url)
curl -s "${URL}" | grep -o 'Version 4\.[0-9]*' ; curl -s "${URL}saxs-calculator/index.html" | grep -o 'Version 4\.[0-9]*'
```

Expected: 部署 `completed success`，其中一個網址回 `Version 4.15`（Pages 的根目錄依 deploy.yml 的上傳路徑而定）。

- [ ] **Step 6: 更新記憶（主 session）**

- `review_findings_2026_08_21.md`：剩餘清單中已完成的項目（拆檔、`?v=`、fraction collector、三個 xfail）標成完成，記下上線 commit 與 v4.15。
- `feedback_version_bump.md`：版本號位置改成「側欄 footer，約 135 行；同時改所有 `?v=`」。
- `project_liposome_dl.md`：兩個定案已上線。
