# SAS 模型擬合 M4（3D 結構示意、序列擬合、IUCr 整合、匯出）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1–M3 之上補齊規格 §6–§9：3D 結構示意圖（自寫 Canvas 2D，8 個形狀模型；圖卡內以「曲線｜結構」切換）、第四個分段「序列」（選檔與結果同一張表、趨勢圖）、把擬合結果送進 IUCr 表格頁的「Model fitting (analytical form factor)」段落（含既有的「複製表格」，並修正「輸入框的值不進複製內容」的舊問題）、四種匯出（擬合曲線 CSV、報告 TXT、序列結果 CSV、各圖 PNG）；並在真實瀏覽器跑通「三個合成檔序列擬合 → 趨勢圖半徑遞增 → 送 IUCr → 複製表格 → 各匯出 → 3D 旋轉」。

**Architecture:** 與 M3 相同的純／DOM 分離。純模組（Node 可測）：各模型的參數化網格與蠕蟲鏈中心線、旋轉／正交投影／依規則排定繪製順序／Lambert 明暗（輸出「多邊形或粗線＋角色＋亮度」的繪製清單，不含顏色）、比例尺與文字描述、序列排程與執行器（client 以參數注入）、結果表與趨勢圖資料、IUCr 資料物件與列的 HTML、CSV／TXT 字串與檔名。DOM 層三個新檔（`sasfit-shape3d.js` 的 `create`、`sasfit-seq-ui.js`、`sasfit-export-ui.js`）只做「取元素、綁事件、把純函式的輸出寫進畫面或 canvas、觸發下載」。顏色只在 `js/chart-theme.js`（新增 3D 角色、各主題的環境光係數與 `shade3d`）。主執行緒仍不做模型計算；序列逐筆呼叫 `SasFitWorkerClient.fit`。

**Tech Stack:** 同 M3（Vanilla JS classic scripts、IIFE＋`globalThis.SasFitXxx = Object.freeze({...})`、Chart.js 4.5.1＋zoom 2.2.0＋annotation 3.1.0、Node `node --test`、Playwright 1.61 於 `~/Projects/text-to-cad/.venv`）。**不新增 CDN、不引入 three.js、不改 CSP、Worker 的 `importScripts` 清單不變。**

**規格：** `docs/superpowers/specs/2026-11-17-sasfit-a-design.md` §3.2、§3.3、§4.9（FitResult、顯示規則）、§4.10（`BUSY`、`stop()`）、§5.1–§5.7 現況、§6、§7、§8、§9、§11（G7、G8）、§12、§13、§15（決策 1–29）、§16（hayter_msa）、§17。**前置：** M3 計畫 `2026-11-18-sasfit-m3-ui.md`（共用規則、`host()`、圖表建立寫法、分段模組註冊約定、完成紀錄）。起點：`feat/sasfit` 的 `ed9db6f`；`node --test saxs-calculator/tests/*.test.js` 1362 項（1361 過、1 skip）；`tools/sasfit/smoke_browser.py`、`smoke_ui.py` ALL PASS。

**不在 M4（屬 M5）：** 全站端到端驗收、版本改 v5.3、合併、部署、線上冒煙。**版本維持 5.2**：新的 `<script>`／`<link>` 一律 `?v=5.2`（`tests/structure.test.js:199-206`）；程式裡不得寫死版本字串（守門測試只查兩個 Worker 檔，`structure.test.js:172-174`，但本計畫對所有新檔一律如此要求）。

---

## 審查與決定紀錄

**審查（2026-11-19）：** 對照程式碼逐行核對，並在 headless Chromium 149（本機 `http.server`）與 Node 實測；25 項問題與全部建議已直接寫進下文（沒有另立更正附錄）。

**使用者的決定（2026-11-19）：**
1. 3D 的位置＝圖卡內的分段控制「曲線｜結構」（`plotView: 'curve' | 'shape'`，預設 `'curve'`）；3D 畫布用主圖的位置與高度，尺寸與說明文字用殘差圖的位置；任何視窗都不需要欄內捲動。
2. IUCr「複製表格」的舊問題在 M4 一併修：複製內容（HTML 與純文字）帶 q-range／Exposure／Temperature 三個輸入框**目前的值**，複製出去的 HTML 不留 `<input>`。先以 Task 0 鎖住現況，再於 Task 17 刻意改變。

**工程決定（審查後定案）：**
3. 可送 IUCr：`status === 'converged'`、不是 `blockedByNonFinite`、且 `resultMatchesForm`。警示（貼邊界、`illConditioned`、`jacobianNonFinite`、強相關、誤差大於數值、σ 權重下 χ²ᵣ > 10、誤差已乘、曲線有非有限點）不擋送出，寫進 Notes 列。量度名稱照決策 24。
4. IUCr 段落標題「Model fitting (analytical form factor)」；列＝規格 §8 所列＋Number of points、Weighting、Status、Assumptions、Notes。**不列 CorMap P-value（本工具不計算）**；Task 19 的科學審查對照 Trewhella 等 2017 Table 1 與其 2023 更新版確認。
5. 序列各檔的設定：範圍未經使用者編輯時每檔用自己的 `defaultRange`；編輯過則每檔截到自己的可用範圍並在該列註記；σ 權重下沒有可用 σ 的檔**跳過**並註記（不改用別的權重）；官方檔與一般檔可以混用。
6. 序列初值：取**最後一筆**「已收斂、非 `blockedByNonFinite`、且（σ 權重時）χ²ᵣ ≤ `SasFitHints.CHI2R_WARN`（10）」的結果；貼邊界的收斂結果可以當初值。
7. 不做「續跑」（規格 §7 沒有；重跑即可）。停止保留已完成的結果。
8. 序列結束後：擬合對象若在這次序列中完成，把它的結果載入表單（並清掉還原點），頁面才不會顯示「參數已改動」；否則不動表單，序列分段提示可逐列載入。
9. 序列分段只有**一張表**：選檔的勾選欄與結果同表；資料清單不加「序列」欄。
10. 3D 慣例：殼／實心＝藍、核＝琥珀（起始色碼見 Task 1，UI 審查定稿）；不畫溶劑；顏色不對應 SLD；lamellar 畫成單一均勻薄板；尺寸用文字清單＋比例尺；柔性圓柱以沿中心線的粗線繪製、不做排除體積，替代文字與圖下說明註明是「一個代表性構形」；觸控只能改方位角；不提供平移；縮放用 Ctrl＋滾輪。
11. 報告 TXT：鍵名英文、說明句繁體中文；數值以匯出規則 `num` 全精度列出，參數另有一欄與畫面相同的「值 ± 誤差」（經 `sasfit-format.js`）。
12. 任務拆分：原 Task 4、6、7、8 各拆成 2–3 個，全計畫 Task 0–19。

**已驗證、可直接採信的事實：**
- **圖欄空間**（sticky 欄上限 849／749／717 px＝1440×900／1280×800／1024×768）：圖卡高 634／588／574 px（無擬合結果）、754／708／693 px（有結果）；有結果時殘差圖下只剩 95／41／24 px。主圖盒（＝3D 畫布）575×414、420×368、448×353；單欄（760×900）658×260。
- **`updateIUCrTable`** 只以 id 寫 13 個儲存格的 `textContent`（`section-iucr.js:70-107`），不碰 `innerHTML`；表格內第二個 `<tbody>` 不會被洗掉。**複製**送出 `table.outerHTML` 與 `table.innerText`（`:18-19`）；`innerText` 不含輸入框的值，`outerHTML` 只帶 `value` 屬性（預設值）。IUCr 分頁不在畫面上時 `innerText === textContent`（6388 字元的原始空白，顯示時是 604 字元）——**擷取與比對一律先切到 IUCr 分頁**。
- **新的複製做法已在瀏覽器驗證**：`cloneNode(true)` → 以現值的文字節點取代每個輸入框 → 掛進 `.sr-only` 容器讀 `innerText` → 移除，全程同步。三個輸入框清空時，文字與現況逐字相同、HTML 等於現況去掉 `<input>` 標籤。
- **`AppState`** 是 `js/app.js:10` 的頂層 `const`：`window.AppState` 是 `undefined`，裸名稱可用（`page.evaluate` 內也可）；頂層 `function` 宣告則是 `window` 的屬性。
- **CSP／下載**（`index.html:13-14`）：`<a download href="blob:…">` 可用（含中文、`@`、`+` 的檔名原樣保留）；`fetch('data:…')` 與 `fetch('blob:…')` **都被 `connect-src` 擋**。PNG 的路徑＝`ChartTheme.exportPng` 的 data URL **解成位元組**再包成 Blob，絕不 fetch。深色主題下匯出的 PNG 左上角是白色。`canvas.toBlob`、`createImageBitmap(Blob)` 可用。
- **假設三個分段的地方**：`index.html:471、483-486、489`；`section-sasfit.js:82-86、89-93、95、178-190、319`；`sasfit-state.js:63`；`tests/sasfit-state.test.js:42、428-437`；`tests/sasfit-section.test.js:26-29、215-221、260`；`tests/sasfit-fit-ui.test.js:728`（不會壞）；`tools/sasfit/smoke_ui.py:174、490-491、497-504`；`smoke_ui_b.py:143`（只是標籤）。`css/sasfit.css:57-80` 只看 `data-tab="model"`。stub DOM 由 `Section.ELEMENT_IDS` 建立（`tests/sasfit-ui-helpers.js:259`、`sasfit-section.test.js:76`），新 id 不必改 helper。
- **色碼掃描**：`/(?<![&\w])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g`，範圍是去註解後的 `css/*.css`、`js/*.js`、`index.html`（`tokens.css`、`chart-theme.js` 除外）；**`tests/` 與執行期產生的字串不掃**。`#sf…`、`#iucr-…` 選擇器安全（`s`、`i` 不是十六進位字元）。
- **Playwright**：頁面 CSP 沒有 `unsafe-eval`，`page.evaluate`／`wait_for_function` 傳**裸運算式字串會丟 EvalError**，一律傳箭頭函式字串（`'() => …'`）。context 給 `permissions=['clipboard-read', 'clipboard-write']` 後 `navigator.clipboard.readText()` 與 `read()`（`text/html`）在 headless 可用；`accept_downloads=True` 後 `page.expect_download()` 可讀下載檔。`#section-iucr` 目前 axe 0 違規（兩主題）。
- `\bDa\b`（`mass-units.test.js`）不會誤判「Data file」。`String(-0)` 是 `'0'`。`numpy.loadtxt` 讀不了帶表頭與空格的 CSV（與編碼無關）。

---

## 全體任務共用規則

M1 計畫共用規則第 1–8 條、M2 第 2–4 條、M3 第 1–9 條**全部沿用**（模組慣例、`host()` 取非 SasFit 全域、進 `innerHTML` 前過 `FormUtils.escapeHtml`、不可變、顏色只靠角色、CSP、繁中畫面文字與 justify、hayter_msa 的非有限值是預期輸入、不改既有 fixture、不 push、對不上就停下來回報）。本里程碑只補新增的部分：

1. **載入順序**（`index.html:2378-2405` 現況之上）：… → hints → html → plot-data → plots → **shape-geom → shape-view → shape3d → sequence → seq-view → export → report → iucr** → data-ui → params-ui → fit-ui → **seq-ui → export-ui** → section-sasfit → `app.js`。每新增一個 `js/sasfit-*.js`，**同一個 commit** 加 `<script … ?v=5.2>`（位置照上面）；「檔案結構」表標「LOAD_ORDER ✓」者同時加進 `tests/load.js` 的 `LOAD_ORDER` 與 `module.exports`（`structure.test.js:133-138、274-282`）。**沒有任何新模組需要在 Worker 內載入**：`sasfit-worker.js` 的 `importScripts` 清單與 `tests/sasfit-helpers.js` 的 `WORKER_MODULES` 不動（`structure.test.js:149-163`）。
2. **`AppState` 不在 `window` 上**：讀寫一律在**呼叫時**以裸名稱 `AppState` 取用並先 `typeof AppState !== 'undefined'`；純模組不碰它（Node 測試以參數傳入）。寫入只發生在 `js/section-iucr.js` 的 `setIUCrModelFit` 一處，且是「新物件取代舊值」。
3. **`sasfit-html.js` 已 710 行**（上限 800，`structure.test.js:216-227`）：本里程碑的 HTML 字串一律寫在新檔（`sasfit-seq-view.js`、`sasfit-iucr.js`、`sasfit-shape-view.js` 只出純文字），不得再往 `sasfit-html.js` 加函式；需要它的小工具時呼叫既有匯出（`unitText`、`statusChipHtml`、`middleEllipsis`、`hintsHtml`，`sasfit-html.js:703-709`）。
4. **數字 → 文字只有兩條路**：畫面與 IUCr 表格走 `SasFitFormat.valueError／number／display`（`sasfit-format.js:152-154`）；匯出檔走 `SasFitExport.num`（全精度、ASCII、可讀回）。任何新檔不得自己 `toFixed`／`toPrecision`（3D 的 nm 標註例外，集中在 `SasFitShapeView.nm` 一個函式）。
5. **擬合量度的名稱**：只有權重＝資料 σ 時稱 χ²ᵣ／約化 χ²，其餘稱「加權殘差均方」（決策 24）。一律經 `SasFitHints.measure(fitResult | weighting)`（`sasfit-hints.js:178`）或 `SasFitLabels.measureName`，新檔不得出現寫死的「χ²ᵣ」欄名。
6. **`js/` 原始碼裡 `#` 之後一定接空白或非十六進位字元**：色碼掃描會把字串裡的 `#bad`、`#fee`、`#added` 當色碼。匯出的註解前綴寫成常數 `'# '`。（掃描不看 `tests/` 與輸出內容，所以測試裡的期望字串與使用者檔名不受此限。）
7. **3D 與匯出的顏色**：`sasfit-shape*.js`、`sasfit-export*.js`、`sasfit-report.js` 不得出現色碼或 `rgb(` 等；3D 面與粗線的顏色只來自 `ChartTheme.shade3d(role, k, theme?)`，文字與線來自 `ChartTheme.palette(theme)` 的鍵。
8. **還沒綁事件的按鈕在標記裡帶 `disabled`**：先放標記、後面任務才綁的按鈕（`#sfShapePng`、`#sfSeqRun`、`#sfSeqCsv`、`#sfSeqTrendPng`、`#sfSendIucr`）在綁定的任務之前一律是停用的，任何一個中間 commit 都沒有按了沒反應的按鈕。
9. **Playwright 腳本**：`page.evaluate`／`wait_for_function` 只傳箭頭函式字串；讀下載檔用 `expect_download`，要在頁面內檢查像素就把位元組以參數傳進去，**不得在頁面內 `fetch` blob: 或 data: 網址**。
10. **commit 訊息不帶任何 trailer**（沒有 `Co-Authored-By`、沒有 `Generated with`、沒有任何署名行）；格式 `<type>: <description>`，訊息見各任務。
11. 每個任務結束：`node --test saxs-calculator/tests/*.test.js` 全綠；`~/Projects/text-to-cad/.venv/bin/python tools/sasfit/smoke_browser.py` 與 `smoke_ui.py` ALL PASS（`smoke_ui.py` 只在兩處修改：Task 10 分頁變四個；Task 18 讓 axe 的範圍可以傳入）；`git status` 沒有 `tools/sasfit/__pycache__/`；一個 commit。Task 18 之後另加 `smoke_m4.py`。

## 執行順序

Task 0 → 1 → 2 → … → 19 **依序**（Task 3 起幾乎每個任務都改 `index.html` 的同一段 `<script>` 與 `tests/load.js`）。可平行的只有：**Task 0、1、2、3 四者彼此平行**（Task 0 只加測試、fixture 與 `tools/`；Task 1 只改 `chart-theme.js` 與兩個測試檔；Task 2 只改 `sasfit-state.js`、`section-sasfit.js:319` 與兩個測試檔；Task 3 是唯一碰 `index.html`／`tests/load.js` 的——四者的檔案不重疊，各自一個 commit）；以及 Task 19 的三個審查（唯讀）。Task 4 起一律依序。IIFE 內一律縮排（`structure.test.js:85-91`）。

## 效能／體驗決定

1. **3D 只在需要時重畫**：沒有常駐動畫迴圈。重畫的觸發＝`plotView` 是 `'shape'` 時的參數／模型改變（與預覽共用 150 ms debounce 後的表單）、拖曳／鍵盤／縮放、主題切換（`tps:themechange`）、容器尺寸改變（`ResizeObserver`）、切到「結構」。每次重畫用一個 `requestAnimationFrame` 合併。「自動旋轉」開啟時才有 rAF 迴圈（≤ 30 fps），而且在 `plotView` 不是 `'shape'`、分頁不是 `sasfit`、`document.hidden`、或擬合／序列進行中時暫停。`plotView` 是 `'curve'` 時不建網格、不呼叫 `getContext`。
2. **面數預算**：每物件 ≤ 4000 面（規格 §6），整個場景 ≤ 8000 面（核＋殼）。網格只在「形狀參數或模型改變」時重建並快取；旋轉只重做投影與排序。canvas 後備解析度＝CSS 尺寸 × `min(devicePixelRatio, 2)`。
3. **正交投影**：「按比例」與比例尺只有在正交投影下才處處成立；不用透視。預設縮放以**外接球**為準（與旋轉無關，轉動時比例尺不變），留 8% 邊距。初始視角固定在切口的平分面上（方位 45°、仰角 20°），兩個切面都朝向觀察者。沒有平移；`ZOOM_RANGE` 是 0.5–4，所以很長的圓柱放大後只看得到中段（圖下說明寫明）。
4. **3D 區的位置**（使用者決定 1）：圖卡標題列的分段控制「曲線｜結構」。「曲線」＝現有的狀態列、主圖、操作說明、殘差區（包進 `#sfCurveView`）；「結構」＝`#sfShapeView`：狀態行、3D 畫布（`.sf-shape-stage`，高度與主圖相同：`clamp(300px, 46vh, 460px)`，單欄 `clamp(180px, 30vh, 260px)`）、操作說明、尺寸清單與說明文字。工具列跟著換（曲線：主圖模式／重設縮放／PNG；結構：重設視角／自動旋轉／PNG）。預算：有擬合結果的曲線檢視在 1440×900／1280×800／1024×768 距離欄高上限 95／41／24 px——切換鈕必須放在**既有的標題那一行**，不得多佔一行；Task 6 實測兩種檢視在三種視窗都不產生欄內捲動、標題列在圖卡內寬 420 px 時不折行（Task 15 加入 `#sfMainPng` 後再量一次）。單欄版面「模型」分段把圖釘在頂端時，「結構」檢視只留畫布（說明與文字收起來），調尺寸時看得到形狀跟著變。
5. **滾輪**：比照決策 28，3D 畫布上單純的滾輪**不攔截**（頁面照常捲動），Ctrl＋滾輪（觸控板兩指縮放在桌面瀏覽器就是 Ctrl＋wheel）才縮放，監聽器以 `{ passive: false }` 註冊；觸控螢幕的兩指距離以 pointer events 處理，畫布 `touch-action: pan-y`——單指垂直滑動捲頁、水平拖曳改方位角，**觸控不能改仰角**（圖下說明寫明；鍵盤與滑鼠可以）。
6. **序列的進度粒度**：「第 k／N 筆」在每筆開始與結束時更新；該筆的步數與量度沿用 `fitProgress`（每個被接受的步）。朗讀區（`aria-live`）只在開始、每筆結束（最多每 2 秒一次）與結束時更新。
7. **序列期間不逐次整頁重繪**：`ctx.dispatch` 預設會 `refresh()` 全部分段（`section-sasfit.js:218-225`）。500 個檔、每筆數毫秒的擬合會造成 500 次以上的整頁重繪，所以序列執行中 seq-ui 對 `seqStep` 與 `fitProgress` 一律 `dispatch(action, { silent: true })`，擬合列的進度文字經 `ctx.fit.setBarProgress(text)` 直接寫入，另以**一個節流的 `ctx.refresh()`**（最多每 250 ms 一次，結束時一定一次）更新其餘畫面。結果表不做虛擬捲動（上限 500 列 × 至多十餘欄，一次 `innerHTML` 可接受），放在 `.table-wrapper`，高度上限 `min(50vh, 24rem)`，欄內捲動、表頭 sticky。
8. **趨勢圖放在序列分段內**（左欄，表格之上，高 220 px），不佔圖欄。趨勢圖不開縮放（點少），誤差棒重用 `SasFitPlots.ERROR_BARS`（`sasfit-plots.js:94-103`）；圖的實例由 `SasFitPlots.renderTrend` 擁有（Task 9）。
9. **序列期間 `state.fit.phase` 全程是 `'running'`**：每筆之間不回到 `'idle'`（由 action `seqStep` 一次完成「存上一筆結果＋換下一筆」），既有三個分段模組以 `fit.phase === 'running'` 判斷的鎖定（`sasfit-state.js:406-408`、`sasfit-fit-ui.js:280、290-291`）不必逐一改寫。**解鎖在每一條路徑上都發生**（Task 11：比照 `sasfit-fit-ui.js:336-348` 的 `settle()`）。
10. **匯出不經 Worker、不重算**：CSV 與 TXT 完全由已存的 Dataset 與 FitResult（`params`、`curve`、`residuals`、`settings`）組成；`in_fit` 以 `SasFitWeighting.select` 重新取得（與 Worker 同一個函式），不由殘差是否有限推斷。
11. **下載一律 Blob＋object URL**：文字檔 `new Blob`；Chart.js 的 PNG 由 `ChartTheme.exportPng`（回傳 data: URL，`chart-theme.js:237-251`）經純函式 `SasFitExport.dataUrlBytes` 解成位元組後包成 Blob；3D 用離屏 canvas 的 `toBlob`。不需改 CSP。
12. **列印**：3D 畫布是點陣圖，不會跟著 `@media print` 換色；比照圖表（`chart-theme.js:268-270`），`beforeprint` 以淺色重畫、`afterprint` 換回。

## 檔案結構

