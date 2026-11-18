# tools/sasfit — sasmodels C kernel 編譯成 WebAssembly

把 SasView sasmodels 1.0.12 的 C kernel 編譯成 `saxs-calculator/wasm/sas-<model>.wasm`，供瀏覽器內 SAS 擬合頁使用。

**編譯產物（`saxs-calculator/wasm/`）已提交進 git**，所以一般開發與執行不需要 emsdk；只有「新增模型」或「升級 sasmodels」時才需要重新編譯。

## 1. 建立 Python venv

```bash
python3 -m venv tools/sasfit/.venv
tools/sasfit/.venv/bin/pip install -r tools/sasfit/requirements.txt
```

`.venv/` 與 `build/` 已列入 `.gitignore`。

## 2. 安裝 emsdk 6.0.13（固定裝在 `~/emsdk`，用官方 emsdk repo，不用 Homebrew）

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install 6.0.13
./emsdk activate 6.0.13
```

每次開新 shell 要編譯前先啟用：

```bash
source ~/emsdk/emsdk_env.sh
emcc --version   # 應顯示 6.0.13
```

## 3. 編譯

```bash
source ~/emsdk/emsdk_env.sh
tools/sasfit/.venv/bin/python tools/sasfit/build_wasm.py            # 全部 13 個 C 模型
tools/sasfit/.venv/bin/python tools/sasfit/build_wasm.py sphere     # 只編指定模型
```

輸出：`saxs-calculator/wasm/sas-<model>.wasm` 與 `manifest.json`（含 emcc 版本、旗標、大小、sha256）。

## 4. Phase 0 驗證腳本（`tools/sasfit/phase0/`）

```bash
tools/sasfit/.venv/bin/python tools/sasfit/phase0/gen_ref.py tools/sasfit/build/phase0-ref.json
node tools/sasfit/phase0/probe.mjs tools/sasfit/build/phase0-ref.json            # 與 sasmodels 逐筆比對
node tools/sasfit/phase0/bench.mjs tools/sasfit/build/phase0-ref.json            # wasm 效能
SAS_OPENCL=none tools/sasfit/.venv/bin/python tools/sasfit/phase0/bench_native.py  # 原生 sasmodels 效能
```

授權：sasmodels 授權全文見 `saxs-calculator/wasm/LICENSE-sasmodels.txt`。
