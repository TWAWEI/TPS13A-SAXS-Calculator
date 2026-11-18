# SAS 模型擬合頁（A 版）— 設計規格

- 日期：2026-11-17
- 狀態：v3——設計已與使用者逐段確認（共 5 段）；規格審查 3 輪（第 1 輪 6 項、第 2 輪 2 項問題已修正，第 3 輪核准）；使用者另就 4 項科學判斷作出決定（§15 #13–#16）。待實作規劃
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
4. 主圖三種模式：log-log、Guinier（ln I vs q²）、Kratky（q²I vs q）；殘差圖。
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
| `js/sasfit-fitter.js` | LM（可抽換介面）、數值 Jacobian、上下限、誤差 | — |
| `js/sasfit-worker-core.js` | Worker 訊息處理的純邏輯（wasm 載入器以參數注入，Node 可測） | evaluate、fitter |
| `js/sasfit-worker.js` | **Worker 入口**：`importScripts` 載入純模組、接上 `self.onmessage`。唯一不在 `index.html` 載入的 JS | worker-core |
| `js/sasfit-worker-client.js` | 主執行緒端：Worker 生命週期、latest-wins、停止＝terminate 重建、版本號 | — |
| `js/sasfit-sequence.js` | 序列擬合排程（主執行緒，逐筆送 Worker；排程邏輯為純函式） | worker-client |
| `js/sasfit-plots.js` | 主圖、殘差、疊圖、趨勢圖（Chart.js＋`ChartTheme`） | — |
| `js/sasfit-shape3d.js` | Canvas 2D 3D 繪製器與各模型幾何 | — |
| `js/sasfit-export.js` | CSV／TXT／PNG、IUCr 資料物件（字串組裝為純函式） | — |
| `js/section-sasfit.js` | 分頁 UI 串接 | 以上全部 |

- `wasm/` 放在 `saxs-calculator/` 底下（部署 workflow 只上傳 `./saxs-calculator`）。
- 開發用 `tools/sasfit/` 放在 **repo 根目錄**，不會被部署。
- 參考值 fixtures 放 `saxs-calculator/tests/fixtures/sasfit/`（與現有 fixtures 相同位置），以精簡 JSON 儲存。

### 3.3 載入策略、模組慣例與守門測試

**模組慣例**：每個 `sasfit-*.js` 以 IIFE 包住，只透過 `globalThis.SasFitXxx = Object.freeze({...})` 匯出一個凍結物件（例：`SasFitKernel`、`SasFitFitter`）。用 `globalThis` 而非 `window`——Worker 內沒有 `window`。純計算模組（meta、validate、weights、kernel、product、py-models、evaluate、weighting、data-io、sld、fitter、worker-core，以及 sequence、export 的純函式部分）頂層不得觸碰 `window`、`document`、`Chart`。

**主執行緒**：`index.html` 以 `<script>` 載入除 `sasfit-worker.js` 以外的全部 `sasfit-*.js`，順序：meta → validate → weights → kernel → product → py-models → evaluate → weighting → data-io → sld → fitter → worker-core → worker-client → sequence → plots → shape3d → export → section-sasfit，置於 `app.js` 之前。

**Worker**：`sasfit-worker.js` 以 `importScripts` 載入 meta → validate → weights → kernel → product → py-models → evaluate → weighting → fitter → worker-core（與 `index.html` 相對順序一致）。validate 必須排在 weights 之前：kernel、product、py-models、evaluate 在載入時就讀 `globalThis.SasFitValidate`（weights 在呼叫時讀）。Worker 依 `fit` 訊息中的權重選項，自行用 weighting 模組算 w_i 與遮罩。

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
- 限制（介面說明、報告註記）：含吸收邊靠近 15 keV 的元素（Au、Pt 的 L 邊、Br、Sr 的 K 邊等）時誤差較大。
- 化學式語法：元素符號＋可選計數（含小數）、括號巢狀、水合點（`CuSO4·5H2O`、`CuSO4.5H2O`）；不認得的元素→欄位錯誤。原子量與 Z 內建表（IUPAC 標準原子量），以 periodictable 交叉驗證（G6）。
- 預設物質（化學式＋密度，由同一函式算出；數值與出處寫在 `sasfit-sld.js` 註解，經 science-reviewer 審查）：水、蛋白質（平均）、脂質頭基、脂質尾鏈、PEG、SiO₂、Au、Fe₃O₄。
- SLD 欄位可直接輸入數值；或開小面板輸入化學式＋密度後回填數值（參數本身永遠是數值）。