| 檔案 | 動作 | LOAD_ORDER | 職責 |
|---|---|---|---|
| `js/chart-theme.js` | 修改 | — | 兩個調色盤各加 3D 角色與 `shapeAmbient`；新增 `shade3d(role, k, theme?)`、`SHAPE_ROLES` |
| `js/sasfit-shape-geom.js` | 新增 | ✓ | 7 個形狀模型的網格產生器（面帶 `part` 標記）、固定種子 PRNG、蠕蟲鏈中心線 |
| `js/sasfit-shape-view.js` | 新增 | ✓ | 視角 reducer、正交投影、背面剔除、依 `part` 與切面的繪製順序、Lambert 亮度 → 繪製清單；比例尺；nm 標註與文字描述 |
| `js/sasfit-shape3d.js` | 新增 | ✓（頂層無 DOM） | Canvas 繪製（角色＋亮度 → `shade3d`）、拖曳／鍵盤／縮放、自動旋轉、PNG 用的淺色重繪；模組 `{ create, paint }` |
| `js/sasfit-sequence.js` | 新增 | ✓ | 序列排程、每檔範圍、起始值規則、執行器（client 注入） |
| `js/sasfit-seq-view.js` | 新增 | ✓ | 序列表（選檔＋結果）的列與 HTML、趨勢圖資料與 config |
| `js/sasfit-export.js` | 新增 | ✓ | `num`、CSV 儲存格（含公式注入防護）、註解列、檔名、data URL → 位元組、軟體字串、由 FitResult 取參數列、擬合曲線 CSV |
| `js/sasfit-report.js` | 新增 | ✓ | 報告 TXT、序列結果 CSV |
| `js/sasfit-iucr.js` | 新增 | ✓ | `AppState.sasfitData` 物件的建構、可否送出的判斷、「Model fitting」列的 HTML |
| `js/sasfit-seq-ui.js` | 新增 | ✗（DOM） | 序列分段：勾選、選項、執行／停止、表格、趨勢圖、點列載入 |
| `js/sasfit-export-ui.js` | 新增 | ✗（DOM） | 匯出與「送進 IUCr 表格」按鈕、下載觸發、各圖 PNG |
| `js/sasfit-plots.js` | 修改 | — | `renderTrend(config)`、`getChart('sfSeqTrend')` |
| `js/sasfit-state.js` | 修改 | — | `TABS` 加 `'sequence'`；`plotView`；`seq` 狀態與 action |
| `js/section-sasfit.js` | 修改 | — | 第四個分段、三個新模組的註冊、`ctx.sequence`／`ctx.fit`、新的必要元素、新的 deps |
| `js/sasfit-fit-ui.js` | 修改 | — | 序列進行中的擬合列、`forgetRevert()`、`setBarProgress(text)` |
| `js/sasfit-data-ui.js`、`js/sasfit-params-ui.js` | 修改（僅必要時） | — | 只在 Task 11 的測試證明鎖定或重繪有缺口時才動 |
| `js/section-iucr.js` | 修改 | — | `renderIUCrModelFit()`、`setIUCrModelFit(data)`、`iucrCopySource(table)`（輸入框現值、空的擬合段不進複製） |
| `js/app.js` | 修改 | — | `AppState` 加 `sasfitData: null`（`app.js:10-15`） |
| `css/sasfit-views.css` | 新增 | — | 檢視切換、3D 區、序列分段、匯出列、IUCr 擬合段（`sasfit.css` 已 580 行） |
| `index.html` | 修改 | — | 區段 2 內：檢視切換與 `#sfShapeView`、第四個分頁鈕與面板、匯出與 PNG 按鈕；**區段 3**（IUCr 表格內的 `<tbody>`）；`<script>`、`<link>` |
| `tests/markup.test.js` | 修改 | — | `REGION_SIGNATURES` 尾端加一項；`REGION_ID` 改成每個區段各一個樣式 |
| `tests/theme.test.js`、`tests/contrast.test.js` | 修改（只加測試） | — | 3D 角色與 `shade3d` |
| `tests/sasfit-state.test.js`、`tests/sasfit-section.test.js`、`tests/sasfit-fit-ui.test.js`、`tests/sasfit-plots.test.js` | 修改 | — | 四個分段、新狀態、`renderTrend` |
| `tests/sasfit-shape-geom.test.js`、`sasfit-shape-view.test.js`、`sasfit-shape-order.test.js`、`sasfit-shape3d.test.js`、`sasfit-shape3d-ui.test.js`、`sasfit-sequence.test.js`、`sasfit-sequence-run.test.js`、`sasfit-seq-view.test.js`、`sasfit-seq-ui.test.js`、`sasfit-seq-ui-run.test.js`、`sasfit-export.test.js`、`sasfit-report.test.js`、`sasfit-export-ui.test.js`、`sasfit-iucr.test.js`、`iucr-table.test.js` | 新增 | — | 各模組測試（每檔 ≤ 800 行；fixture 共用 `tests/sasfit-m4-helpers.js`，射線判定共用 `tests/sasfit-shape-oracle.js`） |
| `tests/fixtures/sasfit/iucr-copy-v5.2.json` | 產生一次 | — | 現行「複製表格」輸出的基準（Task 0），之後不得重產 |
| `tools/sasfit/{capture_iucr_copy.py, check_iucr_copy.py, smoke_m4.py}`、`smoke_ui.py`、`README.md` | 新增／修改 | — | 基準擷取；複製行為的比對；M4 冒煙；`smoke_ui.py` 的分頁檢查改四段 |
| 規格書、本計畫 | 修改 | — | Task 19 |

**與規格的出入（Task 19 同步進規格）：**
1. §3.2 的 `sasfit-shape3d.js`、`sasfit-sequence.js`、`sasfit-export.js` 各拆成純／DOM 兩層以上，另新增 `sasfit-seq-view.js`、`sasfit-report.js`、`sasfit-iucr.js`；趨勢圖的實例在 `sasfit-plots.js`；§3.3 載入順序相應加長。
2. §5.1 把 3D 畫在殘差圖之下 → 改為圖卡內的「曲線｜結構」切換（使用者決定 1）。
3. §5.2 的「序列（☑）」欄不放在資料清單 → 序列分段內一張表同時負責選檔與結果。
4. §6「滾輪縮放」→ Ctrl＋滾輪（與決策 28 一致）；尺寸標註不畫在 3D 圖上 → 圖上的比例尺＋圖下的文字清單；柔性圓柱畫成粗線而非網格；lamellar 的橫向不按比例。
5. §7：未編輯範圍時每檔用自己的預設範圍；沒有可用 σ 的檔在 σ 權重下跳過；初值規則多了「非 `blockedByNonFinite`、σ 權重時 χ²ᵣ ≤ 10」；序列結束後自動載入擬合對象的結果；被單筆擬合取代的列有標記。
6. §8 的物件多了 `radiusEffectiveMode`、`measure`、`status`、`dof`、`assumptions`、`notes`、`errorsScaled`、每個參數的 `atBound` 與 `errorShown`；`software` 的版本由頁面版本導出；段落標題與列清單（工程決定 4）；可送出的條件（工程決定 3）。
7. §8「未送出前此段顯示尚未送入擬合結果」只顯示在畫面上，**不進「複製表格」**。
8. §8／既有行為：複製內容帶輸入框的現值、不留 `<input>`（使用者決定 2）。
9. §9：擬合曲線 CSV 的數值全精度；文字儲存格有公式注入防護；註解列不加 CSV 引號；報告 TXT 的參數有全精度與「畫面格式」兩種寫法。

## 守門測試對 M4 的要求（已逐一核對）

| 測試 | M4 要做到 |
|---|---|
| `markup.test.js:46` `REGION_SIGNATURES` | 尾端加 `'id="iucr-sf-body"'`；區段數變 3（`:147-155`） |
| `markup.test.js:49` `REGION_ID` | 改為依區段順序的 `REGION_IDS = [SF, SF, /^iucr-sf(?:-[a-z0-9]+)*$/]`（`SF`＝現行樣式 `/^(?:section-sasfit|sf[A-Z]\w*)$/`），`:166-170` 的測試改成逐區段比對自己的樣式——區段 2 不能用 `iucr-sf-*`、區段 3 不能用 `sf*`。其餘斷言不放寬 |
| `markup.test.js:157-164` | 區段 3 的 id 不得與 IUCr 頁既有的 `iucr-*`（如 `iucr-protein`、`iucrTable`、`iucr-qrange`）重複 |
| `markup.test.js:172-186` | 現行測試已經是對**全部區段的聯集**檢查（`REGIONS.join`），不必改：IUCr 區段不能參照 `iucrTable` 或 `iucr-title`（在區段外）；「送進 IUCr」按鈕的 `aria-describedby` 指向區段 2 內的 `sfSendIucrNote`。區段 3 不放任何表單控制項 |
| `markup.test.js:188-209` | 區段內沒有行內 `style`、`on*=`、`<script>`、`javascript:`、帶 `href` 的 `<a>`——下載連結由 JS 在執行期建立 |
| `markup.test.js:116-126` | 區段切掉後其餘與 v4.15 fixture 相同：區段 3 必須是 `<table id="iucrTable">` 內**完整的一個 `<tbody>` 元素**；IUCr 頁區段外不得新增任何 `id`／`aria-*`；區段 2 內把既有元素包進新的 `div` 不影響（id 不變） |
| `structure.test.js:133-138、193-206` | 10 個新 JS、1 個新 CSS 都被引用一次且 `?v=5.2` |
| `structure.test.js:39、149-163` | `WORKER_ONLY`、`importScripts` 清單**不變** |
| `structure.test.js:105-122` | `section-iucr.js` 新增的頂層函式名稱不得與其他檔重複：一律以 `iucr`／`IUCr` 命名（`setIUCrModelFit`、`renderIUCrModelFit`、`iucrCopySource`、`iucrCopyClone`…） |
| `structure.test.js:311-320` | 趨勢圖沿用 `sasfit-plots.js:146-149` 的 `createChart`（`new global.Chart(canvas, global.ChartTheme.colorize(config))`） |
| `no-color-literals.test.js:16-20` | 見共用規則 6、7；`shade3d` 的顏色運算與字面值只在 `chart-theme.js` |
| `token-usage.test.js` | `sasfit-views.css` 只用既有 token、文字色只用文字 token、不用 `border-left` |
| `contrast.test.js:125-135` | 3D 角色不是線，不加進 `CHART_LINE_ROLES`；另加測試（Task 1） |
| `theme.test.js` | 只新增測試（既有測試不列舉調色盤的鍵） |
| `batch3.test.js:71-84、137-198` | 不自建跳脫函式；CDN 仍 4 支；沒有行內事件 |
| `result-golden.test.js:34-38` | **IUCr 頁不在 golden 內**，`tests/` 目前沒有任何檔載入 `section-iucr.js`。「既有輸出」靠 Task 0 新增的特性測試與複製基準來鎖，golden fixture 不動 |
| `mass-units.test.js:126-146` | `section-iucr.js`、`section-sasfit.js`、`index.html` 新增的文字不得有獨立的 `Da` |
| `mass-units-dom.test.js` | 序列分段的輸入在 `#section-sasfit` 內，已被 `form-persistence.js` 排除；區段 3 沒有輸入 |
| `sasfit-state.test.js:42、428-437`、`sasfit-section.test.js:26-29、215-221、260` | Task 2 改寫（四個分段）；`sasfit-section.test.js:260` 的分段模組清單在 Task 6、10、15 各加一項 |
| `smoke_ui.py:174、490-491、497-504` | `tab()` 與 `check_keyboard` 寫死三個分頁（`End` → `sfTabFit`）：Task 10 同一個 commit 改成四個 |

## 介面（各任務之間的約定）

```js
// chart-theme.js（Task 1）
PALETTES.light／dark 各新增：shapeSolid、shapeShell、shapeCore、shapeEdge（顏色字串）、shapeAmbient（數字，比照 errorBarAlpha）
ChartTheme.SHAPE_ROLES = ['shapeSolid', 'shapeCore', 'shapeShell']       // 面與粗線的角色；shapeEdge 是輪廓線與比例尺
ChartTheme.shade3d(role, k, theme = resolved()) → 顏色字串               // k＝Lambert 亮度 0–1（界外與 NaN 截到 0／1／0）；未知角色丟 Error
   // 係數＝shapeAmbient + (1 − shapeAmbient)·k，在線性色彩空間乘上基底色。環境光只在這裡，別處不得再加

// sasfit-shape-geom.js（Task 3）—— 純函式；長度單位 Å；z 為對稱軸
SasFitShapeGeom.MAX_FACES = 4000;  SEED = 固定整數常數;  LATERAL_FACTOR = 6
SasFitShapeGeom.PART = { SOLID: 0, CAVITY: 1, CUT_A: 2, CUT_B: 3, OUTER: 4 }
   // CUT_A：平面 y = 0（x > 0 的半邊），外法線 +y；CUT_B：平面 x = 0（y > 0 的半邊），外法線 +x；切掉的楔形是方位角 0–90°
SasFitShapeGeom.SHAPE_MODELS = ['sphere','ellipsoid','cylinder','core_shell_sphere','vesicle','core_shell_cylinder','flexible_cylinder','lamellar']
SasFitShapeGeom.hasShape(model) → boolean
SasFitShapeGeom.build(model, params) → scene | null                      // 尺寸非有限、為負、或全為 0 → null
   scene（網格）= { kind: 'mesh', objects: [mesh], bounds: { min:[x,y,z], max:[x,y,z] }, radius /*外接球*/, notToScale: [字串] }
   scene（粗線）= { kind: 'tube', centreline: Float64Array(3·(n+1)), tubeRadius, segments, bounds, radius, notToScale }   // 只有 flexible_cylinder
   mesh = { role, vertices: Float64Array(3n), faces: [Uint32Array 索引（逆時針＝外法線）], part: Uint8Array(面數), closed: true }
SasFitShapeGeom.prng(seed) → () => [0,1)                                 // mulberry32
SasFitShapeGeom.wormChain({ length, kuhnLength, seed = SEED }) → { points: Float64Array, segments, ds }

// sasfit-shape-view.js（Task 4）—— 純函式
SasFitShapeView.DEFAULT_VIEW = { yaw: 45, pitch: 20, zoom: 1 }（度）;  ZOOM_RANGE = [0.5, 4];  KEY_STEP = 5
SasFitShapeView.viewDirection(view) → [x,y,z]      // 物體座標中「由物體指向觀察者」的單位向量 (cos p·cos y, cos p·sin y, sin p)；z 軸在畫面上朝上
SasFitShapeView.reduce(view, action) → view        // rotate {dYaw, dPitch} | zoom {factor} | reset | key {key}（方向鍵、+、=、-、0、Home）
SasFitShapeView.drawList(scene, view, size /*{ width, height }*/) → { items, pixelsPerAngstrom }
   items 依繪製順序：{ kind: 'polygon', points: [x0,y0,…], role, k } | { kind: 'stroke', points: [x0,y0,x1,y1], width, role, k }
SasFitShapeView.scaleBar(pixelsPerAngstrom, width) → { nm, pixels, label } | null     // 1–2–5 級距，label 例 '5 nm'
SasFitShapeView.nm(angstrom) → '5.0'                                                   // Å→nm（唯一的 toFixed）
SasFitShapeView.shapeParams(form) → { 參數名: 數字 } | null                             // 表單 → build 的輸入；欄位無效時 null
SasFitShapeView.describe(form, { pixelsPerAngstrom }?) → { title, dims: [{ label, text }], extras: [字串], alt } | null      // 全部純文字（未跳脫）

// sasfit-shape3d.js（Task 5–7）—— 頂層無 DOM
SasFitShape3d.paint(ctx2d, list, { theme, size, bar, background /*boolean：先填白底（PNG 用）*/ }) → void
SasFitShape3d.create(ctx) → { render(), exportBlob() → Promise<Blob | null> }

// sasfit-state.js（Task 2）
SasFitState.TABS = ['data','model','fit','sequence'];  PLOT_VIEWS = ['curve','shape']
state.plotView: 'curve' | 'shape'（預設 'curve'）
state.seq = { phase: 'idle'|'running', selected: { id: boolean }, options: { chain, sort }, order /*上一次執行的 id 順序 | null*/,
              rows: { id: row }, form /*開始時的表單快照 | null*/, settings /*{ weighting, maxSteps, rangeEdited } | null*/,
              warnings: [字串], y /*趨勢圖的 y | null*/, outcome /*'finished'|'stopped'|'aborted'|null*/ }
   row = { id, state: 'pending'|'running'|'done'|'skipped'|'error', result /*FitResult | null*/, range /*{ qMin, qMax } | null*/, note, startedFrom /*id | null*/ }
action: setPlotView {view} | setSeqSelected {id, selected} | setSeqAll {selected} | setSeqOption {key, value} | setSeqY {name} |
        seqStarted {plan, form, settings} | seqStep {id, row, next /*id | null*/} | seqSettled {outcome}
SasFitState.seqSelectedFiles(state) → 有資料且被勾選的檔案項目（未曾設定者視為勾選）

// sasfit-sequence.js（Task 8）—— 純函式（run 除外：async，但只碰注入的 fitOne）
SasFitSequence.plan({ files, selected, options, range, weighting, form }) → { items: [{ id, range, note, skip /*原因 | null*/ }], warnings }
SasFitSequence.isUsableStart(fitResult) → boolean
SasFitSequence.startForm(form0, lastUsable /*FitResult | null*/, chain) → form
SasFitSequence.run({ plan, form, settings, datasetOf(id), fitOne(job, onProgress), onEvent }) → Promise<{ outcome: 'finished'|'stopped'|'aborted', error? }>
   // onEvent: { type: 'start', total, fittable } | { type: 'row', id, row, next } | { type: 'progress', id, iteration, chi2r } | { type: 'end', outcome, error? }

// sasfit-seq-view.js（Task 9）—— 純函式
SasFitSeqView.MEASURE_KEY = '$measure'
SasFitSeqView.columns(state) → { names, measure /*SasFitHints.measure 的回傳*/, scaled /*誤差是否已乘*/ }
SasFitSeqView.tableRows(state) → [{ id, fileName, condition, selected, canLoad, cells: [{ value, error, mark }], measure, status, note, stale }]
SasFitSeqView.headHtml(columns, conditionName) → 字串;  bodyHtml(rows, { locked }) → 字串          // 已跳脫
SasFitSeqView.yOptions(state) → [{ value, label }]
SasFitSeqView.trend(state, yName) → { points: [{ x, y, yMin, yMax, id, style }], xTitle, yTitle, omitted, byOrder, label /*canvas 的 aria-label*/ }
SasFitSeqView.trendConfig(trend) → Chart.js config（tpsSeries: 0；無顏色；不含外掛）

// sasfit-plots.js（Task 9 新增）
SasFitPlots.renderTrend(config /* | null */) → chart | null          // canvas #sfSeqTrend；null → 銷毀
SasFitPlots.getChart('sfSeqTrend') → chart | null

// sasfit-export.js（Task 13）—— 純函式
SasFitExport.num(x) → String(x)（非有限 → ''；−0 → '0'）
SasFitExport.cell(value) → CSV 儲存格（RFC 4180；文字型另做公式注入防護）
SasFitExport.commentLine(key, value) → '# key: value'（value 已清理、不加引號）
SasFitExport.safeName(text, fallback) → 可作檔名的字串;  fileName(kind, { dataName, modelSpec, conditionName }) → 檔名
SasFitExport.modelText(modelSpec) → 'core_shell_sphere@hardsphere+power_law'
SasFitExport.software(version) → 'sasmodels 1.0.12 (WebAssembly), TPS13A SAXS Calculator v<version>'      // version 不是非空字串 → Error
SasFitExport.paramRows(fitResult, bounds /*{ name: [lower, upper] } | null*/) → [{ name, value, error, errorScaled, errorShown, unit, fitted, atBound, lower, upper, pd /*{ type, npts, nsigmas } | null*/ }]
SasFitExport.inFit(dataset, fitResult) → Uint8Array            // SasFitWeighting.select(dataset, settings.weighting, settings.range).index
SasFitExport.fitCsv({ file, fitResult, software }) → 字串
SasFitExport.dataUrlBytes(dataUrl) → { mime, bytes: Uint8Array }     // 只接受 data:image/png;base64,

// sasfit-report.js（Task 14）—— 純函式
SasFitReport.reportTxt({ file, fitResult, bounds, software, generatedAt, conditionName }) → 字串
SasFitReport.sequenceCsv({ state, software }) → 字串

// sasfit-iucr.js（Task 16）—— 純函式
SasFitIucr.HEADING = 'Model fitting (analytical form factor)';  SENDABLE = ['converged']
SasFitIucr.canSend(form, fitResult) → { ok, reason }
SasFitIucr.data({ fileName, fitResult, form, version }) → 凍結的 sasfitData（形狀見 Task 16）
SasFitIucr.rowsHtml(data /* | null */) → 字串（<tr>…；null → 標題列＋「尚未送入擬合結果」列）

// section-iucr.js（Task 17；頂層函式，沿用該檔慣例）
setIUCrModelFit(data)      // AppState.sasfitData = data（新物件取代舊值；null 表示清除）後呼叫 renderIUCrModelFit()
renderIUCrModelFit()       // tbody#iucr-sf-body 的 innerHTML = SasFitIucr.rowsHtml(AppState.sasfitData)；設定 data-empty
iucrCopySource(table)      // → { html, text, node, release() }：處理過的複本（輸入框換成現值；擬合段為空時不含它）；release() 移除暫時的容器

// 分段模組與 ctx（section-sasfit.js）
SasFitSeqUi.create(ctx) → { render(), running(), barText() }           // Task 10–12
SasFitFitUi.create(ctx) → { render(), forgetRevert(), setBarProgress(text) }     // Task 11 新增後兩者
SasFitExportUi.create(ctx) → { render() }                              // Task 15
ctx.sequence = { running(), barText() }     // 轉接到 seq-ui；沒有該模組時 running() false、barText() ''
ctx.fit = { forgetRevert(), setBarProgress(text) }      // 轉接到 fit-ui；沒有該模組時是 no-op
ctx.shape = { exportBlob() }                // 轉接到 3D 分段（Task 15 加入）；沒有該模組時 resolve null
ctx.deps 新增：raf、cancelRaf、matchMedia、createCanvas、observeResize（Task 6）；download(blob, fileName)、now()、sendIucr(data)（Task 15、17）
```

---
### Task 0: IUCr 頁現況的特性測試與複製基準（可與 Task 1、2、3 平行）

**Files:** Create `tests/iucr-table.test.js`、`tools/sasfit/capture_iucr_copy.py`、`tests/fixtures/sasfit/iucr-copy-v5.2.json`。不改任何 `js/`、`index.html`。

目的：`result-golden` 不涵蓋 IUCr 頁，而「複製表格」直接走 DOM（`table.outerHTML` 與 `table.innerText`，`js/section-iucr.js:18-19`），Node 裡測不到。動它之前先把現況鎖住。這是**新的 fixture**（先前沒有測試涵蓋的行為），不是重產既有的。

