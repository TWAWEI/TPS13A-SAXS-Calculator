# 蘋果風改版（v5.0 骨架與深色模式、v5.1 結果磚）— 設計規格

- 日期：2026-10-14（同日依規格審查修訂一次）
- 狀態：設計已與使用者逐段確認，待使用者審閱本規格 → 撰寫實作計畫（v5.0、v5.1 各一份計畫）
- 目標產品：`saxs-calculator/`（GitHub Pages 單頁站），v4.14 → v5.0 → v5.1
- 視覺參考：Artifact「TPS13A 蘋果風方案」<https://claude.ai/artifact/UCCetn9p91wH8RgNqkeXYa>（A 方案、淺／深色預覽、色表）。mockup 是示意：側欄字為了塞進畫面縮小了，結果磚裡的「66.6 kDa」「相差 0.2%」是新格式，實作依 §7.2 保留現有數字格式。以本規格為準。
- 前置條件：同期「待辦批次」的靜態資源版本查詢（`?v=`）必須先上線，見 §9.1。

## 1. 目標與範圍

把整站改成蘋果風：輸入區用 macOS 原生 App 的骨架（淺色毛玻璃側欄、分組圓角列表、系統字），計算結果用發表會式的大數字磚。強調色保留 2026-08 定案的 muted coral，新增深色模式。

**在範圍內**
1. 重寫 `css/tokens.css`：淺色與深色兩組 token；全站寫死的色碼全部收進 token。
2. 主題切換：跟隨系統＋手動（自動／淺色／深色），選擇存在瀏覽器。
3. 共用元件換新：側欄、分組輸入列、按鈕、提示框、表格、分段控制、對話框、理論值面板、結果項目、卡片、字型、段落左右對齊。
4. 圖表主題化：切換主題時就地換色；匯出 PNG 一律淺色白底。
5. v5.1：各頁計算結果改成大數字磚，每頁一個主角數字。
6. `CLAUDE.md` 的 Design Context 改寫。

**不在範圍內**
- 任何計算、四捨五入、數值格式、缺值占位符的改變。改版前後每一個顯示的數字與占位符必須一字不差（§8.3）。
- 新的衍生數字（例如把比值改寫成百分比差）。結果磚只重新排列現有數字。
- `dndc calculator/`（Python）的網頁介面。
- 頁面增刪、導覽順序、資訊架構調整。
- 網頁字型檔：SF Pro 授權不允許網頁載入，只用系統字。
- 列印樣式的改版。唯一要做的是 §3.4：列印一律套淺色值，`@media print` 區塊裡的色碼換成 token。
- 待辦批次的其他項目（拆檔、Python xfail、fraction collector、脂質體科學決策），另有規格。

## 2. 使用者定案（2026-10-14）

| 項目 | 定案 | 否決的選項 |
|---|---|---|
| 方向 | 混合：macOS 原生骨架＋大數字結果磚 | 純 macOS 原生換皮；Apple 官網／發表會風（大字、要捲動） |
| 強調色 | A 珊瑚：#A85555（按鈕、選取），#A83737／#EE9090（數值文字） | B 系統藍 #0071E3；C 石墨中性 |
| 深色模式 | 跟隨系統＋手動切換鈕 | 不做；只跟隨系統 |
| 上線方式 | 兩階段：v5.0 骨架＋深色，v5.1 結果磚 | 一次全做；只換 CSS |
| 匯出 PNG | 一律淺色、白底 | 跟著當下主題 |
| 主題記憶 | 記在瀏覽器（`localStorage`，跨工作階段保留；側欄收合用的是 `sessionStorage`，兩者不同） | — |
| 結果數字字型 | 系統字＋`tabular-nums`；序列、檔案預覽仍用 JetBrains Mono | 全部 JetBrains Mono（現況） |
| 主角數字 | §7.2 的表。離心頁 RCF、HPLC 頁 Start → Stop 是提案，使用者回覆 OK，v5.1 前仍可改 | — |

## 3. 顏色系統

對比度一律用 WCAG 2.x 公式。「最差」指該文字可能出現的所有底色（卡片、頁面、輸入框底、hover、側欄）中最低的一個；半透明色先疊在實際底色上再算。以下數值都已用腳本驗算，實作後由 §8.1 的測試持續檢查。

### 3.1 Token 表

**表面**

| token | 淺色 | 深色 | 用途 |
|---|---|---|---|
| `--color-bg-primary` | #F5F5F7 | #121214 | 頁面底 |
| `--color-bg-card` | #FFFFFF | #1E1E21 | 卡片、結果磚、分組列表 |
| `--color-bg-secondary` | #FFFFFF | #1E1E21 | 其他白色表面（沿用名稱） |
| `--color-bg-tertiary` | #F0F0F3 | #2A2A2E | 輸入框底、理論值面板、結果項目、次要按鈕、一般提示框、分段控制軌道 |
| `--color-bg-hover` | #E8E8ED | #2C2C30 | 列表與次要按鈕 hover |
| `--color-bg-raised` | #FFFFFF | #3A3A3E | 分段控制的選中塊（只放主要文字，深色 10.4:1） |
| `--color-bg-sidebar` | #ECECF0 | #232327 | 側欄實色（不支援毛玻璃或使用者要求減少透明度時） |
| `--glass-sidebar` | rgba(236,236,240,0.82) | rgba(35,35,39,0.82) | 側欄毛玻璃底 |
| `--color-backdrop` | rgba(0,0,0,0.25) | rgba(0,0,0,0.5) | 對話框遮罩 |
| `--color-separator` | #E3E3E8 | #2E2E33 | 列表分隔線 |
| `--color-border` | #D2D2D7 | #3A3A3F | 表格外框、檔案上傳區虛線 |

**文字**

