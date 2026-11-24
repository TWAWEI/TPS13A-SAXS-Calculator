# SAS 模型擬合頁（A 版）— 設計規格

- 日期：2026-11-17
- 狀態：v3——設計已與使用者逐段確認（共 5 段）；規格審查 3 輪（第 1 輪 6 項、第 2 輪 2 項問題已修正，第 3 輪核准）；使用者另就 4 項科學判斷作出決定（§15 #13–#16）。M1、M2 已實作；M2 審查（2026-11-18）後修訂 §3.2、§3.3、§4.8–§4.10、§11、§12、§16 並新增 §5.7
- 目標產品：`saxs-calculator/`（GitHub Pages 單頁站），新版本 v5.3
- 計算核心來源：SasView **sasmodels 1.0.12**（BSD-3-Clause）；擬合器與誤差對照 **bumps 1.0.4**
- 參考：中央大學磁性與能源材料實驗室的「SAS Studio」（Google Sites 內嵌單檔 HTML，sasmodels 手工移植成 JS）。只參考功能與版面，**不複製其程式碼**——該站「版權所有」且未附授權。

## 1. 目標與範圍

在網站新增「SAS 模型擬合」分頁，讓 TPS13A 使用者在瀏覽器裡對一維 SAXS 曲線做 form factor／structure factor 模型擬合，不必安裝 SasView。全部計算在使用者的瀏覽器內完成（無後端），資料不離開使用者電腦。

分兩階段：**A 版＝光束線現場快速判斷**（本規格），架構預留 **B 版＝正式分析**（見 §16）。

**在範圍內（A 版）**
1. 讀官方 TPS13A `.dat`（含檔頭）與一般 2–4 欄文字檔；可一次載入多個。
2. 15 個模型（§4.1）：形狀 8＋與形狀無關 5＋結構因子 2；多分散度（寬度可擬合）；低 Q 冪律附加項。
3. 單組資料 Levenberg–Marquardt 擬合，含參數誤差、χ²ᵣ、殘差。
4. 主圖四種模式：log-log、Guinier（ln I vs q²）、Kratky（q²I vs q）、Porod（I·q⁴ vs q，v5.7）；殘差圖。
5. 多組資料疊圖（可錯開）。
6. 序列擬合與參數趨勢圖。
7. 3D 結構示意圖（8 個形狀模型）。
8. 擬合結果送進 IUCr 表格頁（新增「Model fitting」段落）。
9. 匯出：擬合曲線 CSV、報告 TXT、序列結果 CSV、PNG。

**不在範圍內（A 版）**
- data reduction（2D Eiger h5 → 1D），另案；
- 解析度修正（ΔQ/Q smearing）——官方 `.dat` 預設不輸出 dQ；
- LM 以外的擬合演算法；多組資料共用參數的聯合擬合；
- 異常散射修正 f′／f″、中子、磁性、二維（取向）資料；
- 專案存檔／讀檔；資料持久化（重新整理即清除，與其他分頁一致）；
- 以 `file://` 直接開啟（wasm 與 Worker 會被瀏覽器擋；使用者確認不會這樣開）。

## 2. 使用者流程

側欄「分析工具」群組在「SAXS 結構參數」之後新增「SAS 模型擬合」（`data-section="sasfit"`，收合短標「擬合」）。頁面為兩欄工作區：左欄操作（四個分段：資料／模型／擬合／序列），右欄圖區（捲動時固定）。

1. **資料**：拖放或選取 `.dat`（可多選）→ 清單出現各檔，第一個成為「作用中」。
2. **模型**：搜尋或依類別選模型 → 參數表出現預設值 → 改參數時右側曲線約 150 ms 內即時更新（預覽）。可加 S(Q)、低 Q 冪律、各尺寸參數的多分散度。
3. **擬合**：確認 Q 範圍（預設已避開 beamstop）、權重 → 按「開始擬合」→ 看到逐步 χ²ᵣ 進度、結果磚、殘差；可「停止」。成功後可「送進 IUCr 表格」與匯出。
4. **序列**：在清單勾選資料、填條件值 → 「執行序列擬合」→ 結果表＋趨勢圖；點列可回到該組資料檢視。

## 3. 架構

### 3.1 資料流

```
.dat ─▶ data-io ─▶ Dataset（凍結物件）─┐
                                     ├─▶ Web Worker（wasm＋kernel＋fitter）─▶ FitResult ─▶ 圖／3D／匯出／IUCr
模型＋參數（UI 狀態）──────────────────┘
```

狀態一律以新物件取代舊物件（不就地修改）。主執行緒**不執行**模型計算（純計算模組在主執行緒也會被載入，但只在 Worker 內被呼叫，見 §3.3）。

### 3.2 檔案

比照現有 `dndc-*.js` 的慣例，全部平放在 `js/` 第一層、以 `sasfit-` 為前綴，讓既有守門測試（顏色字面值、token、escapeHtml 唯一實作、行內事件、`node --check`、800 行上限、頂層識別字衝突）自動涵蓋新程式。

| 檔案 | 職責 | 依賴 |
|---|---|---|
| `wasm/sas-<model>.wasm` | sasmodels 生成碼經 F64 前處理後編譯；每模型一檔，進入本頁才載入 | — |
| `wasm/manifest.json` | 各 wasm 的 SHA-256、sasmodels 版本、emscripten 版本、編譯旗標 | — |
| `wasm/LICENSE-sasmodels.txt` | sasmodels 授權全文 | — |
| `js/sasfit-meta.js` | 15 個模型的參數表（名稱、單位、上下限、預設、類別、可否多分散、`have_Fq`、有效半徑模式、說明）。**腳本產生，勿手改**；精簡格式（每個參數一行），受 800 行上限約束——B 版擴充時改為每模型一檔 | — |
| `js/sasfit-validate.js` | 計算模組共用的輸入檢查：own-property 判斷、數值／`cutoff`／`q` 檢查、未知參數回報，以及點數上限常數 `MAX_PD_POINTS`、`MAX_EVAL_POINTS`、`MAX_Q_POINTS`（§12）。原創程式，非 sasmodels 衍生（M1 審查後新增） | — |
| `js/sasfit-weights.js` | 六種分布的取點與權重（移植 `weights.py`） | validate |
| `js/sasfit-kernel.js` | 調度層：組 details／values、分段呼叫 wasm、讀回 F1／F2 與附加量（移植 `details.py`、`kerneldll.py`、`kernel.py` 的 1D 路徑） | validate、weights、meta |
| `js/sasfit-product.js` | P@S 組合、β 近似、有效半徑（移植 `product.py`） | validate、kernel |
| `js/sasfit-py-models.js` | Python 核心模型的手寫 JS：`guinier_porod`、`power_law` | validate、meta |
| `js/sasfit-evaluate.js` | 單一入口 `evaluate(modelSpec, params, q, opts, kernels)`：組合 P、S、低 Q 冪律；`opts.cutoff` 預設 1e-5；`q` 必須是 `Float64Array`；第五個參數 `kernels`＝`{ 模型名: wasm exports }`，由呼叫端載入後注入（Node 可測） | validate、kernel、product、py-models |
| `js/sasfit-weighting.js` | 權重 w_i、可參與擬合遮罩、`defaultRange(dataset, weighting)`（§4.8；純函式，主執行緒與 Worker 共用） | — |
| `js/sasfit-data-io.js` | 解析 `.dat`／文字檔、檔頭欄位、格式錯誤回報、條件值擷取 | — |
| `js/sasfit-sld.js` | 化學式解析、X 光 SLD、預設物質表 | — |
| `js/sasfit-linalg.js` | 擬合器用的稠密線性代數：one-sided Jacobi SVD 與 bumps 式共變異（M2 自 fitter 拆出；原創程式） | — |
| `js/sasfit-fitter.js` | LM（可抽換介面）、數值 Jacobian、上下限、誤差 | linalg |
| `js/sasfit-worker-core.js` | Worker 訊息處理的純邏輯（wasm 載入器以參數注入，Node 可測） | evaluate、fitter |
| `js/sasfit-worker.js` | **Worker 入口**：`importScripts` 載入純模組、接上 `self.onmessage`。唯一不在 `index.html` 載入的 JS | worker-core |
| `js/sasfit-worker-client.js` | 主執行緒端：Worker 生命週期、latest-wins、停止＝terminate（下一個請求時才重建）、版本號 | worker-core（`settingsOf`） |
| `js/sasfit-form.js`、`sasfit-state.js`、`sasfit-format.js`、`sasfit-labels.js`、`sasfit-jobs.js`、`sasfit-hints.js`、`sasfit-html.js`、`sasfit-plot-data.js` | M3 的純模組：參數表單、頁面狀態（M4 加 `seq` 與第四個分段；M4 的 `plotView` 在 v5.8 移除）、數字格式、標籤、Worker 工作的組裝、提示、HTML 字串、圖的資料 | — |
| `js/sasfit-plots.js` | 主圖、殘差、疊圖；M4 加趨勢圖（`renderTrend(config)`，圖的實例由它擁有） | plot-data |
| `js/sasfit-shape-geom.js` | 7 個形狀模型的網格（面帶 `part` 標記）、固定種子的亂數、蠕蟲鏈中心線（M4；純） | — |
| `js/sasfit-shape-view.js` | 視角 reducer、正交投影、繪製順序（含顆粒群）、Lambert 亮度、比例尺、nm 標註與文字描述（M4、v5.8；純） | shape-geom |
| `js/sasfit-sq-derived.js` | 結構因子示意要的有效半徑（含多分散平均）與 hayter_msa 的 Debye 長度，移植自 sasmodels（v5.8；純） | weights、jobs |
| `js/sasfit-shape-ensemble.js` | 選了 S(Q) 時的顆粒群：排列、按比例的箱子、面數預算、取向、場景與說明文字（v5.8；純） | shape-geom、shape-view、sq-derived |
| `js/sasfit-shape3d.js` | Canvas 繪製、拖曳／鍵盤／縮放、自動旋轉、PNG 用的淺色重繪、只在舞台進入視窗時重畫（M4、v5.8；頂層不碰 DOM） | shape-view、shape-ensemble |
| `js/sasfit-sequence.js` | 序列擬合的排程、每檔範圍、起始值規則、執行器（client 由呼叫端注入；M4；純） | jobs、weighting、hints |
| `js/sasfit-seq-view.js` | 序列表（選檔＋結果）的列與 HTML、趨勢圖的資料與 config（M4；純） | sequence、format |
| `js/sasfit-export.js` | 匯出共用工具：`num`、CSV 儲存格、註解列、檔名、data URL → 位元組、軟體字串、由 FitResult 取參數列、擬合曲線 CSV（M4；純） | — |
| `js/sasfit-sasview.js` | 擬合結果 → SasView「Paste Params」參數文字、可否表示的判斷、每筆擬合的注意事項（v5.7；純） | export、form |
| `js/sasfit-report.js` | 報告 TXT、序列結果 CSV（M4；純） | export、seq-view、sasview |
| `js/sasfit-iucr.js` | `AppState.sasfitData` 物件、可否送出的判斷、「Model fitting」列的 HTML（M4；純） | export |
| `js/sasfit-data-ui.js`、`sasfit-params-ui.js`、`sasfit-fit-ui.js` | M3 的三個分段（DOM） | 以上 |
| `js/sasfit-seq-ui.js` | 序列分段：選項、執行／停止、表格、趨勢圖、點列載入（M4；DOM） | sequence、seq-view |
| `js/sasfit-export-ui.js` | 匯出、「送進 IUCr 表格」與「複製 SasView 參數」按鈕、下載、剪貼簿、各圖 PNG（M4、v5.7；DOM） | export、report、iucr、sasview |
| `js/section-sasfit.js` | 分頁 UI 串接（四個分段的註冊、`ctx`） | 以上全部 |
| `js/section-iucr.js` | IUCr 頁（既有）；M4 加 `setIUCrModelFit`、`renderIUCrModelFit`、`iucrCopySource`、`iucrExecCopy` | iucr |
| `css/sasfit-views.css` | M4 的樣式：圖卡標題列、3D 結構示意卡（v5.8）、序列分段、匯出列、IUCr 擬合段（`sasfit.css` 已近行數上限） | — |

- `wasm/` 放在 `saxs-calculator/` 底下（部署 workflow 只上傳 `./saxs-calculator`）。
- 開發用 `tools/sasfit/` 放在 **repo 根目錄**，不會被部署。
- 參考值 fixtures 放 `saxs-calculator/tests/fixtures/sasfit/`（與現有 fixtures 相同位置），以精簡 JSON 儲存。

### 3.3 載入策略、模組慣例與守門測試

**模組慣例**：每個 `sasfit-*.js` 以 IIFE 包住，只透過 `globalThis.SasFitXxx = Object.freeze({...})` 匯出一個凍結物件（例：`SasFitKernel`、`SasFitFitter`）。用 `globalThis` 而非 `window`——Worker 內沒有 `window`。純計算模組（meta、validate、weights、kernel、product、py-models、evaluate、weighting、data-io、sld、linalg、fitter、worker-core，以及 sequence、export 的純函式部分）頂層不得觸碰 `window`、`document`、`Chart`。M4 的 shape-geom、shape-view、sequence、seq-view、export、report、iucr 同屬純模組（`tests/load.js` 的 `LOAD_ORDER` 內）；shape3d 頂層不碰 DOM、也在 `LOAD_ORDER` 內；seq-ui、export-ui 是 DOM 模組。**沒有任何 M4 模組在 Worker 內載入。**

**主執行緒**：`index.html` 以 `<script>` 載入除 `sasfit-worker.js` 以外的全部 `sasfit-*.js`，順序：meta → validate → weights → kernel → product → py-models → evaluate → weighting → data-io → sld → linalg → fitter → worker-core → worker-client → form → state → format → labels → jobs → hints → html → plot-data → plots → shape-geom → shape-view → shape3d → sequence → seq-view → export → report → iucr → data-ui → params-ui → fit-ui → seq-ui → export-ui → section-sasfit，置於 `app.js` 之前（M4 完成後的實際順序）。

**Worker**：`sasfit-worker.js` 以 `importScripts` 載入 meta → validate → weights → kernel → product → py-models → evaluate → weighting → linalg → fitter → worker-core（與 `index.html` 相對順序一致）。linalg 必須排在 fitter 之前：fitter 在載入時就讀 `globalThis.SasFitLinalg`。validate 必須排在 weights 之前：kernel、product、py-models、evaluate 在載入時就讀 `globalThis.SasFitValidate`（weights 在呼叫時讀）。Worker 依 `fit` 訊息中的權重選項，自行用 weighting 模組算 w_i 與遮罩。

**版本（快取）策略**：唯一來源是 `index.html` 的 `?v=`。`sasfit-worker-client.js` 在載入時讀 `document.currentScript.src` 的 `v` 參數；建立 Worker 時用 `js/sasfit-worker.js?v=<v>`；Worker 內讀 `self.location.search` 的 `v`，附加到每個 `importScripts` 與 wasm `fetch` 網址。程式中不得寫死版本字串。

**守門測試的變更（僅限以下）**：
1. `tests/structure.test.js`：新增常數 `WORKER_ONLY = ['sasfit-worker.js']`，從「index.html 引用每一個 js」的要求中排除；新增測試：`sasfit-worker.js` 的 `importScripts` 清單等於上述純模組清單、每檔存在、相對順序與 `index.html` 一致；新增測試：worker-client 與 worker 透過上述機制取得版本（不含寫死的 `?v=` 數字）。
2. `tests/markup.test.js`：改用「區段規則」。`index.html` 中本功能新增的標記一律包在成對註解 `<!-- sasfit:begin -->`、`<!-- sasfit:end -->` 之間，共 3 段：側欄導覽按鈕（`data-section="sasfit"`）、`<section id="section-sasfit">` 整段、IUCr 頁的「Model fitting」段落。比對 v4.15 fixture 前先在**原始 HTML 上**移除這 3 段，之後才呼叫 `markupCounts`（它會先剝掉 HTML 註解，順序反過來會找不到標記），其餘必須與 fixture 完全相同（原有的主題切換白名單與分子量改名規則不變）。另加測試：成對標記恰好 3 組且不巢狀；區段內的 id 不重複，也不與區段外的 id 衝突。區段內照站內慣例自由使用 `aria-label`、`aria-live`、`aria-expanded` 等屬性。**`fixtures/markup-v4.15.json` 不得重產**。
3. `tests/load.js` 的 `LOAD_ORDER` 加入純計算模組（順序同 `index.html`，含 weighting）。
4. 其他守門（style-scan、batch3、`node --check`、行數、頂層識別字）因檔案平放於 `js/`，不需修改即自動涵蓋。

## 4. 計算規格

### 4.1 模型清單（sasmodels 1.0.12 實查）

| 模型 | 類別 | 核心 | 官方測試數 | `have_Fq` | 可多分散參數（1D） | 可接 S(Q) |
|---|---|---|---|---|---|---|
| sphere | shape:sphere | C | 14 | ✓ | radius | ✓ |
| core_shell_sphere | shape:sphere | C | 2 | ✓ | radius, thickness | ✓ |
| vesicle | shape:sphere | C | 4 | ✓ | radius, thickness | ✓ |
| ellipsoid | shape:ellipsoid | C | 6 | ✓ | radius_polar, radius_equatorial | ✓ |
| cylinder | shape:cylinder | C | 18 | ✓ | radius, length | ✓ |
| core_shell_cylinder | shape:cylinder | C | 2 | ✓ | radius, thickness, length | ✓ |
| flexible_cylinder | shape:cylinder | C | 4 | ✗ | length, kuhn_length, radius | ✗ |
| lamellar | shape:lamellae | C | 1 | ✗ | thickness | ✗ |
| guinier | shape-independent | C | 1 | ✗ | — | ✗ |
| guinier_porod | shape-independent | **Python** | 1 | ✗ | — | ✗ |
| power_law | shape-independent | **Python** | 1 | ✗ | — | ✗ |
| mono_gauss_coil | shape-independent | C | 1 | ✗ | rg | ✗ |
| gaussian_peak | shape-independent | C | **0** | ✗ | — | ✗ |
| hardsphere | structure-factor | C | 1 | — | — | — |
| hayter_msa | structure-factor | C | 2 | — | —（A 版不開放 S 參數多分散） | — |

- 取向參數 theta／phi 只用於二維資料，1D 介面不顯示（與 SasView 1D 相同）。
- 產生的 `sasfit-meta.js` 完全照 sasmodels 的 `pd_1d`，因此 `hayter_msa.radius_effective` 標為可多分散（`pd: true`），計算核心也接受它的 `radius_effective_pd*`（`radius_effective_mode` 為 0 時由 S 平均，其他模式下被忽略，與 sasmodels 相同）。A 版介面不開放這個選項——上表該格寫的是介面，不是 meta。
- 「可接 S(Q)」限 6 個同時具備 `have_Fq` 與有效半徑模式的形狀模型；其餘模型的 S(Q) 選單停用並說明原因。

