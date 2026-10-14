# 結果磚（v5.2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把各頁的計算結果改成「主角大數字磚＋次要數字磚＋唯讀列表」（改版規格 §7），所有數字、位數、單位、占位符一字不差。

**Architecture:** 新增純字串組裝模組 `js/result-tiles.js`（`window.ResultTiles`）與樣式 `css/tiles.css`。先把每頁「組結果 HTML」的程式抽成純函式（輸出與 v5.1 逐字相同），用 Node 擷取 v5.1 的「標籤｜數值」、提示框文字與所有數字存成 fixture；之後逐頁改寫純函式輸出磚，同一個測試保證數字不變。兩個靜態結果頁（HPLC-SAXS、偵測器）直接改 `index.html`，元素 id 不變。

**Tech Stack:** 無 build 的靜態站（classic `<script>` 共用全域）、`node --test`、Playwright（`/Users/hsutingwei/Projects/text-to-cad/.venv/bin/python`）。

**依據：** 改版規格 `docs/superpowers/specs/2026-10-14-apple-redesign-design.md` §7（結果磚）、§8.3（數值不變）、§13（v5.0 修訂）、§14（v5.1 → v5.2 重新編號）。本計畫的修訂寫在 Task 13 的規格 §15。

**現況（2026-10-15）：** 本機 `main` = `f747e85`（v5.1，分子量 kDa，尚未 push）。測試 233 個全過。

---

## 規格修訂（Task 13 寫進規格 §15，這裡先列出，實作照這裡做）

1. **不加 `aria-live`。** §7.1 要求結果容器加 `aria-live="polite"`，但 `js/a11y-utils.js` 的 `focusResults` 刻意在計算後**移除** live region 並把焦點移到結果（否則整張結果被朗讀兩次）。維持現行做法，`markup` fixture 不更新。
2. **磚的底色是 tertiary。** 結果都在卡片裡，§7.1 寫的 `--color-bg-card` 會白底疊白卡（§13 已定「卡片內的磚用 tertiary」）。
3. **輸入回顯放列表，不做磚。** SAXS 的波長、濃度、序列乾燥體積，分子量解析度的孔徑、流速等，放在磚下方的 `.result-list`。
4. **SAXS 主角沿用原標籤**（「MW from Porod」等本身就註明來源）。狀態膠囊寫 `✓／⚠️ ＋現有比值`，原本的「MW 比較」提示框保留（它列出全部比值與判讀文字）。
5. **Slice-by-slice 主角是「d*n*/d*c* (斜率)」。** §7.2 寫的「dn/dc 平均 ± SD」頁面上不存在。
6. **每頁一個主角。** dn/dc 理論頁的主角是「最終 d*n*/d*c*」；Lorentz-Lorenz 卡改為一般磚，`.result-value--key` 退役。樣品頁主角在濃度卡，稀釋因子卡沒有主角；脂質體頁主角是 D/L。
7. **蛋白質頁上方的 `#proteinStats` 統計列保留**（不在 §7 範圍）。
8. **單一磚可跨兩欄**：新增 `.tile--wide`（跨欄、不變色），用在只有一個磚的卡片（脂質體稀釋因子、光譜）與 HPLC 的 Time/Fraction。
9. **§8.3 的實作方式**：見 Task 2（純函式＋HTML 摘要比對），靜態頁由 Playwright 以元素 id 比對。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `saxs-calculator/js/result-tiles.js` | 新增 | `ResultTiles.tile／tiles／row／rows`：純字串組裝，不碰 DOM |
| `saxs-calculator/css/tiles.css` | 新增 | `.tiles`、`.tile`、`.tile--hero`、`.tile--wide`、`.tile-*`、`.result-list`、`.result-row*`、`.result-list-foot` |
| `saxs-calculator/tests/result-tiles.test.js` | 新增 | 模組單元測試 |
| `saxs-calculator/tests/result-pairs.js` | 新增 | 結果 HTML → `{pairs, alerts, numbers}` 摘要（測試工具，非測試檔） |
| `saxs-calculator/tests/result-golden.test.js` | 新增 | 數值不變測試 |
| `saxs-calculator/tests/fixtures/result-golden-v5.1.json` | 新增 | v5.1 擷取的摘要（Task 2 產生一次） |
| `saxs-calculator/js/section-{protein,saxs,sample,mw,centrifuge}.js` | 修改 | 抽出 `*ResultsHtml` 純函式，再改成磚 |
| `saxs-calculator/js/dndc-{theory-ui,hplc-results,multi-ui,slice-ui,ui}.js` | 修改 | 同上；`dndc-ui.js` 加 `dndcR2Grade` |
| `saxs-calculator/js/section-liposome.js` | 修改 | 三個結果純函式並匯出 `LiposomeSection.resultsHtml` |
| `saxs-calculator/index.html` | 修改 | 連結 `tiles.css`、載入 `result-tiles.js`；HPLC 與偵測器結果區改磚；版本 5.2 |
| `saxs-calculator/tests/load.js` | 修改 | `LOAD_ORDER` 加 `result-tiles.js`、匯出 `ResultTiles` |
| `saxs-calculator/tests/liposome-section.test.js` | 修改 | `stat-value` 斷言改 `tile-value` |
| `saxs-calculator/css/{tokens,panels,sections,components}.css` | 修改 | justify 名單加新類別；移除沒有引用的舊結果樣式 |
| `CLAUDE.md`、改版規格 | 修改 | Design Context、§15 |

**慣例（每個任務都適用）**
- 測試指令：在 `/Users/hsutingwei/Desktop/TPS13A` 執行 `node --test saxs-calculator/tests/*.test.js`（不要用目錄形式，Node 26 會失敗）。
- commit 訊息不加任何署名行。
- 進入 `innerHTML` 的使用者／檔案字串照舊經 `escapeHtml`／`escapeHtmlDndc`／`esc`；`ResultTiles` 的參數都是 HTML 片段，不再跳脫。
- 改 `index.html` 前先重新讀目標段落（檔案 98KB，分段讀）。

---

### Task 1：ResultTiles 模組與樣式

**Files:**
- Create: `saxs-calculator/js/result-tiles.js`, `saxs-calculator/css/tiles.css`, `saxs-calculator/tests/result-tiles.test.js`
- Modify: `saxs-calculator/index.html`（`<link>` 第 52 行之後、`<script>` mass-units 之後）, `saxs-calculator/tests/load.js`, `saxs-calculator/css/tokens.css:255-256`

- [ ] **Step 1：開分支**

```bash
cd /Users/hsutingwei/Desktop/TPS13A && git checkout -b feat/result-tiles-v5.2
```

- [ ] **Step 2：寫失敗的測試** `saxs-calculator/tests/result-tiles.test.js`

```js
'use strict';
/**
 * 結果磚組裝（v5.2，改版規格 §7.1）。ResultTiles 只組字串，參數都是 HTML 片段。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultTiles } = require('./load.js');

test('[tiles] tile：標籤在數值前，單位在數值框內', () => {
    const html = ResultTiles.tile({ label: '濃度', value: '1.2345', unit: 'mg/mL' });
    assert.equal(html,
        '<div class="tile"><div class="tile-label">濃度</div>'
        + '<div class="tile-value">1.2345<span class="tile-unit">mg/mL</span></div></div>');
});

test('[tiles] tile：沒有單位就不輸出單位元素', () => {
    assert.doesNotMatch(ResultTiles.tile({ label: 'R²', value: '0.999' }), /tile-unit/);
});

test('[tiles] tile：hero／wide 修飾、附註可多行、膠囊依語氣上色', () => {
    const html = ResultTiles.tile({
        label: 'MW', value: '66.50', unit: 'kDa', hero: true,
        sub: ['第一行', '', '第二行'], chip: { tone: 'ok', text: '✓ 比值 1.00' },
    });
    assert.match(html, /^<div class="tile tile--hero">/);
    assert.match(html, /<span class="tile-chip tile-chip--ok">✓ 比值 1.00<\/span>/);
    assert.equal((html.match(/class="tile-sub"/g) || []).length, 2, '空字串附註略過');
    assert.match(ResultTiles.tile({ label: 'x', value: '1', wide: true }), /^<div class="tile tile--wide">/);
    assert.match(ResultTiles.tile({ label: 'x', value: '1', sub: '單行' }), /<div class="tile-sub">單行<\/div>/);
});

test('[tiles] tile：未知的膠囊語氣直接丟錯（不靜默換色）', () => {
    assert.throws(() => ResultTiles.tile({ label: 'x', value: '1', chip: { tone: 'great', text: 'y' } }), /tone/);
});

test('[tiles] tiles：略過 false／空字串（條件式磚）', () => {
    const a = ResultTiles.tile({ label: 'a', value: '1' });
    assert.equal(ResultTiles.tiles([a, false, '', null]), `<div class="tiles">${a}</div>`);
});

test('[tiles] rows：唯讀列表；略過 false；空清單回空字串', () => {
    const html = ResultTiles.rows([
        { label: '光徑', value: 1, unit: 'cm' },
        false,
        { label: '名稱', value: 'BSA', note: '附註' },
    ]);
    assert.equal(html,
        '<div class="result-list">'
        + '<div class="result-row"><div class="result-row-label">光徑</div>'
        + '<div class="result-row-value">1<span class="tile-unit">cm</span></div></div>'
        + '<div class="result-row"><div class="result-row-label">名稱</div>'
        + '<div class="result-row-value">BSA</div><div class="result-row-note">附註</div></div>'
        + '</div>');
    assert.equal(ResultTiles.rows([false, null]), '');
});

test('[tiles] 數值 0 照常輸出（不被當成缺值）', () => {
    assert.match(ResultTiles.tile({ label: 'n', value: 0 }), /<div class="tile-value">0<\/div>/);
    assert.match(ResultTiles.row({ label: 'n', value: 0 }), /<div class="result-row-value">0<\/div>/);
});
```

