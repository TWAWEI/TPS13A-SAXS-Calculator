# SAS 模型擬合頁（A 版）— 設計規格

- 日期：2026-11-17
- 狀態：設計已與使用者逐段確認（共 5 段），待實作規劃
- 目標產品：`saxs-calculator/`（GitHub Pages 單頁站），新版本 v5.3
- 計算核心來源：SasView **sasmodels 1.0.12**（BSD-3-Clause）；擬合器對照 **bumps 1.0.4**
- 參考：中央大學磁性與能源材料實驗室的「SAS Studio」（Google Sites 內嵌單檔 HTML，sasmodels 手工移植成 JS）。只參考功能與版面，**不複製其程式碼**——該站「版權所有」且未附授權。

## 1. 目標與範圍

在網站新增「SAS 模型擬合」分頁，讓 TPS13A 使用者在瀏覽器裡對一維 SAXS 曲線做 form factor／structure factor 模型擬合，不必安裝 SasView。全部計算在使用者的瀏覽器內完成（無後端），資料不離開使用者電腦。

分兩階段：**A 版＝光束線現場快速判斷**（本規格），架構預留 **B 版＝正式分析**（更多模型、可選演算法、解析度修正等，見 §16）。

**在範圍內（A 版）**
1. 讀官方 TPS13A `.dat`（含檔頭）與一般 2–4 欄文字檔；可一次載入多個。
2. 15 個模型（§4.1）：形狀 8＋與形狀無關 5＋結構因子 2；多分散度；低 Q 冪律附加項。
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
                                     ├─▶ fit-worker（Web Worker：wasm＋kernel＋fitter）─▶ FitResult ─▶ 圖／3D／匯出／IUCr