### 4.8 資料讀取、權重與清理（`sasfit-data-io.js`、`sasfit-weighting.js`）

**官方 `.dat` 判定**：第 1 行含 `Data Collection Mode`，且存在 `Single Frame Time` 行與其後 `Q I ERROR` 表頭。讀取檔頭欄位：輸出檔名、總幀數、Photon Energy (keV)、Scaling Factor、Sample／Empty Cell Transmission、Sample thickness (mm)、SDD (mm)、Starting Q-value（q_start）、Single Frame Time。Q 單位固定 Å⁻¹，強度為絕對強度 cm⁻¹。

**一般文字檔**：略過空行與 `#`、`;`、非數字開頭的行；分隔符為空白、Tab、逗號、分號；2 欄（q, I）、3 欄（q, I, σ）、4 欄（第 4 欄 dQ 讀入但 A 版不使用）。Q 單位由使用者選 Å⁻¹（預設）或 nm⁻¹（讀入時 ÷10）；最大 q > 5 且選 Å⁻¹ 時提示「是否為 nm⁻¹？」。

**權重**（與 SasView `residuals_help` 的四種相同）：

| 選項 | w_i | 該點不參與擬合的條件 |
|---|---|---|
| 資料 σ（預設，有 σ 時） | σ_i | σ_i ≤ 0 或非有限 |
| √\|I\| | √\|I_i\| | I_i = 0 |
| \|I\| | \|I_i\| | I_i = 0 |
| 不加權 | 1 | — |

殘差 r_i = (I_i − I_model,i) / w_i。缺 σ 的檔案預設權重改為「不加權」並提示。

**清理（不刪原始點，只標記）**：
- 非有限值、q ≤ 0 → 排除。
- 依上表，w_i ≤ 0 或非有限的點不參與擬合。
- I < 0 但 w_i > 0 的點**照常參與擬合**；log 與 Guinier 模式無法顯示 I ≤ 0 的點，隱藏並顯示「隱藏了 N 點」。
- 預設擬合範圍由純函式 `defaultRange(dataset, weighting)`（weighting 模組）計算：Qmin＝max(q_start（僅官方檔）, 第一個在該權重下可參與擬合的點)，Qmax＝最後一個可參與擬合的點。權重改變時重新計算（使用者未手動改過範圍時才套用新預設）。

**條件值**：取檔名（去副檔名）最後一個數字（整數或小數，允許負號），例如 `B1216_1_10.dat` → 10；取不到則空白待填。

**Dataset 物件**（凍結）：`{ id, fileName, kind: 'official'|'generic', header, q, I, sigma, condition }`。w_i、可參與擬合遮罩、預設範圍都由 weighting 模組依當下權重即時計算，不存在物件內。遮罩一次涵蓋全部條件：finite(q)、q > 0、finite(I)、finite(w_i)、w_i > 0。data-io 只負責解析與錯誤回報（格式錯誤的行列入該檔的錯誤訊息），Worker 端不需要 data-io。

### 4.9 擬合器（`sasfit-fitter.js`）

