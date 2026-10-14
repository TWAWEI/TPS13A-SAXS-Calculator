# 蘋果風改版 v5.0 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上線 saxs-calculator v5.0：
- 全站換成 macOS 原生骨架：毛玻璃側欄、分組圓角輸入列、系統字、無邊框卡片。
- 新增深色模式：跟隨系統，另有手動「自動／淺色／深色」切換。
- 所有圖表依主題就地換色；匯出 PNG 一律淺色白底。
- 計算、數字格式與元素 id 一律不變。

**Architecture:**
- 顏色全部收進 `css/tokens.css` 的 token。淺色寫在 `:root`；深色寫成兩份逐字相同的區塊（跟隨系統／手動），都包在 `@media screen` 裡，列印一律淺色。
- `js/theme-init.js` 在 `<head>` 同步設好 `<html data-theme>`，避免深色使用者先看到淺色閃一下。`js/theme-toggle.js` 處理側欄切換，並派發 `tps:themechange` 事件。
- 圖表顏色全由 `js/chart-theme.js` 決定：圖表檔只標用途（`tpsRole`／`tpsSeries`），建立時經過 `ChartTheme.colorize`，切換主題時用 `ChartTheme.applyTo` 只改葉節點，zoom 範圍保留。
- 用三個靜態掃描測試守住規則：色碼字面值、token 用途、對比度。另有一個測試確認 index.html 的 id／for／aria／data-section 不變。

**Tech Stack:** HTML／CSS／vanilla JS（classic script、共用全域、無 build）、Chart.js 4.5.1＋zoom＋annotation（CDN、`defer`）、node:test、Playwright（驗收）。

**規格：** `docs/superpowers/specs/2026-10-14-apple-redesign-design.md`（以下簡稱「規格」）的 §3–§6、§5.9、§8.1、§8.2、§8.4、§9.2、§10。寫計畫時對照 v4.15 的實際程式碼，有 13 處與規格不同或規格沒寫清楚，整理在下面的「規劃時的決定」，Task 12 會寫進規格 §13。**計畫與規格不一致時以計畫為準。**

**這份計畫裡的程式碼都已經跑過：**
- 寫計畫前，在 scratchpad 的 v4.15 副本上把整份計畫從頭到尾實作過一次。
- 再用腳本在另一份全新副本上逐任務重播：每個任務做完都跑 node 測試，測試數與本計畫寫的預期值相同、全部通過。
- 最終結果經過下列驗證：
  - axe：兩個主題、13 頁加側欄都是 0 違規。
  - Playwright 互動檢查全過。
  - 8 個計算頁共 47 個顯示欄位，與 v4.15 一字不差。
- 所以「完整內容」與「原文／改成」區塊請**逐字照抄**，不要順手改進。抄完測試結果與預期不同時，停下來回報。

---

## 共同規則（每個任務都適用）

- **路徑：**
  - repo 根目錄 `/Users/hsutingwei/Desktop/TPS13A`（以下簡稱 `ROOT`）；網站在 `ROOT/saxs-calculator/`。
  - 本計畫的檔案路徑若沒寫 `saxs-calculator/` 前綴，指的都是 `ROOT` 底下的路徑（例如 `CLAUDE.md`、`docs/...`）。
- **分支：** Task 0 從 `main`（`6b02fbe`，v4.15）開 `feat/apple-redesign-v5`，所有 commit 都在這個分支。**Task 14 之前不要 push、不要合併**；Task 14 先回報使用者，等使用者同意才合併與 push。
- **JS 測試：** `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js`
  - 要用 `*.test.js`：Node 26 不接受目錄形式，`tests/load.js` 開頭註解寫的目錄形式會失敗。
  - 結尾要看到 `ℹ fail 0` 且 `ℹ skipped 0`。
  - 起始基準 179 pass；每個任務都寫了預期的 pass 數。
- **中間狀態畫面會壞，這是預期的：**
  - Task 2 換掉 tokens.css 之後、Task 6 之前，其他 CSS 檔還引用舊 token 名稱，畫面會變形。
  - Task 2 到 Task 12 每個任務只看 node 測試，瀏覽器驗收統一在 Task 13 做。
- **棘輪名單：** Task 1、Task 2 新增的兩個測試各有一張「暫時允許違規的檔案」名單：
  - `tests/no-color-literals.test.js` 的 `PENDING_LITERAL_FILES`
  - `tests/token-usage.test.js` 的 `PENDING_TOKEN_FILES`

  名單內的檔案必須確實還有違規，清乾淨了就要移出名單（否則測試失敗）；名單外的檔案一個違規都不能有。每個任務都寫了名單該怎麼改，Task 11 結束時兩張名單都是空的。
- **`?v=` 維持 4.15 直到 Task 14。** 新增的 `<script>` 一律寫 `?v=4.15`：`structure.test.js` 要求每個 `?v=` 等於側欄 footer 的版本號。
- **改檔方式：**
  - 計畫寫「寫入（完整內容）」的檔，整檔覆寫。
  - 寫「原文／改成」的，用 Edit 工具做逐字取代：原文必須在檔案裡剛好出現指定次數。對不上就停下來回報，不要猜。
  - 行號只是參考（v4.15），定位一律用原文。
- **CSP：** `index.html` 禁止行內 `<script>` 與 `onclick=""`，事件一律用 `addEventListener`。來自檔案或使用者輸入的字串進 `innerHTML` 前要過 `FormUtils.escapeHtml`（dn/dc 模組裡是 `escapeHtmlDndc`）。
- **不可變：** 新物件用 `Object.freeze`，不就地修改傳入的物件。
  - 例外一：`ChartTheme.colorize` 修改的是它自己剛深拷貝出來的副本。
  - 例外二：`applyTo`／`exportPng` 依 Chart.js 的 API 必須改圖表實例本身。這兩處的程式碼註解都寫了原因。
- **Commit：** conventional commits（`feat:`／`fix:`／`refactor:`／`test:`／`docs:`／`chore:`）。**不加 Co-Authored-By 之類的署名行**（使用者全域設定）。
- **停下來回報的情況：** 遇到計畫說「停下來回報」，或測試結果與預期不同時，停下來回報，不要自行改期望值。
- **不要用 port 8765：** 那裡有使用者另一個 App 的 service worker。本機驗收用 8791；Task 13 另外用 8793 放 v4.15 對照版。

## 任務相依

```
Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14
```

全部依序做：多數任務都會改共用的測試檔或 `index.html`，不能平行。

## 檔案地圖

| 檔案 | 動作 | 任務 | 職責 |
|---|---|---|---|
| `saxs-calculator/css/tokens.css` | 改寫 | 2 | 淺色／深色 token、reset、字型、段落左右對齊 |
| `saxs-calculator/css/layout.css` | 改寫 | 3 | 毛玻璃側欄、主題切換外觀、無邊框卡片 |
| `saxs-calculator/css/components.css` | 改寫 | 4 | 分組輸入列、分段控制、按鈕、表格、提示框、通道膠囊 |
| `saxs-calculator/css/panels.css` | 改寫 | 5 | 數值磚與理論值面板（去漸層、去色條） |
| `saxs-calculator/css/sections.css` | 改寫 | 6 | 遮罩、對話框、列印改用 token；`.num`、`.mb-md` |
| `saxs-calculator/js/theme-init.js` | 新 | 7 | `<head>` 同步設定 `data-theme`；`ThemeInit` 純函式 |
| `saxs-calculator/js/theme-toggle.js` | 新 | 7 | 側欄切換、寫 localStorage、派發 `tps:themechange` |
| `saxs-calculator/js/chart-theme.js` | 新 | 10 | 圖表色表、`colorize`／`applyTo`／`exportPng`／`init` |
| `saxs-calculator/index.html` | 改 | 7、8、10 | head script、主題切換 fieldset、13 組 `.form-list`、清掉裝飾用修飾 class |
| `saxs-calculator/js/app.js` | 改 | 7、10 | 呼叫 `ThemeToggle.init()`、`ChartTheme.init()` |
| `saxs-calculator/js/section-*.js`、`dndc-*-ui.js` | 改 | 9 | 行內色碼與左側色條改成 class |
| `saxs-calculator/js/charts.js`、`dndc-charts.js` | 改寫 | 11 | 只標用途，經 `ChartTheme.colorize` 建立 |
| `saxs-calculator/js/liposome-charts.js`、`dndc-hplc-results.js`、`dndc-astra-ui.js`、`dndc-export.js`、`dndc-ui.js` | 改 | 9、11 | 同上；通道膠囊；PNG 匯出 |
| `saxs-calculator/tests/style-scan.js` | 新 | 1 | 靜態掃描共用工具（不是測試檔） |
| `saxs-calculator/tests/no-color-literals.test.js` | 新 | 1 | 色碼只能在 tokens.css 與 chart-theme.js |
| `saxs-calculator/tests/markup.test.js`＋`tests/fixtures/markup-v4.15.json` | 新 | 1 | id／for／aria-*／data-section 不變 |
| `saxs-calculator/tests/contrast.test.js` | 新 | 2、10 | 兩個主題的對比矩陣；圖表色對比 |
| `saxs-calculator/tests/token-usage.test.js` | 新 | 2 | 未定義 token、文字色只用文字 token、白字只在強調色底上、沒有 `border-left` |
| `saxs-calculator/tests/theme.test.js` | 新 | 7、10 | `ThemeInit`；`colorAssignments`／`colorize`／`applyTo`／`exportPng` |
| `saxs-calculator/tests/structure.test.js` | 改 | 7、10、11 | theme-init 位置、chart-theme 順序、`new Chart` 必經 `colorize` |
| `saxs-calculator/tests/load.js` | 改 | 7、10 | 載入 theme-init.js、chart-theme.js 並匯出 |
| `CLAUDE.md` | 改 | 2 | Design Context 改寫（規格 §10、§9.2：與 tokens.css 同一個 commit） |
| `docs/superpowers/specs/2026-10-14-apple-redesign-design.md` | 改 | 12 | 修正規格的錯誤事實、§6.1 色表、新增 §13 |

## 規劃時的決定（與規格不同或規格沒寫清楚之處）

詳細內容見 Task 12 要寫進規格的 §13，這裡列重點：

1. **圖表系列色從 10 色改 8 色。**
   - 依 dataviz 規範，類別色超過 8 個就無法同時滿足對比與色覺區分。
   - 圓餅圖改成前 7 名＋「Others」（灰）。
   - 第 9 個以後的通道重用同色並改虛線。
   - 深色主線色從 #F06464 改成 #E85858。
   - 新增用途 `regionAlt`（基線區間）。
2. **座標軸配色：** 帶顏色的座標軸只上色軸線，刻度與標題一律用文字色。
3. **規格 §5.6 寫錯表格：** 要改的是 **Detector Setting 表**，不是流速表。
4. **表格 hover：** 改用 tertiary。原本的 hover 色上，淺色 success-text 只有 4.49:1。
5. **理論值面板：** 兩個面板都用中性灰底，不用綠／琥珀，因為它們不是「狀態」。
6. **卡片裡的磚：** 用淺灰底，避免白底疊白底。
7. **提示框：** 原本沒有左側色條，是四邊 1px 邊框；改成拿掉邊框。
8. **測試基準：** 是 179，不是規格寫的 159。

---

## Task 0：建立分支並確認基準

**Files:** 無

- [ ] **Step 1：確認乾淨的 main 並開分支**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git status --short          # 應該沒有輸出
git log --oneline -1        # 6b02fbe fix: negative-UV message names the most common cause ...
git switch -c feat/apple-redesign-v5
```

- [ ] **Step 2：跑基準測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"`
Expected: `ℹ tests 179`、`ℹ pass 179`、`ℹ fail 0`、`ℹ skipped 0`

`skipped` 不是 0，代表 `saxs-calculator/tests/fixtures-local/`（gitignored 的本地資料）不見了，停下來回報。

---

## Task 1：防護測試——色碼字面值、標記不變

**規格：** §3.3 規則 5、§8.1-3、§8.2

**Files:**
- Create: `saxs-calculator/tests/style-scan.js`
- Create: `saxs-calculator/tests/no-color-literals.test.js`
- Create: `saxs-calculator/tests/markup.test.js`
- Create: `saxs-calculator/tests/fixtures/markup-v4.15.json`（由指令產生）

這三個測試在後續任務會一直跑，先放進來，改版過程中才不會不小心破壞規則。

`style-scan.js` 是共用工具（檔名不以 `.test.js` 結尾，所以 `node --test` 不會執行它），負責這幾件事：
- 列出檔案。
- 去掉註解。
- 解析 CSS 自訂屬性與規則。
- 計算 `index.html` 的標記屬性。

- [ ] **Step 1：新增共用掃描工具**

寫入 `saxs-calculator/tests/style-scan.js`（完整內容，照抄）：

```javascript
'use strict';
/**
 * 靜態樣式掃描的共用工具：no-color-literals／token-usage／contrast／markup 測試共用。
 * 不是測試檔（檔名不以 .test.js 結尾），node --test 不會直接執行它。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** 讀 saxs-calculator/ 底下的相對路徑。 */
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 列出某目錄下某副檔名的檔案，回傳 'dir/file' 形式的相對路徑（排序過）。 */
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith(ext)).sort().map(f => `${dir}/${f}`);

const CSS_FILES = Object.freeze(list('css', '.css'));
const JS_FILES = Object.freeze(list('js', '.js'));

const stripCssComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtmlComments = src => src.replace(/<!--[\s\S]*?-->/g, '');
/** 去掉 JS 的區塊註解與行註解；`://`（網址）前面是冒號，不會被當成註解。 */
const stripJsComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** 依副檔名去掉註解。 */
function stripComments(rel, src) {
    if (rel.endsWith('.css')) return stripCssComments(src);
    if (rel.endsWith('.html')) return stripHtmlComments(src);
    return stripJsComments(src);
}

/** 讀檔並去掉註解。 */
const readCode = rel => stripComments(rel, read(rel));

/** 解析 `--name: value;` 宣告成 Map（只看傳入的區塊內文）。 */
function parseCustomProperties(body) {
    const map = new Map();
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
    return map;
}

/** 取出 `selector {` 之後、配對的 `}` 之前的內文（selector 必須逐字出現）。 */
function blockBody(src, selector) {
    const start = src.indexOf(`${selector} {`);
    if (start < 0) return null;
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') depth--;
        if (depth === 0) return src.slice(open + 1, i);
    }
    return null;
}

