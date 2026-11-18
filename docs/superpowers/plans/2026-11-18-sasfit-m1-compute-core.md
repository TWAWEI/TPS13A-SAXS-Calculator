# SAS 模型擬合 M1（計算核心）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 JS 裡重現 sasmodels 1.0.12 的 1D 計算路徑（多分散權重、kernel 調度、P@S、低 Q 冪律），以 13 個已編好的 wasm 加 2 個手寫模型算出 I(q)，並通過 G1、G2、G3 三道數值門檻。

**Architecture:** wasm 是 sasmodels 生成碼原樣編譯（Phase 0 已完成，檔案在 `saxs-calculator/wasm/`）。本里程碑寫的是 wasm 外面那層 Python 邏輯的 JS 移植：`weights.py` → `sasfit-weights.js`，`details.py`＋`kernel.py`＋`kerneldll.py` → `sasfit-kernel.js`，`product.py` → `sasfit-product.js`，再由 `sasfit-evaluate.js` 提供單一入口。全部是純計算模組，不碰 DOM，Node 可直接測。參考值由 Python 腳本從 sasmodels 產生後提交進 repo，Node 測試不需要 Python。

**Tech Stack:** Vanilla JS classic scripts（IIFE＋`globalThis.SasFitXxx = Object.freeze({...})`）、Node 26 `node --test`、`WebAssembly`；Python 3.14 venv `tools/sasfit/.venv`（sasmodels 1.0.12）只用來產生 meta 與參考值。

**規格：** `docs/superpowers/specs/2026-11-17-sasfit-a-design.md`（§3.2、§3.3、§4.1–§4.6、§10、§11、§17）。**Phase 0 報告：** `docs/superpowers/specs/2026-11-18-sasfit-phase0-report.md`（wasm 載入方式、background 在 kernel 外加、效能數字）。

---

## 全體任務共用規則（每個實作者都要讀）

1. **移植來源就是真相。** sasmodels 原始碼在 `tools/sasfit/.venv/lib/python3.14/site-packages/sasmodels/`（以下簡稱 `$SM`）。移植時逐行對照原文，不要憑印象寫公式；規格書與本計畫若和原始碼矛盾，以原始碼為準並在回報中指出。
2. **模組慣例**（規格 §3.3）：每檔一個 IIFE，只匯出 `globalThis.SasFitXxx = Object.freeze({...})`；頂層不得碰 `window`、`document`、`Chart`；不就地修改傳入的物件或陣列（回傳新物件；模組內部自己配置的 TypedArray 工作緩衝區可以寫入）；函式 < 50 行；檔案 ≤ 800 行（`tests/structure.test.js` 會擋）。
3. **每新增一個 `js/sasfit-*.js`，同一個 commit 內**要做兩件事，否則既有的 structure 測試會失敗：
   - `saxs-calculator/index.html`：在 `<script src="js/app.js?v=5.2">` 之前、`form-persistence.js` 之後的位置加 `<script src="js/sasfit-xxx.js?v=5.2"></script>`（版本號用當下 footer 的版本，目前 5.2；先 Read 該區段再改）。sasfit 腳本之間的順序固定為：meta → weights → kernel → product → py-models → evaluate。
   - `saxs-calculator/tests/load.js`：`LOAD_ORDER` 尾端依同樣順序加入，並在 `module.exports` 加對應匯出（例 `SasFitMeta: globalThis.SasFitMeta`）。
   - 這個階段 index.html **只加 `<script>` 標籤**，不加任何其他標記（markup 測試比對的是 v4.15 fixture；若 `<script>` 標籤本身讓 `tests/markup.test.js` 失敗，停下來回報，不要改測試或 fixture）。
4. **授權檔頭**（規格 §17）：`sasfit-weights.js`、`sasfit-kernel.js`、`sasfit-product.js`、`sasfit-py-models.js` 是 sasmodels 的衍生作品，檔頭註明移植來源檔與「Copyright (c) 2009-2022, SasView Developers — BSD 3-Clause, see wasm/LICENSE-sasmodels.txt」。
5. **測試**：`node --test saxs-calculator/tests/*.test.js` 從 repo 根目錄執行，每個任務結束時必須全綠。**不得重產或修改** `tests/fixtures/` 下既有的 fixture（`result-golden*`、`markup-v4.15.json`）。新的參考值放 `saxs-calculator/tests/fixtures/sasfit/`，只能由 `tools/sasfit/gen_reference.py` 產生，不得手改數字、不得為了讓測試通過放寬容許誤差。
6. **容許誤差（G1／G2）**：`|got − ref| ≤ 1e-9·|ref| + 1e-12·max|ref|`，逐點、且輸出必須全為有限值。共用的比對函式放在 `tests/sasfit-helpers.js`（Task 3 建立）。**唯一例外是 P@S 案例的端到端 I(q)**：相對項改為 1e-7（`assertCloseRel(got, ref, label, 1e-7)`），因為 hardsphere.c 在 2qR≈0.05–0.13 相消，有效半徑差 1 ulp 就讓 S(q) 變動 2.3e-9；P@S 的元件層（有效半徑、體積比、殼層體積、代入參考有效半徑後的 I(q) 與 S(q)）仍用 1e-9，由 `sasfit-product.test.js` 檢查（規格 §15 決策 19）。`assertCloseRel` 不得用在其他地方。
7. **Commit**：conventional 格式（`feat:`／`test:`／`chore:`），**不加任何 Co-Authored-By 或署名行**；留在 `feat/sasfit` 分支，不 push。
8. 做不到或數值對不上時：停下來回報實際差異（哪個案例、差多少、你查到的原因），不要繞過。