### 4.2 強度定義與 kernel 介面

與 sasmodels `kernel.py` 一致（P 單獨使用時）：

  I(q) = scale / ⟨V_shell⟩ · ⟨F²⟩(q) + background

其中 ⟨·⟩ 為多分散度權重平均，實心物體 V_shell = V_form。A 版一律走 Fq 路徑取得 ⟨F²⟩（`have_Fq` 模型另得 ⟨F⟩ 供 β 近似）。

wasm 匯出的 1D 入口為 sasmodels 生成碼的 `<model>_Iq`，參數順序（`kerneldll.py:369-372、455-465` 實查）：

```
(int32 nq, int32 pd_start, int32 pd_stop,
 int32* details, double* values, double* q, double* result,
 double cutoff, int32 radius_effective_mode)
```

- `result` 長度 `nq·nout + 4`，`nout = have_Fq ? 2 : 1`；`have_Fq` 時偶數位為 F²、奇數位為 F；末 4 格依序為 total_weight、form_volume、shell_volume、radius_effective（皆未除權重）。JS 端：total_weight 為 0 時以 1 代之；其餘三者除以 total_weight；shell_volume 為 0 時以 1 代之（同 `kernel.py`）。
- `kernel` 的 JS API 對外提供 Fq 全部輸出：F1、F2、radius_effective、shell_volume、form_volume／shell_volume（G3 需要）。
- `details`／`values` 版面逐行移植 sasmodels 1.0.12 `details.py`（`make_details`、`make_kernel_args`）；1.0.12 的 `correct_theta_weights` 已停用，不移植。
- 與 `kerneldll.py` 相同，以每段 100 個 pd 評估點分段呼叫（`pd_start`、`pd_stop`）。
- **cutoff：執行期預設 1e-5**——與 SasView GUI（`sasview_model.py:349`）、bumps `Experiment`、`DirectModel` 的預設相同（使用者 2026-11-17 決定）。`kernel`／`evaluate` API 以參數接收 cutoff，測試可傳其他值。
- 雙精度（F64）。

### 4.3 多分散度

移植 `weights.py` 的六種分布。執行期（UI）預設：

| 分布 | npts | nsigmas | 說明 |
|---|---|---|---|
| gaussian | 35 | 3 | 同 sasmodels |
| rectangle | 35 | 1.73205 | 同 sasmodels |
| uniform | 35 | — | 同 sasmodels |
| lognormal | 80 | **3** | sasmodels 預設 8；使用者決定改 3 |
| schulz | 80 | **3** | sasmodels 預設 8；使用者決定改 3 |
| boltzmann | 35 | 3 | 同 sasmodels |

- schulz／lognormal 改 3 的理由：使用者在 SasView 6 實測 Nsigs=8 時 GUI 在低 q 發散（χ²→∞），Nsigs=3 時 sasmodels 與 SasView GUI 逐點相同；npts、nsigmas 在介面上可改。
- 寬度為相對值（σ／平均），與 SasView 相同；取點落在參數硬限制外者依 `weights.py` 的規則處理。
- **寬度可擬合**（使用者決定）：PD 展開列有「擬合 ☑」，預設上下限 [0, 0.4]（可改）。PD 寬度參數名稱沿用 sasmodels（例 `radius_pd`），在 fitter 參數向量、FitResult、序列結果表、IUCr 參數列中與一般參數同等對待。
- 寬度 0＝單分散。
- 以上是 **UI 預設**；測試轉接層（G3）另用 sasmodels API 預設（`_pd_n`=0、`_pd_nsigma`=3、`_pd_type`=gaussian），兩者分開。

### 4.4 結構因子 P@S（移植 `product.py`）

- 組合方式 `structure_factor_mode`：0＝`P*S`（預設），1＝`P*(1+beta*(S-1))`（β 近似）。
- 有效半徑 `radius_effective_mode`：預設 **1**（模型自身第一種定義，例如 sphere＝radius）；0＝unconstrained，由使用者輸入 `radius_effective`。選單文字直接用該模型的 `radius_effective_modes`。
- 強度（`product.py` 約 520-531 行）：

  PS = ⟨F²⟩·S（P*S）或 ⟨F²⟩ + ⟨F⟩²·(S−1)（β）
  I(q) = scale / ⟨V_shell⟩ · **volfraction** · PS + background

  **例外**：P 自帶 `volfraction`（清單中為 vesicle）時，S 的 `volfraction` 自參數集省略，且不乘入前因子（P 已在絕對尺度）。
- 參數集＝P 的參數＋S 的參數（vesicle 時省略 S 的 volfraction）＋兩個模式參數。sasmodels 1.0.12 裡替同名參數加 `_S` 後綴的 `_tag_parameter` 是死碼（`product.py:201-205` 最後保留的是未加後綴的那一個），所以**不實作後綴**。本清單的 6×2 種組合除 volfraction 外沒有任何同名參數；JS 端遇到其他同名情形一律丟 Error，不會默默產生重複名稱。
- 介面說明（依模型產生）：一般模型顯示「接 S(Q) 時強度同時乘上 scale 與 volfraction；volfraction 也決定 S(Q) 的形狀」；vesicle 顯示「使用模型本身的 volfraction」。
- 其餘細節以 `product.py` 原文為準，由 G1 驗證。

### 4.5 低 Q 冪律附加項

勾選後：I_total(q) = I_model(q) + A·q⁻ⁿ。A、n 為可擬合參數（預設 A＝0、n＝4，n 範圍 0–6），與模型共用同一個 background。等價於 sasmodels 和模型 `model + power_law`（power_law 的 background 固定 0），G1 以該和模型產生參考值。

### 4.6 Python 核心模型

`guinier_porod`、`power_law` 以 JS 依 sasmodels 原始 `Iq` 函式手寫，數值行為（含分段點、q＝0 的處理）必須與原版一致，由 G2 驗證。

### 4.7 SLD（X 光）

- SLD = r_e · ρ_e，r_e = 2.8179403262×10⁻⁵ Å，ρ_e = N_A · ρ_mass · Σ(n_i Z_i) / M（e/Å³）；顯示單位 10⁻⁶ Å⁻²。
- **f ≈ Z**（忽略異常散射 f′、f″）：在此近似下 SLD 與能量無關；檔頭能量只用於報告與 IUCr 的波長。
- 限制（介面說明、報告註記）：15 keV 下，含 Rb、Sr、Y、Zr、Br、Kr 或 Pt、Au、Hg、Tl、Pb、Bi、Th、U 的物質，實際 SLD 低約 4–10 %（例：Au 131.5 → 約 124），對比度平方的誤差約為兩倍；其他能量下受影響的元素不同。數字來自 periodictable 2.1.0 的 f₁ 表（15.0 keV 的 f₁/Z：Rb 0.897、Pb 0.906、Tl 0.911、Bi 0.918、Hg 0.920、Th 0.928、U 0.931、Kr 0.939、Sr 0.941、Au 0.943、Y 0.955、Pt 0.956、Br 0.963、Zr 0.963；輕元素物質在 0.5 % 以內）。
- 化學式語法（決策 21）：元素符號（首字大寫）＋可選計數（整數或小數；**ASCII 句點一律是小數點**，`CuSO4.5H2O` 讀成 O 5.5）；括號可巢狀、括號後可接計數；水合物以分隔符「·」（U+00B7；另接受「•」U+2022 與「⋅」U+22C5）連接，或寫成括號（`CuSO4·5H2O`、`CuSO4(H2O)5`）；分隔符後可有整數或小數倍數（省略為 1），可出現多次；倍數只能寫在分隔符之後（`2H2O` 不合法）；空白忽略。不認得或不支援的元素→欄位錯誤，訊息指出第幾個字元與原因。原子量與 Z 內建表（IUPAC 標準原子量），以 periodictable 交叉驗證（G6）。另接受 **D（氘，Z＝1、2.01410177784 u）**，例：`D2O`；其餘同位素不支援。
- 密度欄嚴格解析：只接受大於 0 的十進位數字（可帶指數），`0x10`、`1,0`、`1e400` 都是錯誤；算出的 SLD 不是有限值時同樣回報密度錯誤。
- 預設物質共 9 種（化學式＋密度，由同一函式算出；每一種另帶一則「註記」顯示在面板；數值、出處與**每個出處的查核程度**（已查證／轉引／未查證）寫在 `sasfit-sld.js` 註解，M3 科學審查 2026-11-18）：水、蛋白質（平均）、脂質頭基（PC，不含水合水）、**脂質頭區（PC，含 8 個水合水）**、脂質尾鏈（液態相）、**PEG（塊材，非晶態）**、SiO₂、Au、Fe₃O₄（決策 25）。脂質頭基是成分密度，註記寫明「不可直接當作殼層 SLD」；脂質頭區＝`C10H18NO8P·8H2O`、1.353 g/cm³（319 Å³＋8×29.97 Å³＝559 Å³）→ 0.4366 e/Å³、SLD 12.30；PEG 不提供水溶液的預設值（表觀比容不同、SLD 較高，由使用者自行輸入密度）。頭基＋兩條尾鏈＝DOPC（434 個電子），沒有重複計算。蛋白質、兩種脂質頭、尾鏈、PEG 是代表值，**上線前待使用者確認數值**。
- SLD 欄位可直接輸入數值；或開小面板輸入化學式＋密度後回填數值（參數本身永遠是數值）。

### 4.8 資料讀取、權重與清理（`sasfit-data-io.js`、`sasfit-weighting.js`）

**官方 `.dat` 判定**：第 1 行含 `Data Collection Mode`，且存在 `Single Frame Time` 行與其後 `Q I ERROR` 表頭。讀取檔頭欄位：輸出檔名、總幀數、Photon Energy (keV)、Scaling Factor、Sample／Empty Cell Transmission、Sample thickness (mm)、SDD (mm)、Starting Q-value（q_start）、Single Frame Time。Q 單位固定 Å⁻¹，強度為絕對強度 cm⁻¹。

**一般文字檔**：略過空行與 `#`、`;`、非數字開頭的行；分隔符為空白、Tab、逗號、分號；2 欄（q, I）、3 欄（q, I, σ）、4 欄（第 4 欄 dQ 讀入但 A 版不使用）。**欄數與分隔符取自第一個「所有欄都是數字」的候選行**，在它之前以數字開頭的檔頭行（例：日期）視為略過；整個檔都沒有這種行時由第一個候選行決定，以便回報它的錯誤（例：小數逗號）。Q 單位由使用者選 Å⁻¹（預設）或 nm⁻¹（讀入時 q 與 dQ ÷10，I 與 σ 不變）；選 Å⁻¹ 而 **最大 q > 5，或最大 q > 1 且最小的正 q > 0.02** 時提示「q 範圍像是 nm⁻¹（一般 SAXS 在 Å⁻¹ 下 q 約 0.003–0.5）」。

**上限（不可信的輸入）**：單檔 5 MB、100 000 點（讀到上限的下一列就停止並拒絕該檔）；每檔最多收集 50 則解析問題，其餘只計數（清單列顯示「另有 N 行」）；全部已載入檔案合計 2 000 000 點，超過的檔不加入並在該列說明；長於 64 個字元的 token 不進任何正規表示式，數字樣式對一串數字只有一種比對方式，`conditionFromName` 只看檔名最後 64 個字元——任何輸入的解析時間都與長度成正比。

**權重**（與 SasView `residuals_help` 的四種相同）：

| 選項 | w_i | 該點不參與擬合的條件 |
|---|---|---|
| 資料 σ（預設，有 σ 時） | σ_i | σ_i ≤ 0 或非有限 |
| √\|I\| | √\|I_i\| | I_i = 0 |
| \|I\| | \|I_i\| | I_i = 0 |
| 不加權 | 1 | — |

**官方檔的 σ（決策 23，修訂決策 12）**：官方 `.dat` 以 σ＝0 標示沒有有效資料的 bin（光束擋片區）。`kind: 'official'` 的檔案中，σ 為 0、負數或非有限的列在**四種權重下一律無效**——不進遮罩、`countExcluded` 四種都計入、不參與預設範圍；一般文字檔與沒有誤差欄的檔案不受影響。Worker 以同一個模組建遮罩，所以擬合請求的 `data` 帶 `kind`（缺少時視為 `'generic'`，其他值為 `BAD_DATA`）。介面在權重不是資料 σ 時加一則說明「此檔有 N 點 σ＝0（光束擋片區或無效的點）：官方檔的這些點在任何權重下都不參與擬合」。

殘差 r_i = (I_i − I_model,i) / w_i。缺 σ 的檔案預設權重改為「不加權」並提示；**有 σ 欄但沒有任何一個可用值**（全部為 0、負數或非有限）的檔案同樣改為「不加權」——`SasFitWeighting.defaultMode(dataset)` 只在至少一點的 σ 為有限正數時回傳 `'sigma'`，否則回傳 `'none'`（M2 審查）。`SasFitWeighting.countExcluded(dataset, mode)` 回傳該權重下被遮罩排除的點數，供介面顯示（§5.7）。

**清理（不刪原始點，只標記）**：
- 非有限值、q ≤ 0 → 排除。
- 依上表，w_i ≤ 0 或非有限的點不參與擬合。
- I < 0 但 w_i > 0 的點**照常參與擬合**；log 與 Guinier 模式無法顯示 I ≤ 0 的點，隱藏並顯示「隱藏了 N 點」。
- 預設擬合範圍由純函式 `defaultRange(dataset, weighting)`（weighting 模組）計算：Qmin＝max(q_start（僅官方檔）, 第一個在該權重下可參與擬合的點)，Qmax＝最後一個可參與擬合的點。權重改變時重新計算（使用者未手動改過範圍時才套用新預設）。

**條件值**：取檔名（去副檔名）最後一個數字（整數或小數，允許負號），例如 `B1216_1_10.dat` → 10；取不到則空白待填。

**Dataset 物件**（凍結）：`{ id, fileName, kind: 'official'|'generic', header, q, I, sigma, condition }`。w_i、可參與擬合遮罩、預設範圍都由 weighting 模組依當下權重即時計算，不存在物件內。遮罩一次涵蓋全部條件：finite(q)、q > 0、finite(I)、finite(w_i)、w_i > 0，官方檔另加 σ_i 為有限正數。data-io 只負責解析與錯誤回報（格式錯誤的行列入該檔的錯誤訊息），Worker 端不需要 data-io。

### 4.9 擬合器（`sasfit-fitter.js`、`sasfit-linalg.js`）

- 介面：`fit(problem, options) → FitResult`，`options.method = 'lm'`（A 版唯一值；B 版新增 DE、DREAM、Nelder–Mead、BFGS 時不改呼叫端）。
- LM：Marquardt 對角縮放；殘差同 §4.8。阻尼因子 λ 起始 1e-3，依 Nielsen 的更新法調整：步被接受時 λ ← λ·max(1/3, 1 − (2ρ − 1)³)（ρ＝實際下降／預測下降），被拒絕時 λ ← λ·ν、ν ← 2ν（每次迭代開始時 ν＝2）。相較於原先的「拒絕 ×10、預測良好才 ÷10」，在狹長彎曲的谷（低 Q 冪律放開指數）步數約為三分之一，其餘案例不變；`tests/sasfit-g4.test.js` 有一個步數上限的回歸測試。
- 上下限：試探步超出時截回邊界（projected LM），所以貼邊界的參數值**恰等於**邊界；結果落在邊界者以 `atBound` 標「觸及上限／下限」。貼在邊界上的參數仍有**有限的誤差**——把它當自由參數算（與 bumps 相同，`lsqerror.py:105`），這個數字不代表該參數的不確定度，介面必須標明（§5.7）。
- **終止條件**比照 bumps 1.0.4 `lm`（MPFit，`mpfit.py`），每個試探步之後（不論接受與否）檢查：
  - ftol（`mpfit.py:1317`）：實際相對下降 |actred| ≤ ftol、線性模型預測的相對下降 prered ≤ ftol、且兩者之比 ≤ 2；
  - xtol 的對應條件：MPFit 比的是信賴半徑，本站用阻尼因子而沒有半徑，改比「阻尼後試探步的縮放長度」|D·δp| ≤ xtol·|D·p|；
  - 阻尼上限：阻尼因子超過 1e30（已經沒有更短的步可試）；
  - gtol（`mpfit.py:1182`）：殘差與每一個自由欄的夾角餘弦 ≤ 1e-10（bumps 沿用 MPFit 預設）；
  - 步數（`mpfit.py:1327`）：被接受的步數達 `maxSteps`→ `'maxiter'`（標「未收斂」但照樣回報）。
  - 預設 steps 200、ftol 1e-10、xtol 1e-10。**ftol、xtol 固定**，不經 Worker 的 `options` 開放；`maxSteps` 可由 `options.maxSteps` 指定，上限 `MAX_STEPS`＝10000（`SasFitWorkerCore.MAX_STEPS`），超過回 `BAD_OPTIONS`。
- **Jacobian**（迭代與最後算共變異用同一個函式）：前向差分，h_j = 1e-4·|p_j|（p_j＝0 時 h_j＝1e-4）；若 p_j + h_j 超過上限則改往後差分（這一步不看下限，與 bumps `lsqerror.py:99-110` 逐位元相同）。**只有在這一欄算出非有限值時**才重試：依序試 −h、+h/2、−h/2，會跨出 [下限, 上限] 的步略過，取第一個算得出來的。不需要重試時結果與原規則逐位元相同（測試對 19 個參考案例逐位元斷言）。
- **模型算不出來的區域**（hayter_msa 會整條曲線回傳 NaN，§16）：
  - 試探步的模型輸出含非有限值→該步 χ² 視為 ∞、拒絕、加大阻尼；不丟例外。
  - 迭代中某一欄 Jacobian 四種步長都算不出來→該參數在**這一次迭代**固定不動（比照貼邊界的參數），其餘參數照常走。
  - **不得把「被算不出來的區域擋住」報成收斂。** 規則（細節寫在 `sasfit-fitter.js` 檔頭）：線性模型預測相對下降 > ftol 的非有限試探步會開啟一道「牆」；ftol／xtol／阻尼上限在這種步之後觸發（中間沒有被接受的步，且之後沒有「算得出來、預測下降 > ftol、卻仍被拒絕」的較短步），或在牆還開著時觸發而以牆前的阻尼再試一步仍是非有限，或終止時仍有算不出來的 Jacobian 欄→ `status: 'failed'`、`blockedByNonFinite: true`，參數是目前為止最好的點、χ² 照常回報、誤差在算得出來的範圍內照算。預測下降 ≤ ftol 的非有限試探步不算（緊貼真正極小值旁的零星 NaN 不會把已完成的擬合變成失敗）。
  - `'failed'` 只在這類情況出現：起始點本身非有限（此時 χ²＝∞、誤差全為 NaN、`blockedByNonFinite` 與 `jacobianNonFinite` 皆為 true），或上一點所述。只有有限試探步時，終止狀態就是上列條件的結果，`blockedByNonFinite` 為 false。
