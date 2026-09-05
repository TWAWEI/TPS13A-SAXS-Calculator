# 脂質體 DOX 載藥量（D/L）計算頁 — 設計規格

- 日期：2026-09-05
- 狀態：設計已與使用者確認，待實作規劃
- 目標產品：`saxs-calculator/`（GitHub Pages 單頁站），新版本 v4.14
- 來源規格：本地 Excel `Liposome DOX-loading calculation-Bypass.xlsx`（研究生論文用，`.gitignore` 已擋 `*.xlsx`，不進公開 repo）

## 1. 目標與範圍

把 Excel 的 `dilution` 與 `DL` 兩個工作表搬進網站，並把「操作說明」工作表的步驟 2–3（UV 光譜加總檢查、扣背景）一起自動化。使用者從此不必在 PRIMUS、Excel、Origin 之間手抄數字。

**在範圍內**
1. 上傳 solution cell 與 bypass 兩條 SAXS 曲線（.dat），在 q 視窗內算稀釋因子。
2. 上傳 Chol-DOX-Liposome 與 Chol-Liposome 兩條 UV-Vis 光譜，扣背景得純 DOX 吸收；選填純 DOX 光譜做濃度一致性目視檢查。
3. 由 494/495/496 nm 吸光度、ε、光徑、脂質原始濃度、稀釋因子算 D/L 與誤差。
4. 結果表累積多個樣品，可刪列、匯出 CSV，重新整理後仍在。

**不在範圍內**
- SAXS 曲線的合併、背景扣除（在 PRIMUS 完成後才上傳）。
- UV 分光光度計的專屬匯出格式（只收兩欄純文字）。
- 多樣品批次上傳；一次只處理一個樣品。
- D/L 換算成重量百分比或包覆效率（需要 DOX 與脂質分子量，Excel 沒做）。
- 自動峰值搜尋；波長固定為可調的三個點。
- 密碼鎖。此功能無專有格式問題，放在 SAXS 主站公開區。

## 2. 使用者流程

側欄新增「脂質體 DOX 載藥」（收合短標「載藥」），位置在「偵測器距離」之後、dn/dc 群組之前。一頁由上到下三個面板加一張結果表，一次一個樣品：

1. **面板 1 稀釋因子**：選兩個 .dat 檔，按「計算稀釋因子」。看到因子、離散度、疊圖。可手動覆寫。
2. **面板 2 UV 光譜**：選兩個（或三個）光譜檔，按「扣背景」。看到扣背景光譜、三個波長的吸光度。可手動覆寫三個吸光度。
3. **面板 3 D/L**：填樣品名、脂質原始濃度，確認 ε 與光徑，按「計算 D/L」。看到 [DOX]、實際脂質濃度、D/L ± 誤差與誤差拆解。
4. 按「加入結果表」存成一列。**加入後不清任何欄位**：檔案、因子、吸光度、圖表、樣品名全部留著，只把 `lipoAddResult` 停用，直到下一次「計算 D/L」成功才再啟用。這樣連按不會重複加列，打錯字改完重算就能再加，錯的那列用表格的「刪除」拿掉。換下一個樣品時，面板 1、2 的檔案要重選，面板 3 的常數保留。

面板 2、3 不依賴面板 1 的檔案，只依賴「目前的稀釋因子數值」；因此使用者也可以完全不上傳 SAXS，直接手填 PRIMUS 給的因子。

## 3. 介面規格

所有元素 id 以 `lipo` 為前綴。表單元素沿用現有 `.form-group / .form-label / .form-input` 樣式，結果沿用 `.stat-card` 家族與 `.result-grid` 家族（見 §3.5）、`.alert-*`、`.table-wrapper .table`，圖表用已載入的 Chart.js 4.5.1 與 annotation 外掛。**不新增 CDN 來源，不用行內 script 或 onclick**（CSP）。

### 3.1 面板 1 稀釋因子

