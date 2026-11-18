# SAS 模型擬合 M2（Worker＋擬合器）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 的 `SasFitEvaluate.evaluate` 之上加入權重與遮罩、Levenberg–Marquardt 擬合器（誤差算法比照 bumps）、以及把計算搬進 Web Worker 的整套機制，通過 G4（對 bumps `lm`）並在真實瀏覽器裡跑通一次預覽與擬合。

**Architecture:** 擬合器是與模型無關的純函式：吃一個「參數向量 → 殘差向量」的函式與上下限，回傳凍結的 FitResult。`sasfit-worker-core.js` 把「訊息 → 計算 → 訊息」寫成純邏輯（wasm 載入器與 `postMessage` 以參數注入，Node 可測）；`sasfit-worker.js` 只是薄薄的 Worker 入口；`sasfit-worker-client.js` 在主執行緒管理 Worker 生命週期。本里程碑沒有任何畫面。

**Tech Stack:** Vanilla JS classic scripts（IIFE＋`globalThis.SasFitXxx`）、Web Worker（classic，`importScripts`）、Node 26 `node --test`；Python venv `tools/sasfit/.venv`（sasmodels 1.0.12、bumps 1.0.4、numpy）只用來產生參考值；Playwright（`~/Projects/text-to-cad/.venv`）做瀏覽器冒煙測試。

**規格：** `docs/superpowers/specs/2026-11-17-sasfit-a-design.md` §3.3、§4.8、§4.9、§4.10、§11（G4、G5 的權重部分）、§12、§16（hayter_msa 限制）。**前置：** M1 完成紀錄見 `docs/superpowers/plans/2026-11-18-sasfit-m1-compute-core.md` 末段。

---

## 全體任務共用規則

M1 計畫的「全體任務共用規則」第 1–8 條全部沿用（模組慣例、每新增一個 `js/sasfit-*.js` 同一個 commit 內加 `index.html` 的 `<script>` 與 `tests/load.js`、不改既有 fixture、不放寬容許誤差、commit 不加署名行、對不上就停下來回報）。本里程碑另加：

1. **載入順序**（規格 §3.3，M1 已加入 validate）：meta → validate → weights → kernel → product → py-models → evaluate → **weighting → fitter → worker-core → worker-client**。`sasfit-worker.js` **不**加進 `index.html`，也不加進 `LOAD_ORDER`。
2. 參考值產生器一律先呼叫 `tools/sasfit/sas_env.py` 的 `configure()`（關閉 FMA 的原生編譯），再 import sasmodels／bumps；明確傳 cutoff＝1e-5。
3. **hayter_msa 會回傳 NaN 或跳點**（規格 §16）：擬合器遇到非有限的模型輸出時，該步視為 χ²＝∞、拒絕、加大阻尼——這是預期中的輸入，不是例外狀況，不得丟 Error。
4. `q` 一律是 `Float64Array`（M1 的 `SasFitValidate.checkQ` 會擋）；跨 Worker 邊界的資料只能是可結構化複製的純資料（數字、字串、純物件、TypedArray），不得傳函式或凍結狀態的假設（接收端自行 freeze）。
5. 執行順序：Task 1 → 2 → 3 → 4 → 5 → 6 依序。Task 2（純 Python）可與 Task 1 平行。

## 效能決定（依 M1 實測）

400 個 q 點單次計算：球形類含 `@hayter_msa` 多分散 ≤ 1.2 ms；cylinder 單參數多分散 25 ms；cylinder 兩參數各 35 點 789 ms。A 版**不做**多 Worker 平行（複雜度高、只有兩參數同時多分散的圓柱類受益），照規格 §11 以進度顯示處理慢的組態：擬合每步回報進度並可隨時停止；預覽由呼叫端決定送多少 q 點（M3 的事）。多 Worker 分 q 平行列入 B 版候選（Task 6 更新規格 §16）。

## 介面