- **共變異與誤差（比照 bumps，以便與 SasView 顯示的誤差一致）**：bumps 的 lm 不用 MPFit 自己的共變異（`nocovar=True`），而是在最佳解處另算 `lsqerror.jacobian`＋`jacobian_cov`。本站照做：
  - C = V·diag(1/s²)·Vᵀ（J 的 SVD），奇異值 ≤ 1e-8 者以 1e-8 代之。JS 沒有內建 SVD：`sasfit-linalg.js` 實作 one-sided Jacobi SVD（自由參數僅十幾個，足夠快且數值穩定），測試基準是以 60 位十進位算出的精確奇異值與共變異（條件數 1e12 時 LAPACK 的最小奇異值誤差達 1e-5，不適合當基準），numpy 與 bumps 的 `jacobian_cov` 只做交叉檢查。
  - `illConditioned`：**只代表「有奇異值被代換成 1e-8」**（或 Jacobi SVD 在 60 次掃描內未收斂——未曾觀察到，`svd`／`covariance` 以 `converged` 回報）→ 標「參數相關性過高，誤差不可靠」。它不代表「算不出來」。
  - `jacobianNonFinite`：最後的 Jacobian 有某一欄四種步長都算不出來。該參數的誤差與共變異的該列該行為 NaN；其餘參數的誤差是「把那個參數固定」算出來的（因此偏小）。
  - 原始誤差 σ_j = √C_jj。
  - **顯示規則**（使用者決定）：權重＝資料 σ 時顯示原始誤差（不乘 √χ²ᵣ）；權重＝√|I|、|I|、不加權時顯示 σ_j·√χ²ᵣ。**只有權重＝資料 σ 時，這個量才稱為 χ²ᵣ**；其餘三種權重下它沒有絕對意義，介面稱為「加權殘差均方」，誤差欄標「已乘 √均方」，換算說明寫「誤差已乘 √(加權殘差均方)＝f；SasView 在相同權重下顯示未乘的值＝此處誤差 ÷ f」（決策 24；`FitResult` 的欄位名稱 `chi2r` 不變）。報告 TXT 一律兩種都列。
- 自由度 = 可參與擬合的點數 − 自由參數數（含被勾選的 PD 寬度）；範圍內點數必須 > 自由參數數，否則不允許開始。
- **與真正極小值的距離**：G4 在 19 個參考案例上驗證「對精修後的真正極小值 < 0.01σ」（§11）。這不是對所有問題的保證：迭代用的前向差分 Jacobian 有偏，參數強相關（|相關係數| ≳ 0.99）時解可離真正極小值約 0.03σ（同一問題上原始 bumps 的距離是它的 3.45 倍），多出的 χ² < 1e-3（M2 科學審查實測，不在 fixture 內）。B 版候選「擬合後以中央差分精修」（§16）。
- FitResult（凍結；由 `SasFitWorkerCore.buildFitResult` 組成，`client.stop()` 合成的結果有相同的欄位）：

  ```
  { params,                 // 送進來的全部參數，被擬合者換成新值
    names,                  // 被擬合的參數名稱，擬合器的順序（＝fitFlags 的鍵順序）
    errors, errorsScaled,   // { 名稱: σ_j }、{ 名稱: σ_j·√χ²ᵣ }
    displayErrorsScaled,    // 權重不是資料 σ 時為 true：介面顯示 errorsScaled
    covariance, correlation,// n×n 純陣列，列與行依 names；correlation＝C_ij/√(C_ii·C_jj)，任一變異數不是正數時為 NaN
    chi2, chi2r, dof, iterations,
    status,                 // 'converged' | 'maxiter' | 'stopped' | 'failed'
    atBound,                // { 名稱: 'lower' | 'upper' }
    illConditioned, blockedByNonFinite, jacobianNonFinite,   // 一律是布林值
    nonFiniteCurvePoints,   // 最終全範圍曲線中非有限值的個數
    curve, residuals,       // 全部資料點上的模型值；殘差在未參與的點為 NaN
    settings }              // { modelSpec, weighting, range, cutoff, maxSteps, method, ftol, xtol }
  ```

### 4.10 Worker 協定

| 方向 | 型別 | 內容 |
|---|---|---|
| → | `evaluate` | `{ reqId, modelSpec, params, q, opts }`（`opts.cutoff`）；Worker 只處理最新的 reqId（latest-wins，舊請求丟棄，連錯誤也不回） |
| ← | `curve` | `{ reqId, I, extras }` |
| → | `fit` | `{ jobId, modelSpec, params, fitFlags, bounds, data, range, weighting, options }`（`options`＝`{ maxSteps, cutoff }`，§4.9） |
| ← | `progress` | `{ jobId, iteration, chi2r }`——**每個被接受的步一則**（被拒絕的試探步不回報）；最後一則的 χ²ᵣ 等於結果的 χ²ᵣ |
| ← | `result` | `{ jobId, fitResult }` |
| ← | `error` | `{ reqId|jobId, code, message, detail }`；`message` 是給使用者的中文，`detail` 是技術細節（英文），介面寫入 `console.warn`（§12） |

- wasm 在 Worker 內以 `fetch`（網址帶 `?v=`）載入並快取（每模型一次）；載入失敗或 wasm trap 後該模型不留在快取，下一個請求重新載入。
- **錯誤代碼**
  - Worker 端（`SasFitWorkerCore.ERROR_CODES`）：`BAD_MESSAGE`、`UNKNOWN_TYPE`、`UNKNOWN_MODEL`、`BAD_PARAMS`、`BAD_FIT_FLAGS`、`BAD_BOUNDS`、`BAD_DATA`、`BAD_RANGE`、`BAD_WEIGHTING`、`BAD_OPTIONS`、`TOO_FEW_POINTS`、`WASM_LOAD`、`WASM_TRAP`、`INTERNAL`。`BAD_PARAMS` 依**出處**判定：本檔明寫的檢查，以及 `SasFitEvaluate.evaluate`（計算核心自己的輸入檢查）丟出的一般 `Error`；擬合器、權重模組或其他地方丟出的任何錯誤一律是 `INTERNAL`。
  - 主執行緒端（`SasFitWorkerClient.ERROR_CODES`）：`SUPERSEDED`（被較新的 evaluate 取代，呼叫端忽略）、`BUSY`、`STOPPED`、`WORKER_CRASH`、`WORKER_START_FAILED`、`DISPOSED`、`POST_FAILED`。
  - Worker 入口檔自己會送兩種沒有 id 也沒有 `message` 的 `error`（中文訊息由 client 補上）：`importScripts` 失敗→`WORKER_START_FAILED`；收到無法還原的訊息（`messageerror`）→`BAD_MESSAGE`。沒有 id 的 `error` 使所有進行中的請求一起 reject。
- **一次只能有一個擬合**：已有擬合進行中時再呼叫 `client.fit` → reject，code `BUSY`。
- **「停止」**＝`client.stop()`：
  - 沒有進行中的請求時不做任何事（保留已載入 wasm 的 Worker）。
  - 否則 `worker.terminate()`（Worker 內的擬合迴圈是同步的，收不到訊息，只能終止），並結清所有進行中的請求：擬合以**合成的結果** resolve——`status: 'stopped'`、`params` 為送出時的值、`names`／`covariance`／`correlation` 為空、沒有誤差、三個旗標為 false、`nonFiniteCurvePoints` 0、`chi2`／`chi2r`／`dof`／`curve`／`residuals` 為 null、`iterations` 為最後一次回報的步數；evaluate 以 `STOPPED` reject。
  - **新的 Worker 延後到下一個請求才建立**（lazy）。序列擬合停止亦同。
- Worker 異常結束（`error` 事件帶訊息、`messageerror`、或 `result`／`curve` 訊息的格式不對）→ 進行中的請求以 `WORKER_CRASH` reject；Worker 腳本載不到（`error` 事件沒有訊息）或無法建立→ `WORKER_START_FAILED`。兩者都在下一個請求才重建（立刻重建時，若腳本本身載不到會無限重試）。
- `onProgress` 回呼丟出例外不影響擬合：例外被攔下、之後的進度照送、擬合照常結束，例外改由 microtask 重新丟出（成為頁面的 uncaught error，不會無聲消失）。
- client 發出的每一個 Promise 在所有路徑上都會結清（測試逐一路徑驗證）。
- 單次 evaluate 超過 300 ms 時，預覽改為「計算中…」狀態顯示（不阻擋操作）。

## 5. 介面規格

元素 id 前綴 `sf`（IUCr 頁新增者用 `iucr-sf`）。沿用 v5.2 設計系統：`.card`、分組圓角輸入列、分段控制、`ResultTiles`、`ChartTheme.colorize`、語意色 token；**不新增顏色字面值**、不加裝飾圖示、不用行內 script／onclick（CSP）。

### 5.1 版面

```
┌─ 側欄 ─┬────── 左欄：操作 ──────┬──────────── 右欄：圖（較寬；兩張卡同時在畫面上）──────────┐
│        │ [資料][模型][擬合][序列] │ ┌ 曲線卡（左欄比右欄長時捲動固定）─────────────────────┐ │
│        │ ┌ 擬合列（四個分段都在）┐ │ │ I(q)            [log-log│Guinier│Kratky│Porod] [重設縮放] │ │
│        │ │[開始擬合][停止]      │ │ │ 空心資料點（誤差棒）＋墨色的模型曲線                    │ │
│        │ │ χ²ᵣ 1.02 已收斂 5 步 │ │ │ 灰色區＋虛線＝擬合範圍外                               │ │
│        │ │ q 範圍·點數·擬合參數  │ │ │ 操作說明                   [主圖 PNG][殘差 PNG]        │ │
│        │ └────────────────────┘ │ │ 殘差（與主圖共用 x 軸；沒有結果時只有一行字）             │ │
│        │  分段內容                │ └──────────────────────────────────────────────────────┘ │
│        │                          │ ┌ 3D 結構示意 ──────────────── [重設視角][自動旋轉][PNG] ┐ │
│        │                          │ │ 狀態行／畫布（比例尺）／操作說明／尺寸與說明              │ │
│        │                          │ └──────────────────────────────────────────────────────┘ │
└────────┴─────────────────────────┴────────────────────────────────────────────────────────┘
```

**圖欄（v5.8；決策 42，取代決策 30 的「曲線｜3D 結構」切換）**：右欄由上而下是曲線卡（`#sfCurveCard`：標題列、狀態列、主圖、操作說明與 PNG 鈕、殘差，與 v5.7 相同）與 3D 結構示意卡（`#sfShapeCard`：標題「3D 結構示意」與工具 重設視角／自動旋轉／PNG、狀態行、畫布（與主圖同高、比例尺在左下）、操作說明、尺寸與說明）。兩張卡同時在頁面上，都隨參數即時更新；沒有切換鈕、沒有 `plotView`。

- **兩欄**：右欄與左欄同高（`.sf-plots` 為 `align-self: stretch` 的直向 flex），曲線卡放在 `.sf-curve-track` 裡 `position: sticky; top: var(--spacing-lg)`，這一段吃掉左欄比右欄多出來的高度：左欄很長（例：core_shell_cylinder＋hayter_msa 的參數表）時往下改參數仍看得到曲線；3D 卡接在這一段之後，捲到左欄末端時它把曲線卡推上去，**兩者從不重疊**（sticky 的卡片不能讓下一張卡從它底下滑過）。左欄不比右欄長時這一段就是曲線卡本身，3D 卡緊接在下面，整欄跟著頁面捲動。**欄內沒有任何捲動容器**（v5.7 的 `max-height`＋`overflow-y: auto` 已移除），滾輪永遠捲頁面。視窗高度 < 700 px 時曲線卡不固定（它比視窗高，固定了下半部會一直看不到）。實測（core_shell_cylinder＋hayter_msa，左欄 1800 px，逐 100 px 捲動）：1440×900 頁面可捲約 1160 px，scrollY 200 起曲線卡停在頂端 25.5 px，約 600 起被 3D 卡推上去，捲到底時 3D 卡完整在畫面內；1280×800、1024×768 相同（固定到 scrollY 約 600／700）；任何位置兩卡都不重疊（smoke_m4 檢查 12b，每次執行印出捲動紀錄）。
- **單欄**（內容寬 < 860 px）：`.sf-plots` 與 `.sf-curve-track` 為 `display: contents`，兩張卡直接是工作區的格子項目、排在操作區之前（曲線、3D、操作區）。「模型」分段時曲線卡釘在視窗頂端（只留主圖，同 v5.7）；3D 卡不釘，往下捲時與操作區一樣從曲線卡底下經過。單欄的 3D 畫布高 `clamp(220px, 36vh, 320px)`。
- **沒有固定形狀的模型**（guinier、guinier_porod、power_law、mono_gauss_coil、gaussian_peak）：3D 卡只剩標題列與一行「此模型沒有固定形狀」（工具停用），不留空白的畫布。
- 3D 只在畫面上時重畫（§6）；曲線卡的行為與 v5.7 相同。

**欄寬與斷點（修正批次 B，UI 審查 2026-11-19；決策 29）**：斷點看的是**分頁內容的寬度**（`#section-sasfit` 是 CSS container，`@container sf`），不是視窗寬度——側欄在視窗 1024 px 以下會收起來，視窗 1024 的內容（約 973 px）其實比視窗 1280（有側欄，約 938 px）還寬，用視窗寬度當斷點會在比較寬的那一邊先變單欄。

| 內容寬度 | 版面 | 實測（視窗→左欄／右欄／主圖畫布寬） |
|---|---|---|
| ≥ 1040 px | 兩欄 `minmax(26rem, 5fr) minmax(0, 7fr)`，圖區 sticky | 1440×900 → 447／626／575 px |
| 860–1039 px | 兩欄 `minmax(26rem, 9fr) minmax(0, 10fr)`，圖區 sticky | 1280×800 → 442／471／420 px；1024×768（無側欄）→ 449／499／448 px |
| < 860 px | 單欄，**圖排在最上面**；位於「模型」分段時圖固定在視窗頂端（只留主圖，殘差與操作說明收起來），打字時看得到曲線跟著變 | 760×900、320×640 |

主圖高 `clamp(300px, 46vh, 460px)`（單欄時 `clamp(180px, 30vh, 260px)`），殘差圖 140 px（單欄 110 px）；還沒有擬合結果時殘差圖收成一行「尚無擬合結果」。左欄最窄 26 rem：四欄的參數表（§5.3）在 1440、1280、1024 三種視窗都不需要橫向捲動；320 px（或 400 % 縮放）時參數表每個參數改排兩行（`@container sfparams (max-width: 21.5rem)`），整頁沒有橫向捲軸。

**擬合列**（`#sfFitBar`，分段鈕與分段內容之間，捲動時固定在左欄頂端；視窗 1024 px 以下左邊留出固定選單鈕的位置）：四個分段都看得到「開始擬合」「停止」、擬合量度（χ²ᵣ 或「加權殘差均方」，§5.4）與狀態、步數；一行摘要 `q 0.005–0.07 Å⁻¹ · 57 點 · 擬合 scale、background、radius`（不能開始時改寫原因，「開始擬合」以 `aria-describedby` 指向它）；進行中顯示「正在擬合 <模型>…已 N s」與最新一步。調參數（模型分段）與看 ± 欄不必再切到擬合分段才能按開始。序列進行中擬合列顯示不含檔名的短進度（例：「序列 2／3 · 第 7 步 · 約化 χ² 1.84」，量度名稱照決策 24），含檔名的完整文字在序列分段；在序列分段時「開始擬合」是次要按鈕的樣子（該分段的主要動作是「執行序列擬合」）。

### 5.2 資料分段

- 拖放區＋檔案選擇（多選，`accept=".dat,.txt,.csv"`）；一般文字檔的 q 單位選擇。
- 清單欄位：顯示（☑）｜擬合對象（◉，原稱「作用中」）｜檔名與狀態｜條件值（可編輯數字）｜移除。**清單沒有「序列」欄**（M4；決策 36）：要納入序列的檔在序列分段的那一張表裡勾選。狀態排在檔名之下（左欄窄，少一欄檔名才不必折成三行）：未擬合是文字；有結果時是一個短晶片——量度與數值，疑慮時多一個詞（`χ²ᵣ 711 偏大`、`未收斂`、`失敗`、`有警示`），完整狀態在 `title` 與報讀文字裡，不只靠顏色（§5.7 第 19 點）。過長的檔名截掉中段顯示（44 字，`title` 是完整檔名，所有 `aria-label` 用完整檔名）。
- 條件名稱與單位輸入（預設「條件」，例：Temperature (K)、濃度 (mg/mL)、幀號）。**條件名稱就是清單那一欄的標題**，也用在各條件值輸入框的 `aria-label`；留空時標題為「條件值」。
- 移除後出現「已移除 <檔名>［復原］」一列：復原把該檔放回原位，連同它的「顯示」勾選與擬合結果；原本是擬合對象的仍是擬合對象。只能復原最後一次移除，清單再變動（載入檔案、再移除）後就不提供（`SasFitState` 的 `removed`／`undoRemove`／`dismissRemoved`）。
- 一次載入超過 8 組時在清單下說明「只自動顯示前 8 組」。
- 疊圖錯開開關＋級距 n（第 k 組乘 10^(k·n)，僅顯示用，不影響擬合與匯出）。
- 檔案讀取錯誤列在該檔列內（原因＋行號），不影響其他檔。

### 5.3 模型分段