| 元素 | id | 說明 |
|---|---|---|
| 檔案輸入 | `lipoSolutionFile` | solution cell .dat，`accept=".dat,.txt,.csv"` |
| 檔案輸入 | `lipoBypassFile` | bypass .dat |
| 數值 | `lipoQMin` / `lipoQMax` | q 視窗，預設 0.1 / 0.15 Å⁻¹，step 0.005 |
| 按鈕 | `lipoComputeDilution` | 「計算稀釋因子」，`.btn.btn-primary` |
| 結果容器 | `lipoDilutionResults` | `role="status"`；顯示因子、SD、視窗內點數、最小平方參考值、排除點數 |
| 數值輸入 | `lipoDilutionFactor` | 目前採用的稀釋因子；計算後自動填入，可手動改 |
| 來源 chip | `lipoDilutionChip` | `.info-panel-chip` 放在 `lipoDilutionFactor` 的 `.form-label` 內（白卡上只有這個位置對比足夠，`panels.css:234`）；「SAXS 計算」用基底樣式、「手動」加 `--manual`；沿用 `detector-rg-panel.js` 的來源管理模式 |
| 畫布 | `lipoDilutionChart` | log-log 疊圖 |

行為：
- 兩個檔都選好才啟用按鈕。任一檔解析失敗 → `showAlert('lipoDilutionResults', 'error', …)` 取代結果區內容；**狀態、`lipoDilutionFactor` 的值、chip、圖表都不動**（保留上一次有效結果的意思僅止於此）。
- 計算成功後 `lipoDilutionFactor` 填入平均值（六位有效數字），chip 切到「SAXS 計算」，SD 存在 state 供面板 3 的誤差用。**之後 `lipoDilutionFactor` 的輸入值就是唯一真值**：面板 3 讀輸入框，relF = state.sd ÷ 輸入值。
- 使用者手改 `lipoDilutionFactor` → chip 切到「手動」，state.sd = 0（誤差只剩 UV 項），`lipoFactorEcho` 註明「手動因子無離散度」。
- 最小平方參考值與平均值相差超過 5% 時，結果區的渲染函式自己在結果 HTML 裡加一列 `.alert.alert-warning`：「逐點平均與最小平方縮放相差 x%，請確認 q 視窗內兩曲線形狀一致」。這不是 `showAlert`（見 §3.5）。

### 3.2 面板 2 UV 光譜

| 元素 | id | 說明 |
|---|---|---|
| 檔案輸入 | `lipoLoadedFile` | Chol-DOX-Liposome（含藥）光譜，必填 |
| 檔案輸入 | `lipoBlankFile` | Chol-Liposome（空白脂質體）光譜，必填 |
| 檔案輸入 | `lipoPureFile` | 純 DOX 光譜，選填 |
| 數值 | `lipoFitMin` / `lipoFitMax` | 純 DOX 縮放擬合的波長範圍，預設 450 / 550 nm |
| 按鈕 | `lipoComputeSpectra` | 「扣背景」 |
| 結果容器 | `lipoSpectraResults` | `role="status"` |
| 畫布 | `lipoSpectraChart` | 含藥、空白、扣背景三條線；三個讀值波長畫垂直註解線 |
| 畫布 | `lipoFitChart` | 只在有純 DOX 時顯示：含藥實測 vs（空白 + k×純 DOX）模型 vs 殘差 |
| 數值 ×3 | `lipoWl1` / `lipoWl2` / `lipoWl3` | 讀值波長，預設 494 / 495 / 496 nm |
| 數值 ×3 | `lipoAbs1` / `lipoAbs2` / `lipoAbs3` | 三個吸光度；計算後自動填入，可手動改 |
| 來源 chip | `lipoAbsChip` | 放在 `lipoAbs2` 的 `.form-label` 內；「光譜讀值」基底、「手動」`--manual` |

行為：
- 扣背景成功後自動填三個吸光度（**五位小數**，Excel 的精度；四位會讓 A ≈ 0.08 的樣品 SD 在第四位有效數字上偏移），顯示三值的樣本標準差，chip 切「光譜讀值」。
- 有純 DOX 檔時額外顯示 k（縮放係數）與擬合範圍內殘差 RMS，文字說明「k 是讓『空白 + k×純 DOX』最貼近含藥光譜的縮放；殘差大代表兩樣品脂質濃度可能不一致」。網站**不**自動判定通過與否。
- 任一必填檔解析失敗的處理同 §3.1：`showAlert('lipoSpectraResults', 'error', …)` 取代結果區，吸光度輸入值、chip、圖表都不動。
- 改讀值波長後若已有扣背景光譜，立即重新讀值（`input` 事件），不必重按按鈕。波長超出光譜範圍時 `absorbanceAt` 會 throw：在 handler 內接住，`showAlert('lipoSpectraResults', 'error', …)`，三個吸光度輸入框維持原值。
- 手改任一吸光度 → chip 切「手動」，state.absorbance.sd 改為三個輸入值的樣本標準差。**三個吸光度輸入框是唯一真值**，面板 3 讀輸入框。