- [ ] **Step 3：跑測試確認失敗**

Run: `node --test saxs-calculator/tests/result-tiles.test.js`
Expected: FAIL，`Cannot read properties of undefined (reading 'tile')`（`ResultTiles` 還不存在）。

- [ ] **Step 4：寫模組** `saxs-calculator/js/result-tiles.js`

```js
/**
 * TPS13A SAXS Calculator - 結果磚（v5.2，改版規格 §7）
 *
 * 純字串組裝，不碰 DOM（Node 測試也會載入）。參數都是 HTML 片段：數字由呼叫端格式化，
 * 來自使用者或檔案的字串由呼叫端先跳脫（escapeHtml／escapeHtmlDndc，與 v5.1 的模板相同）。
 *
 *   ResultTiles.tiles([
 *       ResultTiles.tile({ label: '濃度', value: '1.2345', unit: 'mg/mL', hero: true }),
 *       hasUv && ResultTiles.tile({ label: 'On-column 濃度', value: '0.4400', unit: 'mg/mL' }),
 *   ]) + ResultTiles.rows([{ label: '光徑', value: 1, unit: 'cm' }])
 *
 * 版面：.tiles 兩欄（≤640px 一欄）；主角 .tile--hero 跨兩欄、放大、珊瑚色；.tile--wide 只跨欄。
 * 次要數值放 .result-list（分組列表樣式的唯讀列）。樣式在 css/tiles.css。
 */
(function attachResultTiles(global) {
    'use strict';

    const CHIP_TONES = Object.freeze(['ok', 'warn', 'error']);

    const unitHtml = unit => (unit ? `<span class="tile-unit">${unit}</span>` : '');

    /** 附註可傳字串或陣列；空字串略過 */
    function notesHtml(notes, className) {
        return [].concat(notes || [])
            .filter(note => note !== '' && note !== null && note !== undefined)
            .map(note => `<div class="${className}">${note}</div>`)
            .join('');
    }

    function chipHtml(chip) {
        if (!chip) return '';
        if (!CHIP_TONES.includes(chip.tone)) {
            throw new Error(`ResultTiles: chip tone 必須是 ${CHIP_TONES.join('／')}，收到 ${chip.tone}`);
        }
        return `<span class="tile-chip tile-chip--${chip.tone}">${chip.text}</span>`;
    }

    /**
     * 一個磚。
     *
     * @param {{label: string, value: (string|number), unit?: string, sub?: (string|string[]),
     *          hero?: boolean, wide?: boolean, chip?: {tone: string, text: string}}} spec
     * @returns {string} HTML 片段
     */
    function tile({ label, value, unit = '', sub = [], hero = false, wide = false, chip = null }) {
        const modifier = hero ? ' tile--hero' : wide ? ' tile--wide' : '';
        return `<div class="tile${modifier}"><div class="tile-label">${label}</div>`
            + `<div class="tile-value">${value}${unitHtml(unit)}</div>`
            + chipHtml(chip)
            + notesHtml(sub, 'tile-sub')
            + '</div>';
    }

    /** 磚的格線；false／null／空字串（條件式磚）略過 */
    function tiles(items) {
        return `<div class="tiles">${items.filter(Boolean).join('')}</div>`;
    }

    /**
     * 唯讀列表的一列。
     *
     * @param {{label: string, value: (string|number), unit?: string, note?: (string|string[])}} spec
     * @returns {string} HTML 片段
     */
    function row({ label, value, unit = '', note = [] }) {
        return `<div class="result-row"><div class="result-row-label">${label}</div>`
            + `<div class="result-row-value">${value}${unitHtml(unit)}</div>`
            + notesHtml(note, 'result-row-note')
            + '</div>';
    }

    /** 唯讀列表；false／null 略過，全部略過時回空字串 */
    function rows(items) {
        const present = items.filter(Boolean);
        return present.length ? `<div class="result-list">${present.map(row).join('')}</div>` : '';
    }

    global.ResultTiles = Object.freeze({ tile, tiles, row, rows });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5：註冊模組**

`saxs-calculator/tests/load.js`：`LOAD_ORDER` 在 `'mass-units.js',` 之後加一行，匯出物件加 `ResultTiles`：

```js
    'mass-units.js',               // 頂層只定義常數與函式（不碰 document）
    'result-tiles.js',             // 純字串組裝（不碰 document）
```

```js
    MassUnits: window.MassUnits,
    ResultTiles: window.ResultTiles,
```

`saxs-calculator/index.html`：在 `<script src="js/mass-units.js?v=5.1"></script>` 下一行加

```html
    <script src="js/result-tiles.js?v=5.1"></script>
```

- [ ] **Step 6：跑測試確認通過**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: 全過（233 → 240）。`[structure]` 的載入順序測試也要過。

- [ ] **Step 7：寫樣式** `saxs-calculator/css/tiles.css`

```css
/* ===== 結果磚（v5.2，改版規格 §7；組裝在 js/result-tiles.js） =====
   主角 .tile--hero 跨兩欄、46px、珊瑚字；一般磚 32px；次要數值放 .result-list 唯讀列表。
   磚都在卡片裡，底色用 tertiary（白底疊白卡看不出邊界）。字級以 html 17px 換算成 rem。 */
.tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: var(--spacing-md);
}

.tile {
    min-width: 0;
    padding: 14px 16px;
    border-radius: var(--radius-xl);
    background: var(--color-bg-tertiary);
}

.tile--hero,
.tile--wide {
    grid-column: 1 / -1;
}

.tile-label {
    margin-bottom: 0.125rem;
    font-size: 0.75rem;            /* ≈12.75px */
    font-weight: 600;
    color: var(--color-text-muted);
}

.tile-value {
    font-size: 1.875rem;           /* ≈32px */
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;       /* 長的科學記號在窄欄裡換行，不撐破磚 */
}

.tile--hero .tile-value {
    font-size: 2.75rem;            /* ≈46px */
    color: var(--color-accent-text);
}

/* 單位在 .tile-value 裡：用 rem，才不會跟著數值放大 */
.tile-unit {
    margin-left: 0.25em;
    font-size: 0.8125rem;          /* ≈14px */
    font-weight: 400;
    letter-spacing: 0;
    color: var(--color-text-muted);
}

.tile-sub {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--color-text-muted);
}

.tile-chip {
    display: inline-block;
    margin-top: var(--spacing-xs);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.75rem;
    font-weight: 600;
}

/* display:inline-block 會蓋掉瀏覽器預設的 [hidden]{display:none}（偵測器頁的「超出行程」） */
.tile-chip[hidden] {
    display: none;
}

.tile-chip--ok {
    background: var(--color-success-bg);
    color: var(--color-success-text);
}

.tile-chip--warn {
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
}

.tile-chip--error {
    background: var(--color-danger-bg);
    color: var(--color-danger-text);
}

@media (max-width: 640px) {
    .tiles {
        grid-template-columns: minmax(0, 1fr);
    }
}

/* ===== 次要數值：分組列表樣式的唯讀列（分隔線與 .form-list 同一套） ===== */
.result-list {
    margin-bottom: var(--spacing-md);
    padding-left: 14px;
    border: 1px solid var(--color-separator);
    border-radius: var(--radius-lg);
}

.result-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--spacing-md);
    row-gap: 2px;
    padding: 9px 14px 9px 0;
}

.result-row + .result-row {
    border-top: 1px solid var(--color-separator);
}

.result-row-label {
    flex: 1 1 8rem;
    min-width: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
}

.result-row-value {
    margin-left: auto;
    font-size: 0.875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--color-text-primary);
}

.result-row-value .tile-unit {
    font-size: 0.75rem;
}

.result-row-note {
    flex: 1 0 100%;
    font-size: 0.6875rem;
    line-height: 1.4;
    color: var(--color-text-muted);
}

/* 列表下方的一段說明（脂質體光譜擬合） */
.result-list-foot {
    margin: calc(-1 * var(--spacing-sm)) 0 var(--spacing-md);
    padding: 0 14px;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--color-text-muted);
}
```

- [ ] **Step 8：連結樣式、加入 justify 名單**

`index.html` 在 `<link rel="stylesheet" href="css/components.css?v=5.1">` 下一行加

```html
    <link rel="stylesheet" href="css/tiles.css?v=5.1">