- 模型選單：依類別分組（形狀／與形狀無關），**沒有搜尋框**（只有 13 個模型；修正批次 B 移除）。選項寫成「sasmodels 名稱 — 中文名」（`SasFitLabels.MODEL_NAMES`）：sphere 均勻球、core_shell_sphere 核殼球、vesicle 囊泡、ellipsoid 旋轉橢球、cylinder 圓柱、core_shell_cylinder 核殼圓柱、flexible_cylinder 柔性圓柱（蠕蟲鏈）、lamellar 層狀、Guinier、guinier_porod Guinier–Porod、power_law 冪律、mono_gauss_coil 高斯鏈（單分散）、gaussian_peak 高斯峰。選中後顯示模型說明（sasmodels 的英文標題，靠左）與 SasView 文件連結（外部連結，`rel="noopener"`）。
- S(q) 選單（無／hardsphere — 硬球／hayter_msa — Hayter–Penfold MSA（帶電球））；不可接 S(q) 的模型停用並說明。選了 S(q) 時顯示組合方式、有效半徑模式選單（第一項「自行輸入 radius_effective」）與 §4.4 的說明文字。
- 低 q 冪律開關（「加上低 q 冪律項」）。
- **參數表（修正批次 B 重新設計；決策 29）**：可見四欄——擬合（☑）｜參數（名稱＋單位；名稱只在底線後折行）｜數值｜±（擬合後；權重不是資料 σ 時表頭註明「已乘 √均方」；貼邊界時寫「貼上限／貼下限」，整句在提示與結果磚）——加上每個參數一顆「更多」按鈕（`aria-expanded`／`aria-controls`），展開該參數的**明細列**：
  - 下限、上限（留空＝不限）；
  - 可多分散的尺寸參數另有「多分散」開關（`aria-expanded`；開著時這個多分散才參與計算），展開後：擬合寬度 ☑、寬度 ± 誤差、寬度下限／上限（預設 0–0.4）、分布、取點數（原 npts）、範圍（σ 倍數）（原 nsigmas）。預設值不變：gaussian 35／3，schulz／lognormal 80／3；勾選擬合而寬度為 0 時改 0.05；
  - SLD 參數另有「化學式」按鈕（`aria-expanded`／`aria-controls`），面板開在**同一個明細列**裡（原本開在整張表之下）。焦點進面板、Escape／取消回到按鈕、套用後到數值欄。
  - 收合的列仍要說實話：上下限不是預設值、或多分散有作用時，名稱下有文字標記（`0–45`、`≥ 10`、`多分散 0.1`、`多分散（擬合寬度）`）。
  - 明細列裡的欄位出錯時自動展開、且收不起來（訊息在裡面）；新的擬合結果把參數（或它的寬度）留在邊界上時自動展開（使用者可再收合）。
  - 欄位錯誤是整行寬的訊息：數值的訊息在該列底下自成一列，明細列欄位的訊息在明細列內各佔一行。
  - 由模型決定的 `radius_effective` 數值欄顯示「—」、不可編輯、沒有「更多」。
  - 很窄（表格寬度 ≤ 21.5 rem）時每個參數改排兩行：擬合／名稱／更多，數值／±。
- 數值輸入即時檢查（模型硬限制、下限 < 上限、多分散寬度 ≥ 0、取點數正整數、範圍 > 0），錯誤以欄位層級提示，不送預覽；此時圖區狀態列寫「參數表有錯誤，曲線尚未更新」。全形數字與全形小數點（中文輸入法）以 NFKC 折成半形後照常接受；小數逗號（`1,5`）不接受，訊息註明請用「.」（`SasFitForm.parseNumber` 是欄位→數字唯一的讀法，`SasFitJobs` 也經過它）。
- 參數單位沿用 sasmodels（長度 Å、SLD 10⁻⁶ Å⁻²、scale／background 依模型）。

### 5.4 擬合分段

- q 範圍（q 下限、q 上限輸入＋「全範圍」「預設範圍」按鈕；主圖上以灰色與兩條虛線顯示範圍外）。範圍輸入不合法時，其下的點數說明留白（不留著上一個範圍的數字）。
- 權重選單（§4.8 四種）、最大步數（預設 200）。
- 「開始擬合」「停止」在擬合列（§5.1，三個分段都在）；本分段留「還原擬合前的參數」（原「回復擬合前參數」）。**還原屬於它那一組資料**：擬合對象換成別組時停用，並說明「可還原的是「<檔名>」擬合前的參數；請先把它設為擬合對象」。
- 進度（擬合列）：「正在擬合 <模型>…已 N s；第 k 步，約化 χ²＝…」，每秒與每個被接受的步更新；報讀區只在開始與結束更新。擬合結束後進度列留白（擬合列的量度那一行已經寫了結果），已停止／失敗時寫出原因。
- **焦點**：按下「開始擬合」後它被停用，焦點移到「停止」；停止或失敗後回到「開始擬合」；成功時在擬合分段把焦點移到結果，在其他分段回到「開始擬合」。
- **結果的順序**：主角磚 → §5.7 的提示（`aria-live="polite"`）→ 各擬合參數。參數不超過 4 個時是結果磚（`role="list"`／`listitem`），超過時改用唯讀的 `.result-list`；整頁仍只有一個主角磚。
- **不是目前參數的結果**（擬合後改過參數，或新的擬合正在跑）：上方註明、磚改成虛線外框與次要色（不降低不透明度，次要文字會掉到 4.5:1 以下），擬合列加「參數已改動」。沒有結果的資料寫「此資料尚未擬合」。擬合進行中，資料與模型分段各有一行「擬合進行中，參數與資料已鎖定」，被停用的輸入框變淡。
- 文字語境（進度、報讀區、選單、`aria-label`）把 χ²ᵣ 寫成「約化 χ²」；HTML 裡寫成 `χ<sup>2</sup><sub>r</sub>`（Unicode 下標 ᵣ 在小字時像逗號）。
- 結果：主角磚＝χ²ᵣ（權重＝資料 σ）或「加權殘差均方」（其餘權重，磚內附一行「權重不是資料的 σ：這個數值沒有絕對意義（不是 χ²ᵣ），只能比較同一組資料、同一種權重的不同擬合」）；進度列與檔案清單的狀態用同一個名稱。一般磚＝各擬合參數 值 ± 誤差（單位）；狀態標記（未收斂、觸及上下限、誤差不可靠、已乘 √均方）。
- **數字格式（`sasfit-format.js`，磚、± 欄、提示與回填共用同一組函式；決策 26）**：
  1. 數值至少顯示 3 位有效數字。一般情況（誤差 < |數值|）：誤差 2 位有效數字，數值取到同一個小數位；兩者較大者在 [10⁻³, 10⁶) 時用一般寫法，否則用指數寫法，指數取自較大的那個數、進位後重新正規化（`9.99999e-5 ± 1e-6` → `1.000e−4 ± 1.0e−6`）；誤差的尾數 ≥ 0.1 時共用指數（`2.25e−4 ± 0.77e−4`），否則誤差自成一格。數值需要超過 10 位有效數字才到得了誤差的位數時，數值顯示 10 位、誤差自成一格。不會出現 `0e1`、`14000e1`、`0.0000050e5` 這類寫法。
  2. 誤差 ≥ |數值|：數值 3 位有效數字、誤差 2 位有效數字，各用自己的寫法（`72.7 ± 5700`）；磚加一行「誤差大於數值：與 0 無法區分，或無法由這組資料決定」（修正批次 B 改寫：這個條件也涵蓋「與 0 一致」的參數，例如 background 0.0007 ± 0.0036），並有一則警告提示列出這些參數（§5.7 第 14 點）。
  3. `illConditioned` 且誤差 > 1000·|數值|：誤差不顯示數字，改寫「無法決定」。
  4. 畫面上的負號用 U+2212「−」；輸入欄的值與任何會被讀回的文字維持 ASCII。
  5. 單位：`background` 在官方檔（絕對強度）顯示 cm⁻¹；電荷單位寫成「e（基本電荷）」以免讀成指數；單位為 `None` 的參數不顯示單位。由模型決定的 `radius_effective` 數值欄顯示「—」。
  6. 擬合值回填輸入欄時先捨入：取到誤差第 2 位有效數字再往後 2 位，至少 6、至多 15 位有效數字；誤差不可用時取 8 位；貼在邊界上的值原樣寫入；捨入不得越過表單的上下限。參數因此移動不到 0.001σ。`resultMatchesForm` 經同一個函式比較，結果與它自己回填的表單相符；結果磚以回填後的值格式化，所以磚與輸入欄一致；「從目前的值繼續擬合」由捨入後的值出發。
- 「送進 IUCr 表格」（擬合成功才啟用）、「匯出擬合曲線 CSV」「匯出報告 TXT」。

### 5.5 序列分段（§7）

由上到下（M4 實作；UI 審查後修正）：

1. **選項**：「以前一筆結果作為下一筆初值」「依條件值排序」（預設皆開）。
2. **摘要**一行：模型、範圍（未編輯：「各檔的預設範圍」；編輯過：「<範圍>（各檔截到自己的可用範圍）」）、權重、要擬合的參數、最大步數、將擬合／跳過幾個檔——這些都在模型與擬合分段設定，這裡只讀；不能執行時改寫原因。排程的警告（沒有條件值的檔、會被跳過的檔）與上一次的結束說明列在下面（`#sfSeqHints`）。**序列中止或放棄的原因也留在這裡**（錯誤色），不只在頁面頂端共用的訊息區——後者會被下一次成功的預覽清掉。
3. **「執行序列擬合」**與進度行（含檔名的完整文字；結束後是「完成 3／3 筆：收斂 3、未收斂 0、跳過 0」）。這裡沒有停止鈕：擬合列的「停止」停掉進行中的那一筆，序列就此結束。
4. **趨勢圖**（有點可畫時才出現，高 220 px，不開縮放）：y 軸選單（各擬合參數＋量度）、PNG。
5. 「全選／全不選」「匯出序列結果 CSV」。
6. **一張表**同時負責選檔與結果（上限 500 列，在自己的框裡捲動，表頭固定）。欄序：納入（☑）｜檔名（＋「載入」鈕）｜條件值｜量度（第二行是狀態晶片）｜各擬合參數（值，下一行 ± 誤差或貼邊界的標記）。**註記不佔欄**：有話要說的列（初值來自哪個檔、哪些參數沒有沿用、範圍被截、跳過或出錯的原因、之後被單獨重新擬合）下面多一列橫跨全表的註記列，以 `headers` 指回該檔的列標題，寬度跟著框、表格橫捲時不被切掉。檔名欄最窄 8 rem、固定在左邊（內容寬度 480 px 以下不固定）：1440／1280／1024 的左欄裡，檔名、條件值、量度＋狀態與第一個參數不必橫捲就看得到。

序列進行中整頁鎖定（`fit.phase` 全程是 `'running'`），不逐筆整頁重繪：`seqStep` 與 `fitProgress` 靜默 dispatch，進度文字直接寫入，另有一個最多每 250 ms 一次的整頁重繪。

### 5.6 圖區

- 主圖模式：log-log（I vs q，雙對數）、Guinier（ln I vs q²，線性軸）、Kratky（q²I vs q，線性軸）、Porod（I·q⁴ vs q，線性軸；v5.7）。四種模式套用到所有顯示中的資料與其模型曲線。圖卡標題跟著模式（I(q)／ln I – q²／q²·I – q／I·q⁴ – q）。
- **Porod 模式（v5.7；決策 40）**：y ＝ I·q⁴、誤差棒 σ·q⁴、模型曲線同乘 q⁴，作法與 Kratky 完全相同（負的 I 照畫；只有 q ≤ 0 或 q、I 不是有限值的點不畫；x 軸從 0 到資料的最大 q；擬合範圍灰區與虛線、縮放、PNG 都一樣）。**不扣背景**：畫的是載入的資料與算出來的模型，所以平的背景在圖上是隨 q⁴ 上升的曲線，不是 Porod 平台。y 軸標題「I(q)·q⁴」，全部是官方檔時「I(q)·q⁴ (cm⁻¹·Å⁻⁴)」。殘差圖不變（x 用 q，殘差不乘 q⁴）。
- **標題列（v5.7；v5.8 放寬）**：兩欄版面兩張卡的標題列一律不折行（`flex-wrap: nowrap`）；字型較寬時標題先以刪節號縮短。v5.8 拿掉切換鈕後，曲線卡在圖卡內寬 420／448 px（視窗 1280／1024）也放得下**完整的標題**、四顆模式鈕（左右留白 0.375rem）與**完整的「重設縮放」**：四種模式中最少的餘裕是 1280 的 Guinier 標題（ln I – q²）43.6 px，1024 為 71.6 px，1440 為 151.5 px。v5.7 的權宜作法（1280／1024 標題只給輔助科技、按鈕短標「重設」）因此取消。3D 卡的標題列在 1440／1280／1024 餘 249.5／126.6／154.6 px。標題列高 32 px。單欄：760 寬同一列；320 寬工具換到標題下一行（模式鈕組 203 px，字級 0.75rem）。
- **曲線與資料點（修正批次 B；決策 27）**：擬合對象的模型曲線（擬合曲線與預覽）用自己的角色色 `ChartTheme` 的 `modelCurve`（墨色：淺色 #1D1D1F、深色 #F5F5F7），線寬 2 px，圖例有一項「模型」；其他檔的曲線仍是各自的系列色、1.5 px。資料點空心（填色透明、外框 1 px），半徑 2（擬合對象）／1.5（其他）。誤差棒畫在資料點之前，不透明度取自主題的 `errorBarAlpha`。
- 疊圖：沿用 8 色系列，第 9 組起重複色並改虛線；有擬合結果者畫曲線。圖例精簡（小標記、靠左），超過 6 組時隱藏（檔案清單已有色樣）。
- **預設軸範圍**：x 軸取資料的 q 範圍（預覽用較寬的網格時不把軸撐開）；Guinier 預設只看低 q——到擬合對象的強度降到低 q 水準的十分之一為止，且不超過擬合範圍上限，y 軸取窗內資料的範圍。縮放中換資料不動使用者的視野；「重設縮放」回到當時資料的預設範圍。
- **擬合範圍**：範圍外灰色之外，再加兩條虛線（`reference` 角色）——只靠灰色的對比是 1.25:1，遠端桌面下看不出來。
- 殘差圖：r_i（§4.8），y 軸標題「(I − I模型)/w」，x 軸跟隨主圖模式（log-log、Kratky、Porod 用 q；Guinier 用 q²）；只畫擬合對象。沒有殘差時整張圖收成一行「尚無擬合結果」。
- **縮放（chartjs-plugin-zoom 2.2.0；決策 28）**：Ctrl＋滾輪或兩指縮放、拖曳框選放大、Shift＋拖曳平移；**單純的滾輪捲動頁面**（圖是 sticky 的大區塊，滾輪被它吃掉就捲不動參數表）。「重設縮放」只有縮放中才可按，狀態列此時寫「已縮放」；圖下有一行操作說明。PNG 匯出一律淺色白底。「主圖 PNG」「殘差 PNG」兩顆按鈕與操作說明同一列（圖下，M4）；3D 的 PNG 在 3D 卡的標題列，趨勢圖的在序列分段；四者都經 Blob＋object URL 下載（Chart.js 的 data URL 先解成位元組，不 fetch）。對數橫軸在繪圖區窄於 260 px（手機）時只留約 4 個刻度文字，不互相重疊。
- **canvas 的替代文字**帶著結果：主圖「N 組資料，模式…，擬合對象：…，模型 …，約化 χ² 1.02（已收斂），擬合範圍 q …」；殘差圖「… 的殘差，N 點，範圍 a 至 b，|殘差| > 3 的有 k 點」。
- **暫停的預覽有三種狀態**：尚未更新「即時預覽已暫停（多分散網格過大），曲線尚未更新；按「更新曲線」重算」→ 計算中「計算中…」→ 已手動更新「曲線已更新（手動）；再改參數後需再按「更新曲線」」。「預覽以 N 點計算」只在它描述的就是畫面上那條曲線時出現。

### 5.7 M2 審查對介面的要求（M3 必須實作）

M2 的科學審查與程式審查（2026-11-18）指出，下列情況擬合器與 Worker 都如實回報了，但只有介面能讓使用者看懂。M3 實作擬合分段與參數表時逐條落實，並各有測試。

**結果的呈現**
1. **χ²ᵣ 永遠與狀態並列顯示**。**權重＝資料 σ 時**，χ²ᵣ 很大（> 10）加上醒目的提示：「χ²ᵣ 遠大於 1：模型與資料不符。可能停在局部極小值（請換起始值重試）、模型不適用，或資料誤差被低估。此時參數誤差沒有參考價值」；χ²ᵣ < 0.1 時提示「χ²ᵣ 遠小於 1：資料的誤差可能被高估，或自由參數過多」。其餘三種權重下這個量不是 χ²ᵣ（決策 24，§5.4）：不出這兩則提示，狀態標記的顏色只看狀態與旗標（`illConditioned`、`jacobianNonFinite`、曲線有非有限點、數值非有限都會把「已收斂」降為警告，四種權重相同）——M3 科學審查實測：不加權時一個正確的擬合得到 117，|I| 權重下零模型恰好得到約 1。原因：LM 只保證到達附近的極小值——起始半徑偏 20%、範圍涵蓋多個振盪條紋時，會以 `'converged'` 停在 χ²ᵣ 約 10³ 的地方（bumps 的行為相同）。「已收斂」不等於「擬合得好」。
2. `iterations === 0` 要標出來（起始點已是極小值，或一步都走不動），不可與一般的收斂混在一起。
3. 三種旗標各有**不同的訊息**，不可共用同一句：
   - `status: 'failed'` 且 `blockedByNonFinite`：「在這組參數附近模型無法計算」（並提示改起始值或上下限）。
   - `jacobianNonFinite`：誤差算不出來（指出哪些參數的誤差是空的；其餘參數的誤差是把那些參數固定後算的，偏小）。**不是**「參數相關性過高」。
   - `illConditioned`：「參數無法由資料獨立決定（彼此高度相關，或某個參數對曲線幾乎沒有影響），誤差不可靠」。
4. `nonFiniteCurvePoints > 0` 時顯示「模型曲線有 N 點無法計算」。
5. 參數貼在邊界上（`atBound`）時，它的誤差欄標「貼上限」或「貼下限」（窄欄只寫哪一邊），結果磚寫「貼上限，誤差無意義」，並有一則提示列出這些參數（數字仍是有限值，算法與 bumps 相同，見 §4.9）；該參數的明細列自動展開。
6. 由 `correlation` 顯示強相關的參數對（|相關係數| > 0.98），例：「radius 與 thickness 高度相關（−0.99）」。
7. `status: 'maxiter'` 時提供「從目前的值繼續擬合」（以結果的 `params` 為新的起始值再送一次）。
8. 「已乘 √均方」的標示必須讓人看得出：此時顯示的誤差與 SasView 顯示的誤差相差 √(加權殘差均方) 倍（SasView 一律顯示未乘的值）；滑鼠提示或說明文字寫出換算（文字見 §4.9 顯示規則）。
9. 錯誤訊息的 `detail`（技術細節）寫入 `console.warn`，畫面只顯示 `message`。Worker 無法啟動（`WORKER_START_FAILED`）與異常結束（`WORKER_CRASH`）用各自的訊息（§12）。

**擬合前的防呆**
10. 選用 hayter_msa 時顯示 §16 的提示；`charge` 的預設下限要明顯大於 0（例：0.5）——charge＝0 時 `hayter_msa.c` 整條曲線回傳 NaN。
11. 權重為 √|I| 或 |I|、而擬合範圍內有 I ≤ 0 的點時提出警告（I＝0 的點被排除；I < 0 的點以 |I| 當權重，接近 0 的負值權重極小、會主導擬合）。只計算其他條件都有效的點：官方檔 σ＝0 的列（§4.8）不在其中，另以一則說明交代。權重選單旁顯示每一種權重會排除幾點（`SasFitWeighting.countExcluded`）。
12. 某個 PD 寬度被勾選擬合、而目前值為 0 時，起始值改用小的正數（0.05）：從恰好 0 出發，第一步可能直接跳到上限（bumps 的行為相同）。
13. 缺 σ、或 σ 欄沒有任何可用值的檔案，權重預設「不加權」並提示（`SasFitWeighting.defaultMode`，§4.8）。