| token | 淺色 | 深色 | 最差對比（淺／深） |
|---|---|---|---|
| `--color-text-primary` | #1D1D1F | #F5F5F7 | 13.8 ／ 12.8 |
| `--color-text-secondary` | #424245 | #D1D1D6 | 8.2 ／ 9.1 |
| `--color-text-muted` | #636366 | #A1A1A6 | 4.9 ／ 5.4 |
| `--color-text-on-accent` | #FFFFFF | #FFFFFF | 見 §3.3 規則 3 |

`--color-text-muted` 原本想用蘋果的 #6E6E73，但它在輸入框底與 hover 底上只有 4.2–4.5:1，所以加深成 #636366。側欄毛玻璃疊在頁面上之後：`--color-text-primary` 14.5 ／ 14.9、`--color-text-secondary` 8.6 ／ 10.7、`--color-text-muted` 5.2 ／ 6.3。

**強調色**

| token | 淺色 | 深色 | 說明 |
|---|---|---|---|
| `--color-accent-primary` | #A85555 | #A85555 | **只當填色**：按鈕、選取膠囊。白字 5.1:1；對深色卡片 3.2:1（夠元件用，不夠文字用） |
| `--color-accent-primary-hover` | #8F4646 | #B05A5A | 白字 6.7 ／ 4.7；深色對卡片 3.5:1 |
| `--color-accent-text` | #A83737 | #EE9090 | 珊瑚色**文字**：數值、主角數字、連結。最差 5.3 ／ 6.0 |
| `--color-accent-tint` | rgba(168,85,85,0.10) | rgba(238,144,144,0.14) | 資料來源膠囊底。其上的 `--color-accent-text`：疊在卡片 5.6 ／ 5.6，疊在 tertiary 5.0 ／ 4.8 |
| `--color-focus` | #A85555 | #EE9090 | 2px 焦點框；對卡片 5.1 ／ 7.2 |

**語意色**（填色 token 只當填色；文字一律用 `-text`）

| token | 淺色 | 深色 | 說明 |
|---|---|---|---|
| `--color-success` | #059669 | #30D158 | 填色；對卡片 3.8 ／ 8.2 |
| `--color-success-text` | #047857 | #5BD68A | 放在 `-bg` 上 4.8 ／ 7.4 |
| `--color-success-bg` | #E5F4EC | #1D3326 | |
| `--color-warning` | #D97706 | #F5B754 | 填色；對卡片 3.2 ／ 9.3 |
| `--color-warning-text` | #92400E | #F5B754 | 放在 `-bg` 上 6.5 ／ 7.6 |
| `--color-warning-bg` | #FEF3E2 | #3A2C14 | |
| `--color-danger` | #DC2626 | #DC2626 | 填色、錯誤按鈕；白字 4.8；對卡片 4.8 ／ 3.4 |
| `--color-danger-text` | #B91C1C | #F58A8A | 放在 `-bg` 上 5.7 ／ 6.5 |
| `--color-danger-bg` | #FDECEC | #3A1C1C | |

**陰影、圓角、字型**（陰影隨主題變，所以也放在深色區塊）

| token | 值 |
|---|---|
| `--shadow-sm` | 淺：`0 0 0 0.5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`；深：`0 0 0 0.5px rgba(255,255,255,0.06)` |
| `--shadow-md` | 淺：`0 12px 40px rgba(0,0,0,0.18)`；深：`0 12px 40px rgba(0,0,0,0.55)` |
| `--radius-sm` / `-md` / `-lg` / `-xl` | 8px（輸入框、選取膠囊、結果項目）／ 10px（按鈕、分段控制）／ 12px（卡片、列表、提示框、面板）／ 18px（結果磚） |
| `--radius-dialog` / `--radius-pill` | 14px ／ 999px |
| `--font-body` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang TC", "Noto Sans TC", system-ui, sans-serif` |
| `--font-display` | 同上，`"SF Pro Text"` 換成 `"SF Pro Display"` |
| `--font-en` | 同 `--font-body`（保留 token，`.sci-var` 斜體用） |
| `--font-mono` | `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace` |

間距（4px 刻度）、`--transition-*`、`--sidebar-width` 240px／`--sidebar-collapsed-width` 56px 不變。

### 3.2 改名與刪除

**依用途改名，不是逐字替換。** 舊 token 在某處當文字用，就改成對應的文字 token；當填色用，才改成填色 token。改名一次到位，不留舊名別名。

| 舊 | 當填色、邊框用時 | 當文字用時 |
|---|---|---|
| `--color-accent-primary` | 不變 | `--color-accent-text` |
| `--color-accent-primary-light`（其實是變暗的 hover） | `--color-accent-primary-hover` | `--color-accent-text` |
| `--color-accent-purple`（其實是珊瑚文字色） | — | `--color-accent-text` |
| `--color-accent-secondary` | `--color-success` | `--color-success-text` |
| `--color-accent-tertiary` | `--color-warning` | `--color-warning-text` |
| `--color-accent-tertiary-text` | — | `--color-warning-text` |
| `--color-accent-danger` | `--color-danger` | `--color-danger-text` |
| `--color-accent-danger-text` | — | `--color-danger-text` |
| `--color-border-light` | `--color-separator` | — |

目前已知「填色 token 被當文字用」的地方（改名時必須改成文字 token；表格與 §8.1 的用途測試會抓到其餘的）：
- `color: var(--color-accent-primary)` 8 處：`tokens.css:158`（`a`）、`components.css:179/282/288/459`、`sections.css:58`、`dndc-theory-ui.js:46/95`（行內 style，改成 class）。深色下 #A85555 對卡片只有 3.2:1。
- `tokens.css:164`：`a:hover { color: var(--color-accent-primary-light) }`。連結 hover 改成 `--color-accent-text`＋底線。
- `components.css:304/514`：`color: var(--color-accent-primary-deep)`（該 token 要刪），改成 `--color-accent-text`。
- `section-saxs.js:33`：`style.color = 'var(--color-accent-danger)'`，改成切換 class，文字用 `--color-danger-text`。

