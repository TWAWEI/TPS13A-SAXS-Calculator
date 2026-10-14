## Design Context

### Users
Beamline scientists at NSRRC operating the TPS 13A BioSAXS beamline. They use this tool during active experiments to quickly calculate SAXS parameters, estimate protein properties, and verify experimental settings. Speed and accuracy are critical — they need reliable answers without second-guessing the tool.

### Brand Personality
**Modern, Helpful, Smart** — A friendly yet technically competent scientific tool. It should feel like a capable assistant that understands the domain, not a cold instrument panel or a toy.

### Aesthetic Direction
> 2026-10 v5.0 Apple-style redesign（規格 `docs/superpowers/specs/2026-10-14-apple-redesign-design.md`）：macOS 原生骨架（毛玻璃側欄、分組圓角輸入列、系統字）＋ muted coral 強調色，淺色與深色兩個主題；v5.1 分子量改 kDa（規格 `docs/superpowers/specs/2026-10-15-kda-units-design.md`）；v5.2 再加大數字結果磚。改動配色時同步更新本節、`css/tokens.css` 與 `js/chart-theme.js`。

- **Theme:** Light + dark. Follows the system (`prefers-color-scheme`) with a manual 自動／淺色／深色 control in the sidebar (localStorage `tps13a-theme`). `js/theme-init.js` sets `<html data-theme>` synchronously in `<head>`, before any stylesheet. Dark tokens live in two byte-identical blocks (`:root:not([data-theme="light"])` and `:root[data-theme="dark"]`), both inside `@media screen`, so printing always uses the light values
- **Surfaces:** page #F5F5F7 / #121214; cards #FFFFFF / #1E1E21, borderless with the `--shadow-sm` 0.5px hairline; tertiary #F0F0F3 / #2A2A2E for inputs, info panels, result items, secondary buttons and segmented-control tracks. Tiles that sit inside a card use tertiary (never white on white)
- **Accent:** Muted coral #A85555. `--color-accent-primary` / `-hover` are **fills only** (primary buttons, the selected nav pill). Hover goes darker in light (#8F4646) and lighter in dark (#B05A5A) — darkening in dark mode would drop the button to 2.5:1 against the card. Coral **text** is always `--color-accent-text` (#A83737 / #EE9090)
- **Semantic colours:** success / warning / danger each have a fill, a `-text` and a `-bg` token. Text uses only the `-text` token, on its own `-bg`, a card, or tertiary
- **Text:** primary #1D1D1F / #F5F5F7, secondary #424245 / #D1D1D6, muted #636366 / #A1A1A6 (Apple's #6E6E73 is only 4.2:1 on input backgrounds). Sidebar nav stays 0.9375rem (≈16px, requested 2026-08)
- **Typography:** System font stack (-apple-system / SF Pro / PingFang TC, falling back to Inter + Noto Sans TC from Google Fonts); numbers use `tabular-nums`; JetBrains Mono only for sequences, file previews and formula notes; multi-line prose is justified by the zero-specificity `:where(...)` rule in `tokens.css`; `html { font-size: 17px }`
- **Units (v5.1):** Molecular mass is kDa everywhere on screen — inputs and results, 2 decimals (`MassUnits.formatKDa`); the only Da value left is the exact mass under the protein page's MW. Calculations and the Excel parity tests stay in Da; convert only through `js/mass-units.js` (`kDaToDa` on read, `writeInput` for auto-fill). Formula notes whose coefficients assume Da say「MW 以 Da 代入」. Guarded by `tests/mass-units.test.js`
- **Icons:** No decorative icon system (scientific emoji removed in 6697dd9; section markers and export-button emoji removed in batch 3, 2026-08-22). Only state/semantic glyphs remain: 🔒/🔓 lock state, ☰ menu, ⚠️/✓ in result text — don't add new ones
- **Visual effects:** Frosted glass only on the sidebar (solid `--color-bg-sidebar` when unsupported or with reduced transparency) and the dialog backdrop; no left accent bars, no gradients, no hover lifts; radii 8 / 10 / 12 / 14 (dialog) / 18 (v5.2 tiles); fast transitions (120/200ms ease-out)
- **Charts:** All colours come from `js/chart-theme.js`. Chart files only tag datasets / scales / annotations with `tpsRole` or `tpsSeries` and create charts with `new Chart(canvas, ChartTheme.colorize(config))`. A theme change recolours live charts in place (zoom is kept); PNG export is always light on white. The series palette has 8 colours (dataviz-validated); the doughnut shows the top 7 + Others; channels beyond 8 reuse a colour with a dashed line. Coloured axes colour only the axis line — tick labels and titles stay in the text colour
- **Layout:** Fixed 240px sidebar (collapsible to 56px, state persisted), 4px spacing scale
- **Contrast rule:** Both themes: text ≥ 4.5:1, UI components ≥ 3:1 — `tests/contrast.test.js`. Fill tokens are never text and there are no left bars — `tests/token-usage.test.js`. Colour literals may appear only in `css/tokens.css` and `js/chart-theme.js` — `tests/no-color-literals.test.js`
- **Chart.js load order:** The CDN scripts are `defer`, so `Chart` does not exist while local scripts run; touch `Chart` only at call time
- **Anti-references:** Avoid looking like a generic dashboard template, overly playful consumer apps, or cluttered legacy lab software

