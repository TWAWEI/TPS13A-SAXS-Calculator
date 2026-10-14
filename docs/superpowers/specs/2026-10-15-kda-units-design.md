# 分子量單位改 kDa ＋ 手機寬度溢出修正（v5.1）— 設計規格

- 日期：2026-10-15
- 狀態：設計已與使用者確認（2026-10-15）。使用者要求直接開工，本規格末節的步驟清單即實作計畫。規格審查（同日）無阻擋項，採納的建議已併入各節
- 目標產品：`saxs-calculator/`，v5.0 → v5.1
- 與改版規格的關係：原本排在 v5.1 的結果磚（`2026-10-14-apple-redesign-design.md` §7）順延到 v5.2，見 §9

## 1. 目標與範圍

使用者說「裡面的單位 Da，所有計算都習慣用 kDa」。把畫面上的分子量單位從 Da 改成 kDa，並順便修掉 390px 寬時 HPLC 頁與偵測器頁的水平溢出（v4.15 就有，記在 `review_findings_2026_08_21` 第 6 項）。

**在範圍內**
1. 5 個分子量輸入欄位改收 kDa。
2. 所有分子量顯示改成 kDa（約 15 處，含表格標題與 IUCr 表）。
3. 蛋白質頁保留一個 Da 精確值。
4. 數值超過 10,000 kDa 時提示「是不是輸入了 Da」，但照常計算。
5. 舊存檔（Da）自動換算成 kDa。
6. 以 Da 為自變數的冪次公式說明補註「MW 以 Da 代入」。
7. 390px 寬時任何頁面都不再水平捲動。

**不在範圍內**
- 計算函式與 Excel 對照測試：一律維持 Da，換算只發生在畫面邊界。
- 非分子量的數字：前後必須一字不差。
- 結果磚（v5.2）。
- dn/dc 的 Python 介面。

## 2. 使用者定案（2026-10-15）

| 問題 | 決定 |
|---|---|
| 上線順序 | 先做 kDa 與溢出修正（v5.1），結果磚順延到 v5.2 |
| kDa 小數位數 | 顯示一律 2 位，例如 69.29 kDa、± 3.50 kDa。例外：自動帶入**欄位**的值用 3 位（1 Da 精度，見 §4），2 位小數（10 Da 一格）會讓帶入值與序列 MW 差到 5 Da |
| Da 保留在哪裡 | 只有蛋白質頁：合併成一項「分子量 69.29 kDa」，下方小字「69,293.82 Da」。其餘只顯示 kDa，輸入欄位與 IUCr 表也一樣 |
| 誤輸入 | 只提示、照樣計算。超過 10,000 kDa 時欄位下方出現琥珀色提示：「超過 10,000 kDa（10 MDa），是不是輸入了 Da？例：66500 Da 請輸入 66.5」 |

## 3. 架構：`js/mass-units.js`

新的小模組，掛在 `window.MassUnits`（`Object.freeze`），與 `chart-theme.js` 一樣用 IIFE、頂層不碰 DOM，Node 測試可直接載入。

| 成員 | 內容 |
|---|---|
| `DA_PER_KDA` | 1000 |
| `WARN_ABOVE_KDA` | 10000（等於 10,000 kDa 不提示，大於才提示） |
| `INPUT_IDS` | `theoreticalMWInput`、`inputMw`、`mwInput`、`centrifugeMw`、`targetProteinMW` |
| `STATE_UNIT` | `'kDa'`：存檔裡的單位標記 |
| `daToKDa(da)`／`kDaToDa(kDa)` | 純換算 |
| `formatKDa(da)` | Da → kDa 字串，固定 2 位、`en-US` 千分位；非有限值回 `'-'`。只回數字，單位寫在標記裡（沿用現有的 `<span>` 單位） |
| `formatDa(da)` | Da 字串，固定 2 位、`en-US` 千分位，只回數字（只給蛋白質頁用） |
| `toInputValue(da)` | 自動帶入用：kDa、最多 3 位小數（1 Da 精度），去掉尾端 0，例如 69293.82 → `"69.294"`、66500 → `"66.5"`；非有限值回 `''` |
| `isLikelyDa(kDa)` | `kDa > WARN_ABOVE_KDA` |
| `migrateSavedValues(values)` | 回傳新物件：`INPUT_IDS` 裡 ≥ 1,000 的數值字串 ÷ 1000（經 `toInputValue`），其餘原樣；不修改傳入物件。小於 1,000 的見 §8 |
| `writeInput(el, da)` | 自動帶入：寫入 `toInputValue(da)` 並更新提示。不派發 input／change 事件（與現行帶入行為相同：不觸發自動存檔與重算） |
| `initInputHints(doc)` | 為 5 個欄位建立提示元素、綁定事件，並依目前的值（可能是剛還原的）顯示提示 |