刪除（使用處先改掉）：`--color-accent-pink`、`--color-accent-pink-hot`、`--color-accent-brand`（圖表色改由 `chart-theme.js` 管）、`--color-accent-secondary-dark`、`--color-accent-tertiary-dark`、`--color-accent-primary-deep`、`--color-text-on-accent-muted`／`-dim`／`-faint`（只用在實心珊瑚側欄與漸層色塊，兩者都移除）、`--shadow-lg`。

### 3.3 規則

1. 文字 ≥ 4.5:1；元件（按鈕外形、焦點框、圖表線、表示狀態的填色）≥ 3:1。兩個主題都要。
2. 按鈕 hover：淺色變暗、深色變亮。深色若也變暗（#8F4646），按鈕對卡片只剩 2.5:1；若亮到 #B86262，白字只剩 4.2:1，所以取 #B05A5A。
3. 白字只能放在 `--color-accent-primary`、`--color-accent-primary-hover`、`--color-danger` 上。
4. 填色 token（`--color-accent-primary`、`--color-success`、`--color-warning`、`--color-danger`）不能當文字。文字一律用 `--color-text-*`、`--color-accent-text` 或語意色的 `-text`；語意色的 `-text` 只放在對應的 `-bg` 或卡片上。§8.1 的用途測試會擋。
5. 色碼字面值只能出現在 `css/tokens.css` 與 `js/chart-theme.js`。其他 CSS、JS 與 `index.html` 的 `style` 屬性只能用 `var(--…)` 或 class（§8.1 有測試擋）。要清掉的包括：其他 4 個 CSS 檔的約 80 處字面值；`charts.js`、`dndc-charts.js`、`liposome-charts.js`、`dndc-hplc-results.js`、`dndc-astra-ui.js`、`section-hplc.js`、`section-sample.js` 的色碼。`section-hplc.js` 流速表的主步驟列（行內底色與 `color: #92400e` 字色）與 TM 模式字色，見 §5.6。
6. 不加左側色條（`border-left`）。現有的色條分兩種，都拿掉：
   - `.result-item` 的 CSS 預設左側色條（`components.css` 約 393 行）。
   - 行內 `border-left-color`／`border-left`：`section-sample.js:74,78,118,130,134`、`section-mw.js:101,140`、`section-centrifuge.js:70,74`、`dndc-hplc-results.js`、`dndc-multi-ui.js`、`dndc-slice-ui.js`。這些是在標出「該頁的主要結果」，不是狀態；v5.0 直接拿掉，v5.1 由主角磚取代。

### 3.4 CSS 結構

```css
:root { /* 全部 token 的淺色值 */ }
@media screen and (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { /* 深色值 */ color-scheme: dark; }
}
@media screen {
    :root[data-theme="dark"] { /* 與上一個區塊完全相同的深色值 */ color-scheme: dark; }
}
```

- 兩個深色區塊必須逐字相同（§8.1 測試比對）。
- 兩個深色區塊都限定 `screen`，所以列印一律用 `:root` 的淺色值。否則從深色模式列印，`p`、標題這些自帶 token 色的元素會變成淺色字印在白紙上。現有 `@media print` 區塊（`sections.css` 約 331–353 行）裡的 `color: #0d2137`、`border: 1px solid #ccc` 換成 `--color-text-primary`、`--color-border`，其餘列印規則不動。
- 側欄在 `@supports not (backdrop-filter: blur(1px))` 或 `@media (prefers-reduced-transparency: reduce)` 時改用 `--color-bg-sidebar` 實色。

## 4. 主題切換

### 4.1 狀態

- `localStorage` 鍵 `tps13a-theme`，值 `'light'` 或 `'dark'`；不存在或其他值都視為「自動」。
- 生效主題：手動值優先；自動時依 `prefers-color-scheme`。
- 寫在 `<html data-theme>`：手動淺色設 `light`、手動深色設 `dark`、自動則移除屬性，交給 CSS 的 media query。

### 4.2 `js/theme-init.js`（新檔，約 30 行）

- 放在 `<head>`：CSP meta 之後、第一個 stylesheet `<link>` 之前，用一般的同步 `<script src>`，不加 `defer`／`async`。它要在第一次繪製前設好屬性，深色使用者才不會先看到淺色閃一下。CSP 的 `script-src 'self'` 已允許，不必改 CSP。
- 只做一件事：讀 `localStorage`（try/catch，失敗視為自動並 `console.warn`），設定或移除 `data-theme`。
- 提供純函式 `ThemeInit.normalize(raw)` → `'light' | 'dark' | 'auto'`，給測試與 `theme-toggle.js` 共用。
- 頂層的設定動作只在 `typeof document !== 'undefined'` 時執行，讓 Node 測試可以直接載入這個檔。

### 4.3 `js/theme-toggle.js`（新檔）

- 頂層只定義物件 `ThemeToggle`；由 `app.js` 的 `DOMContentLoaded` 區塊呼叫 `ThemeToggle.init()`（沿用 `app.js:26-39` 各區段 `init*()` 的既有做法）。
- 側欄底部、版本號上方放一個分段控制：「自動／淺色／深色」。結構是 `<fieldset>`＋`<legend class="sr-only">外觀</legend>`＋三組 `<input type="radio">`／`<label>`，鍵盤用方向鍵切換（原生 radio 行為）。
- 變更時：用 `FormUtils.safeLocal` 寫入 `localStorage`，更新 `data-theme`，在 `document` 派發 `CustomEvent('tps:themechange', { detail: { theme } })`，`theme` 是生效主題（`'light'` 或 `'dark'`）。
- 自動模式下監聽 `matchMedia('(prefers-color-scheme: dark)')` 的 `change`，同樣派發事件。
- 側欄收合成 56px 時隱藏此控制；展開狀態與手機抽屜裡可用。
- 寫入失敗（例如隱私模式）時仍切換本次頁面，並 `console.warn`；下次開頁回到自動。