### 3.3 面板 3 D/L

| 元素 | id | 說明 |
|---|---|---|
| 文字 | `lipoSampleName` | 樣品名，最長 60 字 |
| 數值 | `lipoLipidConc` | 脂質原始濃度 **mM**（Excel 的 0.0117 M 顯示成 11.7） |
| 數值 | `lipoEpsilon` | ε，預設 9250 L·mol⁻¹·cm⁻¹；label 下方 `.stat-sub` 註明「495 nm，Lee et al., Int. J. Nanomed. 20 (2025) 6357–6378」 |
| 數值 | `lipoPathLength` | 光徑，預設 0.2 cm（SAXS 毛細管厚度） |
| 唯讀顯示 | `lipoFactorEcho` | 回顯目前稀釋因子與來源 |
| 按鈕 | `lipoComputeDl` | 「計算 D/L」 |
| 結果容器 | `lipoDlResults` | `role="status"` |

結果區顯示：[DOX] (mM) ± SD、實際脂質濃度 (mM)、**D/L ± 誤差**（主值，`.stat-card` 大字）、誤差拆解兩行「UV 三波長貢獻 x%」「稀釋因子貢獻 y%」，以及一行小字「Excel 原式（僅 UV）：D/L ± z」。

### 3.4 結果表

| 元素 | id | 說明 |
|---|---|---|
| 按鈕 | `lipoAddResult` | 「加入結果表」；只有面板 3 算出有效結果時啟用 |
| 表格 | `lipoResultsTable` / `lipoResultsBody` | `.table-wrapper > table.table`，有 `<caption>`，`th scope="col"` |
| 按鈕 | `lipoExportCsv` | 「匯出 CSV」，共用 `downloadCsv()`（`dndc-export.js`） |
| 按鈕 | `lipoClearResults` | 「清空」，用原生 `<dialog class="modal-dialog">` 確認（沿用 `dndc-lock.js` 的 dialog 模式，不用 `confirm()`） |

欄位：樣品名、稀釋因子、因子來源、A(主波長)、[DOX] mM、實際脂質 mM、D/L、誤差、加入時間。A(主波長) 的表頭用**目前** `lipoWl2` 的值（例如「A(495 nm)」），`lipoWl2` 的 `input` 事件會重繪整張表（列數上限 200，成本可忽略）；每列自己存 `primaryWavelengthNm`，與表頭不同時該格加 `title="讀值波長 494 nm"` 並在數字後標「(494)」。CSV 的中繼欄位帶每列自己的波長。每列末端有「刪除」按鈕（`aria-label="刪除 <樣品名>"`）。

持久化：以 `FormUtils.safeLocal` 存 JSON 到 key `tps13a.liposome.results`，上限 200 列，超過時拒絕加入並提示。載入頁面時還原。所有字串進 innerHTML 前過 `FormUtils.escapeHtml`。

CSV：UTF-8 BOM（`downloadCsv` 已處理），檔名 `liposome-DL-YYYYMMDD.csv`，數值不四捨五入，欄名與表格一致，另加 ε、光徑、q 視窗、讀值波長四個中繼欄位讓結果可重現。**字串欄位一律 RFC 4180 引號**（樣品名可能含逗號或引號）：包在雙引號裡，內部雙引號寫成兩個；現有的 dn/dc 匯出沒做這件事，這裡要自己寫一個 `csvCell()`。

### 3.5 錯誤與狀態

