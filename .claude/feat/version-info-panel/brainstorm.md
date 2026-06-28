# Brainstorm — version-info-panel

> 在 equity / options 兩個 mode 的 top bar 加版本資訊 badge + popover changelog,從 v0 起始;標註資料來源 FinMind;同時在 CLAUDE.md 建立「每次 bug/feat 要討論是否記為一版」工作慣例。

## Decisions(brainstorm 階段已敲定)

- **UI 形態**:Header badge + Popover(非 footer、非獨立 tab)
- **位置**:放 ModeSwitch 同列右側(top bar 全局),不污染 equity / options 各自 header,單一整合點兩個 tab 共用
- **資料形式**:純前端 TS 模組 `frontend/src/lib/changelog.ts`,無 backend endpoint、無 git log 自動產生
- **版本粒度**:整個 app 共用一個版本號(user 確認)
- **Popover 元件**:用既有依賴 `radix-ui` 1.6.0 的 Popover primitive
- **v0.1 起始**:本 feature 自身 + 既有近期主功能 summary

---

## 成功條件(SC,每條附驗證方式 — gate)

### SC-1 — 兩個 mode top bar 顯示 v0.x badge
- **內容**:`equity` 與 `options` mode 切換時,top bar 右側恆顯示 `v0.x` 文字 badge,色票走 `text-ink-muted` hover `text-accent`
- **驗證方式**:
  - `frontend && npm test -- src/components/VersionBadge.test.tsx` 中 `expect(screen.getByRole('button', { name: /版本資訊/ })).toBeInTheDocument()` + `expect(screen.getByText(/^v0\.\d+$/)).toBeInTheDocument()`
  - DevTools MCP `take_screenshot` 兩個 mode 都拍到 badge(`SC-1_equity-badge.png` / `SC-1_options-badge.png`)

### SC-2 — 點擊 badge 開 popover 顯示 changelog 與資料來源
- **內容**:點 badge → Radix Popover 開啟,內容含:版本標題、`資料來源: FinMind` chip、每個版本的日期 / highlights / 分組(features / fixes)/ scope 標(個股 / 選擇權 / 全局)
- **驗證方式**:
  - `vitest` 內 `await user.click(badge)` + `expect(screen.getByText('資料來源: FinMind')).toBeVisible()` + `expect(screen.getByText(/v0\.1/)).toBeVisible()`
  - DevTools MCP 截圖 popover 開啟狀態(`SC-2_popover-open.png`)

### SC-3 — changelog 至少有 v0.1 條目,含本 feature + 既有功能 summary
- **內容**:`CHANGELOG[0]` 為 `{ version: "0.1", date: "2026-06-29", changes: [...] }`,changes 內含「新增版本資訊面板」+ 至少 3 條近期已有功能(MAX PAIN / OI Walls / K-line Bollinger / N-day brokers window 任三項)
- **驗證方式**:
  - `vitest src/lib/changelog.test.ts` 內 `expect(CHANGELOG[0].version).toBe('0.1')` + `expect(CHANGELOG[0].changes.length).toBeGreaterThanOrEqual(4)` + `expect(CHANGELOG[0].changes.some(c => c.text.includes('版本資訊面板'))).toBe(true)`

### SC-4 — CLAUDE.md 新增「版本管理慣例」節
- **內容**:在「6. 提交慣例」之後新增節 `## 7. 版本管理慣例`,內容包含:何時累加 vs bump 的判準、提交訊息引用版本的格式、每次 commit/PR 前要 review changelog
- **驗證方式**:
  - `grep -n "版本管理慣例" CLAUDE.md` 必須回傳 1 行
  - `grep -E "累加|bump" CLAUDE.md | wc -l` ≥ 2

### SC-5 — CHANGELOG 倒序 + CURRENT_VERSION 正確 derive
- **內容**:`CHANGELOG` 陣列以日期 desc 排列(最新在前),`CURRENT_VERSION` export 等於 `CHANGELOG[0].version`,空陣列時 fallback `"0.0"`
- **驗證方式**:
  - `vitest src/lib/changelog.test.ts`:
    - `CHANGELOG` 兩兩 date 比較單調遞減
    - `CURRENT_VERSION === CHANGELOG[0]?.version ?? '0.0'`
    - Mock empty CHANGELOG fixture → CURRENT_VERSION === '0.0'

---

## Edge cases (≥ 3)

1. **CHANGELOG 為空**:CURRENT_VERSION fallback `"0.0"`,badge 仍 render(不 crash)
2. **Popover 內容過長**:`max-h-[60vh] overflow-y-auto`,長 changelog 不撐破畫面
3. **同版本 changes 陣列空**:render 「(無條目)」中性文字,不 render 空 `<ul>`
4. **鍵盤 a11y**:`Esc` 關閉 popover、`Tab` focus trap、`Enter/Space` 觸發 badge — 走 Radix Popover 內建
5. **Mode 切換時 popover 已開**:Popover 在 top bar 全局,切 mode 不關閉(設計刻意保留,因內容不依賴 mode)

---

## Out of Scope(不在這次做)

- 從 git log 自動 generate changelog
- Backend `/api/version` endpoint(無外部需求)
- Markdown 渲染 / rich text(純 plain text 即可)
- i18n / 英文 changelog(專案文案統一繁中)
- 版本間 diff 比較 / 「上次看到的版本」未讀標記
- 行動裝置 responsive 微調(本專案桌面為主)

---

## S/M/L 分流:**M**

- 新檔 4 個:`changelog.ts` / `changelog.test.ts` / `VersionBadge.tsx` / `VersionBadge.test.tsx`
- 改 2 個:`ModeSwitch.tsx`(去掉外層 chrome)/ `App.tsx`(包 top bar wrapper)
- 文件 1 個:`CLAUDE.md` 新增節
- 無 hot path / 安全邊界 / 對外 API / 鑑權 / 加密 / 金流 → 不升 L
- **Phase 1 / Phase 2 各 1 輪 review**(M 級規則)