## 5. 共用元件（v5.0）

### 5.1 側欄

- 底色 `--glass-sidebar`＋`backdrop-filter: blur(20px) saturate(180%)`，右邊 1px `--color-separator`。
- 沿用現有三組：「分析工具」「🔒 dn/dc 工具」「輸出」，以及所有 id 與 aria 屬性，不改名、不改順序。組標題 12px、600、`--color-text-muted`。dn/dc 解鎖按鈕的外觀和組標題一致，保持可聚焦。
- 導覽項：文字 `0.9375rem`（約 16px，維持 2026-08 使用者要求的大小），`--color-text-primary`；hover 用 `--color-bg-hover`；選中項是 `--color-accent-primary` 圓角膠囊（`--radius-sm`）＋白字＋600 字重。拿掉 v4.8 的加深底色與左側白條。`aria-current="page"` 不變。
- 標誌：`TPS13A SAXS` 改成 17px 粗體。footer 的版本號用 `--color-text-muted`。
- 收合 56px（短標籤）、≤1024px 漢堡選單與遮罩：行為不變，只換色。

### 5.2 卡片與頁首

- 卡片：`--color-bg-card`、`--radius-lg`、`--shadow-sm`，不加邊框。卡片標頭的底線拿掉，改靠間距分隔。
- 卡片標題：17px、600。`.card-title--warning` 改用 `--color-warning-text`；`.card-title--purple` 刪除（純裝飾，只有 1 處）。
- 頁標題（`.page-title`）：約 30px、700、字距 -0.02em；副標用 `--color-text-muted`。

### 5.3 分組輸入列（新 class `.form-list`）

- 新容器 class，包住連續的「數字＋單位」欄位（`.form-group` 內含 `.form-input-group > .form-input + .input-unit`）。由 `index.html` 各卡片自行套用；不套用的維持堆疊式。
- 每列：`label` 靠左；輸入框加單位靠右；最小高度 44px；列與列之間是 1px `--color-separator`，左側內縮 14px（iOS 樣式）。
- 輸入框：`--color-bg-tertiary` 底、無邊框、`--radius-sm`、數字靠右、`tabular-nums`、寬約 9ch。focus 時 2px `--color-focus` 外框、offset 2px。
- 單位：`--color-text-muted`，設最小寬度讓數字對齊。
- 列表下方的說明文字用 `.form-list-foot`（12–13px、`--color-text-muted`），取代純說明用途的 `alert-info`，例如 SAXS 頁的「請先在蛋白質分析頁輸入序列」。警告與錯誤仍用提示框。
- 不轉換的欄位：序列 textarea、檔案上傳、選項文字過長的 select、checkbox 群、多欄並排的欄位。這些維持「標籤在上」，只換成新的輸入框樣式。
- `label[for]`、`id`、`aria-*` 一律不變，因為 JS 與測試都靠 id 取元素。§8.2 的測試會驗。

### 5.4 按鈕

- `.btn-primary`：`--color-accent-primary` 底白字、`--radius-md`、高 44px、600；hover 用 `--color-accent-primary-hover`。`:active` 不位移、不縮放（沿用「不做 hover 上浮」）。停用時 opacity 0.4 並設 `cursor: not-allowed`。
- `.btn-secondary`：`--color-bg-tertiary` 底、`--color-text-primary` 字；hover 用 `--color-bg-hover`。
- `.btn-sm` 高 32px。
- 錯誤或刪除類按鈕：`--color-danger` 底白字。
- **刪除未使用的 class**：`.btn-success`、`.copy-btn`（含 `.copied`）、`.btn-icon` 在 `index.html` 與 JS 裡都沒有被用到，連同規則一起刪，不改樣式。`components.css:224` 的選擇器 `.btn:not(.btn-sm):not(.btn-icon)` 同步改成 `.btn:not(.btn-sm)`。

### 5.5 提示框

- `--radius-lg`，拿掉左側色條，內距 12px 14px。
- `.alert-info`：`--color-bg-tertiary` 底、`--color-text-primary` 字，不再用珊瑚色，避免跟強調色搶。
- `.alert-success`／`-warning`／`-error`：各自的 `-bg` 底、`-text` 字。
- 結果文字裡的 ⚠️、✓ 保留（CLAUDE.md 允許的狀態符號）。

### 5.6 表格

- 表頭：12px、600、`--color-text-muted`、不填底色；列之間 1px `--color-separator`；不用斑馬紋。
- 數字欄靠右、`tabular-nums`。`.table-wrapper` 維持水平捲動。
- IUCr 大表、HPLC 流速表、脂質體結果表都用這個樣式。
- HPLC 流速表（`section-hplc.js:106-113`）：主步驟列改成 class，底色 `--color-warning-bg`、框數字用 `--color-warning-text` 加 700；TM 模式字色改成 class，TM 用 `--color-accent-text`、其他模式用 `--color-success-text`。

### 5.7 分段控制

- `.tabs`／`.tab`、`.tabs--inline`、`.mode-toggle` 改成蘋果分段控制：軌道 `--color-bg-tertiary`，選中塊 `--color-bg-raised`＋`--shadow-sm`，`--radius-md`，文字 600、`--color-text-primary`。
- 鍵盤操作與 ARIA 沿用現有實作，不改 JS 行為。

### 5.8 對話框（原生 `<dialog>`）

- `--color-bg-card`、`--radius-dialog`、`--shadow-md`。`::backdrop` 保留 `blur(4px)`，遮罩色用 `--color-backdrop`。
- 焦點管理不變。

### 5.9 理論值面板、結果項目與結果色塊

