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

擬合參考值（`gen_reference_fit.py` → `svd.json`、`fit.json`，gate G4）：

```bash
tools/sasfit/.venv/bin/python tools/sasfit/gen_reference_fit.py
```

每案是 bumps 1.0.4 `lm` 的結果再精修到真正極小值（規格 §15 決策 20）；腳本自己斷言收斂、原始 bumps 與精修值相差 < 0.02σ、貼邊界者恰等於邊界，任何一項不符就丟 `RuntimeError` 且不寫檔。**新案例一律接在 `review_cases()` 的最後**，既有案例的位元組不得改變（舊檔去掉結尾的 `]}` 必須是新檔的開頭）。含髒點或限制 Q 範圍的案例由腳本先套用本站的遮罩規則再交給 bumps，fixture 存完整資料與 `nUsed`。

授權：sasmodels 授權全文見 `saxs-calculator/wasm/LICENSE-sasmodels.txt`。

## 6. 瀏覽器冒煙測試（`smoke_browser.py`）

```bash
~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_browser.py
```

用 Playwright（headless Chromium）驗證 Worker、wasm、擬合與停止在真瀏覽器中可用。腳本自己以標準函式庫 `http.server` 在隨機埠（只綁 127.0.0.1）服務 `saxs-calculator/`，關閉快取（`Cache-Control: no-store`）並記錄每個請求，結束時一定關閉伺服器；整體逾時 120 秒。每項檢查印出 PASS／FAIL，全部通過結束碼才是 0。

檢查項目：1 首頁（淺色與深色主題）無 console error／pageerror；2 Worker 與主執行緒的 sphere evaluate 逐點完全相同；3 `sphere@hayter_msa` 曲線有限；4 含雜訊 sphere 資料擬合收斂、radius 在真值 3σ 內、χ²ᵣ 0.5–1.6、至少 2 則 progress；5 `stop()` 在 1 秒內以 `stopped` 結束且之後可再 evaluate；6 由伺服器紀錄確認 Worker 腳本、11 個 `importScripts` 模組與所有 `.wasm` 都帶 `?v=<footer 版本>`，並記錄 `.wasm` 的 Content-Type；7 瀏覽器內計時表（僅供參考，超過 300 ms 會標註）。

注意：只涵蓋 Chromium；未驗證 GitHub Pages 上的 Content-Type 與快取行為。擬合案例的 q 範圍刻意限在 q·R ≲ 3.6——起始值偏 20 % 時範圍拉到 q·R ≥ 6 會落入局部極小值（屬 LM 的正常行為）。

## 7. G6 的 SLD 參考值與合成官方 `.dat`（`gen_reference_sld.py`、`gen_fixture_dat.py`）

```bash
tools/sasfit/.venv/bin/python tools/sasfit/gen_reference_sld.py   # → tests/fixtures/sasfit/sld.json
tools/sasfit/.venv/bin/python tools/sasfit/gen_fixture_dat.py     # → tests/fixtures/sasfit/dat/SYNTH_sphere_{10,20,30}.dat ＋ SYNTH_sphere-truth.json
```

`gen_reference_sld.py` 只向 periodictable 取元素的 Z 與標準原子量（84 個有 CIAAW 標準原子量的元素），X 光 SLD 照規格 §4.7 的式子與常數（r_e＝2.8179403262e-5 Å、f≈Z）自行計算，不呼叫 `periodictable.xsf`；化學式案例涵蓋括號巢狀、小數計數、水合物（`·` 與括號兩種寫法，組成由腳本手動展開，因為 periodictable 不認得 `·`）、「ASCII 句點一律是小數點」（`CuSO4.5H2O` → O 5.5），並附無效字串與預期的失敗類別。`gen_fixture_dat.py` 以 sasmodels 的 sphere（半徑 50／52／54 Å）加固定種子雜訊，產生版面與官方檔相同（25 行參數回顯、`Single Frame Time` 行、`Q I ERROR` 行、Fortran E 格式、CRLF、5 列 beamstop、1 列 `000 000 000` 佔位、300 列正常資料）的合成檔，所有數值與檔頭值皆為編造，不含任何真實量測資料；sidecar `SYNTH_sphere-truth.json` 記錄真值參數與讀檔應得的結果（點數、檔頭欄位、條件值）。兩支腳本的輸出逐位元穩定，自我檢查失敗一律丟 `RuntimeError`。

## 7. 「SAS 模型擬合」頁面的瀏覽器冒煙測試與 axe（`smoke_ui.py`）

```bash
~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_ui.py
```