```

`css/tokens.css` 的 `:where(...)` 名單（第 255–256 行）改成

```css
:where(p, li, dd, blockquote, .alert, .modal-desc, .form-list-foot,
       .stat-sub, .quick-ref-body, .info-panel-formula, .info-panel-hint, .result-note,
       .tile-sub, .result-row-note, .result-list-foot) {
```

- [ ] **Step 9：跑測試**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: 全過。`no-color-literals`、`token-usage`（`color:` 只用文字 token）、`contrast`（`--color-accent-text`、各 `-text` 對 tertiary／各自 `-bg` 已在矩陣內）都要過；`[structure]` 確認 `tiles.css` 已被引用且帶 `?v=`。

- [ ] **Step 10：Commit**

```bash
git add saxs-calculator/js/result-tiles.js saxs-calculator/css/tiles.css saxs-calculator/tests/result-tiles.test.js saxs-calculator/tests/load.js saxs-calculator/index.html saxs-calculator/css/tokens.css
git commit -m "feat: ResultTiles module and tile styles (v5.2 groundwork)"
```

---

### Task 2：數值不變測試（抽純函式、擷取 v5.1 fixture）

這個任務**不改任何輸出**：只把組結果 HTML 的模板搬進純函式，顯示函式改成呼叫它。搬完用瀏覽器確認與 v5.1 逐字相同，再擷取 fixture。

**Files:**
- Create: `saxs-calculator/tests/result-pairs.js`, `saxs-calculator/tests/result-golden.test.js`, `saxs-calculator/tests/fixtures/result-golden-v5.1.json`
- Modify: `js/section-protein.js:112-192`, `js/section-saxs.js:255-387`, `js/section-sample.js:69-151`, `js/section-mw.js:92-180`, `js/section-centrifuge.js:65-115`, `js/dndc-theory-ui.js:30-58,91-102`, `js/dndc-hplc-results.js:81-123`, `js/dndc-multi-ui.js:103-179`, `js/dndc-slice-ui.js:53-125`, `js/section-liposome.js:159-177,368-389,558`

- [ ] **Step 1：抽純函式（逐字搬移）**

每一項都是：把 `xxx.innerHTML = \`…\`;` 的整段模板（含模板前面只為模板服務的區域變數）逐字搬進新函式的 `return \`…\`;`，顯示函式改成 `xxx.innerHTML = 新函式(...)`，其餘（焦點、圖表、狀態）不動。

| 檔案 | 新函式（放在原顯示函式正上方） | 搬進去的內容 | 原顯示函式改成 |
|---|---|---|---|
| `section-protein.js` | `function proteinResultsHtml(result, name)` | 第 115–192 行的模板 | `resultsDiv.innerHTML = proteinResultsHtml(result, name);` |
| `section-saxs.js` | `function saxsResultsHtml(data, protein)` | 第 258–387 行：`proteinMw`／`dryVolume` 改成 `const proteinMw = protein?.molecularWeight; const dryVolume = protein?.dryVolume;`，`mwFromI0Guinier`／`mwFromI0Pr`／`mwAlertHtml` 的計算與模板全部搬入 | `resultsDiv.innerHTML = saxsResultsHtml(data, AppState.proteinData);` |
| `section-sample.js` | `function sampleResultsHtml(data)`、`function dilutionFactorResultsHtml(data)` | 第 72–104 行；第 112–147 行（含 `onColumnConc` 計算） | `resultsDiv.innerHTML = sampleResultsHtml(data);`／`resultsDiv.innerHTML = dilutionFactorResultsHtml(data);` |
| `section-mw.js` | `function mwResultsHtml(data, proteinMw)` | 第 96–177 行（`if (data.mode === 'forward') {…} else {…}` 兩支，各自 `return` 模板） | `resultsDiv.innerHTML = mwResultsHtml(data, AppState.proteinData?.molecularWeight);` |
| `section-centrifuge.js` | `function centrifugeResultsHtml(data)` | 第 68–111 行 | `resultsDiv.innerHTML = centrifugeResultsHtml(data);` |
| `dndc-theory-ui.js` | 檔尾加 `function dndcCorrectionResultsHtml(result)`、`function llResultsHtml(llResult, gdResult)` | 第 30–58 行、第 91–102 行的模板 | `document.getElementById('dndcCorrectionResults').innerHTML = dndcCorrectionResultsHtml(result);`／`document.getElementById('llResults').innerHTML = llResultsHtml(llResult, gdResult);` |
| `dndc-hplc-results.js` | `function hplcDndcResultsHtml(result, params, warnings = [])` | 第 83–120 行（`alignment`、`riUnit`、`concLabel`、`concUnit` 與模板） | `resultsDiv.innerHTML = hplcDndcResultsHtml(result, params, warnings);` |
| `dndc-multi-ui.js` | `function multiFitResultsHtml(result, meta, pointCount, signWarnings)` | `r2Quality`／`r2Class` 的 6 行**複製**一份進來（顯示函式的那份留著給 `describeChart`），模板第 124–157 行，模板裡的 `${xData.length}` 改成 `${pointCount}` | `resultsDiv.innerHTML = multiFitResultsHtml(result, meta, xData.length, signWarnings);`（`signWarnings` 仍在顯示函式裡算） |
| `dndc-slice-ui.js` | `function sliceResultsHtml(result, warnings = [])` | `const fit = result.fitResult; const rSquared = fit.rSquared;`、`r2Quality`／`r2Class` **複製**一份、第 75–104 行模板 | `resultsDiv.innerHTML = sliceResultsHtml(result, warnings);` |
| `section-liposome.js` | IIFE 內 `function dilutionResultsHtml(r, qMin, qMax)`、`function dlResultsHtml(snap)` | 第 160–175 行（`excluded`／`sem`／`semText` 與模板）、第 369–386 行（`p` 與模板） | `els.dilutionResults.innerHTML = dilutionResultsHtml(r, qMin, qMax);`／`els.dlResults.innerHTML = dlResultsHtml(snap);` |

`section-liposome.js` 第 558 行改成匯出三個純函式（`spectraResultsHtml` 原本就是純函式）：

```js
    global.LiposomeSection = Object.freeze({
        init,
        getState: () => state,
        // 純函式：結果區 HTML（tests/result-golden.test.js 用）
        resultsHtml: Object.freeze({ dilution: dilutionResultsHtml, spectra: spectraResultsHtml, dl: dlResultsHtml }),
    });
```

- [ ] **Step 2：瀏覽器確認輸出與 v5.1 逐字相同**

起兩個伺服器：v5.1 參照與工作目錄。

```bash
SP=/private/tmp/claude-501/-Users-hsutingwei-Desktop-TPS13A/d2e05709-51be-4ac3-8a6b-6172601ccf31/scratchpad
rm -rf $SP/v51 && mkdir $SP/v51 && (cd /Users/hsutingwei/Desktop/TPS13A && git archive f747e85 saxs-calculator) | tar -x -C $SP/v51
(cd $SP/v51/saxs-calculator && nohup python3 -m http.server 8793 --bind 127.0.0.1 >/dev/null 2>&1 &)
(cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator && nohup python3 -m http.server 8791 --bind 127.0.0.1 >/dev/null 2>&1 &)
```

把下面的腳本存成 `$SP/compare_results.py`（Task 14 也用它），執行 `…/python compare_results.py 8793 8791 exact`：

```python
"""同一組輸入下比對兩版的結果區。
exact：每個結果容器的文字逐字相同（Task 2 抽函式後用）。
numbers：每個結果容器的「數字多重集合」相同、所有有 id 的葉節點文字相同（Task 14 改磚後用）。
用法：.../python compare_results.py <舊版 port> <新版 port> exact|numbers
"""
import json, re, sys
from collections import Counter
from playwright.sync_api import sync_playwright

OLD, NEW, MODE = sys.argv[1], sys.argv[2], sys.argv[3]
SEQ = 'KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL'
NUM = re.compile(r'\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?', re.I)
CONTAINERS = ['proteinResults', 'saxsResults', 'hplcSaxsResults', 'sampleResults', 'dilutionFactorResults',
              'mwResults', 'centrifugeResults', 'detectorResults', 'dndcCorrectionResults', 'llResults', 'iucrTable']
SCRIPT = [
    ('protein', [('fill', '#proteinSequence', SEQ), ('click', '#analyzeProtein')]),
    ('saxs', [('fill', '#sampleConcentration', '2'), ('fill', '#i0Guinier', '0.0213'), ('fill', '#rgGuinier', '15.2'),
              ('fill', '#guinierQmax', '0.09'), ('fill', '#i0Pr', '0.0211'), ('fill', '#rgPr', '15.4'),
              ('fill', '#dmax', '48'), ('fill', '#porodVolume', '23000'), ('click', '#calculateSAXS')]),
    ('hplc', [('click', '#calculateHPLCSAXS')]),
    ('sample', [('fill', '#uvAbsorbance', '0.5'), ('click', '#calculateSample'),
                ('fill', '#dfInjectionVolume', '100'), ('click', '#calculateDilutionFactor')]),
    ('mw', [('click', '#calculateMW')]),
    ('centrifuge', [('click', '#calculateCentrifuge')]),
    ('detector', [('click', '#calculateDetectorBtn')]),
    ('dndc-theory', [('click', '#calculateDndcCorrection'), ('click', '#calculateLorentzLorenz')]),
    ('iucr', []),
]

def snapshot(port):
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_init_script("sessionStorage.setItem('dndcUnlocked','true')")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(f'http://127.0.0.1:{port}/index.html')
        page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_timeout(400)
        for section, actions in SCRIPT:
            page.evaluate(f"document.querySelector('.nav-item[data-section=\"{section}\"]').click()")
            page.wait_for_timeout(150)
            for kind, sel, *val in actions:
                if kind == 'fill': page.fill(sel, val[0])
                else: page.evaluate(f"document.querySelector('{sel}').click()"); page.wait_for_timeout(300)
        # 分子量解析度反算
        page.evaluate("document.querySelector('.nav-item[data-section=\"mw\"]').click()")
        page.fill('#retentionTimeInput', '12.5'); page.evaluate("document.querySelector('#calculateMWReverse').click()")
        page.wait_for_timeout(300)
        out['containers'] = page.evaluate("""ids => Object.fromEntries(ids.map(id => {
            const el = document.getElementById(id); return [id, el ? el.textContent.replace(/\\s+/g, ' ').trim() : null];
        }))""", CONTAINERS)
        out['leaves'] = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('main [id]')]
            .filter(el => el.children.length === 0 && !['INPUT','SELECT','TEXTAREA','BUTTON','CANVAS','OPTION'].includes(el.tagName))
            .map(el => [el.id, el.textContent.replace(/\\s+/g, ' ').trim()]))""")
        out['errors'] = errors
        b.close()
    return out

a, c = snapshot(OLD), snapshot(NEW)
problems = []
for cid in CONTAINERS:
    old, new = a['containers'][cid], c['containers'][cid]
    if MODE == 'exact':
        if old != new: problems.append({'container': cid, 'old': old, 'new': new})
    else:
        diff_old = Counter(NUM.findall(old or '')) - Counter(NUM.findall(new or ''))
        diff_new = Counter(NUM.findall(new or '')) - Counter(NUM.findall(old or ''))
        if diff_old or diff_new:
            problems.append({'container': cid, 'only_old': dict(diff_old), 'only_new': dict(diff_new)})
for key in sorted(set(a['leaves']) | set(c['leaves'])):
    if MODE == 'numbers' and a['leaves'].get(key) != c['leaves'].get(key) and key in a['leaves'] and key in c['leaves']:
        problems.append({'leaf': key, 'old': a['leaves'][key], 'new': c['leaves'][key]})
print('console errors:', a['errors'], c['errors'])
print(f'{len(problems)} 個差異')
print(json.dumps(problems, ensure_ascii=False, indent=1))
sys.exit(1 if problems or a['errors'] or c['errors'] else 0)
```

Expected: `0 個差異`，兩邊 console errors 都是 `[]`。

- [ ] **Step 3：寫 HTML 摘要工具** `saxs-calculator/tests/result-pairs.js`

```js
'use strict';
/**
 * 結果 HTML → 可比對的摘要（數值不變測試用，改版規格 §8.3）。不是測試檔。
 *
 * 只認自家模板的標記：標籤／數值兩類 class（v5.1 的 result-*／stat-*，v5.2 的 tile-*／result-row-*），
 * 以及 .alert 提示框。模板產生的 HTML 結構規整，用小型堆疊解析即可，不需要 DOM。
 *
 *   pairs   「標籤｜數值」，數值去掉所有空白（單位併在數值後：「69.29kDa」），排序
 *   alerts  每個 .alert 的文字，排序
 *   numbers 整段 HTML 文字裡的所有數字（含標籤、附註、提示框），排序
 */
const ROLE_BY_CLASS = Object.freeze({
    'result-label': 'label', 'stat-label': 'label', 'tile-label': 'label', 'result-row-label': 'label',
    'result-value': 'value', 'stat-value': 'value', 'tile-value': 'value', 'result-row-value': 'value',
    'alert': 'alert',
});
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr']);
const ENTITIES = Object.freeze({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'" });
const NUMBER = /\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/gi;

/** 去標籤、解實體、壓空白 */
function textOf(html) {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(?:lt|gt|amp|quot|#0?39);/g, entity => ENTITIES[entity])
        .replace(/\s+/g, ' ')
        .trim();
}

/** 依文件順序列出 { role, text } */
function fields(html) {
    const found = [];
    const stack = [];
    for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
        const [whole, closing, rawName, attrs] = match;
        const name = rawName.toLowerCase();
        if (closing) {
            const index = stack.map(entry => entry.name).lastIndexOf(name);
            if (index < 0) continue;
            const open = stack[index];
            stack.length = index;
            if (open.role) found.push({ at: open.at, role: open.role, text: textOf(html.slice(open.contentStart, match.index)) });
            continue;
        }
        if (VOID_TAGS.has(name) || attrs.trim().endsWith('/')) continue;
        const classes = ((attrs.match(/\bclass="([^"]*)"/) || [])[1] || '').split(/\s+/);
        const role = classes.map(c => ROLE_BY_CLASS[c]).find(Boolean) || null;
        stack.push({ name, role, at: match.index, contentStart: match.index + whole.length });
    }
    return found.sort((x, y) => x.at - y.at);
}

function summarize(html) {
    const list = fields(html);
    const pairs = [];
    let current = null;
    for (const field of list) {
        if (field.role === 'label') {
            current = { label: field.text, value: null };
            pairs.push(current);
        } else if (field.role === 'value' && current && current.value === null) {
            current.value = field.text.replace(/\s+/g, '');
        }
    }
    return {
        pairs: pairs.map(p => `${p.label}｜${p.value}`).sort(),
        alerts: list.filter(f => f.role === 'alert').map(f => f.text).sort(),
        numbers: (textOf(html).match(NUMBER) || []).sort(),
    };
}

module.exports = { summarize, textOf };
```

- [ ] **Step 4：寫數值不變測試** `saxs-calculator/tests/result-golden.test.js`

```js
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
```

注意：`saxs-guinier-hero-qrg-warning` 的 `extraNumbers` 有 `'0'`：膠囊文字「I(0) Guinier / 序列 = …」比 v5.1 多一個「(0)」。

- [ ] **Step 5：擷取 fixture 並檢查內容**

Run: `GOLDEN_UPDATE=1 node --test saxs-calculator/tests/result-golden.test.js`
然後 `node -e "const f=require('./saxs-calculator/tests/fixtures/result-golden-v5.1.json');for(const[k,v]of Object.entries(f))console.log(k,v.pairs.length,v.alerts.length,v.numbers.length)"`
Expected: 24 個案例，每個 `pairs` 都 > 0；`saxs-empty` 的 MW 值是 `-kDa`；`dilution-no-uv` 有 2 個 alerts。逐一看 `protein`、`saxs-porod-hero` 的 pairs，確認擷取到的是標籤與數值（不是空字串）。

- [ ] **Step 6：跑全部測試**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: 全過（含 25 個 `[golden]`）。

- [ ] **Step 7：Commit**

```bash
git add saxs-calculator/js saxs-calculator/tests/result-pairs.js saxs-calculator/tests/result-golden.test.js saxs-calculator/tests/fixtures/result-golden-v5.1.json
git commit -m "test: golden result values captured from v5.1 markup

Each page's result HTML now comes from a pure *ResultsHtml function (output
unchanged, verified against v5.1 in the browser). result-golden.test.js
summarises label/value pairs, alert text and every number, so the tile
rewrite cannot change a digit."
```

---

### Task 3：樣品計算頁

**Files:** Modify `saxs-calculator/js/section-sample.js`（`sampleResultsHtml`、`dilutionFactorResultsHtml`）

- [ ] **Step 1：改寫 `sampleResultsHtml`**

```js
function sampleResultsHtml(data) {
    const { tile, tiles, rows } = ResultTiles;
    return `
        ${tiles([
            tile({ label: '濃度', value: data.concentration.toFixed(4), unit: 'mg/mL', hero: true }),
            tile({ label: '濃度 (μM)', value: data.concentrationMolar.toFixed(2), unit: 'μM' }),
            tile({ label: '吸光值', value: data.absorbance, unit: 'AU' }),
        ])}

        <div class="section-divider"><span>輸入參數</span></div>

        ${rows([
            { label: '光徑', value: data.pathLength, unit: 'cm' },
            { label: '消光係數', value: data.epsilon.toLocaleString(), unit: 'M⁻¹ cm⁻¹' },
            { label: '分子量', value: MassUnits.formatKDa(data.mw), unit: 'kDa' },
        ])}
    `;
}
```

- [ ] **Step 2：改寫 `dilutionFactorResultsHtml`**

```js
function dilutionFactorResultsHtml(data) {
    const { tile, tiles, rows } = ResultTiles;
    const onColumnConc = (data.uvConcentration && data.uvConcentration > 0)
        ? (data.uvConcentration / data.dilutionFactor)
        : null;
    const hasOnColumn = onColumnConc !== null;

    return `
        ${tiles([
            tile({ label: '稀釋因子 (DF)', value: data.dilutionFactor.toFixed(2) }),
            hasOnColumn && tile({ label: 'On-column 濃度', value: onColumnConc.toFixed(4), unit: 'mg/mL' }),
        ])}
        ${rows([
            { label: '注射體積', value: data.injectedVolume, unit: 'μL' },
            hasOnColumn && { label: 'UV 量測濃度', value: data.uvConcentration.toFixed(4), unit: 'mg/mL' },
        ])}
        ${hasOnColumn ? '' : `
        <div class="alert alert-info" style="margin-top: 0.75rem;">
            先計算 UV 濃度，即可同時顯示 on-column 濃度估算
        </div>
        `}
        <div class="alert alert-warning" style="margin-top: 0.75rem;">
            <strong>注意：</strong>此為經驗公式估算，誤差約 ±7.33%
        </div>
    `;
}
```

- [ ] **Step 3：測試**

Run: `node --test saxs-calculator/tests/*.test.js`
Expected: 全過（`[golden] sample`、`dilution-*` 數字不變）。

- [ ] **Step 4：Commit** — `git commit -am "feat(tiles): sample page results as tiles"`

---

### Task 4：分子量解析度頁

**Files:** Modify `saxs-calculator/js/section-mw.js`（`mwResultsHtml`）

- [ ] **Step 1：改寫**（兩個提示框的內文與 v5.1 逐字相同）

```js
function mwResultsHtml(data, proteinMw) {
    const { tile, tiles, rows } = ResultTiles;
    const massResolutionTile = data.massResolution
        ? tile({ label: '質量解析度', value: `± ${MassUnits.formatKDa(data.massResolution)}`, unit: 'kDa' })
        : '';

    if (data.mode === 'forward') {
        // 從 MW 計算滯留時間
        const oligomerText = data.oligomer > 1 ? ` (${data.oligomer}mer)` : '';
        return `
            ${tiles([
                tile({ label: '預期滯留時間', value: data.retentionTime.toFixed(3), unit: 'min', hero: true }),
                massResolutionTile,
            ])}

            <div class="section-divider"><span>輸入參數</span></div>

            ${rows([
                { label: `實際分子量${oligomerText}`, value: MassUnits.formatKDa(data.mw), unit: 'kDa' },
                { label: '管柱孔徑', value: data.poreSize, unit: 'Å' },
                { label: '流速', value: data.flowRate, unit: 'mL/min' },
            ])}

            <div class="alert alert-success" style="margin-top: 1rem;">
                <strong>✓ 計算完成</strong><br>
                流速 ${data.flowRate} mL/min 條件下<br>
                分子量 ${MassUnits.formatKDa(data.mw)} kDa 預期在 <strong>${data.retentionTime.toFixed(3)} min</strong> 出峰
            </div>
        `;
    }

    // 反向計算：從滯留時間估算 MW
    return `
        ${tiles([
            tile({ label: '估算分子量', value: MassUnits.formatKDa(data.estimatedMw), unit: 'kDa', hero: true }),
            massResolutionTile,
        ])}

        <div class="section-divider"><span>輸入參數</span></div>

        ${rows([
            { label: '滯留時間', value: data.retentionTime.toFixed(3), unit: 'min' },
            { label: '管柱孔徑', value: data.poreSize, unit: 'Å' },
            { label: '流速', value: data.flowRate, unit: 'mL/min' },
        ])}

        ${proteinMw ? `
        <div class="alert ${Math.abs(data.estimatedMw - proteinMw) / proteinMw < 0.3 ? 'alert-success' : 'alert-warning'}" style="margin-top: 1rem;">
            <strong>與序列 MW 比較：</strong><br>
            序列 MW: ${MassUnits.formatKDa(proteinMw)} kDa<br>
            SEC MW: ${MassUnits.formatKDa(data.estimatedMw)} kDa<br>
            比值: ${(data.estimatedMw / proteinMw).toFixed(2)}
        </div>
        ` : ''}
    `;
}
```

- [ ] **Step 2：測試** — Run 全部測試，Expected: 全過。
- [ ] **Step 3：Commit** — `git commit -am "feat(tiles): MW resolution results as tiles"`

---

### Task 5：離心參數頁

**Files:** Modify `saxs-calculator/js/section-centrifuge.js`（`centrifugeResultsHtml`）

- [ ] **Step 1：改寫**（粒子半徑的說明從行內樣式 div 改成磚的附註）

```js
function centrifugeResultsHtml(data) {
    const { tile, tiles, rows } = ResultTiles;
    return `
        ${tiles([
            tile({ label: '相對離心力 (RCF)', value: data.rcf.toFixed(0), unit: '× g', hero: true }),
            tile({ label: '沉降係數', value: data.sedimentationCoeffSvedberg.toFixed(2), unit: 'S' }),
            tile({
                label: '估算粒子半徑', value: data.particleRadius.toFixed(2), unit: 'nm',
                sub: '無水球近似；實際沉降係數約為此值的 0.75–0.85 倍（水合與形狀因子）',
            }),
            tile({ label: '終端速度', value: (data.velocity * 1000).toFixed(4), unit: 'μm/s' }),
            tile({ label: `移動距離 (${data.time} min)`, value: data.distance.toFixed(4), unit: 'mm' }),
        ])}

        ${rows([
            { label: '浮力因子', value: data.buoyancyFactor.toFixed(4) },
        ])}

        <div class="alert alert-info" style="margin-top: 1rem;">
            <strong>公式：</strong>RCF = 1.118 × 10⁻⁵ × r × N² <br>
            其中 r = ${data.radius} cm, N = ${data.rpm} rpm
        </div>
    `;
}
```

- [ ] **Step 2：測試** — 全過。
- [ ] **Step 3：Commit** — `git commit -am "feat(tiles): centrifuge results as tiles"`

---

### Task 6：蛋白質分析頁

**Files:** Modify `saxs-calculator/js/section-protein.js`（`proteinResultsHtml`）

- [ ] **Step 1：改寫**（`MassUnits.formatDa(result.molecularWeight)` 照原樣寫，`tests/mass-units.test.js` 以這段文字確認 Da 精確值還在）

```js
function proteinResultsHtml(result, name) {
    const { tile, tiles, rows } = ResultTiles;
    return `
        ${tiles([
            tile({
                label: '分子量', value: MassUnits.formatKDa(result.molecularWeight), unit: 'kDa', hero: true,
                sub: `${MassUnits.formatDa(result.molecularWeight)} Da`,
            }),
            tile({ label: '<i>ε</i> (M⁻¹ cm⁻¹)', value: result.extinction.epsilon.toLocaleString() }),
            tile({ label: 'dn/dc', value: result.dndc.toFixed(4), unit: 'mL/g' }),
            tile({ label: '乾燥體積', value: result.dryVolume.toFixed(1), unit: 'Å³' }),
            tile({ label: '電子數', value: result.electronCount }),
        ])}

        <div class="section-divider"><span>序列與物理參數</span></div>

        ${rows([
            { label: '蛋白質名稱', value: escapeHtml(name) },
            { label: '序列長度', value: result.length, unit: '殘基' },
            {
                label: '<i>v̄</i> = <i>V</i><sub>dry</sub>/<i>M</i>', value: result.partialSpecificVolume.toFixed(4), unit: 'cm³/g',
                note: '晶體殘基體積推得，SAXS 對比用；非熱力學偏比容',
            },
        ])}

        <div class="section-divider"><span>消光係數 (280 nm)</span></div>

        ${rows([
            {
                label: '<i>ε</i><sub>mass</sub> (mL·mg⁻¹·cm⁻¹)', value: result.massExtinction.mlPerMgCm.toFixed(3),
                note: '= A280 (0.1%)，HPLC dn/dc 頁用',
            },
            {
                label: 'ASTRA 單位 (mL·g⁻¹·cm⁻¹)', value: result.massExtinction.mlPerGCm.toFixed(1),
                note: '.afe7 的 UV 消光係數欄位',
            },
            { label: 'Trp (W)', value: result.extinction.nTrp },
            { label: 'Tyr (Y)', value: result.extinction.nTyr },
            { label: 'Cys (C)', value: result.extinction.nCys },
            { label: '二硫鍵數', value: result.extinction.nDisulfide },
        ])}

        <div class="formula-note">
            <i>ε</i><sub>mass</sub> = <i>ε</i> / MW（MW 以 Da 代入；Pace 1995 序列估計；BSA 文獻實測 0.667）
        </div>
    `;
}
```

- [ ] **Step 2：測試** — 全過（含 `[mass] 蛋白質頁保留 Da 精確值`、`[golden] protein`）。
- [ ] **Step 3：Commit** — `git commit -am "feat(tiles): protein results with MW as the hero tile"`

---

### Task 7：SAXS 結構參數頁

**Files:** Modify `saxs-calculator/js/section-saxs.js`（`saxsResultsHtml`）

- [ ] **Step 1：改寫**

```js
/**
 * SAXS 結果。主角是「MW 比較」所用的 MW：依原順序取第一個有值的（Porod → I(0) Guinier → I(0) P(r)），
 * 沿用原標籤（本身就註明來源）；有序列 MW 時帶狀態膠囊（20% 門檻，與下方 MW 比較提示框一致）。
 *
 * @param {object} data - AppState.saxsData 的內容
 * @param {{molecularWeight: number, dryVolume: number}|null} protein - 序列分析結果
 * @returns {string} HTML
 */
function saxsResultsHtml(data, protein) {
    const { tile, tiles, rows } = ResultTiles;
    const proteinMw = protein?.molecularWeight;
    const dryVolume = protein?.dryVolume;

    let mwFromI0Guinier = null;
    let mwFromI0Pr = null;
    if (data.concentration > 0) {
        if (!isNaN(data.i0Guinier) && data.i0Guinier > 0) {
            mwFromI0Guinier = SAXSCalculations.calculateMwFromI0(data.i0Guinier, data.concentration);
        }
        if (!isNaN(data.i0Pr) && data.i0Pr > 0) {
            mwFromI0Pr = SAXSCalculations.calculateMwFromI0(data.i0Pr, data.concentration);
        }
    }

    const mwEstimates = [
        { label: 'MW from Porod', mw: data.mwFromPorod, ratioLabel: 'Porod / 序列' },
        { label: 'MW from <i>I</i>(0) Guinier', mw: mwFromI0Guinier, ratioLabel: 'I(0) Guinier / 序列' },
        { label: 'MW from <i>I</i>(0) <i>P</i>(<i>r</i>)', mw: mwFromI0Pr, ratioLabel: 'I(0) P(r) / 序列' },
    ];
    const hero = mwEstimates.find(item => item.mw) || null;
    const isClose = hero && proteinMw ? Math.abs(hero.mw - proteinMw) / proteinMw < 0.2 : false;

    // MW 比較提示框（與 v5.1 逐字相同）
    let mwAlertHtml = '';
    if (proteinMw) {
        const comparisons = mwEstimates
            .filter(item => item.mw)
            .map(item => `${item.ratioLabel} = ${(item.mw / proteinMw).toFixed(2)}`);
        if (comparisons.length > 0) {
            mwAlertHtml = `
            <div class="alert ${isClose ? 'alert-success' : 'alert-warning'}" style="margin-top: 1rem;">
                <strong>MW 比較：</strong>${comparisons.join(' | ')}
                <br>${isClose ? '✓ 符合預期 (單體)' : '⚠️ 可能有聚集或複合物形成'}
            </div>`;
        }
    }

    const heroChip = hero && proteinMw
        ? { tone: isClose ? 'ok' : 'warn', text: `${isClose ? '✓' : '⚠️'} ${hero.ratioLabel} = ${(hero.mw / proteinMw).toFixed(2)}` }
        : null;
    const mwTile = item => tile({ label: item.label, value: item.mw ? MassUnits.formatKDa(item.mw) : '-', unit: 'kDa' });

    const qRgAlert = (() => {
        if (!isNaN(data.guinierQmax) && !isNaN(data.rgGuinier) && data.guinierQmax > 0 && data.rgGuinier > 0) {
            const qRg = data.guinierQmax * data.rgGuinier;
            if (qRg > 1.3) {
                return `<div class="alert alert-warning" style="margin-top: 0.5rem;">
                        ⚠️ <i>q</i><sub>max</sub> × <i>R</i><sub>g</sub> = ${qRg.toFixed(2)} > 1.3 — Guinier 擬合可能不可靠，建議降低 <i>q</i><sub>max</sub>
                    </div>`;
            }
            return `<div class="alert alert-success" style="margin-top: 0.5rem;">
                    ✓ <i>q</i><sub>max</sub> × <i>R</i><sub>g</sub> = ${qRg.toFixed(2)} ≤ 1.3 — Guinier 擬合範圍有效
                </div>`;
        }
        return '';
    })();

    return `
        ${tiles([
            hero && tile({ label: hero.label, value: MassUnits.formatKDa(hero.mw), unit: 'kDa', hero: true, chip: heroChip }),
            tile({ label: '<i>R</i><sub>g</sub> from Guinier', value: isNaN(data.rgGuinier) ? '-' : data.rgGuinier.toFixed(2), unit: 'Å' }),
            tile({ label: '<i>I</i>(0) from Guinier', value: isNaN(data.i0Guinier) ? '-' : data.i0Guinier.toFixed(5), unit: 'cm⁻¹' }),
            tile({ label: '<i>R</i><sub>g</sub> from <i>P</i>(<i>r</i>)', value: isNaN(data.rgPr) ? '-' : data.rgPr.toFixed(2), unit: 'Å' }),
            tile({ label: '<i>I</i>(0) from <i>P</i>(<i>r</i>)', value: isNaN(data.i0Pr) ? '-' : data.i0Pr.toFixed(5), unit: 'cm⁻¹' }),
            tile({ label: '<i>D</i><sub>max</sub>', value: isNaN(data.dmax) ? '-' : data.dmax, unit: 'Å' }),
            tile({ label: 'Porod volume', value: isNaN(data.porodVolume) ? '-' : data.porodVolume.toLocaleString(), unit: 'Å³' }),
            tile({ label: 'MW from 序列', value: proteinMw ? MassUnits.formatKDa(proteinMw) : '-', unit: 'kDa' }),
            ...mwEstimates.filter(item => item !== hero).map(mwTile),
        ])}
        ${qRgAlert}

        <div class="section-divider"><span>輸入與序列</span></div>

        ${rows([
            { label: 'X 射線波長', value: data.wavelength.toFixed(5), unit: 'Å' },
            { label: '樣品濃度', value: data.concentration, unit: 'mg/mL' },
            { label: '乾燥體積 (序列)', value: dryVolume ? dryVolume.toFixed(1) : '-', unit: 'Å³' },
        ])}

        ${mwAlertHtml}
    `;
}
```

說明：v5.1 的 `isClose` 用 `data.mwFromPorod || mwFromI0Guinier || mwFromI0Pr` 判定，與 `hero.mw` 是同一個值；提示框只在 `comparisons.length > 0`（＝`hero` 存在）時出現，判定不變。

- [ ] **Step 2：測試** — 全過。`[golden] saxs-porod-hero` 與 `saxs-guinier-hero-qrg-warning` 的 `extraNumbers` 就是膠囊上的比值；若失敗訊息顯示多出別的數字，表示改寫漏了或多了欄位。
- [ ] **Step 3：Commit** — `git commit -am "feat(tiles): SAXS results with the compared MW as the hero tile"`

---

### Task 8：HPLC-SAXS 與偵測器頁（靜態結果區）

**Files:** Modify `saxs-calculator/index.html`（Fraction Collector 卡、Pre-run 建議值卡、`#detectorResults`）

先重新讀 `index.html` 第 600–660 行與第 1248–1282 行。所有 `id` 原樣保留（`tests/markup.test.js` 會檢查）。

- [ ] **Step 1：Fraction Collector 卡的 `card-body`**（取代三個 `.gradient-stat`）

```html
                        <div class="card-body">
                            <div class="tiles">
                                <div class="tile tile--hero">
                                    <div class="tile-label">Fraction 收集時段（Start → Stop）</div>
                                    <div class="tile-value"><span id="fractionStartTime">--</span> → <span id="fractionStopTime">--</span><span class="tile-unit">min</span></div>
                                </div>
                                <div class="tile tile--wide">
                                    <div class="tile-label">Time/Fraction</div>
                                    <div class="tile-value"><span id="timePerFraction">--</span><span class="tile-unit">min</span></div>
                                </div>
                            </div>
                        </div>
```

- [ ] **Step 2：Pre-run 建議值卡的 `#hplcSuggestedValues` 內容**（取代 `.suggested-values` 與三個 `.gradient-stat`）

```html
                    <div class="card-body" id="hplcSuggestedValues">
                        <div class="tiles">
                            <div class="tile">
                                <div class="tile-label">Suggested Peak Center</div>
                                <div class="tile-value"><span id="suggestPeakCenter">--</span><span class="tile-unit">min</span></div>
                            </div>
                            <div class="tile">
                                <div class="tile-label">Suggested Peak Width</div>
                                <div class="tile-value"><span id="suggestPeakWidth">--</span><span class="tile-unit">min</span></div>
                            </div>
                            <div class="tile tile--wide">
                                <div class="tile-label">Suggested Sample Volume</div>
                                <div class="tile-value"><span id="suggestSampleVolume">--</span><span class="tile-unit">μL</span></div>
                            </div>
                        </div>
                    </div>
```

- [ ] **Step 3：偵測器 `#detectorResults`**（主角移到最前面；徽章改成膠囊，`hidden` 仍由 `DetectorLimits.apply` 切換）

```html
                            <div id="detectorResults" class="mt-lg">
                                <div class="tiles">
                                    <!-- 9M SD（主角） -->
                                    <div class="tile tile--hero">
                                        <div class="tile-label">建議 9M 偵測器距離 (SD)</div>
                                        <div class="tile-value"><span id="detectorSDResult">1,900</span><span class="tile-unit">mm</span></div>
                                        <span class="tile-chip tile-chip--warn" id="detectorSDBadge" hidden>超出行程</span>
                                        <div class="tile-sub">(<span id="detectorSDMeters">1.9</span> m)</div>
                                    </div>

                                    <!-- MW Result (shown in Rg mode) -->
                                    <div id="mwResultCard" class="tile hidden">
                                        <div class="tile-label">預測 MW</div>
                                        <div class="tile-value"><span id="detectorMwResult">66.50</span><span class="tile-unit">kDa</span></div>
                                    </div>

                                    <!-- Rg Result (shown in MW mode) -->
                                    <div id="rgResultCard" class="tile">
                                        <div class="tile-label">理論 <i>R</i><sub>g</sub></div>
                                        <div class="tile-value"><span id="detectorRgResult">28.00</span><span class="tile-unit">Å</span></div>
                                    </div>

                                    <!-- qmin Result -->
                                    <div class="tile">
                                        <div class="tile-label"><i>q</i><sub>min</sub></div>
                                        <div class="tile-value"><span id="detectorQminResult">0.0080</span><span class="tile-unit">Å⁻¹</span></div>
                                    </div>
                                </div>
                            </div>
```

- [ ] **Step 4：確認 JS 只用 id 取這些元素**

Run: `grep -n "result-card\|gradient-stat\|suggested-values\|detector-result-grid\|info-panel-badge" saxs-calculator/js/*.js`
Expected: 沒有 `result-card`／`gradient-stat`／`suggested-values`／`detector-result-grid`；`info-panel-badge` 只出現在 SAXS 面板相關程式（`detectorSDBadge` 不靠 class）。

- [ ] **Step 5：測試** — 全過（`[markup]` 確認 id／aria 不變）。
- [ ] **Step 6：Commit** — `git commit -am "feat(tiles): HPLC-SAXS fraction window and detector distance as hero tiles"`

---

### Task 9：dn/dc 理論計算與 HPLC dn/dc

**Files:** Modify `saxs-calculator/js/dndc-theory-ui.js`（兩個純函式）, `saxs-calculator/js/dndc-hplc-results.js`（`renderAlignmentInfo`、`hplcDndcResultsHtml`）

- [ ] **Step 1：`dndcCorrectionResultsHtml`、`llResultsHtml`**

```js
function dndcCorrectionResultsHtml(result) {
    const { tile, tiles, rows } = ResultTiles;
    const signed = value => `${value >= 0 ? '+' : ''}${value.toFixed(6)}`;
    return `
        ${tiles([
            tile({ label: '最終 d<i>n</i>/d<i>c</i>', value: result.finalDndc.toFixed(4), hero: true }),
            tile({ label: '參考 d<i>n</i>/d<i>c</i>', value: result.refDndc.toFixed(4) }),
            tile({ label: '溫度校正後', value: result.tempCorrected.toFixed(4) }),
        ])}
        ${rows([
            { label: '溫度貢獻', value: signed(result.tempContribution) },
            { label: '波長貢獻', value: signed(result.waveContribution) },
        ])}
        <div class="formula-note mt-md">
            溫度校正: d<i>n</i>/d<i>c</i>(<i>T</i>) = d<i>n</i>/d<i>c</i>(25°C) × (1 + α×Δ<i>T</i>), α = −4×10⁻⁴ °C⁻¹<br>
            波長校正 (Cauchy): d<i>n</i>/d<i>c</i>(λ₂) = d<i>n</i>/d<i>c</i>(λ₁) × (<i>A</i> + <i>B</i>/λ₂²) / (<i>A</i> + <i>B</i>/λ₁²)，
            蛋白質預設 <i>A</i> = 0.1756 mL/g、<i>B</i> = 5.0×10³ nm²·mL/g
        </div>
    `;
}

function llResultsHtml(llResult, gdResult) {
    const { tile, tiles } = ResultTiles;
    return tiles([
        tile({ label: 'Lorentz-Lorenz d<i>n</i>/d<i>c</i>', value: llResult.toFixed(4), unit: 'mL/g' }),
        tile({ label: 'Gladstone-Dale (近似)', value: gdResult.toFixed(4), unit: 'mL/g' }),
    ]);
}
```

（`formula-note` 的三行要與 Task 2 搬進來的原文逐字相同；若原文不同，以原文為準。）

- [ ] **Step 2：`renderAlignmentInfo` 改回傳列表項**

把函式結尾的 `const items = \`…\`;` 與 `return { items, alert };` 換成：

```js
    const rows = [
        { label: 'UV-RI 時間偏移', value: ai.lag.toFixed(4), unit: 'pts' },
        { label: '對齊品質', value: corrBadge },
    ];

    const alert = inactive
        ? `<div class="alert alert-warning mt-md">${ai.skipped ? '已略過自動對齊' : '自動對齊結果已被忽略'}：${escapeHtmlDndc(alignmentReasonText(ai.reason))}</div>`
        : '';

    return { rows, alert };
```

開頭的 `if (!ai) return { items: '', alert: '' };` 改成 `if (!ai) return { rows: [], alert: '' };`，JSDoc 的 `@returns` 改成 `{{rows: object[], alert: string}} 列表項與提示框`。

- [ ] **Step 3：`hplcDndcResultsHtml`**

```js
function hplcDndcResultsHtml(result, params, warnings = []) {
    const { tile, tiles, rows } = ResultTiles;
    const alignment = renderAlignmentInfo(result.alignmentInfo);

    const isArea = params.peakMode === 'area';
    const riUnit = isArea ? 'RIU·min' : 'RIU';
    // area 模式的分母其實是 UV 峰的梯形積分，不是瞬時濃度
    const concLabel = isArea ? 'UV 積分' : '濃度';
    const concUnit = isArea ? 'mg·min/mL' : 'mg/mL';

    return `
        ${renderWarningsHtml([...warnings, ...(result.warnings || [])])}
        ${tiles([
            tile({ label: 'd<i>n</i>/d<i>c</i>', value: formatDndc(result.dndc), unit: 'mL/g', hero: true }),
            tile({ label: concLabel, value: result.concentration != null ? result.concentration.toFixed(4) : '-', unit: concUnit }),
            tile({ label: 'RI peak value', value: result.riPeakValue != null ? result.riPeakValue.toExponential(4) : '-', unit: riUnit }),
            tile({ label: 'RI (corrected)', value: result.riValue != null ? result.riValue.toExponential(4) : '-', unit: 'RIU' }),
        ])}
        ${rows([
            { label: 'Peak 模式', value: escapeHtmlDndc(result.peakMode) },
            ...alignment.rows,
        ])}
        ${alignment.alert}
    `;
}
```

- [ ] **Step 4：測試** — 全過。
- [ ] **Step 5：Commit** — `git commit -am "feat(tiles): dn/dc theory and HPLC dn/dc results as tiles"`

---

### Task 10：多注射擬合與 Slice-by-slice

**Files:** Modify `saxs-calculator/js/dndc-ui.js`（新增 `dndcR2Grade`）, `saxs-calculator/js/dndc-multi-ui.js`, `saxs-calculator/js/dndc-slice-ui.js`

- [ ] **Step 1：`dndc-ui.js` 的「工具函數」區（`formatDndc` 之後）加共用分級**

```js
/**
 * 線性擬合 R² 的分級（多注射與 slice-by-slice 共用）。
 * comparator／bound 照 v5.1 的寫法：0.95 ≤ R² < 0.99 時顯示「< 0.95」是既有的文字問題，
 * 改版不改字（數值不變測試鎖住），另案處理。
 *
 * @param {number} rSquared - 決定係數
 * @returns {{quality: string, alertClass: string, comparator: string, bound: string}}
 */
function dndcR2Grade(rSquared) {
    if (rSquared >= 0.999) return { quality: '優良', alertClass: 'alert-success', comparator: '≥', bound: '0.999' };
    if (rSquared >= 0.99) return { quality: '良好', alertClass: 'alert-success', comparator: '≥', bound: '0.99' };
    if (rSquared >= 0.95) return { quality: '可接受', alertClass: 'alert-warning', comparator: '<', bound: '0.95' };
    return { quality: '偏低', alertClass: 'alert-error', comparator: '<', bound: '0.95' };
}
```

- [ ] **Step 2：`multiFitResultsHtml`**（Task 2 複製的 `r2Quality`／`r2Class` 6 行刪掉）

```js
function multiFitResultsHtml(result, meta, pointCount, signWarnings) {
    const { tile, tiles, rows } = ResultTiles;
    const grade = dndcR2Grade(result.rSquared);
    return `
        ${renderWarningsHtml(signWarnings)}
        ${tiles([
            tile({ label: 'd<i>n</i>/d<i>c</i> (斜率)', value: formatDndc(result.dnDc), unit: 'mL/g', hero: true }),
            tile({ label: '<i>R</i>²', value: result.rSquared.toFixed(6) }),
            tile({ label: '標準誤差', value: result.stdError.toExponential(4) }),
            tile({ label: '截距', value: result.intercept.toExponential(4) }),
            tile({ label: '資料點數', value: pointCount }),
        ])}
        ${rows([
            { label: '方法', value: escapeHtmlDndc(meta.methodName) },
        ])}
        <div class="alert ${grade.alertClass} mt-md">
            擬合品質：${grade.quality} (<i>R</i>² ${grade.comparator} ${grade.bound})
        </div>
    `;
}
```

顯示函式 `displayMultiFitResults` 裡原本的 `r2Quality`／`r2Class` 計算刪掉，`describeChart` 那行的 `${r2Quality}` 改成 `${dndcR2Grade(result.rSquared).quality}`。

- [ ] **Step 3：`sliceResultsHtml`**（同樣刪掉複製的分級）

```js
function sliceResultsHtml(result, warnings = []) {
    const { tile, tiles } = ResultTiles;
    const fit = result.fitResult;
    const grade = dndcR2Grade(fit.rSquared);
    return `
        ${renderWarningsHtml([...warnings, ...(result.warnings || [])])}
        ${tiles([
            tile({ label: 'd<i>n</i>/d<i>c</i> (斜率)', value: formatDndc(result.dndc), unit: 'mL/g', hero: true }),
            tile({ label: '<i>R</i>²', value: fit.rSquared.toFixed(6) }),
            tile({ label: '標準誤差', value: fit.stdError.toExponential(4) }),
            tile({ label: '截距', value: fit.intercept.toExponential(4) }),
            tile({ label: '有效切片數', value: result.sliceCount }),
        ])}
        <div class="alert ${grade.alertClass} mt-md">
            擬合品質：${grade.quality} (<i>R</i>² ${grade.comparator} ${grade.bound})
        </div>
    `;
}
```

`displaySliceResults` 裡的 `rSquared`／`r2Quality`／`r2Class` 刪掉；`describeChart` 改用 `fit.rSquared.toFixed(4)` 與 `dndcR2Grade(fit.rSquared).quality`。

- [ ] **Step 4：測試** — 全過（`[golden] multi-*`、`slice` 的提示框文字不變）。
- [ ] **Step 5：Commit** — `git commit -am "feat(tiles): multi-injection and slice dn/dc results as tiles; share the R² grade"`

---

### Task 11：脂質體 DOX 載藥頁

**Files:** Modify `saxs-calculator/js/section-liposome.js`, `saxs-calculator/tests/liposome-section.test.js:338-339`

- [ ] **Step 1：IIFE 開頭的工具區加** `const Tiles = () => global.ResultTiles;`（放在 `const esc = …` 下一行），刪掉 `resultItem` 函式。

- [ ] **Step 2：三個純函式**（標籤、數值、單位一律先 `esc`，與 v5.1 的 `resultItem` 相同）

```js
    function dilutionResultsHtml(r, qMin, qMax) {
        const { tile, tiles, rows } = Tiles();
        const excluded = r.excluded.outOfRange + r.excluded.nonPositive;
        const sem = Calc().standardErrorOfMean(r.sd, r.n);
        const semText = sem === null ? '' : `；SEM ${pct(sem / r.factor)}（僅供對照，D/L 誤差用 SD）`;
        return `
            ${tiles([
                tile({
                    label: '稀釋因子（I_bypass / I_solution 逐點平均）', wide: true,
                    value: r.factor.toPrecision(4), unit: `± ${r.sd.toPrecision(2)}`,
                    sub: `q 視窗 ${qMin}–${qMax} Å⁻¹，實際涵蓋 ${r.qCovered[0].toFixed(3)}–${r.qCovered[1].toFixed(3)}，n = ${r.n}，相對離散 ${pct(r.sd / r.factor)}${semText}`,
                }),
            ])}
            ${rows([
                { label: esc('最小平方縮放（PRIMUS I Scale 等價）'), value: esc(r.lsqScale.toPrecision(4)) },
                {
                    label: esc('排除點'), value: esc(String(excluded)),
                    unit: excluded ? esc(`超出範圍 ${r.excluded.outOfRange}、非正 ${r.excluded.nonPositive}`) : '',
                },
            ])}
            ${dilutionWarnings(r)}`;
    }
```

```js
    /** 結果區 HTML（純函式）：主波長吸光度磚 + 擬合摘要 + 警告列。 */
    function spectraResultsHtml(a, subtracted, fit) {
        const { tile, tiles, rows } = Tiles();
        const fitHtml = fit
            ? `${rows([
                   { label: esc('純 DOX 縮放係數 k'), value: esc(fit.k.toPrecision(4)) },
                   { label: esc('擬合殘差 RMS'), value: esc(fit.rms.toPrecision(3)), unit: esc(`A.U.，n = ${fit.n}`) },
               ])}
               <p class="result-list-foot">k 是讓「空白 + k×純 DOX」最貼近含藥光譜的縮放；殘差大代表兩樣品的脂質濃度可能不一致。網站不判定通過與否，請看下方擬合圖。</p>`
            : '';
        const warn = fit && fit.flags.negativeScale
            ? warningRow('縮放係數 k 為負：含藥／空白檔可能互換，或扣背景過頭')
            : '';
        const dropped = subtracted.dropped ? `，捨棄 ${subtracted.dropped} 點（超出空白光譜範圍）` : '';
        return `
            ${tiles([
                tile({
                    label: '扣背景後 A(主波長)', wide: true,
                    value: a.values[primary()].toFixed(5), unit: `± ${a.sd.toPrecision(2)}`,
                    sub: `± 為${SPREAD_LABEL}；重疊 ${subtracted.wavelength.length} 點${dropped}`,
                }),
            ])}
            ${fitHtml}${warn}`;
    }
```

```js
    function dlResultsHtml(snap) {
        const { tile, tiles, rows } = Tiles();
        const p = snap.params;
        return `
            ${tiles([
                tile({
                    label: 'D/L（drug-to-lipid 莫耳比）', hero: true,
                    value: snap.dl.toPrecision(4), unit: `± ${snap.dlSd.toPrecision(2)}`,
                    sub: [
                        `誤差 = D/L × √(relA² + relF²)：${SPREAD_LABEL}貢獻 ${pct(snap.relA)}，稀釋因子離散貢獻 ${pct(snap.relF)}`,
                        '此為精密度，不含 ε、光程、脂質配製濃度的系統誤差',
                        `Excel 原式（僅 UV）：${snap.dl.toPrecision(4)} ± ${snap.dlSdExcel.toPrecision(2)}`,
                    ],
                }),
                tile({
                    label: esc('[DOX]'), value: esc((snap.doxConc * 1000).toPrecision(4)),
                    unit: esc(`± ${(snap.doxSd * 1000).toPrecision(2)} mM`),
                }),
                tile({ label: esc('稀釋因子'), value: esc(p.factor.toPrecision(4)), unit: esc(SOURCE_LABEL[p.factorSource]) }),
            ])}
            ${rows([
                { label: esc('脂質實際濃度'), value: esc((snap.lipidActual * 1000).toPrecision(4)), unit: esc('mM') },
                {
                    label: esc(`A(${p.wavelengths[primary()]} nm)`), value: esc(snap.aPrimary.toFixed(5)),
                    unit: esc(`${SPREAD_LABEL} ${snap.sdA.toPrecision(2)}`),
                },
            ])}
            ${dlWarnings(snap)}`;
    }
```

（三個函式的磚標籤與附註和 v5.1 的 stat-card 文字相同，原本就沒有經 `esc`，維持原樣；列表項沿用 `resultItem` 的 `esc`。）

- [ ] **Step 3：更新 stub-DOM 測試的 class 斷言** — `tests/liposome-section.test.js` 第 338–339 行：

```js
    const card = $('lipoSpectraResults').innerHTML.match(/tile-value">([\d.]+)/)[1];
    assert.equal(card, $('lipoAbs2').value, '主波長磚與輸入框同一個值');
```

- [ ] **Step 4：測試** — 全過（`[golden] lipo-*` 與 liposome-section 全部）。
- [ ] **Step 5：Commit** — `git commit -am "feat(tiles): liposome results with D/L as the hero tile"`

---

### Task 12：移除沒有引用的舊結果樣式

**Files:** Modify `saxs-calculator/css/components.css`, `css/panels.css`, `css/sections.css`

- [ ] **Step 1：列出每個舊類別的引用數**

```bash
cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator
for c in result-grid result-item result-label result-value result-value--key result-note result-card result-card-label result-card-value result-card-unit result-card--lg detector-result-grid gradient-stat suggested-values stat-card stat-content stat-label stat-value stat-unit stat-sub; do
  printf "%-22s %s\n" "$c" "$(grep -o "\b$c\b" index.html js/*.js | wc -l)"
done
```

Expected：`stat-*` 仍被 `displayProteinStats`（`#proteinStats`）使用；`result-*`（結果項）、`result-card*`、`detector-result-grid`、`gradient-stat`、`suggested-values`、`result-value--key` 應為 0。

- [ ] **Step 2：刪掉引用數為 0 的類別的 CSS 規則**（含 `@media` 與 `@media print` 內的同名規則；刪除前 `grep -n` 確認每一條）。`panels.css` 開頭註解「v5.1 再換成 .tile 結果磚」改成「v5.2 起結果改用 css/tiles.css 的 .tile；這裡只剩蛋白質頁的統計列（.stat-card）」。`tokens.css` justify 名單裡的 `.result-note` 若已無引用一併移除。

- [ ] **Step 3：測試** — 全過（`token-usage` 的選擇器對照清單若引用了被刪的規則，跟著刪該筆對照）。
- [ ] **Step 4：Commit** — `git commit -am "refactor(css): drop result styles replaced by tiles"`

---

### Task 13：文件與版本

**Files:** Modify `docs/superpowers/specs/2026-10-14-apple-redesign-design.md`（加 §15）, `CLAUDE.md`, `saxs-calculator/index.html`（版本）

- [ ] **Step 1：改版規格加 §15「v5.2 實作修訂」**：把本計畫開頭「規格修訂」9 點原文寫進去，並加一點：「Task 10 發現既有文字問題：0.95 ≤ R² < 0.99 時提示框寫『R² < 0.95』，改版不改字，另案處理」。

- [ ] **Step 2：`CLAUDE.md` Design Context**
  - Aesthetic Direction 第一段「v5.2 再加大數字結果磚」改成「v5.2 各頁結果改成大數字結果磚」。
  - 在 `- **Units (v5.1):**` 之前加一條：

```markdown
- **Result tiles (v5.2):** Every page's results are built by `js/result-tiles.js` (`ResultTiles.tile／tiles／rows`, pure strings) and styled in `css/tiles.css`: one hero tile per page (`.tile--hero`, 46px coral), regular tiles 32px on tertiary (they sit inside cards), secondary values in a read-only `.result-list`. Result HTML comes from pure `*ResultsHtml` functions; `tests/result-golden.test.js` locks every number, unit and placeholder against the v5.1 capture — never regenerate that fixture to make a test pass
```

- [ ] **Step 3：版本 5.2**

```bash
cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator
sed -i '' 's/?v=5\.1"/?v=5.2"/g; s/Version 5\.1/Version 5.2/' index.html
grep -c '?v=5.2"' index.html; grep -n "Version 5\." index.html; grep -c '?v=5.1"' index.html
```

Expected：`?v=5.2` 的數量等於本地 css＋js 引用數（v5.1 時 52＋新增 2＝54），`Version 5.2`，`?v=5.1` 為 0。

- [ ] **Step 4：測試** — 全過。
- [ ] **Step 5：Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-14-apple-redesign-design.md saxs-calculator/index.html
git commit -m "docs: v5.2 tile revisions in spec §15 and CLAUDE.md; version 5.2"
```

---

### Task 14：瀏覽器驗收

- [ ] **Step 1：數字比對** — 伺服器同 Task 2（8793＝v5.1，8791＝工作目錄）。
Run: `…/python $SP/compare_results.py 8793 8791 numbers`
Expected：`0 個差異`（每個結果容器的數字多重集合相同；有 id 的葉節點文字相同），console errors 都是 `[]`。SAXS 容器若只多出主角膠囊上的比值（與提示框重複），屬預期，逐條確認後記錄。

- [ ] **Step 2：截圖** — 13 頁 × 淺／深色 × 1440／390px，存到 scratchpad，逐張看：主角磚跨兩欄、珊瑚色大字；一般磚兩欄（≤640px 一欄）；列表分隔線；沒有文字溢出磚、沒有白底疊白卡；HPLC 的「Start → Stop」在 390px 斷在箭頭處；偵測器「超出行程」膠囊在 SD < 2,200 mm 時出現（例：MW 模式輸入 66.5）。dn/dc 頁要先在 sessionStorage 設 `dndcUnlocked='true'`；HPLC dn/dc／多注射／slice／脂質體需要上傳檔案才有結果，用 Task 2 的 golden 測試涵蓋數字，截圖只看空狀態與版面。

- [ ] **Step 3：390px 不溢出** — 每頁 `document.documentElement.scrollWidth === 390`（兩個主題）。

- [ ] **Step 4：axe** — 兩個主題、每頁 0 違規（`axe.run(section, { preload: false })`，axe-core 4.10.2 由 jsDelivr 注入）。

- [ ] **Step 5：記下結果**，有問題回到對應任務修正並重跑全部測試。

---

### Task 15：審查、回報、上線

- [ ] **Step 1：code review** — 派 code-reviewer 審 `git diff f747e85..HEAD -- saxs-calculator CLAUDE.md`，重點：數字是否全經原本的格式化、跳脫是否與 v5.1 相同、磚的對比與 `[hidden]`、`dndcR2Grade` 行為是否與原三元運算一致。修掉 CRITICAL／HIGH，MEDIUM 盡量修。
- [ ] **Step 2：回報使用者**：改了什麼、驗收結果、規格修訂、發現的既有問題（R² 文字）。**push 前必須等使用者明確同意。**
- [ ] **Step 3：同意後** fast-forward 到 `main` 並 push（v5.1 若仍未 push，會一起上線），看 Pages 部署成功，線上冒煙測試（Version 5.2、兩個主題無 console error）。