```js
// sasfit-weighting.js —— 純函式；主執行緒與 Worker 共用（規格 §4.8）
SasFitWeighting.MODES = ['sigma', 'sqrtI', 'absI', 'none']
SasFitWeighting.weights(dataset, mode) → Float64Array              // w_i；mode 'sigma' 而 dataset.sigma 為 null → Error
SasFitWeighting.mask(dataset, mode) → Uint8Array                   // 1＝可參與：finite(q)、q>0、finite(I)、finite(w)、w>0
SasFitWeighting.defaultMode(dataset) → 'sigma' | 'none'            // 有 sigma 用 'sigma'，否則 'none'
SasFitWeighting.defaultRange(dataset, mode) → { qMin, qMax } | null
   // qMin = max(dataset.header.qStart（僅 kind 'official' 且為有限正數）, 第一個可參與點的 q)；qMax = 最後一個可參與點的 q；沒有可參與點 → null
SasFitWeighting.select(dataset, mode, range) → { index: Uint32Array, q, I, w: Float64Array }
   // 可參與且 qMin ≤ q ≤ qMax 的點；index 是在原資料中的位置
// dataset = { q, I: Float64Array, sigma: Float64Array|null, kind, header }（規格 §4.8 的 Dataset；這個模組只讀這幾欄）

// sasfit-fitter.js —— 與模型無關
SasFitFitter.fit(problem, options) → FitResult（凍結）
   // problem = { names: string[], start: number[], lower: number[], upper: number[],
   //             residuals(p: Float64Array) → Float64Array }   // r_i = (I_i − I_model,i)/w_i；可含非有限值
   // options = { method: 'lm', maxSteps = 200, ftol = 1e-10, xtol = 1e-10,
   //             onProgress({ iteration, chi2 }) 可省略, shouldStop() 可省略 }
   // FitResult = { names, values, errors, illConditioned, chi2, dof, chi2r, iterations,
   //               status: 'converged'|'maxiter'|'stopped'|'failed', atBound: { [name]: 'lower'|'upper' }, covariance }
   //   errors＝√diag(C)，不乘 √χ²ᵣ（顯示規則在 worker-core 處理）
   //   dof = residuals.length − names.length；≤ 0 → Error（呼叫端要先擋）
SasFitFitter.jacobian(residuals, p, lower, upper) → { J /*列優先 Float64Array m×n*/, m, n }   // 前向差分，規格 §4.9
SasFitFitter.covariance(J, m, n) → { C, illConditioned }                                    // SVD，奇異值下限 1e-8
SasFitFitter.svd(A, m, n) → { s, V }                                                        // one-sided Jacobi；只需要 s 與 V

// sasfit-worker-core.js —— 純邏輯
SasFitWorkerCore.create({ loadWasm(modelName) → Promise<ArrayBuffer|Uint8Array>, post(message) }) → core
core.handle(message) → Promise<void>      // 規格 §4.10 的 evaluate／fit；錯誤一律轉成 error 訊息，不外拋
SasFitWorkerCore.buildFitResult(...)      // 規格 §4.9 的 FitResult 全欄位（含 errorsScaled、displayErrorsScaled、curve、residuals、settings）
SasFitWorkerCore.modelsOf(modelSpec) → string[]   // 需要哪些 wasm（P、S；js 模型不需要）

// sasfit-worker-client.js —— 主執行緒
SasFitWorkerClient.create({ createWorker 可注入（測試用） }) → client
client.evaluate({ modelSpec, params, q, opts }) → Promise<{ I, extras }>    // latest-wins：被新請求取代的舊請求以 { superseded: true } reject
client.fit(job, { onProgress }) → Promise<FitResult>
client.stop()                         // terminate＋重建；進行中的 fit 以 status 'stopped' 的結果 resolve（保留擬合前參數），evaluate reject
client.version                        // 取自 document.currentScript.src 的 ?v=
```

**訊息協定**照規格 §4.10 表格；`fit` 訊息的內容：

```js
{ type: 'fit', jobId, modelSpec, params /*全部參數的目前值，扁平*/,
  fitFlags /*{ name: true }：要擬合的參數名稱，含 *_pd 與 lowq_**/, bounds /*{ name: [lo, hi] }*/,
  data /*{ q, I, sigma|null, kind, header }*/, range /*{ qMin, qMax }*/, weighting /*MODES 之一*/,
  options /*{ maxSteps, cutoff }*/ }
```

---

### Task 1: `sasfit-weighting.js`

**Files:** Create `saxs-calculator/js/sasfit-weighting.js`, `saxs-calculator/tests/sasfit-weighting.test.js`；Modify `index.html`、`tests/load.js`。

規格 §4.8「權重」「清理」兩段與表格。原創程式（非移植），不需 BSD 檔頭。

- [ ] **Step 1：寫失敗的測試**（期望值手算，寫在測試裡）：
  - 四種模式的 `weights`：`sigma`→σ_i；`sqrtI`→√|I_i|；`absI`→|I_i|；`none`→1。
  - `mask`：用一組刻意構造的資料逐點斷言——σ＝0、σ<0、σ＝NaN、I＝0、I<0（σ 有效）、I＝NaN、q＝0、q<0、q＝NaN、q＝Infinity。重點：**I<0 且 σ>0 的點在 `sigma` 模式下可參與**（規格 §15 決策 5）；I＝0 的點在 `sqrtI`、`absI` 下不可參與、在 `sigma`、`none` 下可參與。
  - `defaultRange`：模擬官方檔（前 5 點 I<0、σ＝0；`header.qStart`＝0.005）——`sigma` 模式 qMin 取 qStart 與首個可參與點的較大者；`none` 模式（前段點都可參與）qMin＝qStart；`kind: 'generic'` 時忽略 qStart；全部不可參與 → null。
  - `select`：回傳的點數、`index`、範圍邊界含等號；`sigma` 為 null 而 mode 為 `'sigma'` → Error；不認得的 mode → Error（含名稱）。
  - 不修改傳入的 dataset；回傳的陣列是新配置的。
- [ ] **Step 2：** 跑測試確認失敗 → 實作 → 通過；加 `<script>`（接在 `sasfit-evaluate.js` 之後）與 `LOAD_ORDER`；全綠。
- [ ] **Step 3：** Commit `feat: sasfit weighting, fit mask and default range`。

### Task 2: 擬合參考值（純 Python，可與 Task 1 平行）

**Files:** Create `tools/sasfit/gen_reference_fit.py`, `saxs-calculator/tests/fixtures/sasfit/{svd,fit}.json`。

先讀：`tools/sasfit/gen_reference.py`、`ref_common.py`、`sas_env.py`（沿用其寫檔與環境設定方式）；bumps 1.0.4 的 `fitters.py`（`MPFit` 類、`FitDriver`、`fit` 函式）、`lsqerror.py`（`jacobian`、`jacobian_cov`、`stderr`）、`mpfit.py`（終止條件）；sasmodels `bumps_model.py`（`Model`、`Experiment(data, model, cutoff=1e-5)`）。

