# 待辦批次（v4.15）— 設計規格

- 日期：2026-10-14
- 狀態：所有需要使用者判斷的事項已確認（§2），待使用者審閱本規格 → 撰寫實作計畫
- 目標產品：`saxs-calculator/`（v4.14 → v4.15，push 上線）；`dndc calculator/`（本地 repo，只 commit 不 push）
- 與蘋果風改版的關係：本批次先上線。§3 的版本查詢是改版 v5.0 的前置條件；改版規格 §8.2 的標記 fixture 要在本批次上線之後才產生（本批次會新增 `lipoPureConc` 這個 id）。
- 研究依據：2026-10-14 三份唯讀研究（拆檔原型、fraction collector 的 Excel 公式鏈逐格重現、xfail 修法與下游影響）。研究的暫存腳本不會保留，關鍵事實都寫在本規格裡。

## 1. 範圍

**在範圍內**
1. 靜態資源版本查詢 `?v=`（§3）。
2. 拆開 `calculations.js`（1051 行）與 `dndc-calculations.js`（1137 行），純搬移；測試載入器改成與瀏覽器相同的共用全域作用域（§4）。
3. Fraction collector 的 Start／Stop Time 照 Excel 分段計算（§5）。這是本批次唯一的「現有數字算錯」項目，優先度最高。
4. 負峰與 FWHM：Python 與 JS 都保留峰高、峰面積的正負號；負 dn/dc 顯示警告；負 UV 峰拒絕；Python FWHM 不再重複扣基線（§6）。
5. 脂質體頁：稀釋因子加 SEM 對照；新增純 DOX 標準液濃度欄位，算出對照用的 [DOX]（§7）。

**不在範圍內**
- 脂質體 Excel 那三欄是 494/495/496 nm 還是 495 nm 三次重複：等使用者問資料提供者。
- Fraction collector 的收集體積（Excel `A30`）顯示；Excel 裡沒有接到任何地方的舊區塊（`工作表1_(2)!S7:Z18`，338 µL 延遲）。
- 稀釋因子的 σ(q) 加權。
- 2026-08 審查「剩餘」清單的其他項目（zip-bomb 串流檢查、`models.py` 的 ndarray 唯讀等）。
- 任何外觀改版（另見 `2026-10-14-apple-redesign-design.md`）。

## 2. 使用者定案（2026-10-14）

| 項目 | 定案 | 否決的選項 |
|---|---|---|
| 脂質體稀釋因子誤差 | 主值維持 SD；旁邊加 SEM 小字對照；不做 σ(q) 加權 | 改用 SEM；維持 SD 不加對照 |
| 純 DOX 標準液濃度 | 加欄位；k × c_pure 得到的 [DOX] 只當對照值，與主值差 > 10% 時提醒 | 可切換成主值；不加 |
| Fraction collector 算法 | 照 Excel 的近似（爬升段用該段平均流速把體積換成時間） | 精確積分 |
| Fraction collector 常數 | 先照 Excel：死體積 1050 µL、安全區 2.8 min、爬升 2 + 0.5 min、Time/Fraction = 1.2 ÷ 初始流速。使用者之後再確認，常數集中一處 | — |
| 報告結束時間取整 | 四捨五入，與 Excel `A15` 的畫面顯示一致（公式本身不取整，儲存格格式 `0` 顯示四捨五入） | 維持無條件進位 |
| 負 dn/dc | 照實顯示負值＋警告「dn/dc 為負：請檢查 RI 極性或峰／基線區間」 | 直接拒絕；顯示但不警告 |
| 負 UV 峰 | 拒絕，訊息「UV 峰為負：基線區間落在峰上或極性反轉，請檢查 UV 峰範圍與基線範圍」 | 取絕對值 |

## 3. 靜態資源版本查詢

**問題**：GitHub Pages 回應 `Cache-Control: max-age=600`。每次上線後約 10 分鐘內，使用者可能拿到新的 `index.html` 配舊的 CSS／JS。