載入順序：`index.html` 放在 `form-utils.js` 之後；`tests/load.js` 的 `LOAD_ORDER` 同步加入。

## 4. 輸入欄位

| 欄位 | 頁面 | 屬性變更 | 讀值 |
|---|---|---|---|
| `theoreticalMWInput` | SAXS 理論值面板 | `aria-label="分子量 MW (kDa)"`、單位 `kDa`、`step="any"` | `section-saxs.js` × 1000 |
| `inputMw` | 樣品計算 | 單位 `kDa`、`step="any"` | `section-sample.js` × 1000 |
| `mwInput` | 分子量解析度 | 單位 `kDa`、`step="any"` | `section-mw.js` × 1000 |
| `centrifugeMw` | 離心參數 | 單位 `kDa`、預設 `66.5`、`step="any"` | `section-centrifuge.js` × 1000 |
| `targetProteinMW` | 偵測器距離 | 單位 `kDa`、預設 `66.5`、`min="1" max="10000" step="any"`（原 1000／10,000,000 Da） | `section-detector.js` × 1000 |

- 自動帶入（`section-protein.js` 3 個、`section-saxs.js` 1 個）一律走 `MassUnits.writeInput`。原本 `inputMw`／`mwInput` 帶 0.01 Da、另兩個帶整數 Da；統一成 1 Da 精度後，`inputMw`／`mwInput` 最多差 0.5 Da（相對 < 10⁻⁵），不影響任何顯示位數。
- `section-saxs.js` 的 `getTheoreticalOpts` 判斷「面板 MW 是否就是序列 MW」，容差從 1 Da 放寬為 5 Da（常數 `SEQUENCE_MW_TOLERANCE_DA`）。序列帶入最多差 0.5 Da；使用者照結果的 2 位小數重打（69.29 kDa）會差 3.8 Da，1 Da 容差會讓它悄悄退回經驗式。
- `section-saxs.js` 的 × 1000 只套在欄位讀到的值；欄位空白時退回的 `AppState.proteinData.molecularWeight` 本來就是 Da。

## 5. 顯示

全部改用 `MassUnits.formatKDa`，單位 `kDa`。原本顯示 `-` 的地方照舊。

| 位置 | 原本 | 改成 |
|---|---|---|
| 蛋白質頁結果：「分子量」＋「分子量 (kDa)」兩項 | `69293.82 Da`、`69.294 kDa` | 合併成一項「分子量」`69.29 kDa`，下方 `.result-note`「69,293.82 Da」 |
| 蛋白質頁統計卡 | `69.29 kDa`／小字 `69294 Da` | `69.29 kDa`／小字 `69,293.82 Da` |
| 樣品計算結果「分子量」 | `toFixed(2) Da` | kDa |
| 分子量解析度：質量解析度（正、反算） | `± toFixed(0) Da` | `± 3.50 kDa` |
| 分子量解析度：實際分子量、估算分子量 | `toLocaleString()`／`toFixed(0)` Da | kDa |
| 分子量解析度：完成訊息 | `(mw / 1000).toFixed(2) kDa` | `formatKDa`（同值，多千分位） |
| 分子量解析度：與序列 MW 比較 | 序列 MW／SEC MW `toFixed(0) Da` | kDa（比值不變） |
| SAXS 結果：MW from Porod／序列／*I*(0) Guinier／*I*(0) *P*(*r*) | `toFixed(0) Da` | kDa |
| 偵測器：預測 MW 結果卡 | `toLocaleString()`、單位 Da，HTML 預設 `66,500` | kDa，預設 `66.50` |
| 偵測器：標準蛋白質參考表 | 標題 `MW (Da)`；66,500／130,000／12,700 | `MW (kDa)`；66.50／130.00／12.70 |
| IUCr 表：MW from sequence／Porod volume | 2 位／0 位 Da | `formatKDa`，單位欄 `kDa` |