/** 列出最內層的 CSS 規則 { selector, body }（@media 內的規則也會列出）。 */
function cssRules(src) {
    const rules = [];
    for (const m of stripCssComments(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        rules.push(Object.freeze({ selector: m[1].trim(), body: m[2] }));
    }
    return rules;
}

/**
 * index.html 裡 JS 與測試賴以取元素的屬性（id、for、data-section、aria-*），以「屬性=值」計數。
 * 改版規格 §8.2 的標記不變測試與其 fixture 產生指令共用這個函式。
 */
function markupCounts(html) {
    const counts = {};
    for (const m of stripHtmlComments(html).matchAll(/\s(id|for|data-section|aria-[\w-]+)="([^"]*)"/g)) {
        const key = `${m[1]}=${m[2]}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = {
    ROOT,
    read,
    readCode,
    CSS_FILES,
    JS_FILES,
    stripComments,
    parseCustomProperties,
    blockBody,
    cssRules,
    markupCounts,
};
```

- [ ] **Step 2：新增色碼字面值測試**

`PENDING_LITERAL_FILES` 列的 11 個檔，是 v4.15 現在還有色碼字面值的所有檔案：4 個 CSS 檔、5 個圖表相關 JS、2 個 section JS。

寫入 `saxs-calculator/tests/no-color-literals.test.js`（完整內容，照抄）：

```javascript
'use strict';
/**
 * 色碼字面值只能出現在 css/tokens.css 與 js/chart-theme.js（改版規格 §3.3 規則 5）。
 * 其他地方寫死的顏色在深色模式下不會跟著換，這是深色模式最常見的漏網之魚。
 *
 * PENDING_LITERAL_FILES 是棘輪名單：v5.0 改版期間暫時允許的檔案。名單內的檔案必須「確實還有」
 * 字面值（清乾淨了就要移出名單），名單外的檔案一個都不能有。v5.0 完成時名單為空。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCode, CSS_FILES, JS_FILES } = require('./style-scan.js');

const EXEMPT = Object.freeze(['css/tokens.css', 'js/chart-theme.js']);

const PENDING_LITERAL_FILES = Object.freeze([
    'css/components.css',
    'css/layout.css',
    'css/panels.css',
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);

// #hex（前面不能是 & 或字母數字，排除 &#10; 這類 HTML 實體）與顏色函式。transparent／currentColor／inherit 允許。
const COLOR_LITERAL = /(?<![&\w])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g;

const SCANNED = Object.freeze([...CSS_FILES, ...JS_FILES, 'index.html'].filter(f => !EXEMPT.includes(f)));

function literalsIn(file) {
    return [...readCode(file).matchAll(COLOR_LITERAL)].map(m => m[0]);
}

test('[colors] 色碼字面值只出現在 tokens.css 與 chart-theme.js（棘輪名單除外）', () => {
    const offenders = SCANNED
        .filter(file => !PENDING_LITERAL_FILES.includes(file))
        .map(file => [file, literalsIn(file)])
        .filter(([, hits]) => hits.length > 0)
        .map(([file, hits]) => `${file}: ${[...new Set(hits)].join(' ')}`);
    assert.deepEqual(offenders, [], `改用 var(--…) 或 class:\n  ${offenders.join('\n  ')}`);
});

test('[colors] 棘輪名單沒有過期項目（清乾淨就要移出名單）', () => {
    const stale = PENDING_LITERAL_FILES.filter(file => literalsIn(file).length === 0);
    assert.deepEqual(stale, [], `已經沒有色碼字面值，請從 PENDING_LITERAL_FILES 移除: ${stale.join(', ')}`);
});
```

- [ ] **Step 3：新增標記不變測試**

寫入 `saxs-calculator/tests/markup.test.js`（完整內容，照抄）：

```javascript
'use strict';
/**
 * 標記不變測試（改版規格 §8.2）：JS 與測試都靠 id、for、aria-*、data-section 取元素。
 * 改版只能換 class 與包裝層，這四類屬性必須與 v4.15 的 index.html 完全相同；
 * 唯一允許的新增是側欄的主題切換控制。
 *
 * fixture（tests/fixtures/markup-v4.15.json）由 v4.15（commit 6b02fbe）的 index.html 產生：
 *   node -e "const {markupCounts}=require('./saxs-calculator/tests/style-scan.js');const html=require('child_process').execSync('git show 6b02fbe:saxs-calculator/index.html').toString();require('fs').writeFileSync('saxs-calculator/tests/fixtures/markup-v4.15.json', JSON.stringify(markupCounts(html), null, 2)+'\n')"
 * v5.1 補 aria-live 時要更新 fixture，並在 commit 訊息說明。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, markupCounts } = require('./style-scan.js');

const FIXTURE = JSON.parse(read('tests/fixtures/markup-v4.15.json'));

const ALLOWED_ADDITIONS = Object.freeze({
    'id=themeToggle': 1,
    'id=themeAuto': 1,
    'id=themeLight': 1,
    'id=themeDark': 1,
    'for=themeAuto': 1,
    'for=themeLight': 1,
    'for=themeDark': 1,
});

test('[markup] id／for／aria-*／data-section 與 v4.15 相同（只多了主題切換控制）', () => {
    const current = markupCounts(read('index.html'));
    const keys = new Set([...Object.keys(FIXTURE), ...Object.keys(current)]);
    const problems = [];
    for (const key of keys) {
        const diff = (current[key] || 0) - (FIXTURE[key] || 0);
        if (diff < 0) problems.push(`少了 ${key}（${-diff} 個）`);
        if (diff > 0 && diff > (ALLOWED_ADDITIONS[key] || 0)) problems.push(`多了 ${key}（${diff} 個）`);
    }
    assert.deepEqual(problems, []);
});

test('[markup] fixture 本身沒被清空', () => {
    assert.ok(Object.keys(FIXTURE).length > 300, `fixture 只有 ${Object.keys(FIXTURE).length} 筆，看起來不對`);
});
```

- [ ] **Step 4：由 v4.15 的 index.html 產生 fixture**

一律從 commit `6b02fbe` 取 index.html，不從工作目錄取，之後重產也是同一份。

```bash
cd /Users/hsutingwei/Desktop/TPS13A
mkdir -p saxs-calculator/tests/fixtures && node -e "const {markupCounts}=require('./saxs-calculator/tests/style-scan.js');const html=require('child_process').execSync('git show 6b02fbe:saxs-calculator/index.html').toString();require('fs').writeFileSync('saxs-calculator/tests/fixtures/markup-v4.15.json', JSON.stringify(markupCounts(html), null, 2)+'\n')"
```

確認：

```bash
cd /Users/hsutingwei/Desktop/TPS13A
node -e "const f=require('./saxs-calculator/tests/fixtures/markup-v4.15.json');console.log(Object.keys(f).length, Object.values(f).reduce((a,b)=>a+b,0))"
```

Expected: `460 462`（460 種「屬性=值」、共 462 個）

- [ ] **Step 5：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 183`、`ℹ fail 0`、`ℹ skipped 0`（179＋4）

- [ ] **Step 6：確認測試真的擋得住（做完要還原）**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
sed -i '' 's/id="xrayEnergy"/id="xrayEnergyX"/' saxs-calculator/index.html
node --test saxs-calculator/tests/markup.test.js 2>&1 | grep -E "少了|多了"
git checkout saxs-calculator/index.html
printf "const v5ColorProbe = '#123456';\n" >> saxs-calculator/js/app.js
node --test saxs-calculator/tests/no-color-literals.test.js 2>&1 | grep -E "app.js"
git checkout saxs-calculator/js/app.js
git status --short
```

Expected：
- 第一次測試印出 `少了 id=xrayEnergy` 與 `多了 id=xrayEnergyX`。
- 第二次測試印出含 `js/app.js: #123456` 的那一行。
- `git status --short` 只列出 Task 1 新增的 4 個檔（`??`）。

- [ ] **Step 7：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/tests/style-scan.js saxs-calculator/tests/no-color-literals.test.js \
        saxs-calculator/tests/markup.test.js saxs-calculator/tests/fixtures/markup-v4.15.json
git commit -m "test: guard tests for colour literals and markup invariance (v5.0 prep)"
```

---

## Task 2：tokens.css（淺色＋深色）、對比度與用途測試、CLAUDE.md

**規格：** §3（3.1–3.4）、§5.10、§8.1-1、§8.1-2、§9.2（tokens.css 與 CLAUDE.md 同一個 commit）、§10

**Files:**
- Create: `saxs-calculator/tests/contrast.test.js`
- Create: `saxs-calculator/tests/token-usage.test.js`
- Modify（整檔改寫）: `saxs-calculator/css/tokens.css`
- Modify: `CLAUDE.md`（`### Aesthetic Direction` 整節、Design Principles 第 1、4 條）

- [ ] **Step 1：先寫對比度測試**

對比矩陣對應規格 §8.1-1，另外依實作補了幾組：
- 語意色 `-text` × tertiary：表格 hover 列、理論值面板。
- `--color-text-muted` × 淡珊瑚疊卡片：理論值面板的強調格。

寫入 `saxs-calculator/tests/contrast.test.js`（完整內容，照抄）：

```javascript
'use strict';
/**
 * 對比度測試（改版規格 §3.1、§3.3、§8.1-1）：用 WCAG 2.x 公式檢查 tokens.css 兩個主題的配色。
 * 半透明色先疊在指定底色上再算。文字 ≥ 4.5，元件 ≥ 3。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCode, parseCustomProperties, blockBody } = require('./style-scan.js');

const TOKENS = readCode('css/tokens.css');
const LIGHT_BODY = blockBody(TOKENS, ':root');
const AUTO_DARK_BODY = blockBody(TOKENS, ':root:not([data-theme="light"])');
const MANUAL_DARK_BODY = blockBody(TOKENS, ':root[data-theme="dark"]');

const LIGHT = parseCustomProperties(LIGHT_BODY || '');
const DARK = new Map([...LIGHT, ...parseCustomProperties(AUTO_DARK_BODY || '')]);
const THEMES = Object.freeze({ light: LIGHT, dark: DARK });

/** '#RGB' | '#RRGGBB' | 'rgb(a)(r, g, b[, a])' → { r, g, b, a }（0–255，a 0–1） */
function parseColor(value) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
    if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
    throw new Error(`無法解析的顏色：${value}`);
}

/** 把 top 疊在不透明的 bottom 上 */
function over(top, bottom) {
    const a = top.a;
    return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function luminance({ r, g, b }) {
    const lin = c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * 解析一個底色描述：'--a' 或 '--a over --b'（a 疊在 b 上；b 也可以再疊）。
 * 前景若半透明，也先疊在底色上。
 */
function resolveSurface(theme, spec) {
    const parts = spec.split(' over ').map(s => s.trim());
    let color = parseColor(theme.get(parts[parts.length - 1]));
    for (let i = parts.length - 2; i >= 0; i--) color = over(parseColor(theme.get(parts[i])), color);
    return color;
}

function ratio(theme, fgName, bgSpec) {
    const bg = resolveSurface(theme, bgSpec);
    return contrast(over(parseColor(theme.get(fgName)), bg), bg);
}

const GLASS = '--glass-sidebar over --color-bg-primary';
const NEUTRAL_SURFACES = ['--color-bg-card', '--color-bg-primary', '--color-bg-tertiary', '--color-bg-hover', '--color-bg-sidebar', GLASS];

/** [前景, 底色, 門檻, 用在哪裡] */
const PAIRS = Object.freeze([
    ...['--color-text-primary', '--color-text-secondary', '--color-text-muted', '--color-accent-text']
        .flatMap(fg => NEUTRAL_SURFACES.map(bg => [fg, bg, 4.5, '一般文字'])),
    ...['--color-accent-text', '--color-text-primary', '--color-text-muted']
        .map(fg => [fg, '--color-accent-tint over --color-bg-card', 4.5, '理論值面板強調格、流速表提示列、卡片上的來源 chip']),
    ['--color-accent-text', '--color-accent-tint over --color-bg-tertiary', 4.5, '理論值面板上的來源 chip'],
    ...['success', 'warning', 'danger'].flatMap(s => [
        [`--color-${s}-text`, `--color-${s}-bg`, 4.5, '提示框、徽章'],
        [`--color-${s}-text`, '--color-bg-card', 4.5, '卡片上的狀態文字'],
        [`--color-${s}-text`, '--color-bg-tertiary', 4.5, '表格 hover 列、理論值面板'],
    ]),
    ...['--color-text-primary', '--color-success-text', '--color-accent-text']
        .map(fg => [fg, '--color-warning-bg', 4.5, 'Detector Setting 表主步驟列（§5.6）']),
    ...['--color-accent-primary', '--color-accent-primary-hover', '--color-danger']
        .map(bg => ['--color-text-on-accent', bg, 4.5, '白字按鈕、選中導覽項']),
    ['--color-text-primary', '--color-bg-raised', 4.5, '分段控制選中塊'],
    ...['--color-accent-primary', '--color-accent-primary-hover', '--color-focus']
        .flatMap(fg => ['--color-bg-card', '--color-bg-primary', '--color-bg-sidebar', GLASS].map(bg => [fg, bg, 3, '按鈕外形、焦點框'])),
    ...['--color-danger', '--color-success', '--color-warning']
        .map(fg => [fg, '--color-bg-card', 3, '卡片內的語意填色']),
]);

test('[contrast] 兩個深色區塊逐字相同', () => {
    assert.ok(LIGHT_BODY, 'tokens.css 找不到 :root 區塊');
    assert.ok(AUTO_DARK_BODY, '找不到 :root:not([data-theme="light"]) 區塊');
    assert.ok(MANUAL_DARK_BODY, '找不到 :root[data-theme="dark"] 區塊');
    const norm = s => s.trim().replace(/\s+/g, ' ');
    assert.equal(norm(AUTO_DARK_BODY), norm(MANUAL_DARK_BODY));
});

test('[contrast] 深色區塊只覆寫淺色已有的 token（不新增名稱）', () => {
    const extra = [...parseCustomProperties(AUTO_DARK_BODY).keys()].filter(name => !LIGHT.has(name));
    assert.deepEqual(extra, []);
});

test('[contrast] 深色區塊都包在 @media screen 裡（列印一律淺色）', () => {
    assert.match(TOKENS, /@media screen and \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
    assert.match(TOKENS, /@media screen\s*\{\s*:root\[data-theme="dark"\]/);
});

for (const [themeName, theme] of Object.entries(THEMES)) {
    test(`[contrast] ${themeName}：文字 ≥ 4.5、元件 ≥ 3`, () => {
        const failures = PAIRS
            .map(([fg, bg, min, where]) => ({ fg, bg, min, where, value: ratio(theme, fg, bg) }))
            .filter(p => p.value < p.min)
            .map(p => `${p.fg} on ${p.bg} = ${p.value.toFixed(2)} < ${p.min}（${p.where}）`);
        assert.deepEqual(failures, []);
    });
}
```

- [ ] **Step 2：跑它，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/contrast.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL。舊 tokens.css 沒有深色區塊（找不到 `:root:not([data-theme="light"])`），而且舊色值有幾組對比不足。

- [ ] **Step 3：改寫 tokens.css**

對應規格 §3.1 的 token 表與 §3.4 的結構：
- 舊名稱整批刪除（§3.2），不留別名。
- 段落左右對齊規則（§5.10）放在檔案最後。

寫入 `saxs-calculator/css/tokens.css`（完整內容，照抄）：

```css
/* =============================================
   TPS13A SAXS Calculator — Design Tokens & Base
   :root 變數（淺色＋深色）、reset、skip link、字型、標題與段落對齊（第 1 層，最先載入）
   色碼字面值只能出現在本檔與 js/chart-theme.js（tests/no-color-literals.test.js）。
   對比度由 tests/contrast.test.js 檢查；填色 token 不能當文字（tests/token-usage.test.js）。
   ============================================= */

/* ===== CSS Variables — 淺色（預設；列印一律用這組） ===== */
:root {
    color-scheme: light;

    /* Surfaces */
    --color-bg-primary: #F5F5F7;
    --color-bg-card: #FFFFFF;
    --color-bg-secondary: #FFFFFF;
    --color-bg-tertiary: #F0F0F3;
    --color-bg-hover: #E8E8ED;
    --color-bg-raised: #FFFFFF;
    --color-bg-sidebar: #ECECF0;
    --glass-sidebar: rgba(236, 236, 240, 0.82);
    --color-backdrop: rgba(0, 0, 0, 0.25);
    --color-separator: #E3E3E8;
    --color-border: #D2D2D7;

    /* Text */
    --color-text-primary: #1D1D1F;
    --color-text-secondary: #424245;
    --color-text-muted: #636366;
    --color-text-on-accent: #FFFFFF;

    /* Accent — muted coral。-primary／-hover 只當填色；珊瑚色文字一律 --color-accent-text */
    --color-accent-primary: #A85555;
    --color-accent-primary-hover: #8F4646;
    --color-accent-text: #A83737;
    --color-accent-tint: rgba(168, 85, 85, 0.10);
    --color-focus: #A85555;

    /* Semantic — 填色只當填色；文字用 -text，放在 -bg 或卡片上 */
    --color-success: #059669;
    --color-success-text: #047857;
    --color-success-bg: #E5F4EC;
    --color-warning: #D97706;
    --color-warning-text: #92400E;
    --color-warning-bg: #FEF3E2;
    --color-danger: #DC2626;
    --color-danger-text: #B91C1C;
    --color-danger-bg: #FDECEC;

    /* Shadows */
    --shadow-sm: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
    --shadow-md: 0 12px 40px rgba(0, 0, 0, 0.18);

    /* Spacing — 4px base */
    --spacing-xs: 0.25rem;
    --spacing-sm: 0.5rem;
    --spacing-md: 1rem;
    --spacing-lg: 1.5rem;
    --spacing-xl: 2rem;
    --spacing-2xl: 3rem;
    --spacing-3xl: 4rem;

    /* Radius — 8 輸入框／膠囊／結果項目，10 按鈕／分段控制，12 卡片／列表／提示框／面板，18 結果磚 */
    --radius-sm: 8px;
    --radius-md: 10px;
    --radius-lg: 12px;
    --radius-xl: 18px;
    --radius-dialog: 14px;
    --radius-pill: 999px;

    /* Transitions */
    --transition-fast: 120ms ease-out;
    --transition-normal: 200ms ease-out;

    /* Layout */
    --sidebar-width: 240px;
    --sidebar-collapsed-width: 56px;

    /* Typography — 系統字；沒有 SF／蘋方的系統退回 Inter＋Noto（Google Fonts） */
    --font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang TC", "Noto Sans TC", system-ui, sans-serif;
    --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "PingFang TC", "Noto Sans TC", system-ui, sans-serif;
    --font-en: var(--font-body);
    --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
}

/* ===== 深色 =====
   兩個區塊必須逐字相同（tests/contrast.test.js 比對）。都限定 screen：列印一律用上面的淺色值，
   否則從深色模式列印，自帶 token 色的 p、標題會變成淺色字印在白紙上。
   第一塊：跟隨系統（手動選了淺色時不套用）；第二塊：手動選深色。 */
@media screen and (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        color-scheme: dark;
        --color-bg-primary: #121214;
        --color-bg-card: #1E1E21;
        --color-bg-secondary: #1E1E21;
        --color-bg-tertiary: #2A2A2E;
        --color-bg-hover: #2C2C30;
        --color-bg-raised: #3A3A3E;
        --color-bg-sidebar: #232327;
        --glass-sidebar: rgba(35, 35, 39, 0.82);
        --color-backdrop: rgba(0, 0, 0, 0.5);
        --color-separator: #2E2E33;
        --color-border: #3A3A3F;
        --color-text-primary: #F5F5F7;
        --color-text-secondary: #D1D1D6;
        --color-text-muted: #A1A1A6;
        --color-text-on-accent: #FFFFFF;
        --color-accent-primary: #A85555;
        --color-accent-primary-hover: #B05A5A;
        --color-accent-text: #EE9090;
        --color-accent-tint: rgba(238, 144, 144, 0.14);
        --color-focus: #EE9090;
        --color-success: #30D158;
        --color-success-text: #5BD68A;
        --color-success-bg: #1D3326;
        --color-warning: #F5B754;
        --color-warning-text: #F5B754;
        --color-warning-bg: #3A2C14;
        --color-danger: #DC2626;
        --color-danger-text: #F58A8A;
        --color-danger-bg: #3A1C1C;
        --shadow-sm: 0 0 0 0.5px rgba(255, 255, 255, 0.06);
        --shadow-md: 0 12px 40px rgba(0, 0, 0, 0.55);
    }
}

@media screen {
    :root[data-theme="dark"] {
        color-scheme: dark;
        --color-bg-primary: #121214;
        --color-bg-card: #1E1E21;
        --color-bg-secondary: #1E1E21;
        --color-bg-tertiary: #2A2A2E;
        --color-bg-hover: #2C2C30;
        --color-bg-raised: #3A3A3E;
        --color-bg-sidebar: #232327;
        --glass-sidebar: rgba(35, 35, 39, 0.82);
        --color-backdrop: rgba(0, 0, 0, 0.5);
        --color-separator: #2E2E33;
        --color-border: #3A3A3F;
        --color-text-primary: #F5F5F7;
        --color-text-secondary: #D1D1D6;
        --color-text-muted: #A1A1A6;
        --color-text-on-accent: #FFFFFF;
        --color-accent-primary: #A85555;
        --color-accent-primary-hover: #B05A5A;
        --color-accent-text: #EE9090;
        --color-accent-tint: rgba(238, 144, 144, 0.14);
        --color-focus: #EE9090;
        --color-success: #30D158;
        --color-success-text: #5BD68A;
        --color-success-bg: #1D3326;
        --color-warning: #F5B754;
        --color-warning-text: #F5B754;
        --color-warning-bg: #3A2C14;
        --color-danger: #DC2626;
        --color-danger-text: #F58A8A;
        --color-danger-bg: #3A1C1C;
        --shadow-sm: 0 0 0 0.5px rgba(255, 255, 255, 0.06);
        --shadow-md: 0 12px 40px rgba(0, 0, 0, 0.55);
    }
}

/* ===== Reset & Base ===== */
*, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

html {
    font-size: 17px;
    scroll-behavior: smooth;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

body {
    font-family: var(--font-body);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    line-height: 1.6;
    min-height: 100vh;
    overflow-x: hidden;
}

/* Scientific variable notation — italic for physical quantities */
.sci-var {
    font-family: var(--font-en);
    font-style: italic;
}

/* checkbox／radio 跟著強調色（原生控制項，對卡片 ≥ 3:1） */
input[type="checkbox"],
input[type="radio"] {
    accent-color: var(--color-accent-primary);
}

/* ===== Skip Link ===== */
.skip-link {
    position: absolute;
    top: -100%;
    left: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--color-accent-primary);
    color: var(--color-text-on-accent);
    border-radius: var(--radius-md);
    z-index: 200;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
}

.skip-link:focus {
    top: var(--spacing-md);
}

/* ===== Typography ===== */
h1, h2 {
    font-family: var(--font-display);
    font-weight: 600;
    line-height: 1.2;
    color: var(--color-text-primary);
    letter-spacing: -0.01em;
}

h3, h4, h5, h6 {
    font-family: var(--font-body);
    font-weight: 600;
    line-height: 1.3;
    color: var(--color-text-primary);
}

h1 { font-size: clamp(1.75rem, 2.5vw, 2.25rem); }
h2 { font-size: clamp(1.375rem, 2vw, 1.75rem); }
h3 { font-size: 1rem; }
h4 { font-size: 0.9375rem; }

p {
    color: var(--color-text-secondary);
}

a {
    color: var(--color-accent-text);
    text-decoration: none;
    transition: color var(--transition-fast);
}

a:hover {
    text-decoration: underline;
}

/* 多行段落左右對齊（使用者全域排版規則）。:where() 特異性為 0，任何顯式 text-align 都會蓋過；
   單行文字 justify 後等同靠左。表格儲存格、按鈕、表單 label、導覽項不在名單內。 */
:where(p, li, dd, blockquote, .alert, .modal-desc, .formula-note, .form-list-foot,
       .stat-sub, .quick-ref-body, .info-panel-formula, .info-panel-hint, .result-note) {
    text-align: justify;
}
```

- [ ] **Step 4：跑對比度測試，確認通過**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/contrast.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ pass 5`、`ℹ fail 0`

- [ ] **Step 5：新增 token 用途測試**

`PENDING_TOKEN_FILES` 列的 13 個檔，是換掉 tokens.css 之後所有還有違規的檔。違規有四種：
- 引用已刪除的舊 token。
- 填色 token 當文字。
- 白字配非強調色底。
- `border-left`。

寫入 `saxs-calculator/tests/token-usage.test.js`（完整內容，照抄）：

```javascript
'use strict';
/**
 * Token 用途測試（改版規格 §3.2、§3.3 規則 3–4、§8.1-2）。
 *
 *   1. 每個 var(--x) 都要在 tokens.css 定義過——改名後漏改的舊名在瀏覽器裡會靜默變成初始值（通常是透明或黑色）。
 *   2. 文字色（CSS 的 color:、行內 style 的 color:、style.color =）只能用文字 token。
 *      填色 token（--color-accent-primary、--color-success…）在深色下當文字只有 3:1 上下。
 *   3. 用 --color-text-on-accent（白字）的規則，背景必須是 accent-primary／-hover／danger 其中之一。
 *   4. 不加左側色條（§3.3 規則 6）：任何 border-left 宣告都不行（CSS 與行內 style 都算）。
 *
 * PENDING_TOKEN_FILES 是棘輪名單：v5.0 改版期間暫時允許違規的檔案；名單內的檔案必須確實還有違規。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, readCode, CSS_FILES, JS_FILES, parseCustomProperties, cssRules } = require('./style-scan.js');

const PENDING_TOKEN_FILES = Object.freeze([
    'css/components.css',
    'css/layout.css',
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);

// 執行時才由 JS 設定的自訂屬性（不在 tokens.css）
const RUNTIME_PROPERTIES = Object.freeze(['--chip-color']);

const DEFINED = new Set([...parseCustomProperties(readCode('css/tokens.css')).keys(), ...RUNTIME_PROPERTIES]);

const TEXT_VALUE = /^(?:inherit|currentColor|transparent|var\(--color-(?:text-[\w-]+|accent-text|(?:success|warning|danger)-text)\))(?:\s*!important)?$/;
const ON_ACCENT_BACKGROUND = /background(?:-color)?\s*:\s*var\(--color-(?:accent-primary|accent-primary-hover|danger)\)/;

const ALL_FILES = Object.freeze([...CSS_FILES, ...JS_FILES, 'index.html']);

function undefinedVars(file) {
    const used = [...readCode(file).matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
    return [...new Set(used.filter(name => !DEFINED.has(name)))].map(name => `未定義 ${name}`);
}

/** 檔案裡所有「文字色」的值。 */
function textColorValues(file) {
    const code = readCode(file);
    const values = [];
    if (file.endsWith('.css')) {
        for (const m of code.matchAll(/(?:^|[{;\s])color\s*:\s*([^;}]+)/g)) values.push(m[1].trim());
        return values;
    }
    // index.html 與 JS 模板字串裡的行內 style="…"
    for (const m of code.matchAll(/style="([^"]*)"/g)) {
        for (const d of m[1].matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)) values.push(d[1].trim());
    }
    // element.style.color = …（空字串＝清除，允許）
    for (const m of code.matchAll(/\.style\.color\s*=\s*([^;\n]+)/g)) {
        const raw = m[1].trim();
        if (raw === "''" || raw === '""') continue;
        values.push(raw.replace(/^['"`]|['"`]$/g, ''));
    }
    for (const m of code.matchAll(/setProperty\(\s*['"]color['"]\s*,\s*([^)]+)\)/g)) values.push(m[1].trim());
    return values;
}

function badTextColors(file) {
    return textColorValues(file).filter(v => !TEXT_VALUE.test(v)).map(v => `文字色 ${v}`);
}

function badOnAccent(file) {
    if (!file.endsWith('.css')) return [];
    return cssRules(read(file))
        .filter(r => /color\s*:\s*var\(--color-text-on-accent\)/.test(r.body) && !ON_ACCENT_BACKGROUND.test(r.body))
        .map(r => `白字沒有配強調色底：${r.selector}`);
}

function leftBars(file) {
    const hits = [...readCode(file).matchAll(/border-left(?:-color|-width|-style)?\s*:\s*([^;"}]+)/g)];
    return hits.map(m => `左側色條 border-left: ${m[1].trim()}`);
}

function violations(file) {
    return [...undefinedVars(file), ...badTextColors(file), ...badOnAccent(file), ...leftBars(file)];
}

test('[tokens] var() 只引用已定義的 token；文字色只用文字 token；白字只放在強調色底上；沒有左側色條', () => {
    const offenders = ALL_FILES
        .filter(file => !PENDING_TOKEN_FILES.includes(file))
        .map(file => [file, violations(file)])
        .filter(([, v]) => v.length > 0)
        .map(([file, v]) => `${file}: ${v.join('；')}`);
    assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('[tokens] 棘輪名單沒有過期項目（改乾淨就要移出名單）', () => {
    const stale = PENDING_TOKEN_FILES.filter(file => violations(file).length === 0);
    assert.deepEqual(stale, [], `已無違規，請從 PENDING_TOKEN_FILES 移除: ${stale.join(', ')}`);
});
```

- [ ] **Step 6：改寫 CLAUDE.md 的 Design Context**

在 `ROOT/CLAUDE.md` 裡，把 `### Aesthetic Direction` 到 `### Design Principles` 之前的整段（含最後的空行）換掉。原文：

```markdown
### Aesthetic Direction
> 2026-08-21 v4.6「muted coral」(palette C)。上一版 v4.4 coral-to-ice 的亮 coral 白字只有 3.6:1，使用者要求整體柔和；改動配色時請同步更新本節與 `css/styles.css` 的 `:root` tokens。

- **Theme:** Light "Precision Editorial" — ice blue-gray page background (#E5E9EB), white cards (#ffffff), no dark mode
- **Primary accent:** Muted coral (#A85555) — solid sidebar background, primary buttons, gradient panels (#A85555 → #8F4646); white text on it is 5.1:1. Hover goes one step **darker** (#8F4646), never lighter
- **Accent text on light surfaces:** #A83737 (6.4:1 on white) for values, card-title modifiers; #902F2F for info alerts on tinted backgrounds. Bright brand coral #F04E4E survives only as `--color-accent-brand` for chart lines
- **Secondary accents:** Emerald (#10b981) fills / #047857 text, Amber #f59e0b fills only — amber **text** is #92400e, amber panels #b45309 → #92400e; Red (#dc2626) for errors
- **Text:** Deep warm slate, never pure black — primary #1a1a2e, secondary #3d3d5c, muted #5a5a78; sidebar nav is pure white at 0.9375rem (≈16px) with a 3px white inset bar on the active item
- **Typography:** Inter + Noto Sans TC for UI text (Google Fonts), JetBrains Mono with `tabular-nums` for scientific values and sequences; `html { font-size: 17px }`
- **Icons:** No decorative icon system (scientific emoji removed in 6697dd9; section markers and export-button emoji removed in batch 3, 2026-08-22). Only state/semantic glyphs remain: 🔒/🔓 lock state, ☰ menu, ⚠️/✓ in result text — don't add new ones
- **Visual effects:** Flat cards with 1px borders (#d4d8dc) and 3/6/8px radii; coral-tinted shadows (rgba(168,85,85,…)); fast transitions (120/200ms ease-out); `backdrop-filter: blur(4px)` only on the modal overlay — no glassmorphism on cards, no hover lifts
- **Layout:** Fixed 240px sidebar (collapsible to 56px, state persisted), 4px spacing scale
- **Contrast rule:** every text/background pair ≥ 4.5:1 (UI components ≥ 3:1). Never put white text on a tint lighter than #A85555; never use #f59e0b / #10b981 / #F04E4E as text
- **Anti-references:** Avoid looking like a generic dashboard template, overly playful consumer apps, or cluttered legacy lab software

```

改成：

```markdown
### Aesthetic Direction
> 2026-10 v5.0 Apple-style redesign（規格 `docs/superpowers/specs/2026-10-14-apple-redesign-design.md`）：macOS 原生骨架（毛玻璃側欄、分組圓角輸入列、系統字）＋ muted coral 強調色，淺色與深色兩個主題；v5.1 再加大數字結果磚。改動配色時同步更新本節、`css/tokens.css` 與 `js/chart-theme.js`。

- **Theme:** Light + dark. Follows the system (`prefers-color-scheme`) with a manual 自動／淺色／深色 control in the sidebar (localStorage `tps13a-theme`). `js/theme-init.js` sets `<html data-theme>` synchronously in `<head>`, before any stylesheet. Dark tokens live in two byte-identical blocks (`:root:not([data-theme="light"])` and `:root[data-theme="dark"]`), both inside `@media screen`, so printing always uses the light values
- **Surfaces:** page #F5F5F7 / #121214; cards #FFFFFF / #1E1E21, borderless with the `--shadow-sm` 0.5px hairline; tertiary #F0F0F3 / #2A2A2E for inputs, info panels, result items, secondary buttons and segmented-control tracks. Tiles that sit inside a card use tertiary (never white on white)
- **Accent:** Muted coral #A85555. `--color-accent-primary` / `-hover` are **fills only** (primary buttons, the selected nav pill). Hover goes darker in light (#8F4646) and lighter in dark (#B05A5A) — darkening in dark mode would drop the button to 2.5:1 against the card. Coral **text** is always `--color-accent-text` (#A83737 / #EE9090)
- **Semantic colours:** success / warning / danger each have a fill, a `-text` and a `-bg` token. Text uses only the `-text` token, on its own `-bg`, a card, or tertiary
- **Text:** primary #1D1D1F / #F5F5F7, secondary #424245 / #D1D1D6, muted #636366 / #A1A1A6 (Apple's #6E6E73 is only 4.2:1 on input backgrounds). Sidebar nav stays 0.9375rem (≈16px, requested 2026-08)
- **Typography:** System font stack (-apple-system / SF Pro / PingFang TC, falling back to Inter + Noto Sans TC from Google Fonts); numbers use `tabular-nums`; JetBrains Mono only for sequences, file previews and formula notes; multi-line prose is justified by the zero-specificity `:where(...)` rule in `tokens.css`; `html { font-size: 17px }`
- **Icons:** No decorative icon system (scientific emoji removed in 6697dd9; section markers and export-button emoji removed in batch 3, 2026-08-22). Only state/semantic glyphs remain: 🔒/🔓 lock state, ☰ menu, ⚠️/✓ in result text — don't add new ones
- **Visual effects:** Frosted glass only on the sidebar (solid `--color-bg-sidebar` when unsupported or with reduced transparency) and the dialog backdrop; no left accent bars, no gradients, no hover lifts; radii 8 / 10 / 12 / 14 (dialog) / 18 (v5.1 tiles); fast transitions (120/200ms ease-out)
- **Charts:** All colours come from `js/chart-theme.js`. Chart files only tag datasets / scales / annotations with `tpsRole` or `tpsSeries` and create charts with `new Chart(canvas, ChartTheme.colorize(config))`. A theme change recolours live charts in place (zoom is kept); PNG export is always light on white. The series palette has 8 colours (dataviz-validated); the doughnut shows the top 7 + Others; channels beyond 8 reuse a colour with a dashed line. Coloured axes colour only the axis line — tick labels and titles stay in the text colour
- **Layout:** Fixed 240px sidebar (collapsible to 56px, state persisted), 4px spacing scale
- **Contrast rule:** Both themes: text ≥ 4.5:1, UI components ≥ 3:1 — `tests/contrast.test.js`. Fill tokens are never text and there are no left bars — `tests/token-usage.test.js`. Colour literals may appear only in `css/tokens.css` and `js/chart-theme.js` — `tests/no-color-literals.test.js`
- **Chart.js load order:** The CDN scripts are `defer`, so `Chart` does not exist while local scripts run; touch `Chart` only at call time
- **Anti-references:** Avoid looking like a generic dashboard template, overly playful consumer apps, or cluttered legacy lab software

```

同一檔的 Design Principles 第 1 條，原文：

```markdown
1. **Clarity over decoration** — Every visual element must serve comprehension. Scientific data should be immediately readable with clear hierarchy: labels, values (monospace), and units.
```

改成：

```markdown
1. **Clarity over decoration** — Every visual element must serve comprehension. Scientific data should be immediately readable with clear hierarchy: labels, values (tabular figures), and units.
```

第 4 條，原文：

```markdown
4. **Accessible by default** — WCAG AA compliance. High-contrast slate text on light surfaces (≥4.5:1 for body text, ≥3:1 for large text and UI components — check coral #F04E4E before using it for text), proper form labels, semantic HTML. Must stay readable in dim experimental hutches and over remote desktop.
```

改成：

```markdown
4. **Accessible by default** — WCAG AA compliance in both themes (≥4.5:1 for body text, ≥3:1 for large text and UI components — enforced by `tests/contrast.test.js`), proper form labels, semantic HTML. Must stay readable in dim experimental hutches and over remote desktop.
```

- [ ] **Step 7：跑全部測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 190`、`ℹ fail 0`、`ℹ skipped 0`（183＋5＋2）

- [ ] **Step 8：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/css/tokens.css saxs-calculator/tests/contrast.test.js saxs-calculator/tests/token-usage.test.js CLAUDE.md
git commit -m "feat(css): v5.0 tokens with light and dark themes; contrast and token-usage tests"
```

---

## Task 3：layout.css

**規格：** §5.1、§5.2、§4.3（切換控制外觀）、§3.4（側欄毛玻璃後備）

**Files:**
- Modify（整檔改寫）: `saxs-calculator/css/layout.css`
- Modify: `saxs-calculator/tests/no-color-literals.test.js`、`saxs-calculator/tests/token-usage.test.js`（名單移除 `css/layout.css`）

這次改動的內容：
- 側欄改成毛玻璃。若瀏覽器不支援，或使用者要求減少透明度，就改用實色。
- 選中的導覽項改成珊瑚色膠囊，焦點框用正 offset。
- 卡片拿掉邊框、改用細邊陰影。卡片標題改成 17px、600。
- 刪除死碼：`.logo-icon`、`.page-title-icon`、`.card-title--purple`。
- 加上 `.theme-toggle` 的外觀（標記在 Task 7 才加）。

- [ ] **Step 1：改寫 layout.css**

寫入 `saxs-calculator/css/layout.css`（完整內容，照抄）：

```css
/* =============================================
   TPS13A SAXS Calculator — Layout
   頁面骨架：sidebar（毛玻璃）、主題切換、main content、卡片容器、grid 與其 media query
   ============================================= */

/* ===== Layout ===== */
.app-layout {
    display: flex;
    min-height: 100vh;
}

/* ===== Sidebar ===== */
.sidebar {
    width: var(--sidebar-width);
    background: var(--glass-sidebar);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    backdrop-filter: blur(20px) saturate(180%);
    border-right: 1px solid var(--color-separator);
    display: flex;
    flex-direction: column;
    position: fixed;
    height: 100vh;
    z-index: 100;
    transition: width var(--transition-normal), transform var(--transition-normal);
    overflow: hidden;
}

/* 不支援毛玻璃（含 Safari 17 以前只認 -webkit- 前綴的情況）或使用者要求減少透明度：改實色 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .sidebar {
        background: var(--color-bg-sidebar);
    }
}

@media (prefers-reduced-transparency: reduce) {
    .sidebar {
        background: var(--color-bg-sidebar);
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
    }
}

.sidebar.collapsed {
    width: var(--sidebar-collapsed-width);
}

.sidebar.collapsed .nav-section-title,
.sidebar.collapsed .sidebar-footer {
    opacity: 0;
    pointer-events: none;
    white-space: nowrap;
}

/* Collapsed rail (56px): the full label stays in the accessibility tree but is
   visually clipped, and data-short renders instead so the rail is still legible.
   Before this, 6697dd9 removed the icons and left 12 identical blank rectangles. */
.sidebar.collapsed .logo-text,
.sidebar.collapsed .nav-item-text {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.sidebar.collapsed .logo,
.sidebar.collapsed .nav-item {
    position: relative;
}

.sidebar.collapsed .logo::after,
.sidebar.collapsed .nav-item::after {
    content: attr(data-short);
    display: block;
    width: 100%;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.3;
    text-align: center;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sidebar.collapsed .logo::after {
    font-size: 0.8125rem;
    color: var(--color-text-primary);
}

.sidebar.collapsed .sidebar-header {
    padding: var(--spacing-lg) var(--spacing-sm) var(--spacing-md);
    justify-content: center;
}

.sidebar.collapsed .logo {
    justify-content: center;
}

.sidebar.collapsed .nav-item {
    justify-content: center;
    /* Narrow side padding: the 56px rail must fit 5-character labels
       ("Slice", "dn/dc") without ellipsis. */
    padding: var(--spacing-sm) 2px;
}

.sidebar.collapsed .sidebar-nav {
    padding: var(--spacing-sm) 0.25rem;
}

.sidebar.collapsed .sidebar-footer {
    padding: 0;
    height: 0;
    border: none;
    overflow: hidden;
}

/* 收合成 56px 時主題切換放不下：display:none 讓它同時離開 Tab 順序（opacity:0 不會） */
.sidebar.collapsed .theme-toggle {
    display: none;
}

.sidebar-header {
    padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
}

.logo {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
}

.logo-text {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text-primary);
    letter-spacing: -0.01em;
}

.sidebar-nav {
    flex: 1;
    padding: var(--spacing-sm) var(--spacing-sm);
    overflow-y: auto;
}

.sidebar-footer {
    padding: var(--spacing-md) var(--spacing-lg);
    border-top: 1px solid var(--color-separator);
    font-size: 0.75rem;
    color: var(--color-text-muted);
    letter-spacing: 0.02em;
    text-transform: uppercase;
}

.nav-section {
    margin-bottom: var(--spacing-md);
}

.nav-section-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.02em;
    padding: var(--spacing-sm) var(--spacing-md) var(--spacing-xs);
    line-height: 1.6;
}

/* Section title rendered as a real <button> (dn/dc unlock trigger).
   Only neutralises UA button styling that .nav-section-title does not already set —
   deliberately no `font:`/`color: inherit`, which would out-cascade the rule above. */
.nav-section-title--button {
    display: block;
    width: 100%;
    background: none;
    border: 0;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
}

.nav-section-title--button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
}

.nav-section-title--button[disabled] {
    cursor: default;
    opacity: 1;                  /* unlocked state is informational, keep it legible */
}

.nav-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    margin-bottom: 1px;
    background: none;
    border: none;
    width: 100%;
    font-family: var(--font-body);
    font-size: 0.9375rem;        /* ≈16px：2026-08 使用者要求放大過，維持 */
    font-weight: 500;
    text-align: left;
}

.nav-item:hover {
    background: var(--color-bg-hover);
}

/* 正 offset：選中膠囊本身就是 --color-focus 色，框畫在膠囊內會看不見 */
.nav-item:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}

.nav-item.active {
    background: var(--color-accent-primary);
    color: var(--color-text-on-accent);
    font-weight: 600;
}

.nav-item-text {
    font-size: inherit;
    font-weight: inherit;
}

/* ===== Theme toggle（側欄底部「自動／淺色／深色」分段控制；js/theme-toggle.js） ===== */
.theme-toggle {
    display: flex;
    gap: 2px;
    margin: 0 var(--spacing-md) var(--spacing-sm);
    padding: 2px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--color-bg-hover);
}

/* radio 視覺隱藏但保留在 Tab 順序與無障礙樹：方向鍵切換是原生 radio 行為 */
.theme-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.theme-toggle label {
    flex: 1;
    padding: 0.25rem 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}

.theme-toggle input:checked + label {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
}

.theme-toggle input:focus-visible + label {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}

/* ===== Main Content ===== */
.main-content {
    flex: 1;
    margin-left: var(--sidebar-width);
    padding: var(--spacing-2xl) var(--spacing-2xl) var(--spacing-3xl);
    max-width: calc(100vw - var(--sidebar-width));
    transition: margin-left var(--transition-normal), max-width var(--transition-normal);
}

.app-layout.sidebar-collapsed .main-content {
    margin-left: var(--sidebar-collapsed-width);
    max-width: calc(100vw - var(--sidebar-collapsed-width));
}

.page-header {
    margin-bottom: var(--spacing-2xl);
}

.page-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
    font-size: clamp(1.5rem, 2.5vw, 1.75rem);   /* ≈30px */
    font-weight: 700;
    letter-spacing: -0.02em;
}

.page-subtitle {
    color: var(--color-text-muted);
    font-size: 0.8125rem;
    margin-top: 0.125rem;
}

/* ===== Cards ===== */
/* 無邊框，靠 --shadow-sm 的 0.5px 細邊與頁面底分開（遠端桌面壓縮後仍看得到邊界） */
.card {
    background: var(--color-bg-card);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: var(--spacing-lg);
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
}

.card-title {
    /* Semantically h2 (fixes the h1 -> h3 skip) */
    font-family: var(--font-body);
    font-size: 1rem;             /* 17px */
    font-weight: 600;
    line-height: 1.3;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    letter-spacing: -0.01em;
    color: var(--color-text-primary);
}

.card-title--warning {
    color: var(--color-warning-text);
}

.card-body {
    /* Content area */
}

/* ===== Grid Layout ===== */
.grid {
    display: grid;
    gap: var(--spacing-lg);
}

.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 1200px) {
    .grid-4 { grid-template-columns: repeat(2, 1fr); }
    .grid-3 { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2：把 layout.css 移出兩張棘輪名單**

**(1)** 改 `saxs-calculator/tests/no-color-literals.test.js`。原文：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/components.css',
    'css/layout.css',
    'css/panels.css',
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

改成：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/components.css',
    'css/panels.css',
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

**(2)** 改 `saxs-calculator/tests/token-usage.test.js`。原文：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/components.css',
    'css/layout.css',
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

改成：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/components.css',
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

- [ ] **Step 3：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 190`、`ℹ fail 0`、`ℹ skipped 0`

- [ ] **Step 4：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/css/layout.css saxs-calculator/tests/no-color-literals.test.js saxs-calculator/tests/token-usage.test.js
git commit -m "feat(css): v5.0 layout — glass sidebar, borderless cards, theme toggle styles"
```

---

## Task 4：components.css

**規格：** §5.3、§5.4、§5.5、§5.6、§5.7、§5.9（結果項目）、§6.1（通道膠囊）

**Files:**
- Modify（整檔改寫）: `saxs-calculator/css/components.css`
- Modify: 兩張棘輪名單移除 `css/components.css`

這次改動的內容：
- **分組輸入列 `.form-list`：** 列表下方說明用 `.form-list-foot`。
  - 選擇器用 `.form-list > .form-group:not(.hidden)`：偵測器頁的 MW／Rg 兩列靠 `.hidden` 輪流顯示，不排除的話兩列會同時出現。
  - ≤480px 縮窄輸入框。
- **單位文字：** 單位不再與輸入框合成一個框。
- **分段控制：** `.mode-toggle` 與 `.tabs` 改成同一套分段控制。
- **表格：**
  - 表頭不填底色。
  - hover 改用 tertiary。
  - 新增 `.is-main-step`／`.frame-main`／`.mode-tm`／`.mode-other`，Task 9 會用到。
- **提示框：** 去掉邊框，`.alert-info` 改成中性灰底。
- **通道膠囊 `.channel-chip`：** `color-mix()` 包在 `@supports` 裡。
- **`.result-value--key`：** 新增。
- **刪除死碼：**
  - `.btn-success`、`.btn-icon`
  - `.copy-*`、`.copied`
  - `.loading`、`.spinner`、`@keyframes spin`
  - `.sequence-display`、`.chart-container-lg`

- [ ] **Step 1：改寫 components.css**

寫入 `saxs-calculator/css/components.css`（完整內容，照抄）：

```css
/* =============================================
   TPS13A SAXS Calculator — Components
   分段控制、表單（含分組列表）、按鈕、tabs、表格、圖表容器與通道膠囊、結果項目、alert、徽章
   ============================================= */

/* ===== Mode Toggle（蘋果分段控制） ===== */
.mode-toggle {
    display: flex;
    gap: 2px;
    padding: 2px;
    margin-bottom: var(--spacing-md);
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
}

.mode-toggle .btn {
    flex: 1;
    padding: var(--spacing-sm);
    font-size: 0.8125rem;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
}

.mode-toggle .btn:not(.active):hover {
    background: var(--color-bg-hover);
}

.mode-toggle .btn.active {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
}

/* ===== Form Elements ===== */
.form-group {
    margin-bottom: var(--spacing-lg);
}

.form-group--compact {
    margin-bottom: 0.75rem;
}

.form-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: var(--spacing-xs);
    letter-spacing: 0.01em;
}

.form-label--sm {
    font-size: 0.6875rem;
}

.form-input,
.form-textarea,
.form-select {
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: var(--color-bg-tertiary);
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: 0.875rem;
    transition: background var(--transition-fast);
}

.form-input[type="number"] {
    font-variant-numeric: tabular-nums;
}

.form-input:focus-visible,
.form-textarea:focus-visible,
.form-select:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}

.form-input::placeholder,
.form-textarea::placeholder {
    color: var(--color-text-muted);
}

/* 檔案上傳：虛線外框標出「可放檔案」的區域 */
.form-input[type="file"] {
    background: var(--color-bg-card);
    border: 1px dashed var(--color-border);
    padding: 0.5rem 0.75rem;
    cursor: pointer;
}

.form-textarea {
    min-height: 120px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.6;
}

/* 數字＋單位：單位是輸入框右邊的淡色文字（不再與輸入框合成一個框） */
.form-input-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
}

.form-input-group .form-input {
    flex: 1 1 auto;
    min-width: 0;
}

.form-input--inline {
    background: transparent;
    border: 1px solid transparent;
    border-bottom: 1px dashed var(--color-border);
    border-radius: 0;
    padding: 0.125rem 0.25rem;
    font-size: inherit;
    font-family: inherit;
    color: inherit;
    width: auto;
    min-width: 6rem;
}

.form-input--inline:focus-visible {
    border-color: transparent;
    border-radius: var(--radius-sm);
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}

.input-unit {
    flex: 0 0 auto;
    min-width: 3.5em;              /* 空單位也佔位，同一卡片的數字才對得齊 */
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
}

/* ===== Grouped form list（macOS 設定式分組列表，v5.0） =====
   index.html 把連續的「數字＋單位」欄位包進 .form-list。label、id、for、aria 一律不變。 */
.form-list {
    margin-bottom: var(--spacing-md);
    padding-left: 14px;            /* 分隔線左側內縮 14px（iOS 樣式） */
    border: 1px solid var(--color-separator);
    border-radius: var(--radius-lg);
}

/* :not(.hidden)：偵測器頁的 MW／Rg 兩列靠 .hidden 輪流顯示，而 .form-list > .form-group
   的特異性比 .hidden 高——不排除的話兩列會同時出現。 */
.form-list > .form-group:not(.hidden) {
    display: flex;
    flex-wrap: wrap;               /* 窄螢幕放不下時，輸入框換到下一行靠右 */
    align-items: center;
    column-gap: var(--spacing-md);
    row-gap: var(--spacing-xs);
    min-height: 44px;
    margin: 0;
    padding: 6px 14px 6px 0;
}

/* 分隔線只畫在「兩個可見列之間」：隱藏列不留空線 */
.form-list > .form-group:not(.hidden) ~ .form-group:not(.hidden) {
    border-top: 1px solid var(--color-separator);
}

.form-list .form-label {
    flex: 1 1 9rem;
    min-width: 0;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--color-text-primary);
}

.form-list .form-input-group {
    flex: 0 0 auto;
    margin-left: auto;
}

.form-list .form-input {
    flex: 0 0 auto;
    width: 8.5rem;                 /* 約 9ch；中文 placeholder（例：「輸入分子量...」）也放得下 */
    padding: 0.4375rem 0.625rem;
    text-align: right;
}

/* 手機（390px 寬時列內約 264px）：標籤基準 5rem＋間距 0.5rem＋輸入框 6rem＋單位 ≈ 249px，
   短標籤與輸入框留在同一列；長標籤在標籤內換行 */
@media (max-width: 480px) {
    .form-list > .form-group:not(.hidden) {
        column-gap: var(--spacing-sm);
    }

    .form-list .form-label {
        flex-basis: 5rem;
    }

    .form-list .form-input {
        width: 6rem;
    }
}

.form-list-foot {
    margin: calc(-1 * var(--spacing-sm)) 0 var(--spacing-md);
    padding: 0 14px;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--color-text-muted);
}

/* ===== Buttons ===== */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    padding: 0.625rem var(--spacing-lg);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition-fast);
}

.btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}

.btn-primary {
    background: var(--color-accent-primary);
    color: var(--color-text-on-accent);
}

/* 淺色變暗、深色變亮（token 已依主題定好）；不位移、不縮放 */
.btn-primary:hover {
    background: var(--color-accent-primary-hover);
}

.btn-secondary {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
}

.btn-secondary:hover {
    background: var(--color-bg-hover);
}

/* disabled：暫時無法操作（例如檔案尚未載入）——壓淡並取消 hover 變化 */
.btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.btn-primary:disabled:hover {
    background: var(--color-accent-primary);
}

.btn-secondary:disabled:hover {
    background: var(--color-bg-tertiary);
}

.btn-sm {
    min-height: 1.875rem;          /* ≈32px */
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
}

.btn-lg {
    padding: 0.75rem var(--spacing-xl);
    font-size: 0.9375rem;
}

/* 主要操作 44px；.btn-sm 刻意較小（放在表格列與卡片裡），仍高於 WCAG 2.2 AA 的 24px 下限 */
.btn:not(.btn-sm) {
    min-height: 2.625rem;
}

.nav-item {
    min-height: 2.5rem;
}

.btn-full {
    width: 100%;
}

/* ===== Tabs（蘋果分段控制，與 .mode-toggle 同一套外觀） ===== */
.tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    margin-bottom: var(--spacing-lg);
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
}

.tabs--inline {
    margin: 0;
}

.tab {
    flex: 1;
    padding: 0.3125rem var(--spacing-md);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-body);
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}

.tab:hover {
    color: var(--color-text-primary);
}

.tab:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}

.tab.active {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
}

/* ===== Tables ===== */
.table-wrapper {
    overflow-x: auto;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
}

/* tabindex="0" makes the overflow area reachable (Safari has no built-in
   scroll-container focus); it needs a matching focus ring. */
.table-wrapper:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}

.table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
}