**做法**
- `index.html` 引用的每個本地 `css/*.css`、`js/*.js` 都加上 `?v=<版本>`，例如 `js/app.js?v=4.15`。
- 版本的唯一來源是側欄 footer 的 `Version 4.15`。bump 版本時，footer 與所有 `?v=` 一起改。
- CDN 引用（已有確切版本與 SRI）與 Google Fonts 不加。

**測試**（`structure.test.js`）
- 解析 footer 的版本號，斷言每個本地 `<link>`／`<script>` 都帶 `?v=` 且值等於它；缺少或不一致就失敗。
- 現有所有以 `SCRIPT_REFS`（與 CSS 引用清單）比對路徑的測試，先去掉查詢字串再比對：「引用了每一個檔且不重複」「app.js 最後」「載入期取值的檔排在相依檔之後」「section-liposome.js 的順序」等。

## 4. 拆檔（純搬移）

### 4.1 測試載入器先改

`tests/load.js:13-23` 用 `require()` 載入每個檔，每個檔各有自己的 CommonJS 作用域，只能透過 `window.*` 互通。瀏覽器裡的 classic script 則共用同一個全域作用域。兩個大檔最後的匯出區塊（`calculations.js:1009-1051` 的 `window.SAXSCalculations = {…}`、`dndc-calculations.js:1108-1137` 的 `Object.freeze({…})`）在載入時直接讀頂層名稱；拆開後這些名稱分散在不同檔，`require()` 之下會 `ReferenceError`（原型實測：`calculateDetectorDistance is not defined`）。

- 改成逐檔 `vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file })`，與瀏覽器語意相同。
- `module.exports` 的鍵不變，各測試本文不改。
- 原型驗證：改載入器後拆檔，159 個既有測試加 1 個新順序測試全過。

### 4.2 分割方式

保留原檔名當「最後載入、負責匯出命名空間」的檔，`index.html` 與 `load.js` 既有的那一行都不用改。新檔沿用 `<領域>-calculations.js` 的命名。

| 檔案 | 內容（原始行號） | 約略行數 | 載入位置 |
|---|---|---|---|
| `sample-prep-calculations.js` | 離心 344–421；樣品與 SEC 423–541、994–1006 | 217 | `calculations.js` 之前 |
| `hplc-calculations.js` | HPLC-SAXS 步驟、fraction collector 543–875 | 338 | `calculations.js` 之前 |
| `detector-calculations.js` | 偵測器距離 878–991 | 119 | `calculations.js` 之前 |
| `calculations.js` | SAXS 理論 1–342；匯出區塊 1008–1051 | 387 | 上面三個之後 |
| `dndc-theory-calculations.js` | 理論、溫度／波長校正 10–206 | 202 | `dndc-calculations.js` 之前 |
| `dndc-signal-calculations.js` | 基線、峰 208–418；線性擬合 646–708 | 280 | `dndc-calculations.js` 之前 |
| `dndc-alignment-calculations.js` | 對齊 420–644，連同 `_resolveAlignment`（844–874） | 262 | `dndc-calculations.js` 之前 |
| `dndc-calculations.js` | 檔頭 1–8；計算主流程 710–843、875–1102；匯出區塊 | 406 | 上面三個之後 |

- 群組之間沒有循環相依。`_shiftSignal` 會呼叫 `shiftArray`（跨到 signal 檔），`_resolveAlignment` 會呼叫 `_alignmentInfo`／`_shiftSignal`；共用全域作用域後都能正常解析，函式本文不改。
- 驗收：把新舊檔的程式行排序後逐行比對，差異只有新檔頭註解。

### 4.3 連動修改

- `index.html`：三個 SAXS 分檔插在 `calculations.js` 之前，三個 dn/dc 分檔插在 `dndc-calculations.js` 之前；載入順序註解（約 2050–2054 行）加一條規則「負責匯出命名空間的檔排在它的分檔之後」。
- `tests/load.js`：依 `index.html` 的順序先載入分檔，再載入原檔。
- `tests/structure.test.js`：`PENDING_SPLIT` 清空成 `Object.freeze([])` 並更新註解；新增 `SPLIT_GROUPS` 順序測試，斷言每個分檔在 `index.html` 與 `load.js` 裡都排在對應的原檔之前。
- 兩個原檔的檔頭註解改寫，列出分檔。
- 瀏覽器開 `index.html`，console 不能有錯誤（CLAUDE.md 規定）。