- **整個容器的錯誤狀態**用 `showAlert(containerId, 'error', message)`；它會取代容器 innerHTML 並把 role 改成 alert（`alerts.js`），所以只用在「這次操作失敗、沒有可顯示的結果」。計算函式 throw 的訊息直接顯示，UI 不再包裝。
- **成功結果裡的警告列**（例如 §3.1 的 5% 提醒、§3.2 的殘差說明）由各面板的渲染函式自己組進結果 HTML（`<div class="alert alert-warning">`），不呼叫 `showAlert`。
- **成功渲染後呼叫 `A11y.focusResults(containerId)`**（現有十個結果渲染器都這樣做，例如 `dndc-hplc-results.js:123`）：它會拿掉 `showAlert` 留下的 `role="alert"` 並把焦點移到結果，否則「先錯後對」會讓整塊結果被螢幕閱讀器用 assertive 唸出來。
- 結果區的 HTML 用現有類別：`.result-grid > .result-item > .result-label / .result-value`（`components.css`），主值用 `.stat-card > .stat-content > .stat-label / .stat-value / .stat-unit / .stat-sub`（`panels.css`）；參考 `dndc-hplc-results.js` 的寫法。**沒有 `.stat` 這個類別。**
- 檔案大小上限 5 MB、點數上限 100,000；超過即拒絕並提示，不讀取。
- 沒有任何路徑會靜默回 0 或 NaN（沿用第 1 批「算不出就 throw」原則）。

## 4. 計算規格

新檔 `js/liposome-calculations.js`。**三個純模組（計算、解析、圖表）一律用 `form-utils.js` 的 IIFE 寫法** `(function (global) { … global.X = Object.freeze({…}); })(typeof window !== 'undefined' ? window : globalThis);`，內部函式不在第 0 欄，不會撞到既有的頂層識別字（`readFile`、`linearFit`、`_std`、`calculateDilutionFactor` 都已被別的檔佔用），`tests/load.js` 照樣可 require。掛 `window.LiposomeCalculations`。純函式、無 DOM、不改動輸入物件（回傳新物件）。內部單位：濃度 M、長度 cm、q Å⁻¹、波長 nm；mM 與 M 的換算只在 UI 層。

### 4.1 常數

```js
const DEFAULTS = Object.freeze({
    Q_MIN: 0.1, Q_MAX: 0.15,          // Å⁻¹，Excel dilution 頁與操作說明
    MIN_WINDOW_POINTS: 5,
    EPSILON_DOX: 9250,                // L·mol⁻¹·cm⁻¹ @495 nm，Lee et al. 2025
    PATH_CM: 0.2,
    WAVELENGTHS_NM: [494, 495, 496],
    PRIMARY_WAVELENGTH_NM: 495,       // Excel J 欄只用 495
    FIT_MIN_NM: 450, FIT_MAX_NM: 550,
    LSQ_WARN_REL: 0.05,
});
```

### 4.2 `interpolateLinear(xs, ys, x)`

`xs` 嚴格遞增。x 在範圍外 → throw。回傳線性內插值。供下面所有函式使用；獨立匯出以便測試。

### 4.3 `computeDilutionFactor(solution, bypass, { qMin, qMax })`

輸入兩條曲線 `{ q: number[], i: number[] }`（q 各自嚴格遞增）。

1. 取 solution 中 `qMin ≤ q ≤ qMax` 的點。
2. 對每個點把 bypass 線性內插到同一 q；若 q 超出 bypass 範圍則排除該點。
3. 排除 `I_sol ≤ 0` 或 `I_byp ≤ 0` 的點（log-log 與比值都無意義）。
4. 剩餘點數 < `MIN_WINDOW_POINTS` → throw「q 視窗內只有 n 個有效點，至少需要 5 個」。
5. `ratio_k = I_byp(q_k) / I_sol(q_k)`；`factor = mean(ratio)`；`sd = 樣本標準差`（n = 1 時 sd = 0）。
6. `lsqScale = Σ(I_sol·I_byp) / Σ(I_sol²)`（PRIMUS I Scale 的等價式）。
7. 回傳 `{ factor, sd, n, lsqScale, excluded: { outOfRange, nonPositive }, ratios: [...], q: [...] }`。

驗證 Excel：其 dilution 頁是第 n 列直接配對（q 差約 2×10⁻⁴ Å⁻¹），結果 0.4386；本法內插後的結果須落在 0.4386 ± 1%。

### 4.4 `subtractSpectra(loaded, blank)`

輸入 `{ wavelength: number[], absorbance: number[] }` 兩條。以 loaded 的波長格點為準，把 blank 內插上去再相減；loaded 超出 blank 範圍的點捨棄。重疊區少於 10 點 → throw。回傳新光譜 `{ wavelength, absorbance, dropped }`。

### 4.5 `fitPureDoxScale(loaded, blank, pure, { fitMin, fitMax })`