- [ ] **Step 1：`tests/iucr-table.test.js`**（vm 載入 `js/section-iucr.js`；stub `document.getElementById` 回傳記錄 `textContent`／`classList` 的假元素；全域放 `AppState`、`MassUnits`）。對現行程式應該**直接通過**的特性測試：
  - `formatIUCrValue`：`NaN`、`Infinity`、`undefined` → `'-'`；`(1.03321, 5)` → `'1.03321'`。
  - `updateIUCrTable()` 以固定的 `proteinData`／`saxsData`（取 `result-golden.test.js:43-47` 的 `PROTEIN`、`SAXS_FULL` 再補 `name`、`partialSpecificVolume`）：逐一斷言 13 個 id 的文字（`iucr-protein`、`iucr-dryvol`、`iucr-vbar`、`iucr-mw-seq`、`iucr-wavelength`、`iucr-concentration`、`iucr-i0-pr`、`iucr-rg-pr`、`iucr-i0-guinier`、`iucr-rg-guinier`、`iucr-dmax`、`iucr-porod`、`iucr-mw-porod`）與 `iucrWarning` 被加上 `hidden`；兩者皆 `null` 時不寫任何元素、警告不動。
  - 這些測試在 Task 17 之後必須**一字不改**仍然通過（Task 17 只在本檔新增測試）。
- [ ] **Step 2：`capture_iucr_copy.py`**（`sys.dont_write_bytecode = True` 後匯入 `smoke_browser` 的 `start_server`、`open_page`；所有 `evaluate` 傳箭頭函式）。提供兩個之後會被重用的函式：`show_iucr(page)`（點 `[data-section="iucr"]` 並等 `#section-iucr.active`——**分頁不在畫面上時 `innerText` 退化成 `textContent`，擷取到的不是使用者複製到的內容**）與 `fill_iucr(page)`（以 `page.evaluate` 設定 `AppState.proteinData`／`saxsData`〔同 Step 1 的值〕後呼叫 `updateIUCrTable()`）。主程式在未修改的頁面、全新的 browser context 上，於 IUCr 分頁顯示中的兩種狀態各取一次 `{ text: table.innerText, html: table.outerHTML }`——`default`（剛切到該頁）與 `filled`（`fill_iucr` 之後），另記三個輸入框的 `{ id, value }`（`iucr-qrange`、`iucr-exposure`、`iucr-temperature`）與 Chromium 版本，寫入 `tests/fixtures/sasfit/iucr-copy-v5.2.json`。**只在 `ed9db6f` 的頁面上執行一次**；fixture 內 `note` 欄註明「不得重產」。腳本自我檢查：`default.text` 以 `Parameter\tValue` 開頭、長度在 500–800 字元之間（6000 字元以上代表分頁沒顯示）。
- [ ] **Step 3：** `iucr-table.test.js` 另加一項讀 fixture 的斷言：兩個狀態的 `html` 都恰有 3 個 `<input`、`text` 都不含三個輸入框的預設值（記錄「現況不複製輸入值」這件事，Task 17 會刻意改變它並改寫這一項——這是本檔唯一允許日後修改的測試，檔內註明）。
- [ ] **Step 4：** 全綠、兩支冒煙 ALL PASS。Commit `test: characterise the IUCr table and capture its copy output before the model-fitting block`。

### Task 1: `chart-theme.js` 的 3D 角色與 `shade3d`（可與 Task 0、2、3 平行）

**Files:** Modify `js/chart-theme.js`、`tests/theme.test.js`（只加測試）、`tests/contrast.test.js`（只加測試）。

**配色起點**（已以 WCAG 對比公式算過，k 由 0 到 1 每 0.05 一格的最小值；UI 審查可再調，但調整後下列測試仍須通過）：

| 主題 | `shapeSolid`＝`shapeShell` | `shapeCore` | `shapeAmbient` | 殼對卡片 | 核對卡片 | 核對殼 |
|---|---|---|---|---|---|---|
| 淺色（卡片 #FFFFFF） | #1F5FB0 | #C8791A | 0.35 | 6.32 | 3.38 | 1.56 |
| 深色（卡片 #1E1E21） | #4A8DDF | #F5D28E | 0.60 | 3.24 | 7.19 | 2.22 |

`shapeEdge` 取各主題 `text` 的色碼（#636366／#A1A1A6，對卡片 5.99／6.46）。系列色的藍與琥珀（#2A78D6／#B45309、#4A8DDF／#C08418）**不能直接用**：兩者亮度幾乎相同（核對殼只有 1.05–1.14），而且深色主題在 k＝0 時對卡片只有 2.2:1。深色主題的環境光係數必須比淺色高——乘暗的面在深色卡片上會消失。

- [ ] **Step 1：先寫失敗的測試**
  - `shade3d` 存在於 `ChartTheme`；對 `SHAPE_ROLES` 的每個角色、兩個主題、k ∈ {0, 0.5, 1} 回傳非空字串；同一 (角色, 主題) 下亮度隨 k 單調不減（以回傳字串解析出的相對亮度比較）；k < 0、k > 1、`NaN` 分別等同 0、1、0；k＝1 時等於基底色；未知角色丟 Error；省略 `theme` 時跟 `resolved()`（以 `withThemeAttr('dark', …)`，`theme.test.js:176` 的做法）。
  - 不修改調色盤物件（`Object.isFrozen`）；`PALETTES.light／dark` 各有 `shapeSolid`、`shapeShell`、`shapeCore`、`shapeEdge` 四個字串鍵與數字鍵 `shapeAmbient`（0 < 值 < 1），兩主題鍵相同。
  - `contrast.test.js` 新增（兩個主題、k ∈ {0, 0.5, 1}——**k 是 Lambert 亮度，不是環境光係數；k＝0 是最暗的面，一定要測**）：三個面角色對卡片底色（`surface`）≥ 3:1（WCAG 1.4.11）；`shapeCore` 與 `shapeShell` 在相同 k 下彼此 ≥ 1.5:1，且兩者基底色的色相角（HSL）相差 ≥ 60°（核與殼不能只靠明暗分辨）；`shapeEdge` 對 `surface` ≥ 3:1。門檻達不到時調整色碼或該主題的 `shapeAmbient`，不得調低門檻。
  - 既有的 `colorAssignments` 測試不受影響（新鍵不是 dataset 會標的角色；`tagColor` 只在有人標 `tpsRole` 且值是字串時才讀，`chart-theme.js:102-105`——`shapeAmbient` 是數字，不會被當顏色）。
- [ ] **Step 2：實作**：色碼字面值與 `shapeAmbient` 寫在 `LIGHT`／`DARK`（`chart-theme.js:27-65`）；`shade3d` 以基底色在線性空間乘上 `shapeAmbient + (1 − shapeAmbient)·k` 後輸出 `rgb(…)`。檔頭註解的角色清單補上 3D 一段。
- [ ] **Step 3：** 全綠、冒煙 ALL PASS。Commit `feat: chart theme roles and shade3d for the SAS fitting 3D sketch`。

### Task 2: `sasfit-state.js`：檢視切換、序列狀態、第四個分段（可與 Task 0、1、3 平行）

**Files:** Modify `js/sasfit-state.js`、`js/section-sasfit.js`（只改 `:319` 一處）、`tests/sasfit-state.test.js`、`tests/sasfit-section.test.js`。

- [ ] **Step 1：先寫失敗的測試**（並改寫寫死三個分段的既有斷言：`sasfit-state.test.js:42` 的 `TABS`；`:428-437` 用的是測試自己的三元素陣列，保留並另加四元素的案例）
  - `TABS` 是四個；`nextTab(TABS, 'fit', 'ArrowRight')` → `'sequence'`、`End` → `'sequence'`、`('sequence','ArrowRight')` → `'data'`；`setTab {tab: 'sequence'}` 被接受。
  - `plotView` 預設 `'curve'`；`setPlotView {view}` 只接受 `PLOT_VIEWS`，其餘丟 Error；擬合進行中也允許。
  - `initial().seq` 的形狀如「介面」區塊：`phase: 'idle'`、`options: { chain: true, sort: true }`、`rows` 空、`order`／`form`／`settings`／`y`／`outcome` 為 null。
  - `setSeqSelected`：未知 id 或沒有資料的檔 → Error；`seqSelectedFiles` 把「沒有設定過」的檔視為勾選、明確設為 false 的排除、解析失敗的檔永不包含；`setSeqAll` 對所有有資料的檔寫入；`removeFile` 連同它的 `selected` 與 `rows` 項目一起移除並從 `order` 拿掉，`undoRemove` 放回（`removed` 多帶 `seqSelected`、`seqRow`、`seqOrderAt`；既有的 undo 測試不改仍通過）；`addFiles` 不動既有的勾選。
  - `seqStarted { plan, form, settings }`：`plan.items` 至少一個不 `skip` 的項目，否則 Error；單筆擬合進行中 → Error；`seq.phase` 與 `fit.phase` 同時變 `'running'`，`fit.datasetId`＝第一個要擬合的 id；`rows` **先清空**再依 `plan.items` 建立（被 `skip` 的項目是 `state: 'skipped'`、`note`＝原因，其餘 `'pending'` 並帶 `range`、`note`）；`order`＝`plan.items` 的 id 順序；`warnings`＝`plan.warnings`；`outcome` 清成 null。
  - `seqStep { id, row, next }`：`id` 必須等於 `fit.datasetId`（否則 Error）；`row.result` 非 null 且 `status` 不是 `'stopped'` 時同時寫進 `fitResults[id]`（規格 §7 末：兩種擬合共用同一張映射）；`next` 非 null → `fit` 換成 `{ phase: 'running', datasetId: next, iteration: 0, chi2r: null }`，**不經過 `'idle'`**；`next` 為 null 時仍是 running，等 `seqSettled`。
  - `seqSettled { outcome }`：`fit.phase`、`seq.phase` 回 `'idle'`，`seq.outcome` 與 `fit.outcome`＝`outcome`（`'finished'`／`'stopped'`／`'aborted'`，其餘丟 Error）；仍是 `'running'` 的列改回 `'pending'`；已完成的列與 `fitResults` 保留。沒有序列在跑時丟 Error。
  - **序列進行中允許的 action**＝既有的 `RUNNING_ACTIONS`（`sasfit-state.js:74-75`）去掉 `fitSettled`，加上 `setPlotView`、`setSeqY`、`seqStep`、`seqSettled`；`fitSettled`、`fitStarted`、`seqStarted`、`setSeqSelected`、`setSeqAll`、`setSeqOption`、`setActive`、`removeFile`、`addFiles` 在序列進行中都丟 Error。單筆擬合進行中：`seqStep`、`seqSettled`、`seqStarted` 丟 Error，`setPlotView`、`setSeqY` 允許。`fitProgress` 兩種情況都照常；`setCondition` 仍允許（排程在開始時已定，改條件值只影響表格與趨勢圖的 x）。
  - 每個 action 都不修改傳入的 state；回傳凍結。
- [ ] **Step 2：實作**（檔案約 540 行）。同一個 commit 把 `section-sasfit.js:319` 改成以「頁面實際有的分頁」（`Object.keys(TAB_ELEMENTS)`）呼叫 `nextTab`——此時頁面仍只有三個分頁鈕，方向鍵不會走到不存在的第四個；Task 10 加入第四個後自然一致。`tests/sasfit-section.test.js:215-221` 相應改成以測試自己的 `TABS`（`:26-29`）的 key 順序推算期望值（不要用 `todo`）。`smoke_ui.py` 不必改（頁面行為不變）。
- [ ] **Step 3：** 全綠、兩支冒煙 ALL PASS。Commit `feat: sasfit state for the plot view switch, sequence runs and a fourth segment`。

### Task 3: `sasfit-shape-geom.js`（網格與蠕蟲鏈中心線；可與 Task 0、1、2 平行）

**Files:** Create `js/sasfit-shape-geom.js`、`tests/sasfit-shape-geom.test.js`；Modify `index.html`、`tests/load.js`。

規格 §6。原創程式。參數名稱照 `js/sasfit-meta.js`：`radius`（sphere、cylinder、core_shell_*、vesicle、flexible_cylinder）、`thickness`、`length`、`radius_polar`／`radius_equatorial`、`kuhn_length`（`sasfit-meta.js:34、48-49、69-70、86-87、105-106、125-127、143-145`）。

**各模型的幾何（單位 Å；實作與測試都照這裡）：**

| 模型 | 物件 | 外形尺寸（bounds 的依據） |
|---|---|---|
| sphere | 1 個實心球（`shapeSolid`，全部面 `SOLID`） | 直徑 2R |
| ellipsoid | 1 個旋轉橢球，極軸沿 z | z：2·R_polar；x、y：2·R_equatorial |
| cylinder | 1 個圓柱，軸沿 z，含兩端蓋 | z：L；x、y：2R |
| core_shell_sphere | 核＝完整的球（`shapeCore`，半徑 R，`SOLID`）；殼＝內徑 R、外徑 R＋t 的球殼**切掉方位角 0–90° 的楔形**（`shapeShell`）：內壁面 `CAVITY`、外表面 `OUTER`、兩個切面 `CUT_A`／`CUT_B` | 直徑 2(R＋t) |
| vesicle | 只有殼（同上，內徑 R、外徑 R＋t）；內部是溶劑，不畫 | 直徑 2(R＋t) |
| core_shell_cylinder | 核＝圓柱（半徑 R、長 L）；殼包住側面**與兩端**（sasmodels 的定義：外半徑 R＋t、總長 L＋2t），切掉同一個楔形；切面是「外矩形減內矩形」的框形，拆成三個矩形帶 | z：L＋2t；x、y：2(R＋t) |
| lamellar | 一塊均勻的薄板（`shapeSolid`），厚度 δ 沿 z；橫向邊長＝`LATERAL_FACTOR × δ`，**橫向不按比例**（`notToScale`：「層狀模型的橫向為無限延伸，圖中的寬度只是示意」）。sasmodels 的 `lamellar` 是單一均勻 SLD，不分頭基與尾鏈，所以畫成一塊 | z：δ |
| flexible_cylinder | **不是網格**：`kind: 'tube'`，蠕蟲鏈中心線＋管半徑 R（由 Task 4 轉成粗線） | 中心線的範圍各向外加 R |

- **切面的法線**：楔形 0–90° 切掉後，剩下的材料在 `CUT_A`（y＝0、x > 0 的半平面）的 y < 0 側、在 `CUT_B`（x＝0、y > 0 的半平面）的 x < 0 側，所以兩個切面的外法線分別是 **+y 與 +x**（指向被切掉的空間）。
- **共用角度格點**：核、殼的內壁與殼的外表面用**同一組**方位角與極角（或 z）格點；方位角格數是 4 的倍數並從 0° 起算（頂點落在 0°／90°／180°／270° 的平面上，沒有任何面跨過切面所在的平面），極角格含兩極與赤道。這同時讓 bounds 恰好等於物理尺寸、薄殼的體積誤差與厚度無關、Task 4 的繪製順序成立。球類的格數取到面數最接近而不超過預算的整數（例：實心球 48×32＝1536 面）；殼＋核的總面數 ≤ 8000。切面沿徑向至少分 2 格。
- **蠕蟲鏈**：持續長度 l_p＝b/2；`segments = clamp(round(8·L/b), 16, 200)`、每段長 ds＝L/segments；每一步讓切線先後繞兩個橫向軸各轉一個高斯角（標準差 √(ds/l_p)；兩次連續旋轉使 ⟨t_i·t_{i+1}⟩＝exp(−ds/l_p) 恰好成立），標架以平行輸運更新；高斯亂數由 `prng(seed)` 經 Box–Muller 產生，**對數取 `Math.log(1 − u)`**（u 可能是 0）；**亂數序列與 R 無關**；不做排除體積。完成後平移到質心。
- **決定性的範圍**：同一個引擎裡同輸入逐元素相同；跨瀏覽器只保證「同種子 → 同一串亂數整數 → 座標相差在 1e-9 相對誤差內」（`Math.sin／cos／log` 各引擎不保證逐位元相同）。測試只把 **PRNG 的值**寫死，不寫死任何鏈的座標。
- 為什麼柔性圓柱不做管狀網格：照模型預設值（L＝1000、b＝100、R＝20）每個關節的均方根轉角是 42°、段長 12.5 Å 小於半徑，80 個關節裡有 42 個相鄰截面環會互相穿過，網格會摺疊。粗線（Task 4）在正交投影下就是「球＋圓柱」聯集的精確投影，沒有這個問題。

- [ ] **Step 1：先寫失敗的測試**（每個網格模型用 meta 的預設值與一組「極端比例」：R＝5、L＝2000；t＝0.5、R＝200）：
  - 每個 mesh 的面數 ≤ `MAX_FACES`、場景總面數 ≤ 8000、頂點索引都在範圍內、沒有退化面（面積 > 0）、`vertices` 全為有限值、`part.length` 等於面數。
  - **封閉流形**（每個 mesh）：每一條無向邊恰好被兩個面共用，且兩個面走向相反（法線一致朝外）；以散度定理算出的體積為正，並與解析體積相差 < 2%（球 4πR³/3、橢球、圓柱、球殼的 3/4、核殼圓柱殼的 3/4、薄板）。極端比例那一組同樣要過。
  - **bounds 等於物理尺寸**：上表每一列（flexible_cylinder 除外），容許 1e-9 相對誤差。
  - **切面**：核殼球、囊泡、核殼圓柱的殼，`CUT_A` 的面法線都是 +y、`CUT_B` 的都是 +x（1e-12），各自的面積和等於解析值（半個圓環／框形）在 1% 內；`CAVITY` 面的法線指向對稱軸、`OUTER` 面的法線背向它；核的 mesh 不被切、全部是 `SOLID`。沒有任何面的頂點分別落在 x＝0（或 y＝0）平面的兩側。
  - **格點共用**：核殼球的核與殼內壁的頂點集合（半徑 R 上的那些）在方位角與極角上逐一對應。
  - **蠕蟲鏈**：同一組 (L, b) 呼叫兩次 → `points` 逐元素相同；`build('flexible_cylinder', …)` 只改 R → `centreline` 逐元素相同、`tubeRadius` 不同；改 L 或 b → 中心線不同；相鄰點的距離都是 ds（1e-9）；L ≪ b（L/b＝0.05）時首尾距離 > 0.99L；L/b＝50 時首尾距離 < 0.6L。以 200 個固定種子（1…200）驗證 ⟨R_ee²⟩ 落在 Kratky–Porod 解析值 2l_pL[1 − (l_p/L)(1 − e^{−L/l_p})] 的 ±15% 內，L/b＝1、10、50 三種（審查時以同一規則試算得 1.02、1.05、0.96，平均值的標準誤約 5%）。`segments` 在 L/b＝0.5、10、100 分別是 16、80、200。
  - `prng`：同種子同序列、值域 [0,1)、前 5 個值寫死在測試（防止日後誤改演算法而改變所有人的構形）。
  - 不合法輸入：負的半徑、`NaN`、全 0 → `build` 回 `null`、不丟例外；`thickness` 為 0 的核殼球 → 只有核（殼省略）、bounds 仍正確；5 個與形狀無關的模型與兩個結構因子 → `hasShape` false、`build` 回 `null`。
  - 不修改傳入的 `params`；回傳的物件凍結（TypedArray 除外）。
- [ ] **Step 2：** 實作（函式 < 50 行：每種曲面一個產生器——經緯球面、旋轉面、圓盤、環形扇面、矩形帶）；`<script>` 接在 `sasfit-plots.js` 之後；`LOAD_ORDER` 同步。全綠、冒煙 ALL PASS。Commit `feat: sasfit shape meshes and the fixed-seed worm-like chain`。

### Task 4: `sasfit-shape-view.js`（投影、繪製順序、明暗、比例尺、文字）

**Files:** Create `js/sasfit-shape-view.js`、`tests/sasfit-shape-view.test.js`、`tests/sasfit-shape-order.test.js`、`tests/sasfit-shape-oracle.js`；Modify `index.html`、`tests/load.js`。

**繪製順序的規則（不是「全部的面依質心深度排序」——那對切開的殼不正確）：** 核會遮住切面的一部分（從上方看時切面的下半），切面也會遮住它平面後方的核面，兩者沒有固定的先後；質心排序在薄殼與大切面上會錯。以下規則對這 8 種場景在任何視角都精確：
1. 每個封閉 mesh 先做**背面剔除**（法線·視線 ≤ 0 的面不畫）。單一凸體（球、橢球、圓柱、薄板）剔除後不需要排序。
2. 核殼場景的順序：殼的 `CAVITY` 面 → 「核的面與朝向觀察者的切面」→ 殼的 `OUTER` 面。外表面在凸包上，朝向觀察者的外表面不會被任何東西遮住，所以最後畫；內壁只可能被其他東西遮住，所以最先畫。
3. 中間那一組以切面所在的平面分段。令 v＝`viewDirection(view)`，`CUT_A` 朝前（v_y > 0）、`CUT_B` 朝前（v_x > 0）：
   - 兩者都朝前：核面〔質心 y < 0〕→ `CUT_A` → 核面〔y > 0 且 x < 0〕→ `CUT_B` → 核面〔y > 0 且 x > 0〕；
   - 只有 `CUT_A`：核面〔y < 0〕→ `CUT_A` → 核面〔y > 0〕；只有 `CUT_B`：核面〔x < 0〕→ `CUT_B` → 核面〔x > 0〕；都不朝前：只有核面。
   - 各小組內的面互不重疊（同屬一個凸體或同一個平面），不必再排。囊泡沒有核，中間那一組只有切面。
4. `kind: 'tube'`：每一段中心線一個 `stroke`（兩端點投影、`width = 2·tubeRadius·pixelsPerAngstrom`），依段中點的深度由遠到近；`k`＝切線與光源方向夾角的正弦（圓柱側面的平均亮度）。
5. 明暗：`k = max(0, n·l)`，光源方向固定在**觀察座標**（左上前方），所以旋轉物體時明暗跟著變；切面與曲面用同一個公式。環境光不在這裡加（在 `shade3d`）。