- [ ] **Step 1：`svd.json`** —— 8 個矩陣（m×n：5×3、20×6、50×12、一個秩不足、一個條件數 1e12、一個欄尺度差 1e8、一個 1×1、一個 n＝1）以固定種子產生，存 `A`、numpy `linalg.svd` 的奇異值（遞減）、以及 `jacobian_cov` 等價的 `C = V·diag(1/max(s,1e-8)²)·Vᵀ`（從 `lsqerror.py` 讀實際算式照做，直接呼叫 bumps 的函式）。
- [ ] **Step 2：`fit.json`** —— 規格 §11 G4：每類各 1 組合成資料（sasmodels 產生理論曲線＋固定種子高斯雜訊，σ_i 取 3%·I＋小常數），另加規格要求的 PD 寬度案例與幾個擬合器特有的情境。q＝`logspace(-2.3, -0.5, 120)`。案例：
  1. `sphere`：擬合 scale、radius、background。
  2. `core_shell_sphere`：擬合 radius、thickness、scale（sld 固定）。
  3. `cylinder`：擬合 radius、length、scale。
  4. `mono_gauss_coil`：擬合 i_zero、rg、background。
  5. `sphere@hardsphere`：擬合 radius、volfraction、scale。
  6. `sphere` 擬合 radius 與 **`radius_pd`**（schulz、n 80、nsigma 3；`radius_pd` 上下限 [0, 0.4]）。
  7. `sphere`＋低 Q 冪律：擬合 radius、lowq_scale、background（和模型 `sphere+power_law`，對應方式見 M1 計畫 Task 2 Step 3 第 6 點）。
  8. 觸及邊界：`sphere` 擬合 radius，上限設在真值之下（bumps 的結果會貼在上限）。
  9. 權重模式：案例 1 的資料分別以 √|I|、|I|、不加權擬合——bumps 端把 `dy` 換成對應的 w_i（`Experiment` 的殘差是 (theory − y)/dy）。
  每案存：`modelSpec`、扁平 `params` 起始值（真值偏移 10–30%）、`fitFlags`、`bounds`、`data {q, I, sigma}`、`weighting`、以及 bumps 結果 `{ values, stderr, chi2, dof, chi2r, covariance }`——用 `FitDriver(fitclass=MPFit …)` 或 `bumps.fitters.fit(problem, method='lm', steps=200, ftol=1e-10, xtol=1e-10)`，誤差取 bumps 回報的 `dx`（先讀 `fitters.py` 確認 lm 的 `dx` 確實來自 `lsqerror.stderr(jacobian_cov(jacobian(...)))`、而且**沒有**乘 √χ²ᵣ；有出入就照原始碼記錄並回報）。chi2 的定義（總和還是除以自由度、有沒有 1/2 因子）也照原始碼確認後，統一存「Σr²」與「Σr²/dof」。
  腳本斷言：每案 bumps 都收斂；案例 8 的 radius 落在上限；案例 6 的 `radius_pd` 嚴格在 (0, 0.4) 內。
- [ ] **Step 3：** 另存每案在 **bumps 最佳解處**的 `jacobian`（`lsqerror.jacobian` 的輸出）與 `residuals`——Task 3 用來分別驗證 JS 的 Jacobian、共變異與 LM，三者不要只靠最終結果一起驗。
- [ ] **Step 4：** 連跑兩次 `shasum` 確認逐位元穩定；既有的 6 個 fixture 檔不得變動（`git status` 確認）；全部既有測試仍綠。
- [ ] **Step 5：** Commit `test: sasfit fit references from bumps 1.0.4 lm`。

### Task 3: `sasfit-fitter.js`

**Files:** Create `saxs-calculator/js/sasfit-fitter.js`, `saxs-calculator/tests/sasfit-fitter.test.js`；Modify `index.html`、`tests/load.js`。

規格 §4.9 全段。原創程式；檔頭註明誤差算法比照 bumps 1.0.4 `lsqerror.py`（演算法層級的對應，不是逐行移植）。若超過約 500 行，把 SVD 拆成 `sasfit-linalg.js`（載入順序排在 fitter 之前，同樣接線並回報）。

- [ ] **Step 1：寫失敗的測試**（分層，每層獨立可失敗）：
  - **SVD**：`svd.json` 每個矩陣——奇異值（排序後）對 numpy，相對 1e-10（以最大奇異值為尺度的絕對誤差 1e-12）；`V` 的欄正交（VᵀV＝I 到 1e-12）；重建檢查 ‖A·V − U·S‖ 以 A·V 的欄範數等於 s 驗證。秩不足與 1×1 也要過。
  - **共變異**：`svd.json` 的 `C` 對 `covariance(A, m, n)`，相對 1e-8；奇異值被代換的矩陣 `illConditioned === true`，其餘 false。
  - **Jacobian**：用 `fit.json` 每案在 bumps 最佳解處——以 M1 的 `SasFitEvaluate`＋Task 1 的 weighting 組出 `residuals(p)`，`SasFitFitter.jacobian` 對 bumps 的 jacobian，相對 1e-6（兩邊步長相同 h＝1e-4·|p|，差異只來自模型的 1e-9 級差異被 1/h 放大；若符號慣例相反（bumps 殘差是 theory−y）以測試中的註解說明並在比較時統一）。上限處改後向差分：構造 p_j + h_j > upper 的情況斷言用了 p_j − h_j。
  - **G4（LM）**：`fit.json` 每案由相同起始值擬合——參數差 < 0.01σ（σ＝bumps stderr）；誤差相對差 ≤ 2%；χ²ᵣ 相對差 ≤ 1e-3（規格 §11）。案例 8：`atBound` 標出 radius 為 `'upper'`、值恰等於上限。測試印出每案的三個比值。
  - **行為**：`maxSteps: 3` → `status 'maxiter'` 且仍回傳完整結果；`shouldStop` 第 2 步回 true → `'stopped'`；殘差函式在某些 p 回傳含 NaN 的向量 → 不丟錯、該步被拒絕、最後仍收斂（以「radius > 某值時回 NaN」的包裝函式構造）；起始點就非有限 → `status 'failed'`；`onProgress` 每個被接受的步呼叫一次、iteration 遞增、chi2 不增；`dof ≤ 0` → Error；`start` 超出上下限 → 截回邊界後開始；不修改傳入的 `problem` 與陣列；回傳物件 frozen。
  - **決定性**：同輸入跑兩次結果逐位元相同。