## 5. Fraction collector

### 5.1 現況

`calculations.js:738-740`（拆檔後在 `hplc-calculations.js`）：

```js
fractionStartTime = M21 + 1050 / (target × 1000) − 2.8
fractionStopTime  = fractionStartTime + 2.8 + (M22 − M21) + 2.8
```

這只對應 Excel 的第一個分支，而且假設樣品尾端以目標流速走完整個死體積。只有初始流速等於目標流速時才正確。研究以 node 執行實際 JS 函式（峰中心 10.937、FWHM 1、注射 100 µL）與 Excel 公式鏈的逐格重現比對：

| 目標／初始 (mL/min) | Excel Start／Stop | 網頁 Start／Stop | 差（Start／Stop） |
|---|---|---|---|
| 0.35／0.35 | 10.28／19.72 | 10.28／19.72 | 0／0（Excel 唯一快取的例子） |
| 0.30／0.35 | 10.78／20.26 | 10.78／20.53 | 0／+0.27 |
| 0.20／0.35 | 12.53／21.79 | 12.53／23.35 | 0／**+1.56** |
| 0.15／0.35 | 14.10／23.10 | 14.28／26.17 | +0.18／**+3.07** |
| 0.10／0.35 | 16.99／25.48 | 17.78／31.81 | +0.79／**+6.33** |
| 0.05／0.35 | 24.35／32.14 | 28.28／48.75 | +3.93／+16.6 |
| 0.35／0.50 | 10.28／20.03 | 10.28／20.45 | 0／+0.42 |

網頁永遠偏晚，Stop Time 的誤差最大。舊筆記寫「低於 0.15 mL/min 才分段」不正確：預設輸入下 Start 從約 0.203 mL/min 以下才進入分段分支，Stop 則是每一種輸入都走分段邏輯。

### 5.2 Excel 公式鏈（工作表 `Fraction_collector_high_c`）

- 時間：`A4:A8` = `'HPLC flow down data'!B11:B15` = `工作表1_(2)!M20:M24`（即網頁的 `M20…M24`）。
- 流速：`B5 = B6 =` 目標；`B7 = (目標 + 初始)/2`；`B8 =` 初始。死體積 `D2 = 1050`（µL）；安全區 `C22 = 2.8`（min）。
- 各段體積（µL）：`D4 = (A6−A5)·B5·1000`（Q1）；`E4 = (A7−A6)·((B6+B7)/2)·1000`（Q2）；`F4 = (A8−A7)·((B7+B8)/2)·1000`（Q3）；`G4 = D4+E4`；`H4 = D4+E4+F4`。
- 起點 `B10 = IF(D4>=D2, E10, IF(AND(D2>D4, D2<=G4), E19, IF(AND(D2>G4, D2<=H4), E26, IF(D2>H4, E32))))`，其中
  - `E10 = D2/(B5·1000) + A5`
  - `E19 = (D2−D4)/((B6+B7)·500) + A6`
  - `E26 = (D2−G4)/((B7+B8)·500) + A7`
  - `E32 = (D2−H4)/(B8·1000) + A8`
- 終點 `B12`：10 路 IF，依 `B10` 落在哪個分支、再比較剩餘段體積，從 `M10…M32` 挑一個。例如 `M12 = A6 + (D4−N4)/((B6+B7)·500)`、`M16 = A8 + (D4−Q4)/(B8·1000)`、`M32 = E32 + D4/(B8·1000)`。物理意義：從 `A5` 起算的累積體積到達 `Q1 + 1050 µL` 的時刻（X 光收集窗尾端的樣品走完死體積）。
- 輸出：Start `A24 = B10 − C22`；Stop `A27 = B12 + C22`；Time/Fraction `'HPLC flow down data'!B24 = 1.2/B6`，該表的 `B6` 是初始流速，與網頁現行的 `1.2 / initialFlowRate` 一致，不改。