## 6. 公式說明補註

冪次律（Rg ∝ MW^0.43、MW^⅓）與 *I*(0) 經驗式的係數是以 Da 為自變數校正的；畫面改 kDa 後，照抄公式代 kDa 會錯好幾個數量級。以下各處補註「MW 以 Da 代入」：

- `index.html` 理論值面板公式列（*I*(0)=*c*×MW×7.9×10⁻⁷、*R*g=0.2508×MW^0.4301）
- `index.html` `detectorRgSource` 的 `title`
- `index.html` 偵測器頁公式說明（0.69 × MW^1/3）與其下的 0.251 × MW^0.43 附註
- `detector-rg-panel.js` 的預測來源說明
- `section-saxs.js` 的 *I*(0) 方法標籤（`c×MW×7.9×10⁻⁷`）
- `section-protein.js` 的 *ε*<sub>mass</sub> = *ε* / MW 說明（MW 以 g/mol 計；代 kDa 會大 1000 倍）

## 7. 誤輸入提示

- `initInputHints` 在每個欄位後面建立 `<p class="field-warning" id="<欄位id>UnitHint" aria-live="polite">`，並把 id 加進欄位的 `aria-describedby`。元素一直存在；內容空白時用視覺隱藏（絕對定位、1px、clip），**不用 `display: none`**——live 區域必須留在無障礙樹裡，後來填入的文字才會被讀出。絕對定位也讓空提示不參與表單列的 flex 換行，列高不變。
- 位置：表單列表裡放在 `.form-input-group` 之後（該列是 flex-wrap，提示以 `flex: 1 0 100%` 自成一行）；理論值面板放在 `.info-panel-header` 之後。
- 觸發：欄位的 `input`／`change` 事件、`writeInput`、`initInputHints` 當下（涵蓋剛還原的值）。
- 樣式：`--color-warning-text`、0.75rem。表單列表是卡片底、理論值面板是 tertiary 底，兩者都是 `contrast.test.js` 已涵蓋的組合。
- 只提示，不擋計算、不改值。

## 8. 存檔遷移

- `saveFormState` 的存檔多一個欄位：`{ savedAt, massUnit: 'kDa', values }`。
- `readFormState`：存檔沒有 `massUnit: 'kDa'`（v5.0 以前，含 v4.6 前的扁平格式）時，`values` 經 `MassUnits.migrateSavedValues` 換算，並立刻寫回（帶標記），之後不會再換算第二次。寫回與既有的「清掉密碼欄位」合併成一次。
- 有欄位被換算時，還原提示條多一句「分子量已由 Da 換算為 kDa」。
- 只存「偏離預設值」的欄位：`centrifugeMw`／`targetProteinMW` 的舊預設 66500 本來就不會被存，不受影響。
- 小於 1,000 的舊值不換算：SAXS 不會量到 1 kDa 以下的蛋白質（偵測器欄位原本的下限就是 1,000 Da），這種值是使用者在 v5.0 照 kDa 習慣打進 Da 欄位的；原樣保留，正好就是他要的 kDa。
- 寫回失敗時存檔維持舊的 Da 值，下次開頁再換算一次仍然正確；還開著的 v5.0 分頁自動存檔不帶標記，也會在下次開頁時正確換算。

## 9. 手機寬度溢出