- [ ] **Step 2：** 跑測試確認失敗 → 實作。LM：Marquardt 對角縮放、projected step（試探步超出上下限截回）、終止條件比照 MPFit 的 ftol／xtol 語意（先讀 bumps `mpfit.py` 的收斂判斷再寫）、迭代中的 Jacobian 與最後算共變異的 Jacobian 用同一個函式。
- [ ] **Step 3：** G4 若有案例達不到門檻：先確認 JS 的 χ² 是否 ≤ bumps 的 χ²（JS 找到同樣好或更好的極小值時，問題在比較基準而非擬合器），並把兩邊的解互相代入對方的殘差函式比 χ²；仍不符就停下來回報，不要調門檻。
- [ ] **Step 4：** 加 `<script>` 與 `LOAD_ORDER`；全綠。Commit `feat: sasfit LM fitter with bumps-compatible covariance; G4 passes`。

### Task 4: `sasfit-worker-core.js`

**Files:** Create `saxs-calculator/js/sasfit-worker-core.js`, `saxs-calculator/tests/sasfit-worker-core.test.js`；Modify `index.html`、`tests/load.js`。

規格 §4.9（FitResult 欄位與誤差顯示規則）、§4.10、§12。

- [ ] **Step 1：寫失敗的測試**（`loadWasm` 用 `tests/sasfit-helpers.js` 的 `loadWasm` 包成 Promise 並計數；`post` 收集訊息）：
  - `evaluate`：sphere 預設值 → 一則 `curve` 訊息，`I` 等於直接呼叫 `SasFitEvaluate` 的結果；wasm 每個模型只載一次（連送 5 次，`loadWasm('sphere')` 計數為 1）；P@S 會載兩個。
  - **latest-wins**：在 `loadWasm` 尚未 resolve 時連送 reqId 1、2、3 → 只回 reqId 3 的 `curve`（1、2 不回任何訊息）。
  - `fit`：用 `fit.json` 案例 1 的訊息 → 若干 `progress`（iteration 遞增）後一則 `result`；`fitResult` 具備規格 §4.9 列出的全部欄位；`params` 含全部參數（擬合的取新值、固定的照舊）；`curve` 長度等於**全部**資料點（不是只有範圍內的點），`residuals` 在不可參與或範圍外的點為 `NaN`；`settings` 記錄 modelSpec、weighting、range、cutoff、maxSteps、演算法名稱。
  - **誤差顯示規則**（規格 §15 決策 2、16）：`weighting: 'sigma'` → `displayErrorsScaled === false`、顯示值＝`errors`；其餘三種 → `true`、顯示值＝`errorsScaled`（＝errors·√χ²ᵣ）；兩組數字都在結果裡。用案例 9 驗證。
  - 範圍內可參與點數 ≤ 自由參數數 → `error` 訊息 code `'TOO_FEW_POINTS'`，不開始擬合。
  - 錯誤一律轉成 `error` 訊息（帶 reqId 或 jobId、`code`、使用者可讀的中文 `message`）：未知模型、`loadWasm` reject（code `'WASM_LOAD'`）、參數不合法（M1 丟的 Error）、未知訊息型別。`core.handle` 本身不 reject。
  - hayter_msa：以規格 §16 記錄的會出 NaN 的參數做一次 `evaluate` → 回 `curve`（含 NaN），不是 `error`。
  - 送進來的訊息物件未被修改。
- [ ] **Step 2：** 跑測試確認失敗 → 實作 → 通過；加 `<script>` 與 `LOAD_ORDER`；全綠。
- [ ] **Step 3：** Commit `feat: sasfit worker message core`。

### Task 5: Worker 入口、主執行緒端、守門測試

**Files:** Create `saxs-calculator/js/sasfit-worker.js`, `saxs-calculator/js/sasfit-worker-client.js`, `saxs-calculator/tests/sasfit-worker-client.test.js`；Modify `saxs-calculator/tests/structure.test.js`、`index.html`、`tests/load.js`（只加 worker-client）。

規格 §3.3（版本策略、守門測試變更第 1 點）、§4.10。**這是本計畫唯一允許修改既有守門測試的任務，而且只限規格 §3.3 第 1 點列出的變更。**

