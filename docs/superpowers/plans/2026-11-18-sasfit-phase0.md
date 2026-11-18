# SAS 模型擬合 Phase 0（可行性閘門）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 證明 sasmodels 1.0.12 的 C 生成碼能原樣編成 WebAssembly，在 Node 裡與 sasmodels 逐點一致（G1 容許誤差），並量出效能，作為 M1–M5 計畫的依據。

**Architecture:** Python 腳本用 sasmodels 自己的 `generate.make_source` ＋ `convert_type(F64)` 取得 C 原始碼，emscripten 編成 standalone wasm（無 JS glue）。Node 腳本以最小調度層（details／values 版面）呼叫 `<model>_Iq`，和 Python 產生的參考值比對。本階段的 Node 調度程式是**拋棄式探針**，放在 `tools/sasfit/phase0/`，正式版在 M1 以 TDD 重寫。

**Tech Stack:** Python 3.14 venv（sasmodels 1.0.12、bumps 1.0.4、periodictable）、emsdk（鎖版，裝在 `~/emsdk`）、Node 26 `WebAssembly`。

**規格：** `docs/superpowers/specs/2026-11-17-sasfit-a-design.md` §4.2、§10、§11（G1）、§14。

**通過標準：** sphere、cylinder、hayter_msa（經 sphere@hayter_msa）三者 `|Δ| ≤ 1e-9·|ref| + 1e-12·max|ref|`，cutoff＝1e-5，q＝1e-3–1 Å⁻¹ 對數 200 點；含單分散與 schulz 多分散。任一模型無法編譯或無法達標→停下來回報使用者（規格 §14）。

---

### Task 1: Python 工具環境

**Files:**
- Create: `tools/sasfit/requirements.txt`, `tools/sasfit/README.md`
- Modify: `.gitignore`（加 `tools/sasfit/.venv/`、`tools/sasfit/build/`）

- [ ] 建 `tools/sasfit/.venv`（`python3 -m venv`），`pip install sasmodels==1.0.12 bumps==1.0.4 periodictable numpy scipy`，`pip freeze` 寫回 `requirements.txt`（精確版本）。
- [ ] 驗證：`SAS_OPENCL=none .venv/bin/python -c "from sasmodels.core import load_model; from sasmodels.direct_model import DirectModel"` 無錯。
- [ ] Commit `chore: sasfit tools python environment`.

### Task 2: 安裝並鎖定 emsdk

- [ ] `git clone https://github.com/emscripten-core/emsdk.git ~/emsdk`；`./emsdk install <最新穩定版號>`、`./emsdk activate <同版號>`（用明確版號，不用 `latest` 字樣記錄）。
- [ ] 驗證：`source ~/emsdk/emsdk_env.sh && emcc --version` 印出該版號。版號寫進 README。

### Task 3: `build_wasm.py`（三個模型）

**Files:** Create `tools/sasfit/build_wasm.py`

- [ ] 對每個模型：`info = load_model_info(name)`；`src = generate.convert_type(generate.make_source(info)['dll'], generate.F64)`；`assert src.startswith('#define FLOAT_SIZE 8')`；寫到 `tools/sasfit/build/<model>.c`。
- [ ] `emcc -std=c99 -O2 <model>.c -o saxs-calculator/wasm/sas-<model>.wasm --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_<model>_Iq,_malloc,_free`；不加 OpenMP、不加 `-ffast-math`。
- [ ] 寫 `saxs-calculator/wasm/manifest.json`（各檔 SHA-256、位元組數、sasmodels 版本、emcc 版本、旗標）。
- [ ] 驗證：`node -e` 載入每個 wasm，列出 exports 含 `<model>_Iq`、`malloc`、`free`、`memory`；列出 imports（預期為空或僅 WASI 樣板，記錄實況）。

### Task 4: 參考值與 Node 一致性探針

**Files:** Create `tools/sasfit/phase0/gen_ref.py`, `tools/sasfit/phase0/probe.mjs`

- [ ] `gen_ref.py`：`SAS_OPENCL=none`、`dtype='double'`、`platform='dll'`；用 `DirectModel(data, model, cutoff=1e-5)` 產生下列案例的 I(q)，並把 sasmodels 實際送進 kernel 的 `call_details`（`details.buffer`）、`values`、`is_magnetic` 一併存進 JSON——探針先用這些「原樣緩衝區」驗證 wasm 本身，再用自己組的緩衝區驗證版面理解：
  1. sphere 預設值（單分散）
  2. sphere `radius_pd=0.2`、schulz、n=80、nsigma=3
  3. sphere `radius_pd=0.4`、schulz、n=80、nsigma=8
  4. cylinder 預設值
  5. cylinder `radius_pd=0.15`、`length_pd=0.2`、gaussian、n=35（2 個多分散參數＝1225 點，驗證每 100 點分段）
  6. sphere@hayter_msa 預設值（另存 P 與 S 各自的 kernel 輸出，驗證 hayter_msa wasm 本身）
- [ ] `probe.mjs`：載入 wasm、malloc 配置 details／values／q／result、以 `pd_start`/`pd_stop` 每 100 點分段呼叫、依規格 §4.2 讀回並換算 I(q)；逐案比對，印最大相對誤差與是否達標。
- [ ] 驗證：`node tools/sasfit/phase0/probe.mjs` 六案全部達標。

### Task 5: 效能量測

**Files:** Create `tools/sasfit/phase0/bench.mjs`

- [ ] 另編 core_shell_cylinder（規格指定的最重組態）；量測 400 點、radius 與 length 各 gaussian 35 點的單次評估時間（暖機後 20 次中位數）；估算一次典型擬合（6 個自由參數、30 次迭代 ≈ 30×(6+1) 次評估）的時間。另量 sphere 單分散 400 點作為下限。

### Task 6: 報告與提交

**Files:** Create `docs/superpowers/specs/2026-11-18-sasfit-phase0-report.md`

- [ ] 報告：emsdk 版號、wasm 大小、imports／exports 實況、六案最大誤差、效能數字、對 M1 計畫的影響（匯出方式、記憶體管理、效能預算）。
- [ ] 跑 `node --test saxs-calculator/tests/*.test.js` 確認既有測試仍綠（新增 `wasm/` 目錄不得弄壞守門測試）。
- [ ] Commit `feat: sasfit phase 0 — wasm feasibility gate passed`。