在 `fitMin ≤ λ ≤ fitMax` 的 loaded 格點上，把 blank 與 pure 內插過來，求最小平方解
`k = Σ[(L−B)·P] / Σ(P²)`，其中 L、B、P 為三條光譜在同一 λ 的值。
回傳 `{ k, rms, n, model: { wavelength, absorbance } }`，model = B + k·P（整段重疊範圍，不只擬合區）。擬合區內點數 < 10 或 Σ(P²) = 0 → throw。

### 4.6 `absorbanceAt(spectrum, wavelengthsNm)`

對每個波長線性內插；任一波長超出範圍 → throw（訊息附範圍）。回傳 `number[]`。

### 4.7 `computeDrugToLipid(params)`

```
params = { absorbances: [A1, A2, A3], primaryIndex: 1, primaryWavelengthNm: 495,
           epsilon, pathCm, lipidMolar, factor, factorSd }
```

1. 驗證：三個吸光度有限；`A_primary > 0`（否則 throw「主波長 {primaryWavelengthNm} nm 的吸光度非正」，波長取自參數、措辭不假設來源；UI 在 `state.absorbance.source === 'spectrum'` 時才在訊息後接「請確認含藥／空白檔沒有互換」）；`epsilon, pathCm, lipidMolar, factor > 0`；`factorSd ≥ 0`。
2. `sdA = 樣本標準差(absorbances)`（Excel F 欄）。
3. `doxConc = A_primary / (epsilon · pathCm)`；`doxSd = sdA / (epsilon · pathCm)`（Excel J、K 欄）。
4. `lipidActual = lipidMolar · factor`（Excel O 欄）。
5. `dl = doxConc / lipidActual`（Excel Q 欄）。
6. `relA = sdA / A_primary`；`relF = factorSd / factor`。
7. `dlSd = dl · √(relA² + relF²)`；`dlSdExcel = dl · relA`（Excel R 欄，僅供顯示）。
8. 回傳 `{ doxConc, doxSd, lipidActual, dl, dlSd, dlSdExcel, relA, relF }`。

Excel 回歸值（DL 頁六列，ε 9250、l 0.2）：

| 樣品 | A494 | A495 | A496 | M [M] | N | Q (D/L) | R (Excel 誤差) |
|---|---|---|---|---|---|---|---|
| DOX-18 | 0.90287 | 0.91973 | 0.94266 | 0.0117 | 0.454 | 0.09359376319728743 | 0.002032396638192102 |
| DOX-20 | 0.74644 | 1.05761 | 0.89623 | 0.0108 | 0.526 | 0.10063390386584302 | 0.01480767552474392 |
| DOX-22 | 0.07752 | 0.0764 | 0.08737 | 0.011 | 0.556 | 0.006752337687589486 | 0.0005334920222687899 |
| Chol-DOX-18 | 0.69825 | 0.8085 | 0.69407 | 0.01 | 0.54 | 0.08093093093093093 | 0.006495815219697592 |
| Chol-DOX-20 | 0.86094 | 0.74027 | 0.96326 | 0.0105 | 0.556 | 0.06854161458478004 | 0.01033496895850612 |
| Chol-DOX-22 | 0.80352 | 0.75896 | 0.79255 | 0.01 | 0.417 | 0.0983809708989565 | 0.0030095498767000206 |

Q、R 是 Excel 的完整快取值（openpyxl `data_only=True` 讀出，2026-09-05），不是四捨五入的顯示值。測試以 `factorSd = 0` 代入，`dl` 與 `dlSdExcel` 須與 Q、R 相對誤差 < 1e-9（同樣的雙精度算術，差異只剩浮點順序）。

## 5. 檔案解析

新檔 `js/liposome-file-parsers.js`，掛 `window.LiposomeFileParsers = Object.freeze({ parseSaxsDat, parseUvSpectrum, LIMITS })`。兩個解析器共用一個內部 `numericRows(text, minCols)`：逐行 trim，跳過空行與 `#` 開頭行，以 `/[\s,;]+/` 切欄，前 `minCols` 欄必須是有限數，否則整行跳過並計數（這樣 PRIMUS/ATSAS 的文字標頭、儀器匯出的欄名列都自然被略過）。