.table th,
.table td {
    padding: 0.625rem var(--spacing-md);
    text-align: left;
    border-bottom: 1px solid var(--color-separator);
}

.table th {
    font-weight: 600;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    letter-spacing: 0.02em;
}

.table caption {
    text-align: left;
    padding: 0.5rem var(--spacing-md);
}

.table td.text-right,
.table th.text-right {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.table td.text-center {
    text-align: center;
}

/* hover 用 tertiary 而不是 --color-bg-hover：淺色 success-text 在 #E8E8ED 上只有 4.49:1 */
.table tbody tr:hover {
    background: var(--color-bg-tertiary);
}

.table tbody tr:last-child td {
    border-bottom: none;
}

.table-section-header td {
    background: var(--color-bg-tertiary);
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--color-text-primary);
}

/* Flow-rate switch points: the rows a scientist actually has to act on. */
.table tbody tr.flow-rate-row--note,
.table tbody tr.flow-rate-row--note:hover {
    background: var(--color-accent-tint);
}

.flow-rate-row--note td {
    font-weight: 600;
}

.flow-rate-row--note td:last-child {
    color: var(--color-accent-text);
}

/* Detector Setting 表（section-hplc.js）：第 4 步是主要收數據的步驟。
   :hover 也要寫：.table tbody tr:hover 的特異性比單一 class 高，會把底色蓋掉。 */
.table tbody tr.is-main-step,
.table tbody tr.is-main-step:hover {
    background: var(--color-warning-bg);
}

.table td.frame-main {
    color: var(--color-warning-text);
    font-weight: 700;
}

.table td.mode-tm {
    color: var(--color-accent-text);
    font-weight: 600;
}

.table td.mode-other {
    color: var(--color-success-text);
    font-weight: 600;
}

/* ===== Charts ===== */
.chart-container {
    position: relative;
    height: 300px;
    width: 100%;
}

/* HPLC dn/dc 全通道預覽的通道開關（dndc-hplc-results.js）。
   --chip-color 由 JS 依目前主題設定（ChartTheme.seriesColor）；文字一律用文字 token，
   顏色只出現在與圖線同色同線型的小樣本上。 */
.channel-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--color-separator);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
}

.channel-chip::before {
    content: '';
    width: 14px;
    border-top: 2px solid var(--chip-color, var(--color-text-muted));
}

/* 第 9 個以後的通道重用系列色，改用虛線區分（與圖線一致） */
.channel-chip--dashed::before {
    border-top-style: dashed;
}

.channel-chip input {
    margin: 0;
}

.channel-chip.is-on {
    border-color: var(--chip-color, var(--color-border));
    background: var(--color-bg-tertiary);
}

/* color-mix() 需要 Chrome 111／Safari 16.2／Firefox 113。宣告裡有 var()，不支援的瀏覽器不會
   跳過這行而是在繪製時整個變透明，所以一定要包在 @supports 裡，外面的 tertiary 是後備。 */
@supports (background: color-mix(in srgb, red 50%, transparent)) {
    .channel-chip.is-on {
        background: color-mix(in srgb, var(--chip-color) 12%, transparent);
    }
}

/* ===== Result Display ===== */
.result-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--spacing-sm);
}

.result-item {
    background: var(--color-bg-tertiary);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
}

.result-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.02em;
    margin-bottom: 0.125rem;
}

.result-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
}

/* 該頁的關鍵數值（dn/dc 理論頁的最終值與 Lorentz-Lorenz 值） */
.result-value--key {
    font-size: 1.25rem;
    color: var(--color-accent-text);
}

/* 數值下方的一行說明（單位別名、適用場合） */
.result-note {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    line-height: 1.4;
    margin-top: 0.25rem;
}

/* ===== Sequence Meta Row ===== */
.sequence-meta {
    display: flex;
    justify-content: space-between;
    margin-top: var(--spacing-sm);
}

/* ===== Alerts ===== */
.alert {
    padding: 12px 14px;
    border-radius: var(--radius-lg);
    margin-bottom: var(--spacing-md);
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-sm);
    font-size: 0.8125rem;
    line-height: 1.5;
}

.alert--compact {
    padding: var(--spacing-sm) 12px;
    font-size: 0.75rem;
}

/* 一般提示用中性灰底與主要文字色，不跟強調色搶 */
.alert-info {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
}

.alert-success {
    background: var(--color-success-bg);
    color: var(--color-success-text);
}

.alert-warning {
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
}

.alert-error {
    background: var(--color-danger-bg);
    color: var(--color-danger-text);
}

/* .alert 設了 display:flex，會蓋掉瀏覽器預設的 [hidden]{display:none} —— 不補這條，
   帶 hidden 屬性的警告會一直露出來。 */
.alert[hidden] {
    display: none;
}

/* 同上：.btn 的 display:inline-flex 會蓋掉 [hidden] 的預設值 */
.btn[hidden] {
    display: none;
}

/* ===== Inline Badges（數值旁的狀態標籤） ===== */
.info-panel-badge {
    display: inline-block;
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    margin-left: 6px;
    vertical-align: middle;
    white-space: nowrap;
}

/* 同上：display 會蓋掉 [hidden] 的預設值 */
.info-panel-badge[hidden] {
    display: none;
}

.info-panel-badge--warn {
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
}
```

- [ ] **Step 2：把 components.css 移出兩張棘輪名單**

**(1)** 改 `saxs-calculator/tests/no-color-literals.test.js`。原文：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/components.css',
    'css/panels.css',
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

改成：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/panels.css',
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

**(2)** 改 `saxs-calculator/tests/token-usage.test.js`。原文：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/components.css',
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

改成：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

- [ ] **Step 3：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 190`、`ℹ fail 0`、`ℹ skipped 0`

- [ ] **Step 4：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/css/components.css saxs-calculator/tests/no-color-literals.test.js saxs-calculator/tests/token-usage.test.js
git commit -m "feat(css): v5.0 components — grouped form lists, segmented controls, tables, alerts"
```

---

## Task 5：panels.css

**規格：** §5.9（以及「規劃時的決定」第 5、6 點）

**Files:**
- Modify（整檔改寫）: `saxs-calculator/css/panels.css`
- Modify: 兩張棘輪名單移除 `css/panels.css`

這次改動的內容：
- **漸層：** 7 個漸層全部拿掉，`--purple`／`--pink`／`--success`／`--warning` 等修飾規則一併刪除；index.html 的修飾 class 在 Task 8 清掉。
- **磚的底色：**
  - 卡片裡的磚用 tertiary。
  - `#proteinStats`（直接在頁面上）用白色磚。
  - 數值改用 `--color-accent-text`。
- **兩個理論值面板：**
  - 改成中性 tertiary。
  - 面板內數值格用卡片色。
  - 強調格是淡珊瑚疊在卡片色上：用 `background-image` 疊一層純色，不是視覺漸層。
- **資料來源 chip：** 序列預測、手動、實測三種各用一組配色。
- **死碼：** 刪除 `.info-panel-source`。

- [ ] **Step 1：改寫 panels.css**

寫入 `saxs-calculator/css/panels.css`（完整內容，照抄）：

```css
/* =============================================
   TPS13A SAXS Calculator — Stat & Info Panels
   數值磚（stat-card／gradient-stat／result-card）、理論值與偵測器建議面板、資料來源 chip
   v5.0：拿掉漸層與色條，改成中性磚；v5.1 再換成 .tile 結果磚。
   ============================================= */

/* ===== Stat Cards ===== */
/* 直接放在頁面底上（#proteinStats）時是白色磚 */
.stat-card {
    background: var(--color-bg-card);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: var(--spacing-md) var(--spacing-lg);
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
}

/* 放在卡片裡（dn/dc、脂質體結果區）時白底疊白底看不出磚，改淺灰底、不加陰影 */
.card .stat-card {
    background: var(--color-bg-tertiary);
    box-shadow: none;
}

.stat-content {
    flex: 1;
    min-width: 0;
}

.stat-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.02em;
    margin-bottom: 0.125rem;
}

.stat-value {
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--color-accent-text);
    line-height: 1.2;
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
}

.stat-unit {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--color-text-muted);
    margin-left: 0.25rem;
    font-family: var(--font-body);
}

.stat-sub {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-top: 0.125rem;
}

/* ===== Gradient Stat（HPLC 頁的 Fraction Collector 與 pre-run 建議值；名稱沿用，已無漸層） ===== */
.gradient-stat {
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-lg);
    padding: var(--spacing-md) var(--spacing-lg);
}

/* ===== Info Panels（理論預測值／偵測器距離建議） ===== */
/* 兩個面板都用中性灰底：顏色只留在資料來源 chip 與警告上（理論值不是「成功」） */
.info-panel {
    padding: var(--spacing-md);
    border-radius: var(--radius-lg);
    margin-top: var(--spacing-sm);
    background: var(--color-bg-tertiary);
}

.info-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
}

.info-panel-title {
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
}

.info-panel-header-right {
    display: flex;
    align-items: center;
    gap: 0.3rem;
}

.info-panel-header-label {
    color: var(--color-text-muted);
    font-size: 0.75rem;
}

/* 面板是 tertiary 底，輸入框改用卡片色才看得出來 */
.info-panel-mw-input {
    width: 80px;
    padding: 0.2rem 0.4rem;
    font-size: 0.75rem;
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
    background: var(--color-bg-card);
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    text-align: right;
}

.info-panel-mw-input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}

.info-panel-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-sm);
}

.info-panel-item {
    background: var(--color-bg-card);
    padding: var(--spacing-sm);
    border-radius: var(--radius-sm);
    text-align: center;
}

/* 淡珊瑚疊在卡片色上（單層色，不是視覺漸層）：直接疊在 tertiary 面板上，深色模式的
   灰色單位字只剩 4.3:1 */
.info-panel-item--highlight {
    background-color: var(--color-bg-card);
    background-image: linear-gradient(var(--color-accent-tint), var(--color-accent-tint));
}

.info-panel-label {
    color: var(--color-text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.03em;
}

.info-panel-label--highlight {
    color: var(--color-accent-text);
}

.info-panel-value {
    color: var(--color-text-primary);
    font-size: 1rem;
    font-weight: 600;
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
}

.info-panel-value--sm {
    font-size: 0.85rem;
}

.info-panel-unit {
    color: var(--color-text-muted);
    font-size: 0.75rem;
}

/* 理論 I(0) 的濃度錯誤訊息（section-saxs.js 切換） */
.info-panel-unit.is-error {
    color: var(--color-danger-text);
}

.info-panel-formula {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    margin-top: var(--spacing-sm);
    line-height: 1.4;
}

/* ===== Detector-distance panel: Rg source chip / inline input / links ===== */
/* 序列預測（預設）＝強調色淡底；手動＝警告色；Guinier 實測＝成功色 */
.info-panel-chip {
    display: inline-block;
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-pill);
    background: var(--color-accent-tint);
    color: var(--color-accent-text);
    white-space: nowrap;
}

.info-panel-chip--manual {
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
}

.info-panel-chip--measured {
    background: var(--color-success-bg);
    color: var(--color-success-text);
}

/* display:inline-block 蓋掉了瀏覽器預設的 [hidden]{display:none}——
   不補這條，帶 hidden 屬性的 chip 會一直露出來（同 .alert / .info-panel-badge）。 */
.info-panel-chip[hidden] {
    display: none;
}

/* 表單標籤旁的來源 chip（HPLC dn/dc 頁的 ε）：配色與面板版相同，只調位置 */
.form-label .info-panel-chip {
    vertical-align: middle;
    margin-left: 6px;
}

.info-panel-mw-input--rg {
    width: 64px;
    text-align: right;
}

.info-panel-hint {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    background: var(--color-bg-card);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.5rem;
    margin: -0.25rem 0 0.5rem;
}

/* 行程警告 */
.info-panel-hint--warn {
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
    margin: var(--spacing-sm) 0 0;   /* 這一則掛在數值格線「之下」，不沿用 hint 的負上邊距 */
}

.info-panel-formula--row {
    display: flex;
    justify-content: space-between;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    align-items: baseline;
}

.info-panel-links {
    display: inline-flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
}

.info-panel-link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--color-accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    white-space: nowrap;
}

.info-panel-link:hover {
    text-decoration-thickness: 2px;
}

.info-panel-link:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: 2px;
}

/* ===== Result Cards（偵測器距離頁；放在卡片裡，用淺灰磚） ===== */
.result-card {
    padding: var(--spacing-md);
    border-radius: var(--radius-lg);
    background: var(--color-bg-tertiary);
    text-align: center;
}

.result-card-label {
    color: var(--color-text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    margin-bottom: var(--spacing-xs);
}

.result-card-value {
    color: var(--color-accent-text);
    font-size: 1.375rem;
    font-weight: 600;
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
}

.result-card-unit {
    color: var(--color-text-muted);
    font-size: 0.6875rem;
    margin-top: 0.125rem;
}

.result-card--lg {
    padding: var(--spacing-lg);
    margin-top: var(--spacing-md);
}

.result-card--lg .result-card-label {
    font-size: 0.75rem;
}

.result-card--lg .result-card-value {
    font-size: 1.75rem;
}

.result-card--lg .result-card-unit {
    font-size: 0.75rem;
}
```