## 執行順序

Task 1 → 3 → 4 → 5 → 6 → 7 → 8 **依序**執行；只有 Task 2（不新增 JS 檔）可以和 Task 1 平行。原因：`structure.test.js:118-122` 要求 index.html 的 script 清單與 `js/*.js` 完全相等，而每個 JS 任務都改 `index.html` 與 `tests/load.js` 的同一段。另外，IIFE 內的程式一律縮排——`structure.test.js:71` 把第 0 欄的 `const`／`function` 當成全域宣告（產生出來的 `sasfit-meta.js` 也一樣）。

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `tools/sasfit/gen_meta.py` | 新增 | 由 sasmodels `ModelInfo` 產生 `js/sasfit-meta.js` |
| `tools/sasfit/gen_reference.py` | 新增 | 產生 `tests/fixtures/sasfit/*.json` |
| `saxs-calculator/js/sasfit-meta.js` | 產生 | 15 個模型的參數表與 kernel 版面資訊 |
| `saxs-calculator/js/sasfit-weights.js` | 新增 | 六種分布的取點與權重 |
| `saxs-calculator/js/sasfit-kernel.js` | 新增 | details／values 組裝、分段呼叫 wasm、Fq 輸出 |
| `saxs-calculator/js/sasfit-py-models.js` | 新增 | `guinier_porod`、`power_law` |
| `saxs-calculator/js/sasfit-product.js` | 新增 | P@S、β 近似、有效半徑 |
| `saxs-calculator/js/sasfit-evaluate.js` | 新增 | 單一入口 `evaluate` |
| `saxs-calculator/tests/sasfit-helpers.js` | 新增 | 讀 wasm、讀 fixture、容許誤差比對 |
| `saxs-calculator/tests/sasfit-*.test.js` | 新增 | 各模組測試與 G1–G3 |
| `saxs-calculator/tests/fixtures/sasfit/*.json` | 產生 | 參考值 |

## 介面（各任務之間的約定）