- `parseSaxsDat(text)` → `{ q, i, err | null, skipped, sorted }`。至少 2 欄（`numericRows(text, 2)` 只驗前兩欄）；**只有當每一個被接受的列都有有限的第 3 欄時**才回 `err` 陣列，否則 `err: null`。0 有效列 → throw「找不到數值列」。`sorted` 永遠是布林：q 非嚴格遞增 → 依 q 穩定排序後回傳並設 `sorted: true`（本地 bypass 檔開頭就有一列亂序的 q = 0）；有重複 q → throw。
- `parseUvSpectrum(text)` → `{ wavelength, absorbance, skipped, sorted }`。2 欄。波長非嚴格遞增（含部分儀器 850→190 的遞減匯出）→ 依波長穩定排序並設 `sorted: true`，與 `parseSaxsDat` 同一套；重複波長 → throw。內插函式需要嚴格遞增，這裡是唯一的保證點。
- `LIMITS = Object.freeze({ MAX_BYTES: 5 * 1024 * 1024, MAX_POINTS: 100000 })`；UI 在讀檔前檢查 `file.size`，解析後檢查點數。
- 讀檔共用 `DndcFileParser.readFile(file)`（回傳 `Promise<string>`）。不用 `DndcFileParser.parseCSV`：它固定把第一列當標頭，會吃掉沒有標頭的光譜檔第一列。

## 6. 圖表

新檔 `js/liposome-charts.js`，掛 `window.LiposomeCharts`，匯出 `renderDilutionChart / renderSpectraChart / renderFitChart / getChart(canvasId)`。每個 canvas 只保留一個 Chart 實例：建立前先 `destroy()` 舊實例（以 `Map<canvasId, Chart>` 管理）。顏色沿用 `charts.js` 的字面 rgba 物件先例（Chart.js 無法讀 `var(--x)`），定義模組內 `LIPO_CHART_COLORS` 四個字面值：主曲線 `#F04E4E`（`tokens.css` 的 `--color-accent-brand`，僅限圖線）、參考曲線 `#5a5a78`（`--color-text-muted`）、模型線 `#047857`（CLAUDE.md 的 emerald 文字色，`tokens.css` 沒有這個 token）、殘差 `#92400e`（`--color-accent-tertiary-text`）。

- `renderDilutionChart(canvasId, { solution, bypass, factor, qMin, qMax })`：x、y 都是 `logarithmic`；三個資料集：solution、bypass、bypass ÷ factor（虛線）；非正 I 的點不畫；q 視窗以 annotation `box` 淡色標出。
- `renderSpectraChart(canvasId, { loaded, blank, subtracted, wavelengths })`：線性軸；三條線；讀值波長畫三條 annotation `line`。x 軸範圍取資料範圍與 250–600 nm 的交集，若交集為空則用資料範圍。
- `renderFitChart(canvasId, { loaded, model, residual })`：含藥實測、模型、殘差（第二 y 軸）。
- 所有 canvas 有 `role="img"` 與 `aria-label`（沿用現有做法）；圖表下方提供「下載 PNG」共用 `downloadChartPng(chartInstance, filename)`——它吃 **Chart 實例**不是 canvas id，而且找不到實例時會把錯誤丟到 dn/dc 的 `hplcDndcResults` 容器，所以呼叫前先用 `getChart()` 確認實例存在，沒有就停用按鈕。

## 7. UI 模組

新檔 `js/section-liposome.js`，匯出全域 `initLiposomeSection()`，由 `app.js` 在 `initIUCrSection()` 之後呼叫。

狀態物件單一來源，每次更新都產生新物件（不就地修改）：

```js
state = {
  dilution: { factor, sd, n, lsqScale, source: 'saxs' | 'manual' | null },
  spectra:  { loaded, blank, pure, subtracted, fit } | null,
  absorbance: { values: [a, b, c], sd, source: 'spectrum' | 'manual' | null },
  dl: computeDrugToLipid 的回傳 | null,
  results: [ { id, sampleName, factor, factorSource, aPrimary, primaryWavelengthNm,
               doxConcMM, lipidActualMM, dl, dlSd, addedAt, meta } ]
}
```