### Design Principles

1. **Clarity over decoration** — Every visual element must serve comprehension. Scientific data should be immediately readable with clear hierarchy: labels, values (tabular figures), and units.

2. **Trust through precision** — Use consistent spacing (8px base), aligned grids, and predictable patterns. Sloppy layout undermines confidence in calculations.

3. **Speed of use** — Optimize for fast input-to-result workflows. Minimize clicks, keep related fields visible together, use smart defaults. Scientists are working under time pressure at the beamline.

4. **Accessible by default** — WCAG AA compliance in both themes (≥4.5:1 for body text, ≥3:1 for large text and UI components — enforced by `tests/contrast.test.js`), proper form labels, semantic HTML. Must stay readable in dim experimental hutches and over remote desktop.

5. **Progressive disclosure** — Show essential results prominently, keep advanced details available but not overwhelming. Use section organization and collapsible areas to manage complexity.

## Agent 工作流程

1. 新功能/需求變更 → 先決定影響 saxs-calculator 還是 dndc calculator
2. 涉及科學公式 → science-reviewer agent 審查
3. 前端 JS 變更 → saxs-frontend agent
4. Python 變更 → dndc-dev agent
5. UI/UX 改善 → ui-designer agent
6. 寫完程式碼 → qa agent 寫測試
7. saxs-frontend + dndc-dev 可平行開發

## 工作規範

### 驗證
- 修改 saxs-calculator 後，必須在瀏覽器開啟 index.html 確認無 console error
- 修改 dndc calculator 後，必須執行 `cd "dndc calculator" && .venv_mac/bin/python -m pytest -q`（py3.9 venv；基準 2026-10-14：349 passed / 0 xfailed / 0 failed）。xfail 是以 `xfail(strict=True)` 鎖定的已知 bug——修好一個會變成 XPASS 失敗，此時移除該測試的 xfail 標記，不要改期望值
- 不要說「應該可以」或「看起來沒問題」，要跑過才算
- 改 saxs-calculator 後 bump 版本：側欄 footer 的 `Version X.Y` 與 `index.html` 所有本地 `?v=` 一起改（`tests/structure.test.js` 會檢查兩者一致）

### 安全（saxs-calculator，2026-08-22 起）
- index.html 有 `<meta http-equiv="Content-Security-Policy">`：新增任何 CDN 來源、行內 `onclick`/`<script>`、外部 fetch 都會被擋——改用 `addEventListener`，外部來源要同時加進 CSP 對應指令
- CDN `<script>` 一律 exact-version 完整檔名 + `integrity="sha384-…"` + `crossorigin="anonymous"`（hash：`curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`）
- 任何來自 CSV／.afe7／使用者輸入的字串進 `innerHTML` 前必須過 `FormUtils.escapeHtml`（唯一實作，勿再複製）；SQLite 欄名只接受 `SAFE_IDENTIFIER` 白名單

### 檔案讀取
- 超過 500 行的檔案，分段讀取（offset + limit）
- saxs-calculator/index.html (98KB) 必須分段讀取
- 編輯前一律重新讀取目標檔案，不信任記憶

### 搜尋
- 搜尋結果被截斷時，縮小範圍重搜
- 不要假設搜尋結果是完整的

### 複雜任務
- 超過 5 個獨立檔案的變更，拆成子 Agent 平行處理
- 長對話主動使用 /compact 壓縮上下文
