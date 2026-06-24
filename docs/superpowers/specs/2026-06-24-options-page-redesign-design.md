# 選擇權籌碼頁 Redesign 設計規格

> 日期: 2026-06-24 · 狀態: 草案(待 user review)
> 取代:`2026-06-23-options-chip-design.md` 中 §3.2 / §3.5 / §3.6 / §3.7 的 UI 結構;後端 endpoint shape 部分微調

---

## 1. 目標

User 在驗收 v1 後反饋三點:
1. **整體不直覺** — 上下兩個大 panel 切半,每個 panel 都顯得內容少
2. **大戶部位 panel 大半空白** — 4 個 horizontal bar + 趨勢線在大 panel 裡很零散
3. **熱門履約價看不出所以然** — 純表格,strike 跳來跳去(按 volume 排),無視覺感、無現價 anchor

Redesign 目標:**3 秒內回答「今天量都集中在哪些履約價」**。把成交量分布提升為主視角,大戶 NET 壓成可瞄一眼的 strip(含 20D sparkline 保留趨勢訊號)。

### 1.1 設計決策(brainstorm 結果)

| 決策 | 選擇 | 理由 |
|---|---|---|
| 主視角 | 成交量分布圖(Strike Ladder) | 「3 秒回答主戰場在哪」 |
| Ladder 視覺型式 | 橫向 Strike Ladder(Y 軸 strike 高在上、Call 左 / Put 右水平延伸) | 類 order-book ladder,trader 直覺;現價可當 horizontal anchor line |
| Strike 範圍 | 只顯示當日 volume > 0 的 strike,按 strike 順序排 | TXO 一日約 30-50 strike 有量,ladder 長度合理;丟 illiquid OTM |
| Layout | 方案 B:大戶 strip 頂部 + Ladder 主體 | Ladder 占滿垂直空間;大戶降為 condensed strip |
| 大戶 strip 補救 | 每張 card 嵌 sparkline | 保留「大戶在轉向」訊號,Strip 高度 +15px 可接受 |
| 熱門履約價表 | **砍掉** | Ladder 已完全 cover「哪幾個 strike 量大」這個問題 |

### 1.2 不在範圍內

- ❌ 不改 ModeSwitch / equity 流程任何一行
- ❌ 不改 contract dropdown 邏輯
- ❌ 不引入新 charting library
- ❌ 不做夜盤 / Tick / Max Pain / PCR(原 spec §7 之後再議的不動)
- ❌ 不改 list_active_contracts / parse_oi_large_traders 任何邏輯 — 已驗證上線

---

## 2. 後端設計

### 2.1 變更總覽

| 變更 | endpoint | 動作 |
|---|---|---|
| 大戶 series 4 條 net | `GET /api/options/oi_large_traders` | series item 增加 `top5_all_net`、`top5_prop_net` 兩欄(原本只有 top10 兩條) |
| 履約價分布 — 全部有量 strike | `GET /api/options/strike_volume` | 移除 `top_n` query 與排序;改回**全部 volume > 0 的 strike,按 strike asc 排序** |
| 台指期現價(spot) | `GET /api/options/spot?date=YYYY-MM-DD` | **新 endpoint** — 從 FinMind `TaiwanFuturesDaily` data_id=TX 抓當日 close + 漲跌 |

### 2.2 oi_large_traders response 微調

原本:
```json
"series": [
  { "date": "2026-06-04", "top10_all_net": 6800, "top10_prop_net": 5400 }
]
```

新增 4 條 net(對應 strip 4 張 card 各自的 sparkline):
```json
"series": [
  {
    "date": "2026-06-04",
    "top5_prop_net":  3500,
    "top10_prop_net": 5400,
    "top5_all_net":   4800,
    "top10_all_net":  6800
  }
]
```

`current` 結構不動。Parser `parse_oi_large_traders` 在迴圈裡 already aggregates 4 組,只是 series 只 emit 2 欄 — 改成 emit 4 欄即可。

### 2.3 strike_volume 改回「全部有量 strike」

原 endpoint 邏輯:filter `option_id == TXO AND contract_date == X`,在 parser 內 sort volume desc,取 top_n,Call / Put 各回 list。

新邏輯:
- **移除 `top_n` query param**(API 級 breaking change,但前端沒別人用)
- 一次回**全部 volume > 0 的 strike**(Call 與 Put 各自)
- **按 strike asc 排序**(不是 volume desc)
- response shape 中 `call` / `put` 仍是 list,只是更長(30-50 項而非 10 項)