```js
// sasfit-meta.js（產生）
SasFitMeta = {
  sasmodelsVersion: '1.0.12',
  models: {
    sphere: {
      name: 'sphere', title, category: 'shape:sphere',
      kind: 'c' | 'js',                 // js = guinier_porod、power_law
      isStructureFactor: false,
      haveFq: true,
      reffModes: ['radius'],            // model_info.radius_effective_modes 或 []
      // kernel 參數全表（含 1D 不顯示的取向參數），順序＝model_info.parameters.kernel_parameters
      params: [{ name, units, def, min, max, type: 'volume'|'sld'|'orientation'|'magnetic'|'',
                 pd: true|false,        // 完全照 parameters.pd_1d（所以 hayter_msa.radius_effective 為 true；
                                        // 規格 §4.1「A 版不開放 S 參數多分散」是 M3 介面層的事，不在這裡處理）
                 relativePd: true|false, description }],
      // scale、background 不在 kernel_parameters 內，預設值各模型不同（hardsphere、hayter_msa 的 background 是 0）
      common: { scale: { def, min, max }, background: { def, min, max } },   // 取自 parameters.common_parameters
      // details.py 需要的版面常數（由 gen_meta 直接從 ModelInfo 讀出，不在 JS 重算）
      // maxPd = min(含取向在內的可多分散參數數, 5)，已編進 wasm（details 緩衝區長度 4*maxPd+4）
      // nvalues = 2 + npars + (nmagnetic ? 4 + 3*nmagnetic : 0)
      layout: { npars, nmagnetic, nvalues, maxPd, thetaOffset }
    }, ...
  },
  // 模型清單順序＝規格 §4.1 表格順序
  order: ['sphere', ...]
}

// sasfit-weights.js
SasFitWeights.getWeights(type, center, width, npts, nsigmas, lower, upper, relative)
  → { x: Float64Array, w: Float64Array }     // 對應 weights.get_weights
SasFitWeights.DEFAULTS   // sasmodels 原始預設（gaussian 35/3 …），UI 預設不在這裡

// sasfit-kernel.js
SasFitKernel.instantiate(bytes) → Promise<exports>   // 依 Phase 0 報告：env 匯入＋_initialize()
SasFitKernel.create(modelMeta, wasmExports) → kernel
kernel.Fq(q /*Float64Array*/, pars /*{name: value, name_pd, name_pd_n, name_pd_nsigma, name_pd_type}*/,
          { cutoff, radiusEffectiveMode })       // radiusEffectiveMode 必填（不設預設：sasmodels 的 call_Fq 預設 1、Kernel.Iq 用 0，容易搞混）
  → { F1 /*haveFq 才有，否則 null*/, F2, radiusEffective, shellVolume, volumeRatio /* form:shell */ }
     // 對應 Kernel.Fq 的回傳 (F1, F2, radius_effective, shell_volume, form_volume/shell_volume)，kernel.py:188
kernel.Iq(q, pars, { cutoff }) → Float64Array   // 內部以 radiusEffectiveMode 0 呼叫 Fq；scale/shellVolume·F2 + background
// pars 內出現不認得的參數名稱 → 丟 Error（比照 direct_model.py:121-122）

// sasfit-py-models.js
SasFitPyModels.models = { guinier_porod: { Iq(q, pars) → Float64Array }, power_law: {...} }
  // 回傳的是已含 scale 與 background 的 I(q)（與 kernel.Iq 同層級）

// sasfit-product.js
SasFitProduct.create(pMeta, sMeta, pKernel, sKernel) → product
product.paramNames   // scale、background、P 的 kernel 參數、S 的參數（P 自帶 volfraction 時省略 S 的）、
                     // structure_factor_mode（預設 0）、radius_effective_mode（預設 1）——順序見 product.py:146-170、208
                     // 註：1.0.12 的 `_S` 後綴是死碼（product.py:201-205 最後取未加後綴的名稱），本清單的 6×2 組合
                     // 除 volfraction 外沒有撞名，所以不實作後綴
                     // product 的 scale 預設 1、background 預設 0.001
product.Iq(q, pars, { cutoff }) → Float64Array

// sasfit-evaluate.js
SasFitEvaluate.evaluate(modelSpec, params, q, opts, kernels) → { I: Float64Array, extras }
  // modelSpec = { model, structure: null|'hardsphere'|'hayter_msa', lowQPowerLaw: boolean }
  // params    = 扁平物件：模型參數、*_pd 系列、structure_factor_mode、radius_effective_mode、
  //             lowq_scale、lowq_power
  // opts      = { cutoff = 1e-5 }
  // kernels   = { [modelName]: wasmExports }（呼叫端先載好；js 模型不需要）
  //             註：規格 §3.2 寫的是四個參數；第五個參數是為了讓 wasm 載入可注入、Node 可測而加的
  // extras    = { radiusEffective, volumeRatio }（有 S 時）或 {}
  // lowQPowerLaw 為 true 而未給 lowq_scale／lowq_power 時用規格 §4.5 的預設（0 與 4）
  // 「可接 S(Q)」的判定＝haveFq && reffModes.length > 0。這是規格的規則，不是 sasmodels 的行為
  // （sasmodels 本身接受 lamellar@hardsphere）；不符合時丟 Error
```

`pars` 中沒給的參數一律用 `modelMeta.params[].def`；`*_pd` 預設 0、`*_pd_n` 預設 0（sasmodels API 預設，見規格 §4.3 末段——UI 預設由後面的里程碑在呼叫端帶入，**不寫在這幾個模組裡**）。

---

### Task 1: `gen_meta.py` 與 `sasfit-meta.js`

**Files:**
- Create: `tools/sasfit/gen_meta.py`, `saxs-calculator/js/sasfit-meta.js`（產生）, `saxs-calculator/tests/sasfit-meta.test.js`
- Modify: `saxs-calculator/index.html`（script 標籤）, `saxs-calculator/tests/load.js`

來源：`$SM/modelinfo.py`（`ModelInfo`、`ParameterTable`、`Parameter`）、`$SM/core.py` 的 `load_model_info`、`$SM/details.py`（看 `make_details`／`make_kernel_args` 實際用到 `ParameterTable` 的哪些屬性，`layout` 就輸出那些）。

