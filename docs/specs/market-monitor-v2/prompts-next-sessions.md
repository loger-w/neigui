# market-monitor-v2 — 後續 session prompts(2026-07-02 spec-vs-shipped audit 產出)

執行順序:①② /bug(行為修正)→ ③ /perf(hot path)→ ④ P5 frontend。

Audit 依據(2026-07-02 spec-vs-shipped audit,verify 全數收尾):6 reader × 2-vote
adversarial verify,52 條 raw findings → 最終 **49 條成立**(H10 2/2 killed;S11 駁回 —
sector fetcher 只 catch httpx 是 P4 T-INT-4 鎖定的既定 fail-loud 設計;S12 PLAUSIBLE 但
action 已落地本檔 layout 拍板段)。S5(幽靈金融 sector)/ S9(張→萬張)為手動實證,
其餘 S1~S4/S6~S8/S10 補驗 2/2 CONFIRMED。本檔四份 prompt 已吸收全部成立 findings 的
p5_action。關鍵證據:`.claude/feat/market-sector-amount-share/evidence/snapshot_full.json`
(真實 payload;注意其中 mcclellan 量級與金融保險業幽靈 sector 是①②修正前的舊值)。

**額度紀律(全部 session 適用,user 指示 2026-07-02)**:Workflow 的 `agent()` 一律帶
`effort: 'low'`(reader / verify / readiness audit 等機械工序全部 low);真正難的 judge /
design-review 才升 effort 且要說明理由。獨立 Agent tool 無 effort 參數 → 用 `model: 'haiku'`
降級。Phase 4 multi-lens review workflow 照此設定。

---

## ① /bug mcclellan-ratio-scaling

```
/bug McClellan Oscillator 少乘 1000 縮放,thrust dot 數學上不可能觸發

症狀(已穩定重現):真實 payload breadth.mcclellan_oscillator = -0.0029(2026-07-02
.claude/feat/market-sector-amount-share/evidence/snapshot_full.json),而
market_breadth.py _DEFAULT_THRUST_THRESHOLD = 100.0。RANA = (adv-dec)/(adv+dec) ∈ [-1,1]
→ EMA19−EMA39 上限 ±2 << 100 → thrust_dot 永遠 None。
Root cause 方向:spec §6.2 引用的 Ratio-Adjusted McClellan(StockCharts 慣例)是
RANA × 1000 後再 EMA;P2 實作漏乘。美股慣例值域 ±(數十~百餘)。

範圍:backend/services/market_breadth.py compute 鏈(compute_mcclellan 或 RANA 建構點擇一,
設計時定);mcclellan_series / mcclellan_oscillator / thrust_dot / centerline_cross 判斷
全部連動檢查(centerline 0 線不受縮放影響,divergence 用相對形狀也不受影響 — 測試要鎖)。
前端尚未消費 breadth(P5 才接)→ 現在是無痛修正窗口。

紀律:紅測試先行(手算 fixture:已知 adv/dec 序列 → 期望 ×1000 後的 oscillator 值);
既有 test 若 assert 舊量級要當「該變的 assertion」明列;±100 閾值台股未校準的 KG 不動
(修的是量級不是閾值)。無 result cache 不需 bump 任何 _CACHE_VERSION。
完成 gate:cd backend && python -m pytest -q + ruff check .;real-env curl 一次確認
oscillator 量級落在 ±150 內合理區間且非 ±0.0x。
```

---

## ② /bug sector-override-phantom

```
/bug _PRIMARY_INDUSTRY_OVERRIDE 字串與 TaiwanStockInfo 實際 category 不匹配,產生幽靈 2 檔 sector

症狀(已穩定重現):真實 payload sector_breadth 同時存在「金融保險」(30 檔,真實 TWSE
category)與「金融保險業」(2 檔 = 2882 國泰金 + 2891 中信金,來自 override 硬編字串)。
兩檔權值金融股被切出真實 sector,污染既有 heatmap + P3/P4 全部三個 sector 聚合表。
證據:.claude/feat/market-sector-amount-share/evidence/snapshot_full.json(grep 金融)。

Root cause 方向:backend/services/finmind_realtime.py _PRIMARY_INDUSTRY_OVERRIDE 的
value 字串沒對照 TaiwanStockInfo industry_category 真實值集合(「金融保險業」vs 實際
「金融保險」)。其他 8 個 override(半導體業/其他電子業/電子零組件業/電子工業/通信網路業/
食品工業/水泥工業)在 45 類清單中都真實存在,先驗證後修 — 不要只改一條就收工。

修法方向(設計時定):value 校正為真實 category 字串 + 新增 test 鎖「override 每個 value
∈ 當前 sector_rows 的 industry_category 集合」(防未來 FinMind 改名 silent drift)。
注意:_dedup_sector_map 是 P1 既有函式,只動 override dict 常數 + 加 test,不動函式邏輯。
完成 gate:pytest -q + ruff;real-env curl 確認「金融保險業」幽靈 sector 消失、
金融保險 members 32。
```