### 5.3 實作

- 新純函式（放在 `hplc-calculations.js`）：
  - `timeAtCumulativeVolume(volumeUl, segments)`：依序走過四段，每段用 Excel 的換算流速（第 1 段目標、第 2 段 `(目標+中值)/2`、第 3 段 `(中值+初始)/2`、第 4 段之後初始），回傳累積體積到達 `volumeUl` 的時刻。
  - `fractionCollectorWindow({ times, targetFlowRate, initialFlowRate })` → `{ startTime, stopTime }`。`times` 是 `[A5, A6, A7, A8]`（即 `M21…M24`；`A4`／`M20` 不參與計算）。`startTime = timeAtCumulativeVolume(1050) − 2.8`；`stopTime = timeAtCumulativeVolume(Q1 + 1050) + 2.8`。
  - 這個統一寫法等價於 Excel 的 `B10` 與 `B12` 兩串 IF（用累積體積判斷所在段，而不是 Excel 用數值相等挑分支），也就避開了 Excel 裡「依值相等挑分支」與永遠走不到的 `M10` 這兩個脆弱處。等價性由 §5.4 的格點測試保證。
- `calculateHPLCSAXSSettings` 改呼叫上述函式；輸出物件的欄位、`toFixed(2)` 取位、`timePerFraction` 都不變。
- 報告結束時間改成 `reportStoptime = Math.round(Stop + 1 + 3)`，`Stop` 用取位前的值（Excel `A15 = B22+1+3`，`B22` 是未取位的 Stop）。原本的 `Math.ceil` 與 Excel 畫面在多數流速下差 1 分鐘。Excel 裡沒有任何儲存格引用 `A15`；它的整數是儲存格格式 `[$-404]0`（四捨五入顯示）造成的，程式註解要寫明這點。
- 常數集中成一個凍結物件（死體積 1050 µL、安全區 2.8 min、爬升 2 min 與 0.5 min、每管 1.2），註解寫明「2026-10-14 決定先照 Excel，待使用者確認」。既有匯出 `SAXS.DEAD_VOLUME_UL`、`SAXS.SAFE_ZONE_MIN` 保留，數值不變。
- 程式註解註明 Excel 的近似：爬升段用該段平均流速把體積換成時間，體積正確、時間是近似（目標 0.10、初始 0.35 時，與線性爬升精確積分差約 0.16 min）。
- `section-hplc.js` 只顯示數值，不需要改。

### 5.4 測試（新檔 `tests/fraction-collector.test.js`）

- **Excel 逐格轉寫當標準答案**：在測試裡逐字轉寫 Excel 的 `B10`、`B12` 兩串 IF 與所有輔助儲存格（`D4…Q4`、`E10…E32`、`M10…M32`），當作 oracle。
- **格點比對**：目標 ∈ {0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.50}、初始 ∈ {0.20, 0.35, 0.50}、注射體積 ∈ {10, 50, 100} µL（校正範圍是 3–100 µL，超出會丟錯，見既有測試 [47]），峰中心 10.937、FWHM 1。新函式在取位前與 oracle 差 < 1e-9（審查以 48 個範圍內格點試算，差 < 4e-15）。若某個格點不一致（例如 Excel 的相等判斷在邊界挑了不同分支），停下來回報，不自行決定。
- **Excel 快取值**：0.35／0.35 → 10.28／19.72（沿用既有斷言）。
- **§5.1 表格各列**當回歸值，連同報告結束時間：0.35／0.35 → 24、0.30／0.35 → 24、0.20／0.35 → 26、0.15／0.35 → 27、0.10／0.35 → 29、0.05／0.35 → 36、0.35／0.50 → 24。
- `batch1.test.js:256-261` 的測試 [46] 用的是網頁舊公式（Stop − Start = 2.8 + 收集時間 + 2.8），不是 Excel 的值。改成斷言 0.20／0.35 的 Excel 值 12.53／21.79。這個期望值改變是因為舊期望值本身由錯誤公式推得；commit 訊息要寫明理由與 Excel 出處。（CLAUDE.md「不要改期望值」指的是 Python 以 xfail 鎖定的已知 bug，不適用這裡。）