- [ ] **Step 1：寫失敗的測試** `sasfit-meta.test.js`：
  - `SasFitMeta.order` 等於規格 §4.1 的 15 個名稱、順序相同；`sasmodelsVersion === '1.0.12'`。
  - 逐一核對規格 §4.1 表格：`kind`（guinier_porod、power_law 為 `'js'`，其餘 `'c'`）、`haveFq`、`isStructureFactor`（hardsphere、hayter_msa）、各模型 `pd === true` 的參數名稱集合（例 cylinder＝{radius, length}、core_shell_cylinder＝{radius, thickness, length}、flexible_cylinder＝{length, kuhn_length, radius}、gaussian_peak＝∅、**hayter_msa＝{radius_effective}**——照 `pd_1d`，這一格與規格 §4.1 表不同是刻意的）。
  - `layout`：sphere maxPd 1／nvalues 15；cylinder 4／18；core_shell_cylinder 5／23；guinier 0／3。
  - `common`：scale def 1（全部）；background def 0.001，hardsphere 與 hayter_msa 為 0。
  - 抽查預設值：sphere `radius` def 50、units `Ang`；cylinder `length` def 400。
  - `SasFitMeta` 與巢狀物件皆 frozen；檔案行數 ≤ 800。
- [ ] **Step 2：** 跑 `node --test saxs-calculator/tests/sasfit-meta.test.js`，確認因 `SasFitMeta` 未定義而失敗。
- [ ] **Step 3：** 寫 `gen_meta.py`：對 15 個模型 `load_model_info`，輸出上面介面定義的結構。檔頭註解：自動產生、勿手改、產生器路徑、sasmodels 版本。精簡格式——每個參數一行。`min`／`max` 為 ±inf 時輸出 `-Infinity`／`Infinity`。輸出後用深層 freeze 包起來（檔內一個小的 `deepFreeze`）。
- [ ] **Step 4：** 執行 `SAS_OPENCL=none tools/sasfit/.venv/bin/python tools/sasfit/gen_meta.py`，加 script 標籤與 `LOAD_ORDER`，跑全部測試到全綠。
- [ ] **Step 5：** Commit `feat: sasfit model metadata generated from sasmodels`。

### Task 2: `gen_reference.py` 與參考值 fixtures（純 Python，唯一可與其他任務平行者）

**Files:**
- Create: `tools/sasfit/gen_reference.py`, `saxs-calculator/tests/fixtures/sasfit/{weights,fq,g1,g2,g3}.json`

通則：`os.environ['SAS_OPENCL']='none'` 放在 import sasmodels 之前；`load_model(name, dtype='double', platform='dll')`；**每個呼叫都明確傳 cutoff**；數字用 `repr(float)`（17 位有效）輸出；JSON 緊湊（`separators=(',',':')`）。腳本可重複執行且輸出逐位元穩定（不含時間戳）。參考做法見 `tools/sasfit/phase0/gen_ref.py`。

- [ ] **Step 1：`weights.json`** —— 對六種分布各取數組 `(center, width, npts, nsigmas, lower, upper, relative)`，直接呼叫 `$SM/weights.py` 的 `get_weights`，存輸入與輸出 `x`、`w`。必含：schulz nsigmas 3 與 8、寬度 0.3／0.4；lognormal；取點被下限 0 截掉的案例（例 gaussian center 10、相對寬度 0.5、nsigmas 3、lower 0）；width 0；npts 0 與 1。
- [ ] **Step 2：`fq.json`** —— `sasmodels.direct_model.call_Fq(kernel, pars, cutoff=1e-5)` 的五個輸出（F、F²、R_eff、V、form:shell 比值），模型：sphere、core_shell_sphere、vesicle、ellipsoid、cylinder、core_shell_cylinder，各取預設值一組、`radius_effective_mode` 各個可用值一組、以及一組多分散（第一個尺寸參數 schulz 0.2、n 80、nsigma 3）。**每案都明確傳 `radius_effective_mode` 並存進 JSON 的 `radiusEffectiveMode`**（`call_Fq` 預設是 1，且會把這個鍵從 pars pop 掉——傳 pars 的複本）。存的五個欄位名稱：`F1, F2, radiusEffective, shellVolume, volumeRatio`（第 4 個是 **shell** volume，`kernel.py:188`）。
- [ ] **Step 3：`g1.json`** —— 規格 §11 G1 全部案例，q＝`np.logspace(-3, 0, 200)`、`DirectModel(empty_data1D(q), model, cutoff=1e-5)`。`q` 只在 JSON 頂層存一次；每案存 `{ label, modelSpec: {model, structure, lowQPowerLaw}, pars, Iq }`，其中 `pars` 用本計畫 evaluate 的扁平參數名。**凡是多分散案例，`_pd`、`_pd_n`、`_pd_nsigma`、`_pd_type` 四個都要明確給**——`_pd_n` 省略時 sasmodels 當成單分散（`direct_model.py:138-147`），案例會白測：
  1. 15 個模型各一組預設值（structure factor 兩個以 `sphere@hardsphere`、`sphere@hayter_msa` 呈現，另各自單獨算一次 S(q)）。
  2. 每個可多分散參數（規格 §4.1 表）× {gaussian n=35 nsigma=3 寬度 0.15；schulz n=80 nsigma=3 寬度 0.2；schulz n=80 nsigma=8 寬度 0.3；schulz n=80 nsigma=8 寬度 0.4}。
  3. 6 個可接 S(Q) 模型 × {hardsphere, hayter_msa} × `structure_factor_mode` {0, 1}，P 的第一個尺寸參數帶 schulz 0.2、n 80、nsigma 3（球形模型的 β 近似在單分散時與 P*S 只差 1e-15，必須有多分散才測得到）。
  4. 同 3 的 6 個模型接 hardsphere，`radius_effective_mode` 取 0（另給 `radius_effective`＝60）與每個可用模式。
  5. `vesicle@hardsphere`：確認參數集沒有 S 的 volfraction（腳本斷言）。
  6. 低 Q 冪律：`sphere+power_law`、`cylinder+power_law`、`sphere@hardsphere+power_law`（最後一個帶 schulz 多分散與 β 模式）；`lowq_scale`＝1e-6、`lowq_power`＝4。和模型的參數對應（`mixture.py:82-118、235`；和模型沒有 `B_background`，傳了會 `TypeError`）：外層 `scale`＝1（明確給）、`A_scale`＝模型的 scale、P 或 P@S 的每個參數加 `A_` 前綴（含 `A_radius_pd*`、`A_radius_effective`、`A_volfraction`、`A_structure_factor_mode`、`A_radius_effective_mode`）、`B_scale`＝lowq_scale、`B_power`＝lowq_power、`background`＝共用的 background。JSON 的 `pars` 存轉回後的扁平名稱。
  7. 兩個參數同時多分散：cylinder（radius gaussian 0.15、length gaussian 0.2，n 各 15）一組——驗證每 100 點分段。