---

## ③ /perf snapshot-hot-path

```
/perf /api/market/snapshot warm 36.8s → 目標 < 3s;refresh 語意修正;cache 體積治理

量化基準(2026-07-02 實測,evidence 在 .claude/feat/market-sector-amount-share/):
- warm request 36.8s:每 request 4 次序列 re-parse breadth_prices JSON cache
  (P2 breadth + P3 ×2 + P4 amount_share 各自 _fetch_prices_window → json.load 1.5GB)
- 冷啟動(每日首請求)277.8s 擋全站;sync json.load 卡 FastAPI event loop
  → equity / options mode 同進程被拖累
- frontend useMarketSnapshot 盤中 refetchInterval 2500ms → 盤中 back-to-back 長請求
- refresh=true 一路穿進 EOD fetcher:「重新整理」按鈕 = ~278s + 128 次 FinMind 呼叫
- cache 零清理:breadth_prices_* 實測 2 檔 3.06GB(每日 +1.5GB;per-day loop 抓全市場
  ~2 萬 instrument 不只 universe → 每檔 1.5GB)

Profile 後候選策略(brainstorm 階段裁決,不預設全做):
1. EOD result-level cache:四個 compute(breadth / sector_breadth / sector_volume_ratio /
   sector_amount_share)結果以 end_date(trading day)為 key 快取(disk or in-memory),
   命中後 warm path 只剩 intraday tick 部分
2. refresh 語意:snapshot 的 refresh=true 只 bust intraday cache(universe/sector_map/
   mv/watch_list),不傳進 EOD fetcher(或僅 end_date 前進時 bust)— 對齊「重新整理 =
   看最新盤中」的 user 心智模型
3. 寫入前裁欄:_do_fetch_prices 只留 stock_id/date/close/Trading_Volume/Trading_money
   → 檔案縮 ~10x;需 bump _CACHE_VERSION_BREADTH(P2 自有版本,bump 合法,只重抓一次;
   注意 spec §4「P4 不 bump」指的是 _CACHE_VERSION_REALTIME,不衝突)
4. 舊 window 檔清理:寫新 cache 時 pattern-delete 舊 breadth_prices_*(對齊
   _invalidate_chip_parse_caches 慣例)
5. json.load 移出 event loop(asyncio.to_thread)或由 1 直接消滅重 parse
6. (小,add-only)payload 加 top-level `eod_as_of: string | null`(= 四個 EOD compute
   實際用的 max price date)— 盤中新 panel 全是 T-1,前端標示日期不用從 series 反推
   (breadth null 時 series 不可得);P5 prompt 已假設此欄存在

紀律:先 profile 證實 bottleneck 佔比再動手(鐵則:profile 真實 bottleneck);
行為不變是硬約束 — P2/P3/P4 全部既有測試綠 = 行為合約;三類 commit 分開
(cache 語意變更若影響 refresh 行為 → 🔴 行為改動獨立 commit + 測試先行)。
量化完成條件:warm snapshot < 3s(curl 實測)/ refresh 按鈕 < 10s / event loop 不再
被 EOD parse 卡住(盤中同時 curl /api/chip 類 endpoint 驗證回應時間)/ cache 目錄
增長有界。CLAUDE.md §9 已記「每日首請求必冷」— 若策略 1 落地,該條 lesson 同步改寫。
前置:①② 兩個 /bug 先 merge(result cache 會凍結計算結果,先修對再快取)。
```

---

## ④ /feat market-page-v2-frontend(P5,修訂版 — 含 audit 51 findings 落地)