新 response:
```json
{
  "contract": "TXO202607",
  "date": "2026-06-23",
  "fetched_at": "2026-06-23T14:30:00",
  "as_of_date": "2026-06-23",
  "call": [
    { "strike": 50000, "volume":  165, "oi": 1240, "oi_change":  +91 },
    { "strike": 50500, "volume":  220, "oi": 1810, "oi_change": +145 },
    ...按 strike asc 排,所有 volume > 0 的 call
  ],
  "put": [
    { "strike": 50000, "volume":  364, "oi": 8120, "oi_change": +273 },
    ...按 strike asc 排
  ]
}
```

Parser `parse_strike_volume` 改動:
- 拿掉 `top_n` 參數
- side() function 改:
  ```python
  items = [(strike, v) for (d, cp, strike), v in agg.items()
           if d == today and cp == cp_value and v["volume"] > 0]
  items.sort(key=lambda t: t[0])  # 改:by strike asc
  # 不切 top_n,全部回
  ```

Route 同步移除 `top_n` query 與相關 400 error code。

### 2.4 新 endpoint `/api/options/spot`

```
GET /api/options/spot?date=YYYY-MM-DD&refresh=false
```

Response:
```json
{
  "date": "2026-06-23",
  "fetched_at": "2026-06-23T14:30:00",
  "as_of_date": "2026-06-23",
  "spot":       53420.0,
  "prev_close": 53300.0,
  "change":     120.0,
  "change_pct": 0.225,
  "no_trading_day": false
}
```

Implementation:
- 抓 FinMind `TaiwanFuturesDaily` `data_id=TX`(台指期),`start_date = date - 7 cal days`,`end_date = date`
- Parser 取最後一筆為當日(`spot = close`),倒數第二筆為前一交易日(`prev_close`)
- `as_of_date != requested` → `no_trading_day: true`(沿用既有 banner 規則)
- Cache key `TX_{date}_spot.json`,同 `_CACHE_VERSION_OPTIONS = 1`
- 走 `FinMindClient`,新加 `fetch_spot(date_str, refresh)` + `_do_fetch_spot`
- Pure parser `parse_spot(rows: list[dict]) -> dict` in `services/finmind_options.py`

⚠️ **Phase 0-style 假設(待 curl 驗證)**:
- `TaiwanFuturesDaily` data_id `TX` 是否為**近月台指期**的常用 alias?還是要用 `TXFCONT`(連續月)?需 curl 比對
- 欄位:`close`, `open`, `max`, `min`, `volume`, `settlement_price`(同 OptionDaily 慣例),要 curl 確認

### 2.5 錯誤碼

不新增。`spot` endpoint 用同一套(httpx → 502、ValueError → 503、`as_of_date != requested` → 200+`no_trading_day`)。

---

## 3. 前端設計

### 3.1 元件樹變化

```
原:
  OptionsPage
  ├─ OptionsHeader
  ├─ OptionsLargeTradersPanel
  │    ├─ LargeTradersBars(SVG)
  │    └─ LargeTradersTrend(SVG)
  └─ OptionsStrikeVolumePanel(table)

新:
  OptionsPage
  ├─ OptionsHeader(加現價右側顯示)
  ├─ OptionsLargeTradersStrip    ← 新元件,取代既有 panel
  │    └─ 4 × LargeTraderCard(label + NET + mini-bar + sparkline)
  └─ OptionsStrikeLadder         ← 新元件,取代 OptionsStrikeVolumePanel
```

**保留/沿用**:`useOptionsLargeTraders` / `useOptionsStrikeVolume` hook(只擴展 type)+ `useContainerSize`。

**新加 hook**:`useOptionsSpot(date)` — 同樣 abort + refresh + noTradingDay 模式。

**刪除/替換**:
- `OptionsLargeTradersPanel.tsx`(+test)→ `OptionsLargeTradersStrip.tsx`
- `LargeTradersBars` / `LargeTradersTrend`(在 `options-chart-svg.tsx`)→ 由 strip 內的 mini-bar + sparkline 取代
- `OptionsStrikeVolumePanel.tsx`(+test)→ `OptionsStrikeLadder.tsx`
- `options-chart-svg.tsx` 重寫為 `options-svg.tsx` 含:`<MiniBar>`、`<Sparkline>`、`<StrikeLadder>` 三個元件

### 3.2 OptionsHeader 變更

加最右側「現價」區塊:
```
[ 選擇權籌碼 ] [合約 ▾] [日期] [重新整理]    台指期 53,420 ↑+120 (+0.22%)
```

實作:
- `useOptionsSpot(date)` hook,date 變化重抓
- 顯示 `spot` 大字 + `change`(紅綠)+ `change_pct`(%)
- `spot` loading 顯示 「— —」,error 隱藏整塊不影響 header

### 3.3 OptionsLargeTradersStrip

固定高度約 76px(`12px padding × 2 + 52px content`)。4 張 card grid,等寬。