- [ ] **Step 1：先寫失敗的測試——視角、投影、比例尺、文字**（`sasfit-shape-view.test.js`）
  - **視角 reducer**：`rotate` 累加 yaw、把 pitch 夾在 ±89°；`zoom` 乘上係數並夾在 `ZOOM_RANGE`；`key`：`ArrowLeft/Right` ∓/± `KEY_STEP` 的 yaw、`ArrowUp/Down` 改 pitch、`+`／`=` 放大 1.1 倍、`-` 縮小、`0`／`Home` 等同 `reset`；其他鍵回傳**同一個物件**（呼叫端據此決定要不要 `preventDefault`）；不修改傳入的 view。
  - **視角慣例**：`viewDirection(DEFAULT_VIEW)` 的 x、y 分量都 > 0（兩個切面都朝前），且與楔形平分線（方位 45°）在水平面上的夾角 < 45°；物體的 +z 投影到畫面的正上方（畫面 y 變小）；yaw 轉 360° 回到原處；基底矩陣正交（RᵀR＝I，1e-12）、行列式 +1。
  - **投影不變量**：任兩個頂點的螢幕距離 ≤ 3D 距離 × `pixelsPerAngstrom`；與視線垂直的線段恰好等於；`zoom` 加倍則 `pixelsPerAngstrom` 加倍；預設 zoom 下整個外接球落在 `size` 內並留 8% 邊距；**旋轉不改變 `pixelsPerAngstrom`**；極端比例（圓柱 L＝400、R＝20；柔性圓柱 L＝1000、R＝20）仍完整落在畫面內。
  - **亮度**：`k` ∈ [0, 1]；法線正對光源的面 k＝1、垂直或背光的面 k＝0。
  - **粗線**：柔性圓柱的清單全是 `stroke`，數目等於 `segments`，`width` 都等於 `2R·ppa`，由遠到近；同一個 scene 與 view 兩次呼叫結果逐元素相同。
  - **比例尺**：`scaleBar(ppa, width)` 選 1–2–5 級距中「長度不超過寬度 30%」的最大者；`pixels`＝`nm × 10 × ppa`；`label` 例 `'5 nm'`、`'0.5 nm'`、`'200 nm'`；ppa 非有限或 ≤ 0 → `null`。
  - **`nm`**：`50 → '5.0'`、`54.96 → '5.5'`；會顯示成 `'0.0'` 的小尺寸改用兩位有效數字（`0.4 → '0.04'`）；負數與非有限 → `'—'`。
  - **`describe`**（表單以 `SasFitForm.create`＋`reduce` 建立）：sphere → `dims` 只有「半徑 R」；核殼球 →「核半徑」「殼厚」「外徑」；囊泡 →「內半徑」「膜厚」；柔性圓柱 →「輪廓長度 L」「Kuhn 長度 b」「半徑 R」＋extras 含「圖中是一個代表性構形（固定亂數種子，未考慮排除體積）」；lamellar → extras 含 `notToScale` 的句子。多分散開著且寬度 > 0 的尺寸 → extras 有「R = 5.0 ± 0.5 nm（schulz）」（± ＝ 寬度 × 平均值；`lognormal` 的寬度不是 σ/平均，文字改寫「寬度 0.10（lognormal）」）；有 S(Q) → 「S(Q)：hardsphere，φ = 0.20，R_eff = 5.0 nm」（`radius_effective` 由模型決定時寫「R_eff 由模型決定」）；hayter_msa 另列電荷。任何一個尺寸在預設縮放下投影不到 2 px 時（由呼叫端把 ppa 傳入 `describe(form, { pixelsPerAngstrom })`，省略則不判斷）extras 加一句「殼厚 0.05 nm 在這個比例下小於 2 像素」。`alt` 例「核殼球的 3D 示意圖：核半徑 6.0 nm、殼厚 1.0 nm；切開四分之一以顯示內部」；柔性圓柱的 `alt` 含「一個代表性構形」。與形狀無關的模型 → `null`。表單有欄位錯誤 → `shapeParams` 回 `null`。
  - 全部回傳值是純文字且不含 `<`（由呼叫端跳脫）。
- [ ] **Step 2：先寫失敗的測試——繪製順序**（`sasfit-shape-order.test.js`）
  - 剔除：單位球在任何視角剩下約一半的面，清單裡沒有背面。
  - 規則 2、3 的四種情況各一個視角：清單中各組的先後次序逐組斷言（以 `tests/sasfit-shape-oracle.js` 提供的「面 → 所屬的組」對照）。
  - **射線判定**（真正擋住錯誤實作的測試）：`tests/sasfit-shape-oracle.js` 以解析幾何（球、球殼減楔形、圓柱、圓柱殼減楔形、薄板）算出某個視角下某個畫面點**最先被哪個角色擋住**（或沒有東西）。對核殼球、囊泡、核殼圓柱（預設值與薄殼各一），取固定的 200 個視角（yaw 每 30°、pitch −75°…75°，加上 20 個固定種子的亂數視角）× 21×21 的畫面格點：「清單中包含該點的最後一個多邊形的角色」必須等於射線判定的角色；與任何面的邊距離不到一個面寬的點不計；一致率 ≥ 99%，而且**核的中央區域與切面的中央區域必須 100% 一致**。以「全部面依質心深度排序」的實作在薄殼案例必須過不了這個測試（測試檔內附一個這樣的對照實作，斷言它的一致率低於門檻——證明測試有鑑別力）。
- [ ] **Step 3：** 實作；`<script>` 接在 `sasfit-shape-geom.js` 之後。全綠、冒煙 ALL PASS。Commit `feat: sasfit 3D view maths, exact draw order, scale bar and shape descriptions`。

### Task 5: `sasfit-shape3d.js` 的繪製器（`paint`）

**Files:** Create `js/sasfit-shape3d.js`、`tests/sasfit-shape3d.test.js`；Modify `index.html`、`tests/load.js`。

本任務只做 `paint`（`create` 在 Task 6、互動在 Task 7；本任務先匯出 `{ paint }`，Task 6 加 `create`）。頁面上還沒有任何標記用到它。

**畫法：**
- `polygon`：`beginPath`／`moveTo`／`lineTo…`／`closePath`／`fill`，`fillStyle`＝`ChartTheme.shade3d(role, k, theme)`；接著**以同一個顏色** `stroke`（`lineWidth` 0.75）把相鄰多邊形之間的反鋸齒細縫蓋掉。**不以 `shapeEdge` 描每個面的邊**（那會變成一千多個四邊形的線框）。
- `stroke`（柔性圓柱的一段）：兩筆——先以 `palette(theme).shapeEdge`、`lineCap: 'butt'`、寬 `width + 2` 畫一筆（只在段的兩側留下 1 px 的輪廓，段與段的接縫不會出現橫向的環），再以 `shade3d(role, k, theme)`、`lineCap: 'round'`、寬 `width` 畫一筆（圓頭把關節補滿）。
- 比例尺：左下角一條線（`shapeEdge`）＋`fillText(label)`，文字色 `palette(theme).text`、字型 `ChartTheme.FONT`。
- `background: true`（PNG 用）先以 `palette('light').surface` 填滿；一般重畫先 `clearRect`。

- [ ] **Step 1：先寫失敗的測試**（假 ctx 記錄呼叫，仿 `tests/sasfit-plots.test.js`；`ChartTheme` 用真的）：上述每一點；`save`／`restore` 成對；清單為空也不丟錯；`theme: 'light'` 與 `'dark'` 的 `fillStyle` 不同；模組頂層不碰 `document`；檔內沒有任何顏色字面值（由 `no-color-literals` 保證，這裡不重複）。
- [ ] **Step 2：** 實作；`<script>` 接在 `sasfit-shape-view.js` 之後；`LOAD_ORDER` 同步。全綠、冒煙 ALL PASS。Commit `feat: sasfit 3D canvas painter`。

### Task 6: 檢視切換「曲線｜結構」、3D 區的標記與 `create`

**Files:** Create `css/sasfit-views.css`、`tests/sasfit-shape3d-ui.test.js`；Modify `js/sasfit-shape3d.js`、`index.html`（區段 2 的圖卡內、`<link>`）、`js/section-sasfit.js`、`tests/sasfit-section.test.js`。

先讀 `index.html:664-697`（圖卡）、`section-sasfit.js:89-111、145-156、178-194、280-312`、`css/sasfit.css:30-80、520-576`。

- [ ] **Step 1：標記**（全部在區段 2 的圖卡內）
  - 標題那一行（`h2#sfPlotTitle` 旁，**不新增一行**）：`div.tabs.tabs--inline#sfViewTabs[role=group][aria-label="圖區內容"]` › `button.tab.active#sfViewCurve[type=button][aria-pressed=true]`「曲線」、`button.tab#sfViewShape[type=button][aria-pressed=false]`「結構」。
  - 既有的 `.sf-plot-tools` 加 `id="sfCurveTools"`；其後新增 `div.sf-plot-tools#sfShapeTools[hidden]` › `button.btn.btn-secondary.btn-sm#sfShapeReset`「重設視角」、`#sfShapeSpin[aria-pressed=false]`「自動旋轉」、`#sfShapePng[disabled]`「PNG」（Task 15 才綁）。
  - 既有的狀態列、`#sfPlotLive`、主圖容器、操作說明、殘差小標、`#sfResidualEmpty`、`#sfResidualBox` 整段包進 `div#sfCurveView`（元素與 id 都不變）。
  - 其後新增 `div#sfShapeView[hidden]` › `p.stat-sub.sf-shape-status#sfShapeStatus`（`role="status"`；無形狀的模型寫「此模型沒有固定形狀」）、`div.sf-shape-stage#sfShapeStage[tabindex=0][role=group][aria-label="3D 結構示意：方向鍵旋轉，加減鍵縮放，0 重設"][aria-describedby="sfShapeDims sfShapeHelp"]` › `canvas#sfShapeCanvas[role=img][aria-label="尚無示意圖"]`、`p.stat-sub.sf-plot-caption.sf-shape-help#sfShapeHelp`「拖曳旋轉；Ctrl＋滾輪或兩指縮放；按比例繪製（正交投影），不能平移」、`div.sf-shape-text` › `div#sfShapeDims`（尺寸清單，`<dl>` 由 JS 填）＋`p.stat-sub#sfShapeExtras`。
  - 新 id 全加進 `ELEMENT_IDS`（`sfViewTabs`、`sfViewCurve`、`sfViewShape`、`sfCurveTools`、`sfCurveView`、`sfShapeTools`、`sfShapeView`、`sfShapeStatus`、`sfShapeStage`、`sfShapeCanvas`、`sfShapeHelp`、`sfShapeDims`、`sfShapeExtras`、`sfShapeReset`、`sfShapeSpin`、`sfShapePng`）。
- [ ] **Step 2：`sasfit-views.css`**（`<link>` 接在 `sasfit-params.css` 之後，`?v=5.2`）：`.sf-shape-stage` 高度與 `.sf-chart--main` 相同（`clamp(300px, 46vh, 460px)`；`@container sf (max-width: 859px)` 內 `clamp(180px, 30vh, 260px)`）、`touch-action: pan-y`、`cursor: grab`、canvas `display: block; width: 100%; height: 100%`（畫布尺寸不得反過來撐開容器，否則 `ResizeObserver` 會形成重畫迴圈）、focus-visible 外框用既有的焦點樣式 token；`[hidden]` 的檢視不佔空間；`.sf-shape-text` 有高度上限（等於殘差區的高度，超出時在自己裡面捲動，圖卡高度不因文字多寡而變）；單欄且 `data-tab="model"` 時 `.sf-shape-help`、`.sf-shape-text`、`.sf-shape-status` 隱藏（比照 `sasfit.css:75-80`，只留畫布）；多行說明文字 justify、單行的顯式對齊。只用既有 token。
- [ ] **Step 3：先寫失敗的測試**（stub-DOM；`deps.createCanvas`、`deps.raf`、`deps.observeResize`、`deps.matchMedia` 注入）
  - 切換：按 `#sfViewShape` → `dispatch({ type: 'setPlotView', view: 'shape' })`；`render()` 依 `state.plotView` 設定兩個鈕的 `aria-pressed`／`active`、`#sfCurveView`／`#sfShapeView` 與 `#sfCurveTools`／`#sfShapeTools` 的 `hidden`；擬合進行中也能切換；切回「曲線」後呼叫 `ctx.refresh()`（圖表在隱藏期間的更新要補畫）。
  - `plotView === 'curve'`：**不呼叫 `getContext`、不呼叫 `SasFitShapeGeom.build`**（以包裝計數）。
  - `'shape'` 且模型無形狀 → `#sfShapeStatus`「此模型沒有固定形狀」、`#sfShapeStage` 隱藏、尺寸與說明清空、`#sfShapeReset`／`#sfShapeSpin` 停用。
  - `'shape'` 且有形狀 → 建網格一次、`paint` 一次，canvas 的 `aria-label`＝`describe().alt`，`#sfShapeDims` 的 HTML 已跳脫（參數名或單位含 `<` 的假資料），`#sfShapeExtras` 以 `textContent` 寫入。再 `render()` 而形狀參數沒變 → 不重建網格、不重畫；只改 `scale`／`sld` → 不重建；改 `radius` → 重建並重畫。表單有錯 → 保留上一張圖並在 `#sfShapeStatus` 寫「參數表有錯誤，示意圖未更新」。柔性圓柱 → `#sfShapeStatus`「圖中是一個代表性構形」。
  - 畫布尺寸：後備解析度＝CSS 尺寸 × `min(devicePixelRatio, 2)`；`observeResize` 回呼 → 以一個 rAF 重畫一次；尺寸沒變不重畫。
  - 主題：收到 `tps:themechange` → 以新主題重畫一次（不重建網格）；`plotView` 是 `'curve'` 時不畫。`beforeprint` → 以淺色重畫、`afterprint` → 換回。
  - `exportBlob()`：在離屏 canvas（`deps.createCanvas`）以 `theme: 'light'`、`background: true` 重畫同一個視角（含比例尺，寬 1200 px、高依畫布比例）後 `toBlob('image/png')`；`plotView` 不是 `'shape'` 或無形狀 → resolve `null`。畫面上的 canvas 不被動到。
  - `section-sasfit`：`SEGMENT_MODULES` 多一項 `{ key: 'shape', global: 'SasFitShape3d' }`（不是分頁：`PLACEHOLDERS.shape` 是 no-op），既有三個模組的建立順序不變；`resolveDeps`（`:145-156`）補 `raf`、`cancelRaf`、`matchMedia`、`createCanvas`、`observeResize` 的預設值。`tests/sasfit-section.test.js:260` 附近的模組清單斷言相應更新。
- [ ] **Step 4：** 實作。
- [ ] **Step 5：實測並記錄**（真實瀏覽器，1440×900、1280×800、1024×768、760×900、320×640；三個合成檔已載入、有擬合結果與沒有各一次；核殼圓柱＋兩個多分散＋hayter_msa 的最長文字也量一次）：兩種檢視下 `.sf-plots` 的 `scrollHeight === clientHeight`（寬螢幕三種）；標題列不折行（圖卡內寬 420 px）；畫布的實際尺寸；整頁橫向溢出為 0。審查時的基準：曲線檢視圖卡高 754／708／693 px（有結果）、欄高上限 849／749／717 px。任何一項不成立就回報，不要自行改版面。數字寫進完成紀錄。
- [ ] **Step 6：** 全綠、兩支冒煙 ALL PASS（`smoke_ui.py` 不必改：預設檢視是「曲線」，既有元素的 id 不變；axe 仍 0 違規）。Commit `feat: sasfit plot card switch between curves and the 3D structure sketch`。

### Task 7: 3D 的互動（拖曳、鍵盤、縮放、自動旋轉）

**Files:** Modify `js/sasfit-shape3d.js`、`tests/sasfit-shape3d-ui.test.js`。

- [ ] **Step 1：先寫失敗的測試**
  - `pointerdown`＋`pointermove`（dx＝40）→ yaw 改變並重畫；dy → pitch 改變（滑鼠）；`pointerup`／`pointercancel` 結束拖曳；拖曳中 `cursor` 類別切換。
  - `keydown ArrowLeft`（焦點在 `#sfShapeStage`）→ 重畫且 `preventDefault` 被呼叫；`keydown 'a'` → 不呼叫、不重畫（`reduce` 回傳同一個物件）。
  - `wheel` 沒按 Ctrl → **不** `preventDefault`、視角不變；`wheel`＋`ctrlKey` → `preventDefault`、zoom 改變；監聽器以 `{ passive: false }` 註冊（斷言 `addEventListener` 的第三個參數）。兩個 pointer 距離加倍 → zoom 約 ×2。「重設視角」回到 `DEFAULT_VIEW`。
  - 自動旋轉：`deps.matchMedia('(prefers-reduced-motion: reduce)').matches` 為 true → `#sfShapeSpin` 停用且 `title` 與 `#sfShapeHelp` 補一句「系統設定為減少動態效果，已停用自動旋轉」，不排任何 rAF；為 false → 按下後 `aria-pressed="true"`、以注入的 `deps.raf` 排程，每格 yaw 的增量與時間差成正比、上限 30 fps；`plotView` 切回 `'curve'`、`state.fit.phase === 'running'`、`document.hidden`、離開本分頁（`#section-sasfit` 沒有 `active`）時停止排程，條件恢復後續轉；再按一次 → `cancelRaf`。預設關閉。
  - 清理：任何路徑都不留下兩個並存的 rAF 迴圈（計數）；重複 `create` 不重複綁事件（`section-sasfit` 本來就只建立一次，這裡斷言 `create` 綁定的監聽器數目）。
- [ ] **Step 2：** 實作。
- [ ] **Step 3：實測並記錄**：核殼圓柱在「結構」檢視拖曳 60 格的重畫時間中位數；滑鼠在畫布上單純滾輪時頁面照常捲動；鍵盤操作時頁面不捲動。
- [ ] **Step 4：** 全綠、兩支冒煙 ALL PASS。Commit `feat: sasfit 3D sketch drag, keyboard, Ctrl-wheel zoom and auto-rotate`。

### Task 8: `sasfit-sequence.js`（排程、起始值、執行器）

**Files:** Create `js/sasfit-sequence.js`、`tests/sasfit-sequence.test.js`、`tests/sasfit-sequence-run.test.js`、`tests/sasfit-m4-helpers.js`；Modify `index.html`、`tests/load.js`。

規格 §7。`tests/sasfit-m4-helpers.js` 提供：三個小 Dataset（由 `tests/fixtures/sasfit/dat/SYNTH_sphere_{10,20,30}.dat` 以 `SasFitDataIo.parse` 讀入）、`fakeResult({ status, values, errors, chi2r, weighting, … })`（鍵與 `SasFitWorkerCore.buildFitResult` 相同，`sasfit-worker-core.js:331-357`）、`fakeClient(script)`（依腳本 resolve／reject／等待 `stop()`，記錄每次收到的 job）。

**規則（實作與測試都照這裡）：**
- **順序**：`options.sort` 開 → 條件值由小到大，同值依清單順序；條件值為 `null` 的排最後（依清單順序），並產生一則警告「N 個檔沒有條件值，排在最後：…」（檔名最多列 3 個）。關 → 清單順序。
- **每筆的範圍**（工程決定 5；`range` 就是開始時的 `state.range`）：
  - `range.userEdited === false`（使用者沒動過）→ 每個檔用**自己的** `SasFitWeighting.defaultRange(dataset, weighting)`（官方檔含各自的 q_start）；`note` 為 `''`；回 `null` → `skip`。
  - `range.userEdited === true` → 該檔在該權重下可參與的點（`SasFitWeighting.mask(dataset, weighting)` 為 1 者）的最小與最大 q 為 `[a, b]`；實際範圍＝`[max(qMin, a), min(qMax, b)]`；任一端被截 → `note`「擬合範圍截為 q a–b Å⁻¹（要求 qMin–qMax）」。
  - 之後一律以 `SasFitJobs.fitReadiness(form, dataset, { range: 實際範圍, weighting })`（`sasfit-jobs.js:226-240`）判斷：不 `ok` → `skip`＝它的 `reason`（交集為空、點數不多於自由參數數、沒有可用的 σ 都由它回報）。
- **權重**：整個序列用同一種。權重＝資料 σ 而某檔沒有可用的 σ → 該檔 `skip`（`fitReadiness` 的「此資料沒有可用的誤差欄…」）——**不**自動改用別的權重（同一張趨勢圖不能混兩種量度）。官方檔與一般檔可以混用（遮罩規則依各檔的 `kind`，`fitJob` 會把它帶給 Worker）。
- **起始值**（工程決定 6）：`isUsableStart(r)`＝`r.status === 'converged'` 且 `r.blockedByNonFinite !== true` 且（`SasFitHints.measure(r).isChi2` 時）`Number.isFinite(r.chi2r) && r.chi2r <= SasFitHints.CHI2R_WARN`。門檻只引用 `SasFitHints.CHI2R_WARN`（`sasfit-hints.js:80`），不另寫常數。`chain` 開 → 下一筆從「最後一筆 `isUsableStart` 的結果」出發：`SasFitJobs.applyResult(form0, thatResult)`（`sasfit-jobs.js:310-318`；貼邊界的值原樣寫入——貼邊界的收斂結果可以當初值）；還沒有這樣的結果、或 `chain` 關 → `form0`。`maxiter`、`failed`、被 `skip`、出錯、χ²ᵣ 過大的筆都不更新它。上下限與擬合勾選永遠來自 `form0`。寬度被勾選擬合而值為 0 時 `fitJob` 會自動改用 0.05（`sasfit-jobs.js:247-248`），這裡不另處理。
- **每筆的 job**：`SasFitJobs.fitJob(startForm, dataset, { range: item.range, weighting, maxSteps })`。
- **停止**：`fitOne` 回傳 `status: 'stopped'`（`client.stop()` 合成的結果，`sasfit-worker-client.js:155、386-394`）→ 該筆回到 `'pending'`、不存結果，`outcome: 'stopped'`，後面的不再送。
- **錯誤**：`fitOne` reject → 以 `SasFitHints.errorNotice(err, 'fit')` 分流：`where === 'page'`（Worker 無法啟動、wasm 載入失敗、異常結束等，下一筆只會重演）或 `where === 'ignore'`（`BUSY`、`SUPERSEDED`、`STOPPED`：代表狀態已經不一致，`sasfit-hints.js:157`）→ `outcome: 'aborted'` 並帶 `error`；其餘（`'fit'`）→ 該列 `state: 'error'`、`note`＝訊息，繼續下一筆。`fitOne` 同步丟例外視同 reject。
- **`onEvent` 丟例外**（例如狀態的 dispatch 失敗）→ **中止序列**：`outcome: 'aborted'`、`error`＝該例外，不再送下一筆（吞掉它會讓之後每一筆的結果都寫不進狀態而沒有人知道）。`end` 事件本身的 `onEvent` 若再丟例外，攔下並 `console.error`，Promise 仍然 resolve。