- **理論值面板**：`.info-panel` 容器 2 處（`index.html:268,310`），連同 `info-panel-*` 子元素共 67 個 class 用到。容器改成 `--color-bg-tertiary` 底、`--radius-lg`、無邊框；數值用 `--font-body`＋`tabular-nums`＋600。`.info-panel--success`／`--warning` 改用對應的 `-bg`。
- **資料來源膠囊**（`.info-panel-chip`：序列預測／手動／Guinier 實測）：`--radius-pill`，`--color-accent-tint` 底配 `--color-accent-text` 字；`--measured` 改用 success 那組。
- **結果項目**（`.result-grid`／`.result-item`／`.result-label`／`.result-value`／`.result-note`，蛋白質、SAXS、樣品、分子量、離心各頁與 dn/dc 各頁都用）：
  - `.result-item`：`--color-bg-tertiary` 底、`--radius-sm`，拿掉左側色條。
  - `.result-value`：從 `--font-mono` 改成 `--font-body`＋`tabular-nums`＋600，大小不變。
  - 行內 `<span style="font-size: 0.75rem;">` 單位樣式保留到 v5.1 改寫時再換成 class（不含顏色，不違反 §3.3 規則 5）。
- **結果色塊**：`.gradient-stat`（HPLC 頁 6 處）、`.result-card` 家族、`.stat-card`：拿掉漸層與色條，改成白色磚（也就是 v5.1 `.tile` 的前身），數值用 `--color-accent-text`。

### 5.10 字型與排版

- `html { font-size: 17px }` 不變。
- Google Fonts 連結保留 Inter、Noto Sans TC、JetBrains Mono，給沒有 SF 的系統當後備。瀏覽器只在真的用到某字型時才下載，Mac 上會先用 SF 與蘋方，不會下載 Inter 和 Noto。
- 新增 utility `.num { font-variant-numeric: tabular-nums; }`，用在結果值、輸入框、表格數字欄。`--font-mono` 只留給序列顯示、CSV 或檔案預覽、公式。
- 段落左右對齊（使用者全域排版規則，本站目前完全沒有實作）：`:where(p, li, dd, blockquote, .alert, .modal-desc, .formula-note, .form-list-foot) { text-align: justify; }`。原本靠繼承置中的單行文字（空狀態、對話框訊息等）要補上明確的 `text-align: center`，實作時逐一盤點。
- `<html lang="zh-TW">` 不變。

## 6. 圖表

### 6.1 `js/chart-theme.js`（新檔）

**載入時機（重要）**：Chart.js 與三個外掛在 `<head>` 用 `defer` 載入（`index.html:31-42`），會在所有本地 script 執行完之後才執行。所以 `chart-theme.js` 載入時 `Chart` 還不存在：
- 頂層只定義常數與函式，不得碰 `Chart`、`document`、`window.matchMedia`（`tests/load.js` 也會在 Node 裡載入用到它的檔）。
- 不做全域 `Chart.register`。白底外掛由 `colorize` 放進每張圖的 `plugins: [...]`。
- 所有用到 `Chart` 的地方都在呼叫時才取用，並先檢查 `typeof Chart === 'function'`（同 `liposome-charts.js:45` 的做法）。
- 在 `index.html` 裡排在所有建立或匯出圖表的本地檔之前（`charts.js`、`dndc-charts.js`、`dndc-astra-ui.js`、`dndc-hplc-results.js`、`liposome-charts.js`、`dndc-export.js`）。

**色表**：`ChartTheme.PALETTES = Object.freeze({ light, dark })`，取代 `CHART_COLORS`、`DNDC_CHART_COLORS`、`LIPO_CHART_COLORS` 三份色表。依用途命名：

| 用途 | 淺色 | 深色 | 對卡片（淺／深） | 現在用在 |
|---|---|---|---|---|
| `text` | #636366 | #A1A1A6 | 6.0 ／ 6.5 | 軸標、圖例 |
| `grid` | rgba(0,0,0,0.08) | rgba(255,255,255,0.10) | 豁免（裝飾） | 格線 |
| `surface` | #FFFFFF | #1E1E21 | — | 圓餅圖扇區分隔線（= 卡片色） |
| `primary` | #F04E4E | #F06464 | 3.6 ／ 5.3 | 樣品主線、UV 通道、散佈點、胺基酸組成長條 |
| `reference` | #636366 | #A1A1A6 | 6.0 ／ 6.5 | 參考或空白曲線、圓餅圖「Others」 |
| `model` | #047857 | #5BD68A | 5.5 ／ 9.1 | 擬合模型線、RI 通道 |
| `residual` | #B45309 | #F5B754 | 5.0 ／ 9.3 | 殘差、基線標註 |
| `fit` | #B91C1C | #F58A8A | 6.5 ／ 7.0 | dn/dc 擬合線 |
| `region` | rgba(240,78,78,0.08) | rgba(240,100,100,0.14) | 豁免（填色） | 峰區、q 視窗 |
| `marker` | #C27A7A | rgba(238,144,144,0.6) | 3.3 ／ 3.4（疊在卡片後） | 讀值波長的垂直線（現況 rgba(168,85,85,0.55) 在白底只有 2.3:1） |
| `tooltipBg`／`tooltipText` | rgba(29,29,31,0.92)／#FFFFFF | #2C2C2E／#F5F5F7 | — | 提示框 |
| `series[0..9]` | 實作時定 | 實作時定 | 每色 ≥ 3 | 多偵測器通道、胺基酸組成圓餅圖前 10 名 |

- `series` 的要求：兩個主題各 10 色；每色對卡片至少 3:1；相鄰色在常見色覺差異下仍可分辨；實作時用 dataviz skill 的驗證工具選定。它取代 `dndc-hplc-results.js`、`dndc-astra-ui.js` 的 8–10 色陣列（其中幾個淺粉色，例如 rgba(232,182,182)，對白底不到 3:1），以及 `charts.js` 圓餅圖（約 59–108 行）的 oklch 色相輪。圓餅圖第 11 片「Others」用 `reference`，扇區分隔線從寫死的 `#ffffff` 改用 `surface`。
- 字型：`ChartTheme.FONT`（系統字 stack）、`ChartTheme.MONO`。