- **輸入框是真值，state 是鏡像**：`lipoDilutionFactor` 與 `lipoAbs1–3` 每次 `input` 事件都把值同步回 `state.dilution.factor` / `state.absorbance.values`（並依 §3.1/§3.2 規則更新 source 與 sd）；`lipoFactorEcho`、結果列、`computeDrugToLipid` 的參數全部從 state 取。
- **`state.dl` 是快照，只在「計算 D/L」成功時建立，並把當時的所有參數（因子、來源、三個吸光度、主波長、ε、光徑、脂質濃度、樣品名）一起存進去；結果列只從這個快照組出來。** `lipoDilutionFactor`、`lipoAbs1–3`、`lipoWl1–3`、`lipoLipidConc`、`lipoEpsilon`、`lipoPathLength` 任一個 `input` 事件都把 `state.dl` 設回 `null` 並停用 `lipoAddResult`，直到下一次計算成功。這樣不會出現「吸光度改了、D/L 還是舊的」的列進到 CSV。
- 檔案輸入不持久化（`form-persistence.js` 已跳過 `type=file`）；q 視窗、擬合範圍、讀值波長、ε、光徑、脂質濃度、樣品名由現有機制自動存檔。
- **chip 管理的四個欄位 `lipoDilutionFactor`、`lipoAbs1`、`lipoAbs2`、`lipoAbs3` 加進 `form-persistence.js` 的 `PERSIST_SKIP_IDS`**，不持久化——沿用 `detectorRgInput` 的先例。理由：重新整理後 SD 與來源都不存在，還原數值只會做出一個沒有來源的因子。載入頁面時兩個 chip 都 `hidden`，`lipoFactorEcho` 顯示「尚未設定稀釋因子」。
- `results` 在每次變動後寫 localStorage；讀取失敗（損壞 JSON）→ 視為空表並 `console.warn`，不擋頁面。
- 檔案大於 800 行時拆成 `section-liposome.js`（面板 1–3）與 `liposome-results-table.js`（結果表）；預估各 300–400 行，先以單檔實作，超標再拆。

## 8. index.html 與樣式

- 側欄：在 `data-section="detector"` 之後插入 `<button class="nav-item" data-section="liposome" data-short="載藥" data-title="脂質體 DOX 載藥">`。
- 新 `<section class="section" id="section-liposome" aria-labelledby="liposome-title">`，h2 說明六步驟精簡版，三個 `.card` 面板加結果表。
- `<script>` 順序：`liposome-calculations.js` → `liposome-file-parsers.js` → `liposome-charts.js` 放在「共用工具與純計算模組（無 DOM 相依）」群組尾端，即 `dndc-charts.js` 之後；`section-liposome.js` 放在 `section-iucr.js` 之後；`app.js` 仍最後。`tests/structure.test.js` 只檢查引用完整、無重複、`app.js` 最後、`form-utils.js` 在 `app.js` 前；它**不會**檢查 `liposome-*.js` 在 `section-liposome.js` 之前，這個順序靠 `tests/load.js` 先 require 純模組來把關，實作時要人工核對 index.html 的順序。
- 樣式：優先重用；新規則（例如誤差拆解的小字列）加在 `css/sections.css`，不新增 css 檔。
- 版本字串改為 `Version 4.14`。

## 9. 測試與驗證

### 9.1 `tests/liposome.test.js`（node:test，公開）

- `tests/load.js` 加載 `liposome-calculations.js` 與 `liposome-file-parsers.js`，匯出 `Liposome`、`LiposomeParsers`。
- 稀釋因子，合成曲線 `I_sol(q) = 10·exp(−(q·30)²/3)`（Guinier 型）在 q = 0.005…0.3 步進 0.001，分兩個測試：
  - (a) **同格點**：bypass = 0.45 × I_sol，q 格點相同 → `factor`、`lsqScale` 都是 0.45 ± 1e-9，`sd` < 1e-9（內插退化為取值，驗公式本身）。
  - (b) **偏移格點**：bypass 的 q 格點偏移 +0.0003 → |`factor` − 0.45| < 1e-3、`sd` < 1e-3、|`lsqScale` − 0.45| < 1e-3（線性內插對高斯有二階誤差，審查者實跑得 factor 0.450243、sd 6.4e-5；這個測試才真的走到內插，**不要**為了逼近 1e-9 去改內插法）。
  - 視窗 0.1–0.15 只給 3 點 → throw。含負 I 的點被排除並計數。