## 6. 負峰與 FWHM

### 6.1 峰高、峰面積保留正負號

- Python `src/dndc/peak.py:43-44`：
  - 峰高 = 峰區內絕對值最大那一點的**原值**：`float(sig_in_peak[int(np.argmax(np.abs(sig_in_peak)))])`。
  - 峰面積 = `float(np.trapezoid(sig_in_peak, time_in_peak))`，不取絕對值。
- JS `dndc-calculations.js:398,405`（拆檔後在 `dndc-signal-calculations.js`）：
  - 峰高改成 `sig.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0)`。
  - 刪除 `peakArea = Math.abs(peakArea)`。
- 修正後新值恆為 ±舊值，只有符號可能改變。研究已確認：正峰在乾淨、5% 雜訊、20% 雜訊下，height、area、SPI 三種模式的結果逐位元相同；SPI 本來就保留符號，這次是讓 height 與 area 跟它一致。

### 6.2 負 dn/dc 警告

- 共用判斷：最終 dn/dc < 0 時附上警告「dn/dc 為負：請檢查 RI 極性或峰／基線區間」。
- **HPLC 單次（height／area／SPI）**
  - Python：`CalculationResult`（`models.py:76`）新增 `warnings: tuple[str, ...] = ()`，由 `compute_hplc_dndc` 填入。
  - JS：`computeHplcDndc` 的回傳值加 `warnings: []`。
- **Slice**（最終回報的 dn/dc）
  - Python：`SliceResult`（`calculator.py:392`，不在 `models.py`）新增同樣的 `warnings` 欄位，由 `compute_slice_dndc` 填入。
  - JS：`computeSliceDndc` 的回傳值加 `warnings: []`。
- **手動多注射擬合**（只有 JS；Python 沒有手動多注射路徑）：在 `dndc-multi-ui.js` 的 `displayMultiFitResults` 裡檢查斜率 < 0。不改通用的 `linearFit`，因為 Slice 與 ASTRA 也用它。
- **不在範圍內**：ASTRA 單次（`AstraSingleResult`，`astra.py:46`，取 `abs(area)` 並設 `is_negative_peak`）與 ASTRA 多注射（`AstraMultiResult`，`astra.py:59`；`dndc-astra-ui.js`）維持各自現有的慣例。
- 顯示：
  - Streamlit 頁面（`web/pages/hplc_page.py`、slice 頁）用 `st.warning`；CLI（`__main__.py`）印出。CSV 不加欄位。
  - JS 的 HPLC 與 Slice 畫面已有 UI 層的 `warnings` 陣列交給 `renderWarningsHtml`（`dndc-hplc-results.js:75-93`、`dndc-slice-ui.js:53-76`）。把 `result.warnings` 併進那個陣列，不另外加一個提示框。手動多注射用同樣的 `alert-warning` 樣式。文字與 Python 相同。

### 6.3 負 UV 峰拒絕

- 用 UV 算濃度時（不是手動輸入濃度），UV 峰的值 < 0 就丟出錯誤：「UV 峰為負：基線區間落在峰上或極性反轉，請檢查 UV 峰範圍與基線範圍」。
- Python 在 `_compute_concentration`（`calculator.py` 約 266–276 行）；JS 在對應的濃度計算處（約 958 行）。檢查要排在現有的「無法求得有效濃度」檢查之前，使用者才不會看到講錯原因的訊息。
- 只適用 HPLC 單次。Slice 不套用：邊緣 slice 的 UV 本來就可能因雜訊略低於 0，逐片拒絕會讓整次計算失敗。

### 6.4 RI 因子負值

- Python `validation.py:97-99` 目前只擋 0，負的 `ri_factor` 會悄悄翻轉 dn/dc 的符號。改成擋 ≤ 0，與 JS（`dndc-calculations.js:777` 的 `_assertOpticalParams`）一致。
- `validate_params` 只在 Streamlit HPLC 頁執行（`hplc_page.py:404`）；CLI（`__main__.py:83`）與直接呼叫 `compute_*` 都不經過它。所以 `compute_hplc_dndc` 與 `compute_slice_dndc` 內部也要加同樣的 ≤ 0 檢查，比照 JS 在計算函式裡把關。