**修正批次 A 新增（M3 審查，2026-11-18）**
14. 顯示的誤差 ≥ |數值| 的擬合參數（貼邊界者除外，它有自己的提示）列在一則警告提示「下列參數的誤差大於數值（與 0 無法區分，或無法由這組資料決定）：…」（提示 id `undetermined`，§5.4 數字格式第 2 點）。
15. 圖區狀態列說明點為什麼沒畫：log-log「N 點 I ≤ 0 或無效，對數軸無法顯示（不影響擬合）」、Guinier「…Guinier 座標（ln I）無法顯示（不影響擬合）」、Kratky 與 Porod（v5.7）「N 點的 q 或 I 不是有效數值，無法顯示」。
16. 開始擬合時若還有預覽在 Worker 裡計算，進度列先顯示「等待預覽完成…」，直到第一個進度或結果（不中止 Worker，否則已載入的 wasm 要重新載入）。
17. 擬合結果寫不進參數表時在擬合分段顯示錯誤提示，且不顯示「參數已改動」。

**修正批次 B 新增（UI 審查，2026-11-19）**
18. **第一次擬合的引導**（預設只勾 scale 與 background，這一點不變）：模型有尺寸參數（P 的參數中單位是 Å、不是 SLD 也不是取向的；`SasFitJobs.sizeNames`）而一個都沒勾時，擬合前出一則說明（提示 id `fixed-size`）「尺寸參數（radius）目前固定，只擬合 scale 與 background；要擬合尺寸請到「模型」勾選」。擬合後 χ²ᵣ > 10（權重＝資料 σ）且有未擬合的尺寸參數時，第 1 點的提示後面接「也可能是尺寸參數被固定：radius 沒有勾選擬合，請換起始值，或到「模型」勾選要擬合的尺寸參數」。擬合列的摘要點名要擬合的參數。
19. **狀態不只靠顏色**：有疑慮的「已收斂」在文字裡說出原因——「已收斂・約化 χ² 偏大」「已收斂・約化 χ² 偏小」（只在權重＝資料 σ）、「已收斂・有警示」（旗標或數值非有限，四種權重相同）；主角磚、擬合列、檔案清單與 canvas 的替代文字都用這個文字（`SasFitHints.statusLabel` 的 `text`／`short`）。

## 6. 3D 結構示意圖（`sasfit-shape-geom.js`、`sasfit-shape-view.js`、`sasfit-shape3d.js`）

位置：曲線卡下面的 3D 結構示意卡（§5.1；決策 42）。以下是 M4 實作並經審查修正後的內容（決策 37），選了結構因子時改畫顆粒群（§6.1；v5.8，決策 43）。

- 自寫 Canvas 2D 繪製器，不引入 three.js：網格 → **正交投影**（「按比例」與比例尺只有在正交投影下才處處成立）→ 背面剔除 → 依 `part` 與切面排序、由遠到近 → Lambert 明暗。預設視角方位 45°、仰角 20°，縮放以外接球為準（轉動時比例尺不變）。只在需要時重畫（參數或模型改變、互動、主題切換、尺寸改變）；「自動旋轉」開啟時才有動畫迴圈（≤ 30 fps），系統設定「減少動態效果」時停用。**只在畫面上時重畫**（v5.8）：舞台在視窗內（IntersectionObserver，`ctx.deps.observeVisible`）、本分頁顯示中、文件沒被隱藏才畫；不在畫面上時不畫、不排 frame（閒置時 rAF＝0），畫布保留上一張，回到畫面時補畫一次；自動旋轉在畫面外暫停。尺寸清單、說明與畫布的替代文字不論在不在畫面上都跟著參數（報讀軟體不會讀到舊的尺寸）。列印時不論在不在畫面上都以淺色重畫。
- **操作**：拖曳旋轉（物件跟著指標：向右拖方位角變小，向下拖仰角變大）；**方向鍵與拖曳同方向**（→ 方位角 −5°、← +5°、↓ 仰角 +5°、↑ −5°），＋／－ 縮放，0 或 Home 重設；**Ctrl＋滾輪**或兩指縮放（單純的滾輪捲動頁面，同決策 28）；縮放範圍 0.5–4，不提供平移。觸控：畫布 `touch-action: pan-y`，直接上下滑動是捲頁，先左右拖曳就交給頁面旋轉（兩個角度都可以）。畫布是 `role="group"`＋`tabindex="0"`，名稱「3D 結構示意」，操作說明（含鍵盤）以 `aria-describedby` 連到圖下看得見的那一行。
- 顏色只從 `chart-theme.js` 取：3D 角色色（實心／殼＝藍，核＝琥珀；兩主題各一組）與 `ChartTheme.shade3d(role, k, theme?)`。**顏色不對應 SLD，不畫溶劑。** `sasfit-shape*.js` 內沒有顏色字面值。主題切換時重畫；PNG 與列印一律淺色白底。
- 依目前參數**按比例**繪製；**尺寸不畫在 3D 圖上**：圖上只有比例尺（1–2–5 級距，nm），尺寸在圖下的文字清單（nm，1 位小數；參數表仍為 Å）。

| 模型 | 畫法 | 清單 |
|---|---|---|
| sphere | 實心球 | 半徑 R |
| ellipsoid | 旋轉橢球（極軸＝旋轉軸） | 極半徑、赤道半徑 |
| cylinder | 實心圓柱 | 半徑 R、長度 L |
| core_shell_sphere | 切掉 1/4 露出核／殼兩色 | 核半徑、殼厚、**外直徑** |
| vesicle | 切掉 1/4 的中空殼（`radius` 是內半徑；裡面是溶劑，不畫） | 內半徑、膜厚 |
| core_shell_cylinder | 切掉 1/4 的核殼圓柱；殼包住側面**與兩端**（sasmodels 的定義） | 核半徑、殼厚、核長度、總長 |
| flexible_cylinder | **沿中心線的粗線**（不是管狀網格：預設值下接點轉角 42°、步長比半徑短，網格會自己折疊），圓端、有輪廓線與高光；一個代表性構形 | 輪廓長度 L、Kuhn 長度 b、半徑 R |
| lamellar | 單一均勻薄板，厚度按比例、橫向只是示意（模型在橫向無限延伸，圖下註明） | 厚度 δ |
| 與形狀無關 5 模型 | 不畫；顯示「此模型沒有固定形狀」 | — |

- **蠕蟲鏈**：持續長度 l_p＝b/2，固定亂數種子（同參數畫出相同構形），**沒有排除體積**（`flexible_cylinder` 模型本身有）；狀態行與替代文字寫明「一個代表性構形」。步數＝clamp(round(8L/b), 16, 200)，每一步代表 ds＝L／步數 的輪廓。離散鏈必須在任何 L/b 下都有蠕蟲鏈的大小（科學審查：原先 ⟨t·t′⟩＝exp(−ds/l_p)，步數被 200 封頂後鏈太大，⟨Rg²⟩ 在 L/b＝300 是 1.7 倍、1000 是 5 倍）：ds < b 時每步長 ds，切線每步繞兩個橫向軸各轉一個高斯角，使 ⟨t·t′⟩＝α＝(2l_p/ds − 1)/(2l_p/ds + 1)（定長步、相關係數 α 的鏈有 ⟨R²⟩→2l_p L）；ds ≥ b（L/b ≥ 200）時改成粗粒化的自由連接鏈——每步方向均勻隨機、長 √(b·ds)，⟨R²⟩＝L·b，此時整體大小按比例、**畫出的輪廓比 L 短**，圖下註明「輪廓長度只是示意」。實測 ⟨Rg²⟩／蠕蟲鏈解析值（3000 個種子）：L/b＝10、50、100、300、1000 為 1.02、1.01、1.01、1.01、1.01。
- 多分散度不畫入幾何（有 S(Q) 時每顆顆粒都畫成中心值，見 §6.1），在圖下以文字標示，寬度照 sasmodels `weights.py` 的定義說：gaussian／schulz／rectangle 的寬度是 σ／中心值 →「半徑 R = 5.0 ± 0.5 nm（schulz）」；lognormal 的中心值是中位數、寬度是 ln 值的 σ →「半徑 R：中位數 5.0 nm，ln 值的 σ = 0.10（lognormal）」；uniform 的寬度是半寬／中心值 →「半徑 R = 4.5–5.5 nm（uniform）」；boltzmann 的寬度是 e 折長度／中心值，只寫寬度。S(Q) 的幾行見 §6.1。畫出來小於 2 像素的尺寸另有一句說明。
- 渲染上限：每物件 ≤ 4000 個面、整個場景 ≤ 8000 個面（顆粒群也是：§6.1 的面數預算）；後備解析度＝CSS 尺寸 × min(devicePixelRatio, 2)。

### 6.1 選了結構因子時：一群相同的顆粒（v5.8；決策 43）

模型是 `P@hardsphere` 或 `P@hayter_msa` 時，示意圖畫**一群相同的顆粒**，不再只畫一顆；沒有 S(Q) 時與 v5.7 完全相同。可以接 S(Q) 的形狀模型是 sphere、core_shell_sphere、vesicle、ellipsoid、cylinder、core_shell_cylinder（決策 6；flexible_cylinder 與 lamellar 沒有 F(q) 與有效半徑模式，sasmodels 不能接 S(Q)，所以沒有「每條鏈一個構形」的情形）。純模組 `sasfit-shape-ensemble.js`（排列、場景、文字）與 `sasfit-sq-derived.js`（有效半徑與 Debye 長度，移植自 sasmodels）。

- **R_eff** 就是模型交給 S(Q) 的那個數：模式 0 是使用者輸入的 `radius_effective`；模式 k ≥ 1 是該形狀模型 C 程式 `radius_effective` 的第 k 種定義，**有多分散時照計算核心的作法取網格平均**（各參數的權重相乘，乘積 ≤ cutoff 1e-5 的點不算，Σw·R／Σw）。逐一與本站 wasm 核心回報的值比對：6 個模型的 22 種模式 × 4 種多分散設定，相對差 ≤ 1e-12。
- **顆粒數 N＝12**。量測「兩顆以上顆粒在同一條視線上」的面積比例（預設視角加 20 個視角的平均）：球 φ 0.2 為 24%、φ 0.4 為 38%，圓柱（L／R＝20）4%，扁橢球（R_e／R_p＝20）23%，核殼圓柱 8%——細長顆粒以外接球擺放，並不比球擁擠，所以不減少。只有面數預算連最粗的網格都放不下時才減少（目前 6 個模型都不會）。
- **網格與面數預算**：`SasFitShapeGeom.build` 的 `detail`（fine 48×32、medium 24×16、coarse 16×12 等分）中最細、且 N × 面數 ≤ 8000 的一級（以預設尺寸的面數選級，面數不隨尺寸改變）：sphere、ellipsoid medium（12 × 384）、cylinder medium（12 × 144）、core_shell_cylinder medium（12 × 544）、vesicle medium（12 × 640）、core_shell_sphere coarse（12 × 528）。一格重畫（畫布 575×414，headless Chromium，devicePixelRatio 1，60 格）：核殼圓柱＋hardsphere（6528 面，畫 3240 個多邊形）中位數 4.6 ms、第 90 百分位 5.3–5.8 ms、最大 7.1–8.0 ms；面數最多的 vesicle＋hardsphere（7680 面，3456 個多邊形）5.3／6.3／8.3 ms；單一顆粒 1.6 ms。devicePixelRatio 2（headless 是軟體點陣化）時分別為 12.6、12.7 ms，單一顆粒 4.2–5.2 ms。
- **擺放**：任兩顆中心的距離 ≥ 2 R_place，R_place＝max(R_eff, 顆粒的外接球半徑)：外接球互不重疊，畫出來的顆粒絕不互相穿入（使用者輸入的 R_eff 比顆粒小時也一樣）。
- **按比例**：箱子使 N·(4/3)πR_eff³／V＝φ（φ＝S(Q) 用的 volfraction；vesicle 是它自己的）；換成以 R_place 為單位的堆積率 η＝φ·(R_place／R_eff)³。
  - η ≤ 0.30：**隨機排列**——固定種子（`SasFitShapeGeom.SEED`，mulberry32）在週期性箱子裡隨機循序加入，最小距離取 η＝0.30 時的值（隨機循序加入在 0.38 附近卡死；這個種子下 2–12 顆都在 1200 次嘗試內放得下）。**所有 η ≤ 0.30 用同一組點**：φ 改變只改箱子大小。
  - η > 0.30：**略為打亂的晶格**——sc、bcc、fcc 中站點數 ≥ N 且最密的一種（N＝12：bcc 2×2×2 的 16 個站點選 12 個，最密 η＝0.510），整個晶格轉一個固定的隨機角度（預設視角不會正對晶格的列），每顆自站點移動一個固定的隨機向量，長度按鄰居之間剩下的空隙縮放（隨 φ 連續變化，最密時為 0）；文字註明「顆粒很密：位置取自略為打亂的晶格（隨機擺放放不下），排列只是示意」（以外接球擺放時說「以外接球計算時顆粒很密：…」）。
  - η 超過晶格的最密值：以最密值畫（箱子比實際大），文字「體積分率很高，畫不出這麼密的排列：顆粒間距未按比例（實際更密）」；R_place > R_eff（細長顆粒以外接球擺放）時為「顆粒以外接球互不重疊地擺放，畫不出這麼密的排列：顆粒間距未按比例（實際更密）」——例：圓柱預設（R 20 Å、L 400 Å，R_eff 73.3 Å）在 φ 0.2 時 η＝4.1。
  - **太疏**：顆粒（外接直徑）在預設縮放下小於 28 px 時——以兩欄版面最小的畫布邊長 300 px 為準，不隨視窗改變，所以 1440×900 的畫布上至少約 39 px——把箱子縮到剛好 28 px，文字「體積分率很低，顆粒間距未按比例（實際更疏）」。sphere（R 50 Å）約在 φ < 0.03 時發生，hayter_msa 的預設 φ 0.0192 也是。縮小時兩顆仍不相碰（有下限）。
- **比例尺**永遠量顆粒的大小（整群的預設縮放以全部頂點的外接球為準，轉動時比例尺不變）。
- **取向**：各方向看起來都一樣的顆粒（sphere、core_shell_sphere、vesicle、R_p＝R_e 的 ellipsoid）不轉，切口與單一顆粒一樣朝向觀察者；細長的顆粒各自一個均勻隨機的旋轉（Shoemake 四元數，固定種子）。
- **穩定**：位置以 R_place 為單位、由固定種子產生：改半徑整張圖等比縮放，改 φ 只改箱子，換模型才重排。場景只在模型、尺寸、R_eff 或 φ 改變時重建（多分散、SLD、scale 不重建）。
- **繪製順序**：顆粒依中心深度由遠到近，每顆內部用單一顆粒的規則順序（視線轉進顆粒自己的座標）。兩個不相交的球，中心較近者在每一條同時穿過兩者的視線上都較近，所以這個順序在顆粒之間是精確的。測試：射線判定（每個畫面點對每顆顆粒以解析幾何求交、取最近的表面，含「哪一顆」）對 6 種顆粒群 × 40 個視角 × 71×71 點，與繪製清單最上層的多邊形 100% 一致（邊緣帶＝顆粒最小尺寸的 4%，排除粗網格的弦高差），核與切面的中央區域 100%（合計 222,079 個有顆粒的點、2,199 個中央點）；顆粒反序畫時過不了。
- **深度提示**只經 `ChartTheme.shade3d` 的 k：一顆顆粒的 k 乘上 1 − 0.25 × 它在群裡的深度（最近 0、最遠 1），遠的稍暗；沒有新的顏色。
- **文字清單**（尺寸之後）：「S(Q)：hardsphere 硬球，圖中 12 顆相同的顆粒，φ = 0.20」「有效半徑 R_eff = 5.0 nm，模式：半徑（radius）」（模式寫中文與 sasmodels 原名，模式 0 寫「自行輸入」）；hayter_msa 另一行「電荷 19.0 e，Debye 屏蔽長度 κ⁻¹ = 20.6 nm（由溫度、鹽濃度、介電常數與反離子算出，與 hayter_msa 相同；圖中不畫屏蔽雲）」；需要時再加未按比例或晶格的那一句；有多分散時「多分散：每顆顆粒都畫成中心值的大小」。R_eff 不是正數或 φ 不是有限值時只畫一顆，寫「R_eff 或 φ 不能用來排列顆粒，圖中只畫一顆顆粒」。替代文字加「；12 顆相同顆粒的排列（S(Q)：hardsphere）」。圖上不另加標籤。
- **κ⁻¹** 照 `hayter_msa.c`（sasmodels 1.0.12）的常數與運算順序：離子強度 I＝½e²(zφ／V_p＋2c_s·N_A·10³)，V_p＝(4/3)π(R_eff·10⁻¹⁰ m)³（反離子視為一價，鹽為 1:1），κ＝√(2βI／(ε_r ε₀))。與把該段 C 原文編成小程式（`cc -ffp-contract=off`）的結果逐位元相同；hayter_msa 預設（R_eff 20.75 Å、φ 0.0192、電荷 19、318.16 K、無鹽、ε_r 71.08）κ⁻¹＝33.24 Å，core_shell_sphere 預設（R_eff 70 Å）205.95 Å。只寫在文字裡，不畫屏蔽雲。
- 旋轉、縮放、重設、PNG（淺色白底）、鍵盤、觸控與自動旋轉都作用在整群。

## 7. 序列擬合（`sasfit-sequence.js`、`sasfit-seq-view.js`、`sasfit-seq-ui.js`）

M4 實作並經審查修正後的規則（決策 34–36、39）。

- **範圍**：序列分段的表裡勾選、且讀得出資料的檔（沒設定過的視為勾選）；沿用目前的模型規格、擬合勾選（含 PD 寬度）、上下限、權重、最大步數。官方檔與一般檔可以混用。
- **每檔的 Q 範圍**（決策 34）：使用者沒編輯過範圍時，**每個檔用自己的預設範圍**（`SasFitWeighting.defaultRange`）；編輯過則把要求的範圍截到該檔在這個權重下可參與擬合的首尾 q，並在該列註記；範圍內沒有點、或點數不多於自由參數個數的檔跳過並說明原因。
- **權重不因檔而異**：σ 權重下沒有可用 σ 的檔**跳過**並註記，不改用別的權重——同一張表、同一張趨勢圖不能混兩種擬合量度。
- 選項（預設皆開）：「以前一筆結果作為下一筆初值」「依條件值排序」（由小到大、同值維持清單順序；條件值空白者排最後並警告）。
- **初值規則**（開啟「以前一筆為初值」時；決策 35）：
  1. 來源是**最後一筆可用的結果**：已收斂、不是 `blockedByNonFinite`、不是 `illConditioned`、不是 `jacobianNonFinite`（任何權重），而且 σ 權重時 χ²ᵣ ≤ 10（`SasFitHints.CHI2R_WARN`）。未收斂、失敗或不可用的結果不更新它；沒有可用的結果時從表單的原始值出發。
  2. 只沿用**定得出來的參數**：畫面顯示的誤差是有限值且小於 |數值|（與畫面「誤差大於數值」的分類相同）；定不出來的參數從表單的原始值出發，該列註記「未沿用上一筆的 <參數>（上一筆未能決定，改用原始設定值）」。貼邊界的值照舊沿用（畫面不把它歸為未能決定）。
  3. 沿用的值經與單筆擬合回填相同的捨入；上下限、擬合勾選、多分散設定與模型永遠來自序列開始時的表單。