- 介面：`fit(problem, options) → FitResult`，`options.method = 'lm'`（A 版唯一值；B 版新增 DE、DREAM、Nelder–Mead、BFGS 時不改呼叫端）。
- LM：Marquardt 對角縮放；殘差同 §4.8。
- 上下限：試探步超出時截回邊界（projected LM）；結果落在邊界者標「觸及上限／下限」。
- 終止條件預設與 bumps 1.0.4 `lm`（MPFit）相同：steps 200、ftol 1e-10、xtol 1e-10；達步數未收斂→標「未收斂」但照樣回報。
- 模型輸出含非有限值→該步 χ² 視為 ∞、拒絕該步、加大阻尼。
- **共變異與誤差（比照 bumps，以便與 SasView 顯示的誤差一致）**：bumps 的 lm 不用 MPFit 自己的共變異（`nocovar=True`），而是在最佳解處另算 `lsqerror.jacobian`＋`jacobian_cov`。本站照做：
  - Jacobian：前向差分，h_j = 1e-4·|p_j|（p_j＝0 時 h_j＝1e-4）；若 p_j + h_j 超過上限則改往後差分。
  - C = V·diag(1/s²)·Vᵀ（J 的 SVD），奇異值 ≤ 1e-8 者以 1e-8 代之；發生代換時標「參數相關性過高，誤差不可靠」。JS 沒有內建 SVD：fitter 內實作 one-sided Jacobi SVD（自由參數僅十幾個，足夠快且數值穩定），以 numpy `linalg.svd` 的結果為測試基準，並列入 science-reviewer 審查。
  - 原始誤差 σ_j = √C_jj。
  - **顯示規則**（使用者決定）：權重＝資料 σ 時顯示原始誤差（不乘 √χ²ᵣ）；權重＝√|I|、|I|、不加權時顯示 σ_j·√χ²ᵣ，並標「已乘 √χ²ᵣ」。報告 TXT 一律兩種都列。
- LM 迭代中的 Jacobian 也用同一個前向差分函式。
- 自由度 = 可參與擬合的點數 − 自由參數數（含被勾選的 PD 寬度）；範圍內點數必須 > 自由參數數，否則不允許開始。
- FitResult（凍結）：`{ params, errors, errorsScaled, displayErrorsScaled, chi2, chi2r, dof, iterations, status: 'converged'|'maxiter'|'stopped'|'failed', atBound: {name: 'lower'|'upper'}, illConditioned, curve, residuals, settings }`。

### 4.10 Worker 協定

| 方向 | 型別 | 內容 |
|---|---|---|
| → | `evaluate` | `{ reqId, modelSpec, params, q, opts }`（`opts.cutoff`）；Worker 只處理最新的 reqId（latest-wins，舊請求丟棄） |
| ← | `curve` | `{ reqId, I, extras }` |
| → | `fit` | `{ jobId, modelSpec, params, fitFlags, bounds, data, range, weighting, options }` |
| ← | `progress` | `{ jobId, iteration, chi2r }`（每步） |
| ← | `result` | `{ jobId, fitResult }` |
| ← | `error` | `{ reqId|jobId, code, message }` |

- wasm 在 Worker 內以 `fetch`（網址帶 `?v=`）載入並快取（每模型一次）。
- 「停止」＝`worker.terminate()` 後重建 Worker（立即生效）；序列擬合停止亦同。
- Worker 異常結束→提示並自動重建，可直接重試。
- 單次 evaluate 超過 300 ms 時，預覽改為「計算中…」狀態顯示（不阻擋操作）。

## 5. 介面規格

元素 id 前綴 `sf`（IUCr 頁新增者用 `iucr-sf`）。沿用 v5.2 設計系統：`.card`、分組圓角輸入列、分段控制、`ResultTiles`、`ChartTheme.colorize`、語意色 token；**不新增顏色字面值**、不加裝飾圖示、不用行內 script／onclick（CSP）。

### 5.1 版面

```
┌─ 側欄 ─┬────────── 左欄：操作 ──────────┬──────── 右欄：圖（sticky）──────────┐
│        │ [資料][模型][擬合][序列]          │ I(Q) [log-log│Guinier│Kratky] [PNG] │
│        │                               │  資料點（誤差棒）＋模型曲線            │
│        │                               │  灰色區＝擬合範圍外                    │
│        │                               │ ─────────────────────────────────── │
│        │                               │ 殘差（與主圖共用 x 軸）                │
│        │                               │ ─────────────────────────────────── │
│        │                               │ 3D 結構示意（拖曳旋轉、滾輪縮放）       │
└────────┴───────────────────────────────┴─────────────────────────────────────┘
```