**API**：
- `ChartTheme.resolved()` → `'light' | 'dark'`：先讀 `data-theme`，沒有就看 `matchMedia`（呼叫時才讀）。
- `ChartTheme.palette(name = resolved())`。
- `ChartTheme.colorize(config)`：回傳上好色、加上白底外掛的新 config，建立圖表前用。
- `ChartTheme.applyTo(chart, name = resolved())`：替既有實例換色後執行 `chart.update('none')`。
- 兩者共用一個純函式 `colorAssignments(structure, palette)`，回傳「路徑 → 顏色」清單（例如 `data.datasets[2].borderColor`、`options.scales.yUv.ticks.color`）。`colorize` 把清單套到 config 的深拷貝上；`applyTo` 把清單逐一寫進 `chart.data`／`chart.options` 的**葉節點**，絕不替換整個 `options` 物件，zoom 外掛的範圍才不會被重設。Chart.js 的更新 API 必須直接改實例，因此修改只發生在 `applyTo` 裡。

**用途標記**：建立圖表時，dataset 加 `tpsRole: 'primary'` 這類屬性（多通道用 `tpsSeries: i`），帶顏色的座標軸（dn/dc 的 UV、RI 軸）在 scale options 加 `tpsRole`，annotation 項目也加 `tpsRole`。`colorAssignments` 只依這些標記決定顏色。

**主題切換**：由 `app.js` 的 `DOMContentLoaded` 區塊呼叫 `ChartTheme.init()` 註冊 `tps:themechange` 監聽（此時 defer 的 Chart.js 已執行）。事件觸發時走訪 `Chart.instances`（Chart.js 4 自己維護的存活實例表）對每個實例執行 `applyTo`。不重建圖表，所以 zoom 範圍保留。實作時先確認 4.5.1 有 `Chart.instances`；沒有的話改成在 `ChartTheme` 內建登記表，並在 destroy 時移除。

**非圖表的通道標籤**：`dndc-hplc-results.js`（約 160 行）的通道切換 `<label>` 膠囊目前用 `color.replace('0.85','0.1')` 從圖表色推出底色，換成 hex 色表後會失效，而且不是圖表、不會被 `applyTo` 換色。改成：JS 在執行時用 `style.setProperty('--chip-color', palette.series[i])` 設定（原始碼裡沒有色碼字面值），CSS 用 `color-mix(in srgb, var(--chip-color) 12%, transparent)` 當底色，並在它前一行先宣告 `background: var(--color-bg-tertiary)` 當後備（`color-mix()` 需要 Chrome 111、Safari 16.2、Firefox 113 以上，不支援的瀏覽器會忽略該行、沿用後備）；監聽 `tps:themechange` 重設。

### 6.2 匯出 PNG

- `downloadChartPng(chart, filename)`（`dndc-export.js`，脂質體頁也用）簽名不變，內部改由 `ChartTheme.exportPng(chart)` 取得 data URL：
  1. 如果目前是深色，先 `applyTo(chart, 'light')`。
  2. 打開白底外掛的旗標（在 `beforeDraw` 填 `#FFFFFF`）。
  3. `chart.update('none')`，再 `chart.toBase64Image('image/png', 1)`。
  4. 關掉旗標，換回原主題的顏色，`update('none')`。
  5. 第 1–4 步在同一個同步段落完成，中間不讓出主執行緒，瀏覽器不會中途重繪，畫面不會閃。用 `try/finally` 保證一定還原。
- 淺色模式下匯出也加白底，修正目前 PNG 背景透明的問題（貼到深色投影片上看不見軸線）。
- 匯出尺寸、檔名不變。

### 6.3 外觀

- 只留水平格線；線寬 2px；除散佈圖外 `pointRadius: 0`；圖例 12px；提示框圓角 8px、內距 10px。
- zoom 的重設按鈕用次要按鈕樣式。

## 7. 結果磚（v5.1）

### 7.1 元件

- `.tiles`：2 欄 grid，≤640px 改 1 欄，gap 10px。
- `.tile`：`--color-bg-card`、`--radius-xl`、內距 14px 16px、無邊框。內含：
  - `.tile-label`：12.5px、600、`--color-text-muted`
  - `.tile-value`：32px、600、`tabular-nums`、字距 -0.025em
  - `.tile-unit`：14px、`--color-text-muted`
  - `.tile-sub`：12.5px、`--color-text-muted`，只放該結果原本就有的附註（例如方法說明）
- `.tile--hero`：跨 2 欄，數值 46px、`--color-accent-text`。可帶狀態膠囊 `.tile-chip--ok`／`--warn`／`--error`（對應語意色的 `-bg` 加 `-text`）。
- 次要數值放在磚下方，用 `.form-list` 樣式的唯讀列表。
- **缺值占位符沿用現況**（例如 `section-saxs.js` 的 `-`、HPLC 預設的 `--`），不改成「—」，磚的高度維持不變。
- 結果容器要有 `aria-live="polite"`（現況沒有的補上）。磚的 label 在 DOM 裡排在數值前面，螢幕閱讀器會讀成「標籤，數值 單位」。

### 7.2 各頁主角

**原則**：磚只重新排列頁面上已經顯示的數字，數字、位數、單位、占位符都照舊。主角只是把現有的某一個結果放大。