- [ ] **Step 1：`structure.test.js`**（先讀懂現有的「index.html 引用每一個 js」測試怎麼寫）：
  - 新增常數 `WORKER_ONLY = ['sasfit-worker.js']`，從該要求中排除（並斷言這些檔**沒有**出現在 index.html）。
  - 新測試：解析 `sasfit-worker.js` 的 `importScripts` 清單 ＝ `['sasfit-meta.js','sasfit-validate.js','sasfit-weights.js','sasfit-kernel.js','sasfit-product.js','sasfit-py-models.js','sasfit-evaluate.js','sasfit-weighting.js','sasfit-fitter.js','sasfit-worker-core.js']`；每檔存在；相對順序與 index.html 一致。
  - 新測試：`sasfit-worker.js` 與 `sasfit-worker-client.js` 的原始碼不含寫死的版本字串（不得出現 `?v=` 後接數字）；worker-client 以 `document.currentScript` 取版本；worker 以 `self.location.search` 取版本並附加到每個 `importScripts` 與 wasm 網址。
  - 先跑，確認新測試因檔案不存在而失敗、既有測試不受影響。
- [ ] **Step 2：`sasfit-worker.js`**：讀 `self.location.search` 的 `v`；`importScripts` 上述清單（每個網址帶 `?v=`；以相對於 worker 自身位置的路徑）；`loadWasm(name)` ＝ `fetch('../wasm/sas-' + name + '.wasm?v=' + v)` → 非 2xx 丟帶狀態碼的 Error → `arrayBuffer()`；`SasFitWorkerCore.create({ loadWasm, post: (m) => self.postMessage(m) })`；`self.onmessage = (e) => core.handle(e.data)`。模型名稱在組網址前以 `SasFitMeta.models` 白名單檢查（不得把任意字串拼進網址）。檔案要短（目標 < 60 行），邏輯都在 worker-core。
- [ ] **Step 3：`sasfit-worker-client.test.js`**（以假的 `createWorker` 注入：一個有 `postMessage`／`terminate`／`onmessage`／`onerror` 的物件，測試手動餵訊息）：
  - `evaluate` 送出正確的訊息並在 `curve` 回來時 resolve；連送兩次 → 第一個以 `{ superseded: true }` reject；回來的舊 reqId 訊息被忽略。
  - `fit`：`progress` 轉給 `onProgress`；`result` resolve；`error` 訊息 → reject 帶 `code` 與 `message`。
  - `stop()`：呼叫了 `terminate`、重建了新的 worker、進行中的 `fit` 以 `status: 'stopped'` 的結果 resolve、進行中的 `evaluate` reject。
  - Worker 的 `onerror` → 進行中的請求全部 reject（code `'WORKER_CRASH'`）、自動重建、之後的請求可用。
  - 版本：`create` 可注入 `version`（測試用）；Worker 網址為 `js/sasfit-worker.js?v=<version>`。模組頂層在沒有 `document` 的環境（Node、`tests/load.js`）不得丟錯。
- [ ] **Step 4：** 實作 → 全綠（含 Step 1 的 structure 測試）。`index.html` 與 `LOAD_ORDER` 只加 `sasfit-worker-client.js`（排在 worker-core 之後）。
- [ ] **Step 5：** Commit `feat: sasfit web worker entry and client; structure guards for worker files`。

### Task 6: 瀏覽器冒煙測試、審查、收尾

**Files:** Create `tools/sasfit/smoke_browser.py`；Modify 規格書、本計畫、`tools/sasfit/README.md`。

- [x] **瀏覽器冒煙**（Playwright，`~/Projects/text-to-cad/.venv/bin/python`；`python3 -m http.server` 開在 `saxs-calculator/`，隨機埠，結束時關掉）：
  1. 開首頁，收集 console 訊息與 pageerror —— 不得有 error（CLAUDE.md 的要求；M1 以來還沒做過）。
  2. `page.evaluate`：`SasFitWorkerClient.create()` → `evaluate` sphere 預設值（200 點）→ 與同頁主執行緒直接算的結果逐點相同（主執行緒自己 fetch wasm 來算）。
  3. `evaluate` `sphere@hayter_msa`（載入兩個 wasm）。
  4. 用頁面內合成的含雜訊 sphere 資料 `fit` → `status 'converged'`、radius 落在真值 ±3σ、收到至少 2 則 progress。
  5. `stop()`：送出一個慢的擬合（cylinder 兩參數多分散）後 200 ms 呼叫 `stop()` → 1 秒內以 `'stopped'` resolve，之後再 `evaluate` 可用。
  6. 檢查網路請求：`sasfit-worker.js`、worker 內每個 `importScripts`、每個 `.wasm` 的網址都帶 `?v=` 且版本等於 footer 的版本；`.wasm` 回應的 `content-type` 記錄下來（`http.server` 給 `application/wasm`；GitHub Pages 亦然——在報告中註明這點未在線上驗證）。
  7. 量測並回報（瀏覽器內、Worker 內）：sphere 多分散 80 點、cylinder 單參數 35 點、cylinder 兩參數 35×35 的單次 evaluate 時間；案例 1 擬合的總時間。
  腳本結束碼反映成敗；用法寫進 `tools/sasfit/README.md`。
- [x] **科學審查**（獨立子代理，唯讀）：weighting 規則對規格 §4.8 與 SasView `residuals_help`；fitter 的 LM、Jacobian 步長、共變異、誤差定義對 bumps 原始碼；G4 案例是否真的涵蓋規格 §11、有沒有案例被弱化；誤差顯示規則；自行設計至少 10 組不在 fixture 的擬合與 bumps 比對（含一組 hayter_msa、一組起始值離真值 3 倍、一組強相關參數）。
- [x] **程式審查**（code-reviewer，唯讀）：`git diff bb5a2af..HEAD`；重點在 Worker 生命週期與競態、訊息驗證、錯誤路徑、記憶體（長時間擬合 wasm 記憶體不成長）、worker 入口的網址組裝。
- [x] 修正 CRITICAL／HIGH 後全測試綠。
- [x] **文件**：規格 §16 B 版候選加「多 Worker 分 q 平行（兩參數同時多分散的圓柱類）」；規格 §11 效能段落填入瀏覽器實測數字；本計畫末尾加「M2 完成紀錄」。Commit。