### 6.5 FWHM 不再重複扣基線（只有 Python）

- `src/dndc/broadening.py:70-72` 的 `_measure_fwhm`：輸入已是基線校正後的訊號（基線為 0），不再減峰區最小值。改成依「絕對值最大點」的符號決定峰方向：

  ```python
  apex = float(signal[int(np.argmax(np.abs(signal)))])
  s = signal if apex >= 0 else -signal
  ```

- 只被 `estimate_sigma`（`broadening.py:39-40`）呼叫，進而只影響 `compute_slice_dndc`（`calculator.py:503-505`）在開啟展寬校正、σ 設為自動時的估計值。研究實測（UV σ=0.3，真實 σ_b=0.15）：±2σ 峰區從 0.095 變 0.1487，±4σ 以上不變；負 RI 峰從原本的 0（展寬校正被靜默跳過）變成正常估計。
- 不另做「用峰區兩端重新歸零」：殘留基線偏移 +2% 時估計值 0.160（真值 0.149），在可接受範圍；輸入契約本來就是已校正訊號。
- JS 沒有對應程式（網頁版沒有展寬校正）。

### 6.6 測試與文件

- 三個 xfail 測試拿掉 `@pytest.mark.xfail` 與 `@pytest.mark.bug` 標記（比照 `895c18a` 修 wiener 時的做法），期望值不改。預期 329 passed／0 xfailed，加上新測試。
- `test_calculator.py:604` 的斷言收緊成 `dn_dc ≈ −0.185`，並斷言 `warnings` 含負 dn/dc 警告。
- 新增：負 UV 峰丟出 §6.3 的訊息（Python、JS）；負 `ri_factor` 被擋（Python）；JS 峰高／面積保留符號、負 dn/dc 警告。
- 更新過時的說明：`test_broadening.py` 模組 docstring 第 13–15 行（描述早已修好的 wiener xfail）、xfail 理由裡過時的 `calculator.py:381-383`、`test_peak.py:14`、`test_calculator.py:575-579`、`test_measure_fwhm_returns_none_for_flat_signal` 的 docstring（現在是因為沒有半高交叉點才回 None）。
- 刪除 `calculator.py:29` 沒被用到的 `detect_peak_direction` import。
- dndc repo 的 `src/` 是 CRLF 換行，編輯後要維持 CRLF。

## 7. 脂質體頁

### 7.1 稀釋因子的 SEM 對照

- 只加在**面板 1** 的「相對離散」小字旁（`section-liposome.js:164-165`），加一行 `SEM x.xx%（n = N）`，其中 SEM = SD ÷ √n，n 是 q 視窗內實際用到的點數。面板 1 只有用 SAXS 檔算出稀釋因子時才會顯示，所以手動輸入因子的情況自然不會出現。
- 面板 3 的因子回顯（`:140`，「± sd（n = N）」）與 D/L 的「稀釋因子離散貢獻 relF」（`:372`）不變。
- D/L 誤差仍用 SD（`√(relA² + relF²)` 不變）。結果表與 CSV 不加欄位。
- 規格 `2026-09-05-liposome-dox-loading-design.md` §10 的決策表補一列：「稀釋因子誤差：主值 SD；SEM 只當對照（2026-10-14 使用者定案）。理由：相鄰 q 點的雜訊通常相關，比值也可能隨 q 漂移，兩者都會讓 SEM 低估」。

### 7.2 純 DOX 標準液濃度 → 對照 [DOX]

