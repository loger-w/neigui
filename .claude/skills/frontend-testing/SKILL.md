---
name: frontend-testing
description: 前端 vitest / RTL 測試慣例。寫 component 或 hook 測試前先讀 — 含 vi.spyOn mock pattern、本專案沒裝 jest-dom/user-event 的替代寫法、RTL selector 陷阱、Radix Tabs jsdom 不可靠、TanStack Query error 終態測試。
---

# 前端測試慣例

- **Mock 一律 `vi.spyOn(optionsApi, "...").mockResolvedValue / mockRejectedValue`**,**不要**引入 MSW(專案沒裝)。Failure-isolation 測試在 `OptionsChipPanel.test.tsx` 用 `vi.spyOn` + `screen.getByText` 驗,不走 DevTools MCP。Trigger:寫 hook / component 測試時。
- **沒裝 `@testing-library/jest-dom` 也沒裝 `@testing-library/user-event`**。**禁止**用 `toBeInTheDocument()` / `toHaveTextContent()` / `userEvent.click()`,以 `ModeSwitch.test.tsx` 風格為標準:`expect(el).toBeTruthy()` / `expect(el).toBeNull()` / `el.textContent` / `el.getAttribute()` + `fireEvent.click(...)`。Trigger:寫新 component / hook 測試。
- **RTL `getByText(regex)` 撞多元素 = selector 過鬆,不是 Portal leak**。Radix Popover 內兩處含相同 substring 時寬鬆 regex 會 `getMultipleElementsFoundError`。修正:換更精確 substring(動詞前綴如 `/新增X/`)或 `within(container)` 收斂 scope,**不要**第一直覺加 `document.body.innerHTML = ""` afterEach hack(只在真有 portal 殘留時才必要)。Trigger:寫 Radix Popover / Dialog 元件測試,內容含 user-editable 文本。
- **Radix `Tabs` 在 jsdom + fireEvent.click 不可靠**:Tabs.Trigger 走 pointer events,fireEvent.click 不一定觸發 onValueChange;且 inactive `TabsContent` 不 forceMount = 內容不在 DOM。**不要**為了「對齊 Radix」而用,改寫成普通 `<button role="tab" aria-selected>` + 條件 render(`MarketLeaderboard.tsx` 是樣板)。Trigger:寫 jsdom 測試含 Tab 切換的元件。
- **TanStack Query v5 hook 的 `retry: 1` + `error` 終態測試**:default `retryDelay` 是 exponential backoff(初次 1s,二次 2s),`waitFor` default 1s timeout 抓不到 settle。error path test 必須給 `waitFor` timeout: 5000 或 mock cancelable promise。Trigger:寫 useQuery hook 的 error path test。
- **useContainerSize 多態渲染的 regression lock jsdom 測不到**(getBoundingClientRect 恆 0):用真 hook + polyfill ResizeObserver + stub `Element.prototype.getBoundingClientRect`,rerender loading→data 後 assert svg width(`MarketColdLoad.test.tsx` 是樣板)。詳見 skill `frontend-conventions` 的 useContainerSize 條目。Trigger:元件用 useContainerSize 且有 skeleton / 降級多態時。
- **@tanstack/react-virtual 在 jsdom 量測走 `offsetWidth/offsetHeight`,不是 getBoundingClientRect**(2026-07-21 mod/batch-ui-polish 實證):stub getBoundingClientRect 無效、虛擬列恆 0 筆;要出列改 `Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 })`(offsetWidth 同)+ 測後還原 descriptor(`ChipBubbleView.test.tsx` TradeList 格式測試是樣板)。Trigger:要 assert 虛擬化列表(TradeList 等)列內容時。