- [ ] **Step 4：`g2.json`** —— guinier_porod、power_law：預設值＋各 3 組參數（guinier_porod 要跨過分段點兩側，並含 `s`≠0 的案例、`rg<=0` 與 `porod_exp<=s` 的案例——此時 Iq 回 0、I＝background，`guinier_porod.py:112-113`）；另含 q 陣列帶 0 的案例（照 sasmodels 實際輸出存：power_law 預設與 guinier_porod 預設 s=1 為 inf，guinier_porod s=0 為有限值；inf 在 JSON 以字串 `"inf"` 表示）。
- [ ] **Step 5：`g3.json`** —— 15 個模型的 `model_info.tests`，照 `$SM/model_test.py` 的 `run_one`（336-357 行）解讀，**cutoff＝0**（`call_kernel`／`call_Fq` 的預設）：
  - 依 tuple 長度分三種：長度 3＝`(pars, q, I)`；長度 4＝I(q) 外加一個中間量 dict；長度 7＝`(pars, q, F, Fsq, R_eff, V_shell, ratio)`。
  - `x`（或 `x[0]`）是 tuple 者為 2D（329 行）→ 略過。磁性案例略過。
  - pars 內的 `@S` 鍵要 pop 出來，代表用該 S 組成乘積模型（239-254 行）；全部 `@S` 測試都用 hardsphere。
  - 期望值 `None` 表示「不是 NaN 即可」（456-458 行），不是「必須有限」；長度 7 的五個欄位各自可以是 None。
  - 每筆存 `{ model, structure, pars, q, kind: 'Iq'|'Fq', expected, radiusEffectiveMode }`（Fq 測試未指定模式時存 1）。長度 4 的測試存成 `kind: 'Iq'` 只留 I(q)，中間量 dict 不比對，腳本印出略過了幾個中間量。
  - JSON 頂層 `tolerance` 記錄 `is_near`（443-471 行，digits＝5）：目標為 0 → 實際值必須恰為 0；有限目標 → `|t−a| < 1.5·10^(ceil(log10|t|)−5)`；inf → 必須相等；NaN → 必須是 NaN。
  - 另加 `model_test.py:215-227` 的三個 1D smoke 測試給全部 15 個模型（`({}, 0.1, None)`、`({}, [0.001, 0.01, 0.1], [None]*3)`、Fq smoke）——gaussian_peak 沒有官方測試，沒有這個 G3 對它是空的。
  - 預期保留筆數（審查者實算；規格 §4.1 的「官方測試數」是含 2D 的原始筆數，共 58，保留 52）：sphere 12、core_shell_sphere 2、vesicle 4、ellipsoid 5、cylinder 16、core_shell_cylinder 1、flexible_cylinder 4、lamellar 1、guinier 1、guinier_porod 1、power_law 1、mono_gauss_coil 1、gaussian_peak 0、hardsphere 1、hayter_msa 2。腳本斷言這些數字，對不上就停下來回報。