- 某筆失敗或未收斂：標記於該列，序列不中斷。Worker／wasm 層級的錯誤、或狀態寫不進去時中止整個序列；原因留在序列分段（§5.5）。
- 進度：第 k／N 筆（每筆開始與結束時更新）＋該筆的步數與量度；朗讀區只在開始、每筆結束（最多每 2 秒一次）與結束時更新。「停止」立即結束，已完成的結果保留。**不做續跑**：再按執行就重新開始（決策 36）。
- **結束後**（完成或停止）：擬合對象若在這次序列中完成，把它的結果寫進參數表並清掉「還原擬合前的參數」，頁面才不會把使用者沒動過的表單稱為「參數已改動」；否則不動表單，提示可逐列載入。
- 結果表與註記列見 §5.5；「載入」把該檔設為擬合對象，表單＝**序列開始時的表單快照**＋該列的擬合值（FitResult 不記上下限與勾選，而且頁面上的表單此時可能已是別的模型）。
- 趨勢圖：y 軸可選各擬合參數或量度，x 軸為條件值（全部沒有條件值時改用序號並註明），誤差棒取畫面顯示的誤差（貼邊界的值與量度沒有誤差棒）；未收斂的點是三角形；失敗、跳過、未完成、沒有條件值或非有限的點不畫並計數說明。
- 每組資料的 FitResult 存在 `datasetId → FitResult` 映射（單筆與序列共用）；序列另在自己的列裡留著**那一次序列的結果**。序列之後某個檔被單獨重新擬合時，序列表、趨勢圖與序列 CSV **仍顯示序列自己的結果**，該列多一則「已單獨重新擬合」的註記（決策 39）——單筆擬合可能用了另一種權重或範圍，混在一起就不是同一個量度。

## 8. IUCr 表格整合（`sasfit-iucr.js`、`section-iucr.js`）

- **可送出的條件**（決策 32）：`status === 'converged'`、權重＝資料 σ、不是 `blockedByNonFinite`、而且結果仍與參數表相符（`resultMatchesForm`）——送進投稿表格的必須是畫面上的參數。不符合時按鈕停用並以一句中文說明原因（例：「只有以資料 σ 加權的擬合可以送進 IUCr 表格（其他權重沒有公認的適合度統計量）」）。警示（貼邊界、`illConditioned`、`jacobianNonFinite`、強相關、誤差大於數值、χ²ᵣ > 10、曲線有非有限點）不擋送出，寫進 Notes。其他權重的擬合仍可匯出 CSV 與 TXT。
- 「送進 IUCr 表格」寫入 `AppState.sasfitData`（新的凍結物件取代舊值；只在 `section-iucr.js` 的 `setIUCrModelFit` 一處寫入）：

```
{
  datasetName, model,               // model 例：'core_shell_sphere@hardsphere+power_law'
  structureFactorMode,              // 'P*S' | 'P*(1+beta*(S-1))' | null
  radiusEffectiveMode,              // 有效半徑的定義，或 null
  params: [{ name, value, error, errorScaled, errorShown, unit, fitted, atBound }],   // 含多分散寬度（unit＝分布名稱）
  measure: { isChi2: true, label: 'Reduced χ²', value },
  chi2r, errorsScaled: false, dof, qMin, qMax, npoints, weighting, status,
  assumptions: [text], notes: [text],
  software                          // 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v<頁面版本>'
}
```

  `software` 的版本由頁面版本導出，不寫死。`measure.isChi2` 恆為 true、`errorsScaled` 恆為 false（只收 σ 權重）；鍵留著給讀這個物件的程式。
- IUCr 頁在 Molecular-mass determination 之後的段落，標題 **「Model fitting (analytical scattering model)」**（決策 33；模型含結構因子與冪律項，不只是 form factor）。列：Data file｜Model｜Structure-factor combination（有 S(Q) 才有）｜各參數（Value、±、Unit；固定參數 ± 欄填 fixed，貼邊界填 at upper/lower bound；數字照 §5.4 的畫面格式）｜q-range for fitting｜Number of points｜Weighting｜Reduced χ²（值後附自由度，例 `1.02 (dof 54)`）｜Status｜Parameter errors (±)｜Assumptions｜Notes｜Software。元素 id 前綴 `iucr-sf`，參數名稱不會變成 id。
- **Assumptions**：每個開啟的多分散一句（分布、寬度是擬合或固定、點數、nsigmas，**並寫明該分布的寬度是什麼**：gaussian／schulz／rectangle＝σ/centre，lognormal＝σ of ln x、centre 是中位數，uniform＝half-width/centre，boltzmann＝e-folding length/centre）、f ≈ Z、S(Q) 的組合與有效半徑、hayter_msa 的限制、低 q 冪律。
- **Notes** 的第一句固定是 `Supplementary to the IUCr template; applies to the data file named here. CorMap P-value not computed.`，其後才是各項警示。**不列 CorMap P-value 的列**（本工具不計算；決策 33）。
- 列由 `SasFitIucr.rowsHtml` 產生，所有字串進 `innerHTML` 前經 `FormUtils.escapeHtml`。已送入的段落是英文的。
- 未送出前此段在畫面上顯示「尚未送入擬合結果」，但**空的段落不進「複製表格」**（否則這句話會被貼進投稿表格）。
- **「複製表格」**（決策 31）：內容取自表格的複本——q-range／Exposure time／Temperature 三個輸入框換成**目前的值**（文字節點），複製出去的 HTML 不留 `<input>`；HTML 與純文字兩種都帶。Clipboard API 不可用或被拒時的後備路徑（`execCommand('copy')`）以一次性的 `copy` 監聽器寫入同一份 HTML 與純文字，兩條路內容完全相同；`execCommand` 回報成功才顯示「已複製」。

## 9. 匯出（`sasfit-export.js`、`sasfit-report.js`、`sasfit-sasview.js`、`sasfit-export-ui.js`）

| 檔案 | 檔名 | 內容 |
|---|---|---|
| 擬合曲線 CSV | `<資料名>_<模型>_fit.csv` | 註解列，表頭 `q,I,sigma,I_model,residual,in_fit`，然後**每一個**資料點（含範圍外的）；`in_fit` 取 Worker 自己的選點（`SasFitWeighting.select`），不由殘差是否有限推斷 |
| 報告 TXT | `<資料名>_<模型>_report.txt` | 資料檔名與檔頭（能量與換算的波長、q_start、厚度、SF、透射率…）；模型、S(Q) 組合與有效半徑模式；多分散設定（分布、寬度、npts、nsigmas、cutoff）；各參數；χ²、量度、自由度、點數、q 範圍、權重；演算法與設定、迭代數、狀態與旗標、強相關；註記（f ≈ Z、hayter_msa、貼邊界、誤差大於數值）；軟體與版本；最後一段 `[SasView parameter text]`（v5.7，見下） |
| SasView 參數文字（v5.7） | 不是檔案：「複製 SasView 參數」寫進剪貼簿 | SasView「Edit → Copy Params／Paste Params」格式的一行文字（見下） |
| 序列結果 CSV | `<條件名>_sequence.csv` | 序列表的每一列（序列自己的結果，§7）：序號、檔名、條件值、各參數與顯示的誤差、量度、dof、迭代數、狀態碼與狀態文字、q 範圍、初值來源、註記 |
| PNG | `…_main.png`、`…_residual.png`、`…_shape.png`、`<條件名>_trend.png` | 主圖、殘差、3D、趨勢圖；淺色白底（深色主題下也是） |

- **數值**：匯出檔的數字一律 `SasFitExport.num`＝`String(x)`（讀回同一個 double 的最短寫法、與地區設定無關；NaN／±∞ 寫成空白）。報告 TXT 的參數另有一欄與畫面相同的「值 ± 誤差」（`SasFitFormat`），所以**每個參數有全精度與畫面格式兩種寫法**；誤差有未乘與乘 √量度 兩欄，並註明畫面顯示的是哪一欄。鍵名英文、說明句繁體中文。
- **量度名稱**照決策 24：σ 權重是 `chi2r`／Reduced chi-square，其餘是 `weighted_mean_square_residual`，並說明它不是 χ²ᵣ。
- **CSV**：RFC 4180 引號、UTF-8 BOM（Excel 才讀成 UTF-8）、換行 `\n`。註解列以「# 」開頭、**不加 CSV 引號**（加了就不是以註解字元開頭），值裡的逗號、分號、引號與控制字元換成底線；第 2 行寫明讀法（`numpy.genfromtxt(f, delimiter=",", comments="#", encoding="utf-8-sig")` 或 `pandas.read_csv(f, comment="#")`）。擬合曲線 CSV 另有一行說明殘差的定義：`# residual: (I - I_model)/w; w = sigma`（√|I| 權重是 `w = sqrt(|I|)`、|I| 權重是 `w = |I|`、不加權是 `w = 1`）。
- **文字儲存格**：以 `= + - @`、Tab 或 CR 開頭的文字前置單引號（公式注入防護）；含 `#` 的文字加引號（pandas 會在未加引號的 # 處截斷）；儲存格裡的換行換成一個空白（一列就是一行）。數字儲存格不處理（負數仍是數字）。
- **檔名**（`safeName`）：NFC；去掉路徑與**已知的資料副檔名**（`.dat`／`.txt`／`.csv`，不分大小寫；`sample.v2` 的 `.v2` 是檔名的一部分）；`\ / : * ? " < > |`、控制字元、雙向控制字元與落單的代理碼位換成底線；去頭尾的空白與點；Windows 保留名前置底線；以 UTF-8 位元組計上限 120。條件名稱不當檔名處理（`mg/mL` → `mg_mL`）。
- **報告的波長**以 hc ＝ 12.398 keV·Å 換算並印出算式（`12.398 / E`），與「SAXS 結構參數」頁同一個常數，兩頁顯示相同的波長（決策 38）。共變異的說明寫 `(J^T J)^-1`。
- **SasView 參數文字（v5.7；決策 41；`SasFitSasView`）**：擬合分段匯出列的第四顆鈕「複製 SasView 參數」，啟用條件與 CSV／TXT 相同（有結果、不在擬合中；結果與參數表不符時複製的是上一次擬合並註明）。同一段文字也寫在報告 TXT 的最後一段。
  - **格式**（取自 SasView 原始碼：6.1.0 的 `FittingUtilities.formatParameters`、`FittingWidget.getFitParameters／getFitPage／getFitModel／clipboard_paste／updatePageWithParameters／updateFullModel`、`PolydispersityWidget.gatherPolyParams／updateFullPolyModel`；5.0.6 的 `FittingWidget.py` 同名函式與 `onParameterPaste`）：列以「:」相接、欄以「,」相接，沒有跳脫，所以任何欄位都不能含這兩個字元；第一列是 `sasview_parameter_values`；貼上時只讀多於一欄的列。`model_name,<P>`；一般參數 `<名稱>,<True|False>,<值>,<誤差|None>,<下限>,<上限>,()`（6 欄；勾選＝擬合；`inf`／`-inf`；最後是空的限制式）；P@S 的兩個選項參數 `structure_factor_mode,None,<0|1>,None,,,()`、`radius_effective_mode,None,<k>,None,,,()`（值是選項的索引）；多分散 `<名稱>.width,<True|False>,<寬度>,<誤差|None>,<下限>,<上限>,<Npts>,<Nsigs>,<分布>`（8 欄）；`polydisperse_params,<True|False>`、`magnetic_params,False`、`2D_params,False`；`fitpage_model`／`fitpage_structure` 只是資訊（Edit → Paste Params 不會替使用者選模型）。結構因子不在 `model_name` 裡：P@S 的 `model_name` 是 P，參數兩者都列。模型自己定義的 `radius_effective`（模式 > 0）不寫。
  - **寫什麼**：值與誤差全精度（`SasFitExport.num`）；誤差一律是**未乘**的 1 σ（`FitResult.errors`，SasView 自己的算法；權重不是資料 σ 時說明裡註明本頁顯示的是已乘的值），貼邊界或非有限時寫 `None`；上下限取自參數表（模型已換時用模型預設值並註明）；每個開啟的多分散照這次擬合實際用的寬度、Npts、Nsigs、分布寫（本頁預設 gaussian 35／3、schulz 與 lognormal 80／3，與 SasView 的 80／8 不同，絕不留給 SasView 的預設）；有任何多分散開啟時，其餘可多分散的參數寫成寬度 0 的列（文字與 SasView 新表格相同，貼上不會改動它）。只寫數字與通過白名單／識別字規則的名稱，不含檔名或使用者輸入的文字。
  - **不能表示就停用**：低 q 冪律附加項（SasView 沒有對應的內建模型）、不在清單內的模型／結構因子／分布、非有限的參數值——按鈕停用，原因寫在按鈕下方（中文）。
  - **已對真的 SasView 6.1.0 驗證**（本機 `/Applications/SasView6.app`，以它自己的 `FittingWidget` 無頭執行，貼上後從 kernel 讀回）：13 個形狀因子單獨與配兩個結構因子共 25 種組合，參數名稱、順序、可多分散的參數、有效半徑模式清單與預設值都與本頁相同；貼上後每個參數的值、擬合勾選、上下限與兩個模式選項都正確。**SasView 自己的限制**（按下後的說明與報告會列出與該筆擬合有關的幾項）：(1) 貼上的數值只取 5 位有效數字（`%-7.5g`），誤差欄不讀；(2) 6.x 選了結構因子時不貼 `background`（`_n_shells_row` 剛好指到那一列），要手動輸入；(3) 6.1.0 及更早版本不貼分布類型，要在貼上前先選；(4) **6.1.0** 的多分散表格把 Npts／Nsigs 的任何變動（手動輸入、選分布或貼上）寫進計算用的 PD **寬度**，Npts／Nsigs 本身不生效（`PolydispersityWidget.onPolyModelChange` 一律寫 `<名稱>.width`；實測：選 schulz 後 kernel 的寬度變成 8）——貼上後要把寬度改成別的值再改回來，Nsigs 與 SasView 預設不同時兩邊曲線會有差異。5.0.6、6.0.0 與 6.1.0 之後的開發版只讀過原始碼、沒有實際執行：5.0.6 與 6.0.0 把 Npts／Nsigs 寫到正確的鍵，開發版也已修正並會貼上分布類型；5.0.6 沒有第 2 項，6.0.0 有。
  - **剪貼簿**：`navigator.clipboard.writeText`，不存在或被拒時改用隱藏的 `<textarea class="sr-only">`＋`execCommand('copy')`；兩者都失敗時在 `#sfExportNote` 說明並指向報告 TXT。
- 下載一律 Blob＋object URL（用完 revoke）；匯出不經 Worker、不重算，完全由已存的 Dataset 與 FitResult 組成。「已停止」的結果沒有曲線，不能匯出。

## 10. 建置流程（repo 根目錄 `tools/sasfit/`，不部署）

- Python 環境：`tools/sasfit/requirements.txt` 鎖定 `sasmodels==1.0.12`、`bumps==1.0.4`、`periodictable`（Phase 0 鎖版）；`README.md` 說明建立方式。
- emscripten：官方 **emsdk** 安裝於 repo 外（`~/emsdk`），版本於 Phase 0 選定後鎖定並寫入 README 與 `manifest.json`。不用 Homebrew（會自動升級、會拉入 openjdk）。
- `gen_meta.py` → `js/sasfit-meta.js`（檔頭：自動產生、勿手改、產生器與 sasmodels 版本）。
- `build_wasm.py`：**重現 `kerneldll.make_dll` 的前處理**——`source = generate.convert_type(generate.make_source(info)['dll'], F64)`（前置 `#define FLOAT_SIZE 8`、修正 tgmath 整數參數）；腳本斷言前處理後原始碼以 `#define FLOAT_SIZE 8` 開頭。編譯旗標比照 `kerneldll` 的 unix 預設 `-std=c99 -O2`；**不用 OpenMP、不用 `-ffast-math`** 等改變 IEEE 語意的選項；standalone、無 JS glue、匯出 `<model>_Iq` 與記憶體配置函式。產出 `saxs-calculator/wasm/sas-<model>.wasm`＋`manifest.json`。
- `gen_reference.py` → `saxs-calculator/tests/fixtures/sasfit/*.json`：sasmodels 強制 DLL 雙精度、不走 OpenCL（`SAS_OPENCL=none`）；**每個呼叫都明確傳 cutoff**（G1、G4 用 1e-5；G3 用 sasmodels `model_test` 的 0）——不得依賴 `DirectModel`／`Experiment` 的建構子預設。參考值所用的原生 DLL 以 `-ffp-contract=off`（嚴格 IEEE、不合併乘加）編譯，放在專用快取 `tools/sasfit/build/dll-nofma/`，設定集中於 `tools/sasfit/sas_env.py`（見 §15 決策 18）。
- 只有新增模型或升級 sasmodels 才需要重跑 `build_wasm.py`；改 JS 不需要 emsdk。產物（meta、wasm、fixtures）皆提交進 repo。

## 11. 測試與驗證

全部接入 `node --test saxs-calculator/tests/*.test.js`（Node 直接 `WebAssembly.instantiate` 讀 wasm 檔）。