- [ ] **Step 2：把 panels.css 移出兩張棘輪名單**

**(1)** 改 `saxs-calculator/tests/no-color-literals.test.js`。原文：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/panels.css',
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

改成：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

**(2)** 改 `saxs-calculator/tests/token-usage.test.js`。原文：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/panels.css',
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

改成：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

- [ ] **Step 3：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 190`、`ℹ fail 0`、`ℹ skipped 0`

- [ ] **Step 4：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/css/panels.css saxs-calculator/tests/no-color-literals.test.js saxs-calculator/tests/token-usage.test.js
git commit -m "feat(css): v5.0 panels — neutral tiles and info panels"
```

---

## Task 6：sections.css

**規格：** §3.4（列印）、§5.8、§5.10（`.num`）

**Files:**
- Modify（整檔改寫）: `saxs-calculator/css/sections.css`
- Modify: 兩張棘輪名單移除 `css/sections.css`（之後兩張名單都只剩 JS 檔）

這次改動的內容：
- **改用 token：** 側欄遮罩、對話框遮罩改用 `--color-backdrop`；對話框改用 `--radius-dialog` 與 `--shadow-md`。
- **列印：** 列印區塊的兩個色碼換成 token。`background: white` 保留：規格寫明列印規則不動，具名顏色也不在掃描範圍。
- **新增 utility：** `.num`（tabular-nums）與 `.mb-md`。
- **IUCr 表：** 寫死的字型改用 `--font-body`。

- [ ] **Step 1：改寫 sections.css**

寫入 `saxs-calculator/css/sections.css`（完整內容，照抄）：

```css
/* =============================================
   TPS13A SAXS Calculator — Sections & Utilities
   區段分隔、公式註記、快速參考、page section、utility class、responsive、IUCr 表、modal、列印（最後載入，覆寫順序不可提前）
   ============================================= */

/* ===== Section Divider ===== */
.section-divider {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    margin: var(--spacing-xl) 0;
}

.section-divider--compact {
    margin: var(--spacing-sm) 0;
}

.section-divider::before,
.section-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-separator);
}

.section-divider span {
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--color-text-muted);
    letter-spacing: 0.1em;
}

/* ===== Formula Note ===== */
.formula-note {
    margin-top: 0.75rem;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    line-height: 1.5;
    font-family: var(--font-mono);
}

/* ===== Report Stoptime Box ===== */
.report-stoptime-box {
    margin-top: var(--spacing-md);
    padding: 0.75rem var(--spacing-md);
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-lg);
    display: flex;
    align-items: baseline;
    gap: var(--spacing-sm);
    font-size: 0.8125rem;
}

.report-stoptime-value {
    color: var(--color-accent-text);
    font-size: 1.125rem;
    font-weight: 600;
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
}

/* ===== Quick Reference ===== */
.quick-ref {
    margin-top: var(--spacing-lg);
    padding: var(--spacing-md);
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-lg);
}

.quick-ref-title {
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
    margin-bottom: var(--spacing-sm);
}

.quick-ref-body {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.7;
}

/* ===== Suggested Values Flex ===== */
.suggested-values {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
}

.suggested-values > * {
    flex: 1;
    min-width: 150px;
}

/* ===== Detector Result Grid ===== */
.detector-result-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-sm);
}

/* ===== Page Sections ===== */
.section {
    display: none;
}

.section.active {
    display: block;
    animation: fadeIn 0.25s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Results containers receive programmatic focus after a calculation so keyboard
   and screen-reader users land on the new output. */
[tabindex="-1"]:focus {
    outline: none;
}

[tabindex="-1"]:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
    border-radius: var(--radius-lg);
}

/* ===== Utility Classes ===== */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
}

.mt-sm { margin-top: var(--spacing-sm); }
.mt-md { margin-top: var(--spacing-md); }
.mt-lg { margin-top: var(--spacing-lg); }
.mb-md { margin-bottom: var(--spacing-md); }
.hidden { display: none; }

/* 數字等寬（結果值、表格數字欄）；--font-mono 只留給序列、檔案預覽與公式 */
.num { font-variant-numeric: tabular-nums; }

.mobile-menu-btn {
    display: none;
    position: fixed;
    top: var(--spacing-md);
    left: var(--spacing-md);
    z-index: 101;
    width: 40px;
    height: 40px;
    background: var(--color-bg-card);
    border: 0;
    box-shadow: var(--shadow-sm);
    border-radius: var(--radius-md);
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--color-text-primary);
    font-size: 1.125rem;
}

.mobile-menu-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}

/* Mobile Sidebar Overlay */
.sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: var(--color-backdrop);
    z-index: 99;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--transition-normal), visibility var(--transition-normal);
}

.sidebar-overlay.active {
    opacity: 1;
    visibility: visible;
}

/* ===== Responsive =====
   NOTE: .mobile-menu-btn / .sidebar-overlay base rules are declared ABOVE this
   block on purpose. They used to come after it, so the same-specificity
   `display: none` always won and the hamburger never appeared below 1024px. */
@media (max-width: 1024px) {
    .sidebar {
        transform: translateX(-100%);
    }

    .sidebar.open {
        transform: translateX(0);
    }

    /* Top padding clears the 40px fixed hamburger so the h1 is never covered. */
    .main-content {
        margin-left: 0;
        max-width: 100vw;
        padding: calc(var(--spacing-md) + 40px + var(--spacing-md)) var(--spacing-lg) var(--spacing-3xl);
    }

    .mobile-menu-btn {
        display: flex;
    }

    .sidebar-overlay {
        display: block;
    }
}

/* ===== IUCr Table Style ===== */
.iucr-table {
    font-family: var(--font-body);
    font-size: 0.875rem;
}

.iucr-table th {
    font-style: italic;
}

/* ===== Reduced Motion ===== */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }

    html {
        scroll-behavior: auto;
    }
}

/* ===== Sidebar Toggle ===== */
.sidebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: var(--spacing-sm) 0;
    border: none;
    border-top: 1px solid var(--color-separator);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 1rem;
    transition: color var(--transition-fast), background var(--transition-fast);
}

.sidebar-toggle:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
}

.sidebar-toggle:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
}

/* ===== Export Buttons ===== */
.export-buttons {
    display: flex;
    gap: 0.375rem;
}

/* ===== Modal (native <dialog>: focus trap, Escape and inert background are free) ===== */
.modal-dialog {
    /* margin: auto restores the UA centring that the global `* { margin: 0 }`
       reset would otherwise strip from <dialog>. */
    margin: auto;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    width: min(360px, calc(100% - 2 * var(--spacing-lg)));
    max-width: 360px;
    overflow: visible;
}

/* ::backdrop 從 Chrome 122／Safari 17.4／Firefox 120 起才繼承自訂屬性；更舊的瀏覽器遮罩色會變透明，
   blur 仍在，對話框照常可用 */
.modal-dialog::backdrop {
    background: var(--color-backdrop);
    backdrop-filter: blur(4px);
}

.modal-content {
    background: var(--color-bg-card);
    border-radius: var(--radius-dialog);
    padding: 1.5rem;
    width: 100%;
    box-shadow: var(--shadow-md);
}

/* h2 for correct outline order; keeps the previous h3 visual weight */
.modal-title {
    font-family: var(--font-body);
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: normal;
    margin-bottom: 0.75rem;
}

.modal-desc {
    margin-bottom: 1rem;
    color: var(--color-text-secondary);
}

.modal-hint {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    margin: 0 0 0.75rem;
}

.modal-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
}

/* ===== Print Styles ===== */
/* tokens.css 的深色區塊限定 screen，列印時 token 一律是淺色值 */
@media print {
    .sidebar,
    .mobile-menu-btn,
    .sidebar-overlay,
    .skip-link {
        display: none !important;
    }

    .main-content {
        margin-left: 0;
        max-width: 100%;
    }

    body {
        background: white;
        color: var(--color-text-primary);
    }

    .card {
        border: 1px solid var(--color-border);
        background: white;
        break-inside: avoid;
    }
}
```

- [ ] **Step 2：把 sections.css 移出兩張棘輪名單**

**(1)** 改 `saxs-calculator/tests/no-color-literals.test.js`。原文：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'css/sections.css',
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

改成：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

**(2)** 改 `saxs-calculator/tests/token-usage.test.js`。原文：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'css/sections.css',
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

改成：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

- [ ] **Step 3：跑測試並確認行數**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)" && wc -l saxs-calculator/css/*.css`
Expected: `ℹ pass 190`、`ℹ fail 0`、`ℹ skipped 0`；每個 CSS 檔都 ≤ 800 行（最大的是 components.css，約 600 行）

- [ ] **Step 4：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/css/sections.css saxs-calculator/tests/no-color-literals.test.js saxs-calculator/tests/token-usage.test.js
git commit -m "feat(css): v5.0 sections — overlay, dialog and print use tokens"
```

---

## Task 7：主題切換（theme-init.js、theme-toggle.js）

**規格：** §4

**Files:**
- Create: `saxs-calculator/js/theme-init.js`、`saxs-calculator/js/theme-toggle.js`、`saxs-calculator/tests/theme.test.js`
- Modify: `saxs-calculator/index.html`（`<head>` script、側欄 fieldset、`theme-toggle.js` 的 `<script>`）
- Modify: `saxs-calculator/js/app.js`、`saxs-calculator/tests/load.js`、`saxs-calculator/tests/structure.test.js`

重點：
- **`theme-init.js` 的位置：**
  - 是 `<head>` 裡唯一的本地 script，也是唯一的同步 script。
  - 排在 CSP meta 之後、第一個 stylesheet（Google Fonts）之前。
  - `src` 必須是 `<script>` 的第一個屬性：`structure.test.js` 用 `<script\s+src="` 比對。
- **在 Node 測試裡能直接載入：** 兩個新檔的頂層都只透過 IIFE 參數 `global` 存取 `document`／`localStorage`／`matchMedia`，而且只在 `global.document` 存在時才動 DOM。
- **與 form-persistence 不衝突：** 主題 radio 的 `value` 永遠等於 `defaultValue`，`form-persistence.js` 的自動存檔不會存到它們。

- [ ] **Step 1：先寫測試**

寫入 `saxs-calculator/tests/theme.test.js`（完整內容，照抄）：

```javascript
'use strict';
/**
 * 主題切換與圖表主題（改版規格 §4、§6、§8.1-4）。
 * theme-init.js 與 chart-theme.js 由 tests/load.js 在沒有 document 的 Node 環境載入——
 * 能載入本身就證明兩檔的頂層沒有碰 DOM／Chart。
 *
 * Run: node --test saxs-calculator/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ThemeInit } = require('./load.js');

/** 暫時把 window.document 換成只有 <html data-theme> 的 stub */
function withThemeAttr(value, fn) {
    const saved = window.document;
    window.document = { documentElement: { getAttribute: name => (name === 'data-theme' ? value : null) } };
    try {
        return fn();
    } finally {
        if (saved === undefined) delete window.document;
        else window.document = saved;
    }
}

// ---------------------------------------------------------------- ThemeInit
test('[theme] normalize：只有 light／dark 會保留，其他一律 auto', () => {
    assert.equal(ThemeInit.normalize('light'), 'light');
    assert.equal(ThemeInit.normalize('dark'), 'dark');
    for (const raw of [null, undefined, '', 'auto', 'Dark', 'system', '1']) {
        assert.equal(ThemeInit.normalize(raw), 'auto', String(raw));
    }
});

test('[theme] resolve：手動優先，自動跟系統', () => {
    assert.equal(ThemeInit.resolve('light', true), 'light');
    assert.equal(ThemeInit.resolve('dark', false), 'dark');
    assert.equal(ThemeInit.resolve('auto', true), 'dark');
    assert.equal(ThemeInit.resolve('auto', false), 'light');
});

test('[theme] effective：讀 data-theme；沒有 document 時是淺色', () => {
    assert.equal(ThemeInit.effective(), 'light');
    assert.equal(withThemeAttr('dark', () => ThemeInit.effective()), 'dark');
    assert.equal(withThemeAttr('light', () => ThemeInit.effective()), 'light');
});

test('[theme] localStorage 鍵名', () => {
    assert.equal(ThemeInit.STORAGE_KEY, 'tps13a-theme');
});
```

**(1)** 改 `saxs-calculator/tests/load.js`。原文：

```javascript
const LOAD_ORDER = Object.freeze([
    'form-utils.js',
```

改成：

```javascript
const LOAD_ORDER = Object.freeze([
    'theme-init.js',               // index.html 在 <head> 載入；頂層只在有 document 時才動 DOM
    'form-utils.js',
```

**(2)** 改 `saxs-calculator/tests/load.js`。原文：

```javascript
    LiposomeTable: window.LiposomeResultsTable,
};
```

改成：

```javascript
    LiposomeTable: window.LiposomeResultsTable,
    ThemeInit: window.ThemeInit,
};
```

在 `saxs-calculator/tests/structure.test.js` 的結尾（最後一行之後）加上：

```javascript
// ---------------------------------------------------------------- v5.0 主題
test('[structure] theme-init.js：<head> 唯一的本地 script、同步載入、在 CSP 之後與所有 stylesheet 之前', () => {
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
    const headLocal = [...head.matchAll(/<script\s+src="(js\/[^"?]+)/g)].map(m => m[1]);
    assert.deepEqual(headLocal, ['js/theme-init.js']);

    const tags = [...head.matchAll(/<script\s[^>]*>/g)].map(m => m[0]);
    const blocking = tags.filter(tag => !/\b(?:defer|async)\b/.test(tag));
    assert.equal(blocking.length, 1, `<head> 只能有一個同步 script：${blocking.join(' ')}`);
    assert.match(blocking[0], /js\/theme-init\.js/);

    const at = head.indexOf('js/theme-init.js');
    assert.ok(head.indexOf('Content-Security-Policy') < at, 'theme-init.js 必須在 CSP meta 之後');
    assert.ok(at < head.indexOf('rel="stylesheet"'), 'theme-init.js 必須在第一個 stylesheet 之前（避免深色使用者看到淺色閃一下）');
});
```

- [ ] **Step 2：跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL（`fail` > 0）。`tests/load.js` 讀不到 `theme-init.js`，所有用 load.js 的測試檔都會失敗；新的 structure 測試也會失敗。

- [ ] **Step 3：新增 theme-init.js**

寫入 `saxs-calculator/js/theme-init.js`（完整內容，照抄）：

```javascript
/**
 * TPS13A SAXS Calculator - 主題初始化（v5.0）
 *
 * 在 <head> 以同步 <script> 載入、排在所有 stylesheet 之前：第一次繪製前就把
 * <html data-theme> 設好，深色使用者才不會先看到淺色閃一下。
 *   - localStorage 'tps13a-theme' = 'light' | 'dark'；不存在或其他值 = 自動（跟隨系統）
 *   - 手動 → data-theme="light|dark"；自動 → 移除屬性，交給 tokens.css 的 media query
 *
 * 此時 form-utils.js 還沒載入，所以自己包 try/catch。頂層的設定動作只在有 document 時執行，
 * Node 測試（tests/load.js）可以直接載入本檔。
 */
(function attachThemeInit(global) {
    'use strict';

    const STORAGE_KEY = 'tps13a-theme';
    const DARK_QUERY = '(prefers-color-scheme: dark)';

    /** localStorage 原始值 → 'light' | 'dark' | 'auto' */
    function normalize(raw) {
        return raw === 'light' || raw === 'dark' ? raw : 'auto';
    }

    /** 使用者選擇＋系統是否深色 → 生效主題：手動優先，自動跟系統 */
    function resolve(choice, systemDark) {
        if (choice === 'light' || choice === 'dark') return choice;
        return systemDark ? 'dark' : 'light';
    }

    function systemPrefersDark() {
        return typeof global.matchMedia === 'function' && global.matchMedia(DARK_QUERY).matches;
    }

    /** 目前生效的主題（呼叫時才讀 DOM 與 matchMedia；沒有 document 時視為自動） */
    function effective() {
        const root = global.document && global.document.documentElement;
        const attr = root ? root.getAttribute('data-theme') : null;
        return resolve(normalize(attr), systemPrefersDark());
    }

    /** 讀使用者的選擇；儲存被封鎖時視為自動 */
    function readStored() {
        try {
            return normalize(global.localStorage.getItem(STORAGE_KEY));
        } catch (err) {
            console.warn('[theme] 無法讀取 localStorage，改用自動主題：', err && err.message ? err.message : err);
            return 'auto';
        }
    }

    /** 把選擇寫到 <html data-theme> */
    function apply(choice) {
        const root = global.document.documentElement;
        if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
        else root.removeAttribute('data-theme');
    }

    global.ThemeInit = Object.freeze({ STORAGE_KEY, DARK_QUERY, normalize, resolve, effective, readStored, apply });

    if (global.document) apply(readStored());
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4：新增 theme-toggle.js**

寫入 `saxs-calculator/js/theme-toggle.js`（完整內容，照抄）：

```javascript
/**
 * TPS13A SAXS Calculator - 側欄「自動／淺色／深色」切換（v5.0）
 *
 * index.html 的 <fieldset id="themeToggle"> 是三個原生 radio：方向鍵切換、Tab 進出都是瀏覽器內建行為。
 * 變更時寫 localStorage（FormUtils.safeLocal）、更新 <html data-theme>，並在 document 派發
 *   CustomEvent('tps:themechange', { detail: { theme: 'light' | 'dark' } })   // theme = 生效主題
 * 圖表（ChartTheme.init）與 HPLC 通道膠囊（initChannelChipTheme）靠這個事件換色。
 * 自動模式下系統外觀改變時也派發同一個事件。
 *
 * 由 app.js 的 DOMContentLoaded 呼叫 ThemeToggle.init()。
 */
(function attachThemeToggle(global) {
    'use strict';

    const EVENT = 'tps:themechange';

    function dispatch() {
        global.document.dispatchEvent(new CustomEvent(EVENT, { detail: { theme: ThemeInit.effective() } }));
    }

    /** 套用一個選擇：寫入儲存（失敗時本次頁面照樣切換，下次開頁回到自動）、更新屬性、派發事件 */
    function choose(choice) {
        const normalized = ThemeInit.normalize(choice);
        const saved = normalized === 'auto'
            ? FormUtils.safeLocal.remove(ThemeInit.STORAGE_KEY)
            : FormUtils.safeLocal.set(ThemeInit.STORAGE_KEY, normalized);
        if (!saved) console.warn('[theme] 無法儲存外觀設定，只在這次開頁有效');
        ThemeInit.apply(normalized);
        dispatch();
    }

    function init() {
        const fieldset = global.document.getElementById('themeToggle');
        if (!fieldset) return;

        const current = ThemeInit.readStored();
        fieldset.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.checked = radio.value === current;
            radio.addEventListener('change', () => {
                if (radio.checked) choose(radio.value);
            });
        });

        // 自動模式（沒有 data-theme）時跟著系統外觀變；手動模式不理會系統
        if (typeof global.matchMedia === 'function') {
            global.matchMedia(ThemeInit.DARK_QUERY).addEventListener('change', () => {
                if (!global.document.documentElement.hasAttribute('data-theme')) dispatch();
            });
        }
    }

    global.ThemeToggle = Object.freeze({ EVENT, init });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5：index.html——head、側欄、script 標籤**

**(1)** 改 `saxs-calculator/index.html`。原文：

```html
    <title>TPS13A SAXS Calculator</title>

    <!-- Google Fonts -->
```

改成：

```html
    <title>TPS13A SAXS Calculator</title>

    <!-- 主題初始化：必須是同步 script，且排在所有 stylesheet 之前——第一次繪製前就設好 data-theme，
         深色使用者才不會先看到淺色閃一下（tests/structure.test.js 檢查位置） -->
    <script src="js/theme-init.js?v=4.15"></script>

    <!-- Google Fonts -->
```

**(2)** 改 `saxs-calculator/index.html`。原文：

```html
            <!-- 版本號同時是所有本地 css/js 的 ?v=：bump 時兩者一起改（tests/structure.test.js 檢查） -->
            <div class="sidebar-footer">
```

改成：

```html
            <!-- 外觀：自動（跟隨系統）／淺色／深色，存在 localStorage（js/theme-toggle.js） -->
            <fieldset class="theme-toggle" id="themeToggle">
                <legend class="sr-only">外觀</legend>
                <input type="radio" name="theme" id="themeAuto" value="auto">
                <label for="themeAuto">自動</label>
                <input type="radio" name="theme" id="themeLight" value="light">
                <label for="themeLight">淺色</label>
                <input type="radio" name="theme" id="themeDark" value="dark">
                <label for="themeDark">深色</label>
            </fieldset>

            <!-- 版本號同時是所有本地 css/js 的 ?v=：bump 時兩者一起改（tests/structure.test.js 檢查） -->
            <div class="sidebar-footer">
```

**(3)** 改 `saxs-calculator/index.html`。原文：

```html
    <script src="js/a11y-utils.js?v=4.15"></script>
```

改成：

```html
    <script src="js/a11y-utils.js?v=4.15"></script>
    <script src="js/theme-toggle.js?v=4.15"></script>
```

- [ ] **Step 6：app.js 呼叫 ThemeToggle.init()**

改 `saxs-calculator/js/app.js`。原文：

```javascript
document.addEventListener('DOMContentLoaded', () => {
    initFormPersistence();
```

改成：

```javascript
document.addEventListener('DOMContentLoaded', () => {
    ThemeToggle.init();
    initFormPersistence();
```

- [ ] **Step 7：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 195`、`ℹ fail 0`、`ℹ skipped 0`（190＋theme 4＋structure 1）。`markup.test.js` 仍通過：新增的 id／for 都在允許名單裡。

- [ ] **Step 8：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js/theme-init.js saxs-calculator/js/theme-toggle.js saxs-calculator/index.html \
        saxs-calculator/js/app.js saxs-calculator/tests/load.js saxs-calculator/tests/theme.test.js \
        saxs-calculator/tests/structure.test.js
git commit -m "feat: theme switching (auto / light / dark) applied before first paint"
```

---

## Task 8：index.html——13 組分組輸入列、清掉裝飾用修飾 class

**規格：** §5.3、§5.2（`.card-title--purple`）、§5.9（漸層與色塊修飾）

**Files:**
- Modify: `saxs-calculator/index.html`
- 轉換腳本放在 scratchpad，**不 commit**

要做的事：
- 把 39 個「數字＋單位」欄位包進 13 個 `<div class="form-list">`。
- 4 則純說明用途的 `alert-info` 改成列表下方的 `<p class="form-list-foot">`：SAXS、HPLC、分子量、Slice 各一則。

手動改 13 處容易出錯，所以用下面的腳本：它只依欄位 id 定位，每一步都有檢查，對不上就整個中止、不寫檔。

| 組 | 第一個欄位 id | 最後一個欄位 id | 欄位數 | 列表下方說明 |
|---|---|---|---|---|
| SAXS 參數 | sampleConcentration | xrayEnergy | 2 | 有（原本在列表上方的 alert-info） |
| SAXS 量測結果 | i0Guinier | porodVolume | 7 | |
| HPLC pre-run | hplcPeakCenter | hplcPeakFWHM | 2 | 有 |
| HPLC SAXS 實驗 | hplcInjectionVolume | hplcInitialFlowRate | 3 | |
| 樣品 UV | uvAbsorbance | inputMw | 4 | |
| 樣品稀釋 | dfInjectionVolume | dfInjectionVolume | 1 | |
| 分子量正算 | mwInput | mwFlowRate | 4 | 有 |
| 分子量反算 | retentionTimeInput | retentionTimeInput | 1 | |
| 離心機 | rpm | rotorRadius | 2 | |
| 離心樣品 | centrifugeMw | centrifugeTime | 5 | |
| 偵測器 | targetProteinMW | targetProteinRg | 2（輪流顯示） | |
| dn/dc 理論 | dndcRefValue | dndcTargetWave | 5 | |
| Slice | sliceMinUvFraction | sliceMinUvFraction | 1 | 有 |

- [ ] **Step 1：把轉換腳本存到 scratchpad**

存成 `<scratchpad>/wrap_form_lists.py`。`<scratchpad>` 是你這個 session 的 scratchpad 目錄；沒有的話用 `/tmp/v5-wrap/`。