視窗寬度不足（沿用站內斷點）時兩欄改上下排列，圖區在操作區之下、不再 sticky。

### 5.2 資料分段

- 拖放區＋檔案選擇（多選，`accept=".dat,.txt,.csv"`）；一般文字檔的 Q 單位選擇。
- 清單欄位：顯示（☑）｜作用中（◉）｜序列（☑）｜檔名｜條件值（可編輯數字）｜狀態（未擬合／✓ χ²ᵣ／未收斂／失敗）｜移除。
- 條件名稱與單位輸入（預設「條件」，例：Temperature (K)、濃度 (mg/mL)、幀號）。
- 疊圖錯開開關＋級距 n（第 k 組乘 10^(k·n)，僅顯示用，不影響擬合與匯出）。
- 檔案讀取錯誤列在該檔列內（原因＋行號），不影響其他檔。

### 5.3 模型分段

- 模型選單：搜尋框＋依類別分組（形狀／與形狀無關）；選中後顯示模型說明與 SasView 文件連結（外部連結，`rel="noopener"`）。
- S(Q) 選單（無／hardsphere／hayter_msa）；不可接 S(Q) 的模型停用並說明。選了 S(Q) 時顯示組合方式、有效半徑模式選單與 §4.4 的說明文字。
- 低 Q 冪律開關。
- 參數表欄位：擬合（☑）｜參數（名稱＋單位）｜數值｜±（擬合後；若已乘 √χ²ᵣ 則表頭註明）｜下限｜上限｜PD（僅可多分散參數；點擊展開一列：擬合寬度 ☑、寬度、寬度上下限（預設 0–0.4）、分布、npts、nsigmas）。SLD 參數的數值欄旁有「化學式」按鈕開小面板。
- 數值輸入即時檢查（模型硬限制、下限 < 上限、PD 寬度 ≥ 0、npts 正整數、nsigmas > 0），錯誤以欄位層級提示，不送預覽。
- 參數單位沿用 sasmodels（長度 Å、SLD 10⁻⁶ Å⁻²、scale／background 依模型）。

### 5.4 擬合分段

- Q 範圍（Qmin、Qmax 輸入＋「全範圍」「預設範圍」按鈕；主圖上以灰色顯示範圍外）。
- 權重選單（§4.8 四種）、最大步數（預設 200）。
- 「開始擬合」「停止」「回復擬合前參數」。
- 進度：迭代次數與目前 χ²ᵣ。
- 結果：主角磚＝χ²ᵣ；一般磚＝各擬合參數 值 ± 誤差（單位）；狀態標記（未收斂、觸及上下限、誤差不可靠、已乘 √χ²ᵣ）。
- 「送進 IUCr 表格」（擬合成功才啟用）、「匯出擬合曲線 CSV」「匯出報告 TXT」。

### 5.5 序列分段（§7）

### 5.6 圖區

- 主圖模式：log-log（I vs q，雙對數）、Guinier（ln I vs q²，線性軸）、Kratky（q²I vs q，線性軸）。三種模式套用到所有顯示中的資料與其模型曲線。
- 疊圖：沿用 8 色系列，第 9 組起重複色並改虛線；作用中資料加粗；有擬合結果者畫曲線。
- 殘差圖：r_i（§4.8），x 軸跟隨主圖模式（log-log、Kratky 用 q；Guinier 用 q²）；只畫作用中資料。
- 縮放沿用 chartjs-plugin-zoom；「重設縮放」。PNG 匯出一律淺色白底。

## 6. 3D 結構示意圖（`sasfit-shape3d.js`）