---

## 審查修正（2026-11-18；與上文衝突時以本節為準）

獨立審查者對照 bumps 1.0.4／sasmodels 1.0.12 原始碼並實跑後提出，以下逐條取代上文對應內容。

### A. G4 的比較基準改為「精修到真正極小值」（規格 §15 決策 20）

bumps 的 `lm`（MPFit）迭代時用自己的前向差分 Jacobian，步長 h＝√1.19209e-7·|p|≈3.45e-4·|p|（`bumps/fitters.py:711`、`mpfit.py:1561,1587,2349`），梯度有偏，會停在離真正極小值稍遠處，距離隨起始值與雜訊種子而變：bumps 自己從三個起始值擬合 sphere，radius 就差 0.0055σ；core_shell_sphere 在某些種子下「真正極小值 vs bumps」達 0.019σ。所以「JS vs 原始 bumps < 0.01σ」對正確的擬合器也不保證成立。

- **Task 2**：每案的參考 `values` ＝ bumps `lm` 的結果再以 `scipy.optimize.least_squares(f, x_bumps, jac='3-point', method='lm', xtol=1e-15, ftol=1e-15, gtol=1e-15)` 精修（f 為 `problem.residuals` 的包裝；有上下限的案例若精修需要界限，改用 `method='trf'` 並給 bounds）。`stderr`、`covariance`、`jacobian`、`residuals` 都在**精修後的點**用 bumps 的 `lsqerror` 重算。另存 `bumpsRaw: { values, stderr }`，腳本斷言 raw 與精修值相差 < 0.02σ（證明是同一個解），並把每案的實際差距印出來寫進 commit message。
- **Task 3 的 G4**：JS 對精修值——參數差 < 0.01σ；誤差相對差 ≤ 2%；χ²ᵣ 相對差 ≤ 1e-3。達不到時照 Task 3 Step 3 的程序（比 χ²、互相代入），不調門檻。
- 規格 §11 G4 列與 §15 新增第 20 列的文字由 Task 2 一併修改（決策「G4 的參數基準取 bumps lm 結果精修後的真正極小值」、理由如上、來源「2026-11-18 M2 計畫審查實測」）。

### B. Task 2 的具體做法（已驗證可用的範本）

```python
import sas_env; sas_env.configure()           # 必須在 import sasmodels 之前
from sasmodels.core import load_model
from sasmodels.data import Data1D
from sasmodels.direct_model import DirectModel
from sasmodels.bumps_model import Model, Experiment
from bumps.fitproblem import FitProblem
from bumps.fitters import FitDriver, MPFit, fit as bumps_fit
from bumps import lsqerror
Q = np.logspace(-2.3, -0.5, 120)
kern = load_model("sphere")
I = DirectModel(Data1D(x=Q, y=np.zeros_like(Q), dy=np.ones_like(Q)), kern, cutoff=1e-5)(**truth)
sig = 0.03*np.abs(I) + 1e-4                   # mono_gauss_coil 用 1e-3
y = I + np.random.default_rng(seed).normal(size=I.size)*sig
model = Model(kern, **start_pars)             # 含 radius_pd_type/_n/_nsigma
model.radius.range(1, 1000); model.scale.range(0, np.inf); model.background.range(-np.inf, np.inf)
problem = FitProblem(Experiment(Data1D(x=Q, y=y, dy=w), model, cutoff=1e-5))
res = bumps_fit(problem, method="lm", steps=200, ftol=1e-10, xtol=1e-10)   # res.x, res.dx, res.nit, res.dof
problem.setp(res.x); names = problem.labels(); r = problem.residuals(); J = lsqerror.jacobian(problem, res.x)
```

- **參數順序**：`problem.labels()` 的順序不是設定 range 的順序（案例 1 回 `['background','radius','scale']`）；`x`、`dx`、cov、Jacobian 的欄都照 labels。fixture 一律存 `names` 並以名稱為鍵。和模型的名稱（`A_radius`、`B_scale`）轉回扁平名稱（`radius`、`lowq_scale`）。
- **收斂判定**：bumps 不回報狀態（`fitters.py:705-738` 丟掉、`1825-1831` 寫死 success）。改用 `res.nit < steps`，外加「從解再擬合一次，移動 < 1e-3σ」。
- **bumps 的定義**（寫進 fixture 頂層 `conventions`）：殘差＝(theory − I)/dI（與本站 r 符號相反，C 不受影響）；`nllf`＝½Σr²；`problem.chisq()`＝Σr²/dof；dof＝點數−擬合參數數；`dx`＝`lsqerror.stderr(jacobian_cov(jacobian(problem, x)))`，**沒有**乘 √χ²ᵣ。fixture 存 `sumsq`（Σr²）、`dof`、`chi2r`。
- **權重案例**：`Experiment` 原樣使用 `data.dy`，只遮 NaN 的 y 與 q 範圍，**不遮 dy ≤ 0**（dy＝0 會得到 −inf 殘差）。產生器必須自己先套用本站的遮罩（Task 1 的規則）再建 `Data1D`。
- **案例 6**：兩邊都明確給 `radius_pd_type='schulz'`、`radius_pd_n=80`、`radius_pd_nsigma=3`（bumps `Model` 預設 pd_n 35 gaussian，`bumps_model.py:71-80`；JS 預設 pd_n 0）。
- **案例 8 改掉**（原案 bumps 會跳到下限 radius＝1）：
  - 8a（上限）：`mono_gauss_coil` 擬合 i_zero、rg，rg 範圍 [1, 70]、真值 75——bumps 得 rg 恰為 70.0。
  - 8b（下限）：自選一個同樣穩定落在下限的案例（例：真值在下限之下），腳本斷言值**恰等於**邊界，且從兩個起始值得到相同結果。
  - 貼邊界的參數：值恰等於邊界（`mpfit.py:1242-1247`）；stderr／cov 仍是有限值、把它當自由參數以後向差分算（`lsqerror.py:105`）。JS 不得把那一列歸零或移除。