每張 card 內部 grid `1fr 90px`:
- 左:label / NET 數字 / mini-bar(進度條視覺,寬度 = `|net| / max(|all_nets|) × 100%`)
- 右:sparkline(`<Sparkline series={...} width={90} height={30} />`)+ 上方 「20D · +XXX」 文字標籤(20 天 net 累計變化)

Sparkline 細節:
- 取 series 對應的 net field(`top5_prop_net` / `top10_prop_net` / 等)
- 顏色由 series 末值正負決定(末值 > 0 → 紅、< 0 → 綠)
- 區域填色(opacity 0.15)+ 線(stroke-width 1.25)+ 末點 dot
- Zero line(`stroke-dasharray 2 2`)區隔正負

`weeklyAggregateBanner` 提示:當 contract.kind === "weekly",strip 上方仍顯示 banner(沿用既有 §3.3 of v1 spec)。

### 3.4 OptionsStrikeLadder

占 viewport 剩餘所有高度,可垂直 scroll。

結構:
```
[ Call vol / OI±        Strike       vol / OI± Put ]   ← header sticky
├ ▌▌▌▌ 1,200 +680     54,000              60     ▌                  ┤
├ ▌▌▌  890   +470     53,800              38     ▌                  ┤
... (Y 軸 strike 高在上)
├──────────────────────  53,420 ← 現價  ──────────────────────────  ┤   (紅色橫線 anchor)
├ ▌▌  340   +85       52,500              145    ▌▌▌                ┤
... (低 strike 在下)
```

每 row:
- grid `1fr 100px 1fr` (call-side / strike / put-side)
- `.call-side` 內:bar(右對齊,寬度 `vol / max_vol × 100%`)+ overlay text「volume + OI± pill」
- `.put-side` 對稱(bar 左對齊)
- 現價那 row 用獨立 `.spot` class:背景淡紅 + 上下紅邊框 + strike 用紅色字 + 「← 現價」標
- 現價 row 插入位置:遍歷 sorted-desc strikes,當 cursor < spot 時插一行

Strike 列順序:**高在上、低在下**(模擬 trader 直覺看 strike ladder)。

OI±:正紅、負綠,絕對值 abbrev(>1000 顯示 `1.2k`,否則整數)。

### 3.5 OptionsPage 重組

```tsx
<div className="h-full flex flex-col overflow-hidden">
  <OptionsHeader ... />
  {(largeTraders.noTradingDay || strikeVolume.noTradingDay || spot.noTradingDay) && (
    <div className="banner-no-trading-day">{date} 無交易</div>
  )}
  <OptionsLargeTradersStrip
    data={largeTraders.data}
    weeklyAggregateBanner={isWeekly}
  />
  <OptionsStrikeLadder
    data={strikeVolume.data}
    spot={spot.data?.spot}
  />
</div>
```

`noTradingDay` 判定取 3 個 endpoint 的 OR(其中任一 fire 就顯示 banner):非交易日時 3 個都會 fire,任一即可;假設將來 spot endpoint 因獨立失敗模式單獨 fire,banner 也能 catch。

垂直排序:Header(56px)→ no_trading_day banner(可選, 32px)→ weeklyAggregateBanner(可選, 28px,if weekly)→ Strip(76px)→ Ladder(剩下所有空間,scroll)。

### 3.6 視覺主題

- 紅 `var(--up)` / 綠 `var(--down)` 沿用
- Strike ladder bar opacity `0.6`(避免遮住 volume text)
- Sparkline 填色 opacity `0.15`
- 現價 anchor row:背景 `rgba(220, 38, 38, 0.04)`、上下邊框 `1px solid var(--accent)`
- 不引入新 token

### 3.7 載入 / 錯誤 / 空狀態

- Strip loading:4 張 card 顯示 skeleton(label + 數字 placeholder + sparkline 線形 placeholder)
- Ladder loading:中央 spinner
- Strip error / Ladder error:沿用既有紅 banner
- `noTradingDay`(任一 endpoint):灰 banner 在 header 下方,**panel 仍可看到 fallback 資料**(沿用既有設計)
- spot error:不顯示現價,header 不破

---

## 4. 測試策略

### 4.1 後端新增 / 修改測試

| # | 測試 | 範圍 |
|---|---|---|
| B1 | `test_parse_oi_large_traders_series_includes_4_nets` | series 每筆有 4 個 net 欄 |
| B2 | `test_parse_strike_volume_returns_all_strikes_by_strike_asc` | 不再切 top_n,排序改為 strike asc |
| B3 | `test_strike_volume_route_ignores_top_n_silently` | top_n query 移除 — route 不再宣告該 param,FastAPI 預設行為是「未宣告 query 被忽略」,return 200。v1 caller 留下的 stale URL 不會壞。 |
| B4 | `test_parse_spot_picks_latest_close` | `parse_spot` 新函式 |
| B5 | `test_parse_spot_change_uses_prev_trading_day` | change = today.close - prev.close |
| B6 | `test_parse_spot_empty_as_of_date_none` | 空 input → as_of_date None |
| B7 | `test_fetch_spot_writes_cache_and_returns_shape` | FinMindClient.fetch_spot |
| B8 | `test_spot_route_happy_path` | /api/options/spot |
| B9 | `test_spot_route_no_trading_day_when_as_of_differs` | banner 邏輯沿用 |