- 自寫 Canvas 2D 繪製器：參數化曲面網格→旋轉投影→由遠到近排序（painter's algorithm）→Lambert 明暗；滑鼠拖曳旋轉、滾輪縮放、「重設視角」、「自動旋轉」開關；PNG 匯出。不引入 three.js。
- 顏色只從 `chart-theme.js` 取：新增 3D 角色色（兩主題各一組）與明暗函式 `ChartTheme.shade3d(role, k)`（k＝Lambert 亮度係數 0–1，回傳顏色字串）。`sasfit-shape3d.js` 內不得出現任何顏色字面值或 `rgb(`／`rgba(` 等顏色函式（`no-color-literals` 會擋）。主題切換時重畫。
- 依目前參數**按比例**繪製；標註用 nm（1 位小數）並附比例尺；參數表仍為 Å。

| 模型 | 畫法與標註 |
|---|---|
| sphere | 實心球；R |
| ellipsoid | 旋轉橢球；R_polar、R_equatorial |
| cylinder | 實心圓柱；R、L |
| core_shell_sphere | 切掉 1/4 露出核／殼兩色；R_core、t_shell |
| vesicle | 切掉 1/4 的中空殼；R_inner、t |
| core_shell_cylinder | 切掉 1/4 的核殼圓柱；R、t、L |
| flexible_cylinder | 依 Kuhn 長度生成的代表性蠕蟲鏈管（固定亂數種子，同參數畫出相同構形）；L、b、R |
| lamellar | 一片雙層薄板；δ |
| 與形狀無關 5 模型 | 不畫；顯示「此模型沒有固定形狀」 |

- 多分散度與 S(Q) 不畫入幾何，在圖下方以文字標示（例：「R = 5.0 ± 0.5 nm（Schulz）」「S(Q)：hardsphere，φ = 0.20，R_eff = 5.0 nm」）。
- 渲染上限：每物件 ≤ 4000 個面，維持拖曳流暢。

## 7. 序列擬合（`sasfit-sequence.js`）

- 範圍：清單中「序列」勾選的資料；沿用目前的模型規格、擬合勾選（含 PD 寬度）、上下限、Q 範圍、權重、最大步數。Q 範圍若超出某組資料的可用範圍，該組自動截到可用範圍並在結果列註記。
- 選項（預設皆開）：「以前一筆結果作為下一筆初值」「依條件值排序」（條件值空白者排最後並警告）。
- 某筆失敗或未收斂：標記於該列；若開啟「以前一筆為初值」，下一筆改用**最後一次收斂的結果**為初值；序列不中斷。
- 進度：目前第 k／N 筆＋該筆迭代進度；「停止」立即結束（已完成的結果保留）。
- 結果表：條件值｜各擬合參數 ± 誤差｜χ²ᵣ｜狀態；點列→該組設為作用中並把其擬合參數載入參數表。
- 趨勢圖：y 軸參數可選（含 χ²ᵣ），x 軸為條件值（名稱與單位取自條件設定），含誤差棒；PNG 匯出。
- 每組資料的 FitResult 存在 `datasetId → FitResult` 映射（單組擬合與序列擬合共用）。

## 8. IUCr 表格整合

- 「送進 IUCr 表格」寫入 `AppState.sasfitData`（新物件取代舊值）：

```
{
  datasetName, model,               // model 例：'core_shell_sphere@hardsphere'
  structureFactorMode,              // 'P*S' | 'P*(1+beta*(S-1))' | null
  params: [{ name, value, error, errorScaled, unit, fitted }],   // 含被擬合的 PD 寬度
  chi2r, qMin, qMax, npoints, weighting,
  software                          // 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v5.3'
}
```

- IUCr 頁在 Molecular-mass determination 之後新增段落「Model fitting」，列：Data file｜Model｜各參數（Value、±、Unit；固定參數 ± 欄填 fixed；±依 §4.9 顯示規則）｜q-range for fitting｜χ²ᵣ｜Software。元素 id 前綴 `iucr-sf`。
- 列由 JS 動態產生；所有字串進 `innerHTML` 前經 `FormUtils.escapeHtml`。現有「複製表格」須包含此段（驗收項）。
- 未送出前此段顯示「尚未送入擬合結果」。

## 9. 匯出（`sasfit-export.js`）