重用 `smoke_browser.py` 的伺服器與報告工具（匯入前先設 `sys.dont_write_bytecode`，不會留下 `__pycache__`）：自己在隨機埠（只綁 127.0.0.1）服務 `saxs-calculator/`、關閉快取、結束時一定關閉；每個等待都有逾時，整體逾時 240 秒。每項檢查印 PASS／FAIL，全部通過結束碼才是 0；全程（淺色、深色 colour-scheme 各一輪）不得有 console error／pageerror，warning 只列出。

檢查項目：1 開啟分頁；2 載入五個檔（圖色來自 `ChartTheme`、「隱藏了」、壞檔有行號）；3 即時預覽；4 擬合 radius 53→50（含灰色區）；5 慢擬合與停止；6 三種圖模式（主圖與殘差圖繪圖區對齊 < 1 px、縮放同步）；7 主題切換保留縮放；8 hayter_msa；9 wasm 載入失敗與重試；10 預覽暫停（`#sfPreviewNow` 隨選計算）；11 axe（WCAG 2.1 A／AA，空狀態／資料／模型（PD 列與 SLD 面板展開）／擬合結果，淺色與深色，範圍限 `#section-sasfit` 與側欄按鈕；另跑一次整頁並分開列出，並有一個「故意壞元素必被偵測」的負向對照）；12 鍵盤；13 版面；14 量測（重模型預覽時間、表格橫向捲動數字）；15 表單持久化排除；16 開啟分頁前沒有 Worker 請求；17 Worker／importScripts／wasm 請求都帶 `?v=`；18 窄視窗單欄；20 深色 colour-scheme 流程。

axe-core 由 jsdelivr CDN 以固定版本（4.10.2）注入測試瀏覽器（只影響測試，不改網站）；連不上 CDN 時 axe 項目報 FAIL（「could not load axe」），不會默默略過。截圖存於 `tools/sasfit/build/smoke-ui/`（已被 `.gitignore` 排除），路徑列在輸出最後。

## 8. M4 的瀏覽器冒煙測試與 axe（`smoke_m4.py`）

```bash
~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_m4.py
```

涵蓋 M4 新增的部分：序列擬合、IUCr 擬合段與「複製表格」、匯出、3D 結構示意。重用 `smoke_browser.py` 的伺服器與報告、`smoke_ui.py` 的頁面工具與 axe（`run_axe(ctx, scope)` 的範圍可以是 `'section'`（預設）、`'page'` 或 CSS 選擇器）、`check_iucr_copy.run_checks`；頁面內的腳本放在 `smoke_m4_js.py`。匯入前先設 `sys.dont_write_bytecode`，不會留下 `__pycache__`。整體逾時 240 秒（實際約 35 秒）；每項印 PASS／FAIL，全部通過結束碼才是 0。下載的檔案存於 `tools/sasfit/build/smoke-m4/`（已被 `.gitignore` 排除）。

檢查項目（編號同 M4 計畫 Task 18）：1 三個 `SYNTH_sphere_*.dat` 的序列擬合（20 秒內全部收斂、radius 與真值差 < 0.5、趨勢圖 3 點遞增、x 軸標題＝條件名稱、量度 0.5–1.6）；2 起始值傳遞（`startedFrom` 與實際送進 Worker 的起始 radius）；3 序列結束後與點列載入；4 慢序列按「停止」（1 秒內停、解鎖、沒有「繼續」按鈕、再按會重跑）；5 `check_iucr_copy` 的四步、送進 IUCr 表格的各列、複製內容（去掉擬合段後與基準 `filled.text` 相同）；6 擬合曲線 CSV（含 `numpy.genfromtxt` 讀回）、報告 TXT、序列 CSV、四張 PNG（淺色與深色主題下都是白底）；7 3D 檢視（非空白、拖曳、比例尺、核殼兩種色相、柔性圓柱、無形狀模型）；8 3D 的鍵盤、滾輪與 `prefers-reduced-motion`；9 鍵盤；10 主題；11 axe（序列空狀態／序列完成／匯出列／結構檢視／IUCr 頁，淺色與深色，另有選擇器範圍的負向對照）；12 版面（五種視窗）；13 console 與 `?v=`；14 量測（3D 重畫一格、500 列表格、序列總時間、各視窗畫布尺寸；不設門檻）。

注意：PNG 的像素在頁面內以 base64 參數傳入後檢查（CSP 擋 `fetch('blob:…')`／`fetch('data:…')`）。趨勢圖預設的縱軸是第一個擬合參數，檢查 1 先把它選成 `radius`。檢查 2 的起始值經過參數表單（6 位有效數字），所以比對到 1e-5 的相對誤差而不是逐位元。`numpy` 在這個 venv 沒有時改用 `tools/sasfit/.venv/bin/python` 讀檔，不會安裝任何東西。只涵蓋 Chromium。
