## Design Context

### Users
Beamline scientists at NSRRC operating the TPS 13A BioSAXS beamline. They use this tool during active experiments to quickly calculate SAXS parameters, estimate protein properties, and verify experimental settings. Speed and accuracy are critical — they need reliable answers without second-guessing the tool.

### Brand Personality
**Modern, Helpful, Smart** — A friendly yet technically competent scientific tool. It should feel like a capable assistant that understands the domain, not a cold instrument panel or a toy.

### Aesthetic Direction
> 2026-08-21 v4.6「muted coral」(palette C)。上一版 v4.4 coral-to-ice 的亮 coral 白字只有 3.6:1，使用者要求整體柔和；改動配色時請同步更新本節與 `css/styles.css` 的 `:root` tokens。

- **Theme:** Light "Precision Editorial" — ice blue-gray page background (#E5E9EB), white cards (#ffffff), no dark mode
- **Primary accent:** Muted coral (#A85555) — solid sidebar background, primary buttons, gradient panels (#A85555 → #8F4646); white text on it is 5.1:1. Hover goes one step **darker** (#8F4646), never lighter
- **Accent text on light surfaces:** #A83737 (6.4:1 on white) for values, card-title modifiers; #902F2F for info alerts on tinted backgrounds. Bright brand coral #F04E4E survives only as `--color-accent-brand` for chart lines
- **Secondary accents:** Emerald (#10b981) fills / #047857 text, Amber #f59e0b fills only — amber **text** is #92400e, amber panels #b45309 → #92400e; Red (#dc2626) for errors
- **Text:** Deep warm slate, never pure black — primary #1a1a2e, secondary #3d3d5c, muted #5a5a78; sidebar nav is pure white at 0.9375rem (≈16px) with a 3px white inset bar on the active item
- **Typography:** Inter + Noto Sans TC for UI text (Google Fonts), JetBrains Mono with `tabular-nums` for scientific values and sequences; `html { font-size: 17px }`
- **Icons:** No decorative icon system (scientific emoji removed in 6697dd9). A few functional glyphs remain in index.html/app.js (🔒/🔓 lock, 📥 export ×3, ☰ menu, 📊 📡 💡 🔍 🖼 section markers) — don't add new ones; removing the remaining section markers is an open cleanup item
- **Visual effects:** Flat cards with 1px borders (#d4d8dc) and 3/6/8px radii; coral-tinted shadows (rgba(168,85,85,…)); fast transitions (120/200ms ease-out); `backdrop-filter: blur(4px)` only on the modal overlay — no glassmorphism on cards, no hover lifts
- **Layout:** Fixed 240px sidebar (collapsible to 56px, state persisted), 4px spacing scale
- **Contrast rule:** every text/background pair ≥ 4.5:1 (UI components ≥ 3:1). Never put white text on a tint lighter than #A85555; never use #f59e0b / #10b981 / #F04E4E as text
- **Anti-references:** Avoid looking like a generic dashboard template, overly playful consumer apps, or cluttered legacy lab software

### Design Principles

1. **Clarity over decoration** — Every visual element must serve comprehension. Scientific data should be immediately readable with clear hierarchy: labels, values (monospace), and units.

2. **Trust through precision** — Use consistent spacing (8px base), aligned grids, and predictable patterns. Sloppy layout undermines confidence in calculations.

3. **Speed of use** — Optimize for fast input-to-result workflows. Minimize clicks, keep related fields visible together, use smart defaults. Scientists are working under time pressure at the beamline.

4. **Accessible by default** — WCAG AA compliance. High-contrast slate text on light surfaces (≥4.5:1 for body text, ≥3:1 for large text and UI components — check coral #F04E4E before using it for text), proper form labels, semantic HTML. Must stay readable in dim experimental hutches and over remote desktop.

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
- 修改 dndc calculator 後，必須執行 `cd "dndc calculator" && .venv_mac/bin/python -m pytest -q`（py3.9 venv；基準 2026-08-21：194 passed / 27 xfailed / 0 failed）。xfail 是以 `xfail(strict=True)` 鎖定的已知 bug——修好一個會變成 XPASS 失敗，此時移除該測試的 xfail 標記，不要改期望值
- 不要說「應該可以」或「看起來沒問題」，要跑過才算

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