| 門檻 | 內容 | 通過標準 |
|---|---|---|
| G1 | wasm＋調度層 vs sasmodels（cutoff＝1e-5）：每模型預設值；每個可多分散參數 × {gaussian, schulz(nsigmas 3), schulz(nsigmas 8, 寬度 0.3 與 0.4)}；6 個可接 S(Q) 模型 × {hardsphere, hayter_msa} × {P*S, β}；有效半徑各模式；vesicle@S 的 volfraction 例外；低 Q 冪律和模型。q 網格：1e-3–1 Å⁻¹ 對數 200 點。**P@S 案例分兩層**：元件層——有效半徑、體積比、殼層體積，以及把參考有效半徑代入後的 I(q) 與 S(q)——用同一條 1e-9 規則；端到端 I(q) 用 1e-7（見 §15 決策 19）。**M1 審查後追加三組**（fixture 標籤前綴）：`hmsa:`——hayter_msa 的 charge、temperature、concentration_salt、dielectconst、volfraction 取非預設值（預設的鹽濃度是 0）：8 個 P@hayter_msa（sphere、core_shell_sphere、ellipsoid、cylinder × 兩種組合方式，部分帶多分散）**只在元件層把關**（有效半徑、體積比、殼層體積，與代入參考有效半徑後的 I(q)、S(q)，皆 1e-9），端到端只確認算得出來並回報差異，不設門檻（§16）；另 4 個單獨的 hayter_msa S(q)，q 網格自 2qR＝0.15 起算，嚴格 1e-9。`dist:`——lognormal、rectangle、uniform、boltzmann 經 kernel 的多分散（sphere 的 radius、cylinder 的 length，共 8 個）。`pd3:`——三個參數同時多分散、各 8 點、混用分布（core_shell_cylinder、flexible_cylinder），512 個網格點分 6 段。合計 167 個案例：159 個有端到端門檻，8 個僅元件層；測試分開計數，不得默默略過 | \|Δ\| ≤ 1e-9·\|ref\| + 1e-12·max\|ref\|；P@S 端到端為 1e-7·\|ref\| + 1e-12·max\|ref\| |
| G2 | 手寫 JS（guinier_porod、power_law） | 同 G1 |
| G3 | sasmodels 內附官方測試（清單 15 模型）：**只跑 1D、非磁性案例**；包含 `@S` 乘積測試與 Fq 多輸出測試（F、F²、R_eff、V、form:shell 比值）。轉接層用 sasmodels API 預設（`_pd_n`=0、`_pd_nsigma`=3、`_pd_type`=gaussian、cutoff＝0），與 UI 預設分開 | sasmodels 自身容許誤差 |
| G4 | 擬合器 vs bumps lm（`Experiment(..., cutoff=1e-5)`、`FitDriver` 的 cov／stderr）：每類各 1 組合成資料（sasmodels 產生＋固定種子高斯雜訊），同初值；含 1 組擬合 PD 寬度的案例，另加低 Q 冪律、觸及上限與下限各 1 組、三種非 σ 權重，共 12 組；**M2 審查後追加 7 組**（標籤 10a–13）：含髒點的資料（150 點，其中 σ＝0 四點、σ<0 一點、I＝0 兩點、I ≤ 0 共 10 點）分別以四種權重擬合——fixture 存完整的髒資料與應參與的點數 `nUsed`（145／148／148／150），產生器先套用本站的遮罩規則再交給 bumps，JS 測試同時驗證遮罩點數與自由度；兩端都收窄的 Q 範圍 1 組；貼上限而其餘自由參數為非線性的 core_shell_sphere 1 組；sphere@hayter_msa（擬合 radius、charge、volfraction，charge 範圍 [1, 100]，R＝30 Å 的良性參數區）1 組。合計 19 組，原 12 組的位元組不變。**參數的比較基準是「精修後的真正極小值」**：bumps `lm` 的結果再以 `scipy.optimize.least_squares`（三點差分 Jacobian、容許值 1e-15）精修，貼在邊界上的參數固定在邊界；誤差、共變異、Jacobian、殘差都在精修後的點用 bumps 的 `lsqerror` 重算（§15 決策 20）。原始的 bumps 結果另存為 `bumpsRaw`，產生器（`tools/sasfit/gen_reference_fit.py`）斷言它與精修值相差 < 0.02σ、每案確實收斂、貼邊界者恰等於邊界，並印出每案的實際差距 | 對精修值：參數差 < 0.01σ（σ＝精修點的 bumps stderr）；誤差相對差 ≤ 2%；χ²ᵣ 相對差 ≤ 1e-3 |
| G5 | data-io 與 weighting：合成官方格式檔與一般檔（公開 fixtures）；真實 `.dat`（`tests/fixtures-local/sasfit/`，已被 `.gitignore` 擋，缺檔即 skip）；四種權重的 w_i、可參與點判定與 `defaultRange` | 檔頭欄位、點數、清理標記、預設範圍、條件值正確 |
| G6 | SLD：化學式解析與數值 vs periodictable 的原子量與 Z 獨立計算（例：水 1.0 g/cm³ ≈ 9.420×10⁻⁶ Å⁻²） | 相對差 ≤ 1e-6 |
| G7 | 站內既有測試全部綠燈；`result-golden` 與 `markup-v4.15` fixture 不得重產；守門測試只依 §3.3 修改（含 markup 區段規則與 Worker 清單測試）；版本號一致 | 全過 |
| G8 | Playwright（本機 http.server，text-to-cad venv）：無 console 錯誤；載入合成 `.dat`→預覽→擬合→序列（3 組）→送 IUCr→複製表格→各匯出→3D 渲染非空；淺／深兩主題 axe 0 違規；Worker 與 wasm 請求網址帶 `?v=` | 全過 |

- 效能：Phase 0 量測最重組態（core_shell_cylinder＋兩個多分散參數、400 點）的單次評估與一次典型擬合時間，寫進報告；據此訂定預覽／擬合的效能預算，超出者以「計算中…」與進度呈現。
  - **瀏覽器實測**（M2，`tools/sasfit/smoke_browser.py`，headless Chromium、Worker 內、每次 400 個 q 點）：sphere＋schulz 多分散 80 點 0.4 ms；cylinder 單參數多分散 35 點 24 ms；cylinder 兩參數各 35 點（35×35）755 ms；3 個參數的 sphere 擬合全程 3.6 ms。
  - **A 版的處理方式**：只用一個 Worker，不做多 Worker 平行。球形類與單參數多分散遠低於 300 ms 的預覽門檻；只有「兩個參數同時多分散的圓柱類」超過（單次約 0.75 秒，一次擬合數十秒），以進度（每個被接受的步回報 χ²ᵣ）與「停止」處理，預覽顯示「計算中…」。多 Worker 分 q 平行列為 B 版候選（§16）。
- 科學審查：science-reviewer 審 weights／kernel／product 移植、SLD 公式與預設物質、誤差慣例、權重與清理規則。
- 程式審查：每任務規格＋品質雙審；收尾 code review（CRITICAL／HIGH 必修）。

## 12. 錯誤處理

| 情況 | 行為 |
|---|---|
| 檔案無法解析 | 該檔列顯示原因與行號（最多列 5 則，其餘以「另有 N 行」表示；每檔最多收集 50 則）；其他檔照常 |
| 檔案超過上限（5 MB、100 000 點、合計 2 000 000 點） | 該檔不加入，該列說明原因；其他檔照常（§4.8） |
| 某個分段重繪時丟出例外 | `console.error` 記錄，頁面頂端顯示「畫面更新時發生錯誤，部分內容可能不是最新的；請重新整理頁面後再試」；其餘分段照常重繪，分頁鈕仍可用 |
| 檔案被拖到拖放區以外 | 本分頁顯示中時取消瀏覽器的預設行為（不會離開頁面） |
| 擬合結果寫不進參數表 | 擬合分段顯示錯誤提示；結果照常顯示，不顯示「參數已修改」 |
| 可參與擬合的點 ≤ 自由參數數 | 擬合按鈕停用並說明 |
| wasm 載入失敗（網路、MIME、`file://`） | 擬合頁顯示原因與解法；其他分頁不受影響（wasm 只在本頁載入） |
| Worker 異常結束（`WORKER_CRASH`） | 提示、下一個請求時自動重建、可重試 |
| Worker 無法啟動（`WORKER_START_FAILED`：無法建立 Worker、Worker 腳本或某個 `importScripts` 模組載入失敗） | 擬合頁顯示「計算執行緒無法啟動」與解法（確認網路、重新整理）；`detail` 含失敗的網址；下一個請求會再試一次，不會無限重試 |
| 擬合被算不出來的區域擋住（`status: 'failed'`、`blockedByNonFinite`） | 結果照常顯示（目前最好的參數與 χ²ᵣ），標「在這組參數附近模型無法計算」，建議改起始值或上下限（§5.7） |
| 最後的 Jacobian 有算不出來的欄（`jacobianNonFinite`） | 該參數的誤差顯示為空並說明；其餘誤差照常顯示並註明偏小。不使用 `illConditioned` 的訊息 |
| 模型曲線有非有限點（`nonFiniteCurvePoints > 0`） | 顯示點數；這些點不畫 |
| 模型輸出 NaN／Inf | 擬合時拒絕該步；預覽時依非有限點的多寡分兩種：**全部點**非有限時曲線不更新並提示「這組參數算不出模型曲線，請檢查數值」；**部分點**非有限時畫出其餘的點（非有限處留空），並在圖區狀態列顯示點數「模型曲線有 N 點無法計算」（決策 22） |
| 奇異值被代換（§4.9，`illConditioned`） | 誤差照常顯示並標「參數無法由資料獨立決定（彼此高度相關，或某個參數對曲線幾乎沒有影響），誤差不可靠」；誤差 > 1000·|數值| 時誤差寫「無法決定」 |
| 未收斂／觸及邊界 | 結果照常顯示＋狀態標記 |
| 輸入不合法 | 欄位層級錯誤訊息；不送預覽、不允許擬合 |
| 點數超過上限：單一參數的多分散取點 `*_pd_n` > `MAX_PD_POINTS`（1000）、多分散網格總點數（各參數取點數的乘積）> `MAX_EVAL_POINTS`（1e6）、q 點數 > `MAX_Q_POINTS`（1e6）或為 0；`*_pd`、`*_pd_n`、`*_pd_nsigma` 不是有限數 | 計算核心在配置任何緩衝區之前丟出指名該參數與上限的 Error（常數在 `SasFitValidate`）；介面轉成欄位層級錯誤訊息，不送預覽、不允許擬合。上限內 `*_pd_n` 沿用 sasmodels 語意（`int()` 截斷；不足 2 點＝只取中心值） |
| wasm 執行期錯誤（trap、記憶體不足） | 計算核心丟出 `wasm kernel <模型> failed: …`（保留 `cause`）；該 wasm 實例視為不可再用，Worker 重新載入後才可重試 |

錯誤訊息一律使用者可讀（中文），技術細節寫入 `console.warn`；不吞錯。

## 13. 安全與 CSP

現行 CSP（2026-11-17 實查）已滿足需求，**不需修改**：`script-src 'self' … 'wasm-unsafe-eval'`（WebAssembly）、`connect-src 'self' …`（fetch 本機 .wasm）、`worker-src 'self' blob:`（本機 Worker；`importScripts` 皆同源）。新程式不得使用行內 script、`onclick=""`、`eval`；所有來自檔案名稱、檔頭、使用者輸入的字串進 `innerHTML` 前經 `FormUtils.escapeHtml`。

## 14. 開發順序與發佈

1. **Phase 0（可行性閘門）**：安裝並鎖定 emsdk；依 §10 前處理編 sphere、cylinder、hayter_msa；在 Node 跑出 G1 等級一致性；量測效能。產出簡短報告。
   - 通過→進入正式實作。
   - 某模型無法編譯或無法達 G1→該模型退回手寫 JS（方案二），**先回報使用者再繼續**。
2. 正式實作，依里程碑（每個里程碑結束時全測試綠燈）：
   - 通則：每新增一個 `sasfit-*.js`（Worker 入口除外），**同一個任務內**就加入 `index.html` 的 `<script>`（依 §3.3 順序、帶 `?v=`）與 `tests/load.js` 的 `LOAD_ORDER`，否則既有的 structure 測試會失敗。
   - M1 計算核心：meta、weights、kernel、product、py-models、evaluate、全部 15 模型的 wasm；G1–G3。
   - M2 Worker＋擬合器：weighting、worker-core、worker、worker-client、fitter（含 Jacobi SVD）；G4；structure 測試的 `WORKER_ONLY`、Worker 清單與版本機制測試（§3.3 第 1 點）與 Worker 入口同一任務加入。
   - M3 資料／模型／擬合分段與圖區：data-io、sld、plots、section-sasfit；G5、G6；markup 區段規則（§3.3 第 2 點）與第一個新增的頁面標記同一任務加入。
   - M4 3D、序列、IUCr、匯出。
   - M5 E2E（G8）、版本 v5.3、合併、部署、線上冒煙測試。
3. 分支 `feat/sasfit`；版本 v5.3（footer `Version` 與所有本機 `?v=` 同步）。
4. 依使用者 2026-10-15 授權：規格與計畫核准後，實作→驗證→審查→合併→push→線上冒煙測試一路完成，最後一次回報；**新的科學判斷仍須詢問**。

## 15. 科學決策紀錄