- [ ] **Step 1：先寫失敗的測試——`plan`／`isUsableStart`／`startForm`**
  - 條件值 `[30, 10, null, 20]` → 順序 `[1, 3, 0, 2]`＋一則警告；`sort` 關 → 原順序、無警告；全部為 null → 清單順序＋警告；同值穩定。
  - 未編輯的範圍：三個合成檔各自得到自己的 `defaultRange`（把其中一個檔的 q_start 改大，它的 `range.qMin` 跟著變大，其餘不變）、`note` 都是 `''`。
  - 編輯過的範圍：要求 0.001–1 → 每筆的 `range` 等於該檔可參與的首尾 q、`note` 含兩組數字；要求落在資料之內 → `note` 為 `''`、`range` 原樣；要求 5–6（沒有點）→ `skip` 有原因。
  - 沒有 σ 的一般檔＋權重 sigma → `skip`；權重 none → 不 skip；官方檔與一般檔混在一起 → 各自依自己的遮罩。
  - `isUsableStart`：`converged`（χ²ᵣ 1.2，sigma）→ true；χ²ᵣ 10 → true、10.01 → false、NaN → false；權重 none 時 χ²ᵣ 117 → true（不是 χ²ᵣ，不套門檻）；`blockedByNonFinite` → false；`maxiter`、`failed`、`stopped`、`null` → false；貼邊界的 `converged` → true。
  - `startForm(form0, null, true)` 是 `form0` 本身（同一個物件）；給可用的結果 → 被擬合的欄位是結果的值（含 `radius_pd`）、其餘欄位（上下限、勾選、固定參數）與 `form0` 相同；`chain` false → `form0`。
- [ ] **Step 2：先寫失敗的測試——`run`（假 client）**
  - 三筆都收斂、`chain` 開：第 2 筆 job 的 `params.radius`＝第 1 筆結果的 radius（經捨入），第 3 筆＝第 2 筆的；`fitFlags`／`bounds` 三筆相同；每筆 job 的 `range` 是該筆排程的範圍。
  - **初值規則**：腳本「收斂（R＝50.1）、`maxiter`（R＝70）、收斂」→ 第 3 筆的起始 radius 是 50.1；「收斂但 χ²ᵣ＝800（sigma）、收斂」→ 第 2 筆從 `form0` 出發；「`failed`、收斂」→ 第 2 筆從 `form0` 出發。
  - `chain` 關：每筆的 `params` 都等於 `form0` 的。
  - **中途停止**：第 2 筆進行中呼叫 `stop()` → 事件序列以 `{ type: 'end', outcome: 'stopped' }` 結束；第 1 筆的列是 `'done'`、第 2 筆回到 `'pending'`、第 3 筆沒被送出；`fitOne` 只被呼叫 2 次。
  - reject `WASM_LOAD`、`WORKER_CRASH`、`BUSY` → `aborted`、之後不再呼叫 `fitOne`；reject `BAD_PARAMS` → 該列 `'error'`、序列繼續；`fitOne` 同步丟例外 → `aborted`。
  - `onEvent` 在第 2 筆的 `row` 事件丟例外 → `aborted`、`fitOne` 不再被呼叫、Promise resolve 且 `error` 是那個例外。
  - 事件順序：`start`（總數 N、可擬合數）→ 被 `skip` 的項目不發事件（它們在 `seqStarted` 時就已是 `'skipped'` 的列）→ 每筆 `row { row.state: 'running' }` → 若干 `progress` → `row { row.state: 'done' | 'error' | 'pending', next }`（`next`＝下一個要擬合的 id 或 null）→ `end`。`row.startedFrom` 是提供初值的那個檔的 id（或 null），`row.range` 是實際範圍。
  - `run` 回傳的 Promise 在所有路徑都結清、從不 reject；不修改 `plan`、`form`。
- [ ] **Step 3：** 實作；`<script>` 接在 `sasfit-shape3d.js` 之後。全綠、冒煙 ALL PASS。Commit `feat: sasfit sequence scheduling, start-value rule and runner`。

### Task 9: `sasfit-seq-view.js`（序列表與趨勢圖的資料）與 `SasFitPlots.renderTrend`

**Files:** Create `js/sasfit-seq-view.js`、`tests/sasfit-seq-view.test.js`；Modify `js/sasfit-plots.js`、`tests/sasfit-plots.test.js`、`index.html`、`tests/load.js`。

**一張表**（工程決定 9）：列＝**每一個有資料的檔**（上一次執行過的依 `seq.order`，其餘依清單順序接在後面）。欄＝勾選｜檔名（附「載入」鈕）｜條件值｜各擬合參數 值 ± 誤差｜量度｜狀態與註記。還沒跑過的檔數值格是「—」、狀態「未擬合」。

- [ ] **Step 1：先寫失敗的測試——表格**
  - `columns`：名稱＝`seq.rows` 中第一筆有結果的列的 `fitResult.names`（擬合器順序，含 `radius_pd`）；還沒有任何結果 → `names` 是空陣列（表格只有固定欄）。量度經 `SasFitHints.measure(權重)`，權重取 `seq.settings.weighting`，還沒跑過（`seq.settings` 為 null）時取 `state.weighting`：sigma →「約化 χ²」、none →「加權殘差均方」；`scaled`＝權重不是 sigma。
  - `tableRows`：每格的 `value`／`error` 來自 `SasFitFormat.valueError(值, 顯示的誤差)`（顯示的誤差＝`SasFitWorkerCore.displayErrors`，權重非 sigma 時是乘過的）；貼邊界 → `mark: '貼上限'|'貼下限'`（`SasFitHints.AT_BOUND_SHORT`）、誤差欄不顯示數字；狀態＝`SasFitHints.statusLabel(result).text`；`skipped`／`error`／`pending`／沒有列的檔數值格是「—」、狀態寫原因或「未擬合」；`note` 帶範圍被截的說明與初值來源（「初值來自 <檔名>」）。`stale`：該檔有序列列、而 `state.fitResults[id] !== row.result`（之後被單筆擬合取代）→ 標「已單獨重新擬合」，數字顯示**目前** `fitResults[id]` 的；目前結果的 `modelSpec` 與 `seq.form` 的不同 → 數值格「—」。`selected` 來自 `seqSelectedFiles`；`canLoad`＝該檔目前有 `fitResults[id]` 且其 `modelSpec` 與 `seq.form` 相同。`seq.order` 裡已經不在 `files` 的 id 直接略過（檔被移除）。
  - `headHtml`：表頭 `scope="col"`；條件欄標題＝條件名稱（留空 →「條件值」）；誤差在權重非 sigma 時註明「已乘 √均方」；量度欄標題不寫死（`columns.measure` 的 HTML 寫法，重用 `SasFitHtml.measureHtml`）。
  - `bodyHtml`：檔名 `<img src=x onerror=1>.dat`、條件名稱 `"><script>`、`note` 含 `<b>` → 輸出中沒有未跳脫的 `<img`、`<script`、`<b>`；每列是 `<tr data-id>`；勾選是 `<input type="checkbox" id="sfSeqPick_<id>" data-action="pick" data-id aria-label="將 <檔名> 納入序列擬合">`；載入鈕是 `<button type="button" id="sfSeqLoad_<id>" data-action="load" data-id aria-label="載入 <檔名> 的擬合參數">`（**兩者都要有 id**：`ctx.setHtml` 只對有 id 的元素還原焦點，`section-sasfit.js:238-242`；列可用鍵盤操作，不靠整列 click）；`canLoad` false 或 `locked` → 載入鈕 `disabled`；`locked` → 勾選 `disabled`；長檔名經 `SasFitHtml.middleEllipsis`、`title` 是完整檔名；500 列的輸出在 200 ms 內產生（寬鬆的上限，防止二次方的寫法）。
- [ ] **Step 2：先寫失敗的測試——趨勢**
  - `yOptions`：被擬合的名稱＋`{ value: MEASURE_KEY, label: 量度名稱 }`；沒有結果 → 空陣列。
  - `trend(state, 'radius')`：三筆收斂（50、52、54；條件 10、20、30）→ 三點、x 遞增、y 遞增、`yMin`／`yMax`＝值 ∓ 顯示的誤差、`style: 'circle'`；貼邊界的點 `yMin`／`yMax` 為 null；`maxiter` 的點 `style: 'triangle'`（**形狀不同，不靠填色**——`tpsHollow` 是整個 dataset 的屬性，`chart-theme.js:130-135`，沒辦法逐點空心）；`failed`、`skipped`、沒有條件值的不畫並計入 `omitted`；`xTitle`＝條件名稱（留空 →「條件值」）；全部條件值為 null → `byOrder: true`、x＝序號、`xTitle`「序號」。`trend(state, MEASURE_KEY)` 的 y 是 `chi2r`、`yTitle` 是量度名稱、沒有誤差棒。y 不是有限值的點不畫。`label` 例「radius 對 Temperature (K) 的趨勢，3 點，由 50.1 到 54.0」；沒有點 → 「尚無可畫的結果」。
  - `trendConfig`：`type: 'scatter'`、`showLine: true`、一個 dataset 標 `tpsSeries: 0` 與 `sfErrorBars: true`、`pointStyle` 是逐點的陣列、**沒有任何顏色鍵、沒有 `plugins` 陣列**（外掛由 `renderTrend` 加）；軸標題是純文字（Chart.js 畫在 canvas 上，不經 `innerHTML`）；縮放關閉。
- [ ] **Step 3：先寫失敗的測試——`SasFitPlots.renderTrend`**（`tests/sasfit-plots.test.js`，沿用該檔的假 Chart）：第一次呼叫以 `createChart`（`sasfit-plots.js:146-149`，即 `new global.Chart(canvas, global.ChartTheme.colorize(config))`）在 `#sfSeqTrend` 建立，config 的 `plugins` 含 `ERROR_BARS`；之後的呼叫把新的 datasets 與軸標題寫進既有實例並以 `ChartTheme.applyTo` 更新（M3 共用規則 5）；`renderTrend(null)` 銷毀；`getChart('sfSeqTrend')` 回傳實例或 null；`destroy()` 連它一起銷毀；沒有 `Chart` 或沒有 canvas → 回 null、不丟例外；主圖與殘差圖的既有測試不改仍通過。
- [ ] **Step 4：** 實作；`<script>` 接在 `sasfit-sequence.js` 之後。全綠、冒煙 ALL PASS。Commit `feat: sasfit sequence table and trend data, trend chart instance`。

### Task 10: 第四個分段「序列」：標記、註冊、選檔與空狀態

**Files:** Create `js/sasfit-seq-ui.js`、`tests/sasfit-seq-ui.test.js`；Modify `index.html`、`css/sasfit-views.css`、`js/section-sasfit.js`、`tests/sasfit-section.test.js`、`tools/sasfit/smoke_ui.py`。

**每一個假設「三個分段」的地方（逐一處理）：** `index.html:483-486` 的 tablist（加 `button.tab#sfTabSeq[role=tab][data-tab=sequence][aria-controls=sfPanelSeq][aria-selected=false][tabindex=-1]`「序列」）與面板（`div.card#sfPanelSeq[role=tabpanel][aria-labelledby=sfTabSeq][hidden]`，放在 `sfPanelFit` 之後）；`index.html:471、489` 的註解文字；`section-sasfit.js:82-86` `TAB_ELEMENTS`、`:89-93` `SEGMENT_MODULES`（加 `{ key: 'sequence', global: 'SasFitSeqUi' }`）、`:94-111` `ELEMENT_IDS`、`:178-190` `PLACEHOLDERS`；`tests/sasfit-section.test.js:26-29、260`；`smoke_ui.py:174`（`tab()`）、`:490-491`（`End` → `sfTabSeq`、方向鍵多一站）、`:497-504`（`wanted` 加 `sequence`）；`css/sasfit.css:57-80` 只針對 `data-tab="model"`，不受影響；四個分頁鈕在 320 px 寬要量一次是否折行（`.tabs`，`css/components.css:325`）；`sasfit-fit-ui.js:397` 的 `FIT_TAB` 判斷不變。

**面板內容（由上到下）：** `p#sfSeqLock`（序列或單筆擬合進行中的說明，文字用 `SasFitHints.LOCKED_TEXT`）；`.form-list`：`input#sfSeqChain[type=checkbox][checked]`「以前一筆結果作為下一筆初值」、`input#sfSeqSort[type=checkbox][checked]`「依條件值排序」（各有 `<label for>`）；`p.stat-sub#sfSeqSettings`（一行摘要：模型、q 範圍〔未編輯時寫「各檔的預設範圍」〕、權重、擬合哪些參數、最大步數——都來自模型與擬合分段，這裡只讀）；`#sfSeqHints`（`aria-live="polite"`：排程警告與結束後的說明）；按鈕 `#sfSeqRun`「執行序列擬合」（`aria-describedby="sfSeqSettings"`）；`p.stat-sub#sfSeqProgress`、`.sr-only#sfSeqLive[role=status]`；趨勢圖區 `div#sfSeqTrendBox[hidden]` › `label[for=sfSeqY]`＋`select#sfSeqY`、`.chart-container.sf-chart--trend` › `canvas#sfSeqTrend[role=img][aria-label="尚無可畫的結果"]`、`p.stat-sub#sfSeqTrendNote`、`button#sfSeqTrendPng[disabled]`「PNG」；選檔與結果表：`button#sfSeqAll`「全選」、`button#sfSeqNone`「全不選」、`p.stat-sub#sfSeqEmpty`、`.table-wrapper#sfSeqWrapper[tabindex=0][role=region][aria-label="序列擬合的資料與結果"]` › `table.table.sf-seq-table` › `thead#sfSeqHead`＋`tbody#sfSeqBody`；`button#sfSeqCsv[disabled]`「匯出序列結果 CSV」。停止鈕不另放：擬合列的「停止」在四個分段都看得到。新 id 全進 `ELEMENT_IDS`。

- [ ] **Step 1：先寫失敗的 stub-DOM 測試**
  - 分段：第四個分頁鈕可點、方向鍵循環四個、`End` 到「序列」；`init` 缺 `sfPanelSeq` → 列出缺的 id、不丟例外；`ctx.sequence.running()` 在沒有序列時是 false、`barText()` 是 `''`。
  - 表格：`render()` 以 `SasFitSeqView.headHtml／bodyHtml` 經 `ctx.setHtml` 寫入；沒有資料 → `#sfSeqEmpty`「請先載入資料」、表格隱藏、執行鈕停用；有資料但還沒跑 → 每個有資料的檔一列、都勾選、數值「—」。
  - 勾選：`change` 事件（委派在 `#sfSeqBody`，`data-action="pick"`）→ `setSeqSelected`；`#sfSeqAll`／`#sfSeqNone` → `setSeqAll`；「全不選」→ 執行鈕停用並在 `#sfSeqSettings` 寫原因；勾選後焦點留在同一個 checkbox（靠 id）。
  - 選項：`#sfSeqChain`／`#sfSeqSort` → `setSeqOption`；狀態改變後 checkbox 的 `checked` 跟著狀態。
  - 可否執行：表單無效 → 停用並寫 `fitReadiness` 的原因；所有勾選的檔都會被跳過（以 `SasFitSequence.plan` 試排）→ 停用並寫「勾選的資料都無法擬合：<第一個原因>」；只有一個檔 → 可執行（序列長度 1 合法）；單筆擬合進行中 → 停用、`#sfSeqLock` 顯示。
  - 本任務的執行鈕**還不會真的執行**（Task 11）：標記裡帶 `disabled`，`render()` 在本任務只負責上述可否執行的說明文字，按鈕保持停用；Task 11 才解除。
  - 模組頂層不碰 `document`。
- [ ] **Step 2：** 實作；`smoke_ui.py` 的 `tab()`、`check_keyboard` 改四段。
- [ ] **Step 3：** 全綠、兩支冒煙 ALL PASS（含 axe：新的分頁鈕與隱藏的面板；`smoke_ui.py` 另確認 320 px 寬時四個分頁鈕不造成橫向溢出）。Commit `feat: sasfit sequence segment with file selection in one table`。

### Task 11: 序列的執行、停止、鎖定與擬合列

**Files:** Create `tests/sasfit-seq-ui-run.test.js`；Modify `js/sasfit-seq-ui.js`、`js/sasfit-fit-ui.js`、`js/section-sasfit.js`、`tests/sasfit-fit-ui.test.js`、`tests/sasfit-section.test.js`。

**擬合列在序列期間的行為：** 「開始擬合」停用（`fit.phase` 是 running）；「停止」可按，就是 `ctx.client.stop()`（`sasfit-fit-ui.js:448-457` 原樣可用）——進行中的那一筆以 `'stopped'` resolve，執行器據此結束整個序列。進度行寫「序列擬合 第 k／N 筆：<檔名>；第 j 步，<量度>＝…」（seq-ui 經 `ctx.fit.setBarProgress(ctx.sequence.barText())` 寫入）；量度那一行（`#sfFitMeasure`）在序列期間留白。

**執行流程（seq-ui）：**
1. 按 `#sfSeqRun`：再檢查一次可否執行 → `ctx.preview.cancel()` → `plan = SasFitSequence.plan({ files, selected, options, range: state.range, weighting: state.weighting, form })` → `dispatch({ type: 'seqStarted', plan, form, settings: { weighting, maxSteps, rangeEdited } })`（這一次不 silent：整頁進入鎖定狀態）→ 焦點移到 `#sfFitStop`。
2. `SasFitSequence.run({ …, fitOne: (job, onProgress) => ctx.client.fit(job, { onProgress }), onEvent })`；取 `ctx.client` 包在 `try` 裡（getter 可能丟例外，`sasfit-fit-ui.js:438-442` 的寫法）。
3. `onEvent`：`row`（`state: 'running'`）→ 只更新進度文字；`row`（其他）→ `dispatch({ type: 'seqStep', id, row, next }, { silent: true })`；`progress` → `dispatch({ type: 'fitProgress', … }, { silent: true })`＋進度文字。之後排一個**節流的 `ctx.refresh()`**（250 ms；`deps.timers`）。dispatch 丟例外就讓它丟出去——執行器會中止序列（Task 8）。
4. **結清在每一條路徑上**：`run(...)` 的 `.then(finish, finish)` 再接 `.catch`（比照 `sasfit-fit-ui.js:443-447`）。`finish`：取消節流計時器 → 若 `state.seq.phase` 仍是 running 就 `dispatch({ type: 'seqSettled', outcome })`（它本身失敗時 `console.error`，再以 `'aborted'` 試一次）→ 結束後的處理（第 5 點）→ `ctx.fit.setBarProgress('')`（已停止寫「序列已停止，完成 k／N 筆」、中止寫「序列中止」）→ `ctx.refresh()` → 朗讀結束訊息 → 焦點回到 `#sfSeqRun`（在序列分段時）或 `#sfFitStart`。`aborted` 時 `#sfAlert` 顯示頁面層級訊息（`SasFitHints.errorNotice(error, 'fit').text`，`where === 'ignore'` 或沒有訊息時用一般文字）、`detail` 進 `console.warn`。
5. **結束後的表單**（工程決定 8；`finished` 與 `stopped` 都適用）：擬合對象（`state.activeId`）在這次序列有 `'done'` 的列 → `ctx.setForm(SasFitJobs.applyResult(ctx.getForm(), 該結果))`、`ctx.fit.forgetRevert()`，`#sfSeqHints` 寫「已把 <檔名> 的序列結果載入參數表；其他資料可由下表逐列載入」——頁面因此不會對一個使用者沒動過的表單顯示「參數已改動」。`applyResult` 丟例外 → 不動表單、`console.warn`。擬合對象不在這次序列（沒勾選、被跳過、未完成）→ 不動表單，`#sfSeqHints` 寫「序列結果可由下表逐列載入」。序列期間表單是鎖住的，所以此時 `ctx.getForm()` 就是開始時的表單。

- [ ] **Step 1：先寫失敗的 stub-DOM 測試**（`deps.createClient` 注入 `fakeClient`；假計時器）
  - 執行三個合成檔：`fitOne` 依排程順序被呼叫 3 次；執行前呼叫了 `ctx.preview.cancel()`；期間 `state.fit.phase` 與 `state.seq.phase` 都是 running、資料／模型／擬合分段的鎖定提示出現（`sfDataLock`、`sfModelLock`）、`#sfSeqLock` 顯示、勾選與選項停用；結束後 `state.fitResults` 有 3 筆、兩個 phase 都是 idle；焦點回到執行鈕；朗讀區有結束訊息。
  - **不逐次整頁重繪**：以包裝計數 `ctx.refresh`——三筆、每筆 5 個進度事件的序列，在假計時器不前進的情況下，執行期間的 `refresh` 次數 ≤ 2（開始一次＋結束一次）；每 250 ms 前進一次則各多一次。`#sfFitProgress` 仍然每個事件都更新（「第 1／3 筆」「第 2／3 筆」依序出現）。
  - 擬合列：序列進行中 `#sfFitProgress` 是 `ctx.sequence.barText()`、`#sfFitMeasure` 留白、「開始擬合」停用、「停止」可按；結束後進度行清空。
  - 停止：第 2 筆時按擬合列的「停止」→ `client.stop` 被呼叫一次、`seq.outcome === 'stopped'`、第 1 筆的結果保留、第 2 筆是 `'pending'`、頁面解鎖（可改參數）；**沒有「續跑」**：再按執行會從頭重跑（`rows` 清空）。
  - **解鎖的每一條路徑**：`WASM_LOAD`（`aborted`、`sfAlert` 有訊息、`detail` 進 `console.warn`）；`ctx.client` 的 getter 丟例外；`SasFitSequence.run` 被替換成 reject 的假函式；`seqStep` 的 dispatch 丟例外（把 `id` 弄錯的假事件）；擬合列的 `stop()` 丟例外——五種情況結束後 `state.fit.phase === 'idle'` 且 `state.seq.phase === 'idle'`，並有可見的訊息。
  - 結束後的表單：擬合對象在序列中 → 表單的 radius 是它的結果、`SasFitJobs.resultMatchesForm` 為 true、擬合列沒有「參數已改動」、`forgetRevert` 被呼叫、還原鈕停用；擬合對象沒勾選 → 表單不變、`#sfSeqHints` 有說明。
  - `fit-ui`：`forgetRevert()` 之後還原鈕停用、說明留白；`setBarProgress(text)` 寫入 `#sfFitProgress` 並在之後換擬合對象時照既有規則清掉（`sasfit-fit-ui.js:325-328`）；單筆擬合的既有測試不改仍通過。
  - `section-sasfit`：`buildContext`（`:280-295`）加 `sequence` 與 `fit` 兩個轉接物件（做法同 `preview`；模組不存在時是 no-op）。
- [ ] **Step 2：** 實作（解除 Task 10 留下的執行鈕停用）。
- [ ] **Step 3：** 全綠、兩支冒煙 ALL PASS。手動：三個合成檔跑一次序列、停止一次。Commit `feat: sasfit sequence run, stop and page lock`。

### Task 12: 序列的結果列、趨勢圖與點列載入

**Files:** Modify `js/sasfit-seq-ui.js`、`css/sasfit-views.css`、`tests/sasfit-seq-ui.test.js`、`tests/sasfit-seq-ui-run.test.js`。