模型＋參數（UI 狀態）──────────────────┘
```

狀態一律以新物件取代舊物件（不就地修改）。主執行緒不做任何模型計算。

### 3.2 檔案

| 檔案 | 職責 | 依賴 |
|---|---|---|
| `wasm/sas-<model>.wasm` | sasmodels 生成的 C 原樣編譯；每模型一檔，進入本頁才載入 | — |
| `wasm/manifest.json` | 各 wasm 的 SHA-256、sasmodels 版本、emscripten 版本 | — |
| `wasm/LICENSE-sasmodels.txt` | sasmodels 授權全文（BSD-3 要求保留版權聲明） | — |
| `js/sasfit/models-meta.js` | 15 個模型的參數表（名稱、單位、上下限、預設、類別、是否可多分散、`have_Fq`、有效半徑模式、說明）。**腳本產生，勿手改** | — |
| `js/sasfit/weights.js` | 六種分布的取點與權重（移植 `weights.py`） | — |
| `js/sasfit/kernel.js` | 調度層：組 details／values 緩衝、分段呼叫 wasm、讀回 F1／F2 與附加量（移植 `details.py`、`kerneldll.py`、`kernel.py` 的 1D 路徑） | weights、meta |
| `js/sasfit/product.js` | P@S 組合、β 近似、有效半徑（移植 `product.py`） | kernel |
| `js/sasfit/py-models.js` | Python 核心模型的手寫 JS：`guinier_porod`、`power_law` | — |
| `js/sasfit/evaluate.js` | 單一入口 `evaluate(modelSpec, params, q)`：組合 P、S、低 Q 冪律 | kernel、product、py-models |
| `js/sasfit/data-io.js` | 解析 `.dat`／文字檔、檔頭欄位、清理規則、條件值擷取 | — |
| `js/sasfit/sld.js` | 化學式解析、X 光 SLD、預設物質表 | — |
| `js/sasfit/fitter.js` | LM（可抽換介面）、數值 Jacobian、上下限、誤差 | — |
| `js/sasfit/fit-worker.js` | Worker 入口：載 wasm、處理 evaluate／fit 訊息 | evaluate、fitter |
| `js/sasfit/worker-client.js` | 主執行緒端：Worker 生命週期、latest-wins、停止＝terminate 重建 | — |
| `js/sasfit/sequence.js` | 序列擬合排程（主執行緒，逐筆送 Worker） | worker-client |
| `js/sasfit/plots.js` | 主圖、殘差、疊圖、趨勢圖（Chart.js＋`ChartTheme`） | — |
| `js/sasfit/shape3d.js` | Canvas 2D 3D 繪製器與各模型幾何 | — |
| `js/sasfit/export.js` | CSV／TXT／PNG、IUCr 資料物件 | — |
| `js/section-sasfit.js` | 分頁 UI 串接 | 以上全部 |
| `tools/sasfit/*` | 開發用：產生 meta、編 wasm、產生參考值（§10） | Python、emsdk |

全域命名空間 `SasFit.*`（classic script，比照現有 `DndcCalculations` 等）。純計算模組（weights、kernel、product、py-models、evaluate、data-io、sld、fitter、sequence 的純函式部分、export 的字串組裝）必須能在 Node 以 `tests/load.js` 的 `vm.runInThisContext` 載入（不碰 `document`）；`LOAD_ORDER` 與 `index.html` 的相對順序一致（`tests/structure.test.js` 檢查）。檔案 200–400 行為原則、上限 800 行。

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
- 「可接 S(Q)」限 6 個同時具備 `have_Fq` 與有效半徑模式的形狀模型；其餘模型的 S(Q) 選單停用並說明原因。

### 4.2 強度定義與 kernel 介面

與 sasmodels `kernel.py` 一致：

  I(q) = scale / ⟨V_shell⟩ · ⟨F²⟩(q) + background

其中 ⟨·⟩ 為多分散度權重平均，實心物體 V_shell = V_form。A 版**一律使用 Fq 路徑**取得 ⟨F²⟩（`have_Fq` 模型另得 ⟨F⟩ 供 β 近似）。

wasm 匯出的 1D 入口為 sasmodels 生成碼的 `<model>_Iq`，參數順序（`kerneldll.py` 實查）：

```
(int32 nq, int32 pd_start, int32 pd_stop,
 int32* details, double* values, double* q, double* result,
 double cutoff, int32 radius_effective_mode)
```

- `result` 長度 `nq·nout + 4`，`nout = have_Fq ? 2 : 1`；`have_Fq` 時偶數位為 F²、奇數位為 F；末 4 格依序為 total_weight、form_volume、shell_volume、radius_effective（皆未除權重；JS 端除以 total_weight，shell_volume 為 0 時以 1 代之，同 `kernel.py`）。
- `details`／`values` 的版面逐行移植 sasmodels 1.0.12 `details.py`（`make_details`、`make_kernel_args`），1D 不需 `correct_theta_weights`。
- 與 `kerneldll.py` 相同，以每段 100 個 pd 評估點分段呼叫（`pd_start`、`pd_stop`）。
- `cutoff = 0`：整個分布全部積分（`direct_model` 預設）。
- 雙精度（F64）。

### 4.3 多分散度

移植 `weights.py` 的六種分布，預設值照 sasmodels：

| 分布 | npts | nsigmas |
|---|---|---|
| gaussian | 35 | 3 |
| rectangle | 35 | 1.73205 |
| uniform | 35 | — |
| lognormal | 80 | 8 |
| schulz | 80 | 8 |
| boltzmann | 35 | 3 |

- 寬度為相對值（PD 比例，σ／平均），與 SasView 相同；取點落在參數硬限制外者依 `weights.py` 的規則處理。
- 每個參數的 PD 設定（分布、寬度、npts、nsigmas）在參數表該列展開編輯；寬度 0＝單分散。

### 4.4 結構因子 P@S（移植 `product.py`）

- 組合方式 `structure_factor_mode`：0＝`P*S`（預設），1＝`P*(1+beta*(S-1))`（β 近似）。
- 有效半徑 `radius_effective_mode`：預設 **1**（模型自身第一種定義，例如 sphere＝radius）；0＝unconstrained，由使用者輸入 `radius_effective`。選單文字直接用該模型的 `radius_effective_modes`。
- 參數集＝P 的參數（不含 P 自身 scale／background）＋S 的參數＋兩個模式參數；`scale` 與 S 的 `volfraction` 是**兩個獨立參數**——介面以說明文字提示（SasView 原設計）。
- 數學定義、何時使用 shell_volume、volfraction 如何進入，全部以 `product.py` 原文為準，並由 G1 驗證。

### 4.5 低 Q 冪律附加項

勾選後：I_total(q) = I_model(q) + A·q⁻ⁿ。A、n 為可擬合參數（預設 A＝0、n＝4，n 範圍 0–6），與模型共用同一個 background。等價於 sasmodels 和模型 `model + power_law`（power_law 的 background 固定 0），G1 以該和模型產生參考值。

### 4.6 Python 核心模型

`guinier_porod`、`power_law` 以 JS 依 sasmodels 原始 `Iq` 函式手寫，數值行為（含分段點、q＝0 的處理）必須與原版一致，由 G2 驗證。

### 4.7 SLD（X 光）

- SLD = r_e · ρ_e，r_e = 2.8179403262×10⁻⁵ Å，ρ_e = N_A · ρ_mass · Σ(n_i Z_i) / M（e/Å³）；顯示單位 10⁻⁶ Å⁻²。
- **f ≈ Z**（忽略異常散射 f′、f″）：在此近似下 SLD 與能量無關；檔頭能量只用於報告與 IUCr 的波長。
- 限制（介面說明、報告註記）：含吸收邊靠近 15 keV 的元素（Au、Pt 的 L 邊、Br、Sr 的 K 邊等）時誤差較大。
- 化學式語法：元素符號＋可選計數（含小數）、括號巢狀、水合點（例：`CuSO4·5H2O`、`CuSO4.5H2O`）；不認得的元素→欄位錯誤。原子量與 Z 內建表（來源：IUPAC 標準原子量，與 periodictable 交叉驗證，G6）。
- 預設物質（化學式＋密度，由同一函式算出，數值與出處列在 `sld.js` 註解，經 science-reviewer 審查）：水、蛋白質（平均）、脂質頭基、脂質尾鏈、PEG、SiO₂、Au、Fe₃O₄。
- SLD 欄位可直接輸入數值；或開小面板輸入化學式＋密度後回填數值（參數本身永遠是數值）。

### 4.8 資料讀取與清理（`data-io.js`）

**官方 `.dat` 判定**：第 1 行含 `Data Collection Mode`，且存在 `Single Frame Time` 行與其後 `Q I ERROR` 表頭。讀取檔頭欄位：輸出檔名、總幀數、Photon Energy (keV)、Scaling Factor、Sample／Empty Cell Transmission、Sample thickness (mm)、SDD (mm)、Starting Q-value（q_start）、Single Frame Time。Q 單位固定 Å⁻¹，強度為絕對強度 cm⁻¹。

**一般文字檔**：略過空行與 `#`、`;`、非數字開頭的行；分隔符為空白、Tab、逗號、分號；2 欄（q, I）、3 欄（q, I, σ）、4 欄（第 4 欄 dQ 讀入但 A 版不使用）。Q 單位由使用者選 Å⁻¹（預設）或 nm⁻¹（讀入時 ÷10）；最大 q > 5 且選 Å⁻¹ 時提示「是否為 nm⁻¹？」。

**清理（不刪原始點，只標記）**：
- 非有限值、q ≤ 0 → 排除。
- σ ≤ 0 或缺 σ 的點在「資料 σ」權重下不參與擬合；缺 σ 的檔案預設權重改為「不加權」並提示。
- I ≤ 0 的點**照常參與擬合**；log 模式與 Guinier 模式無法顯示，隱藏並顯示「隱藏了 N 點」。
- 預設擬合範圍：Qmin＝max(q_start（僅官方檔）, 第一個 σ > 0 的點)，Qmax＝最後一個有效點。

**條件值**：取檔名（去副檔名）最後一個數字（整數或小數，允許負號），例如 `B1216_1_10.dat` → 10；取不到則空白待填。

**Dataset 物件**（凍結）：`{ id, fileName, kind: 'official'|'generic', header, q, I, sigma, valid（每點可否參與擬合）, defaultRange, condition }`。

### 4.9 擬合器（`fitter.js`）

- 介面：`fit(problem, options) → FitResult`，`options.method = 'lm'`（A 版唯一值；B 版新增 DE、DREAM、Nelder–Mead、BFGS 時不改呼叫端）。
- LM：Marquardt 對角縮放；殘差 r_i = (I_i − I_model,i) / w_i。
- Jacobian：數值前向差分，步長 h_j = √ε·max(|p_j|, typical_j)（typical_j 取參數預設值量級）。
- 上下限：試探步超出時截回邊界（projected LM）；結果若落在邊界，該參數標「觸及上限／下限」。
- 終止條件預設與 bumps 1.0.4 `lm` 相同：steps 200、ftol 1e-10、xtol 1e-10；達步數未收斂→標「未收斂」但照樣回報結果。
- 模型輸出含非有限值→該步 χ² 視為 ∞、拒絕該步、加大阻尼。
- 權重（與 SasView 相同四種）：資料 σ（預設）、√I、|I|、不加權。
- **參數誤差**：σ_j = √C_jj，C = (JᵀWJ)⁻¹，**不乘 √χ²ᵣ**（bumps／SasView 慣例；使用者 2026-11-17 決定）。報告 TXT 另列乘上 √χ²ᵣ 的值。C 奇異→誤差顯示「—」並註明「參數相關性過高，無法估計」。
- 自由度 = 有效點數 − 自由參數數；擬合範圍內點數必須 > 自由參數數，否則不允許開始。
- FitResult（凍結）：`{ params, errors, scaledErrors, chi2, chi2r, dof, iterations, status: 'converged'|'maxiter'|'stopped'|'failed', atBound: {name: 'lower'|'upper'}, curve, residuals, settings }`。

### 4.10 Worker 協定

主執行緒與 `fit-worker.js` 以訊息溝通：

| 方向 | 型別 | 內容 |
|---|---|---|
| → | `evaluate` | `{ reqId, modelSpec, params, q }`；Worker 只處理最新的 reqId（latest-wins，舊請求丟棄） |
| ← | `curve` | `{ reqId, I, extras }` |
| → | `fit` | `{ jobId, modelSpec, params, fitFlags, bounds, data, range, weighting, options }` |
| ← | `progress` | `{ jobId, iteration, chi2r }`（每步） |
| ← | `result` | `{ jobId, fitResult }` |
| ← | `error` | `{ reqId|jobId, code, message }` |

- wasm 在 Worker 內以 `fetch` 載入並快取（每模型一次）。
- 「停止」＝`worker.terminate()` 後重建 Worker（立即生效）；序列擬合停止亦同。
- Worker 異常結束→提示並自動重建，可直接重試。
- 單次 evaluate 超過 300 ms 時，預覽改為「計算中…」狀態顯示（不阻擋操作）。

## 5. 介面規格

元素 id 前綴 `sf`。沿用 v5.2 設計系統：`.card`、分組圓角輸入列、分段控制、`ResultTiles`、`ChartTheme.colorize`、語意色 token；**不新增顏色字面值**（`tests/no-color-literals.test.js`）、不加裝飾圖示、不用行內 script／onclick（CSP）。

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
- S(Q) 選單（無／hardsphere／hayter_msa）；不可接 S(Q) 的模型停用並說明。選了 S(Q) 時顯示組合方式與有效半徑模式選單。
- 低 Q 冪律開關。
- 參數表欄位：擬合（☑）｜參數（名稱＋單位）｜數值｜±（擬合後）｜下限｜上限｜PD（僅可多分散參數；點擊展開：分布、寬度、npts、nsigmas）。SLD 參數的數值欄旁有「化學式」按鈕開小面板。
- 數值輸入即時檢查（模型硬限制、下限 < 上限、PD 寬度 ≥ 0、npts 正整數），錯誤以欄位層級提示，不送預覽。
- 參數單位沿用 sasmodels（長度 Å、SLD 10⁻⁶ Å⁻²、scale／background 依模型）。

### 5.4 擬合分段

- Q 範圍（Qmin、Qmax 輸入＋「全範圍」「預設範圍」按鈕；主圖上以灰色顯示範圍外）。
- 權重選單、最大步數（預設 200）。
- 「開始擬合」「停止」「回復擬合前參數」。
- 進度：迭代次數與目前 χ²ᵣ。
- 結果：主角磚＝χ²ᵣ；一般磚＝各擬合參數 值 ± 誤差（單位）；狀態標記（未收斂、觸及上下限、誤差無法估計）。
- 「送進 IUCr 表格」（擬合成功才啟用）、「匯出擬合曲線 CSV」「匯出報告 TXT」。

### 5.5 序列分段（§7）

### 5.6 圖區

- 主圖模式：log-log（I vs q，雙對數）、Guinier（ln I vs q²，線性軸）、Kratky（q²I vs q，線性軸）。三種模式套用到所有顯示中的資料與其模型曲線。
- 疊圖：沿用 8 色系列，第 9 組起重複色並改虛線（站內既有規則）；作用中資料加粗；有擬合結果者畫曲線。
- 殘差圖：(I − I_model)/w，x 軸跟隨主圖模式（log-log、Kratky 用 q；Guinier 用 q²）；只畫作用中資料。
- 縮放沿用 chartjs-plugin-zoom；「重設縮放」。PNG 匯出一律淺色白底（站內規則）。

## 6. 3D 結構示意圖（`shape3d.js`）

- 自寫 Canvas 2D 繪製器：參數化曲面網格→旋轉投影→由遠到近排序（painter's algorithm）→Lambert 明暗；滑鼠拖曳旋轉、滾輪縮放、「重設視角」、「自動旋轉」開關；PNG 匯出。不引入 three.js。
- 顏色只從 `chart-theme.js` 取（新增 3D 用的角色色，兩主題各一組），主題切換時重畫。
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

## 7. 序列擬合（`sequence.js`）

- 範圍：清單中「序列」勾選的資料；沿用目前的模型規格、擬合勾選、上下限、Q 範圍、權重、最大步數。Q 範圍若超出某組資料的有效範圍，該組自動截到可用範圍並在結果列註記。
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
  params: [{ name, value, error, unit, fitted }],
  chi2r, qMin, qMax, npoints, weighting,
  software                          // 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v5.3'
}
```

- IUCr 頁在 Molecular-mass determination 之後新增段落「Model fitting」，列：Data file｜Model｜各參數（Value、±、Unit；固定參數 ± 欄填 fixed）｜q-range for fitting｜χ²ᵣ｜Software。
- 列由 JS 動態產生；所有字串進 `innerHTML` 前經 `FormUtils.escapeHtml`（唯一實作）。現有「複製表格」須包含此段（驗收項）。
- 未送出前此段顯示「尚未送入擬合結果」。

## 9. 匯出（`export.js`）

| 檔案 | 檔名 | 內容 |
|---|---|---|
| 擬合曲線 CSV | `<資料名>_<模型>_fit.csv` | q、I、σ、I_model、殘差、in_range（0/1）；開頭 `#` 註解列出模型與參數 |
| 報告 TXT | `<資料名>_<模型>_report.txt` | 資料檔名與檔頭（能量、q_start、厚度、SF、透射率）；模型、S(Q) 組合與有效半徑模式；多分散設定；各參數值、誤差（不乘／乘 √χ²ᵣ 兩欄）、擬合或固定、觸及邊界；χ²、χ²ᵣ、自由度、點數、q 範圍、權重；演算法與設定、迭代數、狀態；SLD 近似 f≈Z 的註記；軟體與版本 |
| 序列結果 CSV | `<條件名>_sequence.csv` | 序列結果表全部欄位 |
| PNG | 各圖 | 主圖、殘差、3D、趨勢圖；淺色白底 |

CSV 沿用站內慣例：RFC 4180 引號、UTF-8 BOM（`downloadCsv`）。

## 10. 建置流程（`tools/sasfit/`）

- Python 環境：`tools/sasfit/requirements.txt` 鎖定 `sasmodels==1.0.12`、`bumps==1.0.4`、`periodictable`（版本於 Phase 0 鎖定）；`README.md` 說明建立方式。
- emscripten：官方 **emsdk** 安裝於 repo 外（`~/emsdk`），版本於 Phase 0 選定後鎖定並寫入 README 與 `manifest.json`。不用 Homebrew（會自動升級、會拉入 openjdk）。
- `gen_meta.py` → `js/sasfit/models-meta.js`（檔頭：自動產生、勿手改、產生器與 sasmodels 版本）。
- `build_wasm.py` → 以 `sasmodels.generate.make_source(info)['dll']` 取得生成碼 → emcc 編成 `wasm/sas-<model>.wasm`（standalone、無 JS glue、匯出 `<model>_Iq` 與記憶體配置函式）＋`manifest.json`。**禁止 `-ffast-math`** 等改變 IEEE 語意的選項。
- `gen_reference.py` → `tests/fixtures/sasfit/*.json`：以 sasmodels（強制 DLL 雙精度、不走 OpenCL：`SAS_OPENCL=none`）算的參考曲線，及 bumps LM 的參考擬合（§11 G4）。
- 只有新增模型或升級 sasmodels 才需要重跑 `build_wasm.py`；改 JS 不需要 emsdk。產物（meta、wasm、fixtures）皆提交進 repo。

## 11. 測試與驗證

全部接入 `node --test saxs-calculator/tests/*.test.js`（Node 直接 `WebAssembly.instantiate` 讀 wasm 檔）。

| 門檻 | 內容 | 通過標準 |
|---|---|---|
| G1 | wasm＋調度層 vs sasmodels：每模型預設值；每個可多分散參數 × {gaussian, schulz}；6 個可接 S(Q) 模型 × {hardsphere, hayter_msa} × {P*S, β}；有效半徑各模式；低 Q 冪律和模型。q 網格：1e-3–1 Å⁻¹ 對數 200 點＋官方測試點 | \|Δ\| ≤ 1e-9·\|ref\| + 1e-12·max\|ref\| |
| G2 | 手寫 JS（guinier_porod、power_law） | 同 G1 |
| G3 | sasmodels 內附官方測試（清單 15 模型的部分） | sasmodels 自身容許誤差 |
| G4 | 擬合器 vs bumps LM：每類各 1 組合成資料（sasmodels 產生＋固定種子高斯雜訊），同初值 | 參數差 < 0.01σ；誤差相對差 ≤ 2%；χ²ᵣ 相對差 ≤ 1e-3 |
| G5 | data-io：合成官方格式檔與一般檔（公開 fixtures）；真實 `.dat`（`tests/fixtures-local/sasfit/`，`.gitignore` 已擋，缺檔即 skip） | 檔頭欄位、點數、清理標記、預設範圍、條件值正確 |
| G6 | SLD：化學式解析與數值 vs periodictable 的原子量與 Z 獨立計算（例：水 1.0 g/cm³ ≈ 9.420×10⁻⁶ Å⁻²） | 相對差 ≤ 1e-6 |
| G7 | 站內既有測試全部綠燈；`result-golden` fixture 不得重產；版本號一致（`structure.test.js`） | 全過 |
| G8 | Playwright（本機 http.server，text-to-cad venv）：無 console 錯誤；載入合成 `.dat`→預覽→擬合→序列（3 組）→送 IUCr→複製表格→各匯出→3D 渲染非空；淺／深兩主題 axe 0 違規 | 全過 |

- 效能：Phase 0 量測最重組態（core_shell_cylinder＋兩個多分散參數、400 點）的單次評估與一次典型擬合時間，寫進報告；據此訂定預覽／擬合的效能預算，超出者以「計算中…」與進度呈現。
- 科學審查：science-reviewer 審 weights／kernel／product 移植、SLD 公式與預設物質、誤差慣例、清理規則。
- 程式審查：每任務規格＋品質雙審；收尾 code review（CRITICAL／HIGH 必修）。

## 12. 錯誤處理

| 情況 | 行為 |
|---|---|
| 檔案無法解析 | 該檔列顯示原因與行號；其他檔照常 |
| 有效點不足（≤ 自由參數數） | 擬合按鈕停用並說明 |
| wasm 載入失敗（網路、MIME、`file://`） | 擬合頁顯示原因與解法；其他分頁不受影響（wasm 只在本頁載入） |
| Worker 異常結束 | 提示、自動重建、可重試 |
| 模型輸出 NaN／Inf | 該步拒絕；預覽時曲線不更新並提示參數可能不合理 |
| C 奇異 | 誤差「—」＋說明 |
| 未收斂／觸及邊界 | 結果照常顯示＋狀態標記 |
| 輸入不合法 | 欄位層級錯誤訊息；不送預覽、不允許擬合 |

錯誤訊息一律使用者可讀（中文），技術細節寫入 `console.warn`；不吞錯。

## 13. 安全與 CSP

現行 CSP（2026-11-17 實查）已滿足需求，**不需修改**：`script-src 'self' … 'wasm-unsafe-eval'`（WebAssembly）、`connect-src 'self' …`（fetch 本機 .wasm）、`worker-src 'self' blob:`（本機 Worker）。新程式不得使用行內 script、`onclick=""`、`eval`；所有來自檔案名稱、檔頭、使用者輸入的字串進 `innerHTML` 前經 `FormUtils.escapeHtml`。

## 14. 開發順序與發佈

1. **Phase 0（可行性閘門）**：安裝並鎖定 emsdk；編 sphere、cylinder、hayter_msa；在 Node 跑出 G1 等級一致性；量測效能。產出簡短報告。
   - 通過→進入正式實作。
   - 某模型無法編譯或無法達 G1→該模型退回手寫 JS（方案二），**先回報使用者再繼續**。
2. 正式實作：依實作計畫（writing-plans 產出）逐任務 TDD、雙審。
3. 分支 `feat/sasfit`；完成後版本 v5.3（footer `Version` 與所有本機 `?v=` 同步）。
4. 依使用者 2026-10-15 授權：規格與計畫核准後，實作→驗證→審查→合併→push→線上冒煙測試一路完成，最後一次回報；**新的科學判斷仍須詢問**。

## 15. 科學決策紀錄

| # | 決策 | 理由 | 日期／來源 |
|---|---|---|---|
| 1 | 計算核心＝sasmodels C 原樣編成 wasm（方案一） | 與 SasView 同一份程式碼、擴充 B 版成本低、速度 | 使用者 2026-11-17 |
| 2 | 參數誤差不乘 √χ²ᵣ；報告兩種都列 | 13A 資料有實測 σ；與 bumps／SasView 一致 | 使用者 2026-11-17 |
| 3 | X 光 SLD 取 f ≈ Z | A 版夠用；f′ 表留 B 版 | 設計第 3 段，使用者同意 |
| 4 | 預設 Qmin 取 q_start 與首個 σ>0 點的較大者 | 避開 beamstop 區（實查 B1216 檔前段 I<0、σ=0） | 同上 |
| 5 | I ≤ 0 點參與擬合、僅 log 顯示時隱藏 | σ 權重的 χ² 對負值無問題；刪點會偏差 | 同上 |
| 6 | S(Q) 僅開放 6 個有 Fq＋有效半徑模式的形狀模型；PD 只開 P 的尺寸參數 | 與 sasmodels product 的完整能力對齊、避免無定義組合 | 同上 |
| 7 | cutoff = 0 | 與 `direct_model` 預設一致，數值可對齊 | 同上 |
| 8 | LM 預設 steps 200、ftol／xtol 1e-10 | bumps 1.0.4 實查預設 | 同上 |
| 9 | 低 Q 冪律與模型共用 background | 等價 sasmodels 和模型，可驗證 | 設計第 3 段 |
| 10 | IUCr 需手動送出 | 試錯擬合不覆蓋表格 | 設計第 4 段 |
| 11 | 3D 自寫 Canvas | 避免 600 KB 以上的 three.js 與模組／CSP 成本 | 設計第 2 段 |
| 12 | 不支援 `file://` | 使用者確認不會這樣開 | 使用者 2026-11-17 |

## 16. 已知限制與 B 版候選

- 其餘 64 個 sasmodels 模型（C 核心者重編即可）；
- 演算法：DE、DREAM（後驗分布與參數相關性）、Nelder–Mead、BFGS；
- 解析度修正（pinhole ΔQ/Q；官方 `.dat` 可選輸出 dQ）；
- 異常散射 f′／f″（能量相依 SLD）；
- 多組資料共用參數的聯合擬合、參數約束式；
- 專案存檔／讀檔；
- GitHub Actions 雲端編 wasm（換電腦免裝 emsdk）；
- 標準化 Kratky（需 Rg、I(0)）。

## 17. 授權與致謝

- `wasm/LICENSE-sasmodels.txt` 放 sasmodels 1.0.12 授權全文（取自其 dist-info `licenses/`）。
- 分頁說明與報告 TXT 註明：「模型計算核心：SasView sasmodels 1.0.12（BSD-3-Clause），C 原始碼原樣編譯為 WebAssembly」。