- [ ] **Step 6：** 連跑兩次，`shasum` 確認輸出逐位元相同；`ls -la` 檢查檔案大小（單檔應 < 1 MB，超過就回報）。跑全部既有測試確認仍綠。
- [ ] **Step 7：** Commit `test: sasfit reference fixtures from sasmodels 1.0.12`。

### Task 3: `sasfit-weights.js`

**Files:**
- Create: `saxs-calculator/js/sasfit-weights.js`, `saxs-calculator/tests/sasfit-helpers.js`, `saxs-calculator/tests/sasfit-weights.test.js`
- Modify: `index.html`, `tests/load.js`

來源：`$SM/weights.py`——`Dispersion.get_weights`／`_linspace`、`GaussianDispersion`、`RectangleDispersion`、`UniformDispersion`、`LogNormalDispersion`、`SchulzDispersion`、`BoltzmannDispersion`、模組函式 `get_weights`。注意各分布對 `relative`、`nsigmas`、上下限截斷的處理不同，逐類照搬。Schulz 用到 `gammaln`：JS 沒有內建，移植一個 Lanczos 近似。注意權重最後會正規化（`weights.py:291`），gammaln 的常數誤差會被消掉、`weights.json` 測不出來，所以另外對 `gammaln` 寫直接測試（z＝0.5、1、2.5、10、100 對 scipy `gammaln` 的值，由 `gen_reference.py` 一併存進 `weights.json` 的 `gammaln` 欄）。`_linspace` 移植成 `start + i·step`、最後一點直接設為 `stop`——之後的 `x >= lower` 篩選在邊界上對捨入很敏感。

- [ ] **Step 1：** 建 `tests/sasfit-helpers.js`：`loadFixture(name)`、`assertClose(got, ref, label)`（共用規則 6 的容許誤差；錯誤訊息印出最差點的索引、got、ref、相對差）、`loadWasm(model)`（讀 `saxs-calculator/wasm/sas-<model>.wasm` 的 bytes）。
- [ ] **Step 2：** 寫失敗的測試：對 `weights.json` 每個案例呼叫 `SasFitWeights.getWeights`，`x` 與 `w` 都 `assertClose`、長度相同；`DEFAULTS` 與規格 §4.3「同 sasmodels」欄及 sasmodels 原始預設（lognormal、schulz 為 80／8）一致；不認得的分布名稱丟出含名稱的 `Error`。
- [ ] **Step 3：** 跑測試確認失敗 → 實作 → 跑到通過。
- [ ] **Step 4：** 加 script 標籤與 `LOAD_ORDER`；全部測試綠。
- [ ] **Step 5：** Commit `feat: sasfit polydispersity weights ported from sasmodels`。

### Task 4: `sasfit-kernel.js`

**Files:**
- Create: `saxs-calculator/js/sasfit-kernel.js`, `saxs-calculator/tests/sasfit-kernel.test.js`
- Modify: `index.html`, `tests/load.js`

來源：`$SM/details.py`（`make_details`、`make_kernel_args`、`CallDetails` 的緩衝區版面；`correct_theta_weights` 在 1.0.12 已停用，不移植）、`$SM/direct_model.py`（`call_kernel`、`call_Fq`、`get_mesh`、`_pop_par_weights`——決定每個參數的取點與權重、哪些參數算多分散）、`$SM/kernel.py`（`Kernel.Fq`、`Kernel.Iq` 的換算）、`$SM/kerneldll.py:446-475`（每 100 點分段呼叫）。先讀 Phase 0 報告與 `tools/sasfit/phase0/probe.mjs`（wasm 呼叫與記憶體配置的可用範例）。

要點：
- `instantiate(bytes)`：`WebAssembly.instantiate(bytes, { env: { emscripten_notify_memory_growth() {} } })` 後呼叫 `_initialize()`。
- 緩衝區用匯出的 `malloc`／`free`；**每次 malloc 之後重新取 `memory.buffer`**（記憶體可能成長，舊的 TypedArray view 會失效）；`try/finally` 保證 free。
- `values` 向量的版面（scale、background、kernel 參數、磁性槽位、接著各多分散參數的取點值與權重）完全照 `make_kernel_args`；Phase 0 的 `tools/sasfit/build/phase0-ref.json`（本機有、未提交，可用 `tools/sasfit/phase0/gen_ref.py` 重產）內含 sasmodels 實際送出的 `details` 與 `values`，除錯時拿來逐格比對。
- background 在 kernel 外加：`Iq = scale/shellVolume·F2 + background`；total_weight＝0 → 1；shell_volume＝0 → 1（`kernel.py:175-183`）。
- 單分散的判定照 `direct_model.py:136-147`：`_pd_n == 0`、`_pd == 0` 或該參數不在 1D 可多分散集合時只取中心值；預設 `_pd` 0、`_pd_n` 0、`_pd_nsigma` 3、`_pd_type` gaussian。
- 逐格比對緩衝區時會用到的細節：磁性槽位不全是 0（`up_theta` 預設 90，`modelinfo.py:644`）；dispersity 與 weight 區塊是**每個 kernel 參數一格**，不只多分散的；`pd_par` 依取點數由多到少排序、同數時索引大的在前（實測 cylinder 單分散 `[5,4,3,2]`、兩參數多分散 `[3,2,5,4]`）。
- 分段呼叫的測試強度：15×15 案例（225 點）是唯一超過 100 點的。另加一個白箱測試——以計數包裝的假 wasm 匯出確認該案例呼叫了 3 次、`pd_start`/`pd_stop` 為 (0,100)、(100,200)、(200,225)。