**點列載入（`data-action="load"`）：** (1) `dispatch({ type: 'setActive', id })`；(2) 取該檔目前的 `fitResults[id]`；(3) 以 `seq.form`（序列開始時的表單快照）為底 `SasFitJobs.applyResult(seq.form, result)` 後 `ctx.setForm`——用快照而不是目前的表單，是因為 `applyResult` 在模型規格不同時會丟 Error（`sasfit-jobs.js:313-316`），而使用者之後可能換過模型；按鈕在 `canLoad` 為 false 時本來就停用（Task 9），這裡再防一次：不相符 → 不載入，在 `#sfSeqHints` 說明；(4) `ctx.fit.forgetRevert()`——「還原擬合前的參數」屬於某一次單筆擬合（`sasfit-fit-ui.js:264-270、459-467`），表單被整個換掉後它已經沒有意義；(5) `ctx.refresh()`、`ctx.preview.schedule()`；(6) 朗讀「已載入 <檔名> 的擬合參數（模型與上下限回到序列開始時的設定）」，焦點留在該列的按鈕（靠 `sfSeqLoad_<id>`）。序列或單筆擬合進行中 → 按鈕停用。

- [ ] **Step 1：先寫失敗的 stub-DOM 測試**
  - 序列完成後表格 3 列有數字與狀態；進行中表格每個節流週期最多重建一次、結束時一定重建；重建後焦點仍在原本的勾選或載入鈕上。
  - 趨勢圖：有可畫的點 → `#sfSeqTrendBox` 顯示、`deps.plots.renderTrend` 收到 `SasFitSeqView.trendConfig(...)`、canvas 的 `aria-label`＝`trend.label`；`#sfSeqY` 的選項＝`yOptions`（文字經跳脫），`state.seq.y` 為 null 時取第一個；換 y → `setSeqY`＋重畫；`omitted > 0` → `#sfSeqTrendNote`「N 筆沒有畫出（未收斂、被跳過或沒有條件值）」；`byOrder` → 說明「沒有條件值，橫軸改用序號」；沒有任何可畫的點 → 區塊隱藏、`renderTrend(null)`。分段不在畫面上時仍照常更新（Chart.js 在容器顯示後自行調整尺寸）。
  - 點列載入：上述 (1)–(6) 逐項斷言；載入後 `resultMatchesForm` true、擬合分段顯示的就是這一筆、切到「結構」時 3D 用的是這組尺寸；結果的模型與快照不同 → 表單不變、有說明。
  - `stale`：序列後對其中一檔做單筆擬合 → 該列標「已單獨重新擬合」並顯示新數字。
  - 移除一個檔 → 它的列消失；復原 → 回來（連同結果）。
  - 單筆擬合進行中：載入鈕與勾選都停用。
- [ ] **Step 2：** 實作。`sasfit-seq-ui.js` 只做取元素、綁事件與呼叫純函式（純邏輯都在 `sasfit-sequence.js` 與 `sasfit-seq-view.js`）；若接近 700 行，先回報再決定是否拆檔，不要自行新增 `<script>`。
- [ ] **Step 3：** 全綠、兩支冒煙 ALL PASS（axe：序列分段在空狀態下 0 違規）。手動：三個合成檔跑序列、點列、換 y。Commit `feat: sasfit sequence results, trend chart and loading a row`。

### Task 13: `sasfit-export.js`（共用工具與擬合曲線 CSV）

**Files:** Create `js/sasfit-export.js`、`tests/sasfit-export.test.js`；Modify `index.html`、`tests/load.js`。

規格 §9。站內先例：`csvCell`／`rowsToCsv`（`js/liposome-results-table.js:34-39、53-55`）、`downloadCsv` 加 BOM（`js/dndc-export.js:34-38`）。

**決定（理由寫在檔頭）：**
- **數值精度**：匯出是給再分析用的，CSV 的數字一律 `num(x)`＝`String(x)`（ECMAScript 的最短可讀回表示，與語系無關、小數點一定是 `.`）；非有限值為空字串；`-0` 寫成 `'0'`（`String(-0)` 的結果，符號不保留，測試照此）。
- **公式注入**：`cell()` 對**文字型**的值，開頭是 `=`、`+`、`-`、`@`、TAB、CR 時前置一個 `'`（OWASP 的做法），再做 RFC 4180 引號；**數字型**（`typeof === 'number'`）不處理，所以負數仍是數字。文字型的來源只有檔名、條件名稱、註記、狀態。
- **`#` 註解列**：`commentLine(key, value)`＝`'# ' + key + ': ' + value`，**不加 CSV 引號**（加了就不是以 `#` 開頭）；值裡來自使用者的字串（檔名、輸出檔名、條件名稱）先把 `,` `;` `"`、TAB、CR、LF 與其他控制字元換成 `_`——否則 Excel 會在逗號處切格，第二格若以 `=` 開頭就成了公式。
- **BOM 與讀檔方式**：沿用規格（下載時加 BOM）。**檔內第 1 行固定是說明文字，第 2 行寫明讀法**：`# UTF-8 with BOM; comment lines start with "# "; read with pandas.read_csv(f, comment="#") or numpy.genfromtxt(f, delimiter=",", comments="#", encoding="utf-8-sig") (first row = column names -> nan)`。審查時實測：`numpy.genfromtxt(..., encoding='utf-8-sig')` 讀得到（表頭那一列成為 NaN）；`numpy.loadtxt` 讀不了（表頭列與空儲存格都會失敗，與編碼無關）；`genfromtxt(names=True)` 會把第一行註解當欄名，不要建議它。pandas 的寫法未實測（環境沒有 pandas），Task 15 手動驗證時若可得就試一次並記錄。
- **換行**：CSV 用 `\n`（站內慣例）；TXT 用 `\r\n`（Windows 記事本）並同樣加 BOM。
- **檔名** `safeName`：NFC 正規化；去掉路徑（取最後一個 `/` 或 `\` 之後）；去掉最後一個副檔名；`\ / : * ? " < > |`、控制字元（U+0000–001F、007F）、雙向控制字元（U+202A–202E、2066–2069）換成 `_`；頭尾的空白與 `.` 去掉；Windows 保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1–9`、`LPT1–9`，不分大小寫）前置 `_`；**以 UTF-8 位元組計**超過 120 就在碼位邊界截斷（不切開代理對），截斷後**再去一次**尾端的空白與 `.`；結果為空 → `fallback`。`fileName('fit' | 'report' | 'sequence' | 'png-main' | 'png-residual' | 'png-shape' | 'png-trend', …)` 依規格 §9 組成 `<資料名>_<模型>_fit.csv`、`…_report.txt`、`<條件名>_sequence.csv`、`<資料名>_<模型>_{main,residual,shape}.png`、`<條件名>_trend.png`；模型段＝`modelText(modelSpec)`（`core_shell_sphere@hardsphere`、加上低 q 冪律時 `+power_law`；`@` 與 `+` 保留——實測可下載）。
- **`paramRows(fitResult, bounds)`**（報告與 IUCr 共用）：**列的順序、單位與多分散設定一律由 `fitResult` 本身決定**——以 `fitResult.settings.modelSpec` 經 `SasFitForm`（`create` 加上設定 S(Q) 與低 q 冪律的 reducer action，名稱以 `sasfit-form.js` 為準）重建一份表單骨架取得列順序與單位，數值、多分散的分布／寬度／取點數／範圍、兩個模式參數都取自 `fitResult.params`（`sasfit-jobs.js:113-135` 送出的就是這些鍵）。`fitted`＝是否在 `fitResult.names`；`errorShown`＝`SasFitWorkerCore.displayErrors` 的那一個（固定參數三個誤差都是 null）。`bounds` 是 `{ name: [lower, upper] }` 或 `null`：**上下限不在 FitResult 裡**，由呼叫端在「目前表單的模型規格與結果相同」時從表單取出傳入，否則傳 `null`（下限、上限欄寫空）。不含 `_pd_n`、`_pd_nsigma`、`_pd_type` 與兩個模式參數的列（它們是設定，不是參數）；由模型決定的 `radius_effective` 不列。
- **`inFit(dataset, fitResult)`**：`SasFitWeighting.select(dataset, settings.weighting, settings.range).index` 標成 1——與 Worker 用的是同一個函式。**不由 `residuals` 是否有限推斷**：失敗或被非有限值擋住的擬合，參與的點也可能有 NaN 殘差。

**擬合曲線 CSV 的版面：** 註解列（第 1 行說明、第 2 行讀法、軟體、資料檔、模型、S(Q) 與模式、權重、q 範圍、點數與自由度、χ²、量度〔照名稱規則，鍵是 `chi2r` 或 `weighted_mean_square_residual`〕、狀態、每個參數一行 `# param radius = 50.01 +/- 0.12 Ang (fitted)`／`(fixed)`／`(fitted, at upper bound)`，數值用 `num`）→ 表頭 `q,I,sigma,I_model,residual,in_fit` → 資料列（**全部**資料點；`sigma` 沒有則空；殘差非有限則空；`in_fit` 是 0／1）。q 單位 Å⁻¹、I 單位在註解列說明（官方檔 cm⁻¹）。

- [ ] **Step 1：先寫失敗的測試**（固定的小 fixture：5 個資料點、sphere、擬合 `scale`／`radius`、`radius` 貼上限的變體、權重 sigma 與 none 各一）
  - **黃金字串**：`fitCsv` 對一個寫在測試檔裡的完整期望字串（逐字比對；測試檔註明「改輸出格式必須同時改這裡，並在 commit 訊息說明」）。
  - **來回一致**：測試內一個小 RFC 4180 解析器把 `fitCsv` 讀回 → q、I、sigma、I_model 與原陣列 `Object.is` 逐元素相同（含 `1e-300`、`5e-324`、`0.1+0.2`、`1e21`）；`-0` 讀回是 `0`（斷言 `=== 0`，不用 `Object.is`）；殘差的 NaN ↔ 空字串。`SasFitDataIo.parse` 讀匯出檔時不丟例外（它只收 2–4 欄，6 欄會得到一則問題訊息——斷言是訊息而不是例外）。
  - **`in_fit`**：等於 `select().index`；另一個案例把**範圍內**某一點的殘差設成 NaN（模擬失敗的擬合）→ 該點 `in_fit` 仍是 1、殘差欄是空的。
  - `cell`：`'a,b'` → `"a,b"`；`'he said "x"'` → 引號加倍；含 `\n` → 加引號；`'=1+1'`、`'+1'`、`'-1'`、`'@x'`、`'\t=1'` → 前置 `'`；數字 `-1`、`-1e-5` → 原樣；`null`／`undefined`／`NaN` → 空。
  - 註解列：檔名 `a,=HYPERLINK("x").dat` → 該行沒有逗號與引號、仍以 `# ` 開頭；每一行註解都符合 `/^# /`。
  - `safeName`：`'../../etc/passwd'` → `passwd`；`'C:\\data\\a.dat'` → `a`；`'con.dat'` → `_con`；`'  .hidden. '`、`'a\u202Egpj.dat'`、`'a\u0000b'`、300 個 ASCII 字元、100 個中文字（截斷後 ≤ 120 位元組且不以半個字結尾）、截斷處剛好是 `.` 的字串、含表情符號（代理對）的字串、空字串、只有點 → 各自的期望值；中文檔名保留；結果永不含路徑分隔符。`fileName` 的每一種 `kind`。
  - 量度名稱：sigma → 註解鍵 `chi2r`；none → `weighted_mean_square_residual`，且**不出現** `chi2r` 字樣。
  - `paramRows`：sphere（擬合 scale、radius）→ 5 列、`fitted` 正確；core_shell_sphere@hardsphere＋`radius_pd` 擬合 → 有 `radius_pd` 一列、`pd` 設定取自 `params`；`bounds` 為 null → `lower`／`upper` 是 null；**不需要傳入表單**（函式簽名沒有它）。
  - `'stopped'` 的結果（沒有曲線）→ `fitCsv` 丟 Error（呼叫端不提供按鈕）；`maxiter`、`failed` 照樣產生。
  - `dataUrlBytes`：合法的小 PNG data URL → 位元組的前 8 個是 PNG 簽名；不是 `data:image/png;base64,` 開頭、base64 壞掉 → Error。
  - `software('9.9')` 的字串含 `v9.9` 與 `SasFitMeta.sasmodelsVersion`；`software(undefined)`、`software(null)`、`software('')` → Error（`SasFitWorkerClient.scriptVersion` 在沒有 `?v=` 時是 **null**；不得默默輸出 `vnull`）。
  - 不修改傳入的物件。
- [ ] **Step 2：** 實作；`<script>` 接在 `sasfit-seq-view.js` 之後。全綠、冒煙 ALL PASS。Commit `feat: sasfit export helpers and the fit-curve CSV`。

### Task 14: `sasfit-report.js`（報告 TXT 與序列結果 CSV）

**Files:** Create `js/sasfit-report.js`、`tests/sasfit-report.test.js`；Modify `index.html`、`tests/load.js`。

**報告 TXT 的內容（規格 §9 逐項，缺一項測試就失敗；鍵名英文、說明句繁體中文——工程決定 11）：** 標題與產生時間（`generatedAt` 由參數傳入，測試固定）；資料檔名、種類、官方檔頭（輸出檔名、能量 keV、q_start、厚度 mm、Scaling Factor、樣品與空槽透射率、SDD、幀數與單幀時間；一般檔寫「無檔頭」）、點數；模型（sasmodels 名稱＋中文名）、S(Q)、組合方式（`P*S`／`P*(1+beta*(S-1))`）、有效半徑模式（文字取自 meta 的 `reffModes`）、低 q 冪律；多分散設定（每個開著的：分布、寬度、取點數、範圍 σ 倍數）與 cutoff；**參數表**（來自 `SasFitExport.paramRows`）：名稱｜值（`num`，全精度）｜未乘誤差（`num`）｜已乘 √(量度) 誤差（`num`）｜**畫面格式的「值 ± 誤差」**（`SasFitFormat.valueError(value, errorShown)`，與結果磚相同）｜單位｜fitted／fixed｜at lower／upper bound｜下限｜上限，並註明畫面顯示的是哪一種誤差；`bounds` 為 null 時下限、上限寫 `-` 並加一行「上下限未記錄（匯出時參數表的模型已與這次擬合不同）」，否則註明「上下限為匯出當時參數表的設定」；χ²、量度（名稱照規則；非 σ 權重時加一行「此數值不是 χ²ᵣ，沒有絕對意義；參數誤差已乘 √(加權殘差均方)，SasView 在相同權重下顯示未乘的值」）、自由度、參與點數、q 範圍、權重；演算法（Levenberg–Marquardt）、ftol、xtol、最大步數、迭代數、狀態（`statusLabel().text`）與旗標（`illConditioned`、`blockedByNonFinite`、`jacobianNonFinite`、`nonFiniteCurvePoints`、|r| > 0.98 的相關參數對）；註記：SLD 取 f ≈ Z（規格 §4.7）、用到 hayter_msa 時加 §16 的限制句（重用 `SasFitHints` 的文字）、貼邊界參數的誤差沒有意義；軟體與版本、規格 §17 的致謝句。

**序列結果 CSV：** 註解列（同 Task 13 的前兩行、軟體、模型、權重、條件名稱、誤差是否已乘）→ 欄＝序號、檔名、條件值、每個參數的值與誤差兩欄（表頭註明誤差是否已乘）、量度、自由度、迭代數、狀態、實際 q 下限、q 上限、起始值來自哪個檔、註記。列＝`seq.order` 的每一筆（含被跳過與出錯的，數值為空）；數字用 `num`、文字經 `cell`。資料直接取自 `state`（`seq.rows`、`files`、`conditionName`）。

- [ ] **Step 1：先寫失敗的測試**（沿用 Task 13 的 fixture）
  - **黃金字串**：`reportTxt`、`sequenceCsv` 各對一個完整期望字串（同樣的註明）。
  - 規格 §9 的每一項各有一個「這一行存在」的斷言（清單寫在測試檔頂端）。
  - 兩種誤差：sigma 權重 → 報告註明畫面顯示未乘的；none → 註明顯示已乘的，兩欄數字相差 √(量度)。畫面格式那一欄與 `SasFitFormat.valueError` 的輸出相同；全精度欄讀回後 `Object.is` 等於原值。
  - 量度名稱：sigma → 「reduced chi-square（約化 χ²）」；none → 「weighted mean-square residual（加權殘差均方）」且不出現 `chi2r`／「χ²ᵣ」作為該數值的名稱。
  - `bounds` 為 null 與有值兩種。
  - hayter_msa 的限制句只在用到它時出現；f ≈ Z 的句子一定出現；`maxiter`、`failed` 的報告照樣產生並寫明狀態；`'stopped'` → Error。
  - 換行全是 `\r\n`；檔名與檔頭欄位裡的控制字元被換掉（不能靠換行偽造報告內容）。
  - `sequenceCsv`：三筆收斂＋一筆跳過＋一筆出錯 → 5 列資料、後兩者數值為空而狀態與註記有字；檔名 `=cmd.dat` 經 `cell`；`seq.order` 為 null → Error。
  - 不修改傳入的物件。
- [ ] **Step 2：** 實作（報告分成數個 < 50 行的區段函式）；`<script>` 接在 `sasfit-export.js` 之後。全綠、冒煙 ALL PASS。Commit `feat: sasfit report TXT and sequence CSV builders`。

### Task 15: `sasfit-export-ui.js`（下載、PNG、按鈕）

**Files:** Create `js/sasfit-export-ui.js`、`tests/sasfit-export-ui.test.js`；Modify `index.html`、`css/sasfit-views.css`、`js/section-sasfit.js`、`tests/sasfit-section.test.js`。**不改 `js/dndc-export.js`。**

`downloadChartPng`（`dndc-export.js:44-50`）沒有圖時把錯誤寫到 dn/dc 頁的 `hplcDndcResults`，不能沿用。決定：**本頁自己寫一個下載函式**（`deps.download(blob, fileName)` 的預設實作：`URL.createObjectURL` → 掛進 DOM 的 `<a download rel="noopener" hidden>` → `click()` → 下一個 tick 移除並 `revokeObjectURL`，與 `triggerDownload`，`dndc-export.js:20-32`，的做法相同），不泛化舊函式。

**按鈕位置：** 擬合分段結果之下一列 `div#sfExportRow`：`button#sfSendIucr[disabled][aria-describedby="sfSendIucrNote"]`「送進 IUCr 表格」＋`p.stat-sub#sfSendIucrNote`（本任務留空；事件在 Task 17 綁，在那之前按鈕保持停用）、`#sfExportCsv`「匯出擬合曲線 CSV」、`#sfExportTxt`「匯出報告 TXT」、`p.stat-sub#sfExportNote`（`role="status"`）；`#sfCurveTools` 內 `#sfMainPng`「PNG」（主圖）；殘差小標旁 `#sfResidualPng`；另綁 `#sfShapePng`（Task 6）、`#sfSeqTrendPng`、`#sfSeqCsv`（Task 10）。按鈕文字不加圖示。新 id 進 `ELEMENT_IDS`。

- [ ] **Step 1：先寫失敗的 stub-DOM 測試**（`deps.download` 記錄 `(blob 的 parts 與 type, fileName)`；`deps.now` 固定）：
  - 可用性：沒有結果、結果是 `'stopped'`、或擬合／序列進行中 → CSV／TXT 停用；有結果但**與表單不符**（`resultMatchesForm` false）→ 仍可匯出（匯出的是那次擬合的紀錄），`sfExportNote` 寫「匯出的是上一次擬合的結果；之後改過的參數不在其中」。
  - CSV：`download` 收到一個 Blob，內容＝`'\uFEFF' + SasFitExport.fitCsv(…)`、type `text/csv;charset=utf-8`、檔名＝`SasFitExport.fileName('fit', …)`（模型段取自 `fitResult.settings.modelSpec`，不是目前的表單）；`software` 的版本來自 `SasFitWorkerClient.scriptVersion`。TXT 同理（`text/plain;charset=utf-8`、`SasFitReport.reportTxt`）。
  - **上下限**：目前表單的 `SasFitJobs.modelSpec` 與結果的相同 → 從表單取出 `{ name: [lower, upper] }` 傳入；不同 → 傳 `null`（測試：換過模型後匯出不丟例外，報告有「上下限未記錄」）。
  - 序列 CSV：`state.seq.order` 為 null 或沒有任何 `'done'` 的列時停用；內容＝BOM＋`SasFitReport.sequenceCsv`；檔名用條件名稱。
  - PNG：主圖／殘差（`SasFitPlots.getChart('sfMainChart' | 'sfResidualChart')`）、趨勢（`getChart('sfSeqTrend')`）→ `ChartTheme.exportPng(chart)`（假的回傳固定 data URL）→ `SasFitExport.dataUrlBytes` → Blob `image/png`；沒有圖（`getChart` 回 null）→ 不下載、`sfExportNote` 顯示「尚無圖可匯出」（**不**碰 `hplcDndcResults`）；殘差圖收起來時 `#sfResidualPng` 停用；3D → `SasFitShape3d` 分段的 `exportBlob()`，`plotView` 不是 `'shape'` 或模型無形狀時 `#sfShapePng` 停用。深色主題下匯出仍是淺色白底由 `ChartTheme.exportPng` 與 `paint({ theme: 'light', background: true })` 保證（各自已有測試），這裡斷言「呼叫的是它們」。**不得出現 `fetch(`**（測試以原始碼字串檢查本檔）。
  - 預設的 `download`：建立的 `<a>` 有 `download` 與 `rel="noopener"`、`href` 是 `createObjectURL` 的回傳值（不是 `data:`）、點擊後在計時器回呼中 `revokeObjectURL` 恰好一次並移除節點；`createObjectURL` 丟例外 → `sfExportNote` 顯示錯誤訊息、`console.warn`、不留下節點。
  - 任何例外（字串建構丟 Error）→ 訊息顯示在 `sfExportNote`，頁面其他部分不受影響；成功時寫「已下載 <檔名>」（以 `textContent` 寫入）。
  - `#sfSendIucr` 在本任務始終停用。模組頂層不碰 `document`。