| 檔案 | 檔名 | 內容 |
|---|---|---|
| 擬合曲線 CSV | `<資料名>_<模型>_fit.csv` | q、I、σ、I_model、殘差、in_fit（0/1）；開頭 `#` 註解列出模型與參數 |
| 報告 TXT | `<資料名>_<模型>_report.txt` | 資料檔名與檔頭（能量、q_start、厚度、SF、透射率）；模型、S(Q) 組合與有效半徑模式；多分散設定（分布、寬度、npts、nsigmas、cutoff）；各參數值、誤差（不乘／乘 √χ²ᵣ 兩欄）、擬合或固定、觸及邊界；χ²、χ²ᵣ、自由度、點數、q 範圍、權重；演算法與設定、迭代數、狀態；SLD 近似 f≈Z 的註記；軟體與版本 |
| 序列結果 CSV | `<條件名>_sequence.csv` | 序列結果表全部欄位 |
| PNG | 各圖 | 主圖、殘差、3D、趨勢圖；淺色白底 |

CSV 沿用站內慣例：RFC 4180 引號、UTF-8 BOM（`downloadCsv`）。

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
| G4 | 擬合器 vs bumps lm（`Experiment(..., cutoff=1e-5)`、`FitDriver` 的 cov／stderr）：每類各 1 組合成資料（sasmodels 產生＋固定種子高斯雜訊），同初值；含 1 組擬合 PD 寬度的案例 | 參數差 < 0.01σ；誤差相對差 ≤ 2%；χ²ᵣ 相對差 ≤ 1e-3 |
| G5 | data-io 與 weighting：合成官方格式檔與一般檔（公開 fixtures）；真實 `.dat`（`tests/fixtures-local/sasfit/`，已被 `.gitignore` 擋，缺檔即 skip）；四種權重的 w_i、可參與點判定與 `defaultRange` | 檔頭欄位、點數、清理標記、預設範圍、條件值正確 |
| G6 | SLD：化學式解析與數值 vs periodictable 的原子量與 Z 獨立計算（例：水 1.0 g/cm³ ≈ 9.420×10⁻⁶ Å⁻²） | 相對差 ≤ 1e-6 |
| G7 | 站內既有測試全部綠燈；`result-golden` 與 `markup-v4.15` fixture 不得重產；守門測試只依 §3.3 修改（含 markup 區段規則與 Worker 清單測試）；版本號一致 | 全過 |
| G8 | Playwright（本機 http.server，text-to-cad venv）：無 console 錯誤；載入合成 `.dat`→預覽→擬合→序列（3 組）→送 IUCr→複製表格→各匯出→3D 渲染非空；淺／深兩主題 axe 0 違規；Worker 與 wasm 請求網址帶 `?v=` | 全過 |

- 效能：Phase 0 量測最重組態（core_shell_cylinder＋兩個多分散參數、400 點）的單次評估與一次典型擬合時間，寫進報告；據此訂定預覽／擬合的效能預算，超出者以「計算中…」與進度呈現。
- 科學審查：science-reviewer 審 weights／kernel／product 移植、SLD 公式與預設物質、誤差慣例、權重與清理規則。
- 程式審查：每任務規格＋品質雙審；收尾 code review（CRITICAL／HIGH 必修）。

## 12. 錯誤處理

| 情況 | 行為 |
|---|---|
| 檔案無法解析 | 該檔列顯示原因與行號；其他檔照常 |
| 可參與擬合的點 ≤ 自由參數數 | 擬合按鈕停用並說明 |
| wasm 載入失敗（網路、MIME、`file://`） | 擬合頁顯示原因與解法；其他分頁不受影響（wasm 只在本頁載入） |
| Worker 異常結束 | 提示、自動重建、可重試 |
| 模型輸出 NaN／Inf | 擬合時拒絕該步；預覽時曲線不更新並提示參數可能不合理 |
| 奇異值被代換（§4.9） | 誤差照常顯示並標「參數相關性過高，誤差不可靠」 |
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

## 16. 已知限制與 B 版候選

**已知限制：hayter_msa（sasmodels 上游）在低 q 數值不穩定。**（M1 科學審查，2026-11-18；原生 sasmodels 與本站 wasm 皆實測）