- [ ] **Step 1：** 寫失敗的測試：
  - `fq.json` 每案：以該案的 `radiusEffectiveMode` 呼叫 `kernel.Fq`，F1、F2、radiusEffective、shellVolume、volumeRatio 都 `assertClose`。
  - `layout` 推出的 details 長度＝`4*maxPd + 4`；values 長度補到 32 的倍數（`details.py:247-249`）。
  - `g1.json` 中 `structure === null && !lowQPowerLaw && kind 'c'` 的全部案例（預設值、單參數多分散四種、兩參數多分散）：`kernel.Iq` `assertClose`。
  - 連續呼叫同一個 kernel 200 次後 wasm 記憶體不成長（`memory.buffer.byteLength` 不變）——驗證沒有漏 free。
  - 傳入的 `q` 與 `pars` 未被修改。
- [ ] **Step 2：** 跑測試確認失敗 → 實作 → 跑到通過。對不上時先比 `details`／`values` 緩衝區，再比 kernel 原始輸出。
- [ ] **Step 3：** 加 script 標籤與 `LOAD_ORDER`；全部測試綠。
- [ ] **Step 4：** Commit `feat: sasfit kernel dispatch layer over wasm`。

### Task 5: `sasfit-py-models.js`

**Files:**
- Create: `saxs-calculator/js/sasfit-py-models.js`, `saxs-calculator/tests/sasfit-py-models.test.js`
- Modify: `index.html`, `tests/load.js`

來源：`$SM/models/guinier_porod.py`、`$SM/models/power_law.py` 的 `Iq`；scale 與 background 的套用方式照 `$SM/kernelpy.py`（Python kernel 沒有體積正規化時的路徑——讀原文確認 form volume 取 1）。

- [ ] **Step 1：** 寫失敗的測試：`g2.json` 全部案例 `assertClose`（期望值為 inf／nan 的點改比對「同為非有限且同號」）；`g1.json` 中這兩個模型的預設值案例。
- [ ] **Step 2：** 失敗 → 實作 → 通過；加 script 標籤與 `LOAD_ORDER`；全綠。
- [ ] **Step 3：** Commit `feat: sasfit guinier_porod and power_law in JS`。

### Task 6: `sasfit-product.js`

**Files:**
- Create: `saxs-calculator/js/sasfit-product.js`, `saxs-calculator/tests/sasfit-product.test.js`
- Modify: `index.html`, `tests/load.js`

來源：`$SM/product.py`——`make_product_info`（參數集合併、`_tag_parameter` 的 `_S` 後綴、P 自帶 volfraction 時省略 S 的 volfraction、`structure_factor_mode` 與 `radius_effective_mode` 兩個參數及其預設）、`ProductKernel.Iq`／`Fq`（約 440–560 行：先算 P 的 Fq、取得 R_eff 與 volume ratio、把它們填進 S 的參數、算 S、組合、套 scale／volfraction／background）。S 的 volfraction 要乘上 volume ratio 的那一步照原文。

- [ ] **Step 1：** 寫失敗的測試：
  - `g1.json` 全部 `structure !== null && !lowQPowerLaw` 案例（58 個：P*S、β、各有效半徑模式、vesicle 例外、3 個 `spd:` S 參數多分散），每案三層：(a) `parts()` 的有效半徑、體積比、殼層體積對 fixture 的 `intermediates`，1e-9；(b) 改用 `radius_effective_mode: 0`、`radius_effective` 代入 `intermediates.radiusEffectiveUsed` 後的 I(q) 與 S(q)，1e-9；(c) 原參數端到端 I(q)，1e-7（共用規則 6）。
  - `paramNames`：`sphere@hayter_msa` 含 `volfraction`、`radius_effective`、`structure_factor_mode`、`radius_effective_mode`；`vesicle@hardsphere` 的 `volfraction` 只出現一次且沒有 `volfraction_S`。
  - 以不能接 S(Q) 的模型（例 `lamellar`）建立 product 時丟出說明原因的 `Error`。