- 面板 2 在「純 DOX 光譜」檔案欄位旁新增選填欄位 `lipoPureConc`（標籤「純 DOX 標準液濃度」，單位 mM，`min` > 0）。
- 欄位說明：「標準液與樣品須用同一光徑，且在線性範圍內量測（建議 A < 1.5）。Excel 工作表2 的 4.6 mM 光譜 A(495) = 7.25，已飽和，不能用。」
- 有純 DOX 光譜、縮放擬合得到 k（`fitPureDoxScale`）、且欄位有值時，算出 `[DOX]_std = k × c_pure`。
- 基準一致：`computeDrugToLipid` 的 [DOX] = A(主波長) ÷ (ε·l)，取自扣背景後的比色槽光譜、不含稀釋修正；k × c_pure 在光徑相同時是同一個基準（審查已核對）。
- 單位：主值 `doxConc` 內部是 M（畫面 ×1000 顯示 mM，`section-liposome.js:378`）；`lipoPureConc` 輸入是 mM，計算前換成 M，顯示時兩者都用 mM。
- 在面板 3 的 [DOX] 結果旁顯示「標準液法對照：x.xxx mM（差 ±y%）」。|差| > 10% 時加 `alert-warning`：「標準液法與 ε 法的 [DOX] 相差超過 10%，請檢查 ε、光徑或標準液濃度」。
- 不顯示對照值的情況：k < 0（沿用 Task 11b 的 k < 0 警告）；吸光度是手動輸入的（`absSource === 'manual'`，此時 k 與 ε 法的吸光度不是來自同一條光譜）。
- `lipoPureConc` **不加入** `INVALIDATING_IDS`（`section-liposome.js:30-33`）：它不影響 D/L，不該因此停用「加入結果表」。改這個欄位時即時重算對照值。
- D/L 主值、結果表、CSV 都不變。
- 規格 §10 補一列記錄這個決定。

### 7.3 測試

- `tests/liposome.test.js`：SEM 計算（含 n）；`[DOX]_std` 計算與 mM／M 換算；差 > 10% 的判斷；沒有濃度、沒有純 DOX 檔、k < 0、吸光度手動輸入時都不產生對照值。
- `tests/liposome-section.test.js`（stub DOM）：欄位存在；SEM 小字只出現在面板 1；對照值的顯示與隱藏；改 `lipoPureConc` 不會停用「加入結果表」（`INVALIDATING_IDS` 維持現有十個欄位）。

## 8. 上線

### 8.1 Commit 順序（saxs-calculator）

1. `?v=` 版本查詢與 structure 測試（§3）。
2. 測試載入器改 `vm.runInThisContext`（§4.1），單獨一個 commit，測試數不變、全過。
3. 拆檔純搬移（§4.2–4.3），單獨一個 commit，方便以排序比對驗證。
4. Fraction collector 修正（§5）。
5. 負峰 JS 修正與警告（§6.1–6.3 的 JS 部分）。
6. 脂質體 SEM 與標準液對照（§7）。
7. bump 版本到 v4.15（footer 與所有 `?v=`），push，等 Pages 出現 `Version 4.15`。

dndc repo：§6 的 Python 部分一個 commit（本地，不 push）。

### 8.2 審查

- `science-reviewer`：§5（對照 Excel 公式鏈）、§6（符號與警告）、§7.2（[DOX] 對照的基準）。
- `code-reviewer`：全部 diff。
- 每個 Critical／Important 都修完才進下一步。

### 8.3 驗證

- `node --test saxs-calculator/tests/*.test.js` 全過（159 個既有加新測試）。
- `cd "dndc calculator" && .venv_mac/bin/python -m pytest -q`：329 passed／0 xfailed 加新測試；同時更新 CLAUDE.md 裡的 pytest 基準數字。
- 瀏覽器：`index.html` 無 console 錯誤；HPLC 頁輸入目標 0.20、初始 0.35 時顯示 12.53／21.79，報告結束時間 26；脂質體頁用合成資料看到 SEM 小字與對照值；dn/dc 各頁正常資料的數字與修改前相同。
- 更新記憶：`review_findings_2026_08_21.md` 剩餘清單（拆檔完成、fraction collector 完成、xfail 清零、「0.15 mL/min」的錯誤說法改正）。

## 9. 開放事項

- Fraction collector 常數（死體積 1050 µL、爬升 2 + 0.5 min、每管 1.2）：使用者之後確認是否符合目前硬體與方法。
- 脂質體 Excel 三欄波長：等資料提供者回覆。