### 4.2 前端新增 / 修改測試

| # | 測試 | 範圍 |
|---|---|---|
| F1 | `useOptionsSpot.test.ts` | 3 狀態 + abort + noTradingDay flag |
| F2 | `OptionsLargeTradersStrip.test.tsx` | 4 張 card、每張含 sparkline、weeklyBanner 顯示控制 |
| F3 | `OptionsStrikeLadder.test.tsx` | 全 strike asc 排序、現價 row 插入位置正確、Call bar 右對齊 / Put bar 左對齊 |
| F4 | `options-svg.test.tsx` | `<MiniBar>`、`<Sparkline>`、`<StrikeLadder>` pure SVG 測試 |
| F5 | 更新 `OptionsHeader.test.tsx` | 現價區塊顯示 / loading / error 三狀態 |
| F6 | 刪除 `OptionsLargeTradersPanel.test.tsx` + `OptionsStrikeVolumePanel.test.tsx`(被取代) |

### 4.3 真實環境驗證(DevTools MCP)

新 verification 截圖目錄:`docs/superpowers/specs/2026-06-24-options-page-redesign-verification/`

| # | 場景 |
|---|---|
| 01 | redesign 後的選擇權頁(default W1 + 今日)|
| 02 | 切到 M0 月選,Ladder 重抓 |
| 03 | 切到歷史交易日(2026-06-22),現價 anchor 對齊正確 |
| 04 | 週六日期,3 個 banner(no_trading_day)+ 仍顯示 fallback 資料 |
| 05 | Sparkline 視覺:4 張 card 各顯示 20D 曲線 |
| 06 | Strike ladder 現價 row 視覺:紅色橫線居中 |
| 07 | 切回個股 mode,既有 equity 流程零回歸 |

---

## 5. Phasing

| Phase | 範圍 | commit |
|---|---|---|
| P0 | curl `TaiwanFuturesDaily` data_id=TX 驗證欄位、確認近月 vs 連續月對應 | `docs(options): record Phase 0b spot data validation` |
| P1 | 後端:parse_oi_large_traders series 4 nets + parse_strike_volume 全 strike + parse_spot + FinMindClient.fetch_spot + /api/options/spot route + 更新既有 route 移除 top_n | 1-2 個 commit |
| P2 | 前端:新 `options-svg.tsx`(MiniBar/Sparkline/StrikeLadder)+ useOptionsSpot hook + OptionsHeader 加現價區 + 新 OptionsLargeTradersStrip + 新 OptionsStrikeLadder + 刪舊元件 + OptionsPage 重組 | 3-4 個 commit |
| P3 | DevTools MCP 真實環境驗證 + 7 張截圖 | 1 commit |

---

## 6. 風險與緩解

| 風險 | 緩解 |
|---|---|
| Strike ladder 在 30-50 row 時垂直 scroll 體驗 | header sticky;mount 時 auto-scroll 到現價 row |
| 現價 anchor 對齊問題:strike 50 一檔 step,現價 53,420 不在 strike 上 | 在最接近的兩個 strike 中間插一行專用 spot row,不擾亂既有 row 結構 |
| `TaiwanFuturesDaily` data_id 不確定(`TX` vs `TXF` vs `TXFCONT`)| Phase 0 curl 確認;不對就修 spec 再實作 |
| 既有 strike_volume 的 top_n 已上線使用 | 前端只有自己用,backward-compat 不重要;直接 breaking change |
| Sparkline 4 條 in strip 視覺擁擠 | 已在 mockup 驗證,76px 高度 OK,sparkline 90×30 px 不擠 |
| 現價 endpoint 失敗會讓 Ladder 失去 anchor | spot error 時 Ladder 仍可正常 render,只是無紅線;不擋主流程 |

---

## 7. 未列入此 spec、之後再議

- Sparkline hover 顯示 tooltip(精確值 + 日期)
- Strike ladder row 點擊 → 跳到該 strike 詳情 / 走勢
- 自動 scroll 到現價 row(P1 不做,P2 視體驗再加)
- Max Pain 視覺化(在 ladder 旁加 indicator)
- PCR / IV skew / Greeks(資料源不一定有)
- Strip card 點擊 → 彈 popover 顯示更大趨勢圖
- 夜盤資料來源切換
- 行動版 layout(spec §1.2 已標不做)
