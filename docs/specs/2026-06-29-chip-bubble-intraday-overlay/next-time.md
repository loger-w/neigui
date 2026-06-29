# Intraday Overlay — Next-time backlog

From Phase 5 code review(workflow `wc2wlfiym`, 20/23 verified findings)
未在本次 /mod 處理的 P2/P3 — 留待下次 /refactor 或機緣巧合一起做。

## 已採納本次處理(reference,已 commit)
- P1-1 `App.tsx:186-191` refresh handler 加 `intradayHook.refresh()`(全 hook refresh 一起跑紀律)
- P2-2 `intraday-line-svg.tsx` polyline 加 `if (p.price < yLow || p.price > yHigh) continue;` clip 出界點
- P3-7 `App.tsx` `useChipIntraday(tab === "bubble" ? symbol : "", date)` 跳過 overview tab fetch
- P3-12 `services/finmind.py` 移除 `if "minute" in r and "close" in r` over-defensive filter

## 沉澱 — 下次 /refactor 處理

### 視覺 / 主題集中
- **F-P3-9** `intraday-line-svg.tsx:15-16` `STROKE = "#7c6f55"` → 移到 `chip-theme.ts` 加 `CHIP.intradayLine`,集中色票
- **F-P3-8/8b** `chip-bubble-svg.tsx:429` 註解 z-order 改成一致版:`grid → time-line → close-dashed → bubbles`(commit b33e3b1 wording 同步)

### 命名 / 微簡化
- **F-P3-14** `chip-bubble-svg.tsx:437` `chartWidth={width - PADDING.left - PADDING.right}` → `chartWidth={cW}`(local 已算)
- **F-P3-15** `intraday-line-svg.tsx:12-13` `SESSION_START_MIN` / `SESSION_RANGE_MIN` 去掉 `export`(目前無外部消費者),test 跟著移除常數 tautology assertion
- **F-P3-10** `intraday-line-svg.tsx` rename → `chip-intraday-line-svg.tsx`(對齊既有 `chip-*-svg.tsx` 命名),`interface Props` → `export interface IntradayLineLayerProps`
- **F-P3-13** `chip-bubble-svg.tsx:430` 外層改 `{intradayPoints && <IntradayLineLayer ... />}`(去掉 `length > 0`,讓子元件自己 guard)

### 測試補強
- **F-P2-4** `test_finmind.py` 補 `test_fetch_chip_intraday_today_cache_refetches_when_stale`(mirror `fetch_chip_history` 既有 paired test 樣板)
- **F-P3-16** `chip-bubble-svg.test.tsx` 加 `selectedBroker + intradayPoints` combined-case 鎖 F2 fallback Y 軸來源(broker 觸發 axes 從 broker 自己 trades 算時,intraday line 仍用對的 Y range)
- **F-P3-17** `test_finmind.py` 加 `test_fetch_chip_intraday_raises_on_upstream_failure`(pytest.raises httpx error)
- **F-P3-18** `test_chip_routes.py:151-158` 把 default-date case 強化:`assert call.args[1] == date.today().isoformat()` 鎖住 `_today()` 路徑
- **F-P3-19** `useChipIntraday.test.ts` 加 date-change rerender 測試(複用 `useChipData.test.ts` pattern)
- **F-P3-20** `useChipIntraday.test.ts` 加 `forceRefreshRef` reset 測試(refresh 後第二次 refetch 應送 `force=false`)

### 已併入 P3-12 自然取消
- ~~F-P2-1 為 `if "minute" in r and "close" in r` filter 補測試~~ — filter 已移除,不需測試。