- [ ] **Step 2：** 實作；`SEGMENT_MODULES` 加 `{ key: 'export', global: 'SasFitExportUi' }`（`PLACEHOLDERS.export` 是 no-op）；`resolveDeps` 補 `download`、`now`；模組取得 3D 分段的 `exportBlob` 的方式：`ctx.shape = { exportBlob() }` 轉接（做法同 `ctx.sequence`，沒有該模組時 resolve `null`）——在本任務加進 `buildContext`。
- [ ] **Step 3：實測並記錄**：加入 `#sfMainPng` 後，圖卡標題列在 1280×800（內寬 420 px）不折行、曲線檢視有擬合結果時 `.sf-plots` 仍不捲動（Task 6 的量測重做一次）；手動下載三種文字檔並以 Excel／文字編輯器打開各看一眼（註解列、BOM、中文檔名）；有 pandas 可用時試 `read_csv(f, comment='#')` 並記錄結果。
- [ ] **Step 4：** 全綠、兩支冒煙 ALL PASS。Commit `feat: sasfit downloads for fit CSV, report TXT, sequence CSV and chart PNGs`。

### Task 16: `sasfit-iucr.js`（資料物件與列的 HTML）

**Files:** Create `js/sasfit-iucr.js`、`tests/sasfit-iucr.test.js`；Modify `index.html`、`tests/load.js`。

規格 §8。`data()` 回傳（深層凍結）：

```js
{ datasetName, model /* SasFitExport.modelText：'core_shell_sphere@hardsphere'，低 q 冪律加 '+power_law' */,
  structureFactorMode /* 'P*S' | 'P*(1+beta*(S-1))' | null */, radiusEffectiveMode /* 文字 | null */,
  params: [{ name, value, error, errorScaled, errorShown /* 依顯示規則選的那一個 | null */, unit, fitted, atBound /* 'lower'|'upper'|null */ }],
  measure: { isChi2, label /* 'Reduced χ²' | 'Weighted mean-square residual (weighting: <名稱>)' */, value }, chi2r /* 同 measure.value，沿用規格的鍵 */,
  errorsScaled /* boolean：errorShown 是否乘過 √(量度) */, dof, qMin, qMax, npoints, weighting, status,
  assumptions: [英文字串], notes: [英文字串], software }
```

- `params`＝`SasFitExport.paramRows(fitResult, null)` 的列（表格順序；開著的多分散有一列 `<name>_pd`，`unit` 寫分布名稱，例 `schulz`）。`unit` 用 `SasFitHtml.unitText`（`sasfit-html.js:177-180`，回傳純文字）。
- `npoints`＝`dof + names.length`；`qMin`／`qMax`＝`settings.range`。
- **`assumptions`**（英文，表格是英文的；工程決定 4）：每個開著的多分散一句（`radius: Schulz distribution, width 0.10 (fitted|fixed), 80 points, ±3σ`）；`X-ray SLDs computed with f ≈ Z (no anomalous correction)`；有 S(Q) 時 `Structure factor hardsphere combined as P*S; effective radius: <模式>`；用到 hayter_msa 時加 §16 的限制句（英文版，常數放本檔）；有低 q 冪律時一句。
- **`notes`**（警示；不擋送出——工程決定 3）：貼邊界的參數（`radius at upper bound; its error is not meaningful`）、`illConditioned`、`jacobianNonFinite`、強相關的參數對（`SasFitHints.strongCorrelations`）、誤差大於數值的參數（`SasFitFormat.isUndetermined`，貼邊界者除外）、σ 權重下 χ²ᵣ > `SasFitHints.CHI2R_WARN`、非 σ 權重時的 `errors are multiplied by sqrt(weighted mean-square residual)`、`nonFiniteCurvePoints > 0`。
- **沒有 CorMap P-value**：本工具不計算它；資料物件與表格都不出現這一項（Task 19 的科學審查確認這樣是否足夠）。
- `software`＝`SasFitExport.software(version)`；`version` 由呼叫端傳入（頁面上是 `SasFitWorkerClient.scriptVersion`，Node 測試直接傳 `'9.9'`）。
- `form` 只用來再確認一次 `canSend(form, fitResult)`：不 ok 時 `data()` 丟 Error（內容一律取自 `fitResult`）。

**可否送出** `canSend(form, fitResult)`：有結果、`status` 在 `SENDABLE`（只有 `'converged'`）、`blockedByNonFinite !== true`、且 `SasFitJobs.resultMatchesForm(form, fitResult)`（送進投稿表格的必須是畫面上這組參數）。否則 `reason`：「尚未擬合」「擬合未收斂，不能送進表格」「擬合失敗，不能送進表格」「擬合被無法計算的區域擋住，不能送進表格」「參數在擬合後改過；請重新擬合，或還原擬合前的參數」。

**`rowsHtml(data)`**（五欄，對齊 `index.html:1222-1229` 的表頭「Parameter（colspan 2）｜Value｜±｜Unit」）：`<tr class="table-section-header"><td colspan="5">Model fitting (analytical form factor)</td></tr>`（文字取自 `HEADING`）；`null` → 再一列 `<tr id="iucr-sf-empty"><td></td><td colspan="4">尚未送入擬合結果</td></tr>`；否則依序：Data file、Model、Structure-factor combination（有 S(Q) 才有）、每個參數一列（Value 與 ± 來自 `SasFitFormat.valueError(value, errorShown)`；固定參數 ± 欄 `fixed`；貼邊界 ± 欄 `at upper bound`／`at lower bound`）、q-range for fitting（`0.005–0.07`、Unit `Å⁻¹`）、Number of points、Weighting、量度（Parameter 欄是 `measure.label`；非 χ² 時 Unit 欄寫 `not χ²`）、Status、Assumptions（每則一列，第一列的 Parameter 欄寫 `Assumptions`、其餘留空）、Notes（有才有，寫法同 Assumptions）、Software。動態列的 id 一律 `iucr-sf-` 前綴＋小寫英數與單一連字號（`iucr-sf-file`、`iucr-sf-model`、`iucr-sf-p-0`、`iucr-sf-a-0`、`iucr-sf-n-0`…，**用序號不用參數名**，避免名稱進 id；符合 `/^iucr-sf(?:-[a-z0-9]+)*$/`）。

- [ ] **Step 1：先寫失敗的測試**
  - 物件形狀：規格 §8 的每個鍵都在、型別正確、深層凍結；sphere（擬合 scale、radius；固定 sld、sld_solvent、background）→ `params` 5 列、`fitted` 正確；core_shell_sphere@hardsphere＋`radius_pd` 擬合 → `model` 字串、`structureFactorMode: 'P*S'`、有 `radius_pd` 一列且 `unit: 'schulz'`、`assumptions` 有多分散與 S(Q) 各一句；β 模式 → 另一個字串；沒有 S(Q) → 兩個 mode 都是 null；hayter_msa → `assumptions` 有限制句，其他情況沒有；f ≈ Z 一定有。
  - 誤差：sigma 權重 → `errorShown === error`、`errorsScaled false`、`measure.isChi2 true`、`label === 'Reduced χ²'`；none → `errorShown === errorScaled`、`measure.label` 不含 χ 且含權重名稱；固定參數三個誤差都是 null；貼上限 → `atBound: 'upper'`。
  - `canSend`：五種 `reason` 各一；`converged`＋每一種警示（貼邊界、`illConditioned`、`jacobianNonFinite`、強相關、誤差大於數值、χ²ᵣ＝50、非有限曲線點）→ **ok**，且 `data().notes` 有對應的句子；`converged`＋`blockedByNonFinite` → 不 ok；`maxiter`、`failed`、`stopped`、`null` → 不 ok；與表單不符 → 不 ok。
  - `version` 缺 → Error；輸出不含寫死的版本（以 `'9.9'` 傳入並在 `software` 找到 `v9.9`）。資料物件與 `rowsHtml` 的輸出都不含 `CorMap`、`P-value` 字樣。
  - **XSS 矩陣**（`rowsHtml`）：`datasetName` 取 `<img src=x onerror=alert(1)>`、`"><script>alert(1)</script>`、`' onmouseover='x`、`&lt;b&gt;`、`javascript:alert(1)`；另把同樣的字串放進 `model`、`unit`、`assumptions`、`notes`、`software`、參數 `name`（直接構造 data 物件——函式不得假設輸入來自 `data()`）→ 輸出中 `<` 只出現在本函式自己的標籤（以白名單正規式 `/<\/?(?:tr|td|i|sub|sup)\b/` 逐一比對所有 `<`）、沒有 `on\w+=` 出現在標籤內、屬性值沒有未跳脫的引號。
  - 列：`null` → 恰好兩列、第一列的文字是 `HEADING`、含「尚未送入擬合結果」；有資料 → 沒有 `iucr-sf-empty`；每個 `id` 都符合上面的樣式且不重複；每列恰好 5 欄（計入 `colspan`）；固定參數 ± 是 `fixed`；數字的負號在 Value 欄是 U+2212（畫面慣例，§5.4 第 4 點）；Assumptions 至少一列（f ≈ Z）。
- [ ] **Step 2：** 實作；`<script>` 接在 `sasfit-report.js` 之後。全綠、冒煙 ALL PASS。Commit `feat: sasfit IUCr data object and model-fitting rows`。

### Task 17: IUCr 頁整合（區段 3、送出、複製帶輸入框的現值）

**Files:** Create `tools/sasfit/check_iucr_copy.py`；Modify `index.html`（IUCr 表格內的區段 3）、`tests/markup.test.js`、`js/app.js`、`js/section-iucr.js`、`js/sasfit-export-ui.js`、`js/section-sasfit.js`、`css/sasfit-views.css`、`tests/iucr-table.test.js`、`tests/sasfit-export-ui.test.js`。

先完整讀 `index.html:1202-1374` 與 `js/section-iucr.js`。

- [ ] **Step 1：`tests/markup.test.js`**（先改、確認因為標記還不存在而失敗）：`REGION_SIGNATURES` 尾端加 `'id="iucr-sf-body"'`；`REGION_ID` 換成依區段順序的 `REGION_IDS`（「守門測試」表），`:166-170` 的測試逐區段用自己的樣式；新增斷言：第三個區段去掉空白後以 `<tbody` 開頭、以 `</tbody>` 結尾，且位於 `id="iucrTable"` 與其 `</table>` 之間（以原始 HTML 的位置比較）；第三個區段沒有 `input`／`select`／`textarea`／`button`。其餘既有斷言一字不改。
- [ ] **Step 2：區段 3**：插在 `index.html:1369` 的 `</tbody>` 之後、`:1370` 的 `</table>` 之前——第二個 `<tbody id="iucr-sf-body" class="iucr-sf-body" data-empty="true">`，靜態內容就是 `SasFitIucr.rowsHtml(null)` 的輸出（測試斷言兩者去空白後相同，避免靜態與動態版本走樣），前後包 `<!-- sasfit:begin -->`／`<!-- sasfit:end -->`。`sasfit-views.css` 只需讓「尚未送入」那一列用 `--color-text-muted`。`updateIUCrTable` 不必改（它只寫個別儲存格）。
- [ ] **Step 3：`js/app.js`**：`AppState` 加 `sasfitData: null`（`app.js:10-15`）。
- [ ] **Step 4：`js/section-iucr.js` 的擬合段**（先在 `tests/iucr-table.test.js` 加失敗的測試；Task 0 Step 1 的測試不得改）：
  - `setIUCrModelFit(data)`：`AppState.sasfitData = data`（不修改舊物件；`null` 表示清除）後 `renderIUCrModelFit()`。
  - `renderIUCrModelFit()`：找不到 `#iucr-sf-body` 或 `SasFitIucr` 不存在 → 靜默返回（其他頁照常）；否則 `tbody.innerHTML = SasFitIucr.rowsHtml(AppState.sasfitData)`、`data-empty` 設為 `'true'`／`'false'`。**不**動 `iucrWarning`（它講的是蛋白質與 SAXS 頁，`section-iucr.js:104-106`）。
  - 測試（stub 元素）：`setIUCrModelFit` 後 `AppState.sasfitData` 是傳入的物件、舊物件未被修改、`innerHTML` 等於 `rowsHtml`、`data-empty` 正確；`renderIUCrModelFit` 在沒有 `tbody` 時不丟例外。
- [ ] **Step 5：複製內容的來源改為處理過的複本**（使用者決定 2——**刻意改變既有行為**；做法已在瀏覽器驗證）。`iucrCopySource(table)` → `{ html, text, node, release() }`：
  1. `clone = table.cloneNode(true)`。
  2. **輸入框換成現值**：`table.querySelectorAll('input, select, textarea')` 與複本的同一個查詢逐一對應（`cloneNode` 不帶目前的值，所以值一定從**原表格**的元素讀）；複本裡每個控制項以 `document.createTextNode(現值)` 取代（`select` 取所選項目的文字）。文字節點由瀏覽器在 `outerHTML` 時跳脫，不經 `innerHTML`。
  3. **空的擬合段不進複製**：複本的 `#iucr-sf-body` 若 `data-empty="true"` 就移除；**表格直屬的註解節點一律移除**（`sasfit:begin／end` 不該出現在使用者貼出去的 HTML），連同它們造成的多餘空白文字節點——做法：移除註解節點與被移除的 `tbody` 之後，把相鄰的純空白文字節點合併成一個。
  4. 複本掛進一個 `div.sr-only[aria-hidden="true"]`（`css/sections.css:115` 的既有 class；它有版面盒，`innerText` 才會依表格版面輸出 Tab 與換行），容器附加到 `table.parentNode`；`html = clone.outerHTML`、`text = clone.innerText`。
  5. `release()` 移除容器。**從掛上到移除在同一個同步段落內完成**（瀏覽器中途不會重繪；重複 id 只存在於這個段落內）：複製按鈕的處理函式在 `await` 之前就取得 `html`／`text`；Clipboard API 的路徑取值後立刻 `release()`，再寫入剪貼簿；後備路徑（`document.execCommand('copy')`）改為 `selectNode(source.node)`，在 `finally` 裡 `release()`。其餘（`ClipboardItem` 的兩種型別、按鈕文字與計時）不動。任何例外都不留下容器。
  - `tests/iucr-table.test.js`：把 Task 0 Step 3 那一項改寫成新行為的說明（fixture 仍是舊行為的紀錄，不改 fixture）；以 stub 元素測得到的部分：`release()` 一定被呼叫（即使 `innerText` 的 getter 丟例外）、`AppState` 不被動到。DOM 行為由 Step 7 的瀏覽器檢查把關。
- [ ] **Step 6：「送進 IUCr 表格」**（`sasfit-export-ui.js`）：`render()` 依 `SasFitIucr.canSend(ctx.getForm(), 擬合對象的結果)` 設 `disabled` 與 `#sfSendIucrNote`（不能送時寫 `reason`）；擬合或序列進行中停用。點擊 → `SasFitIucr.data({ fileName, fitResult, form, version: SasFitWorkerClient.scriptVersion })` → `ctx.deps.sendIucr(data)`（預設實作 `host().setIUCrModelFit(data)`——頂層函式宣告在瀏覽器裡是 `window` 的屬性；`section-sasfit.js` 的 `resolveDeps` 補這個預設值，測試注入假函式）→ `#sfSendIucrNote` 寫「已送進 IUCr 表格（<檔名>）；再次送出會取代它」、焦點留在按鈕。已送出後又改了參數 → 表格內容不變（它是當時的快照），說明改回不能送的原因。`data()` 或 `sendIucr` 丟例外 → 訊息顯示在 `#sfSendIucrNote`、`console.warn`。
- [ ] **Step 7：`tools/sasfit/check_iucr_copy.py`**（重用 `capture_iucr_copy.py` 的 `show_iucr`、`fill_iucr`；context 給剪貼簿權限；比對的值以 `page.evaluate('() => { const s = iucrCopySource(document.getElementById("iucrTable")); try { return { html: s.html, text: s.text }; } finally { s.release(); } }')` 取得；印 PASS／FAIL，結束碼反映成敗；Task 18 的冒煙匯入它的 `run_checks(page, report)`）。**全部在 IUCr 分頁顯示中進行**：
  1. **基準仍可重現（輸入框以外的部分）**：把三個輸入框清空 → `text` 與 `iucr-copy-v5.2.json` 的 `default.text` **逐字相同**；`html` 與「`default.html` 去掉所有 `<input …>` 標籤」在正規化後相同（正規化＝去掉 HTML 註解、把標籤之間的純空白去掉；兩邊同樣處理）。`fill_iucr` 之後對 `filled` 做同樣的比對。（審查時在加入區段 3 之前實測：清空時兩者不經正規化就逐字相同。）
  2. **現值進入兩種內容**：三個輸入框填入 `0.0123-0.456`、`3 x 10 s`、`288 <K> & "q"` → `text` 含這三個字串、各在自己那一列（`q-range\t0.0123-0.456`…）；`html` 含它們的跳脫形式（`288 &lt;K&gt; &amp; "q"`）；**`html` 不含 `<input`**；頁面上的三個輸入框還在、值沒變；`#section-iucr .sr-only` 容器不存在；`html` 不含 `sasfit:begin`。
  3. **空的擬合段不進複製**：未送出時 `text`／`html` 不含 `Model fitting`、不含「尚未送入擬合結果」，但頁面上看得到它。
  4. **真的按一次「複製表格」**：`navigator.clipboard.readText()` 與 `read()` 的 `text/html` 等於 `iucrCopySource` 的 `text`／`html`。
- [ ] **Step 8：** 全綠、兩支冒煙 ALL PASS、`check_iucr_copy.py` 全 PASS。Commit `feat: send a SAS model fit to the IUCr table; copied table carries current input values`。

### Task 18: `smoke_m4.py`（瀏覽器冒煙與 axe）

**Files:** Create `tools/sasfit/smoke_m4.py`；Modify `tools/sasfit/smoke_ui.py`（只把 `JS_AXE` 的範圍改成可傳入選擇器，預設行為不變）、`tools/sasfit/README.md`。

以 `~/Projects/text-to-cad/.venv/bin/python` 執行；開頭 `sys.dont_write_bytecode = True` 之後才匯入 `smoke_browser`（`start_server`、`Report`、`open_page`、`check_console`，`smoke_browser.py:75、207、218、232`）、`smoke_ui`（`Ctx`、`tab`、`fresh`、`open_section`、`load_files`、`pick_model`、`inject_axe`、`run_axe`、`SYNTH`）與 `check_iucr_copy`。瀏覽器 context 要 `accept_downloads=True` 與 `permissions=['clipboard-read', 'clipboard-write']`。共用規則 9（箭頭函式、不在頁面內 fetch blob／data）。整體逾時 240 秒；結束碼反映成敗。原有兩支腳本照跑且 ALL PASS。

- [ ] 檢查項（每項印 PASS／FAIL）：
  1. **序列**：載入三個 `SYNTH_sphere_*.dat`、sphere、radius 53、勾選 radius、Qmax 0.07（理由同 `smoke_ui.py` 的 `fit_sphere`）→「序列」分段 → 執行 → 20 秒內表格 3 列都「已收斂」；三筆 radius 與真值 50／52／54 各差 < 0.5；`Chart.getChart('sfSeqTrend')` 的資料 3 點、**y 嚴格遞增**、x 為 10／20／30、x 軸標題等於條件名稱；每筆的量度在 0.5–1.6。
  2. **起始值傳遞**：`SasFitSection.getState().seq.rows` 中第 2、3 筆的 `startedFrom` 是前一筆的 id；另以 `page.evaluate` 包住 `SasFitWorkerClient` 的 `fit` 記錄 job 再跑一次，第 2、3 筆送出的起始 radius 等於前一筆的結果。
  3. **結束後與點列**：序列結束後擬合列**沒有**「參數已改動」、參數表的 radius 是擬合對象的結果；按第 3 列的載入鈕 → 擬合對象是第 3 個檔、參數表的 radius 是 54 附近、主圖模型曲線存在、擬合列顯示該檔的量度。
  4. **停止**：cylinder＋兩個多分散（慢）跑序列 → 第 1 筆進行中按擬合列的「停止」→ 1 秒內擬合列顯示已停止；頁面解鎖（可改參數、預覽會更新）；頁面上沒有任何「繼續」按鈕；再按執行會重跑。
  5. **送 IUCr 與複製**：`check_iucr_copy.run_checks`（Task 17 Step 7 的四項）。回到第 1 項的結果 →「送進 IUCr 表格」→ 切到 IUCr 頁：`#iucr-sf-body` 的標題列是「Model fitting (analytical form factor)」，有 Data file、Model `sphere`、5 個參數列（固定者 ± 為 `fixed`）、q-range、Number of points、Weighting、量度、Status、Assumptions（含 `f ≈ Z`）、Software 含 `v5.2`；按「複製表格」→ `readText()` 含 `Model fitting` 與檔名、`text/html` 含 `Model fitting`、不含 `<input`、不含 `sasfit:begin`；且**把擬合段從複製的 text 去掉、輸入框清空後，其餘與基準 `filled.text` 相同**。
  6. **匯出**（`page.expect_download()`，讀下載檔的位元組）：擬合曲線 CSV——檔名 `SYNTH_sphere_10_sphere_fit.csv`、以 BOM 開頭、註解列都以 `# ` 開頭、表頭六欄、資料列數等於該檔點數、`in_fit` 為 1 的列數等於擬合列顯示的點數、I_model 全為有限值；以 `numpy.genfromtxt(path, delimiter=',', encoding='utf-8-sig')` 讀得回來（6 欄）；報告 TXT——檔名、含模型、每個擬合參數、全精度與畫面格式兩種寫法、兩種誤差的欄名、量度名稱、`f ≈ Z`、軟體字串；序列 CSV——3 筆資料列、radius 欄遞增；PNG（主圖、殘差、趨勢、3D）——PNG 簽名、解碼後左上角像素是白色（把位元組以 base64 參數傳進 `page.evaluate`，在頁面內 `atob` → `Blob` → `createImageBitmap` → 畫到 canvas 取像素），深色主題下再匯出一次仍是白色。
  7. **3D**：按「結構」→ `#sfCurveView` 隱藏、canvas 非空白（`getImageData`，不同顏色的像素 > 500）；拖曳 80 px → 像素雜湊改變；radius 50 → 100 且其他不變時，比例尺的標籤或像素長度改變（按比例）；選 core_shell_sphere → 畫面上同時有兩種色相（核與殼）；選 flexible_cylinder → 非空白且 `#sfShapeStatus` 含「代表性構形」；選 guinier → 「此模型沒有固定形狀」；按「曲線」→ 主圖回來且有資料（`Chart.getChart('sfMainChart')` 的畫布寬高 > 0）。
  8. **3D 鍵盤與滾輪**：焦點在 `#sfShapeStage` 按 `ArrowLeft` → 像素雜湊改變、頁面沒有捲動；按 `+` → 物件的像素範圍變大；滑鼠在畫布上單純滾輪 → `window.scrollY` 改變而畫面不縮放；Ctrl＋滾輪 → 縮放而不捲動；`page.emulate_media(reduced_motion='reduce')` 後重新載入 →「自動旋轉」停用。
  9. **鍵盤**：分頁鈕四段方向鍵；序列表格的勾選與載入鈕可用 Tab 到達，Space／Enter 觸發，觸發後焦點還在原處。
  10. **主題**：深色下 3D 重畫（雜湊改變）、趨勢圖的 `borderColor` 等於 `ChartTheme.PALETTES.dark.series[0]`。
  11. **axe**（`inject_axe`／`run_axe`，範圍以選擇器傳入）：淺色、深色各跑——序列分段空狀態、序列完成（表格＋趨勢圖）、「結構」檢視、匯出列可用、IUCr 頁已送入擬合段（範圍 `#section-iucr`；審查時的現況是 0 違規）。**0 違規**。
  12. **版面**：1440×900、1280×800、1024×768 下，「曲線」（有擬合結果）與「結構」兩種檢視 `.sf-plots` 的 `scrollHeight === clientHeight`；1440×900、1280×800、1024×768、760×900、320×640 下 `document.documentElement.scrollWidth <= clientWidth`；序列表格的橫向捲動只發生在 `#sfSeqWrapper` 內；四個分頁鈕不折成兩行（320 px 例外：允許折行但不溢出）。
  13. 全程 console 沒有 error／pageerror；Worker 與 wasm 請求仍帶 `?v=`（重用 `smoke_browser.check_versions` 的判斷）。
  14. 量測並印出（不設門檻，寫進完成紀錄）：3D 重畫一格的時間（核殼圓柱、拖曳 60 格的中位數）；500 列的序列表格重建時間（以 `page.evaluate` 直接呼叫 `SasFitSeqView.bodyHtml` 於合成的 500 列）；三筆序列的總時間；各視窗的畫布尺寸。
