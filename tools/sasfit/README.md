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

## 5. 數值參考值（`gen_reference.py`）：關閉 FMA 的編譯

```bash
tools/sasfit/.venv/bin/python tools/sasfit/gen_reference.py   # 產生 saxs-calculator/tests/fixtures/sasfit/*.json
```

參考值所用的 sasmodels 原生 DLL 一律以 `-ffp-contract=off`（嚴格 IEEE、不合併乘加）編譯。原因：WebAssembly 沒有 FMA 指令，而 arm64 的 clang 預設會把 `a*b + c` 合併成一次 FMA（只捨入一次）；多數模型兩者只差 1e-14 左右，但 hayter_msa 在低 q 的條件數使差異達 3e-9，超過 1e-9 的門檻，瀏覽器端無論如何重現不了。關閉後，同一份 C 原始碼的原生結果與 wasm 逐位元相同（hayter_msa 預設曲線 194/200 點），參考值也不再隨產生機器的 CPU 而變。設定集中在 `tools/sasfit/sas_env.py`：在 import sasmodels **之前**設好 `CFLAGS` 與 `SAS_DLL_PATH`（sasmodels 在 import `kerneldll` 時讀取，`kerneldll.py:108-142`），DLL 放在專用快取 `tools/sasfit/build/dll-nofma/`（已被 `.gitignore` 排除）——既不會誤用 `~/.sasmodels/compiled_models` 內以 FMA 編好的舊 DLL（快取鍵只看 C 原始碼雜湊，不含編譯旗標），也不污染使用者自己的快取。腳本會檢查編譯指令含該旗標、且載入的 13 個 DLL 都來自專用快取（不符即丟 `RuntimeError`，`python -O` 下也有效）。產生器分三個檔：`ref_common.py`（編譯設定、模型清單、JSON 輸出）、`gen_reference.py`（進入點；weights、fq、g1、g2）、`gen_reference_g3.py`（g3、kernel-args）。g1 在 M1 審查後追加的案例（標籤前綴 `hmsa:`、`dist:`、`pd3:`）一律接在最後，既有案例的位元組不變；`gate: "component"` 的案例只做元件層比對（規格 §16）。之後新增的參考值產生器（例如 bumps 擬合參考）請同樣先 `import sas_env; sas_env.configure()`。

授權：sasmodels 授權全文見 `saxs-calculator/wasm/LICENSE-sasmodels.txt`。

## 6. 瀏覽器冒煙測試（`smoke_browser.py`）

```bash
~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_browser.py
```

用 Playwright（headless Chromium）驗證 Worker、wasm、擬合與停止在真瀏覽器中可用。腳本自己以標準函式庫 `http.server` 在隨機埠（只綁 127.0.0.1）服務 `saxs-calculator/`，關閉快取（`Cache-Control: no-store`）並記錄每個請求，結束時一定關閉伺服器；整體逾時 120 秒。每項檢查印出 PASS／FAIL，全部通過結束碼才是 0。

檢查項目：1 首頁（淺色與深色主題）無 console error／pageerror；2 Worker 與主執行緒的 sphere evaluate 逐點完全相同；3 `sphere@hayter_msa` 曲線有限；4 含雜訊 sphere 資料擬合收斂、radius 在真值 3σ 內、χ²ᵣ 0.5–1.6、至少 2 則 progress；5 `stop()` 在 1 秒內以 `stopped` 結束且之後可再 evaluate；6 由伺服器紀錄確認 Worker 腳本、11 個 `importScripts` 模組與所有 `.wasm` 都帶 `?v=<footer 版本>`，並記錄 `.wasm` 的 Content-Type；7 瀏覽器內計時表（僅供參考，超過 300 ms 會標註）。

注意：只涵蓋 Chromium；未驗證 GitHub Pages 上的 Content-Type 與快取行為。擬合案例的 q 範圍刻意限在 q·R ≲ 3.6——起始值偏 20 % 時範圍拉到 q·R ≥ 6 會落入局部極小值（屬 LM 的正常行為）。