```python
"""v5.0 一次性轉換：把 index.html 連續的「數字＋單位」欄位包進 <div class="form-list">，
並把 4 個純說明用途的 alert-info 改成列表下方的 <p class="form-list-foot">。

用法：python3 wrap_form_lists.py saxs-calculator/index.html
只依 id 定位，不依行號；每一步都有檢查，對不上就整個中止、不寫檔。
"""
import re
import sys

# (第一個欄位 id, 最後一個欄位 id, 列表下方說明 or None, 要移除的 alert-info 內文 or None)
RUNS = [
    ('sampleConcentration', 'xrayEnergy',
     '請先在「蛋白質分析」頁面輸入序列，分子量等參數會自動帶入。',
     '<strong>提示：</strong>請先在「蛋白質分析」頁面輸入序列，分子量等參數會自動帶入。'),
    ('i0Guinier', 'porodVolume', None, None),
    ('hplcPeakCenter', 'hplcPeakFWHM',
     '先用 3μL 樣品做 pre-run HPLC，記錄峰的位置和寬度。',
     '<strong>提示：</strong>先用 3μL 樣品做 pre-run HPLC，記錄峰的位置和寬度。'),
    ('hplcInjectionVolume', 'hplcInitialFlowRate', None, None),
    ('uvAbsorbance', 'inputMw', None, None),
    ('dfInjectionVolume', 'dfInjectionVolume', None, None),
    ('mwInput', 'mwFlowRate',
     '如已分析蛋白質序列，分子量會自動帶入。',
     '<strong>提示：</strong>如已分析蛋白質序列，分子量會自動帶入。'),
    ('retentionTimeInput', 'retentionTimeInput', None, None),
    ('rpm', 'rotorRadius', None, None),
    ('centrifugeMw', 'centrifugeTime', None, None),
    ('targetProteinMW', 'targetProteinRg', None, None),
    ('dndcRefValue', 'dndcTargetWave', None, None),
    ('sliceMinUvFraction', 'sliceMinUvFraction',
     '使用與 HPLC dn/dc 頁面相同的數據。請先在該頁面載入檔案。',
     '使用與 HPLC dn/dc 頁面相同的數據。請先在該頁面載入檔案。'),
]

EXPECTED_FIELDS = 39


def fail(msg):
    sys.exit(f'中止：{msg}')


def indent_of(line):
    return len(line) - len(line.lstrip(' '))


def find_line(lines, needle, stop=None):
    """needle 在 lines[:stop] 裡必須剛好出現一次。"""
    hits = [i for i in range(stop if stop is not None else len(lines)) if needle in lines[i]]
    if len(hits) != 1:
        fail(f'{needle!r} 出現 {len(hits)} 次（應為 1 次）')
    return hits[0]


def group_start(lines, input_line):
    for i in range(input_line, -1, -1):
        if re.match(r'\s*<div class="form-group[" ]', lines[i]):
            return i
    fail(f'第 {input_line + 1} 行往上找不到 form-group')


def group_end(lines, start):
    pad = ' ' * indent_of(lines[start])
    for i in range(start + 1, len(lines)):
        if lines[i] == f'{pad}</div>':
            return i
    fail(f'第 {start + 1} 行的 form-group 找不到收尾')


def plan_runs(lines):
    plans = []
    for first, last, foot, alert in RUNS:
        start = group_start(lines, find_line(lines, f'id="{first}"'))
        end = group_end(lines, group_start(lines, find_line(lines, f'id="{last}"')))
        pad = indent_of(lines[start])
        fields = 0
        for i in range(start, end + 1):
            line = lines[i]
            if indent_of(line) != pad or not line.strip():
                continue
            text = line.strip()
            if text.startswith('<div class="form-group'):
                fields += 1
            elif text != '</div>' and not text.startswith('<!--'):
                fail(f'{first}–{last} 之間有不是 form-group 的元素：第 {i + 1} 行 {text[:60]}')
        plans.append((start, end, pad, fields, foot, alert))
    return plans


def main(path):
    with open(path, encoding='utf-8') as fh:
        lines = fh.read().split('\n')

    plans = plan_runs(lines)
    total = sum(p[3] for p in plans)
    if total != EXPECTED_FIELDS:
        fail(f'包進列表的欄位數是 {total}，預期 {EXPECTED_FIELDS}')

    # 由下往上改，前面的行號才不會位移
    for start, end, pad, _, foot, alert in sorted(plans, reverse=True):
        sp = ' ' * pad
        body = [('    ' + l) if l.strip() else l for l in lines[start:end + 1]]
        block = [f'{sp}<div class="form-list">', *body, f'{sp}</div>']
        if foot:
            block.append(f'{sp}<p class="form-list-foot">{foot}</p>')
        lines[start:end + 1] = block
        if alert:
            at = find_line(lines, alert, stop=start)   # 說明框在列表上方；只往上找，避開剛插入的同文字列表說明
            if not lines[at - 1].strip().startswith('<div class="alert alert-info') or lines[at + 1].strip() != '</div>':
                fail(f'alert-info「{alert[:20]}…」的結構與預期不同')
            # 連同後面的空行一起移除
            drop_to = at + 2 if lines[at + 2].strip() == '' else at + 1
            del lines[at - 1:drop_to + 1]

    out = '\n'.join(lines)
    if out.count('class="form-list"') != len(RUNS):
        fail('form-list 數量不對')
    if out.count('class="form-list-foot"') != 4:
        fail('form-list-foot 數量不對')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(out)
    print(f'OK：{len(RUNS)} 組列表、{total} 個欄位、4 則列表說明')


if __name__ == '__main__':
    main(sys.argv[1])
```

- [ ] **Step 2：執行**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
python3 <scratchpad>/wrap_form_lists.py saxs-calculator/index.html
```

Expected: `OK：13 組列表、39 個欄位、4 則列表說明`

印出「中止：…」時，檔案沒被改動。停下來回報那一行訊息。

- [ ] **Step 3：檢查差異只有包裝與縮排**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git diff -w --stat saxs-calculator/index.html
git diff -w saxs-calculator/index.html | grep '^[-+]' | grep -v '^[-+][-+]' | sort | uniq -c | sort -rn | head -20
```

忽略空白後，新增的行應該只有：
- 13 個 `<div class="form-list">` 與 13 個對應的 `</div>`
- 4 個 `<p class="form-list-foot">…</p>`

刪除的行只有 4 組 alert-info：開頭的 `<div class="alert alert-info…">`、內文、`</div>`。

- [ ] **Step 4：清掉裝飾用的修飾 class**

這些 class 的 CSS 規則在 Task 3／5 已經刪除。這一步只改 `class`，不動 id。

**(1)** 改 `saxs-calculator/index.html`。原文：

```html
<h2 class="card-title card-title--purple">Fraction Collector</h2>
```

改成：

```html
<h2 class="card-title">Fraction Collector</h2>
```

**(2)** 改 `saxs-calculator/index.html`（共 3 處，全部取代）。原文：

```html
class="gradient-stat gradient-stat--purple
```

改成：

```html
class="gradient-stat
```

**(3)** 改 `saxs-calculator/index.html`（共 3 處，全部取代）。原文：

```html
class="gradient-stat gradient-stat--pink"
```

改成：

```html
class="gradient-stat"
```

**(4)** 改 `saxs-calculator/index.html`。原文：

```html
class="result-card result-card--success hidden"
```

改成：

```html
class="result-card hidden"
```

**(5)** 改 `saxs-calculator/index.html`。原文：

```html
class="result-card result-card--primary"
```

改成：

```html
class="result-card"
```

**(6)** 改 `saxs-calculator/index.html`。原文：

```html
class="result-card result-card--pink"
```

改成：

```html
class="result-card"
```

**(7)** 改 `saxs-calculator/index.html`。原文：

```html
class="result-card result-card--warning result-card--lg"
```

改成：

```html
class="result-card result-card--lg"
```

**(8)** 改 `saxs-calculator/index.html`。原文：

```html
class="form-group info-panel info-panel--success"
```

改成：

```html
class="form-group info-panel"
```

**(9)** 改 `saxs-calculator/index.html`。原文：

```html
class="form-group info-panel info-panel--warning"
```

改成：

```html
class="form-group info-panel"
```

確認沒有殘留：

```bash
cd /Users/hsutingwei/Desktop/TPS13A
grep -rn "info-panel--\|gradient-stat--\|result-card--\(success\|primary\|pink\|warning\)\|card-title--purple" saxs-calculator/index.html saxs-calculator/js saxs-calculator/css
```

Expected: 沒有輸出

- [ ] **Step 5：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 195`、`ℹ fail 0`、`ℹ skipped 0`。`markup.test.js` 通過，代表 id、for、aria 都沒動。

- [ ] **Step 6：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/index.html
git commit -m "feat(html): group numeric fields into form lists; drop decorative modifier classes"
```

---

## Task 9：JS 行內色碼與左側色條改成 class

**規格：** §3.2、§3.3 規則 5–6、§5.6（Detector Setting 表）、§5.9

**Files:**
- Modify:
  - `saxs-calculator/js/section-hplc.js`
  - `saxs-calculator/js/section-sample.js`
  - `saxs-calculator/js/section-mw.js`
  - `saxs-calculator/js/section-centrifuge.js`
  - `saxs-calculator/js/section-saxs.js`
  - `saxs-calculator/js/dndc-theory-ui.js`
  - `saxs-calculator/js/dndc-multi-ui.js`
  - `saxs-calculator/js/dndc-slice-ui.js`
  - `saxs-calculator/js/dndc-hplc-results.js`：只改 stat-card 那一行，通道膠囊在 Task 11 改。
  - `saxs-calculator/js/dndc-astra-ui.js`：只改表格兩格，圖表在 Task 11 改。
- Modify: 兩張棘輪名單

對應的 CSS 都已就位：
- `.is-main-step`／`.frame-main`／`.mode-tm`／`.mode-other`／`.result-value--key` 在 components.css。
- `.info-panel-unit.is-error` 在 panels.css。
- `.mb-md`、`.num` 在 sections.css。

單位的行內 `font-size: 0.75rem` 不在這次範圍：它不含顏色，規格 §5.9 說留到 v5.1。

- [ ] **Step 1：逐檔取代**

**(1)** 改 `saxs-calculator/js/section-hplc.js`。原文：

```javascript
            // Highlight step 4 (main data collection)
            const isMainStep = row.step === 4;
            const rowStyle = isMainStep ? 'background: rgba(245, 158, 11, 0.15);' : '';
            // Text colours chosen for ≥4.5:1 on the light row backgrounds (WCAG AA)
            const frameStyle = isMainStep ? 'color: #92400e; font-weight: 700;' : '';

            return `
                <tr style="${rowStyle}">
                    <td>${row.step}</td>
                    <td style="color: ${row.mode === 'TM' ? '#1d4ed8' : '#047857'}; font-weight: 600;">${row.mode}</td>
                    <td style="${frameStyle}">${row.frame}</td>
```

改成：

```javascript
            // Highlight step 4 (main data collection)；顏色在 components.css（tests/contrast.test.js 驗過兩個主題）
            const isMainStep = row.step === 4;

            return `
                <tr class="${isMainStep ? 'is-main-step' : ''}">
                    <td>${row.step}</td>
                    <td class="${row.mode === 'TM' ? 'mode-tm' : 'mode-other'}">${row.mode}</td>
                    <td class="${isMainStep ? 'frame-main' : ''}">${row.frame}</td>
```

**(2)** 改 `saxs-calculator/js/section-sample.js`（共 2 處，全部取代）。原文：

```javascript
<div class="result-item" style="border-left-color: var(--color-accent-secondary);">
```

改成：

```javascript
<div class="result-item">
```

**(3)** 改 `saxs-calculator/js/section-sample.js`。原文：

```javascript
<div class="result-item" style="border-left-color: #f59e0b;">
```

改成：

```javascript
<div class="result-item">
```

**(4)** 改 `saxs-calculator/js/section-sample.js`（共 2 處，全部取代）。原文：

```javascript
<div class="result-item" style="border-left-color: #10b981;">
```

改成：

```javascript
<div class="result-item">
```

**(5)** 改 `saxs-calculator/js/section-mw.js`。原文：

```javascript
<div class="result-item" style="border-left-color: var(--color-accent-tertiary);">
```

改成：

```javascript
<div class="result-item">
```

**(6)** 改 `saxs-calculator/js/section-mw.js`。原文：

```javascript
<div class="result-item" style="border-left-color: var(--color-accent-secondary);">
```

改成：

```javascript
<div class="result-item">
```

**(7)** 改 `saxs-calculator/js/section-centrifuge.js`（共 2 處，全部取代）。原文：

```javascript
<div class="result-item" style="border-left-color: var(--color-accent-danger);">
```

改成：

```javascript
<div class="result-item">
```

**(8)** 改 `saxs-calculator/js/section-saxs.js`。原文：

```javascript
            methodEl.style.color = concentrationState.isError ? 'var(--color-accent-danger)' : '';
```

改成：

```javascript
            methodEl.classList.toggle('is-error', Boolean(concentrationState.isError));
```

**(9)** 改 `saxs-calculator/js/section-saxs.js`。原文：

```javascript
    methodEl.style.color = '';
```

改成：

```javascript
    methodEl.classList.remove('is-error');
```

**(10)** 改 `saxs-calculator/js/dndc-theory-ui.js`（共 2 處，全部取代）。原文：

```javascript
<div class="result-value" style="font-size: 1.25rem; color: var(--color-accent-primary);">
```

改成：

```javascript
<div class="result-value result-value--key">
```

**(11)** 改 `saxs-calculator/js/dndc-multi-ui.js`。原文：

```javascript
<div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
```

改成：

```javascript
<div class="stat-card mb-md">
```

**(12)** 改 `saxs-calculator/js/dndc-slice-ui.js`。原文：

```javascript
<div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
```

改成：

```javascript
<div class="stat-card mb-md">
```

**(13)** 改 `saxs-calculator/js/dndc-hplc-results.js`。原文：

```javascript
<div class="stat-card" style="margin-bottom: 1rem; border-left: 3px solid var(--color-accent-primary);">
```

改成：

```javascript
<div class="stat-card mb-md">
```

**(14)** 改 `saxs-calculator/js/dndc-astra-ui.js`。原文：

```javascript
                <td style="font-family: var(--font-mono); white-space: nowrap;">${inj.riAreaVolume.toExponential(2)}</td>
                <td style="font-family: var(--font-mono); white-space: nowrap;">${inj.kCal ? inj.kCal.toExponential(2) : '-'}</td>
```

改成：

```javascript
                <td class="num" style="white-space: nowrap;">${inj.riAreaVolume.toExponential(2)}</td>
                <td class="num" style="white-space: nowrap;">${inj.kCal ? inj.kCal.toExponential(2) : '-'}</td>
```

- [ ] **Step 2：更新兩張棘輪名單**

**(1)** 改 `saxs-calculator/tests/no-color-literals.test.js`。原文：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
    'js/section-hplc.js',
    'js/section-sample.js',
]);
```

改成：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
]);
```

**(2)** 改 `saxs-calculator/tests/token-usage.test.js`。原文：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'js/dndc-hplc-results.js',
    'js/dndc-multi-ui.js',
    'js/dndc-slice-ui.js',
    'js/dndc-theory-ui.js',
    'js/section-centrifuge.js',
    'js/section-hplc.js',
    'js/section-mw.js',
    'js/section-sample.js',
    'js/section-saxs.js',
]);
```

改成：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'js/dndc-hplc-results.js',
]);
```

- [ ] **Step 3：確認沒有殘留的左側色條與行內文字色**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
grep -rn "border-left" saxs-calculator/js saxs-calculator/css saxs-calculator/index.html
grep -rn "style.color\|accent-danger\|accent-secondary\|accent-tertiary" saxs-calculator/js
```

Expected: 兩行都沒有輸出

- [ ] **Step 4：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 195`、`ℹ fail 0`、`ℹ skipped 0`

- [ ] **Step 5：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js saxs-calculator/tests/no-color-literals.test.js saxs-calculator/tests/token-usage.test.js
git commit -m "refactor: replace inline colour styles and left bars with classes"
```

---

## Task 10：chart-theme.js

**規格：** §6.1、§6.2、§8.1-4（以及「規劃時的決定」第 1、2 點）

**Files:**
- Create: `saxs-calculator/js/chart-theme.js`
- Modify: `saxs-calculator/index.html`（script 標籤）、`saxs-calculator/js/app.js`、`saxs-calculator/tests/load.js`
- Modify: `saxs-calculator/tests/theme.test.js`、`saxs-calculator/tests/contrast.test.js`、`saxs-calculator/tests/structure.test.js`（追加測試）

重點：
- **載入時機：** Chart.js 是 `defer`，比本地 script 晚執行。
  - `chart-theme.js` 頂層不碰 `Chart`／`document`／`matchMedia`。
  - 不做全域 `Chart.register`，白底外掛由 `colorize` 加進每張圖的 `plugins`。
- **以 Playwright 實測確認過（Chart.js 4.5.1）：**
  - `Chart.instances` 存在。
  - 寫 `chart.config.options` 的葉節點後 `update('none')` 會生效，zoom 保留。
  - 共用設定會被寫穿，所以 `colorize` 必須深拷貝，但要保留 data 陣列與函式的參照。
  - 動畫中 `update('none')` 不會同步重畫，所以 `exportPng` 先 `stop()`。
- **系列色 8 色：** 用 dataviz 驗證工具選定：
  - 淺色對 #FFFFFF 最低 3.56:1，深色對 #1E1E21 最低 4.73:1。
  - 相鄰色的色覺差異 ΔE ≥ 10.5／10.6，一般視覺 ≥ 18.6／17.5。
- **`surface`：** 必須等於卡片色，測試會比對。

- [ ] **Step 1：先寫測試**

**(1)** 改 `saxs-calculator/tests/load.js`。原文：

```javascript
    'form-utils.js',
    'protein.js',
```

改成：

```javascript
    'form-utils.js',
    'chart-theme.js',              // 頂層只定義常數與函式（不碰 Chart／document）
    'protein.js',
```

**(2)** 改 `saxs-calculator/tests/load.js`。原文：

```javascript
    ThemeInit: window.ThemeInit,
};
```

改成：

```javascript
    ThemeInit: window.ThemeInit,
    ChartTheme: window.ChartTheme,
};
```

**(3)** 改 `saxs-calculator/tests/theme.test.js`。原文：

```javascript
const { ThemeInit } = require('./load.js');
```

改成：

```javascript
const { ThemeInit, ChartTheme } = require('./load.js');
```

**(4)** 在 `saxs-calculator/tests/theme.test.js` 的結尾（最後一行之後）加上：

```javascript
// ---------------------------------------------------------------- ChartTheme.colorAssignments
const valueAt = (assignments, path) => {
    const hit = assignments.find(a => a.path.join('.') === path);
    return hit ? hit.value : undefined;
};

test('[chart-theme] dataset、scale、annotation 依 tpsRole 上色', () => {
    const p = ChartTheme.PALETTES.dark;
    const structure = {
        data: { datasets: [{ tpsRole: 'primary' }, { tpsRole: 'model' }, { tpsRole: 'region' }, { label: '未標記' }] },
        options: {
            scales: { x: {}, y: { tpsRole: 'primary' } },
            plugins: {
                annotation: {
                    annotations: {
                        box: { type: 'box', tpsRole: 'region', label: { content: 'q' } },
                        line: { type: 'line', tpsRole: 'marker', label: { content: 'Peak' } },
                        plain: { type: 'line' },
                    },
                },
            },
        },
    };
    const a = ChartTheme.colorAssignments(structure, p);
    assert.equal(valueAt(a, 'data.datasets.0.borderColor'), p.primary);
    assert.equal(valueAt(a, 'data.datasets.1.borderColor'), p.model);
    assert.equal(valueAt(a, 'data.datasets.2.backgroundColor'), p.region);
    assert.equal(valueAt(a, 'data.datasets.2.borderColor'), p.marker);
    assert.equal(valueAt(a, 'data.datasets.3.borderColor'), undefined, '沒有標記的 dataset 不上色');
    assert.equal(valueAt(a, 'options.scales.x.ticks.color'), p.text);
    assert.equal(valueAt(a, 'options.scales.x.border.color'), p.grid);
    assert.equal(valueAt(a, 'options.scales.y.border.color'), p.primary, '帶用途的軸只有軸線上色');
    assert.equal(valueAt(a, 'options.scales.y.ticks.color'), p.text, '刻度一律文字色');
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.box.backgroundColor'), p.region);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.box.label.color'), p.text);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.box.label.backgroundColor'), undefined);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.line.borderColor'), p.marker);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.line.label.backgroundColor'), p.surface);
    assert.equal(valueAt(a, 'options.plugins.annotation.annotations.plain.borderColor'), undefined);
    assert.equal(valueAt(a, 'options.plugins.legend.labels.color'), p.text);
    assert.equal(valueAt(a, 'options.plugins.tooltip.backgroundColor'), p.tooltipBg);
});

test('[chart-theme] tpsSeries 依編號取色；用完重用同色並改虛線', () => {
    const p = ChartTheme.PALETTES.light;
    const n = p.series.length;
    const structure = { data: { datasets: [{ tpsSeries: 1 }, { tpsSeries: n + 1 }] }, options: { scales: { y0: { tpsSeries: 1 } } } };
    const a = ChartTheme.colorAssignments(structure, p);
    assert.equal(valueAt(a, 'data.datasets.0.borderColor'), p.series[1]);
    assert.deepEqual(valueAt(a, 'data.datasets.0.borderDash'), []);
    assert.equal(valueAt(a, 'data.datasets.1.borderColor'), p.series[1]);
    assert.deepEqual(valueAt(a, 'data.datasets.1.borderDash'), [6, 4]);
    assert.equal(valueAt(a, 'options.scales.y0.border.color'), p.series[1]);
});

test('[chart-theme] 圓餅圖：每片一色，Others 用 reference，分隔線是卡片色', () => {
    const p = ChartTheme.PALETTES.light;
    const structure = { data: { datasets: [{ tpsSeries: 'byIndex', tpsOthersIndex: 3, data: [5, 4, 3, 9] }] }, options: {} };
    const a = ChartTheme.colorAssignments(structure, p);
    assert.deepEqual(valueAt(a, 'data.datasets.0.backgroundColor'), [p.series[0], p.series[1], p.series[2], p.reference]);
    assert.equal(valueAt(a, 'data.datasets.0.borderColor'), p.surface);
});

test('[chart-theme] 系列色 8 色，兩個主題長度一致', () => {
    assert.equal(ChartTheme.PALETTES.light.series.length, 8);
    assert.equal(ChartTheme.PALETTES.dark.series.length, 8);
    assert.equal(ChartTheme.PALETTES.light.series[0], ChartTheme.PALETTES.light.primary, 'series[0] 與主線一致');
    assert.equal(ChartTheme.PALETTES.dark.series[0], ChartTheme.PALETTES.dark.primary);
});

// ---------------------------------------------------------------- colorize
test('[chart-theme] colorize 不修改傳入的 config（含淺展開共用的巢狀物件），data 陣列沿用參照', () => {
    const shared = { plugins: { legend: { labels: { font: { size: 12 } } } } };
    const points = [{ x: 0, y: 1 }];
    const label = () => 'x';
    const config = {
        type: 'scatter',
        data: { datasets: [{ tpsRole: 'primary', data: points }] },
        options: { ...shared, plugins: { ...shared.plugins, tooltip: { callbacks: { label } } }, scales: { x: {} } },
    };
    const before = JSON.stringify(config);
    const out = ChartTheme.colorize(config, 'dark');
    assert.equal(JSON.stringify(config), before, '原 config 不變');
    assert.equal(shared.plugins.legend.labels.color, undefined, '共用物件沒被寫到');
    assert.equal(out.data.datasets[0].data, points, 'data 陣列沿用參照（不複製上萬點）');
    assert.equal(out.options.plugins.tooltip.callbacks.label, label, '函式沿用參照');
    assert.equal(out.data.datasets[0].borderColor, ChartTheme.PALETTES.dark.primary);
    assert.ok(out.plugins.some(pl => pl.id === 'tpsCanvasBackground'), '帶白底外掛');
});

// ---------------------------------------------------------------- applyTo / exportPng
function stubChart(log) {
    const options = { plugins: { legend: { labels: {} } }, scales: { x: { ticks: {} } } };
    const chart = {
        config: { data: { datasets: [{ tpsRole: 'primary', data: [] }] }, options },
        stop() { log.push('stop'); },
        update(mode) { log.push(`update:${mode}:${this.config.data.datasets[0].borderColor}:${Boolean(this.$tpsExportBackground)}`); },
        toBase64Image() {
            log.push(`image:${this.config.data.datasets[0].borderColor}:${Boolean(this.$tpsExportBackground)}`);
            if (this.failOnImage) throw new Error('boom');
            return 'data:image/png;base64,AAA';
        },
    };
    return { chart, refs: { options, plugins: options.plugins, legend: options.plugins.legend, scaleX: options.scales.x } };
}

test('[chart-theme] applyTo 只寫葉節點：options 與其巢狀物件的參照都不變', () => {
    const log = [];
    const { chart, refs } = stubChart(log);
    ChartTheme.applyTo(chart, 'dark');
    assert.equal(chart.config.options, refs.options);
    assert.equal(chart.config.options.plugins, refs.plugins);
    assert.equal(chart.config.options.plugins.legend, refs.legend);
    assert.equal(chart.config.options.scales.x, refs.scaleX);
    assert.equal(chart.config.options.scales.x.ticks.color, ChartTheme.PALETTES.dark.text);
    assert.deepEqual(log, [`update:none:${ChartTheme.PALETTES.dark.primary}:false`]);
});

test('[chart-theme] exportPng（深色模式）：換淺色 → 白底 → 取圖 → 還原深色', () => {
    const log = [];
    const { chart } = stubChart(log);
    const L = ChartTheme.PALETTES.light.primary;
    const D = ChartTheme.PALETTES.dark.primary;
    withThemeAttr('dark', () => ChartTheme.applyTo(chart));
    log.length = 0;
    const url = withThemeAttr('dark', () => ChartTheme.exportPng(chart));
    assert.equal(url, 'data:image/png;base64,AAA');
    assert.deepEqual(log, ['stop', `update:none:${L}:true`, `image:${L}:true`, `update:none:${D}:false`]);
});

test('[chart-theme] exportPng 中途丟例外也會還原主題與白底旗標', () => {
    const log = [];
    const { chart } = stubChart(log);
    chart.failOnImage = true;
    withThemeAttr('dark', () => ChartTheme.applyTo(chart));
    assert.throws(() => withThemeAttr('dark', () => ChartTheme.exportPng(chart)), /boom/);
    assert.equal(chart.config.data.datasets[0].borderColor, ChartTheme.PALETTES.dark.primary);
    assert.equal(chart.$tpsExportBackground, false);
});