- [ ] 全部 PASS、`git status` 沒有 `__pycache__`。Commit `test: sasfit M4 browser smoke for sequence, IUCr, exports and the 3D sketch`。

### Task 19: 審查、修正、文件

**Files:** Modify 規格書、本計畫（「M4 完成紀錄」）、`tools/sasfit/README.md`；修正視審查結果而定。

- [ ] **科學審查**（science-reviewer，唯讀；與另兩個審查平行）：
  - 3D——各模型的尺寸對應是否與 sasmodels 定義一致（core_shell_cylinder 的殼是否包住兩端、vesicle 的 `radius` 是內半徑、ellipsoid 的極軸）、比例與 nm 標註、lamellar 畫成單一薄板與「橫向不按比例」的說法、多分散文字「R ± 寬度×R」對各分布是否成立（lognormal、schulz）；蠕蟲鏈產生器（l_p＝b/2、每步兩個橫向高斯角、沒有排除體積而 `flexible_cylinder` 模型有、固定種子的代表性、「一個代表性構形」的措辭）。
  - 序列——初值規則（工程決定 6：收斂、非 `blockedByNonFinite`、σ 權重時 χ²ᵣ ≤ 10；貼邊界的結果可當初值——從邊界上出發是否有風險）、未編輯範圍時每檔用自己的預設範圍、範圍截斷與跳過規則、不混用權重。
  - 報告 TXT 的內容與單位（兩種誤差的說明、量度名稱、f ≈ Z、hayter_msa 句）。
  - **IUCr 段落**對照 Trewhella 等 2017（Acta Cryst. D73, 710–728）Table 1 與其 2023 年的範本更新版。審查時查到的 2023 版「Modelling」一段的列：Methods/software、q-range for fit、Symmetry/anisotropy assumptions、No. of individual model reconstructions、χ² 與 CorMap P-value；正文另要求寫出重現模型所需的全部細節（含可調參數），擬合以誤差加權的殘差圖呈現；該範本沒有解析形狀因子擬合的專屬段落（2017 年原表未逐字核對）。請逐項確認本計畫的列清單（Data file、Model、Structure-factor combination、各參數、q-range、Number of points、Weighting、量度、Status、Assumptions、Notes、Software）是否足夠、**不列 CorMap P-value 是否可接受**、標題「Model fitting (analytical form factor)」是否恰當，以及形狀模型擬合放在蛋白質溶液 SAXS 表格裡是否需要另加說明。
- [ ] **UI／UX 與無障礙審查**（ui-designer，對照 CLAUDE.md 的 Design Context）：「曲線｜結構」切換鈕的位置與可發現性（使用者點名要這個功能）；核／殼配色在兩個主題與色覺差異下是否分得清、是否與資料點的系列色混淆（Task 1 的起始色碼定稿）；柔性圓柱粗線的觀感；序列分段的資訊順序（選項 → 執行 → 趨勢 → 表格）與左欄 26 rem 內表格的可讀性；擬合列在序列期間的文字；擬合分段同時有「開始擬合」與序列分段的「執行序列擬合」是否會混淆；四個分頁鈕在窄寬度；匯出按鈕列是否擠；IUCr 擬合段的可讀性；鍵盤操作 3D（`role="group"`＋`tabindex` 的做法是否恰當，是否該用 `role="application"`）、觸控只能改方位角是否需要補按鈕、焦點回復、`aria-live` 不洗版、主角磚仍只有一個；多行文字 justify、單行文字顯式對齊。
- [ ] **程式與安全審查**（code-reviewer＋security-reviewer）：`git diff ed9db6f..HEAD`。重點——不可變性；純／DOM 界線；序列的競態（執行中切分段、連按執行、停止後立刻重跑、序列中單筆擬合被擋、`seqStep` 與 `fitProgress` 的先後、Worker 異常時狀態解鎖）；rAF 與監聽器的清理、`ResizeObserver` 不造成重畫迴圈；每個 `innerHTML` 來源追到 `escapeHtml`（序列表格、IUCr 列、3D 尺寸清單、趨勢圖 y 選單）；**下載**（只用 Blob URL、確實 revoke、檔名經 `safeName`、`download` 屬性不含路徑）；**剪貼簿**（複製內容只來自表格的複本、暫時的容器在每條路徑都被移除、輸入值以文字節點寫入）；**CSV**（RFC 4180、公式注入防護、註解列的清理）；`AppState.sasfitData` 只在一處寫入；CSP meta 未變（`index.html:13-14`）、沒有新外部來源、沒有 `fetch(data:)`／`fetch(blob:)`；每檔 ≤ 800 行、函式 < 50 行；錯誤沒有被吞掉。
- [ ] 修正 CRITICAL／HIGH（一輪），之後全測試綠、三支冒煙與 `check_iucr_copy.py` ALL PASS。Commit `fix: sasfit M4 review findings`（視內容可拆）。
- [ ] **文件**：規格 §3.2／§3.3（新檔與載入順序）、§5.1（圖卡的「曲線｜結構」切換，版面圖改掉 3D 那一列）、§5.2（資料清單沒有「序列」欄）、§5.5（序列分段的實際內容）、§5.6（PNG 按鈕）、§6（Ctrl＋滾輪、比例尺與文字清單、粗線的柔性圓柱、蠕蟲鏈參數、lamellar、配色）、§7（每檔範圍、跳過、初值規則、不續跑、結束後載入、`stale`）、§8（物件的新增鍵、可送出的條件、段落標題與列、不列 CorMap、複製時不含空段、**複製帶輸入框的現值且不留 `<input>`**）、§9（精度、注入防護、註解列與讀法、BOM、檔名規則、報告的兩種數值寫法）；§15 新增決策列（自 30 起）：30「曲線｜結構」切換（使用者 2026-11-19）、31 IUCr 複製帶輸入框現值（使用者 2026-11-19）、32 可送 IUCr 的條件、33 IUCr 段落的標題與列（不列 CorMap）、34 序列各檔的範圍與權重、35 序列初值規則、36 不續跑／結束後載入擬合對象／一張表、37 3D 的畫法慣例——各附理由與日期，科學審查若推翻則照改；本計畫填「M4 完成紀錄」。Commit `docs: sasfit M4 spec amendments and completion record`。

---

## 起草與審查時實查（與規格文字不同或規格沒寫之處）

1. **IUCr「複製表格」走 DOM**：`table.outerHTML`＋`table.innerText`（`section-iucr.js:18-19`），不是由資料結構組字串。擬合段只要是 `#iucrTable` 內的列就自動被複製；反過來，**靜態的「尚未送入擬合結果」也會被複製進使用者的投稿表格**，所以 Task 17 讓空的擬合段不進複製內容。另：`outerHTML` 帶出的是 `<input value="…">` 的**屬性**（預設值），`innerText` 不含輸入框的值——使用者決定在 M4 一併修正（Task 17 Step 5）。
2. **`result-golden` 沒有鎖 IUCr 頁**；`tests/` 沒有任何檔載入 `section-iucr.js`。規格 §11 G7 的「不得重產」照舊，但對 IUCr 頁沒有保護力——所以有 Task 0。
3. **`AppState` 是頂層 `const`**（`app.js:10`），不是 `window.AppState`；`section-iucr.js` 以裸名稱用它（`:71-72`）。
4. **`updateIUCrTable` 只由蛋白質頁與 SAXS 頁呼叫**（`section-protein.js:96`、`section-saxs.js:210`），切到 IUCr 頁時不會重繪——擬合段必須在送出當下自己寫入。
5. **CSP**：`img-src 'self' data: blob:`、`connect-src 'self' https://cdn.jsdelivr.net`、沒有 `navigate-to`（`index.html:13-14`）。Blob 下載與 data: 下載都不受限（既有的 dn/dc PNG 匯出就是 data: URL，`dndc-export.js:49`）；受限的是 `fetch('data:…')` 與 `fetch('blob:…')`。
6. **`FitResult` 不含上下限與擬合勾選**（`sasfit-worker-core.js:331-357`），但 `params` 含多分散的四個鍵與兩個模式參數（`sasfit-jobs.js:113-135`）、`settings` 含 `modelSpec`／`weighting`／`range`／`cutoff`／`maxSteps`／`method`／`ftol`／`xtol`。`names` 之外的參數都是固定的；點數＝`dof + names.length`。
7. **`state.range` 只有一份**，屬於擬合對象（`sasfit-state.js:26-30、173-178`），`userEdited` 說明它是不是使用者定的；每個檔實際用的範圍記在 `FitResult.settings.range` 與序列的列裡。
8. **`applyResult` 在模型規格不同時丟 Error**（`sasfit-jobs.js:313-316`）；`resultMatchesForm` 不比上下限與勾選（`:320-327`）。
9. **`stop()` 是「終止 Worker」**（`sasfit-worker-client.js:386-394`），沒有等待中的請求時什麼都不做；序列停止後下一次擬合要重新載入 wasm（lazy）。`BUSY`、`SUPERSEDED`、`STOPPED` 在 `SasFitHints.ERROR_ROUTES` 是 `'ignore'`（`sasfit-hints.js:157`）。
10. **`ctx.dispatch` 預設整頁重繪**，`{ silent: true }` 才不會（`section-sasfit.js:218-225`）；`ctx.setHtml` 只還原有 id 的焦點元素（`:238-242`）。
11. **`SasFitPlots` 只認得兩張圖**（`sasfit-plots.js:230-234`），`tpsHollow` 是整個 dataset 的屬性（`chart-theme.js:130-135`）。
12. `SasFitDataIo` 讀得回自己匯出的註解與 BOM，但只收 2–4 欄（規格 §4.8）：6 欄的擬合曲線 CSV 不能直接再載入本頁——不視為需求。
13. `smoke_ui.py` 的 `JS_AXE` 只會掃 sasfit 分頁（`:121-129`）；axe 由 jsdelivr 載入測試瀏覽器（需要網路，既有做法）。

## 未決問題

### (a) 工程上的假設（實作照此進行；Task 19 的審查可推翻）

1. 3D 的尺寸標註是圖下的文字清單＋圖上的比例尺，不在 3D 圖上畫尺寸線。
2. 網格的面不描邊（只以同色細線蓋掉接縫）；`shapeEdge` 只用在柔性圓柱粗線的兩側與比例尺。若 UI 審查要求輪廓線，再加「前後面交界的邊」這一種。
3. 序列期間不改擬合對象、不改表單；結束後只自動載入擬合對象自己的結果。點列載入以序列開始時的表單快照為底。
4. 結果表顯示 `fitResults` 目前的內容（單筆與序列共用，規格 §7 末）；序列之後被單筆擬合取代的列標「已單獨重新擬合」。
5. CSV 保留 BOM（規格），檔內第 2 行寫明讀法。
6. 匯出不泛化 `downloadChartPng`，本頁自有下載函式；`dndc-export.js` 不動。
7. 3D 不提供放大／縮小按鈕與平移；觸控螢幕的兩指縮放只在 headless Chromium 以合成事件驗證。
8. 自動旋轉預設關閉；系統設定「減少動態效果」時停用該開關，而不是讓使用者自行覆寫。
9. 序列遇到 Worker／wasm 層級的錯誤、或狀態寫不進去時，中止整個序列；其餘錯誤只標記該列。
10. 趨勢圖沒有縮放；條件值全空時 x 軸改用序號。
11. `SENDABLE` 以常數表示。
12. 報告 TXT 的鍵名用英文、說明句用繁體中文。

### (b) 需要專案擁有者決定的問題

**目前沒有。** 原列的九項都已決定並寫進「審查與決定紀錄」與各任務（3D 的位置、可送 IUCr 的狀態、序列各檔的範圍與權重、報告的語言與說明、3D 的配色與畫法、序列的初值規則、IUCr 複製的輸入值、IUCr 段落的列）。剩下的是 Task 19 兩個審查要確認、而不需要使用者先回答的事項：核／殼色碼的定稿（UI 審查）；IUCr 段落對照 2017／2023 準則的列清單與不列 CorMap P-value（科學審查）；貼邊界的收斂結果當初值的風險（科學審查）。審查若提出新的科學判斷，依規格 §14 第 4 點先問使用者。

---

## M4 完成紀錄（Task 19 填寫）

- **完成日期／最後一個 commit**：2026-11-20。審查後的修正三個 commit：`3aa2ec7`（3D、圖區版面、表格樣式）、`bcf46f6`（序列、IUCr 段、匯出、剪貼簿）、`3b2d4f0`（結構檢視的高度）；文件是其後的 `docs: sasfit M4 spec amendments and completion record`。版本仍是 5.2（M5 才 bump），未 push。
- **測試數與冒煙**：`node --test saxs-calculator/tests/*.test.js` 1875 項、1874 通過、0 失敗、1 略過（修正前 1855／1854）。`smoke_browser.py` 8 PASS、`smoke_ui.py` 41 PASS、`smoke_m4.py` 48 PASS、`check_iucr_copy.py` 13 PASS，四支都是 `RESULT: ALL PASS`；整輪 0 個 console error、0 個 pageerror（1 個 Chromium 的 `willReadFrequently` 警告，來自冒煙腳本自己讀像素）；axe 0 違規（兩個主題；`smoke_ui.py` 14 項、`smoke_m4.py` 10 項）。
- **3D**：`.sf-plots` 的 `scrollHeight／clientHeight`——1440×900 曲線 759／759、結構 759／759；1280×800 713／713、713／713；1024×768 698／698、698／698（欄高上限 849／749／717）。「減少動態效果」與觸控各讓操作說明多一句時仍是 759／713／698（結構檢視高度固定，文字框 147 → 127 px 吸收）。畫布 575×414、420×368、448×353；單欄 658×260（760×900）、218×192（320×640）。標題列在 1280 與 1024 兩種檢視都是一行，切換鈕的位置不隨檢視改變。一格重畫（core_shell_cylinder，2288 面，575×414，60 格）：中位數 1.60 ms、最大 6.50 ms（Task 18；修正後重量 1.50／3.60 ms）。面數：sphere 1536、ellipsoid 1536、cylinder 768、core_shell_sphere 3968、vesicle 2432、core_shell_cylinder 2288、lamellar 6；flexible_cylinder 預設 80 段粗線。蠕蟲鏈 ⟨Rg²⟩／解析值（3000 個種子）：L/b＝1、10、25、50、100、150、199、200、300、1000、10000 → 1.11、1.02、1.01、1.01、1.01、1.01、1.02、1.02、1.01、1.01、1.01（L/b＝1 的 1.11 是 17 個點取樣一根近似直棒的離散誤差，與鏈的構造無關）；修正前 L/b＝300 是 1.70、1000 是 4.83。預設參數（L 1000、b 100）的構形與修正前最多差 2.1 Å（外接半徑 190 Å 的 1.1 %）。
- **序列**：三個合成檔（sphere，3 個自由參數）radius 49.944、52.292、54.168（真值 50、52、54），χ²ᵣ 1.025、0.794、0.993，按下到完成 0.04 s；第 2 筆的註記是「未沿用上一筆的 background（上一筆未能決定，改用原始設定值）；初值來自 SYNTH_sphere_10.dat」（第 1 筆的 background 是 −0.96 ± 3.5）。500 個檔的表格（833 個 `<tr>`，含註記列，7 欄）：`bodyHtml` 中位數 2.10 ms、寫入 `innerHTML` 5.70 ms（修正前沒有註記列時 1.80／5.40 ms）。整頁重繪：三筆 2 次、500 筆 2 次（開始與結束；單元測試）。表格寬度／框寬：1440 → 520／394、1280 → 520／389、1024 → 520／396（第一個參數欄的右緣在 377 px，檔名、條件、量度＋狀態與第一個參數不必橫捲）；760 → 656／656；320 → 520／216（檔名欄不固定）。
- **IUCr**：複製基準比對——輸入框清空時文字 604／604 字元、HTML 2378／2378 字元與基準相同（已填值時 655／655、2429／2429）；現值進入文字與 HTML、HTML 無 `<input>`、無暫時容器殘留；後備路徑（`clipboard.write` 被拒）與 Clipboard API 的 `text/plain`（629 字元）與 `text/html`（8383 字元）逐字相同，`execCommand` 回傳 false 時顯示「複製失敗」。最後的列清單：標題「Model fitting (analytical scattering model)」｜Data file｜Model｜（Structure-factor combination）｜各參數｜q-range for fitting｜Number of points｜Weighting｜Reduced χ²（附 dof）｜Status｜Parameter errors (±)｜Assumptions｜Notes（第一句固定）｜Software。不加權的擬合：「送進 IUCr 表格」停用並說明原因，CSV／TXT 仍可匯出（瀏覽器實測）。
- **匯出**：實際檔名 `SYNTH_sphere_10_sphere_fit.csv`（16 kB、BOM、註解列含 residual 的定義、305 列資料、`in_fit`＝1 的 57 列）、`SYNTH_sphere_10_sphere_report.txt`、`濃度 (mg_mL)_sequence.csv`、`SYNTH_sphere_10_sphere_main.png`／`_residual.png`／`_shape.png`、`濃度 (mg_mL)_trend.png`（兩個主題下左上角都是白色）。`numpy.genfromtxt(delimiter=",", comments="#", encoding="utf-8-sig")` 讀回 [306, 6]（表頭列＋資料）。Excel 與 pandas **沒有實際開啟**（見未驗證事項；pandas 的 `comment="#"` 行為是計畫審查時以 2.3.3 與 3.0.2 查過的）。
- **與本計畫的出入**（審查後的修正；規格已同步）：
  1. 序列初值只沿用定得出來的參數，並排除 `illConditioned`／`jacobianNonFinite` 的結果（原工程決定 6 只看收斂與 χ²ᵣ）。
  2. 被單筆擬合取代的列顯示**序列自己的結果**（推翻假設 (a)4）；「載入」也因此永遠載入序列那一筆，「結果無法載入」的情況只剩寫不進表單時。
  3. 序列表改欄序、狀態併入量度欄、註記改成註記列；`tests/sasfit-html-helpers.js` 的屬性白名單加了 `headers`（註記列指回列標題用）。
  4. 只有 σ 權重的擬合可送 IUCr；`sasfit-iucr.js` 的「加權殘差均方」分支因此移除。IUCr 標題改為 analytical scattering model；Notes 有固定的第一句，所以「物件不含 CorMap 字樣」的測試改成「除了那一句之外不含、而且沒有 CorMap 的列或鍵」。
  5. 報告的 hc 改 12.398（原為 CODATA 值）。
  6. 3D：方向鍵方向反過來（與拖曳一致）；觸控可改仰角（原工程決定 10「觸控只能改方位角」推翻）；蠕蟲鏈的構造改寫；切換鈕標「3D 結構」並移到標題前；結構檢視高度固定。
  7. 擬合列在序列進行中只放短進度；視窗 1024 px 以下左邊多留選單鈕的位置。
  8. `safeName` 只去掉 `.dat／.txt／.csv`；文字儲存格的換行改成空白（原為保留在引號內）。
  9. `smoke_m4.py`／`smoke_m4_js.py` 跟著改了五處：標題常數、狀態晶片與列量度的選擇器（表格結構變了）、等「第 1 筆」開始的條件（擬合列的文字變了；舊條件會等到第 1 筆結束才成立）、表格量測的標示（500 個檔＝833 個 `<tr>`）。`check_iucr_copy.py` 沒有改。
- **規格 §15 新增的決策**：30–39（30 切換、31 複製帶現值、32 可送 IUCr 的條件、33 IUCr 段的標題與列、34 序列各檔的範圍與權重、35 初值規則、36 不續跑／結束後載入／一張表、37 3D 畫法、38 hc＝12.398、39 被取代的列保留序列的結果）。審查的更動：32、33、35、38 有使用者 2026-11-19 的決定；37 的蠕蟲鏈與方向鍵、39 是審查推翻原計畫的部分。
- **審查提出而沒有做的**：核／殼的色相不改；不加觸控用的方向按鈕；程式審查的 L2（分號）與 L4（空的 catch）照舊。
- **另外看到、沒有處理的**：`css/sasfit.css` 裡單欄版面的 `.sf-fitbar { position: static }` 寫在一般規則 `position: sticky` **之前**，同樣的優先度下後者勝出——單欄時擬合列實際上仍是 sticky（760×900 實測 `position: sticky`）。這是 M3 就有的行為，本次只確認它不會被選單鈕蓋住（左邊已留位置），沒有改。
- **未驗證事項**：真實螢幕報讀軟體（VoiceOver／NVDA）對註記列與 3D 畫布的朗讀；實體觸控裝置（觸控改仰角只有單元測試的合成事件，`touch-action: pan-y` 下瀏覽器何時把手勢交給頁面沒有在實機上看過）；Safari 與 Firefox（冒煙只跑 Chromium；`:has()` 與 container query 單位 `cqw` 需要 Safari 16+／Firefox 121+，不支援時結構檢視回到自動高度、註記列回到跟著表格寬度）；Excel 開啟 CSV；pandas 讀檔；`execCommand` 後備路徑在真正沒有 Clipboard API 的瀏覽器上（只以「把 `clipboard.write` 換成拒絕」模擬）。