| # | 決策 | 理由 | 日期／來源 |
|---|---|---|---|
| 1 | 計算核心＝sasmodels C 原樣（F64 前處理）編成 wasm（方案一） | 與 SasView 同一份程式碼、擴充 B 版成本低、速度 | 使用者 2026-11-17 |
| 2 | 權重＝資料 σ 時誤差不乘 √χ²ᵣ；報告兩種都列 | 13A 資料有實測 σ；與 bumps／SasView 一致 | 使用者 2026-11-17 |
| 3 | X 光 SLD 取 f ≈ Z | A 版夠用；f′ 表留 B 版 | 設計第 3 段，使用者同意 |
| 4 | 預設 Qmin 取 q_start 與首個可參與擬合點的較大者 | 避開 beamstop 區（實查 B1216 檔前段 I<0、σ=0） | 同上 |
| 5 | I < 0 但權重有效的點參與擬合、僅 log 顯示時隱藏 | σ 權重的 χ² 對負值無問題；刪點會偏差 | 同上 |
| 6 | S(Q) 僅開放 6 個有 Fq＋有效半徑模式的形狀模型；PD 只開 P 的尺寸參數 | 與 sasmodels product 能力對齊、避免無定義組合 | 同上 |
| 7 | 低 Q 冪律與模型共用 background | 等價 sasmodels 和模型，可驗證 | 設計第 3 段 |
| 8 | LM 預設 steps 200、ftol／xtol 1e-10 | bumps 1.0.4 實查預設 | 同上 |
| 9 | IUCr 需手動送出 | 試錯擬合不覆蓋表格 | 設計第 4 段 |
| 10 | 3D 自寫 Canvas | 避免 600 KB 以上的 three.js 與模組／CSP 成本 | 設計第 2 段 |
| 11 | 不支援 `file://` | 使用者確認不會這樣開 | 使用者 2026-11-17 |
| 12 | 權重四種照 SasView（√\|I\|、\|I\| 取絕對值），w=0 的點排除 | 與 SasView 一致、定義完整 | 審查第 1 輪 |
| 13 | PD 寬度可擬合，預設上界 0.4 | 使用者 NTT-04 經驗：放開但綁上界避免發散 | 使用者 2026-11-17 |
| 14 | schulz、lognormal 的 nsigmas 預設 3（sasmodels 為 8） | 使用者 SasView 6 實測：8 會低 q 發散；3 時與 SasView GUI 逐點相同 | 使用者 2026-11-17 |
| 15 | 多分散積分 cutoff 預設 1e-5 | 與 SasView GUI、bumps、DirectModel 預設一致，曲線可與 SasView 對照；較快 | 使用者 2026-11-17（更正先前「direct_model 預設 0」的錯誤前提） |
| 16 | 權重非資料 σ 時，顯示誤差乘 √χ²ᵣ 並標明 | 此時 σ 未知，不乘的誤差量級無意義（bumps 文件建議） | 使用者 2026-11-17 |
| 17 | 共變異算法照 bumps（前向差分 1e-4·\|p\|、SVD 奇異值下限 1e-8） | 讓誤差與 SasView 顯示一致 | 審查第 1 輪 |
| 18 | 參考值以關閉 FMA 的編譯產生（嚴格 IEEE） | WebAssembly 沒有 FMA；arm64 編譯器預設合併乘加，hayter_msa 在低 q 的條件數使兩者差到 3e-9。關閉後原生與 wasm 逐位元相同（194/200 點）；門檻維持 1e-9。關閉 FMA 只拿掉一個捨入來源：hayter_msa 在 2qR < 0.1 的條件數仍在 1e-9–1e-8（wasm 與原生的 libm 差 1 ulp 就會顯現——實測 R＝29.8 Å、volfraction 0.15 時，同一組輸入在 2qR＝0.09 差 1.3e-9），所以單獨的 hayter_msa 參考案例刻意避開最差區域（q 自 2qR＝0.15 起算），P@hayter_msa 的元件層案例也選在裕度足夠的參數 | 2026-11-18 M1 Task 4 實測；M1 審查補充 |
| 19 | P@S 的 G1 分兩層：元件層 1e-9，端到端 1e-7；P@hayter_msa 取非預設 S 參數時只做元件層 | JS 多分散權重與 numpy 差在第 14 位，有效半徑無法逐位元相同，而兩個結構因子對有效半徑的敏感度不同。**hardsphere 是輕微的一邊**：hardsphere.c 在 2qR≈0.05–0.13 有相消誤差，有效半徑差 1 ulp 使 S(q) 變動約 2e-9（原生 sasmodels 實測 2.3e-9），端到端 1e-7 有充分裕度。**hayter_msa 是嚴重的一邊**：上游程式在低 q 數值不穩定（§16），1 ulp 可使 S(q) 變動到 4.5e-4、甚至出現 NaN，離開良性參數區後沒有任何端到端容許誤差站得住，所以這類案例只在元件層把關。兩者以參考有效半徑代入後，組合與 S(q) 都符合 1e-9 | 2026-11-18 M1 Task 6 實測；M1 科學審查更正 |
| 20 | G4 的參數基準取 bumps `lm` 結果精修後的真正極小值，不直接用 bumps 的原始輸出 | bumps 的 `lm`（MPFit）迭代時用自己的前向差分 Jacobian，步長 √1.19209e-7·\|p\|≈3.45e-4·\|p\|（`bumps/fitters.py:711`、`mpfit.py:1561,1587`），梯度有偏，會停在離真正極小值稍遠處，距離隨起始值與雜訊種子而變：bumps 自己從三個起始值擬合 sphere，radius 就差 0.0055σ；產生 12 組參考值時量到的「bumps 原始結果 vs 精修值」最大 0.0064σ（sphere 的 radius），貼著邊界而其餘參數為非線性的設計可達 0.03–0.055σ（不同起始值之間也差 0.02σ，故未採用）。所以「對原始 bumps < 0.01σ」對正確的擬合器也不保證成立；精修值與起始值無關，才是可重現的基準。誤差、共變異與 χ²ᵣ 仍用 bumps 的算法在精修點計算，定義不變 | 2026-11-18 M2 計畫審查實測；Task 2 產生參考值時實測 |
| 21 | 化學式的句點一律為小數點；水合物用「·」或括號 | 兩種寫法語法上無法區分，periodictable 也把 CuSO4.5H2O 讀成 O 5.5 | 使用者 2026-11-18 |
| 22 | 預覽曲線有部分非有限點時照畫其餘點並回報點數；只有全部點都非有限時才不更新曲線 | hayter_msa 的零星 NaN 是常態（§16），照原文字面做（任何 NaN 都不更新）會讓預覽經常停住，使用者看不到自己改的參數有什麼效果 | M3 計畫審查 2026-11-18 |
| 23 | 官方檔中 σ 為 0、負數或非有限的列，在四種權重下一律無效（修訂決策 12：w＝0 的規則之外，官方檔另以 σ 判定有效與否）；一般文字檔不受影響 | 官方 `.dat` 以 σ＝0 標示光束擋片區。M3 科學審查實測：按「全範圍」後這 5 列進入非 σ 權重的擬合，√\|I\| 得到 scale 24、radius 1.3（未收斂），\|I\| 得到 scale 0 的零模型 | 使用者 2026-11-18 |
| 24 | 只有權重＝資料 σ 時稱 χ²ᵣ、才有過大／過小的提示並影響狀態顏色；其餘權重稱「加權殘差均方」並附說明 | 相對權重下這個量沒有絕對尺度：不加權時正確的擬合得到 117（被提示為局部極小值），\|I\| 權重下零模型恰好約為 1（顯示為已收斂） | M3 科學審查 2026-11-18 |
| 25 | 脂質頭基（不含水合水）保留並註明是成分密度；新增「脂質頭區（PC，含 8 個水合水）」；PEG 改稱「塊材，非晶態」，不提供水溶液預設值；接受 D（氘） | 無水頭基 0.514 e/Å³ 拿去當殼層 SLD 會把頭–水對比高估 50–90 %；頭區的值隨水合數而變（5–12 個水為 0.42–0.46 e/Å³），V_H 的文獻範圍 319–340 Å³。PEG 在水中的表觀比容與塊材不同，但文獻數值未能查證。頭區密度經重算為 1.353 g/cm³（559 Å³），SLD 12.30 | 使用者 2026-11-18（D2、D3）；數值由 M3 科學審查重算 |
| 26 | 數值與誤差的文字只有一套規則（§5.4 數字格式 1–6）；擬合值回填時捨入，結果與表單的比對經同一個捨入 | UI 審查：結果磚把數值捨入到誤差的位數，與參數表不一致（磚 `100 ± 5700`、輸入欄 72.7417）；誤差遠大於數值時出現 `0e1 ± 14000e1`；輸入欄出現 17 位數字 | M3 UI 審查與科學審查 2026-11-18 |
| 27 | 擬合對象的模型曲線用自己的顏色（`ChartTheme` 新角色 `modelCurve`，墨色），資料點改空心、縮小；其他檔的曲線仍用系列色。**推翻 M3 計畫的工程決定 7**（曲線與資料點同系列色） | 好的擬合時曲線與自己的資料點同色、疊在一起，完全看不出來——擬合工具最基本的判斷（線有沒有穿過點）做不了。既有的 `fit` 角色是紅色，與系列色第 1 色（擬合對象通常就是它）只差 1.82:1，所以另立中性的墨色 | UI 審查 2026-11-19（前後對照圖見完成紀錄） |
| 28 | 主圖的滾輪縮放要按住 Ctrl；另加拖曳框選（x、y 同時）與 Shift＋拖曳平移；單純的滾輪捲動頁面 | 圖區是 sticky、佔畫面四成的區塊，游標停在上面時滾輪被圖吃掉，捲不動很長的參數表，視野也在不知不覺中被改掉。框選取 xy 而不是只有 x：只縮 x 時 y 仍是六個級距，低 q 區段擠在圖的上緣 | UI 審查 2026-11-19 |
| 29 | 參數表改為四欄＋每個參數一列明細（上下限、多分散、化學式面板）；「開始擬合／停止」與擬合量度移到三個分段都看得到的擬合列；兩欄的斷點改看內容寬度，圖區是較寬的一欄 | 七欄的表剛好塞滿左欄：名稱在字中間斷行、錯誤訊息擠成三行、圖在 1280 px 只剩 318 px 寬；調參數與看 ± 在模型分段，開始鈕與結果在擬合分段，每一輪來回切兩次 | UI 審查 2026-11-19 |
| 30 | **v5.8 起由決策 42 取代。** 3D 結構示意放在圖卡內，以分段控制「曲線｜3D 結構」切換（`plotView`，預設曲線）；畫布用主圖的位置與高度，尺寸與說明用殘差圖的位置。**推翻 §5.1 原先畫在殘差圖之下的版面**。UI 審查後按鈕標為「3D 結構」並移到標題之前 | 圖欄在 1024×768 有擬合結果時只剩 24 px：再加一列 3D 就要在欄內捲動。切換鈕在標題之前，標題的字換了它也不移動 | 使用者 2026-11-19；位置與標籤＝工程（UI 審查 2026-11-19） |
| 31 | IUCr「複製表格」的內容帶 q-range／Exposure／Temperature 三個輸入框**目前的值**，複製出去的 HTML 不留 `<input>`；空的擬合段不進複製；後備路徑與 Clipboard API 內容相同 | 舊行為：HTML 只帶輸入框的預設值屬性、純文字完全不含輸入框的值——貼出去的表格缺三列使用者填的值。後備路徑原先讓瀏覽器序列化選取範圍，會帶進暫時容器的樣式 | 使用者 2026-11-19（現值）；後備路徑＝工程（程式審查 2026-11-19） |
| 32 | 可送 IUCr 的條件：已收斂、**權重＝資料 σ**、不是 `blockedByNonFinite`、結果仍與參數表相符。警示不擋送出，寫進 Notes | 投稿表格裡的必須是畫面上的參數；其他權重沒有公認的適合度統計量可以填進表格（決策 24：那個量不是 χ²ᵣ）。CSV／TXT 仍可匯出 | 使用者 2026-11-19（只收 σ 權重）；其餘＝工程（M4 計畫審查 2026-11-19） |
| 33 | IUCr 段落標題「Model fitting (analytical scattering model)」；列＝§8 所列；**不列 CorMap P-value**；Notes 的第一句固定為「Supplementary to the IUCr template; applies to the data file named here. CorMap P-value not computed.」；量度列附自由度；Assumptions 寫明各分布寬度的定義 | 2017／2023 的 IUCr 範本沒有解析模型擬合的專屬段落，這一段是補充，要自己說清楚；模型可含結構因子與冪律項，稱 form factor 不準確；本工具不計算 CorMap，明說比留白好；lognormal 的寬度不是 σ/R，不寫明會被讀錯 | 使用者 2026-11-19（固定句）；標題與其餘＝工程（科學審查 2026-11-19） |
| 34 | 序列各檔的範圍與權重：範圍未經編輯時每檔用自己的預設範圍；編輯過則截到各檔的可用範圍並註記；σ 權重下沒有可用 σ 的檔跳過（不改用別的權重）；官方檔與一般檔可混用 | 各檔的 q_start 與光束擋片區不同，套同一個數字會把無效點放進擬合；一張表、一張趨勢圖不能混兩種量度 | 工程（M4 計畫審查 2026-11-19） |
| 35 | 序列初值規則：來源＝最後一筆「已收斂、非 `blockedByNonFinite`、非 `illConditioned`、非 `jacobianNonFinite`、σ 權重時 χ²ᵣ ≤ 10」的結果；**只沿用定得出來的參數**（誤差有限且 < \|數值\|），其餘從表單原始值出發並在該列註記；貼邊界的值可沿用 | 定不出來的參數（例：背景 −0.96 ± 3.5）帶到下一筆等於把雜訊當初值，會一路傳下去；病態或 Jacobian 不完整的結果連數值本身都不可靠 | 使用者 2026-11-19（只沿用定得出來的參數）；`illConditioned`／`jacobianNonFinite` 與其餘＝工程（2026-11-19） |
| 36 | 序列不做續跑（停止後再按就重跑）；結束後只自動載入擬合對象自己的結果；選檔與結果是同一張表，資料清單沒有「序列」欄；狀態併入量度欄、註記改成註記列 | 規格 §7 沒有續跑，重跑只要幾秒；自動載入讓頁面不把沒動過的表單稱為已改動；左欄約 390 px，多一欄或兩張表都放不下 | 工程（M4 計畫審查與 UI 審查 2026-11-19） |
| 37 | 3D 的畫法慣例：正交投影；殼／實心藍、核琥珀，不對應 SLD，不畫溶劑；尺寸用圖下的文字清單＋圖上的比例尺；lamellar 單一薄板、橫向示意；柔性圓柱畫成沿中心線的粗線、沒有排除體積、寫明是一個代表性構形；**蠕蟲鏈以 α＝(2l_p/ds−1)/(2l_p/ds+1) 保持蠕蟲鏈的大小，L/b ≥ 200 時改粗粒化並註明輪廓長度是示意**；方向鍵與拖曳同方向；Ctrl＋滾輪縮放、不提供平移；觸控先橫向拖曳即可旋轉 | 見 §6。蠕蟲鏈：原構造在步數封頂後 ⟨Rg²⟩ 偏大到 1.7–5 倍，「按比例」不成立；方向鍵原先與拖曳相反 | 工程（M4 計畫審查、科學審查與 UI 審查 2026-11-19） |
| 38 | 報告 TXT 的波長以 hc ＝ 12.398 keV·Å 換算，與「SAXS 結構參數」頁相同 | 兩頁對同一個能量顯示不同的波長（CODATA 值與 12.398 在第 5 位有差）會讓使用者懷疑其中一個；SAXS 頁不動 | 使用者 2026-11-19 |
| 39 | 序列之後被單獨重新擬合的檔：序列表、趨勢圖與序列 CSV 仍用**序列自己的結果**，另加「已單獨重新擬合」註記。**推翻 M4 計畫假設 (a)4**（顯示 `fitResults` 目前的內容） | 單筆擬合可以換權重與範圍：原做法會在同一張表、同一條趨勢線與同一個 CSV 裡混兩種量度（實測：σ 權重的表頭下出現不加權擬合的數字） | 工程（程式審查 2026-11-19） |
| 40 | 主圖第四種模式 Porod：I·q⁴ 對 q，線性軸，**不扣背景**（資料照載入的畫、模型照算出來的畫），作法與 Kratky 相同 | 與 Kratky 一致：圖上的每一點都是檔案裡的數字乘上 q 的冪次，沒有使用者看不到的處理；要看 Porod 平台就把背景放進模型去擬合 | 工程，依使用者「照你建議」（2026-11-24） |
| 41 | 匯出 SasView「Paste Params」參數文字（剪貼簿＋報告 TXT 最後一段）。誤差一律寫未乘的 1 σ；多分散的寬度、Npts、Nsigs、分布照這次擬合實際用的寫；低 q 冪律附加項不能表示 → 停用；SasView 貼上時的四項限制（5 位有效數字、6.x 有 S(Q) 時不貼 background、≤ 6.1 不貼分布、6.1.0 貼 Npts／Nsigs 會蓋掉計算用的寬度）以說明告知，不因此停用按鈕 | 格式取自 SasView 原始碼並以本機 SasView 6.1.0 實際貼上驗證（§9）。未乘的誤差是 SasView 在相同權重下自己會顯示的值，而且貼上時根本不讀誤差欄。多分散的問題出在 SasView 6 的表格（手動輸入也一樣），文字本身是對的，5.0.x 與修正後的版本可以正確貼上；主要參數仍然省下逐格輸入 | 工程（2026-11-24；多分散時「不停用、以說明告知」待使用者確認） |
| 42 | 3D 示意改為曲線卡下面的另一張卡，**沒有「曲線｜3D 結構」切換**（`plotView` 移除）；兩欄時右欄與左欄同高、曲線卡在 `.sf-curve-track` 內 sticky、3D 卡接在其後，欄內不捲動；單欄時兩張卡排在操作區前、模型分段只釘曲線卡；3D 只在畫面上時重畫；曲線卡恢復完整的標題與「重設縮放」 | 使用者要兩者同時看得到。sticky 的曲線卡不能讓 3D 卡從它底下滑過（會重疊），所以曲線卡只在左欄多出來的那一段固定：左欄短時整欄照常捲，左欄長時改參數仍看得到曲線，3D 卡在左欄末端出現；拿掉欄內捲動後滾輪一律捲頁面。拿掉切換鈕後標題列多出 43 px 以上，v5.7 的權宜作法不再需要 | 使用者 2026-11-24（「3D圖可以放在下面不用分頁」）；捲動與固定的作法＝工程 |
| 43 | 選了 S(Q) 時畫 N＝12 顆相同的顆粒（§6.1）：外接球不重疊、箱子按 φ 與模型交給 S(Q) 的 R_eff、太疏（< 28 px）時縮小並註明、太密改用打亂的晶格並封頂註明、比例尺量顆粒、細長顆粒隨機取向、多分散畫中心值、hayter_msa 列電荷與 κ⁻¹（不畫屏蔽雲）、顆粒間依中心深度排序（精確）、深度提示只經 shade3d | 參考網站加上 S(Q) 時改畫多顆顆粒，使用者要同樣的效果；按比例的箱子傳達真實的擁擠程度，做不到的時候說實話 | 使用者 2026-11-24；規則＝工程 |

## 16. 已知限制與 B 版候選

**已知限制：hayter_msa（sasmodels 上游）在低 q 數值不穩定。**（M1 科學審查，2026-11-18；原生 sasmodels 與本站 wasm 皆實測）

- 現象：`hayter_msa.c` 在低 q 會回傳離群值甚至 NaN，而且對輸入的最後一位極度敏感。兩組實測（都掃描有效半徑 80–105 Å、2001 點，S 在多數半徑約為 0.636）：(a) 科學審查者的條件 q＝3e-3 Å⁻¹、charge 16.3377／T 326.3253 K／鹽 0.0564 M／ε 71.4194／volfraction 0.0558，以偏離局部中位數 1e-4 為準，有 82 點（4.1%）離群，其中 16 點為 NaN（例：R＝93 Å 得 0.301，R＝95 Å 得 NaN）；(b) 修正任務以 q＝1e-3 Å⁻¹、charge 16.3／鹽 0.056 M／volfraction 0.056（其餘預設）重測，有 9 點 NaN、52 點偏離中位數超過 10%（合計約 3%），此條件下 R＝93、95 Å 正常。離群點的位置隨 q 與參數的末位數字而變。在 2qR≈0.005–0.1，有效半徑變動 1 ulp 可使 S 變動到 4.5e-4。在類蛋白質的參數區（電荷 8–20、鹽 0.02–0.15 M、volfraction 0.02–0.2），約 0.1–0.2% 的點偏差約 3e-4。
- 不限於低 q：挑選 G1 案例時另外量到，ellipsoid 預設尺寸（有效半徑 270.7 Å）配 charge 12／鹽 0.1 M／volfraction 0.15，在 2qR≈70（q＝0.1290、0.1335 Å⁻¹）原生回傳 S＝0.856、1.818，前後相鄰點都是 1.0000；同一組輸入 wasm 在第一點得 0.816。
- 這是上游程式的行為：SasView 的表現相同；本站把 C 原始碼原樣編譯，不做修改，wasm 在相同輸入下於相同位置出現離群點（離群點上的數值不一定與原生相同，如上例）。
- 對驗證的影響：P@hayter_msa 取非預設 S 參數時不設端到端門檻，只在元件層把關（§11 G1、§15 決策 19）。`tests/sasfit-product.test.js` 有兩個特性測試把這個限制留作證據（q＝1e-3、半徑 80–105 Å 掃 201 點：wasm 得 1 點 NaN、4 點偏離中位數超過 10%；以及上述 2qR≈70 的尖峰）——上游若修好，這兩個測試會失敗，屆時應回頭收緊門檻。
- 對後續里程碑的要求：M2 擬合器與 M3 介面必須把 hayter_msa 回傳的 NaN 或跳點當成**預期中的輸入**，不是程式錯誤——擬合器要有非有限值防護（拒絕該步，§12），介面在選用 hayter_msa 時提示「此結構因子在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同）」。
- M2 的落實（§4.9）：NaN 的試探步被拒絕；Jacobian 鄰點為 NaN 時換步長重試；被算不出來的區域擋住時回報 `failed`＋`blockedByNonFinite` 而不是收斂。**擋不住的是「有限但錯誤」的跳點**：它落在 Jacobian 的鄰點上時，那一次迭代的方向與最後的誤差都會受影響而沒有任何旗標（實測：R＝90 Å、q 自 1e-3 Å⁻¹、charge 16.3、鹽 0.056 M、起始值各偏 ±20% 的 40 次擬合，修正前 38 次 `converged`、2 次 `failed`，修正後 40 次都是 `converged` 且沒有任何旗標。跳點造成的後果隨擬合走的路徑而變，換阻尼規則就換一批受害者：以原阻尼規則時，39 次的 χ²ᵣ 在 0.78–1.37，其中 3 次的 radius 誤差比其他次小 5–30 倍（Jacobian 鄰點落在跳點上），另 1 次停在模型的一個孤立跳點上——該點的 χ² 比四周所有的點都低，擬合器無從分辨，以 `converged` 回報 χ²ᵣ＝4.2、charge＝41；改用 Nielsen 阻尼（§4.9）後，那 4 次都正常（誤差 1.3e-2–1.6e-2 Å、χ²ᵣ 0.78–1.30），但另 1 次停在 χ²ᵣ＝2.1、charge＝39 的跳點區——相鄰試探點的 χ² 在 243 與 255 之間來回跳）。所以介面的 hayter_msa 提示要包含「誤差可能不可靠」，而且 χ²ᵣ 必須與狀態並列（§5.7 第 1 點）。

**B 版候選：**

- 其餘 64 個 sasmodels 模型（C 核心者重編即可）；
- 演算法：DE、DREAM（後驗分布與參數相關性）、Nelder–Mead、BFGS；
- 解析度修正（pinhole ΔQ/Q；官方 `.dat` 可選輸出 dQ）；
- 異常散射 f′／f″（能量相依 SLD）；
- 多組資料共用參數的聯合擬合、參數約束式；
- 專案存檔／讀檔；
- 多 Worker 分 q 平行（兩參數同時多分散的圓柱類：A 版單次計算約 0.75 秒，§11）；
- 擬合後以中央差分精修（消除前向差分 Jacobian 在強相關問題上留下的約 0.03σ 偏差，§4.9）；
- GitHub Actions 雲端編 wasm（換電腦免裝 emsdk）；
- 標準化 Kratky（需 Rg、I(0)）。

## 17. 授權與致謝

- `saxs-calculator/wasm/LICENSE-sasmodels.txt` 放 sasmodels 1.0.12 授權全文（取自其 dist-info `licenses/`）。
- 移植自 sasmodels 原始碼的 JS 檔（`sasfit-weights.js`、`sasfit-kernel.js`、`sasfit-product.js`、`sasfit-py-models.js`）屬衍生作品，檔頭保留 sasmodels 的 BSD-3 版權聲明並註明移植來源檔。
- 分頁說明與報告 TXT 註明：「模型計算核心：SasView sasmodels 1.0.12（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly」。