- ±inf 的上下限在 JSON 用既有的 `"inf"`／`"-inf"` 字串（`tests/sasfit-helpers.js` 的 `num`）。
- 雜訊：`np.random.default_rng(seed)`，每案固定種子寫在腳本裡。

### C. `svd.json` 與 Task 3 的 SVD／共變異／Jacobian 測試

- 測試矩陣由**已知的 (U, s, V)** 組成：A＝U·diag(s)·Vᵀ（U、V 取隨機矩陣的 QR），參考值存**精確的** s 與精確的 C＝V·diag(1/max(s,1e-8)²)·Vᵀ，不以 numpy 的 SVD 為基準（條件數 1e12 時 LAPACK 的最小奇異值誤差 1.8e-5，Jacobi SVD 反而更準）。bumps 的 `jacobian_cov` 只在條件數 ≤ 1e6 的矩陣上當交叉檢查。
- C 的比較用尺度化誤差：|ΔC_ij| ≤ tol·√(C_ii·C_jj)（tol 1e-8），不用逐元素相對誤差（接近 0 的非對角元會假失敗）。
- `fit.json` 九個案例都不會觸發奇異值代換（最小奇異值 ≥ 0.195），`illConditioned` 要用合成矩陣測。
- Jacobian 的比較：每欄 |ΔJ_ij| ≤ 1e-6·max_i|J_ij|；P@S 案例（案例 5）的容許值由實測的模型差異推得，實作者回報量到的數字。步長完全照 bumps：`h = |p|·1e-4；h == 0 → 1e-4；若 p + h > upper → h = −h`（嚴格大於，`lsqerror.py:99-105`），**不處理下限**。
- `atBound` 的測試要求值與邊界**嚴格相等**；上限、下限各一個案例。
- 「NaN 步被拒絕後仍收斂」的測試另外斷言最終 χ² 等於未包裝時的擬合結果；`onProgress` 的 chi2 等於該迭代點的 Σr²。
- `shouldStop` 保留為擬合器自身的功能並測試，但在檔頭註明：Worker 內的同步迴圈收不到訊息，實際的「停止」靠 `worker.terminate()`。

### D. worker-core、worker-client

- **latest-wins 要真的有效**：wasm 快取後，`async handle` 只讓出 microtask，而排隊的 `message` 事件是 task，三個排隊的 evaluate 會全部算完。`create({ loadWasm, post, yieldTask })`——Worker 傳 `() => new Promise((r) => setTimeout(r, 0))`；`handle` 記下最新 reqId、`await yieldTask()`、過期就丟。測試：wasm 已快取、`yieldTask` 可手動控制，連送 reqId 1、2、3 → 恰一則 `curve`，且實際只計算一次。
- **wasm trap**（規格 §12、`js/sasfit-kernel.js` 檔頭）：kernel 丟出 `wasm kernel <name> failed` 後，core 把該模型從快取移除，回 `error` code `'WASM_TRAP'`；測試下一個請求會再呼叫 `loadWasm`。
- `progress` 訊息帶 `chi2r`（＝chi2/dof），測試要斷言。
- hayter_msa 的 NaN 測試用 `tests/sasfit-product.test.js` 特性測試的那組參數（NaN 的位置原生與 wasm 不同，不要用規格 §16 條件 (a)）。
- **`client.stop()` 合成的結果**（Worker 已被 terminate，由 client 自己組）：`{ status: 'stopped', params: job.params（擬合前的值）, errors: {}, errorsScaled: {}, displayErrorsScaled: job.weighting !== 'sigma', chi2: null, chi2r: null, dof: null, iterations: 最後一次 progress 的 iteration（沒有則 0）, atBound: {}, illConditioned: false, curve: null, residuals: null, settings }`，凍結。
- `client.fit` 在已有擬合進行中時 reject，code `'BUSY'`。
- Worker 入口檔包在 IIFE 內（`structure.test.js:71` 掃第 0 欄的宣告）。`node --check`、頂層識別字、800 行、`batch3`、`style-scan`、no-color-literals、token-usage 都會掃到 `sasfit-worker.js`，但不會被 `self`／`importScripts` 觸發。`WORKER_ONLY` 只需從 `structure.test.js:118-122` 那個測試的檔案集合排除。

### E. Task 6 冒煙測試

Playwright 1.61.0 與 Chromium 已在 `~/Projects/text-to-cad/.venv`。Worker 的 `importScripts`／wasm 請求網址以 `http.server` 的存取紀錄為準（Playwright 的 `page.on('request')` 可能漏掉 Worker 的子請求）。