- 成因（2026-10-15 實測）：`.grid-2`／`.grid-3` 的 `1fr` 是 `minmax(auto, 1fr)`，最小值等於內容的最小寬度。卡片裡的寬表格把整欄撐到 480／490px，`.table-wrapper` 的 `overflow-x: auto` 沒機會發揮。
- 修法：`css/layout.css` 加 `.grid > * { min-width: 0; }`，表格改在自己的框內橫捲。
- 驗收：390px 寬時每一頁（含 dn/dc 已解鎖的子頁）`document.documentElement.scrollWidth === 390`，淺色與深色各一次。

## 10. 對改版規格的影響

- 改版規格 §7（結果磚）改稱 v5.2；§7.2 表格中 SAXS 主角的「`toFixed(0)` Da」改為 `formatKDa` 的 kDa。在改版規格加 §14 記錄，前面各節不改。
- `CLAUDE.md` Design Context 裡的「v5.1 再加大數字結果磚」「18 (v5.1 tiles)」改成 v5.2。
- `tests/markup.test.js` 的開頭註解「v5.1 補 aria-live」改成 v5.2。

## 11. 測試與驗證

**自動測試**（`node --test saxs-calculator/tests/*.test.js`）
1. `tests/mass-units.test.js`：`formatKDa`／`formatDa`（位數、千分位、非有限值）、`toInputValue`（3 位、去尾端 0、非有限值）、`isLikelyDa`（10,000 不提示、10,000.01 提示）、`migrateSavedValues`（只換 5 個欄位、空字串與非數值原樣、不修改傳入物件）、`kDaToDa(daToKDa(x))` 與 `x` 相差在浮點誤差內（不能用 `===`：例如 3.97 → 3.9700000000000006）。
2. 同檔的靜態掃描：去掉註解後，`index.html` 與所有 `js/section-*.js`、`js/detector-rg-panel.js` 不得出現當作單位的 `Da`。允許的只有「MW 以 Da 代入」與蛋白質頁 `formatDa` 那一處。
3. `tests/markup.test.js`：允許 `aria-label=分子量 MW (Da)` 改名為 `(kDa)`（以改名對照表處理，不重產 fixture）。
4. 既有 210 個測試全過。

**瀏覽器驗收**（Playwright，scratchpad）
1. v5.0（`git archive dffb01e`，port 8793）與 v5.1（8791）對照：兩邊輸入同一組數據（v5.0 填 Da、v5.1 填 kDa），比對 8 頁所有結果文字。非分子量欄位一字不差；分子量欄位等於 v5.0 的 Da ÷ 1000 取 2 位。
2. 誤輸入：每個欄位填 66500 → 出現提示、結果照算；改回 66.5 → 提示消失；序列自動帶入會清掉舊提示。
3. 存檔遷移：預先寫入 v5.0 格式的存檔（含 5 個 Da 值）→ 重新整理 → 欄位變 kDa、提示條多一句、存檔帶 `massUnit`；再重新整理不會再除一次。
4. 390px：所有頁面 `scrollWidth === 390`，兩個主題。
5. axe 兩個主題 0 違規；全程沒有 console error。

## 12. 上線

- 版本 v5.1：側欄 footer 與所有本地 `?v=` 一起改。
- 在分支 `feat/kda-units-v5.1` 上做，code review 後回報使用者，同意後才合併並 push。

## 13. 實作步驟

1. `mass-units.js` 與單元測試（先寫測試）；加進 `index.html` 與 `tests/load.js`。
2. 靜態掃描測試（先失敗），再改所有顯示與 `index.html` 的單位、表格。
3. 5 個欄位的讀值 × 1000、自動帶入改 `writeInput`、欄位屬性與預設值。
4. 提示：CSS ＋ `initInputHints`（`app.js` 在 `initFormPersistence` 之後呼叫）。
5. 存檔遷移與還原提示句。
6. 公式補註。
7. `.grid > * { min-width: 0 }`。
8. `markup.test.js` 改名對照、版本 5.1、`CLAUDE.md`、改版規格 §14。
9. 瀏覽器驗收、code review、回報。