- 現象：`hayter_msa.c` 在低 q 會回傳離群值甚至 NaN，而且對輸入的最後一位極度敏感。兩組實測（都掃描有效半徑 80–105 Å、2001 點，S 在多數半徑約為 0.636）：(a) 科學審查者的條件 q＝3e-3 Å⁻¹、charge 16.3377／T 326.3253 K／鹽 0.0564 M／ε 71.4194／volfraction 0.0558，以偏離局部中位數 1e-4 為準，有 82 點（4.1%）離群，其中 16 點為 NaN（例：R＝93 Å 得 0.301，R＝95 Å 得 NaN）；(b) 修正任務以 q＝1e-3 Å⁻¹、charge 16.3／鹽 0.056 M／volfraction 0.056（其餘預設）重測，有 9 點 NaN、52 點偏離中位數超過 10%（合計約 3%），此條件下 R＝93、95 Å 正常。離群點的位置隨 q 與參數的末位數字而變。在 2qR≈0.005–0.1，有效半徑變動 1 ulp 可使 S 變動到 4.5e-4。在類蛋白質的參數區（電荷 8–20、鹽 0.02–0.15 M、volfraction 0.02–0.2），約 0.1–0.2% 的點偏差約 3e-4。
- 不限於低 q：挑選 G1 案例時另外量到，ellipsoid 預設尺寸（有效半徑 270.7 Å）配 charge 12／鹽 0.1 M／volfraction 0.15，在 2qR≈70（q＝0.1290、0.1335 Å⁻¹）原生回傳 S＝0.856、1.818，前後相鄰點都是 1.0000；同一組輸入 wasm 在第一點得 0.816。
- 這是上游程式的行為：SasView 的表現相同；本站把 C 原始碼原樣編譯，不做修改，wasm 在相同輸入下於相同位置出現離群點（離群點上的數值不一定與原生相同，如上例）。
- 對驗證的影響：P@hayter_msa 取非預設 S 參數時不設端到端門檻，只在元件層把關（§11 G1、§15 決策 19）。`tests/sasfit-product.test.js` 有兩個特性測試把這個限制留作證據（q＝1e-3、半徑 80–105 Å 掃 201 點：wasm 得 1 點 NaN、4 點偏離中位數超過 10%；以及上述 2qR≈70 的尖峰）——上游若修好，這兩個測試會失敗，屆時應回頭收緊門檻。
- 對後續里程碑的要求：M2 擬合器與 M3 介面必須把 hayter_msa 回傳的 NaN 或跳點當成**預期中的輸入**，不是程式錯誤——擬合器要有非有限值防護（拒絕該步，§12），介面在選用 hayter_msa 時提示「此結構因子在低 q 可能出現不連續或無法計算的點（sasmodels／SasView 相同）」。

**B 版候選：**

- 其餘 64 個 sasmodels 模型（C 核心者重編即可）；
- 演算法：DE、DREAM（後驗分布與參數相關性）、Nelder–Mead、BFGS；
- 解析度修正（pinhole ΔQ/Q；官方 `.dat` 可選輸出 dQ）；
- 異常散射 f′／f″（能量相依 SLD）；
- 多組資料共用參數的聯合擬合、參數約束式；
- 專案存檔／讀檔；
- GitHub Actions 雲端編 wasm（換電腦免裝 emsdk）；
- 標準化 Kratky（需 Rg、I(0)）。

## 17. 授權與致謝

- `saxs-calculator/wasm/LICENSE-sasmodels.txt` 放 sasmodels 1.0.12 授權全文（取自其 dist-info `licenses/`）。
- 移植自 sasmodels 原始碼的 JS 檔（`sasfit-weights.js`、`sasfit-kernel.js`、`sasfit-product.js`、`sasfit-py-models.js`）屬衍生作品，檔頭保留 sasmodels 的 BSD-3 版權聲明並註明移植來源檔。
- 分頁說明與報告 TXT 註明：「模型計算核心：SasView sasmodels 1.0.12（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly」。