- [ ] **Step 2：** 失敗 → 實作 → 通過；加 script 標籤與 `LOAD_ORDER`；全綠。
- [ ] **Step 3：** Commit `feat: sasfit P@S product kernel ported from sasmodels`。

### Task 7: `sasfit-evaluate.js`、低 Q 冪律、G1 總表與 G3

**Files:**
- Create: `saxs-calculator/js/sasfit-evaluate.js`, `saxs-calculator/tests/sasfit-evaluate.test.js`, `saxs-calculator/tests/sasfit-g3.test.js`
- Modify: `index.html`, `tests/load.js`

- [ ] **Step 1：** 寫失敗的測試 `sasfit-evaluate.test.js`：
  - **G1 總表**：`g1.json` 每一案都經 `SasFitEvaluate.evaluate(modelSpec, pars, q, { cutoff: 1e-5 }, kernels)` 比對（kernels 用 helper 預先載入全部 13 個 wasm）：`structure === null` 的案例用 `assertClose`（1e-9）；`structure !== null` 的案例（含 `sphere@hardsphere+power_law`）是端到端 P@S，用 `assertCloseRel(…, 1e-7)`——它們的元件層 1e-9 檢查在 `sasfit-product.test.js`，這裡不重複（共用規則 6）。測試結尾斷言案例數等於 fixture 內案例數（不得默默略過）。
  - 低 Q 冪律：`I_total = I_model + lowq_scale·q^(−lowq_power)`，background 只加一次（規格 §4.5）。
  - `opts.cutoff` 省略時等同 1e-5。
  - 錯誤：未知模型、`kernels` 缺該模型的 wasm、不可接 S(Q) 的模型卻給了 `structure`——各丟出訊息明確的 `Error`。
  - 輸入物件未被修改。
- [ ] **Step 2：** 失敗 → 實作 → 通過。
- [ ] **Step 3：** 寫 `sasfit-g3.test.js`：照 `g3.json` 頂層 `tolerance` 記錄的 sasmodels 自身規則比對每一筆（`kind: 'Fq'` 的以該筆的 `radiusEffectiveMode` 走 `kernel.Fq`；`structure` 不為 null 的走 product；`expected` 為 null 的只要求不是 NaN）。使用 sasmodels API 預設（`*_pd_n` 0、cutoff 0），與 UI 預設無關。測試斷言各模型的筆數等於 fixture 內的筆數，並輸出每個模型通過幾筆。
- [ ] **Step 4：** 加 script 標籤與 `LOAD_ORDER`；`node --test saxs-calculator/tests/*.test.js` 全綠，記下總測試數。
- [ ] **Step 5：** Commit `feat: sasfit evaluate entry point; G1 and G3 gates pass`。

### Task 8: M1 審查

- [x] **科學審查**（science-reviewer 角色，獨立子代理，不給實作者的結論）：逐檔對照 sasmodels 原文審 `sasfit-weights.js`、`sasfit-kernel.js`、`sasfit-product.js`、`sasfit-py-models.js`；檢查 G1 案例是否真的涵蓋規格 §11 所列組合、有沒有被略過的案例、容許誤差有沒有被放寬。
- [x] **程式審查**（code-reviewer）：`git diff 32fe16e..HEAD -- saxs-calculator/js tools/sasfit saxs-calculator/tests`；CRITICAL／HIGH 必修。
- [x] 修正後全測試綠；commit。

## M1 完成紀錄（2026-11-18）

- 測試：`node --test saxs-calculator/tests/*.test.js` 758 項全過（審查修正前 695）。G1 共 167 案例：159 個有端到端門檻（100 個 1e-9、59 個 P@S 1e-7），8 個 P@hayter_msa 僅元件層；G2 14、G3 97。
- 審查修正的 commit：`231a5ba` 共用輸入檢查、`2ffb51b` 點數上限與 `__proto__` 安全、`8a6411a` 工具改丟 `RuntimeError`＋meta 原子寫入、`b836ccb` G1 追加 `hmsa:`／`dist:`／`pd3:`，以及本文件所在的 docs commit。
- 與規格檔案清單的兩處出入（規格 §3.2、§3.3 已同步）：新增 `js/sasfit-validate.js`（載入順序在 meta 之後）；`evaluate` 多第五個參數 `kernels`（wasm exports 由呼叫端注入）。
- `tools/sasfit/gen_reference.py` 超過 800 行，依 fixture 拆成 `ref_common.py`、`gen_reference.py`、`gen_reference_g3.py`；既有 fixture 數字逐位元不變。
- 已知限制：sasmodels 上游的 hayter_msa 數值不穩定（規格 §16），M2／M3 須把它的 NaN 與跳點當成預期輸入。未做（留待後續）：熱路徑微最佳化（kernel 物件與名稱集合的快取）、fixture 內寫入 `nCases`。