| 頁面 | 主角 | 其他磚 |
|---|---|---|
| 蛋白質分析 | 分子量 | 消光係數、dn/dc、乾燥體積、電子數 |
| SAXS 結構參數 | 現有「MW 比較」所用的 MW（依現有順序取第一個有值的：Porod → *I*(0) Guinier → *I*(0) *P*(*r*)），標籤註明來源，格式照舊（`toFixed(0)` Da）。有序列 MW 時，帶狀態膠囊：文字是現有的比值（例如 `I(0) Guinier / 序列 = 1.00`），ok／warn 判定沿用現有的 20% 門檻與 ✓／⚠️ 文字。三者都沒有值時不顯示主角磚 | *R*g、*I*(0)（Guinier 與 *P*(*r*)）、*D*max、Porod volume、其餘 MW、波長、濃度 |
| HPLC-SAXS 設定 | Fraction 收集時段 Start → Stop (min) | Time/Fraction；pre-run 三個建議值 |
| 樣品計算 | 濃度 (mg/mL) | 濃度 (μM)、吸光值、DF、On-column 濃度 |
| 分子量解析度 | 預期滯留時間（正算）／估算分子量（反算） | 質量解析度 |
| 離心參數 | RCF (× g)（現況已用色條標成主要結果） | 沉降係數、粒子半徑、終端速度、移動距離 |
| 偵測器距離 | 建議 9M 距離 (mm)，超出行程時帶現有的警告 | 理論 *R*g（MW 模式）或預測 MW（Rg 模式）、*q*min；*q*·*R*g 維持在警告文字裡 |
| 脂質體 DOX 載藥 | D/L ± 誤差 | 稀釋因子、[DOX]、資料品質標記 |
| dn/dc 理論計算 | 校正後 dn/dc | 中間值 |
| HPLC dn/dc | dn/dc | 中間值 |
| 多注射擬合 | dn/dc | R² 等現有數字 |
| Slice-by-slice | dn/dc 平均 | ± SD 等現有數字 |
| IUCr 表格 | 不設主角（表格頁） | — |

### 7.3 改動範圍

- 改寫各頁的結果 HTML 產生函式（`section-*.js`、`dndc-*-ui.js`、`dndc-*-results.js`，以及 `section-liposome.js` 的結果區），改輸出 `.tiles` 結構。
- 計算函式、數值格式化（`toFixed` 位數、千分位）、元素 id 一律不變。
- 脂質體頁的結果表與 IUCr 表不改成磚。

## 8. 測試與驗證

### 8.1 新增的 node:test 測試

1. `tests/contrast.test.js`
   - 解析 `tokens.css` 的 `:root` 與兩個深色區塊，斷言兩個深色區塊逐字相同。
   - 依下列矩陣算對比（半透明色先疊在指定底色上），兩個主題都測：
     - 文字 4.5：`--color-text-primary`／`-secondary`／`-muted`、`--color-accent-text` × 卡片、頁面、tertiary、hover、側欄實色、側欄毛玻璃疊頁面。
     - 文字 4.5：`--color-accent-text` × `--color-accent-tint` 疊卡片、疊 tertiary。
     - 文字 4.5：各語意色 `-text` × 自己的 `-bg`、卡片。
     - 文字 4.5：`--color-text-on-accent` × `--color-accent-primary`、`--color-accent-primary-hover`、`--color-danger`。
     - 文字 4.5：`--color-text-primary` × `--color-bg-raised`。
     - 文字 4.5：`--color-success-text`、`--color-accent-text`、`--color-warning-text` × `--color-warning-bg`（HPLC 流速表主步驟列，§5.6；這是規則 4 唯一的例外，已列入矩陣）。
     - 元件 3：`--color-accent-primary`、`--color-accent-primary-hover`、`--color-focus` × 卡片、頁面、側欄實色。
     - 元件 3：`--color-danger`、`--color-success`、`--color-warning` × 卡片（語意填色只出現在卡片內；淺色 `--color-warning` 對頁面只有 2.9:1，不得直接放在頁面底上）。
   - `ChartTheme.PALETTES`：`text`、`primary`、`reference`、`model`、`residual`、`fit`、`marker`、`series[*]` 疊在卡片後 ≥ 3（`text` ≥ 4.5）；`grid`、`region`、`surface`、`tooltip*` 豁免。
2. `tests/token-usage.test.js`（用途測試）：
   - CSS 的 `color:`、`-webkit-text-fill-color:` 宣告，JS 的 `style.color =`、`style.setProperty('color', …)`，以及 `index.html` 與 JS 模板字串裡 `style="…color: …"` 的行內宣告，只能用文字 token（`--color-text-*`、`--color-accent-text`、`--color-*-text`、`--color-text-on-accent`）或 `inherit`／`currentColor`。
   - `--color-text-on-accent` 只能出現在背景是 §3.3 規則 3 那三個 token 的規則裡（依選擇器人工對照清單維護）。
3. `tests/no-color-literals.test.js`：去掉註解後，`css/*.css`（不含 `tokens.css`）、`js/*.js`（不含 `chart-theme.js`）、`index.html` 不得出現 `#hex`、`rgb(`、`rgba(`、`hsl(`、`oklch(`。允許 `transparent`、`currentColor`、`inherit`。
4. `tests/theme.test.js`
   - `ThemeInit.normalize` 對各種輸入的結果；在沒有 `document` 的 Node 環境載入不會丟例外。
   - 生效主題的判斷：手動優先，自動跟系統。
   - `colorAssignments`：用 stub 結構，檢查 dataset、scale、annotation 依 `tpsRole` 上色，series 依 `tpsSeries` 上色，圓餅圖 Others 用 `reference`。
   - `applyTo`：只改葉節點，`chart.options` 物件本身的參照不變。
   - `exportPng`：深色模式下的呼叫順序是「換淺色 → 白底 → 取圖 → 還原」；中途丟例外也會還原。
5. `structure.test.js` 增修
   - `theme-init.js` 是 `<head>` 裡唯一的本地 script，也是唯一沒有 `defer` 的 script，且排在所有 stylesheet 之前。
   - `chart-theme.js` 排在所有建立或匯出圖表的本地檔之前。
   - 新檔一樣受 800 行上限約束。
   - 若 §9.1 的 `?v=` 已上線，所有以 `SCRIPT_REFS` 比對路徑的測試都要先去掉查詢字串（§9.1 會先處理既有測試，這裡的新測試照做）。