- 光譜：波長格點 400–600 nm 步進 1 nm（494/495/496 都在格點上，讀值不經內插；另一組用 0.5 nm 步進驗證一次），blank = 2·exp(−λ/150)，pure = 高斯（中心 495、寬 25、峰 1.0），loaded = blank + 0.8·pure；`subtractSpectra` 回 0.8·pure（1e-9）；`fitPureDoxScale` 回 k = 0.8、rms < 1e-9；`absorbanceAt` 在 494/495/496 對高斯解析值 1e-6。
- D/L：第 4.7 節六列回歸；`factorSd > 0` 時 `dlSd ≥ dlSdExcel`；`A_primary ≤ 0` → throw；`lipidMolar = 0` → throw。
- 解析：PRIMUS 樣式標頭三行 + 空白分隔；逗號分隔；tab 分隔；波長遞減檔被反轉；只有文字的檔 → throw；重複 q → throw；`skipped` 計數正確。

### 9.2 `tests/liposome-local.test.js`（本地資料，公開 repo 可跑但會 skip）

讀 `tests/fixtures-local/liposome/{solution,bypass}.dat`（已由 Excel dilution 頁匯出，目錄已在 `.gitignore`）。檔案不存在 → `test.skip`。存在時斷言 `factor` 在 0.4386 ± 1%（2026-09-05 以 Python 預算：內插法得 0.4394，差 0.19%）。**不斷言 `lsqScale`**：PRIMUS 的 0.454 用表內資料重現不了（0.1–0.15、0.1–0.2、0.1–0.25 三個視窗、有無誤差權重，最小平方都落在 0.436–0.442），見 §11。

### 9.3 瀏覽器驗證（實作完成的驗收條件）

1. `node --test saxs-calculator/tests/*.test.js` 全綠（原 109 + 新增）。
2. Chrome 開 `index.html`：console 無錯誤；用本地 fixture 走完三個面板與結果表，數字對得上 Excel。
3. axe-core 該頁 0 違規；鍵盤可達所有輸入、按鈕、刪除列、確認 dialog。
4. 重新整理後結果表仍在；匯出的 CSV 在 Excel 打開中文不亂碼。
5. `science-reviewer` agent 審 `liposome-calculations.js`，重點：內插方向、比值定義（I_byp / I_sol，小於 1）、誤差傳遞、單位。
6. 版本號 v4.14 出現在頁面，push 後等 Pages 更新。

## 10. 科學決策紀錄

| 項目 | 決定 | 理由 |
|---|---|---|
| 稀釋因子主值 | 逐點比值平均（Excel） | Excel 是規格；最小平方縮放（PRIMUS）當副標，差 > 5% 提醒 |
| 配對方式 | 內插到 solution 的 q 格點 | Excel 逐列硬配對假設兩檔 q 格點相同，實際差約 2×10⁻⁴ Å⁻¹ |
| 濃度用的吸光度 | 只用 495 nm | 與 Excel J 欄一致；494/496 只進誤差 |
| D/L 誤差 | √(relA² + relF²) | 使用者決定納入因子離散；Excel 原式仍顯示供對照 |
| 手動因子 | relF = 0 | 沒有離散度資訊，不憑空捏造 |
| 脂質濃度單位 | 介面 mM，內部 M | Excel 用 M（0.0117），論文圖用 mM（5.84 mM） |
| ε、光徑 | 可編輯欄位，預設 9250 / 0.2 | 避免硬編碼；引用寫在欄位下方 |
| 純 DOX 檢查 | 只顯示 k 與殘差，不判定 | 濃度一致性是實驗判斷，網站不代替 |
| 工作表2 與 DL!D10 | 不使用 | 純 DOX 4.6 mM 全光譜與 A(495) = 7.254 在 Excel 公式裡沒有引用，且 7.25 已超出任何分光光度計線性範圍 |

## 11. 已知的 Excel 不一致（實作時以本規格為準）

- `DL!N1` 標題寫 q = 0.1–0.25，操作說明與 dilution 頁都是 0.1–0.15；採 0.1–0.15。
- dilution 頁算出 0.4386，DL 頁六列實填 0.417–0.556（來自 PRIMUS I Scale，各樣品不同）；網站兩個都算、主值取平均。
- 截圖裡 PRIMUS 對這組資料給 0.454，但用 dilution 頁的兩條曲線怎麼算最小平方都只有 0.436–0.442；`DL!N1` 寫的「I = 0.0997 at q = 0.1」也對不上（實際 I_sol ≈ 0.029、I_byp ≈ 0.012）。PRIMUS 的縮放範圍與權重未知，不列為驗證目標。
- q 視窗放寬到 0.1–0.25 時逐點比值的 SD 從 3% 暴增到 90%（高 q 進入雜訊），支持預設 0.1–0.15。