test('[chart-theme] exportPng（淺色模式）不換色，只開白底', () => {
    const log = [];
    const { chart } = stubChart(log);
    ChartTheme.applyTo(chart, 'light');
    log.length = 0;
    withThemeAttr('light', () => ChartTheme.exportPng(chart));
    const L = ChartTheme.PALETTES.light.primary;
    assert.deepEqual(log, ['stop', `update:none:${L}:true`, `image:${L}:true`, `update:none:${L}:false`]);
});
```

**(5)** 在 `saxs-calculator/tests/contrast.test.js` 的結尾（最後一行之後）加上：

```javascript
// ---------------------------------------------------------------- 圖表色（js/chart-theme.js，規格 §6.1）
const { ChartTheme } = require('./load.js');

const CHART_LINE_ROLES = Object.freeze(['primary', 'reference', 'model', 'residual', 'fit', 'marker']);

for (const [themeName, p] of Object.entries(ChartTheme.PALETTES)) {
    test(`[contrast] 圖表 ${themeName}：text ≥ 4.5，線與標記 ≥ 3（疊在卡片上）`, () => {
        const cardValue = THEMES[themeName].get('--color-bg-card');
        assert.equal(p.surface.toUpperCase(), cardValue.toUpperCase(), 'surface（圓餅分隔線、標籤底）必須等於卡片色');
        const card = parseColor(cardValue);
        const checks = [
            ['text', p.text, 4.5],
            ...CHART_LINE_ROLES.map(role => [role, p[role], 3]),
            ...p.series.map((color, i) => [`series[${i}]`, color, 3]),
        ];
        const failures = checks
            .map(([name, color, min]) => ({ name, min, value: contrast(over(parseColor(color), card), card) }))
            .filter(c => c.value < c.min)
            .map(c => `${c.name} = ${c.value.toFixed(2)} < ${c.min}`);
        assert.deepEqual(failures, []);
    });
}
```

**(6)** 在 `saxs-calculator/tests/structure.test.js` 的結尾（最後一行之後）加上：

```javascript
test('[structure] chart-theme.js 排在所有建立或匯出圖表的本地檔之前', () => {
    const pos = name => SCRIPT_REFS.indexOf(name);
    assert.ok(pos('js/chart-theme.js') >= 0, 'chart-theme.js 未被引用');
    const users = ['js/charts.js', 'js/dndc-charts.js', 'js/liposome-charts.js',
        'js/dndc-hplc-results.js', 'js/dndc-astra-ui.js', 'js/dndc-export.js'];
    for (const file of users) {
        assert.ok(pos(file) >= 0, `${file} 未被引用`);
        assert.ok(pos('js/chart-theme.js') < pos(file), `chart-theme.js 必須排在 ${file} 之前`);
    }
});
```

- [ ] **Step 2：跑測試，確認失敗**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL。`tests/load.js` 讀不到 `chart-theme.js`。

- [ ] **Step 3：新增 chart-theme.js**

寫入 `saxs-calculator/js/chart-theme.js`（完整內容，照抄）：

```javascript
/**
 * TPS13A SAXS Calculator - 圖表主題（v5.0）
 *
 * 所有 Chart.js 圖表的顏色都由這裡決定；圖表檔只在 dataset／scale／annotation 上標「用途」：
 *   dataset：tpsRole: 'primary' | 'reference' | 'model' | 'residual' | 'fit' | 'region'
 *            tpsSeries: 0..n（多通道，依實體編號，不依勾選順序）或 'byIndex'（圓餅圖，每片一色；
 *            tpsOthersIndex 指出「Others」那片，用 reference 灰）
 *   scale：  tpsRole／tpsSeries → 只有軸線（border）上色；刻度與標題一律用 text 色
 *   annotation：tpsRole: 'region' | 'regionAlt' | 'marker' | 'residual'
 *
 * 載入時機：Chart.js 在 <head> 以 defer 載入，比所有本地 script 晚執行。所以本檔頂層只定義
 * 常數與函式，不碰 Chart、document、matchMedia；用到時才取用（Node 測試也會載入本檔）。
 *
 * 色碼字面值只允許出現在本檔與 css/tokens.css（tests/no-color-literals.test.js）。
 * 系列色 8 色以 dataviz 驗證工具選定：淺色對 #FFFFFF 最低 3.56:1、深色對 #1E1E21 最低 4.73:1，
 * 相鄰色在常見色覺差異下 ΔE ≥ 10.5（淺）／10.6（深）。
 */
(function attachChartTheme(global) {
    'use strict';

    const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang TC", "Noto Sans TC", system-ui, sans-serif';
    const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

    const LIGHT = Object.freeze({
        text: '#636366',
        grid: 'rgba(0, 0, 0, 0.08)',
        surface: '#FFFFFF',
        primary: '#F04E4E',
        reference: '#636366',
        model: '#047857',
        residual: '#B45309',
        fit: '#B91C1C',
        region: 'rgba(240, 78, 78, 0.08)',
        regionAlt: 'rgba(180, 83, 9, 0.08)',
        marker: '#C27A7A',
        tooltipBg: 'rgba(29, 29, 31, 0.92)',
        tooltipText: '#FFFFFF',
        series: Object.freeze(['#F04E4E', '#2A78D6', '#0F8A6E', '#B45309', '#6250D6', '#C2307A', '#4D7C0F', '#0891B2']),
    });

    const DARK = Object.freeze({
        text: '#A1A1A6',
        grid: 'rgba(255, 255, 255, 0.10)',
        surface: '#1E1E21',
        primary: '#E85858',
        reference: '#A1A1A6',
        model: '#5BD68A',
        residual: '#F5B754',
        fit: '#F58A8A',
        region: 'rgba(232, 88, 88, 0.14)',
        regionAlt: 'rgba(245, 183, 84, 0.12)',
        marker: 'rgba(238, 144, 144, 0.6)',
        tooltipBg: '#2C2C2E',
        tooltipText: '#F5F5F7',
        series: Object.freeze(['#E85858', '#4A8DDF', '#1FA27F', '#C08418', '#9085E9', '#E0629B', '#76A12B', '#1898B4']),
    });

    const PALETTES = Object.freeze({ light: LIGHT, dark: DARK });

    // 系列色用完（第 9 個以後）重用同色，改用虛線區分（composite encoding，不另生新色）
    const REUSE_DASH = Object.freeze([6, 4]);

    /** 生效主題：讀 <html data-theme>，自動時看系統（呼叫時才讀） */
    function resolved() {
        return global.ThemeInit ? global.ThemeInit.effective() : 'light';
    }

    function palette(name = resolved()) {
        return PALETTES[name] || LIGHT;
    }

    function seriesColor(p, index) {
        return p.series[index % p.series.length];
    }

    function seriesDash(p, index) {
        return index >= p.series.length ? [...REUSE_DASH] : [];
    }

    /**
     * 純函式：依用途標記算出「路徑 → 值」清單。structure 是 { data, options }
     * （建立前的 config，或既有實例的 chart.config）。不修改 structure。
     *
     * @returns {ReadonlyArray<{path: ReadonlyArray<string|number>, value: *}>}
     */
    function colorAssignments(structure, p) {
        const out = [];
        const put = (path, value) => out.push(Object.freeze({ path: Object.freeze(path), value }));
        const options = (structure && structure.options) || {};
        const datasets = (structure && structure.data && structure.data.datasets) || [];
        const tagColor = item => {
            if (Number.isInteger(item.tpsSeries)) return seriesColor(p, item.tpsSeries);
            return item.tpsRole && typeof p[item.tpsRole] === 'string' ? p[item.tpsRole] : null;
        };

        put(['options', 'plugins', 'legend', 'labels', 'color'], p.text);
        put(['options', 'plugins', 'tooltip', 'backgroundColor'], p.tooltipBg);
        put(['options', 'plugins', 'tooltip', 'titleColor'], p.tooltipText);
        put(['options', 'plugins', 'tooltip', 'bodyColor'], p.tooltipText);

        Object.entries(options.scales || {}).forEach(([id, scale]) => {
            const base = ['options', 'scales', id];
            put([...base, 'ticks', 'color'], p.text);
            put([...base, 'title', 'color'], p.text);
            put([...base, 'grid', 'color'], p.grid);
            put([...base, 'border', 'color'], (scale && tagColor(scale)) || p.grid);
        });

        datasets.forEach((ds, i) => {
            const base = ['data', 'datasets', i];
            if (ds.tpsSeries === 'byIndex') {
                const count = Array.isArray(ds.data) ? ds.data.length : 0;
                const colors = Array.from({ length: count },
                    (_, k) => (k === ds.tpsOthersIndex ? p.reference : seriesColor(p, k)));
                put([...base, 'backgroundColor'], colors);
                put([...base, 'borderColor'], p.surface);
                return;
            }
            if (Number.isInteger(ds.tpsSeries)) {
                const color = seriesColor(p, ds.tpsSeries);
                put([...base, 'borderColor'], color);
                put([...base, 'backgroundColor'], color);
                put([...base, 'borderDash'], seriesDash(p, ds.tpsSeries));
                return;
            }
            if (ds.tpsRole === 'region') {
                put([...base, 'backgroundColor'], p.region);
                put([...base, 'borderColor'], p.marker);
                return;
            }
            const color = tagColor(ds);
            if (color) {
                put([...base, 'borderColor'], color);
                put([...base, 'backgroundColor'], color);
            }
        });

        const annotations = (options.plugins && options.plugins.annotation && options.plugins.annotation.annotations) || {};
        Object.entries(annotations).forEach(([id, a]) => {
            const color = a && tagColor(a);
            if (!color) return;
            const base = ['options', 'plugins', 'annotation', 'annotations', id];
            put([...base, a.type === 'box' ? 'backgroundColor' : 'borderColor'], color);
            if (a.label) {
                put([...base, 'label', 'color'], p.text);
                // 線段標籤預設是黑底白字；改成卡片底，深淺色都看得清楚。box 的標籤畫在框內，維持透明。
                if (a.type !== 'box') put([...base, 'label', 'backgroundColor'], p.surface);
            }
        });

        return Object.freeze(out);
    }

    /** 沿路徑寫入；缺的中間層補空物件，已存在的物件一律沿用（不替換） */
    function setPath(root, path, value) {
        let node = root;
        for (let k = 0; k < path.length - 1; k++) {
            const key = path[k];
            if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
            node = node[key];
        }
        node[path[path.length - 1]] = value;
    }

    /**
     * 深拷貝 config：dataset 的 data 陣列（可能上萬點）與函式（tooltip callback）沿用參照。
     * 圖表檔常用 {...shared} 淺展開共用設定，Chart.js 又會把 chart.options 的寫入直接寫回 config——
     * 不拷貝的話，換色會改到所有圖表共用的那份物件。
     */
    function cloneConfig(value, key) {
        if (Array.isArray(value)) return key === 'data' ? value : value.map(item => cloneConfig(item));
        if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
            const copy = {};
            Object.keys(value).forEach(k => { copy[k] = cloneConfig(value[k], k); });
            return copy;
        }
        return value;
    }

    // 匯出 PNG 時填白底（平常不畫：畫面上的底色由卡片負責）。不 freeze：交給 Chart.js 的外掛物件。
    const CANVAS_BACKGROUND = {
        id: 'tpsCanvasBackground',
        beforeDraw(chart) {
            if (!chart.$tpsExportBackground) return;
            const { ctx, width, height } = chart;
            ctx.save();
            ctx.fillStyle = LIGHT.surface;
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
        },
    };

    /** 建立圖表前用：回傳上好色、帶白底外掛的新 config（不修改傳入的 config） */
    function colorize(config, name = resolved()) {
        const copy = cloneConfig(config);
        colorAssignments(copy, palette(name)).forEach(({ path, value }) => setPath(copy, path, value));
        return { ...copy, plugins: [...(copy.plugins || []), CANVAS_BACKGROUND] };
    }

    /**
     * 把顏色寫進既有實例的 chart.config（Chart.js 4：chart.config.options／.data 就是建立時的物件）。
     * 只寫葉節點、不替換整個 options，zoom 外掛的範圍才會保留。Chart.js 的更新 API 必須改實例本身，
     * 所以修改只發生在這裡。
     */
    function paint(chart, name) {
        const target = chart.config;
        colorAssignments(target, palette(name)).forEach(({ path, value }) => setPath(target, path, value));
    }

    function applyTo(chart, name = resolved()) {
        paint(chart, name);
        chart.update('none');
    }

    /**
     * 匯出 PNG 一律淺色白底。換色 → 白底 → 取圖 → 還原，全在同一個同步段落，瀏覽器中途不會重繪。
     * stop()：動畫進行中時 update('none') 不會同步重畫，取到的會是舊畫面。
     */
    function exportPng(chart) {
        const original = resolved();
        const swap = original !== 'light';
        try {
            if (typeof chart.stop === 'function') chart.stop();
            if (swap) paint(chart, 'light');
            chart.$tpsExportBackground = true;
            chart.update('none');
            return chart.toBase64Image('image/png', 1);
        } finally {
            chart.$tpsExportBackground = false;
            if (swap) paint(chart, original);
            chart.update('none');
        }
    }

    /** 由 app.js 的 DOMContentLoaded 呼叫（此時 defer 的 Chart.js 已執行） */
    function init() {
        if (!global.document) return;
        global.document.addEventListener('tps:themechange', event => {
            const Chart = global.Chart;
            if (typeof Chart !== 'function' || !Chart.instances) return;
            const name = event.detail && event.detail.theme;
            Object.values(Chart.instances).forEach(chart => applyTo(chart, name));
        });
    }

    global.ChartTheme = Object.freeze({
        FONT,
        MONO,
        PALETTES,
        resolved,
        palette,
        seriesColor,
        seriesDash,
        colorAssignments,
        colorize,
        applyTo,
        exportPng,
        init,
    });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4：在 index.html 加上 script 標籤**

排在 `charts.js` 等所有圖表檔之前，也在 `theme-toggle.js` 之前。

改 `saxs-calculator/index.html`。原文：

```html
    <script src="js/a11y-utils.js?v=4.15"></script>
    <script src="js/theme-toggle.js?v=4.15"></script>
```

改成：

```html
    <script src="js/a11y-utils.js?v=4.15"></script>
    <script src="js/chart-theme.js?v=4.15"></script>
    <script src="js/theme-toggle.js?v=4.15"></script>
```

- [ ] **Step 5：app.js 註冊圖表換色**

改 `saxs-calculator/js/app.js`。原文：

```javascript
document.addEventListener('DOMContentLoaded', () => {
    ThemeToggle.init();
    initFormPersistence();
```

改成：

```javascript
document.addEventListener('DOMContentLoaded', () => {
    ThemeToggle.init();
    ChartTheme.init();   // 此時 defer 載入的 Chart.js 已執行
    initFormPersistence();
```

- [ ] **Step 6：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 207`、`ℹ fail 0`、`ℹ skipped 0`（195＋theme 9＋contrast 2＋structure 1）

- [ ] **Step 7：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js/chart-theme.js saxs-calculator/index.html saxs-calculator/js/app.js saxs-calculator/tests
git commit -m "feat: ChartTheme — palettes, in-place recolouring, light PNG export"
```

---

## Task 11：所有圖表改走 ChartTheme

**規格：** §6.1（用途標記、通道標籤）、§6.2、§6.3

**Files:**
- Modify（整檔改寫）: `saxs-calculator/js/charts.js`、`saxs-calculator/js/dndc-charts.js`
- Modify: `saxs-calculator/js/liposome-charts.js`、`saxs-calculator/js/dndc-hplc-results.js`、`saxs-calculator/js/dndc-astra-ui.js`、`saxs-calculator/js/dndc-export.js`、`saxs-calculator/js/dndc-ui.js`
- Modify: 兩張棘輪名單清空；`saxs-calculator/tests/structure.test.js` 追加一個測試

**每張圖的用途標記：**

| 圖 | 標記 |
|---|---|
| 圓餅圖 | `tpsSeries: 'byIndex'`，前 7 名＋Others（`tpsOthersIndex`） |
| 長條圖 | `primary` |
| dn/dc 色譜圖 | UV＝`primary`、dRI＝`model`，兩條 y 軸同樣標記；峰區 `region`、峰起訖線 `marker`、基線區間 `regionAlt`、基線線 `residual` |
| 線性擬合 | 資料點 `primary`、擬合線 `fit` |
| 全通道預覽 | `tpsSeries`＝通道在 `channelIndices` 的位置（顏色跟著通道，不跟勾選順序）；各 y 軸同樣標記 |
| ASTRA 疊圖 | `tpsSeries`＝檔案編號；積分範圍 `region` |
| 脂質體三張圖 | 沿用原本的 primary／reference／model／residual；q 視窗 `region`、讀值波長線 `marker` |

**外觀（§6.3）：**
- 線寬 2。
- 只留水平格線（x 軸 `grid.display: false`）。
- 圖例 12px。
- 提示框圓角 8、內距 10。

**`commonOptions` 與 `dndcChartDefaults` 改成函式：** 每次回傳新物件，而且只在呼叫時才讀 `ChartTheme`。

**沒有消費者，一併移除：** 三份舊色表的匯出：`SAXSCharts.CHART_COLORS`、`DndcCharts.DNDC_CHART_COLORS`、`LiposomeCharts.LIPO_CHART_COLORS`。`tests/liposome-section.test.js` 用的是自己的 stub，不受影響。

**通道膠囊：**
- `--chip-color` 由 JS 依主題設定；`dndc-ui.js` 的 DOMContentLoaded 註冊 `tps:themechange` 重設。
- 文字一律用文字 token，顏色只出現在與圖線同色同線型的小樣本上。

- [ ] **Step 1：先加結構測試，確認失敗**

在 `saxs-calculator/tests/structure.test.js` 的結尾（最後一行之後）加上：

```javascript
test('[structure] 每個 new Chart(...) 都經過 ChartTheme.colorize（主題色與匯出白底外掛都靠它）', () => {
    const offenders = [];
    for (const file of JS_FILES) {
        const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
        for (const m of source.matchAll(/new\s+(?:global\.)?Chart\(\s*[^,]+,\s*([^\n]*)/g)) {
            if (!/^(?:global\.)?ChartTheme\.colorize\(/.test(m[1])) offenders.push(`${file}: ${m[0].trim()}`);
        }
    }
    assert.deepEqual(offenders, []);
});
```

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/structure.test.js 2>&1 | grep -E "^ℹ (pass|fail)|js: new"`
Expected: FAIL，列出 charts.js（2 處）、dndc-charts.js（2 處）、dndc-hplc-results.js、dndc-astra-ui.js、liposome-charts.js 的 `new Chart(`。

- [ ] **Step 2：改寫 charts.js 與 dndc-charts.js**

**(1)** 寫入 `saxs-calculator/js/charts.js`（完整內容，照抄）：

```javascript
/**
 * TPS13A SAXS Calculator - Charts Module
 * 使用 Chart.js 產生視覺化圖表。顏色由 ChartTheme 依 tpsRole／tpsSeries 決定（js/chart-theme.js）。
 */

// 通用圖表配置（每次呼叫回傳新物件；顏色由 ChartTheme.colorize 填入）
function commonOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    font: { family: ChartTheme.FONT, size: 12, weight: 500 }
                }
            },
            tooltip: {
                cornerRadius: 8,
                padding: 10,
                titleFont: { family: ChartTheme.FONT, size: 12, weight: 600 },
                bodyFont: { family: ChartTheme.MONO, size: 11 }
            }
        }
    };
}

/**
 * 建立氨基酸組成圓餅圖
 */
function createCompositionChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const sorted = Object.entries(composition)
        .sort((a, b) => b[1] - a[1]);

    // 系列色只有 8 色：前 7 名各一色，其餘併成「Others」（reference 灰）
    const topCount = ChartTheme.palette().series.length - 1;
    const top = sorted.slice(0, topCount);
    const others = sorted.slice(topCount).reduce((sum, [, count]) => sum + count, 0);

    const labels = top.map(([aa]) => aa);
    const data = top.map(([, count]) => count);

    if (others > 0) {
        labels.push('Others');
        data.push(others);
    }

    const base = commonOptions();
    return new Chart(ctx, ChartTheme.colorize({
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                tpsSeries: 'byIndex',
                tpsOthersIndex: others > 0 ? labels.length - 1 : -1,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            ...base,
            cutout: '65%',
            plugins: {
                ...base.plugins,
                legend: {
                    position: 'right',
                    labels: {
                        padding: 10,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { family: ChartTheme.FONT, size: 12 }
                    }
                },
                tooltip: {
                    ...base.plugins.tooltip,
                    callbacks: {
                        label: function (context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.raw / total) * 100).toFixed(1);
                            return `${context.label}: ${context.raw} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    }));
}

/**
 * 建立氨基酸組成長條圖
 */
function createCompositionBarChart(canvasId, composition) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const aaOrder = ['A', 'R', 'N', 'D', 'C', 'E', 'Q', 'G', 'H', 'I', 'L', 'K', 'M', 'F', 'P', 'S', 'T', 'W', 'Y', 'V'];
    const labels = aaOrder;
    const data = aaOrder.map(aa => composition[aa] || 0);

    const base = commonOptions();
    return new Chart(ctx, ChartTheme.colorize({
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: data,
                tpsRole: 'primary',
                borderWidth: 0,
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            ...base,
            plugins: {
                ...base.plugins,
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: {
                        font: { family: ChartTheme.MONO, size: 10, weight: 500 }
                    },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { font: { size: 10 } }
                }
            }
        }
    }));
}

// 導出函數
window.SAXSCharts = {
    createCompositionChart,
    createCompositionBarChart
};
```

**(2)** 寫入 `saxs-calculator/js/dndc-charts.js`（完整內容，照抄）：

```javascript
/**
 * TPS13A SAXS Calculator - dn/dc Charts Module
 * 使用 Chart.js 產生 dn/dc 相關圖表。顏色由 ChartTheme 依 tpsRole 決定（js/chart-theme.js）。
 */

// dn/dc 圖表共用設定（每次呼叫回傳新物件；顏色由 ChartTheme.colorize 填入）
function dndcChartDefaults() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    font: { family: ChartTheme.FONT, size: 12 }
                }
            },
            tooltip: {
                cornerRadius: 8,
                padding: 10,
                titleFont: { family: ChartTheme.FONT, size: 12 },
                bodyFont: { family: ChartTheme.MONO, size: 11 }
            },
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'xy'
                },
                zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    mode: 'xy'
                }
            }
        }
    };
}

/** 座標軸標題（斜體、系統字） */
function dndcAxisTitle(text) {
    return { display: true, text, font: { family: ChartTheme.FONT, size: 12, style: 'italic' } };
}

/**
 * 建立色譜圖（UV + RI 雙軸）
 * @param {string} canvasId - Canvas 元素 ID
 * @param {number[]} time - 時間陣列
 * @param {number[]} uvSignal - UV 訊號
 * @param {number[]} riSignal - RI 訊號
 * @param {object} [options] - 可選參數 { peakStart, peakEnd, uvBaseline, riBaseline }
 * @returns {Chart} Chart.js 實例
 */
function createChromatogramChart(canvasId, time, uvSignal, riSignal, options) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const datasets = [
        {
            label: 'UV (280 nm)',
            data: time.map((t, i) => ({ x: t, y: uvSignal[i] })),
            tpsRole: 'primary',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y'
        },
        {
            label: 'dRI',
            data: time.map((t, i) => ({ x: t, y: riSignal[i] })),
            tpsRole: 'model',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y1'
        }
    ];

    const annotations = {};
    if (options && options.peakStart != null && options.peakEnd != null) {
        annotations.peakRegion = {
            type: 'box',
            tpsRole: 'region',
            xMin: options.peakStart,
            xMax: options.peakEnd,
            borderWidth: 0
        };
        annotations.peakStartLine = {
            type: 'line',
            tpsRole: 'marker',
            xMin: options.peakStart, xMax: options.peakStart,
            borderWidth: 1.5,
            borderDash: [4, 4],
            label: { display: true, content: 'Peak', position: 'start', font: { size: 10 } }
        };
        annotations.peakEndLine = {
            type: 'line',
            tpsRole: 'marker',
            xMin: options.peakEnd, xMax: options.peakEnd,
            borderWidth: 1.5,
            borderDash: [4, 4]
        };
    }
    if (options && options.bl1Start != null) {
        annotations.bl1Region = {
            type: 'box',
            tpsRole: 'regionAlt',
            xMin: options.bl1Start, xMax: options.bl1End,
            borderWidth: 0
        };
        annotations.bl1Line = {
            type: 'line',
            tpsRole: 'residual',
            xMin: options.bl1Start, xMax: options.bl1Start,
            borderWidth: 1, borderDash: [3, 3],
            label: { display: true, content: 'BL1', position: 'start', font: { size: 10 } }
        };
    }
    if (options && options.bl2Start != null) {
        annotations.bl2Region = {
            type: 'box',
            tpsRole: 'regionAlt',
            xMin: options.bl2Start, xMax: options.bl2End,
            borderWidth: 0
        };
        annotations.bl2Line = {
            type: 'line',
            tpsRole: 'residual',
            xMin: options.bl2Start, xMax: options.bl2Start,
            borderWidth: 1, borderDash: [3, 3],
            label: { display: true, content: 'BL2', position: 'start', font: { size: 10 } }
        };
    }

    const base = dndcChartDefaults();
    return new Chart(ctx, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            ...base,
            showLine: true,
            plugins: {
                ...base.plugins,
                annotation: { annotations }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: dndcAxisTitle('Time (min)'),
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                },
                // 雙軸：軸線用該訊號的顏色，刻度與標題用文字色（標題寫明是哪個訊號）
                y: {
                    type: 'linear',
                    position: 'left',
                    tpsRole: 'primary',
                    title: dndcAxisTitle('UV (AU)'),
                    ticks: { font: { size: 10 } }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    tpsRole: 'model',
                    title: dndcAxisTitle('dRI (RIU)'),
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    }));
}

/**
 * 建立線性擬合圖
 * @param {string} canvasId - Canvas 元素 ID
 * @param {number[]} xData - X 軸資料（濃度）
 * @param {number[]} yData - Y 軸資料（ΔRI）
 * @param {object} fitResult - { dnDc, intercept, rSquared }
 * @param {object} [labels] - { xLabel, yLabel, title }
 * @returns {Chart} Chart.js 實例
 */
function createLinearFitChart(canvasId, xData, yData, fitResult, labels) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // 沒有資料點就不畫（空陣列會讓 Math.min() 回 Infinity）
    if (!Array.isArray(xData) || xData.length === 0) return null;

    const xLabel = (labels && labels.xLabel) || 'Concentration (g/mL)';
    const yLabel = (labels && labels.yLabel) || 'Δn (RIU)';

    // 擬合失敗（例如有效切片 < 2）時 fitResult 為 null：只畫散點，不解參考
    const hasFit = Boolean(fitResult) &&
        Number.isFinite(fitResult.dnDc) && Number.isFinite(fitResult.intercept);

    const datasets = [
        {
            label: 'Data',
            data: xData.map((x, i) => ({ x, y: yData[i] })),
            tpsRole: 'primary',
            pointRadius: 4,
            pointHoverRadius: 6
        }
    ];

    if (hasFit) {
        // 擬合線的端點
        const xMin = Math.min(...xData);
        const xMax = Math.max(...xData);
        const margin = (xMax - xMin) * 0.05;
        const fitLine = [
            { x: xMin - margin, y: fitResult.dnDc * (xMin - margin) + fitResult.intercept },
            { x: xMax + margin, y: fitResult.dnDc * (xMax + margin) + fitResult.intercept }
        ];
        const r2Text = Number.isFinite(fitResult.rSquared) ? fitResult.rSquared.toFixed(6) : '-';

        datasets.push({
            label: `Fit (dn/dc = ${fitResult.dnDc.toFixed(4)}, R² = ${r2Text})`,
            data: fitLine,
            tpsRole: 'fit',
            borderWidth: 2,
            pointRadius: 0,
            showLine: true,
            borderDash: [6, 3]
        });
    }

    return new Chart(ctx, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            ...dndcChartDefaults(),
            scales: {
                x: {
                    type: 'linear',
                    title: dndcAxisTitle(xLabel),
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    title: dndcAxisTitle(yLabel),
                    ticks: { font: { size: 10 } }
                }
            }
        }
    }));
}

window.DndcCharts = {
    createChromatogramChart,
    createLinearFitChart
};
```

- [ ] **Step 3：liposome-charts.js、dndc-hplc-results.js、dndc-astra-ui.js、dndc-export.js、dndc-ui.js**

**(1)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
 * 每個 canvas 只保留一個 Chart 實例（Map<canvasId, Chart>），重畫前 destroy。
 * 顏色沿用 charts.js 的字面值先例（Chart.js 讀不到 CSS 變數）。
 * 依賴：全域 Chart（Chart.js 4）與 annotation 外掛（index.html 已載入）。
```

改成：

```javascript
 * 每個 canvas 只保留一個 Chart 實例（Map<canvasId, Chart>），重畫前 destroy。
 * 顏色由 ChartTheme 依 tpsRole 決定（js/chart-theme.js）；本檔只標用途。
 * 依賴：全域 Chart（Chart.js 4）與 annotation 外掛（index.html 已載入）、ChartTheme（呼叫時才取用）。
```

**(2)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
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
```

改成：

```javascript
    const charts = new Map();
```

**(3)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
        destroyChart(canvasId);
        const chart = new global.Chart(canvas, config);
```

改成：

```javascript
        destroyChart(canvasId);
        const chart = new global.Chart(canvas, global.ChartTheme.colorize(config));
```

**(4)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
    function axis(title, extra = {}) {
        const { grid, ...rest } = extra;
        return {
            title: { display: true, text: title, color: LIPO_CHART_COLORS.text, font: { family: FONT, size: 11 } },
            ticks: { color: LIPO_CHART_COLORS.text, font: { family: MONO, size: 10 } },
            grid: { color: LIPO_CHART_COLORS.grid, ...(grid || {}) },
            ...rest,
        };
    }
```

改成：

```javascript
    function axis(title, extra = {}) {
        const { ChartTheme } = global;
        return {
            title: { display: true, text: title, font: { family: ChartTheme.FONT, size: 11 } },
            ticks: { font: { family: ChartTheme.MONO, size: 10 } },
            ...extra,
        };
    }

    /** x 軸：只留水平格線 */
    function xAxis(title, extra = {}) {
        return axis(title, { grid: { display: false }, ...extra });
    }
```

**(5)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
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
```

改成：

```javascript
    function baseOptions() {
        const { ChartTheme } = global;
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            normalized: true,
            plugins: {
                legend: { labels: { font: { family: ChartTheme.FONT, size: 12 } } },
                tooltip: {
                    cornerRadius: 8,
                    padding: 10,
                    titleFont: { family: ChartTheme.FONT, size: 12 },
                    bodyFont: { family: ChartTheme.MONO, size: 11 },
                },
            },
        };
    }

    /** role：ChartTheme 的用途名稱（primary／reference／model／residual） */
    function line(label, xs, ys, role, extra = {}) {
        return {
            label,
            data: xs.map((x, k) => ({ x, y: ys[k] })),
            tpsRole: role,
            borderWidth: 2,
            pointRadius: 0,
            ...extra,
        };
    }
```

**(6)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
            x: axis('q (Å⁻¹)', { type: 'logarithmic' }),
```

改成：

```javascript
            x: xAxis('q (Å⁻¹)', { type: 'logarithmic' }),
```

**(7)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
                window: {
                    type: 'box',
                    xMin: p.qMin,
                    xMax: p.qMax,
                    backgroundColor: LIPO_CHART_COLORS.window,
                    borderWidth: 0,
                    label: { display: true, content: 'q 視窗', position: 'start', font: { size: 10 }, color: LIPO_CHART_COLORS.text },
                },
```

改成：

```javascript
                window: {
                    type: 'box',
                    tpsRole: 'region',
                    xMin: p.qMin,
                    xMax: p.qMax,
                    borderWidth: 0,
                    label: { display: true, content: 'q 視窗', position: 'start', font: { size: 10 } },
                },
```

**(8)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
                    line('solution cell', sol.px, sol.py, LIPO_CHART_COLORS.primary),
                    line('bypass', byp.px, byp.py, LIPO_CHART_COLORS.reference),
                    line(`bypass ÷ ${p.factor.toPrecision(4)}`, byp.px, scaled, LIPO_CHART_COLORS.model, { borderDash: [5, 4] }),
```

改成：

```javascript
                    line('solution cell', sol.px, sol.py, 'primary'),
                    line('bypass', byp.px, byp.py, 'reference'),
                    line(`bypass ÷ ${p.factor.toPrecision(4)}`, byp.px, scaled, 'model', { borderDash: [5, 4] }),
```

**(9)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
            x: axis('波長 (nm)', { type: 'linear', min: useClip ? lo : dataLo, max: useClip ? hi : dataHi }),
```

改成：

```javascript
            x: xAxis('波長 (nm)', { type: 'linear', min: useClip ? lo : dataLo, max: useClip ? hi : dataHi }),
```

**(10)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
            annotations[`wl${k}`] = {
                type: 'line',
                xMin: w,
                xMax: w,
                borderColor: LIPO_CHART_COLORS.marker,
                borderWidth: 1,
                borderDash: [3, 3],
                label: { display: k === 1, content: `${w} nm`, position: 'end', font: { size: 10 }, color: LIPO_CHART_COLORS.text },
            };
```

改成：

```javascript
            annotations[`wl${k}`] = {
                type: 'line',
                tpsRole: 'marker',
                xMin: w,
                xMax: w,
                borderWidth: 1,
                borderDash: [3, 3],
                label: { display: k === 1, content: `${w} nm`, position: 'end', font: { size: 10 } },
            };
```

**(11)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
                    line('含藥 (Chol-DOX-Liposome)', p.loaded.wavelength, p.loaded.absorbance, LIPO_CHART_COLORS.reference),
                    line('空白 (Chol-Liposome)', p.blank.wavelength, p.blank.absorbance, LIPO_CHART_COLORS.model),
                    line('扣背景 (純 DOX 訊號)', p.subtracted.wavelength, p.subtracted.absorbance, LIPO_CHART_COLORS.primary, { borderWidth: 2 }),
```

改成：

```javascript
                    line('含藥 (Chol-DOX-Liposome)', p.loaded.wavelength, p.loaded.absorbance, 'reference'),
                    line('空白 (Chol-Liposome)', p.blank.wavelength, p.blank.absorbance, 'model'),
                    line('扣背景 (純 DOX 訊號)', p.subtracted.wavelength, p.subtracted.absorbance, 'primary', { borderWidth: 2.5 }),
```

**(12)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
            x: axis('波長 (nm)', { type: 'linear' }),
            y: axis('吸光度 (A.U.)', { type: 'linear', position: 'left' }),
```

改成：

```javascript
            x: xAxis('波長 (nm)', { type: 'linear' }),
            y: axis('吸光度 (A.U.)', { type: 'linear', position: 'left' }),
```

**(13)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
                    line('含藥實測', p.loaded.wavelength, p.loaded.absorbance, LIPO_CHART_COLORS.primary, { yAxisID: 'y' }),
                    line('空白 + k×純 DOX', p.model.wavelength, p.model.absorbance, LIPO_CHART_COLORS.model, { yAxisID: 'y', borderDash: [5, 4] }),
                    line('殘差', p.residual.wavelength, p.residual.absorbance, LIPO_CHART_COLORS.residual, { yAxisID: 'y1', borderWidth: 1 }),
```

改成：

```javascript
                    line('含藥實測', p.loaded.wavelength, p.loaded.absorbance, 'primary', { yAxisID: 'y' }),
                    line('空白 + k×純 DOX', p.model.wavelength, p.model.absorbance, 'model', { yAxisID: 'y', borderDash: [5, 4] }),
                    line('殘差', p.residual.wavelength, p.residual.absorbance, 'residual', { yAxisID: 'y1', borderWidth: 1.5 }),
```

**(14)** 改 `saxs-calculator/js/liposome-charts.js`。原文：

```javascript
    global.LiposomeCharts = Object.freeze({
        LIPO_CHART_COLORS,
        getChart,
```

改成：

```javascript
    global.LiposomeCharts = Object.freeze({
        getChart,
```

**(15)** 改 `saxs-calculator/js/dndc-hplc-results.js`。原文：

```javascript
    // Time 固定為 col 0
    const time = data.map(r => r[0]);

    const colors = [
        'rgba(240, 78, 78, 0.85)',
        'rgba(16, 185, 129, 0.85)',
        'rgba(236, 130, 130, 0.85)',
        'rgba(5, 150, 105, 0.85)',
        'rgba(234, 156, 156, 0.85)',
        'rgba(52, 211, 153, 0.85)',
        'rgba(232, 182, 182, 0.85)',
        'rgba(200, 50, 50, 0.85)',
        'rgba(236, 130, 130, 0.85)',
        'rgba(16, 185, 129, 0.85)'
    ];

    // 建立 checkbox toggles（跳過 Time 欄）
```

改成：

```javascript
    // Time 固定為 col 0
    const time = data.map(r => r[0]);

    // 建立 checkbox toggles（跳過 Time 欄）
```

**(16)** 改 `saxs-calculator/js/dndc-hplc-results.js`。原文：

```javascript
    // 預設顯示前 3 個通道
    const defaultVisible = new Set(channelIndices.slice(0, 3));

    togglesDiv.innerHTML = channelIndices.map((colIdx, i) => {
        const color = colors[i % colors.length];
        const checked = defaultVisible.has(colIdx) ? 'checked' : '';
        return `<label style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid ${color}; background: ${checked ? color.replace('0.85', '0.1') : 'transparent'};">
            <input type="checkbox" class="dndc-channel-toggle" data-col="${colIdx}" ${checked} style="margin: 0;">
            <span style="color: ${color}; font-weight: 500;">${escapeHtmlDndc(headers[colIdx])}</span>
        </label>`;
    }).join('');

    // 儲存供重繪用
    DndcState.channelChartData = { time, headers, data, colors, channelIndices };

    // 繪製
    redrawChannelsChart();

    // 綁定 checkbox 事件
    togglesDiv.querySelectorAll('.dndc-channel-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            // 更新 label 背景
            const label = cb.closest('label');
            const colIdx = parseInt(cb.dataset.col);
            const i = channelIndices.indexOf(colIdx);
            const color = colors[i % colors.length];
            label.style.background = cb.checked ? color.replace('0.85', '0.1') : 'transparent';
            redrawChannelsChart();
        });
    });
}
```

改成：

```javascript
    // 預設顯示前 3 個通道
    const defaultVisible = new Set(channelIndices.slice(0, 3));
    const seriesCount = ChartTheme.palette().series.length;

    // 顏色跟著通道（series = 通道在 channelIndices 的位置），不跟著勾選順序；
    // 系列色用完後重用同色、改虛線（與圖線一致）
    togglesDiv.innerHTML = channelIndices.map((colIdx, i) => {
        const checked = defaultVisible.has(colIdx);
        const classes = ['channel-chip', checked ? 'is-on' : '', i >= seriesCount ? 'channel-chip--dashed' : '']
            .filter(Boolean).join(' ');
        return `<label class="${classes}" data-series="${i}">
            <input type="checkbox" class="dndc-channel-toggle" data-col="${colIdx}" ${checked ? 'checked' : ''}>
            <span>${escapeHtmlDndc(headers[colIdx])}</span>
        </label>`;
    }).join('');
    paintChannelChips();

    // 儲存供重繪用
    DndcState.channelChartData = { time, headers, data, channelIndices };

    // 繪製
    redrawChannelsChart();

    // 綁定 checkbox 事件
    togglesDiv.querySelectorAll('.dndc-channel-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            cb.closest('label').classList.toggle('is-on', cb.checked);
            redrawChannelsChart();
        });
    });
}

/**
 * 依主題設定每個通道膠囊的 --chip-color（原始碼裡沒有色碼；切換主題時由 initChannelChipTheme 重設）。
 * @param {('light'|'dark')} [themeName] - 省略時用目前生效的主題
 */
function paintChannelChips(themeName) {
    const palette = ChartTheme.palette(themeName);
    document.querySelectorAll('#dndcChannelToggles .channel-chip').forEach(label => {
        label.style.setProperty('--chip-color', ChartTheme.seriesColor(palette, Number(label.dataset.series)));
    });
}

/** 由 dndc-ui.js 的 DOMContentLoaded 呼叫：主題切換時重設通道膠囊顏色（圖表本身由 ChartTheme.init 處理） */
function initChannelChipTheme() {
    document.addEventListener('tps:themechange', event => paintChannelChips(event.detail && event.detail.theme));
}
```

**(17)** 改 `saxs-calculator/js/dndc-hplc-results.js`。原文：

```javascript
    const { time, headers, data, colors, channelIndices } = DndcState.channelChartData;
```

改成：

```javascript
    const { time, headers, data, channelIndices } = DndcState.channelChartData;
```

**(18)** 改 `saxs-calculator/js/dndc-hplc-results.js`。原文：

```javascript
        const colIdx = parseInt(cb.dataset.col);
        const i = channelIndices.indexOf(colIdx);
        const color = colors[i % colors.length];
        const values = data.map(r => r[colIdx]);

        datasets.push({
            label: headers[colIdx],
            data: time.map((t, j) => ({ x: t, y: values[j] })),
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            showLine: true,
            yAxisID: `y${datasets.length}`
        });
    });

    // 每個通道獨立 y 軸（因為量級可能差很多）
    const scales = {
        x: {
            type: 'linear',
            title: { display: true, text: 'Time (min)', color: 'rgba(13,33,55,0.65)', font: { family: "'Inter', sans-serif", size: 12, style: 'italic' } },
            ticks: { color: 'rgba(13,33,55,0.65)', font: { size: 10 } },
            grid: { color: 'rgba(26, 26, 46, 0.12)' }
        }
    };

    datasets.forEach((ds, i) => {
        scales[`y${i}`] = {
            type: 'linear',
            position: i === 0 ? 'left' : 'right',
            title: { display: i < 2, text: ds.label, color: ds.borderColor, font: { family: "'Inter', sans-serif", size: 11 } },
            ticks: { color: ds.borderColor, font: { size: 9 } },
            grid: { display: i === 0, color: 'rgba(26, 26, 46, 0.10)' }
        };
    });

    DndcState.charts.chromatogram = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: {
                    labels: { color: 'rgba(13,33,55,0.65)', font: { family: "'Inter', sans-serif", size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,50,100,0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.85)',
                    cornerRadius: 4, padding: 8
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
                }
            },
            scales
        }
    });
}
```

改成：

```javascript
        const colIdx = parseInt(cb.dataset.col);
        const values = data.map(r => r[colIdx]);

        datasets.push({
            label: headers[colIdx],
            data: time.map((t, j) => ({ x: t, y: values[j] })),
            tpsSeries: channelIndices.indexOf(colIdx),
            borderWidth: 2,
            pointRadius: 0,
            showLine: true,
            yAxisID: `y${datasets.length}`
        });
    });

    // 每個通道獨立 y 軸（因為量級可能差很多）；軸線用該通道的顏色，刻度與標題用文字色
    const scales = {
        x: {
            type: 'linear',
            title: { display: true, text: 'Time (min)', font: { family: ChartTheme.FONT, size: 12, style: 'italic' } },
            ticks: { font: { size: 10 } },
            grid: { display: false }
        }
    };

    datasets.forEach((ds, i) => {
        scales[`y${i}`] = {
            type: 'linear',
            position: i === 0 ? 'left' : 'right',
            tpsSeries: ds.tpsSeries,
            title: { display: i < 2, text: ds.label, font: { family: ChartTheme.FONT, size: 11 } },
            ticks: { font: { size: 9 } },
            grid: { display: i === 0 }
        };
    });

    DndcState.charts.chromatogram = new Chart(canvas, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: {
                    labels: { font: { family: ChartTheme.FONT, size: 12 } }
                },
                tooltip: {
                    cornerRadius: 8, padding: 10
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
                }
            },
            scales
        }
    }));
}
```

**(19)** 改 `saxs-calculator/js/dndc-astra-ui.js`。原文：

```javascript
    const colors = [
        'rgba(240, 78, 78, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(236, 130, 130, 0.8)',
        'rgba(5, 150, 105, 0.8)',
        'rgba(234, 156, 156, 0.8)',
        'rgba(52, 211, 153, 0.8)',
        'rgba(232, 182, 182, 0.8)',
        'rgba(200, 50, 50, 0.8)'
    ];

    const datasets = [];
```

改成：

```javascript
    const datasets = [];
```

**(20)** 改 `saxs-calculator/js/dndc-astra-ui.js`。原文：

```javascript
        datasets.push({
            label,
            data: pf.riChannel.time.map((t, j) => ({ x: t, y: pf.riChannel.values[j] })),
            borderColor: colors[i % colors.length],
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            showLine: true
        });
```

改成：

```javascript
        datasets.push({
            label,
            data: pf.riChannel.time.map((t, j) => ({ x: t, y: pf.riChannel.values[j] })),
            tpsSeries: i,              // 依檔案編號（沒有 RI 的檔被跳過也不改變其他檔的顏色）
            borderWidth: 2,
            pointRadius: 0,
            showLine: true
        });
```

**(21)** 改 `saxs-calculator/js/dndc-astra-ui.js`。原文：

```javascript
        backgroundColor: 'rgba(240, 78, 78, 0.07)',
        borderColor: 'rgba(240, 78, 78, 0.3)',
        borderWidth: 1,
```

改成：

```javascript
        tpsRole: 'region',
        borderWidth: 1,
```

**(22)** 改 `saxs-calculator/js/dndc-astra-ui.js`。原文：

```javascript
    DndcState.charts.astraChromatogram = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: 'rgba(26, 26, 46, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(80, 20, 20, 0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255, 255, 255, 0.85)',
                    cornerRadius: 4,
                    padding: 8
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (min)',
                        color: 'rgba(26, 26, 46, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: 'rgba(26, 26, 46, 0.65)', font: { size: 10 } },
                    grid: { color: 'rgba(26, 26, 46, 0.12)' }
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'dRI (RIU)',
                        color: 'rgba(26, 26, 46, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 12, style: 'italic' }
                    },
                    ticks: { color: 'rgba(26, 26, 46, 0.65)', font: { size: 10 } },
                    grid: { color: 'rgba(26, 26, 46, 0.12)' }
                }
            }
        }
    });
}
```

改成：

```javascript
    DndcState.charts.astraChromatogram = new Chart(canvas, ChartTheme.colorize({
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        font: { family: ChartTheme.FONT, size: 12 }
                    }
                },
                tooltip: {
                    cornerRadius: 8,
                    padding: 10
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (min)',
                        font: { family: ChartTheme.FONT, size: 12, style: 'italic' }
                    },
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'dRI (RIU)',
                        font: { family: ChartTheme.FONT, size: 12, style: 'italic' }
                    },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    }));
}
```

**(23)** 改 `saxs-calculator/js/dndc-export.js`。原文：

```javascript
function downloadChartPng(chart, filename) {
    if (!chart) {
        showDndcAlert('hplcDndcResults', 'error', '尚未產生圖表，請先執行計算');
        return;
    }
    triggerDownload(chart.toBase64Image('image/png', 1), filename, false);
}
```

改成：

```javascript
/**
 * 下載圖表 PNG：一律淺色白底（深色模式下也是），由 ChartTheme.exportPng 暫時換色取圖後還原。
 * 脂質體頁（section-liposome.js）也呼叫這個函式。
 */
function downloadChartPng(chart, filename) {
    if (!chart) {
        showDndcAlert('hplcDndcResults', 'error', '尚未產生圖表，請先執行計算');
        return;
    }
    triggerDownload(ChartTheme.exportPng(chart), filename, false);
}
```

**(24)** 改 `saxs-calculator/js/dndc-ui.js`。原文：

```javascript
document.addEventListener('DOMContentLoaded', () => {
    initDndcSections();
    initExportButtons();
    initChartControls();
});
```

改成：

```javascript
document.addEventListener('DOMContentLoaded', () => {
    initDndcSections();
    initExportButtons();
    initChartControls();
    initChannelChipTheme();
});
```

- [ ] **Step 4：清空兩張棘輪名單**

**(1)** 改 `saxs-calculator/tests/no-color-literals.test.js`。原文：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([
    'js/charts.js',
    'js/dndc-astra-ui.js',
    'js/dndc-charts.js',
    'js/dndc-hplc-results.js',
    'js/liposome-charts.js',
]);
```

改成：

```javascript
const PENDING_LITERAL_FILES = Object.freeze([]);
```

**(2)** 改 `saxs-calculator/tests/token-usage.test.js`。原文：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([
    'js/dndc-hplc-results.js',
]);
```

改成：

```javascript
const PENDING_TOKEN_FILES = Object.freeze([]);
```

- [ ] **Step 5：確認色碼都收進 tokens.css 與 chart-theme.js**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
grep -rnE "rgba?\(|#[0-9a-fA-F]{6}\b|'Inter'|JetBrains" saxs-calculator/js --include='*.js' | grep -v "chart-theme.js" | grep -v "^\S*:\s*//\|^\S*:\s*\*"
```

Expected: 沒有輸出。若有輸出，要確認它只出現在註解裡。

- [ ] **Step 6：跑測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 208`、`ℹ fail 0`、`ℹ skipped 0`

- [ ] **Step 7：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/js saxs-calculator/tests
git commit -m "refactor(charts): colour every chart through ChartTheme; theme-aware channel chips"
```

---

## Task 12：規格修訂

**Files:** Modify: `docs/superpowers/specs/2026-10-14-apple-redesign-design.md`

規格裡有幾處與程式碼現況不符：表格名稱、行號、10 色系列、深色主線色。這個任務逐行修正這些地方，其餘修訂集中寫在新增的 §13。

- [ ] **Step 1：逐行修正**

狀態行（第 4 行），原文：

```markdown
- 狀態：設計已與使用者逐段確認，待使用者審閱本規格 → 撰寫實作計畫（v5.0、v5.1 各一份計畫）
```

改成：

```markdown
- 狀態：設計已與使用者逐段確認。v5.0 實作計畫 `docs/superpowers/plans/2026-10-14-apple-redesign-v5.0.md`（2026-10-15）；計畫階段的修訂見 §13，與前面各節不一致時以 §13 為準。v5.1 計畫待 v5.0 上線後再寫
```

§3.3 規則 5 的最後一句，原文：

```markdown
`section-hplc.js` 流速表的主步驟列（行內底色與 `color: #92400e` 字色）與 TM 模式字色，見 §5.6。
```

改成：

```markdown
`section-hplc.js` Detector Setting 表的主步驟列（行內底色與 `color: #92400e` 字色）與 TM 模式字色，見 §5.6。
```

§5.6 第四點，原文：

```markdown
- HPLC 流速表（`section-hplc.js:106-113`）：主步驟列改成 class，底色 `--color-warning-bg`、框數字用 `--color-warning-text` 加 700；TM 模式字色改成 class，TM 用 `--color-accent-text`、其他模式用 `--color-success-text`。
```

改成：

```markdown
- HPLC 頁的 Detector Setting 表（`section-hplc.js:106-114`，`#detectorSettingsTableBody`）：主步驟列改成 class `is-main-step`，底色 `--color-warning-bg`、框數字用 `--color-warning-text` 加 700；TM 模式字色改成 class，TM 用 `--color-accent-text`、其他模式用 `--color-success-text`。（流速表的提示列是既有的 `.flow-rate-row--note`。）
```

§6.1 色表的 `primary` 列，原文：

```markdown
| `primary` | #F04E4E | #F06464 | 3.6 ／ 5.3 | 樣品主線、UV 通道、散佈點、胺基酸組成長條 |
```

改成：

```markdown
| `primary` | #F04E4E | #E85858 | 3.6 ／ 4.7 | 樣品主線、UV 通道、散佈點、胺基酸組成長條 |
```

`region` 列，原文：

```markdown
| `region` | rgba(240,78,78,0.08) | rgba(240,100,100,0.14) | 豁免（填色） | 峰區、q 視窗 |
```

改成（下面多一列 `regionAlt`）：

```markdown
| `region` | rgba(240,78,78,0.08) | rgba(232,88,88,0.14) | 豁免（填色） | 峰區、q 視窗、ASTRA 積分範圍 |
| `regionAlt` | rgba(180,83,9,0.08) | rgba(245,183,84,0.12) | 豁免（填色） | HPLC 基線區間 |
```

`series` 列，原文：

```markdown
| `series[0..9]` | 實作時定 | 實作時定 | 每色 ≥ 3 | 多偵測器通道、胺基酸組成圓餅圖前 10 名 |
```

改成：

```markdown
| `series[0..7]` | #F04E4E #2A78D6 #0F8A6E #B45309 #6250D6 #C2307A #4D7C0F #0891B2 | #E85858 #4A8DDF #1FA27F #C08418 #9085E9 #E0629B #76A12B #1898B4 | 淺 ≥ 3.56 ／ 深 ≥ 4.73 | 多偵測器通道、ASTRA 多檔疊圖、胺基酸組成圓餅圖前 7 名 |
```

表格下方 `series` 那一點，原文：

```markdown
- `series` 的要求：兩個主題各 10 色；每色對卡片至少 3:1；相鄰色在常見色覺差異下仍可分辨；實作時用 dataviz skill 的驗證工具選定。它取代 `dndc-hplc-results.js`、`dndc-astra-ui.js` 的 8–10 色陣列（其中幾個淺粉色，例如 rgba(232,182,182)，對白底不到 3:1），以及 `charts.js` 圓餅圖（約 59–108 行）的 oklch 色相輪。圓餅圖第 11 片「Others」用 `reference`，扇區分隔線從寫死的 `#ffffff` 改用 `surface`。
```

改成：

```markdown
- `series` 共 8 色（2026-10-15 以 dataviz 驗證工具選定：每色對卡片 ≥ 3:1；相鄰色在常見色覺差異下 ΔE ≥ 10.5／10.6，一般視覺 ≥ 18.6／17.5；`series[0]` = `primary`）。類別色超過 8 個無法同時滿足對比與色覺區分，所以圓餅圖改成前 7 名＋「Others」（`reference`），第 9 個以後的通道重用 `series[i % 8]` 並改虛線 [6, 4]。它取代 `dndc-hplc-results.js`、`dndc-astra-ui.js` 的 8–10 色陣列（其中幾個淺粉色，例如 rgba(232,182,182)，對白底不到 3:1），以及 `charts.js` 圓餅圖的 oklch 色相輪。扇區分隔線從寫死的 `#ffffff` 改用 `surface`。
```

- [ ] **Step 2：在檔案最後加上 §13**

接在 §12 之後：

```markdown