6. 既有 159 個測試全過。`liposome-section.test.js` 的 stub DOM 若依賴 class 名稱，跟著更新，但斷言的意義不變。

### 8.2 v5.0：標記不變測試

改版前用腳本列出 `index.html` 所有 `id`、`for`、`aria-*`、`data-section`，存成 fixture。改版後的集合必須相同，只允許新增主題切換控制的屬性。v5.1 會補上 `aria-live`，屆時更新 fixture 並在 commit 訊息說明。

### 8.3 v5.1：數值不變測試（golden values）

- 改寫結果產生函式之前，每一頁用固定輸入（BSA 等公開範例）在 stub DOM 執行一次，擷取所有顯示的數字與占位符（含單位與位數），依標籤存成 fixture。
- 改寫後用同樣輸入擷取，結果必須一字不差。
- fixture 只用合成或公開範例輸入，可以進公開 repo。

### 8.4 瀏覽器驗收（每階段都做）

- 13 頁 × 淺色／深色 × 桌機寬（1440px）與 1024px 以下（漢堡選單），逐一截圖。
- console 沒有錯誤；axe-core 在兩種主題下每頁 0 違規。
- 鍵盤：主題切換（方向鍵）、導覽、分段控制、對話框焦點。Chrome 工具在背景分頁收不到按鍵，這項要在可見分頁驗證。
- 自動模式：切換 macOS 外觀，頁面、圖表與 HPLC 通道標籤都要跟著變。
- 匯出 PNG：在深色模式匯出，檔案是淺色白底；匯出後畫面仍是深色，zoom 範圍不變。
- 切換主題時，已放大的圖表維持放大範圍。

## 9. 上線

### 9.1 前置：靜態資源版本查詢（屬待辦批次）

- `index.html` 引用的所有本地 `css/*.css`、`js/*.js` 都加 `?v=<版本>`，每次 bump 版本時一起更新。
- 必須在 v5.0 之前上線。Pages 設 `max-age=600`，沒有版本查詢的話，v5.0 上線後 10 分鐘內會有人拿到新 HTML 配舊 CSS。
- 細節（包括 `structure.test.js` 以 `SCRIPT_REFS` 比對路徑的所有測試要去掉查詢字串）寫在待辦批次規格。

### 9.2 v5.0

- 內容：§3–§6。`CLAUDE.md` 的 Design Context 與 `tokens.css` 在同一個 commit 改。
- 版本號 v5.0。獨立一份實作計畫。

### 9.3 v5.1

- 內容：§7。版本號 v5.1。v5.0 上線並經使用者確認後，再寫這一份實作計畫。

### 9.4 流程（沿用 2026-08 約定）

規格 → 計畫 → `saxs-frontend` 實作（可分組平行）→ `code-reviewer` 審 diff（v5.1 另請 `ui-designer` 看截圖）→ 主 session 跑 node 測試與 Chrome 驗收 → commit → bump 版本 → push → 等 Pages 出現新版本號。

出問題時 `git revert` 該階段的 commit，bump 版本後推上。

## 10. CLAUDE.md Design Context 改寫要點

- Theme：淺色＋深色（跟隨系統＋手動），刪除「no dark mode」。
- 色值換成 §3.1。hover 規則改成「淺色變暗、深色變亮」，並附 §3.3 的理由。
- 新增：`--color-accent-primary` 與語意填色只當填色；珊瑚色文字一律 `--color-accent-text`。
- Visual effects：毛玻璃只用在側欄與對話框遮罩；卡片無邊框，用細邊陰影；不加左側色條；圓角 8／10／12／14／18。
- Typography：系統字 stack；數值用 `tabular-nums`；mono 只給序列與檔案預覽；段落左右對齊。
- Contrast rule：兩個主題都要，並指向 `tests/contrast.test.js`、`tests/token-usage.test.js`。
- 新增：色碼只能出現在 `tokens.css` 與 `chart-theme.js`。
- 新增：本地 script 執行時 Chart.js 尚未載入（CDN 是 `defer`），用到 `Chart` 一律在呼叫時取用。

## 11. 風險

| 風險 | 對策 |
|---|---|
| 改 `index.html` 標記時誤動 id，JS 失效 | §8.2 標記不變測試 |
| 改寫結果產生函式時數字或占位符變了 | §8.3 golden values |
| 深色模式漏掉寫死的顏色 | §8.1 色碼字面值測試 |
| 填色 token 被當文字用，深色下對比不足 | §3.2 依用途改名＋§8.1 用途測試 |
| `chart-theme.js` 頂層碰到尚未載入的 `Chart` | §6.1 載入時機規則；`theme.test.js` 在 Node 載入 |
| 遠端桌面壓縮讓白卡邊界消失 | `--shadow-sm` 細邊；驗收時請使用者在光束線電腦經遠端桌面看一次 |
| 光束線電腦是 Windows 或 Linux，沒有 SF | 後備為 Inter＋Noto（現況字型）；驗收時用 Inter 寬度檢查一次版面 |
| 毛玻璃在舊瀏覽器或遠端桌面上效能差 | 不支援或要求減少透明度時改實色（§3.4） |
| 從深色模式列印，淺色字印在白紙上 | 深色區塊限定 `screen`（§3.4） |
| 就地換色漏掉某些圖表選項（annotation 標籤等） | §8.1 的 stub 測試涵蓋每種用途；深色圖表逐張截圖 |

## 12. 開放事項

- 光束線電腦的作業系統（決定實際顯示的字型）：驗收時請使用者在光束線電腦開一次。
- 離心頁、HPLC 頁的主角是提案，v5.1 動工前可再改。