### F. 已驗證、不需更動的部分

Worker 內 `importScripts` 與 `fetch` 的相對網址以 Worker 腳本網址為基準（`'sasfit-meta.js?v='`、`'../wasm/…'` 正確）；現行 CSP 的 `worker-src 'self' blob:` 允許建立 Worker，從網路載入的 Worker 不繼承頁面的 meta CSP；`document.currentScript` 只在 classic script 同步執行的頂層有效，要在載入時就取值；GitHub Pages 路徑分大小寫（檔名全小寫）；九個案例的條件數與參數相關性都在合理範圍（最大相關 0.976）。

## M2 完成紀錄（2026-11-18）

- **測試**：`node --test saxs-calculator/tests/*.test.js` 898 項全過（M1 結束時 758；M2 實作完成、審查前 854；審查修正後 897；加上阻尼回歸測試 898）。G4 共 19 個案例（原 12 個＋審查後追加 7 個），門檻未變（0.01σ、2%、1e-3），經擬合器與經 Worker 訊息介面各驗一次。`tools/sasfit/smoke_browser.py`（headless Chromium）ALL PASS。
- **實作的 commit**：`d89b177` weighting、`b3249a0` 擬合參考值、`e95d19b` 擬合器（G4 通過）、`306fd48` worker-core、`bcaea0d` Worker 入口與 client、`ce08fc3` 瀏覽器冒煙測試。
- **審查修正的 commit**（科學審查＋程式審查）：`d201a40` 擬合器對算不出來的區域如實回報（F1、F2、L1、L2）；`6d626ff` worker-core 的結果欄位、`MAX_STEPS`、錯誤分類、`defaultMode`／`countExcluded`、`onFatal`；`f2630d4` client 的每個 Promise 都會結清、`stop()` 延後重建（H1–H3、M3、M4、L5、L6）；`9987317` 追加 7 個擬合參考案例與測試整理；以及本文件所在的 docs commit。
- **與本計畫／規格的出入**（規格已同步）：
  1. 新增 `js/sasfit-linalg.js`（Jacobi SVD 與共變異自 fitter 拆出，載入順序在 fitter 之前；規格 §3.2、§3.3）。
  2. FitResult 比原訂多六欄：`names`、`covariance`、`correlation`、`blockedByNonFinite`、`jacobianNonFinite`、`nonFiniteCurvePoints`（規格 §4.9）。擬合器層另外：`jacobian()` 多回傳 `nonFiniteColumns`，`svd()`／`covariance()` 多回傳 `converged`。
  3. G4 的比較基準是 bumps 結果精修後的真正極小值（規格 §15 決策 20）。
  4. `client.stop()` 不再立刻重建 Worker：沒有進行中的請求時什麼都不做，否則終止並把重建延後到下一個請求（規格 §4.10）。新增錯誤代碼 `WORKER_START_FAILED`。
  5. 「被算不出來的區域擋住」的判定比審查意見的字面多兩個條件，否則 hayter_msa 的零星 NaN 會把已完成的擬合誤判為失敗：線性模型預測相對下降 ≤ ftol 的非有限試探步不算；非有限試探步之後若有「算得出來、預測下降 > ftol、卻仍被拒絕」的較短步，該次迭代不算被擋（規格 §4.9、`sasfit-fitter.js` 檔頭）。審查者的兩個合成案例（整條 NaN 的牆、單列 NaN 的牆）修正前報 `converged`，修正後報 `failed`＋`blockedByNonFinite`。
- **阻尼更新改用 Nielsen 法**（審查修正之後追加的 `perf:` commit；接受時 λ·max(1/3, 1−(2ρ−1)³)，拒絕時 λ·ν、ν 加倍）。實測（被接受的步數，原規則「拒絕 ×10、預測良好才 ÷10」→ Nielsen）：19 個參考案例最多 +2（cylinder 13 → 15；8a 3 → 4；10c 10 → 11；core_shell_sphere 8 → 7；案例 12 10 → 8；其餘不變），G4 門檻未動、全過；低 Q 冪律放開 `lowq_power` 的 12 組由平均 79 步降到 25 步（101 → 26、111 → 35 …；其中 1 組由 13 升到 25，到達同一個極小值）；|I| 權重配髒資料（60 個種子 × 3 種雜訊底）持平（雜訊底 8e-3：平均 12.8 → 12.6、最大 103 → 98）——阻尼更新不是該類案例慢的原因。第一次評估時因「兩類慢案例都要明顯改善」的條件未採用；協調者改以「參考案例不退步超過 2 步、G4 通過、至少一類慢案例明顯改善」為準後採用。`tests/sasfit-g4.test.js` 加了低 Q 冪律三個種子的步數上限（55 步；實測 26／35／31，舊規則 101／111／102）。hayter_msa 低 q 的 40 次擬合仍是 40 次收斂、0 次失敗。測試總數 898。
- **已知限制**（規格 §16）：hayter_msa 的「有限但錯誤」跳點沒有旗標可擋——落在 Jacobian 鄰點上會讓誤差失真，擬合也可能停在孤立跳點上；介面必須讓 χ²ᵣ 與狀態並列。規格 §5.7 列出 M3 介面必須落實的 13 項要求。
- **未驗證**：GitHub Pages 上 `.wasm` 的 Content-Type 與快取行為；Chromium 以外的瀏覽器；規格 §4.9「強相關問題上離真正極小值約 0.03σ」是科學審查者的量測，fixture 內沒有對應案例。