## 13. 實作修訂（2026-10-15，v5.0 計畫階段）

寫 v5.0 計畫時對照 v4.15 的實際程式碼，並在 scratchpad 先完整實作、以 node 測試、axe 與 Playwright 驗證過一遍。以下是與前面各節不同、或前面沒寫清楚的地方，以本節為準。計畫：`docs/superpowers/plans/2026-10-14-apple-redesign-v5.0.md`。

1. **圖表色（§6.1，表格已同步修改）**
   - `series` 改為 8 色。dataviz 規範：類別色超過 8 個就無法同時滿足「對卡片 ≥ 3:1」與「相鄰色在常見色覺差異下可分辨」，第 9 個以後要併成「Others」或改用複合編碼。所以圓餅圖改成前 7 名＋「Others」（`reference`）；第 9 個以後的偵測器通道重用 `series[i % 8]` 並改虛線 [6, 4]，通道膠囊上的線段樣本同步改虛線。
   - 深色 `primary` 從 #F06464 改成 #E85858，與深色 `series[0]` 一致。
   - 新增用途 `regionAlt`（HPLC 基線區間的淡琥珀底）。峰起訖線用 `marker`；ASTRA 積分範圍 dataset 填色 `region`、邊線 `marker`。
   - 帶顏色的座標軸（dn/dc 的 UV／RI 軸、多通道的各 y 軸）**只有軸線**（`scales.*.border.color`）用該訊號的顏色，刻度與標題一律 `text` 色：文字不穿系列色，系列色當文字對比也不夠。軸標題寫明訊號名稱，識別不靠顏色。
   - annotation 線段標籤的底色用 `surface`（Chart.js annotation 預設是黑底）；box 的標籤維持透明。
   - 2026-10-15 以 Playwright 實測 Chart.js 4.5.1：`Chart.instances` 存在；`chart.config.options`／`.data` 就是建立時傳入的物件，寫入葉節點後 `update('none')` 會生效且 zoom 範圍保留；圖表檔用 `{...shared}` 淺展開的共用設定會被寫穿（所以 `colorize` 必須深拷貝）；動畫進行中 `update('none')` 不會同步重畫，`exportPng` 要先 `chart.stop()`。
2. **§3.2 與 §5.5 的衝突**：`.alert-info` 文字用 `--color-text-primary`（§5.5 為準）；`components.css:304`（流速表提示列最後一格）用 `--color-accent-text`。
3. **§3.3 規則 5、§5.6 表格名稱**：`section-hplc.js:106-114` 上色的是 **Detector Setting 表**（`#detectorSettingsTableBody`），不是流速表。流速表的提示列是既有的 `.flow-rate-row--note`。
4. **§5.5**：提示框原本沒有左側色條，是四邊 1px 邊框；v5.0 拿掉邊框。
5. **§5.6 表格 hover**：改用 `--color-bg-tertiary`（淺色 `--color-success-text` 在 `--color-bg-hover` 上只有 4.49:1）。主步驟列、流速表提示列的 `:hover` 維持各自底色（`.table tbody tr:hover` 的特異性比單一 class 高，不寫會被蓋掉）。
6. **§5.9 磚與面板**
   - 放在卡片裡的磚（`.gradient-stat`、`.result-card`、卡片內的 `.stat-card`）用 `--color-bg-tertiary`，避免白底疊白底；直接放在頁面上的 `#proteinStats` 才是白色磚（`--color-bg-card`＋`--shadow-sm`）。
   - 兩個理論值面板都用中性 tertiary，`--success`／`--warning` 修飾移除：它們代表「理論值」「建議」，不是狀態。面板內的數值格用卡片色；強調格（Predicted *R*g）是淡珊瑚疊在卡片色上——直接疊在面板上時，深色模式的灰色單位字只有 4.3:1（axe 抓到）。
   - 資料來源 chip：序列預測＝`--color-accent-tint` 底＋`--color-accent-text`；手動＝warning 那組；Guinier 實測＝success 那組。
   - `.stat-value`、`.result-card-value` 用 `--color-accent-text`；`.info-panel-value`、`.result-value` 用 `--color-text-primary`。
7. **§5.3 分組列表**：外框 1px `--color-separator`、圓角 12px、左內距 14px（分隔線因此內縮 14px）；列與列之間的分隔線只畫在兩個可見列之間。輸入框 8.5rem（約 9ch，中文 placeholder 也放得下）；≤480px 縮成 6rem，短標籤與輸入框留在同一列。13 組、39 個欄位；4 則純說明的 `alert-info` 改成列表下方的 `.form-list-foot`。
8. **§5.4**：沒有任何按鈕用到 danger 底，不新增 `.btn-danger`。`.btn-sm` 最小高 1.875rem（≈32px）、主要按鈕 2.625rem（≈44px）。
9. **§5.10**：左右對齊名單加上 div 型 prose：`.stat-sub`、`.quick-ref-body`、`.info-panel-formula`、`.info-panel-hint`、`.result-note`。盤點後沒有靠繼承置中的單行文字，不需要補 `text-align: center`。
10. **§4.3**：切換控制放在側欄導覽與 footer 之間；側欄收合時用 `display: none`（`opacity: 0` 仍留在 Tab 順序）。
11. **§5.8**：`::backdrop` 從 Chrome 122／Safari 17.4／Firefox 120 起才繼承自訂屬性；更舊的瀏覽器遮罩色會變透明（blur 仍在，對話框照常可用）。
12. **§8.1**：既有測試基準是 179（不是 159），v5.0 完成後 208。用途測試另加「不准任何 `border-left`」；`structure.test.js` 另加「每個 `new Chart(` 都經過 `ChartTheme.colorize(`」；對比矩陣加上語意色 `-text` × tertiary、`--color-text-muted` × 淡珊瑚疊卡片。測試指令要用 `node --test saxs-calculator/tests/*.test.js`（Node 26 不接受目錄形式）。
13. **§8.4 驗收**：axe 要用 `preload: false` 執行——預載會去抓 Google Fonts 樣式表，被本站 CSP 的 `connect-src` 擋下而在 console 報錯，不是網站的問題。
```

- [ ] **Step 3：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add docs/superpowers/specs/2026-10-14-apple-redesign-design.md
git commit -m "docs: record v5.0 plan revisions in the redesign spec"
```

---

## Task 13：瀏覽器驗收（主 session 做）

**規格：** §8.4

**Files:** 驗收腳本放 scratchpad，不 commit；發現的問題修好後各自 commit

Claude-in-Chrome 連到的瀏覽器在別台機器上，所以本機驗收用 Playwright：`/Users/hsutingwei/Projects/text-to-cad/.venv/bin/python`（headless chromium 已安裝）。dn/dc 頁用 `sessionStorage.dndcUnlocked` 解鎖，**不要在腳本裡輸入密碼**。

- [ ] **Step 1：開兩個本機伺服器（v5.0 與 v4.15 對照）**

```bash
cd /Users/hsutingwei/Desktop/TPS13A/saxs-calculator && python3 -m http.server 8791 --bind 127.0.0.1   # 背景執行
mkdir -p <scratchpad>/v415 && git -C /Users/hsutingwei/Desktop/TPS13A archive 6b02fbe saxs-calculator | tar -x -C <scratchpad>/v415
cd <scratchpad>/v415/saxs-calculator && python3 -m http.server 8793 --bind 127.0.0.1                  # 背景執行
```

- [ ] **Step 2：存驗收腳本並執行**

存成 `<scratchpad>/verify_v5.py`：

```python
"""v5.0 瀏覽器驗收（改版規格 §8.4）。用法：
    /Users/hsutingwei/Projects/text-to-cad/.venv/bin/python verify_v5.py <截圖輸出目錄> [port]
需要先在 saxs-calculator/ 開 `python3 -m http.server <port> --bind 127.0.0.1`（預設 8791；不要用 8765）。
dn/dc 頁用 sessionStorage 解鎖，不輸入密碼。全部通過時 exit 0，任何一項失敗 exit 1。
"""
import base64
import json
import sys

from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
PORT = sys.argv[2] if len(sys.argv) > 2 else '8791'
URL = f'http://127.0.0.1:{PORT}/index.html'
AXE = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js'
PAGES = ['protein', 'saxs', 'hplc', 'sample', 'mw', 'centrifuge', 'detector', 'liposome',
         'dndc-theory', 'dndc-hplc', 'dndc-multi', 'dndc-slice', 'iucr']
BUTTONS = {'protein': '#analyzeProtein', 'saxs': '#calculateSAXS', 'hplc': '#calculateHPLCSAXS',
           'sample': '#calculateSample', 'mw': '#calculateMW', 'centrifuge': '#calculateCentrifuge',
           'detector': '#calculateDetectorBtn', 'dndc-theory': '#calculateDndcCorrection'}
BSA = ('MKWVTFISLLLLFSSAYSRGVFRRDTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLASSARQRLRCASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALA')
AXE_RUN = """async (sel) => {
    const r = await axe.run(document.querySelector(sel), { preload: false, resultTypes: ['violations'] });   // preload 會去抓 Google Fonts 樣式表，被本站 CSP 擋下而在 console 報錯
    return r.violations.map(v => ({ id: v.id, nodes: v.nodes.slice(0, 5).map(n => n.target.join(' ') + ' :: ' + ((n.any[0] && n.any[0].message) || '').slice(0, 140)) }));
}"""

report = {'console': [], 'axe': {}, 'checks': {}}
failed = []


def check(name, ok, detail=None):
    report['checks'][name] = {'ok': bool(ok), 'detail': detail}
    if not ok:
        failed.append(name)


def new_page(browser, scheme, width):
    ctx = browser.new_context(viewport={'width': width, 'height': 1000}, color_scheme=scheme)
    ctx.add_init_script("sessionStorage.setItem('dndcUnlocked','true')")
    page = ctx.new_page()
    page.on('console', lambda m: report['console'].append(f'[{scheme} {width}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: report['console'].append(f'[{scheme} {width}] pageerror: {e}'))
    page.goto(URL)
    page.wait_for_timeout(500)
    return ctx, page


def open_section(page, name):
    page.evaluate(f"document.querySelector('.nav-item[data-section=\"{name}\"]').click()")
    page.wait_for_timeout(300)
    if name == 'protein':
        page.fill('#proteinSequence', BSA)
    if name in BUTTONS:
        page.click(BUTTONS[name], timeout=3000)
        page.wait_for_timeout(600)


def screenshots_and_axe(browser):
    for scheme in ('light', 'dark'):
        for width in (1440, 390):
            ctx, page = new_page(browser, scheme, width)
            if width == 1440:
                page.add_script_tag(url=AXE)
            for name in PAGES:
                open_section(page, name)
                page.screenshot(path=f'{OUT}/{name}-{scheme}-{width}.png', full_page=True)
                if width == 1440:
                    v = page.evaluate(AXE_RUN, f'#section-{name}')
                    if v:
                        report['axe'][f'{scheme}:{name}'] = v
            if width == 1440:
                v = page.evaluate(AXE_RUN, '#sidebar')
                if v:
                    report['axe'][f'{scheme}:sidebar'] = v
            ctx.close()
    check('axe：兩個主題 13 頁＋側欄 0 違規', not report['axe'], report['axe'] or None)


def interactions(browser):
    ctx, page = new_page(browser, 'light', 1440)
    check('預設自動：沒有 data-theme，「自動」被選取',
          page.evaluate("document.documentElement.getAttribute('data-theme') === null && document.getElementById('themeAuto').checked"))

    # HPLC dn/dc：合成 10 通道（第 9、10 個重用色＋虛線）
    open_section(page, 'dndc-hplc')
    page.evaluate("""() => {
        const headers = ['Time', ...Array.from({ length: 10 }, (_, i) => 'Ch' + (i + 1))];
        const data = Array.from({ length: 200 }, (_, k) => [k * 0.1, ...Array.from({ length: 10 }, (_, c) => Math.sin(k / 10 + c) * (c + 1))]);
        displayAllChannelsChart({ headers, data });
        document.querySelectorAll('.dndc-channel-toggle').forEach(cb => { if (!cb.checked) cb.click(); });
    }""")
    page.wait_for_timeout(300)
    chips = "[...document.querySelectorAll('#dndcChannelToggles .channel-chip')].map(l => l.style.getPropertyValue('--chip-color'))"
    lines = "DndcState.charts.chromatogram.config.data.datasets.map(d => d.borderColor)"
    light_chips = page.evaluate(chips)
    check('通道膠囊與圖線同色（淺色）', light_chips == page.evaluate(lines), light_chips)
    check('第 9 個以後的通道改虛線', page.evaluate(
        "DndcState.charts.chromatogram.config.data.datasets.map(d => (d.borderDash || []).length > 0).join()") ==
        ','.join(['false'] * 8 + ['true'] * 2))
    page.evaluate("DndcState.charts.chromatogram.zoomScale('x', { min: 5, max: 10 }, 'none')")

    # 鍵盤切到深色：聚焦「自動」→ 方向鍵右兩次
    page.focus('#themeAuto')
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(300)
    check('方向鍵切到深色：data-theme=dark、localStorage=dark',
          page.evaluate("document.documentElement.getAttribute('data-theme') === 'dark' && localStorage.getItem('tps13a-theme') === 'dark'"))
    dark_chips = page.evaluate(chips)
    check('切換主題後膠囊與圖線就地換色', dark_chips != light_chips and dark_chips == page.evaluate(lines), dark_chips)
    zoom = "[DndcState.charts.chromatogram.scales.x.min, DndcState.charts.chromatogram.scales.x.max]"
    check('切換主題後 zoom 範圍保留', page.evaluate(zoom) == [5, 10], page.evaluate(zoom))
    page.screenshot(path=f'{OUT}/interaction-dark-chips.png', full_page=True)

    # 深色下匯出 PNG：白底、淺色線；畫面維持深色與 zoom
    url = page.evaluate("ChartTheme.exportPng(DndcState.charts.chromatogram)")
    with open(f'{OUT}/export-from-dark.png', 'wb') as fh:
        fh.write(base64.b64decode(url.split(',')[1]))
    corner = page.evaluate("""(u) => new Promise(res => { const i = new Image(); i.onload = () => {
        const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
        const x = c.getContext('2d'); x.drawImage(i, 0, 0); res(Array.from(x.getImageData(2, 2, 1, 1).data)); }; i.src = u; })""", url)
    check('深色模式匯出的 PNG 是白底', corner == [255, 255, 255, 255], corner)
    check('匯出後畫面仍是深色、zoom 不變',
          page.evaluate(lines) == dark_chips and page.evaluate(zoom) == [5, 10])

    page.reload()
    page.wait_for_timeout(400)
    check('重新整理後仍是深色、「深色」被選取',
          page.evaluate("document.documentElement.getAttribute('data-theme') === 'dark' && document.getElementById('themeDark').checked"))

    page.emulate_media(media='print')
    check('深色模式下列印用淺色 token（內文 #1D1D1F）',
          page.evaluate("getComputedStyle(document.body).color") == 'rgb(29, 29, 31)')
    page.emulate_media(media='screen')

    page.click('label[for="themeAuto"]')
    page.wait_for_timeout(200)
    check('選「自動」移除 data-theme 與 localStorage',
          page.evaluate("document.documentElement.getAttribute('data-theme') === null && localStorage.getItem('tps13a-theme') === null"))

    # 自動模式跟著系統外觀；手動淺色不理會系統
    open_section(page, 'protein')
    page.evaluate("window.__themeEvents = []; document.addEventListener('tps:themechange', e => window.__themeEvents.push(e.detail.theme))")
    bar = "AppState.charts.bar.config.data.datasets[0].backgroundColor"
    light_bar = page.evaluate(bar)
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(300)
    check('自動模式：系統切深色時頁面與圖表跟著換',
          page.evaluate(bar) != light_bar and page.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(18, 18, 20)'
          and page.evaluate('window.__themeEvents') == ['dark'])
    page.click('label[for="themeLight"]')
    page.wait_for_timeout(200)
    page.emulate_media(color_scheme='light')
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(300)
    check('手動淺色：系統外觀改變不派發事件、維持淺色',
          page.evaluate('window.__themeEvents') == ['dark', 'light'] and page.evaluate(bar) == light_bar)

    page.click('#sidebarToggle')
    page.wait_for_timeout(300)
    check('側欄收合時主題切換 display:none（離開 Tab 順序）',
          page.evaluate("getComputedStyle(document.getElementById('themeToggle')).display") == 'none')
    page.click('#sidebarToggle')
    ctx.close()

    # 對話框：鎖住狀態下開密碼對話框，焦點進輸入框，Escape 關閉並回到按鈕（不輸入密碼）
    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_timeout(400)
    page.click('#dndcNavUnlock')
    page.wait_for_timeout(200)
    focused = page.evaluate('document.activeElement && document.activeElement.id')
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    check('密碼對話框：開啟時焦點在輸入框、Escape 關閉後回到解鎖按鈕',
          focused == 'dndcPasswordInput' and page.evaluate('document.activeElement && document.activeElement.id') == 'dndcNavUnlock',
          focused)
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch()
    screenshots_and_axe(browser)
    interactions(browser)
    browser.close()

errors = [c for c in report['console'] if 'error' in c]
check('console 沒有錯誤', not errors, errors or None)
print(json.dumps(report, ensure_ascii=False, indent=1))
print('失敗項目：', failed or '無')
sys.exit(1 if failed else 0)
```

```bash
mkdir -p <scratchpad>/v5shots
/Users/hsutingwei/Projects/text-to-cad/.venv/bin/python <scratchpad>/verify_v5.py <scratchpad>/v5shots 8791
```

Expected: 最後一行 `失敗項目： 無`，exit 0。腳本會檢查：
- console 沒有錯誤。
- axe：兩個主題、13 頁加側欄都是 0 違規。
- 通道膠囊與圖線同色；第 9 個以後的通道是虛線。
- 方向鍵切換主題；切換後就地換色，zoom 保留。
- 深色模式匯出的 PNG 是白底，畫面不變。
- 重新整理後仍保留選擇；選回「自動」會清除設定。
- 深色模式下列印用淺色。
- 自動模式跟著系統；手動淺色不理會系統。
- 側欄收合時切換控制隱藏。
- 對話框的焦點管理。

- [ ] **Step 3：數字不變抽查（v4.15 vs v5.0）**

存成 `<scratchpad>/compare_numbers.py`：

```python
"""v5.0 只改外觀：同樣輸入下，v4.15 與 v5.0 每頁「有 id 的葉節點」與結果區的文字必須一字不差。
用法：.../python compare_numbers.py <舊版 port> <新版 port>
"""
import json
import sys

from playwright.sync_api import sync_playwright

OLD, NEW = sys.argv[1], sys.argv[2]
PAGES = ['protein', 'saxs', 'hplc', 'sample', 'mw', 'centrifuge', 'detector', 'dndc-theory']
BUTTONS = {'protein': '#analyzeProtein', 'saxs': '#calculateSAXS', 'hplc': '#calculateHPLCSAXS',
           'sample': '#calculateSample', 'mw': '#calculateMW', 'centrifuge': '#calculateCentrifuge',
           'detector': '#calculateDetectorBtn', 'dndc-theory': '#calculateDndcCorrection'}
SEQ = 'MKWVTFISLLLLFSSAYSRGVFRRDTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLASSARQRLRCASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALA'
COLLECT = """(name) => {
    const sec = document.getElementById('section-' + name);
    const skip = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'CANVAS', 'OPTION']);
    const leaves = [...sec.querySelectorAll('[id]')]
        .filter(el => !skip.has(el.tagName) && el.children.length === 0)
        .map(el => [el.id, el.textContent.replace(/\\s+/g, ' ').trim()]);
    const results = [...sec.querySelectorAll('[id$="Results"], [id$="results"], tbody[id]')]
        .map(el => [el.id, el.textContent.replace(/\\s+/g, ' ').trim()]);
    return { leaves, results };
}"""


def snapshot(port):
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={'width': 1440, 'height': 1000})
        page.goto(f'http://127.0.0.1:{port}/index.html')
        page.wait_for_timeout(500)
        out = {}
        for name in PAGES:
            page.evaluate(f"document.querySelector('.nav-item[data-section=\"{name}\"]').click()")
            page.wait_for_timeout(200)
            if name == 'protein':
                page.fill('#proteinSequence', SEQ)
            page.click(BUTTONS[name])
            page.wait_for_timeout(500)
            out[name] = page.evaluate(COLLECT, name)
        b.close()
        return out


old, new = snapshot(OLD), snapshot(NEW)
diffs = []
for name in PAGES:
    for kind in ('leaves', 'results'):
        a, b = dict(old[name][kind]), dict(new[name][kind])
        for key in sorted(set(a) | set(b)):
            if a.get(key) != b.get(key):
                diffs.append({'page': name, 'kind': kind, 'id': key, 'v4.15': a.get(key), 'v5.0': b.get(key)})
count = sum(len(old[n]['leaves']) + len(old[n]['results']) for n in PAGES)
print(f'比對 {count} 個欄位；不同：{len(diffs)}')
print(json.dumps(diffs, ensure_ascii=False, indent=1))
sys.exit(1 if diffs else 0)
```

```bash
/Users/hsutingwei/Projects/text-to-cad/.venv/bin/python <scratchpad>/compare_numbers.py 8793 8791
```

Expected: `比對 47 個欄位；不同：0`

- [ ] **Step 4：逐張看截圖**

`<scratchpad>/v5shots/` 有 52 張：13 頁 × 淺／深 × 1440／390。另有 `interaction-dark-chips.png` 與 `export-from-dark.png`。逐張用 Read 看，重點：
- **分組列表：**
  - 每組的分隔線只畫在列與列之間。
  - 偵測器頁 MW／Rg 模式只顯示一列。
  - 390px 寬時短標籤與輸入框在同一列。
- **珊瑚色的位置：** 只出現在按鈕、選中導覽項、結果數值與資料來源 chip。
- **深色模式漏網：** 沒有白底殘留。圖表軸線、格線、圖例、提示框都是深色版本。
- **雙軸圖：** 軸線是訊號色，刻度是灰字。
- **段落：** 多行段落左右對齊，單行文字沒有被拉開。

發現問題：
- 修在對應的檔案，跑 node 測試，各自 commit（`fix: …`）。
- 修完重跑 Step 2–3。
- 如果修法要改測試的期望值或棘輪名單，停下來回報。

- [ ] **Step 5：關掉伺服器**

```bash
lsof -ti tcp:8791,8793 | xargs kill   # 只關這兩個 port；不要動 8765
```

---

## Task 14：bump v5.0、回報、合併與上線（主 session 做）

**Files:** Modify: `saxs-calculator/index.html`（footer 版本號與所有 `?v=`）

- [ ] **Step 1：bump 版本**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
sed -i '' -e 's/Version 4\.15/Version 5.0/' -e 's/?v=4\.15"/?v=5.0"/g' saxs-calculator/index.html
grep -c '?v=5.0"' saxs-calculator/index.html     # 本地 css 5 個＋js 46 個 = 51
grep -n 'Version 5.0' saxs-calculator/index.html
grep -c '?v=4.15' saxs-calculator/index.html     # 0
```

- [ ] **Step 2：最終測試**

Run: `cd /Users/hsutingwei/Desktop/TPS13A && node --test saxs-calculator/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `ℹ pass 208`、`ℹ fail 0`、`ℹ skipped 0`

- [ ] **Step 3：Commit**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git add saxs-calculator/index.html
git commit -m "chore: v5.0"
```

- [ ] **Step 4：回報使用者，等同意**

回報內容：
- 截圖重點：用一頁淺色＋一頁深色說明外觀變化。
- 驗收結果：axe、互動檢查、數字比對。
- 與規格不同的決定：8 色系列、圓餅圖前 7 名＋Others、第 9 個以後的通道改虛線、深色主線 #E85858、Detector Setting 表、中性理論值面板。
- 兩項請使用者自己確認：
  - 在光束線電腦上用遠端桌面看一次：毛玻璃效能、白卡邊界、沒有 SF 字型時的版面。
  - 在 Mac 上切換系統外觀，看自動模式是否跟著變。

**沒有得到明確同意前不要合併、不要 push。**

- [ ] **Step 5：合併並 push（使用者同意後）**

```bash
cd /Users/hsutingwei/Desktop/TPS13A
git switch main
git merge --ff-only feat/apple-redesign-v5
git push origin main
gh run list --limit 1          # 等 Pages 部署完成；偶爾回 HTTP 500，重試即可
curl -s https://twawei.github.io/TPS13A-SAXS-Calculator/ | grep -o 'Version 5\.0'
git branch -d feat/apple-redesign-v5
```

出問題時，`git revert` 這次合併的所有 commit，bump 成 v5.0.1 後推上（規格 §9.4）。