```
/goal Phase 7 結構化表格全綠
/feat market-page-v2-frontend

接 market-monitor-v2 P4(PR #13 已 merge @ da69bf1)。★ 前置:①/bug mcclellan-scaling、
②/bug sector-override-phantom、③/perf snapshot-hot-path 三輪已 merge(若未完成先停下問我 —
特別是③沒做的話首屏會卡 37s,P5 的 UX 驗證全部失真)。
本輪執行 plan Phase 5(MarketPage V2 重組)+ plan Phase 6(截圖/verification/changelog)
併入 /feat 流程 Phase 6/8。L 級(≥5 檔 + UI),Phase 1/2 各 max 3 輪 review。

Pre-reading(必讀):
- docs/specs/market-monitor-v2/spec.md §6(呈現規則)§7(layout)§8(payload — ⚠ example
  已知 drift,契約以下方「payload 契約事實」+ evidence/snapshot_full.json 為準)
- docs/specs/market-monitor-v2/plan.md Phase 5 + 6(TDD 7 條 + 陷阱注意)
- .claude/feat/market-sector-amount-share/evidence/snapshot_full.json(真實 payload,
  fixture 直接取材;注意其中 mcclellan 量級 / 金融保險業幽靈 sector 是①②修正前舊值)
- CLAUDE.md §3 + §8 P0(TanStack Query)+ §9 全部 frontend lessons(Radix Tabs jsdom /
  TanStack retry waitFor timeout / refresh cancelQueries / squarified 公式 / RTL 無
  jest-dom+user-event / banner 文案禁分項數字)
- frontend/src/components/{MarketPage,MarketHeader,MarketHeatmap,MarketLeaderboard}.tsx
- frontend/src/hooks/useMarketSnapshot.ts(TanStack Query;回傳 {data, loading, error,
  refresh, lastUpdated, isStale, isTradingSession};data 整包透傳 → type 補齊後預期
  hook 邏輯零改動,backward-compat 硬約束)
- frontend/src/lib/market-types.ts + market-api.ts + heatmap-svg.tsx + index.css @theme

★ Payload 契約事實(audit verified,直接照抄,不要信 spec §8 example):
1. top-level 是 as_of(ISO datetime),沒有 as_of_date
2. breadth / sector_breadth / sector_volume_ratio / sector_amount_share 四欄全部
   `| null`(獨立降級,payload 仍 200);三個 list 另可為 `[]`(fetcher 空 prices)—
   每個 panel 三態:資料 / null(「資料暫缺」降級)/ `[]`(無符合 sector),
   兩個非資料態都要 component test lock;頁級 error 處理不得 key 在這四欄
3. breadth 額外有 known_gaps: string[](現值 "taiex_unavailable")
4. mcclellan_series 前 ~38 筆 value=null(EMA 暖機)、序列長度 ~127(整個 pad window)
   — breadth-svg 自己 slice 最後 60 個交易日;mcclellan_oscillator 可 null
5. thrust_dot / centerline_cross / divergence_dot 是「最後一根 bar」的 scalar,
   不是逐 bar 歷史 dot 序列;payload 無 TAIEX 序列
6. ad_line_value / ad_line_series 是 window-relative 累計(起點 0)— 畫趨勢形狀 OK,
   不要呈現絕對值或跨日比較語意
7. sector_volume_ratio row = {sector, today_vol_lots, vol_ratio|null, flag:"hot"|"cold"|null}
   — flag 直接渲染,前端不重算 1.5/0.7 閾值;today_vol_lots 單位「張」,呈現「萬張」
   自己 /10000(spec §6.5 欄名如此)
8. sector_amount_share row = {sector, today_share, share_delta_20ma|null}
9. sector 維度 = TaiwanStockInfo industry_category ~45 類(非 spec 的 32 大類),含
   「其他」;heatmap 以 45 cells 設計;onSectorClick 參數 = 中文 sector 名字串(與既有
   sectors[].id 同 key space)。**TS type 用 plain string 不做 enum**(集合日變動);
   近似重複名(運動休閒/運動休閒類、綠能環保/綠能環保類、居家生活/居家生活類、
   數位雲端/數位雲端類 — TWSE/TPEx 詞彙差)V2 照實渲染,display-level merge map 留 V2.5
   (金融保險業幽靈已由②修掉);三表 sector 集合可因 drop rule 不同而不等長 —
   **跨表 join 用 sector 名,絕不用 index**
10. 三個 sector list 後端已排序(降序 + None-safe),前端不重排
11. universe_filter_unavailable error code 是死碼,不要寫處理分支;error UI 沿用既有
    stale banner + last-good 機制
12. universe_size / excluded_count 要進 type(P1 遞延);數字是「本次 snapshot universe
    相對值」非全市場統計

範圍:
- 🔵 lib/market-types.ts:照上方契約補全部欄位型別
- 🔵 hooks/useMarketSnapshot.ts:預期零邏輯改動(review 發現要動 → backward-compat 硬約束)
- 🟢 lib/breadth-svg.tsx + sector-breadth-svg.tsx(純 SVG,無 React 依賴,獨立單測;
    squarified 公式 lesson;null 值段落的 polyline 斷線處理要單測)
- 🟢 components/MarketBreadthPanel.tsx(McClellan + AD Line + 3 signal dot;
    known_gaps 含 taiex_unavailable 時 divergence 區顯示「TAIEX 資料缺」降級)
- 🟢 components/MarketSectorBreadthHeatmap.tsx(45 cells;onSectorClick)
- 🟢 components/MarketSectorAmountShare.tsx(降序表 + Δ 正負色)
- 🟢 components/MarketSectorVolRatio.tsx(flag dot 直接用)
- 🟢 components/MarketUniverseBanner.tsx(P1 遞延欠帳:「已過濾 ETF / 權證 / 注意處置股」
    — ⚠ 文案不得 overclaim:實作只排處置股,注意股/全額交割股未實作,措辭用「注意處置股」
    模糊帶過 or 改「處置股」,Phase 0 定;禁分項數字;stale=true 時 banner 顯示降級提示)
- 🔴 components/MarketPage.tsx(layout 重組 — 見下方拍板)
- 🟢 colocated *.test.tsx ≥ 15;🟢 changelog.ts 0.18.1 → 0.19.0(完整 VersionEntry,
    ChangeItem 無 date 欄 — spec §11 草稿 shape 是錯的,照 changelog.ts 型別寫)

Layout 拍板(audit H6/G9:spec §7 三欄圖沒有舊 panel 位置,「5 panel 無 scroll」+
「舊 panel 保留」在 1440x900 不可能同時成立):
- 新 5 panel(banner + breadth + heatmap + amount share + vol ratio)佔 §7 三欄主視圖,
  「無 scroll @1440x900」只量測新視圖
- 舊 MarketHeatmap + MarketLeaderboard 收進主視圖下方「經典檢視」折疊區(保留 mount,
  hidden attribute 慣例;e2e M1 依賴 market-heatmap / market-leaderboard 兩 testid
  visible — 折疊預設展開 or M1 spec 同步改,Phase 0 定)
- header 下方順序:error banner(既有 last-good)→ universe banner → 主視圖
- 既有 grid lg:grid-cols-[7fr_3fr] 整檔改寫,是 🔴 行為改動 commit

呈現紀律(全部測試 lock):
- 每個新 panel 標「資料至 YYYY-MM-DD」— 日期來源優先用 payload `eod_as_of`(③會加;
  若③該項沒做,fallback 從 breadth.ad_line_series 末筆推,且 panel 文案避免「今日」
  改「最近交易日」);盤中新欄位全是 T-1 EOD,header 的「即時」lag pill 不適用這四個 panel
- market-types.ts 補一個 vitest:把 evidence/snapshot_full.json 當 fixture 過型別
  (tsc 層 lock 契約,payload drift 時 build 立紅)
- skeleton / empty 判斷用 data 欄位存在與否,不用 loading(polling 下 isFetching 恆 true)
- breadth 家族一律 ink 色階;⚠ spec 寫的 ink-accent token 不存在於 index.css,
  用既有 token(text-accent / text-ink-muted)對應,Phase 1 定色票表
- 嚴禁方向性文案:expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull()
- McClellan ±100 dot 只標不寫字(閾值台股未校準 KG;①修完量級對了,閾值仍是美股慣例)
- amount share 不寫「占大盤」絕對語意;不暗示表格 = 全 sector 覆蓋(停牌 sector 靜默缺席)
- Tab / 折疊用普通 button(Radix Tabs jsdom 不可測)

e2e(判準表強制,plan Phase 5 原文漏列 — audit H5/G3/G7):
- backend/tests_e2e/test_api_market.py:補四個新 key 存在性 assert(允許 null)
- e2e/specs/market.spec.ts:M4+ 新 panel specs — fixture 策略:FAKE_FINMIND 缺全市場
  TaiwanStockPrice window + TAIEX fixture → 新 panel 在 e2e 下必為空;本輪 M# 先 assert
  「空狀態正確渲染不 crash」,populated fixture(需 MANIFEST 條目 + (TaiwanStockPrice,"")
  全市場 window,量大)列 next-time 或 Phase 0 決定入 scope
- visual.spec.ts V# baseline 更新(layout 大改)列入 gate
- live-contract.spec.ts L#:四欄 schema 驗證(@live,本機跑)
- M1 既有 testid 不能弄掉(見 layout 拍板)

不要動:backend 全部(契約 bug → 停下回報)/ MarketHeatmap / MarketLeaderboard 不刪 /
useOptionsXxx / useChipXxx / _CACHE_VERSION 系列

Out of scope(維持):全市場 %>20MA hero metric(audit G8 確認資料已足夠純前端可算,
留 V2.5 一行加)/ KY 興櫃 / concept-drill(只留 onSectorClick 接點)

完成 gate:npm test + npm run build + cd backend && python -m pytest -q(確認沒動壞)+
e2e npm test(M# + V# baseline)+ chrome-devtools MCP 截圖 ≥ 5 張(整頁 / heatmap hover /
thrust dot(①修復後可 historical fetch 找觸發日)/ Δ 顏色 / banner)→
docs/specs/market-monitor-v2/screenshots/ + verification.md + CLAUDE.md §9 ≥ 2 lesson。
Phase 4 用 Workflow 多 lens review(correctness / a11y+文案禁忌 / test_coverage)。
```
